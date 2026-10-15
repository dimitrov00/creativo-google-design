import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberPreference,
  BookingLifecycle,
  BookingPolicy,
  PlacementPolicy,
  StaffTermsOverride,
  ScheduleVersion,
  ShiftSegment,
  SeatLabel,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ServiceTerms,
} from '@core/components';
import {
  BookingError,
  Weekday,
  SchedulingError,
  Currency,
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
  BarberId,
  LocationId,
  OperationId,
  SeatId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
  LocalDate,
  type MinuteOfDay,
  PriceCents,
} from '@core/primitives';
import type { Appointment, Service } from '@core/entities';
import {
  FIXTURE_NOW,
  FIXTURE_TODAY,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  serviceFixture,
  type SeatFixtureOverrides,
  appointmentFixture,
  seatFixture,
  resolvedCustomerIds,
  customerOf,
} from '@core/testing';
import {
  AppointmentEditSystem,
  LedgerVerdict,
} from './appointment-edit.system';
import {
  BookingDecisionSystem,
  type RequestedSeatInput,
} from './booking-decision.system';
import { RequestedSubjectRole } from './guest-label.system';
import {
  CarriedSeatRefusal,
  type MoveCartSeatInput,
  MoveErrorCode,
  type MovePlan,
  type MoveRider,
  MoveSubjectRole,
  MoveSystem,
} from './move.system';

/*
 * The cases of libs/domain/scheduling/src/lib/move-shift.spec.ts,
 * libs/features/client/booking/.../rider-placement.spec.ts and
 * .../carried-reach.spec.ts, the booker's-seats and chair-time cases of
 * appointment.spec.ts, and the plan's math of
 * apps/functions/src/use-cases/reschedule-booking.use-case.spec.ts — copied
 * (the originals keep running against their shims), on the ONE shop day a
 * move lands on (wall-clock minutes, F-6). The decision itself (is the
 * chair free?) is BookingDecisionSystem's and its own spec's; here the plan
 * it is decided with, and the refusal a carried seat's failure becomes.
 */

const at = (hour: number, min = 0): MinuteOfDay => minute(hour * 60 + min);
const delta = (minutes: number): MinuteDelta =>
  unwrapOk(MinuteDelta.of(minutes));

/** A minute of a shop day where every shift below stays on that day. */
const midday = fc.integer({ min: 600, max: 800 }).map(minute);

describe('the move shift — where a carried seat lands', () => {
  it('moves a carried seat by exactly as far as the cart’s earliest seat moved (property)', () => {
    fc.assert(
      fc.property(midday, midday, midday, (anchor, seatStart, cartEarliest) => {
        const offset = MoveSystem.carriedOffsetMinutes(seatStart, anchor);
        expect(MoveSystem.carriedStartMinutes(cartEarliest, offset)).toBe(
          seatStart + (cartEarliest - anchor),
        );
      }),
    );
  });

  it('keeps every carried seat’s distance from every other — the party moves rigidly (property)', () => {
    fc.assert(
      fc.property(
        midday,
        fc.array(fc.integer({ min: -600, max: 600 }), {
          minLength: 2,
          maxLength: 5,
        }),
        midday,
        (anchor, offsets, cartEarliest) => {
          const before = offsets.map((minutes) => minute(anchor + minutes));
          const after = before.map((start) =>
            MoveSystem.carriedStartMinutes(
              cartEarliest,
              MoveSystem.carriedOffsetMinutes(start, anchor),
            ),
          );
          for (const [index, start] of after.entries()) {
            expect((start as number) - (after[0] as number)).toBe(
              (before.at(index) as number) - (before[0] as number),
            );
          }
        },
      ),
    );
  });

  it('changes nothing when the cart lands where it already was (property)', () => {
    fc.assert(
      fc.property(midday, midday, (anchor, seatStart) => {
        expect(
          MoveSystem.carriedStartMinutes(
            anchor,
            MoveSystem.carriedOffsetMinutes(seatStart, anchor),
          ),
        ).toBe(seatStart);
      }),
    );
  });

  it('keeps the offset in whole minutes, negative when the carried seat goes first', () => {
    const anchor = at(10);
    expect(MoveSystem.carriedOffsetMinutes(at(10, 45), anchor)).toBe(45);
    expect(MoveSystem.carriedOffsetMinutes(at(9, 30), anchor)).toBe(-30);
    // Minutes of the wall clock are whole by construction: a stray second
    // never becomes a fractional offset the draft or the engine would carry.
    expect(
      Number.isInteger(MoveSystem.carriedOffsetMinutes(at(10, 45), anchor)),
    ).toBe(true);
  });

  it('never lands a carried seat off the shop day — the plan refuses it instead', () => {
    expect(MoveSystem.carriedStartMinutes(at(0, 10), delta(-30))).toBeNull();
    expect(MoveSystem.carriedStartMinutes(at(23, 50), delta(15))).toBeNull();
  });
});

