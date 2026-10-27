import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  AuditTargetRef,
  BookingContact,
  ClientPrivacyCall,
  PrivacyMarker,
  RedemptionCount,
} from '@core/components';
import { PrivacyErrorCode } from '@core/errors';
import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  InvitationId,
  OperationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { Invitation } from '@core/entities';
import {
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  fixtureWalkInHash,
  OTHER_SENTINELS,
  PRIVACY_SENTINELS,
  privacyWorld,
  unwrapErr,
  unwrapOk,
  WALK_IN_SENTINELS,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import { CanonicalJsonSystem } from './canonical-json.system';
import {
  type ClientExportBundle,
  type ClientFootprint,
  ClientExportSystem,
  EXPORT_MAX_BYTES,
  EXPORT_MAX_DOCUMENTS,
} from './client-export.system';

/* The client export's pure half (audit-hardening Phase 3, WS-C, P3-RU-18,
 * P3-L-5, P3-L-6, P3-RU-33) over the privacy world of `@core/testing`:
 * P is asked about, Q shares a party with P, W is a walk-in. Every personal
 * value is a sentinel, so a scan of the canonical JSON proves an absence. */

const NOW = FIXTURE_NOW_UTC_MS;
const OPERATION = OperationId.of('op-export-0001');
const ADMIN = UserId.of('u-privacy-admin');

function ownRowIdOf(footprint: ClientFootprint): AuditEntryId {
  return AuditEntryId.of(
    fixtureHash(ClientExportSystem.rowIdBasis(footprint.record.id, OPERATION)),
  );
}

function exportOf(footprint: ClientFootprint) {
  return unwrapOk(
    ClientExportSystem.exportOf(
      footprint,
      NOW,
      ownRowIdOf(footprint),
      fixtureWalkInHash,
    ),
  );
}

function bundleOf(footprint: ClientFootprint): ClientExportBundle {
  return JSON.parse(exportOf(footprint).json) as ClientExportBundle;
}

/** P's footprint, as the pipeline reads it, plus documents a careless read might add. */
function noisyFootprint(): ClientFootprint {
  const world = privacyWorld();
  const footprint = world.personFootprint;
  const partyNote = world.state.notes.find(
    (note) => note.id === world.visits.party.id,
  );
  if (partyNote === undefined) throw new Error('no party note');
  return {
    ...footprint,
    // Q's own visit and a visit of W's — neither seats P.
    visits: [...footprint.visits, world.visits.walkInParty],
    // The party's note (a companion's words) beside P's own.
    notes: [...footprint.notes, partyNote],
    // Every photo of the world: Q's, and one naming nobody on the party.
    photos: [...footprint.photos, ...world.state.photos],
    // Every row of the world: Q's, and one where P only acted on Q.
    auditRows: world.auditRows,
  };
}

/** W's footprint: the record, no account, W's two visits. */
function walkInFootprint(): ClientFootprint {
  const world = privacyWorld();
  const record = world.state.records.find(
    (entry) => entry.id === world.walkIn.customerId,
  );
  if (record === undefined) throw new Error('no walk-in record');
  return {
    ...world.personFootprint,
    record,
    account: null,
    visits: [world.visits.walkInParty, world.visits.walkInThird],
    notes: [],
    photos: [],
    couponGrants: [],
    giftVouchers: [],
    loyaltyAccount: null,
    badgeProgress: [],
    seasonProgress: [],
    clientStats: null,
    clientMoney: null,
    journal: [],
    notifications: [],
    waitlistRequests: [],
    invitations: [],
    auditRows: [],
  };
}

/** A footprint of the bare record and `count` tiny invitations — `1 + count` documents. */
function sizedFootprint(count: number): ClientFootprint {
  const world = privacyWorld();
  const invitations: Invitation[] = [];
  for (let i = 0; i < count; i++) {
    invitations.push({
      id: InvitationId.of(`i${i}`),
      inviterUserId: world.person.userId,
      inviterName: 'x',
      redemptionCount: RedemptionCount.zero(),
      createdAtUtcMs: NOW,
    });
  }
  return { ...walkInFootprint(), visits: [], invitations };
}

describe('ClientExportSystem.bundleOf — the sections', () => {
  it('holds every section, each with exactly P’s documents, for a footprint holding one of each', () => {
    const world = privacyWorld();
    const bundle = bundleOf(noisyFootprint());
    expect(Object.keys(bundle).sort()).toEqual(
      [
        'appointmentNotes',
        'appointmentPhotos',
        'appointments',
        'auditLog',
        'badgeProgress',
        'clientExportVersion',
        'clientJournal',
        'clientMoney',
        'clientStats',
        'couponGrants',
        'customers',
        'exportedAtUtcMs',
        'exportedCustomerId',
        'exportedUserId',
        'giftVouchers',
        'invitations',
        'loyaltyAccounts',
        'notifications',
        'seasonProgress',
        'users',
        'waitlistRequests',
      ].sort(),
    );
    expect(bundle.clientExportVersion).toBe(ClientPrivacyCall.EXPORT_VERSION);
    expect(bundle.exportedAtUtcMs).toBe(NOW);
    expect(bundle.exportedCustomerId).toBe(world.person.customerId);
    expect(bundle.exportedUserId).toBe(world.person.userId);
    expect(bundle.customers.map((entry) => entry.id)).toEqual([
      world.person.customerId,
    ]);
    expect(bundle.users.map((entry) => entry.id)).toEqual([
      world.person.userId,
    ]);
    expect(bundle.appointments.map((entry) => entry.id)).toEqual([
      world.visits.party.id,
      world.visits.solo.id,
    ]);
    expect(bundle.appointmentNotes.map((entry) => entry.id)).toEqual([
      world.visits.solo.id,
    ]);
    expect(bundle.appointmentPhotos.map((entry) => entry.id)).toEqual([
      'photo-p-library',
      'photo-p-nobody',
      'photo-p-shot',
    ]);
    expect(bundle.giftVouchers.map((entry) => entry.id)).toEqual(['voucher-p']);
    expect(bundle.couponGrants.map((entry) => entry.id)).toEqual(['grant-p']);
    expect(bundle.loyaltyAccounts.map((entry) => entry.id)).toEqual([
      world.person.customerId,
    ]);
    expect(bundle.badgeProgress.length).toBe(
      world.personFootprint.badgeProgress.length,
    );
    expect(bundle.seasonProgress.length).toBe(
      world.personFootprint.seasonProgress.length,
    );
    expect(bundle.clientStats.map((entry) => entry.id)).toEqual([
      world.person.customerId,
    ]);
    expect(bundle.clientMoney.map((entry) => entry.customerId)).toEqual([
      world.person.customerId,
    ]);
    expect(bundle.clientJournal.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(bundle.notifications.map((entry) => entry.id)).toEqual(['note-p-1']);
    expect(bundle.waitlistRequests.map((entry) => entry.id)).toEqual(['wl-p']);
    expect(bundle.invitations.map((entry) => entry.id)).toEqual(['inv-p']);
    expect(bundle.auditLog.map((entry) => entry.id)).toEqual([
      'row-p-record',
      'row-p-account',
      'row-p-party',
    ]);
  });

  it('keeps the person’s own documents as stored — the record, the account, the solo visit’s contact and note', () => {
    const world = privacyWorld();
    const bundle = bundleOf(world.personFootprint);
    expect(bundle.customers).toEqual([world.personFootprint.record]);
    expect(bundle.users).toEqual([world.personFootprint.account]);
    const solo = bundle.appointments.find(
      (entry) => entry.id === world.visits.solo.id,
    );
    expect(solo === undefined ? null : BookingContact.of(solo)).toEqual(
      BookingContact.of(world.visits.solo),
    );
    expect(solo?.seats).toEqual(world.visits.solo.seats);
    expect(bundle.appointmentNotes[0]?.text).toBe(PRIVACY_SENTINELS.note);
    expect(bundle.invitations[0]?.inviterName).toBe(PRIVACY_SENTINELS.name);
  });

  it('a record that links no account exports no `users` and a null account id', () => {
    const bundle = bundleOf(walkInFootprint());
    expect(bundle.users).toEqual([]);
    expect(bundle.exportedUserId).toBeNull();
    expect(bundle.loyaltyAccounts).toEqual([]);
    expect(bundle.clientStats).toEqual([]);
    expect(bundle.clientMoney).toEqual([]);
  });
});

describe('ClientExportSystem — nothing of another person', () => {
  it('a shared visit: the other people’s labels are markers, the contact not provably P’s is NONE', () => {
    const world = privacyWorld();
    const party = bundleOf(noisyFootprint()).appointments.find(
      (entry) => entry.id === world.visits.party.id,
    );
    if (party === undefined) throw new Error('the party was not exported');
    expect(BookingContact.of(party)).toEqual(BookingContact.NONE);
    expect(
      party.seats.map((seat) =>
        'guestLabel' in seat ? seat.guestLabel : seat.subjectCustomerId,
      ),
    ).toEqual([
      world.other.customerId,
      world.person.customerId,
      PrivacyMarker.seatLabel(1),
      PrivacyMarker.seatLabel(2),
    ]);
    // Everything but the redactions is the stored visit.
    expect(party.seats.map((seat) => seat.seatId)).toEqual(
      world.visits.party.seats.map((seat) => seat.seatId),
    );
    expect(party.subjectCustomerIds).toEqual(
      world.visits.party.subjectCustomerIds,
    );
    expect(party.bookingStatus).toBe(world.visits.party.bookingStatus);
  });

  it('no sentinel of Q — name, phone, e-mail, note, labels, voucher code, photo URL — reaches P’s JSON', () => {
    const { json } = exportOf(noisyFootprint());
    for (const value of Object.values(OTHER_SENTINELS)) {
      expect(json).not.toContain(value);
    }
    expect(json).not.toContain('row-q-record');
    expect(json).not.toContain('row-p-acts-on-q');
    expect(json).not.toContain('photo-q-shot');
    expect(json).not.toContain('photo-party-nobody');
    expect(json).not.toContain(WALK_IN_SENTINELS.label);
  });

  it('withholds a party visit’s note — it may hold a companion’s words (P3-RU-33)', () => {
    const { json } = exportOf(noisyFootprint());
    expect(json).not.toContain(OTHER_SENTINELS.note);
    expect(json).toContain(PRIVACY_SENTINELS.note);
  });

  it('W’s export keeps W’s own contact on W’s staff party (the keyed-hash arm) and W’s label, marks the guest', () => {
    const world = privacyWorld();
    const bundle = bundleOf(walkInFootprint());
    const party = bundle.appointments.find(
      (entry) => entry.id === world.visits.walkInParty.id,
    );
    if (party === undefined) throw new Error('the party was not exported');
    expect(BookingContact.of(party)).toEqual(
      BookingContact.of(world.visits.walkInParty),
    );
    expect(
      party.seats.map((seat) =>
        'guestLabel' in seat ? seat.guestLabel : null,
      ),
    ).toEqual([WALK_IN_SENTINELS.label, PrivacyMarker.seatLabel(1)]);
  });

  it('withholds a THIRD person’s contact even on a visit only W sat — never a sole-subject fallback', () => {
    const world = privacyWorld();
    const { json } = exportOf(walkInFootprint());
    const bundle = JSON.parse(json) as ClientExportBundle;
    const alone = bundle.appointments.find(
      (entry) => entry.id === world.visits.walkInThird.id,
    );
    expect(alone === undefined ? null : BookingContact.of(alone)).toEqual(
      BookingContact.NONE,
    );
    expect(json).not.toContain(WALK_IN_SENTINELS.thirdName);
    expect(json).not.toContain(WALK_IN_SENTINELS.thirdPhone);
    expect(alone?.seats).toEqual(world.visits.walkInThird.seats);
  });
});

describe('ClientExportSystem — no bearer capability', () => {
  it('no voucher code anywhere: P’s own vouchers, P’s lines and Q’s line on the party', () => {
    const { json } = exportOf(noisyFootprint());
    expect(json).not.toContain(PRIVACY_SENTINELS.voucherCode);
    expect(json).not.toContain(OTHER_SENTINELS.voucherCode);
    expect(json).not.toContain('"code"');
    const bundle = JSON.parse(json) as ClientExportBundle;
    expect(bundle.giftVouchers[0]).not.toHaveProperty('code');
    for (const visit of bundle.appointments) {
      expect(visit.voucherRedemptions.length).toBe(1);
      for (const line of visit.voucherRedemptions) {
        expect(line).not.toHaveProperty('code');
        expect(line.amountCents).toBe(1000);
      }
    }
  });

  it('no photo URL — every other field of the photo as stored', () => {
    const world = privacyWorld();
    const { json } = exportOf(noisyFootprint());
    expect(json).not.toContain(PRIVACY_SENTINELS.shotUrl);
    expect(json).not.toContain(PRIVACY_SENTINELS.libraryUrl);
    expect(json).not.toContain('"url"');
    const bundle = JSON.parse(json) as ClientExportBundle;
    const library = bundle.appointmentPhotos.find(
      (entry) => entry.id === 'photo-p-library',
    );
    // `toEqual` reads an `undefined` key as absent: every field but the URL.
    expect(library).toEqual({
      ...world.personFootprint.photos[1],
      url: undefined,
    });
    expect(library).not.toHaveProperty('url');
  });
});

describe('ClientExportSystem — deterministic', () => {
  it('the same documents in another order, with duplicates, print byte-identical JSON', () => {
    const footprint = noisyFootprint();
    const shuffled: ClientFootprint = {
      ...footprint,
      record: Object.fromEntries(
        Object.entries(footprint.record).reverse(),
      ) as typeof footprint.record,
      visits: [...footprint.visits].reverse(),
      notes: [...footprint.notes].reverse(),
      photos: [...footprint.photos].reverse(),
      couponGrants: [...footprint.couponGrants, ...footprint.couponGrants],
      badgeProgress: [...footprint.badgeProgress].reverse(),
      seasonProgress: [...footprint.seasonProgress].reverse(),
      journal: [...footprint.journal].reverse(),
      auditRows: [...footprint.auditRows].reverse(),
    };
    expect(exportOf(shuffled).json).toBe(exportOf(footprint).json);
  });

  it('prints the canonical JSON — keys sorted at every depth', () => {
    const { json } = exportOf(noisyFootprint());
    expect(CanonicalJsonSystem.of(JSON.parse(json))).toBe(json);
  });

  it('orders visits newest first, a tie by id; audit rows oldest first, a tie by id', () => {
    const world = privacyWorld();
    const footprint = world.personFootprint;
    const tied = {
      ...world.visits.solo,
      id: AppointmentId.of('appt-p-solo-a'),
      utcEpochMs: world.visits.party.utcEpochMs,
    };
    const bundle = bundleOf({
      ...footprint,
      visits: [world.visits.solo, world.visits.party, tied],
      auditRows: [
        ...footprint.auditRows,
        {
          ...footprint.auditRows[2],
          id: AuditEntryId.of('row-p-party-0'),
        } as (typeof footprint.auditRows)[number],
      ],
    });
    expect(bundle.appointments.map((entry) => entry.id)).toEqual([
      'appt-p-solo-a',
      'appt-q-party',
      'appt-p-solo',
    ]);
    expect(bundle.auditLog.map((entry) => entry.id)).toEqual([
      'row-p-record',
      'row-p-account',
      'row-p-party',
      'row-p-party-0',
    ]);
  });

  it('leaves out the row whose id is the call’s own — a replay answers the same bytes', () => {
    const world = privacyWorld();
    const footprint = world.personFootprint;
    const ownRowId = ownRowIdOf(footprint);
    const ownRow = {
      ...footprint.auditRows[0],
      id: ownRowId,
    } as (typeof footprint.auditRows)[number];
    const replay = {
      ...footprint,
      auditRows: [...footprint.auditRows, ownRow],
    };
    const first = exportOf(footprint);
    const again = exportOf(replay);
    expect(again).toEqual(first);
    expect(again.json).not.toContain(ownRowId);
    expect(ClientExportSystem.documentCount(replay, ownRowId)).toBe(
      ClientExportSystem.documentCount(footprint, ownRowId),
    );
  });
});

describe('ClientExportSystem.exportOf — the cap, never a truncated answer', () => {
  it('counts every document of the bundle, audit rows included', () => {
    const world = privacyWorld();
    const footprint = world.personFootprint;
    const counted = exportOf(footprint);
    const bundle = JSON.parse(counted.json) as ClientExportBundle;
    let documents = 0;
    for (const [key, value] of Object.entries(bundle)) {
      if (Array.isArray(value)) documents += value.length;
      else expect(key).toMatch(/^(clientExportVersion|exported[A-Za-z]+)$/);
    }
    expect(counted.documentCount).toBe(documents);
    expect(counted.auditRowCount).toBe(3);
    expect(counted.byteCount).toBe(
      new TextEncoder().encode(counted.json).length,
    );
    expect(
      ClientExportSystem.documentCount(footprint, ownRowIdOf(footprint)),
    ).toBe(documents);
  });

  it('documents: the cap − 1 and the cap pass; the cap + 1 refuses with its count and no bytes', () => {
    const under = sizedFootprint(EXPORT_MAX_DOCUMENTS - 2);
    const at = sizedFootprint(EXPORT_MAX_DOCUMENTS - 1);
    const over = sizedFootprint(EXPORT_MAX_DOCUMENTS);
    expect(exportOf(under).documentCount).toBe(EXPORT_MAX_DOCUMENTS - 1);
    expect(exportOf(at).documentCount).toBe(EXPORT_MAX_DOCUMENTS);
    expect(
      unwrapErr(
        ClientExportSystem.exportOf(
          over,
          NOW,
          ownRowIdOf(over),
          fixtureWalkInHash,
        ),
      ),
    ).toEqual({
      errorCode: PrivacyErrorCode.ExportTooLarge,
      exportDocumentCount: EXPORT_MAX_DOCUMENTS + 1,
      exportByteCount: 0,
    });
  });

  it('bytes: exactly the cap passes; one byte more refuses with both counts', () => {
    const base = walkInFootprint();
    const named = (length: number): ClientFootprint => ({
      ...base,
      record: { ...base.record, displayName: 'a'.repeat(length) },
    });
    const empty = exportOf(named(0)).byteCount;
    const fits = exportOf(named(EXPORT_MAX_BYTES - empty));
    expect(fits.byteCount).toBe(EXPORT_MAX_BYTES);
    const tooBig = named(EXPORT_MAX_BYTES - empty + 1);
    const refused = unwrapErr(
      ClientExportSystem.exportOf(
        tooBig,
        NOW,
        ownRowIdOf(tooBig),
        fixtureWalkInHash,
      ),
    );
    expect(refused).toEqual({
      errorCode: PrivacyErrorCode.ExportTooLarge,
      exportDocumentCount: fits.documentCount,
      exportByteCount: EXPORT_MAX_BYTES + 1,
    });
    expect(refused).not.toHaveProperty('json');
  });

  it('weighs UTF-8, not code units: a Cyrillic name weighs twice its length', () => {
    const base = walkInFootprint();
    const latin = exportOf({
      ...base,
      record: { ...base.record, displayName: 'aaaa' },
    });
    const cyrillic = exportOf({
      ...base,
      record: { ...base.record, displayName: 'щщщщ' },
    });
    expect(cyrillic.byteCount - latin.byteCount).toBe(4);
  });
});

describe('ClientExportSystem.planClientExported — the one row', () => {
  it('is the exact row: the admin, the record’s resource and target, the operation, counts only', () => {
    const world = privacyWorld();
    const customerId = world.person.customerId;
    const counts = { documentCount: 7, auditRowCount: 3, byteCount: 1234 };
    const plan = ClientExportSystem.planClientExported(
      customerId,
      counts,
      Actor.admin(ADMIN),
      OPERATION,
      NOW,
    );
    expect(plan).toEqual({
      row: {
        recordedAtUtcMs: NOW,
        resourceId: AuditResourceId.forCustomer(customerId),
        auditOperationId: OPERATION,
        ...Actor.admin(ADMIN),
        auditAction: AuditAction.PrivacyClientExported,
        exportDocumentCount: 7,
        exportAuditRowCount: 3,
        exportByteCount: 1234,
        ...AuditTargetRef.customer(customerId),
      },
      idBasis: AuditSystem.rowBasis(
        AuditAction.PrivacyClientExported,
        `customers/${customerId}`,
        customerId,
        `export:${OPERATION}`,
      ),
    });
    expect(plan.idBasis).toBe(
      ClientExportSystem.rowIdBasis(customerId, OPERATION),
    );
    // Its id is the id the call leaves out of its own bundle.
    expect(AuditSystem.createsOf([plan], fixtureHash)[0]?.path).toEqual([
      'auditLog',
      ownRowIdOf(world.personFootprint),
    ]);
  });

  it('holds no value of the person — a PII scan of the serialised row', () => {
    const world = privacyWorld();
    const exported = exportOf(world.personFootprint);
    const row = JSON.stringify(
      ClientExportSystem.planClientExported(
        world.person.customerId,
        exported,
        Actor.admin(ADMIN),
        OPERATION,
        NOW,
      ).row,
    );
    for (const value of Object.values(PRIVACY_SENTINELS)) {
      expect(row).not.toContain(value);
    }
    expect(row).not.toContain('exportJson');
  });

  it('a new operation is a new row; the same operation the same row', () => {
    const customerId = privacyWorld().person.customerId;
    expect(ClientExportSystem.rowIdBasis(customerId, OPERATION)).toBe(
      ClientExportSystem.rowIdBasis(customerId, OPERATION),
    );
    expect(ClientExportSystem.rowIdBasis(customerId, OPERATION)).not.toBe(
      ClientExportSystem.rowIdBasis(
        customerId,
        OperationId.of('op-export-0002'),
      ),
    );
  });
});

describe('ClientExportSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const footprint = deepFreeze(noisyFootprint());
    const ownRowId = ownRowIdOf(footprint);
    const once = ClientExportSystem.exportOf(
      footprint,
      NOW,
      ownRowId,
      fixtureWalkInHash,
    );
    const twice = ClientExportSystem.exportOf(
      footprint,
      NOW,
      ownRowId,
      fixtureWalkInHash,
    );
    expect(twice).toEqual(once);
    expect(
      ClientExportSystem.bundleOf(footprint, NOW, ownRowId, fixtureWalkInHash),
    ).toEqual(
      ClientExportSystem.bundleOf(footprint, NOW, ownRowId, fixtureWalkInHash),
    );
    // The inputs still hold what the redactions left out.
    expect(footprint.visits[1]?.contactName).toBe(OTHER_SENTINELS.name);
    expect(footprint.giftVouchers[0]?.code).toBe(PRIVACY_SENTINELS.voucherCode);
    expect(footprint.photos[0]?.url).toBe(PRIVACY_SENTINELS.shotUrl);
  });

  it('stamps the instant it is handed, never a clock', () => {
    const footprint = privacyWorld().personFootprint;
    const later = UtcEpochMs.plusMs(NOW, 60_000);
    const ownRowId = ownRowIdOf(footprint);
    expect(
      ClientExportSystem.bundleOf(footprint, later, ownRowId, fixtureWalkInHash)
        .exportedAtUtcMs,
    ).toBe(later);
  });
});
