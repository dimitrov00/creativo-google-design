import {
  BarberPreference,
  BookingLifecycle,
  Cadence,
  ClientStatsPolicy,
  type ClientMoneyStats,
  type ClientStats,
  type ClientStatsMeta,
  LastVisit,
  NextVisit,
  PauseSuggestion,
  type PolicyPass,
  PolicyPassStamp,
  type VisitFact,
  type VisitLeg,
  type Placement,
  CancellationReason,
  CancelledBy,
  HistoryNote,
  TenureState,
  type SeatOutcome,
  type AccountSeat,
  Seat,
  SeatSubject,
  type ShopNow,
  type DocPath,
  WriteOp,
  CancellationAttribution,
  ClientStatsWritePlan,
  SubjectVisitOutcome,
  SubjectVisitOutcomeState,
} from '@core/components';
import {
  AttendanceState,
  Currency,
  type DurationMinutes,
  type AppointmentId,
  type BarberId,
  type CustomerId,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type UserId,
  LocalDate,
  type EndMinute,
  MinuteOfDay,
  PriceCents,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Appointment } from '@core/entities';
import { BillingSystem } from './billing.system';
import { CanonicalJsonSystem } from './canonical-json.system';
import {
  type AppointmentSide,
  StoredDocumentSystem,
} from './stored-document.system';

/**
 * One client's statistics, from every appointment they have a seat on (the
 * legacy scheduling domain lib's `client-stats.ts:16-615`), and the pure
 * half of the projection that keeps `clientStats/{customerId}` current
 * (`apps/functions/src/lib/clients/client-stats-projection.ts:21-231`, hot
 * path #8): which writes can move anybody's stats, whom they concern, and
 * whether a recomputed answer is worth a write.
 *
 * State-based: the same appointments and clock give the same answer in any
 * order, which is what lets the trigger, the backfill and the seed all call
 * it and agree. Counts are per VISIT per subject (R33): a party of three is
 * three visits, a cut and a beard for one client is one, and other people's
 * seats on the same appointment never touch this person's numbers.
 *
 * Time (Law 7): every window, the "next visit" and the cadence run on the
 * shop wall clock — `localDate` + minutes against `ShopNow`, a rolling
 * window of N days being `(localDate, minutes)` pairs compared with
 * `(now.localDate − N, now.currentMinute)` (flatten-spec T8). The two
 * comparisons of lifecycle instants — the late-cancel line and the pause
 * dismissal — read `UtcEpochMs` (T2, T9).
 */

/** The fixed rate BGN retired at (2026): legacy seats priced in leva count in euro. */
const BGN_PER_EUR = 1.95583;

/** The counter windows a reader shows, in days (R35). */
const LAST_12M_DAYS = 365;
const LAST_90D_DAYS = 90;

/** No-shows in the last 90 days that raise the card's reliability warning (old spec R47). */
const NO_SHOW_WARNING_AT = 2;

/**
 * The shop wall clock a rolling window is read at — `ShopNow`'s local half
 * (T8): the windows compare `(localDate, minutes)` pairs and never read the
 * instant, so a whole `ShopNow` passes as is.
 */
type ShopClock = Pick<ShopNow, 'localDate' | 'currentMinute'>;

/** The stored counts and facts the windows are computed from (R33, T8). */
type WindowedStats = Pick<
  ClientStats,
  | 'lifetimeVisitsCompleted'
  | 'lifetimeNoShows'
  | 'lifetimeLateCancels'
  | 'last365VisitsCompleted'
  | 'last365NoShows'
  | 'last365LateCancels'
>;

/** How long the client has come — {@link ClientStatsSystem.tenureOf}'s answer, figures only. */
export type ClientTenure = {
  readonly tenureState: TenureState;
  /** The first worked visit's shop day; `null` on `FIRST_VISIT`. */
  readonly since: LocalDate | null;
  /** The usual interval in whole weeks; `null` but on `SINCE_CADENCE`. */
  readonly cadenceWeeks: number | null;
};

/**
 * One appointment as the statistics read it — the slice of the entity they
 * may read (R28). `placement` is the COMMIT's own stamp; the backfill's
 * `inferredPlacement` is deliberately not in it (§12.5.1). The math reads
 * no client record (D29), so the seats are {@link AccountSeat}s by default;
 * picking a CLIENT RECORD's seats ({@link ClientStatsSystem.subjectVisitOf})
 * needs `StatsAppointment<Seat>` — seats that carry their `subjectCustomerId`.
 */
export type StatsAppointment<S extends AccountSeat = AccountSeat> = Pick<
  Appointment,
  | 'id'
  | 'localDate'
  | 'startMinutes'
  | 'endMinutes'
  | 'utcEpochMs'
  | 'bookedAtUtcMs'
  | 'placement'
> & {
  readonly seats: readonly S[];
};

/**
 * What the party owes before and after its discounts — `BillingSystem`'s
 * answer, handed in: spend is net of discounts, and the discount evaluator
 * is not this module's to repeat.
 */
export type AppointmentBill = {
  readonly subtotalCents: PriceCents;
  readonly totalCents: PriceCents;
  readonly currency: Currency;
};

/** An appointment with its bill — what the spend reads. */
export type BilledAppointment<S extends AccountSeat = AccountSeat> =
  StatsAppointment<S> & {
    readonly bill: AppointmentBill;
  };

/**
 * One appointment as one person's visit: their seats, its span on the shop
 * wall clock, its start instant (the late-cancel line, T9) and their outcome.
 */
