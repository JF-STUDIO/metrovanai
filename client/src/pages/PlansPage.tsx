export interface PlansPageCopy {
  plansHeroKicker: string;
  plansHeroTitle: string;
  plansHeroSub: string;
  plansMetaUnit: string;
  plansMetaPhoto: string;
  plansMetaMax: string;
  plansLockBadge: string;
  plansLockTitle: string;
  plansLockSub: string;
  plansTagStarter: string;
  plansTagGrowth: string;
  plansTagPro: string;
  plansTagStudio: string;
  plansBestValue: string;
  plansCredits: string;
  plansOffLabel: (discountPercent: number) => string;
  plansBonusLabel: (bonusPoints: number) => string;
  plansPerPhoto: string;
  plansChoose: string;
  plansBenefitsKicker: string;
  plansBenefitsTitle: string;
  plansBen1Title: string;
  plansBen1Desc: string;
  plansBen2Title: string;
  plansBen2Desc: string;
  plansBen3Title: string;
  plansBen3Desc: string;
  plansBen4Title: string;
  plansBen4Desc: string;
  plansBen5Title: string;
  plansBen5Desc: string;
  plansBen6Title: string;
  plansBen6Desc: string;
  plansScenesKicker: string;
  plansScenesTitle: string;
  plansScene1Tag: string;
  plansScene1Title: string;
  plansScene1Desc: string;
  plansScene1MetaLabel: string;
  plansScene1MetaValue: string;
  plansScene2Tag: string;
  plansScene2Title: string;
  plansScene2Desc: string;
  plansScene2MetaLabel: string;
  plansScene2MetaValue: string;
  plansScene3Tag: string;
  plansScene3Title: string;
  plansScene3Desc: string;
  plansScene3MetaLabel: string;
  plansScene3MetaValue: string;
  plansFaqKicker: string;
  plansFaqTitle: string;
  plansFaq1Q: string;
  plansFaq1A: string;
  plansFaq2Q: string;
  plansFaq2A: string;
  plansFaq3Q: string;
  plansFaq3A: string;
  plansFaq5Q: string;
  plansFaq5A: string;
  plansCtaTitle: string;
  plansCtaSub: string;
  plansCtaBtn: string;
}

interface PlansPageProps {
  copy: PlansPageCopy;
  onStart: () => void;
}

export function PlansPage({ copy, onStart }: PlansPageProps) {
  return (
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
            <button className="solid-button plans-tier-cta" type="button" onClick={onStart}>
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
          ].map((item) => (
            <details key={item.q} className="plans-faq-item">
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
        <button className="solid-button large rounded-pill plans-cta-btn" type="button" onClick={onStart}>
          {copy.plansCtaBtn}
        </button>
      </div>
    </section>
  );
}
