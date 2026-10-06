import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { UserId } from '@creativo/domain/accounts';
import { Actor } from '@creativo/domain/governance';
import { AUDIT_LOG_COLLECTION } from '@creativo/application/shared';
import { appendAudit } from './audit';

/**
 * `appendAudit`'s exactly-once write against the REAL Firestore emulator.
 *
 * The unit spec proves the logic over a fake that throws what the author
 * believes the SDK throws; this proves the belief — that a batch `create()`
 * onto an existing row fails whole with the error `appendAudit` recognises as
 * ALREADY_EXISTS, and nothing is logged for it.
 *
 * Emulator-only by construction, same guard as the seed.
 */
const PROJECT_ID = 'demo-functions-audit';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('fixture');
  return result.value;
}

describe('appendAudit (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    vi.mocked(logger.error).mockClear();
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
  });

  const maria = { kind: 'account' as const, userId: 'maria' };
  const stefan = { kind: 'account' as const, userId: 'stefan' };
  const input = {
    actor: Actor.staff(userId('dev-staff-georgi'), ['barber']),
    action: 'booking.committed',
    resourceId: 'appt-1',
    atIso: '2030-01-15T08:00:00.000Z',
    subjects: [maria, stefan],
    changeKey: 'attempt:abc',
  };

  async function rows() {
    return (await db.collection(AUDIT_LOG_COLLECTION).get()).docs;
  }

  it('writes one row per person, and a replay of the same change adds none — silently', async () => {
    await appendAudit(input, db);
    await appendAudit({ ...input, atIso: '2030-01-15T08:00:07.000Z' }, db);

    const written = await rows();
    expect(written).toHaveLength(2);
    // The first call's rows, untouched by the replay.
    expect(
      written.every((row) =>
        String(row.data()['at']).startsWith('2030-01-15T08:00:00'),
      ),
    ).toBe(true);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('writes distinct rows for distinct changes', async () => {
    await appendAudit({ ...input, changeKey: 'revision:4' }, db);
    await appendAudit({ ...input, changeKey: 'revision:5' }, db);
    expect(await rows()).toHaveLength(4);
  });

  it('fills in a person a partial earlier write missed', async () => {
    await appendAudit({ ...input, subjects: [maria] }, db);
    await appendAudit(input, db);
    expect(
      (await rows()).map((row) => row.data()['targetUserId']).sort(),
    ).toEqual(['maria', 'stefan']);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });
});
