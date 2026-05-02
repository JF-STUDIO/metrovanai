import { ApiRequestError, getApiRoot } from './api';
import type { FailedUploadFile, StudioFeatureConfig, UploadProgressSnapshot } from './api';
import { UI_TEXT, type UiLocale } from './app-copy';
import type { LocalExposureDraft, LocalHdrItemDraft, LocalImportDraft } from './local-import';
import type {
  BillingEntry,
  BillingPackage,
  BillingSummary,
  ColorMode,
  HdrItem,
  LocalImportReviewState,
  ProjectGroup,
  ProjectJobState,
  ProjectRecord,
  ResultAsset,
  SceneType
} from './types';

export type AuthMode = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify-email';
export type AppRoute = 'home' | 'plans' | 'studio' | 'billing' | 'admin';
export type AdminConsolePage = 'dashboard' | 'users' | 'works' | 'failures' | 'orders' | 'plans' | 'codes' | 'engine' | 'prompts' | 'content' | 'maintenance' | 'logs' | 'settings';

export const IMPORT_FILE_ACCEPT = '.arw,.cr2,.cr3,.crw,.nef,.nrw,.dng,.raf,.rw2,.rwl,.orf,.srw,.3fr,.fff,.iiq,.pef,.erf,.jpg,.jpeg';
export const IMPORT_FILE_EXTENSIONS = new Set(IMPORT_FILE_ACCEPT.split(','));
const RAW_IMPORT_FILE_EXTENSIONS = new Set([
  '.arw',
  '.cr2',
  '.cr3',
  '.crw',
  '.nef',
  '.nrw',
  '.dng',
  '.raf',
  '.rw2',
  '.rwl',
  '.orf',
  '.srw',
  '.3fr',
  '.fff',
  '.iiq',
  '.pef',
  '.erf'
]);
const JPEG_IMPORT_FILE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

export let localImportModulePromise: Promise<typeof import('./local-import')> | null = null;

export function loadLocalImportModule() {
  localImportModulePromise ??= import('./local-import');
  return localImportModulePromise;
}

export function filterSupportedImportFiles(files: File[]) {
  const supportedCandidates: File[] = [];
  const unsupported: File[] = [];
  for (const file of files) {
    const extension = getImportFileExtension(file.name);
    if (IMPORT_FILE_EXTENSIONS.has(extension)) {
      supportedCandidates.push(file);
    } else {
      unsupported.push(file);
    }
  }

  const rawFileKeys = new Set(
    supportedCandidates
      .filter((file) => RAW_IMPORT_FILE_EXTENSIONS.has(getImportFileExtension(file.name)))
      .map(getRawSidecarKey)
  );
  const supported: File[] = [];
  const ignoredRawSidecars: File[] = [];
  for (const file of supportedCandidates) {
    const extension = getImportFileExtension(file.name);
    if (JPEG_IMPORT_FILE_EXTENSIONS.has(extension) && rawFileKeys.has(getRawSidecarKey(file))) {
      ignoredRawSidecars.push(file);
    } else {
      supported.push(file);
    }
  }

  return { supported, unsupported, ignoredRawSidecars };
}

function getImportFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function getImportFileStem(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return (dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName).toLowerCase();
}

function getImportFileDirectory(file: File) {
  const relativePath = 'webkitRelativePath' in file ? file.webkitRelativePath : '';
  const slashIndex = relativePath.lastIndexOf('/');
  return slashIndex >= 0 ? relativePath.slice(0, slashIndex).toLowerCase() : '';
}

function getRawSidecarKey(file: File) {
  return `${getImportFileDirectory(file)}/${getImportFileStem(file.name)}`;
}

export function revokeLocalImportDraftUrls(draft: LocalImportDraft | null | undefined) {
  for (const url of draft?.objectUrls ?? []) {
    URL.revokeObjectURL(url);
  }
}
export type StudioFeatureImageField = 'beforeImageUrl' | 'afterImageUrl';
export type FailedUploadEntry = FailedUploadFile & { hdrItemId: string };

export const MAX_RUNPOD_HDR_BATCH_SIZE = 100;
export const MIN_RUNPOD_HDR_BATCH_SIZE = 10;
export const MAX_RUNNINGHUB_MAX_IN_FLIGHT = 200;
export const MIN_RUNNINGHUB_MAX_IN_FLIGHT = 1;
export const DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT = 48;
export const LOCAL_HDR_GROUP_UPLOAD_CONCURRENCY = 4;
export const ADMIN_POINT_PRICE_USD = 0.25;
export const ADMIN_MAX_BATCH_CODES = 100;

export interface AdminPlanDraft {
  id: string;
  name: string;
  amountUsd: string;
  points: string;
  discountPercent: string;
  listPriceUsd: string;
}

export interface AdminBatchCodeDraft {
  prefix: string;
  count: string;
  label: string;
  packageId: string;
  discountPercentOverride: string;
  bonusPoints: string;
  maxRedemptions: string;
  expiresAt: string;
  active: boolean;
}

export function createAdminPlanDraft(plan?: BillingPackage, sequence = 1): AdminPlanDraft {
  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      amountUsd: String(plan.amountUsd),
      points: String(plan.points),
      discountPercent: String(plan.discountPercent),
      listPriceUsd: String(plan.listPriceUsd)
    };
  }

  return {
    id: `recharge-custom-${Date.now().toString(36)}`,
    name: `Custom Recharge ${sequence}`,
    amountUsd: '100',
    points: String(Math.floor(100 / ADMIN_POINT_PRICE_USD)),
    discountPercent: '0',
    listPriceUsd: '100'
  };
}

export function createAdminBatchCodeDraft(packageId = ''): AdminBatchCodeDraft {
  return {
    prefix: 'METROVAN',
    count: '10',
    label: '批量兑换码',
    packageId,
    discountPercentOverride: '',
    bonusPoints: '0',
    maxRedemptions: '1',
    expiresAt: '',
    active: true
  };
}

export function normalizeAdminPlanId(input: string, amountUsd: number) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `recharge-${Math.round(amountUsd)}`;
}

export function readPositiveAdminNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildAdminPlanPackageFromDraft(draft: AdminPlanDraft): BillingPackage | null {
  const amountUsd = Number(readPositiveAdminNumber(draft.amountUsd, 0).toFixed(2));
  const points = Math.round(readPositiveAdminNumber(draft.points, 0));
  if (!amountUsd || !points) {
    return null;
  }

  const listPriceUsd = Number(readPositiveAdminNumber(draft.listPriceUsd, amountUsd).toFixed(2));
  const discountPercent = Math.max(0, Math.min(100, Math.round(Number(draft.discountPercent) || 0)));
  const basePoints = Math.max(1, Math.floor(amountUsd / ADMIN_POINT_PRICE_USD));
  const bonusPoints = Math.max(0, points - basePoints);

  return {
    id: normalizeAdminPlanId(draft.id, amountUsd),
    name: draft.name.trim() || `$${amountUsd.toFixed(0)} Recharge`,
    points,
    listPriceUsd,
    amountUsd,
    discountPercent,
    pointPriceUsd: Number((amountUsd / points).toFixed(4)),
    bonusPoints
  };
}

