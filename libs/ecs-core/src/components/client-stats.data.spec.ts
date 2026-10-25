import { describe, expect, it } from 'vitest';
import { ClientStats } from './client-stats.data';
import { PauseSuggestion } from './pause-suggestion.data';

describe('ClientStats', () => {
  it('ClientStats.empty is a person with no history, every key present and flat', () => {
    expect(ClientStats.empty()).toEqual({
      lifetimeVisitsCompleted: 0,
      lifetimeNoShows: 0,
      lifetimeLateCancels: 0,
      lifetimeClientCancels: 0,
      last365VisitsCompleted: [],
      last365NoShows: [],
      last365LateCancels: [],
      firstVisitLocalDate: null,
      firstVisitStartMinutes: null,
      lastVisitAppointmentId: null,
      lastVisitLocalDate: null,
      lastVisitStartMinutes: null,
      lastVisitServiceIds: [],
      lastVisitBarberIds: [],
      lastVisitLegs: [],
      nextVisitAppointmentId: null,
      nextVisitLocalDate: null,
      nextVisitStartMinutes: null,
      nextVisitServiceIds: [],
      nextVisitBarberIds: [],
      nextVisitLegs: [],
      avgCadenceDays: null,
      preferredBarberId: null,
      usualServiceIds: [],
      pauseSuggestedNoShows: null,
      pauseSuggestedWindowDays: null,
      pauseSuggestionBasis: [],
      pauseSuggestedAtUtcMs: null,
    });
    expect(PauseSuggestion.isRaised(ClientStats.empty())).toBe(false);
  });
});
