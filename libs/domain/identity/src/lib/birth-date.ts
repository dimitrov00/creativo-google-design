import {
  AgeSystem,
  AgeWindow,
  type IdentityError,
  IdentityErrorCode,
  type LocalDate,
  UtcEpochMs,
  ZonedTimeSystem,
  defect,
} from '@creativo/ecs-core';
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
// Literals typed by the system's window: the compiler keeps them equal to
// `AgeWindow` while the module loads nothing of `AgeSystem` (eager bundle).
export const BIRTH_DATE_MIN_AGE: typeof AgeWindow.MinAge = 16;
export const BIRTH_DATE_MAX_AGE: typeof AgeWindow.MaxAge = 120;

/** Raw segment values as collected by a DD/MM/YYYY form control. */
export interface BirthDateParts {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/*
 * Phase 2 shim (ECS migration): the age window, the calendar check and the
 * future check live in `AgeSystem` (`@creativo/ecs-core`); "today" is the
 * `today` instant's calendar day in its own zone. The helpers below are the
 * only code besides the delegating bodies.
 */

/**
 * An instant's calendar day in its own zone — the legacy instant converted
 * through `ZonedTimeSystem.toLocal` (flatten-spec §8.9). A `ZonedDateTime`
 * always names a real zone and an instant inside the window, so a refusal
 * is a defect.
 */
function localDateOf(instant: ZonedDateTime): LocalDate {
  const zone = ZonedTimeSystem.checkZone(instant.zoneName);
  const at = UtcEpochMs.of(instant.toMillis());
  if (!zone.ok || !at.ok) {
    return defect(`${instant.toISO()} has no shop-clock day`);
  }
  return ZonedTimeSystem.toLocal(at.value, zone.value).localDate;
}

/** The system's refusal struct back as this context's error class. */
function toLegacyError(error: IdentityError): BirthDateError {
  switch (error.errorCode) {
    case IdentityErrorCode.BirthDateInFuture:
      return new BirthDateInFutureError(error.attempted);
    case IdentityErrorCode.BirthDateTooYoung:
      return new BirthDateTooYoungError(error.age, error.minAge);
    case IdentityErrorCode.BirthDateTooOld:
      return new BirthDateTooOldError(error.age, error.maxAge);
    default:
      return new BirthDateInvalidError(
        error.errorCode === IdentityErrorCode.BirthDateInvalid
          ? error.attempted
          : '',
      );
  }
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
    const checked = AgeSystem.fromParts(parts, localDateOf(today));
    return checked.ok
      ? ok(new BirthDate(checked.value))
      : fail(toLegacyError(checked.error));
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
    const checked = AgeSystem.parseIso(raw, localDateOf(today));
    return checked.ok
      ? ok(new BirthDate(checked.value))
      : fail(toLegacyError(checked.error));
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
