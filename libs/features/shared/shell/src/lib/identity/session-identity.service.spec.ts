import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  AuthClaims,
  AuthStage,
  BirthDate,
  E164,
  Email,
  ParsedIdentifier,
  Principal,
} from '@core/components';
import type { User } from '@core/entities';
import type { StoredFile } from '@core/ports';
import { MediaError, Result, UserId } from '@core/primitives';
import { registeredUserFixture } from '@core/testing';
import { ProfileCompletionKey } from '@core/systems';
import { SessionIdentityService } from './session-identity.service';

type FindResult = Result<StoredFile | null, MediaError>;

/**
 * The principal a token with these claims restores — through the SAME
 * adapter-boundary parse the session uses, so an unknown role degrades
 * exactly as it would live. A plain client unless said otherwise.
 */
function active(uid: string, roles: readonly string[] = ['client']): Principal {
  return Principal.fromClaims({
    userId: UserId.of(uid),
    claims: AuthClaims.fromToken({
      tenantId: 'tenant_1',
      stage: AuthStage.Active,
      roles,
    }),
  });
}

const ANONYMOUS_PRINCIPAL = Principal.anonymous();

/** A finished profile but for the photo — the photo alone decides `complete`. */
function user(uid: string): User {
  return registeredUserFixture({
    id: UserId.of(uid),
    firstName: 'Jane',
    lastName: 'Doe',
    birthDate: BirthDate.of('1990-05-05'),
  });
}

function photoOf(uid: string): FindResult {
  return Result.ok({
    url: `http://avatar/${uid}`,
    path: `avatars/${uid}/original`,
  });
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
function harness(
  initial: Principal,
  answers: Promise<FindResult>[] = [],
  identifier: ParsedIdentifier | null = null,
) {
  const principal = signal<Principal>(initial);
  const account = signal<User | null>(null);
  const find = vi.fn(
    (): Promise<FindResult> =>
      answers.shift() ?? Promise.resolve(Result.ok(null)),
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
        provide: AUTH_SESSION_PORTS,
        useValue: {
          currentDisplayName: () => null,
          currentIdentifier: () => identifier,
        },
      },
      { provide: AVATAR_PORTS, useValue: { findAvatar: find } },
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

    await storage.answer(Result.ok(null));

    expect(service.avatarUrl()).toBeNull();
    expect(service.completion()?.items).toContainEqual({
      profileCompletionKey: ProfileCompletionKey.Photo,
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
    await storage.answer(Result.ok(null));

    expect(service.avatarUrl()).toBeNull();
    expect(service.completion()?.done).toBe(3);
  });

  it('settles a failed lookup as "no photo", so nothing waiting for an answer waits forever', async () => {
    const { service, profileLands } = harness(active('user_1'), [
      Promise.resolve(Result.err(MediaError.transient('avatars/user_1'))),
    ]);
    profileLands('user_1');
    await settle();

    expect(service.profileProgress()).not.toBeNull();
    expect(service.completion()?.items).toContainEqual({
      profileCompletionKey: ProfileCompletionKey.Photo,
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

    it('grants nothing for a claim outside the vocabulary — the token degrades to onboarding', () => {
      const { service } = harness(active('user_1', ['superuser']));

      expect(service.isStaffMember()).toBe(false);
      expect(service.isAdmin()).toBe(false);
    });
  });

  /**
   * The secondary line under the portrait. An e-mail reads as itself; a
   * phone reads in its international form once the lazily loaded formatter
   * lands (F6 — `libphonenumber-js` stays out of the initial chunk), and as
   * the raw E.164 until then (departure 4A-2 (g)).
   */
  describe('the identifier label', () => {
    it('reads an e-mail session as the address, and names it by its local part', () => {
      const { service } = harness(
        active('user_1'),
        [],
        ParsedIdentifier.email(Email.of('jane@example.com')),
      );

      expect(service.identifierLabel()).toBe('jane@example.com');
      expect(service.displayName()).toBe('jane');
    });

    it('reads a phone session as the raw E.164 until the formatter lands, then formats it internationally', async () => {
      const { service } = harness(
        active('user_1'),
        [],
        ParsedIdentifier.phone(E164.of('+359885550100')),
      );

      // Departure 4A-2 (g): the lazy chunk has not landed yet — the line
      // still reads, ungrouped, never blank.
      expect(service.identifierLabel()).toBe('+359885550100');

      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.identifierLabel()).toMatch(/^\+359 /);
      });
      expect(service.identifierLabel().replace(/\D/g, '')).toBe('359885550100');
    });

    it('shows nothing for a signed-out session', () => {
      const { service } = harness(
        ANONYMOUS_PRINCIPAL,
        [],
        ParsedIdentifier.phone(E164.of('+359885550100')),
      );

      expect(service.identifierLabel()).toBe('');
    });
  });
});
