/**
 * The dev seed's CLIENT BOOK, assembled: who the clients are and what each
 * one's book holds are authored in `fixtures/book.fixtures.ts` (the client
 * list, one history plan per client, the visits written by hand — one
 * fixture per client-details state, design §12.4 P0 «Seed»); this module
 * places them on one shop calendar.
 *
 * The history is generated first (`history.mjs`), then the day visits are
 * placed around it: a day visit authored for a day its barbers do not work
 * there moves, never earlier, to their next bookable window
 * (`placeDayFixture`), so «today» on a Sunday run is honestly empty and on
 * the spec's pinned Friday Стоян's party of two moves to Saturday. Every
 * visit then settles only once its time has passed (`settledOnlyIfPast`)
 * and becomes its flat `Appointment` body (`appointmentDocumentOf`); every
 * account on a seat gets its `users` profile and its client record.
 */
import { AttendanceState } from '@core/primitives';
import {
  appointmentDocumentOf,
  settledOnlyIfPast,
  soldTerms,
} from './appointments.mjs';
import { createShopCalendar } from './calendar.mjs';
import { chairTerms } from './catalog.mjs';
import {
  CLIENTS,
  HISTORY_PLANS,
  contactOf,
  dayVisits,
  walkInVisit,
} from './fixtures/book.fixtures.ts';
import {
  customerIdOf,
  seededCustomerBody,
} from './fixtures/customers.fixtures.ts';
import { clientUserBody } from './fixtures/users.fixtures.ts';
import {
  createChairBook,
  historyForPlan,
  placeBlock,
  placeVisit,
  takeVisit,
} from './history.mjs';

/** What the seed registered a client with — the contact `users` and `customers` both copy. */
const seedContactOf = (client) => ({
  firstName: client.firstName,
  lastName: client.lastName,
  phone: client.phone,
  email: client.email,
});

/**
 * WHEN a client was born, as the fixture places it: a client born on the
 * shop's today (`birthdayTodayIn`, the birthday state) has today's month and
 * day in that year, `'YYYY-MM-DD'`; everyone else has no birth date.
 */
function birthDateOf(client, calendar) {
  if (client.birthdayTodayIn === null) return null;
  return `${client.birthdayTodayIn}-${calendar.today.slice(5)}`;
}

/** Where a visit's last seat frees the chair, three minutes on — when «Запиши пак» happens. */
function rebookedAtEndOf(visit) {
  const last = visit.seats[visit.seats.length - 1];
  const { minutes } = soldTerms(last);
  return {
    dayOffset: visit.dayOffset,
    minutes: last.startMinutes + minutes + 3,
  };
}

/** A client's newest worked visit in the generated history. */
function lastWorkedOf(history, uid) {
  const own = history.filter(({ seats: [booker] }) => {
    return (
      booker.attendanceState === AttendanceState.Worked &&
      booker.subjectUserId === uid
    );
  });
  const last = own[own.length - 1];
  if (!last) throw new Error(`seed: ${uid} has no worked history`);
  return last;
}

/**
 * Yesterday's walk-in (`walkInVisit`), placed through the chair book first,
 * so the generated history steps around it.
 */
function walkInFixture(calendar, book) {
  const minutes = chairTerms('svc-fade', 'ivan', null).durationMinutes;
  const placed = placeBlock(calendar, book, {
    barberId: 'ivan',
    plannedOffset: -1,
    preferredMinute: 11 * 60,
    minutes,
  });
  if (!placed) throw new Error('seed: no chair for the walk-in');
  book.take('ivan', placed.offset, placed.start, placed.start + minutes);
  return walkInVisit({
    dayOffset: placed.offset,
    startMinutes: placed.start,
    locationId: placed.locationId,
  });
}

/** How far ahead a day visit may move to find its barbers at work. */
const DAYS_AHEAD = 7;

/** A visit every seat of which was called off: it gave its chairs back. */
const isCalledOff = (visit) =>
  visit.seats.every(
    (seat) => seat.attendanceState === AttendanceState.Cancelled,
  );

/**
 * One authored day visit → the booking the shop could hold: its day or,
 * when a barber of it is off, closed by an exception, or at the other shop,
 * the first later day where they all work at ONE shop; its time or the
 * nearest one that fits every chair (15-minute steps). The party keeps its
 * shape — side by side stays side by side — and the arrival moves with it,
 * or goes: a visit moved to a later day has not been walked into.
 *
 * Takes its chairs in `book`, unless it was called off: a called-off visit
 * gave its chair back. Refuses a visit that fits no day of the week ahead.
 */
