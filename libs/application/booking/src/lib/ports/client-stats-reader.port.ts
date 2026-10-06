import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import type {
  ClientMoneyRecord,
  ClientStatsRecord,
} from './client-stats-document';

/**
 * One client's visit statistics — `clientStats/{uid}`, a projection the
 * server keeps (R33) and nobody else writes.
 *
 * A one-shot read, not a stream: the numbers move when a visit settles, not
 * while someone looks at a client, and a promise through the persistent
 * cache opens the page offline with the last answer instead of a spinner.
 * Windows ("last 90 days") are computed by the reader with `statWindows`
 * at its own now — the stored document holds instants, never windowed counts.
 *
 * `null` is a client with no visit on record yet (or a guest, who has no
 * account and so no stats), which is an ordinary answer, not an error.
 */
export interface ClientStatsReader {
  get(
    userId: string,
  ): Promise<Result<ClientStatsRecord | null, RepositoryError>>;
  /**
   * Lifetime spend — `restricted/money`, the shop admin's alone. Anyone else
   * is refused by the rules, which surfaces here as a failed `Result`; callers
   * gate on the role rather than probing.
   */
  getMoney(
    userId: string,
  ): Promise<Result<ClientMoneyRecord | null, RepositoryError>>;
}

export const CLIENT_STATS_READER = new InjectionToken<ClientStatsReader>(
  'ClientStatsReader',
);
