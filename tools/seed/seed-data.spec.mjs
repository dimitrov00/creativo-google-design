/**
 * The dev seed's client book, checked against the production code that will
 * read it (flip 1: the documents ARE the flat `Appointment` bodies, Law 5):
 * every document carries exactly the mirrors `AppointmentIndexSystem`
 * derives from its seats and the one instant `ZonedTimeSystem` derives from
 * its shop day, and every named fixture (design §12.4 P0 «Seed») is asserted
 * through the real client-stats projection (`clientStatsOf` of
 * `@core/pipelines`, the trigger's own) — so "Георги is a regular with 23
 * visits" is a fact the stats engine agrees with, not a comment.
 *
 * "Now" is pinned. A sweep of anchor days (DST changes, 29 February, every
 * weekday) proves the counts hold whatever day the seed runs on.
 */
import {
  AccountStatus,
  BarberPreference,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancelledBy,
  ClientStatsPolicy,
  CustomerOrigin,
  ParsedIdentifier,
  Placement,
  RegistrationState,
  Seat,
  TimeCoordinate,
} from '@core/components';
import { clientStatsOf } from '@core/pipelines';
import { LocalDate, TimeZone, UserId, Weekday } from '@core/primitives';
import {
  AppointmentIndexSystem,
  ClientStatsSystem,
  ProfileEditSystem,
  RegistrationSystem,
  ZonedTimeSystem,
} from '@core/systems';
import fc from 'fast-check';
import { appointmentDocumentOf } from './appointments.mjs';
import { createShopCalendar } from './calendar.mjs';
import {
  BARBERS,
  EXCEPTION_EARLIEST_OFFSET,
  SERVICES,
  chairTerms,
  scheduleExceptionsFor,
  segmentsAt,
  segmentsOn,
  turnaroundMinutesOf,
} from './catalog.mjs';
import { buildClientBook } from './fixtures.mjs';
import {
  SCHEDULED_SEAT,
  accountSeat,
  calledOffAt,
} from './fixtures/appointments.fixtures.ts';
import { CLIENTS } from './fixtures/book.fixtures.ts';
import { customerIdOf } from './fixtures/customers.fixtures.ts';
import {
  BOOKING_POLICY,
  CANCELLATION_WINDOW_HOURS,
} from './fixtures/settings.fixtures.ts';
import { createChairBook, placeVisit } from './history.mjs';

const ZONE = 'Europe/Sofia';
const DAY_MS = 86_400_000;

/** Before every one of today's fixtures (the first arrival is 09:56). */
const MORNING = Date.parse('2026-09-25T07:30:00+03:00');
/** After every one of them (the last, the guest's fade, ends 18:45). */
const EVENING = Date.parse('2026-09-25T22:30:00+03:00');

/** Early morning on days spread over two years, plus the awkward ones. */
const ANCHORS = [
  ...Array.from(
    { length: 28 },
    (_, i) => Date.parse('2026-01-02T07:30:00+02:00') + i * 26 * DAY_MS,
  ),
  Date.parse('2026-03-29T07:30:00+03:00'), // spring forward
  Date.parse('2026-10-25T07:30:00+02:00'), // fall back
  Date.parse('2028-02-29T07:30:00+02:00'), // a birthday that is not every year
];

/** The stored tags the seed writes (the dictionaries' values). */
const CONFIRMED = 'CONFIRMED';
const COMPLETED = 'COMPLETED';
const NO_SHOW = 'NO_SHOW';
const CANCELLED = 'CANCELLED';
const SCHEDULED = 'SCHEDULED';
const WORKED = 'WORKED';
const ACCOUNT = 'ACCOUNT';
const ANONYMOUS = 'ANONYMOUS';

/** Every lifecycle stamp a root variant may carry; a document holds its own variant's only. */
const LIFECYCLE_FIELDS = [
  'pendingAtUtcMs',
  'confirmedAtUtcMs',
  'completedAtUtcMs',
  'noShowAtUtcMs',
  'cancelledAtUtcMs',
  'cancellationReason',
];
/** Every field a seat's occupant or outcome variant may carry. */
const SEAT_VARIANT_FIELDS = [
  'subjectUserId',
  'subjectCustomerId',
  'subjectRelationship',
  'guestLabel',
  'workedAtUtcMs',
  'noShowAtUtcMs',
  'cancelledAtUtcMs',
  'cancelledBy',
  'cancellationReason',
  'cancellationWindowHours',
];

/** The book's appointments as the entity: `{ id, ...body }` (Law 5 — no mapper). */
const entitiesOf = (book) =>
  book.appointments.map(({ id, doc }) => ({ id, ...doc }));

const SHOP_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });
const SHOP_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const shopDayOf = (ms) => SHOP_DAY.format(new Date(ms));
const shopClockOf = (ms) => SHOP_CLOCK.format(new Date(ms));
const clockOf = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The instant a seat's outcome was stamped, or `null` while it is scheduled. */
const outcomeAtOf = (seat) =>
  seat.workedAtUtcMs ?? seat.noShowAtUtcMs ?? seat.cancelledAtUtcMs ?? null;

/** One client's stats and spend as of `nowMs`, by the trigger's own projection. */
function statsAt(nowMs, uid, policy = ClientStatsPolicy.DEFAULT) {
  const book = buildClientBook(nowMs);
  const appointments = entitiesOf(book);
  const now = ZonedTimeSystem.shopNow(nowMs, ZONE);
  const { stats, money } = clientStatsOf(
    customerIdOf(uid),
    appointments,
    policy,
    now,
  );
  return {
    book,
    appointments,
    stats,
    windows: ClientStatsSystem.statWindows(stats, now),
    money,
  };
}

const docById = (book, id) => {
  const entry = book.appointments.find((appointment) => appointment.id === id);
  if (!entry) throw new Error(`no ${id}`);
  return entry.doc;
};

const isOwnSeat = (seat, uid) =>
  seat.seatSubject === ACCOUNT && seat.subjectUserId === uid;

