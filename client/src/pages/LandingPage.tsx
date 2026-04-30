import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import logoFull from '../assets/metrovan-logo-full.webp';
import jinSignatureAvatar from '../assets/jin-signature-avatar.webp';
import showcaseInteriorAfter from '../assets/showcase-interior-after.webp';
import showcaseInteriorBefore from '../assets/showcase-interior-before.webp';
import landingVideoPoster from '../assets/landing-video-poster.webp';
import type { PlansPageCopy } from './PlansPage';

const LANDING_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4';

const PlansPage = lazy(() => import('./PlansPage').then((module) => ({ default: module.PlansPage })));

type LandingRoute = 'home' | 'plans';
type LandingNavigateRoute = 'home' | 'plans' | 'studio';
type LandingAuthMode = 'signin' | 'signup';

export interface LandingPageCopy extends PlansPageCopy {
  home: string;
  plansNav: string;
  examplesNav: string;
  workflowNav: string;
  faqNav: string;
  studioLabel: string;
  landingSignIn: string;
  landingStartProject: string;
  landingViewExamples: string;
  landingHeroBadge: string;
  landingHeroTitle: string;
  landingHeroAccent: string;
  landingHeroSub: string;
  landingTrustFast: string;
  landingTrustColor: string;
  landingTrustBilling: string;
}

interface LandingPageProps {
  activeRoute: LandingRoute;
  copy: LandingPageCopy;
  hasSession: boolean;
  message: string;
  onNavigate: (route: LandingNavigateRoute) => void;
  onOpenAuth: (mode: LandingAuthMode) => void;
}

