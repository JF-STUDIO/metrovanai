import type { ReactNode } from 'react';

interface AdminPlansConfigPageProps {
  adminOrders: any[];
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminPlanDraft: any;
  adminPlanEditorOpen: boolean;
  adminSystemBusy: boolean;
  adminTotals: { users: number };
  onClosePlanEditor: () => void;
  onEditPlanPackage: (plan: any) => void;
  onLoadSystemSettings: () => void | Promise<void>;
  onOpenNewPlanPackage: () => void;
  onPlanDraftChange: (updater: any) => void;
  onSavePlanPackage: () => void | Promise<void>;
  paidOrders: any[];
  planPackages: any[];
}

export function AdminPlansConfigPage({
  adminOrders,
  adminPageTitle,
  adminPlanDraft,
  adminPlanEditorOpen,
  adminSystemBusy,
  adminTotals,
  onClosePlanEditor,
  onEditPlanPackage,
  onLoadSystemSettings,
  onOpenNewPlanPackage,
  onPlanDraftChange,
  onSavePlanPackage,
  paidOrders,
  planPackages
}: AdminPlansConfigPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '套餐配置',
        <>编辑前台 Plans 页展示的 <span className="mono accent-text">{planPackages.length}</span> 档套餐 · 改动会即时生效</>,
        <>
          <button className="btn btn-ghost" type="button" onClick={() => void onLoadSystemSettings()} disabled={adminSystemBusy}>
            {adminSystemBusy ? '刷新中...' : '刷新套餐'}
          </button>
          <button className="btn btn-primary" type="button" onClick={onOpenNewPlanPackage} disabled={adminSystemBusy}>+ 新增套餐</button>
        </>
      )}
      <div className="plans-grid">
        {planPackages.map((plan, index) => (
          <div key={plan.id} className={`plan-card${index === 1 ? ' featured' : ''}`}>
            <div className="plan-tag">Tier {String(index + 1).padStart(2, '0')}{index === 1 ? ' · Best Value' : ''}</div>
            <div className="plan-name">{plan.name}</div>
            <div className="plan-price">${plan.amountUsd.toFixed(0)}<span className="small">/次</span></div>
            <div className="plan-credits">{plan.points} 积分 · 优惠 {plan.discountPercent}%</div>
            <ul className="plan-features">
              <li>{plan.points} 张约可处理照片</li>
              <li>Stripe 充值订单</li>
              <li>激活码折扣可叠加</li>
              <li>自动到账积分</li>
            </ul>
            <button className="plan-edit-btn" type="button" onClick={() => onEditPlanPackage(plan)}>编辑套餐</button>
          </div>
        ))}
        {!planPackages.length && <div className="empty-tip">暂无套餐数据</div>}
      </div>
      {adminPlanEditorOpen ? (
        <div className="card admin-inline-editor">
          <div className="card-header">
            <h3>套餐设置</h3>
            <button className="tbl-icon" type="button" onClick={onClosePlanEditor}>×</button>
          </div>
          <div className="admin-form-grid">
            <label>
              <span>套餐 ID</span>
              <input value={adminPlanDraft.id} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, id: event.target.value }))} />
            </label>
            <label>
              <span>套餐名称</span>
              <input value={adminPlanDraft.name} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              <span>实付金额 USD</span>
              <input type="number" min="1" value={adminPlanDraft.amountUsd} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, amountUsd: event.target.value }))} />
            </label>
            <label>
              <span>到账积分</span>
              <input type="number" min="1" value={adminPlanDraft.points} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, points: event.target.value }))} />
            </label>
            <label>
              <span>显示优惠 %</span>
              <input type="number" min="0" max="100" value={adminPlanDraft.discountPercent} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, discountPercent: event.target.value }))} />
            </label>
            <label>
              <span>原价 USD</span>
              <input type="number" min="1" value={adminPlanDraft.listPriceUsd} onChange={(event) => onPlanDraftChange((current: any) => ({ ...current, listPriceUsd: event.target.value }))} />
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="btn btn-ghost" type="button" onClick={onClosePlanEditor}>取消</button>
            <button className="btn btn-primary" type="button" onClick={() => void onSavePlanPackage()} disabled={adminSystemBusy}>
              {adminSystemBusy ? '保存中...' : '保存套餐'}
            </button>
          </div>
        </div>
      ) : null}
      <div className="card">
        <div className="card-header">
          <h3>套餐转化漏斗</h3>
          <span className="chart-range-label">固定展示最近 30 天</span>
        </div>
        <div className="admin-console-metrics card-body">
          <div><span>访问 Plans</span><strong>{(adminTotals.users * 2 || 0).toLocaleString()}</strong></div>
          <div><span>点击购买</span><strong>{adminOrders.length.toLocaleString()}</strong></div>
          <div><span>完成支付</span><strong>{paidOrders.length.toLocaleString()}</strong></div>
        </div>
      </div>
    </div>
  );
}
