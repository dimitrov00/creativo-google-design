import { BarberPrefKind } from '../components/barber-pref.data';
import { ClientStatsPolicy } from '../components/client-stats-policy.data';
import type {
  ClientMoneyStats,
  ClientStats,
  ClientStatsMeta,
  PauseSuggestion,
  PolicyPass,
  VisitFact,
  VisitLeg,
  VisitRef,
} from '../components/client-stats.data';
import { Currency, type Money } from '../components/money.data';
import type { PlacementKind } from '../components/placement-kind.data';
import {
  CancellationReason,
  CancelledBy,
  type SeatOutcome,
  SeatOutcomeKind,
} from '../components/seat-outcome.data';
import { type Seat, SeatSubjectKind } from '../components/seat.data';
import { type DocPath, WriteOp } from '../components/write-op.data';
import type {
  AppointmentEntity,
  AppointmentId,
} from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';

/**
 * One client's statistics, from every appointment they have a seat on
 * (`libs/domain/scheduling/src/lib/client-stats.ts:16-615`), and the pure
 * half of the projection that keeps `clientStats/{uid}` current
 * (`apps/functions/src/lib/clients/client-stats-projection.ts:21-231`, hot
 * path #8): which writes can move anybody's stats, whom they concern, and
 * whether a recomputed answer is worth a write.
 *
 * State-based: the same appointments and clock give the same answer in any
 * order, which is what lets the trigger, the backfill and the seed all call
 * it and agree. Counts are per VISIT per subject (R33): a party of three is
 * three visits, a cut and a beard for one client is one, and other people's
 * seats on the same appointment never touch this person's numbers.
 */

const DAY_MS = 86_400_000;

/** The fixed rate BGN retired at (2026): legacy seats priced in leva count in euro. */
const BGN_PER_EUR = 1.95583;

/** The one legacy currency with an honest fixed rate — read only here. */
const LEGACY_LEVA = 'BGN';

/** The counter windows a reader shows, in days (R35). */
const LAST_12M_DAYS = 365;
const LAST_90D_DAYS = 90;

/**
 * One appointment as the statistics read it — the slice of the entity they
 * may read (R28). `placement` is the COMMIT's own stamp; the backfill's
 * `inferredPlacement` is deliberately not in it (§12.5.1).
 */
export type StatsAppointment = Pick<
  AppointmentEntity,
  'id' | 'timeInterval' | 'bookedAtMs' | 'placement' | 'seats'
>;

/**
 * What the party owes before and after its discounts — `BillingSystem`'s
 * answer, handed in: spend is net of discounts, and the discount evaluator
 * is not this module's to repeat.
 */
export type AppointmentBill = {
  readonly subtotal: Money;
  readonly total: Money;
};

/** An appointment with its bill — what the spend reads. */
export type BilledAppointment = StatsAppointment & {
  readonly bill: AppointmentBill;
};

/** What one appointment was, for one person — the ONLY source of these strings. */
export const SubjectVisitOutcomeKind = {
  Worked: 'worked',
  NoShow: 'no_show',
  Cancelled: 'cancelled',
  Open: 'open',
} as const;
export type SubjectVisitOutcomeKind =
  (typeof SubjectVisitOutcomeKind)[keyof typeof SubjectVisitOutcomeKind];

export type SubjectVisitOutcome =
  | { readonly kind: typeof SubjectVisitOutcomeKind.Worked }
  | { readonly kind: typeof SubjectVisitOutcomeKind.NoShow }
  | {
      readonly kind: typeof SubjectVisitOutcomeKind.Cancelled;
      /** The seat called off LAST — the cancellation that ended the visit. */
      readonly decisive: SeatOutcome.Cancelled;
    }
  | { readonly kind: typeof SubjectVisitOutcomeKind.Open };

/** One appointment as one person's visit: their seats, its span, their outcome. */
export type SubjectVisit<A extends StatsAppointment = StatsAppointment> = {
  readonly appointment: A;
  /** Only this person's seats, in seat order — the input's own structs. */
  readonly seats: readonly Seat[];
  readonly atMs: number;
  readonly endMs: number;
  readonly outcome: SubjectVisitOutcome;
};

