import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { startTransition, useLayoutEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import { AuthModal } from './components/AuthModal';
import { LandingPage } from './pages/LandingPage';
import logoMark from './assets/metrovan-logo-mark.png';
import showcaseExteriorAfter from './assets/showcase-exterior-after.jpg';
import showcaseInteriorAfter from './assets/showcase-interior-after.jpg';
import showcaseInteriorBefore from './assets/showcase-interior-before.jpg';
import type { LocalExposureDraft, LocalHdrItemDraft, LocalImportDraft } from './local-import';
import {
  ApiRequestError,
  confirmEmailVerification,
  confirmCheckoutSession,
  confirmPasswordReset,
  applyHdrLayout,
  createCheckoutSession,
  createAdminActivationCode,
  createGroup,
  createProject,
  deleteAdminUser,
  deleteHdrItem,
  deleteProject,
  downloadProjectArchive,
  adjustAdminUserBilling,
  fetchAdminActivationCodes,
  fetchAdminAuditLogs,
  fetchAdminOpsHealth,
  fetchAdminOrderRefundPreview,
  fetchAdminOrders,
  fetchAdminProjects,
  fetchAdminSettings,
  fetchAdminUserDetail,
  fetchAdminUsers,
  fetchAdminWorkflows,
  fetchAuthProviders,
  fetchBilling,
  fetchProject,
  fetchProjects,
  fetchResultThumbnails,
  fetchSession,
  fetchStudioFeatures,
  getApiRoot,
  isDirectUploadIntegrityError,
  loginWithEmail,
  logoutSession,
  moveHdrItem,
  patchProject,
  reorderResults,
  registerWithEmail,
  redeemActivationCode,
  refundAdminOrder,
  requestPasswordReset,
  regenerateResult,
  recoverAdminProjectRunningHubResults,
  retryFailedProcessing,
  selectExposure,
  startProcessing,
  updateAccountSettings,
  updateAdminActivationCode,
  deleteAdminActivationCode,
  updateAdminSettings,
  updateAdminUser,
  updateGroup,
  uploadAdminStudioFeatureImage,
  uploadFiles,
  logoutAdminUserSessions
} from './api';
import type {
  AdminActivationCode,
  AdminAuditLogEntry,
  AdminOpsHealthPayload,
  AdminSystemSettings,
  AdminUserListQuery,
  AdminUserSummary,
  AdminWorkflowSummary,
  FailedUploadFile,
  StudioFeatureConfig,
  UploadPauseController,
  UploadedObjectReference,
  UploadProgressSnapshot
} from './api';
import type {
  BillingEntry,
  BillingPackage,
  BillingSummary,
  ColorMode,
  HdrItem,
  LocalImportReviewState,
  PaymentOrderRecord,
  PaymentOrderRefundPreview,
  ProjectGroup,
  ProjectJobState,
  ProjectRecord,
  ResultAsset,
  SceneType
} from './types';

type AuthMode = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify-email';
type UiLocale = 'zh' | 'en';
type AppRoute = 'home' | 'plans' | 'studio' | 'admin';
type AdminConsolePage = 'dashboard' | 'users' | 'works' | 'orders' | 'plans' | 'codes' | 'engine' | 'prompts' | 'content' | 'logs' | 'settings';
type StudioFeatureId = string;
type StudioFeatureStatus = 'available' | 'beta' | 'locked';

const IMPORT_FILE_ACCEPT = '.arw,.cr2,.cr3,.crw,.nef,.nrw,.dng,.raf,.rw2,.rwl,.orf,.srw,.3fr,.fff,.iiq,.pef,.erf,.jpg,.jpeg';
const IMPORT_FILE_EXTENSIONS = new Set(IMPORT_FILE_ACCEPT.split(','));

let localImportModulePromise: Promise<typeof import('./local-import')> | null = null;

function loadLocalImportModule() {
  localImportModulePromise ??= import('./local-import');
  return localImportModulePromise;
}

function filterSupportedImportFiles(files: File[]) {
  const supported: File[] = [];
  const unsupported: File[] = [];
  for (const file of files) {
    const dotIndex = file.name.lastIndexOf('.');
    const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
    if (IMPORT_FILE_EXTENSIONS.has(extension)) {
      supported.push(file);
    } else {
      unsupported.push(file);
    }
  }
  return { supported, unsupported };
}

function revokeLocalImportDraftUrls(draft: LocalImportDraft | null | undefined) {
  for (const url of draft?.objectUrls ?? []) {
    URL.revokeObjectURL(url);
  }
}
type StudioFeatureImageField = 'beforeImageUrl' | 'afterImageUrl';
type FailedUploadEntry = FailedUploadFile & { hdrItemId: string };

const MAX_RUNPOD_HDR_BATCH_SIZE = 100;
const MIN_RUNPOD_HDR_BATCH_SIZE = 10;
const MAX_RUNNINGHUB_MAX_IN_FLIGHT = 200;
const MIN_RUNNINGHUB_MAX_IN_FLIGHT = 1;
const DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT = 48;
const LOCAL_HDR_GROUP_UPLOAD_CONCURRENCY = 4;
const ADMIN_POINT_PRICE_USD = 0.25;
const ADMIN_MAX_BATCH_CODES = 100;

interface AdminPlanDraft {
  id: string;
  name: string;
  amountUsd: string;
  points: string;
  discountPercent: string;
  listPriceUsd: string;
}

interface AdminBatchCodeDraft {
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

function createAdminPlanDraft(plan?: BillingPackage, sequence = 1): AdminPlanDraft {
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

function createAdminBatchCodeDraft(packageId = ''): AdminBatchCodeDraft {
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

function normalizeAdminPlanId(input: string, amountUsd: number) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `recharge-${Math.round(amountUsd)}`;
}

function readPositiveAdminNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildAdminPlanPackageFromDraft(draft: AdminPlanDraft): BillingPackage | null {
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

function randomAdminCodePart(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(length))
      : Array.from({ length }, () => Math.floor(Math.random() * alphabet.length));

  return Array.from(values, (value) => alphabet[Number(value) % alphabet.length]).join('');
}

function buildUniqueAdminActivationCode(prefix: string, reserved: Set<string>) {
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

interface SessionState {
  id: string;
  userKey: string;
  email: string;
  emailVerifiedAt: string | null;
  displayName: string;
  locale: UiLocale;
  role: 'user' | 'admin';
  accountStatus: 'active' | 'disabled';
}

interface DownloadDraft {
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

type ResultEditorControlKey =
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

type ResultEditorAspectRatio = 'free' | 'original' | '1:1' | '4:5' | '3:2' | '16:9';

interface ResultEditorSettings {
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

interface BrowserEyeDropper {
  open: () => Promise<{ sRGBHex: string }>;
}

interface BrowserEyeDropperConstructor {
  new (): BrowserEyeDropper;
}

interface WindowWithEyeDropper extends Window {
  EyeDropper?: BrowserEyeDropperConstructor;
}

interface ResultColorCard {
  id: string;
  label: string;
  color: string;
  source: 'default' | 'saved';
}

interface ResultCropDragState {
  assetId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

type ResultCropFrameDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface ResultCropFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResultCropFrameDragState {
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

interface StudioFeatureDefinition {
  id: StudioFeatureId;
  category: 'all' | 'interior' | 'exterior' | 'special' | 'new';
  status: StudioFeatureStatus;
  tag: Record<UiLocale, string>;
  title: Record<UiLocale, string>;
  description: Record<UiLocale, string>;
  detail: Record<UiLocale, string>;
  exposureLabel: Record<UiLocale, string>;
  pointLabel: Record<UiLocale, string>;
  defaultName: Record<UiLocale, string>;
  tone: 'warm' | 'white' | 'dusk' | 'blue' | 'season';
  beforeImage?: string;
  afterImage?: string;
}

const DEFAULT_DOWNLOAD_DRAFT: DownloadDraft = {
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
const STUDIO_FEATURES: StudioFeatureDefinition[] = [
  {
    id: 'hdr-true-color',
    category: 'interior',
    status: 'available',
    tag: { zh: '室内 · HDR', en: 'Interior · HDR' },
    title: { zh: 'HDR 真实色彩', en: 'HDR True Color' },
    description: {
      zh: '可 90% 还原墙壁颜色，平衡窗景与室内曝光；结果区可以替换错误墙面的颜色。',
      en: 'Restores wall color with about 90% fidelity, balances windows and interior light, and supports wall color correction in results.'
    },
    detail: {
      zh: '保留房间原本的墙面色彩，通过多曝光合成提亮窗景、压暗高光，呈现自然通透的室内空间。',
      en: 'Best for interiors with real wall colors, wood floors, natural light, and window views. Keeps the original wall tone instead of washing color out.'
    },
    exposureLabel: { zh: '3-7 张曝光', en: '3-7 exposures' },
    pointLabel: { zh: '1 积分 / 张', en: '1 pt / photo' },
    defaultName: { zh: 'HDR 真实色彩', en: 'HDR True Color' },
    tone: 'warm',
    beforeImage: showcaseInteriorBefore,
    afterImage: showcaseInteriorAfter
  },
  {
    id: 'hdr-white-wall',
    category: 'interior',
    status: 'beta',
    tag: { zh: '室内 · 白墙', en: 'Interior · White Wall' },
    title: { zh: 'HDR 白墙', en: 'HDR White Wall' },
    description: {
      zh: '适用于白墙空间，可 100% 准确统一白墙；如果是彩色墙面会进行去色。',
      en: 'For white-wall rooms. White walls stay fully neutral; colored walls are desaturated by white-wall logic.'
    },
    detail: {
      zh: '适合公寓、样板间和极简白墙空间。彩色墙面项目建议使用 HDR 真实色彩。',
      en: 'Best for apartments, staging rooms, and minimal white-wall spaces. Use HDR True Color for colored wall projects.'
    },
    exposureLabel: { zh: '3-7 张曝光', en: '3-7 exposures' },
    pointLabel: { zh: '1 积分 / 张', en: '1 pt / photo' },
    defaultName: { zh: 'HDR 白墙', en: 'HDR White Wall' },
    tone: 'white',
    beforeImage: showcaseInteriorBefore,
    afterImage: showcaseInteriorAfter
  },
  {
    id: 'dusk-exterior',
    category: 'exterior',
    status: 'locked',
    tag: { zh: '室外 · 黄昏', en: 'Exterior · Dusk' },
    title: { zh: '白天变黄昏室外修图', en: 'Day to Dusk Exterior' },
    description: {
      zh: '把白天外景转换成黄昏氛围，增强建筑灯光和天空层次。',
      en: 'Turns daytime exteriors into a dusk look with stronger building glow and sky depth.'
    },
    detail: {
      zh: '建设中。上线后用于室外门头、车道、前院和建筑立面。',
      en: 'Coming soon. Designed for exterior fronts, driveways, yards, and facades.'
    },
    exposureLabel: { zh: '单张或 HDR', en: 'Single or HDR' },
    pointLabel: { zh: '建设中', en: 'Coming soon' },
    defaultName: { zh: '白天变黄昏', en: 'Day to Dusk' },
    tone: 'dusk',
    beforeImage: showcaseExteriorAfter,
    afterImage: showcaseExteriorAfter
  },
  {
    id: 'blue-hour',
    category: 'exterior',
    status: 'locked',
    tag: { zh: '室外 · 蓝调', en: 'Exterior · Blue Hour' },
    title: { zh: '蓝调时刻照片修图', en: 'Blue Hour Retouch' },
    description: {
      zh: '适用窗外蓝调和夜景外观，统一天空、灯光和建筑质感。',
      en: 'For blue-hour window and exterior looks, balancing sky, lights, and facade texture.'
    },
    detail: {
      zh: '建设中。适合室外蓝调、窗外蓝调和夜景营销图。',
      en: 'Coming soon. Built for exterior blue hour, window blue hour, and night listing images.'
    },
    exposureLabel: { zh: '单张或 HDR', en: 'Single or HDR' },
    pointLabel: { zh: '建设中', en: 'Coming soon' },
    defaultName: { zh: '蓝调时刻', en: 'Blue Hour' },
    tone: 'blue',
    beforeImage: showcaseExteriorAfter,
    afterImage: showcaseExteriorAfter
  },
  {
    id: 'season-shift',
    category: 'special',
    status: 'locked',
    tag: { zh: '特殊场景', en: 'Special Scene' },
    title: { zh: '季节转换', en: 'Season Shift' },
    description: {
      zh: '转换草地、树木和环境季节氛围，用于不同销售季节的房源展示。',
      en: 'Changes grass, trees, and seasonal atmosphere for different listing campaigns.'
    },
    detail: {
      zh: '建设中。后续用于春夏秋冬氛围转换。',
      en: 'Coming soon. Planned for spring, summer, fall, and winter scene conversions.'
    },
    exposureLabel: { zh: '单张照片', en: 'Single image' },
    pointLabel: { zh: '建设中', en: 'Coming soon' },
    defaultName: { zh: '季节转换', en: 'Season Shift' },
    tone: 'season',
    beforeImage: showcaseExteriorAfter,
    afterImage: showcaseExteriorAfter
  }
];

function studioFeatureConfigToDefinition(feature: StudioFeatureConfig): StudioFeatureDefinition {
  return {
    id: feature.id,
    category: feature.category,
    status: feature.status,
    tag: { zh: feature.tagZh, en: feature.tagEn },
    title: { zh: feature.titleZh, en: feature.titleEn },
    description: { zh: feature.descriptionZh, en: feature.descriptionEn },
    detail: { zh: feature.detailZh, en: feature.detailEn },
    exposureLabel: { zh: '导入照片', en: 'Import photos' },
    pointLabel: { zh: `${feature.pointsPerPhoto} 积分 / 张`, en: `${feature.pointsPerPhoto} pt / photo` },
    defaultName: { zh: feature.titleZh, en: feature.titleEn },
    tone: feature.tone,
    beforeImage: feature.beforeImageUrl || showcaseInteriorBefore,
    afterImage: feature.afterImageUrl || showcaseInteriorAfter
  };
}

function normalizeStudioFeatureDrafts(features: StudioFeatureConfig[] | undefined) {
  return Array.isArray(features) ? features : [];
}

const ADMIN_FEATURE_CATEGORY_OPTIONS: Array<{ value: StudioFeatureConfig['category']; label: string }> = [
  { value: 'interior', label: '室内精修' },
  { value: 'exterior', label: '室外风格' },
  { value: 'special', label: '其它功能' },
  { value: 'new', label: '新功能' },
  { value: 'all', label: '全部展示' }
];

const ADMIN_FEATURE_STATUS_OPTIONS: Array<{ value: StudioFeatureConfig['status']; label: string }> = [
  { value: 'available', label: '可用' },
  { value: 'beta', label: '测试' }
];

const ADMIN_FEATURE_TONE_OPTIONS: Array<{ value: StudioFeatureConfig['tone']; label: string }> = [
  { value: 'warm', label: '暖色' },
  { value: 'white', label: '白墙' },
  { value: 'dusk', label: '暮色' },
  { value: 'blue', label: '蓝调' },
  { value: 'season', label: '季节' }
];

const ADMIN_CONSOLE_PAGE_LABELS: Record<AdminConsolePage, string> = {
  dashboard: '仪表盘',
  users: '用户管理',
  works: '修图作品',
  orders: '订单管理',
  plans: '套餐配置',
  codes: '兑换码',
  engine: 'AI 引擎',
  prompts: 'Prompt 模板',
  content: '内容运营',
  logs: '操作日志',
  settings: '系统设置'
};

const DEFAULT_REGENERATION_COLOR = '#F2E8D8';
const RESULT_COLOR_CARD_STORAGE_KEY = 'metrovanai_result_color_cards';
const STUDIO_GUIDE_DISMISSED_PREFIX = 'metrovanai_studio_guide_dismissed';
const DEFAULT_RESULT_COLOR_CARDS: Array<{
  id: string;
  color: string;
  label: Record<UiLocale, string>;
}> = [
  { id: 'north-american-warm-white', color: '#F2E8D8', label: { zh: '北美暖白', en: 'Warm White' } },
  { id: 'north-american-soft-greige', color: '#D8D0C2', label: { zh: '柔和灰米', en: 'Soft Greige' } },
  { id: 'north-american-light-taupe', color: '#CFC4B6', label: { zh: '浅陶土米', en: 'Light Taupe' } }
];
const DEFAULT_RESULT_EDITOR_SETTINGS: ResultEditorSettings = {
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

const RESULT_EDITOR_CONTROL_GROUPS: Array<{
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

const RESULT_EDITOR_ASPECT_RATIOS: Array<{ value: ResultEditorAspectRatio; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' }
];

const UI_TEXT = {
  zh: {
    stepLabels: ['导入照片', '确认分组', '上传处理', '处理完成'] as const,
    demoStepLabels: ['导入照片', '确认分组', '上传处理', '开始处理'] as const,
    stepHints: ['导入照片并生成本地预览。', '确认自动分组是否正确。', '上传照片并开始处理。', '处理完成后直接在线查看和排序。'] as const,
    scene: { interior: '室内', exterior: '室外', pending: '待确认' } as const,
    colorMode: { default: '默认色彩', replace: '替换颜色' } as const,
    status: {
      completed: '已完成',
      processing: '处理中',
      uploading: '上传处理中',
      review: '确认分组',
      importing: '正在加载图像',
      failed: '处理失败'
    } as const,
    connectionFailed: '连接服务失败，请刷新页面后重试。',
    googleConfiguredMissing: 'Google 登录尚未配置环境变量。',
    googleOauthStateFailed: 'Google 登录校验失败，请重试。',
    googleEmailMissing: 'Google 账户未返回可用邮箱。',
    googleEmailUnverified: 'Google 账户邮箱尚未验证，无法登录。',
    googleOauthFailed: 'Google 登录失败，请稍后再试。',
    accountDisabled: '这个账号已被禁用，请联系管理员。',
    authFailedSignin: '登录失败。',
    authFailedSignup: '注册失败。',
    authEmailExists: '这个邮箱已经注册，请直接登录。',
    authEmailNotVerified: '邮箱还没有验证。我们已重新发送验证邮件，请先打开邮箱完成验证。',
    authInvalidCredentials: '邮箱或密码错误，请重新输入。',
    authInvalidEmail: '请输入正确的邮箱地址。',
    authPasswordTooShort: '密码至少需要 10 位，并包含字母和数字。',
    authModeSignin: '登录',
    authModeSignup: '注册',
    authModeResetRequest: '发送重置链接',
    authModeResetConfirm: '设置新密码',
    authModeVerifyEmail: '验证邮箱',
    authTitleSignin: '登录 Metrovan AI',
    authTitleSignup: '注册 Metrovan AI',
    authTitleResetRequest: '重置密码',
    authTitleResetConfirm: '设置新密码',
    authTitleVerifyEmail: '正在验证邮箱',
    authSubtitleSignin: '进入你的修图工作台。',
    authSubtitleSignup: '创建账户后开始项目处理。',
    authSubtitleResetRequest: '输入注册邮箱，我们会发送一封密码重置邮件。',
    authSubtitleResetConfirm: '请输入新密码，完成后可以重新登录。',
    authSubtitleVerifyEmail: '我们正在确认你的邮箱验证链接。',
    authUseGoogle: '使用 Google 登录',
    authGoogleComingSoon: 'Google 登录将在正式配置后开启。',
    authUseEmail: '或使用邮箱继续',
    authName: '姓名',
    authEmail: '邮箱',
    authPassword: '密码',
    authPasswordPlaceholder: '请输入密码',
    authNewPassword: '新密码',
    authNewPasswordPlaceholder: '请输入新密码',
    authConfirmPassword: '确认密码',
    authConfirmPasswordPlaceholder: '请再次输入密码',
    authForgotPassword: '忘记密码？',
    authBackToLogin: '返回登录',
    authNoAccount: '没有账户？ 去注册',
    authHasAccount: '已有账户？ 去登录',
    authWorking: '处理中...',
    authMissingFields: '请输入邮箱和密码。',
    authMissingEmail: '请输入注册邮箱。',
    authResetTokenMissing: '重置链接缺少 token，请重新申请。',
    authVerifyTokenMissing: '验证链接缺少 token，请重新登录并重新发送验证邮件。',
    authPasswordMismatch: '两次密码输入不一致。',
    authRateLimited: '尝试次数过多，请稍后再试。',
    authVerificationEmailSent: '验证邮件已发送，请打开邮箱完成验证后再登录。',
    authEmailVerifiedSuccess: '邮箱验证成功，正在进入工作台。',
    authVerifyInvalidOrExpired: '验证链接无效或已过期，请重新登录并发送新的验证邮件。',
    authResetEmailSent: '如果这个邮箱已注册，重置链接会发送到你的邮箱。',
    authResetPasswordSuccess: '密码已重置，请使用新密码登录。',
    authResetInvalidOrExpired: '重置链接无效或已过期，请重新申请。',
    authFailedReset: '密码重置失败，请稍后再试。',
    signInSuccess: '登录成功，正在进入工作台。',
    signUpSuccess: '注册成功，正在进入工作台。',
    loadSessionFailed: '登录状态检查失败。',
    googleSuccess: 'Google 登录成功。',
    loadProjectsFailed: '加载项目失败。',
    loadBillingFailed: '加载账单失败。',
    noDownloadProject: '没有可下载的项目。',
    downloadFailed: '下载生成失败。',
    downloadCustomRequired: '自定义尺寸至少填写长边或宽高。',
    downloadVariantRequired: '至少选择一种下载输出。',
    topUpDemo: '演示模式下不执行真实充值。',
    topUpSuccess: '积分充值成功。',
    topUpFailed: '积分充值失败。',
    topUpRedirecting: '正在跳转到 Stripe 安全支付...',
    stripePaymentSuccessTitle: 'Stripe 已确认付款',
    stripePaymentSuccessBody: '积分已到账。付款、收据和 Invoice 均由 Stripe 安全处理。',
    stripeReceiptLink: '查看 Stripe 收据',
    stripeInvoiceLink: '查看 Stripe Invoice',
    stripeInvoicePdfLink: '下载 Invoice PDF',
    stripeDocumentsPending: 'Stripe 正在生成收据/Invoice，稍后刷新账单即可查看。',
    redeemActivationSuccess: '激活码兑换成功，积分已到账。',
    redeemActivationFailed: '激活码兑换失败。',
    paymentCancelled: '支付已取消。',
    paymentConfirming: '正在确认支付结果...',
    createProjectNameRequired: '请先填写项目名。',
    createProjectFailed: '创建项目失败。',
    renamePrompt: '输入新的项目名',
    renameFailed: '重命名失败。',
    deleteProjectConfirm: (name: string) => `删除项目“${name}”？删除后会从工作台移除。`,
    deleteProjectFailed: '删除项目失败。',
    uploadFailed: '上传失败。',
    uploadUnsupportedFiles: (count: number) => `只支持 RAW 和 JPG/JPEG，已忽略 ${count} 个不支持文件。`,
    uploadDuplicateFiles: (count: number) => `已忽略 ${count} 张重复照片。`,
    uploadNoSupportedFiles: '只支持 RAW 和 JPG/JPEG，请重新选择照片。',
    createGroupFailed: '新建分组失败。',
    updateStepFailed: '更新步骤失败。',
    updateSceneFailed: '更新场景失败。',
    updateColorModeFailed: '更新颜色模式失败。',
    replacementColorInvalid: '请输入 6 位 HEX 色号，例如 #D2CBC1。',
    replacementColorFailed: '更新替换颜色失败。',
    moveGroupFailed: '移动分组失败。',
    deleteHdrConfirm: (name: string) => `删除照片组“${name}”？删除后会从当前项目移除。`,
    deleteHdrFailed: '删除照片组失败。',
    shiftExposureFailed: '切换曝光失败。',
    importPhotosFirst: '请先导入照片。',
    startProcessingFailed: '启动处理失败。',
    retryProcessing: '重新处理失败照片',
    reorderResultsFailed: '保存结果排序失败。',
    home: '首页',
    plansNav: '方案',
    landingSignIn: '登录',
    landingStartProject: '开始项目',
    plansHeroKicker: '面向房产影像交付的增值方案',
    plansHeroTitle: '一张照片 · 一个积分 · 一次出片',
    plansHeroSub: '基础单价 0.25 美金 / 积分，充值越多、折扣越高，赠送积分自动到账，随充随用永不过期。',
    plansMetaUnit: ' / 积分',
    plansMetaPhoto: ' 1 积分 = 1 张',
    plansMetaMax: ' 最高折扣',
    plansLockBadge: '限时',
    plansLockTitle: '开发阶段 · 折扣终身锁定',
    plansLockSub: '现在购买的用户，所购档位折扣永久保留。例如 $2000 档 = 40% 折扣永久有效，日后价格调整也不受影响。',
    plansTagStarter: '入门体验',
    plansTagGrowth: '成长进阶',
    plansTagPro: '专业工作室',
    plansTagStudio: '团队旗舰',
    plansBestValue: '最超值',
    plansCredits: '到账积分',
    plansOffLabel: (n: number) => `立享 ${n}% 折扣`,
    plansBonusLabel: (n: number) => `赠送 ${n.toLocaleString()} 积分`,
    plansPerPhoto: '1 积分处理 1 张房产图',
    plansChoose: '选择此方案',
    plansBenefitsKicker: '方案权益',
    plansBenefitsTitle: '每一档都是完整的生产力',
    plansBen1Title: '业内领先的颜色还原',
    plansBen1Desc: '市面上还原房间本色最准的自动修图：墙色、曝光与整体观感跨房间对齐，整套房源保持同一视觉气质，不过曝、不偏色、不塑料感。',
    plansBen2Title: '失败自救 · 一键替换',
    plansBen2Desc: '万一修图结果不满意，不用联系客服、不用等人工重修 —— 直接在结果上点击色号重新生成，墙面颜色一键替换，交付节奏始终在你手里。',
    plansBen3Title: '材质与结构保护',
    plansBen3Desc: '智能识别木纹、石材、纺织面料，只修光色不伤纹理。',
    plansBen4Title: '极速交付',
    plansBen4Desc: '上传完成后不用久等，整套房源一次提交一次下完，不用隔夜渲染，也不用分批等。',
    plansBen5Title: '透明扣费',
    plansBen5Desc: '预估积分先显示，按成功张数扣点，失败不扣，账单随时可查。',
    plansBen6Title: '持续迭代 · 功能不断叠加',
    plansBen6Desc: '产品正处于快速开发阶段，新能力按版本滚动上线，已注册用户自动升级 —— 你买到的不是一套静态功能，而是一条持续成长的工具链。',
    plansScenesKicker: '合作模式',
    plansScenesTitle: '三种方式，按需选择',
    plansScene1Tag: '积分系统',
    plansScene1Title: '随心充值 · 按量付费',
    plansScene1Desc: '按上方档位灵活充值，1 积分 = 1 张图，无需本地硬件，打开浏览器即开即用。适合出图量波动大、想立刻上手的用户。',
    plansScene1MetaLabel: '起步',
    plansScene1MetaValue: '$100 起',
    plansScene2Tag: '买断软件',
    plansScene2Title: '一次付费 · 本地部署',
    plansScene2Desc: '软件买断版本，本地显卡 RTX 3090 起步即可运行。单张约 3 分钟，实际用时随输出尺寸浮动。适合长期稳定出片、数据不出本地的工作室。',
    plansScene2MetaLabel: '硬件要求',
    plansScene2MetaValue: 'GPU 3090+',
    plansScene3Tag: '企业深度合作',
    plansScene3Title: '$15,000 · 企业深度合作',
    plansScene3Desc: '面向需要长期自主管理和深度定制的团队，提供完整交付、使用培训和专属支持。适合希望把修图能力稳定接入自家业务线的公司。',
    plansScene3MetaLabel: '一次付费',
    plansScene3MetaValue: '$15,000',
    plansRecommend: '推荐档位',
    plansFaqKicker: '常见问题',
    plansFaqTitle: '关于充值、扣费与退款',
    plansFaq1Q: '积分会过期吗？',
    plansFaq1A: '不会。积分充值到账后长期有效，随充随用。',
    plansFaq2Q: '处理失败的图也会扣费吗？',
    plansFaq2A: '不会。预估积分仅用于显示，实际扣费按成功交付张数结算。',
    plansFaq3Q: '能开发票吗？',
    plansFaq3A: '可以。请在充值完成后通过账单页提交开票信息，支持个人和企业抬头。',
    plansFaq4Q: '可以退款吗？',
    plansFaq4A: '可以联系管理员人工处理。系统会先核对订单金额、到账积分、已消费积分和可退金额，再通过 Stripe 完成退款。',
    plansFaq5Q: '激活码怎么使用？',
    plansFaq5A: '在充值弹窗中填写激活码即可自动校验并叠加到本次充值，赠送积分同步到账。',
    plansCtaTitle: '准备好让整套房源保持一致气质了吗？',
    plansCtaSub: '注册账号即可体验，首次充值自动享受对应档位折扣。',
    plansCtaBtn: '立即开始',
    studioLabel: 'Metrovan AI 工作室',
    studioSubLabel: '房地产影像工作台',
    studioGuideOpen: '新手指引',
    studioGuideTitle: 'Studio 新手指引',
    studioGuideSubtitle: '按这个顺序完成一套照片。以后也可以从右上角重新打开。',
    studioGuideStepCount: (current: number, total: number) => `${current} / ${total}`,
    studioGuidePrev: '上一步',
    studioGuideNext: '下一步',
    studioGuideDone: '开始使用',
    studioGuideDontShow: '不再提醒',
    studioGuideStep1Title: '新建项目',
    studioGuideStep1Body: '先为这套房源创建一个项目，项目会保存照片分组、处理状态和下载结果。',
    studioGuideStep2Title: '导入照片',
    studioGuideStep2Body: '把 RAW 或 JPG 拖进上传区。浏览器会先读取缩略图和相机数据，不会立刻上传原片。',
    studioGuideStep3Title: '检查 HDR 分组',
    studioGuideStep3Body: '系统会按曝光自动分组。确认无误后继续上传处理，也可以继续添加照片。',
    studioGuideStep4Title: '确认发送',
    studioGuideStep4Body: '确认分组后再上传原图。上传完成并进入自动处理后，可以关闭浏览器。',
    studioGuideStep5Title: '查看结果',
    studioGuideStep5Body: '结果区可以拖拽排序、点开大图、调整裁剪曝光；可用吸管吸取其他墙面颜色或手动输入 HEX。每个项目前 10 次免费，之后每次 1 积分。',
    studioGuideStep6Title: '下载和积分',
    studioGuideStep6Body: '下载时选择 HD 原尺寸或自定义尺寸。处理按成功照片数扣积分，充值和账单在用户菜单里查看。',
    points: '积分',
    topUp: '充值',
    menuSettings: '设置',
    menuBilling: '账单',
    menuLogout: '退出',
    settingsTitle: '账户设置',
    settingsHint: '更新显示名称和界面语言。',
    settingsDisplayName: '显示名称',
    settingsEmail: '邮箱',
    settingsEmailHint: '邮箱当前不可修改。',
    settingsLanguage: '语言',
    settingsDisplayNameRequired: '请输入显示名称。',
    settingsSaved: '设置已保存。',
    settingsSaveFailed: '保存设置失败。',
    chinese: '中文',
    english: 'English',
    save: '保存',
    cancel: '取消',
    close: '关闭',
    historyProjects: '历史项目',
    historyProjectsHintDemo: '双击打开历史项目，使用打开、下载或删除管理记录。',
    historyProjectsHint: '双击打开历史项目，继续处理或查看结果。',
    newProject: '新建项目',
    rename: '重命名',
    open: '打开',
    download: '下载',
    delete: '删除',
    noProject: '还没有项目',
    noProjectHint: '先新建项目，再导入照片。',
    createFirstProject: '先创建一个项目',
    createFirstProjectHint: '创建项目后导入照片，开始检查照片分组。',
    currentProject: '当前项目',
    addressFallback: '未填写项目地址',
    processFlow: '处理流程',
    processFlowHint: '',
    waitingProcessing: '等待处理',
    waitingProcessingHint: '上传后会在这里显示处理状态。',
    processingProgress: '状态',
    estimatedPoints: '预计积分',
    uploadPhotos: '把照片拖到这里',
    uploadPhotosHint: '先在本地生成预览并自动分组，确认后再上传原图。',
    selectPhotos: '选择照片',
    addPhotos: '添加照片',
    uploadStarting: '正在读取照片...',
    uploadProgress: (value: number) => `导入 ${value}%`,
    uploadFileProgress: (uploaded: number, total: number) => `已上传 ${uploaded}/${total} 张`,
    uploadVerifyingProgress: (uploaded: number, total: number) => `正在校验已上传 ${uploaded}/${total} 张，缺失文件将自动补传`,
    uploadRetryProgress: (name: string, attempt: number, maxAttempts: number, uploaded: number, total: number) =>
      `正在重试 ${name}（${attempt}/${maxAttempts}）· 已上传 ${uploaded}/${total} 张`,
    uploadFinalizeProgress: (total: number) => `${total} 张已上传，正在生成分组`,
    uploadOriginalsProgress: (value: number) => `上传 ${value}%`,
    uploadOriginalsTitle: '正在上传照片',
    uploadOriginalsDoNotClose: '正在上传照片，请勿退出浏览器。',
    uploadOriginalsReceived: '照片已上传到后端，正在启动自动处理。',
    uploadOriginalsCanClose: '照片已上传到服务器并开始自动处理，现在可以关闭浏览器。',
    processingGroupsTitle: '照片处理中',
    processingGroupsHint: '每组照片会自动显示处理状态，完成后直接显示结果图。',
    hdrItemReady: '等待上传',
    hdrItemProcessing: '处理中',
    hdrItemCompleted: '已完成',
    hdrItemFailed: '处理失败',
    demoVerticalFix: '垂直校正',
    demoCheckGrouping: '确认分组',
    demoAdjustGrouping: '调整分组',
    sendToProcess: '发送处理',
    reviewGrouping: '确认照片分组',
    reviewGroupingHint: '检查每组照片是否正确，确认后上传原图并自动处理。',
    createGroup: '新建分组',
    splitHdrGroup: '拆成单张',
    mergeHdrGroup: '合并到',
    mergeHdrPlaceholder: '合并到...',
    confirmSend: '确认发送',
    apply: '应用',
    groupNote: '建议发送前逐组确认目标颜色，避免整组观感不一致。',
    noPreview: '无预览图',
    localPreviewUnavailable: '无法本地预览',
    localImportPreviewMissingNotice: (count: number) => `${count} 张照片没有提取到本地预览，但已读取到相机数据，可继续分组。确认发送后会上传原图。`,
    localImportManualReviewNotice: (count: number) => `${count} 张照片没有读取到足够的相机数据，已按单张保留，请手动检查分组。`,
    localImportStatusNormal: '本地分组完成',
    localImportStatusNormalHint: '已读取相机数据和预览图。',
    localImportStatusPreviewMissing: '无法本地预览',
    localImportStatusPreviewMissingHint: '已读取相机数据，可继续分组。',
    localImportStatusManualReview: '需手动确认',
    localImportStatusManualReviewHint: '相机数据不足，已按单张保留。',
    results: '处理结果',
    resultsHint: '拖拽照片可调整下载后文件夹显示顺序，可按照外景、客厅、厨房、卧室排序。',
    clickToView: '点击查看大图',
    colorCardNo: '目标色卡',
    colorDropper: '吸取其他墙面颜色更改',
    colorDropperCompact: '吸取颜色',
    colorDropperUnsupported: '当前浏览器不支持吸管，请手动输入 HEX 颜色。',
    colorDropperFailed: '吸取颜色失败，请重试或手动输入。',
    regeneratePanelTitle: '重新生成',
    regeneratePanelHint: '吸取或填写其他墙面色卡。每个项目前 10 次免费，之后每次 1 积分。',
    resultCardColorHint: '其他墙面颜色',
    saveColorCard: '保存色卡',
    colorCardSaved: '色卡已保存，下次会自动显示。',
    colorCardAlreadySaved: '这个色卡已经在列表里。',
    deleteColorCard: '删除色卡',
    deleteColorCardConfirm: (color: string) => `删除色卡 ${color}？`,
    colorCardDeleted: '色卡已删除。',
    regenerateResult: '重新生成',
    regenerateResultCompact: '生成',
    regeneratingResult: '生成中',
    regeneratedResult: '继续生成',
    regenerateResultHint: '每个项目前 10 次免费，之后每次 1 积分。',
    regenerateResultStarted: '已开始重新生成，完成后这张图会自动更新。',
    regenerateResultFailed: '启动重新生成失败。',
    regenerateColorInvalid: '请输入正确的 HEX 颜色，例如 #F2E8D8。',
    noResults: '还没有结果',
    noResultsHint: '处理完成后，这里会显示所有结果图。',
    billingTitle: '积分与账单',
    billingHint: '处理前检查预计积分，完成后按实际成功张数扣点。',
    billingCurrentBalance: '当前余额',
    billingTopUpTotal: '累计充值',
    billingChargedTotal: '累计扣点',
    recentBilling: '最近账单',
    recentBillingHint: '包含充值记录与项目处理扣点。',
    billingOpenRecharge: '充值',
    noBilling: '还没有账单记录',
    noBillingHint: '充值后会在这里显示明细。',
    rechargeTitle: '积分充值',
    rechargeHint: '1 积分 = 1 张照片，基础单价 0.25 美金 / 积分。',
    rechargeCouponTitle: '激活码',
    rechargeCouponHint: '如有内测优惠或专属激活码，可以单独兑换积分，也可以充值时使用。',
    rechargeCouponLabel: '激活码',
    rechargeCouponPlaceholder: '输入激活码',
    rechargeCouponApplyHint: '直充积分码可直接兑换；折扣码会在充值付款时自动校验。',
    rechargeRedeemCode: '兑换积分',
    rechargePackageTitle: '充值档位',
    rechargeCustomTitle: '自定义金额',
    rechargeCustomLabel: '充值金额（USD）',
    rechargeCustomPlaceholder: '输入金额',
    rechargeCustomHint: '自定义金额无固定档位折扣，按 $0.25 / 积分向下取整；激活码仍可叠加。',
    rechargeCustomInvalid: '请输入 $1 到 $50,000 之间的有效金额。',
    rechargeCustomSummary: '自定义充值',
    rechargePayNow: '立即充值',
    rechargeYouPay: '实付',
    rechargeReceive: '到账积分',
    rechargeSave: '优惠',
    rechargeBonus: '额外赠送',
    createProjectTitle: '新建项目',
    projectName: '项目名称',
    projectAddress: '地址 / 备注',
    createProject: '创建项目',
    downloadSettings: '下载设置',
    downloadFolderMode: '文件夹结构',
    downloadFolderGrouped: '分文件夹（HD / Custom）',
    downloadFolderFlat: '单文件夹平铺',
    downloadNamingMode: '命名规则',
    downloadNamingSequence: '项目名 + 顺序',
    downloadNamingOriginal: '原文件名',
    downloadNamingCustomPrefix: '自定义前缀 + 顺序',
    downloadCustomPrefix: '自定义前缀',
    downloadHdTitle: 'HD 原尺寸',
    downloadHdHint: '保留当前结果图尺寸和排序。',
    downloadCustomTitle: '自定义尺寸',
    downloadCustomHint: '可填长边，或直接填宽高。',
    downloadFolderLabel: '文件夹标签',
    downloadLongEdge: '长边',
    downloadWidth: '宽度',
    downloadHeight: '高度',
    downloadNote: '下载包会沿用当前结果排序。平铺模式下会自动附加变体后缀，避免同名覆盖。',
    downloadGenerating: '正在生成...',
    downloadGenerate: '生成下载包'
  },
  en: {
    stepLabels: ['Import', 'Review', 'Upload', 'Done'] as const,
    demoStepLabels: ['Import', 'Review', 'Upload', 'Start'] as const,
    stepHints: ['Import photos and create local previews.', 'Confirm the automatic grouping.', 'Upload photos and start processing.', 'Review and sort the finished results online.'] as const,
    scene: { interior: 'Interior', exterior: 'Exterior', pending: 'Pending' } as const,
    colorMode: { default: 'Default Color', replace: 'Replace Color' } as const,
    status: {
      completed: 'Completed',
      processing: 'Processing',
      uploading: 'Uploading',
      review: 'Reviewing groups',
      importing: 'Loading Images',
      failed: 'Failed'
    } as const,
    connectionFailed: 'Unable to reach the service. Refresh and try again.',
    googleConfiguredMissing: 'Google sign-in is not configured yet.',
    googleOauthStateFailed: 'Google sign-in verification failed. Please try again.',
    googleEmailMissing: 'No usable email was returned by Google.',
    googleEmailUnverified: 'The Google account email is not verified.',
    googleOauthFailed: 'Google sign-in failed. Please try again later.',
    accountDisabled: 'This account has been disabled. Please contact an administrator.',
    authFailedSignin: 'Sign-in failed.',
    authFailedSignup: 'Sign-up failed.',
    authEmailExists: 'This email is already registered. Please sign in instead.',
    authEmailNotVerified: 'This email is not verified yet. We sent a new verification email. Check your inbox first.',
    authInvalidCredentials: 'Incorrect email or password. Please try again.',
    authInvalidEmail: 'Enter a valid email address.',
    authPasswordTooShort: 'Password must be at least 10 characters and include letters and numbers.',
    authModeSignin: 'Sign In',
    authModeSignup: 'Sign Up',
    authModeResetRequest: 'Send Reset Link',
    authModeResetConfirm: 'Set New Password',
    authModeVerifyEmail: 'Verify Email',
    authTitleSignin: 'Sign in to Metrovan AI',
    authTitleSignup: 'Create your Metrovan AI account',
    authTitleResetRequest: 'Reset your password',
    authTitleResetConfirm: 'Set a new password',
    authTitleVerifyEmail: 'Verifying your email',
    authSubtitleSignin: 'Enter your editing workspace.',
    authSubtitleSignup: 'Create an account and start processing projects.',
    authSubtitleResetRequest: 'Enter your account email and we will send a password reset link.',
    authSubtitleResetConfirm: 'Enter a new password, then sign in again.',
    authSubtitleVerifyEmail: 'We are confirming your email verification link.',
    authUseGoogle: 'Continue with Google',
    authGoogleComingSoon: 'Google sign-in will be enabled after final configuration.',
    authUseEmail: 'Or continue with email',
    authName: 'Name',
    authEmail: 'Email',
    authPassword: 'Password',
    authPasswordPlaceholder: 'Enter your password',
    authNewPassword: 'New password',
    authNewPasswordPlaceholder: 'Enter a new password',
    authConfirmPassword: 'Confirm password',
    authConfirmPasswordPlaceholder: 'Enter your password again',
    authForgotPassword: 'Forgot password?',
    authBackToLogin: 'Back to sign in',
    authNoAccount: "Don't have an account? Sign up",
    authHasAccount: 'Already have an account? Sign in',
    authWorking: 'Working...',
    authMissingFields: 'Enter your email and password.',
    authMissingEmail: 'Enter your account email.',
    authResetTokenMissing: 'This reset link is missing a token. Request a new link.',
    authVerifyTokenMissing: 'This verification link is missing a token. Sign in again to send a new verification email.',
    authPasswordMismatch: 'Passwords do not match.',
    authRateLimited: 'Too many attempts. Please try again later.',
    authVerificationEmailSent: 'Verification email sent. Check your inbox before signing in.',
    authEmailVerifiedSuccess: 'Email verified. Redirecting to your workspace.',
    authVerifyInvalidOrExpired: 'This verification link is invalid or expired. Sign in again to send a new email.',
    authResetEmailSent: 'If this email is registered, a reset link has been sent.',
    authResetPasswordSuccess: 'Your password has been reset. Please sign in with the new password.',
    authResetInvalidOrExpired: 'This reset link is invalid or expired. Request a new link.',
    authFailedReset: 'Password reset failed. Please try again later.',
    signInSuccess: 'Signed in. Redirecting to your workspace.',
    signUpSuccess: 'Account created. Redirecting to your workspace.',
    loadSessionFailed: 'Failed to check your sign-in session.',
    googleSuccess: 'Google sign-in succeeded.',
    loadProjectsFailed: 'Failed to load projects.',
    loadBillingFailed: 'Failed to load billing.',
    noDownloadProject: 'No downloadable project is available.',
    downloadFailed: 'Failed to generate the download package.',
    downloadCustomRequired: 'Enter either a long edge or a width and height for the custom size.',
    downloadVariantRequired: 'Select at least one output variant.',
    topUpDemo: 'Demo mode does not perform real top-ups.',
    topUpSuccess: 'Credits added successfully.',
    topUpFailed: 'Top-up failed.',
    topUpRedirecting: 'Redirecting to secure Stripe checkout...',
    stripePaymentSuccessTitle: 'Stripe payment confirmed',
    stripePaymentSuccessBody: 'Credits are available. Payment, receipt, and invoice are handled securely by Stripe.',
    stripeReceiptLink: 'View Stripe receipt',
    stripeInvoiceLink: 'View Stripe invoice',
    stripeInvoicePdfLink: 'Download invoice PDF',
    stripeDocumentsPending: 'Stripe is generating the receipt/invoice. Refresh billing shortly to view it.',
    redeemActivationSuccess: 'Activation code redeemed. Credits are now available.',
    redeemActivationFailed: 'Activation code redemption failed.',
    paymentCancelled: 'Payment was cancelled.',
    paymentConfirming: 'Confirming payment...',
    createProjectNameRequired: 'Enter a project name first.',
    createProjectFailed: 'Failed to create the project.',
    renamePrompt: 'Enter a new project name',
    renameFailed: 'Failed to rename the project.',
    deleteProjectConfirm: (name: string) => `Delete "${name}" from your workspace?`,
    deleteProjectFailed: 'Failed to delete the project.',
    uploadFailed: 'Upload failed.',
    uploadUnsupportedFiles: (count: number) => `Only RAW and JPG/JPEG files are supported. ${count} unsupported file${count === 1 ? '' : 's'} ignored.`,
    uploadDuplicateFiles: (count: number) => `${count} duplicate ${count === 1 ? 'photo was' : 'photos were'} ignored.`,
    uploadNoSupportedFiles: 'Only RAW and JPG/JPEG files are supported. Please choose photos again.',
    createGroupFailed: 'Failed to create a group.',
    updateStepFailed: 'Failed to update the step.',
    updateSceneFailed: 'Failed to update the scene type.',
    updateColorModeFailed: 'Failed to update the color mode.',
    replacementColorInvalid: 'Enter a valid 6-digit HEX value, such as #D2CBC1.',
    replacementColorFailed: 'Failed to update the replacement color.',
    moveGroupFailed: 'Failed to move the photo group.',
    deleteHdrConfirm: (name: string) => `Delete photo group "${name}" from this project?`,
    deleteHdrFailed: 'Failed to delete the photo group.',
    shiftExposureFailed: 'Failed to switch the exposure.',
    importPhotosFirst: 'Import photos first.',
    startProcessingFailed: 'Failed to start processing.',
    retryProcessing: 'Retry failed photos',
    reorderResultsFailed: 'Failed to save the result order.',
    home: 'Home',
    plansNav: 'Plans',
    landingSignIn: 'Sign In',
    landingStartProject: 'Start a Project',
    plansHeroKicker: 'Value plans for real-estate image delivery',
    plansHeroTitle: 'One photo · one credit · one clean delivery',
    plansHeroSub: 'Base rate $0.25 USD per credit. Larger top-ups unlock bigger discounts and bonus credits. Credits never expire.',
    plansMetaUnit: ' / credit',
    plansMetaPhoto: ' 1 credit = 1 photo',
    plansMetaMax: ' max discount',
    plansLockBadge: 'Limited',
    plansLockTitle: 'Early-access pricing · locked in for life',
    plansLockSub: 'Buy during the early-access phase and your tier discount stays yours forever. The $2000 plan keeps its 40% off on every future top-up — even after prices return to standard.',
    plansTagStarter: 'Starter',
    plansTagGrowth: 'Growth',
    plansTagPro: 'Pro Studio',
    plansTagStudio: 'Flagship Team',
    plansBestValue: 'Best value',
    plansCredits: 'credits delivered',
    plansOffLabel: (n: number) => `${n}% off instantly`,
    plansBonusLabel: (n: number) => `+${n.toLocaleString()} bonus credits`,
    plansPerPhoto: '1 credit processes 1 listing photo',
    plansChoose: 'Choose this plan',
    plansBenefitsKicker: 'Plan benefits',
    plansBenefitsTitle: 'Every tier is a complete production line',
    plansBen1Title: 'Best-in-class color fidelity',
    plansBen1Desc: 'The most faithful automatic retouch for listing interiors on the market. Wall color, exposure and overall tone align across rooms — no overexposure, no color cast, no plastic look.',
    plansBen2Title: 'Self-service recovery',
    plansBen2Desc: 'If a render does not land the first time, you do not wait for a human retoucher or a support ticket. Click a color swatch, regenerate, and the wall color swaps instantly — your delivery timeline stays yours.',
    plansBen3Title: 'Material & structure safe',
    plansBen3Desc: 'Detects wood, stone and textiles — corrects light and color without harming texture.',
    plansBen4Title: 'Fast turnaround',
    plansBen4Desc: 'Upload once and pull down the whole listing in one sitting — no overnight renders, no piece-by-piece waiting.',
    plansBen5Title: 'Transparent billing',
    plansBen5Desc: 'See an estimate up front. Only successful frames are charged. Full history is always in the billing page.',
    plansBen6Title: 'Always evolving',
    plansBen6Desc: 'We are in active development — new capabilities ship continuously and existing users upgrade automatically. You are not buying a frozen product, you are buying a tool that keeps getting better.',
    plansScenesKicker: 'How to work with us',
    plansScenesTitle: 'Three options — pick what fits',
    plansScene1Tag: 'Credit system',
    plansScene1Title: 'Pay as you go · top up anytime',
    plansScene1Desc: 'Top up flexibly using the tiers above. 1 credit = 1 photo. No local hardware — open a browser and start. Ideal for variable volume or teams that want to get moving right away.',
    plansScene1MetaLabel: 'Start from',
    plansScene1MetaValue: '$100',
    plansScene2Tag: 'Software license',
    plansScene2Title: 'One-time payment · local deployment',
    plansScene2Desc: 'Perpetual software license. Runs locally on an RTX 3090 or better. Around 3 minutes per photo, varying with output resolution. Best for studios with steady volume and strict data-locality requirements.',
    plansScene2MetaLabel: 'Hardware',
    plansScene2MetaValue: 'GPU 3090+',
    plansScene3Tag: 'Enterprise partnership',
    plansScene3Title: '$15,000 · enterprise partnership',
    plansScene3Desc: 'For teams that need long-term control and deeper customization, we provide full delivery, onboarding, and dedicated support so the service can fit into your existing business line.',
    plansScene3MetaLabel: 'One-time',
    plansScene3MetaValue: '$15,000',
    plansRecommend: 'Recommended',
    plansFaqKicker: 'FAQ',
    plansFaqTitle: 'Top-ups, usage, refunds',
    plansFaq1Q: 'Do credits expire?',
    plansFaq1A: 'No. Once credits land in your account they stay valid indefinitely.',
    plansFaq2Q: 'Am I charged for failed renders?',
    plansFaq2A: 'No. The estimated credits are for preview only. You are only billed for successfully delivered frames.',
    plansFaq3Q: 'Can I get an invoice?',
    plansFaq3A: 'Yes. Submit invoice details from the billing page after topping up — both personal and company titles are supported.',
    plansFaq4Q: 'Can I request a refund?',
    plansFaq4A: 'Yes. Refunds are handled manually by an admin after checking the order amount, delivered credits, consumed credits, refundable amount, and remaining balance.',
    plansFaq5Q: 'How do activation codes work?',
    plansFaq5A: 'Enter the code in the top-up modal. It is validated and applied automatically, and any bonus credits land with the top-up.',
    plansCtaTitle: 'Ready to keep every listing on one visual wavelength?',
    plansCtaSub: 'Create an account to try it. Your first top-up instantly earns the matching tier discount.',
    plansCtaBtn: 'Start now',
    studioLabel: 'Metrovan AI Studio',
    studioSubLabel: 'Real estate media workspace',
    studioGuideOpen: 'Guide',
    studioGuideTitle: 'Studio guide',
    studioGuideSubtitle: 'Follow this order to finish one listing. You can reopen this from the top right.',
    studioGuideStepCount: (current: number, total: number) => `${current} / ${total}`,
    studioGuidePrev: 'Back',
    studioGuideNext: 'Next',
    studioGuideDone: 'Start',
    studioGuideDontShow: 'Do not show again',
    studioGuideStep1Title: 'Create a project',
    studioGuideStep1Body: 'Create one project per listing. It stores grouping, processing status, and final downloads.',
    studioGuideStep2Title: 'Import photos',
    studioGuideStep2Body: 'Drop RAW or JPG files into the upload area. The browser reads previews and camera data before originals upload.',
    studioGuideStep3Title: 'Review HDR groups',
    studioGuideStep3Body: 'Photos are grouped by exposure. If needed, split singles, merge groups, or add more photos before sending.',
    studioGuideStep4Title: 'Confirm and send',
    studioGuideStep4Body: 'After confirming groups, originals upload. Once upload is complete and processing starts, you can close the browser.',
    studioGuideStep5Title: 'Review results',
    studioGuideStep5Body: 'Drag to reorder, open a large preview, adjust crop or exposure, then pick another wall color or enter HEX. Each project includes 10 free regenerations; later runs cost 1 credit each.',
    studioGuideStep6Title: 'Download and credits',
    studioGuideStep6Body: 'Download HD original size or custom size. Credits are charged only for successful images; billing is in the user menu.',
    points: 'Credits',
    topUp: 'Top up',
    menuSettings: 'Settings',
    menuBilling: 'Billing',
    menuLogout: 'Log out',
    settingsTitle: 'Account settings',
    settingsHint: 'Update your display name and interface language.',
    settingsDisplayName: 'Display name',
    settingsEmail: 'Email',
    settingsEmailHint: 'Email cannot be changed here.',
    settingsLanguage: 'Language',
    settingsDisplayNameRequired: 'Enter a display name.',
    settingsSaved: 'Settings saved.',
    settingsSaveFailed: 'Failed to save settings.',
    chinese: 'Chinese',
    english: 'English',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    historyProjects: 'Project history',
    historyProjectsHintDemo: 'Double-click a project to open it and manage open, download, or delete actions.',
    historyProjectsHint: 'Double-click a project to reopen it and continue processing or review results.',
    newProject: 'New Project',
    rename: 'Rename',
    open: 'Open',
    download: 'Download',
    delete: 'Delete',
    noProject: 'No projects yet',
    noProjectHint: 'Create a project first, then import photos.',
    createFirstProject: 'Create your first project',
    createFirstProjectHint: 'Start a project, import photos, and review grouping.',
    currentProject: 'Current Project',
    addressFallback: 'No project address added',
    processFlow: 'Process',
    processFlowHint: '',
    waitingProcessing: 'Waiting to process',
    waitingProcessingHint: 'Processing status will appear here after upload.',
    processingProgress: 'Status',
    estimatedPoints: 'Estimated credits',
    uploadPhotos: 'Drop photos here',
    uploadPhotosHint: 'Create local previews and automatic groups first, then upload the originals after confirmation.',
    selectPhotos: 'Select Photos',
    addPhotos: 'Add Photos',
    uploadStarting: 'Reading photos...',
    uploadProgress: (value: number) => `Importing ${value}%`,
    uploadFileProgress: (uploaded: number, total: number) => `Uploaded ${uploaded}/${total}`,
    uploadVerifyingProgress: (uploaded: number, total: number) => `Verifying uploaded files ${uploaded}/${total}; missing files will resume`,
    uploadRetryProgress: (name: string, attempt: number, maxAttempts: number, uploaded: number, total: number) =>
      `Retrying ${name} (${attempt}/${maxAttempts}) · Uploaded ${uploaded}/${total}`,
    uploadFinalizeProgress: (total: number) => `${total} uploaded. Building groups`,
    uploadOriginalsProgress: (value: number) => `Uploading ${value}%`,
    uploadOriginalsTitle: 'Uploading photos',
    uploadOriginalsDoNotClose: 'Uploading photos. Please do not close the browser.',
    uploadOriginalsReceived: 'Photos are uploaded to the backend. Starting automatic processing.',
    uploadOriginalsCanClose: 'Photos are uploaded and processing has started. You can close the browser now.',
    processingGroupsTitle: 'Processing photos',
    processingGroupsHint: 'Each group shows live status. Finished groups switch to the processed photo automatically.',
    hdrItemReady: 'Waiting to upload',
    hdrItemProcessing: 'Processing',
    hdrItemCompleted: 'Completed',
    hdrItemFailed: 'Failed',
    demoVerticalFix: 'Vertical Fix',
    demoCheckGrouping: 'Check Groups',
    demoAdjustGrouping: 'Adjust Groups',
    sendToProcess: 'Send to Process',
    reviewGrouping: 'Review groups',
    reviewGroupingHint: 'Check each photo group, then upload originals and start processing automatically.',
    createGroup: 'New Group',
    splitHdrGroup: 'Split Singles',
    mergeHdrGroup: 'Merge to',
    mergeHdrPlaceholder: 'Merge to...',
    confirmSend: 'Confirm & Send',
    apply: 'Apply',
    groupNote: 'Confirm each target color before sending to avoid inconsistent color across the group.',
    noPreview: 'No preview',
    localPreviewUnavailable: 'Local preview unavailable',
    localImportPreviewMissingNotice: (count: number) => `${count} ${count === 1 ? 'photo has' : 'photos have'} no local preview, but camera metadata was read and grouping can continue. Originals upload after confirmation.`,
    localImportManualReviewNotice: (count: number) => `${count} ${count === 1 ? 'photo has' : 'photos have'} insufficient camera metadata and was kept as a single item. Check grouping manually.`,
    localImportStatusNormal: 'Local grouping ready',
    localImportStatusNormalHint: 'Camera metadata and preview are available.',
    localImportStatusPreviewMissing: 'No local preview',
    localImportStatusPreviewMissingHint: 'Camera metadata is available for grouping.',
    localImportStatusManualReview: 'Manual check needed',
    localImportStatusManualReviewHint: 'Metadata is insufficient, so this stays single.',
    results: 'Results',
    resultsHint: 'Drag photos to control the folder order in the final download.',
    clickToView: 'Click to view large image',
    colorCardNo: 'Target color',
    colorDropper: 'Pick another wall color',
    colorDropperCompact: 'Pick color',
    colorDropperUnsupported: 'This browser does not support the eyedropper. Enter a HEX color manually.',
    colorDropperFailed: 'Color picking failed. Try again or enter HEX manually.',
    regeneratePanelTitle: 'Regenerate',
    regeneratePanelHint: 'Pick or enter another wall color. Each project includes 10 free regenerations; later runs cost 1 credit each.',
    resultCardColorHint: 'Another wall color',
    saveColorCard: 'Save card',
    colorCardSaved: 'Color card saved and will appear next time.',
    colorCardAlreadySaved: 'This color card is already in the list.',
    deleteColorCard: 'Delete card',
    deleteColorCardConfirm: (color: string) => `Delete color card ${color}?`,
    colorCardDeleted: 'Color card deleted.',
    regenerateResult: 'Regenerate',
    regenerateResultCompact: 'Run',
    regeneratingResult: 'Generating',
    regeneratedResult: 'Regenerate again',
    regenerateResultHint: 'Each project includes 10 free regenerations; later runs cost 1 credit each.',
    regenerateResultStarted: 'Regeneration started. This image will update when it finishes.',
    regenerateResultFailed: 'Failed to start regeneration.',
    regenerateColorInvalid: 'Enter a valid HEX color, for example #F2E8D8.',
    noResults: 'No results yet',
    noResultsHint: 'Finished images will appear here after processing.',
    billingTitle: 'Credits & billing',
    billingHint: 'Estimated credits are checked before processing. Final credits are charged by successful images.',
    billingCurrentBalance: 'Current balance',
    billingTopUpTotal: 'Total top-up',
    billingChargedTotal: 'Total charged',
    recentBilling: 'Recent billing',
    recentBillingHint: 'Includes both top-ups and per-project processing charges.',
    billingOpenRecharge: 'Recharge',
    noBilling: 'No billing history yet',
    noBillingHint: 'Billing details will appear here after your first top-up.',
    rechargeTitle: 'Recharge credits',
    rechargeHint: '1 credit = 1 photo. Base rate: $0.25 USD per credit.',
    rechargeCouponTitle: 'Activation code',
    rechargeCouponHint: 'Enter a beta or private activation code to redeem credits or apply it during recharge.',
    rechargeCouponLabel: 'Activation code',
    rechargeCouponPlaceholder: 'Enter code',
    rechargeCouponApplyHint: 'Credit codes can be redeemed directly. Discount codes are validated during checkout.',
    rechargeRedeemCode: 'Redeem credits',
    rechargePackageTitle: 'Recharge tiers',
    rechargeCustomTitle: 'Custom amount',
    rechargeCustomLabel: 'Amount (USD)',
    rechargeCustomPlaceholder: 'Enter amount',
    rechargeCustomHint: 'Custom amounts have no tier discount by default. Credits are rounded down at $0.25 each; activation codes still apply.',
    rechargeCustomInvalid: 'Enter a valid amount between $1 and $50,000.',
    rechargeCustomSummary: 'Custom recharge',
    rechargePayNow: 'Recharge now',
    rechargeYouPay: 'Pay now',
    rechargeReceive: 'Credits received',
    rechargeSave: 'Discount',
    rechargeBonus: 'Bonus credits',
    createProjectTitle: 'Create project',
    projectName: 'Project name',
    projectAddress: 'Address / Notes',
    createProject: 'Create Project',
    downloadSettings: 'Download settings',
    downloadFolderMode: 'Folder structure',
    downloadFolderGrouped: 'Grouped folders (HD / Custom)',
    downloadFolderFlat: 'Flat single folder',
    downloadNamingMode: 'Naming',
    downloadNamingSequence: 'Project name + sequence',
    downloadNamingOriginal: 'Original filename',
    downloadNamingCustomPrefix: 'Custom prefix + sequence',
    downloadCustomPrefix: 'Custom prefix',
    downloadHdTitle: 'HD original size',
    downloadHdHint: 'Keep the current result size and order.',
    downloadCustomTitle: 'Custom size',
    downloadCustomHint: 'Enter a long edge, or specify width and height.',
    downloadFolderLabel: 'Folder label',
    downloadLongEdge: 'Long edge',
    downloadWidth: 'Width',
    downloadHeight: 'Height',
    downloadNote: 'The package follows the current result order. Flat mode appends variant suffixes to avoid filename collisions.',
    downloadGenerating: 'Generating...',
    downloadGenerate: 'Generate ZIP'
  }
} satisfies Record<UiLocale, Record<string, unknown>>;

function getStoredLocale(): UiLocale {
  if (typeof window === 'undefined') {
    return 'zh';
  }

  const stored = window.localStorage.getItem('metrovanai_locale');
  return stored === 'en' ? 'en' : 'zh';
}

function getStoredResultColorCards(): ResultColorCard[] {
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

function getStudioGuideStorageKey(session: SessionState) {
  return `${STUDIO_GUIDE_DISMISSED_PREFIX}:${session.userKey || session.email || session.id}`;
}

function markStudioGuideDismissed(session: SessionState) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getStudioGuideStorageKey(session), '1');
  } catch {
    // The guide is optional; if storage is blocked, closing it still works for this session.
  }
}

function getAvailableResultColorCards(savedColorCards: ResultColorCard[], locale: UiLocale) {
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

function createDemoExposure(id: string, originalName: string, previewUrl: string, exposureCompensation: number) {
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

function createDemoProjects(): ProjectRecord[] {
  const demoPreviewUrl = '';
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
      resultAssets: [],
      job: null
    }
  ];
}

const DEMO_BILLING_PACKAGES: BillingPackage[] = [
  { id: 'recharge-100', name: '$100 Recharge', points: 420, listPriceUsd: 100, amountUsd: 100, discountPercent: 5, pointPriceUsd: 0.25, bonusPoints: 20 },
  { id: 'recharge-500', name: '$500 Recharge', points: 2200, listPriceUsd: 500, amountUsd: 500, discountPercent: 10, pointPriceUsd: 0.25, bonusPoints: 200 },
  { id: 'recharge-1000', name: '$1000 Recharge', points: 4800, listPriceUsd: 1000, amountUsd: 1000, discountPercent: 20, pointPriceUsd: 0.25, bonusPoints: 800 },
  { id: 'recharge-2000', name: '$2000 Recharge', points: 11200, listPriceUsd: 2000, amountUsd: 2000, discountPercent: 40, pointPriceUsd: 0.25, bonusPoints: 3200 }
];
const CREDIT_PRICE_USD = 0.25;
const MIN_CUSTOM_RECHARGE_USD = 1;
const MAX_CUSTOM_RECHARGE_USD = 50000;

function parseCustomRechargeAmount(value: string) {
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

function getCustomRechargePoints(amountUsd: number) {
  return Math.max(1, Math.floor(amountUsd / CREDIT_PRICE_USD));
}

const DEMO_BILLING_SUMMARY: BillingSummary = {
  availablePoints: 408,
  totalCreditedPoints: 420,
  totalChargedPoints: 12,
  totalTopUpUsd: 100
};

const DEMO_BILLING_ENTRIES: BillingEntry[] = [
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

function formatDate(value: string, locale: UiLocale) {
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

function formatUsd(value: number, locale: UiLocale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getAuthFeedbackMessage(code: string, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (code === 'google_not_configured') return copy.googleConfiguredMissing;
  if (code === 'google_oauth_state_failed') return copy.googleOauthStateFailed;
  if (code === 'google_email_missing') return copy.googleEmailMissing;
  if (code === 'google_email_unverified') return copy.googleEmailUnverified;
  if (code === 'google_oauth_failed') return copy.googleOauthFailed;
  if (code === 'account_disabled') return copy.accountDisabled;
  return code;
}

function getUserFacingErrorMessage(error: unknown, fallback: string, locale: UiLocale) {
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

function isInsufficientCreditsError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 402) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('insufficient credits') || message.includes('required points') || message.includes('积分不足');
}

function getAuthErrorMessage(error: unknown, mode: AuthMode, locale: UiLocale) {
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

function resolveMediaUrl(relativePath: string | null) {
  if (!relativePath) return '';
  if (/^(?:https?:|blob:|data:)/i.test(relativePath)) return relativePath;
  return `${getApiRoot()}${relativePath}`;
}

function getSceneLabel(sceneType: SceneType, locale: UiLocale) {
  return UI_TEXT[locale].scene[sceneType];
}

function getColorModeLabel(colorMode: ColorMode, locale: UiLocale) {
  return UI_TEXT[locale].colorMode[colorMode];
}

function getSelectedExposure(hdrItem: HdrItem) {
  return hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ?? hdrItem.exposures[0] ?? null;
}

function getGroupItems(group: ProjectGroup, project: { hdrItems: HdrItem[] }) {
  return group.hdrItemIds
    .map((hdrItemId) => project.hdrItems.find((hdrItem) => hdrItem.id === hdrItemId))
    .filter((hdrItem): hdrItem is HdrItem => Boolean(hdrItem));
}

function normalizeFileIdentity(fileName: string) {
  return fileName.trim().toLowerCase();
}

function mergeProjectItemsWithLocalPreviews(projectItems: HdrItem[], draft: LocalImportDraft | null) {
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

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sortExposuresForHdr(exposures: LocalExposureDraft[]) {
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

function getDraftGroupId(draft: LocalImportDraft) {
  return draft.groups[0]?.id ?? 'local-hdr-groups';
}

function resequenceLocalHdrItems(items: LocalHdrItemDraft[], groupId: string) {
  return items.map((item, index) => ({
    ...item,
    index: index + 1,
    title: `HDR ${index + 1}`,
    groupId
  }));
}

function getHdrItemReviewStateFromExposures(exposures: LocalExposureDraft[]): LocalImportReviewState {
  if (exposures.some((exposure) => exposure.localReviewState === 'manual-review')) {
    return 'manual-review';
  }
  if (exposures.some((exposure) => exposure.localReviewState === 'preview-missing')) {
    return 'preview-missing';
  }
  return 'normal';
}

function syncLocalHdrGroups(draft: LocalImportDraft, hdrItems: LocalHdrItemDraft[], forcedGroupId?: string) {
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

function getLocalDraftDiagnostics(hdrItems: LocalHdrItemDraft[]): LocalImportDraft['diagnostics'] {
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

function pickLocalDefaultExposure(exposures: LocalExposureDraft[]) {
  return (
    [...exposures].sort((left, right) => {
      const leftAbs = Math.abs(left.exposureCompensation ?? 999);
      const rightAbs = Math.abs(right.exposureCompensation ?? 999);
      if (leftAbs !== rightAbs) return leftAbs - rightAbs;
      return (left.captureTime ?? '').localeCompare(right.captureTime ?? '');
    })[0] ?? null
  );
}

function mergeLocalImportDrafts(existing: LocalImportDraft, incoming: LocalImportDraft) {
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

function createHdrItemFromExposure(exposure: LocalExposureDraft, groupId: string): LocalHdrItemDraft {
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

function getProjectStatusLabel(project: ProjectRecord, locale: UiLocale) {
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

function formatPhotoCount(value: number, locale: UiLocale) {
  return locale === 'en' ? `${value} ${value === 1 ? 'photo' : 'photos'}` : `${value} 张照片`;
}

function formatGroupCount(value: number, locale: UiLocale) {
  return locale === 'en' ? `${value} ${value === 1 ? 'group' : 'groups'}` : `${value} 组`;
}

function formatGroupSummary(groupCount: number, photoCount: number, locale: UiLocale) {
  return locale === 'en'
    ? `${groupCount} ${groupCount === 1 ? 'group' : 'groups'} / ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`
    : `${groupCount} 组 / ${photoCount} 张照片`;
}

function formatUploadProgressLabel(
  snapshot: UploadProgressSnapshot | null,
  fallbackPercent: number,
  copy: (typeof UI_TEXT)[UiLocale]
) {
  if (!snapshot) {
    return fallbackPercent > 0 ? copy.uploadProgress(fallbackPercent) : copy.uploadStarting;
  }

  if (snapshot.stage === 'finalizing') {
    return copy.uploadFinalizeProgress(snapshot.totalFiles);
  }

  if (snapshot.stage === 'completed') {
    return copy.uploadFileProgress(snapshot.totalFiles, snapshot.totalFiles);
  }

  if (snapshot.stage === 'verifying') {
    return copy.uploadVerifyingProgress(snapshot.uploadedFiles, snapshot.totalFiles);
  }

  if (snapshot.stage === 'retrying') {
    return copy.uploadRetryProgress(
      snapshot.currentFileName || '',
      snapshot.attempt || 2,
      snapshot.maxAttempts || 3,
      snapshot.uploadedFiles,
      snapshot.totalFiles
    );
  }

  if (snapshot.stage === 'paused') {
    const pausedLabel = snapshot.offline
      ? copy === UI_TEXT.en
        ? 'waiting for network'
        : '等待网络恢复'
      : copy === UI_TEXT.en
        ? 'paused'
        : '已暂停';
    return `${copy.uploadFileProgress(snapshot.uploadedFiles, snapshot.totalFiles)} · ${pausedLabel}`;
  }

  return copy.uploadFileProgress(snapshot.uploadedFiles, snapshot.totalFiles);
}

function isHdrItemProcessing(status: HdrItem['status']) {
  return status === 'hdr-processing' || status === 'workflow-upload' || status === 'workflow-running' || status === 'processing';
}

function isProjectJobActivelyProcessing(job: ProjectJobState | null | undefined) {
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

function getHdrItemStatusLabel(hdrItem: HdrItem, locale: UiLocale) {
  const copy = UI_TEXT[locale];
  if (hdrItem.status === 'completed') return copy.hdrItemCompleted;
  if (hdrItem.status === 'error') return hdrItem.errorMessage ? `${copy.hdrItemFailed} / ${hdrItem.errorMessage}` : copy.hdrItemFailed;
  if (isHdrItemProcessing(hdrItem.status)) return copy.hdrItemProcessing;
  return copy.hdrItemReady;
}

function getProjectProgress(project: ProjectRecord, uploadPercent: number) {
  if (project.status === 'importing' || project.status === 'uploading') return uploadPercent;
  if (project.status === 'processing') {
    return Math.round(project.job?.percent ?? 0);
  }
  if (project.status === 'completed') return 100;
  return project.hdrItems.length ? 40 : 0;
}

function getMaxNavigableStep(project: ProjectRecord) {
  if (project.status === 'draft' || project.status === 'importing') return 1;
  if (project.status === 'review') return 2;
  if (project.status === 'uploading' || project.status === 'processing') return 3;
  return 4;
}

function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/^#/, '').toUpperCase();
  if (!trimmed || !/^[0-9A-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed}`;
}

function normalizeHexDraft(value: string) {
  const body = value
    .trim()
    .toUpperCase()
    .replace(/#/g, '')
    .replace(/[^0-9A-F]/g, '')
    .slice(0, 6);
  return body ? `#${body}` : '';
}

function isStrongPasswordInput(password: string) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function getHdrPreviewUrl(hdrItem: HdrItem) {
  const selectedExposure = getSelectedExposure(hdrItem);
  return resolveMediaUrl(
    hdrItem.previewUrl ??
      selectedExposure?.previewUrl ??
      hdrItem.exposures[0]?.previewUrl ??
      hdrItem.resultUrl ??
      null
  );
}

function getHdrLocalReviewState(hdrItem: HdrItem): LocalImportReviewState {
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

function getLocalReviewCopy(state: LocalImportReviewState, locale: UiLocale) {
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

function clampIndex(value: number, total: number) {
  if (!total) return null;
  return Math.max(0, Math.min(total - 1, value));
}

function clampEditorValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getAspectRatioValue(aspectRatio: ResultEditorAspectRatio) {
  if (aspectRatio === '1:1') return '1 / 1';
  if (aspectRatio === '4:5') return '4 / 5';
  if (aspectRatio === '3:2') return '3 / 2';
  if (aspectRatio === '16:9') return '16 / 9';
  return undefined;
}

function getAspectRatioNumber(aspectRatio: ResultEditorAspectRatio) {
  if (aspectRatio === '1:1') return 1;
  if (aspectRatio === '4:5') return 4 / 5;
  if (aspectRatio === '3:2') return 3 / 2;
  if (aspectRatio === '16:9') return 16 / 9;
  return null;
}

function getResultCropFrame(settings: ResultEditorSettings): ResultCropFrame {
  return {
    x: settings.cropFrameX,
    y: settings.cropFrameY,
    width: settings.cropFrameWidth,
    height: settings.cropFrameHeight
  };
}

function clampResultCropFrame(frame: ResultCropFrame): ResultCropFrame {
  const width = Math.max(8, Math.min(100, frame.width));
  const height = Math.max(8, Math.min(100, frame.height));
  const x = Math.max(0, Math.min(100 - width, frame.x));
  const y = Math.max(0, Math.min(100 - height, frame.y));
  return { x, y, width, height };
}

function buildResultCropFramePatch(frame: ResultCropFrame): Pick<
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

function getDefaultCropFrameForAspect(
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

function buildResultCropFrameStyle(settings: ResultEditorSettings): CSSProperties {
  const frame = clampResultCropFrame(getResultCropFrame(settings));
  return {
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${frame.width}%`,
    height: `${frame.height}%`
  };
}

function buildResultEditorImageStyle(settings: ResultEditorSettings): CSSProperties {
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

function getInitialAuthMode(): AuthMode {
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

function shouldOpenAuthFromQuery() {
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

function getPasswordResetTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('token') || params.get('resetToken') || '').trim();
}

function getEmailVerificationTokenFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('token') || params.get('verifyToken') || params.get('emailVerificationToken') || '').trim();
}

function clearAuthTokenQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  url.searchParams.delete('token');
  url.searchParams.delete('resetToken');
  url.searchParams.delete('verifyToken');
  url.searchParams.delete('emailVerificationToken');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function getRouteFromPath(pathname = window.location.pathname): AppRoute {
  const normalized = pathname.replace(/\/+$/, '').toLowerCase();
  if (normalized === '/admin') return 'admin';
  if (normalized === '/studio') return 'studio';
  if (normalized === '/plans' || normalized === '/pricing') return 'plans';
  return 'home';
}

function getPathForRoute(route: AppRoute) {
  if (route === 'admin') return '/admin';
  if (route === 'studio') return '/studio';
  if (route === 'plans') return '/plans';
  return '/home';
}

function App() {
  const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => getRouteFromPath());
  const [locale, setLocale] = useState<UiLocale>(getStoredLocale);
  const [session, setSession] = useState<SessionState | null>(() => {
    if (isDemoMode) {
      return {
        id: 'demo-user',
        userKey: 'zhoujin0618',
        email: 'zhoujin0618@gmail.com',
        emailVerifiedAt: new Date().toISOString(),
        displayName: 'zhou jin',
        locale: getStoredLocale(),
        role: 'admin',
        accountStatus: 'active'
      };
    }
    return null;
  });
  const [sessionReady, setSessionReady] = useState(isDemoMode);
  const [authOpen, setAuthOpen] = useState(() => shouldOpenAuthFromQuery());
  const [authMode, setAuthMode] = useState<AuthMode>(() => getInitialAuthMode());
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState<boolean | null>(null);
  const [authMessage, setAuthMessage] = useState('');
  const [auth, setAuth] = useState({ email: '', name: '', password: '', confirmPassword: '' });
  const [message, setMessage] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadActive, setUploadActive] = useState(false);
  const [uploadMode, setUploadMode] = useState<'local' | 'originals' | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadSnapshot, setUploadSnapshot] = useState<UploadProgressSnapshot | null>(null);
  const [uploadPaused, setUploadPaused] = useState(false);
  const [failedUploadFiles, setFailedUploadFiles] = useState<FailedUploadEntry[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [resultThumbnailManifest, setResultThumbnailManifest] = useState<{ projectId: string; urls: Record<string, string> } | null>(null);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(() => (isDemoMode ? DEMO_BILLING_SUMMARY : null));
  const [billingEntries, setBillingEntries] = useState<BillingEntry[]>(() => (isDemoMode ? DEMO_BILLING_ENTRIES : []));
  const [billingOrders, setBillingOrders] = useState<PaymentOrderRecord[]>([]);
  const [billingPackages, setBillingPackages] = useState<BillingPackage[]>(() => (isDemoMode ? DEMO_BILLING_PACKAGES : []));
  const [recentStripeOrder, setRecentStripeOrder] = useState<PaymentOrderRecord | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingModalMode, setBillingModalMode] = useState<'topup' | 'billing'>('billing');
  const [billingBusy, setBillingBusy] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [selectedBillingPackageId, setSelectedBillingPackageId] = useState<string | null>(null);
  const [customRechargeAmount, setCustomRechargeAmount] = useState('');
  const [rechargeActivationCode, setRechargeActivationCode] = useState('');
  const [rechargeMessage, setRechargeMessage] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<{ displayName: string; locale: UiLocale }>({
    displayName: '',
    locale: getStoredLocale()
  });
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminProjects, setAdminProjects] = useState<ProjectRecord[]>([]);
  const [adminOrders, setAdminOrders] = useState<PaymentOrderRecord[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminConsolePage, setAdminConsolePage] = useState<AdminConsolePage>('dashboard');
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [adminProjectsLoaded, setAdminProjectsLoaded] = useState(false);
  const [adminProjectsBusy, setAdminProjectsBusy] = useState(false);
  const [adminOrdersLoaded, setAdminOrdersLoaded] = useState(false);
  const [adminOrdersBusy, setAdminOrdersBusy] = useState(false);
  const [adminRefundOrder, setAdminRefundOrder] = useState<PaymentOrderRecord | null>(null);
  const [adminRefundPreview, setAdminRefundPreview] = useState<PaymentOrderRefundPreview | null>(null);
  const [adminRefundBusy, setAdminRefundBusy] = useState(false);
  const [adminOpsHealth, setAdminOpsHealth] = useState<AdminOpsHealthPayload | null>(null);
  const [adminOpsBusy, setAdminOpsBusy] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminRoleFilter, setAdminRoleFilter] = useState<AdminUserListQuery['role']>('all');
  const [adminStatusFilter, setAdminStatusFilter] = useState<AdminUserListQuery['accountStatus']>('all');
  const [adminVerifiedFilter, setAdminVerifiedFilter] = useState<AdminUserListQuery['emailVerified']>('all');
  const [adminPage, setAdminPage] = useState(1);
  const [adminPageSize, setAdminPageSize] = useState(25);
  const [adminTotalUsers, setAdminTotalUsers] = useState(0);
  const [adminPageCount, setAdminPageCount] = useState(1);
  const [adminSelectedUserId, setAdminSelectedUserId] = useState<string | null>(null);
  const [adminSelectedUser, setAdminSelectedUser] = useState<AdminUserSummary | null>(null);
  const [adminDetailProjects, setAdminDetailProjects] = useState<ProjectRecord[]>([]);
  const [adminDetailBillingEntries, setAdminDetailBillingEntries] = useState<BillingEntry[]>([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState<AdminAuditLogEntry[]>([]);
  const [adminDetailBusy, setAdminDetailBusy] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminAdjustment, setAdminAdjustment] = useState({ type: 'credit' as 'credit' | 'charge', points: '100', note: 'Manual credit' });
  const [adminActivationCodes, setAdminActivationCodes] = useState<AdminActivationCode[]>([]);
  const [adminActivationPackages, setAdminActivationPackages] = useState<BillingPackage[]>([]);
  const [adminActivationLoaded, setAdminActivationLoaded] = useState(false);
  const [adminActivationBusy, setAdminActivationBusy] = useState(false);
  const [adminSystemSettings, setAdminSystemSettings] = useState<AdminSystemSettings | null>(null);
  const [adminSystemLoaded, setAdminSystemLoaded] = useState(false);
  const [adminSystemBusy, setAdminSystemBusy] = useState(false);
  const [adminSystemDraft, setAdminSystemDraft] = useState({
    runpodHdrBatchSize: '10',
    runningHubMaxInFlight: String(DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT)
  });
  const [adminFeatureDrafts, setAdminFeatureDrafts] = useState<StudioFeatureConfig[]>([]);
  const [adminExpandedFeatureIds, setAdminExpandedFeatureIds] = useState<Record<string, boolean>>({});
  const [adminFeatureImageBusy, setAdminFeatureImageBusy] = useState<string | null>(null);
  const [adminPlanEditorOpen, setAdminPlanEditorOpen] = useState(false);
  const [adminPlanDraft, setAdminPlanDraft] = useState<AdminPlanDraft>(() => createAdminPlanDraft());
  const [adminBatchCodeOpen, setAdminBatchCodeOpen] = useState(false);
  const [adminBatchCodeDraft, setAdminBatchCodeDraft] = useState<AdminBatchCodeDraft>(() => createAdminBatchCodeDraft());
  const [adminWorkflowSummary, setAdminWorkflowSummary] = useState<AdminWorkflowSummary | null>(null);
  const [adminWorkflowLoaded, setAdminWorkflowLoaded] = useState(false);
  const [adminWorkflowBusy, setAdminWorkflowBusy] = useState(false);
  const [adminSelectedProjectId, setAdminSelectedProjectId] = useState<string | null>(null);
  const [adminActivationDraft, setAdminActivationDraft] = useState({
    code: '',
    label: '',
    packageId: '',
    discountPercentOverride: '',
    bonusPoints: '0',
    maxRedemptions: '',
    expiresAt: '',
    active: true
  });
  const [adminSettingsTab, setAdminSettingsTab] = useState<'basic' | 'api' | 'account'>('basic');
  const [adminWorksSearch, setAdminWorksSearch] = useState('');
  const [adminOrdersSearch, setAdminOrdersSearch] = useState('');
  const [adminOrdersStatusFilter, setAdminOrdersStatusFilter] = useState<'all' | 'paid' | 'checkout_created' | 'failed' | 'refunded'>('all');
  const [adminLogsSearch, setAdminLogsSearch] = useState('');
  const [adminCodesStatusFilter, setAdminCodesStatusFilter] = useState<'all' | 'available' | 'used' | 'expired' | 'inactive'>('all');
  const [adminSingleCodeOpen, setAdminSingleCodeOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [downloadDialogProjectId, setDownloadDialogProjectId] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadDraft, setDownloadDraft] = useState<DownloadDraft>(DEFAULT_DOWNLOAD_DRAFT);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAddress, setNewProjectAddress] = useState('');
  const [selectedFeatureId, setSelectedFeatureId] = useState<StudioFeatureId>('hdr-true-color');
  const [studioFeatureCards, setStudioFeatureCards] = useState<StudioFeatureDefinition[]>(STUDIO_FEATURES.filter((feature) => feature.status !== 'locked'));
  const [createDialogFiles, setCreateDialogFiles] = useState<File[]>([]);
  const [createDialogDragActive, setCreateDialogDragActive] = useState(false);
  const [groupColorOverrides, setGroupColorOverrides] = useState<Record<string, string>>({});
  const [localImportDrafts, setLocalImportDrafts] = useState<Record<string, LocalImportDraft>>({});
  const [resultViewerIndex, setResultViewerIndex] = useState<number | null>(null);
  const [resultEditorSettings, setResultEditorSettings] = useState<Record<string, ResultEditorSettings>>({});
  const [draggedResultHdrItemId, setDraggedResultHdrItemId] = useState<string | null>(null);
  const [dragOverResultHdrItemId, setDragOverResultHdrItemId] = useState<string | null>(null);
  const [resultDragPreview, setResultDragPreview] = useState<{ projectId: string; orderedHdrItemIds: string[] } | null>(null);
  const [resultColorCards, setResultColorCards] = useState<Record<string, string>>({});
  const [savedResultColorCards, setSavedResultColorCards] = useState<ResultColorCard[]>(getStoredResultColorCards);
  const [resultRegenerateBusy, setResultRegenerateBusy] = useState<Record<string, boolean>>({});
  const [studioGuideOpen, setStudioGuideOpen] = useState(false);
  const [studioGuideStep, setStudioGuideStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);
  const resultCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const resultLayoutSnapshotRef = useRef<Record<string, DOMRect>>({});
  const hdrExposureSwipeRef = useRef<{ hdrItemId: string; startX: number; startY: number } | null>(null);
  const resultCropDragRef = useRef<ResultCropDragState | null>(null);
  const resultCropFrameDragRef = useRef<ResultCropFrameDragState | null>(null);
  const resultCanvasRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const uploadPausedRef = useRef(false);
  const uploadPauseResolversRef = useRef<Array<() => void>>([]);
  const uploadPauseControllerRef = useRef<UploadPauseController>({
    isPaused: () => uploadPausedRef.current,
    waitUntilResumed: (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (!uploadPausedRef.current) {
          resolve();
          return;
        }

        function cleanup() {
          uploadPauseResolversRef.current = uploadPauseResolversRef.current.filter((resolver) => resolver !== resume);
          signal?.removeEventListener('abort', abort);
        }
        const resume = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new DOMException('Upload cancelled.', 'AbortError'));
        };

        uploadPauseResolversRef.current.push(resume);
        signal?.addEventListener('abort', abort, { once: true });
      })
  });
  const emailVerificationHandledRef = useRef(false);
  const checkoutHandledRef = useRef(false);

  const demoProjects = useMemo(() => createDemoProjects(), []);
  const visibleProjects = isDemoMode ? demoProjects : projects;
  const copy = UI_TEXT[locale];
  const visibleStudioFeatures = studioFeatureCards.filter((feature) => feature.status !== 'locked');
  const selectedFeature = visibleStudioFeatures.find((feature) => feature.id === selectedFeatureId) ?? visibleStudioFeatures[0] ?? STUDIO_FEATURES[0];
  const availableFeatureCount = visibleStudioFeatures.length;
  const activeStepLabels = isDemoMode ? copy.demoStepLabels : copy.stepLabels;
  const studioGuideSteps = useMemo(
    () => [
      { id: 'project', title: copy.studioGuideStep1Title, body: copy.studioGuideStep1Body },
      { id: 'import', title: copy.studioGuideStep2Title, body: copy.studioGuideStep2Body },
      { id: 'grouping', title: copy.studioGuideStep3Title, body: copy.studioGuideStep3Body },
      { id: 'send', title: copy.studioGuideStep4Title, body: copy.studioGuideStep4Body },
      { id: 'results', title: copy.studioGuideStep5Title, body: copy.studioGuideStep5Body },
      { id: 'billing', title: copy.studioGuideStep6Title, body: copy.studioGuideStep6Body }
    ],
    [copy]
  );
  const safeStudioGuideStep = Math.min(studioGuideStep, studioGuideSteps.length - 1);
  const activeStudioGuideStep = studioGuideSteps[safeStudioGuideStep];
  const authTitle =
    authMode === 'signin'
      ? copy.authTitleSignin
      : authMode === 'signup'
        ? copy.authTitleSignup
        : authMode === 'reset-request'
          ? copy.authTitleResetRequest
          : authMode === 'reset-confirm'
            ? copy.authTitleResetConfirm
            : copy.authTitleVerifyEmail;
  const authSubtitle =
    authMode === 'signin'
      ? copy.authSubtitleSignin
      : authMode === 'signup'
        ? copy.authSubtitleSignup
        : authMode === 'reset-request'
          ? copy.authSubtitleResetRequest
          : authMode === 'reset-confirm'
            ? copy.authSubtitleResetConfirm
            : copy.authSubtitleVerifyEmail;
  const isPasswordResetMode = authMode === 'reset-request' || authMode === 'reset-confirm';
  const isEmailVerifyMode = authMode === 'verify-email';
  const isAuthLinkMode = isPasswordResetMode || isEmailVerifyMode;
  const authSubmitLabel = authBusy
    ? copy.authWorking
    : authMode === 'signin'
      ? copy.authModeSignin
      : authMode === 'signup'
        ? copy.authModeSignup
        : authMode === 'reset-request'
          ? copy.authModeResetRequest
          : authMode === 'reset-confirm'
            ? copy.authModeResetConfirm
            : copy.authModeVerifyEmail;

  useEffect(() => {
    const isImageTarget = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('img'));
    const blockImageContextMenu = (event: MouseEvent) => {
      if (isImageTarget(event.target)) {
        event.preventDefault();
      }
    };
    const blockImageDrag = (event: DragEvent) => {
      if (isImageTarget(event.target)) {
        event.preventDefault();
      }
    };

    document.addEventListener('contextmenu', blockImageContextMenu);
    document.addEventListener('dragstart', blockImageDrag);
    return () => {
      document.removeEventListener('contextmenu', blockImageContextMenu);
      document.removeEventListener('dragstart', blockImageDrag);
    };
  }, []);

  const currentProject = useMemo(
    () => (currentProjectId ? visibleProjects.find((project) => project.id === currentProjectId) ?? null : null),
    [visibleProjects, currentProjectId]
  );
  const displayResultAssets = useMemo(() => {
    const assets = currentProject?.resultAssets ?? [];
    if (!resultDragPreview || resultDragPreview.projectId !== currentProject?.id) {
      return assets;
    }

    const assetsByHdrItemId = new Map(assets.map((asset) => [asset.hdrItemId, asset]));
    const orderedAssets = resultDragPreview.orderedHdrItemIds
      .map((hdrItemId) => assetsByHdrItemId.get(hdrItemId) ?? null)
      .filter((asset): asset is ResultAsset => Boolean(asset));
    const orderedIds = new Set(orderedAssets.map((asset) => asset.hdrItemId));
    const missingAssets = assets.filter((asset) => !orderedIds.has(asset.hdrItemId));
    return [...orderedAssets, ...missingAssets];
  }, [currentProject, resultDragPreview]);
  useEffect(() => {
    if (isDemoMode || !currentProject?.id || currentProject.resultAssets.length === 0) {
      return;
    }

    let cancelled = false;
    void fetchResultThumbnails(currentProject.id)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setResultThumbnailManifest({
          projectId: currentProject.id,
          urls: Object.fromEntries(payload.thumbnails.map((thumbnail) => [thumbnail.assetId, thumbnail.url]))
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResultThumbnailManifest({ projectId: currentProject.id, urls: {} });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, currentProject?.resultAssets.length, currentProject?.updatedAt, isDemoMode]);
  const resultThumbnailUrls =
    resultThumbnailManifest && resultThumbnailManifest.projectId === currentProject?.id ? resultThumbnailManifest.urls : {};
  const activeLocalDraft = currentProject ? localImportDrafts[currentProject.id] ?? null : null;
  const downloadProject =
    visibleProjects.find((project) => project.id === downloadDialogProjectId) ??
    (currentProject && currentProject.id === downloadDialogProjectId ? currentProject : null);
  const activeBillingPackageId =
    (selectedBillingPackageId && billingPackages.some((billingPackage) => billingPackage.id === selectedBillingPackageId)
      ? selectedBillingPackageId
      : billingPackages[0]?.id) ?? null;
  const availableResultColorCards = useMemo(
    () => getAvailableResultColorCards(savedResultColorCards, locale),
    [locale, savedResultColorCards]
  );
  const selectedBillingPackage = billingPackages.find((billingPackage) => billingPackage.id === activeBillingPackageId) ?? null;
  const customRechargeIsActive = customRechargeAmount.trim().length > 0;
  const customRechargeAmountUsd = customRechargeIsActive ? parseCustomRechargeAmount(customRechargeAmount) : null;
  const customRechargePoints = customRechargeAmountUsd === null ? 0 : getCustomRechargePoints(customRechargeAmountUsd);
  const latestPaidStripeOrder =
    recentStripeOrder ??
    billingOrders.find((order) => order.status === 'paid' && Boolean(order.stripeCheckoutSessionId)) ??
    null;
  const viewerAssets = displayResultAssets;
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
  const currentProjectRegenerationUsage = currentProject?.regenerationUsage ?? {
    freeLimit: 10,
    freeUsed: 0,
    paidUsed: 0
  };
  const projectFreeRegenerationsRemaining = Math.max(
    0,
    currentProjectRegenerationUsage.freeLimit - currentProjectRegenerationUsage.freeUsed
  );
  const currentWorkspaceStep = currentProject?.currentStep ?? 1;
  const useLocalReviewDraft = Boolean(activeLocalDraft && currentWorkspaceStep <= 2);
  const workspaceHdrItems = useLocalReviewDraft
    ? activeLocalDraft?.hdrItems ?? []
    : currentProject
      ? mergeProjectItemsWithLocalPreviews(currentProject.hdrItems, activeLocalDraft)
      : [];
  const workspaceGroups = useLocalReviewDraft ? activeLocalDraft?.groups ?? [] : currentProject?.groups ?? [];
  const workspacePointsEstimate = activeLocalDraft ? workspaceHdrItems.length : currentProject?.pointsEstimate ?? 0;
  const workspaceReviewProject = currentProject ? { hdrItems: workspaceHdrItems as HdrItem[], groups: workspaceGroups } : null;
  const localDraftDiagnostics = activeLocalDraft?.diagnostics ?? null;
  const showLocalImportDiagnostics = Boolean(
    localDraftDiagnostics && (localDraftDiagnostics.previewMissingCount > 0 || localDraftDiagnostics.manualReviewCount > 0)
  );
  const hasReviewContent = workspaceHdrItems.length > 0;
  const hasResultContent = displayResultAssets.length > 0;
  const failedResultHdrItems = workspaceHdrItems.filter(
    (item) => item.status === 'error' && !displayResultAssets.some((asset) => asset.hdrItemId === item.id)
  );
  const hasFailedResultHdrItems = failedResultHdrItems.length > 0;
  const showUploadStepContent = currentWorkspaceStep === 1 && !activeLocalDraft;
  const showUploadProgress = showUploadStepContent && uploadActive;
  const uploadProgressLabel = formatUploadProgressLabel(uploadSnapshot, uploadPercent, copy);
  const uploadProgressWidth = uploadPercent > 0 ? uploadPercent : 6;
  const showReviewStepContent = (currentWorkspaceStep === 2 || currentWorkspaceStep === 3) && hasReviewContent;
  const projectStatus = currentProject?.status;
  const showProcessingGroupGrid =
    !isDemoMode &&
    hasReviewContent &&
    (currentWorkspaceStep === 3 ||
      projectStatus === 'uploading' ||
      projectStatus === 'processing' ||
      projectStatus === 'failed');
  const showReviewActions = !isDemoMode && currentWorkspaceStep === 2 && !showProcessingGroupGrid;
  const canEditHdrGrouping = !isDemoMode && currentWorkspaceStep === 2 && !uploadActive && !showProcessingGroupGrid;
  const showReviewLocalImportProgress = showReviewStepContent && uploadActive && uploadMode === 'local';
  const showReviewUploadProgress =
    currentWorkspaceStep === 2 && uploadActive && uploadMode === 'originals' && Boolean(activeLocalDraft);
  const showAdvancedGroupingControls = false;
  const showProcessingStepContent = currentWorkspaceStep === 3;
  const showProcessingUploadProgress = showProcessingStepContent && uploadActive && uploadMode === 'originals';
  const showResumeUploadAction = Boolean(activeLocalDraft && !uploadActive && currentProject?.status === 'uploading');
  const hasActiveProcessingItems = workspaceHdrItems.some((item) => isHdrItemProcessing(item.status));
  const jobActivelyProcessing = isProjectJobActivelyProcessing(currentProject?.job);
  const jobFailedWhileItemsActive = Boolean(currentProject?.job?.status === 'failed' && (hasActiveProcessingItems || jobActivelyProcessing));
  const showRetryProcessingAction =
    Boolean(currentProject && hasFailedResultHdrItems && !hasActiveProcessingItems && !jobActivelyProcessing) && !uploadActive;
  const processingPanelTitle = showProcessingUploadProgress
    ? copy.uploadOriginalsTitle
    : jobFailedWhileItemsActive
      ? copy.processingGroupsTitle
    : currentProject?.job?.label || copy.waitingProcessing;
  const processingPanelDetail = showProcessingUploadProgress
    ? `${uploadProgressLabel} · ${copy.uploadOriginalsDoNotClose}`
    : jobFailedWhileItemsActive
      ? copy.processingGroupsHint
    : currentProject?.job?.detail || copy.waitingProcessingHint;
  const showResultsStepContent = currentWorkspaceStep === 4 && (hasResultContent || hasFailedResultHdrItems);
  const adminTotals = useMemo(
    () => ({
      users: adminTotalUsers || adminUsers.length,
      projects: adminUsers.reduce((sum, user) => sum + user.projectCount, 0),
      photos: adminUsers.reduce((sum, user) => sum + user.photoCount, 0),
      revenue: adminUsers.reduce((sum, user) => sum + user.billingSummary.totalTopUpUsd, 0)
    }),
    [adminTotalUsers, adminUsers]
  );
  const adminSelectedProject = useMemo(
    () => adminDetailProjects.find((project) => project.id === adminSelectedProjectId) ?? adminDetailProjects[0] ?? null,
    [adminDetailProjects, adminSelectedProjectId]
  );
  const adminSelectedProjectResults = adminSelectedProject?.resultAssets ?? [];
  const adminSelectedProjectFailedItems =
    adminSelectedProject?.hdrItems.filter((item) => item.status === 'error') ?? [];
  const adminSelectedProjectProcessingItems =
    adminSelectedProject?.hdrItems.filter((item) => isHdrItemProcessing(item.status)) ?? [];
  const hasAdminSession = session?.role === 'admin' && session.accountStatus === 'active';
  const adminUserQuery = useMemo<AdminUserListQuery>(
    () => ({
      search: adminSearch,
      role: adminRoleFilter,
      accountStatus: adminStatusFilter,
      emailVerified: adminVerifiedFilter,
      page: adminPage,
      pageSize: adminPageSize
    }),
    [adminPage, adminPageSize, adminRoleFilter, adminSearch, adminStatusFilter, adminVerifiedFilter]
  );

  const getGroupColorDraft = (group: ProjectGroup) => groupColorOverrides[group.id] ?? group.replacementColor ?? '#D2CBC1';

  function upsertLocalImportDraft(draft: LocalImportDraft) {
    setLocalImportDrafts((current) => {
      const existing = current[draft.projectId];
      if (existing) {
        revokeLocalImportDraftUrls(existing);
      }
      return { ...current, [draft.projectId]: draft };
    });
    void loadLocalImportModule().then((module) => module.persistLocalImportDraft(draft)).catch(() => {
      // Browser storage can fail for very large RAW sets; the in-memory draft still works.
    });
  }

  function clearLocalImportDraft(projectId: string) {
    setLocalImportDrafts((current) => {
      const existing = current[projectId];
      if (!existing) {
        return current;
      }

      revokeLocalImportDraftUrls(existing);
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    void loadLocalImportModule().then((module) => module.deleteStoredLocalImportDraft(projectId)).catch(() => {
      // Ignore cleanup failures; stale local drafts are overwritten on the next import.
    });
  }

  function updateLocalImportDraft(projectId: string, updater: (draft: LocalImportDraft) => LocalImportDraft) {
    setLocalImportDrafts((current) => {
      const existing = current[projectId];
      if (!existing) {
        return current;
      }

      const updated = updater(existing);
      void loadLocalImportModule().then((module) => module.persistLocalImportDraft(updated)).catch(() => {
        // Keep UI responsive even if browser storage quota is exhausted.
      });
      return {
        ...current,
        [projectId]: updated
      };
    });
  }

  function captureResultCardLayout() {
    const snapshot: Record<string, DOMRect> = {};
    Object.entries(resultCardRefs.current).forEach(([hdrItemId, element]) => {
      if (element) {
        snapshot[hdrItemId] = element.getBoundingClientRect();
      }
    });
    resultLayoutSnapshotRef.current = snapshot;
  }

  useLayoutEffect(() => {
    const snapshot = resultLayoutSnapshotRef.current;
    if (!Object.keys(snapshot).length) {
      return;
    }

    displayResultAssets.forEach((asset) => {
      const element = resultCardRefs.current[asset.hdrItemId];
      const previous = snapshot[asset.hdrItemId];
      if (!element || !previous || element.classList.contains('dragging') || element.classList.contains('drag-over')) {
        return;
      }

      const next = element.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }

      element.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0, 0)' }],
        {
          duration: 260,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
        }
      );
    });

    resultLayoutSnapshotRef.current = {};
  }, [displayResultAssets]);

  useEffect(() => {
    window.localStorage.setItem('metrovanai_locale', locale);
  }, [locale]);

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

  useEffect(() => {
    const syncRoute = () => setActiveRoute(getRouteFromPath());
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', `/home${window.location.search}${window.location.hash}`);
    }
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if ((activeRoute !== 'studio' && activeRoute !== 'admin') || session || !sessionReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAuthMode('signin');
      setAuthOpen(true);
      setAuthMessage('');
      setMessage(activeRoute === 'admin' ? '请先用管理员账号登录后台。' : '');
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeRoute, session, sessionReady]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminBusy(true);
      setAdminMessage('');
      fetchAdminUsers(adminUserQuery)
        .then((response) => {
          if (cancelled) return;
          setAdminUsers(response.items);
          setAdminTotalUsers(response.total);
          setAdminPage(response.page);
          setAdminPageSize(response.pageSize);
          setAdminPageCount(response.pageCount);
          setAdminLoaded(true);
          setAdminMessage('');
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '管理员连接失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminLoaded, adminUserQuery, hasAdminSession, locale]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminProjectsLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminProjectsBusy(true);
      fetchAdminProjects()
        .then((response) => {
          if (cancelled) return;
          setAdminProjects(response.items);
          setAdminProjectsLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminProjectsLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '项目列表读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminProjectsBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminProjectsLoaded, hasAdminSession, locale]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminOrdersLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminOrdersBusy(true);
      fetchAdminOrders()
        .then((response) => {
          if (cancelled) return;
          setAdminOrders(response.items);
          setAdminOrdersLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminOrdersLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '订单列表读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminOrdersBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminOrdersLoaded, hasAdminSession, locale]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminOpsHealth || adminOpsBusy) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminOpsBusy(true);
      fetchAdminOpsHealth()
        .then((response) => {
          if (cancelled) return;
          setAdminOpsHealth(response);
        })
        .catch(() => {
          if (cancelled) return;
          setAdminOpsHealth(null);
        })
        .finally(() => {
          if (!cancelled) {
            setAdminOpsBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminOpsBusy, adminOpsHealth, hasAdminSession]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminActivationLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminActivationBusy(true);
      fetchAdminActivationCodes()
        .then((response) => {
          if (cancelled) return;
          setAdminActivationCodes(response.items);
          setAdminActivationPackages(response.packages);
          setBillingPackages(response.packages);
          setAdminActivationLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminActivationLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '优惠码读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminActivationBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminActivationLoaded, hasAdminSession, locale]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminSystemLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminSystemBusy(true);
      fetchAdminSettings()
        .then((response) => {
          if (cancelled) return;
          syncAdminSystemSettings(response.settings);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminSystemLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '系统设置读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminSystemBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminSystemLoaded, hasAdminSession, locale]);

  useEffect(() => {
    if (activeRoute !== 'admin' || !hasAdminSession || adminWorkflowLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminWorkflowBusy(true);
      fetchAdminWorkflows()
        .then((response) => {
          if (cancelled) return;
          setAdminWorkflowSummary(response.workflows);
          syncAdminSystemSettings(response.settings);
          setAdminWorkflowLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminWorkflowLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '工作流配置读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminWorkflowBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminWorkflowLoaded, hasAdminSession, locale]);

  useEffect(() => {
    let cancelled = false;
    fetchStudioFeatures()
      .then((response) => {
        if (cancelled) return;
        const cards = response.features.map(studioFeatureConfigToDefinition).filter((feature) => feature.status !== 'locked');
        if (cards.length) {
          setStudioFeatureCards(cards);
          setSelectedFeatureId((current) => (cards.some((feature) => feature.id === current) ? current : cards[0]!.id));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStudioFeatureCards(STUDIO_FEATURES.filter((feature) => feature.status !== 'locked'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userMenuOpen && !historyMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (!historyMenuRef.current?.contains(event.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [userMenuOpen, historyMenuOpen]);

  useEffect(() => {
    const completedProjectId = currentProject?.status === 'completed' ? currentProject.id : null;
    if (!completedProjectId || !localImportDrafts[completedProjectId]) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLocalImportDrafts((current) => {
        const existing = current[completedProjectId];
        if (!existing) {
          return current;
        }

        revokeLocalImportDraftUrls(existing);
        const next = { ...current };
        delete next[completedProjectId];
        return next;
      });
      void loadLocalImportModule().then((module) => module.deleteStoredLocalImportDraft(completedProjectId)).catch(() => {
        // Ignore cleanup failures; stale local drafts are overwritten on the next import.
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [currentProject?.id, currentProject?.status, localImportDrafts]);

  function upsertProject(project: ProjectRecord) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setCurrentProjectId(project.id);
  }

  function syncBilling(payload: { summary: BillingSummary; entries: BillingEntry[]; orders?: PaymentOrderRecord[]; packages: BillingPackage[] }) {
    setBillingSummary(payload.summary);
    setBillingEntries(payload.entries);
    setBillingOrders(payload.orders ?? []);
    setBillingPackages(payload.packages);
  }

  function syncAdminSystemSettings(settings: AdminSystemSettings) {
    setAdminSystemSettings(settings);
    setAdminSystemDraft({
      runpodHdrBatchSize: String(settings.runpodHdrBatchSize),
      runningHubMaxInFlight: String(settings.runningHubMaxInFlight ?? DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT)
    });
    setAdminFeatureDrafts(normalizeStudioFeatureDrafts(settings.studioFeatures));
    setAdminActivationPackages(settings.billingPackages);
    setBillingPackages(settings.billingPackages);
    setAdminSystemLoaded(true);
  }

  function collectLocalDraftFiles(draft: LocalImportDraft) {
    const filesByIdentity = new Map<string, File>();
    for (const hdrItem of draft.hdrItems) {
      for (const exposure of hdrItem.exposures) {
        const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
        if (!filesByIdentity.has(key)) {
          filesByIdentity.set(key, exposure.file);
        }
      }
    }
    return Array.from(filesByIdentity.values());
  }

  function collectLocalHdrItemFiles(hdrItem: LocalHdrItemDraft) {
    const filesByIdentity = new Map<string, File>();
    for (const exposure of hdrItem.exposures) {
      const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
      if (!filesByIdentity.has(key)) {
        filesByIdentity.set(key, exposure.file);
      }
    }
    return Array.from(filesByIdentity.values());
  }

  function buildSingleHdrLayoutPayload(
    draft: LocalImportDraft,
    hdrItem: LocalHdrItemDraft,
    uploadedObjects: UploadedObjectReference[] = []
  ) {
    return buildHdrLayoutPayload({ ...draft, hdrItems: [hdrItem] }, uploadedObjects);
  }

  function buildHdrLayoutPayload(draft: LocalImportDraft, uploadedObjects: UploadedObjectReference[] = draft.uploadedObjects ?? []) {
    const uploadsByIdentity = new Map<string, UploadedObjectReference[]>();
    for (const uploaded of uploadedObjects) {
      const key = normalizeFileIdentity(uploaded.originalName);
      uploadsByIdentity.set(key, [...(uploadsByIdentity.get(key) ?? []), uploaded]);
    }

    const takeUploadedObject = (exposure: LocalExposureDraft) => {
      const key = normalizeFileIdentity(exposure.originalName || exposure.fileName);
      const matches = uploadsByIdentity.get(key);
      return matches?.shift() ?? null;
    };

    return draft.hdrItems
      .filter((hdrItem) => hdrItem.exposures.length > 0)
      .map((hdrItem) => {
        const selectedExposure =
          hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId) ??
          hdrItem.exposures[0] ??
          null;
        const exposures = hdrItem.exposures.map((exposure) => {
          const uploaded = takeUploadedObject(exposure);
          return {
            originalName: exposure.originalName || exposure.fileName,
            fileName: exposure.fileName,
            extension: exposure.extension,
            mimeType: exposure.mimeType || uploaded?.mimeType || 'application/octet-stream',
            size: exposure.size || uploaded?.size,
            isRaw: exposure.isRaw,
            storageKey: uploaded?.storageKey ?? null,
            captureTime: exposure.captureTime,
            sequenceNumber: exposure.sequenceNumber,
            exposureCompensation: exposure.exposureCompensation,
            exposureSeconds: exposure.exposureSeconds,
            iso: exposure.iso,
            fNumber: exposure.fNumber,
            focalLength: exposure.focalLength
          };
        });
        return {
          exposureOriginalNames: hdrItem.exposures.map((exposure) => exposure.originalName || exposure.fileName),
          selectedOriginalName: selectedExposure?.originalName ?? selectedExposure?.fileName ?? null,
          exposures
        };
      });
  }

  function getUploadReferenceIdentity(input: { originalName: string; size: number }) {
    return `${normalizeFileIdentity(input.originalName)}:${input.size}`;
  }

  function getLocalFileUploadIdentity(file: File) {
    const maybePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const relativePath = typeof maybePath === 'string' ? maybePath.trim().toLowerCase() : '';
    return `${normalizeFileIdentity(file.name)}:${file.size}:${file.lastModified}:${relativePath}`;
  }

  function mergeUploadedObjectReferences(
    current: UploadedObjectReference[] | undefined,
    additions: UploadedObjectReference[]
  ) {
    const byIdentity = new Map<string, UploadedObjectReference>();
    for (const uploaded of current ?? []) {
      byIdentity.set(getUploadReferenceIdentity(uploaded), uploaded);
    }
    for (const uploaded of additions) {
      byIdentity.set(getUploadReferenceIdentity(uploaded), uploaded);
    }
    return Array.from(byIdentity.values());
  }

  function getUploadedObjectsForFiles(uploadedObjects: UploadedObjectReference[], files: File[]) {
    const byIdentity = new Map(uploadedObjects.map((uploaded) => [getUploadReferenceIdentity(uploaded), uploaded]));
    return files
      .map((file) => byIdentity.get(getUploadReferenceIdentity({ originalName: file.name, size: file.size })))
      .filter((uploaded): uploaded is UploadedObjectReference => Boolean(uploaded));
  }

  async function refreshBilling() {
    if (isDemoMode || !session) {
      return;
    }

    const response = await fetchBilling();
    syncBilling(response);
  }

  useEffect(() => {
    if (isDemoMode) {
      return;
    }

    let cancelled = false;
    void fetchSession()
      .then((response) => {
        if (cancelled) return;
        setSession(response.session?.user ?? null);
        if (response.session?.user?.locale) {
          setLocale(response.session.user.locale);
        }
        setSessionReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(getUserFacingErrorMessage(error, copy.loadSessionFailed, locale));
        setSessionReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [copy.loadSessionFailed, isDemoMode, locale]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage('');
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [message]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }

    let cancelled = false;
    void fetchAuthProviders()
      .then((response) => {
        if (cancelled) return;
        setGoogleAuthEnabled(response.google.enabled);
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleAuthEnabled(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemoMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    const authProvider = params.get('authProvider');
    if (!authError && !authProvider) {
      return;
    }

    startTransition(() => {
      if (authError) {
        setAuthMessage(getAuthFeedbackMessage(authError, locale));
        setMessage('');
        setAuthOpen(true);
        setAuthMode('signin');
      } else if (authProvider === 'google') {
        setMessage(copy.googleSuccess);
      }
    });

    params.delete('authError');
    params.delete('authProvider');
    params.delete('auth');
    const nextQuery = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
  }, [copy.googleSuccess, locale]);

  useEffect(() => {
    if (isDemoMode || !authOpen || authMode !== 'verify-email' || emailVerificationHandledRef.current) {
      return;
    }

    const verificationToken = getEmailVerificationTokenFromQuery();
    if (!verificationToken) {
      const timer = window.setTimeout(() => {
        setAuthMessage(copy.authVerifyTokenMissing);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    emailVerificationHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setAuthBusy(true);
      setAuthMessage(copy.authSubtitleVerifyEmail);
      void confirmEmailVerification({ token: verificationToken })
        .then((response) => {
          clearAuthTokenQuery();
          setSession(response.session.user);
          setLocale(response.session.user.locale);
          setAuthOpen(false);
          setAuth({ email: '', name: '', password: '', confirmPassword: '' });
          setAuthMessage('');
          const nextPath = getPathForRoute('studio');
          const nextUrl = `${nextPath}${window.location.hash}`;
          if (window.location.pathname !== nextPath) {
            window.history.pushState({}, '', nextUrl);
          }
          setActiveRoute('studio');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setMessage(copy.authEmailVerifiedSuccess);
        })
        .catch((error) => {
          setAuthMessage(getAuthErrorMessage(error, 'verify-email', locale));
          setMessage('');
        })
        .finally(() => {
          setAuthBusy(false);
        });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [authMode, authOpen, copy.authEmailVerifiedSuccess, copy.authSubtitleVerifyEmail, copy.authVerifyTokenMissing, isDemoMode, locale]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!sessionReady || !session) return;
    let cancelled = false;

    void fetchProjects()
      .then((response) => {
        if (cancelled) return;
        setProjects(response.items);
        setCurrentProjectId((current) => {
          if (current && response.items.some((item) => item.id === current)) {
            return current;
          }
          return null;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(getUserFacingErrorMessage(error, copy.loadProjectsFailed, locale));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [copy.loadProjectsFailed, isDemoMode, locale, session, sessionReady]);

  useEffect(() => {
    if (isDemoMode || !sessionReady || !session) return;
    const candidates = projects.filter(
      (project) =>
        project.status === 'review' &&
        project.currentStep === 2 &&
        project.hdrItems.length === 0 &&
        !localImportDrafts[project.id]
    );
    if (!candidates.length) return;

    let cancelled = false;
    void loadLocalImportModule().then((module) => Promise.all(candidates.map((project) => module.restoreStoredLocalImportDraft(project.id))))
      .then((drafts) => {
        const restoredDrafts = drafts.filter((draft): draft is LocalImportDraft => Boolean(draft));
        if (!restoredDrafts.length) return;

        if (cancelled) {
          restoredDrafts.forEach((draft) => revokeLocalImportDraftUrls(draft));
          return;
        }

        setLocalImportDrafts((current) => {
          const next = { ...current };
          for (const draft of restoredDrafts) {
            if (next[draft.projectId]) {
              revokeLocalImportDraftUrls(draft);
              continue;
            }
            next[draft.projectId] = draft;
          }
          return next;
        });
      })
      .catch(() => {
        // Local draft restore is best effort; user can reselect files if browser storage is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [isDemoMode, localImportDrafts, projects, session, sessionReady]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!sessionReady || !session) return;
    let cancelled = false;

    void fetchBilling()
      .then((response) => {
        if (cancelled) return;
        syncBilling(response);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(getUserFacingErrorMessage(error, copy.loadBillingFailed, locale));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [copy.loadBillingFailed, isDemoMode, locale, session, sessionReady]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!sessionReady || !session || checkoutHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const paymentState = params.get('payment');
    const stripeSessionId = params.get('session_id');
    if (!paymentState) {
      return;
    }

    const clearPaymentParams = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('payment');
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };

    if (paymentState === 'cancelled') {
      checkoutHandledRef.current = true;
      clearPaymentParams();
      const timer = window.setTimeout(() => {
        setMessage(copy.paymentCancelled);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (paymentState !== 'success' || !stripeSessionId) {
      return;
    }

    checkoutHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setBillingBusy(true);
      setMessage(copy.paymentConfirming);
      void confirmCheckoutSession(stripeSessionId)
        .then((response) => {
          syncBilling(response.billing);
          setRecentStripeOrder(response.order);
          setRechargeOpen(false);
          setBillingModalMode('billing');
          setBillingOpen(true);
          setCustomRechargeAmount('');
          setRechargeActivationCode('');
          setRechargeMessage('');
          setMessage(`${copy.topUpSuccess} ${copy.stripePaymentSuccessTitle}`);
        })
        .catch((error) => {
          setMessage(getUserFacingErrorMessage(error, copy.topUpFailed, locale));
        })
        .finally(() => {
          clearPaymentParams();
          setBillingBusy(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    copy.paymentCancelled,
    copy.paymentConfirming,
    copy.topUpFailed,
    copy.topUpSuccess,
    copy.stripePaymentSuccessTitle,
    isDemoMode,
    locale,
    session,
    sessionReady
  ]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!currentProject) return;
    const shouldPoll =
      currentProject.status === 'importing' ||
      currentProject.status === 'uploading' ||
      currentProject.status === 'processing' ||
      currentProject.resultAssets.some((asset) => asset.regeneration?.status === 'running') ||
      currentProject.job?.status === 'pending' ||
      currentProject.job?.status === 'processing';

    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      void fetchProject(currentProject.id)
        .then((response) => {
          upsertProject(response.project);
          if (
            response.project.status !== currentProject.status &&
            (response.project.status === 'completed' || response.project.status === 'failed') &&
            session
          ) {
            void fetchBilling()
              .then((billingResponse) => {
                syncBilling(billingResponse);
              })
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [isDemoMode, currentProject, session]);

  useEffect(() => {
    if (isDemoMode || activeRoute !== 'admin' || !hasAdminSession || !adminSelectedProject) {
      return;
    }

    const shouldPoll =
      adminSelectedProject.status === 'importing' ||
      adminSelectedProject.status === 'uploading' ||
      adminSelectedProject.status === 'processing' ||
      adminSelectedProject.resultAssets.some((asset) => asset.regeneration?.status === 'running') ||
      adminSelectedProject.hdrItems.some((item) => isHdrItemProcessing(item.status)) ||
      adminSelectedProject.job?.status === 'pending' ||
      adminSelectedProject.job?.status === 'processing';

    if (!shouldPoll) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchProject(adminSelectedProject.id)
        .then((response) => {
          setAdminDetailProjects((current) =>
            current.map((project) => (project.id === response.project.id ? response.project : project))
          );
        })
        .catch(() => undefined);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [activeRoute, adminSelectedProject, hasAdminSession, isDemoMode]);

  function navigateToRoute(nextRoute: AppRoute) {
    let resolvedRoute = nextRoute;
    if (nextRoute === 'admin' && !hasAdminSession) {
      if (session) {
        setMessage('当前账号没有管理员权限。');
        resolvedRoute = 'studio';
      } else {
        setAuthMode('signin');
        setAuthOpen(true);
        setAuthMessage('');
        setMessage('请先用管理员账号登录后台。');
        resolvedRoute = 'home';
      }
    }

    const nextPath = getPathForRoute(resolvedRoute);
    const nextUrl = `${nextPath}${window.location.hash}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextUrl);
    }
    setActiveRoute(resolvedRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openAuth(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setAuthOpen(true);
    setAuthMessage('');
    setMessage('');
  }

  async function handleAdminLoadUsers() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      setAdminUsers([]);
      setAdminLoaded(true);
      return;
    }

    setAdminBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminUsers(adminUserQuery);
      setAdminUsers(response.items);
      setAdminTotalUsers(response.total);
      setAdminPage(response.page);
      setAdminPageSize(response.pageSize);
      setAdminPageCount(response.pageCount);
      setAdminLoaded(true);
      setAdminMessage(`已载入 ${response.total} 个用户。`);
      if (adminSelectedUserId) {
        const updatedSelectedUser = response.items.find((user) => user.id === adminSelectedUserId) ?? null;
        setAdminSelectedUser(updatedSelectedUser);
      }
    } catch (error) {
      setAdminUsers([]);
      setAdminLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '管理员连接失败。', locale));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminLoadProjects() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminProjectsBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminProjects();
      setAdminProjects(response.items);
      setAdminProjectsLoaded(true);
      setAdminMessage(`已载入 ${response.total} 个项目。`);
    } catch (error) {
      setAdminProjectsLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '项目列表读取失败。', locale));
    } finally {
      setAdminProjectsBusy(false);
    }
  }

  async function handleAdminLoadOrders() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminOrdersBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminOrders();
      setAdminOrders(response.items);
      setAdminOrdersLoaded(true);
      setAdminMessage(`已载入 ${response.total} 个订单。`);
    } catch (error) {
      setAdminOrdersLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '订单列表读取失败。', locale));
    } finally {
      setAdminOrdersBusy(false);
    }
  }

  async function handleAdminOpenRefund(order: PaymentOrderRecord) {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminRefundBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminOrderRefundPreview(order.id);
      setAdminRefundOrder(response.order);
      setAdminRefundPreview(response.preview);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '退款预览读取失败。', locale));
    } finally {
      setAdminRefundBusy(false);
    }
  }

  function closeAdminRefundDialog() {
    if (adminRefundBusy) {
      return;
    }
    setAdminRefundOrder(null);
    setAdminRefundPreview(null);
  }

  async function handleAdminConfirmRefund() {
    if (!adminRefundOrder || !adminRefundPreview) {
      return;
    }

    setAdminRefundBusy(true);
    setAdminMessage('');
    try {
      const response = await refundAdminOrder(adminRefundOrder.id);
      setAdminOrders((current) => current.map((order) => (order.id === response.order.id ? response.order : order)));
      if (response.billing && response.order.userKey === session?.userKey) {
        syncBilling(response.billing);
      }
      setAdminMessage(
        response.refundStatus === 'succeeded'
          ? `订单 #${response.order.id} 已通过 Stripe 退款，并已扣回 ${adminRefundPreview.refundablePoints} 积分。`
          : response.message ?? `订单 #${response.order.id} 退款状态：${response.refundStatus}`
      );
      setAdminRefundOrder(null);
      setAdminRefundPreview(null);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, 'Stripe 退款失败。', locale));
    } finally {
      setAdminRefundBusy(false);
    }
  }

  async function handleAdminLoadOpsHealth() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminOpsBusy(true);
    try {
      const response = await fetchAdminOpsHealth();
      setAdminOpsHealth(response);
      setAdminMessage(response.alerts.length ? `检测到 ${response.alerts.length} 个运维告警。` : '运维监控正常。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '运维监控读取失败。', locale));
    } finally {
      setAdminOpsBusy(false);
    }
  }

  async function handleAdminSelectUser(userId: string) {
    setAdminSelectedUserId(userId);
    setAdminDetailBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminUserDetail(userId);
      setAdminSelectedUser(response.user);
      setAdminDetailProjects(response.projects);
      setAdminSelectedProjectId(response.projects[0]?.id ?? null);
      setAdminDetailBillingEntries(response.billingEntries);
      setAdminAuditLogs(response.auditLogs);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '用户详情读取失败。', locale));
    } finally {
      setAdminDetailBusy(false);
    }
  }

  async function handleAdminSelectProject(projectId: string) {
    setAdminSelectedProjectId(projectId);
    setAdminDetailBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchProject(projectId);
      setAdminDetailProjects((current) => {
        const exists = current.some((project) => project.id === response.project.id);
        if (!exists) {
          return [response.project, ...current];
        }
        return current.map((project) => (project.id === response.project.id ? response.project : project));
      });
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '项目读取失败。', locale));
    } finally {
      setAdminDetailBusy(false);
    }
  }

  async function handleAdminRecoverSelectedProject() {
    if (!adminSelectedProject) {
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await recoverAdminProjectRunningHubResults(adminSelectedProject.id);
      if (response.project) {
        setAdminProjects((current) => current.map((project) => (project.id === response.project!.id ? response.project! : project)));
        setAdminDetailProjects((current) => {
          const exists = current.some((project) => project.id === response.project!.id);
          return exists
            ? current.map((project) => (project.id === response.project!.id ? response.project! : project))
            : [response.project!, ...current];
        });
      }
      setAdminMessage(
        response.summary.recovered > 0
          ? `已恢复 ${response.summary.recovered} 张 RunningHub 结果。`
          : response.summary.status === 'idle'
            ? '这个项目没有需要恢复的 RunningHub 结果。'
            : '暂时没有恢复到结果，后台会继续自动重试。'
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, 'RunningHub 结果恢复失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  function mergeAdminUser(nextUser: AdminUserSummary) {
    setAdminUsers((current) => current.map((user) => (user.id === nextUser.id ? nextUser : user)));
    setAdminSelectedUser((current) => (current?.id === nextUser.id ? nextUser : current));
  }

  async function handleAdminUpdateUser(userId: string, input: { role?: 'user' | 'admin'; accountStatus?: 'active' | 'disabled' }) {
    const targetUser = adminUsers.find((user) => user.id === userId) ?? adminSelectedUser;
    const actionLabel = input.role
      ? `把 ${targetUser?.email ?? '这个用户'} 的角色改成 ${input.role === 'admin' ? '管理员' : '普通用户'}`
      : input.accountStatus === 'disabled'
        ? `禁用 ${targetUser?.email ?? '这个用户'}`
        : `启用 ${targetUser?.email ?? '这个用户'}`;
    if (!window.confirm(`确认${actionLabel}？此操作会写入审计日志。`)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await updateAdminUser(userId, input);
      mergeAdminUser(response.user);
      await handleAdminSelectUser(userId);
      setAdminMessage('用户状态已更新。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '用户状态更新失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminAdjustBilling(userId: string) {
    const points = Number(adminAdjustment.points);
    if (!Number.isInteger(points) || points <= 0) {
      setAdminMessage('请输入大于 0 的整数积分。');
      return;
    }
    const targetUser = adminUsers.find((user) => user.id === userId) ?? adminSelectedUser;
    const actionLabel = adminAdjustment.type === 'credit' ? '补充' : '扣减';
    if (!window.confirm(`确认给 ${targetUser?.email ?? '这个用户'} ${actionLabel} ${points} 积分？此操作会写入审计日志。`)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await adjustAdminUserBilling(
        userId,
        {
          type: adminAdjustment.type,
          points,
          note: adminAdjustment.note.trim() || 'Manual adjustment'
        }
      );
      mergeAdminUser(response.user);
      setAdminDetailBillingEntries(response.billingEntries);
      setAdminAuditLogs(response.auditLogs);
      setAdminMessage(adminAdjustment.type === 'credit' ? '积分已补充。' : '积分已扣减。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '积分调整失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminLogoutUser(userId: string) {
    const targetUser = adminUsers.find((user) => user.id === userId) ?? adminSelectedUser;
    if (!window.confirm(`确认踢下线 ${targetUser?.email ?? '这个用户'} 的所有 session？`)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await logoutAdminUserSessions(userId);
      mergeAdminUser(response.user);
      setAdminAuditLogs(response.auditLogs);
      setAdminMessage(`已踢下线 ${response.removedSessions} 个 session。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '踢下线失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminDeleteUser(userId: string) {
    const targetUser = adminUsers.find((user) => user.id === userId) ?? adminSelectedUser;
    const confirmationText = targetUser?.email ?? 'DELETE';
    const typed = window.prompt(
      `确认删除用户 ${confirmationText}？\n\n此操作会删除该用户账号、项目、照片记录、会话、积分流水和订单记录，并写入审计日志。\n如需继续，请输入该用户邮箱。`
    );
    if (typed !== confirmationText) {
      setAdminMessage('已取消删除用户。');
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await deleteAdminUser(userId);
      setAdminUsers((current) => current.filter((user) => user.id !== response.deletedUserId));
      setAdminTotalUsers((current) => Math.max(0, current - 1));
      if (adminSelectedUser?.id === response.deletedUserId) {
        setAdminSelectedUser(null);
        setAdminSelectedUserId('');
        setAdminDetailProjects([]);
        setAdminDetailBillingEntries([]);
      }
      setAdminMessage(
        response.archiveErrors.length
          ? `用户已删除，但有 ${response.archiveErrors.length} 个项目文件未能归档，请检查服务器日志。`
          : '用户已删除。'
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '删除用户失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminLoadAuditLogs() {
    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminAuditLogs();
      setAdminAuditLogs(response.items);
      setAdminMessage(`已载入 ${response.items.length} 条审计日志。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '审计日志读取失败。', locale));
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminLoadActivationCodes() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminActivationBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminActivationCodes();
      setAdminActivationCodes(response.items);
      setAdminActivationPackages(response.packages);
      setBillingPackages(response.packages);
      setAdminActivationLoaded(true);
      setAdminMessage(`已载入 ${response.items.length} 个优惠码。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '优惠码读取失败。', locale));
    } finally {
      setAdminActivationBusy(false);
    }
  }

  async function handleAdminLoadSystemSettings() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminSystemBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminSettings();
      syncAdminSystemSettings(response.settings);
      setAdminWorkflowSummary((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                workflowMaxInFlight: response.settings.runningHubMaxInFlight
              }
            }
          : current
      );
      setAdminMessage('系统设置已刷新。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '系统设置读取失败。', locale));
    } finally {
      setAdminSystemBusy(false);
    }
  }

  async function handleAdminLoadWorkflows() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminWorkflowBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminWorkflows();
      setAdminWorkflowSummary(response.workflows);
      syncAdminSystemSettings(response.settings);
      setAdminWorkflowLoaded(true);
      setAdminMessage('工作流配置已刷新。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '工作流配置读取失败。', locale));
    } finally {
      setAdminWorkflowBusy(false);
    }
  }

  function updateAdminFeatureDraft(
    featureId: string,
    patch: Partial<StudioFeatureConfig> | ((current: StudioFeatureConfig) => Partial<StudioFeatureConfig>)
  ) {
    setAdminFeatureDrafts((current) =>
      current.map((feature) => {
        if (feature.id !== featureId) {
          return feature;
        }
        const resolvedPatch = typeof patch === 'function' ? patch(feature) : patch;
        return { ...feature, ...resolvedPatch };
      })
    );
  }

  function handleAddAdminFeatureCard() {
    const sequence = adminFeatureDrafts.length + 1;
    const id = `custom-${Date.now().toString(36)}`;
    const draft: StudioFeatureConfig = {
      id,
      enabled: false,
      category: 'interior',
      status: 'beta',
      titleZh: `新功能 ${sequence}`,
      titleEn: `New Feature ${sequence}`,
      descriptionZh: '填写这个功能的前台短描述。',
      descriptionEn: 'Describe what this workflow does.',
      detailZh: '填写点开卡片后的流程说明。',
      detailEn: 'Add the detailed workflow description.',
      tagZh: '自定义',
      tagEn: 'Custom',
      beforeImageUrl: '',
      afterImageUrl: '',
      workflowId: '',
      inputNodeId: '',
      outputNodeId: '',
      pointsPerPhoto: 1,
      tone: 'warm'
    };
    setAdminFeatureDrafts((current) => [...current, draft]);
    setAdminExpandedFeatureIds((current) => ({ ...current, [id]: true }));
    setAdminMessage('已添加新功能卡片，配置工作流、节点、图片和积分后保存。');
  }

  async function handleAdminFeatureImageUpload(featureId: string, field: StudioFeatureImageField, file: File) {
    const hasImageExtension = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!file.type.startsWith('image/') && !hasImageExtension) {
      setAdminMessage('请上传 JPG、PNG 或 WebP 图片。');
      return;
    }

    const busyKey = `${featureId}:${field}`;
    setAdminFeatureImageBusy(busyKey);
    setAdminMessage('');
    try {
      const response = await uploadAdminStudioFeatureImage(file);
      updateAdminFeatureDraft(featureId, { [field]: response.url } as Partial<Pick<StudioFeatureConfig, StudioFeatureImageField>>);
      setAdminMessage('对比图已上传，保存卡片配置后前台生效。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '对比图上传失败。', locale));
    } finally {
      setAdminFeatureImageBusy(null);
    }
  }

  function getAdminFeatureWorkflowDisplay(feature: StudioFeatureConfig) {
    const items = adminWorkflowSummary?.items ?? [];
    const configuredWorkflowId = feature.workflowId.trim();
    const matched = configuredWorkflowId ? items.find((item) => item.workflowId === configuredWorkflowId) ?? null : null;
    const activeName = adminWorkflowSummary?.active?.trim().toLowerCase();
    const active = activeName ? items.find((item) => item.name.trim().toLowerCase() === activeName) ?? null : null;
    const defaultWorkflow = items.find((item) => item.workflowId) ?? null;
    const shouldUseDefaultWorkflow = feature.id === 'hdr-true-color' || feature.id === 'hdr-white-wall';
    const fallback = matched ?? (shouldUseDefaultWorkflow ? active ?? defaultWorkflow : null);

    return {
      workflowId: configuredWorkflowId || fallback?.workflowId || '',
      inputNodeId: feature.inputNodeId.trim() || fallback?.inputNodeIds?.join(', ') || '',
      outputNodeId: feature.outputNodeId.trim() || fallback?.outputNodeIds?.join(', ') || ''
    };
  }

  async function handleAdminSaveSystemSettings() {
    const runpodHdrBatchSize = Number(adminSystemDraft.runpodHdrBatchSize);
    const runningHubMaxInFlight = Number(adminSystemDraft.runningHubMaxInFlight);
    if (
      !Number.isFinite(runpodHdrBatchSize) ||
      runpodHdrBatchSize < MIN_RUNPOD_HDR_BATCH_SIZE ||
      runpodHdrBatchSize > MAX_RUNPOD_HDR_BATCH_SIZE
    ) {
      setAdminMessage(`云处理批量数量必须是 ${MIN_RUNPOD_HDR_BATCH_SIZE} 到 ${MAX_RUNPOD_HDR_BATCH_SIZE}。`);
      return;
    }
    if (
      !Number.isFinite(runningHubMaxInFlight) ||
      runningHubMaxInFlight < MIN_RUNNINGHUB_MAX_IN_FLIGHT ||
      runningHubMaxInFlight > MAX_RUNNINGHUB_MAX_IN_FLIGHT
    ) {
      setAdminMessage(`RunningHub 并发数量必须是 ${MIN_RUNNINGHUB_MAX_IN_FLIGHT} 到 ${MAX_RUNNINGHUB_MAX_IN_FLIGHT}。`);
      return;
    }

    setAdminSystemBusy(true);
    setAdminMessage('');
    try {
      const response = await updateAdminSettings({
        runpodHdrBatchSize: Math.round(runpodHdrBatchSize),
        runningHubMaxInFlight: Math.round(runningHubMaxInFlight),
        billingPackages: adminSystemSettings?.billingPackages ?? adminActivationPackages,
        studioFeatures: adminFeatureDrafts.length ? adminFeatureDrafts : adminSystemSettings?.studioFeatures ?? []
      });
      syncAdminSystemSettings(response.settings);
      const cards = response.settings.studioFeatures.map(studioFeatureConfigToDefinition).filter((feature) => feature.status !== 'locked');
      if (cards.length) {
        setStudioFeatureCards(cards);
      }
      setAdminSystemLoaded(true);
      setAdminWorkflowSummary((current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                workflowMaxInFlight: response.settings.runningHubMaxInFlight
              }
            }
          : current
      );
      setAdminMessage(
        `已更新：Runpod 每批 ${response.settings.runpodHdrBatchSize} 组 HDR，RunningHub 并发 ${response.settings.runningHubMaxInFlight} 张。`
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '系统设置保存失败。', locale));
    } finally {
      setAdminSystemBusy(false);
    }
  }

  function parseOptionalAdminNumber(value: string) {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  function getAdminPlanPackages() {
    if (adminSystemSettings?.billingPackages?.length) {
      return adminSystemSettings.billingPackages;
    }
    if (adminActivationPackages.length) {
      return adminActivationPackages;
    }
    return billingPackages;
  }

  function handleAdminOpenNewPlanPackage() {
    const nextSequence = getAdminPlanPackages().length + 1;
    setAdminPlanDraft(createAdminPlanDraft(undefined, nextSequence));
    setAdminPlanEditorOpen(true);
    setAdminConsolePage('plans');
  }

  function handleAdminEditPlanPackage(plan: BillingPackage) {
    setAdminPlanDraft(createAdminPlanDraft(plan));
    setAdminPlanEditorOpen(true);
    setAdminConsolePage('plans');
  }

  async function handleAdminSavePlanPackage() {
    const nextPackage = buildAdminPlanPackageFromDraft(adminPlanDraft);
    if (!nextPackage) {
      setAdminMessage('请填写有效的套餐金额和积分。');
      return;
    }

    setAdminSystemBusy(true);
    setAdminMessage('');
    try {
      let baseSettings = adminSystemSettings;
      if (!baseSettings) {
        const response = await fetchAdminSettings();
        baseSettings = response.settings;
      }

      const currentPackages = baseSettings.billingPackages?.length ? baseSettings.billingPackages : getAdminPlanPackages();
      const nextPackages = [nextPackage, ...currentPackages.filter((item) => item.id !== nextPackage.id)];
      const response = await updateAdminSettings({
        runpodHdrBatchSize: baseSettings.runpodHdrBatchSize,
        runningHubMaxInFlight: baseSettings.runningHubMaxInFlight,
        billingPackages: nextPackages,
        studioFeatures: baseSettings.studioFeatures
      });

      syncAdminSystemSettings(response.settings);
      setAdminPlanEditorOpen(false);
      setAdminActivationLoaded(false);
      setAdminMessage(`套餐已保存：${nextPackage.name}。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '套餐保存失败。', locale));
    } finally {
      setAdminSystemBusy(false);
    }
  }

  function handleAdminOpenBatchActivationCodes() {
    const defaultPackageId = adminActivationPackages[0]?.id ?? getAdminPlanPackages()[0]?.id ?? '';
    setAdminBatchCodeDraft(createAdminBatchCodeDraft(defaultPackageId));
    setAdminBatchCodeOpen(true);
    setAdminConsolePage('codes');
  }

  async function handleAdminCreateBatchActivationCodes() {
    const count = parseOptionalAdminNumber(adminBatchCodeDraft.count) ?? 0;
    if (count < 1 || count > ADMIN_MAX_BATCH_CODES) {
      setAdminMessage(`批量生成数量必须是 1 到 ${ADMIN_MAX_BATCH_CODES}。`);
      return;
    }

    const label = adminBatchCodeDraft.label.trim() || '批量兑换码';
    if (!window.confirm(`确认生成 ${count} 个兑换码？`)) {
      return;
    }

    setAdminActivationBusy(true);
    setAdminMessage('');
    try {
      const reserved = new Set(adminActivationCodes.map((item) => item.code));
      const created: AdminActivationCode[] = [];
      for (let index = 0; index < count; index += 1) {
        const response = await createAdminActivationCode({
          code: buildUniqueAdminActivationCode(adminBatchCodeDraft.prefix, reserved),
          label: count === 1 ? label : `${label} ${String(index + 1).padStart(2, '0')}`,
          active: adminBatchCodeDraft.active,
          packageId: adminBatchCodeDraft.packageId || null,
          discountPercentOverride: parseOptionalAdminNumber(adminBatchCodeDraft.discountPercentOverride),
          bonusPoints: parseOptionalAdminNumber(adminBatchCodeDraft.bonusPoints) ?? 0,
          maxRedemptions: parseOptionalAdminNumber(adminBatchCodeDraft.maxRedemptions),
          expiresAt: adminBatchCodeDraft.expiresAt.trim() || null
        });
        created.push(response.item);
      }

      setAdminActivationCodes((current) => [
        ...created,
        ...current.filter((item) => !created.some((createdItem) => createdItem.id === item.id))
      ]);
      setAdminBatchCodeOpen(false);
      setAdminActivationLoaded(true);
      setAdminMessage(`已生成 ${created.length} 个兑换码。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '批量兑换码生成失败。', locale));
    } finally {
      setAdminActivationBusy(false);
    }
  }

  async function handleAdminCreateActivationCode() {
    const reserved = new Set(adminActivationCodes.map((item) => item.code));
    const code = adminActivationDraft.code.trim().toUpperCase() || buildUniqueAdminActivationCode('CODE', reserved);
    const label = adminActivationDraft.label.trim() || '后台新建兑换码';
    if (!code || !label) {
      setAdminMessage('请填写优惠码和显示名称。');
      return;
    }
    if (!window.confirm(`确认创建优惠码 ${code}？用户输入后会影响充值积分。`)) {
      return;
    }

    setAdminActivationBusy(true);
    setAdminMessage('');
    try {
      const response = await createAdminActivationCode({
        code,
        label,
        active: adminActivationDraft.active,
        packageId: adminActivationDraft.packageId || null,
        discountPercentOverride: parseOptionalAdminNumber(adminActivationDraft.discountPercentOverride),
        bonusPoints: parseOptionalAdminNumber(adminActivationDraft.bonusPoints) ?? 0,
        maxRedemptions: parseOptionalAdminNumber(adminActivationDraft.maxRedemptions),
        expiresAt: adminActivationDraft.expiresAt.trim() || null
      });
      setAdminActivationCodes((current) => [response.item, ...current.filter((item) => item.id !== response.item.id)]);
      setAdminActivationDraft({
        code: '',
        label: '',
        packageId: '',
        discountPercentOverride: '',
        bonusPoints: '0',
        maxRedemptions: '',
        expiresAt: '',
        active: true
      });
      setAdminActivationLoaded(true);
      setAdminSingleCodeOpen(false);
      setAdminMessage('优惠码已创建。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '优惠码创建失败。', locale));
    } finally {
      setAdminActivationBusy(false);
    }
  }

  async function handleAdminToggleActivationCode(item: AdminActivationCode) {
    const nextActive = !item.active;
    if (!window.confirm(`确认${nextActive ? '启用' : '停用'}优惠码 ${item.code}？`)) {
      return;
    }

    setAdminActivationBusy(true);
    setAdminMessage('');
    try {
      const response = await updateAdminActivationCode(item.id, { active: nextActive });
      setAdminActivationCodes((current) => current.map((entry) => (entry.id === response.item.id ? response.item : entry)));
      setAdminMessage(nextActive ? '优惠码已启用。' : '优惠码已停用。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '优惠码更新失败。', locale));
    } finally {
      setAdminActivationBusy(false);
    }
  }

  async function handleAdminDeleteActivationCode(item: AdminActivationCode) {
    if (item.redemptionCount > 0) {
      setAdminMessage(`\u5151\u6362\u7801 ${item.code} \u5DF2\u88AB\u5151\u6362 ${item.redemptionCount} \u6B21\uFF0C\u65E0\u6CD5\u5220\u9664\uFF0C\u8BF7\u505C\u7528\u3002`);
      return;
    }
    if (!window.confirm(`\u786E\u8BA4\u6C38\u4E45\u5220\u9664\u5151\u6362\u7801 ${item.code}\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) {
      return;
    }
    setAdminActivationBusy(true);
    setAdminMessage('');
    try {
      await deleteAdminActivationCode(item.id);
      setAdminActivationCodes((current) => current.filter((entry) => entry.id !== item.id));
      setAdminMessage(`\u5151\u6362\u7801 ${item.code} \u5DF2\u5220\u9664\u3002`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '\u5151\u6362\u7801\u5220\u9664\u5931\u8D25\u3002', locale));
    } finally {
      setAdminActivationBusy(false);
    }
  }

  function downloadCSV(filename: string, header: string, rows: string[]) {
    const BOM = '\uFEFF';
    const content = BOM + [header, ...rows].join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportAdminUsersCSV() {
    const header = ['ID', 'Email', '姓名', '角色', '状态', '积分余额', '累计充值USD', '照片数', '注册时间'].join(',');
    const rows = adminUsers.map((u) =>
      [u.id, u.email, u.displayName ?? '', u.role, u.accountStatus,
        u.billingSummary.availablePoints, u.billingSummary.totalTopUpUsd.toFixed(2),
        u.photoCount, u.createdAt
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    downloadCSV(`metrovan-users-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  function exportAdminOrdersCSV() {
    const header = ['订单ID', 'Email', '套餐', '金额USD', '积分', '状态', '优惠码', '创建时间', '支付时间'].join(',');
    const rows = adminOrders.map((o) =>
      [o.id, o.email, o.packageName, o.amountUsd.toFixed(2), o.points, o.status,
        o.activationCode ?? '', o.createdAt, o.paidAt ?? ''
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    downloadCSV(`metrovan-orders-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
  }

  function closeDownloadDialog(force = false) {
    if (downloadBusy && !force) {
      return;
    }
    setDownloadDialogProjectId(null);
    setDownloadDraft(DEFAULT_DOWNLOAD_DRAFT);
  }

  function parseDownloadNumber(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  }

  function buildDownloadPayload() {
    const variants: Array<{
      key: 'hd' | 'custom';
      label: string;
      longEdge?: number | null;
      width?: number | null;
      height?: number | null;
    }> = [];

    if (downloadDraft.includeHd) {
      variants.push({ key: 'hd', label: 'HD' });
    }

    if (downloadDraft.includeCustom) {
      const longEdge = parseDownloadNumber(downloadDraft.customLongEdge);
      const width = parseDownloadNumber(downloadDraft.customWidth);
      const height = parseDownloadNumber(downloadDraft.customHeight);
      if (!longEdge && !width && !height) {
        throw new Error(copy.downloadCustomRequired);
      }
      variants.push({
        key: 'custom',
        label: downloadDraft.customLabel.trim() || 'Custom',
        longEdge,
        width,
        height
      });
    }

    if (!variants.length) {
      throw new Error(copy.downloadVariantRequired);
    }

    return {
      folderMode: downloadDraft.folderMode,
      namingMode: downloadDraft.namingMode,
      customPrefix: downloadDraft.customPrefix.trim(),
      variants
    };
  }

  async function handleConfirmDownload() {
    if (!downloadProject) {
      setMessage(copy.noDownloadProject);
      return;
    }

    setDownloadBusy(true);
    try {
      const payload = buildDownloadPayload();
      const { downloadUrl, fileName, revoke } = await downloadProjectArchive(downloadProject.id, payload);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(revoke, 30_000);
      closeDownloadDialog(true);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setMessage(locale === 'en' ? error.message : '项目结果不完整，缺少结果图。请重新生成缺失项后再下载。');
      } else {
        setMessage(getUserFacingErrorMessage(error, copy.downloadFailed, locale));
      }
    } finally {
      setDownloadBusy(false);
    }
  }

  function handleDownloadProject(project: ProjectRecord) {
    if (!project.downloadReady || isDemoMode) {
      return;
    }
    setDownloadDialogProjectId(project.id);
    setDownloadDraft(DEFAULT_DOWNLOAD_DRAFT);
  }

  function closeAuth() {
    if (authMode === 'reset-confirm' || authMode === 'verify-email') {
      clearAuthTokenQuery();
    }
    setAuthOpen(false);
    setAuth({ email: '', name: '', password: '', confirmPassword: '' });
    setAuthMessage('');
  }

  function handleGoogleAuth() {
    if (googleAuthEnabled === false) {
      setAuthMessage(copy.googleConfiguredMissing);
      setMessage('');
      setAuthOpen(true);
      setAuthMode('signin');
      return;
    }
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.assign(`${getApiRoot()}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function handleForgotPassword() {
    setAuthMode('reset-request');
    setAuth((current) => ({
      ...current,
      password: '',
      confirmPassword: ''
    }));
    setAuthMessage('');
    setMessage('');
  }

  async function submitAuth() {
    const email = auth.email.trim();

    if (authMode === 'reset-request') {
      if (!email) {
        setAuthMessage(copy.authMissingEmail);
        setMessage('');
        return;
      }

      setAuthBusy(true);
      setAuthMessage('');
      try {
        await requestPasswordReset({ email });
        setAuthMessage(copy.authResetEmailSent);
        setMessage('');
      } catch (error) {
        setAuthMessage(getAuthErrorMessage(error, authMode, locale));
        setMessage('');
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    if (authMode === 'reset-confirm') {
      const resetToken = getPasswordResetTokenFromQuery();
      if (!resetToken) {
        setAuthMessage(copy.authResetTokenMissing);
        setMessage('');
        return;
      }
      if (!isStrongPasswordInput(auth.password)) {
        setAuthMessage(copy.authPasswordTooShort);
        setMessage('');
        return;
      }
      if (auth.password !== auth.confirmPassword) {
        setAuthMessage(copy.authPasswordMismatch);
        setMessage('');
        return;
      }

      setAuthBusy(true);
      setAuthMessage('');
      try {
        await confirmPasswordReset({
          token: resetToken,
          password: auth.password
        });
        clearAuthTokenQuery();
        setAuthMode('signin');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: ''
        }));
        setAuthMessage(copy.authResetPasswordSuccess);
        setMessage('');
      } catch (error) {
        setAuthMessage(getAuthErrorMessage(error, authMode, locale));
        setMessage('');
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    if (!email || !auth.password.trim()) {
      const nextMessage = copy.authMissingFields;
      setAuthMessage(nextMessage);
      setMessage('');
      return;
    }
    if (authMode === 'signup' && auth.password !== auth.confirmPassword) {
      const nextMessage = copy.authPasswordMismatch;
      setAuthMessage(nextMessage);
      setMessage('');
      return;
    }
    if (authMode === 'signup' && !isStrongPasswordInput(auth.password)) {
      setAuthMessage(copy.authPasswordTooShort);
      setMessage('');
      return;
    }

    setAuthBusy(true);
    setAuthMessage('');
    try {
      if (authMode === 'signin') {
        const response = await loginWithEmail({
          email,
          password: auth.password
        });
        setSession(response.session.user);
        setLocale(response.session.user.locale);
        closeAuth();
        navigateToRoute('studio');
        setMessage(copy.signInSuccess);
        return;
      }

      const response = await registerWithEmail({
        email,
        displayName: auth.name.trim() || undefined,
        password: auth.password
      });
      if (response.verificationRequired) {
        setAuthMode('signin');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: ''
        }));
        setAuthMessage(copy.authVerificationEmailSent);
        setMessage('');
        return;
      }

      if (response.session) {
        setSession(response.session.user);
        setLocale(response.session.user.locale);
        closeAuth();
        navigateToRoute('studio');
        setMessage(copy.signUpSuccess);
      }
    } catch (error) {
      const nextMessage = getAuthErrorMessage(error, authMode, locale);
      setAuthMessage(nextMessage);
      setMessage('');
      if (authMode === 'signup' && nextMessage === copy.authEmailExists) {
        setAuthMode('signin');
        setAuth((current) => ({
          ...current,
          password: '',
          confirmPassword: ''
        }));
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!isDemoMode) {
      try {
        await logoutSession();
      } catch {
        // ignore logout errors and clear local state anyway
      }
    }
    setSession(null);
    setCurrentProjectId(null);
    setProjects([]);
    setBillingSummary(isDemoMode ? DEMO_BILLING_SUMMARY : null);
    setBillingEntries(isDemoMode ? DEMO_BILLING_ENTRIES : []);
    setBillingOrders([]);
    setBillingPackages(isDemoMode ? DEMO_BILLING_PACKAGES : []);
    setRecentStripeOrder(null);
    setBillingOpen(false);
    setBillingModalMode('billing');
    setRechargeOpen(false);
    setCustomRechargeAmount('');
    setRechargeActivationCode('');
    setRechargeMessage('');
    setSettingsOpen(false);
    setUserMenuOpen(false);
    setHistoryMenuOpen(false);
    setMessage('');
    setAuthMessage('');
    setSettingsMessage('');
    setLocalImportDrafts((current) => {
      Object.values(current).forEach((draft) => revokeLocalImportDraftUrls(draft));
      return {};
    });
    navigateToRoute('home');
  }

  function returnToStudioFeatureCards() {
    navigateToRoute('studio');
    setCurrentProjectId(null);
    setMessage('');
  }

  async function handleOpenBilling(mode: 'topup' | 'billing' = 'billing') {
    setUserMenuOpen(false);
    setHistoryMenuOpen(false);
    if (mode === 'topup') {
      setBillingOpen(false);
      openRecharge();
      if (isDemoMode || !session) {
        return;
      }
      try {
        await refreshBilling();
      } catch (error) {
        setMessage(getUserFacingErrorMessage(error, copy.loadBillingFailed, locale));
      }
      return;
    }
    setBillingModalMode(mode);
    setBillingOpen(true);
    if (isDemoMode || !session) {
      return;
    }

    try {
      await refreshBilling();
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.loadBillingFailed, locale));
    }
  }

  function closeStudioGuide() {
    setStudioGuideOpen(false);
  }

  function dismissStudioGuide() {
    if (session) {
      markStudioGuideDismissed(session);
    }
    setStudioGuideOpen(false);
  }

  function openRecharge() {
    setHistoryMenuOpen(false);
    setCustomRechargeAmount('');
    setRechargeActivationCode('');
    setRechargeMessage('');
    setRechargeOpen(true);
  }

  async function handleTopUp() {
    if (isDemoMode) {
      setMessage(copy.topUpDemo);
      return;
    }

    const customAmountUsd = customRechargeAmount.trim() ? parseCustomRechargeAmount(customRechargeAmount) : null;
    if (customRechargeAmount.trim() && customAmountUsd === null) {
      setRechargeMessage(copy.rechargeCustomInvalid);
      return;
    }

    if (!customAmountUsd && !selectedBillingPackage) {
      setRechargeMessage(copy.topUpFailed);
      return;
    }

    setBillingBusy(true);
    setRechargeMessage('');
    try {
      const response = await createCheckoutSession(
        customAmountUsd
          ? { customAmountUsd, activationCode: rechargeActivationCode }
          : { packageId: selectedBillingPackage!.id, activationCode: rechargeActivationCode }
      );
      setMessage(copy.topUpRedirecting);
      window.location.assign(response.checkoutUrl);
    } catch (error) {
      setRechargeMessage(getUserFacingErrorMessage(error, copy.topUpFailed, locale));
      setBillingBusy(false);
    }
  }

  async function handleRedeemActivationCode() {
    if (isDemoMode) {
      setMessage(copy.topUpDemo);
      return;
    }

    const activationCode = rechargeActivationCode.trim();
    if (!activationCode) {
      setRechargeMessage(copy.redeemActivationFailed);
      return;
    }

    setBillingBusy(true);
    setRechargeMessage('');
    try {
      const response = await redeemActivationCode({ activationCode });
      syncBilling(response.billing);
      setRechargeActivationCode('');
      setRechargeMessage(copy.redeemActivationSuccess);
      setMessage(copy.redeemActivationSuccess);
    } catch (error) {
      setRechargeMessage(getUserFacingErrorMessage(error, copy.redeemActivationFailed, locale));
    } finally {
      setBillingBusy(false);
    }
  }

  function openSettings() {
    if (!session) {
      return;
    }
    setUserMenuOpen(false);
    setSettingsDraft({
      displayName: session.displayName,
      locale: session.locale
    });
    setSettingsMessage('');
    setSettingsOpen(true);
  }

  function openFeatureProjectDialog(feature: StudioFeatureDefinition) {
    if (feature.status === 'locked') {
      return;
    }

    setSelectedFeatureId(feature.id);
    setNewProjectName('');
    setNewProjectAddress('');
    setCreateDialogFiles([]);
    setCreateDialogDragActive(false);
    setCreateDialogOpen(true);
    setMessage('');
  }

  function closeCreateProjectDialog() {
    setCreateDialogOpen(false);
    setCreateDialogFiles([]);
    setCreateDialogDragActive(false);
  }

  function handleCreateDialogFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;

    const { supported, unsupported } = filterSupportedImportFiles(Array.from(files));
    if (!supported.length) {
      setMessage(copy.uploadNoSupportedFiles);
      return;
    }

    setCreateDialogFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const additions = supported.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...additions];
    });
    setCreateDialogDragActive(false);
    setMessage(unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '');
  }

  async function handleSaveSettings() {
    if (!session) {
      return;
    }

    const displayName = settingsDraft.displayName.trim();
    if (!displayName) {
      setSettingsMessage(copy.settingsDisplayNameRequired);
      return;
    }

    setSettingsBusy(true);
    setSettingsMessage('');
    try {
      const response = await updateAccountSettings({
        displayName,
        locale: settingsDraft.locale
      });
      setSession(response.session.user);
      setLocale(response.session.user.locale);
      setSettingsOpen(false);
      setMessage(UI_TEXT[response.session.user.locale].settingsSaved);
    } catch (error) {
      const nextMessage = getUserFacingErrorMessage(error, copy.settingsSaveFailed, locale);
      setSettingsMessage(nextMessage);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleCreateProject() {
    if (!session || !newProjectName.trim()) {
      setMessage(copy.createProjectNameRequired);
      return;
    }

    setBusy(true);
    try {
      const response = await createProject({
        name: newProjectName.trim(),
        address: newProjectAddress.trim(),
        studioFeatureId: selectedFeature.id
      });
      upsertProject(response.project);
      setCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectAddress('');
      setCreateDialogFiles([]);
      setCreateDialogDragActive(false);
      setMessage('');
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.createProjectFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameProject(project: ProjectRecord) {
    const nextName = window.prompt(copy.renamePrompt, project.name)?.trim();
    if (!nextName || nextName === project.name) return;

    setBusy(true);
    try {
      const response = await patchProject(project.id, { name: nextName });
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.renameFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject(project: ProjectRecord) {
    const confirmed = window.confirm(copy.deleteProjectConfirm(project.name));
    if (!confirmed) return;

    setBusy(true);
    try {
      await deleteProject(project.id);
      clearLocalImportDraft(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setCurrentProjectId((current) => {
        if (current !== project.id) return current;
        return null;
      });
      setMessage('');
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.deleteProjectFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadForProject(targetProject: ProjectRecord, files: FileList | File[] | null) {
    if (!files || files.length === 0) return;

    const { supported, unsupported } = filterSupportedImportFiles(Array.from(files));
    if (!supported.length) {
      setMessage(copy.uploadNoSupportedFiles);
      return;
    }

    const existingDraft = localImportDrafts[targetProject.id] ?? null;
    setBusy(true);
    setUploadActive(true);
    setUploadMode('local');
    setUploadPercent(0);
    setUploadSnapshot(null);
    setDragActive(false);
    try {
      const { buildLocalImportDraft } = await loadLocalImportModule();
      const nextDraft = await buildLocalImportDraft(targetProject.id, supported, setUploadPercent);
      const response = await patchProject(targetProject.id, { currentStep: 2, status: 'review' });
      upsertProject(response.project);
      if (existingDraft) {
        const merged = mergeLocalImportDrafts(existingDraft, nextDraft);
        updateLocalImportDraft(targetProject.id, () => merged.draft);
        merged.unusedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        const notices = [
          unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
          merged.duplicateCount ? copy.uploadDuplicateFiles(merged.duplicateCount) : ''
        ].filter(Boolean);
        setMessage(notices.join(' '));
      } else {
        upsertLocalImportDraft(nextDraft);
        setMessage(unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '');
      }
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      setMessage(getUserFacingErrorMessage(error, copy.uploadFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(files: FileList | File[] | null) {
    if (!currentProject) return;
    await handleUploadForProject(currentProject, files);
  }

  function resolveUploadPauseWaiters() {
    const resolvers = uploadPauseResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }

  function resetUploadPause() {
    uploadPausedRef.current = false;
    setUploadPaused(false);
    resolveUploadPauseWaiters();
  }

  function handlePauseUpload() {
    if (!uploadActive) return;
    uploadPausedRef.current = true;
    setUploadPaused(true);
    setUploadSnapshot((snapshot) => (snapshot ? { ...snapshot, stage: 'paused', offline: false } : snapshot));
    if (currentProject) {
      updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'paused' }));
    }
  }

  function handleResumeUpload() {
    if (!uploadPausedRef.current) return;
    uploadPausedRef.current = false;
    setUploadPaused(false);
    resolveUploadPauseWaiters();
    setUploadSnapshot((snapshot) => (snapshot?.stage === 'paused' ? { ...snapshot, stage: 'uploading', offline: false } : snapshot));
    if (currentProject) {
      updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'uploading' }));
    }
  }

  function handleCancelUpload() {
    uploadAbortControllerRef.current?.abort();
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleCreateGroup() {
    if (!currentProject) return;
    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => ({
        ...draft,
        groups: [
          ...draft.groups,
          {
            id: crypto.randomUUID?.().replace(/-/g, '').slice(0, 8) ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            index: draft.groups.length + 1,
            name: locale === 'en' ? `Group ${draft.groups.length + 1}` : `第${draft.groups.length + 1}组`,
            sceneType: 'pending',
            colorMode: 'default',
            replacementColor: null,
            hdrItemIds: []
          }
        ]
      }));
      return;
    }

    setBusy(true);
    try {
      const response = await createGroup(currentProject.id);
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.createGroupFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleStepClick(step: 1 | 2 | 3 | 4) {
    if (!currentProject || currentProject.status === 'completed') return;
    if (step > getMaxNavigableStep(currentProject)) return;

    try {
      const response = await patchProject(currentProject.id, { currentStep: step });
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.updateStepFailed, locale));
    }
  }

  async function handleSceneChange(group: ProjectGroup, sceneType: SceneType) {
    if (!currentProject) return;
    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => ({
        ...draft,
        groups: draft.groups.map((entry) => (entry.id === group.id ? { ...entry, sceneType } : entry)),
        hdrItems: draft.hdrItems.map((item) => (item.groupId === group.id ? { ...item, sceneType } : item))
      }));
      return;
    }

    try {
      const response = await updateGroup(currentProject.id, group.id, { sceneType });
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.updateSceneFailed, locale));
    }
  }

  async function handleColorModeChange(group: ProjectGroup, colorMode: ColorMode) {
    if (!currentProject) return;
    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => ({
        ...draft,
        groups: draft.groups.map((entry) =>
          entry.id === group.id
            ? {
                ...entry,
                colorMode,
                replacementColor: colorMode === 'replace' ? normalizeHex(getGroupColorDraft(group)) : null
              }
            : entry
        )
      }));
      return;
    }

    try {
      const response = await updateGroup(currentProject.id, group.id, {
        colorMode,
        replacementColor: colorMode === 'replace' ? normalizeHex(getGroupColorDraft(group)) : null
      });
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.updateColorModeFailed, locale));
    }
  }

  async function handleApplyGroupColor(group: ProjectGroup) {
    if (!currentProject) return;
    const normalized = normalizeHex(getGroupColorDraft(group) ?? '');
    if (!normalized) {
      setMessage(copy.replacementColorInvalid);
      return;
    }

    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => ({
        ...draft,
        groups: draft.groups.map((entry) =>
          entry.id === group.id
            ? {
                ...entry,
                colorMode: 'replace',
                replacementColor: normalized
              }
            : entry
        )
      }));
      return;
    }

    try {
      const response = await updateGroup(currentProject.id, group.id, {
        colorMode: 'replace',
        replacementColor: normalized
      });
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.replacementColorFailed, locale));
    }
  }

  async function handleMoveHdrItem(hdrItem: HdrItem, targetGroupId: string) {
    if (!currentProject || targetGroupId === hdrItem.groupId) return;
    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => {
        const targetGroup = draft.groups.find((group) => group.id === targetGroupId);
        if (!targetGroup) {
          return draft;
        }

        return {
          ...draft,
          groups: draft.groups.map((group) => ({
            ...group,
            hdrItemIds:
              group.id === targetGroupId
                ? [...group.hdrItemIds.filter((id) => id !== hdrItem.id), hdrItem.id]
                : group.hdrItemIds.filter((id) => id !== hdrItem.id)
          })),
          hdrItems: draft.hdrItems.map((item) =>
            item.id === hdrItem.id ? { ...item, groupId: targetGroupId, sceneType: targetGroup.sceneType } : item
          )
        };
      });
      return;
    }

    try {
      const response = await moveHdrItem(currentProject.id, hdrItem.id, targetGroupId);
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.moveGroupFailed, locale));
    }
  }

  function handleMergeLocalHdrItem(sourceHdrItemId: string, targetHdrItemId: string) {
    if (!currentProject || !activeLocalDraft || sourceHdrItemId === targetHdrItemId) return;

    updateLocalImportDraft(currentProject.id, (draft) => {
      const sourceItem = draft.hdrItems.find((item) => item.id === sourceHdrItemId);
      const targetItem = draft.hdrItems.find((item) => item.id === targetHdrItemId);
      if (!sourceItem || !targetItem) {
        return draft;
      }

      const groupId = getDraftGroupId(draft);
      const mergedExposures = sortExposuresForHdr([...targetItem.exposures, ...sourceItem.exposures]);
      const selectedExposure =
        mergedExposures.find((exposure) => exposure.id === targetItem.selectedExposureId) ??
        mergedExposures.find((exposure) => exposure.id === sourceItem.selectedExposureId) ??
        mergedExposures[0] ??
        null;
      const nextHdrItems = draft.hdrItems
        .filter((item) => item.id !== sourceHdrItemId)
        .map((item) =>
          item.id === targetHdrItemId
            ? {
                ...item,
                exposures: mergedExposures,
                selectedExposureId: selectedExposure?.id ?? item.selectedExposureId,
                previewUrl: selectedExposure?.previewUrl ?? item.previewUrl,
                localReviewState: getHdrItemReviewStateFromExposures(mergedExposures)
              }
            : item
        );

      return syncLocalHdrGroups(draft, nextHdrItems, groupId);
    });
  }

  function handleSplitLocalHdrItem(hdrItemId: string) {
    if (!currentProject || !activeLocalDraft) return;

    updateLocalImportDraft(currentProject.id, (draft) => {
      const sourceIndex = draft.hdrItems.findIndex((item) => item.id === hdrItemId);
      const sourceItem = draft.hdrItems[sourceIndex];
      if (!sourceItem || sourceItem.exposures.length <= 1) {
        return draft;
      }

      const groupId = getDraftGroupId(draft);
      const splitItems = sourceItem.exposures.map((exposure) => createHdrItemFromExposure(exposure, groupId));
      const nextHdrItems = [...draft.hdrItems];
      nextHdrItems.splice(sourceIndex, 1, ...splitItems);
      return syncLocalHdrGroups(draft, nextHdrItems, groupId);
    });
  }

  async function handleDeleteHdr(hdrItem: HdrItem) {
    if (!currentProject) return;
    const confirmed = window.confirm(copy.deleteHdrConfirm(hdrItem.title));
    if (!confirmed) return;

    if (activeLocalDraft) {
      const deletedPreviewUrls = hdrItem.exposures
        .map((exposure) => exposure.previewUrl)
        .filter((value): value is string => Boolean(value));
      updateLocalImportDraft(currentProject.id, (draft) => {
        const nextHdrItems = draft.hdrItems.filter((item) => item.id !== hdrItem.id);
        const nextGroups = draft.groups.map((group) => ({
          ...group,
          hdrItemIds: group.hdrItemIds.filter((id) => id !== hdrItem.id)
        }));
        deletedPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        if (!nextHdrItems.length) {
          return {
            ...draft,
            hdrItems: [],
            groups: nextGroups
          };
        }
        return {
          ...draft,
          hdrItems: nextHdrItems,
          groups: nextGroups
        };
      });

      const remainingDraft = localImportDrafts[currentProject.id];
      if (remainingDraft && remainingDraft.hdrItems.length <= 1) {
        clearLocalImportDraft(currentProject.id);
        try {
          const response = await patchProject(currentProject.id, { currentStep: 1, status: 'draft' });
          upsertProject(response.project);
        } catch {
          // ignore local-only reset failure
        }
      }
      return;
    }

    try {
      const response = await deleteHdrItem(currentProject.id, hdrItem.id);
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.deleteHdrFailed, locale));
    }
  }

  async function handleShiftExposure(hdrItem: HdrItem, direction: -1 | 1) {
    if (!currentProject) return;
    const currentIndex = hdrItem.exposures.findIndex((exposure) => exposure.id === hdrItem.selectedExposureId);
    const nextExposure = hdrItem.exposures[currentIndex + direction];
    if (!nextExposure) return;

    if (activeLocalDraft) {
      updateLocalImportDraft(currentProject.id, (draft) => ({
        ...draft,
        hdrItems: draft.hdrItems.map((item) =>
          item.id === hdrItem.id
            ? {
                ...item,
                selectedExposureId: nextExposure.id,
                previewUrl: nextExposure.previewUrl ?? item.previewUrl
              }
            : item
        )
      }));
      return;
    }

    try {
      const response = await selectExposure(currentProject.id, hdrItem.id, nextExposure.id);
      upsertProject(response.project);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.shiftExposureFailed, locale));
    }
  }

  function handleHdrExposureSwipeStart(hdrItem: HdrItem, event: ReactPointerEvent<HTMLElement>) {
    if (hdrItem.exposures.length <= 1) return;
    hdrExposureSwipeRef.current = {
      hdrItemId: hdrItem.id,
      startX: event.clientX,
      startY: event.clientY
    };
  }

  function handleHdrExposureSwipeEnd(hdrItem: HdrItem, event: ReactPointerEvent<HTMLElement>) {
    const swipe = hdrExposureSwipeRef.current;
    hdrExposureSwipeRef.current = null;
    if (!swipe || swipe.hdrItemId !== hdrItem.id || hdrItem.exposures.length <= 1) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    void handleShiftExposure(hdrItem, deltaX < 0 ? 1 : -1);
  }

  async function handleStartProcessing(options: { retryFailed?: boolean; retryUploadFileIdentity?: string } = {}) {
    if (!currentProject) return;
    if (!workspaceHdrItems.length) {
      setMessage(copy.importPhotosFirst);
      return;
    }

    setBusy(true);
    try {
      if (activeLocalDraft) {
        const projectId = currentProject.id;
        const retryUploadFileIdentity = options.retryUploadFileIdentity;
        resetUploadPause();
        let failedUploadBuffer = retryUploadFileIdentity
          ? failedUploadFiles.filter((file) => file.fileIdentity !== retryUploadFileIdentity)
          : [];
        if (!retryUploadFileIdentity) {
          setFailedUploadFiles([]);
        }
        const draftFiles = collectLocalDraftFiles(activeLocalDraft);
        const uploadHdrItems = retryUploadFileIdentity
          ? activeLocalDraft.hdrItems.filter((item) =>
              collectLocalHdrItemFiles(item).some((file) => getLocalFileUploadIdentity(file) === retryUploadFileIdentity)
            )
          : activeLocalDraft.hdrItems;
        if (retryUploadFileIdentity && !uploadHdrItems.length) {
          setFailedUploadFiles(failedUploadBuffer);
          setMessage(locale === 'en' ? 'That file is no longer in this project.' : '这个文件已不在当前项目里。');
          return;
        }
        const uploadTotalFiles = Math.max(1, draftFiles.length);
        let uploadedObjects = [...(activeLocalDraft.uploadedObjects ?? [])];
        const completedFileIdentities = new Set(
          uploadedObjects.map((uploaded) => getUploadReferenceIdentity(uploaded))
        );
        const inFlightGroupProgress = new Map<string, number>();
        const updateAggregateUploadProgress = (
          stage: UploadProgressSnapshot['stage'] = 'uploading',
          details: Pick<Partial<UploadProgressSnapshot>, 'currentFileName' | 'attempt' | 'maxAttempts' | 'offline'> = {}
        ) => {
          const inFlightFiles = Array.from(inFlightGroupProgress.values()).reduce((sum, value) => sum + value, 0);
          const uploadedFiles = Math.min(uploadTotalFiles, completedFileIdentities.size + inFlightFiles);
          const percent =
            stage === 'completed'
              ? 100
              : Math.max(1, Math.min(96, Math.round((uploadedFiles / uploadTotalFiles) * 96)));
          setUploadPercent(percent);
          setUploadSnapshot({
            stage,
            percent,
            uploadedFiles,
            totalFiles: uploadTotalFiles,
            ...details
          });
        };
        const uploadAbortController = new AbortController();
        uploadAbortControllerRef.current = uploadAbortController;
        const rememberUploadedObject = (uploaded: UploadedObjectReference) => {
          uploadedObjects = mergeUploadedObjectReferences(uploadedObjects, [uploaded]);
          completedFileIdentities.add(getUploadReferenceIdentity(uploaded));
          updateLocalImportDraft(projectId, (draft) => ({
            ...draft,
            uploadStatus: 'uploading',
            uploadedObjects: mergeUploadedObjectReferences(draft.uploadedObjects, [uploaded])
          }));
          updateAggregateUploadProgress('uploading');
        };
        const rememberGroupFailedUploadFile = (hdrItemId: string) => (failed: FailedUploadFile) => {
          const entry: FailedUploadEntry = { ...failed, hdrItemId };
          failedUploadBuffer = [...failedUploadBuffer.filter((item) => item.fileIdentity !== failed.fileIdentity), entry].slice(-8);
          setFailedUploadFiles(failedUploadBuffer);
        };
        setUploadActive(true);
        setUploadMode('originals');
        setUploadPercent(1);
        setUploadSnapshot({
          stage: 'preparing',
          percent: 1,
          uploadedFiles: 0,
          totalFiles: draftFiles.length
        });
        setMessage(copy.uploadOriginalsDoNotClose);

        const uploadStep = await patchProject(projectId, { currentStep: 3, status: 'uploading' }).catch(() => null);
        if (uploadStep?.project) {
          upsertProject(uploadStep.project);
        }

        updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'uploading' }));

        const initialLayoutResponse = await applyHdrLayout(projectId, buildHdrLayoutPayload(activeLocalDraft, uploadedObjects), {
          mode: 'replace',
          inputComplete: false
        });
        upsertProject(initialLayoutResponse.project);

        let nextHdrItemIndex = 0;
        const uploadGroupWorker = async () => {
          while (nextHdrItemIndex < uploadHdrItems.length) {
            if (uploadAbortController.signal.aborted) {
              throw new DOMException('Upload cancelled.', 'AbortError');
            }
            const hdrItemIndex = nextHdrItemIndex;
            nextHdrItemIndex += 1;
            const hdrItem = uploadHdrItems[hdrItemIndex];
            if (!hdrItem) {
              continue;
            }

            const allGroupFiles = collectLocalHdrItemFiles(hdrItem);
            const groupFiles = retryUploadFileIdentity
              ? allGroupFiles.filter((file) => getLocalFileUploadIdentity(file) === retryUploadFileIdentity)
              : allGroupFiles;
            if (!groupFiles.length) {
              continue;
            }

            const existingUploadsForRun = getUploadedObjectsForFiles(uploadedObjects, groupFiles);
            if (existingUploadsForRun.length < groupFiles.length) {
              try {
                const uploadResponse = await uploadFiles(projectId, groupFiles, (_percent, snapshot) => {
                  const uploadedInGroup = Math.min(
                    groupFiles.length,
                    snapshot?.uploadedFiles ?? Math.round(((_percent || 0) / 100) * groupFiles.length)
                  );
                  inFlightGroupProgress.set(hdrItem.id, uploadedInGroup);
                  const stage =
                    snapshot?.stage === 'paused' || snapshot?.stage === 'retrying' || snapshot?.stage === 'verifying'
                      ? snapshot.stage
                      : 'uploading';
                  updateAggregateUploadProgress(stage, {
                    currentFileName: snapshot?.currentFileName,
                    attempt: snapshot?.attempt,
                    maxAttempts: snapshot?.maxAttempts,
                    offline: snapshot?.offline
                  });
                }, {
                  signal: uploadAbortController.signal,
                  completedObjects: existingUploadsForRun,
                  onFileUploaded: rememberUploadedObject,
                  onFileFailed: rememberGroupFailedUploadFile(hdrItem.id),
                  pauseController: uploadPauseControllerRef.current,
                  continueOnFileError: true
                });
                uploadedObjects = mergeUploadedObjectReferences(
                  uploadedObjects,
                  'directUploadFiles' in uploadResponse ? uploadResponse.directUploadFiles : getUploadedObjectsForFiles(uploadedObjects, groupFiles)
                );
              } catch (error) {
                inFlightGroupProgress.delete(hdrItem.id);
                if (error instanceof DOMException && error.name === 'AbortError') {
                  throw error;
                }
                updateAggregateUploadProgress('uploading');
                continue;
              } finally {
                inFlightGroupProgress.delete(hdrItem.id);
              }
            }
            if (retryUploadFileIdentity) {
              failedUploadBuffer = failedUploadBuffer.filter((file) => file.fileIdentity !== retryUploadFileIdentity);
              setFailedUploadFiles(failedUploadBuffer);
            }
            const groupUploads = getUploadedObjectsForFiles(uploadedObjects, allGroupFiles);
            if (groupUploads.length < allGroupFiles.length) {
              continue;
            }
            for (const file of allGroupFiles) {
              completedFileIdentities.add(getUploadReferenceIdentity({ originalName: file.name, size: file.size }));
            }
            updateAggregateUploadProgress('uploading');

            const layoutResponse = await applyHdrLayout(
              projectId,
              buildSingleHdrLayoutPayload(
                activeLocalDraft,
                hdrItem,
                groupUploads
              ),
              { mode: 'merge', inputComplete: false }
            );
            upsertProject(layoutResponse.project);
          }
        };

        const groupUploadWorkerCount = Math.max(
          1,
          Math.min(LOCAL_HDR_GROUP_UPLOAD_CONCURRENCY, uploadHdrItems.length)
        );
        await Promise.all(Array.from({ length: groupUploadWorkerCount }, () => uploadGroupWorker()));

        if (failedUploadBuffer.length) {
          updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'paused', uploadedObjects }));
          const reviewStep = await patchProject(projectId, { currentStep: 2, status: 'review' }).catch(() => null);
          if (reviewStep?.project) {
            upsertProject(reviewStep.project);
          }
          setUploadActive(false);
          setUploadMode(null);
          setUploadSnapshot(null);
          setMessage(
            locale === 'en'
              ? `${failedUploadBuffer.length} file${failedUploadBuffer.length === 1 ? '' : 's'} need retry before processing.`
              : `${failedUploadBuffer.length} 个文件需要重试后才能开始处理。`
          );
          return;
        }

        const completedLayoutResponse = await applyHdrLayout(projectId, [], { mode: 'merge', inputComplete: true });
        const syncedProject = completedLayoutResponse.project;
        setUploadPercent(100);
        setUploadSnapshot({
          stage: 'completed',
          percent: 100,
          uploadedFiles: draftFiles.length,
          totalFiles: draftFiles.length
        });
        setMessage(copy.uploadOriginalsReceived);
        upsertProject(syncedProject);
        updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'completed', uploadedObjects }));
        const processingResponse = await startProcessing(projectId);
        upsertProject(processingResponse.project);
        setUploadActive(false);
        setUploadMode(null);
        setUploadPercent(100);
        setUploadSnapshot(null);
        setMessage(copy.uploadOriginalsCanClose);
      } else {
        const response = options.retryFailed
          ? await retryFailedProcessing(currentProject.id)
          : await startProcessing(currentProject.id);
        upsertProject(response.project);
        setMessage('');
      }
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (currentProject) {
          updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'paused' }));
          void patchProject(currentProject.id, { currentStep: 2, status: 'review' })
            .then((response) => upsertProject(response.project))
            .catch(() => {
              // The local draft still keeps uploaded R2 references; retry can continue after refresh.
            });
        }
        setMessage(locale === 'en' ? 'Upload cancelled. Uploaded files were saved and can be resumed.' : '上传已取消，已上传的文件会保留记录，可继续上传。');
        return;
      }
      if (isDirectUploadIntegrityError(error) && currentProject) {
        updateLocalImportDraft(currentProject.id, (draft) => ({
          ...draft,
          uploadStatus: 'paused',
          uploadedObjects: []
        }));
      }
      if (isInsufficientCreditsError(error)) {
        setBillingModalMode('topup');
        setBillingOpen(false);
        openRecharge();
      }
      setMessage(getUserFacingErrorMessage(error, copy.startProcessingFailed, locale));
    } finally {
      uploadAbortControllerRef.current = null;
      resetUploadPause();
      setBusy(false);
    }
  }

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

  async function handleRegenerateResult(asset: ResultAsset) {
    if (!currentProject || isDemoMode) return;
    const regeneration = asset.regeneration;
    if (regeneration?.status === 'running' || resultRegenerateBusy[asset.hdrItemId]) {
      return;
    }

    const colorCardNo = normalizeHex(getResultColorCard(asset));
    if (!colorCardNo) {
      setMessage(copy.regenerateColorInvalid);
      return;
    }
    setResultRegenerateBusy((current) => ({ ...current, [asset.hdrItemId]: true }));
    try {
      const response = await regenerateResult(currentProject.id, asset.hdrItemId, { colorCardNo });
      upsertProject(response.project);
      setMessage(copy.regenerateResultStarted);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.regenerateResultFailed, locale));
    } finally {
      setResultRegenerateBusy((current) => {
        const next = { ...current };
        delete next[asset.hdrItemId];
        return next;
      });
    }
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

  function previewResultReorder(sourceHdrItemId: string, targetHdrItemId: string) {
    if (!currentProject || sourceHdrItemId === targetHdrItemId) return;

    const baseOrder =
      resultDragPreview?.projectId === currentProject.id
        ? resultDragPreview.orderedHdrItemIds
        : currentProject.resultAssets.map((asset) => asset.hdrItemId);
    const sourceIndex = baseOrder.indexOf(sourceHdrItemId);
    const targetIndex = baseOrder.indexOf(targetHdrItemId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextOrder = [...baseOrder];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    if (nextOrder.join('|') === baseOrder.join('|')) return;

    captureResultCardLayout();
    setResultDragPreview({ projectId: currentProject.id, orderedHdrItemIds: nextOrder });
  }

  async function handleReorderResults(sourceHdrItemId: string, targetHdrItemId: string) {
    if (!currentProject || sourceHdrItemId === targetHdrItemId) return;

    const orderedHdrItemIds = currentProject.resultAssets.map((asset) => asset.hdrItemId);
    const previewOrder =
      resultDragPreview?.projectId === currentProject.id &&
      resultDragPreview.orderedHdrItemIds.length === orderedHdrItemIds.length
        ? resultDragPreview.orderedHdrItemIds
        : null;
    let nextOrder = previewOrder;
    if (!nextOrder) {
      const sourceIndex = orderedHdrItemIds.indexOf(sourceHdrItemId);
      const targetIndex = orderedHdrItemIds.indexOf(targetHdrItemId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      nextOrder = [...orderedHdrItemIds];
      const [moved] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, moved);
      captureResultCardLayout();
    }

    setProjects((current) =>
      current.map((project) => {
        if (project.id !== currentProject.id) {
          return project;
        }
        const assetsByHdrItemId = new Map(project.resultAssets.map((asset) => [asset.hdrItemId, asset]));
        const reorderedAssets = nextOrder
          .map((hdrItemId, index) => {
            const asset = assetsByHdrItemId.get(hdrItemId);
            return asset ? { ...asset, sortOrder: index } : null;
          })
          .filter((asset): asset is ResultAsset => Boolean(asset));
        return {
          ...project,
          resultAssets: reorderedAssets
        };
      })
    );

    try {
      const response = await reorderResults(currentProject.id, nextOrder);
      upsertProject(response.project);
      setMessage('');
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.reorderResultsFailed, locale));
      const refreshed = await fetchProject(currentProject.id).catch(() => null);
      if (refreshed) {
        upsertProject(refreshed.project);
      }
    } finally {
      setDraggedResultHdrItemId(null);
      setDragOverResultHdrItemId(null);
      setResultDragPreview(null);
    }
  }

  function formatAdminDate(value: string | null) {
    if (!value) {
      return '—';
    }
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function formatAdminShortDate(value: string | null) {
    if (!value) {
      return '—';
    }
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function formatPaymentOrderStatus(status: PaymentOrderRecord['status']) {
    switch (status) {
      case 'paid':
        return '已支付';
      case 'checkout_created':
        return '待支付';
      case 'pending':
        return '待创建';
      case 'failed':
        return '失败';
      case 'expired':
        return '已过期';
      case 'cancelled':
        return '已取消';
      case 'refunded':
        return '已退款';
      default:
        return status;
    }
  }

  function getAdminInitials(value: string) {
    const normalized = value.trim();
    if (!normalized) {
      return 'MV';
    }
    return normalized
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function getStripeDocumentLinks(order: PaymentOrderRecord | null | undefined) {
    if (!order) {
      return [];
    }

    return [
      { key: 'invoice-pdf', label: copy.stripeInvoicePdfLink, url: order.stripeInvoicePdfUrl },
      { key: 'invoice', label: copy.stripeInvoiceLink, url: order.stripeInvoiceUrl },
      { key: 'receipt', label: copy.stripeReceiptLink, url: order.stripeReceiptUrl }
    ].filter((link): link is { key: string; label: string; url: string } => Boolean(link.url));
  }

  function renderStripeDocumentLinks(order: PaymentOrderRecord | null | undefined, compact = false) {
    const links = getStripeDocumentLinks(order);
    if (!links.length) {
      return <span className="stripe-doc-pending">{copy.stripeDocumentsPending}</span>;
    }

    return (
      <div className={compact ? 'stripe-document-actions compact' : 'stripe-document-actions'}>
        {links.map((link) => (
          <a key={link.key} className="ghost-button small stripe-doc-link" href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ))}
      </div>
    );
  }

  function renderAuthDialog() {
    if (!authOpen || session) {
      return null;
    }

    return (
      <AuthModal
        copy={copy}
        authMode={authMode}
        authBusy={authBusy}
        auth={auth}
        authTitle={authTitle}
        authSubtitle={authSubtitle}
        authMessage={authMessage}
        authSubmitLabel={authSubmitLabel}
        googleAuthEnabled={googleAuthEnabled}
        isAuthLinkMode={isAuthLinkMode}
        isEmailVerifyMode={isEmailVerifyMode}
        onClose={closeAuth}
        onGoogleAuth={handleGoogleAuth}
        onSelectMode={(mode) => {
          setAuthMode(mode);
          setAuthMessage('');
        }}
        onAuthChange={(patch) => setAuth((current) => ({ ...current, ...patch }))}
        onForgotPassword={handleForgotPassword}
        onToggleMode={() => {
          if (authMode === 'reset-confirm' || authMode === 'verify-email') {
            clearAuthTokenQuery();
          }
          setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
          setAuthMessage('');
        }}
        onSubmit={submitAuth}
      />
    );
  }

  if (activeRoute === 'admin' && !hasAdminSession) {
    const adminAccessMessage = !sessionReady
      ? '正在验证管理员权限...'
      : session
        ? '当前账号没有管理员权限。'
        : '请先用管理员账号登录后台。';

    return (
      <>
        <LandingPage
          activeRoute="home"
          copy={copy}
          hasSession={Boolean(session)}
          message={adminAccessMessage}
          onNavigate={navigateToRoute}
          onOpenAuth={openAuth}
        />

        {renderAuthDialog()}
      </>
    );
  }

  if (activeRoute === 'admin') {
    const paidOrders = adminOrders.filter((order) => order.status === 'paid');
    const pendingProjectCount = adminProjects.filter((project) =>
      ['importing', 'uploading', 'processing', 'failed'].includes(project.status)
    ).length;
    const planPackages = adminSystemSettings?.billingPackages?.length
      ? adminSystemSettings.billingPackages
      : adminActivationPackages.length
        ? adminActivationPackages
        : billingPackages;
    const totalProjectPhotos = adminProjects.reduce((sum, project) => sum + project.photoCount, 0) || adminTotals.photos;
    const totalProjectResults = adminProjects.reduce((sum, project) => sum + project.resultAssets.length, 0);
    const workflowItems = adminWorkflowSummary?.items ?? [];
    const enabledWorkflowCount = workflowItems.length;
    const paidOrderRevenue = paidOrders.reduce((sum, order) => sum + order.amountUsd, 0);
    const resolvedAdminPageCount = Math.max(1, adminPageCount);
    const availableCodeCount = adminActivationCodes.filter((item) => item.available).length;
    const usedCodeCount = adminActivationCodes.reduce((sum, item) => sum + item.redemptionCount, 0);
    const codeCapacity = adminActivationCodes.reduce((sum, item) => sum + (item.maxRedemptions ?? 0), 0);
    const codeUsageRate = codeCapacity ? Math.round((usedCodeCount / codeCapacity) * 1000) / 10 : 0;
    const dashboardActivities = [
      ...adminOrders.slice(0, 3).map((order) => ({
        id: `order-${order.id}`,
        tone: order.status === 'paid' ? 'default' : order.status === 'failed' ? 'danger' : 'warn',
        title: `${order.email} · ${formatPaymentOrderStatus(order.status)}`,
        meta: `${order.packageName} · $${order.amountUsd.toFixed(2)} · ${formatAdminShortDate(order.createdAt)}`
      })),
      ...adminProjects.slice(0, 4).map((project) => ({
        id: `project-${project.id}`,
        tone: project.status === 'failed' ? 'danger' : project.status === 'processing' ? 'warn' : 'default',
        title: `${project.name} · ${getProjectStatusLabel(project, locale)}`,
        meta: `${project.photoCount} 张 · ${project.resultAssets.length} 结果 · ${formatAdminShortDate(project.updatedAt)}`
      })),
      ...adminAuditLogs.slice(0, 3).map((entry) => ({
        id: `audit-${entry.id}`,
        tone: 'default',
        title: entry.action,
        meta: `${entry.actorEmail ?? entry.actorType} · ${formatAdminShortDate(entry.createdAt)}`
      }))
    ].slice(0, 6);

    const adminPageTitle = (title: string, subtitle: ReactNode, actions?: ReactNode) => (
      <div className="page-title-row">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">{subtitle}</div>
        </div>
        {actions ? <div className="admin-page-actions">{actions}</div> : null}
      </div>
    );
    const kpi = (label: string, value: ReactNode, trend?: ReactNode, tone: 'up' | 'down' = 'up') => (
      <div className="kpi">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        {trend ? <div className={`kpi-trend ${tone}`}>{trend}</div> : null}
      </div>
    );
    const tagClassForStatus = (status: string) => {
      if (['paid', 'active', 'completed', 'ready', 'published'].includes(status)) {
        return 'tag tag-green';
      }
      if (['failed', 'disabled', 'cancelled'].includes(status)) {
        return 'tag tag-red';
      }
      if (status === 'refunded') {
        return 'tag tag-purple';
      }
      if (['processing', 'uploading', 'checkout_created', 'pending'].includes(status)) {
        return 'tag tag-orange';
      }
      return 'tag tag-gray';
    };
    const planToneClass = (index: number) => ['tag-gray', 'tag-cyan', 'tag-purple', 'tag-orange'][index % 4];
    const projectToneClass = (index: number) => `work-thumb work-thumb-${(index % 8) + 1}`;
    const userAvatarStyle = (index: number): CSSProperties => {
      const gradients = [
        'linear-gradient(135deg,#c69aff,#7ce8ff)',
        'linear-gradient(135deg,#7ce8ff,#5ce3a5)',
        'linear-gradient(135deg,#ffc36b,#ff7a8a)',
        'linear-gradient(135deg,#5ce3a5,#7ce8ff)',
        'linear-gradient(135deg,#ff7a8a,#c69aff)'
      ];
      return { background: gradients[index % gradients.length] };
    };
    const adminNavIcon = (page: AdminConsolePage) => {
      const paths: Record<AdminConsolePage, ReactNode> = {
        dashboard: (
          <>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </>
        ),
        users: (
          <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
          </>
        ),
        works: (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-5-5L5 21" />
          </>
        ),
        orders: (
          <>
            <path d="M3 7h18l-2 12H5z" />
            <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          </>
        ),
        plans: (
          <>
            <path d="M12 2 4 7v10l8 5 8-5V7z" />
            <path d="M12 12 4 7" />
            <path d="m12 12 8-5" />
            <path d="M12 12v10" />
          </>
        ),
        codes: (
          <>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <path d="M14 3h7v7" />
            <path d="M3 21l11-11" />
          </>
        ),
        engine: (
          <>
            <rect x="7" y="7" width="10" height="10" rx="2" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
          </>
        ),
        prompts: <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />,
        content: (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
          </>
        ),
        logs: (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="13" y2="17" />
          </>
        ),
        settings: (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </>
        )
      };

      return (
        <svg className="admin-console-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {paths[page]}
        </svg>
      );
    };
    const targetNavButton = (page: AdminConsolePage, label: string, badge?: string) => (
      <button
        key={page}
        className={`nav-item${adminConsolePage === page ? ' active' : ''}`}
        type="button"
        onClick={() => setAdminConsolePage(page)}
      >
        {adminNavIcon(page)}
        <span>{label}</span>
        {badge ? <span className="badge">{badge}</span> : null}
      </button>
    );
    const renderAdminOrdersTable = (orders: PaymentOrderRecord[], compact = false) => (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>用户</th>
              <th>套餐</th>
              <th>金额</th>
              <th>渠道</th>
              <th>状态</th>
              <th>{compact ? '时间' : '支付时间'}</th>
              {!compact ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {orders.map((order, index) => (
              <tr key={order.id}>
                <td className="cell-id">#{order.id}</td>
                <td>
                  <div className="user-cell">
                    <div className="user-avatar" style={userAvatarStyle(index)}>
                      {getAdminInitials(order.email)}
                    </div>
                    <div>
                      <div className="name">{order.email.split('@')[0]}</div>
                      <div className="email">{order.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`tag ${planToneClass(index)}`}>{order.packageName}</span>
                </td>
                <td className="mono">${order.amountUsd.toFixed(2)}</td>
                <td>{order.stripeCheckoutSessionId ? 'Stripe' : 'Manual'}</td>
                <td>
                  <span className={tagClassForStatus(order.status)}>{formatPaymentOrderStatus(order.status)}</span>
                </td>
                <td className="cell-id">{compact ? formatAdminShortDate(order.createdAt) : formatAdminDate(order.paidAt ?? order.createdAt)}</td>
                {!compact ? (
                  <td>
                    {order.status === 'paid' && order.stripePaymentIntentId ? (
                      <button
                        className="btn btn-ghost btn-xs"
                        type="button"
                        onClick={() => void handleAdminOpenRefund(order)}
                        disabled={adminRefundBusy}
                      >
                        退款
                      </button>
                    ) : (
                      <div className="tbl-icon">⋯</div>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    const renderDashboardPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '仪表盘',
          <>
            今天 · 2026 年 4 月 28 日 · <span className="status-dot live" /> 系统运行中
          </>,
          <>
            <button className="btn btn-ghost" type="button" onClick={exportAdminOrdersCSV} disabled={!adminOrders.length}>
              导出订单 CSV
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void Promise.all([handleAdminLoadUsers(), handleAdminLoadOrders(), handleAdminLoadProjects(), handleAdminLoadOpsHealth()])}>
              刷新全部数据
            </button>
          </>
        )}
        <div className="kpi-grid">
          {kpi('注册用户', <>{adminTotals.users.toLocaleString()}<span className="unit">人</span></>, <><span>▲ 实时</span><span className="vs">后台用户</span></>)}
          {kpi('已支付营收', <>${paidOrderRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</>, <><span>▲ {paidOrders.length}</span><span className="vs">笔订单</span></>)}
          {kpi('AI 修图调用', <>{totalProjectPhotos.toLocaleString()}<span className="unit">次</span></>, <><span>▲ {totalProjectResults}</span><span className="vs">结果图</span></>)}
          {kpi('待处理作品', <>{pendingProjectCount}<span className="unit">项</span></>, <><span>▲ 队列</span><span className="vs">实时</span></>, pendingProjectCount ? 'down' : 'up')}
          {kpi('运维告警', <>{adminOpsHealth?.alerts.length ?? 0}<span className="unit">项</span></>, <><span>{adminOpsBusy ? '读取中' : '监控'}</span><span className="vs">回传/积分/R2</span></>, adminOpsHealth?.alerts.length ? 'down' : 'up')}
        </div>
        <div className="dashboard-grid">
          <div className="card">
            <div className="card-header">
              <div>
                <h3>营收 & 调用趋势</h3>
                <div className="card-sub">最近 30 天</div>
              </div>
              <div className="chart-tabs">
                <span className="chart-tab">7 天</span>
                <span className="chart-tab active">30 天</span>
                <span className="chart-tab">90 天</span>
              </div>
            </div>
            <div className="card-body">
              <div className="chart-area" aria-hidden="true">
                <svg className="chart-svg" viewBox="0 0 600 240" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="adminGradRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7ce8ff" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#7ce8ff" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="adminGradCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c69aff" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#c69aff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="60" x2="600" y2="60" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
                  <line x1="0" y1="120" x2="600" y2="120" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
                  <line x1="0" y1="180" x2="600" y2="180" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
                  <path d="M 0 180 L 30 165 L 60 170 L 90 145 L 120 135 L 150 150 L 180 110 L 210 95 L 240 105 L 270 80 L 300 85 L 330 65 L 360 75 L 390 50 L 420 60 L 450 45 L 480 55 L 510 40 L 540 35 L 570 50 L 600 30 L 600 240 L 0 240 Z" fill="url(#adminGradRevenue)" />
                  <path d="M 0 180 L 30 165 L 60 170 L 90 145 L 120 135 L 150 150 L 180 110 L 210 95 L 240 105 L 270 80 L 300 85 L 330 65 L 360 75 L 390 50 L 420 60 L 450 45 L 480 55 L 510 40 L 540 35 L 570 50 L 600 30" fill="none" stroke="#7ce8ff" strokeWidth="2" />
                  <path d="M 0 200 L 30 195 L 60 190 L 90 175 L 120 180 L 150 170 L 180 155 L 210 145 L 240 150 L 270 130 L 300 135 L 330 115 L 360 125 L 390 100 L 420 110 L 450 95 L 480 105 L 510 90 L 540 85 L 570 100 L 600 80 L 600 240 L 0 240 Z" fill="url(#adminGradCalls)" opacity="0.6" />
                  <path d="M 0 200 L 30 195 L 60 190 L 90 175 L 120 180 L 150 170 L 180 155 L 210 145 L 240 150 L 270 130 L 300 135 L 330 115 L 360 125 L 390 100 L 420 110 L 450 95 L 480 105 L 510 90 L 540 85 L 570 100 L 600 80" fill="none" stroke="#c69aff" strokeWidth="2" />
                  <circle cx="540" cy="35" r="5" fill="#7ce8ff" />
                  <circle cx="540" cy="35" r="10" fill="#7ce8ff" opacity="0.2" />
                </svg>
              </div>
              <div className="chart-legend">
                <span><i />营收 ($)</span>
                <span><i className="purple" />AI 调用次数</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3>实时动态</h3>
              <span className="live-label"><span className="status-dot live" />LIVE</span>
            </div>
            <div className="card-body activity-list">
              {dashboardActivities.length ? (
                dashboardActivities.map((item) => (
                  <div key={item.id} className="activity-item">
                    <div className={`activity-dot ${item.tone}`} />
                    <div className="activity-content">
                      <div className="activity-title">{item.title}</div>
                      <div className="activity-time">{item.meta}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-tip">{adminOrdersBusy || adminProjectsBusy ? '正在读取实时动态...' : '暂无动态'}</div>
              )}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h3>近期订单</h3>
            <button className="btn btn-ghost" type="button" onClick={() => setAdminConsolePage('orders')}>
              查看全部 →
            </button>
          </div>
          {adminOrders.length ? renderAdminOrdersTable(adminOrders.slice(0, 5), true) : <div className="empty-tip">暂无订单数据</div>}
        </div>
      </div>
    );

    const renderUsersPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '用户管理',
          <>共 <span className="mono accent-text">{(adminTotalUsers || adminUsers.length).toLocaleString()}</span> 位注册用户 · 当前页 <span className="mono success-text">{adminUsers.length}</span> 位</>,
          <>
            <button className="btn btn-ghost" type="button" onClick={exportAdminUsersCSV} disabled={!adminUsers.length}>导出 CSV</button>
            <button className="btn btn-primary" type="button" onClick={() => void handleAdminLoadUsers()} disabled={adminBusy}>
              {adminBusy ? '刷新中...' : '刷新用户'}
            </button>
          </>
        )}
        <div className="card">
          <div className="toolbar">
            <input
              value={adminSearch}
              onChange={(event) => {
                setAdminSearch(event.target.value);
                setAdminPage(1);
                setAdminLoaded(false);
              }}
              placeholder="搜索 邮箱 / 手机 / ID"
            />
            <select
              value={adminRoleFilter}
              onChange={(event) => {
                setAdminRoleFilter(event.target.value as AdminUserListQuery['role']);
                setAdminPage(1);
                setAdminLoaded(false);
              }}
            >
              <option value="all">全部套餐</option>
              <option value="admin">管理员</option>
              <option value="user">用户</option>
            </select>
            <select
              value={adminStatusFilter}
              onChange={(event) => {
                setAdminStatusFilter(event.target.value as AdminUserListQuery['accountStatus']);
                setAdminPage(1);
                setAdminLoaded(false);
              }}
            >
              <option value="all">所有状态</option>
              <option value="active">正常</option>
              <option value="disabled">已封禁</option>
            </select>
            <select
              value={adminVerifiedFilter}
              onChange={(event) => {
                setAdminVerifiedFilter(event.target.value as AdminUserListQuery['emailVerified']);
                setAdminPage(1);
                setAdminLoaded(false);
              }}
            >
              <option value="all">邮箱验证：全部</option>
              <option value="yes">已验证</option>
              <option value="no">未验证</option>
            </select>
          </div>
          {adminUsers.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>套餐</th>
                      <th>积分余额</th>
                      <th>累计消费</th>
                      <th>修图次数</th>
                      <th>注册时间</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((user, index) => (
                      <tr key={user.id}>
                        <td>
                          <div className="user-cell">
                            <div className="user-avatar" style={userAvatarStyle(index)}>{getAdminInitials(user.displayName || user.email)}</div>
                            <div>
                              <div className="name">{user.displayName}</div>
                              <div className="email">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className={`tag ${user.role === 'admin' ? 'tag-purple' : 'tag-gray'}`}>{user.role === 'admin' ? 'Admin' : 'User'}</span></td>
                        <td className="mono">{user.billingSummary.availablePoints.toLocaleString()}</td>
                        <td className="mono">${user.billingSummary.totalTopUpUsd.toFixed(0)}</td>
                        <td className="mono">{user.photoCount.toLocaleString()}</td>
                        <td className="cell-id">{formatAdminDate(user.createdAt)}</td>
                        <td><span className={tagClassForStatus(user.accountStatus)}>{user.accountStatus === 'active' ? '正常' : '已封禁'}</span></td>
                        <td>
                          <div className="tbl-actions">
                            <button className="tbl-icon" type="button" onClick={() => void handleAdminSelectUser(user.id)} title="查看">⌕</button>
                            <button
                              className="tbl-icon"
                              type="button"
                              onClick={() =>
                                void handleAdminUpdateUser(user.id, {
                                  accountStatus: user.accountStatus === 'active' ? 'disabled' : 'active'
                                })
                              }
                              title={user.accountStatus === 'active' ? '封禁' : '启用'}
                            >
                              ✎
                            </button>
                            <button className="tbl-icon" type="button" onClick={() => void handleAdminSelectUser(user.id)} title="更多">⋯</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            <div className="pagination">
                <span>显示 1 - {adminUsers.length}，共 {(adminTotalUsers || adminUsers.length).toLocaleString()} 条 · 第 {adminPage} / {resolvedAdminPageCount} 页</span>
                <div className="page-btns">
                  <button className="page-btn" type="button" onClick={() => setAdminPage(Math.max(1, adminPage - 1))} disabled={adminPage <= 1}>‹</button>
                  <span className="page-btn active">{adminPage}</span>
                  <button className="page-btn" type="button" onClick={() => setAdminPage(Math.min(resolvedAdminPageCount, adminPage + 1))} disabled={adminPage >= resolvedAdminPageCount}>›</button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-tip">{adminBusy ? '正在读取用户...' : '暂无用户数据'}</div>
          )}
        </div>
        {adminSelectedUser ? (
          <div className="card admin-detail-card">
            <div className="card-header">
              <h3>{adminSelectedUser.displayName} · 积分与项目</h3>
              <div className="admin-page-actions">
                <button className="btn btn-ghost" type="button" onClick={() => void handleAdminSelectUser(adminSelectedUser.id)} disabled={adminDetailBusy}>刷新详情</button>
                <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLogoutUser(adminSelectedUser.id)} disabled={adminActionBusy}>踢下线</button>
                <button className="btn btn-ghost" type="button" onClick={() => void handleAdminDeleteUser(adminSelectedUser.id)} disabled={adminActionBusy}>删除用户</button>
              </div>
            </div>
            <div className="admin-detail-grid">
              <div className="settings-row">
                <div className="label-side">
                  <div className="name">手动调整积分</div>
                  <div className="desc">正数增加，负数扣减，会写入账单流水。</div>
                </div>
                <div className="admin-inline-form">
                  <select
                    value={adminAdjustment.type}
                    onChange={(event) => setAdminAdjustment((current) => ({ ...current, type: event.target.value as 'credit' | 'charge' }))}
                  >
                    <option value="credit">补积分</option>
                    <option value="charge">扣积分</option>
                  </select>
                  <input value={adminAdjustment.points} onChange={(event) => setAdminAdjustment((current) => ({ ...current, points: event.target.value }))} placeholder="积分" />
                  <input value={adminAdjustment.note} onChange={(event) => setAdminAdjustment((current) => ({ ...current, note: event.target.value }))} placeholder="备注" />
                  <button className="btn btn-primary" type="button" onClick={() => void handleAdminAdjustBilling(adminSelectedUser.id)} disabled={adminActionBusy}>提交</button>
                </div>
              </div>
              <div className="admin-mini-table">
                <div className="admin-mini-head"><strong>最近项目</strong><span>{adminDetailProjects.length} 个</span></div>
                {adminDetailProjects.slice(0, 6).map((project) => (
                  <button key={project.id} className="admin-project-row" type="button" onClick={() => void handleAdminSelectProject(project.id)}>
                    <span>{project.name}</span>
                    <small>{getProjectStatusLabel(project, locale)} · {project.photoCount} 张 · {formatAdminDate(project.updatedAt)}</small>
                  </button>
                ))}
                {!adminDetailProjects.length && <p>暂无项目。</p>}
              </div>
              <div className="admin-mini-table">
                <div className="admin-mini-head"><strong>积分流水</strong><span>{adminDetailBillingEntries.length} 条</span></div>
                {adminDetailBillingEntries.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="admin-mini-row">
                    <span>{entry.note || entry.projectName || entry.activationCodeLabel || entry.type}</span>
                    <small>{entry.type === 'credit' ? '+' : '-'}{entry.points} pts · {formatAdminDate(entry.createdAt)}</small>
                  </div>
                ))}
                {!adminDetailBillingEntries.length && <p>暂无积分流水。</p>}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );

    const renderWorksPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '修图作品',
          <>所有用户的 AI 修图作品 · 当前载入 <span className="mono accent-text">{adminProjects.length.toLocaleString()}</span> 项</>,
          <>
            <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadProjects()} disabled={adminProjectsBusy}>
              {adminProjectsBusy ? '刷新中...' : '刷新作品'}
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setAdminConsolePage('content')}>+ 添加精选</button>
          </>
        )}
        <div className="card">
          <div className="toolbar">
            <input
              value={adminWorksSearch}
              onChange={(event) => setAdminWorksSearch(event.target.value)}
              placeholder="搜索 作品名称 / 用户"
            />
          </div>
          {adminProjects.length ? (() => {
            const filtered = adminProjects.filter((p) => !adminWorksSearch || p.name.toLowerCase().includes(adminWorksSearch.toLowerCase()) || (p.userDisplayName ?? p.userKey ?? '').toLowerCase().includes(adminWorksSearch.toLowerCase())).slice(0, 32);
            return filtered.length ? (
              <div className="works-grid">
                {filtered.map((project, index) => {
                  const preview = project.resultAssets[0]?.previewUrl ?? project.resultAssets[0]?.storageUrl ?? project.hdrItems[0]?.previewUrl ?? null;
                  return (
                    <button key={project.id} className="work-card" type="button" onClick={() => void handleAdminSelectProject(project.id)}>
                      <div className={projectToneClass(index)}>
                        {preview ? <img src={resolveMediaUrl(preview)} alt={project.name} loading="lazy" decoding="async" /> : null}
                        <div className="badge-row">
                          <span className="ai-badge">{project.studioFeatureTitle ?? project.workflowId ?? 'HDR ENHANCE'}</span>
                          <span className="check">{project.status === 'completed' ? '✓' : project.status === 'failed' ? '⚠' : '⋯'}</span>
                        </div>
                      </div>
                      <div className="work-meta">
                        <div className="name">{project.name}</div>
                        <div className="by"><span>{project.userDisplayName || project.userKey}</span><span>{formatAdminShortDate(project.updatedAt)}</span></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : <div className="empty-tip">没有匹配 "{adminWorksSearch}" 的作品</div>;
          })() : (
            <div className="empty-tip">{adminProjectsBusy ? '正在读取作品...' : '暂无作品'}</div>
          )}
        </div>
        {adminSelectedProject ? (
          <div className="card admin-detail-card">
            <div className="card-header">
              <h3>{adminSelectedProject.name}</h3>
              <div className="admin-inline-actions">
                <span className={tagClassForStatus(adminSelectedProject.status)}>{getProjectStatusLabel(adminSelectedProject, locale)}</span>
                <button className="btn btn-ghost btn-xs" type="button" onClick={() => void handleAdminRecoverSelectedProject()} disabled={adminActionBusy}>
                  {adminActionBusy ? '恢复中...' : '恢复 RunningHub 结果'}
                </button>
              </div>
            </div>
            <div className="admin-project-live">
              <div className="admin-live-stats">
                <span>失败 {adminSelectedProjectFailedItems.length}</span>
                <span>处理中 {adminSelectedProjectProcessingItems.length}</span>
                <span>结果 {adminSelectedProjectResults.length}</span>
              </div>
              {adminSelectedProjectResults.length ? (
                <div className="admin-live-grid">
                  {adminSelectedProjectResults.slice(0, 12).map((asset) => (
                    <a key={asset.id} className="admin-live-tile" href={resolveMediaUrl(asset.storageUrl)} target="_blank" rel="noreferrer">
                      <img src={resolveMediaUrl(asset.previewUrl ?? asset.storageUrl)} alt={asset.fileName} loading="lazy" decoding="async" />
                      <span>{asset.fileName}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );

    const renderOrdersPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '订单管理',
          <>本月营收 <span className="mono accent-text">${paidOrderRevenue.toFixed(2)}</span> · 退款 <span className="mono danger-text">{adminOrders.filter((order) => order.status === 'refunded').length}</span></>,
          <>
            <button className="btn btn-ghost" type="button" onClick={exportAdminOrdersCSV} disabled={!adminOrders.length}>导出账单 CSV</button>
            <button className="btn btn-primary" type="button" onClick={() => void handleAdminLoadOrders()} disabled={adminOrdersBusy}>{adminOrdersBusy ? '刷新中...' : '刷新订单'}</button>
          </>
        )}
        <div className="kpi-grid">
          {kpi('本月订单数', adminOrders.length.toLocaleString(), <><span>▲ {paidOrders.length}</span><span className="vs">已支付</span></>)}
          {kpi('客单价', paidOrders.length ? `$${(paidOrderRevenue / paidOrders.length).toFixed(0)}` : '$0', <><span>▲ 实时</span><span className="vs">平均</span></>)}
          {kpi('完成率', adminOrders.length ? `${Math.round((paidOrders.length / adminOrders.length) * 100)}%` : '0%', <><span>▲</span><span className="vs">订单</span></>)}
          {kpi('失败率', adminOrders.length ? `${Math.round((adminOrders.filter((order) => order.status === 'failed').length / adminOrders.length) * 100)}%` : '0%', <><span>▼</span><span className="vs">异常</span></>, 'down')}
        </div>
        <div className="card">
          <div className="toolbar">
            <input
              value={adminOrdersSearch}
              onChange={(event) => setAdminOrdersSearch(event.target.value)}
              placeholder="搜索 订单号 / 邮箱"
            />
            <select
              value={adminOrdersStatusFilter}
              onChange={(event) => setAdminOrdersStatusFilter(event.target.value as typeof adminOrdersStatusFilter)}
            >
              <option value="all">所有状态</option>
              <option value="paid">已支付</option>
              <option value="checkout_created">处理中</option>
              <option value="failed">失败</option>
              <option value="refunded">已退款</option>
            </select>
          </div>
          {adminOrders.length ? (() => {
            const filtered = adminOrders.filter((o) =>
              (!adminOrdersSearch || o.email.toLowerCase().includes(adminOrdersSearch.toLowerCase()) || String(o.id).includes(adminOrdersSearch)) &&
              (adminOrdersStatusFilter === 'all' || o.status === adminOrdersStatusFilter)
            );
            return filtered.length
              ? renderAdminOrdersTable(filtered)
              : <div className="empty-tip">没有匹配的订单{adminOrdersSearch ? `（关键词："${adminOrdersSearch}"）` : ''}</div>;
          })() : <div className="empty-tip">{adminOrdersBusy ? '正在读取订单...' : '暂无订单'}</div>}
        </div>
      </div>
    );

    const renderPlansPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '套餐配置',
          <>编辑前台 Plans 页展示的 <span className="mono accent-text">{planPackages.length}</span> 档套餐 · 改动会即时生效</>,
          <>
            <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '刷新中...' : '刷新套餐'}</button>
            <button className="btn btn-primary" type="button" onClick={handleAdminOpenNewPlanPackage} disabled={adminSystemBusy}>+ 新增套餐</button>
          </>
        )}
        <div className="plans-grid">
          {planPackages.map((plan, index) => (
            <div key={plan.id} className={`plan-card${index === 1 ? ' featured' : ''}`}>
              <div className="plan-tag">Tier {String(index + 1).padStart(2, '0')}{index === 1 ? ' · Best Value' : ''}</div>
              <div className="plan-name">{plan.name}</div>
              <div className="plan-price">${plan.amountUsd.toFixed(0)}<span className="small">/次</span></div>
              <div className="plan-credits">{plan.points} 积分 · 优惠 {plan.discountPercent}%</div>
              <ul className="plan-features">
                <li>{plan.points} 张约可处理照片</li>
                <li>Stripe 充值订单</li>
                <li>激活码折扣可叠加</li>
                <li>自动到账积分</li>
              </ul>
              <button className="plan-edit-btn" type="button" onClick={() => handleAdminEditPlanPackage(plan)}>编辑套餐</button>
            </div>
          ))}
          {!planPackages.length && <div className="empty-tip">暂无套餐数据</div>}
        </div>
        {adminPlanEditorOpen ? (
          <div className="card admin-inline-editor">
            <div className="card-header">
              <h3>套餐设置</h3>
              <button className="tbl-icon" type="button" onClick={() => setAdminPlanEditorOpen(false)}>×</button>
            </div>
            <div className="admin-form-grid">
              <label>
                <span>套餐 ID</span>
                <input value={adminPlanDraft.id} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, id: event.target.value }))} />
              </label>
              <label>
                <span>套餐名称</span>
                <input value={adminPlanDraft.name} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span>实付金额 USD</span>
                <input type="number" min="1" value={adminPlanDraft.amountUsd} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, amountUsd: event.target.value }))} />
              </label>
              <label>
                <span>到账积分</span>
                <input type="number" min="1" value={adminPlanDraft.points} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, points: event.target.value }))} />
              </label>
              <label>
                <span>显示优惠 %</span>
                <input type="number" min="0" max="100" value={adminPlanDraft.discountPercent} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, discountPercent: event.target.value }))} />
              </label>
              <label>
                <span>原价 USD</span>
                <input type="number" min="1" value={adminPlanDraft.listPriceUsd} onChange={(event) => setAdminPlanDraft((current) => ({ ...current, listPriceUsd: event.target.value }))} />
              </label>
            </div>
            <div className="admin-form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setAdminPlanEditorOpen(false)}>取消</button>
              <button className="btn btn-primary" type="button" onClick={() => void handleAdminSavePlanPackage()} disabled={adminSystemBusy}>
                {adminSystemBusy ? '保存中...' : '保存套餐'}
              </button>
            </div>
          </div>
        ) : null}
        <div className="card">
          <div className="card-header">
            <h3>套餐转化漏斗</h3>
            <div className="chart-tabs"><span className="chart-tab">7 天</span><span className="chart-tab active">30 天</span></div>
          </div>
          <div className="admin-console-metrics card-body">
            <div><span>访问 Plans</span><strong>{(adminTotals.users * 2 || 0).toLocaleString()}</strong></div>
            <div><span>点击购买</span><strong>{adminOrders.length.toLocaleString()}</strong></div>
            <div><span>完成支付</span><strong>{paidOrders.length.toLocaleString()}</strong></div>
          </div>
        </div>
      </div>
    );

    const renderCodesPage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '兑换码',
          '生成与管理积分兑换码、活动促销码、合作伙伴码',
          <>
            <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadActivationCodes()} disabled={adminActivationBusy}>
              {adminActivationBusy ? '刷新中...' : '刷新兑换码'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={handleAdminOpenBatchActivationCodes}>批量生成</button>
            <button className="btn btn-primary" type="button" onClick={() => { setAdminSingleCodeOpen(true); setAdminActivationDraft({ code: '', label: '', packageId: '', discountPercentOverride: '', bonusPoints: '0', maxRedemptions: '', expiresAt: '', active: true }); }}>+ 新建兑换码</button>
          </>
        )}
        <div className="code-grid">
          <div className="code-stat"><div className="label">已生成 / 可用</div><div className="value">{adminActivationCodes.length.toLocaleString()} / {availableCodeCount}</div></div>
          <div className="code-stat"><div className="label">已使用</div><div className="value accent-text">{usedCodeCount.toLocaleString()}</div></div>
          <div className="code-stat"><div className="label">使用率</div><div className="value success-text">{codeUsageRate}%</div></div>
        </div>
        {adminBatchCodeOpen ? (
          <div className="card admin-inline-editor">
            <div className="card-header">
              <h3>批量生成兑换码</h3>
              <button className="tbl-icon" type="button" onClick={() => setAdminBatchCodeOpen(false)}>×</button>
            </div>
            <div className="admin-form-grid">
              <label>
                <span>前缀</span>
                <input value={adminBatchCodeDraft.prefix} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, prefix: event.target.value.toUpperCase() }))} />
              </label>
              <label>
                <span>数量</span>
                <input type="number" min="1" max={ADMIN_MAX_BATCH_CODES} value={adminBatchCodeDraft.count} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, count: event.target.value }))} />
              </label>
              <label>
                <span>显示名称</span>
                <input value={adminBatchCodeDraft.label} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, label: event.target.value }))} />
              </label>
              <label>
                <span>绑定套餐</span>
                <select value={adminBatchCodeDraft.packageId} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, packageId: event.target.value }))}>
                  <option value="">不绑定套餐</option>
                  {planPackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>覆盖优惠 %</span>
                <input type="number" min="0" max="100" value={adminBatchCodeDraft.discountPercentOverride} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, discountPercentOverride: event.target.value }))} />
              </label>
              <label>
                <span>额外积分</span>
                <input type="number" min="0" value={adminBatchCodeDraft.bonusPoints} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, bonusPoints: event.target.value }))} />
              </label>
              <label>
                <span>每码次数</span>
                <input type="number" min="1" value={adminBatchCodeDraft.maxRedemptions} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, maxRedemptions: event.target.value }))} />
              </label>
              <label>
                <span>到期时间</span>
                <input type="datetime-local" value={adminBatchCodeDraft.expiresAt} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, expiresAt: event.target.value }))} />
              </label>
              <label className="admin-check-field">
                <input type="checkbox" checked={adminBatchCodeDraft.active} onChange={(event) => setAdminBatchCodeDraft((current) => ({ ...current, active: event.target.checked }))} />
                <span>生成后立即启用</span>
              </label>
            </div>
            <div className="admin-form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setAdminBatchCodeOpen(false)}>取消</button>
              <button className="btn btn-primary" type="button" onClick={() => void handleAdminCreateBatchActivationCodes()} disabled={adminActivationBusy}>
                {adminActivationBusy ? '生成中...' : '确认生成'}
              </button>
            </div>
          </div>
        ) : null}
        {adminSingleCodeOpen ? (
          <div className="card admin-inline-editor">
            <div className="card-header">
              <h3>新建单个兑换码</h3>
              <button className="tbl-icon" type="button" onClick={() => setAdminSingleCodeOpen(false)}>×</button>
            </div>
            <div className="admin-form-grid">
              <label>
                <span>兑换码（留空自动生成）</span>
                <input value={adminActivationDraft.code} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="自动生成" />
              </label>
              <label>
                <span>显示名称</span>
                <input value={adminActivationDraft.label} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, label: event.target.value }))} placeholder="例：双十一活动码" />
              </label>
              <label>
                <span>绑定套餐</span>
                <select value={adminActivationDraft.packageId} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, packageId: event.target.value }))}>
                  <option value="">不绑定套餐（通用）</option>
                  {planPackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>覆盖优惠 %（留空使用套餐默认）</span>
                <input type="number" min="0" max="100" value={adminActivationDraft.discountPercentOverride} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, discountPercentOverride: event.target.value }))} placeholder="不覆盖" />
              </label>
              <label>
                <span>额外赠送积分</span>
                <input type="number" min="0" value={adminActivationDraft.bonusPoints} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, bonusPoints: event.target.value }))} />
              </label>
              <label>
                <span>最大兑换次数（留空无限）</span>
                <input type="number" min="1" value={adminActivationDraft.maxRedemptions} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, maxRedemptions: event.target.value }))} placeholder="无限" />
              </label>
              <label>
                <span>到期时间（留空永不过期）</span>
                <input type="datetime-local" value={adminActivationDraft.expiresAt} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, expiresAt: event.target.value }))} />
              </label>
              <label className="admin-check-field">
                <input type="checkbox" checked={adminActivationDraft.active} onChange={(event) => setAdminActivationDraft((current) => ({ ...current, active: event.target.checked }))} />
                <span>创建后立即启用</span>
              </label>
            </div>
            <div className="admin-form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setAdminSingleCodeOpen(false)}>取消</button>
              <button className="btn btn-primary" type="button" onClick={() => void handleAdminCreateActivationCode()} disabled={adminActivationBusy}>
                {adminActivationBusy ? '创建中...' : '确认创建'}
              </button>
            </div>
          </div>
        ) : null}
        <div className="card">
          <div className="toolbar">
            <input
              value={adminActivationDraft.code}
              onChange={(event) => setAdminActivationDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
              placeholder="搜索兑换码"
            />
            <select value={adminCodesStatusFilter} onChange={(event) => setAdminCodesStatusFilter(event.target.value as typeof adminCodesStatusFilter)}>
              <option value="all">所有状态</option>
              <option value="available">活跃可用</option>
              <option value="used">已用完</option>
              <option value="expired">已过期</option>
              <option value="inactive">已停用</option>
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>兑换码</th><th>类型</th><th>面值</th><th>剩余 / 总量</th><th>有效期</th><th>使用情况</th><th>状态</th><th></th></tr></thead>
              <tbody>
                {adminActivationCodes.filter((item) => {
                  const search = adminActivationDraft.code.trim().toUpperCase();
                  if (search && !item.code.includes(search) && !item.label.toUpperCase().includes(search)) return false;
                  const isExpired = !!item.expiresAt && new Date(item.expiresAt) < new Date();
                  const isUsedUp = !item.available && item.active && !isExpired &&
                    item.maxRedemptions !== null && item.redemptionCount >= item.maxRedemptions;
                  if (adminCodesStatusFilter === 'available') return item.available;
                  if (adminCodesStatusFilter === 'used') return isUsedUp;
                  if (adminCodesStatusFilter === 'expired') return isExpired;
                  if (adminCodesStatusFilter === 'inactive') return !item.active;
                  return true;
                }).map((item) => (
                  <tr key={item.id}>
                    <td className="mono code-text">{item.code}</td>
                    <td><span className={`tag ${item.packageName ? 'tag-purple' : 'tag-cyan'}`}>{item.packageName ? '套餐优惠' : '积分'}</span></td>
                    <td className="mono">{item.discountPercentOverride !== null ? `${item.discountPercentOverride} 折` : item.bonusPoints ? `+${item.bonusPoints} 积分` : '默认'}</td>
                    <td className="mono">{item.maxRedemptions ? `${Math.max(0, item.maxRedemptions - item.redemptionCount)} / ${item.maxRedemptions}` : '无限'}</td>
                    <td className="cell-id">{item.expiresAt ? formatAdminDate(item.expiresAt) : '永久'}</td>
                    <td className="mono">{item.redemptionCount}{item.maxRedemptions ? ` / ${item.maxRedemptions}` : ' 次'}</td>
                    <td><span className={item.available ? 'tag tag-green' : item.active ? 'tag tag-orange' : 'tag tag-gray'}>{item.available ? '活跃' : item.active ? '不可用' : '已停用'}</span></td>
                    <td>
                      <div className="tbl-actions">
                        <button className="tbl-icon" type="button" title={item.active ? '停用' : '启用'} onClick={() => void handleAdminToggleActivationCode(item)} disabled={adminActivationBusy}>{item.active ? '⏸' : '▶'}</button>
                        <button className="tbl-icon" type="button" title={item.redemptionCount > 0 ? '已兑换，无法删除' : '删除'} onClick={() => void handleAdminDeleteActivationCode(item)} disabled={adminActivationBusy || item.redemptionCount > 0} style={item.redemptionCount > 0 ? { opacity: 0.35, cursor: 'not-allowed' } : {}}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!adminActivationCodes.length && <div className="empty-tip">{adminActivationBusy ? '正在读取兑换码...' : '暂无兑换码'}</div>}
        </div>
      </div>
    );

    const renderEnginePage = () => (
      <div className="page-content active">
        {adminPageTitle(
          'AI 引擎',
          '管理所有 AI 修图引擎 · 监控调用量、成本、错误率',
          <>
            <button className="btn btn-primary" type="button" onClick={() => void handleAdminLoadWorkflows()} disabled={adminWorkflowBusy}>{adminWorkflowBusy ? '刷新中...' : '刷新引擎'}</button>
          </>
        )}
        <div className="kpi-grid">
          {kpi('总引擎数', <>{enabledWorkflowCount}<span className="unit">/ {Math.max(enabledWorkflowCount, 1)}</span></>, <span className="vs">{adminWorkflowSummary?.active ?? '未加载'}</span>)}
          {kpi('本月调用', totalProjectPhotos.toLocaleString(), <span>▲ 实时项目</span>)}
          {kpi('本月成本', `$${(totalProjectPhotos * 0.04).toFixed(0)}`, <span>▲ 估算</span>, 'down')}
          {kpi('Runpod 批量', <>{adminSystemSettings?.runpodHdrBatchSize ?? 0}<span className="unit">组/批</span></>, <span>▼ 批量设置</span>)}
        </div>
        <div className="engine-grid">
          {workflowItems.length ? workflowItems.map((item, index) => {
            const isActive = adminWorkflowSummary?.active?.trim().toLowerCase() === item.name.trim().toLowerCase();
            const isMissingWorkflow = !item.workflowId;
            const isApiMissing = !adminWorkflowSummary?.apiKeyConfigured;
            const statusTag = isMissingWorkflow
              ? <span className="tag tag-orange">未配置</span>
              : isApiMissing
                ? <span className="tag tag-red">API 缺失</span>
                : isActive
                  ? <span className="tag tag-purple">主流程</span>
                  : <span className="tag tag-green">就绪</span>;
            return (
              <div key={`${item.name}-${item.workflowId ?? index}`} className={`engine-card${isMissingWorkflow || isApiMissing ? '' : ' live'}`}>
              <div className="engine-head">
                <div className="engine-icon">{['✨', '☁️', '🛋️', '🌿', '🧹', '🌅'][index % 6]}</div>
                <div>
                  <div className="engine-title">{item.name}</div>
                  <div className="engine-sub">workflow: {item.workflowId ?? '未配置'} · type: {item.type}</div>
                </div>
                {statusTag}
              </div>
              <div className="engine-stats">
                <div className="engine-stat"><div className="label">输入节点</div><div className="value">{item.inputCount}</div></div>
                <div className="engine-stat"><div className="label">输出节点</div><div className="value">{item.outputCount}</div></div>
                <div className="engine-stat"><div className="label">Prompt 节点</div><div className="value success-text">{item.promptNodeId ?? '—'}</div></div>
                <div className="engine-stat"><div className="label">颜色卡</div><div className="value">{item.colorCardNo ?? '—'}</div></div>
              </div>
            </div>
            );
          }) : (
            <div className="empty-tip">{adminWorkflowBusy ? '正在读取 AI 引擎...' : '暂无工作流数据'}</div>
          )}
        </div>
      </div>
    );

    const renderPromptsPage = () => (
      <div className="page-content active">
        {adminPageTitle('Prompt 模板', '每个 AI 引擎背后的提示词配置 · 改动需重新评测', <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadWorkflows()} disabled={adminWorkflowBusy}>{adminWorkflowBusy ? '刷新中...' : '刷新模板'}</button>)}
        <div className="card">
          <div className="card-body prompt-grid">
            {workflowItems.length ? workflowItems.map((item) => (
              <article key={`${item.name}-prompt`} className="prompt-card">
                <span className="tag tag-purple">{item.type}</span>
                <h3>{item.name}</h3>
                <p>Prompt Node: <span className="mono">{item.promptNodeId ?? '未配置'}</span></p>
                <p>Workflow ID: <span className="mono">{item.workflowId ?? '未配置'}</span></p>
              </article>
            )) : <div className="empty-tip">暂无 Prompt 模板数据</div>}
          </div>
        </div>
      </div>
    );

    const renderContentPage = () => (
      <div className="page-content active">
        {adminPageTitle('内容运营', '前台功能卡片、对比图、输入输出节点、每张积分', <button className="btn btn-primary" type="button" onClick={handleAddAdminFeatureCard}>+ 添加功能卡片</button>)}
        <div className="card">
          <div className="card-header">
            <h3>功能卡片配置</h3>
            <button className="btn btn-ghost" type="button" onClick={() => void handleAdminSaveSystemSettings()} disabled={adminSystemBusy || !adminFeatureDrafts.length}>保存全部</button>
          </div>
          <div className="card-body feature-admin-grid">
            {adminFeatureDrafts.map((feature, index) => {
              const workflowDisplay = getAdminFeatureWorkflowDisplay(feature);
              const beforeImageBusy = adminFeatureImageBusy === `${feature.id}:beforeImageUrl`;
              const afterImageBusy = adminFeatureImageBusy === `${feature.id}:afterImageUrl`;
              return (
              <details
                key={feature.id}
                className="feature-admin-card"
                open={Boolean(adminExpandedFeatureIds[feature.id])}
                onToggle={(event) =>
                  setAdminExpandedFeatureIds((current) => ({
                    ...current,
                    [feature.id]: event.currentTarget.open
                  }))
                }
              >
                <summary>
                  <span className={`tag ${planToneClass(index)}`}>{feature.status}</span>
                  <strong>{feature.titleZh}</strong>
                  <small>Workflow: {workflowDisplay.workflowId || '未配置'} · 输入 {workflowDisplay.inputNodeId || '—'} · 输出 {workflowDisplay.outputNodeId || '—'} · {feature.pointsPerPhoto} pts/张</small>
                </summary>
                <div className="feature-admin-form">
                  <label className="admin-check-field">
                    <input
                      type="checkbox"
                      checked={feature.enabled}
                      onChange={(event) => updateAdminFeatureDraft(feature.id, { enabled: event.target.checked })}
                    />
                    <span>前台启用</span>
                  </label>
                  <select value={feature.category} onChange={(event) => updateAdminFeatureDraft(feature.id, { category: event.target.value as StudioFeatureConfig['category'] })}>
                    {ADMIN_FEATURE_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={feature.status} onChange={(event) => updateAdminFeatureDraft(feature.id, { status: event.target.value as StudioFeatureConfig['status'] })}>
                    {ADMIN_FEATURE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={feature.tone} onChange={(event) => updateAdminFeatureDraft(feature.id, { tone: event.target.value as StudioFeatureConfig['tone'] })}>
                    {ADMIN_FEATURE_TONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input value={feature.titleZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { titleZh: event.target.value })} placeholder="中文功能名称" />
                  <input value={feature.titleEn} onChange={(event) => updateAdminFeatureDraft(feature.id, { titleEn: event.target.value })} placeholder="英文功能名称" />
                  <textarea value={feature.descriptionZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { descriptionZh: event.target.value })} placeholder="中文描述" />
                  <input value={feature.workflowId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { workflowId: event.target.value })} placeholder="Workflow ID" />
                  <input value={feature.inputNodeId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { inputNodeId: event.target.value })} placeholder="输入节点" />
                  <input value={feature.outputNodeId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { outputNodeId: event.target.value })} placeholder="输出节点" />
                  <input value={feature.pointsPerPhoto} onChange={(event) => updateAdminFeatureDraft(feature.id, { pointsPerPhoto: Number(event.target.value) || 0 })} inputMode="numeric" placeholder="每张积分" />
                  <div className="feature-upload-row">
                    <span>对比图 Before</span>
                    <input value={feature.beforeImageUrl} onChange={(event) => updateAdminFeatureDraft(feature.id, { beforeImageUrl: event.target.value })} placeholder="Before URL" />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={beforeImageBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleAdminFeatureImageUpload(feature.id, 'beforeImageUrl', file);
                        }
                        event.currentTarget.value = '';
                      }}
                    />
                    {beforeImageBusy ? <small>上传中...</small> : null}
                  </div>
                  <div className="feature-upload-row">
                    <span>对比图 After</span>
                    <input value={feature.afterImageUrl} onChange={(event) => updateAdminFeatureDraft(feature.id, { afterImageUrl: event.target.value })} placeholder="After URL" />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={afterImageBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleAdminFeatureImageUpload(feature.id, 'afterImageUrl', file);
                        }
                        event.currentTarget.value = '';
                      }}
                    />
                    {afterImageBusy ? <small>上传中...</small> : null}
                  </div>
                </div>
              </details>
              );
            })}
          </div>
        </div>
      </div>
    );

    const renderLogsPage = () => (
      <div className="page-content active">
        {adminPageTitle('操作日志', '所有管理员操作 · 不可编辑、不可删除', <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadAuditLogs()} disabled={adminActionBusy}>读取日志</button>)}
        <div className="card">
          <div className="toolbar">
            <input
              value={adminLogsSearch}
              onChange={(event) => setAdminLogsSearch(event.target.value)}
              placeholder="搜索 操作员 / 操作类型"
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>操作员</th><th>模块</th><th>操作</th><th>对象</th><th>IP</th></tr></thead>
              <tbody>
                {adminAuditLogs
                  .filter((entry) => !adminLogsSearch ||
                    (entry.actorEmail ?? entry.actorType ?? '').toLowerCase().includes(adminLogsSearch.toLowerCase()) ||
                    entry.action.toLowerCase().includes(adminLogsSearch.toLowerCase())
                  )
                  .map((entry, index) => (
                    <tr key={entry.id}>
                      <td className="cell-id">{formatAdminDate(entry.createdAt)}</td>
                      <td><div className="user-cell"><div className="user-avatar" style={userAvatarStyle(index)}>{getAdminInitials(entry.actorEmail ?? entry.actorType)}</div><div><div className="name">{entry.actorEmail ?? entry.actorType}</div></div></div></td>
                      <td><span className="tag tag-cyan">{entry.action.split('.')[0] || '系统'}</span></td>
                      <td>{entry.action}</td>
                      <td className="mono">{entry.targetUserId ?? entry.targetProjectId ?? '—'}</td>
                      <td className="cell-id">{entry.ipAddress}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {adminAuditLogs.length > 0 && adminLogsSearch && !adminAuditLogs.some((e) =>
            (e.actorEmail ?? e.actorType ?? '').toLowerCase().includes(adminLogsSearch.toLowerCase()) ||
            e.action.toLowerCase().includes(adminLogsSearch.toLowerCase())
          ) && <div className="empty-tip">没有匹配 "{adminLogsSearch}" 的日志记录</div>}
          {!adminAuditLogs.length && <div className="empty-tip">{adminActionBusy ? '正在读取日志...' : '暂无日志，点击"读取日志"加载'}</div>}
        </div>
      </div>
    );

    const renderSettingsPage = () => (
      <div className="page-content active">
        {adminPageTitle('系统设置', '站点配置、AI 引擎、管理员账号', <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '读取中...' : '刷新配置'}</button>)}
        <div className="settings-tabs">
          <button type="button" className={`settings-tab${adminSettingsTab === 'basic' ? ' active' : ''}`} onClick={() => setAdminSettingsTab('basic')}>基础</button>
          <button type="button" className={`settings-tab${adminSettingsTab === 'api' ? ' active' : ''}`} onClick={() => { setAdminSettingsTab('api'); void handleAdminLoadWorkflows(); }}>AI &amp; API</button>
          <button type="button" className={`settings-tab${adminSettingsTab === 'account' ? ' active' : ''}`} onClick={() => setAdminSettingsTab('account')}>管理员账号</button>
        </div>
        {adminSettingsTab === 'basic' && (
          <div className="card">
            <div className="card-body">
              <div className="settings-row">
                <div className="label-side"><div className="name">云处理 HDR 批量</div><div className="desc">每个 Runpod 任务包含的 HDR 组数，支持 {MIN_RUNPOD_HDR_BATCH_SIZE}–{MAX_RUNPOD_HDR_BATCH_SIZE}，新任务即时生效</div></div>
                <div className="admin-inline-form">
                  <input value={adminSystemDraft.runpodHdrBatchSize} onChange={(event) => setAdminSystemDraft((current) => ({ ...current, runpodHdrBatchSize: event.target.value }))} inputMode="numeric" min={MIN_RUNPOD_HDR_BATCH_SIZE} max={MAX_RUNPOD_HDR_BATCH_SIZE} />
                  <button className="btn btn-primary" type="button" onClick={() => void handleAdminSaveSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '保存中...' : '保存'}</button>
                </div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">RunningHub 并发</div><div className="desc">后续修图工作流同时提交的照片数，建议 48；支持 {MIN_RUNNINGHUB_MAX_IN_FLIGHT}–{MAX_RUNNINGHUB_MAX_IN_FLIGHT}，新任务即时生效</div></div>
                <div className="admin-inline-form">
                  <input value={adminSystemDraft.runningHubMaxInFlight} onChange={(event) => setAdminSystemDraft((current) => ({ ...current, runningHubMaxInFlight: event.target.value }))} inputMode="numeric" min={MIN_RUNNINGHUB_MAX_IN_FLIGHT} max={MAX_RUNNINGHUB_MAX_IN_FLIGHT} />
                  <button className="btn btn-primary" type="button" onClick={() => void handleAdminSaveSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '保存中...' : '保存'}</button>
                </div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">当前生效设置</div><div className="desc">最近从服务器读取的批量和并发值</div></div>
                <div>
                  <span className="tag tag-cyan">{adminSystemSettings?.runpodHdrBatchSize ?? '未读取'} 组 / Runpod 批</span>
                  <span className="tag tag-gray" style={{marginLeft: 8}}>{adminSystemSettings?.runningHubMaxInFlight ?? '未读取'} 张 / RunningHub 并发</span>
                </div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">套餐数量</div><div className="desc">前台 Plans 页展示的充值档位数</div></div>
                <div><span className="tag tag-gray">{adminSystemSettings?.billingPackages?.length ?? planPackages.length} 档</span> <button className="btn btn-ghost" type="button" onClick={() => setAdminConsolePage('plans')} style={{marginLeft: 8}}>管理套餐 →</button></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">功能卡片</div><div className="desc">前台 Studio 展示的 AI 功能卡片数</div></div>
                <div><span className="tag tag-gray">{adminSystemSettings?.studioFeatures?.length ?? adminFeatureDrafts.length} 个</span> <button className="btn btn-ghost" type="button" onClick={() => setAdminConsolePage('content')} style={{marginLeft: 8}}>管理卡片 →</button></div>
              </div>
            </div>
          </div>
        )}
        {adminSettingsTab === 'api' && (
          <div className="card">
            <div className="card-body">
              <div className="settings-row">
                <div className="label-side"><div className="name">API 密钥状态</div><div className="desc">Runpod / ComfyUI 工作流 API 配置</div></div>
                <div><span className={adminWorkflowSummary?.apiKeyConfigured ? 'tag tag-green' : 'tag tag-orange'}>{adminWorkflowSummary?.apiKeyConfigured ? '已配置' : '未配置'}</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">执行器</div><div className="desc">当前 AI 工作流引擎提供商</div></div>
                <div><span className="tag tag-cyan">{adminWorkflowSummary?.executor.provider ?? '未读取'}</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">当前主流程</div><div className="desc">活跃的工作流名称</div></div>
                <div><span className="mono">{adminWorkflowSummary?.active ?? '—'}</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">工作流并发</div><div className="desc">后台最大同时运行任务数</div></div>
                <div><span className="tag tag-gray">{adminSystemSettings?.runningHubMaxInFlight ?? adminWorkflowSummary?.settings.workflowMaxInFlight ?? '—'} 张</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">引擎数量</div><div className="desc">已加载的工作流条目数</div></div>
                <div><button className="btn btn-ghost" type="button" onClick={() => setAdminConsolePage('engine')}>查看 AI 引擎 →</button></div>
              </div>
            </div>
          </div>
        )}
        {adminSettingsTab === 'account' && (
          <div className="card">
            <div className="card-body">
              <div className="settings-row">
                <div className="label-side"><div className="name">当前管理员账号</div><div className="desc">已登录的超级管理员</div></div>
                <div>
                  <div className="name">{session?.displayName ?? '—'}</div>
                  <div className="email" style={{color: 'var(--text-dim)', fontSize: 12}}>{session?.email ?? '—'}</div>
                </div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">角色</div><div className="desc">账号权限等级</div></div>
                <div><span className={session?.role === 'admin' ? 'tag tag-purple' : 'tag tag-gray'}>{session?.role === 'admin' ? '超级管理员' : '普通用户'}</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">活跃会话</div><div className="desc">当前已登录设备数量</div></div>
                <div><span className="tag tag-cyan">{session ? '1 个活跃会话' : '未登录'}</span></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">退出登录</div><div className="desc">结束当前管理员会话</div></div>
                <div><button className="btn btn-ghost" type="button" onClick={() => void signOut()}>退出后台</button></div>
              </div>
            </div>
          </div>
        )}
      </div>
    );

    const renderActiveAdminPage = () => {
      switch (adminConsolePage) {
        case 'users':
          return renderUsersPage();
        case 'works':
          return renderWorksPage();
        case 'orders':
          return renderOrdersPage();
        case 'plans':
          return renderPlansPage();
        case 'codes':
          return renderCodesPage();
        case 'engine':
          return renderEnginePage();
        case 'prompts':
          return renderPromptsPage();
        case 'content':
          return renderContentPage();
        case 'logs':
          return renderLogsPage();
        case 'settings':
          return renderSettingsPage();
        case 'dashboard':
        default:
          return renderDashboardPage();
      }
    };

    const renderAdminRefundDialog = () => {
      if (!adminRefundOrder || !adminRefundPreview) {
        return null;
      }

      return (
        <div className="modal-backdrop admin-refund-backdrop" onClick={closeAdminRefundDialog}>
          <div className="modal-card admin-refund-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <strong>退款订单</strong>
                <span className="muted">
                  #{adminRefundOrder.id} · {adminRefundOrder.email}
                </span>
              </div>
              <button className="close-button" type="button" onClick={closeAdminRefundDialog} disabled={adminRefundBusy}>
                ×
              </button>
            </div>
            <div className="admin-refund-grid">
              <article>
                <span>订单金额</span>
                <strong>{formatUsd(adminRefundPreview.orderAmountUsd, locale)}</strong>
              </article>
              <article>
                <span>到账积分</span>
                <strong>{adminRefundPreview.creditedPoints.toLocaleString()} pts</strong>
              </article>
              <article>
                <span>已消费积分</span>
                <strong>{adminRefundPreview.consumedPoints.toLocaleString()} pts</strong>
              </article>
              <article>
                <span>可退金额</span>
                <strong>{formatUsd(adminRefundPreview.refundableAmountUsd, locale)}</strong>
              </article>
              <article>
                <span>退款后余额</span>
                <strong className={adminRefundPreview.balanceAfterRefund < 0 ? 'danger-text' : ''}>
                  {adminRefundPreview.balanceAfterRefund.toLocaleString()} pts
                </strong>
              </article>
            </div>
            <p className="admin-refund-note">
              确认后会先调用 Stripe Refund API。Stripe 返回成功后，系统再写入积分扣回流水；如果余额不足，会显示为负债并抵扣后续充值。
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={closeAdminRefundDialog} disabled={adminRefundBusy}>
                取消
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void handleAdminConfirmRefund()} disabled={adminRefundBusy}>
                {adminRefundBusy ? '退款中...' : '确认 Stripe 退款并扣回积分'}
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
        <>
          <main className="admin-prototype app">
            <aside className="sidebar">
              <button className="brand" type="button" onClick={() => navigateToRoute('studio')}>
                <div className="brand-mark">M</div>
                <div className="brand-text">
                  <strong>Metrovan AI</strong>
                  <small>Admin</small>
                </div>
              </button>
              <div className="nav-section">
                <div className="nav-section-label">概览</div>
                {targetNavButton('dashboard', '仪表盘')}
              </div>
              <div className="nav-section">
                <div className="nav-section-label">业务</div>
                {targetNavButton('users', '用户管理')}
                {targetNavButton('works', '修图作品', pendingProjectCount ? String(pendingProjectCount) : undefined)}
                {targetNavButton('orders', '订单管理')}
                {targetNavButton('plans', '套餐配置')}
                {targetNavButton('codes', '兑换码')}
              </div>
              <div className="nav-section">
                <div className="nav-section-label">AI</div>
                {targetNavButton('engine', 'AI 引擎')}
                {targetNavButton('prompts', 'Prompt 模板')}
              </div>
              <div className="nav-section">
                <div className="nav-section-label">运营 & 系统</div>
                {targetNavButton('content', '内容运营')}
                {targetNavButton('logs', '操作日志')}
                {targetNavButton('settings', '系统设置')}
              </div>
              <button className="sidebar-footer" type="button" onClick={() => setAdminConsolePage('settings')}>
                <div className="avatar">{getAdminInitials(session?.displayName ?? session?.email ?? 'Admin')}</div>
                <div className="info">
                  <div className="name">{session?.displayName ?? 'Jin Zhou'}</div>
                  <div className="role">{session?.role === 'admin' ? '超级管理员' : '未授权'}</div>
                </div>
                <span className="logout" onClick={(event) => { event.stopPropagation(); void signOut(); }}>⏻</span>
              </button>
            </aside>
            <section className="main">
              <header className="topbar">
                <div className="breadcrumb">
                  <span>Console</span>
                  <span className="sep">/</span>
                  <span className="current">{ADMIN_CONSOLE_PAGE_LABELS[adminConsolePage]}</span>
                </div>
                <div className="search-box">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <span>搜索用户、订单、作品…</span>
                  <span className="kbd">⌘K</span>
                </div>
                <div className="topbar-icon" title="通知">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  <span className="dot" />
                </div>
                <div className="topbar-icon" title="帮助">?</div>
                <div className="topbar-avatar">{getAdminInitials(session?.displayName ?? session?.email ?? 'Admin')}</div>
              </header>
              {adminMessage ? <div className="global-message admin-message">{adminMessage}</div> : null}
              {renderActiveAdminPage()}
            </section>
            {renderAdminRefundDialog()}
          </main>
        </>
      );

  }

  if (activeRoute === 'home' || activeRoute === 'plans' || !session) {
    return (
      <>
        <LandingPage
          activeRoute={activeRoute === 'plans' ? 'plans' : 'home'}
          copy={copy}
          hasSession={Boolean(session)}
          message={message}
          onNavigate={navigateToRoute}
          onOpenAuth={openAuth}
        />

        {authOpen && !session && (
          <AuthModal
            copy={copy}
            authMode={authMode}
            authBusy={authBusy}
            auth={auth}
            authTitle={authTitle}
            authSubtitle={authSubtitle}
            authMessage={authMessage}
            authSubmitLabel={authSubmitLabel}
            googleAuthEnabled={googleAuthEnabled}
            isAuthLinkMode={isAuthLinkMode}
            isEmailVerifyMode={isEmailVerifyMode}
            onClose={closeAuth}
            onGoogleAuth={handleGoogleAuth}
            onSelectMode={(mode) => {
              setAuthMode(mode);
              setAuthMessage('');
            }}
            onAuthChange={(patch) => setAuth((current) => ({ ...current, ...patch }))}
            onForgotPassword={handleForgotPassword}
            onToggleMode={() => {
              if (authMode === 'reset-confirm' || authMode === 'verify-email') {
                clearAuthTokenQuery();
              }
              setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
              setAuthMessage('');
            }}
            onSubmit={submitAuth}
          />
        )}
      </>
    );
  }

  return (
    <>
      <main className={`studio-shell${isDemoMode ? ' demo-shell' : ''}`}>
        <div className="ambient-layer studio-ambient" />
        <header className="studio-header">
          <button className="brand-button" type="button" onClick={returnToStudioFeatureCards}>
            <span className="studio-brand-mark-shell" aria-hidden="true">
              <img className="studio-brand-mark" src={logoMark} alt="Metrovan AI" decoding="async" />
            </span>
            <span className="brand-copy">
              <strong>{copy.studioLabel}</strong>
              <em>{copy.studioSubLabel}</em>
            </span>
          </button>
          <div className="header-actions">
            <div className="points-pill">
              <span className="points-pill-label">{copy.points}</span>
              <strong className="points-pill-value">{isDemoMode ? '42.5' : billingSummary?.availablePoints ?? 0}</strong>
              <button className="points-plus" type="button" aria-label={copy.topUp} onClick={() => void handleOpenBilling('topup')}>
                {copy.billingOpenRecharge}
              </button>
            </div>
            <div className="history-menu" ref={historyMenuRef}>
              <button
                className="history-menu-trigger"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={historyMenuOpen}
                onClick={() => setHistoryMenuOpen((current) => !current)}
              >
                {copy.historyProjects}
              </button>
              {historyMenuOpen && (
                <div className="history-menu-popover" role="dialog" aria-label={copy.historyProjects}>
                  <div className="history-menu-head">
                    <strong>{copy.historyProjects}</strong>
                    <span>{isDemoMode ? copy.historyProjectsHintDemo : copy.historyProjectsHint}</span>
                  </div>
                  <div className="project-list compact-history-list">
                    {visibleProjects.map((project) => (
                      <article key={project.id} className={`project-tile${project.id === currentProjectId ? ' active' : ''}`}>
                        <div className="project-tile-head">
                          <div className="project-tile-heading-row">
                            <strong>{project.name}</strong>
                            <button className="text-link tile-rename-link" type="button" onClick={() => void handleRenameProject(project)}>
                              {copy.rename}
                            </button>
                          </div>
                          <span>{formatPhotoCount(project.photoCount, locale)} / {formatDate(project.createdAt, locale)}</span>
                          <em>{getProjectStatusLabel(project, locale)}</em>
                        </div>
                        <div className="project-tile-actions">
                          <button
                            className="ghost-button compact"
                            type="button"
                            onClick={() => {
                              setCurrentProjectId(project.id);
                              setHistoryMenuOpen(false);
                            }}
                          >
                            {copy.open}
                          </button>
                          <button
                            className="ghost-button compact"
                            type="button"
                            disabled={!project.downloadReady}
                            onClick={() => handleDownloadProject(project)}
                          >
                            {copy.download}
                          </button>
                          <button className="ghost-button compact" type="button" onClick={() => void handleDeleteProject(project)}>
                            {copy.delete}
                          </button>
                        </div>
                      </article>
                    ))}

                    {!visibleProjects.length && (
                      <div className="empty-state">
                        <strong>{copy.noProject}</strong>
                        <span>{copy.noProjectHint}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="user-pill"
                type="button"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((current) => !current)}
              >
                <span className="avatar">{session.displayName.slice(0, 2).toUpperCase()}</span>
                <span>{session.displayName}</span>
                <span className="user-pill-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {userMenuOpen && (
                <div className="user-menu-popover" role="menu">
                  <button className="user-menu-item" type="button" role="menuitem" onClick={openSettings}>
                    {copy.menuSettings}
                  </button>
                  <button className="user-menu-item" type="button" role="menuitem" onClick={() => void handleOpenBilling('billing')}>
                    {copy.menuBilling}
                  </button>
                  <button className="user-menu-item danger" type="button" role="menuitem" onClick={() => void signOut()}>
                    {copy.menuLogout}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {message && <div className="global-message">{message}</div>}

        <div className="studio-layout">
          <section className="workspace">
            {!currentProject ? (
              <section className="feature-launch-panel">
                <div className="feature-launch-head">
                  <div>
                    <p>选择最贴合您拍摄场景的修图功能。每张功能卡片对应一条经过调校的处理流程，所需积分实时显示。</p>
                  </div>
                </div>
                <div className="feature-card-grid">
                  {visibleStudioFeatures.map((feature) => {
                    const locked = feature.status === 'locked';
                    return (
                      <button
                        key={feature.id}
                        className={`studio-feature-card tone-${feature.tone}${locked ? ' locked' : ''}`}
                        type="button"
                        onClick={() => openFeatureProjectDialog(feature)}
                        disabled={locked}
                      >
                        <div className="studio-feature-visual">
                          {feature.beforeImage && feature.afterImage ? (
                            <>
                              <img className="studio-feature-before" src={feature.beforeImage} alt="" loading="lazy" decoding="async" />
                              <img className="studio-feature-after" src={feature.afterImage} alt="" loading="lazy" decoding="async" />
                              <span className="studio-feature-scanline" aria-hidden="true" />
                            </>
                          ) : (
                            <span className="studio-feature-gradient" aria-hidden="true" />
                          )}
                          <span className="studio-feature-tag">{feature.tag[locale]}</span>
                          {locked && <span className="studio-feature-lock">建设中</span>}
                        </div>
                        <div className="studio-feature-body">
                          <strong>{feature.title[locale]}</strong>
                          <p>{feature.description[locale]}</p>
                          <div className="studio-feature-meta">
                            <em>{feature.pointLabel[locale]}</em>
                            <span className="studio-feature-use">{locale === 'en' ? 'Use' : '去使用'}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="feature-launch-note">
                  <strong>{availableFeatureCount}</strong>
                  <span>个功能可用，更多功能正在接入。</span>
                </div>
              </section>
            ) : (
              <>
                <section className="panel project-head-card">
                  <div className="project-head-copy">
                    <span className="muted">{copy.currentProject}</span>
                    <div className="project-head-title-row">
                      <h2>{currentProject.name}</h2>
                      {!isDemoMode && (
                        <button
                          className="ghost-button compact project-head-back"
                          type="button"
                          onClick={returnToStudioFeatureCards}
                        >
                          {locale === 'en' ? 'Back to tools' : '返回功能卡片'}
                        </button>
                      )}
                      {!isDemoMode && (
                        <button className="ghost-button compact project-head-rename" type="button" onClick={() => void handleRenameProject(currentProject)}>
                          {copy.rename}
                        </button>
                      )}
                    </div>
                    <p>{currentProject.address || copy.addressFallback}</p>
                  </div>
                  <div className="project-meta">
                    <span className="meta-pill">{formatPhotoCount(currentProject.photoCount, locale)}</span>
                    <span className="meta-pill">{formatGroupCount(currentProject.groupCount, locale)}</span>
                    {!isDemoMode && <span className="meta-pill">{getProjectStatusLabel(currentProject, locale)}</span>}
                  </div>
                </section>

                <section className="panel steps-panel">
                  <div className="panel-head stacked">
                     <strong>{copy.processFlow}</strong>
                  </div>
                  <div className="step-strip">
                    {activeStepLabels.map((label, index) => {
                      const step = (index + 1) as 1 | 2 | 3 | 4;
                      const clickable = currentProject.status !== 'completed' && step <= getMaxNavigableStep(currentProject);
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`step-card${currentProject.currentStep === step ? ' active' : ''}${currentProject.currentStep > step ? ' done' : ''}${clickable ? ' enabled' : ''}`}
                          onClick={() => void handleStepClick(step)}
                          disabled={!clickable}
                        >
                          <span>{index + 1}</span>
                          <strong>{label}</strong>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {showProcessingStepContent && !isDemoMode && (
                  <section className="panel processing-panel">
                    <div className="processing-copy">
                       <strong>{processingPanelTitle}</strong>
                       <span>{processingPanelDetail}</span>
                    </div>
                    <div className="processing-stats">
                      <div className="metric-box">
                         <span>{copy.estimatedPoints}</span>
                        <strong>{workspacePointsEstimate}</strong>
                      </div>
                      {showRetryProcessingAction && (
                        <button className="ghost-button compact" type="button" onClick={() => void handleStartProcessing({ retryFailed: true })} disabled={busy}>
                          {copy.retryProcessing}
                        </button>
                      )}
                      {showProcessingUploadProgress && (
                        <>
                          <button className="ghost-button compact" type="button" onClick={uploadPaused ? handleResumeUpload : handlePauseUpload}>
                            {uploadPaused ? (locale === 'en' ? 'Resume upload' : '继续上传') : (locale === 'en' ? 'Pause upload' : '暂停上传')}
                          </button>
                          <button className="ghost-button compact" type="button" onClick={handleCancelUpload}>
                            {locale === 'en' ? 'Cancel upload' : '取消上传'}
                          </button>
                        </>
                      )}
                      {showResumeUploadAction && (
                        <button className="solid-button small" type="button" onClick={() => void handleStartProcessing()} disabled={busy}>
                          {locale === 'en' ? 'Resume upload' : '继续上传'}
                        </button>
                      )}
                    </div>
                    <div className="progress-bar">
                      <span style={{ width: `${getProjectProgress(currentProject, uploadPercent)}%` }} />
                    </div>
                  </section>
                )}

                {showUploadStepContent && !isDemoMode && (
                  <section
                    className={`panel upload-dropzone${dragActive ? ' drag-active' : ''}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleUpload(event.dataTransfer.files);
                    }}
                  >
                    <div>
                      <strong>{copy.uploadPhotos}</strong>
                      <p>{copy.uploadPhotosHint}</p>
                    </div>
                    <div className="upload-actions">
                      <button className="solid-button" type="button" onClick={triggerFilePicker}>
                        {copy.selectPhotos}
                      </button>
                      {showUploadProgress && (
                        <span className="meta-pill">{uploadProgressLabel}</span>
                      )}
                    </div>
                    {showUploadProgress && (
                      <div className="upload-progress-inline" aria-live="polite">
                        <div className="upload-progress-bar">
                          <span style={{ width: `${uploadProgressWidth}%` }} />
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {showReviewStepContent && (
                  <>
                    {isDemoMode && (
                      <section className="panel demo-toolbar-panel">
                        <div className="demo-toolbar-actions">
                          <button className="ghost-button compact" type="button">{copy.demoVerticalFix}</button>
                          <button className="ghost-button compact" type="button">{copy.demoCheckGrouping}</button>
                          <button className="ghost-button compact" type="button">{copy.demoAdjustGrouping}</button>
                        </div>
                        <button className="solid-button small demo-send-button" type="button">{copy.sendToProcess}</button>
                      </section>
                    )}

                    <section className="panel review-panel">
                      {!isDemoMode && (
                        <div className="panel-head">
                          <div>
                            <strong>{showProcessingGroupGrid ? copy.processingGroupsTitle : copy.reviewGrouping}</strong>
                            <span className="muted">{showProcessingGroupGrid ? copy.processingGroupsHint : copy.reviewGroupingHint}</span>
                          </div>
                          {showReviewActions && (
                            <div className="review-actions">
                              {showAdvancedGroupingControls && (
                                <button className="ghost-button small" type="button" onClick={() => void handleCreateGroup()}>
                                  {copy.createGroup}
                                </button>
                              )}
                              <button
                                className="ghost-button small"
                                type="button"
                                onClick={triggerFilePicker}
                                disabled={busy || uploadActive}
                              >
                                {copy.addPhotos}
                              </button>
                              <button
                                className="solid-button small"
                                type="button"
                                onClick={() => void handleStartProcessing()}
                                disabled={busy || !workspaceHdrItems.length}
                              >
                                {showReviewUploadProgress ? copy.uploadOriginalsTitle : copy.confirmSend}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {!isDemoMode && (showReviewLocalImportProgress || showReviewUploadProgress) && (
                        <div className="review-upload-status" aria-live="polite">
                          <div>
                            <strong>{showReviewLocalImportProgress ? copy.uploadStarting : copy.uploadOriginalsDoNotClose}</strong>
                            <span>
                              {uploadProgressLabel}
                            </span>
                          </div>
                          <div className="upload-progress-bar">
                            <span style={{ width: `${Math.max(6, uploadProgressWidth)}%` }} />
                          </div>
                          {showReviewUploadProgress && (
                            <>
                              <button className="ghost-button compact" type="button" onClick={uploadPaused ? handleResumeUpload : handlePauseUpload}>
                                {uploadPaused ? (locale === 'en' ? 'Resume upload' : '继续上传') : (locale === 'en' ? 'Pause upload' : '暂停上传')}
                              </button>
                              <button className="ghost-button compact" type="button" onClick={handleCancelUpload}>
                                {locale === 'en' ? 'Cancel upload' : '取消上传'}
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {!isDemoMode && failedUploadFiles.length > 0 && (
                        <div className="review-upload-status" aria-live="polite">
                          <div>
                            <strong>{locale === 'en' ? 'Files waiting for retry' : '等待重试的文件'}</strong>
                            <span>
                              {locale === 'en' ? 'Retry one file at a time before processing starts.' : '处理开始前请逐个重试失败文件。'}
                            </span>
                          </div>
                          {failedUploadFiles.map((file) => (
                            <button
                              key={file.fileIdentity}
                              className="ghost-button compact"
                              type="button"
                              onClick={() => void handleStartProcessing({ retryUploadFileIdentity: file.fileIdentity })}
                              disabled={busy}
                            >
                              {locale === 'en' ? `Retry ${file.fileName}` : `重试 ${file.fileName}`}
                            </button>
                          ))}
                        </div>
                      )}

                      {!isDemoMode && showLocalImportDiagnostics && localDraftDiagnostics && (
                        <div className="local-import-review-notices" aria-live="polite">
                          {localDraftDiagnostics.manualReviewCount > 0 && (
                            <div className="local-import-notice manual-review">
                              {copy.localImportManualReviewNotice(localDraftDiagnostics.manualReviewCount)}
                            </div>
                          )}
                          {localDraftDiagnostics.previewMissingCount > 0 && (
                            <div className="local-import-notice preview-missing">
                              {copy.localImportPreviewMissingNotice(localDraftDiagnostics.previewMissingCount)}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="group-list">
                        {workspaceGroups.map((group) => {
                          const groupItems = getGroupItems(group, workspaceReviewProject ?? { hdrItems: [] });
                          return (
                            <article key={group.id} className="group-card">
                              <div className="group-card-head">
                                <div>
                                  <strong>{group.name}</strong>
                                  <span>
                                    {formatGroupSummary(
                                      groupItems.length,
                                      groupItems.reduce((sum, item) => sum + item.exposures.length, 0),
                                      locale
                                    )}
                                  </span>
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
                                        setGroupColorOverrides((current) => ({ ...current, [group.id]: event.target.value.toUpperCase() }))
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

                              {showAdvancedGroupingControls && group.colorMode === 'replace' && (
                                <p className="group-note">{copy.groupNote}</p>
                              )}

                              <div className="asset-grid">
                                {groupItems.map((hdrItem) => {
                                  const previewUrl = getHdrPreviewUrl(hdrItem);
                                  const selectedExposure = getSelectedExposure(hdrItem);
                                  const selectedIndex = hdrItem.exposures.findIndex((exposure) => exposure.id === hdrItem.selectedExposureId);
                                  const hdrItemProcessing = showProcessingGroupGrid && isHdrItemProcessing(hdrItem.status);
                                  const hdrItemCompleted = showProcessingGroupGrid && hdrItem.status === 'completed';
                                  const hdrItemFailed = showProcessingGroupGrid && hdrItem.status === 'error';
                                  const localReviewState = activeLocalDraft && canEditHdrGrouping ? getHdrLocalReviewState(hdrItem) : null;
                                  const localReviewCopy =
                                    localReviewState && localReviewState !== 'normal'
                                      ? getLocalReviewCopy(localReviewState, locale)
                                      : null;
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
                                            <button
                                              className="asset-delete"
                                              type="button"
                                              onClick={() => void handleDeleteHdr(hdrItem)}
                                            >
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
                                          <button
                                            className="ghost-button compact hdr-split-button"
                                            type="button"
                                            onClick={() => handleSplitLocalHdrItem(hdrItem.id)}
                                          >
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
                    </section>
                  </>
                )}

                {showResultsStepContent && (
                  <section className="panel results-panel">
                    <div className="panel-head">
                      <div>
                        <strong>{copy.results}</strong>
                        <span className="muted">{copy.resultsHint}</span>
                      </div>
                      <div className="results-head-actions">
                        <span className="meta-pill">{formatPhotoCount(currentProject.resultAssets.length, locale)}</span>
                        {showRetryProcessingAction && (
                          <button
                            className="ghost-button compact"
                            type="button"
                            onClick={() => void handleStartProcessing({ retryFailed: true })}
                            disabled={busy}
                          >
                            {copy.retryProcessing}
                          </button>
                        )}
                      </div>
                    </div>
                    {displayResultAssets.length ? (
                      <div className={`result-grid${draggedResultHdrItemId ? ' is-reordering' : ''}`}>
                        {displayResultAssets.map((asset, index) => {
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
                                openViewer(index);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openViewer(index);
                                }
                              }}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', asset.hdrItemId);
                                setDraggedResultHdrItemId(asset.hdrItemId);
                                setResultDragPreview({
                                  projectId: currentProject.id,
                                  orderedHdrItemIds: currentProject.resultAssets.map((item) => item.hdrItemId)
                                });
                              }}
                              onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                if (dragOverResultHdrItemId !== asset.hdrItemId) {
                                  if (draggedResultHdrItemId) {
                                    previewResultReorder(draggedResultHdrItemId, asset.hdrItemId);
                                  }
                                  setDragOverResultHdrItemId(asset.hdrItemId);
                                }
                              }}
                              onDragLeave={() => {
                                if (dragOverResultHdrItemId === asset.hdrItemId) {
                                  setDragOverResultHdrItemId(null);
                                }
                              }}
                              onDragEnd={() => {
                                setDraggedResultHdrItemId(null);
                                setDragOverResultHdrItemId(null);
                                setResultDragPreview(null);
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const sourceHdrItemId = draggedResultHdrItemId || event.dataTransfer.getData('text/plain');
                                if (sourceHdrItemId) {
                                  void handleReorderResults(sourceHdrItemId, asset.hdrItemId);
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
                                        onClick={() => void handlePickResultColor(asset)}
                                        disabled={isRegenerating}
                                        title={copy.colorDropper}
                                        aria-label={copy.colorDropper}
                                      >
                                        <span className="result-card-eyedropper-swatch" style={{ background: normalizedSelectedColor }} />
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
                                        onChange={(event) =>
                                          setResultColorCards((current) => ({
                                            ...current,
                                            [asset.hdrItemId]: normalizeHexDraft(event.target.value)
                                          }))
                                        }
                                        onBlur={(event) => {
                                          const normalized = normalizeHex(event.target.value);
                                          if (normalized) {
                                            setResultColorCards((current) => ({
                                              ...current,
                                              [asset.hdrItemId]: normalized
                                            }));
                                          }
                                        }}
                                        placeholder="#F2E8D8"
                                        disabled={isRegenerating}
                                      />
                                      <button
                                        className="result-regenerate-button"
                                        type="button"
                                        onClick={() => void handleRegenerateResult(asset)}
                                        disabled={isRegenerating}
                                        title={`${copy.regenerateResultHint} ${projectFreeRegenerationsRemaining}/${currentProjectRegenerationUsage.freeLimit}`}
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
                    {hasFailedResultHdrItems && (
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
                )}
              </>
            )}
          </section>
        </div>

        <input
          ref={fileInputRef}
          hidden
          multiple
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void handleUpload(files);
          }}
        />
      </main>

      {studioGuideOpen && activeStudioGuideStep && (
        <div className="modal-backdrop studio-guide-backdrop" onClick={closeStudioGuide}>
          <section className="studio-guide-card" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
            <div className="studio-guide-head">
              <div>
                <span>{copy.studioGuideStepCount(safeStudioGuideStep + 1, studioGuideSteps.length)}</span>
                <strong>{copy.studioGuideTitle}</strong>
                <p>{copy.studioGuideSubtitle}</p>
              </div>
              <button className="close-button" type="button" onClick={closeStudioGuide} aria-label={copy.close}>
                ×
              </button>
            </div>

            <div className="studio-guide-meter" aria-hidden="true">
              <span style={{ width: `${((safeStudioGuideStep + 1) / studioGuideSteps.length) * 100}%` }} />
            </div>

            <div className="studio-guide-body">
              <div className="studio-guide-step-number">{String(safeStudioGuideStep + 1).padStart(2, '0')}</div>
              <div>
                <h3>{activeStudioGuideStep.title}</h3>
                <p>{activeStudioGuideStep.body}</p>
              </div>
            </div>

            <div className="studio-guide-step-list" aria-label={copy.studioGuideTitle}>
              {studioGuideSteps.map((step, index) => (
                <button
                  key={step.id}
                  className={`studio-guide-step-pill${index === safeStudioGuideStep ? ' active' : ''}`}
                  type="button"
                  onClick={() => setStudioGuideStep(index)}
                >
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                </button>
              ))}
            </div>

            <div className="studio-guide-actions">
              <button className="ghost-button" type="button" onClick={dismissStudioGuide}>
                {copy.studioGuideDontShow}
              </button>
              <div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setStudioGuideStep((current) => Math.max(0, current - 1))}
                  disabled={safeStudioGuideStep === 0}
                >
                  {copy.studioGuidePrev}
                </button>
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => {
                    if (safeStudioGuideStep >= studioGuideSteps.length - 1) {
                      closeStudioGuide();
                      return;
                    }
                    setStudioGuideStep((current) => Math.min(studioGuideSteps.length - 1, current + 1));
                  }}
                >
                  {safeStudioGuideStep >= studioGuideSteps.length - 1 ? copy.studioGuideDone : copy.studioGuideNext}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {billingOpen && (
        <div className="modal-backdrop" onClick={() => !billingBusy && setBillingOpen(false)}>
          <div className="modal-card billing-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{billingModalMode === 'topup' ? copy.rechargeTitle : copy.billingTitle}</strong>
                <span className="muted">{billingModalMode === 'topup' ? copy.rechargeHint : copy.billingHint}</span>
              </div>
              <button className="close-button" type="button" onClick={() => setBillingOpen(false)} disabled={billingBusy}>
                ×
              </button>
            </div>

            <div className="billing-summary-grid">
              <article className="billing-stat-card">
                <span>{copy.billingCurrentBalance}</span>
                <strong>{billingSummary?.availablePoints ?? 0} pts</strong>
              </article>
              <article className="billing-stat-card">
                <span>{copy.billingTopUpTotal}</span>
                <strong>{formatUsd(billingSummary?.totalTopUpUsd ?? 0, locale)}</strong>
              </article>
              <article className="billing-stat-card">
                <span>{copy.billingChargedTotal}</span>
                <strong>{billingSummary?.totalChargedPoints ?? 0} pts</strong>
              </article>
            </div>

            {billingModalMode === 'billing' && latestPaidStripeOrder && (
              <div className="stripe-success-panel">
                <div className="stripe-success-copy">
                  <span className="stripe-badge">Stripe</span>
                  <strong>{copy.stripePaymentSuccessTitle}</strong>
                  <span>{copy.stripePaymentSuccessBody}</span>
                  <em>
                    {formatUsd(latestPaidStripeOrder.amountUsd, locale)} · {latestPaidStripeOrder.points} pts ·{' '}
                    {formatDate(latestPaidStripeOrder.paidAt ?? latestPaidStripeOrder.createdAt, locale)}
                  </em>
                </div>
                {renderStripeDocumentLinks(latestPaidStripeOrder)}
              </div>
            )}

            <div className="billing-recharge-bar">
              <div>
                <strong>{copy.billingOpenRecharge}</strong>
                <span className="muted">{copy.rechargeHint}</span>
              </div>
              <button className="solid-button small" type="button" onClick={openRecharge} disabled={billingBusy}>
                {copy.billingOpenRecharge}
              </button>
            </div>

            {billingModalMode === 'billing' && (
              <div className="billing-entry-panel">
                <div className="panel-head compact">
                  <div>
                    <strong>{copy.recentBilling}</strong>
                    <span className="muted">{copy.recentBillingHint}</span>
                  </div>
                </div>
                {billingEntries.length ? (
                  <div className="billing-entry-list">
                    {billingEntries.slice(0, 8).map((entry) => {
                      const stripeOrder = billingOrders.find((order) => order.billingEntryId === entry.id && order.status === 'paid');
                      return (
                        <article key={entry.id} className="billing-entry-row">
                          <div>
                            <strong>{entry.note}</strong>
                            <span>{formatDate(entry.createdAt, locale)}</span>
                            {stripeOrder ? renderStripeDocumentLinks(stripeOrder, true) : null}
                          </div>
                          <div className={`billing-entry-amount ${entry.type === 'credit' ? 'credit' : 'charge'}`}>
                            <strong>
                              {entry.type === 'credit' ? '+' : '-'}
                              {entry.points} pts
                            </strong>
                            <span>{formatUsd(entry.amountUsd, locale)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state billing-empty-state">
                    <strong>{copy.noBilling}</strong>
                    <span>{copy.noBillingHint}</span>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setBillingOpen(false)} disabled={billingBusy}>
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {rechargeOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (billingBusy) {
              return;
            }
            setRechargeOpen(false);
            setRechargeMessage('');
          }}
        >
          <div className="modal-card recharge-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{copy.rechargeTitle}</strong>
                <span className="muted">{copy.rechargeHint}</span>
              </div>
              <button
                className="close-button"
                type="button"
                onClick={() => {
                  setRechargeOpen(false);
                  setRechargeMessage('');
                }}
                disabled={billingBusy}
              >
                ×
              </button>
            </div>

            <div className="recharge-offer-panel recharge-compact-panel">
              <label className="recharge-code-field">
                <span>{copy.rechargeCouponLabel}</span>
                <div className="recharge-inline-control">
                  <input
                    value={rechargeActivationCode}
                    onChange={(event) => {
                      setRechargeActivationCode(event.target.value.toUpperCase());
                      if (rechargeMessage) {
                        setRechargeMessage('');
                      }
                    }}
                    placeholder={copy.rechargeCouponPlaceholder}
                    disabled={billingBusy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => void handleRedeemActivationCode()}
                    disabled={billingBusy || !rechargeActivationCode.trim()}
                  >
                    {billingBusy ? copy.authWorking : copy.rechargeRedeemCode}
                  </button>
                </div>
              </label>
              {rechargeMessage && <div className="auth-feedback settings-feedback">{rechargeMessage}</div>}
            </div>

            <div className={`recharge-custom-panel recharge-compact-panel${customRechargeIsActive ? ' active' : ''}`}>
              <label className="recharge-code-field">
                <span>{copy.rechargeCustomLabel}</span>
                <div className="recharge-inline-control">
                  <input
                    value={customRechargeAmount}
                    onChange={(event) => {
                      setCustomRechargeAmount(event.target.value);
                      if (rechargeMessage) {
                        setRechargeMessage('');
                      }
                    }}
                    placeholder={copy.rechargeCustomPlaceholder}
                    disabled={billingBusy}
                    inputMode="decimal"
                  />
                  <span className="recharge-inline-preview">
                    {customRechargeAmountUsd ? `${customRechargePoints} pts` : copy.rechargeCustomTitle}
                  </span>
                </div>
              </label>
            </div>

            <div className="billing-package-grid recharge-package-grid">
              {billingPackages.map((billingPackage) => (
                <button
                  key={billingPackage.id}
                  className={`billing-package-card recharge-package-card${!customRechargeIsActive && activeBillingPackageId === billingPackage.id ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setCustomRechargeAmount('');
                    setSelectedBillingPackageId(billingPackage.id);
                  }}
                  disabled={billingBusy}
                >
                  <div className="recharge-package-head">
                    <span>{billingPackage.name}</span>
                    <em>{copy.rechargeSave} {billingPackage.discountPercent}%</em>
                  </div>
                  <strong className="recharge-package-points">{billingPackage.points} pts</strong>
                </button>
              ))}
            </div>

            {(customRechargeIsActive || selectedBillingPackage) && (
              <div className="recharge-summary-card recharge-compact-summary">
                <div>
                  <strong>{customRechargeIsActive ? copy.rechargeCustomSummary : selectedBillingPackage?.name}</strong>
                  <span className="muted">
                    {customRechargeIsActive
                      ? customRechargeAmountUsd
                        ? `${copy.rechargeYouPay} ${formatUsd(customRechargeAmountUsd, locale)} · ${copy.rechargeReceive} ${customRechargePoints} pts`
                        : copy.rechargeCustomInvalid
                      : `${copy.rechargeYouPay} ${formatUsd(selectedBillingPackage!.amountUsd, locale)} · ${copy.rechargeReceive} ${selectedBillingPackage!.points} pts`}
                  </span>
                  {rechargeActivationCode.trim() && <span className="muted">{copy.rechargeCouponLabel}: {rechargeActivationCode.trim()}</span>}
                </div>
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => void handleTopUp()}
                  disabled={billingBusy || (customRechargeIsActive && customRechargeAmountUsd === null)}
                >
                  {billingBusy ? copy.authWorking : copy.rechargePayNow}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {settingsOpen && session && (
        <div className="modal-backdrop" onClick={() => !settingsBusy && setSettingsOpen(false)}>
          <div className="modal-card settings-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{copy.settingsTitle}</strong>
                <span className="muted">{copy.settingsHint}</span>
              </div>
              <button className="close-button" type="button" onClick={() => setSettingsOpen(false)} disabled={settingsBusy}>
                ×
              </button>
            </div>

            {settingsMessage && <div className="auth-feedback settings-feedback">{settingsMessage}</div>}

            <div className="form-grid">
              <label>
                <span>{copy.settingsDisplayName}</span>
                <input
                  value={settingsDraft.displayName}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, displayName: event.target.value }))}
                  disabled={settingsBusy}
                />
              </label>

              <label>
                <span>{copy.settingsEmail}</span>
                <input value={session.email} disabled readOnly className="settings-readonly" />
                <small className="settings-field-note">{copy.settingsEmailHint}</small>
              </label>

              <div className="settings-language-field">
                <span>{copy.settingsLanguage}</span>
                <div className="language-toggle">
                  <button
                    className={`language-option${settingsDraft.locale === 'zh' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setSettingsDraft((current) => ({ ...current, locale: 'zh' }))}
                    disabled={settingsBusy}
                  >
                    {copy.chinese}
                  </button>
                  <button
                    className={`language-option${settingsDraft.locale === 'en' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setSettingsDraft((current) => ({ ...current, locale: 'en' }))}
                    disabled={settingsBusy}
                  >
                    {copy.english}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setSettingsOpen(false)} disabled={settingsBusy}>
                {copy.cancel}
              </button>
              <button className="solid-button" type="button" onClick={() => void handleSaveSettings()} disabled={settingsBusy}>
                {settingsBusy ? copy.authWorking : copy.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {createDialogOpen && (
        <div className="modal-backdrop" onClick={closeCreateProjectDialog}>
          <div className="modal-card feature-create-modal" onClick={(event) => event.stopPropagation()}>
            <button className="feature-create-close" type="button" onClick={closeCreateProjectDialog} aria-label={copy.close}>
              ×
            </button>

            <section className={`feature-create-summary tone-${selectedFeature.tone}`}>
              <div className="feature-create-icon" aria-hidden="true">
                {selectedFeature.beforeImage && selectedFeature.afterImage ? (
                  <>
                    <img src={selectedFeature.beforeImage} alt="" decoding="async" />
                    <img src={selectedFeature.afterImage} alt="" decoding="async" />
                  </>
                ) : (
                  <span />
                )}
              </div>
              <div>
                <strong>{selectedFeature.title[locale]}</strong>
                <span>{selectedFeature.detail[locale]}</span>
              </div>
            </section>

            <div className="feature-create-body">
              <div className="feature-create-title">
                <h2>{locale === 'en' ? 'Project name' : '设置项目名称'}</h2>
                <p>{locale === 'en' ? 'Name this project and upload the photos that need processing.' : '为这个项目命名，并上传需要处理的照片。'}</p>
              </div>

              <label className="feature-create-field">
                <span>{copy.projectName}</span>
                <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder={selectedFeature.defaultName[locale]} />
              </label>

              <label className="feature-create-field feature-create-priority">
                <span>{locale === 'en' ? 'Processing priority' : '处理优先级'}</span>
                <select defaultValue="standard" aria-label={locale === 'en' ? 'Processing priority' : '处理优先级'}>
                  <option value="standard">{locale === 'en' ? 'Standard (starts within 10 minutes)' : '标准（10 分钟内开始）'}</option>
                  <option value="normal">{locale === 'en' ? 'Normal queue' : '普通队列'}</option>
                </select>
              </label>

              <div
                className={`feature-create-dropzone${createDialogDragActive ? ' drag-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => createFileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    createFileInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setCreateDialogDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setCreateDialogDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setCreateDialogDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setCreateDialogDragActive(false);
                  handleCreateDialogFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={createFileInputRef}
                  type="file"
                  multiple
                  accept={IMPORT_FILE_ACCEPT}
                  onChange={(event) => {
                    handleCreateDialogFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <span className="feature-create-upload-arrow" aria-hidden="true">↑</span>
                <strong>{locale === 'en' ? 'Drag RAW / JPG here, or click to choose files' : '拖拽 RAW / JPG 到这里，或点击选择文件'}</strong>
                <em>{locale === 'en' ? 'Supports ARW, CR2, CR3, NEF, RAF, DNG, JPG · up to 2 GB per file' : '支持 ARW、CR2、CR3、NEF、RAF、DNG、JPG · 单张最大 2 GB'}</em>
              </div>

              {createDialogFiles.length > 0 && (
                <div className="feature-create-selected-files" aria-live="polite">
                  <strong>{locale === 'en' ? `${createDialogFiles.length} files selected` : `已选择 ${createDialogFiles.length} 张照片`}</strong>
                  <span>
                    {createDialogFiles.slice(0, 3).map((file) => file.name).join(' · ')}
                    {createDialogFiles.length > 3 ? ' · ...' : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="modal-actions feature-create-actions">
              <button className="ghost-button" type="button" onClick={closeCreateProjectDialog} disabled={busy}>
                {copy.cancel}
              </button>
              <button className="solid-button" type="button" onClick={() => void handleCreateProject()} disabled={busy}>
                {busy ? copy.authWorking : locale === 'en' ? 'Create project and start' : '创建项目并开始'}
              </button>
            </div>
          </div>
        </div>
      )}

      {downloadDialogProjectId && downloadProject && (
        <div className="modal-backdrop" onClick={() => closeDownloadDialog()}>
          <div className="modal-card download-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>{copy.downloadSettings}</strong>
                <span className="muted">{downloadProject.name}</span>
              </div>
              <button className="close-button" type="button" onClick={() => closeDownloadDialog()} disabled={downloadBusy}>
                ×
              </button>
            </div>

            <div className="form-grid download-grid">
              <label>
                <span>{copy.downloadFolderMode}</span>
                <select
                  value={downloadDraft.folderMode}
                  onChange={(event) =>
                    setDownloadDraft((current) => ({
                      ...current,
                      folderMode: event.target.value as DownloadDraft['folderMode']
                    }))
                  }
                  disabled={downloadBusy}
                >
                  <option value="grouped">{copy.downloadFolderGrouped}</option>
                  <option value="flat">{copy.downloadFolderFlat}</option>
                </select>
              </label>

              <label>
                <span>{copy.downloadNamingMode}</span>
                <select
                  value={downloadDraft.namingMode}
                  onChange={(event) =>
                    setDownloadDraft((current) => ({
                      ...current,
                      namingMode: event.target.value as DownloadDraft['namingMode']
                    }))
                  }
                  disabled={downloadBusy}
                >
                  <option value="sequence">{copy.downloadNamingSequence}</option>
                  <option value="original">{copy.downloadNamingOriginal}</option>
                  <option value="custom-prefix">{copy.downloadNamingCustomPrefix}</option>
                </select>
              </label>

              {downloadDraft.namingMode === 'custom-prefix' && (
                <label>
                  <span>{copy.downloadCustomPrefix}</span>
                  <input
                    value={downloadDraft.customPrefix}
                    onChange={(event) =>
                      setDownloadDraft((current) => ({
                        ...current,
                        customPrefix: event.target.value
                      }))
                    }
                    placeholder="metrovan"
                    disabled={downloadBusy}
                  />
                </label>
              )}
            </div>

            <div className="download-variants">
              <label className="download-variant-row">
                <input
                  type="checkbox"
                  checked={downloadDraft.includeHd}
                  onChange={(event) =>
                    setDownloadDraft((current) => ({
                      ...current,
                      includeHd: event.target.checked
                    }))
                  }
                  disabled={downloadBusy}
                />
                <div>
                  <strong>{copy.downloadHdTitle}</strong>
                  <span>{copy.downloadHdHint}</span>
                </div>
              </label>

              <label className="download-variant-row">
                <input
                  type="checkbox"
                  checked={downloadDraft.includeCustom}
                  onChange={(event) =>
                    setDownloadDraft((current) => ({
                      ...current,
                      includeCustom: event.target.checked
                    }))
                  }
                  disabled={downloadBusy}
                />
                <div>
                  <strong>{copy.downloadCustomTitle}</strong>
                  <span>{copy.downloadCustomHint}</span>
                </div>
              </label>

              {downloadDraft.includeCustom && (
                <div className="form-grid download-custom-grid">
                  <label>
                    <span>{copy.downloadFolderLabel}</span>
                    <input
                      value={downloadDraft.customLabel}
                      onChange={(event) =>
                        setDownloadDraft((current) => ({
                          ...current,
                          customLabel: event.target.value
                        }))
                      }
                      placeholder="Custom"
                      disabled={downloadBusy}
                    />
                  </label>
                  <label>
                    <span>{copy.downloadLongEdge}</span>
                    <input
                      value={downloadDraft.customLongEdge}
                      onChange={(event) =>
                        setDownloadDraft((current) => ({
                          ...current,
                          customLongEdge: event.target.value
                        }))
                      }
                      placeholder="3000"
                      disabled={downloadBusy}
                    />
                  </label>
                  <label>
                    <span>{copy.downloadWidth}</span>
                    <input
                      value={downloadDraft.customWidth}
                      onChange={(event) =>
                        setDownloadDraft((current) => ({
                          ...current,
                          customWidth: event.target.value
                        }))
                      }
                      placeholder="2048"
                      disabled={downloadBusy}
                    />
                  </label>
                  <label>
                    <span>{copy.downloadHeight}</span>
                    <input
                      value={downloadDraft.customHeight}
                      onChange={(event) =>
                        setDownloadDraft((current) => ({
                          ...current,
                          customHeight: event.target.value
                        }))
                      }
                      placeholder="1365"
                      disabled={downloadBusy}
                    />
                  </label>
                </div>
              )}
            </div>

            <p className="download-note">{copy.downloadNote}</p>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => closeDownloadDialog()} disabled={downloadBusy}>
                {copy.cancel}
              </button>
              <button className="solid-button" type="button" onClick={() => void handleConfirmDownload()} disabled={downloadBusy}>
                {downloadBusy ? copy.downloadGenerating : copy.downloadGenerate}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentViewerAsset && (
        <div className="viewer-backdrop result-editor-backdrop" onClick={() => setResultViewerIndex(null)}>
          <div className="result-editor-shell" onClick={(event) => event.stopPropagation()}>
            <header className="result-editor-topbar">
              <div className="result-editor-title">
                <strong>{currentViewerAsset.fileName}</strong>
                <span>
                  {currentProject?.name ?? 'Metrovan AI'} · {(safeViewerIndex ?? 0) + 1}/{viewerAssets.length}
                </span>
              </div>
              <div className="result-editor-actions">
                <button className="result-editor-deliver" type="button" onClick={() => setResultViewerIndex(null)}>
                  Deliver
                </button>
                <button className="result-editor-icon-button" type="button" onClick={() => void downloadViewerAsset(currentViewerAsset)}>
                  ↓
                </button>
                <button
                  className="result-editor-icon-button"
                  type="button"
                  onClick={() => resetResultEditorSettings(currentViewerAsset.id)}
                >
                  ↺
                </button>
                <button className="result-editor-icon-button" type="button" onClick={() => setResultViewerIndex(null)}>
                  ×
                </button>
              </div>
            </header>

            <div className="result-editor-main">
              <section className="result-editor-stage">
                {viewerAssets.length > 1 && (
                  <button className="viewer-arrow large left result-editor-nav" type="button" onClick={() => shiftViewer(-1)}>
                    {'<'}
                  </button>
                )}
                <div
                  className={`result-editor-canvas crop-adjustable${currentViewerAspectRatio ? ' cropped' : ''}`}
                  ref={resultCanvasRef}
                  style={currentViewerAspectRatio ? { aspectRatio: currentViewerAspectRatio } : undefined}
                  onPointerDown={startResultCropDrag}
                  onPointerMove={moveResultCropDrag}
                  onPointerUp={endResultCropDrag}
                  onPointerCancel={endResultCropDrag}
                  onWheel={zoomResultCrop}
                >
                  <img
                    src={resolveMediaUrl(currentViewerAsset.storageUrl)}
                    alt={currentViewerAsset.fileName}
                    style={buildResultEditorImageStyle(currentViewerSettings)}
                    decoding="async"
                    draggable={false}
                  />
                  <div
                    className="result-editor-crop-frame"
                    style={buildResultCropFrameStyle(currentViewerSettings)}
                    onPointerDown={(event) => startResultCropFrameDrag(event, 'move')}
                  >
                    <span className="result-editor-crop-grid" aria-hidden="true" />
                    {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                      <span
                        key={handle}
                        className={`result-editor-crop-handle ${handle}`}
                        onPointerDown={(event) => startResultCropFrameDrag(event, handle)}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
                {viewerAssets.length > 1 && (
                  <button className="viewer-arrow large right result-editor-nav" type="button" onClick={() => shiftViewer(1)}>
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
                      onClick={() => void handleRegenerateResult(currentViewerAsset)}
                      disabled={currentViewerIsRegenerating}
                      title={`${copy.regenerateResultHint} ${projectFreeRegenerationsRemaining}/${currentProjectRegenerationUsage.freeLimit}`}
                    >
                      {currentViewerIsRegenerating ? copy.regeneratingResult : copy.regenerateResult}
                    </button>
                  </div>

                  <div className="result-editor-color-input-row">
                    <button
                      className="result-editor-eyedropper"
                      type="button"
                      onClick={() => void handlePickResultColor(currentViewerAsset)}
                      disabled={currentViewerIsRegenerating}
                      title={copy.colorDropper}
                    >
                      <span style={{ background: currentViewerNormalizedColor }} />
                      <b>⌖</b>
                    </button>
                    <label>
                      <span>{copy.colorCardNo}</span>
                      <input
                        type="text"
                        inputMode="text"
                        value={currentViewerSelectedColor}
                        onChange={(event) =>
                          setResultColorCards((current) => ({
                            ...current,
                            [currentViewerAsset.hdrItemId]: normalizeHexDraft(event.target.value)
                          }))
                        }
                        onBlur={(event) => {
                          const normalized = normalizeHex(event.target.value);
                          if (normalized) {
                            applyResultColorCard(currentViewerAsset, normalized);
                          }
                        }}
                        placeholder="#F2E8D8"
                        maxLength={7}
                      />
                    </label>
                    <button
                      className="result-editor-save-card"
                      type="button"
                      onClick={() => saveResultColorCard(currentViewerAsset)}
                    >
                      {copy.saveColorCard}
                    </button>
                  </div>

                  <div className="result-editor-color-cards">
                    {availableResultColorCards.map((card) => {
                      const isActive = card.color.toUpperCase() === currentViewerNormalizedColor;
                      return (
                        <div
                          className={`result-editor-color-card${isActive ? ' active' : ''}${
                            card.source === 'saved' ? ' saved' : ''
                          }`}
                          key={card.id}
                        >
                          <button type="button" onClick={() => applyResultColorCard(currentViewerAsset, card.color)}>
                            <span style={{ background: card.color }} />
                            <strong>{card.label}</strong>
                            <em>{card.color}</em>
                          </button>
                          {card.source === 'saved' && (
                            <button
                              className="result-editor-color-card-delete"
                              type="button"
                              onClick={() => deleteResultColorCard(card)}
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
                            value={currentViewerSettings[control.key]}
                            onChange={(event) =>
                              updateResultEditorSettings(currentViewerAsset.id, {
                                [control.key]: clampEditorValue(Number(event.target.value), control.min, control.max)
                              })
                            }
                          />
                          <output>{currentViewerSettings[control.key]}</output>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="result-editor-section">
                  <h3>ASPECT RATIO</h3>
                  <div className="result-aspect-grid">
                    {RESULT_EDITOR_ASPECT_RATIOS.map((aspectRatio) => (
                      <button
                        key={aspectRatio.value}
                        type="button"
                        className={currentViewerSettings.aspectRatio === aspectRatio.value ? 'active' : ''}
                        onClick={() => updateResultAspectRatio(currentViewerAsset.id, aspectRatio.value)}
                      >
                        {aspectRatio.label}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

            </div>

            {viewerAssets.length > 1 && (
              <div className="result-editor-filmstrip">
                {viewerAssets.map((asset: ResultAsset, index) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={`viewer-thumb${index === safeViewerIndex ? ' active' : ''}`}
                    onClick={() => setResultViewerIndex(index)}
                  >
                    <img src={resolveMediaUrl(asset.previewUrl ?? asset.storageUrl)} alt={asset.fileName} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
