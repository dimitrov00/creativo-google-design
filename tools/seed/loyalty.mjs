/**
 * The loyalty ENGINE'S OUTPUT for the dev seed (client-card-redesign.md
 * §4.6): the published catalogue, and for each account holder the account,
 * the family progress, the season progress and the journal — DERIVED from
 * the same appointments the seed writes, by one pure fold, so «Посещения»
 * cannot disagree with `clientStats` and the balance is the sum of its rows
 * by construction rather than by a comment.
 *
 * ### The documents are the flat archetypes (flip 3)
 * Every body is the `@core/entities` archetype minus its `id`, built by
 * `fixtures/loyalty.fixtures.ts` (each builder `satisfies` its entity,
 * `pnpm nx typecheck seed-tools`): this module decides WHAT the engine
 * would hold and WHEN; the builders spell the document. D29: an account,
 * its progress and its journal are keyed by the client RECORD
 * (`customerIdOf(uid)`); who acted on a row stays the account's `UserId`.
 *
 * ### The catalogue IS the fixture file
 * `catalog.json` under `@core/testing` is §4.6's catalogue: the specs read
 * it, the e2e seeds it, and this module writes it — one file, so the
 * documents cannot drift between the three. Only the season windows move,
 * by whole days from the fixtures' day to the shop's today (as the day
 * fixtures move), so every run shows one open season, one open event and
 * one ended season.
 *
 * ### What the fold counts
 * The client's own seats, read as `computeClientStats` reads them: an
 * appointment with a worked seat of theirs is a visit (a companion's
 * included), dated by their own first worked seat. A seat pays a point per
 * whole euro of its sold price as it is marked worked; a family moves when a
 * fact it counts happens, and a level is earned — and pays — at that instant.
 * The rhythm, the tier and the anniversaries move on the engine's daily job
 * too, at 00:00 in Sofia. What no appointment says (the profile, the reward
 * redemptions) comes in as `facts`.
 *
 * ### The rhythm is the DOMAIN's (client-card-revision-3.md §4.1, §4.2)
 * The rule «Посещения в ритъм» is a managed one: a head document whose
 * `rules` hold the rule in force (`CURRENT`) and the one that waits
 * (`SCHEDULED`), and an immutable document per version. The seed writes the
 * FIRST version and never again writes over a rule the shop has published
 * since (`rulesPublishedOver`). Each holder's visits, called-off visits,
 * bookings and earned protections are handed as facts to the domain's
 * `StreakSystem.trace`, under the rule `StreakRuleSystem.inForceOn` reads
 * off the head for the shop's today. Publish another interval, run the seed
 * again, and both cards move.
 *
 * ### The journal holds every kind the feed shows (§4.7, §4.10)
 * Point rows, and beside them a row for each level earned (`ACHIEVEMENT`),
 * each change of tier (`TIER`), each coupon the stamp card minted
 * (`REWARD`) and each reward bought with points (`REDEMPTION`). Rows of
 * ONE event share a `correlationId`, which is how «Движение» folds them
 * into one row: a visit's seats, a level and its bonus, a redemption and
 * its points (`CORRELATION`, below).
 *
 * Plain values in, flat documents out. Nothing here touches Firebase, and
 * nothing here imports a system: the fold and the read-back are HANDED the
 * domain (`loadSeedDomain()`'s bundle in the seed, the ordinary imports in
 * a spec) — `StreakSystem`, `StreakRuleSystem`, `StreakRule`,
 * `LoyaltyCatalogSystem`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOP_ZONE, createShopCalendar } from './calendar.mjs';
import { CATEGORY, HAIRCUTS, SERVICES } from './catalog.mjs';
import { customerIdOf } from './fixtures/customers.fixtures.ts';
import {
  DESK_ADMIN,
  DESK_STAFF,
  ENGINE_ACTOR,
  SEED_RULE_PUBLISHER,
  achievementEffect,
  badgeCategoryBody,
  badgeProgressBody,
  badgeSeriesBody,
  favouriteServiceRecord,
  firstVisitRecord,
  journalEntryBody,
  journalRowIdOf,
  longestRhythmRecord,
  loyaltyAccountBody,
  mostVisitsInYearRecord,
  pointsEffect,
  qualifierCounts,
  redemptionEffect,
  redemptionSource,
  rewardCatalogItemBody,
  rewardEffect,
  ruleSource,
  ruleVersionIdOf,
  seasonBody,
  seasonProgressBody,
  seedRuleRequestIdOf,
  seedRuleVersionBody,
  streakDefinitionBody,
  tierDefinitionBody,
  tierEffect,
  tierJobSource,
} from './fixtures/loyalty.fixtures.ts';
import { WORKSPACE_ROOT } from './load-domain.mjs';

export { SEED_RULE_PUBLISHER };

// ── The collections (`Collections`/`Subcollections` of `@core/entities`; the spec holds them equal) ──

/**
 * The six catalogue collections, in the order the seed writes them, each
 * beside the part of `LoyaltyCatalogParts` it is read into: the catalogue
 * the client card validates is these collections, whole, under the system's
 * keys (flip-3 plan F3-10).
 */
export const LOYALTY_CATALOG_PARTS = Object.freeze([
  Object.freeze(['badgeCategories', 'categories']),
  Object.freeze(['badgeSeries', 'series']),
  Object.freeze(['seasons', 'seasons']),
  Object.freeze(['tierDefinitions', 'tiers']),
  Object.freeze(['rewardsCatalog', 'rewards']),
  Object.freeze(['streakDefinitions', 'streaks']),
]);
export const STREAK_DEFINITIONS_COLLECTION = 'streakDefinitions';
/** A rule's history, under its head: `streakDefinitions/{id}/versions/{version:06}`. */
export const STREAK_DEFINITION_VERSIONS_COLLECTION = 'versions';
export const LOYALTY_ACCOUNTS_COLLECTION = 'loyaltyAccounts';
export const BADGE_PROGRESS_COLLECTION = 'badgeProgress';
export const SEASON_PROGRESS_COLLECTION = 'seasonProgress';
export const CLIENT_JOURNAL_COLLECTION = 'clientJournal';

/** The builder of each catalogue collection's bodies (`fixtures/loyalty.fixtures.ts`). */
const CATALOG_BODY = Object.freeze({
  badgeCategories: badgeCategoryBody,
  badgeSeries: badgeSeriesBody,
  tierDefinitions: tierDefinitionBody,
  rewardsCatalog: rewardCatalogItemBody,
  streakDefinitions: streakDefinitionBody,
});

/** `HeadRole` tags, as a head's `rules` store them. */
const CURRENT = 'CURRENT';
const SCHEDULED = 'SCHEDULED';

// ── The engine's own rules (not catalogue data) ────────────────────────────

/** A worked seat pays a point per whole euro of its sold price. */
const EARN_RULE = Object.freeze({ ruleId: 'rule-earn-per-euro', version: 1 });

/**
 * The stamp card: every worked visit is a stamp, every tenth mints the
 * coupon. Titled by what that coupon is — the rewards catalogue names it.
 */
export const PUNCH_CARD = Object.freeze({
  ruleId: 'rule-every-10th-visit',
  version: 1,
  size: 10,
  couponId: 'coupon-punch-free-cut',
});

/** The streak the «В ритъм» family counts and a `FREEZE` award banks into. */
const RHYTHM_STREAK_ID = 'cadence';

/** `AwardKind` tags, as a level's `awards` store them. */
const POINTS_AWARD = 'POINTS';
const FREEZE_AWARD = 'FREEZE';
/** `RewardGrant` tag of a reward that mints a coupon. */
const COUPON_GRANT = 'COUPON';
/** `JournalSource` tag of a row a redemption wrote. */
const REDEMPTION_SOURCE = 'REDEMPTION';

/**
 * What ties the rows of one event together (client-card-revision-3.md
 * §2.2.5, §4.7): «Движение» folds the rows that share a `correlationId`
 * into ONE row, sums their points and titles it by its leading effect. So
 * an event is what a person would call one thing that happened:
 *
 * - `appt:{appointmentId}` — a VISIT: every seat of theirs in it («Фейд ·
 *   Оформяне на брада», +27 т. for the two seats together). The award key
 *   and the idempotency key stay the seat's own: a seat is paid once; the
 *   row's root `appointmentId` names the visit;
 * - `award:{awardKey}` — a LEVEL, or a coupon a rule minted: the
 *   `ACHIEVEMENT` row and the points it paid («Посещения II», +20 т.); the
 *   stamp card's `REWARD` row. A level earned BY a visit is its own event,
 *   or the visit's row would be titled by the medal and lose its services;
 * - `tier:{uid}:{to}:{day}` — a change of tier («Статус: Злато»);
 * - the redemption's id — a reward bought: the points it cost and the
 *   `REDEMPTION` row that names the coupon it granted.
 */
