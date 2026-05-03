import type { ReactNode } from 'react';

interface AdminLogsPageProps {
  adminActionBusy: boolean;
  adminAuditLogs: any[];
  adminLogsSearch: string;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  formatAdminDate: (value: string | null) => string;
  getAdminInitials: (value: string) => string;
  onLoadAuditLogs: () => void | Promise<void>;
  onSearchChange: (value: string) => void;
  userAvatarClass: (index: number) => string;
}

export function AdminLogsPage({
  adminActionBusy,
  adminAuditLogs,
  adminLogsSearch,
  adminPageTitle,
  formatAdminDate,
  getAdminInitials,
  onLoadAuditLogs,
  onSearchChange,
  userAvatarClass
}: AdminLogsPageProps) {
  const normalizedSearch = adminLogsSearch.toLowerCase();
  const filteredLogs = adminAuditLogs.filter((entry) =>
    !normalizedSearch ||
    (entry.actorEmail ?? entry.actorType ?? '').toLowerCase().includes(normalizedSearch) ||
    entry.action.toLowerCase().includes(normalizedSearch)
  );

  return (
    <div className="page-content active">
      {adminPageTitle('操作日志', '所有管理员操作 · 不可编辑、不可删除', <button className="btn btn-ghost" type="button" onClick={() => void onLoadAuditLogs()} disabled={adminActionBusy}>读取日志</button>)}
      <div className="card">
        <div className="toolbar">
          <input value={adminLogsSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索 操作员 / 操作类型" />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>操作员</th><th>模块</th><th>操作</th><th>对象</th><th>IP</th></tr></thead>
            <tbody>
              {filteredLogs.map((entry, index) => (
                <tr key={entry.id}>
                  <td className="cell-id">{formatAdminDate(entry.createdAt)}</td>
                  <td><div className="user-cell"><div className={userAvatarClass(index)}>{getAdminInitials(entry.actorEmail ?? entry.actorType)}</div><div><div className="name">{entry.actorEmail ?? entry.actorType}</div></div></div></td>
                  <td><span className="tag tag-cyan">{entry.action.split('.')[0] || '系统'}</span></td>
                  <td>{entry.action}</td>
                  <td className="mono">{entry.targetUserId ?? entry.targetProjectId ?? '—'}</td>
                  <td className="cell-id">{entry.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {adminAuditLogs.length > 0 && adminLogsSearch && !filteredLogs.length ? <div className="empty-tip">没有匹配 "{adminLogsSearch}" 的日志记录</div> : null}
        {!adminAuditLogs.length ? <div className="empty-tip">{adminActionBusy ? '正在读取日志...' : '暂无日志，点击"读取日志"加载'}</div> : null}
      </div>
    </div>
  );
}
