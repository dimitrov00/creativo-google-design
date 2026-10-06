import { describe, expect, it } from 'vitest';
import {
  type ActivityEntry,
  type BadgeProgress,
  type LoyaltyCatalog,
  type StreakState,
  StreakDefinition,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  closestLevels,
  earnedLevelCount,
  familyCounts,
  levelNumeral,
  recentLevelsByDay,
} from '@creativo/domain/engagement';
import { type LoyaltyAccountFixture, loyaltyFixtures } from '../../testing';
import {
  ACTIVITY_EFFECT_KINDS,
  BADGE_PROGRESS_COLLECTION,
  type BadgeSeriesDocument,
  CLIENT_JOURNAL_COLLECTION,
  type JournalEffectDocument,
  LOYALTY_ACCOUNTS_COLLECTION,
  LOYALTY_CATALOG_COLLECTIONS,
  SEASON_PROGRESS_COLLECTION,
  STREAK_DEFINITIONS_COLLECTION,
  STREAK_DEFINITION_VERSIONS_COLLECTION,
  type StreakDefinitionVersionRecord,
  activityEntryFromDocument,
  badgeCategoryFromDocument,
  badgeProgressFromDocument,
  badgeSeriesFromDocument,
  clientJournalEntryId,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  rewardCatalogItemFromDocument,
  seasonFromDocument,
  seasonProgressFromDocument,
  streakDefinitionToDocument,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionId,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
  streakStateToDocument,
  tierDefinitionFromDocument,
} from './loyalty-document';

describe('clientJournalEntryId', () => {
  it('names the client, then the sequence padded to six digits', () => {
    expect(clientJournalEntryId('dev-client-1', 7)).toBe('dev-client-1_000007');
    expect(clientJournalEntryId('dev-client-1', 123456)).toBe(
      'dev-client-1_123456',
    );
  });

  // Padding is what makes a document-id order the ledger's order.
  it('sorts as the sequence does', () => {
    const ids = [2, 10, 1, 100].map((seq) => clientJournalEntryId('u', seq));
    expect([...ids].sort()).toEqual([
      'u_000001',
      'u_000002',
      'u_000010',
      'u_000100',
    ]);
  });
});

describe('streakDefinitionVersionId', () => {
  it('pads the version to six digits, so the history sorts by document id', () => {
    expect(streakDefinitionVersionId(3)).toBe('000003');
    expect(streakDefinitionVersionId(123456)).toBe('123456');
    expect([2, 10, 1, 100].map(streakDefinitionVersionId).sort()).toEqual([
      '000001',
      '000002',
      '000010',
      '000100',
    ]);
  });
});

describe('the loyalty collections', () => {
  it('lists the six catalogue collections, none of them per client', () => {
    expect(LOYALTY_CATALOG_COLLECTIONS).toEqual([
      'badgeCategories',
      'badgeSeries',
      'seasons',
      'tierDefinitions',
      'rewardsCatalog',
      'streakDefinitions',
    ]);
    expect(LOYALTY_CATALOG_COLLECTIONS).not.toContain(
      LOYALTY_ACCOUNTS_COLLECTION,
    );
    expect(LOYALTY_CATALOG_COLLECTIONS).not.toContain(
      CLIENT_JOURNAL_COLLECTION,
    );
  });

  // The history is the admin page's: a card that loads the catalogue
  // never reads it, and the rules refuse it to the book.
  it('keeps a rule’s versions under its head, outside the catalogue', () => {
    expect(STREAK_DEFINITIONS_COLLECTION).toBe('streakDefinitions');
    expect(STREAK_DEFINITION_VERSIONS_COLLECTION).toBe('versions');
    expect(LOYALTY_CATALOG_COLLECTIONS).not.toContain(
      STREAK_DEFINITION_VERSIONS_COLLECTION,
    );
  });

  it('keeps the per-client collections apart from the catalogue', () => {
    expect([
      LOYALTY_ACCOUNTS_COLLECTION,
      BADGE_PROGRESS_COLLECTION,
      SEASON_PROGRESS_COLLECTION,
      CLIENT_JOURNAL_COLLECTION,
    ]).toEqual([
      'loyaltyAccounts',
      'badgeProgress',
      'seasonProgress',
      'clientJournal',
    ]);
  });
});

// ── Reading: the fixtures are the wire, so every one of them must parse ──

const { catalog: catalogDocs, today } = loyaltyFixtures;

/** An unfrozen copy of a fixture document, changed by `edit` — for the refusals. */
function edited<T>(
  doc: T,
  edit: (copy: Record<string, unknown>) => void,
): unknown {
  const copy = structuredClone(doc) as Record<string, unknown>;
  edit(copy);
  return copy;
}

function parsedCatalog(): LoyaltyCatalog {
  const result = loyaltyCatalogFromDocuments(catalogDocs);
  if (result.isFailure()) throw result.error;
  return result.value;
}

function progressOf(
  fixture: LoyaltyAccountFixture,
): Map<string, BadgeProgress> {
  return new Map(
    Object.entries(fixture.badgeProgress).map(([id, doc]) => {
      const parsed = badgeProgressFromDocument(id, doc);
      if (parsed.isFailure()) throw parsed.error;
      return [id, parsed.value];
    }),
  );
}

/** Entry `i` of a copied document's list, to edit in place. */
function nth(list: unknown, i: number): Record<string, unknown> {
  const entry: unknown = Array.isArray(list) ? list.at(i) : undefined;
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`fixture: no entry ${i}`);
  }
  return entry as Record<string, unknown>;
}

const isObject = (raw: unknown): raw is object =>
  raw !== null && typeof raw === 'object';

/** Field `key` of a copied document's map, to edit in place. */
function field(map: unknown, key: string): Record<string, unknown> {
  const entry = isObject(map)
    ? new Map(Object.entries(map)).get(key)
    : undefined;
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`fixture: no ${key}`);
  }
  return entry as Record<string, unknown>;
}

/** The error a failed read carries, as text a case can match. */
function refusal(result: { isFailure(): boolean; error?: unknown }): string {
  expect(result.isFailure()).toBe(true);
  return result.isFailure() && result.error instanceof Error
    ? result.error.message
    : '';
}

