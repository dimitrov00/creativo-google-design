import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ExceptionEffect,
  BarberId,
  BusyKey,
  LocationId,
  ScheduleExceptionId,
} from '@core/primitives';
import type { ScheduleException, ScheduleExceptionMeta } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import {
  ExceptionEffectRule,
  MinuteRange,
  ExceptionDetail,
  ExceptionReason,
} from '@core/components';
import {
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { ScheduleExceptionSystem } from './schedule-exception.system';

/** `'12:00'` → minutes of the day. */
function at(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

function range(from: string, to: string): MinuteRange {
  return MinuteRange.of(minute(at(from)), endMinute(at(to)));
}

/*
 * Copied (not moved) from the legacy booking application lib's
 * `schedule-exception-document.spec.ts:40-120` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) — the GDPR boundary,
 * re-targeted from `exceptionToDocument(exception)` to
 * `ScheduleExceptionSystem.publicEffect(detail)`: under §9 D16(b) the public
 * effect IS the stored record, so the sanitiser is the system.
 */
describe('ScheduleExceptionSystem.publicEffect — the GDPR boundary', () => {
  // The whole point of the sanitizer: four different reasons, ONE public
  // effect. If any of these ever diverge, a sick day becomes derivable from
  // a collection `/book` reads anonymously.
  const unavailable: readonly ExceptionDetail[] = [
    { exceptionReason: ExceptionReason.TimeOff },
    { exceptionReason: ExceptionReason.Sick, sickPaid: true },
    {
      exceptionReason: ExceptionReason.Training,
      trainingTopic: 'Fades masterclass',
    },
    {
      exceptionReason: ExceptionReason.Travel,
      travelToLocationId: LocationId.of('loc-sea'),
    },
  ];

  it('renders every whole-day reason as the SAME closed effect', () => {
    const effects = unavailable.map((detail) =>
      unwrapOk(ScheduleExceptionSystem.publicEffect(detail)),
    );
    for (const effect of effects) {
      expect(effect).toEqual({ exceptionEffect: ExceptionEffect.Closed });
    }
    // Byte-for-byte identical, not merely same-shaped.
    const [first] = effects;
    for (const effect of effects) {
      expect(JSON.stringify(effect)).toBe(JSON.stringify(first));
    }
  });

  it('lets no reason vocabulary reach the effect at all', () => {
    const serialized = JSON.stringify(
      unavailable.map((detail) => ScheduleExceptionSystem.publicEffect(detail)),
    );
    for (const leak of [
      'sick',
      'SICK',
      'paid',
      'Paid',
      'training',
      'TRAINING',
      'topic',
      'Topic',
      'Fades',
      'travel',
      'TRAVEL',
      'loc-sea',
      'time_off',
      'TIME_OFF',
      'exceptionReason',
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('carves a partial block down to its ranges', () => {
    const effect = unwrapOk(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Admin,
        exceptionRanges: [range('12:00', '13:00')],
        // A note is staff-only data and must not survive the trip.
        adminNote: 'dentist appointment',
      }),
    );
    expect(effect).toEqual({
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [{ startMinutes: 720, endMinutes: 780 }],
    });
    expect(JSON.stringify(effect)).not.toContain('dentist');
  });

  it('keeps a one-off shift as sellable hours', () => {
    const effect = unwrapOk(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Hours,
        exceptionRanges: [range('11:00', '16:00')],
      }),
    );
    expect(effect).toEqual({
      exceptionEffect: ExceptionEffect.Hours,
      exceptionRanges: [{ startMinutes: 660, endMinutes: 960 }],
    });
  });

  it('round-trips as the record the availability engine reads', () => {
    const effect = unwrapOk(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Admin,
        exceptionRanges: [range('12:00', '13:00')],
        adminNote: '',
      }),
    );
    // The stored fields are the effect itself — no reader mapping: a
    // `BLOCKED` day reads back as a partial, roster-carving block.
    const parsed = JSON.parse(JSON.stringify(effect)) as ExceptionEffectRule;
    expect(parsed).toEqual(effect);
    expect(parsed.exceptionEffect).toBe(ExceptionEffect.Blocked);
    expect(ExceptionEffectRule.isWholeDay(parsed)).toBe(false);
    expect(ExceptionEffectRule.replacesRoster(parsed)).toBe(false);
  });
});

