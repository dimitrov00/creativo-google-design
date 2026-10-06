/**
 * WHO the dev seed's clients are and WHAT their book holds — one named
 * fixture per client-details state (design §12.4 P0 «Seed», spine §12), so
 * every state the client page draws can be opened in preview:
 *
 * | Client | State |
 * |---|---|
 * | `dev-client-1` Георги Петров | the regular: 23 settled visits before today, 13 of them in the last 12 months, Ivan asked for by name; today's 10:00 cut, once its time passes, is his 24th |
 * | `dev-client-2` Мартин Илиев | birthday TODAY (`users.birthDate`); in the chair at 12:30; one visit the shop cancelled (Ivan off sick), which the cadence ignores |
 * | `dev-client-3` Петър Димитров | asks for Стефан by name — today a beard with him at 14:00; tomorrow he brings his son into the next chair, a party with a companion who has an account |
 * | `dev-client-10` Иво Димитров | that companion: a history found only through `subjectUserIds`, never as an owner |
 * | `dev-client-5` Кирил Тодоров | exactly 3 no-shows in the last 60 days — the pause-suggestion threshold — before today; today's 11:00 no-show, once its time passes, is the 4th |
 * | `dev-client-6` Николай Иванов | a LATE cancel (his own, 3 h before, inside the 24 h window), an in-window one, and tomorrow's in-window cancel |
 * | `dev-client-9` Даниел Маринов | a first visit: a new profile, no history, one booking later today |
 * | `dev-client-11` Константин-Александър … | the long name and the long e-mail |
 * | guests | a staff-booked guest with a typed phone later today; yesterday's walk-in with one |
 *
 * The day and time in this table are each day fixture's INTENT. A run on a
 * day its barbers do not work there moves it, never earlier, to their next
 * bookable window (`placeDayFixture`): the shop is closed on Sundays, Стефан
 * is off on Wednesdays and Нико on Mondays, Ivan sits at Младост on Fridays,
 * and Saturday closes early. So «today» on a Sunday run is honestly empty,
 * and on the spec's pinned Friday Стоян's party of two moves to Saturday.
 *
 * Every account on a seat has a `users` doc — `dev-client-5/6/8` owned
 * bookings for months without one. Placement is a mix of `self` and `staff`,
 * and rebooked visits carry `bookedFromAppointmentId`.
 */
import {
  account,
  appointmentDocumentOf,
  guest,
  settledOnlyIfPast,
  soldTerms,
} from './appointments.mjs';
import { createShopCalendar } from './calendar.mjs';
import { chairTerms } from './catalog.mjs';
import {
  cadence,
  createChairBook,
  historyForPlan,
  placeBlock,
  placeVisit,
  takeVisit,
} from './history.mjs';

export const CLIENTS = [
  {
    uid: 'dev-client-1',
    firstName: 'Георги',
    lastName: 'Петров',
    phone: '+359881234567',
    email: 'georgi@test.local',
  },
  {
    uid: 'dev-client-2',
    firstName: 'Мартин',
    lastName: 'Илиев',
    phone: '+359887654321',
    email: 'martin@test.local',
    // A leap year, so a 29 February run still writes a real date.
    birthdayTodayIn: 1992,
  },
  {
    uid: 'dev-client-3',
    firstName: 'Петър',
    lastName: 'Димитров',
    phone: '+359882223344',
    email: 'petar@test.local',
  },
  {
    uid: 'dev-client-4',
    firstName: 'Стоян',
    lastName: 'Колев',
    phone: '+359881112233',
    email: null,
  },
  {
    uid: 'dev-client-5',
    firstName: 'Кирил',
    lastName: 'Тодоров',
    phone: '+359884445566',
    email: 'kiril@test.local',
  },
  {
    uid: 'dev-client-6',
    firstName: 'Николай',
    lastName: 'Иванов',
    phone: '+359883334455',
    email: null,
  },
  {
    uid: 'dev-client-7',
    firstName: 'Александър',
    lastName: 'Стоянов',
    phone: '+359887778899',
    email: null,
  },
  {
    uid: 'dev-client-8',
    firstName: 'Емил',
    lastName: 'Георгиев',
    phone: '+359886665544',
    email: 'emil@test.local',
  },
  {
    uid: 'dev-client-9',
    firstName: 'Даниел',
    lastName: 'Маринов',
    phone: '+359885009988',
    email: 'daniel@test.local',
  },
  {
    uid: 'dev-client-10',
    firstName: 'Иво',
    lastName: 'Димитров',
    phone: '+359889001122',
    email: null,
  },
  {
    uid: 'dev-client-11',
    firstName: 'Константин-Александър',
    lastName: 'Попхристодулов-Карагеоргиев',
    phone: '+359886112233',
    email: 'konstantin.pophristodulov-karageorgiev@test.local',
  },
];

