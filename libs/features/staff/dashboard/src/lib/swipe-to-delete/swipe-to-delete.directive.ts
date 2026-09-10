import {
  DestroyRef,
  Directive,
  ElementRef,
  HostListener,
  inject,
  output,
  signal,
} from '@angular/core';

/** The width of the revealed act, in CSS pixels — matches the stylesheet. */
const ACTION_WIDTH = 88;
/** Movement before a press becomes a swipe — a tap on a chip stays a tap. */
const ENGAGE_PX = 8;

/**
 * SWIPE TO DELETE, the iOS list grammar (owner, 2026-09-09) — for a row
 * whose only remaining act is "take it off". The host holds two children:
 * the CONTENT (`.staff-visit__swipe-content`), which slides, and the ACT
 * (`.staff-visit__swipe-action`), a real button that sits behind it and is
 * always in the DOM — a keyboard reaches it directly, a finger reveals it.
 *
 * A drag past half the row deletes outright; past half the act's width
 * settles open; anything less springs back. A press on the open content
 * closes it. Vertical movement is left to the scroller (`touch-action:
 * pan-y`), and nothing engages until eight pixels of horizontal travel, so
 * the chips on the row still take their taps.
 *
 * While OPEN the row is the topmost transient thing on the page, so it
 * takes the dismissals first: a press anywhere else closes it, and Escape
 * closes it INSTEAD of the sheet it sits in — both listened for at the
 * document in the capture phase, because focus is rarely inside a row a
 * finger just swiped and the sheet's own Escape would otherwise win.
 */
@Directive({
  selector: '[libSwipeToDelete]',
  host: {
    class: 'lib-swipe',
    '[attr.data-open]': 'open() ? "" : null',
    '[attr.data-dragging]': 'dragging() ? "" : null',
    '[style.--lib-swipe-x.px]': 'offset()',
  },
})
export class SwipeToDeleteDirective {
  readonly deleted = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);
  protected readonly dragging = signal(false);
  protected readonly offset = signal(0);

  private startX = 0;
  private startY = 0;
  private startOffset = 0;
  private engaged = false;
  private pointerId: number | null = null;

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.open()) return;
    event.stopPropagation();
    this.settle(false);
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.open()) return;
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.settle(false);
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.listen(false));
  }

  @HostListener('pointerdown', ['$event'])
  onDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    // A press on the act itself is the act's own click.
    if ((event.target as HTMLElement).closest('.staff-visit__swipe-action')) {
      return;
    }
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startOffset = this.offset();
    this.engaged = false;
  }

  @HostListener('pointermove', ['$event'])
  onMove(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.engaged) {
      if (Math.abs(dx) < ENGAGE_PX || Math.abs(dx) < Math.abs(dy)) return;
      this.engaged = true;
      this.dragging.set(true);
      // Best effort: capture keeps the drag alive once the finger leaves
      // the row. A DOM without pointer capture (jsdom) still swipes.
      try {
        this.host.nativeElement.setPointerCapture(event.pointerId);
      } catch {
        /* no capture — the move still tracks while over the row */
      }
    }
    const width = this.host.nativeElement.getBoundingClientRect().width;
    const next = Math.min(0, Math.max(-width, this.startOffset + dx));
    this.offset.set(next);
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    if (!this.engaged) {
      // A tap on open content closes it; a tap on closed content is the
      // content's own business.
      if (this.open()) this.settle(false);
      return;
    }
    this.engaged = false;
    this.dragging.set(false);
    const width = this.host.nativeElement.getBoundingClientRect().width;
    const x = this.offset();
    if (x < -width / 2) {
      this.settle(false);
      this.deleted.emit();
    } else {
      this.settle(x < -ACTION_WIDTH / 2);
    }
  }

  private settle(open: boolean): void {
    if (open !== this.open()) this.listen(open);
    this.open.set(open);
    this.offset.set(open ? -ACTION_WIDTH : 0);
  }

  private listen(on: boolean): void {
    const doc = this.host.nativeElement.ownerDocument;
    const method = on ? 'addEventListener' : 'removeEventListener';
    doc[method]('keydown', this.onDocumentKeydown as EventListener, true);
    doc[method](
      'pointerdown',
      this.onDocumentPointerDown as EventListener,
      true,
    );
  }
}
