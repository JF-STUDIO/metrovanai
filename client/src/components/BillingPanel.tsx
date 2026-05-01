import { formatUsd } from '../app-utils';
import type { UiLocale } from '../app-copy';
import type { BillingPackage, BillingSummary } from '../types';

interface BillingPanelCopy {
  authWorking: string;
  billingChargedTotal: string;
  billingCurrentBalance: string;
  billingHint: string;
  billingOpenRecharge: string;
  close: string;
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
}

interface BillingPanelProps {
  billingOpen: boolean;
  billingBusy: boolean;
  billingModalMode: 'topup' | 'billing';
  copy: BillingPanelCopy;
  billingSummary: BillingSummary | null;
  locale: UiLocale;
  openRecharge: () => void;
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
    billingBusy,
    copy,
    locale,
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
