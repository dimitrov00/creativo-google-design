import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { Appointment } from './appointment';
import {
  CLIENT_STATS_BOUNDED_DAYS,
  ClientStatsPolicy,
} from './client-stats-policy';
import { AppointmentId, SeatId } from './ids';
import { Seat } from './seat';
import { SeatOutcome } from './seat-outcome';

const DAY_MS = 86_400_000;

/** The fixed rate BGN retired at (2026): legacy seats priced in leva count in euro. */
export const BGN_PER_EUR = 1.95583;

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
 * {@link CLIENT_STATS_BOUNDED_DAYS} days keep their instants; windows are
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
  switch (cancellation.reason.kind) {
    case 'staff_barber_absence':
    case 'staff_shop_closure':
      return false;
    case 'no_show_converted':
      return correctionAttribution === 'client';
    case 'client_changed_plans':
    case 'client_unwell':
      return true;
    case 'unspecified':
    case 'other':
      return cancellation.by === 'client';
  }
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
 * The person's own story of one appointment, from their seats alone — a
 * companion's no-show says nothing about the booker.
 *
 * Any worked seat makes it a visit: work happened for this person, even with
 * a second service still to come. Otherwise an open seat keeps it open, and
 * a no-show beats cancellations, as `summarizeSeatOutcomes` rules for the
 * party. A fully cancelled visit is decided by the seat called off LAST —
 * that is the cancellation that ended it.
 */
function outcomeOf(seats: readonly Seat[]): VisitOutcome {
  const outcomes = seats.map((seat) => seat.outcome);
  if (outcomes.some((outcome) => outcome.kind === 'worked')) {
    return { kind: 'worked' };
  }
  if (outcomes.some((outcome) => outcome.kind === 'scheduled')) {
    return { kind: 'open' };
  }
  if (outcomes.some((outcome) => outcome.kind === 'no_show')) {
    return { kind: 'no_show' };
  }
  let decisive: Cancellation | null = null;
  for (const outcome of outcomes) {
    if (outcome.kind !== 'cancelled') continue;
    if (decisive === null || outcome.atMs > decisive.atMs) decisive = outcome;
  }
  // Unreachable: seats are non-empty and every arm but `cancelled` returned.
  return decisive === null ? { kind: 'open' } : { kind: 'cancelled', decisive };
}

/** Oldest first, the id breaking ties — so input order never shows in the output. */
function chronological(a: SubjectVisit, b: SubjectVisit): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  const x = a.appointment.id.value;
  const y = b.appointment.id.value;
  return x < y ? -1 : x > y ? 1 : 0;
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
  const seats = appointment.seats.filter(
    (seat) =>
      seat.subject.kind === 'account' && seat.subject.userId.equals(subject),
  );
  if (seats.length === 0) return null;
  const slot = appointment.timeSlot;
  return {
    appointment,
    seats,
    atMs: slot.start.toMillis(),
    endMs: slot.end.toMillis(),
    outcome: outcomeOf(seats),
  };
}

/**
 * Every appointment this person has a seat on, as their visits. An
 * appointment listed twice counts once: the unit is the visit, and a caller
 * merging two reads must not be able to double it.
 */
function visitsOf(
  subject: UserId,
  appointments: readonly Appointment[],
): readonly SubjectVisit[] {
  const seen = new Set<string>();
  const visits: SubjectVisit[] = [];
  for (const appointment of appointments) {
    if (seen.has(appointment.id.value)) continue;
    seen.add(appointment.id.value);
    const visit = subjectVisitOf(subject, appointment);
    if (visit !== null) visits.push(visit);
  }
  return visits.sort(chronological);
}

function factOf(visit: SubjectVisit): VisitFact {
  return { appointmentId: visit.appointment.id, atMs: visit.atMs };
}

function distinctBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A visit as a reader shows it, from the seats that `keep` selects. */
function refOf(visit: SubjectVisit, keep: SeatOutcome['kind']): VisitRef {
  const seats = visit.seats.filter((seat) => seat.outcome.kind === keep);
  return {
    ...factOf(visit),
    serviceIds: distinctBy(
      seats.map((seat) => seat.serviceId),
      (id) => id.value,
    ),
    barberIds: distinctBy(
      seats.map((seat) => seat.barberId),
      (id) => id.value,
    ),
    legs: seats.map((seat) => ({
      seatId: seat.id,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      minutes: seat.durationMinutes(),
    })),
  };
}

