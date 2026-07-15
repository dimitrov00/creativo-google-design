import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { gsap } from 'gsap';
import { CursorService } from './cursor.service';

const SCALE_HOVER_SIZE = 40;
const FILL_COLOR_PROPERTY = '--cr-cursor-fill-color';
const FILL_COLOR_FALLBACK = 'var(--cr-color-foreground)';
// Longest of the position/size transitions on .cr-cursor-dot__ring[data-morphing]
// (left, 0.25s) — the point at which the ring has visually finished
// morphing into the target and it's safe to hide it.
const MORPH_SETTLE_SECONDS = 0.25;
// An instant cut (duration 0), not a gradual fade. The target's own text
// has already finished its (fast, ~120ms) color transition well before
// this point — it's just sitting hidden behind the opaque ring. A gradual
// opacity fade here doesn't fade a color, it progressively UNCOVERS that
// already-correct text, which reads as if the text itself were slowly
// animating color — confirmed live as the cause of exactly that complaint.
// Cutting instantly instead reveals the (already fully-colored) text in one
// frame, matching how fast this always looked before the ring existed.
const MORPH_HIDE_SECONDS = 0;

/**
 * Mounted once at the app shell root. Replaces the native cursor with a
 * small dot that tracks the pointer via `top`/`left` (not `transform`) with
 * zero lag/easing — matching design.google's own positioning, confirmed
 * live: their cursor's CSS `transition` never includes `top`/`left` while
 * plainly following the pointer, only `width`/`height`/`opacity`;
 * `transform` is a static centering offset that never itself changes.
 * Getting this wrong (animating position via `transform` with a CSS
 * transition on it, as an earlier version of this component did) is
 * exactly what produces a "trailing" cursor.
 *
 * Purely decorative/pointer-only — `aria-hidden` on the host (belt-and-
 * braces alongside the `aria-hidden` already on each child span) plus
 * `role="presentation"` keeps it out of the accessibility tree regardless
 * of how a given browser/AT handles a `display: contents` host.
 *
 * Two hover strategies (`CursorTargetStyle`), confirmed live on two
 * different real elements — not the same effect:
 * - 'fill' (outline/ghost buttons): the target's own CSS
 *   (cursor-target.css) flips its background to `--cr-cursor-fill-color`
 *   and its text to `--cr-color-background` — a real, solid color
 *   inversion, "border-prominent" style. The ring here tints to the SAME
 *   `--cr-cursor-fill-color` and eases (~200-250ms) into a pill exactly
 *   matching the target's bounds/radius, so the flight itself looks like
 *   the cursor becoming the button. Once it settles, the ring cuts itself
 *   invisible instantly — not a gradual opacity fade (see `trackTarget()`
 *   for why: the target's text finished its own fast, ~120ms color
 *   transition well before this point, so a slow fade here doesn't fade a
 *   color at all, it just slowly UNCOVERS that already-recolored text from
 *   behind the opaque ring — which reads as the text itself animating in
 *   slow motion, confirmed live as a real complaint, not a preference). By
 *   the time the ring disappears, the target has already flipped to the
 *   identical color with its own real, readable label text, so there's
 *   nothing left for the ring to usefully cover. This deliberately avoids
 *   needing the target's label to
 *   out-z-index a `position: fixed` element mounted in a completely
 *   different part of the DOM — relying on cross-subtree z-index ordering
 *   like that is fragile (it depends on whether anything in between
 *   happens to create its own stacking context) and was confirmed live, in
 *   an earlier version, to make the ring paint behind real buttons
 *   depending on where this component happened to sit in the DOM.
 * - 'scale' (everything else): position keeps tracking the pointer
 *   normally (uneased); only the dot's size grows to 40x40. Stays the
 *   plain white ring with `mix-blend-mode: exclusion`, auto-inverting for
 *   contrast against any background (white excluded with itself = black) —
 *   the target's own chrome is untouched here, so the ring is the only
 *   thing providing contrast and has to work over an arbitrary background.
 */
@Component({
  selector: 'cr-cursor-dot',
  imports: [],
  templateUrl: './cursor-dot.component.html',
  styleUrl: './cursor-dot.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'presentation',
    '[attr.aria-hidden]': 'true',
    '[attr.data-active]': 'cursorService.isEnabled() ? "" : null',
    '(document:pointermove)': 'onPointerMove($event)',
  },
})
export class CursorDotComponent {
  protected readonly cursorService = inject(CursorService);
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly ring = viewChild.required<ElementRef<HTMLElement>>('ring');
  private readonly label = viewChild.required<ElementRef<HTMLElement>>('label');

