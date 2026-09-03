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
} from '@angular/core';
import { UiAvatar, UiIcon, type UiIconName } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

/** One block drawn in a column — a visit, an absence, or a sellable hole. */
export interface GridEvent {
  readonly id: string;
  /**
   * `visit` — a booking. `gap` — a sellable hole. `block` — time carved OUT
   * of the worked day (a break, an admin hour).
   *
   * A block is a THING, not the absence of one. It used to reach this
   * component as the complement of a roster window and got painted as
   * `aria-hidden` closed shading, which made time a barber blocked for
   * themselves pixel-identical to 03:00 on a Sunday: no name, no hit target,
   * nothing to remove. HIG's direct-manipulation rule settles the rendering —
   * anything a person is meant to move has to be an object they can grab.
   */
  readonly kind: 'visit' | 'gap' | 'block';
  /**
   * WHOSE CHAIR, as one of the five identity tones.
   *
   * The chair-columned views already say it with position, which is why hue
   * was free here for so long. The DATE-columned ones (3-day, week) merge
   * every chair into one column and drop attribution text at narrow widths —
   * so the rail is the only thing left saying who, and it is exactly where
   * the agenda now says it too. `null` on a block or a shop-wide row.
   */
  readonly barberTone: number | null;
  /**
   * MINUTES FROM MIDNIGHT of the day this block belongs to — not an epoch.
   *
   * The grid's vertical axis is a time of day shared by every column, and in
   * the date-columned views Monday's 09:00 and Tuesday's 09:00 are 24 hours
   * apart in absolute time. Normalising at the boundary is what lets one
   * renderer serve a chair-columned day and a date-columned week; it also
   * takes the timezone out of the grid entirely, which is why a 23- or
   * 25-hour DST day needs no special case here.
   */
  readonly startMinute: number;
  readonly endMinute: number;
  /** The line the eye lands on — a client's name, or "40 min free". */
  readonly title: string;
  /** Secondary line, dropped as the block shrinks. */
  readonly detail: string | null;
  /**
   * Whose chair, when the column is a DAY rather than a chair. Absent in the
   * day view, where the column header already says it.
   */
  readonly attribution: string | null;
  readonly status: string | null;
  readonly terminal: boolean;
  /**
   * This block's hour has already gone.
   *
   * TEMPORAL, not a status — the two are different axes and the hatch belongs
   * to this one. A completed cut, a no-show and a cancellation at 10:00 are
   * all equally in the past by noon; so is a booking still sitting
   * `confirmed`, which is exactly the row a shop most needs to notice,
   * because an unsettled past visit poisons every figure derived from it.
   */
  readonly past: boolean;
  /**
   * The block's whole story in words — "Георги Петров, Фейд, 10:00–10:45,
   * приключен".
   *
   * HIG *Color*: never rely on colour alone. Form and a glyph carry the
   * state visually; this is the third channel, and the only one a screen
   * reader has.
   */
  readonly accessibleName: string;
  /** Glyph doubling the terminal state, or `null` while it is still live. */
  readonly statusIcon: UiIconName | null;
}

/** One column: a chair (day view) or a date (3-day / week). */
export interface GridColumn {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  /**
   * The day number, when a column IS a date — rendered as a capsule beside
   * the weekday, filled on today. `null` in the barber-columned day view,
   * where the header is a person and a number would mean nothing.
   */
  readonly dayNumber: number | null;
  /** Marks today's column in the multi-day views. */
  readonly isToday: boolean;
  /** The barber's portrait, when a column IS a barber. `null` for a date. */
  readonly avatarSrc: string | null;
  readonly events: readonly GridEvent[];
  /**
   * When this column is OPEN — minutes from midnight, one entry per working
   * window (a split shift has two).
   *
   * Per column rather than per grid, because that is how the fact actually
   * varies: Ivan works 09:00–18:00 and Nikolay 12:00–20:00, and in the week
   * view a Sunday can be shut while the Monday beside it is not. An empty
   * list means CLOSED ALL DAY, which is a real answer and renders as a fully
   * muted column — the state that used to be indistinguishable from "free".
   */
  readonly open: readonly OpenWindow[];
}

/** A stretch of a column's working day. */
export interface OpenWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * The stretch of the day the grid is asked to DRAW — the axis, clamped.
 *
 * Distinct from `OpenWindow`, which says when a column is staffed: this one
 * says how much of the clock exists at all. The page grid passes none and
 * gets the civil day; the visit frame passes an event's neighbourhood and
 * gets a ruler it can aim a five-minute drag on.
 */
export interface GridWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * An interval a gesture is PROPOSING for one block.
 *
 * Nothing in this component writes a time. A drag emits this on every snap
 * and the surface that owns the appointment decides what to do with it —
 * which is what makes the frame safe to drag with a dirty draft on screen.
 */
