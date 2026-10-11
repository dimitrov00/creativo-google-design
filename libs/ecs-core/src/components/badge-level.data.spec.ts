import { describe, expect, it } from 'vitest';
import { AchievementRuleId } from '../primitives/ids.primitive';
import { BadgeLevel, EarnedVia, MedalState } from './badge-level.data';

const level = (target: number | null): BadgeLevel => ({
  level: 1,
  ruleId: AchievementRuleId.of('rule-fade-1'),
  target,
  requirement: { bg: '5 посещения с фейд', en: '5 visits with a fade' },
  awards: [],
});

describe('BadgeLevel', () => {
  it('declares its tags SCREAMING, once (Law 6)', () => {
    expect(Object.values(EarnedVia)).toEqual(['RULE', 'MANUAL']);
    expect(Object.values(MedalState)).toEqual([
      'NOT_STARTED',
      'IN_PROGRESS',
      'EARNED',
    ]);
  });

  it('knows a one-off act by its missing target', () => {
    expect(BadgeLevel.isOneOff(level(null))).toBe(true);
    expect(BadgeLevel.isOneOff(level(5))).toBe(false);
  });
});
