import { MinuteRange } from './minute-range.data';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

/** What a schedule exception does to a day — the ONLY source of these strings. */
export const ExceptionEffectKind = {
  /** Unavailable all day — every whole-day reason collapses here. */
  Closed: 'closed',
  /** Works different hours that day — the ranges REPLACE the roster. */
  Hours: 'hours',
  /** Works the roster minus these ranges. */
  Blocked: 'blocked',
} as const;
export type ExceptionEffectKind =
  (typeof ExceptionEffectKind)[keyof typeof ExceptionEffectKind];

/**
 * The PUBLIC face of a schedule exception — its EFFECT, never its reason
 * (`schedule-exception-document.ts:39-91`). A sick day is GDPR Art. 9 data and
 * `/book` is browsable anonymously against documents rules cannot redact, so
 * the stored effect has no field a reason could ride in: sick, time off,
 * training and travel are all `closed`; a break and an admin block are both
 * `blocked`. Under §9 D16(b) this effect IS the record — the reasoned detail
 * lives in the staff UI's memory only (`ScheduleExceptionSystem.publicEffect`).
 *
 * Ranges are wall-clock minutes of the exception's day, normalized (sorted,
 * merged), and never empty: an empty `hours` would silently mean `closed`.
 */
export type ExceptionEffect =
  ExceptionEffect.Closed | ExceptionEffect.Hours | ExceptionEffect.Blocked;

const CLOSED: ExceptionEffect.Closed = { kind: ExceptionEffectKind.Closed };

function withRanges<K extends ExceptionEffect.Ranged['kind']>(
  kind: K,
  ranges: readonly MinuteRange[],
): Result<
  { readonly kind: K; readonly ranges: readonly MinuteRange[] },
  SchedulingError
> {
  const normalized = MinuteRange.normalize(ranges);
  if (normalized.length === 0) {
    return Result.err(SchedulingError.scheduleExceptionEmptyRanges(kind));
  }
  return Result.ok({ kind, ranges: normalized });
}

export const ExceptionEffect = {
  closed(): ExceptionEffect.Closed {
    return CLOSED;
  },

  /** Different hours that day; refused with no range (`scheduling.schedule_exception.empty_ranges`). */
  hours(
    ranges: readonly MinuteRange[],
  ): Result<ExceptionEffect.Hours, SchedulingError> {
    return withRanges(ExceptionEffectKind.Hours, ranges);
  },

  /** Ranges taken out of the roster; refused with no range. */
  blocked(
    ranges: readonly MinuteRange[],
  ): Result<ExceptionEffect.Blocked, SchedulingError> {
    return withRanges(ExceptionEffectKind.Blocked, ranges);
  },

  /** The barber is off for the whole day. */
  isWholeDay(effect: ExceptionEffect): boolean {
    return effect.kind === ExceptionEffectKind.Closed;
  },

  /** The ranges stand in for the roster rather than carving into it. */
  replacesRoster(effect: ExceptionEffect): boolean {
    return effect.kind === ExceptionEffectKind.Hours;
  },
} as const;

export namespace ExceptionEffect {
  export type Closed = { readonly kind: typeof ExceptionEffectKind.Closed };
  export type Hours = {
    readonly kind: typeof ExceptionEffectKind.Hours;
    readonly ranges: readonly MinuteRange[];
  };
  export type Blocked = {
    readonly kind: typeof ExceptionEffectKind.Blocked;
    readonly ranges: readonly MinuteRange[];
  };
  /** The two range-bearing effects. */
  export type Ranged = Hours | Blocked;
}
