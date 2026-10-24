import { type Observable, combineLatest, map, of } from 'rxjs';
import type { CapacityStreamPorts, ShopDayStreamPorts } from '@core/ports';
import type { ShopLocation } from '@core/entities';
import type { CapacityEntry } from '@core/components';
import { BusyKey, type CapacityMonthId, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { BarberDayDocs, DayDocs, DayDocsKey } from '@core/systems';

/*
 * ONE SHOP DAY'S RAW STREAMS — the impure half of the booking grid (moved
 * from `features/client/booking` `day-availability.ts`, Law 8.4).
 *
 * Availability is never computed behind a port: the day's documents arrive
 * raw from `SCHEDULING_READ_PORTS` — each barber's roster, busy day and
 * schedule exception, and a move's named shop — and the step that shows the
 * grid derives the arrangements in a `computed()` by calling the systems
 * (`BookingCartSystem.dayOptions` over the documents read for
 * `BookingCartSystem.dayDocsKey`). The server's commit runs the same systems
 * over the same documents, so the grid offers what the commit accepts.
 *
 * Observes only: which documents a day reads is decided by
 * `BookingCartSystem.dayDocsKey`; this file turns a key into streams.
 */

/**
 * The day's raw documents, live: per barber the roster, the busy day and the
 * schedule exception (a day off has to grey the sheet, not just the commit),
 * and a move's named shop. One read failing is the whole day failing:
 * quietly dropping a barber would render a grid that looks complete while
 * hiding someone's free time.
 */
export function observeDayDocs(
  ports: ShopDayStreamPorts,
  key: DayDocsKey,
): Observable<Result<DayDocs, RepositoryError>> {
  const perBarber: Observable<Result<BarberDayDocs, RepositoryError>>[] =
    key.barberIds.map((barberId) => {
      const busyKey = BusyKey.of(barberId, key.localDate);
      return combineLatest([
        ports.observeSchedule(barberId),
        ports.observeBusyDay(busyKey),
        ports.observeExceptions(busyKey),
      ]).pipe(
        map(([schedule, busy, exception]) => {
          if (!schedule.ok) return schedule;
          if (!busy.ok) return busy;
          if (!exception.ok) return exception;
          return Result.ok({
            barberId,
            schedule: schedule.value,
            busy: busy.value,
            exception: exception.value,
          });
        }),
      );
    });
  const barbers$: Observable<
    Result<readonly BarberDayDocs[], RepositoryError>
  > =
    perBarber.length === 0
      ? of(Result.ok([]))
      : combineLatest(perBarber).pipe(
          map((results) => {
            const barbers: BarberDayDocs[] = [];
            for (const result of results) {
              if (!result.ok) return result;
              barbers.push(result.value);
            }
            return Result.ok(barbers);
          }),
        );
  const named$: Observable<Result<ShopLocation | null, RepositoryError>> =
    key.namedLocationId === null
      ? of(Result.ok(null))
      : ports.observeLocation(key.namedLocationId);
  return combineLatest([barbers$, named$]).pipe(
    map(([barbers, named]) => {
      if (!barbers.ok) return barbers;
      if (!named.ok) return named;
      return Result.ok({
        key,
        barbers: barbers.value,
        namedLocation: named.value,
      });
    }),
  );
}

/** The month documents' entries, live, in one list — `null` months (never rebuilt) hold nothing. */
export function observeCapacityEntries(
  ports: CapacityStreamPorts,
  months: readonly CapacityMonthId[],
): Observable<Result<readonly CapacityEntry[], RepositoryError>> {
  if (months.length === 0) return of(Result.ok([]));
  return combineLatest(
    months.map((month) => ports.observeCapacityMonth(month)),
  ).pipe(
    map((results) => {
      const entries: CapacityEntry[] = [];
      for (const result of results) {
        if (!result.ok) return result;
        if (result.value !== null) entries.push(...result.value.entries);
      }
      return Result.ok(entries);
    }),
  );
}
