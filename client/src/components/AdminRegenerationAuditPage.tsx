import type { ReactNode } from 'react';

interface AdminRegenerationAuditPageProps {
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminRegenerationAudit: any[];
  adminRegenerationAuditBusy: boolean;
  adminRegenerationAuditMode: string;
  adminRegenerationAuditSearch: string;
  adminRegenerationAuditTotal: number;
  adminRegenerationAuditTotals: {
    overchargedPoints: number;
    overchargedProjects: number;
    projects: number;
    underchargedPoints: number;
    underchargedProjects: number;
  };
  formatAdminShortDate: (value: string | null) => string;
  getAdminInitials: (value: string) => string;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onLoadRegenerationAudit: () => void | Promise<void>;
  onModeChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  userAvatarClass: (index: number) => string;
}

export function AdminRegenerationAuditPage({
  adminPageTitle,
  adminRegenerationAudit,
  adminRegenerationAuditBusy,
  adminRegenerationAuditMode,
  adminRegenerationAuditSearch,
  adminRegenerationAuditTotal,
  adminRegenerationAuditTotals,
  formatAdminShortDate,
  getAdminInitials,
  kpi,
  onLoadRegenerationAudit,
  onModeChange,
  onSearchChange,
  userAvatarClass
}: AdminRegenerationAuditPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '重修审计',
        <>检查每项目前 10 次免费重修是否和账单一致 · 当前匹配 <span className="mono accent-text">{adminRegenerationAuditTotal.toLocaleString()}</span> 项</>,
        <button className="btn btn-primary" type="button" onClick={() => void onLoadRegenerationAudit()} disabled={adminRegenerationAuditBusy}>
          {adminRegenerationAuditBusy ? '查询中...' : '查询审计'}
        </button>
      )}
      <div className="kpi-grid">
        {kpi('异常项目', <>{adminRegenerationAuditTotals.projects.toLocaleString()}<span className="unit">项</span></>, <span>当前筛选</span>, adminRegenerationAuditTotals.projects ? 'down' : 'up')}
        {kpi('多扣项目', <>{adminRegenerationAuditTotals.overchargedProjects.toLocaleString()}<span className="unit">项</span></>, <span>{adminRegenerationAuditTotals.overchargedPoints.toLocaleString()} pts</span>, adminRegenerationAuditTotals.overchargedProjects ? 'down' : 'up')}
        {kpi('少扣项目', <>{adminRegenerationAuditTotals.underchargedProjects.toLocaleString()}<span className="unit">项</span></>, <span>{adminRegenerationAuditTotals.underchargedPoints.toLocaleString()} pts</span>)}
        {kpi('免费规则', <>10<span className="unit">次</span></>, <span>每个项目</span>)}
      </div>
      <div className="card">
        <div className="toolbar">
          <input
            value={adminRegenerationAuditSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onLoadRegenerationAudit();
            }}
            placeholder="搜索用户 / 邮箱 / 项目名 / 项目ID"
          />
          <select value={adminRegenerationAuditMode} onChange={(event) => onModeChange(event.target.value)}>
            <option value="mismatch">只看异常</option>
            <option value="overcharged">只看多扣</option>
            <option value="undercharged">只看少扣</option>
            <option value="all">全部项目</option>
          </select>
        </div>
        <div className="admin-health-ok">
          应收费 = max(已完成重修次数 - 免费次数, 0)。实际收费 = 重修扣费 - 重修退款。差额为正表示多扣，负数表示少扣。
        </div>
        {adminRegenerationAudit.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>用户</th>
                  <th>重修</th>
                  <th>应收费</th>
                  <th>实际收费</th>
                  <th>差额</th>
                  <th>状态</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {adminRegenerationAudit.map((row, index) => (
                  <tr key={row.projectId}>
                    <td>
                      <div className="admin-status-stack">
                        <span>{row.projectName}</span>
                        <small>{row.resultCount} 结果 · {row.projectId}</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-cell">
                        <div className={userAvatarClass(index)}>{getAdminInitials(row.userDisplayName || row.userKey)}</div>
                        <div><div className="name">{row.userDisplayName}</div><div className="email">{row.userEmail || row.userKey}</div></div>
                      </div>
                    </td>
                    <td className="mono">{row.regenerationRuns} 次 <span className="text-muted">({row.completedRuns} 成功 / {row.failedRuns} 失败)</span></td>
                    <td className="mono">{row.expectedChargedPoints} pts <span className="text-muted">免费 {row.freeLimit}</span></td>
                    <td className="mono">{row.actualChargedPoints} pts <span className="text-muted">扣 {row.billedChargePoints} / 退 {row.billedRefundPoints}</span></td>
                    <td className={row.deltaPoints > 0 ? 'mono danger-text' : row.deltaPoints < 0 ? 'mono accent-text' : 'mono'}>
                      {row.deltaPoints > 0 ? '+' : ''}{row.deltaPoints} pts
                    </td>
                    <td>
                      <span className={row.status === 'overcharged' ? 'tag tag-red' : row.status === 'undercharged' ? 'tag tag-gray' : 'tag tag-green'}>
                        {row.status === 'overcharged' ? '多扣' : row.status === 'undercharged' ? '少扣' : '正常'}
                      </span>
                    </td>
                    <td className="cell-id">{formatAdminShortDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-tip">{adminRegenerationAuditBusy ? '正在读取重修审计...' : '暂无重修审计异常。'}</div>
        )}
      </div>
    </div>
  );
}
