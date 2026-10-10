import { BarberId } from '@creativo/domain/catalog';
import {
  type AvailabilityLine as EcsAvailabilityLine,
  type AvailabilityQuery as EcsAvailabilityQuery,
  AvailabilitySystem,
  BarberId as EcsBarberId,
  type BarberPref as EcsBarberPref,
  type BookingPolicy as EcsBookingPolicy,
  type ChairTime as EcsChairTime,
} from '@creativo/ecs-core';
import { BarberPref } from './barber-pref';
import { BookingPolicy } from './booking-policy';
import { Interval } from './interval';
import { RosterWindow } from './roster-window';

/** How long a line takes, and the setup/cleanup that surrounds it. */
export interface LineTerms {
  readonly durationMinutes: number;
  readonly padBeforeMinutes: number;
  readonly padAfterMinutes: number;
}

/**
 * One line the party wants served, already resolved to durations.
 *
 * The flat fields are the DEFAULT terms — `Service.termsFor(null, variantId)`,
 * the catalog duration before anyone picks a barber. `termsByBarber` holds the
 * per-barber overrides, keyed by `BarberId.value`.
 *
 * **Why terms depend on the barber.** The catalog prices a service per barber
 * (`Service.termsFor(barberId, variantId)`), so a fade can be 30 minutes with
 * one barber and 45 with another. With an `any` preference, collapsing that to
 * a single number is wrong in both directions: take the maximum and the faster
 * barber's 30-minute gaps are never offered; take the minimum and the slower
 * one is booked into a slot they cannot finish in. Resolving per candidate
 * barber is the only answer that is right for each.
 *
 * The engine never consults the catalog: everything it needs is here, which is
 * what lets the identical code run in the browser and inside a Cloud Function.
 */
export interface AvailabilityLine extends LineTerms {
  /** Stable identity so an option's assignments can be matched back to the cart. */
  readonly lineId: string;
  readonly barberPref: BarberPref;
  /** Per-barber overrides, keyed by `BarberId.value`. Absent ⇒ the defaults. */
  readonly termsByBarber?: ReadonlyMap<string, LineTerms>;
  /**
   * WHO this line is for — lines sharing a key are one person
   * (`cartToAvailabilityLines` gives it the cart's seat key).
   *
   * One person can never sit in two chairs at once (owner decision,
   * 2026-09-25), so no arrangement gives two lines of one person overlapping
   * SOLD slots (`sitsTwiceAt`). Without it the engine was person-blind: a
   * client with a cut and a beard, both «any barber», was offered both at
   * 10:00 in two chairs. Back to back stays fine, in one chair or two.
   *
   * Absent ⇒ a person of their own, which is what every line was before.
   */
  readonly personKey?: string;
}

/** The terms this line takes with THIS barber. */
export function termsForBarber(
  line: AvailabilityLine,
  barberId: BarberId,
): LineTerms {
  const [terms] = AvailabilitySystem.denseTerms(
    line,
    [
      {
        barberId: EcsBarberId.of(barberId.value),
        windows: [],
        busy: [],
        blocks: [],
      },
    ],
    overridesOf(line),
  );
  return terms ?? line;
}

/**
 * A barber's day, as the engine consumes it.
 *
 * `busy` must arrive **already padded** by this barber's turnaround. That is
 * the single place separation between unrelated clients is applied, and the
 * engine deliberately has no `turnaroundMinutes` of its own so it cannot be
 * applied twice.
 *
 * The reason padding belongs on the busy side and not on the candidate: a
 * padded busy block already prevents a new booking from ending too close to
 * it AND from starting too soon after it, so one operation covers both
 * directions. Extending the candidate as well would demand two turnarounds'
 * worth of room for one turnaround's worth of separation — verified: a
 * 45-minute service in a 45-minute gap was rejected because 15 minutes of
 * already-applied turnaround got charged a second time.
 */
