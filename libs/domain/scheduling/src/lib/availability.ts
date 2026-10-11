import { BarberId } from '@creativo/domain/catalog';
import {
  BarberId as EcsBarberId,
  CartLineId,
  DurationMinutes,
  EndMinute,
  MinuteCount,
  MinuteDelta,
  MinuteOfDay,
  SeatKeyText,
  defect,
} from '@core/primitives';
import {
  BarberPref as EcsBarberPref,
  type BookingPolicy as EcsBookingPolicy,
  type MinuteRange,
} from '@core/components';
import {
  type AvailabilityLine as EcsAvailabilityLine,
  type AvailabilityOption as EcsAvailabilityOption,
  type AvailabilityQuery as EcsAvailabilityQuery,
  AvailabilitySystem,
  type BarberDayAvailability as EcsBarberDayAvailability,
  type ChairTime as EcsChairTime,
  type LineTerms as EcsLineTerms,
} from '@core/systems';
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
  // The system answers with the very struct it was handed — the defaults
  // or one override — so each maps back to the caller's own object.
  const legacyOf = new Map<EcsLineTerms, LineTerms>();
  const defaults = ecsTermsOf(line);
  legacyOf.set(defaults, line);
  const overrides = [...(line.termsByBarber ?? [])].map(([id, terms]) => {
    const converted = ecsTermsOf(terms);
    legacyOf.set(converted, terms);
    return { barberId: EcsBarberId.of(id), terms: converted };
  });
  const [terms] = AvailabilitySystem.denseTerms(
    defaults,
    [
      {
        barberId: EcsBarberId.of(barberId.value),
        windows: [],
        busy: [],
        blocks: [],
      },
    ],
    overrides,
  );
  return (terms === undefined ? undefined : legacyOf.get(terms)) ?? line;
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
  const turnaround = sure(
    MinuteCount.of(input.turnaroundMinutes),
    'a turnaround',
  );
  const release = input.release ?? [];
  // The frame starts a turnaround before the earliest span, so padding is
  // never clipped at its origin.
  const frame = frameAt(input.spans, turnaround);
  if (frame === null) return [];
  if (!holds(frame, input.spans, turnaround)) {
    // A busy day wider than one frame (a 25-hour fall-back day, busy to its
    // edges): the frame would clip the padding, so the instants answer by
    // the same rule — release first, then pad, merged.
    const own = release
      .filter((chair) => chair.barberId.equals(input.barberId))
      .map((chair) => chair.occupied);
    return Interval.normalize(
      Interval.subtract(input.spans, own).map((span) =>
        Interval.pad(span, input.turnaroundMinutes, input.turnaroundMinutes),
      ),
    );
  }
  return intervalsOf(
    frame,
    AvailabilitySystem.paddedBusy({
      barberId: EcsBarberId.of(input.barberId.value),
      spans: rangesIn(frame, input.spans, Rounding.Cover),
      turnaroundMinutes: turnaround,
      release: chairsIn(frame, release),
    }),
  );
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
  const duration = DurationMinutes.of(durationMinutes);
  const step = DurationMinutes.of(stepMinutes);
  const frame = frameAt(free, MinuteCount.ZERO);
  // A grid that never advances offers nothing, rather than hanging.
  if (frame === null || !duration.ok || !step.ok) return [];
  return AvailabilitySystem.candidateStarts(
    rangesIn(frame, free, Rounding.Inside),
    duration.value,
    step.value,
    notBeforeIn(frame, notBeforeMs),
  ).map((minute) => instantAt(frame, minute));
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
  const framed = toEcsQuery(query);
  if (framed === null) return [];
  return toLegacyOptions(
    query,
    framed.frame,
    AvailabilitySystem.availableOptions(framed.query, budgetOf(query)).options,
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
  const framed = toEcsQuery(query);
  if (framed === null) return [];
  return toLegacyOptions(
    query,
    framed.frame,
    AvailabilitySystem.availableStarts(framed.query, budgetOf(query)).options,
  );
}

/** Is there ANY way to serve this party today? Cheaper than enumerating. */
export function hasAnyOption(query: AvailabilityQuery): boolean {
  const framed = toEcsQuery(query);
  return (
    framed !== null &&
    AvailabilitySystem.hasAnyOption(framed.query, budgetOf(query))
  );
}

/**
 * Distinct party start times, in order — what the slot grid renders. Several
 * arrangements can share a start (different barber pairings); the grid shows
 * the time once and the review step names who.
 */
