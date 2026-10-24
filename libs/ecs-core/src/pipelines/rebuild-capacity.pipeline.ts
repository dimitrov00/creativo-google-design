import {
  type BarberId,
  type CapacityMonthId,
  type LocalDate,
  Result,
  type TimeZone,
} from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import {
  BookingPolicy,
  type CapacityEntry,
  CapacityTrigger,
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
  BarberListPorts,
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  PolicyReadPorts,
  QuerySpec,
  ReadTx,
} from '@core/ports';
import {
  CapacitySystem,
  LeadTimeSystem,
  PartyAdmissionSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `rebuildCapacity` — keep `capacity/{YYYY-MM}` equal to what the geometry
 * says (`rebuild-capacity.ts`, blueprint §4.1, §3.6). One pipeline, six entry
 * points, all landing in one barber's rebuild over a span of days:
 *
 * - a `barberBusy` or `scheduleExceptions` write → that one (barber, day),
 *   unless the day is already past on the default location's clock (TTL
 *   purges of dead days re-fire the triggers; history stays put — returned
 *   before any read but the zone's);
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
 *
 * "Today" is the default location's (F-4, Law 7.2: a capacity entry spans
 * every shop a barber works at, so no one location is in scope), read once
 * per invocation; a zone that cannot be read is the rebuild's store failure.
 */

export type RebuildCapacityCommand =
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Day;
      readonly barberId: BarberId;
      readonly localDate: LocalDate;
    }
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Roster;
      readonly barberId: BarberId;
    }
  | {
      readonly capacityTrigger: typeof CapacityTrigger.Sweep;
    };

/** The barbers whose capacity was rebuilt (none for a past day). */
export type RebuildCapacityAnswer = {
  readonly rebuiltBarberIds: readonly BarberId[];
};

export type RebuildCapacityPorts = CommitPorts &
  ClockPorts &
  BarberListPorts &
  PolicyReadPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  LogPorts;

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
  const shops: ShopLocation[] = [];
  const listed = [...snapshot.locations].sort(byId);
  for (const location of listed) {
    if (PartyAdmissionSystem.shopListed(location)) shops.push(location);
  }
  const plan = CapacitySystem.planBarberCapacity({
    barberId,
    localDates,
    schedule: snapshot.schedule,
    shops,
    busy: snapshot.busy,
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

  /** Today through the month after the policy's horizon end, on the default location's clock. */
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
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    const timeZone = zone.value;
    switch (cmd.capacityTrigger) {
      case CapacityTrigger.Day: {
        const today = ZonedTimeSystem.shopNow(
          ports.nowUtcMs(),
          timeZone,
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
        const span = await horizonSpan(timeZone);
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
        const span = await horizonSpan(timeZone);
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
