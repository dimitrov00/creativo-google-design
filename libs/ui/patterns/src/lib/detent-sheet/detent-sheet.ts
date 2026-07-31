import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

/**
 * How far up the sheet is resting. ≙ SwiftUI's `.presentationDetents` set.
 *
 * `small` is the peek — enough for a handle and a line of content. `medium`
 * is the working height Apple Maps rests at. `large` is "I am reading the
 * list now", which is where the content takes over scrolling.
 */
export type UiDetent = 'small' | 'medium' | 'large';

/**
 * Fraction of the container each detent reveals.
 *
 * Exported because content BEHIND the sheet needs it: a map has to inset its
 * camera by however much of itself is covered, or it centres its subject under
 * the sheet. One source for both, or the two drift.
 */
export const UI_DETENT_FRACTION: Readonly<Record<UiDetent, number>> = {
  small: 0.2,
  medium: 0.48,
  large: 0.92,
};

const DETENT_FRACTION = UI_DETENT_FRACTION;

const ORDER: readonly UiDetent[] = ['small', 'medium', 'large'];

/**
 * A flick beyond this speed (px/ms) skips to the next detent in the swipe's
 * direction instead of snapping to whichever is nearest. Matches the feel of
 * every iOS sheet: a quick flick commits, a slow drag lands where you left it.
 */
const FLICK_VELOCITY = 0.5;

/**
 * How far a pointer must travel before the gesture counts as a drag rather
 * than a tap. Below this a row still receives its click, which is what lets
 * the whole sheet — rows included — be draggable without breaking selection.
 */
const DRAG_THRESHOLD = 8;

/**
 * Non-modal bottom sheet that rests at detents and can be dragged between
 * them — ≙ SwiftUI `.presentationDetents([.medium, .large])` with
 * `.presentationBackgroundInteraction(.enabled)`.
 *
 * ### Why this is not `ui-sheet`
 * `ui-sheet` is MODAL: a scrim, a focus trap, `aria-modal`, body scroll lock.
 * That is right for a sheet that interrupts. This one does the opposite — it
 * shares the screen with whatever is behind it and stays out of the way. The
 * canonical case is a map: the sheet holds the list, the map holds the same
 * places, and the sheet's height is how the user says which of the two they
 * are currently thinking with. No mode switch, no segmented control — the
 * drag IS the switch.
 *
 * Because it is non-modal, everything behind it stays interactive and
 * focusable, which is the whole point. It is therefore NOT for anything that
 * needs an answer before the user continues.
 *
 * ### The scroll hand-off
 * Below the tallest detent, a drag anywhere in the sheet — including over the
 * list — MOVES THE SHEET. Only once it is fully up does the content take over
 * scrolling, and even then a downward drag from a scroller already at the top
 * hands the gesture back to the sheet.
 *
 * That asymmetry is the whole trick: it means a user who tries to scroll a
 * half-height sheet grows it instead, which is what they wanted, rather than
 * scrolling a box that is mostly off-screen. Nobody should have to find the
 * 36pt handle to see the third row.
 *
 * ```html
 * <ui-detent-sheet [(uiDetent)]="detent" [uiDetents]="['small','medium','large']">
 *   <h2 uiHeader>Nearby</h2>
 *   …rows…
 * </ui-detent-sheet>
 * ```
 *
 * The host must sit inside a `position: relative` container that has a real
 * height — it positions itself against that, not against the viewport, so a
 * map pane and a full-page use both work.
 */
