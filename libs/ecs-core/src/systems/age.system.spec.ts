import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BirthDate } from '../components/birth-date.data';
import { IdentityErrorCode } from '../components/identity-errors.data';
import { LocalDate } from '../primitives/local-date.primitive';
import { deepFreeze, localDate, unwrapErr, unwrapOk } from '../testing';
import { AgeSystem, AgeWindow } from './age.system';

/*
 * The cases of BOTH birth-date specs, COPIED and re-targeted:
 * libs/domain/accounts/src/lib/birth-date.spec.ts and
 * libs/domain/identity/src/lib/birth-date.spec.ts. "Today" was a
 * `ZonedDateTime` noon in Europe/Sofia; it is now the shop's `LocalDate`
 * (what `ShopNow.localDate` answers for it), and the age is whole calendar
 * years over local dates. The accounts codes (`accounts.birth_date.*`)
 * collapsed into the identity ones (blueprint §2.7); the accounts class's
 * "a future date is too young" reading is `ageOn` + `windowRefusal`, the
 * identity class's `IN_FUTURE` is `ageAt`.
 * The class specs keep running against their shims.
 *
 * Also copied: the birth-date reasons of apps/functions/src/use-cases/
 * complete-registration.use-case.spec.ts, and the birthday arithmetic of the
 * staff client card (glance.presenter.spec.ts BD, client-card.presenter.spec
 * `isBirthdayToday`).
 */

const day = (raw: string): LocalDate => localDate(raw);
const bd = (raw: string): BirthDate => BirthDate.of(raw);

/** accounts/birth-date.spec.ts: 2026-07-22T12:00 Europe/Sofia. */
const ACCOUNTS_TODAY = day('2026-07-22');
/** identity/birth-date.spec.ts: 2026-07-25T12:00 Europe/Sofia. */
const TODAY = day('2026-07-25');

describe('AgeSystem — accounts BirthDate.create (accounts/birth-date.spec.ts)', () => {
  /** The accounts reading: parse, then the window over the raw age. */
  function accountsCreate(raw: string) {
    const birthDate = BirthDate.parse(raw);
    if (birthDate === null)
      return { errorCode: IdentityErrorCode.BirthDateInvalid };
    return AgeSystem.windowRefusal(AgeSystem.ageOn(birthDate, ACCOUNTS_TODAY));
  }

  it('accepts someone exactly 16 today', () => {
    expect(accountsCreate('2010-07-22')).toBeNull();
  });

  it('rejects someone who turns 16 tomorrow (15 today)', () => {
    expect(accountsCreate('2010-07-23')).toEqual({
      errorCode: IdentityErrorCode.BirthDateTooYoung,
      age: 15,
      minAge: 16,
    });
  });

  it('accepts someone exactly 120 today', () => {
    expect(accountsCreate('1906-07-22')).toBeNull();
  });

  it('rejects someone who is 121', () => {
    expect(accountsCreate('1905-07-22')?.errorCode).toBe(
      IdentityErrorCode.BirthDateTooOld,
    );
  });

  it('rejects a malformed calendar date', () => {
    expect(accountsCreate('not-a-date')?.errorCode).toBe(
      IdentityErrorCode.BirthDateInvalid,
    );
  });

  it('rejects a birth date in the future', () => {
    // The accounts reading: a negative age, too young.
    expect(accountsCreate('2030-01-01')).toEqual({
      errorCode: IdentityErrorCode.BirthDateTooYoung,
      age: -3,
      minAge: 16,
    });
    // The identity reading: in the future.
    expect(
      unwrapErr(AgeSystem.ageAt(bd('2030-01-01'), ACCOUNTS_TODAY)),
    ).toEqual({
      errorCode: IdentityErrorCode.BirthDateInFuture,
      attempted: '2030-01-01',
    });
  });

  it('accepts a stored date implying an age above 120 — only the format is re-checked', () => {
    const stored = BirthDate.parse('1800-01-01');
    expect(stored).toBe('1800-01-01');
    expect(AgeSystem.ageOn(stored as BirthDate, ACCOUNTS_TODAY)).toBe(226);
  });

  it('still rejects a malformed calendar date', () => {
    expect(BirthDate.parse('not-a-date')).toBeNull();
  });

  it('computes whole-years age against an explicit today', () => {
    expect(AgeSystem.ageOn(bd('2000-01-01'), ACCOUNTS_TODAY)).toBe(26);
  });

  it('equals() compares by calendar day', () => {
    expect(BirthDate.equals(bd('2000-01-01'), bd('2000-01-01'))).toBe(true);
  });
});

