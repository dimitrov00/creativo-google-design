import { BookingState } from '../components/booking-status.data';
import { DayKey } from '../components/day-key.data';
import { Result } from '../components/result.data';
import type { SchedulingError } from '../components/scheduling-errors.data';
import {
  SeatOutcomeKind,
  type SeatOutcome,
} from '../components/seat-outcome.data';
import { Seat, SeatSubjectKind } from '../components/seat.data';
import { TimeInterval } from '../components/time-interval.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { ServiceId } from '../entities/service.entity';
import type { UserId } from '../entities/user.entity';
import { BillingSystem } from './billing.system';
import {
  ClientStatsSystem,
  SubjectVisitOutcomeKind,
} from './client-stats.system';
import { VisitRowOutcome } from './visit-list.system';

const DAYS_PER_WEEK = 7;

/** Who called a visit off, as the row says it — the ONLY source of these strings. */
export const CancelledSide = {
  Client: 'client',
  Shop: 'shop',
} as const;
export type CancelledSide = (typeof CancelledSide)[keyof typeof CancelledSide];

/**
 * The computed facts of one appointment — never words, and never a mirror
 * of an entity field a template can read itself (`bookingStatus.kind`, the
 * seats, the day key via `ZonedTimeSystem.dayKeyOf`).
 */
export type VisitStory = {
  /** First seat start to last seat end. */
  readonly envelope: TimeInterval;
  /** What the party owes after its discounts (`BillingSystem`). */
  readonly totalMinorUnits: number;
  readonly currencyCode: string;
  /** The barbers, each once, in first-seat order. */
  readonly barberIds: readonly BarberId[];
  /** The services, each once, in first-seat order. */
  readonly serviceIds: readonly ServiceId[];
};

/**
 * One person's own story of an appointment, as a row tells it: the seats
 * it is about (indexes into `appointment.seats`), their outcome, and who
 * called it off — set exactly when the outcome is `cancelled`.
 */
export type SubjectStory = {
  readonly seatIndexes: readonly number[];
  readonly outcome: VisitRowOutcome;
  readonly cancelledBy: CancelledSide | null;
};

/** Who a seat is for, as people are told apart on a visit. */
export type PersonSubject =
  | { readonly kind: typeof SeatSubjectKind.Account; readonly userId: string }
  | { readonly kind: typeof SeatSubjectKind.Anonymous; readonly label: string };

/** A run of consecutive calendar days: indexes of its first and last day. */
export type DayRun = {
  readonly first: number;
  readonly last: number;
};

/** A cancellation as the side rule reads it. */
type SideBasis = Pick<SeatOutcome.Cancelled, 'by' | 'reason'>;

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
 */
