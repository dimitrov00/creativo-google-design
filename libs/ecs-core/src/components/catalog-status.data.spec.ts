import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  LocationStatus,
  ServiceStatus,
} from './catalog-status.data';

// The tags are pinned: they are the stored strings composite indexes #1–#5
// filter by (the legacy shims mapped them to lowercase until the booking-core
// flip), so a renamed value would empty every public catalogue query read
// through them.
describe('catalog status dictionaries', () => {
  it('pins the service status tags', () => {
    expect(ServiceStatus).toEqual({ Active: 'ACTIVE', Archived: 'ARCHIVED' });
  });

  it('pins the barber status tags', () => {
    expect(BarberStatus).toEqual({ Active: 'ACTIVE', Inactive: 'INACTIVE' });
  });

  it('pins the location status tags', () => {
    expect(LocationStatus).toEqual({ Active: 'ACTIVE', Hidden: 'HIDDEN' });
  });
});
