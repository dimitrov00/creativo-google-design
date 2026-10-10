import type { LocationId } from '../entities/location.entity';
import type { MinuteRange } from './minute-range.data';

/**
 * WHY a barber's roster does not apply on a day — the reasons the staff
 * editor knows (`schedule-exception.ts:36-51`). The ONLY source of these
 * strings, and in-memory vocabulary only: under §9 D16(b) the stored record
 * is the public `ExceptionEffect`, never a reason.
 */
export const ExceptionReason = {
  /** The shop is shut (a holiday, a refurb). */
  Closed: 'closed',
  TimeOff: 'time_off',
  /** GDPR Art. 9 special-category data — never leaves the editor. */
  Sick: 'sick',
  Training: 'training',
  Travel: 'travel',
  /** A one-off different shift; its ranges REPLACE the roster. */
  Hours: 'hours',
  /** A carve-out inside the roster (lunch). */
  Break: 'break',
  /** An admin block inside the roster. */
  Admin: 'admin',
} as const;
export type ExceptionReason =
  (typeof ExceptionReason)[keyof typeof ExceptionReason];

/**
 * The reasoned detail of an exception, as the staff editor holds it — an
 * INPUT to `ScheduleExceptionSystem.publicEffect`, never stored
 * (§9 D16(b)). Each arm carries only what it needs; ranges are wall-clock
 * minutes of the exception's day.
 */
export type ExceptionDetail =
  | ExceptionDetail.Closed
  | ExceptionDetail.TimeOff
  | ExceptionDetail.Sick
  | ExceptionDetail.Training
  | ExceptionDetail.Travel
  | ExceptionDetail.Hours
  | ExceptionDetail.Break
  | ExceptionDetail.Admin;

export const ExceptionDetail = {
  closed(): ExceptionDetail.Closed {
    return { kind: ExceptionReason.Closed };
  },
  timeOff(): ExceptionDetail.TimeOff {
    return { kind: ExceptionReason.TimeOff };
  },
  sick(paid: boolean): ExceptionDetail.Sick {
    return { kind: ExceptionReason.Sick, paid };
  },
  training(topic: string | null): ExceptionDetail.Training {
    return { kind: ExceptionReason.Training, topic };
  },
  travel(toLocationId: LocationId): ExceptionDetail.Travel {
    return { kind: ExceptionReason.Travel, toLocationId };
  },
  hours(ranges: readonly MinuteRange[]): ExceptionDetail.Hours {
    return { kind: ExceptionReason.Hours, ranges };
  },
  break(ranges: readonly MinuteRange[], paid: boolean): ExceptionDetail.Break {
    return { kind: ExceptionReason.Break, ranges, paid };
  },
  admin(ranges: readonly MinuteRange[], note: string): ExceptionDetail.Admin {
    return { kind: ExceptionReason.Admin, ranges, note };
  },
} as const;

export namespace ExceptionDetail {
  export type Closed = { readonly kind: typeof ExceptionReason.Closed };
  export type TimeOff = { readonly kind: typeof ExceptionReason.TimeOff };
  export type Sick = {
    readonly kind: typeof ExceptionReason.Sick;
    readonly paid: boolean;
  };
  export type Training = {
    readonly kind: typeof ExceptionReason.Training;
    readonly topic: string | null;
  };
  export type Travel = {
    readonly kind: typeof ExceptionReason.Travel;
    readonly toLocationId: LocationId;
  };
  export type Hours = {
    readonly kind: typeof ExceptionReason.Hours;
    readonly ranges: readonly MinuteRange[];
  };
  export type Break = {
    readonly kind: typeof ExceptionReason.Break;
    readonly ranges: readonly MinuteRange[];
    readonly paid: boolean;
  };
  export type Admin = {
    readonly kind: typeof ExceptionReason.Admin;
    readonly ranges: readonly MinuteRange[];
    readonly note: string;
  };
}
