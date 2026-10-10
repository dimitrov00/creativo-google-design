import { BookingState } from '../components/booking-status.data';
import { TimeInterval } from '../components/time-interval.data';
import { Seat } from '../components/seat.data';
import { IntervalSetSystem } from './interval-set.system';

const MS_PER_MINUTE = 60_000;

/**
 * The shortest hole the staff run calls a gap (`staff-day.store.ts:126`).
 * Not the 15-minute reporting floor: below 20 a lane becomes a ladder of
 * booking/gap/booking and the three-second read is gone. Under the shop's
 * shortest service and over its turnaround.
 */
const SHORTEST_SELLABLE_MINUTES = 20;

/** What a block in a grid column is — the ONLY source of these strings. */
export const GridEventKind = {
  /** A booking. */
  Visit: 'visit',
  /** A sellable hole — the ABSENCE of a booking, never a collision. */
  Gap: 'gap',
  /** Time carved OUT of the worked day (a break, an admin hour). */
  Block: 'block',
} as const;
export type GridEventKind = (typeof GridEventKind)[keyof typeof GridEventKind];

/** A seat as the occupancy reads it — an `AppointmentEntity` seat satisfies it. */
export type OccupyingSeat = {
  readonly barberId: string;
  readonly startMs: number;
  readonly terms: {
    readonly durationMinutes: number;
    readonly setupMinutes: number;
    readonly cleanupMinutes: number;
  };
};

/** A visit as the occupancy reads it — an `AppointmentEntity` satisfies it. */
export type OccupyingVisit = {
  readonly bookingStatus: { readonly kind: BookingState };
  readonly seats: readonly OccupyingSeat[];
};

/**
 * One hole in a chair's rostered day, on one side of the clock. The same
 * hole is inventory before now and a record after it: `sellable` is the
 * piece still ahead of the clock.
 */
export type LaneGap = {
  readonly startMs: number;
  readonly endMs: number;
  readonly minutes: number;
  readonly sellable: boolean;
};

/** A stretch of a column's minute track, `[startMinute, endMinute)` from midnight. */
export type MinuteRun = {
  readonly startMinute: number;
  readonly endMinute: number;
};