describe('reading the catalogue fixture', () => {
  const catalog = parsedCatalog();

  it('reads every collection into one validated catalogue (§4.6’s sizes)', () => {
    expect(catalog.categories).toHaveLength(6);
    expect(catalog.families).toHaveLength(42);
    expect(catalog.seasons).toHaveLength(3);
    expect(catalog.tiers).toHaveLength(4);
    expect(catalog.rewards).toHaveLength(3);
    expect(catalog.streakSchedules).toHaveLength(1);
    expect(catalog.categories.map((c) => c.id.value)).toEqual([
      'cat-milestones',
      'cat-mastery',
      'cat-barbers',
      'cat-rhythm',
      'cat-special',
      'cat-records',
    ]);
  });

  it('types a family’s ids, its subject and its narrowing', () => {
    const fade = catalog.series('series-svc-fade');
    expect(fade?.categoryId?.value).toBe('cat-mastery');
    expect(fade?.subject?.kind).toBe('service');
    expect(fade?.metric?.where?.serviceId?.value).toBe('svc-fade');
    expect(fade?.title.get('bg')).toBe('Фейд');
    expect(fade?.levels.map((l) => l.target)).toEqual([3, 10, 25, 50, 100]);
  });

  it('keeps what each level pays', () => {
    const visits = catalog.series('series-visits');
    expect(visits?.levelAt(1)?.awards).toEqual([]);
    expect(visits?.levelAt(2)?.awards).toEqual([
      { kind: 'points', points: 20 },
    ]);
  });

  it('reads the rhythm family: no metric, numbered targets', () => {
    const rhythm = catalog.series('series-rhythm');
    expect(rhythm?.metric).toBeNull();
    expect(rhythm?.levels.map((l) => l.target)).toEqual([3, 6, 12, 18, 24]);
  });

  it('reads tenure as calendar-driven and a one-off as its only level', () => {
    expect(catalog.series('series-tenure')?.isCalendarDriven()).toBe(true);
    expect(catalog.series('series-welcome')?.levels).toHaveLength(1);
    expect(catalog.series('series-welcome')?.levelAt(1)?.target).toBeNull();
    expect(catalog.series('series-birthday')?.repeatable).toBe(true);
  });

  it('dates the seasons: one ended, one season and one event running on the fixtures’ today', () => {
    expect(catalog.seasonsIn('ended', today).map((s) => s.id.value)).toEqual([
      'season-2026-summer',
    ]);
    expect(catalog.seasonsIn('open', today).map((s) => s.id.value)).toEqual([
      'season-2026-autumn',
      'event-2026-beard-week',
    ]);
    const autumn = catalog.season('season-2026-autumn');
    expect(autumn?.trackSeriesId?.value).toBe('series-2026-autumn-track');
    expect(autumn?.announcedAt).toEqual(new Date('2026-08-01T06:00:00.000Z'));
  });

  it('reads tiers, rewards and the rhythm’s rules', () => {
    expect(catalog.tiers.map((t) => `${t.id}@${t.qualify.atLeast}`)).toEqual([
      'bronze@0',
      'silver@6',
      'gold@12',
      'platinum@20',
    ]);
    expect(catalog.tier('gold')?.name.get('bg')).toBe('Злато');
    expect(catalog.tier('gold')?.effectiveFrom).toBeInstanceOf(Date);
    const beard = catalog.rewards[0];
    expect(beard).toMatchObject({
      id: 'reward-beard',
      cost: 120,
      grants: { kind: 'coupon', couponId: 'coupon-free-beard' },
      limits: { perClient: { count: 1, windowDays: 30 }, total: null },
    });
    const rule = catalog.streakInForce('cadence', today);
    expect(rule?.equals(StreakDefinition.default())).toBe(true);
    expect(rule?.interval.toProps()).toEqual({ kind: 'fixed', days: 42 });
    expect(rule?.excuses).toEqual([
      'shopClosure',
      'barberAbsence',
      'staffCancelled',
    ]);
    expect(catalog.streakSchedule('cadence')?.upcomingOn(today)).toBeNull();
  });

  it('reads each catalogue document on its own, too', () => {
    const readers = {
      badgeCategories: badgeCategoryFromDocument,
      badgeSeries: badgeSeriesFromDocument,
      seasons: seasonFromDocument,
      tierDefinitions: tierDefinitionFromDocument,
      rewardsCatalog: rewardCatalogItemFromDocument,
      streakDefinitions: streakScheduleFromDocument,
    } as const;
    for (const [collection, read] of Object.entries(readers)) {
      const documents = new Map(Object.entries(catalogDocs)).get(collection);
      for (const [id, doc] of Object.entries(documents ?? {})) {
        expect(read(id, doc).isSuccess(), `${collection}/${id}`).toBe(true);
      }
    }
    expect(Object.keys(readers)).toEqual([...LOYALTY_CATALOG_COLLECTIONS]);
  });
});

describe.each([
  ['Георги', 'dev-client-1', loyaltyFixtures.georgi, 37],
  ['Мартин', 'dev-client-2', loyaltyFixtures.martin, 28],
] as const)(
  'reading the account fixture of %s',
  (_name, userId, fixture: LoyaltyAccountFixture, levels) => {
    it('reads the account whole', () => {
      const result = loyaltyAccountFromDocument(userId, fixture.account);
      if (result.isFailure()) throw result.error;
      const account = result.value;
      expect(account.userId).toBe(userId);
      expect(account.balance).toBe(fixture.account.balance);
      expect(account.balance).toBe(
        account.lifetimeEarned +
          account.lifetimeAdjusted -
          account.lifetimeSpent,
      );
      expect(account.tier.current).toBe(fixture.account.tier.current);
      expect(account.tier.since).toBeInstanceOf(Date);
      expect(account.streaks['cadence']?.phase).toEqual(
        fixture.account.streaks['cadence']?.phase,
      );
      expect(account.streaks['cadence']?.period).toEqual({
        intervalDays: 42,
        graceDays: 7,
        source: 'fixed',
        habitDays: null,
      });
      expect(account.punchCards[0]?.title.get('bg')).toBe(
        'Безплатно подстригване',
      );
      expect(account.records.map((r) => r.kind)).toEqual([
        'longestRhythm',
        'mostVisitsInYear',
        'favouriteService',
        'firstVisit',
      ]);
      expect(account.updatedAt.toISOString()).toBe(fixture.account.updatedAt);
    });

    it(`reads every family’s progress: ${levels} levels earned`, () => {
      const progress = progressOf(fixture);
      expect(progress.size).toBe(Object.keys(fixture.badgeProgress).length);
      expect(earnedLevelCount(progress)).toBe(levels);
      for (const p of progress.values()) {
        expect(p.earned.every((e) => e.earnedAt instanceof Date)).toBe(true);
      }
    });

    it('reads every season’s track', () => {
      for (const [id, doc] of Object.entries(fixture.seasonProgress)) {
        const parsed = seasonProgressFromDocument(id, doc);
        expect(parsed.isSuccess() && parsed.value).toEqual({
          seasonId: id,
          ...doc,
        });
      }
    });

    it('reads every journal row as a ledger row that adds up to the balance', () => {
      const rows = Object.entries(fixture.clientJournal).map(([id, doc]) => {
        const parsed = ledgerEntryFromDocument(id, doc);
        if (parsed.isFailure()) throw parsed.error;
        return parsed.value;
      });
      expect(rows.reduce((sum, row) => sum + row.delta, 0)).toBe(
        fixture.account.balance,
      );
      expect(rows.at(-1)?.id).toBe(clientJournalEntryId(userId, rows.length));
      expect(rows.some((row) => row.delta < 0)).toBe(true);
    });
  },
);

describe('the standing, on the seeded story (§4.6)', () => {
  const catalog = parsedCatalog();
  const worded = (progress: ReadonlyMap<string, BadgeProgress>) =>
    closestLevels(catalog, progress, today, 8).map(
      (c) =>
        `${catalog.series(c.seriesId)?.title.get('bg')} ${levelNumeral(c.level)} ${c.value}/${c.target}`,
    );

  it('Георги: «Фейд III» leads «Скоро», the four families it would finish with it yielding', () => {
    expect(worded(progressOf(loyaltyFixtures.georgi))).toEqual([
      'Фейд III 24/25',
      'Онлайн записване III 7/10',
      'Съботен I 2/3',
      'Есен 2026 III 2/3',
      'При всеки бръснар I 1/2',
      'Брада на седмицата I 0/1',
    ]);
  });

  it('Мартин: «Цяла година III» leads; an unstarted service never evicts «С Иван III»', () => {
    expect(worded(progressOf(loyaltyFixtures.martin))).toEqual([
      'Цяла година III 9/12',
      'С Иван III 7/10',
      'Съботен I 2/3',
      'Класическа подстрижка III 13/25',
      'Онлайн записване IV 10/25',
      'Есен 2026 I 0/1',
      'Брада на седмицата I 0/1',
    ]);
  });

  it('Георги: today’s levels are one rail item', () => {
    const days = recentLevelsByDay(progressOf(loyaltyFixtures.georgi), 3);
    expect(
      days.map(
        (d) =>
          `${d.day}: ${d.levels
            .map(
              (l) =>
                `${catalog.series(l.seriesId)?.title.get('bg')} ${levelNumeral(l.level)}`,
            )
            .join(', ')}`,
      ),
    ).toEqual([
      '2026-09-28: В ритъм V, Есен 2026 II, Есенно утро I',
      '2026-09-03: Есен 2026 I',
      '2026-08-06: Лято 2026 III, Всеки летен месец I',
    ]);
  });

  it('counts the shelves in families, earned and started of total', () => {
    const progress = progressOf(loyaltyFixtures.georgi);
    const counts = catalog.categories.map((c) => {
      const { started, earned, total } = familyCounts(
        catalog,
        progress,
        { kind: 'category', categoryId: c.id.value },
        today,
      );
      return `${c.title.get('bg')} ${earned}/${total} (${started})`;
    });
    expect(counts).toEqual([
      'Етапи 3/5 (3)',
      'Майсторство 3/9 (3)',
      'Бръснари и салони 2/7 (4)',
      'Ритъм 2/3 (2)',
      'Специални 3/7 (4)',
      'Рекорди 0/0 (0)',
    ]);
    expect(familyCounts(catalog, progress, { kind: 'archive' }, today)).toEqual(
      {
        started: 2,
        earned: 2,
        total: 4,
      },
    );
    expect(
      familyCounts(catalog, progress, { kind: 'day', day: today }, today),
    ).toEqual({ started: 3, earned: 3, total: 3 });
  });
});

