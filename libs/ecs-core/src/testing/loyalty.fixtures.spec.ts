import { describe, expect, it } from 'vitest';
import {
  ActorRole,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubject,
  BadgeSubjectSlot,
  EarnedVia,
  JournalEffect,
  JournalSource,
  JournalVisibility,
  LabelCode,
  Metric,
  PerkId,
  PersonalRecordKind,
  RewardGrant,
  RewardGrantRule,
  Role,
  SeasonKind,
  StreakIntervalSource,
  StreakPeriodMark,
  StreakPhase,
  StreakRule,
  SystemSource,
  StreakState,
  VoucherStatus,
  type StreakHeadRule,
} from '@core/components';
import type { LoyaltyAccount } from '@core/entities';
import {
  AwardKind,
  BarberId,
  CouponId,
  Currency,
  CustomerId,
  JournalEntryId,
  LocationId,
  PriceCents,
  ServiceId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { LoyaltyCatalogSystem, ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_STREAK_OPENED_AT_UTC_MS,
  type LoyaltyClientFixture,
  giftVoucherFixtures,
  giftVouchersJson,
  loyaltyAccountFixtures,
  loyaltyAccountJson,
  loyaltyCatalogFixture,
  loyaltyCatalogJson,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from './loyalty.fixtures';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  localDate,
  unwrapOk,
  utcMs,
} from './test-support';

/*
 * The loyalty fixtures tell ONE story: the flat JSON the dev seed and the
 * e2e seed write, the entities the doubles answer, and the rhythm entities
 * the publish pipeline's specs start from are the same documents. The JSON
 * is held to each entity's SHAPE by `Json<…>` at compile time; here, every
 * closed vocabulary, every variant's narrowing, every T5 day and every
 * figure the dev shop's story tells.
 */

const catalog = loyaltyCatalogFixture();
const CLIENTS: readonly (readonly [string, LoyaltyClientFixture])[] = [
  ['georgi', loyaltyAccountFixtures.georgi],
  ['martin', loyaltyAccountFixtures.martin],
];

/** The shop's day of an instant (T5: what a stored `*LocalDate` must equal). */
function sofiaDayOf(at: UtcEpochMs): string {
  return ZonedTimeSystem.toLocal(at, FIXTURE_TIME_ZONE).localDate;
}

/** The production `Hash` port: sha256 of the UTF-8 input, lower-case hex. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Every phase field a state may carry — exactly its variant's must be present. */
const PHASE_FIELDS = {
  [StreakPhase.Active]: [],
  [StreakPhase.AtRisk]: ['phaseDueBy'],
  [StreakPhase.InGrace]: ['phaseGraceUntil'],
  [StreakPhase.Frozen]: ['phaseFrozenUntil', 'phaseFreezeReason'],
  [StreakPhase.Broken]: ['phaseBrokenOn', 'phaseRepairableUntil'],
} as const satisfies Record<StreakPhase, readonly string[]>;
const ALL_PHASE_FIELDS: readonly string[] = Object.values(PHASE_FIELDS).flat();

/** Every override field — none may stand beside `tierOverrideSource: null`. */
const OVERRIDE_FIELDS: readonly string[] = [
  'tierOverrideTierId',
  'tierOverrideUntil',
  'tierOverrideAwardKey',
  'tierOverrideAdjustmentId',
];

function phaseFieldsOf(state: StreakState): readonly string[] {
  return Object.keys(state).filter((key) => ALL_PHASE_FIELDS.includes(key));
}

describe('the loyalty JSON fixtures — the flat documents as Firestore holds them', () => {
  it('holds every catalogue collection, keyed by collection', () => {
    expect(Object.keys(loyaltyCatalogJson)).toEqual([
      'badgeCategories',
      'badgeSeries',
      'seasons',
      'tierDefinitions',
      'rewardsCatalog',
      'streakDefinitions',
    ]);
    expect(Object.keys(giftVouchersJson)).toEqual(['giftVouchers']);
    expect(Object.keys(loyaltyAccountJson)).toEqual(['georgi', 'martin']);
    for (const json of Object.values(loyaltyAccountJson)) {
      expect(Object.keys(json)).toEqual([
        'uid',
        'customerId',
        'account',
        'badgeProgress',
        'seasonProgress',
        'clientJournal',
      ]);
    }
  });

  it('is deep-frozen: a spec cannot leak a write into the next one', () => {
    const head = loyaltyCatalogJson.streakDefinitions.cadence;
    expect(Object.isFrozen(loyaltyCatalogJson)).toBe(true);
    expect(Object.isFrozen(head.rules[0]?.excuses)).toBe(true);
    expect(Object.isFrozen(giftVouchersJson.giftVouchers)).toBe(true);
    expect(Object.isFrozen(loyaltyAccountJson.georgi.account.streaks)).toBe(
      true,
    );
    expect(() => {
      (head as { updatedAtUtcMs: number }).updatedAtUtcMs = 1;
    }).toThrow(TypeError);
    expect(Object.isFrozen(catalog.series)).toBe(true);
    expect(Object.isFrozen(loyaltyAccountFixtures.georgi.clientJournal)).toBe(
      true,
    );
  });

  it('carries no other variant’s field in a catalogue body — a family’s subject, a reward’s grant (D8)', () => {
    // Each variant's keys read off its companion's own factory; the seed
    // writes each body as it is (Law 5), so a stale field of a variant the
    // body is not would reach Firestore. The compile-time half (a key NO
    // variant declares) is `loyalty.fixtures.type-spec.ts`.
    const subjects = new Map<string | null, readonly string[]>([
      [null, Object.keys(BadgeSubjectSlot.none())],
      [
        BadgeSubject.Service,
        Object.keys(BadgeSubjectSlot.service(ServiceId.of('s'))),
      ],
      [
        BadgeSubject.Barber,
        Object.keys(BadgeSubjectSlot.barber(BarberId.of('b'))),
      ],
      [
        BadgeSubject.Location,
        Object.keys(BadgeSubjectSlot.location(LocationId.of('l'))),
      ],
    ]);
    const grants = new Map<string, readonly string[]>([
      [
        RewardGrant.Coupon,
        Object.keys(RewardGrantRule.coupon(CouponId.of('c'))),
      ],
      [
        RewardGrant.Voucher,
        Object.keys(RewardGrantRule.voucher(PriceCents.ZERO, Currency.EUR, 1)),
      ],
      [
        RewardGrant.Perk,
        Object.keys(RewardGrantRule.perk(PerkId.FreeReschedule, null)),
      ],
    ]);
    /** The body's keys that belong to a variant of `variants` other than `own`. */
    const strangers = (
      body: object,
      own: readonly string[] | undefined,
      variants: ReadonlyMap<unknown, readonly string[]>,
    ): readonly string[] => {
      const foreign = new Set<string>();
      for (const keys of variants.values()) {
        for (const key of keys)
          if (!(own ?? []).includes(key)) foreign.add(key);
      }
      return Object.keys(body).filter((key) => foreign.has(key));
    };
    for (const [id, body] of Object.entries(loyaltyCatalogJson.badgeSeries)) {
      const own = subjects.get(body.badgeSubject);
      expect([id, own === undefined]).toEqual([id, false]);
      expect([id, strangers(body, own, subjects)]).toEqual([id, []]);
    }
    for (const [id, body] of Object.entries(
      loyaltyCatalogJson.rewardsCatalog,
    )) {
      const own = grants.get(body.rewardGrant);
      expect([id, own === undefined]).toEqual([id, false]);
      expect([id, strangers(body, own, grants)]).toEqual([id, []]);
    }
    // The check is loud: a SERVICE family carrying a barber's id is caught.
    expect(
      strangers(
        {
          badgeSubject: BadgeSubject.Service,
          subjectServiceId: 's',
          subjectBarberId: 'b',
        },
        subjects.get(BadgeSubject.Service),
        subjects,
      ),
    ).toEqual(['subjectBarberId']);
  });

  it('is dated before FIXTURE_TODAY, the day it is true on', () => {
    const [current] = streakDefinitionFixture().rules;
    expect(current?.effectiveFromLocalDate).toBe('2025-03-01');
    expect(
      (current?.effectiveFromLocalDate ?? FIXTURE_TODAY) < FIXTURE_TODAY,
    ).toBe(true);
  });
});

describe('loyaltyCatalogFixture — the catalogue as LoadLoyaltyCatalog answers it', () => {
  it('spreads each document id in, every collection in Firestore’s id order', () => {
    expect(catalog.categories.map((c) => c.id)).toEqual(
      Object.keys(loyaltyCatalogJson.badgeCategories).sort(),
    );
    expect(catalog.series).toHaveLength(42);
    expect(catalog.series.map((s) => s.id)).toEqual(
      Object.keys(loyaltyCatalogJson.badgeSeries).sort(),
    );
    expect(catalog.seasons.map((s) => s.id)).toEqual([
      'event-2026-beard-week',
      'season-2026-autumn',
      'season-2026-summer',
    ]);
    expect(catalog.tiers.map((t) => t.id)).toEqual([
      'bronze',
      'gold',
      'platinum',
      'silver',
    ]);
    expect(catalog.rewards.map((r) => r.id)).toEqual([
      'reward-beard',
      'reward-cut',
      'reward-product',
    ]);
    expect(catalog.streaks.map((h) => h.id)).toEqual(['cadence']);
    expect(loyaltyCatalogFixture()).toBe(catalog);
  });

  it('holds together: the system takes it unmapped and puts it in display order', () => {
    const valid = unwrapOk(LoyaltyCatalogSystem.validate(catalog));
    expect(valid.tiers.map((t) => t.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
    ]);
    expect(valid.categories.map((c) => c.id)).toEqual([
      'cat-milestones',
      'cat-mastery',
      'cat-barbers',
      'cat-rhythm',
      'cat-special',
      'cat-records',
    ]);
  });

  it('speaks only the closed vocabularies, SCREAMING where they are tags', () => {
    for (const category of catalog.categories) {
      expect(Object.values(BadgeCategoryKind)).toContain(
        category.badgeCategoryKind,
      );
    }
    for (const family of catalog.series) {
      expect(Object.values(BadgeEmblem), family.id).toContain(family.emblem);
      expect([null, ...Object.values(Metric)], family.id).toContain(
        family.metric,
      );
      expect([null, ...Object.values(BadgeSubject)], family.id).toContain(
        family.badgeSubject,
      );
      for (const level of family.levels) {
        for (const award of level.awards) {
          expect(Object.values(AwardKind)).toContain(award.awardKind);
        }
      }
      // A one-off act (no metric) narrows nothing.
      if (family.metric === null) {
        expect(family.metricWindowDays).toBeNull();
        expect(family.metricScopeServiceId).toBeNull();
      }
      // Never retired: the T5 pair is null together.
      expect(family.retiredAtUtcMs).toBeNull();
      expect(family.retiredLocalDate).toBeNull();
      expect(family.artPath).toBeNull();
    }
    for (const season of catalog.seasons) {
      expect(Object.values(SeasonKind)).toContain(season.seasonKind);
      expect(Object.values(BadgeEmblem)).toContain(season.emblem);
    }
    for (const tier of catalog.tiers) {
      expect(Object.values(Metric)).toContain(tier.qualifyMetric);
      for (const perk of tier.benefits) {
        expect(Object.values(PerkId)).toContain(perk);
      }
    }
    for (const reward of catalog.rewards) {
      expect(Object.values(RewardGrant)).toContain(reward.rewardGrant);
    }
  });

  it('narrows each family on its subject: a variant declares only its own id', () => {
    const fade = catalog.series.find((s) => s.id === 'series-svc-fade');
    expect(fade).toMatchObject({
      badgeSubject: 'SERVICE',
      subjectServiceId: 'svc-fade',
      metric: 'client.visits.completed',
      metricWindowDays: null,
      metricScopeServiceId: 'svc-fade',
      metricScopeBarberId: null,
      metricScopeLocationId: null,
    });
    expect(fade !== undefined && 'subjectBarberId' in fade).toBe(false);
    const ivan = catalog.series.find((s) => s.id === 'series-barber-ivan');
    expect(ivan).toMatchObject({
      badgeSubject: 'BARBER',
      subjectBarberId: 'ivan',
      metricScopeBarberId: 'ivan',
    });
    for (const family of catalog.series) {
      if (family.badgeSubject === null) {
        expect(
          Object.keys(family).filter((key) => key.startsWith('subject')),
        ).toEqual([]);
      }
    }
  });

  it('writes every T5 pair from one reading: each stored day is the Sofia day of its instant', () => {
    for (const season of catalog.seasons) {
      expect(season.announcedLocalDate, season.id).toBe(
        sofiaDayOf(season.announcedAtUtcMs),
      );
    }
    const autumn = catalog.seasons.find((s) => s.id === 'season-2026-autumn');
    expect(autumn).toMatchObject({
      seasonKind: 'SEASON',
      windowFrom: '2026-09-01',
      windowUntil: '2026-11-30',
      announcedAtUtcMs: utcMs('2026-08-01T06:00:00.000Z'),
      announcedLocalDate: '2026-08-01',
    });
    // A tier starts at a shop-day boundary (D24): the day of today's instant.
    for (const tier of catalog.tiers) {
      expect(tier.effectiveFromLocalDate).toBe('2025-03-01');
      expect(tier.qualifyWindowDays).toBe(365);
    }
  });

  it('keeps every figure: the tiers’ ladder, the rewards’ costs and limits', () => {
    expect(
      [...catalog.tiers]
        .sort((a, b) => a.rank - b.rank)
        .map((t) => [t.id, t.qualifyAtLeast]),
    ).toEqual([
      ['bronze', 0],
      ['silver', 6],
      ['gold', 12],
      ['platinum', 20],
    ]);
    expect(catalog.rewards.map((r) => [r.id, r.cost, r.rewardGrant])).toEqual([
      ['reward-beard', 120, 'COUPON'],
      ['reward-cut', 250, 'COUPON'],
      ['reward-product', 400, 'VOUCHER'],
    ]);
    const product = catalog.rewards.find((r) => r.id === 'reward-product');
    // The one voucher reward carries its currency beside its cents (F3-5).
    expect(product).toMatchObject({
      grantVoucherCents: 2000,
      grantVoucherCurrency: 'EUR',
      grantVoucherExpiresInDays: 90,
      perClientLimitCount: 1,
      perClientLimitWindowDays: 90,
      totalLimit: null,
    });
    expect(catalog.rewards.find((r) => r.id === 'reward-beard')).toMatchObject({
      grantCouponId: 'coupon-free-beard',
      perClientLimitCount: 1,
      perClientLimitWindowDays: 30,
      redeemedCount: 1,
    });
  });

  // The four coverage checks of the legacy `testing.spec.ts` (flip 3,
  // §11.3), carried over the flat fixture: the rules are the systems', the
  // run over the dev shop's catalogue is this file's.
  it('draws every emblem somewhere', () => {
    const drawn = new Set<string>();
    for (const family of catalog.series) drawn.add(family.emblem);
    for (const season of catalog.seasons) drawn.add(season.emblem);
    expect([...drawn].sort()).toEqual(Object.values(BadgeEmblem).sort());
  });

  it('writes every text in both locales', () => {
    const texts: { bg: unknown; en: unknown }[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      const keys = Object.keys(value).sort();
      if (keys.length === 2 && keys[0] === 'bg' && keys[1] === 'en') {
        texts.push(value as { bg: unknown; en: unknown });
        return;
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(catalog);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(typeof text.bg === 'string' && text.bg.trim().length > 0).toBe(
        true,
      );
      expect(typeof text.en === 'string' && text.en.trim().length > 0).toBe(
        true,
      );
    }
  });

  it('climbs every family I…n with rising targets; a one-off or a yearly family has one level', () => {
    for (const family of catalog.series) {
      expect(
        family.levels.map((l) => l.level),
        family.id,
      ).toEqual(family.levels.map((_, i) => i + 1));
      const targets = family.levels.map((l) => l.target);
      if (targets.includes(null) || family.repeatable) {
        expect(family.levels, family.id).toHaveLength(1);
      }
      // Only a figure-free act has no target; a counted family always has one.
      if (family.metric !== null) {
        expect(targets.includes(null), family.id).toBe(false);
      }
    }
  });

  it('gives every level its own once-rule and pays in positive whole amounts', () => {
    const rules = catalog.series.flatMap((s) => s.levels.map((l) => l.ruleId));
    expect(new Set(rules).size).toBe(rules.length);
    for (const family of catalog.series) {
      for (const award of family.levels.flatMap((l) => l.awards)) {
        if (award.awardKind === AwardKind.Points) {
          expect(
            Number.isInteger(award.awardPoints) && award.awardPoints > 0,
          ).toBe(true);
        }
        if (award.awardKind === AwardKind.Freeze) {
          expect(
            Number.isInteger(award.awardFreezeCount) &&
              award.awardFreezeCount > 0,
          ).toBe(true);
        }
      }
    }
  });

  it('dates every season inclusively', () => {
    for (const season of catalog.seasons) {
      expect(season.windowFrom <= season.windowUntil, season.id).toBe(true);
    }
  });

  it('carries the rhythm’s head, whose every rule passes the rule’s own guard', () => {
    expect(catalog.streaks).toEqual([streakDefinitionFixture()]);
    for (const head of catalog.streaks) {
      for (const rule of head.rules) {
        expect(StreakRule.parse(rule).ok, head.id).toBe(true);
      }
    }
  });
});

describe('loyaltyAccountFixtures — two account holders, keyed by their client records (D29)', () => {
  it.each(CLIENTS)(
    '%s: the record id is CustomerId.forUser(uid) with the production sha256',
    async (_name, client) => {
      const hex = await sha256Hex(`customer/v1:${client.uid}`);
      expect(client.customerId).toBe(
        CustomerId.forUser(UserId.of(client.uid), () => hex),
      );
      expect(client.customerId).toMatch(/^cus_[0-9a-f]{20}$/);
      expect(client.account.id).toBe(client.customerId);
      expect(client.account.customerId).toBe(client.customerId);
      expect('userId' in client.account).toBe(false);
    },
  );

  it('names the dev seed’s two account holders', () => {
    expect(loyaltyAccountFixtures.georgi.uid).toBe('dev-client-1');
    expect(loyaltyAccountFixtures.martin.uid).toBe('dev-client-2');
    expect(loyaltyAccountFixtures.georgi.customerId).toBe(
      'cus_f4139a95b87f17ee035d',
    );
    expect(loyaltyAccountFixtures.martin.customerId).toBe(
      'cus_64f1b6925a19e579d85b',
    );
  });

  it.each(CLIENTS)(
    '%s: each account body is exactly one variant of every slice',
    (_name, client) => {
      const account: LoyaltyAccount = client.account;
      // No override stands, and no override field beside it.
      expect(account.tierOverrideSource).toBeNull();
      expect(
        Object.keys(account).filter((key) => OVERRIDE_FIELDS.includes(key)),
      ).toEqual([]);
      expect(account.pointsExpireOn).toBeNull();
      expect(account.pointsExpiryNoticeFrom).toBeNull();
      expect(account.streaks).toHaveLength(1);
      for (const state of account.streaks) {
        expect(Object.values(StreakPhase)).toContain(state.streakPhase);
        expect(phaseFieldsOf(state)).toEqual([
          ...PHASE_FIELDS[state.streakPhase],
        ]);
        expect(state.periodSource).toBe(StreakIntervalSource.Fixed);
        for (const period of state.periods) {
          expect(Object.values(StreakPeriodMark)).toContain(
            period.streakPeriodMark,
          );
        }
        // The four once-optional fields are always written (F3-7).
        for (const key of [
          'periodIntervalDays',
          'periods',
          'heldByAppointmentId',
          'heldOn',
          'runStartedOn',
        ]) {
          expect(Object.hasOwn(state, key), key).toBe(true);
        }
      }
      for (const record of account.records) {
        expect(Object.values(PersonalRecordKind)).toContain(
          record.personalRecordKind,
        );
      }
    },
  );

  it('tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm', () => {
    const { account, badgeProgress, seasonProgress } =
      loyaltyAccountFixtures.georgi;
    expect(account).toMatchObject({
      balance: 358,
      lifetimeEarned: 608,
      lifetimeSpent: 250,
      tierId: 'gold',
      nextTierId: 'platinum',
      tierRemaining: 6,
      tierQualifying: 14,
      tierSinceUtcMs: utcMs('2025-11-11T08:45:00.000Z'),
      seq: 35,
      version: 26,
      updatedAtUtcMs: utcMs('2026-09-28T07:45:00.000Z'),
    });
    expect(account.punchCards.map((p) => [p.filled, p.size])).toEqual([
      [4, 10],
    ]);
    const cadence = StreakState.find(
      account.streaks,
      StreakRule.DEFAULT_DEFINITION_ID,
    );
    expect(cadence).toMatchObject({
      streakPhase: 'ACTIVE',
      current: 24,
      best: 24,
      dueBy: '2026-11-09',
      lastQualifiedAtUtcMs: utcMs('2026-09-28T07:00:00.000Z'),
      heldByAppointmentId: null,
      heldOn: null,
      runStartedOn: '2025-03-06',
    });
    expect(cadence?.periods).toHaveLength(12);
    expect(badgeProgress.reduce((n, p) => n + p.earned.length, 0)).toBe(37);
    expect(seasonProgress.map((s) => [s.id, s.trackLevel])).toEqual([
      ['season-2026-autumn', 2],
      ['season-2026-summer', 3],
    ]);
  });

  it('tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit', () => {
    const { account, badgeProgress } = loyaltyAccountFixtures.martin;
    expect(account).toMatchObject({
      balance: 215,
      lifetimeEarned: 335,
      lifetimeSpent: 120,
      tierId: 'silver',
      nextTierId: 'gold',
      tierRemaining: 3,
      seq: 18,
    });
    expect(account.punchCards.map((p) => [p.filled, p.size])).toEqual([
      [3, 10],
    ]);
    expect(
      StreakState.find(account.streaks, StreakRule.DEFAULT_DEFINITION_ID),
    ).toMatchObject({
      streakPhase: 'AT_RISK',
      phaseDueBy: '2026-09-30',
      current: 13,
      heldByAppointmentId: 'appt-dev-2',
      heldOn: '2026-09-28',
    });
    expect(badgeProgress.reduce((n, p) => n + p.earned.length, 0)).toBe(28);
  });

  it.each(CLIENTS)(
    '%s: earned levels carry their instant and its Sofia day (T5)',
    (_name, client) => {
      for (const progress of client.badgeProgress) {
        for (const level of progress.earned) {
          expect(level.earnedLocalDate, progress.id).toBe(
            sofiaDayOf(level.earnedAtUtcMs),
          );
          expect(Object.values(EarnedVia)).toContain(level.earnedVia);
        }
      }
    },
  );

  it.each(CLIENTS)(
    '%s: the journal is the account’s, dense by seq, folding to its balance',
    (_name, client) => {
      const { account, clientJournal, customerId } = client;
      expect(clientJournal.map((row) => row.seq)).toEqual(
        clientJournal.map((_row, i) => i + 1),
      );
      expect(clientJournal.at(-1)?.seq).toBe(account.seq);
      let balance = 0;
      for (const row of clientJournal) {
        expect(row.id).toBe(JournalEntryId.forEntry(customerId, row.seq));
        expect(row.customerId).toBe(customerId);
        expect(row.localDate, row.id).toBe(sofiaDayOf(row.utcEpochMs));
        expect(row.journalVisibility).toBe(JournalVisibility.Client);
        expect(Object.values(LabelCode)).toContain(row.labelCode);
        expect(row.journalEffect).toBe(JournalEffect.Points);
        expect([JournalSource.Rule, JournalSource.Redemption]).toContain(
          row.journalSource,
        );
        expect(Object.values(ActorRole)).toContain(row.actorRole);
        if (row.journalEffect === JournalEffect.Points) {
          balance += row.pointsDelta;
        }
        expect(row.balanceAfter, row.id).toBe(balance);
        // The visit is the row's root `appointmentId`, read off today's
        // `appt:{id}:…` correlation (the text itself is kept as written).
        const visit = /^appt:([^:]+)/.exec(row.correlationId);
        expect(row.appointmentId).toBe(visit === null ? null : visit[1]);
      }
      expect(balance).toBe(account.balance);
    },
  );

  it('keeps each label’s params as named pairs, in the order they were written', () => {
    const [first, second] = loyaltyAccountFixtures.georgi.clientJournal;
    expect(first?.labelParams).toEqual([
      { name: 'rule', value: 'rule-earn-per-euro' },
      { name: 'points', value: 17 },
      { name: 'spendMinor', value: 1750 },
    ]);
    expect(second?.labelParams).toEqual([
      { name: 'rule', value: 'rule-welcome-1' },
      { name: 'points', value: 20 },
      { name: 'seriesId', value: 'series-welcome' },
      { name: 'level', value: 1 },
    ]);
  });

  it('names who acted by account (UserId), whom it rewarded by record — never one for the other', () => {
    const rows = [
      ...loyaltyAccountFixtures.georgi.clientJournal,
      ...loyaltyAccountFixtures.martin.clientJournal,
    ];
    const actors = new Set(
      rows.map((row) =>
        row.actorRole === ActorRole.System
          ? `${row.actorRole}:${row.actorSystemSource}`
          : row.actorRole === ActorRole.Admin
            ? `${row.actorRole}:${row.actorAdminUserId}`
            : row.actorRole === ActorRole.Staff
              ? `${row.actorRole}:${row.actorUserId}:${row.actorRoles.join()}`
              : row.actorRole,
      ),
    );
    expect([...actors].sort()).toEqual([
      `ADMIN:dev-staff-ivan`,
      `STAFF:dev-staff-niko:${Role.Barber}`,
      `SYSTEM:${SystemSource.LoyaltyEngine}`,
    ]);
  });
});

describe('streakDefinitionFixture — catalog.json’s head, as the entity', () => {
  it('is the recommended rule the JSON opens with, in the ECS shape', () => {
    expect(streakDefinitionFixture()).toEqual({
      id: 'cadence',
      name: loyaltyCatalogJson.streakDefinitions.cadence.name,
      rules: [
        {
          ...StreakRule.DEFAULT,
          headRole: 'CURRENT',
          streakTransition: null,
        },
      ],
      updatedAtUtcMs:
        loyaltyCatalogJson.streakDefinitions.cadence.updatedAtUtcMs,
    });
    const [current] = streakDefinitionFixture().rules;
    expect(current === undefined ? null : StreakRule.sliceOf(current)).toEqual(
      StreakRule.DEFAULT,
    );
  });

  it('pins the opening instant as a literal that agrees with the JSON', () => {
    expect(FIXTURE_STREAK_OPENED_AT_UTC_MS).toBe(
      utcMs('2025-03-01T07:00:00.000Z'),
    );
    expect(FIXTURE_STREAK_OPENED_AT_UTC_MS).toBe(
      loyaltyCatalogJson.streakDefinitions.cadence.updatedAtUtcMs,
    );
  });

  it('takes overrides field by field', () => {
    const scheduled: StreakHeadRule = {
      ...StreakRule.DEFAULT,
      version: 2,
      effectiveFromLocalDate: localDate('2026-10-05'),
      graceDays: 10,
      headRole: 'SCHEDULED',
      streakTransition: 'GRANDFATHER',
    };
    const rules = [...streakDefinitionFixture().rules, scheduled];
    expect(streakDefinitionFixture({ rules })).toEqual({
      ...streakDefinitionFixture(),
      rules,
    });
  });
});

describe('streakDefinitionVersionFixture — the history the seed gives the head', () => {
  it('is version 000001: the rule in force, published by nobody by hand, never withdrawn', () => {
    expect(streakDefinitionVersionFixture()).toEqual({
      ...StreakRule.DEFAULT,
      id: '000001',
      publishedAtUtcMs: FIXTURE_STREAK_OPENED_AT_UTC_MS,
      publishedByUserId: 'system',
      streakTransition: 'GRANDFATHER',
      streakRuleDirection: 'NEUTRAL',
      changed: [],
      requestId: 'seed-cadence-000001',
      withdrawnAtUtcMs: null,
    });
  });

  it('takes overrides field by field', () => {
    const withdrawnAtUtcMs = unwrapOk(UtcEpochMs.of(1));
    expect(
      streakDefinitionVersionFixture({ withdrawnAtUtcMs }).withdrawnAtUtcMs,
    ).toBe(1);
  });
});

describe('giftVoucherFixtures — the five vouchers as the vouchers port answers them', () => {
  const vouchers = giftVoucherFixtures();

  it('spreads each document id in, in Firestore’s id order, the body as stored', () => {
    const stored = Object.entries(giftVouchersJson.giftVouchers);
    expect(vouchers.map((voucher) => voucher.id)).toEqual(
      stored.map(([id]) => id).sort(),
    );
    for (const { id, ...body } of vouchers) {
      expect(body, id).toEqual(new Map(stored).get(id));
    }
  });

  it('holds five vouchers, each under its own code, never more left than was issued', () => {
    expect(vouchers).toHaveLength(5);
    expect(new Set(vouchers.map((voucher) => voucher.code)).size).toBe(5);
    for (const voucher of vouchers) {
      expect(Number.isInteger(voucher.balanceCents), voucher.id).toBe(true);
      expect(voucher.balanceCents, voucher.id).toBeGreaterThanOrEqual(0);
      expect(voucher.balanceCents, voucher.id).toBeLessThanOrEqual(
        voucher.initialValueCents,
      );
      expect(Object.values(VoucherStatus), voucher.id).toContain(
        voucher.voucherStatus,
      );
    }
  });

  it('hands them out frozen, all the way down', () => {
    expect(Object.isFrozen(vouchers)).toBe(true);
    for (const voucher of vouchers) {
      expect(Object.isFrozen(voucher), voucher.id).toBe(true);
    }
    expect(giftVoucherFixtures()).toBe(vouchers);
  });
});
