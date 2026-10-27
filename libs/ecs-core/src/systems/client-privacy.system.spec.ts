import { describe, expect, it } from 'vitest';
import {
  BookingContact,
  type StaffEditDraft,
  SeatLabel,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
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
  fixtureWalkInHash,
  OTHER_SENTINELS,
  privacyWorld,
  seatFixture,
  trackMinute,
  unwrapOk,
  WALK_IN_SENTINELS,
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
    // Another key cannot derive the record: the arm is the keyed digest's.
    expect(
      ClientPrivacySystem.contactIsPersons(visit, personOf(W), (input) =>
        fixtureWalkInHash(`other-key:${input}`),
      ),
    ).toBe(false);
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

describe('ClientPrivacySystem.ownWalkInSeatIds', () => {
  it('names the person’s walk-in seats, in seat order, and nobody else’s', () => {
    const visit = appointmentFixture({
      seats: [
        seatFixture({
          seatId: SeatId.of('a'),
          occupant: SeatOccupant.walkIn(
            W,
            unwrapOk(SeatLabel.parse(WALK_IN_SENTINELS.label)),
          ),
        }),
      ],
    });
    expect(ClientPrivacySystem.ownWalkInSeatIds(visit, W)).toEqual([
      SeatId.of('a'),
    ]);
    expect(
      ClientPrivacySystem.ownWalkInSeatIds(world.visits.walkInParty, W),
    ).toEqual([SeatId.of('seat-w')]);
    expect(ClientPrivacySystem.ownWalkInSeatIds(world.visits.party, P)).toEqual(
      [],
    );
    expect(
      ClientPrivacySystem.ownWalkInSeatIds(
        world.visits.party,
        world.otherWalkIn.customerId,
      ),
    ).toEqual([SeatId.of('seat-q-walk-in')]);
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
      seats: ClientPrivacySystem.ownWalkInSeatIds(
        frozen.visits.walkInParty,
        frozen.walkIn.customerId,
      ),
      photos: frozen.state.photos.map((entry) =>
        ClientPrivacySystem.photoIsPersons(
          entry,
          new Set([frozen.visits.solo.id]),
          frozen.person.customerId,
        ),
      ),
    });
    expect(run()).toEqual(run());
    expect(run().photos).toEqual([true, true, true, false, false]);
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
