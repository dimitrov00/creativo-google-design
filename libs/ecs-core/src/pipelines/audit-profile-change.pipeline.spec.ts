import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  type RegistrationField,
  SystemSource,
} from '@core/components';
import {
  AuditEntryId,
  AuditResourceId,
  Result,
  TriggerEventId,
  UserId,
} from '@core/primitives';
import { GovernanceError, RepositoryError } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import { AuditSystem, type ProfileChange } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  pinnedNowUtcMs,
  utcMs,
} from '@core/testing';
import { auditProfileChange } from './audit-profile-change.pipeline';

/*
 * The profile trigger (`audit-profile-changes.ts`): one `users/{uid}` write
 * is at most ONE audit row — the changed field NAMES, the writer the auth
 * context names, the event's own instant — under the deterministic id
 * `hash(rowBasis(…, changeKey = event.id))`, written through
 * `createAuditRows` (ALREADY_EXISTS a success). Who wrote it and which
 * fields count are `AuditSystem`'s spec; this one asserts the rows that
 * reached the writer and what the edge is answered.
 */

const OWNER = UserId.of('u-maria');
const EVENT_AT = utcMs('2026-09-28T08:30:00.000+03:00');

function changeOf(overrides: Partial<ProfileChange> = {}): ProfileChange {
  return {
    eventId: TriggerEventId.of('evt-1'),
    eventAtUtcMs: EVENT_AT,
    ownerUserId: OWNER,
    writer: Actor.user(OWNER),
    beforeExists: true,
    afterExists: true,
    fields: ['phone'],
    beforeProfileEditedAtUtcMs: null,
    afterProfileEditedAtUtcMs: null,
    ...overrides,
  };
}

function rig(
  write: (
    rows: readonly AuditEntry[],
  ) => Promise<Result<void, RepositoryError>> = async () =>
    Result.ok(undefined),
) {
  const written: AuditEntry[][] = [];
  const run = auditProfileChange({
    nowUtcMs: pinnedNowUtcMs(),
    hash: fixtureHash,
    createAuditRows: async (rows) => {
      written.push([...rows]);
      return write(rows);
    },
  });
  return { written, run };
}

/** The row a profile update by its owner writes, built by hand. */
function rowOf(
  eventId: string,
  fields: readonly RegistrationField[],
): AuditEntry {
  const resourceId = AuditResourceId.forUser(OWNER);
  return {
    id: AuditEntryId.of(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.ProfileUpdated,
          resourceId,
          OWNER,
          eventId,
        ),
      ),
    ),
    recordedAtUtcMs: EVENT_AT,
    resourceId,
    ...Actor.user(OWNER),
    ...AuditContext.profile(AuditAction.ProfileUpdated, fields),
    ...AuditTargetRef.user(OWNER),
  };
}

describe('auditProfileChange', () => {
  it('writes ONE row keyed by the event — the writer, the field names and the event’s own instant', async () => {
    const { written, run } = rig();
    expect(await run(changeOf())).toEqual({ ok: true, value: { rows: 1 } });
    expect(written).toEqual([[rowOf('evt-1', ['phone'])]]);
  });

  it('derives the same row for a redelivered event — the writer’s create() lands on it once', async () => {
    const { written, run } = rig();
    await run(changeOf());
    await run(changeOf());
    expect(written[0]?.[0]?.id).toBe(written[1]?.[0]?.id);
  });

  it('writes two rows for two edits', async () => {
    const { written, run } = rig();
    await run(changeOf());
    await run(changeOf({ eventId: TriggerEventId.of('evt-2') }));
    expect(written.map((rows) => rows[0]?.id)).toEqual([
      rowOf('evt-1', ['phone']).id,
      rowOf('evt-2', ['phone']).id,
    ]);
  });

  it('credits the writer the auth context names, not the profile’s owner', async () => {
    const { written, run } = rig();
    await run(changeOf({ writer: Actor.system(SystemSource.AdminSdk) }));
    expect(written[0]?.[0]).toMatchObject({
      actorRole: 'SYSTEM',
      actorSystemSource: SystemSource.AdminSdk,
      targetUserId: OWNER,
    });
  });

  it('stamps the clock only when the event’s own time did not parse', async () => {
    const { written, run } = rig();
    await run(changeOf({ eventAtUtcMs: null }));
    expect(written[0]?.[0]?.recordedAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
  });

  it('writes nothing when no audited field changed', async () => {
    const { written, run } = rig();
    expect(await run(changeOf({ fields: [] }))).toEqual({
      ok: true,
      value: { rows: 0 },
    });
    expect(written).toEqual([]);
  });

  it('writes nothing for an edit `updateProfile` already audited — its marker moved (4A-16)', async () => {
    const { written, run } = rig();
    const answer = await run(
      changeOf({
        fields: ['firstName'],
        beforeProfileEditedAtUtcMs: null,
        afterProfileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    );
    expect(answer).toEqual(Result.ok({ rows: 0 }));
    expect(written).toEqual([]);
  });

  it('still audits a creation whatever its marker — the stub, registration, the seed', async () => {
    const { written, run } = rig();
    await run(
      changeOf({
        beforeExists: false,
        fields: ['firstName'],
        afterProfileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    );
    expect(written).toHaveLength(1);
  });

  it('refuses an event with no id rather than minting one — permanent, nothing written', async () => {
    const { written, run } = rig();
    expect(await run(changeOf({ eventId: TriggerEventId.of(' ') }))).toEqual({
      ok: false,
      error: GovernanceError.auditEntryEmptyAction(),
    });
    expect(written).toEqual([]);
  });

  it('answers a failed write for the edge to judge (a transient one is redelivered)', async () => {
    const failure = RepositoryError.writeFailed('auditLog/x', 'unavailable');
    const { run } = rig(async () => Result.err(failure));
    expect(await run(changeOf())).toEqual({ ok: false, error: failure });
  });
});
