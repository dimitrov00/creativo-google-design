import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  AccountStatus,
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  BirthDate,
  BlockReason,
  BookingContact,
  ErasureCensus,
  ErasureLifecycle,
  ErasureStatus,
  Identifier,
  PhotoOrigin,
  PrivacyMarker,
  Role,
  SeatLabel,
  SeatOccupant,
  SubjectRelationship,
  WriteAction,
  WriteOp,
} from '@core/components';
import { PrivacyError } from '@core/errors';
import {
  AppointmentId,
  AppointmentPhotoId,
  AuditEntryId,
  AuditResourceId,
  CustomerId,
  OperationId,
  OtpId,
  SeatId,
} from '@core/primitives';
import {
  type Appointment,
  type AppointmentNote,
  type AppointmentPhoto,
  Collections,
  type Customer,
  Subcollections,
  type User,
} from '@core/entities';
import {
  appointmentFixture,
  customerFixture,
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  fixtureWalkInHash,
  OTHER_SENTINELS,
  otpFixture,
  PERSONS_PARTY_SELF_SEAT,
  personsParty,
  PRIVACY_SENTINELS,
  privacyWorld,
  seatFixture,
  utcMs,
  WALK_IN_SENTINELS,
  withSeatRemoved,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import {
  ClientErasureSystem,
  ERASURE_CHUNK_SIZE,
  ERASURE_MAX_DOCUMENTS,
  type ErasureFootprint,
} from './client-erasure.system';
import {
  type ClientPerson,
  ClientPrivacySystem,
} from './client-privacy.system';
import { SearchFieldsSystem } from './search-fields.system';

/* The erasure's pure half (audit-hardening Phase 3 WS-D, P3-RU-20…P3-RU-25,
 * P3-L-7…P3-L-22) — over the privacy world of `@core/testing` (P an account
 * and its record, Q another account who owns a party P sits on, W a walk-in
 * whose staff party carries W's own contact; every personal value a
 * SENTINEL, so a scan of the serialised writes proves its absence). */

const world = privacyWorld();
const P = world.person.customerId;
const P_USER = world.person.userId;
const Q = world.other.customerId;
const W = world.walkIn.customerId;
const OPERATION = OperationId.of('op-erase-0001');
const ADMIN = Actor.admin(world.admin);
const STARTED = utcMs('2026-09-20T10:00:00.000+03:00');

function personOf(customerId: CustomerId): ClientPerson {
  const record = world.state.records.find((entry) => entry.id === customerId);
  if (record === undefined) throw new Error(`no fixture record ${customerId}`);
  const account =
    world.state.users.find((user) => user.id === record.userId) ?? null;
  return { record, account };
}

/** P's footprint exactly as the erasure reads it (the visits, EVERY visit's note, both photo reads). */
function pFootprint(): ErasureFootprint {
  const footprint = world.personFootprint;
  return {
    person: personOf(P),
    visits: footprint.visits,
    notes: world.state.notes.filter(
      (note) =>
        note.id === world.visits.solo.id || note.id === world.visits.party.id,
    ),
    photos: footprint.photos,
    notifications: footprint.notifications,
    waitlistRequests: footprint.waitlistRequests,
    invitations: footprint.invitations,
    sessions: world.state.sessions.filter(
      (session) => session.targetUserId === P_USER,
    ),
    journalCount: footprint.journal.length,
  };
}

/** W's footprint: the staff party `[WALK_IN W, ANONYMOUS]` and the visit W sat alone (a third person's contact). */
function wFootprint(): ErasureFootprint {
  return {
    person: personOf(W),
    visits: [world.visits.walkInParty, world.visits.walkInThird],
    notes: [],
    photos: [],
    notifications: [],
    waitlistRequests: [],
    invitations: [],
    sessions: [],
    journalCount: 0,
  };
}

/** A record after the stamp: the marker name, no contact, no search keys, at `lifecycle`. */
function strippedRecord(base: Customer, lifecycle: ErasureLifecycle): Customer {
  return {
    ...base,
    displayName: PrivacyMarker.TEXT,
    phone: null,
    email: null,
    searchName: '',
    searchPrefixes: [],
    ...lifecycle,
  } as Customer;
}

/** An account after the stamp: the marker names, nothing else personal, `ERASED`. */
function strippedAccount(base: User): User {
  return {
    ...base,
    firstName: PrivacyMarker.TEXT,
    lastName: PrivacyMarker.TEXT,
    phone: null,
    email: null,
    birthDate: null,
    searchName: null,
    searchPrefixes: [],
    profileEditedAtUtcMs: null,
    ...AccountLifecycle.erase(STARTED),
  } as User;
}

/** Every personal value a scan must not find — the voucher code is money, kept by design. */
function sentinelsOf(...sets: readonly Record<string, string>[]): string[] {
  const out: string[] = [];
  for (const set of sets) {
    for (const [key, value] of Object.entries(set)) {
      if (key !== 'voucherCode') out.push(value);
    }
  }
  return out;
}

function expectNoSentinel(value: unknown, sentinels: readonly string[]): void {
  const json = JSON.stringify(value);
  for (const sentinel of sentinels) expect(json).not.toContain(sentinel);
}

const EXPECTED_P_CENSUS: ErasureCensus = {
  erasureRecordCount: 1,
  erasureAccountCount: 1,
  erasureContactCount: 1,
  erasureLabelCount: 0,
  erasureNoteCount: 2,
  erasurePhotoCount: 3,
  erasureDocumentCount: 2,
  erasurePseudonymCount: 2,
  erasureVisitCount: 2,
  erasureContactKeptCount: 1,
  erasureJournalCount: 2,
};

describe('ClientErasureSystem — the constants', () => {
  it('a visit chunk stays far below a commit’s 500 operations; the cap is 5 000 per list', () => {
    expect(ERASURE_CHUNK_SIZE).toBe(25);
    expect(2 * ERASURE_CHUNK_SIZE + 1).toBeLessThan(500);
    expect(ERASURE_MAX_DOCUMENTS).toBe(5_000);
  });
});

describe('ClientErasureSystem.underErasureAmong — the guard of every writer (P3-RU-20)', () => {
  const none = customerFixture({ id: CustomerId.of('cus_none') });
  const erasing = customerFixture({
    id: CustomerId.of('cus_erasing'),
    ...ErasureLifecycle.begin(STARTED),
  });
  const erased = customerFixture({
    id: CustomerId.of('cus_erased'),
    ...ErasureLifecycle.complete(
      ErasureLifecycle.begin(STARTED),
      FIXTURE_NOW_UTC_MS,
    ),
  });
  const stored = new Map<CustomerId, Customer | null>([
    [none.id, none],
    [erasing.id, erasing],
    [erased.id, erased],
    [CustomerId.of('cus_absent'), null],
  ]);

  it('catches ERASING and ERASED, passes NONE, ignores an absent record (one to create) and an id the read set lacks', () => {
    expect(
      ClientErasureSystem.underErasureAmong(
        [
          none.id,
          erasing.id,
          CustomerId.of('cus_absent'),
          erased.id,
          CustomerId.of('cus_unread'),
        ],
        stored,
      ),
    ).toEqual([erasing.id, erased.id]);
    expect(ClientErasureSystem.underErasureAmong([none.id], stored)).toEqual(
      [],
    );
    expect(ClientErasureSystem.underErasureAmong([], stored)).toEqual([]);
  });

  it('names each id once, in the order given, from any iterable', () => {
    expect(
      ClientErasureSystem.underErasureAmong(
        new Set([erased.id, erasing.id]).values(),
        stored,
      ),
    ).toEqual([erased.id, erasing.id]);
    expect(
      ClientErasureSystem.underErasureAmong([erasing.id, erasing.id], stored),
    ).toEqual([erasing.id]);
  });
});

describe('ClientErasureSystem.refusalOf — who may not be erased (P3-L-9, P3-L-16)', () => {
  const pRecord = personOf(P).record;
  const pAccount = personOf(P).account;
  if (pAccount === null) throw new Error('P has an account');

  it('a client account and a walk-in with no account pass', () => {
    expect(
      ClientErasureSystem.refusalOf(personOf(P), [Role.Client], fixtureHash),
    ).toBeNull();
    expect(
      ClientErasureSystem.refusalOf(personOf(P), null, fixtureHash),
    ).toBeNull();
    expect(
      ClientErasureSystem.refusalOf(personOf(W), null, fixtureHash),
    ).toBeNull();
  });

  it.each([
    Role.Barber,
    Role.Receptionist,
    Role.ContentManager,
    Role.Admin,
    Role.Sysadmin,
  ])(
    'a staff role (%s) in the STORED account → PRIVACY_ERASURE_STAFF_ACCOUNT',
    (role) => {
      const person: ClientPerson = {
        record: pRecord,
        account: { ...pAccount, roles: [Role.Client, role] },
      };
      expect(
        ClientErasureSystem.refusalOf(person, [Role.Client], fixtureHash),
      ).toEqual(PrivacyError.erasureStaffAccount());
    },
  );

  it.each([Role.Barber, Role.Receptionist, Role.Admin, Role.Sysadmin])(
    'a staff role (%s) ONLY in the Auth claims, with no users document → refused all the same',
    (role) => {
      const person: ClientPerson = { record: pRecord, account: null };
      expect(
        ClientErasureSystem.refusalOf(person, [role], fixtureHash),
      ).toEqual(PrivacyError.erasureStaffAccount());
    },
  );

  it('a linked uid with NO users document while its Auth user exists → refused (P3-DEP-29: production never sets custom claims, so nothing proves it no operator’s)', () => {
    const person: ClientPerson = { record: pRecord, account: null };
    // Production's shape: an Auth user with no custom claims.
    expect(ClientErasureSystem.refusalOf(person, [], fixtureHash)).toEqual(
      PrivacyError.erasureStaffAccount(),
    );
    expect(
      ClientErasureSystem.refusalOf(person, [Role.Client], fixtureHash),
    ).toEqual(PrivacyError.erasureStaffAccount());
  });

  it('a linked uid with no users document AND no Auth user → passes (nothing to delete)', () => {
    const person: ClientPerson = { record: pRecord, account: null };
    expect(ClientErasureSystem.refusalOf(person, null, fixtureHash)).toBeNull();
  });

  it('a userId the record id does not derive from → PRIVACY_ACCOUNT_LINK_MISMATCH, before any staff check', () => {
    const corrupt: ClientPerson = {
      record: { ...pRecord, userId: world.other.userId },
      account: null,
    };
    expect(
      ClientErasureSystem.refusalOf(corrupt, [Role.Admin], fixtureHash),
    ).toEqual(PrivacyError.accountLinkMismatch());
    // A walk-in record whose userId was set by hand is no provable link either.
    const walkIn: ClientPerson = {
      record: { ...personOf(W).record, userId: P_USER },
      account: null,
    };
    expect(ClientErasureSystem.refusalOf(walkIn, null, fixtureHash)).toEqual(
      PrivacyError.accountLinkMismatch(),
    );
  });
});

describe('ClientPrivacySystem.contactValuesOf / otpWrites — the challenges swept before the stamp (P3-RU-21)', () => {
  it('the record’s and the account’s contact values, each once, in order', () => {
    expect(ClientPrivacySystem.contactValuesOf(personOf(P))).toEqual([
      Identifier.of(PRIVACY_SENTINELS.phone),
      Identifier.of(PRIVACY_SENTINELS.email),
    ]);
    expect(ClientPrivacySystem.contactValuesOf(personOf(W))).toEqual([
      Identifier.of(WALK_IN_SENTINELS.phone),
    ]);
  });

  it('nothing once the stamp cleared them', () => {
    const p = personOf(P);
    const account = p.account;
    if (account === null) throw new Error('P has an account');
    expect(
      ClientPrivacySystem.contactValuesOf({
        record: strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
        account: strippedAccount(account),
      }),
    ).toEqual([]);
  });

  it('each challenge removed once', () => {
    const otp = otpFixture({ id: OtpId.of('otp-a') });
    expect(
      ClientErasureSystem.otpWrites([
        otp,
        otpFixture({ id: OtpId.of('otp-b') }),
        otp,
      ]),
    ).toEqual([
      WriteOp.remove([Collections.Otps, 'otp-a']),
      WriteOp.remove([Collections.Otps, 'otp-b']),
    ]);
  });
});

describe('ClientErasureSystem.census — what still holds a personal value (P3-RU-22)', () => {
  it('counts each of the eleven fields over P’s footprint', () => {
    expect(ClientErasureSystem.census(pFootprint(), fixtureWalkInHash)).toEqual(
      EXPECTED_P_CENSUS,
    );
  });

  it('a staff party [WALK_IN W, ANONYMOUS] with no owner carries W’s contact (the keyed-hash arm); W’s labels count', () => {
    expect(ClientErasureSystem.census(wFootprint(), fixtureWalkInHash)).toEqual(
      {
        ...ErasureCensus.EMPTY,
        erasureRecordCount: 1,
        // the staff party (keyed-hash arm) and the visit W sat alone (sole-subject)
        erasureContactCount: 2,
        erasureLabelCount: 2,
        erasureVisitCount: 2,
      },
    );
  });

  it('a marker name is no personal value — the stripped record and account count 0', () => {
    const p = personOf(P);
    const account = p.account;
    if (account === null) throw new Error('P has an account');
    const census = ClientErasureSystem.census(
      {
        ...pFootprint(),
        person: {
          record: strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
          account: strippedAccount(account),
        },
      },
      fixtureWalkInHash,
    );
    expect(census.erasureRecordCount).toBe(0);
    expect(census.erasureAccountCount).toBe(0);
  });

  it('a stub with null names but a contact, or a search key alone, still holds a personal value', () => {
    const p = personOf(P);
    const account = p.account;
    if (account === null) throw new Error('P has an account');
    const cases: readonly User[] = [
      {
        ...strippedAccount(account),
        firstName: null,
        lastName: null,
        phone: PRIVACY_SENTINELS.phone,
      },
      { ...strippedAccount(account), searchName: 'x' },
      { ...strippedAccount(account), searchPrefixes: ['abc'] },
      { ...strippedAccount(account), birthDate: BirthDate.of('1990-01-01') },
    ];
    for (const user of cases) {
      expect(
        ClientErasureSystem.census(
          { ...pFootprint(), person: { record: p.record, account: user } },
          fixtureWalkInHash,
        ).erasureAccountCount,
      ).toBe(1);
    }
  });

  it('only the person’s visits count — a visit that does not seat them, and its note, are none of theirs', () => {
    const census = ClientErasureSystem.census(
      {
        ...pFootprint(),
        visits: [...pFootprint().visits, world.visits.walkInParty],
        notes: [
          ...pFootprint().notes,
          {
            ...pFootprint().notes[0],
            id: world.visits.walkInParty.id,
          } as AppointmentNote,
        ],
      },
      fixtureWalkInHash,
    );
    expect(census).toEqual(EXPECTED_P_CENSUS);
  });

  it('a visit found by P’s contact value that no longer seats P (a staff edit removed P’s seat): its contact counts, nothing else of it (P3-DEP-28)', () => {
    const removed = withSeatRemoved(
      personsParty(world),
      PERSONS_PARTY_SELF_SEAT,
    );
    const census = ClientErasureSystem.census(
      {
        ...pFootprint(),
        visits: [...pFootprint().visits, removed],
        notes: [
          ...pFootprint().notes,
          { ...pFootprint().notes[0], id: removed.id } as AppointmentNote,
        ],
      },
      fixtureWalkInHash,
    );
    expect(census).toEqual({
      ...EXPECTED_P_CENSUS,
      erasureContactCount: EXPECTED_P_CENSUS.erasureContactCount + 1,
    });
    // Its contact cleared by the sweep, the census finds nothing of it.
    expect(
      ClientErasureSystem.census(
        {
          ...pFootprint(),
          visits: [
            ...pFootprint().visits,
            { ...removed, ...BookingContact.NONE },
          ],
        },
        fixtureWalkInHash,
      ),
    ).toEqual(EXPECTED_P_CENSUS);
  });

  it('counts a document met by two reads once', () => {
    const footprint = pFootprint();
    expect(
      ClientErasureSystem.census(
        {
          ...footprint,
          visits: [...footprint.visits, ...footprint.visits],
          notes: [...footprint.notes, ...footprint.notes],
          notifications: [
            ...footprint.notifications,
            ...footprint.notifications,
          ],
        },
        fixtureWalkInHash,
      ),
    ).toEqual(EXPECTED_P_CENSUS);
  });

  it('a record that links no account counts no loose document', () => {
    expect(
      ClientErasureSystem.census(
        {
          ...wFootprint(),
          notifications: pFootprint().notifications,
          waitlistRequests: pFootprint().waitlistRequests,
          invitations: pFootprint().invitations,
          sessions: pFootprint().sessions,
        },
        fixtureWalkInHash,
      ),
    ).toEqual(ClientErasureSystem.census(wFootprint(), fixtureWalkInHash));
  });
});

describe('ClientErasureSystem.isComplete / hasResidue — over the PERSONAL counts only', () => {
  it('every personal count 0 is complete, whatever is retained', () => {
    const retained: ErasureCensus = {
      ...ErasureCensus.EMPTY,
      erasureVisitCount: 12,
      erasureContactKeptCount: 3,
      erasureJournalCount: 40,
    };
    expect(ClientErasureSystem.isComplete(retained)).toBe(true);
    expect(ClientErasureSystem.hasResidue(retained)).toBe(false);
    expect(ClientErasureSystem.isComplete(ErasureCensus.EMPTY)).toBe(true);
  });

  it.each(ErasureCensus.PERSONAL_FIELDS)('one %s left is residue', (field) => {
    const residue: ErasureCensus = { ...ErasureCensus.EMPTY, [field]: 1 };
    expect(ClientErasureSystem.isComplete(residue)).toBe(false);
    expect(ClientErasureSystem.hasResidue(residue)).toBe(true);
  });
});

describe('ClientErasureSystem.stampWrites — the FIRST commit (P3-RU-21)', () => {
  const p = personOf(P);
  const account = p.account;
  if (account === null) throw new Error('P has an account');
  const stamp = (person: ClientPerson = p) =>
    ClientErasureSystem.stampWrites(
      person,
      EXPECTED_P_CENSUS,
      ADMIN,
      OPERATION,
      STARTED,
      fixtureHash,
    );
  const startedRow = () => {
    const resourceId = AuditResourceId.forCustomer(P);
    return WriteOp.create(
      [
        Collections.AuditLog,
        AuditEntryId.of(
          fixtureHash(
            AuditSystem.rowBasis(
              AuditAction.PrivacyClientErasureStarted,
              resourceId,
              P,
              `erasure-start:${P}`,
            ),
          ),
        ),
      ],
      {
        recordedAtUtcMs: STARTED,
        resourceId,
        auditOperationId: OPERATION,
        ...ADMIN,
        ...AuditContext.clientErasure(
          AuditAction.PrivacyClientErasureStarted,
          EXPECTED_P_CENSUS,
        ),
        ...AuditTargetRef.customer(P),
      },
    );
  };

  it('clears the record (ERASING), the account (ERASED) and plans the STARTED row with the census BEFORE — exactly', () => {
    expect(stamp()).toEqual([
      WriteOp.transition(
        [Collections.Customers, P],
        {
          displayName: PrivacyMarker.TEXT,
          phone: null,
          email: null,
          ...SearchFieldsSystem.searchFields(null, null, null, null),
          writeOperationId: OPERATION,
          erasureStatus: ErasureStatus.Erasing,
          erasureStartedAtUtcMs: STARTED,
        },
        [],
      ),
      WriteOp.transition(
        [Collections.Users, P_USER],
        {
          firstName: PrivacyMarker.TEXT,
          lastName: PrivacyMarker.TEXT,
          phone: null,
          email: null,
          birthDate: null,
          searchName: null,
          searchPrefixes: [],
          profileEditedAtUtcMs: null,
          accountStatus: AccountStatus.Erased,
          accountErasedAtUtcMs: STARTED,
        },
        [],
      ),
      startedRow(),
    ]);
    // The record's search keys are those of no name and no contact.
    expect(SearchFieldsSystem.searchFields(null, null, null, null)).toEqual({
      searchName: '',
      searchPrefixes: [],
    });
  });

  it('a BLOCKED account’s move deletes the block’s fields; the roles are never touched', () => {
    const blocked: User = {
      ...account,
      ...AccountLifecycle.block(BlockReason.Manual, null),
    } as User;
    const writes = stamp({ record: p.record, account: blocked });
    const accountWrite = writes[1];
    expect(accountWrite?.writeAction).toBe(WriteAction.Update);
    if (accountWrite?.writeAction !== WriteAction.Update) return;
    expect(accountWrite.deleteFields).toEqual([
      'blockReason',
      'blockedUntilUtcMs',
    ]);
    expect(accountWrite.fields).not.toHaveProperty('roles');
  });

  it('a record with no account document (a walk-in, or a missing users doc) clears the record alone', () => {
    const writes = stamp({ record: p.record, account: null });
    expect(writes.map((op) => op.path[0])).toEqual([
      Collections.Customers,
      Collections.AuditLog,
    ]);
  });

  it.each([
    ['ERASING', ErasureLifecycle.begin(STARTED)],
    [
      'ERASED',
      ErasureLifecycle.complete(
        ErasureLifecycle.begin(STARTED),
        FIXTURE_NOW_UTC_MS,
      ),
    ],
  ] as const)('plans nothing for a record already %s', (_status, lifecycle) => {
    expect(
      stamp({
        record: strippedRecord(p.record, lifecycle),
        account: strippedAccount(account),
      }),
    ).toEqual([]);
  });

  it('holds no personal value — the census, ids and tags only', () => {
    expectNoSentinel(stamp(), sentinelsOf(PRIVACY_SENTINELS));
  });
});

describe('ClientErasureSystem.visitWrites — one visit’s patch (P3-L-12, P3-RU-33)', () => {
  const p = personOf(P);
  const w = personOf(W);
  const soloNote = world.state.notes.find(
    (note) => note.id === world.visits.solo.id,
  ) as AppointmentNote;
  const partyNote = world.state.notes.find(
    (note) => note.id === world.visits.party.id,
  ) as AppointmentNote;
  const patch = (
    visit: Appointment,
    note: AppointmentNote | null,
    person: ClientPerson,
  ) =>
    ClientErasureSystem.visitWrites(
      visit,
      note,
      person,
      OPERATION,
      fixtureWalkInHash,
    );

  it('a solo visit: the contact cleared, the note removed, the visit stamped with the erasure’s id', () => {
    expect(patch(world.visits.solo, soloNote, p)).toEqual([
      WriteOp.update([Collections.Appointments, world.visits.solo.id], {
        ...BookingContact.NONE,
        writeOperationId: OPERATION,
      }),
      WriteOp.remove([Collections.AppointmentNotes, world.visits.solo.id]),
    ]);
  });

  it('a party another owns: the contact kept (not provably P’s), P’s account seat untouched, its note REMOVED (P3-RU-33)', () => {
    expect(patch(world.visits.party, partyNote, p)).toEqual([
      WriteOp.remove([Collections.AppointmentNotes, world.visits.party.id]),
    ]);
  });

  it('a staff party [WALK_IN W, ANONYMOUS] with no owner: W’s contact cleared by the keyed-hash arm, W’s label → — 1, the guest kept', () => {
    const visit = world.visits.walkInParty;
    const [wSeat, guest] = visit.seats;
    expect(patch(visit, null, w)).toEqual([
      WriteOp.update([Collections.Appointments, visit.id], {
        ...BookingContact.NONE,
        seats: [{ ...wSeat, guestLabel: PrivacyMarker.seatLabel(1) }, guest],
        writeOperationId: OPERATION,
      }),
    ]);
  });

  it('a visit W sat alone carrying a THIRD person’s contact: cleared all the same (the erasure errs to clearing)', () => {
    const writes = patch(world.visits.walkInThird, null, w);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      writeAction: WriteAction.Update,
      fields: { ...BookingContact.NONE, writeOperationId: OPERATION },
    });
  });

  it('a party Q owns with TWO of W’s walk-in seats: Q’s contact kept, W’s labels → — 1, — 2', () => {
    const qSeat = seatFixture({
      seatId: SeatId.of('seat-q'),
      occupant: SeatOccupant.account(
        world.other.userId,
        Q,
        SubjectRelationship.Self,
      ),
    });
    const w1 = seatFixture({
      seatId: SeatId.of('seat-w-1'),
      occupant: SeatOccupant.walkIn(W, SeatLabel.of(WALK_IN_SENTINELS.label)),
    });
    const w2 = seatFixture({
      seatId: SeatId.of('seat-w-2'),
      occupant: SeatOccupant.walkIn(W, SeatLabel.of('Walkin Second')),
    });
    const visit = appointmentFixture({
      id: AppointmentId.of('appt-q-two-w'),
      ownerUserId: world.other.userId,
      ownerCustomerId: Q,
      subjectUserIds: [world.other.userId],
      subjectCustomerIds: [Q, W].sort(),
      seats: [qSeat, w1, w2],
      contactName: OTHER_SENTINELS.name,
      contactPhone: OTHER_SENTINELS.phone,
    });
    expect(patch(visit, null, w)).toEqual([
      WriteOp.update([Collections.Appointments, visit.id], {
        seats: [
          qSeat,
          { ...w1, guestLabel: PrivacyMarker.seatLabel(1) },
          { ...w2, guestLabel: PrivacyMarker.seatLabel(2) },
        ],
        writeOperationId: OPERATION,
      }),
    ]);
  });

  it('a mark another erasure left on the visit is never reused — labels stay unique per visit', () => {
    const other = seatFixture({
      seatId: SeatId.of('seat-other'),
      occupant: SeatOccupant.walkIn(
        CustomerId.of('cus_other_walk_in'),
        PrivacyMarker.seatLabel(1),
      ),
    });
    const mine = seatFixture({
      seatId: SeatId.of('seat-mine'),
      occupant: SeatOccupant.walkIn(W, SeatLabel.of(WALK_IN_SENTINELS.label)),
    });
    const visit = appointmentFixture({
      id: AppointmentId.of('appt-two-walk-ins'),
      ownerUserId: null,
      ownerCustomerId: null,
      subjectUserIds: [],
      subjectCustomerIds: [CustomerId.of('cus_other_walk_in'), W].sort(),
      seats: [other, mine],
    });
    const [write] = patch(visit, null, w);
    expect(write).toMatchObject({
      fields: {
        seats: [
          { guestLabel: PrivacyMarker.seatLabel(1) },
          { guestLabel: PrivacyMarker.seatLabel(2) },
        ],
      },
    });
  });

  it('an already-clean visit plans nothing (idempotent); a visit that does not seat the person plans nothing', () => {
    const cleaned: Appointment = {
      ...world.visits.solo,
      ...BookingContact.NONE,
    };
    expect(patch(cleaned, null, p)).toEqual([]);
    const [wSeat, guest] = world.visits.walkInParty.seats;
    const wCleaned: Appointment = {
      ...world.visits.walkInParty,
      ...BookingContact.NONE,
      seats: [
        { ...wSeat, guestLabel: PrivacyMarker.seatLabel(1) },
        guest,
      ] as Appointment['seats'],
    };
    expect(patch(wCleaned, null, w)).toEqual([]);
    expect(patch(world.visits.walkInParty, null, p)).toEqual([]);
    // A note that is not this visit's is never removed through it.
    expect(patch(cleaned, partyNote, p)).toEqual([]);
  });

  it('holds no personal value of the person', () => {
    const writes = [
      ...patch(world.visits.solo, soloNote, p),
      ...patch(world.visits.party, partyNote, p),
    ];
    expectNoSentinel(writes, sentinelsOf(PRIVACY_SENTINELS));
    expectNoSentinel(
      [
        ...patch(world.visits.walkInParty, null, w),
        ...patch(world.visits.walkInThird, null, w),
      ],
      [WALK_IN_SENTINELS.label, WALK_IN_SENTINELS.phone],
    );
  });
});

