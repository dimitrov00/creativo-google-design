import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import {
  DocumentData,
  DocumentReference,
  onSnapshot,
  query,
  where,
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
  type ChairTime,
  DateRange,
  Interval,
  type RosterWindow,
  type ShiftSegmentProps,
  type ShopDayHours,
  StaffScheduleHistory,
  StaffScheduleVersion,
  WeeklyPattern,
  type WeeklyPatternProps,
  buildDayCarveOuts,
  buildDayWindows,
  paddedBusy,
  shopDayHours,
  windowsAt,
} from '@creativo/domain/scheduling';
import {
  AvailabilityReader,
  type CapacityDayEntry,
  capacityMonthKey,
  exceptionFromDocument,
  freeMinutesFor,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  barberBusyDocRef,
  barberScheduleDocRef,
  capacityMonthDocRef,
  locationDocRef,
  locationsCollection,
  scheduleExceptionDocRef,
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
 * Stored busy geometry → the `busy` the port promises: the spans with the
 * moved visit's own chair time handed back, then PADDED by the barber's
 * turnaround — `paddedBusy`, the one rule `decideBooking` checks a
 * placement by, so the grid offers exactly what the server accepts.
 *
 * Padding happens here, at the read boundary, and nowhere else: the engine has
 * no turnaround of its own precisely so it cannot be applied a second time.
 * And the release can only happen here, because only here are the spans
 * still unpadded: released after padding, a neighbour's turnaround would be
 * freed along with the visit.
 */
function toPaddedBusy(
  data: DocumentData | undefined,
  zone: string,
  turnaroundMinutes: number,
  barberId: BarberId,
  release: readonly ChairTime[] | undefined,
): readonly Interval[] {
  const spans = ((data?.['busy'] ?? []) as DocumentData[]).flatMap((entry) => {
    const start = ZonedDateTime.fromISO(String(entry['startIso'] ?? ''), zone);
    const end = ZonedDateTime.fromISO(String(entry['endIso'] ?? ''), zone);
    if (start.isFailure() || end.isFailure()) return [];
    return [Interval.of(start.value.toMillis(), end.value.toMillis())];
  });
  return paddedBusy({ barberId, spans, turnaroundMinutes, release });
}

/**
 * The windows (or carve-outs) worked at a shop the day may offer — one
 * whose hours `observeOfferedShops` holds: a listed shop, or a moved
 * visit's own.
 */
function atOfferedShops(
  windows: readonly RosterWindow[],
  offered: ReadonlyMap<string, ShopDayHours | null>,
): readonly RosterWindow[] {
  return windows.filter((window) => offered.has(window.locationId.value));
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
   * Every LISTED shop's published hours for `day`, keyed by
   * `LocationId.value` — the grid's whole set of shops: a shop missing from
   * it is never offered (`atOfferedShops`), but for a moved visit's own
   * (`observeOfferedShops`).
   *
   * The whole collection, not just the shop being booked: a barber's day can
   * span two shops, and each segment has to be clipped to the hours of the
   * shop it is worked at. Clipping a Mladost afternoon against Center's hours
   * is how a client gets offered a time at a locked door.
   *
   * Listed is the rule the commit takes a new client booking by, and the
   * waitlist's door and the matcher search by (`shopListed` in the
   * functions): the shop's document is there AND its `status` is
   * `active`. The query only narrows what is listened to; each document is
   * still judged by the rule, fail-closed — `hidden`, a status nobody
   * modelled, or none at all is not listed.
   */
  private observeShopHours(
    day: CalendarDay,
  ): Observable<
    Result<ReadonlyMap<string, ShopDayHours | null>, RepositoryError>
  > {
    return subscribeWithRetry<ReadonlyMap<string, ShopDayHours | null>>(
      (onNext, onError) =>
        onSnapshot(
          query(locationsCollection(this.db), where('status', '==', 'active')),
          (snapshot) => {
            const byLocation = new Map<string, ShopDayHours | null>();
            for (const doc of snapshot.docs) {
              if (doc.data()['status'] !== 'active') continue;
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

  /**
   * The shops a day may offer: every LISTED one (`observeShopHours`) — and,
   * for a visit being MOVED at a named shop, that shop too, listed or not.
   *
   * A hidden shop takes no NEW client booking, but a visit already booked
   * there is still moved by its client (team decision 2026-09-26), and the
   * server takes such a move where the visit already is
   * (`FirestoreBookingStore.reschedule`). The move names the visit's own
   * shop and hands back its chairs (`release`), so that pair is what earns
   * the exception: the shop is read by id, whatever its status, and still
   * CLAMPED to its own hours — never offered unbounded. Without it the time
   * sheet of such a move is empty and nobody booked there can move.
   *
   * Only the DAY question: the calendar's other days come from the
   * capacity rollup, which counts listed shops alone
   * (`observeRangeCapacity`, `rebuildBarberCapacity`), so such a move is
   * offered the days the schedule step asks this method about directly —
   * today and the visit's own day.
   *
   * Nothing else changes: "any shop" (`null`) and a new booking (no
   * release) still see listed shops only, a shop with no document is still
   * never offered, and a hidden shop named for a move from ANOTHER shop is
   * refused by the server (`admitsArrival`) — the grid is an offer, the
   * store is the authority.
   */
  private observeOfferedShops(
    locationId: LocationId | null,
    day: CalendarDay,
    release: readonly ChairTime[] | undefined,
  ): Observable<
    Result<ReadonlyMap<string, ShopDayHours | null>, RepositoryError>
  > {
    const listed = this.observeShopHours(day);
    if (locationId === null || (release ?? []).length === 0) return listed;

    return combineLatest([
      listed,
      this.observeDoc(locationDocRef(this.db, locationId)),
    ]).pipe(
      map(([listedResult, namedResult]) => {
        if (listedResult.isFailure()) return listedResult;
        if (namedResult.isFailure()) {
          return fail<
            ReadonlyMap<string, ShopDayHours | null>,
            RepositoryError
          >(namedResult.error);
        }
        const named = namedResult.value;
        if (!named) return listedResult;
        const shops = new Map(listedResult.value);
        shops.set(
          locationId.value,
          shopDayHours(
            day,
            locationId,
            (named['hours'] ?? []) as readonly LocationDayHours[],
          ),
        );
        return ok<ReadonlyMap<string, ShopDayHours | null>, RepositoryError>(
          shops,
        );
      }),
    );
  }

  /**
   * See the port. `release` is the chair time of a visit being MOVED, handed
   * back from each barber's stored spans before their turnaround pads them
   * (`toPaddedBusy`); the port's busy contract
   * (`availabilityReaderBusyCases`) is run against this method in its spec.
   * A move is also offered its own shop when `/book` no longer lists it
   * (`observeOfferedShops`).
   */
  observeDay(
    locationId: LocationId | null,
    day: CalendarDay,
    barberIds: readonly BarberId[],
    release?: readonly ChairTime[],
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
          // The sanitized public exception for this barber-day — a day off
          // has to grey the sheet, not just the commit.
          this.observeDoc(
            scheduleExceptionDocRef(this.db, barberId, day.key()),
          ),
        ]),
      ),
    );

    return combineLatest([
      this.observeOfferedShops(locationId, day, release),
      perBarber,
    ]).pipe(
      map(([hoursResult, barberResults]) => {
        if (hoursResult.isFailure()) {
          return fail<readonly BarberDayAvailability[], RepositoryError>(
            hoursResult.error,
          );
        }

        const days: BarberDayAvailability[] = [];
        for (const [
          index,
          [scheduleResult, busyResult, exceptionResult],
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
          if (exceptionResult.isFailure()) {
            return fail<readonly BarberDayAvailability[], RepositoryError>(
              exceptionResult.error,
            );
          }

          const barberId = sorted.at(index) as BarberId;
          const scheduleDoc = scheduleResult.value;
          if (!scheduleDoc) continue;

          const parsed = toSchedule(scheduleDoc, day.zone);
          if (!parsed) continue;

          const exception = exceptionResult.value
            ? exceptionFromDocument(exceptionResult.value)
            : null;

          const buildInput = {
            day,
            schedule: parsed.history,
            exceptions: exception ? [exception] : [],
            shopHours: hoursResult.value,
          };
          // Only at a shop the day may offer: one the grid lists, or a
          // moved visit's own (`observeOfferedShops`). `buildDayWindows`
          // reads a shop absent from `shopHours` as one that "publishes no
          // bound" — right for a shop that never authored hours, wrong for
          // one hidden since or a roster typo: its chair would reach the
          // engine UNCLAMPED, and "any shop" (or a deep link naming it)
          // offer a time at a shop `/book` does not list. Dropped here, as
          // the matcher's day and the capacity plan drop them.
          const allWindows = atOfferedShops(
            buildDayWindows(buildInput),
            hoursResult.value,
          );
          // What the day HAD taken out of it. Same inputs, second question —
          // the windows say what is left, these say what was blocked, and a
          // calendar needs both or a break renders as the shop being shut.
          const allBlocks = atOfferedShops(
            buildDayCarveOuts(buildInput),
            hoursResult.value,
          );

          // Narrow to the shop being booked. `null` means the client has not
          // chosen one ("any shop"), and every window stays a candidate — the
          // use-case then runs the engine per shop, because one appointment
          // cannot be split across two.
          const windows = locationId
            ? windowsAt(allWindows, locationId)
            : allWindows;
          const blocks = locationId
            ? windowsAt(allBlocks, locationId)
            : allBlocks;
          if (windows.length === 0) continue;

          days.push({
            barberId,
            windows,
            blocks,
            // Busy is location-AGNOSTIC on purpose: a barber booked at the
            // other shop is not free here either, and their padded block has
            // to keep blocking whichever shop is being asked about.
            busy: toPaddedBusy(
              busyResult.value,
              day.zone,
              parsed.turnaroundMinutes,
              barberId,
              release,
            ),
          });
        }
        return ok<readonly BarberDayAvailability[], RepositoryError>(days);
      }),
    );
  }

  /**
   * The whole horizon from `capacity/{YYYY-MM}` — two or three MONTH docs,
   * however many barbers the shop has.
   *
   * This used to fan out per barber (roster + busy range + exception range
   * per head, on top of the hours listener), which priced a cold calendar at
   * `barbers × occupied days` document reads — the one number in the app
   * that grew with headcount. The rollup is trigger-maintained server-side
   * from the same `buildDayWindows` math (see `rebuild-capacity.ts`), so
   * this read is a lookup, not a computation. `observeDay` deliberately
   * KEEPS reading real geometry: the time sheet needs minutes, not totals.
   *
   * The `barberIds` filter still applies — the rollup stores per-barber
   * contributions precisely so a barber the catalog no longer lists stops
   * counting the moment the catalog says so, without waiting for a sweep.
   */
  observeRangeCapacity(
    locationId: LocationId | null,
    range: DateRange,
    barberIds: readonly BarberId[],
  ): Observable<Result<ReadonlyMap<string, number>, RepositoryError>> {
    const days = range.days();
    if (days.length === 0 || barberIds.length === 0) {
      return of(ok<ReadonlyMap<string, number>, RepositoryError>(new Map()));
    }

    const monthKeys = [
      ...new Set(days.map((day) => capacityMonthKey(day.key()))),
    ];
    const rawBarberIds = barberIds.map((id) => id.value);

    return combineLatest(
      monthKeys.map((month) =>
        this.observeDoc(capacityMonthDocRef(this.db, month)),
      ),
    ).pipe(
      map((results) => {
        const daysByMonth = new Map<string, Record<string, unknown>>();
        for (const [index, result] of results.entries()) {
          if (result.isFailure()) {
            return fail<ReadonlyMap<string, number>, RepositoryError>(
              result.error,
            );
          }
          daysByMonth.set(
            monthKeys[index] as string,
            (result.value?.['days'] ?? {}) as Record<string, unknown>,
          );
        }

        const capacity = new Map<string, number>();
        for (const day of days) {
          const dayKey = day.key();
          const entry = daysByMonth.get(capacityMonthKey(dayKey))?.[dayKey] as
            CapacityDayEntry | undefined;
          capacity.set(
            dayKey,
            freeMinutesFor(entry, rawBarberIds, locationId?.value ?? null),
          );
        }
        return ok<ReadonlyMap<string, number>, RepositoryError>(capacity);
      }),
    );
  }
}
