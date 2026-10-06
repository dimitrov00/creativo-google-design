/**
 * The dev seed's client book, checked against the production code that will
 * read it: every document round-trips through the real appointment mapper,
 * and every named fixture (design §12.4 P0 «Seed») is asserted through the
 * real `computeClientStats` — so "Георги is a regular with 23 visits" is a
 * fact the stats engine agrees with, not a comment.
 *
 * "Now" is pinned. A sweep of anchor days (DST changes, 29 February, every
 * weekday) proves the counts hold whatever day the seed runs on.
 */
import {
  appointmentFromDocument,
  appointmentToDocument,
} from '@creativo/application/booking';
import { AccountStatus, User, UserId } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  BookingPolicy,
  ClientStatsPolicy,
  computeClientMoneyStats,
  computeClientStats,
  statWindows,
} from '@creativo/domain/scheduling';
import fc from 'fast-check';
import {
  CANCELLATION_WINDOW_HOURS,
  account,
  appointmentDocumentOf,
} from './appointments.mjs';
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
import { CLIENTS, buildClientBook } from './fixtures.mjs';
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

const aggregatesOf = (book) =>
  book.appointments.map(({ id, doc }) => {
    const parsed = appointmentFromDocument(id, doc);
    if (parsed.isFailure()) {
      throw new Error(`${id}: ${parsed.error.message}`);
    }
    return parsed.value;
  });

/** Who placed each visit — the stored `placement`, which the stats read beside the seats. */
const placementsOf = (book) =>
  new Map(
    book.appointments
      .filter(
        ({ doc }) => doc.placement === 'self' || doc.placement === 'staff',
      )
      .map(({ id, doc }) => [id, doc.placement]),
  );

function statsAt(nowMs, uid, policy = ClientStatsPolicy.default()) {
  const book = buildClientBook(nowMs);
  const subject = UserId.create(uid);
  if (subject.isFailure()) throw subject.error;
  const appointments = aggregatesOf(book);
  const stats = computeClientStats(
    subject.value,
    appointments,
    nowMs,
    policy,
    placementsOf(book),
  );
  return {
    book,
    appointments,
    stats,
    windows: statWindows(stats, nowMs),
    money: computeClientMoneyStats(subject.value, appointments),
  };
}

/** The walk-in's typed phone rides ahead of the P1 mapper, which drops it. */
function withoutGuestPhones(doc) {
  return {
    ...doc,
    seats: doc.seats.map((seat) => {
      if (seat.subject.kind !== 'anonymous') return seat;
      const subject = { ...seat.subject };
      delete subject.phone;
      return { ...seat, subject };
    }),
  };
}

const docById = (book, id) => {
  const entry = book.appointments.find((appointment) => appointment.id === id);
  if (!entry) throw new Error(`no ${id}`);
  return entry.doc;
};

const minuteOfDay = (iso) =>
  Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

/** The barber's own offering of a service, read straight off the catalogue. */
const offeringOf = (serviceId, barberId) =>
  SERVICES.find((service) => service.id === serviceId)?.offerings.find(
    (offering) => offering.barberId === barberId,
  );

/**
 * The terms the catalogue sells THIS seat at: its barber's price for its
 * variant, else that barber's base — never another variant's, another
 * barber's, or the service's list price.
 */
const catalogTermsOf = (seat) => {
  const offering = offeringOf(seat.serviceId, seat.barberId);
  if (!offering) return undefined;
  return (
    (seat.variantId && offering.byVariant?.[seat.variantId]) || offering.base
  );
};

