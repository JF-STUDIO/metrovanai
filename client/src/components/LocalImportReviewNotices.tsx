interface LocalImportReviewNoticesCopy {
  localImportManualReviewNotice: (count: number) => string;
  localImportPreviewMissingNotice: (count: number) => string;
}

interface LocalImportReviewDiagnostics {
  manualReviewCount: number;
  previewMissingCount: number;
}

interface LocalImportReviewNoticesProps {
  copy: LocalImportReviewNoticesCopy;
  diagnostics: LocalImportReviewDiagnostics;
}

export function LocalImportReviewNotices({ copy, diagnostics }: LocalImportReviewNoticesProps) {
  if (diagnostics.manualReviewCount <= 0 && diagnostics.previewMissingCount <= 0) {
    return null;
  }

  return (
    <div className="local-import-review-notices" aria-live="polite">
      {diagnostics.manualReviewCount > 0 && (
        <div className="local-import-notice manual-review">
          {copy.localImportManualReviewNotice(diagnostics.manualReviewCount)}
        </div>
      )}
      {diagnostics.previewMissingCount > 0 && (
        <div className="local-import-notice preview-missing">
          {copy.localImportPreviewMissingNotice(diagnostics.previewMissingCount)}
        </div>
      )}
    </div>
  );
}
