import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  MinuteRange,
  CancellationReason,
  CancellationReasonSet,
  Seat,
  type ShopNow,
} from '@core/components';
import { BarberId, LocalDate } from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapOk,
  appointmentFixture,
  seatFixture,
  termsFixture,
} from '@core/testing';
import { IntervalSetSystem } from './interval-set.system';
import {
  GridEvent,
  GridLayoutSystem,
  type MinuteRun,
  type RunEvent,
} from './grid-layout.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * COPIED and re-targeted:
 * - every case of libs/features/staff/dashboard/src/lib/lane-gaps.spec.ts
 *   (6) — `laneGaps` of `staff-day.store.ts`; the legacy `Interval.of` of two
 *   instants → a `MinuteRange` on the lane's shop day, the clock → the
 *   shop's `ShopNow`;
 * - the geometry cases of libs/features/staff/dashboard/src/lib/time-grid/
 *   staff-time-grid.spec.ts (13): «the closed shading» (5) and the two
 *   window-origin shadings of «the window» through `closedRuns` (a CSS
 *   `grid-row` of 15-minute slots read back as the minute run it spans —
 *   '1 / 37' is minutes 0–540); «overlap» (2) through `lanes`; and the four
 *   outside/overlap cases of «masks» through `columnRuns` (a mask's
 *   fraction of its block read back as the minute run it covers).
 * Plus the occupancy fold, the sorted sweep ≡ the legacy per-block scan
 * (property), the lane packer ≡ the legacy packer (property), and purity.
 *
 * Flatten pass (Law 7, T1): every span is a `MinuteRange` / `MinuteRun` of
 * ONE shop day (`MinuteOfDay` → `EndMinute`), "now" is a `ShopNow`
 * (`localDate` + `currentMinute`), seats are the flat `Seat`, the visit's
 * state is `bookingStatus`, and the block tag is `gridEvent` (SCREAMING).
 */

const S = GridLayoutSystem;

/* ── lane-gaps.spec.ts ────────────────────────────────────────────────── */

/** The lane's shop day — only the arithmetic on its clock matters. */
const DAY: LocalDate = localDate('2026-09-28');
/** An hour of the day as its minute. */
const at = (hours: number): number => Math.round(hours * 60);
/** A span of the lane's day, `[from, to)` in minutes. */
const range = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
/** A span between two hours of the lane's day. */
const hours = (from: number, to: number): MinuteRange =>
  range(at(from), at(to));

/**
 * The shop's "now" `h` hours after the lane's midnight — past 24 the next
 * day's clock — derived as the boundary derives it (`ZonedTimeSystem.shopNow`).
 */
function nowAt(h: number): ShopNow {
  const days = Math.floor(h / 24);
  const day = LocalDate.addDays(DAY, days);
  const instant = unwrapOk(
    ZonedTimeSystem.toUtc(day, minute(at(h - days * 24)), FIXTURE_TIME_ZONE),
  );
  return ZonedTimeSystem.shopNow(instant, FIXTURE_TIME_ZONE);
}

const laneGaps = (
  rostered: readonly MinuteRange[],
  occupied: readonly MinuteRange[],
  now: ShopNow,
) => S.laneGaps(rostered, occupied, now, DAY);

