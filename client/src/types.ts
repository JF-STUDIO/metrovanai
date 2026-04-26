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

export interface ProjectJobState {
  id: string;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  percent: number;
  label: string;
  detail: string;
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
  photoCount: number;
  groupCount: number;
  downloadReady: boolean;
  createdAt: string;
  updatedAt: string;
  hdrItems: HdrItem[];
  groups: ProjectGroup[];
  resultAssets: ResultAsset[];
  job: ProjectJobState | null;
}
