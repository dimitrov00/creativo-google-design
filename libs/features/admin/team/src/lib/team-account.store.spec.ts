import { TestBed } from '@angular/core/testing';
import {
  AccountStanding,
  BarberLinkChange,
  Role,
  type TeamMember,
} from '@core/components';
import { GovernanceErrorCode, PipelineError } from '@core/errors';
import { UserId } from '@core/primitives';
import { TeamAccountStore } from './team-account.store';
import { type TeamBedOptions, teamBed } from './team-bed.spec-support';
import { TeamRolesStore } from './team-roles.store';
import { ELENA, OWNER, TEAM } from './team.fixtures.spec-support';
import { TeamStore } from './team.store';

/*
 * `TeamAccountStore`: one staff account with no barber record — its ticks
 * as drafted and the two calls its page makes, over scripted calls.
 */

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: GovernanceErrorCode.RolesForbidden,
});
/** The change was written; the person's sessions were not ended. */
const UNREVOKED = PipelineError.fromWire('functions/aborted', {
  errorCode: GovernanceErrorCode.RolesSessionsNotRevoked,
});

/** The team with one account's stored roles replaced. */
const teamWith = (
  account: TeamMember.RoleOnly,
  memberRoles: readonly Role[],
): readonly TeamMember[] =>
  TEAM.map((member) =>
    member === account ? { ...account, memberRoles } : member,
  );

/** The store on an account, the Team list read. */
async function harness(account = ELENA, options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, ...options });
  TestBed.configureTestingModule({
    providers: [...bed.providers, TeamRolesStore, TeamAccountStore],
  });
  const store = TestBed.inject(TeamAccountStore);
  const team = TestBed.inject(TeamStore);
  await team.load();
  store.open(account.memberUserId);
  return { store, team, ...bed };
}

describe('TeamAccountStore — the account and its ticks', () => {
  it('opens on the Team list’s row: the roles offered, the held ones ticked, nothing to save', async () => {
    const { store } = await harness();

    expect(store.account()).toBe(ELENA);
    expect(store.known()).toBe(true);
    expect(store.accountStanding()).toBe(AccountStanding.Editable);
    expect(store.ticks()).toEqual([
      Role.Receptionist,
      Role.ContentManager,
      Role.Admin,
    ]);
    expect(store.ticked()).toEqual([Role.Receptionist]);
    expect(store.canSave()).toBe(false);
  });

  it('a tick turned is a draft; one put back leaves nothing to save', async () => {
    const { store, calls } = await harness();

    store.toggle(Role.ContentManager);
    expect(store.ticked()).toEqual([Role.Receptionist, Role.ContentManager]);
    expect(store.canSave()).toBe(true);

    store.toggle(Role.ContentManager);
    expect(store.canSave()).toBe(false);
    expect(calls.roles).toEqual([]);
  });

  it('with no tick left there is nothing to save: leaving the team has its own door', async () => {
    const { store } = await harness();
    store.toggle(Role.Receptionist);

    expect(store.ticked()).toEqual([]);
    expect(store.canSave()).toBe(false);
    expect(await store.save()).toBe(false);
  });

  it('a list read again with the same roles keeps a draft in progress', async () => {
    const { store, team } = await harness();
    store.toggle(Role.Admin);

    await team.load();

    expect(store.ticked()).toEqual([Role.Receptionist, Role.Admin]);
  });

  it('says an account the list does not hold is not there', async () => {
    const { store } = await harness();
    store.open(UserId.of('u-nobody'));

    expect(store.account()).toBeNull();
    expect(store.known()).toBe(true);
    expect(store.ticks()).toEqual([]);
    expect(store.canSave()).toBe(false);
  });
});

