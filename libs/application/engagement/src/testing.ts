/**
 * `@creativo/application/engagement/testing` — TEST SUPPORT, never
 * production API.
 *
 * The loyalty fixtures (client-card-redesign.md §4.4, §4.6): the published
 * catalogue and two clients' accounts, exactly as Firestore holds them. One
 * set of files, three readers — the mapper specs parse them, the dev seed's
 * projector spec holds its output to their shape, the e2e seed writes them —
 * so the wire cannot drift between packages. They live behind their own
 * entry point so the production barrel (`@creativo/application/engagement`)
 * can never hand one to a provider. Since the ECS migration's Phase 3a the
 * catalogue and the vouchers live in `@creativo/ecs-core/testing`
 * (`libs/ecs-core/src/testing/fixtures/loyalty/`, where the dev seed reads
 * them by path) and the fixtures' day is its `FIXTURE_TODAY`; this entry
 * re-exports them, typed as the wire's documents, until Phase 4. The two
 * accounts still live here.
 *
 * Beside them, every loyalty port's in-memory reference: the two readers
 * of the first card, and revision 3's three (client-card-revision-3.md
 * §4.4, §4.5, §4.7) — the rhythm's rule, read and published
 * (`InMemoryStreakDefinitionRepository`), a person's gift vouchers
 * (`InMemoryClientVouchersReader`) and their activity
 * (`InMemoryLoyaltyActivityReader`). Each holds DOCUMENTS and answers
 * through the mappers the Firestore adapters use.
 */
import { BehaviorSubject, type Observable, map } from 'rxjs';
import {
  type BadgeProgress,
  type GiftVoucher,
  type IsoDate,
  type LedgerEntry,
  type LoyaltyAccount,
  type LoyaltyCatalog,
  type SeasonProgress,
  StreakDefinition,
  type StreakDefinitionError,
  StreakDefinitionSchedule,
  type StreakNoticePolicy,
  type StreakRuleChange,
} from '@creativo/domain/engagement';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import type { ClientVouchersReader } from './lib/ports/client-vouchers-reader.port';
import {
  GIFT_VOUCHERS_COLLECTION,
  GIFT_VOUCHER_HOLDER_FIELD,
  type GiftVoucherDocument,
  type GiftVoucherFields,
  giftVoucherFromDocument,
} from './lib/ports/gift-voucher-document';
import type {
  LoyaltyActivityPage,
  LoyaltyActivityQuery,
  LoyaltyActivityReader,
} from './lib/ports/loyalty-activity-reader.port';
import type { LoyaltyCatalogReader } from './lib/ports/loyalty-catalog-reader.port';
import type { LoyaltyReader } from './lib/ports/loyalty-reader.port';
import {
  type PublishStreakDefinition,
  type PublishStreakDefinitionError,
  type PublishedStreakDefinition,
  type StreakDefinitionRepository,
  type StreakDefinitionVersion,
  StreakPublishFailedError,
  type StreakPublishRefusal,
  StreakPublishRefusedError,
} from './lib/ports/streak-definition.port';
import {
  ACTIVITY_EFFECT_KINDS,
  BADGE_CATEGORIES_COLLECTION,
  BADGE_SERIES_COLLECTION,
  type BadgeCategoryDocument,
  type BadgeProgressDocument,
  type BadgeSeriesDocument,
  type ClientJournalEntryDocument,
  type LoyaltyAccountDocument,
  REWARDS_CATALOG_COLLECTION,
  type RewardCatalogItemDocument,
  SEASONS_COLLECTION,
  STREAK_DEFINITIONS_COLLECTION,
  type SeasonDocument,
  type SeasonProgressDocument,
  type StreakDefinitionHeadDocument,
  type StreakDefinitionVersionDocument,
  TIER_DEFINITIONS_COLLECTION,
  type TierDefinitionDocument,
  activityEntryFromDocument,
  badgeProgressFromDocument,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  seasonProgressFromDocument,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionId,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
} from './lib/ports/loyalty-document';
// The catalogue and the vouchers moved to ecs-core's test support in Phase
// 3a (the dev seed reads them there by path); this entry re-exports them,
// typed as the wire's documents, until Phase 4 deletes it. Test support
// importing test support — never production code (the lib's eslint config
// gives this entry the specs' import rule).
import {
  FIXTURE_TODAY,
  giftVouchersJson,
  loyaltyCatalogJson,
} from '@creativo/ecs-core/testing';
import georgiJson from './testing/fixtures/loyalty/account-georgi.json';
import martinJson from './testing/fixtures/loyalty/account-martin.json';