export interface BarberDayAvailability {
  readonly barberId: BarberId;
  readonly windows: readonly RosterWindow[];
  /** Already-taken intervals, ALREADY padded by this barber's turnaround. */
  readonly busy: readonly Interval[];
  /**
   * The stretches CARVED OUT of the worked day — breaks and admin blocks, as
   * things rather than as absences (`buildDayCarveOuts`).
   *
   * The engine ignores these: they were already subtracted from `windows`, so
   * counting them again would double-remove the same minutes. They are here
   * for the surfaces that must DRAW a block — a staff calendar has to say
   * "Ivan is on lunch" rather than rendering it identically to "the shop is
   * shut", and that distinction is impossible to recover from `windows`
   * alone.
   *
   * Optional so the seven existing constructions of this type keep compiling
   * and keep meaning exactly what they meant; absent is "nobody asked".
   */
  readonly blocks?: readonly RosterWindow[];
}

/**
 * The chair time one barber is held for: a seat's setup, service and
 * cleanup, as instants (`Seat.chairTime`). It is what a seat puts into the
 * busy projection, and what a move hands back before it places the same
 * visit again (`Appointment.chairTimes`).
 */
export interface ChairTime {
  readonly barberId: BarberId;
  readonly occupied: Interval;
}

/**
 * A barber's stored busy spans → the `busy` a placement is checked against
 * ({@link BarberDayAvailability.busy}): what is taken, padded by this
 * barber's turnaround.
 *
 * ONE rule for both sides. The grid's read (`AvailabilityReader`) and the
 * server's commit-time check (`decideBooking`) each used to pad on their own.
 * A second copy is how the grid comes to offer a time the server refuses.
 *
 * `release` is chair time handed back FIRST: the visit being MOVED. Its own
 * seats never block its own move, because the server decides a move with the
 * visit's contribution subtracted (`FirestoreBookingStore.reschedule`). It is
 * released BEFORE the padding, never after. The turnaround around a
 * neighbour's span belongs to the neighbour and must survive, and only
 * padding what is left gives the server's answer. Subtracting the padded
 * geometry instead would free a neighbour's turnaround. Entries naming
 * other barbers are ignored, so a whole visit's chair times can be passed
 * for every barber.
 */
export function paddedBusy(input: {
  readonly barberId: BarberId;
  /** The spans as the projection stores them: UNPADDED. */
  readonly spans: readonly Interval[];
  readonly turnaroundMinutes: number;
  readonly release?: readonly ChairTime[];
}): readonly Interval[] {
  return AvailabilitySystem.paddedBusy({
    barberId: EcsBarberId.of(input.barberId.value),
    spans: input.spans,
    turnaroundMinutes: input.turnaroundMinutes,
    release: (input.release ?? []).map(toEcsChairTime),
  });
}

export interface AvailabilityAssignment {
  readonly lineId: string;
  readonly barberId: BarberId;
  readonly slot: Interval;
}

/**
 * One way the whole party can be served.
 *
 * `envelope` spans from the earliest assignment start to the latest end. For a
 * PARALLEL arrangement that is the longest single seat; for a SEQUENTIAL one it
 * spans the chain. The engine returns both kinds and the UI shows what exists
 * — the user never picks an arrangement "mode" (owner ruling, 2026-07-29).
 */
export interface AvailabilityOption {
  readonly envelope: Interval;
  readonly assignments: readonly AvailabilityAssignment[];
}

/**
 * Somebody who comes WITH the party without being searched for: a seat the
 * server carries forward when a client moves a visit (a companion the shop
 * seated beside them — `RescheduleBookingUseCase`).
 *
 * Nothing about a rider is free. Their barber and their terms are the stored
 * seat's, and so is their distance from the party: `offsetMinutes` from the
 * party's earliest SOLD start to theirs, negative when they go first. It is
 * placed by the same shift the server applies (`carriedStartMs`), so the
 * rider lands where the server will put them. The engine therefore never
 * places a rider; it refuses every
 * arrangement that would strand one, and a start is offered only when some
 * arrangement at it leaves every rider room.
 *
 * Riders are not in the option: the envelope and the assignments stay what
 * the CLIENT chose, so the grid, the review and the commit are unchanged.
 */
export interface AvailabilityRider {
  readonly barberId: BarberId;
  /** Minutes from the party's earliest sold start to this rider's sold start. */
  readonly offsetMinutes: number;
  /** The terms the seat was sold at — its chair time is what must fit. */
  readonly terms: LineTerms;
}

