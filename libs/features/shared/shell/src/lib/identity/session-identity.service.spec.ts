import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AVATAR_UPLOADER,
  AvatarRef,
  AvatarUploadError,
  User,
  ZonedDateTime,
} from '@creativo/application/accounts';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  Principal,
  PrincipalId,
  Result,
  activePrincipal,
  fail,
  ok,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { AccountStateService } from '@creativo/features/client/account-state';
import { SessionIdentityService } from './session-identity.service';

type FindResult = Result<AvatarRef | null, AvatarUploadError>;

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));

/** An active principal with these claims — a plain client unless said otherwise. */
function active(uid: string, roles: readonly string[] = ['client']): Principal {
  return unwrap(
    activePrincipal(
      unwrap(PrincipalId.create(uid)),
      roles.map((role) => roleFromPrimitive(role)),
    ),
  );
}

/** A finished profile but for the photo — the photo alone decides `complete`. */
function user(uid: string): User {
  return unwrap(
    User.create(
      {
        id: uid,
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
        birthDate: '1990-05-05',
      },
      TODAY,
    ),
  );
}

function photoOf(uid: string): FindResult {
  return ok({ url: `http://avatar/${uid}`, path: `avatars/${uid}/original` });
}

/** A Storage answer the test releases by hand — "still in flight" until then. */
function deferred(): {
  readonly promise: Promise<FindResult>;
  readonly answer: (result: FindResult) => Promise<void>;
} {
  let resolve: (result: FindResult) => void = () => undefined;
  const promise = new Promise<FindResult>((r) => (resolve = r));
  return {
    promise,
    answer: async (result) => {
      resolve(result);
      await settle();
    },
  };
}

/** Lets a resolved lookup reach the signal, then runs the effects. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  TestBed.tick();
}

/**
 * `answers` are Storage's replies, in order — queued before the service
 * exists when the first lookup must see one (it runs on the first tick).
 */
function harness(initial: Principal, answers: Promise<FindResult>[] = []) {
  const principal = signal<Principal>(initial);
  const account = signal<User | null>(null);
  const find = vi.fn(
    (): Promise<FindResult> => answers.shift() ?? Promise.resolve(ok(null)),
  );

  TestBed.configureTestingModule({
    providers: [
      {
        provide: AccountStateService,
        useValue: {
          principal,
          account,
          accountLoading: signal(false),
          refresh: () => undefined,
        },
      },
      {
        provide: AUTH_GATEWAY,
        useValue: {
          currentDisplayName: () => null,
          currentIdentifier: () => null,
        },
      },
      { provide: AVATAR_UPLOADER, useValue: { find } },
    ],
  });
  const service = TestBed.inject(SessionIdentityService);
  TestBed.tick();

  return {
    service,
    find,
    /** Queues the next `find` answer. */
    nextAnswer: (answer: Promise<FindResult>) => answers.push(answer),
    signIn: (uid: string, roles?: readonly string[]) => {
      principal.set(active(uid, roles));
      TestBed.tick();
    },
    profileLands: (uid: string) => {
      account.set(user(uid));
      TestBed.tick();
    },
  };
}

