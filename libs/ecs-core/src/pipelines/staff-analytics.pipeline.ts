import {
  AnalyticsGoalKey,
  BusyKey,
  LocalDate,
  type LocationId,
  LogEvent,
  Result,
  StaffCapability,
  type TimeZone,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  type AccessError,
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
  FlagName,
} from '@core/components';
import {
  type Appointment,
  type BarberAnalyticsDay,
  type BarberSchedule,
  Collections,
  type ScheduleException,
  type ShopLocation,
  type StoredAnalyticsGoal,
} from '@core/entities';
import type {
  AnalyticsDayReadPorts,
  AnalyticsGoalPorts,
  AnalyticsReadPorts,
  ClockPorts,
  DefaultLocationPorts,
  FlagsPorts,
  LogPorts,
  PolicyReadPorts,
  ProfileLoadPorts,
  ShopDayReadPorts,
  StaffPermissionsReadPorts,
} from '@core/ports';
import {
  AnalyticsCarouselSystem,
  type AnalyticsVisit,
  type AnalyticsFollowUp,
  type ShopNowAt,
  StaffAccessSystem,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { loadStaffCaller } from './team-caller.pipeline';

/**
 * `staffAnalytics` — one report for one scope and one period
 * (`docs/designs/staff-analytics-v2.md`, Pipelines · `staffAnalytics`).
 * Read-only: the impure read, the pure compute, and a log line in place of
 * a write.
 *
 * 1. **The caller** — `users/{uid}` and `settings/staffPermissions`, read
 *    side by side (`loadStaffCaller`: this call has no transaction to read
 *    them in, and a read needs no more than "as of this call"). A missing,
 *    blocked or erased account, or one with no staff role, is
 *    `ACCESS_NOT_STAFF` (`StaffAccessSystem.staffOf`); then how far
 *    `ANALYTICS` reaches for the STORED roles and link (`accessOf`, staff
 *    permissions P3).
 * 2. **The period** — rebuilt with `AnalyticsPeriod.of` from the span, the
 *    first day and (for a `CUSTOM` range) the last: a first day that is not
 *    its span's first, a `toLocalDate` where none belongs or none where one
 *    does → `ANALYTICS_INVALID_INPUT`; a `CUSTOM` range over
 *    `CUSTOM_MAX_DAYS` → `ANALYTICS_PERIOD_OUT_OF_RANGE`.
 * 3. **The shop** — every barber record and every location. "Today" is the
 *    default shop's (else the first's) clock at the call's instant, derived
 *    ONCE; a period outside `AnalyticsPeriod.isWithinRange` →
 *    `ANALYTICS_PERIOD_OUT_OF_RANGE`. Each shop's own `ShopNow` is derived
 *    once beside it, for the days worked there and the follow-ups booked
 *    there.
 * 4. **The scope** — the visibility table (`scopeOf`) over the records read:
 *    one barber, or every record of the shop — nobody is `ACCESS_DENIED`,
 *    an own-only reader asking for a colleague `ACCESS_OWN_ONLY`; and a
 *    whole-shop reader's location
 *    (`locationScopeOf`, ADR 2026-11-09), which cuts every read below to
 *    that shop: the stored days to its share (`storedAt`), the live days to
 *    its hours (`atLocation`), the visits to those booked there
 *    (`visitsAt`). A location reads no goal.
 * 5. **The stored days.** With `FlagName.AnalyticsStoredDays` on (read
 *    inside the handler), the period's day documents are read in one range
 *    (`loadAnalyticsDays(barberIds, from, to)`; the adapter's bound is 366 ×
 *    the barbers — over it the read is REFUSED, `resource-exhausted`, never
 *    a truncated report) and those of THIS definition are kept
 *    (`currentStoredOf`); with it off, `loadAnalyticsDays` is never called.
 *    Every other barber-day of the period — the live days, and the past
 *    days with no current document — is computed LIVE: its visits are read
 *    by busy key (`liveKeysOf`; the adapter's caps bound the read, so a
 *    live fallback over them answers the same `resource-exhausted`
 *    refusal), and the past ones count in `reportMissingDays`. The
 *    comparison period (`AnalyticsPeriod.previous`) is read the same way,
 *    plus — while the period runs — the counterpart day's visits (the hero's
 *    cut, up to the current minute), or skipped entirely when the period is
 *    not comparable (`isComparable`: its comparison would start before the
 *    reach) — the report's comparison fields are `null` then. Beside them:
 *    each barber's roster, the period's and the next 7 days' departures,
 *    the policy, and the next 7 days' visits as v1. Every visit list is
 *    merged by appointment id, so a party split across barbers is counted
 *    once.
 * 6. **The follow-ups** — only when a past day was computed live (a stored
 *    day's rebooking figures are final; a live day is never in the base):
 *    one barber's by the visits in their rebooking base
 *    (`bookedFromAppointmentId in`), the shop's by one `bookedAtUtcMs` range
 *    (the period's first instant to the end of the day after its last);
 *    each one's booking day converted once, on its shop's clock. **On a
 *    `DAY` nothing beyond the day, its counterpart and the next 7 days is
 *    read** (design, step 5): no follow-ups, so a `DAY` computed live
 *    reports `reportRebookedCount` 0 over its base.
 *    **The goal** (PR 6): on a `MONTH` the scope's `analyticsGoals/{key}`
 *    for the period's month is read beside them (+1 read); on every other
 *    span it is not read and the report's goal fields are `null` / `NONE`.
 * 7. **Compute** — the barber-days (`daysOf`) and the report (`report`).
 * 8. **Log** `LogEvent.AnalyticsReported`: the caller, scope, period, span,
 *    comparison, version, visit count, missing days, duration and minutes
 *    per part — never money.
 *
 * A read that fails answers its `RepositoryError` (the callable's store
 * failure); no partial report is ever answered.
 */

/** The request as the wire decoded it, with the verified caller. */
export type StaffAnalyticsCommand = AnalyticsCall & {
  readonly callerUserId: UserId;
};

export type StaffAnalyticsPorts = AnalyticsReadPorts &
  AnalyticsDayReadPorts &
  AnalyticsGoalPorts &
  FlagsPorts &
  ProfileLoadPorts &
  ShopDayReadPorts &
  PolicyReadPorts &
  StaffPermissionsReadPorts &
  DefaultLocationPorts &
  ClockPorts &
  LogPorts;

const S = StaffAnalyticsSystem;

/** What a skipped visit read answers — nothing, read from nowhere. */
const NO_VISITS: Result<readonly Appointment[], RepositoryError> = Result.ok(
  [],
);

/** What a skipped day-document read answers — none, read from nowhere. */
const NO_DAYS: Result<readonly BarberAnalyticsDay[], RepositoryError> =
  Result.ok([]);

/** What a skipped goal read answers (every span but `MONTH`) — none. */
const NO_GOAL: Result<StoredAnalyticsGoal | null, RepositoryError> =
  Result.ok(null);

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

/** `keys` with `more` appended, each once. */
function withKeys(
  keys: readonly BusyKey[],
  more: readonly BusyKey[],
): readonly BusyKey[] {
  const out = [...keys];
  for (const key of more) if (!out.includes(key)) out.push(key);
  return out;
}

/**
 * The visits of the days computed live — a visit of a held (stored) day was
 * read for the seat rows alone (G4), and its rebooking is the document's,
 * so no follow-up of it is read.
 */
function liveVisitsOf(
  visits: readonly AnalyticsVisit[],
  liveKeys: readonly BusyKey[],
): readonly AnalyticsVisit[] {
  const live = new Set<BusyKey>(liveKeys);
  return visits.filter((visit) =>
    visit.seats.some((seat) =>
      live.has(BusyKey.of(seat.barberId, visit.localDate)),
    ),
  );
}

export const staffAnalytics =
  (ports: StaffAnalyticsPorts) =>
  async (
    cmd: StaffAnalyticsCommand,
  ): Promise<
    Result<AnalyticsReport, AnalyticsError | AccessError | RepositoryError>
  > => {
    const nowUtcMs = ports.nowUtcMs();

    // 1. The caller, from their stored record and the owner's cells.
    const facts = await loadStaffCaller(ports, cmd.callerUserId);
    if (!facts.ok) return facts;
    const staff = StaffAccessSystem.staffOf(facts.value.caller, nowUtcMs);
    if (!staff.ok) return staff;
    const access = StaffAccessSystem.accessOf(
      facts.value.permissions,
      StaffCapability.Analytics,
      staff.value,
    );

    // 2. The period the request names.
    const period = AnalyticsPeriod.of(
      cmd.analyticsSpan,
      cmd.fromLocalDate,
      cmd.toLocalDate,
    );
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
    const scope = S.scopeOf(access, cmd, records.value);
    if (!scope.ok) return scope;
    const at = S.locationScopeOf(access, cmd, locations);
    if (!at.ok) return at;
    const locationIds = at.value;
    const barberIds = S.barbersInScope(scope.value, records.value);
    // The one barber a scope names — their own report — or `null`.
    const sole = S.soleBarberOf(scope.value);

    // 5. The scope's reads. First the stored days (with the flag on), the
    //    rosters, departures, policy and the next 7 days; then the visits of
    //    every barber-day no stored day holds.
    const storedDays = ports.flagOn(FlagName.AnalyticsStoredDays);
    const comparable = AnalyticsPeriod.isComparable(
      period.value,
      now.localDate,
    );
    const previous = AnalyticsPeriod.previous(period.value);
    const periodDays = AnalyticsPeriod.days(period.value);
    const previousDays = AnalyticsPeriod.days(previous);
    const aheadDays = S.aheadDaysOf(now.localDate);
    const aheadTo = aheadDays[aheadDays.length - 1] ?? now.localDate;
    const [
      rosters,
      departures,
      aheadDepartures,
      policy,
      periodDocs,
      previousDocs,
      goal,
      firstSeen,
    ] = await Promise.all([
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
      storedDays
        ? ports.loadAnalyticsDays(
            barberIds,
            period.value.fromLocalDate,
            period.value.toLocalDate,
          )
        : Promise.resolve(NO_DAYS),
      storedDays && comparable
        ? ports.loadAnalyticsDays(
            barberIds,
            previous.fromLocalDate,
            previous.toLocalDate,
          )
        : Promise.resolve(NO_DAYS),
      // The month's goal (PR 6) — on a MONTH only, the scope's own key;
      // a location, or a part of the team, has none.
      period.value.analyticsSpan === AnalyticsSpan.Month &&
      S.scopeHasGoal(scope.value, locationIds)
        ? ports.loadAnalyticsGoal(
            AnalyticsGoalKey.of(
              sole,
              LocalDate.monthKey(period.value.fromLocalDate),
            ),
          )
        : Promise.resolve(NO_GOAL),
      // The clients first seen in the period, shop-wide — the report
      // counts the scope's own (one range on the projection); from the
      // comparison period's start when the report draws the radar.
      ports.loadClientsFirstSeenIn(
        S.firstSeenFromOf(period.value, now.localDate, scope.value),
        period.value.toLocalDate,
      ),
    ]);
    const rosterRead = allOk<BarberSchedule | null>(rosters);
    if (!rosterRead.ok) return rosterRead;
    const departureRead = allOk<readonly ScheduleException[]>(departures);
    if (!departureRead.ok) return departureRead;
    const aheadDepartureRead =
      allOk<readonly ScheduleException[]>(aheadDepartures);
    if (!aheadDepartureRead.ok) return aheadDepartureRead;
    if (!policy.ok) return policy;
    if (!periodDocs.ok) return periodDocs;
    if (!previousDocs.ok) return previousDocs;
    if (!goal.ok) return goal;
    if (!firstSeen.ok) return firstSeen;
    const pastDays = S.storedAt(
      S.currentStoredOf(periodDocs.value),
      locationIds,
    );
    const previousPastDays = S.storedAt(
      S.currentStoredOf(previousDocs.value),
      locationIds,
    );
    const roster: BarberSchedule[] = [];
    for (const schedule of rosterRead.value) {
      if (schedule !== null) roster.push(schedule);
    }

    // The live barber-days' visits — and, while the period runs, the
    // counterpart day's (the hero's cut), however that day is held — then
    // the next 7 days' as v1.
    const running =
      period.value.fromLocalDate <= now.localDate &&
      now.localDate <= period.value.toLocalDate;
    const cutIndex = LocalDate.daysBetween(
      period.value.fromLocalDate,
      now.localDate,
    );
    const counterpart = running ? previousDays.at(cutIndex) : undefined;
    const counterpartKeys =
      counterpart === undefined ? [] : S.busyKeysOf(barberIds, [counterpart]);
    const liveKeys = S.liveKeysOf(barberIds, periodDays, pastDays);
    // G4 FOR A BARBER'S DRILL-DOWN: the seat rows must list every worked
    // seat of the period, stored days included, so a barber scope on a
    // day-grained period (≤ DAY_GRAIN_MAX_DAYS) reads every day's visits —
    // v1's own read, a few documents a day — while the figures still come
    // from the documents (a stored day's seats are skipped by the system's
    // one-source rule). A longer period, and the shop, read the live days
    // alone: their drill-downs list days and barbers, not seats.
    const periodKeys =
      sole !== null &&
      AnalyticsPeriod.length(period.value) <= S.DAY_GRAIN_MAX_DAYS
        ? S.busyKeysOf(barberIds, periodDays)
        : liveKeys;
    const [periodRows, previousRows, aheadRows] = await Promise.all([
      ports.loadVisitsByBusyKeys(periodKeys),
      comparable
        ? ports.loadVisitsByBusyKeys(
            withKeys(
              S.liveKeysOf(barberIds, previousDays, previousPastDays),
              counterpartKeys,
            ),
          )
        : Promise.resolve(NO_VISITS),
      ports.loadVisitsByBusyKeys(S.busyKeysOf(barberIds, aheadDays)),
    ]);
    if (!periodRows.ok) return periodRows;
    if (!previousRows.ok) return previousRows;
    if (!aheadRows.ok) return aheadRows;
    const visits = S.visitsAt(S.mergeVisits(periodRows.value), locationIds);

    // 7a. The period's barber-days, cut on each shop's clock — and to the
    //     location, when the scope names one.
    const daysInput = {
      barberIds,
      rosters: roster,
      locations,
      nowByLocation,
      now,
    };
    const days = S.daysOf(
      S.atLocations(
        {
          ...daysInput,
          localDates: periodDays,
          departures: departureRead.value.flat(),
          visits,
        },
        locationIds,
      ),
    );

    // 6. The follow-ups, each booking day read once on its shop's clock —
    //    none on a DAY, none when every past day came from its document.
    const live = new Set<BusyKey>(liveKeys);
    const missing = days.some(
      (day) => day.pastDay && live.has(BusyKey.of(day.barberId, day.localDate)),
    );
    const followUpRead =
      period.value.analyticsSpan === AnalyticsSpan.Day || !missing
        ? NO_VISITS
        : sole === null
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
              S.followUpSourcesOf(
                liveVisitsOf(visits, liveKeys),
                sole,
                now.localDate,
              ),
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

    // 7b. Compute. For the shop over two or more locations, each location's
    //     own report first — how they compete (owner review 2026-11-09) —
    //     cut from what was read already: no extra read. A location's
    //     figures need neither the next 7 days nor a goal.
    const previousVisits = S.visitsAt(
      S.mergeVisits(previousRows.value),
      locationIds,
    );
    const locationFigures = S.comparedLocationsOf(
      access,
      locationIds,
      locations,
    ).map((locationId) =>
      AnalyticsCarouselSystem.locationFiguresOf(
        locationId,
        S.report({
          scopeBarberIds: scope.value,
          scopeLocationIds: [locationId],
          barberIds,
          period: period.value,
          analyticsComparison: cmd.analyticsComparison,
          days: S.daysOf(
            S.atLocations(
              {
                ...daysInput,
                localDates: periodDays,
                departures: departureRead.value.flat(),
                visits,
              },
              [locationId],
            ),
          ),
          pastDays: S.storedAt(pastDays, [locationId]),
          aheadDays: [],
          visits: S.visitsAt(visits, [locationId]),
          previousVisits: S.visitsAt(previousVisits, [locationId]),
          previousPastDays: S.storedAt(previousPastDays, [locationId]),
          followUps,
          firstSeen: firstSeen.value,
          policy: ClientStatsPolicy.forBooking(policy.value),
          now,
          goal: null,
          locationFigures: [],
        }),
      ),
    );
    const report = S.report({
      scopeBarberIds: scope.value,
      scopeLocationIds: locationIds,
      barberIds,
      period: period.value,
      analyticsComparison: cmd.analyticsComparison,
      days,
      pastDays,
      aheadDays: S.daysOf(
        S.atLocations(
          {
            ...daysInput,
            localDates: aheadDays,
            departures: aheadDepartureRead.value.flat(),
            visits: S.mergeVisits(aheadRows.value),
          },
          locationIds,
        ),
      ),
      visits,
      previousVisits,
      previousPastDays,
      followUps,
      firstSeen: firstSeen.value,
      policy: ClientStatsPolicy.forBooking(policy.value),
      now,
      goal: goal.value,
      locationFigures,
    });

    // 8. The log line — counts and minutes, never money.
    ports.log('info', LogEvent.AnalyticsReported, {
      uid: cmd.callerUserId,
      scope: report.reportScopeBarberId,
      locations: report.reportScopeLocationIds,
      span: report.reportAnalyticsSpan,
      periodFrom: report.reportFromLocalDate,
      periodTo: report.reportToLocalDate,
      comparison: report.reportAnalyticsComparison,
      definitionVersion: report.reportDefinitionVersion,
      visitCount: visits.length,
      missingDays: report.reportMissingDays,
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
