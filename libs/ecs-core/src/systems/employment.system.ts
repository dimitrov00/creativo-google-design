import {
  type Actor,
  AuditAction,
  BarberLifecycle,
  BarberStatus,
  EmploymentOutlook,
  ScheduleVersion,
  WriteOp,
  WriteProvenance,
} from '@core/components';
import type {
  BarberId,
  LocalDate,
  OperationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  type Barber,
  type BarberLink,
  type BarberSchedule,
  Collections,
  type User,
} from '@core/entities';
import { AuditSystem } from './audit.system';
import { RoleAssignmentSystem } from './role-assignment.system';
import { TeamSystem } from './team.system';

/** What a close read inside its commit. */
export type EmploymentFacts = {
  /** The record; `null` when it is gone. */
  readonly barber: Barber | null;
  /** The record's account lock; `null` when nobody is linked. */
  readonly lock: BarberLink | null;
  /** The account that lock names; `null` when nobody is linked, or the account is gone. */
  readonly account: User | null;
  /** The record's roster; `null` when it has none. */
  readonly schedule: BarberSchedule | null;
};

/** Whose act a close is, on which shop day, at which instant, under which name. */
export type EmploymentContext = {
  /** The shop's today: a period has ended once its last day is before it. */
  readonly today: LocalDate;
  readonly nowUtcMs: UtcEpochMs;
  /** The close's own name: on the record, the roster and both rows. */
  readonly operationId: OperationId;
  /** The scheduled job, or whoever set a last day that had already passed. */
  readonly actor: Actor;
};

/** One close, decided. */
export type EmploymentClose = {
  /** The record left with this plan; `false` when it was not due. */
  readonly closed: boolean;
  /**
   * The account whose sessions are to be ended once the plan has landed:
   * the one this close took staff access from, or the one an earlier close
   * still owes a revoke. `null` for none.
   */
  readonly revokeUserId: UserId | null;
  readonly writes: readonly WriteOp[];
};

/** Nothing to do, and nobody to sign out. */
const NOTHING: EmploymentClose = {
  closed: false,
  revokeUserId: null,
  writes: [],
};

/**
 * EmploymentSystem — the end of a barber's working period (team onboarding
 * D10, `docs/designs/team-onboarding.md`). A period ends by itself: the
 * owner sets a last working day, and once that day is behind the shop's
 * today the record leaves. Pure: the pipeline reads the record, its lock,
 * the account the lock names and the roster inside ONE commit, asks, and
 * writes the plan this answers.
 *
 * Nobody is asking, so `RoleAssignmentSystem.decide` — which judges a
 * person's request — is never part of it: what happens to the account is
 * `RoleAssignmentSystem.departureOf`, a consequence.
 */
