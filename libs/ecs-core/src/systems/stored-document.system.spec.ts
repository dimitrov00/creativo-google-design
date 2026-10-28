import { describe, expect, it } from 'vitest';
import {
  BlockKind,
  ErasureLifecycle,
  ErasureStatus,
  MinuteBlock,
  PrivacyMarker,
  SeatLabel,
  SeatOccupant,
} from '@core/components';
import { RepositoryErrorCode } from '@core/errors';
import { type AppointmentNote, Collections } from '@core/entities';
import {
  AppointmentId,
  CustomerId,
  OperationId,
  UserId,
} from '@core/primitives';
import {
  appointmentFixture,
  at,
  barberBusyDayFixture,
  customerFixture,
  deepFreeze,
  seatFixture,
  unguarded,
  until,
  utcMs,
} from '@core/testing';
import { SearchFieldsSystem } from './search-fields.system';
import {
  type StoredDocument,
  StoredDocumentSystem,
} from './stored-document.system';

/** The document minus the named fields — a legacy row, a hand edit. */
function without(doc: StoredDocument, ...fields: string[]): StoredDocument {
  const kept = Object.fromEntries(
    Object.entries(doc).filter(([field]) => !fields.includes(field)),
  );
  return { ...kept, id: doc.id };
}

/** The refusal a guard answers for `path` and `reason`. */
const refused = (path: string, reason: string) => ({
  ok: false,
  error: { errorCode: RepositoryErrorCode.Malformed, path, reason },
});

const APPOINTMENT_PATH = `appointments/${appointmentFixture().id}`;

/** A team note as the notes collection holds it — the body beside its id. */
function noteFixture(
  overrides: Partial<AppointmentNote> = {},
): AppointmentNote {
  return {
    id: AppointmentId.of('appointment-1'),
    text: 'алергия към ментол',
    authorUserId: UserId.of('dev-staff-ivan'),
    writtenAtUtcMs: utcMs('2026-08-05T08:00:00.000+03:00'),
    ...overrides,
  };
}

const NOTE_PATH = 'appointmentNotes/appointment-1';