function attemptLandingVideoPlayback(video: HTMLVideoElement | null) {
  if (!video) return;

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

export function LandingPage({ activeRoute, copy, hasSession, message, onNavigate, onOpenAuth }: LandingPageProps) {
  const landingVideoRef = useRef<HTMLVideoElement | null>(null);
  const scrollToHomeSection = (sectionId: string) => {
    if (activeRoute !== 'home') {
      onNavigate('home');
      window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return;
    }
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const video = landingVideoRef.current;
    if (!video) {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let activated = false;
    let activationTimerId: number | null = null;
    let activationIdleId: number | null = null;
    const activateVideo = () => {
      if (activated) {
        attemptLandingVideoPlayback(video);
        return;
      }

      activated = true;
      video.preload = 'auto';
      if (!video.getAttribute('src')) {
        video.src = LANDING_VIDEO_URL;
      }
      video.load();
      attemptLandingVideoPlayback(video);
    };
    const clearScheduledActivation = () => {
      if (activationTimerId !== null) {
        window.clearTimeout(activationTimerId);
        activationTimerId = null;
      }
      if (activationIdleId !== null) {
        idleWindow.cancelIdleCallback?.(activationIdleId);
        activationIdleId = null;
      }
    };
    const scheduleActivation = () => {
      if (activated) {
        activateVideo();
        return;
      }
      if (activationTimerId !== null || activationIdleId !== null) {
        return;
      }

      const start = () => {
        activationTimerId = null;
        activationIdleId = null;
        activateVideo();
      };
      if (typeof idleWindow.requestIdleCallback === 'function') {
        activationIdleId = idleWindow.requestIdleCallback(start, { timeout: 2400 });
      } else {
        activationTimerId = window.setTimeout(start, 1200);
      }
    };
    const retryPlayback = () => activateVideo();
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        retryPlayback();
      }
    };

    let fallbackFrameId: number | null = null;
    let observer: IntersectionObserver | null = null;
    const IntersectionObserverCtor = window.IntersectionObserver;
    if (typeof IntersectionObserverCtor === 'function') {
      observer = new IntersectionObserverCtor(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            scheduleActivation();
            observer?.disconnect();
          }
        },
        { rootMargin: '100px 0px' }
      );
      observer.observe(video);
    } else {
      fallbackFrameId = window.requestAnimationFrame(scheduleActivation);
    }

    window.addEventListener('pageshow', retryPlayback);
    window.addEventListener('touchstart', retryPlayback, { passive: true });
    window.addEventListener('pointerdown', retryPlayback, { passive: true });
    document.addEventListener('visibilitychange', retryWhenVisible);

    return () => {
      observer?.disconnect();
      clearScheduledActivation();
      if (fallbackFrameId !== null) {
        window.cancelAnimationFrame(fallbackFrameId);
      }
      window.removeEventListener('pageshow', retryPlayback);
      window.removeEventListener('touchstart', retryPlayback);
      window.removeEventListener('pointerdown', retryPlayback);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, []);

  return (
    <main className="landing-shell">
      <div className="landing-video-wrap">
        <video
          ref={landingVideoRef}
          className="landing-video"
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          poster={landingVideoPoster}
          disablePictureInPicture
          onCanPlay={() => attemptLandingVideoPlayback(landingVideoRef.current)}
        />
        <div className="landing-video-overlay" />
      </div>
      <div className="ambient-layer" />
      <header className="landing-nav">
        <button className="brand-button landing-brand" type="button" onClick={() => onNavigate('home')}>
          <img className="landing-brand-logo" src={logoFull} alt="Metrovan AI" decoding="async" />
        </button>
        <nav className="landing-links" aria-label="Primary">
          <button
            className={`landing-home-link${activeRoute === 'home' ? ' active' : ''}`}
            type="button"
            aria-current={activeRoute === 'home' ? 'page' : undefined}
            onClick={() => onNavigate('home')}
          >
            {copy.home}
          </button>
          <button
            className={`landing-home-link${activeRoute === 'plans' ? ' active' : ''}`}
            type="button"
            aria-current={activeRoute === 'plans' ? 'page' : undefined}
            onClick={() => onNavigate('plans')}
          >
            {copy.plansNav}
          </button>
          <button className="landing-home-link" type="button" onClick={() => scrollToHomeSection('examples')}>
            {copy.examplesNav}
          </button>
          <button className="landing-home-link" type="button" onClick={() => scrollToHomeSection('workflow')}>
            {copy.workflowNav}
          </button>
          <button className="landing-home-link" type="button" onClick={() => scrollToHomeSection('faq')}>
            {copy.faqNav}
          </button>
        </nav>
        <div className="landing-actions">
          <button
            className="solid-button nav-signin"
            type="button"
            onClick={() => (hasSession ? onNavigate('studio') : onOpenAuth('signin'))}
          >
            {hasSession ? copy.studioLabel : copy.landingSignIn}
          </button>
        </div>
      </header>

      {message && <div className="global-message landing-global-message">{message}</div>}

      {activeRoute !== 'plans' && (
        <>
          <section className="landing-hero restored-hero">
            <div className="hero-copy centered">
              <span className="hero-badge restored-badge">
                <span className="hero-badge-pill">AI</span>
                <span>{copy.landingHeroBadge}</span>
              </span>
              <h1>
                {copy.landingHeroTitle}
                <br />
                <em>{copy.landingHeroAccent}</em>
              </h1>
              <p>{copy.landingHeroSub}</p>
              <div className="hero-trust-row" aria-label="Metrovan AI service highlights">
                <span>{copy.landingTrustFast}</span>
                <span>{copy.landingTrustColor}</span>
                <span>{copy.landingTrustBilling}</span>
              </div>
              <div className="hero-actions centered">
                <button
                  className="solid-button large rounded-pill"
                  type="button"
                  onClick={() => (hasSession ? onNavigate('studio') : onOpenAuth('signup'))}
                >
                  {copy.landingStartProject}
                </button>
                <button className="ghost-button large rounded-pill" type="button" onClick={() => scrollToHomeSection('examples')}>
                  {copy.landingViewExamples}
                </button>
              </div>
            </div>
          </section>

          <section className="showcase-section" id="examples">
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
                        <small>Color cast 路 Uneven light 路 Soft detail.</small>
                      </div>
                      <div className="showcase-sci-render-caption-side is-after">
                        <strong>AI Enhanced</strong>
                        <small>Neutral white 路 Balanced light 路 Sky replaced.</small>
                      </div>
                    </figcaption>
                  </figure>

                  <div className="showcase-sci-steps" id="workflow" aria-hidden="true">
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

          <section className="quote-section" id="faq">
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

      {activeRoute === 'plans' && (
        <Suspense fallback={<div className="plans-section plans-loading" aria-busy="true">正在加载方案...</div>}>
          <PlansPage copy={copy} onStart={() => (hasSession ? onNavigate('studio') : onOpenAuth('signup'))} />
        </Suspense>
      )}
    </main>
  );
}
