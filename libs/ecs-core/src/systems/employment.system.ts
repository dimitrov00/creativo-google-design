import {
  type Actor,
  AuditAction,
  BarberLifecycle,
  BarberStatus,
  BookingLifecycle,
  EmploymentOutlook,
  LeftoverBookings,
  ScheduleVersion,
  WriteOp,
  WriteProvenance,
} from '@core/components';
import {
  type BarberId,
  BusyKey,
  LocalDate,
  type OperationId,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type Appointment,
  type Barber,
  type BarberBusyDay,
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
   * Where the working period of a record in this lifecycle, with this last
   * day, stands on the shop's `today`. Only a record that WORKS has a
   * period to end: `OPEN` for one in preparation — it has never worked,
   * and is deleted, not closed — and for one that has left already; `OPEN`
   * with no last day; `ENDS` while the last day is today or ahead — the
   * barber works their last day through; `ENDED` once it is BEFORE today.
   * The one rule the period sheet words and the close reads.
   */
  outlookOf(
    lifecycle: BarberLifecycle,
    lastLocalDate: LocalDate | null,
    today: LocalDate,
  ): EmploymentOutlook {
    if (!BarberLifecycle.isLive(lifecycle) || lastLocalDate === null) {
      return EmploymentOutlook.Open;
    }
    return lastLocalDate < today
      ? EmploymentOutlook.Ended
      : EmploymentOutlook.Ends;
  },

  /**
   * Whether the record's working period is to be closed: it has `ENDED`
   * ({@link EmploymentSystem.outlookOf}) — a working record whose last day
   * is behind today. Never a record in preparation, never one that has
   * left.
   */
  isDue(barber: Barber, today: LocalDate): boolean {
    return (
      EmploymentSystem.outlookOf(
        barber,
        barber.barberLastWorkingLocalDate,
        today,
      ) === EmploymentOutlook.Ended
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
   * The days to read for what a last day would leave behind, as the keys
   * a day's visits are queried by: every busy day AFTER `lastLocalDate`
   * that holds a block, in the order given. A day with no block holds no
   * visit — the projection is rebuilt from the appointments — so it is
   * never read.
   */
  keysAfter(
    busyDays: readonly BarberBusyDay[],
    lastLocalDate: LocalDate,
  ): readonly BusyKey[] {
    const keys: BusyKey[] = [];
    for (let i = 0; i < busyDays.length; i++) {
      const day = busyDays[i] as BarberBusyDay;
      if (day.localDate > lastLocalDate && day.blocks.length > 0) {
        keys.push(BusyKey.of(day.barberId, day.localDate));
      }
    }
    return keys;
  },

  /**
   * The visits a barber's last working day leaves behind (team onboarding
   * D10): the LIVE ones (`BookingLifecycle.isLive`) that seat `barberId`
   * on a shop day AFTER `lastLocalDate` — each visit once, however many of
   * its seats are theirs or however many times the reads answered it —
   * oldest first, by day and then by start. A visit on the last day itself
   * is worked; a cancelled or finished one is nobody's to move. The
   * entities come back as they were read, so a screen lists and links them
   * with no second read.
   */
  leftoverVisitsOf(
    appointments: readonly Appointment[],
    barberId: BarberId,
    lastLocalDate: LocalDate,
  ): readonly Appointment[] {
    const seen = new Set<string>();
    const left: Appointment[] = [];
    for (let i = 0; i < appointments.length; i++) {
      const visit = appointments[i] as Appointment;
      if (
        visit.localDate > lastLocalDate &&
        BookingLifecycle.isLive(visit) &&
        visit.barberIds.includes(barberId) &&
        !seen.has(visit.id)
      ) {
        seen.add(visit.id);
        left.push(visit);
      }
    }
    return left.sort(
      (a, b) =>
        LocalDate.compare(a.localDate, b.localDate) ||
        a.startMinutes - b.startMinutes,
    );
  },

  /**
   * How many visits a last working day leaves behind, and the days they
   * fall on, each once, oldest first — what a notice says and a calendar
   * dots (`leftoverVisitsOf` is the list itself).
   */
  leftoverOf(
    appointments: readonly Appointment[],
    barberId: BarberId,
    lastLocalDate: LocalDate,
  ): LeftoverBookings {
    const left = EmploymentSystem.leftoverVisitsOf(
      appointments,
      barberId,
      lastLocalDate,
    );
    if (left.length === 0) return LeftoverBookings.NONE;
    const days: LocalDate[] = [];
    for (let i = 0; i < left.length; i++) {
      const day = (left[i] as Appointment).localDate;
      if (days[days.length - 1] !== day) days.push(day);
    }
    return { leftoverCount: left.length, leftoverLocalDates: days };
  },

  /**
   * How long after a last working day a leaver may still hold a visit —
   * as far ahead as anybody is booked (the busy projection is read no
   * further). Past it a record that has left is history: no screen looks
   * for its visits.
   */
  LINGER_DAYS: 400,

  /**
   * The barbers who have left and may still hold visits (team onboarding
   * D10, the leftover lane): the DEPARTED records whose last working day
   * is no more than `LINGER_DAYS` behind `today`, in the order given. A
   * record that left with no last day stored worked no period to leave
   * visits after, so it is not one of them.
   */
  lingerCandidates(
    barbers: readonly Barber[],
    today: LocalDate,
  ): readonly Barber[] {
    const floor = LocalDate.addDays(today, -EmploymentSystem.LINGER_DAYS);
    const out: Barber[] = [];
    for (let i = 0; i < barbers.length; i++) {
      const barber = barbers[i] as Barber;
      const last = barber.barberLastWorkingLocalDate;
      if (
        barber.barberStatus === BarberStatus.Departed &&
        last !== null &&
        last >= floor
      ) {
        out.push(barber);
      }
    }
    return out;
  },

  /**
   * Of the leavers, the ones a schedule still keeps a column for on
   * `days`: those holding a busy key (`keysAfter`) on one of them, in the
   * order given. A leaver booked on no day shown has no column — and a day
   * on or before their last working day is never theirs here: they worked
   * it as part of the team.
   */
  lingeringOn(
    leavers: readonly Barber[],
    held: ReadonlySet<BusyKey>,
    days: readonly LocalDate[],
  ): readonly Barber[] {
    const out: Barber[] = [];
    for (let i = 0; i < leavers.length; i++) {
      const leaver = leavers[i] as Barber;
      for (let d = 0; d < days.length; d++) {
        if (held.has(BusyKey.of(leaver.id, days[d] as LocalDate))) {
          out.push(leaver);
          break;
        }
      }
    }
    return out;
  },

  /**
   * A roster's versions once its barber comes back on `startLocalDate`
   * («Върни в екипа»): the week they last worked — the hours and the
   * standing breaks of the last version — stands again from that day,
   * open-ended, and the history before it is kept as it was
   * (`ScheduleVersion.replaceFrom`). The owner changes the hours from
   * there. An empty list for a roster with no version: there is no week
   * to bring back.
   */
  rosterOnReturn(
    versions: readonly ScheduleVersion[],
    startLocalDate: LocalDate,
  ): readonly ScheduleVersion[] {
    const last = versions[versions.length - 1];
    return last === undefined
      ? []
      : ScheduleVersion.replaceFrom(
          versions,
          startLocalDate,
          last.segments,
          last.breaks,
        );
  },

  /**
   * The roster write of a return: the roster set whole with the week the
   * barber last worked standing again from `startLocalDate`
   * ({@link EmploymentSystem.rosterOnReturn}), under the act's name. No
   * write for a record with no roster, or one whose roster holds no
   * version: the hours are set from the member's page.
   */
  rosterWritesOnReturn(
    schedule: BarberSchedule | null,
    startLocalDate: LocalDate,
    operationId: OperationId | null,
  ): readonly WriteOp[] {
    if (schedule === null) return [];
    const versions = EmploymentSystem.rosterOnReturn(
      schedule.versions,
      startLocalDate,
    );
    if (versions.length === 0) return [];
    const { id: _id, ...body } = schedule;
    return [
      WriteOp.set([Collections.BarberSchedules, schedule.id], {
        ...body,
        versions,
        ...WriteProvenance.of(operationId),
      }),
    ];
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
