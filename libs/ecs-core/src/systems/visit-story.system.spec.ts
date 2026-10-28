import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  Combinability,
  CouponValue,
  DiscountProvenance,
  SeatOutcome,
  SeatLabel,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ShopNow,
  VisitMark,
  VisitRowOutcome,
  VisitStatusMark,
  VisitTone,
  VoucherCode,
  type VoucherRedemption,
  WallTime,
} from '@core/components';
import {
  AppliedDiscountId,
  BookingStatus,
  BarberId,
  Currency,
  GiftVoucherId,
  SeatId,
  ServiceId,
  UserId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  EUR,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  cents,
  deepFreeze,
  endMinute,
  localDate,
  minute,
  unwrapOk,
  appointmentFixture,
  seatFixture,
  termsFixture,
  customerOf,
} from '@core/testing';
import { LocationScopeSystem } from './location-scope.system';
import { VisitListSystem } from './visit-list.system';
import { type SubjectStory, VisitStorySystem } from './visit-story.system';
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

/** The OTHER people on the visit, as the row counts them. */
function peersOf(
  appointment: Appointment,
  subject: UserId | null = GEORGI,
): number {
  const story = staffStory(appointment, subject);
  return S.peerCount(
    appointment.seats,
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
    expect(S.subjectFigure(called, staffStory(called))?.amountCents).toBe(1750);

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
    const story = staffStory(two);
    expect(S.distinct(two.seats.map((entry) => entry.serviceId))).toEqual([
      FADE,
      BEARD,
    ]);
    expect(S.subjectBarberIds(two, story)).toEqual([IVAN, PETAR]);
    // Both seats are his: the figure is the bill.
    expect(story.seatIndexes).toEqual([0, 1]);
    expect(S.subjectFigure(two, story)?.amountCents).toBe(3950);
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
  it('decides a cancelled visit by the seat called off last, the first of equal instants', () => {
    expect(
      S.decisiveCancellationIndex([null, stamp(5), stamp(9), stamp(9), null]),
    ).toBe(2);
    expect(S.decisiveCancellationIndex([null, null])).toBe(-1);
    const CANCELLED: BookingStatus = BookingStatus.Cancelled;
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

/*
 * Law 10.2 decision extraction (W0-A): the decisions `visit-row.presenter.ts`
 * and `visit-card/visit-card.presenter.ts` (and the staff glance's
 * `lastWorkedVisit`) held over the story — the tile's tone, the status
 * mark, the whole party, the figure, the marks, whose words are quoted, the
 * shop named, the barbers, the subject record, the people counted, the last
 * worked visit. Each case re-states the pinning presenter case (row/card
 * spec line in the title) as a value/tag assertion on the same fixture
 * story; the words stay the presenters'.
 */

/** «FIRST10», −10 %, applied by code — the bill's one snapshot (visit-fixtures `firstTenDiscount`). */
const FIRST10: AppliedDiscount = {
  discountId: AppliedDiscountId.of('code:FIRST10'),
  label: 'FIRST10',
  appliedAtUtcMs: WORKED_AT,
  combinability: Combinability.Stackable,
  ...DiscountProvenance.code(VoucherCode.of('FIRST10')),
  ...unwrapOk(CouponValue.percentOff(10)),
};

/** A voucher draw on the bill — taken back when `reversed`. */
const draw = (reversed: boolean): VoucherRedemption => ({
  voucherId: GiftVoucherId.of('voucher-1'),
  code: VoucherCode.of('GIFT-50'),
  amountCents: cents(2750),
  balanceAfterCents: cents(2250),
  currency: EUR,
  appliedAtUtcMs: WORKED_AT,
  reversedAtUtcMs: reversed ? UtcEpochMs.plusMs(WORKED_AT, 300_000) : null,
});

/** Георги's last visit: a fade with Иван, worked, booked by Георги with his own words. */
const LAST = (): Appointment => ({
  ...visit(
    [seat('2026-09-04T10:00:00', { outcome: SeatOutcome.worked(WORKED_AT) })],
    BookingLifecycle.complete(WORKED_AT),
  ),
  ownerUserId: GEORGI,
  contactNote: 'Къса отстрани, по-дълго отгоре',
});

/** Георги booked for himself and Иво: Иво's beard with Петър, and Иво did not come. */
const PARTY = (): Appointment => ({
  ...visit(
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
    BookingLifecycle.complete(WORKED_AT),
  ),
  ownerUserId: GEORGI,
  contactNote: 'Ще дойдем двамата',
  discounts: [FIRST10],
});

const OUTCOMES: readonly VisitRowOutcome[] = [
  VisitRowOutcome.Open,
  VisitRowOutcome.Worked,
  VisitRowOutcome.NoShow,
  VisitRowOutcome.Cancelled,
];
const STATUSES: readonly BookingStatus[] = [
  BookingStatus.Pending,
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
  BookingStatus.NoShow,
];

describe('the visit tags (components)', () => {
  it('pins each new dictionary’s SCREAMING values', () => {
    expect(VisitTone).toEqual({
      Hollow: 'HOLLOW',
      Upcoming: 'UPCOMING',
      Past: 'PAST',
    });
    expect(VisitStatusMark).toEqual({
      NoShow: 'NO_SHOW',
      Pending: 'PENDING',
      Confirmed: 'CONFIRMED',
    });
    expect(VisitMark).toEqual({
      Photos: 'PHOTOS',
      Discount: 'DISCOUNT',
      Voucher: 'VOUCHER',
    });
  });
});

describe('VisitStorySystem.isVoid / toneOf — the struck row and its tile', () => {
  it('strikes a visit that did not happen, and only that (row 293, 388, 412; client 895)', () => {
    expect(OUTCOMES.filter((outcome) => S.isVoid(outcome))).toEqual([
      'NO_SHOW',
      'CANCELLED',
    ]);
  });

  it('draws a cancellation and a no-show hollow — even on a day still to come (row 293, 388)', () => {
    const ahead = wall('2026-10-02T10:00:00');
    expect(S.toneOf('CANCELLED', ahead, NOW)).toBe('HOLLOW');
    expect(S.toneOf('NO_SHOW', ahead, NOW)).toBe('HOLLOW');
    expect(S.toneOf('CANCELLED', wall('2026-07-16T10:00:00'), NOW)).toBe(
      'HOLLOW',
    );
  });

  it('draws an hour still to come upcoming, from the shop’s own minute on (row 412)', () => {
    expect(S.toneOf('OPEN', wall('2026-10-02T10:00:00'), NOW)).toBe('UPCOMING');
    expect(S.toneOf('OPEN', ShopNow.wallTime(NOW), NOW)).toBe('UPCOMING');
  });

  it('draws everything else past — a worked visit, an open hour already started (row 235)', () => {
    expect(S.toneOf('WORKED', wall('2026-09-04T10:00:00'), NOW)).toBe('PAST');
    expect(S.toneOf('WORKED', wall('2026-10-02T10:00:00'), NOW)).toBe('PAST');
    expect(S.toneOf('OPEN', wall('2026-09-28T10:00:00'), NOW)).toBe('PAST');
  });
});

describe('VisitStorySystem.statusMark — the status named beside a visit', () => {
  it('marks every outcome × stored status as the row and the card read them (row 388, 433; card 343, 354, 384)', () => {
    const table = Object.fromEntries(
      OUTCOMES.map((outcome) => [
        outcome,
        STATUSES.map((status) => S.statusMark(outcome, status)),
      ]),
    );
    // Columns: PENDING, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW.
    expect(table).toEqual({
      OPEN: ['PENDING', 'CONFIRMED', null, null, null],
      WORKED: [null, null, null, null, null],
      NO_SHOW: ['NO_SHOW', 'NO_SHOW', 'NO_SHOW', 'NO_SHOW', 'NO_SHOW'],
      CANCELLED: [null, null, null, null, null],
    });
  });

  it('marks a companion’s no-show on their own row, whatever the party’s root (row 515)', () => {
    const party = PARTY();
    const ivo = staffStory(party, IVO);
    expect(S.statusMark(ivo.outcome, party.bookingStatus)).toBe('NO_SHOW');
    const georgi = staffStory(party, GEORGI);
    expect(S.statusMark(georgi.outcome, party.bookingStatus)).toBeNull();
  });
});

describe('VisitStorySystem.isWholeParty — the story covers every seat', () => {
  it('is the whole party for a visit of one, and for a guest’s story (row 235, 838)', () => {
    const last = LAST();
    expect(S.isWholeParty(last, staffStory(last))).toBe(true);
    expect(S.isWholeParty(last, staffStory(last, null))).toBe(true);
  });

  it('is a share for each person of a party, and the whole on the client’s own list (row 515, 767)', () => {
    const party = PARTY();
    expect(S.isWholeParty(party, staffStory(party, GEORGI))).toBe(false);
    expect(S.isWholeParty(party, staffStory(party, IVO))).toBe(false);
    expect(
      S.isWholeParty(party, S.subjectStory(party, customerOf(GEORGI), false)),
    ).toBe(true);
  });
});

describe('VisitStorySystem.subjectFigure — what the row’s figure says', () => {
  it('prints the bill of a worked visit of one (row 235)', () => {
    const last = LAST();
    expect(S.subjectFigure(last, staffStory(last))).toEqual({
      amountCents: 2750,
      currency: 'EUR',
    });
  });

  it('prints the discounted bill where the story is the whole party (row 597; card 173)', () => {
    const discounted: Appointment = { ...LAST(), discounts: [FIRST10] };
    expect(S.subjectFigure(discounted, staffStory(discounted))).toEqual({
      amountCents: 2475,
      currency: 'EUR',
    });
  });

  it('prints a share as the subject’s own seats, the root discount not pro-rated (row 515)', () => {
    const party = PARTY();
    expect(S.subjectFigure(party, staffStory(party, GEORGI))).toEqual({
      amountCents: 2750,
      currency: 'EUR',
    });
    // Иво did not come: a no-show carries no figure.
    expect(S.subjectFigure(party, staffStory(party, IVO))).toBeNull();
  });

  it('prints what was booked for a cancellation (row 293)', () => {
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
    expect(S.subjectFigure(called, staffStory(called))).toEqual({
      amountCents: 1750,
      currency: 'EUR',
    });
  });

  it('prints nothing for a no-show or an hour still open (row 388, 412)', () => {
    const noShow = visit(
      [
        seat('2026-07-07T10:00:00', {
          outcome: SeatOutcome.noShow(at('2026-07-07T10:20:00')),
        }),
      ],
      BookingLifecycle.noShow(at('2026-07-07T10:20:00')),
    );
    expect(S.subjectFigure(noShow, staffStory(noShow))).toBeNull();
    const ahead = visit(
      [seat('2026-10-02T10:00:00')],
      BookingLifecycle.confirm(at('2026-09-20T10:00:00')),
    );
    expect(S.subjectFigure(ahead, staffStory(ahead))).toBeNull();
  });

  it('prints nothing for a visit no bill can be read from — no seat, two currencies', () => {
    const worked: SubjectStory = {
      seatIndexes: [],
      outcome: 'WORKED',
      cancelledBy: null,
    };
    const empty = visit([], BookingLifecycle.complete(WORKED_AT));
    expect(S.subjectFigure(empty, worked)).toBeNull();

    const cut = seat('2026-09-04T10:00:00', {
      id: 'seat-eur',
      outcome: SeatOutcome.worked(WORKED_AT),
    });
    const legacy: Seat = {
      ...cut,
      seatId: SeatId.of('seat-bgn'),
      currency: Currency.BGN,
    };
    const mixed = visit([cut, legacy], BookingLifecycle.complete(WORKED_AT));
    // The whole party's bill refuses two currencies…
    expect(
      S.subjectFigure(mixed, { ...worked, seatIndexes: [0, 1] }),
    ).toBeNull();
    // …and so does a share that holds both.
    const three = visit(
      [cut, legacy, seat('2026-09-04T11:00:00', { id: 'seat-third' })],
      BookingLifecycle.complete(WORKED_AT),
    );
    expect(
      S.subjectFigure(three, { ...worked, seatIndexes: [0, 1] }),
    ).toBeNull();
    expect(S.subjectFigure(three, { ...worked, seatIndexes: [1] })).toEqual({
      amountCents: 2750,
      currency: 'BGN',
    });
  });
});

describe('VisitStorySystem.marksOf — the marks a row carries', () => {
  it('marks a worked visit’s photos, and none without any (row 235)', () => {
    const last = LAST();
    expect(S.marksOf(last, staffStory(last), 1)).toEqual(['PHOTOS']);
    expect(S.marksOf(last, staffStory(last), 0)).toEqual([]);
  });

  it('marks a discount where the figure is the discounted bill (row 597)', () => {
    const discounted: Appointment = { ...LAST(), discounts: [FIRST10] };
    expect(S.marksOf(discounted, staffStory(discounted), 0)).toEqual([
      'DISCOUNT',
    ]);
  });

  it('marks a voucher after the photos and the discount, in drawing order (row 723)', () => {
    const paid: Appointment = {
      ...LAST(),
      discounts: [FIRST10],
      voucherRedemptions: [draw(false)],
    };
    expect(S.marksOf(paid, staffStory(paid), 2)).toEqual([
      'PHOTOS',
      'DISCOUNT',
      'VOUCHER',
    ]);
  });

  it('marks nothing for a draw that was taken back, or on a visit that did not happen (row 745)', () => {
    const reversed: Appointment = {
      ...LAST(),
      voucherRedemptions: [draw(true)],
    };
    expect(S.marksOf(reversed, staffStory(reversed), 0)).toEqual([]);
    // A live draw beside one taken back still marks the bill.
    const again: Appointment = {
      ...LAST(),
      voucherRedemptions: [draw(true), draw(false)],
    };
    expect(S.marksOf(again, staffStory(again), 0)).toEqual(['VOUCHER']);

    const missed: Appointment = {
      ...visit(
        [
          seat('2026-09-04T10:00:00', {
            outcome: SeatOutcome.noShow(at('2026-09-04T10:20:00')),
          }),
        ],
        BookingLifecycle.noShow(at('2026-09-04T10:20:00')),
      ),
      discounts: [FIRST10],
      voucherRedemptions: [draw(false)],
    };
    expect(S.marksOf(missed, staffStory(missed), 3)).toEqual([]);
  });

  it('marks the bill, never a companion’s share of it — the photos still count (row 515, 767)', () => {
    const party: Appointment = {
      ...visit(
        [
          seat('2026-09-04T10:00:00', {
            id: 'seat-georgi',
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
          seat('2026-09-04T10:00:00', {
            id: 'seat-ivo',
            who: IVO,
            relationship: SubjectRelationship.Companion,
            barber: PETAR,
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
        ],
        BookingLifecycle.complete(WORKED_AT),
      ),
      discounts: [FIRST10],
      voucherRedemptions: [draw(false)],
    };
    expect(S.marksOf(party, staffStory(party, IVO), 0)).toEqual([]);
    expect(S.marksOf(party, staffStory(party, IVO), 1)).toEqual(['PHOTOS']);
    // The discounted party, his own share: no discount beside an undiscounted figure.
    const discounted = PARTY();
    expect(S.marksOf(discounted, staffStory(discounted, GEORGI), 0)).toEqual(
      [],
    );
  });
});

describe('VisitStorySystem.quotesBooker — whose own words a row quotes', () => {
  it('quotes the booker’s own words (row 235; card 203)', () => {
    expect(S.quotesBooker(LAST(), GEORGI)).toBe(true);
    expect(S.quotesBooker(PARTY(), GEORGI)).toBe(true);
  });

  it('quotes nobody else on a party someone else booked (row 515)', () => {
    expect(S.quotesBooker(PARTY(), IVO)).toBe(false);
  });

  it('quotes nobody for a guest, nor without a note (row 838)', () => {
    expect(S.quotesBooker(LAST(), null)).toBe(false);
    expect(S.quotesBooker({ ...LAST(), contactNote: null }, GEORGI)).toBe(
      false,
    );
  });

  it('quotes nobody on an unclaimed party (owner null) for a null subject', () => {
    const unclaimed: Appointment = { ...LAST(), ownerUserId: null };
    expect(S.quotesBooker(unclaimed, null)).toBe(false);
    expect(S.quotesBooker(unclaimed, GEORGI)).toBe(false);
  });
});

describe('VisitStorySystem.namesShop — the shop named on a worked visit', () => {
  it('names the shop of a worked visit only when there is more than one (row 280; card 282)', () => {
    expect(S.namesShop('WORKED', 2)).toBe(true);
    expect(S.namesShop('WORKED', 1)).toBe(false);
    expect(S.namesShop('WORKED', 0)).toBe(false);
  });

  it('never names it for an open hour, a cancellation or a no-show (row 293, 412)', () => {
    for (const outcome of ['OPEN', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(S.namesShop(outcome, 3)).toBe(false);
    }
  });

  it('composes LocationScopeSystem.isMultiShop for the shop count', () => {
    for (const count of [0, 1, 2, 5]) {
      expect(S.namesShop('WORKED', count)).toBe(
        LocationScopeSystem.isMultiShop(count),
      );
    }
  });
});

describe('VisitStorySystem.subjectBarberIds — who cut the story’s seats', () => {
  it('lists every barber of the subject’s seats, in first-seat order (row 647; card 390)', () => {
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
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
        seat('2026-09-04T11:00:00', {
          id: 'seat-again',
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
      ],
      BookingLifecycle.complete(WORKED_AT),
    );
    expect(S.subjectBarberIds(two, staffStory(two))).toEqual([IVAN, PETAR]);
  });

  it('names who cut HIS seat on a party, not the companion’s (row 515, 681)', () => {
    const party = PARTY();
    expect(S.subjectBarberIds(party, staffStory(party, GEORGI))).toEqual([
      IVAN,
    ]);
    expect(S.subjectBarberIds(party, staffStory(party, IVO))).toEqual([PETAR]);
  });
});

describe('VisitStorySystem.subjectRecordOf — the record a row’s story is about', () => {
  it('takes the record the host named, a guest’s `null` included (row 515; card 289)', () => {
    const party = PARTY();
    expect(S.subjectRecordOf(party, customerOf(IVO), GEORGI)).toBe(
      customerOf(IVO),
    );
    expect(S.subjectRecordOf(party, null, GEORGI)).toBeNull();
  });

  it('reads the record off the ACCOUNT seat of the subject when the host named none (row 515, 565)', () => {
    const party = PARTY();
    expect(S.subjectRecordOf(party, undefined, GEORGI)).toBe(
      customerOf(GEORGI),
    );
    expect(S.subjectRecordOf(party, undefined, IVO)).toBe(customerOf(IVO));
  });

  it('answers null for a guest, and for an account with no seat on the visit (row 838)', () => {
    expect(S.subjectRecordOf(LAST(), undefined, null)).toBeNull();
    expect(S.subjectRecordOf(LAST(), undefined, IVO)).toBeNull();
    // A guest seat is never read as an account's, whatever its name says.
    const guest = visit(
      [
        seat('2026-09-04T10:00:00', {
          guest: 'ivo',
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
      ],
      BookingLifecycle.complete(WORKED_AT),
    );
    expect(S.subjectRecordOf(guest, undefined, IVO)).toBeNull();
  });
});

describe('VisitStorySystem.peerCountOf — the others on the visit', () => {
  it('counts the others of a party for each person (row 515)', () => {
    const party = PARTY();
    expect(S.peerCountOf(party, staffStory(party, GEORGI))).toBe(1);
    expect(S.peerCountOf(party, staffStory(party, IVO))).toBe(1);
    // The same answer as the row's composition of the two rules.
    expect(S.peerCountOf(party, staffStory(party, GEORGI))).toBe(
      peersOf(party, GEORGI),
    );
  });

  it('counts a guest by the seat’s name, once however many services they had (row 565)', () => {
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
    expect(S.peerCountOf(withGuest, staffStory(withGuest))).toBe(1);
  });

  it('counts nobody when the story is the whole party’s (row 235)', () => {
    const last = LAST();
    expect(S.peerCountOf(last, staffStory(last))).toBe(0);
    const party = PARTY();
    expect(
      S.peerCountOf(party, S.subjectStory(party, customerOf(GEORGI), false)),
    ).toBe(0);
  });
});

describe('VisitStorySystem.lastWorked — the featured visit', () => {
  type Row = {
    readonly id: string;
    readonly utcEpochMs: UtcEpochMs;
    readonly outcome: VisitRowOutcome | null;
  };
  const row = (
    id: string,
    ms: number,
    outcome: VisitRowOutcome | null,
  ): Row => ({ id, utcEpochMs: stamp(ms), outcome });
  const outcomeOf = (entry: Row) => entry.outcome;

  it('features the NEWEST worked visit, whatever order the page holds them in (glance 814)', () => {
    const rows = [
      row('older', 1_000, 'WORKED'),
      row('newest', 3_000, 'WORKED'),
      row('middle', 2_000, 'WORKED'),
    ];
    expect(S.lastWorked(rows, outcomeOf)?.id).toBe('newest');
  });

  it('skips a newer visit that was not worked (glance 871, 932)', () => {
    const rows = [
      row('worked', 1_000, 'WORKED'),
      row('cancelled', 4_000, 'CANCELLED'),
      row('missed', 3_000, 'NO_SHOW'),
      row('ahead', 5_000, 'OPEN'),
    ];
    expect(S.lastWorked(rows, outcomeOf)?.id).toBe('worked');
  });

  it('features nothing for a new client, or a book with nothing worked (glance 932)', () => {
    expect(S.lastWorked([], outcomeOf)).toBeNull();
    expect(
      S.lastWorked(
        [row('ahead', 5_000, 'OPEN'), row('waiting', 6_000, null)],
        outcomeOf,
      ),
    ).toBeNull();
  });

  it('keeps the input’s order on equal instants — a stable newest-first', () => {
    const rows = [
      row('first-in', 2_000, 'WORKED'),
      row('second-in', 2_000, 'WORKED'),
    ];
    expect(S.lastWorked(rows, outcomeOf)?.id).toBe('first-in');
    expect(S.lastWorked([...rows].reverse(), outcomeOf)?.id).toBe('second-in');
  });

  it('reads the outcomes newest first, never past the first worked one', () => {
    const rows = [
      row('a', 1_000, 'WORKED'),
      row('b', 4_000, 'CANCELLED'),
      row('c', 3_000, 'WORKED'),
      row('d', 2_000, 'WORKED'),
    ];
    const read: string[] = [];
    const found = S.lastWorked(rows, (entry) => {
      read.push(entry.id);
      return entry.outcome;
    });
    expect(found?.id).toBe('c');
    expect(read).toEqual(['b', 'c']);
  });

  it('reads the story the row tells — a companion’s visit worked for him, missed for Иво', () => {
    const party = PARTY();
    const earlier: Appointment = {
      ...LAST(),
      utcEpochMs: UtcEpochMs.plusMs(party.utcEpochMs, -86_400_000),
    };
    const book = [earlier, party];
    expect(
      S.lastWorked(
        book,
        (appointment) => staffStory(appointment, GEORGI).outcome,
      ),
    ).toBe(party);
    expect(
      S.lastWorked(book, (appointment) => staffStory(appointment, IVO).outcome),
    ).toBe(earlier);
  });
});

/*
 * WHAT SETTLED ONE CHAIR (pass C, S-7) — ported from the staff dashboard's
 * `resolutionOf`, with DEP-1: whose act a cancellation was is the side of
 * the seat called off LAST by the rule the card's rows and the statistics
 * read (reason first, the actor only for UNSPECIFIED/OTHER) — no longer
 * "the client's only when every seat says CLIENT".
 */
describe('VisitStorySystem.chairResolution — what settled one chair', () => {
  const cancelledSeat = (
    local: string,
    by: CancelledBy,
    reason: CancellationReason,
    id = `seat-${local}-${by}`,
  ) =>
    seat('2026-09-04T10:00:00', { id, outcome: cancelled(local, by, reason) });
  const noShowSeat = (local: string, id = `seat-ns-${local}`) =>
    seat('2026-09-04T10:00:00', {
      id,
      outcome: SeatOutcome.noShow(at(local)),
    });

  it('reads a desk-filed CLIENT_UNWELL as the client’s — the reason first (DEP-1, the sheet’s former «от салона»)', () => {
    const chair = [
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Staff,
        CancellationReason.ClientUnwell,
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, chair)).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledBy: 'CLIENT',
      atUtcMs: at('2026-09-04T10:00:00'),
      reasons: ['CLIENT_UNWELL'],
    });
  });

  it('reads a client-filed shop reason as the shop’s, and a converted no-show as the shop’s', () => {
    for (const reason of [
      CancellationReason.StaffShopClosure,
      CancellationReason.StaffBarberAbsence,
      CancellationReason.NoShowConverted,
    ]) {
      const chair = [
        cancelledSeat('2026-09-04T10:00:00', CancelledBy.Client, reason),
      ];
      expect(
        S.chairResolution(BookingStatus.Cancelled, chair)?.cancelledBy,
      ).toBe('SHOP');
    }
    const plans = [
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Staff,
        CancellationReason.ClientChangedPlans,
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, plans)?.cancelledBy).toBe(
      'CLIENT',
    );
  });

  it('reads UNSPECIFIED and OTHER by who filed them', () => {
    for (const reason of [
      CancellationReason.Unspecified,
      CancellationReason.Other,
    ]) {
      const byClient = [
        cancelledSeat('2026-09-04T10:00:00', CancelledBy.Client, reason),
      ];
      const byStaff = [
        cancelledSeat('2026-09-04T10:00:00', CancelledBy.Staff, reason),
      ];
      expect(
        S.chairResolution(BookingStatus.Cancelled, byClient)?.cancelledBy,
      ).toBe('CLIENT');
      expect(
        S.chairResolution(BookingStatus.Cancelled, byStaff)?.cancelledBy,
      ).toBe('SHOP');
    }
  });

  it('two seats: the latest stamp is the moment, and its seat’s side wins', () => {
    const chair = [
      cancelledSeat(
        '2026-09-04T11:30:00',
        CancelledBy.Client,
        CancellationReason.ClientChangedPlans,
        'a',
      ),
      cancelledSeat(
        '2026-09-04T09:15:00',
        CancelledBy.Staff,
        CancellationReason.StaffShopClosure,
        'b',
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, chair)).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledBy: 'CLIENT',
      atUtcMs: at('2026-09-04T11:30:00'),
      reasons: ['CLIENT_CHANGED_PLANS', 'STAFF_SHOP_CLOSURE'],
    });
  });

  it('two seats cancelled by different actors read the LAST one’s side, in both orders (DEP-1)', () => {
    const clientFirst = [
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Client,
        CancellationReason.Unspecified,
        'a',
      ),
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Staff,
        CancellationReason.Unspecified,
        'b',
      ),
    ];
    const staffFirst = [
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Staff,
        CancellationReason.Unspecified,
        'a',
      ),
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Client,
        CancellationReason.Unspecified,
        'b',
      ),
    ];
    // Client first, then the shop: «от салона», as before.
    expect(
      S.chairResolution(BookingStatus.Cancelled, clientFirst)?.cancelledBy,
    ).toBe('SHOP');
    // The shop first, then the client: «от клиента» (was «от салона»).
    expect(
      S.chairResolution(BookingStatus.Cancelled, staffFirst)?.cancelledBy,
    ).toBe('CLIENT');
    // The seat order does not decide — the stamps do.
    expect(
      S.chairResolution(BookingStatus.Cancelled, [...staffFirst].reverse())
        ?.cancelledBy,
    ).toBe('CLIENT');
  });

  it('is the root story’s side — composes rootStory', () => {
    const chair = [
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Staff,
        CancellationReason.Other,
        'a',
      ),
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Client,
        CancellationReason.StaffBarberAbsence,
        'b',
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, chair)?.cancelledBy).toBe(
      S.rootStory(BookingStatus.Cancelled, chair).cancelledBy,
    );
  });

  it('lists each reason once, in seat order; a reason nobody gave adds nothing', () => {
    const chair = [
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Client,
        CancellationReason.ClientUnwell,
        'a',
      ),
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Client,
        CancellationReason.Unspecified,
        'b',
      ),
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Client,
        CancellationReason.ClientUnwell,
        'c',
      ),
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Staff,
        CancellationReason.Other,
        'd',
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, chair)?.reasons).toEqual([
      'CLIENT_UNWELL',
      'OTHER',
    ]);
    const silent = [
      cancelledSeat(
        '2026-09-04T09:00:00',
        CancelledBy.Staff,
        CancellationReason.Unspecified,
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, silent)?.reasons).toEqual(
      [],
    );
  });

  it('a no-show is nobody’s act: no side, no reasons, the latest no-show stamp', () => {
    const chair = [
      noShowSeat('2026-09-04T10:00:00', 'a'),
      noShowSeat('2026-09-04T10:20:00', 'b'),
    ];
    expect(S.chairResolution(BookingStatus.NoShow, chair)).toEqual({
      bookingStatus: 'NO_SHOW',
      cancelledBy: null,
      atUtcMs: at('2026-09-04T10:20:00'),
      reasons: [],
    });
  });

  it('reads only the seats that match the chair’s status', () => {
    const mixed = [
      noShowSeat('2026-09-04T12:00:00', 'a'),
      cancelledSeat(
        '2026-09-04T10:00:00',
        CancelledBy.Client,
        CancellationReason.ClientUnwell,
        'b',
      ),
    ];
    expect(S.chairResolution(BookingStatus.Cancelled, mixed)).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledBy: 'CLIENT',
      atUtcMs: at('2026-09-04T10:00:00'),
      reasons: ['CLIENT_UNWELL'],
    });
    expect(S.chairResolution(BookingStatus.NoShow, mixed)).toEqual({
      bookingStatus: 'NO_SHOW',
      cancelledBy: null,
      atUtcMs: at('2026-09-04T12:00:00'),
      reasons: [],
    });
  });

  it('is null on a live or finished chair, and on a settled one with no matching stamp', () => {
    const scheduled = [seat('2026-09-04T10:00:00')];
    const worked = [
      seat('2026-09-04T10:00:00', { outcome: SeatOutcome.worked(WORKED_AT) }),
    ];
    for (const status of [
      BookingStatus.Pending,
      BookingStatus.Confirmed,
      BookingStatus.Completed,
    ]) {
      expect(S.chairResolution(status, worked)).toBeNull();
      expect(S.chairResolution(status, scheduled)).toBeNull();
    }
    expect(S.chairResolution(BookingStatus.Cancelled, scheduled)).toBeNull();
    expect(S.chairResolution(BookingStatus.NoShow, worked)).toBeNull();
    expect(S.chairResolution(BookingStatus.Cancelled, [])).toBeNull();
  });
});