export { giftVouchersJson, loyaltyCatalogJson };

/** The published catalogue: every catalogue collection, keyed by collection, then by document id. */
export interface LoyaltyCatalogFixture {
  readonly [BADGE_CATEGORIES_COLLECTION]: Readonly<
    Record<string, BadgeCategoryDocument>
  >;
  readonly [BADGE_SERIES_COLLECTION]: Readonly<
    Record<string, BadgeSeriesDocument>
  >;
  readonly [SEASONS_COLLECTION]: Readonly<Record<string, SeasonDocument>>;
  readonly [TIER_DEFINITIONS_COLLECTION]: Readonly<
    Record<string, TierDefinitionDocument>
  >;
  readonly [REWARDS_CATALOG_COLLECTION]: Readonly<
    Record<string, RewardCatalogItemDocument>
  >;
  /** The rhythm's HEAD: the rule in force and the one that waits. */
  readonly [STREAK_DEFINITIONS_COLLECTION]: Readonly<
    Record<string, StreakDefinitionHeadDocument>
  >;
}

/**
 * One client's loyalty documents. The account's id is its `userId`; the
 * other three are keyed by document id. The journal holds the account's
 * point-moving rows — what the ledger reads — so `seq` is dense over them.
 * Their `points.rule` labels say what paid: `spendMinor` for a seat's
 * points, `seriesId` and `level` for a level's payout (the welcome is
 * `series-welcome` level 1); a redemption is `points.redeemed` with the
 * `reward`.
 */
export interface LoyaltyAccountFixture {
  /** `loyaltyAccounts/{uid}` */
  readonly account: LoyaltyAccountDocument;
  /** `loyaltyAccounts/{uid}/badgeProgress/{seriesId}` — the started families. */
  readonly badgeProgress: Readonly<Record<string, BadgeProgressDocument>>;
  /** `loyaltyAccounts/{uid}/seasonProgress/{seasonId}` */
  readonly seasonProgress: Readonly<Record<string, SeasonProgressDocument>>;
  /** `clientJournal/{uid}_{seq:06}` */
  readonly clientJournal: Readonly<Record<string, ClientJournalEntryDocument>>;
}

/** `giftVouchers/{id}`, keyed by document id. */
export type GiftVouchersFixture = Readonly<Record<string, GiftVoucherFields>>;

/**
 * One rule of the rhythm as Firestore holds it: the head every reader
 * loads, and the history under it.
 */
export interface StreakDefinitionFixture {
  /** `streakDefinitions/{streakId}` */
  readonly head: StreakDefinitionHeadDocument;
  /** `streakDefinitions/{streakId}/versions/{version:06}` */
  readonly versions: Readonly<Record<string, StreakDefinitionVersionDocument>>;
}

/** One client's journal, keyed by document id: what the activity feed reads. */
export type ClientJournalFixture = LoyaltyAccountFixture['clientJournal'];

