import {
  type BarberId,
  type CapacityMonthId,
  type LocalDate,
  type RepositoryError,
  Result,
  type TimeZone,
} from '@core/primitives';
import {
  BookingPolicy,
  type CapacityEntry,
  LocationStatus,
  WriteOp,
} from '@core/components';
import {
  type BarberBusyDay,
  type BarberSchedule,
  type CapacityMonth,
  Collections,
  QueryOp,
  type ScheduleException,
  type ShopLocation,
} from '@core/entities';
import type {
  QuerySpec,
  ReadTx,
  SchedulingPorts,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  type CapacityBusyDay,
  type CapacityShopWeek,
  CapacitySystem,
  LeadTimeSystem,
  PartyAdmissionSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `rebuildCapacity` — keep `capacity/{YYYY-MM}` equal to what the geometry
 * says (`rebuild-capacity.ts`, blueprint §4.1, §3.6). One pipeline, six entry
 * points, all landing in one barber's rebuild over a span of days:
 *
 * - a `barberBusy` or `scheduleExceptions` write → that one (barber, day),
 *   unless the day is already past in the tenant's zone (TTL purges of dead
 *   days re-fire the triggers; history stays put — returned BEFORE any read);
 * - a `barberSchedules` write → that barber's horizon;
 * - a `locations` or `settings` write, and the daily sweep → every rostered
 *   barber's horizon, one failure never costing the others theirs.
 *
 * The horizon is today through the policy's horizon end, extended to the
 * LAST day of the month after it (`CapacitySystem.horizonSpanEnd`). One
 * barber's rebuild is ONE transaction — the ACTIVE shops, the roster, the
 * busy range (#13), the exception range (#16) and the month documents, all
 * in its read set, so a booking landing mid-rebuild re-runs it — whose plan
 * is a full sorted `entries[]` `Set` per month (`CapacitySystem.applyPlan`:
 * REPLACE, never merge, never `arrayUnion`).
 */

/** Which write woke the rebuild — the ONLY source of these strings, the field `capacityTrigger`. */
export const CapacityTrigger = {
  /** A busy day or an exception: one (barber, day). */
  Day: 'DAY',
  /** A roster: one barber's horizon. */
  Roster: 'ROSTER',
  /** A shop, the policy or the daily sweep: every rostered barber's horizon. */
  Sweep: 'SWEEP',
} as const;
export type CapacityTrigger =
  (typeof CapacityTrigger)[keyof typeof CapacityTrigger];

export type RebuildCapacityCommand =
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Day;
      readonly barberId: BarberId;
      readonly localDate: LocalDate;
      /** The tenant's zone — whose "today" the past-day guard reads. */
      readonly timeZone: TimeZone;
    }
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Roster;
      readonly barberId: BarberId;
      readonly timeZone: TimeZone;
    }
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Sweep;
      readonly timeZone: TimeZone;
    };

/** The barbers whose capacity was rebuilt (none for a past day). */
export type RebuildCapacityAnswer = {
  readonly rebuiltBarberIds: readonly BarberId[];
};

export type RebuildCapacityPorts = Pick<TxPorts, 'commit' | 'nowUtcMs'> &
  Pick<SchedulingPorts, 'loadPolicy' | 'listBarbers'> &
  Pick<TelemetryPorts, 'log'>;

/** What one barber's rebuild reads inside its transaction. */
type CapacitySnapshot = {
  readonly locations: readonly ShopLocation[];
  readonly schedule: BarberSchedule | null;
  readonly busy: readonly BarberBusyDay[];
  readonly exceptions: readonly ScheduleException[];
  /** `months[i]`'s document, `null` before its first rebuild. */
  readonly monthDocs: readonly (CapacityMonth | null)[];
};

const ACTIVE_LOCATIONS: QuerySpec = {
  collection: [Collections.Locations],
  where: [
    { field: 'locationStatus', op: QueryOp.Eq, value: LocationStatus.Active },
  ],
  orderBy: [],
  limit: null,
};