/*
 * HAS THE VISIT BEGUN / ENDED (pass C, E-10, E-13) — the visit sheet's
 * `started` (its exits) and its frame's neighbour `past`, on the shop's
 * wall clock. NOW is 2026-09-28 12:00 (minute 720).
 */
describe('VisitListSystem.hasStarted / VisitStorySystem.hasEnded — on the shop’s wall clock', () => {
  it('has started at the start minute, after it, and on any earlier day', () => {
    expect(VisitListSystem.hasStarted(wall('2026-09-28T12:00:00'), NOW)).toBe(
      true,
    );
    expect(VisitListSystem.hasStarted(wall('2026-09-28T11:59:00'), NOW)).toBe(
      true,
    );
    expect(VisitListSystem.hasStarted(wall('2026-09-27T23:59:00'), NOW)).toBe(
      true,
    );
  });

  it('has not started a minute before, nor on a later day', () => {
    expect(VisitListSystem.hasStarted(wall('2026-09-28T12:01:00'), NOW)).toBe(
      false,
    );
    expect(VisitListSystem.hasStarted(wall('2026-09-29T00:00:00'), NOW)).toBe(
      false,
    );
  });

  it('is not `!isUpcoming` — at the start minute an open visit has begun AND is still upcoming', () => {
    const start = wall('2026-09-28T12:00:00');
    expect(VisitListSystem.hasStarted(start, NOW)).toBe(true);
    expect(S.isUpcoming('OPEN', start, NOW)).toBe(true);
  });

  it('has ended at the end minute, after it, and on any earlier day', () => {
    expect(S.hasEnded(wall('2026-09-28T12:00:00'), NOW)).toBe(true);
    expect(S.hasEnded(wall('2026-09-28T09:30:00'), NOW)).toBe(true);
    expect(S.hasEnded(wall('2026-09-27T23:59:00'), NOW)).toBe(true);
  });

  it('has not ended a minute before its end, nor on a later day', () => {
    expect(S.hasEnded(wall('2026-09-28T12:01:00'), NOW)).toBe(false);
    expect(S.hasEnded(wall('2026-09-29T00:00:00'), NOW)).toBe(false);
  });

  it('a visit ending at the closing midnight ends only once its day has gone', () => {
    const closing = {
      localDate: localDate('2026-09-28'),
      minute: endMinute(1440),
    };
    const lastMinute = ZonedTimeSystem.shopNow(
      at('2026-09-28T23:59:00'),
      FIXTURE_TIME_ZONE,
    );
    const nextDay = ZonedTimeSystem.shopNow(
      at('2026-09-29T00:00:00'),
      FIXTURE_TIME_ZONE,
    );
    expect(S.hasEnded(closing, lastMinute)).toBe(false);
    expect(S.hasEnded(closing, nextDay)).toBe(true);
  });
});

