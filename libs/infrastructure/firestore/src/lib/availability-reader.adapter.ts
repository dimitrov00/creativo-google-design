import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import {
  DocumentData,
  DocumentReference,
  onSnapshot,
} from 'firebase/firestore';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  LocationDayHours,
  LocationId,
} from '@creativo/domain/catalog';
import {
  type BarberDayAvailability,
  CalendarDay,
  DateRange,
  Interval,
  type ShiftSegmentProps,
  type ShopDayHours,
  StaffScheduleHistory,
  StaffScheduleVersion,
  WeeklyPattern,
  type WeeklyPatternProps,
  buildDayWindows,
  shopDayHours,
  windowsAt,
} from '@creativo/domain/scheduling';
import { AvailabilityReader } from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  barberBusyDocRef,
  barberScheduleDocRef,
  locationsCollection,
} from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * What one barber's roster document holds, once parsed.
 *
 * `turnaroundMinutes` lives on the SCHEDULE rather than on each busy block so
 * that changing a barber's reset time takes effect immediately instead of
 * only for bookings written afterwards.
 */
interface ParsedSchedule {
  readonly history: StaffScheduleHistory;
  readonly turnaroundMinutes: number;
}

/**
 * Firestore doc → `WeeklyPatternProps`.
 *
 * Each weekday holds `[{start, end, locationId}]` — the location rides on the
 * SEGMENT, because a barber covers Center on Monday and Mladost on Tuesday,
 * and may cover both in one day. (Firestore also forbids directly-nested
 * arrays, so a map per segment is the only shape available anyway.)
 *
 * This function and `tools/seed-dev-catalog.mjs`'s `toStoredPattern` are the
 * only two places that know the persisted shape.
 */
function toPatternProps(raw: unknown): WeeklyPatternProps {
  const byWeekday: Record<string, readonly ShiftSegmentProps[]> = {};
  for (const [weekday, segments] of Object.entries(
    (raw ?? {}) as Record<string, unknown>,
  )) {
    if (!Array.isArray(segments)) continue;
    byWeekday[weekday] = (segments as DocumentData[]).map((segment) => ({
      start: String(segment['start']),
      end: String(segment['end']),
      locationId: String(segment['locationId'] ?? ''),
    }));
  }
  return { byWeekday: byWeekday as WeeklyPatternProps['byWeekday'] };
}

/**
 * A roster document that does not parse yields `null`, and a `null` roster
 * means that barber offers nothing. Deliberately fail-closed: the alternative
 * — treating an unreadable roster as "unrestricted" — would offer clients
 * times nobody is rostered for.
 */
function toSchedule(data: DocumentData, zone: string): ParsedSchedule | null {
  const versions: StaffScheduleVersion[] = [];
  for (const raw of (data['versions'] ?? []) as DocumentData[]) {
    const from = CalendarDay.create(String(raw['effectiveFrom'] ?? ''), zone);
    if (from.isFailure()) return null;

    const to =
      raw['effectiveTo'] == null
        ? null
        : CalendarDay.create(String(raw['effectiveTo']), zone);
    if (to !== null && to.isFailure()) return null;

    const pattern = WeeklyPattern.create(toPatternProps(raw['weeklyPattern']));
    if (pattern.isFailure()) return null;

    versions.push(
      StaffScheduleVersion.of({
        seq: Number(raw['seq'] ?? 0),
        effectiveFrom: from.value,
        effectiveTo: to === null ? null : to.value,
        pattern: pattern.value,
      }),
    );
  }

  const history = StaffScheduleHistory.create(versions);
  if (history.isFailure()) return null;

  const turnaround = Number(data['turnaroundMinutes'] ?? 0);
  return {
    history: history.value,
    turnaroundMinutes:
      Number.isFinite(turnaround) && turnaround > 0 ? turnaround : 0,
  };
}

/**
 * Stored busy geometry → intervals, PADDED by the barber's turnaround.
 *
 * Padding happens here, at the read boundary, and nowhere else: the engine has
 * no turnaround of its own precisely so it cannot be applied a second time.
 */
function toPaddedBusy(
  data: DocumentData | undefined,
  zone: string,
  turnaroundMinutes: number,
): readonly Interval[] {
  const raw = ((data?.['busy'] ?? []) as DocumentData[]).flatMap((entry) => {
    const start = ZonedDateTime.fromISO(String(entry['startIso'] ?? ''), zone);
    const end = ZonedDateTime.fromISO(String(entry['endIso'] ?? ''), zone);
    if (start.isFailure() || end.isFailure()) return [];
    return [Interval.of(start.value.toMillis(), end.value.toMillis())];
  });
  return Interval.normalize(
    raw.map((interval) =>
      Interval.pad(interval, turnaroundMinutes, turnaroundMinutes),
    ),
  );
}

/**
 * Composes public availability from three PII-free reads: the shop's hours
 * (`locations`), each barber's roster (`barberSchedules`) and the geometry of
 * what is already taken (`barberBusy`).
 *
 * Windows are materialised in the browser by the same pure `buildDayWindows`
 * the commit-time re-check runs, so the grid and the server cannot disagree
 * about what the roster says.
 *
 * None of the three documents contains a client identity, a service, a price
 * or a reason. That is structural, not incidental: Firestore rules cannot
 * redact fields, and `/book` is browsable anonymously, so anything a visitor
 * may read has to live in a document that simply does not hold the secret.
 */
