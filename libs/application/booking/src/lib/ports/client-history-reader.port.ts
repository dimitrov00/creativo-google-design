import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import type { Appointment } from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

/** One page of a person's visits, newest first, and where the next one starts. */
export interface ClientHistoryPage {
  readonly appointments: readonly Appointment[];
  /**
   * The cursor for the next page: the start of this page's oldest visit, as
   * the book stores it (`timeSlot.startIso`). `null` = nothing older.
   */
  readonly nextBeforeIso: string | null;
}

/**
 * ONE PERSON'S VISITS, as the staff card's history reads them (client-card-
 * redesign §6.1): every appointment with a seat for them — the ones they
 * booked and the ones they came to as someone's company — newest first, a
 * page at a time. The owner's own list (`observeHistoryFor`) cannot answer
 * this: it keys on who booked, and a companion never did.
 *
 * Every appointment is returned whole, upcoming and cancelled ones
 * included; whose story a row tells is the reader's (`subjectVisitOf`).
 * A page may run past `limit` to keep visits that start at the same instant
 * together: the cursor is an instant, so a page never splits them. A
 * document that does not parse is left out rather than costing the page.
 */
export interface ClientHistoryReader {
  pageForSubject(
    userId: string,
    page: { readonly beforeIso: string | null; readonly limit: number },
  ): Promise<Result<ClientHistoryPage, RepositoryError>>;
}

export const CLIENT_HISTORY_READER = new InjectionToken<ClientHistoryReader>(
  'ClientHistoryReader',
);