export interface LoyaltyFixtures {
  /**
   * The Europe/Sofia day the fixtures are true on: the seasons' phases, the
   * rhythm's phase, tenure and every windowed count are as of it.
   */
  readonly today: string;
  readonly catalog: LoyaltyCatalogFixture;
  /**
   * Георги Петров (`dev-client-1`), the regular: 24 worked visits since
   * 6.03.2025, every one a fade with Иван at Център at 10:00, six with a
   * beard, seven booked online, today's cut done. 358 points after one
   * 250-point redemption; Злато, 6 visits to Платина; a 4/10 stamp card;
   * 24 in rhythm, a run that began with his first visit; 37 levels, the
   * autumn season's track at II.
   */
  readonly georgi: LoyaltyAccountFixture;
  /**
   * Мартин Илиев (`dev-client-2`): 13 classic cuts since 8.05.2025 at
   * 12:30 with Иван or Нико, ten booked online, the shop's one cancellation
   * excused; in the chair today, on his birthday. 215 points after one
   * 120-point redemption; Сребро, 3 visits to Злато; a 3/10 stamp card; 13
   * in rhythm since his first visit, at risk until 30.09; 28 levels.
   */
  readonly martin: LoyaltyAccountFixture;
  /**
   * Five gift vouchers. Георги holds three: `GIFT50`, 25,00 € left of
   * 50,00 € until the end of 31.12.2026, one he spent and one the shop
   * voided. Мартин holds `GIFT2025`, whole. `GIFT5` is paper: nobody's
   * until its code is presented.
   */
  readonly vouchers: GiftVouchersFixture;
}

/**
 * A document as JSON can spell it: every closed vocabulary widened to its
 * primitive. JSON has no literal types, so this is the strictest shape the
 * compiler can hold a fixture file to — keys, nesting, nullability and
 * primitive kinds; `testing.spec.ts` checks the vocabularies at run time.
 */
type Json<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends readonly (infer Item)[]
          ? readonly Json<Item>[]
          : { readonly [K in keyof T]: Json<T[K]> };

/** Checked against its documents' shape, then typed as them. */
function fixture<T>(json: Json<T>): T {
  return json as unknown as T;
}

/** Shared by every spec in a worker: a mutation would leak into the next one, so none is allowed. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const loyaltyFixtures: LoyaltyFixtures = deepFreeze({
  today: FIXTURE_TODAY,
  catalog: fixture<LoyaltyCatalogFixture>(loyaltyCatalogJson),
  georgi: fixture<LoyaltyAccountFixture>(georgiJson),
  martin: fixture<LoyaltyAccountFixture>(martinJson),
  vouchers: fixture<{
    readonly [GIFT_VOUCHERS_COLLECTION]: GiftVouchersFixture;
  }>(giftVouchersJson).giftVouchers,
});

// ── In-memory readers ───────────────────────────────────────────────────

/**
 * `LoyaltyReader` over fixture documents — for the specs of whatever reads
 * a client's loyalty. Each client is seeded with its documents exactly as
 * Firestore holds them, and every read parses them through the same
 * mappers the Firestore adapter uses: a spec sees what production would,
 * a malformed fixture fails as a malformed document would.
 */
export class InMemoryLoyaltyReader implements LoyaltyReader {
  /** Every read, in order — what a spec asserts was (or was not) asked for. */
  readonly calls: {
    readonly method: keyof LoyaltyReader;
    readonly userId: string;
  }[] = [];
  private readonly clients = new Map<string, LoyaltyAccountFixture>();
  private failure: RepositoryError | null = null;

  /** Clients by uid; the documents keep their own ids, `userId` follows the key. */
  constructor(clients: Readonly<Record<string, LoyaltyAccountFixture>> = {}) {
    for (const [userId, documents] of Object.entries(clients)) {
      this.put(userId, documents);
    }
  }

  /** Георги as `dev-client-1` and Мартин as `dev-client-2`, as the dev seed writes them. */
  static seeded(): InMemoryLoyaltyReader {
    return new InMemoryLoyaltyReader({
      [loyaltyFixtures.georgi.account.userId]: loyaltyFixtures.georgi,
      [loyaltyFixtures.martin.account.userId]: loyaltyFixtures.martin,
    });
  }

  /** Seeds, or replaces, one client's documents. */
  put(userId: string, documents: LoyaltyAccountFixture): this {
    this.clients.set(userId, documents);
    return this;
  }

