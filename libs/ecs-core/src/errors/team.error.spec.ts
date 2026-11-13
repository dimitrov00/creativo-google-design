import { describe, expect, it } from 'vitest';
import { BarberId, LocationId, ServiceId } from '@core/primitives';
import { TeamError, TeamErrorCode } from './team.error';

describe('TeamError', () => {
  it('uses ten SCREAMING codes, each with the TEAM_ prefix (team onboarding D11)', () => {
    expect(Object.values(TeamErrorCode)).toEqual([
      'TEAM_UNAUTHENTICATED',
      'TEAM_FORBIDDEN',
      'TEAM_INVALID_INPUT',
      'TEAM_BARBER_NOT_FOUND',
      'TEAM_BARBER_DEPARTED',
      'TEAM_PERIOD_INVALID',
      'TEAM_SHOP_UNKNOWN',
      'TEAM_SHOP_HAS_HOURS',
      'TEAM_SERVICE_UNKNOWN',
      'TEAM_NOT_DRAFT',
    ]);
    for (const code of Object.values(TeamErrorCode)) {
      expect(code).toMatch(/^TEAM_[A-Z_]+$/);
    }
  });

  it('builds the context-free refusals as the code alone', () => {
    expect(TeamError.unauthenticated()).toEqual({
      errorCode: 'TEAM_UNAUTHENTICATED',
    });
    expect(TeamError.forbidden()).toEqual({ errorCode: 'TEAM_FORBIDDEN' });
    expect(TeamError.periodInvalid()).toEqual({
      errorCode: 'TEAM_PERIOD_INVALID',
    });
  });

  it('carries only scalar or branded context on the rest', () => {
    const barberId = BarberId.of('b-new');
    const locationId = LocationId.of('loc-center');
    expect(TeamError.invalidInput('name')).toEqual({
      errorCode: 'TEAM_INVALID_INPUT',
      field: 'name',
    });
    expect(TeamError.barberNotFound(barberId)).toEqual({
      errorCode: 'TEAM_BARBER_NOT_FOUND',
      barberId: 'b-new',
    });
    expect(TeamError.barberDeparted(barberId)).toEqual({
      errorCode: 'TEAM_BARBER_DEPARTED',
      barberId: 'b-new',
    });
    expect(TeamError.shopUnknown(locationId)).toEqual({
      errorCode: 'TEAM_SHOP_UNKNOWN',
      locationId: 'loc-center',
    });
    expect(TeamError.shopHasHours(locationId)).toEqual({
      errorCode: 'TEAM_SHOP_HAS_HOURS',
      locationId: 'loc-center',
    });
    expect(TeamError.serviceUnknown(ServiceId.of('svc-gone'))).toEqual({
      errorCode: 'TEAM_SERVICE_UNKNOWN',
      serviceId: 'svc-gone',
    });
    expect(TeamError.notDraft(barberId)).toEqual({
      errorCode: 'TEAM_NOT_DRAFT',
      barberId: 'b-new',
    });
  });
});
