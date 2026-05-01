import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { startTransition, useLayoutEffect } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react';
import { AccountSettingsDialog } from './components/AccountSettingsDialog';
import { AuthModal } from './components/AuthModal';
import { AdminConsole } from './components/AdminConsole';
import { AdminRefundDialog } from './components/AdminRefundDialog';
import { BillingPanel } from './components/BillingPanel';
import { DeleteProjectConfirmDialog } from './components/DeleteProjectConfirmDialog';
import { FeatureCreateDialog } from './components/FeatureCreateDialog';
import { LocalImportReviewNotices } from './components/LocalImportReviewNotices';
import { ProcessingStatusPanel } from './components/ProcessingStatusPanel';
import { ProjectStepStrip } from './components/ProjectStepStrip';
import { ProjectDownloadDialog } from './components/ProjectDownloadDialog';
import { ProjectWorkspaceHeader } from './components/ProjectWorkspaceHeader';
import { ResultEditorDialog } from './components/ResultEditorDialog';
import { ResultsPanel } from './components/ResultsPanel';
import { ReviewPanelHeader } from './components/ReviewPanelHeader';
import { ReviewUploadStatus } from './components/ReviewUploadStatus';
import { StudioFeatureLaunchPanel } from './components/StudioFeatureLaunchPanel';
import { StudioHeader } from './components/StudioHeader';
import { StudioGuideDialog } from './components/StudioGuideDialog';
import { UploadDropzone } from './components/UploadDropzone';
import { LandingPage } from './pages/LandingPage';
import logoMark from './assets/metrovan-logo-mark.webp';
import { isDemoModeEnabled } from './demo-mode';
import type { LocalExposureDraft, LocalHdrItemDraft, LocalImportDraft } from './local-import';
import { UI_TEXT, type UiLocale } from './app-copy';
import {
  STUDIO_FEATURES,
  normalizeStudioFeatureDrafts,
  studioFeatureConfigToDefinition,
  type StudioFeatureDefinition,
  type StudioFeatureId
} from './studio-features';
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
  fetchAdminMaintenanceReports,
  fetchAdminProjectDetail,
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
  repairAdminProject,
  retryFailedProcessing,
  runAdminProjectDeepHealth,
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
  AdminMaintenanceReportSummary,
  AdminOpsHealthPayload,
  AdminProjectRepairAction,
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
  PaymentOrderRecord,
  PaymentOrderRefundPreview,
  ProjectGroup,
  ProjectAdminDeepHealth,
  ProjectRecord,
  ResultAsset,
  SceneType
} from './types';

import {
  ADMIN_FEATURE_CATEGORY_OPTIONS,
  ADMIN_FEATURE_STATUS_OPTIONS,
  ADMIN_FEATURE_TONE_OPTIONS,
  ADMIN_MAX_BATCH_CODES,
  DEFAULT_DOWNLOAD_DRAFT,
  DEFAULT_REGENERATION_COLOR,
  DEFAULT_RESULT_EDITOR_SETTINGS,
  DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT,
  DEMO_BILLING_ENTRIES,
  DEMO_BILLING_PACKAGES,
  DEMO_BILLING_SUMMARY,
  IMPORT_FILE_ACCEPT,
  MAX_RUNNINGHUB_MAX_IN_FLIGHT,
  MAX_RUNPOD_HDR_BATCH_SIZE,
  MIN_RUNNINGHUB_MAX_IN_FLIGHT,
  MIN_RUNPOD_HDR_BATCH_SIZE,
  RESULT_COLOR_CARD_STORAGE_KEY,
  buildResultCropFramePatch,
  buildAdminPlanPackageFromDraft,
  buildUniqueAdminActivationCode,
  clampEditorValue,
  clampIndex,
  clampResultCropFrame,
  clearAuthTokenQuery,
  createAdminBatchCodeDraft,
  createAdminPlanDraft,
  createDemoProjects,
  createHdrItemFromExposure,
  filterSupportedImportFiles,
  formatDate,
  formatGroupSummary,
  formatUsd,
  formatUploadProgressLabel,
  getAuthErrorMessage,
  getAuthFeedbackMessage,
  getAvailableResultColorCards,
  getAspectRatioNumber,
  getAspectRatioValue,
  getColorModeLabel,
  getCustomRechargePoints,
  getDefaultCropFrameForAspect,
  getDraftGroupId,
  getEmailVerificationTokenFromQuery,
  getGroupItems,
  getHdrItemStatusLabel,
  getHdrItemReviewStateFromExposures,
  getHdrLocalReviewState,
  getHdrPreviewUrl,
  getInitialAuthMode,
  getLocalReviewCopy,
  getMaxNavigableStep,
  getPasswordResetTokenFromQuery,
  getPathForRoute,
  getProjectStatusLabel,
  getRouteFromPath,
  getResultCropFrame,
  getSceneLabel,
  getSelectedExposure,
  getStoredLocale,
  getStoredResultColorCards,
  getUserFacingErrorMessage,
  isHdrItemProcessing,
  isInsufficientCreditsError,
  isProjectJobActivelyProcessing,
  isStrongPasswordInput,
  loadLocalImportModule,
  markStudioGuideDismissed,
  mergeLocalImportDrafts,
  mergeProjectItemsWithLocalPreviews,
  normalizeFileIdentity,
  normalizeHex,
  normalizeHexDraft,
  parseCustomRechargeAmount,
  resolveMediaUrl,
  revokeLocalImportDraftUrls,
  shouldOpenAuthFromQuery,
  syncLocalHdrGroups,
  sortExposuresForHdr,
  type AdminBatchCodeDraft,
  type AdminConsolePage,
  type AdminPlanDraft,
  type AppRoute,
  type AuthMode,
  type DownloadDraft,
  type FailedUploadEntry,
  type ResultColorCard,
  type ResultCropDragState,
  type ResultCropFrame,
  type ResultCropFrameDragState,
  type ResultCropFrameDragMode,
  type ResultEditorAspectRatio,
  type ResultEditorSettings,
  type SessionState,
  type StudioFeatureImageField,
  type WindowWithEyeDropper
} from './app-utils';

const STRIPE_RETURN_PROJECT_STORAGE_KEY = 'metrovanai_stripe_return_project_id';

function isAdminBillingAdjustmentEntry(entry: BillingEntry) {
  return entry.amountUsd === 0 && !entry.projectId && !entry.projectName && entry.note.startsWith('Admin adjustment:');
}

