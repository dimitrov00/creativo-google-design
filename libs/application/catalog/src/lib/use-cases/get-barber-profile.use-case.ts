import { Result, fail, ok } from '@creativo/domain/kernel';
import { Barber, BarberId } from '@creativo/domain/catalog';
import { CatalogReader } from '../ports/catalog-reader.port';
import { MediaReader, MediaVariant } from '../ports/media-reader.port';
import {
  BarberNotFoundError,
  GetBarberProfileError,
  GetBarberProfileRepositoryFailure,
} from './get-barber-profile.errors';

export interface BarberProfile {
  readonly barber: Barber;
  readonly avatar: readonly MediaVariant[];
}

/** Composes a barber lookup with resolving their avatar `MediaRef` into servable variants. */
export class GetBarberProfileUseCase {
  constructor(
    private readonly catalog: CatalogReader,
    private readonly media: MediaReader,
  ) {}

  async execute(
    id: BarberId,
  ): Promise<Result<BarberProfile, GetBarberProfileError>> {
    const barberResult = await this.catalog.findBarberById(id);
    if (barberResult.isFailure()) {
      return fail(new GetBarberProfileRepositoryFailure(barberResult.error));
    }
    const barber = barberResult.value;
    if (!barber) {
      return fail(new BarberNotFoundError());
    }
    if (!barber.avatar) {
      return ok({ barber, avatar: [] });
    }

    const avatarResult = await this.media.resolve(barber.avatar);
    if (avatarResult.isFailure()) {
      return fail(new GetBarberProfileRepositoryFailure(avatarResult.error));
    }

    return ok({ barber, avatar: avatarResult.value });
  }
}
