import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  contentChildren,
  inject,
  input,
  signal,
} from '@angular/core';

/** The edge of a row an action waits behind. */
export type UiSwipeEdge = 'leading' | 'trailing';

/**
 * The fill of an action: the house's ink, or the red of something that
 * destroys. There is no orange one: on an accent fill a word would have to
 * be white, and the accent law keeps words in ink.
 */
export type UiSwipeActionTint = 'neutral' | 'destructive';

/** One action's width at rest, and the seam between segments, in pixels. */
const ACTION_PX = 76;
const SEAM_PX = 2;
/** A press becomes a swipe once it has travelled this far sideways. */
const SWIPE_SLOP_PX = 8;
/** Past the actions a pull that cannot commit is resisted to this share. */
const RESISTANCE = 0.25;
/** A full swipe commits past this share of the row's width. */
const FULL_SWIPE_SHARE = 0.6;
/** A flick this fast (px/ms) opens or closes whatever the distance. */
const FLICK_SPEED = 0.4;
/** A trackpad's sideways scroll has ended once it is quiet this long. */
const WHEEL_REST_MS = 140;

/*
 * THE SPRING — SwiftUI's `.snappy` (duration 0.5 s, bounce 0.15), the same
 * one `--sys-motion-spring-snappy` samples. Solved here rather than taken
 * from the token because a row is let go MOVING: the spring starts at the
 * finger's own speed, so the row carries on from the hand without a seam.
 * A CSS easing curve cannot do that; it always starts from standstill.
 */
const SPRING_OMEGA = (2 * Math.PI) / 0.5;
const SPRING_DAMPING = 1 - 0.15;
const SPRING_MS = 800;
const SPRING_FRAMES = 48;

/** The spring's path from `from` to `to`, leaving at `velocity` (px/s). */
function springPath(from: number, to: number, velocity: number): number[] {
  const damped = SPRING_OMEGA * Math.sqrt(1 - SPRING_DAMPING ** 2);
  const decay = SPRING_DAMPING * SPRING_OMEGA;
  const start = from - to;
  const swing = (velocity + decay * start) / damped;
  const path: number[] = [];
  for (let frame = 0; frame <= SPRING_FRAMES; frame += 1) {
    const t = (frame / SPRING_FRAMES) * (SPRING_MS / 1000);
    path.push(
      to +
        Math.exp(-decay * t) *
          (start * Math.cos(damped * t) + swing * Math.sin(damped * t)),
    );
  }
  path[SPRING_FRAMES] = to;
  return path;
}

/** Closes the row whose actions are showing: only one row is open at a time. */
let closeOpenRow: (() => void) | null = null;

/**
 * One action behind a row of `ui-swipe-actions`: a real button, a glyph
 * over one short word. `uiLeading` or `uiTrailing` says which edge it waits
 * behind. The FIRST action of an edge is its primary — the outermost one,
 * and the one a full swipe runs.
 *
 * @uiPartOf ui-swipe-actions
 * @uiPurpose One quick action revealed by swiping a row: a tinted segment
 *   with a glyph over a short word.
 */
@Directive({
  selector: 'button[uiSwipeAction]',
  host: {
    class: 'ui-swipe-action',
    type: 'button',
    '[attr.data-tint]': 'uiTint()',
    '[attr.data-edge]': 'edge',
  },
})
export class UiSwipeAction {
  readonly uiTint = input<UiSwipeActionTint>('neutral');

  readonly element =
    inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;

  /** Read once: a slot attribute, as `uiLeading` is on a row. */
  readonly edge: UiSwipeEdge = this.element.hasAttribute('uiLeading')
    ? 'leading'
    : 'trailing';
}

