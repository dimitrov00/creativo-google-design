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
  Currency,
  DurationMinutes,
  EndMinute,
  type LocalDate,
  MinuteCount,
  type MinuteOfDay,
  PriceCents,
  SeatId as EcsSeatId,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  type TimeZone,
  UserId as EcsUserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  BarberPreference as EcsBarberPreference,
  CancellationReason as EcsCancellationReason,
  CancelledBy as EcsCancelledBy,
  type ClientStats as EcsClientStats,
  type PauseSuggestion as EcsPauseSuggestion,
  Placement,
  Seat as EcsSeatComponent,
  SeatLabel as EcsSeatLabel,
  SeatOccupant,
  SubjectRelationship as EcsSubjectRelationship,
  type VisitFact as EcsVisitFact,
  type VisitLeg as EcsVisitLeg,
} from '@core/components';
import {
  type AppointmentBill,
  type BilledAppointment,
  CancellationAttribution as EcsCancellationAttribution,
  ClientStatsSystem,
  type PauseBasisFact,
  type StatsAppointment,
  SubjectVisitOutcome as EcsSubjectVisitOutcome,
  type SubjectVisitOutcomeState,
  ZonedTimeSystem,
} from '@core/systems';
import type { Appointment } from './appointment';
import { ClientStatsPolicy } from './client-stats-policy';
import type { AppointmentId, SeatId } from './ids';
import type { Seat, SeatRelationship } from './seat';
import { type SeatOutcome, toEcsSeatOutcome } from './seat-outcome';

/*
 * Phase 2 shim: the statistics are `ClientStatsSystem` in
 * `@core/systems`. This file keeps the legacy shapes (class ids, the
 * `Appointment` aggregate, epoch-ms instants, the flat spend) for its
 * callers and converts at the edge: appointments go in as the stats slice
 * of the entity (seats flat, outcomes through `toEcsSeatOutcome`), "now" as
 * the shop's `ShopNow` and a stored instant as the shop wall clock,
 * both through `ZonedTimeSystem` in the shop's zone; every id, seat, outcome
 * and instant comes back as the caller's own value.
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
    {
      cancelledBy: CANCELLED_BY_OF[cancellation.by],
      cancellationReason: REASON_OF[cancellation.reason.kind],
    },
    correctionAttribution === null
      ? null
      : ATTRIBUTION_OF[correctionAttribution],
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
  const slot = slotOf(appointment);
  return {
    appointment,
    seats: visit.seats.map((seat) => known(bridge.seats, seat)),
    atMs: slot.start.toMillis(),
    endMs: slot.end.toMillis(),
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
  const zone = SHOP_ZONE;
  const basis: PauseBasisFact[] = [];
  for (const fact of noShows) {
    remember(bridge.appointments, fact.appointmentId);
    // A fact that is not an instant was never inside a window.
    const struct = basisStruct(fact, zone);
    if (struct !== null) basis.push(struct);
  }
  const dismissedAt =
    dismissedAtMs === null ? null : instantOrNull(dismissedAtMs);
  return suggestionBack(
    ClientStatsSystem.pauseSuggestionAt(
      basis,
      shopNowOf(nowMs, zone),
      policy.toStruct(),
      dismissedAt,
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
    shopNowOf(nowMs, zoneOf(appointments)),
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
  const billed: BilledAppointment[] = [];
  for (const appointment of appointments) {
    const bill = billOf(appointment.subtotal(), appointment.total());
    // A bill in a currency with no code to read has no honest rate either:
    // the spend leaves it out, as it leaves out any rate-less currency.
    if (bill === null) continue;
    billed.push({ ...statsAppointmentOf(appointment, null, bridge), bill });
  }
  const money = ClientStatsSystem.money(EcsUserId.of(subject.value), billed);
  return {
    userId: subject,
    lifetimeSpendMinor: money.lifetimeSpendCents,
    currencyCode: 'EUR',
  };
}

/** The windows every counter reads, computed at read from the stored instants (R33). */
export function statWindows(stats: ClientStats, nowMs: number): StatWindows {
  const zone = SHOP_ZONE;
  return ClientStatsSystem.statWindows(
    {
      lifetimeVisitsCompleted: stats.lifetime.visitsCompleted,
      lifetimeNoShows: stats.lifetime.noShows,
      lifetimeLateCancels: stats.lifetime.lateCancels,
      last365VisitsCompleted: factsStruct(stats.last365.visitsCompleted, zone),
      last365NoShows: factsStruct(stats.last365.noShows, zone),
      last365LateCancels: factsStruct(stats.last365.lateCancels, zone),
    },
    shopNowOf(nowMs, zone),
  );
}

