import { describe, expect, it } from 'vitest';
import { localDate, minute, unwrapOk } from '@core/testing';
import { ZonedTimeSystem } from '@core/systems';
import {
  DateTimeInvalidReason,
  TimeError,
  TimeErrorCode,
} from './time-errors.data';

const SOFIA = unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'));

describe('TimeError', () => {
  it('uses the SCREAMING codes the UI translates as errors.<errorCode> (§2.1)', () => {
    expect(Object.values(TimeErrorCode)).toEqual([
      'DST_GAP_INVALID_TIME',
      'TIME_INVALID_DATE_TIME',
      'TIME_INVALID_TIME_ZONE',
    ]);
    expect(Object.values(DateTimeInvalidReason)).toEqual([
      'UNPARSABLE',
      'OUT_OF_RANGE',
    ]);
  });

  it('builds flat structs whose fields are i18n parameters', () => {
    expect(
      TimeError.invalidDateTime('not-a-date', DateTimeInvalidReason.Unparsable),
    ).toEqual({
      errorCode: 'TIME_INVALID_DATE_TIME',
      rawValue: 'not-a-date',
      dateTimeInvalidReason: 'UNPARSABLE',
    });
    expect(TimeError.invalidTimeZone('Not/AZone')).toEqual({
      errorCode: 'TIME_INVALID_TIME_ZONE',
      rawZone: 'Not/AZone',
    });
    expect(
      TimeError.dstGap(localDate('2026-03-29'), minute(210), SOFIA),
    ).toEqual({
      errorCode: 'DST_GAP_INVALID_TIME',
      localDate: '2026-03-29',
      minute: 210,
      timeZone: 'Europe/Sofia',
    });
  });

  it('is() narrows on the errorCode', () => {
    const error: TimeError = TimeError.dstGap(
      localDate('2026-03-29'),
      minute(210),
      SOFIA,
    );
    expect(TimeError.is(error, TimeErrorCode.DstGap)).toBe(true);
    expect(TimeError.is(error, TimeErrorCode.InvalidDateTime)).toBe(false);
    if (TimeError.is(error, TimeErrorCode.DstGap)) {
      expect(error.timeZone).toBe('Europe/Sofia');
    }
  });

  it('is serialisable and prototype-free (Law 7.5)', () => {
    const error = TimeError.invalidTimeZone('X');
    expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(error))).toEqual(error);
  });
});
