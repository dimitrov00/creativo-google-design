import { describe, expect, it } from 'vitest';
import { deepFreeze, loyaltyAccountFixtures } from '@core/testing';
import { PunchCard } from './punch-card.data';

/*
 * The stamp card's counts, ported from the wallet's WC3
 * (`wallet.presenter.ts` `stampCards`; its spec «agrees a stamp card’s words
 * with its size, and never counts past it» and the holdings cases) — the
 * words stay with the presenter's spec, the numbers are asserted here.
 */

const GEORGI = loyaltyAccountFixtures.georgi.account;

function georgiCard(): PunchCard {
  const card = GEORGI.punchCards[0];
  if (card === undefined) throw new Error('Георги holds a stamp card');
  return card;
}

describe('PunchCard.progress', () => {
  it('counts Георги’s 4 of 10: 6 left, 6 to the next', () => {
    expect(PunchCard.progress(georgiCard())).toEqual({
      filled: 4,
      left: 6,
      toNext: 6,
    });
  });

  it('a full card has none left and still names the one stamp that pays', () => {
    expect(PunchCard.progress({ ...georgiCard(), filled: 10 })).toEqual({
      filled: 10,
      left: 0,
      toNext: 1,
    });
  });

  it('never counts past the card’s size (12 of 10 reads 10 of 10)', () => {
    expect(
      PunchCard.progress({ ...georgiCard(), filled: 12, size: 10 }),
    ).toEqual({ filled: 10, left: 0, toNext: 1 });
  });

  it('an empty card has every stamp left; a count below nought reads nought', () => {
    expect(PunchCard.progress({ ...georgiCard(), filled: 0 })).toEqual({
      filled: 0,
      left: 10,
      toNext: 10,
    });
    expect(PunchCard.progress({ ...georgiCard(), filled: -3 })).toEqual({
      filled: 0,
      left: 10,
      toNext: 10,
    });
  });

  it('one stamp short says one, as a full card does', () => {
    expect(PunchCard.progress({ ...georgiCard(), filled: 9 })).toEqual({
      filled: 9,
      left: 1,
      toNext: 1,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const card = deepFreeze({ ...georgiCard(), filled: 12 });
    const once = PunchCard.progress(card);
    const twice = PunchCard.progress(card);
    expect(twice).toEqual(once);
    expect(card.filled).toBe(12);
  });
});