const CORRELATION = Object.freeze({
  visit: (appointmentId) => `appt:${appointmentId}`,
  award: (awardKey) => `award:${awardKey}`,
  tier: (uid, to, day) => `tier:${uid}:${to}:${day}`,
});

/**
 * The seed's two account holders (§4.6: nobody else has an account) and
 * what no appointment says about them: the rewards they bought, each at the
 * counter two minutes after the chair freed on their `afterVisit`-th worked
 * visit, by the desk (`DESK_ADMIN`, `DESK_STAFF`: the seeded staff account
 * `dev-staff-ivan`). Георги's 250-point cut falls in March 2026, Мартин's
 * beard in February; both are refused if the balance could not have paid
 * for them.
 *
 * `stampGrants` names the coupons their stamp card minted
 * (`stampGrantIdOf`): Георги still HOLDS his newest, under the id the card
 * has always shown (`grant-dev-georgi-punch`, client-card-redesign.md
 * §4.6); Мартин has used his.
 */
export const LOYALTY_HOLDERS = Object.freeze([
  Object.freeze({
    uid: 'dev-client-1',
    stampGrants: Object.freeze({
      id: 'grant-dev-georgi-punch',
      holdsNewest: true,
    }),
    redemptions: Object.freeze([
      Object.freeze({
        id: 'rdm-dev-georgi-cut',
        rewardId: 'reward-cut',
        afterVisit: 17,
        actor: DESK_ADMIN,
      }),
    ]),
  }),
  Object.freeze({
    uid: 'dev-client-2',
    stampGrants: Object.freeze({
      id: 'grant-dev-martin-punch',
      holdsNewest: false,
    }),
    redemptions: Object.freeze([
      Object.freeze({
        id: 'rdm-dev-martin-beard',
        rewardId: 'reward-beard',
        afterVisit: 8,
        actor: DESK_STAFF,
      }),
    ]),
  }),
]);

// ── Days ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** «Ранобудник»: a visit starting at 10:00 or before. */
const EARLY_BIRD_LAST_MINUTE = 10 * 60;
/** «Преди отпуска»: two visits this close. */
const BEFORE_LEAVE_DAYS = 21;

const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const addDays = (day, days) =>
  new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

const SOFIA_WALL = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The shop's day and minute of day at an instant. */
function sofiaWallOf(ms) {
  const part = Object.fromEntries(
    SOFIA_WALL.formatToParts(new Date(ms)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  return {
    day: `${part.year}-${part.month}-${part.day}`,
    minute: Number(part.hour) * 60 + Number(part.minute),
  };
}

const jobInstants = new Map();
/** 00:00 in Sofia on `day`, when the engine's daily job runs. */
function jobInstantOn(day) {
  let ms = jobInstants.get(day);
  if (ms === undefined) {
    // Noon UTC is the same Sofia day, whatever the season.
    ms = createShopCalendar(Date.parse(`${day}T12:00:00Z`)).msAt(0, 0, 0);
    jobInstants.set(day, ms);
  }
  return ms;
}

// ── The catalogue ──────────────────────────────────────────────────────────

const CATALOG_FILE = join(
  WORKSPACE_ROOT,
  'libs/ecs-core/src/testing/fixtures/loyalty/catalog.json',
);

/** The Europe/Sofia day `catalog.json`'s season windows are dated for — the fixtures' `FIXTURE_TODAY`. */
export const LOYALTY_CATALOG_TODAY = '2026-09-28';

/**
 * The published catalogue as of the shop's `today`: `catalog.json`
 * (`{ [collection]: { [id]: body } }`), every body rebuilt by its builder,
 * every season's window and announcement moved by the whole days between
 * the fixtures' day and `today`. A fresh copy per call.
 */
export function loyaltyCatalogFor(today) {
  const stored = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
  const shift = daysBetween(LOYALTY_CATALOG_TODAY, today);
  const bodyOf = (collection, body) =>
    collection === 'seasons'
      ? seasonBody(body, shift)
      : CATALOG_BODY[collection](body);
  return Object.fromEntries(
    LOYALTY_CATALOG_PARTS.map(([collection]) => [
      collection,
      Object.fromEntries(
        Object.entries(stored[collection]).map(([id, body]) => [
          id,
          bodyOf(collection, body),
        ]),
      ),
    ]),
  );
}

/**
 * Every catalogue document as `{ path, data }`, collection by collection,
 * and after them each rhythm rule's FIRST version (`seedRuleVersionWriteOf`):
 * the head says which rule is in force, the version documents are its
 * history, and the admin's «История» would open empty without the one the
 * shop started under.
 */
export function loyaltyCatalogWritesOf(catalog) {
  return [
    ...LOYALTY_CATALOG_PARTS.flatMap(([collection]) =>
      Object.entries(catalog[collection]).map(([id, data]) => ({
        path: `${collection}/${id}`,
        data,
      })),
    ),
    ...Object.entries(catalog[STREAK_DEFINITIONS_COLLECTION]).map(
      ([streakId, head]) => seedRuleVersionWriteOf(streakId, head),
    ),
  ];
}

const ruleHeadPath = (streakId) =>
  `${STREAK_DEFINITIONS_COLLECTION}/${streakId}`;
const ruleVersionPath = (streakId, version) =>
  `${ruleHeadPath(streakId)}/${STREAK_DEFINITION_VERSIONS_COLLECTION}/${ruleVersionIdOf(version)}`;

const isMap = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A head's element in one role, or `undefined`; nothing for a head that holds no `rules` list. */
const ruleInRole = (head, role) =>
  isMap(head) && Array.isArray(head.rules)
    ? head.rules.find((rule) => isMap(rule) && rule.headRole === role)
    : undefined;

/**
 * The version document behind a head the SEED wrote: the rule in force as
 * its body (the rule alone — a version holds no `headRole`), published by
 * nobody (`SEED_RULE_PUBLISHER`) at the instant the head says it was
 * written, changing nothing (there was no rule before it), under an intent
 * of the seed's own so a second run writes the same document
 * (`seedRuleVersionBody`).
 *
 * A head that holds a rule in waiting is not the seed's to describe: only
 * the shop schedules one.
 */
export function seedRuleVersionWriteOf(streakId, head) {
  if (ruleInRole(head, SCHEDULED) !== undefined) {
    throw new Error(
      `seed: the ${streakId} rhythm holds a scheduled version, which only a publish writes`,
    );
  }
  const current = ruleInRole(head, CURRENT);
  if (current === undefined) {
    throw new Error(`seed: the ${streakId} rhythm holds no rule in force`);
  }
  return {
    path: ruleVersionPath(streakId, current.version),
    data: seedRuleVersionBody(streakId, current, head.updatedAtUtcMs),
  };
}

/** The newest version a stored head names — the one that waits, else the one in force — or `null`. */
function newestVersionOf(held) {
  const current = ruleInRole(held, CURRENT);
  if (current === undefined) return null;
  const { version } = ruleInRole(held, SCHEDULED) ?? current;
  return Number.isInteger(version) ? version : null;
}

/**
 * The rhythm rules the SHOP has published over the seed's: the streak ids
 * whose head in the emulator is no longer the seed's to write. `writes` are
 * `loyaltyCatalogWritesOf`'s; `stored` maps each written path to the
 * document the emulator holds there, `undefined` for none.
 *
 * The first version is seeded; every later one is published for real, by
 * the admin, through the callable (client-card-revision-3.md §4.10). So a
 * head is the shop's when its newest version (the one that waits, else the
 * one in force) is above the seed's, or when the version the seed would
 * write is there under somebody else's intent (a shop that published its
 * first rule into an empty emulator). The seed leaves such a rule, head
 * and history, exactly as it is, and projects every account under it.
 *
 * Still the seed's to write: no document, the head an emulator seeded
 * before flip 3 holds (no `rules` list), a head that holds nothing a
 * reader could take for a version, and the seed's own head.
 */
export function rulesPublishedOver(writes, stored) {
  const published = [];
  for (const { path, data } of writes) {
    const [collection, streakId, ...rest] = path.split('/');
    if (collection !== STREAK_DEFINITIONS_COLLECTION || rest.length > 0) {
      continue;
    }
    const newest = newestVersionOf(stored.get(path));
    const seeded = ruleInRole(data, CURRENT).version;
    if (newest === null || newest < seeded) continue;
    const first = stored.get(ruleVersionPath(streakId, seeded));
    const othersIntent =
      isMap(first) && first.requestId !== seedRuleRequestIdOf(streakId, seeded);
    if (newest > seeded || othersIntent) published.push(streakId);
  }
  return published;
}

/** The streak a catalogue path belongs to (its head, or a version under it), or `null`. */
function streakIdOfPath(path) {
  const [collection, streakId] = path.split('/');
  return collection === STREAK_DEFINITIONS_COLLECTION ? streakId : null;
}

/**
 * `writes` less the head and the history of every rule in `published`
 * (`rulesPublishedOver`): what the seed may write of the catalogue.
 */
export function withoutPublishedRules(writes, published) {
  return writes.filter(({ path }) => !published.includes(streakIdOfPath(path)));
}

/**
 * The catalogue the emulator holds once the seed has run: `catalog`, with
 * each rule in `published` as the emulator has it (`stored`, by path) in
 * place of the seed's. What every account is projected under, so a rule
 * the admin published is the rule Георги's and Мартин's cards are read by.
 */
export function catalogAsHeld(catalog, published, stored) {
  return {
    ...catalog,
    [STREAK_DEFINITIONS_COLLECTION]: Object.fromEntries(
      Object.entries(catalog[STREAK_DEFINITIONS_COLLECTION]).map(
        ([streakId, head]) => [
          streakId,
          published.includes(streakId)
            ? stored.get(ruleHeadPath(streakId))
            : head,
        ],
      ),
    ),
  };
}

/**
 * A season's fields `loyaltyCatalogFor` moves to the shop's today: a
 * catalogue seeded on another day holds other values here, and only here.
 */
const MOVED_SEASON_FIELDS = Object.freeze([
  'windowFrom',
  'windowUntil',
  'announcedAtUtcMs',
  'announcedLocalDate',
]);

/** Plain JSON values alike, a map's keys in any order. */
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => sameValue(a[key], b[key]));
}

