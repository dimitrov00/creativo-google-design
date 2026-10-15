import {
  Actor,
  BarberPreference,
  type BookingContact,
  CancellationReason,
  DiscountMethod,
  DiscountSource,
  mayBook,
  SeatLabel,
  SeatOutcome,
  VoucherCode,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingErrorCode,
  BookingStatus,
  CouponGrantId,
  DurationMinutes,
  LocationId,
  OperationId,
  PriceCents,
  type RepositoryError,
  RepositoryErrorCode,
  Result,
  SchedulingErrorCode,
  SeatId,
  ServiceId,
  ServiceVariantId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  MarkArrivalAction,
  type BookAppointmentAnswer,
  type BookAppointmentCommand,
  type BookAppointmentError,
  type BookSeatRequest,
  type CancelAppointmentAnswer,
  type CancelAppointmentCommand,
  type CancelAppointmentError,
  type EditAppointmentAnswer,
  type EditAppointmentCommand,
  type EditAppointmentError,
  type EditCommandInput,
  type MarkArrivalAnswer,
  type MarkArrivalCommand,
  type MarkArrivalError,
  type RecordSeatTipAnswer,
  type RecordSeatTipCommand,
  type RecordSeatTipError,
  type RescheduleAppointmentAnswer,
  type RescheduleAppointmentCommand,
  type RescheduleAppointmentError,
  type RescheduleSeatRequest,
  type StaffDiscountRequest,
  type TransitionAppointmentAnswer,
  type TransitionAppointmentCommand,
  type TransitionAppointmentError,
} from '@core/pipelines';
import {
  EditCommand,
  MoveSubjectRole,
  RequestedSubjectRole,
  ResizeEdge,
  StaffEditError,
  StaffEditErrorCode,
  ZonedTimeSystem,
} from '@core/systems';
import { isClientOperationId, isGuestKey } from '@creativo/application/booking';
import { type EdgeError, LegacyWireCode } from '../edge';
import { storeFailure } from './waitlist.wire';

/**
 * THE BOOKING CALLABLES' WIRE (flip 1, F1-3) — frozen in both directions
 * until Phase 4 flips it with `callableClient`.
 *
 * - **In:** one decoder per callable turns today's JSON into the pipeline
 *   command, reading every field as a primitive and nothing into existence:
 *   ids through their smart constructors (Law 7.4), an ISO-with-offset
 *   start through `ZonedTimeSystem.parseOffsetIso` (the pipeline reads it on
 *   the shop's clock with the location's zone — the ingestion boundary), the
 *   caller and their roles off the VERIFIED token, never the payload. The
 *   refusals a decoder answers itself — unauthenticated, forbidden, a
 *   payload that is no request — leave as today's codes.
 * - **Out:** one encoder per callable answers today's success JSON; one
 *   refusal per callable turns a pipeline refusal whose ecs-core code the
 *   shared table (`EDGE_WIRE`) would spell otherwise into the callable's own
 *   frozen code (`booking.cancel.not_found`, `booking.transition.not_allowed`
 *   with today's lower-case `from`/`to`, …); every other refusal goes
 *   through the table as it is. A store failure is no refusal: it is
 *   thrown, for the edge to track and answer as the callable's coded
 *   `internal` (`booking.commit.store_failed`) or the platform's bare one —
 *   exactly what an infrastructure throw answered before.
 */

/** What a decoder reads off a callable request — the payload and the verified token. */
export type WireRequest = {
  readonly auth?: { readonly uid?: string; readonly token?: object } | null;
  readonly data?: unknown;
};

type Payload = Readonly<Record<string, unknown>>;

function payloadOf(request: WireRequest): Payload {
  const data = request.data;
  return data !== null && typeof data === 'object' ? (data as Payload) : {};
}

/** A field of an untrusted object by name — no dynamic index. */
function field(source: unknown, name: string): unknown {
  return source !== null && typeof source === 'object'
    ? Object.getOwnPropertyDescriptor(source, name)?.value
    : undefined;
}

/** `String(x ?? '')` — today's reading of a text field. */
function text(source: unknown, name: string): string {
  const value = field(source, name);
  return value === undefined || value === null ? '' : String(value);
}

