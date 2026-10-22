import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
} from '@core/components';
import { PersonalRecord, StreakState } from '@core/components';
import type { Appointment, ClientStatsRecord } from '@core/entities';
import { BarberId, ServiceId, UtcEpochMs } from '@core/primitives';
import { localDate } from '@core/testing';
import { isUiIconName } from '@creativo/ui/controls';
import { RECORD_KIND_WORDS, type RecordKindWord } from './client-card.words';
import type { AchievementsData, RecordRowVm } from './client-pages.vm';
import { medalsPageVm } from './medals.presenter';
import {
  type RecordsPageInput,
  YEARS_MIN,
  recordsPageVm,
} from './records.presenter';
import {
  GEORGI,
  GEORGI_PREVIOUS_MS,
  MARTIN,
  MARTIN_PREVIOUS_MS,
  achievementsContextOf,
  achievementsDataOf,
  contactOf,
  georgiContext,
  georgiHistory,
  martinContext,
  martinHistory,
  must,
  rhythmHead,
  rhythmHeadWith,
  seatOf,
  sofia,
  statsOf,
  visitOf,
  wallOf,
  wordsOf,
} from '../testing/client-card.fixtures';

const DATA = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const SETTLED = achievementsContextOf(georgiContext(), 'Георги Петров');
/** The rhythm's head as the catalogue holds it: its rule in force since 1.03.2025. */
const RHYTHM = rhythmHead();

/** Георги's page as the store hands it over: the whole history loaded. */
function georgi(overrides: Partial<RecordsPageInput> = {}): RecordsPageInput {
  const visits = georgiHistory();
  return {
    data: DATA,
    ctx: SETTLED,
    stats: statsOf(GEORGI, visits),
    rhythm: RHYTHM,
    visits,
    historyComplete: true,
    ...overrides,
  };
}

function martin(overrides: Partial<RecordsPageInput> = {}): RecordsPageInput {
  const visits = martinHistory();
  return {
    data: achievementsDataOf('martin', MARTIN_PREVIOUS_MS),
    ctx: achievementsContextOf(martinContext(), 'Мартин Илиев', true),
    stats: statsOf(MARTIN, visits),
    rhythm: RHYTHM,
    visits,
    historyComplete: true,
    ...overrides,
  };
}

function withRecords(records: readonly PersonalRecord[]): AchievementsData {
  return { ...DATA, account: { ...DATA.account, records } };
}

/** What a case changes on a record, days and ids as the spec writes them. */
type RecordEdit = {
  readonly value?: number;
  readonly on?: string | null;
  readonly year?: number | null;
  readonly serviceId?: string | null;
};

/** One of Георги's records, by the card's word for its kind, with some fields changed. */
function record(kind: RecordKindWord, edit: RecordEdit = {}): PersonalRecord {
  const held = must(
    DATA.account.records.find(
      (r) => RECORD_KIND_WORDS[r.personalRecordKind] === kind,
    ),
    kind,
  );
  return {
    ...held,
    ...(edit.value === undefined ? {} : { value: edit.value }),
    ...(edit.on === undefined
      ? {}
      : { on: edit.on === null ? null : localDate(edit.on) }),
    ...(edit.year === undefined ? {} : { year: edit.year }),
    ...(edit.serviceId === undefined
      ? {}
      : {
          serviceId:
            edit.serviceId === null ? null : ServiceId.of(edit.serviceId),
        }),
  };
}

/** Георги's rhythm as the account holds it. */
const CADENCE = must(
  StreakState.find(DATA.account.streaks, RHYTHM.id),
  'cadence',
);

/** Георги's book with his rhythm's count and first day changed. */
function withRhythm(edit: {
  readonly current?: number;
  readonly runStartedOn?: string | null;
}): AchievementsData {
  return {
    ...DATA,
    account: {
      ...DATA.account,
      streaks: [
        {
          ...CADENCE,
          ...(edit.current === undefined ? {} : { current: edit.current }),
          ...(edit.runStartedOn === undefined
            ? {}
            : {
                runStartedOn:
                  edit.runStartedOn === null
                    ? null
                    : localDate(edit.runStartedOn),
              }),
        },
      ],
    },
  };
}

/** The rhythm's head with its rule in force switched off by the admin. */
function ruleOff() {
  return rhythmHeadWith((rule) => ({ ...rule, enabled: false }));
}