/**
 * ≙ SwiftUI `.swipeActions(edge:allowsFullSwipe:)` — quick actions waiting
 * behind a row. Wrap ANY row in it and project the actions beside the row;
 * the row itself is untouched, so the capability composes onto a list that
 * already exists.
 *
 * ```html
 * <ui-swipe-actions>
 *   <button uiListRow …>…</button>
 *   <button uiSwipeAction uiTrailing uiTint="destructive" (click)="remove()">
 *     <ui-icon uiName="action.delete" /> Изтрий
 *   </button>
 * </ui-swipe-actions>
 * ```
 *
 * ### The gesture
 * The row slides with the finger (a vertical move stays the page's
 * scroll), whole — its words are never squeezed — and is clipped by its
 * place in the list, so nothing hangs over the page's gutter. Each action
 * is a SEGMENT of the list, the house seam apart, growing out of the edge
 * into the room the row leaves.
 *
 * LETTING GO IS NOT A STOP. The row carries on at the finger's own speed
 * into a spring (SwiftUI's `.snappy`) — open beside its actions past half
 * their width or on a flick, otherwise home. Pull on past the actions and
 * the primary one takes the whole edge: let go there and the row runs on
 * out of its place, and the action runs as it clears (`uiFullSwipe`, on by
 * default, as `allowsFullSwipe` is). A press catches a row mid-flight
 * where it is. A tap on an action runs it; a tap anywhere else, a scroll,
 * or another row opening closes this one.
 *
 * TOUCH AND PEN ONLY. A mouse does not swipe — a press-and-drag with a
 * pointer is how text is selected and things are dragged, and a row that
 * followed it would move under the cursor. A trackpad's two-finger
 * sideways scroll opens and closes the actions instead, as it does in
 * Mail on a Mac.
 *
 * ### A swipe is never the only way
 * The actions are real buttons in the tab order (WCAG 2.5.7, 2.1.1): focus
 * moving onto one opens its edge, and a screen reader reads them after the
 * row. A destructive action still asks before it destroys — the swipe is a
 * shortcut to the button, never past the question.
 *
 * @uiPurpose Quick actions behind a list row, revealed by swiping it
 *   sideways: wrap a row and project the action buttons.
 * @uiSwiftUI `.swipeActions(edge:allowsFullSwipe:)`
 * @uiAliases swipe actions, swipe to delete, swipe row, swipeable, slide
 *   actions, row actions, quick actions, swipe left, swipe right
 * @uiNotThis A row's actions that are always visible are a `ui-menu` on a
 *   trailing «⋯»; verbs under a person are `ui-quick-actions`.
 */
@Component({
  selector: 'ui-swipe-actions',
  template: `
    <span class="ui-swipe-actions__edge" data-edge="leading">
      <ng-content select="[uiSwipeAction][uiLeading]" />
    </span>
    <ng-content />
    <span class="ui-swipe-actions__edge" data-edge="trailing">
      <ng-content select="[uiSwipeAction]" />
    </span>
  `,
  styleUrl: './swipe-actions.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-swipe-actions',
    '[attr.data-swipe]': 'shown()',
    '[attr.data-swiping]': 'swiping() ? "" : null',
    '[attr.data-full]': 'full()',
    '(pointerdown)': 'pressed($event)',
    '(pointermove)': 'moved($event)',
    '(pointerup)': 'released($event)',
    '(pointercancel)': 'released($event)',
    '(focusin)': 'focused($event)',
    '(focusout)': 'blurred($event)',
    '(keydown.escape)': 'close()',
    '(wheel)': 'wheeled($event)',
  },
})
export class UiSwipeActions {
  /** ≙ `allowsFullSwipe`: pulling on past the actions runs the primary one. */
  readonly uiFullSwipe = input(true, { transform: booleanAttribute });

  private readonly actions = contentChildren(UiSwipeAction);
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The edge whose actions show, while the row is away from rest. */
  protected readonly shown = signal<UiSwipeEdge | null>(null);
  protected readonly swiping = signal(false);
  /** The edge whose primary action a release would run. */
  protected readonly full = signal<UiSwipeEdge | null>(null);

  /** How far the row sits from rest: positive shows the leading edge. */
  private offset = 0;
  private press: {
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly startOffset: number;
    readonly width: number;
    readonly direction: 1 | -1;
    locked: boolean;
    lastX: number;
    lastAt: number;
    speed: number;
  } | null = null;
  private swallowClick = false;
  /** The row's flight after a release; a press catches it. */
  private flight: Animation | null = null;
  private wheelRest: ReturnType<typeof setTimeout> | null = null;
  private readonly closeSelf = (): void => this.close();

  private readonly outside = (event: Event): void => {
    if (event.target instanceof Node && this.host.contains(event.target)) {
      return;
    }
    this.close();
  };

  constructor() {
    // Capture phase: ahead of the row's own click, whichever was bound first.
    this.host.addEventListener('click', (event) => this.clicked(event), {
      capture: true,
    });
    inject(DestroyRef).onDestroy(() => {
      this.unwatch();
      this.flight?.cancel();
      if (this.wheelRest !== null) clearTimeout(this.wheelRest);
      if (closeOpenRow === this.closeSelf) closeOpenRow = null;
    });
  }

  /** The row goes back to rest. */
  close(): void {
    this.rest(0);
  }

  private of(edge: UiSwipeEdge): UiSwipeAction[] {
    return this.actions().filter((action) => action.edge === edge);
  }

