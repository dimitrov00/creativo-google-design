import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BirthDateError,
  BirthDateInFutureError,
  BirthDateInvalidError,
  BirthDateTooOldError,
  BirthDateTooYoungError,
} from './birth-date.errors';

/**
 * Deliberately the SAME window as `domain/accounts`' `BirthDate` (16–120):
 * a birthday accepted at registration must also survive the accounts
 * aggregate's own re-validation when the profile is saved/edited, so the
 * two contexts share one window by policy (not by import — see the class
 * doc below). Lowering the floor (e.g. to 13) is a one-line product
 * decision, but it must change in BOTH places together.
 */
export const BIRTH_DATE_MIN_AGE = 16;
export const BIRTH_DATE_MAX_AGE = 120;

/** Raw segment values as collected by a DD/MM/YYYY form control. */
export interface BirthDateParts {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toIsoDate(parts: BirthDateParts): string {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * OPTIONAL birthday collected at registration so the gamification/rewards
 * system can (admin-configurably) offer birthday presents. The email
 * variant's rationale applies verbatim: kept local to `domain/identity`
 * rather than importing `domain/accounts`' own `BirthDate` so this bounded
 * context never structurally depends on another one for a value object it
 * needs at its own boundary.
 *
 * The age window (16–120) deliberately matches accounts' `BirthDate`
 * exactly — see `BIRTH_DATE_MIN_AGE` above. A value that passes this
 * registration-boundary check must never later fail the accounts-side
 * re-validation with generic copy; both bounds are creation-time
 * invariants only.
 *
 * §7.1 discipline: no calendar day is ever derived from a raw
 * `Date`/`Date.now()` — age is always computed against an explicitly
 * passed `today: ZonedDateTime` (sourced from the `Clock` port by whichever
 * layer composes the domain), and the birth date is parsed in `today`'s own
 * zone so the arithmetic never straddles two calendars.
 */
export class BirthDate {
  private constructor(private readonly _iso: string) {}

  /**
   * Validating factory from form segments — checks the parts form a REAL
   * calendar date (no Feb 30), that it lies in the past, and that the age
   * it implies (as of `today`) falls within [16, 120].
   */
  static create(
    parts: BirthDateParts,
    today: ZonedDateTime,
  ): Result<BirthDate, BirthDateError> {
    const { day, month, year } = parts;
    if (
      !Number.isInteger(day) ||
      !Number.isInteger(month) ||
      !Number.isInteger(year) ||
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12 ||
      year < 1 ||
      year > 9999
    ) {
      return fail(new BirthDateInvalidError(toIsoDate(parts)));
    }
    return BirthDate.validate(toIsoDate(parts), today);
  }

  /**
   * Validating factory from an ISO `YYYY-MM-DD` string — the server
   * boundary's entry point for the client-submitted value. Same invariants
   * as `create`.
   */
  static createFromISO(
    raw: string,
    today: ZonedDateTime,
  ): Result<BirthDate, BirthDateError> {
    if (!ISO_DATE_PATTERN.test(raw.trim())) {
      return fail(new BirthDateInvalidError(raw));
    }
    return BirthDate.validate(raw.trim(), today);
  }

  private static validate(
    iso: string,
    today: ZonedDateTime,
  ): Result<BirthDate, BirthDateError> {
    // Parsed in `today`'s own zone — Luxon rejects impossible calendar
    // dates (2001-02-30) outright.
    const parsed = ZonedDateTime.fromISO(iso, today.zoneName);
    if (parsed.isFailure()) {
      return fail(new BirthDateInvalidError(iso));
    }
    if (parsed.value.isAfter(today)) {
      return fail(new BirthDateInFutureError(iso));
    }
    const age = parsed.value.yearsUntil(today);
    if (age < BIRTH_DATE_MIN_AGE) {
      return fail(new BirthDateTooYoungError(age, BIRTH_DATE_MIN_AGE));
    }
    if (age > BIRTH_DATE_MAX_AGE) {
      return fail(new BirthDateTooOldError(age, BIRTH_DATE_MAX_AGE));
    }
    return ok(new BirthDate(iso));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: string): BirthDate {
    return new BirthDate(trusted);
  }

  get day(): number {
    return Number(this._iso.slice(8, 10));
  }

  get month(): number {
    return Number(this._iso.slice(5, 7));
  }

  get year(): number {
    return Number(this._iso.slice(0, 4));
  }

  /** ISO `YYYY-MM-DD`. */
  toISODate(): string {
    return this._iso;
  }

  equals(other: BirthDate): boolean {
    return this._iso === other._iso;
  }

  /** ISO `YYYY-MM-DD` — the persistence/wire format. */
  toString(): string {
    return this._iso;
  }
}