describe('StoredDocumentSystem.appointment — appointments/{id} as read', () => {
  it('admits a well-formed document as THE SAME OBJECT — zero mapping (Law 5)', () => {
    const doc = appointmentFixture();
    const answer = StoredDocumentSystem.appointment(doc);
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.value).toBe(doc);
  });

  it('admits every lifecycle variant the factories build', () => {
    for (const [status, stamp] of [
      ['PENDING', 'pendingAtUtcMs'],
      ['CONFIRMED', 'confirmedAtUtcMs'],
      ['COMPLETED', 'completedAtUtcMs'],
      ['NO_SHOW', 'noShowAtUtcMs'],
    ] as const) {
      const doc = {
        ...without(appointmentFixture(), 'confirmedAtUtcMs'),
        bookingStatus: status,
        [stamp]: appointmentFixture().utcEpochMs,
      };
      expect(StoredDocumentSystem.appointmentFault(doc), status).toBeNull();
    }
  });

  it.each([
    ['id', '', 'id'],
    ['id', 'a/b', 'id'],
    ['locationId', null, 'locationId'],
    ['localDate', '2026-02-30', 'localDate'],
    ['startMinutes', 1440, 'startMinutes'],
    ['endMinutes', 0, 'endMinutes'],
    ['utcEpochMs', '1790575200000', 'utcEpochMs'],
    ['bookingStatus', 'BOOKED', 'bookingStatus'],
    ['confirmedAtUtcMs', null, 'confirmedAtUtcMs'],
    ['busyKeys', 'b-ivan__2026-09-28', 'busyKeys'],
    ['busyKeys', ['b-ivan_2026-09-28'], 'busyKeys'],
    ['barberIds', [''], 'barberIds'],
    ['barberIds', null, 'barberIds'],
    ['subjectUserIds', 'u-client', 'subjectUserIds'],
    ['subjectUserIds', [7], 'subjectUserIds'],
    ['subjectCustomerIds', [''], 'subjectCustomerIds'],
    ['subjectCustomerIds', 'cus_1', 'subjectCustomerIds'],
    ['seats', 'seat-1', 'seats'],
    ['seats', [null], 'seats[0]'],
    ['discounts', null, 'discounts'],
    ['discounts', [1], 'discounts'],
    ['voucherRedemptions', {}, 'voucherRedemptions'],
    ['appliedOperations', ['op'], 'appliedOperations'],
    ['stoodSeatPairsRevision', -1, 'stoodSeatPairsRevision'],
    ['stoodSeatPairs', [3], 'stoodSeatPairs'],
    ['revision', -1, 'revision'],
    ['revision', 1.5, 'revision'],
    ['revision', undefined, 'revision'],
    ['bookedFromAppointmentId', '', 'bookedFromAppointmentId'],
    ['bookedAtUtcMs', 'yesterday', 'bookedAtUtcMs'],
    ['arrivedAtUtcMs', 1.5, 'arrivedAtUtcMs'],
    ['contactName', 3, 'contactName'],
    ['contactPhone', 359, 'contactPhone'],
    ['contactEmail', {}, 'contactEmail'],
    ['contactNote', [], 'contactNote'],
    ['writeOperationId', '', 'writeOperationId'],
    ['writeOperationId', 'a/b', 'writeOperationId'],
    ['writeOperationId', 42, 'writeOperationId'],
  ] as const)('refuses %s = %j, naming %s', (field, value, reason) => {
    const doc = { ...appointmentFixture(), [field]: value };
    expect(StoredDocumentSystem.appointment(doc)).toEqual(
      refused(`appointments/${doc.id}`, reason),
    );
    expect(StoredDocumentSystem.appointmentFault(doc)).toBe(reason);
  });

  it('names a seat’s field with the seat’s index', () => {
    const second = { ...seatFixture(), priceCents: -1 };
    expect(
      StoredDocumentSystem.appointment({
        ...appointmentFixture(),
        seats: [seatFixture(), second],
      }),
    ).toEqual(refused(APPOINTMENT_PATH, 'seats[1].priceCents'));
    expect(
      StoredDocumentSystem.appointmentFault({
        ...appointmentFixture(),
        seats: [{ ...seatFixture(), startMinutes: 'ten' }],
      }),
    ).toBe('seats[0].startMinutes');
  });

  it('admits a walk-in’s seat, and names its record when it is no id (OR-26)', () => {
    const record = CustomerId.of('cus_0123456789abcdef0123');
    const walkIn = seatFixture({
      occupant: SeatOccupant.walkIn(record, SeatLabel.of('Мария')),
    });
    const doc = {
      ...appointmentFixture(),
      seats: [seatFixture(), walkIn],
      subjectCustomerIds: [appointmentFixture().subjectCustomerIds[0], record],
    };
    const answer = StoredDocumentSystem.appointment(doc);
    expect(answer.ok && answer.value).toBe(doc);
    expect(
      StoredDocumentSystem.appointmentFault({
        ...doc,
        seats: [seatFixture(), { ...walkIn, subjectCustomerId: 'cus/1' }],
      }),
    ).toBe('seats[1].subjectCustomerId');
  });

  it('checks a cancelled seat’s window as the HourCount it is typed as — null is unknown, admitted (OR-45)', () => {
    const cancelled = {
      ...seatFixture(),
      attendanceState: 'CANCELLED',
      cancelledAtUtcMs: appointmentFixture().utcEpochMs,
      cancelledBy: 'STAFF',
      cancellationReason: 'OTHER',
    };
    for (const window of [null, 0, 24, 2_400_000_000]) {
      expect(
        StoredDocumentSystem.appointmentFault({
          ...appointmentFixture(),
          seats: [{ ...cancelled, cancellationWindowHours: window }],
        }),
        String(window),
      ).toBeNull();
    }
    for (const window of [-1, 1.5, '24', 2_400_000_001, undefined]) {
      expect(
        StoredDocumentSystem.appointment({
          ...appointmentFixture(),
          seats: [{ ...cancelled, cancellationWindowHours: window }],
        }),
        String(window),
      ).toEqual(refused(APPOINTMENT_PATH, 'seats[0].cancellationWindowHours'));
    }
  });

  it('admits the subject mirrors absent or null — the backfill’s legacy rows, repaired later', () => {
    const doc = appointmentFixture();
    for (const legacy of [
      without(doc, 'subjectUserIds', 'subjectCustomerIds'),
      { ...doc, subjectUserIds: null, subjectCustomerIds: null },
    ]) {
      const answer = StoredDocumentSystem.appointment(legacy);
      expect(answer.ok).toBe(true);
      expect(answer.ok && answer.value).toBe(legacy);
    }
  });

  it('admits the write provenance absent (written before WS-4.3), null or an OperationId', () => {
    const doc = appointmentFixture();
    for (const stored of [
      without(doc, 'writeOperationId'),
      { ...doc, writeOperationId: null },
      { ...doc, writeOperationId: OperationId.of('op-7f3a') },
    ]) {
      const answer = StoredDocumentSystem.appointment(stored);
      expect(answer.ok).toBe(true);
      expect(answer.ok && answer.value).toBe(stored);
    }
  });

  it('leaves the unchecked fields alone — query keys and repair targets no decision reads', () => {
    const legacy = without(
      appointmentFixture(),
      'ownerUserId',
      'ownerCustomerId',
      'placement',
      'inferredPlacement',
    );
    expect(StoredDocumentSystem.appointmentFault(legacy)).toBeNull();
    expect(
      StoredDocumentSystem.appointmentFault({
        ...appointmentFixture(),
        contactPhone: 'not an E.164',
        seats: [{ ...seatFixture(), barberPreference: 'WHOEVER' }],
      }),
    ).toBeNull();
  });

  it('answers the FIRST offending field, in the fixed order', () => {
    expect(
      StoredDocumentSystem.appointmentFault({
        ...appointmentFixture(),
        locationId: '',
        seats: 'x',
        contactName: 1,
      }),
    ).toBe('locationId');
  });
});

