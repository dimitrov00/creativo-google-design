import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  afterRenderEffect,
} from '@angular/core';
import { UiAvatar, UiIcon } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import {
  DRAG_THRESHOLD_PX,
  type DragGesture,
  HOLD_MS,
  HOLD_SLOP_PX,
  buzz,
  capturePointer,
  clamp,
  edgeScrollerOf,
  fill,
  hourLabel,
  PlacementVerdict,
  type PlacementVerdictSlice,
  releasePointer,
  snapTo,
  timeLabel,
} from '../time-grid/grid-gesture';
import { gridEventWords } from '../tag-words';
import { EditCommand, ResizeEdge } from '@core/components';
import { GridEvent as GridEventTag } from '@core/systems';
import type {
  GridColumn,
  GridCommit,
  GridDraft,
  GridDragCopy,
  GridEvent,
  GridWindow,
  OpenWindow,
} from '../time-grid/staff-time-grid';

/** A civil day. */
const DAY_MINUTES = 1440;

/**
 * The minutes around "now" within which an hour label stands down so the now
 * pill has the ruler to itself — the grid's rule, on this axis, where it is
 * LOPSIDED: a label hangs to the RIGHT of its tick (a tight pad and «20:00»
 * in caption figures, ~36px) while the pill is centred on its minute (~40px
 * wide). At 80px an hour the pill's left half reaches an hour BEHIND now
 * until now is 50 minutes past it ((36 + 20 + 4px of air) / 1.33); an hour
 * AHEAD is touched only within 20 ((20 − 6 + 4) / 1.33, rounded up). The
 * symmetric twenty drew «20:32» over the «00» of «20:00» (review r5,
 * 2026-10-06).
 */
const NOW_LABEL_CLEARANCE_BEHIND = 50;
const NOW_LABEL_CLEARANCE_AHEAD = 20;

/** Would the now pill, centred on `now`, land on the label hung at `hour`? */
function coveredByNow(hour: number, now: number): boolean {
  const behind = now - hour;
  return (
    behind > -NOW_LABEL_CLEARANCE_AHEAD && behind < NOW_LABEL_CLEARANCE_BEHIND
  );
}

/**
 * The scale a gesture falls back to when the layout cannot be measured — a
 * hidden tab, a test harness with no layout engine. The stylesheet's own
 * figure: 80px an hour.
 */
const FALLBACK_PX_PER_MINUTE = 80 / 60;

const NO_DRAG_COPY: GridDragCopy = {
  handleStart: '',
  handleEnd: '',
  blockRole: '',
  minutes: '',
  overlap: '',
  outside: '',
  tooShort: '',
  backTo: '',
};

/** A bar laid along a row's minute track — `from`/`span` as fractions of the extent. */
interface TimelineBar extends GridEvent {
  readonly from: number;
  readonly span: number;
  /** Under the band — the collision the note beneath the picture names. */
  readonly collides: boolean;
}

/** A stretch of a row that is SHUT, as fractions of the extent. */
interface TimelineRun {
  readonly key: string;
  readonly from: number;
  readonly span: number;
}

/** One chair, laid out: a rail, its closed hours, its bookings. */
interface TimelineRow {
  readonly id: string;
  readonly title: string;
  readonly avatarSrc: string | null;
  readonly isToday: boolean;
  readonly closed: readonly TimelineRun[];
  readonly bars: readonly TimelineBar[];
}

/** THE BAND — the block under edit, drawn once across every row. */
interface TimelineBand extends GridDraft {
  readonly from: number;
  readonly span: number;
  readonly title: string;
  readonly accessibleName: string;
  /**
   * Over the WHOLE axis — an all-day block. A fill with no edge on screen is
   * invisible; this is what earns the band its hatch.
   */
  readonly whole: boolean;
}

/** One live pointer gesture. Plain mutable state: nothing here is drawn. */
interface DragState {
  readonly id: string;
  /** Which edge — or the whole band — the gesture is holding. */
  readonly dragGesture: DragGesture;
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  readonly scrollLeft0: number;
  /** Where the pointer last was — what the edge loop measures against. */
  x: number;
  /** The interval the gesture STARTED from — what a revert goes back to. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly pxPerMinute: number;
  readonly target: HTMLElement;
  /** A finger, which cannot be told from a scroll until it commits. */
  readonly touch: boolean;
  /** The hold that lifts a touch gesture, until it fires or is abandoned. */
  hold: ReturnType<typeof setTimeout> | null;
  /** Past the threshold. A handle is armed on `pointerdown`; a body is not. */
  armed: boolean;
}