/**
 * R34: the mean gap between consecutive worked visits, once there are three.
 * A gap the SHOP stretched — a visit it cancelled falls inside it — says
 * nothing about the client's rhythm and is left out; with every gap left out
 * there is no rhythm to state.
 */
function cadenceOf(
  worked: readonly SubjectVisit[],
  shopCancelled: readonly SubjectVisit[],
): number | null {
  if (worked.length < 3) return null;
  const gaps: number[] = [];
  let from: number | null = null;
  for (const { atMs: to } of worked) {
    const start = from;
    from = to;
    if (start === null) continue;
    if (shopCancelled.some((c) => c.atMs > start && c.atMs < to)) continue;
    gaps.push(to - start);
  }
  if (gaps.length === 0) return null;
  const meanDays = gaps.reduce((a, b) => a + b, 0) / gaps.length / DAY_MS;
  // One decimal: enough for "every ~4 weeks", and a stable number to store.
  return Math.round(meanDays * 10) / 10;
}

/**
 * Did this worked seat ASK for its barber by name (§11.2 #6)?
 *
 * Only on a visit its commit stamped (`VisitPlacements`). A self-placed
 * visit's preference is the client's own pick on /book. A staff placement's
 * is a request the form recorded explicitly — the commit stores an omitted
 * preference as unknown, never as `specific`, so a phone booking into
 * whichever chair was free is no evidence. A row the commit did not stamp
 * was written by the path that DID default an omitted preference to
 * `specific`, so it is ignored whatever its seats say and whoever the audit
 * trail says placed it (§12.5.1). A false «asks for Ivan» is worse than a
 * missing one, which new visits supply.
 */
function askedByName(
  seat: Seat,
  placement: VisitPlacement | undefined,
): boolean {
  if (placement === undefined) return false;
  return seat.outcome.kind === 'worked' && seat.pref?.kind === 'specific';
}

/**
 * The barber this client ASKS FOR: named (`pref: specific`) on at least two
 * of their last three visits. A seat that took whoever was free is no
 * evidence of a preference, and a legacy seat (`pref` unknown) or a visit
 * its commit did not stamp is none either — it still takes its place among
 * the last three. Two qualifying names go to the one asked for most recently.
 */
function preferredBarberOf(
  worked: readonly SubjectVisit[],
  placements: VisitPlacements,
): BarberId | null {
  const recent = worked.slice(-3).reverse();
  const tally = new Map<
    string,
    { id: BarberId; count: number; rank: number }
  >();
  recent.forEach((visit, rank) => {
    const placement = placements.get(visit.appointment.id.value);
    const asked = distinctBy(
      visit.seats
        .filter((seat) => askedByName(seat, placement))
        .map((seat) => seat.barberId),
      (id) => id.value,
    );
    for (const id of asked) {
      const entry = tally.get(id.value) ?? { id, count: 0, rank };
      tally.set(id.value, { ...entry, count: entry.count + 1 });
    }
  });
  const qualifying = [...tally.values()]
    .filter((entry) => entry.count >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.rank - b.rank ||
        (a.id.value < b.id.value ? -1 : 1),
    );
  return qualifying[0]?.id ?? null;
}

/** Services on ≥ 3 of the last 5 visits — most frequent, then most recent, first. */
function usualServicesOf(worked: readonly SubjectVisit[]): ServiceId[] {
  const recent = worked.slice(-5).reverse();
  const tally = new Map<
    string,
    { id: ServiceId; count: number; rank: number }
  >();
  recent.forEach((visit, rank) => {
    const services = distinctBy(
      visit.seats
        .filter((seat) => seat.outcome.kind === 'worked')
        .map((seat) => seat.serviceId),
      (id) => id.value,
    );
    for (const id of services) {
      const entry = tally.get(id.value) ?? { id, count: 0, rank };
      tally.set(id.value, { ...entry, count: entry.count + 1 });
    }
  });
  return [...tally.values()]
    .filter((entry) => entry.count >= 3)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.rank - b.rank ||
        (a.id.value < b.id.value ? -1 : 1),
    )
    .map((entry) => entry.id);
}