describe('ScheduleExceptionSystem — reasons and refusals', () => {
  it('sanitises a break like an admin block, paid or not', () => {
    const effect = unwrapOk(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Break,
        exceptionRanges: [range('13:00', '14:00')],
        breakPaid: true,
      }),
    );
    expect(effect).toEqual({
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('13:00', '14:00')],
    });
    expect(
      unwrapOk(
        ScheduleExceptionSystem.publicEffect({
          exceptionReason: ExceptionReason.Closed,
        }),
      ),
    ).toEqual(ExceptionEffectRule.closed());
  });

  it('refuses a range-bearing reason with no range — empty hours would mean closed', () => {
    const error = unwrapErr(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Hours,
        exceptionRanges: [],
      }),
    );
    expect(error.errorCode).toBe(
      SchedulingErrorCode.ScheduleExceptionEmptyRanges,
    );
  });

  it('normalizes the ranges it publishes', () => {
    const effect = unwrapOk(
      ScheduleExceptionSystem.publicEffect({
        exceptionReason: ExceptionReason.Admin,
        exceptionRanges: [
          range('14:00', '15:00'),
          range('09:00', '10:00'),
          range('09:30', '11:00'),
        ],
        adminNote: '',
      }),
    );
    expect(effect).toEqual({
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('09:00', '11:00'), range('14:00', '15:00')],
    });
  });
});

describe('ScheduleExceptionSystem — a location-wide closure fans out to every barber', () => {
  // From roster-window.spec.ts:259 ('a location-wide closure removes the
  // day for every barber'). Under D16(b) the applicability is the WRITE-time
  // fan-out — one `closed` exception per barber; the day's removal itself is
  // roster.system.spec.ts ('a closed effect on the day removes it…').
  it('applies a shop-wide closure to any barber, as the same closed effect', () => {
    const anyone = BarberId.of('anyone');
    const ivan = BarberId.of('ivan');
    // Fanned out, every barber's own exception publishes the one effect.
    const fanned = [anyone, ivan].map((barberId) => ({
      barberId,
      effect: unwrapOk(
        ScheduleExceptionSystem.publicEffect(ExceptionDetail.closed()),
      ),
    }));
    expect(fanned).toEqual([
      { barberId: anyone, effect: ExceptionEffectRule.closed() },
      { barberId: ivan, effect: ExceptionEffectRule.closed() },
    ]);
  });
});