const DAY_MS = 86_400_000;

/** One visit of Георги's, a fade with Иван at Център, as its outcome says. */
function visit(
  id: string,
  startsAt: string,
  outcome: 'worked' | 'open' | 'cancelled' = 'worked',
  who: string = GEORGI,
): Appointment {
  const wall = wallOf(startsAt);
  const start = sofia(startsAt);
  const worked = UtcEpochMs.plusMs(start, 45 * 60_000);
  const cancelled = UtcEpochMs.plusMs(start, -DAY_MS);
  const booked = UtcEpochMs.plusMs(start, -14 * DAY_MS);
  return visitOf({
    id,
    localDate: wall.localDate,
    seats: [
      seatOf({
        id: `${id}-s1`,
        who,
        serviceId: 'svc-fade',
        barberId: 'ivan',
        minutes: 45,
        priceMinor: 1750,
        startMinutes: wall.minute,
        outcome:
          outcome === 'worked'
            ? SeatOutcome.worked(worked)
            : outcome === 'cancelled'
              ? SeatOutcome.cancelled(
                  cancelled,
                  CancelledBy.Client,
                  CancellationReason.ClientChangedPlans,
                  null,
                )
              : SeatOutcome.scheduled(),
      }),
    ],
    lifecycle:
      outcome === 'worked'
        ? BookingLifecycle.complete(worked)
        : outcome === 'cancelled'
          ? BookingLifecycle.cancel(
              cancelled,
              CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
            )
          : BookingLifecycle.confirm(booked),
    contact: contactOf('Георги Петров', '+359881234567', null),
    bookedAtUtcMs: booked,
  });
}

/** Георги's stats with what the book would say of his habits. */
function statsWith(overrides: Partial<ClientStatsRecord>): ClientStatsRecord {
  return { ...statsOf(GEORGI, georgiHistory()), ...overrides };
}

function rowsOf(input: RecordsPageInput): readonly RecordRowVm[] {
  return recordsPageVm(input).groups.flatMap((group) => group.rows);
}

function row(input: RecordsPageInput, id: string): RecordRowVm | null {
  return rowsOf(input).find((r) => r.id === id) ?? null;
}

