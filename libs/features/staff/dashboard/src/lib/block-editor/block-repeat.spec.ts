import { describe, expect, it } from 'vitest';
import { LocalDate } from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import { RepeatPreset } from '@core/components';
import { VisitDraftSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import {
  RECURRENCE_END_WORD,
  RECURRENCE_FREQUENCY_WORD,
  REPEAT_PRESET_WORD,
  WEEKDAY_WORD,
  withCount,
  withInterval,
  withWeekdays,
} from './block-repeat';

function day(key: string): LocalDate {
  return unwrapOk(LocalDate.parse(key));
}

// 2026-09-24 is a Thursday.
const thursday = day('2026-09-24');

// The sheet's moves on a rule (shortcuts, frequency, end kind, a new start)
// are `VisitDraftSystem`'s, proved in `visit-draft.system.spec.ts`; this
// file keeps the page's own typed edits and word tables.
describe('the repeat page', () => {
  it('refuses a typed figure no rule can hold, in the domain’s words', () => {
    const weekly = VisitDraftSystem.ruleForPreset(
      RepeatPreset.Weekly,
      thursday,
      null,
    );
    if (weekly === null) throw new Error('fixture');
    const none = withInterval(weekly, 0);
    expect(!none.ok && none.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidInterval,
    );
    const tooMany = withCount(weekly, 500);
    expect(!tooMany.ok && tooMany.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidCount,
    );
    const noDays = withWeekdays(weekly, []);
    expect(!noDays.ok && noDays.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceNoWeekdays,
    );
  });

  it('keeps the page’s lowercase words — one per dictionary value', () => {
    expect(
      VisitDraftSystem.REPEAT_PRESETS.map(
        (preset) => REPEAT_PRESET_WORD[preset],
      ),
    ).toEqual(['never', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']);
    expect(Object.values(RECURRENCE_FREQUENCY_WORD)).toEqual([
      'daily',
      'weekly',
      'monthly',
      'yearly',
    ]);
    expect(Object.values(RECURRENCE_END_WORD)).toEqual(['until', 'count']);
    expect(Object.values(WEEKDAY_WORD)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });
});
