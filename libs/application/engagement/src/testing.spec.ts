import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import * as production from './index';
import * as testing from './testing';
import type { GiftVoucherFields } from './lib/ports/gift-voucher-document';
import {
  type BadgeCategoryDocument,
  type BadgeSeriesDocument,
  type ClientJournalEntryDocument,
  LOYALTY_CATALOG_COLLECTIONS,
  type MetricRefDocument,
  type PersonalRecordDocument,
  type StreakDefinitionBodyDocument,
  type StreakDefinitionHeadDocument,
  type StreakDefinitionScheduledDocument,
  type StreakPeriodFactDocument,
  type StreakPeriodTermsDocument,
  type TierDefinitionDocument,
  clientJournalEntryId,
  streakDefinitionVersionId,
} from './lib/ports/loyalty-document';
import {
  InMemoryClientVouchersReader,
  InMemoryLoyaltyActivityReader,
  InMemoryLoyaltyCatalogReader,
  InMemoryLoyaltyReader,
  InMemoryStreakDefinitionRepository,
  type LoyaltyAccountFixture,
  loyaltyFixtures,
} from './testing';

/**
 * The fixtures are the wire contract three packages build against
 * (client-card-redesign.md §4.4), so they are held to it here: the
 * compiler checks their shape (`testing.ts`), these checks the closed
 * vocabularies and every invariant a reader relies on — before any mapper
 * or projector exists to disagree with them.
 */

type Vocabulary<T extends string> = Readonly<Record<T, true>>;

// Exhaustive by construction: a value added to a union fails to compile here.
const CATEGORY_KINDS: Vocabulary<BadgeCategoryDocument['kind']> = {
  milestones: true,
  mastery: true,
  barbers: true,
  rhythm: true,
  special: true,
  records: true,
};
const EMBLEMS: Vocabulary<BadgeSeriesDocument['emblem']> = {
  visits: true,
  streak: true,
  referral: true,
  selfService: true,
  birthday: true,
  welcome: true,
  service: true,
  barber: true,
  shop: true,
  anniversary: true,
  earlyBird: true,
  weekend: true,
  onTime: true,
  waitlist: true,
  profile: true,
  party: true,
  explorer: true,
  yearRound: true,
  comeback: true,
  event: true,
  summer: true,
  autumn: true,
  vacation: true,
  sailing: true,
  icecream: true,
  umbrella: true,
  fog: true,
  handshake: true,
  grooming: true,
  beardOil: true,
  spa: true,
};
const METRICS: Vocabulary<MetricRefDocument['metric']> = {
  'client.visits.completed': true,
  'client.bookings.selfService': true,
  'client.spend.major': true,
  'client.referrals.completed': true,
  'client.waitlist.booked': true,
  'client.points.lifetime': true,
  'shop.bookings.created': true,
  'client.services.distinct': true,
  'client.barbers.distinct': true,
  'client.locations.distinct': true,
  'client.months.distinct': true,
  'client.visits.earlyBird': true,
  'client.visits.weekend': true,
  'client.visits.onTime': true,
  'client.visits.party': true,
  'client.tenure.days': true,
};
const PERKS: Vocabulary<TierDefinitionDocument['benefits'][number]> = {
  'perk.priorityWaitlist': true,
  'perk.bookFurtherAhead': true,
  'perk.freeReschedule': true,
};
const EXCUSES: Vocabulary<StreakDefinitionBodyDocument['excuses'][number]> = {
  shopClosure: true,
  barberAbsence: true,
  staffCancelled: true,
  closedDays: true,
};
const QUALIFIER_KINDS: Vocabulary<
  StreakDefinitionBodyDocument['qualifier']['kind']
> = {
  anyVisit: true,
  services: true,
  categories: true,
};
const INTERVAL_KINDS: Vocabulary<
  StreakDefinitionBodyDocument['interval']['kind']
> = {
  fixed: true,
  personal: true,
};
const ON_BREAK: Vocabulary<StreakDefinitionBodyDocument['onBreak']> = {
  restart: true,
  hold: true,
};
const TRANSITIONS: Vocabulary<StreakDefinitionScheduledDocument['transition']> =
  {
    grandfather: true,
    recompute: true,
  };
const PERIOD_MARKS: Vocabulary<StreakPeriodFactDocument['mark']> = {
  kept: true,
  protected: true,
  repaired: true,
  missed: true,
};
const PERIOD_SOURCES: Vocabulary<StreakPeriodTermsDocument['source']> = {
  fixed: true,
  personal: true,
  fallback: true,
};
const VOUCHER_STATES: Vocabulary<GiftVoucherFields['state']['kind']> = {
  active: true,
  void: true,
};
const RECORD_KINDS: Vocabulary<PersonalRecordDocument['kind']> = {
  longestRhythm: true,
  mostVisitsInYear: true,
  favouriteService: true,
  firstVisit: true,
};
const LABEL_CODES: Vocabulary<
  ClientJournalEntryDocument['publicLabel']['code']
> = {
  'points.opening': true,
  'points.rule': true,
  'points.goodwill': true,
  'points.serviceIssue': true,
  'points.correction': true,
  'points.accountMerge': true,
  'points.redeemed': true,
  'points.redemptionReversed': true,
  'points.expired': true,
  'points.debtCleared': true,
  'points.reversed': true,
  'achievement.earned': true,
  'achievement.revoked': true,
  'streak.changed': true,
  'freeze.changed': true,
  'tier.changed': true,
  'reward.granted': true,
  'reward.reinstated': true,
  'reward.revoked': true,
  'redemption.changed': true,
  'pause.changed': true,
  'visit.outcomeCorrected': true,
  'preview.stat': true,
  'choice.awardNoLongerMet': true,
  'choice.manualPause': true,
  'choice.upcomingBooking': true,
};