describe('StoredDocumentSystem.customer — customers/{id} as read', () => {
  it('admits a well-formed record as the same object', () => {
    const doc = customerFixture();
    const answer = StoredDocumentSystem.customer(doc);
    expect(answer.ok && answer.value).toBe(doc);
    expect(
      StoredDocumentSystem.customerFault(customerFixture({ userId: null })),
    ).toBeNull();
  });

  it.each([
    ['id', 'a/b', 'id'],
    ['userId', '', 'userId'],
    ['displayName', null, 'displayName'],
    ['phone', 359, 'phone'],
    ['email', {}, 'email'],
    ['createdAtUtcMs', '2026-09-27', 'createdAtUtcMs'],
    ['customerOrigin', 'WALK_IN', 'customerOrigin'],
    ['erasureStatus', 'DELETED', 'erasureStatus'],
    ['erasureStatus', 'none', 'erasureStatus'],
    ['erasureStatus', null, 'erasureStatus'],
    ['writeOperationId', '', 'writeOperationId'],
    ['writeOperationId', 'a/b', 'writeOperationId'],
    ['writeOperationId', 42, 'writeOperationId'],
  ] as const)('refuses %s = %j, naming %s', (field, value, reason) => {
    const doc = { ...customerFixture(), [field]: value };
    expect(StoredDocumentSystem.customer(doc)).toEqual(
      refused(`customers/${doc.id}`, reason),
    );
  });

  it('admits the write provenance absent (written before WS-4.3), null or an OperationId', () => {
    const doc = customerFixture();
    for (const stored of [
      without(doc, 'writeOperationId'),
      { ...doc, writeOperationId: null },
      { ...doc, writeOperationId: OperationId.of('op-7f3a') },
    ]) {
      const answer = StoredDocumentSystem.customer(stored);
      expect(answer.ok).toBe(true);
      expect(answer.ok && answer.value).toBe(stored);
    }
  });

  it('leaves the search mirrors alone — only index #8 reads them', () => {
    expect(
      StoredDocumentSystem.customerFault(
        without(customerFixture(), 'searchName', 'searchPrefixes'),
      ),
    ).toBeNull();
  });

  it('refuses a record WITHOUT the erasure tag — strict, unlike the write provenance (P3-L-18)', () => {
    const doc = without(customerFixture(), 'erasureStatus');
    expect(StoredDocumentSystem.customer(doc)).toEqual(
      refused(`customers/${doc.id}`, 'erasureStatus'),
    );
    // Checked before the write provenance: the tag is the first fault named.
    expect(
      StoredDocumentSystem.customerFault({
        ...doc,
        writeOperationId: 'a/b',
      }),
    ).toBe('erasureStatus');
  });

  it('admits the erased record — the marker name, the cleared contact, the ERASING / ERASED stamps — as the same object', () => {
    const started = utcMs('2026-10-27T09:00:00Z');
    const erasing = ErasureLifecycle.begin(started);
    const cleared = {
      displayName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      ...SearchFieldsSystem.searchFields(null, null, null, null),
      writeOperationId: OperationId.of('op-erase-1'),
    };
    const tombstones = [
      customerFixture({ ...cleared, ...erasing }),
      customerFixture({
        ...cleared,
        ...ErasureLifecycle.complete(erasing, utcMs('2026-10-27T09:05:00Z')),
      }),
      customerFixture({ ...cleared, userId: null, ...erasing }),
    ];
    for (const doc of tombstones) {
      const answer = StoredDocumentSystem.customer(doc);
      expect(answer.ok && answer.value).toBe(doc);
    }
    expect(tombstones[1]).toMatchObject({
      erasureStatus: ErasureStatus.Erased,
      erasureStartedAtUtcMs: started,
    });
  });

  it.each([
    [{ erasureStatus: 'ERASING' }, 'erasureStartedAtUtcMs'],
    [
      { erasureStatus: 'ERASING', erasureStartedAtUtcMs: '2026-10-27' },
      'erasureStartedAtUtcMs',
    ],
    [
      { erasureStatus: 'ERASED', erasedAtUtcMs: 1_793_000_000_000 },
      'erasureStartedAtUtcMs',
    ],
    [
      { erasureStatus: 'ERASED', erasureStartedAtUtcMs: 1_793_000_000_000 },
      'erasedAtUtcMs',
    ],
  ] as const)('refuses the erasure variant %j, naming %s', (slice, reason) => {
    const doc = { ...customerFixture(), ...slice };
    expect(StoredDocumentSystem.customer(doc)).toEqual(
      refused(`customers/${doc.id}`, reason),
    );
  });
});

