import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  MinuteRange,
  Seat,
  SeatOutcome,
  type ShopNow,
} from '@core/components';
import { BarberId, LocalDate } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  seatFixture,
  termsFixture,
} from '@core/testing';
import {
  ChairTimeSystem,
  type ChairDayInput,
  type ChairVisit,
} from './chair-time.system';
import { GridLayoutSystem } from './grid-layout.system';
import { IntervalSetSystem } from './interval-set.system';

const S = ChairTimeSystem;
const DAY: LocalDate = localDate('2026-09-28');
const ivan = BarberId.of('b-ivan');
const niko = BarberId.of('b-niko');
const at = (hours: number): number => Math.round(hours * 60);
const range = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
const hours = (from: number, to: number): MinuteRange =>
  range(at(from), at(to));
const stamp = FIXTURE_NOW_UTC_MS;

/** The shop's now on `day` at `h` hours. */
const nowOn = (day: LocalDate, h: number): ShopNow => ({
  localDate: day,
  currentMinute: minute(at(h)),
  utcEpochMs: stamp,
});
/** A day long past: every minute of DAY is before now. */
const PAST = nowOn(LocalDate.addDays(DAY, 1), 9);

/** A seat of `minutes` with 5 setup and 10 cleanup (chair time −5 … +minutes+10). */
const seat = (
  startHours: number,
  outcome: SeatOutcome,
  barberId: BarberId = ivan,
  minutes = 30,
  setup = 5,
  cleanup = 10,
): Seat =>
  seatFixture({
    startMinutes: minute(at(startHours)),
    barberId,
    terms: Seat.termsOf(termsFixture(2800, minutes, setup, cleanup), null),
    outcome,
  });
const visit = (...seats: Seat[]): ChairVisit => appointmentFixture({ seats });
const worked = SeatOutcome.worked(stamp);
const noShow = SeatOutcome.noShow(stamp);
const scheduled = SeatOutcome.scheduled();
const cancelledSeat = SeatOutcome.cancelled(
  stamp,
  CancelledBy.Client,
  CancellationReason.ClientChangedPlans,
  null,
);

/** A barber-day: the rostered time, its blocks and breaks; the windows are what is left. */
function dayOf(
  rostered: readonly MinuteRange[],
  blocks: readonly MinuteRange[],
  breaks: readonly MinuteRange[],
  visits: readonly ChairVisit[],
  now: ShopNow,
  localDay: LocalDate = DAY,
): ChairDayInput {
  return {
    barberId: ivan,
    localDate: localDay,
    windows: IntervalSetSystem.subtract(
      IntervalSetSystem.subtract(rostered, blocks),
      breaks,
    ),
    blocks,
    breaks,
    visits,
    now,
  };
}

/** The schedule's day-summary free time for the same day. */
function summaryOf(input: ChairDayInput): number {
  return GridLayoutSystem.totalMinutes(
    GridLayoutSystem.sellableAt(
      GridLayoutSystem.holes(
        input.windows,
        GridLayoutSystem.occupiedIntervals(input.visits, input.barberId, []),
      ),
      input.now,
      input.localDate,
    ),
  );
}

