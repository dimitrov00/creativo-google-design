import { describe, expect, it } from 'vitest';
import {
  BookingContact,
  type ClientPrivacyCall,
  E164,
  Email,
  ErasureCensus,
  ErasureOffer,
  ErasureStatus,
  Identifier,
  type Seat,
  type StaffEditDraft,
  SeatLabel,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import { PrivacyErrorCode } from '@core/errors';
import {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  CustomerId,
  Currency,
  LocationId,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import type { AppointmentPhoto } from '@core/entities';
import {
  appointmentFixture,
  cents,
  customerFixture,
  deepFreeze,
  draftPersonKey,
  duration,
  FIXTURE_TODAY,
  fixtureHash,
  fixtureWalkInHash,
  OTHER_SENTINELS,
  PERSONS_PARTY_SELF_SEAT,
  personsParty,
  PRIVACY_SENTINELS,
  privacyWorld,
  seatFixture,
  trackMinute,
  unwrapOk,
  userFixture,
  WALK_IN_SENTINELS,
  withSeatRemoved,
} from '@core/testing';
import {
  type ClientPerson,
  ClientPrivacySystem,
} from './client-privacy.system';
import { CustomerRecordSystem } from './customer-record.system';
import { PhoneSystem } from './phone.system';
import {
  type StaffCreateContext,
  type StaffEditWords,
  StaffEditPlanSystem,
} from './staff-edit-plan.system';

/* The rules the client export and the erasure share (audit-hardening
 * Phase 3, P3-RU-18, P3-RU-36, P3-L-11, P3-L-12) — over the privacy world
 * of `@core/testing` (P, Q, W, every personal value a sentinel). */

const world = privacyWorld();
const P = world.person.customerId;
const Q = world.other.customerId;
const W = world.walkIn.customerId;

function personOf(customerId: CustomerId): ClientPerson {
  const record = world.state.records.find((entry) => entry.id === customerId);
  if (record === undefined) throw new Error(`no fixture record ${customerId}`);
  const account =
    world.state.users.find((user) => user.id === record.userId) ?? null;
  return { record, account };
}

describe('ClientPrivacySystem.isSoleSubject', () => {
  it('a visit whose every seat is the person’s record — an account seat', () => {
    expect(ClientPrivacySystem.isSoleSubject(world.visits.solo, P)).toBe(true);
  });

  it('a party with another person on it is shared, for each of them', () => {
    expect(ClientPrivacySystem.isSoleSubject(world.visits.party, P)).toBe(
      false,
    );
    expect(ClientPrivacySystem.isSoleSubject(world.visits.party, Q)).toBe(
      false,
    );
  });

  it('a walk-in seat of the record counts as the person’s', () => {
    expect(ClientPrivacySystem.isSoleSubject(world.visits.walkInThird, W)).toBe(
      true,
    );
  });

  it('an anonymous guest beside the person makes the visit shared; a visit with no seat is nobody’s', () => {
    expect(ClientPrivacySystem.isSoleSubject(world.visits.walkInParty, W)).toBe(
      false,
    );
    expect(
      ClientPrivacySystem.isSoleSubject(appointmentFixture({ seats: [] }), P),
    ).toBe(false);
  });
});

describe('ClientPrivacySystem.contactKeyOf', () => {
  it('is the phone, else the e-mail, else null — the walk-in key rule', () => {
    expect(ClientPrivacySystem.contactKeyOf(world.visits.party)).toBe(
      OTHER_SENTINELS.phone,
    );
    expect(
      ClientPrivacySystem.contactKeyOf({
        ...BookingContact.NONE,
        contactEmail: OTHER_SENTINELS.email,
      }),
    ).toBe(OTHER_SENTINELS.email);
    expect(ClientPrivacySystem.contactKeyOf(BookingContact.NONE)).toBeNull();
  });

  it('agrees with CustomerRecordSystem.walkInKey over the same values', () => {
    expect(ClientPrivacySystem.contactKeyOf(world.visits.walkInParty)).toBe(
      CustomerRecordSystem.walkInKey({
        phone: WALK_IN_SENTINELS.phone,
        email: null,
      }),
    );
  });
});

describe('ClientPrivacySystem.contactIsPersons', () => {
  it('the owner record’s visit: the contact is the person’s', () => {
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.solo,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(true);
  });

  it('the owner ACCOUNT is the record’s linked one: the contact is the person’s', () => {
    const visit = appointmentFixture({
      ownerUserId: world.person.userId,
      ownerCustomerId: null,
    });
    expect(
      ClientPrivacySystem.contactIsPersons(
        visit,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(true);
  });

  it('a party owned by Q: the contact is Q’s, never P’s', () => {
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.party,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(false);
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.party,
        personOf(Q),
        fixtureWalkInHash,
      ),
    ).toBe(true);
  });

  it('a sole-subject visit carrying a THIRD person’s contact is not the person’s', () => {
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.walkInThird,
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });

  it('a visit with no contact is nobody’s', () => {
    expect(
      ClientPrivacySystem.contactIsPersons(
        appointmentFixture({
          ownerUserId: null,
          ownerCustomerId: null,
          ...BookingContact.NONE,
        }),
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });

  it('a walk-in record that links no account never matches an owner-less visit by account', () => {
    const visit = appointmentFixture({
      ownerUserId: null,
      ownerCustomerId: null,
      ...BookingContact.NONE,
    });
    expect(
      ClientPrivacySystem.contactIsPersons(
        visit,
        { record: customerFixture({ id: W, userId: null }), account: null },
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });

  it('the keyed-hash arm: a staff walk-in W + an anonymous companion, as the desk books it, carries W’s contact', () => {
    // The request the staff sheet sends for `[W, a guest with no contact]`
    // and no account (`StaffEditPlanSystem.bookingRequest`): the visit
    // contact is the FIRST walk-in's, and W's record is the one the
    // server seats (`CustomerRecordSystem.walkInGuests`).
    const words: StaffEditWords = {
      walkIn: 'staff.visit.walkIn',
      walkInNumbered: () => 'staff.visit.walkInNumbered',
    };
    const create: StaffCreateContext = {
      homeLocationId: LocationId.of('loc-center'),
      clientId: null,
      bookedFrom: null,
    };
    const leg = (seatId: string, clientId: string): StaffEditDraft.Leg => ({
      seatId: SeatId.of(seatId),
      serviceId: ServiceId.of('svc-classic-cut'),
      variantId: null,
      minutes: duration(30),
      priceCents: cents(2800),
      currency: Currency.EUR,
      typedPriceCents: null,
      barberId: BarberId.of('b-ivan'),
      clientId: draftPersonKey(clientId),
    });
    const draft: StaffEditDraft = {
      revision: null,
      dayKey: FIXTURE_TODAY,
      startMinute: trackMinute(600),
      endMinute: trackMinute(660),
      locationId: null,
      legs: [leg('draft-w', 'guest-w-1'), leg('draft-guest', 'guest-anon-2')],
      note: null,
      discounts: [],
      vouchers: [],
      tipCents: null,
      drawn: null,
      clients: [
        {
          id: draftPersonKey('guest-w-1'),
          label: WALK_IN_SENTINELS.label,
          phone: WALK_IN_SENTINELS.phone,
          email: null,
        },
        {
          id: draftPersonKey('guest-anon-2'),
          label: 'Гост 2',
          phone: null,
          email: null,
        },
      ],
    };
    const result = StaffEditPlanSystem.bookingRequest(draft, create, words);
    if (result === null) throw new Error('the create asked for nothing');
    const request = unwrapOk(result);
    const [walkIn] = CustomerRecordSystem.walkInGuests(
      request.seats,
      fixtureWalkInHash,
    );
    if (walkIn === undefined || request.contact === null) {
      throw new Error('the desk took no walk-in contact');
    }
    const contact = unwrapOk(
      BookingContact.create(request.contact, (raw) => {
        const parsed = PhoneSystem.parse(raw, null);
        return parsed.ok ? parsed.value.e164 : null;
      }),
    );
    const visit = appointmentFixture({
      ownerUserId: null,
      ownerCustomerId: null,
      subjectUserIds: [],
      subjectCustomerIds: [walkIn.customerId],
      seats: [
        seatFixture({
          seatId: SeatId.of('draft-w'),
          occupant: SeatOccupant.walkIn(walkIn.customerId, walkIn.label),
        }),
      ],
      ...contact,
    });
    expect(walkIn.customerId).toBe(W);
    expect(
      ClientPrivacySystem.contactIsPersons(
        visit,
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(true);
    // Another key cannot derive the record: the arm is the keyed digest's
    // (asked of the id arms alone — the whole rule also matches W's phone
    // by value while W's record holds it, P3-DEP-28).
    expect(
      ClientPrivacySystem.contactProvedById(visit, personOf(W), (input) =>
        fixtureWalkInHash(`other-key:${input}`),
      ),
    ).toBe(false);
    expect(
      ClientPrivacySystem.contactProvedById(
        visit,
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(true);
  });

  it('the world’s staff party `[WALK_IN W, ANONYMOUS]` is W’s by the same arm, and nobody else’s', () => {
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.walkInParty,
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(true);
    expect(
      ClientPrivacySystem.contactIsPersons(
        world.visits.walkInParty,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });
});

describe('ClientPrivacySystem — a visit that kept a removed person’s contact (P3-DEP-28)', () => {
  // P booked [SELF P, COMPANION Q] with P's contact; the desk removed P's
  // seat — the mirrors no longer name P, the contact is still P's.
  const removed = withSeatRemoved(personsParty(world), PERSONS_PARTY_SELF_SEAT);

  it('the edit’s write: P is in no mirror, P’s contact is kept', () => {
    expect(removed.subjectCustomerIds).toEqual([Q]);
    expect(removed.ownerCustomerId).toBeNull();
    expect(removed.ownerUserId).toBeNull();
    expect(BookingContact.of(removed)).toEqual(
      BookingContact.of(personsParty(world)),
    );
  });

  it('no id proves the contact P’s — the owner mirrors are gone, its key derives P’s sibling', () => {
    expect(
      ClientPrivacySystem.contactProvedById(
        removed,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });

  it('its value does: the visit carries P’s phone and e-mail, so the contact is P’s — never Q’s', () => {
    expect(
      ClientPrivacySystem.contactCarriesValueOf(removed, personOf(P)),
    ).toBe(true);
    expect(
      ClientPrivacySystem.contactIsPersons(
        removed,
        personOf(P),
        fixtureWalkInHash,
      ),
    ).toBe(true);
    expect(
      ClientPrivacySystem.contactCarriesValueOf(removed, personOf(Q)),
    ).toBe(false);
    expect(
      ClientPrivacySystem.contactIsPersons(
        removed,
        personOf(Q),
        fixtureWalkInHash,
      ),
    ).toBe(false);
  });

  it('the e-mail alone carries it too; another person’s values never do', () => {
    const byEmail = { ...removed, contactPhone: OTHER_SENTINELS.phone };
    expect(
      ClientPrivacySystem.contactCarriesValueOf(byEmail, personOf(P)),
    ).toBe(true);
    expect(
      ClientPrivacySystem.contactCarriesValueOf(
        world.visits.party,
        personOf(P),
      ),
    ).toBe(false);
    expect(
      ClientPrivacySystem.contactCarriesValueOf(
        { ...removed, ...BookingContact.NONE },
        personOf(P),
      ),
    ).toBe(false);
  });

  it('an account value of its own matches as the record’s does', () => {
    const accountPhone = E164.of('+359880000112');
    const person: ClientPerson = {
      record: { ...personOf(P).record, phone: null, email: null },
      account: userFixture({
        id: world.person.userId,
        phone: accountPhone,
        email: null,
      }),
    };
    expect(
      ClientPrivacySystem.contactCarriesValueOf(
        { ...removed, contactPhone: accountPhone, contactEmail: null },
        person,
      ),
    ).toBe(true);
  });

  it('once the stamp cleared the values, nothing matches by value', () => {
    const cleared: ClientPerson = {
      record: { ...personOf(P).record, phone: null, email: null },
      account: userFixture({
        id: world.person.userId,
        phone: null,
        email: null,
      }),
    };
    expect(ClientPrivacySystem.contactCarriesValueOf(removed, cleared)).toBe(
      false,
    );
    expect(
      ClientPrivacySystem.contactIsPersons(removed, cleared, fixtureWalkInHash),
    ).toBe(false);
  });

  it('a walk-in W removed from the staff party `[W, ANONYMOUS]` it was the contact of: W’s by its key and by its value', () => {
    const left = withSeatRemoved(world.visits.walkInParty, SeatId.of('seat-w'));
    expect(left.subjectCustomerIds).toEqual([]);
    expect(
      ClientPrivacySystem.contactProvedById(
        left,
        personOf(W),
        fixtureWalkInHash,
      ),
    ).toBe(true);
    expect(ClientPrivacySystem.contactCarriesValueOf(left, personOf(W))).toBe(
      true,
    );
  });
});

describe('ClientPrivacySystem.contactValuesOf — the person’s contact values (P3-RU-21, P3-DEP-28)', () => {
  it('the record’s and the account’s values, each once, in order', () => {
    expect(ClientPrivacySystem.contactValuesOf(personOf(P))).toEqual([
      Identifier.of(PRIVACY_SENTINELS.phone),
      Identifier.of(PRIVACY_SENTINELS.email),
    ]);
    expect(ClientPrivacySystem.contactValuesOf(personOf(W))).toEqual([
      Identifier.of(WALK_IN_SENTINELS.phone),
    ]);
    const accountPhone = E164.of('+359880000113');
    expect(
      ClientPrivacySystem.contactValuesOf({
        record: personOf(P).record,
        account: userFixture({
          id: world.person.userId,
          phone: accountPhone,
          email: PRIVACY_SENTINELS.email,
        }),
      }),
    ).toEqual([
      Identifier.of(PRIVACY_SENTINELS.phone),
      Identifier.of(PRIVACY_SENTINELS.email),
      Identifier.of(accountPhone),
    ]);
  });

  it('nothing once the stamp cleared them', () => {
    expect(
      ClientPrivacySystem.contactValuesOf({
        record: { ...personOf(P).record, phone: null, email: null },
        account: null,
      }),
    ).toEqual([]);
  });
});

describe('ClientPrivacySystem.isOwnWalkInSeat — the one rule of the person’s own walk-in seat', () => {
  const seatOf = (visit: { readonly seats: readonly Seat[] }, id: string) => {
    const seat = visit.seats.find((entry) => entry.seatId === id);
    if (seat === undefined) throw new Error(`no fixture seat ${id}`);
    return seat;
  };

  it('the person’s own WALK_IN seat → true', () => {
    expect(
      ClientPrivacySystem.isOwnWalkInSeat(
        seatOf(world.visits.walkInParty, 'seat-w'),
        W,
      ),
    ).toBe(true);
    const own = seatFixture({
      occupant: SeatOccupant.walkIn(
        W,
        unwrapOk(SeatLabel.parse(WALK_IN_SENTINELS.label)),
      ),
    });
    expect(ClientPrivacySystem.isOwnWalkInSeat(own, W)).toBe(true);
  });

  it('another record’s WALK_IN seat → false', () => {
    expect(
      ClientPrivacySystem.isOwnWalkInSeat(
        seatOf(world.visits.party, 'seat-q-walk-in'),
        W,
      ),
    ).toBe(false);
    expect(
      ClientPrivacySystem.isOwnWalkInSeat(
        seatOf(world.visits.party, 'seat-q-walk-in'),
        world.otherWalkIn.customerId,
      ),
    ).toBe(true);
  });

  it('an ACCOUNT seat naming the record → false; an ANONYMOUS seat → false', () => {
    expect(
      ClientPrivacySystem.isOwnWalkInSeat(
        seatOf(world.visits.party, 'seat-p-companion'),
        P,
      ),
    ).toBe(false);
    expect(
      ClientPrivacySystem.isOwnWalkInSeat(
        seatOf(world.visits.walkInParty, 'seat-w-guest'),
        W,
      ),
    ).toBe(false);
  });
});

describe('ClientPrivacySystem.distinct — each document once', () => {
  it('keeps a duplicate id once, the FIRST read winning, in the order read — the input untouched', () => {
    const first = { id: 'a', read: 1 };
    const input = deepFreeze([
      first,
      { id: 'b', read: 2 },
      { id: 'a', read: 3 },
    ]);
    expect(ClientPrivacySystem.distinct(input)).toEqual([
      { id: 'a', read: 1 },
      { id: 'b', read: 2 },
    ]);
    expect(ClientPrivacySystem.distinct(input)[0]).toBe(input[0]);
    expect(input).toHaveLength(3);
    expect(ClientPrivacySystem.distinct([])).toEqual([]);
  });
});

describe('ClientPrivacySystem.siblingsAfterPreview — what the card keeps (P3-L-7, Law 10.2)', () => {
  const KEPT = [
    CustomerId.forWalkIn(PRIVACY_SENTINELS.phone, fixtureWalkInHash),
    CustomerId.forWalkIn(PRIVACY_SENTINELS.email, fixtureWalkInHash),
  ];
  const NAMED = [CustomerId.forWalkIn('+359880000114', fixtureWalkInHash)];
  const preview = (
    erasureStatus: ErasureStatus,
    erasureSiblingCustomerIds: readonly CustomerId[],
  ): ClientPrivacyCall.ErasurePreview => ({
    ...ErasureCensus.EMPTY,
    erasureStatus,
    erasureSiblingCustomerIds,
  });

  it('a NONE record’s preview replaces the list — even with []', () => {
    expect(
      ClientPrivacySystem.siblingsAfterPreview(
        KEPT,
        preview(ErasureStatus.None, NAMED),
      ),
    ).toEqual(NAMED);
    expect(
      ClientPrivacySystem.siblingsAfterPreview(
        KEPT,
        preview(ErasureStatus.None, []),
      ),
    ).toEqual([]);
  });

  it('an ERASING or ERASED record’s preview names none — the kept list stays', () => {
    for (const status of [ErasureStatus.Erasing, ErasureStatus.Erased]) {
      expect(
        ClientPrivacySystem.siblingsAfterPreview(KEPT, preview(status, [])),
      ).toEqual(KEPT);
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const kept = deepFreeze([...KEPT]);
    const answered = deepFreeze(preview(ErasureStatus.Erasing, []));
    const once = ClientPrivacySystem.siblingsAfterPreview(kept, answered);
    expect(ClientPrivacySystem.siblingsAfterPreview(kept, answered)).toEqual(
      once,
    );
    expect(kept).toEqual(KEPT);
    expect(answered.erasureSiblingCustomerIds).toEqual([]);
  });
});

describe('ClientPrivacySystem.photoIsPersons', () => {
  const sole = new Set([world.visits.solo.id]);
  const photo = (
    clientCustomerId: CustomerId | null,
    appointmentId: AppointmentId,
  ): AppointmentPhoto => {
    const found = world.state.photos[0];
    if (found === undefined) throw new Error('no fixture photo');
    return {
      ...found,
      id: AppointmentPhotoId.of('photo-probe'),
      clientCustomerId,
      appointmentId,
    };
  };

  it('a photo naming the person is theirs, on any visit', () => {
    expect(
      ClientPrivacySystem.photoIsPersons(
        photo(P, world.visits.party.id),
        sole,
        P,
      ),
    ).toBe(true);
  });

  it('a photo naming somebody else is never theirs, even on their own visit', () => {
    expect(
      ClientPrivacySystem.photoIsPersons(
        photo(Q, world.visits.solo.id),
        sole,
        P,
      ),
    ).toBe(false);
  });

  it('a photo naming nobody is theirs only on a visit only they sat', () => {
    expect(
      ClientPrivacySystem.photoIsPersons(
        photo(null, world.visits.solo.id),
        sole,
        P,
      ),
    ).toBe(true);
    expect(
      ClientPrivacySystem.photoIsPersons(
        photo(null, world.visits.party.id),
        sole,
        P,
      ),
    ).toBe(false);
  });
});

describe('ClientPrivacySystem.linkOf — the one D29 link check (P3-L-9, P3-RU-37 (h))', () => {
  it('a record whose id derives from its userId links that account', () => {
    expect(ClientPrivacySystem.linkOf(personOf(P).record, fixtureHash)).toEqual(
      { ok: true, value: world.person.userId },
    );
    expect(ClientPrivacySystem.linkOf(personOf(Q).record, fixtureHash)).toEqual(
      { ok: true, value: world.other.userId },
    );
  });

  it('a walk-in record links no account — ok(null), nothing to check', () => {
    expect(ClientPrivacySystem.linkOf(personOf(W).record, fixtureHash)).toEqual(
      { ok: true, value: null },
    );
  });

  it('a foreign userId — another person’s uid on P’s record — is a mismatch, never a link', () => {
    const corrupt = customerFixture({ id: P, userId: world.other.userId });
    expect(ClientPrivacySystem.linkOf(corrupt, fixtureHash)).toEqual({
      ok: false,
      error: { errorCode: PrivacyErrorCode.AccountLinkMismatch },
    });
  });

  it('a stale or invented userId on a walk-in record is a mismatch too', () => {
    const stale = customerFixture({ id: W, userId: UserId.of('u-stale') });
    const refused = ClientPrivacySystem.linkOf(stale, fixtureHash);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.errorCode).toBe('PRIVACY_ACCOUNT_LINK_MISMATCH');
      // The refusal names neither id (no uid on the wire).
      expect(Object.keys(refused.error)).toEqual(['errorCode']);
    }
  });

  it('checks under the plain hash only — the walk-in key derives no account record', () => {
    expect(
      ClientPrivacySystem.linkOf(personOf(P).record, fixtureWalkInHash).ok,
    ).toBe(false);
  });
});

describe('ClientPrivacySystem.siblingIdsOf — the walk-in records the person’s contact derives (P3-L-7)', () => {
  it('each non-null value once — the record’s and the account’s shared phone and e-mail derive two ids', () => {
    expect(
      ClientPrivacySystem.siblingIdsOf(personOf(P), fixtureWalkInHash),
    ).toEqual([
      CustomerId.forWalkIn(PRIVACY_SENTINELS.phone, fixtureWalkInHash),
      CustomerId.forWalkIn(PRIVACY_SENTINELS.email, fixtureWalkInHash),
    ]);
  });

  it('the order is record phone, record e-mail, account phone, account e-mail — an account value of its own adds its id', () => {
    const accountPhone = E164.of('+359880000111');
    const accountEmail = Email.of('account@example.invalid');
    const person: ClientPerson = {
      record: personOf(P).record,
      account: userFixture({
        id: world.person.userId,
        phone: accountPhone,
        email: accountEmail,
      }),
    };
    expect(ClientPrivacySystem.siblingIdsOf(person, fixtureWalkInHash)).toEqual(
      [
        CustomerId.forWalkIn(PRIVACY_SENTINELS.phone, fixtureWalkInHash),
        CustomerId.forWalkIn(PRIVACY_SENTINELS.email, fixtureWalkInHash),
        CustomerId.forWalkIn(accountPhone, fixtureWalkInHash),
        CustomerId.forWalkIn(accountEmail, fixtureWalkInHash),
      ],
    );
  });

  it('the record itself is excluded — a walk-in record keyed by its own phone has no sibling by it', () => {
    expect(
      ClientPrivacySystem.siblingIdsOf(personOf(W), fixtureWalkInHash),
    ).toEqual([]);
    const withEmail: ClientPerson = {
      record: { ...personOf(W).record, email: OTHER_SENTINELS.email },
      account: null,
    };
    expect(
      ClientPrivacySystem.siblingIdsOf(withEmail, fixtureWalkInHash),
    ).toEqual([CustomerId.forWalkIn(OTHER_SENTINELS.email, fixtureWalkInHash)]);
  });

  it('a cleared record and account (after the stamp) derive nothing', () => {
    const cleared: ClientPerson = {
      record: { ...personOf(P).record, phone: null, email: null },
      account: userFixture({
        id: world.person.userId,
        phone: null,
        email: null,
      }),
    };
    expect(
      ClientPrivacySystem.siblingIdsOf(cleared, fixtureWalkInHash),
    ).toEqual([]);
  });

  it('derives under the keyed digest — never the plain hash', () => {
    expect(
      ClientPrivacySystem.siblingIdsOf(personOf(P), fixtureHash),
    ).not.toEqual(
      ClientPrivacySystem.siblingIdsOf(personOf(P), fixtureWalkInHash),
    );
  });
});

describe('ClientPrivacySystem.erasureOffer — what the card offers (P3-L-19, Law 10.2)', () => {
  it('NONE → ERASE, ERASING → RESUME, ERASED → RESWEEP — one offer per status', () => {
    expect(ClientPrivacySystem.erasureOffer(ErasureStatus.None)).toBe(
      ErasureOffer.Erase,
    );
    expect(ClientPrivacySystem.erasureOffer(ErasureStatus.Erasing)).toBe(
      ErasureOffer.Resume,
    );
    expect(ClientPrivacySystem.erasureOffer(ErasureStatus.Erased)).toBe(
      ErasureOffer.Resweep,
    );
    const offers = Object.values(ErasureStatus).map((status) =>
      ClientPrivacySystem.erasureOffer(status),
    );
    expect(new Set(offers).size).toBe(Object.values(ErasureOffer).length);
  });
});

describe('ClientPrivacySystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(privacyWorld());
    const person: ClientPerson = deepFreeze({
      record: customerFixture({
        id: frozen.person.customerId,
        userId: frozen.person.userId,
      }),
      account: null,
    });
    const run = () => ({
      sole: ClientPrivacySystem.isSoleSubject(
        frozen.visits.party,
        frozen.person.customerId,
      ),
      key: ClientPrivacySystem.contactKeyOf(frozen.visits.party),
      mine: ClientPrivacySystem.contactIsPersons(
        frozen.visits.solo,
        person,
        fixtureWalkInHash,
      ),
      seats: frozen.visits.walkInParty.seats.map((seat) =>
        ClientPrivacySystem.isOwnWalkInSeat(seat, frozen.walkIn.customerId),
      ),
      values: ClientPrivacySystem.contactValuesOf(person),
      carries: ClientPrivacySystem.contactCarriesValueOf(
        frozen.visits.solo,
        person,
      ),
      proved: ClientPrivacySystem.contactProvedById(
        frozen.visits.solo,
        person,
        fixtureWalkInHash,
      ),
      once: ClientPrivacySystem.distinct(frozen.state.visits),
      photos: frozen.state.photos.map((entry) =>
        ClientPrivacySystem.photoIsPersons(
          entry,
          new Set([frozen.visits.solo.id]),
          frozen.person.customerId,
        ),
      ),
      link: ClientPrivacySystem.linkOf(person.record, fixtureHash),
      siblings: ClientPrivacySystem.siblingIdsOf(person, fixtureWalkInHash),
      offer: ClientPrivacySystem.erasureOffer(person.record.erasureStatus),
    });
    expect(run()).toEqual(run());
    expect(run().seats).toEqual([true, false]);
    expect(run().once).toEqual(frozen.state.visits);
    expect(run().photos).toEqual([true, true, true, false, false]);
    expect(run().link).toEqual({ ok: true, value: frozen.person.userId });
    expect(run().offer).toBe(ErasureOffer.Erase);
  });

  it('never names a uid as a record id: an account seat’s uid is not the record', () => {
    expect(
      ClientPrivacySystem.isSoleSubject(
        appointmentFixture({
          seats: [
            seatFixture({
              occupant: SeatOccupant.account(
                UserId.of('u-privacy-p'),
                Q,
                SubjectRelationship.Self,
              ),
            }),
          ],
        }),
        P,
      ),
    ).toBe(false);
  });
});
