import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
  SeatLabel,
  Seat,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  ShopNow,
  WallTime,
} from '@core/components';
import {
  type BookingStatus,
  BarberId,
  SeatId,
  ServiceId,
  UserId,
  LocalDate,
  type MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  localDate,
  minute,
  unwrapOk,
  appointmentFixture,
  seatFixture,
  termsFixture,
  customerOf,
} from '@core/testing';
import { type PersonSubject, VisitStorySystem } from './visit-story.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * COPIED and re-targeted from libs/features/shared/visits/src/lib/
 * visit-row.presenter.spec.ts — the STORY a row is told from, not its words
 * (the lines, captions, faces and sentences stay the presenter's):
 * - «visitRowOf · the staff card» (8 of 19): a cancellation and who called
 *   it off (the shop's too, and with company), a no-show, an hour still to
 *   come, a request not yet confirmed, the party's two stories (their seats,
 *   outcome, share and the others counted), a guest counted once, every
 *   barber of the subject's seats, a guest's visit told as the
 *   appointment's;
 * - «waitlistRowOf» (3 of 6): the days folded into runs, the passed ones
 *   dropped and the ones past a week dated, a run inside or across the week.
 * Plus the computed facts (`story`), properties and purity.
 *
 * Flatten pass (Laws 6/7): the visit is the flat `Appointment`
 * (`bookingStatus` + its stamp, seats with `attendanceState` and
 * `seatSubject`), every tag SCREAMING (`'cancelled'` → `'CANCELLED'`,
 * `'client'` → `'CLIENT'`), the span the seats' `startMinutes` →
 * `endMinutes` on the visit's `localDate`, money `totalCents` + `currency`,
 * "upcoming" a `WallTime` against the shop's `ShopNow`, days `LocalDate`s.
 */

const S = VisitStorySystem;

/** A wall clock `YYYY-MM-DDTHH:MM:SS` on the shop's calendar. */
function wall(local: string): WallTime {
  return WallTime.of(
    localDate(local.slice(0, 10)),
    minute(Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))),
  );
}

/** The instant that wall clock is in the shop's zone — for lifecycle stamps. */
function at(local: string): UtcEpochMs {
  const time = wall(local);
  return unwrapOk(
    ZonedTimeSystem.toUtc(time.localDate, time.minute, FIXTURE_TIME_ZONE),
  );
}

const GEORGI = UserId.of('georgi');
const IVO = UserId.of('ivo');
const IVAN = BarberId.of('barber-ivan');
const PETAR = BarberId.of('barber-petar');
const FADE = ServiceId.of('svc-fade');
const BEARD = ServiceId.of('svc-beard');
const WORKED_AT = at('2026-09-04T11:00:00');
const NOW: ShopNow = ZonedTimeSystem.shopNow(
  at('2026-09-28T12:00:00'),
  FIXTURE_TIME_ZONE,
);

/** The shop day each built seat starts on — its visit's `localDate` (T7). */
const dayOfSeat = new Map<Seat, LocalDate>();

function seat(
  local: string,
  options: {
    readonly id?: string;
    readonly who?: UserId;
    readonly guest?: string;
    readonly relationship?: SubjectRelationship;
    readonly service?: ServiceId;
    readonly barber?: BarberId;
    readonly priceCents?: number;
    readonly outcome?: SeatOutcome;
  } = {},
): Seat {
  const start = wall(local);
  const built = seatFixture({
    seatId: SeatId.of(options.id ?? `seat-${local}`),
    serviceId: options.service ?? FADE,
    barberId: options.barber ?? IVAN,
    startMinutes: start.minute,
    terms: Seat.termsOf(termsFixture(options.priceCents ?? 2750, 30), null),
    occupant:
      options.guest !== undefined
        ? SeatOccupant.anonymous(SeatLabel.of(options.guest))
        : SeatOccupant.account(
            options.who ?? GEORGI,
            customerOf(options.who ?? GEORGI),
            options.relationship ?? SubjectRelationship.Self,
          ),
    outcome: options.outcome ?? SeatOutcome.scheduled(),
  });
  dayOfSeat.set(built, start.localDate);
  return built;
}