/** The barber's own offering of a service, read straight off the catalogue. */
const offeringOf = (serviceId, barberId) =>
  SERVICES.find((service) => service.id === serviceId)?.body.offerings.find(
    (offering) => offering.barberId === barberId,
  );

/**
 * The terms the catalogue sells THIS seat at: its barber's override for its
 * variant, else that barber's own — never another variant's, another
 * barber's, or the service's list price.
 */
const catalogTermsOf = (seat) => {
  const offering = offeringOf(seat.serviceId, seat.barberId);
  if (!offering) return undefined;
  return (
    (seat.variantId &&
      offering.overrides.find(
        (override) => override.variantId === seat.variantId,
      )) ||
    offering
  );
};

/** The minutes a fixture's seat names for itself, by seat id — the only override the seed writes. */
const authoredMinutesOf = (book) =>
  new Map(
    book.fixtures.flatMap((fixture) =>
      fixture.seats
        .filter((seat) => seat.durationMinutes !== null)
        .map((seat) => [seat.seatId, seat.durationMinutes]),
    ),
  );

/** The day fixtures: hand-authored for today and the next two days. */
const isDayFixture = (id) =>
  id.startsWith('appt-dev-') && id !== 'appt-dev-walkin';

/** Seven consecutive mornings, Monday to Sunday, around the pinned Friday. */
const WEEK = Array.from(
  { length: 7 },
  (_, i) => Date.parse('2026-09-21T07:30:00+03:00') + i * DAY_MS,
);
/** `Weekday` order: 1 = Monday … 7 = Sunday. */
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayName = (ms) =>
  WEEKDAY_NAMES[createShopCalendar(ms).weekdayAt(0) - 1];

