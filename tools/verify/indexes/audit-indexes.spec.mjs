// node --test tools/verify/indexes/audit-indexes.spec.mjs
//
// The reviewable audit trail's indexes (audit-hardening WS-7, DEP-11),
// pinned on the real firestore.indexes.json. The Firestore emulator never
// enforces a composite index, so a timeline query whose composite is
// missing passes every emulator spec and fails in production with
// FAILED_PRECONDITION: this file is where the five composites the web
// adapter's timelines need (libs/infrastructure/firestore/src/lib/audit.adapter.ts)
// are proven declared; the preflight's P3 proves them READY on a project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The repository's index file, read as data — never imported. */
const INDEXES = JSON.parse(
  readFileSync(resolve(ROOT, 'firestore.indexes.json'), 'utf8'),
);

/** The equality field of each timeline, one composite each. */
const TIMELINE_FIELDS = [
  'targetCustomerId',
  'targetUserId',
  'resourceId',
  'actorUserId',
  'actorAdminUserId',
];

const auditComposites = INDEXES.indexes.filter(
  (index) => index.collectionGroup === 'auditLog',
);
const auditOverrides = INDEXES.fieldOverrides.filter(
  (override) => override.collectionGroup === 'auditLog',
);

describe('firestore.indexes.json — the auditLog timelines (WS-7)', () => {
  it('declares exactly the five timeline composites on auditLog', () => {
    assert.deepEqual(
      auditComposites.map((index) => index.fields[0]?.fieldPath).sort(),
      [...TIMELINE_FIELDS].sort(),
    );
  });

  for (const field of TIMELINE_FIELDS) {
    it(`keys ${field} ASC, then recordedAtUtcMs DESC last, on the collection`, () => {
      const index = auditComposites.find(
        (entry) => entry.fields[0]?.fieldPath === field,
      );
      assert.ok(index, `no auditLog composite on ${field}`);
      assert.equal(index.queryScope, 'COLLECTION');
      assert.deepEqual(index.fields, [
        { fieldPath: field, order: 'ASCENDING' },
        { fieldPath: 'recordedAtUtcMs', order: 'DESCENDING' },
      ]);
    });
  }

  it('leaves auditOperationId and resourceId in no field override (their automatic single-field indexes serve one operation’s rows and the backfill’s resourceId-in reads)', () => {
    const touched = auditOverrides.map((override) => override.fieldPath);
    assert.equal(touched.includes('auditOperationId'), false);
    assert.equal(touched.includes('resourceId'), false);
  });

  it('switches off no field a timeline reads', () => {
    const touched = new Set(
      auditOverrides.map((override) => override.fieldPath),
    );
    for (const field of [...TIMELINE_FIELDS, 'recordedAtUtcMs']) {
      assert.equal(touched.has(field), false, `${field} is overridden`);
    }
  });
});