describe('AgeSystem.ageAtInstant — the legacy instant reader (accounts BirthDate)', () => {
  // `yearsUntil` truncated the fractional years from the birth day's
  // midnight to an INSTANT of today. Found by a side-by-side run of the
  // legacy class: only a future birth on today's own month-day differs
  // from whole calendar years.
  it('is ageOn for a birth on or before today, whatever the hour', () => {
    for (const raw of [
      '2000-01-01',
      '2010-07-22',
      '2010-07-23',
      '1906-07-22',
    ]) {
      for (const pastMidnight of [true, false]) {
        expect(
          AgeSystem.ageAtInstant(bd(raw), ACCOUNTS_TODAY, pastMidnight),
        ).toBe(AgeSystem.ageOn(bd(raw), ACCOUNTS_TODAY));
      }
    }
  });

  it('reads a birth exactly N years ahead as −(N−1) once today is past midnight', () => {
    expect(AgeSystem.ageAtInstant(bd('2027-07-22'), ACCOUNTS_TODAY, true)).toBe(
      -0,
    );
    expect(AgeSystem.ageAtInstant(bd('2029-07-22'), ACCOUNTS_TODAY, true)).toBe(
      -2,
    );
    // …and as −N at midnight exactly, when "now" IS the anniversary.
    expect(
      AgeSystem.ageAtInstant(bd('2027-07-22'), ACCOUNTS_TODAY, false),
    ).toBe(-1);
    expect(
      AgeSystem.ageAtInstant(bd('2029-07-22'), ACCOUNTS_TODAY, false),
    ).toBe(-3);
    // Off the anniversary the hour changes nothing.
    for (const pastMidnight of [true, false]) {
      expect(
        AgeSystem.ageAtInstant(bd('2030-01-01'), ACCOUNTS_TODAY, pastMidnight),
      ).toBe(-3);
      expect(
        AgeSystem.ageAtInstant(bd('2026-07-23'), ACCOUNTS_TODAY, pastMidnight),
      ).toBe(-0);
    }
  });

  it('keeps a 29 February "now" on 28 February in a common year', () => {
    const leapToday = day('2028-02-29');
    expect(AgeSystem.ageAtInstant(bd('2029-02-28'), leapToday, true)).toBe(-0);
    expect(AgeSystem.ageAtInstant(bd('2029-02-28'), leapToday, false)).toBe(-1);
  });
});

