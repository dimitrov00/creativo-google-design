import {
  type BarberId,
  BusyKey,
  type LocalDate,
  type LocationId,
  NotificationId,
  type RepositoryError,
  RepositoryErrorCode,
  Result,
  type TimeZone,
  type WaitlistRequestId,
  WaitlistStatus,
} from '@core/primitives';
import {
  type BookingPolicy,
  NotificationTopic,
  type RosterWindow,
  type ShopNow,
  WaitlistLifecycle,
  WriteOp,
} from '@core/components';
import {
  type BarberSchedule,
  Collections,
  type ScheduleException,
  type Service,
  type WaitlistRequest,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  ListedCatalogPorts,
  LogPorts,
  OpenWaitlistReadPorts,
  PolicyReadPorts,
  RecentNotificationPorts,
  ShopDayReadPorts,
} from '@core/ports';
import {
  AvailabilitySystem,
  type CartBarberDay,
  PartyAdmissionSystem,
  RosterSystem,
  type ShopHours,
  type WaitlistMatch,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `matchWaitlist` — watch the public busy projection; when a shop day frees
 * up, tell whoever asked (`match-waitlist.ts`, blueprint §4.1). It fires on
 * every busy write, bookings included: most writes take time away and find
 * no match, which is cheaper than diffing what shrank.
 *
 * - A PAST day frees nothing anyone can book (the lead-time floor of a day
 *   gone by is the whole day), so it reads only the requests still `OPEN`
 *   on it and retires the ones whose every day has passed — no policy read,
 *   no snapshot (a TTL purge of a dead busy day, 30 days on, finds none:
 *   the requests themselves are purged 7 days after their last day).
 * - Outside any transaction, and only when somebody watches the day: the
 *   requests still `OPEN` on it (#14); the day's snapshot, loaded ONCE and
 *   shared by every request — every ACTIVE service, every barber rostered
 *   that day at a LISTED shop with their busy padded by their turnaround
 *   (the grid's own read, fail-closed); the 6 h cooldown probe (#15).
 * - Per request, on its own (one failure never costs the others theirs): a
 *   request whose every day has passed is EXPIRED; otherwise the grid's own
 *   question (`WaitlistSystem.match`) with the request's windows as the
 *   mask, behind the commit's admission of the bag. A match is ONE plan in
 *   a transaction that re-reads the request and requires it still `OPEN`:
 *   the notification `Create` under the deterministic id
 *   `hash('wl_match' + requestId + localDate)` and the `MATCHED` transition
 *   — so two overlapping deliveries can never both notify (the second meets
 *   either a non-`OPEN` request or its own notification, `ALREADY_EXISTS`).
 *
 * The notification is an invitation, never a hold: `bookAppointment` stays
 * the only authority, and its words are the inbox's (facts only, §9 D20).
 */

export type MatchWaitlistCommand = {
  /** The shop day the busy write touched. */
  readonly localDate: LocalDate;
  /** The tenant's zone — whose "now" decides past days, lead times and lapses. */
  readonly timeZone: TimeZone;
};

export type MatchWaitlistAnswer = {
  /** Requests told about the day, in the order they were read. */
  readonly notifiedRequestIds: readonly WaitlistRequestId[];
  /** Requests whose every day had passed, moved to `EXPIRED`. */
  readonly expiredRequestIds: readonly WaitlistRequestId[];
};

export type MatchWaitlistPorts = CommitPorts &
  HashPorts &
  ClockPorts &
  ShopDayReadPorts &
  OpenWaitlistReadPorts &
  PolicyReadPorts &
  RecentNotificationPorts &
  LogPorts &
  ListedCatalogPorts;

/** What a freed day offers every request watching it, read once. */
type MatchDay = {
  readonly services: readonly Service[];
  readonly barbers: readonly CartBarberDay[];
};

const EMPTY_DAY: MatchDay = { services: [], barbers: [] };

/** The deterministic id of the notification a match on `localDate` sends for `requestId`. */
export function waitlistMatchNotificationId(
  requestId: WaitlistRequestId,
  localDate: LocalDate,
  hash: (input: string) => string,
): NotificationId {
  return NotificationId.of(hash(`wl_match${requestId}${localDate}`));
}

/** How one watching request ended this delivery — the ONLY source of these strings. */
const RequestOutcome = {
  Notified: 'NOTIFIED',
  Expired: 'EXPIRED',
  None: 'NONE',
} as const;
type RequestOutcome = (typeof RequestOutcome)[keyof typeof RequestOutcome];

/** One request's plan and how it would leave the request. */
type OutcomePlan = {
  readonly outcome: RequestOutcome;
  readonly writes: readonly WriteOp[];
};

export const matchWaitlist = (ports: MatchWaitlistPorts) => {
  /**
   * The day's snapshot — loaded ONCE for every request that named it. A day
   * with nothing to search is EMPTY, never missing: each request still has
   * its lapse read. Fail-closed: an absent roster reads as "nobody works".
   */
  async function loadDay(
    localDate: LocalDate,
  ): Promise<Result<MatchDay, RepositoryError>> {
    const listed = await ports.loadListedCatalog();
    if (!listed.ok) return listed;
    const services = listed.value.services;
    if (services.length === 0) return Result.ok(EMPTY_DAY);

    // Every LISTED shop's hours for the day, shared by every barber.
    const shopHours: ShopHours[] = [];
    const listedShops: LocationId[] = [];
    for (const location of listed.value.locations) {
      if (!PartyAdmissionSystem.shopListed(location)) continue;
      const hours = RosterSystem.shopDayHours(location.openingHours, localDate);
      shopHours.push({ locationId: location.id, hours });
      listedShops.push(location.id);
    }
    if (shopHours.length === 0) return Result.ok({ services, barbers: [] });

    // Rosters AND exceptions, every candidate at once — an exception can
    // close the day, so it is known before the windows are built.
    const candidates: BarberId[] = [];
    for (const barber of listed.value.barbers) candidates.push(barber.id);
    const reads = await Promise.all(
      candidates.map((barberId) =>
        Promise.all([
          ports.loadSchedule(barberId),
          ports.loadScheduleException(BusyKey.of(barberId, localDate)),
        ]),
      ),
    );
    const rostered: {
      readonly barberId: BarberId;
      readonly schedule: BarberSchedule;
      readonly windows: readonly RosterWindow[];
    }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const barberId = candidates[i] as BarberId;
      const [schedule, exception] = reads[i] as readonly [
        Result<BarberSchedule | null, RepositoryError>,
        Result<ScheduleException | null, RepositoryError>,
      ];
      if (!schedule.ok) return schedule;
      if (!exception.ok) return exception;
      if (schedule.value === null) continue;
      // Only windows at a shop the searched set holds: a shop absent from
      // `shopHours` reads as "no bound", which is wrong for one hidden since.
      const windows: RosterWindow[] = [];
      for (const window of RosterSystem.buildDayWindows({
        barberId,
        localDate,
        versions: schedule.value.versions,
        exceptions: exception.value === null ? [] : [exception.value],
        shopHours,
      })) {
        if (listedShops.includes(window.locationId)) windows.push(window);
      }
      if (windows.length > 0) {
        rostered.push({ barberId, schedule: schedule.value, windows });
      }
    }
    if (rostered.length === 0) return Result.ok({ services, barbers: [] });

    const busyDays = await Promise.all(
      rostered.map((entry) =>
        ports.loadBusyDay(BusyKey.of(entry.barberId, localDate)),
      ),
    );
    const barbers: CartBarberDay[] = [];
    for (let i = 0; i < rostered.length; i++) {
      const entry = rostered[i] as (typeof rostered)[number];
      const busy = busyDays[i] as Awaited<(typeof busyDays)[number]>;
      if (!busy.ok) return busy;
      barbers.push({
        barberId: entry.barberId,
        windows: entry.windows,
        // PADDED by the barber's turnaround — the one rule the grid and the
        // commit both apply; nothing is released (a request is a new booking).
        busy: AvailabilitySystem.paddedBusy({
          barberId: entry.barberId,
          spans: busy.value === null ? [] : busy.value.blocks,
          turnaroundMinutes: entry.schedule.turnaroundMinutes,
          release: [],
        }),
      });
    }
    return Result.ok({ services, barbers });
  }

  /** A request whose every day has passed stops being watched (re-read in its own transaction). */
  async function expire(
    request: WaitlistRequest,
    now: ShopNow,
  ): Promise<Result<RequestOutcome, RepositoryError>> {
    const path = [Collections.WaitlistRequests, request.id];
    const committed = await ports.commit(
      (tx) => tx.get<WaitlistRequest>(path),
      (stored): Result<OutcomePlan, never> => {
        const expired =
          stored === null
            ? null
            : WaitlistLifecycle.transition(
                stored,
                WaitlistStatus.Expired,
                now.utcEpochMs,
              );
        return expired === null || !expired.ok
          ? Result.ok({ outcome: RequestOutcome.None, writes: [] })
          : Result.ok({
              outcome: RequestOutcome.Expired,
              writes: [WriteOp.update(path, expired.value)],
            });
      },
    );
    return committed.ok ? Result.ok(committed.value.outcome) : committed;
  }

  /**
   * One match's plan — the notification and the `MATCHED` transition
   * together, conditioned on the request still being `OPEN` in the same
   * transaction. A lost race on the deterministic id is the replay: told
   * already, nothing more to do.
   */
  async function notify(
    request: WaitlistRequest,
    found: WaitlistMatch,
    now: ShopNow,
  ): Promise<Result<RequestOutcome, RepositoryError>> {
    const path = [Collections.WaitlistRequests, request.id];
    const notificationId = waitlistMatchNotificationId(
      request.id,
      found.localDate,
      ports.hash,
    );
    const committed = await ports.commit(
      (tx) => tx.get<WaitlistRequest>(path),
      (stored): Result<OutcomePlan, never> => {
        if (stored === null || stored.waitlistStatus !== WaitlistStatus.Open) {
          return Result.ok({ outcome: RequestOutcome.None, writes: [] });
        }
        const plan = WaitlistSystem.planMatch(
          stored,
          found,
          now,
          () => notificationId,
        );
        return plan.ok
          ? Result.ok({
              outcome: RequestOutcome.Notified,
              writes: plan.value.writes,
            })
          : Result.ok({ outcome: RequestOutcome.None, writes: [] });
      },
    );
    if (committed.ok) return Result.ok(committed.value.outcome);
    return committed.error.errorCode === RepositoryErrorCode.AlreadyExists
      ? Result.ok(RequestOutcome.None)
      : committed;
  }

  async function settle(
    request: WaitlistRequest,
    day: MatchDay,
    localDate: LocalDate,
    now: ShopNow,
    policy: BookingPolicy,
  ): Promise<Result<RequestOutcome, RepositoryError>> {
    // A request whose days have all passed is retired, not re-evaluated forever.
    if (WaitlistSystem.hasLapsed(request, now.localDate)) {
      return expire(request, now);
    }
    const found = WaitlistSystem.match(request, localDate, day, {
      now,
      policy,
      // Catalogue drift since the request is never a promise.
      admissible: PartyAdmissionSystem.admitCart(
        request,
        day.services,
        policy,
        request.locationId,
      ).ok,
    });
    if (found === null) return Result.ok(RequestOutcome.None);
    // The cross-day cooldown: one afternoon of rescheduling must not send
    // the same person a dozen identical messages.
    const recent = await ports.hasRecentNotification(
      request.ownerUserId,
      NotificationTopic.WaitlistMatch,
      request.id,
      WaitlistSystem.cooldownSinceUtcMs(now.utcEpochMs),
    );
    if (!recent.ok) return recent;
    if (recent.value) return Result.ok(RequestOutcome.None);
    return notify(request, found, now);
  }

  /**
   * A day gone by: nothing on it can be offered (the lead-time floor of a
   * past day is the whole day), so only the requests watching it whose
   * every day has passed are retired — the policy and the day's snapshot are
   * never read.
   */
  async function retireLapsed(
    localDate: LocalDate,
    now: ShopNow,
  ): Promise<Result<MatchWaitlistAnswer, RepositoryError>> {
    const watching = await ports.loadOpenWaitlist(localDate);
    if (!watching.ok) return watching;
    const expiredRequestIds: WaitlistRequestId[] = [];
    for (const request of watching.value) {
      if (!WaitlistSystem.hasLapsed(request, now.localDate)) continue;
      let expired: Result<RequestOutcome, RepositoryError>;
      try {
        expired = await expire(request, now);
      } catch (error) {
        ports.log('error', 'waitlist match failed', {
          requestId: request.id,
          error: String(error),
        });
        continue;
      }
      if (!expired.ok) {
        ports.log('error', 'waitlist match failed', {
          requestId: request.id,
          error: expired.error,
        });
        continue;
      }
      if (expired.value === RequestOutcome.Expired) {
        expiredRequestIds.push(request.id);
      }
    }
    return Result.ok({ notifiedRequestIds: [], expiredRequestIds });
  }

  return async (
    cmd: MatchWaitlistCommand,
  ): Promise<Result<MatchWaitlistAnswer, RepositoryError>> => {
    const now = ZonedTimeSystem.shopNow(ports.nowUtcMs(), cmd.timeZone);
    const none: MatchWaitlistAnswer = {
      notifiedRequestIds: [],
      expiredRequestIds: [],
    };
    if (cmd.localDate < now.localDate) return retireLapsed(cmd.localDate, now);

    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const watching = await ports.loadOpenWaitlist(cmd.localDate);
    if (!watching.ok) return watching;
    if (watching.value.length === 0) return Result.ok(none);

    const day = await loadDay(cmd.localDate);
    if (!day.ok) return day;

    const notifiedRequestIds: WaitlistRequestId[] = [];
    const expiredRequestIds: WaitlistRequestId[] = [];
    for (const request of watching.value) {
      // Independent promises to different people: one request's failure is
      // logged and never costs the others their notification.
      let settled: Result<RequestOutcome, RepositoryError>;
      try {
        settled = await settle(
          request,
          day.value,
          cmd.localDate,
          now,
          policy.value,
        );
      } catch (error) {
        ports.log('error', 'waitlist match failed', {
          requestId: request.id,
          error: String(error),
        });
        continue;
      }
      if (!settled.ok) {
        ports.log('error', 'waitlist match failed', {
          requestId: request.id,
          error: settled.error,
        });
        continue;
      }
      if (settled.value === RequestOutcome.Notified) {
        notifiedRequestIds.push(request.id);
      }
      if (settled.value === RequestOutcome.Expired) {
        expiredRequestIds.push(request.id);
      }
    }
    return Result.ok({ notifiedRequestIds, expiredRequestIds });
  };
};