describe('ScheduleExceptionSystem — the writer arithmetic', () => {
  it('merges overlapping and touching blocks into their union', () => {
    expect(
      ScheduleExceptionSystem.merge(
        [range('09:00', '10:00'), range('12:00', '13:00')],
        [range('10:00', '11:00'), range('12:30', '14:00')],
      ),
    ).toEqual([range('09:00', '11:00'), range('12:00', '14:00')]);
  });

  it('adds a range to a blocked day, a day of other hours and an empty day', () => {
    const blocked = unwrapOk(
      ExceptionEffectRule.blocked([range('09:00', '10:00')]),
    );
    expect(
      ScheduleExceptionSystem.addRanges(blocked, [range('09:30', '11:00')]),
    ).toEqual({
      ok: true,
      value: {
        exceptionEffect: ExceptionEffect.Blocked,
        exceptionRanges: [range('09:00', '11:00')],
      },
    });
    const hours = unwrapOk(
      ExceptionEffectRule.hours([range('11:00', '16:00')]),
    );
    expect(
      ScheduleExceptionSystem.addRanges(hours, [range('17:00', '18:00')]),
    ).toEqual({
      ok: true,
      value: {
        exceptionEffect: ExceptionEffect.Blocked,
        exceptionRanges: [range('11:00', '16:00'), range('17:00', '18:00')],
      },
    });
    expect(
      ScheduleExceptionSystem.addRanges(null, [range('12:00', '13:00')]),
    ).toEqual({
      ok: true,
      value: {
        exceptionEffect: ExceptionEffect.Blocked,
        exceptionRanges: [range('12:00', '13:00')],
      },
    });
  });

  it('leaves a whole day off alone — the ranges add nothing to it', () => {
    expect(
      ScheduleExceptionSystem.addRanges(ExceptionEffectRule.closed(), [
        range('12:00', '13:00'),
      ]),
    ).toBeNull();
  });

  it('lifts one block by its edges, keeping the others in order', () => {
    const ranges = [
      range('09:00', '10:00'),
      range('12:00', '13:00'),
      range('15:00', '16:00'),
    ];
    expect(
      ScheduleExceptionSystem.withoutRange(ranges, range('12:00', '13:00')),
    ).toEqual([range('09:00', '10:00'), range('15:00', '16:00')]);
    expect(
      ScheduleExceptionSystem.withoutRange(ranges, range('12:00', '12:30')),
    ).toEqual(ranges);
  });
});

describe('ScheduleExceptionSystem — purity and properties', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const existing = deepFreeze([
      range('09:00', '10:00'),
      range('12:00', '13:00'),
    ]);
    const add = deepFreeze([range('09:30', '12:00')]);
    const detail = deepFreeze<ExceptionDetail>({
      exceptionReason: ExceptionReason.Admin,
      exceptionRanges: [range('10:00', '11:00')],
      adminNote: 'x',
    });
    const once = ScheduleExceptionSystem.merge(existing, add);
    expect(ScheduleExceptionSystem.merge(existing, add)).toEqual(once);
    expect(ScheduleExceptionSystem.publicEffect(detail)).toEqual(
      ScheduleExceptionSystem.publicEffect(detail),
    );
    expect(existing).toEqual([
      range('09:00', '10:00'),
      range('12:00', '13:00'),
    ]);
    expect(add).toEqual([range('09:30', '12:00')]);
  });

  const anyRange = fc
    .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 240 }))
    .map(([start, length]) =>
      MinuteRange.of(minute(start), endMinute(Math.min(1440, start + length))),
    );

  /** Which minutes of the day a list covers — the brute-force oracle. */
  function minutes(ranges: readonly MinuteRange[]): readonly boolean[] {
    const covered = new Array<boolean>(1440).fill(false);
    for (const r of ranges) covered.fill(true, r.startMinutes, r.endMinutes);
    return covered;
  }

  it('merge covers exactly the minutes of both lists, sorted and disjoint', () => {
    fc.assert(
      fc.property(
        fc.array(anyRange, { maxLength: 8 }),
        fc.array(anyRange, { maxLength: 8 }),
        (a, b) => {
          const merged = ScheduleExceptionSystem.merge(a, b);
          expect(minutes(merged)).toEqual(minutes([...a, ...b]));
          let previous: MinuteRange | null = null;
          for (const range of merged) {
            // Disjoint AND not touching: a touching pair would have merged.
            if (previous !== null) {
              expect(range.startMinutes).toBeGreaterThan(previous.endMinutes);
            }
            previous = range;
          }
        },
      ),
    );
  });

  it('merge is commutative and idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(anyRange, { maxLength: 8 }),
        fc.array(anyRange, { maxLength: 8 }),
        (a, b) => {
          const merged = ScheduleExceptionSystem.merge(a, b);
          expect(ScheduleExceptionSystem.merge(b, a)).toEqual(merged);
          expect(ScheduleExceptionSystem.merge(merged, merged)).toEqual(merged);
          expect(ScheduleExceptionSystem.merge(merged, [])).toEqual(merged);
        },
      ),
    );
  });
});

