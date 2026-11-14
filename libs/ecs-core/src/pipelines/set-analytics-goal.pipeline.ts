import {
  AnalyticsGoalKey,
  Currency,
  LogEvent,
  type OperationId,
  Result,
  StaffCapability,
  type UserId,
} from '@core/primitives';
import {
  type AccessError,
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
  StaffPermissionsReadPorts,
} from '@core/ports';
import {
  AuditSystem,
  StaffAccessSystem,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { loadStaffCaller } from './team-caller.pipeline';

/**
 * `setAnalyticsGoal` — one scope's takings goal for one month
 * (`docs/designs/staff-analytics-v2.md`, Pipelines · `setAnalyticsGoal`;
 * CUJ 6). The sandwich:
 *
 * 1. **The caller** — `users/{uid}` and `settings/staffPermissions`, read
 *    side by side (`loadStaffCaller`; a missing, blocked or erased account,
 *    or one with no staff role → `ACCESS_NOT_STAFF`), then how far
 *    `ANALYTICS` reaches for the STORED roles and link
 *    (`StaffAccessSystem.accessOf`, staff permissions P3) and **the scope**
 *    by the visibility table (`scopeOf`: nobody → `ACCESS_DENIED`, an
 *    unlinked own-only reader → `ANALYTICS_BARBER_NOT_LINKED`, an unknown
 *    record → `ANALYTICS_SCOPE_UNKNOWN`, an own-only reader naming a
 *    colleague → `ACCESS_OWN_ONLY`). Then the goal's own rule, unchanged: a
 *    barber record's goal is that barber's alone — a caller whose account
 *    is not linked to the record the scope resolved to (a whole-shop
 *    reader naming a barber's record) → `ANALYTICS_GOAL_FORBIDDEN`; the
 *    shop's goal (`null`) needs the whole shop.
 * 2. **The range and the month** — `AnalyticsGoal.rangeOrClearOf`: no
 *    range at all REMOVES the month's goal (step 3 deletes the document
 *    and writes an `ANALYTICS_GOAL_CLEARED` row); otherwise `rangeOf` (both bounds
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
  StaffPermissionsReadPorts &
  AnalyticsReadPorts &
  DefaultLocationPorts &
  LogPorts;

const S = StaffAnalyticsSystem;

export const setAnalyticsGoal =
  (ports: SetAnalyticsGoalPorts) =>
  async (
    cmd: SetAnalyticsGoalCommand,
  ): Promise<
    Result<
      SetAnalyticsGoalCall.Set,
      AnalyticsError | AccessError | RepositoryError
    >
  > => {
    const refused = <T>(
      error: AnalyticsError | AccessError,
    ): Result<T, AnalyticsError | AccessError | RepositoryError> => {
      ports.log('info', LogEvent.AnalyticsGoalRefused, {
        uid: cmd.callerUserId,
        errorCode: error.errorCode,
      });
      return Result.err(error);
    };
    const nowUtcMs = ports.nowUtcMs();

    // 1. The caller, then the scope.
    const facts = await loadStaffCaller(ports, cmd.callerUserId);
    if (!facts.ok) return facts;
    const staff = StaffAccessSystem.staffOf(facts.value.caller, nowUtcMs);
    if (!staff.ok) return refused(staff.error);
    const access = StaffAccessSystem.accessOf(
      facts.value.permissions,
      StaffCapability.Analytics,
      staff.value,
    );
    const [records, listed] = await Promise.all([
      ports.listBarberRecordIds(),
      ports.listLocations(),
    ]);
    if (!records.ok) return records;
    if (!listed.ok) return listed;
    const scope = S.scopeOf(
      access,
      { scopeBarberIds: cmd.scopeBarberId === null ? [] : [cmd.scopeBarberId] },
      records.value,
    );
    if (!scope.ok) return refused(scope.error);
    // A goal call names no location: goals are the shop's or a barber's.
    if (!S.goalScopeAllowed(scope.value, access.linkedBarberId, [])) {
      return refused(AnalyticsError.goalForbidden());
    }
    // The goal's scope: the one barber, or the shop (`null`).
    const goalBarberId = S.soleBarberOf(scope.value);

    // 2. The range, and the month on the shop's clock.
    const range = AnalyticsGoal.rangeOrClearOf(
      cmd.goalLowCents,
      cmd.goalHighCents,
    );
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

    // 3. One transaction: the goal document and its audit row — or, with
    //    no range, its removal and that row.
    const actor = Actor.forCaller(cmd.callerUserId, staff.value.roles);
    if (range.value === null) {
      const key = AnalyticsGoalKey.of(goalBarberId, cmd.goalMonth);
      const cleared = await ports.commit(
        async () => null,
        (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          Result.ok({
            writes: [
              WriteOp.remove([Collections.AnalyticsGoals, key]),
              ...AuditSystem.createsOf(
                [
                  AuditSystem.planAnalyticsGoalCleared(
                    key,
                    goalBarberId,
                    cmd.goalMonth,
                    actor,
                    cmd.operationId,
                    nowUtcMs,
                  ),
                ],
                ports.hash,
              ),
            ],
          }),
      );
      if (!cleared.ok) return cleared;
      ports.log('info', LogEvent.AnalyticsGoalCleared, {
        uid: cmd.callerUserId,
        scope: goalBarberId,
        month: cmd.goalMonth,
        key,
      });
      return Result.ok({ goalKey: key, goalSetAtUtcMs: nowUtcMs });
    }
    const goal: StoredAnalyticsGoal = {
      id: AnalyticsGoalKey.of(goalBarberId, cmd.goalMonth),
      barberId: goalBarberId,
      goalMonth: cmd.goalMonth,
      goalLowCents: range.value.goalLowCents,
      goalHighCents: range.value.goalHighCents,
      currency: Currency.EUR,
      goalSetByUserId: cmd.callerUserId,
      goalSetAtUtcMs: nowUtcMs,
    };
    const { id, ...body } = goal;
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
