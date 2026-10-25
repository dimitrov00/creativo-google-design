import type {
  BarberId,
  EndMinute,
  LocalDate,
  MinuteOfDay,
} from '@core/primitives';
import type { BookingError } from './booking.error';
import type { RepositoryError } from './repository.error';
import type { TimeError } from './time.error';

/**
 * The staff edit's refusal codes (`staff-edit-appointment.errors.ts`) — the
 * ONLY source of these strings, the field `errorCode`. Moved here from
 * `appointment-edit.system.ts` (Law 7.5, Phase 4a 4A-6), with
 * `StaffEditOverlaps` from `edit-appointment.pipeline.ts`; the named unions
 * {@link StaffEditGuardRefusal} (from `appointment-edit.system.ts`) and
 * {@link EditAppointmentError} (from `edit-appointment.pipeline.ts`) joined
 * them in pass D (E-23). Every field beside `errorCode` is a scalar or a
 * brand — the errors tier imports only primitives.
 */
export const StaffEditErrorCode = {
  Unauthenticated: 'BOOKING_STAFF_EDIT_UNAUTHENTICATED',
  Forbidden: 'BOOKING_STAFF_EDIT_FORBIDDEN',
  /** `field` names the command's field. */
  InvalidCommand: 'BOOKING_STAFF_EDIT_INVALID_COMMAND',
  BeforeArrival: 'BOOKING_STAFF_EDIT_BEFORE_ARRIVAL',
  /** A collision the shop may acknowledge («Запази въпреки застъпването»). */
  Overlaps: 'BOOKING_STAFF_EDIT_OVERLAPS',
  /** The visit moved on since the intent was drawn. */
  Stale: 'BOOKING_STAFF_EDIT_STALE',
  InvariantViolated: 'BOOKING_STAFF_EDIT_INVARIANT_VIOLATED',
} as const;
export type StaffEditErrorCode =
  (typeof StaffEditErrorCode)[keyof typeof StaffEditErrorCode];

export type StaffEditInvalidCommand = {
  readonly errorCode: typeof StaffEditErrorCode.InvalidCommand;
  /** `editCommand`, `startMinutes`, `resizeEdge`, `seatId`, `seatIds`, `seats`, `discounts`, `vouchers`, `operationId`… — the call's field. */
  readonly field: string;
};
export type StaffEditForbidden = {
  readonly errorCode: typeof StaffEditErrorCode.Forbidden;
};
export type StaffEditStale = {
  readonly errorCode: typeof StaffEditErrorCode.Stale;
  readonly expected: number;
  readonly actual: number;
};

/**
 * The folded visit would END at or before its arrival stamp — a
 * DATA-INTEGRITY refusal, not a scheduling one: the stamp is the fact that
 * cannot move. Both points on the shop's wall clock — the visit's last end
 * on its day, the arrival as the boundary read it (T6).
 */
export type StaffEditBeforeArrival = {
  readonly errorCode: typeof StaffEditErrorCode.BeforeArrival;
  readonly localDate: LocalDate;
  readonly finishMinutes: EndMinute;
  readonly arrivalLocalDate: LocalDate;
  readonly arrivalMinutes: MinuteOfDay;
};

/**
 * A collision the shop may acknowledge — the barber and the start on the
 * shop's wall clock, and the handle a lone resize dragged (`resizeEdge`, a
 * `ResizeEdge` value as its plain string; `null` for anything else).
 */
export type StaffEditOverlaps = {
  readonly errorCode: typeof StaffEditErrorCode.Overlaps;
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly resizeEdge: string | null;
};

/** The refusals the edit's pure half can return. */
export type StaffEditError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival;

/**
 * What `AppointmentEditSystem.guard` refuses: a visit that never happened
 * (`BOOKING_INVALID_INPUT`, field `bookingStatus`), or one ending before its
 * arrival.
 */
export type StaffEditGuardRefusal =
  BookingError.InvalidInput | StaffEditBeforeArrival;

/**
 * What `editAppointment` answers with: the staff edit's own refusals, the
 * acknowledgeable overlap, the commit's `BookingError` (the re-decision
 * under the shop's rules), a wall clock the shop's zone never shows
 * (`TimeError`), or the store.
 */
export type EditAppointmentError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival
  | StaffEditOverlaps
  | BookingError
  | TimeError
  | RepositoryError;

export const StaffEditError = {
  invalidCommand(field: string): StaffEditInvalidCommand {
    return { errorCode: StaffEditErrorCode.InvalidCommand, field };
  },
  forbidden(): StaffEditForbidden {
    return { errorCode: StaffEditErrorCode.Forbidden };
  },
  stale(expected: number, actual: number): StaffEditStale {
    return { errorCode: StaffEditErrorCode.Stale, expected, actual };
  },
  beforeArrival(
    localDate: LocalDate,
    finishMinutes: EndMinute,
    arrivalLocalDate: LocalDate,
    arrivalMinutes: MinuteOfDay,
  ): StaffEditBeforeArrival {
    return {
      errorCode: StaffEditErrorCode.BeforeArrival,
      localDate,
      finishMinutes,
      arrivalLocalDate,
      arrivalMinutes,
    };
  },
  overlaps(
    barberId: BarberId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
    resizeEdge: string | null,
  ): StaffEditOverlaps {
    return {
      errorCode: StaffEditErrorCode.Overlaps,
      barberId,
      localDate,
      startMinutes,
      resizeEdge,
    };
  },
} as const;
