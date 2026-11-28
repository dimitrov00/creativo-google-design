import { describe, expect, it } from 'vitest';
import { Role, StoredObjectFacts } from '@core/components';
import {
  OperationId,
  PositionId,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { EngagementErrorCode, RepositoryError } from '@core/errors';
import { unwrapErr, unwrapOk } from '@core/testing';
import { ProgramImageSystem } from '@core/systems';
import {
  type AddProgramImageCommand,
  addProgramImage,
} from './add-program-image.pipeline';

/*
 * `addProgramImage` — a picture for a description, taken from the caller's
 * staged upload: who may, a replay, room in the folder, the staged object,
 * the copy and the staged upload's removal.
 */

const STAGED = 'pending/u-editor/staged-0123456789';
const MEDIA = 'media/programs/role-barber/operation-0123456789ab_1600x900';
const JPEG = StoredObjectFacts.unmeasured(90_000, 'image/jpeg');

const command = (
  over: Partial<AddProgramImageCommand> = {},
): AddProgramImageCommand => ({
  callerUserId: UserId.of('u-editor'),
  callerRoles: [Role.ContentManager],
  programId: PositionId.of('role-barber'),
  operationId: OperationId.of('operation-0123456789ab'),
  stagedName: 'staged-0123456789',
  mediaWidth: 1600,
  mediaHeight: 900,
  ...over,
});

function rig(
  objects: Record<string, StoredObjectFacts>,
  options: { readonly deleteFails?: boolean } = {},
) {
  const store = new Map(Object.entries(objects));
  const logged: { msg: string; fields: unknown }[] = [];
  return {
    store,
    logged,
    run: addProgramImage({
      statStoredObject: async (path) => Result.ok(store.get(path) ?? null),
      copyStoredObject: async (from, to) => {
        const source = store.get(from);
        if (source === undefined) {
          return Result.err(RepositoryError.writeFailed(to, 'not-found'));
        }
        store.set(to, source);
        return Result.ok(undefined);
      },
      deleteStoredObject: async (path) => {
        if (options.deleteFails === true) {
          return Result.err(RepositoryError.writeFailed(path, 'unavailable'));
        }
        store.delete(path);
        return Result.ok(undefined);
      },
      listStoredObjects: async (prefix) =>
        Result.ok(
          [...store.keys()]
            .filter((path) => path.startsWith(prefix))
            .map((path) => ({ path, createdUtcMs: 0 as UtcEpochMs })),
        ),
      log: (_level, msg, fields) => logged.push({ msg, fields }),
    }),
  };
}

describe('addProgramImage', () => {
  it('copies the staged picture into the folder and removes the staged one', async () => {
    const { run, store } = rig({ [STAGED]: JPEG });
    expect(unwrapOk(await run(command()))).toEqual({
      imageId: 'operation-0123456789ab_1600x900',
    });
    expect([...store.keys()]).toEqual([MEDIA]);
  });

  it('refuses a call with no session', async () => {
    const { run, store } = rig({ [STAGED]: JPEG });
    expect(
      unwrapErr(await run(command({ callerUserId: null }))).errorCode,
    ).toBe(EngagementErrorCode.ProgramImageUnauthenticated);
    expect([...store.keys()]).toEqual([STAGED]);
  });

  it.each([[[Role.Barber]], [[Role.Receptionist]], [[]]])(
    'refuses roles %j, which do not write the programs pages',
    async (callerRoles) => {
      const { run } = rig({ [STAGED]: JPEG });
      expect(unwrapErr(await run(command({ callerRoles }))).errorCode).toBe(
        EngagementErrorCode.ProgramImageForbidden,
      );
    },
  );

  it.each([[[Role.Admin]], [[Role.Sysadmin]], [[Role.Barber, Role.Admin]]])(
    'admits roles %j',
    async (callerRoles) => {
      const { run } = rig({ [STAGED]: JPEG });
      expect((await run(command({ callerRoles }))).ok).toBe(true);
    },
  );

  it('answers a replay its id again, though the staged upload is gone', async () => {
    const { run, store } = rig({ [MEDIA]: JPEG });
    expect(unwrapOk(await run(command()))).toEqual({
      imageId: 'operation-0123456789ab_1600x900',
    });
    expect([...store.keys()]).toEqual([MEDIA]);
  });

  it('refuses a picture that was never staged', async () => {
    const { run } = rig({});
    expect(unwrapErr(await run(command())).errorCode).toBe(
      EngagementErrorCode.ProgramImageMissing,
    );
  });

  it('refuses a staged object that is no picture, and copies nothing', async () => {
    const { run, store } = rig({
      [STAGED]: StoredObjectFacts.unmeasured(90_000, 'application/pdf'),
    });
    expect(unwrapErr(await run(command())).errorCode).toBe(
      EngagementErrorCode.ProgramImageInvalid,
    );
    expect([...store.keys()]).toEqual([STAGED]);
  });

  it('refuses a folder that is full', async () => {
    const full: Record<string, StoredObjectFacts> = { [STAGED]: JPEG };
    for (let index = 0; index < ProgramImageSystem.FOLDER_MAX; index++) {
      full[`media/programs/role-barber/pic-${index}`] = JPEG;
    }
    const { run } = rig(full);
    expect(unwrapErr(await run(command())).errorCode).toBe(
      EngagementErrorCode.ProgramImagesFull,
    );
  });

  it('names the field of a malformed request', async () => {
    const { run } = rig({ [STAGED]: JPEG });
    expect(unwrapErr(await run(command({ mediaWidth: 9000 })))).toEqual({
      errorCode: EngagementErrorCode.ProgramImageInvalidInput,
      field: 'mediaWidth',
    });
  });

  it('still answers the picture when the staged upload cannot be removed, and logs it', async () => {
    const { run, logged } = rig({ [STAGED]: JPEG }, { deleteFails: true });
    expect((await run(command())).ok).toBe(true);
    expect(logged).toEqual([
      {
        msg: 'program.image_cleanup_failed',
        fields: {
          path: STAGED,
          operationId: 'operation-0123456789ab',
          errorCode: 'REPOSITORY_WRITE_FAILED',
        },
      },
    ]);
  });
});