const clientOf = (uid) => {
  const client = CLIENTS.find((entry) => entry.uid === uid);
  if (!client) throw new Error(`seed: no client ${uid}`);
  return client;
};

/** The booking's contact snapshot, as the booking flow copies it from the profile. */
export const contactOf = (uid, note = null) => {
  const client = clientOf(uid);
  return {
    name: `${client.firstName} ${client.lastName}`,
    phone: client.phone,
    email: client.email,
    note,
  };
};

/**
 * The same prefixes `FirestoreProfileAdapter` / the functions' user repository
 * write: every prefix of every name token, phone digits (E.164 without the
 * plus, and the national `0…` form) and the email from the 3rd character.
 * Kept in lockstep by hand — neither exports its helper.
 */
export function searchFields(firstName, lastName, phone, email) {
  const searchName = `${firstName} ${lastName}`.trim().toLowerCase();
  const out = new Set();
  const prefixes = (token, from = 1) => {
    for (let i = from; i <= token.length; i += 1) out.add(token.slice(0, i));
  };
  for (const token of searchName.split(/\s+/).filter(Boolean)) prefixes(token);
  const digits = phone.replace(/\D/g, '');
  prefixes(digits, 3);
  if (digits.startsWith('359')) prefixes('0' + digits.slice(3), 3);
  if (email) {
    const lower = email.toLowerCase();
    prefixes(lower, 3);
    prefixes(lower.split('@')[0], 3);
  }
  return { searchName, searchPrefixes: [...out] };
}

/** `users/{uid}` as registration writes it. */
export function userDocumentOf(client, calendar) {
  const { today } = calendar;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    phone: client.phone,
    firstName: client.firstName,
    lastName: client.lastName,
    roles: ['client'],
    status: { kind: 'active' },
    email: client.email,
    birthDate: client.birthdayTodayIn
      ? `${client.birthdayTodayIn}-${pad(today.month)}-${pad(today.day)}`
      : null,
    ...searchFields(
      client.firstName,
      client.lastName,
      client.phone,
      client.email,
    ),
  };
}

const WORKED = { kind: 'worked' };
const item = (serviceId, variantId = null) => ({ serviceId, variantId });
const FADE = item('svc-fade');
const BEARD = item('svc-beard');
const CLASSIC_SHORT = item('svc-classic-cut', 'short');
const CLASSIC_LONG = item('svc-classic-cut', 'long');
const MODERN = item('svc-modern-cut');
const SCISSOR_LONG = item('svc-scissor-trim', 'long');
const FINISH = item('svc-finish');

/** A worked visit at each offset (newest first, as `cadence` returns them). */
const worked = (offsets) =>
  offsets.map((offset) => ({ offset, outcome: WORKED }));

/**
 * Eighteen months of the book, one plan per client. A plan's `visits` draws
 * its day offsets from the client's own PRNG; everything else — chair, hour,
 * price, provenance, tips — is `historyForPlan`'s.
 */
