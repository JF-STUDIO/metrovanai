import type { ReactNode } from 'react';

interface AdminBillingLedgerPageProps {
  adminBillingLedgerSearch: string;
  adminBillingUserTotal: number;
  adminBillingUserTotals: {
    availablePoints: number;
    profitUsd: number;
    remainingCreditCostUsd: number;
    runningHubCostUsd: number;
    runningHubRuns: number;
    totalPaidUsd: number;
  };
  adminBillingUserUnitUsd: number;
  adminBillingUsers: any[];
  adminBillingUsersBusy: boolean;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  getAdminInitials: (value: string) => string;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onExportUsersCSV: () => void | Promise<void>;
  onLoadBillingUsers: () => void | Promise<void>;
  onOpenUserBilling: (userId: string) => void | Promise<void>;
  onSearchChange: (value: string) => void;
  userAvatarClass: (index: number) => string;
}

export function AdminBillingLedgerPage({
  adminBillingLedgerSearch,
  adminBillingUserTotal,
  adminBillingUserTotals,
  adminBillingUserUnitUsd,
  adminBillingUsers,
  adminBillingUsersBusy,
  adminPageTitle,
  getAdminInitials,
  kpi,
  onExportUsersCSV,
  onLoadBillingUsers,
  onOpenUserBilling,
  onSearchChange,
  userAvatarClass
}: AdminBillingLedgerPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '用户账单',
        <>按用户汇总充值、积分、云端处理成本和利润 · 当前匹配 <span className="mono accent-text">{adminBillingUserTotal.toLocaleString()}</span> 人</>,
        <>
          <button className="btn btn-ghost" type="button" onClick={() => void onExportUsersCSV()} disabled={adminBillingUsersBusy || !adminBillingUserTotal}>
            导出 CSV
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void onLoadBillingUsers()} disabled={adminBillingUsersBusy}>
            {adminBillingUsersBusy ? '查询中...' : '查询用户账单'}
          </button>
        </>
      )}
      <div className="kpi-grid">
        {kpi('充值金额', <>${adminBillingUserTotals.totalPaidUsd.toFixed(2)}</>, <span>实收现金</span>)}
        {kpi('云端处理成本', <>${adminBillingUserTotals.runningHubCostUsd.toFixed(2)}</>, <span>{adminBillingUserTotals.runningHubRuns.toLocaleString()} × ${adminBillingUserUnitUsd.toFixed(2)}</span>, adminBillingUserTotals.runningHubCostUsd ? 'down' : 'up')}
        {kpi('剩余积分成本', <>${adminBillingUserTotals.remainingCreditCostUsd.toFixed(2)}</>, <span>{adminBillingUserTotals.availablePoints.toLocaleString()} × ${adminBillingUserUnitUsd.toFixed(2)}</span>, adminBillingUserTotals.remainingCreditCostUsd ? 'down' : 'up')}
        {kpi('保守利润', <>${adminBillingUserTotals.profitUsd.toFixed(2)}</>, <span>充值 - 已用成本 - 剩余成本</span>, adminBillingUserTotals.profitUsd < 0 ? 'down' : 'up')}
      </div>
      <div className="card">
        <div className="toolbar">
          <input
            value={adminBillingLedgerSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onLoadBillingUsers();
            }}
            placeholder="搜索邮箱 / 用户名 / userKey"
          />
        </div>
        <div className="admin-health-ok">
          保守利润按实际充值金额 - 当前云端调用次数 × $0.07 - 剩余积分 × $0.07 计算；重试和重修会继续增加实际成本。
        </div>
        {adminBillingUsers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>充值</th>
                  <th>积分</th>
                  <th>云端调用</th>
                  <th>成本</th>
                  <th>剩余成本</th>
                  <th>利润</th>
                  <th>项目 / 结果</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {adminBillingUsers.map((row, index) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="user-cell">
                        <div className={userAvatarClass(index)}>{getAdminInitials(row.userDisplayName || row.userEmail)}</div>
                        <div>
                          <div className="name">{row.userDisplayName}</div>
                          <div className="email">{row.userEmail || row.userKey}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">${row.totalPaidUsd.toFixed(2)}</td>
                    <td>
                      <div className="admin-status-stack">
                        <span className="mono">剩 {row.availablePoints.toLocaleString()} pts</span>
                        <small>获 {row.totalGrantedPoints.toLocaleString()} · 用 {row.totalChargedPoints.toLocaleString()}</small>
                      </div>
                    </td>
                    <td className="mono">{row.runningHubRuns.toLocaleString()} 次 <span className="text-muted">({row.workflowRuns}+{row.regenerationRuns})</span></td>
                    <td className="mono">${row.runningHubCostUsd.toFixed(2)}</td>
                    <td className="mono">${row.remainingCreditCostUsd.toFixed(2)}</td>
                    <td className={row.profitUsd < 0 ? 'mono danger-text' : 'mono accent-text'}>${row.profitUsd.toFixed(2)}</td>
                    <td className="mono">{row.projectCount} / {row.resultCount}</td>
                    <td>
                      <button className="tbl-icon tbl-icon-text" type="button" onClick={() => void onOpenUserBilling(row.userId)} title="查看用户明细">
                        账
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">{adminBillingUsersBusy ? '正在查询用户账单...' : '没有匹配的用户账单。'}</div>
        )}
      </div>
    </div>
  );
}
