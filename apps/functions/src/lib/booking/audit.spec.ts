import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { UserId } from '@creativo/domain/accounts';
import { Actor } from '@creativo/domain/governance';
import {
  type AuditSubject,
  appendAudit,
  audienceOf,
  auditEntryIdFor,
  auditTargets,
  loadAudience,
  planAuditEntries,
  requestedSeatSubjects,
  seatSubjectsOf,
} from './audit';
import { auditContext } from './transition-appointment';
import { staffEditSubjects } from './staff-edit-appointment';
import { createFakeFirestore } from '../../test-support/fake-firestore';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const ivan = Actor.admin(userId('dev-staff-ivan'));
const account = (uid: string): AuditSubject => ({
  kind: 'account',
  userId: uid,
});
const guest: AuditSubject = { kind: 'anonymous' };

/** A stored seat, as `appointmentToDocument` writes its subject. */
function storedSeat(id: string, subject: Record<string, unknown>) {
  return { id, subject };
}

/** What the Admin SDK throws for a `create()` onto an existing document. */
function alreadyExists(path: string): Error {
  return Object.assign(new Error(`6 ALREADY_EXISTS: ${path}`), { code: 6 });
}

/**
 * Just enough of the Admin SDK for a batched write; `commits` counts batches.
 *
 * `create` behaves like the real one: a batch holding a create onto an
 * existing document fails WHOLE with ALREADY_EXISTS and writes nothing, and a
 * single document's `create` fails the same way on its own.
 */
function fakeDb() {
  const written = new Map<string, Record<string, unknown>>();
  let commits = 0;
  let creates = 0;
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        return {
          path,
          create: async (data: Record<string, unknown>) => {
            creates += 1;
            if (written.has(path)) throw alreadyExists(path);
            written.set(path, data);
          },
        };
      },
    }),
    batch: () => {
      const pending: ['set' | 'create', string, Record<string, unknown>][] = [];
      return {
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          pending.push(['set', ref.path, data]);
        },
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          pending.push(['create', ref.path, data]);
        },
        commit: async () => {
          commits += 1;
          for (const [op, path] of pending) {
            if (op === 'create' && written.has(path)) throw alreadyExists(path);
          }
          for (const [, path, data] of pending) written.set(path, data);
        },
      };
    },
  };
  return {
    db: db as unknown as Firestore,
    written,
    commits: () => commits,
    creates: () => creates,
  };
}

describe('auditTargets', () => {
  it('names each account once, in seat order, and skips guests', () => {
    expect(
      auditTargets([
        account('maria'),
        guest,
        account('stefan'),
        account('maria'),
      ]),
    ).toEqual(['maria', 'stefan']);
  });

  it('keeps one untargeted row when nobody on the visit has an account', () => {
    expect(auditTargets([guest, guest])).toEqual([null]);
    expect(auditTargets([])).toEqual([null]);
  });

  it('never names more people than there are account subjects, nor fewer than one row', () => {
    const subject = fc.oneof(
      fc.constant(guest),
      fc.constantFrom('a', 'b', 'c').map(account),
    );
    fc.assert(
      fc.property(fc.array(subject, { maxLength: 8 }), (subjects) => {
        const targets = auditTargets(subjects);
        const people = new Set(
          subjects.flatMap((s) => (s.kind === 'account' ? [s.userId] : [])),
        );
        expect(targets.length).toBe(Math.max(1, people.size));
        expect(new Set(targets).size).toBe(targets.length);
      }),
    );
  });
});

describe('planAuditEntries — one row per person', () => {
  const base = {
    actor: ivan,
    action: 'booking.staff_move',
    resourceId: 'appt-1',
    atIso: '2026-09-25T08:00:00.000Z',
    context: { revision: '3' },
  };

  it('writes one row per account on a party of two, each naming that person', () => {
    let n = 0;
    const planned = planAuditEntries(
      { ...base, subjects: [account('maria'), account('stefan')] },
      () => `row-${n++}`,
    );
    if (planned.isFailure()) throw new Error('expected success');

    expect(planned.value.map((e) => e.targetUserId?.value)).toEqual([
      'maria',
      'stefan',
    ]);
    expect(planned.value.map((e) => e.id.value)).toEqual(['row-0', 'row-1']);
    for (const entry of planned.value) {
      expect(entry.actor).toEqual(ivan);
      expect(entry.action).toBe('booking.staff_move');
      expect(entry.resourceId).toBe('appt-1');
      expect(entry.context).toEqual({ revision: '3' });
    }
  });

  it("gives a guest seat no row of its own — the booker's row covers the visit", () => {
    const planned = planAuditEntries({
      ...base,
      subjects: [account('maria'), guest],
    });
    if (planned.isFailure()) throw new Error('expected success');
    expect(planned.value).toHaveLength(1);
    expect(planned.value[0]?.targetUserId?.value).toBe('maria');
  });

  it('writes one untargeted row for a walk-in of guests', () => {
    const planned = planAuditEntries({ ...base, subjects: [guest] });
    if (planned.isFailure()) throw new Error('expected success');
    expect(planned.value).toHaveLength(1);
    expect(planned.value[0]?.targetUserId).toBeNull();
  });

  it('refuses through the domain rather than writing a half-formed row', () => {
    const planned = planAuditEntries({
      ...base,
      action: '  ',
      subjects: [account('maria')],
    });
    expect(planned.isFailure()).toBe(true);
  });
});

