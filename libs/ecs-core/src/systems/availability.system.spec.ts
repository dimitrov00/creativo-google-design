import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberPref,
  BarberPreference,
  BookingPolicy,
  DayWindows,
  MinuteRange,
  ShopNow,
  ExceptionDetail,
  ExceptionEffectRule,
  ShopDayHours,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import {
  BarberId,
  CartLineId,
  LocationId,
  SeatKeyText,
  type DurationMinutes,
  MinuteCount,
  type MinuteOfDay,
  Weekday,
} from '@core/primitives';
import {
  duration,
  minuteCount,
  minuteDelta,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  utcMs,
} from '@core/testing';
import {
  type AvailabilityAssignment,
  type AvailabilityLine,
  type AvailabilityOption,
  type AvailabilityQuery,
  type AvailabilityResult,
  type AvailabilityRider,
  AvailabilitySystem,
  type BarberDayAvailability,
  type BarberTerms,
  type LineTerms,
  type SearchBudget,
} from './availability.system';
import { IntervalSetSystem } from './interval-set.system';
import { type DayException, RosterSystem } from './roster.system';
import { ScheduleExceptionSystem } from './schedule-exception.system';

/*
 * The cases of libs/domain/scheduling/src/lib/availability.spec.ts, copied
 * over plain arrays and the index-addressed query of ONE shop day on its
 * wall clock (the class spec stays in place and runs against its shim), the
 * `toIntervals` cases of day-windows.spec.ts as `withinOf`, plus: one case
 * per side of `within` null-vs-[], the budget as a pure output, the seed
 * catalogue against the legacy engine's recorded node counts and answers, a
 * fast-check equivalence against a naive reference search, determinism and
 * purity.
 */

/** Minutes from the shop's midnight — reads like a clock in the tests. */
const H = (hours: number, minutes = 0) => hours * 60 + minutes;
/** A span of the shop day, its two ends under their brands. */
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
const iv = (fromH: number, toH: number) => span(H(fromH), H(toH));

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const PETAR = BarberId.of('petar');

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('bad fixture');
  return result.value;
}

const POLICY = unwrap(
  BookingPolicy.create({
    maxPartySize: 5,
    slotStepMinutes: 15,
    minLeadMinutes: 0,
    horizonMonths: 2,
    maxFlexibleDays: 7,
    autoConfirm: true,
    cancellationWindowHours: 24,
  }),
);

const BUDGET = AvailabilitySystem.DEFAULT_BUDGET;

function barber(
  id: BarberId,
  options: {
    windows?: readonly MinuteRange[];
    busy?: readonly MinuteRange[];
  } = {},
): BarberDayAvailability {
  return {
    barberId: id,
    windows: options.windows ?? [iv(9, 18)],
    busy: options.busy ?? [],
    blocks: [],
  };
}

/**
 * A line as a cart would name it, before the pool is known: its default
 * terms, its person, and any per-barber overrides — densified against the
 * query's barbers by {@link query}, exactly as a loader would.
 */
type LineDraft = {
  readonly line: AvailabilityLine;
  readonly overrides: readonly BarberTerms[];
};

function terms(durationMinutes: number, before = 0, after = 0): LineTerms {
  return {
    durationMinutes: duration(durationMinutes),
    padBeforeMinutes: minuteCount(before),
    padAfterMinutes: minuteCount(after),
  };
}

function line(
  lineId: string,
  durationMinutes: number,
  pref: BarberPref = BarberPref.any(),
  pads: { before?: number; after?: number } = {},
  personKey: string | null = null,
  overrides: readonly BarberTerms[] = [],
): LineDraft {
  return {
    line: {
      lineId: CartLineId.of(lineId),
      ...pref,
      ...terms(durationMinutes, pads.before ?? 0, pads.after ?? 0),
      termsByBarber: [],
      personKey: personKey === null ? null : SeatKeyText.of(personKey),
    },
    overrides,
  };
}

function query(
  drafts: readonly LineDraft[],
  barbers: readonly BarberDayAvailability[],
  overrides: {
    notBefore?: MinuteOfDay | null;
    within?: readonly MinuteRange[] | null;
    riders?: readonly AvailabilityRider[];
  } = {},
): AvailabilityQuery {
  return {
    lines: drafts.map(({ line: draft, overrides: byBarber }) => ({
      ...draft,
      termsByBarber: AvailabilitySystem.denseTerms(
        terms(
          draft.durationMinutes,
          draft.padBeforeMinutes,
          draft.padAfterMinutes,
        ),
        barbers,
        byBarber,
      ),
    })),
    barbers,
    policy: POLICY,
    notBefore:
      overrides.notBefore === undefined ? minute(0) : overrides.notBefore,
    riders: overrides.riders ?? [],
    within: overrides.within === undefined ? null : overrides.within,
  };
}

function budget(maxOptions = 200): SearchBudget {
  return { nodeBudget: BUDGET.nodeBudget, maxOptions };
}

function solve(
  drafts: readonly LineDraft[],
  barbers: readonly BarberDayAvailability[],
  overrides: {
    notBefore?: MinuteOfDay | null;
    maxOptions?: number;
    within?: readonly MinuteRange[] | null;
  } = {},
): readonly AvailabilityOption[] {
  return AvailabilitySystem.availableOptions(
    query(drafts, barbers, overrides),
    budget(overrides.maxOptions),
  ).options;
}

function starts(
  q: AvailabilityQuery,
  maxOptions = 200,
): readonly AvailabilityOption[] {
  return AvailabilitySystem.availableStarts(q, budget(maxOptions)).options;
}

const distinctStarts = AvailabilitySystem.distinctStarts;