describe('StoredDocumentSystem.busyDay — barberBusy/{id} as read', () => {
  it('admits a well-formed day as the same object, an empty day included', () => {
    const doc = barberBusyDayFixture();
    const answer = StoredDocumentSystem.busyDay(doc);
    expect(answer.ok && answer.value).toBe(doc);
    expect(
      StoredDocumentSystem.busyDayFault(barberBusyDayFixture({ blocks: [] })),
    ).toBeNull();
  });

  it.each([
    ['id', 'b-ivan_2026-09-28', 'id'],
    ['barberId', '', 'barberId'],
    ['localDate', '2026-9-28', 'localDate'],
    ['utcEpochMs', Number.NaN, 'utcEpochMs'],
    ['blocks', 'x', 'blocks'],
    ['blocks', [null], 'blocks[0]'],
  ] as const)('refuses %s = %j, naming %s', (field, value, reason) => {
    const doc = { ...barberBusyDayFixture(), [field]: value };
    expect(StoredDocumentSystem.busyDay(doc)).toEqual(
      refused(`barberBusy/${doc.id}`, reason),
    );
  });

  it('ignores a writeOperationId key — a busy day carries no provenance (L5), whatever the key holds', () => {
    for (const value of [null, 'op-7f3a', '', 42]) {
      const doc = { ...barberBusyDayFixture(), writeOperationId: value };
      const answer = StoredDocumentSystem.busyDay(doc);
      expect(answer.ok && answer.value).toBe(doc);
    }
  });

  it('names a block’s field with the block’s index — the span, then the kind', () => {
    const good = MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy);
    const doc = barberBusyDayFixture();
    expect(
      StoredDocumentSystem.busyDayFault({
        ...doc,
        blocks: [{ ...good, startMinutes: 700, endMinutes: 600 }],
      }),
    ).toBe('blocks[0].endMinutes');
    expect(
      StoredDocumentSystem.busyDayFault({
        ...doc,
        blocks: [good, { ...good, blockKind: 'X' }],
      }),
    ).toBe('blocks[1].blockKind');
  });
});