/** The verified caller's uid, or `null`. */
function callerOf(request: WireRequest): UserId | null {
  const uid = UserId.parse(request.auth?.uid ?? '');
  return uid.ok ? uid.value : null;
}

/** The `roles` claim as strings; none when it is no array (claims-tolerant). */
function rolesOf(request: WireRequest): readonly string[] {
  const roles = field(request.auth?.token, 'roles');
  return Array.isArray(roles) ? roles.map((role) => String(role)) : [];
}

/** Who the audit log says did this — the verified uid by its roles; `null` without one. */
export function actorOf(request: WireRequest): Actor | null {
  const uid = callerOf(request);
  if (uid === null) return null;
  const roles = field(request.auth?.token, 'roles');
  return Actor.forCaller(uid, Array.isArray(roles) ? roles : []);
}

/** A legacy wire refusal (`{ code }` / `{ code, params }`), as the shared table spells it. */
function legacy(
  code: LegacyWireCode,
  fields: Readonly<Record<string, unknown>> = {},
): EdgeError {
  return { code, ...fields };
}

/** An ISO-with-offset instant, or `null` when it does not parse. */
function instantOf(raw: unknown): UtcEpochMs | null {
  if (typeof raw !== 'string') return null;
  const instant = ZonedTimeSystem.parseOffsetIso(raw);
  return instant.ok ? instant.value : null;
}

/** An id through its smart constructor, or `null`. */
function idOf<T>(
  raw: unknown,
  parse: (value: string) => Result<T, unknown>,
): T | null {
  if (typeof raw !== 'string') return null;
  const parsed = parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** Every store failure's code — the infrastructure, never a refusal. */
const STORE_FAILURES: ReadonlySet<string> = new Set(
  Object.values(RepositoryErrorCode),
);

/**
 * Throws a store failure for the edge's unexpected path ({@link storeFailure});
 * any other refusal comes back narrowed.
 */
function refusalOf<E extends { readonly errorCode: string }>(
  error: E | RepositoryError,
): Exclude<E, RepositoryError> {
  if (STORE_FAILURES.has(error.errorCode)) {
    throw storeFailure(error as RepositoryError);
  }
  return error as Exclude<E, RepositoryError>;
}

/**
 * A refused field as today's wire spells it (F1-3). The pipelines and
 * systems name the field of their own struct — a seat start as its instant
 * (`startUtcMs`) or as a minute of the shop day (`startMinutes`), a resize
 * handle's instant (`atUtcMs`), the stored lifecycle (`bookingStatus`) —
 * and the frozen callable answers in the payload's words. A field missing
 * here leaves as it is.
 */
const WIRE_REFUSAL_FIELD: ReadonlyMap<string, string> = new Map([
  ['startUtcMs', 'startIso'],
  ['startMinutes', 'startIso'],
  ['atUtcMs', 'atIso'],
  ['bookingStatus', 'status'],
]);

/** The two refusals that name a field: the booking's invalid input, the edit's invalid command. */
const FIELD_REFUSALS: ReadonlySet<string> = new Set([
  BookingErrorCode.InvalidInput,
  StaffEditErrorCode.InvalidCommand,
]);

/** A refusal with its `field` in the wire's words — every other refusal unchanged. */
function inWireWords<E extends { readonly errorCode: string }>(error: E): E {
  if (!FIELD_REFUSALS.has(error.errorCode)) return error;
  const named = field(error, 'field');
  const spelled =
    typeof named === 'string' ? WIRE_REFUSAL_FIELD.get(named) : undefined;
  return spelled === undefined ? error : { ...error, field: spelled };
}

/**
 * A pipeline's result as the callable answers it: the answer encoded, a
 * refusal in the callable's own words (a store failure thrown on the way).
 */
export function settle<A, E, Out>(
  result: Result<A, E>,
  encode: (answer: A) => Out,
  refuse: (error: E) => EdgeError,
): Result<Out, EdgeError> {
  return result.ok
    ? Result.ok(encode(result.value))
    : Result.err(refuse(result.error));
}

/** The legacy lower-case status kinds, both ways. */
const LEGACY_STATUS: { readonly [S in BookingStatus]: string } = {
  [BookingStatus.Pending]: 'pending',
  [BookingStatus.Confirmed]: 'confirmed',
  [BookingStatus.Completed]: 'completed',
  [BookingStatus.NoShow]: 'no_show',
  [BookingStatus.Cancelled]: 'cancelled',
};

/** The verbs the shop's pen may name (`STAFF_TRANSITIONS`). */
const STAFF_TRANSITIONS: ReadonlyMap<string, BookingStatus> = new Map([
  ['confirmed', BookingStatus.Confirmed],
  ['completed', BookingStatus.Completed],
  ['no_show', BookingStatus.NoShow],
  ['cancelled', BookingStatus.Cancelled],
]);

function legacyStatus(status: BookingStatus): string {
  return LEGACY_STATUS[status];
}

/** A wire `barberPref` — what the client ASKED for; anything else is unknown, never guessed. */
function preferenceOf(raw: unknown): BarberPreference | null {
  if (raw === 'any') return BarberPreference.Any;
  if (raw === 'specific') return BarberPreference.Specific;
  return null;
}

// ── commitBooking ────────────────────────────────────────────────────────

/** A Firebase uid as a staff placement names one (`onBehalfOfUserId`). */
const ON_BEHALF_OF = /^[A-Za-z0-9_-]{1,128}$/;

/** The rebooking edge — dropped, never refused, when it does not fit. */
const BOOKED_FROM = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The contact, read as primitives and bounded before it reaches the
 * decision. Absent means absent (an old client never sends it); the
 * decision does the real validation.
 */
function contactOf(raw: unknown): BookingContact.Input | null {
  if (raw === null || typeof raw !== 'object') return null;
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
 * The seats, re-read as primitives and nothing defaulted into existence: a
 * missing id reaches the decision as `''` it refuses, never `"undefined"`.
 * A guest keeps its `guestKey` only when it has the key's shape.
 */
function bookSeatsOf(raw: unknown): readonly BookSeatRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: unknown): BookSeatRequest => {
    const subject = field(entry, 'subject');
    const variant = field(entry, 'variantId');
    const guestKey = field(subject, 'guestKey');
    return {
      lineId: text(entry, 'lineId'),
      serviceId: text(entry, 'serviceId'),
      variantId:
        variant === undefined || variant === null ? null : String(variant),
      barberId: text(entry, 'barberId'),
      barberPreference: preferenceOf(field(entry, 'barberPref')),
      startUtcMs: instantOf(text(entry, 'startIso')),
      subject:
        field(subject, 'kind') === 'guest'
          ? {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: text(subject, 'label'),
              guestKey: isGuestKey(guestKey) ? guestKey : null,
            }
          : { requestedSubjectRole: RequestedSubjectRole.Self },
    };
  });
}