const known = <T extends string>(vocabulary: Vocabulary<T>, value: string) =>
  Object.hasOwn(vocabulary, value);

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isInstant = (raw: string) =>
  INSTANT.test(raw) && new Date(raw).toISOString() === raw;
const isDate = (raw: string) =>
  DATE.test(raw) &&
  new Date(`${raw}T00:00:00.000Z`).toISOString().startsWith(raw);

const DAY_MS = 86_400_000;
const dayNumber = (date: string) =>
  Math.round(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
const SOFIA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia',
});
const sofiaDay = (instant: string) => SOFIA_DAY.format(new Date(instant));

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture: no ${what}`);
  return value;
}

/** Every `{ bg, en }` pair anywhere inside a document. */
function texts(value: unknown): { bg: unknown; en: unknown }[] {
  if (value === null || typeof value !== 'object') return [];
  const own = Object.values(value).flatMap(texts);
  return 'bg' in value && 'en' in value
    ? [{ bg: value.bg, en: value.en }, ...own]
    : own;
}

const { catalog, today, vouchers } = loyaltyFixtures;
const series = Object.entries(catalog.badgeSeries);
const seriesMap = new Map(series);
const seasonMap = new Map(Object.entries(catalog.seasons));
const streakMap = new Map(Object.entries(catalog.streakDefinitions));
const seriesById = (id: string) => must(seriesMap.get(id), `series ${id}`);
/** Both halves of a head: the version in force, then the one that waits. */
const bodiesOf = (
  head: StreakDefinitionHeadDocument,
): readonly StreakDefinitionBodyDocument[] =>
  head.scheduled === null ? [head.current] : [head.current, head.scheduled];
/** A period's length for someone whose habit nobody knows yet. */
const periodDays = (rule: StreakDefinitionBodyDocument) =>
  rule.interval.kind === 'fixed'
    ? rule.interval.days
    : rule.interval.fallbackDays;
const phaseOn = (window: { from: string; until: string }, day: string) =>
  day < window.from ? 'announced' : day > window.until ? 'ended' : 'open';
/** Metrics whose count only climbs: an earned level's target stays met. */
const monotonic = (s: BadgeSeriesDocument) =>
  s.metric !== null && s.metric.window === undefined;

describe('@creativo/application/engagement/testing — test support, apart from the barrel', () => {
  it('offers the loyalty fixtures', () => {
    expect(Object.keys(testing.loyaltyFixtures)).toEqual([
      'today',
      'catalog',
      'georgi',
      'martin',
      'vouchers',
    ]);
    expect(isDate(testing.loyaltyFixtures.today)).toBe(true);
  });

  it('offers every loyalty port its in-memory reference', () => {
    expect(
      Object.keys(testing)
        .filter((name) => name.startsWith('InMemory'))
        .sort(),
    ).toEqual([
      'InMemoryClientVouchersReader',
      'InMemoryLoyaltyActivityReader',
      'InMemoryLoyaltyCatalogReader',
      'InMemoryLoyaltyReader',
      'InMemoryStreakDefinitionRepository',
    ]);
  });

  it('keeps them off the production barrel', () => {
    expect(Object.keys(production)).not.toContain('loyaltyFixtures');
    expect(
      Object.keys(production).filter((name) => name.startsWith('InMemory')),
    ).toEqual([]);
  });

  it('re-exports none of the test support', () => {
    const support = Object.keys(testing).filter((name) =>
      Object.keys(production).includes(name),
    );
    expect(support).toEqual([]);
  });

  // Shared by every spec in a worker: one spec's mutation must not become
  // the next one's fixture.
  it('hands them out frozen, all the way down', () => {
    const account = loyaltyFixtures.georgi.account;
    expect(Object.isFrozen(account)).toBe(true);
    expect(Object.isFrozen(account.tier)).toBe(true);
    expect(Object.isFrozen(catalog.badgeSeries['series-visits']?.levels)).toBe(
      true,
    );
    expect(
      Object.isFrozen(catalog.streakDefinitions['cadence']?.current.excuses),
    ).toBe(true);
    expect(Object.isFrozen(vouchers['voucher-dev-georgi']?.issuedAt)).toBe(
      true,
    );
    expect(() => {
      (account as { balance: number }).balance = 0;
    }).toThrow(TypeError);
  });
});

describe('the catalogue fixture', () => {
  it('holds the six catalogue collections, sized as the seed writes them (§4.5)', () => {
    expect(Object.keys(catalog)).toEqual([...LOYALTY_CATALOG_COLLECTIONS]);
    expect(Object.keys(catalog.badgeCategories)).toHaveLength(6);
    expect(series).toHaveLength(42);
    expect(Object.keys(catalog.seasons)).toHaveLength(3);
    expect(Object.keys(catalog.tierDefinitions)).toHaveLength(4);
    expect(Object.keys(catalog.rewardsCatalog)).toHaveLength(3);
    expect(Object.keys(catalog.streakDefinitions)).toHaveLength(1);
  });

  it('speaks only the closed vocabularies', () => {
    const categories = Object.values(catalog.badgeCategories);
    expect(categories.every((c) => known(CATEGORY_KINDS, c.kind))).toBe(true);
    expect(new Set(categories.map((c) => c.kind)).size).toBe(
      Object.keys(CATEGORY_KINDS).length,
    );
    for (const [, s] of series) {
      expect(known(EMBLEMS, s.emblem)).toBe(true);
      if (s.metric !== null) expect(known(METRICS, s.metric.metric)).toBe(true);
    }
    for (const season of Object.values(catalog.seasons)) {
      expect(known(EMBLEMS, season.emblem)).toBe(true);
    }
    for (const tier of Object.values(catalog.tierDefinitions)) {
      expect(tier.benefits.every((perk) => known(PERKS, perk))).toBe(true);
      expect(known(METRICS, tier.qualify.metric)).toBe(true);
    }
    for (const head of Object.values(catalog.streakDefinitions)) {
      for (const rule of bodiesOf(head)) {
        expect(rule.excuses.every((e) => known(EXCUSES, e))).toBe(true);
        expect(new Set(rule.excuses).size).toBe(rule.excuses.length);
        expect(known(QUALIFIER_KINDS, rule.qualifier.kind)).toBe(true);
        expect(known(INTERVAL_KINDS, rule.interval.kind)).toBe(true);
        expect(known(ON_BREAK, rule.onBreak)).toBe(true);
      }
      if (head.scheduled !== null)
        expect(known(TRANSITIONS, head.scheduled.transition)).toBe(true);
    }
  });

  // The head as revision 3 holds it (§4.3): the version in force, and at
  // most one that waits for a later day under a higher number.
  it('holds the rhythm as its head: a version in force, and nothing that waits out of turn', () => {
    for (const [id, head] of streakMap) {
      const { current, scheduled } = head;
      expect(Number.isInteger(current.version), id).toBe(true);
      expect(current.version, id).toBeGreaterThanOrEqual(1);
      expect(current.effectiveFrom <= today, id).toBe(true);
      if (scheduled === null) continue;
      expect(scheduled.version, id).toBeGreaterThan(current.version);
      expect(scheduled.effectiveFrom > current.effectiveFrom, id).toBe(true);
    }
  });

  it('keeps every figure of the rule whole, grace and the cue shorter than a period', () => {
    for (const [id, head] of streakMap) {
      for (const rule of bodiesOf(head)) {
        const shortest =
          rule.interval.kind === 'fixed'
            ? rule.interval.days
            : rule.interval.minDays;
        const figures = [
          shortest,
          periodDays(rule),
          rule.minGapDays,
          rule.bookingHold.maxDaysPastDue,
          rule.graceDays,
          rule.riskLeadDays,
          rule.protections.maxBanked,
          rule.protections.earnEvery,
          rule.protections.startWith,
          rule.clientPause.maxDaysPerYear,
          rule.repair.windowDays,
          rule.repair.perYear,
        ];
        expect(
          figures.every((n) => Number.isInteger(n) && n >= 0),
          id,
        ).toBe(true);
        expect(rule.graceDays, id).toBeLessThan(shortest);
        expect(rule.riskLeadDays, id).toBeLessThan(shortest);
        expect(rule.minGapDays, id).toBeLessThan(shortest);
        expect(rule.protections.startWith, id).toBeLessThanOrEqual(
          rule.protections.maxBanked,
        );
      }
    }
  });

  // A key is registered only when this build renders it (§8.2): every
  // emblem is drawn by some family or season, so none is dead vocabulary.
  it('draws every emblem somewhere', () => {
    const drawn = new Set([
      ...series.map(([, s]) => s.emblem),
      ...Object.values(catalog.seasons).map((season) => season.emblem),
    ]);
    expect([...drawn].sort()).toEqual(Object.keys(EMBLEMS).sort());
  });

  it('writes every text in both locales', () => {
    const all = texts(catalog);
    expect(all.length).toBeGreaterThan(0);
    for (const text of all) {
      expect(typeof text.bg === 'string' && text.bg.trim().length > 0).toBe(
        true,
      );
      expect(typeof text.en === 'string' && text.en.trim().length > 0).toBe(
        true,
      );
    }
  });

  it('homes every family in exactly one existing category or season', () => {
    for (const [id, s] of series) {
      expect(
        [s.categoryId, s.seasonId].filter((home) => home !== null),
        id,
      ).toHaveLength(1);
      if (s.categoryId !== null)
        expect(catalog.badgeCategories[s.categoryId], id).toBeDefined();
      if (s.seasonId !== null)
        expect(catalog.seasons[s.seasonId], id).toBeDefined();
    }
    for (const [categoryId, category] of Object.entries(
      catalog.badgeCategories,
    )) {
      const families = series.filter(([, s]) => s.categoryId === categoryId);
      // The records shelf is the personal-records rail, never a family.
      if (category.kind === 'records') expect(families).toHaveLength(0);
      else expect(families.length).toBeGreaterThan(0);
    }
  });

  it('climbs every family I…n with rising targets; a one-off or a yearly family has one level', () => {
    for (const [id, s] of series) {
      expect(
        s.levels.map((l) => l.level),
        id,
      ).toEqual(s.levels.map((_, i) => i + 1));
      const targets = s.levels.map((l) => l.target);
      if (targets.includes(null) || s.repeatable) {
        expect(s.levels, id).toHaveLength(1);
      }
      const numeric = targets.filter((t): t is number => t !== null);
      expect(
        numeric.every(
          (t, i) => t > 0 && (i === 0 || t > (numeric[i - 1] ?? 0)),
        ),
        id,
      ).toBe(true);
      // Only a figure-free act has no target; a counted family always has one.
      if (s.metric !== null) expect(targets.includes(null), id).toBe(false);
    }
  });

  it('gives every level its own once-rule and pays in positive whole amounts', () => {
    const rules = series.flatMap(([, s]) => s.levels.map((l) => l.ruleId));
    expect(new Set(rules).size).toBe(rules.length);
    for (const [, s] of series) {
      for (const award of s.levels.flatMap((l) => l.awards)) {
        if (award.kind === 'points')
          expect(Number.isInteger(award.points) && award.points > 0).toBe(true);
        if (award.kind === 'freeze')
          expect(Number.isInteger(award.count) && award.count > 0).toBe(true);
      }
    }
  });

  it('narrows a subject family to its subject', () => {
    for (const [id, s] of series) {
      if (s.subject === null || s.metric === null) continue;
      const where = s.metric.where ?? {};
      if (s.subject.kind === 'service')
        expect(where.serviceId, id).toBe(s.subject.serviceId);
      if (s.subject.kind === 'barber')
        expect(where.barberId, id).toBe(s.subject.barberId);
      if (s.subject.kind === 'location')
        expect(where.locationId, id).toBe(s.subject.locationId);
    }
  });

  it('dates every season inclusively, announced a notice period ahead (R29)', () => {
    for (const [id, season] of Object.entries(catalog.seasons)) {
      expect(
        isDate(season.window.from) && isDate(season.window.until),
        id,
      ).toBe(true);
      expect(season.window.from <= season.window.until, id).toBe(true);
      expect(isInstant(season.announcedAt), id).toBe(true);
      expect(
        sofiaDay(season.announcedAt) <= addDays(season.window.from, -30),
        id,
      ).toBe(true);
    }
  });

  it('gives a season a track and an event none, and lists each of its families once', () => {
    for (const [id, season] of Object.entries(catalog.seasons)) {
      if (season.kind === 'season')
        expect(season.trackSeriesId, id).not.toBeNull();
      else expect(season.trackSeriesId, id).toBeNull();
      const listed = [
        ...(season.trackSeriesId === null ? [] : [season.trackSeriesId]),
        ...season.seriesIds,
      ];
      const members = series
        .filter(([, s]) => s.seasonId === id)
        .map(([sid]) => sid);
      expect([...listed].sort(), id).toEqual([...members].sort());
      expect(new Set(listed).size, id).toBe(listed.length);
      expect(season.seriesIds, id).not.toContain(season.trackSeriesId);
    }
  });

  // §4.6: whatever the calendar's today, one of each phase.
  it('runs one season and one event, and has one season behind it, on the fixtures’ today', () => {
    const phases = Object.values(catalog.seasons).map(
      (season) => `${season.kind}:${phaseOn(season.window, today)}`,
    );
    expect(phases.sort()).toEqual([
      'event:open',
      'season:ended',
      'season:open',
    ]);
  });

  it('ranks the tiers by visits in a year, each asking more than the last', () => {
    const tiers = Object.values(catalog.tierDefinitions).sort(
      (a, b) => a.rank - b.rank,
    );
    expect(tiers.map((t) => t.rank)).toEqual([0, 1, 2, 3]);
    expect(tiers[0]?.qualify.atLeast).toBe(0);
    for (const [i, tier] of tiers.entries()) {
      expect(tier.qualify.metric).toBe('client.visits.completed');
      expect(tier.qualify.window.lastDays).toBe(365);
      if (i > 0)
        expect(tier.qualify.atLeast).toBeGreaterThan(
          tiers[i - 1]?.qualify.atLeast ?? Infinity,
        );
    }
  });

  it('prices every reward in positive whole points, and orders them', () => {
    const rewards = Object.values(catalog.rewardsCatalog);
    for (const reward of rewards) {
      expect(Number.isInteger(reward.cost) && reward.cost > 0).toBe(true);
      expect(reward.redeemedCount).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(rewards.map((r) => r.order)).size).toBe(rewards.length);
  });

  it('writes instants as UTC ISO strings', () => {
    const instants = [
      ...series
        .map(([, s]) => s.retiredAt)
        .filter((at): at is string => at !== null),
      ...Object.values(catalog.tierDefinitions).map((t) => t.effectiveFrom),
      ...Object.values(catalog.streakDefinitions).map((s) => s.updatedAt),
    ];
    expect(instants.length).toBeGreaterThan(0);
    expect(instants.every(isInstant)).toBe(true);
  });

  // A rule judges by DAY: its first day is a Sofia calendar day, never an
  // instant (§4.3).
  it('dates a rule’s first day as a day', () => {
    const days = Object.values(catalog.streakDefinitions).flatMap((head) =>
      bodiesOf(head).map((rule) => rule.effectiveFrom),
    );
    expect(days.length).toBeGreaterThan(0);
    expect(days.every(isDate)).toBe(true);
  });
});

describe('the voucher fixture', () => {
  const all = Object.entries(vouchers);
  const holders = [
    loyaltyFixtures.georgi.account.userId,
    loyaltyFixtures.martin.account.userId,
  ];

  it('holds five vouchers, each under its own code', () => {
    expect(all).toHaveLength(5);
    const codes = all.map(([, voucher]) => voucher.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code === code.trim().toUpperCase())).toBe(
      true,
    );
  });

  it('counts money in whole euro cents, never more left than was issued', () => {
    for (const [id, voucher] of all) {
      expect(voucher.currencyCode, id).toBe('EUR');
      expect(Number.isInteger(voucher.initialValueMinorUnits), id).toBe(true);
      expect(Number.isInteger(voucher.balanceMinorUnits), id).toBe(true);
      expect(voucher.initialValueMinorUnits, id).toBeGreaterThan(0);
      expect(voucher.balanceMinorUnits, id).toBeGreaterThanOrEqual(0);
      expect(voucher.balanceMinorUnits, id).toBeLessThanOrEqual(
        voucher.initialValueMinorUnits,
      );
    }
  });

  it('speaks only the closed vocabulary, and dates everything in the shop’s zone', () => {
    for (const [id, voucher] of all) {
      expect(known(VOUCHER_STATES, voucher.state.kind), id).toBe(true);
      const instants = [
        voucher.issuedAt,
        ...(voucher.expiresAt === null ? [] : [voucher.expiresAt]),
        ...(voucher.state.kind === 'void' ? [voucher.state.voidedAt] : []),
      ];
      for (const instant of instants) {
        expect(instant.zone, id).toBe('Europe/Sofia');
        expect(Number.isFinite(Date.parse(instant.iso)), id).toBe(true);
      }
      expect(sofiaDay(voucher.issuedAt.iso) <= today, id).toBe(true);
      if (voucher.expiresAt !== null)
        expect(voucher.expiresAt.iso > voucher.issuedAt.iso, id).toBe(true);
    }
  });

  it('issues a voucher to a seeded client, or to nobody', () => {
    for (const [id, voucher] of all) {
      if (voucher.issuedToUserId !== null)
        expect(holders, id).toContain(voucher.issuedToUserId);
    }
    expect(
      all.filter(([, voucher]) => voucher.issuedToUserId === null),
    ).toHaveLength(1);
  });
});

describe.each([
  ['Георги', 'dev-client-1', loyaltyFixtures.georgi],
  ['Мартин', 'dev-client-2', loyaltyFixtures.martin],
] as const)(
  'the account fixture of %s',
  (_name, userId, fixture: LoyaltyAccountFixture) => {
    const { account, badgeProgress, seasonProgress, clientJournal } = fixture;
    const rows = Object.entries(clientJournal);
    const entries = rows.map(([, entry]) => entry);
    const pointsOf = (entry: ClientJournalEntryDocument) =>
      entry.effect.kind === 'points' ? entry.effect.delta : 0;

    it('is this client’s, keyed and sequenced as the journal is', () => {
      expect(account.userId).toBe(userId);
      rows.forEach(([id, entry], i) => {
        expect(entry.userId).toBe(userId);
        expect(entry.seq).toBe(i + 1);
        expect(id).toBe(clientJournalEntryId(userId, entry.seq));
      });
      expect(account.seq).toBe(entries.length);
    });

    it('holds the client-visible point rows, in time order, each carrying the running balance', () => {
      let running = 0;
      entries.forEach((entry, i) => {
        expect(entry.visibility).toBe('client');
        expect(entry.effect.kind).toBe('points');
        expect(known(LABEL_CODES, entry.publicLabel.code)).toBe(true);
        expect(isInstant(entry.at)).toBe(true);
        if (i > 0) expect(entry.at >= (entries[i - 1]?.at ?? '')).toBe(true);
        running += pointsOf(entry);
        expect(entry.balanceAfter).toBe(running);
        expect(entry.reverses).toBeNull();
      });
    });

    it('balances: Σ point rows = earned + adjusted − spent', () => {
      const sum = entries.reduce((total, entry) => total + pointsOf(entry), 0);
      const spent = -entries
        .filter((entry) => entry.source.kind === 'redemption')
        .reduce((total, entry) => total + pointsOf(entry), 0);
      expect(account.balance).toBe(sum);
      expect(account.lifetimeSpent).toBe(spent);
      expect(account.balance).toBe(
        account.lifetimeEarned +
          account.lifetimeAdjusted -
          account.lifetimeSpent,
      );
    });

    it('pays a seat a point per whole euro, and a level exactly what the catalogue says it pays', () => {
      for (const entry of entries) {
        const { source, publicLabel } = entry;
        if (source.kind === 'redemption') {
          expect(publicLabel.code).toBe('points.redeemed');
          expect(
            catalog.rewardsCatalog[String(publicLabel.params['reward'])]?.cost,
          ).toBe(-pointsOf(entry));
          continue;
        }
        expect(source.kind).toBe('rule');
        if (source.kind !== 'rule') continue;
        expect(publicLabel.code).toBe('points.rule');
        expect(publicLabel.params['rule']).toBe(source.rule.ruleId);
        expect(
          source.awardKey.startsWith(`${source.rule.ruleId}:${userId}:`),
        ).toBe(true);
        expect(entry.idempotencyKey).toBe(`award:${source.awardKey}#0`);
        const seriesId = publicLabel.params['seriesId'];
        if (seriesId === undefined) {
          expect(pointsOf(entry)).toBe(
            Math.floor(Number(publicLabel.params['spendMinor']) / 100),
          );
          continue;
        }
        const level = must(
          seriesById(String(seriesId)).levels[
            Number(publicLabel.params['level']) - 1
          ],
          'level',
        );
        expect(source.rule.ruleId).toBe(level.ruleId);
        expect(source.awardKey).toBe(`${level.ruleId}:${userId}:once`);
        expect(level.awards).toContainEqual({
          kind: 'points',
          points: pointsOf(entry),
        });
        // The payout is journaled when the level is earned.
        const earned = badgeProgress[String(seriesId)]?.earned.find(
          (e) => e.level === level.level,
        );
        expect(earned?.earnedAt).toBe(entry.at);
      }
    });

    it('keeps progress only for catalogue families, levels earned bottom-up in time order', () => {
      for (const [seriesId, progress] of Object.entries(badgeProgress)) {
        const s = seriesById(seriesId);
        expect(progress.value).toBeGreaterThan(0);
        expect(progress.earned.map((e) => e.level)).toEqual(
          progress.earned.map((_, i) => i + 1),
        );
        progress.earned.forEach((e, i) => {
          expect(s.levels[e.level - 1], seriesId).toBeDefined();
          expect(isInstant(e.earnedAt)).toBe(true);
          expect(e.count).toBeGreaterThanOrEqual(1);
          if (i > 0)
            expect(e.earnedAt >= (progress.earned[i - 1]?.earnedAt ?? '')).toBe(
              true,
            );
        });
        if (!monotonic(s)) continue;
        // A count that only climbs has met every earned target, and not the next one.
        for (const e of progress.earned) {
          expect(progress.value, seriesId).toBeGreaterThanOrEqual(
            s.levels[e.level - 1]?.target ?? 0,
          );
        }
        const next = s.levels[progress.earned.length];
        if (next?.target != null)
          expect(progress.value, seriesId).toBeLessThan(next.target);
      }
    });

    it('counts «Посещения» as the visits the journal paid for', () => {
      const visits = new Set(
        entries.flatMap((entry) =>
          entry.source.kind === 'rule' &&
          entry.source.rule.ruleId === 'rule-earn-per-euro'
            ? [entry.correlationId.split(':seat:')[0]]
            : [],
        ),
      );
      expect(badgeProgress['series-visits']?.value).toBe(visits.size);
    });

    it('mirrors each season’s track into its season progress', () => {
      const progressMap = new Map(Object.entries(seasonProgress));
      for (const [seasonId, progress] of progressMap) {
        const trackId = must(seasonMap.get(seasonId), seasonId).trackSeriesId;
        expect(trackId).not.toBeNull();
        const track = badgeProgress[trackId ?? ''];
        expect(progress.trackValue).toBe(track?.value);
        expect(progress.trackLevel).toBe(track?.earned.length);
      }
      for (const [seasonId, season] of seasonMap) {
        const track =
          season.trackSeriesId && badgeProgress[season.trackSeriesId];
        if (track) expect(progressMap.get(seasonId)).toBeDefined();
      }
    });

    it('places the client on the tier their visits in a year reach', () => {
      const tiers = Object.entries(catalog.tierDefinitions).sort(
        ([, a], [, b]) => a.rank - b.rank,
      );
      const reached = tiers.filter(
        ([, t]) => account.tier.qualifying >= t.qualify.atLeast,
      );
      const [currentId] = must(reached.at(-1), 'tier');
      const next = tiers[reached.length];
      expect(account.tier.current).toBe(currentId);
      expect(account.tier.next).toBe(next?.[0] ?? null);
      expect(account.tier.remaining).toBe(
        next === undefined
          ? null
          : next[1].qualify.atLeast - account.tier.qualifying,
      );
      expect(isInstant(account.tier.since)).toBe(true);
    });

    it('keeps the rhythm on the rule in force', () => {
      for (const [streakId, state] of Object.entries(account.streaks)) {
        const rule = must(streakMap.get(streakId), streakId).current;
        expect(state.streakId).toBe(streakId);
        expect(state.definitionVersion).toBe(rule.version);
        expect(state.current).toBeLessThanOrEqual(state.best);
        expect(state.freezesBanked).toBeLessThanOrEqual(
          rule.protections.maxBanked,
        );
        const last = must(
          state.lastQualifiedAt ?? undefined,
          'last qualifying visit',
        );
        expect(isInstant(last)).toBe(true);
        const days = periodDays(rule);
        expect(state.dueBy).toBe(addDays(sofiaDay(last), days));
        const atRisk =
          dayNumber(state.dueBy ?? today) - dayNumber(today) <=
          rule.riskLeadDays;
        expect(state.phase).toEqual(
          atRisk ? { kind: 'atRisk', dueBy: state.dueBy } : { kind: 'active' },
        );
      }
    });

    // The three fields revision 3 adds (§4.2). A writer writes all three.
    it('pins the open period’s terms to the rule it opened under', () => {
      for (const [streakId, state] of Object.entries(account.streaks)) {
        const rule = must(streakMap.get(streakId), streakId).current;
        const period = must(state.period ?? undefined, 'the open period');
        expect(known(PERIOD_SOURCES, period.source)).toBe(true);
        expect(period).toEqual({
          intervalDays: periodDays(rule),
          graceDays: rule.graceDays,
          source: rule.interval.kind === 'fixed' ? 'fixed' : 'fallback',
          habitDays: null,
        });
      }
    });

    it('draws the track: the newest twelve closed periods, oldest first, up to the last counted visit', () => {
      for (const state of Object.values(account.streaks)) {
        const periods = must(state.periods, 'the closed periods');
        expect(periods).toHaveLength(Math.min(12, state.current));
        periods.forEach((period, i) => {
          expect(known(PERIOD_MARKS, period.mark)).toBe(true);
          expect(isDate(period.on)).toBe(true);
          if (i > 0) expect(period.on > (periods[i - 1]?.on ?? '')).toBe(true);
          // Only a period something covered says what covered it.
          if (period.mark !== 'protected') expect(period.reason).toBeNull();
        });
        expect(periods.at(-1)).toEqual({
          mark: 'kept',
          on: sofiaDay(must(state.lastQualifiedAt ?? undefined, 'last visit')),
          reason: null,
        });
      }
    });

    it('names the visit that holds the period only when one is on the book ahead', () => {
      for (const state of Object.values(account.streaks)) {
        expect(state.heldBy).not.toBeUndefined();
        if (state.heldBy == null) continue;
        expect(state.heldBy.appointmentId.trim().length).toBeGreaterThan(0);
        expect(isDate(state.heldBy.on)).toBe(true);
        expect(state.heldBy.on >= today).toBe(true);
      }
    });

    // The fourth (lead ruling G1-7). A writer writes it with the three.
    it('dates the run in progress: as old as the first visit of a client who never lost the count', () => {
      for (const state of Object.values(account.streaks)) {
        expect(state.runStartedOn).not.toBeUndefined();
        if (state.current === 0) {
          expect(state.runStartedOn).toBeNull();
          continue;
        }
        const began = must(state.runStartedOn ?? undefined, 'the run’s day');
        expect(isDate(began)).toBe(true);
        expect(
          began <=
            sofiaDay(must(state.lastQualifiedAt ?? undefined, 'last visit')),
        ).toBe(true);
        // A run longer than the track began before anything the track keeps.
        const periods = must(state.periods, 'the closed periods');
        if (state.current > periods.length) {
          expect(began < (periods[0]?.on ?? '')).toBe(true);
        }
        // Every visit counted and none was missed: the run is the history.
        if (state.current === badgeProgress['series-visits']?.value) {
          expect(began).toBe(
            account.records.find((r) => r.kind === 'firstVisit')?.on,
          );
        }
      }
    });

    it('keeps its stamp cards, records and bookkeeping readable', () => {
      for (const card of account.punchCards) {
        expect(card.filled).toBeGreaterThanOrEqual(0);
        expect(card.filled).toBeLessThan(card.size);
      }
      const kinds = account.records.map((r) => r.kind);
      expect(kinds.every((kind) => known(RECORD_KINDS, kind))).toBe(true);
      expect(new Set(kinds).size).toBe(kinds.length);
      const favourite = account.records.find(
        (r) => r.kind === 'favouriteService',
      );
      expect(
        series.some(
          ([, s]) =>
            s.subject?.kind === 'service' &&
            s.subject.serviceId === favourite?.serviceId,
        ),
      ).toBe(true);
      for (const record of account.records) {
        if (record.on !== null) expect(isDate(record.on)).toBe(true);
      }
      expect(account.pointsExpiry).toBeNull();
      expect(isInstant(account.updatedAt)).toBe(true);
      expect(account.updatedAt >= (entries.at(-1)?.at ?? '')).toBe(true);
    });
  },
);

