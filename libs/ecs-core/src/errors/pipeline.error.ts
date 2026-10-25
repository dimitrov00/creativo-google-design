import { Tag } from '@core/primitives';
import { BookingErrorCode } from './booking.error';
import { CancellationRefusalCode } from './cancellation.error';
import { CarriedSeatRefusal, MoveErrorCode } from './move.error';
import { StaffEditErrorCode } from './staff-edit.error';
import { WaitlistErrorCode } from './waitlist.error';

/**
 * Why a call into a pipeline from the other side of a boundary failed — the
 * `E` of the web's `callableClient` (`Promise<Result<Out, PipelineError>>`)
 * and of the outbound side-channel ports (`SendOtp`). One taxonomy in place
 * of the four duck-typed gateway copies (`BookingGatewayFailureCode`,
 * `WaitlistGatewayCode`, `OtpClientError`, `OtpSendError`), coarse on
 * purpose: each code names what the caller DOES next.
 *
 * The server's own ecs-core `errorCode` rides along as `serverErrorCode`
 * (with the reason one level down, `refusal` or `field`, and its allowlisted
 * scalar context as `serverParams`), so the UI can word the specific case —
 * tried `errors.<serverErrorCode>.<refusal|field>`, then
 * `errors.<serverErrorCode>`, then the surface's own generic key
 * (`wordPipelineError`) — while the flow branches on `errorCode` alone.
 * `wireStatus` is the `HttpsError` status the call failed with (`null` off
 * the wire): the OTP "blocked" reading is the status, not a code
 * ({@link PipelineError.isBlocked}).
 */

/**
 * The `HttpsError` statuses a callable can fail with — Firebase's
 * `FunctionsErrorCode` vocabulary (the web SDK's `FunctionsErrorCodeCore`,
 * the server's `https.FunctionsErrorCode`), all seventeen, verbatim. Values:
 * external contract (the Firebase callable protocol's status strings —
 * read off the wire here, answered by the functions edge), never
 * SCREAMING. The ONLY source of these strings: `PipelineError.wireStatus`
 * holds one, parsed once off the SDK's `functions/<status>` spelling.
 */
export const HttpsStatus = {
  InvalidArgument: 'invalid-argument',
  FailedPrecondition: 'failed-precondition',
  NotFound: 'not-found',
  AlreadyExists: 'already-exists',
  PermissionDenied: 'permission-denied',
  Unauthenticated: 'unauthenticated',
  ResourceExhausted: 'resource-exhausted',
  DeadlineExceeded: 'deadline-exceeded',
  Aborted: 'aborted',
  Unavailable: 'unavailable',
  Internal: 'internal',
  Ok: 'ok',
  Cancelled: 'cancelled',
  Unknown: 'unknown',
  OutOfRange: 'out-of-range',
  Unimplemented: 'unimplemented',
  DataLoss: 'data-loss',
} as const;
export type HttpsStatus = (typeof HttpsStatus)[keyof typeof HttpsStatus];

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const PipelineErrorCode = {
  /** Nobody (or not this person) is signed in — the next step is sign-in. */
  Unauthenticated: 'PIPELINE_UNAUTHENTICATED',
  /** The time shown was taken meanwhile — re-pick from a fresh grid. */
  SlotUnavailable: 'PIPELINE_SLOT_UNAVAILABLE',
  /** A service changed or left the catalog under the request. */
  CatalogChanged: 'PIPELINE_CATALOG_CHANGED',
  /** Refused as sent; repeating the same request cannot succeed. */
  InvalidRequest: 'PIPELINE_INVALID_REQUEST',
  /** Transient (network, store, delivery) — the same call later is the fix. */
  Unavailable: 'PIPELINE_UNAVAILABLE',
  /** Anything the other side did not classify. */
  Unknown: 'PIPELINE_UNKNOWN',
} as const;
export type PipelineErrorCode =
  (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode];

/**
 * A refusal's scalar context as the wire carried it — for interpolation
 * only, never branched on. Its key set per code is bounded by
 * {@link WIRE_PARAM_ALLOWLIST} (owner question §10.6, default: keep it,
 * bounded and pinned).
 */
export type WireParams = Readonly<
  Record<string, string | number | boolean | null>
>;

/** One shape for every code, so every error shares one hidden class. */
export type PipelineError = {
  readonly errorCode: PipelineErrorCode;
  /** The server's ecs-core `errorCode` (`BOOKING_SLOT_UNAVAILABLE`), if any. */
  readonly serverErrorCode: string | null;
  /** The reason one level down a refusal names (`barber_unavailable`), if any. */
  readonly refusal: string | null;
  /** The input field an invalid request names, if any. */
  readonly field: string | null;
  /**
   * The `HttpsError` status the call failed with (`permission-denied`);
   * `null` off the wire — or for a status outside Firebase's vocabulary,
   * which the SDK never hands (its `FunctionsError.code` is typed
   * `functions/<one of the seventeen>`).
   */
  readonly wireStatus: HttpsStatus | null;
  /** The refusal's allowlisted scalar context; `{}` when none. */
  readonly serverParams: WireParams;
};

