/**
 * The seed's loyalty documents, held to the flat archetypes the client card
 * reads them as (flip 3: `@core/entities`, the fixtures of `@core/testing`)
 * and to the production code that reads the same book: the projection has
 * the fixtures' SHAPE (not their numbers), «Посещения» is what
 * `computeClientStats` counts, the balance is the sum of the rows, every
 * level was earned by a count that reached it, and every instant beside its
 * shop day is one reading of the shop's clock (T5) — on the fixtures' own
 * day and on days spread over two years (§7.5 «Seed»). Every document the
 * seed writes for the client card — the catalogue, both accounts, Мартин's
 * waitlist request — goes through the two run-time checks the seed keeps
 * (`readLoyaltyWrites`: `LoyaltyCatalogSystem.validate`, `StreakRule.parse`)
 * as the seed's bundle holds them; a body's shape is the type checker's
 * (`fixtures/loyalty.fixtures.ts`, `pnpm nx typecheck seed-tools`).
 *
 * The fold's rules — the tier's rolling window, the refusals — are pinned on
 * small hand-built books. The rhythm's clock is the DOMAIN's
 * (client-card-revision-3.md §4.2): the fold hands `StreakSystem.trace` the
 * book as facts, so the rhythm's cases here hold the seed to the books the
 * old copy of the clock was pinned on, and to the rule the shop has in
 * force. Every case pins its own clock (`NOW`, the `ANCHORS`): none reads
 * the wall clock.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BarberPreference,
  CancellationReason,
  CancelledBy,
  ClientStatsPolicy,
  HeadRole,
  JournalFeed,
  LabelCode,
  Placement,
  PublicLabel,
  SeasonPhase,
  StreakRule,
  StreakState,
  WaitlistLifecycle,
} from '@core/components';
import { Collections, Subcollections } from '@core/entities';
import { clientStatsOf } from '@core/pipelines';
import { JournalEntryId, StreakDefinitionVersionId } from '@core/primitives';
import {
  LoyaltyCatalogSystem,
  StreakRuleSystem,
  StreakSystem,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  FIXTURE_TODAY,
  loyaltyAccountJson,
  loyaltyCatalogJson,
  memoryStreakDefinitionPorts,
  memoryStreakWorld,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from '@core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { appointmentDocumentOf } from './appointments.mjs';
import { createShopCalendar } from './calendar.mjs';
import { buildClientBook } from './fixtures.mjs';
import {
  WORKED_SEAT,
  accountSeat,
  calledOffBefore,
} from './fixtures/appointments.fixtures.ts';
import { customerIdOf } from './fixtures/customers.fixtures.ts';
import { loadSeedDomain } from './load-domain.mjs';
import {
  BADGE_PROGRESS_COLLECTION,
  CLIENT_JOURNAL_COLLECTION,
  LOYALTY_ACCOUNTS_COLLECTION,
  LOYALTY_CATALOG_PARTS,
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  PUNCH_CARD,
  SEASON_PROGRESS_COLLECTION,
  SEED_RULE_PUBLISHER,
  STREAK_DEFINITIONS_COLLECTION,
  STREAK_DEFINITION_VERSIONS_COLLECTION,
  catalogAsHeld,
  loyaltyCatalogDriftOf,
  loyaltyCatalogFor,
  loyaltyCatalogWritesOf,
  loyaltyWritesOf,
  projectLoyaltyFor,
  punchCardGrantsOf,
  readLoyaltyWrites,
  redemptionGrantIdOf,
  redemptionGrantsOf,
  rulesPublishedOver,
  seedRuleVersionWriteOf,
  stampGrantIdOf,
  withoutPublishedRules,
  workedVisitsOf,
} from './loyalty.mjs';
import { seedRuleRequestIdOf } from './fixtures/loyalty.fixtures.ts';
import {
  SEEDED_WAITLIST_REQUEST,
  WAITLIST_REQUESTS_COLLECTION,
  waitlistRequestWriteOf,
} from './waitlist.mjs';

const ZONE = 'Europe/Sofia';
const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** The shop day of an instant (epoch ms), read independently of the seed. */
const sofiaDay = (instant) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(
    new Date(instant),
  );

/** The fixtures' day, in the evening: Георги's 10:00 cut is done, Мартин is still due. */
const NOW = Date.parse('2026-09-28T20:00:00+03:00');

/** Early morning on days spread over two years, plus the awkward ones. */
const ANCHORS = [
  ...Array.from(
    { length: 10 },
    (_, i) => Date.parse('2026-01-02T07:30:00+02:00') + i * 73 * DAY_MS,
  ),
  Date.parse('2026-03-29T07:30:00+03:00'), // spring forward
  Date.parse('2026-10-25T07:30:00+02:00'), // fall back
  Date.parse('2028-02-29T07:30:00+02:00'), // a leap day
];

/**
 * What the fold and the read-back are handed, imported the ordinary way:
 * the production code the seed's bundle holds (`load-domain.spec.mjs`
 * holds the two equal), so every case below folds through the domain's own
 * projector and reads back through the domain's own checks.
 */
const DOMAIN = {
  StreakSystem,
  StreakRuleSystem,
  StreakRule,
  LoyaltyCatalogSystem,
};

/** Every label code a row may carry — the dictionary's values. */
const LABEL_CODES = Object.values(LabelCode);

/** The feed's pills, all of them: the effects a row the feed shows may have (`JournalFeed`). */
const FEED = JournalFeed.effectsOf(JournalFeed.All);

/** What no appointment says about a holder: the seed's own `facts`. */
function factsOf(book, holder) {
  const user = book.users.find((entry) => entry.uid === holder.uid);
  return {
    // Neither holder has a portrait in Storage (wave D r6): the seed
    // holds no client's photo, and a barber's is not theirs.
    profile: {
      email: user.doc.email,
      birthDate: user.doc.birthDate,
      hasAvatar: false,
    },
    redemptions: holder.redemptions,
    stampGrants: holder.stampGrants,
  };
}

/** Everything the seed passes for a holder on the book of `nowMs`, under `catalog`'s rule. */
function seeded(nowMs, catalogOf = loyaltyCatalogFor) {
  const book = buildClientBook(nowMs);
  const today = book.calendar.dayKeyAt(0);
  const catalog = catalogOf(today);
  const project = (holder) =>
    projectLoyaltyFor(
      DOMAIN,
      holder.uid,
      book.appointments,
      catalog,
      today,
      factsOf(book, holder),
    );
  return { book, today, catalog, project };
}

/** The catalogue of `today` under another rule: `revise` is handed the seed's head and answers the shop's. */
const catalogUnder = (revise) => (today) => {
  const catalog = loyaltyCatalogFor(today);
  catalog.streakDefinitions.cadence = revise(
    catalog.streakDefinitions.cadence,
    today,
  );
  return catalog;
};

/** A head's element in one role. */
const inRole = (head, role) =>
  head.rules.find((rule) => rule.headRole === role);

/**
 * A flat rule patched as an admin's change would leave it — a PERSONAL
 * interval drops the FIXED one's `intervalDays` (one variant per rule).
 */
const revised = (rule, patch) => {
  const next = { ...rule, ...patch };
  if (next.streakInterval === 'PERSONAL') delete next.intervalDays;
  return next;
};

/** Version 2 of the seed's rule, in force: what a publish leaves in the head. */
const published = (patch) => (head) => ({
  ...head,
  rules: [revised({ ...inRole(head, HeadRole.Current), version: 2 }, patch)],
  updatedAtUtcMs: Date.parse('2026-06-01T09:00:00.000Z'),
});

/** The rhythm's state of an account under the `cadence` rule, or `null`. */
const cadenceOf = (acc) => StreakState.find(acc.streaks, 'cadence');

const pointsOf = (journal) =>
  Object.values(journal).filter((row) => row.journalEffect === 'POINTS');
const rowsOf = (journal, effect) =>
  Object.values(journal).filter((row) => row.journalEffect === effect);

/**
 * `uid`'s client stats as the trigger projects them — `clientStatsOf` of
 * `@core/pipelines` over the flat bodies, as entities (`{ id, ...doc }`,
 * Law 5: no mapper), for the client record the seed derives for `uid`.
 */
function statsOf(book, uid, nowMs) {
  return clientStatsOf(
    customerIdOf(uid),
    book.appointments.map(({ id, doc }) => ({ id, ...doc })),
    ClientStatsPolicy.DEFAULT,
    ZonedTimeSystem.shopNow(nowMs, ZONE),
  ).stats;
}

/**
 * A value's shape: the kinds of its values key by key; an array is the set
 * of its members' shapes. Maps keyed by ids are compared as the set of
 * their values' shapes (`shapesOf`), so a shape says what a document IS,
 * never which families or rows it happens to hold.
 */
function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { '[]': shapesOf(value) };
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shapeOf(value[key])]),
    );
  }
  return typeof value;
}
const shapesOf = (values) =>
  [...new Set(values.map((value) => JSON.stringify(shapeOf(value))))].sort();

