import { describe, expect, it } from 'vitest';
import {
  AwardKind,
  BadgeSeriesId,
  LocationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  BookingLifecycle,
  type EarnedLevel,
  EarnedVia,
  type MetricRef,
  PerkId,
  SeatOutcome,
} from '@core/components';
import type {
  Appointment,
  BadgeProgress,
  BadgeSeries,
  BadgeSeriesMeta,
} from '@core/entities';
import { LoyaltyCatalogSystem, ZonedTimeSystem } from '@core/systems';
import { customerOf, localDate, utcMs } from '@core/testing';
import type { RhythmRuleWords } from '@creativo/features/shared/visits';
import type { AchievementsContext } from './achievements.presenter';
import type {
  AchievementsData,
  DetailPictureVm,
  LinePart,
  MedalDetailVm,
} from './client-pages.vm';
import type { HistoryRowsInput } from './history.presenter';
import {
  type MedalDetailExtra,
  countsToward,
  detailActionOf,
  detailCovers,
  medalDetailVm,
} from './medal-detail.presenter';
import { medalRingVm } from './medals.presenter';
import {
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_NEXT_ID,
  GEORGI_PREVIOUS_MS,
  MARTIN,
  MARTIN_CUSTOMER_ID,
  MARTIN_PREVIOUS_MS,
  MARTIN_TODAY_ID,
  NOW_MS,
  SHOP_CATALOG,
  SHOP_TIME_ZONE,
  achievementsContextOf,
  achievementsDataOf,
  sofiaIso,
  contactOf,
  visitOf as flatVisitOf,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  martinContext,
  martinHistory,
  must,
  seatOf,
  sofia,
  wallOf,
  wordsOf,
} from '../testing/client-card.fixtures';

/*
 * The medal's detail over the dev shop's two holders (the fixtures' book:
 * «now» is Monday 28 September 2026). Георги has 24 worked fades with Иван
 * at Център, every one at 10:00; Мартин 13 classic cuts with Иван or Нико
 * and is in the chair today, on his birthday.
 *
 * How a family's medal is DRAWN is `medalRingVm`'s (its own spec pins it):
 * this spec only asks that the page draws the hero and the neighbours
 * with it, and pins everything the page words itself.
 */

const GEORGI_DATA = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const MARTIN_DATA = achievementsDataOf('martin', MARTIN_PREVIOUS_MS);
/** Георги's card on today's settled fade: nothing a visit can still move. */
const SETTLED = achievementsContextOf(georgiContext(), 'Георги Петров');
/** Георги's card on his next fade, still open. */
const OPEN = achievementsContextOf(georgiOpenContext(), 'Георги Петров');
/** Мартин in the chair for a classic cut, on his birthday. */
const IN_CHAIR = achievementsContextOf(martinContext(), 'Мартин Илиев', true);

const GEORGI_BOOK = georgiHistory();
const MARTIN_BOOK = martinHistory();

const EDITABLE = { online: true, visitGone: false, paused: false } as const;

/** An account's client record (D29), derived as the pipelines derive it; a blank uid is nobody's. */
function recordOf(uid: string): string {
  return uid === '' ? '' : customerOf(UserId.of(uid));
}

function family(data: AchievementsData, id: string): BadgeSeries {
  return must(
    LoyaltyCatalogSystem.series(data.catalog, BadgeSeriesId.of(id)),
    id,
  );
}

/** A level earned at an instant, filed under its shop day as the engine writes it (T5). */
function earnedLevel(level: number, iso: string, count = 1): EarnedLevel {
  const at = utcMs(iso);
  return {
    level,
    earnedAtUtcMs: at,
    earnedLocalDate: ZonedTimeSystem.toLocal(at, SHOP_TIME_ZONE).localDate,
    earnedVia: EarnedVia.Rule,
    count,
  };
}

/** A family withdrawn from the catalogue on 1 September 2026 (3:00 in Sofia), its stamp beside its day. */
const RETIRED: FamilyEdit = {
  retiredAtUtcMs: utcMs('2026-09-01T00:00:00Z'),
  retiredLocalDate: localDate('2026-09-01'),
};

function rowsOf(
  appointments: readonly Appointment[],
  subjectUserId: string,
  currentAppointmentId: string | null,
): HistoryRowsInput {
  return {
    appointments,
    subjectUserId,
    subjectCustomerId: recordOf(subjectUserId),
    currentAppointmentId,
    nowMs: NOW_MS,
    photoCounts: new Map(),
    clientWords: true,
    catalog: SHOP_CATALOG,
    words: wordsOf('bg'),
  };
}

function georgiExtra(
  overrides: Partial<MedalDetailExtra> = {},
): MedalDetailExtra {
  return {
    visits: GEORGI_BOOK,
    subjectCustomerId: GEORGI_CUSTOMER_ID,
    rule: null,
    rows: rowsOf(GEORGI_BOOK, GEORGI, 'appt-dev-1'),
    action: null,
    ...overrides,
  };
}

function martinExtra(
  overrides: Partial<MedalDetailExtra> = {},
): MedalDetailExtra {
  return {
    visits: MARTIN_BOOK,
    subjectCustomerId: MARTIN_CUSTOMER_ID,
    rule: null,
    rows: rowsOf(MARTIN_BOOK, MARTIN, MARTIN_TODAY_ID),
    action: null,
    ...overrides,
  };
}

/** Георги's page for a family, on today's settled visit. */
function georgiPage(
  id: string,
  ctx: AchievementsContext = SETTLED,
  extra: MedalDetailExtra = georgiExtra(),
  data: AchievementsData = GEORGI_DATA,
): MedalDetailVm {
  return must(medalDetailVm(id, data, ctx, extra), id);
}

/** Мартин's page for a family, from the chair. */
function martinPage(
  id: string,
  extra: MedalDetailExtra = martinExtra(),
  data: AchievementsData = MARTIN_DATA,
): MedalDetailVm {
  return must(medalDetailVm(id, data, IN_CHAIR, extra), id);
}

const joined = (line: readonly LinePart[]): string =>
  line.map((part) => part.text).join('');
const facts = (line: readonly LinePart[]): readonly string[] =>
  line.filter((part) => part.fact).map((part) => part.text);

/** The same data with one family's progress replaced (or taken away). */
function withProgress(
  data: AchievementsData,
  seriesId: string,
  progress: Omit<BadgeProgress, 'id'> | null,
): AchievementsData {
  const all = new Map(data.progress);
  if (progress === null) all.delete(seriesId);
  else all.set(seriesId, { ...progress, id: BadgeSeriesId.of(seriesId) });
  return { ...data, progress: all };
}

/** What a case changes on a family: any field of its own or of its metric, never its id or subject. */
type FamilyEdit = Partial<Omit<BadgeSeriesMeta, 'id'> & MetricRef>;

/** The same data with one family changed in the catalogue. */
function withFamily(
  data: AchievementsData,
  seriesId: string,
  change: FamilyEdit,
): AchievementsData {
  return {
    ...data,
    catalog: {
      ...data.catalog,
      families: data.catalog.families.map((series): BadgeSeries =>
        series.id === seriesId ? { ...series, ...change } : series,
      ),
    },
  };
}

interface SeatPlan {
  readonly who: string;
  readonly serviceId?: string;
  readonly barberId?: string;
  readonly worked?: boolean;
}

const DAY_MS = 86_400_000;

