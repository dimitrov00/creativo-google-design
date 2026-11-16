import { type Actor, BarberLifecycle, type WriteOp } from '@core/components';
import {
  type BarberId,
  type LocalDate,
  LogEvent,
  OperationId,
  type PrimitiveError,
  Result,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import {
  type Barber,
  type BarberLink,
  type BarberSchedule,
  Collections,
  type User,
} from '@core/entities';
import type {
  AuthSessionRevokePorts,
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  HashPorts,
  IdPorts,
  LocationLoadPorts,
  LogPorts,
} from '@core/ports';
import {
  type EmploymentClose,
  type EmploymentContext,
  type EmploymentFacts,
  EmploymentSystem,
  RoleAssignmentSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `closeBarberPeriod` — one barber's working period, closed (team
 * onboarding D10, `docs/designs/team-onboarding.md`). Nobody calls it by
 * name: the daily job runs it for every record whose last day has passed
 * (`closeEndedPeriods`), and `editBarber` runs it at once when the last
 * day it was just given is already behind the shop's today.
 *
 * 1. **ONE commit** reads the record, its account lock, the account that
 *    lock names and the roster, and asks `EmploymentSystem.close`. The
 *    record is re-read inside it, so an extension made just before the
 *    run wins: a period that has not ended writes nothing. One that has
 *    leaves: the record `DEPARTED`, the account's staff roles and link
 *    taken, the lock released, the roster closed on the last day, and the
 *    two rows credited to `actor` under the close's own name.
 * 2. **After the commit** the account's refresh tokens are revoked, so no
 *    session minted from the old roles outlives them — and only then is
 *    the marker written (`barberSessionsRevokedAtUtcMs`), in a commit of
 *    its own. A departure that still owes its revoke — this close's, or
 *    an earlier one's that failed — is tried every time this runs.
 *
 * A revoke that fails, and a marker that could not be written, leave the
 * record owing: logged (`team.sessions_not_revoked`) and answered as
 * `revokeOwed`, never as a refusal — the record has left. An ID token
 * already issued stays valid for up to an hour after a revoke: stated,
 * accepted (D10).
 */

export type CloseBarberPeriodPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  IdPorts &
  AuthSessionRevokePorts &
  LogPorts;

/** Which record, on which shop day, and whose act the close is. */
export type PeriodCloseRequest = {
  readonly barberId: BarberId;
  /** The shop's today: the period has ended once its last day is before it. */
  readonly today: LocalDate;
  /** The scheduled job, or whoever set a last day that had already passed. */
  readonly actor: Actor;
};

/** What one run left. */
export type PeriodClose = {
  /** The record left with this run. */
  readonly closed: boolean;
  /** An account's sessions are still to be ended: the next run tries again. */
  readonly revokeOwed: boolean;
};

export const closeBarberPeriod =
  (ports: CloseBarberPeriodPorts) =>
  async (
    request: PeriodCloseRequest,
  ): Promise<Result<PeriodClose, RepositoryError | PrimitiveError>> => {
    const { barberId } = request;
    const recordPath = [Collections.Barbers, barberId];
    // Read once, before the transaction: `decide` may run more than once.
    const named = contextOf(ports, request);
    if (!named.ok) return named;
    const committed = await ports.commit(
      async (tx): Promise<EmploymentFacts> => {
        const [barber, lock, schedule] = await Promise.all([
          tx.get<Barber>(recordPath),
          tx.get<BarberLink>(RoleAssignmentSystem.lockPathOf(barberId)),
          tx.get<BarberSchedule>([Collections.BarberSchedules, barberId]),
        ]);
        const account =
          lock === null
            ? null
            : await tx.get<User>([Collections.Users, lock.linkedUserId]);
        return { barber, lock, account, schedule };
      },
      (facts): Result<EmploymentClose, never> =>
        Result.ok(EmploymentSystem.close(facts, named.value, ports.hash)),
    );
    if (!committed.ok) return committed;
    const { closed, revokeUserId } = committed.value;
    if (closed) {
      ports.log('info', LogEvent.TeamPeriodClosed, {
        barberId,
        tookAccess: revokeUserId !== null,
      });
    }
    if (revokeUserId === null) return Result.ok({ closed, revokeOwed: false });

    // The roles are written: no session minted from the old ones may outlive them.
    const revoked = await ports.revokeRefreshTokens(revokeUserId);
    if (!revoked.ok) {
      ports.log('error', LogEvent.TeamSessionsNotRevoked, {
        barberId,
        errorCode: revoked.error.errorCode,
      });
      return Result.ok({ closed, revokeOwed: true });
    }
    // The marker is an act of its own: a later instant, its own name.
    const marker = contextOf(ports, request);
    const marked = marker.ok
      ? await ports.commit(
          (tx) => tx.get<Barber>(recordPath),
          (barber): Result<{ readonly writes: readonly WriteOp[] }, never> =>
            Result.ok({
              writes: EmploymentSystem.revoked(
                barber,
                marker.value,
                ports.hash,
              ),
            }),
        )
      : marker;
    if (!marked.ok) {
      ports.log('error', LogEvent.TeamSessionsNotRevoked, {
        barberId,
        errorCode: marked.error.errorCode,
      });
      return Result.ok({ closed, revokeOwed: true });
    }
    return Result.ok({ closed, revokeOwed: false });
  };

/** One act of a close: this instant, a fresh name, the request's day and actor. */
function contextOf(
  ports: ClockPorts & IdPorts,
  request: PeriodCloseRequest,
): Result<EmploymentContext, PrimitiveError> {
  const operationId = OperationId.parse(ports.nextId());
  return operationId.ok
    ? Result.ok({
        today: request.today,
        nowUtcMs: ports.nowUtcMs(),
        operationId: operationId.value,
        actor: request.actor,
      })
    : operationId;
}

/**
 * The revoke a departure still owes, tried now — «Опитай пак» on the Team
 * page (`editBarber`, `END_SESSIONS`): the step the daily job retries each
 * night, credited to whoever asked. `true` while the sessions are still
 * owed: the revoke failed again, its marker could not be written, or the
 * run could not start (the shop's clock, the store). A record that owes
 * nothing reads nothing and answers `false`.
 */
export const endOwedSessions =
  (ports: CloseIfEndedPorts) =>
  async (barber: Barber, actor: Actor): Promise<boolean> => {
    if (!BarberLifecycle.awaitsRevoke(barber)) return false;
    const failed = (errorCode: string): true => {
      ports.log('error', LogEvent.TeamSessionsNotRevoked, {
        barberId: barber.id,
        errorCode,
      });
      return true;
    };
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return failed(zone.error.errorCode);
    const closed = await closeBarberPeriod(ports)({
      barberId: barber.id,
      today: ZonedTimeSystem.shopNow(ports.nowUtcMs(), zone.value).localDate,
      actor,
    });
    return closed.ok ? closed.value.revokeOwed : failed(closed.error.errorCode);
  };

export type CloseIfEndedPorts = CloseBarberPeriodPorts &
  LocationLoadPorts &
  DefaultLocationPorts;

/**
 * A record whose period may have ended the moment it was written
 * (`editBarber`, a last day already behind the shop's today): closed at
 * once, by the same close the daily job runs, credited to whoever set the
 * day. «Today» is the default shop's, as the job's is.
 *
 * It answers nothing: the edit that brought it here has landed. A close
 * that could not run is logged (`team.period_close_failed`) and the daily
 * job catches it up.
 */
export const closeIfEnded =
  (ports: CloseIfEndedPorts) =>
  async (barber: Barber, actor: Actor): Promise<void> => {
    // No last day: nothing to ask, and no shop clock to read.
    if (barber.barberLastWorkingLocalDate === null) return;
    const failed = (errorCode: string): void =>
      ports.log('error', LogEvent.TeamPeriodCloseFailed, {
        barberId: barber.id,
        errorCode,
      });
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return failed(zone.error.errorCode);
    const today = ZonedTimeSystem.shopNow(
      ports.nowUtcMs(),
      zone.value,
    ).localDate;
    if (!EmploymentSystem.isDue(barber, today)) return;
    const closed = await closeBarberPeriod(ports)({
      barberId: barber.id,
      today,
      actor,
    });
    if (!closed.ok) failed(closed.error.errorCode);
  };
