import {
  ArrivalVerb,
  BarberPreference,
  type BookingCall,
  type BookingContact,
  BookingLifecycle,
  CancellationReason,
  CouponValue,
  DiscountMethod,
  DiscountSource,
  EditCommand,
  MarkArrivalAction,
  Placement,
  RequestedSubjectRole,
  ResizeEdge,
  SeatLabel,
  VoucherCode,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  ClientOperationId,
  CouponGrantId,
  DurationMinutes,
  EndMinute,
  GuestKey,
  LocalDate,
  LocationId,
  MinuteOfDay,
  OperationId,
  PriceCents,
  Result,
  SeatId,
  ServiceId,
  ServiceVariantId,
  Tag,
  UserId,
} from '@core/primitives';
import {
  type BookAppointmentError,
  BookingError,
  BookingErrorCode,
  type CancelAppointmentError,
  CancellationRefusal,
  type EditAppointmentError,
  type MarkArrivalError,
  type RecordSeatTipError,
  type RescheduleAppointmentError,
  SchedulingErrorCode,
  StaffEditError,
  StaffEditErrorCode,
  type TransitionAppointmentError,
} from '@core/errors';
import {
  type BookAppointmentAnswer,
  type BookAppointmentCommand,
  type CancelAppointmentAnswer,
  type CancelAppointmentCommand,
  type EditAppointmentAnswer,
  type EditAppointmentCommand,
  type MarkArrivalAnswer,
  type MarkArrivalCommand,
  type RecordSeatTipAnswer,
  type RecordSeatTipCommand,
  type RescheduleAppointmentAnswer,
  type RescheduleAppointmentCommand,
  type TransitionAppointmentAnswer,
  type TransitionAppointmentCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import {
  callerActorAsClaimed,
  callerRoles,
  callerUserId,
  callerWorksTheBook,
} from '../lib/booking/caller-roles';
import {
  field,
  idOf,
  isRecord,
  listOf,
  numberOrNull,
  payloadOf,
  refusalOf,
  text,
  textOrNull,
  type WireRequest,
} from './wire-read';

/**
 * THE BOOKING CALLABLES' WIRE (Phase 4a 4A-4) — flipped with the web's
 * `callableClient`: the request is the call component `BookingCall` (its
 * seats and subjects in their raw twins, `BookingCall.SeatInput` /
 * `SubjectInput`, for the pipeline's own parsing order), the answer its
 * answer type, a refusal its ecs-core struct.
 *
 * - **In:** one decoder per callable reads the `unknown` payload as the call
 *   component, every field a primitive and nothing into existence: ids
 *   through their smart constructors (Law 7.4), every placement the shop's
 *   wall clock (`localDate` + minutes — the pipeline, having read the shop,
 *   places it on ITS zone, Law 7.3), SCREAMING discriminators, money in
 *   cents, the caller and their roles off the VERIFIED token. The refusals
 *   a decoder answers itself — unauthenticated, forbidden, a payload that is
 *   no request — are the ecs-core successors of the legacy codes.
 * - **Out:** one encoder per callable answers the call component's answer;
 *   one refusal function per callable turns a pipeline refusal whose meaning
 *   is the callable's own into its successor struct
 *   (`BOOKING_CANCEL_NOT_FOUND`, `BOOKING_TRANSITION_NOT_ALLOWED` with its
 *   SCREAMING `fromBookingStatus`/`toBookingStatus`, …); every other refusal
 *   leaves as itself, projected by the shared table (`EDGE_WIRE`). A store
 *   failure is no refusal: it is thrown, for the edge to track and answer as
 *   the callable's coded `internal` (`BOOKING_COMMIT_STORE_FAILED`) or the
 *   platform's bare one.
 */

/**
 * The states a lifecycle refusal names that the `BookingStatus` graph does
 * not — the callable's own words, SCREAMING beside the graph's values (the
 * web words them with its status table, its own for these).
 */
export const CallStateWord = {
  /** A seat whose story is over (served, no-show, cancelled). */
  Resolved: 'RESOLVED',
  /** The arrival `markArrived` asks for. */
  Arrived: ArrivalVerb.Arrived,
  /** The arrival `clearArrival` takes back. */
  Unarrived: ArrivalVerb.Unarrived,
} as const;
export type CallStateWord = (typeof CallStateWord)[keyof typeof CallStateWord];

/** A `barberPreference` — what the client ASKED for; anything else is unknown, never guessed. */
function preferenceOf(raw: unknown): BarberPreference | null {
  if (raw === BarberPreference.Any) return BarberPreference.Any;
  if (raw === BarberPreference.Specific) return BarberPreference.Specific;
  return null;
}

/** The pipelines' "no such visit": invalid input naming `appointmentId`. */
function isAppointmentMiss(error: { readonly errorCode: string }): boolean {
  return (
    error.errorCode === BookingErrorCode.InvalidInput &&
    field(error, 'field') === 'appointmentId'
  );
}

// ── The seats (commitBooking, rescheduleAppointment) ──────────────────────

/**
 * A seat's subject, raw: a guest by label (its `guestKey` kept only when it
 * has the key's shape — dropped, never refused), an account by id, else the
 * booker. A companion on a client cart is the decision's to refuse.
 */
function subjectOf(raw: unknown): BookingCall.SubjectInput {
  switch (field(raw, 'requestedSubjectRole')) {
    case RequestedSubjectRole.Guest: {
      const guestKey = field(raw, 'guestKey');
      return {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: text(raw, 'label'),
        guestKey: GuestKey.is(guestKey) ? guestKey : null,
      };
    }
    case RequestedSubjectRole.Companion:
      return {
        requestedSubjectRole: RequestedSubjectRole.Companion,
        companionUserId: text(raw, 'companionUserId'),
      };
    default:
      return { requestedSubjectRole: RequestedSubjectRole.Self };
  }
}

/**
 * The seats, re-read as primitives and nothing defaulted into existence: a
 * missing id reaches the decision as `''` it refuses, never `"undefined"`;
 * a start that is no number reaches it as `null`.
 */
function seatsOf(raw: unknown): readonly BookingCall.SeatInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: unknown): BookingCall.SeatInput => ({
    lineId: text(entry, 'lineId'),
    serviceId: text(entry, 'serviceId'),
    variantId: textOrNull(entry, 'variantId'),
    barberId: text(entry, 'barberId'),
    barberPreference: preferenceOf(field(entry, 'barberPreference')),
    startMinutes: numberOrNull(entry, 'startMinutes'),
    subject: subjectOf(field(entry, 'subject')),
  }));
}