describe('ClientErasureSystem.contactSweepWrites — the contacts swept BEFORE the stamp (P3-DEP-28, P3-DEP-34)', () => {
  const p = personOf(P);
  const w = personOf(W);
  const sweep = (visit: Appointment, person: ClientPerson) =>
    ClientErasureSystem.contactSweepWrites(visit, person, OPERATION);
  const cleared = (visit: Appointment) => [
    WriteOp.update([Collections.Appointments, visit.id], {
      ...BookingContact.NONE,
      writeOperationId: OPERATION,
    }),
  ];
  // P booked [SELF P, COMPANION Q]; the desk removed P's seat — the edit
  // pipeline's own write (`AppointmentIndexSystem.withQueryKeys`).
  const removed = withSeatRemoved(personsParty(world), PERSONS_PARTY_SELF_SEAT);

  it('a visit that no longer seats P but carries P’s contact: cleared to NONE under the erasure’s id — which visitWrites never reaches', () => {
    expect(removed.subjectCustomerIds).not.toContain(P);
    expect(sweep(removed, p)).toEqual(cleared(removed));
    expect(
      ClientErasureSystem.visitWrites(
        removed,
        null,
        p,
        OPERATION,
        fixtureWalkInHash,
      ),
    ).toEqual([]);
  });

  it('a staff party [WALK_IN W, ANONYMOUS] whose W seat was removed: W’s contact swept the same way', () => {
    const left = withSeatRemoved(world.visits.walkInParty, SeatId.of('seat-w'));
    expect(left.subjectCustomerIds).toEqual([]);
    expect(sweep(left, w)).toEqual(cleared(left));
  });

  it('P seated on a party another owns, P’s phone as its contact: swept — after the stamp no id would recognise it', () => {
    const shared: Appointment = {
      ...world.visits.party,
      contactName: PRIVACY_SENTINELS.name,
      contactPhone: PRIVACY_SENTINELS.phone,
      contactEmail: null,
    };
    expect(sweep(shared, p)).toEqual(cleared(shared));
  });

  it('a SEATED visit whose ids prove the contact P’s and which carries P’s value is swept too — a seat removed after the stamp would leave it unfindable (P3-DEP-34)', () => {
    // P's own party [SELF P, COMPANION Q]: P owns it, its contact is P's.
    const party = personsParty(world);
    expect(party.subjectCustomerIds).toContain(P);
    expect(
      ClientPrivacySystem.contactProvedById(party, p, fixtureWalkInHash),
    ).toBe(true);
    expect(sweep(party, p)).toEqual(cleared(party));
    // P's own solo visit and W's staff party (the walk-in key proves it) alike.
    expect(sweep(world.visits.solo, p)).toEqual(cleared(world.visits.solo));
    expect(sweep(world.visits.walkInParty, w)).toEqual(
      cleared(world.visits.walkInParty),
    );
  });

  it('nothing for a contact that carries none of the person’s values, no contact, or once the values are gone', () => {
    // Q's contact on Q's party, for P.
    expect(sweep(world.visits.party, p)).toEqual([]);
    // A visit W sat alone carrying a THIRD person's contact: visitWrites'
    // after the stamp (sole-subject), never the sweep's.
    expect(sweep(world.visits.walkInThird, w)).toEqual([]);
    expect(sweep({ ...removed, ...BookingContact.NONE }, p)).toEqual([]);
    const account = p.account;
    if (account === null) throw new Error('P has an account');
    const stripped: ClientPerson = {
      record: strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
      account: strippedAccount(account),
    };
    expect(sweep(removed, stripped)).toEqual([]);
    expect(sweep(personsParty(world), stripped)).toEqual([]);
  });

  it('holds no personal value; is pure — same input, same output, inputs untouched', () => {
    const frozen = deepFreeze(
      withSeatRemoved(personsParty(world), PERSONS_PARTY_SELF_SEAT),
    );
    const person = deepFreeze(personOf(P));
    const once = sweep(frozen, person);
    expect(sweep(frozen, person)).toEqual(once);
    expect(frozen).toEqual(removed);
    expectNoSentinel(once, sentinelsOf(PRIVACY_SENTINELS));
  });
});

