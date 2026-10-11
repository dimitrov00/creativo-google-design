import { BookingStatus } from '../components/booking-lifecycle.data';
import { MinuteRange } from '../components/minute-range.data';
import { Seat } from '../components/seat.data';
import type { ShopNow } from '../components/shop-now.data';
import type { Appointment } from '../entities/appointment.entity';
import { MinuteCount } from '../primitives/duration-minutes.primitive';
import type { BarberId } from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import { EndMinute, MinuteOfDay } from '../primitives/minute-of-day.primitive';
import { IntervalSetSystem } from './interval-set.system';

/**
 * The shortest hole the staff run calls a gap (`staff-day.store.ts:126`).
 * Not the 15-minute reporting floor: below 20 a lane becomes a ladder of
 * booking/gap/booking and the three-second read is gone. Under the shop's
 * shortest service and over its turnaround.
 */
const SHORTEST_SELLABLE_MINUTES = 20;

/** What a block in a grid column is — the field `gridEvent`, the ONLY source of these strings. */
export const GridEvent = {
  /** A booking. */
  Visit: 'VISIT',
  /** A sellable hole — the ABSENCE of a booking, never a collision. */
  Gap: 'GAP',
  /** Time carved OUT of the worked day (a break, an admin hour). */
  Block: 'BLOCK',
} as const;
export type GridEvent = (typeof GridEvent)[keyof typeof GridEvent];

/**
 * A seat as the occupancy reads it — a `Seat` satisfies it as is: its
 * barber, its start on the appointment's shop day and its snapshotted
 * minutes (the flat terms, flatten-spec §3.2).
 */
export type OccupyingSeat = Pick<
  Seat,
  | 'barberId'
  | 'startMinutes'
  | 'durationMinutes'
  | 'setupMinutes'
  | 'cleanupMinutes'
>;

/** A visit as the occupancy reads it — an `Appointment` of the day satisfies it. */
export type OccupyingVisit = Pick<Appointment, 'bookingStatus'> & {
  readonly seats: readonly OccupyingSeat[];
};

/**
 * One hole in a chair's rostered day, on one side of the clock. The same
 * hole is inventory before now and a record after it: `sellable` is the
 * piece still ahead of the clock. Local coordinates of the lane's shop day.
 */
export type LaneGap = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly minutes: MinuteCount;
  readonly sellable: boolean;
};