describe('the dev seed client book', () => {
  it('writes the same documents on every run of a day', () => {
    const written = ({ users, customers, appointments }) => ({
      users,
      customers,
      appointments,
    });
    const first = buildClientBook(MORNING);
    expect(written(buildClientBook(MORNING))).toEqual(written(first));
    // Only today's settle-once-past fixtures may differ between morning
    // and evening; the past is the past.
    const past = (book) =>
      book.appointments.filter(({ doc }) => doc.localDate < '2026-09-25');
    expect(past(buildClientBook(EVENING))).toEqual(past(first));
    expect(buildClientBook(EVENING).appointments.map(({ id }) => id)).toEqual(
      first.appointments.map(({ id }) => id),
    );
    expect(buildClientBook(EVENING).customers).toEqual(first.customers);
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'every appointment is exactly the flat archetype: its mirrors, its envelope, its instant, one variant (%s)',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      const [first] = book.appointments;
      const rootFields = (doc) =>
        Object.keys(doc)
          .filter((key) => !LIFECYCLE_FIELDS.includes(key))
          .sort();
      const seatFields = (seat) =>
        Object.keys(seat)
          .filter((key) => !SEAT_VARIANT_FIELDS.includes(key))
          .sort();
      for (const { id, doc } of book.appointments) {
        // The query mirrors, exactly as every write plan recomputes them.
        const keys = AppointmentIndexSystem.queryKeys(doc);
        for (const field of [
          'ownerUserId',
          'subjectUserIds',
          'ownerCustomerId',
          'subjectCustomerIds',
          'barberIds',
          'busyKeys',
        ]) {
          expect(doc[field], `${id}.${field}`).toEqual(keys[field]);
        }
        // The envelope of its seats, on one shop day, and the one instant
        // the shop's zone gives its start.
        const envelope = AppointmentIndexSystem.envelope(doc);
        expect(doc.startMinutes, id).toBe(envelope.startMinutes);
        expect(doc.endMinutes, id).toBe(envelope.endMinutes);
        const start = ZonedTimeSystem.toUtc(
          doc.localDate,
          doc.startMinutes,
          ZONE,
        );
        expect(start.ok, id).toBe(true);
        expect(doc.utcEpochMs, id).toBe(start.value);
        // Exactly one lifecycle variant at the root: its own stamps, no other's.
        expect(
          LIFECYCLE_FIELDS.filter((field) => field in doc),
          id,
        ).toEqual(
          Object.keys(BookingLifecycle.sliceOf(doc)).filter(
            (field) => field !== 'bookingStatus',
          ),
        );
        // One hidden class: the same root fields and seat fields everywhere.
        expect(rootFields(doc), id).toEqual(rootFields(first.doc));
        for (const seat of doc.seats) {
          expect(seatFields(seat), `${id}/${seat.seatId}`).toEqual(
            seatFields(first.doc.seats[0]),
          );
        }
        // Plain data: what is written is what is read, byte for byte.
        expect(JSON.parse(JSON.stringify(doc)), id).toEqual(doc);
      }
    },
  );

  it('writes one client record per client, at the id the booking derives, opened before their first visit', () => {
    const book = buildClientBook(MORNING);
    expect(book.customers.map(({ uid }) => uid)).toEqual(
      CLIENTS.map(({ uid }) => uid),
    );
    const ids = new Set(book.customers.map(({ id }) => id));
    for (const { uid, id, body } of book.customers) {
      expect(id, uid).toBe(customerIdOf(uid));
      expect(id.startsWith('cus_'), uid).toBe(true);
      expect(body.userId, uid).toBe(uid);
      expect(body.customerOrigin, uid).toBe(CustomerOrigin.Seed);
      const visits = book.appointments.filter(({ doc }) =>
        doc.subjectUserIds.includes(uid),
      );
      for (const { doc } of visits) {
        expect(body.createdAtUtcMs, uid).toBeLessThanOrEqual(doc.utcEpochMs);
      }
    }
    // Every record a visit names is one the seed writes.
    expect(book.subjectCustomerIds.every((id) => ids.has(id))).toBe(true);
    expect(book.subjectCustomerIds).toEqual(
      [...new Set(book.subjects.map((uid) => customerIdOf(uid)))].sort(),
    );
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'every named fixture holds its state on any day (%s)',
    (_label, nowMs) => {
      const georgi = statsAt(nowMs, 'dev-client-1');
      expect(georgi.stats.lifetimeVisitsCompleted).toBe(23);
      expect(georgi.windows.visitsCompleted.last12m).toBe(13);

      const kiril = statsAt(nowMs, 'dev-client-5');
      expect(kiril.stats.pauseSuggestedNoShows).toBe(3);
      expect(kiril.stats.pauseSuggestedWindowDays).toBe(60);

      const nikolay = statsAt(nowMs, 'dev-client-6');
      expect(nikolay.stats.lifetimeLateCancels).toBe(1);
      expect(nikolay.stats.lifetimeClientCancels).toBe(3);

      expect(
        statsAt(nowMs, 'dev-client-10').stats.lifetimeVisitsCompleted,
      ).toBe(13);
    },
  );

  it('writes the booking policy every reader falls back to, every field present', () => {
    const { body } = BOOKING_POLICY;
    // `autoConfirm` too: a field a reader defaults is still written.
    expect(Object.keys(body).sort()).toEqual(
      Object.keys(BookingPolicy.DEFAULT).sort(),
    );
    expect(BookingPolicy.equals(body, BookingPolicy.DEFAULT)).toBe(true);
    expect(BookingPolicy.withDefaults(body)).toEqual(body);
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('stamps every cancellation with the window the seeded policy sets, as the cancel paths do', () => {
    // The seeded `settings/bookingPolicy` and the stamp are one number.
    expect(BOOKING_POLICY.body.cancellationWindowHours).toBe(
      CANCELLATION_WINDOW_HOURS,
    );
    expect(CANCELLATION_WINDOW_HOURS).toBe(
      BookingPolicy.DEFAULT.cancellationWindowHours,
    );
    const cancelled = buildClientBook(MORNING).appointments.flatMap(({ doc }) =>
      doc.seats.filter((seat) => seat.attendanceState === CANCELLED),
    );
    expect(cancelled.length).toBeGreaterThan(0);
    for (const seat of cancelled) {
      expect(seat.cancellationWindowHours).toBe(CANCELLATION_WINDOW_HOURS);
    }
  });

  it('keeps Николай’s late cancel whatever the owner moves the window to', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 96 }), (hours) => {
        const booking = BookingPolicy.create({
          ...BookingPolicy.DEFAULT,
          cancellationWindowHours: hours,
        });
        if (!booking.ok) throw new Error('bad policy');
        const { stats } = statsAt(
          MORNING,
          'dev-client-6',
          ClientStatsPolicy.forBooking(booking.value),
        );
        expect(stats.lifetimeLateCancels).toBe(1);
        expect(stats.lifetimeClientCancels).toBe(3);
      }),
      { numRuns: 12 },
    );
  });

  it('Георги is the regular: 23 visits, 13 in a year, Ivan by name', () => {
    const { stats, windows, money, book } = statsAt(MORNING, 'dev-client-1');
    expect({
      visitsCompleted: stats.lifetimeVisitsCompleted,
      noShows: stats.lifetimeNoShows,
      lateCancels: stats.lifetimeLateCancels,
      clientCancels: stats.lifetimeClientCancels,
    }).toEqual({
      visitsCompleted: 23,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    });
    expect(windows.visitsCompleted.last12m).toBe(13);
    expect(stats.preferredBarberId).toBe('ivan');
    expect(stats.usualServiceIds).toContain('svc-fade');
    // Eighteen months of him, give or take a haircut.
    expect(stats.firstVisitLocalDate).not.toBeNull();
    expect(
      LocalDate.daysBetween(
        stats.firstVisitLocalDate,
        book.calendar.dayKeyAt(0),
      ),
    ).toBeGreaterThan(540);
    // Today's 10:00 is still to come — and it was booked from his last visit.
    expect(stats.nextVisitAppointmentId).toBe('appt-dev-1');
    expect(docById(book, 'appt-dev-1').bookedFromAppointmentId).toBe(
      stats.lastVisitAppointmentId,
    );
    // Spend is the worked seats' prices; tips are not the shop's money.
    const own = book.appointments
      .flatMap(({ doc }) => doc.seats)
      .filter(
        (seat) =>
          seat.attendanceState === WORKED && isOwnSeat(seat, 'dev-client-1'),
      );
    expect(money.lifetimeSpendCents).toBe(
      own.reduce((sum, seat) => sum + seat.priceCents, 0),
    );
    expect(money.currency).toBe('EUR');

    const evening = statsAt(EVENING, 'dev-client-1');
    expect(evening.stats.lifetimeVisitsCompleted).toBe(24);
    expect(evening.windows.visitsCompleted.last12m).toBe(14);
  });

  it('Кирил crosses the pause threshold before today, and today’s no-show is his 4th', () => {
    const morning = statsAt(MORNING, 'dev-client-5');
    expect(morning.stats.pauseSuggestionBasis).toHaveLength(3);
    expect(morning.windows.noShows.last90d).toBe(3);
    expect(morning.stats.lifetimeNoShows).toBe(4);
    expect(statsAt(EVENING, 'dev-client-5').stats.pauseSuggestedNoShows).toBe(
      4,
    );
  });

  it('Мартин: a birthday today, and a shop cancel that is nobody’s fault', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-2');
    expect(stats.lifetimeClientCancels).toBe(0);
    expect(stats.avgCadenceDays).not.toBeNull();
    const martin = book.users.find(({ uid }) => uid === 'dev-client-2');
    expect(martin?.doc.birthDate?.slice(5)).toBe('09-25');
    expect(
      book.appointments.some(
        ({ doc }) =>
          doc.subjectUserIds.includes('dev-client-2') &&
          doc.bookingStatus === CANCELLED &&
          doc.seats[0].cancelledBy === 'STAFF',
      ),
    ).toBe(true);
  });

  it('Иво’s visits are found through the mirror, never as an owner', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-10');
    expect(stats.lifetimeVisitsCompleted).toBe(13);
    const his = book.appointments.filter(({ doc }) =>
      doc.subjectCustomerIds.includes(customerIdOf('dev-client-10')),
    );
    expect(his.length).toBeGreaterThan(0);
    expect(
      his.every(({ doc }) => doc.subjectUserIds.includes('dev-client-10')),
    ).toBe(true);
    expect(his.every(({ doc }) => doc.ownerUserId === 'dev-client-3')).toBe(
      true,
    );
    expect(
      his.every(
        ({ doc }) => doc.ownerCustomerId === customerIdOf('dev-client-3'),
      ),
    ).toBe(true);
    expect(
      docById(book, 'appt-dev-party').seats.map((seat) => ({
        seatSubject: seat.seatSubject,
        subjectUserId: seat.subjectUserId,
        subjectCustomerId: seat.subjectCustomerId,
        subjectRelationship: seat.subjectRelationship,
      })),
    ).toEqual([
      {
        seatSubject: ACCOUNT,
        subjectUserId: 'dev-client-3',
        subjectCustomerId: customerIdOf('dev-client-3'),
        subjectRelationship: 'SELF',
      },
      {
        seatSubject: ACCOUNT,
        subjectUserId: 'dev-client-10',
        subjectCustomerId: customerIdOf('dev-client-10'),
        subjectRelationship: 'COMPANION',
      },
    ]);
  });

  it('Петър’s 14:00 is a beard with Стефан, the barber his history names', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-3');
    expect(stats.preferredBarberId).toBe('stefan');
    expect(stats.nextVisitAppointmentId).toBe('appt-dev-3');
    // A service Стефан has worked on him before, not a new ask.
    expect(
      book.appointments.some(
        ({ doc }) =>
          doc.bookingStatus === COMPLETED &&
          doc.seats.some(
            (seat) =>
              isOwnSeat(seat, 'dev-client-3') &&
              seat.barberId === 'stefan' &&
              seat.serviceId === 'svc-beard',
          ),
      ),
    ).toBe(true);
    const [seat] = docById(book, 'appt-dev-3').seats;
    expect(seat).toMatchObject({
      barberId: 'stefan',
      serviceId: 'svc-beard',
      barberPreference: 'SPECIFIC',
    });
    expect(clockOf(seat.startMinutes)).toBe('14:00');
  });

  it('Даниел is a first visit: a profile, one booking, no history', () => {
    const { stats } = statsAt(MORNING, 'dev-client-9');
    expect(stats.lifetimeVisitsCompleted).toBe(0);
    expect(stats.lastVisitAppointmentId).toBeNull();
    expect(stats.nextVisitAppointmentId).toBe('appt-dev-9');
  });

  it('guests are anonymous seats: a handle staff typed, no account, no record', () => {
    const book = buildClientBook(MORNING);
    for (const id of ['appt-dev-guest', 'appt-dev-walkin']) {
      const doc = docById(book, id);
      expect(doc.ownerUserId, id).toBeNull();
      expect(doc.ownerCustomerId, id).toBeNull();
      expect(doc.subjectUserIds, id).toEqual([]);
      expect(doc.subjectCustomerIds, id).toEqual([]);
      expect(doc.placement, id).toBe('STAFF');
      const [seat] = doc.seats;
      expect(seat.seatSubject, id).toBe(ANONYMOUS);
      expect(seat.guestLabel.length, id).toBeGreaterThan(0);
      // No PII beyond the handle: the seat has nowhere to keep a phone.
      expect(Object.keys(seat), id).not.toContain('phone');
      expect('subjectUserId' in seat, id).toBe(false);
    }
  });

  it('every account on a seat has a profile registration would accept', () => {
    const book = buildClientBook(MORNING);
    // `users/{uid}` is the flat registered `User` (flip 2), held to the
    // registration rule on the UTC age day the boundary derives (F2-7) —
    // and to the very body `completeRegistration` writes over the
    // provisioned stub of the client's login phone.
    const ageDay = ZonedTimeSystem.toLocal(MORNING, TimeZone.UTC).localDate;
    const uids = book.users.map(({ uid }) => uid);
    expect(book.subjects.every((uid) => uids.includes(uid))).toBe(true);
    expect(uids).toEqual(
      expect.arrayContaining(['dev-client-5', 'dev-client-6', 'dev-client-8']),
    );
    for (const { uid, doc } of book.users) {
      expect(doc.registrationState, uid).toBe(RegistrationState.Registered);
      expect(doc.accountStatus, uid).toBe(AccountStatus.Active);
      const profile = ProfileEditSystem.registrationProfile(doc, ageDay);
      expect(profile.ok, uid).toBe(true);
      const stub = RegistrationSystem.provision(
        UserId.of(uid),
        ParsedIdentifier.phone(doc.phone),
      );
      const { id, ...registered } = RegistrationSystem.register(
        stub,
        profile.value,
      );
      expect(id, uid).toBe(uid);
      expect(registered, uid).toEqual(doc);
    }
    expect(CLIENTS.some((client) => client.lastName.length > 20)).toBe(true);
  });

  it('today settles only once its time has passed', () => {
    const morning = docById(buildClientBook(MORNING), 'appt-dev-1');
    expect(morning.bookingStatus).toBe(CONFIRMED);
    expect(morning.seats[0].attendanceState).toBe(SCHEDULED);
    expect(morning.seats[0].tipCents).toBeNull();
    expect(morning.arrivedAtUtcMs).toBeNull();

    const evening = docById(buildClientBook(EVENING), 'appt-dev-1');
    expect(evening.bookingStatus).toBe(COMPLETED);
    expect(evening.seats[0].attendanceState).toBe(WORKED);
    expect(evening.seats[0].tipCents).toBe(200);

    expect(docById(buildClientBook(MORNING), 'appt-dev-5').bookingStatus).toBe(
      CONFIRMED,
    );
    expect(docById(buildClientBook(EVENING), 'appt-dev-5').bookingStatus).toBe(
      NO_SHOW,
    );
  });

  it('reads as a real shop’s book', () => {
    const book = buildClientBook(MORNING);
    const byId = new Map(book.appointments.map(({ id, doc }) => [id, doc]));
    const docs = [...byId.values()];

    // Eighteen months back, not further.
    const oldest = Math.min(...docs.map((doc) => doc.utcEpochMs));
    expect(MORNING - oldest).toBeLessThan(610 * DAY_MS);
    expect(MORNING - oldest).toBeGreaterThan(540 * DAY_MS);

    // Both placements, and rebooking edges that point back at a visit of
    // somebody on this one, made before it.
    expect(new Set(docs.map((doc) => doc.placement))).toEqual(
      new Set(['SELF', 'STAFF']),
    );
    const linked = docs.filter((doc) => doc.bookedFromAppointmentId !== null);
    expect(linked.length).toBeGreaterThan(10);
    for (const doc of linked) {
      const source = byId.get(doc.bookedFromAppointmentId);
      expect(source).toBeDefined();
      expect(source.utcEpochMs < doc.utcEpochMs).toBe(true);
      expect(
        source.subjectCustomerIds.some((id) =>
          doc.subjectCustomerIds.includes(id),
        ),
      ).toBe(true);
    }
    for (const doc of docs) {
      if (doc.bookedAtUtcMs === null) continue;
      expect(doc.bookedAtUtcMs).toBeLessThan(doc.utcEpochMs);
      expect(doc.bookedAtUtcMs).toBeLessThanOrEqual(MORNING);
    }

    // Tips on some worked seats and nowhere else; no fact from the future.
    const seats = docs.flatMap((doc) => doc.seats);
    expect(
      seats.filter((seat) => seat.tipCents !== null).length,
    ).toBeGreaterThan(10);
    for (const seat of seats) {
      if (seat.tipCents !== null) expect(seat.attendanceState).toBe(WORKED);
      if (seat.attendanceState !== SCHEDULED) {
        expect(outcomeAtOf(seat)).toBeLessThanOrEqual(MORNING);
      }
    }

    // Every client with a rhythm keeps one of three to six weeks.
    for (const uid of book.subjects) {
      const { stats } = statsAt(MORNING, uid);
      if (stats.avgCadenceDays === null) continue;
      expect(stats.avgCadenceDays, uid).toBeGreaterThanOrEqual(21);
      expect(stats.avgCadenceDays, uid).toBeLessThanOrEqual(42);
    }
  });

  it.each([...ANCHORS, ...WEEK].map((ms) => [new Date(ms).toISOString(), ms]))(
    'every seat is a booking the shop could hold: its own terms, a free chair, inside its barber’s window (%s)',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      const authoredMinutes = authoredMinutesOf(book);
      // Sold by its own barber, at that barber's terms FOR ITS VARIANT — the
      // day fixtures included, which once priced Нико's beard off Стефан's
      // offering. The seed feeds the owner's money screens, so the price is
      // exact; the minutes are the catalogue's unless the fixture names its
      // own (a visit booked shorter or longer).
      for (const { id, doc } of book.appointments) {
        for (const seat of doc.seats) {
          const where = `${id}/${seat.seatId}`;
          const expected = catalogTermsOf(seat);
          expect(expected, where).toBeDefined();
          if (!expected) continue;
          expect(seat.priceCents, where).toBe(expected.priceCents);
          expect(seat.currency, where).toBe(expected.currency);
          expect(seat.durationMinutes, where).toBe(
            authoredMinutes.get(seat.seatId) ?? expected.durationMinutes,
          );
          // A seat re-timed away from the catalogue keeps what the catalogue
          // said, as a staff re-timing does; one sold as the catalogue sells
          // it keeps nothing.
          const retimed = seat.durationMinutes !== expected.durationMinutes;
          expect(seat.catalogPriceCents, where).toBe(
            retimed ? expected.priceCents : null,
          );
          expect(seat.catalogDurationMinutes, where).toBe(
            retimed ? expected.durationMinutes : null,
          );
        }
      }
      // No chair holds two live visits, nor one inside the other's
      // turnaround — the padding the booking places against. The seats of
      // one appointment are one party and never padded apart. Placement
      // math runs on the shop's wall clock (Law 7).
      const lanes = new Map();
      for (const { id, doc } of book.appointments) {
        if (doc.bookingStatus === CANCELLED) continue;
        for (const seat of doc.seats) {
          const key = `${seat.barberId}@${doc.localDate}`;
          const reset = turnaroundMinutesOf(seat.barberId);
          const start = seat.startMinutes;
          const end = start + seat.durationMinutes;
          for (const [from, to, other] of lanes.get(key) ?? []) {
            if (other === id) continue;
            const crowds = start < to + reset && from - reset < end;
            expect(crowds, `${id} vs ${other}`).toBe(false);
          }
          lanes.set(key, [...(lanes.get(key) ?? []), [start, end, id]]);
        }
      }
      // Inside its barber's bookable window (roster ∩ shop hours ∩
      // exceptions) at the appointment's one shop — history, the walk-in AND
      // the day fixtures, whatever weekday the seed runs on. A self-placed
      // visit could only have been sold there; no staff-placed fixture is
      // authored as overtime, so none is let through.
      for (const { id, doc } of book.appointments) {
        for (const seat of doc.seats) {
          const start = seat.startMinutes;
          const end = start + seat.durationMinutes;
          const window = segmentsAt(
            seat.barberId,
            book.calendar,
            book.calendar.offsetOf(doc.localDate),
          ).find(
            (segment) =>
              segment.locationId === doc.locationId &&
              segment.startMinute <= start &&
              end <= segment.endMinute,
          );
          expect(
            window,
            `${id}/${seat.seatId} ${seat.barberId} ${doc.localDate} ${clockOf(start)} at ${doc.locationId}`,
          ).toBeDefined();
        }
      }
    },
  );

  it.each(WEEK.map((ms) => [weekdayName(ms), ms]))(
    'moves a day fixture only forward, to its barbers’ next window, when they are off (%s)',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      const today = book.calendar.dayKeyAt(0);
      const days = book.appointments.filter(({ id }) => isDayFixture(id));
      expect(days).toHaveLength(12);
      const offsets = days.map(({ doc }) =>
        book.calendar.offsetOf(doc.localDate),
      );
      // Never into the past, where it would settle and move the counts.
      for (const { id, doc } of days) {
        expect(doc.localDate >= today, id).toBe(true);
      }
      // The seed's fabricated `barberBusy` starts the day after the last one.
      expect(book.appointmentDays).toBe(1 + Math.max(...offsets));
      expect(book.appointmentDays).toBeLessThanOrEqual(4);
      // The shop is closed on Sundays: nothing is booked for a closed day.
      if (book.calendar.weekdayAt(0) === Weekday.Sun) {
        expect(offsets).not.toContain(0);
      }
      // No day fixture lands on a published exception. Live only once an
      // exception moves into the fixtures' days (today's sits at +5 or
      // later, past them); that placement honours one at all is proven by
      // the booking guards' exception cases.
      for (const exception of scheduleExceptionsFor(book.calendar)) {
        expect(
          days.some(
            ({ doc }, index) =>
              offsets[index] === exception.dayOffset &&
              doc.barberIds.includes(exception.barberId),
          ),
        ).toBe(false);
      }
    },
  );

  it('reads a seat re-timed away from the catalogue as a staff override, and no other', () => {
    const book = buildClientBook(MORNING);
    const authored = authoredMinutesOf(book);
    const seats = book.appointments.flatMap(({ doc }) => doc.seats);
    const retimed = seats
      .filter(
        (seat) =>
          authored.has(seat.seatId) &&
          authored.get(seat.seatId) !== catalogTermsOf(seat)?.durationMinutes,
      )
      .map((seat) => seat.seatId)
      .sort();
    // The day fixtures that name their own minutes (a fade booked at 45
    // rather than 50, …): the visit sheet's «custom» mark has seats to show.
    expect(retimed.length).toBeGreaterThan(0);
    expect(
      seats
        .filter((seat) => Seat.overridden(seat))
        .map((seat) => seat.seatId)
        .sort(),
    ).toEqual(retimed);
    // Only the minutes moved: the catalogue's price is the price charged.
    for (const seat of seats.filter((entry) => Seat.overridden(entry))) {
      expect(seat.catalogPriceCents, seat.seatId).toBe(seat.priceCents);
      expect(seat.catalogDurationMinutes, seat.seatId).not.toBe(
        seat.durationMinutes,
      );
    }
  });

  it('keeps every intent on the pinned Friday that the roster allows', () => {
    const book = buildClientBook(MORNING);
    const at = (id) => {
      const doc = docById(book, id);
      return `${book.calendar.offsetOf(doc.localDate)} ${clockOf(doc.startMinutes)} ${doc.locationId}`;
    };
    // Ivan works Младост on Fridays, so his day is there.
    expect(at('appt-dev-1')).toBe('0 10:00 loc-mladost');
    expect(at('appt-dev-2')).toBe('0 12:30 loc-mladost');
    expect(at('appt-dev-3')).toBe('0 14:00 loc-center');
    // Стоян's party needs Ivan and Стефан in ONE shop — Saturday's Center,
    // before Стефан leaves at 15:00.
    expect(at('appt-dev-4')).toBe('1 14:30 loc-center');
    // Sunday is closed; Monday before Стефан's lunch.
    expect(at('appt-dev-8')).toBe('3 12:30 loc-center');
    // Arrivals ride along with visits that stayed on their day.
    expect(shopClockOf(docById(book, 'appt-dev-2').arrivedAtUtcMs)).toBe(
      '12:25',
    );
    expect(
      shopClockOf(
        docById(buildClientBook(EVENING), 'appt-dev-1').arrivedAtUtcMs,
      ),
    ).toBe('09:56');
  });
});

