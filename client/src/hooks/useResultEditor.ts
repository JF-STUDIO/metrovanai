import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { ResultAsset } from '../types';
import {
  DEFAULT_REGENERATION_COLOR,
  DEFAULT_RESULT_EDITOR_SETTINGS,
  RESULT_COLOR_CARD_STORAGE_KEY,
  buildResultCropFramePatch,
  clampEditorValue,
  clampIndex,
  clampResultCropFrame,
  getAspectRatioNumber,
  getAspectRatioValue,
  getAvailableResultColorCards,
  getDefaultCropFrameForAspect,
  getResultCropFrame,
  getStoredResultColorCards,
  getUserFacingErrorMessage,
  normalizeHex,
  type ResultColorCard,
  type ResultCropDragState,
  type ResultCropFrame,
  type ResultCropFrameDragState,
  type ResultCropFrameDragMode,
  type ResultEditorAspectRatio,
  type ResultEditorSettings,
  type WindowWithEyeDropper
} from '../app-utils';
import type { UiLocale } from '../app-copy';

interface UseResultEditorInput {
  copy: any;
  locale: UiLocale;
  resultAssets: ResultAsset[];
  resultRegenerateBusy: Record<string, boolean>;
  resolveMediaUrl: (url: string | null) => string;
  setMessage: (message: string) => void;
}