describe('StoredDocumentSystem.appointmentNote — appointmentNotes/{id} as read (pass E, E-2)', () => {
  it('admits a well-formed note as THE SAME OBJECT — zero mapping (Law 5)', () => {
    const doc = noteFixture();
    const answer = StoredDocumentSystem.appointmentNote(doc);
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.value).toBe(doc);
  });

  it('admits a note with no author (written before onboarding) and a text padded with blanks', () => {
    for (const doc of [
      noteFixture({ authorUserId: null }),
      noteFixture({ text: '  алергия\n' }),
      noteFixture({ text: 'ред 1\nред 2' }),
    ]) {
      const answer = StoredDocumentSystem.appointmentNote(doc);
      expect(answer.ok && answer.value, doc.text).toBe(doc);
    }
  });

  it.each([
    ['id', '', 'id'],
    ['id', 'a/b', 'id'],
    ['text', undefined, 'text'],
    ['text', null, 'text'],
    ['text', 3, 'text'],
    ['text', ['алергия'], 'text'],
    ['text', '', 'text'],
    ['text', ' \n\t ', 'text'],
    ['text', ' 　﻿', 'text'],
    ['authorUserId', undefined, 'authorUserId'],
    ['authorUserId', '', 'authorUserId'],
    ['authorUserId', 'a/b', 'authorUserId'],
    ['authorUserId', 7, 'authorUserId'],
    ['writtenAtUtcMs', undefined, 'writtenAtUtcMs'],
    ['writtenAtUtcMs', null, 'writtenAtUtcMs'],
    ['writtenAtUtcMs', '2026-08-05', 'writtenAtUtcMs'],
    ['writtenAtUtcMs', 1.5, 'writtenAtUtcMs'],
    ['writtenAtUtcMs', Number.NaN, 'writtenAtUtcMs'],
  ] as const)('refuses %s = %j, naming %s', (field, value, reason) => {
    const doc = { ...noteFixture(), [field]: value };
    expect(StoredDocumentSystem.appointmentNote(doc)).toEqual(
      refused(`appointmentNotes/${doc.id}`, reason),
    );
    expect(StoredDocumentSystem.appointmentNoteFault(doc)).toBe(reason);
  });

  it('refuses an absent field as that field — a legacy `authorUid` row names its author', () => {
    expect(
      StoredDocumentSystem.appointmentNote({
        ...without(noteFixture(), 'authorUserId'),
        authorUid: 'dev-staff-ivan',
      }),
    ).toEqual(refused(NOTE_PATH, 'authorUserId'));
  });

  it('answers the FIRST offending field, in the fixed order: id, text, authorUserId, writtenAtUtcMs', () => {
    expect(
      StoredDocumentSystem.appointmentNoteFault({
        ...noteFixture(),
        text: '',
        authorUserId: 7,
        writtenAtUtcMs: 'x',
      }),
    ).toBe('text');
    expect(
      StoredDocumentSystem.appointmentNoteFault({
        ...noteFixture(),
        authorUserId: 7,
        writtenAtUtcMs: 'x',
      }),
    ).toBe('authorUserId');
  });

  it('refuses a text exactly when trim() would leave nothing — every single code unit agrees', () => {
    const disagreements: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const text = String.fromCharCode(code);
      const refusedText =
        StoredDocumentSystem.appointmentNoteFault({
          ...noteFixture(),
          text,
        }) === 'text';
      if (refusedText !== (text.trim().length === 0)) disagreements.push(code);
    }
    expect(disagreements).toEqual([]);
  });
});

