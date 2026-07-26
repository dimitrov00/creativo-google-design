import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { ShopEvent } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { ShopEventRepository } from '../ports/shop-event-repository.port';

export class ObserveUpcomingShopEventsUseCase {
  constructor(private readonly events: ShopEventRepository) {}

  execute(): Observable<Result<readonly ShopEvent[], RepositoryError>> {
    return this.events.observeUpcoming();
  }
}