function visit(
  seats: readonly Seat[],
  lifecycle: BookingLifecycle,
): Appointment {
  const first = seats[0];
  return appointmentFixture({
    seats,
    lifecycle,
    localDate:
      first === undefined
        ? FIXTURE_TODAY
        : (dayOfSeat.get(first) ?? FIXTURE_TODAY),
  });
}

const cancelled = (
  local: string,
  by: CancelledBy,
  reason: CancellationReason,
) => SeatOutcome.cancelled(at(local), by, reason, null);

/** A root cancellation for the given reasons. */
const cancelledRoot = (local: string, ...reasons: CancellationReason[]) =>
  BookingLifecycle.cancel(at(local), CancellationReasonSet.of(reasons));

/** The row's own story, as the staff card tells it of `subject`'s client record (D29). */
const staffStory = (
  appointment: Appointment,
  subject: UserId | null = GEORGI,
) =>
  S.subjectStory(
    appointment,
    subject === null ? null : customerOf(subject),
    true,
  );

/** Who a seat is for, as people are counted. */
function personOf(entry: Seat): PersonSubject {
  return entry.seatSubject === SeatSubject.Account
    ? { seatSubject: SeatSubject.Account, userId: entry.subjectUserId }
    : { seatSubject: SeatSubject.Anonymous, label: entry.guestLabel };
}

/** The OTHER people on the visit, as the row counts them. */
function peersOf(
  appointment: Appointment,
  subject: UserId | null = GEORGI,
): number {
  const story = staffStory(appointment, subject);
  return S.peerCount(
    appointment.seats.map(personOf),
    appointment.seats.map((_, i) => story.seatIndexes.includes(i)),
  );
}

/** A lifecycle stamp of an epoch figure, for the ordering cases. */
const stamp = (raw: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(raw));

