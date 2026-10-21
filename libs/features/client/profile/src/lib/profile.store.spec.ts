import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  AVATAR_UPLOADER,
  MAX_AVATAR_BYTES,
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
import { CLOCK } from '@creativo/application/shared';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  AccountsErrorCode,
  RepositoryError,
  Result as EcsResult,
  UserId,
} from '@core/primitives';
import { BirthDate } from '@core/components';
import type { User } from '@core/entities';
import type { ProfilePorts } from '@core/ports';
import {
  memoryProfilePorts,
  provisionedUserFixture,
  registeredUserFixture,
} from '@core/testing';
import { ProfileStore } from './profile.store';

function unwrap<T>(result: Result<T, unknown>): T {
  if (result.isFailure()) throw new Error('fixture failed');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));
const ACTIVE = unwrap(
  activePrincipal(unwrap(PrincipalId.create('user_1')), [
    roleFromPrimitive('client'),
  ]),
);
const USER_ID = UserId.of('user_1');

/** Ада Тестова, registered — her `users/{uid}` body as stored. */
function user(): User {
  return registeredUserFixture({
    id: USER_ID,
    firstName: 'Ада',
    lastName: 'Тестова',
  });
}

interface Harness {
  store: ProfileStore;
  /** `users/{uid}` as the memory port holds it — what a write leaves. */
  users: Map<UserId, User>;
  /** How many owner writes reached the port. */
  writes: () => number;
  uploads: Blob[];
  removals: string[];
}

function configure(options?: {
  principal?: Principal;
  profile?: User | null;
  /** A store failure the owner write answers instead of writing. */
  writeFails?: boolean;
  removeResult?: Result<void, { code: string }>;
}): Harness {
  const users = new Map<UserId, User>();
  const profile = options?.profile === undefined ? user() : options.profile;
  if (profile !== null) users.set(profile.id, profile);
  const memory = memoryProfilePorts(users);
  let writes = 0;
  const uploads: Blob[] = [];
  const removals: string[] = [];

  TestBed.configureTestingModule({
    providers: [
      ProfileStore,
      {
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(options?.principal ?? ACTIVE),
          currentDisplayName: () => null,
          currentIdentifier: () => null,
        },
      },
      {
        provide: PROFILE_PORTS,
        useValue: {
          ...memory,
          writeOwnProfile: async (userId, decide) => {
            writes += 1;
            return options?.writeFails
              ? EcsResult.err(
                  RepositoryError.writeFailed(
                    `users/${userId}`,
                    'permission-denied',
                  ),
                )
              : memory.writeOwnProfile(userId, decide);
          },
        } satisfies ProfilePorts,
      },
      {
        provide: AVATAR_UPLOADER,
        useValue: {
          find: () => Promise.resolve(ok(null)),
          upload: (_id: unknown, data: Blob) => {
            uploads.push(data);
            return Promise.resolve(ok({ url: 'http://a', path: 'avatars/a' }));
          },
          remove: (id: string) => {
            removals.push(id);
            return Promise.resolve(options?.removeResult ?? ok(undefined));
          },
        },
      },
      { provide: CLOCK, useValue: { now: () => ok(TODAY) } },
    ],
  });

  return {
    store: TestBed.inject(ProfileStore),
    users,
    writes: () => writes,
    uploads,
    removals,
  };
}

const NAME = { first: 'Ана', last: 'Иванова' };

describe('ProfileStore', () => {
  it('persists a new name and answers null', async () => {
    const { store, users, writes } = configure();

    const code = await store.saveName(NAME.first, NAME.last);

    expect(code).toBeNull();
    expect(writes()).toBe(1);
    expect(users.get(USER_ID)?.firstName).toBe('Ана');
    expect(users.get(USER_ID)?.lastName).toBe('Иванова');
    // The search keys follow the new names (the stored contact kept).
    expect(users.get(USER_ID)?.searchName).toBe('ана иванова');
  });

  it('forwards a birth date unchanged and leaves the names alone', async () => {
    const { store, users } = configure();

    const code = await store.saveBirthDate('2000-05-05');

    expect(code).toBeNull();
    expect(users.get(USER_ID)?.birthDate).toBe(BirthDate.of('2000-05-05'));
    expect(users.get(USER_ID)?.firstName).toBe('Ада');
  });

  it('answers the port failure code instead of throwing', async () => {
    const { store } = configure({ writeFails: true });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      'accounts.update_profile.repository_failure',
    );
  });

  it('answers not-found when there is no profile to merge into', async () => {
    const { store } = configure({ profile: null });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      AccountsErrorCode.UpdateProfileNotFound,
    );
  });

  it('answers not-found for a provisioned stub — a stub is no profile to edit', async () => {
    const { store, users } = configure({
      profile: provisionedUserFixture({ id: USER_ID }),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      AccountsErrorCode.UpdateProfileNotFound,
    );
    expect(users.get(USER_ID)?.firstName).toBeNull();
  });

  it('answers validation-failed for a name the rule refuses, and writes nothing', async () => {
    const { store, users } = configure();

    expect(await store.saveName('A', NAME.last)).toBe(
      AccountsErrorCode.UpdateProfileValidationFailed,
    );
    expect(users.get(USER_ID)?.firstName).toBe('Ада');
  });

  it('never touches the port without an active session', async () => {
    const { store, writes } = configure({ principal: ANONYMOUS_PRINCIPAL });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      'identifier_missing',
    );
    expect(writes()).toBe(0);
  });

  it('rejects a non-image and an oversize photo before storage sees them', async () => {
    const { store, uploads } = configure();

    const notAnImage = new File(['x'], 'notes.txt', { type: 'text/plain' });
    expect(await store.uploadPhoto(notAnImage)).toBe(
      'accounts.upload_avatar.not_an_image',
    );

    const huge = new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], 'big.jpg', {
      type: 'image/jpeg',
    });
    expect(await store.uploadPhoto(huge)).toBe(
      'accounts.upload_avatar.too_large',
    );
    expect(uploads.length).toBe(0);
  });

  it('uploads a valid photo', async () => {
    const { store, uploads } = configure();
    const photo = new File(['bytes'], 'me.jpg', { type: 'image/jpeg' });

    expect(await store.uploadPhoto(photo)).toBeNull();
    expect(uploads.length).toBe(1);
  });

  it('raises pending for the duration of a write', async () => {
    const { store } = configure();

    expect(store.pending()).toBe(false);
    const inFlight = store.saveName(NAME.first, NAME.last);
    expect(store.pending()).toBe(true);
    await inFlight;
    expect(store.pending()).toBe(false);
  });

  it('removes the photo without touching the profile document', async () => {
    const { store, removals, writes } = configure();

    expect(await store.removePhoto()).toBeNull();
    expect(removals).toEqual(['user_1']);
    // The avatar is a storage object, not a User field.
    expect(writes()).toBe(0);
  });

  it('answers the remove failure code', async () => {
    const { store } = configure({ removeResult: fail({ code: 'boom' }) });

    expect(await store.removePhoto()).toBe(
      'accounts.remove_avatar.remove_failed',
    );
  });
});