export interface AvailabilityQuery {
  readonly lines: readonly AvailabilityLine[];
  readonly barbers: readonly BarberDayAvailability[];
  readonly policy: BookingPolicy;
  /** Nothing may start before this — `now + minLeadMinutes`, already applied. */
  readonly notBeforeMs: number;
  /** Cap on returned options, so a wide-open day cannot produce thousands. */
  readonly maxOptions?: number;
  /**
   * People pinned to the party's start — see {@link AvailabilityRider}.
   * Absent or empty on every ordinary booking; only a client MOVE carries
   * them.
   */
  readonly riders?: readonly AvailabilityRider[];
  /**
   * Only consider time inside these intervals — the client's own declared
   * windows ("the 26th, but only 08:00–12:00").
   *
   * `undefined` means unconstrained, which is not the same as `[]`: an empty
   * array is a caller saying "nothing qualifies" and correctly yields no
   * options. See {@link DayWindows.toIntervals}, which returns the whole day
   * rather than `[]` for an unnarrowed day precisely so the two never blur.
   */
  readonly withinMs?: readonly Interval[];
}

/**
 * Candidate starts for one line within one barber's free time.
 *
 * Aligned to the policy grid measured from the WINDOW start, not from
 * midnight: a shift beginning 09:30 should offer 09:30, not 09:45, and a
 * midnight-anchored grid silently discards the first half-step of every
 * odd-starting shift.
 */
export function candidateStarts(
  free: readonly Interval[],
  durationMinutes: number,
  stepMinutes: number,
  notBeforeMs: number,
): readonly number[] {
  return AvailabilitySystem.candidateStarts(
    free,
    durationMinutes,
    stepMinutes,
    notBeforeMs,
  );
}

/**
 * Every way the party can be served, ranked.
 *
 * ### The algorithm
 * Lines are assigned by backtracking search over candidate starts. For each
 * line, in a deterministic order, try every (barber, start) pair that fits
 * that barber's free time and does not collide with an assignment already
 * made in this branch; recurse; on success record the option.
 *
 * ### Determinism
 * Two identical queries must return byte-identical options, or the grid
 * flickers and the server's re-check can disagree with the client that
 * offered the slot. Three rules guarantee it:
 *
 * 1. **Lines are ordered before searching** — `specific` preferences first
 *    (they are the constrained ones; placing them last strands them), then
 *    longer durations, then `lineId`. No dependence on cart order.
 * 2. **Barbers are tried in the caller's given order** for each line, and
 *    that order is itself stable (the projection reads by sorted id).
 * 3. **Options are sorted** by envelope start, then envelope end, then the
 *    assignment barber ids — so a shorter, earlier arrangement always wins,
 *    and ties break on data rather than on search order.
 *
 * ### Why one barber may appear twice
 * Two assignments naming the SAME barber must not overlap. Non-overlapping is
 * explicitly allowed, which is what makes "father and son, same barber, back
 * to back" a first-class result rather than an error — the case a "no barber
 * twice" rule would have destroyed.
 *
 * ### Why one person may not
 * The other collision rule is its mirror: two lines of the SAME person
 * (`AvailabilityLine.personKey`) must not overlap either, measured on the
 * sold slots (`sitsTwiceAt`) — the server's decision refuses exactly that.
 */
export function availableOptions(
  query: AvailabilityQuery,
): readonly AvailabilityOption[] {
  const ecs = toEcsQuery(query);
  return toLegacyOptions(
    query,
    AvailabilitySystem.availableOptions(ecs, budgetOf(query)).options,
  );
}

/**
 * ONE canonical arrangement per distinct party start — what the slot grid
 * renders.
 *
 * Not `availableOptions(...).filter(unique by start)`: the exhaustive search
 * is capped, and with a party of two and three barbers the cap is reached
 * inside the first couple of hours. Filtering afterwards therefore does not
 * thin a full day's worth of arrangements — it shows the morning and hides
 * the afternoon entirely, which is a grid that lies about the shop's day.
 *
 * Deduplicating DURING the search spends the same budget on breadth instead
 * of on the ninth way to arrange 09:15. The arrangement kept for a start is
 * the TIGHTEST one — smallest envelope, ties broken on the barber ids — not
 * merely the first the walk reaches: "you at 09:00, your son at 10:55" is a
 * technically valid sequential arrangement and a terrible thing to offer
 * when 09:00 and 09:30 back-to-back exists.
 */
export function availableStarts(
  query: AvailabilityQuery,
): readonly AvailabilityOption[] {
  const ecs = toEcsQuery(query);
  return toLegacyOptions(
    query,
    AvailabilitySystem.availableStarts(ecs, budgetOf(query)).options,
  );
}

