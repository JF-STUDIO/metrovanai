import type { UiLocale } from '../app-copy';
import { getProgressWidthClass, getProjectProgress } from '../app-utils';
import type { ProjectRecord } from '../types';

interface ProcessingStatusPanelCopy {
  estimatedPoints: string;
  retryProcessing: string;
}

interface ProcessingStatusPanelProps {
  busy: boolean;
  copy: ProcessingStatusPanelCopy;
  locale: UiLocale;
  processingPanelDetail: string;
  processingPanelTitle: string;
  project: ProjectRecord;
  showProcessingUploadProgress: boolean;
  showResumeUploadAction: boolean;
  showRetryProcessingAction: boolean;
  uploadPaused: boolean;
  uploadPercent: number;
  workspacePointsEstimate: number;
  onCancelUpload: () => void;
  onPauseUpload: () => void;
  onResumeUpload: () => void;
  onRetryProcessing: () => void;
  onResumeProcessingUpload: () => void;
}

export function ProcessingStatusPanel({
  busy,
  copy,
  locale,
  processingPanelDetail,
  processingPanelTitle,
  project,
  showProcessingUploadProgress,
  showResumeUploadAction,
  showRetryProcessingAction,
  uploadPaused,
  uploadPercent,
  workspacePointsEstimate,
  onCancelUpload,
  onPauseUpload,
  onResumeProcessingUpload,
  onResumeUpload,
  onRetryProcessing
}: ProcessingStatusPanelProps) {
  return (
    <section className="panel processing-panel">
      <div className="processing-copy">
        <strong>{processingPanelTitle}</strong>
        <span>{processingPanelDetail}</span>
      </div>
      <div className="processing-stats">
        <div className="metric-box">
          <span>{copy.estimatedPoints}</span>
          <strong>{workspacePointsEstimate}</strong>
        </div>
        {showRetryProcessingAction && (
          <button className="ghost-button compact" type="button" onClick={onRetryProcessing} disabled={busy}>
            {copy.retryProcessing}
          </button>
        )}
        {showProcessingUploadProgress && (
          <>
            <button className="ghost-button compact" type="button" onClick={uploadPaused ? onResumeUpload : onPauseUpload}>
              {uploadPaused ? (locale === 'en' ? 'Resume upload' : '继续上传') : (locale === 'en' ? 'Pause upload' : '暂停上传')}
            </button>
            <button className="ghost-button compact" type="button" onClick={onCancelUpload}>
              {locale === 'en' ? 'Cancel upload' : '取消上传'}
            </button>
          </>
        )}
        {showResumeUploadAction && (
          <button className="solid-button small" type="button" onClick={onResumeProcessingUpload} disabled={busy}>
            {locale === 'en' ? 'Resume upload' : '继续上传'}
          </button>
        )}
      </div>
      <div className="progress-bar">
        <span className={getProgressWidthClass(getProjectProgress(project, uploadPercent))} />
      </div>
    </section>
  );
}