describe('AgeSystem — identity BirthDate (identity/birth-date.spec.ts)', () => {
  describe('fromParts (create from segments)', () => {
    it('accepts a real past date inside the age window and canonicalizes to ISO', () => {
      const birthDate = unwrapOk(
        AgeSystem.fromParts({ day: 3, month: 7, year: 1990 }, TODAY),
      );
      expect(birthDate).toBe('1990-07-03');
      expect(BirthDate.partsOf(birthDate)).toEqual({
        day: 3,
        month: 7,
        year: 1990,
      });
    });

    it('rejects an impossible calendar date (Feb 30) as invalid', () => {
      expect(
        unwrapErr(
          AgeSystem.fromParts({ day: 30, month: 2, year: 1990 }, TODAY),
        ),
      ).toEqual({
        errorCode: IdentityErrorCode.BirthDateInvalid,
        attempted: '1990-02-30',
      });
    });

    it('rejects out-of-range segments without ever building a date', () => {
      for (const parts of [
        { day: 0, month: 5, year: 1990 },
        { day: 32, month: 5, year: 1990 },
        { day: 5, month: 13, year: 1990 },
        { day: 5.5, month: 5, year: 1990 },
        { day: 5, month: 5, year: 0 },
      ]) {
        expect(unwrapErr(AgeSystem.fromParts(parts, TODAY)).errorCode).toBe(
          IdentityErrorCode.BirthDateInvalid,
        );
      }
    });

    it('rejects a date in the future', () => {
      expect(
        unwrapErr(AgeSystem.fromParts({ day: 1, month: 1, year: 2027 }, TODAY)),
      ).toEqual({
        errorCode: IdentityErrorCode.BirthDateInFuture,
        attempted: '2027-01-01',
      });
    });

    it('rejects an age below 16 — counting the birthday only once it has passed', () => {
      // Turns 16 tomorrow (2026-07-26) — still 15 today.
      expect(
        unwrapErr(AgeSystem.fromParts({ day: 26, month: 7, year: 2010 }, TODAY))
          .errorCode,
      ).toBe(IdentityErrorCode.BirthDateTooYoung);

      // Turned 16 today — accepted.
      expect(
        AgeSystem.fromParts({ day: 25, month: 7, year: 2010 }, TODAY).ok,
      ).toBe(true);
    });

    it('rejects an age above 120', () => {
      expect(
        unwrapErr(AgeSystem.fromParts({ day: 1, month: 1, year: 1900 }, TODAY)),
      ).toEqual({
        errorCode: IdentityErrorCode.BirthDateTooOld,
        age: 126,
        maxAge: 120,
      });
    });
  });

  describe('parseIso (createFromISO — the server boundary)', () => {
    it('accepts a strict YYYY-MM-DD string with the same invariants', () => {
      expect(unwrapOk(AgeSystem.parseIso('1990-07-03', TODAY))).toBe(
        '1990-07-03',
      );
      expect(unwrapOk(AgeSystem.parseIso(' 1990-07-03 ', TODAY))).toBe(
        '1990-07-03',
      );
    });

    it('rejects non-ISO shapes outright', () => {
      for (const raw of ['03.07.1990', '1990-7-3', '19900703', 'yesterday']) {
        expect(unwrapErr(AgeSystem.parseIso(raw, TODAY))).toEqual({
          errorCode: IdentityErrorCode.BirthDateInvalid,
          attempted: raw,
        });
      }
    });

    it('applies the same age window as create', () => {
      expect(unwrapErr(AgeSystem.parseIso('2020-01-01', TODAY)).errorCode).toBe(
        IdentityErrorCode.BirthDateTooYoung,
      );
    });

    it('refuses year 0000 by the window, as the legacy ISO reader did — not as text', () => {
      expect(unwrapErr(AgeSystem.parseIso('0000-01-01', TODAY))).toEqual({
        errorCode: IdentityErrorCode.BirthDateTooOld,
        age: 2026,
        maxAge: 120,
      });
      expect(unwrapErr(AgeSystem.parseIso('0000-02-30', TODAY))).toEqual({
        errorCode: IdentityErrorCode.BirthDateInvalid,
        attempted: '0000-02-30',
      });
    });
  });

  describe('fromPrimitive', () => {
    it('rebuilds a stored value without re-running creation invariants', () => {
      expect(BirthDate.of('1990-07-03')).toBe('1990-07-03');
    });
  });

  it('equals compares by calendar date', () => {
    expect(BirthDate.equals(bd('1990-07-03'), bd('1990-07-03'))).toBe(true);
    expect(BirthDate.equals(bd('1990-07-03'), bd('1990-07-04'))).toBe(false);
  });
});