const isPlain = (value) => value === null || typeof value !== 'object';
const shown = (value) =>
  value === undefined ? 'absent' : JSON.stringify(value);

/**
 * Where the emulator's loyalty catalogue is not the one these `writes` hold
 * (`loyaltyCatalogWritesOf`): `stored` maps each written path to the
 * document the emulator holds there, `undefined` for none. One line per
 * document that is missing or holds a field differently, a plain field with
 * both values, the emulator's first —
 * `badgeSeries/series-comeback: emblem "streak" (catalog.json: "comeback")`.
 *
 * A seed that ran before `catalog.json` last changed leaves such a
 * catalogue, and a render over it is not evidence of the code: wave D r3
 * shot the families' old faces from a seed that ran minutes before their
 * emblems changed (Critique 3). So `seed-dev-catalog.mjs --check` reads the
 * emulator through this, and a capture refuses to start on any line. A
 * season's window and announcement are the seed day's and never count; nor
 * does a document only the emulator holds, which a re-seed would not
 * remove either (it deletes nothing).
 *
 * Nor does a rhythm rule the shop has published (`rulesPublishedOver`):
 * its head and its first version are not `catalog.json`'s any more, by
 * somebody's decision and not by a seed gone stale, and a re-seed would
 * not write them. The head of an emulator seeded before flip 3 does count,
 * field by field, and so does its missing first version.
 */
export function loyaltyCatalogDriftOf(writes, stored) {
  const drift = [];
  const published = rulesPublishedOver(writes, stored);
  for (const { path, data } of writes) {
    if (published.includes(streakIdOfPath(path))) continue;
    const held = stored.get(path);
    if (held === undefined) {
      drift.push(`${path}: missing`);
      continue;
    }
    const moved = path.startsWith('seasons/') ? MOVED_SEASON_FIELDS : [];
    const fields = [...new Set([...Object.keys(data), ...Object.keys(held)])]
      .filter((field) => !moved.includes(field))
      .filter((field) => !sameValue(held[field], data[field]))
      .sort();
    if (fields.length === 0) continue;
    const said = fields.map((field) =>
      isPlain(held[field]) && isPlain(data[field])
        ? `${field} ${shown(held[field])} (catalog.json: ${shown(data[field])})`
        : field,
    );
    drift.push(`${path}: ${said.join(', ')}`);
  }
  return drift;
}

// ── Reading the book ───────────────────────────────────────────────────────

/** `AttendanceState` / `SeatSubject` / `CancelledBy` / `Placement` tags, as the flat seat stores them. */
const WORKED = 'WORKED';
const CANCELLED = 'CANCELLED';
const ACCOUNT = 'ACCOUNT';
const BY_CLIENT = 'CLIENT';
const SELF_PLACED = 'SELF';

const isOwnSeat = (seat, uid) =>
  seat.seatSubject === ACCOUNT && seat.subjectUserId === uid;
const distinct = (values) => [...new Set(values)];

/**
 * The instant a seat of a stored visit starts: the visit's one instant plus
 * the seat's wall-clock distance from the visit's start
 * (`TimeCoordinate.seatStartUtcMs`, T9 — exact: no visit straddles a DST
 * switch, the shop is closed then).
 */
const seatStartMs = (doc, seat) =>
  doc.utcEpochMs + (seat.startMinutes - doc.startMinutes) * MINUTE_MS;

/**
 * Every visit `uid` was worked on, oldest first: an appointment with a
 * worked seat of theirs, read off its documents exactly as `clientStats`
 * counts one (an appointment listed twice counts once). Dated by their own
 * first worked seat, done when their last worked seat was marked.
 *
 * Refuses an appointment carrying discounts or voucher redemptions: a seat
 * pays on its sold price, and the book this fold was written for sells
 * every seat at the catalogue's.
 */
export function workedVisitsOf(uid, appointments) {
  const seen = new Set();
  const visits = [];
  for (const { id, doc } of appointments) {
    if (seen.has(id)) continue;
    seen.add(id);
    const worked = doc.seats.filter(
      (seat) => isOwnSeat(seat, uid) && seat.attendanceState === WORKED,
    );
    if (worked.length === 0) continue;
    if (doc.discounts.length > 0 || doc.voucherRedemptions.length > 0) {
      throw new Error(`seed: loyalty cannot price ${id}: it carries discounts`);
    }
    const startMs = Math.min(...worked.map((seat) => seatStartMs(doc, seat)));
    const last = worked.reduce((a, b) =>
      b.workedAtUtcMs > a.workedAtUtcMs ? b : a,
    );
    const wall = sofiaWallOf(startMs);
    const arrivedMs = doc.arrivedAtUtcMs;
    visits.push({
      appointmentId: id,
      locationId: doc.locationId,
      startMs,
      doneMs: last.workedAtUtcMs,
      lastSeatId: last.seatId,
      day: wall.day,
      startMinute: wall.minute,
      seats: worked.map((seat) => {
        if (seat.currency !== 'EUR') {
          throw new Error(`seed: ${id}/${seat.seatId} is not sold in EUR`);
        }
        return {
          seatId: seat.seatId,
          priceMinor: seat.priceCents,
          workedAtMs: seat.workedAtUtcMs,
        };
      }),
      serviceIds: distinct(worked.map((seat) => seat.serviceId)),
      barberIds: distinct(worked.map((seat) => seat.barberId)),
      onTime: arrivedMs !== null && arrivedMs <= startMs,
      withCompany: doc.seats.some((seat) => !isOwnSeat(seat, uid)),
    });
  }
  return visits.sort(
    (a, b) =>
      a.startMs - b.startMs || (a.appointmentId < b.appointmentId ? -1 : 1),
  );
}

/** Bookings `uid` placed themselves, when they placed them. */
function selfBookingsOf(uid, appointments) {
  return appointments
    .filter(
      ({ doc }) =>
        doc.ownerUserId === uid &&
        doc.placement === SELF_PLACED &&
        doc.bookedAtUtcMs !== null,
    )
    .map(({ id, doc }) => ({
      appointmentId: id,
      atMs: doc.bookedAtUtcMs,
    }));
}

/** When `uid` first put anything in the book, or `null`. */
function firstBookingMsOf(uid, appointments) {
  const booked = appointments
    .filter(({ doc }) => doc.ownerUserId === uid && doc.bookedAtUtcMs !== null)
    .map(({ doc }) => doc.bookedAtUtcMs);
  return booked.length === 0 ? null : Math.min(...booked);
}

/**
 * The streak excuse (`StreakExcuse`) a called-off seat carries, as
 * `clientCaused` reads its decisive cancellation: the shop's own reasons,
 * or the staff calling it off with none. `null` for the client's, and for
 * a converted no-show, which nobody is held to.
 */