/**
 * What revision 3 of the client card reads off the book
 * (client-card-revision-3.md §4.2, §4.7, §4.10). The loyalty fold hands the
 * domain's projector FACTS, and «Движение» folds the journal by event: each
 * is only as good as what the book holds for it. These are the book's own
 * promises; `loyalty.spec.mjs` holds what the fold makes of them.
 */
describe('what the rhythm and the feed read off the book (revision 3)', () => {
  const HOLDERS = ['dev-client-1', 'dev-client-2'];
  const ownSeatsOf = (doc, uid) =>
    doc.seats.filter((seat) => isOwnSeat(seat, uid));
  /** Every appointment that seats `uid`, with the seats that are theirs. */
  const visitsOf = (book, uid) =>
    book.appointments
      .map(({ id, doc }) => ({ id, doc, own: ownSeatsOf(doc, uid) }))
      .filter(({ own }) => own.length > 0);

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s every visit of a holder was placed on or before its day: a booking the projector can read',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      for (const uid of HOLDERS) {
        const visits = visitsOf(book, uid);
        expect(visits.length, uid).toBeGreaterThan(10);
        for (const { id, doc, own } of visits) {
          expect(doc.bookedAtUtcMs, id).not.toBeNull();
          const day = shopDayOf(
            Math.min(
              ...own.map((seat) => TimeCoordinate.seatStartUtcMs(doc, seat)),
            ),
          );
          expect(day, id).toBe(doc.localDate);
          expect(shopDayOf(doc.bookedAtUtcMs) <= day, id).toBe(true);
        }
      }
    },
  );

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s a holder’s worked seats are sold in EUR with nothing taken off: a seat’s points are its price',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      for (const uid of HOLDERS) {
        for (const { id, doc, own } of visitsOf(book, uid)) {
          if (!own.some((seat) => seat.attendanceState === WORKED)) continue;
          expect(doc.discounts, id).toEqual([]);
          expect(doc.voucherRedemptions, id).toEqual([]);
          for (const seat of own) {
            expect(seat.currency).toBe('EUR');
            expect(seat.priceCents).toBeGreaterThanOrEqual(100);
          }
        }
      }
    },
  );

  it('Георги has visits of two seats, a fade and a beard: one row of the feed, not two', () => {
    const book = buildClientBook(EVENING);
    const visits = visitsOf(book, 'dev-client-1').filter(({ own }) =>
      own.every((seat) => seat.attendanceState === WORKED),
    );
    const both = visits.filter(({ own }) => own.length === 2);
    expect(visits).toHaveLength(24);
    expect(both.length).toBeGreaterThanOrEqual(5);
    for (const { own } of both) {
      expect(own.map((seat) => seat.serviceId).sort()).toEqual([
        'svc-beard',
        'svc-fade',
      ]);
      expect(
        own.reduce(
          (points, seat) => points + Math.floor(seat.priceCents / 100),
          0,
        ),
      ).toBe(27);
    }
    // Nobody rides along: he never brings company, so the visit is his alone.
    expect(
      visits.every(({ doc, own }) => doc.seats.length === own.length),
    ).toBe(true);
  });

  it('Мартин’s one called-off visit is the shop’s, by a reason the rule knows, and today’s chair was booked ahead', () => {
    const book = buildClientBook(MORNING);
    const today = book.calendar.dayKeyAt(0);
    const calledOff = visitsOf(book, 'dev-client-2').filter(({ own }) =>
      own.every((seat) => seat.attendanceState === CANCELLED),
    );
    expect(
      calledOff.map(({ own }) => [
        own[0].cancelledBy,
        own[0].cancellationReason,
      ]),
    ).toEqual([['STAFF', 'STAFF_BARBER_ABSENCE']]);
    // The visit ahead that holds his period: `StreakState.heldByAppointmentId` names it.
    const held = docById(book, 'appt-dev-2');
    expect(held.localDate).toBe(today);
    expect(shopDayOf(held.bookedAtUtcMs) < today).toBe(true);
    expect(held.seats[0].attendanceState).toBe(SCHEDULED);
    // And Георги's own, which he has not cancelled either.
    expect(docById(book, 'appt-dev-1').bookingStatus).not.toBe(CANCELLED);
  });

  it('no holder cancelled a visit of their own: every booking they made still stands as a fact', () => {
    const book = buildClientBook(EVENING);
    for (const uid of HOLDERS) {
      expect(
        visitsOf(book, uid).filter(({ own }) =>
          own.every(
            (seat) =>
              seat.attendanceState === CANCELLED &&
              seat.cancelledBy === 'CLIENT',
          ),
        ),
        uid,
      ).toEqual([]);
    }
  });
});

