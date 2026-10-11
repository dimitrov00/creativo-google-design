import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  LocationStatus,
  ServiceStatus,
} from './catalog-status.data';

// The tags are pinned: the legacy shims map them to the stored lowercase
// strings composite indexes #1–#5 filter by, so a renamed value would empty
// every public catalogue query read through them.
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
