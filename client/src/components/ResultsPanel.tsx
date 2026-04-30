import type { MutableRefObject } from 'react';
import type { UiLocale } from '../app-copy';
import {
  DEFAULT_REGENERATION_COLOR,
  formatPhotoCount,
  getHdrItemStatusLabel,
  getHdrPreviewUrl,
  getSelectedExposure,
  normalizeHex,
  normalizeHexDraft
} from '../app-utils';
import type { HdrItem, ResultAsset } from '../types';

interface ResultsPanelCopy {
  clickToView: string;
  colorDropper: string;
  colorDropperCompact: string;
  hdrItemFailed: string;
  noPreview: string;
  noResults: string;
  noResultsHint: string;
  regenerateResultCompact: string;
  regenerateResultFailed: string;
  regenerateResultHint: string;
  regeneratingResult: string;
  results: string;
  resultsHint: string;
  retryProcessing: string;
}

interface ResultsPanelProps {
  assets: ResultAsset[];
  busy: boolean;
  copy: ResultsPanelCopy;
  currentProjectId: string;
  currentProjectResultAssets: ResultAsset[];
  dragOverResultHdrItemId: string | null;
  draggedResultHdrItemId: string | null;
  failedResultHdrItems: HdrItem[];
  isDemoMode: boolean;
  locale: UiLocale;
  projectFreeRegenerationsRemaining: number;
  regenerationFreeLimit: number;
  resultCardRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  resultRegenerateBusy: Record<string, boolean>;
  resultThumbnailUrls: Record<string, string>;
  showRetryProcessingAction: boolean;
  getResultColorCard: (asset: ResultAsset) => string;
  onOpenViewer: (index: number) => void;
  onPickResultColor: (asset: ResultAsset) => void;
  onRegenerateResult: (asset: ResultAsset) => void;
  onReorderResults: (sourceHdrItemId: string, targetHdrItemId: string) => void;
  onRetryProcessing: () => void;
  onSetDragOverResultHdrItemId: (hdrItemId: string | null) => void;
  onSetDraggedResultHdrItemId: (hdrItemId: string | null) => void;
  onSetResultColorCard: (hdrItemId: string, color: string) => void;
  onSetResultDragPreview: (preview: { projectId: string; orderedHdrItemIds: string[] } | null) => void;
  onPreviewResultReorder: (sourceHdrItemId: string, targetHdrItemId: string) => void;
  resolveMediaUrl: (url: string | null) => string;
}

