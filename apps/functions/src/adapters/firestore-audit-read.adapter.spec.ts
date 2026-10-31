import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  RegistrationField,
} from '@core/components';
import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  CustomerId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type AuditEntry, Collections } from '@core/entities';
import type { AuditTimelinePage, AuditTimelinePorts } from '@core/ports';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreAuditReadPorts } from './firestore-audit-read.adapter';
import { bodyOf } from './store-answer';

/*
 * The five audit timelines over the in-memory Admin SDK (audit-hardening
 * Phase 3, WS-C) — the web adapter's query shapes on the server: one
 * equality field each, newest first, a page at a time, a page never ending
 * inside an instant, the cursor read strictly below; rows as stored; a
 * throwing read a code-only value.
 */

const at = (ms: number): UtcEpochMs => {
  const parsed = UtcEpochMs.of(ms);
  if (!parsed.ok) throw new Error(`fixture instant ${ms}`);
  return parsed.value;
};

const ANA = UserId.of('u-ana');
const ADMIN = UserId.of('u-admin');
const ANA_RECORD = CustomerId.of('cus-ana');
const BOB_RECORD = CustomerId.of('cus-bob');
const APPT = AuditResourceId.forAppointment(AppointmentId.of('appt-1'));

/** A booking act's row for one client record, by Ana or (`byAdmin`) the admin. */
const row = (
  id: string,
  recordedAtMs: number,
  target: CustomerId,
  byAdmin = false,
): AuditEntry => ({
  id: AuditEntryId.of(id),
  recordedAtUtcMs: at(recordedAtMs),
  resourceId: APPT,
  auditOperationId: null,
  ...(byAdmin ? Actor.admin(ADMIN) : Actor.user(ANA)),
  ...AuditContext.profile(AuditAction.ProfileUpdated, [
    RegistrationField.FirstName,
  ]),
  ...AuditTargetRef.customer(target),
});

/** An own profile edit's row — targeted at the account. */
const profileRow = (id: string, recordedAtMs: number): AuditEntry => ({
  id: AuditEntryId.of(id),
  recordedAtUtcMs: at(recordedAtMs),
  resourceId: AuditResourceId.forUser(ANA),
  auditOperationId: null,
  ...Actor.user(ANA),
  ...AuditContext.profile(AuditAction.ProfileUpdated, [
    RegistrationField.LastName,
  ]),
  ...AuditTargetRef.user(ANA),
});

const ROWS: readonly AuditEntry[] = [
  row('r1', 1_000, ANA_RECORD),
  row('r2', 2_000, ANA_RECORD),
  // Two rows of ONE act at one instant — never split across pages.
  row('r3a', 3_000, ANA_RECORD),
  row('r3b', 3_000, ANA_RECORD),
  row('r4', 4_000, ANA_RECORD, true),
  row('r-bob', 5_000, BOB_RECORD),
  profileRow('p1', 6_000),
];

function seeded(rows: readonly AuditEntry[] = ROWS) {
  return createProjectionFirestore(
    Object.fromEntries(
      rows.map((entry) => [
        `${Collections.AuditLog}/${entry.id}`,
        bodyOf(entry),
      ]),
    ),
  );
}

const ports = (fake = seeded()): AuditTimelinePorts =>
  firestoreAuditReadPorts(fake.db as unknown as Firestore);

const ids = (page: { ok: true; value: AuditTimelinePage } | { ok: false }) =>
  page.ok ? page.value.rows.map((entry) => entry.id) : null;

describe('firestoreAuditReadPorts', () => {
  it('reads one record’s rows newest first, as stored — nobody else’s', async () => {
    const page = await ports().pageAuditByTargetCustomer(ANA_RECORD, null, 10);
    expect(page).toEqual({
      ok: true,
      value: {
        rows: [ROWS[4], ROWS[2], ROWS[3], ROWS[1], ROWS[0]],
        cursor: null,
      },
    });
  });

  it('pages strictly below the cursor, and never ends a page inside an instant', async () => {
    const timeline = ports();
    const first = await timeline.pageAuditByTargetCustomer(ANA_RECORD, null, 2);
    // r4, then the 3 000 instant whole (r3a, r3b) — the cursor below it.
    expect(ids(first)).toEqual(['r4', 'r3b', 'r3a']);
    expect(first.ok && first.value.cursor).toBe(3_000);
    const second = await timeline.pageAuditByTargetCustomer(
      ANA_RECORD,
      at(3_000),
      2,
    );
    expect(second).toEqual({
      ok: true,
      value: { rows: [ROWS[1], ROWS[0]], cursor: null },
    });
  });

  it('keys each timeline by its own field', async () => {
    const timeline = ports();
    expect(
      ids(await timeline.pageAuditByTargetCustomer(BOB_RECORD, null, 10)),
    ).toEqual(['r-bob']);
    expect(ids(await timeline.pageAuditByTargetUser(ANA, null, 10))).toEqual([
      'p1',
    ]);
    expect(ids(await timeline.pageAuditByResource(APPT, null, 10))).toEqual([
      'r-bob',
      'r4',
      'r3a',
      'r3b',
      'r2',
      'r1',
    ]);
    expect(ids(await timeline.pageAuditByActorAdmin(ADMIN, null, 10))).toEqual([
      'r4',
    ]);
    expect(ids(await timeline.pageAuditByActorUser(ANA, null, 10))).toEqual([
      'p1',
      'r-bob',
      'r3a',
      'r3b',
      'r2',
      'r1',
    ]);
  });

  it('reads auditLog alone, and builds no operation read', async () => {
    const fake = seeded();
    const collection = vi.spyOn(fake.db, 'collection');
    const timeline = ports(fake);
    await timeline.pageAuditByTargetCustomer(ANA_RECORD, null, 2);
    expect(new Set(collection.mock.calls.map(([path]) => path))).toEqual(
      new Set([Collections.AuditLog]),
    );
    expect(timeline).not.toHaveProperty('auditRowsForOperation');
    expect(Object.keys(timeline).sort()).toEqual([
      'pageAuditByActorAdmin',
      'pageAuditByActorUser',
      'pageAuditByResource',
      'pageAuditByTargetCustomer',
      'pageAuditByTargetUser',
    ]);
  });

  it('answers a read that throws as a failed read of auditLog, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('7 PERMISSION_DENIED: u-ana'), {
        code: 7,
      });
    });
    expect(await ports(fake).pageAuditByTargetUser(ANA, null, 10)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.AuditLog,
        'permission-denied',
      ),
    });
  });
});
