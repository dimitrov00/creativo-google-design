/**
 * THE DEV SEED'S CLIENT BOOK, AS AUTHORED: who the clients are, what each
 * one's eighteen months look like (the history plans `tools/seed/history.mjs`
 * generates from), and the visits written by hand — today and the next two
 * days, and yesterday's walk-in. Every visit is a {@link VisitIntent} in the
 * entity's own vocabulary (`appointments.fixtures.ts`): the seats' stored
 * fields, each occupant its `SeatOccupant` slice, each outcome its
 * `attendanceState`, the tags from the ecs-core dictionaries. One fixture
 * per client-details state (design §12.4 P0 «Seed», spine §12):
 *
 * | Client | State |
 * |---|---|
 * | `dev-client-1` Георги Петров | the regular: 23 settled visits before today, 13 of them in the last 12 months, Ivan asked for by name; today's 10:00 cut, once its time passes, is his 24th |
 * | `dev-client-2` Мартин Илиев | birthday TODAY (`users.birthDate`); in the chair at 12:30; one visit the shop cancelled (Ivan off sick), which the cadence ignores |
 * | `dev-client-3` Петър Димитров | asks for Стефан by name — today a beard with him at 14:00; tomorrow he brings his son into the next chair, a party with a companion who has an account |
 * | `dev-client-10` Иво Димитров | that companion: a history found only through `subjectCustomerIds`, never as an owner |
 * | `dev-client-5` Кирил Тодоров | exactly 3 no-shows in the last 60 days — the pause-suggestion threshold — before today; today's 11:00 no-show, once its time passes, is the 4th |
 * | `dev-client-6` Николай Иванов | a LATE cancel (his own, 3 h before, inside the 24 h window), an in-window one, and tomorrow's in-window cancel |
 * | `dev-client-9` Даниел Маринов | a first visit: a new profile, no history, one booking later today |
 * | `dev-client-11` Константин-Александър … | the long name and the long e-mail |
 * | guests | a staff-booked guest with a typed phone later today; yesterday's walk-in with one |
 *
 * The day and time in this table are each day visit's INTENT. A run on a
 * day its barbers do not work there moves it, never earlier, to their next
 * bookable window (`placeDayFixture`, `tools/seed/fixtures.mjs`): the shop
 * is closed on Sundays, Стефан is off on Wednesdays and Нико on Mondays,
 * Ivan sits at Младост on Fridays, and Saturday closes early. So «today» on
 * a Sunday run is honestly empty, and on the spec's pinned Friday Стоян's
 * party of two moves to Saturday.
 *
 * Every account on a seat has a `users` doc — `dev-client-5/6/8` owned
 * bookings for months without one. Placement is a mix of `SELF` and
 * `STAFF`, and rebooked visits carry `bookedFromAppointmentId`.
 */
