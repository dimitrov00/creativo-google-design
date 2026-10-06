import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import {
  BookingPolicy,
  CalendarDay,
  Interval,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  appointmentToDocument,
} from '@creativo/application/booking';
import type { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import type {
  BookingDecision,
  BookingSnapshot,
  DecideBookingRequest,
  LoadedSchedule,
  RequestedSeat,
} from './decide-booking';
import { CommitBookingInvalidInputError } from './commit-booking.errors';
import type { RescheduleBookingError } from './reschedule-booking.errors';
import { RescheduleBookingUseCase } from './reschedule-booking.use-case';
import { FixedClock } from '../test-support/fixed-clock';

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';
const SON = 'user-son';
const APPOINTMENT = 'appt-1';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/**
 * 2026-08-04 is a Tuesday in Sofia — the day every visit below sits on. The
 * clock reads Monday 08:00, so a Tuesday 10:00 visit is outside the 24 h
 * cancellation window and a Tuesday afternoon is past the 2 h lead time.
 */
function at(hour: number, minute = 0, day = 4): ZonedDateTime {
  return unwrap(
    ZonedDateTime.fromParts({ year: 2026, month: 8, day, hour, minute }, ZONE),
  );
}

const CLOCK = new FixedClock(at(8, 0, 3).toISO());

const OPEN_9_20 = { kind: 'open' as const, opens: '09:00', closes: '20:00' };
const SHOP_HOURS = [
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  OPEN_9_20,
  { kind: 'closed' as const },
];

function service(
  id: string,
  durationMinutes: number,
  priceMinorUnits: number,
  variants: readonly {
    readonly id: string;
    readonly name: { readonly bg: string; readonly en: string };
  }[] = [],
): Service {
  return unwrap(
    Service.create({
      id,
      name: { bg: id, en: id },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits,
      currencyCode: 'EUR',
      durationMinutes,
      cleanupMinutes: 10,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [...variants],
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

const FADE = service('svc-fade', 45, 4000);
const BEARD = service('svc-beard', 30, 2000);

function schedule(): LoadedSchedule {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  const pattern = unwrap(
    WeeklyPattern.create({ byWeekday: { monday: day, tuesday: day } }),
  );
  return {
    history: StaffScheduleHistory.startingWith(
      pattern,
      unwrap(CalendarDay.create('2026-01-01', ZONE)),
    ),
    turnaroundMinutes: 0,
  };
}

function snapshot(overrides: Partial<BookingSnapshot> = {}): BookingSnapshot {
  return {
    zone: ZONE,
    shopHours: SHOP_HOURS,
    services: [FADE, BEARD],
    schedules: new Map([
      ['ivan', schedule()],
      ['petar', schedule()],
    ]),
    busy: new Map(),
    exceptions: new Map(),
    ...overrides,
  };
}

interface SeatFixture {
  readonly id: string;
  readonly serviceId?: string;
  readonly variantId?: string | null;
  readonly barberId?: string;
  readonly start?: ZonedDateTime;
  readonly durationMinutes?: number;
  readonly priceMinorUnits?: number;
  readonly barberPref?: 'any' | 'specific' | null;
  readonly subject?: Record<string, unknown>;
  readonly outcome?: Record<string, unknown>;
}

const SELF = { kind: 'account', userId: OWNER, relationship: 'self' };
const COMPANION = { kind: 'account', userId: SON, relationship: 'companion' };

function seatDoc(fixture: SeatFixture): Record<string, unknown> {
  const start = fixture.start ?? at(10);
  const durationMinutes = fixture.durationMinutes ?? 45;
  return {
    id: fixture.id,
    serviceId: fixture.serviceId ?? 'svc-fade',
    variantId: fixture.variantId ?? null,
    barberId: fixture.barberId ?? 'ivan',
    barberPref:
      fixture.barberPref === undefined ? 'specific' : fixture.barberPref,
    terms: {
      priceMinorUnits: fixture.priceMinorUnits ?? 4000,
      currencyCode: 'EUR',
      durationMinutes,
      setupMinutes: 0,
      cleanupMinutes: 10,
    },
    slot: {
      startIso: start.toISO(),
      endIso: start.plusMinutes(durationMinutes).toISO(),
      zone: ZONE,
    },
    subject: fixture.subject ?? SELF,
    outcome: fixture.outcome ?? { kind: 'scheduled' },
  };
}

function document(
  seats: readonly Record<string, unknown>[],
  overrides: Partial<PersistedDocument> = {},
): PersistedDocument {
  return {
    locationId: 'loc-center',
    ownerUserId: OWNER,
    timeSlot: { startIso: at(10).toISO(), endIso: at(11).toISO(), zone: ZONE },
    seats,
    status: { kind: 'confirmed' },
    bookedAt: { iso: at(8, 0, 1).toISO(), zone: ZONE },
    bookedFromAppointmentId: null,
    arrivedAt: null,
    contact: { name: 'Иван', phone: '+359888123456', email: null, note: null },
    revision: 3,
    // NOT a field `appointmentToDocument` writes — the preservation probe.
    staffNote: 'идва с малкия',
    ...overrides,
  };
}

/** The father at 10:00 with Ivan, his son beside him with Petar. */
function parallelParty(): PersistedDocument {
  return document([
    seatDoc({ id: 'seat-father' }),
    seatDoc({
      id: 'seat-son',
      serviceId: 'svc-beard',
      barberId: 'petar',
      durationMinutes: 30,
      // Staff priced the son's trim by hand — the terms a move must keep.
      priceMinorUnits: 1500,
      barberPref: 'any',
      subject: COMPANION,
    }),
  ]);
}

/** The father at 10:00 with Ivan, and his son straight after, same chair. */
function sequentialParty(): PersistedDocument {
  return document([
    seatDoc({ id: 'seat-father' }),
    seatDoc({
      id: 'seat-son',
      serviceId: 'svc-beard',
      durationMinutes: 30,
      start: at(10, 55),
      subject: COMPANION,
    }),
  ]);
}

/**
 * A stand-in for `FirestoreBookingStore.reschedule` that runs the callbacks
 * in the order the real transaction does, minus Firestore — including the
 * `null` plan the real store answers as a replay without deciding anything.
 */
function makeStore(current: PersistedDocument, view: BookingSnapshot) {
  const captured: {
    decision?: BookingDecision;
    extra?: Record<string, unknown>;
    request?: DecideBookingRequest;
  } = {};
  const store = {
    async reschedule(
      _appointmentId: string,
      canWrite: (doc: PersistedDocument) => boolean,
      plan: (
        doc: PersistedDocument,
      ) => Result<DecideBookingRequest | null, RescheduleBookingError>,
      decide: (
        view: BookingSnapshot,
        doc: PersistedDocument,
        request: DecideBookingRequest,
        side: undefined,
      ) => Result<BookingDecision, RescheduleBookingError>,
      extraFields: (doc: PersistedDocument) => Record<string, unknown>,
    ) {
      if (!canWrite(current)) {
        return fail(new CommitBookingInvalidInputError('appointmentId'));
      }
      const planned = plan(current);
      if (planned.isFailure()) return fail(planned.error);
      if (planned.value === null) {
        return ok({ kind: 'replayed' as const, appointmentId: APPOINTMENT });
      }
      captured.request = planned.value;
      const decision = decide(view, current, planned.value, undefined);
      if (decision.isFailure()) return fail(decision.error);
      captured.decision = decision.value;
      captured.extra = extraFields(current);
      return ok({ kind: 'committed' as const, decision: decision.value });
    },
  };
  return { store: store as unknown as FirestoreBookingStore, captured };
}

function cartSeat(
  start: ZonedDateTime,
  overrides: Partial<RequestedSeat> = {},
): RequestedSeat {
  return {
    lineId: 'line-1',
    serviceId: 'svc-fade',
    variantId: null,
    barberId: 'ivan',
    barberPref: 'specific',
    startIso: start.toISO(),
    subject: { kind: 'self' },
    ...overrides,
  };
}

async function move(
  seats: readonly RequestedSeat[],
  options: {
    readonly current?: PersistedDocument;
    readonly view?: BookingSnapshot;
    readonly ownerUserId?: string | null;
    readonly policy?: BookingPolicy;
    /** The client's name for this move (`RescheduleBookingInput.attemptId`). */
    readonly attemptId?: string;
  } = {},
) {
  const { store, captured } = makeStore(
    options.current ?? parallelParty(),
    options.view ?? snapshot(),
  );
  let minted = 0;
  const useCase = new RescheduleBookingUseCase(
    store,
    CLOCK,
    { next: () => `seat-new-${++minted}` },
    options.policy ?? BookingPolicy.default(),
  );
  const result = await useCase.execute({
    appointmentId: APPOINTMENT,
    locationId: 'loc-center',
    seats,
    ownerUserId:
      options.ownerUserId === undefined ? OWNER : options.ownerUserId,
    ...(options.attemptId === undefined
      ? {}
      : { attemptId: options.attemptId }),
  });
  return { result, captured };
}

/** The written document, as it would land in Firestore. */
function seatsOf(captured: {
  decision?: BookingDecision;
}): readonly Record<string, unknown>[] {
  if (!captured.decision) throw new Error('nothing was written');
  return appointmentToDocument(captured.decision.appointment)[
    'seats'
  ] as readonly Record<string, unknown>[];
}

function seat(
  captured: { decision?: BookingDecision },
  id: string,
): Record<string, unknown> {
  const found = seatsOf(captured).find((entry) => entry['id'] === id);
  if (!found) throw new Error(`no seat ${id} was written`);
  return found;
}

function startOf(entry: Record<string, unknown>): number {
  const slot = entry['slot'] as Record<string, unknown>;
  return unwrap(
    ZonedDateTime.fromISO(String(slot['startIso']), ZONE),
  ).toMillis();
}

function code(result: Result<unknown, RescheduleBookingError>): string {
  if (result.isSuccess()) throw new Error('expected a refusal');
  return result.error.code;
}

describe('rescheduleAppointment — a companion the cart cannot express', () => {
  it('carries the companion forward with their identity and facts, beside the client at the new time', async () => {
    const { result, captured } = await move([cartSeat(at(14))]);

    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured)).toHaveLength(2);
    const son = seat(captured, 'seat-son');
    expect(son['subject']).toEqual(COMPANION);
    expect(son['serviceId']).toBe('svc-beard');
    expect(son['barberId']).toBe('petar');
    expect(son['barberPref']).toBe('any');
    expect(son['outcome']).toEqual({ kind: 'scheduled' });
    // The terms he was SOLD at, not the catalogue's 20 € — a move is not a
    // re-sale.
    expect(son['terms']).toMatchObject({
      priceMinorUnits: 1500,
      durationMinutes: 30,
    });
    // Parallel stays parallel: same start as the father's new one.
    expect(startOf(son)).toBe(at(14).toMillis());
    // His chair is claimed in the projection like everyone else's.
    expect(
      captured.decision?.busyWrites.map((write) => write.barberId),
    ).toEqual(['ivan', 'petar']);
    if (result.isFailure()) return;
    expect(result.value.subjectUserIds).toEqual([OWNER, SON].sort());
    expect(result.value.replayed).toBe(false);
  });

  it('keeps a sequential party sequential — the companion moves by exactly what the client moved', async () => {
    const { result, captured } = await move([cartSeat(at(14))], {
      current: sequentialParty(),
    });

    expect(result.isSuccess()).toBe(true);
    // 10:00 → 14:00 for the father; 10:55 → 14:55 for the son, same chair.
    expect(startOf(seat(captured, 'seat-son'))).toBe(at(14, 55).toMillis());
    expect(seat(captured, 'seat-son')['barberId']).toBe('ivan');
  });

  it('carries a `self` seat bound to ANOTHER account — `self` alone is not the owner’s (the web flow reads the same rule)', async () => {
    // A stored seat that says `self` for somebody other than the verified
    // owner is not a seat the owner's cart can speak for. Rebuilding it from
    // the cart would seat the owner twice; it is carried, untouched.
    const foreignSelf = { kind: 'account', userId: SON, relationship: 'self' };
    const current = document([
      seatDoc({ id: 'seat-father' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        durationMinutes: 30,
        start: at(10, 55),
        subject: foreignSelf,
      }),
    ]);

    const { result, captured } = await move([cartSeat(at(14))], { current });

    expect(result.isSuccess()).toBe(true);
    expect(seatsOf(captured)).toHaveLength(2);
    const son = seat(captured, 'seat-son');
    expect(son['subject']).toEqual(foreignSelf);
    expect(startOf(son)).toBe(at(14, 55).toMillis());
    // …and the cart's one line became the OWNER's seat, nobody else's.
    const rebuilt = seatsOf(captured).find(
      (entry) => entry['id'] !== 'seat-son',
    );
    expect(rebuilt?.['subject']).toEqual(SELF);
  });

  it('seats that foreign `self` BESIDE the owner at the new time — two accounts, two chairs, not one person twice', async () => {
    // Side by side with Petar. The rebuilt owner seat and the carried one
    // both say `self`, and they overlap; the aggregate used to read every
    // `self` seat as the one booker and refused the move as a raw invariant
    // violation. The person is the account (`Appointment.validateSeats`).
    const foreignSelf = { kind: 'account', userId: SON, relationship: 'self' };
    const current = document([
      seatDoc({ id: 'seat-father' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        subject: foreignSelf,
      }),
    ]);

    const { result, captured } = await move([cartSeat(at(14))], { current });

    expect(result.isSuccess()).toBe(true);
    const son = seat(captured, 'seat-son');
    expect(son['subject']).toEqual(foreignSelf);
    expect(son['barberId']).toBe('petar');
    expect(startOf(son)).toBe(at(14).toMillis());
  });

  it('preserves any relative offset, early or late, parallel or sequential (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Where the client moves to, in 15-minute steps inside the roster…
        fc
          .integer({ min: 9 * 4, max: 15 * 4 })
          .map((quarters) => quarters * 15),
        // …and where the companion sat relative to them, in five-minute steps.
        fc.integer({ min: -12, max: 12 }).map((steps) => steps * 5),
        async (targetMinutes, offsetMinutes) => {
          const fatherStart = at(12);
          const current = document([
            seatDoc({ id: 'seat-father', start: fatherStart }),
            seatDoc({
              id: 'seat-son',
              serviceId: 'svc-beard',
              barberId: 'petar',
              durationMinutes: 30,
              start: fatherStart.plusMinutes(offsetMinutes),
              subject: COMPANION,
            }),
          ]);
          const target = at(0).plusMinutes(targetMinutes);
          const { result, captured } = await move([cartSeat(target)], {
            current,
          });
          // Outside the roster the whole move is refused — never half-done.
          if (result.isFailure()) {
            expect(captured.decision).toBeUndefined();
            return;
          }
          // Moving to where it already is changes nothing at all.
          if (result.value.replayed) {
            expect(targetMinutes).toBe(12 * 60);
            return;
          }
          expect(
            startOf(seat(captured, 'seat-son')) -
              startOf(
                seatsOf(captured).find(
                  (entry) => entry['id'] !== 'seat-son',
                ) as Record<string, unknown>,
              ),
          ).toBe(offsetMinutes * 60_000);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('refuses the WHOLE move when the companion’s barber is not free, and writes nothing', async () => {
    // Somebody else holds Petar from 14:00 — the father's chair is free.
    const busy = new Map([
      [
        'petar__2026-08-04',
        [Interval.of(at(14).toMillis(), at(15).toMillis())],
      ],
    ]);
    const { result, captured } = await move([cartSeat(at(14))], {
      view: snapshot({ busy }),
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({
      refusal: 'barber_unavailable',
      seatIds: 'seat-son',
    });
    expect(captured.decision).toBeUndefined();
  });

  it('refuses when the companion’s service is no longer offered', async () => {
    const { result, captured } = await move([cartSeat(at(14))], {
      view: snapshot({ services: [FADE] }),
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({
      refusal: 'service_unavailable',
    });
    expect(captured.decision).toBeUndefined();
  });

  it('refuses as service_unavailable when the VARIANT the companion was sold is retired', async () => {
    // The beard service is still on the menu, but only as «Кратка» now — the
    // «Дълга» the son was booked for is gone. The same conversation at the
    // desk as a retired service, not a party conflict.
    const beardShortOnly = service('svc-beard', 30, 2000, [
      { id: 'v-short', name: { bg: 'Кратка', en: 'Short' } },
    ]);
    const current = document([
      seatDoc({ id: 'seat-father' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        variantId: 'v-long',
        barberId: 'petar',
        durationMinutes: 30,
        subject: COMPANION,
      }),
    ]);
    const { result, captured } = await move([cartSeat(at(14))], {
      current,
      view: snapshot({ services: [FADE, beardShortOnly] }),
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({
      refusal: 'service_unavailable',
      seatIds: 'seat-son',
    });
    expect(captured.decision).toBeUndefined();
  });

  it('refuses as outside_booking_window when the shift puts the companion inside the lead time', async () => {
    // The son sits an hour BEFORE his father. Moving the father to Monday
    // 10:30 — fine for him, two and a half hours out — would put the son at
    // 09:30, inside the two-hour notice the shop asks for.
    const current = document(
      [
        seatDoc({ id: 'seat-father', start: at(12) }),
        seatDoc({
          id: 'seat-son',
          serviceId: 'svc-beard',
          barberId: 'petar',
          durationMinutes: 30,
          start: at(11),
          subject: COMPANION,
        }),
      ],
      {
        timeSlot: {
          startIso: at(11).toISO(),
          endIso: at(12, 45).toISO(),
          zone: ZONE,
        },
      },
    );
    const { result, captured } = await move([cartSeat(at(10, 30, 3))], {
      current,
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({
      refusal: 'outside_booking_window',
    });
    expect(captured.decision).toBeUndefined();
  });

  it('refuses as outside_booking_window when a zero-minute lead lets the shift land exactly on now', async () => {
    // With no notice required the lead check passes a start AT now, and it is
    // the aggregate's own past-start rule that refuses — still the booking
    // window, not a party conflict.
    const early = (): LoadedSchedule => {
      const day = [{ start: '07:00', end: '18:00', locationId: 'loc-center' }];
      return {
        history: StaffScheduleHistory.startingWith(
          unwrap(WeeklyPattern.create({ byWeekday: { monday: day } })),
          unwrap(CalendarDay.create('2026-01-01', ZONE)),
        ),
        turnaroundMinutes: 0,
      };
    };
    const openEarly = {
      kind: 'open' as const,
      opens: '07:00',
      closes: '20:00',
    };
    const current = document([
      seatDoc({ id: 'seat-father' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        start: at(9),
        subject: COMPANION,
      }),
    ]);
    const noLead = unwrap(
      BookingPolicy.create({
        maxPartySize: 5,
        slotStepMinutes: 15,
        minLeadMinutes: 0,
        horizonMonths: 2,
        cancellationWindowHours: 24,
        maxFlexibleDays: 7,
        autoConfirm: true,
      }),
    );
    // The father to Monday 09:00; the son, an hour earlier, to 08:00 — now.
    const { result, captured } = await move([cartSeat(at(9, 0, 3))], {
      current,
      policy: noLead,
      view: snapshot({
        shopHours: SHOP_HOURS.map((day) =>
          day.kind === 'open' ? openEarly : day,
        ),
        schedules: new Map([
          ['ivan', early()],
          ['petar', early()],
        ]),
      }),
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({
      refusal: 'outside_booking_window',
    });
    expect(captured.decision).toBeUndefined();
  });

  it('refuses a visit that holds nobody but a companion — the shop moves it, and nothing is written', async () => {
    // Staff removed the father's own seat when he could not come; the son's
    // is the visit. A cart that names the father would ADD him and drag the
    // son along behind him — that is a booking, not this visit moved.
    const current = document([
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        subject: COMPANION,
      }),
    ]);
    for (const cart of [
      [cartSeat(at(14))],
      [
        cartSeat(at(14), {
          barberId: 'petar',
          serviceId: 'svc-beard',
          subject: { kind: 'guest', label: 'Guest 1' },
        }),
      ],
    ]) {
      const { result, captured } = await move(cart, { current });

      expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
      if (result.isSuccess()) return;
      expect(result.error.params).toMatchObject({
        refusal: 'shop_only',
        seatIds: 'seat-son',
      });
      expect(captured.request).toBeUndefined();
      expect(captured.decision).toBeUndefined();
    }
  });

  it('refuses when the shift would sit the companion on the client’s own chair', async () => {
    // Side by side: the father with Petar, the son with Ivan. The client
    // re-picks Ivan for himself, and the son — carried at the same start —
    // would share Ivan's chair with him.
    const current = document([
      seatDoc({ id: 'seat-father', barberId: 'petar' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        durationMinutes: 30,
        subject: COMPANION,
      }),
    ]);
    const { result } = await move([cartSeat(at(14), { barberId: 'ivan' })], {
      current,
    });

    expect(code(result)).toBe('booking.reschedule.carried_seat_unplaceable');
    if (result.isSuccess()) return;
    expect(result.error.params).toMatchObject({ refusal: 'party_conflict' });
  });

  it('answers the client’s own taken slot the ordinary way, even with a companion aboard', async () => {
    // Ivan is taken at 14:00 — the CLIENT's pick fails, so they get the
    // recoverable `slot_unavailable` and a fresh grid, not "call the shop".
    const busy = new Map([
      ['ivan__2026-08-04', [Interval.of(at(14).toMillis(), at(15).toMillis())]],
    ]);
    const { result } = await move([cartSeat(at(14))], {
      view: snapshot({ busy }),
    });

    expect(code(result)).toBe('booking.commit.slot_unavailable');
  });

  it('still answers the client’s own taken slot first when the companion’s service is gone too', async () => {
    const busy = new Map([
      ['ivan__2026-08-04', [Interval.of(at(14).toMillis(), at(15).toMillis())]],
    ]);
    const { result } = await move([cartSeat(at(14))], {
      view: snapshot({ busy, services: [FADE] }),
    });

    expect(code(result)).toBe('booking.commit.slot_unavailable');
  });

  it('never lets a client payload seat another account', async () => {
    const { result } = await move([
      cartSeat(at(14)),
      cartSeat(at(14), {
        barberId: 'petar',
        subject: { kind: 'companion', userId: 'someone-else' },
      }),
    ]);
    expect(code(result)).toBe('booking.commit.invalid_input');
  });

  it('never lets a cart line borrow a carried seat’s terms by naming its line', async () => {
    // The carried son's line is re-keyed server-side; a cart line spelled
    // like it is still priced by the catalogue.
    const { result, captured } = await move([
      cartSeat(at(14), { lineId: 'carried-0' }),
    ]);
    expect(result.isSuccess()).toBe(true);
    const father = seatsOf(captured).find(
      (entry) => entry['id'] !== 'seat-son',
    ) as Record<string, unknown>;
    expect(father['terms']).toMatchObject({ priceMinorUnits: 4000 });
  });
});

/*
 * ONLY A NEW OVERLAP IS REFUSED — ON THE CLIENT'S MOVE TOO (owner decision,
 * round 5), FOR THE SEATS THE MOVE CARRIES (BA ruling, round 6). The move
 * re-decides the whole visit through `decideBooking`, and used to pass no
 * `standing`: a visit already seating one person twice (a companion the
 * shop entered twice by hand, before the rule) could not be moved by its
 * client at all. The carried seats keep their ids, so the pair is known and
 * travels; the cart's seats are fresh, and judged.
 */
describe('rescheduleAppointment — on a client’s move, a pair of CARRIED seats keeps standing', () => {
  /** The father with Ivan; his son entered TWICE, with Petar and Georgi. */
  const heldPair = () =>
    document([
      seatDoc({ id: 'seat-father' }),
      seatDoc({
        id: 'seat-son-1',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        subject: COMPANION,
      }),
      seatDoc({
        id: 'seat-son-2',
        serviceId: 'svc-beard',
        barberId: 'georgi',
        durationMinutes: 30,
        subject: COMPANION,
      }),
    ]);
  const threeChairs = () =>
    snapshot({
      schedules: new Map([
        ['ivan', schedule()],
        ['petar', schedule()],
        ['georgi', schedule()],
      ]),
    });

  it('moves the visit — the carried pair keeps its standing and travels side by side', async () => {
    const { result, captured } = await move([cartSeat(at(14))], {
      current: heldPair(),
      view: threeChairs(),
    });

    expect(result.isSuccess()).toBe(true);
    expect(startOf(seat(captured, 'seat-son-1'))).toBe(at(14).toMillis());
    expect(startOf(seat(captured, 'seat-son-2'))).toBe(at(14).toMillis());
  });

  it('still refuses a cart that seats somebody twice ANEW beside it', async () => {
    const maria = { kind: 'guest', label: 'Мария' } as const;
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          barberId: 'petar',
          subject: maria,
        }),
        cartSeat(at(14, 15), {
          lineId: 'line-3',
          serviceId: 'svc-beard',
          barberId: 'georgi',
          subject: maria,
        }),
      ],
      { current: heldPair(), view: threeChairs() },
    );

    expect(code(result)).toBe('booking.commit.invalid_input');
    if (result.isFailure()) {
      expect(result.error.params).toMatchObject({ field: 'person_overlap' });
    }
    expect(captured.decision).toBeUndefined();
  });
});

/*
 * ON A CLIENT'S MOVE, ONLY CARRIED SEATS KEEP A STANDING PAIR (BA ruling,
 * round 6: the owner's round-5 decision, narrowed for the move and
 * accepted). The client re-picks their OWN seats — the booker's and their
 * anonymous guests' — on a person-aware grid: they are placed anew, rebuilt
 * from the cart with fresh ids, and obey the rule in full, so a same-label
 * guest pair must be renamed or separated before it moves. The
 * realistic legacy pair on a client's visit is a guest pair under one label
 * — two walk-ins the shop added side by side under «Случаен клиент», the
 * default the server counts a guest by. The booker's OWN two seats at once
 * are not a legacy pair at all: the aggregate never held one (`Appointment`
 * refuses two overlapping `self` seats of one account, create and
 * reconstitute alike), so there was nothing to grandfather.
 */
describe('rescheduleAppointment — the client’s own seats are placed anew and obey the rule', () => {
  const RANDOM_GUEST = 'Случаен клиент';
  /** The booker with Ivan; two walk-ins under ONE label, side by side. */
  const guestPair = () =>
    document([
      seatDoc({ id: 'seat-booker' }),
      seatDoc({
        id: 'seat-guest-1',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        subject: { kind: 'anonymous', label: RANDOM_GUEST },
      }),
      seatDoc({
        id: 'seat-guest-2',
        serviceId: 'svc-beard',
        barberId: 'georgi',
        durationMinutes: 30,
        subject: { kind: 'anonymous', label: RANDOM_GUEST },
      }),
    ]);
  const threeChairs = () =>
    snapshot({
      schedules: new Map([
        ['ivan', schedule()],
        ['petar', schedule()],
        ['georgi', schedule()],
      ]),
    });
  const guest = { kind: 'guest', label: RANDOM_GUEST } as const;

  it('moves the visit once the same-label guest pair is separated — one after the other', async () => {
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: guest,
        }),
        cartSeat(at(14, 30), {
          lineId: 'line-3',
          serviceId: 'svc-beard',
          barberId: 'georgi',
          subject: guest,
        }),
      ],
      { current: guestPair(), view: threeChairs() },
    );

    expect(result.isSuccess()).toBe(true);
    // Rebuilt from the cart: fresh ids, nothing of the old pair to stand by.
    expect(seatsOf(captured).map((entry) => entry['id'])).toEqual([
      'seat-new-1',
      'seat-new-2',
      'seat-new-3',
    ]);
  });

  it('refuses a cart that keeps the same-label guest pair side by side — the client’s own seats earn no standing', async () => {
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: guest,
        }),
        cartSeat(at(14), {
          lineId: 'line-3',
          serviceId: 'svc-beard',
          barberId: 'georgi',
          subject: guest,
        }),
      ],
      { current: guestPair(), view: threeChairs() },
    );

    expect(code(result)).toBe('booking.commit.invalid_input');
    if (result.isFailure()) {
      expect(result.error.params).toMatchObject({ field: 'person_overlap' });
    }
    expect(captured.decision).toBeUndefined();
  });

  it('asks for a second name when the cart tells the two apart — a same-label pair is renamed or separated', async () => {
    // The web flow names each guest it restores (`guestKey`): two people
    // under one label are refused by the label rule before any placement,
    // wherever the cart seats them. The client renames one and moves.
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
          subject: { ...guest, guestKey: 'guest-a' },
        }),
        cartSeat(at(14, 30), {
          lineId: 'line-3',
          serviceId: 'svc-beard',
          barberId: 'georgi',
          subject: { ...guest, guestKey: 'guest-b' },
        }),
      ],
      { current: guestPair(), view: threeChairs() },
    );

    expect(code(result)).toBe('booking.commit.invalid_input');
    if (result.isFailure()) {
      expect(result.error.params).toMatchObject({ field: 'guest_label' });
    }
    expect(captured.decision).toBeUndefined();
  });

  it('has no booker-in-two-chairs pair to carry: the aggregate never held one', async () => {
    // Written by hand, since no path through the domain could write it: the
    // move reads the visit as every reader does, and refuses what does not
    // parse before any time is decided.
    const current = document([
      seatDoc({ id: 'seat-cut' }),
      seatDoc({
        id: 'seat-beard',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
      }),
    ]);
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14, 45), {
          lineId: 'line-2',
          serviceId: 'svc-beard',
          barberId: 'petar',
        }),
      ],
      { current, view: threeChairs() },
    );

    expect(code(result)).toBe('booking.commit.invalid_input');
    if (result.isFailure()) {
      expect(result.error.params).toMatchObject({ field: 'seats' });
    }
    expect(captured.request).toBeUndefined();
  });
});

