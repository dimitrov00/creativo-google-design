import {
  LocalDate,
  type LocationId,
  LogEvent,
  Result,
  type TimeZone,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  AnalyticsError,
  CatalogErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  AnalyticsPeriod,
  AnalyticsSpan,
  type AnalyticsCall,
  type AnalyticsReport,
  ClientStatsPolicy,
} from '@core/components';
import {
  type Appointment,
  type BarberSchedule,
  Collections,
  type ScheduleException,
  type ShopLocation,
} from '@core/entities';
import type {
  AnalyticsReadPorts,
  ClockPorts,
  DefaultLocationPorts,
  LogPorts,
  PolicyReadPorts,
  ProfileLoadPorts,
  ShopDayReadPorts,
} from '@core/ports';
import {
  type AnalyticsFollowUp,
  type ShopNowAt,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `staffAnalytics` — one report for one scope and one period
 * (`docs/designs/staff-analytics.md`, Shape). Read-only: the impure read,
 * the pure compute, and a log line in place of a write.
 *
 * 1. **The caller** — `users/{uid}`, its STORED roles, block and barber
 *    link (`StaffAnalyticsSystem.callerOf`); no record →
 *    `ANALYTICS_FORBIDDEN`.
 * 2. **The period** — rebuilt with `AnalyticsPeriod.of` (a first day that
 *    is not its span's first — any day for a `DAY`, a Monday, a 1st →
 *    `ANALYTICS_INVALID_INPUT`).
 * 3. **The shop** — every barber record and every location. "Today" is the
 *    default shop's (else the first's) clock at the call's instant, derived
 *    ONCE; a period outside `AnalyticsPeriod.isWithinRange` →
 *    `ANALYTICS_PERIOD_OUT_OF_RANGE`. Each shop's own `ShopNow` is derived
 *    once beside it, for the days worked there and the follow-ups booked
 *    there.
 * 4. **The scope** — the visibility table (`scopeOf`) over the records read:
 *    one barber, or every record of the shop.
 * 5. **The scope's reads**, in parallel: each barber's roster, the period's
 *    and the next 7 days' departures, the policy, and the visits of the
 *    period, the comparison period (`AnalyticsPeriod.previous` — the hero's
 *    and the line's comparison; for a `DAY` the same weekday a week earlier,
 *    its counterpart day) and the next 7 days by busy key — each list merged
 *    by appointment id, so a party split across barbers is counted once.
 *    The comparison read is skipped entirely when the period is not
 *    comparable (`AnalyticsPeriod.isComparable`: its comparison would start
 *    before the reach) — the report's comparison fields are `null` then.
 * 6. **The follow-ups** — one barber's by the visits in their rebooking
 *    base (`bookedFromAppointmentId in`), the shop's by one `bookedAtUtcMs`
 *    range (the period's first instant to the end of the day after its
 *    last); each one's booking day converted once, on its shop's clock.
 *    **On a `DAY` nothing beyond the day, its counterpart and the next 7
 *    days is read** (design v2, `staffAnalytics` step 5): no follow-ups and
 *    no other comparison-period visits — until the day documents of PR 4a
 *    carry a past day's rebooking figures, a `DAY` report's
 *    `reportRebookedCount` is 0 over its base.
 * 7. **Compute** — the barber-days (`daysOf`) and the report (`report`).
 * 8. **Log** `LogEvent.AnalyticsReported`: the caller, scope, period,
 *    version, visit count, duration and minutes per part — never money.
 *
 * A read that fails answers its `RepositoryError` (the callable's store
 * failure); no partial report is ever answered.
 */

/** The request as the wire decoded it, with the verified caller. */
export type StaffAnalyticsCommand = AnalyticsCall & {
  readonly callerUserId: UserId;
};

export type StaffAnalyticsPorts = AnalyticsReadPorts &
  ProfileLoadPorts &
  ShopDayReadPorts &
  PolicyReadPorts &
  DefaultLocationPorts &
  ClockPorts &
  LogPorts;

const S = StaffAnalyticsSystem;