/** One appointment at Център, its seats one after another from `startsAt` (Sofia). */
function visitOf(
  id: string,
  startsAt: string,
  seats: readonly SeatPlan[],
  options: {
    readonly arrivedAt?: string;
    readonly locationId?: string;
  } = {},
): Appointment {
  const allWorked = seats.every((seat) => seat.worked ?? true);
  const wall = wallOf(startsAt);
  const start = sofia(startsAt);
  const doneAt = (index: number) =>
    UtcEpochMs.plusMs(start, (index + 1) * 45 * 60_000);
  const booked = UtcEpochMs.plusMs(start, -7 * DAY_MS);
  const visit = flatVisitOf({
    id,
    localDate: wall.localDate,
    seats: seats.map((seat, index) =>
      seatOf({
        id: `${id}-s${index + 1}`,
        who: seat.who,
        companion: seat.who !== seats[0]?.who,
        serviceId: seat.serviceId ?? 'svc-fade',
        barberId: seat.barberId ?? 'ivan',
        minutes: 45,
        priceMinor: 1750,
        startMinutes: wall.minute + index * 45,
        outcome:
          (seat.worked ?? true)
            ? SeatOutcome.worked(doneAt(index))
            : SeatOutcome.scheduled(),
      }),
    ),
    lifecycle: allWorked
      ? BookingLifecycle.complete(doneAt(seats.length - 1))
      : BookingLifecycle.confirm(booked),
    contact: contactOf('Георги Петров', '+359881234567', null),
    bookedAtUtcMs: booked,
    arrivedAtUtcMs:
      options.arrivedAt === undefined ? null : sofia(options.arrivedAt),
  });
  return options.locationId === undefined
    ? visit
    : { ...visit, locationId: LocationId.of(options.locationId) };
}

