import { MinuteRange } from './minute-range.data';
import { Result, ExceptionEffect } from '@core/primitives';
import { SchedulingError } from '@core/errors';

/**
 * The PUBLIC face of a schedule exception — its EFFECT, never its reason
 * (`schedule-exception-document.ts:39-91`). A sick day is GDPR Art. 9 data and
 * `/book` is browsable anonymously against documents rules cannot redact, so
 * the stored effect has no field a reason could ride in: sick, time off,
 * training and travel are all `CLOSED`; a break and an admin block are both
 * `BLOCKED`. Under §9 D16(b) this effect IS the record — the reasoned detail
 * lives in the staff UI's memory only (`ScheduleExceptionSystem.publicEffect`).
 *
 * A flat variant slice (Law 6): `ScheduleException` intersects it, so the
 * discriminator and the ranges sit at the root of the record.
 * `exceptionRanges` are wall-clock minutes of the exception's day,
 * normalized (sorted, merged), and never empty: an empty `HOURS` would
 * silently mean `CLOSED`.
 */
export type ExceptionEffectRule =
  | ExceptionEffectRule.Closed
  | ExceptionEffectRule.Hours
  | ExceptionEffectRule.Blocked;

const CLOSED: ExceptionEffectRule.Closed = {
  exceptionEffect: ExceptionEffect.Closed,
};

function withRanges<K extends ExceptionEffectRule.Ranged['exceptionEffect']>(
  exceptionEffect: K,
  ranges: readonly MinuteRange[],
): Result<
  {
    readonly exceptionEffect: K;
    readonly exceptionRanges: readonly MinuteRange[];
  },
  SchedulingError
> {
  const normalized = MinuteRange.normalize(ranges);
  if (normalized.length === 0) {
    return Result.err(
      SchedulingError.scheduleExceptionEmptyRanges(exceptionEffect),
    );
  }
  return Result.ok({ exceptionEffect, exceptionRanges: normalized });
}

export const ExceptionEffectRule = {
  closed(): ExceptionEffectRule.Closed {
    return CLOSED;
  },

  /** Different hours that day; refused with no range (`SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES`). */
  hours(
    ranges: readonly MinuteRange[],
  ): Result<ExceptionEffectRule.Hours, SchedulingError> {
    return withRanges(ExceptionEffect.Hours, ranges);
  },

  /** Ranges taken out of the roster; refused with no range. */
  blocked(
    ranges: readonly MinuteRange[],
  ): Result<ExceptionEffectRule.Blocked, SchedulingError> {
    return withRanges(ExceptionEffect.Blocked, ranges);
  },

  /** The barber is off for the whole day. */
  isWholeDay(rule: ExceptionEffectRule): boolean {
    return rule.exceptionEffect === ExceptionEffect.Closed;
  },

  /** The ranges stand in for the roster rather than carving into it. */
  replacesRoster(rule: ExceptionEffectRule): boolean {
    return rule.exceptionEffect === ExceptionEffect.Hours;
  },
} as const;

export namespace ExceptionEffectRule {
  export type Closed = {
    readonly exceptionEffect: typeof ExceptionEffect.Closed;
  };
  export type Hours = {
    readonly exceptionEffect: typeof ExceptionEffect.Hours;
    readonly exceptionRanges: readonly MinuteRange[];
  };
  export type Blocked = {
    readonly exceptionEffect: typeof ExceptionEffect.Blocked;
    readonly exceptionRanges: readonly MinuteRange[];
  };
  /** The two range-bearing effects. */
  export type Ranged = Hours | Blocked;
}