/* ── The review card (rider-placement.spec.ts) ───────────────────────── */

function rider(
  offsetMinutes: number,
  overrides: Partial<MoveRider> = {},
): MoveRider {
  return {
    serviceId: ServiceId.of('svc-beard'),
    variantId: null,
    barberId: BarberId.of('petar'),
    offsetMinutes: delta(offsetMinutes),
    durationMinutes: unwrapOk(DurationMinutes.of(30)),
    setupMinutes: MinuteCount.ZERO,
    cleanupMinutes: MinuteCount.ZERO,
    ...overrides,
  };
}

describe('MoveSystem.placeRiders — the server’s shift, restated for the review card', () => {
  it('seats a side-by-side companion at the booker’s new start', () => {
    const [placed] = MoveSystem.placeRiders([at(14)], [rider(0)]);
    expect(placed?.startMinutes).toBe(at(14));
  });

  it('keeps a companion straight after the booker straight after them', () => {
    const [placed] = MoveSystem.placeRiders([at(14)], [rider(45)]);
    expect(placed?.startMinutes).toBe(at(14, 45));
  });

  it('anchors on the EARLIEST seat the cart holds, whatever order it lists them in', () => {
    const [placed] = MoveSystem.placeRiders([at(15), at(14, 30)], [rider(-30)]);
    expect(placed?.startMinutes).toBe(at(14));
  });

  it('places nobody when there is no seat to anchor to', () => {
    expect(MoveSystem.placeRiders([], [rider(0)])).toEqual([]);
  });

  it('preserves every rider’s distance from the cart’s first seat (property)', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 9 * 4, max: 17 * 4 })
          .map((quarters) => quarters * 15),
        fc.array(
          fc.integer({ min: -24, max: 24 }).map((steps) => steps * 5),
          { maxLength: 4 },
        ),
        (startMinutes, offsets) => {
          const start = minute(startMinutes);
          const placed = MoveSystem.placeRiders(
            [start],
            offsets.map((o) => rider(o)),
          );
          expect(
            placed.map((entry) => (entry.startMinutes as number) - start),
          ).toEqual(offsets);
        },
      ),
    );
  });
});

/* ── Is the carried party still in reach (carried-reach.spec.ts) ─────── */

function offered(
  id: string,
  locationIds: readonly string[] = [],
  variants: readonly string[] = [],
): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    locationIds: locationIds.map(LocationId.of),
    variants: variants.map((variant) => ({
      variantId: ServiceVariantId.of(variant),
      name: { bg: variant, en: variant },
    })),
  });
}

function beard(
  variants: readonly string[] = [],
  locationIds: readonly string[] = [],
): Service {
  return offered('svc-beard', locationIds, variants);
}

const petar = [BarberId.of('petar')];