export interface GridDraft {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * A finished gesture, naming WHICH gesture it was.
 *
 * The caller cannot re-derive `kind` from the numbers: a move that happens
 * to land on a legal duration is arithmetically indistinguishable from two
 * resizes, and the toast, the announcement and the server command all differ
 * by which one the barber actually performed.
 */
export interface GridCommit extends GridDraft {
  readonly kind: 'move' | 'resize';
}

/**
 * The words the drag surfaces need, from the surface that owns the
 * translations.
 *
 * The grid formats every NUMBER itself — a time is digits in any language —
 * and takes every WORD from here, so this library stays free of copy exactly
 * as `zoneLabel` and `allDayLabel` already keep it. Templates carry
 * `{{name}}`-shaped holes; an empty string means "say it with the numbers
 * alone", which is what an un-wired caller degrades to rather than English.
 */
export interface GridDragCopy {
  /** Accessible name of the top handle. */
  readonly handleStart: string;
  /** Accessible name of the bottom handle. */
  readonly handleEnd: string;
  /** `aria-roledescription` on the block — "movable block". */
  readonly blockRole: string;
  /** `{{minutes}} мин`. */
  readonly minutes: string;
  /** `Застъпва {{name}} {{time}}`. */
  readonly overlap: string;
  /** `Извън смяната`. */
  readonly outside: string;
  /** `Най-малко {{minutes}} мин`. */
  readonly tooShort: string;
}

const NO_DRAG_COPY: GridDragCopy = {
  handleStart: '',
  handleEnd: '',
  blockRole: '',
  minutes: '',
  overlap: '',
  outside: '',
  tooShort: '',
};

/** A muted stretch — the hours this column is shut, on the grid's own track. */
interface ClosedRun {
  readonly key: string;
  readonly row: string;
}

/** A block laid out against the grid's own minute track. */
interface PlacedEvent extends GridEvent {
  /** Slot placement: a `grid-row` span. `null` under `proportional`. */
  readonly row: string | null;
  /**
   * Proportional placement: the block's top edge and its height as UNITLESS
   * FRACTIONS of the extent (0–1), exactly the form the now-line already
   * takes. `null` under `slots`, so the binding drops off the element and
   * the page grid's markup is the markup it has always been.
   */
  readonly top: number | null;
  readonly height: number | null;
  /** Side-by-side placement for blocks that genuinely overlap. */
  readonly lane: number;
  readonly lanes: number;
  readonly short: boolean;
}

/**
 * A SIBLING CHAIR's block, drawn inside the opened chair's column.
 *
 * What the column cap degrades to rather than a column too narrow to carry a
 * name: outlined, tinted at the other barber's tone, and labelled in words —
 * `Иван · 10:35`. Never draggable, and `aria-hidden`, because the frame's own
 * summary paragraph already names the sibling leg in a sentence.
 */
interface GhostBlock {
  readonly key: string;
  readonly top: number;
  readonly height: number;
  readonly tone: number | null;
  readonly label: string;
}

/** Which arithmetic places a block. See `uiPlacement`. */
type Placement = 'slots' | 'proportional';

/** Which edge — or the whole block — a live gesture is holding. */
type DragKind = 'move' | 'resize-start' | 'resize-end';

/** One live pointer gesture. Plain mutable state: nothing here is drawn. */
interface DragState {
  readonly id: string;
  readonly kind: DragKind;
  readonly pointerId: number;
  readonly y0: number;
  readonly scrollTop0: number;
  /** The interval the gesture STARTED from — what a revert goes back to. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly pxPerMinute: number;
  readonly target: HTMLElement;
  /** Past the threshold. A handle is armed on `pointerdown`; a body is not. */
  armed: boolean;
}

const MINUTES_PER_SLOT = 15;
/** A civil day. The axis is this long unless something runs past midnight. */
const DAY_MINUTES = 1440;
/**
 * Under this many minutes a block cannot hold two lines legibly.
 *
 * MEASURED, not guessed. A slot is 28px (`--staff-slot-height`), so a
 * half-hour block is 56px tall; take off its 1px block margins and its 2px
 * padding and 50px of content box is left, against ~17px of footnote title
 * and ~16px of caption detail. Two lines fit with room to spare.
 *
 * The old value was 40, which made every 30-minute service — most of the
 * catalogue — drop the one line that says WHAT the appointment is. A
 * quarter-hour block (28px) genuinely holds one line, and that is the case
 * this constant is for; those put the service beside the name instead of
 * losing it (see the template).
 */
const SHORT_BLOCK_MINUTES = 30;

/**
 * How many chairs the frame will draw SIDE BY SIDE, and the width at which
 * the answer changes.
 *
 * §3.4.2 ruled "one column, always" and this reverses it (owner, 2026-08-26):
 * a party across two chairs has to be legible at a glance. The cap is the
 * load-bearing half of that reversal, and it is arithmetic, not taste. 375px
 * minus the frame's 44px gutter is 331px; TWO columns are 165px each, which
 * carries a name and a time. THREE are 110px, which carries neither — that is
 * a chart, and this surface is a control.
 *
 * Above the breakpoint the same reasoning permits four: 600px minus the
 * gutter is 556px, or 139px a column, and the frame is no longer competing
 * with a phone's whole screen.
 */
const NARROW_COLUMN_CAP = 2;
const WIDE_COLUMN_CAP = 4;
const WIDE_FRAME_PX = 600;
/** How close to an edge the finger has to be before the frame scrolls itself. */
const EDGE_SCROLL_MARGIN_PX = 28;
/** The most one pointer move may scroll. The cap is what bounds the gesture. */
const EDGE_SCROLL_STEP_PX = 14;

/**
 * How far a pointer travels before a BODY drag arms.
 *
 * A handle has none — a dedicated 44pt target is unambiguous and claims its
 * pointer on `pointerdown`. The block is also a tap target (it opens the
 * visit), so a tap that wobbles by a few pixels has to stay a tap.
 */
const DRAG_THRESHOLD_PX = 4;

/**
 * The scale a gesture falls back to when the layout cannot be measured — a
 * hidden tab, a font still loading, a test harness with no layout engine.
 *
 * The frame's regular-density figure (`--sys-space-unit * 0.6` at 4px), so a
 * drag still moves in the right direction at roughly the right rate rather
 * than dividing by a zero-height box.
 */
const FALLBACK_PX_PER_MINUTE = 2.4;

/**
 * The proportional calendar canvas — a time gutter and N columns, with every
 * block placed by its true start and length.
 *
 * ### One renderer, three views
 * Day, 3-day and week differ ONLY in what a column is. Giving each its own
 * component would triple the overlap maths, the now-line, the DST-safe
 * minute track and the degradation rules, and they would drift on the first
 * edit. The caller decides what a column means; this decides where things go.
 *
 * ### The extent is the DAY; the roster is a shading
 * The axis runs 00:00–24:00, as every calendar people already know does, and
 * the hours outside a column's own working windows are MUTED rather than
 * absent. Clipping the grid to the roster was the earlier design and it was
 * wrong in a way that only shows up in use: a 07:30 walk-in, an overrun that
 * pushes a cut past closing, a barber whose Saturday starts at noon — the
 * axis silently redrew itself around whatever happened to exist, so the same
 * shop had a different-shaped day on different days and no stable place to
 * look for "the morning". A muted 03:00 costs a scroll; a missing 08:00 costs
 * a booking (owner ruling 2026-08-10).
 *
 * What that buys back is the closed hours as INFORMATION: a column shut all
 * day is a fully muted column, which is visibly different from an open one
 * with nothing in it — the distinction the surface has never been able to
 * draw.
 */
@Component({
  selector: 'lib-staff-time-grid',
  imports: [UiAvatar, UiIcon, UiTextDirective],
  templateUrl: './staff-time-grid.html',
  styleUrl: './staff-time-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like the ui patterns: bare `.staff-grid-*` selectors are the
  // styling contract, and a host-level attribute cannot reach a child's
  // emulated-encapsulation shadow.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'staff-grid' },
})
export class StaffTimeGrid {
  readonly columns = input.required<readonly GridColumn[]>();
  /**
   * The first rostered minute across the visible columns — no longer the
   * axis, but where the axis is SCROLLED TO.
   *
   * A full day is 96 slots tall, and landing a reader at 00:00 would make
   * them scroll past eight shut hours to reach the first booking. The grid
   * opens on the working day (or on now, when today is in view) exactly as
   * Apple Calendar does, and this is the hint that says where that is.
   *
   * There is deliberately no `rosterEndMinute` beside it. One existed, was
   * wired from the page, and was read by nothing once the extent stopped
   * being the roster — the component needs to know where the day starts so it
   * can scroll there, and has no use at all for where it ends.
   */
  readonly rosterStartMinute = input<number | null>(null);

  /** Minutes from midnight; draws the now-line when it lands in the extent. */
  readonly nowMinute = input<number | null>(null);
  /**
   * The exact time the line marks, e.g. "15:48".
   *
   * A rule with no number says only THAT it is now; the reference puts the
   * time in the gutter beside it, and a schedule read at arm's length needs
   * the figure more than the rule.
   */
  protected readonly nowLabel = computed(() => {
    const minute = this.nowMinute();
    if (minute === null) return '';
    const hour = Math.floor(minute / 60) % 24;
    return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  });

  /**
   * The zone every time on this grid is stated in — shown in the gutter head
   * so a reader never has to assume it. The reference puts `UTC` there for
   * the same reason: a schedule that does not name its zone is one wrong
   * assumption away from a missed appointment.
   */
  readonly zoneLabel = input<string>('');

  /** All-day entries per column id — closures, days off, whole-day blocks. */
  readonly allDay = input<Readonly<Record<string, readonly string[]>>>({});
  /** The row's own label — the caller owns the copy, this owns the layout. */
  readonly allDayLabel = input<string>('');
  /**
   * Keep the all-day row on screen even when nothing is in it.
   *
   * A row that appears and disappears moves every hour beneath it, so the
   * grid jumps as you page between days — and its absence is not information,
   * it is just an empty row that happened to be collapsed.
   */
  readonly allDayAlways = input(false);

  /* ── The second mode ───────────────────────────────────────────────────
   *
   * The visit editor draws a time frame, and a frame is this grid with three
   * facts changed: a clamped axis, a five-minute quantum, and no page chrome.
   * A second component would have meant a second overlap packer, a second
   * now-line and a second set of degradation rules, and they would have
   * drifted on the first edit — so the differences arrive as inputs and the
   * page grid keeps every default it has today.
   */