/** Who a cancellation is on, when an outcome correction said so (P4, R49). */
export const CancellationAttribution = {
  Client: 'client',
  Shop: 'shop',
} as const;
export type CancellationAttribution =
  (typeof CancellationAttribution)[keyof typeof CancellationAttribution];

export type WindowedCount = {
  readonly lifetime: number;
  readonly last12m: number;
  readonly last90d: number;
};

export type StatWindows = {
  readonly visitsCompleted: WindowedCount;
  readonly noShows: WindowedCount;
  readonly lateCancels: WindowedCount;
};

/** One seat as the change detection reads it — every field a stat can read, nothing else. */
export type StatsInputSeat = {
  readonly id: string;
  readonly subject: {
    readonly kind: string;
    readonly userId: UserId | null;
  };
  readonly outcome: SeatOutcome;
  readonly startMs: number;
  readonly terms: {
    readonly priceMinorUnits: number;
    readonly currencyCode: string;
    readonly durationMinutes: number;
  };
  readonly serviceId: ServiceId;
  readonly variantId: string | null;
  readonly barberId: BarberId;
  readonly barberPref: BarberPrefKind | null;
};

/**
 * The slice of a stored appointment the statistics and the spend can read —
 * so the only fields whose change can move anybody's stats (§13 R28). An
 * arrival, a tip, a contact or a voucher changes none of it, and those are
 * most of the writes an appointment ever sees.
 */
export type StatsInput = {
  readonly bookingStatus: AppointmentEntity['bookingStatus'];
  readonly bookedAtMs: number | null;
  readonly discounts: AppointmentEntity['discounts'];
  readonly placement: PlacementKind | null;
  readonly seats: readonly StatsInputSeat[];
};

/** What the stored pair is, as the revision guard compares it. */
export type StoredClientStats = {
  /** Is there a stats document at all — one that no longer parses counts. */
  readonly statsPresent: boolean;
  readonly moneyPresent: boolean;
  /** Each parsed with its bookkeeping; `null` when absent or unparseable. */
  readonly stats: (ClientStats & ClientStatsMeta) | null;
  readonly money: (ClientMoneyStats & ClientStatsMeta) | null;
  /** Each document's stored version even when the rest does not parse — never go backwards. */
  readonly statsVersion: number | null;
  readonly moneyVersion: number | null;
};

export type ClientStatsWriteInput = {
  readonly stored: StoredClientStats;
  readonly stats: ClientStats;
  readonly money: ClientMoneyStats;
  /** False for a person with no appointment left at all. */
  readonly hasHistory: boolean;
  readonly nowMs: number;
  /** The pass stamp the written stats document carries (the pass guard's verdict). */
  readonly stamp: PolicyPass | null;
  /** The stored stamp must move even when the answer is unchanged. */
  readonly restamp: boolean;
};

/** Where the pair lives — the caller's, from the collection registry. */
export type ClientStatsPaths = {
  readonly stats: DocPath;
  readonly money: DocPath;
};

/** The revision guard's verdict tags — the ONLY source of these strings. */
export const ClientStatsWriteKind = {
  Unchanged: 'unchanged',
  Write: 'write',
} as const;
export type ClientStatsWriteKind =
  (typeof ClientStatsWriteKind)[keyof typeof ClientStatsWriteKind];

export type ClientStatsWritePlan =
  | {
      readonly kind: typeof ClientStatsWriteKind.Unchanged;
      /** Nothing, or the stamp's move alone. */
      readonly writes: readonly WriteOp[];
    }
  | {
      readonly kind: typeof ClientStatsWriteKind.Write;
      readonly version: number;
      readonly updatedAtMs: number;
      /** Both documents, at one version. */
      readonly writes: readonly WriteOp[];
    };

const WORKED: SubjectVisitOutcome = { kind: SubjectVisitOutcomeKind.Worked };
const NO_SHOW: SubjectVisitOutcome = { kind: SubjectVisitOutcomeKind.NoShow };
const OPEN: SubjectVisitOutcome = { kind: SubjectVisitOutcomeKind.Open };

/**
 * The person's own story of one appointment, from their seats alone. Any
 * worked seat makes it a visit; otherwise an open seat keeps it open, and a
 * no-show beats cancellations. A fully cancelled visit is decided by the
 * seat called off LAST.
 */
