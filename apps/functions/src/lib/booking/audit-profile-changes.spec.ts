import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { UserId } from '@creativo/domain/accounts';
import { Actor } from '@creativo/domain/governance';
import { auditEntryToDocument } from '@creativo/application/shared';
import {
  AUDITED_PROFILE_FIELDS,
  type ProfileWriteEvent,
  auditProfileWrite,
  changedProfileFields,
  profileAuditAction,
  profileAuditEntry,
  profileWriter,
} from './audit-profile-changes';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('changedProfileFields — names, never values', () => {
  it('lists the audited fields whose value changed, in a fixed order', () => {
    expect(
      changedProfileFields(
        { lastName: 'Петров', firstName: 'Мария', phone: '+359888000001' },
        { lastName: 'Иванова', firstName: 'Мариа', phone: '+359888000001' },
      ),
    ).toEqual(['firstName', 'lastName']);
  });

  it('treats absent, null and empty as the same "no value"', () => {
    expect(changedProfileFields({ email: null, birthDate: '' }, {})).toEqual(
      [],
    );
    expect(changedProfileFields({}, { birthDate: '1990-04-12' })).toEqual([
      'birthDate',
    ]);
  });

  it('ignores fields other writers own — roles and status are audited by their callables', () => {
    expect(
      changedProfileFields(
        { roles: ['client'], status: { kind: 'active' }, searchName: 'a' },
        { roles: ['barber'], status: { kind: 'blocked' }, searchName: 'b' },
      ),
    ).toEqual([]);
  });

  it('never lets a value into the row context, whatever the profile held', () => {
    const value = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 12 }),
    );
    const profile = fc.record(
      Object.fromEntries(AUDITED_PROFILE_FIELDS.map((f) => [f, value])),
    );
    fc.assert(
      fc.property(profile, profile, (before, after) => {
        const fields = changedProfileFields(before, after);
        const entry = profileAuditEntry({
          eventId: 'evt-1',
          eventTime: '2026-09-25T08:00:00.000Z',
          ownerUserId: 'maria',
          writer: Actor.user(userId('maria')),
          action: 'profile.updated',
          fields,
        });
        if (entry.isFailure()) throw new Error('expected success');
        const context = auditEntryToDocument(entry.value)['context'];
        expect(context).toEqual({ fields: fields.join(',') });
        for (const name of fields) {
          expect(AUDITED_PROFILE_FIELDS).toContain(name);
        }
      }),
    );
  });
});

describe('profileAuditAction', () => {
  it('names creation, update and deletion apart', () => {
    expect(profileAuditAction(false, true)).toBe('profile.created');
    expect(profileAuditAction(true, true)).toBe('profile.updated');
    expect(profileAuditAction(true, false)).toBe('profile.deleted');
  });
});

describe('profileWriter — who wrote it, from the auth context', () => {
  it('credits the end user a client-SDK write came from', () => {
    expect(profileWriter('api_key', 'maria-uid')).toEqual(
      Actor.user(userId('maria-uid')),
    );
  });

  it('credits the uid, not the profile owner, when somebody else wrote it', () => {
    expect(profileWriter('api_key', 'someone-else')).toEqual(
      Actor.user(userId('someone-else')),
    );
  });

  it('attributes an Admin SDK write to the process, whatever the id says', () => {
    expect(
      profileWriter('service_account', 'fn@project.iam.gserviceaccount.com'),
    ).toEqual(Actor.system('admin_sdk'));
  });

  it('attributes a platform write to the platform', () => {
    expect(profileWriter('system', undefined)).toEqual(
      Actor.system('firestore_system'),
    );
  });

  it('does not guess when the id is missing or not a uid (the emulator reports a fake e-mail)', () => {
    expect(profileWriter('unknown', 'fake-auth-id@gmail.com')).toEqual(
      Actor.system('unattributed_unknown'),
    );
    expect(profileWriter('api_key', undefined)).toEqual(
      Actor.system('unattributed_api_key'),
    );
    expect(profileWriter('something_new', '')).toEqual(
      Actor.system('unattributed_unknown'),
    );
  });
});