// ── Refusals: a malformed document is refused, naming what broke ────────

describe('refusing malformed catalogue documents', () => {
  const series = catalogDocs.badgeSeries[
    'series-svc-fade'
  ] as BadgeSeriesDocument;
  const category = catalogDocs.badgeCategories['cat-mastery'];
  const season = catalogDocs.seasons['season-2026-autumn'];
  const tier = catalogDocs.tierDefinitions['gold'];
  const reward = catalogDocs.rewardsCatalog['reward-beard'];
  const streak: unknown = catalogDocs.streakDefinitions['cadence'];

  it.each([null, undefined, [], 'badge', 7])(
    'refuses %j as a document',
    (raw) => {
      expect(refusal(badgeCategoryFromDocument('cat-x', raw))).toBe(
        'Malformed badgeCategories/cat-x',
      );
    },
  );

  it('refuses a category of an unknown kind, or with one locale', () => {
    expect(
      refusal(
        badgeCategoryFromDocument(
          'cat-mastery',
          edited(category, (c) => (c['kind'] = 'weapons')),
        ),
      ),
    ).toBe('Malformed badgeCategories/cat-mastery.kind');
    expect(
      refusal(
        badgeCategoryFromDocument(
          'cat-mastery',
          edited(category, (c) => (c['title'] = { bg: 'Майсторство' })),
        ),
      ),
    ).toBe('Malformed badgeCategories/cat-mastery.title');
  });

  it('passes on what the domain refuses, by code', () => {
    expect(
      refusal(
        badgeCategoryFromDocument(
          'cat-mastery',
          edited(category, (c) => (c['order'] = -1)),
        ),
      ),
    ).toBe('Malformed badgeCategories/cat-mastery.order');
    expect(
      refusal(
        badgeCategoryFromDocument(
          'cat-mastery',
          edited(category, (c) => (c['title'] = { bg: ' ', en: 'Mastery' })),
        ),
      ),
    ).toBe(
      'Malformed badgeCategories/cat-mastery: catalog.localized_text.field_empty',
    );
    const gap = edited(series, (s) => {
      nth(s['levels'], 2)['level'] = 7;
    });
    expect(refusal(badgeSeriesFromDocument('series-svc-fade', gap))).toBe(
      'Malformed badgeSeries/series-svc-fade: engagement.badge_series.level_gap',
    );
  });

  it.each<[string, (s: Record<string, unknown>) => void, string]>([
    ['an unknown emblem', (s) => (s['emblem'] = 'sword'), 'emblem'],
    [
      'a null window (absent, never null)',
      (s) => ((s['metric'] as Record<string, unknown>)['window'] = null),
      'metric.window',
    ],
    [
      'an unknown metric',
      (s) =>
        ((s['metric'] as Record<string, unknown>)['metric'] =
          'client.haircuts'),
      'metric.metric',
    ],
    [
      'a target in words',
      (s) => (nth(s['levels'], 0)['target'] = 'three'),
      'levels[0].target',
    ],
    [
      'a Timestamp for an instant',
      (s) => (s['retiredAt'] = { seconds: 1, nanoseconds: 0 }),
      'retiredAt',
    ],
    [
      'a level without awards',
      (s) => delete nth(s['levels'], 1)['awards'],
      'levels[1].awards',
    ],
    [
      'an award of an unknown kind',
      (s) => (nth(s['levels'], 0)['awards'] = [{ kind: 'hug' }]),
      'levels[0].awards[0].kind',
    ],
  ])('refuses a family with %s', (_case, edit, field) => {
    expect(
      refusal(badgeSeriesFromDocument('series-svc-fade', edited(series, edit))),
    ).toBe(`Malformed badgeSeries/series-svc-fade.${field}`);
  });

  it('refuses a season whose dates are not days, or whose instant is not UTC', () => {
    expect(
      refusal(
        seasonFromDocument(
          'season-2026-autumn',
          edited(
            season,
            (s) => (s['window'] = { from: '2026-09-31', until: '2026-11-30' }),
          ),
        ),
      ),
    ).toBe('Malformed seasons/season-2026-autumn.window.from');
    expect(
      refusal(
        seasonFromDocument(
          'season-2026-autumn',
          edited(
            season,
            (s) => (s['announcedAt'] = '2026-08-01T09:00:00+03:00'),
          ),
        ),
      ),
    ).toBe('Malformed seasons/season-2026-autumn.announcedAt');
  });

  it('refuses a tier, a reward and a rhythm with a broken field', () => {
    expect(
      refusal(
        tierDefinitionFromDocument(
          'gold',
          edited(tier, (t) => (t['benefits'] = ['perk.free'])),
        ),
      ),
    ).toBe('Malformed tierDefinitions/gold.benefits[0]');
    expect(
      refusal(
        rewardCatalogItemFromDocument(
          'reward-beard',
          edited(reward, (r) => (r['grants'] = { kind: 'cash' })),
        ),
      ),
    ).toBe('Malformed rewardsCatalog/reward-beard.grants.kind');
    expect(
      refusal(
        streakScheduleFromDocument(
          'cadence',
          edited(
            streak,
            (s) =>
              (field(s, 'current')['interval'] = { kind: 'monthly', every: 1 }),
          ),
        ),
      ),
    ).toBe('Malformed streakDefinitions/cadence.current.interval.kind');
  });

  it('leaves a reward’s price to the catalogue, which refuses one that costs nothing', () => {
    const free = edited(reward, (r) => (r['cost'] = 0));
    expect(
      rewardCatalogItemFromDocument('reward-beard', free).isSuccess(),
    ).toBe(true);
    expect(
      refusal(
        loyaltyCatalogFromDocuments({
          ...catalogDocs,
          rewardsCatalog: {
            ...catalogDocs.rewardsCatalog,
            'reward-beard': free,
          },
        }),
      ),
    ).toBe(
      'Inconsistent loyalty catalogue: engagement.loyalty_catalog.cost_not_positive',
    );
  });

  it('fails the whole catalogue on one malformed or dangling document', () => {
    expect(
      refusal(
        loyaltyCatalogFromDocuments({
          ...catalogDocs,
          badgeSeries: {
            ...catalogDocs.badgeSeries,
            'series-svc-fade': edited(series, (s) => (s['emblem'] = 'sword')),
          },
        }),
      ),
    ).toBe('Malformed badgeSeries/series-svc-fade.emblem');
    const withoutOne = Object.fromEntries(
      Object.entries(catalogDocs.badgeSeries).filter(
        ([id]) => id !== 'series-2026-autumn-beard',
      ),
    );
    expect(
      refusal(
        loyaltyCatalogFromDocuments({
          ...catalogDocs,
          badgeSeries: withoutOne,
        }),
      ),
    ).toBe(
      'Inconsistent loyalty catalogue: engagement.loyalty_catalog.dangling_season',
    );
  });
});