describe('VisitStorySystem.personKeyOf — one person, one key, off the seat', () => {
  it('keys an account by its id and a guest by the seat’s name — a whole seat passes straight in', () => {
    const account = seat('2026-09-04T10:00:00', { who: IVO });
    const guest = seat('2026-09-04T10:00:00', { guest: 'Мария' });
    expect(S.personKeyOf(account)).toBe('account:ivo');
    expect(S.personKeyOf(guest)).toBe('guest:Мария');
  });

  it('keys a companion and a self seat of one account alike — one person', () => {
    expect(
      S.personKeyOf(
        seat('2026-09-04T10:00:00', {
          who: IVO,
          relationship: SubjectRelationship.Companion,
        }),
      ),
    ).toBe(S.personKeyOf(seat('2026-09-04T10:00:00', { who: IVO })));
  });
});

describe('VisitStorySystem — the pass-C additions are pure', () => {
  it('same input → same output, inputs untouched', () => {
    const chair = deepFreeze([
      seat('2026-09-04T10:00:00', {
        id: 'p-a',
        outcome: cancelled(
          '2026-09-04T09:00:00',
          CancelledBy.Staff,
          CancellationReason.ClientUnwell,
        ),
      }),
      seat('2026-09-04T10:30:00', {
        id: 'p-b',
        outcome: cancelled(
          '2026-09-04T10:00:00',
          CancelledBy.Client,
          CancellationReason.Other,
        ),
      }),
    ]);
    const before = JSON.stringify(chair);
    expect(S.chairResolution(BookingStatus.Cancelled, chair)).toEqual(
      S.chairResolution(BookingStatus.Cancelled, chair),
    );
    const now = deepFreeze(NOW);
    const start = deepFreeze(wall('2026-09-28T12:00:00'));
    expect(VisitListSystem.hasStarted(start, now)).toBe(
      VisitListSystem.hasStarted(start, now),
    );
    expect(S.hasEnded(start, now)).toBe(S.hasEnded(start, now));
    expect(S.personKeyOf(chair[0] as Seat)).toBe(
      S.personKeyOf(chair[0] as Seat),
    );
    expect(JSON.stringify(chair)).toBe(before);
  });
});

