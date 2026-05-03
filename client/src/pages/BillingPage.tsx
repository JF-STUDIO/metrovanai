import logoMark from '../assets/metrovan-logo-mark.webp';

interface BillingPageProps {
  billingBusy: boolean;
  billingEntries: any[];
  billingOrders: any[];
  billingSummary: any;
  billingUsageExpanded: boolean;
  copy: any;
  formatDate: (value: string, locale: any) => string;
  formatPaymentOrderStatus: (status: any) => string;
  formatUsd: (value: number, locale: any) => string;
  isAdminBillingAdjustmentEntry: (entry: any) => boolean;
  locale: any;
  message: string;
  navigateToRoute: (route: 'studio') => void;
  openRecharge: () => void;
  rechargeLayer: any;
  setBillingUsageExpanded: (updater: (current: boolean) => boolean) => void;
}

function renderStripeInvoiceLink(order: any, copy: any) {
  const url = order?.stripeInvoicePdfUrl || order?.stripeInvoiceUrl;
  if (!url) {
    return <span className="stripe-doc-pending">{copy.stripeDocumentsPending}</span>;
  }

  return (
    <a className="ghost-button small stripe-doc-link" href={url} target="_blank" rel="noreferrer">
      {copy.stripeInvoiceLink}
    </a>
  );
}

export function BillingPage({
  billingBusy,
  billingEntries,
  billingOrders,
  billingSummary,
  billingUsageExpanded,
  copy,
  formatDate,
  formatPaymentOrderStatus,
  formatUsd,
  isAdminBillingAdjustmentEntry,
  locale,
  message,
  navigateToRoute,
  openRecharge,
  rechargeLayer,
  setBillingUsageExpanded
}: BillingPageProps) {
  const usageEntries = billingEntries.filter((entry) => entry.type === 'charge' && !isAdminBillingAdjustmentEntry(entry));
  const paidOrders = billingOrders.filter((order) => order.status === 'paid' || order.status === 'refunded');

  return (
    <>
      <main className="billing-page studio-shell">
        <div className="ambient-layer studio-ambient" />
        <header className="studio-header billing-page-header">
          <button className="brand-button" type="button" onClick={() => navigateToRoute('studio')}>
            <span className="studio-brand-mark-shell" aria-hidden="true">
              <img className="studio-brand-mark" src={logoMark} alt="Metrovan AI" decoding="async" />
            </span>
            <span className="brand-copy">
              <strong>{copy.studioLabel}</strong>
              <em>{copy.billingTitle}</em>
            </span>
          </button>
          <div className="header-actions billing-page-actions">
            <button className="ghost-button" type="button" onClick={() => navigateToRoute('studio')}>
              {locale === 'en' ? 'Back to studio' : '返回工作台'}
            </button>
            <button className="solid-button small" type="button" onClick={openRecharge} disabled={billingBusy}>
              {copy.billingOpenRecharge}
            </button>
          </div>
        </header>

        {message ? <div className="global-message">{message}</div> : null}

        <section className="workspace billing-page-workspace">
          <div className="billing-page-hero">
            <div>
              <span className="eyebrow">{locale === 'en' ? 'Credits & payments' : '积分和付款'}</span>
              <h1>{copy.billingTitle}</h1>
              <p>{copy.billingHint}</p>
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
          </div>

          <div className="billing-page-grid">
            <article className="billing-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Balance check' : '余额核对'}</strong>
                  <span className="muted">{locale === 'en' ? 'Credits in - credits used = balance.' : '入账积分 - 扣点积分 = 当前余额。'}</span>
                </div>
              </div>
              <div className="billing-summary-grid">
                <article className="billing-stat-card">
                  <span>{locale === 'en' ? 'Credits in' : '入账积分'}</span>
                  <strong>{billingSummary?.totalCreditedPoints ?? 0} pts</strong>
                </article>
                <article className="billing-stat-card">
                  <span>{locale === 'en' ? 'Credits used' : '扣点积分'}</span>
                  <strong>{billingSummary?.totalChargedPoints ?? 0} pts</strong>
                </article>
                <article className="billing-stat-card">
                  <span>{copy.billingCurrentBalance}</span>
                  <strong>{billingSummary?.availablePoints ?? 0} pts</strong>
                </article>
              </div>
            </article>

            <article className="billing-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Credit usage' : '积分使用情况'}</strong>
                  <span className="muted">
                    {usageEntries.length
                      ? locale === 'en'
                        ? `${usageEntries.length} records.`
                        : `${usageEntries.length} 条扣点记录，默认收起，打开后查看明细。`
                      : locale === 'en'
                        ? 'No records.'
                        : '暂无记录。'}
                  </span>
                </div>
                {usageEntries.length ? (
                  <button className="ghost-button small" type="button" onClick={() => setBillingUsageExpanded((current) => !current)}>
                    {billingUsageExpanded ? (locale === 'en' ? 'Hide details' : '收起明细') : locale === 'en' ? 'View details' : '展开明细'}
                  </button>
                ) : null}
              </div>
              {usageEntries.length ? (
                billingUsageExpanded ? (
                  <div className="billing-entry-list">
                    {usageEntries.map((entry) => (
                      <article key={entry.id} className="billing-entry-row">
                        <div>
                          <strong>{entry.projectName || entry.note}</strong>
                          <span>{entry.note} · {formatDate(entry.createdAt, locale)}</span>
                        </div>
                        <div className="billing-entry-amount charge">
                          <strong>-{entry.points} pts</strong>
                          <span>{formatUsd(entry.amountUsd, locale)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null
              ) : (
                <div className="empty-state billing-empty-state">
                  <strong>{locale === 'en' ? 'No credit usage yet' : '暂无积分使用记录'}</strong>
                </div>
              )}
            </article>

            <article className="billing-section billing-recharge-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Recharge records' : '充值记录'}</strong>
                  <span className="muted">{locale === 'en' ? 'Amount and Stripe invoice.' : '每次充值金额和 Invoice。'}</span>
                </div>
              </div>
              {paidOrders.length ? (
                <div className="billing-entry-list">
                  {paidOrders.map((order) => (
                    <article key={order.id} className="billing-entry-row billing-recharge-row">
                      <div>
                        <strong>{formatUsd(order.amountUsd, locale)}</strong>
                        <span>
                          {order.packageName} · {order.points} pts · {formatPaymentOrderStatus(order.status)} · {formatDate(order.paidAt ?? order.createdAt, locale)}
                        </span>
                      </div>
                      <div className="billing-entry-amount credit">
                        <strong>+{order.points} pts</strong>
                        <span>{formatUsd(order.amountUsd, locale)}</span>
                        {renderStripeInvoiceLink(order, copy)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state billing-empty-state">
                  <strong>{locale === 'en' ? 'No recharge records yet' : '暂无充值记录'}</strong>
                  <span>{copy.noBillingHint}</span>
                </div>
              )}
            </article>
          </div>
        </section>
      </main>
      {rechargeLayer}
    </>
  );
}