describe('AgeSystem — the registration boundary (complete-registration.use-case.spec.ts)', () => {
  it('rejects an invalid birthDate with the typed, reason-carrying error', () => {
    for (const [raw, reason] of [
      ['2030-01-01', IdentityErrorCode.BirthDateInFuture],
      ['1990-02-30', IdentityErrorCode.BirthDateInvalid],
      ['03.07.1990', IdentityErrorCode.BirthDateInvalid],
      ['2020-01-01', IdentityErrorCode.BirthDateTooYoung],
    ] as const) {
      expect(unwrapErr(AgeSystem.parseIso(raw, TODAY)).errorCode).toBe(reason);
    }
    expect(unwrapErr(AgeSystem.parseIso('1990-02-30', TODAY))).toEqual({
      errorCode: IdentityErrorCode.BirthDateInvalid,
      attempted: '1990-02-30',
    });
  });

  it('persists a valid optional birthDate', () => {
    expect(unwrapOk(AgeSystem.parseIso('1990-07-03', TODAY))).toBe(
      '1990-07-03',
    );
  });
});

describe('AgeSystem — 29 February', () => {
  it('completes the year on 28 February in a common year, on the 29th in a leap year', () => {
    const leapling = bd('2000-02-29');
    expect(AgeSystem.ageOn(leapling, day('2025-02-27'))).toBe(24);
    expect(AgeSystem.ageOn(leapling, day('2025-02-28'))).toBe(25);
    expect(AgeSystem.ageOn(leapling, day('2028-02-28'))).toBe(27);
    expect(AgeSystem.ageOn(leapling, day('2028-02-29'))).toBe(28);
  });

  it('turns 16 on 29 February itself when the sixteenth year is a leap year', () => {
    const leapling = bd('2000-02-29');
    expect(AgeSystem.ageAt(leapling, day('2016-02-28')).ok).toBe(false);
    expect(unwrapOk(AgeSystem.ageAt(leapling, day('2016-02-29')))).toBe(16);
  });

  it('completes every later year on 28 February in a common year', () => {
    expect(unwrapOk(AgeSystem.ageAt(bd('2005-02-28'), day('2021-02-28')))).toBe(
      16,
    );
    const leapBorn = bd('2004-02-29');
    expect(unwrapOk(AgeSystem.ageAt(leapBorn, day('2021-02-28')))).toBe(17);
    expect(AgeSystem.ageOn(leapBorn, day('2023-02-28'))).toBe(19);
    expect(AgeSystem.ageOn(leapBorn, day('2023-02-27'))).toBe(18);
  });
});

