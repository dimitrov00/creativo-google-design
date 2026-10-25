import { describe, expect, it } from 'vitest';
import { LocationStatus } from './location-status.data';

// Pinned: the stored strings the catalogue's composite indexes filter by.
describe('LocationStatus', () => {
  it('pins the location status tags', () => {
    expect(LocationStatus).toEqual({ Active: 'ACTIVE', Hidden: 'HIDDEN' });
  });
});
