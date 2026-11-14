import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  AUTH_SESSION_PORTS,
  PROFILE_PORTS,
  STAFF_PERMISSIONS_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { type Principal, Role, StaffPermissions } from '@core/components';
import type { User } from '@core/entities';
import type { ProfilePorts, StaffPermissionsStreamPorts } from '@core/ports';
import {
  AccessScope,
  BarberId,
  Result,
  StaffCapability,
  UserId,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  memoryAuthSessionPorts,
  memoryProfilePorts,
  principalFixture,
  registeredUserFixture,
} from '@core/testing';
import { StaffAccessService } from './staff-access.service';

/*
 * `StaffAccessService` (staff permissions P8; stage T's unit exit test):
 * the service's signals over a fake stream. What it promises: the STORED
 * roles decide once the account has loaded, the token's until then; cells
 * that have not answered, or cannot be read, grant nothing; a change of the
 * cells or of the account is followed with no reload; and a route's gate
 * waits for both.
 */

type ProfileAnswer = Result<User | null, RepositoryError>;
type CellsAnswer = Result<StaffPermissions, RepositoryError>;

const { None, Own, All } = AccessScope;
const { Hours, TimeOff, Analytics, TeamManage } = StaffCapability;

const UID = UserId.of('user_1');
const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const ANONYMOUS = principalFixture.anonymous();

const staff = (...roles: Role[]): Principal =>
  principalFixture.staff(UID, roles);

/** The stored account: its roles and the record it is linked to. */
const account = (
  roles: readonly Role[],
  linkedBarberId: BarberId | null = null,
  id: UserId = UID,
): User => registeredUserFixture({ id, roles, linkedBarberId });

const cellsOf = (stored: Record<string, unknown>): CellsAnswer =>
  Result.ok(StaffPermissions.read(stored));

const REFUSED: CellsAnswer = Result.err(
  RepositoryError.readFailed('settings/staffPermissions', 'permission-denied'),
);

/**
 * A session whose account and cells are each a live stream the test pushes
 * at: one subject per listener, so it can also be seen whether a listener
 * was opened and whether it was closed.
 */
function harness(initial: Principal) {
  const principal = new BehaviorSubject<Principal>(initial);
  const profiles: { uid: UserId; answers: Subject<ProfileAnswer> }[] = [];
  const cells: { answers: Subject<CellsAnswer>; closed: boolean }[] = [];

  const observeProfile = vi.fn(
    (userId: UserId) =>
      new Observable<ProfileAnswer>((subscriber) => {
        const listener = { uid: userId, answers: new Subject<ProfileAnswer>() };
        profiles.push(listener);
        return listener.answers.subscribe(subscriber);
      }),
  );
  const observeStaffPermissions = vi.fn(
    () =>
      new Observable<CellsAnswer>((subscriber) => {
        const listener = { answers: new Subject<CellsAnswer>(), closed: false };
        cells.push(listener);
        const inner = listener.answers.subscribe(subscriber);
        return () => {
          listener.closed = true;
          inner.unsubscribe();
        };
      }),
  );

  TestBed.configureTestingModule({
    providers: [
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({ principals$: principal }),
      },
      {
        provide: PROFILE_PORTS,
        useValue: {
          ...memoryProfilePorts(new Map()),
          observeProfile,
        } satisfies ProfilePorts,
      },
      {
        provide: STAFF_PERMISSIONS_PORTS,
        useValue: {
          observeStaffPermissions,
        } satisfies StaffPermissionsStreamPorts,
      },
    ],
  });
  const service = TestBed.inject(StaffAccessService);
  TestBed.tick();

  const last = <T>(listeners: readonly T[], what: string): T => {
    const listener = listeners.at(-1);
    if (!listener) throw new Error(`no ${what} listener`);
    return listener;
  };

  return {
    service,
    cells,
    observeStaffPermissions,
    /** The stored account answers. */
    stored: (answer: User | null) => {
      last(profiles, 'account').answers.next(Result.ok(answer));
      TestBed.tick();
    },
    /** The cells answer. */
    permissions: (answer: CellsAnswer) => {
      last(cells, 'cells').answers.next(answer);
      TestBed.tick();
    },
    signIn: (next: Principal) => {
      principal.next(next);
      TestBed.tick();
    },
    /** The session restores `next` and nothing has reacted to it yet. */
    arrive: (next: Principal) => principal.next(next),
  };
}

