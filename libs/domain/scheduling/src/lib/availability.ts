import { BarberId } from '@creativo/domain/catalog';
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
}

/** The terms this line takes with THIS barber. */
export function termsForBarber(
  line: AvailabilityLine,
  barberId: BarberId,
): LineTerms {
  return line.termsByBarber?.get(barberId.value) ?? line;
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

export interface AvailabilityQuery {
  readonly lines: readonly AvailabilityLine[];
  readonly barbers: readonly BarberDayAvailability[];
  readonly policy: BookingPolicy;
  /** Nothing may start before this — `now + minLeadMinutes`, already applied. */
  readonly notBeforeMs: number;
  /** Cap on returned options, so a wide-open day cannot produce thousands. */
  readonly maxOptions?: number;
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
  const durationMs = durationMinutes * 60_000;
  const stepMs = stepMinutes * 60_000;
  const starts: number[] = [];

  for (const gap of Interval.normalize(free)) {
    let start = gap.startMs;
    if (start < notBeforeMs) {
      // Jump to the first aligned step at or after the lead-time floor,
      // keeping the window's own phase.
      const steps = Math.ceil((notBeforeMs - gap.startMs) / stepMs);
      start = gap.startMs + steps * stepMs;
    }
    for (; start + durationMs <= gap.endMs; start += stepMs) {
      starts.push(start);
    }
  }
  return starts;
}

/**
 * Free time for a barber: rostered windows, minus busy, clipped to the
 * caller's mask.
 *
 * The mask is how "I can only do 08:00–12:00" reaches the search. It is
 * applied HERE, to the free set, rather than by filtering the returned options
 * afterwards — and that distinction is load-bearing twice over. The
 * enumeration is capped (`maxOptions`), so post-filtering spends the whole
 * budget enumerating 14:00 arrangements and then discards them, reporting "no
 * availability" for a morning that was wide open. And a mask that clips free
 * time also constrains the SEQUENTIAL arrangements a party can be served by,
 * so a second seat cannot be placed outside the window the person declared.
 */
function freeFor(
  barber: BarberDayAvailability,
  withinMs: readonly Interval[] | undefined,
): readonly Interval[] {
  const free = Interval.subtract(
    barber.windows.map((window) => window.interval),
    barber.busy,
  );
  // `undefined` is "unconstrained", NOT "nothing allowed" — an empty mask
  // would silently invert the caller's meaning into an empty grid.
  return withinMs === undefined ? free : Interval.intersect(free, withinMs);
}

/**
 * Is `candidate` a better way to serve the party at the same start? Shorter
 * envelope first — that is what "tighter" means to a client waiting around —
 * then the barber ids, so the comparison is total and the winner never
 * depends on which branch the search happened to reach first.
 */
function isTighter(
  candidate: AvailabilityOption,
  incumbent: AvailabilityOption,
): boolean {
  if (candidate.envelope.endMs !== incumbent.envelope.endMs) {
    return candidate.envelope.endMs < incumbent.envelope.endMs;
  }
  const key = (option: AvailabilityOption) =>
    option.assignments.map((assignment) => assignment.barberId.value).join();
  return key(candidate) < key(incumbent);
}

function eligible(
  line: AvailabilityLine,
  barbers: readonly BarberDayAvailability[],
): readonly BarberDayAvailability[] {
  return barbers.filter((barber) =>
    BarberPref.matches(line.barberPref, barber.barberId),
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
 * The only collision rule is that two assignments naming the SAME barber must
 * not overlap. Non-overlapping is explicitly allowed, which is what makes
 * "father and son, same barber, back to back" a first-class result rather
 * than an error — the case a "no barber twice" rule would have destroyed.
 */
export function availableOptions(
  query: AvailabilityQuery,
): readonly AvailabilityOption[] {
  return enumerateOptions(query, { dedupeByStart: false });
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
  return enumerateOptions(query, { dedupeByStart: true });
}

function enumerateOptions(
  query: AvailabilityQuery,
  mode: { readonly dedupeByStart: boolean },
): readonly AvailabilityOption[] {
  const { lines, barbers, policy, notBeforeMs, withinMs } = query;
  if (lines.length === 0) return [];

  const freeByBarber = new Map<string, readonly Interval[]>(
    barbers.map(
      (barber) => [barber.barberId.value, freeFor(barber, withinMs)] as const,
    ),
  );

  // Rule 1 — a stable, constraint-first line order.
  const ordered = lines.slice().sort((a, b) => {
    const aSpecific = a.barberPref.kind === 'specific' ? 0 : 1;
    const bSpecific = b.barberPref.kind === 'specific' ? 0 : 1;
    return (
      aSpecific - bSpecific ||
      b.durationMinutes - a.durationMinutes ||
      a.lineId.localeCompare(b.lineId)
    );
  });

  const maxOptions = query.maxOptions ?? 200;
  const options: AvailabilityOption[] = [];
  /** Index into `options` by envelope start — only used when deduping. */
  const byStart = new Map<number, number>();
  /**
   * Backtracking over five lines and a wide-open day is exponential, and
   * deduping removes the option cap's incidental brake on it. This is the
   * explicit one: a hard ceiling on placements tried, so a pathological
   * query degrades to a shorter list rather than to a frozen tab.
   */
  let nodeBudget = 200_000;
  /**
   * Each pick carries what the client BOUGHT (`slot`) and what the barber is
   * actually blocked for (`occupied` — the slot plus that line's own setup and
   * cleanup). Collision and subtraction use `occupied`, so a colour's cleanup
   * still separates two seats of one party, while the barber's turnaround does
   * not: they are one booking, and a barber does not reset between a father
   * and his son.
   */
  const chosen: { assignment: AvailabilityAssignment; occupied: Interval }[] =
    [];

  const collides = (barberId: BarberId, occupied: Interval): boolean =>
    chosen.some(
      (pick) =>
        pick.assignment.barberId.equals(barberId) &&
        Interval.overlaps(pick.occupied, occupied),
    );

  function search(index: number): void {
    if (options.length >= maxOptions) return;

    if (index === ordered.length) {
      // The envelope spans what the CLIENT experiences — sold slots, not the
      // barber's cleanup afterwards.
      const starts = chosen.map((pick) => pick.assignment.slot.startMs);
      const ends = chosen.map((pick) => pick.assignment.slot.endMs);
      const envelope = Interval.of(Math.min(...starts), Math.max(...ends));
      const option: AvailabilityOption = {
        envelope,
        assignments: chosen
          .map((pick) => pick.assignment)
          .sort(
            (a, b) =>
              a.slot.startMs - b.slot.startMs ||
              a.lineId.localeCompare(b.lineId),
          ),
      };

      if (mode.dedupeByStart) {
        const existingIndex = byStart.get(envelope.startMs);
        if (existingIndex === undefined) {
          byStart.set(envelope.startMs, options.length);
          options.push(option);
        } else if (
          isTighter(option, options[existingIndex] as AvailabilityOption)
        ) {
          options[existingIndex] = option;
        }
        return;
      }

      options.push(option);
      return;
    }

    const line = ordered[index] as AvailabilityLine;
    for (const barber of eligible(line, barbers)) {
      const free = freeByBarber.get(barber.barberId.value) ?? [];
      // Subtract what this branch has already given this barber, so the
      // sequential case is discovered naturally: the second seat simply sees
      // the first one's slot as taken.
      const alreadyTaken = chosen
        .filter((pick) => pick.assignment.barberId.equals(barber.barberId))
        .map((pick) => pick.occupied);
      const remaining = Interval.subtract(free, alreadyTaken);

      // This line's own footprint WITH THIS BARBER: setup, the service,
      // cleanup. The barber's turnaround is NOT added — it is already baked
      // into `busy`.
      const terms = termsForBarber(line, barber.barberId);
      const occupiedMinutes =
        terms.padBeforeMinutes + terms.durationMinutes + terms.padAfterMinutes;

      for (const start of candidateStarts(
        remaining,
        occupiedMinutes,
        policy.slotStepMinutes,
        notBeforeMs,
      )) {
        if (nodeBudget-- <= 0) return;
        const occupied = Interval.of(start, start + occupiedMinutes * 60_000);
        // The SOLD slot is the service itself; the pads surround it.
        const serviceStart = start + terms.padBeforeMinutes * 60_000;
        const slot = Interval.of(
          serviceStart,
          serviceStart + terms.durationMinutes * 60_000,
        );
        if (collides(barber.barberId, occupied)) continue;

        chosen.push({
          assignment: { lineId: line.lineId, barberId: barber.barberId, slot },
          occupied,
        });
        search(index + 1);
        chosen.pop();
        if (options.length >= maxOptions) return;
      }
    }
  }

  search(0);

  // Rule 3 — a total order that never depends on how the search walked.
  return options.slice().sort(
    (a, b) =>
      a.envelope.startMs - b.envelope.startMs ||
      a.envelope.endMs - b.envelope.endMs ||
      a.assignments
        .map((assignment) => assignment.barberId.value)
        .join()
        .localeCompare(
          b.assignments.map((assignment) => assignment.barberId.value).join(),
        ),
  );
}

/** Is there ANY way to serve this party today? Cheaper than enumerating. */
export function hasAnyOption(query: AvailabilityQuery): boolean {
  return availableOptions({ ...query, maxOptions: 1 }).length > 0;
}

/**
 * Distinct party start times, in order — what the slot grid renders. Several
 * arrangements can share a start (different barber pairings); the grid shows
 * the time once and the review step names who.
 */
export function distinctStarts(
  options: readonly AvailabilityOption[],
): readonly number[] {
  const seen = new Set<number>();
  const starts: number[] = [];
  for (const option of options) {
    if (seen.has(option.envelope.startMs)) continue;
    seen.add(option.envelope.startMs);
    starts.push(option.envelope.startMs);
  }
  return starts;
}