  /**
   * How a block meets the minute track.
   *
   * `slots` rounds a block OUTWARD to the 15-minute grid — a 10:05 start
   * draws at 10:00 — which is right for a page-sized day (the block lands on
   * the rules the eye is already following) and makes a five-minute quantum
   * unrepresentable without 288 tracks. `proportional` places by percentage
   * of the extent instead, the same mechanism the now-line uses, so 10:05 is
   * drawn at 10:05.
   *
   * The default is `slots` and the page grid is not migrating in this pass:
   * proportional placement touches lane packing, the closed runs, the hour
   * gradient and the reveal scroll on the surface four people use all day,
   * and that is its own change with its own screenshots.
   */
  readonly uiPlacement = input<Placement>('slots');

  /**
   * `page` — the calendar IS the screen: full viewport height, sticky column
   * heads, room under the last booking for the action bar.
   *
   * `framed` — the grid is a control inside a sheet. The column head, the
   * zone button and an empty all-day row are page furniture and a 240px
   * window cannot afford them; the height comes from the frame token rather
   * than the viewport, and the one-shot reveal scroll is skipped because it
   * keys on the column signature and would fight a window that moves under a
   * drag.
   */
  readonly uiViewport = input<'page' | 'framed'>('page');

  /**
   * Draw only this stretch of the clock, instead of deriving the axis from
   * the day.
   *
   * Snapped OUTWARD to whole hours, never inward: the gutter lays its labels
   * out as hour-tall rows from the extent's first minute, so a window opening
   * at 09:05 would print "09:00" five minutes late and every label under it
   * would inherit the lie. The frame therefore always shows at least what it
   * was asked for.
   */
  readonly uiWindow = input<GridWindow | null>(null);

  /**
   * The quantum an edit moves in — the pitch of the drag hint and of any
   * ruling aligned to it, published to CSS as `--staff-grid-snap`.
   *
   * It does not move anything on its own: nothing in this component writes a
   * time. It is the frame's ruler, stated where the frame's geometry is.
   */
  readonly uiSnapMinutes = input(15);

  /**
   * The one block that is being EDITED, if any — marked `data-editable` so
   * the frame can hang its handles and its dirty tint off it.
   *
   * An id rather than a flag on `GridEvent`: the edited block is a property
   * of the surface, not of the booking, and the same event feeds a page grid
   * where nothing is editable.
   */
  readonly uiEditableEventId = input<string | null>(null);

  /**
   * Draw the HANDLES on `uiEditableEventId`'s block, and let it be dragged.
   *
   * Separate from `uiEditableEventId` because marking which block is under
   * edit and letting a finger move it are two different permissions: the
   * page grid tints the open appointment without ever offering the gesture,
   * and the frame turns the gesture on only once its draft can accept one.
   */
  readonly uiEditable = input(false);

  /**
   * The shortest interval a gesture may leave behind.
   *
   * The PLATFORM floor, not the sellable one: `SHORTEST_SELLABLE_MINUTES`
   * governs what the public may book, and a beard tidy-up is a real
   * ten-minute job a barber may place. A caller with a service floor of its
   * own (a two-service appointment that cannot shrink below its catalogue
   * span) raises this; the grid clamps at whatever it is handed.
   */
  readonly uiMinMinutes = input(10);

  /** The words the handles, the block and the readout say. See the type. */
  readonly uiDragCopy = input<GridDragCopy>(NO_DRAG_COPY);

  readonly zonePicked = output<void>();
  readonly eventPicked = output<string>();
  readonly gapPicked = output<string>();
  /** A break or admin block was tapped — the parent owns what that opens. */
  readonly blockPicked = output<string>();

  /**
   * The interval a live gesture is PROPOSING — fired on every snap, and once
   * more with the original interval when a gesture is cancelled.
   *
   * A draft, never a write. The caller that answers it by feeding the new
   * interval back through `columns` takes ownership of the picture; a caller
   * that ignores it still sees the block track the finger, because the grid
   * holds its own draft until the incoming event disagrees with it.
   */
  readonly draftChanged = output<GridDraft>();

  /**
   * A gesture ENDED on a value different from the one it started at.
   *
   * A keyboard step fires this too: a key press is a whole gesture,
   * press and release, and there is nothing left to wait for.
   */
  readonly draftCommitted = output<GridCommit>();

  /**
   * The visible span: midnight to midnight, snapped out to whole hours.
   *
   * It only ever GROWS — a 23:30 cut that ends at 00:15 belongs to the day it
   * started on (the seat's own start day owns the row), so the axis stretches
   * to hold it rather than wrapping it round to the top.
   *
   * `empty` now means "there are no columns", not "there is nothing booked".
   * A day with columns always has an axis; whether anything is on it is a
   * different question, and the muted shading answers it.
   */
  protected readonly extent = computed(() => {
    const columns = this.columns();
    if (columns.length === 0) {
      return { start: 0, end: 0, minutes: 0, empty: true };
    }
    // An asked-for window replaces the derived axis outright — the frame is
    // showing a neighbourhood, and the hours either side of it are not
    // "closed", they are not being drawn.
    const window = this.uiWindow();
    if (window !== null) {
      const start = Math.max(0, Math.floor(window.startMinute / 60) * 60);
      const end = Math.max(start + 60, Math.ceil(window.endMinute / 60) * 60);
      return { start, end, minutes: end - start, empty: false };
    }
    const ends = columns
      .flatMap((column) => column.events)
      .map((event) => event.endMinute);
    const end = Math.ceil(Math.max(DAY_MINUTES, ...ends) / 60) * 60;
    return { start: 0, end, minutes: end, empty: false };
  });

  /** The hour labels down the leading edge. */
  protected readonly hours = computed(() => {
    const { start, end, empty } = this.extent();
    if (empty) return [];
    /*
     * The CLOSING boundary gets no label in a frame.
     *
     * The gutter lays its labels out as hour-tall rows, so a label on the last
     * line is a whole extra hour of box — and the body's row sizes to the
     * tallest of its cells, which drags the columns up to that height too.
     * The page can afford the blank hour (it falls under the action bar's own
     * padding) and would notice losing its midnight label. A 240px window
     * cannot afford either: a quarter of it would be empty, and the axis box
     * would stop being the same length as the axis.
     */
    const last = this.framed() ? end - 60 : end;
    const out: { readonly key: number; readonly label: string }[] = [];
    for (let at = start; at <= last; at += 60) {
      out.push({ key: at, label: hourLabel(at) });
    }
    return out;
  });

  /** Total 15-minute rows — the CSS grid's track count. */
  protected readonly slotCount = computed(() =>
    Math.ceil(this.extent().minutes / MINUTES_PER_SLOT),
  );

  protected readonly placedColumns = computed(() => {
    const { start, end, minutes, empty } = this.extent();
    const placement = this.uiPlacement();
    const draft = this.draft();
    const editableId = this.editableId();
    const { drawn, ghosted } = this.cappedColumns();
    return drawn.map((column) => {
      // The draft replaces the caller's interval BY ID, with absolute values,
      // so re-applying one the caller has already accepted is a no-op rather
      // than a second displacement.
      const events =
        draft === null
          ? column.events
          : column.events.map((event) =>
              event.id === draft.id
                ? {
                    ...event,
                    startMinute: draft.startMinute,
                    endMinute: draft.endMinute,
                  }
                : event,
            );
      const placed = empty ? [] : place(events, start, end, minutes, placement);
      return {
        ...column,
        placed,
        closed: empty ? [] : closedRuns(column.open, start, end),
        // Only ever non-empty on the opened chair, because the cap collapses
        // to a single drawn column the moment anything is ghosted.
        ghosts: empty ? [] : ghostBlocks(ghosted, start, minutes),
        editable:
          editableId === null
            ? null
            : (placed.find((event) => event.id === editableId) ?? null),
      };
    });
  });

