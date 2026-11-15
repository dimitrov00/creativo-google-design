import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  BirthDate,
  type IdentityCall,
  type Principal,
  Role,
  type TeamCall,
} from '@core/components';
import type { User } from '@core/entities';
import { Callables } from '@core/ports';
import { BarberId, Result, UserId } from '@core/primitives';
import {
  AccessErrorCode,
  AccountsError,
  AccountsErrorCode,
  IdentityError,
  MediaError,
  PipelineError,
  PipelineErrorCode,
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
  ID_PORTS,
  PROFILE_PORTS,
  STAGED_UPLOAD_PORTS,
  TEAM_ADMIN_PORTS,
  teamAdminPorts,
} from '@creativo/infrastructure/firebase-app';
import { ProfileStore } from './profile.store';

const USER_ID = UserId.of('user_1');
/** The barber record a linked account is. */
const IVAN = BarberId.of('ivan');

/** Ада Тестова, registered — her `users/{uid}` body as stored; a barber's when linked. */
function user(linkedBarberId: BarberId | null): User {
  return registeredUserFixture({
    id: USER_ID,
    firstName: 'Ада',
    lastName: 'Тестова',
    ...(linkedBarberId === null
      ? {}
      : { roles: [Role.Client, Role.Barber], linkedBarberId }),
  });
}

interface Harness {
  store: ProfileStore;
  /** Every callable the store dialled — the profile saves — in order. */
  calls: GatewayCall[];
  uploads: Blob[];
  removals: string[];
  /** Every picture staged for a callable: whose folder, under which name. */
  staged: { userId: string; stagedName: string; image: Blob }[];
}

/** The `setBarberPhoto` callable's answer to one photo. */
type PhotoAnswer = Result<TeamCall.Saved, PipelineError>;

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
  /** The barber record the account is linked to (none, unless given). */
  linkedBarberId?: BarberId;
  /** How `setBarberPhoto` answers (the photo set, unless given). */
  photoAnswer?: PhotoAnswer;
}): Harness {
  const calls: GatewayCall[] = [];
  const uploads: Blob[] = [];
  const removals: string[] = [];
  const staged: Harness['staged'] = [];
  const avatars = memoryAvatarPorts();
  const linkedBarberId = options?.linkedBarberId ?? null;
  let minted = 0;

  TestBed.configureTestingModule({
    providers: [
      ProfileStore,
      {
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(
            options?.principal ??
              (linkedBarberId === null
                ? principalFixture.client(USER_ID)
                : principalFixture.staff(USER_ID, [Role.Client, Role.Barber])),
          ),
        }),
      },
      {
        provide: PROFILE_PORTS,
        useValue: memoryProfilePorts(
          new Map([[USER_ID, user(linkedBarberId)]]),
        ),
      },
      {
        provide: GATEWAY_PORTS,
        useValue: scriptedGatewayPorts(
          {
            [Callables.UpdateProfile]: () =>
              options?.answer ?? Result.ok({ changed: true }),
            [Callables.SetBarberPhoto]: (call) =>
              options?.photoAnswer ?? Result.ok({ barberId: call.barberId }),
          },
          calls,
        ),
      },
      {
        provide: TEAM_ADMIN_PORTS,
        useFactory: () => teamAdminPorts(inject(GATEWAY_PORTS)),
      },
      {
        provide: STAGED_UPLOAD_PORTS,
        useValue: {
          stageUpload: async (
            userId: UserId,
            stagedName: string,
            image: Blob,
          ) => {
            staged.push({ userId, stagedName, image });
            return Result.ok(undefined);
          },
        },
      },
      {
        provide: ID_PORTS,
        useValue: {
          nextId: () => `minted-id-${String(++minted).padStart(8, '0')}`,
        },
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

  return {
    store: TestBed.inject(ProfileStore),
    calls,
    uploads,
    removals,
    staged,
  };
}

/** The browser measuring a picture — jsdom has no `createImageBitmap`. */
function measuredAs(width: number, height: number): void {
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width, height, close: () => undefined }),
  );
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

  describe('a linked barber — the photo is the record’s (one photo per barber, F7)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const photo = (): File =>
      new File(['bytes'], 'me.jpg', { type: 'image/jpeg' });

    /** The store of an account linked to Ivan's record, once its stored account has arrived. */
    const linked = async (photoAnswer?: PhotoAnswer): Promise<Harness> => {
      const harness = configure({
        linkedBarberId: IVAN,
        ...(photoAnswer === undefined ? {} : { photoAnswer }),
      });
      await vi.waitFor(() => expect(harness.store.photoIsBarbers()).toBe(true));
      return harness;
    };

    it('says whose photo it is: the record’s for a linked account, their own for everyone else', async () => {
      const own = configure().store;
      // The stored account has arrived, and it names no record.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(own.photoIsBarbers()).toBe(false);
      TestBed.resetTestingModule();
      expect((await linked()).store.photoIsBarbers()).toBe(true);
    });

    it('a pick sets the RECORD’S photo: staged under the account, named to setBarberPhoto with its size — and no avatar of its own is written', async () => {
      measuredAs(800, 1000);
      const { store, calls, uploads, staged } = await linked();
      const picked = photo();

      expect(await store.uploadPhoto(picked)).toEqual(Result.ok(undefined));

      expect(uploads).toEqual([]);
      expect(staged).toEqual([
        { userId: USER_ID, stagedName: 'minted-id-00000001', image: picked },
      ]);
      expect(calls).toEqual([
        {
          callable: Callables.SetBarberPhoto,
          input: {
            barberId: IVAN,
            stagedName: 'minted-id-00000001',
            mediaWidth: 800,
            mediaHeight: 1000,
            operationId: 'minted-id-00000002',
          },
        },
      ]);
      expect(store.pending()).toBe(false);
      expect(store.photoPending()).toBe(false);
    });

    it('a refusal of who may reads as “the shop manages your photo”; any other failed call as the upload-failed copy', async () => {
      measuredAs(800, 1000);
      const denied = await linked(
        Result.err(
          PipelineError.fromWire('permission-denied', {
            errorCode: AccessErrorCode.Denied,
          }),
        ),
      );
      expect(await denied.store.uploadPhoto(photo())).toEqual(
        Result.err(AccountsError.uploadAvatarShopManaged()),
      );

      TestBed.resetTestingModule();
      const failed = await linked(
        Result.err(PipelineError.bare(PipelineErrorCode.Unavailable)),
      );
      expect(await failed.store.uploadPhoto(photo())).toEqual(
        Result.err(AccountsError.uploadAvatarUploadFailed()),
      );
    });

    it('a picture the browser cannot measure is refused as no image — nothing staged, nothing called', async () => {
      // No `createImageBitmap` here: the record holds its photo's size.
      const { store, calls, staged } = await linked();

      expect(await store.uploadPhoto(photo())).toEqual(
        Result.err(AccountsError.uploadAvatarNotAnImage()),
      );
      expect(staged).toEqual([]);
      expect(calls).toEqual([]);
    });

    it('still refuses a non-image and an oversize file with the avatar’s own words first', async () => {
      const { store, staged } = await linked();

      expect(
        await store.uploadPhoto(
          new File(['x'], 'notes.txt', { type: 'text/plain' }),
        ),
      ).toEqual(refusedAs(AccountsErrorCode.UploadAvatarNotAnImage));
      expect(staged).toEqual([]);
    });
  });
});
