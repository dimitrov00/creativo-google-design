import {
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  Injector,
  output,
} from '@angular/core';

/** One move in a list: the item at `from` goes to `to` (both zero-based). */
export interface UiReorderMove {
  readonly from: number;
  readonly to: number;
}

/** A press becomes a drag once the pointer has travelled this far. */
const DRAG_SLOP_PX = 6;

/** What a row is seen to keep while it glides: its corners and its lift. */
const GLIDED_PROPERTIES = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'boxShadow',
] as const;

/** Long enough for the snappy spring to come to rest (700 ms). */
const GLIDE_REST_MS = 800;

/** Where an item was drawn, and how, just before the list changed. */
interface Drawn {
  readonly top: number;
  readonly look: readonly string[];
  readonly lifted: boolean;
}

/**
 * ≙ SwiftUI `List { … }.onMove(perform:)` in edit mode — a list whose items
 * are arranged by their handles. The list's items are its ELEMENT CHILDREN,
 * in order; each holds one `uiReorderHandle`.
 *
 * The directive moves nothing itself. It reports the move the person made
 * (`uiMoved`), and the owner re-renders the list in the new order — so the
 * order on screen is always the owner's data, and a refused save can put it
 * back.
 *
 * Three ways to say one move, because a drag must never be the only way
 * (WCAG 2.5.7):
 * - DRAG the handle: the item follows the finger, the others part on the
 *   house's snappy spring, and lifting the finger reports the move.
 * - ARROW UP / DOWN on a focused handle moves the item one place; focus
 *   stays on the handle.
 * - A TAP is left alone: it reaches the handle as a click. An owner that
 *   offers a menu of places («Най-горе», «Нагоре», «Надолу», «Най-долу»)
 *   reports the pick through {@link UiReorderList.move}.
 *
 * EVERY MOVE GLIDES. However a move is said, each item travels from where
 * it was drawn to its new place on the house's snappy spring, and its
 * corners and lift morph on the way — the item let go of settles out of the
 * air into its slot, and a row that becomes the list's first or last takes
 * that place's shape as it arrives. (The owner still re-renders in one
 * step; the directive draws the items where they were and lets go.) While
 * an item is dragged, each item carries `data-reorder-place` — `first`,
 * `last`, both or neither — for the place it is SEEN in, so a list whose
 * ends are shaped can shape them as the rows part.
 *
 * @uiPurpose Lets the items of a list be arranged: reports a drag of an
 *   item's handle, or an arrow key on it, as a move from one place to
 *   another.
 * @uiSwiftUI `List` with `.onMove(perform:)` and `EditButton`
 * @uiAliases reorder, sortable, drag to reorder, drag and drop, sort order,
 *   rearrange, move up, move down
 * @uiNotThis A value dragged along a range is `ui-slider`.
 */
@Directive({
  selector: '[uiReorderList]',
  host: { 'data-reorder-list': '' },
})
export class UiReorderList {
  /** The move the person made. Never emitted for a move to the same place. */
  readonly uiMoved = output<UiReorderMove>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private glideRun = 0;
  private reading = false;

