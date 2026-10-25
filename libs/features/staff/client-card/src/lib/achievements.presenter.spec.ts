import { describe, expect, it } from 'vitest';
import { BadgeCategoryKind, BadgeEmblem, EarnedVia } from '@core/components';
import {
  BadgeCategoryId,
  BadgeSeriesId,
  BarberId,
  LocationId,
  SeasonId,
  ServiceId,
} from '@core/primitives';
import { LoyaltyCatalogSystem } from '@core/systems';
import { duration, localDate, minute, utcMs } from '@core/testing';
import { isUiIconName } from '@creativo/ui/controls';
import {
  BADGE_CATEGORY_ICONS,
  BADGE_EMBLEM_ICONS,
  achievementScopeKey,
  achievementScopeOf,
  completesWithThisVisit,
  familyOfMedal,
  medalVm,
  scopePageVm,
  scopeTitleOf,
  shelfOrdered,
} from './achievements.presenter';
import type { AchievementsData, MedalVm } from './client-pages.vm';
import {
  GEORGI_PREVIOUS_MS,
  MARTIN_PREVIOUS_MS,
  achievementsContextOf,
  achievementsDataOf,
  sofia,
  startOf,
  georgiContext,
  georgiOpenContext,
  martinContext,
  must,
} from '../testing/client-card.fixtures';
import {
  AchievementScope,
  type ClientCardStart,
} from './client-card.contracts';

const GEORGI = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const MARTIN = achievementsDataOf('martin', MARTIN_PREVIOUS_MS);
/** Георги's card on today's settled fade: nothing a visit can still move. */
const SETTLED = achievementsContextOf(georgiContext(), 'Георги Петров');
/** Георги's card on his next fade, still open. */
const OPEN = achievementsContextOf(georgiOpenContext(), 'Георги Петров');
/** Мартин in the chair on his birthday. */
const BIRTHDAY = achievementsContextOf(martinContext(), 'Мартин Илиев', true);

function series(data: AchievementsData, id: string) {
  const found = LoyaltyCatalogSystem.series(data.catalog, BadgeSeriesId.of(id));
  if (found === null) throw new Error(`no family ${id}`);
  return found;
}

describe('the registry maps', () => {
  it('draws every emblem and every shelf with a registered glyph, each its own', () => {
    for (const icon of [
      ...Object.values(BADGE_EMBLEM_ICONS),
      ...Object.values(BADGE_CATEGORY_ICONS),
    ]) {
      expect(isUiIconName(icon)).toBe(true);
    }
    expect(BADGE_EMBLEM_ICONS[BadgeEmblem.Visits]).toBe('loyalty.badge.visits');
    expect(BADGE_CATEGORY_ICONS[BadgeCategoryKind.Mastery]).toBe(
      'loyalty.category.mastery',
    );
    expect(new Set(Object.values(BADGE_EMBLEM_ICONS)).size).toBe(
      Object.keys(BADGE_EMBLEM_ICONS).length,
    );
  });

  it('draws every family the catalogue holds', () => {
    for (const family of GEORGI.catalog.families) {
      expect(isUiIconName(BADGE_EMBLEM_ICONS[family.emblem])).toBe(true);
    }
  });
});

describe('scope keys', () => {
  it('round-trips every scope through the editor’s subject id', () => {
    const scopes = [
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-mastery'),
      },
      {
        achievementScope: AchievementScope.Season,
        seasonId: SeasonId.of('season-2026-autumn'),
      },
      { achievementScope: AchievementScope.Archive },
      { achievementScope: AchievementScope.Day, day: localDate('2026-09-04') },
    ] as const;
    expect(scopes.map(achievementScopeKey)).toEqual([
      'category:cat-mastery',
      'season:season-2026-autumn',
      'archive',
      'day:2026-09-04',
    ]);
    for (const scope of scopes) {
      expect(achievementScopeOf(achievementScopeKey(scope))).toEqual(scope);
    }
  });

  it('refuses a key that names no scope', () => {
    for (const key of [
      '',
      'category:',
      'shelf:cat-mastery',
      'day:4.09',
      'day:',
    ]) {
      expect(achievementScopeOf(key)).toBeNull();
    }
  });
});

