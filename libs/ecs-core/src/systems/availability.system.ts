import { BarberPref, BarberPreference } from '../components/barber-pref.data';
import type { BookingPolicy } from '../components/booking-policy.data';
import { DayWindows } from '../components/day-windows.data';
import { MinuteRange } from '../components/minute-range.data';
import type { ShopNow } from '../components/shop-now.data';
import type {
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
} from '../primitives/duration-minutes.primitive';
import type {
  BarberId,
  CartLineId,
  SeatKeyText,
} from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import { EndMinute, MinuteOfDay } from '../primitives/minute-of-day.primitive';
import {
  IntervalSetSystem,
  type NormalizedRanges,
} from './interval-set.system';

/** Minutes in one shop day on its wall clock. */
const MINUTES_PER_DAY = 1440;

/** How long a line takes with one barber, and the setup/cleanup around it. */
export type LineTerms = {
  readonly durationMinutes: DurationMinutes;
  readonly padBeforeMinutes: MinuteCount;
  readonly padAfterMinutes: MinuteCount;
};

/** A catalogue override: this barber's terms for the line (sparse input of `denseTerms`). */
export type BarberTerms = {
  readonly barberId: BarberId;
  readonly terms: LineTerms;
};

/**
 * One line the party wants served, already resolved to durations
 * (`availability.ts:34-53`). The flat `LineTerms` fields are the DEFAULT
 * terms — the catalogue duration before anyone picks a barber, which also
 * orders the search (longer first) — and the line's `BarberPref` slice
 * (`barberPreference`, `preferredBarberId`) sits at its root (flatten-spec
 * §3.9).
 *
 * `termsByBarber` is DENSE and parallel to `AvailabilityQuery.barbers`: entry
 * `b` is this line's terms with barber `b`, the defaults repeated where the
 * catalogue has no override ({@link AvailabilitySystem.denseTerms} builds it).
 * The catalogue prices a service per barber — a fade can be 30 minutes with
 * one and 45 with another — so an `ANY` line is resolved per candidate
 * barber, never collapsed to one number (the max would hide the faster
 * barber's gaps, the min would book the slower one into a slot they cannot
 * finish in).
 *
 * `personKey` is WHO the line is for — lines sharing a key are one person, who
 * never sits in two chairs at once (owner decision 2026-09-25); `null` is a
 * person of their own.
 */
export type AvailabilityLine = {
  readonly lineId: CartLineId;
  readonly termsByBarber: readonly LineTerms[];
  readonly personKey: SeatKeyText | null;
} & LineTerms &
  BarberPref;

/**
 * One barber's shop day at ONE shop, as the engine consumes it — the loader
 * partitions per shop before asking (a father at Center and his son at
 * Mladost at once is geometrically valid and physically absurd). Every span
 * is a minute range of the query's ONE `localDate` (Law 7.3).
 *
 * - `windows` — the rostered windows (`RosterSystem.windowsAt(…)`, which ARE
 *   minute ranges);
 * - `busy` — what is taken, ALREADY padded by this barber's turnaround
 *   ({@link AvailabilitySystem.paddedBusy}). That is the single place the
 *   separation between unrelated clients is applied; the engine has no
 *   turnaround of its own so it cannot be charged twice;
 * - `blocks` — the carved-out stretches (`RosterSystem.buildDayCarveOuts`) for
 *   the surfaces that must DRAW a break; the engine ignores them (they were
 *   already subtracted from `windows`). `[]` when nobody asked.
 */
export type BarberDayAvailability = {
  readonly barberId: BarberId;
  readonly windows: readonly MinuteRange[];
  readonly busy: readonly MinuteRange[];
  readonly blocks: readonly MinuteRange[];
};

/**
 * The chair time one barber is held for — a seat's setup, service and
 * cleanup on the shop day's wall clock: what a seat puts into the busy
 * projection and what a move hands back before it places the same visit
 * again.
 */
