interface ReviewPanelHeaderCopy {
  addPhotos: string;
  confirmSend: string;
  createGroup: string;
  processingGroupsHint: string;
  processingGroupsTitle: string;
  reviewGrouping: string;
  reviewGroupingHint: string;
  uploadOriginalsTitle: string;
}

interface ReviewPanelHeaderProps {
  busy: boolean;
  copy: ReviewPanelHeaderCopy;
  showAdvancedGroupingControls: boolean;
  showProcessingGroupGrid: boolean;
  showReviewActions: boolean;
  showReviewUploadProgress: boolean;
  uploadActive: boolean;
  workspaceHdrItemCount: number;
  onAddPhotos: () => void;
  onConfirmSend: () => void;
  onCreateGroup: () => void;
}

export function ReviewPanelHeader({
  busy,
  copy,
  showAdvancedGroupingControls,
  showProcessingGroupGrid,
  showReviewActions,
  showReviewUploadProgress,
  uploadActive,
  workspaceHdrItemCount,
  onAddPhotos,
  onConfirmSend,
  onCreateGroup
}: ReviewPanelHeaderProps) {
  return (
    <div className="panel-head">
      <div>
        <strong>{showProcessingGroupGrid ? copy.processingGroupsTitle : copy.reviewGrouping}</strong>
        <span className="muted">{showProcessingGroupGrid ? copy.processingGroupsHint : copy.reviewGroupingHint}</span>
      </div>
      {showReviewActions && (
        <div className="review-actions">
          {showAdvancedGroupingControls && (
            <button className="ghost-button small" type="button" onClick={onCreateGroup}>
              {copy.createGroup}
            </button>
          )}
          <button className="ghost-button small" type="button" onClick={onAddPhotos} disabled={busy || uploadActive}>
            {copy.addPhotos}
          </button>
          <button className="solid-button small" type="button" onClick={onConfirmSend} disabled={busy || !workspaceHdrItemCount}>
            {showReviewUploadProgress ? copy.uploadOriginalsTitle : copy.confirmSend}
          </button>
        </div>
      )}
    </div>
  );
}