describe('rescheduleAppointment — the self and guest seats behave as before', () => {
  it('rebuilds them from the cart at the new time, with fresh distinct ids and catalogue terms', async () => {
    const current = document([
      seatDoc({ id: 'seat-a', priceMinorUnits: 3500 }),
      seatDoc({
        id: 'seat-b',
        barberId: 'petar',
        subject: { kind: 'anonymous', label: 'Гост 1' },
      }),
    ]);
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          barberId: 'petar',
          subject: { kind: 'guest', label: 'Гост 1' },
        }),
      ],
      { current },
    );

    expect(result.isSuccess()).toBe(true);
    const seats = seatsOf(captured);
    expect(seats.map((entry) => entry['id'])).toEqual([
      'seat-new-1',
      'seat-new-2',
    ]);
    expect(seats.map((entry) => entry['subject'])).toEqual([
      SELF,
      { kind: 'anonymous', label: 'Гост 1' },
    ]);
    // Catalogue terms, as a client move always priced its own seats.
    expect(seats[0]?.['terms']).toMatchObject({ priceMinorUnits: 4000 });
    expect(seats.every((entry) => startOf(entry) === at(14).toMillis())).toBe(
      true,
    );
    if (result.isFailure()) return;
    expect(result.value.subjectUserIds).toEqual([OWNER]);
  });

  it('keeps the visit’s identity: status, contact, booking instant, the bill, unknown fields — and bumps the revision', async () => {
    const discount = {
      id: 'manual',
      source: 'manual',
      label: 'manual',
      value: { kind: 'percent_off', percent: 10 },
      grantId: null,
      code: null,
      appliedAt: { iso: at(8, 0, 1).toISO(), zone: ZONE },
      combinability: 'stackable',
    };
    const current = document([seatDoc({ id: 'seat-a' })], {
      discounts: [discount],
    });
    const { result, captured } = await move([cartSeat(at(14))], { current });

    expect(result.isSuccess()).toBe(true);
    const written = appointmentToDocument(
      (captured.decision as BookingDecision).appointment,
    );
    expect(written['status']).toEqual({ kind: 'confirmed' });
    expect(written['contact']).toEqual(current['contact']);
    expect(written['bookedAt']).toEqual(current['bookedAt']);
    expect(written['discounts']).toEqual([discount]);
    expect(captured.extra).toMatchObject({
      staffNote: 'идва с малкия',
      revision: 4,
    });
    if (result.isFailure()) return;
    expect(result.value.revision).toBe(4);
  });

  it('answers a retried move as the move it already was — nothing re-decided, nothing written', async () => {
    // The stored visit already sits at 14:00: the first attempt landed and
    // its response was lost. Now is INSIDE the new start's window, which a
    // re-decide would refuse.
    const current = document(
      [
        seatDoc({ id: 'seat-a', start: at(14) }),
        seatDoc({
          id: 'seat-son',
          serviceId: 'svc-beard',
          barberId: 'petar',
          durationMinutes: 30,
          start: at(14),
          subject: COMPANION,
        }),
      ],
      {
        timeSlot: {
          startIso: at(14).toISO(),
          endIso: at(14, 45).toISO(),
          zone: ZONE,
        },
      },
    );
    const { result, captured } = await move([cartSeat(at(14))], { current });

    expect(result.isSuccess()).toBe(true);
    expect(captured.decision).toBeUndefined();
    if (result.isFailure()) return;
    expect(result.value).toEqual({
      appointmentId: APPOINTMENT,
      revision: 3,
      subjectUserIds: [OWNER, SON].sort(),
      replayed: true,
      // Nothing names this call: the placement alone says it is a replay.
      replayedAttempt: false,
    });
  });

  it('answers a retried move with a NAMED guest as a replay — the guest travels under the label the visit stored', async () => {
    // The web flow keeps a guest's stored label on a move (it used to send
    // «Гост 1» over «Иван (син)»), so the retry names the same person the
    // stored seat does and is recognised as the move it already was.
    const son = { kind: 'anonymous', label: 'Иван (син)' };
    const current = document(
      [
        seatDoc({ id: 'seat-a', start: at(14) }),
        seatDoc({
          id: 'seat-guest',
          barberId: 'petar',
          start: at(14),
          subject: son,
        }),
      ],
      {
        timeSlot: {
          startIso: at(14).toISO(),
          endIso: at(14, 45).toISO(),
          zone: ZONE,
        },
      },
    );
    const { result, captured } = await move(
      [
        cartSeat(at(14)),
        cartSeat(at(14), {
          lineId: 'line-2',
          barberId: 'petar',
          subject: { kind: 'guest', label: 'Иван (син)' },
        }),
      ],
      { current },
    );

    expect(result.isSuccess()).toBe(true);
    expect(captured.decision).toBeUndefined();
    if (result.isFailure()) return;
    expect(result.value.replayed).toBe(true);
  });

  it('still refuses a visit that is not the caller’s', async () => {
    const { result } = await move([cartSeat(at(14))], {
      ownerUserId: 'somebody-else',
    });
    expect(code(result)).toBe('booking.commit.invalid_input');
  });

  it('still refuses a party with a resolved seat', async () => {
    const current = document([
      seatDoc({ id: 'seat-a' }),
      seatDoc({
        id: 'seat-son',
        serviceId: 'svc-beard',
        barberId: 'petar',
        durationMinutes: 30,
        subject: COMPANION,
        outcome: { kind: 'no_show', atMs: at(10, 30).toMillis() },
      }),
    ]);
    const { result } = await move([cartSeat(at(14))], { current });
    expect(code(result)).toBe('booking.commit.invalid_input');
  });
});