export function decodeCommitBooking(
  request: WireRequest,
): Result<BookAppointmentCommand, EdgeError> {
  const payload = payloadOf(request);
  // STAFF PLACEMENT: `onBehalfOfUserId` present at all — a client's id, or
  // `null` for a walk-in — is the shop placing its own book.
  const staffPlacement = field(payload, 'onBehalfOfUserId') !== undefined;
  if (staffPlacement && !mayBook(rolesOf(request))) {
    return Result.err(legacy(LegacyWireCode.CommitForbidden));
  }
  const onBehalfOf = field(payload, 'onBehalfOfUserId');
  const named =
    typeof onBehalfOf === 'string' && ON_BEHALF_OF.test(onBehalfOf)
      ? UserId.of(onBehalfOf)
      : null;
  const attempt = field(payload, 'attemptId');
  const bookedFrom = field(payload, 'bookedFromAppointmentId');
  return Result.ok({
    locationId: text(payload, 'locationId'),
    seats: bookSeatsOf(field(payload, 'seats')),
    attemptId: isClientOperationId(attempt) ? AppointmentId.of(attempt) : null,
    bookedFromAppointmentId:
      typeof bookedFrom === 'string' && BOOKED_FROM.test(bookedFrom)
        ? AppointmentId.of(bookedFrom)
        : null,
    contact: contactOf(field(payload, 'contact')),
    ownerUserId: staffPlacement ? named : callerOf(request),
    staffPlacement,
    actor: actorOf(request),
  });
}

export function encodeCommitBookingAnswer(answer: BookAppointmentAnswer): {
  readonly appointmentId: string;
} {
  return { appointmentId: answer.appointmentId };
}

