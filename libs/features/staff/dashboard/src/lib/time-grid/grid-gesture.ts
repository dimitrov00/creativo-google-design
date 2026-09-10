/**
 * WHAT A DRAG IS MADE OF, shared by every surface that drags a block along a
 * minute track — the vertical grid (`staff-time-grid.ts`) and the horizontal
 * chair timeline (`../timeline/staff-timeline.ts`).
 *
 * The two draw the same day along different axes, and the rules below are
 * about a FINGER, not an axis: how long a touch holds before it lifts, how
 * far it may wobble, how far a mouse travels before a body drag arms, how the
 * frame scrolls itself at the edge, and the small arithmetic every gesture
 * shares. Stated once, so a ruling on one surface is a ruling on both.
 */

/** How close to an edge the finger has to be before the frame scrolls itself. */
export const EDGE_SCROLL_MARGIN_PX = 28;

/**
 * The most the frame scrolls itself in one animation frame, with the pointer
 * right at the box's edge — about 240px a second at 60Hz, a pace a thumb can
 * follow and stop. Inside the margin the pace falls off in proportion.
 */
export const EDGE_SCROLL_MAX_PX_PER_FRAME = 4;

/**
 * How far a pointer travels before a BODY drag arms.
 *
 * A handle has none — a dedicated 44pt target is unambiguous and claims its
 * pointer on `pointerdown`. The block is also a tap target (it opens the
 * visit), so a tap that wobbles by a few pixels has to stay a tap.
 */
export const DRAG_THRESHOLD_PX = 4;

/*
 * ── TOUCH AND HOLD TO LIFT ─────────────────────────────────────────────
 *
 * 250ms, from this surface's own design brief:
 * `staff-visit-editor-design.md:926` specifies a body drag "taken on touch by
 * a 250 ms zero-tolerance hold", and `:125` records the model it comes from —
 * Apple's own words for Calendar are "touch and hold the event, then drag it
 * to a new time, or adjust the grab points".
 *
 * ⚠ THE IMPLEMENTATION HAD DEPARTED FROM THAT, and the departure is what a
 * thumb kept paying for (owner, 2026-09-03). It took `touch-action: none` and
 * a 4px threshold instead, and `staff-time-grid.css` was honest about the
 * price: "what it costs is the block's own 40×N pixels as a scroll surface".
 * On a phone that is not a corner of the frame — the block IS what a finger
 * lands on, and the handles are 44px discs sitting on top of it — so scrolling
 * the day moved a booking or resized one. An accidental write is a far worse
 * outcome than a lost scroll surface, which is the trade that reasoning got
 * backwards.
 */
export const HOLD_MS = 250;

/**
 * The wobble a held finger is allowed before it counts as travelling.
 *
 * Not a drag threshold — the opposite. Past this the gesture is abandoned to
 * the browser as a SCROLL and can no longer become an edit, however long the
 * finger then rests. "Zero-tolerance" in the brief means the hold does not
 * survive travel; it cannot mean zero pixels, because no finger is that
 * still and the hold would never fire on a real hand.
 */
export const HOLD_SLOP_PX = 6;

/**
 * `540` → `"09:00"`.
 *
 * 24-hour, always: Bulgaria writes times that way, and a grid graded on being
 * scannable cannot spend two characters on am/pm. No `Intl` call — the input
 * is already a wall-clock offset, so formatting it through a timezone would
 * be converting a number that was never an instant.
 */
export function hourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * `635` → `"10:35"`.
 *
 * `% 24` for the same reason the axis grows rather than wraps: a cut that
 * ends at minute 1455 ends at 00:15, not at 24:15.
 */
