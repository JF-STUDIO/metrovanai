export type ProjectStatus =
  | 'draft'
  | 'importing'
  | 'review'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed';

export type SceneType = 'interior' | 'exterior' | 'pending';
export type ColorMode = 'default' | 'replace';
export type HdrItemStatus =
  | 'review'
  | 'hdr-processing'
  | 'workflow-upload'
  | 'workflow-running'
  | 'processing'
  | 'completed'
  | 'error';
export type LocalImportReviewState = 'normal' | 'preview-missing' | 'manual-review';
export type LocalImportMetadataState = 'exif' | 'fallback';
export type LocalImportPreviewState = 'ready' | 'missing';

export interface ExposureFile {
  id: string;
  fileName: string;
  originalName: string;
  extension: string;
  mimeType: string;
  size: number;
  isRaw: boolean;
  previewUrl: string | null;
  captureTime: string | null;
  sequenceNumber: number | null;
  exposureCompensation: number | null;
  exposureSeconds: number | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  localPreviewState?: LocalImportPreviewState;
  localMetadataState?: LocalImportMetadataState;
  localReviewState?: LocalImportReviewState;
}

export interface HdrItem {
  id: string;
  index: number;
  title: string;
  groupId: string;
  sceneType: SceneType;
  selectedExposureId: string;
  previewUrl: string | null;
  status: HdrItemStatus;
  statusText: string;
  errorMessage: string | null;
  resultUrl: string | null;
  resultFileName: string | null;
  regeneration?: ResultRegenerationState;
  exposures: ExposureFile[];
  localReviewState?: LocalImportReviewState;
}