/**
 * THE ALLOWLIST — per server `errorCode`, the struct fields that may leave
 * the server beside `errorCode`, `refusal` and `field` (Phase 4a 4A-4: each
 * `EDGE_WIRE` row's `wireParams` list of today, under the struct's own field
 * names — the ISO / CSV rendering dropped, the LIST kept). Only these ever
 * reach a `PipelineError`'s `serverParams`; a person key, a violation list,
 * a deadline a row does not name, a repository cause never does. A code
 * absent here carries none. ONE table: the edge projects through it, the
 * web reads through it.
 */
export const WIRE_PARAM_ALLOWLIST: {
  readonly [errorCode: string]: readonly string[];
} = {
  BOOKING_UNKNOWN_SERVICE: ['serviceId'],
  BOOKING_SERVICE_NOT_AT_LOCATION: ['serviceId', 'locationId'],
  BOOKING_CONFLICTING_SERVICES: ['first', 'second'],
  BOOKING_BARBER_NOT_ROSTERED: ['barberId', 'localDate'],
  BOOKING_SLOT_UNAVAILABLE: ['barberId', 'localDate', 'startMinutes'],
  BOOKING_TOO_SOON: ['minLeadMinutes'],
  BOOKING_BEYOND_HORIZON: ['horizonMonths'],
  BOOKING_PARTY_TOO_LARGE: ['maxPartySize'],
  BOOKING_TRANSITION_NOT_ALLOWED: ['fromBookingStatus', 'toBookingStatus'],
  BOOKING_TRANSITION_REOPEN_WINDOW_CLOSED: [
    'fromBookingStatus',
    'toBookingStatus',
  ],
  BOOKING_TRANSITION_SLOT_TAKEN: ['fromBookingStatus', 'toBookingStatus'],
  BOOKING_ARRIVED_NOT_ALLOWED: ['fromBookingStatus', 'toBookingStatus'],
  BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE: ['seatIds'],
  BOOKING_STAFF_EDIT_OVERLAPS: [
    'barberId',
    'localDate',
    'startMinutes',
    'resizeEdge',
  ],
  BOOKING_STAFF_EDIT_BEFORE_ARRIVAL: [
    'localDate',
    'finishMinutes',
    'arrivalLocalDate',
    'arrivalMinutes',
  ],
  BOOKING_STAFF_EDIT_STALE: ['expected', 'actual'],
  BOOKING_STAFF_EDIT_INVARIANT_VIOLATED: ['what'],
  BOOKING_CANCEL_WINDOW_CLOSED: ['windowHours'],
  BOOKING_WAITLIST_TOO_MANY_DAYS: ['max'],
  // The wall clock a spring-forward erased and the shop's zone — what the
  // copy names (`{{wallClock}}`, built from `localDate` + `minute`, and
  // `{{timeZone}}`); without them the refusal reads as a blank.
  DST_GAP_INVALID_TIME: ['localDate', 'minute', 'timeZone'],
  IDENTITY_INVALID_INPUT: ['reason'],
  IDENTITY_OTP_CHANNEL_MISMATCH: ['requested', 'authStrategyKind'],
  IDENTITY_BIRTH_DATE_INVALID: ['attempted'],
  IDENTITY_BIRTH_DATE_IN_FUTURE: ['attempted'],
  IDENTITY_BIRTH_DATE_TOO_YOUNG: ['age', 'minAge'],
  IDENTITY_BIRTH_DATE_TOO_OLD: ['age', 'maxAge'],
  PHONE_INVALID: ['attempted', 'reason'],
  PHONE_COUNTRY_UNSUPPORTED: ['attempted'],
  ACCOUNTS_BLOCK_REASON_INVALID: ['attempted'],
  ACCOUNTS_USER_ROLE_INVALID: ['attempted'],
  ACCOUNTS_FIRST_NAME_TOO_SHORT: ['attempted', 'minLength'],
  ACCOUNTS_LAST_NAME_TOO_SHORT: ['attempted', 'minLength'],
  ACCOUNTS_EMAIL_INVALID: ['attempted'],
};

/**
 * The `HttpsError` status → what the caller does next, when the server's
 * code has no row of its own in {@link CODE_OVERRIDES}.
 */