export const HISTORY_PLANS = [
  {
    uid: 'dev-client-1',
    idPrefix: 'appt-hist-c1',
    barbers: ['ivan'],
    pref: 'specific',
    hour: 10,
    menus: [[FADE], [FADE], [FADE], [FADE, BEARD]],
    tipRate: 0.45,
    selfRate: 0.3,
    // 13 visits inside the last year, 10 before it. The newest stays ≥ 21
    // days back and the 13th ≤ 363, the 14th ≥ 366, so a ±3-day slide onto
    // a worked shift never moves one across the 12-month line.
    visits: (rng) => {
      const recent = cadence(rng, { from: -24, count: 13, gap: [26, 28] });
      const older = cadence(rng, {
        from: Math.min(recent[recent.length - 1] - 21, -369),
        count: 10,
        gap: [21, 24],
      });
      return worked([...recent, ...older]);
    },
  },
  {
    uid: 'dev-client-2',
    idPrefix: 'appt-hist-c2',
    barbers: ['ivan', 'niko'],
    pref: 'any',
    hour: 12,
    minute: 30,
    menus: [[CLASSIC_SHORT]],
    tipRate: 0.3,
    selfRate: 0.8,
    visits: (rng) => {
      const offsets = cadence(rng, { from: -38, count: 13, gap: [35, 42] });
      return [
        ...worked(offsets),
        // Ivan off sick: the shop called it off the evening before. A gap
        // the SHOP stretched says nothing about his rhythm (R34).
        {
          offset: offsets[3] + 12,
          outcome: {
            kind: 'cancelled',
            by: 'staff',
            reason: 'staff_barber_absence',
            hoursBefore: 16,
          },
        },
      ];
    },
  },
  {
    uid: 'dev-client-3',
    idPrefix: 'appt-hist-c3',
    barbers: ['stefan', 'ivan'],
    pref: 'specific',
    hour: 14,
    menus: [[BEARD], [CLASSIC_LONG], [CLASSIC_LONG, BEARD]],
    tipRate: 0.25,
    selfRate: 0.7,
    // His son Иво comes along on his own account — every time but once, so
    // the boy keeps his father's three-to-six-week rhythm.
    visits: (rng) =>
      cadence(rng, { from: -30, count: 14, gap: [28, 38] }).map(
        (offset, index) => ({
          offset,
          outcome: WORKED,
          companions: index === 1 ? [] : [{ userId: 'dev-client-10', ...FADE }],
        }),
      ),
  },
  {
    uid: 'dev-client-4',
    idPrefix: 'appt-hist-c4',
    barbers: ['ivan'],
    pref: 'specific',
    hour: 16,
    menus: [[FADE]],
    tipRate: 0.2,
    selfRate: 0.6,
    // His son rides along as a GUEST seat — no account, no history of his own.
    visits: (rng) =>
      cadence(rng, { from: -40, count: 10, gap: [35, 42] }).map(
        (offset, index) => ({
          offset,
          outcome: WORKED,
          companions:
            index % 3 === 0
              ? [{ label: 'Синът на Стоян', ...CLASSIC_LONG }]
              : [],
        }),
      ),
  },
  {
    uid: 'dev-client-5',
    idPrefix: 'appt-hist-c5',
    barbers: ['stefan'],
    pref: 'specific',
    hour: 11,
    menus: [[BEARD]],
    tipRate: 0.1,
    selfRate: 0.9,
    // Three no-shows inside 60 days (R47's threshold), then an older run of
    // worked visits with one more no-show far outside every window.
    visits: (rng) => [
      ...[-9, -26, -47].map((offset) => ({
        offset,
        outcome: { kind: 'no_show' },
      })),
      ...cadence(rng, { from: -70, count: 7, gap: [21, 35] }).map(
        (offset, index) => ({
          offset,
          outcome: index === 3 ? { kind: 'no_show' } : WORKED,
        }),
      ),
    ],
  },
  {
    uid: 'dev-client-6',
    idPrefix: 'appt-hist-c6',
    barbers: ['ivan', 'niko'],
    pref: 'any',
    hour: 17,
    menus: [[FADE]],
    tipRate: 0.3,
    selfRate: 0.85,
    // Tighter gaps than the rest: two of the eight are cancellations of his
    // own, which do not break a rhythm, so the worked visits still average
    // three to six weeks apart.
    visits: (rng) =>
      cadence(rng, { from: -12, count: 8, gap: [21, 28] }).map(
        (offset, index) => {
          // A LATE cancel: his own, three hours out, inside the 24 h window.
          if (index === 2) {
            return {
              offset,
              outcome: {
                kind: 'cancelled',
                by: 'client',
                reason: 'client_changed_plans',
                hoursBefore: 3,
              },
            };
          }
          // An in-window one, two days out, with nothing typed.
          if (index === 5) {
            return {
              offset,
              outcome: {
                kind: 'cancelled',
                by: 'client',
                reason: 'unspecified',
                hoursBefore: 50,
              },
            };
          }
          return { offset, outcome: WORKED };
        },
      ),
  },
  {
    uid: 'dev-client-7',
    idPrefix: 'appt-hist-c7',
    barbers: ['niko'],
    pref: 'specific',
    hour: 15,
    menus: [[MODERN], [MODERN], [FADE]],
    tipRate: 0.3,
    selfRate: 0.5,
    visits: (rng) =>
      worked(cadence(rng, { from: -35, count: 8, gap: [35, 42] })),
  },
  {
    uid: 'dev-client-8',
    idPrefix: 'appt-hist-c8',
    barbers: ['stefan', 'ivan'],
    pref: 'any',
    hour: 13,
    menus: [[SCISSOR_LONG]],
    tipRate: 0.2,
    selfRate: 0.7,
    visits: (rng) =>
      worked(cadence(rng, { from: -45, count: 4, gap: [30, 42] })),
  },
  {
    uid: 'dev-client-11',
    idPrefix: 'appt-hist-c11',
    barbers: ['niko', 'stefan'],
    pref: 'any',
    hour: 11,
    minute: 30,
    menus: [[CLASSIC_LONG], [CLASSIC_LONG], [FINISH]],
    tipRate: 0.3,
    selfRate: 0.6,
    visits: (rng) =>
      worked(cadence(rng, { from: -20, count: 5, gap: [21, 42] })),
  },
];