/* ── The Phase 2 bridge: legacy values ↔ ecs-core structs ──────────────── */

/**
 * The shop's zone where a call names no appointment to read one from — the
 * single shop's (blueprint §7.1, Europe/Sofia only; `TENANT_ZONE` on the
 * server). Phase 4 deletes it with this file.
 */
const SHOP_ZONE: TimeZone = zoneOrThrow('Europe/Sofia');

function zoneOrThrow(raw: string): TimeZone {
  const zone = ZonedTimeSystem.checkZone(raw);
  if (!zone.ok) defect(`unreachable: a zone that is none (${raw})`);
  return zone.value;
}

/** The zone the appointments' own instants carry (the first seat's, as stored). */
function zoneOf(appointments: readonly Appointment[]): TimeZone {
  for (const appointment of appointments) {
    const zone = appointment.seats[0]?.startsAt.zoneName;
    if (zone !== undefined) {
      const checked = ZonedTimeSystem.checkZone(zone);
      if (checked.ok) return checked.value;
    }
  }
  return SHOP_ZONE;
}

function instantOrNull(ms: number): UtcEpochMs | null {
  const instant = UtcEpochMs.of(ms);
  return instant.ok ? instant.value : null;
}

/** "Now" on the shop's clock — the legacy clocks are `Date.now`-shaped. */
function shopNowOf(nowMs: number, zone: TimeZone) {
  const now = instantOrNull(nowMs);
  if (now === null) defect(`unreachable: a clock read ${nowMs}`);
  return ZonedTimeSystem.shopNow(now, zone);
}

/** The legacy side strings ↔ `CancelledBy` — the ONE table. */
const CANCELLED_BY_OF = {
  client: EcsCancelledBy.Client,
  staff: EcsCancelledBy.Staff,
} as const satisfies Record<Cancellation['by'], EcsCancelledBy>;

/** The legacy reason codes ↔ `CancellationReason` — the ONE table. */
const REASON_OF = {
  client_changed_plans: EcsCancellationReason.ClientChangedPlans,
  client_unwell: EcsCancellationReason.ClientUnwell,
  staff_barber_absence: EcsCancellationReason.StaffBarberAbsence,
  staff_shop_closure: EcsCancellationReason.StaffShopClosure,
  no_show_converted: EcsCancellationReason.NoShowConverted,
  unspecified: EcsCancellationReason.Unspecified,
  other: EcsCancellationReason.Other,
} as const satisfies Record<
  Cancellation['reason']['kind'],
  EcsCancellationReason
>;

/** The legacy attributions ↔ `CancellationAttribution` — the ONE table. */
const ATTRIBUTION_OF = {
  client: EcsCancellationAttribution.Client,
  shop: EcsCancellationAttribution.Shop,
} as const satisfies Record<
  CancellationAttribution,
  EcsCancellationAttribution
>;

/** The legacy placements ↔ `Placement` — the ONE table. */
const PLACEMENT_OF = {
  self: Placement.Self,
  staff: Placement.Staff,
} as const satisfies Record<VisitPlacement, Placement>;

/** The legacy visit outcomes ↔ `SubjectVisitOutcome` — the ONE table. */
const LEGACY_SUBJECT_VISIT_OUTCOME = {
  [EcsSubjectVisitOutcome.Worked]: 'worked',
  [EcsSubjectVisitOutcome.NoShow]: 'no_show',
  [EcsSubjectVisitOutcome.Cancelled]: 'cancelled',
  [EcsSubjectVisitOutcome.Open]: 'open',
} as const satisfies Record<EcsSubjectVisitOutcome, VisitOutcome['kind']>;

/**
 * What one call converted, so the answer comes back as the caller's own
 * instances: each seat struct by identity (to the caller's seat), each id
 * by its string (the first instance seen — equal by value to any other),
 * and each appointment's start instant by its id and by its wall clock.
 */
