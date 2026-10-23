import {
  BookingStatus,
  Result,
  AttendanceState,
  type Currency,
  type BarberId,
  type ServiceId,
  type CustomerId,
  type UserId,
  LocalDate,
  type EndMinute,
  type MinuteOfDay,
  type PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { type SchedulingError } from '@core/errors';
import {
  type Money,
  type SeatOutcome,
  Seat,
  SeatSubject,
  ShopNow,
  VisitMark,
  VisitStatusMark,
  VisitTone,
  VoucherRedemption,
  WallTime,
} from '@core/components';
import type { Appointment } from '@core/entities';
import { BillingSystem } from './billing.system';
import { ClientStatsSystem, SubjectVisitOutcome } from './client-stats.system';
import { VisitRowOutcome } from './visit-list.system';

const DAYS_PER_WEEK = 7;

/** Who called a visit off, as the row says it — the ONLY source of these strings. */
export const CancelledSide = {
  Client: 'CLIENT',
  Shop: 'SHOP',
} as const;
export type CancelledSide = (typeof CancelledSide)[keyof typeof CancelledSide];

/**
 * The computed facts of one appointment — never words, and never a mirror
 * of an entity field a template can read itself (`bookingStatus`, the seats,
 * the visit's `localDate`). The span is the seats' own, first start to last
 * end, on the visit's shop day (Law 7.3: wall-clock coordinates, never an
 * instant); the money is the bill's, in cents of its one currency.
 */
export type VisitStory = {
  readonly localDate: LocalDate;
  /** The first seat's start. */
  readonly startMinutes: MinuteOfDay;
  /** The last seat's end (exclusive). */
  readonly endMinutes: EndMinute;
  /** What the party owes after its discounts (`BillingSystem`). */
  readonly totalCents: PriceCents;
  readonly currency: Currency;
  /** The barbers, each once, in first-seat order. */
  readonly barberIds: readonly BarberId[];
  /** The services, each once, in first-seat order. */
  readonly serviceIds: readonly ServiceId[];
};

/**
 * One person's own story of an appointment, as a row tells it: the seats
 * it is about (indexes into `appointment.seats`), their outcome, and who
 * called it off — set exactly when the outcome is `CANCELLED`.
 */
export type SubjectStory = {
  readonly seatIndexes: readonly number[];
  readonly outcome: VisitRowOutcome;
  readonly cancelledBy: CancelledSide | null;
};

/** Who a seat is for, as people are told apart on a visit — discriminated by `seatSubject`. */
export type PersonSubject =
  | {
      readonly seatSubject: typeof SeatSubject.Account;
      readonly userId: UserId;
    }
  | {
      readonly seatSubject: typeof SeatSubject.Anonymous;
      readonly label: string;
    };

/** A run of consecutive calendar days: indexes of its first and last day. */
export type DayRun = {
  readonly first: number;
  readonly last: number;
};

/** A cancellation as the side rule reads it. */
type SideBasis = Pick<
  SeatOutcome.Cancelled,
  'cancelledBy' | 'cancellationReason'
>;

function allIndexes(count: number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i);
  return out;
}

/** The seats a story is about, in its own order. */
function ownSeats(
  appointment: Appointment,
  story: SubjectStory,
): readonly Seat[] {
  const out: Seat[] = [];
  for (let i = 0; i < story.seatIndexes.length; i++) {
    out.push(appointment.seats[story.seatIndexes[i] as number] as Seat);
  }
  return out;
}

/** Who a seat is for, as people are told apart — the person read off the seat itself. */
function personSubjectOf(seat: Seat): PersonSubject {
  return seat.seatSubject === SeatSubject.Account
    ? { seatSubject: SeatSubject.Account, userId: seat.subjectUserId }
    : { seatSubject: SeatSubject.Anonymous, label: seat.guestLabel };
}

/**
 * VisitStorySystem — the facts a visit row is told from
 * (`libs/features/shared/visits/src/lib/visit-row.presenter.ts`): whose
 * seats, what became of them, who called it off, how many others came, the
 * runs of days a waiting request watches. Numbers, ids, indexes and tags —
 * `formatMoney`, `Intl.ListFormat` and every word stay in the presenter.
 * Time is the shop's wall clock (Law 7.3): a visit is upcoming by its
 * `WallTime` against the shop's `ShopNow`, a day by its `LocalDate`; only the
 * order of two cancellations reads their `*UtcMs` stamps (T2).
 */
