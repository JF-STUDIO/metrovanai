import type { ReactNode, RefObject } from 'react';

interface AdminUsersPageProps {
  adminActionBusy: boolean;
  adminAdjustment: any;
  adminBillingLedgerRef: RefObject<HTMLDivElement | null>;
  adminBusy: boolean;
  adminDetailBillingEntries: any[];
  adminDetailBusy: boolean;
  adminDetailProjects: any[];
  adminLoaded: boolean;
  adminPage: number;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminRoleFilter: string | undefined;
  adminSearch: string;
  adminSelectedUser: any | null;
  adminStatusFilter: string | undefined;
  adminTotalUsers: number;
  adminUsers: any[];
  adminVerifiedFilter: string | undefined;
  exportAdminUsersCSV: () => void;
  formatAdminDate: (value: string | null) => string;
  getAdminInitials: (value: string) => string;
  getBillingEntryAdminLabel: (entry: any) => string;
  getProjectStatusLabel: (project: any, locale: any) => string;
  handleAdminAdjustBilling: (userId: string) => void | Promise<void>;
  handleAdminAllowUserAccess: (userId: string) => void | Promise<void>;
  handleAdminDeleteUser: (userId: string) => void | Promise<void>;
  handleAdminLoadUsers: () => void | Promise<void>;
  handleAdminLogoutUser: (userId: string) => void | Promise<void>;
  handleAdminOpenUserBilling: (userId: string) => void | Promise<void>;
  handleAdminSelectProject: (projectId: string) => void | Promise<void>;
  handleAdminSelectUser: (userId: string) => void | Promise<void>;
  handleAdminUpdateUser: (userId: string, patch: any) => void | Promise<void>;
  locale: any;
  resolvedAdminPageCount: number;
  setAdminAdjustment: (updater: any) => void;
  setAdminLoaded: (value: boolean) => void;
  setAdminPage: (value: number) => void;
  setAdminRoleFilter: (value: any) => void;
  setAdminSearch: (value: string) => void;
  setAdminStatusFilter: (value: any) => void;
  setAdminVerifiedFilter: (value: any) => void;
  tagClassForStatus: (status: string) => string;
  userAvatarClass: (index: number) => string;
}