/**
 * THE CHAIR TIMELINE — the same day as the grid, turned on its side.
 *
 * One ROW per chair and the hours ACROSS, the way Outlook's scheduling
 * assistant lays a meeting over its attendees (owner, 2026-09-09: "when more
 * than two barbers are selected, switch strategy — horizontal, each row a
 * barber, the columns the hour grid"). The grid's cap says why: three chairs
 * side by side on a phone are 110px columns, which carry neither a name nor
 * a time; three rows are three full-width tracks, and a fourth costs one more
 * row rather than a narrower column.
 *
 * The block is ONE THING at one time across every chair, so it is drawn as
 * one band across every row rather than once per row — the assistant's own
 * grammar. The bookings it would sit on show through it, marked; the note
 * under the picture names them.
 *
 * It takes the grid's own inputs (`GridColumn`, `GridDraft`, `GridDragCopy`)
 * and gives the grid's own outputs, so the sheet feeds either picture from
 * one place and hears either one the same way. The gesture — hold to lift on
 * touch, threshold for a mouse, snap, clamp, the readout, the keyboard on the
 * handles — is the grid's, from `grid-gesture.ts`, along the other axis.
 */
@Component({
  selector: 'lib-staff-timeline',
  imports: [UiAvatar, UiIcon, UiTextDirective],
  templateUrl: './staff-timeline.html',
  styleUrls: ['./staff-timeline.css', './staff-timeline.band.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like the grid: bare `.staff-timeline*` selectors are the
  // styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'staff-timeline' },
})
export class StaffTimeline {
  /** A bar's `data-kind` — the lower-case words the CSS selects on. */
  protected readonly gridEventWords = gridEventWords;
  /** One column per chair — each becomes a row. */
  readonly columns = input.required<readonly GridColumn[]>();
  /** The stretch of the clock to draw; the civil day when absent. */
  readonly uiWindow = input<GridWindow | null>(null);
  readonly uiSnapMinutes = input(15);
  readonly uiEditableEventId = input<string | null>(null);
  readonly uiEditable = input(false);
  readonly uiMinMinutes = input(10);
  readonly uiDragCopy = input<GridDragCopy>(NO_DRAG_COPY);
  readonly nowMinute = input<number | null>(null);

  readonly draftChanged = output<GridDraft>();
  readonly draftCommitted = output<GridCommit>();

  /* ── The axis ─────────────────────────────────────────────────── */

  /** The drawn stretch, snapped to whole hours and grown to hold every bar. */
  protected readonly extent = computed(() => {
    const columns = this.columns();
    if (columns.length === 0) {
      return { start: 0, end: 0, minutes: 0, empty: true };
    }
    const window = this.uiWindow();
    let start = window?.startMinute ?? 0;
    let end = window?.endMinute ?? DAY_MINUTES;
    for (const column of columns) {
      for (const event of column.events) {
        start = Math.min(start, event.startMinute);
        end = Math.max(end, event.endMinute);
      }
    }
    start = Math.floor(start / 60) * 60;
    end = Math.ceil(end / 60) * 60;
    return { start, end, minutes: end - start, empty: end <= start };
  });

  protected readonly hourCount = computed(() => this.extent().minutes / 60);

  /** The ruler's labels — one at every hour boundary but the last. */
  protected readonly hours = computed(() => {
    const { start, end, empty } = this.extent();
    if (empty) return [];
    const now = this.showsNow() ? this.nowMinute() : null;
    const out: {
      key: string;
      index: number;
      label: string;
      nearNow: boolean;
    }[] = [];
    for (let minute = start, index = 0; minute < end; minute += 60, index++) {
      out.push({
        key: String(minute),
        index,
        label: hourLabel(minute),
        nearNow: now !== null && coveredByNow(minute, now),
      });
    }
    return out;
  });

  protected readonly showsNow = computed(() => {
    const now = this.nowMinute();
    const { start, end, empty } = this.extent();
    return (
      now !== null &&
      !empty &&
      now >= start &&
      now <= end &&
      this.columns().some((column) => column.isToday)
    );
  });

  protected readonly nowFraction = computed(() =>
    fraction(this.nowMinute() ?? 0, this.extent()),
  );

  protected readonly nowLabel = computed(() =>
    timeLabel(this.nowMinute() ?? 0),
  );

  /**
   * THE MINUTES OF THE BAND THAT HAVE GONE, as a fraction of the band's own
   * width — the grid's elapsed wash, so a block half behind us reads as one
   * shape with a part of it in the past here too. `null` when none has.
   */
  protected readonly bandElapsed = computed<number | null>(() => {
    const band = this.band();
    if (band === null || !this.showsNow()) return null;
    const now = this.nowMinute() ?? 0;
    if (now <= band.startMinute) return null;
    return Math.min(
      1,
      (now - band.startMinute) / (band.endMinute - band.startMinute),
    );
  });

  /** Where the band's name sits on the ruler: over its middle. */
  protected readonly bandMiddle = computed(() => {
    const band = this.band();
    return band === null ? 0 : band.from + band.span / 2;
  });

  /* ── The draft ────────────────────────────────────────────────── */

  /** The grid's own rule: a held draft is spent the moment the caller answers. */
  private readonly draftState = signal<{
    readonly draft: GridDraft;
    readonly basis: GridDraft;
  } | null>(null);

  protected readonly draft = computed<GridDraft | null>(() => {
    const held = this.draftState();
    if (held === null) return null;
    const live = this.eventById(held.draft.id);
    if (live === null) return null;
    const answered =
      live.startMinute !== held.basis.startMinute ||
      live.endMinute !== held.basis.endMinute;
    return answered ? null : held.draft;
  });

  /** The band that takes handles — `null` unless the caller opted in. */
  protected readonly editableId = computed(() =>
    this.uiEditable() ? this.uiEditableEventId() : null,
  );

  protected readonly editable = computed(() => this.editableId() !== null);

  protected readonly minMinutes = computed(() =>
    Math.max(1, Math.round(this.uiMinMinutes())),
  );

  protected readonly snapMinutes = computed(() =>
    Math.max(1, Math.round(this.uiSnapMinutes())),
  );

  /** The block under edit, draft applied, as one band across the rows. */
  protected readonly band = computed<TimelineBand | null>(() => {
    const id = this.uiEditableEventId();
    if (id === null) return null;
    const live = this.eventById(id);
    if (live === null) return null;
    const extent = this.extent();
    if (extent.empty) return null;
    const draft = this.draft();
    const startMinute = draft?.startMinute ?? live.startMinute;
    const endMinute = draft?.endMinute ?? live.endMinute;
    return {
      id,
      startMinute,
      endMinute,
      from: fraction(startMinute, extent),
      span: (endMinute - startMinute) / extent.minutes,
      title: live.title,
      accessibleName: live.accessibleName,
      whole: startMinute <= extent.start && endMinute >= extent.end,
    };
  });

  /* ── The rows ─────────────────────────────────────────────────── */

  protected readonly rows = computed<readonly TimelineRow[]>(() => {
    const extent = this.extent();
    if (extent.empty) return [];
    const band = this.band();
    const bandId = this.uiEditableEventId();
    return this.columns().map((column) => ({
      id: column.id,
      title: column.title,
      avatarSrc: column.avatarSrc,
      isToday: column.isToday,
      closed: closedRuns(column.open, extent),
      bars: column.events
        .filter((event) => event.id !== bandId)
        .map<TimelineBar>((event) => ({
          ...event,
          from: fraction(event.startMinute, extent),
          span: (event.endMinute - event.startMinute) / extent.minutes,
          // A gap is the ABSENCE of a booking — landing on one is the point.
          collides:
            band !== null &&
            event.gridEvent !== GridEventTag.Gap &&
            event.startMinute < band.endMinute &&
            event.endMinute > band.startMinute,
        })),
    }));
  });

  /* ── The gesture ──────────────────────────────────────────────── */

  private readonly gesture = signal<DragGesture | null>(null);
  protected readonly dragging = computed(() => this.gesture() !== null);
  protected readonly moving = computed(
    () => this.gesture() === EditCommand.Move,
  );
  protected readonly draggingEdge = computed<ResizeEdge | null>(() => {
    const gesture = this.gesture();
    return gesture === ResizeEdge.Start || gesture === ResizeEdge.End
      ? gesture
      : null;
  });
  /** The two handles' edges, for the template's calls. */
  protected readonly ResizeEdge = ResizeEdge;

  /** What each handle may be dragged to — `aria-valuemin`/`max`, the keyboard's bounds. */
  protected readonly handleBounds = computed(() => {
    const band = this.band();
    if (band === null) return null;
    const { start, end } = this.extent();
    const floor = this.minMinutes();
    return {
      startMin: start,
      startMax: band.endMinute - floor,
      endMin: band.startMinute + floor,
      endMax: end,
    };
  });

  /**
   * What the draft breaks, if anything — DRAWN AND NAMED, never clamped
   * silently. The grid's rule, over every chair at once: the first booking
   * under the band anywhere names the overlap, and the band is outside the
   * shift when any chosen chair is shut for part of it.
   */
  protected readonly draftVerdict = computed<PlacementVerdictSlice | null>(
    () => {
      const band = this.band();
      if (band === null) return null;
      const floor = this.minMinutes();
      if (band.endMinute - band.startMinute <= floor) {
        return { placementVerdict: PlacementVerdict.Short, minutes: floor };
      }
      for (const row of this.rows()) {
        const hit = row.bars.find((bar) => bar.collides);
        if (hit !== undefined) {
          return {
            placementVerdict: PlacementVerdict.Overlap,
            name: hit.title,
            time: timeLabel(hit.startMinute),
          };
        }
      }
      const inside = this.columns().every((column) =>
        column.open.some(
          (window) =>
            band.startMinute >= window.startMinute &&
            band.endMinute <= window.endMinute,
        ),
      );
      return inside ? null : { placementVerdict: PlacementVerdict.Outside };
    },
  );

  protected readonly readoutTone = computed<'destructive' | 'warning' | null>(
    () => {
      const verdict = this.draftVerdict();
      if (verdict === null) return null;
      return verdict.placementVerdict === PlacementVerdict.Outside
        ? 'warning'
        : 'destructive';
    },
  );

  /**
   * Where the readout hangs along the ruler: the edge OPPOSITE the handle
   * under the finger, and the start edge for a body drag — the grid's rule,
   * for the same physical reason.
   */
  protected readonly readoutAnchor = computed(() => {
    const gesture = this.gesture();
    const band = this.band();
    if (gesture === null || band === null) return null;
    return gesture === ResizeEdge.Start ? band.from + band.span : band.from;
  });

  protected readonly readoutText = computed(() => {
    const gesture = this.gesture();
    const band = this.band();
    if (gesture === null || band === null) return '';
    const length = this.lengthText(band.endMinute - band.startMinute);
    if (gesture === EditCommand.Move) {
      return `${timeLabel(band.startMinute)} – ${timeLabel(band.endMinute)} · ${length}`;
    }
    const edge =
      gesture === ResizeEdge.Start ? band.startMinute : band.endMinute;
    return `${timeLabel(edge)} · ${length}`;
  });

  protected readonly readoutNote = computed(() => {
    const verdict = this.draftVerdict();
    const copy = this.uiDragCopy();
    if (verdict === null) return '';
    if (verdict.placementVerdict === PlacementVerdict.Short) {
      return fill(copy.tooShort, { minutes: verdict.minutes });
    }
    if (verdict.placementVerdict === PlacementVerdict.Outside) {
      return copy.outside;
    }
    return (
      fill(copy.overlap, { name: verdict.name, time: verdict.time }) ||
      `${verdict.name} ${verdict.time}`
    );
  });

  /** `aria-valuetext` — the same sentence the pill draws, for a reader. */
  protected handleText(edge: ResizeEdge): string {
    const band = this.band();
    if (band === null) return '';
    const at = edge === ResizeEdge.Start ? band.startMinute : band.endMinute;
    const length = this.lengthText(band.endMinute - band.startMinute);
    const note = this.readoutNote();
    return note === ''
      ? `${timeLabel(at)} · ${length}`
      : `${timeLabel(at)} · ${length}. ${note}`;
  }

  private lengthText(minutes: number): string {
    return fill(this.uiDragCopy().minutes, { minutes }) || String(minutes);
  }

  /* ── Pointer ──────────────────────────────────────────────────── */

  private drag: DragState | null = null;
  private detachPointer: (() => void) | null = null;

  protected onHandleDown(
    event: PointerEvent,
    edge: ResizeEdge,
    band: GridDraft,
  ): void {
    // A resize gesture IS its edge.
    this.beginDrag(event, edge, band, true);
  }

  /** The band's body moves. A `<button>`, so the sheet's own drag-to-dismiss bails on it. */
  protected onBandDown(event: PointerEvent, band: GridDraft): void {
    if (band.id !== this.editableId()) return;
    this.beginDrag(event, EditCommand.Move, band, false);
  }

  private beginDrag(
    event: PointerEvent,
    dragGesture: DragGesture,
    band: GridDraft,
    armed: boolean,
  ): void {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement | null;
    if (target === null) return;
    const touch = event.pointerType === 'touch';
    this.drag = {
      id: band.id,
      dragGesture,
      pointerId: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      x: event.clientX,
      touch,
      hold: null,
      scrollLeft0: this.frame()?.nativeElement.scrollLeft ?? 0,
      startMinute: band.startMinute,
      endMinute: band.endMinute,
      pxPerMinute: this.measurePxPerMinute(),
      target,
      armed: false,
    };
    this.listenForPointer();
    // A FINGER WAITS: the browser owns this touch and scrolls with it the
    // instant it moves. Only a finger that stays put long enough gets the band.
    if (touch) {
      this.drag.hold = setTimeout(() => this.arm(), HOLD_MS);
      return;
    }
    if (armed) this.arm(event);
  }

  private arm(event?: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || drag.armed) return;
    drag.armed = true;
    this.clearHold(drag);
    event?.preventDefault();
    event?.stopPropagation();
    capturePointer(drag.target, drag.pointerId);
    this.gesture.set(drag.dragGesture);
    buzz(10);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // Measured against the CONTENT, not the viewport: the frame scrolls
    // under the finger at the edge.
    const scrolled =
      (this.frame()?.nativeElement.scrollLeft ?? drag.scrollLeft0) -
      drag.scrollLeft0;
    const dx = this.fingerX(event.clientX) - drag.x0 + scrolled;
    if (!drag.armed) {
      // A TRAVELLING FINGER IS A SCROLL, and it stays one.
      if (drag.touch) {
        const travelled =
          Math.abs(event.clientX - drag.x0) >= HOLD_SLOP_PX ||
          Math.abs(event.clientY - drag.y0) >= HOLD_SLOP_PX;
        if (travelled) this.endDrag(drag);
        return;
      }
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      this.arm(event);
    }
    if (event.cancelable) event.preventDefault();
    drag.x = event.clientX;
    this.applyDelta(drag, dx);
    // The edge loop reads the finger, never the band — see `edgeScrollerOf`.
    this.edge.update(event.clientX);
  }

  /** The frame scrolled itself under a resting finger: the band follows. */
  private followFinger(): void {
    const drag = this.drag;
    const frame = this.frame()?.nativeElement;
    if (drag === null || !drag.armed || !frame) return;
    const scrolled = frame.scrollLeft - drag.scrollLeft0;
    this.applyDelta(drag, this.fingerX(drag.x) - drag.x0 + scrolled);
  }

  /** The finger, clamped to the frame's box — the band rides the edge past it. */
  private fingerX(clientX: number): number {
    const box = this.frame()?.nativeElement.getBoundingClientRect();
    return box && box.width > 0 ? clamp(clientX, box.left, box.right) : clientX;
  }

  private readonly edge = edgeScrollerOf(
    'x',
    () => this.frame()?.nativeElement,
    () => this.followFinger(),
  );

  /** A long press's context menu is refused mid-gesture; a right-click keeps it. */
  protected onContextMenu(event: Event): void {
    if (this.drag !== null) event.preventDefault();
  }

  private applyDelta(drag: DragState, dx: number): void {
    const moved = dx / drag.pxPerMinute;
    const snap = this.snapMinutes();
    const next =
      drag.dragGesture === EditCommand.Move
        ? this.moveTo(drag, snapTo(drag.startMinute + moved, snap))
        : drag.dragGesture === ResizeEdge.Start
          ? this.resizeStartTo(drag, snapTo(drag.startMinute + moved, snap))
          : this.resizeEndTo(drag, snapTo(drag.endMinute + moved, snap));
    const current = this.draft() ?? this.eventById(drag.id);
    if (
      current !== null &&
      current.startMinute === next.startMinute &&
      current.endMinute === next.endMinute
    ) {
      return;
    }
    this.publish(next);
    buzz(4);
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    this.endDrag(drag);
    if (!drag.armed) return;
    this.swallowNextClick();
    const final = this.draftState()?.draft ?? null;
    if (final === null) return;
    if (
      final.startMinute === drag.startMinute &&
      final.endMinute === drag.endMinute
    ) {
      return;
    }
    buzz(12);
    this.draftCommitted.emit({
      ...final,
      editCommand:
        drag.dragGesture === EditCommand.Move
          ? EditCommand.Move
          : EditCommand.Resize,
    });
  }

  /** `pointercancel` and a lost capture both REVERT — there is no third ending. */
  /** A node moved by Angular loses capture without the gesture ending — see the grid. */
  private onLostCapture(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    if (drag.armed && drag.target.isConnected) {
      capturePointer(drag.target, drag.pointerId);
      return;
    }
    this.onPointerCancel(event);
  }

  private onPointerCancel(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    this.endDrag(drag);
    if (!drag.armed) return;
    this.swallowNextClick();
    this.draftState.set(null);
    this.draftChanged.emit({
      id: drag.id,
      startMinute: drag.startMinute,
      endMinute: drag.endMinute,
    });
  }

  private clearHold(drag: DragState): void {
    if (drag.hold !== null) {
      clearTimeout(drag.hold);
      drag.hold = null;
    }
  }

  private endDrag(drag: DragState): void {
    this.clearHold(drag);
    this.edge.stop();
    this.drag = null;
    this.gesture.set(null);
    this.detachPointer?.();
    releasePointer(drag.target, drag.pointerId);
  }

  /* ── Keyboard ─────────────────────────────────────────────────── */

  protected onHandleKey(
    event: KeyboardEvent,
    edge: ResizeEdge,
    band: GridDraft,
  ): void {
    const bounds = this.handleBounds();
    if (bounds === null) return;
    const start = edge === ResizeEdge.Start;
    const at = start ? band.startMinute : band.endMinute;
    const to = this.keyTarget(
      event,
      at,
      start ? bounds.startMin : bounds.endMin,
      start ? bounds.startMax : bounds.endMax,
    );
    if (to === null) return;
    event.preventDefault();
    this.step(
      start ? this.resizeStartTo(band, to) : this.resizeEndTo(band, to),
      EditCommand.Resize,
    );
  }

  /** The arrows slide the WHOLE band; the duration is invariant. */
  protected onBandKey(event: KeyboardEvent, band: GridDraft): void {
    if (band.id !== this.editableId()) return;
    const { start, end } = this.extent();
    const duration = band.endMinute - band.startMinute;
    const to = this.keyTarget(event, band.startMinute, start, end - duration);
    if (to === null) return;
    event.preventDefault();
    this.step(this.moveTo(band, to), EditCommand.Move);
  }

  /**
   * Where a key press wants to land. Left and right are this axis's own
   * arrows; up and down are accepted too, so a hand that learned the grid
   * is not wrong here. Shift is the precision escape: one minute.
   */
  private keyTarget(
    event: KeyboardEvent,
    at: number,
    min: number,
    max: number,
  ): number | null {
    const step = event.shiftKey ? 1 : this.snapMinutes();
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        return at - step;
      case 'ArrowRight':
      case 'ArrowDown':
        return at + step;
      case 'PageUp':
        return at - 60;
      case 'PageDown':
        return at + 60;
      case 'Home':
        return min;
      case 'End':
        return max;
      default:
        return null;
    }
  }

  /** One keyboard step is a whole gesture: it publishes AND commits. */
  private step(next: GridDraft, editCommand: GridCommit['editCommand']): void {
    const current = this.draft() ?? this.eventById(next.id);
    if (
      current !== null &&
      current.startMinute === next.startMinute &&
      current.endMinute === next.endMinute
    ) {
      return;
    }
    this.publish(next);
    this.draftCommitted.emit({ ...next, editCommand });
    buzz(4);
  }

  /* ── The arithmetic every path shares ─────────────────────────── */

  private moveTo(origin: GridDraft, startMinute: number): GridDraft {
    const { start, end } = this.extent();
    const duration = origin.endMinute - origin.startMinute;
    const at = clamp(startMinute, start, end - duration);
    return { id: origin.id, startMinute: at, endMinute: at + duration };
  }

  private resizeStartTo(origin: GridDraft, startMinute: number): GridDraft {
    const { start } = this.extent();
    const floor = this.minMinutes();
    return {
      id: origin.id,
      startMinute: clamp(startMinute, start, origin.endMinute - floor),
      endMinute: origin.endMinute,
    };
  }

  private resizeEndTo(origin: GridDraft, endMinute: number): GridDraft {
    const { end } = this.extent();
    const floor = this.minMinutes();
    return {
      id: origin.id,
      startMinute: origin.startMinute,
      endMinute: clamp(endMinute, origin.startMinute + floor, end),
    };
  }

  private publish(next: GridDraft): void {
    this.draftState.set({ draft: next, basis: this.basisFor(next) });
    this.draftChanged.emit(next);
  }

  private basisFor(fallback: GridDraft): GridDraft {
    const held = this.draftState();
    if (held !== null && this.draft() !== null) return held.basis;
    const live = this.eventById(fallback.id);
    return live === null
      ? fallback
      : {
          id: fallback.id,
          startMinute: live.startMinute,
          endMinute: live.endMinute,
        };
  }

  private eventById(id: string): GridEvent | null {
    for (const column of this.columns()) {
      for (const event of column.events) {
        if (event.id === id) return event;
      }
    }
    return null;
  }

  /** Pixels per minute, MEASURED from the band's own box and the fraction it was drawn at. */
  private measurePxPerMinute(): number {
    const { minutes } = this.extent();
    const band = this.band();
    const element = this.bandElement();
    if (element !== null && band !== null && band.span > 0) {
      const extentPx = element.getBoundingClientRect().width / band.span;
      if (extentPx > 0 && minutes > 0) return extentPx / minutes;
    }
    return FALLBACK_PX_PER_MINUTE;
  }

  private bandElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      '.staff-timeline__band',
    );
  }

  /* ── The way back ─────────────────────────────────────────────────── */

  /** The grid's rule, on this axis: which edge the band has gone past. */
  protected readonly offscreen = signal<'before' | 'after' | null>(null);

  protected onFrameScroll(): void {
    this.refreshOffscreen();
  }

  private refreshOffscreen(): void {
    const frame = this.frame()?.nativeElement;
    const band = this.uiEditableEventId() === null ? null : this.bandElement();
    let next: 'before' | 'after' | null = null;
    if (frame && band) {
      const box = frame.getBoundingClientRect();
      const rect = band.getBoundingClientRect();
      // The track starts past the pinned rail of chairs.
      const rail =
        frame.querySelector<HTMLElement>('.staff-timeline__rail')
          ?.offsetWidth ?? 0;
      if (box.width > 0) {
        if (rect.right <= box.left + rail) next = 'before';
        else if (rect.left >= box.right) next = 'after';
      }
    }
    if (this.offscreen() !== next) this.offscreen.set(next);
  }

  // Kept as a member so the effect lives as long as the surface; nothing
  // reads it, and nothing needs to.
  protected readonly offscreenWatch = afterRenderEffect(() => {
    this.band();
    this.uiEditableEventId();
    untracked(() => this.refreshOffscreen());
  });

  protected readonly editableTimeLabel = computed(() => {
    const band = this.band();
    return band === null ? '' : timeLabel(band.startMinute);
  });

  protected readonly backToLabel = computed(() => {
    const time = this.editableTimeLabel();
    return fill(this.uiDragCopy().backTo, { time }) || time;
  });

  /** The band back to the middle of the track — see the grid's `recenter`. */
  recenter(behavior?: ScrollBehavior): void {
    if (this.uiEditableEventId() === null) return;
    const still =
      this.host.nativeElement.ownerDocument?.defaultView?.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches ?? false;
    this.applyCentre(behavior ?? (still ? 'auto' : 'smooth'));
  }

  /* ── Plumbing ─────────────────────────────────────────────────── */

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');

  private listenForPointer(): void {
    if (this.detachPointer !== null) return;
    const doc = this.document;
    const move = (event: Event) => this.onPointerMove(event as PointerEvent);
    const up = (event: Event) => this.onPointerUp(event as PointerEvent);
    const cancel = (event: Event) =>
      this.onPointerCancel(event as PointerEvent);
    const lost = (event: Event) => this.onLostCapture(event as PointerEvent);
    /*
     * THE ONE MOMENT A PAN CAN STILL BE REFUSED (2026-09-10, an iPhone).
     *
     * `touch-action: pan-y` lets the browser scroll on this touch, and
     * nothing about pointer capture stops it: a captured pointer still
     * pans, and `pointermove` cannot be prevented. The FIRST `touchmove`
     * can — refused from a non-passive listener, the browser abandons the
     * pan for the rest of the touch. So once the hold has lifted the block
     * every touchmove is refused, and before it none is: a travelling
     * finger scrolls as it should. Until today the TEXT under the finger
     * was doing this by accident — iOS's selection long-press claimed the
     * held touch and the page stopped panning. Made unselectable, the
     * accident went, and a held finger that moved scrolled the frame.
     */
    const touch = (event: Event) => {
      if (this.drag?.armed && event.cancelable) event.preventDefault();
    };
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('touchmove', touch, { passive: false });
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', cancel);
    doc.addEventListener('lostpointercapture', lost);
    this.detachPointer = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', cancel);
      doc.removeEventListener('lostpointercapture', lost);
      doc.removeEventListener('touchmove', touch);
      this.detachPointer = null;
    };
  }

  /** Eat the one `click` a finished drag leaves behind. */
  private swallowNextClick(): void {
    const doc = this.document;
    const swallow = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      done();
    };
    const done = () => {
      doc.removeEventListener('click', swallow, true);
      clearTimeout(timer);
    };
    doc.addEventListener('click', swallow, true);
    const timer = setTimeout(done, 0);
  }

  /** The band this picture has already centred on. Latched by id, as the grid's is. */
  private centred: string | null = null;
  private centring = false;

  constructor() {
    effect(() => this.centreOnEditable());
    this.destroyRef.onDestroy(() => this.detachPointer?.());
  }

  /**
   * THE PICTURE OPENS ON ITS OWN BAND, centred along the hours — the grid's
   * promise, kept on this axis. Tracked reads are exactly `uiEditableEventId`:
   * centring on anything the draft touches would re-centre on every snap.
   */
  private centreOnEditable(): void {
    const id = this.uiEditableEventId();
    if (id === null) return;
    untracked(() => this.scheduleCentre(id));
  }

  private scheduleCentre(id: string): void {
    if (this.centred === id || this.centring) return;
    this.centring = true;
    const view = this.host.nativeElement.ownerDocument?.defaultView;
    if (!view) {
      this.centring = false;
      return;
    }
    let attempts = 0;
    const tick = (): void => {
      attempts += 1;
      if (this.applyCentre()) {
        this.centred = id;
        this.centring = false;
        return;
      }
      if (attempts >= 10) {
        this.centring = false;
        return;
      }
      view.requestAnimationFrame(tick);
    };
    view.requestAnimationFrame(tick);
  }

  private applyCentre(behavior: ScrollBehavior = 'auto'): boolean {
    if (this.gesture() !== null) return false;
    const frame = this.frame()?.nativeElement;
    const band = this.bandElement();
    if (!frame || !band || frame.clientWidth === 0) return false;
    const rail =
      frame.querySelector<HTMLElement>('.staff-timeline__rail')?.offsetWidth ??
      0;
    const box = frame.getBoundingClientRect();
    const rect = band.getBoundingClientRect();
    const middle = rect.left - box.left + rect.width / 2;
    // Centred in the TRACK — the part of the box the rail is not covering.
    const target = rail + (frame.clientWidth - rail) / 2;
    const left = clamp(
      frame.scrollLeft + middle - target,
      0,
      frame.scrollWidth - frame.clientWidth,
    );
    if (behavior === 'smooth' && typeof frame.scrollTo === 'function') {
      frame.scrollTo({ left, behavior });
    } else {
      frame.scrollLeft = left;
    }
    return true;
  }
}