/** The commit's refusals all leave through the shared table, a refused field in the wire's words. */
export function commitBookingRefusal(error: BookAppointmentError): EdgeError {
  return inWireWords(refusalOf(error));
}

// ── cancelAppointment ────────────────────────────────────────────────────

export function decodeCancelAppointment(
  request: WireRequest,
): Result<CancelAppointmentCommand, EdgeError> {
  const caller = callerOf(request);
  if (caller === null) {
    return Result.err(legacy(LegacyWireCode.CancelUnauthenticated));
  }
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err(legacy(LegacyWireCode.CancelInvalidInput));
  }
  // The client's sentence files the cancellation as OTHER (code-only, D23);
  // nothing typed is UNSPECIFIED.
  const reason = text(payload, 'reason').trim();
  return Result.ok({
    appointmentId,
    callerUserId: caller,
    reason:
      reason.length > 0
        ? CancellationReason.Other
        : CancellationReason.Unspecified,
    actor: actorOf(request),
  });
}

export function encodeCancelAppointmentAnswer(
  answer: CancelAppointmentAnswer,
): { readonly appointmentId: string } {
  return { appointmentId: answer.appointmentId };
}

/** A visit that is not there — or not the caller's — is today's `booking.cancel.not_found`. */
export function cancelAppointmentRefusal(
  error: CancelAppointmentError,
): EdgeError {
  const refusal = refusalOf(error);
  return isAppointmentMiss(refusal)
    ? legacy(LegacyWireCode.CancelNotFound)
    : refusal;
}

/** The pipelines' "no such visit": invalid input naming `appointmentId`. */
function isAppointmentMiss(error: { readonly errorCode: string }): boolean {
  return (
    error.errorCode === BookingErrorCode.InvalidInput &&
    field(error, 'field') === 'appointmentId'
  );
}

// ── rescheduleAppointment ────────────────────────────────────────────────

function moveSeatsOf(raw: unknown): readonly RescheduleSeatRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: unknown): RescheduleSeatRequest => {
    const subject = field(entry, 'subject');
    const variant = field(entry, 'variantId');
    const guest = field(subject, 'kind') === 'guest';
    return {
      serviceId: text(entry, 'serviceId'),
      variantId:
        variant === undefined || variant === null ? null : String(variant),
      barberId: text(entry, 'barberId'),
      barberPreference: preferenceOf(field(entry, 'barberPref')),
      startUtcMs: instantOf(text(entry, 'startIso')),
      moveSubjectRole: guest ? MoveSubjectRole.Guest : MoveSubjectRole.Self,
      label: guest ? text(subject, 'label') : null,
    };
  });
}

export function decodeRescheduleAppointment(
  request: WireRequest,
): Result<RescheduleAppointmentCommand, EdgeError> {
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'appointmentId',
      detail: null,
      reason: null,
    });
  }
  const attempt = field(payload, 'attemptId');
  return Result.ok({
    appointmentId,
    callerUserId: callerOf(request),
    locationId: text(payload, 'locationId'),
    seats: moveSeatsOf(field(payload, 'seats')),
    attemptId: isClientOperationId(attempt) ? attempt : null,
    actor: actorOf(request),
  });
}

export function encodeRescheduleAppointmentAnswer(
  answer: RescheduleAppointmentAnswer,
): { readonly appointmentId: string } {
  return { appointmentId: answer.appointmentId };
}

/** The move's refusals — the commit's codes and its own — all leave through the shared table, a refused field in the wire's words. */
export function rescheduleAppointmentRefusal(
  error: RescheduleAppointmentError,
): EdgeError {
  return inWireWords(refusalOf(error));
}

// ── transitionAppointment ────────────────────────────────────────────────

/**
 * The cancel's reason: a lower-case legacy code (none is UNSPECIFIED), and
 * an `other` with nothing written refused as today — `null` when refused.
 */
function transitionReasonOf(
  code: string,
  note: string,
): CancellationReason | null {
  const trimmed = code.trim();
  if (trimmed !== trimmed.toLowerCase()) return null;
  const reason = SeatOutcome.reasonOf(trimmed);
  if (reason === null) return null;
  return reason === CancellationReason.Other && note.trim().length === 0
    ? null
    : reason;
}

