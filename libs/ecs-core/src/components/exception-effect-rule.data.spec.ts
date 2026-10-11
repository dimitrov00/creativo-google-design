import { describe, expect, it } from 'vitest';
import { endMinute, minute, unwrapOk } from '@core/testing';
import { ExceptionEffect } from '@core/primitives';
import { ExceptionEffectRule } from './exception-effect-rule.data';
import { MinuteRange } from './minute-range.data';

const r = (start: number, end: number): MinuteRange =>
  MinuteRange.of(minute(start), endMinute(end));

describe('ExceptionEffectRule — the public face, never the reason', () => {
  it('has exactly three effects, no field a reason could ride in', () => {
    expect(Object.values(ExceptionEffect).sort()).toEqual([
      'BLOCKED',
      'CLOSED',
      'HOURS',
    ]);
    expect(ExceptionEffectRule.closed()).toEqual({ exceptionEffect: 'CLOSED' });
  });

  it('normalizes the ranges of HOURS and BLOCKED effects', () => {
    expect(ExceptionEffectRule.hours([r(780, 900), r(600, 800)])).toEqual({
      ok: true,
      value: { exceptionEffect: 'HOURS', exceptionRanges: [r(600, 900)] },
    });
    expect(ExceptionEffectRule.blocked([r(720, 780)])).toEqual({
      ok: true,
      value: { exceptionEffect: 'BLOCKED', exceptionRanges: [r(720, 780)] },
    });
  });

  it('refuses an empty range list — an empty HOURS would silently mean CLOSED', () => {
    expect(ExceptionEffectRule.hours([])).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES',
        exceptionKind: 'HOURS',
      },
    });
    expect(
      ExceptionEffectRule.blocked([
        MinuteRange.of(minute(600), endMinute(600)),
      ]),
    ).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES',
        exceptionKind: 'BLOCKED',
      },
    });
  });

  it('answers whole-day and roster-replacing questions', () => {
    const hours = unwrapOk(ExceptionEffectRule.hours([r(600, 900)]));
    const blocked = unwrapOk(ExceptionEffectRule.blocked([r(720, 780)]));
    expect(ExceptionEffectRule.isWholeDay(ExceptionEffectRule.closed())).toBe(
      true,
    );
    expect(ExceptionEffectRule.isWholeDay(hours)).toBe(false);
    expect(ExceptionEffectRule.replacesRoster(hours)).toBe(true);
    expect(ExceptionEffectRule.replacesRoster(blocked)).toBe(false);
    expect(
      ExceptionEffectRule.replacesRoster(ExceptionEffectRule.closed()),
    ).toBe(false);
  });
});
