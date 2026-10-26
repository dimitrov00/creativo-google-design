import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
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
  OperationId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import type { AuditReadPorts, AuditTimelinePage } from '@core/ports';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { auditReadPorts } = await import('./audit.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
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
const OP_1 = OperationId.of('op-0000000000000001');
const OP_2 = OperationId.of('op-0000000000000002');

/**
 * A row as `auditLog/{id}` stores it (the entity minus `id`, Law 5) — a
 * booking act's row for one client record, by Ana or (`byAdmin`) the admin.
 */
const row = (
  id: string,
  recordedAtMs: number,
  target: CustomerId,
  operationId: OperationId | null,
  byAdmin = false,
): AuditEntry => ({
  id: AuditEntryId.of(id),
  recordedAtUtcMs: at(recordedAtMs),
  resourceId: APPT,
  auditOperationId: operationId,
  ...(byAdmin ? Actor.admin(ADMIN) : Actor.user(ANA)),
  ...AuditContext.profile(AuditAction.ProfileUpdated, [
    RegistrationField.FirstName,
  ]),
  ...AuditTargetRef.customer(target),
});

/** An own profile edit's row — targeted at the account, not a record. */
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

// r3 and r4 are one act's fan-out: one instant, two rows.
const ROWS: readonly AuditEntry[] = [
  row('r1', 1_000, ANA_RECORD, OP_1),
  row('r2', 2_000, ANA_RECORD, null),
  row('r3', 3_000, ANA_RECORD, OP_2, true),
  row('r4', 3_000, ANA_RECORD, OP_2, true),
  row('r5', 4_000, BOB_RECORD, OP_2, true),
  profileRow('p1', 5_000),
];

/** `auditLog/*` as the server writes it. */
function seeded(rows: readonly AuditEntry[] = ROWS): FakeFirestore {
  const fake = new FakeFirestore();
  for (const { id, ...body } of rows) fake.set(`auditLog/${id}`, body);
  return fake;
}

const ids = (rows: readonly AuditEntry[]) => rows.map((entry) => entry.id);

/** Every page of Ana's record until nothing older is left. */
async function walk(
  ports: AuditReadPorts,
  max: number,
): Promise<readonly AuditTimelinePage[]> {
  const pages: AuditTimelinePage[] = [];
  let before: UtcEpochMs | null = null;
  do {
    const page = await ports.pageAuditByTargetCustomer(ANA_RECORD, before, max);
    if (!page.ok) throw new Error('page refused');
    pages.push(page.value);
    before = page.value.cursor;
  } while (before !== null && pages.length < 20);
  return pages;
}

describe('auditReadPorts — the timelines', () => {
  it('reads one equality and recordedAtUtcMs desc, one row more than the page', async () => {
    const fake = seeded();

    await auditReadPorts(asDb(fake)).pageAuditByTargetCustomer(
      ANA_RECORD,
      null,
      10,
    );

    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'auditLog',
        constraints: [
          'targetCustomerId == "cus-ana"',
          'orderBy recordedAtUtcMs desc',
          'limit 11',
        ],
      },
    ]);
  });

  /** Each timeline, read below the cursor 3000 in pages of 2. */
  const TIMELINES: readonly (readonly [
    string,
    string,
    (ports: AuditReadPorts) => Promise<unknown>,
  ])[] = [
    [
      'pageAuditByTargetCustomer',
      'targetCustomerId',
      (ports) => ports.pageAuditByTargetCustomer(ANA_RECORD, at(3_000), 2),
    ],
    [
      'pageAuditByTargetUser',
      'targetUserId',
      (ports) => ports.pageAuditByTargetUser(ANA, at(3_000), 2),
    ],
    [
      'pageAuditByResource',
      'resourceId',
      (ports) => ports.pageAuditByResource(APPT, at(3_000), 2),
    ],
    [
      'pageAuditByActorUser',
      'actorUserId',
      (ports) => ports.pageAuditByActorUser(ANA, at(3_000), 2),
    ],
    [
      'pageAuditByActorAdmin',
      'actorAdminUserId',
      (ports) => ports.pageAuditByActorAdmin(ADMIN, at(3_000), 2),
    ],
  ];
  const KEYS: ReadonlyMap<string, string> = new Map<string, string>([
    ['targetCustomerId', ANA_RECORD],
    ['targetUserId', ANA],
    ['resourceId', APPT],
    ['actorUserId', ANA],
    ['actorAdminUserId', ADMIN],
  ]);

  it.each(TIMELINES)(
    '%s keys its read on %s, below the cursor when one is given',
    async (_port, field, read) => {
      const fake = seeded();
      const key = KEYS.get(field);

      await read(auditReadPorts(asDb(fake)));

      expect(fake.reads[0]?.constraints).toEqual([
        `${field} == ${JSON.stringify(key)}`,
        'recordedAtUtcMs < 3000',
        'orderBy recordedAtUtcMs desc',
        'limit 3',
      ]);
    },
  );

  it('hands every row over as stored, the body beside its id, newest first', async () => {
    const page = await auditReadPorts(asDb(seeded())).pageAuditByTargetUser(
      ANA,
      null,
      10,
    );

    expect(page).toEqual(Result.ok({ rows: [ROWS[5]], cursor: null }));
  });

  it('answers each timeline its own rows', async () => {
    const ports = auditReadPorts(asDb(seeded()));

    const byResource = await ports.pageAuditByResource(APPT, null, 10);
    const byActor = await ports.pageAuditByActorUser(ANA, null, 10);
    const byAdmin = await ports.pageAuditByActorAdmin(ADMIN, null, 10);

    expect(byResource.ok && ids(byResource.value.rows)).toEqual([
      'r5',
      'r4',
      'r3',
      'r2',
      'r1',
    ]);
    expect(byActor.ok && ids(byActor.value.rows)).toEqual(['p1', 'r2', 'r1']);
    expect(byAdmin.ok && ids(byAdmin.value.rows)).toEqual(['r5', 'r4', 'r3']);
  });

  it('never ends a page inside an instant: the fan-out is taken whole', async () => {
    const fake = seeded();

    const page = await auditReadPorts(asDb(fake)).pageAuditByTargetCustomer(
      ANA_RECORD,
      null,
      1,
    );

    expect(page).toEqual(
      Result.ok({ rows: [ROWS[3], ROWS[2]], cursor: at(3_000) }),
    );
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      [
        'targetCustomerId == "cus-ana"',
        'orderBy recordedAtUtcMs desc',
        'limit 2',
      ],
      ['targetCustomerId == "cus-ana"', 'recordedAtUtcMs == 3000'],
      [
        'targetCustomerId == "cus-ana"',
        'recordedAtUtcMs < 3000',
        'orderBy recordedAtUtcMs desc',
        'limit 1',
      ],
    ]);
  });

  it('gives no cursor when the tied instant is the oldest', async () => {
    const fake = seeded([
      row('t1', 3_000, ANA_RECORD, OP_2),
      row('t2', 3_000, ANA_RECORD, OP_2),
    ]);

    const page = await auditReadPorts(asDb(fake)).pageAuditByTargetCustomer(
      ANA_RECORD,
      null,
      1,
    );

    expect(page.ok && ids(page.value.rows)).toEqual(['t2', 't1']);
    expect(page.ok && page.value.cursor).toBeNull();
  });

  it.each([1, 2, 3, 4, 10])(
    'walks every row exactly once, newest first, in pages of %s',
    async (max) => {
      const pages = await walk(auditReadPorts(asDb(seeded())), max);

      expect(pages.flatMap((page) => ids(page.rows))).toEqual([
        'r4',
        'r3',
        'r2',
        'r1',
      ]);
      expect(pages.at(-1)?.cursor).toBeNull();
    },
  );

  it('answers an empty page, no cursor, for a key nothing was filed against', async () => {
    const page = await auditReadPorts(asDb(seeded())).pageAuditByTargetCustomer(
      CustomerId.of('cus-nobody'),
      null,
      10,
    );

    expect(page).toEqual(Result.ok({ rows: [], cursor: null }));
  });

  it('reads a page size that is not a whole number as one', async () => {
    const fake = seeded();

    await auditReadPorts(asDb(fake)).pageAuditByResource(
      APPT,
      null,
      Number.NaN,
    );

    expect(fake.reads[0]?.constraints.at(-1)).toBe('limit 2');
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const page = await auditReadPorts(asDb(fake)).pageAuditByTargetCustomer(
      ANA_RECORD,
      null,
      10,
    );

    expect(page).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'auditLog',
        reason: 'permission-denied',
      }),
    );
  });
});