/** An option as `HH:mm barber` strings, for readable assertions. */
function describeOption(option: AvailabilityOption): readonly string[] {
  return option.assignments.map((assignment) => {
    const totalMinutes = assignment.startMinutes;
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${assignment.lineId}@${hh}:${mm}/${assignment.barberId}`;
  });
}

describe('candidateStarts', () => {
  it('steps through a gap, stopping where the duration no longer fits', () => {
    // 09:00–10:30 with a 45-minute service on a 15-minute grid: the last
    // start that still fits is 09:45.
    const found = AvailabilitySystem.candidateStarts(
      [iv(9, 10.5)],
      duration(45),
      duration(15),
      minute(0),
    );
    expect(found.map((ms) => ms / 60)).toEqual([9, 9.25, 9.5, 9.75]);
  });

  it('offers nothing when the gap is shorter than the service', () => {
    expect(
      AvailabilitySystem.candidateStarts(
        [iv(9, 9.5)],
        duration(45),
        duration(15),
        minute(0),
      ),
    ).toEqual([]);
  });

  it('keeps the WINDOW’s phase rather than snapping to midnight', () => {
    // A shift starting 09:30 must offer 09:30, not 09:45. A midnight-anchored
    // grid would silently discard the first half-step of every odd shift.
    const found = AvailabilitySystem.candidateStarts(
      [span(H(9, 30), H(11))],
      duration(30),
      duration(15),
      minute(0),
    );
    expect(found[0]).toBe(H(9, 30));
  });

  it('respects the lead-time floor, staying on the grid', () => {
    const found = AvailabilitySystem.candidateStarts(
      [iv(9, 12)],
      duration(30),
      duration(15),
      minute(H(10, 5)),
    );
    expect(found[0]).toBe(H(10, 15));
  });

  it('offers nothing on a grid that never advances, rather than hanging', () => {
    // A step of 0 no `DurationMinutes` admits — a corrupt stored policy
    // reaching the system unparsed.
    const frozenStep = 0 as DurationMinutes;
    expect(
      AvailabilitySystem.candidateStarts(
        [iv(9, 12)],
        duration(30),
        frozenStep,
        minute(0),
      ),
    ).toEqual([]);
  });
});

describe('availableOptions — a single seat', () => {
  it('offers every fitting start', () => {
    const options = solve(
      [line('l1', 60)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
    );
    expect(distinctStarts(options).map((ms) => ms / 60)).toEqual([
      9, 9.25, 9.5, 9.75, 10,
    ]);
  });

  it('works around an existing booking', () => {
    const options = solve(
      [line('l1', 60)],
      [barber(IVAN, { windows: [iv(9, 13)], busy: [iv(10, 11)] })],
    );
    const found = distinctStarts(options).map((ms) => ms / 60);
    expect(found).toContain(9);
    expect(found).toContain(11);
    // Anything from 09:15 to 10:45 would collide with the 10:00–11:00 booking.
    expect(found).not.toContain(9.5);
    expect(found).not.toContain(10.5);
  });

  it('honours a specific barber preference', () => {
    const options = solve(
      [line('l1', 60, BarberPref.specific(NIKO))],
      [
        barber(IVAN, { windows: [iv(9, 11)] }),
        barber(NIKO, { windows: [iv(14, 16)] }),
      ],
    );
    expect(
      options.every((option) =>
        option.assignments.every((a) => a.barberId === NIKO),
      ),
    ).toBe(true);
    expect(distinctStarts(options)[0]).toBe(H(14));
  });

  it('finds nothing when the preferred barber is fully booked', () => {
    const options = solve(
      [line('l1', 60, BarberPref.specific(IVAN))],
      [barber(IVAN, { windows: [iv(9, 10)], busy: [iv(9, 10)] }), barber(NIKO)],
    );
    expect(options).toEqual([]);
    expect(
      AvailabilitySystem.hasAnyOption(
        query(
          [line('l1', 60, BarberPref.specific(IVAN))],
          [barber(IVAN, { windows: [iv(9, 10)], busy: [iv(9, 10)] })],
        ),
        BUDGET,
      ),
    ).toBe(false);
    expect(
      AvailabilitySystem.hasAnyOption(
        query([line('l1', 60)], [barber(NIKO)]),
        BUDGET,
      ),
    ).toBe(true);
  });
});

describe('availableOptions — PARALLEL arrangements', () => {
  it('serves two seats at the SAME time with different barbers', () => {
    const options = solve(
      [line('a', 45), line('b', 30)],
      [
        barber(IVAN, { windows: [iv(9, 11)] }),
        barber(NIKO, { windows: [iv(9, 11)] }),
      ],
    );
    const sameStart = options.filter((option) => {
      const found = new Set(option.assignments.map((a) => a.startMinutes));
      return found.size === 1;
    });
    expect(sameStart.length).toBeGreaterThan(0);

    const first = sameStart[0] as AvailabilityOption;
    // The envelope is the LONGER seat, not the sum — they were served at once.
    expect(MinuteRange.durationMinutes(first)).toBe(45);
    expect(new Set(first.assignments.map((a) => a.barberId)).size).toBe(2);
  });

  it('does not offer a parallel arrangement when only one barber works', () => {
    const options = solve(
      [line('a', 45), line('b', 30)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
    );
    for (const option of options) {
      const found = option.assignments.map((a) => a.startMinutes);
      expect(new Set(found).size).toBe(2);
    }
  });
});

describe('availableOptions — SEQUENTIAL arrangements', () => {
  it('serves two seats BACK TO BACK with ONE barber — father and son', () => {
    // The case a "no barber twice per appointment" rule would have destroyed.
    const options = solve(
      [line('a', 45), line('b', 30)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
    );
    expect(options.length).toBeGreaterThan(0);

    const backToBack = options.find(
      (option) =>
        MinuteRange.durationMinutes(option) === 75 &&
        option.assignments.every((a) => a.barberId === IVAN),
    );
    expect(backToBack).toBeDefined();
    // 09:00 for 45m then 09:45 for 30m — abutting, no gap.
    expect(describeOption(backToBack as AvailabilityOption)).toEqual([
      'a@09:00/ivan',
      'b@09:45/ivan',
    ]);
  });

  it('leaves NO gap between two seats of one party, even when a turnaround applies elsewhere', () => {
    // Ivan needs 15 minutes between unrelated clients — which is why his
    // existing 12:00 booking arrives padded to 11:45–13:15. That separation
    // must NOT leak between a father and his son: they are one booking, and a
    // barber does not reset between family members (ruling R3). The engine
    // has no `turnaroundMinutes` input at all.
    const padded = MinuteRange.pad(
      iv(12, 13),
      minuteCount(15),
      minuteCount(15),
    );
    const options = solve(
      [line('a', 45), line('b', 30)],
      [barber(IVAN, { windows: [iv(9, 15)], busy: [padded] })],
      { maxOptions: 200 },
    );

    const abutting = options.find((option) => {
      const sorted = option.assignments
        .slice()
        .sort((x, y) => x.startMinutes - y.startMinutes);
      return (
        sorted.length === 2 && sorted[0]?.endMinutes === sorted[1]?.startMinutes
      );
    });
    expect(abutting).toBeDefined();

    // …and the padded neighbour is still respected: nothing sits inside it.
    for (const option of options) {
      for (const assignment of option.assignments) {
        expect(MinuteRange.overlaps(assignment, padded)).toBe(false);
      }
    }
  });

  it('chains three seats through one barber', () => {
    const options = solve(
      [line('a', 30), line('b', 30), line('c', 30)],
      [barber(IVAN, { windows: [iv(9, 12)] })],
    );
    const allIvan = options.find((option) =>
      option.assignments.every((a) => a.barberId === IVAN),
    );
    expect(allIvan).toBeDefined();
    expect(MinuteRange.durationMinutes(allIvan as AvailabilityOption)).toBe(90);
  });
});

describe('availableOptions — the collision invariant', () => {
  it('NEVER overlaps two assignments naming the same barber', () => {
    const options = solve(
      [line('a', 45), line('b', 30), line('c', 60)],
      [
        barber(IVAN, { windows: [iv(9, 18)] }),
        barber(NIKO, { windows: [iv(9, 18)] }),
      ],
      { maxOptions: 400 },
    );
    for (const option of options) {
      for (let i = 0; i < option.assignments.length; i++) {
        for (let j = i + 1; j < option.assignments.length; j++) {
          const a = option.assignments.at(i);
          const b = option.assignments.at(j);
          if (a && b && a.barberId === b.barberId) {
            expect(MinuteRange.overlaps(a, b)).toBe(false);
          }
        }
      }
    }
  });

  it('never places an assignment outside the barber’s free time', () => {
    const barbers = [
      barber(IVAN, { windows: [iv(9, 13)], busy: [iv(11, 12)] }),
      barber(NIKO, { windows: [iv(14, 18)] }),
    ];
    const options = solve([line('a', 60), line('b', 30)], barbers, {
      maxOptions: 400,
    });
    for (const option of options) {
      for (const assignment of option.assignments) {
        const owner = barbers[assignment.barberIndex] as BarberDayAvailability;
        expect(owner.barberId).toBe(assignment.barberId);
        const free = IntervalSetSystem.subtract(owner.windows, owner.busy);
        expect(free.some((gap) => MinuteRange.contains(gap, assignment))).toBe(
          true,
        );
      }
    }
  });

  it('assigns every line exactly once', () => {
    const options = solve(
      [line('a', 30), line('b', 30)],
      [barber(IVAN), barber(NIKO)],
      { maxOptions: 100 },
    );
    for (const option of options) {
      expect(option.assignments.map((a) => a.lineId).sort()).toEqual([
        'a',
        'b',
      ]);
    }
  });
});

/*
 * ── ONE PERSON, ONE CHAIR AT A TIME (owner decision, 2026-09-25) ─────────
 * The engine used to be person-blind: a client with a cut and a beard, both
 * «any barber», was offered both at 09:00 in two chairs. Lines naming one
 * person (`personKey`) now never overlap on their SOLD slots.
 */
describe('availableOptions — one person, one chair at a time', () => {
  const person = (
    lineId: string,
    durationMinutes: number,
    personKey: string | null,
    pads: { before?: number; after?: number } = {},
  ): LineDraft =>
    line(lineId, durationMinutes, BarberPref.any(), pads, personKey);

  /** Does any option seat one person in two chairs at once? */
  function seatsSomebodyTwice(
    drafts: readonly LineDraft[],
    option: AvailabilityOption,
  ): boolean {
    const keyOf = new Map(
      drafts.map((entry) => [entry.line.lineId, entry.line.personKey]),
    );
    return option.assignments.some((a, i) =>
      option.assignments.some(
        (b, j) =>
          j > i &&
          (keyOf.get(a.lineId) ?? null) !== null &&
          keyOf.get(a.lineId) === keyOf.get(b.lineId) &&
          MinuteRange.overlaps(a, b),
      ),
    );
  }

  it('never offers one person’s two lines side by side, even with two free chairs', () => {
    const lines = [person('cut', 45, 'self'), person('beard', 30, 'self')];
    const options = solve(lines, [barber(IVAN), barber(NIKO)], {
      maxOptions: 2_000,
    });

    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(seatsSomebodyTwice(lines, option)).toBe(false);
    }
    // The first offer is the cut, then the beard straight after — in either
    // chair — never both at 09:00.
    expect(describeOption(options[0] as AvailabilityOption)).toEqual([
      'cut@09:00/ivan',
      'beard@09:45/ivan',
    ]);
  });

  it('seats the person back to back across two chairs — walking over is not sitting twice', () => {
    // Ivan only has the morning up to 09:45, Niko only from 09:45: the cut
    // with one, the beard with the other, abutting.
    const lines = [person('cut', 45, 'self'), person('beard', 30, 'self')];
    const options = solve(
      lines,
      [
        barber(IVAN, { windows: [span(H(9), H(9, 45))] }),
        barber(NIKO, { windows: [span(H(9, 45), H(11))] }),
      ],
      { maxOptions: 200 },
    );
    expect(options.map(describeOption)).toContainEqual([
      'cut@09:00/ivan',
      'beard@09:45/niko',
    ]);
  });

  it('judges the SOLD slots — a barber’s cleanup does not keep the person in the chair', () => {
    // The cut is sold 09:00–09:45 and Ivan sweeps up until 10:00; the person
    // is free at 09:45, so Niko's beard may start then.
    const lines = [
      person('cut', 45, 'self', { after: 15 }),
      person('beard', 30, 'self'),
    ];
    const options = solve(lines, [barber(IVAN), barber(NIKO)], {
      maxOptions: 2_000,
    });
    expect(options.map(describeOption)).toContainEqual([
      'cut@09:00/ivan',
      'beard@09:45/niko',
    ]);
  });

  it('still seats two DIFFERENT people side by side', () => {
    const lines = [person('father', 45, 'self'), person('son', 30, 'guest-0')];
    const [first] = solve(lines, [barber(IVAN), barber(NIKO)]);
    expect(describeOption(first as AvailabilityOption)).toEqual([
      'father@09:00/ivan',
      'son@09:00/niko',
    ]);
  });

  it('treats a line that names nobody (null) as a person of its own — the search it always was', () => {
    const lines = [person('a', 45, null), person('b', 30, null)];
    const [first] = solve(lines, [barber(IVAN), barber(NIKO)]);
    expect(describeOption(first as AvailabilityOption)).toEqual([
      'a@09:00/ivan',
      'b@09:00/niko',
    ]);
  });

  it('gives the grid the person’s real earliest start — a sequence, not a pair', () => {
    const options = starts(
      query(
        [person('cut', 45, 'self'), person('beard', 30, 'self')],
        [barber(IVAN), barber(NIKO)],
      ),
    );
    // 09:00–10:15, never the side-by-side 09:00–09:45.
    const first = options[0] as AvailabilityOption;
    expect(span(first.startMinutes, first.endMinutes)).toEqual(
      span(H(9), H(10, 15)),
    );
  });

  it('removes exactly the arrangements that seat somebody twice, and nothing else (property)', () => {
    const anyDrafts = fc.array(
      fc.record({
        minutes: fc.integer({ min: 1, max: 4 }).map((q) => q * 15),
        person: fc.constantFrom('self', 'guest-0', 'guest-1'),
      }),
      { minLength: 1, maxLength: 3 },
    );

    fc.assert(
      fc.property(
        anyDrafts,
        fc.integer({ min: 9, max: 11 }),
        fc.boolean(),
        (drafts, busyHour, nikoWorks) => {
          const lines = drafts.map((draft, index) =>
            person(`l${index}`, draft.minutes, draft.person),
          );
          // The same lines, naming nobody — the person-blind search.
          const blind = drafts.map((draft, index) =>
            person(`l${index}`, draft.minutes, null),
          );
          // A short day keeps the search exhaustive (no cap is reached), so
          // the two answers can be compared option for option.
          const barbers = [
            barber(IVAN, {
              windows: [iv(9, 12)],
              busy: [span(H(busyHour), H(busyHour, 30))],
            }),
            ...(nikoWorks ? [barber(NIKO, { windows: [iv(9, 12)] })] : []),
          ];
          const everything = solve(blind, barbers, { maxOptions: 1_000_000 });
          const kept = solve(lines, barbers, { maxOptions: 1_000_000 });

          const render = (options: readonly AvailabilityOption[]) =>
            options.map((option) => JSON.stringify(describeOption(option)));
          expect(render(kept)).toEqual(
            render(
              everything.filter((option) => !seatsSomebodyTwice(lines, option)),
            ),
          );
          // …and the grid's one-per-start answer never seats anybody twice.
          for (const option of starts(query(lines, barbers))) {
            expect(seatsSomebodyTwice(lines, option)).toBe(false);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('availableOptions — buffers', () => {
  it('turnaround is applied ONCE, by the caller padding busy — never twice', () => {
    // A 45-minute gap fits a 45-minute service exactly. The 15-minute
    // turnaround around the neighbouring booking is already inside `busy`;
    // charging it again to the candidate would reject this legitimate slot.
    const options = solve(
      [line('a', 45)],
      [
        barber(IVAN, {
          windows: [iv(9, 12)],
          busy: [MinuteRange.pad(iv(10, 11), minuteCount(15), minuteCount(15))],
        }),
      ],
    );
    const found = distinctStarts(options);
    expect(found).toContain(H(9)); // 09:00–09:45, right up to the padded block
    expect(found).not.toContain(H(9, 15)); // would run into it
    expect(found).toContain(H(11, 15)); // clear of the padding
  });

  it('a service’s OWN cleanup does extend what the barber is blocked for', () => {
    // Unlike turnaround, cleanup is part of this booking's footprint, so it
    // must be reserved at booking time. 60 + 30 = 90 = the whole window, so
    // only 09:00 fits.
    const options = solve(
      [line('a', 60, BarberPref.any(), { after: 30 })],
      [barber(IVAN, { windows: [iv(9, 10.5)] })],
    );
    expect(distinctStarts(options)).toEqual([H(9)]);
  });

  it('setup time pushes the SOLD slot later than the occupied start', () => {
    const options = solve(
      [line('a', 30, BarberPref.any(), { before: 15 })],
      [barber(IVAN, { windows: [iv(9, 10)] })],
    );
    // The barber is occupied from 09:00, but the client's slot begins 09:15.
    expect(options[0]?.assignments[0]?.startMinutes).toBe(H(9, 15));
  });

  it('a service’s cleanup DOES separate two seats of one party', () => {
    // A colour still has to be cleaned up before the son sits down, even
    // though the barber does not "reset" between family members. Asserted as
    // an invariant over EVERY option: only 'a' imposes a gap after itself.
    const options = solve(
      [line('a', 30, BarberPref.any(), { after: 20 }), line('b', 30)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
      { maxOptions: 200 },
    );
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      const a = option.assignments.find((x) => x.lineId === 'a');
      const b = option.assignments.find((x) => x.lineId === 'b');
      if (!a || !b) throw new Error('every line must be assigned');
      // 'a' occupies its slot PLUS 20 minutes of cleanup, and nothing may sit
      // inside that — not even another seat of the same party.
      const aOccupied = span(a.startMinutes, a.endMinutes + 20);
      expect(MinuteRange.overlaps(aOccupied, b)).toBe(false);
    }

    // And when 'a' does come first, the 20-minute gap is really there.
    const aFirst = options.find((option) => {
      const a = option.assignments.find((x) => x.lineId === 'a');
      const b = option.assignments.find((x) => x.lineId === 'b');
      return a && b && a.startMinutes < b.startMinutes;
    });
    expect(aFirst).toBeDefined();
    const a = aFirst?.assignments.find((x) => x.lineId === 'a');
    const b = aFirst?.assignments.find((x) => x.lineId === 'b');
    expect(
      (b?.startMinutes ?? 0) - (a?.endMinutes ?? 0),
    ).toBeGreaterThanOrEqual(20);
  });
});

describe('availableOptions — determinism', () => {
  it('returns byte-identical results for the same query, regardless of line order', () => {
    const barbers = [
      barber(IVAN, { windows: [iv(9, 12)] }),
      barber(NIKO, { windows: [iv(9, 12)] }),
    ];
    const forward = solve(
      [line('a', 45), line('b', 30, BarberPref.specific(NIKO))],
      barbers,
      { maxOptions: 100 },
    );
    const reversed = solve(
      [line('b', 30, BarberPref.specific(NIKO)), line('a', 45)],
      barbers,
      { maxOptions: 100 },
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it('is stable across repeated identical calls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 90 }),
        fc.integer({ min: 15, max: 90 }),
        (first, second) => {
          const barbers = [
            barber(IVAN, { windows: [iv(9, 13)] }),
            barber(NIKO),
          ];
          const lines = [line('a', first), line('b', second)];
          const once = solve(lines, barbers, { maxOptions: 50 });
          const twice = solve(lines, barbers, { maxOptions: 50 });
          expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('orders options by envelope start, then by span', () => {
    const options = solve(
      [line('a', 30), line('b', 30)],
      [
        barber(IVAN, { windows: [iv(9, 11)] }),
        barber(NIKO, { windows: [iv(9, 11)] }),
      ],
      { maxOptions: 200 },
    );
    for (let i = 1; i < options.length; i++) {
      const previous = options[i - 1] as AvailabilityOption;
      const current = options.at(i) as AvailabilityOption;
      const ordered =
        previous.startMinutes < current.startMinutes ||
        (previous.startMinutes === current.startMinutes &&
          previous.endMinutes <= current.endMinutes);
      expect(ordered).toBe(true);
    }
  });

  it('breaks a tie on the barber INDEX sequence — the caller’s pool order', () => {
    // Same envelope, same lines: (Niko, Ivan) vs (Ivan, Niko). The pool lists
    // Niko first, so his arrangement ranks first — no id strings compared.
    const lines = [line('a', 30), line('b', 30)];
    const [first] = solve(lines, [barber(NIKO), barber(IVAN)]);
    expect(describeOption(first as AvailabilityOption)).toEqual([
      'a@09:00/niko',
      'b@09:00/ivan',
    ]);
    expect(first?.assignments.map((a) => a.barberIndex)).toEqual([0, 1]);
  });
});

describe('availableOptions — edges', () => {
  it('returns nothing for no lines, and nothing when no barber works', () => {
    expect(solve([], [barber(IVAN)])).toEqual([]);
    expect(solve([line('a', 30)], [])).toEqual([]);
    expect(solve([line('a', 30)], [barber(IVAN, { windows: [] })])).toEqual([]);
  });

  it('respects the lead-time floor', () => {
    const options = solve(
      [line('a', 30)],
      [barber(IVAN, { windows: [iv(9, 12)] })],
      { notBefore: minute(H(10, 30)) },
    );
    expect(distinctStarts(options)[0]).toBe(H(10, 30));
  });

  it('caps the option count so a wide-open day cannot explode', () => {
    const options = solve(
      [line('a', 15), line('b', 15), line('c', 15)],
      [
        barber(IVAN, { windows: [iv(9, 18)] }),
        barber(NIKO, { windows: [iv(9, 18)] }),
      ],
      { maxOptions: 25 },
    );
    expect(options.length).toBeLessThanOrEqual(25);
  });

  it('serves a party across a split shift', () => {
    const options = solve(
      [line('a', 60)],
      [barber(IVAN, { windows: [iv(9, 10), iv(14, 16)] })],
    );
    const found = distinctStarts(options);
    expect(found).toContain(H(9));
    expect(found).toContain(H(14));
    // 10:00–14:00 is not rostered at all.
    expect(found).not.toContain(H(11));
  });

  it('returns nothing for a zero cap or a grid that never advances', () => {
    expect(
      AvailabilitySystem.availableOptions(
        query([line('a', 30)], [barber(IVAN)]),
        {
          nodeBudget: 1_000,
          maxOptions: 0,
        },
      ),
    ).toEqual({ options: [], exhausted: false, nodesVisited: 0 });
    const frozenGrid: AvailabilityQuery = {
      ...query([line('a', 30)], [barber(IVAN)]),
      policy: { ...POLICY, slotStepMinutes: 0 as DurationMinutes },
    };
    expect(
      AvailabilitySystem.availableStarts(frozenGrid, BUDGET).options,
    ).toEqual([]);
  });
});

describe('availableOptions — per-barber terms', () => {
  // The catalog prices a service per barber, so the same fade can be 30
  // minutes with Ivan and 45 with Niko. Collapsing that to one number is
  // wrong whichever number you pick.
  const perBarberLine = (
    lineId: string,
    defaults: number,
    byBarber: readonly (readonly [BarberId, number])[],
  ): LineDraft =>
    line(
      lineId,
      defaults,
      BarberPref.any(),
      {},
      null,
      byBarber.map(([barberId, minutes]) => ({
        barberId,
        terms: terms(minutes),
      })),
    );

  it('offers a gap only the FASTER barber fits', () => {
    // A single 30-minute gap. Ivan takes 30, Niko takes 45 — so exactly one
    // barber can serve it, and the slot must still be offered.
    const options = solve(
      [
        perBarberLine('l1', 45, [
          [IVAN, 30],
          [NIKO, 45],
        ]),
      ],
      [
        barber(IVAN, { windows: [iv(9, 9.5)] }),
        barber(NIKO, { windows: [iv(9, 9.5)] }),
      ],
    );
    expect(options).not.toHaveLength(0);
    for (const option of options) {
      expect(option.assignments[0]?.barberId).toBe('ivan');
      expect(MinuteRange.durationMinutes(option)).toBe(30);
    }
  });

  it('books the SLOWER barber for their own longer duration', () => {
    // Same line, only Niko available, a window wide enough for both. The sold
    // slot has to be Niko's 45 — quoting Ivan's 30 would end the appointment
    // a quarter of an hour before the barber is actually free.
    const options = solve(
      [
        perBarberLine('l1', 30, [
          [IVAN, 30],
          [NIKO, 45],
        ]),
      ],
      [barber(NIKO, { windows: [iv(9, 11)] })],
    );
    expect(options).not.toHaveLength(0);
    for (const option of options) {
      expect(
        MinuteRange.durationMinutes(
          option.assignments[0] as AvailabilityAssignment,
        ),
      ).toBe(45);
    }
  });

  it('falls back to the default terms for a barber with no override', () => {
    const options = solve(
      [perBarberLine('l1', 60, [[IVAN, 30]])],
      [barber(NIKO, { windows: [iv(9, 10)] })],
    );
    expect(options).toHaveLength(1);
    expect(
      MinuteRange.durationMinutes(
        options[0]?.assignments[0] as AvailabilityAssignment,
      ),
    ).toBe(60);
  });

  it('denseTerms lays the overrides out parallel to the pool; termsAt reads it', () => {
    const pool = [barber(NIKO), barber(IVAN), barber(PETAR)];
    const dense = AvailabilitySystem.denseTerms(terms(60), pool, [
      { barberId: IVAN, terms: terms(30) },
      { barberId: IVAN, terms: terms(99) },
    ]);
    expect(dense.map((t) => t.durationMinutes)).toEqual([60, 30, 60]);
    const drafted = line('l', 60).line;
    const withDense = { ...drafted, termsByBarber: dense };
    expect(AvailabilitySystem.termsAt(withDense, 1).durationMinutes).toBe(30);
    // A short array falls back to the line's own defaults.
    expect(AvailabilitySystem.termsAt(drafted, 2).durationMinutes).toBe(60);
  });
});

describe('availableStarts — one arrangement per time, and the best one', () => {
  it('keeps the TIGHTEST arrangement for a start, not the first one found', () => {
    // Two seats, one barber, a whole morning free. "09:00 and 10:00" is a
    // valid sequential arrangement and a bad offer when "09:00 and 09:30"
    // exists — a party should not be told to wait around for an hour.
    const options = starts(
      query(
        [line('l1', 30), line('l2', 30)],
        [barber(IVAN, { windows: [iv(9, 13)] })],
      ),
    );
    const first = options.find((option) => option.startMinutes === H(9));
    expect(first).toBeDefined();
    expect(MinuteRange.durationMinutes(first as AvailabilityOption)).toBe(60);
  });

  it('returns exactly one option per distinct start', () => {
    const options = starts(
      query(
        [line('l1', 30), line('l2', 30)],
        [
          barber(IVAN, { windows: [iv(9, 18)] }),
          barber(NIKO, { windows: [iv(9, 18)] }),
        ],
      ),
    );
    const found = new Set(options.map((option) => option.startMinutes));
    expect(found.size).toBe(options.length);
  });

  it('reaches the END of a long day — the whole reason it exists', () => {
    // The exhaustive walk is capped; with a party of two and two barbers the
    // cap is spent before noon, so a post-filter would show a morning-only
    // shop. Deduplicating during the search spends the budget on breadth.
    const options = starts(
      query(
        [line('l1', 30), line('l2', 30)],
        [
          barber(IVAN, { windows: [iv(9, 20)] }),
          barber(NIKO, { windows: [iv(9, 20)] }),
        ],
      ),
    );
    const lastStart = Math.max(...options.map((option) => option.startMinutes));
    expect(lastStart).toBeGreaterThanOrEqual(H(19));
  });

  it('is deterministic — two identical queries agree exactly', () => {
    const q = query(
      [line('l1', 45), line('l2', 30, BarberPref.specific(NIKO))],
      [
        barber(IVAN, { windows: [iv(9, 14)] }),
        barber(NIKO, { windows: [iv(9, 14)] }),
      ],
    );
    expect(JSON.stringify(starts(q))).toBe(JSON.stringify(starts(q)));
  });
});

// ── The declared-window mask ─────────────────────────────────────────────
// How "I'm free on the 26th, but only 08:00–12:00 and 15:00–16:30" reaches
// the search. Applied to FREE TIME rather than to the returned options, for
// two reasons the tests below pin: the enumeration is capped, and a mask has
// to constrain a party's later seats too.
describe('availableOptions — within', () => {
  it('offers only starts inside the declared window', () => {
    const options = solve([line('a', 60)], [barber(IVAN)], {
      within: [iv(9, 11)],
    });
    const found = options.map((option) => option.startMinutes / H(1));
    expect(Math.min(...found)).toBe(9);
    // A 60-minute service inside 09:00–11:00 last starts at 10:00.
    expect(Math.max(...found)).toBe(10);
  });

  it('honours several disjoint windows in one day', () => {
    const options = solve([line('a', 60)], [barber(IVAN)], {
      within: [iv(8, 10), iv(15, 16.5)],
    });
    const hours = options.map((option) => option.startMinutes / H(1));
    // The shift is 09:00–18:00, so the morning window contributes only its
    // overlap with the roster (09:00), and the afternoon window runs to the
    // last 60-minute start that still ends by 16:30.
    expect(hours).toEqual([9, 15, 15.25, 15.5]);
  });

  it('constrains a party’s LATER seats too, not just the first', () => {
    // Two 60-minute seats, one barber, masked to 09:00–11:00. Sequential is
    // the only shape that fits, and BOTH halves have to land inside the
    // window — a mask applied to the returned options rather than to free
    // time could hand back 09:00 paired with 11:00.
    const options = solve(
      [
        line('a', 60, BarberPref.specific(IVAN)),
        line('b', 60, BarberPref.specific(IVAN)),
      ],
      [barber(IVAN)],
      { within: [iv(9, 11)] },
    );
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      for (const assignment of option.assignments) {
        expect(assignment.startMinutes).toBeGreaterThanOrEqual(H(9));
        expect(assignment.endMinutes).toBeLessThanOrEqual(H(11));
      }
    }
    // Two interchangeable seats can be ordered either way; the window admits
    // exactly the one back-to-back placement, in some order.
    const placements = options.map((option) =>
      option.assignments
        .map((assignment) => assignment.startMinutes / H(1))
        .sort((x, y) => x - y),
    );
    expect(placements).toEqual(placements.map(() => [9, 10]));
  });

  it('still subtracts busy inside the window', () => {
    const options = solve(
      [line('a', 60)],
      [barber(IVAN, { busy: [iv(9, 10)] })],
      {
        within: [iv(9, 11)],
      },
    );
    expect(options.map((option) => option.startMinutes / H(1))).toEqual([10]);
  });
});

/*
 * Risk 9: `within` is ALWAYS present. `null` is unconstrained, `[]` is
 * "nothing qualifies" — one case per side per entry point, so a porter who
 * maps the old optional to `[]` fails here instead of zeroing every ordinary
 * booking.
 */
describe('within — null is unconstrained, [] is nothing', () => {
  const pool = [barber(IVAN)];

  it('availableOptions: within null searches the whole rostered day', () => {
    const options = solve([line('a', 60)], pool, { within: null });
    expect(distinctStarts(options)[0]).toBe(H(9));
    expect(distinctStarts(options).at(-1)).toBe(H(17));
  });

  it('availableOptions: within [] yields no option at all', () => {
    expect(solve([line('a', 60)], pool, { within: [] })).toEqual([]);
  });

  it('availableStarts: within null searches the whole rostered day', () => {
    expect(starts(query([line('a', 60)], pool, { within: null }))).toHaveLength(
      33,
    );
  });

  it('availableStarts: within [] yields no start at all', () => {
    expect(starts(query([line('a', 60)], pool, { within: [] }))).toEqual([]);
  });

  it('hasAnyOption: null finds the day, [] finds nothing', () => {
    expect(
      AvailabilitySystem.hasAnyOption(
        query([line('a', 60)], pool, { within: null }),
        BUDGET,
      ),
    ).toBe(true);
    expect(
      AvailabilitySystem.hasAnyOption(
        query([line('a', 60)], pool, { within: [] }),
        BUDGET,
      ),
    ).toBe(false);
  });

  it('withinOf never turns an unnarrowed day into [] — it is the whole day', () => {
    const mask = AvailabilitySystem.withinOf(
      DayWindows.wholeDay(localDate('2026-08-26')),
    );
    expect(mask).toHaveLength(1);
  });
});

describe('withinOf — a declared day, as the mask (DayWindows.toIntervals)', () => {
  /*
   * The mask is the shop day's wall clock (Law 7.3): a window is a claim
   * about clock faces, and it stays one on the two transition days — the
   * zone never reaches it. Whether a wall-clock minute exists as an instant
   * is the ingestion boundary's question (`ZonedTimeSystem.toUtc` →
   * `DST_GAP_INVALID_TIME`). The legacy instant mask measured transition days
   * in real hours and dropped erased spans; each case keeps its day and pins
   * the wall-clock answer.
   */
  const range = (from: number, to: number) => span(from * 60, to * 60);
  const hours = (window: MinuteRange) =>
    MinuteRange.durationMinutes(window) / 60;

  it('offers the WHOLE day when no window was declared', () => {
    // Empty means "any time", never "no time" — the common answer is "the
    // 26th works" with nothing further, and that must not mask to nothing.
    const mask = AvailabilitySystem.withinOf(
      DayWindows.wholeDay(localDate('2026-08-26')),
    );
    expect(mask).toHaveLength(1);
    expect(hours(mask[0] as MinuteRange)).toBe(24);
  });

  it('keeps the declared spans of ITS day', () => {
    const mask = AvailabilitySystem.withinOf(
      DayWindows.of(localDate('2026-08-26'), [range(8, 12), range(15, 16.5)]),
    );
    expect(mask.map(hours)).toEqual([4, 1.5]);
  });

  it('keeps a spring-forward window on the wall clock: 02:00–05:00 reads three clock hours', () => {
    const mask = AvailabilitySystem.withinOf(
      DayWindows.of(localDate('2026-03-29'), [range(2, 5)]),
    );
    expect(mask.map(hours)).toEqual([3]);
  });

  it('measures a whole transition day as the 24 clock hours of the shop day', () => {
    expect(
      AvailabilitySystem.withinOf(
        DayWindows.wholeDay(localDate('2026-03-29')),
      ).map(hours),
    ).toEqual([24]);
    expect(
      AvailabilitySystem.withinOf(
        DayWindows.wholeDay(localDate('2026-10-25')),
      ).map(hours),
    ).toEqual([24]);
  });

  it('keeps a span the transition erased — the boundary refuses a booking inside it', () => {
    // 03:00–03:30 does not happen in Sofia on 2026-03-29: no slot inside it
    // becomes an instant (toUtc answers DST_GAP_INVALID_TIME), so the mask
    // need not drop it — and the request's other days are never failed.
    const declared = DayWindows.of(localDate('2026-03-29'), [span(180, 210)]);
    expect(declared.windows).toHaveLength(1);
    expect(AvailabilitySystem.withinOf(declared)).toEqual([span(180, 210)]);
  });

  it('answers any day — there is no zone table to fall outside', () => {
    expect(
      AvailabilitySystem.withinOf(DayWindows.wholeDay(localDate('2027-01-05'))),
    ).toEqual([span(0, 1440)]);
  });
});

describe('availableStarts — riders pinned to the party (a client move’s carried seats)', () => {
  function rider(
    barberId: BarberId,
    offsetMinutes: number,
    durationMinutes = 30,
    pads: { before?: number; after?: number } = {},
  ): AvailabilityRider {
    return {
      barberId,
      offsetMinutes: minuteDelta(offsetMinutes),
      terms: terms(durationMinutes, pads.before ?? 0, pads.after ?? 0),
    };
  }

  function startsWith(
    lines: readonly LineDraft[],
    barbers: readonly BarberDayAvailability[],
    riders: readonly AvailabilityRider[],
    overrides: {
      notBefore?: MinuteOfDay | null;
      within?: readonly MinuteRange[] | null;
    } = {},
  ): readonly number[] {
    return starts(query(lines, barbers, { ...overrides, riders })).map(
      (option) => option.startMinutes / H(1),
    );
  }

  it('never offers a start whose side-by-side rider’s barber is busy then', () => {
    // The client with Ivan; the son beside him for an hour with Petar, who is
    // taken 11:00–12:00. 10:15 would put the son 10:15–11:15 — into Petar's
    // booking — and so would every start up to 11:45.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [
        barber(IVAN, { windows: [iv(10, 13)] }),
        barber(PETAR, { busy: [iv(11, 12)] }),
      ],
      [rider(PETAR, 0, 60)],
    );
    expect(found).toEqual([10, 12, 12.25, 12.5]);
  });

  it('keeps a sequential rider sequential — straight after the client, on the same chair', () => {
    // The son follows 30 minutes after the client, same barber: every start
    // must leave Ivan the hour for both, before his 12:00 booking.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [barber(IVAN, { windows: [iv(10, 13)], busy: [iv(12, 13)] })],
      [rider(IVAN, 30, 30)],
    );
    expect(found).toEqual([10, 10.25, 10.5, 10.75, 11]);
  });

  it('refuses the arrangement that sits the client on the rider’s chair — and finds the one that does not', () => {
    // "Anyone" could be Ivan or Petar; Petar is the son's. The tightest
    // arrangement is not the only one: the walk goes on to Ivan.
    const options = starts(
      query(
        [line('me', 30)],
        [
          barber(IVAN, { windows: [iv(10, 11)] }),
          barber(PETAR, { windows: [iv(10, 11)] }),
        ],
        { riders: [rider(PETAR, 0, 30)] },
      ),
    );
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.assignments.map((a) => a.barberId)).toEqual(['ivan']);
    }
  });

  it('refuses a start that would put a rider who goes FIRST inside the lead time', () => {
    // The son starts an hour before the client; nothing may start before 10:00.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [barber(IVAN), barber(PETAR)],
      [rider(PETAR, -60, 30)],
      { notBefore: minute(H(10)), within: [iv(10, 12)] },
    );
    expect(found[0]).toBe(11);
    expect(found.every((start) => start >= 11)).toBe(true);
  });

  it('charges the rider’s own setup and cleanup to their barber', () => {
    // A 30-minute trim with 10 minutes of cleanup needs 40 minutes of Petar,
    // who is gone at 11:00.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [
        barber(IVAN, { windows: [iv(10, 11)] }),
        barber(PETAR, { windows: [iv(10, 11)] }),
      ],
      [rider(PETAR, 0, 30, { after: 10 })],
    );
    expect(found).toEqual([10, 10.25]);
  });

  it('offers nothing when the rider’s barber is not rostered here at all', () => {
    expect(
      startsWith(
        [line('me', 30, BarberPref.specific(IVAN))],
        [barber(IVAN)],
        [rider(PETAR, 0, 30)],
      ),
    ).toEqual([]);
  });

  it('does not narrow a rider by the client’s declared window — that window is about the client', () => {
    // The client asked for 10:00–10:30 only; the son straight after them is
    // outside it, and still fine.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [barber(IVAN)],
      [rider(IVAN, 30, 30)],
      { within: [iv(10, 10.5)] },
    );
    expect(found).toEqual([10]);
  });

  it('keeps two riders on one barber apart from each other', () => {
    // Two carried seats on Petar, back to back at +0 and +30: Petar is free
    // 10:00–11:00 only, so the party can start at 10:00 and nowhere later.
    const found = startsWith(
      [line('me', 30, BarberPref.specific(IVAN))],
      [barber(IVAN), barber(PETAR, { windows: [iv(10, 11)] })],
      [rider(PETAR, 0, 30), rider(PETAR, 30, 30)],
    );
    expect(found).toEqual([10]);
  });

  it('refuses every start when two riders would share one chair at once', () => {
    // Both carried seats at +0 on Petar: whatever the party's start, the
    // second rider lands on the first — the server would refuse that seat.
    expect(
      startsWith(
        [line('me', 30, BarberPref.specific(IVAN))],
        [barber(IVAN), barber(PETAR)],
        [rider(PETAR, 0, 30), rider(PETAR, 0, 30)],
      ),
    ).toEqual([]);
  });

  it('leaves the option the CLIENT’s — riders change which starts exist, never what a start holds', () => {
    const [withRider] = starts(
      query(
        [line('me', 30, BarberPref.specific(IVAN))],
        [barber(IVAN), barber(PETAR)],
        {
          riders: [rider(PETAR, -15, 60)],
        },
      ),
    );
    expect(
      withRider === undefined
        ? null
        : span(withRider.startMinutes, withRider.endMinutes),
    ).toEqual(iv(9.25, 9.75));
    expect(withRider?.assignments.map((a) => a.lineId)).toEqual(['me']);
  });

  it('is the plain search when there are no riders, and only ever removes starts (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }).map((quarters) => quarters * 15),
        fc.integer({ min: -8, max: 8 }).map((quarters) => quarters * 15),
        fc.integer({ min: 1, max: 4 }).map((quarters) => quarters * 15),
        fc.boolean(),
        fc.integer({ min: 9, max: 16 }),
        (lineMinutes, offset, riderMinutes, sameChair, busyHour) => {
          const lines = [line('me', lineMinutes)];
          const barbers = [
            barber(IVAN, { busy: [iv(busyHour, busyHour + 1)] }),
            barber(PETAR, { busy: [iv(busyHour + 1, busyHour + 2)] }),
          ];
          const only = rider(sameChair ? IVAN : PETAR, offset, riderMinutes);
          const plain = startsWith(lines, barbers, []);

          const pinned = starts(query(lines, barbers, { riders: [only] }));
          for (const option of pinned) {
            // Removes, never adds…
            expect(plain).toContain(option.startMinutes / H(1));
            // …and every offered start leaves the rider in its barber's free
            // time, clear of the client's own chair.
            const riderStart = option.startMinutes + only.offsetMinutes;
            const riderSlot = span(
              riderStart,
              riderStart + only.terms.durationMinutes,
            );
            const owner = barbers.find(
              (candidate) => candidate.barberId === only.barberId,
            ) as BarberDayAvailability;
            const free = IntervalSetSystem.subtract(owner.windows, owner.busy);
            expect(
              free.some((gap) => MinuteRange.contains(gap, riderSlot)),
            ).toBe(true);
            for (const assignment of option.assignments) {
              if (assignment.barberId === only.barberId) {
                expect(MinuteRange.overlaps(assignment, riderSlot)).toBe(false);
              }
            }
          }
        },
      ),
    );
  });
});

describe('paddedBusy — the busy a placement is checked against', () => {
  const M = (minutes: number) => minutes;
  const chair = (barberId: BarberId, range: MinuteRange) => ({
    barberId,
    startMinutes: minute(range.startMinutes),
    endMinutes: endMinute(range.endMinutes),
  });

  it('pads every stored span by the barber’s turnaround, merging what then touches', () => {
    expect(
      AvailabilitySystem.paddedBusy({
        barberId: IVAN,
        spans: [iv(10, 11), span(H(11, 30), H(12))],
        turnaroundMinutes: minuteCount(15),
        release: [],
      }),
    ).toEqual([span(H(9, 45), H(12, 15))]);
  });

  it('hands a moved visit’s own chair back BEFORE padding, so a neighbour keeps its turnaround', () => {
    // The visit being moved holds Ivan 10:00–11:00; somebody else follows at
    // 11:00. Stored merged, they read as one 10:00–12:00 span.
    const released = AvailabilitySystem.paddedBusy({
      barberId: IVAN,
      spans: [iv(10, 12)],
      turnaroundMinutes: minuteCount(15),
      release: [chair(IVAN, iv(10, 11))],
    });
    // The neighbour's own turnaround survives: 10:45, not 11:15. Subtracting
    // the PADDED own span instead would free 10:45–11:15, and the grid would
    // offer a 10:30 half-hour the server refuses.
    expect(released).toEqual([span(H(10, 45), H(12, 15))]);
  });

  it('ignores chair time on other barbers — a whole visit can be released for everyone', () => {
    expect(
      AvailabilitySystem.paddedBusy({
        barberId: IVAN,
        spans: [iv(10, 11)],
        turnaroundMinutes: MinuteCount.ZERO,
        release: [chair(NIKO, iv(10, 11))],
      }),
    ).toEqual([iv(10, 11)]);
  });

  it('never meets a negative turnaround — the MinuteCount brand refuses it at its edge, and none pads nothing', () => {
    // The legacy rule clamped a negative turnaround to none; a turnaround is
    // now a `MinuteCount`, so a negative one is refused where it is read
    // (`MinuteCount.of`) and the rule only ever sees zero or more.
    expect(MinuteCount.of(-15).ok).toBe(false);
    expect(
      AvailabilitySystem.paddedBusy({
        barberId: IVAN,
        spans: [iv(10, 11)],
        turnaroundMinutes: MinuteCount.ZERO,
        release: [],
      }),
    ).toEqual([iv(10, 11)]);
  });

  it('answers exactly what the server decides a move against: the projection minus the visit, padded (property)', () => {
    // Back-to-back and spaced seats on one chair, each either the moved
    // visit's or somebody else's — never overlapping, as the book guarantees.
    const seat = fc.record({
      gap: fc.integer({ min: 0, max: 8 }).map((steps) => steps * 15),
      length: fc.integer({ min: 1, max: 8 }).map((steps) => steps * 15),
      own: fc.boolean(),
    });
    fc.assert(
      fc.property(
        // At most six seats of ≤ 4 h each from midnight — one shop day.
        fc.array(seat, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 30 }),
        (seats, turnaround) => {
          const own: MinuteRange[] = [];
          const others: MinuteRange[] = [];
          let cursor = H(0);
          for (const entry of seats) {
            const seatSpan = span(
              cursor + M(entry.gap),
              cursor + M(entry.gap + entry.length),
            );
            (entry.own ? own : others).push(seatSpan);
            cursor = seatSpan.endMinutes;
          }
          // The projection stores the merged union — who is who is gone.
          const stored = IntervalSetSystem.normalize([...own, ...others]);
          expect(
            AvailabilitySystem.paddedBusy({
              barberId: IVAN,
              spans: stored,
              turnaroundMinutes: minuteCount(turnaround),
              release: own.map((occupied) => chair(IVAN, occupied)),
            }),
          ).toEqual(
            AvailabilitySystem.paddedBusy({
              barberId: IVAN,
              spans: others,
              turnaroundMinutes: minuteCount(turnaround),
              release: [],
            }),
          );
        },
      ),
    );
  });
});

describe('leadFloor and distinctStarts', () => {
  it('puts the floor minLeadMinutes after now, on the shop’s wall clock', () => {
    const today = localDate('2026-07-29');
    const nine = ShopNow.of(
      today,
      minute(H(9)),
      utcMs('2026-07-29T09:00:00+03:00'),
    );
    const lead = { ...POLICY, minLeadMinutes: minuteCount(120) };
    expect(AvailabilitySystem.leadFloor(nine, lead, today)).toBe(H(11));
    // Carried across midnight: 23:00 + 2 h is 01:00 tomorrow; tomorrow's
    // floor is 01:00, and today is too soon from 22:00 on.
    const eleven = ShopNow.of(
      today,
      minute(H(23)),
      utcMs('2026-07-29T23:00:00+03:00'),
    );
    expect(
      AvailabilitySystem.leadFloor(eleven, lead, localDate('2026-07-30')),
    ).toBe(H(1));
    expect(AvailabilitySystem.leadFloor(eleven, lead, today)).toBeNull();
    // A day further out opens from its midnight; a past day is too soon.
    expect(
      AvailabilitySystem.leadFloor(nine, lead, localDate('2026-07-31')),
    ).toBe(0);
    expect(
      AvailabilitySystem.leadFloor(nine, lead, localDate('2026-07-28')),
    ).toBeNull();
  });

  it('lists each party start once, in order', () => {
    const options = solve(
      [line('a', 30), line('b', 30)],
      [
        barber(IVAN, { windows: [iv(9, 10.5)] }),
        barber(NIKO, { windows: [iv(9, 10.5)] }),
      ],
    );
    const found = distinctStarts(options);
    expect(new Set(found).size).toBe(found.length);
    expect([...found].sort((x, y) => x - y)).toEqual(found);
  });
});

/* ── The budget is a pure output ───────────────────────────────────────── */

describe('the search budget — nodeBudget, maxOptions, nodesVisited, exhausted', () => {
  const wide = () =>
    query(
      [line('a', 15), line('b', 15), line('c', 15)],
      [
        barber(IVAN, { windows: [iv(9, 18)] }),
        barber(NIKO, { windows: [iv(9, 18)] }),
      ],
    );

  it('never tries more than nodeBudget placements, and says when it ran out', () => {
    const result = AvailabilitySystem.availableStarts(wide(), {
      nodeBudget: 500,
      maxOptions: 10_000,
    });
    expect(result.nodesVisited).toBe(500);
    expect(result.exhausted).toBe(true);
    // What it found before the budget ran out is still a valid answer.
    expect(result.options.length).toBeGreaterThan(0);
  });

  it('is not exhausted when the walk finishes inside the budget', () => {
    const result = AvailabilitySystem.availableOptions(
      query([line('a', 60)], [barber(IVAN, { windows: [iv(9, 11)] })]),
      BUDGET,
    );
    expect(result.exhausted).toBe(false);
    // 09:00, 09:15, 09:30, 09:45, 10:00 — one node per placement tried.
    expect(result.nodesVisited).toBe(5);
    expect(result.options).toHaveLength(5);
  });

  it('stops at maxOptions without calling it exhaustion', () => {
    const result = AvailabilitySystem.availableOptions(wide(), {
      nodeBudget: BUDGET.nodeBudget,
      maxOptions: 7,
    });
    expect(result.options).toHaveLength(7);
    expect(result.exhausted).toBe(false);
    expect(result.nodesVisited).toBeLessThan(BUDGET.nodeBudget);
  });

  it('costs nothing for an empty party', () => {
    expect(
      AvailabilitySystem.availableStarts(query([], [barber(IVAN)]), BUDGET),
    ).toEqual({
      options: [],
      exhausted: false,
      nodesVisited: 0,
    });
  });
});

/* ── The seed catalogue, against the legacy engine ─────────────────────── */

/*
 * A Tuesday at Center as `tools/seed/catalog.mjs` stocks it: Ivan and Stefan
 * on the split shift (turnaround 10 and 15), Niko on the late shift
 * (turnaround 0), each with the seed's busy pattern, and the classic cut,
 * fade and beard priced per barber. The legacy engine
 * (`libs/domain/scheduling/src/lib/availability.ts`, run once on 2026-10-10
 * with a node counter added in a scratch copy) visited the node counts and
 * produced the answers recorded below; the digest is djb2-xor over the
 * rendered list. The port must answer the same and never search more.
 */
const LEGACY = {
  partyOf3: {
    startsNodes: 167_690,
    starts: 39,
    startsDigest: 591_184_175,
    optionsNodes: 206,
    options: 200,
    optionsDigest: 4_012_671_369,
  },
  partyOf2: {
    startsNodes: 2_938,
    starts: 39,
    startsDigest: 822_222_547,
    optionsNodes: 204,
    options: 200,
    optionsDigest: 269_612_432,
  },
  single: {
    startsNodes: 61,
    starts: 42,
    startsDigest: 2_834_341_561,
    optionsNodes: 61,
    options: 61,
    optionsDigest: 2_203_158_332,
  },
} as const;

function seedCatalogue(lineCount: number): AvailabilityQuery {
  const STEFAN = BarberId.of('stefan');
  const pool = [
    {
      id: IVAN,
      turnaround: 10,
      windows: [iv(9, 13), iv(14, 18)],
      busy: [span(H(10), H(10, 45)), iv(15, 16)],
    },
    {
      id: NIKO,
      turnaround: 0,
      windows: [iv(12, 20)],
      busy: [span(H(13), H(13, 45)), span(H(17, 30), H(18, 15))],
    },
    {
      id: STEFAN,
      turnaround: 15,
      windows: [iv(9, 13), iv(14, 18)],
      busy: [span(H(11), H(11, 45))],
    },
  ].map((seed): BarberDayAvailability => ({
    barberId: seed.id,
    windows: seed.windows,
    busy: AvailabilitySystem.paddedBusy({
      barberId: seed.id,
      spans: seed.busy,
      turnaroundMinutes: minuteCount(seed.turnaround),
      release: [],
    }),
    blocks: [],
  }));
  const by = (
    entries: readonly (readonly [BarberId, number])[],
  ): readonly BarberTerms[] =>
    entries.map(([barberId, minutes]) => ({ barberId, terms: terms(minutes) }));
  const lines = [
    line(
      'cut',
      45,
      BarberPref.any(),
      {},
      'self',
      by([
        [IVAN, 35],
        [NIKO, 30],
        [STEFAN, 45],
      ]),
    ),
    line(
      'fade',
      50,
      BarberPref.any(),
      {},
      'guest-0',
      by([
        [NIKO, 45],
        [IVAN, 50],
        [STEFAN, 55],
      ]),
    ),
    line(
      'beard',
      30,
      BarberPref.any(),
      {},
      'self',
      by([
        [STEFAN, 25],
        [IVAN, 30],
      ]),
    ),
  ];
  return query(lines.slice(0, lineCount), pool);
}

/** The legacy driver's rendering: `lineId@startMinute/barber`, options joined by `|`. */
function legacyRender(options: readonly AvailabilityOption[]): string {
  return options
    .map((option) =>
      option.assignments
        .map((a) => `${a.lineId}@${a.startMinutes}/${a.barberId}`)
        .join(' '),
    )
    .join('|');
}

function digest(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

describe('the seed catalogue — hot path #1 against the legacy engine', () => {
  const cases = [
    ['a party of three', 3, LEGACY.partyOf3],
    ['a party of two', 2, LEGACY.partyOf2],
    ['a single seat', 1, LEGACY.single],
  ] as const;

  for (const [name, lineCount, legacy] of cases) {
    it(`${name}: the grid answers as the legacy engine did, in no more nodes`, () => {
      const result = AvailabilitySystem.availableStarts(
        seedCatalogue(lineCount),
        BUDGET,
      );
      expect(result.exhausted).toBe(false);
      expect(result.nodesVisited).toBeLessThanOrEqual(legacy.startsNodes);
      expect(result.options).toHaveLength(legacy.starts);
      expect(digest(legacyRender(result.options))).toBe(legacy.startsDigest);
    });

    it(`${name}: the option list answers as the legacy engine did, in no more nodes`, () => {
      const result = AvailabilitySystem.availableOptions(
        seedCatalogue(lineCount),
        BUDGET,
      );
      expect(result.nodesVisited).toBeLessThanOrEqual(legacy.optionsNodes);
      expect(result.options).toHaveLength(legacy.options);
      expect(digest(legacyRender(result.options))).toBe(legacy.optionsDigest);
    });
  }

  it('the party of three opens and closes the day where the legacy grid did', () => {
    const grid = AvailabilitySystem.availableStarts(
      seedCatalogue(3),
      BUDGET,
    ).options;
    expect(legacyRender(grid.slice(0, 1))).toBe(
      'cut@540/stefan fade@540/ivan beard@585/stefan',
    );
    expect(legacyRender(grid.slice(-1))).toBe(
      'fade@1095/niko cut@1140/niko beard@1170/niko',
    );
  });
});

/* ── Equivalence against a naive reference search (property) ────────────── */

/**
 * The legacy algorithm (`availability.ts:422-612`) written the naive way —
 * `filter`/`map`/`some` per branch, a materialised candidate list per (line,
 * barber) — over the same types and the same ranking (barber INDEX
 * tie-breaks). Test-only: the shipped engine must give the same answer in no
 * more nodes.
 */
function referenceSearch(
  q: AvailabilityQuery,
  limits: SearchBudget,
  dedupe: boolean,
): AvailabilityResult {
  const { lines, barbers } = q;
  if (lines.length === 0 || limits.maxOptions <= 0 || q.notBefore === null)
    return { options: [], exhausted: false, nodesVisited: 0 };
  const notBefore = q.notBefore;
  const open = barbers.map((b) =>
    IntervalSetSystem.subtract(b.windows, b.busy),
  );
  const free = open.map((o) =>
    q.within === null ? o : IntervalSetSystem.intersect(o, q.within),
  );
  const ordered = lines
    .map((l, index) => ({ l, index }))
    .sort((a, b) => {
      const sa = a.l.barberPreference === BarberPreference.Specific ? 0 : 1;
      const sb = b.l.barberPreference === BarberPreference.Specific ? 0 : 1;
      return (
        sa - sb ||
        b.l.durationMinutes - a.l.durationMinutes ||
        (a.l.lineId < b.l.lineId ? -1 : a.l.lineId > b.l.lineId ? 1 : 0)
      );
    });
  type Pick = {
    lineId: CartLineId;
    barberIndex: number;
    slot: MinuteRange;
    occupied: MinuteRange;
    personKey: string | null;
  };
  const chosen: Pick[] = [];
  const options: AvailabilityOption[] = [];
  const byStart = new Map<number, number>();
  let nodes = 0;
  let exhausted = false;
  const seq = (o: AvailabilityOption) =>
    o.assignments.map((a) => a.barberIndex);
  const cmpSeq = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a.at(i) !== b.at(i)) return (a.at(i) as number) - (b.at(i) as number);
    return a.length - b.length;
  };
  const ridersFit = (partyStart: number): boolean => {
    const placed = chosen.map((p) => ({
      barberIndex: p.barberIndex,
      occupied: p.occupied,
    }));
    for (const rider of q.riders) {
      const sold = partyStart + rider.offsetMinutes;
      const from = sold - rider.terms.padBeforeMinutes;
      const to =
        sold + rider.terms.durationMinutes + rider.terms.padAfterMinutes;
      if (from < notBefore) return false;
      // Off the shop day's clock is outside every gap.
      if (from < 0 || to > 1440) return false;
      const occupied = span(from, to);
      const b = barbers.findIndex((x) => x.barberId === rider.barberId);
      if (b < 0) return false;
      const remaining = IntervalSetSystem.subtract(
        open.at(b) as readonly MinuteRange[],
        placed.filter((p) => p.barberIndex === b).map((p) => p.occupied),
      );
      if (!remaining.some((gap) => MinuteRange.contains(gap, occupied)))
        return false;
      placed.push({ barberIndex: b, occupied });
    }
    return true;
  };
  const walk = (index: number): void => {
    if (options.length >= limits.maxOptions) return;
    if (index === ordered.length) {
      const envelope = span(
        Math.min(...chosen.map((p) => p.slot.startMinutes)),
        Math.max(...chosen.map((p) => p.slot.endMinutes)),
      );
      if (q.riders.length > 0 && !ridersFit(envelope.startMinutes)) return;
      const option: AvailabilityOption = {
        startMinutes: minute(envelope.startMinutes),
        endMinutes: endMinute(envelope.endMinutes),
        assignments: chosen
          .map((p) => ({
            lineId: p.lineId,
            barberId: (barbers[p.barberIndex] as BarberDayAvailability)
              .barberId,
            barberIndex: p.barberIndex,
            startMinutes: minute(p.slot.startMinutes),
            endMinutes: endMinute(p.slot.endMinutes),
          }))
          .sort(
            (a, b) =>
              a.startMinutes - b.startMinutes ||
              (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0),
          ),
      };
      if (!dedupe) {
        options.push(option);
        return;
      }
      const existing = byStart.get(envelope.startMinutes);
      if (existing === undefined) {
        byStart.set(envelope.startMinutes, options.length);
        options.push(option);
      } else {
        const incumbent = options.at(existing) as AvailabilityOption;
        const tighter =
          option.endMinutes !== incumbent.endMinutes
            ? option.endMinutes < incumbent.endMinutes
            : cmpSeq(seq(option), seq(incumbent)) < 0;
        if (tighter) options.splice(existing, 1, option);
      }
      return;
    }
    const { l } = ordered.at(index) as { l: AvailabilityLine };
    for (let b = 0; b < barbers.length; b++) {
      if (
        !BarberPref.matches(
          l,
          (barbers.at(b) as BarberDayAvailability).barberId,
        )
      )
        continue;
      const remaining = IntervalSetSystem.subtract(
        free.at(b) as readonly MinuteRange[],
        chosen.filter((p) => p.barberIndex === b).map((p) => p.occupied),
      );
      const t = AvailabilitySystem.termsAt(l, b);
      const occupiedMinutes =
        t.padBeforeMinutes + t.durationMinutes + t.padAfterMinutes;
      for (const start of AvailabilitySystem.candidateStarts(
        remaining,
        duration(occupiedMinutes),
        q.policy.slotStepMinutes,
        notBefore,
      )) {
        if (nodes >= limits.nodeBudget) {
          exhausted = true;
          return;
        }
        nodes++;
        const occupied = span(start, start + occupiedMinutes);
        const serviceStart = start + t.padBeforeMinutes;
        const slot = span(serviceStart, serviceStart + t.durationMinutes);
        if (
          chosen.some(
            (p) =>
              p.barberIndex === b && MinuteRange.overlaps(p.occupied, occupied),
          )
        )
          continue;
        if (
          l.personKey !== null &&
          chosen.some(
            (p) =>
              p.personKey === l.personKey && MinuteRange.overlaps(p.slot, slot),
          )
        )
          continue;
        chosen.push({
          lineId: l.lineId,
          barberIndex: b,
          slot,
          occupied,
          personKey: l.personKey,
        });
        walk(index + 1);
        chosen.pop();
        if (exhausted || options.length >= limits.maxOptions) return;
      }
    }
  };
  walk(0);
  options.sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      cmpSeq(seq(a), seq(b)),
  );
  return { options, exhausted, nodesVisited: nodes };
}

const NAMES = [IVAN, NIKO, PETAR] as const;

/** A random small query: windows 08:00–14:00, quarter-hour geometry. */
const anyQuery = fc
  .record({
    barbers: fc.uniqueArray(fc.integer({ min: 0, max: 2 }), {
      minLength: 1,
      maxLength: 3,
    }),
    windows: fc.array(
      fc.tuple(
        fc.integer({ min: 32, max: 50 }),
        fc.integer({ min: 2, max: 16 }),
      ),
      { minLength: 1, maxLength: 2 },
    ),
    busy: fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 36, max: 52 }),
        fc.integer({ min: 1, max: 6 }),
      ),
      { maxLength: 3 },
    ),
    lines: fc.array(
      fc.record({
        quarters: fc.integer({ min: 1, max: 4 }),
        before: fc.constantFrom(0, 0, 5),
        after: fc.constantFrom(0, 0, 10),
        specific: fc.option(fc.integer({ min: 0, max: 2 }), { nil: null }),
        person: fc.constantFrom<string | null>('self', 'guest-0', null),
        override: fc.option(
          fc.tuple(
            fc.integer({ min: 0, max: 2 }),
            fc.integer({ min: 1, max: 4 }),
          ),
          { nil: null },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    rider: fc.option(
      fc.tuple(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: -4, max: 4 }),
        fc.integer({ min: 1, max: 3 }),
      ),
      { nil: null },
    ),
    within: fc.constantFrom<'none' | 'empty' | 'morning'>(
      'none',
      'none',
      'empty',
      'morning',
    ),
    notBeforeQuarters: fc.integer({ min: 0, max: 44 }),
    maxOptions: fc.constantFrom(1, 5, 40, 1_000),
    nodeBudget: fc.constantFrom(30, 400, 20_000),
    reversed: fc.boolean(),
  })
  .map((draft) => {
    const Q = (quarters: number) => quarters * 15;
    const pool = draft.barbers.map((n) => {
      const id = NAMES.at(n) as BarberId;
      return barber(id, {
        windows: draft.windows.map(([from, length]) =>
          span(Q(from), Q(from + length)),
        ),
        busy: draft.busy
          .filter(([who]) => who === n)
          .map(([, from, length]) => span(Q(from), Q(from + length))),
      });
    });
    const drafts = draft.lines.map((l, i) =>
      line(
        `l${i}`,
        l.quarters * 15,
        l.specific === null
          ? BarberPref.any()
          : BarberPref.specific(NAMES[l.specific] as BarberId),
        { before: l.before, after: l.after },
        l.person,
        l.override === null
          ? []
          : [
              {
                barberId: NAMES[l.override[0]] as BarberId,
                terms: terms(l.override[1] * 15, l.before, l.after),
              },
            ],
      ),
    );
    const q = query(draft.reversed ? [...drafts].reverse() : drafts, pool, {
      notBefore: minute(Q(draft.notBeforeQuarters)),
      within:
        draft.within === 'none'
          ? null
          : draft.within === 'empty'
            ? []
            : [span(Q(36), Q(46))],
      riders:
        draft.rider === null
          ? []
          : [
              {
                barberId: NAMES[draft.rider[0]] as BarberId,
                offsetMinutes: minuteDelta(draft.rider[1] * 15),
                terms: terms(draft.rider[2] * 15),
              },
            ],
    });
    return {
      q,
      limits: { nodeBudget: draft.nodeBudget, maxOptions: draft.maxOptions },
    };
  });

describe('AvailabilitySystem — equivalence and determinism (fast-check)', () => {
  it('availableOptions equals the naive reference search, in no more nodes', () => {
    fc.assert(
      fc.property(anyQuery, ({ q, limits }) => {
        const shipped = AvailabilitySystem.availableOptions(q, limits);
        const reference = referenceSearch(q, limits, false);
        expect(shipped.options).toEqual(reference.options);
        expect(shipped.exhausted).toBe(reference.exhausted);
        expect(shipped.nodesVisited).toBeLessThanOrEqual(
          reference.nodesVisited,
        );
        expect(shipped.nodesVisited).toBeLessThanOrEqual(limits.nodeBudget);
      }),
      { numRuns: 150 },
    );
  });

  it('availableStarts equals the naive reference search, in no more nodes', () => {
    fc.assert(
      fc.property(anyQuery, ({ q, limits }) => {
        const shipped = AvailabilitySystem.availableStarts(q, limits);
        const reference = referenceSearch(q, limits, true);
        expect(shipped.options).toEqual(reference.options);
        expect(shipped.exhausted).toBe(reference.exhausted);
        expect(shipped.nodesVisited).toBeLessThanOrEqual(
          reference.nodesVisited,
        );
      }),
      { numRuns: 150 },
    );
  });

  it('is deterministic: the same query twice, or its lines in another order, answers byte-identically', () => {
    fc.assert(
      fc.property(anyQuery, ({ q, limits }) => {
        const once = AvailabilitySystem.availableStarts(q, limits);
        const twice = AvailabilitySystem.availableStarts(q, limits);
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        const reordered = { ...q, lines: [...q.lines].reverse() };
        expect(
          JSON.stringify(AvailabilitySystem.availableStarts(reordered, limits)),
        ).toBe(JSON.stringify(once));
        expect(
          JSON.stringify(
            AvailabilitySystem.availableOptions(reordered, limits),
          ),
        ).toBe(JSON.stringify(AvailabilitySystem.availableOptions(q, limits)));
      }),
      { numRuns: 100 },
    );
  });
});

describe('AvailabilitySystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const q = deepFreeze(seedCatalogue(2));
    const limits = deepFreeze({ nodeBudget: 50_000, maxOptions: 60 });
    const once = AvailabilitySystem.availableStarts(q, limits);
    const twice = AvailabilitySystem.availableStarts(q, limits);
    expect(twice).toEqual(once);
    expect(AvailabilitySystem.availableOptions(q, limits)).toEqual(
      AvailabilitySystem.availableOptions(q, limits),
    );
    const riders = deepFreeze(
      query(
        [line('me', 30, BarberPref.specific(IVAN))],
        [barber(IVAN), barber(PETAR)],
        {
          riders: [
            {
              barberId: PETAR,
              offsetMinutes: minuteDelta(30),
              terms: terms(30),
            },
          ],
          within: [iv(10, 12)],
        },
      ),
    );
    expect(AvailabilitySystem.availableStarts(riders, BUDGET)).toEqual(
      AvailabilitySystem.availableStarts(riders, BUDGET),
    );
    const busyInput = deepFreeze({
      barberId: IVAN,
      spans: [iv(10, 12)],
      turnaroundMinutes: minuteCount(15),
      release: [
        {
          barberId: IVAN,
          startMinutes: minute(H(10)),
          endMinutes: endMinute(H(11)),
        },
      ],
    });
    expect(AvailabilitySystem.paddedBusy(busyInput)).toEqual(
      AvailabilitySystem.paddedBusy(busyInput),
    );
  });
});

/*
 * libs/domain/scheduling/src/lib/availability-composition.spec.ts, COPIED
 * (the original keeps running against the shims): the roster feeding the
 * search — `RosterSystem.buildDayWindows` → `RosterSystem.intervalsOf` →
 * `AvailabilitySystem.availableOptions` — against the real seeded shop:
 *   Ivan   — classic cut 35m (short) / 50m (long)
 *   Niko   — classic cut 30m (short) / 45m (long)
 *   Stefan — flat 45m, Center only
 * Shop opens 09:00–20:00 Mon–Fri. 2026-07-29 is a Wednesday.
 */
describe('RosterSystem → AvailabilitySystem composed', () => {
  const CENTER = LocationId.of('loc-center');
  const STEFAN = BarberId.of('stefan');
  const DAY = localDate('2026-07-29');

  /** `'HH:mm'` → minutes of the day. */
  const minutes = (hhmm: string): number =>
    Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  /** A local wall-clock time on the test day, in minutes. */
  const at = (hhmm: string): number => minutes(hhmm);
  /** Minutes of the test day → `'HH:mm'`. */
  const clock = (total: number): string => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  /** The same shifts Monday to Saturday, at Center, from 2026-01-01. */
  function weekdayRoster(
    ranges: readonly (readonly [string, string])[],
  ): readonly ScheduleVersion[] {
    const segments: ShiftSegment[] = [];
    for (const weekday of [
      Weekday.Mon,
      Weekday.Tue,
      Weekday.Wed,
      Weekday.Thu,
      Weekday.Fri,
      Weekday.Sat,
    ]) {
      for (const [start, end] of ranges) {
        segments.push(
          ShiftSegment.of(
            weekday,
            CENTER,
            minute(minutes(start)),
            endMinute(minutes(end)),
          ),
        );
      }
    }
    return ScheduleVersion.startingWith(segments, localDate('2026-01-01'));
  }

  /** Materialise one barber's day through the real roster pipeline. */
  function barberDay(options: {
    readonly id: BarberId;
    readonly roster: readonly (readonly [string, string])[];
    readonly busy?: readonly MinuteRange[];
    readonly exceptions?: readonly DayException[];
  }): BarberDayAvailability {
    const windows = RosterSystem.buildDayWindows({
      barberId: options.id,
      localDate: DAY,
      versions: weekdayRoster(options.roster),
      exceptions: options.exceptions ?? [],
      shopHours: [
        {
          locationId: CENTER,
          hours: [
            ShopDayHours.of(
              minute(minutes('09:00')),
              endMinute(minutes('20:00')),
            ),
          ],
        },
      ],
    });
    return {
      // Roster windows ARE minute ranges of the day — no conversion.
      barberId: options.id,
      windows,
      busy: options.busy ?? [],
      blocks: [],
    };
  }

  /** The legacy fixture: lead time well before the day, up to 400 options. */
  const composed = (
    drafts: readonly LineDraft[],
    barbers: readonly BarberDayAvailability[],
  ) =>
    solve(drafts, barbers, {
      // A week before the day: the floor is the day's midnight.
      notBefore: minute(0),
      maxOptions: 400,
    });

  it('a solo booking is offered from the shop’s opening, not the barber’s', () => {
    // Ivan is rostered 08:00–19:00 but the shop opens at 09:00. The public
    // surface starts at 09:00 (ruling R1).
    const ivan = barberDay({ id: IVAN, roster: [['08:00', '19:00']] });
    const options = composed([line('l1', 35)], [ivan]);
    expect(clock(distinctStarts(options)[0] as number)).toBe('09:00');
  });

  it('respects a lunch break carved out of the roster', () => {
    // The staff editor's reasoned break, sanitised to its public effect.
    const lunch = ScheduleExceptionSystem.publicEffect(
      ExceptionDetail.break([span(minutes('13:00'), minutes('14:00'))], false),
    );
    if (!lunch.ok) throw new Error('bad fixture');
    const ivan = barberDay({
      id: IVAN,
      roster: [['09:00', '18:00']],
      exceptions: [{ localDate: DAY, ...lunch.value }],
    });

    const starts = composed([line('l1', 35)], [ivan]).map((option) =>
      clock(option.startMinutes),
    );
    // 12:45 + 35m would run into the break.
    expect(starts).toContain('12:15');
    expect(starts).not.toContain('12:45');
    expect(starts).toContain('14:00');
  });

  it('a father-and-son party gets BOTH arrangements on a quiet day', () => {
    const ivan = barberDay({ id: IVAN, roster: [['09:00', '18:00']] });
    const niko = barberDay({ id: NIKO, roster: [['09:00', '18:00']] });

    // Ivan's cut is 35m, Niko's 30m — the party wants "anyone" twice.
    const options = composed([line('dad', 35), line('son', 30)], [ivan, niko]);

    const parallel = options.filter(
      (option) =>
        new Set(option.assignments.map((a) => a.startMinutes)).size === 1,
    );
    const sequential = options.filter(
      (option) => new Set(option.assignments.map((a) => a.barberId)).size === 1,
    );
    expect(parallel.length).toBeGreaterThan(0);
    expect(sequential.length).toBeGreaterThan(0);

    // Parallel is the shorter visit and therefore ranks first at a given start.
    const earliest = options[0] as AvailabilityOption;
    expect(clock(earliest.startMinutes)).toBe('09:00');
    expect(MinuteRange.durationMinutes(earliest)).toBe(35);
  });

  it('a party who both want IVAN can only go sequentially', () => {
    const ivan = barberDay({ id: IVAN, roster: [['09:00', '18:00']] });
    const niko = barberDay({ id: NIKO, roster: [['09:00', '18:00']] });
    const pref = BarberPref.specific(IVAN);

    const options = composed(
      [line('dad', 35, pref), line('son', 35, pref)],
      [ivan, niko],
    );
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      // Only Ivan, and never at the same moment.
      expect(option.assignments.every((a) => a.barberId === IVAN)).toBe(true);
      expect(new Set(option.assignments.map((a) => a.startMinutes)).size).toBe(
        2,
      );
    }
    // 09:00 + 09:35, back to back with no gap.
    const sorted = [...(options[0] as AvailabilityOption).assignments].sort(
      (a, b) => a.startMinutes - b.startMinutes,
    );
    expect(sorted[0]?.endMinutes).toBe(sorted[1]?.startMinutes);
  });

  it('a fully-booked day yields nothing rather than a wrong slot', () => {
    const ivan = barberDay({
      id: IVAN,
      roster: [['09:00', '18:00']],
      busy: [span(at('09:00'), at('18:00'))],
    });
    expect(composed([line('l1', 35)], [ivan])).toEqual([]);
  });

  it('a closed shop day yields nothing for anyone', () => {
    // A shop-wide closure, fanned out: this barber's own `closed` effect.
    const ivan = barberDay({
      id: IVAN,
      roster: [['09:00', '18:00']],
      exceptions: [{ localDate: DAY, ...ExceptionEffectRule.closed() }],
    });
    expect(ivan.windows).toEqual([]);
    expect(composed([line('l1', 35)], [ivan])).toEqual([]);
  });

  it('Stefan’s 15-minute turnaround shows up as a gap after an existing booking', () => {
    // Stefan is booked 10:00–10:45 and needs 15 minutes to reset. The caller
    // has already padded the busy interval, which is where the gap comes from.
    const stefan = barberDay({
      id: STEFAN,
      roster: [['09:00', '12:00']],
      busy: [span(at('10:00') - 15, at('10:45') + 15)],
    });

    const starts = composed([line('l1', 45)], [stefan]).map((option) =>
      clock(option.startMinutes),
    );
    // The padded block runs 09:45–11:00, so free time is 09:00–09:45 and
    // 11:00–12:00. A 45-minute service fits each exactly once — the
    // turnaround is charged once, on the busy side, not twice.
    expect(starts).toContain('09:00');
    expect(starts).not.toContain('09:15');
    expect(starts).not.toContain('10:00');
    expect(starts).toContain('11:00');
  });
});
