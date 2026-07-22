import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { Milestone, MilestoneCriteria } from './milestone';
import { Points } from './points';
import { Reward } from './reward';
import { RewardProgram } from './reward-program';

const zone = 'Europe/Sofia';
function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function milestone(id: string): Milestone {
  const points = Points.create(50);
  if (points.isFailure()) throw new Error('bad fixture');
  const result = Milestone.create({
    id,
    order: 0,
    criteria: MilestoneCriteria.alwaysTrue(),
    rewards: [Reward.points(points.value)],
    enabled: true,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('RewardProgram.create', () => {
  const baseProps = {
    id: 'program-1',
    name: 'Welcome program',
    kind: 'welcome' as const,
    milestones: [milestone('m1')],
    enabled: true,
  };

  it('creates a valid program', () => {
    const result = RewardProgram.create(baseProps);
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = RewardProgram.create({ ...baseProps, name: '  ' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty milestones array', () => {
    const result = RewardProgram.create({ ...baseProps, milestones: [] });
    expect(result.isFailure()).toBe(true);
  });

  it('milestoneById finds a milestone by id', () => {
    const result = RewardProgram.create(baseProps);
    if (result.isFailure()) throw new Error('bad fixture');
    const found = result.value.milestoneById(baseProps.milestones[0]!.id);
    expect(found).toBeDefined();
  });
});

describe('RewardProgram.isActiveAt', () => {
  it('is always active with no date window', () => {
    const result = RewardProgram.create({
      id: 'p1',
      name: 'x',
      kind: 'loyalty',
      milestones: [milestone('m1')],
      enabled: true,
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.isActiveAt(at('2026-06-01T00:00:00'))).toBe(true);
  });

  it('respects an activeFrom/activeUntil window', () => {
    const result = RewardProgram.create({
      id: 'p1',
      name: 'x',
      kind: 'loyalty',
      milestones: [milestone('m1')],
      enabled: true,
      activeFrom: at('2026-01-01T00:00:00'),
      activeUntil: at('2026-02-01T00:00:00'),
    });
    if (result.isFailure()) throw new Error('bad fixture');
    expect(result.value.isActiveAt(at('2026-01-15T00:00:00'))).toBe(true);
    expect(result.value.isActiveAt(at('2025-12-01T00:00:00'))).toBe(false);
    expect(result.value.isActiveAt(at('2026-03-01T00:00:00'))).toBe(false);
  });
});