describe('laneGaps', () => {
  const rostered = [hours(9, 18)];

  it('draws the ELAPSED hole, which used to be discarded entirely', () => {
    // A hole that has already passed is not sellable, but it is a fact: the
    // chair sat empty and nobody filled it. Hiding it made an idle morning
    // and a fully booked one render identically. With a 10:00 cut done and
    // the clock at 17:00 the rest of the day is one elapsed hole and one
    // sellable hour.
    const gaps = laneGaps(rostered, [hours(9, 10)], nowAt(17));
    expect(gaps.length).toBe(2);
    expect(gaps[0]).toMatchObject({ sellable: false, startMinutes: at(10) });
    expect(gaps[1]).toMatchObject({ sellable: true, startMinutes: at(17) });
  });

  it('splits a hole that straddles the clock, and floors each piece AFTER', () => {
    // 10:00–18:00 free with now at 17:00 is seven elapsed hours and one
    // sellable one — two different facts that must not be one card.
    const wide = laneGaps(rostered, [], nowAt(12));
    expect(wide.length).toBe(2);
    expect(wide[0]).toMatchObject({ sellable: false, minutes: 3 * 60 });
    expect(wide[1]).toMatchObject({ sellable: true, minutes: 6 * 60 });
  });

  it('never emits a sellable sliver from a mostly-elapsed hole', () => {
    // Flooring BEFORE the split would let a 105-minute hole with five
    // minutes left on it advertise "5 мин свободни".
    const nearlyOver = nowAt(17 + 55 / 60); // 17:55, hole runs to 18:00
    const gaps = laneGaps(rostered, [hours(9, 10)], nearlyOver);
    expect(gaps.every((gap) => gap.minutes >= 20)).toBe(true);
    expect(gaps.some((gap) => gap.sellable)).toBe(false);
  });

  it('keeps the 20-minute floor on both sides of the clock', () => {
    // Below the floor a lane becomes a ladder of booking/gap/booking and the
    // three-second read is gone — the reason the floor exists at all.
    const busy = [hours(9, 12), range(at(12) + 10, at(18))];
    expect(laneGaps(rostered, busy, nowAt(9)).length).toBe(0);
  });

  it('draws nothing for a chair that is not rostered', () => {
    // No window is not the same as an empty window, and never was.
    expect(laneGaps([], [], nowAt(12)).length).toBe(0);
  });

  it('reports a wholly past day as entirely idle when nothing was booked', () => {
    const gaps = laneGaps(rostered, [], nowAt(30));
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toMatchObject({ sellable: false, minutes: 9 * 60 });
  });
});

describe('the row fold and the tick — holes take no clock', () => {
  it('splits the same holes at whatever minute the tick brings', () => {
    const holes = S.holes([hours(9, 18)], [hours(9, 10)]);
    expect(holes).toEqual([hours(10, 18)]);
    expect(S.sellableAt(holes, nowAt(17), DAY)).toEqual(
      laneGaps([hours(9, 18)], [hours(9, 10)], nowAt(17)),
    );
    expect(S.sellableAt(holes, nowAt(8), DAY)).toEqual([
      {
        startMinutes: at(10),
        endMinutes: at(18),
        minutes: 8 * 60,
        sellable: true,
      },
    ]);
  });
});

describe('occupiedIntervals — what actually occupied a chair', () => {
  const ivan = BarberId.of('b-ivan');
  const seat = (startHours: number, barberId: BarberId = ivan): Seat =>
    seatFixture({
      startMinutes: minute(at(startHours)),
      barberId,
      terms: Seat.termsOf(termsFixture(2800, 30, 5, 10), null),
    });
  /** A lifecycle stamp — irrelevant to occupancy. */
  const stamp = nowAt(8).utcEpochMs;

  it('pads each of the barber’s seats by its own setup and cleanup, and merges what touches', () => {
    const visit = appointmentFixture({ seats: [seat(10), seat(10.75)] });
    expect(S.occupiedIntervals([visit], ivan, [])).toEqual([
      // 09:55 → 10:30 + 10 = 10:40, and 10:40 → 11:15 + 10 = 11:25: touching.
      range(at(10) - 5, at(11.25) + 10),
    ]);
  });

  it('keeps a no-show (the chair was held) and drops a cancellation (it went empty)', () => {
    const noShow = appointmentFixture({
      seats: [seat(12)],
      lifecycle: BookingLifecycle.noShow(stamp),
    });
    const cancelled = appointmentFixture({
      seats: [seat(15)],
      lifecycle: BookingLifecycle.cancel(
        stamp,
        CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
      ),
    });
    expect(S.occupiedIntervals([noShow, cancelled], ivan, [])).toEqual([
      range(at(12) - 5, at(12.5) + 10),
    ]);
  });

  it('reads only this barber’s seats, beside the busy it was handed', () => {
    const niko = BarberId.of('b-niko');
    const party = appointmentFixture({ seats: [seat(10), seat(10, niko)] });
    expect(S.occupiedIntervals([party], niko, [hours(14, 15)])).toEqual([
      range(at(10) - 5, at(10.5) + 10),
      hours(14, 15),
    ]);
  });
});