describe('AgeSystem — the client card birthday (glance.presenter.spec.ts BD, client-card.presenter.spec.ts)', () => {
  const CARD_TODAY = day('2026-09-28');

  it('knows a birthday by month and day, a 29 February one on the 28th in other years', () => {
    expect(AgeSystem.isBirthdayOn(bd('1992-09-28'), CARD_TODAY)).toBe(true);
    expect(AgeSystem.isBirthdayOn(bd('1992-09-27'), CARD_TODAY)).toBe(false);
    const leapling = bd('2000-02-29');
    expect(AgeSystem.isBirthdayOn(leapling, day('2027-02-28'))).toBe(true);
    expect(AgeSystem.isBirthdayOn(leapling, day('2028-02-28'))).toBe(false);
    expect(AgeSystem.isBirthdayOn(leapling, day('2028-02-29'))).toBe(true);
  });

  it('agrees the age, and says the day without a figure when no year can be the year of birth', () => {
    expect(AgeSystem.ageReachedOn(bd('2025-09-28'), CARD_TODAY)).toBe(1);
    expect(AgeSystem.ageReachedOn(bd('1800-09-28'), CARD_TODAY)).toBeNull();
    expect(AgeSystem.ageReachedOn(bd('2026-09-28'), CARD_TODAY)).toBeNull();
  });

  it('says a birthday within the week to come — the day it falls on and the age it brings', () => {
    expect(AgeSystem.nextBirthday(bd('1992-10-02'), CARD_TODAY)).toEqual({
      localDate: '2026-10-02',
      inDays: 4,
      turning: 34,
    });
    expect(AgeSystem.nextBirthday(bd('1992-09-29'), CARD_TODAY).inDays).toBe(1);
    expect(AgeSystem.nextBirthday(bd('1992-10-05'), CARD_TODAY).inDays).toBe(7);
    expect(AgeSystem.nextBirthday(bd('1992-10-06'), CARD_TODAY).inDays).toBe(8);
    expect(
      AgeSystem.nextBirthday(bd('1800-10-02'), CARD_TODAY).turning,
    ).toBeNull();
    // Yesterday's is over; it comes again in a year.
    expect(AgeSystem.nextBirthday(bd('1992-09-27'), CARD_TODAY)).toEqual({
      localDate: '2027-09-27',
      inDays: 364,
      turning: 35,
    });
    // Today's is today.
    expect(AgeSystem.nextBirthday(bd('1992-09-28'), CARD_TODAY).inDays).toBe(0);
  });

  it('looks across the year’s end, and names the year the day falls in', () => {
    expect(AgeSystem.nextBirthday(bd('1990-01-02'), day('2026-12-29'))).toEqual(
      {
        localDate: '2027-01-02',
        inDays: 4,
        turning: 37,
      },
    );
  });

  it('keeps a 29 February birthday on the 28th outside a leap year', () => {
    const leapling = bd('2000-02-29');
    expect(AgeSystem.nextBirthday(leapling, day('2027-02-25'))).toEqual({
      localDate: '2027-02-28',
      inDays: 3,
      turning: 27,
    });
    expect(AgeSystem.nextBirthday(leapling, day('2027-02-28')).inDays).toBe(0);
    expect(AgeSystem.nextBirthday(leapling, day('2028-02-25'))).toEqual({
      localDate: '2028-02-29',
      inDays: 4,
      turning: 28,
    });
    // In a leap year the 28th is the day before, not the day.
    expect(AgeSystem.nextBirthday(leapling, day('2028-02-28')).inDays).toBe(1);
  });
});

describe('AgeSystem properties', () => {
  const anyBirth = fc
    .tuple(
      fc.integer({ min: 1900, max: 2020 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 31 }),
    )
    .filter(([y, m, d]) => d <= LocalDate.daysInMonth(y, m))
    .map(([year, month, d]) =>
      BirthDate.of(
        `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      ),
    );
  const anyOffset = fc.integer({ min: 0, max: 130 * 366 });

  it('the age is the count of kept birthdays come round — brute force over the years', () => {
    fc.assert(
      fc.property(anyBirth, anyOffset, (birthDate, offset) => {
        const today = LocalDate.addDays(day(birthDate), offset);
        const birthYear = Number(birthDate.slice(0, 4));
        let count = 0;
        for (let k = 1; birthYear + k <= Number(today.slice(0, 4)); k++) {
          if (AgeSystem.birthdayIn(birthDate, birthYear + k) <= today) count++;
        }
        expect(AgeSystem.ageOn(birthDate, today)).toBe(count);
      }),
    );
  });

  it('ageAt accepts exactly the window and never a future date', () => {
    fc.assert(
      fc.property(
        anyBirth,
        fc.integer({ min: -400, max: 130 * 366 }),
        (birthDate, offset) => {
          const today = LocalDate.addDays(day(birthDate), offset);
          const result = AgeSystem.ageAt(birthDate, today);
          const age = AgeSystem.ageOn(birthDate, today);
          expect(result.ok).toBe(
            offset >= 0 && age >= AgeWindow.MinAge && age <= AgeWindow.MaxAge,
          );
        },
      ),
    );
  });
});

describe('AgeSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const parts = deepFreeze({ day: 3, month: 7, year: 1990 });
    const run = () => ({
      parts: AgeSystem.fromParts(parts, TODAY),
      iso: AgeSystem.parseIso('1990-07-03', TODAY),
      age: AgeSystem.ageAt(bd('1990-07-03'), TODAY),
      next: AgeSystem.nextBirthday(bd('1990-07-03'), TODAY),
    });
    expect(run()).toEqual(run());
    expect(parts).toEqual({ day: 3, month: 7, year: 1990 });
  });
});
