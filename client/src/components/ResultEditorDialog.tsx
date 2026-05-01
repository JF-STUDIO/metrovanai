import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import {
  RESULT_EDITOR_ASPECT_RATIOS,
  RESULT_EDITOR_CONTROL_GROUPS,
  buildResultCropFrameStyle,
  buildResultEditorImageStyle,
  clampEditorValue,
  type ResultColorCard,
  type ResultCropFrameDragMode,
  type ResultEditorAspectRatio,
  type ResultEditorSettings
} from '../app-utils';
import type { ResultAsset } from '../types';

interface ResultEditorDialogCopy {
  colorCardNo: string;
  colorDropper: string;
  deleteColorCard: string;
  regeneratePanelHint: string;
  regeneratePanelTitle: string;
  regenerateResult: string;
  regenerateResultHint: string;
  regeneratingResult: string;
  saveColorCard: string;
}

interface ResultEditorDialogProps {
  asset: ResultAsset;
  aspectRatio: string | undefined;
  availableColorCards: ResultColorCard[];
  canvasRef: RefObject<HTMLDivElement | null>;
  copy: ResultEditorDialogCopy;
  currentColor: string;
  currentProjectName: string;
  freeRegenerationsRemaining: number;
  isRegenerating: boolean;
  normalizedColor: string;
  safeViewerIndex: number;
  settings: ResultEditorSettings;
  viewerAssets: ResultAsset[];
  regenerationFreeLimit: number;
  onApplyColorCard: (asset: ResultAsset, color: string) => void;
  onClose: () => void;
  onColorBlur: (asset: ResultAsset, value: string) => void;
  onColorDraftChange: (asset: ResultAsset, value: string) => void;
  onCropFrameDragStart: (event: ReactPointerEvent<HTMLElement>, mode: ResultCropFrameDragMode) => void;
  onDeleteColorCard: (card: ResultColorCard) => void;
  onDownload: (asset: ResultAsset) => void;
  onPickColor: (asset: ResultAsset) => void;
  onRegenerate: (asset: ResultAsset) => void;
  onReset: (assetId: string) => void;
  onSelectViewerIndex: (index: number) => void;
  onShiftViewer: (delta: 1 | -1) => void;
  onUpdateAspectRatio: (assetId: string, aspectRatio: ResultEditorAspectRatio) => void;
  onUpdateSettings: (assetId: string, patch: Partial<ResultEditorSettings>) => void;
  onSaveColorCard: (asset: ResultAsset) => void;
  onStagePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStagePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStagePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStageWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  resolveMediaUrl: (url: string | null) => string;
}