describe('the seed’s booking guards', () => {
  const calendar = createShopCalendar(MORNING);

  /** A hand-authored visit of one seat, today at the Center, booked last week. */
  const fixtureWith = (seat) => ({
    id: 'appt-guard',
    dayOffset: 0,
    locationId: 'loc-center',
    placement: Placement.Self,
    bookedOn: { dayOffset: -7, minutes: 12 * 60 },
    arrivedMinutes: null,
    bookedFromAppointmentId: null,
    contact: null,
    seats: [
      {
        seatId: 'seat-guard',
        variantId: null,
        startMinutes: 14 * 60,
        durationMinutes: null,
        ...accountSeat('dev-client-3'),
        barberPreference: BarberPreference.Specific,
        ...SCHEDULED_SEAT,
        tipCents: null,
        ...seat,
      },
    ],
  });

  it('refuses a barber the service has no offering for — no neighbour’s terms to borrow', () => {
    expect(() => chairTerms('svc-beard', 'niko', null)).toThrow(
      'seed: niko does not offer svc-beard',
    );
  });

  it('stops the book on a day fixture its barber does not sell, naming the seat', () => {
    expect(() =>
      appointmentDocumentOf(
        fixtureWith({ barberId: 'niko', serviceId: 'svc-beard' }),
        calendar,
      ),
    ).toThrow(
      'seed: seat seat-guard cannot be sold (seed: niko does not offer svc-beard)',
    );
  });

  it('sells any seat at its own barber’s terms, or refuses it', () => {
    const seats = fc.constantFrom(...SERVICES).chain((service) =>
      fc.record({
        serviceId: fc.constant(service.id),
        variantId:
          service.body.variants.length === 0
            ? fc.constant(null)
            : fc.constantFrom(
                ...service.body.variants.map((variant) => variant.variantId),
              ),
        barberId: fc.constantFrom(...BARBERS.map((barber) => barber.id)),
        startMinutes: fc
          .integer({ min: 9, max: 17 })
          .chain((hour) =>
            fc.constantFrom(0, 15, 30, 45).map((minute) => hour * 60 + minute),
          ),
      }),
    );
    fc.assert(
      fc.property(seats, (seat) => {
        const fixture = fixtureWith(seat);
        const offering = offeringOf(seat.serviceId, seat.barberId);
        if (!offering) {
          expect(() => appointmentDocumentOf(fixture, calendar)).toThrow(
            `seed: ${seat.barberId} does not offer ${seat.serviceId}`,
          );
          return;
        }
        const [written] = appointmentDocumentOf(fixture, calendar).doc.seats;
        expect(written.barberId).toBe(seat.barberId);
        // Exactly the variant's terms, else the barber's own — a long seat
        // at the short price is as wrong as another barber's price.
        const expected = catalogTermsOf(seat);
        expect(written.priceCents).toBe(expected.priceCents);
        expect(written.durationMinutes).toBe(expected.durationMinutes);
      }),
    );
  });

  it('refuses a cancellation stamped after the visit began', () => {
    expect(() =>
      appointmentDocumentOf(
        {
          ...fixtureWith({
            barberId: 'stefan',
            serviceId: 'svc-beard',
            ...calledOffAt(
              CancelledBy.Client,
              CancellationReason.ClientChangedPlans,
              { dayOffset: -1, minutes: 14 * 60 + 10 },
            ),
          }),
          dayOffset: -1,
        },
        calendar,
      ),
    ).toThrow('seed: appt-guard/seat-guard is cancelled after it started');
  });

  it('refuses a visit placed in no shop', () => {
    expect(() =>
      appointmentDocumentOf(
        {
          ...fixtureWith({ barberId: 'stefan', serviceId: 'svc-beard' }),
          locationId: null,
        },
        calendar,
      ),
    ).toThrow('seed: appt-guard was never placed in a shop');
  });

  it('reads a barber’s window as the roster clamped to the shop’s hours', () => {
    // Стефан's Saturday roster starts 09:00; the Center opens at 10:00.
    expect(segmentsOn('stefan', Weekday.Sat)).toEqual([
      { startMinute: 600, endMinute: 900, locationId: 'loc-center' },
    ]);
    // Nobody works a closed shop, whatever a roster says.
    expect(
      BARBERS.flatMap((barber) => segmentsOn(barber.id, Weekday.Sun)),
    ).toEqual([]);
  });

  it.each(WEEK.map((ms) => [weekdayName(ms), ms]))(
    'publishes Стефан’s day off on the first day from +5 that his roster works (%s)',
    (_label, nowMs) => {
      const calendar = createShopCalendar(nowMs);
      const exceptions = scheduleExceptionsFor(calendar);
      expect(exceptions).toHaveLength(1);
      const [closed] = exceptions;
      // A day the ROSTER works, so the greyed day tells the exception apart
      // from a day off: a fixed +5 fell on his Sunday from a Tuesday and on
      // his Wednesday from a Friday.
      const rostered = segmentsOn(
        closed.barberId,
        calendar.weekdayAt(closed.dayOffset),
      );
      expect(rostered).not.toEqual([]);
      // At the shop the roster puts him in that day.
      expect(rostered.map((segment) => segment.locationId)).toContain(
        closed.locationId,
      );
      // The FIRST such day from +5: every day between is one he is off.
      expect(closed.dayOffset).toBeGreaterThanOrEqual(
        EXCEPTION_EARLIEST_OFFSET,
      );
      for (
        let offset = EXCEPTION_EARLIEST_OFFSET;
        offset < closed.dayOffset;
        offset++
      ) {
        expect(segmentsOn(closed.barberId, calendar.weekdayAt(offset))).toEqual(
          [],
        );
      }
      // And the window placement reads is the exception's: closed that day.
      expect(segmentsAt(closed.barberId, calendar, closed.dayOffset)).toEqual(
        [],
      );
      // The seed writes the same answer every time it is asked.
      expect(scheduleExceptionsFor(calendar)).toBe(exceptions);
    },
  );

  describe('an exception, on a day its barber’s roster works', () => {
    // From a Monday, the first worked day from +5 is +5 itself, a Saturday.
    const monday = createShopCalendar(Date.parse('2026-09-21T07:30:00+03:00'));
    const [closed] = scheduleExceptionsFor(monday);
    const SATURDAY = Weekday.Sat;

    it('closes that barber’s window that day, and nothing else', () => {
      expect(monday.weekdayAt(closed.dayOffset)).toBe(SATURDAY);
      expect(segmentsOn(closed.barberId, SATURDAY)).not.toEqual([]);
      expect(segmentsAt(closed.barberId, monday, closed.dayOffset)).toEqual([]);
      // Another barber that day, and the same barber a week on, keep theirs.
      expect(segmentsAt('ivan', monday, closed.dayOffset)).toEqual(
        segmentsOn('ivan', SATURDAY),
      );
      expect(segmentsAt(closed.barberId, monday, closed.dayOffset + 7)).toEqual(
        segmentsOn(closed.barberId, SATURDAY),
      );
    });

    it('places a visit past the closed day, on the next one the barber works', () => {
      const placed = placeVisit(monday, createChairBook(), {
        offsets: [closed.dayOffset, closed.dayOffset + 1, closed.dayOffset + 2],
        preferredMinute: 11 * 60,
        blocks: [{ barberId: closed.barberId, from: 0, to: 30 }],
      });
      // Saturday is closed for him, Sunday for the shop: Monday, as asked.
      expect(placed).toEqual({
        offset: closed.dayOffset + 2,
        start: 11 * 60,
        locationId: 'loc-center',
      });
    });

    it('seats no party with that barber on the closed day, even as a companion', () => {
      // Ivan leads, so only the companion's window can refuse Saturday —
      // where, without the exception, both work the Center.
      const placed = placeVisit(monday, createChairBook(), {
        offsets: [closed.dayOffset, closed.dayOffset + 1, closed.dayOffset + 2],
        preferredMinute: 12 * 60,
        blocks: [
          { barberId: 'ivan', from: 0, to: 35 },
          { barberId: closed.barberId, from: 0, to: 30 },
        ],
      });
      expect(placed).toEqual({
        offset: closed.dayOffset + 2,
        start: 12 * 60,
        locationId: 'loc-center',
      });
    });
  });

  it('seats a party side by side in ONE shop, or not at all', () => {
    // Pinned Friday: Ivan is at Младост, Нико at the Center — no shop holds
    // both today, so the party goes to the first day one does.
    const party = [
      { barberId: 'ivan', from: 0, to: 35 },
      { barberId: 'niko', from: 0, to: 45 },
    ];
    const placed = placeVisit(calendar, createChairBook(), {
      offsets: [0, 1],
      preferredMinute: 12 * 60,
      blocks: party,
    });
    expect(placed).toMatchObject({ offset: 1, locationId: 'loc-center' });
    expect(
      placeVisit(calendar, createChairBook(), {
        offsets: [0],
        preferredMinute: 12 * 60,
        blocks: party,
      }),
    ).toBeNull();
  });

  it('keeps a barber’s turnaround free between unrelated visits', () => {
    const book = createChairBook();
    const at = (hour, minute) => hour * 60 + minute;
    book.take('stefan', -1, at(14, 0), at(14, 30));
    // Стефан resets for 15 minutes; 14:30 would crowd the last client.
    expect(book.isFree('stefan', -1, at(14, 30), at(15, 0))).toBe(false);
    expect(book.isFree('stefan', -1, at(13, 15), at(13, 45))).toBe(true);
    expect(book.isFree('stefan', -1, at(13, 20), at(13, 50))).toBe(false);
    expect(book.isFree('stefan', -1, at(14, 45), at(15, 15))).toBe(true);
    // Another day, another chair: nothing taken there.
    expect(book.isFree('stefan', -2, at(14, 30), at(15, 0))).toBe(true);
    expect(book.isFree('ivan', -1, at(14, 30), at(15, 0))).toBe(true);
    // Нико declares no reset, so back to back is his to take.
    book.take('niko', -1, at(14, 0), at(14, 30));
    expect(book.isFree('niko', -1, at(14, 30), at(15, 0))).toBe(true);
  });
});
