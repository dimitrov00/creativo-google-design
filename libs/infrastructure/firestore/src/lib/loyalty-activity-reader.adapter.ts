import { Injectable, inject } from '@angular/core';
import {
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  ACTIVITY_EFFECT_KINDS,
  type ActivityEntry,
  type ActivityKind,
  type LoyaltyActivityPage,
  type LoyaltyActivityQuery,
  type LoyaltyActivityReader,
  activityEntryFromDocument,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { PageStep, PagingSystem } from '@creativo/ecs-core';
import { clientJournalCollection } from './firestore-paths';

const NOTHING: LoyaltyActivityPage = { entries: [], next: null };

/**
 * ONE CLIENT'S ACTIVITY, «Движение», a page at a time, out of
 * `clientJournal` (client-card-revision-3.md §4.7).
 *
 * THE QUERY. `userId ==`, `visibility == 'client'`, the pill's effects
 * (`ACTIVITY_EFFECT_KINDS`: one is an equality, several an `in`), newest
 * first by `seq`, older than the cursor. Every pill, «Всички» included,
 * is served by the ONE composite index the ledger already has,
 * `clientJournal (userId, visibility, effect.kind, seq DESC)`: an `in` is
 * a union of equalities over it. The `visibility` filter is also what the
 * rule demands: a query that could return a staff row is refused whole.
 * The rhythm's rows, protections, pauses and corrected outcomes are in no
 * pill's list, so they are never read.
 *
 * THE PAGE. One row more than asked is read, and never handed over: it is
 * how the page knows that something older is left, so `next` is a cursor
 * only while it leads somewhere. The cursor is the `seq` of the oldest
 * row the page READ. A row that does not parse is left out rather than
 * costing the client the page, and the cursor still moves past it.
 *
 * Rows are handed over one per journal entry; folding the entries of one
 * event into a row is the presenter's (`foldByEvent`).
 */
@Injectable()
export class FirestoreLoyaltyActivityReader implements LoyaltyActivityReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async page(
    userId: string,
    asked: LoyaltyActivityQuery,
  ): Promise<Result<LoyaltyActivityPage, RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure()) return ok(NOTHING);
    const effects = effectsOf(asked.kind);
    if (effects === null) {
      // A pill nobody knows is never read as «Всички».
      return fail(
        new RepositoryError(`Unknown activity kind: ${String(asked.kind)}`),
      );
    }
    const size = atLeastOne(asked.limit);
    try {
      const snapshot = await getDocs(
        query(
          clientJournalCollection(this.db),
          where('userId', '==', subject.value.value),
          where('visibility', '==', 'client'),
          effects,
          orderBy('seq', 'desc'),
          ...olderThan(asked.after),
          limit(size + 1),
        ),
      );
      // The size + 1 read cut (`PagingSystem.nextCursor`): the extra row
      // says whether anything older is left, and the cursor is the page's
      // oldest `seq`. `seq` is unique, so a page never ends inside a tie.
      const step = PagingSystem.nextCursor(snapshot.docs, size, seqOf);
      const read =
        step.pageStep === PageStep.Page
          ? step.rows
          : snapshot.docs.slice(0, size);
      return ok({
        entries: parsed(read),
        next:
          step.pageStep === PageStep.Page
            ? step.cursor === null
              ? null
              : oldestSeqOf(read)
            : oldestSeqOf(read),
      });
    } catch (error) {
      return fail(new RepositoryError('Failed to read the activity', error));
    }
  }
}

const EFFECTS_BY_PILL: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(ACTIVITY_EFFECT_KINDS),
);

/**
 * The pill as a filter: one effect is an equality, several are an `in`.
 * `null` for a pill the table does not hold.
 */
function effectsOf(kind: ActivityKind): QueryConstraint | null {
  const [only, ...others] = EFFECTS_BY_PILL.get(kind) ?? [];
  if (only === undefined) return null;
  return others.length === 0
    ? where('effect.kind', '==', only)
    : where('effect.kind', 'in', [only, ...others]);
}

/** Rows older than the cursor; from the newest when there is none. */
function olderThan(after: number | null): QueryConstraint[] {
  return after !== null && Number.isFinite(after) ? [startAfter(after)] : [];
}

/** Every row that parses, in the order read; one that does not is left out. */
function parsed(
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
): ActivityEntry[] {
  return docs.flatMap((entry) => {
    const row = activityEntryFromDocument(entry.id, entry.data());
    return row.isSuccess() ? [row.value] : [];
  });
}

/**
 * Where the next page starts: the `seq` of the oldest row this page read,
 * off the document itself, so a row that did not parse still moves the
 * cursor. `null` when that row has no sequence to continue from: the walk
 * ends rather than read the same page again.
 */
function oldestSeqOf(
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
): number | null {
  const seq: unknown = docs[docs.length - 1]?.data()['seq'];
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}

/** A whole count of at least one, whatever was asked (`PagingSystem.pageSize`; a non-number is one). */
function atLeastOne(raw: number): number {
  return Number.isFinite(raw) ? PagingSystem.pageSize(raw) : 1;
}

/** A row's `seq` as the page key — `NaN` (never a tie) when it holds none. */
function seqOf(doc: QueryDocumentSnapshot<DocumentData>): number {
  const seq: unknown = doc.data()['seq'];
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : Number.NaN;
}
