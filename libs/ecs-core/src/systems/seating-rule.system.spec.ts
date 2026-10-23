import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SeatIdPair, StandingSeatPair } from '@core/components';
import { SeatId, SeatKeyText } from '@core/primitives';
import { deepFreeze, endMinute, minute } from '@core/testing';
import { type SeatedSpan, SeatingRuleSystem } from './seating-rule.system';

/*
 * The cases of the legacy scheduling `person-slot.spec.ts` (18; deleted in
 * Phase 4b, ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED
 * over plain structs while the class spec still ran against the shim.
 * `StandingDoubleSeatings` instances become the normalized `readonly
 * SeatIdPair[]` the system folds; the `[a, b]` tuple becomes the stored `{
 * seatId, otherSeatId }` struct.
 */

/**
 * The rule is translation-invariant, so every case reads its minutes as an
 * offset from 09:00 on the shop's wall clock — a quarter-hour drag earlier
 * than the first seat stays inside the day.
 */
const BASE = 540;
const at = (personKey: string, from: number, to: number): StandingSeatPair =>
  StandingSeatPair.of(
    SeatKeyText.of(personKey),
    minute(BASE + from),
    endMinute(BASE + to),
  );
const seatAt = (
  seatId: string,
  personKey: string,
  from: number,
  to: number,
): SeatedSpan => ({ seatId: SeatId.of(seatId), ...at(personKey, from, to) });
const pair = (a: string, b: string): SeatIdPair => ({
  seatId: SeatId.of(a),
  otherSeatId: SeatId.of(b),
});
const id = SeatId.of;

const S = SeatingRuleSystem;

describe('sitsTwiceAt — one person, one chair at a time', () => {
  it('refuses the same person in an overlapping slot', () => {
    expect(S.sitsTwiceAt([at('self', 0, 45)], at('self', 30, 60))).toBe(true);
  });

  it('allows the same person back to back — half-open, like every slot', () => {
    expect(S.sitsTwiceAt([at('self', 0, 45)], at('self', 45, 75))).toBe(false);
  });

  it('allows two different people at the same minutes', () => {
    expect(S.sitsTwiceAt([at('self', 0, 45)], at('guest-0', 0, 45))).toBe(
      false,
    );
  });

  it('is exactly "same key AND overlapping", in any order (property)', () => {
    const slot = fc
      .tuple(fc.integer({ min: 0, max: 600 }), fc.integer({ min: 1, max: 120 }))
      .map(([from, length]) => [from, from + length] as const);
    const key = fc.constantFrom('self', 'guest-0', 'guest-1');
    fc.assert(
      fc.property(
        fc.array(fc.tuple(key, slot), { maxLength: 5 }),
        key,
        slot,
        (seated, candidateKey, [from, to]) => {
          const taken = seated.map(([k, [f, t]]) => at(k, f, t));
          const candidate = at(candidateKey, from, to);
          const expected = taken.some(
            (entry) =>
              entry.personKey === candidateKey &&
              entry.startMinutes < candidate.endMinutes &&
              candidate.startMinutes < entry.endMinutes,
          );
          expect(S.sitsTwiceAt(taken, candidate)).toBe(expected);
          expect(S.sitsTwiceAt([...taken].reverse(), candidate)).toBe(expected);
        },
      ),
    );
  });
});

/*
 * ── ONLY A NEW OVERLAP IS REFUSED (owner decision, round 5) ───────────────
 * A pair of seats that already seated one person twice keeps standing
 * through any edit, by seat IDENTITY; everything else answers to the rule.
 */
