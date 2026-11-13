import { describe, expect, it } from 'vitest';
import { Actor, Role } from '@core/components';
import { UserId } from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import { registeredUserFixture, unwrapErr, unwrapOk } from '@core/testing';
import {
  admitTeamCaller,
  admitTeamStaffCaller,
  TEAM_BARBERS,
  TEAM_LOCATIONS,
  TEAM_SERVICES,
  type TeamCaller,
  teamActor,
} from './team-caller.pipeline';

const UID = UserId.of('u-caller');
const caller = (
  roles: readonly Role[],
  callerUserId: UserId | null = UID,
): TeamCaller => ({ callerUserId, callerRoles: roles });

describe('admitTeamCaller — the token gate of the team manager’s acts', () => {
  it('admits a token holding the admin role', () => {
    expect(unwrapOk(admitTeamCaller(caller([Role.Admin])))).toBe(UID);
    expect(unwrapOk(admitTeamCaller(caller([Role.Barber, Role.Admin])))).toBe(
      UID,
    );
  });

  it('refuses no session as TEAM_UNAUTHENTICATED — before the roles are read', () => {
    expect(unwrapErr(admitTeamCaller(caller([Role.Admin], null)))).toEqual({
      errorCode: TeamErrorCode.Unauthenticated,
    });
  });

  it('refuses every other role as TEAM_FORBIDDEN — the sysadmin and the content editor too', () => {
    for (const role of [
      Role.Sysadmin,
      Role.ContentManager,
      Role.Receptionist,
      Role.Barber,
      Role.Client,
    ]) {
      expect(unwrapErr(admitTeamCaller(caller([role]))), role).toEqual({
        errorCode: TeamErrorCode.Forbidden,
      });
    }
    expect(admitTeamCaller(caller([])).ok).toBe(false);
  });
});

describe('admitTeamStaffCaller — the token gate of a profile edit and the go-live step', () => {
  it('admits any staff role', () => {
    for (const role of [
      Role.Admin,
      Role.ContentManager,
      Role.Receptionist,
      Role.Barber,
    ]) {
      expect(unwrapOk(admitTeamStaffCaller(caller([role]))), role).toBe(UID);
    }
  });

  it('refuses no session, a client and an empty claim', () => {
    expect(unwrapErr(admitTeamStaffCaller(caller([Role.Admin], null)))).toEqual(
      { errorCode: TeamErrorCode.Unauthenticated },
    );
    expect(unwrapErr(admitTeamStaffCaller(caller([Role.Client])))).toEqual({
      errorCode: TeamErrorCode.Forbidden,
    });
    expect(admitTeamStaffCaller(caller([])).ok).toBe(false);
  });
});

describe('teamActor — who a team row credits', () => {
  it('credits the caller over the roles their account STORES', () => {
    expect(
      teamActor(UID, registeredUserFixture({ id: UID, roles: [Role.Admin] })),
    ).toEqual(Actor.forCaller(UID, [Role.Admin]));
    expect(
      teamActor(
        UID,
        registeredUserFixture({ id: UID, roles: [Role.Receptionist] }),
      ),
    ).toEqual(Actor.forCaller(UID, [Role.Receptionist]));
  });
});

describe('the team pipelines’ whole-collection reads', () => {
  it('read every shop, barber record and service — no filter, no order, no limit', () => {
    expect([TEAM_LOCATIONS, TEAM_BARBERS, TEAM_SERVICES]).toEqual([
      {
        collection: [Collections.Locations],
        where: [],
        orderBy: [],
        limit: null,
      },
      {
        collection: [Collections.Barbers],
        where: [],
        orderBy: [],
        limit: null,
      },
      {
        collection: [Collections.Services],
        where: [],
        orderBy: [],
        limit: null,
      },
    ]);
  });
});