export type SubjectVisit<A extends StatsAppointment = StatsAppointment> = {
  readonly appointment: A;
  /** Only this person's seats, in seat order — the input's own structs. */
  readonly seats: readonly AccountSeat[];
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly startUtcMs: UtcEpochMs;
  readonly outcome: SubjectVisitOutcomeState;
};

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

/**
 * A no-show the pause suggestion may rest on: its fact, and the start
 * instant the desk's dismissal is compared with (T2).
 */
export type PauseBasisFact = VisitFact & {
  readonly startUtcMs: UtcEpochMs;
};

/**
 * One seat as the change detection reads it — every field a stat can read,
 * nothing else: whose it is among them, by its client record (the
 * projection's key, D29) and by the account beside it (an account's own
 * reading of its visits), so a change of either wakes a recompute.
 */
export type StatsInputSeat = {
  readonly seatId: SeatId;
  readonly seatSubject: SeatSubject;
  readonly subjectUserId: UserId | null;
  readonly subjectCustomerId: CustomerId | null;
  readonly startMinutes: MinuteOfDay;
  readonly priceCents: PriceCents;
  readonly currency: Currency;
  readonly durationMinutes: DurationMinutes;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly barberPreference: BarberPreference | null;
} & SeatOutcome;

/**
 * The slice of a stored appointment the statistics and the spend can read —
 * so the only fields whose change can move anybody's stats (§13 R28): the
 * booking lifecycle, the booking instant, the discounts, the commit's
 * placement, the shop day and each seat's {@link StatsInputSeat}. An
 * arrival, a tip, a contact or a voucher changes none of it, and those are
 * most of the writes an appointment ever sees.
 */
export type StatsInput = BookingLifecycle & {
  readonly bookedAtUtcMs: UtcEpochMs | null;
  readonly discounts: Appointment['discounts'];
  readonly placement: Placement | null;
  readonly localDate: LocalDate;
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
  /** Whose pair it is — the client record both bodies repeat (D29). */
  readonly customerId: CustomerId;
  readonly stored: StoredClientStats;
  readonly stats: ClientStats;
  readonly money: ClientMoneyStats;
  /** False for a person with no appointment left at all. */
  readonly hasHistory: boolean;
  /** Stamps `updatedAtUtcMs` — a lifecycle instant, never compared here. */
  readonly nowUtcMs: UtcEpochMs;
  /** The pass the written stats document is stamped with (the pass guard's verdict). */
  readonly stamp: PolicyPass | null;
  /** The stored stamp must move even when the answer is unchanged. */
  readonly restamp: boolean;
};

/** Where the pair lives — the caller's, from the collection registry. */
export type ClientStatsPaths = {
  readonly stats: DocPath;
  readonly money: DocPath;
};

/** Order of two shop wall-clock points: negative, zero or positive. */
function compareWall(
  aDate: LocalDate,
  aMinutes: number,
  bDate: LocalDate,
  bMinutes: number,
): number {
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  return aMinutes - bMinutes;
}

/**
 * The person's own story of one appointment, from their seats alone. Any
 * worked seat makes it a visit; otherwise an open seat keeps it open, and a
 * no-show beats cancellations. A fully cancelled visit is decided by the
 * seat called off LAST (the first of equal instants).
 */
function outcomeOf(seats: readonly AccountSeat[]): SubjectVisitOutcomeState {
  let open = false;
  let noShow = false;
  let decisive: (AccountSeat & SeatOutcome.Cancelled) | null = null;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as AccountSeat;
    switch (seat.attendanceState) {
      case AttendanceState.Worked:
        return SubjectVisitOutcomeState.WORKED;
      case AttendanceState.Scheduled:
        open = true;
        break;
      case AttendanceState.NoShow:
        noShow = true;
        break;
      case AttendanceState.Cancelled:
        if (
          decisive === null ||
          UtcEpochMs.compare(seat.cancelledAtUtcMs, decisive.cancelledAtUtcMs) >
            0
        ) {
          decisive = seat;
        }
        break;
    }
  }
  if (open) return SubjectVisitOutcomeState.OPEN;
  if (noShow) return SubjectVisitOutcomeState.NO_SHOW;
  // Seats are non-empty, so a visit that reaches here was cancelled.
  return decisive === null
    ? SubjectVisitOutcomeState.OPEN
    : SubjectVisitOutcomeState.cancelled(decisive);
}