describe('ChairTimeSystem.dayBreakdown — where every rostered minute went', () => {
  it('splits a past day into its parts, which sum to the rostered time', () => {
    // 09–19 rostered; break 13:00–13:30; block 16–17; a worked cut at 10:00
    // (09:55–10:40) and a no-show at 11:00 (10:55–11:40).
    const input = dayOf(
      [hours(9, 19)],
      [hours(16, 17)],
      [hours(13, 13.5)],
      [visit(seat(10, worked)), visit(seat(11, noShow))],
      PAST,
    );
    const day = S.dayBreakdown(input);
    expect(day).toMatchObject({
      rosteredMinutes: 600,
      workedMinutes: 45,
      noShowMinutes: 45,
      unmarkedMinutes: 0,
      bookedAheadMinutes: 0,
      heldMinutes: 0,
      blockedMinutes: 60,
      breakMinutes: 30,
      // 10:40–10:55 is a 15-minute sliver.
      shortGapMinutes: 15,
      // 09:00–09:55, 11:40–13:00, 13:30–16:00, 17:00–19:00.
      unsoldMinutes: 55 + 80 + 150 + 120,
      openMinutes: 0,
      pastBlockedMinutes: 60,
      pastShortGapMinutes: 15,
    });
    expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
    expect(day.unsoldMinutes + day.openMinutes).toBe(summaryOf(input));
  });

  it('splits a scheduled seat at the current minute: unmarked before, booked ahead after', () => {
    // Today at 12:00; a scheduled 30-minute seat at 11:45 with no padding.
    const input = dayOf(
      [hours(9, 19)],
      [],
      [],
      [visit(seat(11.75, scheduled, ivan, 30, 0, 0))],
      nowOn(DAY, 12),
    );
    const day = S.dayBreakdown(input);
    expect(day.unmarkedMinutes).toBe(15);
    expect(day.bookedAheadMinutes).toBe(15);
    expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
  });

  it('counts a hole the clock is inside: past part unsold, future part open while it is still sellable', () => {
    // Free 09–19, now 15:00: 360 minutes behind, 240 ahead.
    const day = S.dayBreakdown(
      dayOf([hours(9, 19)], [], [], [], nowOn(DAY, 15)),
    );
    expect(day.unsoldMinutes).toBe(360);
    expect(day.openMinutes).toBe(240);
  });

  it('counts the tail of a hole with under 20 minutes left as unsold, not open', () => {
    // Free 17–19 after a block, now 18:50: ten minutes left — the schedule no longer offers it.
    const input = dayOf(
      [hours(16, 19)],
      [hours(16, 17)],
      [],
      [],
      nowOn(DAY, 18 + 50 / 60),
    );
    const day = S.dayBreakdown(input);
    expect(day.openMinutes).toBe(0);
    expect(day.unsoldMinutes).toBe(120);
    expect(day.unsoldMinutes + day.openMinutes).toBe(summaryOf(input));
  });

  it('gives a seat placed over a break or a block to the seat, never losing worked time', () => {
    // A worked cut at 13:05 (13:00–13:45) over the 13:00–13:30 break.
    const day = S.dayBreakdown(
      dayOf(
        [hours(9, 19)],
        [],
        [hours(13, 13.5)],
        [visit(seat(13 + 5 / 60, worked))],
        PAST,
      ),
    );
    expect(day.workedMinutes).toBe(45);
    expect(day.breakMinutes).toBe(0);
    expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
  });

  it('ranks a minute under several seats worked → no-show → unmarked → booked ahead → held, and counts it once', () => {
    const day = S.dayBreakdown(
      dayOf(
        [hours(9, 19)],
        [],
        [],
        // Overlapping: a worked cut and a no-show at 10:00, a scheduled one at 10:15.
        [visit(seat(10, worked), seat(10, noShow), seat(10.25, scheduled))],
        PAST,
      ),
    );
    // 09:55–10:40 worked; the no-show adds nothing; 10:40–10:55 unmarked.
    expect(day.workedMinutes).toBe(45);
    expect(day.noShowMinutes).toBe(0);
    expect(day.unmarkedMinutes).toBe(15);
    expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
  });

  it('holds the chair for a cancelled seat in a live party, and frees it for a wholly cancelled visit', () => {
    const party = appointmentFixture({
      seats: [seat(10, worked), seat(15, cancelledSeat)],
    });
    const gone = appointmentFixture({
      seats: [seat(17, scheduled)],
      lifecycle: BookingLifecycle.cancel(
        stamp,
        CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
      ),
    });
    const input = dayOf([hours(9, 19)], [], [], [party, gone], PAST);
    const day = S.dayBreakdown(input);
    expect(day.heldMinutes).toBe(45);
    expect(day.pastHeldMinutes).toBe(45);
    expect(day.workedMinutes).toBe(45);
    // The schedule's holes agree: the held seat is not free time.
    expect(day.unsoldMinutes + day.openMinutes).toBe(summaryOf(input));
  });

  it('reads only this barber’s seats', () => {
    const day = S.dayBreakdown(
      dayOf([hours(9, 19)], [], [], [visit(seat(10, worked, niko))], PAST),
    );
    expect(day.workedMinutes).toBe(0);
    expect(day.unsoldMinutes).toBe(600);
  });

  it('keeps worked time outside rostered hours out of the parts, and counts it apart', () => {
    // A worked cut at 08:30 (08:25–09:10): 35 minutes before the 09:00 start.
    const day = S.dayBreakdown(
      dayOf([hours(9, 19)], [], [], [visit(seat(8.5, worked))], PAST),
    );
    expect(day.outsideHoursMinutes).toBe(35);
    expect(day.outsideHoursSeatCount).toBe(1);
    expect(day.workedMinutes).toBe(10);
    expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
  });

  it('answers a day with no rostered time with zeros', () => {
    const day = S.dayBreakdown(
      dayOf([], [], [], [visit(seat(10, worked))], PAST),
    );
    expect(day.rosteredMinutes).toBe(0);
    expect(S.partsTotal(day)).toBe(0);
    // The visit happened anyway: all of it outside rostered time.
    expect(day.outsideHoursSeatCount).toBe(1);
  });

  it('treats a day after today as wholly ahead and a day before it as wholly behind', () => {
    const later = S.dayBreakdown(
      dayOf(
        [hours(9, 19)],
        [hours(12, 13)],
        [],
        [],
        nowOn(LocalDate.addDays(DAY, -1), 12),
      ),
    );
    expect(later.openMinutes).toBe(540);
    expect(later.unsoldMinutes).toBe(0);
    expect(later.pastBlockedMinutes).toBe(0);
    const earlier = S.dayBreakdown(
      dayOf([hours(9, 19)], [hours(12, 13)], [], [], PAST),
    );
    expect(earlier.openMinutes).toBe(0);
    expect(earlier.pastBlockedMinutes).toBe(60);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(
      dayOf(
        [hours(9, 19)],
        [hours(16, 17)],
        [hours(13, 13.5)],
        [visit(seat(10, worked)), visit(seat(14, scheduled))],
        nowOn(DAY, 12),
      ),
    );
    expect(S.dayBreakdown(input)).toEqual(S.dayBreakdown(input));
  });

  it('always sums to the rostered time, and unsold + open always equals the schedule’s free time (property)', () => {
    const minuteArb = fc.integer({ min: 0, max: 1439 });
    const rangeArb = fc
      .tuple(minuteArb, fc.integer({ min: 1, max: 300 }))
      .map(([start, length]) => range(start, Math.min(1440, start + length)));
    const outcomeArb = fc.constantFrom<SeatOutcome>(
      worked,
      noShow,
      scheduled,
      cancelledSeat,
    );
    const seatArb = fc
      .tuple(
        fc.integer({ min: 0, max: 1380 }),
        outcomeArb,
        fc.boolean(),
        fc.integer({ min: 5, max: 90 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
      )
      .map(([start, outcome, mine, minutes, setup, cleanup]) =>
        seatFixture({
          // A seat never ends past its shop day (F-6).
          startMinutes: minute(Math.min(start, 1440 - minutes)),
          barberId: mine ? ivan : niko,
          terms: Seat.termsOf(
            termsFixture(2800, minutes, setup, cleanup),
            null,
          ),
          outcome,
        }),
      );
    const visitArb = fc
      .tuple(fc.array(seatArb, { minLength: 1, maxLength: 3 }), fc.boolean())
      .map(([seats, wholeCancelled]) =>
        appointmentFixture(
          wholeCancelled
            ? {
                seats,
                lifecycle: BookingLifecycle.cancel(
                  stamp,
                  CancellationReasonSet.of([
                    CancellationReason.ClientChangedPlans,
                  ]),
                ),
              }
            : { seats },
        ),
      );
    fc.assert(
      fc.property(
        fc.array(rangeArb, { maxLength: 3 }),
        fc.array(rangeArb, { maxLength: 2 }),
        fc.array(rangeArb, { maxLength: 2 }),
        fc.array(visitArb, { maxLength: 6 }),
        fc.integer({ min: -1, max: 1 }),
        minuteArb,
        (rosteredRaw, blocksRaw, breaksRaw, visits, dayOffset, nowMinute) => {
          const rostered = IntervalSetSystem.normalize(rosteredRaw);
          const blocks = IntervalSetSystem.intersect(blocksRaw, rostered);
          const breaks = IntervalSetSystem.intersect(breaksRaw, rostered);
          const now: ShopNow = {
            localDate: LocalDate.addDays(DAY, dayOffset),
            currentMinute: minute(nowMinute),
            utcEpochMs: stamp,
          };
          const input = dayOf(rostered, blocks, breaks, visits, now);
          const day = S.dayBreakdown(input);
          expect(S.partsTotal(day)).toBe(day.rosteredMinutes);
          expect(day.rosteredMinutes).toBe(
            IntervalSetSystem.totalMinutes(rostered),
          );
          expect(day.unsoldMinutes + day.openMinutes).toBe(summaryOf(input));
        },
      ),
      { numRuns: 300 },
    );
  });
});