/** Every invariant a reader leans on, for one holder's projection. */
function expectConsistent(projection, { uid, book, catalog, today, nowMs }) {
  const {
    account: acc,
    badgeProgress,
    seasonProgress,
    clientJournal,
  } = projection;
  const rows = Object.entries(clientJournal);
  const entries = rows.map(([, row]) => row);
  const points = pointsOf(clientJournal);
  const customerId = customerIdOf(uid);

  // Keyed by the client RECORD (D29), never by the account.
  expect(projection.uid).toBe(uid);
  expect(projection.customerId).toBe(customerId);
  expect(acc.customerId).toBe(customerId);

  // «Посещения» is clientStats' completed visits.
  const stats = statsOf(book, uid, nowMs);
  expect(badgeProgress['series-visits']?.value, uid).toBe(
    stats.lifetimeVisitsCompleted,
  );

  // Dense over EVERY row, keyed, in time order; the balance runs over the
  // point rows alone, and every row says what it leaves.
  let running = 0;
  rows.forEach(([id, row], i) => {
    expect(row.customerId).toBe(customerId);
    expect(row.seq).toBe(i + 1);
    expect(id).toBe(JournalEntryId.forEntry(customerId, row.seq));
    if (i > 0) expect(row.utcEpochMs >= entries[i - 1].utcEpochMs).toBe(true);
    // T5: the row's shop day is the day of its instant, read once.
    expect(row.localDate, id).toBe(sofiaDay(row.utcEpochMs));
    if (row.journalEffect === 'POINTS') running += row.pointsDelta;
    expect(row.balanceAfter, id).toBe(running);
    expect(row.journalVisibility).toBe('CLIENT');
    expect(row.reverses).toBeNull();
    expect(LABEL_CODES, id).toContain(row.labelCode);
    // The feed shows these five and no other (§4.7).
    expect(FEED, id).toContain(row.journalEffect);
    // A visit's points name the visit at the root; no other event does.
    expect(row.appointmentId, id).toBe(
      row.correlationId.startsWith('appt:')
        ? row.correlationId.slice('appt:'.length)
        : null,
    );
  });
  expect(acc.seq).toBe(entries.length);
  expect(acc.balance).toBe(running);
  expect(acc.balance).toBe(
    acc.lifetimeEarned + acc.lifetimeAdjusted - acc.lifetimeSpent,
  );
  expect(acc.lifetimeSpent).toBe(
    -points
      .filter((row) => row.journalSource === 'REDEMPTION')
      .reduce((sum, row) => sum + row.pointsDelta, 0),
  );
  expect(acc.updatedAtUtcMs >= (entries.at(-1)?.utcEpochMs ?? 0)).toBe(true);
  expect(acc.version).toBeGreaterThanOrEqual(
    new Set(entries.map((row) => row.utcEpochMs)).size,
  );
  // A row is written once: no two share an idempotency key.
  expect(new Set(entries.map((row) => row.idempotencyKey)).size).toBe(
    entries.length,
  );

  // Every family's levels are contiguous, targets rising.
  for (const [id, series] of Object.entries(catalog.badgeSeries)) {
    expect(
      series.levels.map((level) => level.level),
      id,
    ).toEqual(series.levels.map((_, i) => i + 1));
    const targets = series.levels
      .map((level) => level.target)
      .filter((target) => target !== null);
    expect(
      targets.every((target, i) => i === 0 || target > targets[i - 1]),
      id,
    ).toBe(true);
  }

  // Levels earned bottom-up, in time order, by a count that reached them.
  for (const [seriesId, progress] of Object.entries(badgeProgress)) {
    const series = catalog.badgeSeries[seriesId];
    expect(series, seriesId).toBeDefined();
    expect(progress.earned.map((earned) => earned.level)).toEqual(
      progress.earned.map((_, i) => i + 1),
    );
    progress.earned.forEach((earned, i) => {
      if (i > 0) {
        expect(
          earned.earnedAtUtcMs >= progress.earned[i - 1].earnedAtUtcMs,
        ).toBe(true);
      }
      // T5: the level's shop day is the day of its instant, read once.
      expect(earned.earnedLocalDate, seriesId).toBe(
        sofiaDay(earned.earnedAtUtcMs),
      );
      expect(earned.earnedLocalDate <= today, seriesId).toBe(true);
      expect(earned.earnedVia, seriesId).toBe('RULE');
    });
    const monotonic =
      series.metric !== null && series.metricWindowDays === null;
    if (!monotonic) continue;
    for (const earned of progress.earned) {
      expect(progress.value, seriesId).toBeGreaterThanOrEqual(
        series.levels[earned.level - 1].target,
      );
    }
    const next = series.levels[progress.earned.length];
    if (next?.target != null) {
      expect(progress.value, seriesId).toBeLessThan(next.target);
    }
  }

  // A seat pays a point per whole euro; a level what the catalogue says, as it is earned.
  for (const row of points) {
    if (row.journalSource === 'REDEMPTION') {
      expect(-row.pointsDelta).toBe(
        catalog.rewardsCatalog[PublicLabel.param(row, 'reward')].cost,
      );
      continue;
    }
    expect(row.idempotencyKey).toBe(`award:${row.sourceAwardKey}#0`);
    const seriesId = PublicLabel.param(row, 'seriesId');
    if (seriesId === null) {
      expect(row.pointsDelta).toBe(
        Math.floor(PublicLabel.param(row, 'spendMinor') / 100),
      );
      continue;
    }
    const level =
      catalog.badgeSeries[seriesId].levels[PublicLabel.param(row, 'level') - 1];
    expect(row.sourceRuleId).toBe(level.ruleId);
    expect(level.awards).toContainEqual({
      awardKind: 'POINTS',
      awardPoints: row.pointsDelta,
    });
    expect(
      badgeProgress[seriesId].earned.find(
        (earned) => earned.level === level.level,
      )?.earnedAtUtcMs,
    ).toBe(row.utcEpochMs);
  }

  // A level earned is a row of its own: as many rows as times earned, the
  // newest at the instant the progress says; what it pays is in ITS event.
  const levelRows = rowsOf(clientJournal, 'ACHIEVEMENT');
  expect(levelRows).toHaveLength(
    Object.values(badgeProgress).reduce(
      (sum, progress) =>
        sum + progress.earned.reduce((times, e) => times + e.count, 0),
      0,
    ),
  );
  for (const row of levelRows) {
    const seriesId = PublicLabel.param(row, 'seriesId');
    const level = PublicLabel.param(row, 'level');
    const rule = PublicLabel.param(row, 'rule');
    const catalogued = catalog.badgeSeries[seriesId].levels[level - 1];
    expect(row.labelCode).toBe('achievement.earned');
    expect(row).toMatchObject({
      journalEffect: 'ACHIEVEMENT',
      achievementRuleId: rule,
      achievementRuleVersion: catalog.badgeSeries[seriesId].version,
      achievementAwardKey: row.sourceAwardKey,
      achievementOp: 'GRANTED',
    });
    expect(rule).toBe(catalogued.ruleId);
    expect(row.correlationId).toBe(`award:${row.sourceAwardKey}`);
    expect(row.idempotencyKey).toBe(`award:${row.sourceAwardKey}#badge`);
    const earned = badgeProgress[seriesId].earned.find(
      (entry) => entry.level === level,
    );
    expect(earned, `${seriesId} ${level}`).toBeDefined();
    expect(row.utcEpochMs <= earned.earnedAtUtcMs).toBe(true);
    const paid = points.filter(
      (other) => other.correlationId === row.correlationId,
    );
    expect(paid.map((other) => other.pointsDelta)).toEqual(
      catalogued.awards
        .filter((award) => award.awardKind === 'POINTS')
        .map((award) => award.awardPoints),
    );
    for (const other of paid) expect(other.utcEpochMs).toBe(row.utcEpochMs);
  }

  // A visit is ONE event: every seat of theirs in it shares its id.
  for (const visit of workedVisitsOf(uid, book.appointments).filter(
    ({ day }) => day <= today,
  )) {
    const earned = points.filter(
      (row) => row.correlationId === `appt:${visit.appointmentId}`,
    );
    expect(
      earned.map((row) => PublicLabel.param(row, 'spendMinor')).sort(),
    ).toEqual(
      visit.seats
        .map((seat) => seat.priceMinor)
        .filter((price) => price >= 100)
        .sort(),
    );
    for (const row of earned) {
      expect(row.appointmentId).toBe(visit.appointmentId);
    }
  }

  // Each season's track, mirrored.
  for (const [seasonId, season] of Object.entries(catalog.seasons)) {
    const track = season.trackSeriesId && badgeProgress[season.trackSeriesId];
    if (!track) {
      expect(seasonProgress[seasonId]).toBeUndefined();
      continue;
    }
    expect(seasonProgress[seasonId]).toEqual({
      trackValue: track.value,
      trackLevel: track.earned.length,
    });
  }

  // The tier its visits in a year reach — at the root, no override.
  const tiers = Object.entries(catalog.tierDefinitions).sort(
    ([, a], [, b]) => a.rank - b.rank,
  );
  const reached = tiers.filter(
    ([, tier]) => acc.tierQualifying >= tier.qualifyAtLeast,
  );
  expect(acc.tierId).toBe(reached.at(-1)[0]);
  expect(acc.nextTierId).toBe(tiers[reached.length]?.[0] ?? null);
  expect(acc.tierQualifying).toBe(
    workedVisitsOf(uid, book.appointments).filter(
      (visit) =>
        visit.day <= today && dayNumber(today) - dayNumber(visit.day) < 365,
    ).length,
  );
  expect(acc.tierOverrideSource).toBeNull();

  // The tier's rows are a chain from the tier the account opened on to the
  // one it holds, each step to another tier, the last dated as the account says.
  const tierRows = rowsOf(clientJournal, 'TIER');
  tierRows.forEach((row, i) => {
    expect(row.tierOp).toBe('CHANGED');
    expect(row.tierTo).not.toBe(row.tierFrom);
    expect(row.tierFrom).toBe(i === 0 ? tiers[0][0] : tierRows[i - 1].tierTo);
    expect(row.labelCode).toBe('tier.changed');
    expect(row.labelParams).toEqual([
      { name: 'from', value: row.tierFrom },
      { name: 'to', value: row.tierTo },
    ]);
    expect(row).toMatchObject({
      journalSource: 'SYSTEM',
      sourceSystemJob: 'TIER',
    });
  });
  expect(tierRows.at(-1)?.tierTo ?? tiers[0][0]).toBe(acc.tierId);
  if (tierRows.length > 0) {
    expect(acc.tierSinceUtcMs).toBe(tierRows.at(-1).utcEpochMs);
  }

  // The stamp card counts every visit, and mints a coupon at every tenth.
  expect(acc.punchCards).toEqual([
    {
      ruleId: PUNCH_CARD.ruleId,
      filled: stats.lifetimeVisitsCompleted % PUNCH_CARD.size,
      size: PUNCH_CARD.size,
      title: catalog.rewardsCatalog['reward-cut'].name,
    },
  ]);
  const holder = LOYALTY_HOLDERS.find((entry) => entry.uid === uid);
  const minted = punchCardGrantsOf(
    uid,
    book.appointments,
    today,
    holder?.stampGrants ?? null,
  );
  expect(
    rowsOf(clientJournal, 'REWARD').map((row) => [
      row.rewardRef,
      row.rewardCouponGrantId,
      row.utcEpochMs,
      PublicLabel.param(row, 'stamp'),
    ]),
  ).toEqual(
    minted.map((granted) => [
      'COUPON_GRANT',
      granted.grantId,
      granted.grantedAtUtcMs,
      granted.stamp,
    ]),
  );

  // A reward bought: what it cost and what it bought, one event.
  for (const row of rowsOf(clientJournal, 'REDEMPTION')) {
    expect(row.redemptionCost).toBe(
      catalog.rewardsCatalog[row.redeemedRewardId].cost,
    );
    expect(row).toMatchObject({
      grantRef: 'COUPON_GRANT',
      grantCouponGrantId: redemptionGrantIdOf(row.redemptionId),
    });
    expect(row.correlationId).toBe(row.redemptionId);
    const paid = entries.filter(
      (other) => other !== row && other.correlationId === row.redemptionId,
    );
    expect(
      paid.map((other) => [other.journalEffect, other.pointsDelta]),
    ).toEqual([['POINTS', -row.redemptionCost]]);
    expect(paid[0].seq).toBe(row.seq - 1);
  }

  // The rhythm's states are an array (one per rule that is on, Law 5); a
  // run began on a day while one is in progress, and only then: a visit of
  // theirs, no later than the last that counted.
  expect(Array.isArray(acc.streaks)).toBe(true);
  const visitDays = workedVisitsOf(uid, book.appointments).map(
    (visit) => visit.day,
  );
  for (const state of acc.streaks) {
    const { streakId } = state;
    expect(Object.keys(state), streakId).toContain('runStartedOn');
    expect(state.runStartedOn === null, streakId).toBe(state.current === 0);
    if (state.runStartedOn === null) continue;
    expect(visitDays, streakId).toContain(state.runStartedOn);
    expect(
      state.runStartedOn <= sofiaDay(state.lastQualifiedAtUtcMs),
      streakId,
    ).toBe(true);
  }
}