function outcomeOf(seats: readonly Seat[]): SubjectVisitOutcome {
  let open = false;
  let noShow = false;
  let decisive: SeatOutcome.Cancelled | null = null;
  for (let i = 0; i < seats.length; i++) {
    const outcome = (seats[i] as Seat).outcome;
    switch (outcome.kind) {
      case SeatOutcomeKind.Worked:
        return WORKED;
      case SeatOutcomeKind.Scheduled:
        open = true;
        break;
      case SeatOutcomeKind.NoShow:
        noShow = true;
        break;
      case SeatOutcomeKind.Cancelled:
        if (decisive === null || outcome.atMs > decisive.atMs) {
          decisive = outcome;
        }
        break;
    }
  }
  if (open) return OPEN;
  if (noShow) return NO_SHOW;
  // Seats are non-empty, so a visit that reaches here was cancelled.
  return decisive === null
    ? OPEN
    : { kind: SubjectVisitOutcomeKind.Cancelled, decisive };
}

/** Oldest first, the id breaking ties — so input order never shows in the output. */
function chronological(a: SubjectVisit, b: SubjectVisit): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  const x = a.appointment.id;
  const y = b.appointment.id;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Every appointment this person has a seat on, as their visits, oldest
 * first. An appointment listed twice counts once: the unit is the visit,
 * and a caller merging two reads must not be able to double it.
 */
function visitsOf<A extends StatsAppointment>(
  subject: UserId,
  appointments: readonly A[],
): SubjectVisit<A>[] {
  const seen = new Set<string>();
  const visits: SubjectVisit<A>[] = [];
  for (let i = 0; i < appointments.length; i++) {
    const appointment = appointments[i] as A;
    if (seen.has(appointment.id)) continue;
    seen.add(appointment.id);
    const visit = ClientStatsSystem.subjectVisitOf(subject, appointment);
    if (visit !== null) visits.push(visit);
  }
  return visits.sort(chronological);
}

function factOf(visit: SubjectVisit): VisitFact {
  return { appointmentId: visit.appointment.id, atMs: visit.atMs };
}

/** A visit as a reader shows it, from the seats whose outcome is `keep`. */
function refOf(visit: SubjectVisit, keep: SeatOutcomeKind): VisitRef {
  const serviceIds: ServiceId[] = [];
  const barberIds: BarberId[] = [];
  const legs: VisitLeg[] = [];
  for (let i = 0; i < visit.seats.length; i++) {
    const seat = visit.seats[i] as Seat;
    if (seat.outcome.kind !== keep) continue;
    if (!serviceIds.includes(seat.serviceId)) serviceIds.push(seat.serviceId);
    if (!barberIds.includes(seat.barberId)) barberIds.push(seat.barberId);
    legs.push({
      seatId: seat.id,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      minutes: seat.terms.durationMinutes,
    });
  }
  return {
    appointmentId: visit.appointment.id,
    atMs: visit.atMs,
    serviceIds,
    barberIds,
    legs,
  };
}

/**
 * R34: the mean gap between consecutive worked visits, once there are
 * three. A gap the SHOP stretched — a visit it cancelled falls inside it —
 * says nothing about the client's rhythm and is left out. Both lists are
 * oldest first, so one pointer walks the shop's cancellations once.
 */
function cadenceOf(
  worked: readonly SubjectVisit[],
  shopCancelled: readonly SubjectVisit[],
): number | null {
  if (worked.length < 3) return null;
  let total = 0;
  let gaps = 0;
  let j = 0;
  for (let i = 1; i < worked.length; i++) {
    const from = (worked[i - 1] as SubjectVisit).atMs;
    const to = (worked[i] as SubjectVisit).atMs;
    while (
      j < shopCancelled.length &&
      (shopCancelled[j] as SubjectVisit).atMs <= from
    ) {
      j++;
    }
    const stretched =
      j < shopCancelled.length && (shopCancelled[j] as SubjectVisit).atMs < to;
    if (stretched) continue;
    total += to - from;
    gaps++;
  }
  if (gaps === 0) return null;
  const meanDays = total / gaps / DAY_MS;
  // One decimal: enough for "every ~4 weeks", and a stable number to store.
  return Math.round(meanDays * 10) / 10;
}

