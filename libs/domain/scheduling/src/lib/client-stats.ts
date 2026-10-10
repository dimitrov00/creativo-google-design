import type { UserId } from '@creativo/domain/accounts';
import type {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import type { Money } from '@creativo/domain/kernel';
import {
  AppointmentId as EcsAppointmentId,
  BarberId as EcsBarberId,
  type BilledAppointment,
  type ClientStats as EcsClientStats,
  ClientStatsSystem,
  type Money as EcsMoney,
  type PauseSuggestion as EcsPauseSuggestion,
  type Seat as EcsSeat,
  SeatId as EcsSeatId,
  SeatLabel as EcsSeatLabel,
  type SeatOutcome as EcsSeatOutcome,
  SeatSubject as EcsSeatSubject,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  type StatsAppointment,
  type SubjectVisitOutcome as EcsSubjectVisitOutcome,
  SubjectVisitOutcomeKind,
  TimeInterval,
  UserId as EcsUserId,
  type VisitFact as EcsVisitFact,
  type VisitRef as EcsVisitRef,
} from '@creativo/ecs-core';
import type { Appointment } from './appointment';
import { ClientStatsPolicy } from './client-stats-policy';
import type { AppointmentId, SeatId } from './ids';
import type { Seat } from './seat';
import type { SeatOutcome } from './seat-outcome';

/*
 * Phase 2 shim: the statistics are `ClientStatsSystem` in
 * `@creativo/ecs-core`. This file keeps the legacy shapes (class ids, the
 * `Appointment` aggregate, the flat spend) for its callers and converts at
 * the edge: appointments go in as the stats slice of the entity, and every
 * id, seat and outcome comes back as the caller's own instance.
 */

/** The fixed rate BGN retired at (2026): legacy seats priced in leva count in euro. */
// A literal typed by the system's rate, so the compiler keeps the two equal
// while loading this module evaluates nothing of `ClientStatsSystem`.
export const BGN_PER_EUR: typeof ClientStatsSystem.BGN_PER_EUR = 1.95583;

/**
 * One VISIT — a person's seats in one appointment, counted once (R33) — at
 * the appointment's start. A party of three is three visits, one per person;
 * a client with a cut and a beard trim is one.
 */
export interface VisitFact {
  readonly appointmentId: AppointmentId;
  readonly atMs: number;
}

/** One service of a visit, enough to book it again («Същото»). */
export interface VisitLeg {
  readonly seatId: SeatId;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly minutes: number;
}

export interface VisitRef extends VisitFact {
  /** Distinct, in seat order. */
  readonly serviceIds: readonly ServiceId[];
  /** Distinct, in seat order. */
  readonly barberIds: readonly BarberId[];
  readonly legs: readonly VisitLeg[];
}

/**
 * «3 неявявания за 60 дни» — a SUGGESTION to pause, never a pause (R25, B1).
 * No code path turns this into one; a person reads it and decides. Whether
 * the front desk already said «Не сега» lives on the client's profile, not
 * here, so a stats recompute can never undo a dismissal.
 */
export interface PauseSuggestion {
  readonly noShows: number;
  readonly windowDays: number;
  /** The no-shows it rests on, oldest first — what a reviewer checks. */
  readonly basis: readonly AppointmentId[];
  /** The newest no-show in the basis: a later one raises it anew. */
  readonly raisedAtMs: number;
}

/**
 * What the shop knows about one client's visits — a projection of their
 * appointments, recomputed whole on every relevant change and never edited.
 *
 * Counts are per VISIT per subject, not per seat (R33). Only the last
 * `CLIENT_STATS_BOUNDED_DAYS` days keep their instants; windows are
 * computed at read (`statWindows`), so a no-show from 91 days ago leaves the
 * 90-day count without anything being rewritten. Money is deliberately
 * absent — a barber reads this whole — see `ClientMoneyStats`.
 */
export interface ClientStats {
  readonly userId: UserId;
  readonly lifetime: {
    readonly visitsCompleted: number;
    readonly noShows: number;
    /** Client-caused cancellations inside the free-cancellation window in force when each was made. */
    readonly lateCancels: number;
    /** Client-caused cancellations at any lead time (R35). Shop-caused never count. */
    readonly clientCancels: number;
  };
  readonly last365: {
    readonly visitsCompleted: readonly VisitFact[];
    readonly noShows: readonly VisitFact[];
    readonly lateCancels: readonly VisitFact[];
  };
  readonly firstVisitAtMs: number | null;
  readonly lastVisit: VisitRef | null;
  /** The earliest open visit not yet over. A reader re-checks it against its own now. */
  readonly nextVisit: VisitRef | null;
  /** R34: mean days between worked visits once there are ≥ 3, shop-caused gaps excluded. */
  readonly avgCadenceDays: number | null;
  /** Asked for by name on ≥ 2 of the last 3 visits — never inferred from who happened to be free. */
  readonly preferredBarberId: BarberId | null;
  /** Services on ≥ 3 of the last 5 visits, most frequent first. */
  readonly usualServiceIds: readonly ServiceId[];
  readonly pauseSuggestion: PauseSuggestion | null;
}

/**
 * Lifetime spend, in EUR minor units, tips excluded (a tip is not the shop's
 * money). Its own type because it lives in its own admin-only document: rules
 * cannot hide a field, so spend cannot ride on `ClientStats` (R33).
 */
export interface ClientMoneyStats {
  readonly userId: UserId;
  readonly lifetimeSpendMinor: number;
  readonly currencyCode: 'EUR';
}

export interface WindowedCount {
  readonly lifetime: number;
  readonly last12m: number;
  readonly last90d: number;
}

export interface StatWindows {
  readonly visitsCompleted: WindowedCount;
  readonly noShows: WindowedCount;
  readonly lateCancels: WindowedCount;
}

/** Who a cancellation is on, when an outcome correction said so (P4, R49). */
export type CancellationAttribution = 'client' | 'shop';

/**
 * Who put an appointment in the book (R33): the client themselves, or the
 * shop on their behalf. Stamped at commit and carried through every later
 * write — nothing about the seats can say it afterwards.
 */
export type VisitPlacement = 'self' | 'staff';

/**
 * Each appointment's placement AS ITS COMMIT STAMPED IT, by appointment id.
 *
 * The stamp is also what vouches for the seats: the commit path that writes
 * it records an omitted barber preference as unknown, where the one before
 * it recorded `specific`. So an appointment missing from the map says
 * nothing about who was asked for (§12.5.1) — a legacy import, or any row
 * written before the stamp, including one whose placement was later
 * INFERRED from the audit trail. An inference must never be put here: it
 * can say who booked, but not that the seats' `specific` was a request.
 */
export type VisitPlacements = ReadonlyMap<string, VisitPlacement>;

const NO_PLACEMENTS: VisitPlacements = new Map();

type Cancellation = Extract<SeatOutcome, { kind: 'cancelled' }>;

/**
 * Does this cancellation count against the client (R33, §11)?
 *
 * The reason decides when it names a side; otherwise the side that did the
 * cancelling does. That second half is why this takes the whole outcome and
 * not only the reason (model.ts's shape): the client's own cancel path files
 * `unspecified` with `by: 'client'`, and reading the reason alone would let
 * every self-service cancellation off. A converted no-show takes the
 * correction's attribution, and with none recorded it is not held against
 * anyone. The same predicate excuses shop-caused gaps in the cadence (A5).
 */
export function clientCaused(
  cancellation: Pick<Cancellation, 'by' | 'reason'>,
  correctionAttribution: CancellationAttribution | null = null,
): boolean {
  return ClientStatsSystem.clientCaused(
    { by: cancellation.by, reason: { kind: cancellation.reason.kind } },
    correctionAttribution,
  );
}

/** What one appointment was, for one person. */
type VisitOutcome =
  | { readonly kind: 'worked' }
  | { readonly kind: 'no_show' }
  | { readonly kind: 'cancelled'; readonly decisive: Cancellation }
  | { readonly kind: 'open' };

/**
 * What one appointment was for one person — named apart from the visit
 * row's own outcome, so the two never clash in a reader's imports.
 */
export type SubjectVisitOutcome = VisitOutcome;

/** One appointment as one person's visit: their seats, its span, their outcome. */
export interface SubjectVisit {
  readonly appointment: Appointment;
  /** Only this person's seats, in seat order. */
  readonly seats: readonly Seat[];
  readonly atMs: number;
  readonly endMs: number;
  readonly outcome: VisitOutcome;
}

/**
 * One appointment as this person's visit, from their seats alone — `null`
 * when they hold no seat on it. The same reading the statistics count by,
 * so a history row and the counts above it can never tell two stories.
 */
export function subjectVisitOf(
  subject: UserId,
  appointment: Appointment,
): SubjectVisit | null {
  const bridge = newBridge();
  const visit = ClientStatsSystem.subjectVisitOf(
    EcsUserId.of(subject.value),
    statsAppointmentOf(appointment, null, bridge),
  );
  if (visit === null) return null;
  return {
    appointment,
    seats: visit.seats.map((seat) => known(bridge.seats, seat)),
    atMs: visit.atMs,
    endMs: visit.endMs,
    outcome: outcomeBack(visit.outcome, bridge),
  };
}

/**
 * The pause suggestion as of `nowMs`, from no-shows alone (R25). Pure and
 * cheap, so a reader re-checks the stored one against its own clock: a
 * suggestion whose basis has aged out of the window is gone without any
 * write. `dismissedAtMs` is the front desk's «Не сега»; it holds until a
 * newer no-show raises the suggestion again (R49).
 */
export function pauseSuggestionAt(
  noShows: readonly VisitFact[],
  nowMs: number,
  policy: ClientStatsPolicy = ClientStatsPolicy.default(),
  dismissedAtMs: number | null = null,
): PauseSuggestion | null {
  const bridge = newBridge();
  for (const fact of noShows) remember(bridge.appointments, fact.appointmentId);
  return suggestionBack(
    ClientStatsSystem.pauseSuggestionAt(
      noShows.map(factStruct),
      nowMs,
      policy.toStruct(),
      dismissedAtMs,
    ),
    bridge,
  );
}

/**
 * One client's stats, from every appointment they have a seat on.
 *
 * Pure and state-based: the same appointments and clock give the same answer
 * in any order, which is what lets the trigger, the backfill and the seed
 * all call it and agree. Seats of other people on the same appointments are
 * read past — their outcomes never touch this person's numbers.
 *
 * A late cancel needs a trustworthy lead time, so a row with no `bookedAt`
 * (written before the field, its outcome instant derived) counts as a client
 * cancellation but never as a late one. It is judged against the window
 * stamped on the deciding seat — the rule in force when the client cancelled
 * — so a later change to the policy re-judges nothing; only a cancellation
 * recorded before the stamp (2026-09-25) falls back to `policy`'s current
 * window (`ClientStatsPolicy.isLateCancellation`).
 *
 * `placements` is who put each appointment in the book, as the commit
 * stamped it — the one input the aggregate does not carry. Only the
 * preferred barber reads it, and an appointment it does not name gives that
 * derivation no evidence (see `VisitPlacements`: never pass an inferred one).
 */
export function computeClientStats(
  subject: UserId,
  appointments: readonly Appointment[],
  nowMs: number,
  policy: ClientStatsPolicy = ClientStatsPolicy.default(),
  placements: VisitPlacements = NO_PLACEMENTS,
): ClientStats {
  const bridge = newBridge();
  const stats = ClientStatsSystem.stats(
    EcsUserId.of(subject.value),
    appointments.map((appointment) =>
      statsAppointmentOf(
        appointment,
        placements.get(appointment.id.value) ?? null,
        bridge,
      ),
    ),
    policy.toStruct(),
    nowMs,
  );
  return statsBack(stats, subject, bridge);
}

/**
 * Lifetime spend over worked visits (R33, §12.5.2): the person's own worked
 * seats, less their pro-rata share of the visit's discounts. Vouchers are a
 * way of PAYING, not a reduction, and tips were never the shop's price, so
 * neither moves it. A price in a currency with no fixed rate is left out
 * rather than guessed at.
 */
export function computeClientMoneyStats(
  subject: UserId,
  appointments: readonly Appointment[],
): ClientMoneyStats {
  const bridge = newBridge();
  const money = ClientStatsSystem.money(
    EcsUserId.of(subject.value),
    appointments.map((appointment): BilledAppointment => ({
      ...statsAppointmentOf(appointment, null, bridge),
      bill: {
        subtotal: moneyStruct(appointment.subtotal()),
        total: moneyStruct(appointment.total()),
      },
    })),
  );
  return {
    userId: subject,
    lifetimeSpendMinor: money.lifetimeSpend.amountMinorUnits,
    currencyCode: 'EUR',
  };
}

/** The windows every counter reads, computed at read from the stored instants (R33). */
export function statWindows(stats: ClientStats, nowMs: number): StatWindows {
  return ClientStatsSystem.statWindows(
    {
      lifetime: stats.lifetime,
      last365: {
        visitsCompleted: stats.last365.visitsCompleted.map(factStruct),
        noShows: stats.last365.noShows.map(factStruct),
        lateCancels: stats.last365.lateCancels.map(factStruct),
      },
    },
    nowMs,
  );
}

/* ── The Phase 2 bridge: legacy values ↔ ecs-core structs ──────────────── */

/**
 * What one call converted, so the answer comes back as the caller's own
 * instances: each seat struct and cancelled outcome by identity, each id by
 * its string (the first instance seen — equal by value to any other).
 */
interface Bridge {
  readonly seats: Map<EcsSeat, Seat>;
  readonly cancellations: Map<EcsSeatOutcome, Cancellation>;
  readonly appointments: Map<string, AppointmentId>;
  readonly seatIds: Map<string, SeatId>;
  readonly services: Map<string, ServiceId>;
  readonly variants: Map<string, ServiceVariantId>;
  readonly barbers: Map<string, BarberId>;
}

function newBridge(): Bridge {
  return {
    seats: new Map(),
    cancellations: new Map(),
    appointments: new Map(),
    seatIds: new Map(),
    services: new Map(),
    variants: new Map(),
    barbers: new Map(),
  };
}

function remember<T extends { readonly value: string }>(
  ids: Map<string, T>,
  id: T,
): void {
  if (!ids.has(id.value)) ids.set(id.value, id);
}

/** The value the bridge recorded for a key the call itself handed over. */
function known<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error('unreachable: a value the call never handed over');
  }
  return value;
}

