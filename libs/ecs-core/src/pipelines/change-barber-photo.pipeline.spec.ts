import { describe, expect, it } from 'vitest';
import type { TeamCall } from '@core/components';
import { BarberId, Result, UserId } from '@core/primitives';
import {
  MediaError,
  PipelineError,
  PipelineErrorCode,
  TeamErrorCode,
} from '@core/errors';
import { unwrapErr } from '@core/testing';
import {
  type ChangeBarberPhotoInput,
  changeBarberPhoto,
} from './change-barber-photo.pipeline';

/*
 * `changeBarberPhoto` — the browser's half of a barber's ONE photo
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): the
 * picture checked, staged under the signed-in account and handed to
 * `setBarberPhoto` by its name.
 */

const EDITOR = UserId.of('u-editor');
const IVAN = BarberId.of('ivan');

/** A picture as the browser hands it over: only its type and size are read. */
const picture = (type: string, size: number): Blob =>
  ({ type, size }) as unknown as Blob;

const input = (
  over: Partial<ChangeBarberPhotoInput> = {},
): ChangeBarberPhotoInput => ({
  userId: EDITOR,
  barberId: IVAN,
  image: picture('image/jpeg', 90_000),
  mediaWidth: 1200,
  mediaHeight: 1600,
  ...over,
});

function rig(
  options: {
    readonly stagingFails?: boolean;
    readonly refusal?: PipelineError;
  } = {},
) {
  const staged: { userId: string; stagedName: string; image: Blob }[] = [];
  const calls: TeamCall.Photo[] = [];
  let minted = 0;
  return {
    staged,
    calls,
    run: changeBarberPhoto({
      nextId: () => `minted-id-${String(++minted).padStart(8, '0')}`,
      stageUpload: async (userId, stagedName, image) => {
        if (options.stagingFails === true) {
          return Result.err(MediaError.transient('staffUploads'));
        }
        staged.push({ userId, stagedName, image });
        return Result.ok(undefined);
      },
      setBarberPhoto: async (call) => {
        calls.push(call);
        return options.refusal === undefined
          ? Result.ok({ barberId: call.barberId })
          : Result.err(options.refusal);
      },
    }),
  };
}

describe('changeBarberPhoto', () => {
  it('stages the picture under the signed-in account, then names it to the call with its size and the act’s own name', async () => {
    const { staged, calls, run } = rig();
    const image = picture('image/jpeg', 90_000);

    expect(await run(input({ image }))).toEqual(Result.ok({ barberId: IVAN }));

    expect(staged).toEqual([
      { userId: EDITOR, stagedName: 'minted-id-00000001', image },
    ]);
    expect(calls).toEqual([
      {
        barberId: IVAN,
        stagedName: 'minted-id-00000001',
        mediaWidth: 1200,
        mediaHeight: 1600,
        operationId: 'minted-id-00000002',
      },
    ]);
  });

  it('refuses what is no picture the shop shows before anything is uploaded', async () => {
    for (const image of [
      picture('application/pdf', 1000),
      picture('', 1000),
      picture('image/jpeg', 6 * 1024 * 1024),
      picture('image/png', 0),
    ]) {
      const { staged, calls, run } = rig();
      const refusal = unwrapErr(await run(input({ image })));
      expect(refusal.errorCode).toBe(PipelineErrorCode.InvalidRequest);
      // The screen words it as the server would have.
      expect(refusal.serverErrorCode).toBe(TeamErrorCode.PhotoInvalid);
      expect(staged).toEqual([]);
      expect(calls).toEqual([]);
    }
  });

  it('an upload that fails is worth trying again, and no call is made', async () => {
    const { calls, run } = rig({ stagingFails: true });

    expect(unwrapErr(await run(input())).errorCode).toBe(
      PipelineErrorCode.Unavailable,
    );
    expect(calls).toEqual([]);
  });

  it('answers the call’s own refusal as it is', async () => {
    const refusal = PipelineError.fromWire('functions/permission-denied', {
      errorCode: 'ACCESS_DENIED',
      staffCapability: 'TEAM_PROFILES',
    });
    const { run } = rig({ refusal });

    expect(await run(input())).toEqual(Result.err(refusal));
  });
});
