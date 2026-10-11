import {
  type ClientMoneyStats,
  type ClientStats,
  type VisitFact,
  type VisitPlacement,
  type VisitPlacements,
  type VisitRef,
  toEcsAppointment,
} from '@creativo/domain/scheduling';
import {
  CLIENT_MONEY_DOC,
  CLIENT_STATS_COLLECTION,
  CLIENT_STATS_RESTRICTED_COLLECTION,
  type PersistedDocument,
  type PolicyPass,
  appointmentFromDocument,
  clientMoneyFromDocument,
  clientMoneyToDocument,
  clientStatsFromDocument,
  clientStatsToDocument,
  placementFromDocument,
  subjectUserIdsFromDocument,
} from '@creativo/application/booking';
import {
  type Appointment as EcsAppointment,
  AppointmentId as EcsAppointmentId,
  BarberId as EcsBarberId,
  type ClientMoneyStats as EcsClientMoneyStats,
  type ClientStats as EcsClientStats,
  ClientStatsSystem,
  Currency,
  DurationMinutes,
  LastVisit,
  NextVisit,
  PauseSuggestion,
  Placement,
  type PolicyPass as EcsPolicyPass,
  PolicyPassVerdict as EcsPolicyPassVerdict,
  PolicyRecomputeJobSystem,
  type PreciseInstant,
  PriceCents,
  SeatId as EcsSeatId,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  StatsWriteDecision,
  type TimeZone,
  UserId as EcsUserId,
  UtcEpochMs,
  type VisitFact as EcsVisitFact,
  type VisitLeg as EcsVisitLeg,
  ZonedTimeSystem,
  defect,
} from '@creativo/ecs-core';
import { TENANT_ZONE } from '../booking/tenant-zone';
import {
  EARLIEST_INSTANT,
  LATEST_INSTANT,
  instantFromIso,
} from './policy-recompute-plan';

/**
 * The pure half of the client-stats projection: what a write changed, whom
 * it concerns, and whether a recomputed answer is worth a write. The shell
 * (`recompute-client-stats.ts`) reads, calls these and `computeClientStats`,
 * and writes once.
 *
 * Phase 2 shim: the decisions are `ClientStatsSystem` and
 * `PolicyRecomputeJobSystem` (the pass guard) in `@creativo/ecs-core`; this
 * file keeps the legacy names for its callers, reads the stored documents
 * through their mappers, and converts at the edge: a stored instant becomes
 * the shop wall clock (`localDate` + minutes) through `ZonedTimeSystem` in
 * the tenant's zone, a placement its SCREAMING tag, money its cents brand.
 */

/** JSON with object keys sorted, so two equal values always print the same. */
export function canonicalJson(value: unknown): string {
  return ClientStatsSystem.canonicalJson(value);
}

/**
 * The slice of a stored appointment `computeClientStats` and
 * `computeClientMoneyStats` can read — and so the only fields whose change
 * can move anybody's stats (§13 R28): `ClientStatsSystem.statsInputOf` over
 * the stored visit as the entity, never a field list of its own. An
 * arrival, a tip, a contact or a voucher changes none of it, and those are
 * most of the writes an appointment ever sees. The backfill's
 * `inferredPlacement` is not in it: no stat reads it.
 */
export function statsInputOf(data: PersistedDocument | undefined): unknown {
  return ClientStatsSystem.statsInputOf(toEntity(data));
}

/**
 * Who placed each stored appointment, as its COMMIT stamped it — the input
 * `computeClientStats` cannot read off the aggregate. A row the commit did
 * not stamp is left out, which the derivation reads as "no evidence"
 * (§12.5.1): a legacy import, and every row written before P0 even where the
 * backfill has since inferred a placement from its audit trail. The pre-P0
 * commit stored an omitted barber preference as `specific`, so those seats
 * cannot say whether anyone asked for the barber; `inferredPlacement` is
 * never read here for exactly that reason.
 */
