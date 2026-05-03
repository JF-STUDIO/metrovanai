import type { AdminProjectRepairAction } from '../api';

interface AdminProjectDetailPanelProps {
  adminActionBusy: boolean;
  adminDeepHealthBusy: boolean;
  adminRepairBusy: AdminProjectRepairAction | null;
  canMarkStalled: boolean;
  canRetryFailed: boolean;
  deepHealth: any | null;
  failedItems: any[];
  formatAdminShortDate: (value: string | null) => string;
  getAdminFailureProviderLabel: (provider: string | null | undefined, stage: string | null | undefined) => string;
  getAdminFailureTaskLabel: (diagnostic: any) => string;
  getAdminRepairActionLabel: (action: string) => string;
  getHdrItemStatusLabel: (item: any, locale: any) => string;
  getProjectHealthLabel: (project: any) => string;
  getProjectHealthTagClass: (project: any) => string;
  getProjectStatusLabel: (project: any, locale: any) => string;
  getSelectedExposure: (item: any) => any;
  locale: any;
  missingItems: any[];
  onDeleteProject: (projectId: string) => void | Promise<void>;
  onRecoverProject: () => void | Promise<void>;
  onRecommendedAction: (action: string) => void | Promise<void>;
  onRepairProject: (action: AdminProjectRepairAction) => void | Promise<void>;
  onRunDeepHealth: () => void | Promise<void>;
  processingItems: any[];
  project: any | null;
  resolveMediaUrl: (url: string) => string;
  results: any[];
  tagClassForStatus: (status: string) => string;
}

