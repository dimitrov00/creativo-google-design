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
import { UiToolbar } from '@creativo/ui/layout';
import { LocaleThemeToggleComponent } from '../../shared/prefs/locale-theme-toggle.component';

/** Fallback when the token can't be read (SSR/test environments). */
const ENTRANCE_EASE_FALLBACK = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Inset hero — closing-CTA register (case study §3): a rounded B&W video
 * card (squircle, sheet radius) filling the viewport column, a centered
 * title/paragraph/capsule-CTA trio mid-card, and the locale/theme toggles
 * on a bottom overlay toolbar inside the media. The fixed LandingHeader
 * owns the wordmark; the hero carries no top bar of its own.
 *
 * Under reduced motion the poster replaces the video and the staged copy
 * entrance is skipped entirely (v2 `useReducedMotion` behavior).
 */
@Component({
  selector: 'cr-landing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiToolbar,
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
   * Staged mount entrance — heading → subtitle → CTA → toolbar rise in
   * once, on the page load (not scroll-linked). Each `[data-hero-enter]`
   * element declares its own rise/delay/duration (and optional start
   * scale); the curve is the shared `--sys-motion-ease-entrance` token.
   */
  private runEntrance(): void {
    const ease =
      getComputedStyle(this.elementRef.nativeElement)
        .getPropertyValue('--sys-motion-ease-entrance')
        .trim() || ENTRANCE_EASE_FALLBACK;
    const targets =
      this.elementRef.nativeElement.querySelectorAll<HTMLElement>(
        '[data-hero-enter]',
      );
    for (const target of targets) {
      if (typeof target.animate !== 'function') return;
      const y = target.dataset['enterY'] ?? '12';
      const scale = target.dataset['enterScale'];
      const from = scale
        ? `translateY(${y}px) scale(${scale})`
        : `translateY(${y}px)`;
      const to = scale ? 'translateY(0) scale(1)' : 'translateY(0)';
      target.animate(
        [
          { opacity: 0, transform: from },
          { opacity: 1, transform: to },
        ],
        {
          duration: Number(target.dataset['enterDuration'] ?? '700'),
          delay: Number(target.dataset['enterDelay'] ?? '0'),
          easing: ease,
          fill: 'both',
        },
      );
    }
  }

  protected onVideoLoaded(): void {
    this.videoLoaded.set(true);
  }
}
