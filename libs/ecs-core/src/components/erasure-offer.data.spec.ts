import { describe, expect, it } from 'vitest';
import { Tag } from '@core/primitives';
import { ErasureOffer } from './erasure-offer.data';

describe('ErasureOffer', () => {
  it('holds the three offers, SCREAMING_SNAKE, each value once', () => {
    const values = [...Tag.values(ErasureOffer)];
    expect(values).toEqual(['ERASE', 'RESUME', 'RESWEEP']);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    expect(ErasureOffer.Resweep).toBe('RESWEEP');
  });

  it('is told apart from strangers through the dictionary', () => {
    expect(Tag.has(ErasureOffer, 'RESUME')).toBe(true);
    expect(Tag.has(ErasureOffer, 'ERASED')).toBe(false);
    expect(Tag.has(ErasureOffer, 'erase')).toBe(false);
  });
});
