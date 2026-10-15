import {
  BookingStatus,
  Result,
  type SchedulingError,
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
  type UtcEpochMs,
} from '@core/primitives';
import {
  type SeatOutcome,
  Seat,
  SeatSubject,
  ShopNow,
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