export function AdminProjectDetailPanel({
  adminActionBusy,
  adminDeepHealthBusy,
  adminRepairBusy,
  canMarkStalled,
  canRetryFailed,
  deepHealth,
  failedItems,
  formatAdminShortDate,
  getAdminFailureProviderLabel,
  getAdminFailureTaskLabel,
  getAdminRepairActionLabel,
  getHdrItemStatusLabel,
  getProjectHealthLabel,
  getProjectHealthTagClass,
  getProjectStatusLabel,
  getSelectedExposure,
  locale,
  missingItems,
  onDeleteProject,
  onRecoverProject,
  onRecommendedAction,
  onRepairProject,
  onRunDeepHealth,
  processingItems,
  project,
  resolveMediaUrl,
  results,
  tagClassForStatus
}: AdminProjectDetailPanelProps) {
  if (!project) {
    return null;
  }

  const health = project.adminHealth;

  return (
    <div className="card admin-detail-card">
      <div className="card-header">
        <h3>{project.name}</h3>
        <div className="admin-inline-actions">
          <span className={tagClassForStatus(project.status)}>{getProjectStatusLabel(project, locale)}</span>
          <button className="btn btn-ghost btn-xs" type="button" onClick={() => void onRecoverProject()} disabled={adminActionBusy}>
            {adminActionBusy ? '恢复中...' : '恢复云端结果'}
          </button>
          <button className="btn btn-ghost btn-xs" type="button" onClick={() => void onRunDeepHealth()} disabled={adminDeepHealthBusy}>
            {adminDeepHealthBusy ? '巡检中...' : '深度巡检'}
          </button>
          <button className="btn btn-ghost btn-xs danger" type="button" onClick={() => void onDeleteProject(project.id)} disabled={adminActionBusy}>
            删除项目
          </button>
        </div>
      </div>
      <div className="admin-project-live">
        <div className="admin-live-stats">
          <span>失败 {failedItems.length}</span>
          <span>处理中 {processingItems.length}</span>
          <span>缺结果 {missingItems.length}</span>
          <span>结果 {results.length}</span>
        </div>

        {health ? (
          <div className="admin-health-panel">
            <div className="admin-health-head">
              <span className={getProjectHealthTagClass(project)}>{getProjectHealthLabel(project)}</span>
              <strong>项目健康检查</strong>
              <small>{health.latestDownloadJob ? `最近下载：${health.latestDownloadJob.status}` : '暂无下载任务'}</small>
            </div>
            <div className="admin-health-grid">
              <div><strong>{health.exposureCount}</strong><span>曝光文件</span></div>
              <div><strong>{health.hdrCount}</strong><span>HDR 分组</span></div>
              <div><strong>{health.resultCount}</strong><span>结果图</span></div>
              <div><strong>{health.missingSourceCount}</strong><span>缺源文件</span></div>
            </div>

            <div className="admin-diagnosis-card">
              <div className="admin-mini-head">
                <strong>诊断建议</strong>
                <span>{health.reviewed ? '已审核' : health.issues?.length ? `${health.issues.length} 个原因` : '正常'}</span>
              </div>
              <p>{health.rootCauseSummary ?? '未发现需要处理的项目健康问题。'}</p>
              {health.issues?.length ? (
                <div className="admin-diagnosis-list">
                  {health.issues.slice(0, 5).map((issue: any) => (
                    <div className={`admin-diagnosis-item ${issue.severity === 'error' ? 'error' : 'warning'}`} key={issue.code}>
                      <strong>{issue.title}</strong>
                      <span>{issue.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {health.recommendedActions?.length ? (
                <div className="admin-recommended-actions">
                  {health.recommendedActions.map((action: string) => (
                    <button
                      className={`btn btn-ghost btn-xs ${action === 'mark-stalled-failed' ? 'danger' : ''}`}
                      type="button"
                      key={action}
                      onClick={() => void onRecommendedAction(action)}
                      disabled={Boolean(adminRepairBusy) || (action === 'deep-health' && adminDeepHealthBusy)}
                    >
                      {getAdminRepairActionLabel(action)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {health.failedItemDiagnostics?.length ? (
              <div className="admin-diagnosis-card admin-failure-diagnostics">
                <div className="admin-mini-head">
                  <strong>失败照片诊断</strong>
                  <span>{health.failedItemDiagnostics.length} 张</span>
                </div>
                <div className="admin-failure-list">
                  {health.failedItemDiagnostics.slice(0, 24).map((diagnostic: any) => (
                    <article className="admin-failure-row" key={diagnostic.id}>
                      <div className="admin-failure-main">
                        <span className="tag tag-red">{diagnostic.causeTitle}</span>
                        <strong>{diagnostic.fileName}</strong>
                        <small>
                          HDR {diagnostic.hdrIndex} · {getAdminFailureProviderLabel(diagnostic.provider, diagnostic.stage)} · {getAdminFailureTaskLabel(diagnostic)}
                        </small>
                      </div>
                      <p>{diagnostic.causeDetail}</p>
                      {diagnostic.errorMessage ? <code>{diagnostic.errorMessage}</code> : null}
                      <div className="admin-failure-meta">
                        <span>曝光 {diagnostic.exposureCount}</span>
                        {diagnostic.incomingSourceCount ? <span>临时原片 {diagnostic.incomingSourceCount}</span> : null}
                        {diagnostic.missingSourceReferenceCount ? <span>缺引用 {diagnostic.missingSourceReferenceCount}</span> : null}
                        {diagnostic.updatedAt ? <span>{formatAdminShortDate(diagnostic.updatedAt)}</span> : null}
                        <button
                          className="btn btn-ghost btn-xs"
                          type="button"
                          onClick={() => void onRecommendedAction(diagnostic.recommendedAction)}
                          disabled={Boolean(adminRepairBusy) || (diagnostic.recommendedAction === 'deep-health' && adminDeepHealthBusy)}
                        >
                          {getAdminRepairActionLabel(diagnostic.recommendedAction)}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {health.warnings?.length ? (
              <div className="admin-health-warnings">
                {health.warnings.slice(0, 6).map((warning: string) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : (
              <div className="admin-health-ok">未发现 RAW/JPG 混组、重复源文件或截断结果图风险。</div>
            )}

            {missingItems.length ? (
              <div className="admin-diagnosis-card">
                <div className="admin-mini-head">
                  <strong>缺失结果</strong>
                  <span>{missingItems.length} 组没有结果图</span>
                </div>
                <div className="admin-diagnosis-list">
                  {missingItems.slice(0, 12).map((item) => {
                    const selectedExposure = getSelectedExposure(item);
                    return (
                      <div className={item.status === 'error' ? 'admin-diagnosis-item error' : 'admin-diagnosis-item warning'} key={item.id}>
                        <strong>{selectedExposure?.originalName ?? item.title}</strong>
                        <span>{getHdrItemStatusLabel(item, locale)} · HDR {item.index}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="admin-repair-actions">
              <button
                className="btn btn-ghost btn-xs"
                type="button"
                onClick={() => void onRepairProject('acknowledge-maintenance')}
                disabled={health.reviewed || Boolean(adminRepairBusy)}
              >
                {adminRepairBusy === 'acknowledge-maintenance' ? '标记中...' : '标记已审核'}
              </button>
              <button
                className="btn btn-ghost btn-xs"
                type="button"
                onClick={() => void onRepairProject('retry-failed-processing')}
                disabled={!canRetryFailed || Boolean(adminRepairBusy)}
              >
                {adminRepairBusy === 'retry-failed-processing' ? '重试中...' : '重试失败照片'}
              </button>
              <button
                className="btn btn-ghost btn-xs"
                type="button"
                onClick={() => void onRepairProject('regenerate-download')}
                disabled={!results.length || Boolean(adminRepairBusy)}
              >
                {adminRepairBusy === 'regenerate-download' ? '生成中...' : '重新生成下载包'}
              </button>
              <button
                className="btn btn-ghost btn-xs danger"
                type="button"
                onClick={() => void onRepairProject('mark-stalled-failed')}
                disabled={!canMarkStalled || Boolean(adminRepairBusy)}
              >
                {adminRepairBusy === 'mark-stalled-failed' ? '标记中...' : '标记卡住失败'}
              </button>
            </div>

            {deepHealth ? (
              <div className="admin-deep-health">
                <div className="admin-mini-head">
                  <strong>深度巡检</strong>
                  <span>{deepHealth.status === 'passed' ? '通过' : `${deepHealth.issueCount} 个问题`}</span>
                </div>
                <div className="admin-health-grid compact">
                  <div><strong>{deepHealth.checkedObjects}</strong><span>R2 对象</span></div>
                  <div><strong>{deepHealth.missingObjects}</strong><span>缺失</span></div>
                  <div><strong>{deepHealth.sizeMismatchObjects}</strong><span>大小不符</span></div>
                  <div><strong>{formatAdminShortDate(deepHealth.completedAt)}</strong><span>完成时间</span></div>
                </div>
                {deepHealth.issues.length ? (
                  <div className="admin-health-warnings">
                    {deepHealth.issues.slice(0, 8).map((issue: any) => (
                      <span key={`${issue.scope}-${issue.name}-${issue.message}`}>
                        {issue.scope} · {issue.name}：{issue.message}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="admin-health-ok">R2 原片、结果图和最近下载包检查通过。</div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {results.length ? (
          <div className="admin-live-grid">
            {results.slice(0, 12).map((asset) => (
              <a key={asset.id} className="admin-live-tile" href={resolveMediaUrl(asset.storageUrl)} target="_blank" rel="noreferrer">
                <img src={resolveMediaUrl(asset.previewUrl ?? asset.storageUrl)} alt={asset.fileName} loading="lazy" decoding="async" />
                <span>{asset.fileName}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
