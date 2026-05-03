import type { ReactNode } from 'react';

interface AdminFailuresPageProps {
  adminFailedPhotoRows: any[];
  adminFailedPhotosBusy: boolean;
  adminFailedPhotosCauseCounts: Record<string, { count: number } | undefined>;
  adminFailedPhotosLoaded: boolean;
  adminFailedPhotosPage: number;
  adminFailedPhotosPageCount: number;
  adminFailedPhotosTotal: number;
  adminFailedPhotosTotalAll: number;
  adminFailureCauseFilter: string;
  adminFailureCauseOptions: ReadonlyArray<readonly [string, string]>;
  adminFailuresSearch: string;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  formatAdminShortDate: (value: string | null) => string;
  getAdminFailureProviderLabel: (provider: string | null | undefined, stage: string | null | undefined) => string;
  getAdminFailureTaskLabel: (diagnostic: any) => string;
  getAdminRepairActionLabel: (action: string) => string;
  handleAdminLoadFailedPhotos: (page: number) => void | Promise<void>;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onOpenProject: (projectId: string) => void | Promise<void>;
  setAdminFailedPhotosLoaded: (value: boolean) => void;
  setAdminFailureCauseFilter: (value: string) => void;
  setAdminFailuresSearch: (value: string) => void;
}