  /** Every read answers this error until `recover()` — a region's failed state. */
  failWith(error = new RepositoryError('Loyalty is unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async getAccount(
    userId: string,
  ): Promise<Result<LoyaltyAccount | null, RepositoryError>> {
    return this.answer('getAccount', userId, (documents) =>
      documents === undefined
        ? ok(null)
        : loyaltyAccountFromDocument(userId, {
            ...documents.account,
            userId,
          }),
    );
  }

  async listBadgeProgress(
    userId: string,
  ): Promise<Result<readonly BadgeProgress[], RepositoryError>> {
    return this.answer('listBadgeProgress', userId, (documents) =>
      parsedAll(documents?.badgeProgress ?? {}, badgeProgressFromDocument),
    );
  }

  async listSeasonProgress(
    userId: string,
  ): Promise<Result<readonly SeasonProgress[], RepositoryError>> {
    return this.answer('listSeasonProgress', userId, (documents) =>
      parsedAll(documents?.seasonProgress ?? {}, seasonProgressFromDocument),
    );
  }

  /** The query the adapter runs: client-visible point rows, newest first, `limit` of them. */
  async listLedgerTail(
    userId: string,
    limit: number,
  ): Promise<Result<readonly LedgerEntry[], RepositoryError>> {
    return this.answer('listLedgerTail', userId, (documents) => {
      const rows = Object.fromEntries(
        Object.entries(documents?.clientJournal ?? {}).filter(
          ([, entry]) =>
            entry.visibility === 'client' && entry.effect.kind === 'points',
        ),
      );
      const parsed = parsedAll(rows, ledgerEntryFromDocument);
      return parsed.isFailure()
        ? parsed
        : ok(
            [...parsed.value]
              .sort((a, b) => b.seq - a.seq)
              .slice(0, Math.max(0, limit)),
          );
    });
  }

  private answer<T>(
    method: keyof LoyaltyReader,
    userId: string,
    read: (
      documents: LoyaltyAccountFixture | undefined,
    ) => Result<T, RepositoryError>,
  ): Result<T, RepositoryError> {
    this.calls.push({ method, userId });
    if (this.failure !== null) return fail(this.failure);
    return read(this.clients.get(userId));
  }
}

/**
 * `LoyaltyCatalogReader` over catalogue documents — the fixture's by
 * default — parsed and validated by `loyaltyCatalogFromDocuments`, as the
 * Firestore adapter does.
 */
export class InMemoryLoyaltyCatalogReader implements LoyaltyCatalogReader {
  /** How many times the catalogue was asked for. */
  reads = 0;
  private failure: RepositoryError | null = null;

  constructor(
    private readonly documents: LoyaltyCatalogFixture = loyaltyFixtures.catalog,
  ) {}

  /** Every read answers this error until `recover()`. */
  failWith(error = new RepositoryError('The catalogue is unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async getCatalog(): Promise<Result<LoyaltyCatalog, RepositoryError>> {
    this.reads += 1;
    if (this.failure !== null) return fail(this.failure);
    return loyaltyCatalogFromDocuments(this.documents);
  }
}

// ── The rhythm's rule (client-card-revision-3 §4.4) ─────────────────────

/** What the reference repository is told about the day and the shop. */
export interface InMemoryStreakDefinitionOptions {
  /** The shop's today, which decides what is in force and what waits. The fixtures' day unless said. */
  readonly today?: IsoDate;
  /** When a change may take effect. Unless said: no client sees the rhythm yet, 30 days of notice once one does. */
  readonly policy?: StreakNoticePolicy;
  /** Who publishes: the uid on every version written. Иван, the seed's admin, unless said. */
  readonly publisher?: string;
  /** The instant of a write. Unless said: 09:00 UTC on `today`. */
  readonly now?: () => Date;
}

/** The first version's provenance: the rule the shop opened with, which nobody published by hand. */
const FIRST_VERSION_PUBLISHER = 'system';

/**
 * `StreakDefinitionRepository` over the rule's documents: the reference
 * of the port, and of the callable behind it. It holds a head and its
 * versions exactly as Firestore does, reads them through the wire's
 * mappers, and WRITES as `publishStreakDefinition` does: a request is
 * refused in the server's words (`stale`, `invalid`, `tooEarly`,
 * `recomputeNeedsEngine`), a retry of a written intent writes nothing, a
 * version effective today or earlier is the rule in force at once, a
 * later one waits in place of whatever waited, and every watcher of the
 * head hears of it.
 *
 * THE WRITER NUMBERS THE VERSION: one above the highest ever written,
 * which after a withdrawal is more than the head's newest. A version
 * document is written once; the number a request's rule carries is a
 * proposal, and the answer says which number it got.
 *
 * It judges nobody's role: `refuseWith('notAdmin')` scripts what the
 * rules and the token decide.
 */
export class InMemoryStreakDefinitionRepository implements StreakDefinitionRepository {
  /** Every call, in order: what a spec asserts was (or was not) asked for. */
  readonly calls: {
    readonly method: keyof StreakDefinitionRepository;
    readonly streakId: string;
  }[] = [];
  private readonly heads = new Map<string, StreakDefinitionHeadDocument>();
  private readonly versions = new Map<
    string,
    Map<string, StreakDefinitionVersionDocument>
  >();
  /** The withdrawals written, by intent: a retry of one answers as it did. */
  private readonly withdrawn = new Set<string>();
  private readonly changes = new BehaviorSubject(0);
  private failure: RepositoryError | null = null;
  private refusal: StreakPublishRefusedError | null = null;
  private today: IsoDate;
  private readonly policy: StreakNoticePolicy;
  private readonly publisher: string;
  private readonly now: () => Date;