/** What a skipped visit read answers — nothing, read from nowhere. */
const NO_VISITS: Result<readonly Appointment[], RepositoryError> = Result.ok(
  [],
);

/** Every read's answer, or the first failure. */
function allOk<T>(
  results: readonly Result<T, RepositoryError>[],
): Result<readonly T[], RepositoryError> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return Result.ok(values);
}

/** The zone a shop's wall clock reads in, or the report's own for a shop not read. */
function zoneOf(
  locations: readonly ShopLocation[],
  locationId: LocationId,
  fallback: TimeZone,
): TimeZone {
  for (const location of locations) {
    if (location.id === locationId) return location.timeZone;
  }
  return fallback;
}

export const staffAnalytics =
  (ports: StaffAnalyticsPorts) =>
  async (
    cmd: StaffAnalyticsCommand,
  ): Promise<Result<AnalyticsReport, AnalyticsError | RepositoryError>> => {
    const nowUtcMs = ports.nowUtcMs();

    // 1. The caller, from their stored record.
    const profile = await ports.loadProfile(cmd.callerUserId);
    if (!profile.ok) return profile;
    const caller = S.callerOf(profile.value, nowUtcMs);
    if (!caller.ok) return caller;

    // 2. The period the request names.
    const period = AnalyticsPeriod.of(cmd.analyticsSpan, cmd.fromLocalDate);
    if (!period.ok) return period;

    // 3. The shop: its barber records and its locations, and today.
    const [records, listed] = await Promise.all([
      ports.listBarberRecordIds(),
      ports.listLocations(),
    ]);
    if (!records.ok) return records;
    if (!listed.ok) return listed;
    const locations = listed.value;
    const clock = S.clockLocationOf(locations, ports.defaultLocationId);
    if (clock === null) {
      return Result.err(
        RepositoryError.readFailed(
          `${Collections.Locations}/${ports.defaultLocationId}`,
          CatalogErrorCode.LocationZoneUnknown,
        ),
      );
    }
    const now = ZonedTimeSystem.shopNow(nowUtcMs, clock.timeZone);
    if (!AnalyticsPeriod.isWithinRange(period.value, now.localDate)) {
      return Result.err(AnalyticsError.periodOutOfRange(cmd.fromLocalDate));
    }
    const nowByLocation: ShopNowAt[] = locations.map((location) => ({
      locationId: location.id,
      ...ZonedTimeSystem.shopNow(nowUtcMs, location.timeZone),
    }));

    // 4. The scope.
    const scope = S.scopeOf(caller.value, cmd, records.value);
    if (!scope.ok) return scope;
    const barberIds = S.barbersInScope(scope.value, records.value);

    // 5. The scope's reads — the comparison's only when it is in reach.
    const comparable = AnalyticsPeriod.isComparable(
      period.value,
      now.localDate,
    );
    const previous = AnalyticsPeriod.previous(period.value);
    const periodDays = AnalyticsPeriod.days(period.value);
    const aheadDays = S.aheadDaysOf(now.localDate);
    const aheadTo = aheadDays[aheadDays.length - 1] ?? now.localDate;
    const [rosters, departures, aheadDepartures, policy, visitReads] =
      await Promise.all([
        Promise.all(barberIds.map((id) => ports.loadSchedule(id))),
        Promise.all(
          barberIds.map((id) =>
            ports.loadDeparturesForBarber(
              id,
              period.value.fromLocalDate,
              period.value.toLocalDate,
            ),
          ),
        ),
        Promise.all(
          barberIds.map((id) =>
            ports.loadDeparturesForBarber(id, now.localDate, aheadTo),
          ),
        ),
        ports.loadPolicy(),
        Promise.all([
          ports.loadVisitsByBusyKeys(S.busyKeysOf(barberIds, periodDays)),
          comparable
            ? ports.loadVisitsByBusyKeys(
                S.busyKeysOf(barberIds, AnalyticsPeriod.days(previous)),
              )
            : Promise.resolve(NO_VISITS),
          ports.loadVisitsByBusyKeys(S.busyKeysOf(barberIds, aheadDays)),
        ]),
      ]);
    const rosterRead = allOk<BarberSchedule | null>(rosters);
    if (!rosterRead.ok) return rosterRead;
    const departureRead = allOk<readonly ScheduleException[]>(departures);
    if (!departureRead.ok) return departureRead;
    const aheadDepartureRead =
      allOk<readonly ScheduleException[]>(aheadDepartures);
    if (!aheadDepartureRead.ok) return aheadDepartureRead;
    if (!policy.ok) return policy;
    const visitRead = allOk<readonly Appointment[]>(visitReads);
    if (!visitRead.ok) return visitRead;
    const [periodRows = [], previousRows = [], aheadRows = []] =
      visitRead.value;
    const visits = S.mergeVisits(periodRows);
    const roster: BarberSchedule[] = [];
    for (const schedule of rosterRead.value) {
      if (schedule !== null) roster.push(schedule);
    }

    // 6. The follow-ups, each booking day read once on its shop's clock —
    //    none on a DAY.
    const followUpRead =
      period.value.analyticsSpan === AnalyticsSpan.Day
        ? NO_VISITS
        : scope.value === null
          ? await ports.loadFollowUpsBookedIn(
              ZonedTimeSystem.startOfLocalDay(
                period.value.fromLocalDate,
                clock.timeZone,
              ),
              ZonedTimeSystem.startOfLocalDay(
                LocalDate.addDays(period.value.toLocalDate, 2),
                clock.timeZone,
              ),
            )
          : await ports.loadFollowUpsOf(
              S.followUpSourcesOf(visits, scope.value, now.localDate),
            );
    if (!followUpRead.ok) return followUpRead;
    const followUps: AnalyticsFollowUp[] = [];
    for (const visit of followUpRead.value) {
      if (!S.isCountedFollowUp(visit)) continue;
      const zone = zoneOf(locations, visit.locationId, clock.timeZone);
      followUps.push(
        S.followUpOf(
          visit,
          ZonedTimeSystem.toLocal(visit.bookedAtUtcMs, zone).localDate,
        ),
      );
    }

    // 7. Compute.
    const daysInput = {
      barberIds,
      rosters: roster,
      locations,
      nowByLocation,
      now,
    };
    const report = S.report({
      scopeBarberId: scope.value,
      barberIds,
      period: period.value,
      analyticsComparison: cmd.analyticsComparison,
      days: S.daysOf({
        ...daysInput,
        localDates: periodDays,
        departures: departureRead.value.flat(),
        visits,
      }),
      aheadDays: S.daysOf({
        ...daysInput,
        localDates: aheadDays,
        departures: aheadDepartureRead.value.flat(),
        visits: S.mergeVisits(aheadRows),
      }),
      visits,
      previousVisits: S.mergeVisits(previousRows),
      followUps,
      policy: ClientStatsPolicy.forBooking(policy.value),
      now,
    });

    // 8. The log line — counts and minutes, never money.
    ports.log('info', LogEvent.AnalyticsReported, {
      uid: cmd.callerUserId,
      scope: report.reportScopeBarberId,
      periodFrom: report.reportFromLocalDate,
      periodTo: report.reportToLocalDate,
      definitionVersion: report.reportDefinitionVersion,
      visitCount: visits.length,
      durationMs: UtcEpochMs.elapsedMs(nowUtcMs, ports.nowUtcMs()),
      rosteredMinutes: report.reportRosteredMinutes,
      workedMinutes: report.reportWorkedMinutes,
      noShowMinutes: report.reportNoShowMinutes,
      unmarkedMinutes: report.reportUnmarkedMinutes,
      bookedAheadMinutes: report.reportBookedAheadMinutes,
      heldMinutes: report.reportHeldMinutes,
      blockedMinutes: report.reportBlockedMinutes,
      breakMinutes: report.reportBreakMinutes,
      shortGapMinutes: report.reportShortGapMinutes,
      unsoldMinutes: report.reportUnsoldMinutes,
      openMinutes: report.reportOpenMinutes,
      closedDayMinutes: report.reportClosedDayMinutes,
    });
    return Result.ok(report);
  };
