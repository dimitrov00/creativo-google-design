import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StandingSeatPair } from './standing-seat.data';

const MIN = 60_000;
const at = (personKey: string, start: number, minutes: number) =>
  StandingSeatPair.of(personKey, start * MIN, (start + minutes) * MIN);

describe('StandingSeatPair — one person, one chair at a time', () => {
  it('refuses the same person in an overlapping span', () => {
    expect(
      StandingSeatPair.sitsTwice(at('self', 600, 30), at('self', 615, 30)),
    ).toBe(true);
  });

  it('allows the same person back to back — half-open, like every span', () => {
    expect(
      StandingSeatPair.sitsTwice(at('self', 600, 30), at('self', 630, 30)),
    ).toBe(false);
  });

  it('allows two different people at the same minutes', () => {
    expect(
      StandingSeatPair.sitsTwice(
        at('self', 600, 30),
        at('guest:Мария', 600, 30),
      ),
    ).toBe(false);
  });

  it('is exactly "same key AND overlapping", in any order (property)', () => {
    const spans = fc.record({
      personKey: fc.constantFrom('self', 'guest:a', 'account:u1'),
      start: fc.integer({ min: 0, max: 100 }),
      minutes: fc.integer({ min: 1, max: 60 }),
    });
    fc.assert(
      fc.property(spans, spans, (x, y) => {
        const a = at(x.personKey, x.start, x.minutes);
        const b = at(y.personKey, y.start, y.minutes);
        const expected =
          a.personKey === b.personKey &&
          a.startMs < b.endMs &&
          b.startMs < a.endMs;
        return (
          StandingSeatPair.sitsTwice(a, b) === expected &&
          StandingSeatPair.sitsTwice(b, a) === expected
        );
      }),
    );
  });

  it('sorts by start, then end, then person — the scan order', () => {
    const sorted = [
      at('b', 600, 30),
      at('a', 600, 30),
      at('a', 540, 30),
      at('a', 600, 15),
    ].sort(StandingSeatPair.compare);
    expect(sorted).toEqual([
      at('a', 540, 30),
      at('a', 600, 15),
      at('a', 600, 30),
      at('b', 600, 30),
    ]);
    expect(StandingSeatPair.compare(at('a', 1, 1), at('a', 1, 1))).toBe(0);
  });
});
