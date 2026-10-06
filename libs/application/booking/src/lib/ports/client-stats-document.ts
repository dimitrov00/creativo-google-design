import type { Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import {
  AppointmentId,
  type ClientMoneyStats,
  type ClientStats,
  type PauseSuggestion,
  SeatId,
  type VisitFact,
  type VisitLeg,
  type VisitRef,
} from '@creativo/domain/scheduling';
import type { PersistedDocument } from './appointment-document';

/**
 * Where a client's stats live and how their documents parse — defined HERE,
 * in the port layer, for the reason `booking-policy-document.ts` is: the
 * functions write them through `firebase-admin`, the browser reads them
 * through `firebase/firestore`, and two parsers would be two answers.
 *
 * `clientStats/{uid}` is read by the book; the spend sits apart at
 * `clientStats/{uid}/restricted/money`, admin-only, because rules cannot
 * hide a field (R33). Instants are UTC ISO strings on the wire (the auditLog
 * precedent) and epoch milliseconds in the domain.
 */
export const CLIENT_STATS_COLLECTION = 'clientStats';
export const CLIENT_STATS_RESTRICTED_COLLECTION = 'restricted';
export const CLIENT_MONEY_DOC = 'money';

/** The bookkeeping both documents carry: bumped together, on every change. */
export interface ClientStatsMeta {
  readonly version: number;
  readonly updatedAtMs: number;
}

/** A stored `ClientStats` — the projection plus its revision. */
export interface ClientStatsRecord extends ClientStats, ClientStatsMeta {}

/** A stored `ClientMoneyStats` — same version as the stats it was written with. */
export interface ClientMoneyRecord extends ClientMoneyStats, ClientStatsMeta {}

const iso = (ms: number): string => new Date(ms).toISOString();

function factToDocument(fact: VisitFact): PersistedDocument {
  return { appointmentId: fact.appointmentId.value, at: iso(fact.atMs) };
}

function refToDocument(ref: VisitRef | null): PersistedDocument | null {
  if (ref === null) return null;
  return {
    ...factToDocument(ref),
    serviceIds: ref.serviceIds.map((id) => id.value),
    barberIds: ref.barberIds.map((id) => id.value),
    legs: ref.legs.map((leg) => ({
      seatId: leg.seatId.value,
      serviceId: leg.serviceId.value,
      variantId: leg.variantId?.value ?? null,
      barberId: leg.barberId.value,
      minutes: leg.minutes,
    })),
  };
}

function suggestionToDocument(
  suggestion: PauseSuggestion | null,
): PersistedDocument | null {
  if (suggestion === null) return null;
  return {
    noShows: suggestion.noShows,
    windowDays: suggestion.windowDays,
    basis: suggestion.basis.map((id) => id.value),
    raisedAt: iso(suggestion.raisedAtMs),
  };
}

/**
 * The projection's CONTENT — everything but the bookkeeping. Two runs over
 * the same history produce the same content byte for byte, which is what the
 * writer compares before bumping a version: an unchanged answer is not a
 * change.
 */
export function clientStatsContent(stats: ClientStats): PersistedDocument {
  return {
    userId: stats.userId.value,
    lifetime: {
      visitsCompleted: stats.lifetime.visitsCompleted,
      noShows: stats.lifetime.noShows,
      lateCancels: stats.lifetime.lateCancels,
      clientCancels: stats.lifetime.clientCancels,
    },
    last365: {
      visitsCompleted: stats.last365.visitsCompleted.map(factToDocument),
      noShows: stats.last365.noShows.map(factToDocument),
      lateCancels: stats.last365.lateCancels.map(factToDocument),
    },
    firstVisitAt:
      stats.firstVisitAtMs === null ? null : iso(stats.firstVisitAtMs),
    lastVisit: refToDocument(stats.lastVisit),
    nextVisit: refToDocument(stats.nextVisit),
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId: stats.preferredBarberId?.value ?? null,
    usualServiceIds: stats.usualServiceIds.map((id) => id.value),
    pauseSuggestion: suggestionToDocument(stats.pauseSuggestion),
  };
}

export function clientStatsToDocument(
  stats: ClientStats,
  meta: ClientStatsMeta,
): PersistedDocument {
  return {
    ...clientStatsContent(stats),
    version: meta.version,
    updatedAt: iso(meta.updatedAtMs),
  };
}

/** Spend's content — see `clientStatsContent`. */
export function clientMoneyContent(money: ClientMoneyStats): PersistedDocument {
  return {
    userId: money.userId.value,
    lifetimeSpendMinor: money.lifetimeSpendMinor,
    currencyCode: money.currencyCode,
  };
}

export function clientMoneyToDocument(
  money: ClientMoneyStats,
  meta: ClientStatsMeta,
): PersistedDocument {
  return {
    ...clientMoneyContent(money),
    version: meta.version,
    updatedAt: iso(meta.updatedAtMs),
  };
}

// ── Reading ─────────────────────────────────────────────────────────────

const count = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;

function instant(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Every entry of a stored id list that parses, the rest dropped. */
function ids<T>(
  raw: unknown,
  create: (value: string) => Result<T, unknown>,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const parsed = create(entry);
    if (parsed.isSuccess()) out.push(parsed.value);
  }
  return out;
}

function factFromDocument(raw: unknown): VisitFact | null {
  const data = record(raw);
  const id = AppointmentId.create(String(data?.['appointmentId'] ?? ''));
  const atMs = instant(data?.['at']);
  return id.isSuccess() && atMs !== null
    ? { appointmentId: id.value, atMs }
    : null;
}

function factsFromDocument(raw: unknown): VisitFact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(factFromDocument)
    .filter((fact): fact is VisitFact => fact !== null);
}