describe('refusing malformed per-client documents', () => {
  const { account, badgeProgress, seasonProgress, clientJournal } =
    loyaltyFixtures.georgi;
  const progress = badgeProgress['series-svc-fade'];
  const track = seasonProgress['season-2026-autumn'];
  const row = clientJournal['dev-client-1_000001'];

  it('refuses an account body naming someone else — the document id is the client', () => {
    expect(refusal(loyaltyAccountFromDocument('dev-client-2', account))).toBe(
      'Malformed loyaltyAccounts/dev-client-2.userId',
    );
  });

  it.each<[string, (a: Record<string, unknown>) => void, string]>([
    ['a fractional balance', (a) => (a['balance'] = 358.5), 'balance'],
    [
      'an unknown rhythm phase',
      (a) => (field(a['streaks'], 'cadence')['phase'] = { kind: 'lost' }),
      'streaks.cadence.phase.kind',
    ],
    [
      'a record of an unknown kind',
      (a) => (nth(a['records'], 0)['kind'] = 'fastest'),
      'records[0].kind',
    ],
    [
      'a tier override from nowhere',
      (a) =>
        ((a['tier'] as Record<string, unknown>)['override'] = {
          tierId: 'platinum',
          until: null,
          source: { kind: 'luck' },
        }),
      'tier.override.source.kind',
    ],
  ])('refuses an account with %s', (_case, edit, field) => {
    expect(
      refusal(
        loyaltyAccountFromDocument('dev-client-1', edited(account, edit)),
      ),
    ).toBe(`Malformed loyaltyAccounts/dev-client-1.${field}`);
  });

  it('keeps an owed balance: negative only through a correction, never clamped', () => {
    const owed = loyaltyAccountFromDocument(
      'dev-client-1',
      edited(account, (a) => (a['balance'] = -40)),
    );
    expect(owed.isSuccess() && owed.value.balance).toBe(-40);
  });

  it('refuses progress whose levels are not each once, lowest first', () => {
    expect(
      refusal(
        badgeProgressFromDocument(
          'series-svc-fade',
          edited(
            progress,
            (p) => (p['earned'] = [...(p['earned'] as unknown[])].reverse()),
          ),
        ),
      ),
    ).toBe('Malformed badgeProgress/series-svc-fade.earned');
    expect(
      refusal(
        badgeProgressFromDocument(
          'series-svc-fade',
          edited(progress, (p) => (nth(p['earned'], 0)['via'] = 'magic')),
        ),
      ),
    ).toBe('Malformed badgeProgress/series-svc-fade.earned[0].via');
  });

  it('refuses a season track below zero', () => {
    expect(
      refusal(
        seasonProgressFromDocument(
          'season-2026-autumn',
          edited(track, (t) => (t['trackLevel'] = -1)),
        ),
      ),
    ).toBe('Malformed seasonProgress/season-2026-autumn.trackLevel');
  });

  it('reads only a client-visible point row as a ledger row', () => {
    const id = 'dev-client-1_000001';
    expect(
      refusal(
        ledgerEntryFromDocument(
          id,
          edited(row, (r) => (r['visibility'] = 'staff')),
        ),
      ),
    ).toBe(`Malformed clientJournal/${id}.visibility`);
    expect(
      refusal(
        ledgerEntryFromDocument(
          id,
          edited(
            row,
            (r) =>
              (r['effect'] = {
                kind: 'freeze',
                streakId: 'cadence',
                op: 'earned',
                count: 1,
                bankedAfter: 1,
              }),
          ),
        ),
      ),
    ).toBe(`Malformed clientJournal/${id}.effect.kind`);
  });

  it('refuses a row whose label is not a known key with plain params', () => {
    const id = 'dev-client-1_000001';
    expect(
      refusal(
        ledgerEntryFromDocument(
          id,
          edited(
            row,
            (r) =>
              ((r['publicLabel'] as Record<string, unknown>)['code'] =
                'points.gift'),
          ),
        ),
      ),
    ).toBe(`Malformed clientJournal/${id}.publicLabel.code`);
    expect(
      refusal(
        ledgerEntryFromDocument(
          id,
          edited(
            row,
            (r) =>
              ((r['publicLabel'] as Record<string, unknown>)['params'] = {
                who: { name: 'Георги' },
              }),
          ),
        ),
      ),
    ).toBe(`Malformed clientJournal/${id}.publicLabel.params.who`);
  });
});

// ── The rhythm's rule: the head, its versions, the bridge ───────────────

/** `streakDefinitions/cadence` as the fixtures hold it. */
const head: unknown = catalogDocs.streakDefinitions['cadence'];
const NAME = { bg: 'Посещения в ритъм', en: 'Visits in rhythm' };
const PUBLISHED = new Date('2025-03-01T07:00:00.000Z');

/** The recommended rule with `patch` over it. */
function ruleWith(patch: Partial<StreakDefinitionProps>): StreakDefinition {
  const built = StreakDefinition.create({
    ...StreakDefinition.default().toProps(),
    ...patch,
  });
  if (built.isFailure()) {
    throw new Error(built.error.map((e) => e.code).join(', '));
  }
  return built.value;
}

/** A rule that uses every arm the recommended one does not. */
const PERSONAL = ruleWith({
  version: 2,
  effectiveFrom: '2026-10-01',
  qualifier: { kind: 'services', serviceIds: ['svc-fade', 'svc-classic-cut'] },
  minGapDays: 3,
  bookingHold: { enabled: false, maxDaysPastDue: 0 },
  interval: {
    kind: 'personal',
    tolerancePct: 50,
    minDays: 21,
    maxDays: 70,
    fallbackDays: 35,
  },
  graceDays: 10,
  riskLeadDays: 3,
  protections: { enabled: true, maxBanked: 3, earnEvery: 4, startWith: 1 },
  excuses: ['shopClosure', 'barberAbsence', 'staffCancelled', 'closedDays'],
  clientPause: { enabled: true, maxDaysPerYear: 60 },
  repair: { enabled: false, windowDays: 21, perYear: 2 },
  onBreak: 'hold',
});

const BY_CATEGORY = ruleWith({
  qualifier: { kind: 'categories', categoryIds: ['cat-hair'] },
  enabled: false,
});

function scheduleOf(
  current: StreakDefinition,
  scheduled: StreakDefinition | null = null,
): StreakDefinitionSchedule {
  const built = StreakDefinitionSchedule.create({
    current,
    scheduled:
      scheduled === null
        ? null
        : { definition: scheduled, transition: 'grandfather' },
  });
  if (built.isFailure()) {
    throw new Error(built.error.map((e) => e.code).join(', '));
  }
  return built.value;
}

function readSchedule(data: unknown): StreakDefinitionSchedule {
  const read = streakScheduleFromDocument('cadence', data);
  if (read.isFailure()) throw read.error;
  return read.value;
}