  /** Rules by id. With none, the shop has published no rule yet. */
  constructor(
    rules: Readonly<Record<string, StreakDefinitionFixture>> = {},
    options: InMemoryStreakDefinitionOptions = {},
  ) {
    this.today = options.today ?? loyaltyFixtures.today;
    this.policy = options.policy ?? {
      clientsSeeRhythm: false,
      noticeDays: 30,
    };
    this.publisher = options.publisher ?? 'dev-staff-ivan';
    this.now = options.now ?? (() => new Date(`${this.today}T09:00:00.000Z`));
    for (const [streakId, rule] of Object.entries(rules)) {
      this.heads.set(streakId, rule.head);
      this.versions.set(streakId, new Map(Object.entries(rule.versions)));
    }
  }

  /**
   * The catalogue fixture's rule, with the history the seed gives it: one
   * version, the first, which the shop opened with.
   */
  static seeded(
    options: InMemoryStreakDefinitionOptions = {},
  ): InMemoryStreakDefinitionRepository {
    const heads = loyaltyFixtures.catalog.streakDefinitions;
    return new InMemoryStreakDefinitionRepository(
      Object.fromEntries(
        Object.entries(heads).map(([streakId, head]) => [
          streakId,
          { head, versions: firstVersionOf(streakId, head) },
        ]),
      ),
      options,
    );
  }

  /** The documents a rule stands as now: what a spec holds a write to. */
  documentsOf(streakId: string): StreakDefinitionFixture | null {
    const head = this.heads.get(streakId);
    return head === undefined
      ? null
      : {
          head,
          versions: Object.fromEntries(this.versions.get(streakId) ?? []),
        };
  }

  /** Moves the shop's today: a version that waited is in force from its own day on, with no write. */
  advanceTo(today: IsoDate): this {
    this.today = today;
    return this.told();
  }

  /** Every read and write fails with this error until `recover()`: the page's failed state, a save that got no answer. */
  failWith(
    error = new RepositoryError('The rhythm rule is unavailable'),
  ): this {
    this.failure = error;
    return this.told();
  }

  /** Every write is refused in these words until `recover()`; reads go on answering. */
  refuseWith(
    refusal: StreakPublishRefusal,
    fields: readonly string[] = [],
  ): this {
    this.refusal = new StreakPublishRefusedError(refusal, fields);
    return this;
  }

  recover(): this {
    this.failure = null;
    this.refusal = null;
    return this.told();
  }

  observe(
    streakId: string,
  ): Observable<Result<StreakDefinitionSchedule | null, RepositoryError>> {
    return this.changes.pipe(
      map(() => {
        this.calls.push({ method: 'observe', streakId });
        return this.failure === null
          ? this.scheduleOf(streakId)
          : fail(this.failure);
      }),
    );
  }

