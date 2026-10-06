import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  BarberDayAvailability,
  CalendarDay,
  type ChairTime,
  DateRange,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

/**
 * Live availability for the booking grid.
 *
 * Returns each eligible barber's **windows and busy intervals** — not slots.
 * A bookable start depends on the duration being booked, and duration here is
 * `Service.termsFor(barber, variant)`, so slots cannot be stored without going
 * stale on every catalog edit. The pure engine (`availableOptions`) turns
 * these intervals into starts at query time, using the duration the caller
 * actually wants.
 *
 * Everything this returns is PII-free by construction: geometry only, no
 * reasons, no client identities. That is a hard requirement, not an
 * optimisation — `/book` is browsable anonymously and Firestore rules cannot
 * redact fields, so whatever a visitor may read has to live in a document
 * that simply does not contain the secret.
 */
export interface AvailabilityReader {
  /**
   * One day's geometry for every barber who could serve this location.
   *
   * `locationId` is nullable because choosing a shop is OPTIONAL — "any shop"
   * is a legitimate answer, and often the right one when a client is
   * optimising for time rather than place. `null` keeps every rostered window
   * a candidate; the use-case then runs the engine once per shop, because one
   * appointment cannot be split across two.
   *
   * `release` is the chair time of a visit being MOVED
   * (`Appointment.chairTimes`). It is handed back from each barber's stored
   * spans BEFORE they are padded by turnaround, which is exactly the view
   * the server decides a move against. Each barber's `busy` is
   * `paddedBusy` (domain) of their stored spans, this barber's turnaround and
   * `release`: one rule, shared with `decideBooking`. Absent or empty ⇒
   * nothing is released, the ordinary booking.
   *
   * The compiler cannot hold an implementation to this (one that declares
   * fewer parameters still type-checks), so the contract is executable:
   * every implementation that reads stored spans runs
   * `availabilityReaderBusyCases` in its spec.
   */
  observeDay(
    locationId: LocationId | null,
    day: CalendarDay,
    barberIds: readonly BarberId[],
    release?: readonly ChairTime[],
  ): Observable<Result<readonly BarberDayAvailability[], RepositoryError>>;

  /**
   * Per-day free-minute totals across a range — feeds the calendar's markers.
   *
   * Deliberately a coarse number rather than full option sets: a month of
   * arrangements is a payload nobody needs, and "does this day have anything
   * at all" is all a calendar dot has to answer.
   */
  observeRangeCapacity(
    locationId: LocationId | null,
    range: DateRange,
    barberIds: readonly BarberId[],
  ): Observable<Result<ReadonlyMap<string, number>, RepositoryError>>;
}

export const AVAILABILITY_READER = new InjectionToken<AvailabilityReader>(
  'AvailabilityReader',
);