export function ResultsPanel({
  assets,
  busy,
  copy,
  currentProjectId,
  currentProjectResultAssets,
  dragOverResultHdrItemId,
  draggedResultHdrItemId,
  failedResultHdrItems,
  isDemoMode,
  locale,
  projectFreeRegenerationsRemaining,
  regenerationFreeLimit,
  resultCardRefs,
  resultRegenerateBusy,
  resultThumbnailUrls,
  showRetryProcessingAction,
  getResultColorCard,
  onOpenViewer,
  onPickResultColor,
  onPreviewResultReorder,
  onRegenerateResult,
  onReorderResults,
  onRetryProcessing,
  onSetDragOverResultHdrItemId,
  onSetDraggedResultHdrItemId,
  onSetResultColorCard,
  onSetResultDragPreview,
  resolveMediaUrl
}: ResultsPanelProps) {
  return (
    <section className="panel results-panel">
      <div className="panel-head">
        <div>
          <strong>{copy.results}</strong>
          <span className="muted">{copy.resultsHint}</span>
        </div>
        <div className="results-head-actions">
          <span className="meta-pill">{formatPhotoCount(currentProjectResultAssets.length, locale)}</span>
          {showRetryProcessingAction && (
            <button className="ghost-button compact" type="button" onClick={onRetryProcessing} disabled={busy}>
              {copy.retryProcessing}
            </button>
          )}
        </div>
      </div>
      {assets.length ? (
        <div className={`result-grid${draggedResultHdrItemId ? ' is-reordering' : ''}`}>
          {assets.map((asset, index) => {
            const previewUrl = resolveMediaUrl(resultThumbnailUrls[asset.id] ?? asset.previewUrl ?? asset.storageUrl);
            const regeneration = asset.regeneration;
            const isRegenerating = regeneration?.status === 'running' || Boolean(resultRegenerateBusy[asset.hdrItemId]);
            const selectedColorCard = getResultColorCard(asset);
            const normalizedSelectedColor = normalizeHex(selectedColorCard) ?? DEFAULT_REGENERATION_COLOR;
            return (
              <article
                key={asset.id}
                ref={(element) => {
                  resultCardRefs.current[asset.hdrItemId] = element;
                }}
                role="button"
                tabIndex={0}
                draggable
                className={`result-card${draggedResultHdrItemId === asset.hdrItemId ? ' dragging' : ''}${
                  dragOverResultHdrItemId === asset.hdrItemId ? ' drag-over' : ''
                }`}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('.result-regenerate-controls')) return;
                  onOpenViewer(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenViewer(index);
                  }
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', asset.hdrItemId);
                  onSetDraggedResultHdrItemId(asset.hdrItemId);
                  onSetResultDragPreview({
                    projectId: currentProjectId,
                    orderedHdrItemIds: currentProjectResultAssets.map((item) => item.hdrItemId)
                  });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (dragOverResultHdrItemId !== asset.hdrItemId) {
                    if (draggedResultHdrItemId) {
                      onPreviewResultReorder(draggedResultHdrItemId, asset.hdrItemId);
                    }
                    onSetDragOverResultHdrItemId(asset.hdrItemId);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverResultHdrItemId === asset.hdrItemId) {
                    onSetDragOverResultHdrItemId(null);
                  }
                }}
                onDragEnd={() => {
                  onSetDraggedResultHdrItemId(null);
                  onSetDragOverResultHdrItemId(null);
                  onSetResultDragPreview(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceHdrItemId = draggedResultHdrItemId || event.dataTransfer.getData('text/plain');
                  if (sourceHdrItemId) {
                    onReorderResults(sourceHdrItemId, asset.hdrItemId);
                  }
                }}
              >
                <div className="result-frame">
                  {previewUrl ? (
                    <img src={previewUrl} alt={asset.fileName} loading="lazy" decoding="async" />
                  ) : (
                    <div className={`asset-empty${isDemoMode ? ' demo-asset-empty demo-result-empty' : ''}`}>{isDemoMode ? '' : copy.noPreview}</div>
                  )}
                  {!isDemoMode && (
                    <div
                      className="result-regenerate-controls"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="result-card-selector">
                        <button
                          className="result-card-eyedropper"
                          type="button"
                          onClick={() => onPickResultColor(asset)}
                          disabled={isRegenerating}
                          title={copy.colorDropper}
                          aria-label={copy.colorDropper}
                        >
                          <svg className="result-card-eyedropper-swatch" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="11" fill={normalizedSelectedColor} />
                          </svg>
                          <svg className="result-card-eyedropper-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M14.8 4.2l5 5-2.1 2.1-1.1-1.1-6.5 6.5H7.8l-2.4 2.4-1.5-1.5 2.4-2.4v-2.3l6.5-6.5-1.1-1.1 2.1-2.1z" />
                            <path d="M8.4 14.8l5.7-5.7.8.8-5.7 5.7H8.4v-.8z" />
                          </svg>
                          <em>{copy.colorDropperCompact}</em>
                        </button>
                        <input
                          className="result-card-hex-input"
                          type="text"
                          inputMode="text"
                          value={selectedColorCard}
                          maxLength={7}
                          onChange={(event) => onSetResultColorCard(asset.hdrItemId, normalizeHexDraft(event.target.value))}
                          onBlur={(event) => {
                            const normalized = normalizeHex(event.target.value);
                            if (normalized) {
                              onSetResultColorCard(asset.hdrItemId, normalized);
                            }
                          }}
                          placeholder="#F2E8D8"
                          disabled={isRegenerating}
                        />
                        <button
                          className="result-regenerate-button"
                          type="button"
                          onClick={() => onRegenerateResult(asset)}
                          disabled={isRegenerating}
                          title={`${copy.regenerateResultHint} ${projectFreeRegenerationsRemaining}/${regenerationFreeLimit}`}
                        >
                          {isRegenerating ? copy.regeneratingResult : copy.regenerateResultCompact}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="result-body">
                  <strong>{asset.fileName}</strong>
                  <span>
                    {regeneration?.status === 'failed' && regeneration.errorMessage
                      ? `${copy.regenerateResultFailed}: ${regeneration.errorMessage}`
                      : copy.clickToView}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <strong>{copy.noResults}</strong>
          <span>{copy.noResultsHint}</span>
        </div>
      )}
      {failedResultHdrItems.length > 0 && (
        <div className="failed-results-block">
          <div className="panel-head compact">
            <div>
              <strong>{copy.hdrItemFailed}</strong>
              <span className="muted">{copy.retryProcessing}</span>
            </div>
          </div>
          <div className="result-grid failed-result-grid">
            {failedResultHdrItems.map((hdrItem) => {
              const previewUrl = getHdrPreviewUrl(hdrItem);
              const selectedExposure = getSelectedExposure(hdrItem);
              return (
                <article key={hdrItem.id} className="result-card failed-result-card">
                  <div className="result-frame">
                    {previewUrl ? (
                      <img src={previewUrl} alt={selectedExposure?.originalName ?? hdrItem.title} loading="lazy" decoding="async" />
                    ) : (
                      <div className="asset-empty">{copy.noPreview}</div>
                    )}
                  </div>
                  <div className="result-body">
                    <strong>{selectedExposure?.originalName ?? hdrItem.title}</strong>
                    <span>{getHdrItemStatusLabel(hdrItem, locale)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
