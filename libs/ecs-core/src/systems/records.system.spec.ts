import { describe, expect, it } from 'vitest';
import {
  PersonalRecordKind,
  type PersonalRecord,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
} from '@core/components';
import type { Appointment } from '@core/entities';
import { AppointmentId, SeatId, ServiceId, UserId } from '@core/primitives';
import {
  FIXTURE_IDS,
  appointmentFixture,
  customerOf,
  deepFreeze,
  localDate,
  seatFixture,
  utcMs,
} from '@core/testing';
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

describe('RecordsSystem.setOn / isNew — the boundaries (medals.presenter.spec.ts `recordSetOn`, `isNewRecord`)', () => {
  it('sets a run on its last visit, a first visit on its day, a closed record year on its last day', () => {
    expect(RecordsSystem.setOn(record('longestRhythm'), TODAY)).toBe(
      '2026-09-28',
    );
    expect(RecordsSystem.setOn(record('firstVisit'), TODAY)).toBe('2025-03-01');
    expect(RecordsSystem.setOn(record('mostVisitsInYear'), TODAY)).toBe(
      '2025-12-31',
    );
  });

  it('is new for a run set within the last thirty days of the shop’s today — never one dated ahead', () => {
    const run = (on: string) => record('longestRhythm', { on: localDate(on) });
    expect(RecordsSystem.NEW_RECORD_DAYS).toBe(30);
    expect(RecordsSystem.isNew(run('2026-09-28'), TODAY)).toBe(true);
    expect(RecordsSystem.isNew(run('2026-08-29'), TODAY)).toBe(true);
    expect(RecordsSystem.isNew(run('2026-08-28'), TODAY)).toBe(false);
    expect(RecordsSystem.isNew(run('2026-09-29'), TODAY)).toBe(false);
  });

  it('is new for a best year the thirty days after it closed, never the year still running', () => {
    const year = (value: number) => record('mostVisitsInYear', { year: value });
    expect(RecordsSystem.isNew(year(2025), localDate('2026-01-01'))).toBe(true);
    expect(RecordsSystem.isNew(year(2025), localDate('2026-01-30'))).toBe(true);
    expect(RecordsSystem.isNew(year(2025), localDate('2026-01-31'))).toBe(
      false,
    );
    expect(RecordsSystem.isNew(year(2026), TODAY)).toBe(false);
    expect(RecordsSystem.isNew(year(2026), localDate('2026-12-31'))).toBe(
      false,
    );
  });

  it('is never new for a first visit, nor a favourite', () => {
    expect(
      RecordsSystem.isNew(
        record('firstVisit', { on: localDate('2026-09-28') }),
        TODAY,
      ),
    ).toBe(false);
    expect(RecordsSystem.isNew(record('favouriteService'), TODAY)).toBe(false);
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

/*
 * The records' decisions the presenters leaned on (Law 10.2, §2.4: M-25,
 * G-6, G-7, G-17) — `medals.presenter.ts` `recordCardVm`'s «holds nothing
 * to print», `records.presenter.ts`' «Обичайни услуги» and «По години»
 * (`yearsOf`), and the glance's quiet records line — each case of those
 * presenters' specs re-stated as the record, the flag or the bars they
 * now word. The catalogue's names (a favourite's service, the usual
 * services) stay the edge's lookups.
 */

describe('RecordsSystem.isHeld — a record that holds something (M-25)', () => {
  it('holds every one of Георги’s records', () => {
    for (const held of Object.values(GEORGI)) {
      expect([held.personalRecordKind, RecordsSystem.isHeld(held)]).toEqual([
        held.personalRecordKind,
        true,
      ]);
    }
  });

  it('holds a run of more than nought, its day known or not', () => {
    expect(RecordsSystem.isHeld(record('longestRhythm', { on: null }))).toBe(
      true,
    );
    expect(RecordsSystem.isHeld(record('longestRhythm', { value: 0 }))).toBe(
      false,
    );
  });

  it('holds a best year of more than nought that names its year', () => {
    expect(RecordsSystem.isHeld(record('mostVisitsInYear', { value: 0 }))).toBe(
      false,
    );
    expect(
      RecordsSystem.isHeld(record('mostVisitsInYear', { year: null })),
    ).toBe(false);
  });

  it('holds a favourite of more than nought that names its service', () => {
    expect(RecordsSystem.isHeld(record('favouriteService', { value: 0 }))).toBe(
      false,
    );
    expect(
      RecordsSystem.isHeld(record('favouriteService', { serviceId: null })),
    ).toBe(false);
  });

  it('holds a first visit that names its day, whatever its value', () => {
    expect(RecordsSystem.isHeld(record('firstVisit', { on: null }))).toBe(
      false,
    );
    expect(RecordsSystem.isHeld(record('firstVisit', { value: 0 }))).toBe(true);
  });
});

describe('RecordsSystem.usualBeyondFavourite — «Обичайни услуги» (G-6)', () => {
  const fade = ServiceId.of('svc-fade');
  const beard = ServiceId.of('svc-beard');

  it('says something only when a usual service is not the favourite', () => {
    expect(RecordsSystem.usualBeyondFavourite([fade], fade)).toBe(false);
    expect(RecordsSystem.usualBeyondFavourite([fade, beard], fade)).toBe(true);
    expect(RecordsSystem.usualBeyondFavourite([beard, fade], fade)).toBe(true);
  });

  it('says nothing without a usual service, and something for any without a favourite', () => {
    expect(RecordsSystem.usualBeyondFavourite([], fade)).toBe(false);
    expect(RecordsSystem.usualBeyondFavourite([], null)).toBe(false);
    expect(RecordsSystem.usualBeyondFavourite([fade], null)).toBe(true);
  });
});

describe('RecordsSystem.yearsOfHistory — «По години» over the loaded book (G-7)', () => {
  const me = FIXTURE_IDS.customer;
  const friendUser = UserId.of('u-friend');
  const friend = customerOf(friendUser);
  const done = utcMs('2026-01-01T12:00:00.000Z');

  /** One appointment on `day`: the record's own seat, worked unless `outcome` says otherwise. */
  const visit = (
    id: string,
    day: string,
    options: {
      readonly outcome?: SeatOutcome;
      readonly whose?: 'me' | 'friend' | 'both';
    } = {},
  ): Appointment => {
    const mine = seatFixture({
      outcome: options.outcome ?? SeatOutcome.worked(done),
    });
    const theirs = seatFixture({
      seatId: SeatId.of('seat-2'),
      occupant: SeatOccupant.account(
        friendUser,
        friend,
        SubjectRelationship.Companion,
      ),
      outcome: SeatOutcome.worked(done),
    });
    const whose = options.whose ?? 'me';
    return appointmentFixture({
      id: AppointmentId.of(id),
      localDate: localDate(day),
      seats:
        whose === 'me'
          ? [mine]
          : whose === 'friend'
            ? [theirs]
            : [mine, theirs],
    });
  };
  const bars = (years: ReturnType<typeof RecordsSystem.yearsOfHistory>) =>
    years?.map((y) => [y.year, y.count, y.record]) ?? null;
  const records = [record('mostVisitsInYear', { year: 2025 })];

  it('counts nothing unless the loaded pages are the whole history', () => {
    const book = [visit('a', '2024-05-10'), visit('b', '2025-05-10')];
    expect(RecordsSystem.yearsOfHistory(me, book, records, false)).toBeNull();
    expect(bars(RecordsSystem.yearsOfHistory(me, book, records, true))).toEqual(
      [
        [2025, 1, true],
        [2024, 1, false],
      ],
    );
  });

  it('counts only this client’s worked visits — never a no-show, a cancelled or an open one, nor another person’s', () => {
    const book = [
      visit('a', '2024-05-10'),
      visit('b', '2025-05-10'),
      visit('c', '2025-06-10', { whose: 'both' }),
      visit('d', '2025-07-10', { outcome: SeatOutcome.noShow(done) }),
      visit('e', '2025-08-10', { outcome: SeatOutcome.scheduled() }),
      visit('f', '2026-05-10', { whose: 'friend' }),
    ];
    expect(bars(RecordsSystem.yearsOfHistory(me, book, records, true))).toEqual(
      [
        [2025, 2, true],
        [2024, 1, false],
      ],
    );
    // His friend's book is another story.
    expect(bars(RecordsSystem.yearsOfHistory(friend, book, [], true))).toEqual([
      [2026, 1, false],
      [2025, 1, true],
    ]);
  });

  it('gives the emblem to the stamped record year among equals', () => {
    const book = [visit('a', '2024-05-10'), visit('b', '2025-05-10')];
    expect(
      bars(
        RecordsSystem.yearsOfHistory(
          me,
          book,
          [record('mostVisitsInYear', { year: 2025 })],
          true,
        ),
      ),
    ).toEqual([
      [2025, 1, true],
      [2024, 1, false],
    ]);
    // No stamped year: the year that got there first.
    expect(bars(RecordsSystem.yearsOfHistory(me, book, [], true))).toEqual([
      [2025, 1, false],
      [2024, 1, true],
    ]);
  });

  it('says nothing for one year of visits, or none', () => {
    expect(
      RecordsSystem.yearsOfHistory(
        me,
        [visit('a', '2025-05-10')],
        records,
        true,
      ),
    ).toBeNull();
    expect(RecordsSystem.yearsOfHistory(me, [], records, true)).toBeNull();
  });
});

describe('RecordsSystem.glanceLine — the glance’s records line (G-17)', () => {
  const all = Object.values(GEORGI);
  const known = new Set([ServiceId.of('svc-fade')]);
  const kinds = (line: readonly PersonalRecord[]) =>
    line.map((r) => r.personalRecordKind);

  it('reads the favourite, the best year, the first visit — never the longest run — at most `limit`', () => {
    expect(RecordsSystem.GLANCE_LINE_ORDER).toEqual([
      PersonalRecordKind.FavouriteService,
      PersonalRecordKind.MostVisitsInYear,
      PersonalRecordKind.FirstVisit,
    ]);
    expect(kinds(RecordsSystem.glanceLine(all, known, 2))).toEqual([
      PersonalRecordKind.FavouriteService,
      PersonalRecordKind.MostVisitsInYear,
    ]);
    expect(kinds(RecordsSystem.glanceLine(all, known, 4))).toEqual([
      PersonalRecordKind.FavouriteService,
      PersonalRecordKind.MostVisitsInYear,
      PersonalRecordKind.FirstVisit,
    ]);
    expect(RecordsSystem.glanceLine([GEORGI.longestRhythm], known, 2)).toEqual(
      [],
    );
  });

  it('drops a favourite the catalogue no longer names and a first visit without its day', () => {
    expect(kinds(RecordsSystem.glanceLine(all, new Set(), 2))).toEqual([
      PersonalRecordKind.MostVisitsInYear,
      PersonalRecordKind.FirstVisit,
    ]);
    expect(
      kinds(
        RecordsSystem.glanceLine(
          [record('favouriteService', { serviceId: null }), GEORGI.firstVisit],
          known,
          2,
        ),
      ),
    ).toEqual([PersonalRecordKind.FirstVisit]);
    expect(
      kinds(
        RecordsSystem.glanceLine(
          [GEORGI.mostVisitsInYear, record('firstVisit', { on: null })],
          known,
          2,
        ),
      ),
    ).toEqual([PersonalRecordKind.MostVisitsInYear]);
  });

  it('keeps a best year of nought: the line reads its figure as stamped', () => {
    expect(
      kinds(
        RecordsSystem.glanceLine(
          [record('mostVisitsInYear', { value: 0, year: null })],
          known,
          2,
        ),
      ),
    ).toEqual([PersonalRecordKind.MostVisitsInYear]);
    expect(RecordsSystem.glanceLine([], known, 2)).toEqual([]);
  });
});

describe('RecordsSystem purity — the presenters’ decisions', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const records = deepFreeze(Object.values(GEORGI));
    const book = deepFreeze([
      appointmentFixture({
        id: AppointmentId.of('a'),
        localDate: localDate('2024-05-10'),
        seats: [
          seatFixture({
            outcome: SeatOutcome.worked(utcMs('2024-05-10T08:00:00.000Z')),
          }),
        ],
      }),
      appointmentFixture({
        id: AppointmentId.of('b'),
        localDate: localDate('2026-05-10'),
        seats: [
          seatFixture({
            outcome: SeatOutcome.worked(utcMs('2026-05-10T08:00:00.000Z')),
          }),
        ],
      }),
    ]);
    const known = new Set([ServiceId.of('svc-fade')]);
    const usual = deepFreeze([ServiceId.of('svc-fade')]);
    const run = () => [
      records.map((r) => RecordsSystem.isHeld(r)),
      RecordsSystem.usualBeyondFavourite(usual, null),
      RecordsSystem.yearsOfHistory(FIXTURE_IDS.customer, book, records, true),
      RecordsSystem.glanceLine(records, known, 2),
    ];
    expect(run()).toEqual(run());
  });
});
