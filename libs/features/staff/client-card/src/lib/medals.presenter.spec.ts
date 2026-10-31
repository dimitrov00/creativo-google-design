import { describe, expect, it } from 'vitest';
import {
  type EarnedLevel,
  EarnedVia,
  HeadRole,
  type PersonalRecord,
  PersonalRecordKind,
} from '@core/components';
import type { BadgeProgress } from '@core/entities';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  SeasonId,
  ServiceId,
  UtcEpochMs,
} from '@core/primitives';
import {
  BadgeSystem,
  LoyaltyCatalogSystem,
  RecordsSystem,
} from '@core/systems';
import { localDate } from '@core/testing';
import { isUiIconName } from '@creativo/ui/controls';
import { RECORD_KIND_WORDS, type RecordKindWord } from './client-card.words';
import { PENDING_RING, medalVm } from './achievements.presenter';
import type { AchievementsData, MedalVm } from './client-pages.vm';
import {
  CHIP_ALL,
  CHIP_SEASONS,
  CLOSE_LIMIT,
  RECORD_ICONS,
  SECTION_FOLD_OVER,
  medalRingVm,
  medalScopeVm,
  medalsPageVm,
  recordCardVm,
  recordsOf,
  rhythmLiveOf,
  sectionTilesShown,
} from './medals.presenter';
import {
  GEORGI_PREVIOUS_MS,
  MARTIN_PREVIOUS_MS,
  achievementsContextOf,
  achievementsDataOf,
  sofia,
  georgiContext,
  georgiOpenContext,
  loyaltyCatalogWith,
  martinContext,
  must,
  wordsOf,
} from '../testing/client-card.fixtures';
import { AchievementScope } from './client-card.contracts';

const GEORGI = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const MARTIN = achievementsDataOf('martin', MARTIN_PREVIOUS_MS);
/** Георги's card on today's settled fade: nothing a visit can still move. */
const SETTLED = achievementsContextOf(georgiContext(), 'Георги Петров');
/** Георги's card on his next fade, still open. */
const OPEN = achievementsContextOf(georgiOpenContext(), 'Георги Петров');
/** Мартин in the chair on his birthday. */
const BIRTHDAY = achievementsContextOf(martinContext(), 'Мартин Илиев', true);
/** Георги's card in English. */
const ENGLISH = achievementsContextOf(
  georgiContext(),
  'Georgi Petrov',
  false,
  wordsOf('en'),
);

function series(data: AchievementsData, id: string) {
  return must(
    LoyaltyCatalogSystem.series(data.catalog, BadgeSeriesId.of(id)),
    id,
  );
}

/** A level earned at a Sofia wall-clock time, filed under that shop day (T5). */
function earnedLevel(level: number, sofiaIso: string): EarnedLevel {
  const at_ = UtcEpochMs.of(sofia(sofiaIso));
  if (!at_.ok) throw new Error(`bad fixture instant ${sofiaIso}`);
  return {
    level,
    earnedAtUtcMs: at_.value,
    earnedLocalDate: localDate(sofiaIso.slice(0, 10)),
    earnedVia: EarnedVia.Rule,
    count: 1,
  };
}

/** A record's kind as the card words it. */
const kindOf = (record: PersonalRecord): RecordKindWord =>
  RECORD_KIND_WORDS[record.personalRecordKind];

function ring(
  data: AchievementsData,
  id: string,
  ctx = SETTLED,
  size: 'regular' | 'large' | 'extraLarge' = 'large',
): MedalVm {
  return medalRingVm(series(data, id), data, ctx, size);
}

/** Георги's book with one family's progress replaced. */
function withProgress(
  seriesId: string,
  value: number,
  earned: readonly (readonly [level: number, on: string])[],
): AchievementsData {
  const progress: BadgeProgress = {
    id: BadgeSeriesId.of(seriesId),
    value,
    earned: earned.map(([level, on]) => earnedLevel(level, `${on}T11:00:00`)),
  };
  return {
    ...GEORGI,
    progress: new Map([...GEORGI.progress, [progress.id, progress]]),
  };
}

/** Георги's book under a catalogue whose rhythm rule is switched off. */
function rhythmOff(data: AchievementsData = GEORGI): AchievementsData {
  return {
    ...data,
    catalog: loyaltyCatalogWith((catalog) => ({
      ...catalog,
      streaks: catalog.streaks.map((head) => ({
        ...head,
        rules: head.rules.map((rule) =>
          rule.headRole === HeadRole.Current
            ? { ...rule, enabled: false }
            : rule,
        ),
      })),
    })),
  };
}

