import { describe, expect, it } from 'vitest';
import { BarberStatus } from './barber-status.data';

// Pinned: the stored strings the catalogue's composite indexes filter by.
describe('BarberStatus', () => {
  it('pins the barber status tags', () => {
    expect(BarberStatus).toEqual({ Active: 'ACTIVE', Inactive: 'INACTIVE' });
  });
});
