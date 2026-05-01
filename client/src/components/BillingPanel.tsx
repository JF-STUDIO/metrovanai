import { formatDate, formatUsd } from '../app-utils';
import type { ReactNode } from 'react';
import type { UiLocale } from '../app-copy';
import type { BillingEntry, BillingPackage, BillingSummary, PaymentOrderRecord } from '../types';

interface BillingPanelCopy {
  authWorking: string;
  billingChargedTotal: string;
  billingCurrentBalance: string;
  billingHint: string;
  billingOpenRecharge: string;
  billingTitle: string;
  billingTopUpTotal: string;
  close: string;
  noBilling: string;
  noBillingHint: string;
  recentBilling: string;
  recentBillingHint: string;
  rechargeCouponLabel: string;
  rechargeCouponPlaceholder: string;
  rechargeCustomInvalid: string;
  rechargeCustomLabel: string;
  rechargeCustomPlaceholder: string;
  rechargeCustomSummary: string;
  rechargeCustomTitle: string;
  rechargeHint: string;
  rechargePayNow: string;
  rechargeReceive: string;
  rechargeRedeemCode: string;
  rechargeSave: string;
  rechargeTitle: string;
  rechargeYouPay: string;
  topUpRedirecting: string;
  stripePaymentSuccessBody: string;
  stripePaymentSuccessTitle: string;
}

interface BillingPanelProps {
  billingOpen: boolean;
  billingBusy: boolean;
  billingModalMode: 'topup' | 'billing';
  copy: BillingPanelCopy;
  billingSummary: BillingSummary | null;
  locale: UiLocale;
  latestPaidStripeOrder: PaymentOrderRecord | null | undefined;
  renderStripeDocumentLinks: (order: PaymentOrderRecord | null | undefined, compact?: boolean) => ReactNode;
  openRecharge: () => void;
  billingEntries: BillingEntry[];
  billingOrders: PaymentOrderRecord[];
  setBillingOpen: (open: boolean) => void;
  rechargeOpen: boolean;
  setRechargeOpen: (open: boolean) => void;
  setRechargeMessage: (message: string) => void;
  rechargeActivationCode: string;
  setRechargeActivationCode: (code: string) => void;
  rechargeMessage: string;
  handleRedeemActivationCode: () => Promise<void>;
  customRechargeIsActive: boolean;
  customRechargeAmount: string;
  setCustomRechargeAmount: (amount: string) => void;
  customRechargeAmountUsd: number | null;
  customRechargePoints: number;
  billingPackages: BillingPackage[];
  activeBillingPackageId: string | null;
  setSelectedBillingPackageId: (id: string) => void;
  selectedBillingPackage: BillingPackage | null;
  handleTopUp: () => Promise<void>;
}

