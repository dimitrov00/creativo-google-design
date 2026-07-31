import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidBookingPolicyError } from './booking-policy.errors';

export interface BookingPolicyProps {
  /** People per booking, the booker included. */
  readonly maxPartySize: number;
  /** Candidate starts are aligned to this grid, in minutes. */
  readonly slotStepMinutes: number;
  /** How soon from now a booking may start — the shop needs warning. */
  readonly minLeadMinutes: number;
  /** How far ahead the calendar opens. */
  readonly horizonDays: number;
  /** Free cancellation window. */
  readonly cancellationWindowHours: number;
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
    readonly horizonDays: number,
    readonly cancellationWindowHours: number,
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
    positiveInt(props.horizonDays, 'horizonDays');
    nonNegativeInt(props.cancellationWindowHours, 'cancellationWindowHours');

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
        props.horizonDays,
        props.cancellationWindowHours,
      ),
    );
  }

  /**
   * The shipping defaults (owner ruling, 2026-07-29). 120 minutes' notice
   * keeps same-day walk-ups bookable — most of a barbershop's volume — while
   * giving the shop time to see the phone.
   */
  static default(): BookingPolicy {
    const result = BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 120,
      horizonDays: 60,
      cancellationWindowHours: 24,
    });
    if (result.isFailure()) throw new Error('unreachable: defaults are valid');
    return result.value;
  }
}