export function randomAdminCodePart(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(length))
      : Array.from({ length }, () => Math.floor(Math.random() * alphabet.length));

  return Array.from(values, (value) => alphabet[Number(value) % alphabet.length]).join('');
}

export function buildUniqueAdminActivationCode(prefix: string, reserved: Set<string>) {
  const normalizedPrefix = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'CODE';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = `${normalizedPrefix}-${randomAdminCodePart(8)}`;
    if (!reserved.has(code)) {
      reserved.add(code);
      return code;
    }
  }

  const fallback = `${normalizedPrefix}-${Date.now().toString(36).toUpperCase()}-${randomAdminCodePart(4)}`;
  reserved.add(fallback);
  return fallback;
}

export interface SessionState {
  id: string;
  userKey: string;
  email: string;
  emailVerifiedAt: string | null;
  displayName: string;
  locale: UiLocale;
  role: 'user' | 'admin';
  accountStatus: 'active' | 'disabled';
}

export interface DownloadDraft {
  includeHd: boolean;
  includeCustom: boolean;
  folderMode: 'grouped' | 'flat';
  namingMode: 'original' | 'sequence' | 'custom-prefix';
  customPrefix: string;
  customLabel: string;
  customLongEdge: string;
  customWidth: string;
  customHeight: string;
}

export type ResultEditorControlKey =
  | 'exposure'
  | 'contrast'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'sharpening'
  | 'cropZoom'
  | 'cropX'
  | 'cropY';

export type ResultEditorAspectRatio = 'free' | 'original' | '1:1' | '4:5' | '3:2' | '16:9';

export interface ResultEditorSettings {
  style: 'signature' | 'natural';
  exposure: number;
  contrast: number;
  temperature: number;
  tint: number;
  saturation: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  sharpening: number;
  cropZoom: number;
  cropX: number;
  cropY: number;
  cropFrameX: number;
  cropFrameY: number;
  cropFrameWidth: number;
  cropFrameHeight: number;
  aspectRatio: ResultEditorAspectRatio;
}

export interface BrowserEyeDropper {
  open: () => Promise<{ sRGBHex: string }>;
}

export interface BrowserEyeDropperConstructor {
  new (): BrowserEyeDropper;
}

export interface WindowWithEyeDropper extends Window {
  EyeDropper?: BrowserEyeDropperConstructor;
}

export interface ResultColorCard {
  id: string;
  label: string;
  color: string;
  source: 'default' | 'saved';
}

export interface ResultCropDragState {
  assetId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export type ResultCropFrameDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export interface ResultCropFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResultCropFrameDragState {
  assetId: string;
  pointerId: number;
  mode: ResultCropFrameDragMode;
  startX: number;
  startY: number;
  startFrame: ResultCropFrame;
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: number | null;
}

export const DEFAULT_DOWNLOAD_DRAFT: DownloadDraft = {
  includeHd: true,
  includeCustom: false,
  folderMode: 'grouped',
  namingMode: 'sequence',
  customPrefix: '',
  customLabel: 'Custom',
  customLongEdge: '3000',
  customWidth: '',
  customHeight: ''
};
export const ADMIN_FEATURE_CATEGORY_OPTIONS: Array<{ value: StudioFeatureConfig['category']; label: string }> = [
  { value: 'interior', label: '室内精修' },
  { value: 'exterior', label: '室外风格' },
  { value: 'special', label: '其它功能' },
  { value: 'new', label: '新功能' },
  { value: 'all', label: '全部展示' }
];

export const ADMIN_FEATURE_STATUS_OPTIONS: Array<{ value: StudioFeatureConfig['status']; label: string }> = [
  { value: 'available', label: '可用' },
  { value: 'beta', label: '测试' }
];

export const ADMIN_FEATURE_TONE_OPTIONS: Array<{ value: StudioFeatureConfig['tone']; label: string }> = [
  { value: 'warm', label: '暖色' },
  { value: 'white', label: '白墙' },
  { value: 'dusk', label: '暮色' },
  { value: 'blue', label: '蓝调' },
  { value: 'season', label: '季节' }
];

export const ADMIN_CONSOLE_PAGE_LABELS: Record<AdminConsolePage, string> = {
  dashboard: '仪表盘',
  users: '用户管理',
  works: '修图作品',
  failures: '失败照片',
  orders: '订单管理',
  plans: '套餐配置',
  codes: '兑换码',
  engine: 'AI 引擎',
  prompts: 'Prompt 模板',
  content: '内容运营',
  maintenance: '维护报告',
  logs: '操作日志',
  settings: '系统设置'
};

export const DEFAULT_REGENERATION_COLOR = '#F2E8D8';
export const RESULT_COLOR_CARD_STORAGE_KEY = 'metrovanai_result_color_cards';
export const STUDIO_GUIDE_DISMISSED_PREFIX = 'metrovanai_studio_guide_dismissed';
export const DEFAULT_RESULT_COLOR_CARDS: Array<{
  id: string;
  color: string;
  label: Record<UiLocale, string>;
}> = [
  { id: 'north-american-warm-white', color: '#F2E8D8', label: { zh: '北美暖白', en: 'Warm White' } },
  { id: 'north-american-soft-greige', color: '#D8D0C2', label: { zh: '柔和灰米', en: 'Soft Greige' } },
  { id: 'north-american-light-taupe', color: '#CFC4B6', label: { zh: '浅陶土米', en: 'Light Taupe' } }
];
export const DEFAULT_RESULT_EDITOR_SETTINGS: ResultEditorSettings = {
  style: 'signature',
  exposure: 0,
  contrast: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  sharpening: 0,
  cropZoom: 0,
  cropX: 0,
  cropY: 0,
  cropFrameX: 0,
  cropFrameY: 0,
  cropFrameWidth: 100,
  cropFrameHeight: 100,
  aspectRatio: 'free'
};

export const RESULT_EDITOR_CONTROL_GROUPS: Array<{
  title: string;
  controls: Array<{ key: ResultEditorControlKey; label: string; min: number; max: number; step?: number }>;
}> = [
  {
    title: 'BASIC',
    controls: [
      { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100 }
    ]
  },
  {
    title: 'COLOR',
    controls: [
      { key: 'temperature', label: 'Temp', min: -100, max: 100 },
      { key: 'tint', label: 'Tint', min: -100, max: 100 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100 }
    ]
  },
  {
    title: 'TONE',
    controls: [
      { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
      { key: 'whites', label: 'Whites', min: -100, max: 100 },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100 }
    ]
  },
  {
    title: 'DETAIL',
    controls: [
      { key: 'sharpening', label: 'Sharpening', min: 0, max: 100 }
    ]
  },
  {
    title: 'CROP',
    controls: [
      { key: 'cropZoom', label: 'Zoom', min: 0, max: 120 },
      { key: 'cropX', label: 'Horizontal', min: -50, max: 50 },
      { key: 'cropY', label: 'Vertical', min: -50, max: 50 }
    ]
  }
];

export const RESULT_EDITOR_ASPECT_RATIOS: Array<{ value: ResultEditorAspectRatio; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' }
];

export function getStoredLocale(): UiLocale {
  if (typeof window === 'undefined') {
    return 'zh';
  }

  const stored = window.localStorage.getItem('metrovanai_locale');
  return stored === 'en' ? 'en' : 'zh';
}

export function getStoredResultColorCards(): ResultColorCard[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RESULT_COLOR_CARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): ResultColorCard | null => {
        if (!item || typeof item !== 'object') return null;
        const color = normalizeHex(String((item as { color?: unknown }).color ?? ''));
        if (!color) return null;
        const label = String((item as { label?: unknown }).label ?? color).trim() || color;
        const id = String((item as { id?: unknown }).id ?? `saved-${color}`).trim() || `saved-${color}`;
        return { id, label, color, source: 'saved' };
      })
      .filter((item): item is ResultColorCard => Boolean(item));
  } catch {
    return [];
  }
}