export type ResultRegenerationStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ResultRegenerationState {
  freeUsed: boolean;
  status: ResultRegenerationStatus;
  colorCardNo: string | null;
  workflowName: string | null;
  taskId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ProjectRegenerationUsage {
  freeLimit: number;
  freeUsed: number;
  paidUsed: number;
}

export interface ProjectGroup {
  id: string;
  index: number;
  name: string;
  sceneType: SceneType;
  colorMode: ColorMode;
  replacementColor: string | null;
  hdrItemIds: string[];
}

export interface ResultAsset {
  id: string;
  hdrItemId: string;
  fileName: string;
  storageUrl: string;
  previewUrl: string | null;
  sortOrder: number;
  regeneration?: ResultRegenerationState;
}

export interface ProjectAdminHealth {
  status: 'healthy' | 'attention' | 'processing' | 'idle' | string;
  reviewed: boolean;
  maintenanceReview: ProjectRecord['maintenanceReview'] | null;
  exposureCount: number;
  hdrCount: number;
  resultCount: number;
  failedCount: number;
  processingCount: number;
  missingSourceCount: number;
  downloadReady: boolean;
  latestDownloadJob: {
    jobId: string;
    status: string;
    completedAt: number | null;
    error: string | null;
  } | null;
  warnings: string[];
  rootCauseSummary?: string;
  issues?: Array<{
    code: string;
    severity: 'warning' | 'error' | string;
    title: string;
    detail: string;
    action?: 'retry-failed-processing' | 'regenerate-download' | 'mark-stalled-failed' | 'acknowledge-maintenance' | 'deep-health' | string;
  }>;
  failedItemDiagnostics?: Array<{
    id: string;
    hdrIndex: number;
    title: string;
    fileName: string;
    status: string;
    provider: 'runpod' | 'runninghub' | string | null;
    stage: string | null;
    runpodJobId: string | null;
    runpodBatchJobId: string | null;
    runningHubTaskId: string | null;
    updatedAt: string | null;
    errorMessage: string | null;
    exposureCount: number;
    missingSourceReferenceCount: number;
    incomingSourceCount: number;
    causeCode: string;
    causeTitle: string;
    causeDetail: string;
    recommendedAction: string;
  }>;
  recommendedActions?: Array<'retry-failed-processing' | 'regenerate-download' | 'mark-stalled-failed' | 'acknowledge-maintenance' | 'deep-health' | string>;
  rawJpegSidecarGroups: string[];
  duplicateSourceGroups: string[];
  suspiciousResultFiles: string[];
}

export interface ProjectAdminDeepHealth {
  status: 'passed' | 'warning' | 'failed' | string;
  startedAt: string;
  completedAt: string;
  checkedObjects: number;
  missingObjects: number;
  sizeMismatchObjects: number;
  issueCount: number;
  issues: Array<{
    severity: 'warning' | 'error' | string;
    scope: string;
    name: string;
    message: string;
  }>;
}

export type AdminFailedPhotoDiagnostic = NonNullable<NonNullable<ProjectAdminHealth['failedItemDiagnostics']>[number]>;

export interface AdminFailedPhotoRow {
  id: string;
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  projectUpdatedAt: string;
  userKey: string;
  userDisplayName: string;
  photoCount: number;
  resultCount: number;
  hdrCount: number;
  diagnostic: AdminFailedPhotoDiagnostic;
}

export interface ProjectJobState {
  id: string;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  phase?:
    | 'idle'
    | 'uploading'
    | 'grouping'
    | 'queued'
    | 'hdr_merging'
    | 'workflow_uploading'
    | 'workflow_running'
    | 'result_returning'
    | 'regenerating'
    | 'completed'
    | 'failed';
  phaseLabel?: string;
  percent: number;
  label: string;
  detail: string;
  currentHdrItemId?: string | null;
  taskId?: string | null;
  metrics?: {
    total: number;
    submitted: number;
    returned: number;
    succeeded: number;
    failed: number;
    active: number;
    queuePosition: number;
    remoteProgress: number;
  };
  startedAt: string | null;
  completedAt: string | null;
}

export interface BillingEntry {
  id: string;
  projectId: string | null;
  projectName: string;
  userKey: string;
  type: 'charge' | 'credit';
  points: number;
  amountUsd: number;
  createdAt: string;
  note: string;
  activationCodeId?: string | null;
  activationCode?: string | null;
  activationCodeLabel?: string | null;
}

export interface BillingSummary {
  availablePoints: number;
  totalCreditedPoints: number;
  totalChargedPoints: number;
  totalTopUpUsd: number;
  totalProjectChargedPoints: number;
  totalAdminAdjustedCreditPoints: number;
  totalAdminAdjustedChargePoints: number;
}

export interface BillingPackage {
  id: string;
  name: string;
  points: number;
  listPriceUsd: number;
  amountUsd: number;
  discountPercent: number;
  pointPriceUsd: number;
  bonusPoints: number;
}

export type PaymentOrderStatus =
  | 'pending'
  | 'checkout_created'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refunded';

export interface PaymentOrderRecord {
  id: string;
  userId: string;
  userKey: string;
  email: string;
  packageId: string;
  packageName: string;
  points: number;
  amountUsd: number;
  currency: string;
  activationCodeId: string | null;
  activationCode: string | null;
  activationCodeLabel: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string | null;
  stripeReceiptUrl: string | null;
  stripeInvoiceUrl: string | null;
  stripeInvoicePdfUrl: string | null;
  stripeRefundId: string | null;
  refundedAmountUsd: number;
  refundedPoints: number;
  refundBillingEntryId: string | null;
  refundedAt: string | null;
  checkoutUrl: string | null;
  status: PaymentOrderStatus;
  errorMessage: string | null;
  billingEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
}

export interface PaymentOrderRefundPreview {
  orderId: string;
  orderAmountUsd: number;
  creditedPoints: number;
  currentBalance: number;
  consumedPoints: number;
  alreadyRefundedAmountUsd: number;
  alreadyRefundedPoints: number;
  refundableAmountUsd: number;
  refundablePoints: number;
  balanceAfterRefund: number;
}

export interface ProjectRecord {
  id: string;
  userKey: string;
  userDisplayName: string;
  name: string;
  address: string;
  status: ProjectStatus;
  currentStep: 1 | 2 | 3 | 4;
  pointsEstimate: number;
  pointsSpent: number;
  studioFeatureId?: string | null;
  studioFeatureTitle?: string | null;
  workflowId?: string | null;
  workflowInputNodeId?: string | null;
  workflowOutputNodeId?: string | null;
  pointsPerPhoto?: number;
  regenerationUsage: ProjectRegenerationUsage;
  photoCount: number;
  groupCount: number;
  downloadReady: boolean;
  createdAt: string;
  updatedAt: string;
  uploadCompletedAt: string | null;
  hdrItems: HdrItem[];
  groups: ProjectGroup[];
  resultAssets: ResultAsset[];
  job: ProjectJobState | null;
  maintenanceReview?: {
    signature: string;
    reviewedAt: string;
    reviewedBy: string;
    note: string | null;
  } | null;
  adminHealth?: ProjectAdminHealth;
  adminDeepHealth?: ProjectAdminDeepHealth;
}