function App() {
  const isDemoMode = isDemoModeEnabled();
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
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingModalMode, setBillingModalMode] = useState<'topup' | 'billing'>('billing');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingUsageExpanded, setBillingUsageExpanded] = useState(false);
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
  const [projectToDelete, setProjectToDelete] = useState<ProjectRecord | null>(null);
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
  const [adminMaintenanceReports, setAdminMaintenanceReports] = useState<AdminMaintenanceReportSummary[]>([]);
  const [adminMaintenanceLoaded, setAdminMaintenanceLoaded] = useState(false);
  const [adminMaintenanceBusy, setAdminMaintenanceBusy] = useState(false);
  const [adminDetailBusy, setAdminDetailBusy] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminDeepHealthBusy, setAdminDeepHealthBusy] = useState(false);
  const [adminRepairBusy, setAdminRepairBusy] = useState<AdminProjectRepairAction | null>(null);
  const [adminDeepHealthByProject, setAdminDeepHealthByProject] = useState<Record<string, ProjectAdminDeepHealth>>({});
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
  const [downloadStageText, setDownloadStageText] = useState('');
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
  const navigateToRouteRef = useRef<(nextRoute: AppRoute) => void>(() => undefined);

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
  const showRecoverUploadAction = Boolean(!activeLocalDraft && !uploadActive && currentProject?.status === 'uploading');
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
    ? uploadProgressLabel
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
  const adminSelectedProjectDeepHealth = adminSelectedProject
    ? adminDeepHealthByProject[adminSelectedProject.id] ?? adminSelectedProject.adminDeepHealth ?? null
    : null;
  const adminSelectedProjectCanRetryFailed = adminSelectedProjectFailedItems.some(
    (item) => !item.resultUrl
  );
  const adminSelectedProjectCanMarkStalled = Boolean(
    adminSelectedProject &&
      (adminSelectedProject.status === 'uploading' ||
        adminSelectedProject.status === 'processing' ||
        adminSelectedProject.job?.status === 'pending' ||
        adminSelectedProject.job?.status === 'processing')
  );
  const adminProjectHealthCounts = useMemo(
    () =>
      adminProjects.reduce(
        (counts, project) => {
          const status = project.adminHealth?.status ?? 'idle';
          if (status === 'healthy') counts.healthy += 1;
          else if (status === 'attention') counts.attention += 1;
          else if (status === 'processing') counts.processing += 1;
          else counts.idle += 1;
          return counts;
        },
        { healthy: 0, attention: 0, processing: 0, idle: 0 }
      ),
    [adminProjects]
  );
  const adminPriorityProjects = useMemo(
    () =>
      adminProjects
        .map((project) => {
          const health = project.adminHealth;
          if (health?.reviewed) {
            return { project, score: 0, errorCount: 0, warningCount: 0 };
          }
          const errorCount = health?.issues?.filter((issue) => issue.severity === 'error').length ?? 0;
          const warningCount = health?.issues?.filter((issue) => issue.severity !== 'error').length ?? 0;
          const failedDownload = health?.latestDownloadJob?.status === 'failed' ? 1 : 0;
          const failedItems = health?.failedCount ?? project.hdrItems.filter((item) => item.status === 'error').length;
          const stalled = health?.recommendedActions?.includes('mark-stalled-failed') ? 1 : 0;
          const score = errorCount * 100 + failedItems * 25 + failedDownload * 20 + stalled * 30 + warningCount * 10;
          return { project, score, errorCount, warningCount };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          return Date.parse(right.project.updatedAt) - Date.parse(left.project.updatedAt);
        })
        .slice(0, 5),
    [adminProjects]
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
    if (activeRoute !== 'admin' || !hasAdminSession || adminMaintenanceLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminMaintenanceBusy(true);
      fetchAdminMaintenanceReports()
        .then((response) => {
          if (cancelled) return;
          setAdminMaintenanceReports(response.items);
          setAdminMaintenanceLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminMaintenanceLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '维护报告读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminMaintenanceBusy(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminMaintenanceLoaded, hasAdminSession, locale]);

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

  const confirmCheckoutSessionWithRetry = useCallback(async (sessionId: string) => {
    const maxAttempts = 10;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await confirmCheckoutSession(sessionId);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof ApiRequestError &&
          (error.status === 402 || error.status === 409 || error.status === 425 || error.status === 502 || error.status === 503);
        if (!retryable || attempt === maxAttempts) {
          throw error;
        }
        setMessage(
          locale === 'en'
            ? `Confirming Stripe payment... (${attempt}/${maxAttempts})`
            : `正在确认 Stripe 付款...（${attempt}/${maxAttempts}）`
        );
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(copy.topUpFailed);
  }, [copy.topUpFailed, locale]);

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

  function collectUploadedObjectReferencesFromProject(project: ProjectRecord) {
    const uploads: UploadedObjectReference[] = [];
    const seen = new Set<string>();
    for (const hdrItem of project.hdrItems) {
      for (const exposure of hdrItem.exposures) {
        const storageKey = (exposure as typeof exposure & { storageKey?: string | null }).storageKey;
        if (!storageKey) {
          continue;
        }
        const uploaded = {
          originalName: exposure.originalName || exposure.fileName,
          mimeType: exposure.mimeType || 'application/octet-stream',
          size: exposure.size,
          storageKey
        };
        const identity = getUploadReferenceIdentity(uploaded);
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        uploads.push(uploaded);
      }
    }
    return uploads;
  }

  async function refreshBilling() {
    if (isDemoMode || !session) {
      return null;
    }

    const response = await fetchBilling();
    syncBilling(response);
    return response;
  }

  function getProcessingCreditRequirement() {
    if (!currentProject) {
      return 0;
    }
    const estimate = activeLocalDraft ? workspacePointsEstimate : currentProject.pointsEstimate;
    return Math.max(0, Math.round(estimate));
  }

  function rememberStripeReturnProject(projectId: string | null | undefined = currentProjectId) {
    if (!projectId) {
      return;
    }
    window.sessionStorage.setItem(STRIPE_RETURN_PROJECT_STORAGE_KEY, projectId);
  }

  function readStripeReturnProject() {
    const projectId = window.sessionStorage.getItem(STRIPE_RETURN_PROJECT_STORAGE_KEY);
    window.sessionStorage.removeItem(STRIPE_RETURN_PROJECT_STORAGE_KEY);
    return projectId?.trim() || null;
  }

  function selectRecommendedRechargePackage(shortfall: number) {
    if (!shortfall || !billingPackages.length) {
      return;
    }
    const sorted = [...billingPackages].sort((left, right) => left.points - right.points);
    const recommended = sorted.find((item) => item.points >= shortfall) ?? sorted[sorted.length - 1] ?? null;
    if (recommended) {
      setSelectedBillingPackageId(recommended.id);
      setCustomRechargeAmount('');
    }
  }

  function openRechargeForInsufficientCredits(requiredPoints: number, availablePoints: number) {
    const shortfall = Math.max(0, requiredPoints - availablePoints);
    rememberStripeReturnProject();
    setBillingModalMode('topup');
    setBillingOpen(false);
    openRecharge();
    selectRecommendedRechargePackage(shortfall);
    const message =
      locale === 'en'
        ? `Insufficient credits: this project needs ${requiredPoints} pts, and your balance is ${availablePoints} pts. Please recharge to continue.`
        : `积分不足：这个项目需要 ${requiredPoints} 积分，当前余额 ${availablePoints} 积分。请先充值后继续。`;
    setRechargeMessage(message);
    setMessage(message);
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
      void confirmCheckoutSessionWithRetry(stripeSessionId)
        .then((response) => {
          const returnProjectId = readStripeReturnProject();
          syncBilling(response.billing);
          setRechargeOpen(false);
          setBillingModalMode('billing');
          setBillingOpen(false);
          if (returnProjectId) {
            setCurrentProjectId(returnProjectId);
            navigateToRouteRef.current('studio');
          } else {
            navigateToRouteRef.current('billing');
          }
          setCustomRechargeAmount('');
          setRechargeActivationCode('');
          setRechargeMessage('');
          setMessage(
            returnProjectId
              ? locale === 'en'
                ? 'Credits updated. You can continue this project.'
                : '余额已更新，可以继续处理当前项目。'
              : `${copy.topUpSuccess} ${copy.stripePaymentSuccessTitle}`
          );
        })
        .catch((error) => {
          setBillingModalMode('billing');
          setBillingOpen(false);
          navigateToRouteRef.current('billing');
          setMessage(
            getUserFacingErrorMessage(
              error,
              locale === 'en'
                ? 'Stripe payment is still being confirmed. Please refresh billing in a moment if credits do not appear.'
                : 'Stripe 付款可能仍在确认中。如果积分暂未到账，请稍后刷新账单。',
              locale
            )
          );
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
    confirmCheckoutSessionWithRetry,
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
      void fetchAdminProjectDetail(adminSelectedProject.id)
        .then((response) => {
          setAdminDetailProjects((current) =>
            current.map((project) => (project.id === response.project.id ? response.project : project))
          );
          setAdminProjects((current) =>
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
    const nextSearch = isDemoMode ? '?demo=1' : '';
    const nextUrl = `${nextPath}${nextSearch}${window.location.hash}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextUrl);
    }
    setActiveRoute(resolvedRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  navigateToRouteRef.current = navigateToRoute;

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
      const response = await refundAdminOrder(adminRefundOrder.id, { email: adminRefundOrder.email });
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
      const response = await fetchAdminProjectDetail(projectId);
      setAdminDetailProjects((current) => {
        const exists = current.some((project) => project.id === response.project.id);
        if (!exists) {
          return [response.project, ...current];
        }
        return current.map((project) => (project.id === response.project.id ? response.project : project));
      });
      setAdminProjects((current) => current.map((project) => (project.id === response.project.id ? response.project : project)));
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

  async function handleAdminRunDeepHealth() {
    if (!adminSelectedProject) {
      return;
    }

    setAdminDeepHealthBusy(true);
    setAdminMessage('');
    try {
      const response = await runAdminProjectDeepHealth(adminSelectedProject.id);
      setAdminDeepHealthByProject((current) => ({
        ...current,
        [adminSelectedProject.id]: response.deepHealth
      }));
      setAdminProjects((current) => current.map((project) => (project.id === response.project.id ? response.project : project)));
      setAdminDetailProjects((current) => {
        const exists = current.some((project) => project.id === response.project.id);
        return exists
          ? current.map((project) => (project.id === response.project.id ? response.project : project))
          : [response.project, ...current];
      });
      setAdminMessage(
        response.deepHealth.status === 'passed'
          ? `深度巡检通过：检查了 ${response.deepHealth.checkedObjects} 个 R2 对象。`
          : `深度巡检发现 ${response.deepHealth.issueCount} 个问题。`
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '深度巡检失败。', locale));
    } finally {
      setAdminDeepHealthBusy(false);
    }
  }

  async function handleAdminRepairSelectedProject(action: AdminProjectRepairAction) {
    if (!adminSelectedProject) {
      return;
    }
    if (
      action === 'mark-stalled-failed' &&
      !window.confirm(`确认将项目 "${adminSelectedProject.name}" 标记为失败？这个动作会写入后台审计日志。`)
    ) {
      return;
    }
    const acknowledgeNote =
      action === 'acknowledge-maintenance'
        ? window.prompt(
            `确认将项目 "${adminSelectedProject.name}" 的当前维护提示标记为已审核？之后同一批问题不会再进入优先处理。`,
            '当前照片无需重新处理，已人工审核。'
          )
        : null;
    if (action === 'acknowledge-maintenance' && acknowledgeNote === null) {
      return;
    }

    setAdminRepairBusy(action);
    setAdminMessage('');
    try {
      const response = await repairAdminProject(adminSelectedProject.id, action, { note: acknowledgeNote ?? undefined });
      setAdminProjects((current) => current.map((project) => (project.id === response.project.id ? response.project : project)));
      setAdminDetailProjects((current) => {
        const exists = current.some((project) => project.id === response.project.id);
        return exists
          ? current.map((project) => (project.id === response.project.id ? response.project : project))
          : [response.project, ...current];
      });
      setAdminMessage(response.summary.message || '修复动作已提交。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '项目修复失败。', locale));
    } finally {
      setAdminRepairBusy(null);
    }
  }

  function handleAdminRecommendedProjectAction(action: string) {
    if (action === 'deep-health') {
      void handleAdminRunDeepHealth();
      return;
    }
    if (
      action === 'retry-failed-processing' ||
      action === 'regenerate-download' ||
      action === 'mark-stalled-failed' ||
      action === 'acknowledge-maintenance'
    ) {
      void handleAdminRepairSelectedProject(action);
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
          note: adminAdjustment.note.trim() || (adminAdjustment.type === 'credit' ? 'Manual credit' : 'Manual charge')
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
      const response = await deleteAdminUser(userId, { email: confirmationText });
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

  async function handleAdminLoadMaintenanceReports() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminMaintenanceBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminMaintenanceReports();
      setAdminMaintenanceReports(response.items);
      setAdminMaintenanceLoaded(true);
      setAdminMessage(`已载入 ${response.items.length} 份维护报告。`);
    } catch (error) {
      setAdminMaintenanceLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '维护报告读取失败。', locale));
    } finally {
      setAdminMaintenanceBusy(false);
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

    if (isDemoMode) {
      closeDownloadDialog(true);
      setMessage(copy.downloadDemo);
      return;
    }

    setDownloadBusy(true);
    setDownloadStageText('');
    try {
      const payload = buildDownloadPayload();
      const stageLabels: Record<string, string> = {
        queued: copy.downloadStageQueued,
        preflight: copy.downloadStagePreflight,
        packaging: copy.downloadStagePackaging,
        uploading: copy.downloadStageUploading,
      };
      const { downloadUrl, fileName, revoke } = await downloadProjectArchive(
        downloadProject.id,
        payload,
        (job) => { setDownloadStageText(stageLabels[job.status] ?? ''); }
      );
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
      setDownloadStageText('');
    }
  }

  function handleDownloadProject(project: ProjectRecord) {
    if (!project.downloadReady) {
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
      navigateToRoute('billing');
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
    setBillingOpen(false);
    navigateToRoute('billing');
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
      rememberStripeReturnProject();
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

    const { supported, unsupported, ignoredRawSidecars } = filterSupportedImportFiles(Array.from(files));
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
    setMessage(
      [
        unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
        ignoredRawSidecars.length ? copy.uploadRawSidecarFiles(ignoredRawSidecars.length) : ''
      ]
        .filter(Boolean)
        .join(' ')
    );
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

    const filesToUpload = createDialogFiles;
    setBusy(true);
    try {
      const response = await createProject({
        name: newProjectName.trim(),
        address: newProjectAddress.trim(),
        studioFeatureId: selectedFeature.id
      });
      upsertProject(response.project);
      setCurrentProjectId(response.project.id);
      setCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectAddress('');
      setCreateDialogFiles([]);
      setCreateDialogDragActive(false);
      setMessage('');
      if (filesToUpload.length) {
        await handleUploadForProject(response.project, filesToUpload);
      }
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

  function handleDeleteProject(project: ProjectRecord) {
    setProjectToDelete(project);
  }

  async function handleConfirmDeleteProject() {
    if (!projectToDelete) return;
    const project = projectToDelete;
    const wasCurrentProject = currentProjectId === project.id;
    setProjectToDelete(null);
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setCurrentProjectId((current) => (current === project.id ? null : current));
    setBusy(true);
    try {
      await deleteProject(project.id);
      clearLocalImportDraft(project.id);
      setMessage('');
    } catch (error) {
      setProjects((current) => (current.some((item) => item.id === project.id) ? current : [project, ...current]));
      if (wasCurrentProject) {
        setCurrentProjectId(project.id);
      }
      setMessage(getUserFacingErrorMessage(error, copy.deleteProjectFailed, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadForProject(targetProject: ProjectRecord, files: FileList | File[] | null) {
    if (!files || files.length === 0) return;

    const { supported, unsupported, ignoredRawSidecars } = filterSupportedImportFiles(Array.from(files));
    if (!supported.length) {
      setMessage(copy.uploadNoSupportedFiles);
      return;
    }

    const existingDraft = localImportDrafts[targetProject.id] ?? null;
    const uploadedObjects = mergeUploadedObjectReferences(
      existingDraft?.uploadedObjects,
      collectUploadedObjectReferencesFromProject(targetProject)
    );
    setBusy(true);
    setUploadActive(true);
    setUploadMode('local');
    setUploadPercent(0);
    setUploadSnapshot(null);
    setDragActive(false);
    try {
      const { buildLocalImportDraft } = await loadLocalImportModule();
      const nextDraft = await buildLocalImportDraft(targetProject.id, supported, setUploadPercent, { previewMode: 'embedded' });
      const nextDraftWithUploads: LocalImportDraft = {
        ...nextDraft,
        uploadedObjects,
        uploadStatus: existingDraft?.uploadStatus ?? 'idle'
      };
      const response = await patchProject(targetProject.id, { currentStep: 2, status: 'review' });
      upsertProject(response.project);
      if (existingDraft) {
        const merged = mergeLocalImportDrafts(existingDraft, nextDraftWithUploads);
        const mergedDraft: LocalImportDraft = {
          ...merged.draft,
          uploadedObjects: mergeUploadedObjectReferences(merged.draft.uploadedObjects, uploadedObjects),
          uploadStatus: existingDraft.uploadStatus ?? 'idle'
        };
        updateLocalImportDraft(targetProject.id, () => mergedDraft);
        merged.unusedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        const notices = [
          unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
          ignoredRawSidecars.length ? copy.uploadRawSidecarFiles(ignoredRawSidecars.length) : '',
          merged.duplicateCount ? copy.uploadDuplicateFiles(merged.duplicateCount) : ''
        ].filter(Boolean);
        setMessage(notices.join(' '));
      } else {
        upsertLocalImportDraft(nextDraftWithUploads);
        const notices = [
          unsupported.length ? copy.uploadUnsupportedFiles(unsupported.length) : '',
          ignoredRawSidecars.length ? copy.uploadRawSidecarFiles(ignoredRawSidecars.length) : ''
        ].filter(Boolean);
        setMessage(notices.join(' '));
      }
    } catch (error) {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
      setMessage(getUserFacingErrorMessage(error, copy.uploadFailed, locale));
    } finally {
      setUploadActive(false);
      setUploadMode(null);
      setUploadPercent(0);
      setUploadSnapshot(null);
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
      if (!options.retryFailed) {
        const requiredPoints = getProcessingCreditRequirement();
        let availablePoints = billingSummary?.availablePoints ?? null;
        const refreshedBilling = await refreshBilling().catch(() => null);
        availablePoints = refreshedBilling?.summary.availablePoints ?? availablePoints;
        if (availablePoints !== null && requiredPoints > availablePoints) {
          openRechargeForInsufficientCredits(requiredPoints, availablePoints);
          return;
        }
      }

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
        let uploadedObjects = [...(activeLocalDraft.uploadedObjects ?? [])];
        const completedFileIdentities = new Set(
          uploadedObjects.map((uploaded) => getUploadReferenceIdentity(uploaded))
        );
        const uploadTotalGroups = Math.max(1, uploadHdrItems.length);
        const isHdrItemUploaded = (hdrItem: LocalHdrItemDraft) => {
          const groupFiles = collectLocalHdrItemFiles(hdrItem);
          return (
            groupFiles.length > 0 &&
            groupFiles.every((file) =>
              completedFileIdentities.has(getUploadReferenceIdentity({ originalName: file.name, size: file.size }))
            )
          );
        };
        const completedHdrItemIds = new Set(
          uploadHdrItems.filter((hdrItem) => isHdrItemUploaded(hdrItem)).map((hdrItem) => hdrItem.id)
        );
        const filesByUploadIdentity = new Map<string, File>();
        const uploadIdentityToHdrItemId = new Map<string, string>();
        for (const hdrItem of uploadHdrItems) {
          const groupFiles = collectLocalHdrItemFiles(hdrItem);
          for (const file of groupFiles) {
            if (retryUploadFileIdentity && getLocalFileUploadIdentity(file) !== retryUploadFileIdentity) {
              continue;
            }
            const identity = getLocalFileUploadIdentity(file);
            if (!filesByUploadIdentity.has(identity)) {
              filesByUploadIdentity.set(identity, file);
              uploadIdentityToHdrItemId.set(identity, hdrItem.id);
            }
          }
        }
        const uploadFilesForRun = Array.from(filesByUploadIdentity.values());
        const updateAggregateUploadProgress = (
          stage: UploadProgressSnapshot['stage'] = 'uploading',
          details: Pick<Partial<UploadProgressSnapshot>, 'currentFileName' | 'attempt' | 'maxAttempts' | 'offline'> = {},
          percentOverride?: number
        ) => {
          const uploadedGroups = Math.min(uploadTotalGroups, completedHdrItemIds.size);
          const percent =
            stage === 'completed'
              ? 100
              : percentOverride === undefined
                ? Math.max(1, Math.min(99, Math.round((uploadedGroups / uploadTotalGroups) * 100)))
                : Math.max(1, Math.min(99, Math.round(percentOverride)));
          setUploadPercent(percent);
          setUploadSnapshot({
            stage,
            percent,
            uploadedFiles: uploadedGroups,
            totalFiles: uploadTotalGroups,
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
        };
        const rememberFailedUploadFile = (failed: FailedUploadFile) => {
          const hdrItemId = uploadIdentityToHdrItemId.get(failed.fileIdentity) ?? '';
          const entry: FailedUploadEntry = { ...failed, hdrItemId };
          failedUploadBuffer = [...failedUploadBuffer.filter((item) => item.fileIdentity !== failed.fileIdentity), entry];
          setFailedUploadFiles(failedUploadBuffer);
        };
        setUploadActive(true);
        setUploadMode('originals');
        const initialUploadPercent = Math.max(1, Math.min(99, Math.round((completedHdrItemIds.size / uploadTotalGroups) * 100)));
        setUploadPercent(initialUploadPercent);
        setUploadSnapshot({
          stage: 'preparing',
          percent: initialUploadPercent,
          uploadedFiles: Math.min(uploadTotalGroups, completedHdrItemIds.size),
          totalFiles: uploadTotalGroups
        });
        setMessage(copy.uploadOriginalsDoNotClose);

        const uploadStep = await patchProject(projectId, { currentStep: 3, status: 'uploading' }).catch(() => null);
        if (uploadStep?.project) {
          upsertProject(uploadStep.project);
        }

        updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'uploading' }));

        if (uploadFilesForRun.length) {
          const existingUploadsForRun = getUploadedObjectsForFiles(uploadedObjects, uploadFilesForRun);
          try {
            const uploadResponse = await uploadFiles(projectId, uploadFilesForRun, (_percent, snapshot) => {
              const stage =
                snapshot?.stage === 'paused' ||
                snapshot?.stage === 'retrying' ||
                snapshot?.stage === 'verifying' ||
                snapshot?.stage === 'preparing'
                  ? snapshot.stage
                  : 'uploading';
              updateAggregateUploadProgress(
                stage,
                {
                  currentFileName: snapshot?.currentFileName,
                  attempt: snapshot?.attempt,
                  maxAttempts: snapshot?.maxAttempts,
                  offline: snapshot?.offline
                },
                snapshot?.percent
              );
            }, {
              signal: uploadAbortController.signal,
              completedObjects: existingUploadsForRun,
              onFileUploaded: rememberUploadedObject,
              onFileFailed: rememberFailedUploadFile,
              pauseController: uploadPauseControllerRef.current,
              continueOnFileError: true
            });
            uploadedObjects = mergeUploadedObjectReferences(
              uploadedObjects,
              'directUploadFiles' in uploadResponse ? uploadResponse.directUploadFiles : getUploadedObjectsForFiles(uploadedObjects, uploadFilesForRun)
            );
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              throw error;
            }
            throw error;
          }
        }

        if (retryUploadFileIdentity && !failedUploadBuffer.some((file) => file.fileIdentity === retryUploadFileIdentity)) {
          failedUploadBuffer = failedUploadBuffer.filter((file) => file.fileIdentity !== retryUploadFileIdentity);
          setFailedUploadFiles(failedUploadBuffer);
        }

        for (const hdrItem of uploadHdrItems) {
          const allGroupFiles = collectLocalHdrItemFiles(hdrItem);
          const groupUploads = getUploadedObjectsForFiles(uploadedObjects, allGroupFiles);
          if (groupUploads.length < allGroupFiles.length) {
            continue;
          }
          for (const file of allGroupFiles) {
            completedFileIdentities.add(getUploadReferenceIdentity({ originalName: file.name, size: file.size }));
          }
          completedHdrItemIds.add(hdrItem.id);
        }

        updateAggregateUploadProgress(failedUploadBuffer.length ? 'uploading' : 'finalizing', {}, failedUploadBuffer.length ? undefined : 96);

        if (failedUploadBuffer.length) {
          updateLocalImportDraft(projectId, (draft) => ({ ...draft, uploadStatus: 'paused', uploadedObjects }));
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

        const completedLayoutResponse = await applyHdrLayout(projectId, buildHdrLayoutPayload(activeLocalDraft, uploadedObjects), {
          mode: 'replace',
          inputComplete: true
        });
        const syncedProject = completedLayoutResponse.project;
        setUploadPercent(100);
        setUploadSnapshot({
          stage: 'completed',
          percent: 100,
          uploadedFiles: uploadTotalGroups,
          totalFiles: uploadTotalGroups
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
        openRechargeForInsufficientCredits(getProcessingCreditRequirement(), billingSummary?.availablePoints ?? 0);
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

  function getStripeInvoiceLink(order: PaymentOrderRecord | null | undefined) {
    if (!order) {
      return null;
    }

    const url = order.stripeInvoicePdfUrl || order.stripeInvoiceUrl;
    return url ? { label: copy.stripeInvoiceLink, url } : null;
  }

  function renderStripeInvoiceLink(order: PaymentOrderRecord | null | undefined) {
    const link = getStripeInvoiceLink(order);
    if (!link) {
      return <span className="stripe-doc-pending">{copy.stripeDocumentsPending}</span>;
    }

    return (
      <a className="ghost-button small stripe-doc-link" href={link.url} target="_blank" rel="noreferrer">
        {link.label}
      </a>
    );
  }

  function renderBillingRechargeLayer() {
    return (
      <BillingPanel
        billingOpen={billingOpen}
        billingBusy={billingBusy}
        billingModalMode={billingModalMode}
        copy={copy}
        billingSummary={billingSummary}
        locale={locale}
        openRecharge={openRecharge}
        setBillingOpen={setBillingOpen}
        rechargeOpen={rechargeOpen}
        setRechargeOpen={setRechargeOpen}
        setRechargeMessage={setRechargeMessage}
        rechargeActivationCode={rechargeActivationCode}
        setRechargeActivationCode={setRechargeActivationCode}
        rechargeMessage={rechargeMessage}
        handleRedeemActivationCode={handleRedeemActivationCode}
        customRechargeIsActive={customRechargeIsActive}
        customRechargeAmount={customRechargeAmount}
        setCustomRechargeAmount={setCustomRechargeAmount}
        customRechargeAmountUsd={customRechargeAmountUsd}
        customRechargePoints={customRechargePoints}
        billingPackages={billingPackages}
        activeBillingPackageId={activeBillingPackageId}
        setSelectedBillingPackageId={setSelectedBillingPackageId}
        selectedBillingPackage={selectedBillingPackage}
        handleTopUp={handleTopUp}
      />
    );
  }

  function renderBillingPage() {
    const usageEntries = billingEntries.filter((entry) => entry.type === 'charge' && !isAdminBillingAdjustmentEntry(entry));
    const paidOrders = billingOrders.filter((order) => order.status === 'paid' || order.status === 'refunded');
    return (
      <>
        <main className="billing-page studio-shell">
          <div className="ambient-layer studio-ambient" />
          <header className="studio-header billing-page-header">
            <button className="brand-button" type="button" onClick={() => navigateToRoute('studio')}>
              <span className="studio-brand-mark-shell" aria-hidden="true">
                <img className="studio-brand-mark" src={logoMark} alt="Metrovan AI" decoding="async" />
              </span>
              <span className="brand-copy">
                <strong>{copy.studioLabel}</strong>
                <em>{copy.billingTitle}</em>
              </span>
            </button>
            <div className="header-actions billing-page-actions">
              <button className="ghost-button" type="button" onClick={() => navigateToRoute('studio')}>
                {locale === 'en' ? 'Back to studio' : '返回工作台'}
              </button>
              <button className="solid-button small" type="button" onClick={openRecharge} disabled={billingBusy}>
                {copy.billingOpenRecharge}
              </button>
            </div>
          </header>

          {message ? <div className="global-message">{message}</div> : null}

          <section className="workspace billing-page-workspace">
            <div className="billing-page-hero">
              <div>
                <span className="eyebrow">{locale === 'en' ? 'Credits & payments' : '积分和付款'}</span>
                <h1>{copy.billingTitle}</h1>
                <p>{copy.billingHint}</p>
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
            </div>

            <div className="billing-page-grid">
            <article className="billing-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Balance check' : '余额核对'}</strong>
                  <span className="muted">
                    {locale === 'en' ? 'Credits in - credits used = balance.' : '入账积分 - 扣点积分 = 当前余额。'}
                  </span>
                </div>
              </div>
              <div className="billing-summary-grid">
                <article className="billing-stat-card">
                  <span>{locale === 'en' ? 'Credits in' : '入账积分'}</span>
                  <strong>{billingSummary?.totalCreditedPoints ?? 0} pts</strong>
                </article>
                <article className="billing-stat-card">
                  <span>{locale === 'en' ? 'Credits used' : '扣点积分'}</span>
                  <strong>{billingSummary?.totalChargedPoints ?? 0} pts</strong>
                </article>
                <article className="billing-stat-card">
                  <span>{copy.billingCurrentBalance}</span>
                  <strong>{billingSummary?.availablePoints ?? 0} pts</strong>
                </article>
              </div>
            </article>

            <article className="billing-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Credit usage' : '积分使用情况'}</strong>
                  <span className="muted">
                    {usageEntries.length
                      ? locale === 'en'
                        ? `${usageEntries.length} records.`
                        : `${usageEntries.length} 条扣点记录，默认收起，打开后查看明细。`
                      : locale === 'en'
                        ? 'No records.'
                        : '暂无记录。'}
                  </span>
                </div>
                {usageEntries.length ? (
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() => setBillingUsageExpanded((current) => !current)}
                  >
                    {billingUsageExpanded
                      ? locale === 'en' ? 'Hide details' : '收起明细'
                      : locale === 'en' ? 'View details' : '展开明细'}
                  </button>
                ) : null}
              </div>
              {usageEntries.length ? (
                billingUsageExpanded ? (
                  <div className="billing-entry-list">
                    {usageEntries.map((entry) => (
                      <article key={entry.id} className="billing-entry-row">
                        <div>
                          <strong>{entry.projectName || entry.note}</strong>
                          <span>{entry.note} · {formatDate(entry.createdAt, locale)}</span>
                        </div>
                        <div className="billing-entry-amount charge">
                          <strong>-{entry.points} pts</strong>
                          <span>{formatUsd(entry.amountUsd, locale)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null
              ) : (
                <div className="empty-state billing-empty-state">
                  <strong>{locale === 'en' ? 'No credit usage yet' : '暂无积分使用记录'}</strong>
                </div>
              )}
            </article>

            <article className="billing-section billing-recharge-section">
              <div className="panel-head compact">
                <div>
                  <strong>{locale === 'en' ? 'Recharge records' : '充值记录'}</strong>
                  <span className="muted">{locale === 'en' ? 'Amount and Stripe invoice.' : '每次充值金额和 Invoice。'}</span>
                </div>
              </div>
              {paidOrders.length ? (
                <div className="billing-entry-list">
                  {paidOrders.map((order) => (
                    <article key={order.id} className="billing-entry-row billing-recharge-row">
                      <div>
                        <strong>{formatUsd(order.amountUsd, locale)}</strong>
                        <span>
                          {order.packageName} · {order.points} pts · {formatPaymentOrderStatus(order.status)} · {formatDate(order.paidAt ?? order.createdAt, locale)}
                        </span>
                      </div>
                      <div className="billing-entry-amount credit">
                        <strong>+{order.points} pts</strong>
                        <span>{formatUsd(order.amountUsd, locale)}</span>
                        {renderStripeInvoiceLink(order)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state billing-empty-state">
                  <strong>{locale === 'en' ? 'No recharge records yet' : '暂无充值记录'}</strong>
                  <span>{copy.noBillingHint}</span>
                </div>
              )}
            </article>
            </div>
          </section>
        </main>
        {renderBillingRechargeLayer()}
      </>
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
    const userAvatarClass = (index: number) => `user-avatar user-avatar-${(index % 5) + 1}`;
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
                    <div className={userAvatarClass(index)}>
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
                            <div className={userAvatarClass(index)}>{getAdminInitials(user.displayName || user.email)}</div>
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
                    onChange={(event) => {
                      const nextType = event.target.value as 'credit' | 'charge';
                      setAdminAdjustment((current) => {
                        const shouldUseDefaultNote = !current.note.trim() || current.note === 'Manual credit' || current.note === 'Manual charge';
                        return {
                          ...current,
                          type: nextType,
                          note: shouldUseDefaultNote ? (nextType === 'credit' ? 'Manual credit' : 'Manual charge') : current.note
                        };
                      });
                    }}
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

    const getProjectHealthLabel = (project: ProjectRecord) => {
      const status = project.adminHealth?.status;
      if (status === 'healthy') return '健康';
      if (status === 'attention') return '需检查';
      if (status === 'processing') return '处理中';
      return '待观察';
    };
    const getProjectHealthTagClass = (project: ProjectRecord) => {
      const status = project.adminHealth?.status;
      if (status === 'healthy') return 'tag tag-green';
      if (status === 'attention') return 'tag tag-red';
      if (status === 'processing') return 'tag tag-orange';
      return 'tag tag-gray';
    };
    const getAdminRepairActionLabel = (action: string) => {
      if (action === 'retry-failed-processing') return '重试失败照片';
      if (action === 'regenerate-download') return '重新生成下载包';
      if (action === 'mark-stalled-failed') return '标记卡住失败';
      if (action === 'acknowledge-maintenance') return '标记已审核';
      if (action === 'deep-health') return '深度巡检';
      return action;
    };
    const getAdminPriorityLabel = (score: number) => {
      if (score >= 100) return '高优先级';
      if (score >= 40) return '中优先级';
      return '低优先级';
    };

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
        <div className="kpi-grid">
          {kpi('健康项目', <>{adminProjectHealthCounts.healthy}<span className="unit">项</span></>, <><span>可下载</span><span className="vs">结果完整</span></>)}
          {kpi('需检查', <>{adminProjectHealthCounts.attention}<span className="unit">项</span></>, <><span>失败/缺失/可疑</span><span className="vs">优先处理</span></>, adminProjectHealthCounts.attention ? 'down' : 'up')}
          {kpi('处理中', <>{adminProjectHealthCounts.processing}<span className="unit">项</span></>, <><span>队列</span><span className="vs">实时刷新</span></>)}
          {kpi('下载异常', <>{adminProjects.filter((project) => project.adminHealth?.latestDownloadJob?.status === 'failed').length}<span className="unit">项</span></>, <><span>最近任务</span><span className="vs">下载包</span></>, adminProjects.some((project) => project.adminHealth?.latestDownloadJob?.status === 'failed') ? 'down' : 'up')}
        </div>
        <div className="card admin-priority-queue">
          <div className="admin-mini-head">
            <strong>待处理队列</strong>
            <span>{adminPriorityProjects.length ? `优先处理 ${adminPriorityProjects.length} 项` : '暂无异常'}</span>
          </div>
          {adminPriorityProjects.length ? (
            <div className="admin-priority-list">
              {adminPriorityProjects.map(({ project, score, errorCount, warningCount }) => (
                <button className="admin-priority-row" type="button" key={project.id} onClick={() => void handleAdminSelectProject(project.id)}>
                  <span className={score >= 100 ? 'tag tag-red' : score >= 40 ? 'tag tag-orange' : 'tag tag-gray'}>
                    {getAdminPriorityLabel(score)}
                  </span>
                  <strong>{project.name}</strong>
                  <small>{project.adminHealth?.rootCauseSummary ?? '需要检查项目状态。'}</small>
                  <em>{errorCount} 错误 · {warningCount} 警告 · {formatAdminShortDate(project.updatedAt)}</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="admin-health-ok">当前载入项目没有需要优先处理的健康问题。</div>
          )}
        </div>
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
                        <div className="admin-health-strip">
                          <span className={getProjectHealthTagClass(project)}>{getProjectHealthLabel(project)}</span>
                          <small>{project.adminHealth?.hdrCount ?? project.hdrItems.length} 组 · {project.adminHealth?.resultCount ?? project.resultAssets.length} 结果</small>
                        </div>
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
                <button className="btn btn-ghost btn-xs" type="button" onClick={() => void handleAdminRunDeepHealth()} disabled={adminDeepHealthBusy}>
                  {adminDeepHealthBusy ? '巡检中...' : '深度巡检'}
                </button>
              </div>
            </div>
            <div className="admin-project-live">
              <div className="admin-live-stats">
                <span>失败 {adminSelectedProjectFailedItems.length}</span>
                <span>处理中 {adminSelectedProjectProcessingItems.length}</span>
                <span>结果 {adminSelectedProjectResults.length}</span>
              </div>
              {adminSelectedProject.adminHealth ? (
                <div className="admin-health-panel">
                  <div className="admin-health-head">
                    <span className={getProjectHealthTagClass(adminSelectedProject)}>{getProjectHealthLabel(adminSelectedProject)}</span>
                    <strong>项目健康检查</strong>
                    <small>{adminSelectedProject.adminHealth.latestDownloadJob ? `最近下载：${adminSelectedProject.adminHealth.latestDownloadJob.status}` : '暂无下载任务'}</small>
                  </div>
                  <div className="admin-health-grid">
                    <div><strong>{adminSelectedProject.adminHealth.exposureCount}</strong><span>曝光文件</span></div>
                    <div><strong>{adminSelectedProject.adminHealth.hdrCount}</strong><span>HDR 分组</span></div>
                    <div><strong>{adminSelectedProject.adminHealth.resultCount}</strong><span>结果图</span></div>
                    <div><strong>{adminSelectedProject.adminHealth.missingSourceCount}</strong><span>缺源文件</span></div>
                  </div>
                  <div className="admin-diagnosis-card">
                    <div className="admin-mini-head">
                      <strong>诊断建议</strong>
                      <span>{adminSelectedProject.adminHealth.reviewed ? '已审核' : adminSelectedProject.adminHealth.issues?.length ? `${adminSelectedProject.adminHealth.issues.length} 个原因` : '正常'}</span>
                    </div>
                    <p>{adminSelectedProject.adminHealth.rootCauseSummary ?? '未发现需要处理的项目健康问题。'}</p>
                    {adminSelectedProject.adminHealth.issues?.length ? (
                      <div className="admin-diagnosis-list">
                        {adminSelectedProject.adminHealth.issues.slice(0, 5).map((issue) => (
                          <div className={`admin-diagnosis-item ${issue.severity === 'error' ? 'error' : 'warning'}`} key={issue.code}>
                            <strong>{issue.title}</strong>
                            <span>{issue.detail}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {adminSelectedProject.adminHealth.recommendedActions?.length ? (
                      <div className="admin-recommended-actions">
                        {adminSelectedProject.adminHealth.recommendedActions.map((action) => (
                          <button
                            className={`btn btn-ghost btn-xs ${action === 'mark-stalled-failed' ? 'danger' : ''}`}
                            type="button"
                            key={action}
                            onClick={() => handleAdminRecommendedProjectAction(action)}
                            disabled={Boolean(adminRepairBusy) || (action === 'deep-health' && adminDeepHealthBusy)}
                          >
                            {getAdminRepairActionLabel(action)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {adminSelectedProject.adminHealth.warnings.length ? (
                    <div className="admin-health-warnings">
                      {adminSelectedProject.adminHealth.warnings.slice(0, 6).map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="admin-health-ok">未发现 RAW/JPG 混组、重复源文件或截断结果图风险。</div>
                  )}
                  <div className="admin-repair-actions">
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      onClick={() => void handleAdminRepairSelectedProject('acknowledge-maintenance')}
                      disabled={adminSelectedProject.adminHealth?.reviewed || Boolean(adminRepairBusy)}
                    >
                      {adminRepairBusy === 'acknowledge-maintenance' ? '标记中...' : '标记已审核'}
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      onClick={() => void handleAdminRepairSelectedProject('retry-failed-processing')}
                      disabled={!adminSelectedProjectCanRetryFailed || Boolean(adminRepairBusy)}
                    >
                      {adminRepairBusy === 'retry-failed-processing' ? '重试中...' : '重试失败照片'}
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      onClick={() => void handleAdminRepairSelectedProject('regenerate-download')}
                      disabled={!adminSelectedProjectResults.length || Boolean(adminRepairBusy)}
                    >
                      {adminRepairBusy === 'regenerate-download' ? '生成中...' : '重新生成下载包'}
                    </button>
                    <button
                      className="btn btn-ghost btn-xs danger"
                      type="button"
                      onClick={() => void handleAdminRepairSelectedProject('mark-stalled-failed')}
                      disabled={!adminSelectedProjectCanMarkStalled || Boolean(adminRepairBusy)}
                    >
                      {adminRepairBusy === 'mark-stalled-failed' ? '标记中...' : '标记卡住失败'}
                    </button>
                  </div>
                  {adminSelectedProjectDeepHealth ? (
                    <div className="admin-deep-health">
                      <div className="admin-mini-head">
                        <strong>深度巡检</strong>
                        <span>{adminSelectedProjectDeepHealth.status === 'passed' ? '通过' : `${adminSelectedProjectDeepHealth.issueCount} 个问题`}</span>
                      </div>
                      <div className="admin-health-grid compact">
                        <div><strong>{adminSelectedProjectDeepHealth.checkedObjects}</strong><span>R2 对象</span></div>
                        <div><strong>{adminSelectedProjectDeepHealth.missingObjects}</strong><span>缺失</span></div>
                        <div><strong>{adminSelectedProjectDeepHealth.sizeMismatchObjects}</strong><span>大小不符</span></div>
                        <div><strong>{formatAdminShortDate(adminSelectedProjectDeepHealth.completedAt)}</strong><span>完成时间</span></div>
                      </div>
                      {adminSelectedProjectDeepHealth.issues.length ? (
                        <div className="admin-health-warnings">
                          {adminSelectedProjectDeepHealth.issues.slice(0, 8).map((issue) => (
                            <span key={`${issue.scope}-${issue.name}-${issue.message}`}>
                              {issue.scope} · {issue.name}：{issue.message}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="admin-health-ok">R2 原片、结果图和最近下载包检查通过。</div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                        <button className="tbl-icon" type="button" title={item.redemptionCount > 0 ? '已兑换，无法删除' : '删除'} onClick={() => void handleAdminDeleteActivationCode(item)} disabled={adminActivationBusy || item.redemptionCount > 0}>✕</button>
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
                      <td><div className="user-cell"><div className={userAvatarClass(index)}>{getAdminInitials(entry.actorEmail ?? entry.actorType)}</div><div><div className="name">{entry.actorEmail ?? entry.actorType}</div></div></div></td>
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

    const renderMaintenancePage = () => (
      <div className="page-content active">
        {adminPageTitle(
          '维护报告',
          <>自动巡检历史 · 最近载入 <span className="mono accent-text">{adminMaintenanceReports.length}</span> 份</>,
          <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadMaintenanceReports()} disabled={adminMaintenanceBusy}>
            {adminMaintenanceBusy ? '读取中...' : '刷新报告'}
          </button>
        )}
        <div className="maintenance-report-list">
          {adminMaintenanceReports.map((report) => (
            <article className="card maintenance-report-card" key={report.id}>
              <div className="admin-mini-head">
                <strong>{formatAdminShortDate(report.completedAt ?? report.startedAt ?? '')}</strong>
                <span className={report.ok ? 'tag tag-green' : 'tag tag-red'}>{report.ok ? '通过' : `${report.failedCount} 项异常`}</span>
              </div>
              <div className="admin-health-grid compact">
                <div><strong>{report.totals?.projects ?? '—'}</strong><span>项目</span></div>
                <div><strong>{report.totals?.hdrItems ?? '—'}</strong><span>HDR 项</span></div>
                <div><strong>{report.totals?.downloadJobs ?? '—'}</strong><span>下载任务</span></div>
                <div><strong>{report.alert?.sent ? '已发送' : report.alert?.reason ?? '未发送'}</strong><span>邮件告警</span></div>
              </div>
              {report.alerts.length ? (
                <div className="maintenance-alert-row">
                  {report.alerts.map((alert) => (
                    <span key={alert.code}>{alert.code}: {alert.value}</span>
                  ))}
                </div>
              ) : (
                <div className="admin-health-ok">这份报告没有应用数据异常。</div>
              )}
	              {report.priorityQueue.length ? (
	                <div className="maintenance-priority-list">
                  {report.priorityQueue.map((item, index) => (
                    <div className="maintenance-priority-item" key={`${report.id}-${item.projectId}`}>
                      <span className={item.priority === 'high' ? 'tag tag-red' : item.priority === 'medium' ? 'tag tag-orange' : 'tag tag-gray'}>#{index + 1} {item.priority}</span>
                      <strong>{item.projectName}</strong>
                      <small>{item.rootCauseSummary}</small>
                      <em>{item.recommendedActionLabels?.join(' / ') || '后台查看'}</em>
                    </div>
                  ))}
	                </div>
	              ) : null}
	              {report.reviewedProjects?.length ? (
	                <div className="maintenance-priority-list">
	                  {report.reviewedProjects.map((item) => (
	                    <div className="maintenance-priority-item" key={`${report.id}-reviewed-${item.projectId}`}>
	                      <span className="tag tag-green">已审核</span>
	                      <strong>{item.projectName}</strong>
	                      <small>{item.note || '当前问题无需处理。'}</small>
	                      <em>{item.reviewedBy || '管理员'} · {item.reviewedAt ? formatAdminShortDate(item.reviewedAt) : '时间未知'}</em>
	                    </div>
	                  ))}
	                </div>
	              ) : null}
	              <div className="maintenance-check-grid">
                {report.checks.map((check) => (
                  <span className={check.ok ? 'tag tag-green' : 'tag tag-red'} key={`${report.id}-${check.id}`}>
                    {check.id}{check.alertCount ? ` · ${check.alertCount}` : ''}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {!adminMaintenanceReports.length ? (
            <div className="card">
              <div className="empty-tip">{adminMaintenanceBusy ? '正在读取维护报告...' : '暂无维护报告，等待定时任务生成。'}</div>
            </div>
          ) : null}
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
                  <span className="tag tag-gray admin-inline-gap">{adminSystemSettings?.runningHubMaxInFlight ?? '未读取'} 张 / RunningHub 并发</span>
                </div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">套餐数量</div><div className="desc">前台 Plans 页展示的充值档位数</div></div>
                <div><span className="tag tag-gray">{adminSystemSettings?.billingPackages?.length ?? planPackages.length} 档</span> <button className="btn btn-ghost admin-inline-gap" type="button" onClick={() => setAdminConsolePage('plans')}>管理套餐 →</button></div>
              </div>
              <div className="settings-row">
                <div className="label-side"><div className="name">功能卡片</div><div className="desc">前台 Studio 展示的 AI 功能卡片数</div></div>
                <div><span className="tag tag-gray">{adminSystemSettings?.studioFeatures?.length ?? adminFeatureDrafts.length} 个</span> <button className="btn btn-ghost admin-inline-gap" type="button" onClick={() => setAdminConsolePage('content')}>管理卡片 →</button></div>
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
                  <div className="email admin-account-email">{session?.email ?? '—'}</div>
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
        case 'maintenance':
          return renderMaintenancePage();
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
        <AdminRefundDialog
          order={adminRefundOrder}
          preview={adminRefundPreview}
          busy={adminRefundBusy}
          locale={locale}
          onClose={closeAdminRefundDialog}
          onConfirm={() => void handleAdminConfirmRefund()}
        />
      );
    };

    return (
      <AdminConsole
        adminConsolePage={adminConsolePage}
        adminMessage={adminMessage}
        page={renderActiveAdminPage()}
        pendingProjectCount={pendingProjectCount}
        refundDialog={renderAdminRefundDialog()}
        session={session}
        onNavigateStudio={() => navigateToRoute('studio')}
        onSetPage={setAdminConsolePage}
        onSignOut={() => void signOut()}
      />
    );

  }

  if (activeRoute === 'billing' && session) {
    return renderBillingPage();
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
        <StudioHeader
          billingSummary={billingSummary}
          copy={copy}
          currentProjectId={currentProjectId}
          historyMenuOpen={historyMenuOpen}
          historyMenuRef={historyMenuRef}
          isDemoMode={isDemoMode}
          locale={locale}
          logoMark={logoMark}
          session={session}
          userMenuOpen={userMenuOpen}
          userMenuRef={userMenuRef}
          visibleProjects={visibleProjects}
          onDeleteProject={handleDeleteProject}
          onDownloadProject={handleDownloadProject}
          onOpenBilling={(mode) => void handleOpenBilling(mode)}
          onOpenSettings={openSettings}
          onRenameProject={(project) => void handleRenameProject(project)}
          onReturnToStudioFeatureCards={returnToStudioFeatureCards}
          onSelectProject={(projectId) => {
            setCurrentProjectId(projectId);
            setHistoryMenuOpen(false);
          }}
          onSetHistoryMenuOpen={setHistoryMenuOpen}
          onSetUserMenuOpen={setUserMenuOpen}
          onSignOut={() => void signOut()}
        />

        {message && <div className="global-message">{message}</div>}

        <div className="studio-layout">
          <section className="workspace">
            {!currentProject ? (
              <StudioFeatureLaunchPanel
                availableFeatureCount={availableFeatureCount}
                locale={locale}
                visibleStudioFeatures={visibleStudioFeatures}
                onOpenFeatureProjectDialog={openFeatureProjectDialog}
              />
            ) : (
              <>
                <ProjectWorkspaceHeader
                  copy={copy}
                  isDemoMode={isDemoMode}
                  locale={locale}
                  project={currentProject}
                  onRenameProject={(project) => void handleRenameProject(project)}
                  onReturnToStudioFeatureCards={returnToStudioFeatureCards}
                />

                <ProjectStepStrip
                  activeStepLabels={activeStepLabels}
                  copy={copy}
                  project={currentProject}
                  getMaxNavigableStep={getMaxNavigableStep}
                  onStepClick={(step) => void handleStepClick(step)}
                />

                {showProcessingStepContent && !isDemoMode && (
                  <ProcessingStatusPanel
                    busy={busy}
                    copy={copy}
                    locale={locale}
                    processingPanelDetail={processingPanelDetail}
                    processingPanelTitle={processingPanelTitle}
                    project={currentProject}
                    showProcessingUploadProgress={showProcessingUploadProgress}
                    showRecoverUploadAction={showRecoverUploadAction}
                    showResumeUploadAction={showResumeUploadAction}
                    showRetryProcessingAction={showRetryProcessingAction}
                    uploadPaused={uploadPaused}
                    uploadPercent={uploadPercent}
                    workspacePointsEstimate={workspacePointsEstimate}
                    onCancelUpload={handleCancelUpload}
                    onPauseUpload={handlePauseUpload}
                    onRecoverUploadFiles={triggerFilePicker}
                    onResumeProcessingUpload={() => void handleStartProcessing()}
                    onResumeUpload={handleResumeUpload}
                    onRetryProcessing={() => void handleStartProcessing({ retryFailed: true })}
                  />
                )}

                {showUploadStepContent && !isDemoMode && (
                  <UploadDropzone
                    copy={copy}
                    dragActive={dragActive}
                    showUploadProgress={showUploadProgress}
                    uploadProgressLabel={uploadProgressLabel}
                    uploadProgressWidth={uploadProgressWidth}
                    onDragActiveChange={setDragActive}
                    onFiles={(files) => void handleUpload(files)}
                    onTriggerFilePicker={triggerFilePicker}
                  />
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
                        <ReviewPanelHeader
                          busy={busy}
                          copy={copy}
                          showAdvancedGroupingControls={showAdvancedGroupingControls}
                          showProcessingGroupGrid={showProcessingGroupGrid}
                          showReviewActions={showReviewActions}
                          showReviewUploadProgress={showReviewUploadProgress}
                          uploadActive={uploadActive}
                          workspaceHdrItemCount={workspaceHdrItems.length}
                          onAddPhotos={triggerFilePicker}
                          onConfirmSend={() => void handleStartProcessing()}
                          onCreateGroup={() => void handleCreateGroup()}
                        />
                      )}

                      {!isDemoMode && (
                        <ReviewUploadStatus
                          busy={busy}
                          copy={copy}
                          failedUploadFiles={failedUploadFiles}
                          locale={locale}
                          showReviewLocalImportProgress={showReviewLocalImportProgress}
                          showReviewUploadProgress={showReviewUploadProgress}
                          uploadPaused={uploadPaused}
                          uploadProgressLabel={uploadProgressLabel}
                          uploadProgressWidth={uploadProgressWidth}
                          onCancelUpload={handleCancelUpload}
                          onPauseUpload={handlePauseUpload}
                          onResumeUpload={handleResumeUpload}
                          onRetryAllUploadFiles={() => void handleStartProcessing()}
                          onRetryUploadFile={(fileIdentity) => void handleStartProcessing({ retryUploadFileIdentity: fileIdentity })}
                        />
                      )}

                      {!isDemoMode && showLocalImportDiagnostics && localDraftDiagnostics && (
                        <LocalImportReviewNotices
                          copy={copy}
                          diagnostics={localDraftDiagnostics}
                        />
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
                  <ResultsPanel
                    assets={displayResultAssets}
                    busy={busy}
                    copy={copy}
                    currentProjectId={currentProject.id}
                    currentProjectResultAssets={currentProject.resultAssets}
                    dragOverResultHdrItemId={dragOverResultHdrItemId}
                    draggedResultHdrItemId={draggedResultHdrItemId}
                    failedResultHdrItems={failedResultHdrItems}
                    isDemoMode={isDemoMode}
                    locale={locale}
                    projectFreeRegenerationsRemaining={projectFreeRegenerationsRemaining}
                    regenerationFreeLimit={currentProjectRegenerationUsage.freeLimit}
                    resultCardRefs={resultCardRefs}
                    resultRegenerateBusy={resultRegenerateBusy}
                    resultThumbnailUrls={resultThumbnailUrls}
                    showRetryProcessingAction={showRetryProcessingAction}
                    getResultColorCard={getResultColorCard}
                    onOpenViewer={openViewer}
                    onPickResultColor={(asset) => void handlePickResultColor(asset)}
                    onPreviewResultReorder={previewResultReorder}
                    onRegenerateResult={(asset) => void handleRegenerateResult(asset)}
                    onReorderResults={(sourceHdrItemId, targetHdrItemId) => void handleReorderResults(sourceHdrItemId, targetHdrItemId)}
                    onRetryProcessing={() => void handleStartProcessing({ retryFailed: true })}
                    onSetDragOverResultHdrItemId={setDragOverResultHdrItemId}
                    onSetDraggedResultHdrItemId={setDraggedResultHdrItemId}
                    onSetResultColorCard={(hdrItemId, color) =>
                      setResultColorCards((current) => ({
                        ...current,
                        [hdrItemId]: color
                      }))
                    }
                    onSetResultDragPreview={setResultDragPreview}
                    resolveMediaUrl={resolveMediaUrl}
                  />
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

      <StudioGuideDialog
        copy={copy}
        open={studioGuideOpen}
        activeStep={activeStudioGuideStep}
        safeStepIndex={safeStudioGuideStep}
        steps={studioGuideSteps}
        onClose={closeStudioGuide}
        onDismiss={dismissStudioGuide}
        onSelectStep={setStudioGuideStep}
        onStepDelta={(delta) =>
          setStudioGuideStep((current) =>
            Math.max(0, Math.min(studioGuideSteps.length - 1, current + delta))
          )
        }
      />

      {renderBillingRechargeLayer()}

      {settingsOpen && session && (
        <AccountSettingsDialog
          busy={settingsBusy}
          copy={copy}
          draft={settingsDraft}
          message={settingsMessage}
          session={session}
          setDraft={setSettingsDraft}
          onClose={() => setSettingsOpen(false)}
          onSave={() => void handleSaveSettings()}
        />
      )}

      {createDialogOpen && (
        <FeatureCreateDialog
          busy={busy}
          copy={copy}
          dragActive={createDialogDragActive}
          fileInputRef={createFileInputRef}
          files={createDialogFiles}
          locale={locale}
          newProjectName={newProjectName}
          selectedFeature={selectedFeature}
          setDragActive={setCreateDialogDragActive}
          setNewProjectName={setNewProjectName}
          onClose={closeCreateProjectDialog}
          onCreate={() => void handleCreateProject()}
          onFiles={handleCreateDialogFiles}
        />
      )}

      {downloadDialogProjectId && downloadProject && (
        <ProjectDownloadDialog
          busy={downloadBusy}
          copy={copy}
          draft={downloadDraft}
          project={downloadProject}
          stageText={downloadStageText}
          setDraft={setDownloadDraft}
          onClose={closeDownloadDialog}
          onConfirm={() => void handleConfirmDownload()}
        />
      )}

      {currentViewerAsset && (
        <ResultEditorDialog
          asset={currentViewerAsset}
          aspectRatio={currentViewerAspectRatio}
          availableColorCards={availableResultColorCards}
          canvasRef={resultCanvasRef}
          copy={copy}
          currentColor={currentViewerSelectedColor}
          currentProjectName={currentProject?.name ?? 'Metrovan AI'}
          freeRegenerationsRemaining={projectFreeRegenerationsRemaining}
          isRegenerating={currentViewerIsRegenerating}
          normalizedColor={currentViewerNormalizedColor}
          regenerationFreeLimit={currentProjectRegenerationUsage.freeLimit}
          safeViewerIndex={safeViewerIndex ?? 0}
          settings={currentViewerSettings}
          viewerAssets={viewerAssets}
          onApplyColorCard={applyResultColorCard}
          onClose={() => setResultViewerIndex(null)}
          onColorBlur={(asset, value) => {
            const normalized = normalizeHex(value);
            if (normalized) {
              applyResultColorCard(asset, normalized);
            }
          }}
          onColorDraftChange={(asset, value) =>
            setResultColorCards((current) => ({
              ...current,
              [asset.hdrItemId]: normalizeHexDraft(value)
            }))
          }
          onCropFrameDragStart={startResultCropFrameDrag}
          onDeleteColorCard={deleteResultColorCard}
          onDownload={(asset) => void downloadViewerAsset(asset)}
          onPickColor={(asset) => void handlePickResultColor(asset)}
          onRegenerate={(asset) => void handleRegenerateResult(asset)}
          onReset={resetResultEditorSettings}
          onSaveColorCard={saveResultColorCard}
          onSelectViewerIndex={setResultViewerIndex}
          onShiftViewer={shiftViewer}
          onStagePointerDown={startResultCropDrag}
          onStagePointerMove={moveResultCropDrag}
          onStagePointerUp={endResultCropDrag}
          onStageWheel={zoomResultCrop}
          onUpdateAspectRatio={updateResultAspectRatio}
          onUpdateSettings={updateResultEditorSettings}
          resolveMediaUrl={resolveMediaUrl}
        />
      )}
      {projectToDelete && (
        <DeleteProjectConfirmDialog
          copy={copy}
          locale={locale}
          project={projectToDelete}
          onCancel={() => setProjectToDelete(null)}
          onConfirm={() => void handleConfirmDeleteProject()}
        />
      )}
    </>
  );
}

export default App;
