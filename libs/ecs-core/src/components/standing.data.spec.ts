import { describe, expect, it } from 'vitest';
import type { BadgeCategoryId } from '../entities/badge-category.entity';
import type { SeasonId } from '../entities/season.entity';
import { DayKey } from './day-key.data';
import { SeriesId } from '../entities/badge-series.entity';
import { EarnedDay, FamilyScope, FamilyScopeKind } from './standing.data';

describe('FamilyScope', () => {
  it('keeps the four scopes a page draws', () => {
    expect(Object.values(FamilyScopeKind)).toEqual([
      'category',
      'season',
      'archive',
      'day',
    ]);
  });

  it('builds each scope with its key', () => {
    expect(FamilyScope.category('cat-mastery' as BadgeCategoryId)).toEqual({
      kind: 'category',
      categoryId: 'cat-mastery',
    });
    expect(FamilyScope.season('season-2026-autumn' as SeasonId)).toEqual({
      kind: 'season',
      seasonId: 'season-2026-autumn',
    });
    expect(FamilyScope.archive()).toEqual({ kind: 'archive' });
    expect(FamilyScope.day(DayKey.of('2026-09-04'))).toEqual({
      kind: 'day',
      day: '2026-09-04',
    });
  });
});

describe('EarnedDay', () => {
  it('holds one day and the levels earned on it', () => {
    const level = EarnedDay.level(SeriesId.of('s-cuts'), 3, 1_785_306_600_000);
    expect(level).toEqual({
      seriesId: 's-cuts',
      level: 3,
      earnedAtMs: 1_785_306_600_000,
    });
    expect(EarnedDay.of(DayKey.of('2026-07-29'), [level])).toEqual({
      day: '2026-07-29',
      levels: [level],
    });
  });
});
