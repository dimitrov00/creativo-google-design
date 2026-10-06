import type {
  ClientMoneyStats,
  ClientStats,
  VisitPlacement,
  VisitPlacements,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  type PolicyPass,
  clientMoneyContent,
  clientMoneyFromDocument,
  clientMoneyToDocument,
  clientStatsContent,
  clientStatsFromDocument,
  clientStatsToDocument,
  placementFromDocument,
  subjectUserIdsFromDocument,
} from '@creativo/application/booking';
import { compareInstants } from './policy-recompute-plan';

/**
 * The pure half of the client-stats projection: what a write changed, whom
 * it concerns, and whether a recomputed answer is worth a write. The shell
 * (`recompute-client-stats.ts`) reads, calls these and `computeClientStats`,
 * and writes once.
 */

/** JSON with object keys sorted, so two equal values always print the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return raw;
    }
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  });
}

function pick(raw: unknown, keys: readonly string[]): unknown {
  if (raw === null || typeof raw !== 'object') return null;
  const fields = new Map(Object.entries(raw));
  return Object.fromEntries(keys.map((key) => [key, fields.get(key) ?? null]));
}

/**
 * The slice of a stored appointment `computeClientStats` and
 * `computeClientMoneyStats` can read — and so the only fields whose change
 * can move anybody's stats (§13 R28). An arrival, a tip, a contact or a
 * voucher changes none of it, and those are most of the writes an
 * appointment ever sees.
 *
 * The root status and `bookedAt` are in because the legacy outcome
 * derivation and the late-cancel rule read them; the discounts because
 * spend is net of them; the placement because the preferred barber counts
 * only visits whose commit stamped one (§11.2 #6). The backfill's
 * `inferredPlacement` is not in: no stat reads it, so stamping one moves
 * nobody's stats and wakes no recompute.
 */
export function statsInputOf(data: PersistedDocument | undefined): unknown {
  if (data === undefined) return null;
  const seats = Array.isArray(data['seats']) ? data['seats'] : [];
  return {
    status: data['status'] ?? null,
    bookedAt: data['bookedAt'] ?? null,
    discounts: data['discounts'] ?? null,
    placement: placementFromDocument(data),
    seats: seats.map((seat: unknown) => {
      const entry = (seat ?? {}) as Record<string, unknown>;
      return {
        id: entry['id'] ?? null,
        subject: pick(entry['subject'], ['kind', 'userId']),
        outcome: entry['outcome'] ?? null,
        slot: pick(entry['slot'], ['startIso', 'zone']),
        terms: pick(entry['terms'], [
          'priceMinorUnits',
          'currencyCode',
          'durationMinutes',
        ]),
        serviceId: entry['serviceId'] ?? null,
        variantId: entry['variantId'] ?? null,
        barberId: entry['barberId'] ?? null,
        barberPref: entry['barberPref'] ?? null,
      };
    }),
  };
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
  const placements = new Map<string, VisitPlacement>();
  for (const doc of docs) {
    const placement = placementFromDocument(doc.data());
    if (placement !== null) placements.set(doc.id, placement);
  }
  return placements;
}

/** Did this write change anything a client's stats are computed from? */
export function statsInputChanged(
  before: PersistedDocument | undefined,
  after: PersistedDocument | undefined,
): boolean {
  return (
    canonicalJson(statsInputOf(before)) !== canonicalJson(statsInputOf(after))
  );
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
  return [
    ...new Set([
      ...subjectUserIdsFromDocument(before),
      ...subjectUserIdsFromDocument(after),
    ]),
  ].sort();
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
  const storedMs = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(storedMs) ? Math.max(clockMs, storedMs) : clockMs;
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
  if (
    !input.hasHistory &&
    input.stored.stats === undefined &&
    input.stored.money === undefined
  ) {
    // Nobody to describe and nothing stored: writing zeros would only create
    // a document for a person the shop has never seen.
    return { kind: 'unchanged' };
  }
  const same =
    storedStats !== null &&
    storedMoney !== null &&
    storedStats.version === storedMoney.version &&
    canonicalJson(clientStatsContent(storedStats)) ===
      canonicalJson(clientStatsContent(input.stats)) &&
    canonicalJson(clientMoneyContent(storedMoney)) ===
      canonicalJson(clientMoneyContent(input.money));
  if (same) return { kind: 'unchanged' };

  const version =
    Math.max(
      versionOf(input.stored.stats) ?? 0,
      versionOf(input.stored.money) ?? 0,
    ) + 1;
  const meta = { version, updatedAtMs: input.nowMs };
  return {
    kind: 'write',
    version,
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
  if (mine === null) return { kind: 'judge', stamp: stored, restamp: false };
  if (stored === null) return { kind: 'judge', stamp: mine, restamp: true };
  if (stored.generation === mine.generation) {
    return { kind: 'judge', stamp: stored, restamp: false };
  }
  const order = compareInstants(mine.changedAt, stored.changedAt);
  if (order !== null && order < 0) return { kind: 'superseded' };
  return { kind: 'judge', stamp: mine, restamp: true };
}