export function decodeTransitionAppointment(
  request: WireRequest,
): Result<TransitionAppointmentCommand, EdgeError> {
  if (callerOf(request) === null) {
    return Result.err(legacy(LegacyWireCode.TransitionUnauthenticated));
  }
  // Deliberately NOT masked as not-found: the caller lacks the role.
  if (!mayBook(rolesOf(request))) {
    return Result.err(legacy(LegacyWireCode.TransitionForbidden));
  }
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  const to = STAFF_TRANSITIONS.get(text(payload, 'to')) ?? null;
  const seatText = text(payload, 'seatId').trim();
  const seatId = seatText.length === 0 ? null : idOf(seatText, SeatId.parse);
  const reason =
    to === BookingStatus.Cancelled
      ? transitionReasonOf(text(payload, 'reasonCode'), text(payload, 'note'))
      : null;
  if (
    appointmentId === null ||
    to === null ||
    (seatText.length > 0 && seatId === null) ||
    (to === BookingStatus.Cancelled && reason === null)
  ) {
    return Result.err(legacy(LegacyWireCode.TransitionInvalidInput));
  }
  return Result.ok({
    appointmentId,
    to,
    seatId,
    reason,
    actor: actorOf(request),
  });
}

export function encodeTransitionAppointmentAnswer(
  answer: TransitionAppointmentAnswer,
): { readonly appointmentId: string; readonly to: string } {
  return { appointmentId: answer.appointmentId, to: legacyStatus(answer.to) };
}

/** The lifecycle's refusals in the transition callable's own frozen words. */
export function transitionAppointmentRefusal(
  failure: TransitionAppointmentError,
  cmd: TransitionAppointmentCommand,
): EdgeError {
  const error = refusalOf(failure);
  if (isAppointmentMiss(error))
    return legacy(LegacyWireCode.TransitionNotFound);
  switch (error.errorCode) {
    case BookingErrorCode.SlotUnavailable:
      return legacy(LegacyWireCode.TransitionSlotTaken, {
        from: legacyStatus(BookingStatus.Cancelled),
        to: legacyStatus(BookingStatus.Confirmed),
      });
    case SchedulingErrorCode.AppointmentUnknownSeat:
      return legacy(LegacyWireCode.TransitionNotFound);
    case SchedulingErrorCode.AppointmentEmptyCancellationReason:
      return legacy(LegacyWireCode.TransitionInvalidInput);
    case SchedulingErrorCode.AppointmentInvalidTransition:
      // Confirming says nothing about the work: no per-seat meaning.
      return cmd.seatId !== null && cmd.to === BookingStatus.Confirmed
        ? legacy(LegacyWireCode.TransitionInvalidInput)
        : legacy(LegacyWireCode.TransitionNotAllowed, {
            from: legacyStatus(error.from),
            to: legacyStatus(error.to),
          });
    case SchedulingErrorCode.AppointmentSeatAlreadyResolved:
      return legacy(LegacyWireCode.TransitionNotAllowed, {
        from: 'resolved',
        to: legacyStatus(cmd.to),
      });
    case SchedulingErrorCode.AppointmentReopenWindowClosed:
      return legacy(LegacyWireCode.TransitionReopenWindowClosed, {
        from: legacyStatus(error.from),
        to: legacyStatus(cmd.to),
      });
    default:
      return error;
  }
}

// ── markArrived / clearArrival ───────────────────────────────────────────