/** Георги's book with `extra` more families on a shelf, none started. */
function withMoreFamilies(
  categoryId: string,
  from: string,
  extra: number,
): AchievementsData {
  return {
    ...GEORGI,
    catalog: loyaltyCatalogWith((catalog) => {
      const template = must(
        catalog.series.find((family) => family.id === from),
        from,
      );
      return {
        ...catalog,
        series: [
          ...catalog.series,
          ...Array.from({ length: extra }, (_, index) => ({
            ...template,
            id: BadgeSeriesId.of(`${from}-extra-${index + 1}`),
            categoryId: BadgeCategoryId.of(categoryId),
            title: {
              bg: `Предизвикателство ${index + 1}`,
              en: `Challenge ${index + 1}`,
            },
            levels: template.levels.map((level) => ({
              ...level,
              ruleId: AchievementRuleId.of(
                `${level.ruleId}-extra-${index + 1}`,
              ),
            })),
            order: 900 + index,
          })),
        ],
      };
    }),
  };
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
    GEORGI.account.records.find((r) => kindOf(r) === kind),
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

function withRecords(records: readonly PersonalRecord[]): AchievementsData {
  return { ...GEORGI, account: { ...GEORGI.account, records } };
}

describe('medalRingVm', () => {
  it('draws an earned family on its way: the rim numeral, the arc from the level won, the target in words', () => {
    expect(ring(GEORGI, 'series-svc-fade')).toEqual({
      seriesId: 'series-svc-fade',
      familyId: 'series-svc-fade',
      state: 'earned',
      icon: 'loyalty.badge.service',
      src: 'https://example.test/covers/fade.jpg',
      monogram: null,
      level: 'II',
      title: 'Фейд',
      caption: '24/25 до III',
      value: 14 / 15,
      valueText: '24 от 25 до ниво III',
      isNew: false,
      accessibleName:
        'Фейд, ниво II, спечелено на 22 септември 2025 г., 24 от 25 до ниво III',
    });
  });

  it('is the built medal in everything but the ring: the face, the words, the sentence', () => {
    for (const family of GEORGI.catalog.families) {
      const built = medalVm(family, GEORGI, SETTLED);
      const drawn = medalRingVm(family, GEORGI, SETTLED, 'large');
      expect([family.id, drawn.seriesId, drawn.icon, drawn.src]).toEqual([
        family.id,
        built.seriesId,
        built.icon,
        built.src,
      ]);
      expect(drawn.monogram).toBe(built.monogram);
      expect(drawn.title).toBe(built.title);
      expect(drawn.caption).toBe(built.caption);
      expect(drawn.isNew).toBe(false);
      // The state is the built one, or the fourth.
      expect([built.state, 'complete']).toContain(drawn.state);
    }
  });

  it('draws the way to a first level as a partial arc, the rim empty', () => {
    const medal = ring(GEORGI, 'series-weekend');
    expect(medal).toMatchObject({
      state: 'inProgress',
      level: null,
      title: 'Съботен',
      caption: '2/3 до I',
      valueText: '2 от 3 до ниво I',
      accessibleName: 'Съботен, 2 от 3 до ниво I',
    });
    expect(medal.value).toBeCloseTo(2 / 3);
  });

  it('draws a family nobody started as its silhouette: no arc, its requirement never hidden', () => {
    expect(ring(GEORGI, 'series-svc-classic-cut')).toMatchObject({
      state: 'notStarted',
      monogram: 'К',
      level: null,
      caption: '0/3 до I',
      value: null,
      valueText: null,
      accessibleName:
        'Класическа подстрижка, още не е започнато: 3 посещения с класическа подстрижка',
    });
  });

  it('draws a ladder climbed to its top complete: a full ring, the top numeral', () => {
    expect(ring(GEORGI, 'series-rhythm')).toMatchObject({
      state: 'complete',
      level: 'V',
      caption: 'Всички нива',
      value: 1,
      valueText: 'Всички нива',
      accessibleName: 'В ритъм, ниво V, спечелено на 28 септември',
    });
  });

  it('draws a single act complete, by its day and with no numeral: there is no ladder for a rim to count', () => {
    expect(ring(GEORGI, 'series-welcome')).toMatchObject({
      state: 'complete',
      level: null,
      title: 'Добре дошъл',
      caption: '6.03.2025 г.',
      value: 1,
      valueText: 'Спечелено на 6.03.2025 г.',
      accessibleName: 'Добре дошъл, спечелено на 6 март 2025 г.',
    });
  });

  it('draws a counted family of ONE level complete as a single act: by its day, no numeral — one level is no ladder for a rim to count (review 3, round 2)', () => {
    expect(ring(GEORGI, 'series-2026-autumn-early')).toMatchObject({
      state: 'complete',
      level: null,
      caption: '28.09',
      value: 1,
      valueText: 'Спечелено на 28.09',
      accessibleName: 'Есенно утро, спечелено на 28 септември',
    });
    // Every family of one level that is complete — «И двата салона» in the
    // live book, the seasons' one-offs here — wears the form of «Добре
    // дошъл»: a full ring, no rim numeral, no «ниво» heard.
    const completeSingles = GEORGI.catalog.families
      .filter((family) => BadgeSystem.isSingleLevel(family))
      .map((family) => medalRingVm(family, GEORGI, SETTLED, 'large'))
      .filter((medal) => medal.state === 'complete');
    expect(completeSingles.length).toBeGreaterThan(1);
    for (const medal of completeSingles) {
      expect([medal.title, medal.level]).toEqual([medal.title, null]);
      expect(medal.accessibleName).not.toContain('ниво');
    }
  });

  it('never numbers a single act, earned or not', () => {
    for (const family of MARTIN.catalog.families) {
      const act =
        family.levels.length === 1 && family.levels[0]?.target === null;
      if (!act) continue;
      for (const ctx of [SETTLED, BIRTHDAY]) {
        expect([
          family.id,
          medalRingVm(family, MARTIN, ctx, 'large').level,
        ]).toEqual([family.id, null]);
      }
    }
  });

  it('draws the level this visit completes all but closed, on the pending face, and still says where it stands (only `complete` closes the ring, review 3 F8)', () => {
    // Earned, the next level one fade away.
    expect(ring(GEORGI, 'series-svc-fade', OPEN)).toMatchObject({
      state: 'earned',
      level: 'II',
      caption: 'с това посещение',
      value: PENDING_RING,
      valueText: 'Ниво\u00a0III с това посещение',
      accessibleName:
        'Фейд, ниво II, спечелено на 22 септември 2025 г., 24 от 25 до ниво III, с това посещение',
    });
    // Not started, a birthday visit: never the dashed silhouette.
    expect(ring(MARTIN, 'series-birthday', BIRTHDAY)).toMatchObject({
      state: 'inProgress',
      level: null,
      caption: 'с това посещение',
      value: PENDING_RING,
    });
  });

  it('draws a yearly act earned again this visit complete, and says the visit', () => {
    const lastYear: AchievementsData = {
      ...MARTIN,
      progress: new Map([
        ...MARTIN.progress,
        [
          BadgeSeriesId.of('series-birthday'),
          {
            id: BadgeSeriesId.of('series-birthday'),
            value: 1,
            earned: [earnedLevel(1, '2025-09-28T12:30:00')],
          },
        ],
      ]),
    };
    expect(ring(lastYear, 'series-birthday', BIRTHDAY)).toMatchObject({
      state: 'complete',
      level: null,
      caption: 'с това посещение',
      value: 1,
      accessibleName:
        'Рожден ден в салона, спечелено на 28 септември 2025 г., с това посещение',
    });
  });

  it('draws no arc towards a level an ended season can no longer reach', () => {
    // «Лято 2026» closed on III of V.
    expect(ring(GEORGI, 'series-2026-summer-track')).toMatchObject({
      state: 'earned',
      level: 'III',
      caption: null,
      value: null,
      valueText: null,
    });
    // Its family of one level was won: complete, by its day, no numeral.
    expect(ring(GEORGI, 'series-2026-summer-each-month')).toMatchObject({
      state: 'complete',
      level: null,
      caption: '6.08',
      value: 1,
    });
  });

  it('keeps the day fraction in a calendar-driven family’s arc, and words the day its level lands', () => {
    // «Години с нас»: I = 365 won, 571 days in, II at 730.
    const medal = ring(GEORGI, 'series-tenure');
    expect(medal).toMatchObject({
      state: 'earned',
      level: 'I',
      caption: 'II\u00a0на 6.03.2027\u00a0г.',
      valueText: 'Ниво\u00a0II на 6.03.2027 г.',
    });
    expect(medal.value).toBeCloseTo((571 - 365) / 365);
  });

  describe('by size', () => {
    it('is the medal alone at extraLarge: the page’s title and state line say the rest', () => {
      expect(
        ring(GEORGI, 'series-svc-fade', SETTLED, 'extraLarge'),
      ).toMatchObject({
        state: 'earned',
        level: 'II',
        title: null,
        caption: null,
        value: 14 / 15,
        accessibleName:
          'Фейд, ниво II, спечелено на 22 септември 2025 г., 24 от 25 до ниво III',
      });
    });

    it('captions a regular tile short: the count without its level', () => {
      expect(
        [
          'series-2026-autumn-each-month',
          'series-2026-autumn-beard',
          'series-2026-autumn-referral',
          'series-svc-fade',
        ].map((id) => ring(GEORGI, id, SETTLED, 'regular').caption),
      ).toEqual(['1/3', '0/2', '0/1', '24/25']);
      // The title stays: a regular tile is named.
      expect(
        ring(GEORGI, 'series-2026-autumn-beard', SETTLED, 'regular').title,
      ).toBe('Есенна брада');
    });

    it('leaves every other caption of a regular tile as it is worded', () => {
      expect(
        [
          ['series-2026-autumn-early', SETTLED],
          ['series-rhythm', SETTLED],
          ['series-2026-beard-week-full', SETTLED],
          ['series-svc-fade', OPEN],
          ['series-tenure', SETTLED],
        ].map(
          ([id, ctx]) =>
            medalRingVm(
              series(GEORGI, id as string),
              GEORGI,
              ctx as typeof SETTLED,
              'regular',
            ).caption,
        ),
      ).toEqual([
        '28.09',
        'Всички нива',
        'Още не е спечелено',
        'с това посещение',
        'II\u00a0на 6.03.2027\u00a0г.',
      ]);
    });

    it('draws one ring at every size: the state, the arc and the rim never depend on it', () => {
      for (const family of GEORGI.catalog.families) {
        const [regular, large, extraLarge] = (
          ['regular', 'large', 'extraLarge'] as const
        ).map((size) => medalRingVm(family, GEORGI, OPEN, size));
        for (const medal of [regular, extraLarge]) {
          expect([family.id, medal?.state, medal?.value, medal?.level]).toEqual(
            [family.id, large?.state, large?.value, large?.level],
          );
          expect(medal?.accessibleName).toBe(large?.accessibleName);
        }
      }
    });
  });

  it('never marks a medal «Ново» on its own: a page marks it where it draws it once', () => {
    // «В ритъм» V was earned today, after the previous visit.
    expect(ring(GEORGI, 'series-rhythm').isNew).toBe(false);
  });

  it('words the ring in English from the English catalogue', () => {
    expect(ring(GEORGI, 'series-weekend', ENGLISH)).toMatchObject({
      title: 'Saturday regular',
      state: 'inProgress',
    });
    expect(
      ring(GEORGI, 'series-2026-autumn-beard', ENGLISH, 'regular').caption,
    ).toBe('0/2');
  });
});

describe('records', () => {
  it('draws every record with a registered glyph of its own', () => {
    for (const icon of Object.values(RECORD_ICONS)) {
      expect(isUiIconName(icon)).toBe(true);
    }
    expect(new Set(Object.values(RECORD_ICONS)).size).toBe(
      RecordsSystem.RECORD_ORDER.length,
    );
    // Every kind of the order has its glyph, under the card's word for it.
    expect(
      RecordsSystem.RECORD_ORDER.map((kind) => RECORD_KIND_WORDS[kind]).sort(),
    ).toEqual(Object.keys(RECORD_ICONS).sort());
  });

  it('words the longest run: the count, the month it was set, new while it is', () => {
    expect(recordCardVm(record('longestRhythm'), GEORGI, SETTLED)).toEqual({
      id: 'longestRhythm',
      personalRecordKind: PersonalRecordKind.LongestRhythm,
      label: 'Най-дълъг ритъм',
      value: '24',
      detail: 'септември 2026 г.',
      icon: 'loyalty.record.longestRhythm',
      src: null,
      isNew: true,
      accessibleName:
        'Най-дълъг ритъм: 24 посещения, септември 2026 г., нов рекорд',
    });
  });

  it('words the best year: the count, the year', () => {
    expect(recordCardVm(record('mostVisitsInYear'), GEORGI, SETTLED)).toEqual({
      id: 'mostVisitsInYear',
      personalRecordKind: PersonalRecordKind.MostVisitsInYear,
      label: 'Най-много за година',
      value: '13',
      detail: '2025 г.',
      icon: 'loyalty.record.mostVisitsInYear',
      src: null,
      isNew: false,
      accessibleName: 'Най-много за година: 13 посещения, 2025 г.',
    });
  });

  it('makes the SERVICE the hero of a favourite: its name the figure, its cover the emblem, the count the detail', () => {
    expect(recordCardVm(record('favouriteService'), GEORGI, SETTLED)).toEqual({
      id: 'favouriteService',
      personalRecordKind: PersonalRecordKind.FavouriteService,
      label: 'Любима услуга',
      value: 'Фейд',
      detail: '24 пъти',
      icon: 'loyalty.record.favouriteService',
      src: 'https://example.test/covers/fade.jpg',
      isNew: false,
      accessibleName: 'Любима услуга: Фейд, 24 пъти',
    });
    // A service without a cover draws the glyph.
    expect(
      recordCardVm(
        record('favouriteService', { serviceId: 'svc-classic-cut', value: 1 }),
        GEORGI,
        SETTLED,
      ),
    ).toMatchObject({
      value: 'Класическа подстрижка',
      detail: '1 път',
      src: null,
      accessibleName: 'Любима услуга: Класическа подстрижка, 1 път',
    });
  });

  it('words the first visit as its day over its year, whatever the year', () => {
    expect(recordCardVm(record('firstVisit'), GEORGI, SETTLED)).toEqual({
      id: 'firstVisit',
      personalRecordKind: PersonalRecordKind.FirstVisit,
      label: 'Първо посещение',
      value: '6 март',
      detail: '2025 г.',
      icon: 'loyalty.record.firstVisit',
      src: null,
      isNew: false,
      accessibleName: 'Първо посещение: 6 март, 2025 г.',
    });
    expect(
      recordCardVm(record('firstVisit', { on: '2026-09-02' }), GEORGI, SETTLED),
    ).toMatchObject({ value: '2 септември', detail: '2026 г.', isNew: false });
  });

  it('agrees the count of one', () => {
    expect(
      recordCardVm(
        record('longestRhythm', { value: 1, on: '2025-03-06' }),
        GEORGI,
        SETTLED,
      ),
    ).toMatchObject({
      value: '1',
      detail: 'март 2025 г.',
      isNew: false,
      accessibleName: 'Най-дълъг ритъм: 1 посещение, март 2025 г.',
    });
  });

  it('draws no card for a record that holds nothing to print', () => {
    for (const empty of [
      record('longestRhythm', { value: 0 }),
      record('mostVisitsInYear', { value: 0 }),
      record('mostVisitsInYear', { year: null }),
      record('favouriteService', { serviceId: null }),
      record('favouriteService', { serviceId: 'svc-gone' }),
      record('favouriteService', { value: 0 }),
      record('firstVisit', { on: null }),
    ]) {
      expect(recordCardVm(empty, GEORGI, SETTLED)).toBeNull();
    }
    // A run whose day the account never stamped still has its count.
    expect(
      recordCardVm(record('longestRhythm', { on: null }), GEORGI, SETTLED),
    ).toMatchObject({
      value: '24',
      detail: null,
      isNew: false,
      accessibleName: 'Най-дълъг ритъм: 24 посещения',
    });
  });

  it('words a record in English', () => {
    expect(
      recordCardVm(record('longestRhythm'), GEORGI, ENGLISH),
    ).toMatchObject({
      label: 'Longest rhythm',
      value: '24',
      detail: 'September 2026',
    });
    expect(
      recordCardVm(record('favouriteService'), GEORGI, ENGLISH),
    ).toMatchObject({
      label: 'Favourite service',
      detail: '24 times',
    });
  });

  describe('recordsOf', () => {
    it('keeps the cards’ order whatever the account’s', () => {
      const shuffled = withRecords([...GEORGI.account.records].reverse());
      expect(recordsOf(shuffled, true).map(kindOf)).toEqual([
        'longestRhythm',
        'mostVisitsInYear',
        'favouriteService',
        'firstVisit',
      ]);
    });

    it('leaves the longest run out while the shop runs no rhythm', () => {
      expect(recordsOf(GEORGI, false).map(kindOf)).toEqual([
        'mostVisitsInYear',
        'favouriteService',
        'firstVisit',
      ]);
    });

    it('holds only what the account holds', () => {
      expect(
        recordsOf(withRecords([record('firstVisit')]), true).map(kindOf),
      ).toEqual(['firstVisit']);
      expect(recordsOf(withRecords([]), true)).toEqual([]);
    });
  });
});

describe('rhythmLiveOf', () => {
  it('is the catalogue’s rule in force, switched on', () => {
    expect(rhythmLiveOf(GEORGI)).toBe(true);
    expect(rhythmLiveOf(rhythmOff())).toBe(false);
  });

  it('is off in a shop without a rhythm', () => {
    const none: AchievementsData = {
      ...GEORGI,
      catalog: loyaltyCatalogWith((catalog) => ({
        ...catalog,
        streaks: [],
      })),
    };
    expect(rhythmLiveOf(none)).toBe(false);
  });
});

describe('medalsPageVm', () => {
  const page = medalsPageVm(GEORGI, SETTLED, CHIP_ALL);

  describe('the records (AE)', () => {
    it('leads the page with the account’s four, in the cards’ order', () => {
      expect(
        page.records.map((r) => [r.id, r.value, r.detail, r.isNew]),
      ).toEqual([
        ['longestRhythm', '24', 'септември 2026 г.', true],
        ['mostVisitsInYear', '13', '2025 г.', false],
        ['favouriteService', 'Фейд', '24 пъти', false],
        ['firstVisit', '6 март', '2025 г.', false],
      ]);
    });

    it('shows what the book already knows, and nothing where it knows nothing', () => {
      expect(
        medalsPageVm(
          withRecords([record('firstVisit')]),
          SETTLED,
          CHIP_ALL,
        ).records.map((r) => r.id),
      ).toEqual(['firstVisit']);
      expect(medalsPageVm(withRecords([]), SETTLED, CHIP_ALL).records).toEqual(
        [],
      );
    });

    it('stays the same under every chip', () => {
      for (const chip of page.chips) {
        expect(medalsPageVm(GEORGI, SETTLED, chip.id).records).toEqual(
          page.records,
        );
      }
    });
  });

  describe('the chips (AC)', () => {
    it('lists «Всички», the categories in their order, and «Сезони»', () => {
      expect(page.chips.map((c) => [c.id, c.label])).toEqual([
        ['all', 'Всички'],
        ['cat-milestones', 'Етапи'],
        ['cat-mastery', 'Майсторство'],
        ['cat-barbers', 'Бръснари'],
        ['cat-rhythm', 'Ритъм'],
        ['cat-special', 'Специални'],
        ['seasons', 'Сезони'],
      ]);
      expect(CHIP_ALL).toBe('all');
      expect(CHIP_SEASONS).toBe('seasons');
    });

    it('prints no count on a chip and says it in its name, the shelf’s whole title heard', () => {
      for (const chip of page.chips) {
        expect(chip.label).not.toMatch(/\d/u);
      }
      expect(page.chips.map((c) => c.accessibleName)).toEqual([
        'Всички, 15 от 38 спечелени',
        'Етапи, 3 от 5 спечелени',
        'Майсторство, 3 от 9 спечелени',
        'Бръснари и салони, 2 от 7 спечелени',
        'Ритъм, 2 от 3 спечелени',
        'Специални, 3 от 7 спечелени',
        'Сезони, 2 от 7 спечелени',
      ]);
    });

    it('has no chip for the records’ shelf: the records are cards', () => {
      expect(page.chips.map((c) => c.id)).not.toContain('cat-records');
      expect(page.sections.map((s) => s.categoryId)).not.toContain(
        'cat-records',
      );
    });

    it('has no «Сезони» where no season runs, none is announced and none was taken part in', () => {
      const none: AchievementsData = {
        ...GEORGI,
        catalog: loyaltyCatalogWith((catalog) => ({
          ...catalog,
          seasons: [],
          series: catalog.series.filter((family) => family.seasonId === null),
        })),
      };
      const vm = medalsPageVm(none, SETTLED, CHIP_ALL);
      expect(vm.chips.map((c) => c.id)).not.toContain('seasons');
      expect(vm.season).toBeNull();
      expect(vm.events).toEqual([]);
      expect(vm.archive).toBeNull();
      // The collection is the shelves' alone.
      expect(vm.collection.line).toBe('от 31 медала');
      // A chip that is gone is the overview.
      expect(medalsPageVm(none, SETTLED, CHIP_SEASONS)).toEqual(vm);
    });

    it('is the same band under every chip', () => {
      for (const chip of page.chips) {
        expect(medalsPageVm(GEORGI, SETTLED, chip.id).chips).toEqual(
          page.chips,
        );
      }
    });
  });

  describe('«Почти спечелени» (AF)', () => {
    it('is one row of three, the nearest of each shelf, in rings', () => {
      expect(CLOSE_LIMIT).toBe(3);
      expect(page.close.map((t) => [t.key, t.medal.caption, t.opens])).toEqual([
        ['series-svc-fade', '24/25 до III', null],
        ['series-self-service', '7/10 до III', null],
        ['series-weekend', '2/3 до I', null],
      ]);
      expect(page.close[0]?.medal.value).toBeCloseTo(14 / 15);
    });

    it('never offers one shelf twice, nor the clones one visit completes', () => {
      const shelves = page.close.map((t) => series(GEORGI, t.key).categoryId);
      expect(new Set(shelves).size).toBe(shelves.length);
    });

    it('leaves the running season’s track to its own card under the row', () => {
      // The track is the nearest of all: one visit from III.
      const near = withProgress('series-2026-autumn-track', 2, [
        [1, '2026-09-03'],
        [2, '2026-09-28'],
      ]);
      const vm = medalsPageVm(near, OPEN, CHIP_ALL);
      expect(vm.season?.medal.seriesId).toBe('series-2026-autumn-track');
      expect(vm.close.map((t) => t.key)).not.toContain(
        'series-2026-autumn-track',
      );
    });

    it('leads with what this visit completes', () => {
      expect(
        medalsPageVm(GEORGI, OPEN, CHIP_ALL).close.map((t) => [
          t.key,
          t.medal.caption,
          t.medal.value,
        ])[0],
      ).toEqual(['series-svc-fade', 'с това посещение', PENDING_RING]);
      // A single act the domain never ranks: a birthday visit.
      expect(
        medalsPageVm(MARTIN, BIRTHDAY, CHIP_ALL).close.map((t) => [
          t.key,
          t.medal.state,
          t.medal.caption,
        ]),
      ).toEqual([
        ['series-birthday', 'inProgress', 'с това посещение'],
        ['series-twelve-months', 'earned', '9/12 до III'],
        ['series-barber-ivan', 'earned', '7/10 до III'],
      ]);
    });

    it('puts a level this visit completes before a nearer one it does not move', () => {
      // «Онлайн записване» at 9 of 10 outranks nothing the visit completes.
      const near = withProgress('series-self-service', 9, [
        [1, '2025-03-25'],
        [2, '2026-02-22'],
      ]);
      // …and «Фейд» further off than it, still one fade from III.
      const vm = medalsPageVm(near, OPEN, CHIP_ALL);
      expect(vm.close.map((t) => t.key).slice(0, 2)).toEqual([
        'series-svc-fade',
        'series-self-service',
      ]);
    });

    it('marks none of them «Ново»: a medal still to come is not new', () => {
      for (const data of [GEORGI, MARTIN]) {
        for (const tile of medalsPageVm(data, SETTLED, CHIP_ALL).close) {
          expect(tile.medal.isNew).toBe(false);
        }
      }
    });

    it('is absent when nothing is under way: a family nobody began is not «almost» anything', () => {
      const fresh: AchievementsData = { ...GEORGI, progress: new Map() };
      expect(medalsPageVm(fresh, SETTLED, CHIP_ALL).close).toEqual([]);
      // …but what the visit on screen completes is, begun or not: a first
      // fade with Иван at 10:00 lands three first levels, one per shelf.
      expect(
        medalsPageVm(fresh, OPEN, CHIP_ALL).close.map((t) => [
          t.key,
          t.medal.state,
          t.medal.caption,
          t.medal.value,
        ]),
      ).toEqual([
        ['series-visits', 'inProgress', 'с това посещение', PENDING_RING],
        ['series-barber-ivan', 'inProgress', 'с това посещение', PENDING_RING],
        ['series-early-bird', 'inProgress', 'с това посещение', PENDING_RING],
      ]);
      // Every ladder climbed: nothing is left to be near.
      const done: AchievementsData = {
        ...GEORGI,
        catalog: loyaltyCatalogWith((catalog) => ({
          ...catalog,
          series: catalog.series.filter(
            (family) =>
              family.id === 'series-rhythm' || family.id === 'series-welcome',
          ),
          seasons: [],
        })),
      };
      expect(medalsPageVm(done, SETTLED, CHIP_ALL).close).toEqual([]);
    });

    it('offers fewer than three where fewer are under way', () => {
      const two: AchievementsData = {
        ...GEORGI,
        progress: new Map(
          [...GEORGI.progress].filter(
            ([id]) => id === 'series-weekend' || id === 'series-svc-beard',
          ),
        ),
      };
      expect(
        medalsPageVm(two, SETTLED, CHIP_ALL).close.map((t) => t.key),
      ).toEqual(['series-weekend', 'series-svc-beard']);
    });
  });

  describe('the season (AG)', () => {
    it('draws its medal in its ring, with its rim numeral: no ladder beside it prints the level', () => {
      expect(page.season).toMatchObject({
        seasonId: 'season-2026-autumn',
        title: 'Есен 2026',
        dates: '1.09 – 30.11',
        familiesCaption: 'Сезонни: 1 от 4',
        accessibleName: 'Есен 2026: ниво II, до 30 ноември',
      });
      expect(page.season?.medal).toMatchObject({
        seriesId: 'series-2026-autumn-track',
        state: 'earned',
        level: 'II',
        title: null,
        caption: null,
        // II was won today: nothing yet towards III.
        value: 0,
      });
    });

    it('says ONE sentence: the level won, then the way on', () => {
      expect(page.season?.sentence).toBe('Ниво II · още 1 посещение до III');
      // Nothing won yet: the way on alone.
      expect(medalsPageVm(MARTIN, SETTLED, CHIP_ALL).season?.sentence).toBe(
        'Още 1 посещение до I',
      );
      // The words that already open on the level stand as they are.
      expect(medalsPageVm(GEORGI, OPEN, CHIP_ALL).season?.sentence).toBe(
        'Ниво\u00a0III с това посещение',
      );
      expect(medalsPageVm(MARTIN, BIRTHDAY, CHIP_ALL).season?.sentence).toBe(
        'Ниво\u00a0I с това посещение',
      );
    });

    it('says a finished track is finished', () => {
      const top = withProgress('series-2026-autumn-track', 5, [
        [1, '2026-09-03'],
        [2, '2026-09-10'],
        [3, '2026-09-17'],
        [4, '2026-09-24'],
        [5, '2026-09-28'],
      ]);
      const season = medalsPageVm(top, SETTLED, CHIP_ALL).season;
      expect(season?.sentence).toBe('Всички нива');
      expect(season?.medal).toMatchObject({
        state: 'complete',
        level: 'V',
        value: 1,
      });
    });

    it('draws ALL its families as regular medals, named and captioned short, in shelf order', () => {
      expect(
        page.season?.families.map((m) => [
          m.title,
          m.state,
          m.level,
          m.caption,
        ]),
      ).toEqual([
        ['Есенно утро', 'complete', null, '28.09'],
        ['Всеки есенен месец', 'inProgress', null, '1/3'],
        ['Есенна брада', 'notStarted', null, '0/2'],
        ['Приятел наесен', 'notStarted', null, '0/1'],
      ]);
      expect(page.season?.families[1]?.value).toBeCloseTo(1 / 3);
    });
  });

  describe('the events (AH)', () => {
    it('draws an open event with all its families, named and captioned', () => {
      expect(page.events).toHaveLength(1);
      expect(page.events[0]).toMatchObject({
        seasonId: 'event-2026-beard-week',
        title: 'Седмица на брадата',
        when: 'до 5.10',
        count: '0 от 2',
        accessibleName: 'Седмица на брадата, 0 от 2, до 5 октомври',
      });
      expect(
        page.events[0]?.medals.map((m) => [m.title, m.state, m.caption]),
      ).toEqual([
        ['Брада на седмицата', 'notStarted', '0/1'],
        ['Пълна грижа на седмицата', 'notStarted', 'Още не е спечелено'],
      ]);
    });

    it('never hides an announced event, and counts nothing in it yet', () => {
      const before: AchievementsData = {
        ...GEORGI,
        today: localDate('2026-09-10'),
      };
      const vm = medalsPageVm(before, SETTLED, CHIP_ALL);
      expect(vm.events[0]).toMatchObject({
        title: 'Седмица на брадата',
        when: 'от 22.09',
        count: null,
      });
      expect(vm.events[0]?.medals).toHaveLength(2);
    });
  });

  describe('the collection (AK)', () => {
    it('counts the families with a level earned, of the families the page shows today', () => {
      expect(page.collection).toEqual({
        ring: {
          value: 15,
          min: 0,
          max: 38,
          marks: [],
          label: 'Постижения',
          valueText: 'Колекция: 15 от 38 медала, 37 спечелени нива',
        },
        figure: '15',
        line: 'от 38 медала',
        levels: '37 спечелени нива',
        accessibleName: 'Колекция: 15 от 38 медала, 37 спечелени нива',
      });
    });

    it('is what the sections and the open windows draw, neither more nor less', () => {
      const families =
        page.sections.reduce((sum, s) => sum + s.tiles.length, 0) +
        // The season's track and its families, the event's families.
        1 +
        (page.season?.families.length ?? 0) +
        page.events.reduce((sum, e) => sum + e.medals.length, 0);
      expect(families).toBe(38);
      expect(page.collection.ring.max).toBe(families);
    });

    it('leaves an ended season out of both figures, and keeps its levels in the count of levels', () => {
      // Георги's summer: a track at III and a family won, both archived.
      expect(page.archive).toEqual({
        count: '1',
        accessibleName: 'Минали сезони и събития, 1',
      });
      const summer = [
        'series-2026-summer-track',
        'series-2026-summer-each-month',
      ];
      const without: AchievementsData = {
        ...GEORGI,
        progress: new Map(
          [...GEORGI.progress].filter(([id]) => !summer.includes(id)),
        ),
      };
      const vm = medalsPageVm(without, SETTLED, CHIP_ALL);
      expect([vm.collection.figure, vm.collection.line]).toEqual([
        '15',
        'от 38 медала',
      ]);
      expect(vm.collection.levels).toBe('33 спечелени нива');
    });

    it('is the page’s, whatever the chip', () => {
      for (const chip of page.chips) {
        expect(medalsPageVm(GEORGI, SETTLED, chip.id).collection).toEqual(
          page.collection,
        );
      }
    });

    it('agrees its nouns at one, and never divides by nought', () => {
      const one: AchievementsData = {
        ...GEORGI,
        progress: new Map(
          [...GEORGI.progress].filter(([id]) => id === 'series-welcome'),
        ),
      };
      expect(medalsPageVm(one, SETTLED, CHIP_ALL).collection).toMatchObject({
        figure: '1',
        levels: '1 спечелено ниво',
        accessibleName: 'Колекция: 1 от 38 медала, 1 спечелено ниво',
      });
      const bare: AchievementsData = {
        ...GEORGI,
        progress: new Map(),
        catalog: loyaltyCatalogWith((catalog) => ({
          ...catalog,
          series: [],
          seasons: [],
        })),
      };
      expect(
        medalsPageVm(bare, SETTLED, CHIP_ALL).collection.ring,
      ).toMatchObject({ value: 0, max: 1 });
    });
  });

  describe('the sections (AL)', () => {
    it('draws every category as a grid of all its families, the count as text', () => {
      expect(
        page.sections.map((s) => [
          s.categoryId,
          s.title,
          s.count,
          s.tiles.length,
          s.folded,
        ]),
      ).toEqual([
        ['cat-milestones', 'Етапи', '3 от 5', 5, null],
        ['cat-mastery', 'Майсторство', '3 от 9', 9, null],
        ['cat-barbers', 'Бръснари и салони', '2 от 7', 7, null],
        ['cat-rhythm', 'Ритъм', '2 от 3', 3, null],
        ['cat-special', 'Специални', '3 от 7', 7, null],
      ]);
    });

    it('orders a section earned, then in progress, then not started', () => {
      expect(
        page.sections
          .find((s) => s.categoryId === 'cat-special')
          ?.tiles.map((t) => [t.medal.title, t.medal.state]),
      ).toEqual([
        ['Ранобудник', 'earned'],
        ['Точен', 'earned'],
        ['Добре дошъл', 'complete'],
        ['Съботен', 'inProgress'],
        ['Рожден ден в салона', 'notStarted'],
        ['Пълен профил', 'notStarted'],
        ['В компания', 'notStarted'],
      ]);
    });

    it('counts a complete family as earned: the figure is the filled discs', () => {
      const rhythm = page.sections.find((s) => s.categoryId === 'cat-rhythm');
      expect(
        rhythm?.tiles.filter(
          (t) => t.medal.state === 'earned' || t.medal.state === 'complete',
        ),
      ).toHaveLength(2);
      expect(rhythm?.count).toBe('2 от 3');
    });

    it('every tile opens its family’s detail, and is drawn large, named and captioned', () => {
      for (const section of page.sections) {
        for (const tile of section.tiles) {
          expect(tile.opens).toBeNull();
          expect(tile.key).toBe(tile.medal.seriesId);
          expect(tile.medal.title).not.toBeNull();
          expect(tile.medal.caption).not.toBeNull();
        }
      }
    });

    it('marks a level earned since the previous visit «Ново», here and only here', () => {
      const marked = page.sections.flatMap((s) =>
        s.tiles.filter((t) => t.medal.isNew).map((t) => t.medal),
      );
      expect(marked.map((m) => [m.seriesId, m.accessibleName])).toEqual([
        ['series-rhythm', 'В ритъм, ниво V, спечелено на 28 септември, ново'],
      ]);
      expect(page.season?.medal.isNew).toBe(false);
      expect(page.season?.families.some((m) => m.isNew)).toBe(false);
      // Earned before the previous visit began: not new.
      const before: AchievementsData = {
        ...GEORGI,
        previousVisitUtcMs: sofia('2026-09-28T11:30:00'),
      };
      expect(
        medalsPageVm(before, SETTLED, CHIP_ALL).sections.some((s) =>
          s.tiles.some((t) => t.medal.isNew),
        ),
      ).toBe(false);
    });

    it('shows nine families whole and folds ten', () => {
      expect(SECTION_FOLD_OVER).toBe(9);
      // «Майсторство» holds exactly nine.
      expect(
        page.sections.find((s) => s.categoryId === 'cat-mastery')?.folded,
      ).toBeNull();
      const ten = medalsPageVm(
        withMoreFamilies('cat-mastery', 'series-svc-finish', 1),
        SETTLED,
        CHIP_ALL,
      ).sections.find((s) => s.categoryId === 'cat-mastery');
      expect([ten?.count, ten?.tiles.length, ten?.folded]).toEqual([
        '3 от 10',
        10,
        10,
      ]);
    });

    it('keeps ALL the tiles of a folded section, in shelf order: the fold is the body’s', () => {
      const twelve = medalsPageVm(
        withMoreFamilies('cat-special', 'series-party', 5),
        SETTLED,
        CHIP_ALL,
      ).sections.find((s) => s.categoryId === 'cat-special');
      expect(twelve?.folded).toBe(12);
      expect(twelve?.tiles).toHaveLength(12);
      expect(twelve?.tiles.slice(0, 4).map((t) => t.medal.state)).toEqual([
        'earned',
        'earned',
        'complete',
        'inProgress',
      ]);
    });

    it('leaves out a shelf with no family to draw', () => {
      const vm = medalsPageVm(
        {
          ...GEORGI,
          catalog: loyaltyCatalogWith((catalog) => ({
            ...catalog,
            series: catalog.series.filter(
              (family) => family.categoryId !== 'cat-barbers',
            ),
          })),
        },
        SETTLED,
        CHIP_ALL,
      );
      expect(vm.sections.map((s) => s.categoryId)).not.toContain('cat-barbers');
      expect(vm.chips.map((c) => c.id)).not.toContain('cat-barbers');
    });
  });

  describe('sectionTilesShown', () => {
    const section = (tiles: number, folded: number | null) => ({
      tiles: Array.from({ length: tiles }, () =>
        must(page.sections[0]?.tiles[0]),
      ),
      folded,
    });

    it('shows a section whole, whatever the columns', () => {
      for (const columns of [3, 4, 6]) {
        expect(sectionTilesShown(section(9, null), columns)).toBe(9);
        expect(sectionTilesShown(section(2, null), columns)).toBe(2);
      }
    });

    it('shows a folded section’s first two rows', () => {
      expect(sectionTilesShown(section(12, 12), 3)).toBe(6);
      expect(sectionTilesShown(section(12, 12), 4)).toBe(8);
      expect(sectionTilesShown(section(12, 12), 6)).toBe(12);
      expect(sectionTilesShown(section(10, 10), 6)).toBe(10);
      // A count of columns nobody measured yet still shows a row of one.
      expect(sectionTilesShown(section(12, 12), 0)).toBe(2);
    });
  });

  describe('the archive and the empty page', () => {
    it('keeps the one row to the past seasons', () => {
      expect(page.archive).toEqual({
        count: '1',
        accessibleName: 'Минали сезони и събития, 1',
      });
    });

    it('says the first achievement is to come while nothing is earned or under way', () => {
      expect(page.emptyHint).toBeNull();
      const fresh: AchievementsData = {
        ...GEORGI,
        progress: new Map(),
        seasonProgress: new Map(),
        account: { ...GEORGI.account, records: [] },
      };
      const vm = medalsPageVm(fresh, SETTLED, CHIP_ALL);
      expect(vm.emptyHint).toBe('Първото постижение идва с първото посещение.');
      expect(vm.records).toEqual([]);
      expect(vm.archive).toBeNull();
      // The requirement is never hidden: every category draws its silhouettes.
      expect(vm.sections.map((s) => [s.categoryId, s.count])).toEqual([
        ['cat-milestones', '0 от 5'],
        ['cat-mastery', '0 от 9'],
        ['cat-barbers', '0 от 7'],
        ['cat-rhythm', '0 от 3'],
        ['cat-special', '0 от 7'],
      ]);
      expect(
        vm.sections.every((s) =>
          s.tiles.every((t) => t.medal.state === 'notStarted'),
        ),
      ).toBe(true);
      expect(vm.collection.figure).toBe('0');
    });

    it('is silent once a family is under way, a level or none', () => {
      const begun: AchievementsData = {
        ...GEORGI,
        progress: new Map([
          [
            BadgeSeriesId.of('series-weekend'),
            must(GEORGI.progress.get(BadgeSeriesId.of('series-weekend'))),
          ],
        ]),
      };
      expect(medalsPageVm(begun, SETTLED, CHIP_ALL).emptyHint).toBeNull();
    });
  });

  describe('under a chip', () => {
    it('shows one category alone and whole under its chip: no fold, nothing of the overview', () => {
      const vm = medalsPageVm(
        withMoreFamilies('cat-special', 'series-party', 5),
        SETTLED,
        'cat-special',
      );
      expect(
        vm.sections.map((s) => [s.categoryId, s.tiles.length, s.folded]),
      ).toEqual([['cat-special', 12, null]]);
      expect(vm.close).toEqual([]);
      expect(vm.season).toBeNull();
      expect(vm.events).toEqual([]);
      expect(vm.archive).toBeNull();
      expect(vm.emptyHint).toBeNull();
    });

    it('shows the season, the events and the archive row under «Сезони», and no category', () => {
      const vm = medalsPageVm(GEORGI, SETTLED, CHIP_SEASONS);
      expect(vm.sections).toEqual([]);
      expect(vm.close).toEqual([]);
      expect(vm.season).toEqual(page.season);
      expect(vm.events).toEqual(page.events);
      expect(vm.archive).toEqual(page.archive);
    });

    it('is the overview under a chip the catalogue no longer has', () => {
      expect(medalsPageVm(GEORGI, SETTLED, 'cat-gone')).toEqual(page);
      expect(medalsPageVm(GEORGI, SETTLED, '')).toEqual(page);
    });
  });

  describe('while the shop runs no rhythm', () => {
    it('hides the record of the longest run: three cards', () => {
      expect(
        medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL).records.map((r) => r.id),
      ).toEqual(['mostVisitsInYear', 'favouriteService', 'firstVisit']);
    });

    it('cuts the rhythm’s shelf to what was already earned, the chip and the collection with it', () => {
      const vm = medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL);
      const rhythm = vm.sections.find((s) => s.categoryId === 'cat-rhythm');
      expect(rhythm?.count).toBe('2 от 2');
      expect(rhythm?.tiles.map((t) => [t.medal.title, t.medal.state])).toEqual([
        ['В ритъм', 'complete'],
        ['Цяла година', 'complete'],
      ]);
      expect(vm.chips.find((c) => c.id === 'cat-rhythm')?.accessibleName).toBe(
        'Ритъм, 2 от 2 спечелени',
      );
      expect(vm.collection.line).toBe('от 37 медала');
      expect(vm.collection.figure).toBe('15');
    });

    it('takes back no level: what was earned stays earned', () => {
      const off = medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL);
      expect(off.collection.levels).toBe(page.collection.levels);
    });

    it('drops the shelf and its chip where nothing of it was earned', () => {
      const none = rhythmOff({
        ...GEORGI,
        progress: new Map(
          [...GEORGI.progress].filter(
            ([id]) => id !== 'series-rhythm' && id !== 'series-twelve-months',
          ),
        ),
      });
      const vm = medalsPageVm(none, SETTLED, CHIP_ALL);
      expect(vm.sections.map((s) => s.categoryId)).not.toContain('cat-rhythm');
      expect(vm.chips.map((c) => c.id)).not.toContain('cat-rhythm');
      // Its chip, chosen before the rule went off, is the overview.
      expect(medalsPageVm(none, SETTLED, 'cat-rhythm')).toEqual(vm);
    });

    it('offers no family of the rhythm’s shelf as «almost»', () => {
      // Мартин's «Цяла година» is his second nearest.
      expect(
        medalsPageVm(MARTIN, SETTLED, CHIP_ALL).close.map((t) => t.key),
      ).toContain('series-twelve-months');
      expect(
        medalsPageVm(rhythmOff(MARTIN), SETTLED, CHIP_ALL).close.map(
          (t) => t.key,
        ),
      ).not.toContain('series-twelve-months');
    });

    it('takes the caller’s flag over a rule that is on, and never the other way', () => {
      const flagged = medalsPageVm(GEORGI, SETTLED, CHIP_ALL, {
        rhythm: false,
      });
      expect(flagged).toEqual({
        ...medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL),
      });
      expect(
        medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL, { rhythm: true }),
      ).toEqual(medalsPageVm(rhythmOff(), SETTLED, CHIP_ALL));
      expect(medalsPageVm(GEORGI, SETTLED, CHIP_ALL, { rhythm: true })).toEqual(
        page,
      );
    });
  });

  it('draws no medal on anything but a ring’s four states, and none with a meter it does not explain', () => {
    const medals = [GEORGI, MARTIN].flatMap((data) =>
      [SETTLED, OPEN, BIRTHDAY].flatMap((ctx) => {
        const vm = medalsPageVm(data, ctx, CHIP_ALL);
        return [
          ...vm.close.map((t) => t.medal),
          ...vm.sections.flatMap((s) => s.tiles.map((t) => t.medal)),
          ...(vm.season === null
            ? []
            : [vm.season.medal, ...vm.season.families]),
          ...vm.events.flatMap((e) => e.medals),
        ];
      }),
    );
    expect(medals.length).toBeGreaterThan(200);
    for (const medal of medals) {
      expect(['notStarted', 'inProgress', 'earned', 'complete']).toContain(
        medal.state,
      );
      if (medal.value !== null) {
        expect(medal.value).toBeGreaterThanOrEqual(0);
        expect(medal.value).toBeLessThanOrEqual(1);
        expect(medal.valueText).not.toBeNull();
      }
      if (medal.state === 'complete') expect(medal.value).toBe(1);
      if (medal.state === 'notStarted') {
        expect(medal.value).toBeNull();
        expect(medal.level).toBeNull();
      }
      if (medal.state === 'inProgress') expect(medal.level).toBeNull();
      expect(medal.accessibleName.length).toBeGreaterThan(0);
    }
  });

  it('words the page in English', () => {
    const vm = medalsPageVm(GEORGI, ENGLISH, CHIP_ALL);
    expect(vm.chips.map((c) => c.label)).toEqual([
      'All',
      'Milestones',
      'Mastery',
      'Barbers',
      'Rhythm',
      'Special',
      'Seasons',
    ]);
    expect(vm.chips[3]?.accessibleName).toBe('Barbers & shops, 2 of 7 earned');
    expect(vm.collection).toMatchObject({
      figure: '15',
      line: 'of 38 medals',
      levels: '37 levels earned',
    });
    expect(vm.season?.sentence).toBe('Level II · 1 more visit to III');
  });
});