function son(overrides: Partial<MoveRider> = {}): MoveRider {
  return rider(0, overrides);
}
describe('MoveSystem.carriedSeatsInReach — can the shop still serve who a move carries?', () => {
  const inReach = MoveSystem.carriedSeatsInReach;
  const shops = (...ids: string[]) => ids.map(LocationId.of);

  it('is true when the barber is active and the service (and its variant) still offered', () => {
    expect(inReach([son()], petar, [beard()], null)).toBe(true);
    expect(
      inReach(
        [son({ variantId: ServiceVariantId.of('v-long') })],
        petar,
        [beard(['v-short', 'v-long'])],
        null,
      ),
    ).toBe(true);
  });

  it('is true for a move that carries nobody', () => {
    expect(inReach([], [], [], null)).toBe(true);
  });

  it('is false when the barber is off the active list', () => {
    expect(inReach([son()], [BarberId.of('ivan')], [beard()], null)).toBe(
      false,
    );
  });

  it('is false when the service is retired', () => {
    expect(inReach([son()], petar, [], null)).toBe(false);
  });

  it('is false when only the VARIANT the seat was sold as is retired — the server refuses that too', () => {
    expect(
      inReach(
        [son({ variantId: ServiceVariantId.of('v-long') })],
        petar,
        [beard(['v-short'])],
        null,
      ),
    ).toBe(false);
  });

  it('keeps a seat sold before its service had variants — the server keeps its stored terms', () => {
    expect(inReach([son()], petar, [beard(['v-short'])], null)).toBe(true);
  });

  it('is false when ANY one of several carried seats is out of reach', () => {
    expect(
      inReach(
        [son(), son({ barberId: BarberId.of('niko') })],
        petar,
        [beard()],
        null,
      ),
    ).toBe(false);
  });

  it('is false when no ACTIVE shop offers the carried seat’s service any more', () => {
    expect(
      inReach(
        [son()],
        petar,
        [beard([], ['loc-closed'])],
        shops('loc-center', 'loc-mladost'),
      ),
    ).toBe(false);
  });

  it('is true while ONE active shop still offers it — which shop is the schedule step’s to say', () => {
    expect(
      inReach(
        [son()],
        petar,
        [beard([], ['loc-center'])],
        shops('loc-center', 'loc-mladost'),
      ),
    ).toBe(true);
    expect(inReach([son()], petar, [beard()], shops('loc-mladost'))).toBe(true);
  });

  it('does not ask about shops before the shop read has answered — a list that has not arrived is not “no shop”', () => {
    expect(inReach([son()], petar, [beard([], ['loc-closed'])], null)).toBe(
      true,
    );
  });

  it('is false when the shop read has answered with no active shop — there is nowhere to seat him', () => {
    expect(inReach([son()], petar, [beard()], [])).toBe(false);
  });

  it('is false when every carried seat is served somewhere but no ONE active shop serves them all', () => {
    const riders = [
      son({ serviceId: ServiceId.of('svc-fade') }),
      son({
        serviceId: ServiceId.of('svc-braids'),
        barberId: BarberId.of('niko'),
      }),
    ];
    const services = [
      offered('svc-fade', ['loc-center']),
      offered('svc-braids', ['loc-mladost']),
    ];
    const barbers = [BarberId.of('petar'), BarberId.of('niko')];
    const active = shops('loc-center', 'loc-mladost');
    expect(inReach(riders, barbers, services, active)).toBe(false);
    for (const one of riders) {
      expect(inReach([one], barbers, services, active)).toBe(true);
    }
  });

  it('is true when one active shop serves every carried seat, whatever else each is offered at', () => {
    expect(
      inReach(
        [
          son({ serviceId: ServiceId.of('svc-fade') }),
          son({
            serviceId: ServiceId.of('svc-braids'),
            barberId: BarberId.of('niko'),
          }),
        ],
        [BarberId.of('petar'), BarberId.of('niko')],
        [
          offered('svc-fade', ['loc-center', 'loc-mladost']),
          offered('svc-braids', ['loc-mladost']),
        ],
        shops('loc-center', 'loc-mladost'),
      ),
    ).toBe(true);
  });

  it('is true exactly when some active shop offers every carried service', () => {
    const SHOP_IDS = ['loc-a', 'loc-b', 'loc-c'] as const;
    const SERVICE_IDS = ['svc-1', 'svc-2', 'svc-3', 'svc-4'] as const;
    const reachOf = fc.subarray([...SHOP_IDS, 'loc-closed']);
    fc.assert(
      fc.property(
        fc.tuple(reachOf, reachOf, reachOf, reachOf),
        fc.subarray([...SHOP_IDS]),
        fc.array(fc.constantFrom(...SERVICE_IDS), {
          minLength: 1,
          maxLength: 4,
        }),
        (reaches, activeShops, carriedServices) => {
          const reachById = new Map(
            SERVICE_IDS.map((id, index) => [id, reaches.at(index) ?? []]),
          );
          const services = SERVICE_IDS.map((id) =>
            offered(id, reachById.get(id)),
          );
          const riders = carriedServices.map((serviceId) =>
            son({ serviceId: ServiceId.of(serviceId) }),
          );
          const servesAt = (
            serviceId: (typeof SERVICE_IDS)[number],
            shopId: string,
          ): boolean => {
            const reach = reachById.get(serviceId) ?? [];
            return reach.length === 0 || reach.includes(shopId);
          };
          const expected = activeShops.some((shopId) =>
            carriedServices.every((serviceId) => servesAt(serviceId, shopId)),
          );
          expect(
            inReach(riders, petar, services, activeShops.map(LocationId.of)),
          ).toBe(expected);
        },
      ),
    );
  });
});

/* ── Whose seats the booker can move (appointment.spec.ts) ───────────── */

const OWNER = UserId.of('user-owner');
const SON = UserId.of('user-son');

function guest(label: string): SeatOccupant {
  return SeatOccupant.anonymous(unwrapOk(SeatLabel.parse(label)));
}

/** Seats an hour apart from 10:00, so the party is valid whoever sits where. */
function visitOf(...occupants: SeatOccupant[]): Appointment {
  return appointmentFixture({
    ownerUserId: OWNER,
    seats: occupants.map((occupant, index) =>
      seatFixture({
        seatId: SeatId.of(`seat-${index}`),
        occupant,
        barberId: BarberId.of(`barber-${index}`),
        startMinutes: at(10 + index),
      }),
    ),
  });
}

