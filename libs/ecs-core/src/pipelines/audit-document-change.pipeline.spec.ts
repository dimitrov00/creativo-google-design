import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Actor,
  AuditAction,
  AuditContext,
  type AuditedProfileField,
  AuditTargetRef,
  GovernedCollection,
  type GovernedDocCollection,
  SystemSource,
} from '@core/components';
import {
  AuditEntryId,
  AuditResourceId,
  CustomerId,
  Result,
  TriggerEventId,
  UserId,
} from '@core/primitives';
import { GovernanceError, RepositoryError } from '@core/errors';
import type { AuditEntry } from '@core/entities';
import {
  AuditSystem,
  type GovernedChange,
  GovernedChangeSystem,
  type ProfileChange,
} from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  pinnedNowUtcMs,
  unwrapOk,
  utcMs,
  auditResource,
} from '@core/testing';
import { auditDocumentChange } from './audit-document-change.pipeline';

/*
 * The ONE document-change handler (audit-hardening WS-3, RU-40). Its users
 * half is the profile trigger (`audit-profile-changes.ts`) — every case of
 * the retired `audit-profile-change.pipeline.spec.ts`, moved unchanged: one
 * `users/{uid}` write is at most ONE audit row — the changed field NAMES,
 * the writer the auth context names, the event's own instant — under the
 * deterministic id `hash(rowBasis(…, changeKey = event.id))`, written
 * through `createAuditRows` (ALREADY_EXISTS a success). Its governed half:
 * one write of the thirteen other collections is at most ONE
 * `GOVERNED_DOC_*` row, the same way. Who wrote it and which fields count
 * are the systems' specs; this one asserts the rows that reached the writer
 * and what the edge is answered.
 */

const OWNER = UserId.of('u-maria');
const EVENT_AT = utcMs('2026-09-28T08:30:00.000+03:00');

