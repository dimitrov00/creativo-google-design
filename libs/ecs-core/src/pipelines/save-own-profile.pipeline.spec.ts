import { describe, expect, it } from 'vitest';
import { ProfileEdits } from '@core/components';
import { Callables } from '@core/ports';
import { Result } from '@core/primitives';
import {
  AccountsError,
  AccountsErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { type GatewayCall, scriptedGatewayPorts } from '@core/testing';
import { saveOwnProfile } from './save-own-profile.pipeline';

/*
 * MOVED with the use case (pass C, C-31) from
 * `libs/features/client/account-state/src/lib/own-profile.spec.ts`, cases
 * byte-identical: the owner's profile write through `updateProfile`
 * (Phase 4a 4A-3 (2)): `Result.ok` on success; the edit's own refusals
 * worded by their codes; EVERY other failure today's one copy,
 * `AccountsErrorCode.UpdateProfileRepositoryFailure` — a store
 * failure, a transport failure, an expired session, an unavailable or an
 * unknown one (§3.9). Each branch pinned over the scripted gateway. Pass D
 * (§2.11): the same refusals, now `AccountsError.OwnProfileSave` structs
 * inside a `Result`.
 */
const EDITS = { ...ProfileEdits.keep(), firstName: 'Mila' };

const failingWith = (error: PipelineError) =>
  scriptedGatewayPorts({ [Callables.UpdateProfile]: () => Result.err(error) });

const fromWire = (status: string, errorCode: string | null) =>
  PipelineError.fromWire(
    status,
    errorCode === null ? undefined : { errorCode },
  );

describe('saveOwnProfile', () => {
  it('sends the edits to updateProfile and answers ok on success', async () => {
    const calls: GatewayCall[] = [];
    const gateway = scriptedGatewayPorts(
      { [Callables.UpdateProfile]: () => Result.ok({ changed: true }) },
      calls,
    );
    expect(await saveOwnProfile(gateway)(EDITS)).toEqual(Result.ok(undefined));
    expect(calls).toEqual([{ callable: 'updateProfile', input: EDITS }]);
  });

  it('answers an unchanged edit as a success too — nothing written', async () => {
    const gateway = scriptedGatewayPorts({
      [Callables.UpdateProfile]: () => Result.ok({ changed: false }),
    });
    expect(await saveOwnProfile(gateway)(EDITS)).toEqual(Result.ok(undefined));
  });

  it.each([
    AccountsErrorCode.UpdateProfileNotFound,
    AccountsErrorCode.UpdateProfileValidationFailed,
  ])('words the edit’s own refusal %s by its code', async (code) => {
    const status =
      code === AccountsErrorCode.UpdateProfileNotFound
        ? 'not-found'
        : 'invalid-argument';
    expect(
      await saveOwnProfile(failingWith(fromWire(status, code)))(EDITS),
    ).toEqual(Result.err({ errorCode: code }));
  });

  it.each([
    ['the edge’s bare INTERNAL store failure', fromWire('internal', null)],
    ['a transport failure (offline)', fromWire('unavailable', null)],
    [
      'an expired session',
      fromWire(
        'unauthenticated',
        AccountsErrorCode.UpdateProfileUnauthenticated,
      ),
    ],
    [
      'a store failure the struct names',
      fromWire('internal', 'REPOSITORY_WRITE_FAILED'),
    ],
    [
      'an unavailable failure',
      PipelineError.bare(PipelineErrorCode.Unavailable),
    ],
    ['an unknown failure', PipelineError.bare(PipelineErrorCode.Unknown)],
  ])('words %s as today’s one failed-write copy', async (_what, error) => {
    expect(await saveOwnProfile(failingWith(error))(EDITS)).toEqual(
      Result.err(AccountsError.updateProfileRepositoryFailure()),
    );
    expect(AccountsErrorCode.UpdateProfileRepositoryFailure).toBe(
      'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE',
    );
  });
});