type Tally<K> = {
  readonly id: K;
  readonly count: number;
  readonly rank: number;
};

/** One more sighting of `id` at `rank` (0 = most recent); the first rank seen is kept. */
function count<K extends string>(
  tally: Map<K, Tally<K>>,
  id: K,
  rank: number,
): void {
  const entry = tally.get(id);
  tally.set(
    id,
    entry === undefined
      ? { id, count: 1, rank }
      : { id, count: entry.count + 1, rank: entry.rank },
  );
}

/** Ids seen at least `min` times — most frequent, then most recent, then by id. */
function frequent<K extends string>(
  tally: ReadonlyMap<K, Tally<K>>,
  min: number,
): K[] {
  const qualifying: Tally<K>[] = [];
  for (const entry of tally.values()) {
    if (entry.count >= min) qualifying.push(entry);
  }
  qualifying.sort(
    (a, b) => b.count - a.count || a.rank - b.rank || (a.id < b.id ? -1 : 1),
  );
  const ids: K[] = [];
  for (let i = 0; i < qualifying.length; i++) {
    ids.push((qualifying[i] as Tally<K>).id);
  }
  return ids;
}

/**
 * The barber this client ASKS FOR: named (`specific`) on at least two of
 * their last three visits, and only on a visit its commit stamped — a
 * phone booking into whichever chair was free is no evidence, and a row the
 * commit did not stamp was written by the path that defaulted an omitted
 * preference to `specific` (§11.2 #6, §12.5.1). Such a visit still takes its
 * place among the last three. Two qualifying names go to the one asked for
 * most recently.
 */
function preferredBarberOf(worked: readonly SubjectVisit[]): BarberId | null {
  const tally = new Map<BarberId, Tally<BarberId>>();
  const last = Math.min(3, worked.length);
  for (let rank = 0; rank < last; rank++) {
    const visit = worked[worked.length - 1 - rank] as SubjectVisit;
    if (visit.appointment.placement === null) continue;
    const asked: BarberId[] = [];
    for (let i = 0; i < visit.seats.length; i++) {
      const seat = visit.seats[i] as Seat;
      if (
        seat.outcome.kind === SeatOutcomeKind.Worked &&
        seat.barberPref === BarberPrefKind.Specific &&
        !asked.includes(seat.barberId)
      ) {
        asked.push(seat.barberId);
      }
    }
    for (let i = 0; i < asked.length; i++) {
      count(tally, asked[i] as BarberId, rank);
    }
  }
  return frequent(tally, 2)[0] ?? null;
}

/** Services on ≥ 3 of the last 5 visits — most frequent, then most recent, first. */
function usualServicesOf(worked: readonly SubjectVisit[]): ServiceId[] {
  const tally = new Map<ServiceId, Tally<ServiceId>>();
  const last = Math.min(5, worked.length);
  for (let rank = 0; rank < last; rank++) {
    const visit = worked[worked.length - 1 - rank] as SubjectVisit;
    const services: ServiceId[] = [];
    for (let i = 0; i < visit.seats.length; i++) {
      const seat = visit.seats[i] as Seat;
      if (
        seat.outcome.kind === SeatOutcomeKind.Worked &&
        !services.includes(seat.serviceId)
      ) {
        services.push(seat.serviceId);
      }
    }
    for (let i = 0; i < services.length; i++) {
      count(tally, services[i] as ServiceId, rank);
    }
  }
  return frequent(tally, 3);
}

function isWithin(fact: VisitFact, nowMs: number, days: number): boolean {
  return fact.atMs <= nowMs && nowMs - fact.atMs < days * DAY_MS;
}

function countWithin(
  facts: readonly VisitFact[],
  nowMs: number,
  days: number,
): number {
  let n = 0;
  for (let i = 0; i < facts.length; i++) {
    if (isWithin(facts[i] as VisitFact, nowMs, days)) n++;
  }
  return n;
}

/** The facts of `visits` newer than `horizonMs`, oldest first. */
function boundedFacts(
  visits: readonly SubjectVisit[],
  horizonMs: number,
): VisitFact[] {
  const facts: VisitFact[] = [];
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i] as SubjectVisit;
    if (visit.atMs > horizonMs) facts.push(factOf(visit));
  }
  return facts;
}

