import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingStatus } from '../components/booking-status.data';
import { DayKey } from '../components/day-key.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
} from '../components/seat-outcome.data';
import { SeatLabel } from '../components/seat-label.data';
import {
  type Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import {
  appointmentFixture,
  deepFreeze,
  seatFixture,
  unwrapOk,
} from '../testing';
import { VisitStorySystem } from './visit-story.system';
import { DstResolution, ZonedTimeSystem } from './zoned-time.system';

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
 */

const S = VisitStorySystem;
const ZONE = 'Europe/Sofia';

const at = (local: string): number =>
  unwrapOk(ZonedTimeSystem.parseIso(local, ZONE, DstResolution.Reject)).epochMs;

const GEORGI = UserId.of('georgi');
const IVO = UserId.of('ivo');
const IVAN = BarberId.of('barber-ivan');
const PETAR = BarberId.of('barber-petar');
const FADE = ServiceId.of('svc-fade');
const BEARD = ServiceId.of('svc-beard');
const WORKED_AT = at('2026-09-04T11:00:00');
const NOW = at('2026-09-28T12:00:00');

function seat(
  local: string,
  options: {
    readonly id?: string;
    readonly who?: UserId;
    readonly guest?: string;
    readonly relationship?: SeatRelationship;
    readonly service?: ServiceId;
    readonly barber?: BarberId;
    readonly priceMinor?: number;
    readonly outcome?: SeatOutcome;
  } = {},
): Seat {
  const terms = ServiceTerms.unpadded(options.priceMinor ?? 2750, 'EUR', 30);
  return seatFixture({
    id: SeatId.of(options.id ?? `seat-${local}`),
    serviceId: options.service ?? FADE,
    barberId: options.barber ?? IVAN,
    terms: {
      ...terms,
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    startMs: at(local),
    subject:
      options.guest !== undefined
        ? SeatSubject.anonymous(SeatLabel.of(options.guest))
        : SeatSubject.account(
            options.who ?? GEORGI,
            options.relationship ?? SeatRelationship.Self,
          ),
    outcome: options.outcome ?? SeatOutcome.scheduled(),
  });
}

function visit(
  seats: readonly Seat[],
  status: BookingStatus,
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  return appointmentFixture({ seats, bookingStatus: status, ...overrides });
}

const cancelled = (
  local: string,
  by: CancelledBy,
  reason: CancellationReason,
) => SeatOutcome.cancelled(at(local), by, reason, null);

/** The row's own story, as the staff card tells it of `subject`. */
const staffStory = (
  appointment: AppointmentEntity,
  subject: UserId | null = GEORGI,
) => S.subjectStory(appointment, subject, true);

/** The OTHER people on the visit, as the row counts them. */
function peersOf(
  appointment: AppointmentEntity,
  subject: UserId | null = GEORGI,
): number {
  const story = staffStory(appointment, subject);
  return S.peerCount(
    appointment.seats.map((entry) => entry.subject),
    appointment.seats.map((_, i) => story.seatIndexes.includes(i)),
  );
}

describe('visitRowOf · the staff card — the story', () => {
  it('strikes a cancellation, says who called it off and what was booked', () => {
    const called = visit(
      [
        seat('2026-07-16T10:00:00', {
          priceMinor: 1750,
          outcome: cancelled(
            '2026-07-15T18:00:00',
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
          ),
        }),
      ],
      BookingStatus.cancel(at('2026-07-15T18:00:00'), 'client_changed_plans'),
    );
    expect(staffStory(called)).toEqual({
      seatIndexes: [0],
      outcome: 'cancelled',
      cancelledBy: 'client',
    });
    // What was booked: the struck figure.
    expect(unwrapOk(S.story(called)).totalMinorUnits).toBe(1750);

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
      BookingStatus.cancel(at('2026-07-17T09:00:00'), 'staff_shop_closure'),
    );
    expect(staffStory(byShop).cancelledBy).toBe('shop');

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
          relationship: SeatRelationship.Companion,
          service: BEARD,
          barber: PETAR,
          outcome: cancelled(
            '2026-07-15T18:00:00',
            CancelledBy.Client,
            CancellationReason.ClientChangedPlans,
          ),
        }),
      ],
      BookingStatus.cancel(at('2026-07-15T18:00:00'), 'client_changed_plans'),
    );
    expect(staffStory(withCompany).cancelledBy).toBe('client');
    expect(peersOf(withCompany)).toBe(1);
  });

  it('strikes a no-show in full ink, the warning on the glyph, and prices nothing', () => {
    const noShow = visit(
      [
        seat('2026-07-07T10:00:00', {
          outcome: SeatOutcome.noShow(at('2026-07-07T10:20:00')),
        }),
      ],
      BookingStatus.noShow(at('2026-07-07T10:20:00')),
    );
    expect(staffStory(noShow)).toEqual({
      seatIndexes: [0],
      outcome: 'no_show',
      cancelledBy: null,
    });
  });

  it('files an hour still to come under «Предстоящи», saying when in the day — nothing paid yet', () => {
    const ahead = visit(
      [seat('2026-10-02T10:00:00')],
      BookingStatus.confirm(at('2026-09-20T10:00:00')),
    );
    const story = staffStory(ahead);
    expect(story.outcome).toBe('open');
    expect(S.isUpcoming(story.outcome, at('2026-10-02T10:00:00'), NOW)).toBe(
      true,
    );
    // An open hour already started is no longer ahead.
    expect(S.isUpcoming('open', at('2026-09-28T10:00:00'), NOW)).toBe(false);
    expect(S.isUpcoming('worked', at('2026-10-02T10:00:00'), NOW)).toBe(false);
  });

  it('says a request the shop has not confirmed is «Заявен»', () => {
    const pending = visit(
      [seat('2026-10-02T10:00:00')],
      BookingStatus.pending(at('2026-09-27T10:00:00')),
    );
    // Open — the word is the root status the template reads off the entity.
    expect(staffStory(pending).outcome).toBe('open');
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
          relationship: SeatRelationship.Companion,
          service: BEARD,
          barber: PETAR,
          priceMinor: 1200,
          outcome: SeatOutcome.noShow(WORKED_AT),
        }),
      ],
      // The legacy fixture's root discount is not pro-rated onto a share,
      // so the story below does not depend on it.
      BookingStatus.complete(WORKED_AT),
    );

    it('tells the subject’s own story — their seats, their outcome, their share, the others counted', () => {
      const georgi = staffStory(party, GEORGI);
      // A companion's no-show says nothing about the booker.
      expect(georgi).toEqual({
        seatIndexes: [0],
        outcome: 'worked',
        cancelledBy: null,
      });
      // His seat's own price: a root discount is not pro-rated (Q2).
      const own = georgi.seatIndexes.map((i) => party.seats.at(i) as Seat);
      expect(
        own.reduce((sum, entry) => sum + entry.terms.priceMinorUnits, 0),
      ).toBe(2750);
      // The face is of who cut HIS seat, not the companion's.
      expect(S.distinct(own.map((entry) => entry.barberId))).toEqual([IVAN]);
      expect(peersOf(party, GEORGI)).toBe(1);

      const ivo = staffStory(party, IVO);
      expect(ivo).toEqual({
        seatIndexes: [1],
        outcome: 'no_show',
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
        BookingStatus.complete(WORKED_AT),
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
          priceMinor: 1200,
          outcome: SeatOutcome.worked(WORKED_AT),
        }),
      ],
      BookingStatus.complete(WORKED_AT),
    );
    const story = unwrapOk(S.story(two));
    expect(story.serviceIds).toEqual([FADE, BEARD]);
    expect(story.barberIds).toEqual([IVAN, PETAR]);
    // Both seats are his: the figure is the bill.
    expect(staffStory(two).seatIndexes).toEqual([0, 1]);
    expect(story.totalMinorUnits).toBe(3950);
  });

  it('tells a guest’s visit as the appointment’s own, and quotes nobody', () => {
    const last = visit(
      [seat('2026-09-04T10:00:00', { outcome: SeatOutcome.worked(WORKED_AT) })],
      BookingStatus.complete(WORKED_AT),
    );
    expect(staffStory(last, null)).toEqual({
      seatIndexes: [0],
      outcome: 'worked',
      cancelledBy: null,
    });
    // A subject with no seat on it: the appointment's too.
    expect(staffStory(last, IVO).outcome).toBe('worked');
    // The client's own list always tells the appointment's.
    expect(S.subjectStory(last, IVO, false).seatIndexes).toEqual([0]);
  });
});

