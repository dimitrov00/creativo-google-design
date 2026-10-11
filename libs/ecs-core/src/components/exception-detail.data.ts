import type { LocationId } from '@core/primitives';
import type { MinuteRange } from './minute-range.data';

/**
 * WHY a barber's roster does not apply on a day — the reasons the staff
 * editor knows (`schedule-exception.ts:36-51`). The ONLY source of these
 * strings, named after the field it types (`exceptionReason`, N15), and
 * in-memory vocabulary only: under §9 D16(b) the stored record is the public
 * `ExceptionEffectRule`, never a reason.
 */
export const ExceptionReason = {
  /** The shop is shut (a holiday, a refurb). */
  Closed: 'CLOSED',
  TimeOff: 'TIME_OFF',
  /** GDPR Art. 9 special-category data — never leaves the editor. */
  Sick: 'SICK',
  Training: 'TRAINING',
  Travel: 'TRAVEL',
  /** A one-off different shift; its ranges REPLACE the roster. */
  Hours: 'HOURS',
  /** A carve-out inside the roster (lunch). */
  Break: 'BREAK',
  /** An admin block inside the roster. */
  Admin: 'ADMIN',
} as const;
export type ExceptionReason =
  (typeof ExceptionReason)[keyof typeof ExceptionReason];

/**
 * The reasoned detail of an exception, as the staff editor holds it — an
 * INPUT to `ScheduleExceptionSystem.publicEffect`, never stored
 * (§9 D16(b)). Each variant is flat and carries only what it needs, every
 * variant field prefixed by its reason (`sickPaid`, `travelToLocationId`);
 * `exceptionRanges` are wall-clock minutes of the exception's day.
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
    return { exceptionReason: ExceptionReason.Closed };
  },
  timeOff(): ExceptionDetail.TimeOff {
    return { exceptionReason: ExceptionReason.TimeOff };
  },
  sick(sickPaid: boolean): ExceptionDetail.Sick {
    return { exceptionReason: ExceptionReason.Sick, sickPaid };
  },
  training(trainingTopic: string | null): ExceptionDetail.Training {
    return { exceptionReason: ExceptionReason.Training, trainingTopic };
  },
  travel(travelToLocationId: LocationId): ExceptionDetail.Travel {
    return { exceptionReason: ExceptionReason.Travel, travelToLocationId };
  },
  hours(exceptionRanges: readonly MinuteRange[]): ExceptionDetail.Hours {
    return { exceptionReason: ExceptionReason.Hours, exceptionRanges };
  },
  break(
    exceptionRanges: readonly MinuteRange[],
    breakPaid: boolean,
  ): ExceptionDetail.Break {
    return {
      exceptionReason: ExceptionReason.Break,
      exceptionRanges,
      breakPaid,
    };
  },
  admin(
    exceptionRanges: readonly MinuteRange[],
    adminNote: string,
  ): ExceptionDetail.Admin {
    return {
      exceptionReason: ExceptionReason.Admin,
      exceptionRanges,
      adminNote,
    };
  },
} as const;

export namespace ExceptionDetail {
  export type Closed = {
    readonly exceptionReason: typeof ExceptionReason.Closed;
  };
  export type TimeOff = {
    readonly exceptionReason: typeof ExceptionReason.TimeOff;
  };
  export type Sick = {
    readonly exceptionReason: typeof ExceptionReason.Sick;
    readonly sickPaid: boolean;
  };
  export type Training = {
    readonly exceptionReason: typeof ExceptionReason.Training;
    readonly trainingTopic: string | null;
  };
  export type Travel = {
    readonly exceptionReason: typeof ExceptionReason.Travel;
    readonly travelToLocationId: LocationId;
  };
  export type Hours = {
    readonly exceptionReason: typeof ExceptionReason.Hours;
    readonly exceptionRanges: readonly MinuteRange[];
  };
  export type Break = {
    readonly exceptionReason: typeof ExceptionReason.Break;
    readonly exceptionRanges: readonly MinuteRange[];
    readonly breakPaid: boolean;
  };
  export type Admin = {
    readonly exceptionReason: typeof ExceptionReason.Admin;
    readonly exceptionRanges: readonly MinuteRange[];
    readonly adminNote: string;
  };
}
