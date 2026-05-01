import type { UiLocale } from '../app-copy';
import type { StudioFeatureDefinition } from '../studio-features';

interface StudioFeatureLaunchPanelProps {
  availableFeatureCount: number;
  locale: UiLocale;
  visibleStudioFeatures: StudioFeatureDefinition[];
  onOpenFeatureProjectDialog: (feature: StudioFeatureDefinition) => void;
}

export function StudioFeatureLaunchPanel({
  availableFeatureCount,
  locale,
  visibleStudioFeatures,
  onOpenFeatureProjectDialog
}: StudioFeatureLaunchPanelProps) {
  return (
    <section className="feature-launch-panel">
      <div className="feature-launch-head">
        <div>
          <p>
            {locale === 'en'
              ? 'Choose the retouching workflow that best matches the shoot. Each card uses a tuned processing flow and shows credits in real time.'
              : '选择最贴合您拍摄场景的修图功能。每张功能卡片对应一条经过调校的处理流程，所需积分实时显示。'}
          </p>
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
              onClick={() => onOpenFeatureProjectDialog(feature)}
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
                {locked && <span className="studio-feature-lock">{locale === 'en' ? 'Coming soon' : '建设中'}</span>}
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
        <span>{locale === 'en' ? ' workflows available. More are being connected.' : '个功能可用，更多功能正在接入。'}</span>
      </div>
    </section>
  );
}