/*
 * Pass C, Y-3 / Y-4 — the per-day decisions of `staff-day.store.ts`
 * `writeBlocks` and `clearBlock`, moved out of the store's transaction
 * closures. Restated from `staff-dashboard.spec.ts` «blocks a range through
 * the exception writer, sanitized», «merges a range into the blocks the day
 * already holds — never replacing them», «stands the whole day down when the
 * switch is on» and «arms the day-wide lift before it deletes anything»,
 * plus the boundary cases the closures held unpinned.
 */
const IVAN = BarberId.of('ivan');
const DAY = localDate('2026-08-05');
const META: ScheduleExceptionMeta = {
  id: ScheduleExceptionId.of(BusyKey.of(IVAN, DAY)),
  barberId: IVAN,
  localDate: DAY,
  utcEpochMs: utcMs('2026-08-05T00:00:00+03:00'),
  locationId: LocationId.of('loc-center'),
};
/** A day stored under an OLDER identity slice — the lift keeps it, the block replaces it. */
const STORED_META: ScheduleExceptionMeta = {
  ...META,
  utcEpochMs: utcMs('2026-08-04T23:00:00+02:00'),
  locationId: LocationId.of('loc-sea'),
};
const storedDay = (
  effect: ExceptionEffectRule,
  meta: ScheduleExceptionMeta = STORED_META,
): ScheduleException => ({ ...meta, ...effect });
const blockedEffect = (...ranges: MinuteRange[]): ExceptionEffectRule =>
  unwrapOk(ExceptionEffectRule.blocked(ranges));
const hoursEffect = (...ranges: MinuteRange[]): ExceptionEffectRule =>
  unwrapOk(ExceptionEffectRule.hours(ranges));

describe('ScheduleExceptionSystem.block — what a barber-day becomes', () => {
  it('blocks a range on an empty day, sanitized, under the given identity', () => {
    const next = unwrapOk(
      ScheduleExceptionSystem.block(null, [range('12:00', '13:00')], META),
    );
    expect(next).toEqual({
      ...META,
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('12:00', '13:00')],
    });
    expect(next).not.toHaveProperty('reason');
  });

  it('merges a range into the blocks the day already holds — never replacing them', () => {
    const lunch = storedDay(blockedEffect(range('15:00', '16:00')));
    expect(
      unwrapOk(
        ScheduleExceptionSystem.block(lunch, [range('12:00', '13:00')], META),
      ),
    ).toEqual({
      ...META,
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('12:00', '13:00'), range('15:00', '16:00')],
    });
  });

  it('merges touching and overlapping ranges, a stored HOURS day’s too, as BLOCKED', () => {
    const shortDay = storedDay(hoursEffect(range('10:00', '14:00')));
    expect(
      unwrapOk(
        ScheduleExceptionSystem.block(
          shortDay,
          [range('14:00', '15:00'), range('09:00', '10:30')],
          META,
        ),
      ),
    ).toEqual({
      ...META,
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('09:00', '15:00')],
    });
  });

  it('stands the whole day down on no range — CLOSED replaces whatever the day held', () => {
    for (const existing of [
      null,
      storedDay(blockedEffect(range('15:00', '16:00'))),
      storedDay(hoursEffect(range('10:00', '14:00'))),
      storedDay(ExceptionEffectRule.closed()),
    ]) {
      const next = unwrapOk(ScheduleExceptionSystem.block(existing, [], META));
      expect(next).toEqual({
        ...META,
        exceptionEffect: ExceptionEffect.Closed,
      });
      expect(next).not.toHaveProperty('exceptionRanges');
    }
  });

  it('keeps a day already off whole — null, never demoted to a partial block', () => {
    const off = storedDay(ExceptionEffectRule.closed());
    expect(
      unwrapOk(
        ScheduleExceptionSystem.block(off, [range('12:00', '13:00')], META),
      ),
    ).toBeNull();
  });

  it('refuses ranges that hold no minute — nothing is written', () => {
    const empty = MinuteRange.of(minute(720), endMinute(720));
    expect(
      unwrapErr(ScheduleExceptionSystem.block(null, [empty], META)).errorCode,
    ).toBe(SchedulingErrorCode.ScheduleExceptionEmptyRanges);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const existing = deepFreeze(
      storedDay(blockedEffect(range('15:00', '16:00'))),
    );
    const ranges = deepFreeze([range('12:00', '13:00')]);
    const meta = deepFreeze(META);
    const once = ScheduleExceptionSystem.block(existing, ranges, meta);
    expect(ScheduleExceptionSystem.block(existing, ranges, meta)).toEqual(once);
    expect(existing.exceptionEffect).toBe(ExceptionEffect.Blocked);
    expect(ranges).toEqual([range('12:00', '13:00')]);
  });
});

