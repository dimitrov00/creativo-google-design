import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { LocalTimeRange, ScheduleException } from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

/**
 * Staff's pen on the roster — blocking a chair, or standing it down for a day.
 *
 * ### Why this is a direct write and not a callable
 * Unlike `appointments`, which is `create`-denied for everyone because a
 * direct write updates no projection and double-books by construction, an
 * exception has no such hazard: it only ever REMOVES sellable time or
 * restates a day's hours, and `rebuildCapacityOnExceptionChange` already
 * reacts to the document. `firestore.rules` grants `write: if isStaff()` on
 * the collection, so the trust boundary is the rule, not a function.
 *
 * ### What reaches storage is the EFFECT, never the reason
 * `exceptionToDocument` is the sanitizer and the compiler enforces its
 * totality. A `sick` day and a holiday are the same public document by
 * construction — `/book` is browsable anonymously against documents rules
 * cannot redact, so the only safe design is one where the secret is absent
 * rather than merely unreadable.
 */
export interface ScheduleExceptionWriter {
  /**
   * Write (or overwrite) one barber's exception for one day.
   *
   * Idempotent by document id — `{barberId}__{dayKey}` — so blocking the same
   * afternoon twice is one document, not two conflicting ones. That id shape
   * is also what makes the rebuild trigger's reverse index work.
   */
  put(exception: ScheduleException): Promise<Result<void, RepositoryError>>;

  /**
   * ONE MORE BLOCK on a day that may already hold some (2026-09-08). `put`
   * replaces the day's one document whole — right for an absence, wrong for
   * a second lunch, which silently overwrote the first. This reads the day,
   * merges the range into what is there (coalescing overlaps) and writes the
   * union. A whole-day absence already on the day swallows the range.
   */
  putRange(
    barberId: string,
    locationId: string,
    dayKey: string,
    zone: string,
    range: LocalTimeRange,
  ): Promise<Result<void, RepositoryError>>;

  /** Lift ONE range; the document goes when its last range does. */
  clearRange(
    barberId: string,
    dayKey: string,
    range: LocalTimeRange,
  ): Promise<Result<void, RepositoryError>>;

  /** Lift an exception — the chair returns to its ordinary roster. */
  clear(
    barberId: string,
    dayKey: string,
  ): Promise<Result<void, RepositoryError>>;
}

export const SCHEDULE_EXCEPTION_WRITER =
  new InjectionToken<ScheduleExceptionWriter>('ScheduleExceptionWriter');
