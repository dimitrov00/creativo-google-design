import { describe, expect, it } from 'vitest';
import { MoveRider } from './move-rider.data';

/*
 * The restore guard of a carried seat — the booking store's `isRider` /
 * `moveRiderOf` cases («never restores a move with a malformed rider …»),
 * lifted onto the component (Phase 4a 4A-9).
 */
const RIDER = {
  serviceId: 'svc-fade',
  variantId: null,
  barberId: 'petar',
  offsetMinutes: 0,
  durationMinutes: 45,
  setupMinutes: 0,
  cleanupMinutes: 0,
};

describe('MoveRider.is — a carried seat the grid can measure', () => {
  it('takes a rider whose every identity parses and every figure is whole', () => {
    expect(MoveRider.is(RIDER)).toBe(true);
    expect(
      MoveRider.is({ ...RIDER, variantId: 'v-long', offsetMinutes: -30 }),
    ).toBe(true);
  });

  it('turns away a rider written before riders carried their terms', () => {
    expect(
      MoveRider.is({
        serviceId: 'svc-beard',
        variantId: null,
        barberId: 'petar',
        offsetMinutes: 0,
      }),
    ).toBe(false);
  });

  it.each([
    ['an empty barber', { barberId: '' }],
    ['an empty service', { serviceId: '' }],
    ['a malformed variant', { variantId: '' }],
    ['a fractional offset', { offsetMinutes: 1.5 }],
    ['a zero duration', { durationMinutes: 0 }],
    ['a negative setup', { setupMinutes: -1 }],
    ['a textual cleanup', { cleanupMinutes: '5' }],
  ])(
    'turns away a rider with %s — the grid would drop him from its checks',
    (_what, broken) => {
      expect(MoveRider.is({ ...RIDER, ...broken })).toBe(false);
    },
  );

  it('turns away what is no object', () => {
    expect(MoveRider.is(null)).toBe(false);
    expect(MoveRider.is('petar')).toBe(false);
  });
});