/** The minutes a fixture's seat names for itself, by seat id — the only override the seed writes. */
const authoredMinutesOf = (book) =>
  new Map(
    book.fixtures.flatMap((fixture) =>
      fixture.seats
        .filter((seat) => seat.minutes !== undefined)
        .map((seat) => [seat.id, seat.minutes]),
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
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayName = (ms) => WEEKDAY_NAMES[createShopCalendar(ms).weekdayAt(0)];

describe('the dev seed client book', () => {
  it('writes the same documents on every run of a day', () => {
    const written = ({ users, appointments }) => ({ users, appointments });
    const first = buildClientBook(MORNING);
    expect(written(buildClientBook(MORNING))).toEqual(written(first));
    // Only today's settle-once-past fixtures may differ between morning
    // and evening; the past is the past.
    const past = (book) =>
      book.appointments.filter(
        ({ doc }) => doc.timeSlot.startIso < '2026-09-25',
      );
    expect(past(buildClientBook(EVENING))).toEqual(past(first));
    expect(buildClientBook(EVENING).appointments.map(({ id }) => id)).toEqual(
      first.appointments.map(({ id }) => id),
    );
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'every appointment is exactly the mapper’s shape (%s)',
    (_label, nowMs) => {
      const book = buildClientBook(nowMs);
      for (const { id, doc } of book.appointments) {
        const parsed = appointmentFromDocument(id, doc);
        expect(parsed.isSuccess(), id).toBe(true);
        if (parsed.isFailure()) continue;
        expect(
          appointmentToDocument(parsed.value, { placement: doc.placement }),
          id,
        ).toEqual(withoutGuestPhones(doc));
      }
    },
  );

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'every named fixture holds its state on any day (%s)',
    (_label, nowMs) => {
      const georgi = statsAt(nowMs, 'dev-client-1');
      expect(georgi.stats.lifetime.visitsCompleted).toBe(23);
      expect(georgi.windows.visitsCompleted.last12m).toBe(13);

      const kiril = statsAt(nowMs, 'dev-client-5');
      expect(kiril.stats.pauseSuggestion?.noShows).toBe(3);
      expect(kiril.stats.pauseSuggestion?.windowDays).toBe(60);

      const nikolay = statsAt(nowMs, 'dev-client-6');
      expect(nikolay.stats.lifetime.lateCancels).toBe(1);
      expect(nikolay.stats.lifetime.clientCancels).toBe(3);

      expect(
        statsAt(nowMs, 'dev-client-10').stats.lifetime.visitsCompleted,
      ).toBe(13);
    },
  );

  it('stamps every cancellation with the window the seeded policy sets, as the cancel paths do', () => {
    // The seeded `settings/bookingPolicy` and the stamp are one number.
    expect(CANCELLATION_WINDOW_HOURS).toBe(
      BookingPolicy.default().cancellationWindowHours,
    );
    const cancelled = buildClientBook(MORNING).appointments.flatMap(({ doc }) =>
      doc.seats
        .map((seat) => seat.outcome)
        .filter((outcome) => outcome.kind === 'cancelled'),
    );
    expect(cancelled.length).toBeGreaterThan(0);
    for (const outcome of cancelled) {
      expect(outcome.windowHours).toBe(CANCELLATION_WINDOW_HOURS);
    }
  });

  it('keeps Николай’s late cancel whatever the owner moves the window to', () => {
    const defaults = BookingPolicy.default();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 96 }), (hours) => {
        const booking = BookingPolicy.create({
          maxPartySize: defaults.maxPartySize,
          slotStepMinutes: defaults.slotStepMinutes,
          minLeadMinutes: defaults.minLeadMinutes,
          horizonMonths: defaults.horizonMonths,
          cancellationWindowHours: hours,
          maxFlexibleDays: defaults.maxFlexibleDays,
          autoConfirm: defaults.autoConfirm,
        });
        if (booking.isFailure()) throw new Error('bad policy');
        const { stats } = statsAt(
          MORNING,
          'dev-client-6',
          ClientStatsPolicy.forBooking(booking.value),
        );
        expect(stats.lifetime.lateCancels).toBe(1);
        expect(stats.lifetime.clientCancels).toBe(3);
      }),
      { numRuns: 12 },
    );
  });

  it('Георги is the regular: 23 visits, 13 in a year, Ivan by name', () => {
    const { stats, windows, money, appointments, book } = statsAt(
      MORNING,
      'dev-client-1',
    );
    expect(stats.lifetime).toEqual({
      visitsCompleted: 23,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    });
    expect(windows.visitsCompleted.last12m).toBe(13);
    expect(stats.preferredBarberId?.value).toBe('ivan');
    expect(stats.usualServiceIds.map((id) => id.value)).toContain('svc-fade');
    // Eighteen months of him, give or take a haircut.
    expect(MORNING - (stats.firstVisitAtMs ?? MORNING)).toBeGreaterThan(
      540 * DAY_MS,
    );
    // Today's 10:00 is still to come — and it was booked from his last visit.
    expect(stats.nextVisit?.appointmentId.value).toBe('appt-dev-1');
    expect(docById(book, 'appt-dev-1').bookedFromAppointmentId).toBe(
      stats.lastVisit?.appointmentId.value,
    );
    // Spend is the worked seats' prices; tips are not the shop's money.
    const own = appointments
      .flatMap((appointment) => appointment.seats)
      .filter(
        (seat) =>
          seat.outcome.kind === 'worked' &&
          seat.subject.kind === 'account' &&
          seat.subject.userId.value === 'dev-client-1',
      );
    expect(money.lifetimeSpendMinor).toBe(
      own.reduce((sum, seat) => sum + seat.terms.price.toMinorUnits(), 0),
    );

    const evening = statsAt(EVENING, 'dev-client-1');
    expect(evening.stats.lifetime.visitsCompleted).toBe(24);
    expect(evening.windows.visitsCompleted.last12m).toBe(14);
  });

  it('Кирил crosses the pause threshold before today, and today’s no-show is his 4th', () => {
    const morning = statsAt(MORNING, 'dev-client-5');
    expect(morning.stats.pauseSuggestion?.basis).toHaveLength(3);
    expect(morning.windows.noShows.last90d).toBe(3);
    expect(morning.stats.lifetime.noShows).toBe(4);
    expect(
      statsAt(EVENING, 'dev-client-5').stats.pauseSuggestion?.noShows,
    ).toBe(4);
  });

  it('Мартин: a birthday today, and a shop cancel that is nobody’s fault', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-2');
    expect(stats.lifetime.clientCancels).toBe(0);
    expect(stats.avgCadenceDays).not.toBeNull();
    const martin = book.users.find(({ uid }) => uid === 'dev-client-2');
    expect(martin?.doc.birthDate?.slice(5)).toBe('09-25');
    expect(
      book.appointments.some(
        ({ doc }) =>
          doc.subjectUserIds.includes('dev-client-2') &&
          doc.status.kind === 'cancelled' &&
          doc.seats[0].outcome.by === 'staff',
      ),
    ).toBe(true);
  });

  it('Иво’s visits are found through the mirror, never as an owner', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-10');
    expect(stats.lifetime.visitsCompleted).toBe(13);
    const his = book.appointments.filter(({ doc }) =>
      doc.subjectUserIds.includes('dev-client-10'),
    );
    expect(his.every(({ doc }) => doc.ownerUserId === 'dev-client-3')).toBe(
      true,
    );
    expect(
      docById(book, 'appt-dev-party').seats.map((seat) => seat.subject),
    ).toEqual([
      { kind: 'account', userId: 'dev-client-3', relationship: 'self' },
      { kind: 'account', userId: 'dev-client-10', relationship: 'companion' },
    ]);
  });

  it('Петър’s 14:00 is a beard with Стефан, the barber his history names', () => {
    const { stats, book } = statsAt(MORNING, 'dev-client-3');
    expect(stats.preferredBarberId?.value).toBe('stefan');
    expect(stats.nextVisit?.appointmentId.value).toBe('appt-dev-3');
    // A service Стефан has worked on him before, not a new ask.
    expect(
      book.appointments.some(
        ({ doc }) =>
          doc.status.kind === 'completed' &&
          doc.seats.some(
            (seat) =>
              seat.subject.userId === 'dev-client-3' &&
              seat.barberId === 'stefan' &&
              seat.serviceId === 'svc-beard',
          ),
      ),
    ).toBe(true);
    const [seat] = docById(book, 'appt-dev-3').seats;
    expect(seat).toMatchObject({
      barberId: 'stefan',
      serviceId: 'svc-beard',
      barberPref: 'specific',
    });
    expect(seat.slot.startIso.slice(11, 16)).toBe('14:00');
  });

  it('Даниел is a first visit: a profile, one booking, no history', () => {
    const { stats } = statsAt(MORNING, 'dev-client-9');
    expect(stats.lifetime.visitsCompleted).toBe(0);
    expect(stats.lastVisit).toBeNull();
    expect(stats.nextVisit?.appointmentId.value).toBe('appt-dev-9');
  });

  it('guests carry the typed phone on the seat and no account', () => {
    const book = buildClientBook(MORNING);
    for (const id of ['appt-dev-guest', 'appt-dev-walkin']) {
      const doc = docById(book, id);
      expect(doc.ownerUserId, id).toBeNull();
      expect(doc.subjectUserIds, id).toEqual([]);
      expect(doc.placement, id).toBe('staff');
      expect(doc.seats[0].subject, id).toMatchObject({
        kind: 'anonymous',
        phone: expect.stringMatching(/^\+359\d{9}$/),
      });
    }
  });

  it('every account on a seat has a profile registration would accept', () => {
    const book = buildClientBook(MORNING);
    const today = ZonedDateTime.fromMillis(MORNING, ZONE);
    if (today.isFailure()) throw today.error;
    const uids = book.users.map(({ uid }) => uid);
    expect(book.subjects.every((uid) => uids.includes(uid))).toBe(true);
    expect(uids).toEqual(
      expect.arrayContaining(['dev-client-5', 'dev-client-6', 'dev-client-8']),
    );
    for (const { uid, doc } of book.users) {
      const user = User.create(
        {
          id: uid,
          phone: doc.phone,
          firstName: doc.firstName,
          lastName: doc.lastName,
          roles: doc.roles,
          status: AccountStatus.active(),
          email: doc.email ?? undefined,
          birthDate: doc.birthDate ?? undefined,
        },
        today.value,
      );
      expect(user.isSuccess(), uid).toBe(true);
    }
    expect(CLIENTS.some((client) => client.lastName.length > 20)).toBe(true);
  });

  it('today settles only once its time has passed', () => {
    const morning = docById(buildClientBook(MORNING), 'appt-dev-1');
    expect(morning.status).toEqual({ kind: 'confirmed' });
    expect(morning.seats[0].outcome).toEqual({ kind: 'scheduled' });
    expect(morning.seats[0].tipMinorUnits).toBeNull();
    expect(morning.arrivedAt).toBeNull();

    const evening = docById(buildClientBook(EVENING), 'appt-dev-1');
    expect(evening.status).toEqual({ kind: 'completed' });
    expect(evening.seats[0].outcome.kind).toBe('worked');
    expect(evening.seats[0].tipMinorUnits).toBe(200);

    expect(docById(buildClientBook(MORNING), 'appt-dev-5').status.kind).toBe(
      'confirmed',
    );
    expect(docById(buildClientBook(EVENING), 'appt-dev-5').status.kind).toBe(
      'no_show',
    );
  });

  it('reads as a real shop’s book', () => {
    const book = buildClientBook(MORNING);
    const byId = new Map(book.appointments.map(({ id, doc }) => [id, doc]));
    const docs = [...byId.values()];

    // Eighteen months back, not further.
    const oldest = Math.min(
      ...docs.map((doc) => Date.parse(doc.timeSlot.startIso)),
    );
    expect(MORNING - oldest).toBeLessThan(610 * DAY_MS);
    expect(MORNING - oldest).toBeGreaterThan(540 * DAY_MS);

    // Both placements, and rebooking edges that point back at a visit of
    // somebody on this one, made before it.
    expect(new Set(docs.map((doc) => doc.placement))).toEqual(
      new Set(['self', 'staff']),
    );
    const linked = docs.filter((doc) => doc.bookedFromAppointmentId !== null);
    expect(linked.length).toBeGreaterThan(10);
    for (const doc of linked) {
      const source = byId.get(doc.bookedFromAppointmentId);
      expect(source).toBeDefined();
      expect(source.timeSlot.startIso < doc.timeSlot.startIso).toBe(true);
      expect(
        source.subjectUserIds.some((uid) => doc.subjectUserIds.includes(uid)),
      ).toBe(true);
    }
    for (const doc of docs) {
      if (doc.bookedAt === null) continue;
      expect(Date.parse(doc.bookedAt.iso)).toBeLessThan(
        Date.parse(doc.timeSlot.startIso),
      );
      expect(Date.parse(doc.bookedAt.iso)).toBeLessThanOrEqual(MORNING);
    }

    // Tips on some worked seats and nowhere else; no fact from the future.
    const seats = docs.flatMap((doc) => doc.seats);
    expect(
      seats.filter((seat) => seat.tipMinorUnits !== null).length,
    ).toBeGreaterThan(10);
    for (const seat of seats) {
      if (seat.tipMinorUnits !== null) expect(seat.outcome.kind).toBe('worked');
      if (seat.outcome.kind !== 'scheduled') {
        expect(seat.outcome.atMs).toBeLessThanOrEqual(MORNING);
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
          const where = `${id}/${seat.id}`;
          const expected = catalogTermsOf(seat);
          expect(expected, where).toBeDefined();
          if (!expected) continue;
          expect(seat.terms.priceMinorUnits, where).toBe(
            expected.priceMinorUnits,
          );
          expect(seat.terms.currencyCode, where).toBe(expected.currencyCode);
          expect(seat.terms.durationMinutes, where).toBe(
            authoredMinutes.get(seat.id) ?? expected.durationMinutes,
          );
          // A seat re-timed away from the catalogue keeps what the catalogue
          // said, as a staff re-timing does; one sold as the catalogue sells
          // it keeps nothing.
          const retimed =
            seat.terms.durationMinutes !== expected.durationMinutes;
          expect(seat.terms.catalogPriceMinorUnits, where).toBe(
            retimed ? expected.priceMinorUnits : null,
          );
          expect(seat.terms.catalogDurationMinutes, where).toBe(
            retimed ? expected.durationMinutes : null,
          );
        }
      }
      // No chair holds two live visits, nor one inside the other's
      // turnaround — the padding `commitBooking` places against. The seats
      // of one appointment are one party and never padded apart.
      const lanes = new Map();
      for (const { id, doc } of book.appointments) {
        if (doc.status.kind === 'cancelled') continue;
        for (const seat of doc.seats) {
          const key = `${seat.barberId}@${seat.slot.startIso.slice(0, 10)}`;
          const reset = turnaroundMinutesOf(seat.barberId) * 60_000;
          const start = Date.parse(seat.slot.startIso);
          const end = Date.parse(seat.slot.endIso);
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
          const start = minuteOfDay(seat.slot.startIso);
          const end = start + seat.terms.durationMinutes;
          const window = segmentsAt(
            seat.barberId,
            book.calendar,
            book.calendar.offsetOf(seat.slot.startIso.slice(0, 10)),
          ).find(
            (segment) =>
              segment.locationId === doc.locationId &&
              segment.startMinute <= start &&
              end <= segment.endMinute,
          );
          expect(
            window,
            `${id}/${seat.id} ${seat.barberId} ${seat.slot.startIso} at ${doc.locationId}`,
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
        book.calendar.offsetOf(doc.timeSlot.startIso.slice(0, 10)),
      );
      // Never into the past, where it would settle and move the counts.
      for (const { id, doc } of days) {
        expect(doc.timeSlot.startIso.slice(0, 10) >= today, id).toBe(true);
      }
      // The seed's fabricated `barberBusy` starts the day after the last one.
      expect(book.appointmentDays).toBe(1 + Math.max(...offsets));
      expect(book.appointmentDays).toBeLessThanOrEqual(4);
      // The shop is closed on Sundays: nothing is booked for a closed day.
      if (book.calendar.weekdayAt(0) === 0) expect(offsets).not.toContain(0);
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
    const retimed = book.appointments
      .flatMap(({ doc }) => doc.seats)
      .filter(
        (seat) =>
          authored.has(seat.id) &&
          authored.get(seat.id) !== catalogTermsOf(seat)?.durationMinutes,
      )
      .map((seat) => seat.id)
      .sort();
    // The day fixtures that name their own minutes (a fade booked at 45
    // rather than 50, …): the visit sheet's «custom» mark has seats to show.
    expect(retimed.length).toBeGreaterThan(0);
    const seats = aggregatesOf(book).flatMap(
      (appointment) => appointment.seats,
    );
    expect(
      seats
        .filter((seat) => seat.overridden())
        .map((seat) => seat.id.value)
        .sort(),
    ).toEqual(retimed);
    // Only the minutes moved: the catalogue's price is the price charged.
    for (const seat of seats.filter((entry) => entry.overridden())) {
      expect(
        seat.catalogTerms?.price.equals(seat.terms.price),
        seat.id.value,
      ).toBe(true);
      expect(seat.catalogTerms?.durationMinutes, seat.id.value).not.toBe(
        seat.terms.durationMinutes,
      );
    }
  });

  it('keeps every intent on the pinned Friday that the roster allows', () => {
    const book = buildClientBook(MORNING);
    const at = (id) => {
      const doc = docById(book, id);
      return `${book.calendar.offsetOf(doc.timeSlot.startIso.slice(0, 10))} ${doc.timeSlot.startIso.slice(11, 16)} ${doc.locationId}`;
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
    expect(docById(book, 'appt-dev-2').arrivedAt?.iso.slice(11, 16)).toBe(
      '12:25',
    );
    expect(
      docById(buildClientBook(EVENING), 'appt-dev-1').arrivedAt?.iso.slice(
        11,
        16,
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
  const sofiaDay = (iso) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
      new Date(Date.parse(iso)),
    );
  const ownSeatsOf = (doc, uid) =>
    doc.seats.filter(
      (seat) => seat.subject.kind === 'account' && seat.subject.userId === uid,
    );
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
          expect(doc.bookedAt, id).not.toBeNull();
          const day = sofiaDay(own.map((seat) => seat.slot.startIso).sort()[0]);
          expect(sofiaDay(doc.bookedAt.iso) <= day, id).toBe(true);
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
          if (!own.some((seat) => seat.outcome.kind === 'worked')) continue;
          expect(doc.discounts ?? [], id).toEqual([]);
          expect(doc.voucherRedemptions ?? [], id).toEqual([]);
          for (const seat of own) {
            expect(seat.terms.currencyCode).toBe('EUR');
            expect(seat.terms.priceMinorUnits).toBeGreaterThanOrEqual(100);
          }
        }
      }
    },
  );

  it('Георги has visits of two seats, a fade and a beard: one row of the feed, not two', () => {
    const book = buildClientBook(EVENING);
    const visits = visitsOf(book, 'dev-client-1').filter(({ own }) =>
      own.every((seat) => seat.outcome.kind === 'worked'),
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
          (points, seat) =>
            points + Math.floor(seat.terms.priceMinorUnits / 100),
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
      own.every((seat) => seat.outcome.kind === 'cancelled'),
    );
    expect(
      calledOff.map(({ own }) => [own[0].outcome.by, own[0].outcome.reason]),
    ).toEqual([['staff', { kind: 'staff_barber_absence' }]]);
    // The visit ahead that holds his period: `StreakState.heldBy` names it.
    const held = docById(book, 'appt-dev-2');
    expect(sofiaDay(held.seats[0].slot.startIso)).toBe(today);
    expect(sofiaDay(held.bookedAt.iso) < today).toBe(true);
    expect(held.seats[0].outcome.kind).toBe('scheduled');
    // And Георги's own, which he has not cancelled either.
    expect(docById(book, 'appt-dev-1').status.kind).not.toBe('cancelled');
  });

  it('no holder cancelled a visit of their own: every booking they made still stands as a fact', () => {
    const book = buildClientBook(EVENING);
    for (const uid of HOLDERS) {
      expect(
        visitsOf(book, uid).filter(({ own }) =>
          own.every(
            (seat) =>
              seat.outcome.kind === 'cancelled' && seat.outcome.by === 'client',
          ),
        ),
        uid,
      ).toEqual([]);
    }
  });
});