/** Minor units of a legacy currency in EUR, or `null` when there is no honest rate. */
function inEuroMinor(minor: number, currencyCode: string): number | null {
  if (currencyCode === Currency.EUR) return minor;
  if (currencyCode === LEGACY_LEVA) return Math.round(minor / BGN_PER_EUR);
  return null;
}

function statsOf(
  subject: UserId,
  visits: readonly SubjectVisit[],
  policy: ClientStatsPolicy,
  nowMs: number,
): ClientStats {
  const worked: SubjectVisit[] = [];
  const noShows: SubjectVisit[] = [];
  const clientCancels: SubjectVisit[] = [];
  const shopCancelled: SubjectVisit[] = [];
  const lateCancels: SubjectVisit[] = [];
  let next: SubjectVisit | null = null;
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i] as SubjectVisit;
    const outcome = visit.outcome;
    switch (outcome.kind) {
      case SubjectVisitOutcomeKind.Worked:
        worked.push(visit);
        break;
      case SubjectVisitOutcomeKind.NoShow:
        noShows.push(visit);
        break;
      case SubjectVisitOutcomeKind.Open:
        if (next === null && visit.endMs > nowMs) next = visit;
        break;
      case SubjectVisitOutcomeKind.Cancelled:
        if (!ClientStatsSystem.clientCaused(outcome.decisive)) {
          shopCancelled.push(visit);
          break;
        }
        clientCancels.push(visit);
        // A late cancel needs a trustworthy lead time: a row with no
        // booking instant (its outcome instant derived) is never late.
        if (
          visit.appointment.bookedAtMs !== null &&
          ClientStatsPolicy.isLateCancellation(
            policy,
            visit.atMs,
            outcome.decisive.atMs,
            outcome.decisive.windowHours,
          )
        ) {
          lateCancels.push(visit);
        }
        break;
    }
  }

  const horizonMs = nowMs - ClientStatsPolicy.BOUNDED_DAYS * DAY_MS;
  const last = worked[worked.length - 1];
  const recentNoShows = boundedFacts(noShows, horizonMs);

  return {
    userId: subject,
    lifetime: {
      visitsCompleted: worked.length,
      noShows: noShows.length,
      lateCancels: lateCancels.length,
      clientCancels: clientCancels.length,
    },
    last365: {
      visitsCompleted: boundedFacts(worked, horizonMs),
      noShows: recentNoShows,
      lateCancels: boundedFacts(lateCancels, horizonMs),
    },
    firstVisitAtMs: worked[0]?.atMs ?? null,
    lastVisit: last === undefined ? null : refOf(last, SeatOutcomeKind.Worked),
    nextVisit: next === null ? null : refOf(next, SeatOutcomeKind.Scheduled),
    avgCadenceDays: cadenceOf(worked, shopCancelled),
    preferredBarberId: preferredBarberOf(worked),
    usualServiceIds: usualServicesOf(worked),
    pauseSuggestion: ClientStatsSystem.pauseSuggestionAt(
      recentNoShows,
      nowMs,
      policy,
    ),
  };
}

function moneyOf(
  subject: UserId,
  visits: readonly SubjectVisit<BilledAppointment>[],
): ClientMoneyStats {
  let spend = 0;
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i] as SubjectVisit<BilledAppointment>;
    if (visit.outcome.kind !== SubjectVisitOutcomeKind.Worked) continue;
    let own = 0;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as Seat;
      if (seat.outcome.kind === SeatOutcomeKind.Worked) {
        own += seat.terms.priceMinorUnits;
      }
    }
    const { subtotal, total } = visit.appointment.bill;
    const gross = subtotal.amountMinorUnits;
    const net =
      gross > 0 ? Math.round((own * total.amountMinorUnits) / gross) : 0;
    spend += inEuroMinor(net, subtotal.currencyCode) ?? 0;
  }
  return {
    userId: subject,
    lifetimeSpend: { amountMinorUnits: spend, currencyCode: Currency.EUR },
  };
}