function within(facts: readonly VisitFact[], nowMs: number, days: number) {
  return facts.filter(
    (fact) => fact.atMs <= nowMs && nowMs - fact.atMs < days * DAY_MS,
  );
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
  const basis = within(noShows, nowMs, policy.suggestPauseWindowDays);
  if (basis.length < policy.suggestPauseNoShows) return null;
  const sorted = [...basis].sort(
    (a, b) =>
      a.atMs - b.atMs ||
      (a.appointmentId.value < b.appointmentId.value ? -1 : 1),
  );
  const raisedAtMs = (sorted[sorted.length - 1] as VisitFact).atMs;
  if (dismissedAtMs !== null && dismissedAtMs >= raisedAtMs) return null;
  return {
    noShows: sorted.length,
    windowDays: policy.suggestPauseWindowDays,
    basis: sorted.map((fact) => fact.appointmentId),
    raisedAtMs,
  };
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
  const visits = visitsOf(subject, appointments);
  const worked = visits.filter((visit) => visit.outcome.kind === 'worked');
  const noShows = visits.filter((visit) => visit.outcome.kind === 'no_show');
  const cancelled = visits.filter(
    (visit) => visit.outcome.kind === 'cancelled',
  );

  const onClient = (visit: SubjectVisit): boolean =>
    visit.outcome.kind === 'cancelled' && clientCaused(visit.outcome.decisive);
  const clientCancels = cancelled.filter(onClient);
  const shopCancelled = cancelled.filter((visit) => !onClient(visit));
  const lateCancels = clientCancels.filter(
    (visit) =>
      visit.outcome.kind === 'cancelled' &&
      visit.appointment.bookedAt !== null &&
      policy.isLateCancellation(
        visit.atMs,
        visit.outcome.decisive.atMs,
        visit.outcome.decisive.window,
      ),
  );

  const horizonMs = nowMs - CLIENT_STATS_BOUNDED_DAYS * DAY_MS;
  const bounded = (list: readonly SubjectVisit[]): VisitFact[] =>
    list.filter((visit) => visit.atMs > horizonMs).map(factOf);

  const last = worked[worked.length - 1];
  const next = visits.find(
    (visit) => visit.outcome.kind === 'open' && visit.endMs > nowMs,
  );
  const recentNoShows = bounded(noShows);

  return {
    userId: subject,
    lifetime: {
      visitsCompleted: worked.length,
      noShows: noShows.length,
      lateCancels: lateCancels.length,
      clientCancels: clientCancels.length,
    },
    last365: {
      visitsCompleted: bounded(worked),
      noShows: recentNoShows,
      lateCancels: bounded(lateCancels),
    },
    firstVisitAtMs: worked[0]?.atMs ?? null,
    lastVisit: last === undefined ? null : refOf(last, 'worked'),
    nextVisit: next === undefined ? null : refOf(next, 'scheduled'),
    avgCadenceDays: cadenceOf(worked, shopCancelled),
    preferredBarberId: preferredBarberOf(worked, placements),
    usualServiceIds: usualServicesOf(worked),
    pauseSuggestion: pauseSuggestionAt(recentNoShows, nowMs, policy),
  };
}

/** Minor units of a legacy currency in EUR, or `null` when there is no honest rate. */
function inEuroMinor(minor: number, currencyCode: string): number | null {
  if (currencyCode === 'EUR') return minor;
  if (currencyCode === 'BGN') return Math.round(minor / BGN_PER_EUR);
  return null;
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
  let spend = 0;
  for (const visit of visitsOf(subject, appointments)) {
    if (visit.outcome.kind !== 'worked') continue;
    const own = visit.seats
      .filter((seat) => seat.outcome.kind === 'worked')
      .reduce((sum, seat) => sum + seat.terms.price.toMinorUnits(), 0);
    const subtotal = visit.appointment.subtotal();
    const gross = subtotal.toMinorUnits();
    const net =
      gross > 0
        ? Math.round((own * visit.appointment.total().toMinorUnits()) / gross)
        : 0;
    spend += inEuroMinor(net, subtotal.currencyCode()) ?? 0;
  }
  return { userId: subject, lifetimeSpendMinor: spend, currencyCode: 'EUR' };
}

/** The windows every counter reads, computed at read from the stored instants (R33). */
export function statWindows(stats: ClientStats, nowMs: number): StatWindows {
  const windowed = (
    lifetime: number,
    facts: readonly VisitFact[],
  ): WindowedCount => ({
    lifetime,
    last12m: within(facts, nowMs, 365).length,
    last90d: within(facts, nowMs, 90).length,
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
}
