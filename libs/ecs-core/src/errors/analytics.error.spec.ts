import { describe, expect, it } from 'vitest';
import { BarberId, LocalDate } from '@core/primitives';
import { AnalyticsError, AnalyticsErrorCode } from './analytics.error';

const barber = (raw: string): BarberId => {
  const parsed = BarberId.parse(raw);
  if (!parsed.ok) throw new Error(`fixture: ${raw}`);
  return parsed.value;
};
const day = (raw: string): LocalDate => {
  const parsed = LocalDate.parse(raw);
  if (!parsed.ok) throw new Error(`fixture: ${raw}`);
  return parsed.value;
};

describe('AnalyticsError', () => {
  it('uses six SCREAMING codes, each with the ANALYTICS_ prefix', () => {
    expect(Object.values(AnalyticsErrorCode)).toEqual([
      'ANALYTICS_UNAUTHENTICATED',
      'ANALYTICS_FORBIDDEN',
      'ANALYTICS_BARBER_NOT_LINKED',
      'ANALYTICS_PERIOD_OUT_OF_RANGE',
      'ANALYTICS_SCOPE_UNKNOWN',
      'ANALYTICS_INVALID_INPUT',
    ]);
    for (const code of Object.values(AnalyticsErrorCode)) {
      expect(code).toMatch(/^ANALYTICS_[A-Z_]+$/);
    }
  });

  it('builds the three context-free refusals as the code alone', () => {
    expect(AnalyticsError.unauthenticated()).toEqual({
      errorCode: 'ANALYTICS_UNAUTHENTICATED',
    });
    expect(AnalyticsError.forbidden()).toEqual({
      errorCode: 'ANALYTICS_FORBIDDEN',
    });
    expect(AnalyticsError.barberNotLinked()).toEqual({
      errorCode: 'ANALYTICS_BARBER_NOT_LINKED',
    });
  });

  it('carries only scalar or branded context on the other three', () => {
    expect(AnalyticsError.periodOutOfRange(day('2025-01-01'))).toEqual({
      errorCode: 'ANALYTICS_PERIOD_OUT_OF_RANGE',
      fromLocalDate: '2025-01-01',
    });
    expect(AnalyticsError.scopeUnknown(barber('gone'))).toEqual({
      errorCode: 'ANALYTICS_SCOPE_UNKNOWN',
      barberId: 'gone',
    });
    expect(AnalyticsError.invalidInput('fromLocalDate')).toEqual({
      errorCode: 'ANALYTICS_INVALID_INPUT',
      field: 'fromLocalDate',
    });
  });
});