describe('the loyalty catalogue', () => {
  it('is the fixtures’ catalogue, verbatim, on the fixtures’ day', () => {
    expect(LOYALTY_CATALOG_TODAY).toBe(FIXTURE_TODAY);
    expect(loyaltyCatalogFor(LOYALTY_CATALOG_TODAY)).toEqual(
      loyaltyCatalogJson,
    );
  });

  it('writes to the wire’s collections, under the wire’s journal ids', () => {
    // The six catalogue collections, under `LoyaltyCatalogSystem`'s parts.
    expect(LOYALTY_CATALOG_PARTS).toEqual([
      [Collections.BadgeCategories, 'categories'],
      [Collections.BadgeSeries, 'series'],
      [Collections.Seasons, 'seasons'],
      [Collections.TierDefinitions, 'tiers'],
      [Collections.RewardsCatalog, 'rewards'],
      [Collections.StreakDefinitions, 'streaks'],
    ]);
    expect(Object.keys(loyaltyCatalogJson)).toEqual(
      LOYALTY_CATALOG_PARTS.map(([collection]) => collection),
    );
    expect(LOYALTY_ACCOUNTS_COLLECTION).toBe(Collections.LoyaltyAccounts);
    expect(BADGE_PROGRESS_COLLECTION).toBe(Subcollections.BadgeProgress);
    expect(SEASON_PROGRESS_COLLECTION).toBe(Subcollections.SeasonProgress);
    expect(CLIENT_JOURNAL_COLLECTION).toBe(Collections.ClientJournal);
    expect(STREAK_DEFINITIONS_COLLECTION).toBe(Collections.StreakDefinitions);
    expect(STREAK_DEFINITION_VERSIONS_COLLECTION).toBe(Subcollections.Versions);
  });

  it('writes every catalogue document at its collection and id, then the rhythm’s first version, and nothing else', () => {
    const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
    const writes = loyaltyCatalogWritesOf(catalog);
    expect(writes.map(({ path }) => path)).toEqual([
      ...LOYALTY_CATALOG_PARTS.flatMap(([collection]) =>
        Object.keys(catalog[collection]).map((id) => `${collection}/${id}`),
      ),
      'streakDefinitions/cadence/versions/000001',
    ]);
    expect(writes).toHaveLength(6 + 42 + 3 + 4 + 3 + 1 + 1);
    for (const { path, data } of writes.slice(0, -1)) {
      const [collection, id] = path.split('/');
      expect(data).toBe(catalog[collection][id]);
    }
  });

  /**
   * ONE FACE PER FAMILY, ACROSS SEASONS (§3.3.3, wave D r6): the archive of
   * a year is four seasons, not four copies of one rosette, and a limited
   * edition never wears a perennial family's face — «Есенно утро» was the
   * «Ранобудник» sunrise, «Лятна събота» the «Съботен» sofa, «Всеки летен
   * месец» and «Всеки есенен месец» one calendar. (A family about a service
   * draws that service's cover only when it is no season's: the presenter
   * holds that half, `achievements.presenter.spec.ts`.)
   */
  it('gives every season and event, and each of their families, a face no other family wears', () => {
    const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
    const families = Object.entries(catalog.badgeSeries);
    const seasons = Object.entries(catalog.seasons);
    const repeated = (values) =>
      values.filter((v, i) => values.indexOf(v) !== i);
    // A season is drawn with its track's face: the card, the archive, the strip.
    for (const [id, season] of seasons) {
      if (season.trackSeriesId === null) continue;
      expect(catalog.badgeSeries[season.trackSeriesId].emblem, id).toBe(
        season.emblem,
      );
    }
    const seasonFaces = seasons.map(([, season]) => season.emblem);
    expect(repeated(seasonFaces)).toEqual([]);
    const perennial = new Set(
      families.filter(([, s]) => s.seasonId === null).map(([, s]) => s.emblem),
    );
    const limited = families
      .filter(([, s]) => s.seasonId !== null)
      .filter(([id, s]) => catalog.seasons[s.seasonId].trackSeriesId !== id)
      .map(([id, s]) => [id, s.emblem]);
    // Guard the guard: the seed's two seasons and one event hold nine.
    expect(limited).toHaveLength(9);
    expect(limited.filter(([, emblem]) => perennial.has(emblem))).toEqual([]);
    expect(
      limited.filter(([, emblem]) => seasonFaces.includes(emblem)),
    ).toEqual([]);
    expect(repeated(limited.map(([, emblem]) => emblem))).toEqual([]);
    expect(seasonFaces.filter((emblem) => perennial.has(emblem))).toEqual([]);
  });

  // The e2e global setup runs `--catalog-only`, and the achievements pages
  // read the catalogue whoever is signed in; the accounts are the book's.
  it('is written under --catalog-only, and the accounts only by the full run', () => {
    const script = readFileSync(
      resolve(__dirname, '../seed-dev-catalog.mjs'),
      'utf8',
    );
    const exit = script.indexOf('if (CATALOG_ONLY) {');
    expect(exit).toBeGreaterThan(0);
    const catalogueWrite = script.indexOf('loyaltyCatalogWritesOf(');
    expect(catalogueWrite).toBeGreaterThan(0);
    expect(catalogueWrite).toBeLessThan(exit);
    expect(script.indexOf('projectLoyaltyFor(')).toBeGreaterThan(exit);
    expect(script.indexOf('couponGrantWritesOf(')).toBeGreaterThan(exit);
    expect(script.indexOf('giftVoucherWritesOf(')).toBeGreaterThan(exit);
    expect(script.indexOf('waitlistRequestWriteOf(')).toBeGreaterThan(exit);
    // In BOTH modes a rule the shop has published is asked about before
    // the catalogue is written, and what is written leaves it out.
    const asked = script.indexOf('rulesPublishedOver(seededCatalogWrites');
    const left = script.indexOf('withoutPublishedRules(seededCatalogWrites');
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThan(left);
    expect(left).toBeLessThan(script.indexOf('batch.commit()'));
    expect(script.indexOf('batch.commit()')).toBeLessThan(exit);
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s: one season open, one event open, one season behind, windows as long as ever',
    (_label, nowMs) => {
      const today = createShopCalendar(nowMs).dayKeyAt(0);
      const catalog = loyaltyCatalogFor(today);
      const phaseOn = (season) =>
        today < season.windowFrom
          ? 'announced'
          : today > season.windowUntil
            ? 'ended'
            : 'open';
      const phases = Object.values(catalog.seasons).map(
        (season) => `${season.seasonKind}:${phaseOn(season)}`,
      );
      expect(phases.sort()).toEqual([
        'EVENT:open',
        'SEASON:ended',
        'SEASON:open',
      ]);
      for (const [id, season] of Object.entries(catalog.seasons)) {
        const fixture = loyaltyCatalogJson.seasons[id];
        const length = (window) =>
          dayNumber(window.windowUntil) - dayNumber(window.windowFrom);
        expect(length(season), id).toBe(length(fixture));
        // T5: the announcement's day is the day of its instant, read once.
        expect(season.announcedLocalDate, id).toBe(
          sofiaDay(season.announcedAtUtcMs),
        );
        expect(
          dayNumber(season.windowFrom) - dayNumber(season.announcedLocalDate),
          id,
        ).toBe(
          dayNumber(fixture.windowFrom) - dayNumber(fixture.announcedLocalDate),
        );
      }
    },
  );
});

// ── The rhythm's rule: a head, its first version, and whose it is ─────────

describe('the rhythm’s rule, as the seed writes it (revision 3 §4.3)', () => {
  const head = () =>
    loyaltyCatalogFor(LOYALTY_CATALOG_TODAY).streakDefinitions.cadence;
  /** An entity as the store holds it: the body, its `id` left out. */
  const bodyOf = (entity) => {
    const body = { ...entity };
    delete body.id;
    return body;
  };

  it('writes the head the domain’s own write half would: the rule round-trips through its factories', () => {
    const [current] = head().rules;
    const parsed = StreakRule.parse(current);
    expect(parsed.ok).toBe(true);
    // The domain's own head over that rule, nothing waiting: the very list.
    const schedule = StreakRuleSystem.schedule(parsed.value, null);
    expect(schedule.ok).toBe(true);
    expect(schedule.value.rules).toEqual(head().rules);
    expect(StreakRuleSystem.current(schedule.value).version).toBe(1);
    expect(StreakRuleSystem.scheduled(schedule.value)).toBeNull();
    // …and the head the publish pipeline's specs start from.
    expect(head()).toEqual(bodyOf(streakDefinitionFixture()));
  });

  it('writes the first version as the domain’s write half would, published by nobody, changing nothing', () => {
    expect(seedRuleVersionWriteOf('cadence', head())).toEqual({
      path: `${Collections.StreakDefinitions}/cadence/${Subcollections.Versions}/${StreakDefinitionVersionId.forVersion(1)}`,
      data: bodyOf(streakDefinitionVersionFixture()),
    });
    expect(seedRuleVersionWriteOf('cadence', head()).data).toMatchObject({
      publishedByUserId: SEED_RULE_PUBLISHER,
      publishedAtUtcMs: head().updatedAtUtcMs,
      streakTransition: 'GRANDFATHER',
      streakRuleDirection: 'NEUTRAL',
      changed: [],
      withdrawnAtUtcMs: null,
    });
    expect(seedRuleRequestIdOf('cadence', 1)).toBe('seed-cadence-000001');
  });

  it('is the history the in-memory reference lists, so a spec and the emulator show one', async () => {
    const world = memoryStreakWorld({
      heads: [streakDefinitionFixture()],
      versions: [
        { streakId: 'cadence', version: streakDefinitionVersionFixture() },
      ],
    });
    const listed = await memoryStreakDefinitionPorts(
      world,
    ).listStreakDefinitionVersions('cadence', 10);
    expect(listed.ok).toBe(true);
    expect(listed.value.map(bodyOf)).toEqual([
      seedRuleVersionWriteOf('cadence', head()).data,
    ]);
  });

  it('reads back as the version it is, under the head’s name', () => {
    const { path, data } = seedRuleVersionWriteOf('cadence', head());
    expect(path.split('/').at(-1)).toBe(
      StreakDefinitionVersionId.forVersion(data.version),
    );
    const version = StreakRule.parse(data);
    expect(version.ok).toBe(true);
    const inForce = StreakRuleSystem.inForceOn(head(), LOYALTY_CATALOG_TODAY);
    expect(version.value.version).toBe(inForce.version);
    expect(version.value.effectiveFromLocalDate).toBe(
      inForce.effectiveFromLocalDate,
    );
    expect(
      StreakRuleSystem.changeFrom(version.value, inForce, false).changed,
    ).toEqual([]);
    // The name is the head's: a version holds the rule alone.
    expect(data).not.toHaveProperty('name');
    expect(head().name.bg).toBe('Посещения в ритъм');
  });

  it('refuses to describe a head that holds a version in waiting: only a publish writes one', () => {
    const [current] = head().rules;
    const waiting = {
      ...head(),
      rules: [
        current,
        {
          ...current,
          version: 2,
          effectiveFromLocalDate: '2026-10-05',
          headRole: 'SCHEDULED',
          streakTransition: 'GRANDFATHER',
        },
      ],
    };
    // The head itself is a sound one…
    const scheduled = inRole(waiting, HeadRole.Scheduled);
    expect(
      StreakRuleSystem.schedule(StreakRule.parse(current).value, {
        ...StreakRule.parse(scheduled).value,
        streakTransition: scheduled.streakTransition,
      }).ok,
    ).toBe(true);
    // …and not the seed's to write.
    expect(() => seedRuleVersionWriteOf('cadence', waiting)).toThrow(
      /only a publish writes/,
    );
  });
});

describe('rulesPublishedOver — the first version is seeded, every later one is the shop’s', () => {
  const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
  const writes = loyaltyCatalogWritesOf(catalog);
  const HEAD = 'streakDefinitions/cadence';
  const FIRST = 'streakDefinitions/cadence/versions/000001';
  const seededHead = catalog.streakDefinitions.cadence;
  const seededFirst = writes.at(-1).data;
  const [seededRule] = seededHead.rules;
  const secondVersion = {
    ...seededRule,
    version: 2,
    effectiveFromLocalDate: '2026-10-05',
    intervalDays: 35,
  };
  /** The emulator, holding `documents` at their paths and nothing else. */
  const holding = (documents) => new Map(Object.entries(documents));
  /** The head before flip 3: nested, its rule in force and its waiting one as two maps. */
  const NESTED = {
    name: seededHead.name,
    current: { version: 1, effectiveFrom: '2025-03-01', graceDays: 7 },
    scheduled: null,
  };

  it.each([
    ['an empty emulator', {}],
    ['the nested head of an emulator seeded before flip 3', { [HEAD]: NESTED }],
    [
      'the seed’s own head and first version',
      {
        [HEAD]: seededHead,
        [FIRST]: seededFirst,
      },
    ],
    ['the seed’s head with its history missing', { [HEAD]: seededHead }],
    [
      'a head that holds nothing a reader could take for a version',
      {
        [HEAD]: { name: seededHead.name, rules: 'soon' },
      },
    ],
    [
      'a head numbered below the seed’s',
      {
        [HEAD]: {
          ...seededHead,
          rules: [{ ...seededRule, version: 0 }],
        },
      },
    ],
  ])('is the seed’s to write over %s', (_label, documents) => {
    expect(rulesPublishedOver(writes, holding(documents))).toEqual([]);
    expect(withoutPublishedRules(writes, [])).toEqual(writes);
  });

  it.each([
    [
      'a second version in force',
      {
        [HEAD]: { ...seededHead, rules: [secondVersion] },
        [FIRST]: seededFirst,
      },
    ],
    [
      'a second version that waits for its day',
      {
        [HEAD]: {
          ...seededHead,
          rules: [
            seededRule,
            {
              ...secondVersion,
              headRole: 'SCHEDULED',
              streakTransition: 'GRANDFATHER',
            },
          ],
        },
        [FIRST]: seededFirst,
      },
    ],
    [
      'a first rule the shop published into an empty emulator',
      {
        [HEAD]: {
          ...seededHead,
          rules: [{ ...seededRule, graceDays: 3 }],
        },
        [FIRST]: {
          ...seededFirst,
          graceDays: 3,
          publishedByUserId: 'dev-staff-ivan',
          requestId: '0f8f2b7e-5d0a-4c7e-9a55-2f4f6f1f3a10',
        },
      },
    ],
  ])(
    'leaves %s as the shop published it, head and history',
    (_label, documents) => {
      const stored = holding(documents);
      expect(rulesPublishedOver(writes, stored)).toEqual(['cadence']);
      const written = withoutPublishedRules(writes, ['cadence']);
      expect(written.map(({ path }) => path)).toEqual(
        writes
          .map(({ path }) => path)
          .filter((path) => path !== HEAD && path !== FIRST),
      );
      // Everything else of the catalogue is still the seed's.
      expect(written).toHaveLength(writes.length - 2);
      // What the accounts are projected under is the emulator's rule.
      const held = catalogAsHeld(catalog, ['cadence'], stored);
      expect(held.streakDefinitions.cadence).toBe(stored.get(HEAD));
      expect(held.badgeSeries).toBe(catalog.badgeSeries);
      expect(catalog.streakDefinitions.cadence).toBe(seededHead);
      // And nothing of it counts as a stale seed.
      expect(
        loyaltyCatalogDriftOf(
          writes,
          new Map([...writes.map(({ path, data }) => [path, data]), ...stored]),
        ),
      ).toEqual([]);
    },
  );

  it('holds the catalogue as it is while nothing is published', () => {
    const held = catalogAsHeld(catalog, [], holding({ [HEAD]: NESTED }));
    expect(held.streakDefinitions.cadence).toBe(seededHead);
  });

  it('counts the nested head of an emulator seeded before flip 3 as a stale catalogue, and its missing history', () => {
    const stored = new Map([
      ...writes.map(({ path, data }) => [path, data]),
      [HEAD, NESTED],
    ]);
    stored.delete(FIRST);
    const drift = loyaltyCatalogDriftOf(writes, stored);
    expect(drift).toHaveLength(2);
    expect(drift[0].startsWith(`${HEAD}: `)).toBe(true);
    expect(drift[0]).toContain('current');
    expect(drift[0]).toContain('rules');
    expect(drift[1]).toBe(`${FIRST}: missing`);
  });
});

describe.each([
  ['Георги', LOYALTY_HOLDERS[0], loyaltyAccountJson.georgi],
  ['Мартин', LOYALTY_HOLDERS[1], loyaltyAccountJson.martin],
])('%s’s projection on the fixtures’ day', (_name, holder, fixture) => {
  const { book, today, catalog, project } = seeded(NOW);
  const projection = project(holder);

  it('has the fixture’s shape, document by document', () => {
    expect(Object.keys(projection)).toEqual(Object.keys(fixture));
    // The fixture is keyed by the record the seed derives for the account.
    expect(fixture.uid).toBe(holder.uid);
    expect(fixture.customerId).toBe(customerIdOf(holder.uid));
    expect(projection.customerId).toBe(fixture.customerId);
    expect(shapeOf(projection.account)).toEqual(shapeOf(fixture.account));
    expect(shapesOf(Object.values(projection.badgeProgress))).toEqual(
      shapesOf(Object.values(fixture.badgeProgress)),
    );
    expect(shapesOf(Object.values(projection.seasonProgress))).toEqual(
      shapesOf(Object.values(fixture.seasonProgress)),
    );
    // The fixtures' journals hold point rows only (contract delta R2a-6):
    // the seed's point rows have their shape, and its other rows are held
    // to the feed's vocabulary by `expectConsistent`, not to a fixture.
    expect(shapesOf(pointsOf(projection.clientJournal))).toEqual(
      shapesOf(Object.values(fixture.clientJournal)),
    );
    expect(Object.values(projection.clientJournal).length).toBeGreaterThan(
      pointsOf(projection.clientJournal).length,
    );
  });

  it('keeps every invariant a reader leans on', () => {
    expectConsistent(projection, {
      uid: holder.uid,
      book,
      catalog,
      today,
      nowMs: NOW,
    });
  });

  it('writes the account, its two subcollections and its rows, and nothing else', () => {
    const writes = loyaltyWritesOf(holder.uid, projection);
    const home = `loyaltyAccounts/${customerIdOf(holder.uid)}`;
    expect(writes[0]).toEqual({ path: home, data: projection.account });
    expect(writes.map(({ path }) => path).sort()).toEqual(
      [
        home,
        ...Object.keys(projection.badgeProgress).map(
          (id) => `${home}/badgeProgress/${id}`,
        ),
        ...Object.keys(projection.seasonProgress).map(
          (id) => `${home}/seasonProgress/${id}`,
        ),
        ...Object.keys(projection.clientJournal).map(
          (id) => `clientJournal/${id}`,
        ),
      ].sort(),
    );
  });

  it('is the same documents on a second run the same day', () => {
    expect(seeded(NOW + 60_000).project(holder)).toEqual(projection);
  });
});

// The §4.6 story each account tells, as far as the seeded book decides it.
describe('the seeded story (§4.6)', () => {
  const { book, today, project } = seeded(NOW);
  const levels = (projection) =>
    Object.values(projection.badgeProgress).reduce(
      (sum, progress) => sum + progress.earned.length,
      0,
    );

  it('Георги: the regular — 24 fades with Иван, Злато, 24 in rhythm, a 4/10 card and a held free cut', () => {
    const { account: acc, badgeProgress } = project(LOYALTY_HOLDERS[0]);
    expect(badgeProgress['series-visits'].value).toBe(24);
    expect(badgeProgress['series-svc-fade'].value).toBe(24);
    expect(badgeProgress['series-barber-ivan'].value).toBe(24);
    expect(badgeProgress['series-welcome'].earned).toHaveLength(1);
    expect(acc).toMatchObject({
      tierId: 'gold',
      nextTierId: 'platinum',
    });
    expect(cadenceOf(acc)).toMatchObject({
      current: 24,
      best: 24,
      streakPhase: 'ACTIVE',
    });
    expect(badgeProgress['series-rhythm'].earned).toHaveLength(5);
    expect(acc.punchCards[0].filled).toBe(4);
    expect(acc.lifetimeSpent).toBe(250);
    expect(acc.records.map((record) => record.personalRecordKind)).toEqual([
      'LONGEST_RHYTHM',
      'MOST_VISITS_IN_YEAR',
      'FAVOURITE_SERVICE',
      'FIRST_VISIT',
    ]);
    expect(acc.records[2]).toMatchObject({ serviceId: 'svc-fade', value: 24 });
    // No birthday on the profile: the profile is not complete.
    expect(badgeProgress['series-profile']).toBeUndefined();
    expect(levels(project(LOYALTY_HOLDERS[0]))).toBeGreaterThan(30);
    expect(
      punchCardGrantsOf('dev-client-1', book.appointments, today).map(
        (grant) => grant.stamp,
      ),
    ).toEqual([10, 20]);
  });

  it('Мартин: Сребро, 13 in rhythm and due, a complete profile, no birthday visit yet', () => {
    const {
      account: acc,
      badgeProgress,
      seasonProgress,
    } = project(LOYALTY_HOLDERS[1]);
    expect(badgeProgress['series-visits'].value).toBe(13);
    expect(acc).toMatchObject({ tierId: 'silver', nextTierId: 'gold' });
    expect(cadenceOf(acc)).toMatchObject({
      current: 13,
      streakPhase: 'AT_RISK',
    });
    expect(acc.punchCards[0].filled).toBe(3);
    expect(acc.lifetimeSpent).toBe(120);
    // Today IS his birthday, and he is still in the chair: nothing to earn yet.
    expect(badgeProgress['series-birthday']).toBeUndefined();
    // The e-mail and the birthday, but no photo of his own (wave D r6):
    // «Пълен профил» waits, its requirement in view.
    expect(badgeProgress['series-profile']).toBeUndefined();
    // He has not been in this autumn.
    expect(seasonProgress['season-2026-autumn']).toBeUndefined();
    expect(seasonProgress['season-2026-summer']).toBeDefined();
  });

  it('keeps nobody else’s account', () => {
    expect(LOYALTY_HOLDERS.map((holder) => holder.uid)).toEqual([
      'dev-client-1',
      'dev-client-2',
    ]);
  });
});

describe('across the calendar', () => {
  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s every holder’s projection keeps its invariants',
    (_label, nowMs) => {
      const { book, today, catalog, project } = seeded(nowMs);
      for (const holder of LOYALTY_HOLDERS) {
        const projection = project(holder);
        expect(projection, holder.uid).not.toBeNull();
        expectConsistent(projection, {
          uid: holder.uid,
          book,
          catalog,
          today,
          nowMs,
        });
      }
    },
  );
});