export type ChairTime = {
  readonly barberId: BarberId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** {@link AvailabilitySystem.paddedBusy}'s input; `release` is `[]` unless a visit is being moved. */
export type PaddedBusyInput = {
  readonly barberId: BarberId;
  /** The spans as the projection stores them: UNPADDED. */
  readonly spans: readonly MinuteRange[];
  readonly turnaroundMinutes: MinuteCount;
  readonly release: readonly ChairTime[];
};

/**
 * One line placed: which line (`lineId`), with which barber (`barberId`, and
 * its index in `query.barbers` — what ties and ranking compare), and the SOLD
 * slot (`startMinutes`/`endMinutes`) — the service itself, without the setup
 * and cleanup around it. No line index: an option must not depend on cart
 * order, byte for byte.
 */
export type AvailabilityAssignment = {
  readonly lineId: CartLineId;
  readonly barberId: BarberId;
  readonly barberIndex: number;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/**
 * One way the whole party can be served. Its envelope
 * (`startMinutes`/`endMinutes`) spans the earliest sold start to the latest
 * sold end — the longest seat for a PARALLEL arrangement, the chain for a
 * SEQUENTIAL one; the engine returns both kinds and the user never picks a
 * "mode" (owner ruling 2026-07-29). Assignments are in slot order, ties by
 * `lineId`.
 */
export type AvailabilityOption = {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly assignments: readonly AvailabilityAssignment[];
};

/**
 * Somebody who comes WITH the party without being searched for — a seat the
 * server carries forward when a client moves a visit. Their barber, terms and
 * distance from the party (`offsetMinutes` from the party's earliest SOLD
 * start to theirs, negative when they go first) are the stored seat's; the
 * engine never places a rider, it refuses every arrangement that would strand
 * one. Riders are not in the option.
 */
export type AvailabilityRider = {
  readonly barberId: BarberId;
  readonly offsetMinutes: MinuteDelta;
  readonly terms: LineTerms;
};

/**
 * Everything one search reads, every field present (Risk 9: no shape-toggling
 * optionals in the hot path) — for ONE shop day, on its wall clock.
 *
 * - `notBefore` — nothing may start (chair time included) before this minute:
 *   `now + minLeadMinutes`, already applied ({@link AvailabilitySystem.leadFloor});
 *   `null` is "the whole day is too soon" (no options at all);
 * - `riders` — `[]` on every ordinary booking; only a client MOVE carries any;
 * - `within` — the client's declared windows. `null` is UNCONSTRAINED and
 *   `[]` is "nothing qualifies" (no options at all) — never blur the two:
 *   mapping an absent mask to `[]` zeroes every ordinary booking
 *   ({@link AvailabilitySystem.withinOf} returns the whole day for an
 *   unnarrowed day precisely so they never meet).
 */
export type AvailabilityQuery = {
  readonly lines: readonly AvailabilityLine[];
  readonly barbers: readonly BarberDayAvailability[];
  readonly policy: BookingPolicy;
  readonly notBefore: MinuteOfDay | null;
  readonly riders: readonly AvailabilityRider[];
  readonly within: readonly MinuteRange[] | null;
};

/**
 * The search's two brakes: `nodeBudget` — placements tried, so a pathological
 * query degrades to a shorter list rather than a frozen tab; `maxOptions` —
 * options returned (distinct starts, for {@link AvailabilitySystem.availableStarts}).
 */
export type SearchBudget = {
  readonly nodeBudget: number;
  readonly maxOptions: number;
};

/**
 * The answer: the options (sorted), whether the node budget ran out before
 * the walk finished (`exhausted` — the list may then be incomplete), and the
 * placements tried (`nodesVisited ≤ nodeBudget`) — a pure output, so a spec
 * can compare search effort without a probe.
 */
export type AvailabilityResult = {
  readonly options: readonly AvailabilityOption[];
  readonly exhausted: boolean;
  readonly nodesVisited: number;
};

/** The legacy engine's brakes (`availability.ts:453,463`). */
const DEFAULT_BUDGET: SearchBudget = { nodeBudget: 200_000, maxOptions: 200 };

const NO_RESULT: AvailabilityResult = {
  options: [],
  exhausted: false,
  nodesVisited: 0,
};

/** The whole shop day, `[00:00, 24:00)`. */
const WHOLE_DAY: readonly MinuteRange[] = [
  MinuteRange.of(startOf(0), endOf(MINUTES_PER_DAY)),
];

/** A searched start back under its brand — the walk never leaves `[0, 1440)`. */
function startOf(minutes: number): MinuteOfDay {
  return MinuteOfDay.ofProven(minutes);
}

/** A searched end back under its brand — the walk never leaves `(0, 1440]`. */
function endOf(minutes: number): EndMinute {
  return EndMinute.ofProven(minutes);
}

/** Code-unit order — runtime-locale independent, so browser and server agree. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The first start on a gap's grid at or after the lead-time floor. The grid
 * is measured from the GAP start, not midnight: a shift beginning 09:30
 * offers 09:30, not 09:45.
 */
function firstStart(gapStart: number, notBefore: number, step: number): number {
  if (gapStart >= notBefore) return gapStart;
  return gapStart + Math.ceil((notBefore - gapStart) / step) * step;
}

/** A barber's rostered windows minus their (already padded) busy time. */
function openFor(barber: BarberDayAvailability): NormalizedRanges {
  return IntervalSetSystem.subtract(barber.windows, barber.busy);
}

/**
 * Free time: open time clipped to the caller's mask. Applied to the FREE SET,
 * not to the returned options: the enumeration is capped, so post-filtering
 * would spend the budget on 14:00 arrangements and report a wide-open morning
 * as empty — and a mask on free time also keeps a party's LATER seats inside
 * the declared window.
 */
function freeFor(
  barber: BarberDayAvailability,
  within: readonly MinuteRange[] | null,
): readonly MinuteRange[] {
  const open = openFor(barber);
  return within === null ? open : IntervalSetSystem.intersect(open, within);
}

/** A line's dense terms entry for barber `b`, or its defaults when the array is short. */
function termsAt(line: AvailabilityLine, barberIndex: number): LineTerms {
  return line.termsByBarber[barberIndex] ?? line;
}

/** Is `[start, end)` inside one gap of a sorted, disjoint gap list? */
function insideOneGap(
  gaps: readonly MinuteRange[],
  start: number,
  end: number,
): boolean {
  for (let g = 0; g < gaps.length; g++) {
    const gap = gaps[g] as MinuteRange;
    if (gap.startMinutes > start) return false;
    if (end <= gap.endMinutes) return true;
  }
  return false;
}

/**
 * Specific preferences first (they are the constrained ones; placed last they
 * strand), then the longer default duration, then `lineId` — no dependence on
 * cart order.
 */
function compareLines(a: AvailabilityLine, b: AvailabilityLine): number {
  const aSpecific = a.barberPreference === BarberPreference.Specific ? 0 : 1;
  const bSpecific = b.barberPreference === BarberPreference.Specific ? 0 : 1;
  return (
    aSpecific - bSpecific ||
    b.durationMinutes - a.durationMinutes ||
    compareIds(a.lineId, b.lineId)
  );
}

/** Barber INDEX sequences, element by element (then the shorter first). */
function compareBarberSequences(
  a: readonly AvailabilityAssignment[],
  b: readonly AvailabilityAssignment[],
): number {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    const delta =
      (a[i] as AvailabilityAssignment).barberIndex -
      (b[i] as AvailabilityAssignment).barberIndex;
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

/** The total order of the result: envelope start, envelope end, barber indexes. */
function compareOptions(a: AvailabilityOption, b: AvailabilityOption): number {
  return (
    a.startMinutes - b.startMinutes ||
    a.endMinutes - b.endMinutes ||
    compareBarberSequences(a.assignments, b.assignments)
  );
}

/**
 * The backtracking search behind {@link AvailabilitySystem.availableOptions}
 * and {@link AvailabilitySystem.availableStarts} (`availability.ts:422-612`),
 * in the index-addressed layout hot path #1 is committed to (§2.8, Risk 9),
 * on the shop day's wall-clock minutes (Law 7.3 — integers, no instant):
 *
 * - lines and barbers are addressed by INDEX; ids are compared once, before
 *   the walk (eligibility, person keys, rider barbers, line ranks);
 * - per (position, barber) terms are precomputed into flat typed arrays, and
 *   each position's eligible barbers into one CSR index list;
 * - the branch's picks live in preallocated per-position arrays (the chosen
 *   barber, chair time, sold slot) and in a per-barber TAKEN list kept sorted
 *   (insert on descent, remove on return) — no `filter().map()`/`some()` per
 *   branch;
 * - candidate starts are walked INLINE over the barber's free gaps minus the
 *   taken list — no per-branch `number[]`;
 * - an `AvailabilityOption` is allocated only when a leaf is accepted.
 *
 * Determinism: lines are ordered by {@link compareLines}; barbers are tried in
 * the caller's order; the result is sorted by {@link compareOptions} (stable,
 * so equal keys keep the walk's order). Identical queries are byte-identical.
 */
function search(
  query: AvailabilityQuery,
  budget: SearchBudget,
  dedupeByStart: boolean,
): AvailabilityResult {
  const lines = query.lines;
  const barbers = query.barbers;
  const lineCount = lines.length;
  const barberCount = barbers.length;
  const step: number = query.policy.slotStepMinutes;
  const maxOptions = budget.maxOptions;
  const nodeBudget = budget.nodeBudget;
  // No lines, no cap, a grid that never advances, or a day that is too soon
  // as a whole: nothing to search (the grid case would loop forever — fail
  // closed instead).
  if (
    lineCount === 0 ||
    maxOptions <= 0 ||
    !(step > 0) ||
    query.notBefore === null
  ) {
    return NO_RESULT;
  }
  const notBefore: number = query.notBefore;

  /* ── Once per call: the index-addressed layout ───────────────────────── */

  const free: (readonly MinuteRange[])[] = [];
  for (let b = 0; b < barberCount; b++) {
    free.push(freeFor(barbers[b] as BarberDayAvailability, query.within));
  }

  // Line positions in search order (Rule 1), and each position's line index.
  const order: number[] = [];
  for (let i = 0; i < lineCount; i++) order.push(i);
  order.sort((a, b) =>
    compareLines(lines[a] as AvailabilityLine, lines[b] as AvailabilityLine),
  );

  // The `lineId` rank of each position — the assignment tie-break, as ints.
  const lineRank = new Int32Array(lineCount);
  for (let p = 0; p < lineCount; p++) {
    const id = (lines[order[p] as number] as AvailabilityLine).lineId;
    let rank = 0;
    for (let q = 0; q < lineCount; q++) {
      if ((lines[order[q] as number] as AvailabilityLine).lineId < id) rank++;
    }
    lineRank[p] = rank;
  }

  // Each position's person as a small int (−1: a person of their own).
  const personOf = new Int32Array(lineCount);
  const people = new Map<string, number>();
  for (let p = 0; p < lineCount; p++) {
    const key = (lines[order[p] as number] as AvailabilityLine).personKey;
    if (key === null) {
      personOf[p] = -1;
      continue;
    }
    let person = people.get(key);
    if (person === undefined) {
      person = people.size;
      people.set(key, person);
    }
    personOf[p] = person;
  }

  // Eligible barbers per position (CSR) and the (position, barber) terms.
  const eligibleFrom = new Int32Array(lineCount + 1);
  const eligible = new Int32Array(lineCount * barberCount);
  const occupiedOf = new Int32Array(lineCount * barberCount);
  const padBeforeOf = new Int32Array(lineCount * barberCount);
  const serviceOf = new Int32Array(lineCount * barberCount);
  let eligibleCount = 0;
  for (let p = 0; p < lineCount; p++) {
    eligibleFrom[p] = eligibleCount;
    const line = lines[order[p] as number] as AvailabilityLine;
    for (let b = 0; b < barberCount; b++) {
      const barber = barbers[b] as BarberDayAvailability;
      if (!BarberPref.matches(line, barber.barberId)) continue;
      eligible[eligibleCount++] = b;
      const terms = termsAt(line, b);
      const k = p * barberCount + b;
      // The line's own footprint WITH THIS BARBER: setup, service, cleanup.
      // The barber's turnaround is NOT added — it is already inside `busy`.
      occupiedOf[k] =
        terms.padBeforeMinutes + terms.durationMinutes + terms.padAfterMinutes;
      padBeforeOf[k] = terms.padBeforeMinutes;
      serviceOf[k] = terms.durationMinutes;
    }
  }
  eligibleFrom[lineCount] = eligibleCount;

  // Riders: each one's barber as an index (−1: not in this pool), its open
  // (UNMASKED) time — a declared window is about when the CLIENT can come —
  // and its placed chair time while a leaf is checked.
  const riders = query.riders;
  const riderCount = riders.length;
  const riderBarber = new Int32Array(riderCount);
  const riderStart = new Int32Array(riderCount);
  const riderEnd = new Int32Array(riderCount);
  const open: (readonly MinuteRange[])[] = [];
  if (riderCount > 0) {
    for (let b = 0; b < barberCount; b++) {
      open.push(openFor(barbers[b] as BarberDayAvailability));
    }
    for (let r = 0; r < riderCount; r++) {
      const id = (riders[r] as AvailabilityRider).barberId;
      let index = -1;
      for (let b = 0; b < barberCount; b++) {
        if ((barbers[b] as BarberDayAvailability).barberId === id) {
          index = b;
          break;
        }
      }
      riderBarber[r] = index;
    }
  }

  // The branch: per position, the pick; per barber, its sorted taken list.
  const chosenBarber = new Int32Array(lineCount);
  const chosenOccStart = new Int32Array(lineCount);
  const chosenOccEnd = new Int32Array(lineCount);
  const chosenSlotStart = new Int32Array(lineCount);
  const chosenSlotEnd = new Int32Array(lineCount);
  const takenStart = new Int32Array(barberCount * lineCount);
  const takenEnd = new Int32Array(barberCount * lineCount);
  const takenCount = new Int32Array(barberCount);
  const leafOrder = new Int32Array(lineCount);

  const options: AvailabilityOption[] = [];
  /** Index into `options` by envelope start — only when deduping. */
  const byStart = new Map<number, number>();
  let nodesVisited = 0;
  let exhausted = false;

  /* ── The taken list: sorted insert on descent, removal on return ─────── */

  const take = (b: number, start: number, end: number): void => {
    // An empty chair time takes nothing (the legacy subtraction dropped it).
    if (!(start < end)) return;
    const base = b * lineCount;
    let i = takenCount[b] as number;
    while (i > 0 && (takenStart[base + i - 1] as number) > start) {
      takenStart[base + i] = takenStart[base + i - 1] as number;
      takenEnd[base + i] = takenEnd[base + i - 1] as number;
      i--;
    }
    takenStart[base + i] = start;
    takenEnd[base + i] = end;
    takenCount[b] = (takenCount[b] as number) + 1;
  };

  const release = (b: number, start: number, end: number): void => {
    if (!(start < end)) return;
    const base = b * lineCount;
    const count = takenCount[b] as number;
    let i = 0;
    while (i < count && takenStart[base + i] !== start) i++;
    for (; i < count - 1; i++) {
      takenStart[base + i] = takenStart[base + i + 1] as number;
      takenEnd[base + i] = takenEnd[base + i + 1] as number;
    }
    takenCount[b] = count - 1;
  };

  /* ── A leaf: riders, then (maybe) one option ─────────────────────────── */

  /**
   * Does every rider still fit once the party starts at `partyStart`? The
   * server's questions of a carried seat: after the lead floor (measured from
   * its chair time's start), inside one open gap of its barber, clear of this
   * arrangement's picks and of the riders already placed on that barber.
   */
  const ridersFit = (partyStart: number): boolean => {
    for (let r = 0; r < riderCount; r++) {
      const rider = riders[r] as AvailabilityRider;
      const soldStart = partyStart + rider.offsetMinutes;
      const start = soldStart - rider.terms.padBeforeMinutes;
      const end =
        soldStart + rider.terms.durationMinutes + rider.terms.padAfterMinutes;
      if (start < notBefore) return false;
      const b = riderBarber[r] as number;
      if (b < 0) return false;
      if (!insideOneGap(open[b] as readonly MinuteRange[], start, end)) {
        return false;
      }
      for (let p = 0; p < lineCount; p++) {
        if (
          chosenBarber[p] === b &&
          (chosenOccStart[p] as number) < end &&
          start < (chosenOccEnd[p] as number)
        ) {
          return false;
        }
      }
      for (let s = 0; s < r; s++) {
        if (
          riderBarber[s] === b &&
          (riderStart[s] as number) < end &&
          start < (riderEnd[s] as number)
        ) {
          return false;
        }
      }
      riderStart[r] = start;
      riderEnd[r] = end;
    }
    return true;
  };

  /** Positions in assignment order: by sold start, then `lineId` (stable). */
  const orderLeaf = (): void => {
    for (let i = 0; i < lineCount; i++) {
      let j = i;
      while (j > 0) {
        const prev = leafOrder[j - 1] as number;
        const delta =
          (chosenSlotStart[prev] as number) - (chosenSlotStart[i] as number) ||
          (lineRank[prev] as number) - (lineRank[i] as number);
        if (delta <= 0) break;
        leafOrder[j] = prev;
        j--;
      }
      leafOrder[j] = i;
    }
  };

  const buildOption = (
    envelopeStart: number,
    envelopeEnd: number,
  ): AvailabilityOption => {
    const assignments: AvailabilityAssignment[] = [];
    for (let i = 0; i < lineCount; i++) {
      const p = leafOrder[i] as number;
      const barberIndex = chosenBarber[p] as number;
      assignments.push({
        lineId: (lines[order[p] as number] as AvailabilityLine).lineId,
        barberId: (barbers[barberIndex] as BarberDayAvailability).barberId,
        barberIndex,
        startMinutes: startOf(chosenSlotStart[p] as number),
        endMinutes: endOf(chosenSlotEnd[p] as number),
      });
    }
    return {
      startMinutes: startOf(envelopeStart),
      endMinutes: endOf(envelopeEnd),
      assignments,
    };
  };

  /**
   * Is this leaf a TIGHTER way to serve the party than `incumbent` at the
   * same start? Shorter envelope first, then the barber INDEX sequence — a
   * total order, so the winner never depends on which branch came first.
   */
  const isTighter = (
    envelopeEnd: number,
    incumbent: AvailabilityOption,
  ): boolean => {
    if (envelopeEnd !== incumbent.endMinutes) {
      return envelopeEnd < incumbent.endMinutes;
    }
    for (let i = 0; i < lineCount; i++) {
      const mine = chosenBarber[leafOrder[i] as number] as number;
      const theirs = (incumbent.assignments[i] as AvailabilityAssignment)
        .barberIndex;
      if (mine !== theirs) return mine < theirs;
    }
    return false;
  };

  const leaf = (): void => {
    // The envelope spans what the CLIENT experiences — sold slots.
    let envelopeStart = chosenSlotStart[0] as number;
    let envelopeEnd = chosenSlotEnd[0] as number;
    for (let p = 1; p < lineCount; p++) {
      if ((chosenSlotStart[p] as number) < envelopeStart)
        envelopeStart = chosenSlotStart[p] as number;
      if ((chosenSlotEnd[p] as number) > envelopeEnd)
        envelopeEnd = chosenSlotEnd[p] as number;
    }
    // A start that strands a rider is no answer for THIS arrangement — but
    // another at the same start may leave them room, so the walk goes on.
    if (riderCount > 0 && !ridersFit(envelopeStart)) return;
    orderLeaf();
    if (!dedupeByStart) {
      options.push(buildOption(envelopeStart, envelopeEnd));
      return;
    }
    const existing = byStart.get(envelopeStart);
    if (existing === undefined) {
      byStart.set(envelopeStart, options.length);
      options.push(buildOption(envelopeStart, envelopeEnd));
    } else if (
      isTighter(envelopeEnd, options[existing] as AvailabilityOption)
    ) {
      options[existing] = buildOption(envelopeStart, envelopeEnd);
    }
  };

  /* ── The walk ────────────────────────────────────────────────────────── */

  const descend = (p: number): void => {
    if (options.length >= maxOptions) return;
    if (p === lineCount) {
      leaf();
      return;
    }
    const person = personOf[p] as number;
    const eligibleTo = eligibleFrom[p + 1] as number;
    for (let e = eligibleFrom[p] as number; e < eligibleTo; e++) {
      const b = eligible[e] as number;
      const k = p * barberCount + b;
      const occupied = occupiedOf[k] as number;
      const before = padBeforeOf[k] as number;
      const duration = serviceOf[k] as number;
      const gaps = free[b] as readonly MinuteRange[];
      const base = b * lineCount;
      const count = takenCount[b] as number;
      let t = 0;
      for (let g = 0; g < gaps.length; g++) {
        const gap = gaps[g] as MinuteRange;
        // The gap minus what this branch already gave barber `b`, walked as
        // sub-gaps: the sequential case is found naturally — the second seat
        // simply sees the first one's chair time as taken.
        let cursor: number = gap.startMinutes;
        const gapEnd: number = gap.endMinutes;
        while (cursor < gapEnd) {
          while (t < count && (takenEnd[base + t] as number) <= cursor) t++;
          const takenInside =
            t < count && (takenStart[base + t] as number) < gapEnd;
          const subEnd = takenInside
            ? (takenStart[base + t] as number)
            : gapEnd;
          for (
            let start = firstStart(cursor, notBefore, step);
            start + occupied <= subEnd;
            start += step
          ) {
            if (nodesVisited >= nodeBudget) {
              exhausted = true;
              return;
            }
            nodesVisited++;
            // The SOLD slot is the service; the pads surround it.
            const slotStart = start + before;
            const slotEnd = slotStart + duration;
            // …and the PERSON cannot be in another chair then (sold slots).
            if (person >= 0) {
              let twice = false;
              for (let q = 0; q < p; q++) {
                if (
                  personOf[q] === person &&
                  (chosenSlotStart[q] as number) < slotEnd &&
                  slotStart < (chosenSlotEnd[q] as number)
                ) {
                  twice = true;
                  break;
                }
              }
              if (twice) continue;
            }
            chosenBarber[p] = b;
            chosenOccStart[p] = start;
            chosenOccEnd[p] = start + occupied;
            chosenSlotStart[p] = slotStart;
            chosenSlotEnd[p] = slotEnd;
            take(b, start, start + occupied);
            descend(p + 1);
            release(b, start, start + occupied);
            if (exhausted || options.length >= maxOptions) return;
          }
          if (!takenInside) break;
          cursor = takenEnd[base + t] as number;
          t++;
        }
      }
    }
  };

  descend(0);

  // Rule 3 — a total order that never depends on how the search walked.
  options.sort(compareOptions);
  return { options, exhausted, nodesVisited };
}

/**
 * AvailabilitySystem — every way a party can be served on one barber-day pool
 * of ONE shop day (`availability.ts:56-635`), plus the busy rule both sides of
 * a booking check placements by, and the client's declared-window mask
 * (`day-windows.ts:92`).
 *
 * Pure and time-zone-blind (Law 7.3): the query is the shop day's wall-clock
 * minutes; "now" arrives as `ShopNow`. Two assignments naming the SAME barber
 * never overlap (chair time), which is what makes "father and son, same
 * barber, back to back" a first-class result; two lines of the SAME person
 * never overlap either (sold slots).
 */
export const AvailabilitySystem = {
  /** The legacy brakes: 200 000 placements, 200 options. */
  DEFAULT_BUDGET,

  /**
   * The lead-time floor every caller applies once, on `localDate`'s wall
   * clock (the grid, the waitlist matcher and the commit re-check each
   * restated it): `now.currentMinute + minLeadMinutes` on `now.localDate`,
   * carried into the following day(s) by subtracting 1440 per day — civil
   * arithmetic (flatten-spec T1). `null` when the whole of `localDate` is too
   * soon (a past day, or a floor at or past its midnight); minute `0` when
   * the floor lies before the day. Applied to starts rather than by trimming
   * windows, which would shrink the capacity denominator too.
   */
  leadFloor(
    now: ShopNow,
    policy: BookingPolicy,
    localDate: LocalDate,
  ): MinuteOfDay | null {
    const daysAhead = LocalDate.daysBetween(now.localDate, localDate);
    const floor =
      now.currentMinute + policy.minLeadMinutes - daysAhead * MINUTES_PER_DAY;
    if (floor >= MINUTES_PER_DAY) return null;
    return startOf(floor > 0 ? floor : 0);
  },

  /**
   * A line's terms with barber `barberIndex` — its dense entry, or the line's
   * defaults when the array is short (`termsForBarber`, `availability.ts:56`).
   */
  termsAt(line: AvailabilityLine, barberIndex: number): LineTerms {
    return termsAt(line, barberIndex);
  },

  /**
   * The dense `termsByBarber` for a line: one entry per barber of the pool, in
   * the pool's order — the barber's catalogue override (the first naming
   * them), else `defaults`. Built once per query, so the search never looks a
   * barber up by id.
   */
  denseTerms(
    defaults: LineTerms,
    barbers: readonly BarberDayAvailability[],
    overrides: readonly BarberTerms[],
  ): readonly LineTerms[] {
    const dense: LineTerms[] = [];
    for (let b = 0; b < barbers.length; b++) {
      const id = (barbers[b] as BarberDayAvailability).barberId;
      let terms = defaults;
      for (let o = 0; o < overrides.length; o++) {
        const override = overrides[o] as BarberTerms;
        if (override.barberId === id) {
          terms = override.terms;
          break;
        }
      }
      dense.push(terms);
    }
    return dense;
  },

  /**
   * A barber's stored busy spans → the `busy` a placement is checked against
   * (`availability.ts:112-146`): what is taken, padded by this barber's
   * turnaround (clamped to the shop day). ONE rule for the grid's read and
   * the server's commit check.
   *
   * `release` is chair time handed back FIRST — the visit being MOVED never
   * blocks its own move — and before the padding, never after: the
   * turnaround around a NEIGHBOUR's span belongs to the neighbour and must
   * survive. Entries naming other barbers are ignored, so a whole visit's
   * chair times can be passed for every barber.
   */
  paddedBusy(input: PaddedBusyInput): NormalizedRanges {
    const released: ChairTime[] = [];
    for (let i = 0; i < input.release.length; i++) {
      const chair = input.release[i] as ChairTime;
      if (chair.barberId === input.barberId) released.push(chair);
    }
    const taken = IntervalSetSystem.subtract(input.spans, released);
    const padded: MinuteRange[] = [];
    for (let i = 0; i < taken.length; i++) {
      padded.push(
        MinuteRange.pad(
          taken[i] as MinuteRange,
          input.turnaroundMinutes,
          input.turnaroundMinutes,
        ),
      );
    }
    return IntervalSetSystem.normalize(padded);
  },

  /**
   * Candidate starts for one footprint in some free time (`availability.ts:
   * 218-249`): every step of the grid measured from each GAP's start (not
   * midnight), from the lead-time floor on, while the footprint still fits.
   * The search walks the same grid inline; this materialised form is for
   * callers that want the list. A `null` floor (the day is too soon) offers
   * nothing.
   */
  candidateStarts(
    free: readonly MinuteRange[],
    duration: DurationMinutes,
    step: DurationMinutes,
    notBefore: MinuteOfDay | null,
  ): readonly MinuteOfDay[] {
    const starts: MinuteOfDay[] = [];
    if (notBefore === null || !(step > 0)) return starts;
    const gaps = IntervalSetSystem.normalize(free);
    for (let g = 0; g < gaps.length; g++) {
      const gap = gaps[g] as MinuteRange;
      for (
        let start = firstStart(gap.startMinutes, notBefore, step);
        start + duration <= gap.endMinutes;
        start += step
      ) {
        starts.push(startOf(start));
      }
    }
    return starts;
  },

  /**
   * Every way the party can be served, ranked (`availability.ts:359-397`) —
   * up to `budget.maxOptions`, within `budget.nodeBudget` placements. Each
   * line is tried, in a constraint-first order, at every (barber, start) that
   * fits that barber's free time minus what the branch already gave them, and
   * that does not seat the line's person twice.
   */
  availableOptions(
    query: AvailabilityQuery,
    budget: SearchBudget,
  ): AvailabilityResult {
    return search(query, budget, false);
  },

  /**
   * ONE canonical arrangement per distinct party start — what the slot grid
   * renders (`availability.ts:399-420`). Deduplicated DURING the search, so
   * the budget buys breadth (the afternoon) instead of the ninth way to
   * arrange 09:15; the arrangement kept for a start is the TIGHTEST one, never
   * merely the first the walk reached.
   */
  availableStarts(
    query: AvailabilityQuery,
    budget: SearchBudget,
  ): AvailabilityResult {
    return search(query, budget, true);
  },

  /** Is there ANY way to serve this party? The search with a cap of one. */
  hasAnyOption(query: AvailabilityQuery, budget: SearchBudget): boolean {
    return (
      search(query, { nodeBudget: budget.nodeBudget, maxOptions: 1 }, false)
        .options.length > 0
    );
  },

  /** Distinct party starts, in the options' order — the grid's times. */
  distinctStarts(
    options: readonly Pick<AvailabilityOption, 'startMinutes'>[],
  ): readonly MinuteOfDay[] {
    const seen = new Set<number>();
    const starts: MinuteOfDay[] = [];
    for (let i = 0; i < options.length; i++) {
      const start = (options[i] as Pick<AvailabilityOption, 'startMinutes'>)
        .startMinutes;
      if (seen.has(start)) continue;
      seen.add(start);
      starts.push(start);
    }
    return starts;
  },

  /**
   * A client's declared day → the `within` mask for it
   * (`DayWindows.toIntervals`, `day-windows.ts:80-100`), on that day's wall
   * clock. A whole-day declaration is the whole day, `[00:00, 24:00)` —
   * never `[]`, which would read as "nothing qualifies"; a narrowed day is
   * its declared windows as they are.
   */
  withinOf(dayWindows: DayWindows): readonly MinuteRange[] {
    return DayWindows.isWholeDay(dayWindows) ? WHOLE_DAY : dayWindows.windows;
  },
} as const;