  private resizeObserver?: ResizeObserver;
  private scrollHandler?: () => void;

  constructor() {
    // Start off-screen so there's no flash at the top-left corner before
    // the first real pointermove event arrives.
    effect(() => {
      const enabled = this.cursorService.isEnabled();
      if (enabled) {
        gsap.set([this.ring().nativeElement, this.label().nativeElement], {
          left: -100,
          top: -100,
        });
      }
      // Toggled on <html> rather than just relying on inherited `cursor`
      // on <body> — native <button>/<input> elements carry their own
      // UA-stylesheet `cursor: pointer`/`cursor: text`, which is MORE
      // specific than an inherited value and silently wins over it. The
      // matching `html[data-cr-cursor-active] * { cursor: none !important }`
      // rule lives in cursor-target.css.
      this.document.documentElement.toggleAttribute(
        'data-cr-cursor-active',
        enabled,
      );
    });

    effect(() => {
      const target = this.cursorService.activeTarget();
      this.stopTrackingTarget();
      const ring = this.ring().nativeElement;

      if (target?.style === 'fill') {
        // Set BEFORE the first measure() so the CSS transition is already
        // active when gsap.set first writes the new left/top/width/height.
        ring.setAttribute('data-morphing', '');
        this.trackTarget(target.element);
      } else if (target?.style === 'scale') {
        ring.removeAttribute('data-morphing');
        gsap.set(ring, {
          clearProps: 'borderRadius',
          width: SCALE_HOVER_SIZE,
          height: SCALE_HOVER_SIZE,
        });
      } else {
        ring.removeAttribute('data-morphing');
        gsap.set(ring, { clearProps: 'width,height,borderRadius' });
      }
    });
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.cursorService.isEnabled()) return;
    gsap.set(this.label().nativeElement, {
      left: event.clientX,
      top: event.clientY,
    });
    if (this.cursorService.activeTarget()?.style === 'fill') return; // locked onto the target instead
    gsap.set(this.ring().nativeElement, {
      left: event.clientX,
      top: event.clientY,
    });
  }

  private trackTarget(target: HTMLElement): void {
    const ring = this.ring().nativeElement;
    const fillColor =
      this.window
        ?.getComputedStyle(target)
        .getPropertyValue(FILL_COLOR_PROPERTY)
        .trim() || FILL_COLOR_FALLBACK;
    gsap.set(ring, { backgroundColor: fillColor, mixBlendMode: 'normal' });

    const measure = () => {
      const rect = target.getBoundingClientRect();
      const borderRadius = this.window?.getComputedStyle(target).borderRadius;

      gsap.set(ring, {
        left: rect.left + rect.width / 2,
        top: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        borderRadius: borderRadius || undefined,
      });
    };
    measure();
    this.scrollHandler = measure;
    this.window?.addEventListener('scroll', this.scrollHandler, {
      passive: true,
      capture: true,
    });
    this.resizeObserver = new ResizeObserver(measure);
    this.resizeObserver.observe(target);

    // By MORPH_SETTLE_SECONDS, cursor-target.css has already flipped this
    // same target to this same solid color (a fast, ~120ms CSS transition)
    // with its own real, readable label on top of it natively — so the
    // ring cuts out (instantly, not a gradual fade) rather than continuing
    // to sit above everything.
    gsap.to(ring, {
      opacity: 0,
      delay: MORPH_SETTLE_SECONDS,
      duration: MORPH_HIDE_SECONDS,
      overwrite: 'auto',
    });
  }

  private stopTrackingTarget(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.scrollHandler) {
      this.window?.removeEventListener('scroll', this.scrollHandler, true);
      this.scrollHandler = undefined;
    }
    // Cancel any pending/completed fade-out and reset to full opacity +
    // plain white before the next branch (fill/scale/null) decides what
    // happens next — otherwise switching directly from one fill target to
    // another would carry over a faded-out, still-tinted ring instead of
    // starting the new morph fresh.
    const ring = this.ring().nativeElement;
    gsap.killTweensOf(ring, 'opacity');
    gsap.set(ring, { clearProps: 'opacity,backgroundColor,mixBlendMode' });
  }
}