export function ResultEditorDialog({
  asset,
  aspectRatio,
  availableColorCards,
  canvasRef,
  copy,
  currentColor,
  currentProjectName,
  freeRegenerationsRemaining,
  isRegenerating,
  normalizedColor,
  safeViewerIndex,
  settings,
  viewerAssets,
  regenerationFreeLimit,
  onApplyColorCard,
  onClose,
  onColorBlur,
  onColorDraftChange,
  onCropFrameDragStart,
  onDeleteColorCard,
  onDownload,
  onPickColor,
  onRegenerate,
  onReset,
  onSaveColorCard,
  onSelectViewerIndex,
  onShiftViewer,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  onStageWheel,
  onUpdateAspectRatio,
  onUpdateSettings,
  resolveMediaUrl
}: ResultEditorDialogProps) {
  const editorImageRef = useRef<HTMLImageElement | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (aspectRatio) {
      canvas.style.aspectRatio = aspectRatio;
    } else {
      canvas.style.removeProperty('aspect-ratio');
    }
  }, [aspectRatio, canvasRef]);

  useEffect(() => {
    const image = editorImageRef.current;
    if (!image) return;
    const imageStyle = buildResultEditorImageStyle(settings);
    image.style.filter = imageStyle.filter;
    image.style.transform = imageStyle.transform;
  }, [settings]);

  useEffect(() => {
    const cropFrame = cropFrameRef.current;
    if (!cropFrame) return;
    const frameStyle = buildResultCropFrameStyle(settings);
    cropFrame.style.left = frameStyle.left;
    cropFrame.style.top = frameStyle.top;
    cropFrame.style.width = frameStyle.width;
    cropFrame.style.height = frameStyle.height;
  }, [settings]);

  const editorImageUrl = resolveMediaUrl(asset.storageUrl);

  return (
    <div className="viewer-backdrop result-editor-backdrop" onClick={onClose}>
      <div className="result-editor-shell" onClick={(event) => event.stopPropagation()}>
        <header className="result-editor-topbar">
          <div className="result-editor-title">
            <strong>{asset.fileName}</strong>
            <span>
              {currentProjectName} · {safeViewerIndex + 1}/{viewerAssets.length}
            </span>
          </div>
          <div className="result-editor-actions">
            <button className="result-editor-deliver" type="button" onClick={onClose}>
              Deliver
            </button>
            <button className="result-editor-icon-button" type="button" onClick={() => onDownload(asset)} aria-label="Download result">
              ↓
            </button>
            <button className="result-editor-icon-button" type="button" onClick={() => onReset(asset.id)} aria-label="Reset result editor">
              ↺
            </button>
            <button className="result-editor-icon-button" type="button" onClick={onClose} aria-label="Close result editor">
              ×
            </button>
          </div>
        </header>

        <div className="result-editor-main">
          <section className="result-editor-stage">
            {viewerAssets.length > 1 && (
              <button className="viewer-arrow large left result-editor-nav" type="button" onClick={() => onShiftViewer(-1)}>
                {'<'}
              </button>
            )}
            <div
              className={`result-editor-canvas crop-adjustable${aspectRatio ? ' cropped' : ''}`}
              ref={canvasRef}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
              onWheel={onStageWheel}
            >
              {editorImageUrl ? (
                <img
                  ref={editorImageRef}
                  src={editorImageUrl}
                  alt={asset.fileName}
                  decoding="async"
                  draggable={false}
                />
              ) : (
                <div className="asset-empty demo-asset-empty demo-result-empty" aria-label={asset.fileName} />
              )}
              <div
                ref={cropFrameRef}
                className="result-editor-crop-frame"
                onPointerDown={(event) => onCropFrameDragStart(event, 'move')}
              >
                <span className="result-editor-crop-grid" aria-hidden="true" />
                {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                  <span
                    key={handle}
                    className={`result-editor-crop-handle ${handle}`}
                    onPointerDown={(event) => onCropFrameDragStart(event, handle)}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
            {viewerAssets.length > 1 && (
              <button className="viewer-arrow large right result-editor-nav" type="button" onClick={() => onShiftViewer(1)}>
                {'>'}
              </button>
            )}
          </section>

          <aside className="result-editor-panel">
            <div className="result-editor-panel-head">
              <strong>Edit</strong>
              <span>›</span>
            </div>

            <div className="result-editor-section result-editor-regenerate-section">
              <div className="result-editor-regenerate-head">
                <div>
                  <h3>{copy.regeneratePanelTitle}</h3>
                  <p>{copy.regeneratePanelHint}</p>
                </div>
                <button
                  className="result-editor-regenerate-button"
                  type="button"
                  onClick={() => onRegenerate(asset)}
                  disabled={isRegenerating}
                  title={`${copy.regenerateResultHint} ${freeRegenerationsRemaining}/${regenerationFreeLimit}`}
                >
                  {isRegenerating ? copy.regeneratingResult : copy.regenerateResult}
                </button>
              </div>

              <div className="result-editor-color-input-row">
                <button
                  className="result-editor-eyedropper"
                  type="button"
                  onClick={() => onPickColor(asset)}
                  disabled={isRegenerating}
                  title={copy.colorDropper}
                >
                  <svg className="result-editor-eyedropper-swatch" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="1" y="1" width="22" height="22" rx="5" fill={normalizedColor} />
                  </svg>
                  <b>⌖</b>
                </button>
                <label>
                  <span>{copy.colorCardNo}</span>
                  <input
                    type="text"
                    inputMode="text"
                    value={currentColor}
                    onChange={(event) => onColorDraftChange(asset, event.target.value)}
                    onBlur={(event) => onColorBlur(asset, event.target.value)}
                    placeholder="#F2E8D8"
                    maxLength={7}
                  />
                </label>
                <button className="result-editor-save-card" type="button" onClick={() => onSaveColorCard(asset)}>
                  {copy.saveColorCard}
                </button>
              </div>

              <div className="result-editor-color-cards">
                {availableColorCards.map((card) => {
                  const isActive = card.color.toUpperCase() === normalizedColor;
                  return (
                    <div className={`result-editor-color-card${isActive ? ' active' : ''}${card.source === 'saved' ? ' saved' : ''}`} key={card.id}>
                      <button type="button" onClick={() => onApplyColorCard(asset, card.color)}>
                        <svg className="result-editor-color-card-swatch" viewBox="0 0 100 30" aria-hidden="true">
                          <rect x="0" y="0" width="100" height="30" rx="6" fill={card.color} />
                        </svg>
                        <strong>{card.label}</strong>
                        <em>{card.color}</em>
                      </button>
                      {card.source === 'saved' && (
                        <button
                          className="result-editor-color-card-delete"
                          type="button"
                          onClick={() => onDeleteColorCard(card)}
                          aria-label={`${copy.deleteColorCard} ${card.color}`}
                          title={copy.deleteColorCard}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {RESULT_EDITOR_CONTROL_GROUPS.map((group) => (
              <div className="result-editor-section" key={group.title}>
                <h3>{group.title}</h3>
                <div className="result-slider-stack">
                  {group.controls.map((control) => (
                    <label className="result-slider-row" key={control.key}>
                      <span>{control.label}</span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step ?? 1}
                        value={settings[control.key]}
                        onChange={(event) =>
                          onUpdateSettings(asset.id, {
                            [control.key]: clampEditorValue(Number(event.target.value), control.min, control.max)
                          })
                        }
                      />
                      <output>{settings[control.key]}</output>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="result-editor-section">
              <h3>ASPECT RATIO</h3>
              <div className="result-aspect-grid">
                {RESULT_EDITOR_ASPECT_RATIOS.map((targetAspectRatio) => (
                  <button
                    key={targetAspectRatio.value}
                    type="button"
                    className={settings.aspectRatio === targetAspectRatio.value ? 'active' : ''}
                    onClick={() => onUpdateAspectRatio(asset.id, targetAspectRatio.value)}
                  >
                    {targetAspectRatio.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {viewerAssets.length > 1 && (
          <div className="result-editor-filmstrip">
            {viewerAssets.map((viewerAsset, index) => (
              <button
                key={viewerAsset.id}
                type="button"
                className={`viewer-thumb${index === safeViewerIndex ? ' active' : ''}`}
                onClick={() => onSelectViewerIndex(index)}
              >
                <img src={resolveMediaUrl(viewerAsset.previewUrl ?? viewerAsset.storageUrl)} alt={viewerAsset.fileName} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
