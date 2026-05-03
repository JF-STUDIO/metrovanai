import type { ChangeEvent } from 'react';
import { LocalImportReviewNotices } from './LocalImportReviewNotices';
import { ProcessingStatusPanel } from './ProcessingStatusPanel';
import { ProjectStepStrip } from './ProjectStepStrip';
import { ProjectWorkspaceHeader } from './ProjectWorkspaceHeader';
import { ResultsPanel } from './ResultsPanel';
import { ReviewGroupsPanel } from './ReviewGroupsPanel';
import { ReviewPanelHeader } from './ReviewPanelHeader';
import { ReviewUploadStatus } from './ReviewUploadStatus';
import { StudioFeatureLaunchPanel } from './StudioFeatureLaunchPanel';
import { StudioHeader } from './StudioHeader';
import { StudioOverlays } from './StudioOverlays';
import { UploadDropzone } from './UploadDropzone';

interface StudioWorkspaceShellProps {
  currentProject: any;
  fileInput: any;
  header: any;
  isDemoMode: boolean;
  launch: any;
  message: string;
  overlays: any;
  processing: any;
  results: any;
  review: any;
  steps: any;
  upload: any;
  workspaceHeader: any;
}

export function StudioWorkspaceShell({
  currentProject,
  fileInput,
  header,
  isDemoMode,
  launch,
  message,
  overlays,
  processing,
  results,
  review,
  steps,
  upload,
  workspaceHeader
}: StudioWorkspaceShellProps) {
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    fileInput.onUpload(files);
  };

  return (
    <>
      <main className={`studio-shell${isDemoMode ? ' demo-shell' : ''}`}>
        <div className="ambient-layer studio-ambient" />
        <StudioHeader {...header} />

        {message && <div className="global-message">{message}</div>}

        <div className="studio-layout">
          <section className="workspace">
            {!currentProject ? (
              <StudioFeatureLaunchPanel {...launch} />
            ) : (
              <>
                <ProjectWorkspaceHeader {...workspaceHeader} project={currentProject} />

                <ProjectStepStrip {...steps} project={currentProject} />

                {processing.show && !isDemoMode && (
                  <ProcessingStatusPanel {...processing.props} project={currentProject} />
                )}

                {upload.show && !isDemoMode && <UploadDropzone {...upload.props} />}

                {review.show && (
                  <>
                    {isDemoMode && (
                      <section className="panel demo-toolbar-panel">
                        <div className="demo-toolbar-actions">
                          <button className="ghost-button compact" type="button">
                            {review.copy.demoVerticalFix}
                          </button>
                          <button className="ghost-button compact" type="button">
                            {review.copy.demoCheckGrouping}
                          </button>
                          <button className="ghost-button compact" type="button">
                            {review.copy.demoAdjustGrouping}
                          </button>
                        </div>
                        <button className="solid-button small demo-send-button" type="button">
                          {review.copy.sendToProcess}
                        </button>
                      </section>
                    )}

                    <section className="panel review-panel">
                      {!isDemoMode && <ReviewPanelHeader {...review.header} />}

                      {!isDemoMode && <ReviewUploadStatus {...review.uploadStatus} />}

                      {!isDemoMode && review.showLocalImportDiagnostics && review.localDraftDiagnostics && (
                        <LocalImportReviewNotices
                          copy={review.copy}
                          diagnostics={review.localDraftDiagnostics}
                        />
                      )}

                      <ReviewGroupsPanel {...review.groups} />
                    </section>
                  </>
                )}

                {results.show && <ResultsPanel {...results.props} />}
              </>
            )}
          </section>
        </div>

        <input
          ref={fileInput.inputRef}
          hidden
          multiple
          type="file"
          accept={fileInput.accept}
          onChange={handleFileInputChange}
        />
      </main>

      <StudioOverlays {...overlays} />
    </>
  );
}
