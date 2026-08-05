import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  type AvailabilityLine,
  type AvailabilityOption,
  type BarberDayAvailability,
  availableOptions,
  availableStarts,
  candidateStarts,
  distinctStarts,
  hasAnyOption,
} from './availability';
import { BarberPref } from './barber-pref';
import { BookingPolicy } from './booking-policy';
import { Interval } from './interval';

/** Minutes from an arbitrary day origin — reads like a clock in the tests. */
const H = (hours: number, minutes = 0) => (hours * 60 + minutes) * 60_000;
const iv = (fromH: number, toH: number) => Interval.of(H(fromH), H(toH));

function barberId(raw: string): BarberId {
  const result = BarberId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function locationId(): LocationId {
  const result = LocationId.create('loc-center');
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

const IVAN = barberId('ivan');
const NIKO = barberId('niko');

function barber(
  id: BarberId,
  options: {
    windows?: readonly Interval[];
    busy?: readonly Interval[];
  } = {},
): BarberDayAvailability {
  return {
    barberId: id,
    windows: (options.windows ?? [iv(9, 18)]).map((interval) => ({
      interval,
      locationId: locationId(),
    })),
    busy: options.busy ?? [],
  };
}

function line(
  lineId: string,
  durationMinutes: number,
  pref: BarberPref = BarberPref.any(),
  pads: { before?: number; after?: number } = {},
): AvailabilityLine {
  return {
    lineId,
    barberPref: pref,
    durationMinutes,
    padBeforeMinutes: pads.before ?? 0,
    padAfterMinutes: pads.after ?? 0,
  };
}

const policy = BookingPolicy.create({
  maxPartySize: 5,
  slotStepMinutes: 15,
  minLeadMinutes: 0,
  horizonMonths: 2,
  maxFlexibleDays: 7,
  cancellationWindowHours: 24,
});
if (policy.isFailure()) throw new Error('bad fixture');
const POLICY = policy.value;

function solve(
  lines: readonly AvailabilityLine[],
  barbers: readonly BarberDayAvailability[],
  overrides: {
    notBeforeMs?: number;
    maxOptions?: number;
    withinMs?: readonly Interval[];
  } = {},
): readonly AvailabilityOption[] {
  return availableOptions({
    lines,
    barbers,
    policy: POLICY,
    notBeforeMs: overrides.notBeforeMs ?? 0,
    maxOptions: overrides.maxOptions,
    withinMs: overrides.withinMs,
  });
}

/** An option as `HH:mm barber` strings, for readable assertions. */
function describeOption(option: AvailabilityOption): readonly string[] {
  return option.assignments.map((assignment) => {
    const totalMinutes = assignment.slot.startMs / 60_000;
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${assignment.lineId}@${hh}:${mm}/${assignment.barberId.value}`;
  });
}

describe('candidateStarts', () => {
  it('steps through a gap, stopping where the duration no longer fits', () => {
    // 09:00–10:30 with a 45-minute service on a 15-minute grid: the last
    // start that still fits is 09:45.
    const starts = candidateStarts([iv(9, 10.5)], 45, 15, 0);
    expect(starts.map((ms) => ms / 60_000 / 60)).toEqual([9, 9.25, 9.5, 9.75]);
  });

  it('offers nothing when the gap is shorter than the service', () => {
    expect(candidateStarts([iv(9, 9.5)], 45, 15, 0)).toEqual([]);
  });

  it('keeps the WINDOW’s phase rather than snapping to midnight', () => {
    // A shift starting 09:30 must offer 09:30, not 09:45. A midnight-anchored
    // grid would silently discard the first half-step of every odd shift.
    const starts = candidateStarts([Interval.of(H(9, 30), H(11))], 30, 15, 0);
    expect(starts[0]).toBe(H(9, 30));
  });

  it('respects the lead-time floor, staying on the grid', () => {
    const starts = candidateStarts([iv(9, 12)], 30, 15, H(10, 5));
    expect(starts[0]).toBe(H(10, 15));
  });
});

describe('availableOptions — a single seat', () => {
  it('offers every fitting start', () => {
    const options = solve(
      [line('l1', 60)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
    );
    expect(distinctStarts(options).map((ms) => ms / 60_000 / 60)).toEqual([
      9, 9.25, 9.5, 9.75, 10,
    ]);
  });

  it('works around an existing booking', () => {
    const options = solve(
      [line('l1', 60)],
      [barber(IVAN, { windows: [iv(9, 13)], busy: [iv(10, 11)] })],
    );
    const starts = distinctStarts(options).map((ms) => ms / 60_000 / 60);
    expect(starts).toContain(9);
    expect(starts).toContain(11);
    // Anything from 09:15 to 10:45 would collide with the 10:00–11:00 booking.
    expect(starts).not.toContain(9.5);
    expect(starts).not.toContain(10.5);
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
        option.assignments.every((a) => a.barberId.equals(NIKO)),
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
      hasAnyOption({
        lines: [line('l1', 60, BarberPref.specific(IVAN))],
        barbers: [barber(IVAN, { windows: [iv(9, 10)], busy: [iv(9, 10)] })],
        policy: POLICY,
        notBeforeMs: 0,
      }),
    ).toBe(false);
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
      const starts = new Set(option.assignments.map((a) => a.slot.startMs));
      return starts.size === 1;
    });
    expect(sameStart.length).toBeGreaterThan(0);

    const first = sameStart[0] as AvailabilityOption;
    // The envelope is the LONGER seat, not the sum — they were served at once.
    expect(Interval.durationMinutes(first.envelope)).toBe(45);
    expect(new Set(first.assignments.map((a) => a.barberId.value)).size).toBe(
      2,
    );
  });

  it('does not offer a parallel arrangement when only one barber works', () => {
    const options = solve(
      [line('a', 45), line('b', 30)],
      [barber(IVAN, { windows: [iv(9, 11)] })],
    );
    for (const option of options) {
      const starts = option.assignments.map((a) => a.slot.startMs);
      expect(new Set(starts).size).toBe(2);
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
        Interval.durationMinutes(option.envelope) === 75 &&
        option.assignments.every((a) => a.barberId.equals(IVAN)),
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
    // barber does not reset between family members (ruling R3).
    //
    // The engine has no `turnaroundMinutes` input at all, which is what makes
    // this unrepresentable rather than merely untested.
    const options = solve(
      [line('a', 45), line('b', 30)],
      [
        barber(IVAN, {
          windows: [iv(9, 15)],
          busy: [Interval.pad(iv(12, 13), 15, 15)],
        }),
      ],
      { maxOptions: 200 },
    );

    const abutting = options.find((option) => {
      const sorted = option.assignments
        .slice()
        .sort((x, y) => x.slot.startMs - y.slot.startMs);
      return (
        sorted.length === 2 &&
        (sorted[0] as { slot: Interval }).slot.endMs ===
          (sorted[1] as { slot: Interval }).slot.startMs
      );
    });
    expect(abutting).toBeDefined();

    // …and the padded neighbour is still respected: nothing sits inside it.
    const padded = Interval.pad(iv(12, 13), 15, 15);
    for (const option of options) {
      for (const assignment of option.assignments) {
        expect(Interval.overlaps(assignment.slot, padded)).toBe(false);
      }
    }
  });

  it('chains three seats through one barber', () => {
    const options = solve(
      [line('a', 30), line('b', 30), line('c', 30)],
      [barber(IVAN, { windows: [iv(9, 12)] })],
    );
    const allIvan = options.find((option) =>
      option.assignments.every((a) => a.barberId.equals(IVAN)),
    );
    expect(allIvan).toBeDefined();
    expect(
      Interval.durationMinutes((allIvan as AvailabilityOption).envelope),
    ).toBe(90);
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
          const a = option.assignments[i] as {
            barberId: BarberId;
            slot: Interval;
          };
          const b = option.assignments[j] as {
            barberId: BarberId;
            slot: Interval;
          };
          if (a.barberId.equals(b.barberId)) {
            expect(Interval.overlaps(a.slot, b.slot)).toBe(false);
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
        const owner = barbers.find((candidate) =>
          candidate.barberId.equals(assignment.barberId),
        ) as BarberDayAvailability;
        const free = Interval.subtract(
          owner.windows.map((window) => window.interval),
          owner.busy,
        );
        expect(
          free.some((gap) => Interval.contains(gap, assignment.slot)),
        ).toBe(true);
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
          busy: [Interval.pad(iv(10, 11), 15, 15)],
        }),
      ],
    );
    const starts = distinctStarts(options);
    expect(starts).toContain(H(9)); // 09:00–09:45, right up to the padded block
    expect(starts).not.toContain(H(9, 15)); // would run into it
    expect(starts).toContain(H(11, 15)); // clear of the padding
  });

  it('a service’s OWN cleanup does extend what the barber is blocked for', () => {
    // Unlike turnaround, cleanup is part of this booking's footprint, so it
    // must be reserved at booking time. 60 + 30 = 90 > the 90-minute window's
    // remaining room after the grid start, so only 09:00 fits.
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
    expect(options[0]?.assignments[0]?.slot.startMs).toBe(H(9, 15));
  });

  it('a service’s cleanup DOES separate two seats of one party', () => {
    // A colour still has to be cleaned up before the son sits down, even
    // though the barber does not "reset" between family members.
    //
    // Asserted as an invariant over EVERY option rather than by picking one:
    // the cleanup belongs to line 'a', so which of the two comes first varies,
    // and only 'a' imposes a gap after itself. 'b' followed immediately by
    // 'a' with no gap is perfectly legal — 'b' has no cleanup.
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
      const aOccupied = Interval.of(a.slot.startMs, a.slot.endMs + 20 * 60_000);
      expect(Interval.overlaps(aOccupied, b.slot)).toBe(false);
    }

    // And when 'a' does come first, the 20-minute gap is really there.
    const aFirst = options.find((option) => {
      const a = option.assignments.find((x) => x.lineId === 'a');
      const b = option.assignments.find((x) => x.lineId === 'b');
      return a && b && a.slot.startMs < b.slot.startMs;
    });
    expect(aFirst).toBeDefined();
    const a = (aFirst as AvailabilityOption).assignments.find(
      (x) => x.lineId === 'a',
    );
    const b = (aFirst as AvailabilityOption).assignments.find(
      (x) => x.lineId === 'b',
    );
    expect(
      ((b as { slot: Interval }).slot.startMs -
        (a as { slot: Interval }).slot.endMs) /
        60_000,
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
      const current = options[i] as AvailabilityOption;
      const ordered =
        previous.envelope.startMs < current.envelope.startMs ||
        (previous.envelope.startMs === current.envelope.startMs &&
          previous.envelope.endMs <= current.envelope.endMs);
      expect(ordered).toBe(true);
    }
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
      {
        notBeforeMs: H(10, 30),
      },
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
    const starts = distinctStarts(options);
    expect(starts).toContain(H(9));
    expect(starts).toContain(H(14));
    // 10:00–14:00 is not rostered at all.
    expect(starts).not.toContain(H(11));
  });
});

describe('availableOptions — per-barber terms', () => {
  // The catalog prices a service per barber, so the same fade can be 30
  // minutes with Ivan and 45 with Niko. Collapsing that to one number is
  // wrong whichever number you pick.
  const perBarberLine = (
    lineId: string,
    defaults: number,
    byBarber: Record<string, number>,
  ): AvailabilityLine => ({
    lineId,
    barberPref: BarberPref.any(),
    durationMinutes: defaults,
    padBeforeMinutes: 0,
    padAfterMinutes: 0,
    termsByBarber: new Map(
      Object.entries(byBarber).map(([id, durationMinutes]) => [
        id,
        { durationMinutes, padBeforeMinutes: 0, padAfterMinutes: 0 },
      ]),
    ),
  });

  it('offers a gap only the FASTER barber fits', () => {
    // A single 30-minute gap. Ivan takes 30, Niko takes 45 — so exactly one
    // barber can serve it, and the slot must still be offered. Taking the
    // slowest duration for an `any` preference would have hidden it.
    const options = availableOptions({
      lines: [perBarberLine('l1', 45, { ivan: 30, niko: 45 })],
      barbers: [
        barber(IVAN, { windows: [iv(9, 9.5)] }),
        barber(NIKO, { windows: [iv(9, 9.5)] }),
      ],
      policy: POLICY,
      notBeforeMs: 0,
    });

    expect(options).not.toHaveLength(0);
    for (const option of options) {
      expect(option.assignments[0]?.barberId.value).toBe('ivan');
      expect(Interval.durationMinutes(option.envelope)).toBe(30);
    }
  });

  it('books the SLOWER barber for their own longer duration', () => {
    // Same line, only Niko available, a window wide enough for both. The sold
    // slot has to be Niko's 45 — quoting Ivan's 30 would end the appointment
    // a quarter of an hour before the barber is actually free.
    const options = availableOptions({
      lines: [perBarberLine('l1', 30, { ivan: 30, niko: 45 })],
      barbers: [barber(NIKO, { windows: [iv(9, 11)] })],
      policy: POLICY,
      notBeforeMs: 0,
    });

    expect(options).not.toHaveLength(0);
    for (const option of options) {
      expect(
        Interval.durationMinutes(option.assignments[0]?.slot as Interval),
      ).toBe(45);
    }
  });

  it('falls back to the default terms for a barber with no override', () => {
    const options = availableOptions({
      lines: [perBarberLine('l1', 60, { ivan: 30 })],
      barbers: [barber(NIKO, { windows: [iv(9, 10)] })],
      policy: POLICY,
      notBeforeMs: 0,
    });

    expect(options).toHaveLength(1);
    expect(
      Interval.durationMinutes(options[0]?.assignments[0]?.slot as Interval),
    ).toBe(60);
  });
});

describe('availableStarts — one arrangement per time, and the best one', () => {
  it('keeps the TIGHTEST arrangement for a start, not the first one found', () => {
    // Two seats, one barber, a whole morning free. "09:00 and 10:00" is a
    // valid sequential arrangement and a bad offer when "09:00 and 09:30"
    // exists — a party should not be told to wait around for an hour.
    const options = availableStarts({
      lines: [line('l1', 30), line('l2', 30)],
      barbers: [barber(IVAN, { windows: [iv(9, 13)] })],
      policy: POLICY,
      notBeforeMs: 0,
    });

    const first = options.find((option) => option.envelope.startMs === H(9));
    expect(first).toBeDefined();
    expect(Interval.durationMinutes(first?.envelope as Interval)).toBe(60);
  });

  it('returns exactly one option per distinct start', () => {
    const options = availableStarts({
      lines: [line('l1', 30), line('l2', 30)],
      barbers: [
        barber(IVAN, { windows: [iv(9, 18)] }),
        barber(NIKO, { windows: [iv(9, 18)] }),
      ],
      policy: POLICY,
      notBeforeMs: 0,
    });

    const starts = new Set(options.map((option) => option.envelope.startMs));
    expect(starts.size).toBe(options.length);
  });

  it('reaches the END of a long day — the whole reason it exists', () => {
    // The exhaustive walk is capped; with a party of two and two barbers the
    // cap is spent before noon, so a post-filter would show a morning-only
    // shop. Deduplicating during the search spends the budget on breadth.
    const options = availableStarts({
      lines: [line('l1', 30), line('l2', 30)],
      barbers: [
        barber(IVAN, { windows: [iv(9, 20)] }),
        barber(NIKO, { windows: [iv(9, 20)] }),
      ],
      policy: POLICY,
      notBeforeMs: 0,
    });

    const lastStart = Math.max(
      ...options.map((option) => option.envelope.startMs),
    );
    expect(lastStart).toBeGreaterThanOrEqual(H(19));
  });

  it('is deterministic — two identical queries agree exactly', () => {
    const query = {
      lines: [line('l1', 45), line('l2', 30, BarberPref.specific(NIKO))],
      barbers: [
        barber(IVAN, { windows: [iv(9, 14)] }),
        barber(NIKO, { windows: [iv(9, 14)] }),
      ],
      policy: POLICY,
      notBeforeMs: 0,
    };
    expect(JSON.stringify(availableStarts(query))).toBe(
      JSON.stringify(availableStarts(query)),
    );
  });
});

// ── The declared-window mask ─────────────────────────────────────────────
// How "I'm free on the 26th, but only 08:00–12:00 and 15:00–16:30" reaches
// the search. Applied to FREE TIME rather than to the returned options, for
// two reasons the tests below pin: the enumeration is capped, and a mask has
// to constrain a party's later seats too.
describe('availableOptions — withinMs', () => {
  it('offers only starts inside the declared window', () => {
    const options = solve([line('a', 60)], [barber(IVAN)], {
      withinMs: [iv(9, 11)],
    });
    const starts = options.map((option) => option.envelope.startMs / H(1));
    expect(Math.min(...starts)).toBe(9);
    // A 60-minute service inside 09:00–11:00 last starts at 10:00.
    expect(Math.max(...starts)).toBe(10);
  });

  it('honours several disjoint windows in one day', () => {
    const options = solve([line('a', 60)], [barber(IVAN)], {
      withinMs: [iv(8, 10), iv(15, 16.5)],
    });
    const hours = options.map((option) => option.envelope.startMs / H(1));
    // The shift is 09:00–18:00, so the morning window contributes only its
    // overlap with the roster (09:00, the one hour that fits before 10:00),
    // and the afternoon window runs to the last 60-minute start that still
    // ends by 16:30.
    expect(hours).toEqual([9, 15, 15.25, 15.5]);
  });

  it('treats an undefined mask as unconstrained, NOT as empty', () => {
    // The distinction `DayWindows.toIntervals` exists to preserve: an
    // unnarrowed day must search the whole day, not nothing.
    expect(solve([line('a', 60)], [barber(IVAN)]).length).toBeGreaterThan(0);
  });

  it('treats an EMPTY mask as nothing qualifying', () => {
    expect(solve([line('a', 60)], [barber(IVAN)], { withinMs: [] })).toEqual(
      [],
    );
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
      { withinMs: [iv(9, 11)] },
    );
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      for (const assignment of option.assignments) {
        expect(assignment.slot.startMs).toBeGreaterThanOrEqual(H(9));
        expect(assignment.slot.endMs).toBeLessThanOrEqual(H(11));
      }
    }
    // Two interchangeable seats can be ordered either way and both are
    // legitimate; which the walk reaches first is an implementation detail
    // this test has no business pinning. What it does pin: the window admits
    // exactly the one back-to-back placement, in some order.
    const placements = options.map((option) =>
      option.assignments
        .map((assignment) => assignment.slot.startMs / H(1))
        .sort((a, b) => a - b),
    );
    expect(placements).toEqual(placements.map(() => [9, 10]));
  });

  it('still subtracts busy inside the window', () => {
    const options = solve(
      [line('a', 60)],
      [barber(IVAN, { busy: [iv(9, 10)] })],
      { withinMs: [iv(9, 11)] },
    );
    expect(options.map((option) => option.envelope.startMs / H(1))).toEqual([
      10,
    ]);
  });
});
