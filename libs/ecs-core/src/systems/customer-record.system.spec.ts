import { describe, expect, it } from 'vitest';
import {
  BookingCall,
  CustomerOrigin,
  E164,
  Email,
  SeatLabel,
  SeatOccupant,
  WriteOp,
} from '@core/components';
import {
  BarberId,
  CartLineId,
  CustomerId,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import {
  type AccountContact,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  deepFreeze,
  duration,
  fixtureHash,
  fixtureWalkInHash,
  localDate,
  minute,
  seatFixture,
} from '@core/testing';
import { CustomerRecordSystem } from './customer-record.system';
import { SearchFieldsSystem } from './search-fields.system';

/*
 * MOVED, titles kept, from pipelines/customer-records.pipeline.spec.ts (the
 * `customerCreates` cases of flip 1, F1-5) with the body and the
 * create-when-absent decision they test (identity flip (2), F2-7b); plus
 * the `REGISTRATION` origin `completeRegistration` plans.
 */

const SON = UserId.of('u-son');
const SON_RECORD = CustomerId.forUser(SON, fixtureHash);

const MARIA: AccountContact = {
  firstName: 'Maria',
  lastName: 'Ivanova',
  phone: null,
  email: Email.of('maria@example.com'),
};

/** The account → record resolution the pipelines derive (`customerIdsFor`). */
function resolvedFor(
  ...userIds: readonly UserId[]
): ReadonlyMap<UserId, CustomerId> {
  const ids = new Map<UserId, CustomerId>();
  for (const userId of userIds) {
    ids.set(userId, CustomerId.forUser(userId, fixtureHash));
  }
  return ids;
}

describe('CustomerRecordSystem.createsFor — the client records a transaction creates (D29)', () => {
  it('creates ONLY a record the transaction found absent — FIRST_BOOKING, the snapshot’s name and channels, the search keys', () => {
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client, SON),
      new Map<CustomerId, Customer | null>([
        [FIXTURE_IDS.customer, null],
        [SON_RECORD, { id: SON_RECORD } as Customer],
      ]),
      new Map([[FIXTURE_IDS.client, MARIA]]),
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    const body: Omit<Customer, 'id'> = {
      userId: FIXTURE_IDS.client,
      displayName: Profile.fullName(MARIA),
      phone: null,
      email: MARIA.email,
      ...SearchFieldsSystem.searchFields('Maria', 'Ivanova', null, MARIA.email),
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.FirstBooking,
    };
    expect(writes).toEqual([
      WriteOp.create([Collections.Customers, FIXTURE_IDS.customer], body),
    ]);
  });

  it('a record never read is not absent — nothing is planned for it; an account with no snapshot gets a nameless record', () => {
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client, SON),
      new Map<CustomerId, Customer | null>([[SON_RECORD, null]]),
      new Map(),
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(
      WriteOp.create([Collections.Customers, SON_RECORD], {
        userId: SON,
        displayName: '',
        phone: null,
        email: null,
        searchName: '',
        searchPrefixes: [],
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.FirstBooking,
      }),
    );
  });

  it('a registration creates the account’s record as REGISTRATION — the registered name, both channels, the explicit userId link (F2-7b)', () => {
    const registered: AccountContact = {
      firstName: 'Maria',
      lastName: 'Ivanova',
      phone: E164.of('+359888123456'),
      email: Email.of('maria@example.com'),
    };
    const writes = CustomerRecordSystem.createsFor(
      resolvedFor(FIXTURE_IDS.client),
      new Map<CustomerId, Customer | null>([[FIXTURE_IDS.customer, null]]),
      new Map([[FIXTURE_IDS.client, registered]]),
      CustomerOrigin.Registration,
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toEqual([
      WriteOp.create([Collections.Customers, FIXTURE_IDS.customer], {
        userId: FIXTURE_IDS.client,
        displayName: 'Maria Ivanova',
        phone: registered.phone,
        email: registered.email,
        ...SearchFieldsSystem.searchFields(
          'Maria',
          'Ivanova',
          registered.phone,
          registered.email,
        ),
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.Registration,
      }),
    ]);
    // A re-run that reads the record it created plans nothing.
    expect(
      CustomerRecordSystem.createsFor(
        resolvedFor(FIXTURE_IDS.client),
        new Map<CustomerId, Customer | null>([
          [FIXTURE_IDS.customer, { id: FIXTURE_IDS.customer } as Customer],
        ]),
        new Map([[FIXTURE_IDS.client, registered]]),
        CustomerOrigin.Registration,
        FIXTURE_NOW_UTC_MS,
      ),
    ).toEqual([]);
  });

  it('plans one create per record, however many accounts resolve to it', () => {
    const shared = new Map<UserId, CustomerId>([
      [FIXTURE_IDS.client, FIXTURE_IDS.customer],
      [SON, FIXTURE_IDS.customer],
    ]);
    const writes = CustomerRecordSystem.createsFor(
      shared,
      new Map<CustomerId, Customer | null>([[FIXTURE_IDS.customer, null]]),
      new Map([[FIXTURE_IDS.client, MARIA]]),
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toHaveLength(1);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const resolved = resolvedFor(FIXTURE_IDS.client, SON);
    const stored = new Map<CustomerId, Customer | null>([
      [FIXTURE_IDS.customer, null],
      [SON_RECORD, null],
    ]);
    const contacts = new Map([[FIXTURE_IDS.client, deepFreeze({ ...MARIA })]]);
    const once = CustomerRecordSystem.createsFor(
      resolved,
      stored,
      contacts,
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    const twice = CustomerRecordSystem.createsFor(
      resolved,
      stored,
      contacts,
      CustomerOrigin.FirstBooking,
      FIXTURE_NOW_UTC_MS,
    );
    expect(twice).toEqual(once);
    expect([...stored.values()]).toEqual([null, null]);
    expect(resolved.size).toBe(2);
  });
});

describe('CustomerRecordSystem.missingContacts — whose contact a save must read first (P-16)', () => {
  // edit-appointment.pipeline.spec.ts "an added SELF seat whose owner has no
  // client record: the contact is read outside, then the record is created".
  const DAUGHTER = UserId.of('u-daughter');
  const DAUGHTER_RECORD = CustomerId.forUser(DAUGHTER, fixtureHash);

  it('names an account whose record was found ABSENT and whose contact was not read yet', () => {
    expect(
      CustomerRecordSystem.missingContacts(
        resolvedFor(FIXTURE_IDS.client),
        new Map<CustomerId, Customer | null>([[FIXTURE_IDS.customer, null]]),
        new Map(),
      ),
    ).toEqual([FIXTURE_IDS.client]);
  });

  it('asks nobody whose record exists, whose record was never read, or whose contact is already in hand', () => {
    expect(
      CustomerRecordSystem.missingContacts(
        resolvedFor(FIXTURE_IDS.client, SON, DAUGHTER),
        new Map<CustomerId, Customer | null>([
          [FIXTURE_IDS.customer, null],
          [SON_RECORD, { id: SON_RECORD } as Customer],
          // DAUGHTER_RECORD never read: `undefined`, not absent.
        ]),
        new Map([[FIXTURE_IDS.client, MARIA]]),
      ),
    ).toEqual([]);
    expect(
      CustomerRecordSystem.missingContacts(
        resolvedFor(DAUGHTER, FIXTURE_IDS.client),
        new Map<CustomerId, Customer | null>([
          [FIXTURE_IDS.customer, null],
          [DAUGHTER_RECORD, null],
        ]),
        new Map(),
      ),
    ).toEqual([DAUGHTER, FIXTURE_IDS.client]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const resolved = resolvedFor(FIXTURE_IDS.client, SON);
    const stored = new Map<CustomerId, Customer | null>([
      [FIXTURE_IDS.customer, null],
      [SON_RECORD, null],
    ]);
    const contacts = new Map([[SON, deepFreeze({ ...MARIA })]]);
    const once = CustomerRecordSystem.missingContacts(
      resolved,
      stored,
      contacts,
    );
    expect(
      CustomerRecordSystem.missingContacts(resolved, stored, contacts),
    ).toEqual(once);
    expect(once).toEqual([FIXTURE_IDS.client]);
    expect(stored.size).toBe(2);
    expect(contacts.size).toBe(1);
  });
});

/* ── OR-26: the record a walk-in gets ─────────────────────────────────── */

const MARIA_PHONE = E164.of('+359888123456');
const ANA_EMAIL = Email.of('ana@example.com');
const MARIA_RECORD = CustomerId.forWalkIn(MARIA_PHONE, fixtureWalkInHash);
const ANA_RECORD = CustomerId.forWalkIn(ANA_EMAIL, fixtureWalkInHash);

/** A commit's seat for `subject` on line `lineId`. */
function seatFor(
  lineId: string,
  subject: BookingCall.SubjectInput,
): BookingCall.SeatInput {
  return {
    lineId,
    serviceId: 'svc-cut',
    variantId: null,
    barberId: 'b-ivan',
    barberPreference: null,
    startMinutes: 600,
    subject,
  };
}

/** A guest on a commit, by label, with what the desk took for them. */
function guestLine(
  lineId: string,
  label: string,
  contact: BookingCall.GuestContact | null,
): BookingCall.SeatInput {
  return seatFor(lineId, {
    requestedSubjectRole: 'GUEST',
    label,
    guestKey: null,
    contact,
  });
}

/** A staff edit's `ADD_SEAT` for `addedSubject`. */
function addSeat(
  seatId: string,
  addedSubject: BookingCall.AddedSubject,
): BookingCall.EditCommand {
  return BookingCall.editAddSeat(
    SeatId.of(seatId),
    ServiceId.of('svc-cut'),
    null,
    BarberId.of('b-ivan'),
    localDate('2026-10-07'),
    minute(600),
    duration(30),
    addedSubject,
  );
}

describe('CustomerRecordSystem.walkInKey — the key a walk-in’s record is found by (OR-26)', () => {
  it('is the phone, else the e-mail, else nothing', () => {
    expect(
      CustomerRecordSystem.walkInKey({ phone: MARIA_PHONE, email: ANA_EMAIL }),
    ).toBe('+359888123456');
    expect(
      CustomerRecordSystem.walkInKey({ phone: null, email: ANA_EMAIL }),
    ).toBe('ana@example.com');
    expect(
      CustomerRecordSystem.walkInKey({ phone: null, email: null }),
    ).toBeNull();
  });
});

describe('CustomerRecordSystem.walkInGuests — the walk-ins of a commit (OR-26)', () => {
  it('resolves each guest with a contact to its record, keyed by the line — a name alone, the booker and an account resolve nothing', () => {
    const walkIns = CustomerRecordSystem.walkInGuests(
      [
        seatFor('line-1', { requestedSubjectRole: 'SELF' }),
        guestLine('line-2', ' Мария ', { phone: MARIA_PHONE, email: null }),
        guestLine('line-3', 'Ана', { phone: null, email: ANA_EMAIL }),
        guestLine('line-4', 'Петър', null),
        seatFor('line-5', {
          requestedSubjectRole: 'COMPANION',
          companionUserId: 'u-son',
        }),
      ],
      fixtureWalkInHash,
    );
    expect(walkIns).toEqual([
      {
        lineId: 'line-2',
        customerId: MARIA_RECORD,
        label: SeatLabel.of('Мария'),
        phone: MARIA_PHONE,
        email: null,
      },
      {
        lineId: 'line-3',
        customerId: ANA_RECORD,
        label: SeatLabel.of('Ана'),
        phone: null,
        email: ANA_EMAIL,
      },
    ]);
  });

  it('the same phone twice is ONE record — whatever name the desk typed; a label the seat rules refuse keeps none', () => {
    const walkIns = CustomerRecordSystem.walkInGuests(
      [
        guestLine('line-1', 'Мария', { phone: MARIA_PHONE, email: null }),
        guestLine('line-2', 'Мими', { phone: MARIA_PHONE, email: ANA_EMAIL }),
        guestLine('line-3', '   ', { phone: MARIA_PHONE, email: null }),
        // A line whose id is no id names nothing the decision could seat.
        guestLine(' ', 'Мария', { phone: MARIA_PHONE, email: null }),
        // A contact holding neither channel keys nothing.
        guestLine('line-4', 'Мария', { phone: null, email: null }),
      ],
      fixtureWalkInHash,
    );
    expect(walkIns.map((walkIn) => walkIn.customerId)).toEqual([
      MARIA_RECORD,
      MARIA_RECORD,
    ]);
    expect(walkIns.map((walkIn) => walkIn.lineId)).toEqual([
      'line-1',
      'line-2',
    ]);
  });
});

describe('CustomerRecordSystem.addedWalkIns — the walk-ins a staff edit adds (OR-26)', () => {
  it('resolves each added guest with a contact, keyed by the seat the sheet minted', () => {
    const walkIns = CustomerRecordSystem.addedWalkIns(
      [
        BookingCall.editRemoveSeat(SeatId.of('seat-old')),
        addSeat('draft-1', { requestedSubjectRole: 'SELF' }),
        addSeat('draft-2', {
          requestedSubjectRole: 'GUEST',
          label: SeatLabel.of('Мария'),
          contact: { phone: MARIA_PHONE, email: null },
        }),
        addSeat('draft-3', {
          requestedSubjectRole: 'GUEST',
          label: SeatLabel.of('Случаен клиент'),
          contact: null,
        }),
      ],
      fixtureWalkInHash,
    );
    expect(walkIns).toEqual([
      {
        lineId: 'draft-2',
        customerId: MARIA_RECORD,
        label: SeatLabel.of('Мария'),
        phone: MARIA_PHONE,
        email: null,
      },
    ]);
  });
});

describe('CustomerRecordSystem.seatedWalkIns and walkInsByLabel — a walk-in keeps its record (OR-26)', () => {
  const walkInSeat = seatFixture({
    seatId: SeatId.of('seat-maria'),
    occupant: SeatOccupant.walkIn(MARIA_RECORD, SeatLabel.of('Мария')),
  });
  const guestSeat = seatFixture({
    seatId: SeatId.of('seat-guest'),
    occupant: SeatOccupant.anonymous(SeatLabel.of('Гост')),
  });
  const ownSeat = seatFixture();

  it('names each stored WALK_IN seat by its own id and its record — nobody else', () => {
    expect(
      CustomerRecordSystem.seatedWalkIns([ownSeat, walkInSeat, guestSeat]),
    ).toEqual([{ lineId: 'seat-maria', customerId: MARIA_RECORD }]);
  });

  it('carries a stored walk-in onto the cart line of its label — a stranger’s label and the booker carry nothing', () => {
    expect(
      CustomerRecordSystem.walkInsByLabel(
        [ownSeat, walkInSeat, guestSeat],
        [
          seatFor(CartLineId.of('cart-0'), { requestedSubjectRole: 'SELF' }),
          guestLine(CartLineId.of('cart-1'), ' Мария ', null),
          guestLine(CartLineId.of('cart-2'), 'Гост', null),
          guestLine('', 'Мария', null),
        ],
      ),
    ).toEqual([{ lineId: 'cart-1', customerId: MARIA_RECORD }]);
  });
});

describe('CustomerRecordSystem.walkInCreates — the walk-in records a transaction creates (OR-26)', () => {
  const maria = CustomerRecordSystem.walkInGuests(
    [guestLine('line-1', 'Мария', { phone: MARIA_PHONE, email: ANA_EMAIL })],
    fixtureWalkInHash,
  );

  it('creates a record found ABSENT — no account, STAFF_WALK_IN, the label as its name, both channels, the search keys', () => {
    expect(
      CustomerRecordSystem.walkInCreates(
        maria,
        new Map<CustomerId, Customer | null>([[MARIA_RECORD, null]]),
        FIXTURE_NOW_UTC_MS,
      ),
    ).toEqual([
      WriteOp.create([Collections.Customers, MARIA_RECORD], {
        userId: null,
        displayName: 'Мария',
        phone: MARIA_PHONE,
        email: ANA_EMAIL,
        ...SearchFieldsSystem.searchFields(
          'Мария',
          null,
          MARIA_PHONE,
          ANA_EMAIL,
        ),
        createdAtUtcMs: FIXTURE_NOW_UTC_MS,
        customerOrigin: CustomerOrigin.StaffWalkIn,
      }),
    ]);
  });

  it('finds the desk’s walk-in again by the number’s digits and the name', () => {
    const [create] = CustomerRecordSystem.walkInCreates(
      maria,
      new Map<CustomerId, Customer | null>([[MARIA_RECORD, null]]),
      FIXTURE_NOW_UTC_MS,
    );
    const body = (create as WriteOp.Create).body as Omit<Customer, 'id'>;
    expect(body.searchPrefixes).toContain('мар');
    expect(body.searchPrefixes).toContain(
      SearchFieldsSystem.normalizeQuery('0888 123 456'),
    );
  });

  it('the same phone twice gives ONE record; a record read is left alone — a retried save, or the next visit, creates nothing', () => {
    const twice = CustomerRecordSystem.walkInGuests(
      [
        guestLine('line-1', 'Мария', { phone: MARIA_PHONE, email: null }),
        guestLine('line-2', 'Мими', { phone: MARIA_PHONE, email: null }),
      ],
      fixtureWalkInHash,
    );
    expect(
      CustomerRecordSystem.walkInCreates(
        twice,
        new Map<CustomerId, Customer | null>([[MARIA_RECORD, null]]),
        FIXTURE_NOW_UTC_MS,
      ),
    ).toHaveLength(1);
    expect(
      CustomerRecordSystem.walkInCreates(
        twice,
        new Map<CustomerId, Customer | null>([
          [MARIA_RECORD, { id: MARIA_RECORD } as Customer],
        ]),
        FIXTURE_NOW_UTC_MS,
      ),
    ).toEqual([]);
  });

  it('a record never read is not absent — nothing is planned for it', () => {
    expect(
      CustomerRecordSystem.walkInCreates(maria, new Map(), FIXTURE_NOW_UTC_MS),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const guests = deepFreeze([...maria]);
    const stored = new Map<CustomerId, Customer | null>([[MARIA_RECORD, null]]);
    const once = CustomerRecordSystem.walkInCreates(
      guests,
      stored,
      FIXTURE_NOW_UTC_MS,
    );
    expect(
      CustomerRecordSystem.walkInCreates(guests, stored, FIXTURE_NOW_UTC_MS),
    ).toEqual(once);
    expect(stored.get(MARIA_RECORD)).toBeNull();
    expect(stored.size).toBe(1);

    const lines = deepFreeze([
      guestLine('line-1', 'Мария', { phone: MARIA_PHONE, email: null }),
    ]);
    expect(CustomerRecordSystem.walkInGuests(lines, fixtureWalkInHash)).toEqual(
      CustomerRecordSystem.walkInGuests(lines, fixtureWalkInHash),
    );
  });
});