describe('seatSubjectsOf — the people on a stored visit', () => {
  const data = {
    ownerUserId: 'maria',
    seats: [
      storedSeat('s1', {
        kind: 'account',
        userId: 'maria',
        relationship: 'self',
      }),
      storedSeat('s2', { kind: 'anonymous', label: 'Синът' }),
      storedSeat('s3', {
        kind: 'account',
        userId: 'stefan',
        relationship: 'companion',
      }),
    ],
  };

  it('reads every seat: accounts by uid, guests as anonymous', () => {
    expect(seatSubjectsOf(data)).toEqual([
      account('maria'),
      guest,
      account('stefan'),
    ]);
  });

  it("narrows to the one seat a per-seat verb touched — a companion's no-show is theirs", () => {
    expect(seatSubjectsOf(data, 's3')).toEqual([account('stefan')]);
    expect(seatSubjectsOf(data, 's2')).toEqual([guest]);
    expect(seatSubjectsOf(data, 'missing')).toEqual([]);
  });

  it('tolerates a malformed document instead of throwing', () => {
    expect(seatSubjectsOf(undefined)).toEqual([]);
    expect(seatSubjectsOf({ seats: 'nope' })).toEqual([]);
    expect(
      seatSubjectsOf({
        seats: [null, 3, { id: 's1' }, { subject: { kind: 'account' } }],
      }),
    ).toEqual([guest, guest]);
  });

  it('reads the owner beside the seats', () => {
    expect(audienceOf(data).ownerUserId).toBe('maria');
    expect(audienceOf({ ownerUserId: '' }).ownerUserId).toBeNull();
    expect(audienceOf(undefined)).toEqual({ subjects: [], ownerUserId: null });
  });
});

describe('loadAudience — the people before an edit', () => {
  it('reads the stored seats and owner', async () => {
    const db = createFakeFirestore();
    await db
      .collection('appointments')
      .doc('appt-1')
      .set({
        ownerUserId: 'maria',
        seats: [
          storedSeat('s1', { kind: 'account', userId: 'maria' }),
          storedSeat('s2', { kind: 'account', userId: 'stefan' }),
        ],
      });
    expect(await loadAudience('appt-1', db as unknown as Firestore)).toEqual({
      subjects: [account('maria'), account('stefan')],
      ownerUserId: 'maria',
    });
  });

  it('reads nobody for a visit that is not there, or not named', async () => {
    const db = createFakeFirestore() as unknown as Firestore;
    const nobody = { subjects: [], ownerUserId: null };
    expect(await loadAudience('missing', db)).toEqual(nobody);
    expect(await loadAudience('', db)).toEqual(nobody);
  });
});

describe('requestedSeatSubjects — the people on a requested cart', () => {
  const seat = (
    subject:
      | { kind: 'self' }
      | { kind: 'companion'; userId: string }
      | { kind: 'guest'; label: string },
  ) => ({
    lineId: 'l',
    serviceId: 'svc',
    variantId: null,
    barberId: 'b',
    startIso: '2026-09-25T10:00:00+03:00',
    subject,
  });

  it('binds every self seat to the owner and every guest to nobody', () => {
    expect(
      requestedSeatSubjects(
        [seat({ kind: 'self' }), seat({ kind: 'guest', label: 'Син' })],
        'maria',
      ),
    ).toEqual([account('maria'), guest]);
  });

  it('names a carried companion by their own account', () => {
    expect(
      requestedSeatSubjects(
        [seat({ kind: 'self' }), seat({ kind: 'companion', userId: 'son' })],
        'maria',
      ),
    ).toEqual([account('maria'), account('son')]);
  });

  it('names nobody on an owner-less walk-in', () => {
    expect(requestedSeatSubjects([seat({ kind: 'self' })], null)).toEqual([
      guest,
    ]);
  });
});

