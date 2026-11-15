import { describe, expect, it } from 'vitest';
import { type DocBody, Role, StoredObjectFacts } from '@core/components';
import {
  BarberId,
  LogEvent,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import {
  AccessErrorCode,
  RepositoryError,
  RepositoryErrorCode,
  TeamErrorCode,
} from '@core/errors';
import {
  type Barber,
  BARBER_LINK_DOC,
  Collections,
  STAFF_PERMISSIONS_DOC,
  Subcollections,
  type User,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  auditRowsOf,
  barberFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  unwrapErr,
} from '@core/testing';
import {
  type SetBarberPhotoCommand,
  setBarberPhoto,
} from './set-barber-photo.pipeline';

/*
 * `setBarberPhoto` — a barber's ONE photo, replaced from an upload the
 * caller staged (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`):
 * who may before any object is touched, the staged object, the copy, the
 * write, and what follows a photo that landed.
 */

const ADMIN = UserId.of('u-admin');
const OP = OperationId.of('operation-photo-0123456');
const IVAN = FIXTURE_IDS.barber;
const NIKO = BarberId.of('niko');

const STAGED = `staffUploads/${ADMIN}/a1b2c3d4-staged`;
const PHOTO = `media/barbers/${IVAN}/${OP}`;
const OLDER = `media/barbers/${IVAN}/operation-older-0123456`;
const JPEG = StoredObjectFacts.unmeasured(90_000, 'image/jpeg');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
});
/** Ivan, with the catalogue's own picture, kept outside his folder. */
const STORED_IVAN: Barber = barberFixture({
  avatarMediaPath: 'media/barbers/ivan.jpg',
});

type RigOptions = {
  readonly caller?: User | null;
  readonly permissions?: DocBody;
  readonly barber?: Barber | null;
  /** The account linked to the record; none unless told. */
  readonly linkedUserId?: UserId;
  /** The objects in Storage, by path; the staged JPEG unless told. */
  readonly objects?: Readonly<Record<string, StoredObjectFacts>>;
  /** The paths whose copy or delete fails. */
  readonly failing?: readonly string[];
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const barber = options.barber === undefined ? STORED_IVAN : options.barber;
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [
          {
            path: [Collections.Settings, STAFF_PERMISSIONS_DOC],
            body: options.permissions,
          },
        ]),
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...(barber === null
      ? []
      : [{ path: [Collections.Barbers, barber.id], body: bodyOf(barber) }]),
    ...(options.linkedUserId === undefined
      ? []
      : [
          {
            path: [
              Collections.Barbers,
              IVAN,
              Subcollections.Restricted,
              BARBER_LINK_DOC,
            ],
            body: { linkedUserId: options.linkedUserId },
          },
        ]),
  ]);
  const objects = new Map<string, StoredObjectFacts>(
    Object.entries(options.objects ?? { [STAGED]: JPEG }),
  );
  const failing = options.failing ?? [];
  /** Every Storage call, in order: `stat:<path>`, `copy:<from>→<to>`, `delete:<path>`. */
  const storage: string[] = [];
  const logged: { level: string; msg: string; fields: unknown }[] = [];
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  const failed = (path: string) =>
    Result.err(RepositoryError.writeFailed(path, 'storage/internal'));
  return {
    store,
    tx,
    objects,
    storage,
    logged,
    run: setBarberPhoto({
      ...tx,
      commit,
      statStoredObject: async (path) => {
        storage.push(`stat:${path}`);
        return Result.ok(objects.get(path) ?? null);
      },
      copyStoredObject: async (fromPath, toPath) => {
        storage.push(`copy:${fromPath}→${toPath}`);
        const source = objects.get(fromPath);
        if (source === undefined || failing.includes(toPath)) {
          return failed(toPath);
        }
        objects.set(toPath, source);
        return Result.ok(undefined);
      },
      deleteStoredObject: async (path) => {
        storage.push(`delete:${path}`);
        if (failing.includes(path)) return failed(path);
        objects.delete(path);
        return Result.ok(undefined);
      },
      log: (level, msg, fields) => logged.push({ level, msg, fields }),
    }),
  };
}

const call = (
  extra: Partial<SetBarberPhotoCommand> = {},
): SetBarberPhotoCommand => ({
  callerUserId: ADMIN,
  callerRoles: [Role.Admin],
  operationId: OP,
  barberId: IVAN,
  stagedName: 'a1b2c3d4-staged',
  mediaWidth: 1200,
  mediaHeight: 1600,
  ...extra,
});

/** The plans that wrote something: the first commit only asks. */
const written = (plans: readonly (readonly unknown[])[]) =>
  plans.filter((plan) => plan.length > 0);

