// node --test tools/verify/indexes/privacy-indexes.spec.mjs
//
// The data-subject requests' indexes (audit-hardening Phase 3, WS-C / WS-D),
// pinned on the real firestore.indexes.json. Every footprint read of the
// privacy callables is ONE root equality or `array-contains` over the
// automatic single-field index (`privacy.port.ts`) — the by-contact read
// one per contact field (P3-DEP-28) — so none of those fields may be
// switched off by a field override; the emulator would never notice, and
// production would answer FAILED_PRECONDITION. The customer's two erasure
// stamps are scalars no query reads, so their single-field indexes are off
// (review round 1, P3-DEP-31 — the WS-2 / P3-L-4 precedent), while the tag
// `erasureStatus` keeps its own.
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

/** Every `[collectionGroup, fieldPath]` a privacy footprint read queries on. */
const FOOTPRINT_FIELDS = [
  ['appointments', 'subjectCustomerIds'],
  ['appointments', 'contactPhone'],
  ['appointments', 'contactEmail'],
  ['appointmentPhotos', 'clientCustomerId'],
  ['appointmentPhotos', 'appointmentId'],
  ['couponGrants', 'customerId'],
  ['giftVouchers', 'issuedToCustomerId'],
  ['clientJournal', 'customerId'],
  ['waitlistRequests', 'ownerUserId'],
  ['invitations', 'inviterUserId'],
  ['impersonationSessions', 'targetUserId'],
  ['otps', 'destination'],
];

/** The field override of one `[collectionGroup, fieldPath]`, or `undefined`. */
const overrideOf = (collectionGroup, fieldPath) =>
  INDEXES.fieldOverrides.find(
    (override) =>
      override.collectionGroup === collectionGroup &&
      override.fieldPath === fieldPath,
  );

describe('firestore.indexes.json — the privacy footprint and the erasure stamps', () => {
  for (const [collectionGroup, fieldPath] of FOOTPRINT_FIELDS) {
    it(`leaves ${collectionGroup}.${fieldPath} in no field override (a footprint read's automatic index)`, () => {
      assert.equal(overrideOf(collectionGroup, fieldPath), undefined);
    });
  }

  for (const fieldPath of ['erasureStartedAtUtcMs', 'erasedAtUtcMs']) {
    it(`switches off customers.${fieldPath} — a stamp no query reads`, () => {
      assert.deepEqual(overrideOf('customers', fieldPath), {
        collectionGroup: 'customers',
        fieldPath,
        indexes: [],
      });
    });
  }

  it('keeps the tag customers.erasureStatus indexed', () => {
    assert.equal(overrideOf('customers', 'erasureStatus'), undefined);
  });

  it('declares each field override once', () => {
    const keys = INDEXES.fieldOverrides.map(
      (override) => `${override.collectionGroup}.${override.fieldPath}`,
    );
    assert.equal(new Set(keys).size, keys.length);
  });
});