describe('countsToward', () => {
  const counted = (
    data: AchievementsData,
    id: string,
    book: readonly Appointment[],
    who: string,
  ) =>
    book
      .filter((visit) =>
        countsToward(family(data, id), visit, recordOf(who), SHOP_TIME_ZONE),
      )
      .map((visit) => visit.id);

  it('tells the projection’s own story: as many visits count as the family’s value says', () => {
    // The whole book is loaded, and none of these families has a window.
    const stories: readonly (readonly [
      AchievementsData,
      readonly Appointment[],
      string,
      readonly string[],
    ])[] = [
      [
        GEORGI_DATA,
        GEORGI_BOOK,
        GEORGI,
        [
          'series-visits',
          'series-svc-fade',
          'series-svc-beard',
          'series-barber-ivan',
          'series-shop-center',
          'series-early-bird',
          'series-weekend',
        ],
      ],
      [
        MARTIN_DATA,
        MARTIN_BOOK,
        MARTIN,
        [
          'series-visits',
          'series-svc-classic-cut',
          'series-barber-ivan',
          'series-barber-niko',
          'series-shop-center',
          'series-weekend',
        ],
      ],
    ];
    for (const [data, book, who, ids] of stories) {
      for (const id of ids) {
        expect([id, counted(data, id, book, who).length]).toEqual([
          id,
          must(data.progress.get(id), id).value,
        ]);
      }
    }
  });

  it('counts only a worked visit: never an hour still to come, nor a cancelled one', () => {
    const fade = counted(GEORGI_DATA, 'series-svc-fade', GEORGI_BOOK, GEORGI);
    expect(fade).toContain('appt-dev-1');
    expect(fade).not.toContain(GEORGI_NEXT_ID);
    const classic = counted(
      MARTIN_DATA,
      'series-svc-classic-cut',
      MARTIN_BOOK,
      MARTIN,
    );
    // The shop's cancellation, and today's cut while he is still in the chair.
    expect(classic).not.toContain('appt-hist-c2-11');
    expect(classic).not.toContain(MARTIN_TODAY_ID);
  });

  it('asks for the service, the barber and the shop among the person’s own worked seats', () => {
    expect(
      counted(GEORGI_DATA, 'series-svc-classic-cut', GEORGI_BOOK, GEORGI),
    ).toEqual([]);
    expect(
      counted(GEORGI_DATA, 'series-barber-niko', GEORGI_BOOK, GEORGI),
    ).toEqual([]);
    expect(
      counted(GEORGI_DATA, 'series-shop-mladost', GEORGI_BOOK, GEORGI),
    ).toEqual([]);
    // Someone else's book says nothing about this person.
    expect(
      counted(GEORGI_DATA, 'series-svc-fade', GEORGI_BOOK, MARTIN),
    ).toEqual([]);
    expect(counted(GEORGI_DATA, 'series-visits', GEORGI_BOOK, '')).toEqual([]);

    // A companion's fade is not the booker's: his own seat was a beard.
    const party = visitOf('appt-party', '2026-09-12T11:00:00', [
      { who: GEORGI, serviceId: 'svc-beard' },
      { who: MARTIN, serviceId: 'svc-fade', barberId: 'niko' },
    ]);
    const fade = family(GEORGI_DATA, 'series-svc-fade');
    const niko = family(GEORGI_DATA, 'series-barber-niko');
    expect(countsToward(fade, party, GEORGI_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      false,
    );
    expect(countsToward(fade, party, MARTIN_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      true,
    );
    expect(countsToward(niko, party, GEORGI_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      false,
    );
    expect(countsToward(niko, party, MARTIN_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      true,
    );
  });

  it('counts the person’s worked seat on a visit a companion has not finished', () => {
    const half = visitOf('appt-half', '2026-09-12T11:00:00', [
      { who: GEORGI },
      { who: MARTIN, worked: false },
    ]);
    const visits = family(GEORGI_DATA, 'series-visits');
    expect(countsToward(visits, half, GEORGI_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      true,
    );
    expect(countsToward(visits, half, MARTIN_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      false,
    );
  });

  it('reads an early bird by when the person’s own first worked seat began: by 10:00', () => {
    const early = family(GEORGI_DATA, 'series-early-bird');
    const who = [{ who: GEORGI }];
    expect(
      countsToward(
        early,
        visitOf('a', '2026-09-10T10:00:00', who),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(true);
    expect(
      countsToward(
        early,
        visitOf('b', '2026-09-10T10:05:00', who),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(false);
    // The booker sat at 9:30; the companion's own seat began at 10:15.
    const party = visitOf('c', '2026-09-10T09:30:00', [
      { who: GEORGI },
      { who: MARTIN },
    ]);
    expect(countsToward(early, party, GEORGI_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      true,
    );
    expect(countsToward(early, party, MARTIN_CUSTOMER_ID, SHOP_TIME_ZONE)).toBe(
      false,
    );
  });

  it('reads a weekend visit off the shop’s calendar: Saturday and Sunday', () => {
    const weekend = family(GEORGI_DATA, 'series-weekend');
    const who = [{ who: GEORGI }];
    const days: readonly (readonly [string, boolean])[] = [
      ['2026-09-11T11:00:00', false], // Friday
      ['2026-09-12T11:00:00', true], // Saturday
      ['2026-09-13T11:00:00', true], // Sunday
      ['2026-09-14T11:00:00', false], // Monday
    ];
    for (const [day, counts] of days) {
      expect([
        day,
        countsToward(
          weekend,
          visitOf('w', day, who),
          GEORGI_CUSTOMER_ID,
          SHOP_TIME_ZONE,
        ),
      ]).toEqual([day, counts]);
    }
  });

  it('counts a punctual visit only when the arrival was marked, by the start', () => {
    const onTime = family(GEORGI_DATA, 'series-on-time');
    const start = '2026-09-10T11:00:00';
    const who = [{ who: GEORGI }];
    expect(
      countsToward(
        onTime,
        visitOf('a', start, who),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(false);
    expect(
      countsToward(
        onTime,
        visitOf('b', start, who, { arrivedAt: '2026-09-10T10:55:00' }),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(true);
    expect(
      countsToward(
        onTime,
        visitOf('c', start, who, { arrivedAt: start }),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(true);
    expect(
      countsToward(
        onTime,
        visitOf('d', start, who, { arrivedAt: '2026-09-10T11:05:00' }),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(false);
  });

  it('counts a visit with company only when someone else holds a seat on it', () => {
    const party = family(GEORGI_DATA, 'series-party');
    const start = '2026-09-10T11:00:00';
    expect(
      countsToward(
        party,
        visitOf('a', start, [{ who: GEORGI }]),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(false);
    expect(
      countsToward(
        party,
        visitOf('b', start, [{ who: GEORGI }, { who: MARTIN }]),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(true);
    // Two services of his own are not company.
    expect(
      countsToward(
        party,
        visitOf('c', start, [
          { who: GEORGI },
          { who: GEORGI, serviceId: 'svc-beard' },
        ]),
        GEORGI_CUSTOMER_ID,
        SHOP_TIME_ZONE,
      ),
    ).toBe(false);
  });

  it('answers no for a family that counts no single visit', () => {
    for (const id of [
      'series-welcome',
      'series-birthday',
      'series-rhythm',
      'series-tenure',
      'series-self-service',
      'series-referrals',
      'series-waitlist',
      'series-explorer',
      'series-all-barbers',
      'series-both-shops',
      'series-twelve-months',
    ]) {
      expect([
        id,
        counted(GEORGI_DATA, id, GEORGI_BOOK, GEORGI).length,
      ]).toEqual([id, 0]);
    }
  });
});

describe('detailActionOf', () => {
  const fade = family(MARTIN_DATA, 'series-svc-fade');

  it('offers the family’s service while the open visit lacks it, the name in the running case', () => {
    expect(detailActionOf(fade, IN_CHAIR, EDITABLE)).toEqual({
      serviceId: 'svc-fade',
      label: 'Добави фейд',
      accessibleName: 'Добави Фейд към посещението',
    });
    expect(detailActionOf(fade, IN_CHAIR, EDITABLE, MARTIN_DATA)).toEqual({
      serviceId: 'svc-fade',
      label: 'Добави фейд',
      accessibleName: 'Добави Фейд към посещението',
    });
  });

  it('gives way once the visit holds the service', () => {
    expect(
      detailActionOf(
        family(MARTIN_DATA, 'series-svc-classic-cut'),
        IN_CHAIR,
        EDITABLE,
      ),
    ).toBeNull();
    // «Добави фейд» was tapped: the draft holds a fade now.
    const added = achievementsContextOf(
      martinContext({
        legs: [
          ...martinContext().legs,
          {
            serviceId: 'svc-fade',
            variantId: null,
            minutes: 45,
            barberId: 'ivan',
            startsAtIso: sofiaIso('2026-09-28T13:00:00'),
          },
        ],
      }),
      'Мартин Илиев',
    );
    expect(detailActionOf(fade, added, EDITABLE)).toBeNull();
  });

  it('is absent offline, on a visit that is gone, and for a paused client', () => {
    expect(
      detailActionOf(fade, IN_CHAIR, { ...EDITABLE, online: false }),
    ).toBeNull();
    expect(
      detailActionOf(fade, IN_CHAIR, { ...EDITABLE, visitGone: true }),
    ).toBeNull();
    expect(
      detailActionOf(fade, IN_CHAIR, { ...EDITABLE, paused: true }),
    ).toBeNull();
  });

  it('is absent without an open visit to add to', () => {
    // Георги's fade is settled: nothing counts «с това посещение» any more.
    expect(
      detailActionOf(
        family(GEORGI_DATA, 'series-svc-classic-cut'),
        SETTLED,
        EDITABLE,
      ),
    ).toBeNull();
  });

  it('is a verb for a SERVICE only: never a barber, a shop, a count of visits', () => {
    for (const id of [
      'series-barber-niko',
      'series-shop-mladost',
      'series-visits',
      'series-early-bird',
      'series-welcome',
      'series-rhythm',
    ]) {
      expect([
        id,
        detailActionOf(family(MARTIN_DATA, id), IN_CHAIR, EDITABLE),
      ]).toEqual([id, null]);
    }
  });

  it('is absent for a family that is no longer awarded, or names a service the shop no longer has', () => {
    const retired = withFamily(MARTIN_DATA, 'series-svc-fade', RETIRED);
    expect(
      detailActionOf(
        family(retired, 'series-svc-fade'),
        IN_CHAIR,
        EDITABLE,
        retired,
      ),
    ).toBeNull();
    const unnamed: AchievementsContext = {
      ...IN_CHAIR,
      catalog: { ...SHOP_CATALOG, serviceName: () => null },
    };
    expect(detailActionOf(fade, unnamed, EDITABLE)).toBeNull();
  });

  it('is absent for a family with nothing left to earn, once it is handed the data', () => {
    const complete = withProgress(MARTIN_DATA, 'series-svc-fade', {
      value: 100,
      earned: fade.levels.map((level) =>
        earnedLevel(level.level, '2026-06-03T08:00:00Z'),
      ),
    });
    expect(detailActionOf(fade, IN_CHAIR, EDITABLE, complete)).toBeNull();
    // A season's family, once the season has ended.
    const beard = family(MARTIN_DATA, 'series-2026-autumn-beard');
    expect(detailActionOf(beard, IN_CHAIR, EDITABLE, MARTIN_DATA)).toEqual({
      serviceId: 'svc-beard',
      label: 'Добави оформяне на брада',
      accessibleName: 'Добави Оформяне на брада към посещението',
    });
    expect(
      detailActionOf(beard, IN_CHAIR, EDITABLE, {
        ...MARTIN_DATA,
        today: '2026-12-01',
      }),
    ).toBeNull();
  });

  it('leaves a Latin brand and an acronym as the shop writes them', () => {
    const named = (name: string): AchievementsContext => ({
      ...IN_CHAIR,
      catalog: { ...SHOP_CATALOG, serviceName: () => name },
    });
    expect(detailActionOf(fade, named('SPA ден'), EDITABLE)?.label).toBe(
      'Добави SPA ден',
    );
    expect(detailActionOf(fade, named('Skin fade'), EDITABLE)?.label).toBe(
      'Добави Skin fade',
    );
    expect(detailActionOf(fade, named('Фейд'), EDITABLE)?.accessibleName).toBe(
      'Добави Фейд към посещението',
    );
  });
});

describe('detailCovers', () => {
  const covers = (count: number): readonly DetailPictureVm[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `svc-${index + 1}`,
      title: `Услуга ${index + 1}`,
      caption: null,
      src: null,
      more: null,
    }));

  it('sets one cover across the card at the subject’s own ratio, and none as none', () => {
    expect(detailCovers([], '16 / 9')).toEqual({
      pictures: [],
      ratio: '16 / 9',
      columns: 1,
    });
    expect(detailCovers(covers(1), '4 / 3')).toEqual({
      pictures: covers(1),
      ratio: '4 / 3',
      columns: 1,
    });
  });

  it('sets two to four in a 2-up grid at 4 / 3', () => {
    for (const count of [2, 3, 4]) {
      expect(detailCovers(covers(count), '16 / 9')).toEqual({
        pictures: covers(count),
        ratio: '4 / 3',
        columns: 2,
      });
    }
  });

  it('folds a fifth and more into «+N» on the fourth', () => {
    const six = detailCovers(covers(6), '16 / 9');
    expect(six.pictures.map((cover) => [cover.key, cover.more])).toEqual([
      ['svc-1', null],
      ['svc-2', null],
      ['svc-3', null],
      ['svc-4', 2],
    ]);
    expect(six.columns).toBe(2);
  });
});

describe('medalDetailVm', () => {
  it('answers null for a family the catalogue lacks', () => {
    expect(
      medalDetailVm('series-nowhere', GEORGI_DATA, SETTLED, georgiExtra()),
    ).toBeNull();
  });

  it('draws «Фейд» as six blocks, each fact once', () => {
    const page = georgiPage('series-svc-fade');
    expect(page).toEqual({
      seriesId: 'series-svc-fade',
      categoryId: 'cat-mastery',
      title: 'Фейд',
      medal: page.medal,
      stateLine: [
        { text: 'Майсторство · Ниво II · от ', fact: false },
        { text: '22.09.2025\u00a0г.', fact: true },
      ],
      progress: {
        value: '24',
        unit: 'от 25',
        what: 'посещения с фейд',
        remaining: 'Още 1 до ниво III',
        thisVisit: null,
      },
      how: {
        sentence: 'Всяко посещение с фейд се брои, щом приключи.',
        pictures: [
          {
            key: 'svc-fade',
            title: 'Фейд',
            caption: null,
            src: 'https://example.test/covers/fade.jpg',
            more: null,
          },
        ],
        ratio: '16 / 9',
        columns: 1,
        faces: [
          { name: 'Иван', src: 'https://example.test/barbers/ivan.jpg' },
          { name: 'Нико', src: 'https://example.test/barbers/niko.jpg' },
          { name: 'Стефан', src: null },
        ],
        who: 'При всеки бръснар · във всеки салон',
        excluded: 'Отменени часове и неявявания не се броят.',
        steps: [],
      },
      ladder: page.ladder,
      visits: page.visits,
      related: page.related,
      action: null,
    });
    // The count is the progress card's alone.
    expect(joined(page.stateLine)).not.toContain('24');
    expect(page.how?.sentence).not.toMatch(/\d/u);
  });

  describe('the hero', () => {
    it('is the family’s ring at the stage’s size, standing alone', () => {
      for (const id of [
        'series-svc-fade',
        'series-svc-classic-cut',
        'series-rhythm',
        'series-welcome',
      ]) {
        expect(georgiPage(id).medal).toEqual({
          ...medalRingVm(
            family(GEORGI_DATA, id),
            GEORGI_DATA,
            SETTLED,
            'extraLarge',
          ),
          title: null,
          caption: null,
        });
      }
    });
  });

  describe('the state line', () => {
    it('names the shelf, the level the medal wears and the day it was earned, the day set apart', () => {
      const line = georgiPage('series-svc-fade').stateLine;
      expect(joined(line)).toBe(
        'Майсторство · Ниво II · от 22.09.2025\u00a0г.',
      );
      expect(facts(line)).toEqual(['22.09.2025\u00a0г.']);
    });

    it('always names the year: a medal’s day is a record', () => {
      // Earned this year, and still dated in full.
      const line = georgiPage('series-tenure').stateLine;
      expect(joined(line)).toBe('Етапи · Ниво I · от 6.03.2026\u00a0г.');
      expect(facts(line)).toEqual(['6.03.2026\u00a0г.']);
    });

    it('says a family nothing moved yet has not been started, in the running case', () => {
      expect(georgiPage('series-svc-classic-cut').stateLine).toEqual([
        { text: 'Майсторство · още не е започнато', fact: false },
      ]);
    });

    it('says a family under way holds no level yet, and leaves the count to the card', () => {
      const page = georgiPage('series-weekend');
      expect(page.stateLine).toEqual([
        { text: 'Специални · Още не е спечелено', fact: false },
      ]);
      expect(page.progress.value).toBe('2');
    });

    it('dates the last level of a ladder climbed to its top', () => {
      const line = georgiPage('series-rhythm').stateLine;
      expect(joined(line)).toBe(
        'Ритъм · Всички нива · последното на 28.09.2026\u00a0г.',
      );
      expect(facts(line)).toEqual(['28.09.2026\u00a0г.']);
    });

    it('dates a single act by its day, earned or not', () => {
      const earned = georgiPage('series-welcome').stateLine;
      expect(joined(earned)).toBe('Специални · Спечелено на 6.03.2025\u00a0г.');
      expect(facts(earned)).toEqual(['6.03.2025\u00a0г.']);
      expect(georgiPage('series-profile').stateLine).toEqual([
        { text: 'Специални · Още не е спечелено', fact: false },
      ]);
      // One counted level, earned: a single act too, never «Всички нива».
      expect(joined(georgiPage('series-2026-autumn-early').stateLine)).toBe(
        'Есен 2026 · Спечелено на 28.09.2026\u00a0г.',
      );
    });

    it('counts a yearly act’s times, and dates the last', () => {
      const at = '2025-09-28T09:30:00Z';
      const once = withProgress(MARTIN_DATA, 'series-birthday', {
        value: 1,
        earned: [earnedLevel(1, at)],
      });
      expect(
        joined(martinPage('series-birthday', martinExtra(), once).stateLine),
      ).toBe('Специални · Спечелено на 28.09.2025\u00a0г.');
      const thrice = withProgress(MARTIN_DATA, 'series-birthday', {
        value: 3,
        earned: [earnedLevel(1, at, 3)],
      });
      const line = martinPage(
        'series-birthday',
        martinExtra(),
        thrice,
      ).stateLine;
      expect(joined(line)).toBe(
        'Специални · Спечелено 3 пъти · последно на 28.09.2025\u00a0г.',
      );
      expect(facts(line)).toEqual(['28.09.2025\u00a0г.']);
    });

    it('names the season of a season’s family, and says an ended one closed', () => {
      expect(georgiPage('series-2026-autumn-track').stateLine).toEqual([
        { text: 'Есен 2026 · Ниво II · от ', fact: false },
        { text: '28.09.2026\u00a0г.', fact: true },
      ]);
      const ended = georgiPage('series-2026-summer-track');
      expect(ended.categoryId).toBeNull();
      expect(ended.stateLine).toEqual([
        { text: 'Лято 2026 · Сезонът приключи.', fact: false },
      ]);
    });

    it('says only that a retired family is no longer awarded', () => {
      const retired = withFamily(GEORGI_DATA, 'series-svc-fade', RETIRED);
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra(), retired)
          .stateLine,
      ).toEqual([{ text: 'Вече не се присъжда.', fact: false }]);
    });

    it('cuts the line where the language puts the day', () => {
      const en = wordsOf('en');
      const ctx = achievementsContextOf(
        georgiContext(),
        'Georgi Petrov',
        false,
        en,
      );
      const line = georgiPage(
        'series-svc-fade',
        ctx,
        georgiExtra({
          rows: { ...rowsOf(GEORGI_BOOK, GEORGI, 'appt-dev-1'), words: en },
        }),
      ).stateLine;
      expect(joined(line)).toMatch(/^Mastery · Level II · since /u);
      expect(facts(line)).toHaveLength(1);
      expect(joined(line).endsWith(facts(line)[0] ?? '?')).toBe(true);
    });
  });

  describe('the progress card', () => {
    it('counts towards the next level: the figure, its threshold, what is counted, what is left', () => {
      expect(georgiPage('series-svc-beard').progress).toEqual({
        value: '6',
        unit: 'от 10',
        what: 'посещения с оформяне на брада',
        remaining: 'Още 4 до ниво II',
        thisVisit: null,
      });
      expect(georgiPage('series-svc-classic-cut').progress).toEqual({
        value: '0',
        unit: 'от 3',
        what: 'посещения с класическа подстрижка',
        remaining: 'Още 3 до ниво I',
        thisVisit: null,
      });
    });

    it('words what is counted by the family’s metric, in the form the threshold asks for', () => {
      const what = (id: string) => georgiPage(id).progress.what;
      expect(what('series-visits')).toBe('завършени посещения');
      expect(what('series-barber-ivan')).toBe('посещения при Иван');
      // A barber in a sentence goes by first name, as every line of the
      // card names him (review 3, round 2); the whole name is the faces'.
      const surnamed: AchievementsContext = {
        ...SETTLED,
        catalog: { ...SHOP_CATALOG, barberName: () => 'Иван Колев' },
      };
      expect(georgiPage('series-barber-ivan', surnamed).progress.what).toBe(
        'посещения при Иван',
      );
      expect(what('series-shop-center')).toBe('посещения в Център');
      expect(what('series-early-bird')).toBe('посещения до 10:00');
      expect(what('series-weekend')).toBe('посещения в събота или неделя');
      expect(what('series-on-time')).toBe('посещения без закъснение');
      expect(what('series-self-service')).toBe('часа, запазени онлайн');
      expect(what('series-explorer')).toBe('различни услуги');
      expect(what('series-rhythm')).toBe('поредни посещения в ритъм');
      // «0 от 1»: the threshold governs the noun.
      expect(georgiPage('series-referrals').progress).toMatchObject({
        value: '0',
        unit: 'от 1',
        what: 'приятел, дошъл по препоръка',
      });
    });

    it('falls back to the family’s own words for a subject the shop no longer names', () => {
      const ctx: AchievementsContext = {
        ...SETTLED,
        catalog: {
          ...SHOP_CATALOG,
          serviceName: () => null,
          barberName: () => null,
          locationName: () => null,
        },
      };
      expect(georgiPage('series-svc-fade', ctx).progress.what).toBe(
        'посещения с фейд',
      );
      expect(georgiPage('series-barber-ivan', ctx).progress.what).toBe(
        'посещения при Иван',
      );
      expect(georgiPage('series-shop-center', ctx).progress.what).toBe(
        'посещения в Център',
      );
    });

    it('says what this visit adds while its draft holds what counts', () => {
      // His next fade, still open: the twenty-fifth.
      expect(
        georgiPage(
          'series-svc-fade',
          OPEN,
          georgiExtra({ rows: rowsOf(GEORGI_BOOK, GEORGI, GEORGI_NEXT_ID) }),
        ).progress,
      ).toEqual({
        value: '24',
        unit: 'от 25',
        what: 'посещения с фейд',
        remaining: 'Още 1 до ниво III',
        thisVisit: 'С това посещение: 25 от 25',
      });
      const thisVisit = (id: string, ctx: AchievementsContext) =>
        georgiPage(id, ctx).progress.thisVisit;
      // A fade with Иван at Център, at 10:00 on a Friday.
      expect(thisVisit('series-visits', OPEN)).not.toBeNull();
      expect(thisVisit('series-barber-ivan', OPEN)).not.toBeNull();
      expect(thisVisit('series-shop-center', OPEN)).not.toBeNull();
      expect(thisVisit('series-early-bird', OPEN)).not.toBeNull();
      expect(thisVisit('series-svc-beard', OPEN)).toBeNull();
      expect(thisVisit('series-barber-niko', OPEN)).toBeNull();
      expect(thisVisit('series-shop-mladost', OPEN)).toBeNull();
      expect(thisVisit('series-weekend', OPEN)).toBeNull();
      // A settled visit adds nothing more.
      expect(thisVisit('series-svc-fade', SETTLED)).toBeNull();
      // Мартин's 12:30 classic cut.
      expect(martinPage('series-svc-classic-cut').progress.thisVisit).toBe(
        'С това посещение: 14 от 25',
      );
      expect(martinPage('series-early-bird').progress.thisVisit).toBeNull();
      expect(martinPage('series-svc-fade').progress.thisVisit).toBeNull();
    });

    it('counts a weekend visit by the draft’s own day', () => {
      const saturday = achievementsContextOf(
        georgiContext({
          appointmentId: GEORGI_NEXT_ID,
          settled: false,
          legs: [
            {
              serviceId: 'svc-fade',
              variantId: null,
              minutes: 45,
              barberId: 'ivan',
              startsAtIso: sofiaIso('2026-10-03T11:00:00'),
            },
          ],
        }),
        'Георги Петров',
      );
      expect(georgiPage('series-weekend', saturday).progress.thisVisit).toBe(
        'С това посещение: 3 от 3',
      );
      expect(
        georgiPage('series-early-bird', saturday).progress.thisVisit,
      ).toBeNull();
    });

    it('never promises what only the day decides: a punctual arrival, company, a new service', () => {
      for (const id of [
        'series-on-time',
        'series-party',
        'series-explorer',
        'series-self-service',
        'series-tenure',
        'series-rhythm',
      ]) {
        expect([id, georgiPage(id, OPEN).progress.thisVisit]).toEqual([
          id,
          null,
        ]);
      }
    });

    it('shows a ladder climbed to its top by its last threshold, «Всички нива»', () => {
      expect(georgiPage('series-rhythm', OPEN).progress).toEqual({
        value: '24',
        unit: null,
        what: 'поредни посещения в ритъм',
        remaining: 'Всички нива',
        thisVisit: null,
      });
      // Past the top the figure is still the threshold.
      const past = withProgress(GEORGI_DATA, 'series-twelve-months', {
        ...must(GEORGI_DATA.progress.get('series-twelve-months')),
        value: 17,
      });
      expect(
        georgiPage('series-twelve-months', SETTLED, georgiExtra(), past)
          .progress,
      ).toMatchObject({ value: '12', unit: null, remaining: 'Всички нива' });
    });

    it('shows one counted level, earned, as a single act: no «Всички нива»', () => {
      expect(georgiPage('series-2026-autumn-early').progress).toEqual({
        value: '2',
        unit: null,
        what: 'посещения до 10:00',
        remaining: null,
        thisVisit: null,
      });
    });

    it('shows a single act by its day once it is done, and «0 от 1» until then: words do not fit the figure', () => {
      expect(georgiPage('series-welcome').progress).toEqual({
        value: '6.03.2025\u00a0г.',
        unit: null,
        what: 'първо посещение в салона',
        remaining: null,
        thisVisit: null,
      });
      // In the chair on his birthday: the visit IS the act.
      expect(martinPage('series-birthday').progress).toEqual({
        value: '0',
        unit: 'от 1',
        what: 'посещение на рождения ден',
        remaining: null,
        thisVisit: 'С това посещение',
      });
      expect(georgiPage('series-profile').progress).toEqual({
        value: '0',
        unit: 'от 1',
        what: 'имейл, рожден ден и снимка в профила',
        remaining: null,
        thisVisit: null,
      });
      // Every figure is a figure: none is a sentence.
      for (const series of GEORGI_DATA.catalog.families) {
        expect([series.id, georgiPage(series.id, OPEN).progress.value]).toEqual(
          [series.id, expect.stringMatching(/^\d[\d\s.]*(\u00a0г\.)?$/u)],
        );
      }
    });

    it('says again «С това посещение» for a yearly act earned before, on the day', () => {
      const lastYear = withProgress(MARTIN_DATA, 'series-birthday', {
        value: 1,
        earned: [earnedLevel(1, '2025-09-28T09:30:00Z')],
      });
      expect(
        martinPage('series-birthday', martinExtra(), lastYear).progress,
      ).toEqual({
        value: '28.09.2025\u00a0г.',
        unit: null,
        what: 'посещение на рождения ден',
        remaining: null,
        thisVisit: 'С това посещение',
      });
    });

    it('words tenure by the day its next level lands, never by days left', () => {
      expect(georgiPage('series-tenure').progress).toEqual({
        value: '571',
        unit: 'от 730',
        what: 'дни от първото посещение',
        // «Ниво» keeps its numeral beside it: the catalogue's own no-break space.
        remaining: 'Ниво\u00a0II на 6.03.2027\u00a0г.',
        thisVisit: null,
      });
    });

    it('reads nothing as progress where the family can no longer move', () => {
      // Its season ended at level III of five.
      expect(georgiPage('series-2026-summer-track', OPEN).progress).toEqual({
        value: '3',
        unit: null,
        what: 'завършени посещения',
        remaining: null,
        thisVisit: null,
      });
      const retired = withFamily(GEORGI_DATA, 'series-svc-fade', RETIRED);
      expect(
        georgiPage(
          'series-svc-fade',
          OPEN,
          georgiExtra({ rows: rowsOf(GEORGI_BOOK, GEORGI, GEORGI_NEXT_ID) }),
          retired,
        ).progress,
      ).toEqual({
        value: '24',
        unit: null,
        what: 'посещения с фейд',
        remaining: null,
        thisVisit: null,
      });
    });

    it('says nothing is left once a level is due and not yet stamped', () => {
      const due = withProgress(GEORGI_DATA, 'series-svc-fade', {
        ...must(GEORGI_DATA.progress.get('series-svc-fade')),
        value: 25,
      });
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra(), due).progress,
      ).toMatchObject({ value: '25', unit: 'от 25', remaining: null });
    });
  });

  describe('«Как се печели»', () => {
    const how = (id: string, ctx: AchievementsContext = SETTLED) =>
      must(georgiPage(id, ctx).how, `${id} how`);

    it('chooses the sentence by the family’s metric, worded around its subject', () => {
      const sentence = (id: string) => how(id).sentence;
      expect(sentence('series-svc-beard')).toBe(
        'Всяко посещение с оформяне на брада се брои, щом приключи.',
      );
      expect(sentence('series-barber-ivan')).toBe(
        'Всяко посещение при Иван се брои, щом приключи.',
      );
      // By first name, whatever the shop's register holds (review 3, round 2).
      expect(
        how('series-barber-ivan', {
          ...SETTLED,
          catalog: { ...SHOP_CATALOG, barberName: () => 'Иван Колев' },
        }).sentence,
      ).toBe('Всяко посещение при Иван се брои, щом приключи.');
      expect(sentence('series-shop-center')).toBe(
        'Всяко посещение в Център се брои, щом приключи.',
      );
      expect(sentence('series-visits')).toBe(
        'Всяко завършено посещение се брои.',
      );
      expect(sentence('series-early-bird')).toBe(
        'Брои се всяко посещение, започнало до 10:00.',
      );
      expect(sentence('series-explorer')).toBe(
        'Брои се всяка различна услуга.',
      );
      expect(sentence('series-tenure')).toBe(
        'Брои се времето от първото посещение.',
      );
      expect(sentence('series-referrals')).toBe(
        'Брои се всеки приятел, дошъл на първото си посещение по препоръка.',
      );
    });

    it('prints a single act’s own requirement, ended on one full stop', () => {
      expect(how('series-welcome').sentence).toBe('Първо посещение в салона.');
      expect(how('series-profile').sentence).toBe(
        'Имейл, рожден ден и снимка в профила.',
      );
    });

    it('prints the rule in force for the rhythm family, its own words while the rule is not known', () => {
      const rule: RhythmRuleWords = {
        sentence: 'Посещение на всеки 6 седмици пази ритъма.',
        details: ['7 дни гратис след срока.'],
        short: 'На всеки 6 седмици · 7 дни гратис',
        days: (count) => `${count} дни`,
        weeks: (count) => `${count} седмици`,
      };
      const page = georgiPage('series-rhythm', SETTLED, georgiExtra({ rule }));
      expect(page.how).toMatchObject({
        sentence: 'Посещение на всеки 6 седмици пази ритъма.',
        pictures: [],
        excluded: null,
      });
      expect(how('series-rhythm').sentence).toBe('Посещения в ритъм.');
      // The rule words the rhythm only: no other family reads it.
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra({ rule })).how
          ?.sentence,
      ).toBe('Всяко посещение с фейд се брои, щом приключи.');
    });

    it('says the exclusion once, and only where visits are counted', () => {
      const excluded = 'Отменени часове и неявявания не се броят.';
      for (const id of [
        'series-visits',
        'series-svc-fade',
        'series-barber-ivan',
        'series-shop-center',
        'series-early-bird',
        'series-weekend',
        'series-on-time',
        'series-party',
        'series-explorer',
        'series-all-barbers',
        'series-both-shops',
        'series-twelve-months',
      ]) {
        expect([id, how(id).excluded]).toEqual([id, excluded]);
      }
      for (const id of [
        'series-self-service',
        'series-referrals',
        'series-waitlist',
        'series-tenure',
        'series-rhythm',
        'series-welcome',
        'series-birthday',
      ]) {
        expect([id, how(id).excluded]).toEqual([id, null]);
      }
    });

    it('draws the picture of what counts by the family’s subject, and says what it leaves open', () => {
      expect(how('series-svc-fade')).toMatchObject({
        pictures: [
          {
            key: 'svc-fade',
            title: 'Фейд',
            caption: null,
            src: 'https://example.test/covers/fade.jpg',
            more: null,
          },
        ],
        ratio: '16 / 9',
        columns: 1,
        who: 'При всеки бръснар · във всеки салон',
      });
      // The barber is the cover of his own family, never a face beside it.
      expect(how('series-barber-ivan')).toMatchObject({
        pictures: [
          {
            key: 'ivan',
            title: 'Иван',
            caption: null,
            src: 'https://example.test/barbers/ivan.jpg',
            more: null,
          },
        ],
        ratio: '4 / 3',
        columns: 1,
        faces: [],
        who: 'Всяка услуга · във всеки салон',
      });
      expect(how('series-shop-center')).toMatchObject({
        pictures: [
          {
            key: 'loc-center',
            title: 'Център',
            caption: null,
            src: 'https://example.test/shops/center.jpg',
            more: null,
          },
        ],
        ratio: '16 / 9',
        columns: 1,
        who: 'При всеки бръснар · всяка услуга',
      });
      expect(how('series-visits')).toMatchObject({
        pictures: [],
        ratio: '16 / 9',
        columns: 1,
        who: 'При всеки бръснар · във всеки салон',
      });
    });

    it('keeps a subject without art as a cover without a picture, and leaves out one the shop no longer names', () => {
      expect(how('series-svc-classic-cut').pictures).toEqual([
        {
          key: 'svc-classic-cut',
          title: 'Класическа подстрижка',
          caption: null,
          src: null,
          more: null,
        },
      ]);
      const unnamed: AchievementsContext = {
        ...SETTLED,
        catalog: { ...SHOP_CATALOG, serviceName: () => null },
      };
      expect(how('series-svc-fade', unnamed)).toMatchObject({
        sentence: 'Посещения с фейд.',
        pictures: [],
        columns: 1,
      });
    });

    it('draws the barbers the loyalty catalogue names, each once, while the host lists none', () => {
      expect(how('series-visits').faces).toEqual([
        { name: 'Иван', src: 'https://example.test/barbers/ivan.jpg' },
        { name: 'Нико', src: 'https://example.test/barbers/niko.jpg' },
        { name: 'Стефан', src: null },
      ]);
      // A barber the shop no longer names has no face.
      const left: AchievementsContext = {
        ...SETTLED,
        catalog: {
          ...SHOP_CATALOG,
          barberName: (id) =>
            id === 'niko' ? null : SHOP_CATALOG.barberName(id),
        },
      };
      expect(how('series-visits', left).faces.map((face) => face.name)).toEqual(
        ['Иван', 'Стефан'],
      );
    });

    it('reads the price and the shop’s own barbers where the host’s catalogue answers them', () => {
      const ctx: AchievementsContext = {
        ...SETTLED,
        catalog: Object.assign(
          {
            servicePrice: (id: string) =>
              id === 'svc-fade' ? '28,00 €' : null,
            barberIds: () => ['stefan', 'ivan', 'gone', 'stefan'],
          },
          SHOP_CATALOG,
        ),
      };
      expect(how('series-svc-fade', ctx)).toMatchObject({
        pictures: [{ key: 'svc-fade', title: 'Фейд', caption: '28,00 €' }],
        faces: [
          { name: 'Стефан', src: null },
          { name: 'Иван', src: 'https://example.test/barbers/ivan.jpg' },
        ],
      });
      expect(how('series-svc-beard', ctx).pictures[0]?.caption).toBeNull();
      // A barber's and a shop's cover carry no price.
      expect(how('series-barber-ivan', ctx).pictures[0]?.caption).toBeNull();
    });

    it('is absent for a family that is no longer awarded, and holds no steps in this round', () => {
      const retired = withFamily(GEORGI_DATA, 'series-svc-fade', RETIRED);
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra(), retired).how,
      ).toBeNull();
      for (const series of GEORGI_DATA.catalog.families) {
        expect(georgiPage(series.id).how?.steps).toEqual([]);
      }
    });
  });

  describe('the ladder', () => {
    it('sets every level as a medal of its own: passed ones full with their numeral and day, the rest silhouettes', () => {
      const page = georgiPage('series-visits');
      expect(
        page.ladder.map((level) => ({
          level: level.level,
          tone: level.tone,
          title: level.title,
          reward: level.reward,
          earnedOn: level.earnedOn,
          state: level.medal.state,
          numeral: level.medal.level,
        })),
      ).toEqual([
        {
          level: 1,
          tone: 'passed',
          title: 'Ниво I · 1\u00a0посещение',
          reward: 'Значка в профила',
          earnedOn: '6.03.2025\u00a0г.',
          state: 'complete',
          numeral: 'I',
        },
        {
          level: 2,
          tone: 'passed',
          title: 'Ниво II · 5\u00a0посещения',
          reward: '20 точки',
          earnedOn: '4.06.2025\u00a0г.',
          state: 'complete',
          numeral: 'II',
        },
        {
          level: 3,
          tone: 'passed',
          title: 'Ниво III · 10\u00a0посещения',
          reward: '50 точки',
          earnedOn: '22.09.2025\u00a0г.',
          state: 'complete',
          numeral: 'III',
        },
        {
          level: 4,
          tone: 'next',
          title: 'Ниво IV · 25\u00a0посещения',
          reward: '100 точки',
          earnedOn: null,
          state: 'notStarted',
          numeral: null,
        },
        {
          level: 5,
          tone: 'later',
          title: 'Ниво V · 50\u00a0посещения',
          reward: '200 точки',
          earnedOn: null,
          state: 'notStarted',
          numeral: null,
        },
      ]);
    });

    it('draws every rung with the family’s own face, bare, and names it as the row is heard', () => {
      const page = georgiPage('series-svc-fade');
      for (const level of page.ladder) {
        expect(level.medal).toEqual({
          seriesId: 'series-svc-fade',
          state: level.tone === 'passed' ? 'complete' : 'notStarted',
          icon: page.medal.icon,
          src: page.medal.src,
          monogram: page.medal.monogram,
          level: level.medal.level,
          title: null,
          caption: null,
          value: null,
          valueText: null,
          isNew: false,
          accessibleName: level.accessibleName,
        });
      }
      expect(page.medal.src).toBe('https://example.test/covers/fade.jpg');
    });

    it('says each row as one sentence, the day in words', () => {
      expect(
        georgiPage('series-visits').ladder.map((level) => level.accessibleName),
      ).toEqual([
        'Ниво I, 1\u00a0посещение, Значка в профила, спечелено на 6 март 2025 г.',
        'Ниво II, 5\u00a0посещения, 20 точки, спечелено на 4 юни 2025 г.',
        'Ниво III, 10\u00a0посещения, 50 точки, спечелено на 22 септември 2025 г.',
        'Ниво IV, 25\u00a0посещения, 100 точки',
        'Ниво V, 50\u00a0посещения, 200 точки',
      ]);
    });

    it('says a threshold in the fewest words where visits are counted, and as the catalogue words it elsewhere', () => {
      const titles = (id: string) =>
        georgiPage(id).ladder.map((level) => level.title);
      expect(titles('series-svc-fade')).toEqual([
        'Ниво I · 3\u00a0посещения',
        'Ниво II · 10\u00a0посещения',
        'Ниво III · 25\u00a0посещения',
        'Ниво IV · 50\u00a0посещения',
        'Ниво V · 100\u00a0посещения',
      ]);
      expect(titles('series-rhythm')[0]).toBe('Ниво I · 3\u00a0посещения');
      expect(titles('series-early-bird')[1]).toBe('Ниво II · 5\u00a0посещения');
      expect(titles('series-tenure').slice(0, 2)).toEqual([
        'Ниво I · 1 година с нас',
        'Ниво II · 2 години с нас',
      ]);
      expect(titles('series-explorer')[0]).toBe('Ниво I · 2 различни услуги');
      expect(titles('series-self-service')[0]).toBe(
        'Ниво I · 1 час, записан онлайн',
      );
    });

    it('words what a level gives: points, the rhythm’s protections, the badge itself', () => {
      const rewards = (id: string) =>
        georgiPage(id).ladder.map((level) => level.reward);
      expect(rewards('series-rhythm')).toEqual([
        'Значка в профила',
        'Автоматични защити: 1',
        'Значка в профила',
        'Значка в профила',
        'Значка в профила',
      ]);
      expect(rewards('series-tenure')).toEqual([
        '50 точки',
        '50 точки',
        '50 точки',
        '50 точки',
        '50 точки',
      ]);
    });

    it('names a coupon by its title, and sets several gifts of one level side by side', () => {
      const fade = family(GEORGI_DATA, 'series-svc-fade');
      const title = must(
        family(GEORGI_DATA, 'series-svc-beard').title,
        'a localized text',
      );
      const gifted = withFamily(GEORGI_DATA, 'series-svc-fade', {
        levels: fade.levels.map((level) =>
          level.level === 4
            ? {
                ...level,
                awards: [
                  { awardKind: AwardKind.Points, awardPoints: 1 },
                  { awardKind: AwardKind.Coupon, awardCouponTitle: title },
                  {
                    awardKind: AwardKind.Perk,
                    awardPerkId: PerkId.PriorityWaitlist,
                    awardPerkForDays: null,
                  },
                ],
              }
            : level,
        ),
      });
      const page = georgiPage(
        'series-svc-fade',
        SETTLED,
        georgiExtra(),
        gifted,
      );
      expect(page.ladder[3]).toMatchObject({
        reward: '1 точка · Оформяне на брада',
        accessibleName:
          'Ниво IV, 50\u00a0посещения, 1 точка · Оформяне на брада',
      });
    });

    it('marks the first level next on a family not started, every rung a silhouette', () => {
      const page = georgiPage('series-svc-classic-cut');
      expect(page.ladder.map((level) => level.tone)).toEqual([
        'next',
        'later',
        'later',
        'later',
        'later',
      ]);
      expect(
        page.ladder.every(
          (level) =>
            level.medal.state === 'notStarted' &&
            level.medal.level === null &&
            level.earnedOn === null &&
            level.medal.monogram === 'К',
        ),
      ).toBe(true);
    });

    it('marks nothing next on a ladder climbed to its top', () => {
      expect(
        georgiPage('series-rhythm').ladder.map((level) => level.tone),
      ).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
    });

    it('sets a single act as one «Награда» row, its medal without a numeral', () => {
      expect(georgiPage('series-welcome').ladder).toEqual([
        {
          level: 1,
          medal: {
            seriesId: 'series-welcome',
            state: 'complete',
            icon: 'loyalty.badge.welcome',
            src: null,
            monogram: null,
            level: null,
            title: null,
            caption: null,
            value: null,
            valueText: null,
            isNew: false,
            accessibleName:
              'Ниво I, Първо посещение в салона, 20 точки, спечелено на 6 март 2025 г.',
          },
          title: 'Награда',
          reward: '20 точки',
          earnedOn: '6.03.2025\u00a0г.',
          tone: 'passed',
          accessibleName:
            'Ниво I, Първо посещение в салона, 20 точки, спечелено на 6 март 2025 г.',
        },
      ]);
      expect(martinPage('series-birthday').ladder).toMatchObject([
        {
          title: 'Награда',
          reward: 'Значка в профила',
          earnedOn: null,
          tone: 'next',
          medal: { state: 'notStarted', level: null },
        },
      ]);
    });

    it('keeps an ended season’s ladder to the levels it reached', () => {
      const page = georgiPage('series-2026-summer-track');
      expect(page.ladder.map((level) => [level.level, level.tone])).toEqual([
        [1, 'passed'],
        [2, 'passed'],
        [3, 'passed'],
      ]);
    });

    it('marks nothing next on a family that is no longer awarded', () => {
      const retired = withFamily(GEORGI_DATA, 'series-svc-fade', RETIRED);
      expect(
        georgiPage(
          'series-svc-fade',
          SETTLED,
          georgiExtra(),
          retired,
        ).ladder.map((level) => level.tone),
      ).toEqual(['passed', 'passed', 'later', 'later', 'later']);
    });

    it('satisfies the contract’s own rules', () => {
      for (const series of GEORGI_DATA.catalog.families) {
        const page = georgiPage(series.id, OPEN);
        const levels = page.ladder.map((level) => level.level);
        expect(levels).toEqual([...levels].sort((a, b) => a - b));
        for (const level of page.ladder) {
          expect(level.medal.state).toBe(
            level.tone === 'passed' ? 'complete' : 'notStarted',
          );
          expect(level.earnedOn === null).toBe(level.tone !== 'passed');
          expect(level.reward).not.toBe('');
        }
        expect(
          page.ladder.filter((level) => level.tone === 'next').length,
        ).toBeLessThanOrEqual(1);
        expect(page.visits.length).toBeLessThanOrEqual(5);
        expect(page.related?.tiles.length ?? 0).toBeLessThanOrEqual(3);
        expect(page.medal.title).toBeNull();
        expect(page.medal.caption).toBeNull();
        expect(joined(page.stateLine)).not.toBe('');
      }
    });
  });

  describe('the visits that counted', () => {
    const ids = (page: MedalDetailVm) => page.visits.map((row) => row.id);

    it('lists the newest five, as the shared staff rows', () => {
      const page = georgiPage('series-svc-fade');
      expect(ids(page)).toEqual([
        'appt-dev-1',
        'appt-hist-c1-23',
        'appt-hist-c1-22',
        'appt-hist-c1-21',
        'appt-hist-c1-20',
      ]);
      expect(page.visits[0]).toMatchObject({
        title: 'Фейд',
        outcome: 'worked',
        trailingFact: { kind: 'badge', text: 'Този час' },
        testId: 'history-row-appt-dev-1',
      });
      expect(page.visits[3]).toMatchObject({
        title: 'Фейд · Оформяне на брада',
        trailing: { kind: 'barber', name: 'Иван' },
        trailingFact: { kind: 'amount' },
      });
    });

    it('files them as «Посещения» does: the weekday over the day on the tile', () => {
      expect(
        georgiPage('series-svc-fade').visits.map((row) => [
          row.tile?.caption,
          row.tile?.day,
        ]),
      ).toEqual([
        ['пн', 28],
        ['чт', 3],
        ['чт', 6],
        ['пн', 13],
        ['пн', 15],
      ]);
    });

    it('lists only the visits that counted', () => {
      // Six beards among the twenty-four fades.
      const beards = georgiPage('series-svc-beard').visits;
      expect(beards).toHaveLength(5);
      expect(
        beards.every((row) => row.title === 'Фейд · Оформяне на брада'),
      ).toBe(true);
      // His two Saturdays.
      expect(ids(georgiPage('series-weekend'))).toEqual([
        'appt-hist-c1-15',
        'appt-hist-c1-02',
      ]);
      expect(georgiPage('series-svc-classic-cut').visits).toEqual([]);
    });

    it('leads with the open visit on screen while its draft holds what counts', () => {
      const page = georgiPage(
        'series-svc-fade',
        OPEN,
        georgiExtra({ rows: rowsOf(GEORGI_BOOK, GEORGI, GEORGI_NEXT_ID) }),
      );
      expect(ids(page)).toEqual([
        GEORGI_NEXT_ID,
        'appt-dev-1',
        'appt-hist-c1-23',
        'appt-hist-c1-22',
        'appt-hist-c1-21',
      ]);
      expect(page.visits[0]).toMatchObject({
        outcome: 'open',
        trailingFact: { kind: 'badge', text: 'Този час' },
      });
      expect(page.progress.thisVisit).not.toBeNull();
      // Мартин's cut in the chair counts towards «Класическа подстрижка», not «Фейд».
      expect(ids(martinPage('series-svc-classic-cut'))[0]).toBe(
        MARTIN_TODAY_ID,
      );
      expect(martinPage('series-svc-fade').visits).toEqual([]);
    });

    it('never lists an hour still to come that is not the visit on screen', () => {
      // His next fade is on the book; the card is open on today's settled one.
      expect(ids(georgiPage('series-svc-fade'))).not.toContain(GEORGI_NEXT_ID);
      expect(ids(georgiPage('series-visits'))).not.toContain(GEORGI_NEXT_ID);
    });

    it('keeps a season’s family to the season’s own window', () => {
      // Summer 2026: June to August.
      expect(ids(georgiPage('series-2026-summer-track'))).toEqual([
        'appt-hist-c1-22',
        'appt-hist-c1-21',
        'appt-hist-c1-20',
      ]);
      // Autumn 2026, from 1 September: two early visits.
      expect(ids(georgiPage('series-2026-autumn-early'))).toEqual([
        'appt-dev-1',
        'appt-hist-c1-23',
      ]);
    });

    it('keeps a metric with a window of its own to it', () => {
      const windowed = withFamily(GEORGI_DATA, 'series-visits', {
        metricWindowDays: 30,
      });
      // 28 September back to 30 August: today's and the one on 3 September.
      expect(
        ids(georgiPage('series-visits', SETTLED, georgiExtra(), windowed)),
      ).toEqual(['appt-dev-1', 'appt-hist-c1-23']);
    });

    it('lists each visit once, whatever order and however often the pages hand it over', () => {
      const shuffled = [...GEORGI_BOOK].reverse().concat(GEORGI_BOOK);
      expect(
        ids(
          georgiPage(
            'series-svc-fade',
            SETTLED,
            georgiExtra({ visits: shuffled }),
          ),
        ),
      ).toEqual([
        'appt-dev-1',
        'appt-hist-c1-23',
        'appt-hist-c1-22',
        'appt-hist-c1-21',
        'appt-hist-c1-20',
      ]);
    });

    it('is empty until the history is read, and for a family that counts no single visit', () => {
      expect(
        georgiPage(
          'series-svc-fade',
          SETTLED,
          georgiExtra({ visits: [], rows: rowsOf([], GEORGI, 'appt-dev-1') }),
        ).visits,
      ).toEqual([]);
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra({ rows: null }))
          .visits,
      ).toEqual([]);
      for (const id of ['series-rhythm', 'series-welcome', 'series-explorer']) {
        expect([id, georgiPage(id, OPEN).visits]).toEqual([id, []]);
      }
    });
  });

  describe('the neighbours', () => {
    it('shows the first three of the family’s shelf, each drawn as its grid draws it', () => {
      const related = must(georgiPage('series-svc-fade').related, 'related');
      expect(related.title).toBe('Още от Майсторство');
      expect(related.icon).toBe('loyalty.category.mastery');
      expect(related.tiles.map((tile) => tile.key)).toEqual([
        'series-svc-beard',
        'series-explorer',
        'series-svc-classic-cut',
      ]);
      for (const tile of related.tiles) {
        expect(tile.opens).toBeNull();
        expect(tile.medal).toEqual(
          medalRingVm(
            family(GEORGI_DATA, tile.key),
            GEORGI_DATA,
            SETTLED,
            'large',
          ),
        );
      }
    });

    it('shows a season’s family its season’s others, and nothing where the family stands alone', () => {
      expect(georgiPage('series-2026-autumn-early').related?.title).toBe(
        'Още от Есен 2026',
      );
      const alone = withFamily(GEORGI_DATA, 'series-svc-fade', {
        categoryId: null,
      });
      expect(
        georgiPage('series-svc-fade', SETTLED, georgiExtra(), alone).related,
      ).toBeNull();
    });
  });

  describe('the verb', () => {
    const action = {
      serviceId: 'svc-fade',
      label: 'Добави фейд',
      accessibleName: 'Добави Фейд към посещението',
    };

    it('carries what the store answered', () => {
      expect(
        martinPage('series-svc-fade', martinExtra({ action })).action,
      ).toEqual(action);
      expect(martinPage('series-svc-fade').action).toBeNull();
    });

    it('carries none for a family that cannot move: retired, complete, its season ended', () => {
      const retired = withFamily(MARTIN_DATA, 'series-svc-fade', RETIRED);
      expect(
        martinPage('series-svc-fade', martinExtra({ action }), retired).action,
      ).toBeNull();
      expect(
        georgiPage('series-rhythm', OPEN, georgiExtra({ action })).action,
      ).toBeNull();
      expect(
        georgiPage('series-2026-summer-track', OPEN, georgiExtra({ action }))
          .action,
      ).toBeNull();
    });
  });
});