/** Both arrival callables read one payload and refuse alike (`booking.arrived.*`). */
function arrivalOf(
  request: WireRequest,
  markArrivalAction: MarkArrivalAction,
): Result<MarkArrivalCommand, EdgeError> {
  if (callerOf(request) === null) {
    return Result.err(legacy(LegacyWireCode.ArrivedUnauthenticated));
  }
  if (!mayBook(rolesOf(request))) {
    return Result.err(legacy(LegacyWireCode.ArrivedForbidden));
  }
  const appointmentId = idOf(
    field(payloadOf(request), 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) {
    return Result.err(legacy(LegacyWireCode.ArrivedInvalidInput));
  }
  return Result.ok({
    markArrivalAction,
    appointmentId,
    actor: actorOf(request),
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

export function encodeMarkArrivedAnswer(answer: MarkArrivalAnswer): {
  readonly appointmentId: string;
  readonly alreadyArrived: boolean;
} {
  return {
    appointmentId: answer.appointmentId,
    alreadyArrived: answer.unchanged,
  };
}

export function encodeClearArrivalAnswer(answer: MarkArrivalAnswer): {
  readonly appointmentId: string;
  readonly alreadyClear: boolean;
} {
  return {
    appointmentId: answer.appointmentId,
    alreadyClear: answer.unchanged,
  };
}

/** A settled visit is today's `not_allowed` to `arrived` / `unarrived`. */
export function arrivalRefusal(
  failure: MarkArrivalError,
  to: 'arrived' | 'unarrived',
): EdgeError {
  const error = refusalOf(failure);
  if (isAppointmentMiss(error)) return legacy(LegacyWireCode.ArrivedNotFound);
  if (error.errorCode === SchedulingErrorCode.AppointmentNotArrivable) {
    return legacy(LegacyWireCode.ArrivedNotAllowed, {
      from: legacyStatus(error.bookingStatus),
      to,
    });
  }
  return error;
}

// ── recordSeatTip ────────────────────────────────────────────────────────

export function decodeRecordSeatTip(
  request: WireRequest,
): Result<RecordSeatTipCommand, EdgeError> {
  if (callerOf(request) === null) {
    return Result.err(legacy(LegacyWireCode.TipUnauthenticated));
  }
  if (!mayBook(rolesOf(request))) {
    return Result.err(legacy(LegacyWireCode.TipForbidden));
  }
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  const seatId = idOf(text(payload, 'seatId'), SeatId.parse);
  // `null` clears; anything else must be a whole, non-negative number of
  // cents — nothing is rounded into plausibility.
  const raw = field(payload, 'amountMinorUnits');
  const amount =
    raw === null || raw === undefined
      ? null
      : typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
        ? PriceCents.of(raw)
        : undefined;
  if (
    appointmentId === null ||
    seatId === null ||
    amount === undefined ||
    (amount !== null && !amount.ok)
  ) {
    return Result.err(legacy(LegacyWireCode.TipInvalidInput));
  }
  return Result.ok({
    appointmentId,
    seatId,
    tipCents: amount === null ? null : amount.value,
    actor: actorOf(request),
  });
}

export function encodeRecordSeatTipAnswer(answer: RecordSeatTipAnswer): {
  readonly appointmentId: string;
  readonly seatId: string;
  readonly unchanged: boolean;
} {
  return {
    appointmentId: answer.appointmentId,
    seatId: answer.seatId,
    unchanged: answer.unchanged,
  };
}

/** No such visit, or no such seat on it, is today's `booking.tip.not_found`. */
export function recordSeatTipRefusal(failure: RecordSeatTipError): EdgeError {
  const error = refusalOf(failure);
  return isAppointmentMiss(error) ||
    error.errorCode === SchedulingErrorCode.AppointmentUnknownSeat
    ? legacy(LegacyWireCode.TipNotFound)
    : error;
}

// ── staffEditAppointment ─────────────────────────────────────────────────

type CommandResult = Result<EditCommandInput, EdgeError>;

const invalid = (name: string): Result.Err<EdgeError> =>
  Result.err(StaffEditError.invalidCommand(name));

/** A non-empty string. */
function named(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A seat scope: absent is the whole party; present must be a non-empty list
 * of ids — an empty list or a bare string is never widened to everyone.
 */
function scopeOf(raw: unknown): readonly SeatId[] | null | undefined {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const ids: SeatId[] = [];
  for (const entry of raw) {
    const id = idOf(entry, SeatId.parse);
    if (id === null) return undefined;
    ids.push(id);
  }
  return ids;
}

/** A resize's instant to the nearest whole minute — the legacy fold's reading. */
function roundedInstantOf(raw: unknown): UtcEpochMs | null {
  const instant = instantOf(raw);
  if (instant === null) return null;
  const rounded = UtcEpochMs.of(Math.round(instant / 60_000) * 60_000);
  return rounded.ok ? rounded.value : null;
}

function discountsOf(raw: unknown): readonly StaffDiscountRequest[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StaffDiscountRequest[] = [];
  for (const entry of raw) {
    const source = field(entry, 'source');
    if (source === 'grant') {
      const grantId = field(entry, 'grantId');
      const id =
        typeof grantId === 'string' && grantId.trim().length > 0
          ? idOf(grantId, CouponGrantId.parse)
          : null;
      if (id === null) return null;
      out.push({ discountSource: DiscountSource.Grant, grantId: id });
    } else if (source === 'code') {
      const code = field(entry, 'code');
      const parsed =
        typeof code === 'string' && code.trim().length > 0
          ? VoucherCode.parseTyped(code)
          : null;
      if (parsed === null || !parsed.ok) return null;
      out.push({ discountSource: DiscountSource.Code, code: parsed.value });
    } else if (source === 'manual') {
      const value = field(entry, 'value');
      const kind = field(value, 'kind');
      const percent = field(value, 'percent');
      const amount = field(value, 'amountMinorUnits');
      // Whole numbers only, in the domain's ranges: 1–100 %, or positive cents.
      if (
        kind === 'percent_off' &&
        typeof percent === 'number' &&
        Number.isInteger(percent) &&
        percent > 0 &&
        percent <= 100
      ) {
        out.push({
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: percent,
        });
      } else if (
        kind === 'fixed_amount' &&
        typeof amount === 'number' &&
        Number.isInteger(amount) &&
        amount > 0
      ) {
        const cents = PriceCents.of(amount);
        if (!cents.ok) return null;
        out.push({
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.FixedAmount,
          discountAmountCents: cents.value,
        });
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  return out;
}

/** No blanks and no voucher twice — the second draw would be measured against a moved balance. */
function voucherCodesOf(raw: unknown): readonly VoucherCode[] | null {
  if (!Array.isArray(raw)) return null;
  const codes: VoucherCode[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return null;
    const code = VoucherCode.parseTyped(entry);
    if (!code.ok || codes.includes(code.value)) return null;
    codes.push(code.value);
  }
  return codes;
}

/**
 * One wire command shape-checked and decoded — every field a primitive,
 * nothing coerced into plausibility (`validateCommand`), the refusal naming
 * the field.
 */
function editCommandOf(raw: unknown): CommandResult {
  switch (field(raw, 'kind')) {
    case 'move': {
      const seatIds = scopeOf(field(raw, 'seatIds'));
      if (seatIds === undefined) return invalid('seatIds');
      const startUtcMs = instantOf(field(raw, 'startIso'));
      if (startUtcMs === null) return invalid('startIso');
      return Result.ok({ editCommand: EditCommand.Move, startUtcMs, seatIds });
    }
    case 'resize': {
      const edge = field(raw, 'edge');
      if (edge !== 'start' && edge !== 'end') return invalid('edge');
      const seatIds = scopeOf(field(raw, 'seatIds'));
      if (seatIds === undefined) return invalid('seatIds');
      const atUtcMs = roundedInstantOf(field(raw, 'atIso'));
      if (atUtcMs === null) return invalid('atIso');
      return Result.ok({
        editCommand: EditCommand.Resize,
        resizeEdge: edge === 'start' ? ResizeEdge.Start : ResizeEdge.End,
        atUtcMs,
        seatIds,
      });
    }
    case 'reprice': {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const price = field(raw, 'priceMinorUnits');
      const cents =
        typeof price === 'number' && Number.isInteger(price) && price >= 0
          ? PriceCents.of(price)
          : null;
      if (cents === null || !cents.ok) return invalid('priceMinorUnits');
      return Result.ok({
        editCommand: EditCommand.Reprice,
        seatId,
        priceCents: cents.value,
      });
    }
    case 'addSeat': {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const serviceId = idOf(field(raw, 'serviceId'), ServiceId.parse);
      if (serviceId === null) return invalid('serviceId');
      const barberId = idOf(field(raw, 'barberId'), BarberId.parse);
      if (barberId === null) return invalid('barberId');
      const startUtcMs = instantOf(field(raw, 'startIso'));
      if (startUtcMs === null) return invalid('startIso');
      const minutes = field(raw, 'minutes');
      const duration =
        typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0
          ? DurationMinutes.of(minutes)
          : null;
      if (duration === null || !duration.ok) return invalid('minutes');
      const subject = field(raw, 'subject');
      const label = field(subject, 'label');
      const guestLabel =
        field(subject, 'kind') === 'guest' && named(label)
          ? SeatLabel.parse(label)
          : null;
      if (
        field(subject, 'kind') !== 'self' &&
        (guestLabel === null || !guestLabel.ok)
      ) {
        return invalid('subject');
      }
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
        startUtcMs,
        durationMinutes: duration.value,
        addedSubject:
          guestLabel !== null && guestLabel.ok
            ? {
                requestedSubjectRole: RequestedSubjectRole.Guest,
                label: guestLabel.value,
              }
            : { requestedSubjectRole: RequestedSubjectRole.Self },
      });
    }
    case 'removeSeat': {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      return seatId === null
        ? invalid('seatId')
        : Result.ok({ editCommand: EditCommand.RemoveSeat, seatId });
    }
    case 'relocate': {
      const locationId = idOf(field(raw, 'locationId'), LocationId.parse);
      return locationId === null
        ? invalid('locationId')
        : Result.ok({ editCommand: EditCommand.Relocate, locationId });
    }
    case 'discounts': {
      const discounts = discountsOf(field(raw, 'discounts'));
      return discounts === null
        ? invalid('discounts')
        : Result.ok({ editCommand: EditCommand.Discounts, discounts });
    }
    case 'vouchers': {
      const codes = voucherCodesOf(field(raw, 'codes'));
      return codes === null
        ? invalid('vouchers')
        : Result.ok({ editCommand: EditCommand.Vouchers, codes });
    }
    case 'redurate': {
      const seatId = idOf(field(raw, 'seatId'), SeatId.parse);
      if (seatId === null) return invalid('seatId');
      const minutes = field(raw, 'minutes');
      const duration =
        typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0
          ? DurationMinutes.of(minutes)
          : null;
      if (duration === null || !duration.ok) return invalid('minutes');
      return Result.ok({
        editCommand: EditCommand.Redurate,
        seatId,
        durationMinutes: duration.value,
      });
    }
    case 'restaff': {
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
      return invalid('kind');
  }
}

export function decodeStaffEditAppointment(
  request: WireRequest,
): Result<EditAppointmentCommand, EdgeError> {
  if (callerOf(request) === null) {
    return Result.err({ errorCode: StaffEditErrorCode.Unauthenticated });
  }
  // `mayBook`, NOT `isStaff`: a content manager the rules refuse every
  // appointment READ is refused the book's writes too.
  const roles = rolesOf(request);
  if (!mayBook(roles)) return Result.err(StaffEditError.forbidden());
  const payload = payloadOf(request);
  const appointmentId = idOf(
    field(payload, 'appointmentId'),
    AppointmentId.parse,
  );
  if (appointmentId === null) return invalid('appointmentId');
  const operation = field(payload, 'operationId');
  let operationId: OperationId | null = null;
  if (operation !== undefined && operation !== null) {
    if (!isClientOperationId(operation)) return invalid('operationId');
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
  const rawCommand = field(payload, 'command');
  const arms: readonly unknown[] = Array.isArray(rawCommand)
    ? rawCommand
    : [rawCommand ?? {}];
  if (arms.length === 0) return invalid('command');
  const commands: EditCommandInput[] = [];
  for (const arm of arms) {
    const decoded = editCommandOf(arm);
    if (!decoded.ok) return decoded;
    commands.push(decoded.value);
  }
  return Result.ok({
    appointmentId,
    actorRoles: roles,
    commands,
    acknowledgedOverlap: field(payload, 'acknowledgedOverlap') === true,
    expectedVersion,
    operationId,
    actor: actorOf(request),
  });
}

export function encodeStaffEditAppointmentAnswer(
  answer: EditAppointmentAnswer,
): {
  readonly appointmentId: string;
  readonly revision: number;
} {
  return { appointmentId: answer.appointmentId, revision: answer.revision };
}

/** The legacy resize handle (`'start'` / `'end'`) an overlap names. */
const LEGACY_EDGE: { readonly [E in ResizeEdge]: string } = {
  [ResizeEdge.Start]: 'start',
  [ResizeEdge.End]: 'end',
};

/** The staff edit's refusals through the shared table — an overlap's handle and a refused field in today's words. */
export function staffEditAppointmentRefusal(
  failure: EditAppointmentError,
): EdgeError {
  const error = inWireWords(refusalOf(failure));
  if (error.errorCode === StaffEditErrorCode.Overlaps) {
    return {
      ...error,
      edge: error.edge === null ? null : LEGACY_EDGE[error.edge],
    };
  }
  return error;
}
