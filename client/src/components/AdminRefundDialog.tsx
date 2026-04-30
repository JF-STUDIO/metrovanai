import type { UiLocale } from '../app-copy';
import { formatUsd } from '../app-utils';
import type { PaymentOrderRecord, PaymentOrderRefundPreview } from '../types';

interface AdminRefundDialogProps {
  order: PaymentOrderRecord;
  preview: PaymentOrderRefundPreview;
  busy: boolean;
  locale: UiLocale;
  onClose: () => void;
  onConfirm: () => void;
}

export function AdminRefundDialog({ order, preview, busy, locale, onClose, onConfirm }: AdminRefundDialogProps) {
  return (
    <div className="modal-backdrop admin-refund-backdrop" onClick={onClose}>
      <div className="modal-card admin-refund-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <strong>退款订单</strong>
            <span className="muted">
              #{order.id} · {order.email}
            </span>
          </div>
          <button className="close-button" type="button" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className="admin-refund-grid">
          <article>
            <span>订单金额</span>
            <strong>{formatUsd(preview.orderAmountUsd, locale)}</strong>
          </article>
          <article>
            <span>到账积分</span>
            <strong>{preview.creditedPoints.toLocaleString()} pts</strong>
          </article>
          <article>
            <span>已消费积分</span>
            <strong>{preview.consumedPoints.toLocaleString()} pts</strong>
          </article>
          <article>
            <span>可退金额</span>
            <strong>{formatUsd(preview.refundableAmountUsd, locale)}</strong>
          </article>
          <article>
            <span>退款后余额</span>
            <strong className={preview.balanceAfterRefund < 0 ? 'danger-text' : ''}>
              {preview.balanceAfterRefund.toLocaleString()} pts
            </strong>
          </article>
        </div>
        <p className="admin-refund-note">
          确认后会先调用 Stripe Refund API。Stripe 返回成功后，系统再写入积分扣回流水；如果余额不足，会显示为负债并抵扣后续充值。
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? '退款中...' : '确认 Stripe 退款并扣回积分'}
          </button>
        </div>
      </div>
    </div>
  );
}