describe('ClientErasureSystem.sweepRowWrites — the sweep’s ONE row, inside its commit (P3-DEP-33)', () => {
  const p = personOf(P);
  const before = ClientErasureSystem.census(pFootprint(), fixtureWalkInHash);
  const row = (
    record: Customer,
    census: ErasureCensus,
    rowPresent: boolean,
    sweepWriteCount: number,
  ) =>
    ClientErasureSystem.sweepRowWrites(
      record,
      census,
      rowPresent,
      sweepWriteCount,
      ADMIN,
      OPERATION,
      FIXTURE_NOW_UTC_MS,
      fixtureHash,
    );

  it('ONE SWEPT row holding the census BEFORE, credited to the admin, the record its target, keyed by the act', () => {
    const resourceId = AuditResourceId.forCustomer(P);
    expect(row(p.record, before, false, 3)).toEqual([
      WriteOp.create(
        [
          Collections.AuditLog,
          AuditEntryId.of(
            fixtureHash(ClientErasureSystem.sweepRowIdBasis(P, OPERATION)),
          ),
        ],
        {
          recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
          resourceId,
          auditOperationId: OPERATION,
          ...ADMIN,
          ...AuditContext.clientErasure(
            AuditAction.PrivacyClientErasureSwept,
            before,
          ),
          ...AuditTargetRef.customer(P),
        },
      ),
    ]);
    expect(ClientErasureSystem.sweepRowIdBasis(P, OPERATION)).toBe(
      AuditSystem.rowBasis(
        AuditAction.PrivacyClientErasureSwept,
        resourceId,
        P,
        `erasure-sweep:${OPERATION}`,
      ),
    );
    // Never the re-sweep's row of the same act.
    expect(ClientErasureSystem.sweepRowIdBasis(P, OPERATION)).not.toBe(
      ClientErasureSystem.resweepRowIdBasis(P, OPERATION),
    );
  });

  it('[] with the row already present (a later chunk, a resumed call), when the commit clears nothing, or for a record that is not NONE', () => {
    expect(row(p.record, before, true, 3)).toEqual([]);
    expect(row(p.record, before, false, 0)).toEqual([]);
    expect(
      row(
        strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
        before,
        false,
        3,
      ),
    ).toEqual([]);
    expect(
      row(
        strippedRecord(
          p.record,
          ErasureLifecycle.complete(ErasureLifecycle.begin(STARTED), STARTED),
        ),
        before,
        false,
        3,
      ),
    ).toEqual([]);
  });

  it('another act is another row', () => {
    const other = ClientErasureSystem.sweepRowWrites(
      p.record,
      before,
      false,
      1,
      ADMIN,
      OperationId.of('op-erase-0002'),
      FIXTURE_NOW_UTC_MS,
      fixtureHash,
    );
    expect(other[0]?.path).not.toEqual(
      row(p.record, before, false, 1)[0]?.path,
    );
  });

  it('holds no personal value — the census, ids and tags only; is pure', () => {
    const record = deepFreeze(p.record);
    const census = deepFreeze(before);
    const once = row(record, census, false, 2);
    expect(row(record, census, false, 2)).toEqual(once);
    expect(record).toEqual(p.record);
    expect(census).toEqual(before);
    expectNoSentinel(once, sentinelsOf(PRIVACY_SENTINELS, OTHER_SENTINELS));
  });
});

