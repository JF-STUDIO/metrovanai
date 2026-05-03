interface ReviewGroupsPanelProps {
  activeLocalDraft: any;
  canEditHdrGrouping: boolean;
  copy: any;
  getColorModeLabel: (mode: any, locale: any) => string;
  getGroupColorDraft: (group: any) => string;
  getGroupItems: (group: any, project: any) => any[];
  getHdrItemStatusLabel: (item: any, locale: any) => string;
  getHdrLocalReviewState: (item: any) => string | null;
  getHdrPreviewUrl: (item: any) => string | null;
  getLocalReviewCopy: any;
  getSceneLabel: (sceneType: any, locale: any) => string;
  getSelectedExposure: (item: any) => any;
  handleApplyGroupColor: (group: any) => void | Promise<void>;
  handleDeleteHdr: (item: any) => void | Promise<void>;
  handleHdrExposureSwipeEnd: (item: any, event: any) => void;
  handleHdrExposureSwipeStart: (item: any, event: any) => void;
  handleMergeLocalHdrItem: (sourceId: string, targetId: string) => void;
  handleMoveHdrItem: (item: any, groupId: string) => void | Promise<void>;
  handleSceneChange: (group: any, sceneType: any) => void | Promise<void>;
  handleShiftExposure: any;
  handleSplitLocalHdrItem: (itemId: string) => void;
  handleColorModeChange: (group: any, mode: any) => void | Promise<void>;
  hdrExposureSwipeRef: any;
  isDemoMode: boolean;
  isHdrItemProcessing: any;
  locale: any;
  setGroupColorOverrides: (updater: any) => void;
  showAdvancedGroupingControls: boolean;
  showProcessingGroupGrid: boolean;
  workspaceGroups: any[];
  workspaceHdrItems: any[];
  workspaceReviewProject: any;
}

function formatReviewGroupSummary(itemCount: number, exposureCount: number, locale: any) {
  return locale === 'en'
    ? `${itemCount} groups · ${exposureCount} exposures`
    : `${itemCount} 组 · ${exposureCount} 张曝光`;
}

