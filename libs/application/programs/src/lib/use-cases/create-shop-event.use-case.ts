import { Result, fail, ok } from '@creativo/domain/kernel';
import { ShopEvent } from '@creativo/domain/programs';
import { IdGenerator } from '@creativo/application/shared';
import { ShopEventRepository } from '../ports/shop-event-repository.port';
import {
  CreateShopEventError,
  CreateShopEventRepositoryFailure,
  CreateShopEventValidationFailure,
} from './create-shop-event.errors';

export interface CreateShopEventInput {
  readonly title: { readonly en: string; readonly bg: string };
  readonly description: { readonly en: string; readonly bg: string };
  readonly startDateIso: string;
  readonly timezone: string;
  readonly locationId?: string;
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

export class CreateShopEventUseCase {
  constructor(
    private readonly events: ShopEventRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: CreateShopEventInput,
  ): Promise<Result<ShopEvent, CreateShopEventError>> {
    const eventResult = ShopEvent.create({
      id: this.idGenerator.next(),
      ...input,
    });
    if (eventResult.isFailure()) {
      return fail(new CreateShopEventValidationFailure(eventResult.error));
    }
    const event = eventResult.value;

    const saveResult = await this.events.save(event);
    if (saveResult.isFailure()) {
      return fail(new CreateShopEventRepositoryFailure(saveResult.error));
    }

    return ok(event);
  }
}