describe('medalVm', () => {
  it('draws an earned family in progress with its art, its rim numeral and a target in words', () => {
    expect(medalVm(series(GEORGI, 'series-svc-fade'), GEORGI, SETTLED)).toEqual(
      {
        seriesId: 'series-svc-fade',
        state: 'earned',
        icon: 'loyalty.badge.service',
        src: 'https://example.test/covers/fade.jpg',
        monogram: null,
        level: 'II',
        title: 'Фейд',
        caption: '24/25 до III',
        value: 0.96,
        valueText: '24 от 25 до ниво III',
        isNew: false,
        accessibleName:
          'Фейд, ниво II, спечелено на 22 септември 2025 г., 24 от 25 до ниво III',
      },
    );
  });

  it('keeps the rim empty in progress and never numbers a title', () => {
    const medal = medalVm(series(GEORGI, 'series-weekend'), GEORGI, SETTLED);
    expect(medal).toMatchObject({
      state: 'inProgress',
      level: null,
      title: 'Съботен',
      caption: '2/3 до I',
      accessibleName: 'Съботен, 2 от 3 до ниво I',
    });
    expect(medal.value).toBeCloseTo(2 / 3);
  });

  it('draws a service family without a cover as its monogram, with its first requirement, and no meter', () => {
    expect(
      medalVm(series(GEORGI, 'series-svc-classic-cut'), GEORGI, SETTLED),
    ).toMatchObject({
      state: 'notStarted',
      src: null,
      monogram: 'К',
      level: null,
      caption: '0/3 до I',
      value: null,
      valueText: null,
      accessibleName:
        'Класическа подстрижка, още не е започнато: 3 посещения с класическа подстрижка',
    });
  });

  it('draws a barber family with the barber’s face and a shop family with the shop’s cover', () => {
    expect(
      medalVm(series(GEORGI, 'series-barber-ivan'), GEORGI, SETTLED).src,
    ).toBe('https://example.test/barbers/ivan.jpg');
    expect(
      medalVm(series(GEORGI, 'series-shop-center'), GEORGI, SETTLED).src,
    ).toBe('https://example.test/shops/center.jpg');
  });

  it('lets owner art win over the subject’s art, where the dashboard resolves it', () => {
    const family = series(GEORGI, 'series-svc-fade');
    const withArt = { ...family, artPath: 'badgeArt/fade.png' };
    const ctx = {
      ...SETTLED,
      catalog: {
        ...SETTLED.catalog,
        badgeArtSrc: (path: string) => `https://example.test/${path}`,
      },
    };
    expect(medalVm(withArt, GEORGI, ctx).src).toBe(
      'https://example.test/badgeArt/fade.png',
    );
    expect(medalVm(withArt, GEORGI, SETTLED).src).toBe(
      'https://example.test/covers/fade.jpg',
    );
  });

  it('captions a one-off by the day it was earned', () => {
    expect(
      medalVm(series(GEORGI, 'series-welcome'), GEORGI, SETTLED),
    ).toMatchObject({
      state: 'earned',
      level: 'I',
      caption: '6.03.2025 г.',
      value: null,
    });
  });

  it('marks a level earned since the previous visit «ново», and says so, where the place asks', () => {
    const rhythm = series(GEORGI, 'series-rhythm');
    const medal = medalVm(rhythm, GEORGI, SETTLED, { markNew: true });
    expect(medal).toMatchObject({
      isNew: true,
      level: 'V',
      caption: 'Всички нива',
      value: null,
      accessibleName: 'В ритъм, ниво V, спечелено на 28 септември, ново',
    });
    const before = {
      ...GEORGI,
      previousVisitUtcMs: sofia('2026-09-28T11:00:00'),
    };
    expect(medalVm(rhythm, before, SETTLED, { markNew: true }).isNew).toBe(
      false,
    );
    // Opt-in: anywhere else the same level is not called new, in the chip
    // or the sentence (one place per page, §3.0).
    expect(medalVm(rhythm, GEORGI, SETTLED)).toMatchObject({
      isNew: false,
      accessibleName: 'В ритъм, ниво V, спечелено на 28 септември',
    });
  });

  it('draws the disc alone where the page asks for it', () => {
    expect(
      medalVm(series(GEORGI, 'series-svc-fade'), GEORGI, SETTLED, {
        titled: false,
        captioned: false,
        meter: false,
      }),
    ).toMatchObject({
      title: null,
      caption: null,
      value: null,
      valueText: null,
    });
  });
});

