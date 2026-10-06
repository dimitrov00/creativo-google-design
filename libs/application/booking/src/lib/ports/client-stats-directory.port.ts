import { InjectionToken } from '@angular/core';
import type { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import type { ClientStatsRecord } from './client-stats-document';

/** One page of the shop's clients' statistics, and where the next one starts. */
export interface ClientStatsPage {
  /** In the order of their clients' ids, which is the only order the page promises. */
  readonly records: readonly ClientStatsRecord[];
  /**
   * The cursor for the next page: the id of the last client this page
   * READ. `null` = nobody is left.
   */
  readonly next: string | null;
}

/**
 * EVERY CLIENT'S STATISTICS, a page at a time (client-card-revision-3.md
 * §4.4): `clientStats`, walked in the order of its document ids.
 *
 * `ClientStatsReader` answers for ONE person, by name. This one answers
 * for the shop, and exists for a single reader: the admin's preview of a
 * rhythm rule, which folds each person's visits of the last year through
 * the rule twice. It reads the statistics and never the spend
 * (`restricted/money` is not walked); whoever may read one client's
 * statistics may read them all.
 *
 * One-shot reads, a page per call, so the caller decides how far to walk
 * (the preview stops at five pages of 200). A page holds `limit` clients
 * at most; a document that does not parse is left out rather than costing
 * the page, so a page may hold fewer and still have a `next`.
 */
export interface ClientStatsDirectory {
  /** `after` is the `next` of the page before; `null` starts from the first client. */
  page(
    limit: number,
    after: string | null,
  ): Promise<Result<ClientStatsPage, RepositoryError>>;
}

export const CLIENT_STATS_DIRECTORY = new InjectionToken<ClientStatsDirectory>(
  'ClientStatsDirectory',
);
