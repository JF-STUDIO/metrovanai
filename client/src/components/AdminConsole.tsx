import type { ReactNode } from 'react';
import { ADMIN_CONSOLE_PAGE_LABELS, type AdminConsolePage } from '../app-utils';

interface AdminConsoleSession {
  displayName?: string | null;
  email?: string | null;
  role?: 'user' | 'admin' | string;
}

interface AdminConsoleProps {
  adminConsolePage: AdminConsolePage;
  adminMessage: string;
  page: ReactNode;
  pendingProjectCount: number;
  refundDialog: ReactNode;
  session: AdminConsoleSession | null;
  onNavigateStudio: () => void;
  onSetPage: (page: AdminConsolePage) => void;
  onSignOut: () => void;
}

function getAdminInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'AD';
  }

  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return trimmed.slice(0, 2).toUpperCase();
}

function adminNavIcon(page: AdminConsolePage) {
  const paths: Record<AdminConsolePage, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    ),
    users: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
      </>
    ),
    works: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-5-5L5 21" />
      </>
    ),
    failures: (
      <>
        <path d="M12 3 2 20h20L12 3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </>
    ),
    orders: (
      <>
        <path d="M3 7h18l-2 12H5z" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      </>
    ),
    plans: (
      <>
        <path d="M12 2 4 7v10l8 5 8-5V7z" />
        <path d="M12 12 4 7" />
        <path d="m12 12 8-5" />
        <path d="M12 12v10" />
      </>
    ),
    codes: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <path d="M14 3h7v7" />
        <path d="M3 21l11-11" />
      </>
    ),
    engine: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
      </>
    ),
    prompts: <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />,
    content: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
      </>
    ),
    maintenance: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m8 15 3-4 3 2 4-6" />
      </>
    ),
    logs: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    )
  };

  return (
    <svg className="admin-console-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {paths[page]}
    </svg>
  );
}

export function AdminConsole({
  adminConsolePage,
  adminMessage,
  page,
  pendingProjectCount,
  refundDialog,
  session,
  onNavigateStudio,
  onSetPage,
  onSignOut
}: AdminConsoleProps) {
  const adminName = session?.displayName ?? 'Jin Zhou';
  const initials = getAdminInitials(session?.displayName ?? session?.email ?? 'Admin');

  const targetNavButton = (targetPage: AdminConsolePage, label: string, badge?: string) => (
    <button
      key={targetPage}
      className={`nav-item${adminConsolePage === targetPage ? ' active' : ''}`}
      type="button"
      onClick={() => onSetPage(targetPage)}
    >
      {adminNavIcon(targetPage)}
      <span>{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <main className="admin-prototype app">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={onNavigateStudio}>
          <div className="brand-mark">M</div>
          <div className="brand-text">
            <strong>Metrovan AI</strong>
            <small>Admin</small>
          </div>
        </button>
        <div className="nav-section">
          <div className="nav-section-label">概览</div>
          {targetNavButton('dashboard', '仪表盘')}
        </div>
        <div className="nav-section">
          <div className="nav-section-label">业务</div>
          {targetNavButton('users', '用户管理')}
          {targetNavButton('works', '修图作品', pendingProjectCount ? String(pendingProjectCount) : undefined)}
          {targetNavButton('failures', '失败照片')}
          {targetNavButton('orders', '订单管理')}
          {targetNavButton('plans', '套餐配置')}
          {targetNavButton('codes', '兑换码')}
        </div>
        <div className="nav-section">
          <div className="nav-section-label">AI</div>
          {targetNavButton('engine', 'AI 引擎')}
          {targetNavButton('prompts', 'Prompt 模板')}
        </div>
        <div className="nav-section">
          <div className="nav-section-label">运营 & 系统</div>
          {targetNavButton('content', '内容运营')}
          {targetNavButton('maintenance', '维护报告')}
          {targetNavButton('logs', '操作日志')}
          {targetNavButton('settings', '系统设置')}
        </div>
        <button className="sidebar-footer" type="button" onClick={() => onSetPage('settings')}>
          <div className="avatar">{initials}</div>
          <div className="info">
            <div className="name">{adminName}</div>
            <div className="role">{session?.role === 'admin' ? '超级管理员' : '未授权'}</div>
          </div>
          <span
            className="logout"
            onClick={(event) => {
              event.stopPropagation();
              onSignOut();
            }}
          >
            ⏻
          </span>
        </button>
      </aside>
      <section className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Console</span>
            <span className="sep">/</span>
            <span className="current">{ADMIN_CONSOLE_PAGE_LABELS[adminConsolePage]}</span>
          </div>
          <div className="search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span>搜索用户、订单、作品...</span>
            <span className="kbd">⌘K</span>
          </div>
          <div className="topbar-icon" title="通知">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="dot" />
          </div>
          <div className="topbar-icon" title="帮助">?</div>
          <div className="topbar-avatar">{initials}</div>
        </header>
        {adminMessage ? <div className="global-message admin-message">{adminMessage}</div> : null}
        {page}
      </section>
      {refundDialog}
    </main>
  );
}
