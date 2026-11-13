import { describe, expect, it } from 'vitest';
import { BarberStatus } from './barber-status.data';

// Pinned: the stored strings the public catalogue query and the `barbers`
// read rule (`barberStatus != 'DRAFT'`) filter by.
describe('BarberStatus', () => {
  it('pins the barber status tags', () => {
    expect(BarberStatus).toEqual({
      Draft: 'DRAFT',
      StaffOnly: 'STAFF_ONLY',
      Public: 'PUBLIC',
      Departed: 'DEPARTED',
    });
  });
});