interface Bridge {
  readonly seats: Map<object, Seat>;
  readonly appointments: Map<string, AppointmentId>;
  readonly starts: Map<string, number>;
  readonly startsByWall: Map<string, number>;
  readonly seatIds: Map<string, SeatId>;
  readonly services: Map<string, ServiceId>;
  readonly variants: Map<string, ServiceVariantId>;
  readonly barbers: Map<string, BarberId>;
}

function newBridge(): Bridge {
  return {
    seats: new Map(),
    appointments: new Map(),
    starts: new Map(),
    startsByWall: new Map(),
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
    defect('unreachable: a value the call never handed over');
  }
  return value;
}

const wallKey = (localDate: LocalDate, minutes: MinuteOfDay): string =>
  `${localDate}@${minutes}`;

/**
 * A spend figure as the bill's cents and currency; `null` when its currency
 * is no code the brand knows (it has no rate, so it never counts).
 */
function billOf(subtotal: Money, total: Money): AppointmentBill | null {
  const currency = Currency.parse(subtotal.currencyCode());
  const subtotalCents = PriceCents.signed(subtotal.toMinorUnits());
  const totalCents = PriceCents.signed(total.toMinorUnits());
  if (!currency.ok || !subtotalCents.ok || !totalCents.ok) return null;
  return {
    subtotalCents: subtotalCents.value,
    totalCents: totalCents.value,
    currency: currency.value,
  };
}

/** The legacy preference kinds ↔ `BarberPreference` — the ONE table. */
const PREFERENCE_OF = {
  any: EcsBarberPreference.Any,
  specific: EcsBarberPreference.Specific,
} as const satisfies Record<
  NonNullable<Seat['pref']>['kind'],
  EcsBarberPreference
>;

/** The legacy relationships ↔ `SubjectRelationship` — the ONE table. */
const RELATIONSHIP_OF = {
  self: EcsSubjectRelationship.Self,
  companion: EcsSubjectRelationship.Companion,
  client: EcsSubjectRelationship.Client,
} as const satisfies Record<SeatRelationship, EcsSubjectRelationship>;

/**
 * The party block — the earliest seat start to the latest seat end, each the
 * legacy instant of its seat's own slot (the legacy reduce, kept: the first
 * seat at each bound). Read off the seats rather than the aggregate's
 * derived `timeSlot`, so a legacy visit that runs past midnight still reads.
 */
function slotOf(appointment: Appointment): {
  readonly start: Seat['startsAt'];
  readonly end: Seat['startsAt'];
} {
  const [first, ...rest] = appointment.seats;
  if (first === undefined) {
    defect('unreachable: an appointment without seats');
  }
  let start = first.slot.start;
  let end = first.slot.end;
  for (const seat of rest) {
    const slot = seat.slot;
    if (slot.start.toMillis() < start.toMillis()) start = slot.start;
    if (slot.end.toMillis() > end.toMillis()) end = slot.end;
  }
  return { start, end };
}

/** A value the legacy class already guaranteed, as its brand. */
function sure<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!result.ok) defect('unreachable: a value its class guaranteed');
  return result.value;
}

const centsOf = (money: Money): PriceCents =>
  sure(PriceCents.signed(money.toMinorUnits()));

/**
 * A legacy seat as the flat `Seat` the statistics read — its start on the
 * visit's wall clock, its money in cents, its outcome through the seat
 * outcome's own converter. The catalogue terms are no stat's input.
 */
function seatStruct(seat: Seat, zone: TimeZone): EcsSeatComponent {
  const subject = seat.subject;
  const start = ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(seat.startsAt.toMillis())),
    zone,
  );
  return EcsSeatComponent.compose(
    {
      seatId: EcsSeatId.of(seat.id.value),
      serviceId: EcsServiceId.of(seat.serviceId.value),
      variantId:
        seat.variantId === null
          ? null
          : EcsServiceVariantId.of(seat.variantId.value),
      barberId: EcsBarberId.of(seat.barberId.value),
      barberPreference:
        seat.pref === null ? null : PREFERENCE_OF[seat.pref.kind],
      startMinutes: start.minute,
      tipCents: seat.tip === null ? null : centsOf(seat.tip),
    },
    {
      priceCents: centsOf(seat.terms.price),
      currency: sure(Currency.parse(seat.terms.price.currencyCode())),
      durationMinutes: sure(DurationMinutes.of(seat.terms.durationMinutes)),
      setupMinutes: sure(MinuteCount.of(seat.terms.setupMinutes)),
      cleanupMinutes: sure(MinuteCount.of(seat.terms.cleanupMinutes)),
      catalogPriceCents: null,
      catalogDurationMinutes: null,
    },
    subject.kind === 'account'
      ? SeatOccupant.account(
          EcsUserId.of(subject.userId.value),
          RELATIONSHIP_OF[subject.relationship],
        )
      : SeatOccupant.anonymous(EcsSeatLabel.of(subject.label.value)),
    toEcsSeatOutcome(seat.outcome),
  );
}