describe('ClientErasureSystem.photoPlan — objects first, documents after (P3-L-10, P3-L-11)', () => {
  const sole = new Set([world.visits.solo.id]);
  const byId = (id: string) =>
    world.state.photos.find((photo) => photo.id === id) as AppointmentPhoto;

  it('P’s shot, P’s library picture on Q’s party and the photo naming nobody on P’s solo visit — the SHOT objects listed first, each document once', () => {
    const plan = ClientErasureSystem.photoPlan(
      world.state.photos,
      sole,
      personOf(P),
    );
    expect(plan.objectPaths).toEqual([
      byId('photo-p-shot').path,
      byId('photo-p-nobody').path,
    ]);
    expect(plan.writes).toEqual([
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-shot']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-library']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-nobody']),
    ]);
    // The library picture's object is the shop's: its document goes, its
    // bytes stay — its `clientLabel` metadata cleared first (P3-DEP-31).
    expect(byId('photo-p-library').photoOrigin).toBe(PhotoOrigin.Library);
    expect(plan.objectPaths).not.toContain(byId('photo-p-library').path);
    expect(plan.labelPaths).toEqual([byId('photo-p-library').path]);
  });

  it('a SHOT document naming P whose path is not its own object — the shop’s media, another’s avatar, another visit’s shot, empty: the document goes, Storage is never handed the path (P3-DEP-30)', () => {
    const forged = (id: string, path: string): AppointmentPhoto => ({
      ...byId('photo-p-shot'),
      id: AppointmentPhotoId.of(id),
      path,
    });
    const photos = [
      forged('photo-forged-media', 'media/services/cover.jpg'),
      forged('photo-forged-avatar', 'avatars/u-other/original'),
      forged('photo-forged-shot', byId('photo-q-shot').path),
      forged('photo-forged-empty', ''),
      byId('photo-p-shot'),
    ];
    const plan = ClientErasureSystem.photoPlan(photos, sole, personOf(P));
    expect(plan.objectPaths).toEqual([
      `${Collections.AppointmentPhotos}/${world.visits.solo.id}/photo-p-shot`,
    ]);
    expect(plan.labelPaths).toEqual([]);
    expect(plan.writes).toEqual([
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-forged-media']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-forged-avatar']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-forged-shot']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-forged-empty']),
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-shot']),
    ]);
  });

  it('a LIBRARY document with an empty path names no object: its document goes, no label is cleared', () => {
    const plan = ClientErasureSystem.photoPlan(
      [{ ...byId('photo-p-library'), path: '' }],
      sole,
      personOf(P),
    );
    expect(plan).toEqual({
      objectPaths: [],
      labelPaths: [],
      writes: [
        WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-library']),
      ],
    });
  });

  it('Q’s photo and the photo naming nobody on a shared visit are kept; a photo met twice is planned once', () => {
    const plan = ClientErasureSystem.photoPlan(
      [
        byId('photo-q-shot'),
        byId('photo-party-nobody'),
        byId('photo-p-shot'),
        byId('photo-p-shot'),
      ],
      sole,
      personOf(P),
    );
    expect(plan.writes).toEqual([
      WriteOp.remove([Collections.AppointmentPhotos, 'photo-p-shot']),
    ]);
    expect(plan.objectPaths).toEqual([byId('photo-p-shot').path]);
  });

  it('nothing to plan for nothing', () => {
    expect(ClientErasureSystem.photoPlan([], sole, personOf(P))).toEqual({
      objectPaths: [],
      labelPaths: [],
      writes: [],
    });
  });
});