describe('standing double seatings — a visit is never made worse, and never frozen', () => {
  /** Two walk-ins under the old shared label, side by side: one person. */
  const legacy = [
    seatAt('seat-1', 'guest:Случаен клиент', 600, 630),
    seatAt('seat-2', 'guest:Случаен клиент', 600, 620),
  ];
  const standing = S.standingOf(legacy);

  it('finds the pair the visit already held, in either order', () => {
    expect(S.stands(standing, id('seat-1'), id('seat-2'))).toBe(true);
    expect(S.stands(standing, id('seat-2'), id('seat-1'))).toBe(true);
    expect(S.stands(standing, id('seat-1'), id('seat-3'))).toBe(false);
  });

  it('lets the pair travel together — a whole-visit drag is no worse', () => {
    const [cut, beard] = [
      seatAt('seat-1', 'guest:Случаен клиент', 660, 690),
      seatAt('seat-2', 'guest:Случаен клиент', 660, 680),
    ];
    expect(S.seatsTwiceAnew(standing, [cut], beard)).toBe(false);
    expect(S.seatsTwiceAnew(standing, [beard], cut)).toBe(false);
  });

  it('lets one seat of the pair stretch or move and still overlap', () => {
    const stretched = seatAt('seat-2', 'guest:Случаен клиент', 610, 650);
    expect(
      S.seatsTwiceAnew(standing, [legacy[0] as SeatedSpan], stretched),
    ).toBe(false);
  });

  it('refuses a seat the edit adds beside the pair', () => {
    const added = seatAt('seat-9', 'guest:Случаен клиент', 615, 640);
    expect(S.seatsTwiceAnew(standing, legacy, added)).toBe(true);
  });

  it('refuses a pair that did not overlap before and does now', () => {
    const apart = S.standingOf([
      seatAt('seat-1', 'guest:Мария', 600, 630),
      seatAt('seat-2', 'guest:Мария', 630, 650),
    ]);
    expect(
      S.seatsTwiceAnew(
        apart,
        [seatAt('seat-1', 'guest:Мария', 600, 630)],
        seatAt('seat-2', 'guest:Мария', 620, 640),
      ),
    ).toBe(true);
  });

  it('earns nothing towards a third seat of the same person', () => {
    const three = S.standingOf([
      ...legacy,
      seatAt('seat-3', 'guest:Случаен клиент', 700, 720),
    ]);
    // Seat 3 moves onto the pair: 1+2 stood, 3+1 and 3+2 did not.
    expect(
      S.seatsTwiceAnew(
        three,
        legacy,
        seatAt('seat-3', 'guest:Случаен клиент', 610, 630),
      ),
    ).toBe(true);
  });

  it('stands nothing for a new booking', () => {
    expect(
      S.seatsTwiceAnew(
        S.none(),
        [legacy[0] as SeatedSpan],
        legacy[1] as SeatedSpan,
      ),
    ).toBe(true);
  });

  /** A visit of up to five seats, among two people, on a quarter grid. */
  const visitArb = fc.array(
    fc.record({
      person: fc.constantFrom('guest:A', 'guest:B'),
      quarter: fc.integer({ min: 0, max: 12 }),
      quarters: fc.integer({ min: 1, max: 4 }),
    }),
    { minLength: 1, maxLength: 5 },
  );
  const toSeats = (
    drafts: readonly { person: string; quarter: number; quarters: number }[],
    shiftOf: (index: number) => number,
    stretchOf: (index: number) => number,
  ): SeatedSpan[] =>
    drafts.map((draft, index) => {
      const from = (draft.quarter + shiftOf(index)) * 15;
      return seatAt(
        `seat-${index}`,
        draft.person,
        from,
        from + (draft.quarters + stretchOf(index)) * 15,
      );
    });
  /** Seat the edited visit in order; `true` if any seat is refused. */
  const refuses = (
    rule: readonly SeatIdPair[],
    after: readonly SeatedSpan[],
  ): boolean =>
    after.some((seat, index) =>
      S.seatsTwiceAnew(rule, after.slice(0, index), seat),
    );

  it('never refuses an edit whose every overlap already stood (property)', () => {
    fc.assert(
      fc.property(
        visitArb,
        fc.integer({ min: -8, max: 8 }),
        (drafts, delta) => {
          // The whole visit, dragged: every pair keeps its relation exactly,
          // so every overlap after it is one the visit already held.
          const before = toSeats(
            drafts,
            () => 0,
            () => 0,
          );
          const after = toSeats(
            drafts,
            () => delta,
            () => 0,
          );
          expect(refuses(S.standingOf(before), after)).toBe(false);
        },
      ),
    );
  });

  it('refuses exactly the edits that seat somebody twice anew (property)', () => {
    fc.assert(
      fc.property(
        visitArb,
        fc.array(fc.integer({ min: -4, max: 4 }), {
          minLength: 5,
          maxLength: 5,
        }),
        fc.array(fc.integer({ min: 0, max: 2 }), {
          minLength: 5,
          maxLength: 5,
        }),
        (drafts, shifts, stretches) => {
          const before = toSeats(
            drafts,
            () => 0,
            () => 0,
          );
          const after = toSeats(
            drafts,
            (index) => shifts.at(index) ?? 0,
            (index) => stretches.at(index) ?? 0,
          );
          const overlaps = (a?: SeatedSpan, b?: SeatedSpan) =>
            a !== undefined &&
            b !== undefined &&
            a.personKey === b.personKey &&
            a.startMinutes < b.endMinutes &&
            b.startMinutes < a.endMinutes;
          const anew = after.some((a, i) =>
            after.some(
              (b, j) =>
                j > i &&
                overlaps(a, b) &&
                !overlaps(before.at(i), before.at(j)),
            ),
          );
          expect(refuses(S.standingOf(before), after)).toBe(anew);
        },
      ),
    );
  });
});