// ── Read back, as the seed checks before it writes (§7.5 «Seed») ───────────

/**
 * Every document the seed writes for the client card, read back through
 * the checks the SEED holds — `loadSeedDomain()`'s bundle of the domain,
 * the one `seed-dev-catalog.mjs` reads with before it writes — in the
 * card's order: the catalogue as one model (`LoyaltyCatalogSystem.validate`),
 * the rhythm's rules (`StreakRule.parse`), each account document routed by
 * where it is written and answered as stored (flip-3 plan F3-1 (b)),
 * Мартин's waitlist request.
 */
describe('read back by the client card’s readers', () => {
  let domain;
  /** The fixtures' day, read back once the bundle is in. */
  let onFixturesDay;

  /** The catalogue and each holder's documents on the book of `nowMs`, as the checks read them. */
  function readBack(nowMs) {
    const { today, catalog, project } = seeded(nowMs);
    return {
      today,
      catalogue: readLoyaltyWrites(domain, loyaltyCatalogWritesOf(catalog)),
      catalogDocuments: catalog,
      holders: LOYALTY_HOLDERS.map((holder) => {
        const projection = project(holder);
        return {
          uid: holder.uid,
          projection,
          read: readLoyaltyWrites(
            domain,
            loyaltyWritesOf(holder.uid, projection),
          ),
        };
      }),
    };
  }

  beforeAll(async () => {
    domain = await loadSeedDomain();
    onFixturesDay = readBack(NOW);
  });

  const sorted = (values) => [...values].sort();
  const idsOf = (entries) => sorted(entries.map((entry) => entry.id));

  it('reads the catalogue as one catalogue: every shelf, family, season, tier, reward and the rhythm', () => {
    const { catalogue, catalogDocuments } = onFixturesDay;
    expect(catalogue.problems).toEqual([]);
    const { catalog } = catalogue;
    for (const [collection, entries] of [
      ['badgeCategories', catalog.categories],
      ['badgeSeries', catalog.families],
      ['seasons', catalog.seasons],
      ['tierDefinitions', catalog.tiers],
      ['rewardsCatalog', catalog.rewards],
      ['streakDefinitions', catalog.streaks],
    ]) {
      expect(idsOf(entries), collection).toEqual(
        sorted(Object.keys(catalogDocuments[collection])),
      );
    }
  });

  it('reads the rhythm as a rule in force, and its first version beside the head that names it', () => {
    const { today, catalogue } = onFixturesDay;
    const rule = StreakRuleSystem.inForceOn(
      catalogue.catalog.streaks.find((head) => head.id === 'cadence'),
      today,
    );
    expect(rule).toMatchObject({ version: 1, enabled: true });
    expect(catalogue.heads.map((head) => head.id)).toEqual(['cadence']);
    expect(catalogue.ruleVersions).toHaveLength(1);
    const [version] = catalogue.ruleVersions;
    expect(version.version).toBe(rule.version);
    expect(version.effectiveFromLocalDate).toBe(rule.effectiveFromLocalDate);
    expect(StreakRuleSystem.changeFrom(version, rule, false).changed).toEqual(
      [],
    );
    expect(version).toMatchObject({
      id: '000001',
      publishedByUserId: SEED_RULE_PUBLISHER,
      requestId: 'seed-cadence-000001',
      streakTransition: 'GRANDFATHER',
      streakRuleDirection: 'NEUTRAL',
      changed: [],
      withdrawnAtUtcMs: null,
    });
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s the catalogue and every holder’s documents read, and the domain dates the seasons as the page draws them',
    (_label, nowMs) => {
      const { today, catalogue, holders } = readBack(nowMs);
      expect(catalogue.problems).toEqual([]);
      for (const { uid, read } of holders) {
        expect(read.problems, uid).toEqual([]);
      }
      // The domain's own phases: one season and one event running, one
      // season behind, nothing announced.
      const kinds = (phase) =>
        LoyaltyCatalogSystem.seasonsIn(catalogue.catalog, phase, today)
          .map((season) => season.seasonKind)
          .sort();
      expect(kinds(SeasonPhase.Open)).toEqual(['EVENT', 'SEASON']);
      expect(kinds(SeasonPhase.Ended)).toEqual(['SEASON']);
      expect(kinds(SeasonPhase.Announced)).toEqual([]);
    },
  );

  describe.each([
    ['Георги', 0],
    ['Мартин', 1],
  ])('%s’s account', (_name, index) => {
    const holder = () => onFixturesDay.holders[index];

    it('reads document by document: the account, every family, every season track, every row of the journal', () => {
      const { projection, read } = holder();
      expect(read.problems).toEqual([]);
      expect(read.catalog).toBeNull();
      expect(read.accounts).toHaveLength(1);
      expect(read.accounts[0].id).toBe(customerIdOf(holder().uid));
      expect(read.badgeProgress.map((progress) => progress.id)).toEqual(
        Object.keys(projection.badgeProgress),
      );
      expect(read.seasonProgress.map((track) => track.id)).toEqual(
        Object.keys(projection.seasonProgress),
      );
      // The feed reads every row; the ledger the rows that move points.
      expect(read.journal.map((entry) => entry.id)).toEqual(
        Object.keys(projection.clientJournal),
      );
      expect(
        read.journal
          .filter((entry) => entry.journalEffect === 'POINTS')
          .map((entry) => entry.id),
      ).toEqual(
        Object.entries(projection.clientJournal)
          .filter(([, row]) => row.journalEffect === 'POINTS')
          .map(([id]) => id),
      );
    });

    it('reads what the fold wrote: a balance its rows sum to, the rows in order', () => {
      const { uid, projection, read } = holder();
      const [acc] = read.accounts;
      const customerId = customerIdOf(uid);
      expect(acc.customerId).toBe(customerId);
      expect(acc.balance).toBe(projection.account.balance);
      const moved = read.journal.filter(
        (entry) => entry.journalEffect === 'POINTS',
      );
      expect(acc.balance).toBe(
        moved.reduce((sum, entry) => sum + entry.pointsDelta, 0),
      );
      expect(read.journal.map((entry) => entry.seq)).toEqual(
        read.journal.map((_, i) => i + 1),
      );
      expect(acc.seq).toBe(read.journal.length);
      read.journal.forEach((entry, i) => {
        expect(entry.id).toBe(JournalEntryId.forEntry(customerId, entry.seq));
        if (i > 0) {
          expect(entry.utcEpochMs >= read.journal[i - 1].utcEpochMs).toBe(true);
        }
      });
      expect(acc.updatedAtUtcMs >= read.journal.at(-1).utcEpochMs).toBe(true);
      // A point row carries the balance it left: the newest is the account's.
      expect(moved.at(-1).balanceAfter).toBe(acc.balance);
    });

    it('reads the rhythm the domain projected: its terms, its twelve periods, the visit that holds it', () => {
      const { projection, read } = holder();
      const state = cadenceOf(read.accounts[0]);
      expect(state).toEqual(cadenceOf(projection.account));
      expect(StreakState.periodTerms(state)).toEqual({
        intervalDays: 42,
        graceDays: 7,
        source: 'FIXED',
        habitDays: null,
      });
      expect(state.periods).toHaveLength(12);
      expect(state.periods.at(-1).on).toBe(
        sofiaDay(state.lastQualifiedAtUtcMs),
      );
    });

    it('reads the day the run began: the holder’s first visit, further back than the track reaches', () => {
      const { uid, projection, read } = holder();
      const written = cadenceOf(projection.account);
      const state = cadenceOf(read.accounts[0]);
      expect(written.runStartedOn).toBe(
        index === 0 ? '2025-03-01' : '2025-05-06',
      );
      expect(state.runStartedOn).toBe(written.runStartedOn);
      // Neither holder ever lost the count: the run is as old as the account.
      const [first] = workedVisitsOf(uid, seeded(NOW).book.appointments);
      expect(state.runStartedOn).toBe(first.day);
      expect(state.runStartedOn).toBe(
        projection.account.records.find(
          (record) => record.personalRecordKind === 'FIRST_VISIT',
        ).on,
      );
      expect(state.current).toBeGreaterThan(state.periods.length);
      expect(state.runStartedOn < state.periods[0].on).toBe(true);
    });

    it('names only what the catalogue holds', () => {
      const { read } = holder();
      const { catalog } = onFixturesDay.catalogue;
      const [acc] = read.accounts;
      for (const progress of read.badgeProgress) {
        const family = LoyaltyCatalogSystem.series(catalog, progress.id);
        expect(family, progress.id).not.toBeNull();
        for (const { level } of progress.earned) {
          expect(
            family.levels.some((entry) => entry.level === level),
            `${progress.id} ${level}`,
          ).toBe(true);
        }
      }
      for (const { id } of read.seasonProgress) {
        expect(
          LoyaltyCatalogSystem.season(catalog, id)?.trackSeriesId ?? null,
          id,
        ).not.toBeNull();
      }
      expect(LoyaltyCatalogSystem.tier(catalog, acc.tierId)).not.toBeNull();
      expect(
        acc.nextTierId === null ||
          LoyaltyCatalogSystem.tier(catalog, acc.nextTierId) !== null,
      ).toBe(true);
      for (const state of acc.streaks) {
        const head = catalog.streaks.find(
          (entry) => entry.id === state.streakId,
        );
        const rule =
          head === undefined
            ? null
            : StreakRuleSystem.inForceOn(head, onFixturesDay.today);
        expect(rule, state.streakId).not.toBeNull();
        expect(state.definitionVersion).toBe(rule.version);
      }
      for (const row of read.journal) {
        const reward = PublicLabel.param(row, 'reward');
        const seriesId = PublicLabel.param(row, 'seriesId');
        if (reward !== null) {
          expect(
            catalog.rewards.map((entry) => entry.id),
            row.id,
          ).toContain(reward);
        }
        if (seriesId !== null) {
          expect(
            LoyaltyCatalogSystem.series(catalog, String(seriesId)),
            row.id,
          ).not.toBeNull();
        }
      }
    });
  });

  describe('Мартин’s waitlist request', () => {
    it('is written to the adapters’ collection, under its own id', () => {
      expect(WAITLIST_REQUESTS_COLLECTION).toBe(Collections.WaitlistRequests);
      const { path, data } = waitlistRequestWriteOf(buildClientBook(NOW));
      expect(path).toBe(
        `${Collections.WaitlistRequests}/${SEEDED_WAITLIST_REQUEST.id}`,
      );
      expect(Object.keys(data)).not.toContain('id');
      expect(data.ownerUserId).toBe(SEEDED_WAITLIST_REQUEST.ownerUserId);
    });

    it('is the flat request: its days mirrored for the matcher, the first day’s instant, its lifecycle at the root', () => {
      const { data } = waitlistRequestWriteOf(buildClientBook(NOW));
      expect(data.localDates).toEqual(
        data.flexibleDays.map((watched) => watched.localDate).sort(),
      );
      expect(data.utcEpochMs).toBe(
        ZonedTimeSystem.startOfLocalDay(data.localDates[0], ZONE),
      );
      expect(data).toMatchObject({
        locationId: 'loc-center',
        waitlistStatus: 'OPEN',
        waitlistStatusAtUtcMs: data.createdAtUtcMs,
      });
      // Afternoons, two to five on the shop's clock.
      for (const watched of data.flexibleDays) {
        expect(watched.windows).toEqual([
          { startMinutes: 14 * 60, endMinutes: 17 * 60 },
        ]);
      }
      // Plain data: what is written is what is read, byte for byte.
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    });

    it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
      'on %s the card shows it: watching, not lapsed, Thursday and Friday next week, made after his every booking',
      (_label, nowMs) => {
        const book = buildClientBook(nowMs);
        const write = waitlistRequestWriteOf(book);
        const todayKey = book.calendar.dayKeyAt(0);
        expect(WaitlistLifecycle.isWatching(write.data)).toBe(true);
        expect(WaitlistSystem.hasLapsed(write.data, todayKey)).toBe(false);
        const [thursday, friday] = write.data.localDates;
        expect([thursday, friday].map(weekdayOf)).toEqual([4, 5]);
        const ahead = dayNumber(thursday) - dayNumber(todayKey);
        expect(ahead).toBeGreaterThanOrEqual(4);
        expect(ahead).toBeLessThanOrEqual(10);
        const booked = book.appointments
          .filter(
            ({ doc }) =>
              doc.subjectUserIds.includes(
                SEEDED_WAITLIST_REQUEST.ownerUserId,
              ) && doc.bookedAtUtcMs !== null,
          )
          .map(({ doc }) => doc.bookedAtUtcMs);
        expect(booked.length).toBeGreaterThan(0);
        expect(Math.max(...booked)).toBeLessThan(write.data.createdAtUtcMs);
      },
    );

    it('refuses a book in which he booked after making it', () => {
      const book = buildClientBook(NOW);
      const mine = book.appointments.find(
        ({ doc }) =>
          doc.subjectUserIds.includes(SEEDED_WAITLIST_REQUEST.ownerUserId) &&
          doc.bookedAtUtcMs !== null,
      );
      const rebooked = {
        id: `${mine.id}-again`,
        doc: { ...mine.doc, bookedAtUtcMs: book.calendar.msAt(0, 8 * 60) },
      };
      expect(() =>
        waitlistRequestWriteOf({
          ...book,
          appointments: [...book.appointments, rebooked],
        }),
      ).toThrow(/booked after his waitlist request/);
    });
  });

  describe('readLoyaltyWrites — what it refuses', () => {
    it('names each path no loyalty document is written at, and a version with no head — and answers every account document as stored', () => {
      const [{ uid, projection }] = onFixturesDay.holders;
      const writes = loyaltyWritesOf(uid, projection);
      const [home] = writes;
      const levels = writes.find(
        ({ path, data }) =>
          path.includes(`/${BADGE_PROGRESS_COLLECTION}/`) &&
          data.earned.length > 1,
      );
      const row = writes.at(-1);
      const [, version] = loyaltyCatalogWritesOf(
        loyaltyCatalogFor(LOYALTY_CATALOG_TODAY),
      ).slice(-2);
      // What a legacy reader refused, no check reads now (F3-1 (b)): an
      // account, a family's progress and a row are answered as stored —
      // their shapes are the builders', held by the type checker.
      const asStored = [
        { path: home.path, data: { ...home.data, balance: -1 } },
        {
          path: levels.path,
          data: { ...levels.data, earned: [...levels.data.earned].reverse() },
        },
        { path: row.path, data: { ...row.data, journalVisibility: 'STAFF' } },
      ];
      const read = readLoyaltyWrites(domain, [
        ...asStored,
        { path: `${home.path}/visits/appt-1`, data: {} },
        { path: 'coupons/coupon-free-beard', data: {} },
        // A version handed over without the head that names its rule.
        version,
      ]);
      expect(read.accounts).toEqual([
        { id: home.path.split('/').at(-1), ...asStored[0].data },
      ]);
      expect(read.badgeProgress).toEqual([
        { id: levels.path.split('/').at(-1), ...asStored[1].data },
      ]);
      expect(read.journal).toEqual([
        { id: row.path.split('/').at(-1), ...asStored[2].data },
      ]);
      expect(read.ruleVersions).toEqual([]);
      // Each line: the path, then why.
      const expected = [
        [`${home.path}/visits/appt-1`, 'no loyalty reader reads this path'],
        ['coupons/coupon-free-beard', 'no loyalty reader reads this path'],
        [version.path, 'a version of a rule with no head'],
      ];
      expect(read.problems).toHaveLength(expected.length);
      expected.forEach(([path, why], i) => {
        expect(read.problems[i].startsWith(`${path}: `), path).toBe(true);
        expect(read.problems[i]).toContain(why);
      });
    });

    it('refuses a rule the domain refuses, by the rule’s own code, and a version numbered otherwise than its id', () => {
      const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
      // A grace as long as the interval: nobody could ever be late.
      const [current] = catalog.streakDefinitions.cadence.rules;
      current.graceDays = 21;
      current.intervalDays = 21;
      const graceless = readLoyaltyWrites(
        domain,
        loyaltyCatalogWritesOf(catalog),
      );
      // The catalogue is sound as a catalogue; the rule is not, on the head
      // and on the version written from it.
      expect(graceless.catalog).not.toBeNull();
      expect(graceless.ruleVersions).toEqual([]);
      expect(graceless.problems).toHaveLength(2);
      expect(
        graceless.problems[0].startsWith('streakDefinitions/cadence: '),
      ).toBe(true);
      expect(
        graceless.problems[1].startsWith(
          'streakDefinitions/cadence/versions/000001: ',
        ),
      ).toBe(true);
      for (const problem of graceless.problems) {
        expect(problem).toContain(
          'ENGAGEMENT_STREAK_DEFINITION_GRACE_NOT_SHORTER_THAN_INTERVAL',
        );
      }

      const writes = loyaltyCatalogWritesOf(
        loyaltyCatalogFor(LOYALTY_CATALOG_TODAY),
      );
      const version = writes.at(-1);
      const renumbered = readLoyaltyWrites(domain, [
        ...writes.slice(0, -1),
        { path: version.path, data: { ...version.data, version: 2 } },
      ]);
      expect(renumbered.catalog).not.toBeNull();
      expect(renumbered.problems).toHaveLength(1);
      expect(renumbered.problems[0].startsWith(`${version.path}: `)).toBe(true);
      expect(renumbered.problems[0]).toContain('.version');
    });

    it('fails the catalogue whole on one document the domain refuses', () => {
      const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
      // A family on a shelf the catalogue does not hold.
      catalog.badgeSeries['series-svc-fade'].categoryId = 'cat-gone';
      const read = readLoyaltyWrites(domain, loyaltyCatalogWritesOf(catalog));
      expect(read.catalog).toBeNull();
      expect(read.problems).toHaveLength(1);
      const [problem] = read.problems;
      expect(problem.startsWith('the catalogue: ')).toBe(true);
      expect(problem).toContain('ENGAGEMENT_LOYALTY_CATALOG_DANGLING_CATEGORY');
      expect(problem).toContain('series-svc-fade');
      expect(problem).toContain('cat-gone');
    });
  });

  it('is what the full run reads each document back with, just before writing it', () => {
    const script = readFileSync(
      resolve(__dirname, '../seed-dev-catalog.mjs'),
      'utf8',
    );
    const at = (text, from = 0) => {
      const index = script.indexOf(text, from);
      expect(index, text).toBeGreaterThan(0);
      return index;
    };
    for (const [written, readBack] of [
      [
        'withoutPublishedRules(seededCatalogWrites, publishedRules)',
        'readLoyaltyWrites(seed, [...writes, ...kept])',
      ],
      ['giftVoucherWritesOf(calendar)', 'readPromotionWrites(writes)'],
      ['loyaltyWritesOf(uid, projection)', 'readLoyaltyWrites(seed, writes)'],
    ]) {
      const from = at(written);
      expect(at(readBack, from), written).toBeLessThan(
        at('batch.commit()', from),
      );
    }
    // The fold is handed the bundle the documents are read back with.
    expect(at('projectLoyaltyFor(\n    seed,')).toBeLessThan(
      at('loyaltyWritesOf(uid, projection)'),
    );
    // The account and its rows are swept by the client RECORD (D29).
    expect(at(".where('customerId', '==', customerId)")).toBeGreaterThan(
      at('const customerId = customerIdOf(uid);'),
    );
    // The waitlist request is the flat body, written with its TTL stamp.
    const waitlist = at('waitlistRequestWriteOf(clientBook)');
    expect(at('.set(stamped(path, data))', waitlist)).toBeGreaterThan(waitlist);
  });
});

