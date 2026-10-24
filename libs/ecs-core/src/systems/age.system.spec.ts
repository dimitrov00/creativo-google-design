import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BirthDate, BirthdayMoment } from '@core/components';
import { LocalDate } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { deepFreeze, localDate, unwrapErr, unwrapOk } from '@core/testing';
import { AgeSystem, AgeWindow } from './age.system';

/*
 * The cases of BOTH legacy birth-date specs — the accounts and the identity
 * `birth-date.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) — COPIED and re-targeted.
 * "Today" was a `ZonedDateTime` noon in Europe/Sofia; it is now the shop's
 * `LocalDate` (what `ShopNow.localDate` answers for it), and the age is whole
 * calendar years over local dates. The accounts codes (`accounts.birth_date.*`)
 * collapsed into the identity ones (blueprint §2.7); the accounts class's "a
 * future date is too young" reading is `ageOn` + `windowRefusal`, the identity
 * class's `IN_FUTURE` is `ageAt`.
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

describe('AgeSystem.birthdayMoment — which birthday the client card says (glance.presenter.spec.ts BD)', () => {
  const CARD_TODAY = day('2026-09-28');

  it('dictionary values are the SCREAMING tags the card’s display model words', () => {
    expect(BirthdayMoment).toEqual({ Today: 'TODAY', Upcoming: 'UPCOMING' });
    expect(AgeSystem.BIRTHDAY_NOTICE_DAYS).toBe(7);
  });

  it('is TODAY on the day, with the age it brings', () => {
    expect(AgeSystem.birthdayMoment(bd('1992-09-28'), CARD_TODAY)).toEqual({
      birthdayMoment: BirthdayMoment.Today,
      localDate: '2026-09-28',
      age: 34,
      turning: 34,
    });
    expect(AgeSystem.birthdayMoment(bd('2025-09-28'), CARD_TODAY)?.age).toBe(1);
  });

  it('says the day without a figure when no year can be the year of birth', () => {
    expect(AgeSystem.birthdayMoment(bd('1800-09-28'), CARD_TODAY)).toEqual({
      birthdayMoment: BirthdayMoment.Today,
      localDate: '2026-09-28',
      age: null,
      turning: null,
    });
    expect(
      AgeSystem.birthdayMoment(bd('2026-09-28'), CARD_TODAY)?.age,
    ).toBeNull();
  });

  it('is UPCOMING from tomorrow through the seventh day, with no age of today', () => {
    expect(AgeSystem.birthdayMoment(bd('1992-10-02'), CARD_TODAY)).toEqual({
      birthdayMoment: BirthdayMoment.Upcoming,
      localDate: '2026-10-02',
      age: null,
      turning: 34,
    });
    expect(AgeSystem.birthdayMoment(bd('1992-09-29'), CARD_TODAY)).toEqual({
      birthdayMoment: BirthdayMoment.Upcoming,
      localDate: '2026-09-29',
      age: null,
      turning: 34,
    });
    expect(
      AgeSystem.birthdayMoment(bd('1992-10-05'), CARD_TODAY)?.localDate,
    ).toBe('2026-10-05');
    expect(
      AgeSystem.birthdayMoment(bd('1800-10-02'), CARD_TODAY)?.turning,
    ).toBeNull();
  });

  it('is nothing from the eighth day on, and yesterday’s is over', () => {
    expect(AgeSystem.birthdayMoment(bd('1992-10-06'), CARD_TODAY)).toBeNull();
    expect(AgeSystem.birthdayMoment(bd('1992-09-27'), CARD_TODAY)).toBeNull();
  });

  it('looks across the year’s end', () => {
    expect(
      AgeSystem.birthdayMoment(bd('1990-01-02'), day('2026-12-29')),
    ).toEqual({
      birthdayMoment: BirthdayMoment.Upcoming,
      localDate: '2027-01-02',
      age: null,
      turning: 37,
    });
  });

  it('keeps a 29 February birthday on the 28th outside a leap year', () => {
    const leapling = bd('2000-02-29');
    expect(AgeSystem.birthdayMoment(leapling, day('2027-02-25'))).toEqual({
      birthdayMoment: BirthdayMoment.Upcoming,
      localDate: '2027-02-28',
      age: null,
      turning: 27,
    });
    expect(AgeSystem.birthdayMoment(leapling, day('2027-02-28'))).toEqual({
      birthdayMoment: BirthdayMoment.Today,
      localDate: '2027-02-28',
      age: 27,
      turning: 27,
    });
    expect(
      AgeSystem.birthdayMoment(leapling, day('2028-02-25'))?.localDate,
    ).toBe('2028-02-29');
    // In a leap year the 28th is the day before, not the day.
    expect(AgeSystem.birthdayMoment(leapling, day('2028-02-28'))).toEqual({
      birthdayMoment: BirthdayMoment.Upcoming,
      localDate: '2028-02-29',
      age: null,
      turning: 28,
    });
  });

  it('agrees with isBirthdayOn and nextBirthday on every day of a year', () => {
    const birth = bd('1992-10-02');
    for (let i = 0; i < 366; i++) {
      const today = LocalDate.addDays(CARD_TODAY, i);
      const moment = AgeSystem.birthdayMoment(birth, today);
      const next = AgeSystem.nextBirthday(birth, today);
      if (AgeSystem.isBirthdayOn(birth, today)) {
        expect(moment?.birthdayMoment).toBe(BirthdayMoment.Today);
      } else if (next.inDays <= AgeSystem.BIRTHDAY_NOTICE_DAYS) {
        expect(moment?.birthdayMoment).toBe(BirthdayMoment.Upcoming);
      } else {
        expect(moment).toBeNull();
      }
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const birth = deepFreeze(bd('1992-10-02'));
    const once = AgeSystem.birthdayMoment(birth, CARD_TODAY);
    expect(AgeSystem.birthdayMoment(birth, CARD_TODAY)).toEqual(once);
    expect(birth).toBe('1992-10-02');
  });
});
