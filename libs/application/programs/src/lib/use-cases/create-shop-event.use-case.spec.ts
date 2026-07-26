import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { ShopEvent } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { ShopEventRepository } from '../ports/shop-event-repository.port';
import { CreateShopEventUseCase } from './create-shop-event.use-case';
import { CreateShopEventValidationFailure } from './create-shop-event.errors';

function fakeRepository(): ShopEventRepository & { saved: ShopEvent[] } {
  const saved: ShopEvent[] = [];
  return {
    saved,
    async save(event): Promise<Result<void, RepositoryError>> {
      saved.push(event);
      return ok(undefined);
    },
    async findById(): Promise<Result<ShopEvent | null, RepositoryError>> {
      return ok(null);
    },
    observeUpcoming() {
      throw new Error('not used in this spec');
    },
    observePast() {
      throw new Error('not used in this spec');
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

describe('CreateShopEventUseCase', () => {
  it('creates and saves an event', async () => {
    const repo = fakeRepository();
    const useCase = new CreateShopEventUseCase(repo, fakeIdGenerator('evt'));

    const result = await useCase.execute({
      title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
      description: {
        en: 'Walk-in trims, no booking needed',
        bg: 'Подстригвания без резервация',
      },
      startDateIso: '2026-09-12T10:00:00',
      timezone: 'Europe/Sofia',
      sortOrder: 0,
    });

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
  });

  it('rejects an invalid start date', async () => {
    const repo = fakeRepository();
    const useCase = new CreateShopEventUseCase(repo, fakeIdGenerator('evt'));

    const result = await useCase.execute({
      title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
      description: {
        en: 'Walk-in trims, no booking needed',
        bg: 'Подстригвания без резервация',
      },
      startDateIso: 'not-a-date',
      timezone: 'Europe/Sofia',
      sortOrder: 0,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CreateShopEventValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
