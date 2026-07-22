import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  numberAttribute,
} from '@angular/core';

/**
 * The house scroll-reveal — v2's `FadeUp` (`scroll-fx.tsx`): opacity + rise +
 * a hair of blur as a block enters view, fired once at -12% viewport margin,
 * 0.8s on the emphasized ease. No-ops under reduced motion. WAAPI instead of
 * a CSS class so the start state never flashes (the element is hidden only
 * once we know the animation will run).
 *
 *   <section crFadeUp>…              → the default reveal
 *   <div crFadeUp [crFadeUpDelay]="0.18">…  → v2's staggered second block
 */
@Directive({
  selector: '[crFadeUp]',
  host: { '[attr.data-fade-up]': '""' },
})
export class FadeUpDirective {
  /** Seconds, like the v2 prop. */
  readonly crFadeUpDelay = input(0, { transform: numberAttribute });
  /** Entry rise in px (v2 default 24). */
  readonly crFadeUpY = input(24, { transform: numberAttribute });

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const element = this.elementRef.nativeElement;
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      if (
        reducedMotion ||
        typeof IntersectionObserver !== 'function' ||
        typeof element.animate !== 'function'
      ) {
        return;
      }

      element.style.opacity = '0';
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            element.animate(
              [
                {
                  opacity: 0,
                  transform: `translateY(${this.crFadeUpY()}px)`,
                  filter: 'blur(6px)',
                },
                { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
              ],
              {
                duration: 800,
                delay: this.crFadeUpDelay() * 1000,
                // Mirrors --sys-motion-ease-emphasized — WAAPI `easing`
                // cannot read CSS custom properties.
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both',
              },
            );
            element.style.opacity = '';
          }
        },
        // v2 viewport margin '-12% 0px'.
        { rootMargin: '-12% 0px' },
      );
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
