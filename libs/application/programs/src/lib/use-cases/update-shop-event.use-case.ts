import { Result, fail, ok } from '@creativo/domain/kernel';
import { ShopEvent, ShopEventId } from '@creativo/domain/programs';
import { ShopEventRepository } from '../ports/shop-event-repository.port';
import {
  ShopEventNotFoundError,
  UpdateShopEventError,
  UpdateShopEventRepositoryFailure,
  UpdateShopEventValidationFailure,
} from './update-shop-event.errors';

export interface UpdateShopEventInput {
  readonly id: ShopEventId;
  readonly title: { readonly en: string; readonly bg: string };
  readonly description: { readonly en: string; readonly bg: string };
  readonly startDateIso: string;
  readonly timezone: string;
  readonly locationId?: string;
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

/** Same posture as `UpdatePositionUseCase` — the admin form submits the
 *  full edited record, so `findById` only confirms the event still exists
 *  before rebuilding through `ShopEvent.create` and saving. */
export class UpdateShopEventUseCase {
  constructor(private readonly events: ShopEventRepository) {}

  async execute(
    input: UpdateShopEventInput,
  ): Promise<Result<ShopEvent, UpdateShopEventError>> {
    const foundResult = await this.events.findById(input.id);
    if (foundResult.isFailure()) {
      return fail(new UpdateShopEventRepositoryFailure(foundResult.error));
    }
    if (!foundResult.value) {
      return fail(new ShopEventNotFoundError());
    }

    const rebuiltResult = ShopEvent.create({
      id: input.id.value,
      title: input.title,
      description: input.description,
      startDateIso: input.startDateIso,
      timezone: input.timezone,
      ...(input.locationId !== undefined && { locationId: input.locationId }),
      ...(input.applyUrl !== undefined && { applyUrl: input.applyUrl }),
      sortOrder: input.sortOrder,
    });
    if (rebuiltResult.isFailure()) {
      return fail(new UpdateShopEventValidationFailure(rebuiltResult.error));
    }
    const updated = rebuiltResult.value;

    const saveResult = await this.events.save(updated);
    if (saveResult.isFailure()) {
      return fail(new UpdateShopEventRepositoryFailure(saveResult.error));
    }

    return ok(updated);
  }
}