export function ReviewGroupsPanel({
  activeLocalDraft,
  canEditHdrGrouping,
  copy,
  getColorModeLabel,
  getGroupColorDraft,
  getGroupItems,
  getHdrItemStatusLabel,
  getHdrLocalReviewState,
  getHdrPreviewUrl,
  getLocalReviewCopy,
  getSceneLabel,
  getSelectedExposure,
  handleApplyGroupColor,
  handleColorModeChange,
  handleDeleteHdr,
  handleHdrExposureSwipeEnd,
  handleHdrExposureSwipeStart,
  handleMergeLocalHdrItem,
  handleMoveHdrItem,
  handleSceneChange,
  handleShiftExposure,
  handleSplitLocalHdrItem,
  hdrExposureSwipeRef,
  isDemoMode,
  isHdrItemProcessing,
  locale,
  setGroupColorOverrides,
  showAdvancedGroupingControls,
  showProcessingGroupGrid,
  workspaceGroups,
  workspaceHdrItems,
  workspaceReviewProject
}: ReviewGroupsPanelProps) {
  return (
    <div className="group-list">
      {workspaceGroups.map((group) => {
        const groupItems = getGroupItems(group, workspaceReviewProject ?? { hdrItems: [] });
        return (
          <article key={group.id} className="group-card">
            <div className="group-card-head">
              <div>
                <strong>{group.name}</strong>
                <span>{formatReviewGroupSummary(groupItems.length, groupItems.reduce((sum, item) => sum + item.exposures.length, 0), locale)}</span>
              </div>
              {!isDemoMode && showAdvancedGroupingControls && (
                <div className="group-chips">
                  <span className="meta-pill">{getSceneLabel(group.sceneType, locale)}</span>
                  <span className="meta-pill">{getColorModeLabel(group.colorMode, locale)}</span>
                </div>
              )}
            </div>

            {showAdvancedGroupingControls && (
              <div className="group-controls">
                {!isDemoMode && (
                  <div className="segmented">
                    {(['interior', 'exterior', 'pending'] as const).map((sceneType) => (
                      <button
                        key={sceneType}
                        type="button"
                        className={group.sceneType === sceneType ? 'active' : ''}
                        onClick={() => void handleSceneChange(group, sceneType)}
                      >
                        {getSceneLabel(sceneType, locale)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="segmented">
                  {(['default', 'replace'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={group.colorMode === mode ? 'active' : ''}
                      onClick={() => void handleColorModeChange(group, mode)}
                    >
                      {getColorModeLabel(mode, locale)}
                    </button>
                  ))}
                </div>

                {isDemoMode && (
                  <div className="demo-group-scene-chip">
                    <span className="meta-pill">{getSceneLabel(group.sceneType, locale)}</span>
                  </div>
                )}

                {group.colorMode === 'replace' && (
                  <div className="color-editor">
                    <input
                      value={getGroupColorDraft(group)}
                      onChange={(event) =>
                        setGroupColorOverrides((current: Record<string, string>) => ({
                          ...current,
                          [group.id]: event.target.value.toUpperCase()
                        }))
                      }
                      placeholder="#D2CBC1"
                    />
                    <button className="solid-button small" type="button" onClick={() => void handleApplyGroupColor(group)}>
                      {copy.apply}
                    </button>
                  </div>
                )}
              </div>
            )}

            {showAdvancedGroupingControls && group.colorMode === 'replace' && <p className="group-note">{copy.groupNote}</p>}

            <div className="asset-grid">
              {groupItems.map((hdrItem) => {
                const previewUrl = getHdrPreviewUrl(hdrItem);
                const selectedExposure = getSelectedExposure(hdrItem);
                const selectedIndex = hdrItem.exposures.findIndex((exposure: any) => exposure.id === hdrItem.selectedExposureId);
                const hdrItemProcessing = showProcessingGroupGrid && isHdrItemProcessing(hdrItem.status);
                const hdrItemCompleted = showProcessingGroupGrid && hdrItem.status === 'completed';
                const hdrItemFailed = showProcessingGroupGrid && hdrItem.status === 'error';
                const localReviewState = activeLocalDraft && canEditHdrGrouping ? getHdrLocalReviewState(hdrItem) : null;
                const localReviewCopy = localReviewState && localReviewState !== 'normal' ? getLocalReviewCopy(localReviewState, locale) : null;
                const emptyPreviewLabel = activeLocalDraft ? copy.localPreviewUnavailable : copy.noPreview;
                const showAssetReviewControls = canEditHdrGrouping && !showProcessingGroupGrid;
                const showManualHdrTools = Boolean(activeLocalDraft && showAssetReviewControls);
                return (
                  <article
                    key={hdrItem.id}
                    className={`asset-card${localReviewState ? ` local-review-${localReviewState}` : ''}${
                      hdrItemProcessing ? ' is-processing' : ''
                    }${hdrItemCompleted ? ' is-completed' : ''}${hdrItemFailed ? ' is-error' : ''}`}
                  >
                    <div
                      className="asset-frame"
                      onPointerDown={
                        showAssetReviewControls && hdrItem.exposures.length > 1
                          ? (event) => handleHdrExposureSwipeStart(hdrItem, event)
                          : undefined
                      }
                      onPointerUp={
                        showAssetReviewControls && hdrItem.exposures.length > 1
                          ? (event) => handleHdrExposureSwipeEnd(hdrItem, event)
                          : undefined
                      }
                      onPointerCancel={() => {
                        hdrExposureSwipeRef.current = null;
                      }}
                    >
                      {previewUrl ? (
                        <img src={previewUrl} alt={hdrItem.title} loading="lazy" decoding="async" />
                      ) : (
                        <div className={`asset-empty${isDemoMode ? ' demo-asset-empty' : ''}`}>{isDemoMode ? '' : emptyPreviewLabel}</div>
                      )}
                      {hdrItemProcessing && (
                        <div className="asset-processing-layer" aria-label={copy.hdrItemProcessing}>
                          <span className="asset-spinner" />
                          <strong>{copy.hdrItemProcessing}</strong>
                        </div>
                      )}
                      {showAssetReviewControls && (
                        <div className="asset-overlay">
                          <span className="asset-index">{hdrItem.index}</span>
                          <span className="asset-count">{selectedIndex + 1}/{hdrItem.exposures.length}</span>
                          <button className="asset-delete" type="button" onClick={() => void handleDeleteHdr(hdrItem)}>
                            {copy.delete}
                          </button>
                        </div>
                      )}
                      {hdrItem.exposures.length > 1 && showAssetReviewControls && (
                        <>
                          <button
                            className="viewer-arrow left"
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onPointerUp={(event) => event.stopPropagation()}
                            onClick={() => void handleShiftExposure(hdrItem, -1)}
                          >
                            {'<'}
                          </button>
                          <button
                            className="viewer-arrow right"
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onPointerUp={(event) => event.stopPropagation()}
                            onClick={() => void handleShiftExposure(hdrItem, 1)}
                          >
                            {'>'}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="asset-body">
                      <strong>{selectedExposure?.originalName ?? hdrItem.title}</strong>
                      {!showProcessingGroupGrid && <span>{hdrItem.statusText}</span>}
                      {showProcessingGroupGrid && hdrItemFailed && <span>{getHdrItemStatusLabel(hdrItem, locale)}</span>}
                      {showAssetReviewControls && localReviewCopy && (
                        <div className={`asset-local-review ${localReviewState}`}>
                          <strong>{localReviewCopy.title}</strong>
                          <span>{localReviewCopy.hint}</span>
                        </div>
                      )}
                      {showManualHdrTools && workspaceHdrItems.length > 1 && (
                        <div className="hdr-manual-tools">
                          <span>{copy.mergeHdrGroup}</span>
                          <select
                            value=""
                            onChange={(event) => {
                              const targetHdrItemId = event.target.value;
                              if (targetHdrItemId) {
                                handleMergeLocalHdrItem(hdrItem.id, targetHdrItemId);
                              }
                            }}
                          >
                            <option value="">{copy.mergeHdrPlaceholder}</option>
                            {workspaceHdrItems
                              .filter((option) => option.id !== hdrItem.id)
                              .map((option) => (
                                <option key={option.id} value={option.id}>
                                  HDR {option.index}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                      {showManualHdrTools && hdrItem.exposures.length > 1 && (
                        <button className="ghost-button compact hdr-split-button" type="button" onClick={() => handleSplitLocalHdrItem(hdrItem.id)}>
                          {copy.splitHdrGroup}
                        </button>
                      )}
                      {showAdvancedGroupingControls && (
                        <select value={hdrItem.groupId} onChange={(event) => void handleMoveHdrItem(hdrItem, event.target.value)}>
                          {workspaceGroups.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
