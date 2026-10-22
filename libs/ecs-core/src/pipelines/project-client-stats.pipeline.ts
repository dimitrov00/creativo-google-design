import {
  type CustomerId,
  type RepositoryError,
  Result,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type ClientMoneyStats,
  type ClientStats,
  ClientStatsPolicy,
  type PolicyPass,
  PolicyPassStamp,
  type Seat,
  type ShopNow,
  type WriteOp,
} from '@core/components';
import {
  type Appointment,
  CLIENT_MONEY_DOC,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  Collections,
  QueryOp,
  Subcollections,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  PolicyReadPorts,
  QuerySpec,
  ReadTx,
} from '@core/ports';
import {
  type AttemptFailure,
  AttemptOutcome,
  BillingSystem,
  type BilledAppointment,
  type ClientStatsPaths,
  ClientStatsSystem,
  PolicyPassVerdict,
  PolicyRecomputeJobSystem,
  StatsWriteDecision,
  type StoredClientStats,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `projectClientStats` — `clientStats/{customerId}` and its
 * `restricted/money` follow the appointments (R33, `recompute-client-stats.ts`,
 * `dispatch-client-projections.ts`, blueprint §4.1), keyed by the CLIENT
 * RECORD (D29). Each client is recomputed ON ITS OWN, in its own
 * transaction: the history query (`subjectCustomerIds array-contains`,
 * #19), the stored pair, then the pure decision — the policy-pass guard
 * (`judgePolicyPass`: a NEWER pass's stamp wins and nothing is written), the
 * projection clock (never earlier than the stored answer's), the stats and
 * the spend, and the revision guard (`ClientStatsSystem.planWrite`): two
 * `Set`s at one version, the stamp's restamp `Update` alone, or nothing.
 * State-based, so a redelivered event, a backfill and the trigger all
 * converge on the same bytes.
 *
 * One person's failure never costs the rest of the party their recompute:
 * each failure is collected and the attempt's verdict is the edge's to act
 * on (`attemptFailure`: transient when any one is — the redelivery that one
 * earns re-runs them all, state-based). This file also holds the per-client
 * recompute the policy pass and the backfill walk with
 * ({@link recomputeClients}), and the edge's reading of a port's failure
 * ({@link repositoryFailure}).
 */

/** Which clients an appointment write can have moved — before ∪ after, decoded at the edge. */
export type ProjectClientStatsCommand = {
  readonly customerIds: readonly CustomerId[];
};

/** What recomputing a set of clients came to. */
export type ClientStatsProjection = {
  /** Clients whose answer changed and was written. */
  readonly written: number;
  /** One per client whose recompute failed — never one person's failure for another's. */
  readonly failures: readonly unknown[];
  /** The attempt's verdict over them (`decisiveFailure`); `null` when nothing failed. */
  readonly attemptFailure: AttemptFailure | null;
};

/**
 * The ports one client's recompute reads. The shop's clock the windows and
 * the next visit are judged on is the caller's: each walk resolves the
 * default location's zone ONCE (Law 7.2, F-4 — no stats record names a
 * shop) and hands it to every client's recompute.
 */
export type ClientStatsRecomputePorts = CommitPorts & ClockPorts;

export type ProjectClientStatsPorts = ClientStatsRecomputePorts &
  PolicyReadPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  LogPorts;

/** How one client's recompute ended — the ONLY source of these strings, the field `statsOutcome`. */
export const ClientStatsOutcome = {
  /** The answer changed: both documents written at a new version. */
  Written: 'WRITTEN',
  /** The same answer (perhaps with the newer pass's stamp moved onto it). */
  Unchanged: 'UNCHANGED',
  /** A NEWER policy pass has judged this client: nothing written. */
  Superseded: 'SUPERSEDED',
} as const;
export type ClientStatsOutcome =
  (typeof ClientStatsOutcome)[keyof typeof ClientStatsOutcome];

/** One client's read set: every appointment they have a seat on, and the stored pair. */
export type ClientStatsSnapshot = {
  readonly history: readonly Appointment[];
  readonly stats: ClientStatsRecord | null;
  readonly money: ClientMoneyRecord | null;
};

/** Where one client's pair lives. */
export function clientStatsPaths(customerId: CustomerId): ClientStatsPaths {
  return {
    stats: [Collections.ClientStats, customerId],
    money: [
      Collections.ClientStats,
      customerId,
      Subcollections.Restricted,
      CLIENT_MONEY_DOC,
    ],
  };
}

/** Every appointment a client record holds a seat on (#19 — the mirror needs no composite here). */
export function clientHistory(customerId: CustomerId): QuerySpec {
  return {
    collection: [Collections.Appointments],
    where: [
      {
        field: 'subjectCustomerIds',
        op: QueryOp.ArrayContains,
        value: customerId,
      },
    ],
    orderBy: [],
    limit: null,
  };
}

/** One client's read set, in one round trip of the transaction. */
export async function readClientStats(
  tx: ReadTx,
  customerId: CustomerId,
): Promise<ClientStatsSnapshot> {
  const paths = clientStatsPaths(customerId);
  const [history, stored] = await Promise.all([
    tx.query<Appointment>(clientHistory(customerId)),
    tx.getAll<ClientStatsRecord | ClientMoneyRecord>([
      paths.stats,
      paths.money,
    ]),
  ]);
  return {
    history,
    stats: (stored[0] ?? null) as ClientStatsRecord | null,
    money: (stored[1] ?? null) as ClientMoneyRecord | null,
  };
}

/** The stored pair as the revision guard compares it. */
function storedOf(snapshot: ClientStatsSnapshot): StoredClientStats {
  return {
    statsPresent: snapshot.stats !== null,
    moneyPresent: snapshot.money !== null,
    stats: snapshot.stats,
    money: snapshot.money,
    statsVersion: snapshot.stats === null ? null : snapshot.stats.version,
    moneyVersion: snapshot.money === null ? null : snapshot.money.version,
  };
}

/**
 * Both projections of one history at `now`: the statistics over every visit,
 * the spend over the visits with a bill (`BillingSystem`: the seats less the
 * discounts — vouchers are a way of paying, tips never the shop's price). A
 * visit whose seats have no bill (none, or mixed currencies) is left out of
 * the spend, never guessed at.
 */
export function clientStatsOf(
  customerId: CustomerId,
  history: readonly Appointment[],
  policy: ClientStatsPolicy,
  now: ShopNow,
): { readonly stats: ClientStats; readonly money: ClientMoneyStats } {
  const billed: BilledAppointment<Seat>[] = [];
  for (const appointment of history) {
    const subtotal = BillingSystem.subtotalOf(appointment.seats);
    if (!subtotal.ok) continue;
    const total = BillingSystem.totalOf(subtotal.value, appointment.discounts);
    billed.push({
      ...appointment,
      bill: {
        subtotalCents: subtotal.value.amountCents,
        totalCents: total.amountCents,
        currency: subtotal.value.currency,
      },
    });
  }
  return {
    stats: ClientStatsSystem.stats(customerId, history, policy, now),
    money: ClientStatsSystem.money(customerId, billed),
  };
}

/**
 * The pure decision of one client's recompute over its read set: the pass
 * guard, the projection clock, the answer, the revision guard. May run more
 * than once (the transaction retries on contention).
 */
export function decideClientStats(
  customerId: CustomerId,
  snapshot: ClientStatsSnapshot,
  policy: ClientStatsPolicy,
  pass: PolicyPass | null,
  clockUtcMs: UtcEpochMs,
  timeZone: TimeZone,
): {
  readonly outcome: ClientStatsOutcome;
  readonly writes: readonly WriteOp[];
} {
  // A newer pass has judged this client since this one loaded its policy:
  // its answer stands. Decided here, inside the transaction that would
  // write, so the store serialises the two passes' writes.
  const verdict = PolicyRecomputeJobSystem.judgePolicyPass(
    pass,
    snapshot.stats === null ? null : PolicyPassStamp.read(snapshot.stats),
  );
  if (verdict.policyPassVerdict === PolicyPassVerdict.Superseded) {
    return { outcome: ClientStatsOutcome.Superseded, writes: [] };
  }
  const nowUtcMs = ClientStatsSystem.projectionClock(
    clockUtcMs,
    snapshot.stats === null ? null : snapshot.stats.updatedAtUtcMs,
  );
  const { stats, money } = clientStatsOf(
    customerId,
    snapshot.history,
    policy,
    ZonedTimeSystem.shopNow(nowUtcMs, timeZone),
  );
  const plan = ClientStatsSystem.planWrite(
    {
      customerId,
      stored: storedOf(snapshot),
      stats,
      money,
      hasHistory: snapshot.history.length > 0,
      nowUtcMs,
      stamp: verdict.stamp,
      restamp: verdict.restamp,
    },
    clientStatsPaths(customerId),
  );
  return {
    outcome:
      plan.statsWriteDecision === StatsWriteDecision.Write
        ? ClientStatsOutcome.Written
        : ClientStatsOutcome.Unchanged,
    writes: plan.writes,
  };
}

/**
 * ONE client's recompute, in its own transaction — the policy and the shop's
 * zone are the caller's (read once per call, never per client), `pass` the
 * policy pass doing it (`null` for every other writer, which carries the
 * stored stamp forward). An infrastructure failure rejects.
 */
export async function recomputeClientStats(
  ports: ClientStatsRecomputePorts,
  policy: ClientStatsPolicy,
  customerId: CustomerId,
  pass: PolicyPass | null,
  timeZone: TimeZone,
): Promise<Result<ClientStatsOutcome, RepositoryError>> {
  const clockUtcMs = ports.nowUtcMs();
  const committed = await ports.commit(
    (tx) => readClientStats(tx, customerId),
    (
      snapshot,
    ): Result<
      {
        readonly outcome: ClientStatsOutcome;
        readonly writes: readonly WriteOp[];
      },
      never
    > =>
      Result.ok(
        decideClientStats(
          customerId,
          snapshot,
          policy,
          pass,
          clockUtcMs,
          timeZone,
        ),
      ),
  );
  return committed.ok ? Result.ok(committed.value.outcome) : committed;
}

/**
 * A port's refusal as the retrying edge judges it: by the canonical code the
 * adapter recorded as its `reason` (`unavailable`, `aborted`, …), else
 * `unknown` — a failure no redelivery is known to fix.
 */
export function repositoryFailure(error: RepositoryError): AttemptFailure {
  return TriggerAttemptSystem.attemptFailure(
    error,
    TriggerAttemptSystem.failureCode({ code: error.reason ?? '' }),
  );
}

/** A failure as the attempt verdict reads it — a port's refusal by its reason, a throw as thrown. */
function failureOf(failure: unknown): AttemptFailure {
  return isRepositoryError(failure)
    ? repositoryFailure(failure)
    : TriggerAttemptSystem.attemptFailure(failure);
}

function isRepositoryError(value: unknown): value is RepositoryError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'errorCode' in value &&
    'path' in value &&
    'reason' in value
  );
}

/**
 * The verdict over several INDEPENDENT failures (`decisiveFailure`):
 * transient when any one is, else the first; `null` when none failed.
 */
export function decisiveAttemptFailure(
  failures: readonly unknown[],
): AttemptFailure | null {
  let first: AttemptFailure | null = null;
  for (const failure of failures) {
    const judged = failureOf(failure);
    if (judged.attemptOutcome === AttemptOutcome.Transient) return judged;
    first ??= judged;
  }
  return first;
}

/**
 * Recompute each of `customerIds` ON ITS OWN, `width` at a time (1 for the
 * people of one party, who share the appointment's rows and would only
 * contend), on the shop's clock `timeZone`, and report what was written and
 * what failed.
 */
export async function recomputeClients(
  ports: ClientStatsRecomputePorts,
  policy: ClientStatsPolicy,
  customerIds: readonly CustomerId[],
  pass: PolicyPass | null,
  width: number,
  timeZone: TimeZone,
): Promise<ClientStatsProjection> {
  const failures: unknown[] = [];
  let written = 0;
  const size = Math.max(1, Math.floor(width));
  for (let start = 0; start < customerIds.length; start += size) {
    const outcomes = await Promise.all(
      customerIds.slice(start, start + size).map(async (customerId) => {
        try {
          const outcome = await recomputeClientStats(
            ports,
            policy,
            customerId,
            pass,
            timeZone,
          );
          if (!outcome.ok) failures.push(outcome.error);
          return outcome.ok ? outcome.value : null;
        } catch (error) {
          failures.push(error);
          return null;
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome === ClientStatsOutcome.Written) written += 1;
    }
  }
  return {
    written,
    failures,
    attemptFailure: decisiveAttemptFailure(failures),
  };
}

export const projectClientStats =
  (ports: ProjectClientStatsPorts) =>
  async (
    cmd: ProjectClientStatsCommand,
  ): Promise<Result<ClientStatsProjection, RepositoryError>> => {
    if (cmd.customerIds.length === 0) {
      return Result.ok({ written: 0, failures: [], attemptFailure: null });
    }
    // The policy and the shop's clock are every client's: read once,
    // outside every transaction — a stats record names no shop, so the clock
    // is the default location's (F-4); a zone that cannot be read is the
    // store failure the edge already answers (4A-2 (e)).
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    return Result.ok(
      await recomputeClients(
        ports,
        ClientStatsPolicy.forBooking(policy.value),
        cmd.customerIds,
        null,
        1,
        zone.value,
      ),
    );
  };