describe('StoredDocumentSystem.salvage — what a trigger may read off a side', () => {
  it('answers a well-formed document’s OWN arrays and its location', () => {
    const doc = appointmentFixture();
    const salvage = StoredDocumentSystem.salvage(doc);
    expect(salvage.busyKeys).toBe(doc.busyKeys);
    expect(salvage.subjectCustomerIds).toBe(doc.subjectCustomerIds);
    expect(salvage.locationId).toBe(doc.locationId);
  });

  it('keeps the busy keys of a refused document whose seats are broken', () => {
    const doc = { ...appointmentFixture(), seats: [{ startMinutes: 'ten' }] };
    expect(StoredDocumentSystem.appointment(doc).ok).toBe(false);
    expect(StoredDocumentSystem.salvage(doc).busyKeys).toBe(doc.busyKeys);
  });

  it('answers the shared empty array for a non-array or a bad element, and null for a bad location', () => {
    const empty = StoredDocumentSystem.salvage({
      ...appointmentFixture(),
      busyKeys: 'k',
      subjectCustomerIds: ['cus_1', ''],
      locationId: 7,
    });
    expect(empty).toEqual({
      busyKeys: [],
      subjectCustomerIds: [],
      locationId: null,
    });
    const other = StoredDocumentSystem.salvage({ id: 'x', busyKeys: [3] });
    expect(other.busyKeys).toBe(empty.busyKeys);
  });

  it('reads absent or null subjects as [] — never a TypeError', () => {
    expect(
      StoredDocumentSystem.salvage(
        without(appointmentFixture(), 'subjectCustomerIds'),
      ).subjectCustomerIds,
    ).toEqual([]);
    expect(
      StoredDocumentSystem.salvage({
        ...appointmentFixture(),
        subjectCustomerIds: null,
      }).subjectCustomerIds,
    ).toEqual([]);
  });
});

describe('StoredDocumentSystem.guardOf — the registry', () => {
  it('answers a guard for the four collections, null for every other', () => {
    expect(StoredDocumentSystem.guardOf(Collections.Appointments)).toBe(
      StoredDocumentSystem.appointment,
    );
    expect(StoredDocumentSystem.guardOf(Collections.Customers)).toBe(
      StoredDocumentSystem.customer,
    );
    expect(StoredDocumentSystem.guardOf(Collections.BarberBusy)).toBe(
      StoredDocumentSystem.busyDay,
    );
    expect(StoredDocumentSystem.guardOf(Collections.AppointmentNotes)).toBe(
      StoredDocumentSystem.appointmentNote,
    );
    for (const collection of [
      Collections.Users,
      Collections.AppointmentPhotos,
      'appointmentNotes/x/sub',
      'barberBusy/x/sub',
      'users/u1/notifications',
      '',
    ]) {
      expect(StoredDocumentSystem.guardOf(collection), collection).toBeNull();
    }
  });

  it('is the one registry the tier exports (OR-33): the registry that guards nothing is test support, null for every collection', () => {
    expect(Object.keys(StoredDocumentSystem)).not.toContain('unguarded');
    for (const collection of [
      Collections.Appointments,
      Collections.Customers,
      Collections.BarberBusy,
      Collections.AppointmentNotes,
      Collections.Users,
    ]) {
      expect(unguarded(collection), collection).toBeNull();
    }
  });
});