/*
 * ── A NAMED MOVE (round 3) ───────────────────────────────────────────────
 * The client names every move (`attemptId`, one per armed selection). The
 * name is stamped into the visit's applied-operations ledger by the move's
 * own write, so a retry is KNOWN to be a replay of a move that wrote — which
 * the placement alone could never say.
 */
describe('rescheduleAppointment — a named move remembers its name', () => {
  const ATTEMPT = 'attempt-0123456789abcdef';

  /** The ledger as a write left it. */
  function ledgerOf(extra: Record<string, unknown> | undefined) {
    return (extra?.['appliedOperations'] ?? []) as readonly {
      readonly id: string;
      readonly revision: number;
      readonly digest: string;
    }[];
  }

  /** The visit as the first attempt's write left it: moved, and stamped. */
  async function landed() {
    const first = await move([cartSeat(at(14))], { attemptId: ATTEMPT });
    if (!first.captured.decision) throw new Error('the move did not write');
    return {
      ledger: ledgerOf(first.captured.extra),
      stored: {
        ...appointmentToDocument(first.captured.decision.appointment),
        ...first.captured.extra,
        ownerUserId: OWNER,
      } as PersistedDocument,
    };
  }

  it('stamps the move’s name, and the revision it wrote, in the same write', async () => {
    const { result, captured } = await move([cartSeat(at(14))], {
      attemptId: ATTEMPT,
    });

    expect(result.isSuccess()).toBe(true);
    const [entry] = ledgerOf(captured.extra);
    expect(entry?.id).toBe(`move:${ATTEMPT}`);
    expect(entry?.revision).toBe(4);
    expect(entry?.digest).toMatch(/^[0-9a-f]{16}$/);
    if (result.isFailure()) return;
    expect(result.value).toMatchObject({
      revision: 4,
      replayed: false,
      replayedAttempt: false,
    });
  });

  it('keeps the staff intents the ledger already holds — a move adds its name beside them', async () => {
    const staffIntent = {
      id: 'op-staff-0123456789ab',
      revision: 3,
      digest: 'd',
    };
    const { captured } = await move([cartSeat(at(14))], {
      attemptId: ATTEMPT,
      current: document(parallelParty()['seats'] as Record<string, unknown>[], {
        appliedOperations: [staffIntent],
      }),
    });

    expect(ledgerOf(captured.extra).map((entry) => entry.id)).toEqual([
      staffIntent.id,
      `move:${ATTEMPT}`,
    ]);
  });

  it('answers a replay FROM THE LEDGER — no second write, and the revision the move stamped', async () => {
    const { stored } = await landed();
    // Since then the shop added a note: the visit's revision moved on.
    const { result, captured } = await move([cartSeat(at(14))], {
      attemptId: ATTEMPT,
      current: { ...stored, revision: 6 },
    });

    expect(captured.decision).toBeUndefined();
    expect(result.isSuccess()).toBe(true);
    if (result.isFailure()) return;
    expect(result.value).toEqual({
      appointmentId: APPOINTMENT,
      revision: 4,
      subjectUserIds: [OWNER, SON].sort(),
      replayed: true,
      replayedAttempt: true,
    });
  });

  it('never moves the visit AGAIN when the shop moved it after the first attempt landed', async () => {
    const { stored } = await landed();
    // Staff dragged the visit to 16:00 after the client's move landed; the
    // client's retry of the 14:00 move arrives late.
    const moved = {
      ...stored,
      seats: (stored['seats'] as Record<string, unknown>[]).map((entry) => ({
        ...entry,
        slot: {
          ...(entry['slot'] as Record<string, unknown>),
          startIso: at(16).toISO(),
        },
      })),
      revision: 5,
    };

    const { result, captured } = await move([cartSeat(at(14))], {
      attemptId: ATTEMPT,
      current: moved,
    });

    expect(captured.decision).toBeUndefined();
    expect(result.isSuccess() && result.value.replayedAttempt).toBe(true);
  });

  it('refuses the same name on a DIFFERENT move — answering “moved” would move nothing', async () => {
    const { stored } = await landed();

    const { result, captured } = await move([cartSeat(at(15))], {
      attemptId: ATTEMPT,
      current: stored,
    });

    expect(captured.decision).toBeUndefined();
    expect(code(result)).toBe('booking.commit.invalid_input');
    if (result.isSuccess()) return;
    expect(result.error.params).toEqual({ field: 'attemptId' });
  });

  it('keeps a first-time no-op unproven — a new name for where the visit already is wrote nothing', async () => {
    const { stored } = await landed();

    const { result, captured } = await move([cartSeat(at(14))], {
      attemptId: 'attempt-another-0123456789',
      current: stored,
    });

    expect(captured.decision).toBeUndefined();
    expect(result.isSuccess()).toBe(true);
    if (result.isFailure()) return;
    expect(result.value.replayed).toBe(true);
    expect(result.value.replayedAttempt).toBe(false);
  });

  it('treats a name that is not an operation id as no name — no stamp', async () => {
    const { captured } = await move([cartSeat(at(14))], {
      attemptId: 'short',
    });

    expect(captured.decision).toBeDefined();
    expect(ledgerOf(captured.extra)).toEqual([]);
  });
});
