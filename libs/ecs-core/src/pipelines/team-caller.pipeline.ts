import { Actor, type Role, Roles } from '@core/components';
import { type OperationId, Result, type UserId } from '@core/primitives';
import { TeamError } from '@core/errors';
import { Collections, type User } from '@core/entities';
import type { QuerySpec } from '@core/ports';

/**
 * WHO IS ASKING, AND WHAT THE TEAM PIPELINES READ (team onboarding D5,
 * D12) — the part `addBarber`, `editBarber`, `activateBarber` and
 * `deleteDraftBarber` share (reuse, never copy): the caller as the wire
 * read them off the verified token, the two token gates, the act's
 * attribution and the three whole-collection reads.
 *
 * Every team callable asks twice: the gate below on the token's claims,
 * before anything is read, then `TeamSystem.admit…` on the STORED roles,
 * block and barber link inside the transaction — a token minted before a
 * role was taken away opens nothing.
 */

/** The verified caller — never the payload's. */
export type TeamCaller = {
  /** The verified session's uid; `null` without one. */
  readonly callerUserId: UserId | null;
  /** The verified token's known roles — the wire's gate read them. */
  readonly callerRoles: readonly Role[];
};

/** One team act: the verified caller and the act's name. */
export type TeamAct = TeamCaller & {
  /** The act's name (WS-4.1) — REQUIRED on the team wire: a replay is the same act. */
  readonly operationId: OperationId;
};

/**
 * The caller of an act that only the team's manager may make — a uid whose
 * claims hold a `Roles.TEAM` role, or the refusal
 * (`TEAM_UNAUTHENTICATED`, `TEAM_FORBIDDEN`).
 */
export function admitTeamCaller(caller: TeamCaller): Result<UserId, TeamError> {
  if (caller.callerUserId === null) {
    return Result.err(TeamError.unauthenticated());
  }
  return Roles.managesTeam(caller.callerRoles)
    ? Result.ok(caller.callerUserId)
    : Result.err(TeamError.forbidden());
}

/**
 * The caller of an act a wider circle may make (a profile edit, the
 * go-live step) — a uid whose claims hold any staff role; which staff, and
 * for which record, the transaction decides on the stored account.
 */
export function admitTeamStaffCaller(
  caller: TeamCaller,
): Result<UserId, TeamError> {
  if (caller.callerUserId === null) {
    return Result.err(TeamError.unauthenticated());
  }
  return Roles.isStaff(caller.callerRoles)
    ? Result.ok(caller.callerUserId)
    : Result.err(TeamError.forbidden());
}

/** Who the audit row credits: the caller, over the roles their account STORES. */
export function teamActor(callerUserId: UserId, stored: User): Actor {
  return Actor.forCaller(callerUserId, stored.roles);
}

/** Every shop — listed or not, a location is one a barber can be placed at. */
export const TEAM_LOCATIONS: QuerySpec = {
  collection: [Collections.Locations],
  where: [],
  orderBy: [],
  // unbounded-ok: the shops of one tenant
  limit: null,
};

/** Every barber record, whatever its lifecycle — a new one sorts after them all. */
export const TEAM_BARBERS: QuerySpec = {
  collection: [Collections.Barbers],
  where: [],
  orderBy: [],
  // unbounded-ok: the team of one tenant
  limit: null,
};

/** Every service, whatever its status — a barber's offerings live on them. */
export const TEAM_SERVICES: QuerySpec = {
  collection: [Collections.Services],
  where: [],
  orderBy: [],
  // unbounded-ok: the catalogue of one tenant
  limit: null,
};
