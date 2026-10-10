import {
  AgeSystem,
  AgeWindow,
  BirthDate as BirthDay,
  DayKey,
  type IdentityError,
  IdentityErrorCode,
} from '@creativo/ecs-core';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BirthDateError,
  BirthDateInvalidError,
  BirthDateTooOldError,
  BirthDateTooYoungError,
} from './birth-date.errors';

// Literals typed by the system's window: the compiler keeps them equal to
// `AgeWindow` while the module loads nothing of `AgeSystem` (eager bundle).
export const MIN_AGE: typeof AgeWindow.MinAge = 16;
export const MAX_AGE: typeof AgeWindow.MaxAge = 120;

/*
 * Phase 2 shim (ECS migration): the whole-years age and the 16–120 window
 * live in `AgeSystem` (`@creativo/ecs-core`), over calendar days. This class
 * keeps its parse (the kernel's ISO reading in `today`'s zone) and its
 * `accounts.birth_date.*` error classes; the helpers below are the only code
 * besides the delegating bodies.
 */

/** A parsed instant's calendar day, in its own zone. */
function dayOf(instant: ZonedDateTime): DayKey {
  return DayKey.of(instant.toISODate());
}

/**
 * Whole calendar years from the birth day to `today` (negative for a future
 * birth, truncated as the legacy instant reader truncated it — whether
 * `today` is past its own midnight decides the anniversary ON the birth day).
 */
function ageBetween(birth: ZonedDateTime, today: ZonedDateTime): number {
  return AgeSystem.ageAtInstant(
    BirthDay.of(birth.toISODate()),
    dayOf(today),
    today.toMillis() > today.startOfDay().toMillis(),
  );
}

/** The window refusal back as this context's error class. */
function toLegacyError(error: IdentityError): BirthDateError {
  return error.code === IdentityErrorCode.BirthDateTooOld
    ? new BirthDateTooOldError(error.age, error.maxAge)
    : error.code === IdentityErrorCode.BirthDateTooYoung
      ? new BirthDateTooYoungError(error.age, error.minAge)
      : new BirthDateInvalidError('');
}

/**
 * Date of birth. Genuinely new in this pass — v2 has no equivalent
 * primitive (§7.1 of the migration blueprint only documents the bug its
 * `DateString.fromDate` would have caused).
 *
 * The fix that bug ledger entry calls for: no calendar day is ever derived
 * from a raw `Date`/`Date.now()`. Age is always computed against an
 * explicitly-passed `today: ZonedDateTime` (itself sourced from the
 * `Clock` port by whichever layer composes the domain), never
 * `new Date()`. The birth date itself is parsed in `today`'s own zone so
 * the age arithmetic never straddles two different calendars.
 */
export class BirthDate {
  private constructor(private readonly _birth: ZonedDateTime) {}

  /**
   * Validating factory — checks both that `raw` is a real calendar date
   * AND that the age it implies (as of `today`) falls within [16, 120].
   * The age bounds are a creation-time invariant only (see
   * `reconstitute`).
   */
  static create(
    raw: string,
    today: ZonedDateTime,
  ): Result<BirthDate, BirthDateError[]> {
    const parsed = ZonedDateTime.fromISO(raw, today.zoneName);
    if (parsed.isFailure()) {
      return fail([new BirthDateInvalidError(raw)]);
    }

    const refusal = AgeSystem.windowRefusal(ageBetween(parsed.value, today));
    if (refusal !== null) {
      return fail([toLegacyError(refusal)]);
    }
    return ok(new BirthDate(parsed.value));
  }

  /**
   * Rebuild from persistence that was validated on the way in. Only the
   * calendar-date format is re-checked — the 16–120 age window is a
   * creation-time invariant, not something a stored, already-valid birth
   * date should ever fail on a later read (age only ever grows relative
   * to the date it was validated against). `today` is used only for its
   * time zone, so date parsing stays consistent with `create`.
   */
  static reconstitute(
    raw: string,
    today: ZonedDateTime,
  ): Result<BirthDate, BirthDateError[]> {
    const parsed = ZonedDateTime.fromISO(raw, today.zoneName);
    if (parsed.isFailure()) {
      return fail([new BirthDateInvalidError(raw)]);
    }
    return ok(new BirthDate(parsed.value));
  }

  /** Whole-years age as of `today` — never cached, always computed fresh. */
  ageAsOf(today: ZonedDateTime): number {
    return ageBetween(this._birth, today);
  }

  toISODate(): string {
    return this._birth.toISO().slice(0, 10);
  }

  equals(other: BirthDate): boolean {
    return this.toISODate() === other.toISODate();
  }

  toString(): string {
    return this.toISODate();
  }
}
