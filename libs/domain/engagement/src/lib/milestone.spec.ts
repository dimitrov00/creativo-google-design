import { describe, expect, it } from 'vitest';
import { Points } from './points';
import { Reward } from './reward';
import { Milestone, MilestoneCriteria } from './milestone';

function reward(): Reward {
  const points = Points.create(10);
  if (points.isFailure()) throw new Error('bad fixture');
  return Reward.points(points.value);
}

describe('MilestoneCriteria', () => {
  it('rejects a non-positive appointments threshold', () => {
    expect(MilestoneCriteria.appointmentsCompletedAtLeast(0).isFailure()).toBe(
      true,
    );
  });

  it('evaluate() checks always_true unconditionally', () => {
    expect(MilestoneCriteria.evaluate(MilestoneCriteria.alwaysTrue(), {})).toBe(
      true,
    );
  });

  it('evaluate() checks the appointments-completed threshold', () => {
    const criteria = MilestoneCriteria.appointmentsCompletedAtLeast(3);
    if (criteria.isFailure()) throw new Error('bad fixture');
    expect(
      MilestoneCriteria.evaluate(criteria.value, { appointmentsCompleted: 3 }),
    ).toBe(true);
    expect(
      MilestoneCriteria.evaluate(criteria.value, { appointmentsCompleted: 2 }),
    ).toBe(false);
    expect(MilestoneCriteria.evaluate(criteria.value, {})).toBe(false);
  });
});

describe('Milestone.create', () => {
  const baseProps = {
    id: 'milestone-1',
    order: 0,
    criteria: MilestoneCriteria.alwaysTrue(),
    rewards: [reward()],
    enabled: true,
  };

  it('creates a valid milestone', () => {
    const result = Milestone.create(baseProps);
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = Milestone.create({ ...baseProps, id: '' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a negative order', () => {
    const result = Milestone.create({ ...baseProps, order: -1 });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty rewards array', () => {
    const result = Milestone.create({ ...baseProps, rewards: [] });
    expect(result.isFailure()).toBe(true);
  });

  it('collects multiple field errors at once', () => {
    const result = Milestone.create({
      ...baseProps,
      id: '',
      order: -1,
      rewards: [],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(3);
    }
  });
});