export const VisitStorySystem = {
  /** The computed facts of an appointment; refused only for a bill it cannot have. */
  story(
    appointment: AppointmentEntity,
  ): Result<
    VisitStory,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const bill = BillingSystem.evaluate(appointment);
    if (!bill.ok) return bill;
    const seats = appointment.seats;
    let startMs = Infinity;
    let endMs = -Infinity;
    const barbers: string[] = [];
    const services: string[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seat.startMs < startMs) startMs = seat.startMs;
      const end = Seat.endMs(seat);
      if (end > endMs) endMs = end;
      barbers.push(seat.barberId);
      services.push(seat.serviceId);
    }
    return Result.ok({
      envelope: TimeInterval.of(startMs, endMs),
      totalMinorUnits: bill.value.total.amountMinorUnits,
      currencyCode: bill.value.total.currencyCode,
      barberIds: VisitStorySystem.distinct(barbers) as readonly BarberId[],
      serviceIds: VisitStorySystem.distinct(services) as readonly ServiceId[],
    });
  },

  /**
   * The story a row tells. The staff row tells the SUBJECT's (their seats
   * alone, so a companion's no-show says nothing about the booker — the
   * statistics' own reading, `ClientStatsSystem.subjectVisitOf`); the
   * client's list, a guest (`null`) and a subject with no seat on the visit
   * tell the appointment's.
   */
  subjectStory(
    appointment: AppointmentEntity,
    subjectUserId: UserId | null,
    staff: boolean,
  ): SubjectStory {
    if (staff && subjectUserId !== null) {
      const visit = ClientStatsSystem.subjectVisitOf(
        subjectUserId,
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
          outcome: outcome.kind,
          cancelledBy:
            outcome.kind === SubjectVisitOutcomeKind.Cancelled
              ? VisitStorySystem.cancelledSide(outcome.decisive)
              : null,
        };
      }
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      outcomes.push((appointment.seats[i] as Seat).outcome);
    }
    return {
      seatIndexes: allIndexes(appointment.seats.length),
      ...VisitStorySystem.rootStory(appointment.bookingStatus.kind, outcomes),
    };
  },

  /**
   * The appointment's own story from its root status: completed → worked,
   * no-show → no-show, cancelled → cancelled by the side of the seat called
   * off LAST, pending/confirmed → open.
   */
  rootStory(
    status: BookingState,
    outcomes: readonly SeatOutcome[],
  ): Pick<SubjectStory, 'outcome' | 'cancelledBy'> {
    switch (status) {
      case BookingState.Completed:
        return { outcome: VisitRowOutcome.Worked, cancelledBy: null };
      case BookingState.NoShow:
        return { outcome: VisitRowOutcome.NoShow, cancelledBy: null };
      case BookingState.Cancelled: {
        const atMs: (number | null)[] = [];
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i] as SeatOutcome;
          atMs.push(
            outcome.kind === SeatOutcomeKind.Cancelled ? outcome.atMs : null,
          );
        }
        const last = VisitStorySystem.decisiveCancellationIndex(atMs);
        return {
          outcome: VisitRowOutcome.Cancelled,
          cancelledBy: VisitStorySystem.cancelledSide(
            last < 0 ? null : (outcomes[last] as SeatOutcome.Cancelled),
          ),
        };
      }
      case BookingState.Pending:
      case BookingState.Confirmed:
        return { outcome: VisitRowOutcome.Open, cancelledBy: null };
    }
  },

  /**
   * The seat called off LAST — the cancellation that ended the visit — as
   * an index into `cancelledAtMs` (`null` for a seat not cancelled); the
   * first of equal instants wins; `−1` when none was.
   */
  decisiveCancellationIndex(cancelledAtMs: readonly (number | null)[]): number {
    let best = -1;
    let bestAtMs = -Infinity;
    for (let i = 0; i < cancelledAtMs.length; i++) {
      const atMs = cancelledAtMs[i] as number | null;
      if (atMs === null) continue;
      if (best < 0 || atMs > bestAtMs) {
        best = i;
        bestAtMs = atMs;
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

  /** An hour still to come: open, and not yet started. */
  isUpcoming(
    outcome: VisitRowOutcome,
    startMs: number,
    nowMs: number,
  ): boolean {
    return outcome === VisitRowOutcome.Open && startMs >= nowMs;
  },

  /** One person, one key: an account by its id, a guest by the seat's name. */
  personKeyOf(subject: PersonSubject): string {
    return subject.kind === SeatSubjectKind.Account
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

  /** Present values, each once, in first-seen order. */
  distinct(values: readonly (string | null)[]): readonly string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] as string | null;
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
  dayRuns(dayKeys: readonly DayKey[]): readonly DayRun[] {
    const runs: DayRun[] = [];
    let previous = Number.NaN;
    for (let i = 0; i < dayKeys.length; i++) {
      const epochDay = DayKey.toEpochDay(dayKeys[i] as DayKey);
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
  withinWeek(dayKey: DayKey, todayKey: DayKey | null): boolean {
    if (todayKey === null) return false;
    const offset = DayKey.toEpochDay(dayKey) - DayKey.toEpochDay(todayKey);
    return offset >= 0 && offset < DAYS_PER_WEEK;
  },
} as const;