describe('the seed’s booking guards', () => {
  const calendar = createShopCalendar(MORNING);

  /** A hand-authored day fixture of one seat, today, booked last week. */
  const fixtureWith = (seat) => ({
    id: 'appt-guard',
    dayOffset: 0,
    status: { kind: 'confirmed' },
    placement: 'self',
    bookedAt: { dayOffset: -7, hour: 12, minute: 0 },
    contact: null,
    seats: [
      {
        id: 'seat-guard',
        hour: 14,
        minute: 0,
        subject: account('dev-client-3'),
        pref: 'specific',
        outcome: { kind: 'scheduled' },
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
          service.variants.length === 0
            ? fc.constant(null)
            : fc.constantFrom(...service.variants.map((variant) => variant.id)),
        barberId: fc.constantFrom(...BARBERS.map((barber) => barber.id)),
        hour: fc.integer({ min: 9, max: 17 }),
        minute: fc.constantFrom(0, 15, 30, 45),
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
        // Exactly the variant's terms, else the barber's base — a long
        // seat at the short price is as wrong as another barber's price.
        const expected =
          (seat.variantId && offering.byVariant?.[seat.variantId]) ||
          offering.base;
        expect(written.terms.priceMinorUnits).toBe(expected.priceMinorUnits);
        expect(written.terms.durationMinutes).toBe(expected.durationMinutes);
      }),
    );
  });

  it('refuses a cancellation stamped after the visit began', () => {
    expect(() =>
      appointmentDocumentOf(
        {
          ...fixtureWith({ barberId: 'stefan', serviceId: 'svc-beard' }),
          dayOffset: -1,
          status: { kind: 'cancelled', reason: 'client_changed_plans' },
          seats: [
            {
              id: 'seat-guard',
              barberId: 'stefan',
              serviceId: 'svc-beard',
              hour: 14,
              minute: 0,
              subject: account('dev-client-3'),
              pref: 'specific',
              outcome: {
                kind: 'cancelled',
                by: 'client',
                reason: { kind: 'client_changed_plans' },
                at: { dayOffset: -1, hour: 14, minute: 10 },
              },
            },
          ],
        },
        calendar,
      ),
    ).toThrow('seed: appt-guard/seat-guard is cancelled after it started');
  });

  it('reads a barber’s window as the roster clamped to the shop’s hours', () => {
    // Стефан's Saturday roster starts 09:00; the Center opens at 10:00.
    expect(segmentsOn('stefan', 6)).toEqual([
      { startMinute: 600, endMinute: 900, locationId: 'loc-center' },
    ]);
    // Nobody works a closed shop, whatever a roster says.
    expect(BARBERS.flatMap((barber) => segmentsOn(barber.id, 0))).toEqual([]);
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
    const SATURDAY = 6;

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