export const VisitStorySystem = {
  /** The computed facts of an appointment; refused only for a bill it cannot have. */
  story(
    appointment: Pick<
      Appointment,
      'localDate' | 'seats' | 'discounts' | 'voucherRedemptions'
    >,
  ): Result<
    VisitStory,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const bill = BillingSystem.evaluate(appointment);
    if (!bill.ok) return bill;
    // The bill refuses a visit with no seat, so there is a first one.
    const seats = appointment.seats;
    const first = seats[0] as Seat;
    let startMinutes = first.startMinutes;
    let endMinutes = Seat.endMinutes(first);
    const barbers: BarberId[] = [];
    const services: ServiceId[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seat.startMinutes < startMinutes) startMinutes = seat.startMinutes;
      const end = Seat.endMinutes(seat);
      if (end > endMinutes) endMinutes = end;
      barbers.push(seat.barberId);
      services.push(seat.serviceId);
    }
    return Result.ok({
      localDate: appointment.localDate,
      startMinutes,
      endMinutes,
      totalCents: bill.value.totalCents,
      currency: bill.value.currency,
      barberIds: VisitStorySystem.distinct(barbers),
      serviceIds: VisitStorySystem.distinct(services),
    });
  },

  /**
   * The story a row tells. The staff row tells the SUBJECT's — the client
   * record the card is about (D29), its seats alone, so a companion's
   * no-show says nothing about the booker (the statistics' own reading,
   * `ClientStatsSystem.subjectVisitOf`); the client's list, a guest
   * (`null`) and a record with no seat on the visit tell the appointment's.
   */
  subjectStory(
    appointment: Appointment,
    subjectCustomerId: CustomerId | null,
    staff: boolean,
  ): SubjectStory {
    if (staff && subjectCustomerId !== null) {
      const visit = ClientStatsSystem.subjectVisitOf(
        subjectCustomerId,
        appointment,
      );
      if (visit !== null) {
        const indexes: number[] = [];
        for (let i = 0; i < appointment.seats.length; i++) {
          if (visit.seats.includes(appointment.seats[i] as Seat))
            indexes.push(i);
        }
        const outcome = visit.outcome;
        return {
          seatIndexes: indexes,
          outcome: rowOutcomeOf(outcome.subjectVisitOutcome),
          cancelledBy:
            outcome.subjectVisitOutcome === SubjectVisitOutcome.Cancelled
              ? VisitStorySystem.cancelledSide(outcome.decisive)
              : null,
        };
      }
    }
    return {
      seatIndexes: allIndexes(appointment.seats.length),
      ...VisitStorySystem.rootStory(
        appointment.bookingStatus,
        appointment.seats,
      ),
    };
  },

  /**
   * The appointment's own story from its root state: completed → worked,
   * no-show → no-show, cancelled → cancelled by the side of the seat called
   * off LAST, pending/confirmed → open. `outcomes` are the seats' outcome
   * slices — the seats themselves pass as they are.
   */
  rootStory(
    bookingStatus: BookingStatus,
    outcomes: readonly SeatOutcome[],
  ): Pick<SubjectStory, 'outcome' | 'cancelledBy'> {
    switch (bookingStatus) {
      case BookingStatus.Completed:
        return { outcome: VisitRowOutcome.Worked, cancelledBy: null };
      case BookingStatus.NoShow:
        return { outcome: VisitRowOutcome.NoShow, cancelledBy: null };
      case BookingStatus.Cancelled: {
        const atUtcMs: (UtcEpochMs | null)[] = [];
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i] as SeatOutcome;
          atUtcMs.push(
            outcome.attendanceState === AttendanceState.Cancelled
              ? outcome.cancelledAtUtcMs
              : null,
          );
        }
        const last = VisitStorySystem.decisiveCancellationIndex(atUtcMs);
        return {
          outcome: VisitRowOutcome.Cancelled,
          cancelledBy: VisitStorySystem.cancelledSide(
            last < 0 ? null : (outcomes[last] as SeatOutcome.Cancelled),
          ),
        };
      }
      case BookingStatus.Pending:
      case BookingStatus.Confirmed:
        return { outcome: VisitRowOutcome.Open, cancelledBy: null };
    }
  },

  /**
   * The seat called off LAST — the cancellation that ended the visit — as
   * an index into `cancelledAtUtcMs` (`null` for a seat not cancelled); the
   * first of equal instants wins; `−1` when none was. Stamp ORDER, not
   * placement (flatten-spec T2): the lifecycle instants are compared as they
   * were stamped.
   */
  decisiveCancellationIndex(
    cancelledAtUtcMs: readonly (UtcEpochMs | null)[],
  ): number {
    let best = -1;
    let bestAt: UtcEpochMs | null = null;
    for (let i = 0; i < cancelledAtUtcMs.length; i++) {
      const at = cancelledAtUtcMs[i] as UtcEpochMs | null;
      if (at === null) continue;
      if (bestAt === null || at > bestAt) {
        best = i;
        bestAt = at;
      }
    }
    return best;
  },

  /**
   * Who a cancellation is on — the rule the statistics count by
   * (`ClientStatsSystem.clientCaused`). A cancelled visit with no seat on
   * record holds nothing against the client: the shop's.
   */
  cancelledSide(cancellation: SideBasis | null): CancelledSide {
    return cancellation !== null && ClientStatsSystem.clientCaused(cancellation)
      ? CancelledSide.Client
      : CancelledSide.Shop;
  },

  /**
   * An hour still to come: open, and not yet started — its start on the
   * shop's wall clock at or after the shop's "now" (T1: `now.localDate` +
   * `now.currentMinute`, never an instant).
   */
  isUpcoming(outcome: VisitRowOutcome, start: WallTime, now: ShopNow): boolean {
    return (
      outcome === VisitRowOutcome.Open &&
      WallTime.compare(start, ShopNow.wallTime(now)) >= 0
    );
  },

  /** One person, one key: an account by its id, a guest by the seat's name. */
  personKeyOf(subject: PersonSubject): string {
    return subject.seatSubject === SeatSubject.Account
      ? `account:${subject.userId}`
      : `guest:${subject.label}`;
  },

  /**
   * The OTHER people on a visit — every seat not the row's own (`own[i]`),
   * counted once per person however many services they had.
   */
  peerCount(
    subjects: readonly PersonSubject[],
    own: readonly boolean[],
  ): number {
    const people = new Set<string>();
    for (let i = 0; i < subjects.length; i++) {
      if (own[i] === true) continue;
      people.add(VisitStorySystem.personKeyOf(subjects[i] as PersonSubject));
    }
    return people.size;
  },

  /** Present values, each once, in first-seen order (a brand stays its brand). */
  distinct<T extends string>(values: readonly (T | null)[]): readonly T[] {
    const seen = new Set<T>();
    const out: T[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] as T | null;
      if (value === null || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    return out;
  },

  /**
   * Runs of consecutive calendar days, in order — «чт, пт» reads «чт – пт»:
   * a day starts a new run unless it is the day after the previous one.
   */
  dayRuns(localDates: readonly LocalDate[]): readonly DayRun[] {
    const runs: DayRun[] = [];
    let previous = Number.NaN;
    for (let i = 0; i < localDates.length; i++) {
      const epochDay = LocalDate.toEpochDay(localDates[i] as LocalDate);
      const run = runs[runs.length - 1];
      if (run !== undefined && epochDay === previous + 1) {
        runs[runs.length - 1] = { first: run.first, last: i };
      } else {
        runs.push({ first: i, last: i });
      }
      previous = epochDay;
    }
    return runs;
  },

  /** Inside the coming week — today and the six days after it. Never without a today. */
  withinWeek(localDate: LocalDate, today: LocalDate | null): boolean {
    if (today === null) return false;
    const offset = LocalDate.daysBetween(today, localDate);
    return offset >= 0 && offset < DAYS_PER_WEEK;
  },

  /** A visit that did not happen — called off, or nobody came: its row struck, its tile hollow. */
  isVoid(outcome: VisitRowOutcome): boolean {
    return (
      outcome === VisitRowOutcome.Cancelled ||
      outcome === VisitRowOutcome.NoShow
    );
  },

  /**
   * How the row's day tile is drawn: a visit that did not happen is
   * `HOLLOW` whatever its day ({@link isVoid} wins), an hour still to come
   * `UPCOMING` ({@link isUpcoming}, on the shop's wall clock), anything else
   * `PAST`.
   */
  toneOf(outcome: VisitRowOutcome, start: WallTime, now: ShopNow): VisitTone {
    if (VisitStorySystem.isVoid(outcome)) return VisitTone.Hollow;
    return VisitStorySystem.isUpcoming(outcome, start, now)
      ? VisitTone.Upcoming
      : VisitTone.Past;
  },

  /**
   * The status a row or card names beside the visit: `NO_SHOW` on the row's
   * own no-show; on an hour still open, `PENDING` while the shop has not
   * confirmed it and `CONFIRMED` once it has (the stored `bookingStatus`);
   * `null` for anything else. Which surface words which mark is the
   * presenter's (the row words NO_SHOW and PENDING, else its cancellation
   * word; the card words PENDING and CONFIRMED on a visit to come).
   */
  statusMark(
    outcome: VisitRowOutcome,
    bookingStatus: BookingStatus,
  ): VisitStatusMark | null {
    if (outcome === VisitRowOutcome.NoShow) return VisitStatusMark.NoShow;
    if (outcome !== VisitRowOutcome.Open) return null;
    if (bookingStatus === BookingStatus.Pending) return VisitStatusMark.Pending;
    if (bookingStatus === BookingStatus.Confirmed) {
      return VisitStatusMark.Confirmed;
    }
    return null;
  },

  /** The story covers every seat — the person's seats ARE the party. */
  isWholeParty(appointment: Appointment, story: SubjectStory): boolean {
    return story.seatIndexes.length === appointment.seats.length;
  },

  /**
   * What the row's figure says, in cents of the bill's one currency — only
   * for a visit WORKED or CANCELLED (an open hour and a no-show carry none).
   * The bill (`BillingSystem.evaluate`, discounts taken off) when the story
   * is the whole party's; otherwise the subject's own seats' prices
   * (`BillingSystem.subtotalOf`) — a root discount is not pro-rated onto a
   * share (owner question Q2). `null` for a visit no bill can be read from
   * (no seat, two currencies — refused at every write).
   */
  subjectFigure(appointment: Appointment, story: SubjectStory): Money | null {
    if (
      story.outcome !== VisitRowOutcome.Worked &&
      story.outcome !== VisitRowOutcome.Cancelled
    ) {
      return null;
    }
    if (VisitStorySystem.isWholeParty(appointment, story)) {
      const bill = BillingSystem.evaluate(appointment);
      return bill.ok
        ? { amountCents: bill.value.totalCents, currency: bill.value.currency }
        : null;
    }
    const share = BillingSystem.subtotalOf(ownSeats(appointment, story));
    return share.ok ? share.value : null;
  },

  /**
   * The marks a row carries, in drawing order — only on a WORKED visit:
   * `PHOTOS` when it has any; `DISCOUNT` and `VOUCHER` only where the
   * figure beside them is the whole party's bill (a companion's share is
   * their seats' own prices, and the bill's discount is not in it) — the
   * discount when the bill holds one, the voucher when a draw on it still
   * stands (`VoucherRedemption.isLive`: a draw taken back settled nothing).
   */
  marksOf(
    appointment: Appointment,
    story: SubjectStory,
    photoCount: number,
  ): readonly VisitMark[] {
    const marks: VisitMark[] = [];
    if (story.outcome !== VisitRowOutcome.Worked) return marks;
    if (photoCount > 0) marks.push(VisitMark.Photos);
    if (!VisitStorySystem.isWholeParty(appointment, story)) return marks;
    if (appointment.discounts.length > 0) marks.push(VisitMark.Discount);
    if (appointment.voucherRedemptions.some(VoucherRedemption.isLive)) {
      marks.push(VisitMark.Voucher);
    }
    return marks;
  },

  /**
   * Are the visit's own words (its `contactNote`) the subject's to be
   * quoted? Only the booker's: a note, a subject account, and the visit
   * booked by that account. A guest (`null`) is never quoted — not even on
   * an unclaimed party whose owner is `null` too.
   */
  quotesBooker(
    appointment: Appointment,
    subjectUserId: UserId | null,
  ): boolean {
    return (
      appointment.contactNote !== null &&
      subjectUserId !== null &&
      appointment.ownerUserId === subjectUserId
    );
  },

  /** The shop is named only for a WORKED visit, and only where the tenant has more than one. */
  namesShop(outcome: VisitRowOutcome, locationCount: number): boolean {
    return outcome === VisitRowOutcome.Worked && locationCount > 1;
  },

  /** The barbers of the story's seats, each once, in first-seat order. */
  subjectBarberIds(
    appointment: Appointment,
    story: SubjectStory,
  ): readonly BarberId[] {
    const barbers: BarberId[] = [];
    for (let i = 0; i < story.seatIndexes.length; i++) {
      barbers.push(
        (appointment.seats[story.seatIndexes[i] as number] as Seat).barberId,
      );
    }
    return VisitStorySystem.distinct(barbers);
  },

  /**
   * The client record a row's story is about: the one the host named
   * (`null` names a guest), else — when the host named none (`undefined`)
   * — the record the ACCOUNT seat of `userId` links to
   * (`subjectCustomerId`, never a uid taken for a record); `null` for a
   * guest, and for an account with no seat on the visit (the
   * appointment's story then).
   */
  subjectRecordOf(
    appointment: Appointment,
    named: CustomerId | null | undefined,
    userId: UserId | null,
  ): CustomerId | null {
    if (named !== undefined) return named;
    if (userId === null) return null;
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (
        seat.seatSubject === SeatSubject.Account &&
        seat.subjectUserId === userId
      ) {
        return seat.subjectCustomerId;
      }
    }
    return null;
  },

  /**
   * The OTHER people on the visit — every seat the story is not about,
   * counted once per person (an account by its id, a guest by the seat's
   * name). Composes {@link peerCount} and {@link personKeyOf}: the person is
   * read off the seat itself. None when the story is the whole party's.
   */
  peerCountOf(appointment: Appointment, story: SubjectStory): number {
    if (VisitStorySystem.isWholeParty(appointment, story)) return 0;
    const seats = appointment.seats;
    const subjects: PersonSubject[] = [];
    const own: boolean[] = [];
    for (let i = 0; i < seats.length; i++) {
      subjects.push(personSubjectOf(seats[i] as Seat));
      own.push(false);
    }
    for (let i = 0; i < story.seatIndexes.length; i++) {
      own[story.seatIndexes[i] as number] = true;
    }
    return VisitStorySystem.peerCount(subjects, own);
  },

  /**
   * The newest visit that was WORKED: newest first by its instant
   * (`UtcEpochMs.compare` — a STABLE order, so equal instants keep the
   * input's order), the first whose `outcomeOf` is WORKED; `outcomeOf` is
   * called lazily in that order, never past the first WORKED. No subject
   * record, no staff flag and no exclusion here: the caller's row is the
   * outcome's source, and the caller drops the visit on screen first.
   * `null` when none was worked.
   */
  lastWorked<A extends { readonly utcEpochMs: UtcEpochMs }>(
    appointments: readonly A[],
    outcomeOf: (appointment: A) => VisitRowOutcome | null,
  ): A | null {
    const newestFirst = [...appointments].sort((a, b) =>
      UtcEpochMs.compare(b.utcEpochMs, a.utcEpochMs),
    );
    for (let i = 0; i < newestFirst.length; i++) {
      const appointment = newestFirst[i] as A;
      if (outcomeOf(appointment) === VisitRowOutcome.Worked) return appointment;
    }
    return null;
  },
} as const;

/**
 * One person's outcome as the row's — the same four states under the list's
 * own dictionary (`SubjectVisitOutcome` → `VisitRowOutcome`).
 */
function rowOutcomeOf(outcome: SubjectVisitOutcome): VisitRowOutcome {
  switch (outcome) {
    case SubjectVisitOutcome.Worked:
      return VisitRowOutcome.Worked;
    case SubjectVisitOutcome.NoShow:
      return VisitRowOutcome.NoShow;
    case SubjectVisitOutcome.Cancelled:
      return VisitRowOutcome.Cancelled;
    case SubjectVisitOutcome.Open:
      return VisitRowOutcome.Open;
  }
}