export function useResultEditor({
  copy,
  locale,
  resultAssets,
  resultRegenerateBusy,
  resolveMediaUrl,
  setMessage
}: UseResultEditorInput) {
  const [resultViewerIndex, setResultViewerIndex] = useState<number | null>(null);
  const [resultEditorSettings, setResultEditorSettings] = useState<Record<string, ResultEditorSettings>>({});
  const [resultColorCards, setResultColorCards] = useState<Record<string, string>>({});
  const [savedResultColorCards, setSavedResultColorCards] = useState<ResultColorCard[]>(getStoredResultColorCards);
  const resultCropDragRef = useRef<ResultCropDragState | null>(null);
  const resultCropFrameDragRef = useRef<ResultCropFrameDragState | null>(null);
  const resultCanvasRef = useRef<HTMLDivElement | null>(null);

  const availableResultColorCards = useMemo(
    () => getAvailableResultColorCards(savedResultColorCards, locale),
    [locale, savedResultColorCards]
  );
  const viewerAssets = resultAssets;
  const safeViewerIndex = resultViewerIndex === null ? null : clampIndex(resultViewerIndex, viewerAssets.length);
  const currentViewerAsset = safeViewerIndex !== null ? viewerAssets[safeViewerIndex] ?? null : null;
  const currentViewerSettings = currentViewerAsset
    ? resultEditorSettings[currentViewerAsset.id] ?? DEFAULT_RESULT_EDITOR_SETTINGS
    : DEFAULT_RESULT_EDITOR_SETTINGS;
  const currentViewerAspectRatio = getAspectRatioValue(currentViewerSettings.aspectRatio);
  const currentViewerSelectedColor = currentViewerAsset ? getResultColorCard(currentViewerAsset) : DEFAULT_REGENERATION_COLOR;
  const currentViewerNormalizedColor = normalizeHex(currentViewerSelectedColor) ?? DEFAULT_REGENERATION_COLOR;
  const currentViewerRegeneration = currentViewerAsset?.regeneration ?? null;
  const currentViewerIsRegenerating =
    Boolean(currentViewerAsset && resultRegenerateBusy[currentViewerAsset.hdrItemId]) ||
    currentViewerRegeneration?.status === 'running';

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RESULT_COLOR_CARD_STORAGE_KEY,
        JSON.stringify(savedResultColorCards.map(({ id, label, color }) => ({ id, label, color })))
      );
    } catch {
      // Color card persistence is best effort; regeneration still works without it.
    }
  }, [savedResultColorCards]);

  function getResultColorCard(asset: ResultAsset) {
    return resultColorCards[asset.hdrItemId] ?? asset.regeneration?.colorCardNo ?? DEFAULT_REGENERATION_COLOR;
  }

  async function handlePickResultColor(asset: ResultAsset) {
    const EyeDropper = (window as WindowWithEyeDropper).EyeDropper;
    if (!EyeDropper) {
      setMessage(copy.colorDropperUnsupported);
      return;
    }

    try {
      const result = await new EyeDropper().open();
      const normalized = normalizeHex(result.sRGBHex);
      if (!normalized) {
        setMessage(copy.colorDropperFailed);
        return;
      }
      setResultColorCards((current) => ({
        ...current,
        [asset.hdrItemId]: normalized
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      setMessage(copy.colorDropperFailed);
    }
  }

  function applyResultColorCard(asset: ResultAsset, color: string) {
    const normalized = normalizeHex(color);
    if (!normalized) return;
    setResultColorCards((current) => ({
      ...current,
      [asset.hdrItemId]: normalized
    }));
  }

  function saveResultColorCard(asset: ResultAsset) {
    const normalized = normalizeHex(getResultColorCard(asset));
    if (!normalized) {
      setMessage(copy.regenerateColorInvalid);
      return;
    }

    const existingColors = new Set(availableResultColorCards.map((card) => card.color.toUpperCase()));
    if (existingColors.has(normalized)) {
      setMessage(copy.colorCardAlreadySaved);
      return;
    }

    const nextCard: ResultColorCard = {
      id: `saved-${Date.now().toString(36)}-${normalized.slice(1).toLowerCase()}`,
      label: normalized,
      color: normalized,
      source: 'saved'
    };
    setSavedResultColorCards((current) => [...current, nextCard]);
    setMessage(copy.colorCardSaved);
  }

  function deleteResultColorCard(card: ResultColorCard) {
    if (card.source !== 'saved') return;
    if (!window.confirm(copy.deleteColorCardConfirm(card.color))) return;

    setSavedResultColorCards((current) => current.filter((item) => item.id !== card.id));
    setMessage(copy.colorCardDeleted);
  }

  function openViewer(index: number) {
    setResultViewerIndex(index);
  }

  function updateResultEditorSettings(assetId: string, patch: Partial<ResultEditorSettings>) {
    setResultEditorSettings((current) => ({
      ...current,
      [assetId]: {
        ...(current[assetId] ?? DEFAULT_RESULT_EDITOR_SETTINGS),
        ...patch
      }
    }));
  }

  function updateResultAspectRatio(assetId: string, aspectRatio: ResultEditorAspectRatio) {
    const rect = resultCanvasRef.current?.getBoundingClientRect();
    updateResultEditorSettings(assetId, {
      aspectRatio,
      ...buildResultCropFramePatch(getDefaultCropFrameForAspect(aspectRatio, rect?.width, rect?.height))
    });
  }

  function startResultCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!currentViewerAsset) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.currentTarget;
    const settings = resultEditorSettings[currentViewerAsset.id] ?? DEFAULT_RESULT_EDITOR_SETTINGS;
    resultCropDragRef.current = {
      assetId: currentViewerAsset.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: settings.cropX,
      originY: settings.cropY,
      width: Math.max(1, target.clientWidth),
      height: Math.max(1, target.clientHeight)
    };
    target.setPointerCapture(event.pointerId);
  }

  function startResultCropFrameDrag(event: ReactPointerEvent<HTMLElement>, mode: ResultCropFrameDragMode) {
    if (!currentViewerAsset) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const settings = resultEditorSettings[currentViewerAsset.id] ?? DEFAULT_RESULT_EDITOR_SETTINGS;

    resultCropFrameDragRef.current = {
      assetId: currentViewerAsset.id,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: getResultCropFrame(settings),
      canvasWidth: Math.max(1, rect.width),
      canvasHeight: Math.max(1, rect.height),
      aspectRatio: getAspectRatioNumber(settings.aspectRatio)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function buildResizedCropFrame(dragState: ResultCropFrameDragState, deltaX: number, deltaY: number): ResultCropFrame {
    const start = dragState.startFrame;
    const canvasWidth = dragState.canvasWidth;
    const canvasHeight = dragState.canvasHeight;

    if (dragState.mode === 'move') {
      return clampResultCropFrame({
        ...start,
        x: start.x + (deltaX / canvasWidth) * 100,
        y: start.y + (deltaY / canvasHeight) * 100
      });
    }

    const left = (start.x / 100) * canvasWidth;
    const top = (start.y / 100) * canvasHeight;
    const right = left + (start.width / 100) * canvasWidth;
    const bottom = top + (start.height / 100) * canvasHeight;
    const minSize = 72;

    if (dragState.aspectRatio) {
      const anchorX = dragState.mode.includes('w') ? right : left;
      const anchorY = dragState.mode.includes('n') ? bottom : top;
      const directionX = dragState.mode.includes('e') ? 1 : -1;
      const directionY = dragState.mode.includes('s') ? 1 : -1;
      const rawWidth = Math.max(minSize, Math.abs((dragState.mode.includes('e') ? right + deltaX : left + deltaX) - anchorX));
      const rawHeight = Math.max(minSize, Math.abs((dragState.mode.includes('s') ? bottom + deltaY : top + deltaY) - anchorY));
      let width = Math.abs(deltaX) >= Math.abs(deltaY) ? rawWidth : rawHeight * dragState.aspectRatio;
      let height = width / dragState.aspectRatio;
      const maxWidth = directionX > 0 ? canvasWidth - anchorX : anchorX;
      const maxHeight = directionY > 0 ? canvasHeight - anchorY : anchorY;
      width = Math.min(width, maxWidth, maxHeight * dragState.aspectRatio);
      height = width / dragState.aspectRatio;

      const nextLeft = directionX > 0 ? anchorX : anchorX - width;
      const nextTop = directionY > 0 ? anchorY : anchorY - height;
      return clampResultCropFrame({
        x: (nextLeft / canvasWidth) * 100,
        y: (nextTop / canvasHeight) * 100,
        width: (width / canvasWidth) * 100,
        height: (height / canvasHeight) * 100
      });
    }

    let nextLeft = left;
    let nextTop = top;
    let nextRight = right;
    let nextBottom = bottom;
    if (dragState.mode.includes('w')) nextLeft = Math.min(right - minSize, Math.max(0, left + deltaX));
    if (dragState.mode.includes('e')) nextRight = Math.max(left + minSize, Math.min(canvasWidth, right + deltaX));
    if (dragState.mode.includes('n')) nextTop = Math.min(bottom - minSize, Math.max(0, top + deltaY));
    if (dragState.mode.includes('s')) nextBottom = Math.max(top + minSize, Math.min(canvasHeight, bottom + deltaY));

    return clampResultCropFrame({
      x: (nextLeft / canvasWidth) * 100,
      y: (nextTop / canvasHeight) * 100,
      width: ((nextRight - nextLeft) / canvasWidth) * 100,
      height: ((nextBottom - nextTop) / canvasHeight) * 100
    });
  }

  function moveResultCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const frameDragState = resultCropFrameDragRef.current;
    if (frameDragState?.pointerId === event.pointerId) {
      const deltaX = event.clientX - frameDragState.startX;
      const deltaY = event.clientY - frameDragState.startY;
      updateResultEditorSettings(frameDragState.assetId, buildResultCropFramePatch(buildResizedCropFrame(frameDragState, deltaX, deltaY)));
      return;
    }

    const dragState = resultCropDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - dragState.startX) / dragState.width) * 200;
    const deltaY = ((event.clientY - dragState.startY) / dragState.height) * 200;
    updateResultEditorSettings(dragState.assetId, {
      cropX: clampEditorValue(dragState.originX + deltaX, -50, 50),
      cropY: clampEditorValue(dragState.originY + deltaY, -50, 50)
    });
  }

  function zoomResultCrop(event: ReactWheelEvent<HTMLDivElement>) {
    if (!currentViewerAsset) return;
    event.preventDefault();
    const settings = resultEditorSettings[currentViewerAsset.id] ?? DEFAULT_RESULT_EDITOR_SETTINGS;
    const zoomDelta = event.deltaY < 0 ? 6 : -6;
    updateResultEditorSettings(currentViewerAsset.id, {
      cropZoom: clampEditorValue(settings.cropZoom + zoomDelta, 0, 120)
    });
  }

  function endResultCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const frameDragState = resultCropFrameDragRef.current;
    if (frameDragState?.pointerId === event.pointerId) {
      resultCropFrameDragRef.current = null;
      return;
    }

    const dragState = resultCropDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resultCropDragRef.current = null;
  }

  function resetResultEditorSettings(assetId: string) {
    setResultEditorSettings((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }

  async function downloadViewerAsset(asset: ResultAsset) {
    const url = resolveMediaUrl(asset.storageUrl);
    if (!url) return;
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = asset.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.downloadFailed, locale));
    }
  }

  function shiftViewer(direction: -1 | 1) {
    const nextIndex = clampIndex((resultViewerIndex ?? 0) + direction, viewerAssets.length);
    if (nextIndex !== null) setResultViewerIndex(nextIndex);
  }

  return {
    applyResultColorCard,
    availableResultColorCards,
    currentViewerAspectRatio,
    currentViewerAsset,
    currentViewerIsRegenerating,
    currentViewerNormalizedColor,
    currentViewerSelectedColor,
    currentViewerSettings,
    deleteResultColorCard,
    downloadViewerAsset,
    endResultCropDrag,
    getResultColorCard,
    handlePickResultColor,
    moveResultCropDrag,
    openViewer,
    resetResultEditorSettings,
    resultCanvasRef,
    resultViewerIndex,
    saveResultColorCard,
    setResultColorCards,
    setResultViewerIndex,
    shiftViewer,
    startResultCropDrag,
    startResultCropFrameDrag,
    updateResultAspectRatio,
    updateResultEditorSettings,
    viewerAssets,
    safeViewerIndex,
    zoomResultCrop
  };
}
