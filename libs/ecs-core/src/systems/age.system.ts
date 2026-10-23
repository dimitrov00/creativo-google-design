import { BirthDate } from '@core/components';
import { Result, LocalDate } from '@core/primitives';
import { IdentityError } from '@core/errors';

/**
 * AgeSystem — a person's age from a birth date and a calendar day (blueprint
 * §2.8): the registration window of the legacy identity and accounts
 * `BirthDate` classes (deleted in Phase 4b) and the birthday arithmetic
 * of the staff client card (`glance.presenter.ts` `birthdayIn`/`ageOn`,
 * `client-card.presenter.ts` `isBirthdayToday`).
 *
 * "Today" is a {@link LocalDate} — the shop day the boundary read off
 * `ShopNow.localDate` (Law 7.3), so no zone math runs here. Ages are WHOLE
 * calendar years through `LocalDate.wholeYearsBetween`: a year counts once
 * its anniversary has come round, and a 29 February birthday comes round on
 * 28 February in a common year.
 */

/** The registration window — one policy for identity and accounts (16–120). */
export const AgeWindow = {
  MinAge: 16,
  MaxAge: 120,
} as const;

/** Strict `YYYY-MM-DD` — the shape the server boundary accepts. */
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** February, and the last day of a common one — where a 29 February birthday is kept. */
const FEBRUARY = 2;
const LEAP_DAY = 29;
const LAST_OF_COMMON_FEBRUARY = 28;

/** The next birthday on or after a day. */
export type NextBirthday = {
  /** The day it is kept on (a 29 February one on the 28th in a common year). */
  readonly localDate: LocalDate;
  /** Whole days from the asked day; `0` when it is that very day. */
  readonly inDays: number;
  /** The age reached on it; `null` where no plausible figure exists ({@link AgeSystem.ageReachedOn}). */
  readonly turning: number | null;
};

