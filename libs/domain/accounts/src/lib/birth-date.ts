import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BirthDateError,
  BirthDateInvalidError,
  BirthDateTooOldError,
  BirthDateTooYoungError,
} from './birth-date.errors';

export const MIN_AGE = 16;
export const MAX_AGE = 120;

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

    const age = parsed.value.yearsUntil(today);
    const errors: BirthDateError[] = [];
    if (age < MIN_AGE) {
      errors.push(new BirthDateTooYoungError(age, MIN_AGE));
    }
    if (age > MAX_AGE) {
      errors.push(new BirthDateTooOldError(age, MAX_AGE));
    }
    if (errors.length > 0) {
      return fail(errors);
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
    return this._birth.yearsUntil(today);
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
