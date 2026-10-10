import { BirthDate } from '../components/birth-date.data';
import { DayKey } from '../components/day-key.data';
import { IdentityError } from '../components/identity-errors.data';
import { Result } from '../components/result.data';
import { ZonedTimeSystem } from './zoned-time.system';

/**
 * AgeSystem — a person's age from a birth date and a calendar day (blueprint
 * §2.8): the registration window of the identity and accounts `BirthDate`
 * classes (`libs/domain/identity/src/lib/birth-date.ts`,
 * `libs/domain/accounts/src/lib/birth-date.ts`) and the birthday arithmetic
 * of the staff client card (`glance.presenter.ts` `birthdayIn`/`ageOn`,
 * `client-card.presenter.ts` `isBirthdayToday`).
 *
 * "Today" is a {@link DayKey} — the pipeline or store reads it off the
 * zone's day table (`ZonedTimeSystem.dayKeyOf(nowMs, days)`), so no zone
 * math runs here. Ages are WHOLE calendar years through
 * `ZonedTimeSystem.wholeYearsBetween`: a year counts once its anniversary
 * has come round, and a 29 February birthday comes round on 28 February in
 * a common year.
 */

/** The registration window — one policy for identity and accounts (16–120). */
export const AgeWindow = {
  MinAge: 16,
  MaxAge: 120,
} as const;

/** Strict `YYYY-MM-DD` — the shape the server boundary accepts. */
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const LEAP_DAY = '02-29';
const LAST_OF_COMMON_FEBRUARY = '02-28';

/** The next birthday on or after a day. */
export type NextBirthday = {
  /** The day it is kept on (a 29 February one on the 28th in a common year). */
  readonly dayKey: DayKey;
  /** Whole days from the asked day; `0` when it is that very day. */
  readonly inDays: number;
  /** The age reached on it; `null` where no plausible figure exists ({@link AgeSystem.ageReachedOn}). */
  readonly turning: number | null;
};

