import type { ReactNode } from 'react';

interface AdminProjectCostsPageProps {
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminProjectCostDatePreset: string;
  adminProjectCostEndDate: string;
  adminProjectCostSearch: string;
  adminProjectCostStartDate: string;
  adminProjectCostTotal: number;
  adminProjectCostTotals: {
    cashRevenueUsd: number;
    listRevenueUsd: number;
    netPoints: number;
    profitUsd: number;
    projects: number;
    runningHubCostUsd: number;
    runningHubRuns: number;
  };
  adminProjectCostUnitUsd: number;
  adminProjectCosts: any[];
  adminProjectCostsBusy: boolean;
  formatAdminShortDate: (value: string | null) => string;
  getAdminInitials: (value: string) => string;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onDatePresetChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onLoadProjectCosts: () => void | Promise<void>;
  onSearchChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  userAvatarClass: (index: number) => string;
}

export function AdminProjectCostsPage({
  adminPageTitle,
  adminProjectCostDatePreset,
  adminProjectCostEndDate,
  adminProjectCostSearch,
  adminProjectCostStartDate,
  adminProjectCostTotal,
  adminProjectCostTotals,
  adminProjectCostUnitUsd,
  adminProjectCosts,
  adminProjectCostsBusy,
  formatAdminShortDate,
  getAdminInitials,
  kpi,
  onDatePresetChange,
  onEndDateChange,
  onLoadProjectCosts,
  onSearchChange,
  onStartDateChange,
  userAvatarClass
}: AdminProjectCostsPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '成本利润',
        <>当前匹配 <span className="mono accent-text">{adminProjectCostTotal.toLocaleString()}</span> 项 · 云端单次成本 <span className="mono accent-text">${adminProjectCostUnitUsd.toFixed(2)}</span></>,
        <button className="btn btn-primary" type="button" onClick={() => void onLoadProjectCosts()} disabled={adminProjectCostsBusy}>
          {adminProjectCostsBusy ? '查询中...' : '查询成本'}
        </button>
      )}
      <div className="kpi-grid">
        {kpi('实收估算', <>${adminProjectCostTotals.cashRevenueUsd.toFixed(2)}</>, <span>{adminProjectCostTotals.netPoints.toLocaleString()} pts</span>)}
        {kpi('扣点标价', <>${adminProjectCostTotals.listRevenueUsd.toFixed(2)}</>, <span>$0.25 / pt</span>)}
        {kpi('云端调用次数', <>{adminProjectCostTotals.runningHubRuns.toLocaleString()}<span className="unit">次</span></>, <span>含重试/重修</span>)}
        {kpi('云端处理成本', <>${adminProjectCostTotals.runningHubCostUsd.toFixed(2)}</>, <span>$0.07 / 次</span>, adminProjectCostTotals.runningHubCostUsd ? 'down' : 'up')}
        {kpi('估算利润', <>${adminProjectCostTotals.profitUsd.toFixed(2)}</>, <span>{adminProjectCostTotals.projects.toLocaleString()} 项</span>, adminProjectCostTotals.profitUsd < 0 ? 'down' : 'up')}
      </div>
      <div className="card">
        <div className="toolbar">
          <input
            value={adminProjectCostSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onLoadProjectCosts();
            }}
            placeholder="搜索用户 / 邮箱 / 项目名 / 项目ID"
          />
          <select value={adminProjectCostDatePreset} onChange={(event) => onDatePresetChange(event.target.value)}>
            <option value="30d">最近 30 天</option>
            <option value="today">今天</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
            <option value="all">全部日期</option>
            <option value="custom">自定义日期</option>
          </select>
          {adminProjectCostDatePreset === 'custom' ? (
            <>
              <input type="date" value={adminProjectCostStartDate} onChange={(event) => onStartDateChange(event.target.value)} aria-label="成本开始日期" />
              <input type="date" value={adminProjectCostEndDate} onChange={(event) => onEndDateChange(event.target.value)} aria-label="成本结束日期" />
            </>
          ) : null}
        </div>
        <div className="admin-health-ok">
          实收估算按用户已充值金额 / 非项目到账积分的平均点价计算，后台赠送和重修退回会摊低点价；扣点标价按 $0.25/pt 显示。
        </div>
        <div className="admin-health-ok">
          新任务会记录每次云端处理进入次数；历史项目若早期没有保存尝试次数，会按当前可见任务计算最低成本。
        </div>
        {adminProjectCosts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>用户</th>
                  <th>照片 / 结果</th>
                  <th>实收 / 标价</th>
                  <th>云端调用</th>
                  <th>成本</th>
                  <th>利润</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {adminProjectCosts.map((row, index) => (
                  <tr key={row.projectId}>
                    <td>
                      <div className="admin-status-stack">
                        <span>{row.projectName}</span>
                        <small>{row.status} · {row.projectId}</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-cell">
                        <div className={userAvatarClass(index)}>{getAdminInitials(row.userDisplayName || row.userKey)}</div>
                        <div><div className="name">{row.userDisplayName}</div><div className="email">{row.userKey}</div></div>
                      </div>
                    </td>
                    <td className="mono">{row.photoCount} / {row.resultCount}</td>
                    <td>
                      <div className="admin-status-stack">
                        <span className="mono">${row.cashRevenueUsd.toFixed(2)} · {row.netPoints} pts</span>
                        <small>${row.userPaidUsd.toFixed(2)} / {row.userGrantedPoints.toLocaleString()} pts = ${row.blendedPointPriceUsd.toFixed(4)}/pt</small>
                        <small>${row.listRevenueUsd.toFixed(2)} 标价</small>
                      </div>
                    </td>
                    <td className="mono">{row.runningHubRuns} 次 <span className="text-muted">({row.workflowRuns}+{row.regenerationRuns})</span></td>
                    <td className="mono">${row.runningHubCostUsd.toFixed(2)}</td>
                    <td className={row.profitUsd < 0 ? 'mono danger-text' : 'mono accent-text'}>${row.profitUsd.toFixed(2)}</td>
                    <td className="cell-id">{formatAdminShortDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">{adminProjectCostsBusy ? '正在读取项目成本...' : '暂无项目成本数据。'}</div>
        )}
      </div>
    </div>
  );
}
