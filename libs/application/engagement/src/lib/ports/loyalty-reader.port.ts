import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import type {
  BadgeProgress,
  LedgerEntry,
  LoyaltyAccount,
  SeasonProgress,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * One client's loyalty — the account, the families they started, their
 * seasons' tracks and the tail of their points ledger (client-card-redesign
 * §6.1). Server-written projections the book reads and nobody here writes.
 *
 * One-shot reads, not streams: the figures move when a visit settles, not
 * while someone looks at a client, and a promise through the persistent
 * cache opens the card offline with the last answer instead of a spinner
 * (the `ClientStatsReader` precedent). Every method takes the client's uid.
 */
export interface LoyaltyReader {
  /** `null` = no account yet — an ordinary answer (no visit, or a guest), not an error. */
  getAccount(
    userId: string,
  ): Promise<Result<LoyaltyAccount | null, RepositoryError>>;
  /** The families the client started; a family missing here is not started. Any order. */
  listBadgeProgress(
    userId: string,
  ): Promise<Result<readonly BadgeProgress[], RepositoryError>>;
  /** A track per season the client took part in. Any order. */
  listSeasonProgress(
    userId: string,
  ): Promise<Result<readonly SeasonProgress[], RepositoryError>>;
  /** The newest `limit` client-visible point rows, newest first. */
  listLedgerTail(
    userId: string,
    limit: number,
  ): Promise<Result<readonly LedgerEntry[], RepositoryError>>;
}

export const LOYALTY_READER = new InjectionToken<LoyaltyReader>(
  'LoyaltyReader',
);