  async listVersions(
    streakId: string,
    limit: number,
  ): Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>> {
    this.calls.push({ method: 'listVersions', streakId });
    if (this.failure !== null) return fail(this.failure);
    const head = this.heads.get(streakId);
    if (head === undefined) return ok([]);
    const newestFirst = [...(this.versions.get(streakId) ?? [])]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .slice(0, Math.max(1, Math.floor(limit)));
    const out: StreakDefinitionVersion[] = [];
    for (const [versionId, data] of newestFirst) {
      const parsed = streakDefinitionVersionFromDocument(
        streakId,
        versionId,
        data,
        head.name,
      );
      if (parsed.isFailure()) return fail(parsed.error);
      out.push(parsed.value);
    }
    return ok(out);
  }

  async publish(
    request: PublishStreakDefinition,
  ): Promise<Result<PublishedStreakDefinition, PublishStreakDefinitionError>> {
    const { transition } = request;
    const streakId = request.definition.id;
    this.calls.push({ method: 'publish', streakId });
    const unable = this.unable();
    if (unable !== null) return fail(unable);

    const versions = this.versions.get(streakId) ?? new Map();
    for (const written of versions.values()) {
      if (written.requestId !== request.requestId) continue;
      return ok({
        version: written.version,
        effectiveFrom: written.effectiveFrom,
        direction: written.direction,
      });
    }
    if (transition === 'recompute') return refused('recomputeNeedsEngine');

    const read = this.scheduleOf(streakId);
    if (read.isFailure()) return fail(new StreakPublishFailedError(read.error));
    const schedule = read.value;
    const newest =
      schedule === null
        ? 0
        : (schedule.scheduled?.definition.version ?? schedule.current.version);
    if (request.baseVersion !== newest) return refused('stale');

    const written = [...versions.values()].map((version) => version.version);
    const numbered = StreakDefinition.create({
      ...request.definition.toProps(),
      version: Math.max(newest, ...written) + 1,
    });
    if (numbered.isFailure()) {
      return refused('invalid', fieldsOf(numbered.error));
    }
    const definition = numbered.value;

    // A shop's first rule has nothing before it to be compared with, or
    // to give notice of.
    const inForce = schedule?.inForceOn(this.today) ?? null;
    const change: StreakRuleChange =
      inForce === null
        ? { direction: 'neutral', changed: [] }
        : definition.changeFrom(inForce);
    if (
      inForce !== null &&
      definition.effectiveFrom <
        StreakDefinitionSchedule.earliestEffectiveDay(
          change,
          this.today,
          this.policy,
        )
    ) {
      return refused('tooEarly', ['effectiveFrom']);
    }

    const next = StreakDefinitionSchedule.create(
      inForce === null || definition.effectiveFrom <= this.today
        ? { current: definition, scheduled: null }
        : { current: inForce, scheduled: { definition, transition } },
    );
    if (next.isFailure()) return refused('invalid', fieldsOf(next.error));

    const at = this.now();
    const replaced = schedule?.upcomingOn(this.today) ?? null;
    if (replaced !== null) {
      this.callOff(versions, replaced.definition.version, at);
    }
    versions.set(
      streakDefinitionVersionId(definition.version),
      streakDefinitionVersionToDocument({
        definition,
        publishedAt: at,
        publishedBy: this.publisher,
        transition,
        direction: change.direction,
        changed: change.changed,
        requestId: request.requestId,
        withdrawnAt: null,
      }),
    );
    this.versions.set(streakId, versions);
    this.heads.set(streakId, streakScheduleToDocument(next.value, at));
    this.told();
    return ok({
      version: definition.version,
      effectiveFrom: definition.effectiveFrom,
      direction: change.direction,
    });
  }

  async withdraw(
    streakId: string,
    version: number,
    requestId: string,
  ): Promise<Result<void, PublishStreakDefinitionError>> {
    this.calls.push({ method: 'withdraw', streakId });
    const unable = this.unable();
    if (unable !== null) return fail(unable);
    if (this.withdrawn.has(requestId)) return ok(undefined);

    const read = this.scheduleOf(streakId);
    if (read.isFailure()) return fail(new StreakPublishFailedError(read.error));
    const waiting = read.value?.upcomingOn(this.today) ?? null;
    if (read.value === null || waiting?.definition.version !== version) {
      return refused('stale');
    }
    const head = StreakDefinitionSchedule.create({
      current: read.value.current,
      scheduled: null,
    });
    if (head.isFailure()) return refused('invalid', fieldsOf(head.error));

    const at = this.now();
    this.callOff(this.versions.get(streakId) ?? new Map(), version, at);
    this.heads.set(streakId, streakScheduleToDocument(head.value, at));
    this.withdrawn.add(requestId);
    this.told();
    return ok(undefined);
  }

