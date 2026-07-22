import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  InvalidTimeOfDayError,
  InvalidWorkingHoursRangeError,
} from './working-hours.errors';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface WorkingHoursRangeProps {
  start: string;
  end: string;
}

/**
 * A single day's `HH:mm`–`HH:mm` range — not a `ZonedDateTime`, a recurring
 * weekly schedule has no date component. This is `scheduling`'s own copy of
 * the pattern established in `libs/domain/models/src/lib/working-hours.ts`
 * (this repo's foundation pass) — re-created here rather than imported
 * because `scheduling` owns its own `Appointment`/booking model and does
 * not depend on the older `domain/models` lib.
 */
export class WorkingHoursRange {
  private constructor(
    readonly start: string,
    readonly end: string,
  ) {}

  static create(
    weekday: Weekday,
    props: WorkingHoursRangeProps,
  ): Result<
    WorkingHoursRange,
    InvalidTimeOfDayError | InvalidWorkingHoursRangeError
  > {
    if (!TIME_REGEX.test(props.start))
      return fail(new InvalidTimeOfDayError(props.start));
    if (!TIME_REGEX.test(props.end))
      return fail(new InvalidTimeOfDayError(props.end));
    // Zero-padded HH:mm strings compare correctly lexically.
    if (props.start >= props.end)
      return fail(new InvalidWorkingHoursRangeError(weekday));
    return ok(new WorkingHoursRange(props.start, props.end));
  }
}

export type WorkingHoursEntries = Partial<
  Record<Weekday, WorkingHoursRangeProps>
>;

/** A barber/location's recurring weekly schedule — a partial map from
 *  weekday to opening range (an absent day means closed). */
export class WorkingHours {
  private constructor(
    private readonly byWeekday: ReadonlyMap<Weekday, WorkingHoursRange>,
  ) {}

  static create(
    entries: WorkingHoursEntries,
  ): Result<
    WorkingHours,
    (InvalidTimeOfDayError | InvalidWorkingHoursRangeError)[]
  > {
    // `day` is always one of the seven hardcoded WEEKDAYS literals, never
    // external input — safe despite the object-injection lint heuristic.
    /* eslint-disable security/detect-object-injection */
    const pairs = WEEKDAYS.filter((day) => entries[day] !== undefined).map(
      (
        day,
      ): [
        Weekday,
        Result<
          WorkingHoursRange,
          InvalidTimeOfDayError | InvalidWorkingHoursRangeError
        >,
      ] => [
        day,
        WorkingHoursRange.create(day, entries[day] as WorkingHoursRangeProps),
      ],
    );
    /* eslint-enable security/detect-object-injection */

    // Iterate the day/result pairs directly rather than combining into a
    // flat array and re-zipping by index afterward — keeps each weekday
    // attached to its own Result the whole way through.
    const errors: (InvalidTimeOfDayError | InvalidWorkingHoursRangeError)[] =
      [];
    const byWeekday = new Map<Weekday, WorkingHoursRange>();
    for (const [day, result] of pairs) {
      if (result.isFailure()) {
        errors.push(result.error);
      } else {
        byWeekday.set(day, result.value);
      }
    }
    if (errors.length > 0) {
      return fail(errors);
    }
    return ok(new WorkingHours(byWeekday));
  }

  rangeFor(weekday: Weekday): WorkingHoursRange | null {
    return this.byWeekday.get(weekday) ?? null;
  }

  toEntries(): WorkingHoursEntries {
    const entries: WorkingHoursEntries = {};
    for (const [day, range] of this.byWeekday) {
      // eslint-disable-next-line security/detect-object-injection -- `day` comes from this instance's own Map keys (always a Weekday literal), never external input.
      entries[day] = { start: range.start, end: range.end };
    }
    return entries;
  }
}
