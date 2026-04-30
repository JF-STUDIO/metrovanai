import express from 'express';
import type { BillingActivationCode, BillingPackage } from '../types.js';
import type { RouteContext } from './context.js';

export function createBillingRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    activationCodeRedeemSchema,
    applyActivationCodeToPackage,
    buildBillingPayload,
    buildStripeCheckoutReturnUrls,
    checkUserRateLimit,
    checkoutConfirmSchema,
    createStripeCheckoutSession,
    getOrderFromStripeSession,
    getStripeObjectId,
    getStripeCurrency,
    getTopUpPackages,
    isActivationCodeAvailable,
    isInternalTopUpAllowed,
    isStripeConfigured,
    isUserDisabled,
    requireAuthenticatedUser,
    resolveTopUpSelection,
    retrieveStripeCheckoutSessionWithDocuments,
    settlePaidStripeCheckoutSession,
    store,
    topUpSchema,
    writeSecurityAuditLog
  } = ctx;

app.get('/api/billing', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }

  res.json(buildBillingPayload(user.userKey));
});

app.post('/api/billing/checkout', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (isUserDisabled(user)) {
    res.status(403).json({ error: '该账号已被停用，无法充值。请联系客服。' });
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'billing-checkout',
      limit: 20,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: '支付服务暂时不可用，请稍后再试。' });
    return;
  }

  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const selection = resolveTopUpSelection(parsed.data);
  if (!selection.ok) {
    res.status(selection.status).json({ error: selection.error });
    return;
  }

  const order = store.createPaymentOrder({
    userId: user.id,
    userKey: user.userKey,
    email: user.email,
    packageId: selection.selectedPackage.id,
    packageName: selection.selectedPackage.name,
    points: selection.effectivePackage.points,
    amountUsd: selection.effectivePackage.amountUsd,
    currency: getStripeCurrency(),
    activationCodeId: selection.activationCode?.id ?? null,
    activationCode: selection.activationCode?.code ?? null,
    activationCodeLabel: selection.activationCode?.label ?? null
  });

  try {
    const checkoutSession = await createStripeCheckoutSession({
      order,
      ...buildStripeCheckoutReturnUrls(req)
    });
    const attached = store.attachStripeCheckoutSession(order.id, {
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      customerId: getStripeObjectId(checkoutSession.customer)
    });

    if (!attached || !checkoutSession.url) {
      store.markPaymentOrderStatus(order.id, {
        status: 'failed',
        errorMessage: 'Stripe did not return a checkout URL.'
      });
      res.status(502).json({ error: '支付页面创建失败，请稍后再试。' });
      return;
    }

    writeSecurityAuditLog(req, {
      action: 'billing.stripe.checkout_created',
      targetUserId: user.id,
      details: {
        orderId: order.id,
        stripeCheckoutSessionId: checkoutSession.id,
        packageId: order.packageId,
        points: order.points,
        amountUsd: order.amountUsd
      }
    });

    res.status(201).json({
      order: attached,
      sessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url
    });
  } catch (error) {
    store.markPaymentOrderStatus(order.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(502).json({ error: '支付页面创建失败，请稍后再试。' });
  }
});

app.post('/api/billing/checkout/confirm', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'billing-checkout-confirm',
      limit: 60,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({ error: '支付服务暂时不可用，请稍后再试。' });
    return;
  }

  const parsed = checkoutConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const checkoutSession = await retrieveStripeCheckoutSessionWithDocuments(parsed.data.sessionId);
    const order = getOrderFromStripeSession(checkoutSession);
    if (!order || order.userKey !== user.userKey) {
      res.status(404).json({ error: '找不到该订单。' });
      return;
    }

    const result = settlePaidStripeCheckoutSession(req, checkoutSession, 'confirm');
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({
      order: result.order,
      billing: buildBillingPayload(user.userKey)
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to confirm Stripe payment.' });
  }
});

