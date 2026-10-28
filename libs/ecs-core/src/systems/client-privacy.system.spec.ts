import { describe, expect, it } from 'vitest';
import {
  BookingContact,
  E164,
  Email,
  ErasureOffer,
  ErasureStatus,
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
  PRIVACY_SENTINELS,
  privacyWorld,
  seatFixture,
  trackMinute,
  unwrapOk,
  userFixture,
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
      link: ClientPrivacySystem.linkOf(person.record, fixtureHash),
      siblings: ClientPrivacySystem.siblingIdsOf(person, fixtureWalkInHash),
      offer: ClientPrivacySystem.erasureOffer(person.record.erasureStatus),
    });
    expect(run()).toEqual(run());
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
