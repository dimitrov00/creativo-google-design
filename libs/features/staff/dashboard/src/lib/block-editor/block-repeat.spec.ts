import { describe, expect, it } from 'vitest';
import { VisitDraftSystem } from '@core/systems';
import {
  RECURRENCE_END_WORD,
  RECURRENCE_FREQUENCY_WORD,
  REPEAT_PRESET_WORD,
  WEEKDAY_WORD,
} from './block-repeat';

// The sheet's moves on a rule (shortcuts, frequency, end kind, a new start,
// a typed figure) are `VisitDraftSystem`'s, proved in
// `visit-draft.system.spec.ts`; this file keeps the page's word tables.
describe('the repeat page', () => {
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