function excuseOf(seat) {
  switch (seat.cancellationReason) {
    case 'STAFF_BARBER_ABSENCE':
      return 'BARBER_ABSENCE';
    case 'STAFF_SHOP_CLOSURE':
      return 'SHOP_CLOSURE';
    case 'UNSPECIFIED':
    case 'OTHER':
      return seat.cancelledBy === BY_CLIENT ? null : 'STAFF_CANCELLED';
    default:
      return null;
  }
}

/**
 * Every visit of `uid` that was called off for a reason the shop owns, by
 * the day it was to be — whether or not the rule in force accepts that
 * reason: the rule decides (`StreakRule.isExcused`), the book only says
 * what happened.
 */
function calledOffVisitsOf(uid, appointments) {
  const seen = new Set();
  const calledOff = [];
  for (const { id, doc } of appointments) {
    if (seen.has(id)) continue;
    seen.add(id);
    const own = doc.seats.filter((seat) => isOwnSeat(seat, uid));
    if (own.length === 0) continue;
    if (!own.every((seat) => seat.attendanceState === CANCELLED)) continue;
    const decisive = own.reduce((a, b) =>
      b.cancelledAtUtcMs > a.cancelledAtUtcMs ? b : a,
    );
    const reason = excuseOf(decisive);
    if (reason === null) continue;
    const startMs = Math.min(...own.map((seat) => seatStartMs(doc, seat)));
    calledOff.push({ atMs: startMs, day: sofiaWallOf(startMs).day, reason });
  }
  return calledOff;
}

/**
 * Every visit of `uid` the book holds or held, as the rhythm reads a
 * booking: the day it was placed and the day it is for. What the client
 * cancelled is left out (a hold they released is judged as if it never
 * existed); a visit nobody came to stays in, and the projector lets go of
 * it by itself once its day has passed.
 */
function bookingsOf(uid, appointments) {
  const seen = new Set();
  const bookings = [];
  for (const { id, doc } of appointments) {
    if (seen.has(id)) continue;
    seen.add(id);
    const own = doc.seats.filter((seat) => isOwnSeat(seat, uid));
    if (own.length === 0) continue;
    const released = own.every(
      (seat) =>
        seat.attendanceState === CANCELLED && seat.cancelledBy === BY_CLIENT,
    );
    if (released) continue;
    const startMs = Math.min(...own.map((seat) => seatStartMs(doc, seat)));
    const day = sofiaWallOf(startMs).day;
    bookings.push({
      appointmentId: id,
      // A visit nobody booked ahead was placed as it began.
      placedOn:
        doc.bookedAtUtcMs === null ? day : sofiaWallOf(doc.bookedAtUtcMs).day,
      day,
    });
  }
  return bookings;
}

// ── The rhythm: the domain's projector, handed the book as facts ───────────

/** A refusal's lines: each error struct by its `errorCode` and its context. */
const errorsText = (errors) =>
  errors
    .map(
      ({ errorCode, ...context }) => `${errorCode} ${JSON.stringify(context)}`,
    )
    .join('; ');

/**
 * What a stored head's rules lack, as the read-back and the fold judge it:
 * a `rules` list with a rule in force, and every rule one `StreakRule.parse`
 * accepts. `[]` for a sound head.
 */
function headProblemsOf(domain, head) {
  if (!isMap(head) || !Array.isArray(head.rules)) {
    return ['it holds no rules list'];
  }
  const problems =
    ruleInRole(head, CURRENT) === undefined
      ? ['it holds no rule in force']
      : [];
  for (const rule of head.rules) {
    const parsed = domain.StreakRule.parse(rule);
    if (!parsed.ok) problems.push(errorsText(parsed.error));
  }
  return problems;
}

/**
 * The rule in force on `today`, read off a head document by the domain:
 * the rule that waits takes over on its own day, with nothing to flip it
 * (`StreakRuleSystem.inForceOn`). A head whose rules `StreakRule.parse`
 * refuses stops the seed.
 */
function ruleInForce(domain, streakId, head, today) {
  const problems = headProblemsOf(domain, head);
  if (problems.length > 0) {
    throw new Error(
      `seed: the ${streakId} rhythm does not read: ${problems.join('; ')}`,
    );
  }
  return domain.StreakRuleSystem.inForceOn(head, today);
}

/**
 * One streak's facts, for `StreakSystem.trace` (client-card-revision-3.md
 * §4.2): the visits with the rule's qualifier already applied, each by the
 * instant it began (so `lastQualifiedAtUtcMs` stays the visit's start);
 * what the shop called off; what is on the book. `grants` fills as the fold
 * goes: a family's `FREEZE` award is a protection given on the day of the
 * visit that earned it. The seeded holders are paused by nobody.
 *
 * The projector is a BATCH (a booking is read ahead of its day), so the
 * fold asks it again after every visit (`on(day)`), as of that day: what
 * the count was, whether the visit was a comeback. A fact dated after the
 * day asked about is left out by the projector itself.
 */
function rhythmOf(domain, streakId, rule, { visits, calledOff, bookings }) {
  // Every seeded service sits in the one category, and none only rides
  // along with another (`seed-dev-catalog.mjs` writes both so).
  const categoryIds = [CATEGORY.id];
  const counts = (visit) =>
    qualifierCounts(
      rule,
      // A bundle's members count as its services, as for the families.
      distinct([...visit.serviceIds, ...servicesOf(visit.serviceIds)]),
      categoryIds,
    );
  const facts = {
    visits: visits.map((visit) => ({
      localDate: visit.day,
      counted: counts(visit),
      utcEpochMs: visit.startMs,
    })),
    excused: calledOff.map(({ day, reason }) => ({ localDate: day, reason })),
    bookings: bookings.map(({ appointmentId, placedOn, day }) => ({
      placedOn,
      localDate: day,
      appointmentId,
    })),
    pauses: [],
    grants: [],
  };
  const traceOn = (day, excused = facts.excused) =>
    domain.StreakSystem.trace(streakId, rule, { ...facts, excused }, day);
  return {
    rule,
    /** The longest run so far: what «В ритъм» counts. */
    best: 0,
    on: traceOn,
    /** Protections an award gives, banked after that day's visits. */
    grant(day, count) {
      facts.grants.push({ localDate: day, count });
    },
    /** Whether the visit the shop called off on `day` moved anything: the engine writes only then. */
    movedBy(calledOffVisit) {
      const without = facts.excused.filter(
        (excused) =>
          excused.localDate !== calledOffVisit.day ||
          excused.reason !== calledOffVisit.reason,
      );
      return !sameValue(
        traceOn(calledOffVisit.day).state,
        traceOn(calledOffVisit.day, without).state,
      );
    },
  };
}

// ── What a family counts ───────────────────────────────────────────────────

const HAIR_SERVICE_IDS = new Set(HAIRCUTS);
/** `CompositionKind` of a service that bundles others. */
const BUNDLE = 'BUNDLE';
/** A bundle's members count as its services: «Пълна грижа» is a cut and a beard. */
const servicesOf = (serviceIds) =>
  serviceIds.flatMap((serviceId) => {
    const service = SERVICES.find((entry) => entry.id === serviceId);
    return service?.body.compositionKind === BUNDLE
      ? service.body.bundleServiceIds
      : [serviceId];
  });
const hairAndBeard = (visit) => {
  const services = servicesOf(visit.serviceIds);
  return (
    services.includes('svc-beard') &&
    services.some((serviceId) => HAIR_SERVICE_IDS.has(serviceId))
  );
};

/** Inside a season's window (`windowFrom`…`windowUntil`, both days), or anywhere for a family no season holds. */
const inSeason = (season, day) =>
  season === null || (day >= season.windowFrom && day <= season.windowUntil);

/** The family's scope (`metricScope*Id`): a visit of that service, with that barber, at that shop. */
function inScope(visit, series) {
  if (
    series.metricScopeServiceId !== null &&
    !visit.serviceIds.includes(series.metricScopeServiceId)
  )
    return false;
  if (
    series.metricScopeBarberId !== null &&
    !visit.barberIds.includes(series.metricScopeBarberId)
  )
    return false;
  return (
    series.metricScopeLocationId === null ||
    visit.locationId === series.metricScopeLocationId
  );
}

/**
 * A family's metric as of `day`, over the facts folded so far — inside its
 * season's window when it has one, inside its own `metricWindowDays` when
 * it names them. The seed books no referrals and no waitlist catches, so
 * those count nothing: an honest zero, not a guess.
 */
