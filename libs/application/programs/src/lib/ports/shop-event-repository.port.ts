import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { ShopEvent, ShopEventId } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export interface ShopEventRepository {
  findById(id: ShopEventId): Promise<Result<ShopEvent | null, RepositoryError>>;
  save(event: ShopEvent): Promise<Result<void, RepositoryError>>;
  /** Live events whose `startDate` is now or later, soonest first. */
  observeUpcoming(): Observable<Result<readonly ShopEvent[], RepositoryError>>;
  /** Live events whose `startDate` has passed, most recent first. */
  observePast(): Observable<Result<readonly ShopEvent[], RepositoryError>>;
}

export const SHOP_EVENT_REPOSITORY = new InjectionToken<ShopEventRepository>(
  'ShopEventRepository',
);