// ── The fold's rules, on small hand-built books ────────────────────────────

const UID = 'dev-client-test';
const CAL = createShopCalendar(NOW);
const TODAY = CAL.dayKeyAt(0);

/** A fade with Иван at 10:00 at the Center, `dayOffset` days from the fixtures' today, booked by the desk. */
function fadeWithIvan(
  id,
  dayOffset,
  { bookedDaysAhead, arrivedMinutes, outcome },
) {
  return appointmentDocumentOf(
    {
      id,
      dayOffset,
      locationId: 'loc-center',
      placement: Placement.Staff,
      bookedOn: { dayOffset: dayOffset - bookedDaysAhead, minutes: 12 * 60 },
      arrivedMinutes,
      bookedFromAppointmentId: null,
      contact: null,
      seats: [
        {
          seatId: `${id}-s1`,
          barberId: 'ivan',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 10 * 60,
          durationMinutes: null,
          ...accountSeat(UID),
          barberPreference: BarberPreference.Any,
          ...outcome,
          tipCents: null,
        },
      ],
    },
    CAL,
  );
}

/** A worked fade with Иван at 10:00, `dayOffset` days from the fixtures' today. */
const worked = (id, dayOffset) =>
  fadeWithIvan(id, dayOffset, {
    bookedDaysAhead: 3,
    arrivedMinutes: 9 * 60 + 55,
    outcome: WORKED_SEAT,
  });

/** A visit the shop called off the evening before (Иван off sick). */
const calledOffByShop = (id, dayOffset) =>
  fadeWithIvan(id, dayOffset, {
    bookedDaysAhead: 5,
    arrivedMinutes: null,
    outcome: calledOffBefore(
      CancelledBy.Staff,
      CancellationReason.StaffBarberAbsence,
      16,
    ),
  });

const visitsAt = (offsets) =>
  offsets.map((offset, i) => worked(`appt-test-${i + 1}`, offset));
const project = (appointments, facts = {}, today = TODAY, catalog = null) =>
  projectLoyaltyFor(
    DOMAIN,
    UID,
    appointments,
    catalog ?? loyaltyCatalogFor(today),
    today,
    facts,
  );
const rhythm = (appointments, today = TODAY, catalog = null) =>
  cadenceOf(project(appointments, {}, today, catalog).account);
/** Five days after the last of `offsets`: the run as it stood then. */
const soonAfter = (offsets) => CAL.dayKeyAt(Math.max(...offsets) + 5);
/** A state's phase alone: its `streakPhase` and the `phase*` fields of that variant. */
const phaseOf = (state) =>
  Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => key === 'streakPhase' || key.startsWith('phase'),
    ),
  );