describe('reading the rhythm’s head', () => {
  it('reads the fixture as the recommended rule in force, nothing scheduled', () => {
    const schedule = readSchedule(head);
    expect(schedule.id).toBe('cadence');
    expect(schedule.current.equals(StreakDefinition.default())).toBe(true);
    expect(schedule.current.name.get('bg')).toBe('Посещения в ритъм');
    expect(schedule.current.effectiveFrom).toBe('2025-03-01');
    expect(schedule.scheduled).toBeNull();
  });

  it('writes the head back exactly as the fixture holds it', () => {
    expect(streakScheduleToDocument(readSchedule(head), PUBLISHED)).toEqual(
      head,
    );
  });

  it('writes a body that names neither the rule nor itself: the id is the document’s, the name the head’s', () => {
    expect(
      Object.keys(streakDefinitionToDocument(StreakDefinition.default())),
    ).toEqual([
      'version',
      'effectiveFrom',
      'enabled',
      'qualifier',
      'minGapDays',
      'bookingHold',
      'interval',
      'graceDays',
      'riskLeadDays',
      'protections',
      'excuses',
      'clientPause',
      'repair',
      'onBreak',
    ]);
  });

  it.each([
    ['the recommended rule', StreakDefinition.default()],
    ['a personal interval, a list of services, a miss that holds', PERSONAL],
    ['a list of categories, switched off', BY_CATEGORY],
  ])(
    'round-trips %s through the factories to an EQUAL rule',
    (_case, definition) => {
      const body = streakDefinitionToDocument(definition);
      // The wire is JSON: what is written is what a read is handed.
      const written: unknown = JSON.parse(
        JSON.stringify({
          name: NAME,
          current: body,
          scheduled: null,
          updatedAt: PUBLISHED.toISOString(),
        }),
      );
      const { current } = readSchedule(written);
      expect(current.equals(definition)).toBe(true);
      expect(current.toProps()).toEqual(definition.toProps());
      expect(streakDefinitionToDocument(current)).toEqual(body);
    },
  );

  it('reads the version that waits, and resolves the rule in force BY DATE', () => {
    const written = streakScheduleToDocument(
      scheduleOf(StreakDefinition.default(), PERSONAL),
      new Date('2026-09-28T09:12:00.000Z'),
    );
    expect(written.scheduled).toEqual({
      ...streakDefinitionToDocument(PERSONAL),
      transition: 'grandfather',
    });
    expect(written.updatedAt).toBe('2026-09-28T09:12:00.000Z');

    const schedule = readSchedule(written);
    expect(schedule.upcomingOn(today)?.transition).toBe('grandfather');
    expect(schedule.upcomingOn(today)?.definition.equals(PERSONAL)).toBe(true);
    expect(schedule.inForceOn('2026-09-30').version).toBe(1);
    expect(schedule.inForceOn('2026-10-01').equals(PERSONAL)).toBe(true);
    expect(schedule.upcomingOn('2026-10-01')).toBeNull();
  });

  // A document round-trips to an EQUAL rule, not to the same array order:
  // the rule keeps its excuses in the vocabulary's order, each once.
  it('reads excuses in any order, and hands them back in the rule’s', () => {
    const shuffled = edited(head, (h) => {
      field(h, 'current')['excuses'] = [
        'staffCancelled',
        'closedDays',
        'shopClosure',
      ];
    });
    expect(readSchedule(shuffled).current.excuses).toEqual([
      'shopClosure',
      'staffCancelled',
      'closedDays',
    ]);
  });

  it('reads a head with a version that waits into a catalogue that resolves the rule by date', () => {
    const shorter = ruleWith({
      version: 2,
      effectiveFrom: '2026-10-01',
      interval: { kind: 'fixed', days: 35 },
    });
    const written = streakScheduleToDocument(
      scheduleOf(StreakDefinition.default(), shorter),
      PUBLISHED,
    );
    const catalog = loyaltyCatalogFromDocuments({
      ...catalogDocs,
      streakDefinitions: { cadence: written },
    });
    if (catalog.isFailure()) throw catalog.error;
    const on = (day: string) => {
      const rule = catalog.value.streakInForce('cadence', day);
      return `v${rule?.version}: ${rule?.interval.daysFor(null).days}`;
    };
    expect(on('2026-09-30')).toBe('v1: 42');
    expect(on('2026-10-01')).toBe('v2: 35');
    expect(
      catalog.value.streakSchedule('cadence')?.scheduled?.definition.version,
    ).toBe(2);
  });
});

describe('refusing a malformed head', () => {
  const current = (h: Record<string, unknown>) => field(h, 'current');

  it.each<[string, (h: Record<string, unknown>) => void, string]>([
    ['no name', (h) => delete h['name'], 'name'],
    ['no version in force', (h) => delete h['current'], 'current'],
    [
      'no word on what waits (null, never absent)',
      (h) => delete h['scheduled'],
      'scheduled',
    ],
    [
      'a Timestamp for when it was written',
      (h) => (h['updatedAt'] = { seconds: 1, nanoseconds: 0 }),
      'updatedAt',
    ],
    [
      'an instant for its first day',
      (h) => (current(h)['effectiveFrom'] = '2025-03-01T07:00:00.000Z'),
      'current.effectiveFrom',
    ],
    [
      'a day that does not exist',
      (h) => (current(h)['effectiveFrom'] = '2025-02-30'),
      'current.effectiveFrom',
    ],
    [
      'a version below one',
      (h) => (current(h)['version'] = 0),
      'current.version',
    ],
    [
      'half a day of grace',
      (h) => (current(h)['graceDays'] = 7.5),
      'current.graceDays',
    ],
    [
      'a switch in words',
      (h) => (field(current(h), 'protections')['enabled'] = 'yes'),
      'current.protections.enabled',
    ],
    [
      'a part without its figure',
      (h) => delete field(current(h), 'bookingHold')['maxDaysPastDue'],
      'current.bookingHold.maxDaysPastDue',
    ],
    [
      'an unknown qualifier',
      (h) =>
        (current(h)['qualifier'] = { kind: 'barbers', barberIds: ['ivan'] }),
      'current.qualifier.kind',
    ],
    [
      'a list of services that is not a list',
      (h) => (current(h)['qualifier'] = { kind: 'services' }),
      'current.qualifier.serviceIds',
    ],
    [
      'a blank service in the list',
      (h) =>
        (current(h)['qualifier'] = {
          kind: 'services',
          serviceIds: ['svc-fade', ' '],
        }),
      'current.qualifier.serviceIds[1]',
    ],
    [
      'the calendar cadence, which no rule has',
      (h) =>
        (current(h)['interval'] = {
          kind: 'calendar',
          unit: 'month',
          every: 1,
        }),
      'current.interval.kind',
    ],
    [
      'a personal interval without its floor',
      (h) =>
        (current(h)['interval'] = {
          kind: 'personal',
          tolerancePct: 50,
          maxDays: 70,
          fallbackDays: 42,
        }),
      'current.interval.minDays',
    ],
    [
      'an excuse nobody knows',
      (h) => (current(h)['excuses'] = ['shopClosure', 'rain']),
      'current.excuses[1]',
    ],
    [
      'an unknown answer to a miss',
      (h) => (current(h)['onBreak'] = 'forgive'),
      'current.onBreak',
    ],
    [
      'a version that waits without saying what it does to the runs',
      (h) => (h['scheduled'] = streakDefinitionToDocument(PERSONAL)),
      'scheduled.transition',
    ],
    [
      'a version that waits with an unknown transition',
      (h) =>
        (h['scheduled'] = {
          ...streakDefinitionToDocument(PERSONAL),
          transition: 'forget',
        }),
      'scheduled.transition',
    ],
  ])('refuses a head with %s', (_case, edit, path) => {
    expect(
      refusal(streakScheduleFromDocument('cadence', edited(head, edit))),
    ).toBe(`Malformed streakDefinitions/cadence.${path}`);
  });

  // What the wire cannot say is wrong, the rule can: the reader hands the
  // figures to the factory, and the factory's codes name every fault.
  it.each<[string, (h: Record<string, unknown>) => void, string, string]>([
    [
      'grace beyond its range',
      (h) => (current(h)['graceDays'] = 60),
      'current',
      'engagement.streak_definition.grace_out_of_range',
    ],
    [
      'grace no shorter than the interval',
      (h) => {
        current(h)['interval'] = { kind: 'fixed', days: 14 };
        current(h)['graceDays'] = 14;
      },
      'current',
      'engagement.streak_definition.grace_not_shorter_than_interval',
    ],
    [
      'two faults at once, both named',
      (h) => {
        current(h)['interval'] = { kind: 'fixed', days: 7 };
        field(current(h), 'protections')['maxBanked'] = 9;
      },
      'current',
      'engagement.streak_definition.interval_out_of_range, engagement.streak_definition.protections_out_of_range',
    ],
    [
      'a figure out of range in a part that is switched off',
      (h) =>
        (current(h)['clientPause'] = { enabled: false, maxDaysPerYear: 365 }),
      'current',
      'engagement.streak_definition.client_pause_out_of_range',
    ],
    [
      'a clamp that contradicts itself',
      (h) =>
        (current(h)['interval'] = {
          kind: 'personal',
          tolerancePct: 50,
          minDays: 70,
          maxDays: 21,
          fallbackDays: 42,
        }),
      'current',
      'engagement.streak_definition.clamp_inverted',
    ],
    [
      'a list of services that names none',
      (h) => (current(h)['qualifier'] = { kind: 'services', serviceIds: [] }),
      'current',
      'engagement.streak_definition.qualifier_empty',
    ],
    [
      'a name in one language',
      (h) => (h['name'] = { bg: 'Посещения в ритъм', en: ' ' }),
      'current',
      'engagement.streak_definition.name_empty',
    ],
    [
      'a broken version that waits',
      (h) =>
        (h['scheduled'] = {
          ...streakDefinitionToDocument(PERSONAL),
          riskLeadDays: 40,
          transition: 'grandfather',
        }),
      'scheduled',
      'engagement.streak_definition.risk_lead_out_of_range',
    ],
  ])('passes on what the rule refuses: %s', (_case, edit, part, codes) => {
    expect(
      refusal(streakScheduleFromDocument('cadence', edited(head, edit))),
    ).toBe(`Malformed streakDefinitions/cadence.${part}: ${codes}`);
  });

  it.each<[string, Partial<StreakDefinitionProps>, string]>([
    [
      'does not rise above the one in force',
      { version: 1 },
      'engagement.streak_schedule.version_not_rising',
    ],
    [
      'starts no later than the one in force',
      { effectiveFrom: '2025-03-01' },
      'engagement.streak_schedule.scheduled_not_after_current',
    ],
  ])('refuses a version that waits and %s', (_case, patch, code) => {
    const waiting = {
      ...streakDefinitionToDocument(PERSONAL),
      ...patch,
      transition: 'grandfather',
    };
    expect(
      refusal(
        streakScheduleFromDocument(
          'cadence',
          edited(head, (h) => (h['scheduled'] = waiting)),
        ),
      ),
    ).toBe(`Malformed streakDefinitions/cadence: ${code}`);
  });

  it('fails the whole catalogue on a rule the domain refuses', () => {
    expect(
      refusal(
        loyaltyCatalogFromDocuments({
          ...catalogDocs,
          streakDefinitions: {
            cadence: edited(head, (h) => (current(h)['graceDays'] = 60)),
          },
        }),
      ),
    ).toBe(
      'Malformed streakDefinitions/cadence.current: engagement.streak_definition.grace_out_of_range',
    );
  });

  // What an emulator seeded before revision 3 held. The one round that
  // read it as a head is over: a rule is its head, or it is no rule.
  it('refuses the flat shape of before revision 3: no version in force', () => {
    const flat: unknown = {
      name: NAME,
      version: 1,
      effectiveFrom: '2025-03-01T07:00:00.000Z',
      cadence: { kind: 'rollingDays', days: 42 },
      graceDays: 7,
      riskLeadDays: 7,
      freezes: { maxBanked: 2, earnEvery: 5, autoApply: true },
      repair: { windowDays: 14, perYear: 1 },
      excused: ['shopClosure', 'barberAbsence', 'staffCancelled'],
    };
    expect(refusal(streakScheduleFromDocument('cadence', flat))).toBe(
      'Malformed streakDefinitions/cadence.current',
    );
    expect(
      refusal(
        loyaltyCatalogFromDocuments({
          ...catalogDocs,
          streakDefinitions: { cadence: flat },
        }),
      ),
    ).toBe('Malformed streakDefinitions/cadence.current');
  });
});