  /* ── Chair columns, and the cap that keeps them legible ───────────── */

  /**
   * How many chairs may be drawn side by side before the frame stops
   * columning them.
   *
   * The page is uncapped: it is the screen, it scrolls sideways, and a week
   * of seven columns is the thing it exists to draw. Only the frame — a
   * control inside a sheet, with no sideways scroll to spend — has a ceiling.
   */
  protected readonly columnCap = computed(() =>
    this.framed()
      ? this.wideFrame()
        ? WIDE_COLUMN_CAP
        : NARROW_COLUMN_CAP
      : Number.POSITIVE_INFINITY,
  );

  /**
   * The columns that get drawn, and the ones that degrade to ghosts.
   *
   * Over the cap the frame does NOT pick two chairs out of four and hope it
   * chose the interesting ones: the chair the sheet was opened at keeps its
   * column and every other one is drawn inside it, named in words. Which
   * chair was opened is knowable — it is the one holding the editable block —
   * and the first column is the fallback when nothing is editable.
   */
  private readonly cappedColumns = computed(() => {
    const columns = this.columns();
    const cap = this.columnCap();
    if (columns.length <= cap) {
      return { drawn: columns, ghosted: [] as readonly GridColumn[] };
    }
    const id = this.uiEditableEventId();
    const opened = Math.max(
      0,
      columns.findIndex((column) =>
        column.events.some((event) => event.id === id),
      ),
    );
    return {
      drawn: columns.slice(opened, opened + 1),
      ghosted: columns.filter((_, index) => index !== opened),
    };
  });

  /**
   * Is the frame wide enough for four columns?
   *
   * Measured on the frame's OWN box, not the viewport: the same 900px screen
   * holds a full-bleed sheet on a tablet and a 480px dialog on a desktop, and
   * it is the box the columns divide that decides whether a name fits. The
   * viewport is the fallback for an engine with no `ResizeObserver`, which is
   * the same question asked one box out.
   */
  private readonly wideFrame = signal(false);

  /** The frame is a control inside a sheet rather than the page itself. */
  protected readonly framed = computed(() => this.uiViewport() === 'framed');

  /**
   * The column head band — names, dates, the zone.
   *
   * Page furniture: the frame draws one column, the sheet's own header
   * already names whose chair it is, and the zone is a shop-wide setting
   * nobody changes mid-edit.
   */
  protected readonly showsHead = computed(() => !this.framed());

  /** The sticky band exists only if something is in it. */
  protected readonly showsChrome = computed(
    () => this.showsHead() || this.hasAllDay(),
  );

  /** A whole positive number of minutes — the pitch CSS is handed. */
  protected readonly snapMinutes = computed(() =>
    Math.max(1, Math.round(this.uiSnapMinutes())),
  );

  /**
   * Draw the now-line at all?
   *
   * Only when TODAY is one of the columns. Browsing next week, a rule saying
   * "now" across Tuesday the 18th marks an hour that has not happened — the
   * indicator would be pointing at nothing.
   */
  protected readonly showsNow = computed(
    () => this.nowOffset() !== null && this.columns().some((c) => c.isToday),
  );

  /**
   * The line's position as a UNITLESS FRACTION of the extent (0–1).
   *
   * Not a percentage: the line and its label live in two different boxes, and
   * a fraction is the only form both can convert from without one of them
   * silently measuring against the wrong height.
   */
  protected readonly nowFraction = computed(() => {
    const offset = this.nowOffset();
    return offset === null ? 0 : offset / 100;
  });

  /** Where the now-line sits, as a fraction of the extent. `null` if outside. */
  protected readonly nowOffset = computed(() => {
    const now = this.nowMinute();
    const { start, end, empty } = this.extent();
    if (now === null || empty || now < start || now > end) return null;
    return ((now - start) / (end - start)) * 100;
  });

  /** Does any column carry an all-day entry? The row costs nothing if not. */
  protected readonly hasAllDay = computed(() => {
    // `allDayAlways` is a PAGE argument: an always-present empty row stops the
    // hours below it jumping as you page between days. In a 240px frame the
    // same empty row spends a tenth of the window saying nothing, so the
    // frame's row appears only when it has content — a closure, a day off.
    // The row itself is not dropped: a whole-day fact has no start and no end
    // and would be a 24-hour rectangle under two handles that refuse to move.
    const always = this.allDayAlways() && !this.framed();
    return (
      always ||
      this.columns().some(
        (column) => (this.allDay()[column.id] ?? []).length > 0,
      )
    );
  });

  protected allDayFor(columnId: string): readonly string[] {
    return this.allDay()[columnId] ?? [];
  }

  protected pick(event: GridEvent): void {
    if (event.kind === 'gap') this.gapPicked.emit(event.id);
    else if (event.kind === 'block') this.blockPicked.emit(event.id);
    else this.eventPicked.emit(event.id);
  }

  /* ── The draft, and the gesture that writes it ─────────────────────── */

  /**
   * The proposed interval, and the interval the CALLER was stating when it
   * was proposed.
   *
   * The pair is what makes ownership unambiguous without a subscription: as
   * long as the caller's own event still reads `basis`, it has not answered
   * and the grid draws its own draft; the moment the caller's value moves —
   * because it accepted the draft, clamped it, or refused it outright — the
   * draft is spent and the caller's value is the picture. A held draft can
   * therefore never silently out-vote the truth.
   */
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

  /** The block that takes handles — `null` unless the caller opted in. */
  protected readonly editableId = computed(() =>
    this.uiEditable() ? this.uiEditableEventId() : null,
  );

  protected readonly minMinutes = computed(() =>
    Math.max(1, Math.round(this.uiMinMinutes())),
  );

  /** Which gesture is live, if any. Drives `[data-dragging]`/`[data-moving]`. */
  private readonly gesture = signal<DragKind | null>(null);
  protected readonly dragging = computed(() => this.gesture() !== null);
  protected readonly moving = computed(() => this.gesture() === 'move');
  /** Which handle is under the finger — so only that one lights up. */
  protected readonly draggingEdge = computed(() => {
    const kind = this.gesture();
    if (kind === 'resize-start') return 'start';
    return kind === 'resize-end' ? 'end' : null;
  });

  /** The editable block AS PLACED — draft applied, laned, boxed. */
  protected readonly editableBlock = computed(() => {
    for (const column of this.placedColumns()) {
      if (column.editable !== null) return column.editable;
    }
    return null;
  });

  /**
   * What each handle may be dragged to, as minutes.
   *
   * Published through `aria-valuemin`/`aria-valuemax`, which is the whole
   * keyboard story: `Home`/`End` land exactly on the bound without anyone
   * having to be told a bound is there.
   */
  protected readonly handleBounds = computed(() => {
    const block = this.editableBlock();
    if (block === null) return null;
    const { start, end } = this.extent();
    const floor = this.minMinutes();
    return {
      startMin: start,
      startMax: block.endMinute - floor,
      endMin: block.startMinute + floor,
      endMax: end,
    };
  });