describe('auditReadPorts.auditRowsForOperation — one operation’s rows', () => {
  it('reads auditOperationId ==, at most 50, with no order of its own', async () => {
    const fake = seeded();

    await auditReadPorts(asDb(fake)).auditRowsForOperation(OP_2);

    expect(fake.reads).toEqual([
      {
        kind: 'query',
        path: 'auditLog',
        constraints: ['auditOperationId == "op-0000000000000002"', 'limit 50'],
      },
    ]);
  });

  it('answers the rows oldest first, a tie by id', async () => {
    const fake = seeded([
      row('b', 3_000, ANA_RECORD, OP_2),
      row('c', 4_000, BOB_RECORD, OP_2),
      row('a', 3_000, BOB_RECORD, OP_2),
      row('z', 1_000, ANA_RECORD, OP_1),
    ]);

    const rows = await auditReadPorts(asDb(fake)).auditRowsForOperation(OP_2);

    expect(rows.ok && ids(rows.value)).toEqual(['a', 'b', 'c']);
  });

  it('answers no rows for an operation that wrote none', async () => {
    const rows = await auditReadPorts(asDb(seeded())).auditRowsForOperation(
      OperationId.of('op-never-written'),
    );

    expect(rows).toEqual(Result.ok([]));
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = seeded().failWith({ code: 'permission-denied' });

    const rows = await auditReadPorts(asDb(fake)).auditRowsForOperation(OP_1);

    expect(rows.ok).toBe(false);
  });
});