function legFromDocument(raw: unknown): VisitLeg | null {
  const data = record(raw);
  if (data === null) return null;
  const seatId = SeatId.create(String(data['seatId'] ?? ''));
  const serviceId = ServiceId.create(String(data['serviceId'] ?? ''));
  const barberId = BarberId.create(String(data['barberId'] ?? ''));
  const minutes = count(data['minutes']);
  let variantId: ServiceVariantId | null = null;
  if (data['variantId'] != null) {
    const variant = ServiceVariantId.create(String(data['variantId']));
    if (variant.isFailure()) return null;
    variantId = variant.value;
  }
  if (
    seatId.isFailure() ||
    serviceId.isFailure() ||
    barberId.isFailure() ||
    minutes === null
  ) {
    return null;
  }
  return {
    seatId: seatId.value,
    serviceId: serviceId.value,
    variantId,
    barberId: barberId.value,
    minutes,
  };
}

function refFromDocument(raw: unknown): VisitRef | null {
  const fact = factFromDocument(raw);
  const data = record(raw);
  if (fact === null || data === null) return null;
  const legs = Array.isArray(data['legs'])
    ? data['legs']
        .map(legFromDocument)
        .filter((leg): leg is VisitLeg => leg !== null)
    : [];
  return {
    ...fact,
    serviceIds: ids(data['serviceIds'], (v) => ServiceId.create(v)),
    barberIds: ids(data['barberIds'], (v) => BarberId.create(v)),
    legs,
  };
}

function suggestionFromDocument(raw: unknown): PauseSuggestion | null {
  const data = record(raw);
  if (data === null) return null;
  const noShows = count(data['noShows']);
  const windowDays = count(data['windowDays']);
  const raisedAtMs = instant(data['raisedAt']);
  if (noShows === null || windowDays === null || raisedAtMs === null) {
    return null;
  }
  return {
    noShows,
    windowDays,
    basis: ids(data['basis'], (v) => AppointmentId.create(v)),
    raisedAtMs,
  };
}

function metaFromDocument(
  data: Record<string, unknown>,
): ClientStatsMeta | null {
  const version = count(data['version']);
  const updatedAtMs = instant(data['updatedAt']);
  return version === null || updatedAtMs === null
    ? null
    : { version, updatedAtMs };
}

/**
 * Document → stats, keyed by the DOCUMENT's id (the doc id is the subject;
 * a stray `userId` field cannot re-point it). `null` when the counters or
 * the bookkeeping do not parse: a reader shows "no stats yet" rather than
 * numbers nobody can vouch for. List entries that do not parse are dropped.
 */