describe('projectLoyaltyFor — the rhythm', () => {
  it('stays in rhythm inside the cadence and its grace, at risk a week before it is due', () => {
    // Due on day +2 of a 42-day cadence: inside the 7-day risk lead.
    expect(rhythm(visitsAt([-80, -40]))).toMatchObject({
      current: 2,
      best: 2,
      streakPhase: 'AT_RISK',
      phaseDueBy: CAL.dayKeyAt(2),
      dueBy: CAL.dayKeyAt(2),
    });
    expect(phaseOf(rhythm(visitsAt([-80, -30])))).toEqual({
      streakPhase: 'ACTIVE',
    });
    // Past due, inside the grace: still the same run.
    expect(phaseOf(rhythm(visitsAt([-80, -45])))).toEqual({
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: CAL.dayKeyAt(4),
    });
    // A visit 49 days on (42 + 7 grace) keeps the run.
    expect(rhythm(visitsAt([-60, -11])).current).toBe(2);
  });

  it('breaks the run a day past the grace, and earns «Завръщане» on the next run’s second visit', () => {
    const offsets = [-300, -270, -240, -150, -120, -90, -60, -30];
    const projection = project(visitsAt(offsets));
    const state = cadenceOf(projection.account);
    expect(state).toMatchObject({ current: 5, best: 5 });
    const comeback = projection.badgeProgress['series-comeback'];
    expect(comeback.earned).toHaveLength(1);
    expect(comeback.earned[0].earnedLocalDate).toBe(CAL.dayKeyAt(-120));
    // Long gone since: broken on the day after the grace, repairable for 14 days.
    expect(rhythm(visitsAt([-300, -270, -240]))).toMatchObject({
      current: 0,
      best: 3,
      dueBy: null,
      streakPhase: 'BROKEN',
      phaseBrokenOn: CAL.dayKeyAt(-240 + 50),
      phaseRepairableUntil: CAL.dayKeyAt(-240 + 64),
    });
  });

  it('restores the run for the first visit inside the repair window, once a year', () => {
    // Broken on day −190; back five days later.
    const offsets = [-300, -270, -240, -185];
    const repaired = project(visitsAt(offsets), {}, soonAfter(offsets));
    expect(cadenceOf(repaired.account).current).toBe(4);
    expect(repaired.badgeProgress['series-comeback']).toBeUndefined();
    // Broken again on day −135 and back in five days: not a second time in a year.
    const later = [...offsets, -130, -100];
    const again = project(visitsAt(later), {}, soonAfter(later));
    expect(cadenceOf(again.account).current).toBe(2);
    expect(again.badgeProgress['series-comeback'].earned).toHaveLength(1);
  });

  it('spends a banked «защита» on a missed cadence instead of breaking', () => {
    // Five in rhythm bank one; the sixth comes 80 days on (> 49, one period covered).
    const offsets = [-400, -370, -340, -310, -280, -200];
    const state = rhythm(visitsAt(offsets), soonAfter(offsets));
    expect(state.current).toBe(6);
    // Spent, then «В ритъм» II (6 in rhythm) banks another.
    expect(state.freezesBanked).toBe(1);
    // Without the fifth visit nothing was banked: the gap breaks the run.
    const unbanked = [-400, -370, -340, -310, -200];
    expect(rhythm(visitsAt(unbanked), soonAfter(unbanked)).current).toBe(1);
  });

  it('restarts the due clock from a visit the shop called off', () => {
    // 80 days between the two visits, but only 45 since the one Иван missed.
    const excused = [
      worked('appt-test-1', -200),
      calledOffByShop('appt-test-2', -165),
      worked('appt-test-3', -120),
    ];
    const then = CAL.dayKeyAt(-115);
    expect(rhythm(excused, then).current).toBe(2);
    expect(rhythm([excused[0], excused[2]], then).current).toBe(1);
  });

  it('writes the day the run began: nobody’s while the count is lost, the visit that started over, the first one of a run restored', () => {
    const offsets = [-300, -270, -240, -150, -120];
    // Missed on day −190: nothing runs until he is back.
    expect(rhythm(visitsAt(offsets), CAL.dayKeyAt(-170))).toMatchObject({
      current: 0,
      runStartedOn: null,
    });
    expect(rhythm(visitsAt(offsets), CAL.dayKeyAt(-115))).toMatchObject({
      current: 2,
      runStartedOn: CAL.dayKeyAt(-150),
    });
    // Back inside the repair window: the run is the one that began first.
    const repaired = [-300, -270, -240, -185];
    expect(rhythm(visitsAt(repaired), soonAfter(repaired))).toMatchObject({
      current: 4,
      runStartedOn: CAL.dayKeyAt(-300),
    });
    // A protection covered the gap: the run never stopped.
    const banked = [-400, -370, -340, -310, -280, -200];
    expect(rhythm(visitsAt(banked), soonAfter(banked))).toMatchObject({
      current: 6,
      runStartedOn: CAL.dayKeyAt(-400),
    });
    // And the visit the shop called off never started anybody over.
    expect(
      rhythm(
        [
          worked('appt-test-1', -200),
          calledOffByShop('appt-test-2', -165),
          worked('appt-test-3', -120),
        ],
        CAL.dayKeyAt(-115),
      ).runStartedOn,
    ).toBe(CAL.dayKeyAt(-200));
  });

  it('reads back as the card’s reader reads it: no day for a lost count, the day of a run in progress, the field written either way', () => {
    const appointments = visitsAt([-300, -270, -240, -150, -120]);
    for (const [today, began] of [
      [CAL.dayKeyAt(-170), null],
      [CAL.dayKeyAt(-115), CAL.dayKeyAt(-150)],
    ]) {
      const projection = project(appointments, {}, today);
      expect(cadenceOf(projection.account)).toHaveProperty(
        'runStartedOn',
        began,
      );
      const read = readLoyaltyWrites(DOMAIN, loyaltyWritesOf(UID, projection));
      expect(read.problems).toEqual([]);
      expect(cadenceOf(read.accounts[0]).runStartedOn).toBe(began);
    }
  });
});

// ── The journal, as «Движение» folds it (revision 3 §2.2.5, §4.7) ─────────

/** The feed's order of precedence: an event is titled by the first of these it holds. */
const LEADING = ['REDEMPTION', 'REWARD', 'TIER', 'ACHIEVEMENT', 'POINTS'];

/**
 * A journal folded as the feed folds it: rows that share a `correlationId`
 * are one event, its amount the sum of their point deltas, its kind its
 * leading effect. Oldest first.
 */
function eventsOf(journal) {
  const events = new Map();
  for (const row of Object.values(journal)) {
    const rows = events.get(row.correlationId) ?? [];
    rows.push(row);
    events.set(row.correlationId, rows);
  }
  return [...events].map(([id, rows]) => ({
    id,
    rows,
    kind: LEADING.find((kind) =>
      rows.some((row) => row.journalEffect === kind),
    ),
    amount: rows.reduce(
      (sum, row) =>
        sum + (row.journalEffect === 'POINTS' ? row.pointsDelta : 0),
      0,
    ),
  }));
}