  /** The head as a model; `null` for a rule nobody published. */
  private scheduleOf(
    streakId: string,
  ): Result<StreakDefinitionSchedule | null, RepositoryError> {
    const head = this.heads.get(streakId);
    return head === undefined
      ? ok(null)
      : streakScheduleFromDocument(streakId, head);
  }

  /** Why no write can be answered now, if anything. */
  private unable(): PublishStreakDefinitionError | null {
    return this.failure === null
      ? this.refusal
      : new StreakPublishFailedError(this.failure);
  }

  /** Stamps a version as called off, the one field of a version that is ever set later. */
  private callOff(
    versions: Map<string, StreakDefinitionVersionDocument>,
    version: number,
    at: Date,
  ): void {
    const versionId = streakDefinitionVersionId(version);
    const written = versions.get(versionId);
    if (written === undefined) return;
    versions.set(versionId, { ...written, withdrawnAt: at.toISOString() });
  }

  /** Every watcher reads again. */
  private told(): this {
    this.changes.next(this.changes.value + 1);
    return this;
  }
}

/** The history of a rule nobody has revised: its head's rule, as version 1's document. */
function firstVersionOf(
  streakId: string,
  head: StreakDefinitionHeadDocument,
): Readonly<Record<string, StreakDefinitionVersionDocument>> {
  const schedule = streakScheduleFromDocument(streakId, head);
  if (schedule.isFailure()) throw schedule.error;
  const { current } = schedule.value;
  return {
    [streakDefinitionVersionId(current.version)]:
      streakDefinitionVersionToDocument({
        definition: current,
        publishedAt: new Date(head.updatedAt),
        publishedBy: FIRST_VERSION_PUBLISHER,
        transition: 'grandfather',
        direction: 'neutral',
        changed: [],
        requestId: `seed-${streakId}-${streakDefinitionVersionId(current.version)}`,
        withdrawnAt: null,
      }),
  };
}

function refused<T>(
  refusal: StreakPublishRefusal,
  fields: readonly string[] = [],
): Result<T, PublishStreakDefinitionError> {
  return fail(new StreakPublishRefusedError(refusal, fields));
}

const fieldsOf = (errors: readonly StreakDefinitionError[]): string[] => [
  ...new Set(errors.map((error) => error.field)),
];

// ── A person's gift vouchers (client-card-revision-3 §4.5) ──────────────

/**
 * `ClientVouchersReader` over voucher documents, the fixture's unless
 * said: the query the adapter runs (`issuedToUserId ==`), then the wire's
 * reader. Whatever their state; a paper voucher is nobody's.
 */
export class InMemoryClientVouchersReader implements ClientVouchersReader {
  /** Every read, in order. */
  readonly calls: { readonly userId: string }[] = [];
  private readonly documents: Map<string, GiftVoucherDocument>;
  private failure: RepositoryError | null = null;

  /** `giftVouchers`, keyed by document id. */
  constructor(documents: Readonly<Record<string, GiftVoucherDocument>> = {}) {
    this.documents = new Map(Object.entries(documents));
  }

  /** The five vouchers of the fixture: three of Георги's, Мартин's one, one on paper. */
  static seeded(): InMemoryClientVouchersReader {
    return new InMemoryClientVouchersReader(loyaltyFixtures.vouchers);
  }

  /** Issues, or replaces, one voucher. */
  put(id: string, document: GiftVoucherDocument): this {
    this.documents.set(id, document);
    return this;
  }