export function placementsFrom(
  docs: readonly { readonly id: string; data(): PersistedDocument }[],
): VisitPlacements {
  const placements = ClientStatsSystem.placementsFrom(
    docs.map((doc) => ({
      id: EcsAppointmentId.of(doc.id),
      placement: placementOf(placementFromDocument(doc.data())),
    })),
  );
  const legacy = new Map<string, VisitPlacement>();
  for (const [id, placement] of placements) {
    legacy.set(id, LEGACY_PLACEMENT[placement]);
  }
  return legacy;
}

/** Did this write change anything a client's stats are computed from? */
export function statsInputChanged(
  before: PersistedDocument | undefined,
  after: PersistedDocument | undefined,
): boolean {
  return ClientStatsSystem.statsInputChanged(toEntity(before), toEntity(after));
}

/**
 * Everyone whose stats the write can have moved: the people on the visit
 * before AND after it — a person removed from a party must lose the visit,
 * which only a recompute of THEIR stats does. Read off the seats, never the
 * mirror, which a legacy row does not have.
 */
export function affectedSubjects(
  before: PersistedDocument | undefined,
  after: PersistedDocument | undefined,
): readonly string[] {
  return ClientStatsSystem.affectedSubjects(
    subjectUserIdsFromDocument(before),
    subjectUserIdsFromDocument(after),
  );
}

/**
 * The clock a recompute reads: never earlier than the stored answer's.
 *
 * Windows and the pause suggestion depend on "now", so an attempt that
 * started before the last write and commits after it must not resurrect a
 * no-show the stored document already aged out.
 */
export function projectionClock(
  clockMs: number,
  stored: PersistedDocument | undefined,
): number {
  const updatedAt = stored?.['updatedAt'];
  return ClientStatsSystem.projectionClock(
    instantOrThrow(clockMs),
    typeof updatedAt === 'string' ? instantOrNull(Date.parse(updatedAt)) : null,
  );
}

export type ClientStatsWrite =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'write';
      readonly version: number;
      readonly stats: PersistedDocument;
      readonly money: PersistedDocument;
    };

export interface ClientStatsWriteInput {
  readonly userId: string;
  /** What is stored now: the stats document and the money document. */
  readonly stored: {
    readonly stats: PersistedDocument | undefined;
    readonly money: PersistedDocument | undefined;
  };
  readonly stats: ClientStats;
  readonly money: ClientMoneyStats;
  /** False for a person with no appointment left at all. */
  readonly hasHistory: boolean;
  readonly nowMs: number;
}

/**
 * The revision guard. State-based, never delta-based: a recompute writes only
 * when its answer differs from what is stored, so a redelivered or
 * out-of-order event, a backfill racing the trigger, or a second backfill
 * run all converge on the same bytes without bumping anything. The two
 * documents move together at one version (model.ts: "same trigger, same
 * version"); a stored pair that disagrees on it is rewritten.
 */
export function planClientStatsWrite(
  input: ClientStatsWriteInput,
): ClientStatsWrite {
  const storedStats = clientStatsFromDocument(input.userId, input.stored.stats);
  const storedMoney = clientMoneyFromDocument(input.userId, input.stored.money);
  // A stored answer the flat shapes cannot hold reads as one that no longer
  // parses — the guard rewrites it, never keeps it.
  const storedStatsStruct =
    storedStats === null ? null : statsStruct(storedStats);
  const storedStatsAt =
    storedStats === null ? null : instantOrNull(storedStats.updatedAtMs);
  const storedMoneyStruct =
    storedMoney === null ? null : moneyStruct(storedMoney);
  const storedMoneyAt =
    storedMoney === null ? null : instantOrNull(storedMoney.updatedAtMs);
  const plan = ClientStatsSystem.planWrite(
    {
      stored: {
        statsPresent: input.stored.stats !== undefined,
        moneyPresent: input.stored.money !== undefined,
        stats:
          storedStats === null ||
          storedStatsStruct === null ||
          storedStatsAt === null
            ? null
            : {
                ...storedStatsStruct,
                version: storedStats.version,
                updatedAtUtcMs: storedStatsAt,
              },
        money:
          storedMoney === null ||
          storedMoneyStruct === null ||
          storedMoneyAt === null
            ? null
            : {
                ...storedMoneyStruct,
                version: storedMoney.version,
                updatedAtUtcMs: storedMoneyAt,
              },
        statsVersion: versionOf(input.stored.stats),
        moneyVersion: versionOf(input.stored.money),
      },
      stats: freshOrThrow(statsStruct(input.stats)),
      money: freshOrThrow(moneyStruct(input.money)),
      hasHistory: input.hasHistory,
      nowUtcMs: instantOrThrow(input.nowMs),
      // The stamp rides the shell's own write (`policyPassFields`).
      stamp: null,
      restamp: false,
    },
    {
      stats: [CLIENT_STATS_COLLECTION, input.userId],
      money: [
        CLIENT_STATS_COLLECTION,
        input.userId,
        CLIENT_STATS_RESTRICTED_COLLECTION,
        CLIENT_MONEY_DOC,
      ],
    },
  );
  if (plan.statsWriteDecision === StatsWriteDecision.Unchanged) {
    return { kind: 'unchanged' };
  }
  const meta = { version: plan.version, updatedAtMs: plan.updatedAtUtcMs };
  return {
    kind: 'write',
    version: plan.version,
    stats: clientStatsToDocument(input.stats, meta),
    money: clientMoneyToDocument(input.money, meta),
  };
}