describe('medalScopeVm', () => {
  it('is a category whole, in its sub-sections, every medal in its ring', () => {
    const vm = medalScopeVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-mastery'),
      },
      SETTLED,
    );
    expect(vm).toMatchObject({
      title: 'Майсторство',
      subline: 'Майсторство · 3 от 9 спечелени',
      track: null,
      ended: null,
    });
    expect(
      vm?.sections.map((s) => [s.key, s.title, s.detail, s.tiles.length]),
    ).toEqual([
      ['hair', 'Коса', '1 от 5', 5],
      ['beard', 'Брада', '1 от 2', 2],
      ['care', 'Грижа', '0 от 1', 1],
      ['general', 'Общи', '1 от 1', 1],
    ]);
    const fade = vm?.sections[0]?.tiles[0]?.medal;
    expect(fade).toEqual(ring(GEORGI, 'series-svc-fade'));
  });

  it('tells a family as the overview’s section does: one ring, one «Ново»', () => {
    const page = medalsPageVm(GEORGI, SETTLED, CHIP_ALL);
    for (const section of page.sections) {
      const scope = medalScopeVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: section.categoryId,
        },
        SETTLED,
      );
      const drawn = new Map(
        scope?.sections.flatMap((s) => s.tiles.map((t) => [t.key, t] as const)),
      );
      expect(drawn.size).toBe(section.tiles.length);
      for (const tile of section.tiles) {
        expect(drawn.get(tile.key)).toEqual(tile);
      }
    }
  });

  it('counts a category’s quiet line by what was earned, as its chip and its section do', () => {
    expect(
      medalScopeVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-barbers'),
        },
        SETTLED,
      )?.subline,
    ).toBe('Бръснари и салони · 2 от 7 спечелени');
  });

  it('cuts the rhythm’s shelf as the overview does while the shop runs none', () => {
    const scope = {
      achievementScope: AchievementScope.Category,
      categoryId: BadgeCategoryId.of('cat-rhythm'),
    } as const;
    const vm = medalScopeVm(rhythmOff(), scope, SETTLED);
    expect(vm?.subline).toBe('Ритъм · 2 от 2 спечелени');
    expect(
      vm?.sections.flatMap((s) => s.tiles.map((t) => t.medal.title)),
    ).toEqual(['В ритъм', 'Цяла година']);
    expect(
      medalScopeVm(GEORGI, scope, SETTLED, { rhythm: false })?.subline,
    ).toBe('Ритъм · 2 от 2 спечелени');
    // Nothing of it earned: the category is not a page.
    expect(
      medalScopeVm(
        rhythmOff({ ...GEORGI, progress: new Map() }),
        scope,
        SETTLED,
      ),
    ).toBeNull();
    // Another category is untouched.
    expect(
      medalScopeVm(
        rhythmOff(),
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-mastery'),
        },
        SETTLED,
      )?.sections,
    ).toEqual(
      medalScopeVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-mastery'),
        },
        SETTLED,
      )?.sections,
    );
  });

  it('draws a running season’s scope: the track’s medal in its ring beside its steps, the families under them', () => {
    const vm = medalScopeVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Season,
        seasonId: SeasonId.of('season-2026-autumn'),
      },
      SETTLED,
    );
    expect(vm).toMatchObject({
      title: 'Есен 2026',
      subline: '1.09 – 30.11',
      ended: null,
    });
    // The steps print the level: the rim beside them stays empty.
    expect(vm?.track?.medal).toMatchObject({
      seriesId: 'series-2026-autumn-track',
      state: 'earned',
      level: null,
      title: null,
      caption: null,
      value: 0,
    });
    expect(vm?.track?.gauge.marks.map((mark) => mark.short)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
    ]);
    expect(
      vm?.sections[0]?.tiles.map((t) => [
        t.medal.title,
        t.medal.state,
        t.medal.caption,
        t.medal.isNew,
      ]),
    ).toEqual([
      ['Есенно утро', 'complete', '28.09', false],
      ['Всеки есенен месец', 'inProgress', '1/3 до I', false],
      ['Есенна брада', 'notStarted', '0/2 до I', false],
      ['Приятел наесен', 'notStarted', '0/1 до I', false],
    ]);
  });

  it('draws an ended season as what was won: the rim says the level, no arc runs on', () => {
    const vm = medalScopeVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Season,
        seasonId: SeasonId.of('season-2026-summer'),
      },
      SETTLED,
    );
    expect(vm?.ended).toBe('Сезонът приключи.');
    expect(vm?.track?.medal).toMatchObject({
      state: 'earned',
      level: 'III',
      value: null,
    });
    expect(
      vm?.sections[0]?.tiles.map((t) => [
        t.medal.title,
        t.medal.state,
        t.medal.caption,
      ]),
    ).toEqual([['Всеки летен месец', 'complete', '6.08']]);
  });

  it('draws the archive’s seasons under their own names and dates, each opening its scope', () => {
    const vm = medalScopeVm(
      GEORGI,
      { achievementScope: AchievementScope.Archive },
      SETTLED,
    );
    expect(vm).toMatchObject({
      title: 'Минали сезони и събития',
      subline: 'Георги Петров',
    });
    expect(
      vm?.sections.map((s) => [
        s.key,
        s.tiles.map((t) => [
          t.key,
          t.opens,
          t.medal.title,
          t.medal.caption,
          t.medal.state,
          t.medal.level,
          t.medal.value,
        ]),
      ]),
    ).toEqual([
      [
        '2026',
        [
          [
            'season-2026-summer',
            {
              achievementScope: AchievementScope.Season,
              seasonId: 'season-2026-summer',
            },
            'Лято 2026',
            '1.06 – 31.08',
            'earned',
            'III',
            null,
          ],
        ],
      ],
    ]);
  });

  it("keeps an archived event's own medal whose id spells a family's: no family's ring (DEP-4)", () => {
    // Pass E DEP-4. Before: the event's tile, its season id spelling
    // «Фейд»'s family id, was redrawn in the fade family's ring (its art,
    // its state, its rim). After: a season's own medal draws no family, so
    // the tile keeps the event's emblem and count.
    const beardWeek = SeasonId.of('event-2026-beard-week');
    const clash = SeasonId.of('series-svc-fade');
    const data: AchievementsData = {
      ...withProgress('series-2026-beard-week-beard', 1, [[1, '2026-09-30']]),
      today: localDate('2027-01-15'),
      catalog: loyaltyCatalogWith((catalog) => ({
        ...catalog,
        seasons: catalog.seasons.map((season) =>
          season.id === beardWeek ? { ...season, id: clash } : season,
        ),
        series: catalog.series.map((family) =>
          family.seasonId === beardWeek
            ? { ...family, seasonId: clash }
            : family,
        ),
      })),
    };
    const tile = medalScopeVm(
      data,
      { achievementScope: AchievementScope.Archive },
      SETTLED,
    )
      ?.sections.flatMap((section) => section.tiles)
      .find((archived) => archived.key === clash);
    expect(tile?.medal).toMatchObject({
      seriesId: clash,
      familyId: null,
      icon: 'loyalty.badge.event',
      src: null,
      level: null,
      state: 'earned',
      title: 'Седмица на брадата',
    });
  });

  it('draws a day’s levels in rings, and marks none new: the day is the past', () => {
    const vm = medalScopeVm(
      GEORGI,
      { achievementScope: AchievementScope.Day, day: localDate('2026-09-28') },
      SETTLED,
    );
    expect(vm?.title).toBe('Спечелени на 28.09');
    expect(
      vm?.sections[0]?.tiles.map((t) => [t.key, t.medal.state, t.medal.isNew]),
    ).toEqual([
      ['series-rhythm', 'complete', false],
      ['series-2026-autumn-track', 'earned', false],
      ['series-2026-autumn-early', 'complete', false],
    ]);
  });

  it('is nothing for a scope the catalogue lacks', () => {
    expect(
      medalScopeVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-gone'),
        },
        SETTLED,
      ),
    ).toBeNull();
    expect(
      medalScopeVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Season,
          seasonId: SeasonId.of('season-gone'),
        },
        SETTLED,
      ),
    ).toBeNull();
  });
});
