import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { useLayoutEffect } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AdminRoute } from './components/AdminRoute';
import { AppAuthDialog } from './components/AppAuthDialog';
import { BillingPanel } from './components/BillingPanel';
import { StudioRoute } from './components/StudioRoute';
import { BillingPage } from './pages/BillingPage';
import { LandingPage } from './pages/LandingPage';
import logoMark from './assets/metrovan-logo-mark.webp';
import { isDemoModeEnabled } from './demo-mode';
import { useAuthFlow } from './hooks/useAuthFlow';
import { useProjectUploadImport } from './hooks/useProjectUploadImport';
import { useResultEditor } from './hooks/useResultEditor';
import { useUploadControls } from './hooks/useUploadControls';
import type { LocalHdrItemDraft, LocalImportDraft } from './local-import';
import { UI_TEXT, type UiLocale } from './app-copy';
import {
  STUDIO_FEATURES,
  normalizeStudioFeatureDrafts,
  studioFeatureConfigToDefinition,
  type StudioFeatureDefinition,
  type StudioFeatureId
} from './studio-features';
import {
  buildHdrLayoutPayload,
  collectLocalHdrItemFiles,
  getLocalFileUploadIdentity,
  getUploadReferenceIdentity,
  getUploadedObjectsForFiles,
  mergeUploadedObjectReferences
} from './upload-flow';
import {
  ApiRequestError,
  confirmCheckoutSession,
  applyHdrLayout,
  createCheckoutSession,
  allowAdminUserAccess,
  createAdminActivationCode,
  createGroup,
  createProject,
  deleteAdminProject,
  deleteAdminUser,
  deleteHdrItem,
  deleteProject,
  downloadProjectArchive,
  adjustAdminUserBilling,
  fetchAdminActivationCodes,
  fetchAdminAuditLogs,
  fetchAdminBillingUsers,
  fetchAdminFailedPhotos,
  fetchAdminOpsHealth,
  fetchAdminOrderRefundPreview,
  fetchAdminOrders,
  fetchAdminProjectCosts,
  fetchAdminRegenerationAudit,
  fetchAdminMaintenanceReports,
  fetchAdminProjectDetail,
  fetchAdminProjects,
  fetchAdminSettings,
  fetchAdminUserDetail,
  fetchAdminUsers,
  fetchAdminWorkflows,
  fetchBilling,
  fetchProject,
  fetchProjects,
  fetchResultThumbnails,
  fetchSession,
  fetchStudioFeatures,
  isDirectUploadIntegrityError,
  logoutSession,
  moveHdrItem,
  patchProject,
  reorderResults,
  redeemActivationCode,
  refundAdminOrder,
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
  AdminBillingUserSummaryPayload,
  AdminBillingUserSummaryRow,
  AdminMaintenanceReportSummary,
  AdminOpsHealthPayload,
  AdminProjectCostsPayload,
  AdminProjectCostRow,
  AdminRegenerationAuditPayload,
  AdminRegenerationAuditRow,
  AdminProjectRepairAction,
  AdminSystemSettings,
  AdminUserListQuery,
  AdminUserSummary,
  AdminWorkflowSummary,
  FailedUploadFile,
  StudioFeatureConfig,
  UploadedObjectReference,
  UploadProgressSnapshot
} from './api';
import type {
  BillingEntry,
  BillingPackage,
  BillingSummary,
  ColorMode,
  AdminFailedPhotoRow,
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
  ADMIN_MAX_BATCH_CODES,
  DEFAULT_DOWNLOAD_DRAFT,
  DEFAULT_RUNNINGHUB_MAX_IN_FLIGHT,
  DEMO_BILLING_ENTRIES,
  DEMO_BILLING_PACKAGES,
  DEMO_BILLING_SUMMARY,
  MAX_RUNNINGHUB_MAX_IN_FLIGHT,
  MAX_RUNPOD_HDR_BATCH_SIZE,
  MIN_RUNNINGHUB_MAX_IN_FLIGHT,
  MIN_RUNPOD_HDR_BATCH_SIZE,
  buildAdminPlanPackageFromDraft,
  buildUniqueAdminActivationCode,
  createAdminBatchCodeDraft,
  createAdminPlanDraft,
  createDemoProjects,
  createHdrItemFromExposure,
  filterSupportedImportFiles,
  formatDate,
  formatUsd,
  formatUploadProgressLabel,
  getColorModeLabel,
  getCustomRechargePoints,
  getDraftGroupId,
  getGroupItems,
  getHdrItemStatusLabel,
  getHdrItemReviewStateFromExposures,
  getHdrLocalReviewState,
  getHdrPreviewUrl,
  getLocalReviewCopy,
  getMaxNavigableStep,
  getPathForRoute,
  getProjectProcessingStageCopy,
  getProjectStatusLabel,
  getRouteFromPath,
  getSceneLabel,
  getSelectedExposure,
  getStoredLocale,
  getUserFacingErrorMessage,
  isHdrItemProcessing,
  isInsufficientCreditsError,
  isProjectJobActivelyProcessing,
  loadLocalImportModule,
  markStudioGuideDismissed,
  mergeProjectItemsWithLocalPreviews,
  normalizeHex,
  parseCustomRechargeAmount,
  resolveMediaUrl,
  revokeLocalImportDraftUrls,
  syncLocalHdrGroups,
  sortExposuresForHdr,
  type AdminBatchCodeDraft,
  type AdminConsolePage,
  type AdminPlanDraft,
  type AppRoute,
  type DownloadDraft,
  type FailedUploadEntry,
  type SessionState,
  type StudioFeatureImageField
} from './app-utils';

const STRIPE_RETURN_PROJECT_STORAGE_KEY = 'metrovanai_stripe_return_project_id';
const ADMIN_PROJECT_PAGE_SIZE = 200;
const ADMIN_FAILED_PHOTOS_PAGE_SIZE = 50;
type AdminBillingLedgerDatePreset = 'all' | 'today' | 'week' | 'month' | '30d' | 'custom';
type AdminProjectCostDatePreset = AdminBillingLedgerDatePreset;

function isAdminBillingAdjustmentEntry(entry: BillingEntry) {
  return entry.amountUsd === 0 && !entry.projectId && !entry.projectName && entry.note.startsWith('Admin adjustment:');
}

