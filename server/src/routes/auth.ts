import express from 'express';
import type { UserRecord } from '../types.js';
import type { RouteContext } from './context.js';

export function createAuthRouter(ctx: RouteContext) {
  const app = express.Router();
  const {
    AUTH_COOKIE_NAME,
    AUTH_SESSION_TTL_MS,
    EMAIL_VERIFICATION_TTL_MS,
    OAUTH_RETURN_COOKIE_NAME,
    OAUTH_STATE_COOKIE_NAME,
    OAUTH_VERIFIER_COOKIE_NAME,
    PASSWORD_RESET_TTL_MS,
    addQueryParam,
    appendSetCookie,
    buildAuthSessionResponse,
    buildGoogleAuthUrl,
    buildGoogleRedirectUri,
    buildOAuthCookie,
    buildPasswordResetUrl,
    buildSessionCookie,
    checkRateLimit,
    clearCookie,
    clearSessionCookie,
    createCsrfTokenForSession,
    createOAuthState,
    createPkceChallenge,
    createPkceVerifier,
    createSessionToken,
    emailVerificationConfirmSchema,
    emailVerificationResendSchema,
    exchangeGoogleCode,
    fetchGoogleProfile,
    getPublicAppOrigin,
    getRawHeaderValue,
    hashPassword,
    hashEmailVerificationCode,
    hashSessionToken,
    isUserDisabled,
    loginSchema,
    normalizeEmail,
    parseCookieHeader,
    passwordResetConfirmSchema,
    passwordResetRequestSchema,
    registerSchema,
    resolveGoogleAuthConfig,
    sanitizeReturnTo,
    sendEmailVerificationEmail,
    sendPasswordResetEmail,
    sendVerificationForUser,
    shouldUseSecureCookies,
    store,
    verifyPassword,
    writeSecurityAuditLog
  } = ctx;

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !(await checkRateLimit(req, res, {
      scope: `auth-register:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    })) ||
    !(await checkRateLimit(req, res, {
      scope: 'auth-register-ip',
      limit: 20,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  if (store.getUserByEmail(email)) {
    res.status(409).json({ error: '该邮箱已注册，请直接登录或使用其他邮箱。' });
    return;
  }

  const user = store.createUser({
    email,
    displayName: parsed.data.displayName ?? email.split('@')[0] ?? 'user',
    passwordHash: await hashPassword(parsed.data.password)
  });
  writeSecurityAuditLog(req, {
    action: 'auth.register.created',
    targetUserId: user.id,
    details: { email: user.email }
  });
  try {
    const verification = await sendVerificationForUser(req, user);
    if (verification && !verification.delivery.sent) {
      res.status(503).json({ error: '验证邮件发送失败，请稍后重试。' });
      return;
    }
  } catch (error) {
    console.error('Email verification send failed:', error);
    res.status(503).json({ error: '验证邮件发送失败，请稍后重试。' });
    return;
  }
  res.status(201).json({ verificationRequired: true, email: user.email });
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !(await checkRateLimit(req, res, {
      scope: `auth-login:${email}`,
      limit: 8,
      windowMs: 1000 * 60 * 15
    })) ||
    !(await checkRateLimit(req, res, {
      scope: 'auth-login-ip',
      limit: 60,
      windowMs: 1000 * 60 * 15
    }))
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: '邮箱或密码错误。' });
    return;
  }

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.failed',
      targetUserId: user.id,
      details: { reason: 'invalid_password', email: user.email }
    });
    res.status(401).json({ error: '邮箱或密码错误。' });
    return;
  }

  if (isUserDisabled(user)) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.disabled',
      targetUserId: user.id,
      details: { email: user.email }
    });
    res.status(403).json({ error: '该账号已被停用，请联系客服。' });
    return;
  }

  if (!user.emailVerifiedAt) {
    writeSecurityAuditLog(req, {
      action: 'auth.login.email_unverified',
      targetUserId: user.id,
      details: { email: user.email }
    });
    try {
      const verification = await sendVerificationForUser(req, user, { force: true });
      if (verification && !verification.delivery.sent) {
        res.status(503).json({ error: '验证邮件发送失败，请稍后重试。' });
        return;
      }
    } catch (error) {
      console.error('Email verification resend failed:', error);
      res.status(503).json({ error: '验证邮件发送失败，请稍后重试。' });
      return;
    }
    res.status(403).json({ error: '请先完成邮箱验证。' });
    return;
  }

  const token = createSessionToken();
  const csrfToken = createSessionToken();
  const secureCookies = shouldUseSecureCookies(req);
  store.markUserLoggedIn(user.id);
  store.createSession(user.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
  writeSecurityAuditLog(req, {
    action: 'auth.login.success',
    targetUserId: user.id,
    details: { email: user.email }
  });
  appendSetCookie(res, buildSessionCookie(token, secureCookies));
  res.json({ session: buildAuthSessionResponse(store.getUserById(user.id) ?? user, csrfToken) });
});

app.post('/api/auth/email-verification/confirm', async (req, res) => {
  if (
    !(await checkRateLimit(req, res, {
      scope: 'auth-email-verify-confirm',
      limit: 20,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  const parsed = emailVerificationConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const verificationTokenHash =
    'token' in parsed.data
      ? hashSessionToken(parsed.data.token)
      : hashEmailVerificationCode(parsed.data.email, parsed.data.code);
  const verificationToken = store.getEmailVerificationTokenByHash(verificationTokenHash);
  if (!verificationToken) {
    const existingToken = store.getEmailVerificationTokenRecordByHash(verificationTokenHash);
    const existingUser = existingToken ? store.getUserById(existingToken.userId) : null;
    if (existingUser?.emailVerifiedAt && !isUserDisabled(existingUser)) {
      const token = createSessionToken();
      const csrfToken = createSessionToken();
      const secureCookies = shouldUseSecureCookies(req);
      store.markUserLoggedIn(existingUser.id);
      store.createSession(existingUser.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
      appendSetCookie(res, buildSessionCookie(token, secureCookies));
      res.json({ session: buildAuthSessionResponse(store.getUserById(existingUser.id) ?? existingUser, csrfToken) });
      return;
    }

    res.status(400).json({ error: '该验证码无效或已过期，请重新发送验证邮件。' });
    return;
  }

  const user = store.getUserById(verificationToken.userId);
  if (!user) {
    res.status(400).json({ error: '该验证码无效或已过期，请重新发送验证邮件。' });
    return;
  }

  if (isUserDisabled(user)) {
    res.status(403).json({ error: '该账号已被停用，请联系客服。' });
    return;
  }

  const verifiedUser = store.updateUser(user.id, (current: UserRecord) => ({
    ...current,
    emailVerifiedAt: current.emailVerifiedAt ?? new Date().toISOString()
  }));
  if (!verifiedUser) {
    res.status(400).json({ error: '该验证码无效或已过期，请重新发送验证邮件。' });
    return;
  }

  store.markEmailVerificationTokenUsed(verificationToken.id);
  const token = createSessionToken();
  const csrfToken = createSessionToken();
  const secureCookies = shouldUseSecureCookies(req);
  store.markUserLoggedIn(verifiedUser.id);
  store.createSession(verifiedUser.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
  writeSecurityAuditLog(req, {
    action: 'auth.email.verify',
    targetUserId: verifiedUser.id,
    details: { email: verifiedUser.email }
  });
  appendSetCookie(res, buildSessionCookie(token, secureCookies));
  res.json({ session: buildAuthSessionResponse(store.getUserById(verifiedUser.id) ?? verifiedUser, csrfToken) });
});

app.post('/api/auth/email-verification/resend', async (req, res) => {
  const parsed = emailVerificationResendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !(await checkRateLimit(req, res, {
      scope: `auth-email-verify-resend:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (user && !isUserDisabled(user) && !user.emailVerifiedAt) {
    try {
      await sendVerificationForUser(req, user, { force: true });
    } catch (error) {
      console.error('Email verification resend failed:', error);
    }
  }

  res.json({ ok: true });
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  if (
    !(await checkRateLimit(req, res, {
      scope: `auth-password-reset:${email}`,
      limit: 3,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  const user = store.getUserByEmail(email);
  if (user && !isUserDisabled(user)) {
    const rawToken = createSessionToken();
    const resetToken = store.createPasswordResetToken(user.id, hashSessionToken(rawToken), PASSWORD_RESET_TTL_MS);
    writeSecurityAuditLog(req, {
      action: 'auth.password_reset.request',
      targetUserId: user.id,
      details: { email: user.email }
    });
    try {
      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.displayName,
        resetUrl: buildPasswordResetUrl(req, rawToken),
        expiresAt: resetToken.expiresAt
      });
    } catch (error) {
      console.error('Password reset email failed:', error);
    }
  }

  res.json({ ok: true });
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  if (
    !(await checkRateLimit(req, res, {
      scope: 'auth-password-reset-confirm',
      limit: 20,
      windowMs: 1000 * 60 * 60
    }))
  ) {
    return;
  }

  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const resetToken = store.getPasswordResetTokenByHash(hashSessionToken(parsed.data.token));
  if (!resetToken) {
    res.status(400).json({ error: '该重置链接无效或已过期，请重新申请密码重置。' });
    return;
  }

  const user = store.getUserById(resetToken.userId);
  if (!user) {
    res.status(400).json({ error: '该重置链接无效或已过期，请重新申请密码重置。' });
    return;
  }

  if (isUserDisabled(user)) {
    res.status(403).json({ error: '该账号已被停用，请联系客服。' });
    return;
  }

  const newPasswordHash = await hashPassword(parsed.data.password);
  const updatedUser = store.updateUser(user.id, (current: UserRecord) => ({
    ...current,
    emailVerifiedAt: current.emailVerifiedAt ?? new Date().toISOString(),
    passwordHash: newPasswordHash
  }));
  if (!updatedUser) {
    res.status(400).json({ error: '该重置链接无效或已过期，请重新申请密码重置。' });
    return;
  }

  store.markPasswordResetTokenUsed(resetToken.id);
  store.deleteSessionsForUser(user.id);
  writeSecurityAuditLog(req, {
    action: 'auth.password_reset.confirm',
    targetUserId: user.id,
    details: { email: user.email }
  });
  appendSetCookie(res, clearSessionCookie(shouldUseSecureCookies(req)));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionToken = cookies[AUTH_COOKIE_NAME];
  const secureCookies = shouldUseSecureCookies(req);
  if (sessionToken) {
    store.deleteSessionByTokenHash(hashSessionToken(sessionToken));
  }

  appendSetCookie(res, clearSessionCookie(secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_STATE_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_VERIFIER_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_RETURN_COOKIE_NAME, secureCookies));
  res.json({ ok: true });
});

app.get('/api/auth/google/start', (req, res) => {
  const returnTo = sanitizeReturnTo(String(req.query.returnTo ?? '/'));
  const secureCookies = shouldUseSecureCookies(req);
  const config = resolveGoogleAuthConfig(buildGoogleRedirectUri(req));
  if (!config) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_not_configured'));
    return;
  }

  const state = createOAuthState();
  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  appendSetCookie(res, buildOAuthCookie(OAUTH_STATE_COOKIE_NAME, state, 600, secureCookies));
  appendSetCookie(res, buildOAuthCookie(OAUTH_VERIFIER_COOKIE_NAME, verifier, 600, secureCookies));
  appendSetCookie(res, buildOAuthCookie(OAUTH_RETURN_COOKIE_NAME, returnTo, 600, secureCookies));
  res.redirect(302, buildGoogleAuthUrl(config, state, challenge));
});

app.get('/api/auth/google/callback', async (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const returnTo = sanitizeReturnTo(cookies[OAUTH_RETURN_COOKIE_NAME] ?? '/');
  const secureCookies = shouldUseSecureCookies(req);
  appendSetCookie(res, clearCookie(OAUTH_STATE_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_VERIFIER_COOKIE_NAME, secureCookies));
  appendSetCookie(res, clearCookie(OAUTH_RETURN_COOKIE_NAME, secureCookies));

  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const storedState = cookies[OAUTH_STATE_COOKIE_NAME];
  const verifier = cookies[OAUTH_VERIFIER_COOKIE_NAME];
  const config = resolveGoogleAuthConfig(buildGoogleRedirectUri(req));

  if (!config) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_not_configured'));
    return;
  }

  if (!code || !state || !storedState || !verifier || state !== storedState) {
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_oauth_state_failed'));
    return;
  }

  try {
    const tokenSet = await exchangeGoogleCode(config, code, verifier);
    const profile = await fetchGoogleProfile(tokenSet.access_token);
    if (!profile.email) {
      res.redirect(302, addQueryParam(returnTo, 'authError', 'google_email_missing'));
      return;
    }
    if (profile.email_verified === false) {
      res.redirect(302, addQueryParam(returnTo, 'authError', 'google_email_unverified'));
      return;
    }

    const user = store.upsertGoogleUser({
      email: profile.email,
      displayName: profile.name ?? profile.email.split('@')[0] ?? 'Google User',
      googleSubject: profile.sub
    });
    if (isUserDisabled(user)) {
      writeSecurityAuditLog(req, {
        action: 'auth.google.disabled',
        targetUserId: user.id,
        details: { email: user.email }
      });
      res.redirect(302, addQueryParam(returnTo, 'authError', 'account_disabled'));
      return;
    }
    const token = createSessionToken();
    const csrfToken = createSessionToken();
    store.markUserLoggedIn(user.id);
    store.createSession(user.id, hashSessionToken(token), AUTH_SESSION_TTL_MS, hashSessionToken(csrfToken));
    writeSecurityAuditLog(req, {
      action: 'auth.google.success',
      targetUserId: user.id,
      details: { email: user.email }
    });
    appendSetCookie(res, buildSessionCookie(token, secureCookies));
    res.redirect(302, addQueryParam(returnTo, 'authProvider', 'google'));
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    res.redirect(302, addQueryParam(returnTo, 'authError', 'google_oauth_failed'));
  }
});

  return app;
}