/** Is there ANY way to serve this party today? Cheaper than enumerating. */
export function hasAnyOption(query: AvailabilityQuery): boolean {
  return AvailabilitySystem.hasAnyOption(toEcsQuery(query), budgetOf(query));
}

/**
 * Distinct party start times, in order — what the slot grid renders. Several
 * arrangements can share a start (different barber pairings); the grid shows
 * the time once and the review step names who.
 */
export function distinctStarts(
  options: readonly AvailabilityOption[],
): readonly number[] {
  // Only the envelopes are read; the assignments' shape is the legacy one.
  return AvailabilitySystem.distinctStarts(
    options.map((option) => ({ envelope: option.envelope, assignments: [] })),
  );
}

/* ── Phase 2 shim converters: legacy shapes ↔ ecs-core structs ──────────── */

/** The legacy engine's brakes: 200 000 placements, `maxOptions` (200) options. */
function budgetOf(query: AvailabilityQuery) {
  return {
    nodeBudget: AvailabilitySystem.DEFAULT_BUDGET.nodeBudget,
    maxOptions:
      query.maxOptions ?? AvailabilitySystem.DEFAULT_BUDGET.maxOptions,
  };
}

function toEcsPref(pref: BarberPref): EcsBarberPref {
  return pref.kind === 'any'
    ? { kind: 'any' }
    : { kind: 'specific', barberId: EcsBarberId.of(pref.barberId.value) };
}

function toEcsChairTime(chair: ChairTime): EcsChairTime {
  return {
    barberId: EcsBarberId.of(chair.barberId.value),
    occupied: chair.occupied,
  };
}

/** The sparse per-barber overrides of a line, as the system's list. */
function overridesOf(line: AvailabilityLine) {
  return [...(line.termsByBarber ?? [])].map(([barberId, terms]) => ({
    barberId: EcsBarberId.of(barberId),
    terms,
  }));
}

function toEcsPolicy(policy: BookingPolicy): EcsBookingPolicy {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: policy.slotStepMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindow.hours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

/**
 * Every optional of the legacy query made explicit (Risk 9): no riders is
 * `[]`, an absent mask is `null` (unconstrained — never `[]`, which is
 * "nothing qualifies"), and each line's per-barber terms are dense over the
 * pool.
 */
function toEcsQuery(query: AvailabilityQuery): EcsAvailabilityQuery {
  const barbers = query.barbers.map((barber) => ({
    barberId: EcsBarberId.of(barber.barberId.value),
    windows: barber.windows.map((window) => window.interval),
    busy: barber.busy,
    blocks: (barber.blocks ?? []).map((window) => window.interval),
  }));
  const lines: EcsAvailabilityLine[] = query.lines.map((line) => ({
    lineId: line.lineId,
    barberPref: toEcsPref(line.barberPref),
    durationMinutes: line.durationMinutes,
    padBeforeMinutes: line.padBeforeMinutes,
    padAfterMinutes: line.padAfterMinutes,
    termsByBarber: AvailabilitySystem.denseTerms(
      line,
      barbers,
      overridesOf(line),
    ),
    personKey: line.personKey ?? null,
  }));
  return {
    lines,
    barbers,
    policy: toEcsPolicy(query.policy),
    notBeforeMs: query.notBeforeMs,
    riders: (query.riders ?? []).map((rider) => ({
      barberId: EcsBarberId.of(rider.barberId.value),
      offsetMinutes: rider.offsetMinutes,
      terms: rider.terms,
    })),
    withinMs: query.withinMs ?? null,
  };
}

/** The system's options → the legacy shape, each barber the query's own id object. */
function toLegacyOptions(
  query: AvailabilityQuery,
  options: readonly {
    readonly envelope: Interval;
    readonly assignments: readonly {
      readonly lineId: string;
      readonly barberIndex: number;
      readonly slot: Interval;
    }[];
  }[],
): readonly AvailabilityOption[] {
  return options.map((option) => ({
    envelope: option.envelope,
    assignments: option.assignments.map((assignment) => ({
      lineId: assignment.lineId,
      barberId: (
        query.barbers.at(assignment.barberIndex) as BarberDayAvailability
      ).barberId,
      slot: assignment.slot,
    })),
  }));
}