/** A stored version even on a document that no longer parses — never go backwards. */
function versionOf(data: PersistedDocument | undefined): number | null {
  const raw = data?.['version'];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
    ? raw
    : null;
}

/*
 * THE POLICY PASS GUARD — a newer pass has the last word.
 *
 * A policy pass (`continuePolicyRecompute`) loads the policy once per step
 * and walks a page of clients under it. When the owner moves the line again
 * mid-page, the NEW pass can reach a client of that page before the old
 * step's write for them lands, and that write, judged by the old line,
 * would then stand until the client's next appointment. So each pass stamps
 * the clients it judges (`PolicyPass`, read and written by the stats
 * document's own mapper: `policyPassOf` / `policyPassFields` in
 * `@creativo/application/booking`), and the verdict below is compared
 * inside the client's own recompute transaction, so the two writes are
 * serialised by the store.
 */

/** What a recompute may do, given its own pass and the stamp it found. */
export type PolicyPassVerdict =
  /** A newer pass has judged this client: write nothing. */
  | { readonly kind: 'superseded' }
  /**
   * Judge the client. `stamp` is what the written document carries;
   * `restamp` says the stored one must move to it even when the answer
   * itself is unchanged — the newer pass must leave its mark on every
   * client it reaches, or an older pass's late write could not tell.
   */
  | {
      readonly kind: 'judge';
      readonly stamp: PolicyPass | null;
      readonly restamp: boolean;
    };

/**
 * The guard's verdict. `mine` is the pass doing the recompute, or `null`
 * for a writer that is not one (it carries `stored` forward). An older
 * change than the stamp is superseded; the same generation is a re-run of
 * the same pass; a newer one, one at the same instant, or an instant that
 * does not parse judges and restamps — the conservative answer is always to
 * write, never to skip.
 */
export function judgePolicyPass(
  mine: PolicyPass | null,
  stored: PolicyPass | null,
): PolicyPassVerdict {
  // An instant that does not parse never proves an order: mine reads as
  // the newest change there is, the stored one as the oldest — so the pass
  // judges and restamps, never skips.
  const ecsMine = mine === null ? null : passStruct(mine, LATEST_INSTANT);
  const ecsStored =
    stored === null ? null : passStruct(stored, EARLIEST_INSTANT);
  const verdict = PolicyRecomputeJobSystem.judgePolicyPass(ecsMine, ecsStored);
  if (verdict.policyPassVerdict === EcsPolicyPassVerdict.Superseded) {
    return { kind: 'superseded' };
  }
  return {
    kind: 'judge',
    // The stamp is one of the two inputs: hand back the caller's own.
    stamp:
      verdict.stamp === null ? null : verdict.stamp === ecsMine ? mine : stored,
    restamp: verdict.restamp,
  };
}

/* ── The Phase 2 bridge: legacy values ↔ ecs-core structs ──────────────── */