/** Oldest first on the shop's clock, the id breaking ties — so input order never shows in the output. */
function chronological(a: SubjectVisit, b: SubjectVisit): number {
  const order = compareWall(
    a.localDate,
    a.startMinutes,
    b.localDate,
    b.startMinutes,
  );
  if (order !== 0) return order;
  const x = a.appointment.id;
  const y = b.appointment.id;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Every appointment `visitOf` reads as this person's visit, oldest first.
 * An appointment listed twice counts once: the unit is the visit, and a
 * caller merging two reads must not be able to double it.
 */
function collectVisits<A extends StatsAppointment>(
  appointments: readonly A[],
  visitOf: (appointment: A) => SubjectVisit<A> | null,
): SubjectVisit<A>[] {
  const seen = new Set<string>();
  const visits: SubjectVisit<A>[] = [];
  for (let i = 0; i < appointments.length; i++) {
    const appointment = appointments[i] as A;
    if (seen.has(appointment.id)) continue;
    seen.add(appointment.id);
    const visit = visitOf(appointment);
    if (visit !== null) visits.push(visit);
  }
  return visits.sort(chronological);
}

/** A client record's visits (D29) — {@link collectVisits} over its own seats. */
function visitsOf<A extends StatsAppointment<Seat>>(
  subject: CustomerId,
  appointments: readonly A[],
): SubjectVisit<A>[] {
  return collectVisits(appointments, (appointment) =>
    ClientStatsSystem.subjectVisitOf(subject, appointment),
  );
}

/** One appointment as a visit of the seats picked from it — `null` when none were. */
function visitOfSeats<A extends StatsAppointment>(
  appointment: A,
  seats: readonly AccountSeat[],
): SubjectVisit<A> | null {
  if (seats.length === 0) return null;
  return {
    appointment,
    seats,
    localDate: appointment.localDate,
    startMinutes: appointment.startMinutes,
    endMinutes: appointment.endMinutes,
    startUtcMs: appointment.utcEpochMs,
    outcome: outcomeOf(seats),
  };
}

function factOf(visit: SubjectVisit): VisitFact {
  return {
    appointmentId: visit.appointment.id,
    localDate: visit.localDate,
    startMinutes: visit.startMinutes,
  };
}

function basisFactOf(visit: SubjectVisit): PauseBasisFact {
  return {
    appointmentId: visit.appointment.id,
    localDate: visit.localDate,
    startMinutes: visit.startMinutes,
    startUtcMs: visit.startUtcMs,
  };
}

/** The fields a reader shows of a visit, from the seats whose state is `keep`. */
type VisitRefFields = {
  readonly appointmentId: AppointmentId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly legs: readonly VisitLeg[];
};

function refOf(visit: SubjectVisit, keep: AttendanceState): VisitRefFields {
  const serviceIds: ServiceId[] = [];
  const barberIds: BarberId[] = [];
  const legs: VisitLeg[] = [];
  for (let i = 0; i < visit.seats.length; i++) {
    const seat = visit.seats[i] as AccountSeat;
    if (seat.attendanceState !== keep) continue;
    if (!serviceIds.includes(seat.serviceId)) serviceIds.push(seat.serviceId);
    if (!barberIds.includes(seat.barberId)) barberIds.push(seat.barberId);
    legs.push({
      seatId: seat.seatId,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      durationMinutes: seat.durationMinutes,
    });
  }
  return {
    appointmentId: visit.appointment.id,
    localDate: visit.localDate,
    startMinutes: visit.startMinutes,
    serviceIds,
    barberIds,
    legs,
  };
}

function lastVisitOf(visit: SubjectVisit | undefined): LastVisit {
  if (visit === undefined) return LastVisit.NONE;
  const ref = refOf(visit, AttendanceState.Worked);
  return {
    lastVisitAppointmentId: ref.appointmentId,
    lastVisitLocalDate: ref.localDate,
    lastVisitStartMinutes: ref.startMinutes,
    lastVisitServiceIds: ref.serviceIds,
    lastVisitBarberIds: ref.barberIds,
    lastVisitLegs: ref.legs,
  };
}

function nextVisitOf(visit: SubjectVisit | null): NextVisit {
  if (visit === null) return NextVisit.NONE;
  const ref = refOf(visit, AttendanceState.Scheduled);
  return {
    nextVisitAppointmentId: ref.appointmentId,
    nextVisitLocalDate: ref.localDate,
    nextVisitStartMinutes: ref.startMinutes,
    nextVisitServiceIds: ref.serviceIds,
    nextVisitBarberIds: ref.barberIds,
    nextVisitLegs: ref.legs,
  };
}

/**
 * R34: the mean gap between consecutive worked visits, once there are
 * three, in SHOP CALENDAR DAYS (OR-46, flatten-spec T8): each gap is
 * `LocalDate.daysBetween` of the two visits' shop days, so neither the time
 * of day nor a DST weekend between them moves the figure, and a same-day
 * pair is no gap (the streak's habit reads its gaps by the same rule) — the
 * mean is `Cadence.meanDays`, one decimal. A gap the SHOP stretched — a
 * visit it cancelled falls inside it — says nothing about the client's
 * rhythm and is left out. Both lists are oldest first, so one pointer walks
 * the shop's cancellations once.
 */
function cadenceOf(
  worked: readonly SubjectVisit[],
  shopCancelled: readonly SubjectVisit[],
): Cadence | null {
  if (worked.length < 3) return null;
  let totalDays = 0;
  let gaps = 0;
  let j = 0;
  for (let i = 1; i < worked.length; i++) {
    const from = worked[i - 1] as SubjectVisit;
    const to = worked[i] as SubjectVisit;
    while (
      j < shopCancelled.length &&
      chronologicalPoint(shopCancelled[j] as SubjectVisit, from) <= 0
    ) {
      j++;
    }
    const stretched =
      j < shopCancelled.length &&
      chronologicalPoint(shopCancelled[j] as SubjectVisit, to) < 0;
    if (stretched) continue;
    const days = LocalDate.daysBetween(from.localDate, to.localDate);
    if (days === 0) continue;
    totalDays += days;
    gaps++;
  }
  return Cadence.meanDays(totalDays, gaps);
}

/** Two visits' starts on the shop's clock: negative, zero or positive. */
function chronologicalPoint(a: SubjectVisit, b: SubjectVisit): number {
  return compareWall(a.localDate, a.startMinutes, b.localDate, b.startMinutes);
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
 * The barber this client ASKS FOR: named (`SPECIFIC`) on at least two of
 * their last three visits, and only on a visit its commit stamped — a
 * phone booking into whichever chair was free is no evidence, and a row the
 * commit did not stamp was written by the path that defaulted an omitted
 * preference to `SPECIFIC` (§11.2 #6, §12.5.1). Such a visit still takes
 * its place among the last three. Two qualifying names go to the one asked
 * for most recently.
 */
function preferredBarberOf(worked: readonly SubjectVisit[]): BarberId | null {
  const tally = new Map<BarberId, Tally<BarberId>>();
  const last = Math.min(3, worked.length);
  for (let rank = 0; rank < last; rank++) {
    const visit = worked[worked.length - 1 - rank] as SubjectVisit;
    if (visit.appointment.placement === null) continue;
    const asked: BarberId[] = [];
    for (let i = 0; i < visit.seats.length; i++) {
      const seat = visit.seats[i] as AccountSeat;
      if (
        seat.attendanceState === AttendanceState.Worked &&
        seat.barberPreference === BarberPreference.Specific &&
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
      const seat = visit.seats[i] as AccountSeat;
      if (
        seat.attendanceState === AttendanceState.Worked &&
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

/**
 * A fact inside the rolling window ending at `now`, now included and the
 * fact not in the future (T8): `fact ≤ now` and
 * `fact > (cutoff, now.currentMinute)` — `cutoff` is `now.localDate − days`,
 * computed ONCE by the caller, outside its loop ({@link cutoffOf}).
 */
function isWithin(fact: VisitFact, now: ShopClock, cutoff: LocalDate): boolean {
  if (
    compareWall(
      fact.localDate,
      fact.startMinutes,
      now.localDate,
      now.currentMinute,
    ) > 0
  ) {
    return false;
  }
  return (
    compareWall(fact.localDate, fact.startMinutes, cutoff, now.currentMinute) >
    0
  );
}

/** The day a rolling window of `days` ending at `now` opens after. */
function cutoffOf(now: ShopClock, days: number): LocalDate {
  return LocalDate.addDays(now.localDate, -days);
}

function countWithin(
  facts: readonly VisitFact[],
  now: ShopClock,
  days: number,
): number {
  const cutoff = cutoffOf(now, days);
  let n = 0;
  for (let i = 0; i < facts.length; i++) {
    if (isWithin(facts[i] as VisitFact, now, cutoff)) n++;
  }
  return n;
}

/**
 * The windows every counter reads, computed at read from the stored facts
 * (R33, T8) at a wall-clock point — `ShopNow` passes straight in (D-5).
 */
function statWindows(stats: WindowedStats, now: ShopClock): StatWindows {
  const windowed = (
    lifetime: number,
    facts: readonly VisitFact[],
  ): WindowedCount => ({
    lifetime,
    last12m: countWithin(facts, now, LAST_12M_DAYS),
    last90d: countWithin(facts, now, LAST_90D_DAYS),
  });
  return {
    visitsCompleted: windowed(
      stats.lifetimeVisitsCompleted,
      stats.last365VisitsCompleted,
    ),
    noShows: windowed(stats.lifetimeNoShows, stats.last365NoShows),
    lateCancels: windowed(stats.lifetimeLateCancels, stats.last365LateCancels),
  };
}

/** The facts of `visits` that start after the horizon point, oldest first. */
function boundedFacts(
  visits: readonly SubjectVisit[],
  horizonDate: LocalDate,
  horizonMinutes: number,
): VisitFact[] {
  const facts: VisitFact[] = [];
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i] as SubjectVisit;
    if (
      compareWall(
        visit.localDate,
        visit.startMinutes,
        horizonDate,
        horizonMinutes,
      ) > 0
    ) {
      facts.push(factOf(visit));
    }
  }
  return facts;
}

/** Cents of a stored currency in EUR, or `null` when there is no honest rate. */
function inEuroCents(cents: number, currency: Currency): number | null {
  if (currency === Currency.EUR) return cents;
  if (currency === Currency.BGN) return Math.round(cents / BGN_PER_EUR);
  return null;
}

function statsOf(
  visits: readonly SubjectVisit[],
  policy: ClientStatsPolicy,
  now: ShopNow,
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
    switch (outcome.subjectVisitOutcome) {
      case SubjectVisitOutcome.Worked:
        worked.push(visit);
        break;
      case SubjectVisitOutcome.NoShow:
        noShows.push(visit);
        break;
      case SubjectVisitOutcome.Open:
        if (
          next === null &&
          compareWall(
            visit.localDate,
            visit.endMinutes,
            now.localDate,
            now.currentMinute,
          ) > 0
        ) {
          next = visit;
        }
        break;
      case SubjectVisitOutcome.Cancelled:
        if (!ClientStatsSystem.clientCaused(outcome.decisive)) {
          shopCancelled.push(visit);
          break;
        }
        clientCancels.push(visit);
        // A late cancel needs a trustworthy lead time: a row with no
        // booking instant (its outcome instant derived) is never late.
        if (
          visit.appointment.bookedAtUtcMs !== null &&
          ClientStatsPolicy.isLateCancellation(
            policy,
            visit.startUtcMs,
            outcome.decisive.cancelledAtUtcMs,
            outcome.decisive.cancellationWindowHours,
          )
        ) {
          lateCancels.push(visit);
        }
        break;
    }
  }

  const horizonDate = LocalDate.addDays(
    now.localDate,
    -ClientStatsPolicy.BOUNDED_DAYS,
  );
  const first = worked[0];
  const recentNoShows: PauseBasisFact[] = [];
  for (let i = 0; i < noShows.length; i++) {
    const visit = noShows[i] as SubjectVisit;
    if (
      compareWall(
        visit.localDate,
        visit.startMinutes,
        horizonDate,
        now.currentMinute,
      ) > 0
    ) {
      recentNoShows.push(basisFactOf(visit));
    }
  }

  return {
    lifetimeVisitsCompleted: worked.length,
    lifetimeNoShows: noShows.length,
    lifetimeLateCancels: lateCancels.length,
    lifetimeClientCancels: clientCancels.length,
    last365VisitsCompleted: boundedFacts(
      worked,
      horizonDate,
      now.currentMinute,
    ),
    last365NoShows: boundedFacts(noShows, horizonDate, now.currentMinute),
    last365LateCancels: boundedFacts(
      lateCancels,
      horizonDate,
      now.currentMinute,
    ),
    firstVisitLocalDate: first === undefined ? null : first.localDate,
    firstVisitStartMinutes: first === undefined ? null : first.startMinutes,
    ...lastVisitOf(worked[worked.length - 1]),
    ...nextVisitOf(next),
    avgCadenceDays: cadenceOf(worked, shopCancelled),
    preferredBarberId: preferredBarberOf(worked),
    usualServiceIds: usualServicesOf(worked),
    ...ClientStatsSystem.pauseSuggestionAt(recentNoShows, now, policy),
  };
}

function moneyOf(
  visits: readonly SubjectVisit<BilledAppointment>[],
): ClientMoneyStats {
  let spend = 0;
  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i] as SubjectVisit<BilledAppointment>;
    if (visit.outcome.subjectVisitOutcome !== SubjectVisitOutcome.Worked) {
      continue;
    }
    let own = 0;
    for (let s = 0; s < visit.seats.length; s++) {
      const seat = visit.seats[s] as AccountSeat;
      if (seat.attendanceState === AttendanceState.Worked) {
        own += seat.priceCents;
      }
    }
    const { subtotalCents, totalCents, currency } = visit.appointment.bill;
    const net =
      subtotalCents > 0 ? Math.round((own * totalCents) / subtotalCents) : 0;
    spend += inEuroCents(net, currency) ?? 0;
  }
  const lifetimeSpend = PriceCents.signed(spend);
  return {
    lifetimeSpendCents: lifetimeSpend.ok
      ? lifetimeSpend.value
      : PriceCents.ZERO,
    currency: Currency.EUR,
  };
}

/**
 * A projection: the stats' CONTENT — everything but the bookkeeping and the
 * stamp a stored document carries beside it.
 */
function statsContent<S extends ClientStats>(stats: S): ClientStats {
  return {
    lifetimeVisitsCompleted: stats.lifetimeVisitsCompleted,
    lifetimeNoShows: stats.lifetimeNoShows,
    lifetimeLateCancels: stats.lifetimeLateCancels,
    lifetimeClientCancels: stats.lifetimeClientCancels,
    last365VisitsCompleted: stats.last365VisitsCompleted,
    last365NoShows: stats.last365NoShows,
    last365LateCancels: stats.last365LateCancels,
    firstVisitLocalDate: stats.firstVisitLocalDate,
    firstVisitStartMinutes: stats.firstVisitStartMinutes,
    lastVisitAppointmentId: stats.lastVisitAppointmentId,
    lastVisitLocalDate: stats.lastVisitLocalDate,
    lastVisitStartMinutes: stats.lastVisitStartMinutes,
    lastVisitServiceIds: stats.lastVisitServiceIds,
    lastVisitBarberIds: stats.lastVisitBarberIds,
    lastVisitLegs: stats.lastVisitLegs,
    nextVisitAppointmentId: stats.nextVisitAppointmentId,
    nextVisitLocalDate: stats.nextVisitLocalDate,
    nextVisitStartMinutes: stats.nextVisitStartMinutes,
    nextVisitServiceIds: stats.nextVisitServiceIds,
    nextVisitBarberIds: stats.nextVisitBarberIds,
    nextVisitLegs: stats.nextVisitLegs,
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId: stats.preferredBarberId,
    usualServiceIds: stats.usualServiceIds,
    pauseSuggestedNoShows: stats.pauseSuggestedNoShows,
    pauseSuggestedWindowDays: stats.pauseSuggestedWindowDays,
    pauseSuggestionBasis: stats.pauseSuggestionBasis,
    pauseSuggestedAtUtcMs: stats.pauseSuggestedAtUtcMs,
  };
}

/**
 * A projection: the money's CONTENT — the spend and its currency, without
 * the bookkeeping and the stamp a stored document carries beside them.
 */
function moneyContent<M extends ClientMoneyStats>(money: M): ClientMoneyStats {
  return {
    lifetimeSpendCents: money.lifetimeSpendCents,
    currency: money.currency,
  };
}

function seatInputOf(seat: Seat): StatsInputSeat {
  return {
    seatId: seat.seatId,
    seatSubject: seat.seatSubject,
    subjectUserId:
      seat.seatSubject === SeatSubject.Account ? seat.subjectUserId : null,
    subjectCustomerId:
      seat.seatSubject === SeatSubject.Anonymous
        ? null
        : seat.subjectCustomerId,
    startMinutes: seat.startMinutes,
    priceCents: seat.priceCents,
    currency: seat.currency,
    durationMinutes: seat.durationMinutes,
    serviceId: seat.serviceId,
    variantId: seat.variantId,
    barberId: seat.barberId,
    barberPreference: seat.barberPreference,
    ...Seat.outcomeOf(seat),
  };
}

/** Nobody — the shared empty answer of a write that moved no one; never mutated. */
const NO_SUBJECTS: readonly CustomerId[] = [];

/** A present side's subjects through the salvage — `[]` for an absent side. */
function subjectsOf(side: AppointmentSide): readonly CustomerId[] {
  return side.stored === null
    ? NO_SUBJECTS
    : StoredDocumentSystem.salvage(side.stored).subjectCustomerIds;
}

export const ClientStatsSystem = {
  BGN_PER_EUR,

  /**
   * Does this cancellation count against the client (R33, §11)? The reason
   * decides when it names a side; otherwise the side that did the
   * cancelling does — the client's own cancel path files `UNSPECIFIED` with
   * `cancelledBy: CLIENT`, and reading the reason alone would let every
   * self-service cancellation off. A converted no-show takes the
   * correction's attribution, and with none recorded it is held against
   * nobody. The same predicate excuses shop-caused gaps in the cadence.
   */
  clientCaused(
    cancellation: Pick<
      SeatOutcome.Cancelled,
      'cancelledBy' | 'cancellationReason'
    >,
    attribution: CancellationAttribution | null = null,
  ): boolean {
    switch (cancellation.cancellationReason) {
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
        return cancellation.cancelledBy === CancelledBy.Client;
    }
  },

  /**
   * One appointment as this CLIENT RECORD's visit (D29 — whom the shop
   * served), from its seats alone — an account's seats, or a walk-in's
   * (OR-26: the record is the person either way) — `null` when it holds no
   * seat on it. The same reading the statistics count by, so a history row
   * and the counts above it never tell two stories.
   */
  subjectVisitOf<A extends StatsAppointment<Seat>>(
    subject: CustomerId,
    appointment: A,
  ): SubjectVisit<A> | null {
    const seats: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (
        seat.seatSubject !== SeatSubject.Anonymous &&
        seat.subjectCustomerId === subject
      ) {
        seats.push(seat);
      }
    }
    return visitOfSeats(appointment, seats);
  },

  /**
   * One client's stats as of `now`. A late cancel is judged by the window
   * stamped on the deciding seat — the rule in force when the client
   * cancelled — so a later policy change re-judges nothing; only a
   * cancellation recorded before the stamp falls back to `policy`'s current
   * window. Only the last `ClientStatsPolicy.BOUNDED_DAYS` keep their facts.
   */
  stats(
    subject: CustomerId,
    appointments: readonly StatsAppointment<Seat>[],
    policy: ClientStatsPolicy,
    now: ShopNow,
  ): ClientStats {
    return statsOf(visitsOf(subject, appointments), policy, now);
  },

  /**
   * Lifetime spend over worked visits (R33, §12.5.2): the person's own
   * worked seats, less their pro-rata share of the visit's discounts.
   * Vouchers are a way of PAYING and tips were never the shop's price, so
   * neither moves it. A legacy leva price converts at the fixed rate; a
   * price in a currency with no fixed rate is left out, never guessed at.
   */
  money(
    subject: CustomerId,
    appointments: readonly BilledAppointment<Seat>[],
  ): ClientMoneyStats {
    return moneyOf(visitsOf(subject, appointments));
  },

  /**
   * The visits that count toward SPEND, each with its bill (pass C, P-26 —
   * the projection's `clientStatsOf` loop, homed here): `BillingSystem`'s
   * answer — the seats less the discounts (vouchers are a way of paying,
   * tips never the shop's price). A visit whose seats have no bill (none,
   * or mixed currencies) is left out, never guessed at. History order kept.
   */
  billedHistory(
    history: readonly Appointment[],
  ): readonly BilledAppointment<Seat>[] {
    const billed: BilledAppointment<Seat>[] = [];
    for (let i = 0; i < history.length; i++) {
      const appointment = history[i] as Appointment;
      const subtotal = BillingSystem.subtotalOf(appointment.seats);
      if (!subtotal.ok) continue;
      const total = BillingSystem.totalOf(
        subtotal.value,
        appointment.discounts,
      );
      billed.push({
        ...appointment,
        bill: {
          subtotalCents: subtotal.value.amountCents,
          totalCents: total.amountCents,
          currency: subtotal.value.currency,
        },
      });
    }
    return billed;
  },

  /**
   * When the client's last worked visit BEFORE `current` started — what the
   * card's «Ново» is measured from (pass C, K-3 — the client card store's
   * `previousVisitAtMs`, homed here): the latest of the bounded worked
   * visits other than `current`, by the instant `instantOf` reads (the
   * caller's, zone-bound — the shop's wall clock to an instant, D-6), so the
   * order is the instant order; with none, the stored last visit when it is
   * another visit and fully stamped; `null` otherwise.
   */
  previousVisit(
    stats: Pick<
      ClientStats,
      | 'last365VisitsCompleted'
      | 'lastVisitAppointmentId'
      | 'lastVisitLocalDate'
      | 'lastVisitStartMinutes'
    >,
    current: AppointmentId | null,
    instantOf: (fact: VisitFact) => UtcEpochMs,
  ): UtcEpochMs | null {
    let latest: UtcEpochMs | null = null;
    const facts = stats.last365VisitsCompleted;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i] as VisitFact;
      if (fact.appointmentId === current) continue;
      const at = instantOf(fact);
      if (latest === null || UtcEpochMs.compare(at, latest) > 0) latest = at;
    }
    if (latest !== null) return latest;
    return stats.lastVisitAppointmentId !== null &&
      stats.lastVisitAppointmentId !== current &&
      stats.lastVisitLocalDate !== null &&
      stats.lastVisitStartMinutes !== null
      ? instantOf({
          appointmentId: stats.lastVisitAppointmentId,
          localDate: stats.lastVisitLocalDate,
          startMinutes: stats.lastVisitStartMinutes,
        })
      : null;
  },

  /**
   * The pause suggestion as of `now`, from no-shows alone (R25) — a
   * SUGGESTION, never a pause; {@link PauseSuggestion.NONE} when none
   * stands. Cheap, so a reader re-checks the stored one against its own
   * clock: a basis that aged out of the window is gone without a write.
   * `dismissedAtUtcMs` is the desk's «Не сега»; it holds until a newer
   * no-show raises the suggestion again (R49) — two instants compared (T2).
   */
  pauseSuggestionAt(
    noShows: readonly PauseBasisFact[],
    now: ShopNow,
    policy: ClientStatsPolicy = ClientStatsPolicy.DEFAULT,
    dismissedAtUtcMs: UtcEpochMs | null = null,
  ): PauseSuggestion {
    const basis: PauseBasisFact[] = [];
    const cutoff = cutoffOf(now, policy.suggestPauseWindowDays);
    for (let i = 0; i < noShows.length; i++) {
      const fact = noShows[i] as PauseBasisFact;
      if (isWithin(fact, now, cutoff)) basis.push(fact);
    }
    if (basis.length < policy.suggestPauseNoShows) return PauseSuggestion.NONE;
    basis.sort(
      (a, b) =>
        compareWall(a.localDate, a.startMinutes, b.localDate, b.startMinutes) ||
        (a.appointmentId < b.appointmentId ? -1 : 1),
    );
    const raisedAtUtcMs = (basis[basis.length - 1] as PauseBasisFact)
      .startUtcMs;
    if (
      dismissedAtUtcMs !== null &&
      UtcEpochMs.compare(dismissedAtUtcMs, raisedAtUtcMs) >= 0
    ) {
      return PauseSuggestion.NONE;
    }
    const ids: AppointmentId[] = [];
    for (let i = 0; i < basis.length; i++) {
      ids.push((basis[i] as PauseBasisFact).appointmentId);
    }
    return {
      pauseSuggestedNoShows: basis.length,
      pauseSuggestedWindowDays: policy.suggestPauseWindowDays,
      pauseSuggestionBasis: ids,
      pauseSuggestedAtUtcMs: raisedAtUtcMs,
    };
  },

  /**
   * A span of days as whole weeks — `round(days / 7)`, at least one (Law
   * 10.2: the card's «на N седмици» and the rhythm's «N седмици от
   * последното»). The ONE home of `max(1, round(days / 7))`:
   * `StreakSystem.outlook`'s AT_RISK weeks and the history cell both read
   * it, never a copy.
   */
  cadenceWeeks(days: number): number {
    return Math.max(1, Math.round(days / 7));
  },

  /**
   * What the card's history says beside its figures (Law 10.2): before the
   * first worked visit `FIRST_VISIT` (no stats count as no visits); else
   * `CLEAN` when neither a no-show nor a cancellation of the client's own
   * stands on the record; else `NONE`. NOT {@link tenureOf}'s first-visit
   * reading (§7 R-8): a first day missing on a counted history is no first
   * visit here.
   */
  historyNote(
    stats: Pick<
      ClientStats,
      'lifetimeVisitsCompleted' | 'lifetimeNoShows' | 'lifetimeClientCancels'
    > | null,
  ): HistoryNote {
    if (stats === null || stats.lifetimeVisitsCompleted === 0) {
      return HistoryNote.FirstVisit;
    }
    return stats.lifetimeNoShows === 0 && stats.lifetimeClientCancels === 0
      ? HistoryNote.Clean
      : HistoryNote.None;
  },

  /**
   * How long the client has come, as the card's hero says it (Law 10.2):
   * `FIRST_VISIT` with no stats, no worked visit or no first day on record;
   * `SINCE` the first day alone until a cadence exists (three worked
   * visits, R34); else `SINCE_CADENCE` with the interval in whole weeks
   * ({@link cadenceWeeks}). NOT {@link historyNote}'s first-visit reading
   * (§7 R-8).
   */
  tenureOf(
    stats: Pick<
      ClientStats,
      'lifetimeVisitsCompleted' | 'firstVisitLocalDate' | 'avgCadenceDays'
    > | null,
  ): ClientTenure {
    if (
      stats === null ||
      stats.lifetimeVisitsCompleted === 0 ||
      stats.firstVisitLocalDate === null
    ) {
      return {
        tenureState: TenureState.FirstVisit,
        since: null,
        cadenceWeeks: null,
      };
    }
    if (stats.avgCadenceDays === null) {
      return {
        tenureState: TenureState.Since,
        since: stats.firstVisitLocalDate,
        cadenceWeeks: null,
      };
    }
    return {
      tenureState: TenureState.SinceCadence,
      since: stats.firstVisitLocalDate,
      cadenceWeeks: ClientStatsSystem.cadenceWeeks(stats.avgCadenceDays),
    };
  },

  statWindows,

  /**
   * {@link statWindows} over a WHOLE shop day — read at its last minute,
   * 23:59 on `today`'s wall clock (the records page's «last 12 months»).
   * Zone-blind: the windows compare local `(day, minute)` pairs only, so
   * no instant is built; it shares {@link statWindows}' core.
   */
  statWindowsOnDay(stats: WindowedStats, today: LocalDate): StatWindows {
    return statWindows(stats, {
      localDate: today,
      currentMinute: MinuteOfDay.LAST,
    });
  },

  /** No-shows in the last 90 days that raise the card's reliability warning (old spec R47). */
  NO_SHOW_WARNING_AT,

  /**
   * The no-shows the card warns of — the last 90 days' count once it
   * reaches {@link NO_SHOW_WARNING_AT}, else `null` (no warning).
   */
  noShowWarning(windows: Pick<StatWindows, 'noShows'>): number | null {
    const noShows = windows.noShows.last90d;
    return noShows >= NO_SHOW_WARNING_AT ? noShows : null;
  },

  /**
   * The stats input of a stored appointment (§13 R28): the booking
   * lifecycle, the booking instant (the late-cancel rule), the discounts
   * (spend is net of them), the commit's placement (the preferred barber),
   * the shop day, and each seat's subject, outcome, start, price, duration,
   * service, barber and preference. `null` for no appointment (a create's
   * before, a delete's after).
   */
  statsInputOf(appointment: Appointment | null): StatsInput | null {
    if (appointment === null) return null;
    const seats: StatsInputSeat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      seats.push(seatInputOf(appointment.seats[i] as Seat));
    }
    return {
      ...BookingLifecycle.sliceOf(appointment),
      bookedAtUtcMs: appointment.bookedAtUtcMs,
      discounts: appointment.discounts,
      placement: appointment.placement,
      localDate: appointment.localDate,
      seats,
    };
  },

  /** Did this write change anything a client's stats are computed from? */
  statsInputChanged(
    before: Appointment | null,
    after: Appointment | null,
  ): boolean {
    return (
      CanonicalJsonSystem.of(ClientStatsSystem.statsInputOf(before)) !==
      CanonicalJsonSystem.of(ClientStatsSystem.statsInputOf(after))
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
   * Whom one appointment write sends to the projection — the sides as the
   * read-time guard left them (edge hardening D-3): both admitted, a write
   * that changed nothing a stat reads ({@link statsInputChanged}) moves
   * nobody; otherwise everybody either present side names
   * ({@link affectedSubjects}), each side's subjects read through
   * `StoredDocumentSystem.salvage` (an admitted legacy row may hold no
   * mirror: absent / `null` reads `[]`). A REFUSED side cannot be compared,
   * so the change test is skipped and everybody named is re-projected (the
   * recompute is idempotent); the first refusal is the answer only when
   * nobody is named — never a decision made on the malformed side's data.
   */
  dispatchSubjects(
    before: AppointmentSide,
    after: AppointmentSide,
  ): Result<readonly CustomerId[], RepositoryError> {
    const refusal = before.refusal ?? after.refusal;
    if (
      refusal === null &&
      !ClientStatsSystem.statsInputChanged(
        before.appointment,
        after.appointment,
      )
    ) {
      return Result.ok(NO_SUBJECTS);
    }
    const subjects = ClientStatsSystem.affectedSubjects(
      subjectsOf(before),
      subjectsOf(after),
    );
    return refusal !== null && subjects.length === 0
      ? Result.err(refusal)
      : Result.ok(subjects);
  },

  /**
   * The clock a recompute reads: never earlier than the stored answer's.
   * Windows and the pause suggestion depend on "now", so an attempt that
   * started before the last write and commits after it must not resurrect
   * a no-show the stored document already aged out. An unreadable stored
   * time (`null`, or a non-finite value read off a document) is no bound —
   * a lifecycle-stamp ordering (T2).
   */
  projectionClock(
    clockUtcMs: UtcEpochMs,
    storedUpdatedAtUtcMs: UtcEpochMs | null,
  ): UtcEpochMs {
    return storedUpdatedAtUtcMs !== null &&
      Number.isFinite(storedUpdatedAtUtcMs) &&
      UtcEpochMs.compare(storedUpdatedAtUtcMs, clockUtcMs) > 0
      ? storedUpdatedAtUtcMs
      : clockUtcMs;
  },

  /**
   * Do two answers say the same — their content byte for byte, the
   * bookkeeping (`version`, `updatedAtUtcMs`) and the pass stamp aside? What
   * the revision guard writes by, and what a backfill's closing sample
   * checks a stored answer against a fresh one by.
   */
  sameAnswer(
    a: { readonly stats: ClientStats; readonly money: ClientMoneyStats },
    b: { readonly stats: ClientStats; readonly money: ClientMoneyStats },
  ): boolean {
    const canonical = CanonicalJsonSystem.of;
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
   * unchanged answer still moves a stamp a newer pass must leave: the
   * stamp's root fields alone (Law 5).
   */
  planWrite(
    input: ClientStatsWriteInput,
    paths: ClientStatsPaths,
  ): ClientStatsWritePlan {
    const { stored } = input;
    if (!input.hasHistory && !stored.statsPresent && !stored.moneyPresent) {
      return ClientStatsWritePlan.unchanged([]);
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
      return ClientStatsWritePlan.unchanged(
        input.restamp && stored.statsPresent
          ? [WriteOp.update(paths.stats, PolicyPassStamp.of(input.stamp))]
          : [],
      );
    }
    const version =
      Math.max(stored.statsVersion ?? 0, stored.moneyVersion ?? 0) + 1;
    const updatedAtUtcMs = input.nowUtcMs;
    return ClientStatsWritePlan.write(version, updatedAtUtcMs, [
      WriteOp.set(paths.stats, {
        customerId: input.customerId,
        ...statsContent(input.stats),
        version,
        updatedAtUtcMs,
        ...PolicyPassStamp.of(input.stamp),
      }),
      WriteOp.set(paths.money, {
        customerId: input.customerId,
        ...moneyContent(input.money),
        version,
        updatedAtUtcMs,
      }),
    ]);
  },
} as const;
