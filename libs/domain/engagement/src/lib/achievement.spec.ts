import { describe, expect, it } from 'vitest';
import { Points } from './points';
import { Reward } from './reward';
import { Achievement, AchievementCriteria } from './achievement';

function reward(): Reward {
  const points = Points.create(25);
  if (points.isFailure()) throw new Error('bad fixture');
  return Reward.points(points.value);
}

describe('AchievementCriteria.evaluate', () => {
  it('always_true always passes', () => {
    expect(
      AchievementCriteria.evaluate(AchievementCriteria.alwaysTrue(), {}),
    ).toBe(true);
  });

  it('appointments_completed_at_least checks the threshold', () => {
    const criteria = AchievementCriteria.appointmentsCompletedAtLeast(5);
    expect(
      AchievementCriteria.evaluate(criteria, { appointmentsCompleted: 5 }),
    ).toBe(true);
    expect(
      AchievementCriteria.evaluate(criteria, { appointmentsCompleted: 4 }),
    ).toBe(false);
  });
});

describe('Achievement.create', () => {
  const baseProps = {
    id: 'achievement-1',
    name: 'First cut',
    trigger: 'appointment_completed' as const,
    criteria: AchievementCriteria.alwaysTrue(),
    rewards: [reward()],
    enabled: true,
  };

  it('creates a valid achievement', () => {
    const result = Achievement.create(baseProps);
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = Achievement.create({ ...baseProps, name: '   ' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty rewards array', () => {
    const result = Achievement.create({ ...baseProps, rewards: [] });
    expect(result.isFailure()).toBe(true);
  });

  it('trims and nulls a blank description', () => {
    const result = Achievement.create({ ...baseProps, description: '   ' });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.description).toBeNull();
  });
});

describe('Achievement.unlocks', () => {
  it('unlocks when enabled, trigger matches, and criteria passes', () => {
    const result = Achievement.create({
      id: 'achievement-1',
      name: 'First cut',
      trigger: 'appointment_completed',
      criteria: AchievementCriteria.appointmentsCompletedAtLeast(1),
      rewards: [reward()],
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(
      result.value.unlocks('appointment_completed', {
        appointmentsCompleted: 1,
      }),
    ).toBe(true);
  });

  it('does not unlock when disabled', () => {
    const result = Achievement.create({
      id: 'achievement-1',
      name: 'First cut',
      trigger: 'appointment_completed',
      criteria: AchievementCriteria.alwaysTrue(),
      rewards: [reward()],
      enabled: false,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.unlocks('appointment_completed', {})).toBe(false);
  });

  it('does not unlock on a mismatched trigger', () => {
    const result = Achievement.create({
      id: 'achievement-1',
      name: 'First cut',
      trigger: 'appointment_completed',
      criteria: AchievementCriteria.alwaysTrue(),
      rewards: [reward()],
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.unlocks('referral_completed', {})).toBe(false);
  });
});