/*
 * «Families drawn with their own art» (§3.3) is what keeps the collection
 * from turning into a wall of clones as the catalogue grows per shop, per
 * barber and per season: a shelf or a season is read disc by disc, never
 * by titles under identical discs. Checked under a shop with no covers and
 * no portraits at all — the worst the card can be handed.
 */
describe('one face per family', () => {
  const ARTLESS = {
    ...SETTLED,
    catalog: {
      ...SETTLED.catalog,
      serviceCoverSrc: () => null,
      barberAvatarSrc: () => null,
      locationCoverSrc: () => null,
    },
  };
  /** The emblems of the discs that have neither art nor a letter. */
  const emblemsOf = (medals: readonly MedalVm[]) =>
    medals
      .filter((medal) => medal.src === null && medal.monogram === null)
      .map((medal) => medal.icon);
  const repeated = (faces: readonly (string | null)[]) =>
    faces.filter((face, i) => faces.indexOf(face) !== i);

  it('draws a shop without a cover and a barber without a portrait as the letter of their name', () => {
    expect(
      medalVm(series(GEORGI, 'series-shop-center'), GEORGI, ARTLESS),
    ).toMatchObject({ src: null, monogram: 'Ц', icon: 'loyalty.badge.shop' });
    expect(
      medalVm(series(GEORGI, 'series-shop-mladost'), GEORGI, SETTLED),
    ).toMatchObject({ src: null, monogram: 'М' });
    // «С Иван» · «С Нико» · «Със Стефан»: the titles would give every
    // barber an «С»; the catalogue's names tell them apart.
    expect(
      ['series-barber-ivan', 'series-barber-niko', 'series-barber-stefan'].map(
        (id) => medalVm(series(GEORGI, id), GEORGI, ARTLESS).monogram,
      ),
    ).toEqual(['И', 'Н', 'С']);
    // A portrait still wins over the letter.
    expect(
      medalVm(series(GEORGI, 'series-barber-ivan'), GEORGI, SETTLED),
    ).toMatchObject({
      src: 'https://example.test/barbers/ivan.jpg',
      monogram: null,
    });
  });

  it('keeps the emblem for a family about no one thing, and for a barber or shop the catalogue no longer knows', () => {
    expect(
      medalVm(series(GEORGI, 'series-both-shops'), GEORGI, ARTLESS),
    ).toMatchObject({ monogram: null, icon: 'loyalty.badge.shop' });
    const gone = {
      ...ARTLESS,
      catalog: {
        ...ARTLESS.catalog,
        barberName: () => null,
        locationName: () => null,
      },
    };
    expect(
      medalVm(series(GEORGI, 'series-barber-ivan'), GEORGI, gone),
    ).toMatchObject({ monogram: null, icon: 'loyalty.badge.barber' });
    expect(
      medalVm(series(GEORGI, 'series-shop-center'), GEORGI, gone),
    ).toMatchObject({ monogram: null, icon: 'loyalty.badge.shop' });
  });

  it('never draws two art-less families of one shelf with one emblem', () => {
    const clones = GEORGI.catalog.categories
      .map((category) => ({
        shelf: category.id,
        repeated: repeated(
          emblemsOf(
            LoyaltyCatalogSystem.seriesIn(GEORGI.catalog, category.id).map(
              (family) => medalVm(family, GEORGI, ARTLESS),
            ),
          ),
        ),
      }))
      .filter((shelf) => shelf.repeated.length > 0);
    expect(clones).toEqual([]);
  });

  it('never draws a season’s family with its track’s emblem, nor two of them with one', () => {
    const clones = GEORGI.catalog.seasons
      .map((season) => {
        const ids = new Set<string>([
          ...(season.trackSeriesId === null ? [] : [season.trackSeriesId]),
          ...season.seriesIds,
        ]);
        return {
          season: season.id,
          repeated: repeated(
            emblemsOf(
              [...ids].map((id) =>
                medalVm(series(GEORGI, id), GEORGI, ARTLESS),
              ),
            ),
          ),
        };
      })
      .filter((season) => season.repeated.length > 0);
    expect(clones).toEqual([]);
    expect(
      medalVm(series(GEORGI, 'series-2026-autumn-each-month'), GEORGI, ARTLESS)
        .icon,
    ).not.toBe(
      medalVm(series(GEORGI, 'series-2026-autumn-track'), GEORGI, ARTLESS).icon,
    );
  });
});

