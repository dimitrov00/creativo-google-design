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

export type UiRevealTransition = 'fade-up' | 'fade';
export type UiRevealTrigger = 'scroll' | 'mount';

/** `"650ms"` / `"0.65s"` → milliseconds; anything else → the fallback. */
function readDurationMs(raw: string, fallback: number): number {
  const match = /^([\d.]+)\s*(ms|s)$/.exec(raw.trim());
  if (!match) return fallback;
  const value = Number(match[1]);
  return match[2] === 's' ? value * 1000 : value;
}

/**
 * ≙ SwiftUI `.scrollTransition { $0.opacity(...).offset(...) }` /
 * `.transition(.move(edge:).combined(with: .opacity))` +
 * `.animation(.delay(_:))` — THE one entrance-motion grammar. Writes
 * `data-reveal` (the transition name) plus a transient
 * `data-reveal-state="hidden"` start state styled in modifiers.css, then
 * plays a WAAPI animation with `fill: 'both'`.
 *
 * - `uiRevealTrigger` `'scroll'` (default) latches once via
 *   IntersectionObserver at the house -12% viewport margin; `'mount'` plays
 *   on first render.
 * - Duration/easing are READ FROM the tokens at runtime via
 *   `getComputedStyle` (`--sys-motion-duration-slowest`,
 *   `--sys-motion-ease-emphasized`) — WAAPI cannot consume `var()`
 *   expressions, and the ladder must stay the single source. The literals
 *   below are last-resort fallbacks mirroring those tokens.
 * - `prefers-reduced-motion`, SSR, and missing WAAPI/IO support all no-op:
 *   the element simply renders visible (the hidden start state is only
 *   stamped once we know the animation will run — no flash, no lost
 *   content).
 *
 * Replaces `crFadeUp`, per-section rAF entrance sweeps, and bespoke WAAPI
 * observers.
 */
@Directive({
  selector: '[uiReveal]',
  host: { '[attr.data-reveal]': 'uiReveal()' },
})
export class UiRevealDirective {
  readonly uiReveal = input('fade-up', {
    // Bare-attribute usage (`<div uiReveal>`) binds the empty string.
    transform: (value: UiRevealTransition | ''): UiRevealTransition =>
      value === '' ? 'fade-up' : value,
  });
  readonly uiRevealTrigger = input<UiRevealTrigger>('scroll');
  /** Milliseconds. */
  readonly uiRevealDelay = input(0, { transform: numberAttribute });
  /** Entry rise (any CSS length) for the `fade-up` transition. */
  readonly uiRevealRise = input('24px');

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const element = this.elementRef.nativeElement;
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion || typeof element.animate !== 'function') return;
      if (this.uiRevealTrigger() === 'mount') {
        element.setAttribute('data-reveal-state', 'hidden');
        this.play(element);
        return;
      }
      if (typeof IntersectionObserver !== 'function') return;
      element.setAttribute('data-reveal-state', 'hidden');
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            this.play(element);
          }
        },
        // The house viewport margin (inherited from crFadeUp / v2).
        { rootMargin: '-12% 0px' },
      );
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private play(element: HTMLElement): void {
    const styles = getComputedStyle(element);
    const duration = readDurationMs(
      styles.getPropertyValue('--sys-motion-duration-slowest'),
      650,
    );
    const easing =
      styles.getPropertyValue('--sys-motion-ease-emphasized').trim() ||
      'cubic-bezier(0.22, 1, 0.36, 1)';
    const rise = this.uiReveal() === 'fade-up';
    element.animate(
      [
        {
          opacity: 0,
          ...(rise ? { transform: `translateY(${this.uiRevealRise()})` } : {}),
        },
        { opacity: 1, ...(rise ? { transform: 'translateY(0)' } : {}) },
      ],
      {
        duration,
        delay: this.uiRevealDelay(),
        easing,
        fill: 'both',
      },
    );
    // `fill: 'both'` holds the first keyframe through the delay, so the CSS
    // start state can hand off immediately.
    element.removeAttribute('data-reveal-state');
  }
}
