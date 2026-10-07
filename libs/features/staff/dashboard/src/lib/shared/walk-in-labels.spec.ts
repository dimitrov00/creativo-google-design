import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { walkInLabels } from './walk-in-labels';

const word = (number: number | null): string =>
  number === null ? 'Случаен клиент' : `Случаен клиент ${number}`;

describe('walkInLabels — no two strangers on one visit share a name', () => {
  it('keeps the plain word for the first and numbers the rest', () => {
    expect([
      ...walkInLabels(['primary', 'guest-b', 'guest-c'], [], word),
    ]).toEqual([
      ['primary', 'Случаен клиент'],
      ['guest-b', 'Случаен клиент 2'],
      ['guest-c', 'Случаен клиент 3'],
    ]);
  });

  it('names one person once, however many services they have', () => {
    expect([
      ...walkInLabels(['primary', 'primary', 'guest-b', 'primary'], [], word),
    ]).toEqual([
      ['primary', 'Случаен клиент'],
      ['guest-b', 'Случаен клиент 2'],
    ]);
  });

  it('skips every label the visit already holds', () => {
    // The chair's own stranger is already «Случаен клиент», and somebody
    // was named «Случаен клиент 2» by hand: the newcomer is the third.
    expect(
      walkInLabels(
        ['guest-new'],
        ['Мартин', 'Случаен клиент', 'Случаен клиент 2'],
        word,
      ).get('guest-new'),
    ).toBe('Случаен клиент 3');
  });

  it('never gives two people one label, nor a label already taken', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
          maxLength: 12,
        }),
        fc.array(
          fc.oneof(
            fc.constant('Случаен клиент'),
            fc.integer({ min: 2, max: 15 }).map((n) => word(n)),
            fc.string({ maxLength: 8 }),
          ),
          { maxLength: 10 },
        ),
        (people, taken) => {
          const labels = [...walkInLabels(people, taken, word).values()];
          expect(labels).toHaveLength(people.length);
          expect(new Set(labels).size).toBe(labels.length);
          for (const label of labels) expect(taken).not.toContain(label);
        },
      ),
    );
  });

  it('ends even when the catalogue words every number alike', () => {
    const flat = (number: number | null) =>
      number === null ? 'walk-in' : 'walk-in #';
    const labels = walkInLabels(['a', 'b', 'c'], ['walk-in'], flat);
    expect(labels.size).toBe(3);
  });
});
