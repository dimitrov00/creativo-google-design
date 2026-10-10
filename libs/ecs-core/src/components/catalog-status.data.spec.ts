import { describe, expect, it } from 'vitest';
import {
  BarberState,
  LocationState,
  ServiceState,
} from './catalog-status.data';

// The values are stored and filtered by composite indexes #1–#5 — a renamed
// string would empty every public catalogue query, so they are pinned.
describe('catalog status dictionaries', () => {
  it('keeps the stored service status strings', () => {
    expect(ServiceState).toEqual({ Active: 'active', Archived: 'archived' });
  });

  it('keeps the stored barber status strings', () => {
    expect(BarberState).toEqual({ Active: 'active', Inactive: 'inactive' });
  });

  it('keeps the stored location status strings', () => {
    expect(LocationState).toEqual({ Active: 'active', Hidden: 'hidden' });
  });
});