/** The tenant's zone, as the brand the conversions take (F-4: the legacy constant). */
const SHOP_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone(TENANT_ZONE);
  if (!zone.ok) defect(`unreachable: TENANT_ZONE ${TENANT_ZONE}`);
  return zone.value;
})();

/** The stored placement strings ↔ `Placement` — the ONE table. */
const LEGACY_PLACEMENT = {
  [Placement.Self]: 'self',
  [Placement.Staff]: 'staff',
} as const satisfies Record<Placement, VisitPlacement>;

function placementOf(raw: VisitPlacement | null): Placement | null {
  return raw === null
    ? null
    : raw === LEGACY_PLACEMENT[Placement.Self]
      ? Placement.Self
      : Placement.Staff;
}

function instantOrNull(ms: number): UtcEpochMs | null {
  const instant = UtcEpochMs.of(ms);
  return instant.ok ? instant.value : null;
}

/** A clock reading as an instant — the legacy clocks are `Date.now`-shaped. */
function instantOrThrow(ms: number): UtcEpochMs {
  const instant = instantOrNull(ms);
  if (instant === null) defect(`unreachable: a clock read ${ms}`);
  return instant;
}

/** A freshly computed answer always fits the flat shapes; one that does not is a defect. */
function freshOrThrow<T>(struct: T | null): T {
  if (struct === null) defect('unreachable: a fresh answer unfit');
  return struct;
}

/** Any id: the stats input never reads the visit's own. */
const STATS_INPUT_ID = 'stats-input';

/**
 * A stored appointment as the entity `ClientStatsSystem` reads: through the
 * appointment mapper and the aggregate's own converter, with the commit's
 * placement (which only the document holds) beside it. `null` for no
 * document — and for one the mapper cannot read, which no recompute can
 * read either, so its edits move nobody's stats.
 */
function toEntity(data: PersistedDocument | undefined): EcsAppointment | null {
  if (data === undefined) return null;
  const parsed = appointmentFromDocument(STATS_INPUT_ID, data);
  if (parsed.isFailure()) return null;
  return {
    ...toEcsAppointment(parsed.value),
    placement: placementOf(placementFromDocument(data)),
  };
}

/** A pass stamp with its RFC 3339 instant as the §9 D17 value; `unreadable` stands in for one that does not parse. */
function passStruct(
  pass: PolicyPass,
  unreadable: PreciseInstant,
): EcsPolicyPass {
  return {
    generation: pass.generation,
    changedAt: instantFromIso(pass.changedAt) ?? unreadable,
  };
}

/** An instant on the shop's wall clock; `null` for one that is not an instant. */
function wallOf(ms: number) {
  const instant = instantOrNull(ms);
  return instant === null ? null : ZonedTimeSystem.toLocal(instant, SHOP_ZONE);
}

function factStruct(fact: VisitFact): EcsVisitFact | null {
  const wall = wallOf(fact.atMs);
  if (wall === null) return null;
  return {
    appointmentId: EcsAppointmentId.of(fact.appointmentId.value),
    localDate: wall.localDate,
    startMinutes: wall.minute,
  };
}

function factsStruct(facts: readonly VisitFact[]): EcsVisitFact[] | null {
  const out: EcsVisitFact[] = [];
  for (const fact of facts) {
    const struct = factStruct(fact);
    if (struct === null) return null;
    out.push(struct);
  }
  return out;
}

function legsStruct(ref: VisitRef): EcsVisitLeg[] | null {
  const legs: EcsVisitLeg[] = [];
  for (const leg of ref.legs) {
    const minutes = DurationMinutes.of(leg.minutes);
    if (!minutes.ok) return null;
    legs.push({
      seatId: EcsSeatId.of(leg.seatId.value),
      serviceId: EcsServiceId.of(leg.serviceId.value),
      variantId:
        leg.variantId === null
          ? null
          : EcsServiceVariantId.of(leg.variantId.value),
      barberId: EcsBarberId.of(leg.barberId.value),
      durationMinutes: minutes.value,
    });
  }
  return legs;
}