export function AdminUsersPage({
  adminActionBusy,
  adminAdjustment,
  adminBillingLedgerRef,
  adminBusy,
  adminDetailBillingEntries,
  adminDetailBusy,
  adminDetailProjects,
  adminLoaded,
  adminPage,
  adminPageTitle,
  adminRoleFilter,
  adminSearch,
  adminSelectedUser,
  adminStatusFilter,
  adminTotalUsers,
  adminUsers,
  adminVerifiedFilter,
  exportAdminUsersCSV,
  formatAdminDate,
  getAdminInitials,
  getBillingEntryAdminLabel,
  getProjectStatusLabel,
  handleAdminAdjustBilling,
  handleAdminAllowUserAccess,
  handleAdminDeleteUser,
  handleAdminLoadUsers,
  handleAdminLogoutUser,
  handleAdminOpenUserBilling,
  handleAdminSelectProject,
  handleAdminSelectUser,
  handleAdminUpdateUser,
  locale,
  resolvedAdminPageCount,
  setAdminAdjustment,
  setAdminLoaded,
  setAdminPage,
  setAdminRoleFilter,
  setAdminSearch,
  setAdminStatusFilter,
  setAdminVerifiedFilter,
  tagClassForStatus,
  userAvatarClass
}: AdminUsersPageProps) {
  const resetUserList = () => {
    setAdminPage(1);
    setAdminLoaded(false);
  };

  return (
    <div className="page-content active">
      {adminPageTitle(
        '用户管理',
        <>共 <span className="mono accent-text">{(adminTotalUsers || adminUsers.length).toLocaleString()}</span> 位注册用户 · 当前页 <span className="mono success-text">{adminUsers.length}</span> 位</>,
        <>
          <button className="btn btn-ghost" type="button" onClick={exportAdminUsersCSV} disabled={!adminUsers.length}>导出 CSV</button>
          <button className="btn btn-primary" type="button" onClick={() => void handleAdminLoadUsers()} disabled={adminBusy}>
            {adminBusy ? '刷新中...' : '刷新用户'}
          </button>
        </>
      )}
      <div className="card">
        <div className="toolbar">
          <input
            value={adminSearch}
            onChange={(event) => {
              setAdminSearch(event.target.value);
              resetUserList();
            }}
            placeholder="搜索 邮箱 / 手机 / ID"
          />
          <select value={adminRoleFilter} onChange={(event) => { setAdminRoleFilter(event.target.value); resetUserList(); }}>
            <option value="all">全部套餐</option>
            <option value="admin">管理员</option>
            <option value="user">用户</option>
          </select>
          <select value={adminStatusFilter} onChange={(event) => { setAdminStatusFilter(event.target.value); resetUserList(); }}>
            <option value="all">所有状态</option>
            <option value="active">正常</option>
            <option value="disabled">已封禁</option>
          </select>
          <select value={adminVerifiedFilter} onChange={(event) => { setAdminVerifiedFilter(event.target.value); resetUserList(); }}>
            <option value="all">邮箱验证：全部</option>
            <option value="verified">已验证</option>
            <option value="unverified">未验证</option>
          </select>
        </div>
        {adminUsers.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>用户</th><th>套餐</th><th>积分余额</th><th>累计消费</th><th>修图次数</th><th>注册时间</th><th>状态</th><th>登录状态</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((user, index) => (
                    <tr key={user.id}>
                      <td>
                        <div className="user-cell">
                          <div className={userAvatarClass(index)}>{getAdminInitials(user.displayName || user.email)}</div>
                          <div><div className="name">{user.displayName}</div><div className="email">{user.email}</div></div>
                        </div>
                      </td>
                      <td><span className={`tag ${user.role === 'admin' ? 'tag-purple' : 'tag-gray'}`}>{user.role === 'admin' ? 'Admin' : 'User'}</span></td>
                      <td className="mono">{user.billingSummary.availablePoints.toLocaleString()}</td>
                      <td className="mono">${user.billingSummary.totalTopUpUsd.toFixed(0)}</td>
                      <td className="mono">{user.photoCount.toLocaleString()}</td>
                      <td className="cell-id">{formatAdminDate(user.createdAt)}</td>
                      <td>
                        <div className="admin-status-stack">
                          <span className={tagClassForStatus(user.accountStatus)}>{user.accountStatus === 'active' ? '正常' : '已封禁'}</span>
                          <span className={user.emailVerifiedAt ? 'tag tag-green' : 'tag tag-orange'}>{user.emailVerifiedAt ? '邮箱已验证' : '邮箱未验证'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-status-stack">
                          <span className={user.activeSessionCount > 0 ? 'tag tag-green' : 'tag tag-gray'}>{user.activeSessionCount > 0 ? `在线 ${user.activeSessionCount}` : '离线'}</span>
                          <small>{user.lastSeenAt ? `最近 ${formatAdminDate(user.lastSeenAt)}` : '暂无访问记录'}</small>
                        </div>
                      </td>
                      <td>
                        <div className="tbl-actions">
                          <button className="tbl-icon" type="button" onClick={() => void handleAdminSelectUser(user.id)} title="查看">⌕</button>
                          <button className="tbl-icon tbl-icon-text" type="button" onClick={() => void handleAdminOpenUserBilling(user.id)} title="查看账单">账</button>
                          {(!user.emailVerifiedAt || user.accountStatus !== 'active') ? (
                            <button className="tbl-icon" type="button" onClick={() => void handleAdminAllowUserAccess(user.id)} title="允许访问">✓</button>
                          ) : null}
                          <button
                            className="tbl-icon"
                            type="button"
                            onClick={() => void handleAdminUpdateUser(user.id, { accountStatus: user.accountStatus === 'active' ? 'disabled' : 'active' })}
                            title={user.accountStatus === 'active' ? '封禁账号' : '启用账号'}
                          >
                            {user.accountStatus === 'active' ? '禁' : '启'}
                          </button>
                          <button className="tbl-icon tbl-icon-text" type="button" onClick={() => void handleAdminDeleteUser(user.id)} disabled={adminActionBusy} title="删除用户">删</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>显示 1 - {adminUsers.length}，共 {(adminTotalUsers || adminUsers.length).toLocaleString()} 条 · 第 {adminPage} / {resolvedAdminPageCount} 页</span>
              <div className="page-btns">
                <button className="page-btn" type="button" onClick={() => setAdminPage(Math.max(1, adminPage - 1))} disabled={adminPage <= 1}>‹</button>
                <span className="page-btn active">{adminPage}</span>
                <button className="page-btn" type="button" onClick={() => setAdminPage(Math.min(resolvedAdminPageCount, adminPage + 1))} disabled={adminPage >= resolvedAdminPageCount}>›</button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-tip">{adminBusy ? '正在读取用户...' : adminLoaded ? '暂无用户数据' : '暂无用户数据'}</div>
        )}
      </div>
      {adminSelectedUser ? (
        <AdminSelectedUserPanel
          adminActionBusy={adminActionBusy}
          adminAdjustment={adminAdjustment}
          adminBillingLedgerRef={adminBillingLedgerRef}
          adminDetailBillingEntries={adminDetailBillingEntries}
          adminDetailBusy={adminDetailBusy}
          adminDetailProjects={adminDetailProjects}
          adminSelectedUser={adminSelectedUser}
          formatAdminDate={formatAdminDate}
          getBillingEntryAdminLabel={getBillingEntryAdminLabel}
          getProjectStatusLabel={getProjectStatusLabel}
          handleAdminAdjustBilling={handleAdminAdjustBilling}
          handleAdminAllowUserAccess={handleAdminAllowUserAccess}
          handleAdminDeleteUser={handleAdminDeleteUser}
          handleAdminLogoutUser={handleAdminLogoutUser}
          handleAdminSelectProject={handleAdminSelectProject}
          handleAdminSelectUser={handleAdminSelectUser}
          locale={locale}
          setAdminAdjustment={setAdminAdjustment}
          tagClassForStatus={tagClassForStatus}
        />
      ) : null}
    </div>
  );
}

function AdminSelectedUserPanel(props: Pick<AdminUsersPageProps,
  'adminActionBusy' | 'adminAdjustment' | 'adminBillingLedgerRef' | 'adminDetailBillingEntries' | 'adminDetailBusy' |
  'adminDetailProjects' | 'adminSelectedUser' | 'formatAdminDate' | 'getBillingEntryAdminLabel' | 'getProjectStatusLabel' |
  'handleAdminAdjustBilling' | 'handleAdminAllowUserAccess' | 'handleAdminDeleteUser' | 'handleAdminLogoutUser' |
  'handleAdminSelectProject' | 'handleAdminSelectUser' | 'locale' | 'setAdminAdjustment' | 'tagClassForStatus'
>) {
  const {
    adminActionBusy,
    adminAdjustment,
    adminBillingLedgerRef,
    adminDetailBillingEntries,
    adminDetailBusy,
    adminDetailProjects,
    adminSelectedUser,
    formatAdminDate,
    getBillingEntryAdminLabel,
    getProjectStatusLabel,
    handleAdminAdjustBilling,
    handleAdminAllowUserAccess,
    handleAdminDeleteUser,
    handleAdminLogoutUser,
    handleAdminSelectProject,
    handleAdminSelectUser,
    locale,
    setAdminAdjustment,
    tagClassForStatus
  } = props;
  const chargeEntries = adminDetailBillingEntries.filter((entry) => entry.type === 'charge');
  const creditEntries = adminDetailBillingEntries.filter((entry) => entry.type === 'credit');

  return (
    <div className="card admin-detail-card">
      <div className="card-header">
        <h3>{adminSelectedUser.displayName} · 积分与项目</h3>
        <div className="admin-page-actions">
          <button className="btn btn-ghost" type="button" onClick={() => void handleAdminSelectUser(adminSelectedUser.id)} disabled={adminDetailBusy}>刷新详情</button>
          {(!adminSelectedUser.emailVerifiedAt || adminSelectedUser.accountStatus !== 'active') ? (
            <button className="btn btn-primary" type="button" onClick={() => void handleAdminAllowUserAccess(adminSelectedUser.id)} disabled={adminActionBusy}>允许访问</button>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLogoutUser(adminSelectedUser.id)} disabled={adminActionBusy}>踢下线</button>
          <button className="btn btn-ghost" type="button" onClick={() => void handleAdminDeleteUser(adminSelectedUser.id)} disabled={adminActionBusy}>删除用户</button>
        </div>
      </div>
      <div className="admin-detail-grid">
        <div className="settings-row admin-account-status-row">
          <div className="label-side"><div className="name">账号实时状态</div><div className="desc">用于排查用户登录、邮箱验证和会话状态。</div></div>
          <div className="admin-status-panel">
            <span className={tagClassForStatus(adminSelectedUser.accountStatus)}>{adminSelectedUser.accountStatus === 'active' ? '账号正常' : '账号已封禁'}</span>
            <span className={adminSelectedUser.emailVerifiedAt ? 'tag tag-green' : 'tag tag-orange'}>{adminSelectedUser.emailVerifiedAt ? '邮箱已验证' : '邮箱未验证'}</span>
            <span className={adminSelectedUser.activeSessionCount > 0 ? 'tag tag-green' : 'tag tag-gray'}>{adminSelectedUser.activeSessionCount > 0 ? `当前在线 ${adminSelectedUser.activeSessionCount}` : '当前离线'}</span>
            <small>最后登录：{adminSelectedUser.lastLoginAt ? formatAdminDate(adminSelectedUser.lastLoginAt) : '无记录'}</small>
            <small>最后活动：{adminSelectedUser.lastSeenAt ? formatAdminDate(adminSelectedUser.lastSeenAt) : '无记录'}</small>
            <small>登录方式：{[adminSelectedUser.auth.password ? '邮箱密码' : null, adminSelectedUser.auth.google ? 'Google' : null].filter(Boolean).join(' / ') || '未绑定'}</small>
          </div>
        </div>
        <div className="settings-row">
          <div className="label-side"><div className="name">手动调整积分</div><div className="desc">正数增加，负数扣减，会写入账单流水。</div></div>
          <div className="admin-inline-form">
            <select
              value={adminAdjustment.type}
              onChange={(event) => {
                const nextType = event.target.value as 'credit' | 'charge';
                setAdminAdjustment((current: any) => {
                  const shouldUseDefaultNote = !current.note.trim() || current.note === 'Manual credit' || current.note === 'Manual charge';
                  return { ...current, type: nextType, note: shouldUseDefaultNote ? (nextType === 'credit' ? 'Manual credit' : 'Manual charge') : current.note };
                });
              }}
            >
              <option value="credit">补积分</option>
              <option value="charge">扣积分</option>
            </select>
            <input value={adminAdjustment.points} onChange={(event) => setAdminAdjustment((current: any) => ({ ...current, points: event.target.value }))} placeholder="积分" />
            <input value={adminAdjustment.note} onChange={(event) => setAdminAdjustment((current: any) => ({ ...current, note: event.target.value }))} placeholder="备注" />
            <button className="btn btn-primary" type="button" onClick={() => void handleAdminAdjustBilling(adminSelectedUser.id)} disabled={adminActionBusy}>提交</button>
          </div>
        </div>
        <div className="admin-mini-table">
          <div className="admin-mini-head"><strong>最近项目</strong><span>{adminDetailProjects.length} 个</span></div>
          {adminDetailProjects.slice(0, 6).map((project) => (
            <button key={project.id} className="admin-project-row" type="button" onClick={() => void handleAdminSelectProject(project.id)}>
              <span>{project.name}</span>
              <small>{getProjectStatusLabel(project, locale)} · {project.photoCount} 张 · {formatAdminDate(project.updatedAt)}</small>
            </button>
          ))}
          {!adminDetailProjects.length && <p>暂无项目。</p>}
        </div>
        <BillingEntryList entries={chargeEntries} formatAdminDate={formatAdminDate} getBillingEntryAdminLabel={getBillingEntryAdminLabel} kind="charge" ledgerRef={adminBillingLedgerRef} />
        <BillingEntryList entries={creditEntries} formatAdminDate={formatAdminDate} getBillingEntryAdminLabel={getBillingEntryAdminLabel} kind="credit" />
      </div>
    </div>
  );
}

function BillingEntryList({
  entries,
  formatAdminDate,
  getBillingEntryAdminLabel,
  kind,
  ledgerRef
}: {
  entries: any[];
  formatAdminDate: (value: string | null) => string;
  getBillingEntryAdminLabel: (entry: any) => string;
  kind: 'charge' | 'credit';
  ledgerRef?: RefObject<HTMLDivElement | null>;
}) {
  const total = entries.reduce((sum, entry) => sum + entry.points, 0);
  return (
    <div className="admin-mini-table admin-billing-ledger" ref={ledgerRef}>
      <div className="admin-mini-head">
        <strong>{kind === 'charge' ? '扣费记录' : '入账记录'}</strong>
        <span>{entries.length} 条 · {total.toLocaleString()} pts</span>
      </div>
      {entries.map((entry) => (
        <div key={entry.id} className={`admin-mini-row billing-entry-row ${kind}`}>
          <span>{getBillingEntryAdminLabel(entry)}</span>
          <small>{kind === 'charge' ? '-' : '+'}{entry.points} pts · {formatAdminDate(entry.createdAt)}</small>
          {kind === 'charge'
            ? entry.note && entry.note !== getBillingEntryAdminLabel(entry) ? <em>{entry.note}</em> : null
            : entry.amountUsd > 0 ? <em>${entry.amountUsd.toFixed(2)}</em> : null}
        </div>
      ))}
      {!entries.length && <p>{kind === 'charge' ? '暂无扣费记录。' : '暂无入账记录。'}</p>}
    </div>
  );
}
