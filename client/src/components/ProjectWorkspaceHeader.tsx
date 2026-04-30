import type { UiLocale } from '../app-copy';
import { formatGroupCount, formatPhotoCount, getProjectStatusLabel } from '../app-utils';
import type { ProjectRecord } from '../types';

interface ProjectWorkspaceHeaderCopy {
  addressFallback: string;
  currentProject: string;
  rename: string;
}

interface ProjectWorkspaceHeaderProps {
  copy: ProjectWorkspaceHeaderCopy;
  isDemoMode: boolean;
  locale: UiLocale;
  project: ProjectRecord;
  onRenameProject: (project: ProjectRecord) => void;
  onReturnToStudioFeatureCards: () => void;
}

export function ProjectWorkspaceHeader({
  copy,
  isDemoMode,
  locale,
  project,
  onRenameProject,
  onReturnToStudioFeatureCards
}: ProjectWorkspaceHeaderProps) {
  return (
    <section className="panel project-head-card">
      <div className="project-head-copy">
        <span className="muted">{copy.currentProject}</span>
        <div className="project-head-title-row">
          <h2>{project.name}</h2>
          {!isDemoMode && (
            <button className="ghost-button compact project-head-back" type="button" onClick={onReturnToStudioFeatureCards}>
              {locale === 'en' ? 'Back to tools' : '返回功能卡片'}
            </button>
          )}
          {!isDemoMode && (
            <button className="ghost-button compact project-head-rename" type="button" onClick={() => onRenameProject(project)}>
              {copy.rename}
            </button>
          )}
        </div>
        <p>{project.address || copy.addressFallback}</p>
      </div>
      <div className="project-meta">
        <span className="meta-pill">{formatPhotoCount(project.photoCount, locale)}</span>
        <span className="meta-pill">{formatGroupCount(project.groupCount, locale)}</span>
        {!isDemoMode && <span className="meta-pill">{getProjectStatusLabel(project, locale)}</span>}
      </div>
    </section>
  );
}