describe('ClientErasureSystem.looseWrites — the account’s loose documents (P3-RU-24)', () => {
  it('removes P’s notifications and waitlist requests, marks P’s invitation and the session that targeted P — Q’s untouched', () => {
    const footprint = pFootprint();
    expect(
      ClientErasureSystem.looseWrites({
        ...footprint,
        waitlistRequests: world.state.waitlist,
        invitations: world.state.invitations,
        sessions: world.state.sessions,
      }),
    ).toEqual([
      WriteOp.remove([
        Collections.Users,
        P_USER,
        Subcollections.Notifications,
        footprint.notifications[0]?.id ?? '',
      ]),
      WriteOp.remove([Collections.WaitlistRequests, 'wl-p']),
      WriteOp.update([Collections.Invitations, 'inv-p'], {
        inviterName: PrivacyMarker.TEXT,
      }),
      WriteOp.update([Collections.ImpersonationSessions, 'session-p'], {
        reason: PrivacyMarker.TEXT,
      }),
    ]);
  });

  it('a mark already there plans nothing (idempotent); a record with no account plans nothing at all', () => {
    const footprint = pFootprint();
    expect(
      ClientErasureSystem.looseWrites({
        ...footprint,
        notifications: [],
        waitlistRequests: [],
        invitations: footprint.invitations.map((invitation) => ({
          ...invitation,
          inviterName: PrivacyMarker.TEXT,
        })),
        sessions: footprint.sessions.map(
          (session) =>
            ({ ...session, reason: PrivacyMarker.TEXT }) as typeof session,
        ),
      }),
    ).toEqual([]);
    expect(
      ClientErasureSystem.looseWrites({ ...footprint, person: personOf(W) }),
    ).toEqual([]);
  });

  it('holds no personal value', () => {
    expectNoSentinel(
      ClientErasureSystem.looseWrites(pFootprint()),
      sentinelsOf(PRIVACY_SENTINELS),
    );
  });
});