/** A block of a grid column, as the sweep reads it. */
export type RunEvent = {
  readonly id: string;
  readonly kind: GridEventKind;
  readonly startMinute: number;
  readonly endMinute: number;
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

/** `order` sorted by the events' start, input order breaking ties. */
function byStart(
  events: readonly { readonly startMinute: number }[],
): readonly number[] {
  const order: number[] = [];
  for (let i = 0; i < events.length; i++) order.push(i);
  order.sort(
    (a, b) =>
      (events[a] as { readonly startMinute: number }).startMinute -
        (events[b] as { readonly startMinute: number }).startMinute || a - b,
  );
  return order;
}

/**
 * GridLayoutSystem — the staff schedule's geometry: ms, minutes, ids and
 * tags, never words (`staff-day.store.ts:282-348`,
 * `time-grid/staff-time-grid.ts:2224-2350,2421-2490`).
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

  /* ── The chair's day, in instants ───────────────────────────────────── */

  /**
   * What actually occupied a chair: `busy` plus every seat of this barber's
   * on a visit that was not cancelled, padded by the seat's own setup and
   * cleanup — the same envelope the busy projection writes, so the two
   * sources coincide wherever both exist. A cancelled visit contributes
   * nothing (the chair genuinely went empty); a no-show did occupy it.
   * Normalized: sorted, disjoint, touching runs merged.
   */
  occupiedIntervals(
    appointments: readonly OccupyingVisit[],
    barberId: string,
    busy: readonly TimeInterval[],
  ): readonly TimeInterval[] {
    const all: TimeInterval[] = [];
    for (let i = 0; i < busy.length; i++) all.push(busy[i] as TimeInterval);
    for (let a = 0; a < appointments.length; a++) {
      const appointment = appointments[a] as OccupyingVisit;
      if (appointment.bookingStatus.kind === BookingState.Cancelled) continue;
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
    rostered: readonly TimeInterval[],
    occupied: readonly TimeInterval[],
  ): readonly TimeInterval[] {
    if (rostered.length === 0) return [];
    return IntervalSetSystem.subtract(rostered, occupied);
  },

  /**
   * The holes, SPLIT AT NOW and then floored — never the other way round:
   * flooring first would let a 105-minute hole with five minutes left on it
   * emit a "5 min free" gap. Minutes are rounded per piece; pieces under
   * {@link SHORTEST_SELLABLE_MINUTES} are dropped, not drawn quieter. Only
   * time still ahead can be filled, so a piece ending at or before now is a
   * record (`sellable: false`), drawn so an idle morning is not mistaken
   * for a booked one.
   */
  sellableAt(
    holes: readonly TimeInterval[],
    nowMs: number,
  ): readonly LaneGap[] {
    const out: LaneGap[] = [];
    const push = (startMs: number, endMs: number): void => {
      const minutes = Math.round((endMs - startMs) / MS_PER_MINUTE);
      if (minutes < SHORTEST_SELLABLE_MINUTES) return;
      out.push({ startMs, endMs, minutes, sellable: endMs > nowMs });
    };
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i] as TimeInterval;
      if (hole.startMs < nowMs && nowMs < hole.endMs) {
        push(hole.startMs, nowMs);
        push(nowMs, hole.endMs);
      } else {
        push(hole.startMs, hole.endMs);
      }
    }
    return out;
  },

  /** {@link holes} then {@link sellableAt} — the legacy one-call form. */
  laneGaps(
    rostered: readonly TimeInterval[],
    occupied: readonly TimeInterval[],
    nowMs: number,
  ): readonly LaneGap[] {
    return GridLayoutSystem.sellableAt(
      GridLayoutSystem.holes(rostered, occupied),
      nowMs,
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
    start: number,
    end: number,
  ): readonly MinuteRun[] {
    const windows: MinuteRun[] = [];
    for (let i = 0; i < open.length; i++) {
      const window = open[i] as MinuteRun;
      const startMinute = Math.max(window.startMinute, start);
      const endMinute = Math.min(window.endMinute, end);
      if (endMinute > startMinute) windows.push({ startMinute, endMinute });
    }
    windows.sort((a, b) => a.startMinute - b.startMinute);
    const runs: MinuteRun[] = [];
    let cursor = start;
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i] as MinuteRun;
      if (window.startMinute > cursor) {
        runs.push({ startMinute: cursor, endMinute: window.startMinute });
      }
      cursor = Math.max(cursor, window.endMinute);
    }
    if (cursor < end) runs.push({ startMinute: cursor, endMinute: end });
    return runs;
  },

  /**
   * Every block's outside and overlap runs, parallel to `events`, in ONE
   * sweep over the column: the events sorted once by start, the windows once
   * by start.
   *
   * - **outside** — the stretches no window covers. A block with no length
   *   has none, and neither has a carve-out (`block`): it is time taken OUT
   *   of the day, not a booking that can run past closing.
   * - **overlap** — the stretches another block of the column shares,
   *   merged so two collisions do not double-paint. A `gap` is never the
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
    const windows = [...open].sort((a, b) => a.startMinute - b.startMinute);
    const prefixMaxEnd: number[] = [];
    let reach = -Infinity;
    for (let w = 0; w < windows.length; w++) {
      reach = Math.max(reach, (windows[w] as MinuteRun).endMinute);
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
      const from = event.startMinute;
      const to = event.endMinute;
      if (to <= from) continue;

      let outside: readonly MinuteRun[] = NO_RUNS;
      if (event.kind !== GridEventKind.Block) {
        while (w0 < windows.length && (prefixMaxEnd[w0] as number) <= from) {
          w0++;
        }
        // Allocated on the first run only: almost every block sits inside
        // the open hours and has none (a drag tick recomputes the column).
        let runs: MinuteRun[] | null = null;
        let cursor = from;
        for (let w = w0; w < windows.length; w++) {
          const window = windows[w] as MinuteRun;
          if (window.endMinute <= cursor) continue;
          if (window.startMinute >= to) break;
          if (window.startMinute > cursor) {
            (runs ??= []).push({
              startMinute: cursor,
              endMinute: Math.min(window.startMinute, to),
            });
          }
          cursor = Math.max(cursor, window.endMinute);
          if (cursor >= to) break;
        }
        if (cursor < to) {
          (runs ??= []).push({ startMinute: cursor, endMinute: to });
        }
        outside = runs ?? NO_RUNS;
      }

      // Lazily too: most blocks overlap nothing.
      let overlap: MinuteRun[] | null = null;
      // Every earlier source shares this block's start: one run.
      const earlierEnd = bestId !== event.id ? bestEnd : otherEnd;
      if (earlierEnd > from) {
        overlap = [
          {
            startMinute: from,
            endMinute: Math.min(to, earlierEnd),
          },
        ];
      }
      // Later sources, by start: merged as they come.
      for (let j = k + 1; j < order.length; j++) {
        const other = events[order[j] as number] as RunEvent;
        if (other.startMinute >= to) break;
        if (other.kind === GridEventKind.Gap || other.id === event.id) continue;
        const hitFrom = other.startMinute;
        const hitTo = Math.min(to, other.endMinute);
        if (hitTo <= hitFrom) continue;
        if (overlap === null) {
          overlap = [{ startMinute: hitFrom, endMinute: hitTo }];
          continue;
        }
        const last = overlap[overlap.length - 1];
        if (last !== undefined && hitFrom <= last.endMinute) {
          if (hitTo > last.endMinute) {
            overlap[overlap.length - 1] = {
              startMinute: last.startMinute,
              endMinute: hitTo,
            };
          }
        } else {
          overlap.push({ startMinute: hitFrom, endMinute: hitTo });
        }
      }

      // Nothing outside and nothing overlapping: the one shared empty value.
      out[index] =
        outside === NO_RUNS && overlap === null
          ? NO_EVENT_RUNS
          : { outside, overlap: overlap ?? NO_RUNS };

      if (event.kind !== GridEventKind.Gap) {
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
      if (k > clusterStart && event.startMinute >= clusterEnd) {
        close(k);
        clusterStart = k;
        clusterEnd = -Infinity;
        laneEnds = [];
      }
      let free = -1;
      for (let l = 0; l < laneEnds.length; l++) {
        if ((laneEnds[l] as number) <= event.startMinute) {
          free = l;
          break;
        }
      }
      if (free === -1) {
        free = laneEnds.length;
        laneEnds.push(event.endMinute);
      } else {
        laneEnds[free] = event.endMinute;
      }
      lane[index] = free;
      clusterEnd = Math.max(clusterEnd, event.endMinute);
    }
    close(order.length);
    const out: LaneSlot[] = [];
    for (let i = 0; i < events.length; i++) {
      out.push({ lane: lane[i] as number, lanes: width[i] as number });
    }
    return out;
  },
} as const;