describe('staffEditSubjects', () => {
  it('keeps everyone the visit had before the edit — a removed seat included', () => {
    expect(
      staffEditSubjects([account('maria'), account('stefan')], 'maria', {
        kind: 'removeSeat',
        seatId: 's3',
      }),
    ).toEqual([account('maria'), account('stefan')]);
  });

  it('adds the owner when an addSeat gives them a seat', () => {
    expect(
      staffEditSubjects([guest], 'maria', [
        {
          kind: 'addSeat',
          seatId: 'new',
          serviceId: 'svc',
          barberId: 'b',
          startIso: '2026-09-25T10:00:00+03:00',
          minutes: 30,
          subject: { kind: 'self' },
        },
      ]),
    ).toEqual([guest, account('maria')]);
  });
});

describe('audit context carries codes, never free text (T5)', () => {
  it("records a staff cancellation's reason code and drops its note", () => {
    const { context } = auditContext(
      { kind: 'other', note: 'Обади се, че е болен' },
      's1',
    );
    expect(context).toEqual({ reason: 'other', seatId: 's1' });
    expect(JSON.stringify(context)).not.toContain('болен');
  });

  it('records nothing when there is nothing to record', () => {
    expect(auditContext(null, '')).toEqual({});
  });
});

describe('appendAudit — the batched write', () => {
  const input = {
    actor: Actor.staff(userId('dev-staff-georgi'), ['barber']),
    action: 'booking.staff_arrived',
    resourceId: 'appt-1',
    atIso: '2026-09-25T08:00:00.000Z',
  };

  it('writes every row of one act in ONE batch, each naming its person', async () => {
    const { db, written, commits } = fakeDb();
    await appendAudit(
      { ...input, subjects: [account('maria'), guest, account('stefan')] },
      db,
    );

    expect(commits()).toBe(1);
    const rows = [...written.entries()];
    expect(rows).toHaveLength(2);
    for (const [path, row] of rows) {
      expect(path.startsWith('auditLog/')).toBe(true);
      expect(row['actor']).toEqual({
        kind: 'staff',
        userId: 'dev-staff-georgi',
        roles: ['barber'],
      });
      expect(row['resourceId']).toBe('appt-1');
    }
    expect(rows.map(([, row]) => row['targetUserId']).sort()).toEqual([
      'maria',
      'stefan',
    ]);
  });

  it('writes nothing without a verified actor, and does not throw', async () => {
    const { db, written } = fakeDb();
    await appendAudit(
      { ...input, actor: null, subjects: [account('maria')] },
      db,
    );
    expect(written.size).toBe(0);
  });

  it('swallows a failed write — the act it describes has already happened', async () => {
    const db = {
      collection: () => ({ doc: () => ({}) }),
      batch: () => ({
        set: () => undefined,
        commit: async () => {
          throw new Error('unavailable');
        },
      }),
    } as unknown as Firestore;
    await expect(
      appendAudit({ ...input, subjects: [account('maria')] }, db),
    ).resolves.toBeUndefined();
  });
});

describe('auditEntryIdFor — one id per person per logical change', () => {
  const parts = {
    action: 'booking.committed',
    resourceId: 'appt-1',
    targetUserId: 'maria',
    changeKey: 'attempt:abc',
  };

  it('derives the same id from the same change, every time', () => {
    expect(auditEntryIdFor(parts)).toBe(auditEntryIdFor({ ...parts }));
  });

  it('is always a legal Firestore document id — 64 hex characters, whatever goes in', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.option(fc.string(), { nil: null }),
        fc.string(),
        (action, resourceId, targetUserId, changeKey) => {
          const id = auditEntryIdFor({
            action,
            resourceId,
            targetUserId,
            changeKey,
          });
          // No `/`, never `.`/`..`, never `__…__`, far under 1,500 bytes.
          expect(id).toMatch(/^[0-9a-f]{64}$/);
        },
      ),
    );
    // The parts that would break a path are hashed away, not escaped.
    expect(
      auditEntryIdFor({
        ...parts,
        resourceId: '../auditLog/x',
        changeKey: '/',
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates every part — a change to any one of them is a different row', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('action', 'resourceId', 'targetUserId', 'changeKey'),
        fc.string({ minLength: 1 }),
        (field, suffix) => {
          const changed = {
            ...parts,
            [field]: `${String(parts[field as keyof typeof parts])}${suffix}`,
          };
          expect(auditEntryIdFor(changed)).not.toBe(auditEntryIdFor(parts));
        },
      ),
    );
    // Moving a boundary between two parts does not collide either.
    expect(
      auditEntryIdFor({ ...parts, resourceId: 'appt-1:x', changeKey: 'y' }),
    ).not.toBe(
      auditEntryIdFor({ ...parts, resourceId: 'appt-1', changeKey: 'x:y' }),
    );
    expect(auditEntryIdFor({ ...parts, targetUserId: null })).not.toBe(
      auditEntryIdFor({ ...parts, targetUserId: '' }),
    );
  });

  it('is what `planAuditEntries` mints once a change key is given — and random without one', () => {
    const input = {
      actor: ivan,
      action: 'booking.staff_move',
      resourceId: 'appt-1',
      atIso: '2026-09-25T08:00:00.000Z',
      subjects: [account('maria'), account('stefan')],
    };
    const keyed = planAuditEntries({ ...input, changeKey: 'revision:4' });
    if (keyed.isFailure()) throw new Error('expected success');
    expect(keyed.value.map((entry) => entry.id.value)).toEqual([
      auditEntryIdFor({
        action: input.action,
        resourceId: 'appt-1',
        targetUserId: 'maria',
        changeKey: 'revision:4',
      }),
      auditEntryIdFor({
        action: input.action,
        resourceId: 'appt-1',
        targetUserId: 'stefan',
        changeKey: 'revision:4',
      }),
    ]);

    const first = planAuditEntries(input);
    const second = planAuditEntries(input);
    if (first.isFailure() || second.isFailure()) {
      throw new Error('expected success');
    }
    expect(first.value[0]?.id.value).not.toBe(second.value[0]?.id.value);
  });
});