export function getStudioGuideStorageKey(session: SessionState) {
  return `${STUDIO_GUIDE_DISMISSED_PREFIX}:${session.userKey || session.email || session.id}`;
}

export function markStudioGuideDismissed(session: SessionState) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getStudioGuideStorageKey(session), '1');
  } catch {
    // The guide is optional; if storage is blocked, closing it still works for this session.
  }
}

export function getAvailableResultColorCards(savedColorCards: ResultColorCard[], locale: UiLocale) {
  const defaultCards = DEFAULT_RESULT_COLOR_CARDS.map((card) => ({
    id: card.id,
    label: card.label[locale],
    color: card.color,
    source: 'default' as const
  }));
  const seen = new Set(defaultCards.map((card) => card.color.toUpperCase()));
  const saved = savedColorCards.filter((card) => {
    const normalized = normalizeHex(card.color);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return [...defaultCards, ...saved];
}

export function createDemoExposure(id: string, originalName: string, previewUrl: string, exposureCompensation: number) {
  return {
    id,
    fileName: originalName,
    originalName,
    extension: 'JPG',
    mimeType: 'image/jpeg',
    size: 2450000,
    isRaw: false,
    previewUrl,
    captureTime: '2026-04-20T00:00:00Z',
    sequenceNumber: 1,
    exposureCompensation,
    exposureSeconds: 1 / 60,
    iso: 400,
    fNumber: 5.6,
    focalLength: 16
  };
}

export function createDemoProjects(): ProjectRecord[] {
  const demoPreviewUrl =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" y1="0" x2="1" y2="1"%3E%3Cstop offset="0" stop-color="%23f4eee6"/%3E%3Cstop offset="1" stop-color="%2398a8b8"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="1200" height="800" fill="url(%23g)"/%3E%3Cpath d="M120 600h960V250L700 120 120 310z" fill="%23ffffff" opacity=".42"/%3E%3Cpath d="M210 550h330V335H210zM630 550h360V315H630z" fill="%23293542" opacity=".22"/%3E%3Cpath d="M240 510h260V365H240zM665 510h285V350H665z" fill="%23ffffff" opacity=".56"/%3E%3Ctext x="600" y="705" text-anchor="middle" font-family="Arial" font-size="44" fill="%23293542" opacity=".65"%3EMetrovan AI Demo Result%3C/text%3E%3C/svg%3E';
  const heroExposures = [
    createDemoExposure('exp-1n', '157951.JPG', demoPreviewUrl, 0),
    createDemoExposure('exp-1u', '157951+1.JPG', demoPreviewUrl, 1),
    createDemoExposure('exp-1d', '157951-1.JPG', demoPreviewUrl, -1)
  ];
  const secondExposures = [
    createDemoExposure('exp-2n', '157952.JPG', demoPreviewUrl, 0),
    createDemoExposure('exp-2u', '157952+1.JPG', demoPreviewUrl, 1),
    createDemoExposure('exp-2d', '157952-1.JPG', demoPreviewUrl, -1)
  ];
  const thirdExposures = [
    createDemoExposure('exp-3n', '157953.JPG', demoPreviewUrl, 0),
    createDemoExposure('exp-3u', '157953+1.JPG', demoPreviewUrl, 1),
    createDemoExposure('exp-3d', '157953-1.JPG', demoPreviewUrl, -1)
  ];
  const fourthExposures = [
    createDemoExposure('exp-4n', 'living-01.JPG', demoPreviewUrl, 0),
    createDemoExposure('exp-4u', 'living-01+1.JPG', demoPreviewUrl, 1),
    createDemoExposure('exp-4d', 'living-01-1.JPG', demoPreviewUrl, -1)
  ];
  const fifthExposures = [
    createDemoExposure('exp-5n', 'living-02.JPG', demoPreviewUrl, 0),
    createDemoExposure('exp-5u', 'living-02+1.JPG', demoPreviewUrl, 1),
    createDemoExposure('exp-5d', 'living-02-1.JPG', demoPreviewUrl, -1)
  ];

  const hdrItems: HdrItem[] = [
    { id: 'hdr-1', index: 1, title: '157951.JPG', groupId: 'group-1', sceneType: 'interior', selectedExposureId: 'exp-1n', previewUrl: demoPreviewUrl, status: 'review', statusText: '待确认', errorMessage: null, resultUrl: null, resultFileName: null, exposures: heroExposures },
    { id: 'hdr-2', index: 2, title: '157952.JPG', groupId: 'group-1', sceneType: 'interior', selectedExposureId: 'exp-2n', previewUrl: demoPreviewUrl, status: 'review', statusText: '待确认', errorMessage: null, resultUrl: null, resultFileName: null, exposures: secondExposures },
    { id: 'hdr-3', index: 3, title: '157953.JPG', groupId: 'group-1', sceneType: 'interior', selectedExposureId: 'exp-3n', previewUrl: demoPreviewUrl, status: 'review', statusText: '待确认', errorMessage: null, resultUrl: null, resultFileName: null, exposures: thirdExposures },
    { id: 'hdr-4', index: 1, title: 'living-01.JPG', groupId: 'group-2', sceneType: 'interior', selectedExposureId: 'exp-4n', previewUrl: demoPreviewUrl, status: 'review', statusText: '待确认', errorMessage: null, resultUrl: null, resultFileName: null, exposures: fourthExposures },
    { id: 'hdr-5', index: 2, title: 'living-02.JPG', groupId: 'group-2', sceneType: 'interior', selectedExposureId: 'exp-5n', previewUrl: demoPreviewUrl, status: 'review', statusText: '待确认', errorMessage: null, resultUrl: null, resultFileName: null, exposures: fifthExposures }
  ];

  const resultAssets: ResultAsset[] = [
    { id: 'result-1', hdrItemId: 'hdr-1', fileName: 'Processed_157951.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 0 },
    { id: 'result-2', hdrItemId: 'hdr-2', fileName: 'Processed_157953.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 1 },
    { id: 'result-3', hdrItemId: 'hdr-4', fileName: 'Processed_living-01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 2 },
    { id: 'result-4', hdrItemId: 'hdr-5', fileName: 'Processed_living-02.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 3 },
    { id: 'result-5', hdrItemId: 'hdr-1', fileName: 'Processed_kitchen-01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 4 },
    { id: 'result-6', hdrItemId: 'hdr-2', fileName: 'Processed_kitchen-02.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 5 }
  ];
  const completedResultAssets: ResultAsset[] = [
    { id: 'north-result-1', hdrItemId: 'north-hdr-1', fileName: 'NorthVan_Living_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 0 },
    { id: 'north-result-2', hdrItemId: 'north-hdr-2', fileName: 'NorthVan_Kitchen_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 1 },
    { id: 'north-result-3', hdrItemId: 'north-hdr-3', fileName: 'NorthVan_Primary_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 2 },
    { id: 'north-result-4', hdrItemId: 'north-hdr-4', fileName: 'NorthVan_Bath_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 3 },
    { id: 'north-result-5', hdrItemId: 'north-hdr-5', fileName: 'NorthVan_Exterior_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 4 },
    { id: 'north-result-6', hdrItemId: 'north-hdr-6', fileName: 'NorthVan_Detail_01.JPG', storageUrl: demoPreviewUrl, previewUrl: demoPreviewUrl, sortOrder: 5 }
  ];

  return [
    {
      id: 'demo-jin-project',
      userKey: 'zhoujin0618',
      userDisplayName: 'zhou jin',
      name: 'Jin Project',
      address: 'Downtown Vancouver',
      status: 'review',
      currentStep: 2,
      pointsEstimate: 6,
      pointsSpent: 0,
      regenerationUsage: { freeLimit: 10, freeUsed: 0, paidUsed: 0 },
      photoCount: 8,
      groupCount: 4,
      downloadReady: true,
      uploadCompletedAt: null,
      createdAt: '2026-04-20T00:00:00Z',
      updatedAt: '2026-04-20T00:00:00Z',
      hdrItems,
      groups: [
        { id: 'group-1', index: 1, name: '第1组', sceneType: 'interior', colorMode: 'replace', replacementColor: '#D2CBC1', hdrItemIds: ['hdr-1', 'hdr-2', 'hdr-3'] },
        { id: 'group-2', index: 2, name: '第2组', sceneType: 'interior', colorMode: 'replace', replacementColor: '#CFC8BA', hdrItemIds: ['hdr-4', 'hdr-5'] },
        { id: 'group-3', index: 3, name: '第3组', sceneType: 'pending', colorMode: 'default', replacementColor: null, hdrItemIds: [] },
        { id: 'group-4', index: 4, name: '第4组', sceneType: 'pending', colorMode: 'default', replacementColor: null, hdrItemIds: [] }
      ],
      resultAssets,
      job: {
        id: 'demo-job',
        status: 'idle',
        percent: 0,
        label: '等待处理',
        detail: '发送前先确认照片分组。',
        startedAt: null,
        completedAt: null
      }
    },
    {
      id: 'demo-downtown',
      userKey: 'zhoujin0618',
      userDisplayName: 'zhou jin',
      name: 'Downtown Suite',
      address: 'Downtown Vancouver',
      status: 'processing',
      currentStep: 3,
      pointsEstimate: 4,
      pointsSpent: 0,
      regenerationUsage: { freeLimit: 10, freeUsed: 0, paidUsed: 0 },
      photoCount: 18,
      groupCount: 2,
      downloadReady: false,
      uploadCompletedAt: null,
      createdAt: '2026-04-19T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
      hdrItems: [],
      groups: [],
      resultAssets: [],
      job: null
    },
    {
      id: 'demo-north-van',
      userKey: 'zhoujin0618',
      userDisplayName: 'zhou jin',
      name: 'North Van Home',
      address: 'North Vancouver',
      status: 'completed',
      currentStep: 4,
      pointsEstimate: 7,
      pointsSpent: 7,
      regenerationUsage: { freeLimit: 10, freeUsed: 0, paidUsed: 0 },
      photoCount: 24,
      groupCount: 3,
      downloadReady: true,
      uploadCompletedAt: null,
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
      hdrItems: [],
      groups: [],
      resultAssets: completedResultAssets,
      job: null
    }
  ];
}

export const DEMO_BILLING_PACKAGES: BillingPackage[] = [
  { id: 'recharge-100', name: '$100 Recharge', points: 420, listPriceUsd: 100, amountUsd: 100, discountPercent: 5, pointPriceUsd: 0.25, bonusPoints: 20 },
  { id: 'recharge-500', name: '$500 Recharge', points: 2200, listPriceUsd: 500, amountUsd: 500, discountPercent: 10, pointPriceUsd: 0.25, bonusPoints: 200 },
  { id: 'recharge-1000', name: '$1000 Recharge', points: 4800, listPriceUsd: 1000, amountUsd: 1000, discountPercent: 20, pointPriceUsd: 0.25, bonusPoints: 800 },
  { id: 'recharge-2000', name: '$2000 Recharge', points: 11200, listPriceUsd: 2000, amountUsd: 2000, discountPercent: 40, pointPriceUsd: 0.25, bonusPoints: 3200 }
];
export const CREDIT_PRICE_USD = 0.25;
export const MIN_CUSTOM_RECHARGE_USD = 1;
export const MAX_CUSTOM_RECHARGE_USD = 50000;

export function parseCustomRechargeAmount(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Number(parsed.toFixed(2));
  if (rounded < MIN_CUSTOM_RECHARGE_USD || rounded > MAX_CUSTOM_RECHARGE_USD) {
    return null;
  }

  return rounded;
}

export function getCustomRechargePoints(amountUsd: number) {
  return Math.max(1, Math.floor(amountUsd / CREDIT_PRICE_USD));
}

export const DEMO_BILLING_SUMMARY: BillingSummary = {
  availablePoints: 408,
  totalCreditedPoints: 420,
  totalChargedPoints: 12,
  totalTopUpUsd: 100,
  totalProjectChargedPoints: 12,
  totalAdminAdjustedCreditPoints: 0,
  totalAdminAdjustedChargePoints: 0
};

export const DEMO_BILLING_ENTRIES: BillingEntry[] = [
  {
    id: 'billing-1',
    projectId: 'demo-north-van',
    projectName: 'North Van Home',
    userKey: 'zhoujin0618',
    type: 'charge',
    points: 7,
    amountUsd: 1.75,
    createdAt: '2026-04-22T18:30:00Z',
    note: 'Charge: North Van Home'
  },
  {
    id: 'billing-2',
    projectId: null,
    projectName: '',
    userKey: 'zhoujin0618',
    type: 'credit',
    points: 420,
    amountUsd: 100,
    createdAt: '2026-04-22T09:00:00Z',
    note: 'Top-up: $100 Recharge (+5% credits)'
  },
  {
    id: 'billing-3',
    projectId: 'demo-jin-project',
    projectName: 'Jin Project',
    userKey: 'zhoujin0618',
    type: 'charge',
    points: 5,
    amountUsd: 1.25,
    createdAt: '2026-04-21T20:10:00Z',
    note: 'Charge: Jin Project'
  }
];

export function formatDate(value: string, locale: UiLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function formatUsd(value: number, locale: UiLocale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function getAuthFeedbackMessage(code: string, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (code === 'google_not_configured') return copy.googleConfiguredMissing;
  if (code === 'google_oauth_state_failed') return copy.googleOauthStateFailed;
  if (code === 'google_email_missing') return copy.googleEmailMissing;
  if (code === 'google_email_unverified') return copy.googleEmailUnverified;
  if (code === 'google_oauth_failed') return copy.googleOauthFailed;
  if (code === 'account_disabled') return copy.accountDisabled;
  return code;
}

export function getUserFacingErrorMessage(error: unknown, fallback: string, locale: UiLocale) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const normalized = error.message.trim();
  if (!normalized || normalized === '[object Object]') {
    return fallback;
  }

  if (normalized === 'Failed to fetch') {
    return UI_TEXT[locale].connectionFailed;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.includes('runninghub') ||
    lower.includes('runpod') ||
    lower.includes('workflow') ||
    lower.includes('api key') ||
    lower.includes('apikey') ||
    lower.includes('remote executor')
  ) {
    return locale === 'zh'
      ? '处理服务暂时不可用，请稍后再试。'
      : 'The processing service is temporarily unavailable. Please try again later.';
  }

  if (
    lower.includes('exiftool') ||
    lower.includes('imagemagick') ||
    lower.includes('magick') ||
    lower.includes('rawtherapee') ||
    lower.includes('align_image_stack') ||
    lower.includes('enfuse') ||
    lower.includes('hdr alignment') ||
    lower.includes('scene classifier')
  ) {
    return locale === 'zh'
      ? '照片读取或处理失败，请重新选择照片或稍后再试。'
      : 'Photo reading or processing failed. Please choose the photos again or try later.';
  }

  if (
    lower.includes('activation code is invalid') ||
    lower.includes('activation code is expired') ||
    lower.includes('activation code is invalid or expired') ||
    lower.includes('activation code is invalid or unavailable')
  ) {
    return locale === 'zh' ? '激活码无效。' : 'Invalid activation code.';
  }

  if (lower.includes('already been redeemed')) {
    return locale === 'zh' ? '这个激活码已被当前账号兑换过。' : 'This activation code has already been redeemed.';
  }

  if (lower.includes('only valid during recharge checkout')) {
    return locale === 'zh' ? '这个激活码只能在充值付款时使用。' : 'This activation code can only be used during checkout.';
  }

  if (lower.includes('does not include redeemable credits')) {
    return locale === 'zh' ? '这个激活码不能直接兑换积分。' : 'This activation code cannot be redeemed directly.';
  }

  if (lower.includes('does not apply to the selected recharge tier')) {
    return locale === 'zh' ? '这个激活码不能用于当前充值档位。' : 'This activation code does not apply to this recharge tier.';
  }

  return normalized;
}

export function isInsufficientCreditsError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 402) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('insufficient credits') || message.includes('required points') || message.includes('积分不足');
}

export function getAuthErrorMessage(error: unknown, mode: AuthMode, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  const fallback =
    mode === 'signin' ? copy.authFailedSignin : mode === 'signup' ? copy.authFailedSignup : copy.authFailedReset;
  const normalized = getUserFacingErrorMessage(error, fallback, locale);
  const lower = normalized.toLowerCase();

  if (lower.includes('already registered')) {
    return copy.authEmailExists;
  }

  if (lower.includes('email verification required')) {
    return copy.authEmailNotVerified;
  }

  if (lower.includes('invalid email or password')) {
    return copy.authInvalidCredentials;
  }

  if (lower.includes('account has been disabled')) {
    return copy.accountDisabled;
  }

  if (lower.includes('too many attempts')) {
    return copy.authRateLimited;
  }

  if (lower.includes('weak password')) {
    return copy.authPasswordTooShort;
  }

  if (lower.includes('invalid or expired')) {
    return mode === 'verify-email' ? copy.authVerifyInvalidOrExpired : copy.authResetInvalidOrExpired;
  }

  if (lower.includes('invalid email')) {
    return copy.authInvalidEmail;
  }

  if ((mode === 'signup' || mode === 'reset-confirm') && lower.includes('too small')) {
    return copy.authPasswordTooShort;
  }

  return normalized;
}

export function resolveMediaUrl(relativePath: string | null) {
  if (!relativePath) return '';
  if (/^(?:https?:|blob:|data:)/i.test(relativePath)) return relativePath;
  return `${getApiRoot()}${relativePath}`;
}

export function getSceneLabel(sceneType: SceneType, locale: UiLocale) {
  return UI_TEXT[locale].scene[sceneType];
}

export function getColorModeLabel(colorMode: ColorMode, locale: UiLocale) {
  return UI_TEXT[locale].colorMode[colorMode];
}

export function getSelectedExposure(hdrItem: HdrItem) {
  return hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0] ?? null;
}

export function getGroupItems(group: ProjectGroup, project: { hdrItems: HdrItem[] }) {
  return group.hdrItemIds
    .map((hdrItemId) => project.hdrItems.find((hdrItem) => hdrItem.id === hdrItemId))
    .filter((hdrItem): hdrItem is HdrItem => Boolean(hdrItem));
}

export function normalizeFileIdentity(fileName: string) {
  return fileName.trim().toLowerCase();
}

export function mergeProjectItemsWithLocalPreviews(projectItems: HdrItem[], draft: LocalImportDraft | null) {
  if (!draft || !projectItems.length) {
    return projectItems;
  }

  const localItemsByIndex = new Map(draft.hdrItems.map((item) => [item.index, item]));

  return projectItems.map((item) => {
    const localItem = localItemsByIndex.get(item.index);
    if (!localItem) {
      return item;
    }

    const localExposuresByName = new Map(
      localItem.exposures.map((exposure) => [normalizeFileIdentity(exposure.originalName || exposure.fileName), exposure])
    );
    const exposures = item.exposures.map((exposure) => {
      const localExposure = localExposuresByName.get(normalizeFileIdentity(exposure.originalName || exposure.fileName));
      return localExposure?.previewUrl && !item.resultUrl
        ? {
            ...exposure,
            previewUrl: localExposure.previewUrl
          }
        : exposure;
    });
    const selectedExposure =
      exposures.find((exposure) => exposure.id === item.selectedExposureId) ?? exposures[0] ?? null;

    return {
      ...item,
      previewUrl: item.resultUrl ?? selectedExposure?.previewUrl ?? localItem.previewUrl ?? item.previewUrl,
      exposures
    };
  });
}

export function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function sortExposuresForHdr(exposures: LocalExposureDraft[]) {
  return [...exposures].sort((left, right) => {
    const timeCompare = (left.captureTime ?? '').localeCompare(right.captureTime ?? '');
    if (timeCompare !== 0) return timeCompare;

    const sequenceCompare = (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0);
    if (sequenceCompare !== 0) return sequenceCompare;

    return (left.originalName || left.fileName).localeCompare(right.originalName || right.fileName, undefined, {
      sensitivity: 'base'
    });
  });
}

export function getDraftGroupId(draft: LocalImportDraft) {
  return draft.groups[0]?.id ?? 'local-hdr-groups';
}

export function resequenceLocalHdrItems(items: LocalHdrItemDraft[], groupId: string) {
  return items.map((item, index) => ({
    ...item,
    index: index + 1,
    title: `HDR ${index + 1}`,
    groupId
  }));
}

export function getHdrItemReviewStateFromExposures(exposures: LocalExposureDraft[]): LocalImportReviewState {
  if (exposures.some((exposure) => exposure.localReviewState === 'manual-review')) {
    return 'manual-review';
  }
  if (exposures.some((exposure) => exposure.localReviewState === 'preview-missing')) {
    return 'preview-missing';
  }
  return 'normal';
}

export function syncLocalHdrGroups(draft: LocalImportDraft, hdrItems: LocalHdrItemDraft[], forcedGroupId?: string) {
  const groupId = forcedGroupId ?? getDraftGroupId(draft);
  const nextHdrItems = resequenceLocalHdrItems(hdrItems, groupId);
  const groupIds = nextHdrItems.map((item) => item.id);
  const baseGroup =
    draft.groups[0] ?? {
      id: groupId,
      index: 1,
      name: 'HDR',
      sceneType: 'pending' as const,
      colorMode: 'default' as const,
      replacementColor: null,
      hdrItemIds: []
    };
  return {
    ...draft,
    hdrItems: nextHdrItems,
    groups: [
      {
        ...baseGroup,
        id: groupId,
        index: 1,
        hdrItemIds: groupIds
      }
    ]
  };
}

export function getLocalDraftDiagnostics(hdrItems: LocalHdrItemDraft[]): LocalImportDraft['diagnostics'] {
  const exposures = hdrItems.flatMap((item) => item.exposures);
  return {
    totalFiles: exposures.length,
    previewReadyCount: exposures.filter((exposure) => exposure.localPreviewState === 'ready' || Boolean(exposure.previewUrl)).length,
    previewMissingCount: exposures.filter((exposure) => exposure.localPreviewState === 'missing' && !exposure.previewUrl).length,
    metadataReadyCount: exposures.filter((exposure) => exposure.localMetadataState === 'exif').length,
    metadataMissingCount: exposures.filter((exposure) => exposure.localMetadataState !== 'exif').length,
    manualReviewCount: exposures.filter((exposure) => exposure.localReviewState === 'manual-review').length
  };
}

export function pickLocalDefaultExposure(exposures: LocalExposureDraft[]) {
  return (
    [...exposures].sort((left, right) => {
      const leftAbs = Math.abs(left.exposureCompensation ?? 999);
      const rightAbs = Math.abs(right.exposureCompensation ?? 999);
      if (leftAbs !== rightAbs) return leftAbs - rightAbs;
      return (left.captureTime ?? '').localeCompare(right.captureTime ?? '');
    })[0] ?? null
  );
}

export function mergeLocalImportDrafts(existing: LocalImportDraft, incoming: LocalImportDraft) {
  const groupId = getDraftGroupId(existing);
  const existingFileKeys = new Set<string>();
  existing.hdrItems.forEach((item) => {
    item.exposures.forEach((exposure) => {
      existingFileKeys.add(normalizeFileIdentity(exposure.originalName || exposure.fileName));
    });
  });

  let duplicateCount = 0;
  const keptObjectUrls: string[] = [];
  const incomingItems = incoming.hdrItems
    .map((item): LocalHdrItemDraft | null => {
      const exposures = item.exposures.filter((exposure) => {
        const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
        if (existingFileKeys.has(key)) {
          duplicateCount += 1;
          return false;
        }
        existingFileKeys.add(key);
        if (exposure.objectUrl) {
          keptObjectUrls.push(exposure.objectUrl);
        }
        return true;
      });
      if (!exposures.length) {
        return null;
      }

      const selectedExposure =
        exposures.find((exposure) => exposure.id === item.selectedExposureId) ?? pickLocalDefaultExposure(exposures) ?? exposures[0] ?? null;
      return {
        ...item,
        groupId,
        exposures,
        selectedExposureId: selectedExposure?.id ?? exposures[0]?.id ?? '',
        previewUrl: selectedExposure?.previewUrl ?? exposures[0]?.previewUrl ?? null,
        localReviewState: getHdrItemReviewStateFromExposures(exposures)
      };
    })
    .filter((item): item is LocalHdrItemDraft => item !== null);

  const unusedObjectUrls = incoming.objectUrls.filter((url) => !keptObjectUrls.includes(url));
  const mergedDraft = syncLocalHdrGroups(existing, [...existing.hdrItems, ...incomingItems], groupId);
  return {
    draft: {
      ...mergedDraft,
      objectUrls: [...existing.objectUrls, ...keptObjectUrls],
      diagnostics: getLocalDraftDiagnostics(mergedDraft.hdrItems)
    },
    addedCount: incomingItems.reduce((sum, item) => sum + item.exposures.length, 0),
    duplicateCount,
    unusedObjectUrls
  };
}

export function createHdrItemFromExposure(exposure: LocalExposureDraft, groupId: string): LocalHdrItemDraft {
  return {
    id: createClientId(),
    index: 1,
    title: 'HDR',
    groupId,
    sceneType: 'pending',
    selectedExposureId: exposure.id,
    previewUrl: exposure.previewUrl,
    status: 'review',
    statusText: '待确认',
    errorMessage: null,
    resultUrl: null,
    resultFileName: null,
    localReviewState: exposure.localReviewState ?? 'normal',
    exposures: [exposure]
  };
}

export function getProjectStatusLabel(project: ProjectRecord, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (project.status === 'completed') return copy.status.completed;
  if (project.status === 'processing') return copy.status.processing;
  if (project.status === 'uploading') return copy.status.uploading;
  if (project.status === 'review') return copy.status.review;
  if (project.status === 'importing') return copy.status.importing;
  if (
    project.status === 'failed' &&
    (project.hdrItems.some((item) => isHdrItemProcessing(item.status)) || isProjectJobActivelyProcessing(project.job))
  ) {
    return copy.status.processing;
  }
  if (project.status === 'failed') return copy.status.failed;
  const label = copy.stepLabels[project.currentStep - 1] ?? copy.stepLabels[0];
  return locale === 'en' ? `Step ${project.currentStep} / ${label}` : `第 ${project.currentStep} 步 / ${label}`;
}

export function formatPhotoCount(value: number, locale: UiLocale) {
  return locale === 'en' ? `${value} ${value === 1 ? 'photo' : 'photos'}` : `${value} 张照片`;
}

export function formatGroupCount(value: number, locale: UiLocale) {
  return locale === 'en' ? `${value} ${value === 1 ? 'group' : 'groups'}` : `${value} 组`;
}

export function formatGroupSummary(groupCount: number, photoCount: number, locale: UiLocale) {
  return locale === 'en'
    ? `${groupCount} ${groupCount === 1 ? 'group' : 'groups'} / ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`
    : `${groupCount} 组 / ${photoCount} 张照片`;
}

export function formatUploadProgressLabel(
  snapshot: UploadProgressSnapshot | null,
  fallbackPercent: number,
  copy: (typeof UI_TEXT)[UiLocale]
) {
  if (!snapshot) {
    return fallbackPercent > 0 ? copy.uploadProgress(fallbackPercent) : copy.uploadStarting;
  }

  return copy.uploadOriginalsProgress(snapshot.percent ?? fallbackPercent);
}

export function isHdrItemProcessing(status: HdrItem['status']) {
  return status === 'hdr-processing' || status === 'workflow-upload' || status === 'workflow-running' || status === 'processing';
}

export function isProjectJobActivelyProcessing(job: ProjectJobState | null | undefined) {
  if (!job) {
    return false;
  }
  if (job.status === 'pending' || job.status === 'processing') {
    return true;
  }
  if (job.metrics && (job.metrics.active > 0 || (job.metrics.total > 0 && job.metrics.returned + job.metrics.failed < job.metrics.total))) {
    return true;
  }
  return (
    job.phase === 'uploading' ||
    job.phase === 'grouping' ||
    job.phase === 'queued' ||
    job.phase === 'hdr_merging' ||
    job.phase === 'workflow_uploading' ||
    job.phase === 'workflow_running' ||
    job.phase === 'result_returning' ||
    job.phase === 'regenerating'
  );
}

export function getHdrItemStatusLabel(hdrItem: HdrItem, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (hdrItem.status === 'completed') return copy.hdrItemCompleted;
  if (hdrItem.status === 'error') return hdrItem.errorMessage ? `${copy.hdrItemFailed} / ${hdrItem.errorMessage}` : copy.hdrItemFailed;
  if (isHdrItemProcessing(hdrItem.status)) return copy.hdrItemProcessing;
  return copy.hdrItemReady;
}

export function getProjectProgress(project: ProjectRecord, uploadPercent: number) {
  if (project.status === 'importing' || project.status === 'uploading') return uploadPercent;
  if (project.status === 'processing') {
    return Math.round(project.job?.percent ?? 0);
  }
  if (project.status === 'completed') return 100;
  return project.hdrItems.length ? 40 : 0;
}

export function getProgressWidthClass(value: number, minimum = 0) {
  const clamped = Math.max(minimum, Math.min(100, Number.isFinite(value) ? value : 0));
  return `progress-width-${Math.round(clamped / 5) * 5}`;
}

export function getMaxNavigableStep(project: ProjectRecord) {
  if (project.status === 'draft' || project.status === 'importing') return 1;
  if (project.status === 'review') return 2;
  if (project.status === 'uploading' || project.status === 'processing') return 3;
  return 4;
}

export function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/^#/, '').toUpperCase();
  if (!trimmed || !/^[0-9A-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed}`;
}

export function normalizeHexDraft(value: string) {
  const body = value
    .trim()
    .toUpperCase()
    .replace(/#/g, '')
    .replace(/[^0-9A-F]/g, '')
    .slice(0, 6);
  return body ? `#${body}` : '';
}

export function isStrongPasswordInput(password: string) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function getHdrPreviewUrl(hdrItem: HdrItem) {
  const selectedExposure = getSelectedExposure(hdrItem);
  return resolveMediaUrl(
    hdrItem.previewUrl ??
      selectedExposure?.previewUrl ??
      hdrItem.exposures[0]?.previewUrl ??
      hdrItem.resultUrl ??
      null
  );
}

export function getHdrLocalReviewState(hdrItem: HdrItem): LocalImportReviewState {
  if (hdrItem.localReviewState) {
    return hdrItem.localReviewState;
  }

  const exposureStates = hdrItem.exposures.map((exposure) => exposure.localReviewState);
  if (exposureStates.includes('manual-review')) {
    return 'manual-review';
  }
  if (exposureStates.includes('preview-missing')) {
    return 'preview-missing';
  }
  return 'normal';
}

export function getLocalReviewCopy(state: LocalImportReviewState, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (state === 'manual-review') {
    return {
      title: copy.localImportStatusManualReview,
      hint: copy.localImportStatusManualReviewHint
    };
  }
  if (state === 'preview-missing') {
    return {
      title: copy.localImportStatusPreviewMissing,
      hint: copy.localImportStatusPreviewMissingHint
    };
  }
  return {
    title: copy.localImportStatusNormal,
    hint: copy.localImportStatusNormalHint
  };
}

export function clampIndex(value: number, total: number) {
  if (!total) return null;
  return Math.max(0, Math.min(total - 1, value));
}

export function clampEditorValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function getAspectRatioValue(aspectRatio: ResultEditorAspectRatio) {
  if (aspectRatio === '1:1') return '1 / 1';
  if (aspectRatio === '4:5') return '4 / 5';
  if (aspectRatio === '3:2') return '3 / 2';
  if (aspectRatio === '16:9') return '16 / 9';
  return undefined;
}

export function getAspectRatioNumber(aspectRatio: ResultEditorAspectRatio) {
  if (aspectRatio === '1:1') return 1;
  if (aspectRatio === '4:5') return 4 / 5;
  if (aspectRatio === '3:2') return 3 / 2;
  if (aspectRatio === '16:9') return 16 / 9;
  return null;
}

export function getResultCropFrame(settings: ResultEditorSettings): ResultCropFrame {
  return {
    x: settings.cropFrameX,
    y: settings.cropFrameY,
    width: settings.cropFrameWidth,
    height: settings.cropFrameHeight
  };
}

export function clampResultCropFrame(frame: ResultCropFrame): ResultCropFrame {
  const width = Math.max(8, Math.min(100, frame.width));
  const height = Math.max(8, Math.min(100, frame.height));
  const x = Math.max(0, Math.min(100 - width, frame.x));
  const y = Math.max(0, Math.min(100 - height, frame.y));
  return { x, y, width, height };
}

export function buildResultCropFramePatch(frame: ResultCropFrame): Pick<
  ResultEditorSettings,
  'cropFrameX' | 'cropFrameY' | 'cropFrameWidth' | 'cropFrameHeight'
> {
  const clamped = clampResultCropFrame(frame);
  return {
    cropFrameX: Number(clamped.x.toFixed(2)),
    cropFrameY: Number(clamped.y.toFixed(2)),
    cropFrameWidth: Number(clamped.width.toFixed(2)),
    cropFrameHeight: Number(clamped.height.toFixed(2))
  };
}

export function getDefaultCropFrameForAspect(
  aspectRatio: ResultEditorAspectRatio,
  canvasWidth = 1,
  canvasHeight = 1
): ResultCropFrame {
  const ratio = getAspectRatioNumber(aspectRatio);
  if (!ratio) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  const safeCanvasWidth = Math.max(1, canvasWidth);
  const safeCanvasHeight = Math.max(1, canvasHeight);
  const maxWidth = 86;
  const maxHeight = 86;
  let width = maxWidth;
  let height = (width * safeCanvasWidth) / (ratio * safeCanvasHeight);

  if (height > maxHeight) {
    height = maxHeight;
    width = (height * ratio * safeCanvasHeight) / safeCanvasWidth;
  }

  return {
    x: (100 - width) / 2,
    y: (100 - height) / 2,
    width,
    height
  };
}

export function buildResultCropFrameStyle(settings: ResultEditorSettings) {
  const frame = clampResultCropFrame(getResultCropFrame(settings));
  return {
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${frame.width}%`,
    height: `${frame.height}%`
  };
}

export function buildResultEditorImageStyle(settings: ResultEditorSettings) {
  const signatureBoost = settings.style === 'signature' ? 1.04 : 1;
  const brightness =
    signatureBoost +
    settings.exposure / 180 +
    settings.whites / 420 +
    settings.shadows / 520 -
    settings.blacks / 520;
  const contrast =
    (settings.style === 'signature' ? 1.05 : 1) +
    settings.contrast / 170 +
    settings.highlights / 620 -
    settings.shadows / 720;
  const saturation = (settings.style === 'signature' ? 1.03 : 0.98) + settings.saturation / 135;
  const warmSepia = Math.max(0, settings.temperature) / 520;
  const coolHue = Math.min(0, settings.temperature) / 8;
  const tintHue = settings.tint / 7;
  const sharpeningShadow = settings.sharpening / 100;
  const zoom = 1 + settings.cropZoom / 100;
  const cropTranslateX = settings.cropX / 2;
  const cropTranslateY = settings.cropY / 2;

  return {
    filter: [
      `brightness(${Math.max(0.45, brightness).toFixed(3)})`,
      `contrast(${Math.max(0.45, contrast).toFixed(3)})`,
      `saturate(${Math.max(0, saturation).toFixed(3)})`,
      `sepia(${warmSepia.toFixed(3)})`,
      `hue-rotate(${(coolHue + tintHue).toFixed(2)}deg)`,
      sharpeningShadow > 0 ? `drop-shadow(0 0 ${sharpeningShadow.toFixed(2)}px rgba(255,255,255,0.35))` : ''
    ]
      .filter(Boolean)
      .join(' '),
    transform: `translate3d(${cropTranslateX.toFixed(2)}%, ${cropTranslateY.toFixed(2)}%, 0) scale(${zoom.toFixed(3)})`
  };
}

export function getInitialAuthMode(): AuthMode {
  const params = new URLSearchParams(window.location.search);
  const authParam = params.get('auth');
  if (authParam === 'verify' || params.has('verifyToken') || params.has('emailVerificationToken')) {
    return 'verify-email';
  }
  if (authParam === 'reset' || params.has('token') || params.has('resetToken')) {
    return 'reset-confirm';
  }
  return authParam === 'signup' ? 'signup' : 'signin';
}

export function shouldOpenAuthFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const authParam = params.get('auth');
  return (
    authParam === 'signin' ||
    authParam === 'signup' ||
    authParam === 'reset' ||
    authParam === 'verify' ||
    params.has('token') ||
    params.has('resetToken') ||
    params.has('verifyToken') ||
    params.has('emailVerificationToken')
  );
}

export function getPasswordResetTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('token') || params.get('resetToken') || '').trim();
}

export function getEmailVerificationTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('token') || params.get('verifyToken') || params.get('emailVerificationToken') || '').trim();
}

export function clearAuthTokenQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  url.searchParams.delete('token');
  url.searchParams.delete('resetToken');
  url.searchParams.delete('verifyToken');
  url.searchParams.delete('emailVerificationToken');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function getRouteFromPath(pathname = window.location.pathname): AppRoute {
  const normalized = pathname.replace(/\/+$/, '').toLowerCase();
  if (normalized === '/admin') return 'admin';
  if (normalized === '/billing' || normalized === '/账单') return 'billing';
  if (normalized === '/studio') return 'studio';
  if (normalized === '/plans' || normalized === '/pricing') return 'plans';
  return 'home';
}

export function getPathForRoute(route: AppRoute) {
  if (route === 'admin') return '/admin';
  if (route === 'billing') return '/billing';
  if (route === 'studio') return '/studio';
  if (route === 'plans') return '/plans';
  return '/home';
}