/** The projection's CONTENT — everything but the bookkeeping and the stamp. */
function statsContent(stats: ClientStats): ClientStats {
  return {
    userId: stats.userId,
    lifetime: stats.lifetime,
    last365: stats.last365,
    firstVisitAtMs: stats.firstVisitAtMs,
    lastVisit: stats.lastVisit,
    nextVisit: stats.nextVisit,
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId: stats.preferredBarberId,
    usualServiceIds: stats.usualServiceIds,
    pauseSuggestion: stats.pauseSuggestion,
  };
}

function moneyContent(money: ClientMoneyStats): ClientMoneyStats {
  return { userId: money.userId, lifetimeSpend: money.lifetimeSpend };
}

function seatInputOf(seat: Seat): StatsInputSeat {
  const subject = seat.subject;
  return {
    id: seat.id,
    subject: {
      kind: subject.kind,
      userId: subject.kind === SeatSubjectKind.Account ? subject.userId : null,
    },
    outcome: seat.outcome,
    startMs: seat.startMs,
    terms: {
      priceMinorUnits: seat.terms.priceMinorUnits,
      currencyCode: seat.terms.currencyCode,
      durationMinutes: seat.terms.durationMinutes,
    },
    serviceId: seat.serviceId,
    variantId: seat.variantId,
    barberId: seat.barberId,
    barberPref: seat.barberPref,
  };
}