// ── commitBooking ────────────────────────────────────────────────────────

/** A Firebase uid as a staff placement names one (`onBehalfOfUserId`). */
const ON_BEHALF_OF = /^[A-Za-z0-9_-]{1,128}$/;

/** The rebooking edge — dropped, never refused, when it does not fit. */
const BOOKED_FROM = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The contact, read as primitives and bounded before it reaches the
 * decision. Absent means absent; the decision does the real validation.
 */
function contactOf(raw: unknown): BookingContact.Input | null {
  if (!isRecord(raw)) return null;
  const bounded = (name: string, max: number): string => {
    const value = field(raw, name);
    return typeof value === 'string' ? value.slice(0, max) : '';
  };
  const name = bounded('name', 120);
  const phone = bounded('phone', 32);
  const email = bounded('email', 254);
  const note = bounded('note', 400);
  if (name.length === 0 && phone.length === 0) return null;
  return {
    name,
    phone,
    email: email.length > 0 ? email : null,
    note: note.length > 0 ? note : null,
  };
}

/**
 * Is this the SHOP placing its own book? The call says so itself
 * (`placement: 'STAFF'` — the staff day's create, a client it books for or
 * a walk-in) — or names a client to book for (`onBehalfOfUserId`), which
 * only the shop may. Anything else is a client's own booking, whoever
 * calls: a staff member booking from `/book` books for themselves, guests
 * only or not — today's two doors, now told apart by the call's own field
 * (the frozen wire read the presence of `onBehalfOfUserId`, which the
 * flipped wire always sends, 4A-4).
 */
function isStaffPlacement(placement: unknown, onBehalfOf: unknown): boolean {
  return (
    Placement.parse(placement) === Placement.Staff ||
    (onBehalfOf !== undefined && onBehalfOf !== null)
  );
}