export function distinctStarts(
  options: readonly AvailabilityOption[],
): readonly number[] {
  // Only the envelope starts are read, and only for equality: each distinct
  // instant is ranked (0-based) and the rank is its minute, so the system's
  // first-seen order is the instants' own.
  const instants = [
    ...new Set(options.map((option) => option.envelope.startMs)),
  ];
  const rankOf = new Map(instants.map((instant, rank) => [instant, rank]));
  return AvailabilitySystem.distinctStarts(
    options.map((option) => ({
      startMinutes: sure(
        MinuteOfDay.of(rankOf.get(option.envelope.startMs) as number),
        'a start rank',
      ),
    })),
  ).map((rank) => instants[rank] as number);
}

/* ── Phase 2 shim converters: legacy shapes ↔ ecs-core structs ──────────── */

/*
 * THE DAY FRAME. The engine is wall-clock minutes of ONE shop day, `[0,
 * 1440]` (Law 7.3); the legacy query is instants and holds no zone. Every
 * rule the engine runs is translation-invariant (gaps, steps, pads, riders'
 * offsets and the lead floor are all differences), so the legacy instants
 * are read on a frame: minute `m` is `originMs + m · 60 000`, the origin the
 * earliest window start floored to its minute. A party is only ever placed
 * inside a window, and a shop day's windows span less than a day, so
 * clipping the busy spans and the mask to the frame drops nothing the
 * search could reach. The lead floor is rounded UP to its minute, which
 * every start on a minute grid compares with exactly as with the instant.
 */

const MS_PER_MINUTE = 60_000;
const DAY_MINUTES = 1440;

/** Where minute 0 of the frame sits. */
type Frame = { readonly originMs: number };

/** How a span off the minute grid is read: covering it, or inside it. */
const Rounding = { Cover: 'cover', Inside: 'inside' } as const;
type Rounding = (typeof Rounding)[keyof typeof Rounding];

/** A brand the legacy value already satisfies — its own rules are the brand's. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy figure already holds every rule the brand checks.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** The frame whose origin is `leadMinutes` before the earliest span's minute; `null` with no span. */
function frameAt(
  spans: readonly Interval[],
  leadMinutes: number,
): Frame | null {
  let earliest = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    if (span.startMs < earliest) earliest = span.startMs;
  }
  if (!Number.isFinite(earliest)) return null;
  return {
    originMs:
      Math.floor(earliest / MS_PER_MINUTE) * MS_PER_MINUTE -
      leadMinutes * MS_PER_MINUTE,
  };
}

/** Every span, grown by `trailMinutes` past its end, still ends on the frame. */
function holds(
  frame: Frame,
  spans: readonly Interval[],
  trailMinutes: number,
): boolean {
  for (const span of spans) {
    const end = Math.ceil((span.endMs - frame.originMs) / MS_PER_MINUTE);
    if (end + trailMinutes > DAY_MINUTES) return false;
  }
  return true;
}

/** A span on the frame, clipped to it; `null` when nothing of it is on the frame. */
function rangeIn(
  frame: Frame,
  span: Interval,
  rounding: Rounding,
): MinuteRange | null {
  const from = (span.startMs - frame.originMs) / MS_PER_MINUTE;
  const to = (span.endMs - frame.originMs) / MS_PER_MINUTE;
  const cover = rounding === Rounding.Cover;
  const start = Math.max(cover ? Math.floor(from) : Math.ceil(from), 0);
  const end = Math.min(cover ? Math.ceil(to) : Math.floor(to), DAY_MINUTES);
  if (!(start < end)) return null;
  return {
    startMinutes: sure(MinuteOfDay.of(start), 'a frame start'),
    endMinutes: sure(EndMinute.of(end), 'a frame end'),
  };
}

function rangesIn(
  frame: Frame,
  spans: readonly Interval[],
  rounding: Rounding,
): readonly MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (const span of spans) {
    const range = rangeIn(frame, span, rounding);
    if (range !== null) ranges.push(range);
  }
  return ranges;
}

function instantAt(frame: Frame, minute: number): number {
  return frame.originMs + minute * MS_PER_MINUTE;
}

function intervalsOf(
  frame: Frame,
  ranges: readonly MinuteRange[],
): readonly Interval[] {
  return ranges.map((range) =>
    Interval.of(
      instantAt(frame, range.startMinutes),
      instantAt(frame, range.endMinutes),
    ),
  );
}

/**
 * The lead floor on the frame: rounded UP to its minute (a start on the
 * minute grid is at or after the instant exactly when it is at or after
 * that minute); before the frame is minute 0, past its end is `null` —
 * nothing on the frame is late enough.
 */
function notBeforeIn(frame: Frame, notBeforeMs: number): MinuteOfDay | null {
  const minute = Math.max(
    Math.ceil((notBeforeMs - frame.originMs) / MS_PER_MINUTE),
    0,
  );
  const floor = MinuteOfDay.of(minute);
  return floor.ok ? floor.value : null;
}

