import { describe, expect, it } from 'vitest';
import { PersonalRecordKind, type PersonalRecord } from '@core/components';
import { AppointmentId, ServiceId } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { RecordsSystem, type RecordVisit } from './records.system';

/*
 * COPIED, never moved, from libs/features/staff/client-card/src/lib/records.presenter.spec.ts
 * — the featured record's choice (RC) and «По години» (RF) — re-targeted to
 * the numbers they assert: the record chosen, its day, «нов», and each
 * year's count and emblem. The words, the figures, the covers and the
 * rows stay with the presenter's spec. The worked-visit filter (this
 * person's, worked, by the shop's day) is the presenter's read of an
 * appointment; the system takes the visits it found.
 */

const TODAY = localDate('2026-09-28');

/** Георги's records as the seed stamps them, by the cards' names. */
const GEORGI = {
  longestRhythm: {
    personalRecordKind: PersonalRecordKind.LongestRhythm,
    value: 24,
    on: localDate('2026-09-28'),
    year: null,
    serviceId: null,
  },
  mostVisitsInYear: {
    personalRecordKind: PersonalRecordKind.MostVisitsInYear,
    value: 13,
    on: null,
    year: 2025,
    serviceId: null,
  },
  favouriteService: {
    personalRecordKind: PersonalRecordKind.FavouriteService,
    value: 24,
    on: null,
    year: null,
    serviceId: ServiceId.of('svc-fade'),
  },
  firstVisit: {
    personalRecordKind: PersonalRecordKind.FirstVisit,
    value: 1,
    on: localDate('2025-03-01'),
    year: null,
    serviceId: null,
  },
} as const satisfies Record<string, PersonalRecord>;

/** The cards' names of the kinds, as the cases read them. */
const KIND = {
  longestRhythm: PersonalRecordKind.LongestRhythm,
  mostVisitsInYear: PersonalRecordKind.MostVisitsInYear,
  favouriteService: PersonalRecordKind.FavouriteService,
  firstVisit: PersonalRecordKind.FirstVisit,
} as const;
type Card = keyof typeof KIND;

const record = (
  card: Card,
  overrides: Partial<PersonalRecord> = {},
): PersonalRecord => {
  const stamped = Object.values(GEORGI).find(
    (r) => r.personalRecordKind === KIND[card],
  );
  if (stamped === undefined) throw new Error(card);
  return { ...stamped, ...overrides };
};

const newestKind = (records: readonly PersonalRecord[]) => {
  const index = RecordsSystem.newest(records, TODAY);
  return index === null ? null : records.at(index)?.personalRecordKind;
};

describe('RecordsSystem.ordered (medals.presenter.ts `recordsOf`)', () => {
  it('hands the account’s records over in the cards’ order', () => {
    const shuffled = [
      GEORGI.firstVisit,
      GEORGI.favouriteService,
      GEORGI.longestRhythm,
      GEORGI.mostVisitsInYear,
    ];
    expect(
      RecordsSystem.ordered(shuffled, true).map((r) => r.personalRecordKind),
    ).toEqual([
      'LONGEST_RHYTHM',
      'MOST_VISITS_IN_YEAR',
      'FAVOURITE_SERVICE',
      'FIRST_VISIT',
    ]);
  });

  it('never features the longest run while the shop runs no rhythm', () => {
    expect(
      RecordsSystem.ordered(Object.values(GEORGI), false).map(
        (r) => r.personalRecordKind,
      ),
    ).toEqual(['MOST_VISITS_IN_YEAR', 'FAVOURITE_SERVICE', 'FIRST_VISIT']);
    expect(RecordsSystem.ordered([], true)).toEqual([]);
  });
});

