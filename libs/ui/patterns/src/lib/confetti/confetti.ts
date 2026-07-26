import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  ViewEncapsulation,
  afterNextRender,
  inject,
  input,
  numberAttribute,
} from '@angular/core';
import { gsap } from 'gsap';

/** Token-backed particle tints, stamped as `data-tint` for the CSS contract:
 *  accent orange at three strengths plus two quiet neutral inks. */
const TINTS = [
  'accent',
  'accent-soft',
  'accent-faint',
  'ink',
  'ink-soft',
] as const;

/** Hard ceiling — a celebratory burst, not a particle system stress test. */
const MAX_PARTICLES = 240;

/**
 * One-shot celebratory confetti burst — mount it inside a `position:
 * relative` wrapper around the moment's anchor (a success check icon) and
 * it erupts once from that anchor's center: particles launch upward and
 * outward, decelerate, then fall under ease-in gravity while fading, and
 * every DOM node and gsap tween is removed the instant the burst settles.
 * Purely decorative reward-moment garnish (the onboarding "You're in"
 * screen); never load-bearing chrome.
 *
 * Spec (mount → spawns particles → auto-cleanup):
 * - On first browser render it spawns `uiCount` (clamped 1…160) absolutely
 *   positioned spans at the host's center — mixed dots and slips, tinted
 *   ONLY from the token palette (`--sys-color-accent`,
 *   `--sys-color-foreground`) at varied alpha via `color-mix` in
 *   confetti.css. No hex literals, light/dark themes both hold.
 * - Each particle rides one gsap timeline (rise `power2.out`, gravity fall
 *   `power2.in`, drift, spin, tail fade); the whole burst completes within
 *   ~2s of `uiDelay` elapsing, then the timeline's `onComplete` empties the
 *   host and kills the timeline — no lingering DOM, no lingering tickers.
 *   Early destroy (route away mid-burst) performs the same teardown.
 * - `prefers-reduced-motion: reduce` spawns NOTHING — the host stays an
 *   empty, `aria-hidden`, pointer-transparent overlay. Consumers own the
 *   calm alternative (e.g. the reward screen's gentle check fade).
 * - SSR-safe: everything runs in `afterNextRender` behind
 *   `isPlatformBrowser` (the house gsap guard, cf. `CursorDotComponent`).
 *   Zoneless-safe: gsap's ticker lives outside Angular's reactive graph and
 *   never touches signals, so it schedules no change detection.
 * - `pointer-events: none` + `overflow: visible` on an inset-0 overlay —
 *   the burst never intercepts a tap; CTAs stay immediately usable.
 *
 * ```html
 * <span class="reward-badge">          <!-- position: relative -->
 *   <ui-icon uiName="checklist.done" uiScale="large" />
 *   <ui-confetti [uiDelay]="260" />
 * </span>
 * ```
 */
@Component({
  selector: 'ui-confetti',
  template: '',
  styleUrl: './confetti.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: global `.ui-*` classes ARE the styling
  // contract (§3.1) and the particles are created imperatively anyway.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-confetti',
    'aria-hidden': 'true',
  },
})
export class UiConfetti {
  /** Particle count, clamped 1…160. The ~90 default reads celebratory
   *  without drifting toward parade-float. */
  readonly uiCount = input(90, { transform: numberAttribute });
  /** Milliseconds before the burst fires — lets an anchor pop-in land
   *  first so the eruption reads as caused by it. */
  readonly uiDelay = input(0, { transform: numberAttribute });

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      // Same guard shape as UiRevealDirective: reduced motion means the
      // moment stays quiet — no particles at all, not slower particles.
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) return;
      this.burst();
    });
  }

  private burst(): void {
    const host = this.elementRef.nativeElement;
    const count = Math.min(
      Math.max(Math.trunc(this.uiCount()) || 1, 1),
      MAX_PARTICLES,
    );
    const timeline = gsap.timeline({ delay: this.uiDelay() / 1000 });
    const cleanup = (): void => {
      timeline.kill();
      host.replaceChildren();
    };
    timeline.eventCallback('onComplete', cleanup);

    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement('span');
      particle.className = 'ui-confetti__particle';
      // `?? 'accent'` only satisfies noUncheckedIndexedAccess — the modulo
      // index is always in range.
      particle.setAttribute(
        'data-tint',
        TINTS[index % TINTS.length] ?? 'accent',
      );
      // Mixed shapes — small dots and paper slips.
      const isDot = index % 3 === 0;
      particle.setAttribute('data-shape', isDot ? 'dot' : 'slip');
      const size = 7 + Math.random() * 7;
      particle.style.width = `${isDot ? size : size * 0.62}px`;
      particle.style.height = `${size}px`;
      host.append(particle);

      // Launch mostly upward (±75° around straight up), speed-varied so the
      // cloud has depth; every particle ends BELOW its origin (gravity won).
      const angle = (-90 + (Math.random() * 150 - 75)) * (Math.PI / 180);
      const speed = 110 + Math.random() * 230;
      const drift = Math.cos(angle) * speed * (1.1 + Math.random() * 0.6);
      const rise = Math.max(28, -Math.sin(angle) * speed);
      const fall = rise + 130 + Math.random() * 260;
      const duration = 1.2 + Math.random() * 0.9;
      const start = Math.random() * 0.22;

      // Center every particle on the anchor before the first frame.
      timeline.set(particle, { xPercent: -50, yPercent: -50 }, 0);
      // Horizontal drift decelerates the whole way (ease-out burst).
      timeline.to(particle, { x: drift, duration, ease: 'power2.out' }, start);
      // Vertical: fast rise, then the ease-in gravity fall.
      timeline.to(
        particle,
        {
          keyframes: [
            { y: -rise, duration: duration * 0.34, ease: 'power2.out' },
            { y: fall, duration: duration * 0.66, ease: 'power2.in' },
          ],
        },
        start,
      );
      timeline.to(
        particle,
        {
          rotation: (Math.random() - 0.5) * 720,
          duration,
          ease: 'power1.out',
        },
        start,
      );
      // Hold full strength through the arc, fade only on the tail.
      timeline.to(
        particle,
        { opacity: 0, duration: duration * 0.3, ease: 'power1.in' },
        start + duration * 0.7,
      );
    }

    // Route-away mid-burst tears down exactly like natural completion.
    this.destroyRef.onDestroy(cleanup);
  }
}