describe('waitlistRowOf — the days it watches', () => {
  const TODAY = DayKey.of('2026-09-28');
  const keys = (raw: readonly string[]) => raw.map((key) => DayKey.of(key));
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
    expect(S.withinWeek(leaving[0] as DayKey, TODAY)).toBe(true);
    expect(S.withinWeek(leaving[3] as DayKey, TODAY)).toBe(false);
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
          priceMinor: 1200,
        }),
        seat('2026-09-04T10:00:00'),
      ],
      BookingStatus.confirm(at('2026-09-01T10:00:00')),
    );
    const story = unwrapOk(S.story(two));
    expect(story.envelope).toEqual({
      startMs: at('2026-09-04T10:00:00'),
      endMs: at('2026-09-04T11:00:00'),
    });
    expect(story.currencyCode).toBe('EUR');
    expect(story.barberIds).toEqual([PETAR, IVAN]);
    expect(S.story(visit([], BookingStatus.confirm(0))).ok).toBe(false);
  });

  it('decides a cancelled visit by the seat called off last, the first of equal instants', () => {
    expect(S.decisiveCancellationIndex([null, 5, 9, 9, null])).toBe(2);
    expect(S.decisiveCancellationIndex([null, null])).toBe(-1);
    expect(
      S.rootStory('cancelled', [
        SeatOutcome.cancelled(
          1,
          CancelledBy.Staff,
          CancellationReason.StaffShopClosure,
          null,
        ),
        SeatOutcome.cancelled(
          2,
          CancelledBy.Client,
          CancellationReason.Unspecified,
          null,
        ),
      ]),
    ).toEqual({ outcome: 'cancelled', cancelledBy: 'client' });
    // A cancelled visit with no seat on record holds nothing against the client.
    expect(S.rootStory('cancelled', [SeatOutcome.scheduled()])).toEqual({
      outcome: 'cancelled',
      cancelledBy: 'shop',
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
          const days = sorted.map((day) => DayKey.fromEpochDay(day));
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
            relationship: SeatRelationship.Companion,
            outcome: SeatOutcome.noShow(WORKED_AT),
          }),
        ],
        BookingStatus.complete(WORKED_AT),
      ),
    );
    expect(S.story(party)).toEqual(S.story(party));
    expect(S.subjectStory(party, IVO, true)).toEqual(
      S.subjectStory(party, IVO, true),
    );
    const days = deepFreeze([DayKey.of('2026-10-01'), DayKey.of('2026-10-02')]);
    expect(S.dayRuns(days)).toEqual(S.dayRuns(days));
    expect(party.seats).toHaveLength(2);
  });
});