function changeOf(overrides: Partial<ProfileChange> = {}): ProfileChange {
  return {
    governedCollection: GovernedCollection.Users,
    eventId: TriggerEventId.of('evt-1'),
    eventAtUtcMs: EVENT_AT,
    ownerUserId: OWNER,
    writer: Actor.user(OWNER),
    beforeExists: true,
    afterExists: true,
    fields: ['phone'],
    beforeProfileEditedAtUtcMs: null,
    afterProfileEditedAtUtcMs: null,
    profileRolesFrom: null,
    profileRolesTo: null,
    profileAccountStatusFrom: null,
    profileAccountStatusTo: null,
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
  const run = auditDocumentChange({
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
  fields: readonly AuditedProfileField[],
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
    // A trigger row names no operation (WS-4.4).
    auditOperationId: null,
    ...Actor.user(OWNER),
    ...AuditContext.profile(AuditAction.ProfileUpdated, fields),
    ...AuditTargetRef.user(OWNER),
  };
}

describe('auditDocumentChange — a users write (the profile trigger, moved unchanged)', () => {
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

describe('auditDocumentChange — a users write carries its role and status tags (WS-3, DEP-13)', () => {
  it('plans exactly what AuditSystem.planProfileChange plans', async () => {
    const change = changeOf({
      fields: ['roles', 'accountStatus'],
      profileRolesFrom: ['client'],
      profileRolesTo: ['barber'],
      profileAccountStatusFrom: 'ACTIVE',
      profileAccountStatusTo: 'BLOCKED',
    });
    const { written, run } = rig();
    await run(change);
    const plan = unwrapOk(
      AuditSystem.planProfileChange(change, FIXTURE_NOW_UTC_MS),
    );
    expect(written).toEqual([
      [
        {
          id: AuditEntryId.of(fixtureHash(plan?.idBasis ?? '')),
          ...plan?.row,
        },
      ],
    ]);
    expect(written[0]?.[0]).toMatchObject({
      profileFields: ['roles', 'accountStatus'],
      profileRolesFrom: ['client'],
      profileRolesTo: ['barber'],
      profileAccountStatusFrom: 'ACTIVE',
      profileAccountStatusTo: 'BLOCKED',
    });
  });
});

/* ── The governed half: the thirteen other collections ──────────────────── */

const DOCS: readonly GovernedDocCollection[] = [
  GovernedCollection.Settings,
  GovernedCollection.Services,
  GovernedCollection.Barbers,
  GovernedCollection.Locations,
  GovernedCollection.BarberSchedules,
  GovernedCollection.ScheduleExceptions,
  GovernedCollection.Coupons,
  GovernedCollection.Positions,
  GovernedCollection.Courses,
  GovernedCollection.Events,
  GovernedCollection.Customers,
  GovernedCollection.AppointmentNotes,
  GovernedCollection.AppointmentPhotos,
];

/**
 * Two fields each collection's documents really hold — the browser-written
 * three keep only their entities' names (review round 1, R36), so their
 * fixture names two of those; the rest keep `name` / `priceCents`.
 */
function fieldsOf(collection: GovernedDocCollection): readonly string[] {
  switch (collection) {
    case GovernedCollection.AppointmentNotes:
      return ['text', 'writtenAtUtcMs'];
    case GovernedCollection.AppointmentPhotos:
      return ['label', 'takenAtUtcMs'];
    case GovernedCollection.ScheduleExceptions:
      return ['exceptionEffect', 'exceptionRanges'];
    default:
      return ['name', 'priceCents'];
  }
}

/** A governed write of `collection/docId`, branded as the wire edge brands it. */
function governedOf(
  collection: GovernedDocCollection,
  overrides: Partial<GovernedChange> = {},
): GovernedChange {
  const docId = 'doc-1';
  return {
    governedCollection: collection,
    eventId: TriggerEventId.of('evt-g1'),
    eventAtUtcMs: EVENT_AT,
    resourceId: unwrapOk(
      AuditResourceId.parse(
        `${GovernedChangeSystem.pathOf(collection)}/${docId}`,
      ),
    ),
    targetCustomerId:
      collection === GovernedCollection.Customers
        ? unwrapOk(CustomerId.parse(docId))
        : null,
    writer: Actor.user(OWNER),
    beforeExists: true,
    afterExists: true,
    fields: fieldsOf(collection),
    ...overrides,
  };
}

describe('auditDocumentChange — a governed write (WS-3, DEP-14)', () => {
  it.each(DOCS)(
    '%s: ONE row keyed by the event — the collection, the field names, the resource and the writer',
    async (collection) => {
      const { written, run } = rig();
      expect(await run(governedOf(collection))).toEqual(Result.ok({ rows: 1 }));
      const resourceId = `${GovernedChangeSystem.pathOf(collection)}/doc-1`;
      const isCustomer = collection === GovernedCollection.Customers;
      const row = {
        recordedAtUtcMs: EVENT_AT,
        resourceId,
        auditOperationId: null,
        ...Actor.user(OWNER),
        auditAction: 'GOVERNED_DOC_UPDATED',
        governedCollection: collection,
        governedFields: fieldsOf(collection),
        ...(isCustomer
          ? AuditTargetRef.customer(CustomerId.of('doc-1'))
          : AuditTargetRef.none()),
      };
      expect(written).toEqual([
        [
          {
            id: AuditEntryId.of(
              fixtureHash(
                AuditSystem.rowBasis(
                  'GOVERNED_DOC_UPDATED',
                  auditResource(resourceId),
                  isCustomer ? CustomerId.of('doc-1') : null,
                  'evt-g1',
                ),
              ),
            ),
            ...row,
          },
        ],
      ]);
    },
  );

  it('names creation and deletion apart — a delete lists the before-image’s fields the decoder gave it', async () => {
    const { written, run } = rig();
    await run(
      governedOf(GovernedCollection.Coupons, {
        beforeExists: false,
        fields: ['code'],
      }),
    );
    await run(
      governedOf(GovernedCollection.AppointmentNotes, {
        afterExists: false,
        eventId: TriggerEventId.of('evt-g2'),
        fields: GovernedChangeSystem.changedFields(
          { authorUserId: 'u-1', text: 'x', writtenAtUtcMs: 1 },
          null,
        ),
      }),
    );
    expect(written.map((rows) => rows[0]?.auditAction)).toEqual([
      'GOVERNED_DOC_CREATED',
      'GOVERNED_DOC_DELETED',
    ]);
    expect(written[1]?.[0]).toMatchObject({
      governedFields: ['authorUserId', 'text', 'writtenAtUtcMs'],
    });
  });

  it('derives the same row for a redelivered event, two rows for two writes', async () => {
    const { written, run } = rig();
    await run(governedOf(GovernedCollection.Services));
    await run(governedOf(GovernedCollection.Services));
    await run(
      governedOf(GovernedCollection.Services, {
        eventId: TriggerEventId.of('evt-g9'),
      }),
    );
    const ids = written.map((rows) => rows[0]?.id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('credits an Admin-SDK or console write to the process', async () => {
    const { written, run } = rig();
    await run(
      governedOf(GovernedCollection.Settings, {
        writer: Actor.system(SystemSource.AdminSdk),
      }),
    );
    expect(written[0]?.[0]).toMatchObject({
      actorRole: 'SYSTEM',
      actorSystemSource: 'ADMIN_SDK',
      auditTarget: 'NONE',
    });
  });

  it('stamps the clock only when the event’s own time did not parse', async () => {
    const { written, run } = rig();
    await run(governedOf(GovernedCollection.Barbers, { eventAtUtcMs: null }));
    expect(written[0]?.[0]?.recordedAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
  });

  it('writes nothing when no field changed', async () => {
    const { written, run } = rig();
    expect(
      await run(governedOf(GovernedCollection.Barbers, { fields: [] })),
    ).toEqual(Result.ok({ rows: 0 }));
    expect(written).toEqual([]);
  });

  it('refuses an event with no id — permanent, nothing written', async () => {
    const { written, run } = rig();
    expect(
      await run(
        governedOf(GovernedCollection.Events, {
          eventId: TriggerEventId.of(' '),
        }),
      ),
    ).toEqual({ ok: false, error: GovernanceError.auditEntryEmptyAction() });
    expect(written).toEqual([]);
  });

  it('answers a failed write for the edge to judge', async () => {
    const failure = RepositoryError.writeFailed('auditLog/x', 'unavailable');
    const { run } = rig(async () => Result.err(failure));
    expect(await run(governedOf(GovernedCollection.Courses))).toEqual({
      ok: false,
      error: failure,
    });
  });

  it('never lets a document value into the row — names only (R36)', async () => {
    const SECRET = 'SECRET-value-91';
    const { written, run } = rig();
    await run(
      governedOf(GovernedCollection.AppointmentNotes, {
        fields: GovernedChangeSystem.changedFields(
          { text: 'old' },
          { text: SECRET },
        ),
      }),
    );
    expect(JSON.stringify(written)).not.toContain(SECRET);
    expect(written[0]?.[0]).toMatchObject({ governedFields: ['text'] });
  });

  it('never lets a caller-chosen field NAME into the row of a browser-written collection (R36, review round 1)', async () => {
    const SMUGGLED = 'Ivan Petrov 0888123456 HIV+';
    const { written, run } = rig();
    await run(
      governedOf(GovernedCollection.AppointmentNotes, {
        beforeExists: false,
        fields: GovernedChangeSystem.changedFields(null, {
          text: 'x',
          authorUserId: 'u-1',
          writtenAtUtcMs: 1,
          [SMUGGLED]: true,
        }),
      }),
    );
    expect(written[0]?.[0]).toMatchObject({
      auditAction: 'GOVERNED_DOC_CREATED',
      governedFields: [
        GovernedChangeSystem.UNKNOWN_FIELD,
        'authorUserId',
        'text',
        'writtenAtUtcMs',
      ],
    });
    expect(JSON.stringify(written)).not.toContain('Ivan Petrov');
  });

  it('plans exactly what GovernedChangeSystem.plan plans, for any collection and sides', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DOCS),
        fc.boolean(),
        fc.boolean(),
        async (collection, beforeExists, afterExists) => {
          const change = governedOf(collection, { beforeExists, afterExists });
          const { written, run } = rig();
          await run(change);
          const plan = unwrapOk(
            GovernedChangeSystem.plan(change, FIXTURE_NOW_UTC_MS),
          );
          expect(written[0]?.[0]).toEqual({
            id: AuditEntryId.of(fixtureHash(plan?.idBasis ?? '')),
            ...plan?.row,
          });
        },
      ),
    );
  });
});
