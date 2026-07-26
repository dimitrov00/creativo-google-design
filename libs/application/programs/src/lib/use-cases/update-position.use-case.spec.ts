import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { Position, PositionId } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { PositionRepository } from '../ports/position-repository.port';
import { UpdatePositionUseCase } from './update-position.use-case';
import { PositionNotFoundError } from './update-position.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

function existingPosition(): Position {
  const result = Position.create({
    id: 'pos_1',
    title: { en: 'Barber', bg: 'Бръснар' },
    summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
    locationIds: ['loc_center'],
    status: 'open',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

function fakeRepository(
  seed: Position | null,
): PositionRepository & { saved: Position[] } {
  const saved: Position[] = [];
  return {
    saved,
    async save(position): Promise<Result<void, RepositoryError>> {
      saved.push(position);
      return ok(undefined);
    },
    async findById(): Promise<Result<Position | null, RepositoryError>> {
      return ok(seed);
    },
    observeOpen() {
      throw new Error('not used in this spec');
    },
    observeAll() {
      throw new Error('not used in this spec');
    },
  };
}

describe('UpdatePositionUseCase', () => {
  it('closes an existing position', async () => {
    const repo = fakeRepository(existingPosition());
    const useCase = new UpdatePositionUseCase(repo);

    const result = await useCase.execute({
      id: requiredValue(PositionId.create('pos_1')),
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: ['loc_center'],
      status: 'closed',
      sortOrder: 0,
    });

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
    if (result.isSuccess()) {
      expect(result.value.isOpen()).toBe(false);
    }
  });

  it('fails when the position does not exist', async () => {
    const repo = fakeRepository(null);
    const useCase = new UpdatePositionUseCase(repo);

    const result = await useCase.execute({
      id: requiredValue(PositionId.create('pos_missing')),
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: [],
      status: 'open',
      sortOrder: 0,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(PositionNotFoundError);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