function metricValue(series, season, folded, day) {
  const visits = folded.visits.filter(
    (visit) =>
      inSeason(season, visit.day) &&
      (series.metricWindowDays === null ||
        daysBetween(visit.day, day) < series.metricWindowDays) &&
      inScope(visit, series),
  );
  switch (series.metric) {
    case 'client.visits.completed':
      return visits.length;
    case 'client.bookings.selfService':
      return folded.bookings.filter((booking) => inSeason(season, booking.day))
        .length;
    case 'client.referrals.completed':
    case 'client.waitlist.booked':
      return 0;
    case 'client.services.distinct':
      return new Set(visits.flatMap((visit) => visit.serviceIds)).size;
    case 'client.barbers.distinct':
      return new Set(visits.flatMap((visit) => visit.barberIds)).size;
    case 'client.locations.distinct':
      return new Set(visits.map((visit) => visit.locationId)).size;
    case 'client.months.distinct':
      return new Set(visits.map((visit) => visit.day.slice(0, 7))).size;
    case 'client.visits.earlyBird':
      return visits.filter(
        (visit) => visit.startMinute <= EARLY_BIRD_LAST_MINUTE,
      ).length;
    case 'client.visits.weekend':
      return visits.filter((visit) => [0, 6].includes(weekdayOf(visit.day)))
        .length;
    case 'client.visits.onTime':
      return visits.filter((visit) => visit.onTime).length;
    case 'client.visits.party':
      return visits.filter((visit) => visit.withCompany).length;
    case 'client.tenure.days':
      return folded.visits.length === 0
        ? 0
        : daysBetween(folded.visits[0].day, day);
    default:
      throw new Error(`seed: the ${series.metric} metric is not projected`);
  }
}

