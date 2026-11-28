import { describe, expect, it } from 'vitest';
import { PositionId, Result, type UtcEpochMs } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { unwrapErr, unwrapOk } from '@core/testing';
import { sweepProgramImages } from './sweep-program-images.pipeline';

/*
 * `sweepProgramImages` — after a description's write: the pictures it no
 * longer names, older than an hour, removed.
 */

const NOW = 1_800_000_000_000 as UtcEpochMs;
const HOUR = 3_600_000;
const FOLDER = 'media/programs/role-barber/';
const ROLE = PositionId.of('role-barber');

function rig(
  ages: Record<string, number>,
  options: { readonly listFails?: boolean; readonly stuck?: string } = {},
) {
  const store = new Map(
    Object.entries(ages).map(([name, age]) => [`${FOLDER}${name}`, age]),
  );
  const logged: { msg: string; fields: unknown }[] = [];
  return {
    names: () => [...store.keys()].map((path) => path.slice(FOLDER.length)),
    logged,
    run: sweepProgramImages({
      listStoredObjects: async (prefix) =>
        options.listFails === true
          ? Result.err(RepositoryError.writeFailed(prefix, 'unavailable'))
          : Result.ok(
              [...store.entries()].map(([path, age]) => ({
                path,
                createdUtcMs: (NOW - age) as UtcEpochMs,
              })),
            ),
      deleteStoredObject: async (path) => {
        if (path === `${FOLDER}${options.stuck ?? ''}`) {
          return Result.err(RepositoryError.writeFailed(path, 'unavailable'));
        }
        store.delete(path);
        return Result.ok(undefined);
      },
      nowUtcMs: () => NOW,
      log: (_level, msg, fields) => logged.push({ msg, fields }),
    }),
  };
}

describe('sweepProgramImages', () => {
  it('removes what the saved description does not name, and keeps the young', async () => {
    const { run, names } = rig({
      'pic-a': 9 * HOUR,
      'pic-gone': 9 * HOUR,
      'pic-new': HOUR / 2,
    });
    const answer = await run({
      programId: ROLE,
      body: { bg: '![Стол](pic-a)', en: '![Chair](pic-a)' },
    });
    expect(unwrapOk(answer)).toEqual({ removed: 1 });
    expect(names()).toEqual(['pic-a', 'pic-new']);
  });

  it('removes every settled picture of a description that was removed', async () => {
    const { run, names } = rig({ 'pic-a': 9 * HOUR, 'pic-b': 2 * HOUR });
    expect(unwrapOk(await run({ programId: ROLE, body: null }))).toEqual({
      removed: 2,
    });
    expect(names()).toEqual([]);
  });

  it('finds nothing to remove on a second run', async () => {
    const { run } = rig({ 'pic-gone': 9 * HOUR });
    await run({ programId: ROLE, body: null });
    expect(unwrapOk(await run({ programId: ROLE, body: null }))).toEqual({
      removed: 0,
    });
  });

  it('logs an object it could not remove and goes on', async () => {
    const { run, names, logged } = rig(
      { 'pic-a': 9 * HOUR, 'pic-b': 9 * HOUR },
      { stuck: 'pic-a' },
    );
    expect(unwrapOk(await run({ programId: ROLE, body: null }))).toEqual({
      removed: 1,
    });
    expect(names()).toEqual(['pic-a']);
    expect(logged).toEqual([
      {
        msg: 'program.image_cleanup_failed',
        fields: {
          path: `${FOLDER}pic-a`,
          errorCode: 'REPOSITORY_WRITE_FAILED',
        },
      },
    ]);
  });

  it('answers the listing’s failure, so the trigger tries again', async () => {
    const { run } = rig({}, { listFails: true });
    expect(
      unwrapErr(await run({ programId: ROLE, body: null })).errorCode,
    ).toBe('REPOSITORY_WRITE_FAILED');
  });
});