/**
 * One face per family, ACROSS seasons (§3.3.3, wave D r6, Critique 3): the
 * rule above held per shelf and per season, so twins across them shared a
 * face — every season's track one rosette (the archive a grid of them, and
 * Мартин's «Лято 2026» III on the glance the running «Есен 2026»), «Есенно
 * утро» the «Ранобудник» sunrise, «Лятна събота» the «Съботен» sofa, and
 * one beard photo on «Оформяне на брада», «Есенна брада» and «Брада на
 * седмицата» within one scroll. And a shop that reuses a photo put two
 * mastery families on one disc («Пълна грижа» · «Класическа подстрижка»).
 */
describe('one face per family, across seasons and shared pictures', () => {
  /** What a disc draws: its art, else its letter, else its emblem. */
  const faceOf = (medal: MedalVm) =>
    medal.src ?? (medal.monogram === null ? medal.icon : `«${medal.monogram}»`);
  const ARTLESS = {
    ...SETTLED,
    catalog: {
      ...SETTLED.catalog,
      serviceCoverSrc: () => null,
      barberAvatarSrc: () => null,
      locationCoverSrc: () => null,
    },
  };
  /**
   * The dev seed's covers (`tools/seed/catalog.mjs`): every service has
   * one, and the two bundles wear their first member's photo.
   */
  const SHARED_COVERS = {
    ...SETTLED,
    catalog: {
      ...SETTLED.catalog,
      serviceCoverSrc: (id: string) => {
        const file = new Map([
          ['svc-classic-cut', 'classic-clippers'],
          ['svc-fade', 'fade-styling'],
          ['svc-beard', 'beard-shave'],
          ['svc-scissor-trim', 'scissors-trim'],
          ['svc-modern-cut', 'modern-cut'],
          ['svc-finish', 'finishing-touch'],
          ['svc-full-care', 'classic-clippers'],
          ['svc-father-son', 'modern-cut'],
        ]).get(id);
        return file === undefined
          ? null
          : `https://example.test/covers/${file}.jpg`;
      },
    },
  };
  const repeated = (faces: readonly (string | null)[]) =>
    faces.filter((face, i) => faces.indexOf(face) !== i);

  it('draws a season’s or an event’s family with its own emblem, never its service’s cover or letter', () => {
    // The beard's cover is the perennial «Оформяне на брада»'s face.
    expect(
      medalVm(series(GEORGI, 'series-svc-beard'), GEORGI, SETTLED).src,
    ).toBe('https://example.test/covers/beard.jpg');
    for (const [id, icon] of [
      ['series-2026-autumn-beard', 'loyalty.badge.grooming'],
      ['series-2026-beard-week-beard', 'loyalty.badge.beardOil'],
      ['series-2026-beard-week-full', 'loyalty.badge.spa'],
    ] as const) {
      for (const ctx of [SETTLED, ARTLESS]) {
        expect(medalVm(series(GEORGI, id), GEORGI, ctx), id).toMatchObject({
          src: null,
          monogram: null,
          icon,
        });
      }
    }
  });

  it('never draws a season’s or an event’s family, or a season, with a perennial family’s face, nor two of them with one', () => {
    for (const ctx of [SETTLED, ARTLESS, SHARED_COVERS]) {
      const facesOf = (seasonal: boolean) =>
        GEORGI.catalog.families
          .filter((family) => (family.seasonId !== null) === seasonal)
          .map((family) => faceOf(medalVm(family, GEORGI, ctx)));
      const perennial = new Set(facesOf(false));
      const limited = facesOf(true);
      // Guard the guard: two seasons' tracks and nine families.
      expect(limited).toHaveLength(11);
      expect(limited.filter((face) => perennial.has(face))).toEqual([]);
      expect(repeated(limited)).toEqual([]);
    }
  });
});

