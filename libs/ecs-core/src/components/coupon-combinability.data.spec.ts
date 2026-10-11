import { describe, expect, it } from 'vitest';
import { Combinability } from './coupon-combinability.data';

// The cases of `coupon-combinability.spec.ts`.

const exclusive = Combinability.Exclusive;
const stackable = Combinability.Stackable;

describe('Combinability', () => {
  it('keeps one SCREAMING tag per rule', () => {
    expect([Combinability.Exclusive, Combinability.Stackable]).toEqual([
      'EXCLUSIVE',
      'STACKABLE',
    ]);
    expect(Combinability.isExclusive(exclusive)).toBe(true);
    expect(Combinability.isExclusive(stackable)).toBe(false);
  });

  it('lets anything join an empty selection', () => {
    expect(Combinability.canAdd([], exclusive)).toBe(true);
    expect(Combinability.canAdd([], stackable)).toBe(true);
  });

  it('keeps an exclusive candidate out of a non-empty selection', () => {
    expect(Combinability.canAdd([stackable], exclusive)).toBe(false);
  });

  it('keeps a stackable candidate out of a selection holding an exclusive', () => {
    expect(Combinability.canAdd([exclusive], stackable)).toBe(false);
  });

  it('lets stackables combine freely', () => {
    expect(Combinability.canAdd([stackable, stackable], stackable)).toBe(true);
  });

  it('rejects an exclusive coupled with anything else', () => {
    expect(Combinability.isLegalSelection([exclusive, stackable])).toBe(false);
    expect(Combinability.isLegalSelection([stackable, exclusive])).toBe(false);
  });

  it('accepts a lone exclusive, any number of stackables, or nothing', () => {
    expect(Combinability.isLegalSelection([exclusive])).toBe(true);
    expect(Combinability.isLegalSelection([stackable, stackable])).toBe(true);
    expect(Combinability.isLegalSelection([])).toBe(true);
  });
});
