import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  input,
  output,
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

/** A muted stretch — the hours this column is shut, on the grid's own track. */
interface ClosedRun {
  readonly key: string;
  readonly row: string;
}

/** A block laid out against the grid's own minute track. */
interface PlacedEvent extends GridEvent {
  readonly row: string;
  /** Side-by-side placement for blocks that genuinely overlap. */
  readonly lane: number;
  readonly lanes: number;
  readonly short: boolean;
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

  readonly zonePicked = output<void>();
  readonly eventPicked = output<string>();
  readonly gapPicked = output<string>();
  /** A break or admin block was tapped — the parent owns what that opens. */
  readonly blockPicked = output<string>();

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
    const out: { readonly key: number; readonly label: string }[] = [];
    for (let at = start; at <= end; at += 60) {
      out.push({ key: at, label: hourLabel(at) });
    }
    return out;
  });

  /** Total 15-minute rows — the CSS grid's track count. */
  protected readonly slotCount = computed(() =>
    Math.ceil(this.extent().minutes / MINUTES_PER_SLOT),
  );

  protected readonly placedColumns = computed(() => {
    const { start, end, empty } = this.extent();
    return this.columns().map((column) => ({
      ...column,
      placed: empty ? [] : place(column.events, start),
      closed: empty ? [] : closedRuns(column.open, start, end),
    }));
  });

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
  protected readonly hasAllDay = computed(
    () =>
      this.allDayAlways() ||
      this.columns().some(
        (column) => (this.allDay()[column.id] ?? []).length > 0,
      ),
  );

  protected allDayFor(columnId: string): readonly string[] {
    return this.allDay()[columnId] ?? [];
  }

  protected pick(event: GridEvent): void {
    if (event.kind === 'gap') this.gapPicked.emit(event.id);
    else if (event.kind === 'block') this.blockPicked.emit(event.id);
    else this.eventPicked.emit(event.id);
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

  constructor() {
    // Field-initialised effects read as unused to the compiler; the
    // constructor is where an effect kept only for its side effect belongs.
    effect(() => this.revealWorkingDay());
  }

  private revealWorkingDay(): void {
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
  const windows = [...open]
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
): readonly PlacedEvent[] {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute);
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
      const startSlot = Math.floor(
        (event.startMinute - originMinute) / MINUTES_PER_SLOT,
      );
      const endSlot = Math.ceil(
        (event.endMinute - originMinute) / MINUTES_PER_SLOT,
      );
      placed.push({
        ...event,
        // +1: CSS grid lines are 1-based.
        row: `${startSlot + 1} / ${Math.max(startSlot + 2, endSlot + 1)}`,
        lane,
        lanes: laneEnds.length,
        short: event.endMinute - event.startMinute < SHORT_BLOCK_MINUTES,
      });
    }
  }
  return placed;
}