describe('StoredDocumentSystem.admit — the one dispatch every read site shares', () => {
  it('answers THE SAME OBJECT for an admitted document of a guarded collection', () => {
    const doc = appointmentFixture();
    const answer = StoredDocumentSystem.admit(
      StoredDocumentSystem.guardOf,
      Collections.Appointments,
      doc,
    );
    expect(answer.ok && answer.value).toBe(doc);
  });

  it('answers the guard’s refusal for a malformed one', () => {
    expect(
      StoredDocumentSystem.admit(
        StoredDocumentSystem.guardOf,
        Collections.BarberBusy,
        { ...barberBusyDayFixture(), blocks: 'none' },
      ),
    ).toEqual(refused(`barberBusy/${barberBusyDayFixture().id}`, 'blocks'));
  });

  it('dispatches a team note to its guard — the same object admitted, a blank text refused', () => {
    const note = noteFixture();
    const answer = StoredDocumentSystem.admit(
      StoredDocumentSystem.guardOf,
      Collections.AppointmentNotes,
      note,
    );
    expect(answer.ok && answer.value).toBe(note);
    expect(
      StoredDocumentSystem.admit(
        StoredDocumentSystem.guardOf,
        Collections.AppointmentNotes,
        { ...note, text: '   ' },
      ),
    ).toEqual(refused(NOTE_PATH, 'text'));
  });

  it('reads an unguarded collection, a subcollection (null) and the test support’s unguarded registry as stored — the same object, never checked', () => {
    const garbage: StoredDocument = { id: 'x', bookingStatus: 'BOGUS' };
    for (const [guardOf, collection] of [
      [StoredDocumentSystem.guardOf, Collections.Users],
      [StoredDocumentSystem.guardOf, null],
      [unguarded, Collections.Appointments],
    ] as const) {
      const answer = StoredDocumentSystem.admit(guardOf, collection, garbage);
      expect(answer.ok && answer.value).toBe(garbage);
    }
  });
});

describe('StoredDocumentSystem.appointmentSide and salvageSides — a trigger’s two sides', () => {
  const visit = appointmentFixture();
  const broken = { ...visit, seats: [{ startMinutes: 'ten' }] };
  const brokenRefusal = StoredDocumentSystem.appointment(broken);

  it('reads an absent side as all null, an admitted one as its entity (the same object), a refused one as its refusal beside the stored side', () => {
    expect(StoredDocumentSystem.appointmentSide(null)).toEqual({
      stored: null,
      appointment: null,
      refusal: null,
    });
    const admitted = StoredDocumentSystem.appointmentSide(visit);
    expect(admitted.appointment).toBe(visit);
    expect(admitted.stored).toBe(visit);
    expect(admitted.refusal).toBeNull();
    const refusedSide = StoredDocumentSystem.appointmentSide(broken);
    expect(refusedSide.appointment).toBeNull();
    expect(refusedSide.stored).toBe(broken);
    expect(refusedSide.refusal?.errorCode).toBe(RepositoryErrorCode.Malformed);
  });

  it('leaves nothing when no side was refused — admitted and absent sides add no keys, no location, no refusal', () => {
    expect(
      StoredDocumentSystem.salvageSides(
        StoredDocumentSystem.appointmentSide(visit),
        StoredDocumentSystem.appointmentSide(null),
      ),
    ).toEqual({ refusal: null, busyKeys: [], locationId: null });
  });

  it('answers a refused side’s OWN keys and location, and its refusal', () => {
    const left = StoredDocumentSystem.salvageSides(
      StoredDocumentSystem.appointmentSide(broken),
      StoredDocumentSystem.appointmentSide(visit),
    );
    expect(left.busyKeys).toBe(broken.busyKeys);
    expect(left.locationId).toBe(visit.locationId);
    expect(brokenRefusal.ok).toBe(false);
    expect(left.refusal).toEqual(!brokenRefusal.ok && brokenRefusal.error);
    expect(left.refusal?.path).toBe(APPOINTMENT_PATH);
  });

  it('joins both refused sides’ keys — before’s, then after’s — and names the before’s refusal and the first location', () => {
    const moved = {
      ...broken,
      busyKeys: ['b-1__2026-09-29'],
      locationId: 'loc-north',
      seats: 'none',
    };
    const left = StoredDocumentSystem.salvageSides(
      StoredDocumentSystem.appointmentSide(broken),
      StoredDocumentSystem.appointmentSide(moved),
    );
    expect(left.busyKeys).toEqual([...visit.busyKeys, 'b-1__2026-09-29']);
    expect(left.locationId).toBe(visit.locationId);
    expect(left.refusal).toEqual(!brokenRefusal.ok && brokenRefusal.error);
  });

  it('answers the other refused side’s keys when the first names none, and no location when neither does', () => {
    const keyless = { ...broken, busyKeys: 'x', locationId: 7 };
    const left = StoredDocumentSystem.salvageSides(
      StoredDocumentSystem.appointmentSide(keyless),
      StoredDocumentSystem.appointmentSide({ ...broken, locationId: 7 }),
    );
    expect(left.busyKeys).toBe(broken.busyKeys);
    expect(left.locationId).toBeNull();
    const none = StoredDocumentSystem.salvageSides(
      StoredDocumentSystem.appointmentSide(keyless),
      StoredDocumentSystem.appointmentSide(null),
    );
    expect(none.busyKeys).toEqual([]);
    expect(none.refusal?.reason).toBe('locationId');
  });
});