app.post('/api/billing/activation-code/redeem', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (isUserDisabled(user)) {
    res.status(403).json({ error: '该账号已被停用，无法兑换激活码。请联系客服。' });
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'billing-activation-code-redeem',
      limit: 10,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  const parsed = activationCodeRedeemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const activationCode = store.getActivationCodeByCode(parsed.data.activationCode);
  if (!activationCode || !isActivationCodeAvailable(activationCode)) {
    res.status(404).json({ error: '激活码无效。' });
    return;
  }

  if (activationCode.packageId) {
    res.status(400).json({ error: '这个激活码只能在充值付款时使用。' });
    return;
  }

  if (activationCode.bonusPoints <= 0) {
    res.status(400).json({ error: '这个激活码不能直接兑换积分。' });
    return;
  }

  if (store.hasUserRedeemedActivationCode(user.userKey, activationCode.id)) {
    res.status(409).json({ error: '这个激活码已被当前账号兑换过。' });
    return;
  }

  const entry = store.createBillingEntry({
    userKey: user.userKey,
    type: 'credit',
    points: activationCode.bonusPoints,
    amountUsd: 0,
    note: `激活码兑换：${activationCode.label} (${activationCode.code})`,
    activationCodeId: activationCode.id,
    activationCode: activationCode.code,
    activationCodeLabel: activationCode.label
  });
  store.redeemActivationCode(activationCode.id);

  writeSecurityAuditLog(req, {
    action: 'billing.activation_code.redeem',
    targetUserId: user.id,
    details: {
      activationCodeId: activationCode.id,
      code: activationCode.code,
      points: activationCode.bonusPoints
    }
  });

  res.status(201).json({
    entry,
    billing: buildBillingPayload(user.userKey)
  });
});

app.post('/api/billing/top-up', async (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) {
    return;
  }
  if (isUserDisabled(user)) {
    res.status(403).json({ error: '该账号已被停用，无法充值。请联系客服。' });
    return;
  }
  if (
    !(await checkUserRateLimit(req, res, user, {
      scope: 'billing-internal-top-up',
      limit: 10,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  if (!isInternalTopUpAllowed()) {
    res.status(410).json({ error: '直接充值已停用，请通过安全支付渠道完成充值。' });
    return;
  }

  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const selectedPackage = getTopUpPackages().find((item: BillingPackage) => item.id === parsed.data.packageId);
  if (!selectedPackage) {
    res.status(404).json({ error: '找不到该充值套餐。' });
    return;
  }

  const submittedActivationCode = parsed.data.activationCode?.trim() ?? '';
  let effectivePackage: BillingPackage = selectedPackage;
  let activationCode: BillingActivationCode | null = null;

  if (submittedActivationCode) {
    activationCode = store.getActivationCodeByCode(submittedActivationCode);
    if (!activationCode || !isActivationCodeAvailable(activationCode)) {
      res.status(404).json({ error: '激活码无效。' });
      return;
    }

    if (activationCode.packageId && activationCode.packageId !== selectedPackage.id) {
      res.status(400).json({ error: '这个激活码不能用于当前充值档位。' });
      return;
    }

    effectivePackage = applyActivationCodeToPackage(selectedPackage, activationCode);
  }

  const billingNote = activationCode
    ? `积分充值：${selectedPackage.name}（兑换码 ${activationCode.code}${activationCode.label ? ' ' + activationCode.label : ''}）`
    : `积分充值：${selectedPackage.name}`;

  store.createBillingEntry(Object.assign({
    userKey: user.userKey,
    type: 'credit' as const,
    points: effectivePackage.points,
    amountUsd: effectivePackage.amountUsd,
    note: `积分充值：${selectedPackage.name}`,
    projectId: null,
    projectName: ''
  }, { note: billingNote }));

  if (activationCode) {
    store.redeemActivationCode(activationCode.id);
  }

  writeSecurityAuditLog(req, {
    action: 'billing.internal_top_up',
    targetUserId: user.id,
    details: {
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      points: effectivePackage.points,
      amountUsd: effectivePackage.amountUsd,
      activationCodeId: activationCode?.id ?? null
    }
  });

  res.status(201).json(buildBillingPayload(user.userKey));
});

  return app;
}