describe('StaffAccessService — how far a capability reaches', () => {
  it('answers each level its standard once the account and the cells have answered', () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    stored(account([Role.Barber], IVAN));
    permissions(cellsOf({}));

    expect(service.scopeOf(Hours)).toBe(Own);
    expect(service.scopeOf(Analytics)).toBe(Own);
    expect(service.scopeOf(TeamManage)).toBe(None);
    expect(service.accessOf(Hours)).toEqual({
      accessScope: Own,
      linkedBarberId: IVAN,
    });
    // Own reaches the person's own record and no colleague's.
    expect(service.mayFor(Hours, IVAN)).toBe(true);
    expect(service.mayFor(Hours, NIKO)).toBe(false);
    expect(service.mayFor(TeamManage, IVAN)).toBe(false);
  });

  it('reaches every record for a level the standard gives everyone', () => {
    const { service, stored, permissions } = harness(staff(Role.Receptionist));
    stored(account([Role.Receptionist]));
    permissions(cellsOf({}));

    expect(service.scopeOf(Hours)).toBe(All);
    expect(service.mayFor(Hours, IVAN)).toBe(true);
    expect(service.mayFor(TimeOff, NIKO)).toBe(true);
    // The front desk reads no analytics on the standard.
    expect(service.scopeOf(Analytics)).toBe(None);
  });

  it('follows the owner’s save with no reload: a narrowed level loses the reach, a widened one gains it', () => {
    const { service, stored, permissions } = harness(staff(Role.Receptionist));
    stored(account([Role.Receptionist]));
    permissions(cellsOf({}));
    expect(service.mayFor(Hours, IVAN)).toBe(true);

    permissions(cellsOf({ receptionistHoursScope: None }));
    expect(service.scopeOf(Hours)).toBe(None);
    expect(service.mayFor(Hours, IVAN)).toBe(false);

    permissions(
      cellsOf({
        receptionistHoursScope: None,
        receptionistAnalyticsScope: All,
      }),
    );
    expect(service.scopeOf(Analytics)).toBe(All);
  });

  it('is reactive: a computed that asks follows the cells', () => {
    const { service, stored, permissions } = harness(staff(Role.Receptionist));
    stored(account([Role.Receptionist]));
    permissions(cellsOf({}));
    const seen: boolean[] = [];
    TestBed.runInInjectionContext(() => {
      // An effect stands for a template: it re-reads when what it read changes.
      effect(() => seen.push(service.mayFor(Hours, IVAN)));
    });
    TestBed.tick();

    permissions(cellsOf({ receptionistHoursScope: None }));

    expect(seen).toEqual([true, false]);
  });
});

describe('StaffAccessService — the stored roles decide', () => {
  it('grants nothing on a half-read session: no entry point before the account has answered', () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    permissions(cellsOf({}));
    // The account has not answered. The token says barber, and the standard
    // would say "own" — but a decision made now could change a beat later.
    expect(service.storedRoles()).toEqual([Role.Barber]);
    expect(service.settled()).toBe(false);
    expect(service.scopeOf(Hours)).toBe(None);
    expect(service.mayFor(Hours, IVAN)).toBe(false);

    stored(account([Role.Receptionist]));
    // The stored account is the front desk's: it decides.
    expect(service.settled()).toBe(true);
    expect(service.storedRoles()).toEqual([Role.Receptionist]);
    expect(service.scopeOf(Hours)).toBe(All);
  });

  it('reads the token’s roles for an account that has no document', () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    permissions(cellsOf({}));

    stored(null);

    expect(service.settled()).toBe(true);
    expect(service.storedRoles()).toEqual([Role.Barber]);
    expect(service.scopeOf(Hours)).toBe(Own);
    // No account, no record of one's own: "own" reaches nobody's.
    expect(service.mayFor(Hours, IVAN)).toBe(false);
  });

  it('an owner who made themself a barber works their own chair at once, on the old token', () => {
    const { service, stored, permissions } = harness(staff(Role.Admin));
    stored(account([Role.Admin]));
    permissions(cellsOf({}));
    expect(service.accessOf(Hours)).toEqual({
      accessScope: All,
      linkedBarberId: null,
    });

    // `setRoles` on their own account: the document changes, the token does not.
    stored(account([Role.Barber, Role.Admin], IVAN));

    expect(service.storedRoles()).toEqual([Role.Barber, Role.Admin]);
    expect(service.linkedBarberId()).toBe(IVAN);
    expect(service.scopeOf(Hours)).toBe(All);
  });

  it('a role taken away on the stored account is gone before the token says so', () => {
    const { service, stored, permissions } = harness(
      staff(Role.Barber, Role.Receptionist),
    );
    permissions(cellsOf({}));
    stored(account([Role.Barber, Role.Receptionist], IVAN));
    expect(service.mayFor(Hours, NIKO)).toBe(true);

    stored(account([Role.Barber], IVAN));

    expect(service.mayFor(Hours, NIKO)).toBe(false);
    expect(service.mayFor(Hours, IVAN)).toBe(true);
  });
});

