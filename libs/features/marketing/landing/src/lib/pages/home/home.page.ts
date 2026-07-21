import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CursorTargetDirective } from '@creativo/shared/cursor';
import { Button, CrText, MaterialDirective } from '@creativo/shared/ui';
import { LanguageService } from '../../language.service';
import { ServicesPage } from '../services/services.page';
import { LocationsComponent } from './locations/locations.component';
import { TeamShowcaseComponent } from './team-showcase/team-showcase.component';
import { WorkGalleryComponent } from './work-gallery/work-gallery.component';

@Component({
  selector: 'cr-home-page',
  imports: [
    Button,
    CrText,
    CursorTargetDirective,
    LocationsComponent,
    MaterialDirective,
    ServicesPage,
    TeamShowcaseComponent,
    TranslocoDirective,
    WorkGalleryComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage implements AfterViewInit {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly language = inject(LanguageService);

  /** Shared with the shell header's language menu (LanguageService). */
  protected readonly languages = this.language.languages;
  protected readonly activeLang = this.language.activeLang;

  protected readonly heroPaused = signal(false);
  protected readonly craftPaused = signal(false);

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const hero = host.querySelector<HTMLElement>('.hero');
    const heroFrame = host.querySelector<HTMLElement>('.hero__frame');
    const parallaxItems = Array.from(
      host.querySelectorAll<HTMLElement>('[data-parallax]'),
    );
    const cleanups: Array<() => void> = [];
    let frame = 0;
    let observeReveals: (() => void) | undefined;

    if (window.location.hash) {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      const alignToFragment = () => {
        const target = this.document.getElementById(targetId);
        if (!target) return;
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: Math.max(0, top) });
      };
      requestAnimationFrame(() => requestAnimationFrame(alignToFragment));
      const fragmentTimer = window.setTimeout(alignToFragment, 700);
      window.addEventListener('load', alignToFragment, { once: true });
      cleanups.push(() => {
        window.clearTimeout(fragmentTimer);
        window.removeEventListener('load', alignToFragment);
      });
    }

    if (!reducedMotion) {
      host.setAttribute('data-motion-ready', '');
      host
        .querySelectorAll<HTMLElement>('[data-hero-reveal]')
        .forEach((element, index) => {
          if (typeof element.animate !== 'function') return;
          element.animate(
            [
              {
                opacity: 0,
                transform: 'translateY(115%) rotate(2deg)',
                filter: 'blur(12px)',
              },
              {
                opacity: 1,
                transform: 'translateY(0) rotate(0)',
                filter: 'blur(0)',
              },
            ],
            {
              duration: 1050,
              delay: 100 + index * 150,
              easing: 'cubic-bezier(.16,1,.3,1)',
              fill: 'both',
            },
          );
        });
    }

    if (typeof IntersectionObserver === 'function') {
      const revealObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).setAttribute('data-visible', '');
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -7% 0px', threshold: 0.08 },
      );
      // Re-run whenever `@defer` blocks hydrate (the layout observer below
      // fires then): team/locations render their data-reveal headings only
      // at that point, and elements the one-shot init scan never saw would
      // otherwise sit at the reveal's opacity: 0 start state forever.
      // observe() on an already-observed target is a spec'd no-op, so
      // re-scanning is idempotent.
      observeReveals = () =>
        host
          .querySelectorAll<HTMLElement>('[data-reveal]')
          .forEach((element) => revealObserver.observe(element));
      observeReveals();
      cleanups.push(() => revealObserver.disconnect());

      // Ambient films only decode while on screen; a user's explicit pause
      // (data-user-paused, set by toggleFilm) wins over the viewport
      // resuming them.
      const filmObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            if (!entry.isIntersecting) video.pause();
            else if (!reducedMotion && !('userPaused' in video.dataset))
              video.play().catch(() => undefined);
          }
        },
        { rootMargin: '120px' },
      );
      host
        .querySelectorAll<HTMLVideoElement>('video[data-film]')
        .forEach((video) => filmObserver.observe(video));
      cleanups.push(() => filmObserver.disconnect());
    }

    if (reducedMotion) {
      host
        .querySelectorAll<HTMLVideoElement>('video[data-film]')
        .forEach((video) => {
          video.dataset['userPaused'] = '';
          video.pause();
        });
      this.heroPaused.set(true);
      this.craftPaused.set(true);
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));

    // Mirrors home.page.css's tone → --page-bg mapping. Keeping the browser
    // chrome (`<meta name="theme-color">`: Safari/Chrome URL-bar + iOS
    // status-bar color) on the same token the page background uses makes the
    // frame melt into whichever section is active — same per-section theming
    // the in-page header already follows.
    const toneBackgroundTokens = new Map([
      ['light', '--cr-color-background'],
      ['dark', '--cr-color-foreground'],
      ['accent', '--cr-color-highlight'],
    ]);

    const syncBrowserThemeColor = (tone: string) => {
      const token = toneBackgroundTokens.get(tone) ?? '--cr-color-background';
      const background = window
        .getComputedStyle(this.document.documentElement)
        .getPropertyValue(token)
        .trim();
      const meta = this.document.querySelector('meta[name="theme-color"]');
      if (background && meta) meta.setAttribute('content', background);
    };

    const updateNavigationTone = () => {
      const center = window.innerHeight * 0.46;
      // Queried LIVE, not cached at init: three tone sections live inside
      // `@defer (on viewport)` blocks, so on the client path they don't
      // exist yet when ngAfterViewInit runs — a captured list permanently
      // missed them and the header stayed light over the dark sections.
      // This runs at most once per animation frame over ~7 nodes.
      const active = Array.from(
        host.querySelectorAll<HTMLElement>('[data-nav-tone]'),
      ).find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= center && rect.bottom > center;
      });
      const tone = active?.dataset['navTone'] ?? 'light';
      const root = this.document.documentElement;
      if (root.getAttribute('data-nav-tone') === tone) return;
      root.setAttribute('data-nav-tone', tone);
      syncBrowserThemeColor(tone);
    };

    const updateParallax = () => {
      if (reducedMotion) return;
      for (const item of parallaxItems) {
        const rect = item.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > window.innerHeight + 100) continue;
        const progress = clamp(
          (window.innerHeight - rect.top) / (window.innerHeight + rect.height),
        );
        item.style.setProperty('--parallax-y', `${(progress - 0.5) * 52}px`);
      }
    };

    const updateHero = () => {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      // 0→1 as the hero scrolls out — drives the film's slow drift in CSS.
      const progress = clamp(-rect.top / Math.max(1, rect.height * 0.72));
      hero.style.setProperty('--hero-progress', progress.toString());
    };

    // The shell header floats transparent INSIDE the hero film while the film
    // still sits behind it; once the film scrolls up past the header band it
    // translates flush and turns solid (app.css `[data-header]` rules). The
    // 88px band ≈ the 4rem header + a small lead so the swap lands as the
    // film leaves, not after. Home owns this because the film is a home
    // concern; other routes never set it, so the header stays solid there.
    const updateHeaderMode = () => {
      const root = this.document.documentElement;
      const overlay = heroFrame
        ? heroFrame.getBoundingClientRect().bottom > 88
        : false;
      const mode = overlay ? 'overlay' : 'solid';
      if (root.getAttribute('data-header') !== mode) {
        root.setAttribute('data-header', mode);
      }
    };

    const updateScroll = () => {
      frame = 0;
      updateNavigationTone();
      updateHeaderMode();
      updateParallax();
      updateHero();
    };

    const requestUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateScroll);
    };

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', requestUpdate));
    cleanups.push(() => window.removeEventListener('resize', requestUpdate));
    cleanups.push(() => frame && cancelAnimationFrame(frame));

    // Section heights change without any scroll when @defer blocks hydrate
    // (map, gallery pinning) — recompute the tone then too, or the theme
    // sticks on a stale section until the next scroll event.
    if (typeof ResizeObserver === 'function') {
      const layoutObserver = new ResizeObserver(() => {
        // Deferred sections just appeared/resized — catch their reveal
        // hooks and recompute the tone over the live section list.
        observeReveals?.();
        requestUpdate();
      });
      layoutObserver.observe(host);
      cleanups.push(() => layoutObserver.disconnect());
    }

    // The home page always loads at the top over the hero film, so seed the
    // overlay header synchronously — don't measure the frame here (flex/svh
    // layout may not be settled yet at ngAfterViewInit, which would misread
    // as solid). Scroll then flips it to solid via updateHeaderMode with a
    // real measurement. Nav tone is safe to compute now.
    this.document.documentElement.setAttribute('data-header', 'overlay');
    updateNavigationTone();
    requestAnimationFrame(updateScroll);

    this.destroyRef.onDestroy(() => {
      cleanups.forEach((cleanup) => cleanup());
      const root = this.document.documentElement;
      root.removeAttribute('data-nav-tone');
      // Clear the header-overlay mode so other routes get the solid header
      // (they never set it, but leaving 'overlay' behind would strand them
      // transparent-over-nothing).
      root.removeAttribute('data-header');
      // Tone attribute is gone, so the page is back on the default light
      // background — walk the browser chrome back with it.
      syncBrowserThemeColor('light');
    });
  }

  protected setLanguage(code: (typeof this.languages)[number]['code']): void {
    this.language.set(code);
  }

  protected async toggleFilm(
    selector: string,
    paused: WritableSignal<boolean>,
  ): Promise<void> {
    const video =
      this.elementRef.nativeElement.querySelector<HTMLVideoElement>(selector);
    if (!video) return;

    if (video.paused) {
      delete video.dataset['userPaused'];
      await video.play();
      paused.set(false);
    } else {
      video.dataset['userPaused'] = '';
      video.pause();
      paused.set(true);
    }
  }
}
