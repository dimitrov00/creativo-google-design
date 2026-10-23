import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ExceptionEffect, BarberId, LocationId } from '@core/primitives';
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
  minute,
  unwrapErr,
  unwrapOk,
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

  it('knows which reasons take the whole day', () => {
    expect(
      ScheduleExceptionSystem.isWholeDay({
        exceptionReason: ExceptionReason.Sick,
        sickPaid: false,
      }),
    ).toBe(true);
    expect(
      ScheduleExceptionSystem.isWholeDay({
        exceptionReason: ExceptionReason.Closed,
      }),
    ).toBe(true);
    expect(
      ScheduleExceptionSystem.isWholeDay({
        exceptionReason: ExceptionReason.Hours,
        exceptionRanges: [range('10:00', '12:00')],
      }),
    ).toBe(false);
    expect(
      ScheduleExceptionSystem.isWholeDay({
        exceptionReason: ExceptionReason.Break,
        exceptionRanges: [range('10:00', '12:00')],
        breakPaid: false,
      }),
    ).toBe(false);
  });
});

describe('ScheduleExceptionSystem — a location-wide closure fans out to every barber', () => {
  // Copied from roster-window.spec.ts:259 ('a location-wide closure removes
  // the day for every barber'): its `isLocationWide()` and
  // `appliesTo(anyone)` assertions. The day's removal itself is
  // roster.system.spec.ts ('a closed effect on the day removes it…').
  it('applies a shop-wide closure to any barber, as the same closed effect', () => {
    const anyone = BarberId.of('anyone');
    const ivan = BarberId.of('ivan');
    expect(ScheduleExceptionSystem.isLocationWide(null)).toBe(true);
    expect(ScheduleExceptionSystem.appliesTo(null, anyone)).toBe(true);
    expect(ScheduleExceptionSystem.appliesTo(null, ivan)).toBe(true);
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

  it('applies one barber’s exception to that barber only', () => {
    const ivan = BarberId.of('ivan');
    expect(ScheduleExceptionSystem.isLocationWide(ivan)).toBe(false);
    expect(ScheduleExceptionSystem.appliesTo(ivan, ivan)).toBe(true);
    expect(ScheduleExceptionSystem.appliesTo(ivan, BarberId.of('stefan'))).toBe(
      false,
    );
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