describe('ClientErasureSystem.completionWrites — the LAST commit', () => {
  const p = personOf(P);
  const erasing = strippedRecord(p.record, ErasureLifecycle.begin(STARTED));
  const residue: ErasureCensus = {
    ...ErasureCensus.EMPTY,
    erasureVisitCount: 2,
    erasureContactKeptCount: 1,
    erasureJournalCount: 2,
  };
  const complete = (record: Customer, census: ErasureCensus = residue) =>
    ClientErasureSystem.completionWrites(
      record,
      census,
      ADMIN,
      OPERATION,
      FIXTURE_NOW_UTC_MS,
      fixtureHash,
    );

  it('ERASING → ERASED (the start kept) under the erasure’s id, and the ERASED row holding the residue', () => {
    const resourceId = AuditResourceId.forCustomer(P);
    expect(complete(erasing)).toEqual([
      WriteOp.transition(
        [Collections.Customers, P],
        {
          erasureStatus: ErasureStatus.Erased,
          erasureStartedAtUtcMs: STARTED,
          erasedAtUtcMs: FIXTURE_NOW_UTC_MS,
          writeOperationId: OPERATION,
        },
        [],
      ),
      WriteOp.create(
        [
          Collections.AuditLog,
          AuditEntryId.of(
            fixtureHash(
              AuditSystem.rowBasis(
                AuditAction.PrivacyClientErased,
                resourceId,
                P,
                `erasure-done:${P}`,
              ),
            ),
          ),
        ],
        {
          recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
          resourceId,
          auditOperationId: OPERATION,
          ...ADMIN,
          ...AuditContext.clientErasure(
            AuditAction.PrivacyClientErased,
            residue,
          ),
          ...AuditTargetRef.customer(P),
        },
      ),
    ]);
  });

  it('[] unless ERASING, and [] while residue is left', () => {
    expect(complete(p.record)).toEqual([]);
    expect(
      complete(
        strippedRecord(
          p.record,
          ErasureLifecycle.complete(
            ErasureLifecycle.begin(STARTED),
            FIXTURE_NOW_UTC_MS,
          ),
        ),
      ),
    ).toEqual([]);
    expect(complete(erasing, { ...residue, erasureNoteCount: 1 })).toEqual([]);
  });
});

