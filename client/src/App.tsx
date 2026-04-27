import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { startTransition, useLayoutEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import logoFull from './assets/metrovan-logo-full.png';
import logoMark from './assets/metrovan-logo-mark.png';
import jinSignatureAvatar from './assets/jin-signature-avatar.jpg';
import showcaseInteriorAfter from './assets/showcase-interior-after.jpg';
import showcaseInteriorBefore from './assets/showcase-interior-before.jpg';
import {
  IMPORT_FILE_ACCEPT,
  buildLocalImportDraft,
  deleteStoredLocalImportDraft,
  filterSupportedImportFiles,
  persistLocalImportDraft,
  restoreStoredLocalImportDraft,
  revokeLocalImportDraftUrls,
  type LocalExposureDraft,
  type LocalHdrItemDraft,
  type LocalImportDraft
} from './local-import';
import {
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
  fetchAdminSettings,
  fetchAdminUserDetail,
  fetchAdminUsers,
  fetchAuthProviders,
  fetchBilling,
  fetchProject,
  fetchProjects,
  fetchSession,
  getApiRoot,
  loginWithEmail,
  logoutSession,
  moveHdrItem,
  patchProject,
  reorderResults,
  registerWithEmail,
  redeemActivationCode,
  requestPasswordReset,
  regenerateResult,
  selectExposure,
  startProcessing,
  updateAccountSettings,
  updateAdminActivationCode,
  updateAdminSettings,
  updateAdminUser,
  updateGroup,
  uploadFiles,
  logoutAdminUserSessions
} from './api';
import type {
  AdminActivationCode,
  AdminAuditLogEntry,
  AdminSystemSettings,
  AdminUserListQuery,
  AdminUserSummary,
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
  ProjectGroup,
  ProjectJobState,
  ProjectRecord,
  ResultAsset,
  SceneType
} from './types';

type AuthMode = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify-email';
type UiLocale = 'zh' | 'en';
type AppRoute = 'home' | 'studio' | 'admin';

const MAX_RUNPOD_HDR_BATCH_SIZE = 100;
const MIN_RUNPOD_HDR_BATCH_SIZE = 10;
const LOCAL_HDR_GROUP_UPLOAD_CONCURRENCY = 4;

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
const LANDING_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4';
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
    billingOpenRecharge: '去充值',
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

function isStudioGuideDismissed(session: SessionState) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(getStudioGuideStorageKey(session)) === '1';
  } catch {
    return false;
  }
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

function generateActivationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomValues = new Uint32Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    for (let index = 0; index < randomValues.length; index += 1) {
      randomValues[index] = Math.floor(Math.random() * alphabet.length);
    }
  }

  const code = Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('');
  return `BETA-${code.slice(0, 4)}-${code.slice(4)}`;
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

  if (snapshot.stage === 'retrying') {
    return copy.uploadRetryProgress(
      snapshot.currentFileName || '',
      snapshot.attempt || 2,
      snapshot.maxAttempts || 3,
      snapshot.uploadedFiles,
      snapshot.totalFiles
    );
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
    hdrItem.resultUrl ??
      selectedExposure?.previewUrl ??
      hdrItem.previewUrl ??
      hdrItem.exposures[0]?.previewUrl ??
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
  return 'home';
}

function getPathForRoute(route: AppRoute) {
  if (route === 'admin') return '/admin';
  if (route === 'studio') return '/studio';
  return '/home';
}

function attemptLandingVideoPlayback(video: HTMLVideoElement | null) {
  if (!video) {
    return;
  }

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', 'true');

  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    void playPromise.catch(() => {
      // Mobile browsers sometimes defer autoplay until the page is visible or touched once.
    });
  }
}

function ShowcaseCornerFrame() {
  return (
    <>
      <div className="showcase-sci-corner showcase-sci-corner-top-left" />
      <div className="showcase-sci-corner showcase-sci-corner-top-right" />
      <div className="showcase-sci-corner showcase-sci-corner-bottom-left" />
      <div className="showcase-sci-corner showcase-sci-corner-bottom-right" />
    </>
  );
}

function ShowcaseIconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function ShowcaseIconCheck() {
  return (
    <ShowcaseIconBase>
      <path d="m5 13 4 4L19 7" />
    </ShowcaseIconBase>
  );
}

function ShowcaseIconCpu() {
  return (
    <ShowcaseIconBase>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </ShowcaseIconBase>
  );
}

function ShowcaseIconSparkles() {
  return (
    <ShowcaseIconBase>
      <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />
      <path d="m18.5 15.5.8 1.8 1.7.7-1.7.8-.8 1.7-.7-1.7-1.8-.8 1.8-.7.7-1.8Z" />
    </ShowcaseIconBase>
  );
}

function ShowcaseIconSunMedium() {
  return (
    <ShowcaseIconBase>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
    </ShowcaseIconBase>
  );
}

function ShowcaseIconShieldCheck() {
  return (
    <ShowcaseIconBase>
      <path d="M12 3 6 5.7v5.1c0 4.1 2.5 7.8 6 9.2 3.5-1.4 6-5.1 6-9.2V5.7L12 3Z" />
      <path d="m9.2 12.2 2 2 3.7-4" />
    </ShowcaseIconBase>
  );
}

function ShowcaseFeature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="showcase-sci-feature-card">
      <span className="showcase-sci-feature-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{text}</small>
      </div>
    </article>
  );
}

function ShowcaseStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="showcase-sci-status-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const isDemoMode = new URLSearchParams(window.location.search).get('demo') === '1';
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => getRouteFromPath());
  const [landingView, setLandingView] = useState<'home' | 'plans'>('home');
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
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(() => (isDemoMode ? DEMO_BILLING_SUMMARY : null));
  const [billingEntries, setBillingEntries] = useState<BillingEntry[]>(() => (isDemoMode ? DEMO_BILLING_ENTRIES : []));
  const [billingPackages, setBillingPackages] = useState<BillingPackage[]>(() => (isDemoMode ? DEMO_BILLING_PACKAGES : []));
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingModalMode, setBillingModalMode] = useState<'topup' | 'billing'>('billing');
  const [billingBusy, setBillingBusy] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [selectedBillingPackageId, setSelectedBillingPackageId] = useState<string | null>(null);
  const [customRechargeAmount, setCustomRechargeAmount] = useState('');
  const [rechargeActivationCode, setRechargeActivationCode] = useState('');
  const [rechargeMessage, setRechargeMessage] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<{ displayName: string; locale: UiLocale }>({
    displayName: '',
    locale: getStoredLocale()
  });
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminLoaded, setAdminLoaded] = useState(false);
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
  const [adminSystemDraft, setAdminSystemDraft] = useState({ runpodHdrBatchSize: '10' });
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
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [downloadDialogProjectId, setDownloadDialogProjectId] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadDraft, setDownloadDraft] = useState<DownloadDraft>(DEFAULT_DOWNLOAD_DRAFT);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAddress, setNewProjectAddress] = useState('');
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
  const [studioGuideAutoOpenedFor, setStudioGuideAutoOpenedFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const resultLayoutSnapshotRef = useRef<Record<string, DOMRect>>({});
  const resultCropDragRef = useRef<ResultCropDragState | null>(null);
  const resultCropFrameDragRef = useRef<ResultCropFrameDragState | null>(null);
  const resultCanvasRef = useRef<HTMLDivElement | null>(null);
  const landingVideoRef = useRef<HTMLVideoElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const emailVerificationHandledRef = useRef(false);
  const checkoutHandledRef = useRef(false);

  const demoProjects = useMemo(() => createDemoProjects(), []);
  const visibleProjects = isDemoMode ? demoProjects : projects;
  const copy = UI_TEXT[locale];
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
  const currentProject = useMemo(
    () => visibleProjects.find((project) => project.id === currentProjectId) ?? visibleProjects[0] ?? null,
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
  const hasActiveProcessingItems = workspaceHdrItems.some((item) => isHdrItemProcessing(item.status));
  const jobActivelyProcessing = isProjectJobActivelyProcessing(currentProject?.job);
  const jobFailedWhileItemsActive = Boolean(currentProject?.job?.status === 'failed' && (hasActiveProcessingItems || jobActivelyProcessing));
  const showRetryProcessingAction =
    Boolean(currentProject && currentProject.status === 'failed' && !hasActiveProcessingItems && !jobActivelyProcessing) &&
    showProcessingStepContent &&
    !uploadActive;
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
  const showResultsStepContent = currentWorkspaceStep === 4 && hasResultContent;
  const adminTotals = useMemo(
    () => ({
      users: adminTotalUsers || adminUsers.length,
      projects: adminUsers.reduce((sum, user) => sum + user.projectCount, 0),
      photos: adminUsers.reduce((sum, user) => sum + user.photoCount, 0),
      revenue: adminUsers.reduce((sum, user) => sum + user.billingSummary.totalTopUpUsd, 0)
    }),
    [adminTotalUsers, adminUsers]
  );
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
    void persistLocalImportDraft(draft).catch(() => {
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
    void deleteStoredLocalImportDraft(projectId).catch(() => {
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
      void persistLocalImportDraft(updated).catch(() => {
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
    if (activeRoute !== 'studio' || session || !sessionReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAuthMode('signin');
      setAuthOpen(true);
      setAuthMessage('');
      setMessage('');
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeRoute, session, sessionReady]);

  useEffect(() => {
    if (activeRoute !== 'studio' || !session || !sessionReady) {
      return;
    }

    const storageKey = getStudioGuideStorageKey(session);
    if (studioGuideAutoOpenedFor === storageKey || isStudioGuideDismissed(session)) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStudioGuideStep(0);
      setStudioGuideOpen(true);
      setStudioGuideAutoOpenedFor(storageKey);
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activeRoute, session, sessionReady, studioGuideAutoOpenedFor]);

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
          setAdminSystemSettings(response.settings);
          setAdminSystemDraft({ runpodHdrBatchSize: String(response.settings.runpodHdrBatchSize) });
          setAdminSystemLoaded(true);
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
    if (!userMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [userMenuOpen]);

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
      void deleteStoredLocalImportDraft(completedProjectId).catch(() => {
        // Ignore cleanup failures; stale local drafts are overwritten on the next import.
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [currentProject?.id, currentProject?.status, localImportDrafts]);

  function upsertProject(project: ProjectRecord) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setCurrentProjectId(project.id);
  }

  function syncBilling(payload: { summary: BillingSummary; entries: BillingEntry[]; packages: BillingPackage[] }) {
    setBillingSummary(payload.summary);
    setBillingEntries(payload.entries);
    setBillingPackages(payload.packages);
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

  function buildHdrLayoutPayload(draft: LocalImportDraft, uploadedObjects: UploadedObjectReference[] = []) {
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

  async function refreshBilling() {
    if (isDemoMode || !session) {
      return;
    }

    const response = await fetchBilling();
    syncBilling(response);
  }

  useEffect(() => {
    if (session) {
      return;
    }

    const video = landingVideoRef.current;
    if (!video) {
      return;
    }

    const retryPlayback = () => attemptLandingVideoPlayback(video);
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        retryPlayback();
      }
    };

    const frameId = window.requestAnimationFrame(retryPlayback);
    window.addEventListener('pageshow', retryPlayback);
    window.addEventListener('touchstart', retryPlayback, { passive: true });
    window.addEventListener('pointerdown', retryPlayback, { passive: true });
    document.addEventListener('visibilitychange', retryWhenVisible);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('pageshow', retryPlayback);
      window.removeEventListener('touchstart', retryPlayback);
      window.removeEventListener('pointerdown', retryPlayback);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [session]);

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
          navigateToRoute('studio');
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
          return response.items[0]?.id ?? null;
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
    void Promise.all(candidates.map((project) => restoreStoredLocalImportDraft(project.id)))
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
          setRechargeOpen(false);
          setBillingModalMode('billing');
          setBillingOpen(true);
          setCustomRechargeAmount('');
          setRechargeActivationCode('');
          setRechargeMessage('');
          setMessage(copy.topUpSuccess);
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

  function navigateToRoute(nextRoute: AppRoute) {
    const nextPath = getPathForRoute(nextRoute);
    const nextUrl = `${nextPath}${window.location.hash}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextUrl);
    }
    setActiveRoute(nextRoute);
    if (nextRoute === 'home') {
      setLandingView('home');
    }
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

  async function handleAdminSelectUser(userId: string) {
    setAdminSelectedUserId(userId);
    setAdminDetailBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminUserDetail(userId);
      setAdminSelectedUser(response.user);
      setAdminDetailProjects(response.projects);
      setAdminDetailBillingEntries(response.billingEntries);
      setAdminAuditLogs(response.auditLogs);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '用户详情读取失败。', locale));
    } finally {
      setAdminDetailBusy(false);
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
      setAdminSystemSettings(response.settings);
      setAdminSystemDraft({ runpodHdrBatchSize: String(response.settings.runpodHdrBatchSize) });
      setAdminSystemLoaded(true);
      setAdminMessage('系统设置已刷新。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '系统设置读取失败。', locale));
    } finally {
      setAdminSystemBusy(false);
    }
  }

  async function handleAdminSaveSystemSettings() {
    const runpodHdrBatchSize = Number(adminSystemDraft.runpodHdrBatchSize);
    if (
      !Number.isFinite(runpodHdrBatchSize) ||
      runpodHdrBatchSize < MIN_RUNPOD_HDR_BATCH_SIZE ||
      runpodHdrBatchSize > MAX_RUNPOD_HDR_BATCH_SIZE
    ) {
      setAdminMessage(`云处理批量数量必须是 ${MIN_RUNPOD_HDR_BATCH_SIZE} 到 ${MAX_RUNPOD_HDR_BATCH_SIZE}。`);
      return;
    }

    setAdminSystemBusy(true);
    setAdminMessage('');
    try {
      const response = await updateAdminSettings({
        runpodHdrBatchSize: Math.round(runpodHdrBatchSize)
      });
      setAdminSystemSettings(response.settings);
      setAdminSystemDraft({ runpodHdrBatchSize: String(response.settings.runpodHdrBatchSize) });
      setAdminSystemLoaded(true);
      setAdminMessage(`已更新：每个云处理任务 ${response.settings.runpodHdrBatchSize} 组 HDR。`);
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

  async function handleAdminCreateActivationCode() {
    const code = adminActivationDraft.code.trim().toUpperCase();
    const label = adminActivationDraft.label.trim();
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
      const { blob, fileName } = await downloadProjectArchive(downloadProject.id, payload);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      closeDownloadDialog(true);
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.downloadFailed, locale));
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
    setBillingPackages(isDemoMode ? DEMO_BILLING_PACKAGES : []);
    setBillingOpen(false);
    setBillingModalMode('billing');
    setRechargeOpen(false);
    setCustomRechargeAmount('');
    setRechargeActivationCode('');
    setRechargeMessage('');
    setSettingsOpen(false);
    setUserMenuOpen(false);
    setMessage('');
    setAuthMessage('');
    setSettingsMessage('');
    setLocalImportDrafts((current) => {
      Object.values(current).forEach((draft) => revokeLocalImportDraftUrls(draft));
      return {};
    });
    navigateToRoute('home');
  }

  async function handleOpenBilling(mode: 'topup' | 'billing' = 'billing') {
    setUserMenuOpen(false);
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

  function openStudioGuide() {
    setUserMenuOpen(false);
    setStudioGuideStep(0);
    setStudioGuideOpen(true);
  }

  function closeStudioGuide() {
    setStudioGuideOpen(false);
  }

  function dismissStudioGuide() {
    if (session) {
      markStudioGuideDismissed(session);
      setStudioGuideAutoOpenedFor(getStudioGuideStorageKey(session));
    }
    setStudioGuideOpen(false);
  }

  function openRecharge() {
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
        address: newProjectAddress.trim()
      });
      upsertProject(response.project);
      setCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectAddress('');
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
        const remaining = projects.filter((item) => item.id !== project.id);
        return remaining[0]?.id ?? null;
      });
      setMessage('');
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error, copy.deleteProjectFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(files: FileList | File[] | null) {
    if (!currentProject || !files || files.length === 0) return;

    const { supported, unsupported } = filterSupportedImportFiles(Array.from(files));
    if (!supported.length) {
      setMessage(copy.uploadNoSupportedFiles);
      return;
    }

    setBusy(true);
    setUploadActive(true);
    setUploadMode('local');
    setUploadPercent(0);
    setUploadSnapshot(null);
    setDragActive(false);
    try {
      const nextDraft = await buildLocalImportDraft(currentProject.id, supported, setUploadPercent);
      const response = await patchProject(currentProject.id, { currentStep: 2, status: 'review' });
      upsertProject(response.project);
      if (activeLocalDraft) {
        const merged = mergeLocalImportDrafts(activeLocalDraft, nextDraft);
        updateLocalImportDraft(currentProject.id, () => merged.draft);
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

  async function handleStartProcessing() {
    if (!currentProject) return;
    if (!workspaceHdrItems.length) {
      setMessage(copy.importPhotosFirst);
      return;
    }

    setBusy(true);
    try {
      if (activeLocalDraft) {
        const projectId = currentProject.id;
        const draftFiles = collectLocalDraftFiles(activeLocalDraft);
        const uploadTotalFiles = Math.max(1, draftFiles.length);
        const completedFileIdentities = new Set<string>();
        const inFlightGroupProgress = new Map<string, number>();
        const updateAggregateUploadProgress = (stage: UploadProgressSnapshot['stage'] = 'uploading') => {
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
            totalFiles: uploadTotalFiles
          });
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

        const initialLayoutResponse = await applyHdrLayout(projectId, buildHdrLayoutPayload(activeLocalDraft, []), {
          mode: 'replace',
          inputComplete: false
        });
        upsertProject(initialLayoutResponse.project);

        let processingStartPromise: Promise<void> | null = null;
        const startProcessingOnce = async () => {
          if (!processingStartPromise) {
            processingStartPromise = startProcessing(projectId).then((response) => {
              upsertProject(response.project);
            });
          }
          await processingStartPromise;
        };

        let nextHdrItemIndex = 0;
        const uploadGroupWorker = async () => {
          while (nextHdrItemIndex < activeLocalDraft.hdrItems.length) {
            const hdrItemIndex = nextHdrItemIndex;
            nextHdrItemIndex += 1;
            const hdrItem = activeLocalDraft.hdrItems[hdrItemIndex];
            if (!hdrItem) {
              continue;
            }

            const groupFiles = collectLocalHdrItemFiles(hdrItem);
            if (!groupFiles.length) {
              continue;
            }

            const uploadResponse = await uploadFiles(projectId, groupFiles, (_percent, snapshot) => {
              const uploadedInGroup = Math.min(
                groupFiles.length,
                snapshot?.uploadedFiles ?? Math.round(((_percent || 0) / 100) * groupFiles.length)
              );
              inFlightGroupProgress.set(hdrItem.id, uploadedInGroup);
              updateAggregateUploadProgress('uploading');
            });
            inFlightGroupProgress.delete(hdrItem.id);
            for (const file of groupFiles) {
              completedFileIdentities.add(normalizeFileIdentity(file.name));
            }
            updateAggregateUploadProgress('uploading');

            const layoutResponse = await applyHdrLayout(
              projectId,
              buildSingleHdrLayoutPayload(
                activeLocalDraft,
                hdrItem,
                'directUploadFiles' in uploadResponse ? uploadResponse.directUploadFiles : []
              ),
              { mode: 'merge', inputComplete: false }
            );
            upsertProject(layoutResponse.project);
            await startProcessingOnce();
          }
        };

        const groupUploadWorkerCount = Math.max(
          1,
          Math.min(LOCAL_HDR_GROUP_UPLOAD_CONCURRENCY, activeLocalDraft.hdrItems.length)
        );
        await Promise.all(Array.from({ length: groupUploadWorkerCount }, () => uploadGroupWorker()));

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
        await startProcessingOnce();
        setUploadActive(false);
        setUploadMode(null);
        setUploadPercent(100);
        setUploadSnapshot(null);
        setMessage(copy.uploadOriginalsCanClose);
      } else {
        const response = await startProcessing(currentProject.id);
        upsertProject(response.project);
        setMessage('');
      }
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      setMessage(getUserFacingErrorMessage(error, copy.startProcessingFailed, locale));
    } finally {
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

  function downloadViewerAsset(asset: ResultAsset) {
    const url = resolveMediaUrl(asset.storageUrl);
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = asset.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
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

  if (activeRoute === 'admin') {
    return (
      <>
        <main className="admin-shell">
          <div className="ambient-layer studio-ambient" />
          <header className="admin-header">
            <button className="brand-button admin-brand" type="button" onClick={() => navigateToRoute('home')}>
              <img className="landing-brand-logo" src={logoFull} alt="Metrovan AI" decoding="async" />
            </button>
            <nav className="admin-nav" aria-label="Admin navigation">
              <button type="button" onClick={() => navigateToRoute('home')}>
                /home
              </button>
              <button type="button" onClick={() => navigateToRoute('studio')}>
                /studio
              </button>
              <button className="active" type="button">
                /admin
              </button>
            </nav>
            {session ? (
              <button className="ghost-button" type="button" onClick={() => void signOut()}>
                {copy.menuLogout}
              </button>
            ) : (
              <button className="solid-button" type="button" onClick={() => navigateToRoute('studio')}>
                {copy.landingSignIn}
              </button>
            )}
          </header>

          <section className="admin-hero-card">
            <div>
              <span className="admin-kicker">Metrovan AI Admin</span>
              <h1>用户与业务后台</h1>
              <p>查看用户、项目、积分和审计日志；支持禁用账号、踢下线、手动补积分。后台不会暴露密码哈希、重置 token 或邮箱验证 token。</p>
            </div>
            <div className="admin-key-card">
              {hasAdminSession ? (
                <div className="admin-session-card">
                  <span>Admin Session</span>
                  <strong>{session?.email}</strong>
                  <small>已用管理员账号登录，可直接管理用户。</small>
                </div>
              ) : (
                <div className="admin-session-card">
                  <span>Admin Required</span>
                  <strong>请先登录管理员账号</strong>
                  <small>后台只接受管理员账号 session。</small>
                </div>
              )}
              <button
                className="solid-button"
                type="button"
                onClick={() => (hasAdminSession ? void handleAdminLoadUsers() : navigateToRoute('studio'))}
                disabled={adminBusy}
              >
                {adminBusy ? '正在读取...' : hasAdminSession ? '连接后台' : '去登录'}
              </button>
            </div>
          </section>

          {adminMessage && <div className="global-message admin-message">{adminMessage}</div>}

          <section className="admin-stat-grid" aria-label="Admin summary">
            <article>
              <span>用户</span>
              <strong>{adminTotals.users}</strong>
            </article>
            <article>
              <span>项目</span>
              <strong>{adminTotals.projects}</strong>
            </article>
            <article>
              <span>照片</span>
              <strong>{adminTotals.photos}</strong>
            </article>
            <article>
              <span>充值</span>
              <strong>${adminTotals.revenue.toFixed(2)}</strong>
            </article>
          </section>

          <section className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <span className="admin-kicker">Processing Settings</span>
                <h2>云处理 HDR 批量</h2>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void handleAdminLoadSystemSettings()}
                disabled={adminSystemBusy}
              >
                刷新设置
              </button>
            </div>
            <div className="admin-activation-editor">
              <label className="admin-toggle-field">
                <span>每个云处理任务包含 HDR 组数</span>
                <input
                  value={adminSystemDraft.runpodHdrBatchSize}
                  onChange={(event) => setAdminSystemDraft({ runpodHdrBatchSize: event.target.value })}
                  inputMode="numeric"
                  min={MIN_RUNPOD_HDR_BATCH_SIZE}
                  max={MAX_RUNPOD_HDR_BATCH_SIZE}
                  disabled={adminSystemBusy}
                />
              </label>
              <div className="admin-session-card">
                <span>当前生效</span>
                <strong>{adminSystemSettings?.runpodHdrBatchSize ?? '—'} 组 / 任务</strong>
                <small>支持 {MIN_RUNPOD_HDR_BATCH_SIZE}-{MAX_RUNPOD_HDR_BATCH_SIZE}。新启动的处理任务会使用最新设置。</small>
              </div>
              <div className="admin-activation-actions">
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => void handleAdminSaveSystemSettings()}
                  disabled={adminSystemBusy}
                >
                  保存设置
                </button>
              </div>
            </div>
          </section>

          <section className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <span className="admin-kicker">Activation Codes</span>
                <h2>充值优惠码</h2>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void handleAdminLoadActivationCodes()}
                disabled={adminActivationBusy}
              >
                刷新优惠码
              </button>
            </div>
            <div className="admin-activation-editor">
              <input
                value={adminActivationDraft.code}
                onChange={(event) =>
                  setAdminActivationDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                }
                placeholder="激活码，例如 BETA40"
                disabled={adminActivationBusy}
              />
              <input
                value={adminActivationDraft.label}
                onChange={(event) => setAdminActivationDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="显示名称，例如 内测 40%"
                disabled={adminActivationBusy}
              />
              <select
                value={adminActivationDraft.packageId}
                onChange={(event) => setAdminActivationDraft((current) => ({ ...current, packageId: event.target.value }))}
                disabled={adminActivationBusy}
              >
                <option value="">不绑定充值档位（可直接兑换积分）</option>
                {adminActivationPackages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                value={adminActivationDraft.discountPercentOverride}
                onChange={(event) =>
                  setAdminActivationDraft((current) => ({ ...current, discountPercentOverride: event.target.value }))
                }
                inputMode="numeric"
                placeholder="覆盖折扣 %"
                disabled={adminActivationBusy}
              />
              <input
                value={adminActivationDraft.bonusPoints}
                onChange={(event) => setAdminActivationDraft((current) => ({ ...current, bonusPoints: event.target.value }))}
                inputMode="numeric"
                placeholder="直充/额外积分"
                disabled={adminActivationBusy}
              />
              <input
                value={adminActivationDraft.maxRedemptions}
                onChange={(event) =>
                  setAdminActivationDraft((current) => ({ ...current, maxRedemptions: event.target.value }))
                }
                inputMode="numeric"
                placeholder="最多使用次数"
                disabled={adminActivationBusy}
              />
              <input
                value={adminActivationDraft.expiresAt}
                onChange={(event) => setAdminActivationDraft((current) => ({ ...current, expiresAt: event.target.value }))}
                placeholder="过期时间 ISO，可空"
                disabled={adminActivationBusy}
              />
              <label className="admin-toggle-field">
                <input
                  type="checkbox"
                  checked={adminActivationDraft.active}
                  onChange={(event) => setAdminActivationDraft((current) => ({ ...current, active: event.target.checked }))}
                  disabled={adminActivationBusy}
                />
                启用
              </label>
              <div className="admin-activation-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    setAdminActivationDraft((current) => ({
                      ...current,
                      code: generateActivationCode(),
                      label: current.label || '内测优惠码'
                    }))
                  }
                  disabled={adminActivationBusy}
                >
                  随机生成
                </button>
                <button
                  className="solid-button"
                  type="button"
                  onClick={() => void handleAdminCreateActivationCode()}
                  disabled={adminActivationBusy}
                >
                  创建激活码
                </button>
              </div>
            </div>

            {adminActivationCodes.length ? (
              <div className="admin-activation-grid">
                {adminActivationCodes.slice(0, 12).map((item) => (
                  <article key={item.id} className={`admin-activation-card${item.available ? '' : ' muted'}`}>
                    <div>
                      <strong>{item.code}</strong>
                      <span>{item.label}</span>
                    </div>
                    <small>
                      {item.packageName ?? '可直接兑换'} · 已用 {item.redemptionCount}
                      {item.maxRedemptions ? ` / ${item.maxRedemptions}` : ''}
                    </small>
                    <small>
                      {item.discountPercentOverride !== null
                        ? `折扣 ${item.discountPercentOverride}%`
                        : item.packageName
                          ? '使用档位默认折扣'
                          : '无付款要求'}
                      {item.bonusPoints ? ` · ${item.packageName ? '额外' : '兑换'} ${item.bonusPoints} pts` : ''}
                    </small>
                    <div className="admin-row-actions">
                      <span className={`admin-status ${item.available ? 'ok' : 'warn'}`}>
                        {item.available ? '可用' : item.active ? '不可用' : '已停用'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAdminToggleActivationCode(item)}
                        disabled={adminActivationBusy}
                      >
                        {item.active ? '停用' : '启用'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-empty compact">
                <strong>{adminActivationBusy ? '正在读取优惠码...' : '暂无优惠码'}</strong>
                <span>创建后，用户在充值页输入激活码即可应用优惠。</span>
              </div>
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <span className="admin-kicker">Users</span>
                <h2>用户列表</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => void handleAdminLoadUsers()} disabled={adminBusy}>
                刷新
              </button>
            </div>

            <div className="admin-filter-bar">
              <input
                value={adminSearch}
                onChange={(event) => {
                  setAdminSearch(event.target.value);
                  setAdminPage(1);
                  setAdminLoaded(false);
                }}
                placeholder="搜索邮箱、姓名、userKey"
              />
              <select
                value={adminRoleFilter}
                onChange={(event) => {
                  setAdminRoleFilter(event.target.value as AdminUserListQuery['role']);
                  setAdminPage(1);
                  setAdminLoaded(false);
                }}
              >
                <option value="all">全部角色</option>
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
                <option value="all">全部状态</option>
                <option value="active">正常</option>
                <option value="disabled">禁用</option>
              </select>
              <select
                value={adminVerifiedFilter}
                onChange={(event) => {
                  setAdminVerifiedFilter(event.target.value as AdminUserListQuery['emailVerified']);
                  setAdminPage(1);
                  setAdminLoaded(false);
                }}
              >
                <option value="all">全部邮箱</option>
                <option value="verified">已验证</option>
                <option value="unverified">未验证</option>
              </select>
              <select
                value={adminPageSize}
                onChange={(event) => {
                  setAdminPageSize(Number(event.target.value));
                  setAdminPage(1);
                  setAdminLoaded(false);
                }}
              >
                <option value={10}>10 / 页</option>
                <option value={25}>25 / 页</option>
                <option value={50}>50 / 页</option>
                <option value={100}>100 / 页</option>
              </select>
            </div>

            {adminUsers.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>权限</th>
                      <th>邮箱状态</th>
                      <th>账号状态</th>
                      <th>登录方式</th>
                      <th>项目 / 照片</th>
                      <th>积分</th>
                      <th>充值</th>
                      <th>最近登录</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.displayName}</strong>
                          <span>{user.email}</span>
                          <small>{user.userKey}</small>
                        </td>
                        <td>
                          <span className={`admin-status ${user.role === 'admin' ? 'ok' : ''}`}>
                            {user.role === 'admin' ? '管理员' : '用户'}
                          </span>
                        </td>
                        <td>
                          <span className={`admin-status ${user.emailVerifiedAt ? 'ok' : 'warn'}`}>
                            {user.emailVerifiedAt ? '已验证' : '未验证'}
                          </span>
                        </td>
                        <td>
                          <span className={`admin-status ${user.accountStatus === 'active' ? 'ok' : 'danger'}`}>
                            {user.accountStatus === 'active' ? '正常' : '已禁用'}
                          </span>
                        </td>
                        <td>
                          <span>{[user.auth.password ? '密码' : '', user.auth.google ? 'Google' : ''].filter(Boolean).join(' + ') || '—'}</span>
                        </td>
                        <td>
                          <strong>{user.projectCount} 项目</strong>
                          <span>{user.photoCount} 张照片 · {user.resultCount} 张结果</span>
                        </td>
                        <td>
                          <strong>{user.billingSummary.availablePoints}</strong>
                          <span>已用 {user.billingSummary.totalChargedPoints}</span>
                        </td>
                        <td>
                          <strong>${user.billingSummary.totalTopUpUsd.toFixed(2)}</strong>
                          <span>累计 {user.billingSummary.totalCreditedPoints} pts</span>
                        </td>
                        <td>
                          <span>{formatAdminDate(user.lastLoginAt)}</span>
                          <small>{user.activeSessionCount} session</small>
                        </td>
                        <td>{formatAdminDate(user.createdAt)}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button type="button" onClick={() => void handleAdminSelectUser(user.id)} disabled={adminDetailBusy || adminActionBusy}>
                              详情
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleAdminUpdateUser(user.id, {
                                  accountStatus: user.accountStatus === 'active' ? 'disabled' : 'active'
                                })
                              }
                              disabled={adminActionBusy}
                            >
                              {user.accountStatus === 'active' ? '禁用' : '启用'}
                            </button>
                            <button
                              className="danger"
                              type="button"
                              onClick={() => void handleAdminDeleteUser(user.id)}
                              disabled={adminActionBusy}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-empty">
                <strong>{adminBusy ? '正在读取用户...' : '还没有载入用户'}</strong>
                <span>请先用管理员账号登录，然后点击连接后台。</span>
              </div>
            )}

            <div className="admin-pagination">
              <span>
                第 {adminPage} / {adminPageCount} 页，共 {adminTotalUsers} 个用户
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setAdminPage((current) => Math.max(1, current - 1));
                    setAdminLoaded(false);
                  }}
                  disabled={adminBusy || adminPage <= 1}
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdminPage((current) => Math.min(adminPageCount, current + 1));
                    setAdminLoaded(false);
                  }}
                  disabled={adminBusy || adminPage >= adminPageCount}
                >
                  下一页
                </button>
              </div>
            </div>
          </section>

          <section className="admin-detail-grid">
            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="admin-kicker">User Detail</span>
                  <h2>{adminSelectedUser ? adminSelectedUser.displayName : '选择一个用户'}</h2>
                </div>
                {adminSelectedUser && (
                  <div className="admin-row-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleAdminLogoutUser(adminSelectedUser.id)}
                      disabled={adminActionBusy}
                    >
                      踢下线
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => void handleAdminDeleteUser(adminSelectedUser.id)}
                      disabled={adminActionBusy}
                    >
                      删除用户
                    </button>
                  </div>
                )}
              </div>
              {adminSelectedUser ? (
                <div className="admin-detail-body">
                  <div className="admin-profile-grid">
                    <div>
                      <span>邮箱</span>
                      <strong>{adminSelectedUser.email}</strong>
                    </div>
                    <div>
                      <span>角色</span>
                      <select
                        value={adminSelectedUser.role}
                        onChange={(event) =>
                          void handleAdminUpdateUser(adminSelectedUser.id, { role: event.target.value as 'user' | 'admin' })
                        }
                        disabled={adminActionBusy}
                      >
                        <option value="user">用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </div>
                    <div>
                      <span>账号状态</span>
                      <select
                        value={adminSelectedUser.accountStatus}
                        onChange={(event) =>
                          void handleAdminUpdateUser(adminSelectedUser.id, { accountStatus: event.target.value as 'active' | 'disabled' })
                        }
                        disabled={adminActionBusy}
                      >
                        <option value="active">正常</option>
                        <option value="disabled">禁用</option>
                      </select>
                    </div>
                    <div>
                      <span>积分余额</span>
                      <strong>{adminSelectedUser.billingSummary.availablePoints} pts</strong>
                    </div>
                  </div>

                  <div className="admin-adjust-card">
                    <div>
                      <span className="admin-kicker">Points</span>
                      <h3>手动调整积分</h3>
                    </div>
                    <select
                      value={adminAdjustment.type}
                      onChange={(event) =>
                        setAdminAdjustment((current) => ({ ...current, type: event.target.value as 'credit' | 'charge' }))
                      }
                    >
                      <option value="credit">补积分</option>
                      <option value="charge">扣积分</option>
                    </select>
                    <input
                      value={adminAdjustment.points}
                      onChange={(event) => setAdminAdjustment((current) => ({ ...current, points: event.target.value }))}
                      inputMode="numeric"
                      placeholder="积分"
                    />
                    <input
                      value={adminAdjustment.note}
                      onChange={(event) => setAdminAdjustment((current) => ({ ...current, note: event.target.value }))}
                      placeholder="原因，例如 Manual credit"
                    />
                    <button
                      className="solid-button"
                      type="button"
                      onClick={() => void handleAdminAdjustBilling(adminSelectedUser.id)}
                      disabled={adminActionBusy}
                    >
                      提交
                    </button>
                  </div>

                  <div className="admin-mini-table">
                    <div className="admin-mini-head">
                      <strong>最近项目</strong>
                      <span>{adminDetailProjects.length} 个</span>
                    </div>
                    {adminDetailBusy ? (
                      <p>正在读取...</p>
                    ) : adminDetailProjects.length ? (
                      adminDetailProjects.slice(0, 6).map((project) => (
                        <div key={project.id} className="admin-mini-row">
                          <span>{project.name}</span>
                          <small>{project.status} · {project.photoCount} photos · {formatAdminDate(project.updatedAt)}</small>
                        </div>
                      ))
                    ) : (
                      <p>暂无项目。</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="admin-empty compact">
                  <strong>未选择用户</strong>
                  <span>点击用户列表里的“详情”查看项目、账单和管理操作。</span>
                </div>
              )}
            </article>

            <article className="admin-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="admin-kicker">Billing & Audit</span>
                  <h2>账单与审计</h2>
                </div>
                <button className="ghost-button" type="button" onClick={() => void handleAdminLoadAuditLogs()} disabled={adminActionBusy}>
                  全部日志
                </button>
              </div>
              <div className="admin-mini-table">
                <div className="admin-mini-head">
                  <strong>最近账单</strong>
                  <span>{adminDetailBillingEntries.length} 条</span>
                </div>
                {adminDetailBillingEntries.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="admin-mini-row">
                    <span>{entry.type === 'credit' ? '+' : '-'}{entry.points} pts · ${entry.amountUsd.toFixed(2)}</span>
                    <small>{entry.note} · {formatAdminDate(entry.createdAt)}</small>
                  </div>
                ))}
                {!adminDetailBillingEntries.length && <p>暂无账单记录。</p>}
              </div>
              <div className="admin-mini-table">
                <div className="admin-mini-head">
                  <strong>审计日志</strong>
                  <span>{adminAuditLogs.length} 条</span>
                </div>
                {adminAuditLogs.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="admin-mini-row">
                    <span>{entry.action}</span>
                    <small>{entry.actorEmail ?? entry.actorType} · {formatAdminDate(entry.createdAt)}</small>
                  </div>
                ))}
                {!adminAuditLogs.length && <p>暂无审计日志。</p>}
              </div>
            </article>
          </section>
        </main>
      </>
    );
  }

  if (activeRoute === 'home' || !session) {
    return (
      <>
        <main className="landing-shell">
          <div className="landing-video-wrap">
            <video
              ref={landingVideoRef}
              className="landing-video"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              disablePictureInPicture
              onCanPlay={() => attemptLandingVideoPlayback(landingVideoRef.current)}
              src={LANDING_VIDEO_URL}
            />
            <div className="landing-video-overlay" />
          </div>
          <div className="ambient-layer" />
          <header className="landing-nav">
            <button className="brand-button landing-brand" type="button" onClick={() => navigateToRoute('home')}>
              <img className="landing-brand-logo" src={logoFull} alt="Metrovan AI" decoding="async" />
            </button>
            <nav className="landing-links" aria-label="Primary">
              <button
                className={`landing-home-link${landingView === 'home' ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  setLandingView('home');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {copy.home}
              </button>
              <button
                className={`landing-home-link${landingView === 'plans' ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  setLandingView('plans');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {copy.plansNav}
              </button>
            </nav>
            <div className="landing-actions">
              <button
                className="solid-button nav-signin"
                type="button"
                onClick={() => (session ? navigateToRoute('studio') : openAuth('signin'))}
              >
                {session ? copy.studioLabel : copy.landingSignIn}
              </button>
            </div>
          </header>

          {message && <div className="global-message landing-global-message">{message}</div>}

          {landingView === 'home' && (
            <>
          <section className="landing-hero restored-hero">
            <div className="hero-copy centered">
              <span className="hero-badge restored-badge">
                <span className="hero-badge-pill">New</span>
                <span>AI real estate image alchemy</span>
              </span>
              <h1>
                Real estate edits.
                <br />
                One clear <em>glow.</em>
              </h1>
              <p>Keep wall colors consistent across every listing.</p>
              <div className="hero-actions centered">
                <button
                  className="solid-button large rounded-pill"
                  type="button"
                  onClick={() => (session ? navigateToRoute('studio') : openAuth('signup'))}
                >
                  {copy.landingStartProject}
                </button>
              </div>
            </div>
          </section>

          <section className="showcase-section">
            <div className="showcase-stage showcase-stage-sci">
              <div className="showcase-sci-grid">
                <article className="showcase-sci-main showcase-sci-shell">
                  <ShowcaseCornerFrame />
                  <div className="showcase-sci-heading">
                    <div>
                      <span className="showcase-sci-kicker">AI Real Estate Engine</span>
                      <strong>Interior Consistency System</strong>
                    </div>
                    <span className="showcase-sci-chip" aria-hidden="true">
                      <ShowcaseIconCpu />
                    </span>
                  </div>

                  <figure className="showcase-sci-render">
                    <div className="showcase-sci-render-layer showcase-sci-render-before">
                      <img src={showcaseInteriorBefore} alt="Interior original capture" loading="lazy" decoding="async" />
                    </div>
                    <div className="showcase-sci-render-layer showcase-sci-render-after" aria-hidden="true">
                      <img src={showcaseInteriorAfter} alt="" loading="lazy" decoding="async" />
                    </div>
                    <div className="showcase-sci-render-tiles" aria-hidden="true" />
                    <div className="showcase-sci-render-noise" aria-hidden="true" />
                    <div className="showcase-sci-render-scanline" aria-hidden="true">
                      <span className="showcase-sci-render-scanline-core" />
                      <span className="showcase-sci-render-scanline-halo" />
                    </div>
                    <div className="showcase-sci-render-status" aria-hidden="true">
                      <span className="showcase-sci-render-status-dot" />
                      <span className="showcase-sci-render-status-text">AI Rendering</span>
                      <span className="showcase-sci-render-status-bar">
                        <span className="showcase-sci-render-status-bar-fill" />
                      </span>
                    </div>
                    <span className="showcase-sci-render-tag showcase-sci-render-tag-before">Before</span>
                    <span className="showcase-sci-render-tag showcase-sci-render-tag-after">After</span>
                    <div className="showcase-sci-render-reticle" aria-hidden="true">
                      <span className="showcase-sci-render-reticle-ring" />
                      <span className="showcase-sci-render-reticle-cross" />
                    </div>
                    <figcaption className="showcase-sci-render-caption">
                      <div className="showcase-sci-render-caption-side is-before">
                        <strong>Raw Capture</strong>
                        <small>Color cast · Uneven light · Soft detail.</small>
                      </div>
                      <div className="showcase-sci-render-caption-side is-after">
                        <strong>AI Enhanced</strong>
                        <small>Neutral white · Balanced light · Sky replaced.</small>
                      </div>
                    </figcaption>
                  </figure>

                  <div className="showcase-sci-steps" aria-hidden="true">
                    <article className="showcase-sci-step-card">
                      <span>01</span>
                      <div>
                        <strong>Analyze</strong>
                        <small>Detect lighting and color drift.</small>
                      </div>
                    </article>
                    <article className="showcase-sci-step-card">
                      <span>02</span>
                      <div>
                        <strong>Calibrate</strong>
                        <small>Unify exposure and natural tone.</small>
                      </div>
                    </article>
                    <article className="showcase-sci-step-card">
                      <span>03</span>
                      <div>
                        <strong>Deliver</strong>
                        <small>Keep textures and structure realistic.</small>
                      </div>
                    </article>
                  </div>
                </article>

                <aside className="showcase-sci-sidebar">
                  <article className="showcase-sci-shell showcase-sci-status-card">
                    <span className="showcase-sci-kicker">Consistency Lock</span>
                    <div className="showcase-sci-status-list">
                      <ShowcaseStatusRow label="Color Tone" value="Stable" />
                      <ShowcaseStatusRow label="Color Shift" value="0.3%" />
                      <ShowcaseStatusRow label="Material Integrity" value="Locked" />
                      <ShowcaseStatusRow label="Geometry" value="Preserved" />
                    </div>
                  </article>

                  <div className="showcase-sci-feature-stack">
                    <ShowcaseFeature
                      icon={<ShowcaseIconSunMedium />}
                      title="Smart Lighting"
                      text="Balances indoor light without blowing out windows."
                    />
                    <ShowcaseFeature
                      icon={<ShowcaseIconSparkles />}
                      title="Clean Color"
                      text="Removes color cast while keeping original wall and floor tones."
                    />
                    <ShowcaseFeature
                      icon={<ShowcaseIconShieldCheck />}
                      title="Realism Guard"
                      text="Prevents harsh highlights, plastic texture, and overprocessed results."
                    />
                  </div>

                  <article className="showcase-sci-shell showcase-sci-ready-card">
                    <span className="showcase-sci-ready-icon" aria-hidden="true">
                      <ShowcaseIconCheck />
                    </span>
                    <div>
                      <strong>Ready for listing delivery</strong>
                      <small>Fast, consistent, realistic real estate photo enhancement.</small>
                    </div>
                  </article>
                </aside>
              </div>
            </div>
          </section>

          <section className="quote-section">
            <div className="quote-marks">"</div>
            <p className="quote-copy">
              Metrovan AI gives every listing a quiet cinematic finish. Rooms feel aligned, colors stay calm,
              <span> and the whole home carries one polished visual atmosphere.</span>
            </p>
            <div className="quote-end-mark">"</div>
            <div className="quote-author">
              <div className="quote-avatar">
                <img src={jinSignatureAvatar} alt="Jin Studio Team" loading="lazy" decoding="async" />
              </div>
              <div>
                <strong>Jin Studio Team</strong>
                <span>Real Estate Media Operations</span>
              </div>
            </div>
          </section>
            </>
          )}
          {landingView === 'plans' && (
            <section className="plans-section">
              <div className="plans-hero">
                <span className="plans-hero-badge">
                  <span className="plans-hero-pill">Plans</span>
                  <span>{copy.plansHeroKicker}</span>
                </span>
                <h1 className="plans-hero-title">{copy.plansHeroTitle}</h1>
                <p className="plans-hero-sub">{copy.plansHeroSub}</p>
                <div className="plans-hero-meta">
                  <span><em>$0.25</em>{copy.plansMetaUnit}</span>
                  <span className="plans-hero-meta-sep" aria-hidden="true" />
                  <span><em>1 : 1</em>{copy.plansMetaPhoto}</span>
                  <span className="plans-hero-meta-sep" aria-hidden="true" />
                  <span><em>40%</em>{copy.plansMetaMax}</span>
                </div>
              </div>

              <div className="plans-lock-banner" role="note">
                <span className="plans-lock-pill">
                  <svg className="plans-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3.5" y="10.5" width="17" height="11" rx="2" />
                    <path d="M7 10.5V7a5 5 0 0 1 10 0v3.5" />
                  </svg>
                  <span>{copy.plansLockBadge}</span>
                </span>
                <div className="plans-lock-text">
                  <strong>{copy.plansLockTitle}</strong>
                  <span>{copy.plansLockSub}</span>
                </div>
              </div>

              <div className="plans-tiers">
                {[
                  { id: 'p-100', amount: 100, points: 420, bonus: 20, off: 5, tag: copy.plansTagStarter, featured: false },
                  { id: 'p-500', amount: 500, points: 2200, bonus: 200, off: 10, tag: copy.plansTagGrowth, featured: false },
                  { id: 'p-1000', amount: 1000, points: 4800, bonus: 800, off: 20, tag: copy.plansTagPro, featured: true },
                  { id: 'p-2000', amount: 2000, points: 11200, bonus: 3200, off: 40, tag: copy.plansTagStudio, featured: false }
                ].map((tier) => (
                  <article key={tier.id} className={`plans-tier-card${tier.featured ? ' is-featured' : ''}`}>
                    {tier.featured && <span className="plans-tier-ribbon">{copy.plansBestValue}</span>}
                    <span className="plans-tier-tag">{tier.tag}</span>
                    <div className="plans-tier-price">
                      <span className="plans-tier-currency">$</span>
                      <span className="plans-tier-amount">{tier.amount.toLocaleString()}</span>
                      <span className="plans-tier-unit">USD</span>
                    </div>
                    <div className="plans-tier-points">
                      <strong>{tier.points.toLocaleString()}</strong>
                      <span>{copy.plansCredits}</span>
                    </div>
                    <ul className="plans-tier-list">
                      <li><span className="plans-tick" aria-hidden="true">+</span>{copy.plansOffLabel(tier.off)}</li>
                      <li><span className="plans-tick" aria-hidden="true">+</span>{copy.plansBonusLabel(tier.bonus)}</li>
                      <li><span className="plans-tick" aria-hidden="true">+</span>{copy.plansPerPhoto}</li>
                    </ul>
                    <button
                      className="solid-button plans-tier-cta"
                      type="button"
                      onClick={() => (session ? navigateToRoute('studio') : openAuth('signup'))}
                    >
                      {copy.plansChoose}
                    </button>
                  </article>
                ))}
              </div>

              <div className="plans-benefits">
                <div className="plans-block-head">
                  <span className="plans-block-kicker">{copy.plansBenefitsKicker}</span>
                  <strong>{copy.plansBenefitsTitle}</strong>
                </div>
                <div className="plans-benefits-grid">
                  {[
                    { k: '01', t: copy.plansBen1Title, d: copy.plansBen1Desc },
                    { k: '02', t: copy.plansBen2Title, d: copy.plansBen2Desc },
                    { k: '03', t: copy.plansBen3Title, d: copy.plansBen3Desc },
                    { k: '04', t: copy.plansBen4Title, d: copy.plansBen4Desc },
                    { k: '05', t: copy.plansBen5Title, d: copy.plansBen5Desc },
                    { k: '06', t: copy.plansBen6Title, d: copy.plansBen6Desc }
                  ].map((benefit) => (
                    <article key={benefit.k} className="plans-benefit-card">
                      <span className="plans-benefit-index">{benefit.k}</span>
                      <strong>{benefit.t}</strong>
                      <p>{benefit.d}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="plans-scenes">
                <div className="plans-block-head">
                  <span className="plans-block-kicker">{copy.plansScenesKicker}</span>
                  <strong>{copy.plansScenesTitle}</strong>
                </div>
                <div className="plans-scenes-grid plans-scenes-grid-3">
                  {[
                    { id: 's1', tag: copy.plansScene1Tag, title: copy.plansScene1Title, desc: copy.plansScene1Desc, metaLabel: copy.plansScene1MetaLabel, metaValue: copy.plansScene1MetaValue },
                    { id: 's2', tag: copy.plansScene2Tag, title: copy.plansScene2Title, desc: copy.plansScene2Desc, metaLabel: copy.plansScene2MetaLabel, metaValue: copy.plansScene2MetaValue },
                    { id: 's3', tag: copy.plansScene3Tag, title: copy.plansScene3Title, desc: copy.plansScene3Desc, metaLabel: copy.plansScene3MetaLabel, metaValue: copy.plansScene3MetaValue }
                  ].map((scene) => (
                    <article key={scene.id} className="plans-scene-card">
                      <span className="plans-scene-tag">{scene.tag}</span>
                      <strong>{scene.title}</strong>
                      <p>{scene.desc}</p>
                      <span className="plans-scene-rec">{scene.metaLabel}: <em>{scene.metaValue}</em></span>
                    </article>
                  ))}
                </div>
              </div>

              <div className="plans-faq">
                <div className="plans-block-head">
                  <span className="plans-block-kicker">{copy.plansFaqKicker}</span>
                  <strong>{copy.plansFaqTitle}</strong>
                </div>
                <div className="plans-faq-list">
                  {[
                    { q: copy.plansFaq1Q, a: copy.plansFaq1A },
                    { q: copy.plansFaq2Q, a: copy.plansFaq2A },
                    { q: copy.plansFaq3Q, a: copy.plansFaq3A },
                    { q: copy.plansFaq5Q, a: copy.plansFaq5A }
                  ].map((item, index) => (
                    <details key={index} className="plans-faq-item">
                      <summary>
                        <span className="plans-faq-q">{item.q}</span>
                        <span className="plans-faq-caret" aria-hidden="true">+</span>
                      </summary>
                      <p>{item.a}</p>
                    </details>
                  ))}
                </div>
              </div>

              <div className="plans-cta-band">
                <div>
                  <strong>{copy.plansCtaTitle}</strong>
                  <span>{copy.plansCtaSub}</span>
                </div>
                <button
                  className="solid-button large rounded-pill plans-cta-btn"
                  type="button"
                  onClick={() => (session ? navigateToRoute('studio') : openAuth('signup'))}
                >
                  {copy.plansCtaBtn}
                </button>
              </div>
            </section>
          )}
        </main>

        {authOpen && !session && (
          <div className="modal-backdrop" onClick={closeAuth}>
            <div className="modal-card auth-card" onClick={(event) => event.stopPropagation()}>
              <div className="auth-chip">Metrovan AI Access</div>
              <div className="modal-head">
                <div className="auth-copy">
                  <strong>{authTitle}</strong>
                  <span>{authSubtitle}</span>
                </div>
                <button className="close-button" type="button" onClick={closeAuth}>
                  ×
                </button>
              </div>
              {!isAuthLinkMode && (
                <div className="auth-provider-stack">
                  <button
                    className="provider-button"
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={authBusy || googleAuthEnabled === false}
                  >
                    <span className="provider-icon">G</span>
                    <span>{copy.authUseGoogle}</span>
                  </button>
                  {googleAuthEnabled === false && <div className="provider-note">{copy.authGoogleComingSoon}</div>}
                  <div className="auth-divider">
                    <span>{copy.authUseEmail}</span>
                  </div>
                </div>
              )}
              {!isAuthLinkMode && (
                <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
                  <button
                    className={`auth-tab${authMode === 'signin' ? ' active' : ''}`}
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setAuthMessage('');
                    }}
                    disabled={authBusy}
                  >
                    {copy.authModeSignin}
                  </button>
                  <button
                    className={`auth-tab${authMode === 'signup' ? ' active' : ''}`}
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthMessage('');
                    }}
                    disabled={authBusy}
                  >
                    {copy.authModeSignup}
                  </button>
                </div>
              )}
              {authMessage && <div className="auth-feedback">{authMessage}</div>}
              <div className="form-grid">
                {authMode === 'signup' && (
                  <label>
                    <span>{copy.authName}</span>
                    <input
                      disabled={authBusy}
                      value={auth.name}
                      onChange={(event) => setAuth((current) => ({ ...current, name: event.target.value }))}
                      placeholder="zhou jin"
                    />
                  </label>
                )}
                {authMode !== 'reset-confirm' && authMode !== 'verify-email' && (
                  <label>
                    <span>{copy.authEmail}</span>
                    <input
                      disabled={authBusy}
                      type="email"
                      autoComplete={authMode === 'signin' ? 'username' : 'email'}
                      value={auth.email}
                      onChange={(event) => setAuth((current) => ({ ...current, email: event.target.value }))}
                      placeholder="name@email.com"
                    />
                  </label>
                )}
                {authMode !== 'reset-request' && authMode !== 'verify-email' && (
                  <label>
                    <span>{authMode === 'reset-confirm' ? copy.authNewPassword : copy.authPassword}</span>
                    <input
                      disabled={authBusy}
                      type="password"
                      autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                      value={auth.password}
                      onChange={(event) => setAuth((current) => ({ ...current, password: event.target.value }))}
                      placeholder={authMode === 'reset-confirm' ? copy.authNewPasswordPlaceholder : copy.authPasswordPlaceholder}
                    />
                  </label>
                )}
                {authMode === 'signin' && (
                  <div className="auth-inline-actions">
                    <button className="text-link auth-inline-link" type="button" onClick={handleForgotPassword} disabled={authBusy}>
                      {copy.authForgotPassword}
                    </button>
                  </div>
                )}
                {(authMode === 'signup' || authMode === 'reset-confirm') && (
                  <label>
                    <span>{copy.authConfirmPassword}</span>
                    <input
                      disabled={authBusy}
                      type="password"
                      autoComplete="new-password"
                      value={auth.confirmPassword}
                      onChange={(event) => setAuth((current) => ({ ...current, confirmPassword: event.target.value }))}
                      placeholder={copy.authConfirmPasswordPlaceholder}
                    />
                  </label>
                )}
              </div>
              <div className="modal-actions auth-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    if (authMode === 'reset-confirm' || authMode === 'verify-email') {
                      clearAuthTokenQuery();
                    }
                    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
                    setAuthMessage('');
                  }}
                  disabled={authBusy}
                >
                  {isAuthLinkMode ? copy.authBackToLogin : authMode === 'signin' ? copy.authNoAccount : copy.authHasAccount}
                </button>
                {!isEmailVerifyMode && (
                  <button className="solid-button auth-submit" type="button" onClick={submitAuth} disabled={authBusy}>
                    {authSubmitLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <main className={`studio-shell${isDemoMode ? ' demo-shell' : ''}`}>
        <div className="ambient-layer studio-ambient" />
        <header className="studio-header">
          <button className="brand-button" type="button" onClick={() => navigateToRoute('home')}>
            <span className="studio-brand-mark-shell" aria-hidden="true">
              <img className="studio-brand-mark" src={logoMark} alt="Metrovan AI" decoding="async" />
            </span>
            <span className="brand-copy">
              <strong>{copy.studioLabel}</strong>
              <em>{copy.studioSubLabel}</em>
            </span>
          </button>
          {!isDemoMode && (
            <button className="header-center" type="button" onClick={() => navigateToRoute('home')}>
              {copy.home}
            </button>
          )}
          <div className="header-actions">
            <button className="studio-guide-trigger" type="button" onClick={openStudioGuide}>
              {copy.studioGuideOpen}
            </button>
            <div className="points-pill">
              <span className="points-pill-label">{copy.points}</span>
              <strong className="points-pill-value">{isDemoMode ? '42.5' : billingSummary?.availablePoints ?? 0}</strong>
              <button className="points-plus" type="button" aria-label={copy.topUp} onClick={() => void handleOpenBilling('topup')}>
                +
              </button>
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
          <aside className="sidebar-card">
            <div className="sidebar-head">
              <div className="sidebar-copy">
                <strong>{copy.historyProjects}</strong>
                <span>{isDemoMode ? copy.historyProjectsHintDemo : copy.historyProjectsHint}</span>
              </div>
              <button className="solid-button small" type="button" onClick={() => setCreateDialogOpen(true)}>
                {copy.newProject}
              </button>
            </div>

            <div className="project-list">
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
                    <button className="ghost-button compact" type="button" onClick={() => setCurrentProjectId(project.id)}>
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
          </aside>

          <section className="workspace">
            {!currentProject ? (
              <div className="workspace-empty">
                <strong>{copy.createFirstProject}</strong>
                <p>{copy.createFirstProjectHint}</p>
                <button className="solid-button" type="button" onClick={() => setCreateDialogOpen(true)}>
                  {copy.newProject}
                </button>
              </div>
            ) : (
              <>
                <section className="panel project-head-card">
                  <div className="project-head-copy">
                    <span className="muted">{copy.currentProject}</span>
                    <div className="project-head-title-row">
                      <h2>{currentProject.name}</h2>
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
                        <button className="ghost-button compact" type="button" onClick={() => void handleStartProcessing()} disabled={busy}>
                          {copy.retryProcessing}
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
                                        className={`asset-frame${showProcessingGroupGrid && previewUrl ? ' is-clickable' : ''}`}
                                        onClick={
                                          showProcessingGroupGrid && previewUrl
                                            ? () => window.open(previewUrl, '_blank', 'noopener,noreferrer')
                                            : undefined
                                        }
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
                                            <button className="viewer-arrow left" type="button" onClick={() => void handleShiftExposure(hdrItem, -1)}>
                                              {'<'}
                                            </button>
                                            <button className="viewer-arrow right" type="button" onClick={() => void handleShiftExposure(hdrItem, 1)}>
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
                      <span className="meta-pill">{formatPhotoCount(currentProject.resultAssets.length, locale)}</span>
                    </div>
                    {displayResultAssets.length ? (
                      <div className={`result-grid${draggedResultHdrItemId ? ' is-reordering' : ''}`}>
                        {displayResultAssets.map((asset, index) => {
                          const previewUrl = resolveMediaUrl(asset.previewUrl ?? asset.storageUrl);
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
                    {billingEntries.slice(0, 8).map((entry) => (
                      <article key={entry.id} className="billing-entry-row">
                        <div>
                          <strong>{entry.note}</strong>
                          <span>{formatDate(entry.createdAt, locale)}</span>
                        </div>
                        <div className={`billing-entry-amount ${entry.type === 'credit' ? 'credit' : 'charge'}`}>
                          <strong>
                            {entry.type === 'credit' ? '+' : '-'}
                            {entry.points} pts
                          </strong>
                          <span>{formatUsd(entry.amountUsd, locale)}</span>
                        </div>
                      </article>
                    ))}
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
        <div className="modal-backdrop" onClick={() => setCreateDialogOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <strong>{copy.createProjectTitle}</strong>
              <button className="close-button" type="button" onClick={() => setCreateDialogOpen(false)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>{copy.projectName}</span>
                <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Jin Project" />
              </label>
              <label>
                <span>{copy.projectAddress}</span>
                <input value={newProjectAddress} onChange={(event) => setNewProjectAddress(event.target.value)} placeholder="Downtown Vancouver" />
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setCreateDialogOpen(false)}>
                {copy.cancel}
              </button>
              <button className="solid-button" type="button" onClick={() => void handleCreateProject()} disabled={busy}>
                {copy.createProject}
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
                <button className="result-editor-icon-button" type="button" onClick={() => downloadViewerAsset(currentViewerAsset)}>
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