function lastVisitStruct(ref: VisitRef | null): LastVisit | null {
  if (ref === null) return LastVisit.NONE;
  const fact = factStruct(ref);
  const legs = legsStruct(ref);
  if (fact === null || legs === null) return null;
  return {
    lastVisitAppointmentId: fact.appointmentId,
    lastVisitLocalDate: fact.localDate,
    lastVisitStartMinutes: fact.startMinutes,
    lastVisitServiceIds: ref.serviceIds.map((id) => EcsServiceId.of(id.value)),
    lastVisitBarberIds: ref.barberIds.map((id) => EcsBarberId.of(id.value)),
    lastVisitLegs: legs,
  };
}

function nextVisitStruct(ref: VisitRef | null): NextVisit | null {
  if (ref === null) return NextVisit.NONE;
  const fact = factStruct(ref);
  const legs = legsStruct(ref);
  if (fact === null || legs === null) return null;
  return {
    nextVisitAppointmentId: fact.appointmentId,
    nextVisitLocalDate: fact.localDate,
    nextVisitStartMinutes: fact.startMinutes,
    nextVisitServiceIds: ref.serviceIds.map((id) => EcsServiceId.of(id.value)),
    nextVisitBarberIds: ref.barberIds.map((id) => EcsBarberId.of(id.value)),
    nextVisitLegs: legs,
  };
}

function suggestionStruct(stats: ClientStats): PauseSuggestion | null {
  const suggestion = stats.pauseSuggestion;
  if (suggestion === null) return PauseSuggestion.NONE;
  const raisedAt = instantOrNull(suggestion.raisedAtMs);
  if (raisedAt === null) return null;
  return {
    pauseSuggestedNoShows: suggestion.noShows,
    pauseSuggestedWindowDays: suggestion.windowDays,
    pauseSuggestionBasis: suggestion.basis.map((id) =>
      EcsAppointmentId.of(id.value),
    ),
    pauseSuggestedAtUtcMs: raisedAt,
  };
}

/**
 * The projection's content as the flat ecs-core struct the revision guard
 * compares; `null` when a stored instant or duration cannot be one.
 */
function statsStruct(stats: ClientStats): EcsClientStats | null {
  const visitsCompleted = factsStruct(stats.last365.visitsCompleted);
  const noShows = factsStruct(stats.last365.noShows);
  const lateCancels = factsStruct(stats.last365.lateCancels);
  const first =
    stats.firstVisitAtMs === null ? null : wallOf(stats.firstVisitAtMs);
  const lastVisit = lastVisitStruct(stats.lastVisit);
  const nextVisit = nextVisitStruct(stats.nextVisit);
  const suggestion = suggestionStruct(stats);
  if (
    visitsCompleted === null ||
    noShows === null ||
    lateCancels === null ||
    (stats.firstVisitAtMs !== null && first === null) ||
    lastVisit === null ||
    nextVisit === null ||
    suggestion === null
  ) {
    return null;
  }
  return {
    userId: EcsUserId.of(stats.userId.value),
    lifetimeVisitsCompleted: stats.lifetime.visitsCompleted,
    lifetimeNoShows: stats.lifetime.noShows,
    lifetimeLateCancels: stats.lifetime.lateCancels,
    lifetimeClientCancels: stats.lifetime.clientCancels,
    last365VisitsCompleted: visitsCompleted,
    last365NoShows: noShows,
    last365LateCancels: lateCancels,
    firstVisitLocalDate: first === null ? null : first.localDate,
    firstVisitStartMinutes: first === null ? null : first.minute,
    ...lastVisit,
    ...nextVisit,
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId:
      stats.preferredBarberId === null
        ? null
        : EcsBarberId.of(stats.preferredBarberId.value),
    usualServiceIds: stats.usualServiceIds.map((id) =>
      EcsServiceId.of(id.value),
    ),
    ...suggestion,
  };
}

/** The flat legacy spend as the flat branded slice; `null` when it cannot be one. */
function moneyStruct(money: ClientMoneyStats): EcsClientMoneyStats | null {
  const cents = PriceCents.signed(money.lifetimeSpendMinor);
  const currency = Currency.parse(money.currencyCode);
  if (!cents.ok || !currency.ok) return null;
  return {
    userId: EcsUserId.of(money.userId.value),
    lifetimeSpendCents: cents.value,
    currency: currency.value,
  };
}
