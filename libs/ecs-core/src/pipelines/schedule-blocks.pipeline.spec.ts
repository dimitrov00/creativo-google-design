import { describe, expect, it } from 'vitest';
import { ExceptionEffectRule, MinuteRange } from '@core/components';
import type { ScheduleException } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import type { ScheduleExceptionPorts } from '@core/ports';
import {
  BarberId,
  BusyKey,
  ExceptionEffect,
  type LocalDate,
  LocationId,
  ScheduleExceptionId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  endMinute,
  localDate,
  memoryScheduleExceptionPorts,
  minute,
  unwrapOk,
} from '@core/testing';
import {
  clearScheduleBlock,
  writeScheduleBlocks,
} from './schedule-blocks.pipeline';

/*
 * The store's two roster writes, moved here whole (pass C, D-10: Y-3 / Y-4)
 * — `staff-day.store.ts` `writeBlocks` (behind `blockTime` and
 * `blockSeries`) and `clearBlock`. Restated from `staff-dashboard.spec.ts`
 * «blocks a range through the exception writer, sanitized» (one call, the
 * key `ivan__2026-08-05`), «merges a range into the blocks the day already
 * holds — never replacing them», «stands the whole day down when the switch
 * is on» and «arms the day-wide lift before it deletes anything» (the lift
 * deletes the day), over the in-memory exception writer; plus the series,
 * the day already off whole and the two refusals.
 */
const IVAN = BarberId.of('ivan');
const SHOP = LocationId.of('loc-center');
const DAY = localDate('2026-08-05');
const NEXT = localDate('2026-08-06');

/** The hour from `hour` o'clock. */
const wall = (hour: number): MinuteRange =>
  MinuteRange.of(minute(hour * 60), endMinute(hour * 60 + 60));
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from * 60), endMinute(to * 60));

/** A day as the store writes it: busy key, barber, day, shop, first instant. */
const metaOf = (day: LocalDate) => ({
  id: ScheduleExceptionId.of(BusyKey.of(IVAN, day)),
  barberId: IVAN,
  localDate: day,
  utcEpochMs: ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE),
  locationId: SHOP,
});

const stored = (
  day: LocalDate,
  effect: ExceptionEffectRule,
): ScheduleException => ({ ...metaOf(day), ...effect });

/** The in-memory writer, the keys of every call recorded. */
function writer(exceptions: ScheduleException[]): {
  ports: ScheduleExceptionPorts;
  keys: () => readonly (readonly BusyKey[])[];
} {
  const memory = memoryScheduleExceptionPorts(exceptions);
  const calls: (readonly BusyKey[])[] = [];
  return {
    ports: {
      writeScheduleException: (keys, merge) => {
        calls.push(keys);
        return memory.writeScheduleException(keys, merge);
      },
    },
    keys: () => calls,
  };
}

const block = (
  ports: ScheduleExceptionPorts,
  ranges: readonly MinuteRange[],
  localDates: readonly LocalDate[] = [DAY],
) =>
  writeScheduleBlocks(ports)({
    barberId: IVAN,
    locationId: SHOP,
    timeZone: FIXTURE_TIME_ZONE,
    ranges,
    localDates,
  });

describe('writeScheduleBlocks', () => {
  it('blocks a range through the exception writer, sanitized', async () => {
    const exceptions: ScheduleException[] = [];
    const { ports, keys } = writer(exceptions);
    expect((await block(ports, [wall(12)])).ok).toBe(true);
    expect(keys()).toEqual([['ivan__2026-08-05']]);
    expect(exceptions).toEqual([
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(12)]))),
    ]);
    expect(exceptions[0]).not.toHaveProperty('reason');
  });

  it('merges a range into the blocks the day already holds — never replacing them', async () => {
    const exceptions = [
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(15)]))),
    ];
    const { ports } = writer(exceptions);
    expect((await block(ports, [wall(12)])).ok).toBe(true);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [wall(12), wall(15)],
    });
  });

  it('stands the whole day down on no range — CLOSED, no ranges', async () => {
    const exceptions = [
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(15)]))),
    ];
    const { ports } = writer(exceptions);
    expect((await block(ports, [])).ok).toBe(true);
    const [written] = exceptions;
    expect(written?.exceptionEffect).toBe(ExceptionEffect.Closed);
    expect(written).not.toHaveProperty('exceptionRanges');
    expect(written).toEqual(stored(DAY, ExceptionEffectRule.closed()));
  });

  it('writes a series as ONE call, its days in the given order, a day off whole kept as stored', async () => {
    const off = stored(NEXT, ExceptionEffectRule.closed());
    const exceptions = [off];
    const { ports, keys } = writer(exceptions);
    expect((await block(ports, [span(12, 13)], [NEXT, DAY])).ok).toBe(true);
    expect(keys()).toEqual([['ivan__2026-08-06', 'ivan__2026-08-05']]);
    expect(exceptions).toEqual([
      off,
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([span(12, 13)]))),
    ]);
  });

  it('refuses a range with no minute and writes nothing', async () => {
    const exceptions: ScheduleException[] = [];
    const { ports } = writer(exceptions);
    const empty = MinuteRange.of(minute(720), endMinute(720));
    const result = await block(ports, [empty], [DAY, NEXT]);
    expect(!result.ok && result.error.errorCode).toBe(
      SchedulingErrorCode.ScheduleExceptionEmptyRanges,
    );
    expect(exceptions).toEqual([]);
  });
});

describe('clearScheduleBlock', () => {
  const clear = (
    ports: ScheduleExceptionPorts,
    range: MinuteRange | null,
    day: LocalDate = DAY,
  ) => clearScheduleBlock(ports)({ barberId: IVAN, localDate: day, range });

  it('lifts the whole day — the day’s document is deleted', async () => {
    const exceptions = [
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(12), wall(15)]))),
      stored(NEXT, ExceptionEffectRule.closed()),
    ];
    const { ports, keys } = writer(exceptions);
    expect((await clear(ports, null)).ok).toBe(true);
    expect(keys()).toEqual([['ivan__2026-08-05']]);
    expect(exceptions).toEqual([stored(NEXT, ExceptionEffectRule.closed())]);
  });

  it('lifts one block and keeps the rest of the day', async () => {
    const exceptions = [
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(12), wall(15)]))),
    ];
    const { ports } = writer(exceptions);
    expect((await clear(ports, wall(12))).ok).toBe(true);
    expect(exceptions).toEqual([
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(15)]))),
    ]);
  });

  it('deletes the day when its last block goes', async () => {
    const exceptions = [
      stored(DAY, unwrapOk(ExceptionEffectRule.blocked([wall(12)]))),
    ];
    const { ports } = writer(exceptions);
    expect((await clear(ports, wall(12))).ok).toBe(true);
    expect(exceptions).toEqual([]);
  });

  it('refuses one range from a day off whole and writes nothing', async () => {
    const off = stored(DAY, ExceptionEffectRule.closed());
    const exceptions = [off];
    const { ports } = writer(exceptions);
    const result = await clear(ports, wall(12));
    expect(!result.ok && result.error.errorCode).toBe(
      SchedulingErrorCode.ScheduleExceptionEmptyRanges,
    );
    expect(exceptions).toEqual([off]);
  });
});
