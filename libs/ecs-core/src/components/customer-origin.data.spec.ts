import { describe, expect, it } from 'vitest';
import { CustomerOrigin } from './customer-origin.data';

/*
 * D29 (flatten-spec §5.2, §5.3): the four ways a client record comes to
 * exist — the field `customerOrigin` of `customers/{customerId}`.
 */
describe('CustomerOrigin', () => {
  it('names the four creators of §5.3, SCREAMING, each once', () => {
    const origins = Object.values(CustomerOrigin);
    expect(origins).toEqual([
      'REGISTRATION',
      'STAFF_WALK_IN',
      'FIRST_BOOKING',
      'SEED',
    ]);
    expect(new Set(origins).size).toBe(origins.length);
    expect(CustomerOrigin.StaffWalkIn).toBe('STAFF_WALK_IN');
  });
});
