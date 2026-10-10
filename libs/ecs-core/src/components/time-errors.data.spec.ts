import { describe, expect, it } from 'vitest';
import {
  DateTimeInvalidReason,
  TimeError,
  TimeErrorCode,
} from './time-errors.data';

describe('TimeError', () => {
  it('uses the dotted time.* codes the UI translates', () => {
    expect(Object.values(TimeErrorCode)).toEqual([
      'time.invalid_date_time',
      'time.invalid_time_zone',
      'time.nonexistent_local_time',
      'time.ambiguous_local_time',
    ]);
  });

  it('builds plain structs whose fields are i18n parameters', () => {
    expect(
      TimeError.invalidDateTime('not-a-date', DateTimeInvalidReason.Unparsable),
    ).toEqual({
      code: 'time.invalid_date_time',
      rawValue: 'not-a-date',
      reason: 'unparsable',
    });
    expect(TimeError.invalidTimeZone('Not/AZone')).toEqual({
      code: 'time.invalid_time_zone',
      rawZone: 'Not/AZone',
    });
    expect(
      TimeError.nonexistentLocalTime('2026-03-29T03:30', 'Europe/Sofia'),
    ).toEqual({
      code: 'time.nonexistent_local_time',
      rawValue: '2026-03-29T03:30',
      zone: 'Europe/Sofia',
    });
    expect(
      TimeError.ambiguousLocalTime('2026-10-25T03:30', 'Europe/Sofia'),
    ).toEqual({
      code: 'time.ambiguous_local_time',
      rawValue: '2026-10-25T03:30',
      zone: 'Europe/Sofia',
    });
  });

  it('is() narrows on the code', () => {
    const error: TimeError = TimeError.nonexistentLocalTime(
      '2026-03-29T03:30',
      'Europe/Sofia',
    );
    expect(TimeError.is(error, TimeErrorCode.NonexistentLocalTime)).toBe(true);
    expect(TimeError.is(error, TimeErrorCode.AmbiguousLocalTime)).toBe(false);
    if (TimeError.is(error, TimeErrorCode.NonexistentLocalTime)) {
      expect(error.zone).toBe('Europe/Sofia');
    }
  });
});
