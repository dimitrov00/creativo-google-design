import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  Principal,
  PrincipalId,
  Result,
  activePrincipal,
  fail,
  ok,
  onboardingPrincipal,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  AccountStatus,
  PROFILE_PORT,
  User,
  UserId,
  ZonedDateTime,
} from '@creativo/application/accounts';
import { AccountStateService } from './account-state.service';

/** The port fails with a `RepositoryError`; the service never inspects it, so
 * a plain `Error` stands in and this lib stays off `application/shared`. */
type ProfileResult = Result<User | null, Error>;
const LIVE_QUERY_FAILED: ProfileResult = fail(new Error('Live query failed'));

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));

function active(uid: string): Principal {
  return unwrap(
    activePrincipal(unwrap(PrincipalId.create(uid)), [
      roleFromPrimitive('client'),
    ]),
  );
}

function user(
  uid = 'user_1',
  status: AccountStatus = AccountStatus.active(),
): User {
  return unwrap(
    User.create(
      {
        id: uid,
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status,
      },
      TODAY,
    ),
  );
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
          uid: userId.value,
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
        provide: AUTH_GATEWAY,
        useValue: { observePrincipal: () => principal.asObservable() },
      },
      {
        provide: PROFILE_PORT,
        useValue: {
          getProfile: vi.fn(),
          saveProfile: vi.fn(),
          observeProfile,
        },
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
  it('clears the account and loading flag for an anonymous principal, and listens to nothing', () => {
    const { service, observeProfile } = harness(ANONYMOUS_PRINCIPAL);

    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
    expect(observeProfile).not.toHaveBeenCalled();
  });

  it('reflects loading until the first snapshot answers', () => {
    const { service, live } = harness(active('user_1'));

    expect(service.accountLoading()).toBe(true);
    expect(service.account()).toBeNull();
    expect(live().uid).toBe('user_1');

    live().snapshots.next(ok(user()));

    expect(service.accountLoading()).toBe(false);
    expect(service.account()?.fullName()).toBe('Jane Doe');
  });

  it('reads "no registered profile yet" as a settled null account', () => {
    const { service, live } = harness(active('user_1'));

    live().snapshots.next(ok(null));

    expect(service.accountLoading()).toBe(false);
    expect(service.account()).toBeNull();
  });

  it('reflects a status change on the document live, without refresh()', () => {
    const { service, live, observeProfile } = harness(active('user_1'));
    live().snapshots.next(ok(user()));
    expect(service.account()?.status.kind).toBe('active');

    live().snapshots.next(
      ok(user('user_1', AccountStatus.blocked({ reason: 'manual' }))),
    );

    expect(service.account()?.status.kind).toBe('blocked');
    expect(observeProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps one listener across token refreshes and the onboarding → active flip', () => {
    const { service, live, observeProfile, signIn } = harness(
      onboardingPrincipal(unwrap(PrincipalId.create('user_1'))),
    );
    live().snapshots.next(ok(null));

    signIn(active('user_1'));
    signIn(active('user_1'));
    // Registration completing is a snapshot on the SAME listener.
    live().snapshots.next(ok(user()));

    expect(observeProfile).toHaveBeenCalledTimes(1);
    expect(live().detached).toBe(false);
    expect(service.account()?.fullName()).toBe('Jane Doe');
  });

  it('detaches and clears at once when the person changes, then listens to the new uid', () => {
    const { service, listeners, live, signIn } = harness(active('user_1'));
    live().snapshots.next(ok(user()));

    signIn(active('user_2'));

    expect(listeners[0]?.detached).toBe(true);
    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(true);
    expect(live().uid).toBe('user_2');

    live().snapshots.next(ok(user('user_2')));
    expect(service.account()?.id.value).toBe('user_2');
  });

  it('detaches and clears on sign-out', () => {
    const { service, live, signIn } = harness(active('user_1'));
    live().snapshots.next(ok(user()));

    signIn(ANONYMOUS_PRINCIPAL);

    expect(live().detached).toBe(true);
    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
  });

  it('keeps the last account on screen when the listener fails mid-stream', () => {
    const { service, live } = harness(active('user_1'));
    live().snapshots.next(ok(user()));

    live().snapshots.next(LIVE_QUERY_FAILED);

    expect(service.account()?.fullName()).toBe('Jane Doe');
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
    live().snapshots.next(ok(user()));

    service.refresh();
    TestBed.tick();

    expect(observeProfile).toHaveBeenCalledTimes(1);
    expect(live().detached).toBe(false);
  });

  it('refresh() re-attaches a failed listener and keeps the account on screen meanwhile', () => {
    const { service, listeners, live, observeProfile } = harness(
      active('user_1'),
    );
    live().snapshots.next(ok(user()));
    live().snapshots.next(LIVE_QUERY_FAILED);

    service.refresh();
    TestBed.tick();

    expect(observeProfile).toHaveBeenCalledTimes(2);
    expect(listeners[0]?.detached).toBe(true);
    expect(service.account()?.fullName()).toBe('Jane Doe');
    expect(service.accountLoading()).toBe(false);

    live().snapshots.next(
      ok(user('user_1', AccountStatus.blocked({ reason: 'manual' }))),
    );
    expect(service.account()?.status.kind).toBe('blocked');
  });
});