describe('completesWithThisVisit («с това посещение»)', () => {
  const completes = (data: AchievementsData, ctx = OPEN) =>
    data.catalog.families
      .filter((family) => completesWithThisVisit(family, data, ctx))
      .map((family): string => family.id)
      .sort();

  it('names every family one short on a count the open visit moves', () => {
    // 24/25 on every visit count; the autumn track at 2/3; the event's
    // beard is not in this visit.
    expect(completes(GEORGI)).toEqual([
      'series-2026-autumn-track',
      'series-barber-ivan',
      'series-early-bird',
      'series-shop-center',
      'series-svc-fade',
      'series-visits',
    ]);
  });

  it('names none on a settled visit', () => {
    expect(completes(GEORGI, SETTLED)).toEqual([]);
  });

  it('holds a service, a barber and a shop to the visit’s own', () => {
    const elsewhere = {
      ...OPEN,
      visit: {
        legs: [
          {
            serviceId: ServiceId.of('svc-beard'),
            variantId: null,
            minutes: duration(20),
            barberId: BarberId.of('niko'),
          },
        ],
        start: startOf('2026-10-02T12:00:00'),
        locationId: LocationId.of('loc-mladost'),
        birthdayToday: false,
      },
    };
    // The counts every visit moves, and the first level of each family
    // this visit's own beard, barber and shop start (0/1); never Иван's,
    // Център's or the fade's, and 12:00 is no early bird.
    expect(completes(GEORGI, elsewhere)).toEqual([
      'series-2026-autumn-track',
      'series-2026-beard-week-beard',
      'series-barber-niko',
      'series-shop-mladost',
      'series-visits',
    ]);
  });

  it('completes the birthday visit on the client’s birthday, once a year', () => {
    expect(completes(MARTIN, BIRTHDAY)).toEqual([
      'series-2026-autumn-track',
      'series-birthday',
    ]);
    expect(
      completes(MARTIN, {
        ...BIRTHDAY,
        visit: { ...must(BIRTHDAY.visit), birthdayToday: false },
      }),
    ).toEqual(['series-2026-autumn-track']);
  });

  // DEP-15 (pass D): the draft's start minute is read on the shop's wall
  // clock as it is. Before, the editor handed the start over as an
  // instant's ISO, which a spring-forward gap's minute (or an editor whose
  // zone was not known yet) left empty: no minute counted, no early bird.
  it('counts a drafted start inside the spring-forward gap by its own minute (DEP-15)', () => {
    const startingAt = (start: ClientCardStart) => ({
      ...OPEN,
      visit: { ...must(OPEN.visit), start },
    });
    // Sofia, 28 March 2027, 03:30 — no instant names it; it is still 03:30,
    // an early start (before: no minute, so no early bird).
    expect(
      completes(
        GEORGI,
        startingAt({
          localDate: localDate('2027-03-28'),
          startMinutes: minute(210),
        }),
      ),
    ).toEqual(completes(GEORGI));
    // The fall-back repeat (25 October 2026, 03:30 twice) reads the same
    // minute both ways: unchanged.
    expect(
      completes(GEORGI, startingAt(startOf('2026-10-25T03:30:00'))),
    ).toContain('series-early-bird');
    // A start that is no minute of the day counts no minute, as before.
    expect(
      completes(
        GEORGI,
        startingAt({ localDate: localDate('2027-03-28'), startMinutes: null }),
      ),
    ).not.toContain('series-early-bird');
  });
});

describe('familyOfMedal', () => {
  it("finds the family a family's medal names, and none for a season's own medal", () => {
    const fade = medalVm(series(GEORGI, 'series-svc-fade'), GEORGI, SETTLED);
    expect(familyOfMedal(GEORGI, fade)?.id).toBe('series-svc-fade');
    // An archived event without a track family draws its OWN medal, named
    // by the season's id — which no family answers (never re-branded).
    const own: MedalVm = {
      ...fade,
      seriesId: SeasonId.of('event-2026-beard-week'),
    };
    expect(familyOfMedal(GEORGI, own)).toBeNull();
  });
});