describe('setBarberPhoto — a photo that lands', () => {
  it('copies the staged picture into the barber’s folder, sets the record beside ONE row, and deletes the staged file', async () => {
    const { store, tx, objects, storage, run } = rig();

    expect(await run(call())).toEqual(Result.ok({ barberId: IVAN }));

    expect(storage).toEqual([
      `stat:${STAGED}`,
      `copy:${STAGED}→${PHOTO}`,
      `delete:${STAGED}`,
    ]);
    expect([...objects.keys()]).toEqual([PHOTO]);
    expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
      avatarMediaId: OP,
      avatarMediaPath: PHOTO,
      avatarMediaWidth: 1200,
      avatarMediaHeight: 1600,
      avatarMediaBlurhash: null,
      avatarMediaFocalX: 0.5,
      avatarMediaFocalY: 0.5,
      writeOperationId: OP,
    });
    expect(written(tx.plans)).toHaveLength(1);
    const rows = auditRowsOf(tx.plans);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: 'TEAM_BARBER_PHOTO_CHANGED',
      resourceId: `barbers/${IVAN}`,
      auditOperationId: OP,
      teamBarberFields: [
        'avatarMediaFocalX',
        'avatarMediaFocalY',
        'avatarMediaHeight',
        'avatarMediaId',
        'avatarMediaPath',
        'avatarMediaWidth',
      ],
    });
    expect(JSON.stringify(rows)).toContain(ADMIN);
    // Field names only: the row never carries the picture's path.
    expect(JSON.stringify(rows)).not.toContain(PHOTO);
  });

  it('rewrites the linked account’s avatar with the same picture, so the two never differ', async () => {
    const linkedUserId = UserId.of('u-ivan');
    const { objects, storage, run } = rig({ linkedUserId });

    expect((await run(call())).ok).toBe(true);

    expect(storage).toContain(`copy:${PHOTO}→avatars/u-ivan/original`);
    expect(objects.get('avatars/u-ivan/original')).toEqual(JPEG);
  });

  it('deletes the barber’s own older photo, and leaves the catalogue’s picture alone', async () => {
    const own = barberFixture({ avatarMediaPath: OLDER });
    const replaced = rig({
      barber: own,
      objects: { [STAGED]: JPEG, [OLDER]: JPEG },
    });
    await replaced.run(call());
    expect(replaced.storage).toContain(`delete:${OLDER}`);
    expect([...replaced.objects.keys()]).toEqual([PHOTO]);

    const seeded = rig({
      objects: { [STAGED]: JPEG, 'media/barbers/ivan.jpg': JPEG },
    });
    await seeded.run(call());
    expect(seeded.objects.has('media/barbers/ivan.jpg')).toBe(true);
  });

  it('a barber sets the photo of the record their own account is linked to', async () => {
    const ivanUser = registeredUserFixture({
      id: UserId.of('u-ivan'),
      roles: [Role.Barber],
      linkedBarberId: IVAN,
    });
    const { store, run } = rig({
      caller: ivanUser,
      linkedUserId: ivanUser.id,
      objects: { [`staffUploads/u-ivan/a1b2c3d4-staged`]: JPEG },
    });

    const answer = await run(
      call({ callerUserId: ivanUser.id, callerRoles: [Role.Barber] }),
    );

    expect(answer).toEqual(Result.ok({ barberId: IVAN }));
    expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
      avatarMediaPath: PHOTO,
    });
  });

  it('the replay of an act that landed answers at once: no object touched, nothing written', async () => {
    const held = barberFixture({ avatarMediaPath: PHOTO });
    const { tx, storage, run } = rig({ barber: held, objects: {} });

    expect(await run(call())).toEqual(Result.ok({ barberId: IVAN }));

    expect(storage).toEqual([]);
    expect(written(tx.plans)).toEqual([]);
  });
});

describe('setBarberPhoto — who may, before any object is touched', () => {
  it('refuses a token with no staff role as ACCESS_NOT_STAFF', async () => {
    const { storage, run } = rig();
    expect(unwrapErr(await run(call({ callerRoles: [Role.Client] })))).toEqual({
      errorCode: AccessErrorCode.NotStaff,
    });
    expect(storage).toEqual([]);
  });

  it('refuses the front desk, whose level edits no profile', async () => {
    const desk = registeredUserFixture({
      id: UserId.of('u-desk'),
      roles: [Role.Receptionist],
    });
    const { tx, storage, run } = rig({ caller: desk });

    expect(
      unwrapErr(
        await run(
          call({ callerUserId: desk.id, callerRoles: [Role.Receptionist] }),
        ),
      ),
    ).toMatchObject({ errorCode: AccessErrorCode.Denied });
    expect(storage).toEqual([]);
    expect(written(tx.plans)).toEqual([]);
  });

  it('refuses a barber on a colleague’s record as ACCESS_OWN_ONLY', async () => {
    const nikoUser = registeredUserFixture({
      id: UserId.of('u-niko'),
      roles: [Role.Barber],
      linkedBarberId: NIKO,
    });
    const { storage, run } = rig({ caller: nikoUser });

    expect(
      unwrapErr(
        await run(
          call({ callerUserId: nikoUser.id, callerRoles: [Role.Barber] }),
        ),
      ),
    ).toMatchObject({ errorCode: AccessErrorCode.OwnOnly });
    expect(storage).toEqual([]);
  });

  it('refuses a record that is not there, and one that has left', async () => {
    const missing = rig({ barber: null });
    expect(unwrapErr(await missing.run(call()))).toEqual({
      errorCode: TeamErrorCode.BarberNotFound,
      barberId: IVAN,
    });
    expect(missing.storage).toEqual([]);

    const departed = rig({
      barber: barberFixture(
        {},
        {
          barberStatus: 'DEPARTED',
          barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
          barberDepartedUserId: null,
          barberSessionsRevokedAtUtcMs: null,
          barberRehireStatus: 'PUBLIC',
        },
      ),
    });
    expect(unwrapErr(await departed.run(call())).errorCode).toBe(
      TeamErrorCode.BarberDeparted,
    );
    expect(departed.storage).toEqual([]);
  });

  it('refuses a staged name that climbs out of the caller’s folder, before anything is read', async () => {
    const { tx, storage, run } = rig();
    expect(
      unwrapErr(await run(call({ stagedName: '../u-other/their-file' }))),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'stagedName' });
    expect(storage).toEqual([]);
    expect(tx.plans).toEqual([]);
  });
});