export function clientStatsFromDocument(
  userId: string,
  raw: PersistedDocument | null | undefined,
): ClientStatsRecord | null {
  const data = record(raw);
  const subject = UserId.create(userId);
  if (data === null || subject.isFailure()) return null;
  const meta = metaFromDocument(data);
  const lifetime = record(data['lifetime']);
  const last365 = record(data['last365']);
  if (meta === null || lifetime === null) return null;
  const visitsCompleted = count(lifetime['visitsCompleted']);
  const noShows = count(lifetime['noShows']);
  const lateCancels = count(lifetime['lateCancels']);
  const clientCancels = count(lifetime['clientCancels']);
  if (
    visitsCompleted === null ||
    noShows === null ||
    lateCancels === null ||
    clientCancels === null
  ) {
    return null;
  }
  const cadence = data['avgCadenceDays'];
  const preferred =
    typeof data['preferredBarberId'] === 'string'
      ? BarberId.create(data['preferredBarberId'])
      : null;
  return {
    userId: subject.value,
    lifetime: { visitsCompleted, noShows, lateCancels, clientCancels },
    last365: {
      visitsCompleted: factsFromDocument(last365?.['visitsCompleted']),
      noShows: factsFromDocument(last365?.['noShows']),
      lateCancels: factsFromDocument(last365?.['lateCancels']),
    },
    firstVisitAtMs: instant(data['firstVisitAt']),
    lastVisit: refFromDocument(data['lastVisit']),
    nextVisit: refFromDocument(data['nextVisit']),
    avgCadenceDays:
      typeof cadence === 'number' && Number.isFinite(cadence) && cadence >= 0
        ? cadence
        : null,
    preferredBarberId:
      preferred !== null && preferred.isSuccess() ? preferred.value : null,
    usualServiceIds: ids(data['usualServiceIds'], (v) => ServiceId.create(v)),
    pauseSuggestion: suggestionFromDocument(data['pauseSuggestion']),
    ...meta,
  };
}

/** Document → spend; `null` when it does not parse — never a guessed zero. */
export function clientMoneyFromDocument(
  userId: string,
  raw: PersistedDocument | null | undefined,
): ClientMoneyRecord | null {
  const data = record(raw);
  const subject = UserId.create(userId);
  if (data === null || subject.isFailure()) return null;
  const meta = metaFromDocument(data);
  const spend = data['lifetimeSpendMinor'];
  if (
    meta === null ||
    typeof spend !== 'number' ||
    !Number.isInteger(spend) ||
    data['currencyCode'] !== 'EUR'
  ) {
    return null;
  }
  return {
    userId: subject.value,
    lifetimeSpendMinor: spend,
    currencyCode: 'EUR',
    ...meta,
  };
}

// ── The policy pass stamp ───────────────────────────────────────────────

/**
 * THE POLICY PASS a stored answer was judged by: server-side bookkeeping on
 * `clientStats/{uid}`, beside `version` and `updatedAt`, and parsed HERE for
 * the same reason they are (one mapper per persisted shape, never a second
 * in the writer).
 *
 * A policy pass (`continuePolicyRecompute`) stamps every client it judges
 * with its own generation and change instant, and a pass whose change is
 * OLDER than the stamp it finds writes nothing (`judgePolicyPass`, in the
 * functions). That is what keeps a superseded pass's late write from
 * overwriting a newer pass's answer. Writers that are not a pass carry the
 * stamp they find forward and never claim one. No reader parses it, and
 * the content comparison (`clientStatsContent`) ignores it.
 */
export interface PolicyPass {
  /** The pass's job generation (`PolicyRecomputeJob.generation`). */
  readonly generation: string;
  /** The settings write it answers (`PolicyRecomputeJob.changedAt`) — what orders two passes. */
  readonly changedAt: string;
}

/** The stats document field the stamp lives in. */
export const POLICY_PASS_FIELD = 'policyPass';

/** The stamp on a stored stats document, or `null` for none (or none that parses). */
export function policyPassOf(
  stored: PersistedDocument | null | undefined,
): PolicyPass | null {
  const raw = new Map(Object.entries(stored ?? {})).get(POLICY_PASS_FIELD);
  const fields = record(raw);
  if (fields === null) return null;
  const generation = fields['generation'];
  const changedAt = fields['changedAt'];
  if (typeof generation !== 'string' || generation.length === 0) return null;
  if (typeof changedAt !== 'string' || changedAt.length === 0) return null;
  return { generation, changedAt };
}

/** The stamp as the fields a write carries — none for no stamp. */
export function policyPassFields(pass: PolicyPass | null): PersistedDocument {
  return pass === null
    ? {}
    : {
        [POLICY_PASS_FIELD]: {
          generation: pass.generation,
          changedAt: pass.changedAt,
        },
      };
}