/* ── staff-time-grid.spec.ts — the closed shading and the window ─────── */

const SLOT = 15;
/** A run of the track, `[from, to)` in minutes of the day. */
const window = (from: number, to: number): MinuteRun => ({
  startMinutes: minute(from),
  endMinutes: endMinute(to),
});
/** A CSS grid-row of 15-minute slots from `origin`, read back as minutes. */
function rowOf(row: string, origin = 0): MinuteRun {
  const [from, to] = row.split(' / ').map(Number) as [number, number];
  return window(origin + (from - 1) * SLOT, origin + (to - 1) * SLOT);
}
const closedRows = (
  open: readonly MinuteRun[],
  start = 0,
  end = 1440,
): readonly MinuteRun[] => S.closedRuns(open, minute(start), endMinute(end));

describe('the closed shading', () => {
  // 96 slots of 15 minutes: 00:00 is grid line 1, 09:00 is line 37, 18:00 is
  // line 73. Two runs — the shut morning and the shut evening.
  it('shades the hours outside a single working window', () => {
    expect(closedRows([window(540, 1080)])).toEqual([
      rowOf('1 / 37'),
      rowOf('73 / 97'),
    ]);
  });

  it('shades the break in a split shift', () => {
    expect(closedRows([window(540, 780), window(840, 1080)])).toEqual([
      rowOf('1 / 37'),
      rowOf('53 / 57'),
      rowOf('73 / 97'),
    ]);
  });

  /*
   * The state this whole mechanism exists for: a chair nobody is rostered on
   * used to render exactly like a chair with a wide-open day.
   */
  it('shades a column with no windows solid', () => {
    expect(closedRows([])).toEqual([rowOf('1 / 97')]);
  });

  // A caller may hand windows over in any order — the store merges lanes,
  // and an unsorted pair would otherwise carve a phantom closed band through
  // the middle of a day two barbers are both working.
  it('merges overlapping and out-of-order windows', () => {
    expect(closedRows([window(720, 1080), window(540, 780)])).toEqual([
      rowOf('1 / 37'),
      rowOf('73 / 97'),
    ]);
  });

  it('shades each column against its OWN hours', () => {
    expect(closedRows([window(540, 1080)])).toEqual([
      rowOf('1 / 37'),
      rowOf('73 / 97'),
    ]);
    expect(closedRows([window(720, 1200)])).toEqual([
      rowOf('1 / 49'),
      rowOf('81 / 97'),
    ]);
  });
});

describe('the window', () => {
  // The shading is drawn against the window's own origin, not midnight —
  // 12:00 is line 13 on a 09:00-origin track, not line 49.
  it('shades the closed hours against the window origin', () => {
    expect(closedRows([window(540, 660)], 540, 720)).toEqual([
      rowOf('9 / 13', 540),
    ]);
  });

  /*
   * A run is a `grid-row` against the extent's own track. A shift reaching
   * outside the window — a lunch break at 13:00 while the frame draws
   * 09:00–12:00 — used to ask for rows the column does not have.
   */
  it('does not shade a break that falls outside the drawn hours', () => {
    expect(closedRows([window(540, 780), window(840, 1080)], 540, 720)).toEqual(
      [],
    );
  });
});

/* ── staff-time-grid.spec.ts — overlap lanes ──────────────────────────── */

