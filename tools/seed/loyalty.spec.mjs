/**
 * The seed's loyalty documents, held to the wire contract WP3's fixtures pin
 * (client-card-redesign.md §4.4) and to the production code that reads the
 * same book: the projection has the fixtures' SHAPE (not their numbers),
 * «Посещения» is what `computeClientStats` counts, the balance is the sum of
 * the rows, and every level was earned by a count that reached it — on the
 * fixtures' own day and on days spread over two years (§7.5 «Seed»). Every
 * document the seed writes for the client card — the catalogue, both
 * accounts, Мартин's waitlist request — reads back through the card's own
 * readers, as the seed's bundle holds them.
 *
 * The fold's rules — the tier's rolling window, the refusals — are pinned on
 * small hand-built books. The rhythm's clock is the DOMAIN's
 * (client-card-revision-3.md §4.2): the fold hands `traceStreak` the book as
 * facts, so the rhythm's cases here hold the seed to the books the old copy
 * of the clock was pinned on, and to the rule the shop has in force.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WAITLIST_COLLECTION,
  appointmentFromDocument,
} from '@creativo/application/booking';
import {
  ACTIVITY_EFFECT_KINDS,
  BADGE_PROGRESS_COLLECTION as WIRE_BADGE_PROGRESS,
  CLIENT_JOURNAL_COLLECTION as WIRE_CLIENT_JOURNAL,
  LOYALTY_ACCOUNTS_COLLECTION as WIRE_LOYALTY_ACCOUNTS,
  LOYALTY_CATALOG_COLLECTIONS as WIRE_CATALOG_COLLECTIONS,
  SEASON_PROGRESS_COLLECTION as WIRE_SEASON_PROGRESS,
  STREAK_DEFINITIONS_COLLECTION as WIRE_STREAK_DEFINITIONS,
  STREAK_DEFINITION_VERSIONS_COLLECTION as WIRE_STREAK_VERSIONS,
  activityEntryFromDocument,
  badgeProgressFromDocument,
  clientJournalEntryId as wireJournalEntryId,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  seasonProgressFromDocument,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionId as wireVersionId,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
  streakStateToDocument,
} from '@creativo/application/engagement';
import {
  InMemoryStreakDefinitionRepository,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { UserId } from '@creativo/domain/accounts';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import { computeClientStats } from '@creativo/domain/scheduling';
import { beforeAll, describe, expect, it } from 'vitest';
// The projector by its own path: the domain's barrel does not carry its
// line yet (contract delta R2b-1), and the seed's bundle names it so too.
import { traceStreak } from '../../libs/domain/engagement/src/lib/loyalty/streak-projector';
import { account, appointmentDocumentOf } from './appointments.mjs';
import { createShopCalendar } from './calendar.mjs';
import { buildClientBook } from './fixtures.mjs';
import { loadSeedDomain } from './load-domain.mjs';
import {
  BADGE_PROGRESS_COLLECTION,
  CLIENT_JOURNAL_COLLECTION,
  LOYALTY_ACCOUNTS_COLLECTION,
  LOYALTY_CATALOG_COLLECTIONS,
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  PUNCH_CARD,
  SEASON_PROGRESS_COLLECTION,
  SEED_RULE_PUBLISHER,
  STREAK_DEFINITIONS_COLLECTION,
  STREAK_DEFINITION_VERSIONS_COLLECTION,
  catalogAsHeld,
  clientJournalEntryId,
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
  seedRuleRequestId,
  seedRuleVersionWriteOf,
  stampGrantIdOf,
  streakDefinitionVersionId,
  withoutPublishedRules,
  workedVisitsOf,
} from './loyalty.mjs';
import {
  SEEDED_WAITLIST_REQUEST,
  WAITLIST_REQUESTS_COLLECTION,
  waitlistRequestWriteOf,
} from './waitlist.mjs';

const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
const sofiaDay = (instant) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(
    new Date(instant),
  );
const phaseOn = (window, day) =>
  day < window.from ? 'announced' : day > window.until ? 'ended' : 'open';

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
 * What the fold is handed, imported the ordinary way: the production code
 * the seed's bundle holds (`load-domain.spec.mjs` holds the two equal), so
 * every case below folds through the domain's own projector.
 */
const DOMAIN = {
  ServiceCategoryId,
  ServiceId,
  activityEntryFromDocument,
  badgeProgressFromDocument,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  seasonProgressFromDocument,
  streakDefinitionVersionFromDocument,
  streakScheduleFromDocument,
  streakStateToDocument,
  traceStreak,
};

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

/** Version 2 of the seed's rule, in force: what a publish leaves in the head. */
const published = (patch) => (head) => ({
  ...head,
  current: { ...head.current, version: 2, ...patch },
  updatedAt: '2026-06-01T09:00:00.000Z',
});

const pointsOf = (journal) =>
  Object.values(journal).filter((row) => row.effect.kind === 'points');
const rowsOf = (journal, kind) =>
  Object.values(journal).filter((row) => row.effect.kind === kind);

