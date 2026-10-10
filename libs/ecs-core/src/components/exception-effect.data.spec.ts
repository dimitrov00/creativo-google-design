import { describe, expect, it } from 'vitest';
import { ExceptionEffect, ExceptionEffectKind } from './exception-effect.data';
import { MinuteRange } from './minute-range.data';

const r = (start: number, end: number): MinuteRange =>
  MinuteRange.of(start, end);

describe('ExceptionEffect — the public face, never the reason', () => {
  it('has exactly three effects, no field a reason could ride in', () => {
    expect(Object.values(ExceptionEffectKind).sort()).toEqual([
      'blocked',
      'closed',
      'hours',
    ]);
    expect(ExceptionEffect.closed()).toEqual({ kind: 'closed' });
  });

  it('normalizes the ranges of hours and blocked effects', () => {
    expect(ExceptionEffect.hours([r(780, 900), r(600, 800)])).toEqual({
      ok: true,
      value: { kind: 'hours', ranges: [r(600, 900)] },
    });
    expect(ExceptionEffect.blocked([r(720, 780)])).toEqual({
      ok: true,
      value: { kind: 'blocked', ranges: [r(720, 780)] },
    });
  });

  it('refuses an empty range list — an empty `hours` would silently mean closed', () => {
    expect(ExceptionEffect.hours([])).toEqual({
      ok: false,
      error: {
        code: 'scheduling.schedule_exception.empty_ranges',
        exceptionKind: 'hours',
      },
    });
    expect(ExceptionEffect.blocked([r(600, 600)])).toEqual({
      ok: false,
      error: {
        code: 'scheduling.schedule_exception.empty_ranges',
        exceptionKind: 'blocked',
      },
    });
  });

  it('answers whole-day and roster-replacing questions', () => {
    const hours = ExceptionEffect.hours([r(600, 900)]);
    const blocked = ExceptionEffect.blocked([r(720, 780)]);
    if (!hours.ok || !blocked.ok) throw new Error('bad fixture');
    expect(ExceptionEffect.isWholeDay(ExceptionEffect.closed())).toBe(true);
    expect(ExceptionEffect.isWholeDay(hours.value)).toBe(false);
    expect(ExceptionEffect.replacesRoster(hours.value)).toBe(true);
    expect(ExceptionEffect.replacesRoster(blocked.value)).toBe(false);
    expect(ExceptionEffect.replacesRoster(ExceptionEffect.closed())).toBe(
      false,
    );
  });
});