describe('VisitStorySystem — the extraction, purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const party = deepFreeze({ ...PARTY(), voucherRedemptions: [draw(false)] });
    const story = deepFreeze(staffStory(party, GEORGI));
    const before = JSON.stringify([party, story]);
    expect(S.subjectFigure(party, story)).toEqual(
      S.subjectFigure(party, story),
    );
    expect(S.marksOf(party, story, 2)).toEqual(S.marksOf(party, story, 2));
    expect(S.subjectBarberIds(party, story)).toEqual(
      S.subjectBarberIds(party, story),
    );
    expect(S.peerCountOf(party, story)).toBe(S.peerCountOf(party, story));
    expect(S.isWholeParty(party, story)).toBe(S.isWholeParty(party, story));
    expect(S.quotesBooker(party, GEORGI)).toBe(S.quotesBooker(party, GEORGI));
    expect(S.subjectRecordOf(party, undefined, IVO)).toBe(
      S.subjectRecordOf(party, undefined, IVO),
    );
    const now = deepFreeze(NOW);
    const start = deepFreeze(wall('2026-10-02T10:00:00'));
    expect(S.toneOf('OPEN', start, now)).toBe(S.toneOf('OPEN', start, now));
    expect(S.statusMark('OPEN', BookingStatus.Pending)).toBe(
      S.statusMark('OPEN', BookingStatus.Pending),
    );
    expect(S.namesShop('WORKED', 2)).toBe(S.namesShop('WORKED', 2));
    expect(S.isVoid('NO_SHOW')).toBe(S.isVoid('NO_SHOW'));
    const book = deepFreeze([LAST(), party]);
    const pick = (appointment: Appointment) =>
      staffStory(appointment, GEORGI).outcome;
    expect(S.lastWorked(book, pick)).toBe(S.lastWorked(book, pick));
    expect(book.map((appointment) => appointment.id)).toHaveLength(2);
    expect(JSON.stringify([party, story])).toBe(before);
  });
});
