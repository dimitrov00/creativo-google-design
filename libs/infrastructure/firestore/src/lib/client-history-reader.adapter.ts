import { Injectable, inject } from '@angular/core';
import {
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type Appointment,
  type ClientHistoryPage,
  type ClientHistoryReader,
  appointmentFromDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { PageStep, PagingSystem } from '@core/systems';
import { appointmentsCollection } from './firestore-paths';

type Snapshot = QueryDocumentSnapshot<DocumentData>;

/**
 * One person's visits, a page at a time: `appointments` where
 * `subjectUserIds` holds them — the mirror every write keeps, so a visit
 * they came to as company is theirs too — ordered by the stored start,
 * newest first, on the existing `(subjectUserIds CONTAINS, timeSlot.startIso
 * DESC)` index. The book reads every appointment (`worksTheBook()`), so the
 * query needs no owner filter.
 *
 * The cursor is the stored `timeSlot.startIso` of a page's oldest visit.
 * One extra document is read to know whether anything older is left; when
 * that extra one starts at the same instant as the page's last, the page
 * takes that whole instant (a visit cancelled and booked again for the same
 * minute is two appointments) and one more read says whether anything
 * older remains — the page never splits an instant the cursor could not
 * resume inside.
 *
 * Flatten pass (§3.8, §3.9): `PagingSystem`'s key is generic and opaque, so
 * this legacy reader keeps paging on the stored `timeSlot.startIso` string
 * (the frozen body and index) and narrows on `pageStep`. The typed cursor,
 * `beforeUtcMs: UtcEpochMs` on the `PageClientHistory` port, is this
 * shim's to convert when the booking-core flip (1) moves the query onto the
 * flat `utcEpochMs` field: `ZonedTimeSystem.parseOffsetIso(startIso)` reads
 * a stored start as the instant, `ZonedTimeSystem.toIso(utcMs, timeZone)`
 * writes it back — until then the wire and the cursor stay the ISO text.
 */
@Injectable()
export class FirestoreClientHistoryReader implements ClientHistoryReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async pageForSubject(
    userId: string,
    page: { readonly beforeIso: string | null; readonly limit: number },
  ): Promise<Result<ClientHistoryPage, RepositoryError>> {
    const subject = UserId.create(userId);
    if (subject.isFailure())
      return ok({ appointments: [], nextBeforeIso: null });
    const size = PagingSystem.pageSize(page.limit);
    const theirs = where(
      'subjectUserIds',
      'array-contains',
      subject.value.value,
    );
    try {
      const read = await this.newestFirst(
        theirs,
        page.beforeIso === null
          ? []
          : [where('timeSlot.startIso', '<', page.beforeIso)],
        size + 1,
      );
      // The same-instant boundary rule is `PagingSystem`'s: a page never
      // ends between two visits sharing one start.
      const step = PagingSystem.nextCursor(read, size, startIsoOf);
      if (step.pageStep === PageStep.Page) {
        return ok({
          appointments: parsed(step.rows),
          nextBeforeIso: step.cursor,
        });
      }
      const boundary = step.boundary;
      const [sameInstant, older] = await Promise.all([
        getDocs(
          query(
            appointmentsCollection(this.db),
            theirs,
            where('timeSlot.startIso', '==', boundary),
          ),
        ),
        this.newestFirst(
          theirs,
          [where('timeSlot.startIso', '<', boundary)],
          1,
        ),
      ]);
      const whole = PagingSystem.sameInstantBoundary(
        step.newer,
        sameInstant.docs,
        idOf,
        older.length > 0,
        boundary,
      );
      return ok({
        appointments: parsed(whole.rows),
        nextBeforeIso: whole.cursor,
      });
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the client history', error),
      );
    }
  }

  private async newestFirst(
    theirs: QueryConstraint,
    before: readonly QueryConstraint[],
    max: number,
  ): Promise<readonly Snapshot[]> {
    const snapshot = await getDocs(
      query(
        appointmentsCollection(this.db),
        theirs,
        ...before,
        orderBy('timeSlot.startIso', 'desc'),
        limit(max),
      ),
    );
    return snapshot.docs;
  }
}

/** The start as the book stored it — what the query ordered and the cursor compares. */
function startIsoOf(entry: Snapshot | undefined): string {
  const slot: unknown = entry?.get('timeSlot.startIso');
  return typeof slot === 'string' ? slot : '';
}

/** A document's id — what orders a tied instant. */
function idOf(entry: Snapshot): string {
  return entry.id;
}

/** Every appointment that parses; one that does not is dropped, never the page. */
function parsed(docs: readonly Snapshot[]): Appointment[] {
  return docs.flatMap((entry) => {
    const result = appointmentFromDocument(entry.id, entry.data());
    return result.isSuccess() ? [result.value] : [];
  });
}