describe('shelfOrdered', () => {
  it('puts earned families first (highest level first), then the closest in progress, then the rest in catalogue order', () => {
    const families = LoyaltyCatalogSystem.seriesIn(
      GEORGI.catalog,
      BadgeCategoryId.of('cat-barbers'),
    );
    expect(
      shelfOrdered(families, GEORGI).map((family): string => family.id),
    ).toEqual([
      'series-barber-ivan',
      'series-shop-center',
      'series-all-barbers',
      'series-both-shops',
      'series-barber-niko',
      'series-barber-stefan',
      'series-shop-mladost',
    ]);
  });
});

describe('scopePageVm', () => {
  it('sections mastery by the service’s own category, then «Общи»', () => {
    const page = scopePageVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-mastery'),
      },
      SETTLED,
    );
    expect(page?.title).toBe('Майсторство');
    expect(page?.subline).toBe('Георги Петров · 3 от 9 започнати');
    expect(page?.track).toBeNull();
    expect(
      page?.sections.map((section) => [
        section.key,
        section.title,
        section.detail,
        section.tiles.map((t) => t.key),
      ]),
    ).toEqual([
      [
        'hair',
        'Коса',
        '1 от 5',
        [
          'series-svc-fade',
          'series-svc-classic-cut',
          'series-svc-scissor-trim',
          'series-svc-modern-cut',
          'series-svc-father-son',
        ],
      ],
      ['beard', 'Брада', '1 от 2', ['series-svc-beard', 'series-svc-finish']],
      ['care', 'Грижа', '0 от 1', ['series-svc-full-care']],
      ['general', 'Общи', '1 от 1', ['series-explorer']],
    ]);
  });

  it('sections barbers and shops apart', () => {
    const page = scopePageVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-barbers'),
      },
      SETTLED,
    );
    expect(
      page?.sections.map((section) => [
        section.key,
        section.title,
        section.detail,
      ]),
    ).toEqual([
      ['barbers', 'Бръснари', '1 от 3'],
      ['shops', 'Салони', '1 от 2'],
      // Two started, none earned: «2 от 2» over two hollow rings read as
      // earned (wave D r6).
      ['general', 'Общи', '0 от 2'],
    ]);
    // Started stays where it is worded.
    expect(page?.subline).toBe('Георги Петров · 4 от 7 започнати');
  });

  it('counts a group by its earned families, never by the started ones — Мартин’s «Общи» over «Изследовател» in progress', () => {
    const page = scopePageVm(
      MARTIN,
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-mastery'),
      },
      BIRTHDAY,
    );
    const general = page?.sections.find((section) => section.key === 'general');
    expect(general?.tiles.map((tile) => tile.medal.state)).toEqual([
      'inProgress',
    ]);
    expect(general?.detail).toBe('0 от 1');
  });

  it('draws any other shelf as one unlabelled grid', () => {
    const page = scopePageVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Category,
        categoryId: BadgeCategoryId.of('cat-special'),
      },
      SETTLED,
    );
    expect(page?.sections).toHaveLength(1);
    expect(page?.sections[0]).toMatchObject({
      key: 'cat-special',
      title: null,
      detail: null,
    });
  });

  it('draws an ended season with the levels it reached and only what was earned; the level it closed on is drawn, not written', () => {
    const page = scopePageVm(
      GEORGI,
      {
        achievementScope: AchievementScope.Season,
        seasonId: SeasonId.of('season-2026-summer'),
      },
      SETTLED,
    );
    expect(page).toMatchObject({
      title: 'Лято 2026',
      // The dates print once, here; the ended line does not repeat them.
      subline: '1.06 – 31.08',
      // Not «на ниво III»: the rim and the track's last node say it (§3.0).
      ended: 'Сезонът приключи.',
      track: {
        seasonId: 'season-2026-summer',
        // Nothing is left to reach: no «Още …», no step ringed next.
        sentence: null,
        medal: { level: 'III' },
      },
    });
    const gauge = must(page?.track).gauge;
    expect(gauge.marks.map((mark) => mark.short)).toEqual(['I', 'II', 'III']);
    expect(gauge.value).toBe(gauge.max);
    expect(gauge.valueText).toBe('Сезонът приключи на ниво\u00a0III.');
    expect(
      page?.sections.flatMap((section) => section.tiles.map((t) => t.key)),
    ).toEqual(['series-2026-summer-each-month']);
  });

  it('files the archive by the year each window closed, each season opening its own scope', () => {
    const page = scopePageVm(
      GEORGI,
      { achievementScope: AchievementScope.Archive },
      SETTLED,
    );
    expect(page).toMatchObject({
      title: 'Минали сезони и събития',
      subline: 'Георги Петров',
    });
    expect(page?.sections).toEqual([
      {
        key: '2026',
        title: '2026',
        detail: null,
        tiles: [
          expect.objectContaining({
            key: 'season-2026-summer',
            opens: {
              achievementScope: AchievementScope.Season,
              seasonId: 'season-2026-summer',
            },
            medal: expect.objectContaining({
              title: 'Лято 2026',
              caption: '1.06 – 31.08',
              level: 'III',
            }),
          }),
        ],
      },
    ]);
  });

  it('draws an archived event without a track by its emblem and its count, and leaves out windows he never joined', () => {
    const later: AchievementsData = {
      ...GEORGI,
      today: localDate('2027-01-15'),
    };
    const keys = (data: AchievementsData) =>
      scopePageVm(
        data,
        { achievementScope: AchievementScope.Archive },
        SETTLED,
      )?.sections.flatMap((s) => s.tiles.map((t) => t.key));
    expect(keys(later)).toEqual(['season-2026-autumn', 'season-2026-summer']);

    const progress = new Map(later.progress);
    progress.set(BadgeSeriesId.of('series-2026-beard-week-beard'), {
      id: BadgeSeriesId.of('series-2026-beard-week-beard'),
      value: 1,
      earned: [
        {
          level: 1,
          // 11:00 in Sofia, written with its shop day (T5).
          earnedAtUtcMs: utcMs('2026-09-30T08:00:00.000Z'),
          earnedLocalDate: localDate('2026-09-30'),
          earnedVia: EarnedVia.Rule,
          count: 1,
        },
      ],
    });
    const joined: AchievementsData = { ...later, progress };
    const tiles = scopePageVm(
      joined,
      { achievementScope: AchievementScope.Archive },
      SETTLED,
    )?.sections.flatMap((s) => s.tiles);
    expect(tiles?.map((tile) => tile.key)).toEqual([
      'season-2026-autumn',
      'event-2026-beard-week',
      'season-2026-summer',
    ]);
    expect(tiles?.[1]).toMatchObject({
      opens: {
        achievementScope: AchievementScope.Season,
        seasonId: 'event-2026-beard-week',
      },
      medal: {
        icon: 'loyalty.badge.event',
        level: null,
        state: 'earned',
        title: 'Седмица на брадата',
        // `Intl`'s own range, not post-processed: one year, at the end,
        // behind its narrow no-break space.
        caption: '22.09 – 5.10.2026\u202fг.',
        accessibleName: 'Седмица на брадата, 1 от 2, 22.09 – 5.10.2026\u202fг.',
      },
    });
  });

  it('lists the families earned on one day', () => {
    const page = scopePageVm(
      GEORGI,
      { achievementScope: AchievementScope.Day, day: localDate('2026-09-28') },
      SETTLED,
    );
    expect(page?.title).toBe('Спечелени на 28.09');
    expect(page?.sections[0]?.tiles.map((tile) => tile.key)).toEqual([
      'series-rhythm',
      'series-2026-autumn-track',
      'series-2026-autumn-early',
    ]);
  });

  it('has no page for a scope the catalogue lacks', () => {
    expect(
      scopePageVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-gone'),
        },
        SETTLED,
      ),
    ).toBeNull();
    expect(
      scopePageVm(
        GEORGI,
        {
          achievementScope: AchievementScope.Season,
          seasonId: SeasonId.of('season-gone'),
        },
        SETTLED,
      ),
    ).toBeNull();
    expect(
      scopeTitleOf(
        GEORGI,
        {
          achievementScope: AchievementScope.Category,
          categoryId: BadgeCategoryId.of('cat-gone'),
        },
        SETTLED.words,
      ),
    ).toBeNull();
  });
});