export function decodeCommitBooking(
  request: WireRequest,
): Result<BookAppointmentCommand, EdgeError> {
  const payload = payloadOf(request);
  const seats = seatsOf(field(payload, 'seats'));
  const onBehalfOf = field(payload, 'onBehalfOfUserId');
  const staffPlacement = isStaffPlacement(
    field(payload, 'placement'),
    onBehalfOf,
  );
  if (staffPlacement && !callerWorksTheBook(request)) {
    return Result.err(BookingError.bare(BookingErrorCode.CommitForbidden));
  }
  const named =
    typeof onBehalfOf === 'string' && ON_BEHALF_OF.test(onBehalfOf)
      ? UserId.of(onBehalfOf)
      : null;
  const attempt = field(payload, 'attemptId');
  const bookedFrom = field(payload, 'bookedFromAppointmentId');
  return Result.ok({
    locationId: text(payload, 'locationId'),
    localDate: text(payload, 'localDate'),
    seats,
    attemptId: ClientOperationId.is(attempt) ? AppointmentId.of(attempt) : null,
    bookedFromAppointmentId:
      typeof bookedFrom === 'string' && BOOKED_FROM.test(bookedFrom)
        ? AppointmentId.of(bookedFrom)
        : null,
    contact: contactOf(field(payload, 'contact')),
    ownerUserId: staffPlacement ? named : callerUserId(request),
    staffPlacement,
    actor: callerActorAsClaimed(request),
  });
}

export function encodeCommitBookingAnswer(
  answer: BookAppointmentAnswer,
): BookingCall.Committed {
  return { appointmentId: answer.appointmentId };
}

/** The commit's refusals all leave as themselves, through the shared table. */
export function commitBookingRefusal(error: BookAppointmentError): EdgeError {
  return refusalOf(error);
}

// ── cancelAppointment ────────────────────────────────────────────────────

export function decodeCancelAppointment(
  request: WireRequest,
): Result<CancelAppointmentCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) return Result.err(CancellationRefusal.unauthenticated());
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err(CancellationRefusal.invalidInput('appointmentId'));
  }
  // The code the client files the cancellation under (code-only, D23).
  const reason = field(payload, 'reason');
  if (!Tag.has(CancellationReason, reason)) {
    return Result.err(CancellationRefusal.invalidInput('reason'));
  }
  return Result.ok({
    appointmentId,
    callerUserId: caller,
    reason,
    actor: callerActorAsClaimed(request),
  });
}

export function encodeCancelAppointmentAnswer(
  answer: CancelAppointmentAnswer,
): BookingCall.Cancelled {
  return { appointmentId: answer.appointmentId };
}

/** A visit that is not there — or not the caller's — is `BOOKING_CANCEL_NOT_FOUND`. */
export function cancelAppointmentRefusal(
  error: CancelAppointmentError,
  cmd: CancelAppointmentCommand,
): EdgeError {
  const refusal = refusalOf(error);
  return isAppointmentMiss(refusal)
    ? CancellationRefusal.notFound(cmd.appointmentId)
    : refusal;
}

// ── rescheduleAppointment ────────────────────────────────────────────────

export function decodeRescheduleAppointment(
  request: WireRequest,
): Result<RescheduleAppointmentCommand, EdgeError> {
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err(BookingError.invalidInput('appointmentId'));
  }
  const attempt = field(payload, 'attemptId');
  return Result.ok({
    appointmentId,
    callerUserId: callerUserId(request),
    locationId: text(payload, 'locationId'),
    localDate: text(payload, 'localDate'),
    seats: seatsOf(field(payload, 'seats')),
    attemptId: idOf(attempt, ClientOperationId.parse),
    actor: callerActorAsClaimed(request),
  });
}

export function encodeRescheduleAppointmentAnswer(
  answer: RescheduleAppointmentAnswer,
): BookingCall.Rescheduled {
  return { appointmentId: answer.appointmentId };
}

/** The move's refusals — the commit's codes and its own — all leave as themselves. */
export function rescheduleAppointmentRefusal(
  error: RescheduleAppointmentError,
): EdgeError {
  return refusalOf(error);
}

// ── transitionAppointment ────────────────────────────────────────────────

/**
 * A cancel's reason: one of the dictionary's values, `UNSPECIFIED` when the
 * shop names none — `null` when refused. CODE-ONLY (D23): `OTHER` stands on
 * its own; the words a barber types beside it are the visit's note
 * (`appointmentNotes`), written by the staff day after the cancel lands,
 * never carried here.
 */