/**
 * The aggregate as the stats slice of the entity, with its commit's
 * placement: the visit's day, start and instant from its slot's start on its
 * own zone's wall clock, its end on the same day — a legacy visit that runs
 * past midnight is clipped at 1440, as the projections clip chair time
 * (flatten-spec T7) — and the seats one by one, each mapped back to the
 * caller's own by identity.
 */
function statsAppointmentOf(
  appointment: Appointment,
  placement: VisitPlacement | null,
  bridge: Bridge,
): StatsAppointment {
  remember(bridge.appointments, appointment.id);
  const zone = zoneOf([appointment]);
  const slot = slotOf(appointment);
  const startMs = slot.start.toMillis();
  const utcEpochMs = sure(UtcEpochMs.of(startMs));
  const start = ZonedTimeSystem.toLocal(utcEpochMs, zone);
  const end = ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(slot.end.toMillis())),
    zone,
  );
  const endMinutes = sure(
    EndMinute.of(end.localDate === start.localDate ? end.minute : 1440),
  );
  bridge.starts.set(appointment.id.value, startMs);
  bridge.startsByWall.set(wallKey(start.localDate, start.minute), startMs);
  const seats: EcsSeatComponent[] = [];
  for (const seat of appointment.seats) {
    remember(bridge.seatIds, seat.id);
    remember(bridge.services, seat.serviceId);
    remember(bridge.barbers, seat.barberId);
    if (seat.variantId !== null) remember(bridge.variants, seat.variantId);
    const struct = seatStruct(seat, zone);
    bridge.seats.set(struct, seat);
    seats.push(struct);
  }
  return {
    id: EcsAppointmentId.of(appointment.id.value),
    localDate: start.localDate,
    startMinutes: start.minute,
    endMinutes,
    utcEpochMs,
    bookedAtUtcMs:
      appointment.bookedAt === null
        ? null
        : sure(UtcEpochMs.of(appointment.bookedAt.toMillis())),
    placement: placement === null ? null : PLACEMENT_OF[placement],
    seats,
  };
}

/** A stored fact on the shop's wall clock; `null` for one that is not an instant. */
function factStruct(fact: VisitFact, zone: TimeZone): EcsVisitFact | null {
  const instant = instantOrNull(fact.atMs);
  if (instant === null) return null;
  const wall = ZonedTimeSystem.toLocal(instant, zone);
  return {
    appointmentId: EcsAppointmentId.of(fact.appointmentId.value),
    localDate: wall.localDate,
    startMinutes: wall.minute,
  };
}

/** The facts the windows can read — one that is not an instant is in none of them. */
function factsStruct(
  facts: readonly VisitFact[],
  zone: TimeZone,
): EcsVisitFact[] {
  const out: EcsVisitFact[] = [];
  for (const fact of facts) {
    const struct = factStruct(fact, zone);
    if (struct !== null) out.push(struct);
  }
  return out;
}

/** A stored no-show as the pause suggestion's basis — its fact and its start instant. */
function basisStruct(fact: VisitFact, zone: TimeZone): PauseBasisFact | null {
  const struct = factStruct(fact, zone);
  const startUtcMs = instantOrNull(fact.atMs);
  return struct === null || startUtcMs === null
    ? null
    : { ...struct, startUtcMs };
}

function outcomeBack(
  outcome: SubjectVisitOutcomeState,
  bridge: Bridge,
): VisitOutcome {
  switch (outcome.subjectVisitOutcome) {
    case EcsSubjectVisitOutcome.Cancelled: {
      const decisive = known(bridge.seats, outcome.decisive).outcome;
      if (decisive.kind !== 'cancelled') {
        defect('unreachable: a decisive seat not cancelled');
      }
      return { kind: 'cancelled', decisive };
    }
    case EcsSubjectVisitOutcome.Worked:
    case EcsSubjectVisitOutcome.NoShow:
    case EcsSubjectVisitOutcome.Open:
      return {
        kind: LEGACY_SUBJECT_VISIT_OUTCOME[outcome.subjectVisitOutcome],
      };
  }
}