function codeOfStatus(status: HttpsStatus | null): PipelineErrorCode {
  switch (status) {
    case HttpsStatus.Unauthenticated:
      return PipelineErrorCode.Unauthenticated;
    case HttpsStatus.InvalidArgument:
    case HttpsStatus.FailedPrecondition:
    case HttpsStatus.NotFound:
    case HttpsStatus.PermissionDenied:
    case HttpsStatus.AlreadyExists:
    case HttpsStatus.OutOfRange:
      return PipelineErrorCode.InvalidRequest;
    case HttpsStatus.Unavailable:
    case HttpsStatus.Internal:
    case HttpsStatus.DeadlineExceeded:
    case HttpsStatus.ResourceExhausted:
      return PipelineErrorCode.Unavailable;
    default:
      return PipelineErrorCode.Unknown;
  }
}

const P = PipelineErrorCode;
const B = BookingErrorCode;
const C = CancellationRefusalCode;
const S = StaffEditErrorCode;
const W = WaitlistErrorCode;

/**
 * The per-code rows of today's four web adapters (`booking-gateway.adapter.ts`
 * `toFailureCode`, `waitlist-gateway.adapter.ts`, the OTP client, the streak
 * publish gateway), re-keyed one for one on the SCREAMING codes — product
 * behaviour, pinned row by row in `pipeline.error.spec.ts` (R5).
 */
const CODE_OVERRIDES: {
  readonly [serverErrorCode: string]: PipelineErrorCode;
} = {
  // A barber whose roster changed under a stale tab is a lost race from
  // the user's side: re-picking from a fresh grid is the fix for both.
  [B.SlotUnavailable]: P.SlotUnavailable,
  [B.BarberNotRostered]: P.SlotUnavailable,
  // The one staff refusal that is an OFFER («Запази въпреки застъпването»).
  [S.Overlaps]: P.SlotUnavailable,
  [B.Unauthenticated]: P.Unauthenticated,
  [C.Unauthenticated]: P.Unauthenticated,
  [B.TransitionUnauthenticated]: P.Unauthenticated,
  [B.TransitionForbidden]: P.Unauthenticated,
  [B.ArrivedUnauthenticated]: P.Unauthenticated,
  [B.ArrivedForbidden]: P.Unauthenticated,
  [S.Unauthenticated]: P.Unauthenticated,
  [S.Forbidden]: P.Unauthenticated,
  [W.Unauthenticated]: P.Unauthenticated,
  [B.UnknownService]: P.CatalogChanged,
  [B.ServiceNotAtLocation]: P.CatalogChanged,
  // Refused AS SENT — re-picking cannot fix these.
  [B.InvalidInput]: P.InvalidRequest,
  [B.InvariantViolated]: P.InvalidRequest,
  [B.ConflictingServices]: P.InvalidRequest,
  [B.PartyTooLarge]: P.InvalidRequest,
  [B.TooSoon]: P.InvalidRequest,
  [B.BeyondHorizon]: P.InvalidRequest,
  [S.InvalidCommand]: P.InvalidRequest,
  [S.BeforeArrival]: P.InvalidRequest,
  [S.Stale]: P.InvalidRequest,
  [B.TransitionInvalidInput]: P.InvalidRequest,
  [B.TransitionNotFound]: P.InvalidRequest,
  [B.TransitionNotAllowed]: P.InvalidRequest,
  [B.ArrivedInvalidInput]: P.InvalidRequest,
  [B.ArrivedNotFound]: P.InvalidRequest,
  [B.ArrivedNotAllowed]: P.InvalidRequest,
  [C.InvalidInput]: P.InvalidRequest,
  [C.NotFound]: P.InvalidRequest,
  [C.NotCancellable]: P.InvalidRequest,
  [C.WindowClosed]: P.InvalidRequest,
  [MoveErrorCode.CarriedSeatUnplaceable]: P.InvalidRequest,
  [W.InvalidRequest]: P.InvalidRequest,
  [W.TooManyDays]: P.InvalidRequest,
  [W.AlreadyWatching]: P.InvalidRequest,
  // Nothing about the request is wrong: the same call later is the fix.
  [B.CommitStoreFailed]: P.Unavailable,
  [C.PolicyUnavailable]: P.Unavailable,
};

/** A refusal struct as the wire carried it — its own fields. */
type WireStruct = { readonly [field: string]: unknown };

/** The value as a struct of fields, or `null` for no object. */
function fieldsOf(raw: unknown): WireStruct | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as WireStruct)
    : null;
}

/** One own field, read without a dynamic index; `undefined` when absent. */
function fieldOf(struct: WireStruct, name: string): unknown {
  return Object.getOwnPropertyDescriptor(struct, name)?.value;
}

/**
 * The refusal struct `details` carries: itself when it names an `errorCode`;
 * an aggregate's FIRST refusal (`errors[0]`) otherwise — one code is enough
 * for the flow's single string (today's OTP client read).
 */