describe('appendAudit — exactly once per logical change', () => {
  const input = {
    actor: Actor.staff(userId('dev-staff-georgi'), ['barber']),
    action: 'booking.committed',
    resourceId: 'appt-1',
    atIso: '2026-09-25T08:00:00.000Z',
    subjects: [account('maria'), guest, account('stefan')],
    changeKey: 'attempt:abc',
  };

  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
  });

  it('writes the rows once, and a replay of the same change writes no second row', async () => {
    const { db, written } = fakeDb();
    await appendAudit(input, db);
    const firstRows = new Map(written);
    expect(firstRows.size).toBe(2);

    // The replayed callable: the same attempt, logged again a moment later.
    await appendAudit({ ...input, atIso: '2026-09-25T08:00:05.000Z' }, db);

    expect(written.size).toBe(2);
    // The rows the first call wrote are left exactly as they were.
    expect(new Map(written)).toEqual(firstRows);
    // ALREADY_EXISTS is the answer "already logged" — not an error.
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('writes a row per change for two distinct changes to the same visit', async () => {
    const { db, written } = fakeDb();
    await appendAudit({ ...input, changeKey: 'revision:4' }, db);
    await appendAudit({ ...input, changeKey: 'revision:5' }, db);

    expect(written.size).toBe(4);
    const targets = [...written.values()].map((row) => row['targetUserId']);
    expect(targets.sort()).toEqual(['maria', 'maria', 'stefan', 'stefan']);
  });

  it('fills the gap when a replay names somebody the first call did not', async () => {
    const { db, written } = fakeDb();
    await appendAudit({ ...input, subjects: [account('maria')] }, db);
    await appendAudit(input, db);

    expect(written.size).toBe(2);
    expect(
      [...written.values()].map((row) => row['targetUserId']).sort(),
    ).toEqual(['maria', 'stefan']);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('still logs — and never throws — any failure that is not ALREADY_EXISTS', async () => {
    const db = {
      collection: () => ({ doc: () => ({ create: async () => undefined }) }),
      batch: () => ({
        create: () => undefined,
        commit: async () => {
          throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
        },
      }),
    } as unknown as Firestore;

    await expect(appendAudit(input, db)).resolves.toBeUndefined();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'audit write failed',
      expect.objectContaining({
        action: 'booking.committed',
        resourceId: 'appt-1',
      }),
    );
  });

  it('logs a gap-filling row that fails for any other reason, and never throws', async () => {
    const { db } = fakeDb();
    await appendAudit({ ...input, subjects: [account('maria')] }, db);
    const failing = db as unknown as {
      collection: (name: string) => { doc: (id: string) => unknown };
    };
    const real = failing.collection.bind(failing);
    failing.collection = (name: string) => ({
      doc: (id: string) => ({
        ...(real(name).doc(id) as object),
        create: async () => {
          throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
        },
      }),
    });

    await expect(appendAudit(input, db)).resolves.toBeUndefined();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'audit write failed',
      expect.objectContaining({ action: 'booking.committed' }),
    );
  });

  it('keeps appending with random ids for a caller that sends no key', async () => {
    const { db, written } = fakeDb();
    const unkeyed = {
      actor: input.actor,
      action: input.action,
      resourceId: input.resourceId,
      atIso: input.atIso,
      subjects: input.subjects,
    };
    await appendAudit(unkeyed, db);
    await appendAudit(unkeyed, db);
    expect(written.size).toBe(4);
  });
});
