import {
  AnalyticsGoalKey,
  Currency,
  LogEvent,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import {
  AnalyticsError,
  CatalogErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  Actor,
  AnalyticsGoal,
  type SetAnalyticsGoalCall,
  WriteOp,
} from '@core/components';
import { Collections, type StoredAnalyticsGoal } from '@core/entities';
import type {
  AnalyticsReadPorts,
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  HashPorts,
  LogPorts,
  ProfileLoadPorts,
} from '@core/ports';
import {
  AuditSystem,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `setAnalyticsGoal` — one scope's takings goal for one month
 * (`docs/designs/staff-analytics-v2.md`, Pipelines · `setAnalyticsGoal`;
 * CUJ 6). The sandwich:
 *
 * 1. **The caller** — `users/{uid}`, its STORED roles, block and barber link
 *    (`StaffAnalyticsSystem.callerOf`; no record → `ANALYTICS_FORBIDDEN`),
 *    then **the scope** by the visibility table (`scopeOf`, v1's codes: a
 *    blocked account or a role outside analytics → `ANALYTICS_FORBIDDEN`, an
 *    unlinked barber → `ANALYTICS_BARBER_NOT_LINKED`, an unknown record →
 *    `ANALYTICS_SCOPE_UNKNOWN`, a barber naming a colleague →
 *    `ANALYTICS_FORBIDDEN`). Then the goal's own rule: a barber record's
 *    goal is that barber's alone — a caller whose account is not linked to
 *    the record the scope resolved to (an admin naming a barber's record)
 *    → `ANALYTICS_GOAL_FORBIDDEN`; the shop's goal (`null`) is any admin's.
 * 2. **The range and the month** — `AnalyticsGoal.rangeOf` (both bounds
 *    positive whole cents, low ≤ high; the field at fault named) and
 *    `StaffAnalyticsSystem.goalMonthAllowed`: the current or the next month
 *    on the default shop's clock (else the first shop's), derived ONCE from
 *    `nowUtcMs` → `ANALYTICS_GOAL_INVALID_RANGE` on `goalMonth`.
 * 3. **One transaction** (Law 4) — `analyticsGoals/{key}` SET to the whole
 *    body (the entity minus `id`: the scope, month, range, `currency:
 *    'EUR'`, the caller as `goalSetByUserId`, the clock as
 *    `goalSetAtUtcMs`) — a set overwrites the month's earlier goal — and its
 *    ONE `ANALYTICS_GOAL_SET` row (`AuditSystem.planAnalyticsGoalSet`,
 *    credited through `Actor.forCaller` over the STORED roles) under
 *    `hash(idBasis)`; the row lands with the goal or not at all. Nothing is
 *    read inside the transaction: the decision was made on the reads above.
 * 4. **Log** `LogEvent.AnalyticsGoalSet` — the caller, the scope and the
 *    month, never the bounds; a refusal logs `AnalyticsGoalRefused` with its
 *    code.
 *
 * The answer: `{ goalKey, goalSetAtUtcMs }`. A read or commit that fails
 * answers its `RepositoryError`.
 */

/** The call as the wire decoded it, with the verified caller and the act's transport id. */
export type SetAnalyticsGoalCommand = SetAnalyticsGoalCall & {
  readonly callerUserId: UserId;
  /** The call's transport operation id (RU-21) — `null` when the payload named none. */
  readonly operationId: OperationId | null;
};

export type SetAnalyticsGoalPorts = CommitPorts &
  HashPorts &
  ClockPorts &
  ProfileLoadPorts &
  AnalyticsReadPorts &
  DefaultLocationPorts &
  LogPorts;

const S = StaffAnalyticsSystem;

export const setAnalyticsGoal =
  (ports: SetAnalyticsGoalPorts) =>
  async (
    cmd: SetAnalyticsGoalCommand,
  ): Promise<
    Result<SetAnalyticsGoalCall.Set, AnalyticsError | RepositoryError>
  > => {
    const refused = <T>(
      error: AnalyticsError,
    ): Result<T, AnalyticsError | RepositoryError> => {
      ports.log('info', LogEvent.AnalyticsGoalRefused, {
        uid: cmd.callerUserId,
        errorCode: error.errorCode,
      });
      return Result.err(error);
    };
    const nowUtcMs = ports.nowUtcMs();

    // 1. The caller, then the scope.
    const profile = await ports.loadProfile(cmd.callerUserId);
    if (!profile.ok) return profile;
    const caller = S.callerOf(profile.value, nowUtcMs);
    if (!caller.ok) return refused(caller.error);
    const [records, listed] = await Promise.all([
      ports.listBarberRecordIds(),
      ports.listLocations(),
    ]);
    if (!records.ok) return records;
    if (!listed.ok) return listed;
    const scope = S.scopeOf(caller.value, cmd, records.value);
    if (!scope.ok) return refused(scope.error);
    // A goal call names no location: goals are the shop's or a barber's.
    if (!S.goalScopeAllowed(scope.value, caller.value.linkedBarberId, null)) {
      return refused(AnalyticsError.goalForbidden());
    }

    // 2. The range, and the month on the shop's clock.
    const range = AnalyticsGoal.rangeOf(cmd.goalLowCents, cmd.goalHighCents);
    if (!range.ok) return refused(range.error);
    const clock = S.clockLocationOf(listed.value, ports.defaultLocationId);
    if (clock === null) {
      return Result.err(
        RepositoryError.readFailed(
          `${Collections.Locations}/${ports.defaultLocationId}`,
          CatalogErrorCode.LocationZoneUnknown,
        ),
      );
    }
    const today = ZonedTimeSystem.shopNow(nowUtcMs, clock.timeZone).localDate;
    if (!S.goalMonthAllowed(cmd.goalMonth, today)) {
      return refused(AnalyticsError.goalInvalidRange('goalMonth'));
    }

    // 3. One transaction: the goal document and its audit row.
    const goal: StoredAnalyticsGoal = {
      id: AnalyticsGoalKey.of(scope.value, cmd.goalMonth),
      barberId: scope.value,
      goalMonth: cmd.goalMonth,
      goalLowCents: range.value.goalLowCents,
      goalHighCents: range.value.goalHighCents,
      currency: Currency.EUR,
      goalSetByUserId: cmd.callerUserId,
      goalSetAtUtcMs: nowUtcMs,
    };
    const { id, ...body } = goal;
    const actor = Actor.forCaller(cmd.callerUserId, profile.value?.roles ?? []);
    const committed = await ports.commit(
      async () => null,
      (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
        Result.ok({
          writes: [
            WriteOp.set([Collections.AnalyticsGoals, id], body),
            ...AuditSystem.createsOf(
              [AuditSystem.planAnalyticsGoalSet(goal, actor, cmd.operationId)],
              ports.hash,
            ),
          ],
        }),
    );
    if (!committed.ok) return committed;

    // 4. The log line — the scope and the month, never money.
    ports.log('info', LogEvent.AnalyticsGoalSet, {
      uid: cmd.callerUserId,
      scope: goal.barberId,
      month: goal.goalMonth,
      key: goal.id,
    });
    return Result.ok({ goalKey: goal.id, goalSetAtUtcMs: nowUtcMs });
  };