/*
 * ── THE PAIRS A SAVE BROKE, REMEMBERED FOR ITS UNDO (round 6) ─────────────
 * «Отмени» restores exactly what the save changed. A save that removed one
 * seat of a pair, or moved the two apart, left a visit that no longer holds
 * the pair — so the undo putting it back would be judged NEW and refused.
 * The pairs the save broke are remembered, by id, and stand for the undo.
 */
describe('standing double seatings — the pairs an edit broke', () => {
  const WALK_IN = 'guest:Случаен клиент';
  const legacy = [
    seatAt('seat-1', WALK_IN, 600, 645),
    seatAt('seat-2', WALK_IN, 600, 645),
  ];

  it('knows a pair named by id, in either order, and drops a seat paired with itself', () => {
    const remembered = S.ofPairs([
      pair('seat-2', 'seat-1'),
      pair('seat-3', 'seat-3'),
    ]);
    expect(S.stands(remembered, id('seat-1'), id('seat-2'))).toBe(true);
    expect(S.stands(remembered, id('seat-2'), id('seat-1'))).toBe(true);
    expect(S.stands(remembered, id('seat-3'), id('seat-3'))).toBe(false);
    expect(remembered).toEqual([pair('seat-1', 'seat-2')]);
  });

  it('names a pair broken when a seat of it is removed, or the two are moved apart', () => {
    const before = S.standingOf(legacy);
    const removed = S.standingOf([legacy[0] as SeatedSpan]);
    const apart = S.standingOf([
      legacy[0] as SeatedSpan,
      seatAt('seat-2', WALK_IN, 645, 690),
    ]);
    const dragged = S.standingOf([
      seatAt('seat-1', WALK_IN, 660, 705),
      seatAt('seat-2', WALK_IN, 660, 705),
    ]);

    expect(S.brokenBy(before, removed)).toEqual([pair('seat-1', 'seat-2')]);
    expect(S.brokenBy(before, apart)).toEqual([pair('seat-1', 'seat-2')]);
    // A drag that keeps them together broke nothing.
    expect(S.brokenBy(before, dragged)).toEqual([]);
  });

  it('lets the remembered pair stand for the undo, beside what the visit holds', () => {
    const after = S.standingOf([legacy[0] as SeatedSpan]);
    const broken = S.brokenBy(S.standingOf(legacy), after);
    const [cut, readded] = legacy as [SeatedSpan, SeatedSpan];

    // Without the memory the re-added seat is new, and refused…
    expect(S.seatsTwiceAnew(after, [cut], readded)).toBe(true);
    // …with it, it is the seat the save removed, and stands.
    expect(S.seatsTwiceAnew(S.union(after, broken), [cut], readded)).toBe(
      false,
    );
    // The memory earns nothing for a seat it does not name.
    expect(
      S.seatsTwiceAnew(
        S.union(after, broken),
        [cut],
        seatAt('seat-9', WALK_IN, 600, 645),
      ),
    ).toBe(true);
  });

  /** A visit of up to five seats, among two people, on a quarter grid. */
  const visitArb = fc
    .array(
      fc.record({
        person: fc.constantFrom('guest:A', 'guest:B'),
        quarter: fc.integer({ min: 0, max: 12 }),
        quarters: fc.integer({ min: 1, max: 4 }),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((drafts) =>
      drafts.map((draft, index) =>
        seatAt(
          `seat-${index}`,
          draft.person,
          draft.quarter * 15,
          (draft.quarter + draft.quarters) * 15,
        ),
      ),
    );

  it('survives its own persisted shape (property)', () => {
    fc.assert(
      fc.property(visitArb, (visit) => {
        const standing = S.standingOf(visit);
        const read = S.ofPairs(standing);
        for (const a of visit) {
          for (const b of visit) {
            expect(S.stands(read, a.seatId, b.seatId)).toBe(
              S.stands(standing, a.seatId, b.seatId),
            );
          }
        }
      }),
    );
  });

  it('never refuses the undo that seats the visit exactly as it was before the save (property)', () => {
    fc.assert(
      fc.property(
        visitArb,
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        fc.array(fc.integer({ min: -4, max: 4 }), {
          minLength: 5,
          maxLength: 5,
        }),
        (before, kept, shifts) => {
          // The save: some seats removed (never all), the rest moved.
          const after = before
            .map((seat, index) =>
              kept.at(index) === false && index > 0
                ? null
                : seatAt(
                    seat.seatId,
                    seat.personKey,
                    seat.startMinutes - BASE + (shifts.at(index) ?? 0) * 15,
                    seat.endMinutes - BASE + (shifts.at(index) ?? 0) * 15,
                  ),
            )
            .filter((seat): seat is SeatedSpan => seat !== null);
          const held = S.standingOf(after);
          const remembered = S.brokenBy(S.standingOf(before), held);
          const rule = S.union(held, remembered);

          // The undo seats `before` again, seat by seat: nothing it puts
          // back is new.
          expect(
            before.some((seat, index) =>
              S.seatsTwiceAnew(rule, before.slice(0, index), seat),
            ),
          ).toBe(false);
        },
      ),
    );
  });
});

describe('SeatingRuleSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const visit = deepFreeze([
      seatAt('seat-2', 'guest:A', 600, 645),
      seatAt('seat-1', 'guest:A', 610, 650),
      seatAt('seat-3', 'guest:B', 600, 645),
    ]);
    const remembered = deepFreeze([pair('seat-3', 'seat-1')]);
    const run = () => {
      const standing = S.standingOf(visit);
      return {
        standing,
        union: S.union(standing, remembered),
        broken: S.brokenBy(standing, remembered),
        anew: S.seatsTwiceAnew(
          remembered,
          visit.slice(0, 2),
          visit[2] as SeatedSpan,
        ),
        twice: S.sitsTwiceAt(visit, visit[0] as SeatedSpan),
      };
    };
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(once.standing).toEqual([pair('seat-1', 'seat-2')]);
    expect(visit.map((seat) => seat.seatId)).toEqual([
      'seat-2',
      'seat-1',
      'seat-3',
    ]);
    expect(remembered).toEqual([pair('seat-3', 'seat-1')]);
  });
});