describe('TeamAccountStore — «Запази»', () => {
  it('sends the whole set with the link left alone, reads the list again, and the draft follows the stored roles', async () => {
    const { store, calls, listed, listAnswers } = await harness();
    store.toggle(Role.ContentManager);
    const before = listed.length;
    listAnswers(teamWith(ELENA, [Role.Receptionist, Role.ContentManager]));

    expect(await store.save()).toBe(true);

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-elena',
        roles: [Role.Receptionist, Role.ContentManager],
        barberLinkChange: BarberLinkChange.Keep,
        linkedBarberId: null,
      }),
    ]);
    expect(listed.length).toBeGreaterThan(before);
    expect(store.saved()).toBe(true);
    expect(store.pending()).toBe(false);
    // The stored roles are the draft now: nothing is left to save.
    expect(store.ticked()).toEqual([Role.Receptionist, Role.ContentManager]);
    expect(store.canSave()).toBe(false);
  });

  it('a refused save keeps the draft and says why', async () => {
    const { store, rolesRefuse } = await harness();
    rolesRefuse(REFUSED);
    store.toggle(Role.Admin);

    expect(await store.save()).toBe(false);

    expect(store.refusal()).toBe(REFUSED);
    expect(store.saved()).toBe(false);
    expect(store.ticked()).toEqual([Role.Receptionist, Role.Admin]);
  });

  it('a change written without ending the sessions is saved, and «Опитай пак» sends it again', async () => {
    const { store, calls, rolesRefuse } = await harness();
    rolesRefuse(UNREVOKED);
    store.toggle(Role.Admin);

    expect(await store.save()).toBe(true);
    expect(store.sessionsPending()).toBe(true);
    expect(store.refusal()).toBeNull();

    rolesRefuse(null);
    expect(await store.endSessions()).toBe(true);
    expect(calls.roles).toHaveLength(2);
    expect(calls.roles[1]).toMatchObject({
      targetUserId: 'u-elena',
      roles: [Role.Receptionist, Role.Admin],
    });
    expect(store.sessionsPending()).toBe(false);
  });

  it('the receipt goes with the next tick', async () => {
    const { store } = await harness();
    store.toggle(Role.Admin);
    await store.save();
    expect(store.saved()).toBe(true);

    store.toggle(Role.ContentManager);
    expect(store.saved()).toBe(false);
  });
});

describe('TeamAccountStore — «Махни от екипа»', () => {
  it('sends the account as a client, and answers once the list has been read without it', async () => {
    const { store, calls, listAnswers } = await harness();
    listAnswers(TEAM.filter((member) => member !== ELENA));

    expect(await store.remove()).toBe(true);

    expect(calls.roles).toEqual([
      expect.objectContaining({
        targetUserId: 'u-elena',
        roles: [Role.Client],
        barberLinkChange: BarberLinkChange.Keep,
      }),
    ]);
    expect(store.account()).toBeNull();
  });

  it('a refused removal leaves the account where it was', async () => {
    const { store, rolesRefuse } = await harness();
    rolesRefuse(REFUSED);

    expect(await store.remove()).toBe(false);
    expect(store.account()).toBe(ELENA);
    expect(store.refusal()).toBe(REFUSED);
  });
});

describe('TeamAccountStore — an account that is read', () => {
  it('the viewer’s own account takes no tick, no save and no removal', async () => {
    const { store, calls } = await harness(OWNER);

    expect(store.accountStanding()).toBe(AccountStanding.Own);
    store.toggle(Role.Receptionist);
    expect(store.ticked()).toEqual([Role.Admin]);
    expect(await store.save()).toBe(false);
    expect(await store.remove()).toBe(false);
    expect(calls.roles).toEqual([]);
  });

  it('someone who assigns no roles reads a colleague’s account', async () => {
    const { store, calls } = await harness(ELENA, {
      roles: [Role.Receptionist],
      userId: UserId.of('u-other'),
    });

    expect(store.accountStanding()).toBe(AccountStanding.ReadOnly);
    store.toggle(Role.Admin);
    expect(store.canSave()).toBe(false);
    expect(await store.remove()).toBe(false);
    expect(calls.roles).toEqual([]);
  });

  it('moving to another account drops what was pending for the first', async () => {
    const { store, rolesRefuse } = await harness();
    rolesRefuse(UNREVOKED);
    store.toggle(Role.Admin);
    await store.save();
    expect(store.sessionsPending()).toBe(true);

    store.open(OWNER.memberUserId);

    expect(store.sessionsPending()).toBe(false);
    expect(store.saved()).toBe(false);
  });
});
