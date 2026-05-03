interface AdminWorksListProps {
  adminProjects: any[];
  adminProjectsBusy: boolean;
  adminProjectsPage: number;
  adminProjectsPageCount: number;
  adminProjectsTotal: number;
  adminWorksSearch: string;
  formatAdminShortDate: (value: string) => string;
  getProjectHealthLabel: (project: any) => string;
  getProjectHealthTagClass: (project: any) => string;
  onSearchChange: (value: string) => void;
  onSelectProject: (projectId: string) => void | Promise<void>;
  projectToneClass: (index: number) => string;
  resolveMediaUrl: (url: string) => string;
}

export function AdminWorksList({
  adminProjects,
  adminProjectsBusy,
  adminProjectsPage,
  adminProjectsPageCount,
  adminProjectsTotal,
  adminWorksSearch,
  formatAdminShortDate,
  getProjectHealthLabel,
  getProjectHealthTagClass,
  onSearchChange,
  onSelectProject,
  projectToneClass,
  resolveMediaUrl
}: AdminWorksListProps) {
  const normalizedSearch = adminWorksSearch.trim().toLowerCase();
  const filtered = adminProjects.filter(
    (project) =>
      !normalizedSearch ||
      project.name.toLowerCase().includes(normalizedSearch) ||
      (project.userDisplayName ?? project.userKey ?? '').toLowerCase().includes(normalizedSearch)
  );

  return (
    <div className="card">
      <div className="toolbar">
        <input
          value={adminWorksSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索 作品名称 / 用户"
        />
      </div>
      {adminProjects.length ? (
        filtered.length ? (
          <>
            <div className="admin-list-meta">
              当前显示 {filtered.length.toLocaleString()} 项
              {adminProjectsPage < adminProjectsPageCount ? ` · 还有 ${(adminProjectsTotal - adminProjects.length).toLocaleString()} 项未载入` : ''}
            </div>
            <div className="works-grid">
              {filtered.map((project, index) => {
                const preview = project.resultAssets[0]?.previewUrl ?? project.resultAssets[0]?.storageUrl ?? project.hdrItems[0]?.previewUrl ?? null;
                return (
                  <button key={project.id} className="work-card" type="button" onClick={() => void onSelectProject(project.id)}>
                    <div className={projectToneClass(index)}>
                      {preview ? <img src={resolveMediaUrl(preview)} alt={project.name} loading="lazy" decoding="async" /> : null}
                      <div className="badge-row">
                        <span className="ai-badge">{project.studioFeatureTitle ?? project.workflowId ?? 'HDR ENHANCE'}</span>
                        <span className="check">{project.status === 'completed' ? '✓' : project.status === 'failed' ? '!' : '...'}</span>
                      </div>
                    </div>
                    <div className="work-meta">
                      <div className="name">{project.name}</div>
                      <div className="by">
                        <span>{project.userDisplayName || project.userKey}</span>
                        <span>{formatAdminShortDate(project.updatedAt)}</span>
                      </div>
                      <div className="admin-health-strip">
                        <span className={getProjectHealthTagClass(project)}>{getProjectHealthLabel(project)}</span>
                        <small>{project.adminHealth?.hdrCount ?? project.hdrItems.length} 组 · {project.adminHealth?.resultCount ?? project.resultAssets.length} 结果</small>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-tip">没有匹配 "{adminWorksSearch}" 的作品</div>
        )
      ) : (
        <div className="empty-tip">{adminProjectsBusy ? '正在读取作品...' : '暂无作品'}</div>
      )}
    </div>
  );
}