  /** The list's items, in order. */
  items(): HTMLElement[] {
    return Array.from(this.host.nativeElement.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
  }

  /** The item a handle belongs to, and its place; `-1` when it is in none. */
  placeOf(handle: HTMLElement): number {
    return this.items().findIndex((item) => item.contains(handle));
  }

  /** Reports a move, clamped to the list; a move to the same place is none. */
  move(from: number, to: number): boolean {
    const last = this.items().length - 1;
    const target = Math.min(Math.max(to, 0), last);
    if (from < 0 || from > last || target === from) return false;
    this.glide(() => this.uiMoved.emit({ from, to: target }));
    return true;
  }

  /**
   * Runs a change to the list and glides every item from where it was drawn
   * to where the change leaves it. A change that moves nothing still lands
   * an item that was in the air.
   */
  glide(change: () => void): void {
    // A change made inside a glide belongs to it: the items are read once,
    // before the outermost change.
    if (this.reading) {
      change();
      return;
    }
    const before = this.drawn();
    this.reading = true;
    try {
      change();
    } finally {
      this.reading = false;
    }
    if (before.size === 0) return;
    afterNextRender(() => this.play(before), { injector: this.injector });
  }

  /** Each item as it is drawn now; nothing when motion is to be reduced. */
  private drawn(): Map<HTMLElement, Drawn> {
    const drawn = new Map<HTMLElement, Drawn>();
    const view = this.host.nativeElement.ownerDocument.defaultView;
    if (
      view === null ||
      view.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    ) {
      return drawn;
    }
    for (const item of this.items()) {
      const style = view.getComputedStyle(item);
      drawn.set(item, {
        top: item.getBoundingClientRect().top,
        look: GLIDED_PROPERTIES.map((property) => style[property]),
        lifted: item.hasAttribute('data-reorder-lifted'),
      });
    }
    return drawn;
  }

  /**
   * First-last-invert-play: each item is drawn back where it was, with the
   * corners and lift it had, and then released to its place on a transition.
   */
  private play(before: ReadonlyMap<HTMLElement, Drawn>): void {
    const list = this.host.nativeElement;
    const view = list.ownerDocument.defaultView;
    if (view === null) return;
    const gliding: HTMLElement[] = [];
    for (const item of this.items()) {
      const was = before.get(item);
      if (was === undefined) continue;
      const style = view.getComputedStyle(item);
      const travel = was.top - item.getBoundingClientRect().top;
      const reshaped = GLIDED_PROPERTIES.some(
        (property, index) => style[property] !== was.look[index],
      );
      if (travel === 0 && !reshaped && !was.lifted) continue;
      item.style.transition = 'none';
      if (travel !== 0) item.style.translate = `0 ${travel}px`;
      GLIDED_PROPERTIES.forEach((property, index) => {
        item.style[property] = was.look[index] ?? '';
      });
      // What was in the air lands over its neighbours, not through them.
      if (was.lifted) item.setAttribute('data-reorder-landing', '');
      gliding.push(item);
    }
    if (gliding.length === 0) return;
    // The inverted state is committed before it is released.
    void list.offsetHeight;
    list.setAttribute('data-reorder-settling', '');
    for (const item of gliding) {
      item.style.transition = '';
      item.style.translate = '';
      for (const property of GLIDED_PROPERTIES) item.style[property] = '';
    }
    const run = (this.glideRun += 1);
    setTimeout(() => {
      if (run !== this.glideRun) return;
      list.removeAttribute('data-reorder-settling');
      for (const item of this.items()) {
        item.removeAttribute('data-reorder-landing');
      }
    }, GLIDE_REST_MS);
  }

  /** While an item is dragged the others move on a transition. */
  setDragging(dragging: boolean): void {
    const list = this.host.nativeElement;
    if (dragging) list.setAttribute('data-reorder-dragging', '');
    else list.removeAttribute('data-reorder-dragging');
  }
}

/**
 * The handle of one item of a `uiReorderList`: a button (or anything
 * focusable) the item is dragged by. See {@link UiReorderList}.
 *
 * @uiPartOf uiReorderList
 * @uiPurpose The handle an item of a reorderable list is dragged by; arrow
 *   keys on it move the item one place.
 */
@Directive({
  selector: '[uiReorderHandle]',
  host: {
    'data-reorder-handle': '',
    'aria-keyshortcuts': 'ArrowUp ArrowDown',
    '(pointerdown)': 'pressed($event)',
    '(pointermove)': 'dragged($event)',
    '(pointerup)': 'released($event)',
    '(pointercancel)': 'cancelled()',
    '(keydown.arrowup)': 'stepped($event, -1)',
    '(keydown.arrowdown)': 'stepped($event, 1)',
  },
})
export class UiReorderHandle {
  private readonly list = inject(UiReorderList);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The press in hand: where it began and the list as it lay then. */
  private press: {
    readonly pointerId: number;
    readonly startY: number;
    readonly from: number;
    readonly items: readonly HTMLElement[];
    readonly tops: readonly number[];
    readonly heights: readonly number[];
    /** How far a neighbour steps aside: the dragged item's height and the gap. */
    readonly step: number;
    dragging: boolean;
    to: number;
  } | null = null;

  /** The click that ends a drag is not a tap: it is swallowed once. */
  private swallowClick = false;

  constructor() {
    // In the capture phase, so it runs ahead of the owner's own `(click)`
    // on this same element whichever was bound first.
    this.host.nativeElement.addEventListener(
      'click',
      (event) => this.clicked(event),
      { capture: true },
    );
  }