describe('a rule’s versions', () => {
  const FIRST: StreakDefinitionVersionRecord = {
    definition: StreakDefinition.default(),
    publishedAt: PUBLISHED,
    publishedBy: 'dev-staff-ivan',
    transition: 'grandfather',
    direction: 'neutral',
    changed: [],
    requestId: 'seed-cadence-000001',
    withdrawnAt: null,
  };
  const SECOND: StreakDefinitionVersionRecord = {
    definition: PERSONAL,
    publishedAt: new Date('2026-09-28T09:12:00.000Z'),
    publishedBy: 'dev-staff-ivan',
    transition: 'grandfather',
    direction: 'mixed',
    changed: PERSONAL.changeFrom(StreakDefinition.default()).changed,
    requestId: '7c1d6c0e-2f0b-4a53-9d51-0f2f1f6f3a10',
    withdrawnAt: new Date('2026-09-29T06:00:00.000Z'),
  };
  const written = streakDefinitionVersionToDocument(SECOND);

  function readVersion(versionId: string, data: unknown) {
    return streakDefinitionVersionFromDocument(
      'cadence',
      versionId,
      data,
      NAME,
    );
  }

  it('writes the body and how it came to be, instants as UTC ISO strings', () => {
    expect(written).toEqual({
      ...streakDefinitionToDocument(PERSONAL),
      publishedAt: '2026-09-28T09:12:00.000Z',
      publishedBy: 'dev-staff-ivan',
      transition: 'grandfather',
      direction: 'mixed',
      changed: [
        'qualifier',
        'minGapDays',
        'bookingHold',
        'interval',
        'graceDays',
        'riskLeadDays',
        'protections',
        'excuses',
        'clientPause',
        'repair',
        'onBreak',
      ],
      requestId: '7c1d6c0e-2f0b-4a53-9d51-0f2f1f6f3a10',
      withdrawnAt: '2026-09-29T06:00:00.000Z',
    });
    expect(streakDefinitionVersionToDocument(FIRST).withdrawnAt).toBeNull();
  });

  it.each([
    ['the first', '000001', FIRST],
    ['one that was withdrawn', '000002', SECOND],
  ])('round-trips %s to an equal record', (_case, versionId, record) => {
    const read = readVersion(
      versionId,
      JSON.parse(JSON.stringify(streakDefinitionVersionToDocument(record))),
    );
    if (read.isFailure()) throw read.error;
    const { definition, ...facts } = read.value;
    const { definition: expected, ...expectedFacts } = record;
    expect(definition.equals(expected)).toBe(true);
    expect(definition.name.get('en')).toBe('Visits in rhythm');
    expect(facts).toEqual(expectedFacts);
  });

  // What every revision changes is no change worth listing.
  it('never writes a version’s identity among what changed', () => {
    expect(
      streakDefinitionVersionToDocument({
        ...SECOND,
        changed: ['id', 'version', 'interval', 'effectiveFrom', 'name'],
      }).changed,
    ).toEqual(['interval', 'name']);
  });

  it('refuses a body numbered otherwise than its document', () => {
    expect(refusal(readVersion('000003', written))).toBe(
      'Malformed streakDefinitions/cadence/versions/000003.version',
    );
    expect(refusal(readVersion('2', written))).toBe(
      'Malformed streakDefinitions/cadence/versions/2.version',
    );
  });

  it.each<[string, (v: Record<string, unknown>) => void, string]>([
    [
      'a direction nobody knows',
      (v) => (v['direction'] = 'kinder'),
      'direction',
    ],
    [
      'a change that lists a version’s identity',
      (v) => (v['changed'] = ['interval', 'version']),
      'changed[1]',
    ],
    ['nobody who published it', (v) => (v['publishedBy'] = ' '), 'publishedBy'],
    [
      'a Timestamp for when',
      (v) => (v['publishedAt'] = { seconds: 1, nanoseconds: 0 }),
      'publishedAt',
    ],
    ['no request', (v) => delete v['requestId'], 'requestId'],
    [
      'no word on whether it was withdrawn (null, never absent)',
      (v) => delete v['withdrawnAt'],
      'withdrawnAt',
    ],
    [
      'an unknown transition',
      (v) => (v['transition'] = 'forget'),
      'transition',
    ],
    ['a broken body', (v) => delete v['onBreak'], 'onBreak'],
  ])('refuses a version with %s', (_case, edit, path) => {
    expect(refusal(readVersion('000002', edited(written, edit)))).toBe(
      `Malformed streakDefinitions/cadence/versions/000002.${path}`,
    );
  });

  it('passes on what the rule refuses, by code', () => {
    expect(
      refusal(
        readVersion(
          '000002',
          edited(written, (v) => (v['minGapDays'] = 21)),
        ),
      ),
    ).toBe(
      'Malformed streakDefinitions/cadence/versions/000002: engagement.streak_definition.min_gap_out_of_range',
    );
  });
});

// ── The rhythm's state: what the projection gained ──────────────────────