export const EmploymentSystem = {
  /**
   * Where a working period with this last day stands on the shop's
   * `today`: `OPEN` with no last day; `ENDS` while the last day is today
   * or ahead — the barber works their last day through; `ENDED` once it is
   * BEFORE today. The one rule the period sheet words and the close reads.
   */
  outlookOf(
    lastLocalDate: LocalDate | null,
    today: LocalDate,
  ): EmploymentOutlook {
    if (lastLocalDate === null) return EmploymentOutlook.Open;
    return lastLocalDate < today
      ? EmploymentOutlook.Ended
      : EmploymentOutlook.Ends;
  },

  /**
   * Whether the record's working period is to be closed: it has `ENDED`
   * ({@link EmploymentSystem.outlookOf}) and the record has not left
   * already. A record in preparation counts: one whose period ended before
   * it ever went live leaves too.
   */
  isDue(barber: Barber, today: LocalDate): boolean {
    return (
      barber.barberStatus !== BarberStatus.Departed &&
      EmploymentSystem.outlookOf(barber.barberLastWorkingLocalDate, today) ===
        EmploymentOutlook.Ended
    );
  },

  /**
   * The records a run of the daily close works on, in the order given:
   * every one whose period has ended, and every departure that still owes
   * its account a revoke — so a day the job missed, and a revoke that
   * failed, are both caught up by the next run.
   */
  dueOf(barbers: readonly Barber[], today: LocalDate): readonly BarberId[] {
    const due: BarberId[] = [];
    for (let i = 0; i < barbers.length; i++) {
      const barber = barbers[i] as Barber;
      if (
        EmploymentSystem.isDue(barber, today) ||
        BarberLifecycle.awaitsRevoke(barber)
      ) {
        due.push(barber.id);
      }
    }
    return due;
  },

  /**
   * A roster's versions once its barber has left after `lastLocalDate`:
   * every version that began on or before that day, the one in force on
   * it ending there, and every later version dropped — so nothing counts
   * rostered minutes past the last day. The versions themselves where
   * nothing moved; an empty list when the roster began after the last day.
   */
  rosterAfter(
    versions: readonly ScheduleVersion[],
    lastLocalDate: LocalDate,
  ): readonly ScheduleVersion[] {
    const kept: ScheduleVersion[] = [];
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i] as ScheduleVersion;
      if (version.effectiveFromLocalDate > lastLocalDate) continue;
      kept.push(
        version.effectiveToLocalDate === null ||
          version.effectiveToLocalDate > lastLocalDate
          ? ScheduleVersion.closedAt(version, lastLocalDate)
          : version,
      );
    }
    return kept;
  },

  /**
   * One record's close. For a record that is gone, or whose period has
   * not ended (an extension made just before the run wins), nothing —
   * beside the revoke an earlier close still owes. For one that is due,
   * ONE plan:
   *
   * - **the record**, set whole as `DEPARTED` (`TeamSystem.depart`) beside
   *   its `TEAM_BARBER_STATUS_CHANGED` row;
   * - **the account** the lock names: its staff roles and its link taken
   *   (`RoleAssignmentSystem.departureOf`) beside its
   *   `PROFILE_ROLES_CHANGED` row. An admin's roles are left alone, and
   *   then the record names no account to sign out;
   * - **the lock**, released, whether or not its account is still there;
   * - **the roster**, closed on the last day (`rosterAfter`), or removed
   *   when no version is left.
   *
   * Both rows are credited to `context.actor` under the close's one name.
   */
  close(
    facts: EmploymentFacts,
    context: EmploymentContext,
    hash: (input: string) => string,
  ): EmploymentClose {
    const { barber, lock, account, schedule } = facts;
    if (barber === null) return NOTHING;
    const lastLocalDate = barber.barberLastWorkingLocalDate;
    if (
      lastLocalDate === null ||
      !EmploymentSystem.isDue(barber, context.today)
    ) {
      return BarberLifecycle.awaitsRevoke(barber)
        ? { ...NOTHING, revokeUserId: barber.barberDepartedUserId }
        : NOTHING;
    }
    const { nowUtcMs, operationId, actor } = context;
    const assignment =
      account === null
        ? null
        : RoleAssignmentSystem.departureOf(account, barber.id);
    // Staff access was taken only where the roles moved: an admin keeps theirs.
    const revokeUserId =
      account !== null && assignment !== null && assignment.rolesChanged
        ? account.id
        : null;
    const writes: WriteOp[] = [
      ...TeamSystem.writesOf(
        {
          action: AuditAction.TeamBarberStatusChanged,
          before: barber,
          after: TeamSystem.depart(barber, revokeUserId, nowUtcMs, operationId),
          actor,
          nowUtcMs,
          operationId,
        },
        hash,
      ),
    ];
    if (account !== null && assignment !== null) {
      // The lock rides the assignment: released beside the account's fields.
      writes.push(
        ...RoleAssignmentSystem.writesOf(account.id, assignment, nowUtcMs),
      );
      if (assignment.rolesChanged || assignment.linkChanged) {
        writes.push(
          ...AuditSystem.createsOf(
            [
              AuditSystem.planRolesChanged(
                account.id,
                assignment,
                actor,
                nowUtcMs,
                operationId,
              ),
            ],
            hash,
          ),
        );
      }
    } else if (lock !== null) {
      // A lock whose account is gone is released all the same.
      writes.push(WriteOp.remove(RoleAssignmentSystem.lockPathOf(barber.id)));
    }
    if (schedule !== null) {
      const versions = EmploymentSystem.rosterAfter(
        schedule.versions,
        lastLocalDate,
      );
      const path = [Collections.BarberSchedules, schedule.id];
      if (versions.length === 0) {
        writes.push(WriteOp.remove(path));
      } else if (!sameVersions(schedule.versions, versions)) {
        const { id: _id, ...body } = schedule;
        writes.push(
          WriteOp.set(path, {
            ...body,
            versions,
            ...WriteProvenance.of(operationId),
          }),
        );
      }
    }
    return { closed: true, revokeUserId, writes };
  },

  /**
   * The marker of a revoke that succeeded: a departure that owed one, set
   * whole with its account's sessions ended at `nowUtcMs`, beside its own
   * `TEAM_BARBER_STATUS_CHANGED` row. Nothing for any other record — a
   * record gone, one that came back, one whose marker is already set.
   */
  revoked(
    barber: Barber | null,
    context: EmploymentContext,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    if (barber === null) return [];
    return TeamSystem.writesOf(
      {
        action: AuditAction.TeamBarberStatusChanged,
        before: barber,
        after: TeamSystem.sessionsRevoked(
          barber,
          context.nowUtcMs,
          context.operationId,
        ),
        actor: context.actor,
        nowUtcMs: context.nowUtcMs,
        operationId: context.operationId,
      },
      hash,
    );
  },
} as const;

/** Whether `rosterAfter` moved nothing: it answers the versions themselves where it did not. */
function sameVersions(
  before: readonly ScheduleVersion[],
  after: readonly ScheduleVersion[],
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return false;
  }
  return true;
}