/** Where a fixture's last seat frees the chair, three minutes on — when «Запиши пак» happens. */
function rebookedAtEndOf(fixture) {
  const last = fixture.seats[fixture.seats.length - 1];
  const { minutes } = soldTerms(last);
  return {
    dayOffset: fixture.dayOffset,
    hour: last.hour,
    minute: last.minute + minutes + 3,
  };
}

/** A client's newest worked visit in the generated history. */
function lastWorkedOf(history, uid) {
  const own = history.filter(
    (fixture) =>
      fixture.status.kind === 'completed' &&
      fixture.seats[0].subject.kind === 'account' &&
      fixture.seats[0].subject.userId === uid,
  );
  const last = own[own.length - 1];
  if (!last) throw new Error(`seed: ${uid} has no worked history`);
  return last;
}

/**
 * Yesterday's walk-in: no account, the name staff typed, and the phone they
 * typed with it on the seat (R43). Placed through the chair book first, so
 * the generated history steps around it.
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
  const hour = Math.floor(placed.start / 60);
  const minute = placed.start % 60;
  return {
    id: 'appt-dev-walkin',
    dayOffset: placed.offset,
    locationId: placed.locationId,
    status: { kind: 'completed' },
    placement: 'staff',
    // Entered at the desk as he sat down.
    bookedAt: { dayOffset: placed.offset, hour, minute: minute - 2 },
    arrivedAt: { hour, minute: minute - 2 },
    contact: null,
    seats: [
      {
        id: 'seat-walkin',
        barberId: 'ivan',
        serviceId: 'svc-fade',
        hour,
        minute,
        subject: guest('Пламен (на място)', '+359885553344'),
        pref: 'any',
        outcome: WORKED,
        tipMinorUnits: 200,
      },
    ],
  };
}

/**
 * Today and the next two days, hand-authored: a settled cut, one in
 * progress (arrived), several still to come, a mixed party across two
 * chairs, a companion party, a no-show and a cancellation — because a
 * fixture that only produces the happy path proves only the happy path.
 *
 * Authored as INTENTS — who, with whom, which day, which time — and placed
 * by `placeDayFixture` into a booking the shop could hold: each seat a
 * service its barber sells (`chairTerms` refuses anything else and stops the
 * seed), inside that barber's bookable window at the appointment's one shop,
 * with no two visits sharing a chair or crowding its turnaround.
 *
 * A self-placed visit could only have been sold inside the window. A
 * staff-placed one could be overtime (owner ruling: staff placement is
 * unbounded, `OccupancyBlock.outsideWindow`), but no fixture here exercises
 * that; one that does must say so and be let through the spec's roster
 * sweep by name.
 */