/** `YYYY-MM-DD` of the raw segments, zero-padded as typed — the refusal's `attempted`. */
function isoOfParts(parts: BirthDate.Parts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export const AgeSystem = {
  /**
   * Whole calendar years from the birth date to `dayKey` — negative
   * (truncated toward zero) when the birth date lies after it, as the
   * legacy `yearsUntil` read a future date.
   */
  ageOn(birthDate: BirthDate, dayKey: DayKey): number {
    return ZonedTimeSystem.wholeYearsBetween(DayKey.of(birthDate), dayKey);
  },

  /**
   * The age as the legacy instant reader counted it (`yearsUntil`: the
   * fractional years from the birth day's midnight to an INSTANT of
   * `todayKey`, truncated toward zero). For a birth on or before
   * `todayKey` that is {@link ageOn}. For a birth after it, the
   * anniversary of "now" that falls ON the birth day is only reached at
   * midnight: once `todayKey` is past its midnight, a birth exactly N years
   * ahead reads −(N−1), not −N.
   */
  ageAtInstant(
    birthDate: BirthDate,
    todayKey: DayKey,
    pastMidnight: boolean,
  ): number {
    const birthKey = DayKey.of(birthDate);
    if (birthKey <= todayKey) return AgeSystem.ageOn(birthDate, todayKey);
    const until = pastMidnight
      ? ZonedTimeSystem.addDays(birthKey, -1)
      : birthKey;
    return -ZonedTimeSystem.wholeYearsBetween(todayKey, until);
  },

  /** The refusal an age earns against the window — `too_young` below 16, `too_old` above 120, else `null`. */
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
   * The registration check: a birth date after `todayKey` is
   * `identity.birth_date.in_future` (today itself is not in the future);
   * otherwise the whole-years age must fall inside 16–120. The age on
   * success.
   */
  ageAt(birthDate: BirthDate, todayKey: DayKey): Result<number, IdentityError> {
    if (DayKey.of(birthDate) > todayKey) {
      return Result.err(IdentityError.birthDateInFuture(birthDate));
    }
    const age = AgeSystem.ageOn(birthDate, todayKey);
    const refusal = AgeSystem.windowRefusal(age);
    return refusal === null ? Result.ok(age) : Result.err(refusal);
  },

  /**
   * The server boundary: a strict `YYYY-MM-DD` (surrounding whitespace
   * trimmed) naming a real day, inside the window. A shape refusal carries
   * the raw text; a calendar refusal (`1990-02-30`) the trimmed one.
   */
  parseIso(raw: string, todayKey: DayKey): Result<BirthDate, IdentityError> {
    const trimmed = raw.trim();
    if (!ISO_DATE_SHAPE.test(trimmed)) {
      return Result.err(IdentityError.birthDateInvalid(raw));
    }
    const birthDate = BirthDate.parse(trimmed);
    if (birthDate === null) {
      // Year 0000 is a real (proleptic) day the legacy ISO reader accepted:
      // no birth anyone has, so the WINDOW refuses it (`too_old`), as it
      // always did — not the calendar.
      if (DayKey.isValid(trimmed)) {
        const refusal = AgeSystem.windowRefusal(
          ZonedTimeSystem.wholeYearsBetween(DayKey.of(trimmed), todayKey),
        );
        if (refusal !== null) return Result.err(refusal);
      }
      return Result.err(IdentityError.birthDateInvalid(trimmed));
    }
    const age = AgeSystem.ageAt(birthDate, todayKey);
    return age.ok ? Result.ok(birthDate) : age;
  },

  /**
   * The DD / MM / YYYY form segments: integers naming a real day (no
   * 30 February, no month 13, year 1–9999), inside the window. A refusal
   * carries the segments as typed, zero-padded.
   */
  fromParts(
    parts: BirthDate.Parts,
    todayKey: DayKey,
  ): Result<BirthDate, IdentityError> {
    const birthDate = BirthDate.fromParts(parts);
    if (birthDate === null) {
      return Result.err(IdentityError.birthDateInvalid(isoOfParts(parts)));
    }
    const age = AgeSystem.ageAt(birthDate, todayKey);
    return age.ok ? Result.ok(birthDate) : age;
  },

  /** The day a birthday is kept in `year` — a 29 February one on the 28th outside a leap year. */
  birthdayIn(birthDate: BirthDate, year: number): DayKey {
    const monthDay = birthDate.slice(5);
    const kept =
      monthDay === LEAP_DAY && !DayKey.isLeapYear(year)
        ? LAST_OF_COMMON_FEBRUARY
        : monthDay;
    return DayKey.of(`${String(year).padStart(4, '0')}-${kept}`);
  },

  /** `dayKey` is the person's birthday (kept on 28 February for a leap-day birth in a common year). */
  isBirthdayOn(birthDate: BirthDate, dayKey: DayKey): boolean {
    return (
      AgeSystem.birthdayIn(birthDate, Number(dayKey.slice(0, 4))) === dayKey
    );
  },

  /**
   * The age reached on a birthday: that day's year less the year of birth —
   * `null` outside 1–120, where the record holds no year a person can have
   * been born in (the card then says the day without a figure).
   */
  ageReachedOn(birthDate: BirthDate, dayKey: DayKey): number | null {
    const age = Number(dayKey.slice(0, 4)) - Number(birthDate.slice(0, 4));
    return Number.isInteger(age) && age >= 1 && age <= AgeWindow.MaxAge
      ? age
      : null;
  },

  /** The first birthday on or after `dayKey`, how far away it is, and the age it brings. */
  nextBirthday(birthDate: BirthDate, dayKey: DayKey): NextBirthday {
    const year = Number(dayKey.slice(0, 4));
    const thisYear = AgeSystem.birthdayIn(birthDate, year);
    const next =
      thisYear >= dayKey ? thisYear : AgeSystem.birthdayIn(birthDate, year + 1);
    return {
      dayKey: next,
      inDays: ZonedTimeSystem.daysBetween(dayKey, next),
      turning: AgeSystem.ageReachedOn(birthDate, next),
    };
  },
} as const;