describe('setBarberPhoto — the staged object', () => {
  it('refuses a picture that was never staged as TEAM_PHOTO_MISSING', async () => {
    const { tx, storage, run } = rig({ objects: {} });

    expect(unwrapErr(await run(call()))).toEqual({
      errorCode: TeamErrorCode.PhotoMissing,
    });
    expect(storage).toEqual([`stat:${STAGED}`]);
    expect(written(tx.plans)).toEqual([]);
  });

  it('reads only the caller’s own staging folder: another account’s upload is not there', async () => {
    const { run } = rig({
      objects: { 'staffUploads/u-other/a1b2c3d4-staged': JPEG },
    });
    expect(unwrapErr(await run(call())).errorCode).toBe(
      TeamErrorCode.PhotoMissing,
    );
  });

  it('refuses what is no picture the shop shows as TEAM_PHOTO_INVALID, and copies nothing', async () => {
    for (const facts of [
      StoredObjectFacts.unmeasured(1000, 'application/pdf'),
      StoredObjectFacts.unmeasured(6 * 1024 * 1024, 'image/jpeg'),
    ]) {
      const { storage, run } = rig({ objects: { [STAGED]: facts } });
      expect(unwrapErr(await run(call()))).toEqual({
        errorCode: TeamErrorCode.PhotoInvalid,
      });
      expect(storage).toEqual([`stat:${STAGED}`]);
    }
  });
});

describe('setBarberPhoto — what can go wrong on the way', () => {
  it('a copy that fails is the call’s answer, and nothing is written', async () => {
    const { tx, run } = rig({ failing: [PHOTO] });

    expect(unwrapErr(await run(call())).errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
    expect(written(tx.plans)).toEqual([]);
  });

  it('a write refused after the copy deletes the copy: no object is left that nothing names', async () => {
    let commits = 0;
    const { store, objects, storage, run } = rig({
      commit: (commit) => (read, decide) => {
        commits++;
        // The record is deleted between the question and the write.
        if (commits === 2) store.delete(`${Collections.Barbers}/${IVAN}`);
        return commit(read, decide);
      },
    });

    expect(unwrapErr(await run(call())).errorCode).toBe(
      TeamErrorCode.BarberNotFound,
    );
    expect(storage).toContain(`delete:${PHOTO}`);
    expect(objects.has(PHOTO)).toBe(false);
    // The staged upload stays for the next try.
    expect(objects.has(STAGED)).toBe(true);
  });

  it('an avatar that could not be rewritten is logged; the photo stands', async () => {
    const { logged, store, run } = rig({
      linkedUserId: UserId.of('u-ivan'),
      failing: ['avatars/u-ivan/original'],
    });

    expect(await run(call())).toEqual(Result.ok({ barberId: IVAN }));
    expect(store.get(`${Collections.Barbers}/${IVAN}`)).toMatchObject({
      avatarMediaPath: PHOTO,
    });
    expect(logged).toEqual([
      {
        level: 'error',
        msg: LogEvent.TeamPhotoMirrorFailed,
        fields: {
          barberId: IVAN,
          linkedUserId: 'u-ivan',
          errorCode: RepositoryErrorCode.WriteFailed,
        },
      },
    ]);
  });

  it('a staged file that could not be deleted is logged; the photo stands', async () => {
    const { logged, run } = rig({ failing: [STAGED] });

    expect(await run(call())).toEqual(Result.ok({ barberId: IVAN }));
    expect(logged.map((line) => [line.level, line.msg])).toEqual([
      ['warn', LogEvent.TeamPhotoCleanupFailed],
    ]);
  });
});