describe('reading the rhythm’s state', () => {
  const { account } = loyaltyFixtures.georgi;

  function stateOf(userId: string, data: unknown): StreakState {
    const read = loyaltyAccountFromDocument(userId, data);
    if (read.isFailure()) throw read.error;
    const state = read.value.streaks['cadence'];
    if (state === undefined) throw new Error('fixture: no rhythm');
    return state;
  }

  /** Георги's account with his rhythm changed by `edit`. */
  const withState = (edit: (state: Record<string, unknown>) => void) =>
    edited(account, (a) => edit(field(a['streaks'], 'cadence')));

  it('Георги: twelve periods kept, oldest first, the newest today; nothing on the book holds the period', () => {
    const state = stateOf('dev-client-1', account);
    expect(state.periods).toHaveLength(12);
    expect(state.periods.every((p) => p.mark === 'kept')).toBe(true);
    expect(state.periods.every((p) => p.reason === null)).toBe(true);
    expect(state.periods.map((p) => p.on)).toEqual(
      [...state.periods.map((p) => p.on)].sort(),
    );
    expect(state.periods.at(0)?.on).toBe('2025-12-08');
    expect(state.periods.at(-1)?.on).toBe(today);
    expect(state.heldBy).toBeNull();
  });

  it('Мартин: today’s visit, in the chair, holds the period', () => {
    const state = stateOf('dev-client-2', loyaltyFixtures.martin.account);
    expect(state.phase).toEqual({ kind: 'atRisk', dueBy: '2026-09-30' });
    expect(state.heldBy).toEqual({ appointmentId: 'appt-dev-2', on: today });
    expect(state.periods.at(-1)).toEqual({
      mark: 'kept',
      on: '2026-08-19',
      reason: null,
    });
  });

  // Optional on the wire, REQUIRED on the model: nothing that reads a
  // state has to guess.
  it('reads a state written before revision 3: no terms, no periods, no hold, no day the run began', () => {
    const before = withState((state) => {
      delete state['period'];
      delete state['periods'];
      delete state['heldBy'];
      delete state['runStartedOn'];
    });
    expect(stateOf('dev-client-1', before)).toMatchObject({
      current: 24,
      best: 24,
      period: null,
      periods: [],
      heldBy: null,
      runStartedOn: null,
    });
  });

  // The day the run began (lead ruling G1-7): «Ритъм сега · от март 2025 г.».
  it('reads the day the run began, older than anything the track keeps', () => {
    const georgi = stateOf('dev-client-1', account);
    expect(georgi.runStartedOn).toBe('2025-03-06');
    expect(georgi.current).toBeGreaterThan(georgi.periods.length);
    expect((georgi.runStartedOn ?? '') < (georgi.periods.at(0)?.on ?? '')).toBe(
      true,
    );
    expect(
      stateOf('dev-client-2', loyaltyFixtures.martin.account).runStartedOn,
    ).toBe('2025-05-08');
  });

  it('reads a state the first seed of revision 3 wrote: the three, and no day the run began', () => {
    const first = withState((state) => delete state['runStartedOn']);
    const state = stateOf('dev-client-1', first);
    expect(state.runStartedOn).toBeNull();
    expect(state.periods).toHaveLength(12);
    expect(state.period).not.toBeNull();
  });

  it('reads a count that was lost: no run is in progress, so none began', () => {
    const lost = withState((state) => {
      state['phase'] = {
        kind: 'broken',
        brokenAt: '2026-09-20',
        repairableUntil: '2026-10-04',
      };
      state['current'] = 0;
      state['dueBy'] = null;
      state['period'] = null;
      state['heldBy'] = null;
      state['runStartedOn'] = null;
    });
    expect(stateOf('dev-client-1', lost)).toMatchObject({
      current: 0,
      best: 24,
      runStartedOn: null,
    });
  });

  it('reads a broken rhythm: no period is open, so no terms and no hold', () => {
    const broken = withState((state) => {
      state['phase'] = {
        kind: 'broken',
        brokenAt: '2026-09-20',
        repairableUntil: '2026-10-04',
      };
      state['dueBy'] = null;
      state['period'] = null;
      state['heldBy'] = null;
    });
    const state = stateOf('dev-client-1', broken);
    expect(state.period).toBeNull();
    expect(state.heldBy).toBeNull();
    expect(state.periods).toHaveLength(12);
  });

  it('reads a period that runs on the shop’s excuse', () => {
    const excused = withState((state) => {
      state['phase'] = {
        kind: 'frozen',
        until: '2026-11-09',
        reason: 'excuse',
      };
    });
    expect(stateOf('dev-client-1', excused).phase).toEqual({
      kind: 'frozen',
      until: '2026-11-09',
      reason: 'excuse',
    });
  });

  it('reads a personal period: the habit to one decimal, the one figure that is not whole', () => {
    const personal = withState((state) => {
      state['period'] = {
        intervalDays: 38,
        graceDays: 7,
        source: 'personal',
        habitDays: 25.3,
      };
    });
    expect(stateOf('dev-client-1', personal).period).toEqual({
      intervalDays: 38,
      graceDays: 7,
      source: 'personal',
      habitDays: 25.3,
    });
  });

  it.each(['freeze', 'barberAbsence', 'closedDays', 'pause', 'clientPause'])(
    'reads a period covered by «%s»',
    (reason) => {
      const covered = withState((state) => {
        state['periods'] = [{ mark: 'protected', on: '2026-08-06', reason }];
      });
      expect(stateOf('dev-client-1', covered).periods).toEqual([
        { mark: 'protected', on: '2026-08-06', reason },
      ]);
    },
  );

  it.each<[string, (s: Record<string, unknown>) => void, string]>([
    [
      'a mark nobody draws',
      (s) => (nth(s['periods'], 0)['mark'] = 'skipped'),
      'periods[0].mark',
    ],
    [
      'a cover nobody knows',
      (s) => (nth(s['periods'], 1)['reason'] = 'rain'),
      'periods[1].reason',
    ],
    [
      'a period dated by an instant',
      (s) => (nth(s['periods'], 11)['on'] = '2026-09-28T07:00:00.000Z'),
      'periods[11].on',
    ],
    [
      'a period without a word on its cover (null, never absent)',
      (s) => delete nth(s['periods'], 0)['reason'],
      'periods[0].reason',
    ],
    ['periods that are not a list', (s) => (s['periods'] = {}), 'periods'],
    [
      'terms from an unknown source',
      (s) => (field(s, 'period')['source'] = 'guess'),
      'period.source',
    ],
    [
      'an interval of no days',
      (s) => (field(s, 'period')['intervalDays'] = 0),
      'period.intervalDays',
    ],
    [
      'a habit of no days',
      (s) => (field(s, 'period')['habitDays'] = 0),
      'period.habitDays',
    ],
    [
      'a habit in words',
      (s) => (field(s, 'period')['habitDays'] = 'monthly'),
      'period.habitDays',
    ],
    [
      'a hold that names no visit',
      (s) => (s['heldBy'] = { appointmentId: '', on: '2026-10-02' }),
      'heldBy.appointmentId',
    ],
    [
      'a hold on no day',
      (s) => (s['heldBy'] = { appointmentId: 'appt-dev-1' }),
      'heldBy.on',
    ],
    [
      'an unknown reason to be frozen',
      (s) =>
        (s['phase'] = { kind: 'frozen', until: '2026-11-09', reason: 'rain' }),
      'phase.reason',
    ],
    [
      'a run that began at an instant',
      (s) => (s['runStartedOn'] = '2025-03-06T08:00:00.000Z'),
      'runStartedOn',
    ],
    [
      'a run that began on no calendar day',
      (s) => (s['runStartedOn'] = '2025-02-30'),
      'runStartedOn',
    ],
    [
      'a run that began on a number',
      (s) => (s['runStartedOn'] = 20250306),
      'runStartedOn',
    ],
    [
      'a run that began on a blank',
      (s) => (s['runStartedOn'] = ''),
      'runStartedOn',
    ],
  ])('refuses a state with %s', (_case, edit, path) => {
    expect(
      refusal(loyaltyAccountFromDocument('dev-client-1', withState(edit))),
    ).toBe(`Malformed loyaltyAccounts/dev-client-1.streaks.cadence.${path}`);
  });

  it.each([
    ['Георги', 'dev-client-1', loyaltyFixtures.georgi],
    ['Мартин', 'dev-client-2', loyaltyFixtures.martin],
  ] as const)(
    'writes the state of %s back exactly as the fixture holds it',
    (_name, userId, fixture: LoyaltyAccountFixture) => {
      expect(streakStateToDocument(stateOf(userId, fixture.account))).toEqual(
        fixture.account.streaks['cadence'],
      );
    },
  );

  it('writes every field, the four a reader tolerates the absence of included', () => {
    const before = stateOf(
      'dev-client-1',
      withState((state) => {
        delete state['period'];
        delete state['periods'];
        delete state['heldBy'];
        delete state['runStartedOn'];
      }),
    );
    const written = streakStateToDocument(before);
    expect(written).toMatchObject({
      period: null,
      periods: [],
      heldBy: null,
      runStartedOn: null,
    });
    expect(Object.keys(written)).toEqual(
      Object.keys(loyaltyFixtures.georgi.account.streaks['cadence'] ?? {}),
    );
  });

  it('writes the day the run began as the day it is', () => {
    const state = stateOf('dev-client-1', account);
    expect(streakStateToDocument(state).runStartedOn).toBe('2025-03-06');
    expect(
      streakStateToDocument({ ...state, runStartedOn: '2026-06-13' })
        .runStartedOn,
    ).toBe('2026-06-13');
  });
});