describe('StoredDocumentSystem — purity and cost', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const doc = deepFreeze(appointmentFixture());
    const bad = deepFreeze({ ...barberBusyDayFixture(), blocks: [null] });
    expect(StoredDocumentSystem.appointment(doc)).toEqual(
      StoredDocumentSystem.appointment(doc),
    );
    expect(StoredDocumentSystem.busyDay(bad)).toEqual(
      StoredDocumentSystem.busyDay(bad),
    );
    expect(StoredDocumentSystem.salvage(doc)).toEqual(
      StoredDocumentSystem.salvage(doc),
    );
    const sides = [
      StoredDocumentSystem.appointmentSide(bad),
      StoredDocumentSystem.appointmentSide(doc),
    ] as const;
    expect(StoredDocumentSystem.salvageSides(...sides)).toEqual(
      StoredDocumentSystem.salvageSides(...sides),
    );
    expect(doc).toEqual(appointmentFixture());
    const note = deepFreeze(noteFixture());
    const badNote = deepFreeze({ ...noteFixture(), writtenAtUtcMs: 'x' });
    expect(StoredDocumentSystem.appointmentNote(note)).toEqual(
      StoredDocumentSystem.appointmentNote(note),
    );
    expect(StoredDocumentSystem.appointmentNote(badNote)).toEqual(
      StoredDocumentSystem.appointmentNote(badNote),
    );
    expect(note).toEqual(noteFixture());
    expect(badNote).toEqual({ ...noteFixture(), writtenAtUtcMs: 'x' });
  });

  it('the *Fault halves answer null on 1,000 frozen clean documents — no reason string is built', () => {
    const appointments = Array.from({ length: 1000 }, () =>
      deepFreeze(appointmentFixture()),
    );
    const days = Array.from({ length: 1000 }, () =>
      deepFreeze(barberBusyDayFixture()),
    );
    const customers = Array.from({ length: 1000 }, () =>
      deepFreeze(customerFixture()),
    );
    const notes = Array.from({ length: 1000 }, () => deepFreeze(noteFixture()));
    let faults = 0;
    for (const doc of appointments) {
      if (StoredDocumentSystem.appointmentFault(doc) !== null) faults++;
    }
    for (const doc of days) {
      if (StoredDocumentSystem.busyDayFault(doc) !== null) faults++;
    }
    for (const doc of customers) {
      if (StoredDocumentSystem.customerFault(doc) !== null) faults++;
    }
    for (const doc of notes) {
      if (StoredDocumentSystem.appointmentNoteFault(doc) !== null) faults++;
    }
    expect(faults).toBe(0);
  });
});