describe('ClientErasureSystem.resweepWrites — an ERASED record’s sweep that found residue (P3-L-19)', () => {
  const p = personOf(P);
  const erased = strippedRecord(
    p.record,
    ErasureLifecycle.complete(ErasureLifecycle.begin(STARTED), STARTED),
  );
  const before: ErasureCensus = {
    ...ErasureCensus.EMPTY,
    erasureNoteCount: 1,
    erasureVisitCount: 2,
  };
  const resweep = (
    record: Customer,
    census: ErasureCensus,
    rowPresent: boolean,
  ) =>
    ClientErasureSystem.resweepWrites(
      record,
      census,
      rowPresent,
      ADMIN,
      OPERATION,
      FIXTURE_NOW_UTC_MS,
      fixtureHash,
    );

  it('ONE RESWEPT row holding the census BEFORE the sweep, keyed by the act', () => {
    const resourceId = AuditResourceId.forCustomer(P);
    expect(resweep(erased, before, false)).toEqual([
      WriteOp.create(
        [
          Collections.AuditLog,
          AuditEntryId.of(
            fixtureHash(ClientErasureSystem.resweepRowIdBasis(P, OPERATION)),
          ),
        ],
        {
          recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
          resourceId,
          auditOperationId: OPERATION,
          ...ADMIN,
          ...AuditContext.clientErasure(
            AuditAction.PrivacyClientErasureReswept,
            before,
          ),
          ...AuditTargetRef.customer(P),
        },
      ),
    ]);
    expect(ClientErasureSystem.resweepRowIdBasis(P, OPERATION)).toBe(
      AuditSystem.rowBasis(
        AuditAction.PrivacyClientErasureReswept,
        resourceId,
        P,
        `erasure-resweep:${OPERATION}`,
      ),
    );
  });

  it('[] with no residue, with the row already present (a replay), or for a record that is not ERASED', () => {
    expect(resweep(erased, ErasureCensus.EMPTY, false)).toEqual([]);
    expect(resweep(erased, before, true)).toEqual([]);
    expect(
      resweep(
        strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
        before,
        false,
      ),
    ).toEqual([]);
    expect(resweep(p.record, before, false)).toEqual([]);
  });

  it('another act is another row', () => {
    const other = ClientErasureSystem.resweepWrites(
      erased,
      before,
      false,
      ADMIN,
      OperationId.of('op-erase-0002'),
      FIXTURE_NOW_UTC_MS,
      fixtureHash,
    );
    expect(other[0]?.path).not.toEqual(resweep(erased, before, false)[0]?.path);
  });
});