/** A minute as a fraction of the extent — the form every position takes. */
function fraction(
  minute: number,
  extent: { readonly start: number; readonly minutes: number },
): number {
  return extent.minutes === 0 ? 0 : (minute - extent.start) / extent.minutes;
}

/**
 * The stretches of the extent OUTSIDE a chair's working windows, as runs.
 * Windows are sorted and merged first, so a split shift in any order still
 * shades exactly the hours between its halves.
 */
function closedRuns(
  open: readonly OpenWindow[],
  extent: {
    readonly start: number;
    readonly end: number;
    readonly minutes: number;
  },
): readonly TimelineRun[] {
  const merged: { startMinute: number; endMinute: number }[] = [];
  for (const window of [...open].sort(
    (a, b) => a.startMinute - b.startMinute,
  )) {
    const last = merged.at(-1);
    if (last !== undefined && window.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, window.endMinute);
    } else {
      merged.push({ ...window });
    }
  }
  const runs: TimelineRun[] = [];
  let cursor = extent.start;
  for (const window of merged) {
    if (window.startMinute > cursor) {
      runs.push(run(cursor, Math.min(window.startMinute, extent.end), extent));
    }
    cursor = Math.max(cursor, window.endMinute);
  }
  if (cursor < extent.end) runs.push(run(cursor, extent.end, extent));
  return runs.filter((r) => r.span > 0);
}

function run(
  from: number,
  to: number,
  extent: { readonly start: number; readonly minutes: number },
): TimelineRun {
  return {
    key: `${from}-${to}`,
    from: fraction(from, extent),
    span: (to - from) / extent.minutes,
  };
}