  /**
   * What the draft breaks, if anything — DRAWN AND NAMED, never clamped
   * silently.
   *
   * A barber who parks two clients in one chair knows something the model
   * does not (one in the chair, one under the dryer), and a barber recording
   * a cut that ran past closing is recording what happened. Both are
   * permitted; both are said out loud. Only the duration floor and the drawn
   * extent actually stop a gesture, because outside them there is nothing to
   * draw.
   */
  protected readonly draftVerdict = computed<
    | { readonly kind: 'short'; readonly minutes: number }
    | { readonly kind: 'overlap'; readonly name: string; readonly time: string }
    | { readonly kind: 'outside' }
    | null
  >(() => {
    const block = this.editableBlock();
    if (block === null) return null;
    const floor = this.minMinutes();
    if (block.endMinute - block.startMinute <= floor) {
      return { kind: 'short', minutes: floor };
    }
    const column = this.placedColumns().find((c) => c.editable !== null);
    if (column === undefined) return null;
    for (const other of column.events) {
      // A gap is the ABSENCE of a booking — landing on one is the point of
      // the gesture, not a collision.
      if (other.id === block.id || other.kind === 'gap') continue;
      if (
        other.startMinute < block.endMinute &&
        other.endMinute > block.startMinute
      ) {
        return {
          kind: 'overlap',
          name: other.title,
          time: timeLabel(other.startMinute),
        };
      }
    }
    const inside = column.open.some(
      (window) =>
        block.startMinute >= window.startMinute &&
        block.endMinute <= window.endMinute,
    );
    return inside ? null : { kind: 'outside' };
  });

  protected readonly readoutTone = computed<'destructive' | 'warning' | null>(
    () => {
      const verdict = this.draftVerdict();
      if (verdict === null) return null;
      return verdict.kind === 'outside' ? 'warning' : 'destructive';
    },
  );

  /**
   * Where the readout hangs, and on which side.
   *
   * Pinned to the block's edge OPPOSITE the handle under the finger, because
   * finger occlusion is physical. A body drag puts the finger in the middle
   * and has no far edge to hide behind, so it takes the start edge — the same
   * edge the pill's own first number names.
   */
  protected readonly readoutAnchor = computed(() => {
    const kind = this.gesture();
    const block = this.editableBlock();
    if (kind === null || block === null) return null;
    if (block.top === null || block.height === null) return null;
    return kind === 'resize-start'
      ? { fraction: block.top + block.height, side: 'below' as const }
      : { fraction: block.top, side: 'above' as const };
  });

  /** The numbers: the boundary the gesture moved, and the length it left. */
  protected readonly readoutText = computed(() => {
    const kind = this.gesture();
    const block = this.editableBlock();
    if (kind === null || block === null) return '';
    const length = this.lengthText(block.endMinute - block.startMinute);
    if (kind === 'move') {
      // BOTH boundaries, always: a move changed both and kept the duration,
      // so naming one edge would hide the other.
      return `${timeLabel(block.startMinute)} – ${timeLabel(block.endMinute)} · ${length}`;
    }
    const edge = kind === 'resize-start' ? block.startMinute : block.endMinute;
    return `${timeLabel(edge)} · ${length}`;
  });

  /** The words: the neighbour, the shift, the floor. Silent when legal. */
  protected readonly readoutNote = computed(() => {
    const verdict = this.draftVerdict();
    const copy = this.uiDragCopy();
    if (verdict === null) return '';
    if (verdict.kind === 'short') {
      return fill(copy.tooShort, { minutes: verdict.minutes });
    }
    if (verdict.kind === 'outside') return copy.outside;
    return (
      fill(copy.overlap, { name: verdict.name, time: verdict.time }) ||
      `${verdict.name} ${verdict.time}`
    );
  });

  /** `aria-valuetext` — the same sentence the pill draws, for a reader. */
  protected handleText(edge: 'start' | 'end'): string {
    const block = this.editableBlock();
    if (block === null) return '';
    const at = edge === 'start' ? block.startMinute : block.endMinute;
    const length = this.lengthText(block.endMinute - block.startMinute);
    const note = this.readoutNote();
    return note === ''
      ? `${timeLabel(at)} · ${length}`
      : `${timeLabel(at)} · ${length}. ${note}`;
  }

  private lengthText(minutes: number): string {
    return fill(this.uiDragCopy().minutes, { minutes }) || String(minutes);
  }

  /* ── Pointer ───────────────────────────────────────────────────────── */

  private drag: DragState | null = null;
  private detachPointer: (() => void) | null = null;

  /**
   * A handle claims its pointer IMMEDIATELY — no threshold.
   *
   * The threshold exists to protect a surface that must still accept taps. A
   * dedicated 44pt handle is unambiguous, and a handle that needed 4px of
   * travel before it moved would feel broken on the first small nudge.
   */
  protected onHandleDown(
    event: PointerEvent,
    edge: 'start' | 'end',
    block: GridDraft,
  ): void {
    this.beginDrag(
      event,
      edge === 'start' ? 'resize-start' : 'resize-end',
      block,
      true,
    );
  }

  /**
   * The block body moves. It is a `<button>`, which is what keeps the sheet's
   * own drag-to-dismiss out of contention for free — `UiSheetBehavior`
   * bails on `closest('button, a')` before it ever reads a coordinate.
   */
  protected onBlockDown(event: PointerEvent, block: GridDraft): void {
    // Only the block under edit drags, and only where it is drawn by minute:
    // a slot-placed block rounds to the quarter hour and could not honour a
    // five-minute snap if it wanted to.
    if (block.id !== this.editableId()) return;
    if (this.editableBlock()?.top === null) return;
    this.beginDrag(event, 'move', block, false);
  }

  private beginDrag(
    event: PointerEvent,
    kind: DragKind,
    block: GridDraft,
    armed: boolean,
  ): void {
    // Non-primary buttons open menus; they do not drag.
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement | null;
    if (target === null) return;
    this.drag = {
      id: block.id,
      kind,
      pointerId: event.pointerId,
      y0: event.clientY,
      scrollTop0: this.frame()?.nativeElement.scrollTop ?? 0,
      startMinute: block.startMinute,
      endMinute: block.endMinute,
      pxPerMinute: this.measurePxPerMinute(),
      target,
      armed: false,
    };
    this.listenForPointer();
    if (armed) this.arm(event);
  }