function statsOf(book, uid, nowMs) {
  return computeClientStats(
    UserId.create(uid).value,
    book.appointments.map(({ id, doc }) => {
      const parsed = appointmentFromDocument(id, doc);
      if (parsed.isFailure()) throw new Error(`${id}: ${parsed.error.message}`);
      return parsed.value;
    }),
    nowMs,
  );
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
const accountShapeOf = (accountDoc) => ({
  ...shapeOf({ ...accountDoc, streaks: null }),
  streaks: shapesOf(Object.values(accountDoc.streaks)),
});

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

  // «Посещения» is clientStats' completed visits.
  const stats = statsOf(book, uid, nowMs);
  expect(badgeProgress['series-visits']?.value, uid).toBe(
    stats.lifetime.visitsCompleted,
  );

  // Dense over EVERY row, keyed, in time order; the balance runs over the
  // point rows alone, and every row says what it leaves.
  let running = 0;
  rows.forEach(([id, row], i) => {
    expect(row.userId).toBe(uid);
    expect(row.seq).toBe(i + 1);
    expect(id).toBe(clientJournalEntryId(uid, row.seq));
    if (i > 0) expect(row.at >= entries[i - 1].at).toBe(true);
    if (row.effect.kind === 'points') running += row.effect.delta;
    expect(row.balanceAfter, id).toBe(running);
    expect(row.visibility).toBe('client');
    expect(row.reverses).toBeNull();
    // The feed shows these five and no other (§4.7).
    expect(ACTIVITY_EFFECT_KINDS.all, id).toContain(row.effect.kind);
  });
  expect(acc.seq).toBe(entries.length);
  expect(acc.balance).toBe(running);
  expect(acc.balance).toBe(
    acc.lifetimeEarned + acc.lifetimeAdjusted - acc.lifetimeSpent,
  );
  expect(acc.lifetimeSpent).toBe(
    -points
      .filter((row) => row.source.kind === 'redemption')
      .reduce((sum, row) => sum + row.effect.delta, 0),
  );
  expect(acc.updatedAt >= (entries.at(-1)?.at ?? '')).toBe(true);
  expect(acc.version).toBeGreaterThanOrEqual(
    new Set(entries.map((row) => row.at)).size,
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
        expect(earned.earnedAt >= progress.earned[i - 1].earnedAt).toBe(true);
      }
      expect(sofiaDay(earned.earnedAt) <= today, seriesId).toBe(true);
    });
    const monotonic = series.metric !== null && !series.metric.window;
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
    const { source, publicLabel } = row;
    if (source.kind === 'redemption') {
      expect(-row.effect.delta).toBe(
        catalog.rewardsCatalog[publicLabel.params.reward].cost,
      );
      continue;
    }
    expect(row.idempotencyKey).toBe(`award:${source.awardKey}#0`);
    const { seriesId } = publicLabel.params;
    if (seriesId === undefined) {
      expect(row.effect.delta).toBe(
        Math.floor(publicLabel.params.spendMinor / 100),
      );
      continue;
    }
    const level =
      catalog.badgeSeries[seriesId].levels[publicLabel.params.level - 1];
    expect(source.rule.ruleId).toBe(level.ruleId);
    expect(level.awards).toContainEqual({
      kind: 'points',
      points: row.effect.delta,
    });
    expect(
      badgeProgress[seriesId].earned.find(
        (earned) => earned.level === level.level,
      )?.earnedAt,
    ).toBe(row.at);
  }

  // A level earned is a row of its own: as many rows as times earned, the
  // newest at the instant the progress says; what it pays is in ITS event.
  const levelRows = rowsOf(clientJournal, 'achievement');
  expect(levelRows).toHaveLength(
    Object.values(badgeProgress).reduce(
      (sum, progress) =>
        sum + progress.earned.reduce((times, e) => times + e.count, 0),
      0,
    ),
  );
  for (const row of levelRows) {
    const { seriesId, level, rule } = row.publicLabel.params;
    const catalogued = catalog.badgeSeries[seriesId].levels[level - 1];
    expect(row.publicLabel.code).toBe('achievement.earned');
    expect(row.effect).toEqual({
      kind: 'achievement',
      rule: { ruleId: rule, version: catalog.badgeSeries[seriesId].version },
      awardKey: row.source.awardKey,
      op: 'granted',
    });
    expect(rule).toBe(catalogued.ruleId);
    expect(row.correlationId).toBe(`award:${row.source.awardKey}`);
    expect(row.idempotencyKey).toBe(`award:${row.source.awardKey}#badge`);
    const earned = badgeProgress[seriesId].earned.find(
      (entry) => entry.level === level,
    );
    expect(earned, `${seriesId} ${level}`).toBeDefined();
    expect(row.at <= earned.earnedAt).toBe(true);
    const paid = points.filter(
      (other) => other.correlationId === row.correlationId,
    );
    expect(paid.map((other) => other.effect.delta)).toEqual(
      catalogued.awards
        .filter((award) => award.kind === 'points')
        .map((award) => award.points),
    );
    for (const other of paid) expect(other.at).toBe(row.at);
  }

  // A visit is ONE event: every seat of theirs in it shares its id.
  for (const visit of workedVisitsOf(uid, book.appointments).filter(
    ({ day }) => day <= today,
  )) {
    const earned = points.filter(
      (row) => row.correlationId === `appt:${visit.appointmentId}`,
    );
    expect(
      earned.map((row) => row.publicLabel.params.spendMinor).sort(),
    ).toEqual(
      visit.seats
        .map((seat) => seat.priceMinor)
        .filter((price) => price >= 100)
        .sort(),
    );
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

  // The tier its visits in a year reach.
  const tiers = Object.entries(catalog.tierDefinitions).sort(
    ([, a], [, b]) => a.rank - b.rank,
  );
  const reached = tiers.filter(
    ([, tier]) => acc.tier.qualifying >= tier.qualify.atLeast,
  );
  expect(acc.tier.current).toBe(reached.at(-1)[0]);
  expect(acc.tier.next).toBe(tiers[reached.length]?.[0] ?? null);
  expect(acc.tier.qualifying).toBe(
    workedVisitsOf(uid, book.appointments).filter(
      (visit) =>
        visit.day <= today && dayNumber(today) - dayNumber(visit.day) < 365,
    ).length,
  );

  // The tier's rows are a chain from the tier the account opened on to the
  // one it holds, each step to another tier, the last dated as the account says.
  const tierRows = rowsOf(clientJournal, 'tier');
  tierRows.forEach((row, i) => {
    expect(row.effect.op).toBe('changed');
    expect(row.effect.to).not.toBe(row.effect.from);
    expect(row.effect.from).toBe(
      i === 0 ? tiers[0][0] : tierRows[i - 1].effect.to,
    );
    expect(row.publicLabel).toEqual({
      code: 'tier.changed',
      params: { from: row.effect.from, to: row.effect.to },
    });
    expect(row.source).toEqual({ kind: 'system', job: 'tier' });
  });
  expect(tierRows.at(-1)?.effect.to ?? tiers[0][0]).toBe(acc.tier.current);
  if (tierRows.length > 0) expect(acc.tier.since).toBe(tierRows.at(-1).at);

  // The stamp card counts every visit, and mints a coupon at every tenth.
  expect(acc.punchCards).toEqual([
    {
      ruleId: PUNCH_CARD.ruleId,
      filled: stats.lifetime.visitsCompleted % PUNCH_CARD.size,
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
    rowsOf(clientJournal, 'reward').map((row) => [
      row.effect.ref,
      row.at,
      row.publicLabel.params.stamp,
    ]),
  ).toEqual(
    minted.map((granted) => [
      { kind: 'couponGrant', id: granted.grantId },
      granted.grantedAt,
      granted.stamp,
    ]),
  );

  // A reward bought: what it cost and what it bought, one event.
  for (const row of rowsOf(clientJournal, 'redemption')) {
    const { redemptionId, rewardId, cost, grant } = row.effect;
    expect(cost).toBe(catalog.rewardsCatalog[rewardId].cost);
    expect(grant).toEqual({
      kind: 'couponGrant',
      id: redemptionGrantIdOf(redemptionId),
    });
    expect(row.correlationId).toBe(redemptionId);
    const paid = entries.filter(
      (other) => other !== row && other.correlationId === redemptionId,
    );
    expect(paid.map((other) => other.effect)).toEqual([
      { kind: 'points', delta: -cost },
    ]);
    expect(paid[0].seq).toBe(row.seq - 1);
  }

  // A rhythm's run began on a day while one is in progress, and only
  // then: a visit of theirs, no later than the last that counted.
  const visitDays = workedVisitsOf(uid, book.appointments).map(
    (visit) => visit.day,
  );
  for (const [streakId, state] of Object.entries(acc.streaks)) {
    expect(Object.keys(state), streakId).toContain('runStartedOn');
    expect(state.runStartedOn === null, streakId).toBe(state.current === 0);
    if (state.runStartedOn === null) continue;
    expect(visitDays, streakId).toContain(state.runStartedOn);
    expect(
      state.runStartedOn <= sofiaDay(state.lastQualifiedAt),
      streakId,
    ).toBe(true);
  }
}

describe('the loyalty catalogue', () => {
  it('is the fixtures’ catalogue, verbatim, on the fixtures’ day', () => {
    expect(LOYALTY_CATALOG_TODAY).toBe(loyaltyFixtures.today);
    expect(loyaltyCatalogFor(LOYALTY_CATALOG_TODAY)).toEqual(
      loyaltyFixtures.catalog,
    );
  });

  it('writes to the wire’s collections, under the wire’s journal ids', () => {
    expect(LOYALTY_CATALOG_COLLECTIONS).toEqual([...WIRE_CATALOG_COLLECTIONS]);
    expect(LOYALTY_ACCOUNTS_COLLECTION).toBe(WIRE_LOYALTY_ACCOUNTS);
    expect(BADGE_PROGRESS_COLLECTION).toBe(WIRE_BADGE_PROGRESS);
    expect(SEASON_PROGRESS_COLLECTION).toBe(WIRE_SEASON_PROGRESS);
    expect(CLIENT_JOURNAL_COLLECTION).toBe(WIRE_CLIENT_JOURNAL);
    expect(STREAK_DEFINITIONS_COLLECTION).toBe(WIRE_STREAK_DEFINITIONS);
    expect(STREAK_DEFINITION_VERSIONS_COLLECTION).toBe(WIRE_STREAK_VERSIONS);
    for (const seq of [1, 42, 123456]) {
      expect(clientJournalEntryId('dev-client-1', seq)).toBe(
        wireJournalEntryId('dev-client-1', seq),
      );
      expect(streakDefinitionVersionId(seq)).toBe(wireVersionId(seq));
    }
  });

  it('writes every catalogue document at its collection and id, then the rhythm’s first version, and nothing else', () => {
    const catalog = loyaltyCatalogFor(LOYALTY_CATALOG_TODAY);
    const writes = loyaltyCatalogWritesOf(catalog);
    expect(writes.map(({ path }) => path)).toEqual([
      ...LOYALTY_CATALOG_COLLECTIONS.flatMap((collection) =>
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
      const phases = Object.values(catalog.seasons).map(
        (season) => `${season.kind}:${phaseOn(season.window, today)}`,
      );
      expect(phases.sort()).toEqual([
        'event:open',
        'season:ended',
        'season:open',
      ]);
      for (const [id, season] of Object.entries(catalog.seasons)) {
        const fixture = loyaltyFixtures.catalog.seasons[id];
        const length = (window) =>
          dayNumber(window.until) - dayNumber(window.from);
        expect(length(season.window), id).toBe(length(fixture.window));
        expect(
          dayNumber(season.window.from) -
            dayNumber(sofiaDay(season.announcedAt)),
          id,
        ).toBe(
          dayNumber(fixture.window.from) -
            dayNumber(sofiaDay(fixture.announcedAt)),
        );
      }
    },
  );
});

// ── The rhythm's rule: a head, its first version, and whose it is ─────────

describe('the rhythm’s rule, as the seed writes it (revision 3 §4.3)', () => {
  const head = () =>
    loyaltyCatalogFor(LOYALTY_CATALOG_TODAY).streakDefinitions.cadence;
  const scheduleOf = (document) => {
    const schedule = streakScheduleFromDocument('cadence', document);
    if (schedule.isFailure()) throw schedule.error;
    return schedule.value;
  };

  it('writes the head the domain’s own write half would: the rule round-trips through its factories', () => {
    const schedule = scheduleOf(head());
    expect(schedule.current.version).toBe(1);
    expect(schedule.scheduled).toBeNull();
    expect(
      streakScheduleToDocument(schedule, new Date(head().updatedAt)),
    ).toEqual(head());
  });

  it('writes the first version as the domain’s write half would, published by nobody, changing nothing', () => {
    const { current } = scheduleOf(head());
    expect(seedRuleVersionWriteOf('cadence', head())).toEqual({
      path: `${WIRE_STREAK_DEFINITIONS}/cadence/${WIRE_STREAK_VERSIONS}/${wireVersionId(1)}`,
      data: streakDefinitionVersionToDocument({
        definition: current,
        publishedAt: new Date(head().updatedAt),
        publishedBy: SEED_RULE_PUBLISHER,
        transition: 'grandfather',
        direction: 'neutral',
        changed: [],
        requestId: seedRuleRequestId('cadence', 1),
        withdrawnAt: null,
      }),
    });
    expect(seedRuleRequestId('cadence', 1)).toBe('seed-cadence-000001');
  });

  it('is the history the in-memory reference lists, so a spec and the emulator show one', async () => {
    const listed =
      await InMemoryStreakDefinitionRepository.seeded().listVersions(
        'cadence',
        10,
      );
    expect(listed.isSuccess()).toBe(true);
    expect(listed.value.map(streakDefinitionVersionToDocument)).toEqual([
      seedRuleVersionWriteOf('cadence', head()).data,
    ]);
  });

  it('reads back as the version it is, under the head’s name', () => {
    const { path, data } = seedRuleVersionWriteOf('cadence', head());
    const version = streakDefinitionVersionFromDocument(
      'cadence',
      path.split('/').at(-1),
      data,
      head().name,
    );
    expect(version.isSuccess()).toBe(true);
    expect(version.value.definition.equals(scheduleOf(head()).current)).toBe(
      true,
    );
    expect(version.value.definition.name.bg).toBe('Посещения в ритъм');
  });

  it('refuses to describe a head that holds a version in waiting: only a publish writes one', () => {
    const waiting = {
      ...head(),
      scheduled: {
        ...head().current,
        version: 2,
        effectiveFrom: '2026-10-05',
        transition: 'grandfather',
      },
    };
    // The head itself is a sound one…
    expect(scheduleOf(waiting).scheduled?.definition.version).toBe(2);
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
  const secondVersion = {
    ...seededHead.current,
    version: 2,
    effectiveFrom: '2026-10-05',
    interval: { kind: 'fixed', days: 35 },
  };
  /** The emulator, holding `documents` at their paths and nothing else. */
  const holding = (documents) => new Map(Object.entries(documents));
  /** The rule before revision 3: flat, its first day an instant. */
  const FLAT = {
    name: seededHead.name,
    version: 1,
    effectiveFrom: '2025-03-01T07:00:00.000Z',
    cadence: { kind: 'rollingDays', days: 42 },
    graceDays: 7,
    riskLeadDays: 7,
    freezes: { maxBanked: 2, earnEvery: 5, autoApply: true },
    repair: { windowDays: 14, perYear: 1 },
    excused: ['shopClosure', 'barberAbsence', 'staffCancelled'],
  };

  it.each([
    ['an empty emulator', {}],
    ['the flat rule of an emulator seeded before revision 3', { [HEAD]: FLAT }],
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
        [HEAD]: { name: seededHead.name, current: 'soon', scheduled: null },
      },
    ],
    [
      'a head numbered below the seed’s',
      {
        [HEAD]: {
          ...seededHead,
          current: { ...seededHead.current, version: 0 },
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
        [HEAD]: { ...seededHead, current: secondVersion },
        [FIRST]: seededFirst,
      },
    ],
    [
      'a second version that waits for its day',
      {
        [HEAD]: {
          ...seededHead,
          scheduled: { ...secondVersion, transition: 'grandfather' },
        },
        [FIRST]: seededFirst,
      },
    ],
    [
      'a first rule the shop published into an empty emulator',
      {
        [HEAD]: {
          ...seededHead,
          current: { ...seededHead.current, graceDays: 3 },
        },
        [FIRST]: {
          ...seededFirst,
          graceDays: 3,
          publishedBy: 'dev-staff-ivan',
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
    const held = catalogAsHeld(catalog, [], holding({ [HEAD]: FLAT }));
    expect(held.streakDefinitions.cadence).toBe(seededHead);
  });

  it('counts the flat rule of an older seed as a stale catalogue, and its missing history', () => {
    const stored = new Map([
      ...writes.map(({ path, data }) => [path, data]),
      [HEAD, FLAT],
    ]);
    stored.delete(FIRST);
    const drift = loyaltyCatalogDriftOf(writes, stored);
    expect(drift).toHaveLength(2);
    expect(drift[0].startsWith(`${HEAD}: `)).toBe(true);
    expect(drift[0]).toContain('cadence');
    expect(drift[0]).toContain('current');
    expect(drift[1]).toBe(`${FIRST}: missing`);
  });
});

describe.each([
  ['Георги', LOYALTY_HOLDERS[0], loyaltyFixtures.georgi],
  ['Мартин', LOYALTY_HOLDERS[1], loyaltyFixtures.martin],
])('%s’s projection on the fixtures’ day', (_name, holder, fixture) => {
  const { book, today, catalog, project } = seeded(NOW);
  const projection = project(holder);

  it('has the fixture’s shape, document by document', () => {
    expect(Object.keys(projection)).toEqual(Object.keys(fixture));
    expect(accountShapeOf(projection.account)).toEqual(
      accountShapeOf(fixture.account),
    );
    expect(shapesOf(Object.values(projection.badgeProgress))).toEqual(
      shapesOf(Object.values(fixture.badgeProgress)),
    );
    expect(shapesOf(Object.values(projection.seasonProgress))).toEqual(
      shapesOf(Object.values(fixture.seasonProgress)),
    );
    // The fixtures' journals hold point rows only (contract delta R2a-6):
    // the seed's point rows have their shape, and its other rows are held
    // to the feed's reader below, not to a fixture.
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
    const home = `loyaltyAccounts/${holder.uid}`;
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
    expect(acc.tier).toMatchObject({
      current: 'gold',
      next: 'platinum',
    });
    expect(acc.streaks.cadence).toMatchObject({
      current: 24,
      best: 24,
      phase: { kind: 'active' },
    });
    expect(badgeProgress['series-rhythm'].earned).toHaveLength(5);
    expect(acc.punchCards[0].filled).toBe(4);
    expect(acc.lifetimeSpent).toBe(250);
    expect(acc.records.map((record) => record.kind)).toEqual([
      'longestRhythm',
      'mostVisitsInYear',
      'favouriteService',
      'firstVisit',
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
    expect(acc.tier).toMatchObject({ current: 'silver', next: 'gold' });
    expect(acc.streaks.cadence).toMatchObject({
      current: 13,
      phase: { kind: 'atRisk' },
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

// ── Read back, as the client card reads (§7.5 «Seed») ─────────────────────

/**
 * Every document the seed writes for the client card, read back through the
 * readers the SEED holds — `loadSeedDomain()`'s bundle of the production
 * mappers, the one `seed-dev-catalog.mjs` reads with before it writes — in
 * the card's order: the catalogue as one model, each account document by
 * where it is written, Мартин's waitlist request.
 */
describe('read back by the client card’s readers', () => {
  let domain;
  /** The fixtures' day, read back once the readers are in. */
  let onFixturesDay;

  /** The catalogue and each holder's documents on the book of `nowMs`, as the readers read them. */
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

  const idOf = (entry) =>
    typeof entry.id === 'string' ? entry.id : entry.id.value;
  const sorted = (values) => [...values].sort();

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
      ['streakDefinitions', catalog.streakSchedules],
    ]) {
      expect(sorted(entries.map(idOf)), collection).toEqual(
        sorted(Object.keys(catalogDocuments[collection])),
      );
    }
  });

  it('reads the rhythm as a rule in force, and its first version beside the head that names it', () => {
    const { today, catalogue } = onFixturesDay;
    const rule = catalogue.catalog.streakInForce('cadence', today);
    expect(rule).toMatchObject({ id: 'cadence', version: 1, enabled: true });
    expect(catalogue.ruleVersions).toHaveLength(1);
    const [version] = catalogue.ruleVersions;
    expect(version.definition.equals(rule)).toBe(true);
    expect(version).toMatchObject({
      publishedBy: SEED_RULE_PUBLISHER,
      requestId: 'seed-cadence-000001',
      transition: 'grandfather',
      direction: 'neutral',
      changed: [],
      withdrawnAt: null,
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
      // The domain's own phases, the notice rule behind them: one season
      // and one event running, one season behind, nothing announced.
      const kinds = (phase) =>
        catalogue.catalog
          .seasonsIn(phase, today)
          .map((season) => season.kind)
          .sort();
      expect(kinds('open')).toEqual(['event', 'season']);
      expect(kinds('ended')).toEqual(['season']);
      expect(kinds('announced')).toEqual([]);
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
      expect(read.badgeProgress.map((progress) => progress.seriesId)).toEqual(
        Object.keys(projection.badgeProgress),
      );
      expect(read.seasonProgress.map((track) => track.seasonId)).toEqual(
        Object.keys(projection.seasonProgress),
      );
      // The feed reads every row; the ledger the rows that move points.
      expect(read.activity.map((entry) => entry.id)).toEqual(
        Object.keys(projection.clientJournal),
      );
      expect(read.ledger.map((entry) => entry.id)).toEqual(
        Object.entries(projection.clientJournal)
          .filter(([, row]) => row.effect.kind === 'points')
          .map(([id]) => id),
      );
    });

    it('reads what the fold wrote: a balance its rows sum to, the rows in order', () => {
      const { uid, projection, read } = holder();
      const [acc] = read.accounts;
      expect(acc.userId).toBe(uid);
      expect(acc.balance).toBe(projection.account.balance);
      expect(acc.balance).toBe(
        read.ledger.reduce((sum, entry) => sum + entry.delta, 0),
      );
      expect(read.activity.map((entry) => entry.seq)).toEqual(
        read.activity.map((_, i) => i + 1),
      );
      expect(acc.seq).toBe(read.activity.length);
      read.activity.forEach((entry, i) => {
        expect(entry.id).toBe(clientJournalEntryId(uid, entry.seq));
        if (i > 0) expect(entry.at >= read.activity[i - 1].at).toBe(true);
      });
      expect(acc.updatedAt >= read.activity.at(-1).at).toBe(true);
      // A point row of the feed carries the balance it left: the newest is the account's.
      const moved = read.activity.filter(
        (entry) => entry.effect.kind === 'points',
      );
      expect(moved.map((entry) => entry.effect.delta)).toEqual(
        read.ledger.map((entry) => entry.delta),
      );
      expect(moved.at(-1).effect.balanceAfter).toBe(acc.balance);
    });

    it('reads the rhythm the domain projected: its terms, its twelve periods, the visit that holds it', () => {
      const { projection, read } = holder();
      const state = read.accounts[0].streaks['cadence'];
      expect(streakStateToDocument(state)).toEqual(
        projection.account.streaks.cadence,
      );
      expect(state.period).toEqual({
        intervalDays: 42,
        graceDays: 7,
        source: 'fixed',
        habitDays: null,
      });
      expect(state.periods).toHaveLength(12);
      expect(state.periods.at(-1).on).toBe(sofiaDay(state.lastQualifiedAt));
    });

    it('reads the day the run began: the holder’s first visit, further back than the track reaches', () => {
      const { uid, projection, read } = holder();
      const written = projection.account.streaks.cadence;
      const state = read.accounts[0].streaks['cadence'];
      expect(written.runStartedOn).toBe(
        index === 0 ? '2025-03-01' : '2025-05-06',
      );
      expect(state.runStartedOn).toBe(written.runStartedOn);
      // Neither holder ever lost the count: the run is as old as the account.
      const [first] = workedVisitsOf(uid, seeded(NOW).book.appointments);
      expect(state.runStartedOn).toBe(first.day);
      expect(state.runStartedOn).toBe(
        projection.account.records.find(
          (record) => record.kind === 'firstVisit',
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
        const family = catalog.series(progress.seriesId);
        expect(family, progress.seriesId).not.toBeNull();
        for (const { level } of progress.earned) {
          expect(
            family.levelAt(level),
            `${progress.seriesId} ${level}`,
          ).not.toBeNull();
        }
      }
      for (const { seasonId } of read.seasonProgress) {
        expect(
          catalog.season(seasonId)?.trackSeriesId ?? null,
          seasonId,
        ).not.toBeNull();
      }
      expect(catalog.tier(acc.tier.current)).not.toBeNull();
      expect(
        acc.tier.next === null || catalog.tier(acc.tier.next) !== null,
      ).toBe(true);
      for (const [streakId, state] of Object.entries(acc.streaks)) {
        const rule = catalog.streakInForce(streakId, onFixturesDay.today);
        expect(rule, streakId).not.toBeNull();
        expect(state.definitionVersion).toBe(rule.version);
      }
      for (const { id, label } of read.activity) {
        const { reward, seriesId } = label.params;
        if (reward !== undefined) {
          expect(catalog.rewards.map(idOf), id).toContain(reward);
        }
        if (seriesId !== undefined) {
          expect(catalog.series(String(seriesId)), id).not.toBeNull();
        }
      }
    });
  });

  describe('Мартин’s waitlist request', () => {
    const readRequest = ({ path, data }) =>
      domain.waitlistFromDocument(path.split('/').at(-1), data);

    it('is written to the wire’s collection, under its own id', () => {
      expect(WAITLIST_REQUESTS_COLLECTION).toBe(WAITLIST_COLLECTION);
      const { path, data } = waitlistRequestWriteOf(buildClientBook(NOW));
      expect(path).toBe(`${WAITLIST_COLLECTION}/${SEEDED_WAITLIST_REQUEST.id}`);
      expect(data.id).toBe(SEEDED_WAITLIST_REQUEST.id);
    });

    it('reads as a request, and writes back as the very document', () => {
      const write = waitlistRequestWriteOf(buildClientBook(NOW));
      const request = readRequest(write);
      expect(request).not.toBeNull();
      expect(domain.waitlistToDocument(request)).toEqual(write.data);
    });

    it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
      'on %s the card shows it: watching, not lapsed, Thursday and Friday next week, made after his every booking',
      (_label, nowMs) => {
        const book = buildClientBook(nowMs);
        const write = waitlistRequestWriteOf(book);
        const request = readRequest(write);
        const todayKey = book.calendar.dayKeyAt(0);
        const today = domain.CalendarDay.create(todayKey, book.calendar.zone);
        expect(request.isWatching()).toBe(true);
        expect(request.hasLapsedBy(today.value)).toBe(false);
        const [thursday, friday] = write.data.dayKeys;
        expect([thursday, friday].map(weekdayOf)).toEqual([4, 5]);
        const ahead = dayNumber(thursday) - dayNumber(todayKey);
        expect(ahead).toBeGreaterThanOrEqual(4);
        expect(ahead).toBeLessThanOrEqual(10);
        const booked = book.appointments
          .filter(
            ({ doc }) =>
              doc.subjectUserIds.includes(SEEDED_WAITLIST_REQUEST.ownerId) &&
              doc.bookedAt,
          )
          .map(({ doc }) => Date.parse(doc.bookedAt.iso));
        expect(booked.length).toBeGreaterThan(0);
        expect(Math.max(...booked)).toBeLessThan(
          Date.parse(write.data.createdAtIso),
        );
      },
    );

    it('refuses a book in which he booked after making it', () => {
      const book = buildClientBook(NOW);
      const mine = book.appointments.find(
        ({ doc }) =>
          doc.subjectUserIds.includes(SEEDED_WAITLIST_REQUEST.ownerId) &&
          doc.bookedAt,
      );
      const rebooked = {
        id: `${mine.id}-again`,
        doc: {
          ...mine.doc,
          bookedAt: { ...mine.doc.bookedAt, iso: book.calendar.isoAt(0, 8) },
        },
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
    it('names each document a reader refused, and each path no loyalty reader reads', () => {
      const [{ uid, projection }] = onFixturesDay.holders;
      const writes = loyaltyWritesOf(uid, projection);
      const [home] = writes;
      const levels = writes.find(
        ({ path, data }) =>
          path.includes(`/${BADGE_PROGRESS_COLLECTION}/`) &&
          data.earned.length > 1,
      );
      const row = writes.at(-1);
      const earned = writes.find(
        ({ data }) => data.effect?.kind === 'achievement',
      );
      const paid = writes.find(({ data }) => data.effect?.kind === 'points');
      const [, version] = loyaltyCatalogWritesOf(
        loyaltyCatalogFor(LOYALTY_CATALOG_TODAY),
      ).slice(-2);
      const read = readLoyaltyWrites(domain, [
        { path: home.path, data: { ...home.data, userId: 'dev-client-2' } },
        {
          path: levels.path,
          data: { ...levels.data, earned: [...levels.data.earned].reverse() },
        },
        { path: row.path, data: { ...row.data, visibility: 'staff' } },
        // A row the feed never shows: the rhythm's own are the card's to tell.
        {
          path: earned.path,
          data: { ...earned.data, effect: { kind: 'streak' } },
        },
        // The feed reads it, the ledger does not: a point row with no figure.
        {
          path: paid.path,
          data: { ...paid.data, effect: { kind: 'points' } },
        },
        { path: `${home.path}/visits/appt-1`, data: {} },
        { path: 'coupons/coupon-free-beard', data: {} },
        // A version handed over without the head that names its rule.
        version,
      ]);
      expect(read.accounts).toEqual([]);
      expect(read.badgeProgress).toEqual([]);
      expect(read.ledger).toEqual([]);
      expect(read.activity).toEqual([]);
      expect(read.ruleVersions).toEqual([]);
      // Each line: the path, then why — the field the reader refused.
      const expected = [
        [home.path, '.userId'],
        [levels.path, '.earned'],
        [row.path, '.visibility'],
        [earned.path, '.effect.kind'],
        [paid.path, '.effect.delta'],
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
      catalog.streakDefinitions.cadence.current.graceDays = 42;
      const graceless = readLoyaltyWrites(
        domain,
        loyaltyCatalogWritesOf(catalog),
      );
      expect(graceless.catalog).toBeNull();
      expect(graceless.ruleVersions).toEqual([]);
      expect(graceless.problems).toHaveLength(2);
      for (const problem of graceless.problems) {
        expect(problem).toContain('streakDefinitions/cadence');
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
      const [[seasonId, season]] = Object.entries(catalog.seasons);
      // Announced on its opening day: under the notice every season gives.
      season.announcedAt = new Date(
        Date.parse(`${season.window.from}T09:00:00+03:00`),
      ).toISOString();
      const read = readLoyaltyWrites(domain, loyaltyCatalogWritesOf(catalog));
      expect(read.catalog).toBeNull();
      expect(read.problems).toHaveLength(1);
      const [problem] = read.problems;
      expect(problem.startsWith('the catalogue: ')).toBe(true);
      expect(problem).toContain(`seasons/${seasonId}`);
      expect(problem).toContain('announced_late');
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
        'readLoyaltyWrites(domain, [...writes, ...kept])',
      ],
      ['giftVoucherWritesOf(calendar)', 'readPromotionWrites(domain, writes)'],
      ['loyaltyWritesOf(uid, projection)', 'readLoyaltyWrites(domain, writes)'],
    ]) {
      const from = at(written);
      expect(at(readBack, from), written).toBeLessThan(
        at('batch.commit()', from),
      );
    }
    // The fold is handed the bundle the documents are read back with.
    expect(at('projectLoyaltyFor(\n    domain,')).toBeLessThan(
      at('loyaltyWritesOf(uid, projection)'),
    );
    const waitlist = at('waitlistRequestWriteOf(clientBook)');
    expect(at('domain.waitlistFromDocument(', waitlist)).toBeLessThan(
      at('.set(data)', waitlist),
    );
  });
});

// ── The fold's rules, on small hand-built books ────────────────────────────

const UID = 'dev-client-test';
const CAL = createShopCalendar(NOW);
const TODAY = CAL.dayKeyAt(0);

/** A worked fade with Иван at 10:00, `dayOffset` days from the fixtures' today. */
function worked(id, dayOffset, overrides = {}) {
  return appointmentDocumentOf(
    {
      id,
      dayOffset,
      locationId: 'loc-center',
      status: { kind: 'completed' },
      placement: 'staff',
      bookedAt: { dayOffset: dayOffset - 3, hour: 12, minute: 0 },
      arrivedAt: { hour: 9, minute: 55 },
      contact: null,
      seats: [
        {
          id: `${id}-s1`,
          barberId: 'ivan',
          serviceId: 'svc-fade',
          hour: 10,
          minute: 0,
          subject: account(UID),
          pref: 'any',
          outcome: { kind: 'worked' },
        },
      ],
      ...overrides,
    },
    CAL,
  );
}

/** A visit the shop called off the evening before (Иван off sick). */
function calledOffByShop(id, dayOffset) {
  return appointmentDocumentOf(
    {
      id,
      dayOffset,
      locationId: 'loc-center',
      status: { kind: 'cancelled', reason: 'staff_barber_absence' },
      placement: 'staff',
      bookedAt: { dayOffset: dayOffset - 5, hour: 12, minute: 0 },
      arrivedAt: null,
      contact: null,
      seats: [
        {
          id: `${id}-s1`,
          barberId: 'ivan',
          serviceId: 'svc-fade',
          hour: 10,
          minute: 0,
          subject: account(UID),
          pref: 'any',
          outcome: {
            kind: 'cancelled',
            by: 'staff',
            reason: { kind: 'staff_barber_absence' },
            hoursBefore: 16,
          },
        },
      ],
    },
    CAL,
  );
}

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
  project(appointments, {}, today, catalog).account.streaks.cadence;
/** Five days after the last of `offsets`: the run as it stood then. */
const soonAfter = (offsets) => CAL.dayKeyAt(Math.max(...offsets) + 5);

describe('projectLoyaltyFor — the rhythm', () => {
  it('stays in rhythm inside the cadence and its grace, at risk a week before it is due', () => {
    // Due on day +2 of a 42-day cadence: inside the 7-day risk lead.
    expect(rhythm(visitsAt([-80, -40]))).toMatchObject({
      current: 2,
      best: 2,
      phase: { kind: 'atRisk', dueBy: CAL.dayKeyAt(2) },
      dueBy: CAL.dayKeyAt(2),
    });
    expect(rhythm(visitsAt([-80, -30])).phase).toEqual({ kind: 'active' });
    // Past due, inside the grace: still the same run.
    expect(rhythm(visitsAt([-80, -45])).phase).toEqual({
      kind: 'inGrace',
      graceUntil: CAL.dayKeyAt(4),
    });
    // A visit 49 days on (42 + 7 grace) keeps the run.
    expect(rhythm(visitsAt([-60, -11])).current).toBe(2);
  });

  it('breaks the run a day past the grace, and earns «Завръщане» on the next run’s second visit', () => {
    const offsets = [-300, -270, -240, -150, -120, -90, -60, -30];
    const projection = project(visitsAt(offsets));
    const state = projection.account.streaks.cadence;
    expect(state).toMatchObject({ current: 5, best: 5 });
    const comeback = projection.badgeProgress['series-comeback'];
    expect(comeback.earned).toHaveLength(1);
    expect(sofiaDay(comeback.earned[0].earnedAt)).toBe(CAL.dayKeyAt(-120));
    // Long gone since: broken on the day after the grace, repairable for 14 days.
    expect(rhythm(visitsAt([-300, -270, -240]))).toMatchObject({
      current: 0,
      best: 3,
      dueBy: null,
      phase: {
        kind: 'broken',
        brokenAt: CAL.dayKeyAt(-240 + 50),
        repairableUntil: CAL.dayKeyAt(-240 + 64),
      },
    });
  });

  it('restores the run for the first visit inside the repair window, once a year', () => {
    // Broken on day −190; back five days later.
    const offsets = [-300, -270, -240, -185];
    const repaired = project(visitsAt(offsets), {}, soonAfter(offsets));
    expect(repaired.account.streaks.cadence.current).toBe(4);
    expect(repaired.badgeProgress['series-comeback']).toBeUndefined();
    // Broken again on day −135 and back in five days: not a second time in a year.
    const later = [...offsets, -130, -100];
    const again = project(visitsAt(later), {}, soonAfter(later));
    expect(again.account.streaks.cadence.current).toBe(2);
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
      expect(projection.account.streaks.cadence).toHaveProperty(
        'runStartedOn',
        began,
      );
      const read = readLoyaltyWrites(DOMAIN, loyaltyWritesOf(UID, projection));
      expect(read.problems).toEqual([]);
      expect(read.accounts[0].streaks['cadence'].runStartedOn).toBe(began);
    }
  });
});

// ── The journal, as «Движение» folds it (revision 3 §2.2.5, §4.7) ─────────

/** The feed's order of precedence: an event is titled by the first of these it holds. */
const LEADING = ['redemption', 'reward', 'tier', 'achievement', 'points'];

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
    kind: LEADING.find((kind) => rows.some((row) => row.effect.kind === kind)),
    amount: rows.reduce(
      (sum, row) => sum + (row.effect.kind === 'points' ? row.effect.delta : 0),
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
        Object.values(projection.clientJournal).map((row) => row.effect.kind),
      );
      expect([...kinds].sort(), holder.uid).toEqual(
        [...ACTIVITY_EFFECT_KINDS.all].sort(),
      );
    }
  });

  it('reads every row as the feed’s reader reads it, and every point row as the ledger’s', () => {
    for (const { holder, projection } of projections) {
      for (const [id, row] of Object.entries(projection.clientJournal)) {
        const entry = activityEntryFromDocument(id, row);
        expect(entry.isSuccess(), `${holder.uid} ${id}`).toBe(true);
        expect(entry.value).toMatchObject({
          id,
          seq: row.seq,
          correlationId: row.correlationId,
          effect: { kind: row.effect.kind },
          label: row.publicLabel,
          reverses: null,
        });
        expect(ledgerEntryFromDocument(id, row).isSuccess()).toBe(
          row.effect.kind === 'points',
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
      expect(count('points'), holder.uid).toBe(visits.length);
      expect(count('achievement'), holder.uid).toBe(rows('achievement'));
      expect(count('tier')).toBe(rows('tier'));
      expect(count('reward')).toBe(rows('reward'));
      expect(count('redemption')).toBe(holder.redemptions.length);
      for (const event of events) {
        // One event, one instant, and rows that follow each other: a page
        // of the feed can cut the LAST event it holds, never one inside.
        expect(new Set(event.rows.map((row) => row.at)).size <= 2).toBe(true);
        event.rows.forEach((row, i) => {
          if (i > 0) expect(row.seq).toBe(event.rows[i - 1].seq + 1);
        });
        // What leads it is there once; the rest of it is what it paid or cost.
        const others = event.rows.filter(
          (row) => row.effect.kind !== event.kind,
        );
        expect(event.rows.length - others.length >= 1).toBe(true);
        if (event.kind !== 'points') {
          expect(event.rows.length - others.length, event.id).toBe(1);
          for (const other of others) expect(other.effect.kind).toBe('points');
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
      expect(event.kind).toBe('points');
      expect(event.rows.map((row) => row.effect.delta).sort()).toEqual([
        10, 17,
      ]);
      expect(event.amount).toBe(27);
      // Each seat is still paid once, under its own key.
      expect(new Set(event.rows.map((row) => row.source.awardKey)).size).toBe(
        2,
      );
      for (const row of event.rows) {
        expect(row.source.awardKey).toMatch(
          /^rule-earn-per-euro:dev-client-1:appt:[^:]+:seat:[^:]+$/,
        );
      }
    }
  });

  it('Георги: Бронз to Сребро to Злато, a coupon at the tenth and the twentieth stamp, one reward bought', () => {
    const [{ projection }] = projections;
    const journal = projection.clientJournal;
    expect(
      rowsOf(journal, 'tier').map((row) => [row.effect.from, row.effect.to]),
    ).toEqual([
      ['bronze', 'silver'],
      ['silver', 'gold'],
    ]);
    expect(
      rowsOf(journal, 'reward').map((row) => [
        row.publicLabel.params.stamp,
        row.effect.ref.id,
        row.publicLabel.params.reward,
        row.publicLabel.params.coupon,
      ]),
    ).toEqual([
      [10, 'grant-dev-georgi-punch-10', 'reward-cut', PUNCH_CARD.couponId],
      [20, 'grant-dev-georgi-punch', 'reward-cut', PUNCH_CARD.couponId],
    ]);
    const [bought] = rowsOf(journal, 'redemption');
    expect(bought.effect).toEqual({
      kind: 'redemption',
      op: 'redeemed',
      redemptionId: 'rdm-dev-georgi-cut',
      rewardId: 'reward-cut',
      cost: 250,
      grant: { kind: 'couponGrant', id: 'grant-rdm-dev-georgi-cut' },
    });
    expect(bought.actor).toEqual({
      kind: 'admin',
      adminUserId: 'dev-staff-ivan',
    });
    expect(
      eventsOf(journal).find(({ id }) => id === 'rdm-dev-georgi-cut'),
    ).toMatchObject({ kind: 'redemption', amount: -250 });
  });

  it('Мартин: Бронз to Сребро, a coupon at the tenth stamp, a beard bought at the desk', () => {
    const [, { projection }] = projections;
    const journal = projection.clientJournal;
    expect(
      rowsOf(journal, 'tier').map((row) => [row.effect.from, row.effect.to]),
    ).toEqual([['bronze', 'silver']]);
    expect(rowsOf(journal, 'reward').map((row) => row.effect.ref.id)).toEqual([
      'grant-dev-martin-punch-10',
    ]);
    expect(rowsOf(journal, 'redemption')).toHaveLength(1);
    expect(
      eventsOf(journal).find(({ id }) => id === 'rdm-dev-martin-beard'),
    ).toMatchObject({ kind: 'redemption', amount: -120 });
  });

  it('a level is its own event: the row that names it, then what it paid', () => {
    const [{ projection }] = projections;
    const events = eventsOf(projection.clientJournal).filter(
      (event) => event.kind === 'achievement',
    );
    const paying = events.filter((event) => event.amount > 0);
    const free = events.filter((event) => event.amount === 0);
    // Both are in the book: «+20 т.», and a level that pays a protection or nothing.
    expect(paying.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
    for (const event of events) {
      const [level, ...paid] = event.rows;
      expect(level.effect.kind).toBe('achievement');
      const { seriesId, level: rank } = level.publicLabel.params;
      expect(catalog.badgeSeries[seriesId].levels[rank - 1]).toBeDefined();
      expect(event.amount).toBe(
        paid.reduce((sum, row) => sum + row.effect.delta, 0),
      );
    }
  });

  it('names no tier for the one an account opens on, and a drop on the night the window lets a visit go', () => {
    // Six visits (Сребро), long ago: the sixth makes it, the first leaving takes it.
    const offsets = [-460, -450, -440, -430, -420, -410];
    const journal = project(visitsAt(offsets)).clientJournal;
    const changes = rowsOf(journal, 'tier');
    expect(changes.map((row) => [row.effect.from, row.effect.to])).toEqual([
      ['bronze', 'silver'],
      ['silver', 'bronze'],
    ]);
    const [up, down] = changes;
    expect(sofiaDay(up.at)).toBe(CAL.dayKeyAt(-410));
    expect(down.at).toBe(new Date(CAL.msAt(-460 + 365, 0, 0)).toISOString());
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
    const schedule = streakScheduleFromDocument(
      'cadence',
      catalog.streakDefinitions.cadence,
    );
    const rule = schedule.value.inForceOn(today);
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
            .filter((award) => award.kind === 'freeze')
            .map((award) => ({
              day: sofiaDay(earned.earnedAt),
              count: award.count,
            })),
      );
      const trace = traceStreak(
        rule,
        {
          visits: visits.map((visit) => ({
            day: visit.day,
            counted: true,
            at: new Date(visit.startMs),
          })),
          excused: [],
          bookings: [],
          pauses: [],
          grants,
        },
        today,
      );
      const state = projection.account.streaks.cadence;
      // Nothing but the visit ahead is the book's to add here: neither
      // holder needed an excuse or a hold to stay in rhythm.
      expect({ ...state, heldBy: null }).toEqual(
        streakStateToDocument(trace.state),
      );
      expect(state.runStartedOn).toBe(trace.runStartedOn);
      expect(state.runStartedOn).toBe(visits[0].day);
      expect(projection.account.records[0]).toEqual({
        kind: 'longestRhythm',
        value: trace.record.value,
        on: trace.record.on,
        year: null,
        serviceId: null,
      });
    }
  });

  it('names the visit on the book that holds the period: Мартин’s chair today, nobody’s for Георги this evening', () => {
    const { project } = seedsOwn;
    expect(project(georgi).account.streaks.cadence.heldBy).toBeNull();
    expect(project(martin).account.streaks.cadence.heldBy).toEqual({
      appointmentId: 'appt-dev-2',
      on: today,
    });
    // In the morning Георги's own cut is still ahead of him.
    const morning = seeded(Date.parse('2026-09-28T07:30:00+03:00'));
    expect(morning.project(georgi).account.streaks.cadence.heldBy).toEqual({
      appointmentId: 'appt-dev-1',
      on: today,
    });
  });

  it('moves both cards when the shop publishes another interval', () => {
    const { project } = under(
      published({ interval: { kind: 'fixed', days: 28 } }),
    );
    const was = seedsOwn.project(martin);
    const is = project(martin);
    // Георги comes every three to four weeks: only his due date moves.
    expect(project(georgi).account.streaks.cadence).toMatchObject({
      definitionVersion: 2,
      current: 24,
      best: 24,
      phase: { kind: 'active' },
      dueBy: '2026-10-26',
      period: { intervalDays: 28, graceDays: 7, source: 'fixed' },
    });
    expect(seedsOwn.project(georgi).account.streaks.cadence.dueBy).toBe(
      '2026-11-09',
    );
    // Мартин comes every five to six: under four weeks he has missed some.
    const state = is.account.streaks.cadence;
    expect(was.account.streaks.cadence).toMatchObject({
      definitionVersion: 1,
      current: 13,
      best: 13,
    });
    expect(state).toMatchObject({
      definitionVersion: 2,
      period: { intervalDays: 28 },
      // Past its grace, and held by the chair he sits in today.
      phase: { kind: 'inGrace', graceUntil: today },
      heldBy: { appointmentId: 'appt-dev-2', on: today },
    });
    expect(state.current).toBeLessThan(13);
    expect(state.best).toBeLessThan(13);
    // The run he is on began with the visit after his last miss; Георги's
    // with his first, as before.
    expect(was.account.streaks.cadence.runStartedOn).toBe('2025-05-06');
    expect(state.runStartedOn).toBe('2026-03-21');
    expect(
      state.periods.map(({ mark, on }) => `${mark} ${on}`).slice(5, 7),
    ).toEqual(['missed 2026-03-07', 'kept 2026-03-21']);
    expect(project(georgi).account.streaks.cadence.runStartedOn).toBe(
      seedsOwn.project(georgi).account.streaks.cadence.runStartedOn,
    );
    const marks = state.periods.map((period) => period.mark);
    expect(marks).toContain('missed');
    expect(marks).toContain('repaired');
    expect(
      state.periods
        .filter((period) => period.mark === 'protected')
        .map((period) => period.reason),
    ).toEqual(['freeze', 'barberAbsence']);
    // What counts the rhythm follows it: the family, the record, «Завръщане».
    expect(is.badgeProgress['series-rhythm'].value).toBe(state.best);
    expect(is.badgeProgress['series-rhythm'].earned.length).toBeLessThan(
      was.badgeProgress['series-rhythm'].earned.length,
    );
    expect(is.account.records[0]).toMatchObject({
      kind: 'longestRhythm',
      value: state.best,
    });
    expect(was.badgeProgress['series-comeback']).toBeUndefined();
    expect(is.badgeProgress['series-comeback'].earned).toHaveLength(1);
    // And nothing else moved: the visits are the visits.
    expect(is.badgeProgress['series-visits']).toEqual(
      was.badgeProgress['series-visits'],
    );
    expect(is.account.tier).toEqual(was.account.tier);
  });

  it('keeps every invariant under a published rule, whatever it is', () => {
    for (const patch of [
      { interval: { kind: 'fixed', days: 28 } },
      { interval: { kind: 'fixed', days: 84 }, graceDays: 0 },
      {
        interval: {
          kind: 'personal',
          tolerancePct: 25,
          minDays: 21,
          maxDays: 70,
          fallbackDays: 42,
        },
      },
      { excuses: [], bookingHold: { enabled: false, maxDaysPastDue: 14 } },
      {
        onBreak: 'hold',
        repair: { enabled: false, windowDays: 14, perYear: 1 },
      },
      {
        protections: {
          enabled: false,
          maxBanked: 2,
          earnEvery: 5,
          startWith: 0,
        },
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
        expect(read.accounts[0].streaks['cadence'].definitionVersion).toBe(2);
      }
    }
  });

  it('knows the person’s own habit under a personal interval', () => {
    const { project } = under(
      published({
        interval: {
          kind: 'personal',
          tolerancePct: 25,
          minDays: 21,
          maxDays: 70,
          fallbackDays: 42,
        },
      }),
    );
    for (const holder of LOYALTY_HOLDERS) {
      const { period } = project(holder).account.streaks.cadence;
      expect(period.source).toBe('personal');
      expect(period.habitDays).toBeGreaterThan(20);
      expect(period.intervalDays).toBeGreaterThanOrEqual(
        Math.floor(period.habitDays),
      );
    }
    // Георги's habit is the shorter: he comes more often.
    expect(
      project(georgi).account.streaks.cadence.period.habitDays,
    ).toBeLessThan(project(martin).account.streaks.cadence.period.habitDays);
  });

  it('projects under the version that waits from its own day on, and not a day sooner', () => {
    const waitingFrom = (day) => (head) => ({
      ...head,
      scheduled: {
        ...head.current,
        version: 2,
        effectiveFrom: day,
        interval: { kind: 'fixed', days: 28 },
        transition: 'grandfather',
      },
    });
    const tomorrow = CAL.dayKeyAt(1);
    expect(
      under(waitingFrom(tomorrow)).project(martin).account.streaks.cadence,
    ).toEqual(seedsOwn.project(martin).account.streaks.cadence);
    expect(
      under(waitingFrom(today)).project(martin).account.streaks.cadence,
    ).toEqual(
      under(published({ interval: { kind: 'fixed', days: 28 } })).project(
        martin,
      ).account.streaks.cadence,
    );
  });

  it('holds no rhythm under a rule that is off: no state, no family, no record, and everything else as it was', () => {
    const { book, catalog, project } = under(published({ enabled: false }));
    for (const holder of LOYALTY_HOLDERS) {
      const was = seedsOwn.project(holder);
      const is = project(holder);
      expect(is.account.streaks).toEqual({});
      expect(is.badgeProgress['series-rhythm']).toBeUndefined();
      expect(is.badgeProgress['series-comeback']).toBeUndefined();
      expect(is.account.records.map((record) => record.kind)).toEqual([
        'mostVisitsInYear',
        'favouriteService',
        'firstVisit',
      ]);
      expect(is.account.tier).toEqual(was.account.tier);
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
      published({ qualifier: { kind: 'services', serviceIds: ['svc-beard'] } }),
    );
    expect(project(martin).account.streaks).toEqual({});
    const state = project(georgi).account.streaks.cadence;
    expect(state.best).toBeLessThan(24);
    expect(state.best).toBeGreaterThan(0);
    // A category holds every seeded service: it counts as «всяко посещение» does.
    const byCategory = under(
      published({
        qualifier: { kind: 'categories', categoryIds: ['cat-hair'] },
      }),
    );
    for (const holder of LOYALTY_HOLDERS) {
      expect(byCategory.project(holder).account.streaks.cadence).toEqual({
        ...seedsOwn.project(holder).account.streaks.cadence,
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
      published({ excuses: ['shopClosure', 'closedDays'] }),
    )(then);
    expect(rhythm(book, then).current).toBe(2);
    expect(rhythm(book, then, without).current).toBe(1);
  });

  it('stops on a rule the wire’s reader refuses, naming it', () => {
    const broken = catalogUnder((head) => ({
      ...head,
      current: { ...head.current, graceDays: 42 },
    }))(today);
    expect(() =>
      projectLoyaltyFor(DOMAIN, UID, visitsAt([-10]), broken, today),
    ).toThrow(/the cadence rhythm does not read/);
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
        grantedAt: new Date(visits[9].doneMs).toISOString(),
        usedAt: new Date(visits[10].doneMs).toISOString(),
      },
      {
        stamp: 20,
        appointmentId: visits[19].appointmentId,
        grantId: 'grant-dev-georgi-punch',
        couponId: PUNCH_CARD.couponId,
        grantedAt: new Date(visits[19].doneMs).toISOString(),
        usedAt: null,
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
    expect(tenth.usedAt).not.toBeNull();
    // Ten visits and none since: the tenth's coupon waits.
    const ten = visitsAt(Array.from({ length: 10 }, (_, i) => -300 + i * 30));
    expect(punchCardGrantsOf(UID, ten, TODAY)).toEqual([
      expect.objectContaining({
        stamp: 10,
        grantId: `grant-${UID}-punch-10`,
        usedAt: null,
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
        granted.map(({ grantId, couponId, grantedAt }) => [
          grantId,
          couponId,
          grantedAt,
        ]),
      ).toEqual(
        rowsOf(projection.clientJournal, 'redemption').map((row) => [
          row.effect.grant.id,
          catalog.rewardsCatalog[row.effect.rewardId].grants.couponId,
          row.at,
        ]),
      );
      for (const { grantedAt, usedAt } of granted) {
        expect(usedAt > grantedAt).toBe(true);
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
    expect(projection.account.tier).toMatchObject({
      current: 'bronze',
      qualifying: 0,
      next: 'silver',
      remaining: 6,
    });
    const demoted = CAL.dayKeyAt(-460 + 365);
    expect(projection.account.tier.since).toBe(
      new Date(CAL.msAt(-460 + 365, 0, 0)).toISOString(),
    );
    expect(sofiaDay(projection.account.tier.since)).toBe(demoted);
  });

  it('counts the visits of the last 365 days', () => {
    const projection = project(visitsAt([-400, -300, -200, -100, -10]));
    expect(projection.account.tier.qualifying).toBe(4);
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
    expect(complete.badgeProgress['series-profile'].earned[0].earnedAt).toBe(
      new Date(Date.parse(appointments[0].doc.bookedAt.iso)).toISOString(),
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
    const projection = project(appointments, {
      redemptions: [
        {
          id: 'rdm-test',
          rewardId: 'reward-beard',
          afterVisit: 8,
          actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
        },
      ],
    });
    const [cost, bought] = Object.values(projection.clientJournal).slice(-2);
    expect(cost).toMatchObject({
      effect: { kind: 'points', delta: -120 },
      source: { kind: 'redemption', redemptionId: 'rdm-test' },
      correlationId: 'rdm-test',
      idempotencyKey: 'rdm:rdm-test#0',
      publicLabel: {
        code: 'points.redeemed',
        params: { reward: 'reward-beard', points: 120 },
      },
    });
    // What it bought, in the same event: the feed folds the two into one row.
    expect(bought).toMatchObject({
      at: cost.at,
      effect: {
        kind: 'redemption',
        op: 'redeemed',
        redemptionId: 'rdm-test',
        rewardId: 'reward-beard',
        cost: 120,
        grant: { kind: 'couponGrant', id: 'grant-rdm-test' },
      },
      source: { kind: 'redemption', redemptionId: 'rdm-test' },
      actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
      correlationId: 'rdm-test',
      idempotencyKey: 'rdm:rdm-test#1',
      publicLabel: {
        code: 'redemption.changed',
        params: { op: 'redeemed', reward: 'reward-beard' },
      },
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
    expect(() =>
      project(visitsAt([-100]), {
        redemptions: [
          {
            id: 'rdm-test',
            rewardId: 'reward-product',
            afterVisit: 1,
            actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
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
            actor: { kind: 'admin', adminUserId: 'dev-staff-ivan' },
          },
        ],
      }),
    ).toThrow(/no worked visit 2/);
  });

  it('refuses a visit it cannot price', () => {
    const [visit] = visitsAt([-100]);
    const discounted = {
      ...visit,
      doc: { ...visit.doc, discounts: [{ kind: 'coupon' }] },
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
      stats.lifetime.visitsCompleted,
    );
    expect(stats.lifetime.visitsCompleted).toBeGreaterThan(0);
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
    delete before.badgeSeries['series-comeback'].retiredAt;
    before.badgeSeries['series-comeback'].legacy = true;
    const stored = storedAfterSeedOf(before);
    stored.delete('seasons/season-2026-autumn');

    expect(loyaltyCatalogDriftOf(writes, stored)).toEqual([
      'badgeSeries/series-comeback: legacy true (catalog.json: absent), retiredAt absent (catalog.json: null), title',
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
