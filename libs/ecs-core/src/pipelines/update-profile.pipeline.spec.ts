import { describe, expect, it } from 'vitest';
import {
  ActorRole,
  AuditAction,
  E164,
  Email,
  type RegistrationField,
  WriteOp,
  type ProfileEdits,
} from '@core/components';
import { AuditEntryId, OperationId, UserId } from '@core/primitives';
import { AccountsErrorCode } from '@core/errors';
import { Collections, type User } from '@core/entities';
import { AuditSystem, SearchFieldsSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  type IdentityWorld,
  memoryIdentityWorld,
  memoryTxPorts,
  provisionedUserFixture,
  recordingTelemetry,
  registeredUserFixture,
  unwrapOk,
} from '@core/testing';
import {
  type UpdateProfileCommand,
  updateProfile,
} from './update-profile.pipeline';

/*
 * `updateProfile` (identity flip (2), F2-5; owner ruling flip-2 §10.15,
 * Phase 4a 4A-16): one transaction, the one profile-edit rule
 * (`ProfileEditSystem.decide`), one root-key `Update` of the five owner
 * keys with the `profileEditedAtUtcMs` marker, and the edit's ONE audit row
 * `Create`d in the same plan, credited to the caller — or nothing when
 * nothing changes, so the same edit twice writes once and leaves one row.
 */

const UID = UserId.of('u-client');
const PATH = [Collections.Users, UID];

const KEEP: ProfileEdits = { firstName: null, lastName: null, birthDate: null };

const edit = (edits: Partial<ProfileEdits>): UpdateProfileCommand => ({
  callerUserId: UID,
  edits: { ...KEEP, ...edits },
  operationId: null,
});

function rig(users: readonly User[]) {
  const world: IdentityWorld = memoryIdentityWorld({ users });
  const tx = memoryTxPorts(world.store);
  const telemetry = recordingTelemetry();
  const run = updateProfile({
    commit: tx.commit,
    nowUtcMs: tx.nowUtcMs,
    hash: tx.hash,
    log: telemetry.log,
    trackError: telemetry.trackError,
  });
  return { world, tx, telemetry, run };
}

/** The edit's row as the plan `Create`s it: `AuditSystem.planOwnProfileEdit` over `fields`, under `hash(basis)`. */
function rowWrite(
  fields: readonly RegistrationField[],
  operationId: OperationId | null = null,
): WriteOp {
  const plan = AuditSystem.planOwnProfileEdit(
    UID,
    fields,
    FIXTURE_NOW_UTC_MS,
    operationId,
  );
  if (plan === null) throw new Error('no row');
  return WriteOp.create(
    [Collections.AuditLog, AuditEntryId.of(fixtureHash(plan.idBasis))],
    plan.row,
  );
}

describe('updateProfile', () => {
  it('writes the five owner keys and the marker in ONE root-key Update, the search keys from the STORED contact, beside the edit’s row', async () => {
    const maria = registeredUserFixture({
      email: Email.of('maria@example.com'),
    });
    const { world, tx, run } = rig([maria]);
    const answer = await run(edit({ firstName: '  Mariya ' }));
    expect(answer).toEqual({
      ok: true,
      value: { changed: true },
    });
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // exactly these keys, in this order, byte for byte on the wire.
    expect(Object.keys(unwrapOk(answer))).toEqual(['changed']);
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
          profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
        }),
        rowWrite(['firstName']),
      ],
    ]);
    expect(world.store.get(PATH.join('/'))).toMatchObject({
      firstName: 'Mariya',
      phone: maria.phone,
      email: 'maria@example.com',
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
  });

  it('credits the row to the caller — PROFILE_UPDATED, the changed field NAMES, the edit’s instant (4A-16)', async () => {
    const { world, run } = rig([registeredUserFixture()]);
    await run(edit({ firstName: 'Mariya', birthDate: '1990-07-03' }));
    const rows = [...world.store.entries()].filter(([path]) =>
      path.startsWith(`${Collections.AuditLog}/`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[1]).toMatchObject({
      actorRole: ActorRole.User,
      actorUserId: UID,
      auditAction: AuditAction.ProfileUpdated,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(rowWrite(['firstName', 'birthDate'])).toMatchObject({
      body: rows[0]?.[1],
    });
    // The call sent no transport id: the row names no operation (RU-21).
    expect(rows[0]?.[1]?.['auditOperationId']).toBeNull();
  });

  it('names the call’s transport operation id on the row when it sent one (WS-4.4) — the row id unchanged', async () => {
    const OPERATION = OperationId.of('profile-op-0123456789');
    const { tx, run } = rig([registeredUserFixture()]);
    await run({ ...edit({ lastName: 'Ivanova' }), operationId: OPERATION });
    const write = tx.plans[0]?.at(-1);
    expect(write).toEqual(rowWrite(['lastName'], OPERATION));
    expect(write?.path).toEqual(rowWrite(['lastName'], null).path);
    expect(
      write?.writeAction === 'CREATE' && write.body['auditOperationId'],
    ).toBe(OPERATION);
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
    // ONE row for the one landed edit.
    expect(
      [...world.store.keys()].filter((path) =>
        path.startsWith(`${Collections.AuditLog}/`),
      ),
    ).toHaveLength(1);
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