describe('SessionIdentityService', () => {
  it('waits for the signed-in photo lookup instead of reading the signed-out answer as "no photo"', async () => {
    // A cold load: the session starts signed out, then Auth restores it.
    const { service, nextAnswer, signIn, profileLands } =
      harness(ANONYMOUS_PRINCIPAL);
    const storage = deferred();
    nextAnswer(storage.promise);

    signIn('user_1');
    // The profile snapshot lands BEFORE Storage answers — the race that
    // used to show a finished profile a "photo missing" card.
    profileLands('user_1');

    expect(service.profileProgress()).toBeNull();
    expect(service.completion()).toBeNull();

    await storage.answer(photoOf('user_1'));

    expect(service.profileProgress()?.complete).toBe(true);
    expect(service.avatarUrl()).toBe('http://avatar/user_1');
  });

  it('never shows the previous person’s photo while the next one’s lookup runs', async () => {
    const { service, nextAnswer, signIn, profileLands } = harness(
      active('user_1'),
      [Promise.resolve(photoOf('user_1'))],
    );
    profileLands('user_1');
    await settle();
    expect(service.avatarUrl()).toBe('http://avatar/user_1');

    const storage = deferred();
    nextAnswer(storage.promise);
    signIn('user_2');
    profileLands('user_2');

    expect(service.avatarUrl()).toBeNull();
    expect(service.profileProgress()).toBeNull();

    await storage.answer(ok(null));

    expect(service.avatarUrl()).toBeNull();
    expect(service.completion()?.items).toContainEqual({
      key: 'photo',
      done: false,
    });
  });

  it('keeps the photo on screen while refreshAvatar re-checks it, then follows the new answer', async () => {
    const { service, find, nextAnswer, signIn, profileLands } =
      harness(ANONYMOUS_PRINCIPAL);
    nextAnswer(Promise.resolve(photoOf('user_1')));
    signIn('user_1');
    profileLands('user_1');
    await settle();
    expect(service.profileProgress()?.complete).toBe(true);

    const storage = deferred();
    nextAnswer(storage.promise);
    service.refreshAvatar();
    TestBed.tick();

    // The menu re-checks on every open: its portrait must not blink.
    expect(find).toHaveBeenCalledTimes(2);
    expect(service.avatarUrl()).toBe('http://avatar/user_1');
    expect(service.profileProgress()?.complete).toBe(true);

    // The photo was removed elsewhere — every reader follows.
    await storage.answer(ok(null));

    expect(service.avatarUrl()).toBeNull();
    expect(service.completion()?.done).toBe(3);
  });

  it('settles a failed lookup as "no photo", so nothing waiting for an answer waits forever', async () => {
    const { service, profileLands } = harness(active('user_1'), [
      Promise.resolve(fail(new AvatarUploadError('storage down'))),
    ]);
    profileLands('user_1');
    await settle();

    expect(service.profileProgress()).not.toBeNull();
    expect(service.completion()?.items).toContainEqual({
      key: 'photo',
      done: false,
    });
  });

  it('answers "no photo" for a signed-out session without asking Storage', async () => {
    const { service, find } = harness(ANONYMOUS_PRINCIPAL);
    await settle();

    expect(find).not.toHaveBeenCalled();
    expect(service.avatarUrl()).toBeNull();
    expect(service.profileProgress()).toBeNull();
  });

  /**
   * The two role flags the chrome reads off the token's claims. Both are
   * UI-only — the route guards, firestore.rules and the callables re-check —
   * and both name the SAME groupings those do: `isStaffMember` is
   * `STAFF_ROLES`, `isAdmin` the pair `admin | sysadmin` of `isAdmin()` in
   * firestore.rules (client-card revision 3 §3.17).
   */
  describe('the role flags', () => {
    it.each(['admin', 'sysadmin'])(
      'reads %s as one of the admin pair — who is staff too',
      (role) => {
        const { service } = harness(active('user_1', [role]));

        expect(service.isAdmin()).toBe(true);
        expect(service.isStaffMember()).toBe(true);
      },
    );

    it('keeps the rest of the staff out of the pair: a barber is staff, not an admin', () => {
      const { service } = harness(active('user_1', ['barber']));

      expect(service.isStaffMember()).toBe(true);
      expect(service.isAdmin()).toBe(false);
    });

    it('grants a client neither', () => {
      const { service } = harness(active('user_1'));

      expect(service.isStaffMember()).toBe(false);
      expect(service.isAdmin()).toBe(false);
    });

    it('grants a signed-out session neither, and follows the principal when the owner signs in', () => {
      const { service, signIn } = harness(ANONYMOUS_PRINCIPAL);

      expect(service.isStaffMember()).toBe(false);
      expect(service.isAdmin()).toBe(false);

      // A shop owner is commonly `barber` AND `admin` — the pair is read
      // off the whole set, not the first claim.
      signIn('owner_1', ['barber', 'admin']);

      expect(service.isStaffMember()).toBe(true);
      expect(service.isAdmin()).toBe(true);
    });

    it('ignores a claim outside the vocabulary rather than narrowing the claims first', () => {
      const { service } = harness(active('user_1', ['superuser']));

      expect(service.isStaffMember()).toBe(false);
      expect(service.isAdmin()).toBe(false);
    });
  });
});