/** `YYYY-MM-DD` of the raw segments, zero-padded as typed — the refusal's `attempted`. */
function isoOfParts(parts: BirthDate.Parts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** The calendar day a birth date names — total for every `BirthDate` (a real day by construction). */
function dayOfBirth(birthDate: BirthDate): LocalDate {
  const { year, month, day } = BirthDate.partsOf(birthDate);
  return LocalDate.fromEpochDay(LocalDate.epochDayOf(year, month, day));
}

export const AgeSystem = {
  /**
   * Whole calendar years from the birth date to `day` — negative
   * (truncated toward zero) when the birth date lies after it, as the
   * legacy `yearsUntil` read a future date.
   */
  ageOn(birthDate: BirthDate, day: LocalDate): number {
    return LocalDate.wholeYearsBetween(dayOfBirth(birthDate), day);
  },

  /**
   * The age as the legacy instant reader counted it (`yearsUntil`: the
   * fractional years from the birth day's midnight to an INSTANT of
   * `today`, truncated toward zero). For a birth on or before `today` that
   * is {@link ageOn}. For a birth after it, the anniversary of "now" that
   * falls ON the birth day is only reached at midnight: once `today` is past
   * its midnight, a birth exactly N years ahead reads −(N−1), not −N.
   */
  ageAtInstant(
    birthDate: BirthDate,
    today: LocalDate,
    pastMidnight: boolean,
  ): number {
    const birthDay = dayOfBirth(birthDate);
    if (birthDay <= today) return AgeSystem.ageOn(birthDate, today);
    const until = pastMidnight ? LocalDate.addDays(birthDay, -1) : birthDay;
    return -LocalDate.wholeYearsBetween(today, until);
  },

  /** The refusal an age earns against the window — `TOO_YOUNG` below 16, `TOO_OLD` above 120, else `null`. */
  windowRefusal(age: number): IdentityError | null {
    if (age < AgeWindow.MinAge) {
      return IdentityError.birthDateTooYoung(age, AgeWindow.MinAge);
    }
    if (age > AgeWindow.MaxAge) {
      return IdentityError.birthDateTooOld(age, AgeWindow.MaxAge);
    }
    return null;
  },

  /**
   * The registration check: a birth date after `today` is
   * `IDENTITY_BIRTH_DATE_IN_FUTURE` (today itself is not in the future);
   * otherwise the whole-years age must fall inside 16–120. The age on
   * success.
   */
  ageAt(birthDate: BirthDate, today: LocalDate): Result<number, IdentityError> {
    if (dayOfBirth(birthDate) > today) {
      return Result.err(IdentityError.birthDateInFuture(birthDate));
    }
    const age = AgeSystem.ageOn(birthDate, today);
    const refusal = AgeSystem.windowRefusal(age);
    return refusal === null ? Result.ok(age) : Result.err(refusal);
  },

  /**
   * The server boundary: a strict `YYYY-MM-DD` (surrounding whitespace
   * trimmed) naming a real day, inside the window. A shape refusal carries
   * the raw text; a calendar refusal (`1990-02-30`) the trimmed one.
   */
  parseIso(raw: string, today: LocalDate): Result<BirthDate, IdentityError> {
    const trimmed = raw.trim();
    if (!ISO_DATE_SHAPE.test(trimmed)) {
      return Result.err(IdentityError.birthDateInvalid(raw));
    }
    const birthDate = BirthDate.parse(trimmed);
    if (birthDate === null) {
      // Year 0000 is a real (proleptic) day the legacy ISO reader accepted:
      // no birth anyone has, so the WINDOW refuses it (`TOO_OLD`), as it
      // always did — not the calendar.
      const day = LocalDate.parse(trimmed);
      if (day.ok) {
        const refusal = AgeSystem.windowRefusal(
          LocalDate.wholeYearsBetween(day.value, today),
        );
        if (refusal !== null) return Result.err(refusal);
      }
      return Result.err(IdentityError.birthDateInvalid(trimmed));
    }
    const age = AgeSystem.ageAt(birthDate, today);
    return age.ok ? Result.ok(birthDate) : age;
  },

  /**
   * The DD / MM / YYYY form segments: integers naming a real day (no
   * 30 February, no month 13, year 1–9999), inside the window. A refusal
   * carries the segments as typed, zero-padded.
   */
  fromParts(
    parts: BirthDate.Parts,
    today: LocalDate,
  ): Result<BirthDate, IdentityError> {
    const birthDate = BirthDate.fromParts(parts);
    if (birthDate === null) {
      return Result.err(IdentityError.birthDateInvalid(isoOfParts(parts)));
    }
    const age = AgeSystem.ageAt(birthDate, today);
    return age.ok ? Result.ok(birthDate) : age;
  },

  /** The day a birthday is kept in `year` — a 29 February one on the 28th outside a leap year. */
  birthdayIn(birthDate: BirthDate, year: number): LocalDate {
    const { month, day } = BirthDate.partsOf(birthDate);
    const kept =
      month === FEBRUARY && day === LEAP_DAY && !LocalDate.isLeapYear(year)
        ? LAST_OF_COMMON_FEBRUARY
        : day;
    return LocalDate.fromEpochDay(LocalDate.epochDayOf(year, month, kept));
  },

  /** `day` is the person's birthday (kept on 28 February for a leap-day birth in a common year). */
  isBirthdayOn(birthDate: BirthDate, day: LocalDate): boolean {
    return AgeSystem.birthdayIn(birthDate, LocalDate.parts(day).year) === day;
  },

  /**
   * The age reached on a birthday: that day's year less the year of birth —
   * `null` outside 1–120, where the record holds no year a person can have
   * been born in (the card then says the day without a figure).
   */
  ageReachedOn(birthDate: BirthDate, day: LocalDate): number | null {
    const age = LocalDate.parts(day).year - BirthDate.partsOf(birthDate).year;
    return Number.isInteger(age) && age >= 1 && age <= AgeWindow.MaxAge
      ? age
      : null;
  },

  /** The first birthday on or after `day`, how far away it is, and the age it brings. */
  nextBirthday(birthDate: BirthDate, day: LocalDate): NextBirthday {
    const year = LocalDate.parts(day).year;
    const thisYear = AgeSystem.birthdayIn(birthDate, year);
    const next =
      thisYear >= day ? thisYear : AgeSystem.birthdayIn(birthDate, year + 1);
    return {
      localDate: next,
      inDays: LocalDate.daysBetween(day, next),
      turning: AgeSystem.ageReachedOn(birthDate, next),
    };
  },
} as const;
