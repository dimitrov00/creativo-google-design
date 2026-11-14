import { Actor, type Role, Roles, StaffPermissions } from '@core/components';
import { type OperationId, Result, type UserId } from '@core/primitives';
import { AccessError, type RepositoryError, TeamError } from '@core/errors';
import {
  Collections,
  QueryOp,
  STAFF_PERMISSIONS_DOC,
  type StaffPermissionsSettings,
  type User,
} from '@core/entities';
import type {
  ProfileLoadPorts,
  QuerySpec,
  ReadTx,
  StaffPermissionsReadPorts,
} from '@core/ports';

/**
 * WHO IS ASKING, AND WHAT THE STAFF PIPELINES READ TO JUDGE THEM (team
 * onboarding D5, D12; staff permissions P6) — the part the team, roster
 * and analytics callables share (reuse, never copy): the caller as the
 * wire read them off the verified token, the one token gate, the two
 * readers of what `StaffAccessSystem` decides on, the act's attribution
 * and the team's whole-collection reads.
 *
 * Every converted callable asks twice. The gate below asks the token only
 * "is this a staff member" — it cannot know the owner's cells — and keeps
 * clients and anonymous callers out before anything is read. Then
 * `StaffAccessSystem.admit` judges the STORED account against
 * `settings/staffPermissions`, read beside it: a token minted before a
 * role was taken away opens nothing, and a cell the owner changed applies
 * to the next call.
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
 * The caller of a team act — a uid whose claims hold any staff role, or
 * the refusal (`TEAM_UNAUTHENTICATED`, `ACCESS_NOT_STAFF`). Which staff,
 * and for which record, the transaction decides on the stored account.
 */
export function admitTeamCaller(
  caller: TeamCaller,
): Result<UserId, TeamError | AccessError> {
  if (caller.callerUserId === null) {
    return Result.err(TeamError.unauthenticated());
  }
  return Roles.isStaff(caller.callerRoles)
    ? Result.ok(caller.callerUserId)
    : Result.err(AccessError.notStaff());
}

/** What `StaffAccessSystem` judges a caller on: their stored account and the owner's cells. */
export type StaffCallerFacts = {
  /** `users/{caller}` — `null` when the uid has no account document. */
  readonly caller: User | null;
  /** `settings/staffPermissions` through its guard — every cell at its default when there is no document. */
  readonly permissions: StaffPermissions;
};

/**
 * The caller's facts read INSIDE a transaction — two document reads that
 * join the pipeline's first read step (`Promise.all`), so they cost no
 * extra round trip and the decision is atomic with the write.
 */
export async function readStaffCaller(
  tx: ReadTx,
  callerUserId: UserId,
): Promise<StaffCallerFacts> {
  const [caller, stored] = await Promise.all([
    tx.get<User>([Collections.Users, callerUserId]),
    tx.get<StaffPermissionsSettings>([
      Collections.Settings,
      STAFF_PERMISSIONS_DOC,
    ]),
  ]);
  return { caller, permissions: StaffPermissions.read(stored) };
}

/**
 * The caller's facts read through ports, for a call with no transaction to
 * read in (the analytics pair): "as of this call", which is all a read —
 * or a write that needs no more — asks.
 */
export async function loadStaffCaller(
  ports: ProfileLoadPorts & StaffPermissionsReadPorts,
  callerUserId: UserId,
): Promise<Result<StaffCallerFacts, RepositoryError>> {
  const [profile, permissions] = await Promise.all([
    ports.loadProfile(callerUserId),
    ports.loadStaffPermissions(),
  ]);
  if (!profile.ok) return profile;
  if (!permissions.ok) return permissions;
  return Result.ok({ caller: profile.value, permissions: permissions.value });
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

/** Every roster — its id is its barber's. */
export const TEAM_ROSTERS: QuerySpec = {
  collection: [Collections.BarberSchedules],
  where: [],
  orderBy: [],
  // unbounded-ok: one roster per barber record of one tenant
  limit: null,
};

/** A shop's staff is a few dozen accounts at most; past this the Team page says so rather than paging. */
export const TEAM_STAFF_ACCOUNTS_MAX = 200;

/**
 * Every account that holds a staff role — `users where roles
 * array-contains-any Roles.STAFF` (the single-field array index of
 * `users.roles`, `firestore.indexes.json`), at most
 * {@link TEAM_STAFF_ACCOUNTS_MAX}.
 */
export const TEAM_STAFF_ACCOUNTS: QuerySpec = {
  collection: [Collections.Users],
  where: [
    {
      field: 'roles' satisfies keyof User,
      op: QueryOp.ArrayContainsAny,
      value: Roles.STAFF,
    },
  ],
  orderBy: [],
  limit: TEAM_STAFF_ACCOUNTS_MAX,
};