  /** How far the row rests from its place with an edge's actions showing. */
  private reach(edge: UiSwipeEdge): number {
    return this.of(edge).length * (ACTION_PX + SEAM_PX);
  }

  protected pressed(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    // A mouse does not swipe (see the docblock): its press is left alone.
    if (event.pointerType === 'mouse') return;
    if (this.actions().length === 0) return;
    const rtl = getComputedStyle(this.host).direction === 'rtl';
    this.swallowClick = false;
    this.catch();
    this.press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: this.offset,
      width: this.host.getBoundingClientRect().width,
      direction: rtl ? -1 : 1,
      locked: false,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      speed: 0,
    };
  }

  protected moved(event: PointerEvent): void {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    const dx = (event.clientX - press.startX) * press.direction;
    const dy = event.clientY - press.startY;
    if (!press.locked) {
      if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
      // A move that is more down than across is the page's scroll.
      if (Math.abs(dy) > Math.abs(dx)) {
        this.press = null;
        return;
      }
      press.locked = true;
      this.host.setPointerCapture?.(event.pointerId);
      this.swiping.set(true);
      this.claim();
    }
    event.preventDefault();
    const elapsed = event.timeStamp - press.lastAt;
    if (elapsed > 0) {
      press.speed = ((event.clientX - press.lastX) * press.direction) / elapsed;
    }
    press.lastX = event.clientX;
    press.lastAt = event.timeStamp;
    this.place(this.resisted(press.startOffset + dx, press.width), press.width);
  }

  protected released(event: PointerEvent): void {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    this.press = null;
    if (!press.locked) return;
    this.swiping.set(false);
    // The release of a swipe is not a tap on whatever lies under it.
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));

    const edge: UiSwipeEdge | null =
      this.offset > 0 ? 'leading' : this.offset < 0 ? 'trailing' : null;
    if (edge === null) {
      this.rest(0);
      return;
    }
    if (this.full() === edge) {
      // The row runs on out of its place, and the action runs as it clears.
      const primary = this.of(edge)[0];
      const away = edge === 'leading' ? press.width : -press.width;
      this.fly(away, press.speed, () => {
        this.swallowClick = false;
        primary?.element.click();
        if (this.offset !== 0) this.rest(0);
      });
      return;
    }
    const reach = this.reach(edge);
    const outward = edge === 'leading' ? press.speed : -press.speed;
    const opens =
      outward > FLICK_SPEED ||
      (outward > -FLICK_SPEED && Math.abs(this.offset) > reach / 2);
    this.rest(opens ? (edge === 'leading' ? reach : -reach) : 0, press.speed);
  }

  /**
   * A trackpad's sideways scroll: the row follows it as far as its actions
   * reach, and rests open or closed once the scroll goes quiet. It never
   * runs an action — a scroll that overshoots is too easy to make.
   */
  protected wheeled(event: WheelEvent): void {
    if (this.actions().length === 0) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const rtl = getComputedStyle(this.host).direction === 'rtl';
    const raw = this.offset - event.deltaX * (rtl ? -1 : 1);
    const reach = this.reach(raw > 0 ? 'leading' : 'trailing');
    // Nothing to show that way and nothing showing: the page keeps its scroll.
    if (reach === 0 && this.offset === 0) return;
    event.preventDefault();
    this.catch();
    this.swiping.set(true);
    this.claim();
    this.place(Math.sign(raw) * Math.min(Math.abs(raw), reach), 0);
    if (this.wheelRest !== null) clearTimeout(this.wheelRest);
    this.wheelRest = setTimeout(() => {
      this.wheelRest = null;
      const edge: UiSwipeEdge = this.offset > 0 ? 'leading' : 'trailing';
      const open = this.reach(edge);
      const opens = Math.abs(this.offset) > open / 2;
      this.rest(opens ? (edge === 'leading' ? open : -open) : 0);
    }, WHEEL_REST_MS);
  }

  /** Past what may show, a pull is resisted; with nothing to show, refused. */
  private resisted(raw: number, width: number): number {
    const edge: UiSwipeEdge = raw > 0 ? 'leading' : 'trailing';
    const reach = this.reach(edge);
    const pull = Math.abs(raw);
    if (reach === 0) return 0;
    if (pull <= reach || this.uiFullSwipe()) {
      return Math.sign(raw) * Math.min(pull, Math.max(reach, width));
    }
    return Math.sign(raw) * (reach + (pull - reach) * RESISTANCE);
  }

  /** Draws the row at an offset, and says which edge shows and commits. */
  private place(offset: number, width: number): void {
    this.offset = offset;
    this.host.style.setProperty('--ui-swipe-offset', `${offset}px`);
    const edge: UiSwipeEdge | null =
      offset > 0 ? 'leading' : offset < 0 ? 'trailing' : null;
    this.shown.set(edge);
    const commits =
      edge !== null &&
      this.uiFullSwipe() &&
      width > 0 &&
      Math.abs(offset) >
        Math.max(this.reach(edge) + ACTION_PX / 2, width * FULL_SWIPE_SHARE);
    this.full.set(commits ? edge : null);
  }

  /**
   * Comes to rest at an offset (0 is closed), leaving at `speed` (px/ms,
   * positive toward the leading edge's opening).
   */
  private rest(offset: number, speed = 0): void {
    this.full.set(null);
    if (offset === 0) {
      if (closeOpenRow === this.closeSelf) closeOpenRow = null;
      this.unwatch();
      // The edge stays named while the row travels home, so the actions
      // shrink away rather than vanish, and is forgotten once it is there.
      this.fly(0, speed, () => {
        if (this.offset === 0) this.shown.set(null);
      });
      return;
    }
    this.shown.set(offset > 0 ? 'leading' : 'trailing');
    this.claim();
    this.fly(offset, speed);
  }

  /**
   * The row flies to an offset on the spring, from where it is and at the
   * speed it was let go with. The offset is the row's at once — the flight
   * only draws the way there — so a reader of the state never waits on it.
   */
  private fly(to: number, speed: number, landed?: () => void): void {
    this.swiping.set(false);
    const from = this.offset;
    this.flight?.cancel();
    this.flight = null;
    this.offset = to;
    this.host.style.setProperty('--ui-swipe-offset', `${to}px`);
    const view = this.host.ownerDocument.defaultView;
    const still =
      from === to ||
      typeof this.host.animate !== 'function' ||
      view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (still) {
      landed?.();
      return;
    }
    // The row never swings past home to the side that has nothing to show.
    const side = Math.sign(to !== 0 ? to : from);
    const path = springPath(from, to, speed * 1000).map((at) =>
      side > 0 ? Math.max(0, at) : Math.min(0, at),
    );
    const flight = this.host.animate(
      path.map((at) => ({ '--ui-swipe-offset': `${at}px` })),
      { duration: SPRING_MS, easing: 'linear' },
    );
    this.flight = flight;
    flight.finished.then(
      () => {
        if (this.flight !== flight) return;
        this.flight = null;
        landed?.();
      },
      () => undefined,
    );
  }

  /** A press or a scroll catches a row mid-flight exactly where it is. */
  private catch(): void {
    const flight = this.flight;
    if (flight === null) return;
    const at = Number.parseFloat(
      getComputedStyle(this.host).getPropertyValue('--ui-swipe-offset'),
    );
    this.flight = null;
    flight.cancel();
    if (!Number.isFinite(at)) return;
    this.offset = at;
    this.host.style.setProperty('--ui-swipe-offset', `${at}px`);
    this.full.set(null);
  }

  /** This row is the open one: any other closes, and the page is watched. */
  private claim(): void {
    if (closeOpenRow !== this.closeSelf) {
      closeOpenRow?.();
      closeOpenRow = this.closeSelf;
    }
    const view = this.host.ownerDocument;
    view.addEventListener('pointerdown', this.outside, true);
    view.addEventListener('scroll', this.outside, true);
  }

  private unwatch(): void {
    const view = this.host.ownerDocument;
    view.removeEventListener('pointerdown', this.outside, true);
    view.removeEventListener('scroll', this.outside, true);
  }

  private clicked(event: Event): void {
    if (this.swallowClick) {
      this.swallowClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (this.offset === 0) return;
    const onAction =
      event.target instanceof Element &&
      event.target.closest('.ui-swipe-action') !== null;
    // An action runs and the row closes behind it; a tap on the open row
    // only closes it.
    if (!onAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    this.close();
  }

  /** Focus arriving on an action shows its edge: a swipe is not required. */
  protected focused(event: FocusEvent): void {
    if (this.press !== null) return;
    const action = this.actions().find(
      (candidate) => candidate.element === event.target,
    );
    if (action === undefined) return;
    if (this.shown() === action.edge && this.offset !== 0) return;
    const reach = this.reach(action.edge);
    this.rest(action.edge === 'leading' ? reach : -reach);
  }

  protected blurred(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    if (this.offset !== 0 && this.press === null) this.close();
  }
}
