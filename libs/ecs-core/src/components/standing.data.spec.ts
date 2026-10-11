import { describe, expect, it } from 'vitest';
import {
  BadgeCategoryId,
  BadgeSeriesId,
  SeasonId,
} from '../primitives/ids.primitive';
import { localDate, utcMs } from '../testing';
import { EarnedDay, FamilyScope, FamilyScopeFilter } from './standing.data';

describe('FamilyScopeFilter', () => {
  it('declares the four scopes a page draws, SCREAMING (the discriminator `familyScope`)', () => {
    expect(Object.values(FamilyScope)).toEqual([
      'CATEGORY',
      'SEASON',
      'ARCHIVE',
      'DAY',
    ]);
  });

  it('builds each scope with its key', () => {
    expect(
      FamilyScopeFilter.category(BadgeCategoryId.of('cat-mastery')),
    ).toEqual({
      familyScope: 'CATEGORY',
      categoryId: 'cat-mastery',
    });
    expect(FamilyScopeFilter.season(SeasonId.of('season-2026-autumn'))).toEqual(
      {
        familyScope: 'SEASON',
        seasonId: 'season-2026-autumn',
      },
    );
    expect(FamilyScopeFilter.archive()).toEqual({ familyScope: 'ARCHIVE' });
    expect(FamilyScopeFilter.day(localDate('2026-09-04'))).toEqual({
      familyScope: 'DAY',
      localDate: '2026-09-04',
    });
  });
});

describe('EarnedDay', () => {
  it('holds one day and the levels earned on it', () => {
    const earnedAt = utcMs('2026-07-29T09:30:00.000+03:00');
    expect(earnedAt).toBe(1_785_306_600_000);
    const level = EarnedDay.level(BadgeSeriesId.of('s-cuts'), 3, earnedAt);
    expect(level).toEqual({
      badgeSeriesId: 's-cuts',
      level: 3,
      earnedAtUtcMs: 1_785_306_600_000,
    });
    expect(EarnedDay.of(localDate('2026-07-29'), [level])).toEqual({
      localDate: '2026-07-29',
      levels: [level],
    });
  });
});