describe('visitRowOf · the staff card — the story', () => {
  it('strikes a cancellation, says who called it off and what was booked', () => {
    const called = visit(
      [
        seat('2026-07-16T10:00:00', {
          priceCents: 1750,
          outcome: cancelled(
            '2026-07-15T18:00:00',
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
          ),
        }),
      ],
      cancelledRoot(
        '2026-07-15T18:00:00',
        CancellationReason.ClientChangedPlans,
      ),
    );
    expect(staffStory(called)).toEqual({
      seatIndexes: [0],
      outcome: 'CANCELLED',
      cancelledBy: 'CLIENT',
    });
    // What was booked: the struck figure.
    expect(unwrapOk(S.story(called)).totalCents).toBe(1750);

    // The shop's own cancellation is the shop's.
    const byShop = visit(
      [
        seat('2026-07-18T10:00:00', {
          outcome: cancelled(
            '2026-07-17T09:00:00',
            CancelledBy.Staff,
            CancellationReason.StaffShopClosure,
          ),
        }),
      ],
      cancelledRoot('2026-07-17T09:00:00', CancellationReason.StaffShopClosure),
    );
    expect(staffStory(byShop).cancelledBy).toBe('SHOP');

    // With company: the party counted beside the barber.
    const withCompany = visit(
      [
        seat('2026-07-16T10:00:00', {
          id: 'seat-georgi-cancelled',
          outcome: cancelled(
            '2026-07-15T18:00:00',
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
          ),
        }),
        seat('2026-07-16T10:00:00', {
          id: 'seat-ivo-cancelled',
          who: IVO,
          relationship: SubjectRelationship.Companion,
          service: BEARD,
          barber: PETAR,
          outcome: cancelled(
            '2026-07-15T18:00:00',
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
          ),
        }),
      ],
      cancelledRoot(
        '2026-07-15T18:00:00',
        CancellationReason.ClientChangedPlans,
      ),
    );
    expect(staffStory(withCompany).cancelledBy).toBe('CLIENT');
    expect(peersOf(withCompany)).toBe(1);
  });

  it('strikes a no-show in full ink, the warning on the glyph, and prices nothing', () => {
    const noShow = visit(
      [
        seat('2026-07-07T10:00:00', {
          outcome: SeatOutcome.noShow(at('2026-07-07T10:20:00')),
        }),
      ],
      BookingLifecycle.noShow(at('2026-07-07T10:20:00')),
    );
    expect(staffStory(noShow)).toEqual({
      seatIndexes: [0],
      outcome: 'NO_SHOW',
      cancelledBy: null,
    });
  });

  it('files an hour still to come under «Предстоящи», saying when in the day — nothing paid yet', () => {
    const ahead = visit(
      [seat('2026-10-02T10:00:00')],
      BookingLifecycle.confirm(at('2026-09-20T10:00:00')),
    );
    const story = staffStory(ahead);
    expect(story.outcome).toBe('OPEN');
    expect(S.isUpcoming(story.outcome, wall('2026-10-02T10:00:00'), NOW)).toBe(
      true,
    );
    // An open hour already started is no longer ahead.
    expect(S.isUpcoming('OPEN', wall('2026-09-28T10:00:00'), NOW)).toBe(false);
    expect(S.isUpcoming('WORKED', wall('2026-10-02T10:00:00'), NOW)).toBe(
      false,
    );
    // The shop's minute itself is still ahead (`≥`), as the instant was.
    expect(S.isUpcoming('OPEN', ShopNow.wallTime(NOW), NOW)).toBe(true);
  });

  it('says a request the shop has not confirmed is «Заявен»', () => {
    const pending = visit(
      [seat('2026-10-02T10:00:00')],
      BookingLifecycle.pending(at('2026-09-27T10:00:00')),
    );
    // Open — the word is the root status the template reads off the entity.
    expect(staffStory(pending).outcome).toBe('OPEN');
  });

  describe('a party', () => {
    // Георги booked for himself and Иво: Иво's beard with Петър, and Иво
    // did not come while Георги had his fade.
    const party = visit(
      [
        seat('2026-09-04T10:00:00', {
          id: 'seat-georgi',
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
        seat('2026-09-04T10:00:00', {
          id: 'seat-ivo',
          who: IVO,
          relationship: SubjectRelationship.Companion,
          service: BEARD,
          barber: PETAR,
          priceCents: 1200,
          outcome: SeatOutcome.noShow(WORKED_AT),
        }),
      ],
      // The legacy fixture's root discount is not pro-rated onto a share,
      // so the story below does not depend on it.
      BookingLifecycle.complete(WORKED_AT),
    );

    it('tells the subject’s own story — their seats, their outcome, their share, the others counted', () => {
      const georgi = staffStory(party, GEORGI);
      // A companion's no-show says nothing about the booker.
      expect(georgi).toEqual({
        seatIndexes: [0],
        outcome: 'WORKED',
        cancelledBy: null,
      });
      // His seat's own price: a root discount is not pro-rated (Q2).
      const own = georgi.seatIndexes.map((i) => party.seats.at(i) as Seat);
      expect(own.reduce((sum, entry) => sum + entry.priceCents, 0)).toBe(2750);
      // The face is of who cut HIS seat, not the companion's.
      expect(S.distinct(own.map((entry) => entry.barberId))).toEqual([IVAN]);
      expect(peersOf(party, GEORGI)).toBe(1);

      const ivo = staffStory(party, IVO);
      expect(ivo).toEqual({
        seatIndexes: [1],
        outcome: 'NO_SHOW',
        cancelledBy: null,
      });
      const his = ivo.seatIndexes.map((i) => party.seats.at(i) as Seat);
      expect(S.distinct(his.map((entry) => entry.serviceId))).toEqual([BEARD]);
      expect(S.distinct(his.map((entry) => entry.barberId))).toEqual([PETAR]);
      expect(peersOf(party, IVO)).toBe(1);
    });

    it('counts a guest by the seat’s name, once however many services they had', () => {
      const withGuest = visit(
        [
          seat('2026-09-04T10:00:00', {
            id: 'seat-georgi',
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
          seat('2026-09-04T10:00:00', {
            id: 'seat-guest-cut',
            guest: 'Син',
            barber: PETAR,
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
          seat('2026-09-04T10:30:00', {
            id: 'seat-guest-beard',
            guest: 'Син',
            service: BEARD,
            barber: PETAR,
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
        ],
        BookingLifecycle.complete(WORKED_AT),
      );
      expect(peersOf(withGuest)).toBe(1);
    });
  });

  it('lists every barber of the subject’s seats by name', () => {
    const two = visit(
      [
        seat('2026-09-04T10:00:00', {
          id: 'seat-cut',
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
        seat('2026-09-04T10:30:00', {
          id: 'seat-beard',
          service: BEARD,
          barber: PETAR,
          priceCents: 1200,
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
      ],
      BookingLifecycle.complete(WORKED_AT),
    );
    const story = unwrapOk(S.story(two));
    expect(story.serviceIds).toEqual([FADE, BEARD]);
    expect(story.barberIds).toEqual([IVAN, PETAR]);
    // Both seats are his: the figure is the bill.
    expect(staffStory(two).seatIndexes).toEqual([0, 1]);
    expect(story.totalCents).toBe(3950);
  });

  it('tells a guest’s visit as the appointment’s own, and quotes nobody', () => {
    const last = visit(
      [seat('2026-09-04T10:00:00', { outcome: SeatOutcome.worked(WORKED_AT) })],
      BookingLifecycle.complete(WORKED_AT),
    );
    expect(staffStory(last, null)).toEqual({
      seatIndexes: [0],
      outcome: 'WORKED',
      cancelledBy: null,
    });
    // A subject with no seat on it: the appointment's too.
    expect(staffStory(last, IVO).outcome).toBe('WORKED');
    // The client's own list always tells the appointment's.
    expect(S.subjectStory(last, customerOf(IVO), false).seatIndexes).toEqual([
      0,
    ]);
  });
});

describe('waitlistRowOf — the days it watches', () => {
  const TODAY = localDate('2026-09-28');
  const keys = (raw: readonly string[]) => raw.map((key) => localDate(key));
  /** The days still ahead, as the row keeps them. */
  const ahead = (raw: readonly string[]) =>
    keys(raw).filter((key) => key >= TODAY);

  it('leads with the watching glyph and folds the days it still watches into one line', () => {
    const days = ahead(['2026-10-01', '2026-10-02']);
    // «чт – пт»: one run, inside the coming week at both ends.
    expect(S.dayRuns(days)).toEqual([{ first: 0, last: 1 }]);
    expect(days.every((day) => S.withinWeek(day, TODAY))).toBe(true);
  });

  it('drops the days that have passed, dates the ones past a week, and counts past three', () => {
    const days = ahead([
      '2026-09-20',
      '2026-10-01',
      '2026-10-12',
      '2026-10-14',
      '2026-10-20',
      '2026-10-22',
    ]);
    expect(days).toEqual([
      '2026-10-01',
      '2026-10-12',
      '2026-10-14',
      '2026-10-20',
      '2026-10-22',
    ]);
    // Five lone days: «чт, 12.10, 14.10 и още 2».
    expect(S.dayRuns(days)).toHaveLength(5);
    expect(days.map((day) => S.withinWeek(day, TODAY))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('prints a run of days through the house range, one face at both ends', () => {
    // Past the week: the dates, «8.10 – 9.10».
    const past = keys(['2026-10-08', '2026-10-09']);
    expect(S.dayRuns(past)).toEqual([{ first: 0, last: 1 }]);
    expect(past.some((day) => S.withinWeek(day, TODAY))).toBe(false);
    // A run that leaves the week is dated at both ends, never «сб – 6.10».
    const leaving = keys([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(S.dayRuns(leaving)).toEqual([{ first: 0, last: 3 }]);
    expect(S.withinWeek(leaving[0] as LocalDate, TODAY)).toBe(true);
    expect(S.withinWeek(leaving[3] as LocalDate, TODAY)).toBe(false);
    // Across the new year: still one run.
    expect(S.dayRuns(keys(['2026-12-31', '2027-01-01']))).toEqual([
      { first: 0, last: 1 },
    ]);
    // A lone day and a run: «1.10, 8.10 – 9.10».
    expect(S.dayRuns(keys(['2026-10-01', '2026-10-08', '2026-10-09']))).toEqual(
      [
        { first: 0, last: 0 },
        { first: 1, last: 2 },
      ],
    );
  });
});

describe('VisitStorySystem — the facts and the rules', () => {
  it('takes the envelope from the seats and the total from the bill', () => {
    const two = visit(
      [
        seat('2026-09-04T10:30:00', {
          service: BEARD,
          barber: PETAR,
          priceCents: 1200,
        }),
        seat('2026-09-04T10:00:00'),
      ],
      BookingLifecycle.confirm(at('2026-09-01T10:00:00')),
    );
    const story = unwrapOk(S.story(two));
    const from: MinuteOfDay = wall('2026-09-04T10:00:00').minute;
    expect(story).toMatchObject({
      localDate: '2026-09-04',
      startMinutes: from,
      endMinutes: from + 60,
    });
    expect(story.currency).toBe('EUR');
    expect(story.barberIds).toEqual([PETAR, IVAN]);
    expect(S.story(visit([], BookingLifecycle.confirm(stamp(0)))).ok).toBe(
      false,
    );
  });

  it('decides a cancelled visit by the seat called off last, the first of equal instants', () => {
    expect(
      S.decisiveCancellationIndex([null, stamp(5), stamp(9), stamp(9), null]),
    ).toBe(2);
    expect(S.decisiveCancellationIndex([null, null])).toBe(-1);
    const CANCELLED: BookingStatus = 'CANCELLED';
    expect(
      S.rootStory(CANCELLED, [
        SeatOutcome.cancelled(
          stamp(1),
          CancelledBy.Staff,
          CancellationReason.StaffShopClosure,
          null,
        ),
        SeatOutcome.cancelled(
          stamp(2),
          CancelledBy.Client,
          CancellationReason.Unspecified,
          null,
        ),
      ]),
    ).toEqual({ outcome: 'CANCELLED', cancelledBy: 'CLIENT' });
    // A cancelled visit with no seat on record holds nothing against the client.
    expect(S.rootStory(CANCELLED, [SeatOutcome.scheduled()])).toEqual({
      outcome: 'CANCELLED',
      cancelledBy: 'SHOP',
    });
  });

  it('keeps present values once, in first-seen order', () => {
    expect(S.distinct(['b', null, 'a', 'b', 'c', null, 'a'])).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('folds days into runs that cover them all, each a consecutive stretch (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 20_000, max: 20_060 }), {
          maxLength: 20,
        }),
        (epochDays) => {
          const sorted = [...epochDays].sort((a, b) => a - b);
          const days = sorted.map((day) => LocalDate.fromEpochDay(day));
          const runs = S.dayRuns(days);
          let next = 0;
          for (const run of runs) {
            expect(run.first).toBe(next);
            expect(
              (sorted[run.last] as number) - (sorted[run.first] as number),
            ).toBe(run.last - run.first);
            next = run.last + 1;
          }
          expect(next).toBe(days.length);
          for (let i = 1; i < runs.length; i++) {
            const run = runs.at(i) as { first: number };
            const before = runs[i - 1] as { last: number };
            const gap =
              (sorted[run.first] as number) - (sorted[before.last] as number);
            expect(gap).toBeGreaterThan(1);
          }
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const party = deepFreeze(
      visit(
        [
          seat('2026-09-04T10:00:00', {
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
          seat('2026-09-04T10:00:00', {
            who: IVO,
            relationship: SubjectRelationship.Companion,
            outcome: SeatOutcome.noShow(WORKED_AT),
          }),
        ],
        BookingLifecycle.complete(WORKED_AT),
      ),
    );
    expect(S.story(party)).toEqual(S.story(party));
    expect(S.subjectStory(party, customerOf(IVO), true)).toEqual(
      S.subjectStory(party, customerOf(IVO), true),
    );
    const days = deepFreeze([localDate('2026-10-01'), localDate('2026-10-02')]);
    expect(S.dayRuns(days)).toEqual(S.dayRuns(days));
    const start = deepFreeze(wall('2026-10-02T10:00:00'));
    const now = deepFreeze(NOW);
    expect(S.isUpcoming('OPEN', start, now)).toBe(
      S.isUpcoming('OPEN', start, now),
    );
    expect(party.seats).toHaveLength(2);
  });
});
