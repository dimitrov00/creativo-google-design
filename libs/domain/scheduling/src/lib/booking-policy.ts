import { Result, fail, ok } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import { InvalidBookingPolicyError } from './booking-policy.errors';

export interface BookingPolicyProps {
  /** People per booking, the booker included. */
  readonly maxPartySize: number;
  /** Candidate starts are aligned to this grid, in minutes. */
  readonly slotStepMinutes: number;
  /** How soon from now a booking may start — the shop needs warning. */
  readonly minLeadMinutes: number;
  /**
   * How far ahead the calendar opens, in WHOLE MONTHS.
   *
   * Months rather than days because this is the number a shop owner actually
   * has an opinion about ("we take bookings two months out"), and because the
   * calendar it caps is a run of month grids: a 60-day horizon ends mid-March,
   * so the last month a client scrolls to is half live and half dead with no
   * explanation. A month horizon ends where a month ends.
   */
  readonly horizonMonths: number;
  /** Free cancellation window. */
  readonly cancellationWindowHours: number;
  /**
   * How many days one flexible request may span.
   *
   * Bounded because each declared day is a separate availability search and a
   * separate slice of any future matcher's work — "I'm free some time this
   * year" is not a request a shop can answer.
   */
  readonly maxFlexibleDays: number;
}

/**
 * Every number the booking flow used to hardcode, in one validated place.
 *
 * These are tenant policy, not domain invariants — a shop that wants
 * 30-minute granularity and a week's notice is not a different product. They
 * live here so the engine takes them as an argument rather than importing
 * constants, which is also what lets a test drive the engine at 5-minute
 * steps without touching production defaults.
 */
export class BookingPolicy {
  private constructor(
    readonly maxPartySize: number,
    readonly slotStepMinutes: number,
    readonly minLeadMinutes: number,
    readonly horizonMonths: number,
    readonly cancellationWindowHours: number,
    readonly maxFlexibleDays: number,
  ) {}

  static create(
    props: BookingPolicyProps,
  ): Result<BookingPolicy, InvalidBookingPolicyError[]> {
    const errors: InvalidBookingPolicyError[] = [];
    const positiveInt = (value: number, field: string) => {
      if (!Number.isInteger(value) || value <= 0) {
        errors.push(new InvalidBookingPolicyError(field, value));
      }
    };
    const nonNegativeInt = (value: number, field: string) => {
      if (!Number.isInteger(value) || value < 0) {
        errors.push(new InvalidBookingPolicyError(field, value));
      }
    };

    positiveInt(props.maxPartySize, 'maxPartySize');
    positiveInt(props.slotStepMinutes, 'slotStepMinutes');
    nonNegativeInt(props.minLeadMinutes, 'minLeadMinutes');
    positiveInt(props.horizonMonths, 'horizonMonths');
    nonNegativeInt(props.cancellationWindowHours, 'cancellationWindowHours');
    positiveInt(props.maxFlexibleDays, 'maxFlexibleDays');

    // A step that does not divide the hour produces a grid that drifts
    // against every human-readable time ("09:00, 09:25, 09:50…"), which reads
    // as a bug to anyone looking at it.
    if (
      Number.isInteger(props.slotStepMinutes) &&
      props.slotStepMinutes > 0 &&
      60 % props.slotStepMinutes !== 0
    ) {
      errors.push(
        new InvalidBookingPolicyError('slotStepMinutes', props.slotStepMinutes),
      );
    }

    if (errors.length > 0) return fail(errors);
    return ok(
      new BookingPolicy(
        props.maxPartySize,
        props.slotStepMinutes,
        props.minLeadMinutes,
        props.horizonMonths,
        props.cancellationWindowHours,
        props.maxFlexibleDays,
      ),
    );
  }

  private static _default: BookingPolicy | null = null;

  /**
   * The shipping defaults (owner ruling, 2026-07-29). 120 minutes' notice
   * keeps same-day walk-ups bookable — most of a barbershop's volume — while
   * giving the shop time to see the phone.
   *
   * MEMOIZED — one instance, always. This is not an optimization nicety: the
   * policy feeds reactive queries whose `switchMap`s key on object identity,
   * and a fresh instance per call meant every consumer that touched
   * `default()` re-derived its downstream (the schedule step tore down and
   * re-opened its whole listener set at least once per mount). A value
   * object with one set of values should be one value.
   */
  static default(): BookingPolicy {
    if (BookingPolicy._default) return BookingPolicy._default;
    const result = BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonMonths: 2,
      cancellationWindowHours: 24,
      maxFlexibleDays: 7,
    });
    if (result.isFailure()) throw new Error('unreachable: defaults are valid');
    BookingPolicy._default = result.value;
    return result.value;
  }

  /**
   * The last instant a client may still cancel for free — the appointment's
   * start minus the window. Defined HERE, once, because two consumers must
   * agree to the millisecond: the `cancelAppointment` callable refuses past
   * it, and the appointments page disables its button and names the deadline.
   * A rule enforced in one place and displayed from another is two rules.
   */
  cancellationDeadlineMs(appointmentStartMs: number): number {
    return appointmentStartMs - this.cancellationWindowHours * 3_600_000;
  }

  mayCancelAt(appointmentStartMs: number, nowMs: number): boolean {
    return nowMs <= this.cancellationDeadlineMs(appointmentStartMs);
  }

  /** Field-wise equality — what "the policy changed" actually means. */
  equals(other: BookingPolicy): boolean {
    return (
      this.maxPartySize === other.maxPartySize &&
      this.slotStepMinutes === other.slotStepMinutes &&
      this.minLeadMinutes === other.minLeadMinutes &&
      this.horizonMonths === other.horizonMonths &&
      this.cancellationWindowHours === other.cancellationWindowHours &&
      this.maxFlexibleDays === other.maxFlexibleDays
    );
  }

  /**
   * The last day anyone may book, counting from `today`.
   *
   * Walks whole months and lands on the LAST day of the final month, so a
   * two-month horizon opened on 31 January ends 31 March rather than the
   * 28th-of-February that naive month arithmetic produces by clamping. The
   * calendar this bounds renders whole months; ending one mid-grid would leave
   * a tail of dead cells that look like a shop with no availability rather
   * than like the edge of the booking window.
   */
  horizonEndFrom(today: CalendarDay): CalendarDay {
    let cursor = today;
    for (let month = 0; month < this.horizonMonths; month++) {
      cursor = cursor.endOfMonth().next();
    }
    return cursor.endOfMonth();
  }
}