function transitionReasonOf(raw: unknown): CancellationReason | null {
  if (raw === undefined || raw === null) return CancellationReason.Unspecified;
  return Tag.has(CancellationReason, raw) ? raw : null;
}

export function decodeTransitionAppointment(
  request: WireRequest,
): Result<TransitionAppointmentCommand, EdgeError> {
  if (callerUserId(request) === null) {
    return Result.err(
      BookingError.bare(BookingErrorCode.TransitionUnauthenticated),
    );
  }
  // Deliberately NOT masked as not-found: the caller lacks the role.
  if (!callerWorksTheBook(request)) {
    return Result.err(BookingError.bare(BookingErrorCode.TransitionForbidden));
  }
  const payload = payloadOf(request);
  const invalid = (name: string) =>
    Result.err(
      BookingError.callInvalidInput(
        BookingErrorCode.TransitionInvalidInput,
        name,
      ),
    );
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) return invalid('appointmentId');
  const raw = field(payload, 'toBookingStatus');
  const to = BookingLifecycle.isTransitionTarget(raw) ? raw : null;
  if (to === null) return invalid('toBookingStatus');
  const rawSeat = field(payload, 'seatId');
  const seatId =
    rawSeat === undefined || rawSeat === null
      ? null
      : idOf(rawSeat, SeatId.parse);
  if (rawSeat !== undefined && rawSeat !== null && seatId === null) {
    return invalid('seatId');
  }
  const reason =
    to === BookingStatus.Cancelled
      ? transitionReasonOf(field(payload, 'cancellationReason'))
      : null;
  if (to === BookingStatus.Cancelled && reason === null) {
    return invalid('cancellationReason');
  }
  return Result.ok({
    appointmentId,
    to,
    seatId,
    reason,
    actor: callerActorAsClaimed(request),
  });
}

export function encodeTransitionAppointmentAnswer(
  answer: TransitionAppointmentAnswer,
): BookingCall.Transitioned {
  return { appointmentId: answer.appointmentId, toBookingStatus: answer.to };
}

/** A state as the refusal names it: a `BookingStatus` value, else the callable's own word. */
function stateOf(raw: unknown): string {
  return Tag.has(BookingStatus, raw) ? raw : String(raw);
}

/** The lifecycle's refusals in the transition callable's own codes. */
export function transitionAppointmentRefusal(
  failure: TransitionAppointmentError,
  cmd: TransitionAppointmentCommand,
): EdgeError {
  const error = refusalOf(failure);
  if (isAppointmentMiss(error)) {
    return BookingError.callNotFound(
      BookingErrorCode.TransitionNotFound,
      cmd.appointmentId,
    );
  }
  switch (error.errorCode) {
    case BookingErrorCode.SlotUnavailable:
      return BookingError.statusMove(
        BookingErrorCode.TransitionSlotTaken,
        BookingStatus.Cancelled,
        BookingStatus.Confirmed,
      );
    case SchedulingErrorCode.AppointmentUnknownSeat:
      return BookingError.callNotFound(
        BookingErrorCode.TransitionNotFound,
        cmd.appointmentId,
      );
    case SchedulingErrorCode.AppointmentEmptyCancellationReason:
      return BookingError.callInvalidInput(
        BookingErrorCode.TransitionInvalidInput,
        'cancellationReason',
      );
    case SchedulingErrorCode.AppointmentInvalidTransition:
      // Confirming says nothing about the work: no per-seat meaning.
      return cmd.seatId !== null && cmd.to === BookingStatus.Confirmed
        ? BookingError.callInvalidInput(
            BookingErrorCode.TransitionInvalidInput,
            'seatId',
          )
        : BookingError.statusMove(
            BookingErrorCode.TransitionNotAllowed,
            stateOf(error.from),
            stateOf(error.to),
          );
    case SchedulingErrorCode.AppointmentSeatAlreadyResolved:
      return BookingError.statusMove(
        BookingErrorCode.TransitionNotAllowed,
        CallStateWord.Resolved,
        cmd.to,
      );
    case SchedulingErrorCode.AppointmentReopenWindowClosed:
      return BookingError.statusMove(
        BookingErrorCode.TransitionReopenWindowClosed,
        stateOf(error.from),
        cmd.to,
      );
    default:
      return error;
  }
}

