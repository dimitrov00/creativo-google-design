import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  AuditResourceId,
  CustomerId,
  OperationId,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type { AuditReadPorts } from '@core/ports';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { auditReadPorts } from './audit.adapter';

/*
 * The admin's audit trail against the Firestore emulator (audit-hardening
 * WS-7): every query of `auditReadPorts` through the real SDK and the real
 * `firestore.rules` — answered to `admin` and `sysadmin`, refused to every
 * other role and to an anonymous visitor.
 *
 * THE EMULATOR DOES NOT ENFORCE COMPOSITE INDEXES: a query whose composite
 * is missing passes here and fails in production with FAILED_PRECONDITION.
 * The five `auditLog` composites these timelines need are proven by
 * `tools/verify/indexes/audit-indexes.spec.mjs` (declared in
 * `firestore.indexes.json`) and, on a deployed project, by the preflight's
 * P3 (every declared composite READY).
 *
 * The rows are seeded RAW (untyped bodies, rules disabled), as the server's
 * commit plans write them: this spec reads what is stored, whatever the
 * entity type says today.
 */

const ANA = 'u-ana';
const ADMIN = 'u-admin';
const ANA_RECORD = 'cus-ana';
const BOB_RECORD = 'cus-bob';
const APPT = 'appt-1';
const OP_1 = 'op-0000000000000001';
const OP_2 = 'op-0000000000000002';

/** A booking act's row for one client record, as stored. */
const bookingRow = (
  recordedAtUtcMs: number,
  targetCustomerId: string,
  auditOperationId: string | null,
  byAdmin: boolean,
) => ({
  recordedAtUtcMs,
  resourceId: APPT,
  auditOperationId,
  ...(byAdmin
    ? { actorRole: 'ADMIN', actorAdminUserId: ADMIN }
    : { actorRole: 'USER', actorUserId: ANA }),
  auditAction: 'BOOKING_COMMITTED',
  auditTarget: 'CUSTOMER',
  targetCustomerId,
});

/** An own profile edit's row, as stored. */
const profileRow = (recordedAtUtcMs: number) => ({
  recordedAtUtcMs,
  resourceId: `users/${ANA}`,
  auditOperationId: null,
  actorRole: 'USER',
  actorUserId: ANA,
  auditAction: 'PROFILE_UPDATED',
  profileFields: ['lastName'],
  auditTarget: 'USER',
  targetUserId: ANA,
});

// r3 and r4 are one act's fan-out: one instant, two rows.
const ROWS: Readonly<Record<string, Record<string, unknown>>> = {
  r1: bookingRow(1_000, ANA_RECORD, OP_1, false),
  r2: bookingRow(2_000, ANA_RECORD, null, false),
  r3: bookingRow(3_000, ANA_RECORD, OP_2, true),
  r4: bookingRow(3_000, ANA_RECORD, OP_2, true),
  r5: bookingRow(4_000, BOB_RECORD, OP_2, true),
  p1: profileRow(5_000),
};

const idsOf = (rows: readonly { readonly id: string }[]) =>
  rows.map((entry) => entry.id);

