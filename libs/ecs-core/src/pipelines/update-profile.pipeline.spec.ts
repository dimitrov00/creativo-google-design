import { describe, expect, it } from 'vitest';
import { E164, Email, WriteOp } from '@core/components';
import { AccountsErrorCode, UserId } from '@core/primitives';
import { Collections, type User } from '@core/entities';
import { type ProfileEdits, SearchFieldsSystem } from '@core/systems';
import {
  type IdentityWorld,
  memoryIdentityWorld,
  memoryTxPorts,
  provisionedUserFixture,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import {
  type UpdateProfileCommand,
  updateProfile,
} from './update-profile.pipeline';

/*
 * `updateProfile` (identity flip (2), F2-5): one transaction, the one
 * profile-edit rule (`ProfileEditSystem.decide`), one root-key `Update` of
 * the five owner keys — or none when nothing changes, so the same edit
 * twice writes once (and leaves the profile trigger one row, not two).
 */

const UID = UserId.of('u-client');
const PATH = [Collections.Users, UID];

const KEEP: ProfileEdits = { firstName: null, lastName: null, birthDate: null };

const edit = (edits: Partial<ProfileEdits>): UpdateProfileCommand => ({
  callerUserId: UID,
  edits: { ...KEEP, ...edits },
});

function rig(users: readonly User[]) {
  const world: IdentityWorld = memoryIdentityWorld({ users });
  const tx = memoryTxPorts(world.store);
  const telemetry = recordingTelemetry();
  const run = updateProfile({
    commit: tx.commit,
    nowUtcMs: tx.nowUtcMs,
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { world, tx, telemetry, run };
}

describe('updateProfile', () => {
  it('writes the five owner keys in ONE root-key Update, the search keys from the STORED contact', async () => {
    const maria = registeredUserFixture({
      email: Email.of('maria@example.com'),
    });
    const { world, tx, run } = rig([maria]);
    expect(await run(edit({ firstName: '  Mariya ' }))).toEqual({
      ok: true,
      value: { changed: true },
    });
    const search = SearchFieldsSystem.searchFields(
      'Mariya',
      'Petrova',
      maria.phone,
      maria.email,
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.update(PATH, {
          firstName: 'Mariya',
          lastName: 'Petrova',
          birthDate: null,
          searchName: search.searchName,
          searchPrefixes: search.searchPrefixes,
        }),
      ],
    ]);
    expect(world.store.get(PATH.join('/'))).toMatchObject({
      firstName: 'Mariya',
      phone: maria.phone,
      email: 'maria@example.com',
    });
  });

  it('reads only the caller’s own account inside the transaction', async () => {
    const { tx, run } = rig([registeredUserFixture()]);
    await run(edit({ lastName: 'Ivanova' }));
    expect(tx.transactions[0]?.reads).toEqual([PATH]);
  });

  it('is value-idempotent: an identical second call writes nothing and answers unchanged', async () => {
    const { world, tx, run } = rig([registeredUserFixture()]);
    expect(await run(edit({ birthDate: '1990-07-03' }))).toEqual({
      ok: true,
      value: { changed: true },
    });
    const after = world.store.get(PATH.join('/'));
    expect(await run(edit({ birthDate: '1990-07-03' }))).toEqual({
      ok: true,
      value: { changed: false },
    });
    expect(tx.plans[1]).toEqual([]);
    expect(world.store.get(PATH.join('/'))).toEqual(after);
  });

  it('answers unchanged for an edit equal to the stored values', async () => {
    const { tx, run } = rig([registeredUserFixture()]);
    expect(await run(edit({ firstName: 'Maria' }))).toEqual({
      ok: true,
      value: { changed: false },
    });
    expect(tx.plans).toEqual([[]]);
  });

  it('refuses an absent account and a provisioned stub as not found — nothing written', async () => {
    for (const users of [[], [provisionedUserFixture()]]) {
      const { tx, telemetry, run } = rig(users);
      expect(await run(edit({ firstName: 'Maria' }))).toEqual({
        ok: false,
        error: { errorCode: AccountsErrorCode.UpdateProfileNotFound },
      });
      expect(tx.plans).toEqual([]);
      expect(telemetry.lines).toEqual([
        {
          level: 'info',
          msg: 'profile.update.refused',
          fields: {
            uid: UID,
            errorCode: AccountsErrorCode.UpdateProfileNotFound,
          },
        },
      ]);
    }
  });

  it('refuses a short name or a birth date outside the window as one validation failure', async () => {
    for (const edits of [
      { firstName: 'M' },
      { lastName: ' ' },
      { birthDate: '2020-01-01' },
      { birthDate: '1990-02-30' },
    ]) {
      const { tx, run } = rig([registeredUserFixture()]);
      expect(await run(edit(edits))).toEqual({
        ok: false,
        error: { errorCode: AccountsErrorCode.UpdateProfileValidationFailed },
      });
      expect(tx.plans).toEqual([]);
    }
  });

  it('never touches the contact channels — a phone-only account keeps its phone', async () => {
    const phoneOnly = registeredUserFixture({
      phone: E164.of('+359888000111'),
    });
    const { world, run } = rig([phoneOnly]);
    await run(edit({ lastName: 'Georgieva' }));
    expect(world.store.get(PATH.join('/'))).toMatchObject({
      phone: '+359888000111',
      email: null,
      lastName: 'Georgieva',
    });
  });
});