// ── markArrived / clearArrival ───────────────────────────────────────────

/** Both arrival callables read one payload and refuse alike (`BOOKING_ARRIVED_*`). */
function arrivalOf(
  request: WireRequest,
  markArrivalAction: MarkArrivalAction,
): Result<MarkArrivalCommand, EdgeError> {
  if (callerUserId(request) === null) {
    return Result.err(
      BookingError.bare(BookingErrorCode.ArrivedUnauthenticated),
    );
  }
  if (!callerWorksTheBook(request)) {
    return Result.err(BookingError.bare(BookingErrorCode.ArrivedForbidden));
  }
  const appointmentId = idOf(
    field(payloadOf(request), 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err(
      BookingError.callInvalidInput(
        BookingErrorCode.ArrivedInvalidInput,
        'appointmentId',
      ),
    );
  }
  return Result.ok({
    markArrivalAction,
    appointmentId,
    actor: callerActorAsClaimed(request),
  });
}

export function decodeMarkArrived(
  request: WireRequest,
): Result<MarkArrivalCommand, EdgeError> {
  return arrivalOf(request, MarkArrivalAction.Arrive);
}

export function decodeClearArrival(
  request: WireRequest,
): Result<MarkArrivalCommand, EdgeError> {
  return arrivalOf(request, MarkArrivalAction.Clear);
}

export function encodeMarkArrivedAnswer(
  answer: MarkArrivalAnswer,
): BookingCall.Arrived {
  return {
    appointmentId: answer.appointmentId,
    alreadyArrived: answer.unchanged,
  };
}

export function encodeClearArrivalAnswer(
  answer: MarkArrivalAnswer,
): BookingCall.Cleared {
  return {
    appointmentId: answer.appointmentId,
    alreadyClear: answer.unchanged,
  };
}

/** A settled visit is `BOOKING_ARRIVED_NOT_ALLOWED` from its status to the arrival asked for. */
export function arrivalRefusal(
  failure: MarkArrivalError,
  cmd: MarkArrivalCommand,
): EdgeError {
  const error = refusalOf(failure);
  if (isAppointmentMiss(error)) {
    return BookingError.callNotFound(
      BookingErrorCode.ArrivedNotFound,
      cmd.appointmentId,
    );
  }
  if (error.errorCode === SchedulingErrorCode.AppointmentNotArrivable) {
    return BookingError.statusMove(
      BookingErrorCode.ArrivedNotAllowed,
      error.bookingStatus,
      cmd.markArrivalAction === MarkArrivalAction.Arrive
        ? CallStateWord.Arrived
        : CallStateWord.Unarrived,
    );
  }
  return error;
}

// ── recordSeatTip ────────────────────────────────────────────────────────

export function decodeRecordSeatTip(
  request: WireRequest,
): Result<RecordSeatTipCommand, EdgeError> {
  if (callerUserId(request) === null) {
    return Result.err(BookingError.bare(BookingErrorCode.TipUnauthenticated));
  }
  if (!callerWorksTheBook(request)) {
    return Result.err(BookingError.bare(BookingErrorCode.TipForbidden));
  }
  const payload = payloadOf(request);
  const invalid = (name: string) =>
    Result.err(
      BookingError.callInvalidInput(BookingErrorCode.TipInvalidInput, name),
    );
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) return invalid('appointmentId');
  const seatId = idOf(field(payload, 'seatId'), SeatId.parse);
  if (seatId === null) return invalid('seatId');
  // `null` clears; anything else must be a whole, non-negative number of
  // cents — nothing is rounded into plausibility.
  const raw = field(payload, 'amountCents');
  const amount =
    raw === null || raw === undefined
      ? null
      : typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
        ? PriceCents.of(raw)
        : undefined;
  if (amount === undefined || (amount !== null && !amount.ok)) {
    return invalid('amountCents');
  }
  return Result.ok({
    appointmentId,
    seatId,
    tipCents: amount === null ? null : amount.value,
    actor: callerActorAsClaimed(request),
  });
}

export function encodeRecordSeatTipAnswer(
  answer: RecordSeatTipAnswer,
): BookingCall.TipRecorded {
  return {
    appointmentId: answer.appointmentId,
    seatId: answer.seatId,
    unchanged: answer.unchanged,
  };
}

