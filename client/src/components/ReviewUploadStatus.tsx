import type { UiLocale } from '../app-copy';
import { getProgressWidthClass } from '../app-utils';

interface FailedUploadRetryItem {
  fileIdentity: string;
  fileName: string;
}

interface ReviewUploadStatusCopy {
  uploadOriginalsTitle: string;
  uploadStarting: string;
}

interface ReviewUploadStatusProps {
  busy: boolean;
  copy: ReviewUploadStatusCopy;
  failedUploadFiles: FailedUploadRetryItem[];
  locale: UiLocale;
  showReviewLocalImportProgress: boolean;
  showReviewUploadProgress: boolean;
  uploadPaused: boolean;
  uploadProgressLabel: string;
  uploadProgressWidth: number;
  onCancelUpload: () => void;
  onPauseUpload: () => void;
  onResumeUpload: () => void;
  onRetryAllUploadFiles: () => void;
  onRetryUploadFile: (fileIdentity: string) => void;
}

export function ReviewUploadStatus({
  busy,
  copy,
  failedUploadFiles,
  locale,
  showReviewLocalImportProgress,
  showReviewUploadProgress,
  uploadPaused,
  uploadProgressLabel,
  uploadProgressWidth,
  onCancelUpload,
  onPauseUpload,
  onResumeUpload,
  onRetryAllUploadFiles,
  onRetryUploadFile
}: ReviewUploadStatusProps) {
  const visibleFailedUploadFiles = failedUploadFiles.slice(0, 8);
  const hiddenFailedUploadFileCount = Math.max(0, failedUploadFiles.length - visibleFailedUploadFiles.length);

  return (
    <>
      {(showReviewLocalImportProgress || showReviewUploadProgress) && (
        <div className="review-upload-status" aria-live="polite">
          <div>
            <strong>{showReviewLocalImportProgress ? copy.uploadStarting : copy.uploadOriginalsTitle}</strong>
            <span>{uploadProgressLabel}</span>
          </div>
          <div className="upload-progress-bar">
            <span className={getProgressWidthClass(uploadProgressWidth, 5)} />
          </div>
          {showReviewUploadProgress && (
            <>
              <button className="ghost-button compact" type="button" onClick={uploadPaused ? onResumeUpload : onPauseUpload}>
                {uploadPaused ? (locale === 'en' ? 'Resume upload' : '继续上传') : (locale === 'en' ? 'Pause upload' : '暂停上传')}
              </button>
              <button className="ghost-button compact" type="button" onClick={onCancelUpload}>
                {locale === 'en' ? 'Cancel upload' : '取消上传'}
              </button>
            </>
          )}
        </div>
      )}

      {failedUploadFiles.length > 0 && (
        <div className="review-upload-status" aria-live="polite">
          <div>
            <strong>{locale === 'en' ? 'Files waiting for retry' : '等待重试的文件'}</strong>
            <span>
              {locale === 'en'
                ? `${failedUploadFiles.length} file${failedUploadFiles.length === 1 ? '' : 's'} need retry before processing starts.`
                : `${failedUploadFiles.length} 个文件需要重试后才能开始处理。`}
            </span>
          </div>
          <button
            className="primary-button compact"
            type="button"
            onClick={onRetryAllUploadFiles}
            disabled={busy}
          >
            {locale === 'en' ? 'Retry all failed files' : '重试全部失败文件'}
          </button>
          {visibleFailedUploadFiles.map((file) => (
            <button
              key={file.fileIdentity}
              className="ghost-button compact"
              type="button"
              onClick={() => onRetryUploadFile(file.fileIdentity)}
              disabled={busy}
            >
              {locale === 'en' ? `Retry ${file.fileName}` : `重试 ${file.fileName}`}
            </button>
          ))}
          {hiddenFailedUploadFileCount > 0 && (
            <span className="muted">
              {locale === 'en'
                ? `And ${hiddenFailedUploadFileCount} more.`
                : `还有 ${hiddenFailedUploadFileCount} 个文件。`}
            </span>
          )}
        </div>
      )}
    </>
  );
}