  private arm(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || drag.armed) return;
    drag.armed = true;
    event.preventDefault();
    // Belt and braces. The sheet already bails on a button, and the frame
    // wants the scroll it is not getting from a captured pointer anyway.
    event.stopPropagation();
    capturePointer(drag.target, drag.pointerId);
    this.gesture.set(drag.kind);
    // Guarded and never load-bearing: `navigator.vibrate` is Android-only in
    // practice and is policy-blocked without a real gesture. The pill carries
    // the whole job on its own.
    buzz(10);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // The frame can scroll under the finger (edge auto-scroll, a wheel), so
    // the delta is measured against the CONTENT, not against the viewport.
    const scrolled =
      (this.frame()?.nativeElement.scrollTop ?? drag.scrollTop0) -
      drag.scrollTop0;
    const dy = event.clientY - drag.y0 + scrolled;
    if (!drag.armed) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      this.arm(event);
    }
    if (event.cancelable) event.preventDefault();
    this.applyDelta(drag, dy);
    // AFTER the delta, never before: this move is measured against the scroll
    // position it started from, and the scroll it causes is picked up by the
    // NEXT move through `scrolled`. That is what makes the block keep
    // travelling while the finger rests near the edge.
    this.edgeScroll(event.clientY);
  }

  /**
   * EDGE AUTO-SCROLL — the thing the delta above has always been written to
   * tolerate and that nothing implemented.
   *
   * It did not matter while the frame drew a hundred minutes: the window was
   * the block plus fifty minutes either side, so `moveTo`'s clamp could not
   * push the block out of the viewport. The window is the whole working day
   * now, and without this a barber moving a ten o'clock to the afternoon
   * drags it straight off the bottom of the box and finishes the gesture with
   * neither the block nor the time readout on screen — `touch-action: none`
   * and the captured pointer mean the browser will not scroll for them.
   *
   * ⚠ **Driven by the FINGER, never by the block.** Scrolling to keep the
   * block visible reads its own output: the scroll feeds `scrolled`, which
   * moves the block, which asks for more scroll. Edge overlap is an input the
   * gesture does not produce, the step is capped per event, and the write is
   * clamped to the scrollable room — so a finger that stops moving stops the
   * scroll, and a finger held at the edge cannot run past the end of the day.
   */
  private edgeScroll(clientY: number): void {
    const frame = this.frame()?.nativeElement;
    if (!frame) return;
    const room = frame.scrollHeight - frame.clientHeight;
    if (room <= 0) return;

    const box = frame.getBoundingClientRect();
    const top = box.top + EDGE_SCROLL_MARGIN_PX;
    const bottom = box.bottom - EDGE_SCROLL_MARGIN_PX;
    const over =
      clientY < top ? clientY - top : clientY > bottom ? clientY - bottom : 0;
    if (over === 0) return;

    const step = clamp(over, -EDGE_SCROLL_STEP_PX, EDGE_SCROLL_STEP_PX);
    frame.scrollTop = clamp(frame.scrollTop + step, 0, room);
  }

  private applyDelta(drag: DragState, dy: number): void {
    const moved = dy / drag.pxPerMinute;
    const snap = this.snapMinutes();
    const next =
      drag.kind === 'move'
        ? this.moveTo(drag, snapTo(drag.startMinute + moved, snap))
        : drag.kind === 'resize-start'
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
    // A drag that armed is never also a tap. Swallowed in the CAPTURE phase
    // so the block's own `(click)` never sees it.
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
      kind: drag.kind === 'move' ? 'move' : 'resize',
    });
  }

  /**
   * `pointercancel` is the iOS case nobody plans for — momentum scroll in an
   * ancestor fires it mid-gesture — and `lostpointercapture` without a
   * preceding `pointerup` is the same outcome by a different route.
   *
   * Both REVERT. Neither is a drop, and there is no third ending: a
   * half-finished time the barber did not choose must never survive.
   */
  private onPointerCancel(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    this.endDrag(drag);
    if (!drag.armed) return;
    this.swallowNextClick();
    this.draftState.set(null);
    // Said out loud, because a caller that tracked every snap has to be told
    // the interval went back rather than being left on the last one.
    this.draftChanged.emit({
      id: drag.id,
      startMinute: drag.startMinute,
      endMinute: drag.endMinute,
    });
  }

  private endDrag(drag: DragState): void {
    this.drag = null;
    this.gesture.set(null);
    this.detachPointer?.();
    releasePointer(drag.target, drag.pointerId);
  }

  /* ── Keyboard ──────────────────────────────────────────────────────── */

  protected onHandleKey(
    event: KeyboardEvent,
    edge: 'start' | 'end',
    block: GridDraft,
  ): void {
    const bounds = this.handleBounds();
    if (bounds === null) return;
    const at = edge === 'start' ? block.startMinute : block.endMinute;
    const to = this.keyTarget(
      event,
      at,
      edge === 'start' ? bounds.startMin : bounds.endMin,
      edge === 'start' ? bounds.startMax : bounds.endMax,
    );
    if (to === null) return;
    event.preventDefault();
    this.step(
      edge === 'start'
        ? this.resizeStartTo(block, to)
        : this.resizeEndTo(block, to),
      'resize',
    );
  }

  /**
   * The block's own vocabulary: the arrows slide the WHOLE interval, and the
   * duration is invariant because the move writes one number.
   *
   * No grab step. A block that has to be grabbed before the arrows work is a
   * mode, and this surface has a typed start field one tab away for anyone
   * who wants an absolute value instead of a nudge.
   */
  protected onBlockKey(event: KeyboardEvent, block: GridDraft): void {
    if (block.id !== this.editableId()) return;
    const { start, end } = this.extent();
    const duration = block.endMinute - block.startMinute;
    const to = this.keyTarget(event, block.startMinute, start, end - duration);
    if (to === null) return;
    event.preventDefault();
    this.step(this.moveTo(block, to), 'move');
  }

  /** Where a key press wants to land, or `null` if the key means nothing. */
  private keyTarget(
    event: KeyboardEvent,
    at: number,
    min: number,
    max: number,
  ): number | null {
    const snap = this.snapMinutes();
    // Shift is the PRECISION escape, not an accelerator: a barber nudging a
    // start by a single minute is the case the quantum cannot serve.
    const step = event.shiftKey ? 1 : snap;
    switch (event.key) {
      case 'ArrowUp':
        return at - step;
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

  /**
   * One keyboard step: a whole gesture, so it publishes AND commits.
   *
   * There is no release to wait for and no revert to offer — `Escape` on a
   * surface with no grab has nothing to cancel, and the draft is still a
   * draft until the sheet's own save.
   */
  private step(next: GridDraft, kind: GridCommit['kind']): void {
    const current = this.draft() ?? this.eventById(next.id);
    if (
      current !== null &&
      current.startMinute === next.startMinute &&
      current.endMinute === next.endMinute
    ) {
      return;
    }
    this.publish(next);
    this.draftCommitted.emit({ ...next, kind });
    buzz(4);
  }

  /* ── The arithmetic every path shares ──────────────────────────────── */

  private moveTo(origin: GridDraft, startMinute: number): GridDraft {
    const { start, end } = this.extent();
    const duration = origin.endMinute - origin.startMinute;
    // Only the DRAWN extent clamps a move: a collision and a shift boundary
    // are both permitted, and both are named instead.
    const at = clamp(startMinute, start, end - duration);
    return { id: origin.id, startMinute: at, endMinute: at + duration };
  }

  private resizeStartTo(origin: GridDraft, startMinute: number): GridDraft {
    const { start } = this.extent();
    const floor = this.minMinutes();
    return {
      id: origin.id,
      // A start dragged past the end CLAMPS; it never inverts.
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

  /**
   * What the CALLER is currently saying about this block.
   *
   * Re-read whenever the held draft is spent, so a second gesture after the
   * caller answered the first measures itself against the answer rather than
   * against a basis that is now history.
   */
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

  /**
   * Pixels per minute, MEASURED.
   *
   * Taken from the block's own box divided by the fraction of the extent it
   * was drawn at, which recovers the extent's full pixel height even when the
   * block is clipped by the window — the fraction is computed from the same
   * clipped span, so the two cancel.
   */
  private measurePxPerMinute(): number {
    const { minutes } = this.extent();
    const block = this.editableBlock();
    const height = block?.height ?? null;
    const element = block === null ? null : this.blockElement(block.id);
    if (element !== null && height !== null && height > 0) {
      const extentPx = element.getBoundingClientRect().height / height;
      if (extentPx > 0 && minutes > 0) return extentPx / minutes;
    }
    return FALLBACK_PX_PER_MINUTE;
  }

  private blockElement(id: string): HTMLElement | null {
    const nodes =
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '.staff-grid__event',
      );
    for (const node of nodes) {
      if (node.dataset['eventId'] === id) return node;
    }
    return null;
  }

  /* ── Plumbing ──────────────────────────────────────────────────────── */

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The move and end listeners live on the DOCUMENT, for the life of one
   * gesture and no longer.
   *
   * Bound in the template they would fire on every pointer that crosses any
   * block — a change-detection pass per mouse move over a week grid, paid for
   * by every reader who is not dragging anything.
   */
  private listenForPointer(): void {
    if (this.detachPointer !== null) return;
    const doc = this.document;
    const move = (event: Event) => this.onPointerMove(event as PointerEvent);
    const up = (event: Event) => this.onPointerUp(event as PointerEvent);
    const cancel = (event: Event) =>
      this.onPointerCancel(event as PointerEvent);
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', cancel);
    doc.addEventListener('lostpointercapture', cancel);
    this.detachPointer = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', cancel);
      doc.removeEventListener('lostpointercapture', cancel);
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
    // A drag that ended off the block leaves no click behind; the listener
    // must not survive to eat the next real one.
    const timer = setTimeout(done, 0);
  }

  private watchFrameWidth(): void {
    const view = this.host.nativeElement.ownerDocument?.defaultView;
    if (!view) return;
    if (typeof view.ResizeObserver === 'function') {
      const observer = new view.ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        // A box with no layout yet is not an answer; leave the standing one.
        if (width > 0) this.wideFrame.set(width >= WIDE_FRAME_PX);
      });
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
      return;
    }
    const query = view.matchMedia?.(`(min-width: ${WIDE_FRAME_PX}px)`);
    if (!query) return;
    this.wideFrame.set(query.matches);
    const listener = (event: MediaQueryListEvent) =>
      this.wideFrame.set(event.matches);
    query.addEventListener?.('change', listener);
    this.destroyRef.onDestroy(() =>
      query.removeEventListener?.('change', listener),
    );
  }

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  /**
   * Where the day should OPEN — now if today is on screen, else the first
   * working minute, else a plain 08:00.
   *
   * Now wins because a schedule is read to answer "what is happening", and on
   * today that answer is at the line. On any other day there is no "now" to
   * anchor to and the first shift is the next best thing.
   */
  private readonly revealMinute = computed(() => {
    const now = this.nowMinute();
    if (now !== null && this.columns().some((column) => column.isToday)) {
      return now;
    }
    const opens = this.columns()
      .flatMap((column) => column.open)
      .map((window) => window.startMinute);
    const roster = this.rosterStartMinute();
    if (opens.length > 0) return Math.min(...opens);
    return roster ?? 8 * 60;
  });

  /**
   * The set of columns on screen, as one string.
   *
   * The reveal fires on a change of DAY, VIEW or SCOPE — all three of which
   * change which columns exist — and on nothing else. Keying it on the data
   * instead would yank the grid back under the reader's thumb every time a
   * booking updated, which is the behaviour every calendar that does this is
   * rightly complained about for.
   */
  private readonly columnSignature = computed(() =>
    this.columns()
      .map((column) => column.id)
      .join('|'),
  );

  private revealed: string | null = null;
  /** The edited block this frame has already centred on. Latched by id. */
  private centred: string | null = null;
  private centring = false;

  constructor() {
    // Field-initialised effects read as unused to the compiler; the
    // constructor is where an effect kept only for its side effect belongs.
    effect(() => this.revealWorkingDay());
    effect(() => this.centreOnEditable());
    this.watchFrameWidth();
    // A sheet dismissed mid-drag does not end the gesture — it ends the
    // component. The document listeners have to go with it.
    this.destroyRef.onDestroy(() => this.detachPointer?.());
  }

  private revealWorkingDay(): void {
    // Never in a frame. The reveal is keyed on which columns exist, and a
    // frame keeps one column while its WINDOW moves — so the guard never
    // fires again and every scroll the reader made would be yanked back the
    // moment the window shifted under a drag. A frame that opens on its own
    // block scrolls itself, from the surface that knows which block that is.
    if (this.framed()) return;
    const signature = this.columnSignature();
    const frame = this.frame()?.nativeElement;
    const body = this.body()?.nativeElement;
    const { minutes, empty } = this.extent();
    if (!frame || !body || empty || signature === this.revealed) return;
    this.revealed = signature;

    const target = this.revealMinute();
    const height = body.offsetHeight;
    if (height === 0) {
      // Laid out but not measured yet (a hidden tab, a font still loading).
      // Leave `revealed` unset so the next pass tries again rather than
      // recording a scroll that never happened.
      this.revealed = null;
      return;
    }
    // The target lands a QUARTER down the viewport, not at its top edge.
    //
    // Flush to the top, "now" arrived with the whole morning already scrolled
    // away and nothing but shut hours below it — technically the right minute
    // and the wrong view of the day. A quarter leaves roughly two hours of
    // what just happened above the line, which is the window a shop is
    // actually still acting on (a running late, an unsettled visit), and
    // still gives three-quarters of the box to what is coming.
    const bodyOffset =
      body.getBoundingClientRect().top - frame.getBoundingClientRect().top;
    const targetPx = ((target - this.extent().start) / minutes) * height;
    frame.scrollTop = Math.max(
      0,
      frame.scrollTop + bodyOffset + targetPx - frame.clientHeight * 0.25,
    );
  }

  /**
   * THE FRAME OPENS ON ITS OWN BLOCK, CENTRED — the other half of the promise
   * `revealWorkingDay` makes when it refuses to scroll a frame.
   *
   * The window is the whole working day now, so the block is one screen of
   * many and landing at the window's origin would open the sheet on an empty
   * morning. Centred rather than a quarter down, unlike the page: the page
   * reveals a MOMENT ("now") with the past above it, and a frame reveals a
   * SUBJECT — equal context on both sides is what lets a barber see who is
   * before and after in one look.
   *
   * ⚠ **Tracked reads are exactly `uiEditableEventId` and `uiViewport`, and
   * that is load-bearing.** Centring on anything the draft touches — the
   * columns, the extent, the block's own interval — re-centres on every snap
   * of a drag: the block moves in pixels under a finger that has not moved,
   * the pointer handler reads a different minute from the same position and
   * publishes again. That is the feedback loop `frameWindow` already carries
   * a warning about in the editor, and it pins a CPU. The latch makes this
   * once per appointment; a drag never changes the appointment's id.
   */
  private centreOnEditable(): void {
    const id = this.uiEditableEventId();
    const framed = this.framed();
    if (!framed || id === null) return;
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
    // BOUNDED, and that is the whole point of counting frames: the sheet
    // animates open, so the first passes measure a box that has no height
    // and no block in it yet. Ten frames is about a sixth of a second and
    // cannot outlive the transition — an unbounded retry here would be an
    // infinite loop wearing a requestAnimationFrame costume.
    let attempts = 0;
    const tick = (): void => {
      attempts += 1;
      if (this.applyCentre(id)) {
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

  /** `true` once the scroll actually happened; `false` asks for another frame. */
  private applyCentre(id: string): boolean {
    // A gesture owns the scroll while it runs. Yanking the box mid-drag is
    // the one thing this must never do.
    if (this.gesture() !== null) return false;
    const frame = this.frame()?.nativeElement;
    const block = this.blockElement(id);
    if (!frame || !block || frame.clientHeight === 0) return false;

    const box = frame.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    // Relative to where the box is scrolled RIGHT NOW, so the arithmetic is
    // correct whatever a previous pass left behind — and clamped, because a
    // window shorter than the viewport has nowhere to scroll and an
    // unclamped write would land short of centre without saying so.
    const middle = rect.top - box.top + rect.height / 2;
    frame.scrollTop = clamp(
      frame.scrollTop + middle - frame.clientHeight / 2,
      0,
      frame.scrollHeight - frame.clientHeight,
    );
    return true;
  }
}

/**
 * The stretches of `[start, end)` that fall OUTSIDE this column's working
 * windows, as grid rows.
 *
 * Runs rather than per-slot cells: one shut morning is one element, so a
 * 96-slot day costs two or three boxes per column instead of ninety-six.
 * Windows are sorted and merged first — a caller with a split shift may hand
 * them over in any order, and an unsorted pair would carve a "closed" band
 * through the middle of an open day.
 */
function closedRuns(
  open: readonly OpenWindow[],
  start: number,
  end: number,
): readonly ClosedRun[] {
  const windows = open
    // CLAMPED to the drawn hours first. A run is emitted as a `grid-row`
    // against the extent's own track, so a shift that reaches outside it — a
    // lunch break at 13:00 when the frame is drawing 09:00–12:00 — asked for
    // rows the column does not have, and the browser invented them: the
    // column grew an hour past its axis and every proportional placement in
    // it drifted. A no-op on the page, where the extent is the whole day.
    .map((w) => ({
      startMinute: Math.max(w.startMinute, start),
      endMinute: Math.min(w.endMinute, end),
    }))
    .filter((w) => w.endMinute > w.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);

  const runs: ClosedRun[] = [];
  let cursor = start;
  for (const window of windows) {
    // Overlapping or touching windows collapse instead of back-tracking the
    // cursor, which would emit a negative-height run.
    if (window.startMinute > cursor) {
      runs.push(run(cursor, window.startMinute, start));
    }
    cursor = Math.max(cursor, window.endMinute);
  }
  if (cursor < end) runs.push(run(cursor, end, start));
  return runs;
}

function run(from: number, to: number, origin: number): ClosedRun {
  const startSlot = Math.floor((from - origin) / MINUTES_PER_SLOT);
  const endSlot = Math.ceil((to - origin) / MINUTES_PER_SLOT);
  return {
    key: `${from}-${to}`,
    // +1: CSS grid lines are 1-based.
    row: `${startSlot + 1} / ${Math.max(startSlot + 2, endSlot + 1)}`,
  };
}

/**
 * `540` → `"09:00"`.
 *
 * 24-hour, always: Bulgaria writes times that way, and a grid graded on being
 * scannable cannot spend two characters on am/pm. No `Intl` call — the input
 * is already a wall-clock offset, so formatting it through a timezone would
 * be converting a number that was never an instant.
 */
function hourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * `635` → `"10:35"`.
 *
 * `% 24` for the same reason the axis grows rather than wraps: a cut that
 * ends at minute 1455 ends at 00:15, not at 24:15.
 */
function timeLabel(minute: number): string {
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
function fill(
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

function clamp(value: number, min: number, max: number): number {
  // `min` last: on a block longer than the extent the two bounds cross, and
  // the near edge is the honest answer.
  return Math.max(min, Math.min(max, value));
}

/** The snap quantum, applied ABSOLUTELY — the number that shows is on-grid. */
function snapTo(minute: number, snap: number): number {
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
function buzz(pattern: number): void {
  try {
    globalThis.navigator?.vibrate?.(pattern);
  } catch {
    // A policy-blocked vibrate throws on some engines. It is decoration.
  }
}

function capturePointer(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Capture is an optimisation: without it the document listeners still
    // receive the whole gesture. An engine that refuses it loses nothing.
  }
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Already released, or never captured.
  }
}

/**
 * The chairs the cap could not draw, as outlined blocks inside the one it
 * did.
 *
 * Named in WORDS — `Иван · 10:35` — because the tone alone is a 7% tint that
 * a barber in a bright shop may not see at all, and the whole point of the
 * degradation is that a party across two chairs stays legible.
 */
function ghostBlocks(
  columns: readonly GridColumn[],
  originMinute: number,
  extentMinutes: number,
): readonly GhostBlock[] {
  if (columns.length === 0 || extentMinutes <= 0) return [];
  const out: GhostBlock[] = [];
  for (const column of columns) {
    for (const event of column.events) {
      if (
        event.endMinute <= originMinute ||
        event.startMinute >= originMinute + extentMinutes
      ) {
        continue;
      }
      const box = proportionalBox(event, originMinute, extentMinutes);
      out.push({
        key: `${column.id}:${event.id}`,
        top: box.top ?? 0,
        height: box.height ?? 0,
        tone: event.barberTone ?? null,
        label: `${column.title} · ${timeLabel(event.startMinute)}`,
      });
    }
  }
  return out;
}

/**
 * Place a column's events on the minute track, side-by-side where they
 * genuinely overlap.
 *
 * Overlap is real here rather than defensive: a party is one appointment with
 * several seats, and in the day view two of those seats can sit in the same
 * chair's column back-to-back — but in the WEEK view, where a column is a day
 * and every chair is merged, simultaneous blocks are the normal case.
 */
function place(
  events: readonly GridEvent[],
  originMinute: number,
  endMinute: number,
  extentMinutes: number,
  placement: Placement,
): readonly PlacedEvent[] {
  const proportional = placement === 'proportional';
  // Under a clamped window a block can sit entirely outside the drawn hours.
  // Dropped rather than clamped to a sliver: a zero-height box still takes
  // the minimum height and would advertise a booking at the edge that is not
  // there. Dropped BEFORE the packer runs, so an off-screen block cannot
  // narrow a lane on screen either.
  const visible = proportional
    ? events.filter(
        (event) =>
          event.endMinute > originMinute && event.startMinute < endMinute,
      )
    : events;
  const sorted = [...visible].sort((a, b) => a.startMinute - b.startMinute);
  // A cluster is a run of events that transitively overlap; lanes are only
  // ever shared within one, so a busy morning cannot narrow a quiet afternoon.
  const clusters: GridEvent[][] = [];
  let current: GridEvent[] = [];
  let clusterEnd = -Infinity;
  for (const event of sorted) {
    if (current.length > 0 && event.startMinute >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinute);
  }
  if (current.length > 0) clusters.push(current);

  const placed: PlacedEvent[] = [];
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assigned = cluster.map((event) => {
      let lane = laneEnds.findIndex((end) => end <= event.startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(event.endMinute);
      } else {
        laneEnds[lane] = event.endMinute;
      }
      return { event, lane };
    });
    for (const { event, lane } of assigned) {
      placed.push({
        ...event,
        ...(proportional
          ? proportionalBox(event, originMinute, extentMinutes)
          : slotBox(event, originMinute)),
        lane,
        lanes: laneEnds.length,
        short: event.endMinute - event.startMinute < SHORT_BLOCK_MINUTES,
      });
    }
  }
  return placed;
}

/**
 * A block ROUNDED OUTWARD to the 15-minute track — the page grid's placement
 * since it shipped, untouched.
 *
 * The rounding is a feature at page scale: a slot is 28px, so a block that
 * met the minute exactly would sit a few pixels off the rules the eye is
 * already following. It is a defect at frame scale, which is what the other
 * branch exists for.
 */
function slotBox(
  event: GridEvent,
  originMinute: number,
): Pick<PlacedEvent, 'row' | 'top' | 'height'> {
  const startSlot = Math.floor(
    (event.startMinute - originMinute) / MINUTES_PER_SLOT,
  );
  const endSlot = Math.ceil(
    (event.endMinute - originMinute) / MINUTES_PER_SLOT,
  );
  return {
    // +1: CSS grid lines are 1-based.
    row: `${startSlot + 1} / ${Math.max(startSlot + 2, endSlot + 1)}`,
    top: null,
    height: null,
  };
}

/**
 * A block placed by PERCENTAGE of the extent, so 10:05 draws at 10:05.
 *
 * Clamped to the drawn hours at both ends: a neighbour that starts before the
 * window shows the part of itself that is inside it, which is the truth —
 * the block continues, the frame does not.
 */
function proportionalBox(
  event: GridEvent,
  originMinute: number,
  extentMinutes: number,
): Pick<PlacedEvent, 'row' | 'top' | 'height'> {
  const from = Math.max(event.startMinute, originMinute);
  const to = Math.min(event.endMinute, originMinute + extentMinutes);
  return {
    row: null,
    top: fraction((from - originMinute) / extentMinutes),
    height: fraction(Math.max(0, to - from) / extentMinutes),
  };
}

/**
 * Six places is a hundredth of a pixel on any frame anyone will draw, and it
 * keeps a full-precision float out of the style attribute.
 */
function fraction(value: number): number {
  return Number(value.toFixed(6));
}