/** A 29 February birthday falls on the 28th in a common year. */
function isBirthday(day, birthDate) {
  if (birthDate == null) return false;
  const year = Number(day.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthDay =
    birthDate.slice(5) === '02-29' && !leap ? '02-28' : birthDate.slice(5);
  return day.slice(5) === monthDay;
}

/**
 * The families no registry metric counts — the rule code behind each, keyed
 * by the catalogue's own ids. `count` families climb by target; `met` acts
 * are one-offs, earned by the fact that meets them. A family missing here
 * stops the fold rather than being skipped.
 */
const ACTS = {
  'series-rhythm': {
    count: (folded) => folded.rhythms.get(RHYTHM_STREAK_ID)?.best ?? 0,
  },
  'series-comeback': {
    met: (folded, fact) => fact.kind === 'visit' && fact.cameBack,
  },
  'series-welcome': {
    met: (folded, fact) => fact.kind === 'visit' && folded.visits.length === 1,
  },
  'series-birthday': {
    met: (folded, fact) =>
      fact.kind === 'visit' &&
      isBirthday(fact.visit.day, folded.profile?.birthDate),
  },
  'series-profile': {
    met: (folded, fact) => fact.kind === 'profile',
  },
  'series-2026-beard-week-full': {
    met: (folded, fact, season) =>
      fact.kind === 'visit' &&
      inSeason(season, fact.visit.day) &&
      hairAndBeard(fact.visit),
  },
  'series-2026-summer-before-leave': {
    met: (folded, fact, season) => {
      if (fact.kind !== 'visit' || !inSeason(season, fact.visit.day))
        return false;
      const before = folded.visits
        .slice(0, -1)
        .filter((visit) => inSeason(season, visit.day))
        .at(-1);
      return (
        before !== undefined &&
        daysBetween(before.day, fact.visit.day) <= BEFORE_LEAVE_DAYS
      );
    },
  },
};

// ── The fold ───────────────────────────────────────────────────────────────

/** Facts on one instant: bookings first, the day's job, then the chair, then the counter. */
const RANK = {
  booking: 0,
  profile: 0,
  calendar: 1,
  tierJob: 1,
  excuse: 2,
  seat: 3,
  visit: 4,
  redemption: 5,
};

/**
 * `uid`'s loyalty documents as the engine would hold them on the shop's
 * `today`, from every appointment in the book — the layout of the fixtures'
 * `account-*.json` (`LoyaltyClientJson` of `@core/testing`): `{ uid,
 * customerId, account, badgeProgress, seasonProgress, clientJournal }`,
 * each a flat body, progress keyed by family and season, the journal by
 * `journalRowIdOf(customerId, seq)` and holding every row the activity feed
 * shows: the points, the levels, the tiers, the stamp card's coupons and
 * the redemptions. `null` for somebody the engine never saw (no visit, no
 * booking).
 *
 * `domain` is the production code the fold is handed, never imports:
 * `StreakSystem`, `StreakRuleSystem` and `StreakRule` — `loadSeedDomain()`'s
 * bundle in the seed, the ordinary imports in a spec.
 *
 * `catalog` is `loyaltyCatalogFor(today)`'s, under the rhythm rules the
 * emulator holds where the shop has published its own (`catalogAsHeld`).
 * `facts` carries what no appointment says: `profile` (`{ email, birthDate,
 * hasAvatar }`, for «Пълен профил» — dated at the client's first booking,
 * since the seed keeps no profile history — and the birthday visit),
 * `redemptions` and `stampGrants` (see `LOYALTY_HOLDERS`). Only facts on
 * days up to `today` are folded.
 */
export function projectLoyaltyFor(
  domain,
  uid,
  appointments,
  catalog,
  today,
  facts = {},
) {
  const profile = facts.profile ?? null;
  const visits = workedVisitsOf(uid, appointments).filter(
    (visit) => visit.day <= today,
  );
  const bookings = selfBookingsOf(uid, appointments).map((booking) => ({
    ...booking,
    day: sofiaWallOf(booking.atMs).day,
  }));
  const firstBookingMs = firstBookingMsOf(uid, appointments);
  const families = Object.entries(catalog.badgeSeries);
  const tiers = tierLadderOf(catalog);
  const calledOff = calledOffVisitsOf(uid, appointments);
  const newestStamp = visits.length - (visits.length % PUNCH_CARD.size);
  /** The season a family belongs to, or `null` for a perennial one. */
  const seasonOf = (series) =>
    series.seasonId === null ? null : catalog.seasons[series.seasonId];

  // ── The facts, in time order ──
  const timeline = [];
  const add = (fact) => {
    const day = fact.day ?? sofiaWallOf(fact.atMs).day;
    if (day <= today) timeline.push({ ...fact, day });
  };
  for (const booking of bookings) {
    add({
      kind: 'booking',
      atMs: booking.atMs,
      day: booking.day,
      eventId: `booking:${booking.appointmentId}`,
    });
  }
  const profileComplete =
    profile !== null &&
    Boolean(profile.email) &&
    Boolean(profile.birthDate) &&
    profile.hasAvatar === true;
  const profileAtMs = firstBookingMs ?? visits[0]?.startMs ?? null;
  if (profileComplete && profileAtMs !== null) {
    add({ kind: 'profile', atMs: profileAtMs, eventId: `profile:${uid}` });
  }
  if (visits.length > 0) {
    const firstDay = visits[0].day;
    const anniversaries = new Set(
      families.flatMap(([, series]) =>
        series.metric === 'client.tenure.days'
          ? series.levels.map((level) => addDays(firstDay, level.target))
          : [],
      ),
    );
    for (const day of [...anniversaries].sort()) {
      add({
        kind: 'calendar',
        atMs: jobInstantOn(day),
        day,
        eventId: `cal:${day}:${uid}`,
      });
    }
  }
  for (const visit of visits) {
    const leaves = addDays(visit.day, tiers.lastDays);
    add({ kind: 'tierJob', atMs: jobInstantOn(leaves), day: leaves });
  }
  for (const visit of calledOff) {
    add({ kind: 'excuse', atMs: visit.atMs, day: visit.day, calledOff: visit });
  }
  for (const visit of visits) {
    for (const seat of visit.seats) {
      add({ kind: 'seat', atMs: seat.workedAtMs, visit, seat });
    }
    add({
      kind: 'visit',
      atMs: visit.doneMs,
      visit,
      eventId: seatEventId(visit.appointmentId, visit.lastSeatId),
    });
  }
  for (const redemption of facts.redemptions ?? []) {
    const visit = visits[redemption.afterVisit - 1];
    if (visit === undefined) {
      throw new Error(
        `seed: ${uid} has no worked visit ${redemption.afterVisit} to redeem ${redemption.id} after`,
      );
    }
    add({ kind: 'redemption', atMs: visit.doneMs + 2 * MINUTE_MS, redemption });
  }
  if (timeline.length === 0) return null;
  timeline.sort((a, b) => a.atMs - b.atMs || RANK[a.kind] - RANK[b.kind]);

  // ── The state the facts fold into ──
  const writes = new Set();
  const rows = [];
  let balance = 0;
  let earnedPoints = 0;
  let spentPoints = 0;
  /** Each family's levels as the fold earns them: `{ level, atUtcMs, count }`. */
  const progress = new Map();
  const progressOf = (seriesId) => {
    let entry = progress.get(seriesId);
    if (!entry) {
      entry = { earned: [] };
      progress.set(seriesId, entry);
    }
    return entry;
  };
  const onTheBook = bookingsOf(uid, appointments);
  const rhythms = new Map(
    Object.entries(catalog[STREAK_DEFINITIONS_COLLECTION]).map(
      ([streakId, head]) => [
        streakId,
        rhythmOf(domain, streakId, ruleInForce(domain, streakId, head, today), {
          visits,
          calledOff,
          bookings: onTheBook,
        }),
      ],
    ),
  );
  const folded = { visits: [], bookings: [], rhythms, profile };
  let tier = null;

  /** One row of the journal, as of the balance it leaves. */
  const append = (fact, entry) => {
    writes.add(fact.atMs);
    rows.push(
      journalEntryBody({
        uid,
        seq: rows.length + 1,
        atUtcMs: fact.atMs,
        correlationId: entry.correlationId,
        idempotencyKey: entry.idempotencyKey,
        labelCode: entry.labelCode,
        labelParams: entry.labelParams,
        balanceAfter: balance,
        appointmentId: entry.appointmentId ?? null,
        actor: entry.actor,
        source: entry.source,
        effect: entry.effect,
      }),
    );
  };

  /** A row that moves the balance: the only effect that does. */
  const pay = (fact, delta, entry) => {
    balance += delta;
    if (entry.source.journalSource === REDEMPTION_SOURCE) spentPoints -= delta;
    else earnedPoints += delta;
    append(fact, { ...entry, effect: pointsEffect(delta) });
  };

  const earn = (seriesId, series, level, fact) => {
    const entry = progressOf(seriesId);
    const repeat = series.repeatable
      ? entry.earned.find((earned) => earned.level === level.level)
      : undefined;
    if (repeat) {
      repeat.count += 1;
      repeat.atUtcMs = fact.atMs;
    } else {
      entry.earned.push({ level: level.level, atUtcMs: fact.atMs, count: 1 });
    }
    const occurrence = series.repeatable ? fact.day.slice(0, 4) : 'once';
    const awardKey = `${level.ruleId}:${uid}:${occurrence}`;
    const sourceOf = () =>
      ruleSource(level.ruleId, series.version, awardKey, fact.eventId);
    // The level itself, then what it pays: one event, the level's own.
    append(fact, {
      effect: achievementEffect(level.ruleId, series.version, awardKey),
      source: sourceOf(),
      actor: ENGINE_ACTOR,
      correlationId: CORRELATION.award(awardKey),
      idempotencyKey: `award:${awardKey}#badge`,
      labelCode: 'achievement.earned',
      labelParams: { rule: level.ruleId, seriesId, level: level.level },
    });
    let paid = 0;
    for (const award of level.awards) {
      if (award.awardKind === FREEZE_AWARD) {
        rhythms.get(RHYTHM_STREAK_ID)?.grant(fact.day, award.awardFreezeCount);
        continue;
      }
      if (award.awardKind !== POINTS_AWARD) {
        throw new Error(
          `seed: ${seriesId} ${level.level} pays a ${award.awardKind}, which is not projected`,
        );
      }
      pay(fact, award.awardPoints, {
        source: sourceOf(),
        actor: ENGINE_ACTOR,
        correlationId: CORRELATION.award(awardKey),
        idempotencyKey: `award:${awardKey}#${paid}`,
        labelCode: 'points.rule',
        labelParams: {
          rule: level.ruleId,
          points: award.awardPoints,
          seriesId,
          level: level.level,
        },
      });
      paid += 1;
    }
  };

  const evaluateFamilies = (fact) => {
    for (const [seriesId, series] of families) {
      if (
        series.retiredAtUtcMs !== null &&
        series.retiredAtUtcMs <= fact.atMs
      ) {
        continue;
      }
      const season = seasonOf(series);
      const act = ACTS[seriesId];
      if (series.metric === null && act === undefined) {
        throw new Error(`seed: no rule projects the ${seriesId} family`);
      }
      if (act?.met) {
        if (!act.met(folded, fact, season)) continue;
        const entry = progress.get(seriesId);
        const [level] = series.levels;
        const earnedThisYear = entry?.earned.some(
          (earned) =>
            sofiaWallOf(earned.atUtcMs).day.slice(0, 4) ===
            fact.day.slice(0, 4),
        );
        if (entry && (!series.repeatable || earnedThisYear)) continue;
        earn(seriesId, series, level, fact);
        continue;
      }
      const value = act
        ? act.count(folded)
        : metricValue(series, season, folded, fact.day);
      const entry = progress.get(seriesId);
      for (const level of series.levels.slice(entry?.earned.length ?? 0)) {
        if (level.target === null || value < level.target) break;
        earn(seriesId, series, level, fact);
      }
    }
  };

  /** The stamp card: every `PUNCH_CARD.size`-th worked visit mints its coupon. */
  const stampReward = punchRewardOf(catalog);
  const mintStamp = (fact) => {
    const stamp = folded.visits.length;
    if (stamp % PUNCH_CARD.size !== 0) return;
    const awardKey = `${PUNCH_CARD.ruleId}:${uid}:client.visits.completed:${stamp}`;
    append(fact, {
      effect: rewardEffect(
        stampGrantIdOf(uid, stamp, {
          naming: facts.stampGrants ?? null,
          newest: newestStamp,
        }),
      ),
      source: ruleSource(
        PUNCH_CARD.ruleId,
        PUNCH_CARD.version,
        awardKey,
        fact.eventId,
      ),
      actor: ENGINE_ACTOR,
      correlationId: CORRELATION.award(awardKey),
      idempotencyKey: `award:${awardKey}#0`,
      labelCode: 'reward.granted',
      labelParams: {
        rule: PUNCH_CARD.ruleId,
        reward: stampReward.id,
        coupon: PUNCH_CARD.couponId,
        stamp,
      },
    });
  };

  const evaluateTier = (fact) => {
    const qualifying = qualifyingOn(folded.visits, fact.day, tiers.lastDays);
    const reached = tiers.reachedBy(qualifying);
    if (tier !== null && tier.id === reached.id) return;
    const from = tier?.id ?? null;
    tier = { id: reached.id, sinceMs: fact.atMs };
    writes.add(fact.atMs);
    // The tier an account opens on is no change: nothing was left behind.
    if (from === null) return;
    append(fact, {
      effect: tierEffect(from, reached.id),
      source: tierJobSource(),
      actor: ENGINE_ACTOR,
      correlationId: CORRELATION.tier(uid, reached.id, fact.day),
      idempotencyKey: `tier:${uid}:${reached.id}:${fact.day}`,
      labelCode: 'tier.changed',
      labelParams: { from, to: reached.id },
    });
  };

  for (const fact of timeline) {
    switch (fact.kind) {
      case 'booking':
        folded.bookings.push(fact);
        evaluateFamilies(fact);
        break;
      case 'profile':
      case 'calendar':
        evaluateFamilies(fact);
        break;
      case 'tierJob':
        evaluateTier(fact);
        break;
      case 'excuse':
        for (const rhythm of rhythms.values()) {
          if (rhythm.movedBy(fact.calledOff)) writes.add(fact.atMs);
        }
        break;
      case 'seat': {
        const points = Math.floor(fact.seat.priceMinor / 100);
        if (points > 0) {
          const factKey = seatFactId(
            fact.visit.appointmentId,
            fact.seat.seatId,
          );
          const awardKey = `${EARN_RULE.ruleId}:${uid}:${factKey}`;
          pay(fact, points, {
            source: ruleSource(
              EARN_RULE.ruleId,
              EARN_RULE.version,
              awardKey,
              seatEventId(fact.visit.appointmentId, fact.seat.seatId),
            ),
            actor: ENGINE_ACTOR,
            correlationId: CORRELATION.visit(fact.visit.appointmentId),
            idempotencyKey: `award:${awardKey}#0`,
            labelCode: 'points.rule',
            labelParams: {
              rule: EARN_RULE.ruleId,
              points,
              spendMinor: fact.seat.priceMinor,
            },
            // The visit the seat's points were paid for (F3-11: the root
            // field the ledger folds a visit by).
            appointmentId: fact.visit.appointmentId,
          });
        }
        evaluateTier(fact);
        break;
      }
      case 'visit': {
        folded.visits.push(fact.visit);
        let cameBack = false;
        for (const [streakId, rhythm] of rhythms) {
          const trace = rhythm.on(fact.day);
          rhythm.best = trace.record?.value ?? 0;
          if (streakId === RHYTHM_STREAK_ID) {
            cameBack = trace.comebacks.includes(fact.day);
          }
        }
        writes.add(fact.atMs);
        evaluateFamilies({ ...fact, cameBack });
        mintStamp(fact);
        evaluateTier(fact);
        break;
      }
      case 'redemption': {
        const { redemption } = fact;
        const reward = catalog.rewardsCatalog[redemption.rewardId];
        const refusal = redeemRefusal(reward, balance, fact.day);
        if (refusal !== null) {
          throw new Error(
            `seed: ${uid} cannot redeem ${redemption.id}: ${refusal}`,
          );
        }
        // What it cost, then what it bought: one event, the redemption's.
        pay(fact, -reward.cost, {
          source: redemptionSource(redemption.id),
          actor: redemption.actor,
          correlationId: redemption.id,
          idempotencyKey: `rdm:${redemption.id}#0`,
          labelCode: 'points.redeemed',
          labelParams: { reward: redemption.rewardId, points: reward.cost },
        });
        append(fact, {
          effect: redemptionEffect(
            redemption.id,
            redemption.rewardId,
            reward.cost,
            redemptionGrantIdOf(redemption.id),
          ),
          source: redemptionSource(redemption.id),
          actor: redemption.actor,
          correlationId: redemption.id,
          idempotencyKey: `rdm:${redemption.id}#1`,
          labelCode: 'redemption.changed',
          labelParams: { op: 'redeemed', reward: redemption.rewardId },
        });
        break;
      }
    }
  }

  // ── The rhythm as of today, and the nights its phase moved ──
  const streaks = [];
  let longest = null;
  for (const [streakId, rhythm] of rhythms) {
    const trace = rhythm.on(today);
    for (const day of trace.judgedOn) writes.add(jobInstantOn(day));
    if (trace.state !== null) streaks.push(trace.state);
    if (streakId === RHYTHM_STREAK_ID) longest = trace.record;
  }

  // ── The documents ──
  const badgeProgress = {};
  for (const [seriesId, series] of families) {
    const entry = progress.get(seriesId);
    const act = ACTS[seriesId];
    const value = act?.met
      ? (entry?.earned.reduce((sum, earned) => sum + earned.count, 0) ?? 0)
      : act
        ? act.count(folded)
        : metricValue(series, seasonOf(series), folded, today);
    if (value === 0 && entry === undefined) continue;
    badgeProgress[seriesId] = badgeProgressBody(value, entry?.earned ?? []);
  }
  const seasonProgress = {};
  for (const [seasonId, season] of Object.entries(catalog.seasons)) {
    const track = season.trackSeriesId && badgeProgress[season.trackSeriesId];
    if (!track) continue;
    seasonProgress[seasonId] = seasonProgressBody(
      track.value,
      track.earned.at(-1)?.level ?? 0,
    );
  }

  const qualifying = qualifyingOn(visits, today, tiers.lastDays);
  const current = tiers.reachedBy(qualifying);
  const next = tiers.after(current);
  const account = loyaltyAccountBody({
    uid,
    balance,
    lifetimeEarned: earnedPoints,
    lifetimeSpent: spentPoints,
    tier: {
      tierId: current.id,
      definitionVersion: current.definition.version,
      sinceUtcMs: tier?.sinceMs ?? timeline[0].atMs,
      qualifying,
      nextTierId: next?.id ?? null,
      remaining:
        next === null ? null : next.definition.qualifyAtLeast - qualifying,
    },
    streaks,
    punchCard: {
      ruleId: PUNCH_CARD.ruleId,
      filled: visits.length % PUNCH_CARD.size,
      size: PUNCH_CARD.size,
      title: stampReward.name,
    },
    records: recordsOf(visits, longest),
    seq: rows.length,
    version: writes.size,
    updatedAtUtcMs: Math.max(...writes, timeline[0].atMs),
  });
  const customerId = customerIdOf(uid);
  return {
    uid,
    customerId,
    account,
    badgeProgress,
    seasonProgress,
    clientJournal: Object.fromEntries(
      rows.map((row) => [journalRowIdOf(customerId, row.seq), row]),
    ),
  };
}

/** The seat as the fact a rule pays once (R28): never the revisioned event id. */
const seatFactId = (appointmentId, seatId) =>
  `appt:${appointmentId}:seat:${seatId}`;
const seatEventId = (appointmentId, seatId) =>
  `appt_${appointmentId}_seat_${seatId}_worked_r1`;

/** Worked visits inside the window that ends on `day`. */
const qualifyingOn = (visits, day, lastDays) =>
  visits.filter((visit) => daysBetween(visit.day, day) < lastDays).length;

/**
 * The tiers by rank. They qualify on visits in one rolling window — the
 * only reading the fold has; any other refuses.
 */
function tierLadderOf(catalog) {
  const ladder = Object.entries(catalog.tierDefinitions)
    .map(([id, definition]) => ({ id, definition }))
    .sort((a, b) => a.definition.rank - b.definition.rank);
  if (ladder.length === 0) throw new Error('seed: the catalogue has no tiers');
  const lastDays = ladder[0].definition.qualifyWindowDays;
  for (const { id, definition } of ladder) {
    if (
      definition.qualifyMetric !== 'client.visits.completed' ||
      definition.qualifyWindowDays !== lastDays
    ) {
      throw new Error(`seed: the ${id} tier's qualification is not projected`);
    }
  }
  return {
    lastDays,
    reachedBy: (visits) =>
      ladder
        .filter((entry) => visits >= entry.definition.qualifyAtLeast)
        .at(-1),
    after: (entry) => ladder[ladder.indexOf(entry) + 1] ?? null,
  };
}

/** What stops a redemption at the counter, or `null`. */
function redeemRefusal(reward, balance, day) {
  if (reward === undefined) return 'no such reward';
  if (!reward.enabled) return 'the reward is off';
  if (reward.rewardGrant !== COUPON_GRANT) {
    return `a reward that grants a ${reward.rewardGrant} is not projected`;
  }
  const { availableFrom: from, availableUntil: until } = reward;
  if ((from !== null && day < from) || (until !== null && day > until)) {
    return 'the reward is not on offer that day';
  }
  return balance < reward.cost
    ? `${balance} points do not pay ${reward.cost}`
    : null;
}

/**
 * The reward the rewards catalogue sells the stamp card's coupon as: it
 * titles the card, and names the coupon on the row that mints it.
 */
function punchRewardOf(catalog) {
  const found = Object.entries(catalog.rewardsCatalog).find(
    ([, item]) =>
      item.rewardGrant === COUPON_GRANT &&
      item.grantCouponId === PUNCH_CARD.couponId,
  );
  if (!found) {
    throw new Error(`seed: no reward names the ${PUNCH_CARD.couponId} coupon`);
  }
  const [id, reward] = found;
  return { id, name: reward.name };
}

/**
 * «Рекорди»: the longest rhythm (the projector's own record: its length
 * and the day of the visit that reached it; none under a rule that is
 * off), the busiest year, the favourite service, the first visit.
 */
function recordsOf(visits, longest) {
  if (visits.length === 0) return [];
  const records = [];
  if (longest !== null) {
    records.push(longestRhythmRecord(longest.value, longest.on));
  }
  const years = new Map();
  for (const visit of visits) {
    const year = Number(visit.day.slice(0, 4));
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  const [year, inYear] = [...years].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  )[0];
  records.push(mostVisitsInYearRecord(inYear, year));
  // Most visits, then the most recently worked.
  const services = new Map();
  visits.forEach((visit, index) => {
    for (const serviceId of visit.serviceIds) {
      const entry = services.get(serviceId) ?? { count: 0, latest: -1 };
      services.set(serviceId, { count: entry.count + 1, latest: index });
    }
  });
  const [serviceId, favourite] = [...services].sort(
    (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
  )[0];
  records.push(favouriteServiceRecord(favourite.count, serviceId));
  records.push(firstVisitRecord(visits[0].day));
  return records;
}

// ── The coupons the engine granted ─────────────────────────────────────────

/**
 * The id of the coupon grant the stamp card minted at `stamp`. `naming` is
 * the holder's (`LOYALTY_HOLDERS[].stampGrants`): the newest, while they
 * still hold it, goes by the bare id, every other by the id and its stamp.
 * Nobody named: `grant-{uid}-punch-{stamp}`.
 */
export function stampGrantIdOf(uid, stamp, { naming = null, newest }) {
  const id = naming?.id ?? `grant-${uid}-punch`;
  return naming?.holdsNewest === true && stamp === newest
    ? id
    : `${id}-${stamp}`;
}

/** The id of the coupon grant a redemption bought. */
export const redemptionGrantIdOf = (redemptionId) => `grant-${redemptionId}`;

/**
 * When a coupon granted at the `index`-th worked visit was used: as the
 * chair freed on their next visit, or `null` while there has been none.
 */
const usedAfter = (visits, index) =>
  visits[index + 1] === undefined ? null : visits[index + 1].doneMs;

/**
 * The stamp card's coupons: one at every `PUNCH_CARD.size`-th worked visit
 * up to `today`, granted as that visit's chair freed — each with the id its
 * `REWARD` row names (`stampGrantIdOf`) and when it was used: on the visit
 * after, but for the newest a holder still holds (`usedAtUtcMs: null`).
 * Instants are epoch ms, as `couponGrantBody` stores them.
 */
export function punchCardGrantsOf(uid, appointments, today, naming = null) {
  const visits = workedVisitsOf(uid, appointments).filter(
    (visit) => visit.day <= today,
  );
  const newest = visits.length - (visits.length % PUNCH_CARD.size);
  return visits.flatMap((visit, index) => {
    const stamp = index + 1;
    if (stamp % PUNCH_CARD.size !== 0) return [];
    const held = naming?.holdsNewest === true && stamp === newest;
    return [
      {
        stamp,
        appointmentId: visit.appointmentId,
        grantId: stampGrantIdOf(uid, stamp, { naming, newest }),
        couponId: PUNCH_CARD.couponId,
        grantedAtUtcMs: visit.doneMs,
        usedAtUtcMs: held ? null : usedAfter(visits, index),
      },
    ];
  });
}

/**
 * The coupons a holder bought with points (`LOYALTY_HOLDERS[].redemptions`):
 * each granted at the counter, the instant its `REDEMPTION` row is
 * written, under the id that row names, and used on the visit after.
 */
export function redemptionGrantsOf(
  uid,
  appointments,
  catalog,
  today,
  redemptions = [],
) {
  const visits = workedVisitsOf(uid, appointments).filter(
    (visit) => visit.day <= today,
  );
  return redemptions.flatMap((redemption) => {
    const index = redemption.afterVisit - 1;
    const visit = visits[index];
    const reward = catalog.rewardsCatalog[redemption.rewardId];
    if (visit === undefined || reward?.rewardGrant !== COUPON_GRANT) return [];
    return [
      {
        redemptionId: redemption.id,
        grantId: redemptionGrantIdOf(redemption.id),
        couponId: reward.grantCouponId,
        grantedAtUtcMs: visit.doneMs + 2 * MINUTE_MS,
        usedAtUtcMs: usedAfter(visits, index),
      },
    ];
  });
}

/**
 * A projection's documents as `{ path, data }`: the account, its two
 * subcollections, the journal — under `loyaltyAccounts/{customerIdOf(uid)}`
 * (D29), the journal at its rows' own ids.
 */
export function loyaltyWritesOf(uid, projection) {
  const home = `${LOYALTY_ACCOUNTS_COLLECTION}/${customerIdOf(uid)}`;
  return [
    { path: home, data: projection.account },
    ...Object.entries(projection.badgeProgress).map(([id, data]) => ({
      path: `${home}/${BADGE_PROGRESS_COLLECTION}/${id}`,
      data,
    })),
    ...Object.entries(projection.seasonProgress).map(([id, data]) => ({
      path: `${home}/${SEASON_PROGRESS_COLLECTION}/${id}`,
      data,
    })),
    ...Object.entries(projection.clientJournal).map(([id, data]) => ({
      path: `${CLIENT_JOURNAL_COLLECTION}/${id}`,
      data,
    })),
  ];
}

// ── Read back, before writing ──────────────────────────────────────────────

/**
 * Reads `{ path, data }` writes back as the documents they will be — each
 * the entity, `{ id, ...data }` (Law 5: no mapper) — and holds them to the
 * two checks the seed keeps at run time (flip-3 plan F3-1 (b)); `domain`
 * is `loadSeedDomain()` (the ordinary imports in a spec):
 *
 * - the six catalogue collections as ONE catalogue,
 *   `LoyaltyCatalogSystem.validate` over them under the system's part names
 *   (`LOYALTY_CATALOG_PARTS`): a family naming a missing shelf or a missing
 *   season, two entries under one id, tiers that do not rise or a reward
 *   that costs nothing fail it whole, as they fail the client card's read;
 * - `StreakRule.parse` over every rule a head holds (and a head must hold
 *   one in force), and over every version — each version beside the head
 *   that names its rule, under the id its number gives it.
 *
 * The account, its progress and its journal have no run-time check: their
 * bodies are the builders' (`fixtures/loyalty.fixtures.ts`), held to their
 * entities by the type checker. Each is still routed by where it is
 * written, and a path no loyalty document is written at is a problem.
 *
 * Answers the validated catalogue, the documents by kind, and a `problems`
 * line for each refusal; the seed writes nothing while there is one.
 */
export function readLoyaltyWrites(domain, writes) {
  const read = {
    catalog: null,
    heads: [],
    ruleVersions: [],
    accounts: [],
    badgeProgress: [],
    seasonProgress: [],
    journal: [],
    problems: [],
  };
  const parts = Object.fromEntries(
    LOYALTY_CATALOG_PARTS.map(([, part]) => [part, []]),
  );
  const partOf = new Map(LOYALTY_CATALOG_PARTS);
  // An account document's kind, by its collection with the ids starred.
  const home = `${LOYALTY_ACCOUNTS_COLLECTION}/*`;
  const accountKinds = new Map([
    [LOYALTY_ACCOUNTS_COLLECTION, read.accounts],
    [`${home}/${BADGE_PROGRESS_COLLECTION}`, read.badgeProgress],
    [`${home}/${SEASON_PROGRESS_COLLECTION}`, read.seasonProgress],
    [CLIENT_JOURNAL_COLLECTION, read.journal],
  ]);
  const ruleVersions = `${STREAK_DEFINITIONS_COLLECTION}/*/${STREAK_DEFINITION_VERSIONS_COLLECTION}`;
  const heads = new Map();
  let catalogued = false;
  const versions = [];

  for (const { path, data } of writes) {
    const segments = path.split('/');
    const id = segments.at(-1);
    // `a/{id}` → `a`; `a/{id}/b/{id}` → `a/*/b`.
    const collection = segments
      .slice(0, -1)
      .map((segment, i) => (i % 2 === 1 ? '*' : segment))
      .join('/');
    const entity = { id, ...data };
    if (partOf.has(collection)) {
      parts[partOf.get(collection)].push(entity);
      catalogued = true;
      if (collection === STREAK_DEFINITIONS_COLLECTION) {
        heads.set(id, data);
        read.heads.push(entity);
        for (const problem of headProblemsOf(domain, data)) {
          read.problems.push(`${path}: ${problem}`);
        }
      }
    } else if (collection === ruleVersions) {
      // Read once every head is in: a version is the history of a head's rule.
      versions.push({ path, streakId: segments[1], versionId: id, data });
    } else if (accountKinds.has(collection)) {
      accountKinds.get(collection).push(entity);
    } else {
      read.problems.push(`${path}: no loyalty reader reads this path`);
    }
  }

  if (catalogued) {
    const catalog = domain.LoyaltyCatalogSystem.validate(parts);
    if (catalog.ok) read.catalog = catalog.value;
    else read.problems.push(`the catalogue: ${errorsText(catalog.error)}`);
  }
  for (const { path, streakId, versionId, data } of versions) {
    if (!isMap(heads.get(streakId))) {
      read.problems.push(`${path}: a version of a rule with no head`);
      continue;
    }
    if (versionId !== ruleVersionIdOf(data.version)) {
      read.problems.push(
        `${path}: .version ${shown(data.version)} is not the version ${versionId} names`,
      );
      continue;
    }
    const rule = domain.StreakRule.parse(data);
    if (!rule.ok) {
      read.problems.push(`${path}: ${errorsText(rule.error)}`);
      continue;
    }
    read.ruleVersions.push({ id: versionId, ...data });
  }
  return read;
}
