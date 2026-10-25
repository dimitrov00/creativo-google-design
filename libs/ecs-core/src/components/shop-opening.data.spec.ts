import { describe, expect, it } from 'vitest';
import { ShopOpening } from './shop-opening.data';

describe('ShopOpening', () => {
  it('pins the opening-line tags', () => {
    expect(ShopOpening).toEqual({
      ClosesAt: 'CLOSES_AT',
      ClosesSoon: 'CLOSES_SOON',
      OpensAt: 'OPENS_AT',
      OpensOn: 'OPENS_ON',
    });
    // The type is exactly the dictionary's literals.
    const tags: readonly ShopOpening[] = [
      'CLOSES_AT',
      'CLOSES_SOON',
      'OPENS_AT',
      'OPENS_ON',
    ];
    expect(Object.values(ShopOpening)).toEqual(tags);
    // @ts-expect-error — not a shop-opening tag
    const stray: ShopOpening = 'OPEN';
    expect(stray).toBe('OPEN');
  });
});