describe('StaffAccessService — cells nobody could read grant nothing', () => {
  it('grants nothing by a cell until the cells answer — the admin’s everything is no cell', () => {
    const barber = harness(staff(Role.Barber));
    barber.stored(account([Role.Barber], IVAN));
    // The standard would say "own"; unread cells say nothing.
    expect(barber.service.scopeOf(Hours)).toBe(None);
    expect(barber.service.mayFor(Hours, IVAN)).toBe(false);
    barber.permissions(cellsOf({}));
    expect(barber.service.mayFor(Hours, IVAN)).toBe(true);

    TestBed.resetTestingModule();
    const owner = harness(staff(Role.Admin));
    owner.stored(account([Role.Admin]));
    expect(owner.service.scopeOf(TeamManage)).toBe(All);
    expect(owner.service.mayFor(Hours, IVAN)).toBe(true);
  });

  it('the owner’s session is settled without the cells: it never waits for a document that cannot change its answer', async () => {
    const { service, stored } = harness(staff(Role.Admin));
    // Not before the account: the stored roles are what make an owner.
    expect(service.settled()).toBe(false);
    expect(service.scopeOf(Analytics)).toBe(None);

    stored(account([Role.Barber, Role.Admin], IVAN));

    // The cells have not answered, and nothing waits for them.
    expect(service.settled()).toBe(true);
    expect(service.scopeOf(Analytics)).toBe(All);
    let facts: unknown = null;
    void service.whenSettled().then((answer) => (facts = answer));
    await Promise.resolve();
    expect(facts).toMatchObject({ storedRoles: [Role.Barber, Role.Admin] });
  });

  it('an account that stopped being the owner’s waits for the cells again', () => {
    const { service, stored, permissions } = harness(staff(Role.Admin));
    stored(account([Role.Admin]));
    expect(service.settled()).toBe(true);

    // The token still says admin; the stored account is the front desk's.
    stored(account([Role.Receptionist]));
    expect(service.settled()).toBe(false);
    expect(service.scopeOf(Hours)).toBe(None);

    permissions(cellsOf({}));
    expect(service.scopeOf(Hours)).toBe(All);
  });

  it('keeps the sysadmin’s fixed column when the cells cannot be read', () => {
    const { service, stored, permissions } = harness(staff(Role.Sysadmin));
    stored(account([Role.Sysadmin]));
    // The vendor's role is not the owner's: it waits for the cells' answer.
    expect(service.settled()).toBe(false);

    permissions(REFUSED);

    expect(service.scopeOf(Hours)).toBe(All);
    expect(service.scopeOf(Analytics)).toBe(None);
  });

  it('a refused read is nobody, never the standard — and a later answer is followed', () => {
    const { service, stored, permissions } = harness(staff(Role.Receptionist));
    stored(account([Role.Receptionist]));

    permissions(REFUSED);
    expect(service.settled()).toBe(true);
    expect(service.scopeOf(Hours)).toBe(None);

    permissions(cellsOf({}));
    expect(service.scopeOf(Hours)).toBe(All);
  });

  it('a hand-written value nobody can read is nobody for that cell alone', () => {
    const { service, stored, permissions } = harness(staff(Role.Receptionist));
    stored(account([Role.Receptionist]));
    permissions(cellsOf({ receptionistHoursScope: 'EVERYONE' }));

    expect(service.scopeOf(Hours)).toBe(None);
    expect(service.scopeOf(TimeOff)).toBe(All);
  });
});

