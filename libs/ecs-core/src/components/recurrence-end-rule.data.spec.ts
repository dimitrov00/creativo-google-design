import { describe, expect, it } from 'vitest';
import { deepFreeze, localDate } from '@core/testing';
import { RecurrenceEndRule } from './recurrence-end-rule.data';
import { RecurrencePattern } from './recurrence-pattern.data';
import { RecurrenceRule } from './recurrence-rule.data';

describe('RecurrenceEndRule.sliceOf — the end slice, as a fresh struct', () => {
  it('keeps only the end fields of a whole rule', () => {
    const rule = RecurrenceRule.of(
      RecurrencePattern.monthlyByDate(24),
      2,
      RecurrenceEndRule.until(localDate('2026-12-31')),
    );
    expect(RecurrenceEndRule.sliceOf(rule)).toEqual({
      recurrenceEnd: 'UNTIL',
      untilLocalDate: '2026-12-31',
    });
    const counted = RecurrenceRule.of(
      RecurrencePattern.daily(),
      1,
      RecurrenceEndRule.count(5),
    );
    expect(RecurrenceEndRule.sliceOf(counted)).toEqual({
      recurrenceEnd: 'COUNT',
      occurrenceCount: 5,
    });
  });

  it('is pure — a fresh struct, the input unchanged', () => {
    const end = deepFreeze(RecurrenceEndRule.count(3));
    const copy = RecurrenceEndRule.sliceOf(end);
    expect(copy).toEqual(end);
    expect(copy).not.toBe(end);
    expect(RecurrenceEndRule.sliceOf(end)).toEqual(copy);
  });
});