describe('recordsPageVm', () => {
  const page = recordsPageVm(georgi());

  it('names whose records they are, once', () => {
    expect(page.subline).toBe('Георги Петров');
  });

  describe('the featured record (RC)', () => {
    it('is the record set most recently: the hero figure over what it counts', () => {
      expect(page.featured).toEqual({
        id: 'longestRhythm',
        kind: 'longestRhythm',
        label: 'Най-дълъг ритъм',
        value: '24',
        sentence: 'поредни посещения в ритъм',
        detail: 'септември 2026 г.',
        icon: 'loyalty.record.longestRhythm',
        src: null,
        isNew: true,
        accessibleName:
          'Най-дълъг ритъм: 24 поредни посещения в ритъм, септември 2026 г., нов рекорд',
      });
    });

    it('wears the capsule only within thirty days of the day it was set', () => {
      // Мартин's longest run closed on 19 August: forty days ago.
      expect(recordsPageVm(martin()).featured).toMatchObject({
        id: 'longestRhythm',
        value: '13',
        detail: 'август 2026 г.',
        isNew: false,
        accessibleName:
          'Най-дълъг ритъм: 13 поредни посещения в ритъм, август 2026 г.',
      });
    });

    it('is the best year while it is the newest, its words agreed with its count', () => {
      const data = withRecords([
        record('longestRhythm', { value: 9, on: '2025-11-11' }),
        record('mostVisitsInYear', { value: 13, year: 2025 }),
        record('favouriteService'),
        record('firstVisit'),
      ]);
      expect(recordsPageVm(georgi({ data })).featured).toMatchObject({
        id: 'mostVisitsInYear',
        value: '13',
        sentence: 'посещения за една година',
        detail: '2025 г.',
        isNew: false,
        accessibleName:
          'Най-много за година: 13 посещения за една година, 2025 г.',
      });
      const one = withRecords([
        record('mostVisitsInYear', { value: 1, year: 2025 }),
      ]);
      expect(recordsPageVm(georgi({ data: one })).featured).toMatchObject({
        value: '1',
        sentence: 'посещение за една година',
      });
    });

    it('lets the cards’ order break a tie: a run set today over a year still running', () => {
      const data = withRecords([
        record('mostVisitsInYear', { value: 14, year: 2026 }),
        record('longestRhythm'),
      ]);
      expect(recordsPageVm(georgi({ data })).featured?.id).toBe(
        'longestRhythm',
      );
      // The year still running is the newest where the run is older.
      const older = withRecords([
        record('longestRhythm', { on: '2026-06-15' }),
        record('mostVisitsInYear', { value: 14, year: 2026 }),
      ]);
      expect(recordsPageVm(georgi({ data: older })).featured).toMatchObject({
        id: 'mostVisitsInYear',
        isNew: false,
      });
    });

    it('is a favourite only where no record has a day: the count the figure, the service in its words', () => {
      const data = withRecords([record('favouriteService')]);
      expect(recordsPageVm(georgi({ data })).featured).toEqual({
        id: 'favouriteService',
        kind: 'favouriteService',
        label: 'Любима услуга',
        value: '24',
        sentence: 'посещения с фейд',
        detail: null,
        icon: 'loyalty.record.favouriteService',
        src: 'https://example.test/covers/fade.jpg',
        isNew: false,
        accessibleName: 'Любима услуга: 24 посещения с фейд',
      });
      const once = withRecords([
        record('favouriteService', { value: 1, serviceId: 'svc-beard' }),
      ]);
      expect(recordsPageVm(georgi({ data: once })).featured).toMatchObject({
        value: '1',
        sentence: 'посещение с оформяне на брада',
      });
      // Any record with a day is newer than one without.
      const dated = withRecords([
        record('favouriteService'),
        record('firstVisit'),
      ]);
      expect(recordsPageVm(georgi({ data: dated })).featured?.id).toBe(
        'firstVisit',
      );
    });

    it('is the first visit for a client with nothing else yet: its day, never a record anyone broke', () => {
      const data = withRecords([record('firstVisit', { on: '2026-09-28' })]);
      expect(recordsPageVm(georgi({ data })).featured).toMatchObject({
        id: 'firstVisit',
        value: '28 септември',
        sentence: 'първо посещение',
        detail: '2026 г.',
        isNew: false,
        accessibleName: 'Първо посещение: 28 септември, 2026 г.',
      });
    });

    it('skips a record that holds nothing to print', () => {
      const data = withRecords([
        record('longestRhythm', { value: 0 }),
        record('mostVisitsInYear'),
      ]);
      expect(recordsPageVm(georgi({ data })).featured?.id).toBe(
        'mostVisitsInYear',
      );
    });
  });

  describe('the groups (RD, RE)', () => {
    it('groups the rows by theme, in the page’s order, the featured record not repeated', () => {
      expect(
        page.groups.map((g) => [g.theme, g.title, g.rows.map((r) => r.id)]),
      ).toEqual([
        ['rhythm', 'Ритъм', ['currentRhythm']],
        [
          'visits',
          'Посещения',
          ['totalVisits', 'last12Months', 'mostVisitsInYear', 'firstVisit'],
        ],
        ['favourites', 'Любими', ['favouriteService']],
      ]);
      expect(rowsOf(georgi()).map((r) => r.id)).not.toContain(
        page.featured?.id,
      );
    });

    it('draws the record that is no longer featured as a row of its group', () => {
      const data = withRecords([
        record('longestRhythm', { value: 9, on: '2025-11-11' }),
        record('mostVisitsInYear'),
        record('favouriteService'),
        record('firstVisit'),
      ]);
      const vm = recordsPageVm(georgi({ data }));
      expect(vm.featured?.id).toBe('mostVisitsInYear');
      expect(vm.groups.map((g) => [g.theme, g.rows.map((r) => r.id)])).toEqual([
        ['rhythm', ['longestRhythm', 'currentRhythm']],
        ['visits', ['totalVisits', 'last12Months', 'firstVisit']],
        ['favourites', ['favouriteService']],
      ]);
      expect(row(georgi({ data }), 'longestRhythm')).toEqual({
        id: 'longestRhythm',
        theme: 'rhythm',
        title: 'Най-дълъг ритъм',
        figure: '9',
        line: 'ноември 2025 г.',
        icon: 'loyalty.record.longestRhythm',
        src: null,
        faceName: null,
        accessibleName: 'Най-дълъг ритъм: 9 посещения, ноември 2025 г.',
      });
    });

    it('gives every row the theme of the group it stands in, and a registered glyph or a picture', () => {
      const input = georgi({
        stats: statsWith({
          preferredBarberId: BarberId.of('ivan'),
          usualServiceIds: [
            ServiceId.of('svc-fade'),
            ServiceId.of('svc-beard'),
          ],
        }),
      });
      for (const group of recordsPageVm(input).groups) {
        for (const drawn of group.rows) {
          expect([drawn.id, drawn.theme]).toEqual([drawn.id, group.theme]);
          if (drawn.icon !== null) {
            expect(isUiIconName(drawn.icon)).toBe(true);
            expect(drawn.src).toBeNull();
            expect(drawn.faceName).toBeNull();
          } else {
            expect(drawn.src !== null || drawn.faceName !== null).toBe(true);
          }
          expect(drawn.accessibleName.startsWith(`${drawn.title}: `)).toBe(
            true,
          );
        }
      }
    });

    it('has no group without a row', () => {
      const vm = recordsPageVm(
        georgi({
          data: withRecords([record('firstVisit')]),
          stats: null,
          rhythm: null,
        }),
      );
      // The first visit is featured, and nothing else is known.
      expect(vm.featured?.id).toBe('firstVisit');
      expect(vm.groups).toEqual([]);
    });
  });

  describe('«Ритъм сега»', () => {
    it('is the run in progress and the month it began', () => {
      expect(row(georgi(), 'currentRhythm')).toEqual({
        id: 'currentRhythm',
        theme: 'rhythm',
        title: 'Ритъм сега',
        figure: '24',
        line: 'от март 2025 г.',
        icon: 'loyalty.record.currentRhythm',
        src: null,
        faceName: null,
        accessibleName: 'Ритъм сега: 24 посещения, от март 2025 г.',
      });
    });

    it('reads the day the run began from the state, never off the track of twelve', () => {
      // The track's oldest period is December 2025; the run is older.
      const state = CADENCE;
      expect(state.periods[0]?.on).toBe('2025-12-08');
      expect(state.runStartedOn).toBe('2025-03-06');
      const restarted = withRhythm({ current: 9, runStartedOn: '2026-06-15' });
      expect(row(georgi({ data: restarted }), 'currentRhythm')).toMatchObject({
        figure: '9',
        line: 'от юни 2026 г.',
        accessibleName: 'Ритъм сега: 9 посещения, от юни 2026 г.',
      });
    });

    it('prints no date for a state written before the day was kept', () => {
      const undated = withRhythm({ runStartedOn: null });
      expect(row(georgi({ data: undated }), 'currentRhythm')).toMatchObject({
        figure: '24',
        line: null,
        accessibleName: 'Ритъм сега: 24 посещения',
      });
    });

    it('is absent while the count is lost, and agrees a run of one', () => {
      const lost = withRhythm({ current: 0, runStartedOn: null });
      expect(row(georgi({ data: lost }), 'currentRhythm')).toBeNull();
      const one = withRhythm({ current: 1, runStartedOn: '2026-09-28' });
      expect(row(georgi({ data: one }), 'currentRhythm')?.accessibleName).toBe(
        'Ритъм сега: 1 посещение, от септември 2026 г.',
      );
    });

    it('is absent for an account without the rule’s rhythm', () => {
      const none: AchievementsData = {
        ...DATA,
        account: { ...DATA.account, streaks: [] },
      };
      expect(row(georgi({ data: none }), 'currentRhythm')).toBeNull();
    });
  });

  describe('while the shop runs no rhythm', () => {
    it.each([
      ['the flag is off, or the shop has no rhythm', null],
      ['the rule in force is switched off', ruleOff()],
    ])('has no «Ритъм» group when %s', (_, rhythm) => {
      const vm = recordsPageVm(georgi({ rhythm }));
      expect(vm.groups.map((g) => g.theme)).toEqual(['visits', 'favourites']);
      expect(vm.groups.flatMap((g) => g.rows.map((r) => r.id))).not.toContain(
        'longestRhythm',
      );
    });

    it('never features the longest run: the newest of the others leads', () => {
      const vm = recordsPageVm(georgi({ rhythm: ruleOff() }));
      expect(vm.featured).toMatchObject({
        id: 'mostVisitsInYear',
        value: '13',
        detail: '2025 г.',
        isNew: false,
      });
      // …and its row gives way to it.
      expect(
        vm.groups.find((g) => g.theme === 'visits')?.rows.map((r) => r.id),
      ).toEqual(['totalVisits', 'last12Months', 'firstVisit']);
    });

    it('agrees with «Постижения», whose 2 × 2 hides the same card', () => {
      const flagged = medalsPageVm(DATA, SETTLED, 'all', { rhythm: false });
      expect(flagged.records.map((r) => r.id)).not.toContain('longestRhythm');
      expect(recordsPageVm(georgi({ rhythm: null })).featured?.id).toBe(
        flagged.records[0]?.id,
      );
    });
  });

  describe('the visits', () => {
    it('counts the visits of a lifetime and of the last twelve months', () => {
      expect(row(georgi(), 'totalVisits')).toEqual({
        id: 'totalVisits',
        theme: 'visits',
        title: 'Общо посещения',
        figure: '24',
        line: null,
        icon: 'loyalty.record.totalVisits',
        src: null,
        faceName: null,
        accessibleName: 'Общо посещения: 24',
      });
      expect(row(georgi(), 'last12Months')).toEqual({
        id: 'last12Months',
        theme: 'visits',
        title: 'Последните 12 месеца',
        figure: '14',
        line: null,
        icon: 'loyalty.record.last12Months',
        src: null,
        faceName: null,
        accessibleName: 'Последните 12 месеца: 14 посещения',
      });
    });

    it('reads the twelve months at the shop’s today: a visit leaves the window without anything being rewritten', () => {
      const stats = statsOf(GEORGI, georgiHistory());
      const inWindow = (today: string) =>
        row(georgi({ data: { ...DATA, today }, stats }), 'last12Months')
          ?.figure;
      expect(inWindow('2026-09-28')).toBe('14');
      // Three months on, the same document: the autumn of 2025 has left.
      expect(Number(inWindow('2026-12-28'))).toBeLessThan(14);
      // A year on, nothing of it is inside.
      expect(inWindow('2027-09-29')).toBe('0');
    });

    it('draws no count for a client the book does not know, or knows no worked visit of', () => {
      expect(row(georgi({ stats: null }), 'totalVisits')).toBeNull();
      expect(row(georgi({ stats: null }), 'last12Months')).toBeNull();
      const none = statsWith({
        lifetimeVisitsCompleted: 0,
        lifetimeNoShows: 1,
        lifetimeLateCancels: 0,
        lifetimeClientCancels: 0,
        last365VisitsCompleted: [],
        last365NoShows: [],
        last365LateCancels: [],
      });
      expect(row(georgi({ stats: none }), 'totalVisits')).toBeNull();
      expect(row(georgi({ stats: none }), 'last12Months')).toBeNull();
    });

    it('draws the best year with its year', () => {
      expect(row(georgi(), 'mostVisitsInYear')).toEqual({
        id: 'mostVisitsInYear',
        theme: 'visits',
        title: 'Най-много за година',
        figure: '13',
        line: '2025 г.',
        icon: 'loyalty.record.mostVisitsInYear',
        src: null,
        faceName: null,
        accessibleName: 'Най-много за година: 13 посещения, 2025 г.',
      });
    });

    it('draws the first visit as one date, always with its year', () => {
      expect(row(georgi(), 'firstVisit')).toEqual({
        id: 'firstVisit',
        theme: 'visits',
        title: 'Първо посещение',
        figure: '6.03.2025 г.',
        line: null,
        icon: 'loyalty.record.firstVisit',
        src: null,
        faceName: null,
        accessibleName: 'Първо посещение: 6 март 2025 г.',
      });
      const thisYear = withRecords([
        record('longestRhythm'),
        record('firstVisit', { on: '2026-02-03' }),
      ]);
      expect(row(georgi({ data: thisYear }), 'firstVisit')).toMatchObject({
        figure: '3.02.2026 г.',
        accessibleName: 'Първо посещение: 3 февруари',
      });
    });

    it('takes the first visit from the book where the account has not stamped it', () => {
      const unstamped = withRecords([record('longestRhythm')]);
      expect(row(georgi({ data: unstamped }), 'firstVisit')).toMatchObject({
        figure: '6.03.2025 г.',
        icon: 'loyalty.record.firstVisit',
      });
      expect(
        row(georgi({ data: unstamped, stats: null }), 'firstVisit'),
      ).toBeNull();
      expect(
        row(
          georgi({
            data: unstamped,
            stats: statsWith({
              firstVisitLocalDate: null,
              firstVisitStartMinutes: null,
            }),
          }),
          'firstVisit',
        ),
      ).toBeNull();
    });
  });

  describe('the favourites', () => {
    it('leads a favourite service with its cover, its glyph where it has none', () => {
      expect(row(georgi(), 'favouriteService')).toEqual({
        id: 'favouriteService',
        theme: 'favourites',
        title: 'Любима услуга',
        figure: 'Фейд',
        line: '24 пъти',
        icon: null,
        src: 'https://example.test/covers/fade.jpg',
        faceName: null,
        accessibleName: 'Любима услуга: Фейд, 24 пъти',
      });
      expect(row(martin(), 'favouriteService')).toMatchObject({
        figure: 'Класическа подстрижка',
        line: '13 пъти',
        icon: 'loyalty.record.favouriteService',
        src: null,
      });
    });

    it('leads the barber of choice with his face, his initials where he has no picture', () => {
      const chosen = (barberId: string) =>
        row(
          georgi({
            stats: statsWith({
              preferredBarberId: BarberId.of(barberId),
            }),
          }),
          'preferredBarber',
        );
      expect(chosen('ivan')).toEqual({
        id: 'preferredBarber',
        theme: 'favourites',
        title: 'Бръснар по избор',
        figure: 'Иван',
        line: null,
        icon: null,
        src: 'https://example.test/barbers/ivan.jpg',
        faceName: 'Иван',
        accessibleName: 'Бръснар по избор: Иван',
      });
      expect(chosen('stefan')).toMatchObject({
        figure: 'Стефан',
        icon: null,
        src: null,
        faceName: 'Стефан',
      });
      // The figure is his FIRST name, as every line of the card names him
      // (review 3, round 2: «Иван Колев» here, «Иван» a swipe away); the
      // face takes its initials from the whole name, and a reader hears it.
      const named = row(
        georgi({
          ctx: {
            ...SETTLED,
            catalog: { ...SETTLED.catalog, barberName: () => 'Иван Колев' },
          },
          stats: statsWith({
            preferredBarberId: BarberId.of('ivan'),
          }),
        }),
        'preferredBarber',
      );
      expect(named).toMatchObject({
        figure: 'Иван',
        faceName: 'Иван Колев',
        accessibleName: 'Бръснар по избор: Иван Колев',
      });
    });

    it('never infers a barber: no row until the book names one, none for one the shop no longer has', () => {
      expect(statsOf(GEORGI, georgiHistory()).preferredBarberId).toBeNull();
      expect(row(georgi(), 'preferredBarber')).toBeNull();
      expect(
        row(
          georgi({
            stats: statsWith({
              preferredBarberId: BarberId.of('gone'),
            }),
          }),
          'preferredBarber',
        ),
      ).toBeNull();
    });

    it('lists the usual services when they hold more than the favourite alone', () => {
      const usual = (...ids: readonly string[]) =>
        row(
          georgi({
            stats: statsWith({
              usualServiceIds: ids.map((id) => ServiceId.of(id)),
            }),
          }),
          'usualServices',
        );
      expect(usual('svc-fade', 'svc-beard')).toEqual({
        id: 'usualServices',
        theme: 'favourites',
        title: 'Обичайни услуги',
        figure: 'Фейд · Оформяне на брада',
        line: null,
        icon: 'loyalty.record.usualServices',
        src: null,
        faceName: null,
        accessibleName: 'Обичайни услуги: Фейд, Оформяне на брада',
      });
      // The favourite alone says nothing the row above does not.
      expect(usual('svc-fade')).toBeNull();
      expect(usual()).toBeNull();
      // One usual service that is not the favourite is news.
      expect(usual('svc-beard')?.figure).toBe('Оформяне на брада');
      // A service the catalogue no longer knows is not listed.
      expect(usual('svc-fade', 'svc-gone')).toBeNull();
    });

    it('stands in the page’s order: the service, the barber, the usual', () => {
      const vm = recordsPageVm(
        georgi({
          stats: statsWith({
            preferredBarberId: BarberId.of('ivan'),
            usualServiceIds: [
              ServiceId.of('svc-fade'),
              ServiceId.of('svc-beard'),
            ],
          }),
        }),
      );
      expect(
        vm.groups.find((g) => g.theme === 'favourites')?.rows.map((r) => r.id),
      ).toEqual(['favouriteService', 'preferredBarber', 'usualServices']);
    });
  });

  describe('«По години» (RF)', () => {
    it('counts the worked visits by the shop’s year, newest first, each against the best year', () => {
      expect(page.years).toEqual([
        {
          year: '2026',
          count: '11',
          gauge: {
            value: 11,
            min: 0,
            max: 13,
            marks: [],
            label: '2026',
            valueText: '2026: 11 посещения',
          },
          record: false,
          accessibleName: '2026: 11 посещения',
        },
        {
          year: '2025',
          count: '13',
          gauge: {
            value: 13,
            min: 0,
            max: 13,
            marks: [],
            label: '2025',
            valueText: '2025: 13 посещения, рекорд',
          },
          record: true,
          accessibleName: '2025: 13 посещения, рекорд',
        },
      ]);
    });

    it('adds up to the visits of a lifetime, and agrees with the record of the best year', () => {
      const total = (page.years ?? []).reduce(
        (sum, year) => sum + year.gauge.value,
        0,
      );
      expect(String(total)).toBe(row(georgi(), 'totalVisits')?.figure);
      expect(page.years?.find((y) => y.record)?.count).toBe(
        row(georgi(), 'mostVisitsInYear')?.figure,
      );
    });

    it('is absent unless the loaded pages are the client’s WHOLE history: a year is never under-counted', () => {
      expect(
        recordsPageVm(georgi({ historyComplete: false })).years,
      ).toBeNull();
    });

    it('counts only what was worked, and only this person’s', () => {
      // Георги's book holds a visit ahead; Мартин's a cancelled one and the one in the chair.
      expect(
        recordsPageVm(martin()).years?.map((y) => [y.year, y.count, y.record]),
      ).toEqual([
        ['2026', '6', false],
        ['2025', '7', true],
      ]);
      const visits = [
        visit('a', '2025-05-10T10:00:00'),
        visit('b', '2026-05-10T10:00:00'),
        visit('c', '2026-06-10T10:00:00', 'cancelled'),
        visit('d', '2026-10-02T10:00:00', 'open'),
        visit('e', '2026-07-10T10:00:00', 'worked', MARTIN),
      ];
      expect(
        recordsPageVm(georgi({ visits })).years?.map((y) => [y.year, y.count]),
      ).toEqual([
        ['2026', '1'],
        ['2025', '1'],
      ]);
    });

    it('counts a visit listed twice once', () => {
      const visits = [
        visit('a', '2025-05-10T10:00:00'),
        visit('b', '2026-05-10T10:00:00'),
        visit('b', '2026-05-10T10:00:00'),
      ];
      expect(
        recordsPageVm(georgi({ visits })).years?.map((y) => [y.year, y.count]),
      ).toEqual([
        ['2026', '1'],
        ['2025', '1'],
      ]);
    });

    it('files a visit under the shop’s year, whatever the device’s', () => {
      // 00:30 on 1 January in Sofia is still the old year in UTC.
      const visits = [
        visit('a', '2026-01-01T00:30:00'),
        // A seat ends by midnight on its own day (F-6): the year's last fade.
        visit('b', '2024-12-31T23:15:00'),
      ];
      expect(
        recordsPageVm(georgi({ visits })).years?.map((y) => [y.year, y.count]),
      ).toEqual([
        ['2026', '1'],
        ['2025', '0'],
        ['2024', '1'],
      ]);
    });

    it('draws a year without a visit as a bar of nought, so the run of years is unbroken', () => {
      const visits = [
        visit('a', '2024-05-10T10:00:00'),
        visit('b', '2024-06-10T10:00:00'),
        visit('c', '2026-05-10T10:00:00'),
      ];
      expect(recordsPageVm(georgi({ visits })).years).toMatchObject([
        { year: '2026', count: '1', record: false },
        {
          year: '2025',
          count: '0',
          record: false,
          gauge: { value: 0, max: 2 },
          accessibleName: '2025: 0 посещения',
        },
        {
          year: '2024',
          count: '2',
          record: true,
          accessibleName: '2024: 2 посещения, рекорд',
        },
      ]);
    });

    it('agrees the count of one', () => {
      const visits = [
        visit('a', '2025-05-10T10:00:00'),
        visit('b', '2026-05-10T10:00:00'),
        visit('c', '2026-06-10T10:00:00'),
      ];
      expect(
        recordsPageVm(georgi({ visits })).years?.map((y) => y.accessibleName),
      ).toEqual(['2026: 2 посещения, рекорд', '2025: 1 посещение']);
    });

    it('gives the emblem to the account’s record year among equals, else to the year that got there first', () => {
      const visits = [
        visit('a', '2024-05-10T10:00:00'),
        visit('b', '2025-05-10T10:00:00'),
        visit('c', '2026-05-10T10:00:00'),
      ];
      const recordYear = (year: number | null) =>
        recordsPageVm(
          georgi({
            visits,
            data: withRecords(
              year === null
                ? [record('firstVisit')]
                : [record('mostVisitsInYear', { value: 1, year })],
            ),
          }),
        )
          .years?.filter((y) => y.record)
          .map((y) => y.year);
      expect(recordYear(2025)).toEqual(['2025']);
      expect(recordYear(2026)).toEqual(['2026']);
      // No record stamped: the first of the best.
      expect(recordYear(null)).toEqual(['2024']);
      // A stamp the loaded history does not bear out never moves the emblem off the longest bar.
      expect(
        recordsPageVm(
          georgi({
            data: withRecords([
              record('mostVisitsInYear', { value: 20, year: 2026 }),
            ]),
          }),
        )
          .years?.filter((y) => y.record)
          .map((y) => y.year),
      ).toEqual(['2025']);
    });

    it('says something from the second year on: one bar is «Общо посещения» again', () => {
      expect(YEARS_MIN).toBe(2);
      const visits = [
        visit('a', '2026-05-10T10:00:00'),
        visit('b', '2026-06-10T10:00:00'),
      ];
      expect(recordsPageVm(georgi({ visits })).years).toBeNull();
      expect(recordsPageVm(georgi({ visits: [] })).years).toBeNull();
    });
  });

  describe('the empty page', () => {
    it('holds nothing before the first record and the first visit', () => {
      const fresh: AchievementsData = {
        ...DATA,
        progress: new Map(),
        account: { ...DATA.account, records: [], streaks: [] },
      };
      expect(
        recordsPageVm({
          data: fresh,
          ctx: achievementsContextOf(georgiContext(), 'Калоян Димов'),
          stats: null,
          rhythm: RHYTHM,
          visits: [],
          historyComplete: true,
        }),
      ).toEqual({
        subline: 'Калоян Димов',
        featured: null,
        groups: [],
        years: null,
      });
    });

    it('still shows what the book knows before the account has a record', () => {
      const vm = recordsPageVm(georgi({ data: withRecords([]) }));
      expect(vm.featured).toBeNull();
      expect(vm.groups.map((g) => [g.theme, g.rows.map((r) => r.id)])).toEqual([
        ['rhythm', ['currentRhythm']],
        ['visits', ['totalVisits', 'last12Months', 'firstVisit']],
        // With no favourite stamped, the usual service is news.
        ['favourites', ['usualServices']],
      ]);
    });
  });

  it('words the page in English', () => {
    const vm = recordsPageVm(
      georgi({
        ctx: achievementsContextOf(
          georgiContext(),
          'Georgi Petrov',
          false,
          wordsOf('en'),
        ),
      }),
    );
    expect(vm.featured).toMatchObject({
      label: 'Longest rhythm',
      value: '24',
      sentence: 'visits in rhythm in a row',
      detail: 'September 2026',
      accessibleName:
        'Longest rhythm: 24 visits in rhythm in a row, September 2026, a new record',
    });
    expect(vm.groups.map((g) => g.title)).toEqual([
      'Rhythm',
      'Visits',
      'Favourites',
    ]);
    expect(
      vm.groups[0]?.rows.find((r) => r.id === 'currentRhythm'),
    ).toMatchObject({ title: 'The rhythm now', line: 'since March 2025' });
    expect(vm.years?.map((y) => y.accessibleName)).toEqual([
      '2026: 11 visits',
      '2025: 13 visits, the record',
    ]);
  });
});
