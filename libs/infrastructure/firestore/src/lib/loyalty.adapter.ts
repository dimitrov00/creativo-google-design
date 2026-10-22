import {
  type Firestore,
  type QueryConstraint,
  collection,
  doc,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { JournalVisibility } from '@core/components';
import { Result } from '@core/primitives';
import {
  type BadgeProgress,
  Collections,
  type JournalEntry,
  type LoyaltyAccount,
  type SeasonProgress,
  Subcollections,
} from '@core/entities';
import type {
  ClientJournalPorts,
  JournalPage,
  LoyaltyAccountReadPorts,
} from '@core/ports';
import { PageStep, PagingSystem } from '@core/systems';
import { readDoc, readQuery } from './observe';

/**
 * A client RECORD's loyalty, read side (flip 3, plan §3.4) — the successor
 * of the legacy loyalty reader, WITHOUT its mappers: `loyaltyAccounts/
 * {customerId}` and its `badgeProgress` / `seasonProgress` subcollections,
 * keyed by the client record (D29), every body answered AS STORED (Law 5,
 * F3-1 (b)): `{ id, ...snap.data() }` and nothing else. Whether a stored
 * body is sound is its writer's to guarantee (the seed builds the entity
 * type), never this reader's to repair or to drop.
 *
 * `getDoc` / `getDocs` go to the server and fall back to the persistent
 * cache when the network is gone, so a barber offline in the chair still
 * sees the last figures. Every read is the book's (`worksTheBook()`).
 */
export const loyaltyAccountReadPorts = (
  db: Firestore,
): LoyaltyAccountReadPorts => ({
  loadLoyaltyAccount: (customerId) =>
    readDoc<LoyaltyAccount>(doc(db, Collections.LoyaltyAccounts, customerId)),

  listBadgeProgress: (customerId) => {
    const path = `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.BadgeProgress}`;
    return readQuery<BadgeProgress>(collection(db, path), path);
  },

  listSeasonProgress: (customerId) => {
    const path = `${Collections.LoyaltyAccounts}/${customerId}/${Subcollections.SeasonProgress}`;
    return readQuery<SeasonProgress>(collection(db, path), path);
  },
});

/** The page of no rows: nothing to read, nothing older. */
const NOTHING: JournalPage = { entries: [], nextBeforeSeq: null };

/** A whole count of at least one, whatever was asked (`PagingSystem.pageSize`; a non-number is one). */
function pageSizeOf(raw: number): number {
  return Number.isFinite(raw) ? PagingSystem.pageSize(raw) : 1;
}

/** A row's place in the feed — its `seq`, unique per client record. */
const seqOf = (entry: JournalEntry): number => entry.seq;

/**
 * ONE CLIENT RECORD'S JOURNAL, «Движение» and the ledger, a page at a time
 * (client-card-revision-3.md §4.7; flip 3, plan §3.1.1).
 *
 * THE QUERY. `customerId ==`, `journalVisibility == CLIENT`, the pill's
 * effects (`JournalFeed.effectsOf`: one is an equality, several an `in`),
 * newest first by `seq`, older than the cursor. Every pill is served by
 * the ONE composite index #21 (`customerId`, `journalVisibility`,
 * `journalEffect`, `seq` desc): an `in` is a union of equalities over it.
 * The `journalVisibility` filter is also what the rule demands: a query
 * that could return a staff row is refused whole. No effects, no rows: an
 * empty list is answered without a read (the SDK refuses an empty `in`).
 *
 * THE PAGE. One row more than asked is read, and never handed over: it is
 * how the page knows that something older is left, so `nextBeforeSeq` is
 * a cursor only while it leads somewhere (`PagingSystem.nextCursor`). The
 * cursor is the `seq` of the page's oldest row. Rows are answered as
 * stored, one per journal entry; folding one event's entries into a row is
 * the presenter's.
 */
export const clientJournalPorts = (db: Firestore): ClientJournalPorts => ({
  pageClientJournal: async (customerId, effects, beforeSeq, max) => {
    const [only, ...others] = effects;
    if (only === undefined) return Result.ok(NOTHING);
    const size = pageSizeOf(max);
    const olderThan: QueryConstraint[] =
      beforeSeq === null ? [] : [startAfter(beforeSeq)];
    const read = await readQuery<JournalEntry>(
      query(
        collection(db, Collections.ClientJournal),
        where('customerId', '==', customerId),
        where('journalVisibility', '==', JournalVisibility.Client),
        others.length === 0
          ? where('journalEffect', '==', only)
          : where('journalEffect', 'in', [only, ...others]),
        orderBy('seq', 'desc'),
        ...olderThan,
        limit(size + 1),
      ),
      Collections.ClientJournal,
    );
    if (!read.ok) return read;
    // The size + 1 read cut: the extra row says whether anything older is
    // left. `seq` is unique per record, so a page never ends inside a tie;
    // should two rows ever share one, the page is cut at its size anyway
    // and resumes below its oldest row.
    const step = PagingSystem.nextCursor(read.value, size, seqOf);
    return Result.ok(
      step.pageStep === PageStep.Page
        ? { entries: step.rows, nextBeforeSeq: step.cursor }
        : { entries: read.value.slice(0, size), nextBeforeSeq: step.boundary },
    );
  },
});
