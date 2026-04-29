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
export type UserLocale = 'zh' | 'en';
export type UserRole = 'user' | 'admin';
export type UserAccountStatus = 'active' | 'disabled';
export type HdrItemStatus =
  | 'review'
  | 'hdr-processing'
  | 'workflow-upload'
  | 'workflow-running'
  | 'completed'
  | 'error';

export interface ExposureFile {
  id: string;
  fileName: string;
  originalName: string;
  extension: string;
  mimeType: string;
  size: number;
  isRaw: boolean;
  storageKey?: string;
  storagePath: string;
  storageUrl: string;
  previewKey?: string | null;
  previewPath: string | null;
  previewUrl: string | null;
  captureTime: string | null;
  sequenceNumber: number | null;
  exposureCompensation: number | null;
  exposureSeconds: number | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
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
  mergedKey?: string | null;
  mergedPath: string | null;
  mergedUrl: string | null;
  resultKey?: string | null;
  resultPath: string | null;
  resultUrl: string | null;
  resultFileName: string | null;
  workflow?: HdrItemWorkflowState;
  regeneration?: ResultRegenerationState;
  exposures: ExposureFile[];
}

export type HdrItemWorkflowStage = 'idle' | 'runpod' | 'runninghub' | 'completed' | 'failed';

export interface HdrItemWorkflowState {
  stage: HdrItemWorkflowStage;
  runpodJobId: string | null;
  runpodBatchJobId: string | null;
  runningHubTaskId: string | null;
  runningHubWorkflowName: string | null;
  lastTaskId: string | null;
  lastTaskProvider: 'runpod' | 'runninghub' | null;
  submittedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
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
  storageKey?: string;
  storagePath: string;
  storageUrl: string;
  previewUrl: string | null;
  sortOrder: number;
  regeneration?: ResultRegenerationState;
}

export type ProjectDownloadJobStatus = 'queued' | 'preflight' | 'packaging' | 'uploading' | 'ready' | 'failed' | 'cancelled';

export interface ProjectDownloadJobRecord {
  jobId: string;
  requestKey: string;
  projectId: string;
  userKey: string;
  options: unknown;
  status: ProjectDownloadJobStatus;
  progress: number;
  createdAt: number;
  completedAt: number | null;
  downloadKey: string | null;
  downloadUrl: string | null;
  expiresAt: number | null;
  error: string | null;
}

export interface WorkflowRealtimeInfo {
  total: number;
  entered: number;
  returned: number;
  active: number;
  failed: number;
  succeeded: number;
  currentNodeName: string;
  currentNodeId: string;
  currentNodePercent: number;
  monitorState: string;
  transport: string;
  detail: string;
  queuePosition: number;
  remoteProgress: number;
}

export type ProjectJobPhase =
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

export interface ProjectJobState {
  id: string;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  phase: ProjectJobPhase;
  percent: number;
  label: string;
  detail: string;
  currentHdrItemId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  workflowRealtime: WorkflowRealtimeInfo;
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

export interface BillingActivationCode {
  id: string;
  code: string;
  label: string;
  active: boolean;
  packageId: string | null;
  discountPercentOverride: number | null;
  bonusPoints: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentOrderStatus = 'pending' | 'checkout_created' | 'paid' | 'failed' | 'expired' | 'cancelled';

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
  checkoutUrl: string | null;
  status: PaymentOrderStatus;
  errorMessage: string | null;
  billingEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
}

export interface UserRecord {
  id: string;
  userKey: string;
  email: string;
  emailVerifiedAt: string | null;
  displayName: string;
  locale: UserLocale;
  role: UserRole;
  accountStatus: UserAccountStatus;
  passwordHash: string | null;
  googleSubject: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: 'admin-user' | 'admin-key' | 'system';
  action: string;
  targetUserId: string | null;
  targetProjectId: string | null;
  ipAddress: string;
  userAgent: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface SystemSettings {
  runpodHdrBatchSize: number;
  runningHubMaxInFlight: number;
  billingPackages: BillingPackage[];
  studioFeatures: StudioFeatureConfig[];
}

export interface StudioFeatureConfig {
  id: string;
  enabled: boolean;
  category: 'all' | 'interior' | 'exterior' | 'special' | 'new';
  status: 'available' | 'beta';
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  detailZh: string;
  detailEn: string;
  tagZh: string;
  tagEn: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  workflowId: string;
  inputNodeId: string;
  outputNodeId: string;
  pointsPerPhoto: number;
  tone: 'warm' | 'white' | 'dusk' | 'blue' | 'season';
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfTokenHash: string | null;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface EmailVerificationTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
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
}

export interface WorkflowNodeMapping {
  nodeId: string;
  fieldName: string;
  mode: string;
}

export interface WorkflowConfigItem {
  name: string;
  type: string;
  purpose?: string;
  colorCardNo?: string | number;
  colorCard?: string | number;
  cardNo?: string | number;
  card?: string | number;
  workflowId?: string;
  instanceType?: string;
  prompt?: {
    nodeId: string;
    fieldName: string;
    mode: string;
    defaultText: string;
  };
  inputs: WorkflowNodeMapping[];
  outputs: WorkflowNodeMapping[];
}

export interface WorkflowSettings {
  inputMode: string;
  groupMode: string;
  saveHDR: boolean;
  saveGroups: boolean;
  outputRoot: string;
  workflowMaxInFlight: number;
  extraFolders: string[];
}

export interface WorkflowConfigFile {
  active: string;
  apiKey: string;
  settings: WorkflowSettings;
  items: WorkflowConfigItem[];
}