describe('overlap', () => {
  // A party is one appointment with several seats, and in the week view
  // every chair is merged into one date column — simultaneous blocks are the
  // normal case there, not a defect.
  it('lanes genuinely overlapping blocks side by side', () => {
    const slots = S.lanes([window(600, 660), window(615, 675)]);
    expect(slots.map((slot) => slot.lane)).toEqual([0, 1]);
    expect(slots.every((slot) => slot.lanes === 2)).toBe(true);
  });

  // A busy morning must not narrow a quiet afternoon: lanes are shared only
  // inside a cluster of transitively-overlapping blocks.
  it('does not let one cluster narrow the next', () => {
    const slots = S.lanes([
      window(600, 660),
      window(615, 675),
      window(900, 960),
    ]);
    expect(slots.at(-1)?.lanes).toBe(1);
  });
});

/* ── staff-time-grid.spec.ts — masks ──────────────────────────────────── */

function event(
  id: string,
  from: number,
  to: number,
  gridEvent: GridEvent = GridEvent.Visit,
): RunEvent {
  return {
    id,
    gridEvent,
    startMinutes: minute(from),
    endMinutes: endMinute(to),
  };
}
/** A mask's `[from, to]` fraction of its block, as the minute run it covers. */
function fractionRun(block: RunEvent, from: number, to: number): MinuteRun {
  const span = block.endMinutes - block.startMinutes;
  return window(
    block.startMinutes + from * span,
    block.startMinutes + to * span,
  );
}

describe('masks', () => {
  /*
   * ⚠ PLACED, NOT REFUSED. It is the barber's own book — a cut that ran past
   * closing is a thing that happened, and the grid records it.
   */
  it('hatches only the minutes past closing, and warns', () => {
    // 17:30–18:30: half of it past an 18:00 close.
    const a = event('a', 1050, 1110);
    const [runs] = S.columnRuns([a], [window(540, 1080)]);
    expect(runs?.outside).toEqual([fractionRun(a, 0.5, 1)]);
    expect(runs?.overlap).toEqual([]);
  });

  it('leaves a booking inside the shift unmarked', () => {
    const [runs] = S.columnRuns([event('a', 600, 660)], [window(540, 1080)]);
    expect(runs).toEqual({ outside: [], overlap: [] });
  });

  it('hatches the overlapping stretch on BOTH blocks', () => {
    const a = event('a', 600, 660);
    const b = event('b', 630, 690);
    const [runsA, runsB] = S.columnRuns([a, b], [window(0, 1440)]);
    // The last half of A and the first half of B are the same half-hour.
    expect(runsA?.overlap).toEqual([fractionRun(a, 0.5, 1)]);
    expect(runsB?.overlap).toEqual([fractionRun(b, 0, 0.5)]);
  });

  it('does not call a gap a collision — landing on one is the point', () => {
    const [runs] = S.columnRuns(
      [event('a', 600, 660), event('g', 600, 660, GridEvent.Gap)],
      [window(0, 1440)],
    );
    expect(runs?.overlap).toEqual([]);
  });
});

describe('columnRuns — the rest of the sweep', () => {
  it('marks no outside on a carve-out, and nothing at all on a block with no length', () => {
    const runs = S.columnRuns(
      [event('lunch', 1050, 1110, GridEvent.Block), event('zero', 700, 700)],
      [window(540, 1080)],
    );
    expect(runs).toEqual([
      { outside: [], overlap: [] },
      { outside: [], overlap: [] },
    ]);
  });

  it('answers in the caller’s order, whatever order the column starts in', () => {
    const runs = S.columnRuns(
      [event('late', 700, 760), event('early', 600, 720)],
      [],
    );
    expect(runs[0]?.overlap).toEqual([window(700, 720)]);
    expect(runs[1]?.overlap).toEqual([window(700, 720)]);
    // No window at all: the whole block is outside the shift.
    expect(runs[0]?.outside).toEqual([window(700, 760)]);
  });

  it('never calls two parts of one id a collision', () => {
    const runs = S.columnRuns(
      [event('a', 600, 660), event('a', 630, 690), event('b', 650, 700)],
      [window(0, 1440)],
    );
    expect(runs[0]?.overlap).toEqual([window(650, 660)]);
    expect(runs[1]?.overlap).toEqual([window(650, 690)]);
  });
});

