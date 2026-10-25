import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { BirthDate, type IdentityCall, type Principal } from '@core/components';
import type { User } from '@core/entities';
import { Callables } from '@core/ports';
import { Result, UserId } from '@core/primitives';
import {
  AccountsError,
  AccountsErrorCode,
  IdentityError,
  MediaError,
  PipelineError,
} from '@core/errors';
import { AvatarSystem } from '@core/systems';
import {
  type GatewayCall,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryProfilePorts,
  principalFixture,
  registeredUserFixture,
  scriptedGatewayPorts,
} from '@core/testing';
import {
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  GATEWAY_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { ProfileStore } from './profile.store';

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
  /** Every callable the store dialled — the profile saves — in order. */
  calls: GatewayCall[];
  uploads: Blob[];
  removals: string[];
}

/** The `updateProfile` callable's answer to one edit. */
type UpdateProfileAnswer = Result<
  IdentityCall.UpdateProfileAnswer,
  PipelineError
>;

function configure(options?: {
  principal?: Principal;
  /** How `updateProfile` answers (a change written, unless given). */
  answer?: UpdateProfileAnswer;
  removeResult?: Result<void, MediaError>;
}): Harness {
  const calls: GatewayCall[] = [];
  const uploads: Blob[] = [];
  const removals: string[] = [];
  const avatars = memoryAvatarPorts();

  TestBed.configureTestingModule({
    providers: [
      ProfileStore,
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(
            options?.principal ?? principalFixture.client(USER_ID),
          ),
        }),
      },
      {
        provide: PROFILE_PORTS,
        useValue: memoryProfilePorts(new Map([[USER_ID, user()]])),
      },
      {
        provide: GATEWAY_PORTS,
        useValue: scriptedGatewayPorts(
          {
            [Callables.UpdateProfile]: () =>
              options?.answer ?? Result.ok({ changed: true }),
          },
          calls,
        ),
      },
      {
        provide: AVATAR_PORTS,
        useValue: {
          ...avatars,
          uploadAvatar: (userId: UserId, image: Blob) => {
            uploads.push(image);
            return avatars.uploadAvatar(userId, image);
          },
          removeAvatar: async (userId: UserId) => {
            removals.push(userId);
            return options?.removeResult ?? avatars.removeAvatar(userId);
          },
        },
      },
    ],
  });

  return { store: TestBed.inject(ProfileStore), calls, uploads, removals };
}

/** A refusal the edge answers for `errorCode` on `status`. */
function refused(status: string, errorCode: string): UpdateProfileAnswer {
  return Result.err(PipelineError.fromWire(status, { errorCode }));
}

const NAME = { first: 'Ана', last: 'Иванова' };

/** A write's refusal as the store answers it since pass D (E-7): the struct inside a `Result`. */
const refusedAs = (errorCode: string) => Result.err({ errorCode });

describe('ProfileStore', () => {
  it('sends a new name through updateProfile and answers ok', async () => {
    const { store, calls } = configure();

    const written = await store.saveName(NAME.first, NAME.last);

    expect(written).toEqual(Result.ok(undefined));
    // The server derives the search keys and judges the names (its
    // `update-profile.pipeline.spec.ts`); the web sends the edit as typed.
    expect(calls).toEqual([
      {
        callable: Callables.UpdateProfile,
        input: { firstName: 'Ана', lastName: 'Иванова', birthDate: null },
      },
    ]);
  });

  it('forwards a birth date unchanged and leaves the names alone', async () => {
    const { store, calls } = configure();

    const written = await store.saveBirthDate(BirthDate.of('2000-05-05'));

    expect(written).toEqual(Result.ok(undefined));
    expect(calls).toEqual([
      {
        callable: Callables.UpdateProfile,
        input: { firstName: null, lastName: null, birthDate: '2000-05-05' },
      },
    ]);
  });

  it('answers the write-failed code for a store failure instead of throwing', async () => {
    const { store } = configure({
      answer: Result.err(PipelineError.fromWire('internal', null)),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toEqual(
      Result.err(AccountsError.updateProfileRepositoryFailure()),
    );
  });

  it('answers the write-failed code for an expired session too — today one copy for a denied write', async () => {
    const { store } = configure({
      answer: refused(
        'unauthenticated',
        'ACCOUNTS_UPDATE_PROFILE_UNAUTHENTICATED',
      ),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toEqual(
      Result.err(AccountsError.updateProfileRepositoryFailure()),
    );
  });

  it('answers not-found when the server has no profile to edit', async () => {
    const { store } = configure({
      answer: refused('not-found', AccountsErrorCode.UpdateProfileNotFound),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toEqual(
      refusedAs(AccountsErrorCode.UpdateProfileNotFound),
    );
  });

  it('answers validation-failed for an edit the server refuses', async () => {
    const { store } = configure({
      answer: refused(
        'invalid-argument',
        AccountsErrorCode.UpdateProfileValidationFailed,
      ),
    });

    expect(await store.saveName('A', NAME.last)).toEqual(
      refusedAs(AccountsErrorCode.UpdateProfileValidationFailed),
    );
  });

  it('never calls updateProfile without an active session', async () => {
    const { store, calls } = configure({
      principal: principalFixture.anonymous(),
    });

    expect(await store.saveName(NAME.first, NAME.last)).toEqual(
      Result.err(IdentityError.identifierMissing()),
    );
    expect(calls).toEqual([]);
  });

  it('rejects a non-image and an oversize photo before storage sees them', async () => {
    const { store, uploads } = configure();

    const notAnImage = new File(['x'], 'notes.txt', { type: 'text/plain' });
    expect(await store.uploadPhoto(notAnImage)).toEqual(
      refusedAs(AccountsErrorCode.UploadAvatarNotAnImage),
    );

    const huge = new File(
      [new Uint8Array(AvatarSystem.MAX_BYTES + 1)],
      'big.jpg',
      { type: 'image/jpeg' },
    );
    expect(await store.uploadPhoto(huge)).toEqual(
      Result.err(AccountsError.uploadAvatarTooLarge(AvatarSystem.MAX_BYTES)),
    );
    expect(uploads.length).toBe(0);
  });

  it('uploads a valid photo', async () => {
    const { store, uploads } = configure();
    const photo = new File(['bytes'], 'me.jpg', { type: 'image/jpeg' });

    expect(await store.uploadPhoto(photo)).toEqual(Result.ok(undefined));
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
    const { store, removals, calls } = configure();

    expect(await store.removePhoto()).toEqual(Result.ok(undefined));
    expect(removals).toEqual(['user_1']);
    // The avatar is a storage object, not a User field.
    expect(calls).toEqual([]);
  });

  it('answers the remove failure code', async () => {
    const { store } = configure({
      removeResult: Result.err(MediaError.transient('avatars/user_1/original')),
    });

    expect(await store.removePhoto()).toEqual(
      refusedAs(AccountsErrorCode.RemoveAvatarRemoveFailed),
    );
  });
});
