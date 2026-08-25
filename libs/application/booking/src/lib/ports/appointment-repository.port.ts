import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Appointment, AppointmentId } from '@creativo/domain/scheduling';
import { BarberId } from '@creativo/domain/catalog';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface AppointmentRepository {
  findById(
    id: AppointmentId,
  ): Promise<Result<Appointment | null, RepositoryError>>;
  save(appointment: Appointment): Promise<Result<void, RepositoryError>>;
  /** Live upcoming appointments for a user across every seat they appear in (as `self`, `companion`, or booking `client`s see their own bookings only via `self`). */
  observeUpcomingFor(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;

  /**
   * Live PAST visits, newest first — everything the upcoming query filters
   * out: a start that has already been and gone, and anything terminal
   * (cancelled, completed, no-show) whatever its start.
   *
   * BOUNDED by `limit`, and deliberately so: "my history" grows without end
   * and a screen that reads all of it pays for every visit a loyal client
   * ever made, on every mount. The newest N is what a person scrolls.
   */
  observeHistoryFor(
    userId: UserId,
    limit: number,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;

  /**
   * Live: everything on ONE barber's chair for ONE day, every status —
   * the staff day sheet's read. Runs on the `busyKeys` mirror
   * (`{barberId}__{dayKey}`), the same key the rebuild trigger queries by,
   * so it needs no new index and cannot disagree with the projection about
   * which day an appointment belongs to. Rules allow it for staff only.
   */
  observeBarberDay(
    barberId: BarberId,
    dayKey: string,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;

  /**
   * A bounded window of the shop's book each side of `nowIso`, newest-past
   * and soonest-future — what a staff search reads.
   *
   * ### Why a window and not a query
   * Firestore cannot substring-match, and "find Георги" has to look at the
   * client's name, phone, email, the note and the service — five fields, four
   * of them on a nested `seats` array. Any index that answered that would be
   * one index per field and still could not do "contains". So the honest
   * shape is: read a BOUNDED slice the shop plausibly cares about and match
   * it in memory. A 3–5 chair shop books ~40 a day; `limit` each side keeps
   * this a few hundred documents, not a table scan that grows forever.
   *
   * ### One-shot, not live
   * A search is a question asked and answered. Keeping it subscribed would
   * hold a second listener over the whole book for as long as the field has
   * text in it, and the schedule's own lanes are already live.
   *
   * Ordered by the party's start: DESC for the past half, ASC for the
   * future half, so `limit` truncates the far edges rather than the middle.
   */
  searchWindow(
    nowIso: string,
    limit: number,
  ): Promise<Result<readonly Appointment[], RepositoryError>>;
}

export const APPOINTMENT_REPOSITORY = new InjectionToken<AppointmentRepository>(
  'AppointmentRepository',
);
