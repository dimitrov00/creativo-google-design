import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The TEAM's note on a visit — "дължи 5 лв", "не обича да говори", "пита за
 * бръснене следващия път".
 *
 * ⚠ NOT a field on the appointment. The appointment document is readable by
 * its owner (`firestore.rules`, `/appointments`), so a note the shop writes
 * about a client would be read by that client. It lives in a sibling
 * collection that only people who work the book can read or write, keyed by
 * the appointment it is about, and it never rides through
 * `appointmentToDocument` — which is also why the client's own booking note
 * (`contact.note`) and this one are two things that are never merged.
 */
export interface AppointmentNote {
  readonly text: string;
  readonly authorUid: string | null;
  readonly writtenAtIso: string | null;
}

export interface AppointmentNotes {
  /** Live: `null` while there is no note. */
  observe(
    appointmentId: string,
  ): Observable<Result<AppointmentNote | null, RepositoryError>>;
  /** An empty or whitespace text DELETES the note rather than storing "". */
  save(
    appointmentId: string,
    text: string | null,
  ): Promise<Result<void, RepositoryError>>;
}

export const APPOINTMENT_NOTES = new InjectionToken<AppointmentNotes>(
  'AppointmentNotes',
);

/** The one collection, named once — the rules file matches it by this name. */
export const APPOINTMENT_NOTES_COLLECTION = 'appointmentNotes';
