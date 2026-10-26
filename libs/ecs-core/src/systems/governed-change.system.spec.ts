import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditTargetRef,
  GovernedCollection,
  type GovernedDocCollection,
  SystemSource,
} from '@core/components';
import {
  AuditResourceId,
  CustomerId,
  Tag,
  TriggerEventId,
  UserId,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import { deepFreeze, unwrapErr, unwrapOk, utcMs } from '@core/testing';
import { AuditSystem, type ProfileChange } from './audit.system';
import {
  type GovernedChange,
  GovernedChangeSystem,
} from './governed-change.system';

const AT = utcMs('2026-09-25T08:00:00.000Z');
const EVENT_AT = utcMs('2026-09-25T07:59:59.500Z');
const WRITER = Actor.user(UserId.of('u-ana'));

/** A governed write of `collection/docId`, branded as the wire edge brands it. */
function changeOf(
  collection: GovernedDocCollection,
  overrides: Partial<GovernedChange> = {},
): GovernedChange {
  return {
    governedCollection: collection,
    eventId: TriggerEventId.of('evt-1'),
    eventAtUtcMs: EVENT_AT,
    resourceId: unwrapOk(
      AuditResourceId.parse(`${GovernedChangeSystem.pathOf(collection)}/d-1`),
    ),
    targetCustomerId:
      collection === GovernedCollection.Customers ? CustomerId.of('d-1') : null,
    writer: WRITER,
    beforeExists: true,
    afterExists: true,
    fields: ['name'],
    ...overrides,
  };
}

const USERS_CHANGE: ProfileChange = {
  governedCollection: GovernedCollection.Users,
  eventId: TriggerEventId.of('evt-u'),
  eventAtUtcMs: EVENT_AT,
  ownerUserId: UserId.of('maria'),
  writer: Actor.system(SystemSource.AdminSdk),
  beforeExists: true,
  afterExists: true,
  fields: ['roles'],
  beforeProfileEditedAtUtcMs: null,
  afterProfileEditedAtUtcMs: null,
  profileRolesFrom: ['client'],
  profileRolesTo: ['client', 'barber'],
  profileAccountStatusFrom: null,
  profileAccountStatusTo: null,
};

const DOCS = Tag.values(GovernedCollection).filter(
  (c): c is GovernedDocCollection => c !== GovernedCollection.Users,
);

describe('GovernedChangeSystem.pathOf — every tag to its Collections path', () => {
  it('maps each of the fourteen members to the Collections value of the same key, USERS included', () => {
    const collections = new Map<string, string>(Object.entries(Collections));
    for (const [key, tag] of Object.entries(GovernedCollection)) {
      expect(GovernedChangeSystem.pathOf(tag), key).toBe(collections.get(key));
    }
    expect(GovernedChangeSystem.pathOf(GovernedCollection.Users)).toBe(
      Collections.Users,
    );
    const paths = Tag.values(GovernedCollection).map(
      GovernedChangeSystem.pathOf,
    );
    expect(new Set(paths).size).toBe(14);
  });
});

describe('GovernedChangeSystem.changedFields — names, ascending, each once', () => {
  it('lists the keys whose value differs on an update', () => {
    expect(
      GovernedChangeSystem.changedFields(
        { name: 'A', priceCents: 1000, active: true },
        { name: 'B', priceCents: 1000, active: true },
      ),
    ).toEqual(['name']);
  });

  it('a key on one side only is a change, absent and null apart', () => {
    expect(
      GovernedChangeSystem.changedFields({ a: 1 }, { a: 1, b: null }),
    ).toEqual(['b']);
    expect(GovernedChangeSystem.changedFields({ z: 1, a: 2 }, {})).toEqual([
      'a',
      'z',
    ]);
  });

  it('a map whose keys merely reordered is no change; an emptied list is one', () => {
    expect(
      GovernedChangeSystem.changedFields(
        { slots: { mon: [540, 1080], tue: [540, 1080] } },
        { slots: { tue: [540, 1080], mon: [540, 1080] } },
      ),
    ).toEqual([]);
    expect(
      GovernedChangeSystem.changedFields(
        { locationIds: ['l-1'] },
        { locationIds: [] },
      ),
    ).toEqual(['locationIds']);
    // A list's order is its value.
    expect(
      GovernedChangeSystem.changedFields(
        { barberIds: ['b-1', 'b-2'] },
        { barberIds: ['b-2', 'b-1'] },
      ),
    ).toEqual(['barberIds']);
  });

  it('a create lists the after-image’s keys, a delete the before-image’s — sorted', () => {
    expect(
      GovernedChangeSystem.changedFields(null, { title: 'x', body: 'y' }),
    ).toEqual(['body', 'title']);
    expect(
      GovernedChangeSystem.changedFields({ title: 'x', body: 'y' }, null),
    ).toEqual(['body', 'title']);
    expect(GovernedChangeSystem.changedFields(null, null)).toEqual([]);
  });

  it('answers names only, ascending and deduplicated, for any two documents', () => {
    const doc = fc.dictionary(
      fc.constantFrom('a', 'b', 'c', 'd'),
      fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    );
    fc.assert(
      fc.property(doc, doc, (before, after) => {
        const fields = GovernedChangeSystem.changedFields(before, after);
        expect([...fields].sort()).toEqual(fields);
        expect(new Set(fields).size).toBe(fields.length);
        for (const name of fields) {
          expect(name in before || name in after).toBe(true);
        }
        expect(GovernedChangeSystem.changedFields(after, after)).toEqual([]);
      }),
    );
  });
});

describe('GovernedChangeSystem.action', () => {
  it('names creation, update and deletion apart', () => {
    expect(GovernedChangeSystem.action(false, true)).toBe(
      'GOVERNED_DOC_CREATED',
    );
    expect(GovernedChangeSystem.action(true, true)).toBe(
      'GOVERNED_DOC_UPDATED',
    );
    expect(GovernedChangeSystem.action(true, false)).toBe(
      'GOVERNED_DOC_DELETED',
    );
  });
});

describe('GovernedChangeSystem.plan — the one planner entry (RU-40)', () => {
  it('a USERS change plans exactly what AuditSystem.planProfileChange plans', () => {
    expect(GovernedChangeSystem.plan(USERS_CHANGE, AT)).toEqual(
      AuditSystem.planProfileChange(USERS_CHANGE, AT),
    );
    const skipped: ProfileChange = { ...USERS_CHANGE, fields: [] };
    expect(GovernedChangeSystem.plan(skipped, AT)).toEqual(
      AuditSystem.planProfileChange(skipped, AT),
    );
  });

  it.each(DOCS)(
    '%s: one GOVERNED_DOC row — the resource, the writer, the event’s instant, no operation',
    (collection) => {
      const change = changeOf(collection);
      const plan = unwrapOk(GovernedChangeSystem.plan(change, AT));
      const target =
        collection === GovernedCollection.Customers
          ? AuditTargetRef.customer(CustomerId.of('d-1'))
          : AuditTargetRef.none();
      expect(plan?.row).toEqual({
        recordedAtUtcMs: EVENT_AT,
        resourceId: `${GovernedChangeSystem.pathOf(collection)}/d-1`,
        auditOperationId: null,
        ...WRITER,
        auditAction: 'GOVERNED_DOC_UPDATED',
        governedCollection: collection,
        governedFields: ['name'],
        ...target,
      });
      expect(plan?.idBasis).toBe(
        AuditSystem.rowBasis(
          'GOVERNED_DOC_UPDATED',
          change.resourceId,
          change.targetCustomerId,
          'evt-1',
        ),
      );
    },
  );

  it('a CUSTOMERS change targets the client record; every other collection nobody', () => {
    for (const collection of DOCS) {
      const plan = unwrapOk(
        GovernedChangeSystem.plan(changeOf(collection), AT),
      );
      expect(plan?.row.auditTarget).toBe(
        collection === GovernedCollection.Customers ? 'CUSTOMER' : 'NONE',
      );
    }
  });

  it('plans nothing for a write that changed no field; refuses an event with no id', () => {
    expect(
      unwrapOk(
        GovernedChangeSystem.plan(
          changeOf(GovernedCollection.Coupons, { fields: [] }),
          AT,
        ),
      ),
    ).toBeNull();
    expect(
      unwrapErr(
        GovernedChangeSystem.plan(
          changeOf(GovernedCollection.Coupons, {
            eventId: TriggerEventId.of(' '),
          }),
          AT,
        ),
      ).errorCode,
    ).toBe(GovernanceErrorCode.AuditEntryEmptyAction);
  });

  it('stamps nowUtcMs only when the event’s instant did not parse; a redelivery derives the same id', () => {
    const change = changeOf(GovernedCollection.Barbers, { eventAtUtcMs: null });
    const plan = unwrapOk(GovernedChangeSystem.plan(change, AT));
    expect(plan?.row.recordedAtUtcMs).toBe(AT);
    expect(unwrapOk(GovernedChangeSystem.plan(change, EVENT_AT))?.idBasis).toBe(
      plan?.idBasis,
    );
  });

  it('never lets a value leak into a row — the fields come from changedFields, names only (R36)', () => {
    const value = fc.string({ minLength: 6, maxLength: 16 });
    fc.assert(
      fc.property(
        fc.constantFrom(...DOCS),
        fc.dictionary(fc.constantFrom('body', 'code', 'phone'), value),
        fc.dictionary(fc.constantFrom('body', 'code', 'phone'), value),
        (collection, before, after) => {
          const fields = GovernedChangeSystem.changedFields(before, after);
          const plan = unwrapOk(
            GovernedChangeSystem.plan(changeOf(collection, { fields }), AT),
          );
          if (fields.length === 0) {
            expect(plan).toBeNull();
            return;
          }
          const json = JSON.stringify(plan?.row);
          for (const v of [...Object.values(before), ...Object.values(after)]) {
            if (!['body', 'code', 'phone'].includes(v)) {
              expect(json).not.toContain(`"${v}"`);
            }
          }
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const change = deepFreeze(changeOf(GovernedCollection.Customers));
    const users = deepFreeze({ ...USERS_CHANGE });
    expect(GovernedChangeSystem.plan(change, AT)).toEqual(
      GovernedChangeSystem.plan(change, AT),
    );
    expect(GovernedChangeSystem.plan(users, AT)).toEqual(
      GovernedChangeSystem.plan(users, AT),
    );
    const before = deepFreeze({ b: [1, 2], a: { y: 1, x: 2 } });
    const after = deepFreeze({ b: [1], a: { x: 2, y: 1 } });
    expect(GovernedChangeSystem.changedFields(before, after)).toEqual(['b']);
    expect(GovernedChangeSystem.changedFields(before, after)).toEqual(
      GovernedChangeSystem.changedFields(before, after),
    );
  });
});