/** One barber's documents of a collection keyed by shop day, over `[from, to]` (#13, #16). */
function dayRange(
  collection: string,
  barberId: BarberId,
  from: LocalDate,
  to: LocalDate,
): QuerySpec {
  return {
    collection: [collection],
    where: [
      { field: 'barberId', op: QueryOp.Eq, value: barberId },
      { field: 'localDate', op: QueryOp.Gte, value: from },
      { field: 'localDate', op: QueryOp.Lte, value: to },
    ],
    orderBy: [],
    limit: null,
  };
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The capacity rebuild's read set for one barber over `[from, to]`, in one
 * round trip of the transaction.
 */
async function readCapacitySnapshot(
  tx: ReadTx,
  barberId: BarberId,
  from: LocalDate,
  to: LocalDate,
  months: readonly CapacityMonthId[],
): Promise<CapacitySnapshot> {
  const [locations, schedule, busy, exceptions, monthDocs] = await Promise.all([
    tx.query<ShopLocation>(ACTIVE_LOCATIONS),
    tx.get<BarberSchedule>([Collections.BarberSchedules, barberId]),
    tx.query<BarberBusyDay>(
      dayRange(Collections.BarberBusy, barberId, from, to),
    ),
    tx.query<ScheduleException>(
      dayRange(Collections.ScheduleExceptions, barberId, from, to),
    ),
    tx.getAll<CapacityMonth>(
      months.map((month) => [Collections.Capacity, month]),
    ),
  ]);
  return { locations, schedule, busy, exceptions, monthDocs };
}

/**
 * The month documents of one barber's plan: each month's sorted `entries[]`
 * with the plan's scope replaced (`CapacitySystem.applyPlan`), written whole.
 */
function capacityWrites(
  barberId: BarberId,
  localDates: readonly LocalDate[],
  months: readonly CapacityMonthId[],
  snapshot: CapacitySnapshot,
): readonly WriteOp[] {
  // Each shop counted by the rule every new-booking surface asks
  // (`shopListed`) — the query only narrows what is billed — sorted by id,
  // so adding a shop cannot reorder the walk between two runs.
  const shops: CapacityShopWeek[] = [];
  const listed = [...snapshot.locations].sort(byId);
  for (const location of listed) {
    if (!PartyAdmissionSystem.shopListed(location)) continue;
    shops.push({ locationId: location.id, week: location.openingHours });
  }
  const busy: CapacityBusyDay[] = [];
  for (const day of snapshot.busy) {
    busy.push({ localDate: day.localDate, spans: day.blocks });
  }
  const plan = CapacitySystem.planBarberCapacity({
    barberId,
    localDates,
    schedule: snapshot.schedule,
    shops,
    busy,
    exceptions: snapshot.exceptions,
  });
  const writes: WriteOp[] = [];
  for (const monthPlan of CapacitySystem.byMonth(plan)) {
    const stored = snapshot.monthDocs[months.indexOf(monthPlan.month)] ?? null;
    const entries: readonly CapacityEntry[] = CapacitySystem.applyPlan(
      stored ?? { month: monthPlan.month, entries: [] },
      monthPlan,
    );
    const body: Omit<CapacityMonth, 'id'> = { month: monthPlan.month, entries };
    writes.push(WriteOp.set([Collections.Capacity, monthPlan.month], body));
  }
  return writes;
}

export const rebuildCapacity = (ports: RebuildCapacityPorts) => {
  /** One barber's capacity over `[from, to]`, in one transaction; an infrastructure failure rejects. */
  async function rebuildBarber(
    barberId: BarberId,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Result<void, RepositoryError>> {
    const span = CapacitySystem.localDatesBetween(from, to);
    if (span.truncated) {
      // An authoring error, but a SILENT truncation would leave the tail
      // unmaterialized with nothing to see.
      ports.log('warn', 'capacity span truncated at 500 days', {
        fromKey: from,
        toKey: to,
      });
    }
    const first = span.keys[0];
    const last = span.keys[span.keys.length - 1];
    if (first === undefined || last === undefined) return Result.ok(undefined);
    const months = LeadTimeSystem.monthKeysBetween(first, last);
    const committed = await ports.commit(
      (tx) => readCapacitySnapshot(tx, barberId, first, last, months),
      (snapshot): Result<{ readonly writes: readonly WriteOp[] }, never> =>
        Result.ok({
          writes: capacityWrites(barberId, span.keys, months, snapshot),
        }),
    );
    return committed.ok ? Result.ok(undefined) : committed;
  }

  /** Today through the month after the policy's horizon end, on the tenant's clock. */
  async function horizonSpan(
    timeZone: TimeZone,
  ): Promise<
    Result<
      { readonly from: LocalDate; readonly to: LocalDate },
      RepositoryError
    >
  > {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const today = ZonedTimeSystem.shopNow(ports.nowUtcMs(), timeZone).localDate;
    return Result.ok({
      from: today,
      to: CapacitySystem.horizonSpanEnd(
        BookingPolicy.horizonEndFrom(policy.value, today),
      ),
    });
  }

  return async (
    cmd: RebuildCapacityCommand,
  ): Promise<Result<RebuildCapacityAnswer, RepositoryError>> => {
    switch (cmd.capacityTrigger) {
      case CapacityTrigger.Day: {
        const today = ZonedTimeSystem.shopNow(
          ports.nowUtcMs(),
          cmd.timeZone,
        ).localDate;
        // A TTL purge of a dead day must not rewrite a retired month.
        if (cmd.localDate < today) return Result.ok({ rebuiltBarberIds: [] });
        const rebuilt = await rebuildBarber(
          cmd.barberId,
          cmd.localDate,
          cmd.localDate,
        );
        return rebuilt.ok
          ? Result.ok({ rebuiltBarberIds: [cmd.barberId] })
          : rebuilt;
      }
      case CapacityTrigger.Roster: {
        const span = await horizonSpan(cmd.timeZone);
        if (!span.ok) return span;
        const rebuilt = await rebuildBarber(
          cmd.barberId,
          span.value.from,
          span.value.to,
        );
        return rebuilt.ok
          ? Result.ok({ rebuiltBarberIds: [cmd.barberId] })
          : rebuilt;
      }
      case CapacityTrigger.Sweep: {
        const span = await horizonSpan(cmd.timeZone);
        if (!span.ok) return span;
        // The ROSTER is the population: a barber with no schedule has no
        // capacity to materialise.
        const barbers = await ports.listBarbers();
        if (!barbers.ok) return barbers;
        const rebuiltBarberIds: BarberId[] = [];
        for (const barberId of barbers.value) {
          try {
            const rebuilt = await rebuildBarber(
              barberId,
              span.value.from,
              span.value.to,
            );
            if (rebuilt.ok) rebuiltBarberIds.push(barberId);
            else {
              ports.log('error', 'capacity sweep failed for barber', {
                barberId,
                error: rebuilt.error,
              });
            }
          } catch (error) {
            // One barber's bad roster must not cost the others their sweep.
            ports.log('error', 'capacity sweep failed for barber', {
              barberId,
              error,
            });
          }
        }
        return Result.ok({ rebuiltBarberIds });
      }
    }
  };
};