describe('auditReadPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const portsFor = (context: RulesTestContext): AuditReadPorts =>
    auditReadPorts(modularFirestore(context));
  const as = (roles: readonly string[]) =>
    portsFor(testEnv.authenticatedContext('someone', { roles: [...roles] }));

  /** Every page of Ana's record, and the cursors that led there. */
  async function walk(ports: AuditReadPorts, max: number) {
    const pages: string[][] = [];
    const cursors: (number | null)[] = [];
    let before: UtcEpochMs | null = null;
    do {
      const page = await ports.pageAuditByTargetCustomer(
        CustomerId.of(ANA_RECORD),
        before,
        max,
      );
      if (!page.ok) throw new Error(page.error.errorCode);
      pages.push(idsOf(page.value.rows));
      cursors.push(page.value.cursor);
      before = page.value.cursor;
    } while (before !== null && pages.length < 20);
    return { pages, cursors };
  }

  /** Every port, once, as `ports` — the answers' `ok` flags. */
  async function everyQuery(ports: AuditReadPorts) {
    return [
      await ports.pageAuditByTargetCustomer(
        CustomerId.of(ANA_RECORD),
        null,
        10,
      ),
      await ports.pageAuditByTargetUser(UserId.of(ANA), null, 10),
      await ports.pageAuditByResource(
        AuditResourceId.forUser(UserId.of(ANA)),
        null,
        10,
      ),
      await ports.pageAuditByActorUser(UserId.of(ANA), null, 10),
      await ports.pageAuditByActorAdmin(UserId.of(ADMIN), null, 10),
      await ports.auditRowsForOperation(OperationId.of(OP_2)),
    ].map((answer) => answer.ok);
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-audit');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      for (const [id, body] of Object.entries(ROWS)) {
        await setDoc(doc(db, 'auditLog', id), body);
      }
    });
  });

  describe.each(['admin', 'sysadmin'])('as %s', (role) => {
    it('pages a client record newest first, an act’s fan-out never split across pages', async () => {
      const { pages, cursors } = await walk(as([role]), 1);

      expect(pages).toEqual([['r4', 'r3'], ['r2'], ['r1']]);
      expect(cursors).toEqual([3_000, 2_000, null]);
    });

    it('walks the record whole in larger pages, no cursor past the oldest', async () => {
      const { pages, cursors } = await walk(as([role]), 3);

      expect(pages).toEqual([['r4', 'r3', 'r2'], ['r1']]);
      expect(cursors).toEqual([2_000, null]);
    });

    it('reads each timeline by its own field', async () => {
      const ports = as([role]);

      const byUser = await ports.pageAuditByTargetUser(
        UserId.of(ANA),
        null,
        10,
      );
      const byResource = await ports.pageAuditByResource(
        AuditResourceId.forUser(UserId.of(ANA)),
        null,
        10,
      );
      const byActor = await ports.pageAuditByActorUser(
        UserId.of(ANA),
        null,
        10,
      );
      const byAdmin = await ports.pageAuditByActorAdmin(
        UserId.of(ADMIN),
        null,
        10,
      );

      expect(byUser.ok && idsOf(byUser.value.rows)).toEqual(['p1']);
      expect(byResource.ok && idsOf(byResource.value.rows)).toEqual(['p1']);
      expect(byActor.ok && idsOf(byActor.value.rows)).toEqual([
        'p1',
        'r2',
        'r1',
      ]);
      expect(byAdmin.ok && idsOf(byAdmin.value.rows)).toEqual([
        'r5',
        'r4',
        'r3',
      ]);
    });

    it('hands a row over as stored, the body beside its id', async () => {
      const page = await as([role]).pageAuditByTargetUser(
        UserId.of(ANA),
        null,
        10,
      );

      expect(page.ok && page.value).toEqual({
        rows: [{ id: 'p1', ...ROWS['p1'] }],
        cursor: null,
      });
    });

    it('answers an empty page for a key nothing was filed against', async () => {
      const page = await as([role]).pageAuditByTargetCustomer(
        CustomerId.of('cus-nobody'),
        null,
        10,
      );

      expect(page.ok && page.value).toEqual({ rows: [], cursor: null });
    });

    it('answers one operation’s rows oldest first, a tie by id', async () => {
      const rows = await as([role]).auditRowsForOperation(OperationId.of(OP_2));
      const none = await as([role]).auditRowsForOperation(
        OperationId.of('op-never-written'),
      );

      expect(rows.ok && idsOf(rows.value)).toEqual(['r3', 'r4', 'r5']);
      expect(none.ok && none.value).toEqual([]);
    });
  });

  it.each(['barber', 'receptionist', 'client', 'content_manager'])(
    'refuses every query to a %s',
    async (role) => {
      expect(await everyQuery(as([role]))).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    },
  );

  it('refuses every query to an anonymous visitor', async () => {
    expect(
      await everyQuery(portsFor(testEnv.unauthenticatedContext())),
    ).toEqual([false, false, false, false, false, false]);
  });

  it('names the rules’ refusal as the read’s failure', async () => {
    const page = await as(['barber']).pageAuditByTargetCustomer(
      CustomerId.of(ANA_RECORD),
      null,
      10,
    );

    expect(page.ok ? null : page.error).toEqual({
      errorCode: 'REPOSITORY_READ_FAILED',
      path: 'auditLog',
      reason: 'permission-denied',
    });
  });
});
