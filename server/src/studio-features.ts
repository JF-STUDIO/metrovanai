import type { StudioFeatureConfig } from './types.js';

export const MIN_STUDIO_FEATURE_POINTS_PER_PHOTO = 0;
export const MAX_STUDIO_FEATURE_POINTS_PER_PHOTO = 1000;

export const DEFAULT_STUDIO_FEATURES: StudioFeatureConfig[] = [
  {
    id: 'hdr-true-color',
    enabled: true,
    category: 'interior',
    status: 'available',
    titleZh: 'HDR 真实色彩',
    titleEn: 'HDR True Color',
    descriptionZh: '保留房间原本墙面色彩，平衡窗景和室内曝光。',
    descriptionEn: 'Keeps original wall color while balancing window views and interior exposure.',
    detailZh: '适合真实墙色、木地板、自然光和窗景的室内空间。',
    detailEn: 'Best for interiors with real wall colors, wood floors, natural light, and window views.',
    tagZh: '室内 HDR',
    tagEn: 'Interior HDR',
    beforeImageUrl: '',
    afterImageUrl: '',
    workflowId: '',
    inputNodeId: '',
    outputNodeId: '',
    pointsPerPhoto: 1,
    tone: 'warm'
  },
  {
    id: 'hdr-white-wall',
    enabled: true,
    category: 'interior',
    status: 'beta',
    titleZh: 'HDR 白墙',
    titleEn: 'HDR White Wall',
    descriptionZh: '适合白墙空间，统一墙面白平衡并保持自然室内亮度。',
    descriptionEn: 'For white-wall rooms, keeping walls neutral and interiors naturally bright.',
    detailZh: '适合公寓、样板间和极简白墙空间。',
    detailEn: 'Best for apartments, staging rooms, and minimal white-wall spaces.',
    tagZh: '室内 白墙',
    tagEn: 'Interior White Wall',
    beforeImageUrl: '',
    afterImageUrl: '',
    workflowId: '',
    inputNodeId: '',
    outputNodeId: '',
    pointsPerPhoto: 1,
    tone: 'white'
  }
];

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  return (typeof value === 'string' ? value.trim() : '').slice(0, maxLength);
}

function normalizeCategory(value: unknown): StudioFeatureConfig['category'] {
  return value === 'interior' || value === 'exterior' || value === 'special' || value === 'new' || value === 'all'
    ? value
    : 'interior';
}

function normalizeStatus(value: unknown): StudioFeatureConfig['status'] {
  return value === 'beta' ? 'beta' : 'available';
}

function normalizeTone(value: unknown): StudioFeatureConfig['tone'] {
  return value === 'white' || value === 'dusk' || value === 'blue' || value === 'season' || value === 'warm'
    ? value
    : 'warm';
}

function normalizePointsPerPhoto(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(
    MIN_STUDIO_FEATURE_POINTS_PER_PHOTO,
    Math.min(MAX_STUDIO_FEATURE_POINTS_PER_PHOTO, Math.round(parsed))
  );
}

export function normalizeStudioFeature(input: Partial<StudioFeatureConfig> | undefined, fallback: StudioFeatureConfig) {
  return {
    id: normalizeText(input?.id, fallback.id, 80).replace(/[^a-zA-Z0-9._-]/g, '-') || fallback.id,
    enabled: input?.enabled !== false,
    category: normalizeCategory(input?.category ?? fallback.category),
    status: normalizeStatus(input?.status ?? fallback.status),
    titleZh: normalizeText(input?.titleZh, fallback.titleZh, 80),
    titleEn: normalizeText(input?.titleEn, fallback.titleEn, 80),
    descriptionZh: normalizeText(input?.descriptionZh, fallback.descriptionZh, 240),
    descriptionEn: normalizeText(input?.descriptionEn, fallback.descriptionEn, 240),
    detailZh: normalizeText(input?.detailZh, fallback.detailZh, 500),
    detailEn: normalizeText(input?.detailEn, fallback.detailEn, 500),
    tagZh: normalizeText(input?.tagZh, fallback.tagZh, 40),
    tagEn: normalizeText(input?.tagEn, fallback.tagEn, 40),
    beforeImageUrl: normalizeOptionalText(input?.beforeImageUrl ?? fallback.beforeImageUrl, 1000),
    afterImageUrl: normalizeOptionalText(input?.afterImageUrl ?? fallback.afterImageUrl, 1000),
    workflowId: normalizeOptionalText(input?.workflowId ?? fallback.workflowId, 160),
    inputNodeId: normalizeOptionalText(input?.inputNodeId ?? fallback.inputNodeId, 160),
    outputNodeId: normalizeOptionalText(input?.outputNodeId ?? fallback.outputNodeId, 160),
    pointsPerPhoto: normalizePointsPerPhoto(input?.pointsPerPhoto, fallback.pointsPerPhoto),
    tone: normalizeTone(input?.tone ?? fallback.tone)
  };
}

export function normalizeStudioFeatures(input: unknown) {
  const defaultsById = new Map(DEFAULT_STUDIO_FEATURES.map((feature) => [feature.id, feature]));
  const rawItems = Array.isArray(input) ? input : DEFAULT_STUDIO_FEATURES;
  const normalized = rawItems
    .map((item, index) => {
      const raw = item && typeof item === 'object' ? (item as Partial<StudioFeatureConfig>) : {};
      const fallback = defaultsById.get(String(raw.id ?? '')) ?? DEFAULT_STUDIO_FEATURES[index] ?? DEFAULT_STUDIO_FEATURES[0]!;
      return normalizeStudioFeature(raw, fallback);
    })
    .filter((feature, index, items) => items.findIndex((candidate) => candidate.id === feature.id) === index);

  for (const feature of DEFAULT_STUDIO_FEATURES) {
    if (!normalized.some((item) => item.id === feature.id)) {
      normalized.push(normalizeStudioFeature(feature, feature));
    }
  }

  return normalized;
}

export function getEnabledStudioFeatures(settings: { studioFeatures?: StudioFeatureConfig[] }) {
  return normalizeStudioFeatures(settings.studioFeatures).filter((feature) => feature.enabled);
}