function placeDayFixture(visit, calendar, book) {
  const seats = visit.seats.map((seat) => ({
    barberId: seat.barberId,
    start: seat.startMinutes,
    end: seat.startMinutes + soldTerms(seat).minutes,
  }));
  const anchor = Math.min(...seats.map((seat) => seat.start));
  const blocks = [...new Set(seats.map((seat) => seat.barberId))]
    .map((barberId) => {
      const own = seats.filter((seat) => seat.barberId === barberId);
      return {
        barberId,
        from: Math.min(...own.map((seat) => seat.start)) - anchor,
        to: Math.max(...own.map((seat) => seat.end)) - anchor,
      };
    })
    .sort((a, b) => a.from - b.from);

  const placed = placeVisit(calendar, book, {
    offsets: Array.from(
      { length: DAYS_AHEAD },
      (_, ahead) => visit.dayOffset + ahead,
    ),
    preferredMinute: anchor,
    blocks,
  });
  if (!placed) {
    throw new Error(
      `seed: ${visit.id} fits no bookable window in the week from day ${visit.dayOffset}`,
    );
  }
  if (!isCalledOff(visit)) takeVisit(book, placed, blocks);

  const shift = placed.start - anchor;
  return {
    ...visit,
    dayOffset: placed.offset,
    locationId: placed.locationId,
    arrivedMinutes:
      visit.arrivedMinutes !== null && placed.offset === visit.dayOffset
        ? visit.arrivedMinutes + shift
        : null,
    seats: visit.seats.map((seat) => ({
      ...seat,
      startMinutes: seat.startMinutes + shift,
    })),
  };
}

/**
 * A seeded client's record (D29, `customers/{customerId}`): opened when the
 * shop first wrote them into the book — the earliest booking instant among
 * their visits, or the visit itself when nobody booked it ahead — so a
 * second run the same day writes the same bytes. A client with no visit is
 * opened at the start of the shop's today.
 */
function customerRecordOf(client, appointments, calendar) {
  const opened = appointments
    .filter(({ doc }) => doc.subjectUserIds.includes(client.uid))
    .map(({ doc }) => doc.bookedAtUtcMs ?? doc.utcEpochMs);
  return {
    uid: client.uid,
    id: customerIdOf(client.uid),
    body: seededCustomerBody(
      client.uid,
      seedContactOf(client),
      opened.length === 0 ? calendar.msAt(0, 0) : Math.min(...opened),
    ),
  };
}

/**
 * Everything the seed writes about clients, as of `nowMs`: their `users`
 * docs (the flat registered `User` body, `clientUserBody`), their client
 * records (`customers`, D29) and every appointment, past and coming, as the
 * flat `Appointment` body. Pure — the same `nowMs` day gives the same
 * documents.
 *
 * `subjects` are the accounts on a seat, `subjectCustomerIds` their client
 * records — whom `projectClientStats` recomputes. Also `fixtures`, the
 * visit intents those documents were built from (as placed and settled),
 * so a test can read what was authored — a seat's own minutes — beside what
 * was written; and `appointmentDays`, how many days from today on hold real
 * appointments, where the seed's fabricated `barberBusy` must start.
 */
export function buildClientBook(nowMs) {
  const calendar = createShopCalendar(nowMs);
  const book = createChairBook();
  const walkIn = walkInFixture(calendar, book);
  const history = HISTORY_PLANS.flatMap((plan) =>
    historyForPlan(plan, { contact: contactOf(plan.uid) }, calendar, book),
  );
  const georgiLast = lastWorkedOf(history, 'dev-client-1');
  const days = dayVisits({
    georgiRebooked: {
      fromAppointmentId: georgiLast.id,
      bookedOn: rebookedAtEndOf(georgiLast),
    },
    petarLastAppointmentId: lastWorkedOf(history, 'dev-client-3').id,
  }).map((visit) => placeDayFixture(visit, calendar, book));
  const fixtures = [walkIn, ...history, ...days].map((visit) =>
    settledOnlyIfPast(visit, calendar),
  );
  const appointments = fixtures.map((visit) =>
    appointmentDocumentOf(visit, calendar),
  );
  const subjects = [
    ...new Set(appointments.flatMap(({ doc }) => doc.subjectUserIds)),
  ].sort();
  const subjectCustomerIds = [
    ...new Set(appointments.flatMap(({ doc }) => doc.subjectCustomerIds)),
  ].sort();
  return {
    calendar,
    users: CLIENTS.map((client) => ({
      uid: client.uid,
      doc: clientUserBody(seedContactOf(client), birthDateOf(client, calendar)),
    })),
    customers: CLIENTS.map((client) =>
      customerRecordOf(client, appointments, calendar),
    ),
    appointments,
    subjects,
    subjectCustomerIds,
    fixtures,
    appointmentDays: 1 + Math.max(...days.map((visit) => visit.dayOffset)),
  };
}