  protected pressed(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = this.host.nativeElement;
    const items = this.list.items();
    const from = this.list.placeOf(handle);
    if (from < 0 || items.length < 2) return;
    const rects = items.map((item) => item.getBoundingClientRect());
    const own = rects[from];
    const first = rects[0];
    const second = rects[1];
    if (own === undefined || first === undefined || second === undefined) {
      return;
    }
    const gap = Math.max(0, second.top - first.bottom);
    this.swallowClick = false;
    this.press = {
      pointerId: event.pointerId,
      startY: event.clientY,
      from,
      items,
      tops: rects.map((rect) => rect.top),
      heights: rects.map((rect) => rect.height),
      step: own.height + gap,
      dragging: false,
      to: from,
    };
    handle.setPointerCapture?.(event.pointerId);
  }

  protected dragged(event: PointerEvent): void {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    const travel = event.clientY - press.startY;
    if (!press.dragging) {
      if (Math.abs(travel) < DRAG_SLOP_PX) return;
      press.dragging = true;
      this.list.setDragging(true);
      press.items[press.from]?.setAttribute('data-reorder-lifted', '');
    }
    event.preventDefault();
    const ownTop = press.tops[press.from] ?? 0;
    const ownHeight = press.heights[press.from] ?? 0;
    const lastIndex = press.items.length - 1;
    const floor = (press.tops[0] ?? 0) - ownTop;
    const ceiling =
      (press.tops[lastIndex] ?? 0) +
      (press.heights[lastIndex] ?? 0) -
      (ownTop + ownHeight);
    const offset = Math.min(Math.max(travel, floor), ceiling);
    const centre = ownTop + ownHeight / 2 + offset;

    // The place the item would take: past each neighbour whose middle its
    // own middle has crossed.
    let to = press.from;
    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === press.from) continue;
      const middle = (press.tops[index] ?? 0) + (press.heights[index] ?? 0) / 2;
      if (index > press.from && centre >= middle) to = Math.max(to, index);
      if (index < press.from && centre <= middle) to = Math.min(to, index);
    }
    press.to = to;

    for (let index = 0; index <= lastIndex; index += 1) {
      const item = press.items[index];
      if (item === undefined) continue;
      let shift = 0;
      // The place the item is SEEN in, for a list that shapes its ends.
      let seen = index;
      if (index === press.from) {
        shift = offset;
        seen = to;
      } else if (index > press.from && index <= to) {
        shift = -press.step;
        seen = index - 1;
      } else if (index < press.from && index >= to) {
        shift = press.step;
        seen = index + 1;
      }
      item.style.translate = shift === 0 ? '' : `0 ${shift}px`;
      const place = [
        ...(seen === 0 ? ['first'] : []),
        ...(seen === lastIndex ? ['last'] : []),
      ].join(' ');
      if (item.getAttribute('data-reorder-place') !== place) {
        item.setAttribute('data-reorder-place', place);
      }
    }
  }

  protected released(event: PointerEvent): void {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    if (!press.dragging) {
      this.settle();
      return;
    }
    // The move was a drag: the click that follows the release is not a tap.
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    // The list reads every item where the drag left it BEFORE the drag's
    // own marks come off, so the item in hand lands from the air. A drop
    // on its own place is no move, and still lands.
    this.list.glide(() => {
      this.settle();
      this.list.move(press.from, press.to);
    });
  }

  protected cancelled(): void {
    if (this.press?.dragging === true) this.list.glide(() => this.settle());
    else this.settle();
  }

  private clicked(event: Event): void {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** An arrow key: one place up or down, and focus stays on this handle. */
  protected stepped(event: Event, by: -1 | 1): void {
    const handle = this.host.nativeElement;
    const from = this.list.placeOf(handle);
    if (from < 0) return;
    event.preventDefault();
    if (!this.list.move(from, from + by)) return;
    // The owner re-renders the list; the handle's node is moved with its
    // item, and a moved node may lose focus.
    afterNextRender(() => handle.focus(), { injector: this.injector });
  }

  /** The drag's own marks come off every item: the owner's order takes over. */
  private settle(): void {
    const press = this.press;
    this.press = null;
    if (press === null) return;
    this.list.setDragging(false);
    for (const item of press.items) {
      item.style.translate = '';
      item.removeAttribute('data-reorder-lifted');
      item.removeAttribute('data-reorder-place');
    }
  }
}
