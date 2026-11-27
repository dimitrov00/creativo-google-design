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
 * - A TAP is left alone: it reaches the handle as a click, where the owner
 *   opens a menu of places («Най-горе», «Нагоре», «Надолу», «Най-долу»).
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
    this.uiMoved.emit({ from, to: target });
    return true;
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
      if (index === press.from) shift = offset;
      else if (index > press.from && index <= to) shift = -press.step;
      else if (index < press.from && index >= to) shift = press.step;
      item.style.translate = shift === 0 ? '' : `0 ${shift}px`;
    }
  }

  protected released(event: PointerEvent): void {
    const press = this.press;
    if (press === null || event.pointerId !== press.pointerId) return;
    this.settle();
    if (!press.dragging) return;
    // The move was a drag: the click that follows the release is not a tap.
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    this.list.move(press.from, press.to);
  }

  protected cancelled(): void {
    this.settle();
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

  /** Every item back to rest, in one frame: the owner's order takes over. */
  private settle(): void {
    const press = this.press;
    this.press = null;
    if (press === null) return;
    this.list.setDragging(false);
    for (const item of press.items) {
      item.style.translate = '';
      item.removeAttribute('data-reorder-lifted');
    }
  }
}
