import showcaseExteriorAfter from './assets/showcase-exterior-after.webp';
import showcaseInteriorAfter from './assets/showcase-interior-after.webp';
import showcaseInteriorBefore from './assets/showcase-interior-before.webp';
import type { StudioFeatureConfig } from './api';
import type { UiLocale } from './app-copy';

export type StudioFeatureId = string;
export type StudioFeatureStatus = 'available' | 'beta' | 'locked';

export interface StudioFeatureDefinition {
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

export const STUDIO_FEATURES: StudioFeatureDefinition[] = [
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

export function studioFeatureConfigToDefinition(feature: StudioFeatureConfig): StudioFeatureDefinition {
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

export function normalizeStudioFeatureDrafts(features: StudioFeatureConfig[] | undefined) {
  return Array.isArray(features) ? features : [];
}