describe('MoveSystem — which seats the booker can move', () => {
  it('names the booker’s own seat and every anonymous guest, in seat order — never the companion', () => {
    const visit = visitOf(
      SeatOccupant.account(OWNER, customerOf(OWNER), SubjectRelationship.Self),
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
      guest('Мария'),
    );
    expect(
      MoveSystem.seatsTheBookerCanMove(visit, OWNER).map((s) => s.seatSubject),
    ).toEqual(['ACCOUNT', 'ANONYMOUS']);
    expect(MoveSystem.hasSeatTheBookerCanMove(visit, OWNER)).toBe(true);
  });

  it('has nothing for the booker once only a companion is left — the shop moves that visit', () => {
    const visit = visitOf(
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
    );
    expect(MoveSystem.seatsTheBookerCanMove(visit, OWNER)).toEqual([]);
    expect(MoveSystem.hasSeatTheBookerCanMove(visit, OWNER)).toBe(false);
  });

  it('does not hand the booker a `SELF` seat that belongs to another account', () => {
    const visit = visitOf(
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Self),
    );
    expect(MoveSystem.hasSeatTheBookerCanMove(visit, OWNER)).toBe(false);
  });

  it('measures a move from the booker’s EARLIEST seat — a companion going first does not move the anchor', () => {
    const visit = visitOf(
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
      SeatOccupant.account(OWNER, customerOf(OWNER), SubjectRelationship.Self),
      guest('Мария'),
    );
    expect(MoveSystem.moveAnchor(visit, OWNER)).toBe(at(11));
  });

  it('has no anchor when nothing is the booker’s', () => {
    const visit = visitOf(
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
    );
    expect(MoveSystem.moveAnchor(visit, OWNER)).toBeNull();
  });

  it('agrees with the per-seat rule, seat for seat', () => {
    const visit = visitOf(
      SeatOccupant.account(OWNER, customerOf(OWNER), SubjectRelationship.Self),
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Self),
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
      guest('Гост 1'),
    );
    expect(MoveSystem.seatsTheBookerCanMove(visit, OWNER)).toEqual([
      visit.seats[0],
      visit.seats[3],
    ]);
  });
});

function terms(
  price: number,
  duration: number,
  setup = 0,
  cleanup = 0,
): ServiceTerms {
  return ServiceTerms.of(
    unwrapOk(PriceCents.of(price)),
    Currency.EUR,
    unwrapOk(DurationMinutes.of(duration)),
    unwrapOk(MinuteCount.of(setup)),
    unwrapOk(MinuteCount.of(cleanup)),
  );
}

describe('MoveSystem.release — what a move hands back before it re-places the visit', () => {
  it('holds each seat’s barber for setup, the service and cleanup — the span the busy projection records', () => {
    const ivan = BarberId.of('ivan');
    const niko = BarberId.of('niko');
    const visit = appointmentFixture({
      seats: [
        seatFixture({
          seatId: SeatId.of('a'),
          barberId: ivan,
          terms: Seat.termsOf(terms(2500, 45, 5, 10), null),
          startMinutes: at(10),
        }),
        seatFixture({
          seatId: SeatId.of('b'),
          barberId: niko,
          startMinutes: at(10, 30),
        }),
      ],
    });
    const chairs = MoveSystem.release(visit);
    expect(chairs.map((chair) => chair.barberId)).toEqual([ivan, niko]);
    expect(chairs[0]).toMatchObject({
      startMinutes: at(9, 55),
      endMinutes: 655,
    });
    expect(chairs[1]).toMatchObject({
      startMinutes: at(10, 30),
      endMinutes: 660,
    });
  });
});

describe('MoveSystem.facts — what the booking flow decides a move with', () => {
  it('carries the shop’s seats by their distance from the anchor, on their sold terms, and every chair', () => {
    const visit = visitOf(
      SeatOccupant.account(OWNER, customerOf(OWNER), SubjectRelationship.Self),
      SeatOccupant.account(SON, customerOf(SON), SubjectRelationship.Companion),
    );
    const facts = MoveSystem.facts(visit, OWNER);
    expect(facts?.riders).toEqual([
      {
        serviceId: visit.seats[1]?.serviceId,
        variantId: null,
        barberId: BarberId.of('barber-1'),
        offsetMinutes: 60,
        durationMinutes: 30,
        setupMinutes: 0,
        cleanupMinutes: 0,
      },
    ]);
    expect(facts?.release).toEqual(MoveSystem.release(visit));
    expect(
      MoveSystem.facts(
        visitOf(
          SeatOccupant.account(
            SON,
            customerOf(SON),
            SubjectRelationship.Companion,
          ),
        ),
        OWNER,
      ),
    ).toBeNull();
  });
});

/* ── The plan of a client's move (reschedule-booking.use-case.spec.ts) ─ */