/** No such visit, or no such seat on it, is `BOOKING_TIP_NOT_FOUND`. */
export function recordSeatTipRefusal(
  failure: RecordSeatTipError,
  cmd: RecordSeatTipCommand,
): EdgeError {
  const error = refusalOf(failure);
  return isAppointmentMiss(error) ||
    error.errorCode === SchedulingErrorCode.AppointmentUnknownSeat
    ? BookingError.callNotFound(BookingErrorCode.TipNotFound, cmd.appointmentId)
    : error;
}

// ── staffEditAppointment ─────────────────────────────────────────────────

type CommandResult = Result<BookingCall.EditCommand, EdgeError>;

const invalid = (name: string): Result.Err<EdgeError> =>
  Result.err(StaffEditError.invalidCommand(name));

/** A non-empty string. */
function named(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A seat scope: `null` is the whole party; present must be a non-empty list
 * of ids — an empty list or a bare string is never widened to everyone.
 */
function scopeOf(raw: unknown): readonly SeatId[] | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const ids: SeatId[] = [];
  for (const entry of raw) {
    const id = idOf(entry, SeatId.parse);
    if (id === null) return undefined;
    ids.push(id);
  }
  return ids;
}

/** A shop day, or `null`. */
function dayOf(raw: unknown): LocalDate | null {
  return idOf(raw, LocalDate.parse);
}

/** A whole number through a primitive's own constructor, or `null`. */
function wholeOf<T>(
  raw: unknown,
  of: (value: number) => Result<T, unknown>,
): T | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  const parsed = of(raw);
  return parsed.ok ? parsed.value : null;
}

/**
 * A manual discount the counter typed, or `null`: its shape decoded here,
 * its range the companion's — a whole percent 1–100
 * (`CouponValue.manualPercentOff`, DEP-6) or a positive whole amount of
 * cents (`CouponValue.positiveAmount`, the figure `fixedAmount` guards).
 */
function manualDiscountOf(entry: unknown): BookingCall.StaffDiscount | null {
  switch (field(entry, 'discountMethod')) {
    case DiscountMethod.PercentOff: {
      const percent = field(entry, 'discountPercent');
      if (typeof percent !== 'number') return null;
      const value = CouponValue.manualPercentOff(percent);
      return value.ok
        ? {
            discountSource: DiscountSource.Manual,
            discountMethod: DiscountMethod.PercentOff,
            discountPercent: value.value.discountPercent,
          }
        : null;
    }
    case DiscountMethod.FixedAmount: {
      const cents = wholeOf(field(entry, 'discountAmountCents'), PriceCents.of);
      if (cents === null) return null;
      // Only the cents travel (`BookingCall.StaffDiscount`): the visit's own
      // currency is chosen when the batch is decided
      // (`BillingSystem.pendingDiscounts`).
      const amount = CouponValue.positiveAmount(cents);
      return amount.ok
        ? {
            discountSource: DiscountSource.Manual,
            discountMethod: DiscountMethod.FixedAmount,
            discountAmountCents: amount.value,
          }
        : null;
    }
    default:
      return null;
  }
}

function discountsOf(
  raw: unknown,
): readonly BookingCall.StaffDiscount[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BookingCall.StaffDiscount[] = [];
  for (const entry of raw) {
    switch (field(entry, 'discountSource')) {
      case DiscountSource.Grant: {
        const grantId = field(entry, 'grantId');
        const id =
          typeof grantId === 'string' && grantId.trim().length > 0
            ? idOf(grantId, CouponGrantId.parse)
            : null;
        if (id === null) return null;
        out.push({ discountSource: DiscountSource.Grant, grantId: id });
        break;
      }
      case DiscountSource.Code: {
        const code = field(entry, 'code');
        const parsed =
          typeof code === 'string' && code.trim().length > 0
            ? VoucherCode.parseTyped(code)
            : null;
        if (parsed === null || !parsed.ok) return null;
        out.push({ discountSource: DiscountSource.Code, code: parsed.value });
        break;
      }
      case DiscountSource.Manual: {
        const manual = manualDiscountOf(entry);
        if (manual === null) return null;
        out.push(manual);
        break;
      }
      default:
        return null;
    }
  }
  return out;
}