describe('profileAuditEntry — one row per event', () => {
  const input = {
    eventId: 'evt-1f2e',
    eventTime: '2026-09-25T08:00:00.123456Z',
    ownerUserId: 'maria',
    writer: Actor.system('admin_sdk'),
    action: 'profile.updated',
    fields: ['firstName', 'lastName'],
  };

  it('keys the row by the event id, so a redelivery lands on the same document', () => {
    const entry = profileAuditEntry(input);
    if (entry.isFailure()) throw new Error('expected success');
    expect(entry.value.id.value).toBe('evt-1f2e');
  });

  it('names the profile owner as the target and the fields as the only context', () => {
    const entry = profileAuditEntry(input);
    if (entry.isFailure()) throw new Error('expected success');
    const doc = auditEntryToDocument(entry.value);
    expect(doc['targetUserId']).toBe('maria');
    expect(doc['resourceId']).toBe('users/maria');
    expect(doc['context']).toEqual({ fields: 'firstName,lastName' });
    expect(doc['actor']).toEqual({ kind: 'system', source: 'admin_sdk' });
  });

  it("stamps the event's own instant, not the delivery's", () => {
    const entry = profileAuditEntry(input);
    if (entry.isFailure()) throw new Error('expected success');
    expect(entry.value.at.toMillis()).toBe(
      Date.parse('2026-09-25T08:00:00.123Z'),
    );
  });

  it('refuses an event with no id rather than minting one', () => {
    expect(profileAuditEntry({ ...input, eventId: '' }).isFailure()).toBe(true);
  });
});

/**
 * Just enough of the Admin SDK for `create()`: it refuses a second write to
 * the same id the way the real one does (gRPC 6), or fails with `failWith`.
 */
function fakeDb(failWith?: unknown) {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        create: async (data: Record<string, unknown>) => {
          if (failWith !== undefined) throw failWith;
          const path = `${name}/${id}`;
          if (rows.has(path))
            throw Object.assign(new Error('exists'), { code: 6 });
          rows.set(path, data);
        },
      }),
    }),
  };
  return { db: db as unknown as Firestore, rows };
}

const snapshot = (data: Record<string, unknown> | undefined) => ({
  exists: data !== undefined,
  data: () => data,
});

function nameChange(
  overrides: Partial<ProfileWriteEvent> = {},
): ProfileWriteEvent {
  return {
    id: 'evt-42',
    time: '2026-09-25T08:00:00.000Z',
    params: { uid: 'maria' },
    authType: 'api_key',
    authId: 'maria',
    data: {
      before: snapshot({ firstName: 'Мария', phone: '+359888000001' }),
      after: snapshot({ firstName: 'Мариа', phone: '+359888000001' }),
    },
    ...overrides,
  };
}

describe('auditProfileWrite — one delivery of one write', () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('writes one row keyed by the event, naming the writer and the fields only', async () => {
    const { db, rows } = fakeDb();
    await auditProfileWrite(nameChange(), db);

    expect([...rows.keys()]).toEqual(['auditLog/evt-42']);
    const row = rows.get('auditLog/evt-42');
    expect(row?.['actor']).toEqual({ kind: 'user', userId: 'maria' });
    expect(row?.['action']).toBe('profile.updated');
    expect(row?.['context']).toEqual({ fields: 'firstName' });
    expect(JSON.stringify(row)).not.toContain('Мариа');
  });

  it('treats a redelivery as done — no second row, no error, no failure line', async () => {
    const { db, rows } = fakeDb();
    await auditProfileWrite(nameChange(), db);
    await expect(auditProfileWrite(nameChange(), db)).resolves.toBeUndefined();

    expect(rows.size).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('writes nothing when no audited field changed', async () => {
    const { db, rows } = fakeDb();
    await auditProfileWrite(
      nameChange({
        data: {
          before: snapshot({ firstName: 'Мария', searchName: 'a' }),
          after: snapshot({ firstName: 'Мария', searchName: 'b' }),
        },
      }),
      db,
    );
    expect(rows.size).toBe(0);
  });

  it('rethrows a transient failure for the platform to redeliver, after one structured line', async () => {
    const { db } = fakeDb({ code: 10 });
    await expect(
      auditProfileWrite(nameChange(), db, () =>
        Date.parse('2026-09-25T08:00:02.500Z'),
      ),
    ).rejects.toEqual({ code: 10 });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'auditProfileChanges',
      eventId: 'evt-42',
      outcome: 'transient',
      code: 'aborted',
      ageMs: 2500,
    });
  });

  it('swallows a permanent failure — a retry would fail the same way all day', async () => {
    const { db } = fakeDb({ code: 7 });
    await expect(auditProfileWrite(nameChange(), db)).resolves.toBeUndefined();
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      outcome: 'permanent',
      code: 'permission-denied',
    });
  });

  it('logs and drops an event the domain refuses, without writing', async () => {
    const { db, rows } = fakeDb();
    await auditProfileWrite(nameChange({ id: '' }), db);
    expect(rows.size).toBe(0);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      outcome: 'permanent',
      code: 'governance.id.empty',
    });
  });
});
