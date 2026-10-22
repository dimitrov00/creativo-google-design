import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  AUTH_SESSION_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStatus, type Principal, Role } from '@core/components';
import { Profile, type User } from '@core/entities';
import type { ProfilePorts } from '@core/ports';
import { RepositoryError, Result, UserId } from '@core/primitives';
import {
  blockedUserFixture,
  memoryAuthSessionPorts,
  memoryProfilePorts,
  principalFixture,
  provisionedUserFixture,
  registeredUserFixture,
} from '@core/testing';
import { AccountStateService } from './account-state.service';

type ProfileResult = Result<User | null, RepositoryError>;
const LIVE_QUERY_FAILED: ProfileResult = Result.err(
  RepositoryError.readFailed('users/user_1', 'Live query failed'),
);

function active(uid: string): Principal {
  return principalFixture.client(UserId.of(uid));
}

const ANONYMOUS = principalFixture.anonymous();

/** Jane Doe, registered — the flat `users/{uid}` body as stored. */
function user(uid = 'user_1'): User {
  return registeredUserFixture({
    id: UserId.of(uid),
    firstName: 'Jane',
    lastName: 'Doe',
  });
}

/** The name a test reads off the account, `null` while there is none. */
function fullName(account: User | null): string | null {
  return account === null ? null : Profile.fullName(account);
}

/** Jane Doe, blocked by the shop — the lifecycle's variant keys at the root. */
function blocked(uid = 'user_1'): User {
  return blockedUserFixture({
    id: UserId.of(uid),
    firstName: 'Jane',
    lastName: 'Doe',
  });
}

/**
 * A live `users/{uid}` per listener: each `observeProfile` call gets its own
 * subject, so a test can push snapshots at it and see whether it was
 * detached.
 */