function structOf(details: unknown): WireStruct | null {
  const top = fieldsOf(details);
  if (top === null) return null;
  if (typeof fieldOf(top, 'errorCode') === 'string') return top;
  const errors = fieldOf(top, 'errors');
  if (Array.isArray(errors) && errors.length > 0) {
    const first = fieldsOf(errors[0]);
    if (first !== null && typeof fieldOf(first, 'errorCode') === 'string') {
      return first;
    }
  }
  return null;
}

/** A text field, `null` unless a non-empty string. */
function textOf(struct: WireStruct | null, name: string): string | null {
  const value = struct === null ? undefined : fieldOf(struct, name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The struct's allowlisted SCALAR fields — arrays and objects never become params. */
function paramsOf(
  struct: WireStruct | null,
  serverErrorCode: string | null,
): WireParams {
  if (struct === null || serverErrorCode === null) return {};
  const allowed = WIRE_PARAM_ALLOWLIST[serverErrorCode] ?? [];
  const params: Record<string, string | number | boolean | null> = {};
  for (let i = 0; i < allowed.length; i++) {
    const name = allowed[i] as string;
    const value = fieldOf(struct, name);
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params[name] = value;
    }
  }
  return params;
}

/** The SDK's prefix on a callable's status (`functions/permission-denied`). */
const SDK_STATUS_PREFIX = 'functions/';

/**
 * THE ONE PARSE of a wire status: `functions/permission-denied` (the SDK's
 * spelling) and `permission-denied` alike read as
 * `HttpsStatus.PermissionDenied`; a string outside Firebase's seventeen —
 * which the SDK never hands — reads as `null`, classified exactly as before
 * (`PIPELINE_UNKNOWN`, {@link codeOfStatus}'s default).
 */
function bareStatus(status: string): HttpsStatus | null {
  const bare = status.startsWith(SDK_STATUS_PREFIX)
    ? status.slice(SDK_STATUS_PREFIX.length)
    : status;
  return Tag.has(HttpsStatus, bare) ? bare : null;
}

export const PipelineError = {
  of(
    errorCode: PipelineErrorCode,
    serverErrorCode: string | null,
    refusal: string | null,
    field: string | null,
  ): PipelineError {
    return {
      errorCode,
      serverErrorCode,
      refusal,
      field,
      wireStatus: null,
      serverParams: {},
    };
  },

  /** A failure with nothing more specific to say than its code. */
  bare(errorCode: PipelineErrorCode): PipelineError {
    return PipelineError.of(errorCode, null, null, null);
  },

  /**
   * THE ONE CLASSIFICATION of a failed call (Phase 4a 4A-5) — `status` the
   * `HttpsError`'s (`FunctionsError.code`, with or without the SDK's
   * `functions/` prefix), `details` its projected refusal struct (or an
   * aggregate's `errors`). The flow's code comes from the server's code
   * where today's adapters gave it a row of its own
   * (`booking.commit.slot_unavailable` → slot taken, …), else from the
   * status; a carried seat whose barber is busy is a lost slot, like any
   * other. The wire's struct rides along for the wording.
   */
  fromWire(status: string, details: unknown): PipelineError {
    const wireStatus = bareStatus(status);
    const struct = structOf(details);
    const serverErrorCode = textOf(struct, 'errorCode');
    const refusal = textOf(struct, 'refusal');
    const field = textOf(struct, 'field');
    const overridden =
      serverErrorCode === MoveErrorCode.CarriedSeatUnplaceable &&
      refusal === CarriedSeatRefusal.BarberUnavailable
        ? P.SlotUnavailable
        : serverErrorCode === null
          ? undefined
          : CODE_OVERRIDES[serverErrorCode];
    return {
      errorCode: overridden ?? codeOfStatus(wireStatus),
      serverErrorCode,
      refusal,
      field,
      wireStatus,
      serverParams: paramsOf(struct, serverErrorCode),
    };
  },

  /**
   * The OTP request/verify "blocked" reading — the wire STATUS, as today
   * (`functions/permission-denied` → `userBlocked`, whatever the code). Not
   * the lockout (`IDENTITY_OTP_LOCKED_OUT` is `resource-exhausted`).
   */
  isBlocked(error: PipelineError): boolean {
    return error.wireStatus === HttpsStatus.PermissionDenied;
  },

  is(error: PipelineError, code: PipelineErrorCode): boolean {
    return error.errorCode === code;
  },

  /**
   * Whether a flat error struct IS a `PipelineError` — a failed call — rather
   * than a refusal of the caller's own (a flow machine's step, a pipeline's
   * own refusal): its `errorCode` is one of {@link PipelineErrorCode}. The
   * ONE guard every surface that splits the two reads (the booking flow,
   * the functions identity wire).
   */
  isPipelineError(error: {
    readonly errorCode: string;
  }): error is PipelineError {
    return Tag.has(PipelineErrorCode, error.errorCode);
  },
} as const;
