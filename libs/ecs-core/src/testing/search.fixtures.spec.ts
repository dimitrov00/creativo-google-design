import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import {
  SEARCH_BARBERS,
  SEARCH_SERVICES,
  searchWindowFixture,
} from './search.fixtures';

describe('searchWindowFixture — a seeded window', () => {
  it('is the same window for the same seed, and another for another', () => {
    const a = searchWindowFixture(50, 3).visits;
    expect(searchWindowFixture(50, 3).visits).toEqual(a);
    expect(searchWindowFixture(50, 4).visits).not.toEqual(a);
  });

  it('spreads over every barber, service and status, with unique ids', () => {
    const { visits } = searchWindowFixture(400, 1);
    expect(new Set(visits.map((v) => v.id)).size).toBe(400);
    for (const barber of SEARCH_BARBERS) {
      expect(visits.some((v) => v.barberIds.includes(barber.id))).toBe(true);
    }
    for (const service of SEARCH_SERVICES) {
      expect(
        visits.some((v) => v.seats.some((s) => s.serviceId === service.id)),
      ).toBe(true);
    }
    expect(new Set(visits.map((v) => v.bookingStatus))).toEqual(
      new Set([
        BookingStatus.Confirmed,
        BookingStatus.Completed,
        BookingStatus.Cancelled,
        BookingStatus.NoShow,
      ]),
    );
  });

  it('names every id it uses', () => {
    const { visits, labels } = searchWindowFixture(40, 2);
    for (const visit of visits) {
      expect(labels.clientNames(visit).length).toBeGreaterThan(0);
      for (const id of visit.barberIds) {
        expect(labels.barberName(id)).not.toBeNull();
      }
    }
  });
});