export const ClientStatsSystem = {
  BGN_PER_EUR,

  /**
   * Does this cancellation count against the client (R33, §11)? The reason
   * decides when it names a side; otherwise the side that did the
   * cancelling does — the client's own cancel path files `unspecified` with
   * `by: client`, and reading the reason alone would let every self-service
   * cancellation off. A converted no-show takes the correction's
   * attribution, and with none recorded it is held against nobody. The same
   * predicate excuses shop-caused gaps in the cadence.
   */
  clientCaused(
    cancellation: Pick<SeatOutcome.Cancelled, 'by' | 'reason'>,
    attribution: CancellationAttribution | null = null,
  ): boolean {
    switch (cancellation.reason.kind) {
      case CancellationReason.StaffBarberAbsence:
      case CancellationReason.StaffShopClosure:
        return false;
      case CancellationReason.NoShowConverted:
        return attribution === CancellationAttribution.Client;
      case CancellationReason.ClientChangedPlans:
      case CancellationReason.ClientUnwell:
        return true;
      case CancellationReason.Unspecified:
      case CancellationReason.Other:
        return cancellation.by === CancelledBy.Client;
    }
  },

  /**
   * One appointment as this person's visit, from their seats alone — `null`
   * when they hold no seat on it. The same reading the statistics count by,
   * so a history row and the counts above it never tell two stories.
   */
  subjectVisitOf<A extends StatsAppointment>(
    subject: UserId,
    appointment: A,
  ): SubjectVisit<A> | null {
    const seats: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (
        seat.subject.kind === SeatSubjectKind.Account &&
        seat.subject.userId === subject
      ) {
        seats.push(seat);
      }
    }
    if (seats.length === 0) return null;
    return {
      appointment,
      seats,
      atMs: appointment.timeInterval.startMs,
      endMs: appointment.timeInterval.endMs,
      outcome: outcomeOf(seats),
    };
  },

  /**
   * One client's stats as of `nowMs`. A late cancel is judged by the window
   * stamped on the deciding seat — the rule in force when the client
   * cancelled — so a later policy change re-judges nothing; only a
   * cancellation recorded before the stamp falls back to `policy`'s current
   * window. Only the last `ClientStatsPolicy.BOUNDED_DAYS` keep instants.
   */
  stats(
    subject: UserId,
    appointments: readonly StatsAppointment[],
    policy: ClientStatsPolicy,
    nowMs: number,
  ): ClientStats {
    return statsOf(subject, visitsOf(subject, appointments), policy, nowMs);
  },

  /**
   * Lifetime spend over worked visits (R33, §12.5.2): the person's own
   * worked seats, less their pro-rata share of the visit's discounts.
   * Vouchers are a way of PAYING and tips were never the shop's price, so
   * neither moves it. A legacy leva price converts at the fixed rate; a
   * price in a currency with no fixed rate is left out, never guessed at.
   */
  money(
    subject: UserId,
    appointments: readonly BilledAppointment[],
  ): ClientMoneyStats {
    return moneyOf(subject, visitsOf(subject, appointments));
  },

  /** Both projections of one history, read once. */
  compute(
    subject: UserId,
    appointments: readonly BilledAppointment[],
    policy: ClientStatsPolicy,
    nowMs: number,
  ): { readonly stats: ClientStats; readonly money: ClientMoneyStats } {
    const visits = visitsOf(subject, appointments);
    return {
      stats: statsOf(subject, visits, policy, nowMs),
      money: moneyOf(subject, visits),
    };
  },

  /**
   * The pause suggestion as of `nowMs`, from no-shows alone (R25) — a
   * SUGGESTION, never a pause. Cheap, so a reader re-checks the stored one
   * against its own clock: a basis that aged out of the window is gone
   * without a write. `dismissedAtMs` is the desk's «Не сега»; it holds
   * until a newer no-show raises the suggestion again (R49).
   */
  pauseSuggestionAt(
    noShows: readonly VisitFact[],
    nowMs: number,
    policy: ClientStatsPolicy = ClientStatsPolicy.DEFAULT,
    dismissedAtMs: number | null = null,
  ): PauseSuggestion | null {
    const basis: VisitFact[] = [];
    for (let i = 0; i < noShows.length; i++) {
      const fact = noShows[i] as VisitFact;
      if (isWithin(fact, nowMs, policy.suggestPauseWindowDays))
        basis.push(fact);
    }
    if (basis.length < policy.suggestPauseNoShows) return null;
    basis.sort(
      (a, b) => a.atMs - b.atMs || (a.appointmentId < b.appointmentId ? -1 : 1),
    );
    const raisedAtMs = (basis[basis.length - 1] as VisitFact).atMs;
    if (dismissedAtMs !== null && dismissedAtMs >= raisedAtMs) return null;
    const ids: AppointmentId[] = [];
    for (let i = 0; i < basis.length; i++) {
      ids.push((basis[i] as VisitFact).appointmentId);
    }
    return {
      noShows: basis.length,
      windowDays: policy.suggestPauseWindowDays,
      basis: ids,
      raisedAtMs,
    };
  },

  /** The windows every counter reads, computed at read from the stored instants (R33). */
  statWindows(
    stats: Pick<ClientStats, 'lifetime' | 'last365'>,
    nowMs: number,
  ): StatWindows {
    const windowed = (
      lifetime: number,
      facts: readonly VisitFact[],
    ): WindowedCount => ({
      lifetime,
      last12m: countWithin(facts, nowMs, LAST_12M_DAYS),
      last90d: countWithin(facts, nowMs, LAST_90D_DAYS),
    });
    return {
      visitsCompleted: windowed(
        stats.lifetime.visitsCompleted,
        stats.last365.visitsCompleted,
      ),
      noShows: windowed(stats.lifetime.noShows, stats.last365.noShows),
      lateCancels: windowed(
        stats.lifetime.lateCancels,
        stats.last365.lateCancels,
      ),
    };
  },

  /** JSON with object keys sorted, so two equal values always print the same. */
  canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, raw: unknown) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return raw;
      }
      return Object.fromEntries(
        Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });
  },

  /**
   * The stats input of a stored appointment (§13 R28): the booking status,
   * the booking instant (the late-cancel rule), the discounts (spend is net
   * of them), the commit's placement (the preferred barber), and each
   * seat's subject, outcome, start, price, duration, service, barber and
   * preference. `null` for no appointment (a create's before, a delete's
   * after).
   */
  statsInputOf(appointment: AppointmentEntity | null): StatsInput | null {
    if (appointment === null) return null;
    const seats: StatsInputSeat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      seats.push(seatInputOf(appointment.seats[i] as Seat));
    }
    return {
      bookingStatus: appointment.bookingStatus,
      bookedAtMs: appointment.bookedAtMs,
      discounts: appointment.discounts,
      placement: appointment.placement,
      seats,
    };
  },

  /** Did this write change anything a client's stats are computed from? */
  statsInputChanged(
    before: AppointmentEntity | null,
    after: AppointmentEntity | null,
  ): boolean {
    return (
      ClientStatsSystem.canonicalJson(
        ClientStatsSystem.statsInputOf(before),
      ) !==
      ClientStatsSystem.canonicalJson(ClientStatsSystem.statsInputOf(after))
    );
  },

  /**
   * Everyone whose stats a write can have moved: the people on the visit
   * before AND after it — a person removed from a party must lose the
   * visit, which only a recompute of THEIR stats does. Distinct, sorted.
   */
  affectedSubjects<K extends string>(
    before: readonly K[],
    after: readonly K[],
  ): readonly K[] {
    const all = new Set<K>(before);
    for (let i = 0; i < after.length; i++) all.add(after[i] as K);
    return [...all].sort();
  },

  /**
   * Who placed each stored appointment, as its COMMIT stamped it. A row the
   * commit did not stamp is left out, which the preferred barber reads as
   * no evidence (§12.5.1) — an inferred placement never reaches here.
   */
  placementsFrom(
    rows: readonly {
      readonly id: string;
      readonly placement: PlacementKind | null;
    }[],
  ): ReadonlyMap<string, PlacementKind> {
    const placements = new Map<string, PlacementKind>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as (typeof rows)[number];
      if (row.placement !== null) placements.set(row.id, row.placement);
    }
    return placements;
  },

  /**
   * The clock a recompute reads: never earlier than the stored answer's.
   * Windows and the pause suggestion depend on "now", so an attempt that
   * started before the last write and commits after it must not resurrect
   * a no-show the stored document already aged out. An unreadable stored
   * time (`null`, `NaN`) is no bound.
   */
  projectionClock(clockMs: number, storedUpdatedAtMs: number | null): number {
    return storedUpdatedAtMs !== null && Number.isFinite(storedUpdatedAtMs)
      ? Math.max(clockMs, storedUpdatedAtMs)
      : clockMs;
  },

  /**
   * Do two answers say the same — their content byte for byte, the
   * bookkeeping (`version`, `updatedAtMs`) and the pass stamp aside? What
   * the revision guard writes by, and what a backfill's closing sample
   * checks a stored answer against a fresh one by.
   */
  sameAnswer(
    a: { readonly stats: ClientStats; readonly money: ClientMoneyStats },
    b: { readonly stats: ClientStats; readonly money: ClientMoneyStats },
  ): boolean {
    const canonical = ClientStatsSystem.canonicalJson;
    return (
      canonical(statsContent(a.stats)) === canonical(statsContent(b.stats)) &&
      canonical(moneyContent(a.money)) === canonical(moneyContent(b.money))
    );
  },

  /**
   * THE REVISION GUARD. State-based, never delta-based: a recompute writes
   * only when its answer differs from what is stored, so a redelivered or
   * out-of-order event, a backfill racing the trigger, or a second backfill
   * run all converge on the same bytes without bumping anything. The two
   * documents move together at one version; a stored pair that disagrees
   * on it is rewritten. Nobody to describe and nothing stored writes
   * nothing — zeros would only create a document for a stranger. An
   * unchanged answer still moves a stamp a newer pass must leave.
   */
  planWrite(
    input: ClientStatsWriteInput,
    paths: ClientStatsPaths,
  ): ClientStatsWritePlan {
    const { stored } = input;
    if (!input.hasHistory && !stored.statsPresent && !stored.moneyPresent) {
      return { kind: ClientStatsWriteKind.Unchanged, writes: [] };
    }
    const same =
      stored.stats !== null &&
      stored.money !== null &&
      stored.stats.version === stored.money.version &&
      ClientStatsSystem.sameAnswer(
        { stats: stored.stats, money: stored.money },
        { stats: input.stats, money: input.money },
      );
    if (same) {
      return {
        kind: ClientStatsWriteKind.Unchanged,
        writes:
          input.restamp && stored.statsPresent
            ? [WriteOp.update(paths.stats, { policyPass: input.stamp })]
            : [],
      };
    }
    const version =
      Math.max(stored.statsVersion ?? 0, stored.moneyVersion ?? 0) + 1;
    const updatedAtMs = input.nowMs;
    return {
      kind: ClientStatsWriteKind.Write,
      version,
      updatedAtMs,
      writes: [
        WriteOp.set(paths.stats, {
          ...statsContent(input.stats),
          version,
          updatedAtMs,
          policyPass: input.stamp,
        }),
        WriteOp.set(paths.money, {
          ...moneyContent(input.money),
          version,
          updatedAtMs,
        }),
      ],
    };
  },
} as const;
