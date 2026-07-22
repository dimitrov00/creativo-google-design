import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { CrIcon } from '../../shared/icons/icons';
import { LocaleThemeToggleComponent } from '../../shared/prefs/locale-theme-toggle.component';

/** v2 `landing-hero.tsx` entrance ease. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Inset hero — v2 `landing-hero.tsx` + `video-hero.tsx`: a rounded B&W video
 * card (squircle, sheet radius) floating inside the app column, overlay
 * locale/theme chips + tagline/heading/subtitle pinned to its bottom edge,
 * and the primary CTA on plain background below the card. The fixed
 * LandingHeader owns the wordmark; the hero carries no top bar of its own.
 *
 * Under reduced motion the poster replaces the video and the staged copy
 * entrance is skipped entirely (v2 `useReducedMotion` behavior).
 */
@Component({
  selector: 'cr-landing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiButton,
  ],
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.css',
  host: { class: 'cr-hero', 'data-testid': 'landing-hero' },
})
export class LandingHeroComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('heroVideo');

  /** Client-resolved; SSR keeps the video markup and never plays it. */
  protected readonly reducedMotion = signal(false);
  /** Fades the film in over the poster once the first frame is decodable. */
  protected readonly videoLoaded = signal(false);

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      this.reducedMotion.set(reduced);

      if (!reduced) {
        // The copy lives inside `*transloco`, whose embedded view renders
        // only after the async translation load — retry on frames (bounded)
        // until the entrance targets exist, then play + animate once.
        const arm = (attempt: number): void => {
          const ready =
            this.elementRef.nativeElement.querySelector('[data-hero-enter]');
          if (!ready) {
            if (attempt < 240) requestAnimationFrame(() => arm(attempt + 1));
            return;
          }
          this.video()
            ?.nativeElement.play()
            .catch(() => undefined);
          this.runEntrance();
        };
        arm(0);
      }
    });
  }

  /**
   * v2's staged mount entrance — tagline → heading → subtitle → CTA rise in
   * once, on the page load (not scroll-linked). Each `[data-hero-enter]`
   * element declares its own rise/delay/duration, mirroring the per-element
   * motion props in the JSX.
   */
  private runEntrance(): void {
    const targets =
      this.elementRef.nativeElement.querySelectorAll<HTMLElement>(
        '[data-hero-enter]',
      );
    for (const target of targets) {
      if (typeof target.animate !== 'function') return;
      target.animate(
        [
          {
            opacity: 0,
            transform: `translateY(${target.dataset['enterY'] ?? '12'}px)`,
          },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: Number(target.dataset['enterDuration'] ?? '700'),
          delay: Number(target.dataset['enterDelay'] ?? '0'),
          easing: EASE,
          fill: 'both',
        },
      );
    }
  }

  protected onVideoLoaded(): void {
    this.videoLoaded.set(true);
  }
}
