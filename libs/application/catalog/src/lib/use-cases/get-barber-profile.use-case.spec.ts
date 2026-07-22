import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { Barber, BarberId, MediaRef } from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { CatalogReader } from '../ports/catalog-reader.port';
import { MediaReader, MediaVariant } from '../ports/media-reader.port';
import { GetBarberProfileUseCase } from './get-barber-profile.use-case';
import { BarberNotFoundError } from './get-barber-profile.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function barber(withAvatar: boolean): Barber {
  return requiredValue(
    Barber.create({
      id: 'barber_1',
      name: { en: 'Jane Doe', bg: 'Джейн Доу' },
      handle: 'jane',
      title: { en: 'Senior Stylist', bg: 'Старши стилист' },
      bio: { en: 'Bio', bg: 'Био' },
      avatar: withAvatar
        ? requiredValue(
            MediaRef.create({
              id: 'media_1',
              path: 'avatars/jane.jpg',
              width: 400,
              height: 400,
            }),
          )
        : undefined,
      locationIds: [],
      status: 'active',
      sortOrder: 0,
    }),
  );
}

function fakeCatalog(found: Barber | null): CatalogReader {
  return {
    listActiveServices: () => {
      throw new Error('not used in this spec');
    },
    findServiceById: () => {
      throw new Error('not used in this spec');
    },
    listServiceCategories: () => {
      throw new Error('not used in this spec');
    },
    listActiveBarbers: () => {
      throw new Error('not used in this spec');
    },
    async findBarberById(): Promise<Result<Barber | null, RepositoryError>> {
      return ok(found);
    },
    listActiveLocations: () => {
      throw new Error('not used in this spec');
    },
    findLocationById: () => {
      throw new Error('not used in this spec');
    },
  };
}

function fakeMedia(variants: readonly MediaVariant[]): MediaReader {
  return {
    async resolve(): Promise<Result<readonly MediaVariant[], RepositoryError>> {
      return ok(variants);
    },
  };
}

describe('GetBarberProfileUseCase', () => {
  it('resolves the barber profile with their avatar variants', async () => {
    const useCase = new GetBarberProfileUseCase(
      fakeCatalog(barber(true)),
      fakeMedia([{ width: 400, url: 'https://cdn/avatars/jane-400.jpg' }]),
    );

    const result = await useCase.execute(
      requiredValue(BarberId.create('barber_1')),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.barber.handle).toBe('jane');
      expect(result.value.avatar).toHaveLength(1);
    }
  });

  it('returns an empty avatar list for a barber with no avatar set', async () => {
    const useCase = new GetBarberProfileUseCase(
      fakeCatalog(barber(false)),
      fakeMedia([]),
    );

    const result = await useCase.execute(
      requiredValue(BarberId.create('barber_1')),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.avatar).toHaveLength(0);
    }
  });

  it('reports not-found for an unknown barber', async () => {
    const useCase = new GetBarberProfileUseCase(
      fakeCatalog(null),
      fakeMedia([]),
    );

    const result = await useCase.execute(
      requiredValue(BarberId.create('nope')),
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(BarberNotFoundError);
    }
  });
});