// The §4.6 story each fixture tells — what the card's specs and the e2e
// read off them.
describe('the seeded story (§4.6)', () => {
  const levels = (fixture: LoyaltyAccountFixture) =>
    Object.values(fixture.badgeProgress).reduce(
      (n, p) => n + p.earned.length,
      0,
    );

  it('Георги: the regular, Злато, 24 in rhythm, today’s cut done', () => {
    const { account, badgeProgress, seasonProgress } = loyaltyFixtures.georgi;
    expect(badgeProgress['series-visits']?.value).toBe(24);
    expect(account.balance).toBe(358);
    expect(account.tier).toMatchObject({
      current: 'gold',
      qualifying: 14,
      next: 'platinum',
      remaining: 6,
    });
    expect(account.punchCards).toMatchObject([
      { ruleId: 'rule-every-10th-visit', filled: 4, size: 10 },
    ]);
    expect(account.streaks['cadence']).toMatchObject({
      current: 24,
      best: 24,
      phase: { kind: 'active' },
      dueBy: '2026-11-09',
      freezesBanked: 2,
      heldBy: null,
      // Twelve periods before the oldest the track keeps.
      runStartedOn: '2025-03-06',
    });
    expect(badgeProgress['series-rhythm']?.earned).toHaveLength(5);
    expect(badgeProgress['series-svc-fade']).toMatchObject({ value: 24 });
    expect(badgeProgress['series-svc-fade']?.earned).toHaveLength(2);
    expect(seasonProgress['season-2026-autumn']).toEqual({
      trackValue: 2,
      trackLevel: 2,
    });
    expect(levels(loyaltyFixtures.georgi)).toBe(37);
  });

  it('Мартин: Сребро, 13 in rhythm and due, no birthday visit yet', () => {
    const { account, badgeProgress, seasonProgress } = loyaltyFixtures.martin;
    expect(badgeProgress['series-visits']?.value).toBe(13);
    expect(account.balance).toBe(215);
    expect(account.tier).toMatchObject({
      current: 'silver',
      qualifying: 9,
      next: 'gold',
      remaining: 3,
    });
    expect(account.punchCards).toMatchObject([{ filled: 3, size: 10 }]);
    expect(account.streaks['cadence']).toMatchObject({
      current: 13,
      phase: { kind: 'atRisk', dueBy: '2026-09-30' },
      // In the chair today: the visit on the book holds the period.
      heldBy: { appointmentId: 'appt-dev-2', on: '2026-09-28' },
      runStartedOn: '2025-05-08',
    });
    expect(badgeProgress['series-birthday']).toBeUndefined();
    expect(seasonProgress['season-2026-autumn']).toBeUndefined();
    expect(seasonProgress['season-2026-summer']).toEqual({
      trackValue: 2,
      trackLevel: 2,
    });
    expect(levels(loyaltyFixtures.martin)).toBe(28);
  });

  it('the rhythm: one rule, «Посещения в ритъм», every six weeks, nothing waiting', () => {
    expect(Object.keys(catalog.streakDefinitions)).toEqual(['cadence']);
    expect(catalog.streakDefinitions['cadence']).toMatchObject({
      name: { bg: 'Посещения в ритъм' },
      current: {
        version: 1,
        effectiveFrom: '2025-03-01',
        enabled: true,
        qualifier: { kind: 'anyVisit' },
        interval: { kind: 'fixed', days: 42 },
        graceDays: 7,
        onBreak: 'restart',
      },
      scheduled: null,
    });
  });

  it('the vouchers: Георги has 25,00 € left of 50,00 € until the year’s end', () => {
    expect(vouchers['voucher-dev-georgi']).toMatchObject({
      code: 'GIFT50',
      initialValueMinorUnits: 5000,
      balanceMinorUnits: 2500,
      issuedToUserId: 'dev-client-1',
      state: { kind: 'active' },
    });
    expect(sofiaDay(vouchers['voucher-dev-georgi']?.expiresAt?.iso ?? '')).toBe(
      '2026-12-31',
    );
    expect(vouchers['voucher-dev-five']?.issuedToUserId).toBeNull();
  });
});

