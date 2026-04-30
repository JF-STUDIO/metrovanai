import type { UiLocale } from '../app-copy';

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
  onRetryUploadFile
}: ReviewUploadStatusProps) {
  return (
    <>
      {(showReviewLocalImportProgress || showReviewUploadProgress) && (
        <div className="review-upload-status" aria-live="polite">
          <div>
            <strong>{showReviewLocalImportProgress ? copy.uploadStarting : copy.uploadOriginalsTitle}</strong>
            <span>{uploadProgressLabel}</span>
          </div>
          <div className="upload-progress-bar">
            <span style={{ width: `${Math.max(6, uploadProgressWidth)}%` }} />
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
            <span>{locale === 'en' ? 'Retry one file at a time before processing starts.' : '处理开始前请逐个重试失败文件。'}</span>
          </div>
          {failedUploadFiles.map((file) => (
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
        </div>
      )}
    </>
  );
}