/** A stretch of a column's minute track, `[startMinutes, endMinutes)` from the shop's midnight. */
export type MinuteRun = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** A block of a grid column, as the sweep reads it. */
export type RunEvent = {
  readonly id: string;
  readonly gridEvent: GridEvent;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/**
 * What is true of PARTS of one block: the stretches outside the column's
 * open windows, and the stretches another booking shares — each merged, in
 * order, in minutes of the day.
 */
export type EventRuns = {
  readonly outside: readonly MinuteRun[];
  readonly overlap: readonly MinuteRun[];
};

/** Side-by-side placement inside a cluster of transitively-overlapping blocks. */
export type LaneSlot = {
  readonly lane: number;
  readonly lanes: number;
};

const NO_RUNS: readonly MinuteRun[] = [];
const NO_EVENT_RUNS: EventRuns = { outside: NO_RUNS, overlap: NO_RUNS };

/**
 * A start this file computed on one shop day's track (a cursor, a clamp, the
 * clock's minute) — inside `[0, 1440)` by construction; anything else is a
 * broken invariant, not an input.
 */
function startOf(minutes: number): MinuteOfDay {
  return MinuteOfDay.ofProven(minutes);
}

/** An exclusive end this file computed — inside `(0, 1440]` by construction. */
function endOf(minutes: number): EndMinute {
  return EndMinute.ofProven(minutes);
}

/** A run between two computed track minutes. */
function runOf(startMinutes: number, endMinutes: number): MinuteRun {
  return { startMinutes: startOf(startMinutes), endMinutes: endOf(endMinutes) };
}

/** `order` sorted by the events' start, input order breaking ties. */
function byStart(
  events: readonly { readonly startMinutes: number }[],
): readonly number[] {
  const order: number[] = [];
  for (let i = 0; i < events.length; i++) order.push(i);
  order.sort(
    (a, b) =>
      (events[a] as { readonly startMinutes: number }).startMinutes -
        (events[b] as { readonly startMinutes: number }).startMinutes || a - b,
  );
  return order;
}

/**
 * GridLayoutSystem — the staff schedule's geometry: minutes, ids and tags,
 * never words (`staff-day.store.ts:282-348`,
 * `time-grid/staff-time-grid.ts:2224-2350,2421-2490`). Every figure is on
 * ONE shop day's wall clock (Law 7.3, flatten-spec T1): a lane is a barber's
 * `localDate`, its spans `MinuteRange`s, "now" the shop's `ShopNow` — no
 * instant, no zone, so a 23- or 25-hour day needs no case of its own.
 *
 * **Hot path #3.** The row fold ({@link occupiedIntervals}, {@link holes})
 * takes no clock and re-runs on data change only; the minute tick reaches
 * {@link sellableAt} alone. **Sorted sweeps:** a column's events are sorted
 * once by start and its open windows once by start, and {@link columnRuns}
 * emits the merged outside and overlap runs of every block in one pass —
 * the legacy per-block scan compared every block with every sibling and
 * re-sorted the windows on every call.
 */
export const GridLayoutSystem = {
  SHORTEST_SELLABLE_MINUTES,

  /* ── The chair's day, on the shop's clock ───────────────────────────── */

  /**
   * What actually occupied a chair on one shop day: `busy` plus every seat
   * of this barber's on a visit of that day that was not cancelled, padded
   * by the seat's own setup and cleanup (`Seat.chairTime`, clipped to the
   * day) — the same envelope the busy projection writes, so the two sources
   * coincide wherever both exist. A cancelled visit contributes nothing (the
   * chair genuinely went empty); a no-show did occupy it. Normalized:
   * sorted, disjoint, touching runs merged.
   */
  occupiedIntervals(
    appointments: readonly OccupyingVisit[],
    barberId: BarberId,
    busy: readonly MinuteRange[],
  ): readonly MinuteRange[] {
    const all: MinuteRange[] = [];
    for (let i = 0; i < busy.length; i++) all.push(busy[i] as MinuteRange);
    for (let a = 0; a < appointments.length; a++) {
      const appointment = appointments[a] as OccupyingVisit;
      if (appointment.bookingStatus === BookingStatus.Cancelled) continue;
      for (let s = 0; s < appointment.seats.length; s++) {
        const seat = appointment.seats[s] as OccupyingSeat;
        if (seat.barberId !== barberId) continue;
        all.push(Seat.chairTime(seat));
      }
    }
    return IntervalSetSystem.normalize(all);
  },

  /** Rostered time minus what is taken — every hole in the chair's day. No clock. */
  holes(
    rostered: readonly MinuteRange[],
    occupied: readonly MinuteRange[],
  ): readonly MinuteRange[] {
    if (rostered.length === 0) return [];
    return IntervalSetSystem.subtract(rostered, occupied);
  },

  /**
   * The holes of the lane's shop day `localDate`, SPLIT AT NOW and then
   * floored — never the other way round: flooring first would let a
   * 105-minute hole with five minutes left on it emit a "5 min free" gap.
   * Pieces under {@link SHORTEST_SELLABLE_MINUTES} are dropped, not drawn
   * quieter. Only time still ahead can be filled, so a piece ending at or
   * before now is a record (`sellable: false`), drawn so an idle morning is
   * not mistaken for a booked one. "Now" is the shop's (`now.localDate` +
   * `now.currentMinute`, T1): a day before today is wholly past, a day after
   * it wholly ahead, and today splits at the current minute.
   */
  sellableAt(
    holes: readonly MinuteRange[],
    now: ShopNow,
    localDate: LocalDate,
  ): readonly LaneGap[] {
    const day = LocalDate.compare(localDate, now.localDate);
    const out: LaneGap[] = [];
    const push = (start: number, end: number): void => {
      const startMinutes = startOf(start);
      const endMinutes = endOf(end);
      const minutes = MinuteCount.span(startMinutes, endMinutes);
      if (minutes < SHORTEST_SELLABLE_MINUTES) return;
      out.push({
        startMinutes,
        endMinutes,
        minutes,
        sellable: day > 0 || (day === 0 && end > now.currentMinute),
      });
    };
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i] as MinuteRange;
      const cut = now.currentMinute;
      if (day === 0 && hole.startMinutes < cut && cut < hole.endMinutes) {
        push(hole.startMinutes, cut);
        push(cut, hole.endMinutes);
      } else {
        push(hole.startMinutes, hole.endMinutes);
      }
    }
    return out;
  },

  /** {@link holes} then {@link sellableAt} — the legacy one-call form. */
  laneGaps(
    rostered: readonly MinuteRange[],
    occupied: readonly MinuteRange[],
    now: ShopNow,
    localDate: LocalDate,
  ): readonly LaneGap[] {
    return GridLayoutSystem.sellableAt(
      GridLayoutSystem.holes(rostered, occupied),
      now,
      localDate,
    );
  },

  /* ── A column's minute track ────────────────────────────────────────── */

  /**
   * The stretches of `[start, end)` that fall OUTSIDE a column's working
   * windows. Windows are clamped to the drawn span first (a shift reaching
   * outside it must not ask for minutes the column does not have), sorted,
   * and overlapping or touching windows collapse instead of back-tracking
   * the cursor. An empty window list is the whole span: shut all day.
   */
  closedRuns(
    open: readonly MinuteRun[],
    start: MinuteOfDay,
    end: EndMinute,
  ): readonly MinuteRun[] {
    const windows: { readonly from: number; readonly to: number }[] = [];
    for (let i = 0; i < open.length; i++) {
      const window = open[i] as MinuteRun;
      const from = Math.max(window.startMinutes, start);
      const to = Math.min(window.endMinutes, end);
      if (to > from) windows.push({ from, to });
    }
    windows.sort((a, b) => a.from - b.from);
    const runs: MinuteRun[] = [];
    let cursor: number = start;
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i] as {
        readonly from: number;
        readonly to: number;
      };
      if (window.from > cursor) runs.push(runOf(cursor, window.from));
      cursor = Math.max(cursor, window.to);
    }
    if (cursor < end) runs.push(runOf(cursor, end));
    return runs;
  },

  /**
   * Every block's outside and overlap runs, parallel to `events`, in ONE
   * sweep over the column: the events sorted once by start, the windows once
   * by start.
   *
   * - **outside** — the stretches no window covers. A block with no length
   *   has none, and neither has a carve-out (`BLOCK`): it is time taken OUT
   *   of the day, not a booking that can run past closing.
   * - **overlap** — the stretches another block of the column shares,
   *   merged so two collisions do not double-paint. A `GAP` is never the
   *   other side of a collision (sitting on one is the point of the
   *   gesture), and a block never collides with itself (its own id).
   *
   * Cost: the sort, plus one pass in which a window pointer only advances
   * and each block visits only the blocks that start inside it — the
   * overlaps it reports — never the whole column.
   */
  columnRuns(
    events: readonly RunEvent[],
    open: readonly MinuteRun[],
  ): readonly EventRuns[] {
    const windows = [...open].sort((a, b) => a.startMinutes - b.startMinutes);
    const prefixMaxEnd: number[] = [];
    let reach = -Infinity;
    for (let w = 0; w < windows.length; w++) {
      reach = Math.max(reach, (windows[w] as MinuteRun).endMinutes);
      prefixMaxEnd.push(reach);
    }

    const order = byStart(events);
    const out: EventRuns[] = [];
    for (let i = 0; i < events.length; i++) out.push(NO_EVENT_RUNS);

    // Windows before `w0` all end at or before the current block's start —
    // skipped by the legacy cursor anyway, and by every later block too.
    let w0 = 0;
    // The furthest end among the earlier collision sources, and the
    // furthest among those not sharing that one's id (a block never
    // collides with its own id).
    let bestEnd = -Infinity;
    let bestId: string | null = null;
    let otherEnd = -Infinity;

    for (let k = 0; k < order.length; k++) {
      const index = order[k] as number;
      const event = events[index] as RunEvent;
      const from: number = event.startMinutes;
      const to: number = event.endMinutes;
      if (to <= from) continue;

      let outside: readonly MinuteRun[] = NO_RUNS;
      if (event.gridEvent !== GridEvent.Block) {
        while (w0 < windows.length && (prefixMaxEnd[w0] as number) <= from) {
          w0++;
        }
        // Allocated on the first run only: almost every block sits inside
        // the open hours and has none (a drag tick recomputes the column).
        let runs: MinuteRun[] | null = null;
        let cursor = from;
        for (let w = w0; w < windows.length; w++) {
          const window = windows[w] as MinuteRun;
          if (window.endMinutes <= cursor) continue;
          if (window.startMinutes >= to) break;
          if (window.startMinutes > cursor) {
            (runs ??= []).push(
              runOf(cursor, Math.min(window.startMinutes, to)),
            );
          }
          cursor = Math.max(cursor, window.endMinutes);
          if (cursor >= to) break;
        }
        if (cursor < to) {
          (runs ??= []).push(runOf(cursor, to));
        }
        outside = runs ?? NO_RUNS;
      }

      // Lazily too: most blocks overlap nothing.
      let overlap: MinuteRun[] | null = null;
      // Every earlier source shares this block's start: one run.
      const earlierEnd = bestId !== event.id ? bestEnd : otherEnd;
      if (earlierEnd > from) {
        overlap = [runOf(from, Math.min(to, earlierEnd))];
      }
      // Later sources, by start: merged as they come.
      for (let j = k + 1; j < order.length; j++) {
        const other = events[order[j] as number] as RunEvent;
        if (other.startMinutes >= to) break;
        if (other.gridEvent === GridEvent.Gap || other.id === event.id) {
          continue;
        }
        const hitFrom: number = other.startMinutes;
        const hitTo = Math.min(to, other.endMinutes);
        if (hitTo <= hitFrom) continue;
        if (overlap === null) {
          overlap = [runOf(hitFrom, hitTo)];
          continue;
        }
        const last = overlap[overlap.length - 1];
        if (last !== undefined && hitFrom <= last.endMinutes) {
          if (hitTo > last.endMinutes) {
            overlap[overlap.length - 1] = runOf(last.startMinutes, hitTo);
          }
        } else {
          overlap.push(runOf(hitFrom, hitTo));
        }
      }

      // Nothing outside and nothing overlapping: the one shared empty value.
      out[index] =
        outside === NO_RUNS && overlap === null
          ? NO_EVENT_RUNS
          : { outside, overlap: overlap ?? NO_RUNS };

      if (event.gridEvent !== GridEvent.Gap) {
        if (event.id === bestId) {
          bestEnd = Math.max(bestEnd, to);
        } else if (to > bestEnd) {
          otherEnd = bestEnd;
          bestEnd = to;
          bestId = event.id;
        } else {
          otherEnd = Math.max(otherEnd, to);
        }
      }
    }
    return out;
  },

  /**
   * Side-by-side placement, parallel to `events`. A cluster is a run of
   * blocks that transitively overlap (sorted by start, input order breaking
   * ties); lanes are shared only inside one, so a busy morning cannot narrow
   * a quiet afternoon. Each block takes the first lane free by its start,
   * else a new one; `lanes` is its cluster's width.
   */
  lanes(events: readonly MinuteRun[]): readonly LaneSlot[] {
    const order = byStart(events);
    const lane: number[] = [];
    const width: number[] = [];
    for (let i = 0; i < events.length; i++) {
      lane.push(0);
      width.push(1);
    }
    let clusterStart = 0;
    let clusterEnd = -Infinity;
    let laneEnds: number[] = [];
    const close = (until: number): void => {
      for (let c = clusterStart; c < until; c++) {
        width[order[c] as number] = laneEnds.length;
      }
    };
    for (let k = 0; k < order.length; k++) {
      const index = order[k] as number;
      const event = events[index] as MinuteRun;
      if (k > clusterStart && event.startMinutes >= clusterEnd) {
        close(k);
        clusterStart = k;
        clusterEnd = -Infinity;
        laneEnds = [];
      }
      let free = -1;
      for (let l = 0; l < laneEnds.length; l++) {
        if ((laneEnds[l] as number) <= event.startMinutes) {
          free = l;
          break;
        }
      }
      if (free === -1) {
        free = laneEnds.length;
        laneEnds.push(event.endMinutes);
      } else {
        laneEnds[free] = event.endMinutes;
      }
      lane[index] = free;
      clusterEnd = Math.max(clusterEnd, event.endMinutes);
    }
    close(order.length);
    const out: LaneSlot[] = [];
    for (let i = 0; i < events.length; i++) {
      out.push({ lane: lane[i] as number, lanes: width[i] as number });
    }
    return out;
  },
} as const;