/** The chairs handed back, on the frame (a chair off the frame frees nothing on it). */
function chairsIn(
  frame: Frame,
  release: readonly ChairTime[],
): readonly EcsChairTime[] {
  const chairs: EcsChairTime[] = [];
  for (const chair of release) {
    const range = rangeIn(frame, chair.occupied, Rounding.Cover);
    if (range === null) continue;
    chairs.push({
      barberId: EcsBarberId.of(chair.barberId.value),
      startMinutes: sure(MinuteOfDay.of(range.startMinutes), 'a chair start'),
      endMinutes: sure(EndMinute.of(range.endMinutes), 'a chair end'),
    });
  }
  return chairs;
}

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
    ? EcsBarberPref.any()
    : EcsBarberPref.specific(EcsBarberId.of(pref.barberId.value));
}

/** Legacy line terms → the branded triple. */
function ecsTermsOf(terms: LineTerms): EcsLineTerms {
  return {
    durationMinutes: sure(
      DurationMinutes.of(terms.durationMinutes),
      'a duration',
    ),
    padBeforeMinutes: sure(MinuteCount.of(terms.padBeforeMinutes), 'a pad'),
    padAfterMinutes: sure(MinuteCount.of(terms.padAfterMinutes), 'a pad'),
  };
}

/** The sparse per-barber overrides of a line, as the system's list. */
function overridesOf(line: AvailabilityLine) {
  return [...(line.termsByBarber ?? [])].map(([barberId, terms]) => ({
    barberId: EcsBarberId.of(barberId),
    terms: ecsTermsOf(terms),
  }));
}

function toEcsPolicy(policy: BookingPolicy): EcsBookingPolicy {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: sure(
      DurationMinutes.of(policy.slotStepMinutes),
      'a slot step',
    ),
    minLeadMinutes: sure(MinuteCount.of(policy.minLeadMinutes), 'a lead'),
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
 * pool — all on the day frame of the query's windows. `null` when no barber
 * has a window: nothing can be placed.
 */
function toEcsQuery(
  query: AvailabilityQuery,
): { readonly query: EcsAvailabilityQuery; readonly frame: Frame } | null {
  const frame = frameAt(
    query.barbers.flatMap((barber) =>
      barber.windows.map((window) => window.interval),
    ),
    0,
  );
  if (frame === null) return null;
  const barbers: EcsBarberDayAvailability[] = query.barbers.map((barber) => ({
    barberId: EcsBarberId.of(barber.barberId.value),
    windows: rangesIn(
      frame,
      barber.windows.map((window) => window.interval),
      Rounding.Inside,
    ),
    busy: rangesIn(frame, barber.busy, Rounding.Cover),
    blocks: rangesIn(
      frame,
      (barber.blocks ?? []).map((window) => window.interval),
      Rounding.Inside,
    ),
  }));
  const lines: EcsAvailabilityLine[] = query.lines.map((line) => {
    const defaults = ecsTermsOf(line);
    return {
      lineId: CartLineId.of(line.lineId),
      ...toEcsPref(line.barberPref),
      ...defaults,
      termsByBarber: AvailabilitySystem.denseTerms(
        defaults,
        barbers,
        overridesOf(line),
      ),
      personKey:
        line.personKey === undefined ? null : SeatKeyText.of(line.personKey),
    };
  });
  return {
    frame,
    query: {
      lines,
      barbers,
      policy: toEcsPolicy(query.policy),
      notBefore: notBeforeIn(frame, query.notBeforeMs),
      riders: (query.riders ?? []).map((rider) => ({
        barberId: EcsBarberId.of(rider.barberId.value),
        offsetMinutes: sure(MinuteDelta.of(rider.offsetMinutes), 'an offset'),
        terms: ecsTermsOf(rider.terms),
      })),
      within:
        query.withinMs === undefined
          ? null
          : rangesIn(frame, query.withinMs, Rounding.Inside),
    },
  };
}

/** The system's options → the legacy shape, each barber the query's own id object. */
function toLegacyOptions(
  query: AvailabilityQuery,
  frame: Frame,
  options: readonly EcsAvailabilityOption[],
): readonly AvailabilityOption[] {
  return options.map((option) => ({
    envelope: Interval.of(
      instantAt(frame, option.startMinutes),
      instantAt(frame, option.endMinutes),
    ),
    assignments: option.assignments.map((assignment) => ({
      lineId: assignment.lineId,
      barberId: (
        query.barbers.at(assignment.barberIndex) as BarberDayAvailability
      ).barberId,
      slot: Interval.of(
        instantAt(frame, assignment.startMinutes),
        instantAt(frame, assignment.endMinutes),
      ),
    })),
  }));
}
