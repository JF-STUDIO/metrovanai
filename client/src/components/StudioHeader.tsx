import type { RefObject } from 'react';
import type { UiLocale } from '../app-copy';
import { formatDate, formatPhotoCount, getProjectStatusLabel } from '../app-utils';
import type { BillingSummary, ProjectRecord } from '../types';

interface StudioHeaderCopy {
  billingOpenRecharge: string;
  delete: string;
  download: string;
  historyProjects: string;
  historyProjectsHint: string;
  historyProjectsHintDemo: string;
  menuBilling: string;
  menuLogout: string;
  menuSettings: string;
  noProject: string;
  noProjectHint: string;
  open: string;
  points: string;
  rename: string;
  studioLabel: string;
  studioSubLabel: string;
  topUp: string;
}

interface StudioHeaderSession {
  displayName: string;
}

interface StudioHeaderProps {
  billingSummary: BillingSummary | null;
  copy: StudioHeaderCopy;
  currentProjectId: string | null;
  historyMenuOpen: boolean;
  historyMenuRef: RefObject<HTMLDivElement | null>;
  isDemoMode: boolean;
  locale: UiLocale;
  logoMark: string;
  session: StudioHeaderSession;
  userMenuOpen: boolean;
  userMenuRef: RefObject<HTMLDivElement | null>;
  visibleProjects: ProjectRecord[];
  onDeleteProject: (project: ProjectRecord) => void;
  onDownloadProject: (project: ProjectRecord) => void;
  onOpenBilling: (mode: 'topup' | 'billing') => void;
  onOpenSettings: () => void;
  onRenameProject: (project: ProjectRecord) => void;
  onSelectProject: (projectId: string) => void;
  onSetHistoryMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  onSetUserMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  onSignOut: () => void;
  onReturnToStudioFeatureCards: () => void;
}

export function StudioHeader({
  billingSummary,
  copy,
  currentProjectId,
  historyMenuOpen,
  historyMenuRef,
  isDemoMode,
  locale,
  logoMark,
  session,
  userMenuOpen,
  userMenuRef,
  visibleProjects,
  onDeleteProject,
  onDownloadProject,
  onOpenBilling,
  onOpenSettings,
  onRenameProject,
  onReturnToStudioFeatureCards,
  onSelectProject,
  onSetHistoryMenuOpen,
  onSetUserMenuOpen,
  onSignOut
}: StudioHeaderProps) {
  return (
    <header className="studio-header">
      <button className="brand-button" type="button" onClick={onReturnToStudioFeatureCards}>
        <span className="studio-brand-mark-shell" aria-hidden="true">
          <img className="studio-brand-mark" src={logoMark} alt="Metrovan AI" decoding="async" />
        </span>
        <span className="brand-copy">
          <strong>{copy.studioLabel}</strong>
          <em>{copy.studioSubLabel}</em>
        </span>
      </button>
      <div className="header-actions">
        <div className="points-pill">
          <span className="points-pill-label">{copy.points}</span>
          <strong className="points-pill-value">{isDemoMode ? '42.5' : billingSummary?.availablePoints ?? 0}</strong>
          <button className="points-plus" type="button" aria-label={copy.topUp} onClick={() => onOpenBilling('topup')}>
            {copy.billingOpenRecharge}
          </button>
        </div>
        <div className="history-menu" ref={historyMenuRef}>
          <button
            className="history-menu-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={historyMenuOpen}
            onClick={() => onSetHistoryMenuOpen((current) => !current)}
          >
            {copy.historyProjects}
          </button>
          {historyMenuOpen && (
            <div className="history-menu-popover" role="dialog" aria-label={copy.historyProjects}>
              <div className="history-menu-head">
                <strong>{copy.historyProjects}</strong>
                <span>{isDemoMode ? copy.historyProjectsHintDemo : copy.historyProjectsHint}</span>
              </div>
              <div className="project-list compact-history-list">
                {visibleProjects.map((project) => (
                  <article key={project.id} className={`project-tile${project.id === currentProjectId ? ' active' : ''}`}>
                    <div className="project-tile-head">
                      <div className="project-tile-heading-row">
                        <strong>{project.name}</strong>
                        <button className="text-link tile-rename-link" type="button" onClick={() => onRenameProject(project)}>
                          {copy.rename}
                        </button>
                      </div>
                      <span>{formatPhotoCount(project.photoCount, locale)} / {formatDate(project.createdAt, locale)}</span>
                      <em>{getProjectStatusLabel(project, locale)}</em>
                    </div>
                    <div className="project-tile-actions">
                      <button className="ghost-button compact" type="button" onClick={() => onSelectProject(project.id)}>
                        {copy.open}
                      </button>
                      <button
                        className="ghost-button compact"
                        type="button"
                        disabled={!project.downloadReady}
                        onClick={() => onDownloadProject(project)}
                      >
                        {copy.download}
                      </button>
                      <button className="ghost-button compact" type="button" onClick={() => onDeleteProject(project)}>
                        {copy.delete}
                      </button>
                    </div>
                  </article>
                ))}

                {!visibleProjects.length && (
                  <div className="empty-state">
                    <strong>{copy.noProject}</strong>
                    <span>{copy.noProjectHint}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="user-menu" ref={userMenuRef}>
          <button
            className="user-pill"
            type="button"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => onSetUserMenuOpen((current) => !current)}
          >
            <span className="avatar">{session.displayName.slice(0, 2).toUpperCase()}</span>
            <span>{session.displayName}</span>
            <span className="user-pill-chevron" aria-hidden="true">
              ▾
            </span>
          </button>
          {userMenuOpen && (
            <div className="user-menu-popover" role="menu">
              <button className="user-menu-item" type="button" role="menuitem" onClick={onOpenSettings}>
                {copy.menuSettings}
              </button>
              <button className="user-menu-item" type="button" role="menuitem" onClick={() => onOpenBilling('billing')}>
                {copy.menuBilling}
              </button>
              <button className="user-menu-item danger" type="button" role="menuitem" onClick={onSignOut}>
                {copy.menuLogout}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