/* ── The legacy per-block scan, verbatim, as the oracle ──────────────── */

/** The oracle's runs: plain numbers, compared field by field with the brands. */
type PlainRun = { readonly startMinutes: number; readonly endMinutes: number };

function legacyOutsideRuns(
  from: number,
  to: number,
  open: readonly MinuteRun[],
): readonly PlainRun[] {
  const runs: PlainRun[] = [];
  let cursor = from;
  const windows = [...open].sort((a, b) => a.startMinutes - b.startMinutes);
  for (const w of windows) {
    if (w.endMinutes <= cursor) continue;
    if (w.startMinutes >= to) break;
    if (w.startMinutes > cursor) {
      runs.push({
        startMinutes: cursor,
        endMinutes: Math.min(w.startMinutes, to),
      });
    }
    cursor = Math.max(cursor, w.endMinutes);
    if (cursor >= to) break;
  }
  if (cursor < to) runs.push({ startMinutes: cursor, endMinutes: to });
  return runs;
}

function legacyOverlapRuns(
  self: RunEvent,
  siblings: readonly RunEvent[],
): readonly PlainRun[] {
  const hits: [number, number][] = [];
  for (const other of siblings) {
    if (other.id === self.id || other.gridEvent === 'GAP') continue;
    const from = Math.max(self.startMinutes, other.startMinutes);
    const to = Math.min(self.endMinutes, other.endMinutes);
    if (to > from) hits.push([from, to]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const hit of hits) {
    const last = merged.at(-1);
    if (last !== undefined && hit[0] <= last[1]) {
      last[1] = Math.max(last[1], hit[1]);
      continue;
    }
    merged.push([...hit]);
  }
  return merged.map(([startMinutes, endMinutes]) => ({
    startMinutes,
    endMinutes,
  }));
}

function legacyColumn(
  events: readonly RunEvent[],
  open: readonly MinuteRun[],
): readonly {
  readonly outside: readonly PlainRun[];
  readonly overlap: readonly PlainRun[];
}[] {
  return events.map((self) =>
    self.endMinutes <= self.startMinutes
      ? { outside: [], overlap: [] }
      : {
          outside:
            self.gridEvent === 'BLOCK'
              ? []
              : legacyOutsideRuns(self.startMinutes, self.endMinutes, open),
          overlap: legacyOverlapRuns(self, events),
        },
  );
}

function legacyLanes(events: readonly MinuteRun[]) {
  const sorted = events
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const clusters: (typeof sorted)[] = [];
  let current: typeof sorted = [];
  let clusterEnd = -Infinity;
  for (const e of sorted) {
    if (current.length > 0 && e.startMinutes >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMinutes);
  }
  if (current.length > 0) clusters.push(current);
  const out: { lane: number; lanes: number }[] = events.map(() => ({
    lane: 0,
    lanes: 1,
  }));
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assigned = cluster.map((e) => {
      let lane = laneEnds.findIndex((end) => end <= e.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(e.endMinutes);
      } else {
        laneEnds.splice(lane, 1, e.endMinutes);
      }
      return { e, lane };
    });
    for (const { e, lane } of assigned) {
      out[e.index] = { lane, lanes: laneEnds.length };
    }
  }
  return out;
}

/*
 * The track is one shop day: a start in `[0, 1440)`, an end in `(0, 1440]`
 * (the brands' ranges), clamped there — inverted and empty blocks stay in
 * the draw (a start of 30 with a length of −30 ends at 15).
 */
const trackStart = fc.integer({ min: 0, max: 47 }).map((n) => n * 30);
const trackEnd = (raw: number): number => Math.min(1440, Math.max(15, raw));
const arbEvent = fc
  .record({
    id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
    gridEvent: fc.constantFrom<GridEvent>('VISIT', 'GAP', 'BLOCK'),
    start: trackStart,
    length: fc.integer({ min: -2, max: 8 }).map((n) => n * 15),
  })
  .map(({ id, gridEvent, start, length }): RunEvent =>
    event(id, start, trackEnd(start + length), gridEvent),
  );