function moneyStruct(money: Money): EcsMoney {
  return {
    amountMinorUnits: money.toMinorUnits(),
    currencyCode: money.currencyCode(),
  };
}

function outcomeStruct(outcome: SeatOutcome, bridge: Bridge): EcsSeatOutcome {
  if (outcome.kind !== 'cancelled') return outcome;
  const struct: EcsSeatOutcome = {
    kind: 'cancelled',
    atMs: outcome.atMs,
    by: outcome.by,
    reason: { kind: outcome.reason.kind },
    windowHours: outcome.window === null ? null : outcome.window.hours,
  };
  bridge.cancellations.set(struct, outcome);
  return struct;
}

function seatStruct(seat: Seat, bridge: Bridge): EcsSeat {
  remember(bridge.seatIds, seat.id);
  remember(bridge.services, seat.serviceId);
  remember(bridge.barbers, seat.barberId);
  if (seat.variantId !== null) remember(bridge.variants, seat.variantId);
  const subject = seat.subject;
  const struct: EcsSeat = {
    id: EcsSeatId.of(seat.id.value),
    serviceId: EcsServiceId.of(seat.serviceId.value),
    variantId:
      seat.variantId === null
        ? null
        : EcsServiceVariantId.of(seat.variantId.value),
    barberId: EcsBarberId.of(seat.barberId.value),
    barberPref: seat.pref === null ? null : seat.pref.kind,
    terms: {
      priceMinorUnits: seat.terms.price.toMinorUnits(),
      currencyCode: seat.terms.price.currencyCode(),
      durationMinutes: seat.terms.durationMinutes,
      setupMinutes: seat.terms.setupMinutes,
      cleanupMinutes: seat.terms.cleanupMinutes,
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    startMs: seat.startsAt.toMillis(),
    subject:
      subject.kind === 'account'
        ? EcsSeatSubject.account(
            EcsUserId.of(subject.userId.value),
            subject.relationship,
          )
        : EcsSeatSubject.anonymous(EcsSeatLabel.of(subject.label.value)),
    outcome: outcomeStruct(seat.outcome, bridge),
    tip: seat.tip === null ? null : moneyStruct(seat.tip),
  };
  bridge.seats.set(struct, seat);
  return struct;
}

/** The aggregate as the stats slice of the entity, with its commit's placement. */
function statsAppointmentOf(
  appointment: Appointment,
  placement: VisitPlacement | null,
  bridge: Bridge,
): StatsAppointment {
  remember(bridge.appointments, appointment.id);
  const slot = appointment.timeSlot;
  return {
    id: EcsAppointmentId.of(appointment.id.value),
    timeInterval: TimeInterval.of(slot.start.toMillis(), slot.end.toMillis()),
    bookedAtMs:
      appointment.bookedAt === null ? null : appointment.bookedAt.toMillis(),
    placement,
    seats: appointment.seats.map((seat) => seatStruct(seat, bridge)),
  };
}

function factStruct(fact: VisitFact): EcsVisitFact {
  return {
    appointmentId: EcsAppointmentId.of(fact.appointmentId.value),
    atMs: fact.atMs,
  };
}

function outcomeBack(
  outcome: EcsSubjectVisitOutcome,
  bridge: Bridge,
): VisitOutcome {
  switch (outcome.kind) {
    case SubjectVisitOutcomeKind.Cancelled:
      return {
        kind: 'cancelled',
        decisive: known(bridge.cancellations, outcome.decisive),
      };
    case SubjectVisitOutcomeKind.Worked:
      return { kind: 'worked' };
    case SubjectVisitOutcomeKind.NoShow:
      return { kind: 'no_show' };
    case SubjectVisitOutcomeKind.Open:
      return { kind: 'open' };
  }
}

function factBack(fact: EcsVisitFact, bridge: Bridge): VisitFact {
  return {
    appointmentId: known(bridge.appointments, fact.appointmentId),
    atMs: fact.atMs,
  };
}

function refBack(ref: EcsVisitRef | null, bridge: Bridge): VisitRef | null {
  if (ref === null) return null;
  return {
    ...factBack(ref, bridge),
    serviceIds: ref.serviceIds.map((id) => known(bridge.services, id)),
    barberIds: ref.barberIds.map((id) => known(bridge.barbers, id)),
    legs: ref.legs.map((leg) => ({
      seatId: known(bridge.seatIds, leg.seatId),
      serviceId: known(bridge.services, leg.serviceId),
      variantId:
        leg.variantId === null ? null : known(bridge.variants, leg.variantId),
      barberId: known(bridge.barbers, leg.barberId),
      minutes: leg.minutes,
    })),
  };
}

function suggestionBack(
  suggestion: EcsPauseSuggestion | null,
  bridge: Bridge,
): PauseSuggestion | null {
  if (suggestion === null) return null;
  return {
    noShows: suggestion.noShows,
    windowDays: suggestion.windowDays,
    basis: suggestion.basis.map((id) => known(bridge.appointments, id)),
    raisedAtMs: suggestion.raisedAtMs,
  };
}

function statsBack(
  stats: EcsClientStats,
  subject: UserId,
  bridge: Bridge,
): ClientStats {
  return {
    userId: subject,
    lifetime: stats.lifetime,
    last365: {
      visitsCompleted: stats.last365.visitsCompleted.map((fact) =>
        factBack(fact, bridge),
      ),
      noShows: stats.last365.noShows.map((fact) => factBack(fact, bridge)),
      lateCancels: stats.last365.lateCancels.map((fact) =>
        factBack(fact, bridge),
      ),
    },
    firstVisitAtMs: stats.firstVisitAtMs,
    lastVisit: refBack(stats.lastVisit, bridge),
    nextVisit: refBack(stats.nextVisit, bridge),
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId:
      stats.preferredBarberId === null
        ? null
        : known(bridge.barbers, stats.preferredBarberId),
    usualServiceIds: stats.usualServiceIds.map((id) =>
      known(bridge.services, id),
    ),
    pauseSuggestion: suggestionBack(stats.pauseSuggestion, bridge),
  };
}