// The references are seeded from the fixtures above and read them through
// the wire's mappers; each port's own spec holds its reference to the
// port's promises. Here: that the five tell ONE story.
describe('the in-memory references, seeded', () => {
  const georgi = loyaltyFixtures.georgi.account.userId;
  const martin = loyaltyFixtures.martin.account.userId;

  it('reads the rhythm’s rule as the catalogue hands it', async () => {
    const catalogue = await new InMemoryLoyaltyCatalogReader().getCatalog();
    const head = await firstValueFrom(
      InMemoryStreakDefinitionRepository.seeded().observe('cadence'),
    );
    if (catalogue.isFailure()) throw catalogue.error;
    if (head.isFailure()) throw head.error;
    const inForce = must(
      catalogue.value.streakInForce('cadence', today) ?? undefined,
      'the rule in force',
    );
    expect(head.value?.inForceOn(today).equals(inForce)).toBe(true);
    expect(head.value?.upcomingOn(today)).toBeNull();
  });

  it('gives the rule the history the seed gives it: its first version', async () => {
    const repository = InMemoryStreakDefinitionRepository.seeded();
    const versions = await repository.listVersions('cadence', 20);
    if (versions.isFailure()) throw versions.error;
    const head = must(streakMap.get('cadence'), 'the head');
    expect(versions.value.map((v) => v.definition.version)).toEqual([
      head.current.version,
    ]);
    expect(
      Object.keys(repository.documentsOf('cadence')?.versions ?? {}),
    ).toEqual([streakDefinitionVersionId(head.current.version)]);
    expect(versions.value[0]).toMatchObject({
      publishedBy: 'system',
      transition: 'grandfather',
      direction: 'neutral',
      changed: [],
      withdrawnAt: null,
    });
    expect(versions.value[0]?.publishedAt.toISOString()).toBe(head.updatedAt);
  });

  it('hands each client’s rhythm the day its run began, as the account holds it', async () => {
    const reader = InMemoryLoyaltyReader.seeded();
    const began = async (userId: string) => {
      const read = await reader.getAccount(userId);
      if (read.isFailure()) throw read.error;
      return read.value?.streaks['cadence']?.runStartedOn;
    };
    expect(await began(georgi)).toBe('2025-03-06');
    expect(await began(martin)).toBe('2025-05-08');
    // A document written before the day was kept: nobody has to guess.
    const { runStartedOn, ...before } = must(
      loyaltyFixtures.georgi.account.streaks['cadence'],
      'Георги’s rhythm',
    );
    expect(runStartedOn).toBe('2025-03-06');
    reader.put(georgi, {
      ...loyaltyFixtures.georgi,
      account: {
        ...loyaltyFixtures.georgi.account,
        streaks: { cadence: before },
      },
    });
    expect(await began(georgi)).toBeNull();
  });

  it('hands each client the vouchers issued to them, and nobody the paper one', async () => {
    const reader = InMemoryClientVouchersReader.seeded();
    const codes = async (userId: string) => {
      const held = await reader.listForHolder(userId);
      if (held.isFailure()) throw held.error;
      return held.value.map((voucher) => voucher.code).sort();
    };
    expect(await codes(georgi)).toEqual(['GIFT50', 'SPENT20', 'VOID30']);
    expect(await codes(martin)).toEqual(['GIFT2025']);
    expect(await codes('dev-client-9')).toEqual([]);
  });

  it('reads the activity’s point rows as the ledger reads its tail', async () => {
    const feed = await InMemoryLoyaltyActivityReader.seeded().page(georgi, {
      kind: 'points',
      limit: 5,
      after: null,
    });
    const tail = await InMemoryLoyaltyReader.seeded().listLedgerTail(georgi, 5);
    if (feed.isFailure()) throw feed.error;
    if (tail.isFailure()) throw tail.error;
    expect(
      feed.value.entries.map((row) => ({
        id: row.id,
        seq: row.seq,
        at: row.at,
        delta: row.effect.kind === 'points' ? row.effect.delta : null,
        label: row.label,
      })),
    ).toEqual(
      tail.value.map((row) => ({
        id: row.id,
        seq: row.seq,
        at: row.at,
        delta: row.delta,
        label: row.label,
      })),
    );
    // The balance after the newest row is the account's.
    const [newest] = feed.value.entries;
    expect(newest?.effect).toMatchObject({
      kind: 'points',
      balanceAfter: loyaltyFixtures.georgi.account.balance,
    });
  });
});
