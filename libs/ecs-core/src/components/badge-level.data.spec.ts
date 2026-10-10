import { describe, expect, it } from 'vitest';
import { BadgeLevel, EarnedVia, MedalState } from './badge-level.data';

const level = (target: number | null): BadgeLevel => ({
  level: 1,
  ruleId: 'rule-fade-1',
  target,
  requirement: { bg: '5 посещения с фейд', en: '5 visits with a fade' },
  awards: [],
});

describe('BadgeLevel', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(EarnedVia)).toEqual(['rule', 'manual']);
    expect(Object.values(MedalState)).toEqual([
      'notStarted',
      'inProgress',
      'earned',
    ]);
  });

  it('knows a one-off act by its missing target', () => {
    expect(BadgeLevel.isOneOff(level(null))).toBe(true);
    expect(BadgeLevel.isOneOff(level(5))).toBe(false);
  });
});