describe('ClientErasureSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const footprint = deepFreeze(pFootprint());
    const w = deepFreeze(wFootprint());
    const census = ClientErasureSystem.census(footprint, fixtureWalkInHash);
    expect(ClientErasureSystem.census(footprint, fixtureWalkInHash)).toEqual(
      census,
    );
    const stamp = ClientErasureSystem.stampWrites(
      footprint.person,
      census,
      ADMIN,
      OPERATION,
      STARTED,
      fixtureHash,
    );
    expect(
      ClientErasureSystem.stampWrites(
        footprint.person,
        census,
        ADMIN,
        OPERATION,
        STARTED,
        fixtureHash,
      ),
    ).toEqual(stamp);
    for (const visit of w.visits) {
      expect(
        ClientErasureSystem.visitWrites(
          visit,
          null,
          w.person,
          OPERATION,
          fixtureWalkInHash,
        ),
      ).toEqual(
        ClientErasureSystem.visitWrites(
          visit,
          null,
          w.person,
          OPERATION,
          fixtureWalkInHash,
        ),
      );
    }
    const sole = deepFreeze(new Set([world.visits.solo.id]));
    expect(
      ClientErasureSystem.photoPlan(footprint.photos, sole, footprint.person),
    ).toEqual(
      ClientErasureSystem.photoPlan(footprint.photos, sole, footprint.person),
    );
    expect(ClientErasureSystem.looseWrites(footprint)).toEqual(
      ClientErasureSystem.looseWrites(footprint),
    );
    expect(footprint).toEqual(pFootprint());
    expect(w).toEqual(wFootprint());
  });
});

describe('ClientErasureSystem — no personal value in any planned row (R36 / T5)', () => {
  it('the SWEPT, STARTED, ERASED and RESWEPT rows carry ids, tags and counts only', () => {
    const p = personOf(P);
    const census = ClientErasureSystem.census(pFootprint(), fixtureWalkInHash);
    const rows = [
      ...ClientErasureSystem.sweepRowWrites(
        p.record,
        census,
        false,
        1,
        ADMIN,
        OPERATION,
        FIXTURE_NOW_UTC_MS,
        fixtureHash,
      ),
      ...ClientErasureSystem.stampWrites(
        p,
        census,
        ADMIN,
        OPERATION,
        STARTED,
        fixtureHash,
      ),
      ...ClientErasureSystem.completionWrites(
        strippedRecord(p.record, ErasureLifecycle.begin(STARTED)),
        { ...ErasureCensus.EMPTY, erasureVisitCount: 2 },
        ADMIN,
        OPERATION,
        FIXTURE_NOW_UTC_MS,
        fixtureHash,
      ),
      ...ClientErasureSystem.resweepWrites(
        strippedRecord(
          p.record,
          ErasureLifecycle.complete(ErasureLifecycle.begin(STARTED), STARTED),
        ),
        census,
        false,
        ADMIN,
        OPERATION,
        FIXTURE_NOW_UTC_MS,
        fixtureHash,
      ),
    ].filter((op) => op.path[0] === Collections.AuditLog);
    expect(rows).toHaveLength(4);
    expectNoSentinel(rows, sentinelsOf(PRIVACY_SENTINELS, OTHER_SENTINELS));
    for (const row of rows) {
      if (row.writeAction !== WriteAction.Create) continue;
      expect(Object.keys(row.body).sort()).toEqual(
        [
          'recordedAtUtcMs',
          'resourceId',
          'auditOperationId',
          'actorRole',
          'actorAdminUserId',
          'auditAction',
          ...ErasureCensus.PERSONAL_FIELDS,
          ...ErasureCensus.RETAINED_FIELDS,
          'auditTarget',
          'targetCustomerId',
        ].sort(),
      );
    }
  });
});
