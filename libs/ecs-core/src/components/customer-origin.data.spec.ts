import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ORIGINS,
  CustomerOrigin,
  isCustomerOrigin,
} from './customer-origin.data';

/*
 * D29 (flatten-spec §5.2, §5.3): the four ways a client record comes to
 * exist — the field `customerOrigin` of `customers/{customerId}`.
 */
describe('CustomerOrigin', () => {
  it('names the four creators of §5.3, SCREAMING, each once', () => {
    expect([...CUSTOMER_ORIGINS]).toEqual([
      'REGISTRATION',
      'STAFF_WALK_IN',
      'FIRST_BOOKING',
      'SEED',
    ]);
    expect(new Set(CUSTOMER_ORIGINS).size).toBe(CUSTOMER_ORIGINS.length);
    expect(CustomerOrigin.StaffWalkIn).toBe('STAFF_WALK_IN');
  });

  it('isCustomerOrigin narrows a known origin and rejects strangers', () => {
    expect(isCustomerOrigin(CustomerOrigin.FirstBooking)).toBe(true);
    expect(isCustomerOrigin('SEED')).toBe(true);
    // Not an actor id: `createdBy`-style values are strangers.
    expect(isCustomerOrigin('first_booking')).toBe(false);
    expect(isCustomerOrigin('u-client')).toBe(false);
    expect(isCustomerOrigin(null)).toBe(false);
  });
});