  /** Every read answers this error until `recover()`: the holdings' failed state. */
  failWith(error = new RepositoryError('The vouchers are unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async listForHolder(
    userId: string,
  ): Promise<Result<readonly GiftVoucher[], RepositoryError>> {
    this.calls.push({ userId });
    if (this.failure !== null) return fail(this.failure);
    const held: GiftVoucher[] = [];
    for (const [id, document] of this.documents) {
      const holder = new Map(Object.entries(document)).get(
        GIFT_VOUCHER_HOLDER_FIELD,
      );
      if (holder !== userId) continue;
      const voucher = giftVoucherFromDocument(id, document);
      // A document that is no voucher costs nobody the rest of theirs.
      if (voucher !== null) held.push(voucher);
    }
    return ok(held);
  }
}

// ── A person's activity (client-card-revision-3 §4.7) ───────────────────

/**
 * `LoyaltyActivityReader` over clients' journals: the query the adapter
 * runs (client-visible rows of the pill's effects, newest first, older
 * than the cursor), then the wire's reader, a row per journal entry.
 *
 * The account fixtures' journals hold POINT ROWS only, so the seeded
 * reader answers points under «Всички» and «Точки» and nothing under the
 * other two; a spec that needs a reward, a redemption, a tier or a medal
 * row `put`s a journal that holds one.
 */
export class InMemoryLoyaltyActivityReader implements LoyaltyActivityReader {
  /** Every page asked for, in order. */
  readonly calls: (LoyaltyActivityQuery & { readonly userId: string })[] = [];
  private readonly journals = new Map<string, ClientJournalFixture>();
  private failure: RepositoryError | null = null;

  /** Journals by uid, each keyed by document id. */
  constructor(journals: Readonly<Record<string, ClientJournalFixture>> = {}) {
    for (const [userId, journal] of Object.entries(journals)) {
      this.put(userId, journal);
    }
  }

  /** Георги's journal as `dev-client-1` and Мартин's as `dev-client-2`. */
  static seeded(): InMemoryLoyaltyActivityReader {
    return new InMemoryLoyaltyActivityReader({
      [loyaltyFixtures.georgi.account.userId]:
        loyaltyFixtures.georgi.clientJournal,
      [loyaltyFixtures.martin.account.userId]:
        loyaltyFixtures.martin.clientJournal,
    });
  }

  /** Seeds, or replaces, one client's journal. */
  put(userId: string, journal: ClientJournalFixture): this {
    this.journals.set(userId, journal);
    return this;
  }

  /** Every read answers this error until `recover()`: the feed's failed state. */
  failWith(error = new RepositoryError('The activity is unavailable')): this {
    this.failure = error;
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  async page(
    userId: string,
    query: LoyaltyActivityQuery,
  ): Promise<Result<LoyaltyActivityPage, RepositoryError>> {
    this.calls.push({ userId, ...query });
    if (this.failure !== null) return fail(this.failure);
    const effects: readonly string[] = ACTIVITY_EFFECT_KINDS[query.kind];
    const limit = Math.max(1, Math.floor(query.limit));
    const older = Object.entries(this.journals.get(userId) ?? {})
      .filter(
        ([, entry]) =>
          entry.visibility === 'client' &&
          effects.includes(entry.effect.kind) &&
          (query.after === null || entry.seq < query.after),
      )
      .sort(([, a], [, b]) => b.seq - a.seq);
    const rows = Object.fromEntries(older.slice(0, limit));
    const entries = parsedAll(rows, activityEntryFromDocument);
    if (entries.isFailure()) return fail(entries.error);
    const last = entries.value[entries.value.length - 1];
    return ok({
      entries: entries.value,
      next: last !== undefined && older.length > limit ? last.seq : null,
    });
  }
}

/** Every document of a collection through its reader; the first failure fails the read. */
function parsedAll<T>(
  documents: Readonly<Record<string, unknown>>,
  parse: (id: string, data: unknown) => Result<T, RepositoryError>,
): Result<readonly T[], RepositoryError> {
  const out: T[] = [];
  for (const [id, data] of Object.entries(documents)) {
    const parsed = parse(id, data);
    if (parsed.isFailure()) return fail(parsed.error);
    out.push(parsed.value);
  }
  return ok(out);
}