@Injectable()
export class FirestoreAvailabilityReader implements AvailabilityReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  private observeDoc(
    ref: DocumentReference<DocumentData>,
  ): Observable<Result<DocumentData | undefined, RepositoryError>> {
    return subscribeWithRetry<DocumentData | undefined>((onNext, onError) =>
      onSnapshot(ref, (snapshot) => onNext(snapshot.data()), onError),
    );
  }

  /**
   * Every shop's published hours for `day`, keyed by `LocationId.value`.
   *
   * The whole collection, not just the shop being booked: a barber's day can
   * span two shops, and each segment has to be clipped to the hours of the
   * shop it is worked at. Clipping a Mladost afternoon against Center's hours
   * is how a client gets offered a time at a locked door.
   */
  private observeShopHours(
    day: CalendarDay,
  ): Observable<
    Result<ReadonlyMap<string, ShopDayHours | null>, RepositoryError>
  > {
    return subscribeWithRetry<ReadonlyMap<string, ShopDayHours | null>>(
      (onNext, onError) =>
        onSnapshot(
          locationsCollection(this.db),
          (snapshot) => {
            const byLocation = new Map<string, ShopDayHours | null>();
            for (const doc of snapshot.docs) {
              const locationId = LocationId.create(doc.id);
              if (locationId.isFailure()) continue;
              byLocation.set(
                doc.id,
                shopDayHours(
                  day,
                  locationId.value,
                  (doc.data()['hours'] ?? []) as readonly LocationDayHours[],
                ),
              );
            }
            onNext(byLocation);
          },
          onError,
        ),
    );
  }

  observeDay(
    locationId: LocationId | null,
    day: CalendarDay,
    barberIds: readonly BarberId[],
  ): Observable<Result<readonly BarberDayAvailability[], RepositoryError>> {
    if (barberIds.length === 0) {
      return of(ok<readonly BarberDayAvailability[], RepositoryError>([]));
    }

    // Sorted so the engine's barber iteration — and therefore the order of the
    // options it returns — is stable across reads.
    const sorted = [...barberIds].sort((a, b) =>
      a.value.localeCompare(b.value),
    );

    const perBarber = combineLatest(
      sorted.map((barberId) =>
        combineLatest([
          this.observeDoc(barberScheduleDocRef(this.db, barberId)),
          this.observeDoc(barberBusyDocRef(this.db, barberId, day.key())),
        ]),
      ),
    );

    return combineLatest([this.observeShopHours(day), perBarber]).pipe(
      map(([hoursResult, barberResults]) => {
        if (hoursResult.isFailure()) {
          return fail<readonly BarberDayAvailability[], RepositoryError>(
            hoursResult.error,
          );
        }

        const days: BarberDayAvailability[] = [];
        for (const [
          index,
          [scheduleResult, busyResult],
        ] of barberResults.entries()) {
          // One barber's read failing is the whole day failing: quietly
          // dropping them would render a grid that looks complete while
          // hiding someone's free time.
          if (scheduleResult.isFailure()) {
            return fail<readonly BarberDayAvailability[], RepositoryError>(
              scheduleResult.error,
            );
          }
          if (busyResult.isFailure()) {
            return fail<readonly BarberDayAvailability[], RepositoryError>(
              busyResult.error,
            );
          }

          const barberId = sorted.at(index) as BarberId;
          const scheduleDoc = scheduleResult.value;
          if (!scheduleDoc) continue;

          const parsed = toSchedule(scheduleDoc, day.zone);
          if (!parsed) continue;

          const allWindows = buildDayWindows({
            day,
            schedule: parsed.history,
            // Per-day exceptions arrive with the staff editor; until then a
            // barber with none works their pattern.
            exceptions: [],
            shopHours: hoursResult.value,
          });

          // Narrow to the shop being booked. `null` means the client has not
          // chosen one ("any shop"), and every window stays a candidate — the
          // use-case then runs the engine per shop, because one appointment
          // cannot be split across two.
          const windows = locationId
            ? windowsAt(allWindows, locationId)
            : allWindows;
          if (windows.length === 0) continue;

          days.push({
            barberId,
            windows,
            // Busy is location-AGNOSTIC on purpose: a barber booked at the
            // other shop is not free here either, and their padded block has
            // to keep blocking whichever shop is being asked about.
            busy: toPaddedBusy(
              busyResult.value,
              day.zone,
              parsed.turnaroundMinutes,
            ),
          });
        }
        return ok<readonly BarberDayAvailability[], RepositoryError>(days);
      }),
    );
  }

  observeRangeCapacity(
    locationId: LocationId | null,
    range: DateRange,
    barberIds: readonly BarberId[],
  ): Observable<Result<ReadonlyMap<string, number>, RepositoryError>> {
    const days = range.days();
    if (days.length === 0 || barberIds.length === 0) {
      return of(ok<ReadonlyMap<string, number>, RepositoryError>(new Map()));
    }

    return combineLatest(
      days.map((day) =>
        this.observeDay(locationId, day, barberIds).pipe(
          map((result) => {
            // A day that fails to load reads as "nothing free" rather than
            // failing the whole month: one unreadable roster should dim one
            // calendar cell, not blank the grid.
            if (result.isFailure()) return [day.key(), 0] as const;
            const freeMinutes = result.value.reduce(
              (total, entry) =>
                total +
                Interval.totalMinutes(
                  Interval.subtract(
                    entry.windows.map((window) => window.interval),
                    entry.busy,
                  ),
                ),
              0,
            );
            return [day.key(), freeMinutes] as const;
          }),
        ),
      ),
    ).pipe(
      map((entries) =>
        ok<ReadonlyMap<string, number>, RepositoryError>(new Map(entries)),
      ),
    );
  }
}