describe('ScheduleExceptionSystem.unblock — lifting a block', () => {
  it('deletes the day on the day-wide lift, whatever it held', () => {
    for (const existing of [
      storedDay(blockedEffect(range('12:00', '13:00'))),
      storedDay(ExceptionEffectRule.closed()),
      null,
    ]) {
      expect(
        unwrapOk(ScheduleExceptionSystem.unblock(existing, null)),
      ).toBeNull();
    }
  });

  it('deletes on a day with nothing stored', () => {
    expect(
      unwrapOk(ScheduleExceptionSystem.unblock(null, range('12:00', '13:00'))),
    ).toBeNull();
  });

  it('refuses one range from a day off whole — the day-wide lift is the honest path', () => {
    const error = unwrapErr(
      ScheduleExceptionSystem.unblock(
        storedDay(ExceptionEffectRule.closed()),
        range('12:00', '13:00'),
      ),
    );
    expect(error).toEqual({
      errorCode: SchedulingErrorCode.ScheduleExceptionEmptyRanges,
      exceptionKind: ExceptionEffect.Closed,
    });
  });

  it('deletes the day when the last range goes', () => {
    expect(
      unwrapOk(
        ScheduleExceptionSystem.unblock(
          storedDay(blockedEffect(range('12:00', '13:00'))),
          range('12:00', '13:00'),
        ),
      ),
    ).toBeNull();
  });

  it('keeps BLOCKED as BLOCKED and HOURS as HOURS, under the stored identity', () => {
    const two = [range('09:00', '10:00'), range('12:00', '13:00')];
    expect(
      unwrapOk(
        ScheduleExceptionSystem.unblock(
          storedDay(blockedEffect(...two)),
          range('12:00', '13:00'),
        ),
      ),
    ).toEqual({
      ...STORED_META,
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [range('09:00', '10:00')],
    });
    expect(
      unwrapOk(
        ScheduleExceptionSystem.unblock(
          storedDay(hoursEffect(...two)),
          range('09:00', '10:00'),
        ),
      ),
    ).toEqual({
      ...STORED_META,
      exceptionEffect: ExceptionEffect.Hours,
      exceptionRanges: [range('12:00', '13:00')],
    });
  });

  it('matches the range on its edges — a range not stored leaves the day as it was', () => {
    const day = storedDay(blockedEffect(range('12:00', '13:00')));
    expect(
      unwrapOk(ScheduleExceptionSystem.unblock(day, range('12:00', '12:30'))),
    ).toEqual(day);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const existing = deepFreeze(
      storedDay(
        blockedEffect(range('09:00', '10:00'), range('12:00', '13:00')),
      ),
    );
    const gone = deepFreeze(range('12:00', '13:00'));
    const once = ScheduleExceptionSystem.unblock(existing, gone);
    expect(ScheduleExceptionSystem.unblock(existing, gone)).toEqual(once);
    expect(existing).toEqual(
      storedDay(
        blockedEffect(range('09:00', '10:00'), range('12:00', '13:00')),
      ),
    );
  });
});
