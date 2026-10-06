import { describe, expect, it } from 'vitest';
import * as production from './index';
import * as testing from './testing';

/**
 * The production barrel and the test-support entry point, kept apart: a
 * provider can only be handed what the barrel exports, so the in-memory
 * reader must never be on it.
 */
describe('@creativo/application/booking/testing — test support, apart from the barrel', () => {
  it('offers the port’s contract and its reference reader', () => {
    expect(testing.InMemoryAvailabilityReader).toBeTypeOf('function');
    expect(testing.availabilityReaderBusyCases).toBeTypeOf('function');
  });

  it('keeps the in-memory reader off the production barrel', () => {
    expect(Object.keys(production)).not.toContain('InMemoryAvailabilityReader');
  });

  // The barrel re-exports none of the test support: a provider can only be
  // handed what the barrel exports.
  it('re-exports none of the test support', () => {
    const support = Object.keys(testing).filter((name) =>
      Object.keys(production).includes(name),
    );
    expect(support).toEqual([]);
  });
});
