import { ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Milestone, MilestoneCriteria } from './milestone';
import { Points } from './points';
import { Reward } from './reward';
import { RewardProgram } from './reward-program';
import { RewardProgress } from './reward-progress';

const zone = 'Europe/Sofia';
function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function makeMilestone(id: string): Milestone {
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

function makeProgram(): RewardProgram {
  const result = RewardProgram.create({
    id: 'program-1',
    name: 'Welcome',
    kind: 'welcome',
    milestones: [makeMilestone('m1'), makeMilestone('m2')],
    enabled: true,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('RewardProgress.enroll', () => {
  it('starts every milestone as pending', () => {
    const progress = RewardProgress.enroll(
      UserId.generate(),
      makeProgram(),
      at('2026-01-01T00:00:00'),
    );
    expect(progress.milestones).toHaveLength(2);
    expect(progress.milestones.every((s) => s.kind === 'pending')).toBe(true);
    expect(progress.isFullyResolved()).toBe(false);
    expect(progress.completionRatio()).toEqual({ completed: 0, total: 2 });
  });
});

describe('RewardProgress.advanceMilestone', () => {
  it('advances a pending milestone to completed', () => {
    const program = makeProgram();
    const progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const milestoneId = program.milestones[0]!.id;
    const result = progress.advanceMilestone(
      milestoneId,
      at('2026-01-02T00:00:00'),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.statusOf(milestoneId)?.kind).toBe('completed');
      expect(result.value.completionRatio()).toEqual({
        completed: 1,
        total: 2,
      });
    }
  });

  it('rejects advancing an unknown milestone', () => {
    const program = makeProgram();
    const progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const other = makeMilestone('not-in-program');
    const result = progress.advanceMilestone(
      other.id,
      at('2026-01-02T00:00:00'),
    );
    expect(result.isFailure()).toBe(true);
  });

  it('rejects advancing an already-completed milestone (terminal states never revert)', () => {
    const program = makeProgram();
    const progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const milestoneId = program.milestones[0]!.id;
    const completed = progress.advanceMilestone(
      milestoneId,
      at('2026-01-02T00:00:00'),
    );
    if (completed.isFailure()) throw new Error('bad fixture');
    const result = completed.value.advanceMilestone(
      milestoneId,
      at('2026-01-03T00:00:00'),
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('RewardProgress.expireMilestone', () => {
  it('expires a pending milestone', () => {
    const program = makeProgram();
    const progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const milestoneId = program.milestones[1]!.id;
    const result = progress.expireMilestone(
      milestoneId,
      at('2026-02-01T00:00:00'),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.statusOf(milestoneId)?.kind).toBe('expired');
    }
  });

  it('rejects expiring an already-expired milestone', () => {
    const program = makeProgram();
    const progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const milestoneId = program.milestones[1]!.id;
    const expired = progress.expireMilestone(
      milestoneId,
      at('2026-02-01T00:00:00'),
    );
    if (expired.isFailure()) throw new Error('bad fixture');
    const result = expired.value.expireMilestone(
      milestoneId,
      at('2026-02-02T00:00:00'),
    );
    expect(result.isFailure()).toBe(true);
  });
});

describe('RewardProgress.isFullyResolved', () => {
  it('is true once every milestone reaches a terminal state', () => {
    const program = makeProgram();
    let progress = RewardProgress.enroll(
      UserId.generate(),
      program,
      at('2026-01-01T00:00:00'),
    );
    const r1 = progress.advanceMilestone(
      program.milestones[0]!.id,
      at('2026-01-02T00:00:00'),
    );
    if (r1.isFailure()) throw new Error('bad fixture');
    progress = r1.value;
    const r2 = progress.expireMilestone(
      program.milestones[1]!.id,
      at('2026-02-01T00:00:00'),
    );
    if (r2.isFailure()) throw new Error('bad fixture');
    progress = r2.value;
    expect(progress.isFullyResolved()).toBe(true);
  });
});