describe('the journal, as «Движение» folds it (§4.7)', () => {
  const { book, today, catalog, project: projectHolder } = seeded(NOW);
  const projections = LOYALTY_HOLDERS.map((holder) => ({
    holder,
    projection: projectHolder(holder),
    visits: workedVisitsOf(holder.uid, book.appointments).filter(
      (visit) => visit.day <= today,
    ),
  }));

  it('holds every kind of row the feed shows, for both holders', () => {
    for (const { holder, projection } of projections) {
      const kinds = new Set(
        Object.values(projection.clientJournal).map((row) => row.journalEffect),
      );
      expect([...kinds].sort(), holder.uid).toEqual([...FEED].sort());
    }
  });

  it('reads every row as the feed’s reader reads it, and every point row as the ledger’s', () => {
    for (const { holder, projection } of projections) {
      for (const [id, row] of Object.entries(projection.clientJournal)) {
        // The feed's query: the record, the client-visible rows, a pill's effects.
        expect(row, `${holder.uid} ${id}`).toMatchObject({
          customerId: customerIdOf(holder.uid),
          journalVisibility: 'CLIENT',
          reverses: null,
        });
        expect(FEED).toContain(row.journalEffect);
        expect(LABEL_CODES).toContain(row.labelCode);
        // The ledger's: a point row moves the balance by its figure, and no other row has one.
        expect(Number.isInteger(row.pointsDelta), `${holder.uid} ${id}`).toBe(
          row.journalEffect === 'POINTS',
        );
      }
    }
  });

  it('folds into one row per thing that happened: a visit, a level, a tier, a coupon, a redemption', () => {
    for (const { holder, projection, visits } of projections) {
      const events = eventsOf(projection.clientJournal);
      const count = (kind) =>
        events.filter((event) => event.kind === kind).length;
      const rows = (kind) => rowsOf(projection.clientJournal, kind).length;
      expect(count('POINTS'), holder.uid).toBe(visits.length);
      expect(count('ACHIEVEMENT'), holder.uid).toBe(rows('ACHIEVEMENT'));
      expect(count('TIER')).toBe(rows('TIER'));
      expect(count('REWARD')).toBe(rows('REWARD'));
      expect(count('REDEMPTION')).toBe(holder.redemptions.length);
      for (const event of events) {
        // One event, one instant, and rows that follow each other: a page
        // of the feed can cut the LAST event it holds, never one inside.
        expect(new Set(event.rows.map((row) => row.utcEpochMs)).size <= 2).toBe(
          true,
        );
        event.rows.forEach((row, i) => {
          if (i > 0) expect(row.seq).toBe(event.rows[i - 1].seq + 1);
        });
        // What leads it is there once; the rest of it is what it paid or cost.
        const others = event.rows.filter(
          (row) => row.journalEffect !== event.kind,
        );
        expect(event.rows.length - others.length >= 1).toBe(true);
        if (event.kind !== 'POINTS') {
          expect(event.rows.length - others.length, event.id).toBe(1);
          for (const other of others) {
            expect(other.journalEffect).toBe('POINTS');
          }
        }
      }
    }
  });

  it('Георги’s fade with a beard is ONE row, +27 т.: the two seats of the visit together', () => {
    const [{ projection, visits }] = projections;
    const both = visits.filter((visit) => visit.seats.length === 2);
    expect(both.length).toBeGreaterThan(0);
    const events = eventsOf(projection.clientJournal);
    for (const visit of both) {
      const event = events.find(
        ({ id }) => id === `appt:${visit.appointmentId}`,
      );
      expect(event.kind).toBe('POINTS');
      expect(event.rows.map((row) => row.pointsDelta).sort()).toEqual([10, 17]);
      expect(event.amount).toBe(27);
      // Each seat is still paid once, under its own key, for the one visit.
      expect(new Set(event.rows.map((row) => row.sourceAwardKey)).size).toBe(2);
      for (const row of event.rows) {
        expect(row.sourceAwardKey).toMatch(
          /^rule-earn-per-euro:dev-client-1:appt:[^:]+:seat:[^:]+$/,
        );
        expect(row.appointmentId).toBe(visit.appointmentId);
      }
    }
  });

  it('Георги: Бронз to Сребро to Злато, a coupon at the tenth and the twentieth stamp, one reward bought', () => {
    const [{ projection }] = projections;
    const journal = projection.clientJournal;
    expect(
      rowsOf(journal, 'TIER').map((row) => [row.tierFrom, row.tierTo]),
    ).toEqual([
      ['bronze', 'silver'],
      ['silver', 'gold'],
    ]);
    expect(
      rowsOf(journal, 'REWARD').map((row) => [
        PublicLabel.param(row, 'stamp'),
        row.rewardCouponGrantId,
        PublicLabel.param(row, 'reward'),
        PublicLabel.param(row, 'coupon'),
      ]),
    ).toEqual([
      [10, 'grant-dev-georgi-punch-10', 'reward-cut', PUNCH_CARD.couponId],
      [20, 'grant-dev-georgi-punch', 'reward-cut', PUNCH_CARD.couponId],
    ]);
    const [bought] = rowsOf(journal, 'REDEMPTION');
    expect(bought).toMatchObject({
      journalEffect: 'REDEMPTION',
      redemptionOp: 'REDEEMED',
      redemptionId: 'rdm-dev-georgi-cut',
      redeemedRewardId: 'reward-cut',
      redemptionCost: 250,
      grantRef: 'COUPON_GRANT',
      grantCouponGrantId: 'grant-rdm-dev-georgi-cut',
    });
    expect(bought).toMatchObject({
      actorRole: 'ADMIN',
      actorAdminUserId: 'dev-staff-ivan',
    });
    expect(
      eventsOf(journal).find(({ id }) => id === 'rdm-dev-georgi-cut'),
    ).toMatchObject({ kind: 'REDEMPTION', amount: -250 });
  });

  it('Мартин: Бронз to Сребро, a coupon at the tenth stamp, a beard bought at the desk', () => {
    const [, { projection }] = projections;
    const journal = projection.clientJournal;
    expect(
      rowsOf(journal, 'TIER').map((row) => [row.tierFrom, row.tierTo]),
    ).toEqual([['bronze', 'silver']]);
    expect(
      rowsOf(journal, 'REWARD').map((row) => row.rewardCouponGrantId),
    ).toEqual(['grant-dev-martin-punch-10']);
    const [bought] = rowsOf(journal, 'REDEMPTION');
    expect(bought).toMatchObject({
      actorRole: 'STAFF',
      actorUserId: 'dev-staff-ivan',
      actorRoles: ['barber', 'admin'],
    });
    expect(
      eventsOf(journal).find(({ id }) => id === 'rdm-dev-martin-beard'),
    ).toMatchObject({ kind: 'REDEMPTION', amount: -120 });
  });

  it('a level is its own event: the row that names it, then what it paid', () => {
    const [{ projection }] = projections;
    const events = eventsOf(projection.clientJournal).filter(
      (event) => event.kind === 'ACHIEVEMENT',
    );
    const paying = events.filter((event) => event.amount > 0);
    const free = events.filter((event) => event.amount === 0);
    // Both are in the book: «+20 т.», and a level that pays a protection or nothing.
    expect(paying.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
    for (const event of events) {
      const [level, ...paid] = event.rows;
      expect(level.journalEffect).toBe('ACHIEVEMENT');
      const seriesId = PublicLabel.param(level, 'seriesId');
      const rank = PublicLabel.param(level, 'level');
      expect(catalog.badgeSeries[seriesId].levels[rank - 1]).toBeDefined();
      expect(event.amount).toBe(
        paid.reduce((sum, row) => sum + row.pointsDelta, 0),
      );
    }
  });

  it('names no tier for the one an account opens on, and a drop on the night the window lets a visit go', () => {
    // Six visits (Сребро), long ago: the sixth makes it, the first leaving takes it.
    const offsets = [-460, -450, -440, -430, -420, -410];
    const journal = project(visitsAt(offsets)).clientJournal;
    const changes = rowsOf(journal, 'TIER');
    expect(changes.map((row) => [row.tierFrom, row.tierTo])).toEqual([
      ['bronze', 'silver'],
      ['silver', 'bronze'],
    ]);
    const [up, down] = changes;
    expect(up.localDate).toBe(CAL.dayKeyAt(-410));
    expect(down.utcEpochMs).toBe(CAL.msAt(-460 + 365, 0));
    expect(down.localDate).toBe(CAL.dayKeyAt(-460 + 365));
    expect(down.correlationId).toBe(
      `tier:${UID}:bronze:${CAL.dayKeyAt(-460 + 365)}`,
    );
    expect(down.idempotencyKey).toBe(down.correlationId);
  });
});

describe('projectLoyaltyFor — the rhythm under the rule the shop has in force (§4.10)', () => {
  const { today } = seeded(NOW);
  const [georgi, martin] = LOYALTY_HOLDERS;
  const under = (revise) => seeded(NOW, catalogUnder(revise));
  const seedsOwn = seeded(NOW);

  it('is the domain’s own projection of the book: the state the projector answers, written by its write half', () => {
    const { book, catalog, project } = seedsOwn;
    const rule = StreakRuleSystem.inForceOn(
      catalog.streakDefinitions.cadence,
      today,
    );
    for (const holder of LOYALTY_HOLDERS) {
      const projection = project(holder);
      const visits = workedVisitsOf(holder.uid, book.appointments).filter(
        (visit) => visit.day <= today,
      );
      // The facts, from the book by hand: every visit counts under «всяко
      // посещение», and the protections are the ones «В ритъм» gave.
      const levels = catalog.badgeSeries['series-rhythm'].levels;
      const grants = projection.badgeProgress['series-rhythm'].earned.flatMap(
        (earned) =>
          levels[earned.level - 1].awards
            .filter((award) => award.awardKind === 'FREEZE')
            .map((award) => ({
              localDate: earned.earnedLocalDate,
              count: award.awardFreezeCount,
            })),
      );
      const trace = StreakSystem.trace(
        'cadence',
        rule,
        {
          visits: visits.map((visit) => ({
            localDate: visit.day,
            counted: true,
            utcEpochMs: visit.startMs,
          })),
          excused: [],
          bookings: [],
          pauses: [],
          grants,
        },
        today,
      );
      const state = cadenceOf(projection.account);
      // Nothing but the visit ahead is the book's to add here: neither
      // holder needed an excuse or a hold to stay in rhythm.
      expect({ ...state, heldByAppointmentId: null, heldOn: null }).toEqual(
        trace.state,
      );
      expect(state.runStartedOn).toBe(trace.runStartedOn);
      expect(state.runStartedOn).toBe(visits[0].day);
      expect(projection.account.records[0]).toEqual({
        personalRecordKind: 'LONGEST_RHYTHM',
        value: trace.record.value,
        on: trace.record.on,
        year: null,
        serviceId: null,
      });
    }
  });

  it('names the visit on the book that holds the period: Мартин’s chair today, nobody’s for Георги this evening', () => {
    const { project } = seedsOwn;
    expect(cadenceOf(project(georgi).account)).toMatchObject({
      heldByAppointmentId: null,
      heldOn: null,
    });
    expect(cadenceOf(project(martin).account)).toMatchObject({
      heldByAppointmentId: 'appt-dev-2',
      heldOn: today,
    });
    // In the morning Георги's own cut is still ahead of him.
    const morning = seeded(Date.parse('2026-09-28T07:30:00+03:00'));
    expect(cadenceOf(morning.project(georgi).account)).toMatchObject({
      heldByAppointmentId: 'appt-dev-1',
      heldOn: today,
    });
  });

  it('moves both cards when the shop publishes another interval', () => {
    const { project } = under(published({ intervalDays: 28 }));
    const was = seedsOwn.project(martin);
    const is = project(martin);
    // Георги comes every three to four weeks: only his due date moves.
    expect(cadenceOf(project(georgi).account)).toMatchObject({
      definitionVersion: 2,
      current: 24,
      best: 24,
      streakPhase: 'ACTIVE',
      dueBy: '2026-10-26',
      periodIntervalDays: 28,
      periodGraceDays: 7,
      periodSource: 'FIXED',
    });
    expect(cadenceOf(seedsOwn.project(georgi).account).dueBy).toBe(
      '2026-11-09',
    );
    // Мартин comes every five to six: under four weeks he has missed some.
    const state = cadenceOf(is.account);
    expect(cadenceOf(was.account)).toMatchObject({
      definitionVersion: 1,
      current: 13,
      best: 13,
    });
    expect(state).toMatchObject({
      definitionVersion: 2,
      periodIntervalDays: 28,
      // Past its grace, and held by the chair he sits in today.
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: today,
      heldByAppointmentId: 'appt-dev-2',
      heldOn: today,
    });
    expect(state.current).toBeLessThan(13);
    expect(state.best).toBeLessThan(13);
    // The run he is on began with the visit after his last miss; Георги's
    // with his first, as before.
    expect(cadenceOf(was.account).runStartedOn).toBe('2025-05-06');
    expect(state.runStartedOn).toBe('2026-03-21');
    expect(
      state.periods
        .map(({ streakPeriodMark, on }) => `${streakPeriodMark} ${on}`)
        .slice(5, 7),
    ).toEqual(['MISSED 2026-03-07', 'KEPT 2026-03-21']);
    expect(cadenceOf(project(georgi).account).runStartedOn).toBe(
      cadenceOf(seedsOwn.project(georgi).account).runStartedOn,
    );
    const marks = state.periods.map((period) => period.streakPeriodMark);
    expect(marks).toContain('MISSED');
    expect(marks).toContain('REPAIRED');
    expect(
      state.periods
        .filter((period) => period.streakPeriodMark === 'PROTECTED')
        .map((period) => period.periodReason),
    ).toEqual(['FREEZE', 'BARBER_ABSENCE']);
    // What counts the rhythm follows it: the family, the record, «Завръщане».
    expect(is.badgeProgress['series-rhythm'].value).toBe(state.best);
    expect(is.badgeProgress['series-rhythm'].earned.length).toBeLessThan(
      was.badgeProgress['series-rhythm'].earned.length,
    );
    expect(is.account.records[0]).toMatchObject({
      personalRecordKind: 'LONGEST_RHYTHM',
      value: state.best,
    });
    expect(was.badgeProgress['series-comeback']).toBeUndefined();
    expect(is.badgeProgress['series-comeback'].earned).toHaveLength(1);
    // And nothing else moved: the visits are the visits.
    expect(is.badgeProgress['series-visits']).toEqual(
      was.badgeProgress['series-visits'],
    );
    const tierOf = (acc) =>
      Object.fromEntries(
        Object.entries(acc).filter(
          ([key]) => key.startsWith('tier') || key === 'nextTierId',
        ),
      );
    expect(tierOf(is.account)).toEqual(tierOf(was.account));
  });

  it('keeps every invariant under a published rule, whatever it is', () => {
    for (const patch of [
      { intervalDays: 28 },
      { intervalDays: 84, graceDays: 0 },
      {
        streakInterval: 'PERSONAL',
        intervalTolerancePct: 25,
        intervalMinDays: 21,
        intervalMaxDays: 70,
        intervalFallbackDays: 42,
      },
      { excuses: [], bookingHoldEnabled: false, bookingHoldMaxDaysPastDue: 14 },
      {
        onBreak: 'HOLD',
        repairEnabled: false,
        repairWindowDays: 14,
        repairPerYear: 1,
      },
      {
        protectionsEnabled: false,
        protectionsMaxBanked: 2,
        protectionsEarnEvery: 5,
        protectionsStartWith: 0,
      },
    ]) {
      const { book, catalog, project } = under(published(patch));
      for (const holder of LOYALTY_HOLDERS) {
        const projection = project(holder);
        expectConsistent(projection, {
          uid: holder.uid,
          book,
          catalog,
          today,
          nowMs: NOW,
        });
        const read = readLoyaltyWrites(
          DOMAIN,
          loyaltyWritesOf(holder.uid, projection),
        );
        expect(read.problems, JSON.stringify(patch)).toEqual([]);
        expect(cadenceOf(read.accounts[0]).definitionVersion).toBe(2);
      }
    }
  });

  it('knows the person’s own habit under a personal interval', () => {
    const { project } = under(
      published({
        streakInterval: 'PERSONAL',
        intervalTolerancePct: 25,
        intervalMinDays: 21,
        intervalMaxDays: 70,
        intervalFallbackDays: 42,
      }),
    );
    for (const holder of LOYALTY_HOLDERS) {
      const state = cadenceOf(project(holder).account);
      expect(state.periodSource).toBe('PERSONAL');
      expect(state.periodHabitDays).toBeGreaterThan(20);
      expect(state.periodIntervalDays).toBeGreaterThanOrEqual(
        Math.floor(state.periodHabitDays),
      );
    }
    // Георги's habit is the shorter: he comes more often.
    expect(cadenceOf(project(georgi).account).periodHabitDays).toBeLessThan(
      cadenceOf(project(martin).account).periodHabitDays,
    );
  });

  it('projects under the version that waits from its own day on, and not a day sooner', () => {
    const waitingFrom = (day) => (head) => ({
      ...head,
      rules: [
        inRole(head, HeadRole.Current),
        {
          ...inRole(head, HeadRole.Current),
          version: 2,
          effectiveFromLocalDate: day,
          intervalDays: 28,
          headRole: 'SCHEDULED',
          streakTransition: 'GRANDFATHER',
        },
      ],
    });
    const tomorrow = CAL.dayKeyAt(1);
    expect(
      cadenceOf(under(waitingFrom(tomorrow)).project(martin).account),
    ).toEqual(cadenceOf(seedsOwn.project(martin).account));
    expect(
      cadenceOf(under(waitingFrom(today)).project(martin).account),
    ).toEqual(
      cadenceOf(under(published({ intervalDays: 28 })).project(martin).account),
    );
  });

  it('holds no rhythm under a rule that is off: no state, no family, no record, and everything else as it was', () => {
    const { book, catalog, project } = under(published({ enabled: false }));
    for (const holder of LOYALTY_HOLDERS) {
      const was = seedsOwn.project(holder);
      const is = project(holder);
      expect(is.account.streaks).toEqual([]);
      expect(is.badgeProgress['series-rhythm']).toBeUndefined();
      expect(is.badgeProgress['series-comeback']).toBeUndefined();
      expect(
        is.account.records.map((record) => record.personalRecordKind),
      ).toEqual(['MOST_VISITS_IN_YEAR', 'FAVOURITE_SERVICE', 'FIRST_VISIT']);
      expect(is.account.tierId).toBe(was.account.tierId);
      expect(is.account.tierSinceUtcMs).toBe(was.account.tierSinceUtcMs);
      expect(is.badgeProgress['series-visits']).toEqual(
        was.badgeProgress['series-visits'],
      );
      expectConsistent(is, {
        uid: holder.uid,
        book,
        catalog,
        today,
        nowMs: NOW,
      });
      expect(
        readLoyaltyWrites(DOMAIN, loyaltyWritesOf(holder.uid, is)).problems,
      ).toEqual([]);
    }
  });

  it('counts the visits the rule’s qualifier counts: a rule about the beard is not about Мартин’s cut', () => {
    const { project } = under(
      published({
        streakQualifier: 'SERVICES',
        qualifierServiceIds: ['svc-beard'],
      }),
    );
    expect(project(martin).account.streaks).toEqual([]);
    const state = cadenceOf(project(georgi).account);
    expect(state.best).toBeLessThan(24);
    expect(state.best).toBeGreaterThan(0);
    // A category holds every seeded service: it counts as «всяко посещение» does.
    const byCategory = under(
      published({
        streakQualifier: 'CATEGORIES',
        qualifierCategoryIds: ['cat-hair'],
      }),
    );
    for (const holder of LOYALTY_HOLDERS) {
      expect(cadenceOf(byCategory.project(holder).account)).toEqual({
        ...cadenceOf(seedsOwn.project(holder).account),
        definitionVersion: 2,
      });
    }
  });

  it('lets the RULE say what a called-off visit excuses, not the book', () => {
    // 80 days between the two visits, but only 45 since the one Иван missed.
    const book = [
      worked('appt-test-1', -200),
      calledOffByShop('appt-test-2', -165),
      worked('appt-test-3', -120),
    ];
    const then = CAL.dayKeyAt(-115);
    const without = catalogUnder(
      published({ excuses: ['SHOP_CLOSURE', 'CLOSED_DAYS'] }),
    )(then);
    expect(rhythm(book, then).current).toBe(2);
    expect(rhythm(book, then, without).current).toBe(1);
  });

  it('stops on a rule the wire’s reader refuses, naming it', () => {
    const broken = catalogUnder((head) => ({
      ...head,
      rules: [{ ...inRole(head, HeadRole.Current), graceDays: 42 }],
    }))(today);
    expect(() =>
      projectLoyaltyFor(DOMAIN, UID, visitsAt([-10]), broken, today),
    ).toThrow(/the cadence rhythm does not read/);
    // And a head that holds no rule in force at all.
    const headless = catalogUnder((head) => ({ ...head, rules: [] }))(today);
    expect(() =>
      projectLoyaltyFor(DOMAIN, UID, visitsAt([-10]), headless, today),
    ).toThrow(/the cadence rhythm does not read: it holds no rule in force/);
  });
});

describe('the coupons the engine granted', () => {
  const { book, today, catalog } = seeded(NOW);
  const [georgi, martin] = LOYALTY_HOLDERS;

  it('names the newest stamp’s coupon by the holder’s bare id while they hold it, every other by its stamp', () => {
    expect(
      stampGrantIdOf('dev-client-1', 20, {
        naming: georgi.stampGrants,
        newest: 20,
      }),
    ).toBe('grant-dev-georgi-punch');
    expect(
      stampGrantIdOf('dev-client-1', 10, {
        naming: georgi.stampGrants,
        newest: 20,
      }),
    ).toBe('grant-dev-georgi-punch-10');
    expect(
      stampGrantIdOf('dev-client-2', 10, {
        naming: martin.stampGrants,
        newest: 10,
      }),
    ).toBe('grant-dev-martin-punch-10');
    expect(stampGrantIdOf(UID, 10, { newest: 10 })).toBe(
      `grant-${UID}-punch-10`,
    );
  });

  it('Георги holds the twentieth stamp’s free cut and used the tenth’s on the visit after', () => {
    const visits = workedVisitsOf('dev-client-1', book.appointments);
    expect(
      punchCardGrantsOf(
        'dev-client-1',
        book.appointments,
        today,
        georgi.stampGrants,
      ),
    ).toEqual([
      {
        stamp: 10,
        appointmentId: visits[9].appointmentId,
        grantId: 'grant-dev-georgi-punch-10',
        couponId: PUNCH_CARD.couponId,
        grantedAtUtcMs: visits[9].doneMs,
        usedAtUtcMs: visits[10].doneMs,
      },
      {
        stamp: 20,
        appointmentId: visits[19].appointmentId,
        grantId: 'grant-dev-georgi-punch',
        couponId: PUNCH_CARD.couponId,
        grantedAtUtcMs: visits[19].doneMs,
        usedAtUtcMs: null,
      },
    ]);
  });

  it('Мартин used his, and a coupon nobody has come back to use is still held', () => {
    const [tenth] = punchCardGrantsOf(
      'dev-client-2',
      book.appointments,
      today,
      martin.stampGrants,
    );
    expect(tenth).toMatchObject({
      stamp: 10,
      grantId: 'grant-dev-martin-punch-10',
    });
    expect(tenth.usedAtUtcMs).not.toBeNull();
    // Ten visits and none since: the tenth's coupon waits.
    const ten = visitsAt(Array.from({ length: 10 }, (_, i) => -300 + i * 30));
    expect(punchCardGrantsOf(UID, ten, TODAY)).toEqual([
      expect.objectContaining({
        stamp: 10,
        grantId: `grant-${UID}-punch-10`,
        usedAtUtcMs: null,
      }),
    ]);
  });

  it('grants what a redemption bought at the counter, the instant its row is written, under the id the row names', () => {
    for (const holder of LOYALTY_HOLDERS) {
      const projection = seeded(NOW).project(holder);
      const granted = redemptionGrantsOf(
        holder.uid,
        book.appointments,
        catalog,
        today,
        holder.redemptions,
      );
      expect(
        granted.map(({ grantId, couponId, grantedAtUtcMs }) => [
          grantId,
          couponId,
          grantedAtUtcMs,
        ]),
      ).toEqual(
        rowsOf(projection.clientJournal, 'REDEMPTION').map((row) => [
          row.grantCouponGrantId,
          catalog.rewardsCatalog[row.redeemedRewardId].grantCouponId,
          row.utcEpochMs,
        ]),
      );
      for (const { grantedAtUtcMs, usedAtUtcMs } of granted) {
        expect(usedAtUtcMs > grantedAtUtcMs).toBe(true);
      }
    }
    expect(redemptionGrantIdOf('rdm-dev-georgi-cut')).toBe(
      'grant-rdm-dev-georgi-cut',
    );
    expect(redemptionGrantsOf(UID, visitsAt([-10]), catalog, TODAY)).toEqual(
      [],
    );
  });
});

describe('projectLoyaltyFor — the tier', () => {
  it('drops a tier on the night the window lets a visit go, and dates it then', () => {
    // Six visits (Сребро) ten days apart, long ago; the first leaves the
    // 365-day window at 00:00 on its anniversary.
    const offsets = [-460, -450, -440, -430, -420, -410];
    const projection = project(visitsAt(offsets));
    expect(projection.account).toMatchObject({
      tierId: 'bronze',
      tierQualifying: 0,
      nextTierId: 'silver',
      tierRemaining: 6,
    });
    const demoted = CAL.dayKeyAt(-460 + 365);
    expect(projection.account.tierSinceUtcMs).toBe(CAL.msAt(-460 + 365, 0));
    expect(sofiaDay(projection.account.tierSinceUtcMs)).toBe(demoted);
  });

  it('counts the visits of the last 365 days', () => {
    const projection = project(visitsAt([-400, -300, -200, -100, -10]));
    expect(projection.account.tierQualifying).toBe(4);
  });
});

describe('projectLoyaltyFor — facts no appointment carries', () => {
  it('earns «Пълен профил» at the first booking when the e-mail, the birthday and the portrait are there', () => {
    const appointments = visitsAt([-100, -60]);
    const profile = {
      email: 'x@test.local',
      birthDate: '1990-01-01',
      hasAvatar: true,
    };
    const complete = project(appointments, { profile });
    const [earned] = complete.badgeProgress['series-profile'].earned;
    expect(earned.earnedAtUtcMs).toBe(appointments[0].doc.bookedAtUtcMs);
    expect(earned.earnedLocalDate).toBe(
      sofiaDay(appointments[0].doc.bookedAtUtcMs),
    );
    for (const missing of [
      { ...profile, email: null },
      { ...profile, birthDate: null },
      { ...profile, hasAvatar: false },
    ]) {
      expect(
        project(appointments, { profile: missing }).badgeProgress[
          'series-profile'
        ],
      ).toBeUndefined();
    }
  });

  it('earns the birthday visit once a year, and counts the years', () => {
    const birthday = CAL.dayKeyAt(-400);
    const profile = {
      email: null,
      birthDate: `1990${birthday.slice(4)}`,
      hasAvatar: false,
    };
    const yearOn = `${Number(birthday.slice(0, 4)) + 1}${birthday.slice(4)}`;
    const projection = project(
      visitsAt([-400, -380, dayNumber(yearOn) - dayNumber(TODAY)]),
      { profile },
    );
    expect(projection.badgeProgress['series-birthday']).toMatchObject({
      value: 2,
      earned: [{ level: 1, count: 2 }],
    });
  });

  it('pays a redemption from the balance at the counter, after the visit it names', () => {
    const appointments = visitsAt(
      Array.from({ length: 8 }, (_, i) => -300 + i * 30),
    );
    const desk = { actorRole: 'ADMIN', actorAdminUserId: 'dev-staff-ivan' };
    const projection = project(appointments, {
      redemptions: [
        {
          id: 'rdm-test',
          rewardId: 'reward-beard',
          afterVisit: 8,
          actor: desk,
        },
      ],
    });
    const [cost, bought] = Object.values(projection.clientJournal).slice(-2);
    expect(cost).toMatchObject({
      journalEffect: 'POINTS',
      pointsDelta: -120,
      journalSource: 'REDEMPTION',
      sourceRedemptionId: 'rdm-test',
      correlationId: 'rdm-test',
      idempotencyKey: 'rdm:rdm-test#0',
      labelCode: 'points.redeemed',
      labelParams: [
        { name: 'reward', value: 'reward-beard' },
        { name: 'points', value: 120 },
      ],
      ...desk,
    });
    // What it bought, in the same event: the feed folds the two into one row.
    expect(bought).toMatchObject({
      utcEpochMs: cost.utcEpochMs,
      journalEffect: 'REDEMPTION',
      redemptionOp: 'REDEEMED',
      redemptionId: 'rdm-test',
      redeemedRewardId: 'reward-beard',
      redemptionCost: 120,
      grantRef: 'COUPON_GRANT',
      grantCouponGrantId: 'grant-rdm-test',
      journalSource: 'REDEMPTION',
      sourceRedemptionId: 'rdm-test',
      ...desk,
      correlationId: 'rdm-test',
      idempotencyKey: 'rdm:rdm-test#1',
      labelCode: 'redemption.changed',
      labelParams: [
        { name: 'op', value: 'redeemed' },
        { name: 'reward', value: 'reward-beard' },
      ],
      balanceAfter: cost.balanceAfter,
    });
    expect(projection.account.lifetimeSpent).toBe(120);
  });
});

describe('projectLoyaltyFor — what it refuses', () => {
  it('keeps no account for somebody the engine never saw', () => {
    const { book, today, catalog } = seeded(NOW);
    expect(
      projectLoyaltyFor(
        DOMAIN,
        'dev-client-nobody',
        book.appointments,
        catalog,
        today,
      ),
    ).toBeNull();
  });

  it('refuses a redemption the balance could not have paid', () => {
    const desk = { actorRole: 'ADMIN', actorAdminUserId: 'dev-staff-ivan' };
    expect(() =>
      project(visitsAt([-100]), {
        redemptions: [
          {
            id: 'rdm-test',
            rewardId: 'reward-product',
            afterVisit: 1,
            actor: desk,
          },
        ],
      }),
    ).toThrow(/cannot redeem rdm-test/);
    expect(() =>
      project(visitsAt([-100]), {
        redemptions: [
          {
            id: 'rdm-test',
            rewardId: 'reward-cut',
            afterVisit: 2,
            actor: desk,
          },
        ],
      }),
    ).toThrow(/no worked visit 2/);
  });

  it('refuses a visit it cannot price', () => {
    const [visit] = visitsAt([-100]);
    const discounted = {
      ...visit,
      doc: { ...visit.doc, discounts: [{ discountMethod: 'PERCENT_OFF' }] },
    };
    expect(() => project([discounted])).toThrow(/cannot price/);
  });

  it('refuses a family no rule projects', () => {
    const catalog = loyaltyCatalogFor(TODAY);
    catalog.badgeSeries['series-mystery'] = {
      ...catalog.badgeSeries['series-welcome'],
      order: 99,
    };
    expect(() =>
      projectLoyaltyFor(DOMAIN, UID, visitsAt([-10]), catalog, TODAY),
    ).toThrow(/series-mystery/);
  });
});

describe('the fold reads the book as clientStats does', () => {
  it('counts a companion’s visits as theirs', () => {
    const { book } = seeded(NOW);
    const stats = statsOf(book, 'dev-client-10', NOW);
    expect(workedVisitsOf('dev-client-10', book.appointments)).toHaveLength(
      stats.lifetimeVisitsCompleted,
    );
    expect(stats.lifetimeVisitsCompleted).toBeGreaterThan(0);
  });

  it('mints the stamp card’s coupon at every tenth visit, as that chair freed', () => {
    const appointments = visitsAt(
      Array.from({ length: 21 }, (_, i) => -21 * 30 + i * 30),
    );
    const grants = punchCardGrantsOf(UID, appointments, TODAY);
    expect(grants.map((grant) => grant.stamp)).toEqual([10, 20]);
    expect(grants[0]).toMatchObject({ appointmentId: 'appt-test-10' });
    expect(project(appointments).account.punchCards[0].filled).toBe(1);
  });
});

describe('loyaltyCatalogDriftOf — an emulator seeded before catalog.json changed', () => {
  const writes = loyaltyCatalogWritesOf(
    loyaltyCatalogFor(LOYALTY_CATALOG_TODAY),
  );

  /** A map's keys in reverse, all the way down: Firestore keeps no order. */
  const reordered = (value) =>
    Array.isArray(value)
      ? value.map(reordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, inner]) => [key, reordered(inner)]),
          )
        : value;

  /** The emulator after a seed of `catalog`, each document as it reads back. */
  const storedAfterSeedOf = (catalog) =>
    new Map(
      loyaltyCatalogWritesOf(catalog).map(({ path, data }) => [
        path,
        reordered(data),
      ]),
    );

  it('finds nothing when the emulator holds catalog.json, whatever day the seed moved the seasons to', () => {
    for (const seededOn of [
      LOYALTY_CATALOG_TODAY,
      '2026-11-14',
      '2027-03-02',
    ]) {
      expect(
        loyaltyCatalogDriftOf(
          writes,
          storedAfterSeedOf(loyaltyCatalogFor(seededOn)),
        ),
      ).toEqual([]);
    }
  });

  it('names each family still wearing its old face, with both emblems (Critique 3)', () => {
    const before = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
    before.badgeSeries['series-comeback'].emblem = 'streak';
    // Wave D r6: every season's «every month» wore one calendar.
    before.badgeSeries['series-2026-autumn-each-month'].emblem =
      'seasonMonthly';

    expect(loyaltyCatalogDriftOf(writes, storedAfterSeedOf(before))).toEqual([
      'badgeSeries/series-comeback: emblem "streak" (catalog.json: "comeback")',
      'badgeSeries/series-2026-autumn-each-month: emblem "seasonMonthly" (catalog.json: "umbrella")',
    ]);
  });

  it('names a missing document, a changed map by its field, and a field only one side holds', () => {
    const before = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
    before.badgeSeries['series-comeback'].title.bg = 'Отново тук';
    delete before.badgeSeries['series-comeback'].retiredAtUtcMs;
    before.badgeSeries['series-comeback'].legacy = true;
    const stored = storedAfterSeedOf(before);
    stored.delete('seasons/season-2026-autumn');

    expect(loyaltyCatalogDriftOf(writes, stored)).toEqual([
      'badgeSeries/series-comeback: legacy true (catalog.json: absent), retiredAtUtcMs absent (catalog.json: null), title',
      'seasons/season-2026-autumn: missing',
    ]);
  });

  it('never counts a document only the emulator holds (a re-seed deletes nothing)', () => {
    const stored = storedAfterSeedOf(loyaltyCatalogFor(LOYALTY_CATALOG_TODAY));
    stored.set('badgeSeries/series-retired-long-ago', { emblem: 'visits' });

    expect(loyaltyCatalogDriftOf(writes, stored)).toEqual([]);
  });

  it('counts a season changed beyond its window', () => {
    const before = loyaltyCatalogFor('2026-11-14');
    before.seasons['season-2026-autumn'].seriesIds = [];

    expect(loyaltyCatalogDriftOf(writes, storedAfterSeedOf(before))).toEqual([
      'seasons/season-2026-autumn: seriesIds',
    ]);
  });
});