const IVAN = BarberId.of('ivan');
const PETAR = BarberId.of('petar');
const CUT = ServiceId.of('svc-cut');
const BEARD = ServiceId.of('svc-beard');
const CENTER = LocationId.of('loc-center');

function seat(id: string, overrides: SeatFixtureOverrides = {}): Seat {
  return seatFixture({ ...overrides, seatId: SeatId.of(id) });
}

/** The father at 10:00 with Ivan and his son beside him with Petar. */
function party(
  sonOffsetMinutes = 0,
  sonOccupant?: SeatOccupant,
  lifecycle?: BookingLifecycle,
): Appointment {
  return appointmentFixture({
    locationId: CENTER,
    ownerUserId: OWNER,
    ...(lifecycle === undefined ? {} : { lifecycle }),
    seats: [
      seat('seat-father', {
        serviceId: CUT,
        barberId: IVAN,
        barberPreference: BarberPreference.Specific,
        startMinutes: at(10),
        occupant: SeatOccupant.account(
          OWNER,
          customerOf(OWNER),
          SubjectRelationship.Self,
        ),
      }),
      seat('seat-son', {
        serviceId: BEARD,
        barberId: PETAR,
        barberPreference: BarberPreference.Any,
        startMinutes: minute(600 + sonOffsetMinutes),
        terms: Seat.termsOf(terms(1500, 30), null),
        occupant:
          sonOccupant ??
          SeatOccupant.account(
            SON,
            customerOf(SON),
            SubjectRelationship.Companion,
          ),
      }),
    ],
  });
}

function cartSeat(
  startMinutes: MinuteOfDay,
  overrides: Partial<MoveCartSeatInput> = {},
): MoveCartSeatInput {
  return {
    moveSubjectRole: MoveSubjectRole.Self,
    label: null,
    serviceId: CUT,
    variantId: null,
    barberId: IVAN,
    barberPreference: BarberPreference.Specific,
    startMinutes,
    ...overrides,
  };
}

function plan(
  appointment: Appointment,
  seats: readonly MoveCartSeatInput[],
  locationId: LocationId = CENTER,
  localDate: LocalDate = FIXTURE_TODAY,
) {
  return MoveSystem.plan(appointment, OWNER, { locationId, localDate, seats });
}

