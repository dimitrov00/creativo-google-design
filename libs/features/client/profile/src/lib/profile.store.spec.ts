import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  AVATAR_UPLOADER,
  FirstName,
  LastName,
  MAX_AVATAR_BYTES,
  PROFILE_PORT,
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
import { CLOCK } from '@creativo/application/shared';
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

function user(): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Ада',
        lastName: 'Тестова',
        roles: ['client'],
        status: { kind: 'active' },
      },
      TODAY,
    ),
  );
}

interface Harness {
  store: ProfileStore;
  saved: User[];
  uploads: Blob[];
  removals: string[];
  refreshes: number;
}

function configure(options?: {
  principal?: Principal;
  profile?: User | null;
  saveResult?: Result<void, { code: string }>;
  removeResult?: Result<void, { code: string }>;
}): Harness {
  const saved: User[] = [];
  const uploads: Blob[] = [];
  const removals: string[] = [];
  let refreshes = 0;

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
        provide: PROFILE_PORT,
        useValue: {
          getProfile: () => {
            refreshes += 1;
            return Promise.resolve(
              ok(options?.profile === undefined ? user() : options.profile),
            );
          },
          saveProfile: (next: User) => {
            saved.push(next);
            return Promise.resolve(options?.saveResult ?? ok(undefined));
          },
        },
      },
      {
        provide: AVATAR_UPLOADER,
        useValue: {
          find: () => Promise.resolve(ok(null)),
          upload: (_id: unknown, data: Blob) => {
            uploads.push(data);
            return Promise.resolve(ok({ url: 'http://a', path: 'avatars/a' }));
          },
          remove: (id: { value: string }) => {
            removals.push(id.value);
            return Promise.resolve(options?.removeResult ?? ok(undefined));
          },
        },
      },
      { provide: CLOCK, useValue: { now: () => ok(TODAY) } },
    ],
  });

  return {
    store: TestBed.inject(ProfileStore),
    saved,
    uploads,
    removals,
    get refreshes() {
      return refreshes;
    },
  };
}

const NAME = {
  first: unwrap(FirstName.create('Ана')),
  last: unwrap(LastName.create('Иванова')),
};

describe('ProfileStore', () => {
  it('persists a new name and answers null', async () => {
    const { store, saved } = configure();

    const code = await store.saveName(NAME.first, NAME.last);

    expect(code).toBeNull();
    expect(saved.length).toBe(1);
    expect(saved[0]?.firstName.value).toBe('Ана');
    expect(saved[0]?.lastName.value).toBe('Иванова');
  });

  it('forwards a birth date unchanged and leaves the names alone', async () => {
    const { store, saved } = configure();

    const code = await store.saveBirthDate('2000-05-05');

    expect(code).toBeNull();
    expect(saved[0]?.birthDate?.toISODate()).toBe('2000-05-05');
    expect(saved[0]?.firstName.value).toBe('Ада');
  });

  it('answers the port failure code instead of throwing', async () => {
    const { store } = configure({
      saveResult: fail({ code: 'repository_failure' }),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      'accounts.update_profile.repository_failure',
    );
  });

  it('answers not-found when there is no profile to merge into', async () => {
    const { store } = configure({ profile: null });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      'accounts.update_profile.not_found',
    );
  });

  it('never touches the port without an active session', async () => {
    const { store, saved } = configure({ principal: ANONYMOUS_PRINCIPAL });

    expect(await store.saveName(NAME.first, NAME.last)).toBe(
      'identifier_missing',
    );
    expect(saved.length).toBe(0);
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
    const { store, removals, saved } = configure();

    expect(await store.removePhoto()).toBeNull();
    expect(removals).toEqual(['user_1']);
    // The avatar is a storage object, not a User field.
    expect(saved.length).toBe(0);
  });

  it('answers the remove failure code', async () => {
    const { store } = configure({ removeResult: fail({ code: 'boom' }) });

    expect(await store.removePhoto()).toBe(
      'accounts.remove_avatar.remove_failed',
    );
  });
});
