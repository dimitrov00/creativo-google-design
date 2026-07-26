import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { Position } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { PositionRepository } from '../ports/position-repository.port';
import { CreatePositionUseCase } from './create-position.use-case';
import { CreatePositionValidationFailure } from './create-position.errors';

function fakeRepository(): PositionRepository & { saved: Position[] } {
  const saved: Position[] = [];
  return {
    saved,
    async save(position): Promise<Result<void, RepositoryError>> {
      saved.push(position);
      return ok(undefined);
    },
    async findById(): Promise<Result<Position | null, RepositoryError>> {
      return ok(null);
    },
    observeOpen() {
      throw new Error('not used in this spec');
    },
    observeAll() {
      throw new Error('not used in this spec');
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

describe('CreatePositionUseCase', () => {
  it('creates and saves an open position', async () => {
    const repo = fakeRepository();
    const useCase = new CreatePositionUseCase(repo, fakeIdGenerator('pos'));

    const result = await useCase.execute({
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: ['loc_center'],
      status: 'open',
      sortOrder: 0,
    });

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
    if (result.isSuccess()) {
      expect(result.value.isOpen()).toBe(true);
    }
  });

  it('rejects a blank title', async () => {
    const repo = fakeRepository();
    const useCase = new CreatePositionUseCase(repo, fakeIdGenerator('pos'));

    const result = await useCase.execute({
      title: { en: '', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: [],
      status: 'open',
      sortOrder: 0,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CreatePositionValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
