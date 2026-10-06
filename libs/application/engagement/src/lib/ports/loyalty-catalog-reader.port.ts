import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import type { LoyaltyCatalog } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The published loyalty catalogue — shelves, medal families, seasons,
 * tiers, rewards, the rhythm — read whole and validated as one model
 * (`LoyaltyCatalog.create`). Presentation, not personal data: any
 * signed-in person may read it.
 *
 * It changes when the shop publishes, not while a card is open, so an
 * implementation may keep a good answer for the session; a failed read is
 * never kept, so the next call tries again.
 */
export interface LoyaltyCatalogReader {
  getCatalog(): Promise<Result<LoyaltyCatalog, RepositoryError>>;
}

export const LOYALTY_CATALOG_READER = new InjectionToken<LoyaltyCatalogReader>(
  'LoyaltyCatalogReader',
);