const arbWindow = fc
  .record({ start: trackStart, length: fc.integer({ min: -1, max: 20 }) })
  .map(({ start, length }) => window(start, trackEnd(start + length * 30)));

describe('the sweep against the per-block scan', () => {
  it('equals the legacy outside and overlap runs of every block (property)', () => {
    fc.assert(
      fc.property(
        fc.array(arbEvent, { maxLength: 14 }),
        fc.array(arbWindow, { maxLength: 4 }),
        (events, open) => {
          expect(S.columnRuns(events, open)).toEqual(
            legacyColumn(events, open),
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it('equals the legacy lane packer (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              start: trackStart,
              length: fc.integer({ min: 1, max: 8 }),
            })
            .map(({ start, length }) =>
              window(start, trackEnd(start + length * 15)),
            ),
          { maxLength: 14 },
        ),
        (events) => {
          expect(S.lanes(events)).toEqual(legacyLanes(events));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves the gaps inside the rostered day, disjoint, never under the floor (property)', () => {
    const interval = fc
      .record({
        start: fc.integer({ min: 0, max: 95 }),
        length: fc.integer({ min: 1, max: 24 }),
      })
      .map(({ start, length }) =>
        range(start * 15, Math.min(start + length, 96) * 15),
      );
    fc.assert(
      fc.property(
        fc.array(interval, { maxLength: 3 }),
        fc.array(interval, { maxLength: 6 }),
        fc.integer({ min: 0, max: 120 }).map((n) => nowAt((n * 15) / 60)),
        (rostered, busy, now) => {
          const gaps = laneGaps(rostered, busy, now);
          // Ahead of the clock: a later day, or today past the minute.
          const ahead = (end: number): boolean =>
            DAY > now.localDate ||
            (DAY === now.localDate && end > now.currentMinute);
          for (const gap of gaps) {
            expect(gap.minutes).toBeGreaterThanOrEqual(
              S.SHORTEST_SELLABLE_MINUTES,
            );
            const day = IntervalSetSystem.normalize(rostered);
            expect(day.some((r) => MinuteRange.contains(r, gap))).toBe(true);
            expect(busy.some((b) => MinuteRange.overlaps(b, gap))).toBe(false);
            expect(gap.sellable).toBe(ahead(gap.endMinutes));
          }
          for (let i = 1; i < gaps.length; i++) {
            expect(
              (gaps.at(i) as { startMinutes: number }).startMinutes,
            ).toBeGreaterThanOrEqual(
              (gaps[i - 1] as { endMinutes: number }).endMinutes,
            );
          }
        },
      ),
    );
  });
});

describe('GridLayoutSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const events = deepFreeze([
      event('b', 630, 690),
      event('a', 600, 660),
      event('g', 600, 660, GridEvent.Gap),
    ]);
    const open = deepFreeze([window(720, 1080), window(540, 640)]);
    const once = S.columnRuns(events, open);
    expect(S.columnRuns(events, open)).toEqual(once);
    expect(S.lanes(events)).toEqual(S.lanes(events));
    expect(S.closedRuns(open, minute(0), endMinute(1440))).toEqual(
      S.closedRuns(open, minute(0), endMinute(1440)),
    );
    expect(open[0]).toEqual(window(720, 1080));

    const ivan = BarberId.of('b-ivan');
    const visits = deepFreeze([appointmentFixture()]);
    const busy = deepFreeze([hours(14, 15)]);
    const occupied = S.occupiedIntervals(visits, ivan, busy);
    expect(S.occupiedIntervals(visits, ivan, busy)).toEqual(occupied);
    const rostered = deepFreeze([hours(9, 18)]);
    const now = deepFreeze(nowAt(12));
    expect(S.laneGaps(rostered, occupied, now, DAY)).toEqual(
      S.laneGaps(rostered, occupied, now, DAY),
    );
    expect(rostered[0]).toEqual(hours(9, 18));
  });
});
