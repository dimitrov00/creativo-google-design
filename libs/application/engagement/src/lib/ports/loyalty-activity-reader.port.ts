import { InjectionToken } from '@angular/core';
import type { Result } from '@creativo/domain/kernel';
import type { ActivityEntry, ActivityKind } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/** Which rows, how many, and from where. */
export interface LoyaltyActivityQuery {
  /** The pill: `all`, or one of the feed's three kinds (`ACTIVITY_EFFECT_KINDS` says which effects each holds). */
  readonly kind: ActivityKind;
  /** How many rows at most; a page may hold fewer only when nothing older is left. */
  readonly limit: number;
  /** The `next` of the page before: rows OLDER than this `seq`. `null` = from the newest. */
  readonly after: number | null;
}

/** One page of the feed, newest first, and where the next one starts. */
export interface LoyaltyActivityPage {
  readonly entries: readonly ActivityEntry[];
  /**
   * The cursor for the next page: the `seq` of this page's oldest row.
   * `null` = nothing older is left under this pill.
   */
  readonly next: number | null;
}

/**
 * ONE CLIENT'S ACTIVITY, «Движение» (client-card-revision-3.md §4.7): the
 * ledger widened past points. Every client-visible row of the journal that
 * moved points, granted or took back a reward, redeemed one, changed the
 * tier or earned a medal, newest first, a page at a time. What is never in
 * the feed is never read: the rhythm's own rows, protections, pauses and
 * corrected outcomes.
 *
 * Rows are handed over ONE PER JOURNAL ENTRY. A visit's seats, a level
 * and its bonus, a redemption and its grant are several entries of one
 * event (`correlationId`); folding them into a row is the reader's
 * (`foldByEvent`), and because a page may end inside an event, so is
 * holding the last event of a page back until the next one confirms it.
 *
 * `LoyaltyReader.listLedgerTail` stays beside it for whoever still reads
 * point rows alone.
 */
export interface LoyaltyActivityReader {
  page(
    userId: string,
    query: LoyaltyActivityQuery,
  ): Promise<Result<LoyaltyActivityPage, RepositoryError>>;
}

export const LOYALTY_ACTIVITY_READER =
  new InjectionToken<LoyaltyActivityReader>('LoyaltyActivityReader');