function harness(initial: Principal) {
  const principal = new BehaviorSubject<Principal>(initial);
  const listeners: {
    uid: string;
    snapshots: Subject<ProfileResult>;
    detached: boolean;
  }[] = [];
  const observeProfile = vi.fn(
    (userId: UserId) =>
      new Observable<ProfileResult>((subscriber) => {
        const listener = {
          uid: userId,
          snapshots: new Subject<ProfileResult>(),
          detached: false,
        };
        listeners.push(listener);
        const inner = listener.snapshots.subscribe(subscriber);
        return () => {
          listener.detached = true;
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
    ],
  });
  const service = TestBed.inject(AccountStateService);
  TestBed.tick();

  return {
    service,
    observeProfile,
    listeners,
    /** The newest listener. */
    live: () => {
      const listener = listeners.at(-1);
      if (!listener) throw new Error('nothing is listening');
      return listener;
    },
    signIn: (next: Principal) => {
      principal.next(next);
      TestBed.tick();
    },
  };
}

describe('AccountStateService', () => {
  it('reads the session’s ecs principal — its roles once onboarded, its account id once signed in', () => {
    const { service, signIn } = harness(ANONYMOUS);
    expect(service.principal()).toEqual(ANONYMOUS);
    expect(service.roles()).toBeNull();
    expect(service.userId()).toBeNull();

    signIn(principalFixture.onboarding(UserId.of('user_1')));
    expect(service.roles()).toBeNull();
    expect(service.userId()).toBe('user_1');

    signIn(principalFixture.staff(UserId.of('user_1'), [Role.Barber]));
    expect(service.roles()).toEqual([Role.Barber]);
  });

  it('clears the account and loading flag for an anonymous principal, and listens to nothing', () => {
    const { service, observeProfile } = harness(ANONYMOUS);

    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
    expect(observeProfile).not.toHaveBeenCalled();
  });

  it('reflects loading until the first snapshot answers', () => {
    const { service, live } = harness(active('user_1'));

    expect(service.accountLoading()).toBe(true);
    expect(service.account()).toBeNull();
    expect(live().uid).toBe('user_1');

    live().snapshots.next(Result.ok(user()));

    expect(service.accountLoading()).toBe(false);
    expect(fullName(service.account())).toBe('Jane Doe');
  });

  it('reads "no registered profile yet" as a settled null account', () => {
    const { service, live } = harness(active('user_1'));

    live().snapshots.next(Result.ok(null));

    expect(service.accountLoading()).toBe(false);
    expect(service.account()).toBeNull();
  });

  it('reads a provisioned stub as no profile, and the registered body once it lands', () => {
    const { service, live } = harness(active('user_1'));

    // `observeProfile` answers the stored body — the stub included; the
    // service, not the port, says a stub is "no registered profile yet".
    live().snapshots.next(
      Result.ok(provisionedUserFixture({ id: UserId.of('user_1') })),
    );

    expect(service.accountLoading()).toBe(false);
    expect(service.account()).toBeNull();

    live().snapshots.next(Result.ok(user()));
    expect(fullName(service.account())).toBe('Jane Doe');
  });

  it('reflects a status change on the document live, without refresh()', () => {
    const { service, live, observeProfile } = harness(active('user_1'));
    live().snapshots.next(Result.ok(user()));
    expect(service.account()?.accountStatus).toBe(AccountStatus.Active);

    live().snapshots.next(Result.ok(blocked()));

    expect(service.account()?.accountStatus).toBe(AccountStatus.Blocked);
    expect(observeProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps one listener across token refreshes and the onboarding → active flip', () => {
    const { service, live, observeProfile, signIn } = harness(
      principalFixture.onboarding(UserId.of('user_1')),
    );
    live().snapshots.next(Result.ok(null));

    signIn(active('user_1'));
    signIn(active('user_1'));
    // Registration completing is a snapshot on the SAME listener.
    live().snapshots.next(Result.ok(user()));

    expect(observeProfile).toHaveBeenCalledTimes(1);
    expect(live().detached).toBe(false);
    expect(fullName(service.account())).toBe('Jane Doe');
  });

  it('detaches and clears at once when the person changes, then listens to the new uid', () => {
    const { service, listeners, live, signIn } = harness(active('user_1'));
    live().snapshots.next(Result.ok(user()));

    signIn(active('user_2'));

    expect(listeners[0]?.detached).toBe(true);
    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(true);
    expect(live().uid).toBe('user_2');

    live().snapshots.next(Result.ok(user('user_2')));
    expect(service.account()?.id).toBe('user_2');
  });

  it('detaches and clears on sign-out', () => {
    const { service, live, signIn } = harness(active('user_1'));
    live().snapshots.next(Result.ok(user()));

    signIn(ANONYMOUS);

    expect(live().detached).toBe(true);
    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
  });

  it('keeps the last account on screen when the listener fails mid-stream', () => {
    const { service, live } = harness(active('user_1'));
    live().snapshots.next(Result.ok(user()));

    live().snapshots.next(LIVE_QUERY_FAILED);

    expect(fullName(service.account())).toBe('Jane Doe');
    expect(service.accountLoading()).toBe(false);
  });

  it('settles a first answer that fails as no account', () => {
    const { service, live } = harness(active('user_1'));

    live().snapshots.next(LIVE_QUERY_FAILED);

    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
  });

  it('refresh() is a no-op while the listener is healthy', () => {
    const { service, live, observeProfile } = harness(active('user_1'));
    live().snapshots.next(Result.ok(user()));

    service.refresh();
    TestBed.tick();

    expect(observeProfile).toHaveBeenCalledTimes(1);
    expect(live().detached).toBe(false);
  });

  it('refresh() re-attaches a failed listener and keeps the account on screen meanwhile', () => {
    const { service, listeners, live, observeProfile } = harness(
      active('user_1'),
    );
    live().snapshots.next(Result.ok(user()));
    live().snapshots.next(LIVE_QUERY_FAILED);

    service.refresh();
    TestBed.tick();

    expect(observeProfile).toHaveBeenCalledTimes(2);
    expect(listeners[0]?.detached).toBe(true);
    expect(fullName(service.account())).toBe('Jane Doe');
    expect(service.accountLoading()).toBe(false);

    live().snapshots.next(Result.ok(blocked()));
    expect(service.account()?.accountStatus).toBe(AccountStatus.Blocked);
  });
});