describe('RecordsSystem — the featured record (RC)', () => {
  it('is the record set most recently', () => {
    expect(newestKind(RecordsSystem.ordered(Object.values(GEORGI), true))).toBe(
      'LONGEST_RHYTHM',
    );
  });

  it('wears the capsule only within thirty days of the day it was set', () => {
    expect(RecordsSystem.isNew(GEORGI.longestRhythm, TODAY)).toBe(true);
    // Мартин's longest run closed on 19 August: forty days ago.
    expect(
      RecordsSystem.isNew(
        record('longestRhythm', { value: 13, on: localDate('2026-08-19') }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      RecordsSystem.isNew(
        record('longestRhythm', { on: localDate('2026-08-29') }),
        TODAY,
      ),
    ).toBe(true);
  });

  it('is the best year while it is the newest, and no news while it still runs', () => {
    const records = [
      record('longestRhythm', { value: 9, on: localDate('2025-11-11') }),
      record('mostVisitsInYear', { value: 13, year: 2025 }),
      record('favouriteService'),
      record('firstVisit'),
    ];
    expect(newestKind(records)).toBe('MOST_VISITS_IN_YEAR');
    expect(RecordsSystem.setOn(records[1] as PersonalRecord, TODAY)).toBe(
      '2025-12-31',
    );
    expect(RecordsSystem.isNew(records[1] as PersonalRecord, TODAY)).toBe(
      false,
    );
  });

  it('lets the cards’ order break a tie: a run set today over a year still running', () => {
    const records = [
      record('longestRhythm'),
      record('mostVisitsInYear', { value: 14, year: 2026 }),
    ];
    // The year still running is set «today» too.
    expect(RecordsSystem.setOn(records[1] as PersonalRecord, TODAY)).toBe(
      TODAY,
    );
    expect(newestKind(records)).toBe('LONGEST_RHYTHM');
    // The year still running is the newest where the run is older, and no news.
    const older = [
      record('longestRhythm', { on: localDate('2026-06-15') }),
      record('mostVisitsInYear', { value: 14, year: 2026 }),
    ];
    expect(newestKind(older)).toBe('MOST_VISITS_IN_YEAR');
    expect(RecordsSystem.isNew(older[1] as PersonalRecord, TODAY)).toBe(false);
  });

  it('is a favourite only where no record has a day', () => {
    expect(newestKind([record('favouriteService')])).toBe('FAVOURITE_SERVICE');
    expect(RecordsSystem.setOn(GEORGI.favouriteService, TODAY)).toBeNull();
    // Any record with a day is newer than one without.
    expect(newestKind([record('favouriteService'), record('firstVisit')])).toBe(
      'FIRST_VISIT',
    );
  });

  it('is the first visit for a client with nothing else yet, never a record anyone broke', () => {
    const first = record('firstVisit', { on: TODAY });
    expect(newestKind([first])).toBe('FIRST_VISIT');
    expect(RecordsSystem.isNew(first, TODAY)).toBe(false);
    expect(RecordsSystem.isNew(GEORGI.favouriteService, TODAY)).toBe(false);
  });

  it('chooses nothing among no records, and names no day for a year never stamped', () => {
    expect(RecordsSystem.newest([], TODAY)).toBeNull();
    const unstamped = record('mostVisitsInYear', { year: null });
    expect(RecordsSystem.setOn(unstamped, TODAY)).toBeNull();
    expect(RecordsSystem.isNew(unstamped, TODAY)).toBe(false);
  });
});

describe('RecordsSystem.years — «По години» (RF)', () => {
  const visit = (appointmentId: string, day: string): RecordVisit => ({
    appointmentId: AppointmentId.of(appointmentId),
    localDate: localDate(day),
  });
  const bars = (years: ReturnType<typeof RecordsSystem.years>) =>
    years?.map((y) => [y.year, y.count, y.record]) ?? null;

  it('counts the worked visits by the shop’s year, newest first, each against the best year', () => {
    const visits = [
      ...Array.from({ length: 13 }, (_, i) =>
        visit(`a${i}`, `2025-${String((i % 12) + 1).padStart(2, '0')}-10`),
      ),
      ...Array.from({ length: 11 }, (_, i) =>
        visit(`b${i}`, `2026-0${(i % 9) + 1}-10`),
      ),
    ];
    expect(RecordsSystem.years(visits, 2025)).toEqual([
      { year: 2026, count: 11, best: 13, record: false },
      { year: 2025, count: 13, best: 13, record: true },
    ]);
  });

  it('counts a visit listed twice once', () => {
    expect(
      bars(
        RecordsSystem.years(
          [
            visit('a', '2025-05-10'),
            visit('b', '2026-05-10'),
            visit('b', '2026-05-10'),
          ],
          null,
        ),
      ),
    ).toEqual([
      [2026, 1, false],
      [2025, 1, true],
    ]);
  });

  it('draws a year without a visit as a bar of nought, so the run of years is unbroken', () => {
    expect(
      RecordsSystem.years(
        [
          visit('a', '2024-05-10'),
          visit('b', '2024-06-10'),
          visit('c', '2026-05-10'),
        ],
        null,
      ),
    ).toEqual([
      { year: 2026, count: 1, best: 2, record: false },
      { year: 2025, count: 0, best: 2, record: false },
      { year: 2024, count: 2, best: 2, record: true },
    ]);
  });

  it('gives the emblem to the account’s record year among equals, else to the year that got there first', () => {
    const visits = [
      visit('a', '2024-05-10'),
      visit('b', '2025-05-10'),
      visit('c', '2026-05-10'),
    ];
    const recordYear = (year: number | null) =>
      RecordsSystem.years(visits, year)
        ?.filter((y) => y.record)
        .map((y) => y.year);
    expect(recordYear(2025)).toEqual([2025]);
    expect(recordYear(2026)).toEqual([2026]);
    // No record stamped: the first of the best.
    expect(recordYear(null)).toEqual([2024]);
    // A stamp the loaded history does not bear out never moves the emblem off the longest bar.
    expect(
      RecordsSystem.years(
        [
          visit('a', '2025-05-10'),
          visit('b', '2025-06-10'),
          visit('c', '2026-05-10'),
        ],
        2026,
      )
        ?.filter((y) => y.record)
        .map((y) => y.year),
    ).toEqual([2025]);
  });

  it('says something from the second year on: one bar is «Общо посещения» again', () => {
    expect(RecordsSystem.YEARS_MIN).toBe(2);
    expect(
      RecordsSystem.years(
        [visit('a', '2026-05-10'), visit('b', '2026-06-10')],
        null,
      ),
    ).toBeNull();
    expect(RecordsSystem.years([], null)).toBeNull();
  });
});

describe('RecordsSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const records = deepFreeze(Object.values(GEORGI));
    const visits = deepFreeze([
      {
        appointmentId: AppointmentId.of('a'),
        localDate: localDate('2024-05-10'),
      },
      {
        appointmentId: AppointmentId.of('b'),
        localDate: localDate('2026-05-10'),
      },
    ]);
    const run = () => [
      RecordsSystem.ordered(records, true),
      RecordsSystem.newest(records, TODAY),
      RecordsSystem.years(visits, 2024),
    ];
    expect(run()).toEqual(run());
  });
});