/** A fact back: the caller's id, and the start instant its appointment came in with. */
function factBack(fact: EcsVisitFact, bridge: Bridge): VisitFact {
  return {
    appointmentId: known(bridge.appointments, fact.appointmentId),
    atMs: known(bridge.starts, fact.appointmentId),
  };
}

function refBack(
  fact: EcsVisitFact | null,
  serviceIds: readonly string[],
  barberIds: readonly string[],
  legs: readonly EcsVisitLeg[],
  bridge: Bridge,
): VisitRef | null {
  if (fact === null) return null;
  return {
    ...factBack(fact, bridge),
    serviceIds: serviceIds.map((id) => known(bridge.services, id)),
    barberIds: barberIds.map((id) => known(bridge.barbers, id)),
    legs: legs.map((leg) => ({
      seatId: known(bridge.seatIds, leg.seatId),
      serviceId: known(bridge.services, leg.serviceId),
      variantId:
        leg.variantId === null ? null : known(bridge.variants, leg.variantId),
      barberId: known(bridge.barbers, leg.barberId),
      minutes: leg.durationMinutes,
    })),
  };
}

function suggestionBack(
  suggestion: EcsPauseSuggestion,
  bridge: Bridge,
): PauseSuggestion | null {
  if (
    suggestion.pauseSuggestedNoShows === null ||
    suggestion.pauseSuggestedWindowDays === null ||
    suggestion.pauseSuggestedAtUtcMs === null
  ) {
    return null;
  }
  return {
    noShows: suggestion.pauseSuggestedNoShows,
    windowDays: suggestion.pauseSuggestedWindowDays,
    basis: suggestion.pauseSuggestionBasis.map((id) =>
      known(bridge.appointments, id),
    ),
    raisedAtMs: suggestion.pauseSuggestedAtUtcMs,
  };
}

function statsBack(
  stats: EcsClientStats,
  subject: UserId,
  bridge: Bridge,
): ClientStats {
  const facts = (list: readonly EcsVisitFact[]) =>
    list.map((fact) => factBack(fact, bridge));
  return {
    userId: subject,
    lifetime: {
      visitsCompleted: stats.lifetimeVisitsCompleted,
      noShows: stats.lifetimeNoShows,
      lateCancels: stats.lifetimeLateCancels,
      clientCancels: stats.lifetimeClientCancels,
    },
    last365: {
      visitsCompleted: facts(stats.last365VisitsCompleted),
      noShows: facts(stats.last365NoShows),
      lateCancels: facts(stats.last365LateCancels),
    },
    firstVisitAtMs:
      stats.firstVisitLocalDate === null ||
      stats.firstVisitStartMinutes === null
        ? null
        : known(
            bridge.startsByWall,
            wallKey(stats.firstVisitLocalDate, stats.firstVisitStartMinutes),
          ),
    lastVisit: refBack(
      stats.lastVisitAppointmentId === null ||
        stats.lastVisitLocalDate === null ||
        stats.lastVisitStartMinutes === null
        ? null
        : {
            appointmentId: stats.lastVisitAppointmentId,
            localDate: stats.lastVisitLocalDate,
            startMinutes: stats.lastVisitStartMinutes,
          },
      stats.lastVisitServiceIds,
      stats.lastVisitBarberIds,
      stats.lastVisitLegs,
      bridge,
    ),
    nextVisit: refBack(
      stats.nextVisitAppointmentId === null ||
        stats.nextVisitLocalDate === null ||
        stats.nextVisitStartMinutes === null
        ? null
        : {
            appointmentId: stats.nextVisitAppointmentId,
            localDate: stats.nextVisitLocalDate,
            startMinutes: stats.nextVisitStartMinutes,
          },
      stats.nextVisitServiceIds,
      stats.nextVisitBarberIds,
      stats.nextVisitLegs,
      bridge,
    ),
    avgCadenceDays: stats.avgCadenceDays,
    preferredBarberId:
      stats.preferredBarberId === null
        ? null
        : known(bridge.barbers, stats.preferredBarberId),
    usualServiceIds: stats.usualServiceIds.map((id) =>
      known(bridge.services, id),
    ),
    pauseSuggestion: suggestionBack(stats, bridge),
  };
}