export function BillingPanel(props: BillingPanelProps) {
  const {
    billingOpen,
    billingBusy,
    billingModalMode,
    copy,
    billingSummary,
    locale,
    latestPaidStripeOrder,
    renderStripeDocumentLinks,
    openRecharge,
    billingEntries,
    billingOrders,
    setBillingOpen,
    rechargeOpen,
    setRechargeOpen,
    setRechargeMessage,
    rechargeActivationCode,
    setRechargeActivationCode,
    rechargeMessage,
    handleRedeemActivationCode,
    customRechargeIsActive,
    customRechargeAmount,
    setCustomRechargeAmount,
    customRechargeAmountUsd,
    customRechargePoints,
    billingPackages,
    activeBillingPackageId,
    setSelectedBillingPackageId,
    selectedBillingPackage,
    handleTopUp
  } = props;

  return (
    <>
      {billingOpen && (
        <div className="modal-backdrop" onClick={() => !billingBusy && setBillingOpen(false)}>
          <div className="modal-card billing-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{billingModalMode === 'topup' ? copy.rechargeTitle : copy.billingTitle}</strong>
                <span className="muted">{billingModalMode === 'topup' ? copy.rechargeHint : copy.billingHint}</span>
              </div>
              <button className="close-button" type="button" onClick={() => setBillingOpen(false)} disabled={billingBusy}>
                ×
              </button>
            </div>

            <div className="billing-summary-grid">
              <article className="billing-stat-card">
                <span>{copy.billingCurrentBalance}</span>
                <strong>{billingSummary?.availablePoints ?? 0} pts</strong>
              </article>
              <article className="billing-stat-card">
                <span>{copy.billingTopUpTotal}</span>
                <strong>{formatUsd(billingSummary?.totalTopUpUsd ?? 0, locale)}</strong>
              </article>
              <article className="billing-stat-card">
                <span>{copy.billingChargedTotal}</span>
                <strong>{billingSummary?.totalChargedPoints ?? 0} pts</strong>
              </article>
            </div>

            {billingModalMode === 'billing' && latestPaidStripeOrder && (
              <div className="stripe-success-panel">
                <div className="stripe-success-copy">
                  <span className="stripe-badge">Stripe</span>
                  <strong>{copy.stripePaymentSuccessTitle}</strong>
                  <span>{copy.stripePaymentSuccessBody}</span>
                  <em>
                    {formatUsd(latestPaidStripeOrder.amountUsd, locale)} · {latestPaidStripeOrder.points} pts ·{' '}
                    {formatDate(latestPaidStripeOrder.paidAt ?? latestPaidStripeOrder.createdAt, locale)}
                  </em>
                </div>
                {renderStripeDocumentLinks(latestPaidStripeOrder)}
              </div>
            )}

            <div className="billing-recharge-bar">
              <div>
                <strong>{copy.billingOpenRecharge}</strong>
                <span className="muted">{copy.rechargeHint}</span>
              </div>
              <button className="solid-button small" type="button" onClick={openRecharge} disabled={billingBusy}>
                {copy.billingOpenRecharge}
              </button>
            </div>

            {billingModalMode === 'billing' && (
              <div className="billing-entry-panel">
                <div className="panel-head compact">
                  <div>
                    <strong>{copy.recentBilling}</strong>
                    <span className="muted">{copy.recentBillingHint}</span>
                  </div>
                </div>
                {billingEntries.length ? (
                  <div className="billing-entry-list">
                    {billingEntries.slice(0, 8).map((entry) => {
                      const stripeOrder = billingOrders.find((order) => order.billingEntryId === entry.id && order.status === 'paid');
                      return (
                        <article key={entry.id} className="billing-entry-row">
                          <div>
                            <strong>{entry.note}</strong>
                            <span>{formatDate(entry.createdAt, locale)}</span>
                            {stripeOrder ? renderStripeDocumentLinks(stripeOrder, true) : null}
                          </div>
                          <div className={`billing-entry-amount ${entry.type === 'credit' ? 'credit' : 'charge'}`}>
                            <strong>
                              {entry.type === 'credit' ? '+' : '-'}
                              {entry.points} pts
                            </strong>
                            <span>{formatUsd(entry.amountUsd, locale)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state billing-empty-state">
                    <strong>{copy.noBilling}</strong>
                    <span>{copy.noBillingHint}</span>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setBillingOpen(false)} disabled={billingBusy}>
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {rechargeOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (billingBusy) {
              return;
            }
            setRechargeOpen(false);
            setRechargeMessage('');
          }}
        >
          <div className="modal-card recharge-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{copy.rechargeTitle}</strong>
                <span className="muted">{copy.rechargeHint}</span>
              </div>
              <button
                className="close-button"
                type="button"
                onClick={() => {
                  setRechargeOpen(false);
                  setRechargeMessage('');
                }}
                disabled={billingBusy}
              >
                ×
              </button>
            </div>

            <div className="recharge-offer-panel recharge-compact-panel">
              <label className="recharge-code-field">
                <span>{copy.rechargeCouponLabel}</span>
                <div className="recharge-inline-control">
                  <input
                    value={rechargeActivationCode}
                    onChange={(event) => {
                      setRechargeActivationCode(event.target.value.toUpperCase());
                      if (rechargeMessage) {
                        setRechargeMessage('');
                      }
                    }}
                    placeholder={copy.rechargeCouponPlaceholder}
                    disabled={billingBusy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => void handleRedeemActivationCode()}
                    disabled={billingBusy || !rechargeActivationCode.trim()}
                  >
                    {billingBusy ? copy.authWorking : copy.rechargeRedeemCode}
                  </button>
                </div>
              </label>
              {rechargeMessage && <div className="auth-feedback settings-feedback">{rechargeMessage}</div>}
            </div>

            <div className={`recharge-custom-panel recharge-compact-panel${customRechargeIsActive ? ' active' : ''}`}>
              <label className="recharge-code-field">
                <span>{copy.rechargeCustomLabel}</span>
                <div className="recharge-inline-control">
                  <input
                    value={customRechargeAmount}
                    onChange={(event) => {
                      setCustomRechargeAmount(event.target.value);
                      if (rechargeMessage) {
                        setRechargeMessage('');
                      }
                    }}
                    placeholder={copy.rechargeCustomPlaceholder}
                    disabled={billingBusy}
                    inputMode="decimal"
                  />
                  <span className="recharge-inline-preview">
                    {customRechargeAmountUsd ? `${customRechargePoints} pts` : copy.rechargeCustomTitle}
                  </span>
                </div>
              </label>
            </div>

            <div className="billing-package-grid recharge-package-grid">
              {billingPackages.map((billingPackage) => (
                <button
                  key={billingPackage.id}
                  className={`billing-package-card recharge-package-card${!customRechargeIsActive && activeBillingPackageId === billingPackage.id ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setCustomRechargeAmount('');
                    setSelectedBillingPackageId(billingPackage.id);
                  }}
                  disabled={billingBusy}
                >
                  <div className="recharge-package-head">
                    <span>{billingPackage.name}</span>
                    <em>{copy.rechargeSave} {billingPackage.discountPercent}%</em>
                  </div>
                  <strong className="recharge-package-points">{billingPackage.points} pts</strong>
                  <span className="recharge-package-price">{formatUsd(billingPackage.amountUsd, locale)}</span>
                </button>
              ))}
            </div>

            {(customRechargeIsActive || selectedBillingPackage) && (
              <div className="recharge-summary-card recharge-compact-summary">
                <div>
                  <strong>{customRechargeIsActive ? copy.rechargeCustomSummary : selectedBillingPackage?.name}</strong>
                  <span className="muted">
                    {customRechargeIsActive
                      ? customRechargeAmountUsd
                        ? `${copy.rechargeYouPay} ${formatUsd(customRechargeAmountUsd, locale)} · ${copy.rechargeReceive} ${customRechargePoints} pts`
                        : copy.rechargeCustomInvalid
                      : `${copy.rechargeYouPay} ${formatUsd(selectedBillingPackage!.amountUsd, locale)} · ${copy.rechargeReceive} ${selectedBillingPackage!.points} pts`}
                  </span>
                  {rechargeActivationCode.trim() && <span className="muted">{copy.rechargeCouponLabel}: {rechargeActivationCode.trim()}</span>}
                </div>
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => void handleTopUp()}
                  disabled={billingBusy || (customRechargeIsActive && customRechargeAmountUsd === null)}
                >
                  {billingBusy ? copy.topUpRedirecting : copy.rechargePayNow}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
