import {
  type ClientMoneyStats,
  type ClientStats,
  type PauseSuggestion,
  type VisitFact,
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
  type AppointmentEntity,
  AppointmentId as EcsAppointmentId,
  BarberId as EcsBarberId,
  type ClientMoneyStats as EcsClientMoneyStats,
  type ClientStats as EcsClientStats,
  ClientStatsSystem,
  ClientStatsWriteKind,
  type PauseSuggestion as EcsPauseSuggestion,
  PlacementKind,
  type PolicyPass as EcsPolicyPass,
  PolicyPassVerdictKind,
  PolicyRecomputeJobSystem,
  SeatId as EcsSeatId,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  UserId as EcsUserId,
  type VisitFact as EcsVisitFact,
  type VisitRef as EcsVisitRef,
} from '@creativo/ecs-core';
import { instantFromIso } from './policy-recompute-plan';

/**
 * The pure half of the client-stats projection: what a write changed, whom
 * it concerns, and whether a recomputed answer is worth a write. The shell
 * (`recompute-client-stats.ts`) reads, calls these and `computeClientStats`,
 * and writes once.
 *
 * Phase 2 shim: the decisions are `ClientStatsSystem` and
 * `PolicyRecomputeJobSystem` (the pass guard) in `@creativo/ecs-core`; this
 * file keeps the legacy names for its callers, reads the stored documents
 * through their mappers, and converts at the edge.
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
  return ClientStatsSystem.placementsFrom(
    docs.map((doc) => ({
      id: doc.id,
      placement: placementFromDocument(doc.data()),
    })),
  );
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
    clockMs,
    typeof updatedAt === 'string' ? Date.parse(updatedAt) : null,
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
  const plan = ClientStatsSystem.planWrite(
    {
      stored: {
        statsPresent: input.stored.stats !== undefined,
        moneyPresent: input.stored.money !== undefined,
        stats:
          storedStats === null
            ? null
            : {
                ...statsStruct(storedStats),
                version: storedStats.version,
                updatedAtMs: storedStats.updatedAtMs,
              },
        money:
          storedMoney === null
            ? null
            : {
                ...moneyStruct(storedMoney),
                version: storedMoney.version,
                updatedAtMs: storedMoney.updatedAtMs,
              },
        statsVersion: versionOf(input.stored.stats),
        moneyVersion: versionOf(input.stored.money),
      },
      stats: statsStruct(input.stats),
      money: moneyStruct(input.money),
      hasHistory: input.hasHistory,
      nowMs: input.nowMs,
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
  if (plan.kind === ClientStatsWriteKind.Unchanged)
    return { kind: 'unchanged' };
  const meta = { version: plan.version, updatedAtMs: plan.updatedAtMs };
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
  const ecsMine = mine === null ? null : passStruct(mine);
  const ecsStored = stored === null ? null : passStruct(stored);
  const verdict = PolicyRecomputeJobSystem.judgePolicyPass(ecsMine, ecsStored);
  if (verdict.kind === PolicyPassVerdictKind.Superseded) {
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

/** Any id: the stats input never reads the visit's own. */
const STATS_INPUT_ID = 'stats-input';

/**
 * A stored appointment as the entity `ClientStatsSystem` reads: through the
 * appointment mapper and the aggregate's own converter, with the commit's
 * placement (which only the document holds) beside it. `null` for no
 * document — and for one the mapper cannot read, which no recompute can
 * read either, so its edits move nobody's stats.
 */
function toEntity(
  data: PersistedDocument | undefined,
): AppointmentEntity | null {
  if (data === undefined) return null;
  const parsed = appointmentFromDocument(STATS_INPUT_ID, data);
  if (parsed.isFailure()) return null;
  return {
    ...toEcsAppointment(parsed.value),
    placement: PlacementKind.parse(placementFromDocument(data)),
  };
}

/** A pass stamp with its RFC 3339 instant as the §9 D17 struct. */
function passStruct(pass: PolicyPass): EcsPolicyPass {
  return {
    generation: pass.generation,
    changedAt: instantFromIso(pass.changedAt),
  };
}

function factStruct(fact: VisitFact): EcsVisitFact {
  return {
    appointmentId: EcsAppointmentId.of(fact.appointmentId.value),
    atMs: fact.atMs,
  };
}

function refStruct(ref: VisitRef | null): EcsVisitRef | null {
  if (ref === null) return null;
  return {
    ...factStruct(ref),
    serviceIds: ref.serviceIds.map((id) => EcsServiceId.of(id.value)),
    barberIds: ref.barberIds.map((id) => EcsBarberId.of(id.value)),
    legs: ref.legs.map((leg) => ({
      seatId: EcsSeatId.of(leg.seatId.value),
      serviceId: EcsServiceId.of(leg.serviceId.value),
      variantId:
        leg.variantId === null
          ? null
          : EcsServiceVariantId.of(leg.variantId.value),
      barberId: EcsBarberId.of(leg.barberId.value),
      minutes: leg.minutes,
    })),
  };
}

function suggestionStruct(
  suggestion: PauseSuggestion | null,
): EcsPauseSuggestion | null {
  if (suggestion === null) return null;
  return {
    noShows: suggestion.noShows,
    windowDays: suggestion.windowDays,
    basis: suggestion.basis.map((id) => EcsAppointmentId.of(id.value)),
    raisedAtMs: suggestion.raisedAtMs,
  };
}

/** The projection's content as the ecs-core struct the revision guard compares. */
function statsStruct(stats: ClientStats): EcsClientStats {
  return {
    userId: EcsUserId.of(stats.userId.value),
    lifetime: {
      visitsCompleted: stats.lifetime.visitsCompleted,
      noShows: stats.lifetime.noShows,
      lateCancels: stats.lifetime.lateCancels,
      clientCancels: stats.lifetime.clientCancels,
    },
    last365: {
      visitsCompleted: stats.last365.visitsCompleted.map(factStruct),
      noShows: stats.last365.noShows.map(factStruct),
      lateCancels: stats.last365.lateCancels.map(factStruct),
    },
    firstVisitAtMs: stats.firstVisitAtMs,
    lastVisit: refStruct(stats.lastVisit),
    nextVisit: refStruct(stats.nextVisit),
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId:
      stats.preferredBarberId === null
        ? null
        : EcsBarberId.of(stats.preferredBarberId.value),
    usualServiceIds: stats.usualServiceIds.map((id) =>
      EcsServiceId.of(id.value),
    ),
    pauseSuggestion: suggestionStruct(stats.pauseSuggestion),
  };
}

/** The flat legacy spend as the nested `Money` (blueprint §2.5). */
function moneyStruct(money: ClientMoneyStats): EcsClientMoneyStats {
  return {
    userId: EcsUserId.of(money.userId.value),
    lifetimeSpend: {
      amountMinorUnits: money.lifetimeSpendMinor,
      currencyCode: money.currencyCode,
    },
  };
}