import {
  BarberPreference,
  CancellationReason,
  CancelledBy,
  Placement,
  type SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import { defect } from '@core/primitives';
import {
  accountSeat,
  calledOffAt,
  calledOffBefore,
  guestSeat,
  NO_SHOW_SEAT,
  SCHEDULED_SEAT,
  type SeatOutcomeIntent,
  type ShopMoment,
  type VisitContact,
  type VisitIntent,
  WORKED_SEAT,
} from './appointments.fixtures';
import type { SeedClientContact } from './customers.fixtures';

// ── The clients ────────────────────────────────────────────────────────────

/** A seeded client: the contact they registered with, and the birthday state's year. */
export type SeedClient = SeedClientContact & {
  readonly uid: string;
  /** Born on the shop's today in this year (the birthday state), or `null`. */
  readonly birthdayTodayIn: number | null;
};

export const CLIENTS: readonly SeedClient[] = [
  {
    uid: 'dev-client-1',
    firstName: 'Георги',
    lastName: 'Петров',
    phone: '+359881234567',
    email: 'georgi@test.local',
    birthdayTodayIn: null,
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
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-4',
    firstName: 'Стоян',
    lastName: 'Колев',
    phone: '+359881112233',
    email: null,
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-5',
    firstName: 'Кирил',
    lastName: 'Тодоров',
    phone: '+359884445566',
    email: 'kiril@test.local',
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-6',
    firstName: 'Николай',
    lastName: 'Иванов',
    phone: '+359883334455',
    email: null,
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-7',
    firstName: 'Александър',
    lastName: 'Стоянов',
    phone: '+359887778899',
    email: null,
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-8',
    firstName: 'Емил',
    lastName: 'Георгиев',
    phone: '+359886665544',
    email: 'emil@test.local',
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-9',
    firstName: 'Даниел',
    lastName: 'Маринов',
    phone: '+359885009988',
    email: 'daniel@test.local',
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-10',
    firstName: 'Иво',
    lastName: 'Димитров',
    phone: '+359889001122',
    email: null,
    birthdayTodayIn: null,
  },
  {
    uid: 'dev-client-11',
    firstName: 'Константин-Александър',
    lastName: 'Попхристодулов-Карагеоргиев',
    phone: '+359886112233',
    email: 'konstantin.pophristodulov-karageorgiev@test.local',
    birthdayTodayIn: null,
  },
];

/** A seeded client by uid — an unknown one is a broken fixture. */
function clientOf(uid: string): SeedClient {
  return (
    CLIENTS.find((entry) => entry.uid === uid) ??
    defect(`seed fixture: no client ${uid}`)
  );
}

/** The booking's contact snapshot, as the booking flow copies it from the profile. */
export function contactOf(
  uid: string,
  note: string | null = null,
): VisitContact {
  const client = clientOf(uid);
  return {
    name: `${client.firstName} ${client.lastName}`,
    phone: client.phone,
    email: client.email,
    note,
  };
}

// ── The history plans ──────────────────────────────────────────────────────

/** A service a seat can hold: the service, and the variant it is sold per. */
export type MenuItem = {
  readonly serviceId: string;
  readonly variantId: string | null;
};

/** Someone who rides along on the client's visit: what they have, and who they are. */
export type Companion = MenuItem & SeatOccupant;

/** One visit of a client's rhythm: its day offset, what became of it, who came along. */
export type HistoryVisit = {
  readonly offset: number;
  /** The visit's fate — every seat of it shares it, companions included. */
  readonly outcome: SeatOutcomeIntent;
  readonly companions: readonly Companion[];
};

/**
 * `count` day offsets walking BACK from `from`, each gap drawn from
 * `[minGap, maxGap]` days — a client's rhythm, oldest last. Handed to a
 * plan by the generator, drawn from the client's own PRNG.
 */
export type Cadence = (rhythm: {
  readonly from: number;
  readonly count: number;
  readonly gap: readonly [number, number];
}) => readonly number[];

/**
 * Eighteen months of one client's book. `visits` draws its day offsets
 * from the client's own rhythm; everything else — chair, hour, price,
 * provenance, tips — is `historyForPlan`'s.
 */
export type HistoryPlan = {
  readonly uid: string;
  readonly idPrefix: string;
  readonly barbers: readonly string[];
  readonly barberPreference: BarberPreference;
  /** The client's habitual start, minutes past midnight. */
  readonly habitualStartMinutes: number;
  readonly menus: readonly (readonly MenuItem[])[];
  readonly tipRate: number;
  readonly selfRate: number;
  readonly visits: (cadence: Cadence) => readonly HistoryVisit[];
};

const item = (
  serviceId: string,
  variantId: string | null = null,
): MenuItem => ({
  serviceId,
  variantId,
});
const FADE = item('svc-fade');
const BEARD = item('svc-beard');
const CLASSIC_SHORT = item('svc-classic-cut', 'short');
const CLASSIC_LONG = item('svc-classic-cut', 'long');
const MODERN = item('svc-modern-cut');
const SCISSOR_LONG = item('svc-scissor-trim', 'long');
const FINISH = item('svc-finish');

/** A visit of the client alone. */
const alone = (offset: number, outcome: SeatOutcomeIntent): HistoryVisit => ({
  offset,
  outcome,
  companions: [],
});

/** A worked visit at each offset (newest first, as a cadence returns them). */
const worked = (offsets: readonly number[]): readonly HistoryVisit[] =>
  offsets.map((offset) => alone(offset, WORKED_SEAT));

/** The `index`-th offset of a rhythm — a rhythm shorter than that is a broken plan. */
const nth = (offsets: readonly number[], index: number): number =>
  offsets.at(index) ?? defect(`seed fixture: a rhythm without visit ${index}`);

export const HISTORY_PLANS: readonly HistoryPlan[] = [
  {
    uid: 'dev-client-1',
    idPrefix: 'appt-hist-c1',
    barbers: ['ivan'],
    barberPreference: BarberPreference.Specific,
    habitualStartMinutes: 10 * 60,
    menus: [[FADE], [FADE], [FADE], [FADE, BEARD]],
    tipRate: 0.45,
    selfRate: 0.3,
    // 13 visits inside the last year, 10 before it. The newest stays ≥ 21
    // days back and the 13th ≤ 363, the 14th ≥ 366, so a ±3-day slide onto
    // a worked shift never moves one across the 12-month line.
    visits: (cadence) => {
      const recent = cadence({ from: -24, count: 13, gap: [26, 28] });
      const older = cadence({
        from: Math.min(nth(recent, -1) - 21, -369),
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
    barberPreference: BarberPreference.Any,
    habitualStartMinutes: 12 * 60 + 30,
    menus: [[CLASSIC_SHORT]],
    tipRate: 0.3,
    selfRate: 0.8,
    visits: (cadence) => {
      const offsets = cadence({ from: -38, count: 13, gap: [35, 42] });
      return [
        ...worked(offsets),
        // Ivan off sick: the shop called it off the evening before. A gap
        // the SHOP stretched says nothing about his rhythm (R34).
        alone(
          nth(offsets, 3) + 12,
          calledOffBefore(
            CancelledBy.Staff,
            CancellationReason.StaffBarberAbsence,
            16,
          ),
        ),
      ];
    },
  },
  {
    uid: 'dev-client-3',
    idPrefix: 'appt-hist-c3',
    barbers: ['stefan', 'ivan'],
    barberPreference: BarberPreference.Specific,
    habitualStartMinutes: 14 * 60,
    menus: [[BEARD], [CLASSIC_LONG], [CLASSIC_LONG, BEARD]],
    tipRate: 0.25,
    selfRate: 0.7,
    // His son Иво comes along on his own account — every time but once, so
    // the boy keeps his father's three-to-six-week rhythm.
    visits: (cadence) =>
      cadence({ from: -30, count: 14, gap: [28, 38] }).map((offset, index) => ({
        offset,
        outcome: WORKED_SEAT,
        companions:
          index === 1
            ? []
            : [
                {
                  ...FADE,
                  ...accountSeat(
                    'dev-client-10',
                    SubjectRelationship.Companion,
                  ),
                },
              ],
      })),
  },
  {
    uid: 'dev-client-4',
    idPrefix: 'appt-hist-c4',
    barbers: ['ivan'],
    barberPreference: BarberPreference.Specific,
    habitualStartMinutes: 16 * 60,
    menus: [[FADE]],
    tipRate: 0.2,
    selfRate: 0.6,
    // His son rides along as a GUEST seat — no account, no history of his own.
    visits: (cadence) =>
      cadence({ from: -40, count: 10, gap: [35, 42] }).map((offset, index) => ({
        offset,
        outcome: WORKED_SEAT,
        companions:
          index % 3 === 0
            ? [{ ...CLASSIC_LONG, ...guestSeat('Синът на Стоян') }]
            : [],
      })),
  },
  {
    uid: 'dev-client-5',
    idPrefix: 'appt-hist-c5',
    barbers: ['stefan'],
    barberPreference: BarberPreference.Specific,
    habitualStartMinutes: 11 * 60,
    menus: [[BEARD]],
    tipRate: 0.1,
    selfRate: 0.9,
    // Three no-shows inside 60 days (R47's threshold), then an older run of
    // worked visits with one more no-show far outside every window.
    visits: (cadence) => [
      ...[-9, -26, -47].map((offset) => alone(offset, NO_SHOW_SEAT)),
      ...cadence({ from: -70, count: 7, gap: [21, 35] }).map((offset, index) =>
        alone(offset, index === 3 ? NO_SHOW_SEAT : WORKED_SEAT),
      ),
    ],
  },
  {
    uid: 'dev-client-6',
    idPrefix: 'appt-hist-c6',
    barbers: ['ivan', 'niko'],
    barberPreference: BarberPreference.Any,
    habitualStartMinutes: 17 * 60,
    menus: [[FADE]],
    tipRate: 0.3,
    selfRate: 0.85,
    // Tighter gaps than the rest: two of the eight are cancellations of his
    // own, which do not break a rhythm, so the worked visits still average
    // three to six weeks apart.
    visits: (cadence) =>
      cadence({ from: -12, count: 8, gap: [21, 28] }).map((offset, index) => {
        // A LATE cancel: his own, three hours out, inside the 24 h window.
        if (index === 2) {
          return alone(
            offset,
            calledOffBefore(
              CancelledBy.Client,
              CancellationReason.ClientChangedPlans,
              3,
            ),
          );
        }
        // An in-window one, two days out, with nothing typed.
        if (index === 5) {
          return alone(
            offset,
            calledOffBefore(
              CancelledBy.Client,
              CancellationReason.Unspecified,
              50,
            ),
          );
        }
        return alone(offset, WORKED_SEAT);
      }),
  },
  {
    uid: 'dev-client-7',
    idPrefix: 'appt-hist-c7',
    barbers: ['niko'],
    barberPreference: BarberPreference.Specific,
    habitualStartMinutes: 15 * 60,
    menus: [[MODERN], [MODERN], [FADE]],
    tipRate: 0.3,
    selfRate: 0.5,
    visits: (cadence) =>
      worked(cadence({ from: -35, count: 8, gap: [35, 42] })),
  },
  {
    uid: 'dev-client-8',
    idPrefix: 'appt-hist-c8',
    barbers: ['stefan', 'ivan'],
    barberPreference: BarberPreference.Any,
    habitualStartMinutes: 13 * 60,
    menus: [[SCISSOR_LONG]],
    tipRate: 0.2,
    selfRate: 0.7,
    visits: (cadence) =>
      worked(cadence({ from: -45, count: 4, gap: [30, 42] })),
  },
  {
    uid: 'dev-client-11',
    idPrefix: 'appt-hist-c11',
    barbers: ['niko', 'stefan'],
    barberPreference: BarberPreference.Any,
    habitualStartMinutes: 11 * 60 + 30,
    menus: [[CLASSIC_LONG], [CLASSIC_LONG], [FINISH]],
    tipRate: 0.3,
    selfRate: 0.6,
    visits: (cadence) =>
      worked(cadence({ from: -20, count: 5, gap: [21, 42] })),
  },
];

// ── The visits written by hand ─────────────────────────────────────────────

/** Booked at noon a week before the visit's day. */
const weekBefore = (dayOffset: number): ShopMoment => ({
  dayOffset: dayOffset - 7,
  minutes: 12 * 60,
});

/** What the day visits take from the generated history: the visits they were rebooked from. */
export type DayVisitLinks = {
  /** Георги's last visit, and the moment «Запиши пак» rebooked him as it ended. */
  readonly georgiRebooked: {
    readonly fromAppointmentId: string;
    readonly bookedOn: ShopMoment;
  };
  /** Петър's last visit, which the party was booked from. */
  readonly petarLastAppointmentId: string;
};

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
export function dayVisits(links: DayVisitLinks): readonly VisitIntent[] {
  return [
    {
      id: 'appt-dev-1',
      dayOffset: 0,
      locationId: null,
      // Rebooked at the chair as his last visit ended.
      placement: Placement.Staff,
      bookedOn: links.georgiRebooked.bookedOn,
      bookedFromAppointmentId: links.georgiRebooked.fromAppointmentId,
      arrivedMinutes: 9 * 60 + 56,
      contact: contactOf('dev-client-1'),
      seats: [
        {
          seatId: 'seat-1',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 10 * 60,
          durationMinutes: 45,
          ...accountSeat('dev-client-1'),
          barberPreference: BarberPreference.Specific,
          ...WORKED_SEAT,
          tipCents: 200,
        },
      ],
    },
    {
      id: 'appt-dev-2',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(0),
      bookedFromAppointmentId: null,
      // Already in the chair: the NOW treatment and the "Done" verb both need
      // an arrival to be reachable at all.
      arrivedMinutes: 12 * 60 + 25,
      contact: contactOf('dev-client-2', 'Къса отстрани'),
      seats: [
        {
          seatId: 'seat-2',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          startMinutes: 12 * 60 + 30,
          durationMinutes: 30,
          ...accountSeat('dev-client-2'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // Петър, still to come: a beard at his habitual 14:00 with Стефан, the
      // barber every visit of his history names. It sat on Нико, who does
      // not sell beards, priced at Стефан's terms by a fallback that is gone.
      id: 'appt-dev-3',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(0),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-3'),
      seats: [
        {
          seatId: 'seat-3',
          barberId: 'stefan',
          serviceId: 'svc-beard',
          variantId: null,
          startMinutes: 14 * 60,
          durationMinutes: 30,
          ...accountSeat('dev-client-3'),
          barberPreference: BarberPreference.Specific,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // A MIXED PARTY across two chairs — one appointment, two seats, two
      // lanes. The cross-lane tie and the per-seat resolution both need it.
      id: 'appt-dev-4',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(0),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-4'),
      seats: [
        {
          seatId: 'seat-4a',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 16 * 60,
          durationMinutes: 45,
          ...accountSeat('dev-client-4'),
          barberPreference: BarberPreference.Specific,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
        {
          seatId: 'seat-4b',
          barberId: 'stefan',
          serviceId: 'svc-classic-cut',
          variantId: 'long',
          startMinutes: 16 * 60,
          durationMinutes: 30,
          ...guestSeat('Синът на Стоян'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      id: 'appt-dev-5',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(0),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-5'),
      seats: [
        {
          seatId: 'seat-5',
          barberId: 'stefan',
          serviceId: 'svc-beard',
          variantId: null,
          startMinutes: 11 * 60,
          durationMinutes: 30,
          ...accountSeat('dev-client-5'),
          barberPreference: BarberPreference.Specific,
          ...NO_SHOW_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // A first visit: a profile made this week and nothing else — the
      // «Нов клиент» state, one booking and no history.
      id: 'appt-dev-9',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Self,
      bookedOn: { dayOffset: -2, minutes: 21 * 60 + 10 },
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-9'),
      seats: [
        {
          seatId: 'seat-9',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          startMinutes: 17 * 60 + 15,
          durationMinutes: null,
          ...accountSeat('dev-client-9'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // The long name on today's lane: the head wraps, the bar truncates.
      // At 15:00, past Петър's 14:00–14:30 and Стефан's 15-minute reset —
      // the desk could not have booked him into 14:30.
      id: 'appt-dev-10',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Staff,
      bookedOn: { dayOffset: -4, minutes: 11 * 60 },
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-11'),
      seats: [
        {
          seatId: 'seat-10',
          barberId: 'stefan',
          serviceId: 'svc-classic-cut',
          variantId: 'long',
          startMinutes: 15 * 60,
          durationMinutes: null,
          ...accountSeat('dev-client-11'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // A guest the desk booked by phone yesterday: a name, no account, and
      // the number typed with it on the seat (R43) — «Гост · без профил»
      // with a way to call.
      id: 'appt-dev-guest',
      dayOffset: 0,
      locationId: null,
      placement: Placement.Staff,
      bookedOn: { dayOffset: -1, minutes: 17 * 60 + 40 },
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: null,
      seats: [
        {
          seatId: 'seat-guest',
          barberId: 'niko',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 18 * 60,
          durationMinutes: null,
          ...guestSeat('Борис'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      id: 'appt-dev-6',
      dayOffset: 1,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(1),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-6'),
      seats: [
        {
          seatId: 'seat-6',
          barberId: 'ivan',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 10 * 60,
          durationMinutes: 45,
          ...accountSeat('dev-client-6'),
          barberPreference: BarberPreference.Any,
          // Called off last night, well over a day ahead of any slot it is
          // placed in — outside the 24 h window, so not a late cancel.
          ...calledOffAt(
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
            { dayOffset: -1, minutes: 19 * 60 + 40 },
          ),
          tipCents: null,
        },
      ],
    },
    {
      id: 'appt-dev-7',
      dayOffset: 1,
      locationId: null,
      placement: Placement.Staff,
      bookedOn: weekBefore(1),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-7'),
      seats: [
        {
          seatId: 'seat-7',
          barberId: 'niko',
          serviceId: 'svc-modern-cut',
          variantId: null,
          startMinutes: 15 * 60,
          durationMinutes: 45,
          ...accountSeat('dev-client-7'),
          barberPreference: BarberPreference.Specific,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // A PARTY WITH A COMPANION WHO HAS AN ACCOUNT: Петър books, his son
      // sits in the next chair on his own profile. Booked with «Запиши пак»
      // from Петър's last visit.
      id: 'appt-dev-party',
      dayOffset: 1,
      locationId: null,
      placement: Placement.Self,
      bookedOn: { dayOffset: -3, minutes: 20 * 60 + 15 },
      bookedFromAppointmentId: links.petarLastAppointmentId,
      arrivedMinutes: null,
      contact: contactOf('dev-client-3'),
      seats: [
        {
          seatId: 'seat-party-a',
          barberId: 'ivan',
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          startMinutes: 11 * 60,
          durationMinutes: null,
          ...accountSeat('dev-client-3'),
          barberPreference: BarberPreference.Specific,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
        {
          seatId: 'seat-party-b',
          barberId: 'niko',
          serviceId: 'svc-fade',
          variantId: null,
          startMinutes: 11 * 60,
          durationMinutes: null,
          ...accountSeat('dev-client-10', SubjectRelationship.Companion),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
    {
      // Before Стефан's lunch: it sat at 13:00, inside the break, where the
      // booking flow could never have sold it.
      id: 'appt-dev-8',
      dayOffset: 2,
      locationId: null,
      placement: Placement.Self,
      bookedOn: weekBefore(2),
      bookedFromAppointmentId: null,
      arrivedMinutes: null,
      contact: contactOf('dev-client-8'),
      seats: [
        {
          seatId: 'seat-8',
          barberId: 'stefan',
          serviceId: 'svc-scissor-trim',
          variantId: 'long',
          startMinutes: 12 * 60 + 30,
          durationMinutes: 30,
          ...accountSeat('dev-client-8'),
          barberPreference: BarberPreference.Any,
          ...SCHEDULED_SEAT,
          tipCents: null,
        },
      ],
    },
  ];
}

/** Where the chair book placed yesterday's walk-in: the day, the start, the shop. */
export type WalkInPlacement = {
  readonly dayOffset: number;
  readonly startMinutes: number;
  readonly locationId: string;
};

/**
 * Yesterday's walk-in: no account, the name staff typed, and the phone they
 * typed with it on the seat (R43) — entered at the desk as he sat down.
 */
export function walkInVisit(placed: WalkInPlacement): VisitIntent {
  const enteredAt = placed.startMinutes - 2;
  return {
    id: 'appt-dev-walkin',
    dayOffset: placed.dayOffset,
    locationId: placed.locationId,
    placement: Placement.Staff,
    bookedOn: { dayOffset: placed.dayOffset, minutes: enteredAt },
    bookedFromAppointmentId: null,
    arrivedMinutes: enteredAt,
    contact: null,
    seats: [
      {
        seatId: 'seat-walkin',
        barberId: 'ivan',
        serviceId: 'svc-fade',
        variantId: null,
        startMinutes: placed.startMinutes,
        durationMinutes: null,
        ...guestSeat('Пламен (на място)'),
        barberPreference: BarberPreference.Any,
        ...WORKED_SEAT,
        tipCents: 200,
      },
    ],
  };
}