export function timeLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:${String(Math.abs(minute % 60)).padStart(2, '0')}`;
}

/**
 * `{{name}}` holes, filled.
 *
 * Not a translation engine — the caller's own `t()` already ran and handed
 * over a template with the interpolations the GRID knows about still open,
 * because the neighbour under the finger is not knowable until the finger is
 * on it. An empty template stays empty, which is how a caller that never
 * wired the copy degrades to numbers rather than to English.
 */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  if (template === '') return '';
  // Tightened first, so `{{ name }}` and `{{name}}` are the same hole, then
  // filled by NAME rather than by computed lookup — a template is caller
  // data and must never index anything.
  let out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, '{{$1}}');
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

/**
 * How fast the frame should be scrolling itself for a pointer at `at`, in
 * pixels per frame, signed towards the edge it is near — `near` and `far`
 * being the box's two edges on the axis of travel. Inside the margin the
 * pace grows with the overlap; PAST the box it is the full pace, for as long
 * as the pointer stays out there (owner, 2026-09-10: "dragging above or
 * below the frame should scroll the frame itself as you drag").
 *
 * ⚠ That reverses a rule from 2026-09-04, and the reversal is safe only
 * because of what changed in between. Back then a step fired on every
 * pointer MOVE at the maximum size, with the delta measured against the
 * content, so a finger 250px above the frame scrolled it flat out and fed
 * the scroll back into the block's time while the thumb sat still. The pace
 * is per animation frame and capped now, and the surfaces measure the drag
 * against the finger CLAMPED to the box — so the block rides the edge under
 * a finger that has gone past it, moving steadily in one direction, and a
 * finger that comes back inside stops the scroll where it stands.
 */
export function edgeScrollVelocity(
  at: number,
  near: number,
  far: number,
  margin = EDGE_SCROLL_MARGIN_PX,
  cap = EDGE_SCROLL_MAX_PX_PER_FRAME,
): number {
  if (at < near) return -cap;
  if (at > far) return cap;
  const over =
    at < near + margin
      ? at - (near + margin)
      : at > far - margin
        ? at - (far - margin)
        : 0;
  if (over === 0) return 0;
  return clamp(over / margin, -1, 1) * cap;
}

/**
 * ── EDGE AUTO-SCROLL, DRIVEN BY A RESTING FINGER ────────────────────
 *
 * The frame used to scroll only ON a pointer move, one step per event — so a
 * thumb that reached the edge and rested there, which is exactly what a
 * thumb does when it wants more of the day, got nothing (owner, 2026-09-10:
 * "when I start dragging it should scroll the frame until I stop and decide
 * to drop"). This runs on animation frames instead: the surface reports
 * where the pointer is, and while that is inside an edge margin the frame
 * keeps scrolling itself, a few pixels a frame, until the pointer moves
 * back inside or the day runs out — and past the box it keeps going at full
 * pace.
 *
 * ⚠ Driven by the FINGER, never by the block. Scrolling to keep the block in
 * view reads its own output: the scroll feeds the drag's content delta,
 * which moves the block, which asks for more scroll. The pointer's position
 * is an input the gesture does not produce, so a finger that comes to rest
 * away from the edges stops the scroll, and one held past them cannot run
 * past the end of the day. After every scroll the surface is told, so it can
 * re-measure the drag against the content the finger is now resting over.
 */
export class EdgeScroller {
  private pending: number | null = null;
  /** Fractions of a pixel carried between frames — `scrollTop` is whole. */
  private carry = 0;
  private at = 0;

  constructor(
    private readonly axis: 'x' | 'y',
    private readonly scroller: () => HTMLElement | null | undefined,
    private readonly scrolled: () => void,
  ) {}

  /** The pointer is at `at` on the axis (a viewport coordinate). */
  update(at: number): void {
    this.at = at;
    if (this.pending === null) this.schedule();
  }

  stop(): void {
    if (this.pending !== null) {
      const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
      cancel(this.pending);
      this.pending = null;
    }
    this.carry = 0;
  }

  private schedule(): void {
    const raf =
      globalThis.requestAnimationFrame ??
      ((callback: FrameRequestCallback) =>
        setTimeout(() => callback(Date.now()), 16) as unknown as number);
    this.pending = raf(() => {
      this.pending = null;
      this.tick();
    });
  }

  private tick(): void {
    const frame = this.scroller();
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    const vertical = this.axis === 'y';
    const velocity = vertical
      ? edgeScrollVelocity(this.at, box.top, box.bottom)
      : edgeScrollVelocity(this.at, box.left, box.right);
    if (velocity === 0) {
      this.carry = 0;
      return;
    }
    const room = vertical
      ? frame.scrollHeight - frame.clientHeight
      : frame.scrollWidth - frame.clientWidth;
    if (room <= 0) return;
    this.carry += velocity;
    const step = Math.trunc(this.carry);
    if (step !== 0) {
      this.carry -= step;
      const current = vertical ? frame.scrollTop : frame.scrollLeft;
      const next = clamp(current + step, 0, room);
      // The end of the day: nothing more to give, so the loop rests.
      if (next === current) return;
      if (vertical) frame.scrollTop = next;
      else frame.scrollLeft = next;
      this.scrolled();
    }
    this.schedule();
  }
}

export function clamp(value: number, min: number, max: number): number {
  // `min` last: on a block longer than the extent the two bounds cross, and
  // the near edge is the honest answer.
  return Math.max(min, Math.min(max, value));
}

/** The snap quantum, applied ABSOLUTELY — the number that shows is on-grid. */
export function snapTo(minute: number, snap: number): number {
  return Math.round(minute / snap) * snap;
}

/**
 * Every one of these is `?.()`-guarded and NONE is load-bearing.
 *
 * `navigator.vibrate` is Android-only in practice, absent on iOS Safari, and
 * policy-blocked without sticky user activation. The readout carries the
 * whole job on its own, which is exactly why the frame can afford a
 * five-minute quantum that Apple's own silent 15-minute snap cannot.
 */
export function buzz(pattern: number): void {
  try {
    globalThis.navigator?.vibrate?.(pattern);
  } catch {
    // A policy-blocked vibrate throws on some engines. It is decoration.
  }
}

export function capturePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Capture is an optimisation: without it the document listeners still
    // receive the whole gesture. An engine that refuses it loses nothing.
  }
}

export function releasePointer(target: HTMLElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Already released, or never captured.
  }
}