describe('MoveSystem.plan — a companion the cart cannot express', () => {
  it('carries the companion forward with their identity and facts, beside the client at the new time', () => {
    const planned = unwrapOk(plan(party(), [cartSeat(at(14))]));
    expect(planned.carried).toHaveLength(1);
    const carriedSon = planned.carried[0];
    expect(carriedSon?.seatId).toBe('seat-son');
    expect(carriedSon?.userId).toBe(SON);
    expect(carriedSon?.seat.serviceId).toBe(BEARD);
    expect(carriedSon?.seat.barberId).toBe(PETAR);
    expect(carriedSon?.seat.barberPreference).toBe('ANY');
    // The terms he was SOLD at — a move is not a re-sale.
    expect(carriedSon?.terms).toMatchObject({
      priceCents: 1500,
      durationMinutes: 30,
    });
    // Parallel stays parallel.
    expect(carriedSon?.startMinutes).toBe(at(14));
    expect(planned.unchanged).toBe(false);
  });

  it('keeps a sequential party sequential — the companion moves by exactly what the client moved', () => {
    // The legacy `sequentialParty()`: the son in Ivan's chair after his
    // father, 10:00 → 14:00 for the father; 10:55 → 14:55 for the son,
    // same chair.
    const sequential = {
      ...party(55),
      seats: [
        party().seats[0] as Seat,
        { ...(party(55).seats[1] as Seat), barberId: IVAN },
      ],
    };
    const planned = unwrapOk(plan(sequential, [cartSeat(at(14))]));
    expect(planned.carried[0]?.startMinutes).toBe(at(14, 55));
    expect(planned.carried[0]?.seat.barberId).toBe('ivan');
  });

  it('carries a `SELF` seat bound to ANOTHER account — `SELF` alone is not the owner’s', () => {
    const foreignSelf = SeatOccupant.account(
      SON,
      customerOf(SON),
      SubjectRelationship.Self,
    );
    const planned = unwrapOk(plan(party(55, foreignSelf), [cartSeat(at(14))]));
    expect(planned.replaced.map((s) => s.seatId)).toEqual(['seat-father']);
    expect(planned.carried.map((line) => SeatOccupant.of(line.seat))).toEqual([
      foreignSelf,
    ]);
    expect(planned.carried[0]?.startMinutes).toBe(at(14, 55));
  });

  it('preserves any relative offset, early or late, parallel or sequential (property)', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 9 * 4, max: 15 * 4 })
          .map((quarters) => quarters * 15),
        fc.integer({ min: -12, max: 12 }).map((steps) => steps * 5),
        (targetMinutes, offsetMinutes) => {
          const target = minute(targetMinutes);
          const planned = unwrapOk(
            plan(party(offsetMinutes), [cartSeat(target)]),
          );
          expect((planned.carried[0]?.startMinutes ?? 0) - target).toBe(
            offsetMinutes,
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it('refuses a visit that holds nobody but a companion — the shop moves it', () => {
    const onlySon = { ...party(), seats: [party().seats[1] as Seat] };
    expect(unwrapErr(plan(onlySon, [cartSeat(at(14))]))).toEqual({
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal: CarriedSeatRefusal.ShopOnly,
      seatIds: ['seat-son'],
    });
  });

  it('refuses a carried seat its kept distance would take off the shop day', () => {
    // The son sits half an hour before his father; the father moves to
    // 00:10, so the son would start at 23:40 the day before.
    expect(unwrapErr(plan(party(-30), [cartSeat(at(0, 10))]))).toEqual({
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal: CarriedSeatRefusal.BarberUnavailable,
      seatIds: ['seat-son'],
    });
  });

  it('never lets a client payload seat another account', () => {
    expect(
      unwrapErr(
        plan(party(), [
          cartSeat(at(14), { moveSubjectRole: MoveSubjectRole.Companion }),
        ]),
      ),
    ).toEqual(BookingError.invalidInput('subject'));
  });

  it('never lets a cart line borrow a carried seat’s terms by naming its line — the server re-keys both', () => {
    const planned = unwrapOk(
      plan(party(), [cartSeat(at(14)), cartSeat(at(15))]),
    );
    expect(planned.cart.map((line) => line.lineId)).toEqual([
      'cart-0',
      'cart-1',
    ]);
    expect(planned.carried.map((line) => line.lineId)).toEqual(['carried-0']);
  });
});

describe('MoveSystem.plan — the self and guest seats behave as before', () => {
  it('answers a retried move as the move it already was — nothing changes', () => {
    const planned = unwrapOk(plan(party(), [cartSeat(at(10))]));
    expect(planned.unchanged).toBe(true);
    expect(planned.carried[0]?.startMinutes).toBe(at(10));
  });

  it('is not the move it already was on ANOTHER day at the same minute', () => {
    const tomorrow = LocalDate.addDays(FIXTURE_TODAY, 1);
    expect(
      unwrapOk(plan(party(), [cartSeat(at(10))], CENTER, tomorrow)).unchanged,
    ).toBe(false);
  });

  it('answers a retried move with a NAMED guest as a replay — the guest travels under the label the visit stored', () => {
    const withGuest = {
      ...party(),
      seats: [
        party().seats[0] as Seat,
        seat('seat-guest', {
          serviceId: BEARD,
          barberId: PETAR,
          barberPreference: null,
          startMinutes: at(10),
          occupant: guest('Синът'),
        }),
      ],
    };
    const cart = [
      cartSeat(at(10)),
      cartSeat(at(10), {
        moveSubjectRole: MoveSubjectRole.Guest,
        label: ' Синът ',
        serviceId: BEARD,
        barberId: PETAR,
        barberPreference: null,
      }),
    ];
    expect(unwrapOk(plan(withGuest, cart)).unchanged).toBe(true);
    expect(
      unwrapOk(plan(withGuest, cart, LocationId.of('loc-mladost'))).unchanged,
    ).toBe(false);
  });

  it('still refuses a party with a resolved seat — unless nothing would change', () => {
    const served = {
      ...party(),
      seats: [
        party().seats[0] as Seat,
        Seat.withOutcome(
          party().seats[1] as Seat,
          SeatOutcome.worked(utcMs('2026-09-28T10:30:00+03:00')),
        ),
      ],
    };
    expect(unwrapErr(plan(served, [cartSeat(at(14))]))).toEqual(
      BookingError.invalidInput('seat_resolved'),
    );
    expect(plan(served, [cartSeat(at(10))]).ok).toBe(true);
  });

  it('refuses a visit the graph will not let go, and an empty cart', () => {
    const done = party(
      0,
      undefined,
      BookingLifecycle.complete(utcMs('2026-09-28T11:00:00+03:00')),
    );
    expect(unwrapErr(plan(done, [cartSeat(at(14))]))).toEqual(
      BookingError.invalidInput('status'),
    );
    expect(unwrapErr(plan(party(), []))).toEqual(
      BookingError.invalidInput('seats'),
    );
  });

  it('hands back every chair the visit holds before it is placed again', () => {
    const planned = unwrapOk(plan(party(), [cartSeat(at(14))]));
    expect(planned.release).toEqual(MoveSystem.release(party()));
  });
});

describe('MoveSystem.carriedRefusalOf — what the client is told to phone about', () => {
  it('names the barber, the service, the window or the party, from the commit refusal', () => {
    const cases: readonly [BookingError, string][] = [
      [
        BookingError.slotUnavailable(PETAR, FIXTURE_TODAY, at(14), 1),
        'barber_unavailable',
      ],
      [
        BookingError.barberNotRostered(PETAR, FIXTURE_TODAY),
        'barber_unavailable',
      ],
      [BookingError.unknownService('svc-beard'), 'service_unavailable'],
      [
        BookingError.serviceNotAtLocation('svc-beard', 'loc-center'),
        'service_unavailable',
      ],
      [
        BookingError.tooSoon(unwrapOk(MinuteCount.of(120))),
        'outside_booking_window',
      ],
      [BookingError.beyondHorizon(2), 'outside_booking_window'],
      [BookingError.invalidInput('variantId'), 'service_unavailable'],
      [BookingError.invalidInput('person_overlap'), 'party_conflict'],
      [
        BookingError.invariantViolated([
          SchedulingError.appointmentPastStartTime(),
        ]),
        'outside_booking_window',
      ],
      [
        BookingError.invariantViolated([
          SchedulingError.appointmentBarberDoubleBooked(PETAR),
        ]),
        'party_conflict',
      ],
      [BookingError.partyTooLarge(5), 'party_conflict'],
    ];
    for (const [error, refusal] of cases) {
      expect(MoveSystem.carriedRefusalOf(error)).toBe(refusal);
    }
  });
});

/* ── The plan, decided (reschedule-booking.use-case.spec.ts L421, L699) ── */

describe('MoveSystem.plan → BookingDecisionSystem.decide', () => {
  const MONDAY_09_18 = (barberId: BarberId) => ({
    barberId,
    versions: ScheduleVersion.startingWith(
      [ShiftSegment.of(Weekday.Mon, CENTER, at(9), endMinute(18 * 60))],
      localDate('2026-01-01'),
    ),
    turnaroundMinutes: MinuteCount.ZERO,
  });
  const servedBoth = (id: ServiceId, minutes: number): Service => {
    const sold = terms(2500, minutes);
    return serviceFixture({
      id,
      ...sold,
      offerings: [
        { barberId: IVAN, overrides: [], ...sold },
        { barberId: PETAR, overrides: [], ...sold },
      ],
      locationIds: [CENTER],
    });
  };

  /**
   * The request the pipeline decides a plan with: the cart's lines first
   * (the owner, or a guest by label), then the carried seats as their
   * stored people at their shifted starts, at the terms they were sold at.
   */
  function decide(planned: MovePlan) {
    const cart: RequestedSeatInput[] = planned.cart.map((line) => ({
      lineId: line.lineId,
      serviceId: line.seat.serviceId,
      variantId: line.seat.variantId,
      barberId: line.seat.barberId,
      barberPreference: line.seat.barberPreference,
      startMinutes: line.seat.startMinutes,
      subject:
        line.seat.moveSubjectRole === MoveSubjectRole.Guest
          ? {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: line.seat.label ?? '',
              guestKey: null,
            }
          : { requestedSubjectRole: RequestedSubjectRole.Self },
    }));
    const carried: RequestedSeatInput[] = planned.carried.map((line) => ({
      lineId: line.lineId,
      serviceId: line.seat.serviceId,
      variantId: line.seat.variantId,
      barberId: line.seat.barberId,
      barberPreference: line.seat.barberPreference,
      startMinutes: line.startMinutes,
      subject:
        line.userId === null
          ? {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: 'Гост',
              guestKey: null,
            }
          : {
              requestedSubjectRole: RequestedSubjectRole.Companion,
              companionUserId: line.userId,
            },
    }));
    let counter = 0;
    return BookingDecisionSystem.decide(
      {
        locationId: CENTER,
        localDate: FIXTURE_TODAY,
        seats: [...cart, ...carried],
        attemptId: null,
        bookedFromAppointmentId: null,
        contact: null,
        placement: null,
      },
      {
        shopHours: [],
        services: [servedBoth(CUT, 45), servedBoth(BEARD, 30)],
        schedules: [MONDAY_09_18(IVAN), MONDAY_09_18(PETAR)],
        busy: [],
        exceptions: [],
      },
      BookingPolicy.DEFAULT,
      PlacementPolicy.clientDefault(),
      planned.release,
      {
        now: FIXTURE_NOW,
        startUtcMs: utcMs('2026-09-28T14:00:00+03:00'),
        nextId: () => `seat-${counter++}`,
        ownerUserId: OWNER,
        customerIds: resolvedCustomerIds([OWNER, SON]),
        termsOverrides: planned.carried.map((line) =>
          StaffTermsOverride.of(SeatKeyText.of(line.lineId), line.terms),
        ),
        standing: [],
        stood: [],
        parsePhone: () => null,
      },
    );
  }

  it('seats that foreign `SELF` BESIDE the owner at the new time — two accounts, two chairs, not one person twice', () => {
    // Side by side with Petar. The rebuilt owner seat and the carried one
    // both said `SELF`; the person is the ACCOUNT, so they are two people.
    const foreignSelf = SeatOccupant.account(
      SON,
      customerOf(SON),
      SubjectRelationship.Self,
    );
    const planned = unwrapOk(plan(party(0, foreignSelf), [cartSeat(at(14))]));
    const carriedSon = planned.carried[0];
    expect(
      carriedSon === undefined ? null : SeatOccupant.of(carriedSon.seat),
    ).toEqual(foreignSelf);
    expect(carriedSon?.seat.barberId).toBe('petar');
    expect(carriedSon?.startMinutes).toBe(at(14));

    const decided = unwrapOk(decide(planned));
    const seated = decided.appointment.seats.map((seat) => [
      seat.barberId,
      seat.startMinutes,
    ]);
    expect(seated).toEqual([
      ['ivan', at(14)],
      ['petar', at(14)],
    ]);
  });

  it('refuses when the shift would sit the companion on the client’s own chair', () => {
    // Side by side: the father with Petar, the son with Ivan. The client
    // re-picks Ivan for himself, and the son — carried at the same start —
    // would share Ivan's chair with him.
    const swapped = {
      ...party(),
      seats: [
        { ...(party().seats[0] as Seat), barberId: PETAR },
        { ...(party().seats[1] as Seat), barberId: IVAN },
      ],
    };
    const planned = unwrapOk(
      plan(swapped, [cartSeat(at(14), { barberId: IVAN })]),
    );
    expect(planned.carried[0]?.startMinutes).toBe(at(14));
    const refused = unwrapErr(decide(planned));
    expect(MoveSystem.carriedRefusalOf(refused)).toBe(
      CarriedSeatRefusal.PartyConflict,
    );
    // The cart alone places cleanly — the carried party is to blame.
    expect(decide({ ...planned, carried: [] }).ok).toBe(true);
  });
});

describe('MoveSystem — a named move remembers its name', () => {
  it('answers a replay from the ledger, and refuses the same name on a DIFFERENT move', () => {
    const request = {
      locationId: CENTER,
      localDate: FIXTURE_TODAY,
      seats: [cartSeat(at(14))],
    };
    const name = OperationId.of('move:a1');
    const digest = MoveSystem.digestBasis(request);
    expect(digest).toBe(MoveSystem.digestBasis({ ...request }));
    const ledger = AppointmentEditSystem.record([], name, 4, digest);
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, name, digest).ledgerVerdict,
    ).toBe(LedgerVerdict.Replay);
    const other = MoveSystem.digestBasis({
      ...request,
      seats: [cartSeat(at(15))],
    });
    expect(
      AppointmentEditSystem.ledgerVerdict(ledger, name, other).ledgerVerdict,
    ).toBe(LedgerVerdict.Mismatch);
  });

  it('keeps a first-time no-op unproven — a new name for where the visit already is wrote nothing', () => {
    // reschedule-booking.use-case.spec.ts L1317: the visit already sits
    // where the cart asks (`unchanged`), and the ledger has never heard the
    // new name — the pipeline answers "nothing to do" and stamps nothing,
    // so a later DIFFERENT move under that name is not taken for a replay.
    const planned = unwrapOk(plan(party(), [cartSeat(at(10))]));
    expect(planned.unchanged).toBe(true);
    const digest = MoveSystem.digestBasis({
      locationId: CENTER,
      localDate: FIXTURE_TODAY,
      seats: [cartSeat(at(10))],
    });
    const ledger = AppointmentEditSystem.record(
      [],
      OperationId.of('move:a1'),
      4,
      digest,
    );
    expect(
      AppointmentEditSystem.ledgerVerdict(
        ledger,
        OperationId.of('move:another'),
        digest,
      ).ledgerVerdict,
    ).toBe(LedgerVerdict.New);
  });

  // reschedule-booking.use-case.spec.ts L1332 ('treats a name that is not an
  // operation id as no name — no stamp') is the PIPELINE's edge guard: the
  // shape of a client operation id (`isClientOperationId`) is validated
  // where the payload is read, before any system sees a name.
});

describe('MoveSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party(55));
    const cart = deepFreeze([cartSeat(at(14))]);
    const request = {
      locationId: CENTER,
      localDate: FIXTURE_TODAY,
      seats: cart,
    };
    const once = MoveSystem.plan(appointment, OWNER, request);
    const twice = MoveSystem.plan(appointment, OWNER, request);
    expect(twice).toEqual(once);
    expect(appointment.seats[1]?.startMinutes).toBe(at(10, 55));
  });
});