describe('StaffAccessService — who reads the cells', () => {
  it('opens the stream for a staff token only: never signed out, onboarding or a client', () => {
    const { service, observeStaffPermissions, signIn } = harness(ANONYMOUS);
    expect(observeStaffPermissions).not.toHaveBeenCalled();
    expect(service.scopeOf(Hours)).toBe(None);

    signIn(principalFixture.onboarding(UID));
    signIn(principalFixture.client(UID));
    expect(observeStaffPermissions).not.toHaveBeenCalled();

    signIn(staff(Role.Barber));
    expect(observeStaffPermissions).toHaveBeenCalledTimes(1);
  });

  it('keeps one listener across a token refresh, and closes it on sign-out', () => {
    const { cells, observeStaffPermissions, signIn } = harness(
      staff(Role.Barber),
    );
    // A refresh: the same person, the same staff tier, a new principal object.
    signIn(staff(Role.Barber));
    signIn(staff(Role.Barber, Role.Admin));
    expect(observeStaffPermissions).toHaveBeenCalledTimes(1);

    signIn(ANONYMOUS);
    expect(cells[0]?.closed).toBe(true);
  });

  it('never shows one person the answer of the one before', () => {
    const { service, stored, permissions, signIn } = harness(
      staff(Role.Receptionist),
    );
    stored(account([Role.Receptionist]));
    permissions(cellsOf({}));
    expect(service.scopeOf(Hours)).toBe(All);

    const other = UserId.of('user_2');
    signIn(principalFixture.staff(other, [Role.Receptionist]));

    // Their cells have not answered: nothing is granted by the last answer.
    expect(service.settled()).toBe(false);
    expect(service.scopeOf(Hours)).toBe(None);

    stored(account([Role.Receptionist], null, other));
    permissions(cellsOf({ receptionistHoursScope: None }));
    expect(service.settled()).toBe(true);
    expect(service.scopeOf(Hours)).toBe(None);
  });
});

describe('StaffAccessService.whenSettled — what a route’s gate waits for', () => {
  it('waits for the account AND the cells, then answers the stored roles and the cells', async () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    let facts: unknown = null;
    void service.whenSettled().then((answer) => (facts = answer));

    await Promise.resolve();
    expect(service.settled()).toBe(false);
    expect(facts).toBeNull();

    stored(account([Role.Barber, Role.Receptionist], IVAN));
    await Promise.resolve();
    expect(facts).toBeNull();

    permissions(cellsOf({ barberAnalyticsScope: None }));
    await vi.waitFor(() => expect(facts).not.toBeNull());

    expect(facts).toEqual({
      storedRoles: [Role.Barber, Role.Receptionist],
      permissions: StaffPermissions.read({ barberAnalyticsScope: None }),
    });
  });

  it('a cold load: never answers the signed-out moment’s "settled" for the person who has just arrived', async () => {
    // The app starts signed out, and that state is settled.
    const { service, stored, permissions, arrive } = harness(ANONYMOUS);
    expect(service.settled()).toBe(true);

    // Auth restores the session; the guard asks in the same beat, before
    // anything has reacted to the new person.
    arrive(staff(Role.Barber));
    let facts: unknown = null;
    void service.whenSettled().then((answer) => (facts = answer));
    TestBed.tick();
    await Promise.resolve();

    // Their account and their cells have not answered: the gate waits.
    expect(service.settled()).toBe(false);
    expect(facts).toBeNull();

    stored(account([Role.Barber], null));
    permissions(cellsOf({}));
    await vi.waitFor(() => expect(facts).not.toBeNull());

    // …and decides on the standard, not on closed cells.
    expect(facts).toEqual({
      storedRoles: [Role.Barber],
      permissions: StaffPermissions.UNSET,
    });
  });

  it('a settled session answers in the same microtask, as a role gate does — no tick for another navigation to cancel it in', async () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    stored(account([Role.Barber], IVAN));
    permissions(cellsOf({}));
    let facts: unknown = null;

    void service.whenSettled().then((answer) => (facts = answer));
    // No `TestBed.tick()`: nothing may need to run but the promise itself.
    await Promise.resolve();

    expect(facts).toEqual({
      storedRoles: [Role.Barber],
      permissions: StaffPermissions.UNSET,
    });
  });

  it('resolves at once for a session with nobody in it: no roles, closed cells', async () => {
    const { service } = harness(ANONYMOUS);

    const facts = await service.whenSettled();

    expect(facts.storedRoles).toEqual([]);
    for (const level of StaffPermissions.LEVELS) {
      for (const capability of StaffPermissions.CAPABILITIES) {
        expect(
          StaffPermissions.scopeOf(facts.permissions, level, capability),
        ).toBe(None);
      }
    }
  });

  it('resolves for a client: the account settles it, with no cells to read', async () => {
    const { service, stored } = harness(principalFixture.client(UID));
    stored(account([Role.Client]));

    const facts = await service.whenSettled();

    expect(facts.storedRoles).toEqual([Role.Client]);
  });

  it('settles on an account that has no document and on cells that were refused', async () => {
    const { service, stored, permissions } = harness(staff(Role.Barber));
    stored(null);
    permissions(REFUSED);

    const facts = await service.whenSettled();

    // No stored account: the token's roles stand, and the cells are closed.
    expect(facts.storedRoles).toEqual([Role.Barber]);
    expect(
      StaffPermissions.scopeOf(facts.permissions, Role.Barber, Hours),
    ).toBe(None);
  });
});