function getBillingEntryAdminLabel(entry: BillingEntry) {
  if (entry.projectName) return entry.projectName;
  if (entry.activationCodeLabel) return entry.activationCodeLabel;
  if (entry.activationCode) return `兑换码 ${entry.activationCode}`;
  if (isAdminBillingAdjustmentEntry(entry)) return entry.type === 'credit' ? '管理员补积分' : '管理员扣积分';
  if (entry.note) return entry.note;
  return entry.type === 'credit' ? '积分入账' : '积分扣费';
}

function formatDateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const uploadControls = useUploadControls();
  const {
    failedUploadFiles,
    setFailedUploadFiles,
    setUploadActive,
    setUploadMode,
    setUploadPercent,
    setUploadSnapshot,
    uploadAbortControllerRef,
    uploadActive,
    uploadMode,
    uploadPauseControllerRef,
    uploadPaused,
    uploadPercent,
    uploadSnapshot,
    resetUploadPause
  } = uploadControls;
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
  const [adminProjectsTotal, setAdminProjectsTotal] = useState(0);
  const [adminProjectsPage, setAdminProjectsPage] = useState(0);
  const [adminProjectsPageCount, setAdminProjectsPageCount] = useState(1);
  const [adminOrdersLoaded, setAdminOrdersLoaded] = useState(false);
  const [adminOrdersBusy, setAdminOrdersBusy] = useState(false);
  const [adminBillingLedgerSearch, setAdminBillingLedgerSearch] = useState('');
  const [adminBillingUsers, setAdminBillingUsers] = useState<AdminBillingUserSummaryRow[]>([]);
  const [adminBillingUserTotals, setAdminBillingUserTotals] = useState<AdminBillingUserSummaryPayload['totals']>({
    totalPaidUsd: 0,
    totalGrantedPoints: 0,
    totalChargedPoints: 0,
    availablePoints: 0,
    runningHubRuns: 0,
    runningHubCostUsd: 0,
    remainingCreditCostUsd: 0,
    profitUsd: 0
  });
  const [adminBillingUserTotal, setAdminBillingUserTotal] = useState(0);
  const [adminBillingUserUnitUsd, setAdminBillingUserUnitUsd] = useState(0.07);
  const [adminBillingUsersLoaded, setAdminBillingUsersLoaded] = useState(false);
  const [adminBillingUsersBusy, setAdminBillingUsersBusy] = useState(false);
  const [adminProjectCosts, setAdminProjectCosts] = useState<AdminProjectCostRow[]>([]);
  const [adminProjectCostTotal, setAdminProjectCostTotal] = useState(0);
  const [adminProjectCostTotals, setAdminProjectCostTotals] = useState<AdminProjectCostsPayload['totals']>({
    projects: 0,
    revenueUsd: 0,
    listRevenueUsd: 0,
    cashRevenueUsd: 0,
    runningHubRuns: 0,
    runningHubCostUsd: 0,
    profitUsd: 0,
    netPoints: 0
  });
  const [adminProjectCostUnitUsd, setAdminProjectCostUnitUsd] = useState(0.07);
  const [adminProjectCostSearch, setAdminProjectCostSearch] = useState('');
  const [adminProjectCostDatePreset, setAdminProjectCostDatePreset] = useState<AdminProjectCostDatePreset>('30d');
  const [adminProjectCostStartDate, setAdminProjectCostStartDate] = useState('');
  const [adminProjectCostEndDate, setAdminProjectCostEndDate] = useState('');
  const [adminProjectCostsLoaded, setAdminProjectCostsLoaded] = useState(false);
  const [adminProjectCostsBusy, setAdminProjectCostsBusy] = useState(false);
  const [adminRegenerationAudit, setAdminRegenerationAudit] = useState<AdminRegenerationAuditRow[]>([]);
  const [adminRegenerationAuditTotals, setAdminRegenerationAuditTotals] = useState<AdminRegenerationAuditPayload['totals']>({
    projects: 0,
    overchargedProjects: 0,
    underchargedProjects: 0,
    overchargedPoints: 0,
    underchargedPoints: 0
  });
  const [adminRegenerationAuditTotal, setAdminRegenerationAuditTotal] = useState(0);
  const [adminRegenerationAuditSearch, setAdminRegenerationAuditSearch] = useState('');
  const [adminRegenerationAuditMode, setAdminRegenerationAuditMode] = useState<'all' | 'mismatch' | 'overcharged' | 'undercharged'>('mismatch');
  const [adminRegenerationAuditLoaded, setAdminRegenerationAuditLoaded] = useState(false);
  const [adminRegenerationAuditBusy, setAdminRegenerationAuditBusy] = useState(false);
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
  const [adminFailuresSearch, setAdminFailuresSearch] = useState('');
  const [adminFailureCauseFilter, setAdminFailureCauseFilter] = useState('all');
  const [adminFailedPhotos, setAdminFailedPhotos] = useState<AdminFailedPhotoRow[]>([]);
  const [adminFailedPhotosLoaded, setAdminFailedPhotosLoaded] = useState(false);
  const [adminFailedPhotosBusy, setAdminFailedPhotosBusy] = useState(false);
  const [adminFailedPhotosTotal, setAdminFailedPhotosTotal] = useState(0);
  const [adminFailedPhotosTotalAll, setAdminFailedPhotosTotalAll] = useState(0);
  const [adminFailedPhotosPage, setAdminFailedPhotosPage] = useState(1);
  const [adminFailedPhotosPageCount, setAdminFailedPhotosPageCount] = useState(1);
  const [adminFailedPhotosCauseCounts, setAdminFailedPhotosCauseCounts] = useState<Record<string, { title: string; count: number }>>({});
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
  const [draggedResultHdrItemId, setDraggedResultHdrItemId] = useState<string | null>(null);
  const [dragOverResultHdrItemId, setDragOverResultHdrItemId] = useState<string | null>(null);
  const [resultDragPreview, setResultDragPreview] = useState<{ projectId: string; orderedHdrItemIds: string[] } | null>(null);
  const [resultRegenerateBusy, setResultRegenerateBusy] = useState<Record<string, boolean>>({});
  const [studioGuideOpen, setStudioGuideOpen] = useState(false);
  const [studioGuideStep, setStudioGuideStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);
  const resultCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const resultLayoutSnapshotRef = useRef<Record<string, DOMRect>>({});
  const hdrExposureSwipeRef = useRef<{ hdrItemId: string; startX: number; startY: number } | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const adminBillingLedgerRef = useRef<HTMLDivElement | null>(null);
  const checkoutHandledRef = useRef(false);
  const navigateToRouteRef = useRef<(nextRoute: AppRoute) => void>(() => undefined);

  const demoProjects = useMemo(() => createDemoProjects(), []);
  const visibleProjects = isDemoMode ? demoProjects : projects;
  const copy = UI_TEXT[locale];
  const authFlow = useAuthFlow({
    copy,
    isDemoMode,
    locale,
    navigateToRoute,
    setActiveRoute,
    setLocale,
    setMessage,
    setSession
  });
  const { handleUploadForProject } = useProjectUploadImport({
    copy,
    localImportDrafts,
    locale,
    setBusy,
    setDragActive,
    setMessage,
    setUploadActive,
    setUploadMode,
    setUploadPercent,
    setUploadSnapshot,
    updateLocalImportDraft,
    upsertLocalImportDraft,
    upsertProject
  });
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
  const selectedBillingPackage = billingPackages.find((billingPackage) => billingPackage.id === activeBillingPackageId) ?? null;
  const customRechargeIsActive = customRechargeAmount.trim().length > 0;
  const customRechargeAmountUsd = customRechargeIsActive ? parseCustomRechargeAmount(customRechargeAmount) : null;
  const customRechargePoints = customRechargeAmountUsd === null ? 0 : getCustomRechargePoints(customRechargeAmountUsd);
  const {
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
  } = useResultEditor({
    copy,
    locale,
    resultAssets: displayResultAssets,
    resultRegenerateBusy,
    resolveMediaUrl,
    setMessage
  });
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
  const resultHdrItemIds = new Set(displayResultAssets.map((asset) => asset.hdrItemId));
  const missingResultHdrItems = workspaceHdrItems.filter((item) => !resultHdrItemIds.has(item.id));
  const failedResultHdrItems = missingResultHdrItems.filter((item) => item.status === 'error');
  const hasFailedResultHdrItems = failedResultHdrItems.length > 0;
  const hasMissingResultHdrItems = missingResultHdrItems.length > 0;
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
  const processingStageCopy = currentProject ? getProjectProcessingStageCopy(currentProject, locale) : null;
  const showRetryProcessingAction =
    Boolean(currentProject && hasFailedResultHdrItems && !hasActiveProcessingItems && !jobActivelyProcessing) && !uploadActive;
  const processingPanelTitle = showProcessingUploadProgress
    ? copy.uploadOriginalsTitle
    : jobFailedWhileItemsActive
      ? copy.processingGroupsTitle
    : processingStageCopy?.title || copy.waitingProcessing;
  const processingPanelDetail = showProcessingUploadProgress
    ? uploadProgressLabel
    : jobFailedWhileItemsActive
      ? copy.processingGroupsHint
    : processingStageCopy?.detail || copy.waitingProcessingHint;
  const showResultsStepContent = currentWorkspaceStep === 4 && (hasResultContent || hasMissingResultHdrItems);
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
  const adminSelectedProjectMissingItems = adminSelectedProject
    ? (() => {
        const resultHdrItemIds = new Set(adminSelectedProject.resultAssets.map((asset) => asset.hdrItemId));
        return adminSelectedProject.hdrItems.filter((item) => !resultHdrItemIds.has(item.id));
      })()
    : [];
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
  const adminFailedPhotoRows = adminFailedPhotos;
  const adminFailureCauseOptions = useMemo(
    () =>
      Object.entries(adminFailedPhotosCauseCounts)
        .map(([code, value]) => [code, value.title] as const)
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN')),
    [adminFailedPhotosCauseCounts]
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
      authFlow.openAuth('signin');
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
      fetchAdminProjects({ page: 1, pageSize: ADMIN_PROJECT_PAGE_SIZE })
        .then((response) => {
          if (cancelled) return;
          setAdminProjects(response.items);
          setAdminProjectsTotal(response.total);
          setAdminProjectsPage(response.page);
          setAdminProjectsPageCount(response.pageCount);
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
    if (activeRoute !== 'admin' || adminConsolePage !== 'failures' || !hasAdminSession || adminFailedPhotosLoaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAdminFailedPhotosBusy(true);
      fetchAdminFailedPhotos({
        page: 1,
        pageSize: ADMIN_FAILED_PHOTOS_PAGE_SIZE,
        search: adminFailuresSearch,
        cause: adminFailureCauseFilter
      })
        .then((response) => {
          if (cancelled) return;
          setAdminFailedPhotos(response.items);
          setAdminFailedPhotosTotal(response.total);
          setAdminFailedPhotosTotalAll(response.totalAll);
          setAdminFailedPhotosPage(response.page);
          setAdminFailedPhotosPageCount(response.pageCount);
          setAdminFailedPhotosCauseCounts(response.causeCounts);
          setAdminFailedPhotosLoaded(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setAdminFailedPhotosLoaded(true);
          setAdminMessage(getUserFacingErrorMessage(error, '失败照片读取失败。', locale));
        })
        .finally(() => {
          if (!cancelled) {
            setAdminFailedPhotosBusy(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoute, adminConsolePage, adminFailedPhotosLoaded, adminFailureCauseFilter, adminFailuresSearch, hasAdminSession, locale]);

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
    if (activeRoute !== 'admin' || adminConsolePage !== 'billing' || !hasAdminSession || adminBillingUsersLoaded) {
      return;
    }

    void handleAdminLoadBillingUsers();
  }, [activeRoute, adminBillingUsersLoaded, adminConsolePage, hasAdminSession]);

  useEffect(() => {
    if (activeRoute !== 'admin' || adminConsolePage !== 'costs' || !hasAdminSession || adminProjectCostsLoaded) {
      return;
    }

    void handleAdminLoadProjectCosts();
  }, [activeRoute, adminConsolePage, adminProjectCostsLoaded, hasAdminSession]);

  useEffect(() => {
    if (activeRoute !== 'admin' || adminConsolePage !== 'regenerationAudit' || !hasAdminSession || adminRegenerationAuditLoaded) {
      return;
    }

    void handleAdminLoadRegenerationAudit();
  }, [activeRoute, adminConsolePage, adminRegenerationAuditLoaded, hasAdminSession]);

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
          fetchStudioFeatures()
            .then((fallbackResponse) => {
              if (cancelled) return;
              syncAdminFeatureDraftFallback(fallbackResponse.features);
              setAdminMessage('系统设置读取失败，已先载入前台功能卡片。请刷新配置后再保存。');
            })
            .catch(() => {
              if (cancelled) return;
              setAdminSystemLoaded(true);
              setAdminMessage(getUserFacingErrorMessage(error, '系统设置读取失败。', locale));
            });
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

  function syncAdminFeatureDraftFallback(features: StudioFeatureConfig[]) {
    const drafts = normalizeStudioFeatureDrafts(features);
    setAdminFeatureDrafts(drafts);
    const cards = drafts.map(studioFeatureConfigToDefinition).filter((feature) => feature.status !== 'locked');
    if (cards.length) {
      setStudioFeatureCards(cards);
      setSelectedFeatureId((current) => (cards.some((feature) => feature.id === current) ? current : cards[0]!.id));
    }
    setAdminSystemLoaded(true);
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
        authFlow.openAuth('signin');
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
      const response = await fetchAdminProjects({ page: 1, pageSize: ADMIN_PROJECT_PAGE_SIZE });
      setAdminProjects(response.items);
      setAdminProjectsTotal(response.total);
      setAdminProjectsPage(response.page);
      setAdminProjectsPageCount(response.pageCount);
      setAdminProjectsLoaded(true);
      setAdminMessage(
        response.items.length >= response.total
          ? `已载入全部 ${response.total} 个项目。`
          : `已载入 ${response.items.length} / ${response.total} 个项目，可继续载入更多。`
      );
    } catch (error) {
      setAdminProjectsLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '项目列表读取失败。', locale));
    } finally {
      setAdminProjectsBusy(false);
    }
  }

  async function handleAdminLoadMoreProjects() {
    if (!hasAdminSession || adminProjectsBusy || adminProjectsPage >= adminProjectsPageCount) {
      return;
    }

    setAdminProjectsBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminProjects({ page: adminProjectsPage + 1, pageSize: ADMIN_PROJECT_PAGE_SIZE });
      setAdminProjects((current) => {
        const existingIds = new Set(current.map((project) => project.id));
        const nextItems = response.items.filter((project) => !existingIds.has(project.id));
        return [...current, ...nextItems];
      });
      setAdminProjectsTotal(response.total);
      setAdminProjectsPage(response.page);
      setAdminProjectsPageCount(response.pageCount);
      setAdminProjectsLoaded(true);
      const loadedCount = Math.min(response.page * response.pageSize, response.total);
      setAdminMessage(
        loadedCount >= response.total
          ? `已载入全部 ${response.total} 个项目。`
          : `已载入 ${loadedCount} / ${response.total} 个项目。`
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '继续载入项目失败。', locale));
    } finally {
      setAdminProjectsBusy(false);
    }
  }

  async function handleAdminLoadFailedPhotos(page = 1) {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminFailedPhotosBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminFailedPhotos({
        page,
        pageSize: ADMIN_FAILED_PHOTOS_PAGE_SIZE,
        search: adminFailuresSearch,
        cause: adminFailureCauseFilter
      });
      setAdminFailedPhotos(response.items);
      setAdminFailedPhotosTotal(response.total);
      setAdminFailedPhotosTotalAll(response.totalAll);
      setAdminFailedPhotosPage(response.page);
      setAdminFailedPhotosPageCount(response.pageCount);
      setAdminFailedPhotosCauseCounts(response.causeCounts);
      setAdminFailedPhotosLoaded(true);
      setAdminMessage(
        response.total
          ? `已载入失败照片 ${response.items.length} / ${response.total} 张。`
          : '当前筛选条件下没有失败照片。'
      );
    } catch (error) {
      setAdminFailedPhotosLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '失败照片读取失败。', locale));
    } finally {
      setAdminFailedPhotosBusy(false);
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

  function getAdminDateRange(
    preset: AdminBillingLedgerDatePreset,
    customStartDate: string,
    customEndDate: string
  ) {
    const today = new Date();
    const endDate = formatDateInputValue(today);
    const start = new Date(today);
    if (preset === 'today') {
      return { startDate: endDate, endDate };
    }
    if (preset === 'week') {
      const day = today.getDay();
      const daysFromMonday = day === 0 ? 6 : day - 1;
      start.setDate(today.getDate() - daysFromMonday);
      return { startDate: formatDateInputValue(start), endDate };
    }
    if (preset === 'month') {
      start.setDate(1);
      return { startDate: formatDateInputValue(start), endDate };
    }
    if (preset === '30d') {
      start.setDate(today.getDate() - 29);
      return { startDate: formatDateInputValue(start), endDate };
    }
    if (preset === 'custom') {
      return {
        startDate: customStartDate,
        endDate: customEndDate
      };
    }
    return { startDate: '', endDate: '' };
  }

  function getAdminProjectCostDateRange() {
    return getAdminDateRange(adminProjectCostDatePreset, adminProjectCostStartDate, adminProjectCostEndDate);
  }

  async function handleAdminLoadBillingUsers() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminBillingUsersBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminBillingUsers({ search: adminBillingLedgerSearch });
      setAdminBillingUsers(response.items);
      setAdminBillingUserTotals(response.totals);
      setAdminBillingUserTotal(response.total);
      setAdminBillingUserUnitUsd(response.unitCostUsd);
      setAdminBillingUsersLoaded(true);
      setAdminMessage(response.total ? `已载入 ${response.total.toLocaleString()} 个用户账单汇总。` : '没有匹配的用户账单。');
    } catch (error) {
      setAdminBillingUsersLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '用户账单汇总读取失败。', locale));
    } finally {
      setAdminBillingUsersBusy(false);
    }
  }

  async function handleAdminLoadProjectCosts() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminProjectCostsBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminProjectCosts({
        search: adminProjectCostSearch,
        ...getAdminProjectCostDateRange()
      });
      setAdminProjectCosts(response.items);
      setAdminProjectCostTotal(response.total);
      setAdminProjectCostTotals(response.totals);
      setAdminProjectCostUnitUsd(response.unitCostUsd);
      setAdminProjectCostsLoaded(true);
      setAdminMessage(response.total ? `已载入 ${response.total.toLocaleString()} 个项目成本。` : '没有匹配的项目成本。');
    } catch (error) {
      setAdminProjectCostsLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '项目成本读取失败。', locale));
    } finally {
      setAdminProjectCostsBusy(false);
    }
  }

  async function handleAdminLoadRegenerationAudit() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminRegenerationAuditBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminRegenerationAudit({
        search: adminRegenerationAuditSearch,
        mode: adminRegenerationAuditMode
      });
      setAdminRegenerationAudit(response.items);
      setAdminRegenerationAuditTotals(response.totals);
      setAdminRegenerationAuditTotal(response.total);
      setAdminRegenerationAuditLoaded(true);
      setAdminMessage(response.total ? `已载入 ${response.total.toLocaleString()} 个重修审计项目。` : '没有匹配的重修审计项目。');
    } catch (error) {
      setAdminRegenerationAuditLoaded(true);
      setAdminMessage(getUserFacingErrorMessage(error, '重修审计读取失败。', locale));
    } finally {
      setAdminRegenerationAuditBusy(false);
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

  async function handleAdminOpenUserBilling(userId: string) {
    setAdminConsolePage('users');
    await handleAdminSelectUser(userId);
    window.setTimeout(() => {
      adminBillingLedgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
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

  async function handleAdminDeleteProject(projectId: string) {
    const targetProject =
      adminProjects.find((project) => project.id === projectId) ??
      adminDetailProjects.find((project) => project.id === projectId) ??
      adminSelectedProject;
    if (!targetProject) {
      setAdminMessage('找不到要删除的项目。');
      return;
    }

    const typed = window.prompt(
      `确认删除项目 ${targetProject.name}？\n\n此操作会从用户端移除该项目，并删除 R2 中对应的原片、预览、处理中间文件、结果图和下载包引用。\n如需继续，请输入项目名称。`
    );
    if (typed !== targetProject.name) {
      setAdminMessage('已取消删除项目。');
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await deleteAdminProject(projectId, { name: targetProject.name });
      setAdminProjects((current) => current.filter((project) => project.id !== response.deletedProjectId));
      setAdminDetailProjects((current) => current.filter((project) => project.id !== response.deletedProjectId));
      setAdminProjectsTotal((current) => Math.max(0, current - 1));
      setAdminSelectedProjectId((current) => (current === response.deletedProjectId ? null : current));
      setAdminMessage(
        response.cloudCleanup.failed
          ? `项目已删除，但有 ${response.cloudCleanup.failed} 个 R2 对象未能删除，请查看维护报告。`
          : `项目已删除，已清理 ${response.cloudCleanup.deleted.toLocaleString()} 个 R2 对象。`
      );
      void handleAdminLoadOpsHealth();
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '删除项目失败。', locale));
    } finally {
      setAdminActionBusy(false);
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
          ? `已恢复 ${response.summary.recovered} 张云端结果。`
          : response.summary.status === 'idle'
            ? '这个项目没有需要恢复的云端结果。'
            : '暂时没有恢复到结果，后台会继续自动重试。'
      );
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '云端结果恢复失败。', locale));
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

  async function handleAdminAllowUserAccess(userId: string) {
    const targetUser = adminUsers.find((user) => user.id === userId) ?? adminSelectedUser;
    if (!window.confirm(`确认允许 ${targetUser?.email ?? '这个用户'} 访问？系统会将账号设为正常，并把邮箱标记为已验证。`)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminMessage('');
    try {
      const response = await allowAdminUserAccess(userId);
      mergeAdminUser(response.user);
      setAdminAuditLogs(response.auditLogs);
      await handleAdminSelectUser(userId);
      setAdminMessage('已允许访问：账号正常，邮箱已验证。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '允许访问失败。', locale));
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
      setAdminProjects((current) => current.filter((project) => project.userKey !== targetUser?.userKey));
      setAdminDetailProjects((current) => current.filter((project) => project.userKey !== targetUser?.userKey));
      setAdminTotalUsers((current) => Math.max(0, current - 1));
      setAdminProjectsTotal((current) => Math.max(0, current - response.removed.projects));
      if (adminSelectedUser?.id === response.deletedUserId) {
        setAdminSelectedUser(null);
        setAdminSelectedUserId('');
        setAdminDetailProjects([]);
        setAdminDetailBillingEntries([]);
      }
      setAdminMessage(
        response.archiveErrors.length
          ? `用户已删除，但有 ${response.archiveErrors.length} 个项目文件未能归档，请检查服务器日志。`
          : response.cloudCleanup.failed.length
            ? `用户已删除，但有 ${response.cloudCleanup.failed.length} 个 R2 对象未能删除，请查看维护报告。`
            : `用户已删除，已清理 ${response.cloudCleanup.deleted.toLocaleString()} 个 R2 对象。`
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
      try {
        const fallbackResponse = await fetchStudioFeatures();
        syncAdminFeatureDraftFallback(fallbackResponse.features);
        setAdminMessage('系统设置读取失败，已先载入前台功能卡片。请稍后刷新配置后再保存。');
      } catch {
        setAdminMessage(getUserFacingErrorMessage(error, '系统设置读取失败。', locale));
      }
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
      enabled: true,
      category: 'new',
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

  function handleDeleteAdminFeatureCard(featureId: string) {
    const feature = adminFeatureDrafts.find((item) => item.id === featureId);
    const featureName = feature?.titleZh || feature?.titleEn || featureId;
    if (!window.confirm(`确认删除功能卡片“${featureName}”？保存后前台将不再显示。`)) {
      return;
    }
    setAdminFeatureDrafts((current) => current.filter((item) => item.id !== featureId));
    setAdminExpandedFeatureIds((current) => {
      const next = { ...current };
      delete next[featureId];
      return next;
    });
    setAdminMessage('已移除功能卡片，点击“保存全部”后生效。');
  }

  function handleMoveAdminFeatureCard(featureId: string, direction: -1 | 1) {
    setAdminFeatureDrafts((current) => {
      const index = current.findIndex((item) => item.id === featureId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
    setAdminMessage('卡片顺序已调整，点击“保存全部”后前台生效。');
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
      setAdminMessage('对比图已上传到草稿。请确认“前台启用”和发布前检查，然后点击“保存全部并发布到前台”。');
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '对比图上传失败。', locale));
    } finally {
      setAdminFeatureImageBusy(null);
    }
  }

  function getAdminFeatureWorkflowDisplay(feature: StudioFeatureConfig) {
    const items = adminWorkflowSummary?.items ?? [];
    const configuredWorkflowId = String(feature.workflowId ?? '').trim();
    const matched = configuredWorkflowId ? items.find((item) => item.workflowId === configuredWorkflowId) ?? null : null;
    const activeName = adminWorkflowSummary?.active?.trim().toLowerCase();
    const active = activeName ? items.find((item) => item.name.trim().toLowerCase() === activeName) ?? null : null;
    const defaultWorkflow = items.find((item) => item.workflowId) ?? null;
    const shouldUseDefaultWorkflow = feature.id === 'hdr-true-color' || feature.id === 'hdr-white-wall';
    const fallback = matched ?? (shouldUseDefaultWorkflow ? active ?? defaultWorkflow : null);

    return {
      workflowId: configuredWorkflowId || fallback?.workflowId || '',
      inputNodeId: String(feature.inputNodeId ?? '').trim() || fallback?.inputNodeIds?.join(', ') || '',
      outputNodeId: String(feature.outputNodeId ?? '').trim() || fallback?.outputNodeIds?.join(', ') || ''
    };
  }

  function getAdminFeaturePublishIssues(feature: StudioFeatureConfig) {
    const workflowDisplay = getAdminFeatureWorkflowDisplay(feature);
    const issues: string[] = [];
    if (!feature.titleZh.trim() || !feature.titleEn.trim()) issues.push('中英文名称');
    if (!feature.descriptionZh.trim() || !feature.descriptionEn.trim()) issues.push('中英文描述');
    if (!feature.beforeImageUrl.trim() || !feature.afterImageUrl.trim()) issues.push('Before / After 对比图');
    if (!workflowDisplay.workflowId.trim()) issues.push('流程 ID');
    if (!workflowDisplay.inputNodeId.trim()) issues.push('输入节点');
    if (!workflowDisplay.outputNodeId.trim()) issues.push('输出节点');
    if (!Number.isFinite(feature.pointsPerPhoto) || feature.pointsPerPhoto <= 0) issues.push('每张积分');
    return issues;
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
      setAdminMessage(`精修并发数量必须是 ${MIN_RUNNINGHUB_MAX_IN_FLIGHT} 到 ${MAX_RUNNINGHUB_MAX_IN_FLIGHT}。`);
      return;
    }
    const invalidPublishedFeature = adminFeatureDrafts.find((feature) => feature.enabled && getAdminFeaturePublishIssues(feature).length > 0);
    if (invalidPublishedFeature) {
      const issues = getAdminFeaturePublishIssues(invalidPublishedFeature);
      setAdminExpandedFeatureIds((current) => ({
        ...current,
        [invalidPublishedFeature.id]: true
      }));
      setAdminMessage(`“${invalidPublishedFeature.titleZh || invalidPublishedFeature.id}” 已开启前台显示，但缺少：${issues.join('、')}。请补齐后再保存，或先关闭前台启用。`);
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
      const response = await updateAdminSettings({
        runpodHdrBatchSize: Math.round(runpodHdrBatchSize),
        runningHubMaxInFlight: Math.round(runningHubMaxInFlight),
        billingPackages: baseSettings.billingPackages ?? adminActivationPackages,
        studioFeatures: adminFeatureDrafts
      });
      syncAdminSystemSettings(response.settings);
      const cards = response.settings.studioFeatures.map(studioFeatureConfigToDefinition).filter((feature) => feature.status !== 'locked');
      setStudioFeatureCards(cards);
      if (cards.length) {
        setSelectedFeatureId((current) => (cards.some((feature) => feature.id === current) ? current : cards[0]!.id));
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
      const visibleFeatureCount = response.settings.studioFeatures.filter((feature) => feature.enabled).length;
      setAdminMessage(
        `已保存并同步：前台显示 ${visibleFeatureCount} 张功能卡片，隐藏 ${response.settings.studioFeatures.length - visibleFeatureCount} 张。用户端刷新后可见。`
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

  async function exportAdminBillingUsersCSV() {
    if (!hasAdminSession) {
      setAdminMessage('请先用管理员账号登录。');
      return;
    }

    setAdminBillingUsersBusy(true);
    setAdminMessage('');
    try {
      const response = await fetchAdminBillingUsers({ search: adminBillingLedgerSearch });
      const header = ['Email', '姓名', '充值USD', '获得积分', '使用积分', '剩余积分', '云端调用次数', '云端处理成本USD', '剩余积分成本USD', '利润USD', '项目数', '结果数'].join(',');
      const rows = response.items.map((row) =>
        [
          row.userEmail,
          row.userDisplayName,
          row.totalPaidUsd.toFixed(2),
          row.totalGrantedPoints,
          row.totalChargedPoints,
          row.availablePoints,
          row.runningHubRuns,
          row.runningHubCostUsd.toFixed(2),
          row.remainingCreditCostUsd.toFixed(2),
          row.profitUsd.toFixed(2),
          row.projectCount,
          row.resultCount
        ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')
      );
      downloadCSV(`metrovan-user-billing-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
      setAdminMessage(`已导出 ${response.items.length.toLocaleString()} 个用户账单汇总。`);
    } catch (error) {
      setAdminMessage(getUserFacingErrorMessage(error, '用户账单汇总导出失败。', locale));
    } finally {
      setAdminBillingUsersBusy(false);
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
    authFlow.setAuthMessage('');
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
      if (activeRoute === 'billing') {
        navigateToRoute('billing');
      }
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

  async function handleUpload(files: FileList | File[] | null) {
    if (!currentProject) return;
    await handleUploadForProject(currentProject, files);
  }

  function handlePauseUpload() {
    if (uploadControls.pauseUpload() && currentProject) {
      updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'paused' }));
    }
  }

  function handleResumeUpload() {
    if (uploadControls.resumeUpload() && currentProject) {
      updateLocalImportDraft(currentProject.id, (draft) => ({ ...draft, uploadStatus: 'uploading' }));
    }
  }

  function handleCancelUpload() {
    uploadControls.cancelUpload();
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

  function formatAdminTodayLabel() {
    const formatted = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(new Date());
    return locale === 'en' ? `Today · ${formatted}` : `今天 · ${formatted}`;
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
    return (
      <BillingPage
        billingBusy={billingBusy}
        billingEntries={billingEntries}
        billingOrders={billingOrders}
        billingSummary={billingSummary}
        billingUsageExpanded={billingUsageExpanded}
        copy={copy}
        formatDate={formatDate}
        formatPaymentOrderStatus={formatPaymentOrderStatus}
        formatUsd={formatUsd}
        isAdminBillingAdjustmentEntry={isAdminBillingAdjustmentEntry}
        locale={locale}
        message={message}
        navigateToRoute={navigateToRoute}
        openRecharge={openRecharge}
        rechargeLayer={renderBillingRechargeLayer()}
        setBillingUsageExpanded={setBillingUsageExpanded}
      />
    );
  }

  function renderAuthDialog() {
    return (
      <AppAuthDialog
        {...authFlow.authDialogProps}
        hasSession={Boolean(session)}
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
          onOpenAuth={authFlow.openAuth}
        />

        {renderAuthDialog()}
      </>
    );
  }

  if (activeRoute === 'admin') {
    return (
      <AdminRoute
        data={{
          adminActionBusy,
          adminActivationBusy,
          adminActivationCodes,
          adminActivationDraft,
          adminActivationPackages,
          adminAdjustment,
          adminAuditLogs,
          adminBatchCodeDraft,
          adminBatchCodeOpen,
          adminBillingLedgerRef,
          adminBillingLedgerSearch,
          adminBillingUserTotal,
          adminBillingUserTotals,
          adminBillingUserUnitUsd,
          adminBillingUsers,
          adminBillingUsersBusy,
          adminBusy,
          adminCodesStatusFilter,
          adminConsolePage,
          adminDeepHealthBusy,
          adminDetailBillingEntries,
          adminDetailBusy,
          adminDetailProjects,
          adminExpandedFeatureIds,
          adminFailedPhotoRows,
          adminFailedPhotosBusy,
          adminFailedPhotosCauseCounts,
          adminFailedPhotosLoaded,
          adminFailedPhotosPage,
          adminFailedPhotosPageCount,
          adminFailedPhotosTotal,
          adminFailedPhotosTotalAll,
          adminFailureCauseFilter,
          adminFailureCauseOptions,
          adminFailuresSearch,
          adminFeatureDrafts,
          adminFeatureImageBusy,
          adminLoaded,
          adminLogsSearch,
          adminMaintenanceBusy,
          adminMaintenanceReports,
          adminMessage,
          adminOrders,
          adminOrdersBusy,
          adminOrdersSearch,
          adminOrdersStatusFilter,
          adminOpsBusy,
          adminOpsHealth,
          adminPage,
          adminPageCount,
          adminPlanDraft,
          adminPlanEditorOpen,
          adminPriorityProjects,
          adminProjectCostDatePreset,
          adminProjectCostEndDate,
          adminProjectCostSearch,
          adminProjectCostStartDate,
          adminProjectCostTotal,
          adminProjectCostTotals,
          adminProjectCostUnitUsd,
          adminProjectCosts,
          adminProjectCostsBusy,
          adminProjectHealthCounts,
          adminProjects,
          adminProjectsBusy,
          adminProjectsPage,
          adminProjectsPageCount,
          adminProjectsTotal,
          adminRegenerationAudit,
          adminRegenerationAuditBusy,
          adminRegenerationAuditMode,
          adminRegenerationAuditSearch,
          adminRegenerationAuditTotal,
          adminRegenerationAuditTotals,
          adminRefundBusy,
          adminRefundOrder,
          adminRefundPreview,
          adminRepairBusy,
          adminRoleFilter,
          adminSearch,
          adminSelectedProject,
          adminSelectedProjectCanMarkStalled,
          adminSelectedProjectCanRetryFailed,
          adminSelectedProjectDeepHealth,
          adminSelectedProjectFailedItems,
          adminSelectedProjectMissingItems,
          adminSelectedProjectProcessingItems,
          adminSelectedProjectResults,
          adminSelectedUser,
          adminSettingsTab,
          adminSingleCodeOpen,
          adminStatusFilter,
          adminSystemBusy,
          adminSystemDraft,
          adminSystemSettings,
          adminTotals,
          adminTotalUsers,
          adminUsers,
          adminVerifiedFilter,
          adminWorkflowBusy,
          adminWorkflowSummary,
          adminWorksSearch,
          billingPackages,
          closeAdminRefundDialog,
          exportAdminBillingUsersCSV,
          exportAdminOrdersCSV,
          exportAdminUsersCSV,
          formatAdminDate,
          formatAdminShortDate,
          formatAdminTodayLabel,
          formatPaymentOrderStatus,
          getAdminFeaturePublishIssues,
          getAdminFeatureWorkflowDisplay,
          getAdminInitials,
          getBillingEntryAdminLabel,
          getHdrItemStatusLabel,
          getProjectStatusLabel,
          getSelectedExposure,
          handleAddAdminFeatureCard,
          handleAdminAdjustBilling,
          handleAdminAllowUserAccess,
          handleAdminConfirmRefund,
          handleAdminCreateActivationCode,
          handleAdminCreateBatchActivationCodes,
          handleAdminDeleteActivationCode,
          handleAdminDeleteProject,
          handleAdminDeleteUser,
          handleAdminFeatureImageUpload,
          handleAdminLoadActivationCodes,
          handleAdminLoadAuditLogs,
          handleAdminLoadBillingUsers,
          handleAdminLoadFailedPhotos,
          handleAdminLoadMaintenanceReports,
          handleAdminLoadMoreProjects,
          handleAdminLoadOpsHealth,
          handleAdminLoadOrders,
          handleAdminLoadProjectCosts,
          handleAdminLoadProjects,
          handleAdminLoadRegenerationAudit,
          handleAdminLoadSystemSettings,
          handleAdminLoadUsers,
          handleAdminLoadWorkflows,
          handleAdminLogoutUser,
          handleAdminOpenBatchActivationCodes,
          handleAdminOpenNewPlanPackage,
          handleAdminOpenRefund,
          handleAdminOpenUserBilling,
          handleAdminRecoverSelectedProject,
          handleAdminRepairSelectedProject,
          handleAdminRecommendedProjectAction,
          handleAdminRunDeepHealth,
          handleAdminSavePlanPackage,
          handleAdminSaveSystemSettings,
          handleAdminSelectProject,
          handleAdminSelectUser,
          handleAdminToggleActivationCode,
          handleAdminUpdateUser,
          handleAdminEditPlanPackage,
          handleAdminMoveFeatureCard: handleMoveAdminFeatureCard,
          handleDeleteAdminFeatureCard,
          locale,
          navigateToRoute,
          resolveMediaUrl,
          session,
          setAdminActivationDraft,
          setAdminBatchCodeDraft,
          setAdminBatchCodeOpen,
          setAdminBillingLedgerSearch,
          setAdminBillingUsersLoaded,
          setAdminCodesStatusFilter,
          setAdminConsolePage,
          setAdminExpandedFeatureIds,
          setAdminFailedPhotosLoaded,
          setAdminFailureCauseFilter,
          setAdminFailuresSearch,
          setAdminLoaded,
          setAdminLogsSearch,
          setAdminOrdersSearch,
          setAdminOrdersStatusFilter,
          setAdminPage,
          setAdminPlanDraft,
          setAdminPlanEditorOpen,
          setAdminProjectCostDatePreset,
          setAdminProjectCostEndDate,
          setAdminProjectCostsLoaded,
          setAdminProjectCostSearch,
          setAdminProjectCostStartDate,
          setAdminRegenerationAuditLoaded,
          setAdminRegenerationAuditMode,
          setAdminRegenerationAuditSearch,
          setAdminRoleFilter: (value: AdminUserListQuery['role']) => setAdminRoleFilter(value),
          setAdminSearch,
          setAdminAdjustment,
          setAdminSettingsTab,
          setAdminSingleCodeOpen,
          setAdminStatusFilter: (value: AdminUserListQuery['accountStatus']) => setAdminStatusFilter(value),
          setAdminSystemDraft,
          setAdminVerifiedFilter: (value: AdminUserListQuery['emailVerified']) => setAdminVerifiedFilter(value),
          setAdminWorksSearch,
          signOut,
          updateAdminFeatureDraft
        }}
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
          onOpenAuth={authFlow.openAuth}
        />

        {renderAuthDialog()}
      </>
    );
  }

  return (
    <StudioRoute
      data={{
        activeLocalDraft,
        activeStepLabels,
        activeStudioGuideStep,
        applyResultColorCard,
        availableFeatureCount,
        availableResultColorCards,
        billingSummary,
        busy,
        canEditHdrGrouping,
        closeCreateProjectDialog,
        closeDownloadDialog,
        closeStudioGuide,
        copy,
        createDialogDragActive,
        createDialogFiles,
        createDialogOpen,
        createFileInputRef,
        currentProject,
        currentProjectId,
        currentProjectRegenerationUsage,
        currentViewerAsset,
        currentViewerAspectRatio,
        currentViewerIsRegenerating,
        currentViewerNormalizedColor,
        currentViewerSelectedColor,
        currentViewerSettings,
        deleteResultColorCard,
        dismissStudioGuide,
        displayResultAssets,
        downloadBusy,
        downloadDialogProjectId,
        downloadDraft,
        downloadProject,
        downloadStageText,
        downloadViewerAsset,
        dragActive,
        dragOverResultHdrItemId,
        draggedResultHdrItemId,
        endResultCropDrag,
        failedResultHdrItems,
        failedUploadFiles,
        fileInputRef,
        getColorModeLabel,
        getGroupColorDraft,
        getGroupItems,
        getHdrItemStatusLabel,
        getHdrLocalReviewState,
        getHdrPreviewUrl,
        getLocalReviewCopy,
        getMaxNavigableStep,
        getResultColorCard,
        getSceneLabel,
        getSelectedExposure,
        handleApplyGroupColor,
        handleCancelUpload,
        handleColorModeChange,
        handleConfirmDeleteProject,
        handleConfirmDownload,
        handleCreateDialogFiles,
        handleCreateGroup,
        handleCreateProject,
        handleDeleteHdr,
        handleDeleteProject,
        handleDownloadProject,
        handleHdrExposureSwipeEnd,
        handleHdrExposureSwipeStart,
        handleMergeLocalHdrItem,
        handleMoveHdrItem,
        handleOpenBilling,
        handlePauseUpload,
        handlePickResultColor,
        handleRegenerateResult,
        handleRenameProject,
        handleReorderResults,
        handleResumeUpload,
        handleSaveSettings,
        handleSceneChange,
        handleShiftExposure,
        handleSplitLocalHdrItem,
        handleStartProcessing,
        handleStepClick,
        handleUpload,
        hdrExposureSwipeRef,
        historyMenuOpen,
        historyMenuRef,
        isDemoMode,
        isHdrItemProcessing,
        locale,
        localDraftDiagnostics,
        logoMark,
        message,
        missingResultHdrItems,
        moveResultCropDrag,
        newProjectName,
        openFeatureProjectDialog,
        openSettings,
        openViewer,
        previewResultReorder,
        processingPanelDetail,
        processingPanelTitle,
        projectFreeRegenerationsRemaining,
        projectToDelete,
        renderBillingRechargeLayer,
        resetResultEditorSettings,
        resolveMediaUrl,
        resultCanvasRef,
        resultCardRefs,
        resultRegenerateBusy,
        resultThumbnailUrls,
        returnToStudioFeatureCards,
        safeStudioGuideStep,
        safeViewerIndex,
        saveResultColorCard,
        selectedFeature,
        session,
        setCreateDialogDragActive,
        setCurrentProjectId,
        setDownloadDraft,
        setDragActive,
        setDragOverResultHdrItemId,
        setDraggedResultHdrItemId,
        setGroupColorOverrides,
        setHistoryMenuOpen,
        setNewProjectName,
        setProjectToDelete,
        setResultColorCards,
        setResultDragPreview,
        setResultViewerIndex,
        setSettingsDraft,
        setSettingsOpen,
        setStudioGuideStep,
        setUserMenuOpen,
        settingsBusy,
        settingsDraft,
        settingsMessage,
        settingsOpen,
        shiftViewer,
        showAdvancedGroupingControls,
        showLocalImportDiagnostics,
        showProcessingGroupGrid,
        showProcessingStepContent,
        showProcessingUploadProgress,
        showRecoverUploadAction,
        showResumeUploadAction,
        showResultsStepContent,
        showRetryProcessingAction,
        showReviewActions,
        showReviewLocalImportProgress,
        showReviewStepContent,
        showReviewUploadProgress,
        showUploadProgress,
        showUploadStepContent,
        signOut,
        startResultCropDrag,
        startResultCropFrameDrag,
        studioGuideOpen,
        studioGuideSteps,
        triggerFilePicker,
        updateResultAspectRatio,
        updateResultEditorSettings,
        uploadActive,
        uploadPaused,
        uploadPercent,
        uploadProgressLabel,
        uploadProgressWidth,
        userMenuOpen,
        userMenuRef,
        viewerAssets,
        visibleProjects,
        visibleStudioFeatures,
        workspaceGroups,
        workspaceHdrItems,
        workspacePointsEstimate,
        workspaceReviewProject,
        zoomResultCrop
      }}
    />
  );
}

export default App;