@Component({
  selector: 'ui-detent-sheet',
  template: `
    <!-- The grab area: the handle plus anything slotted as [uiHeader]. Apple
         lets you drag the header, not just the 36pt handle, which is the
         difference between a sheet that feels grabbable and one that needs
         aiming. -->
    <div
      class="ui-detent-sheet__grabber"
      (pointerdown)="onDragStart($event)"
      (pointermove)="onDragMove($event)"
      (pointerup)="onDragEnd($event)"
      (pointercancel)="onDragEnd($event)"
    >
      <button
        type="button"
        class="ui-detent-sheet__handle"
        [attr.aria-label]="uiHandleLabel()"
        [attr.aria-expanded]="uiDetent() === 'large'"
        (click)="toggle()"
        (keydown)="onHandleKeydown($event)"
      >
        <span class="ui-detent-sheet__grip" aria-hidden="true"></span>
      </button>
      <ng-content select="[uiHeader]" />
    </div>

    <div
      class="ui-detent-sheet__content"
      (scroll)="onContentScroll($event)"
      (wheel)="onWheel($event)"
      (pointerdown)="onDragStart($event)"
      (pointermove)="onDragMove($event)"
      (pointerup)="onDragEnd($event)"
      (pointercancel)="onDragEnd($event)"
    >
      <ng-content />
    </div>
  `,
  styleUrl: './detent-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-detent-sheet',
    '[attr.data-detent]': 'uiDetent()',
    '[attr.data-dragging]': "dragging() ? '' : null",
    '[style.--ui-detent-offset.%]': 'offsetPercent()',
    '[style.--ui-detent-height.%]': 'maxPercent()',
  },
})
export class UiDetentSheet {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // A NATIVE capture listener, not an Angular binding: Angular has no
    // `.capture` modifier for DOM events, and the row's own click handler is
    // on a descendant — so bubbling would reach the row first and select it.
    const element = this.host.nativeElement;
    const swallow = (event: Event): void => this.onClickCapture(event);
    element.addEventListener('click', swallow, true);
    this.destroyRef.onDestroy(() =>
      element.removeEventListener('click', swallow, true),
    );
  }

  /** Which detents this sheet may rest at, in any order. */
  readonly uiDetents = input<readonly UiDetent[]>(ORDER);
  readonly uiDetent = model<UiDetent>('medium');
  readonly uiHandleLabel = input('Resize');

  protected readonly dragging = signal(false);

  /** Live drag offset in percent of the sheet's own height, or `null` at rest. */
  private readonly dragOffset = signal<number | null>(null);

  private pointerId: number | null = null;
  private startY = 0;
  private startOffset = 0;
  private lastY = 0;
  private lastAt = 0;
  private velocity = 0;
  private contentAtTop = true;
  /** True once a gesture has been claimed as a sheet drag rather than a scroll. */
  private draggingContent = false;
  /** The current gesture has passed the threshold and is moving the sheet. */
  private claimed = false;
  /** A claimed drag ended — swallow the click it would otherwise deliver. */
  private suppressNextClick = false;

  /** The tallest allowed detent — the sheet's own height. */
  protected readonly maxPercent = computed(
    () => Math.max(...this.allowed().map((d) => DETENT_FRACTION[d])) * 100,
  );

  /**
   * How far the sheet is pushed DOWN, as a percentage of its own height.
   * `0` means fully revealed; the resting value comes from the current detent
   * unless a drag is in flight.
   */
  protected readonly offsetPercent = computed(() => {
    const live = this.dragOffset();
    if (live !== null) return live;
    return this.offsetFor(this.uiDetent());
  });

  /** Is the sheet at the tallest detent it is allowed to reach? */
  private atLargest(): boolean {
    const allowed = this.allowed();
    return this.uiDetent() === allowed[allowed.length - 1];
  }

  private allowed(): readonly UiDetent[] {
    const requested = this.uiDetents();
    const valid = ORDER.filter((detent) => requested.includes(detent));
    return valid.length > 0 ? valid : ORDER;
  }

  private offsetFor(detent: UiDetent): number {
    const max = Math.max(...this.allowed().map((d) => DETENT_FRACTION[d]));
    const fraction = DETENT_FRACTION[detent];
    return (1 - fraction / max) * 100;
  }

  // ── Drag ────────────────────────────────────────────────────────────

  /**
   * Every gesture inside the sheet is TRACKED from the start, including ones
   * that begin on a row.
   *
   * The first pass refused to track anything starting on a control, so a thumb
   * placed on a shop row — which is a `<button>`, like most rows worth
   * dragging over — did nothing at all. The sheet only moved if you found bare
   * padding. Refusing early is the wrong tool: what actually separates a tap
   * from a drag is DISTANCE, so tracking starts immediately and the gesture is
   * only CLAIMED once it passes {@link DRAG_THRESHOLD}. Under that, the row
   * gets its click exactly as before.
   */
  protected onDragStart(event: PointerEvent): void {
    const fromContent = (event.target as HTMLElement).closest(
      '.ui-detent-sheet__content',
    );
    // Below the tallest detent the sheet always wins: growing it is what the
    // user is reaching for. At the top detent the scroller wins unless it is
    // already at its top, which is what makes the two read as one object.
    if (fromContent && this.atLargest() && !this.contentAtTop) return;

    // Disarm any suppression left by an earlier drag. A tap's own
    // `pointerdown` always precedes its `click`, so clearing here means a
    // stale flag can never eat a legitimate tap — which it did: the click
    // after a drag-and-then-think-about-it was silently swallowed.
    this.suppressNextClick = false;

    this.pointerId = event.pointerId;
    this.startY = event.clientY;
    this.lastY = event.clientY;
    // `performance.now()`, not `event.timeStamp`: synthetic and replayed
    // pointer events carry timestamps that are zero or identical, which makes
    // every gesture look infinitely slow and silently disables the flick.
    this.lastAt = performance.now();
    this.velocity = 0;
    this.startOffset = this.offsetFor(this.uiDetent());
    // A content drag only refuses UPWARD travel once the sheet is already at
    // its tallest — below that, dragging up is exactly how it grows.
    this.draggingContent = fromContent !== null && this.atLargest();
    this.claimed = false;
  }

  protected onDragMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;

    const height = this.sheetHeight();
    if (height === 0) return;

    const dy = event.clientY - this.startY;
    // A content-originated drag only counts DOWNWARD: dragging up from the
    // top of a scroller should scroll it, not raise a sheet that is already up.
    if (this.draggingContent && dy < 0) return;

    // Below the threshold this is still a tap in progress — do not move the
    // sheet and do not swallow the event.
    if (!this.claimed) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      this.claimed = true;
      this.dragging.set(true);
      // Keep receiving moves even when the finger leaves the row it started on.
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    }

    const now = performance.now();
    if (now > this.lastAt) {
      this.velocity = (event.clientY - this.lastY) / (now - this.lastAt);
      this.lastY = event.clientY;
      this.lastAt = now;
    }

    const smallest = Math.min(...this.allowed().map((d) => this.offsetFor(d)));
    const largest = Math.max(...this.allowed().map((d) => this.offsetFor(d)));
    const next = this.startOffset + (dy / height) * 100;
    this.dragOffset.set(Math.min(Math.max(next, smallest), largest));
    // Claimed: stop the map underneath from panning with the same finger.
    event.preventDefault();
  }

  protected onDragEnd(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;

    const wasClaimed = this.claimed;
    this.claimed = false;
    this.dragging.set(false);

    const offset = this.dragOffset();
    this.dragOffset.set(null);
    if (!wasClaimed || offset === null) return;

    // A drag that ended on a row must not also SELECT that row.
    this.suppressNextClick = true;
    this.uiDetent.set(this.settleTo(offset));
  }

  /**
   * Swallow the click a claimed drag would otherwise deliver.
   *
   * Capture phase, because the row's own listener would fire first — dragging
   * the sheet up by its list and landing on a different shop must not pick
   * that shop.
   */
  private onClickCapture(event: Event): void {
    if (!this.suppressNextClick) return;
    this.suppressNextClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  /**
   * A wheel or trackpad scroll below the tallest detent GROWS the sheet rather
   * than scrolling a box that is mostly off-screen — the pointer equivalent of
   * the drag hand-off, so the behaviour is the same whichever input is used.
   */
  protected onWheel(event: WheelEvent): void {
    if (this.atLargest() || event.deltaY <= 0) return;
    const allowed = this.allowed();
    const index = allowed.indexOf(this.uiDetent());
    if (index < 0 || index >= allowed.length - 1) return;
    event.preventDefault();
    this.uiDetent.set(allowed[index + 1] as UiDetent);
  }

  /**
   * Where a released drag lands.
   *
   * A flick commits to the NEXT detent in the direction of travel; a slow drag
   * settles on whichever is nearest. Snapping purely by distance makes a fast
   * flick feel ignored, which is the most common complaint about hand-rolled
   * sheets.
   */
  private settleTo(offset: number): UiDetent {
    const allowed = this.allowed();
    const current = this.uiDetent();

    if (Math.abs(this.velocity) > FLICK_VELOCITY) {
      const index = allowed.indexOf(current);
      // Positive velocity is downward, which means a SMALLER detent.
      const next = this.velocity > 0 ? index - 1 : index + 1;
      const clamped = Math.min(Math.max(next, 0), allowed.length - 1);
      return allowed[clamped] as UiDetent;
    }

    let nearest = allowed[0] as UiDetent;
    let best = Number.POSITIVE_INFINITY;
    for (const detent of allowed) {
      const distance = Math.abs(this.offsetFor(detent) - offset);
      if (distance < best) {
        best = distance;
        nearest = detent;
      }
    }
    return nearest;
  }

  private sheetHeight(): number {
    return this.host.nativeElement.getBoundingClientRect().height;
  }

  // ── Keyboard and tap ────────────────────────────────────────────────

  /** Tapping the handle steps up, and wraps back down from the top. */
  protected toggle(): void {
    const allowed = this.allowed();
    const index = allowed.indexOf(this.uiDetent());
    const next = index >= allowed.length - 1 ? 0 : index + 1;
    this.uiDetent.set(allowed[next] as UiDetent);
  }

  protected onHandleKeydown(event: KeyboardEvent): void {
    const allowed = this.allowed();
    const index = allowed.indexOf(this.uiDetent());
    if (event.key === 'ArrowUp' && index < allowed.length - 1) {
      this.uiDetent.set(allowed[index + 1] as UiDetent);
    } else if (event.key === 'ArrowDown' && index > 0) {
      this.uiDetent.set(allowed[index - 1] as UiDetent);
    } else {
      return;
    }
    event.preventDefault();
  }

  protected onContentScroll(event: Event): void {
    this.contentAtTop = (event.target as HTMLElement).scrollTop <= 0;
  }
}