export function AdminFailuresPage({
  adminFailedPhotoRows,
  adminFailedPhotosBusy,
  adminFailedPhotosCauseCounts,
  adminFailedPhotosLoaded,
  adminFailedPhotosPage,
  adminFailedPhotosPageCount,
  adminFailedPhotosTotal,
  adminFailedPhotosTotalAll,
  adminFailureCauseFilter,
  adminFailureCauseOptions,
  adminFailuresSearch,
  adminPageTitle,
  formatAdminShortDate,
  getAdminFailureProviderLabel,
  getAdminFailureTaskLabel,
  getAdminRepairActionLabel,
  handleAdminLoadFailedPhotos,
  kpi,
  onOpenProject,
  setAdminFailedPhotosLoaded,
  setAdminFailureCauseFilter,
  setAdminFailuresSearch
}: AdminFailuresPageProps) {
  const baseProcessingCount = adminFailedPhotoRows.filter((row) => row.diagnostic.provider === 'runpod' || row.diagnostic.stage === 'runpod').length;
  const polishProcessingCount = adminFailedPhotoRows.filter((row) => row.diagnostic.provider === 'runninghub' || row.diagnostic.stage === 'runninghub').length;
  const sourceMissingCount = adminFailedPhotosCauseCounts['source-missing']?.count ?? 0;

  return (
    <div className="page-content active">
      {adminPageTitle(
        '失败照片',
        <>
          全站失败照片 · <span className="mono danger-text">{adminFailedPhotosTotal}</span> 张
          {adminFailedPhotosTotalAll !== adminFailedPhotosTotal ? <> · 全部异常 {adminFailedPhotosTotalAll}</> : null}
        </>,
        <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadFailedPhotos(1)} disabled={adminFailedPhotosBusy}>
          {adminFailedPhotosBusy ? '刷新中...' : '刷新失败照片'}
        </button>
      )}
      <div className="kpi-grid">
        {kpi('失败照片', <>{adminFailedPhotosTotal}<span className="unit">张</span></>, <><span>服务端分页</span><span className="vs">当前筛选</span></>, adminFailedPhotosTotal ? 'down' : 'up')}
        {kpi('R2 原片缺失', <>{sourceMissingCount}<span className="unit">张</span></>, <><span>需重传/巡检</span><span className="vs">源文件</span></>, sourceMissingCount ? 'down' : 'up')}
        {kpi('基础处理', <>{baseProcessingCount}<span className="unit">张</span></>, <><span>本页</span><span className="vs">处理阶段</span></>, baseProcessingCount ? 'down' : 'up')}
        {kpi('精修处理', <>{polishProcessingCount}<span className="unit">张</span></>, <><span>本页</span><span className="vs">云端阶段</span></>, polishProcessingCount ? 'down' : 'up')}
      </div>
      <div className="card admin-failure-board">
        <div className="toolbar">
          <input
            value={adminFailuresSearch}
            onChange={(event) => {
              setAdminFailuresSearch(event.target.value);
              setAdminFailedPhotosLoaded(false);
            }}
            placeholder="搜索 项目 / 用户 / 文件 / 错误"
          />
          <select
            value={adminFailureCauseFilter}
            onChange={(event) => {
              setAdminFailureCauseFilter(event.target.value);
              setAdminFailedPhotosLoaded(false);
            }}
          >
            <option value="all">全部原因</option>
            {adminFailureCauseOptions.map(([code, title]) => (
              <option value={code} key={code}>{title} ({adminFailedPhotosCauseCounts[code]?.count ?? 0})</option>
            ))}
          </select>
        </div>
        <div className="admin-list-meta">
          当前显示第 {adminFailedPhotosPage} / {adminFailedPhotosPageCount} 页 · 本页 {adminFailedPhotoRows.length.toLocaleString()} 张
          {adminFailureCauseFilter !== 'all' ? ` · ${adminFailureCauseOptions.find(([code]) => code === adminFailureCauseFilter)?.[1] ?? adminFailureCauseFilter}` : ''}
        </div>
        {adminFailedPhotoRows.length ? (
          <div className="admin-failure-table">
            {adminFailedPhotoRows.map((row) => {
              const { diagnostic } = row;
              return (
                <article className="admin-failure-table-row" key={row.id}>
                  <div className="admin-failure-main">
                    <span className="tag tag-red">{diagnostic.causeTitle}</span>
                    <strong>{diagnostic.fileName}</strong>
                    <small>{row.projectName} · {row.userDisplayName || row.userKey}</small>
                  </div>
                  <p>{diagnostic.causeDetail}</p>
                  <div className="admin-failure-meta">
                    <span>HDR {diagnostic.hdrIndex}</span>
                    <span>{getAdminFailureProviderLabel(diagnostic.provider, diagnostic.stage)}</span>
                    <span>{getAdminFailureTaskLabel(diagnostic)}</span>
                    {diagnostic.incomingSourceCount ? <span>临时原片 {diagnostic.incomingSourceCount}</span> : null}
                    {diagnostic.missingSourceReferenceCount ? <span>缺引用 {diagnostic.missingSourceReferenceCount}</span> : null}
                    {diagnostic.updatedAt ? <span>{formatAdminShortDate(diagnostic.updatedAt)}</span> : null}
                  </div>
                  {diagnostic.errorMessage ? <code>{diagnostic.errorMessage}</code> : null}
                  <div className="admin-failure-actions">
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => void onOpenProject(row.projectId)}>
                      打开项目处理
                    </button>
                    <span className="admin-failure-next-action">{getAdminRepairActionLabel(diagnostic.recommendedAction)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-health-ok">
            {adminFailedPhotosBusy ? '正在读取全站失败照片...' : adminFailedPhotosLoaded ? '当前筛选条件下没有失败照片。' : '等待读取失败照片。'}
          </div>
        )}
        <div className="pagination">
          <button className="page-btn" type="button" onClick={() => void handleAdminLoadFailedPhotos(Math.max(1, adminFailedPhotosPage - 1))} disabled={adminFailedPhotosBusy || adminFailedPhotosPage <= 1}>上一页</button>
          <span>第 {adminFailedPhotosPage} / {adminFailedPhotosPageCount} 页</span>
          <button className="page-btn" type="button" onClick={() => void handleAdminLoadFailedPhotos(Math.min(adminFailedPhotosPageCount, adminFailedPhotosPage + 1))} disabled={adminFailedPhotosBusy || adminFailedPhotosPage >= adminFailedPhotosPageCount}>下一页</button>
        </div>
      </div>
    </div>
  );
}