/**
 * A list of typed codes, decoded here; which vouchers it names is
 * `VoucherCode.distinct`'s — no blanks and no voucher twice (the second draw
 * would be measured against a moved balance).
 */
function voucherCodesOf(raw: unknown): readonly VoucherCode[] | null {
  if (
    !Array.isArray(raw) ||
    !raw.every((entry): entry is string => typeof entry === 'string')
  ) {
    return null;
  }
  const codes = VoucherCode.distinct(raw);
  return codes.ok ? codes.value : null;
}

/** Who an added seat is for: the owner, or a guest by a label the seat rules accept. */
function addedSubjectOf(raw: unknown): BookingCall.AddedSubject | null {
  switch (field(raw, 'requestedSubjectRole')) {
    case RequestedSubjectRole.Self:
      return { requestedSubjectRole: RequestedSubjectRole.Self };
    case RequestedSubjectRole.Guest: {
      const label = field(raw, 'label');
      const parsed = named(label) ? SeatLabel.parse(label) : null;
      return parsed === null || !parsed.ok
        ? null
        : {
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: parsed.value,
          };
    }
    default:
      return null;
  }
}

/**
 * One wire command shape-checked and decoded — every field a primitive,
 * every placement the shop's wall clock, nothing coerced into plausibility,
 * the refusal naming the field.
 */
function editCommandOf(raw: unknown): CommandResult {
  switch (field(raw, 'editCommand')) {
    case EditCommand.Move: {
      const seatIds = scopeOf(field(raw, 'seatIds'));
      if (seatIds === undefined) return invalid('seatIds');
      const localDate = dayOf(field(raw, 'localDate'));
      if (localDate === null) return invalid('localDate');
      const startMinutes = wholeOf(field(raw, 'startMinutes'), MinuteOfDay.of);
      if (startMinutes === null) return invalid('startMinutes');
      return Result.ok({
        editCommand: EditCommand.Move,
        localDate,
        startMinutes,
        seatIds,
      });
    }
    case EditCommand.Resize: {
      const edge = field(raw, 'resizeEdge');
      if (edge !== ResizeEdge.Start && edge !== ResizeEdge.End) {
        return invalid('resizeEdge');
      }
      const seatIds = scopeOf(field(raw, 'seatIds'));
      if (seatIds === undefined) return invalid('seatIds');
      const localDate = dayOf(field(raw, 'localDate'));
      if (localDate === null) return invalid('localDate');
      if (edge === ResizeEdge.Start) {
        const atMinutes = wholeOf(field(raw, 'atMinutes'), MinuteOfDay.of);
        if (atMinutes === null) return invalid('atMinutes');
        return Result.ok({
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.Start,
          localDate,
          atMinutes,
          seatIds,
        });
      }
      const atMinutes = wholeOf(field(raw, 'atMinutes'), EndMinute.of);
      if (atMinutes === null) return invalid('atMinutes');
      return Result.ok({
        editCommand: EditCommand.Resize,
        resizeEdge: ResizeEdge.End,
        localDate,
        atMinutes,
        seatIds,
      });
    }
    case EditCommand.Reprice: {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const price = field(raw, 'priceCents');
      const cents =
        typeof price === 'number' && Number.isInteger(price) && price >= 0
          ? PriceCents.of(price)
          : null;
      if (cents === null || !cents.ok) return invalid('priceCents');
      return Result.ok({
        editCommand: EditCommand.Reprice,
        seatId,
        priceCents: cents.value,
      });
    }
    case EditCommand.AddSeat: {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const serviceId = idOf(field(raw, 'serviceId'), ServiceId.parse);
      if (serviceId === null) return invalid('serviceId');
      const barberId = idOf(field(raw, 'barberId'), BarberId.parse);
      if (barberId === null) return invalid('barberId');
      const localDate = dayOf(field(raw, 'localDate'));
      if (localDate === null) return invalid('localDate');
      const startMinutes = wholeOf(field(raw, 'startMinutes'), MinuteOfDay.of);
      if (startMinutes === null) return invalid('startMinutes');
      const duration = wholeOf(
        field(raw, 'durationMinutes'),
        DurationMinutes.of,
      );
      if (duration === null) return invalid('durationMinutes');
      const addedSubject = addedSubjectOf(field(raw, 'addedSubject'));
      if (addedSubject === null) return invalid('addedSubject');
      const variant = field(raw, 'variantId');
      let variantId: ServiceVariantId | null = null;
      if (variant !== undefined && variant !== null) {
        variantId = named(variant)
          ? idOf(variant, ServiceVariantId.parse)
          : null;
        if (variantId === null) return invalid('variantId');
      }
      return Result.ok({
        editCommand: EditCommand.AddSeat,
        seatId,
        serviceId,
        variantId,
        barberId,
        localDate,
        startMinutes,
        durationMinutes: duration,
        addedSubject,
      });
    }
    case EditCommand.RemoveSeat: {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      return seatId === null
        ? invalid('seatId')
        : Result.ok({ editCommand: EditCommand.RemoveSeat, seatId });
    }
    case EditCommand.Relocate: {
      const locationId = idOf(field(raw, 'locationId'), LocationId.parse);
      return locationId === null
        ? invalid('locationId')
        : Result.ok({ editCommand: EditCommand.Relocate, locationId });
    }
    case EditCommand.Discounts: {
      const discounts = discountsOf(field(raw, 'discounts'));
      return discounts === null
        ? invalid('discounts')
        : Result.ok({ editCommand: EditCommand.Discounts, discounts });
    }
    case EditCommand.Vouchers: {
      const codes = voucherCodesOf(field(raw, 'codes'));
      return codes === null
        ? invalid('codes')
        : Result.ok({ editCommand: EditCommand.Vouchers, codes });
    }
    case EditCommand.Redurate: {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const duration = wholeOf(
        field(raw, 'durationMinutes'),
        DurationMinutes.of,
      );
      if (duration === null) return invalid('durationMinutes');
      return Result.ok({
        editCommand: EditCommand.Redurate,
        seatId,
        durationMinutes: duration,
      });
    }
    case EditCommand.Restaff: {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const barber = field(raw, 'barberId');
      const barberId =
        typeof barber === 'string' && barber.trim().length > 0
          ? idOf(barber, BarberId.parse)
          : null;
      if (barberId === null) return invalid('barberId');
      return Result.ok({ editCommand: EditCommand.Restaff, seatId, barberId });
    }
    default:
      return invalid('editCommand');
  }
}