// ── The activity feed: the ledger row, widened past points ─────────────

describe('reading the activity feed', () => {
  const { clientJournal } = loyaltyFixtures.georgi;
  const id = 'dev-client-1_000001';
  const row = clientJournal['dev-client-1_000001'];

  function activityOf(entryId: string, data: unknown): ActivityEntry {
    const read = activityEntryFromDocument(entryId, data);
    if (read.isFailure()) throw read.error;
    return read.value;
  }

  /** The first row, as the engine would have written another effect. */
  const withEffect = (effect: JournalEffectDocument, code: string) =>
    edited(row, (r) => {
      r['effect'] = effect;
      r['publicLabel'] = { code, params: {} };
    });

  it('names the effects behind every pill, from one table', () => {
    expect(ACTIVITY_EFFECT_KINDS).toEqual({
      all: ['points', 'achievement', 'tier', 'reward', 'redemption'],
      points: ['points'],
      rewards: ['reward', 'redemption'],
      status: ['tier'],
    });
    // A query's `in` takes ten values at most; every pill is one query.
    for (const kinds of Object.values(ACTIVITY_EFFECT_KINDS)) {
      expect(kinds.length).toBeLessThanOrEqual(10);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds.every((kind) => isOneOfAll(kind))).toBe(true);
    }
  });

  const isOneOfAll = (kind: string) =>
    (ACTIVITY_EFFECT_KINDS.all as readonly string[]).includes(kind);

  it.each([
    ['Георги', loyaltyFixtures.georgi],
    ['Мартин', loyaltyFixtures.martin],
  ] as const)(
    'reads every row of %s as the ledger does, with the event and the balance after it',
    (_name, fixture: LoyaltyAccountFixture) => {
      const rows = Object.entries(fixture.clientJournal);
      for (const [entryId, doc] of rows) {
        const entry = activityOf(entryId, doc);
        const ledger = ledgerEntryFromDocument(entryId, doc);
        if (ledger.isFailure()) throw ledger.error;
        const { delta, ...shared } = ledger.value;
        expect(entry).toEqual({
          ...shared,
          correlationId: doc.correlationId,
          effect: { kind: 'points', delta, balanceAfter: doc.balanceAfter },
        });
      }
      const [lastId, last] = rows.at(-1) ?? [];
      expect(activityOf(lastId ?? '', last).effect).toMatchObject({
        balanceAfter: fixture.account.balance,
      });
    },
  );

  it('keeps what ties the rows of one event together', () => {
    expect(activityOf(id, row).correlationId).toBe(
      'appt:appt-hist-c1-01:seat:appt-hist-c1-01-s1',
    );
  });

  it.each<[string, JournalEffectDocument, string, ActivityEntry['effect']]>([
    [
      'a level earned',
      {
        kind: 'achievement',
        rule: { ruleId: 'rule-series-rhythm-5', version: 1 },
        awardKey: 'rule-series-rhythm-5:dev-client-1:once',
        op: 'granted',
      },
      'achievement.earned',
      { kind: 'achievement', op: 'granted' },
    ],
    [
      'a level taken back',
      {
        kind: 'achievement',
        rule: { ruleId: 'rule-series-rhythm-5', version: 1 },
        awardKey: 'rule-series-rhythm-5:dev-client-1:once',
        op: 'revoked',
      },
      'achievement.revoked',
      { kind: 'achievement', op: 'revoked' },
    ],
    [
      'a tier reached',
      { kind: 'tier', op: 'changed', from: 'silver', to: 'gold', until: null },
      'tier.changed',
      { kind: 'tier', from: 'silver', to: 'gold' },
    ],
    [
      'a reward given',
      {
        kind: 'reward',
        op: 'granted',
        ref: { kind: 'couponGrant', id: 'grant-free-haircut' },
      },
      'reward.granted',
      { kind: 'reward', op: 'granted' },
    ],
    [
      'points exchanged for a reward',
      {
        kind: 'redemption',
        op: 'redeemed',
        redemptionId: 'redemption-1',
        rewardId: 'reward-haircut',
        cost: 250,
        grant: { kind: 'couponGrant', id: 'grant-free-haircut' },
      },
      'redemption.changed',
      { kind: 'redemption', op: 'redeemed', cost: 250 },
    ],
  ])('reads %s, cut to what a row prints', (_case, effect, code, expected) => {
    const entry = activityOf(id, withEffect(effect, code));
    expect(entry.effect).toEqual(expected);
    expect(entry.label).toEqual({ code, params: {} });
    expect(entry).toMatchObject({
      id,
      seq: 1,
      at: new Date('2025-03-06T08:45:00.000Z'),
      reverses: null,
    });
  });

  it('reads a row that owes: a negative balance is a fact, never clamped', () => {
    const owed = edited(row, (r) => {
      r['effect'] = { kind: 'points', delta: -40 };
      r['balanceAfter'] = -23;
    });
    expect(activityOf(id, owed).effect).toEqual({
      kind: 'points',
      delta: -40,
      balanceAfter: -23,
    });
  });

  it.each<[string, JournalEffectDocument]>([
    [
      'the rhythm',
      {
        kind: 'streak',
        streakId: 'cadence',
        op: 'extended',
        from: 23,
        to: 24,
        dueBy: '2026-11-09',
      },
    ],
    [
      'a protection',
      {
        kind: 'freeze',
        streakId: 'cadence',
        op: 'earned',
        count: 1,
        bankedAfter: 1,
      },
    ],
    [
      'a pause',
      {
        kind: 'pause',
        op: 'applied',
        pauseId: 'pause-1',
        term: { kind: 'permanent' },
        scope: 'allBookings',
        prior: null,
      },
    ],
    [
      'a corrected visit',
      {
        kind: 'visitOutcome',
        appointmentId: 'appt-hist-c1-01',
        seatId: 'appt-hist-c1-01-s1',
        from: 'worked',
        to: 'no_show',
        revision: 2,
      },
    ],
  ])('keeps %s out of the feed', (_case, effect) => {
    expect(
      refusal(
        activityEntryFromDocument(id, withEffect(effect, 'streak.changed')),
      ),
    ).toBe(`Malformed clientJournal/${id}.effect.kind`);
  });

  it.each<[string, (r: Record<string, unknown>) => void, string]>([
    ['a staff-only row', (r) => (r['visibility'] = 'staff'), 'visibility'],
    [
      'no event to belong to',
      (r) => (r['correlationId'] = ' '),
      'correlationId',
    ],
    [
      'a point row without the balance after it',
      (r) => delete r['balanceAfter'],
      'balanceAfter',
    ],
    [
      'an achievement that did something unknown',
      (r) => (r['effect'] = { kind: 'achievement', op: 'polished' }),
      'effect.op',
    ],
    [
      'a tier that came from nowhere',
      (r) => (r['effect'] = { kind: 'tier', op: 'changed', to: 'gold' }),
      'effect.from',
    ],
    [
      'a redemption at no stated cost',
      (r) => (r['effect'] = { kind: 'redemption', op: 'redeemed' }),
      'effect.cost',
    ],
    [
      'a label nobody can word',
      (r) => (field(r, 'publicLabel')['code'] = 'points.gift'),
      'publicLabel.code',
    ],
    [
      'a name among the label’s params',
      (r) => (field(r, 'publicLabel')['params'] = { who: { name: 'Георги' } }),
      'publicLabel.params.who',
    ],
  ])('refuses %s', (_case, edit, path) => {
    expect(refusal(activityEntryFromDocument(id, edited(row, edit)))).toBe(
      `Malformed clientJournal/${id}.${path}`,
    );
  });
});
