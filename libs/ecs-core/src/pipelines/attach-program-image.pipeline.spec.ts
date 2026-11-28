import { describe, expect, it } from 'vitest';
import type { ProgramImageCall } from '@core/components';
import { PositionId, ProgramImageId, Result, UserId } from '@core/primitives';
import {
  EngagementErrorCode,
  MediaError,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { unwrapErr, unwrapOk } from '@core/testing';
import {
  type AttachProgramImageInput,
  attachProgramImage,
} from './attach-program-image.pipeline';

/*
 * `attachProgramImage` — the browser's half of a description's picture:
 * checked, staged under the signed-in account and handed to
 * `addProgramImage` by its name.
 */

/** A picture as the browser hands it over: only its type and size are read. */
const picture = (type: string, size: number): Blob =>
  ({ type, size }) as unknown as Blob;

const input = (
  over: Partial<AttachProgramImageInput> = {},
): AttachProgramImageInput => ({
  userId: UserId.of('u-editor'),
  programId: PositionId.of('role-barber'),
  image: picture('image/jpeg', 90_000),
  mediaWidth: 1600,
  mediaHeight: 900,
  ...over,
});

function rig(
  options: {
    readonly stagingFails?: boolean;
    readonly refusal?: PipelineError;
  } = {},
) {
  const staged: { userId: string; stagedName: string }[] = [];
  const calls: ProgramImageCall.Add[] = [];
  let minted = 0;
  return {
    staged,
    calls,
    run: attachProgramImage({
      nextId: () => `minted-id-${String(++minted).padStart(8, '0')}`,
      stageUpload: async (userId, stagedName) => {
        if (options.stagingFails === true) {
          return Result.err(MediaError.transient('pending'));
        }
        staged.push({ userId, stagedName });
        return Result.ok(undefined);
      },
      addProgramImage: async (call) => {
        calls.push(call);
        return options.refusal === undefined
          ? Result.ok({ imageId: ProgramImageId.of('pic_1600x900') })
          : Result.err(options.refusal);
      },
    }),
  };
}

describe('attachProgramImage', () => {
  it('stages the picture under the account and calls with its name', async () => {
    const { run, staged, calls } = rig();
    expect(unwrapOk(await run(input()))).toEqual({ imageId: 'pic_1600x900' });
    expect(staged).toEqual([
      { userId: 'u-editor', stagedName: 'minted-id-00000001' },
    ]);
    expect(calls).toEqual([
      {
        programId: 'role-barber',
        stagedName: 'minted-id-00000001',
        mediaWidth: 1600,
        mediaHeight: 900,
        operationId: 'minted-id-00000002',
      },
    ]);
  });

  it.each([
    ['no image type', { image: picture('', 90_000) }],
    ['another type', { image: picture('application/pdf', 90_000) }],
    ['too large', { image: picture('image/jpeg', 6 * 1024 * 1024) }],
    ['a width nobody measured', { mediaWidth: null }],
    ['a height nobody measured', { mediaHeight: null }],
  ] as const)('refuses %s before anything is uploaded', async (_, over) => {
    const { run, staged, calls } = rig();
    const refusal = unwrapErr(await run(input(over)));
    expect(refusal.errorCode).toBe(PipelineErrorCode.InvalidRequest);
    expect(refusal.serverErrorCode).toBe(
      EngagementErrorCode.ProgramImageInvalid,
    );
    expect(staged).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers a failed upload as worth trying again, and does not call', async () => {
    const { run, calls } = rig({ stagingFails: true });
    expect(unwrapErr(await run(input())).errorCode).toBe(
      PipelineErrorCode.Unavailable,
    );
    expect(calls).toEqual([]);
  });

  it('answers the call’s refusal as it is', async () => {
    const refusal = PipelineError.bare(PipelineErrorCode.Unavailable);
    const { run } = rig({ refusal });
    expect(unwrapErr(await run(input()))).toBe(refusal);
  });
});