function dayFixtures(history) {
  const georgiLast = lastWorkedOf(history, 'dev-client-1');
  const petarLast = lastWorkedOf(history, 'dev-client-3');
  const weekBefore = (dayOffset) => ({
    dayOffset: dayOffset - 7,
    hour: 12,
    minute: 0,
  });
  return [
    {
      id: 'appt-dev-1',
      dayOffset: 0,
      status: { kind: 'completed' },
      // Rebooked at the chair as his last visit ended.
      placement: 'staff',
      bookedAt: rebookedAtEndOf(georgiLast),
      bookedFromAppointmentId: georgiLast.id,
      arrivedAt: { hour: 9, minute: 56 },
      contact: contactOf('dev-client-1'),
      seats: [
        {
          id: 'seat-1',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          hour: 10,
          minute: 0,
          minutes: 45,
          subject: account('dev-client-1'),
          pref: 'specific',
          outcome: WORKED,
          tipMinorUnits: 200,
        },
      ],
    },
    {
      id: 'appt-dev-2',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: weekBefore(0),
      // Already in the chair: the NOW treatment and the "Done" verb both need
      // an arrival to be reachable at all.
      arrivedAt: { hour: 12, minute: 25 },
      contact: contactOf('dev-client-2', 'Къса отстрани'),
      seats: [
        {
          id: 'seat-2',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          hour: 12,
          minute: 30,
          minutes: 30,
          subject: account('dev-client-2'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // Петър, still to come: a beard at his habitual 14:00 with Стефан, the
      // barber every visit of his history names. It sat on Нико, who does
      // not sell beards, priced at Стефан's terms by a fallback that is gone.
      id: 'appt-dev-3',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: weekBefore(0),
      contact: contactOf('dev-client-3'),
      seats: [
        {
          id: 'seat-3',
          barberId: 'stefan',
          serviceId: 'svc-beard',
          hour: 14,
          minute: 0,
          minutes: 30,
          subject: account('dev-client-3'),
          pref: 'specific',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // A MIXED PARTY across two chairs — one appointment, two seats, two
      // lanes. The cross-lane tie and the per-seat resolution both need it.
      id: 'appt-dev-4',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: weekBefore(0),
      contact: contactOf('dev-client-4'),
      seats: [
        {
          id: 'seat-4a',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          hour: 16,
          minute: 0,
          minutes: 45,
          subject: account('dev-client-4'),
          pref: 'specific',
          outcome: { kind: 'scheduled' },
        },
        {
          id: 'seat-4b',
          barberId: 'stefan',
          serviceId: 'svc-classic-cut',
          variantId: 'long',
          hour: 16,
          minute: 0,
          minutes: 30,
          subject: guest('Синът на Стоян'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      id: 'appt-dev-5',
      dayOffset: 0,
      status: { kind: 'no_show' },
      placement: 'self',
      bookedAt: weekBefore(0),
      contact: contactOf('dev-client-5'),
      seats: [
        {
          id: 'seat-5',
          barberId: 'stefan',
          serviceId: 'svc-beard',
          hour: 11,
          minute: 0,
          minutes: 30,
          subject: account('dev-client-5'),
          pref: 'specific',
          outcome: { kind: 'no_show' },
        },
      ],
    },
    {
      // A first visit: a profile made this week and nothing else — the
      // «Нов клиент» state, one booking and no history.
      id: 'appt-dev-9',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: { dayOffset: -2, hour: 21, minute: 10 },
      contact: contactOf('dev-client-9'),
      seats: [
        {
          id: 'seat-9',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          hour: 17,
          minute: 15,
          subject: account('dev-client-9'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // The long name on today's lane: the head wraps, the bar truncates.
      // At 15:00, past Петър's 14:00–14:30 and Стефан's 15-minute reset —
      // the desk could not have booked him into 14:30.
      id: 'appt-dev-10',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'staff',
      bookedAt: { dayOffset: -4, hour: 11, minute: 0 },
      contact: contactOf('dev-client-11'),
      seats: [
        {
          id: 'seat-10',
          barberId: 'stefan',
          serviceId: 'svc-classic-cut',
          variantId: 'long',
          hour: 15,
          minute: 0,
          subject: account('dev-client-11'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // A guest the desk booked by phone yesterday: a name, no account, and
      // the number typed with it on the seat (R43) — «Гост · без профил»
      // with a way to call.
      id: 'appt-dev-guest',
      dayOffset: 0,
      status: { kind: 'confirmed' },
      placement: 'staff',
      bookedAt: { dayOffset: -1, hour: 17, minute: 40 },
      contact: null,
      seats: [
        {
          id: 'seat-guest',
          barberId: 'niko',
          serviceId: 'svc-fade',
          hour: 18,
          minute: 0,
          subject: guest('Борис', '+359885551122'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      id: 'appt-dev-6',
      dayOffset: 1,
      status: { kind: 'cancelled', reason: 'client_changed_plans' },
      placement: 'self',
      bookedAt: weekBefore(1),
      contact: contactOf('dev-client-6'),
      seats: [
        {
          id: 'seat-6',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          hour: 10,
          minute: 0,
          minutes: 45,
          subject: account('dev-client-6'),
          pref: 'any',
          // Called off last night, well over a day ahead of any slot it is
          // placed in — outside the 24 h window, so not a late cancel.
          outcome: {
            kind: 'cancelled',
            by: 'client',
            reason: { kind: 'client_changed_plans' },
            at: { dayOffset: -1, hour: 19, minute: 40 },
          },
        },
      ],
    },
    {
      id: 'appt-dev-7',
      dayOffset: 1,
      status: { kind: 'confirmed' },
      placement: 'staff',
      bookedAt: weekBefore(1),
      contact: contactOf('dev-client-7'),
      seats: [
        {
          id: 'seat-7',
          barberId: 'niko',
          serviceId: 'svc-modern-cut',
          hour: 15,
          minute: 0,
          minutes: 45,
          subject: account('dev-client-7'),
          pref: 'specific',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // A PARTY WITH A COMPANION WHO HAS AN ACCOUNT: Петър books, his son
      // sits in the next chair on his own profile. Booked with «Запиши пак»
      // from Петър's last visit.
      id: 'appt-dev-party',
      dayOffset: 1,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: { dayOffset: -3, hour: 20, minute: 15 },
      bookedFromAppointmentId: petarLast.id,
      contact: contactOf('dev-client-3'),
      seats: [
        {
          id: 'seat-party-a',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          hour: 11,
          minute: 0,
          subject: account('dev-client-3'),
          pref: 'specific',
          outcome: { kind: 'scheduled' },
        },
        {
          id: 'seat-party-b',
          barberId: 'niko',
          serviceId: 'svc-fade',
          hour: 11,
          minute: 0,
          subject: account('dev-client-10', 'companion'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
    {
      // Before Стефан's lunch: it sat at 13:00, inside the break, where the
      // booking flow could never have sold it.
      id: 'appt-dev-8',
      dayOffset: 2,
      status: { kind: 'confirmed' },
      placement: 'self',
      bookedAt: weekBefore(2),
      contact: contactOf('dev-client-8'),
      seats: [
        {
          id: 'seat-8',
          barberId: 'stefan',
          serviceId: 'svc-scissor-trim',
          variantId: 'long',
          hour: 12,
          minute: 30,
          minutes: 30,
          subject: account('dev-client-8'),
          pref: 'any',
          outcome: { kind: 'scheduled' },
        },
      ],
    },
  ];
}

/** How far ahead a day fixture may move to find its barbers at work. */
const DAYS_AHEAD = 7;

const clockAt = (totalMinutes) => ({
  hour: Math.floor(totalMinutes / 60),
  minute: ((totalMinutes % 60) + 60) % 60,
});

/**
 * One authored day fixture → the booking the shop could hold: its day or,
 * when a barber of it is off, closed by an exception, or at the other shop,
 * the first later day where they all work at ONE shop; its time or the
 * nearest one that fits every chair (15-minute steps). The party keeps its
 * shape — side by side stays side by side — and the arrival moves with it,
 * or goes: a visit moved to a later day has not been walked into.
 *
 * Takes its chairs in `book`, unless it was cancelled: a called-off visit
 * gave its chair back. Refuses a fixture that fits no day of the week ahead.
 */
function placeDayFixture(fixture, calendar, book) {
  const seats = fixture.seats.map((seat) => {
    const start = seat.hour * 60 + seat.minute;
    return {
      barberId: seat.barberId,
      start,
      end: start + soldTerms(seat).minutes,
    };
  });
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
      (_, ahead) => fixture.dayOffset + ahead,
    ),
    preferredMinute: anchor,
    blocks,
  });
  if (!placed) {
    throw new Error(
      `seed: ${fixture.id} fits no bookable window in the week from day ${fixture.dayOffset}`,
    );
  }
  if (fixture.status.kind !== 'cancelled') takeVisit(book, placed, blocks);

  const shift = placed.start - anchor;
  const moved = (at) => clockAt(at.hour * 60 + at.minute + shift);
  return {
    ...fixture,
    dayOffset: placed.offset,
    locationId: placed.locationId,
    arrivedAt:
      fixture.arrivedAt && placed.offset === fixture.dayOffset
        ? moved(fixture.arrivedAt)
        : null,
    seats: fixture.seats.map((seat) => ({ ...seat, ...moved(seat) })),
  };
}

/**
 * Everything the seed writes about clients, as of `nowMs`: their `users`
 * docs and every appointment, past and coming, in `appointmentToDocument`'s
 * shape. Pure — the same `nowMs` day gives the same documents.
 *
 * Also `fixtures`, the symbolic fixtures those documents were built from (as
 * placed and settled), so a test can read what was authored — a seat's own
 * minutes — beside what was written; and `appointmentDays`, how many days
 * from today on hold real appointments, where the seed's fabricated
 * `barberBusy` must start.
 */
export function buildClientBook(nowMs) {
  const calendar = createShopCalendar(nowMs);
  const book = createChairBook();
  const walkIn = walkInFixture(calendar, book);
  const history = HISTORY_PLANS.flatMap((plan) =>
    historyForPlan(plan, { contact: contactOf(plan.uid) }, calendar, book),
  );
  const days = dayFixtures(history).map((fixture) =>
    placeDayFixture(fixture, calendar, book),
  );
  const fixtures = [walkIn, ...history, ...days].map((fixture) =>
    settledOnlyIfPast(fixture, calendar),
  );
  const appointments = fixtures.map((fixture) =>
    appointmentDocumentOf(fixture, calendar),
  );
  const subjects = [
    ...new Set(appointments.flatMap(({ doc }) => doc.subjectUserIds)),
  ].sort();
  return {
    calendar,
    users: CLIENTS.map((client) => ({
      uid: client.uid,
      doc: userDocumentOf(client, calendar),
    })),
    appointments,
    subjects,
    fixtures,
    appointmentDays: 1 + Math.max(...days.map((fixture) => fixture.dayOffset)),
  };
}
