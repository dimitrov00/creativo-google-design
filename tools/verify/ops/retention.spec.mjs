// node --test tools/verify/ops/retention.spec.mjs
//
// The retention policy (runbook §2.5, audit-hardening WS-6), as declared in
// firestore.indexes.json: exactly the seven TTL groups of runbook §2.1 carry
// a `purgeAt` TTL, and the records the policy keeps indefinitely — the audit
// trail (`auditLog`), the trigger dead letters (`triggerFailures`) and the
// client journal (`clientJournal`) — carry none.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const INDEXES = JSON.parse(
  readFileSync(
    new URL('../../../firestore.indexes.json', import.meta.url),
    'utf8',
  ),
);

/** Runbook §2.1's seven groups. */
const TTL_GROUPS = [
  'barberBusy',
  'barberLeadTimeSamples',
  'capacity',
  'impersonationSessions',
  'notifications',
  'otps',
  'waitlistRequests',
];

/** Kept indefinitely (runbook §2.5): never a TTL. */
const NEVER_PURGED = ['auditLog', 'triggerFailures', 'clientJournal'];

describe('retention — the TTL groups of firestore.indexes.json', () => {
  const ttl = INDEXES.fieldOverrides.filter(
    (override) => override.ttl === true,
  );

  it('holds exactly the seven purgeAt policies of runbook §2.1', () => {
    assert.deepEqual(
      ttl.map((override) => override.collectionGroup).sort(),
      TTL_GROUPS,
    );
    for (const override of ttl) {
      assert.equal(override.fieldPath, 'purgeAt', override.collectionGroup);
      assert.deepEqual(override.indexes, [], override.collectionGroup);
    }
  });

  it('never purges the audit trail, the trigger dead letters or the client journal', () => {
    for (const group of NEVER_PURGED) {
      assert.equal(
        INDEXES.fieldOverrides.some(
          (override) =>
            override.collectionGroup === group && override.ttl === true,
        ),
        false,
        `${group} carries a TTL`,
      );
    }
  });
});