export function decodeStaffEditAppointment(
  request: WireRequest,
): Result<EditAppointmentCommand, EdgeError> {
  if (callerUserId(request) === null) {
    return Result.err({ errorCode: StaffEditErrorCode.Unauthenticated });
  }
  // `mayBook`, NOT `isStaff`: a content manager the rules refuse every
  // appointment READ is refused the book's writes too.
  if (!callerWorksTheBook(request)) {
    return Result.err(StaffEditError.forbidden());
  }
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) return invalid('appointmentId');
  const operation = field(payload, 'operationId');
  let operationId: OperationId | null = null;
  if (operation !== undefined && operation !== null) {
    if (!ClientOperationId.is(operation)) return invalid('operationId');
    operationId = OperationId.of(operation);
  }
  const version = field(payload, 'expectedVersion');
  let expectedVersion: number | null = null;
  if (version !== undefined && version !== null) {
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 0
    ) {
      return invalid('expectedVersion');
    }
    expectedVersion = version;
  }
  const arms = listOf(payload, 'commands');
  if (arms.length === 0) return invalid('commands');
  const commands: BookingCall.EditCommand[] = [];
  for (const arm of arms) {
    const decoded = editCommandOf(arm);
    if (!decoded.ok) return decoded;
    commands.push(decoded.value);
  }
  return Result.ok({
    appointmentId,
    actorRoles: callerRoles(request),
    commands,
    acknowledgedOverlap: field(payload, 'acknowledgedOverlap') === true,
    expectedVersion,
    operationId,
    actor: callerActorAsClaimed(request),
  });
}

export function encodeStaffEditAppointmentAnswer(
  answer: EditAppointmentAnswer,
): BookingCall.StaffEdited {
  return { appointmentId: answer.appointmentId, revision: answer.revision };
}

/** The staff edit's refusals leave as themselves — an overlap with its SCREAMING `resizeEdge`. */
export function staffEditAppointmentRefusal(
  failure: EditAppointmentError,
): EdgeError {
  return refusalOf(failure);
}
