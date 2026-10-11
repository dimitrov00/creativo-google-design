import {
  type CallableRequest,
  type FunctionsErrorCode,
  HttpsError,
} from 'firebase-functions/v2/https';
import {
  AccountsErrorCode,
  BookingErrorCode,
  BookingFlowErrorCode,
  CatalogErrorCode,
  EngagementErrorCode,
  GovernanceErrorCode,
  IdentityErrorCode,
  LocalDate,
  MediaErrorCode,
  MinuteOfDay,
  MoneyErrorCode,
  PhoneErrorCode,
  PipelineErrorCode,
  PrimitiveErrorCode,
  RepositoryErrorCode,
  type Result,
  SchedulingErrorCode,
  StreakPublishErrorCode,
  TimeErrorCode,
  type TimeZone,
  TriggerEventId,
  UtcEpochMs,
  WaitlistErrorCode,
  defect,
} from '@core/primitives';
import {
  type CallableName,
  type NowUtcMs,
  type TelemetryPorts,
} from '@core/ports';
import {
  AttemptOutcome,
  CancellationRefusalCode,
  MoveErrorCode,
  StaffEditErrorCode,
  type AttemptLine,
  TriggerAttemptSystem,
  WorkBudgetSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { TENANT_ZONE } from './lib/booking/tenant-zone';

/**
 * THE EDGE (blueprint §4.3, D1(a)) — the one place a `Result.err` becomes an
 * `HttpsError`, and the only place, besides a pipeline's write half, that
 * telemetry is invoked. A handler in `main.ts` is `callableEdge(spec, ports,
 * pipeline(bundle))` (or `retryingTrigger` for an event); it holds no logic.
 *
 * The wire table {@link EDGE_WIRE} is TOTAL: every code of every ecs-core
 * error dictionary, plus every code today's `lib/**` handlers throw that no
 * ecs-core dictionary spells yet ({@link LegacyWireCode}), maps to the
 * `HttpsError` status and the `details` shape the web reads today — the
 * booking gateway's and the OTP client's duck typing off `details.code`,
 * `details.params` and `details.errors`, and `translateFunctionsError`'s
 * `errors.<code>` lookup. The 81 inline throws collapse into this table as
 * their collections flip; the codes that move into an ecs-core dictionary
 * leave {@link LegacyWireCode} in the same flip.
 *
 * Phase 3a: every export still delegates to its `lib/**` handler, which
 * throws its own `HttpsError`s; {@link legacyCallable} passes those through
 * untouched and gives an unexpected throw the platform's own answer.
 *
 * **The flatten pass (flatten-spec §4.3, F-10): the wire is frozen.** The
 * table is keyed by the ecs-core `errorCode` (an ecs-core struct carries it
 * as `errorCode`; a legacy class and the {@link LegacyWireCode}s as `code` —
 * both are read), and every rule carries its `wireCode`: the LEGACY dotted
 * code that leaves in `details.code` and the message, so a SCREAMING
 * `errorCode` never reaches a client before Phase 4 flips the wire with the
 * client ({@link LEGACY_WIRE_CODE}). Instant params render on the shop's
 * clock with `ZonedTimeSystem.toIso`, local-coordinate params through
 * `toUtc` first, and a renamed struct field leaves under its legacy wire
 * name ({@link WIRE_FIELD_NAME}).
 */

// ── The vocabulary ─────────────────────────────────────────────────────────

/** The statuses the edge answers with — Firebase's `FunctionsErrorCode` strings, verbatim. */
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
} as const satisfies Record<string, FunctionsErrorCode>;
export type HttpsStatus = (typeof HttpsStatus)[keyof typeof HttpsStatus];

/**
 * The codes today's handlers put on the wire that no ecs-core dictionary
 * spells yet — the inline throws of `lib/**` and the `use-cases/*.errors.ts`
 * classes the OTP, registration and streak-publish callables answer with,
 * plus the nested codes their aggregates carry in `details.errors[]`. Each
 * 3b flip moves its codes into an ecs-core dictionary (or retires them with
 * their handler) and deletes them here.
 */
export const LegacyWireCode = {
  // booking — inline throws
  CommitForbidden: 'booking.commit.forbidden',
  CommitStoreFailed: 'booking.commit.store_failed',
  CancelUnauthenticated: 'booking.cancel.unauthenticated',
  CancelInvalidInput: 'booking.cancel.invalid_input',
  CancelNotFound: 'booking.cancel.not_found',
  WaitlistNotFound: 'booking.waitlist.not_found',
  WaitlistNotCancellable: 'booking.waitlist.not_cancellable',
  TransitionUnauthenticated: 'booking.transition.unauthenticated',
  TransitionForbidden: 'booking.transition.forbidden',
  TransitionInvalidInput: 'booking.transition.invalid_input',
  TransitionNotFound: 'booking.transition.not_found',
  TransitionNotAllowed: 'booking.transition.not_allowed',
  TransitionReopenWindowClosed: 'booking.transition.reopen_window_closed',
  TransitionSlotTaken: 'booking.transition.slot_taken',
  ArrivedUnauthenticated: 'booking.arrived.unauthenticated',
  ArrivedForbidden: 'booking.arrived.forbidden',
  ArrivedInvalidInput: 'booking.arrived.invalid_input',
  ArrivedNotFound: 'booking.arrived.not_found',
  ArrivedNotAllowed: 'booking.arrived.not_allowed',
  TipUnauthenticated: 'booking.tip.unauthenticated',
  TipForbidden: 'booking.tip.forbidden',
  TipInvalidInput: 'booking.tip.invalid_input',
  TipNotFound: 'booking.tip.not_found',
  // ops
  BackfillUnauthenticated: 'ops.backfill.unauthenticated',
  BackfillForbidden: 'ops.backfill.forbidden',
  BackfillInvalidInput: 'ops.backfill.invalid_input',
  // loyalty — the streak publish's faults, and its legacy-only refusal
  StreakPublishUnauthenticated: 'loyalty.streak_publish.unauthenticated',
  StreakPublishInvalidInput: 'loyalty.streak_publish.invalid_input',
  StreakPublishStoreFailed: 'loyalty.streak_publish.store_failed',
  StreakPublishNotAdmin: 'loyalty.streak_publish.not_admin',
  // identity — the undotted codes of the OTP and registration callables
  InvalidInput: 'invalid_input',
  RepositoryFailure: 'repository_failure',
  InvalidTimeZone: 'invalid_time_zone',
  OtpChannelMismatch: 'otp_channel_mismatch',
  OtpRateLimited: 'otp_rate_limited',
  OtpSendFailure: 'otp_send_failure',
  OtpValidationFailed: 'otp_validation_failed',
  OtpNotFound: 'otp_not_found',
  OtpAlreadyConsumed: 'otp_already_consumed',
  OtpExpired: 'otp_expired',
  OtpLockedOut: 'otp_locked_out',
  OtpIncorrectCode: 'otp_incorrect_code',
  OtpDestinationCorrupted: 'otp_destination_corrupted',
  TokenMintingFailure: 'token_minting_failure',
  RegistrationUnauthenticated: 'registration_unauthenticated',
  RegistrationForbidden: 'registration_forbidden',
  RegistrationFieldMissing: 'registration_field_missing',
  RegistrationBirthDateInvalid: 'registration_birth_date_invalid',
  RegistrationUserNotFound: 'registration_user_not_found',
  UserValidationFailed: 'user_validation_failed',
  ClaimsPromotionFailure: 'claims_promotion_failure',
  // nested — ride only inside an aggregate's `details.errors[]`
  EmptyId: 'empty_id',
  InvalidDateTime: 'invalid_date_time',
  OtpDestinationEmpty: 'otp_destination_empty',
  InvalidOtpMaxAttempts: 'invalid_otp_max_attempts',
  AccountsIdEmpty: 'accounts.id.empty',
  PhoneNumberInvalid: 'phone_number_invalid',
  AccountsBirthDateInvalid: 'accounts.birth_date.invalid',
  AccountsBirthDateTooYoung: 'accounts.birth_date.too_young',
  AccountsBirthDateTooOld: 'accounts.birth_date.too_old',
} as const;
export type LegacyWireCode =
  (typeof LegacyWireCode)[keyof typeof LegacyWireCode];

/**
 * Every dictionary the table covers, by name — the spec proves each of
 * their codes maps, and that no ecs-core error dictionary is missing here.
 */
export const EDGE_DICTIONARIES = {
  AccountsErrorCode,
  PrimitiveErrorCode,
  BookingErrorCode,
  BookingFlowErrorCode,
  CancellationRefusalCode,
  CatalogErrorCode,
  EngagementErrorCode,
  GovernanceErrorCode,
  IdentityErrorCode,
  MediaErrorCode,
  MoneyErrorCode,
  MoveErrorCode,
  PhoneErrorCode,
  PipelineErrorCode,
  RepositoryErrorCode,
  SchedulingErrorCode,
  StaffEditErrorCode,
  StreakPublishErrorCode,
  TimeErrorCode,
  WaitlistErrorCode,
  LegacyWireCode,
} as const;

/** Every code the edge can put on the wire. */
export type EdgeCode =
  | AccountsErrorCode
  | PrimitiveErrorCode
  | BookingErrorCode
  | BookingFlowErrorCode
  | CancellationRefusalCode
  | CatalogErrorCode
  | EngagementErrorCode
  | GovernanceErrorCode
  | IdentityErrorCode
  | MediaErrorCode
  | MoneyErrorCode
  | MoveErrorCode
  | PhoneErrorCode
  | PipelineErrorCode
  | RepositoryErrorCode
  | SchedulingErrorCode
  | StaffEditErrorCode
  | StreakPublishErrorCode
  | TimeErrorCode
  | WaitlistErrorCode
  | LegacyWireCode;

/**
 * A refusal as a pipeline returns it: its code and the struct's own fields
 * (i18n parameters, ids, figures). Every ecs-core error struct is one, its
 * code named `errorCode` (Law 7.5); a legacy class (and a
 * {@link LegacyWireCode} the edge raises itself) names it `code`; an
 * aggregate carries its nested refusals as `errors`.
 */
export type EdgeError = (
  { readonly code: EdgeCode } | { readonly errorCode: EdgeCode }
) & {
  readonly [field: string]: unknown;
};

/** The code a refusal names — an ecs-core struct's `errorCode`, else a legacy `code`. */
export function errorCodeOf(error: EdgeError): string {
  const coded = new Map<string, unknown>(Object.entries(error));
  const errorCode = coded.get('errorCode');
  return typeof errorCode === 'string' ? errorCode : String(coded.get('code'));
}

// ── The wire rules ─────────────────────────────────────────────────────────

/** Which `details` a refusal leaves with — today's four shapes, and the answered one. */
export const WireShape = {
  /** `{ code }` — today's inline throws. */
  CodeOnly: 'CODE_ONLY',
  /** `{ code, params }` — every DomainError-backed throw (`params` may be `{}`). */
  CodeAndParams: 'CODE_AND_PARAMS',
  /** `{ errors: [{ code, params }] }` — an aggregate, no top-level code. */
  Errors: 'ERRORS',
  /** `{ code, errors: [{ code, params }] }` — a wrapper code and its cause. */
  CodeAndErrors: 'CODE_AND_ERRORS',
  /** Never thrown: the callable RETURNS it in its answer (the streak publish's refusals). */
  Answered: 'ANSWERED',
} as const;
export type WireShape = (typeof WireShape)[keyof typeof WireShape];

/** How one struct field becomes one `details.params` entry. */
export const ParamFormat = {
  /** The value as is — today's DomainError params (`{ attempted, minLength }`). */
  Raw: 'RAW',
  /** `String(value)` — today's explicitly stringified figures (`minLeadMinutes: '30'`). */
  Text: 'TEXT',
  /**
   * A shop wall clock — a `LocalDate` field plus a minute field
   * (`minuteField`: a `MinuteOfDay`, or an exclusive `EndMinute` whose
   * `1440` is the next day's start) — as ISO-8601 on the SHOP's clock with
   * its offset (`2026-10-10T14:00:00.000+03:00`), through
   * `ZonedTimeSystem.toUtc` then `toIso`: today's `*Iso` params, which the
   * handlers spell with `ZonedDateTime.toISO()` in the shop zone (or echo
   * the caller's own shop-offset `startIso`). See {@link WIRE_ZONE}. A wall
   * clock the zone never shows (a DST gap) is left out.
   */
  ZonedWallIso: 'ZONED_WALL_ISO',
  /** An array joined by commas — today's `seatIds: 'a,b'`. */
  Csv: 'CSV',
  /**
   * A value that NAMES a payload field or a refusal — today's `field`
   * param: a renamed struct field leaves under its legacy wire name
   * ({@link WIRE_FIELD_NAME}: `localDate` → `dayKey`) and a SCREAMING
   * `errorCode` as its legacy wire code ({@link LEGACY_WIRE_CODE}); any
   * other value as it is.
   */
  WireField: 'WIRE_FIELD',
} as const;
export type ParamFormat = (typeof ParamFormat)[keyof typeof ParamFormat];

/**
 * One parameter on the wire: `wireName` read from the struct's `field`.
 * Only listed fields ever leave — a struct field not named here (a person
 * key, a violation list, a deadline) stays on the server.
 */
export type WireParam = {
  readonly wireName: string;
  readonly field: string;
  readonly paramFormat: ParamFormat;
  /** The minute field (a `MinuteOfDay` or an `EndMinute`) beside `field`'s `LocalDate` — `ZONED_WALL_ISO` only, else `null`. */
  readonly minuteField: string | null;
};

export type ThrownWireRule = {
  readonly wireShape: Exclude<WireShape, typeof WireShape.Answered>;
  readonly httpsStatus: HttpsStatus;
  /** Read for `CODE_AND_PARAMS`; the nested refusals of an aggregate use their own rules. */
  readonly wireParams: readonly WireParam[];
};
export type AnsweredWireRule = {
  readonly wireShape: typeof WireShape.Answered;
};

/**
 * A code's whole rule: how it leaves, and the `wireCode` it leaves AS — the
 * legacy dotted code (F-10), so the wire stays byte-identical while the
 * ecs-core `errorCode`s go SCREAMING.
 */
export type WireRule = (ThrownWireRule | AnsweredWireRule) & {
  readonly wireCode: string;
};

/** A rule before its wire code is stamped on ({@link EDGE_WIRE}). */
type RuleBody = ThrownWireRule | AnsweredWireRule;

type WireTable<C extends string> = { readonly [K in C]: RuleBody };

const S = HttpsStatus;

const raw = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Raw,
  minuteField: null,
});
/** A struct field the flatten pass renamed, leaving under today's wire name. */
const rawAs = (wireName: string, field: string): WireParam => ({
  wireName,
  field,
  paramFormat: ParamFormat.Raw,
  minuteField: null,
});
/** A `field` param naming a payload field or a refusal ({@link ParamFormat.WireField}). */
const wireField = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.WireField,
  minuteField: null,
});
const text = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Text,
  minuteField: null,
});
/**
 * A local-coordinate pair as today's `*Iso` param — the flattened refusals'
 * `localDate` + `startMinutes` (or an exclusive `EndMinute`, where `1440` is
 * the next day's start), flatten-spec §4.1.
 */
export const wallIso = (
  wireName: string,
  localDateField: string,
  minuteField: string,
): WireParam => ({
  wireName,
  field: localDateField,
  paramFormat: ParamFormat.ZonedWallIso,
  minuteField,
});
const csv = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Csv,
  minuteField: null,
});

/** `{ code, params }` with the listed params (none: `params: {}`). */
const params = (
  httpsStatus: HttpsStatus,
  ...wireParams: WireParam[]
): ThrownWireRule => ({
  wireShape: WireShape.CodeAndParams,
  httpsStatus,
  wireParams,
});
/** `{ code }` alone. */
const codeOnly = (httpsStatus: HttpsStatus): ThrownWireRule => ({
  wireShape: WireShape.CodeOnly,
  httpsStatus,
  wireParams: [],
});
const aggregate = (httpsStatus: HttpsStatus): ThrownWireRule => ({
  wireShape: WireShape.Errors,
  httpsStatus,
  wireParams: [],
});
const wrapped = (httpsStatus: HttpsStatus): ThrownWireRule => ({
  wireShape: WireShape.CodeAndErrors,
  httpsStatus,
  wireParams: [],
});
const ANSWERED: AnsweredWireRule = { wireShape: WireShape.Answered };

/**
 * A dictionary whose codes share one rule, but for the listed exceptions —
 * the validation-heavy dictionaries, where every code is a refusal of what
 * was sent unless it says otherwise.
 */
function uniform<C extends string>(
  dictionary: { readonly [name: string]: C },
  rule: RuleBody,
  exceptions: Partial<Record<C, RuleBody>>,
): WireTable<C> {
  const overrides = new Map<string, RuleBody>(Object.entries(exceptions));
  const table = new Map<string, RuleBody>();
  for (const code of Object.values(dictionary)) {
    table.set(code, overrides.get(code) ?? rule);
  }
  return Object.fromEntries(table) as WireTable<C>;
}

// Statuses for codes no callable returns yet follow today's precedents: a
// refusal of what was sent is `invalid-argument`, a state that forbids it
// `failed-precondition`, a stored or configured value the server cannot
// stand by `internal` (today's `repository_failure`), a lost race `aborted`.

const BOOKING_WIRE: WireTable<BookingErrorCode> = {
  [BookingErrorCode.Unauthenticated]: params(S.Unauthenticated),
  // `detail` (a person key, a location) and `reason` stay OFF the wire.
  [BookingErrorCode.InvalidInput]: params(
    S.InvalidArgument,
    wireField('field'),
  ),
  [BookingErrorCode.UnknownService]: params(S.NotFound, raw('serviceId')),
  [BookingErrorCode.ServiceNotAtLocation]: params(
    S.FailedPrecondition,
    raw('serviceId'),
    raw('locationId'),
  ),
  [BookingErrorCode.ConflictingServices]: params(
    S.FailedPrecondition,
    raw('first'),
    raw('second'),
  ),
  // The struct's `localDate` leaves as today's `dayKey`.
  [BookingErrorCode.BarberNotRostered]: params(
    S.FailedPrecondition,
    raw('barberId'),
    rawAs('dayKey', 'localDate'),
  ),
  // `aborted`: the honest status of a lost race, retryable as no other is.
  [BookingErrorCode.SlotUnavailable]: params(
    S.Aborted,
    raw('barberId'),
    wallIso('startIso', 'localDate', 'startMinutes'),
  ),
  [BookingErrorCode.TooSoon]: params(
    S.FailedPrecondition,
    text('minLeadMinutes'),
  ),
  [BookingErrorCode.BeyondHorizon]: params(
    S.FailedPrecondition,
    text('horizonMonths'),
  ),
  [BookingErrorCode.PartyTooLarge]: params(
    S.FailedPrecondition,
    text('maxPartySize'),
  ),
  // The violations stay on the server, as today.
  [BookingErrorCode.InvariantViolated]: params(S.InvalidArgument),
};

const MOVE_WIRE: WireTable<MoveErrorCode> = {
  // NOT `aborted`: only the shop can re-seat somebody else on the visit.
  [MoveErrorCode.CarriedSeatUnplaceable]: params(
    S.FailedPrecondition,
    raw('refusal'),
    csv('seatIds'),
  ),
};

const STAFF_EDIT_WIRE: WireTable<StaffEditErrorCode> = {
  [StaffEditErrorCode.Unauthenticated]: params(S.Unauthenticated),
  [StaffEditErrorCode.Forbidden]: params(S.PermissionDenied),
  [StaffEditErrorCode.InvalidCommand]: params(S.InvalidArgument, raw('field')),
  // An offer, not a lost race: `failed-precondition`, never `aborted`.
  [StaffEditErrorCode.Overlaps]: params(
    S.FailedPrecondition,
    raw('barberId'),
    wallIso('startIso', 'localDate', 'startMinutes'),
    raw('edge'),
  ),
  // The visit's end and the arrival, each a shop wall clock (an end may be
  // the closing midnight, `1440` — the next day's start).
  [StaffEditErrorCode.BeforeArrival]: params(
    S.FailedPrecondition,
    wallIso('endIso', 'localDate', 'finishMinutes'),
    wallIso('arrivedAtIso', 'arrivalLocalDate', 'arrivalMinutes'),
  ),
  [StaffEditErrorCode.Stale]: params(
    S.FailedPrecondition,
    text('expected'),
    text('actual'),
  ),
  // A server bug in the staff family's own words — never the caller's fault.
  [StaffEditErrorCode.InvariantViolated]: params(S.Internal, raw('what')),
};

const CANCELLATION_WIRE: WireTable<CancellationRefusalCode> = {
  [CancellationRefusalCode.PolicyUnavailable]: codeOnly(S.Unavailable),
  [CancellationRefusalCode.NotCancellable]: codeOnly(S.FailedPrecondition),
  [CancellationRefusalCode.WindowClosed]: params(
    S.FailedPrecondition,
    text('windowHours'),
  ),
};

/**
 * requestWaitlist's shapes. cancelWaitlist throws the first two codes as
 * `{ code }` alone today; one code has one rule, so when it flips onto
 * WaitlistError (3b, booking core) its details gain `params` — `{}` and
 * `{ field: 'requestId' }` — an accepted change the web never reads (it
 * keys on `details.code`), recorded in that flip with main.spec's update.
 */
const WAITLIST_WIRE: WireTable<WaitlistErrorCode> = {
  [WaitlistErrorCode.Unauthenticated]: params(S.Unauthenticated),
  [WaitlistErrorCode.InvalidRequest]: params(
    S.InvalidArgument,
    wireField('field'),
  ),
  [WaitlistErrorCode.TooManyDays]: params(S.FailedPrecondition, text('max')),
  [WaitlistErrorCode.AlreadyWatching]: params(S.AlreadyExists),
};

/** The streak publish's refusals are ANSWERED — `{ kind: 'refused', code, fields }` — never thrown. */
const STREAK_PUBLISH_WIRE: WireTable<StreakPublishErrorCode> = uniform(
  StreakPublishErrorCode,
  ANSWERED,
  {},
);

const IDENTITY_WIRE: WireTable<IdentityErrorCode> = {
  [IdentityErrorCode.OtpAlreadyConsumed]: params(S.FailedPrecondition),
  [IdentityErrorCode.OtpExpired]: params(S.DeadlineExceeded),
  [IdentityErrorCode.OtpLockedOut]: params(S.ResourceExhausted),
  [IdentityErrorCode.OtpWrongCode]: params(S.InvalidArgument),
  [IdentityErrorCode.IdentifierInvalid]: params(S.InvalidArgument),
  [IdentityErrorCode.OtpCodeInvalid]: params(S.InvalidArgument),
  [IdentityErrorCode.BirthDateInvalid]: params(
    S.InvalidArgument,
    raw('attempted'),
  ),
  [IdentityErrorCode.BirthDateInFuture]: params(
    S.InvalidArgument,
    raw('attempted'),
  ),
  [IdentityErrorCode.BirthDateTooYoung]: params(
    S.InvalidArgument,
    raw('age'),
    raw('minAge'),
  ),
  [IdentityErrorCode.BirthDateTooOld]: params(
    S.InvalidArgument,
    raw('age'),
    raw('maxAge'),
  ),
  [IdentityErrorCode.AuthClaimsEmptyRoles]: params(S.Internal),
  [IdentityErrorCode.AuthStrategyUnknownKind]: params(S.Internal),
  [IdentityErrorCode.AuthStrategyUnknownField]: params(S.Internal),
  [IdentityErrorCode.AuthStrategyRequiredEmpty]: params(S.Internal),
  [IdentityErrorCode.AuthStrategyPhoneMissing]: params(S.Internal),
  [IdentityErrorCode.AuthStrategyInvalidPolicy]: params(S.Internal),
  [IdentityErrorCode.AuthFlowInvalidTransition]: params(S.FailedPrecondition),
  [IdentityErrorCode.OnboardingFlowInvalidTransition]: params(
    S.FailedPrecondition,
  ),
};

const ACCOUNTS_WIRE: WireTable<AccountsErrorCode> = {
  [AccountsErrorCode.BlockReasonInvalid]: params(
    S.InvalidArgument,
    raw('attempted'),
  ),
  [AccountsErrorCode.UserRoleInvalid]: params(
    S.InvalidArgument,
    raw('attempted'),
  ),
  [AccountsErrorCode.UserRolesEmpty]: params(S.InvalidArgument),
  [AccountsErrorCode.FirstNameTooShort]: params(
    S.InvalidArgument,
    raw('attempted'),
    raw('minLength'),
  ),
  [AccountsErrorCode.LastNameTooShort]: params(
    S.InvalidArgument,
    raw('attempted'),
    raw('minLength'),
  ),
  [AccountsErrorCode.EmailInvalid]: params(S.InvalidArgument, raw('attempted')),
  [AccountsErrorCode.UpdateProfileNotFound]: params(S.NotFound),
  [AccountsErrorCode.UpdateProfileValidationFailed]: params(S.InvalidArgument),
  [AccountsErrorCode.UploadAvatarNotAnImage]: params(S.InvalidArgument),
  [AccountsErrorCode.UploadAvatarTooLarge]: params(S.InvalidArgument),
};

const GOVERNANCE_WIRE: WireTable<GovernanceErrorCode> = {
  [GovernanceErrorCode.AuditEntryEmptyAction]: params(S.Internal),
  [GovernanceErrorCode.FeatureFlagsUnknownKey]: params(S.InvalidArgument),
  [GovernanceErrorCode.FeatureFlagsInvalidValue]: params(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationScopeInvalid]: params(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationSelf]: params(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationReasonRequired]: params(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationInvalidExpiry]: params(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationAdminNotStaff]: params(S.PermissionDenied),
  [GovernanceErrorCode.ImpersonationAlreadyEnded]: params(S.FailedPrecondition),
  [GovernanceErrorCode.EndImpersonationNotFound]: params(S.NotFound),
  [GovernanceErrorCode.SearchUsersQueryTooShort]: params(S.InvalidArgument),
};

const PIPELINE_WIRE: WireTable<PipelineErrorCode> = {
  [PipelineErrorCode.Unauthenticated]: params(S.Unauthenticated),
  [PipelineErrorCode.SlotUnavailable]: params(S.Aborted),
  [PipelineErrorCode.CatalogChanged]: params(S.FailedPrecondition),
  [PipelineErrorCode.InvalidRequest]: params(S.InvalidArgument),
  [PipelineErrorCode.Unavailable]: params(S.Unavailable),
  [PipelineErrorCode.Unknown]: params(S.Internal),
};

const REPOSITORY_WIRE: WireTable<RepositoryErrorCode> = {
  // Today's `repository_failure`: `internal`, the cause in the log only.
  [RepositoryErrorCode.ReadFailed]: params(S.Internal),
  [RepositoryErrorCode.WriteFailed]: params(S.Internal),
  // A `Create` that met its document — normally read by the pipeline as the
  // replay; one that reaches the edge answers in the store's own word.
  [RepositoryErrorCode.AlreadyExists]: params(S.AlreadyExists),
  [RepositoryErrorCode.Malformed]: params(S.Internal),
  [RepositoryErrorCode.Unavailable]: params(S.Unavailable),
};

const MEDIA_WIRE: WireTable<MediaErrorCode> = {
  [MediaErrorCode.NotFound]: params(S.NotFound),
  [MediaErrorCode.Forbidden]: params(S.PermissionDenied),
  [MediaErrorCode.Transient]: params(S.Unavailable),
};

const BOOKING_FLOW_WIRE: WireTable<BookingFlowErrorCode> = {
  [BookingFlowErrorCode.InvalidTransition]: params(S.FailedPrecondition),
  [BookingFlowErrorCode.InvalidGuest]: params(S.InvalidArgument),
  [BookingFlowErrorCode.GuestNotFound]: params(S.InvalidArgument),
  [BookingFlowErrorCode.PartyFull]: params(S.FailedPrecondition),
  [BookingFlowErrorCode.EmptyCart]: params(S.InvalidArgument),
  [BookingFlowErrorCode.SeatWithoutService]: params(S.InvalidArgument),
  [BookingFlowErrorCode.FlexibleDaysFull]: params(S.FailedPrecondition),
  [BookingFlowErrorCode.NoFlexibleDays]: params(S.InvalidArgument),
  [BookingFlowErrorCode.InvalidCartOperation]: params(S.InvalidArgument),
};

const SCHEDULING_WIRE = uniform(
  SchedulingErrorCode,
  params(S.InvalidArgument),
  {
    [SchedulingErrorCode.AppointmentPastStartTime]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentBarberDoubleBooked]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentInvalidTransition]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentReopenWindowClosed]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentUnknownSeat]: params(S.NotFound),
    [SchedulingErrorCode.AppointmentSeatAlreadyResolved]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentNotArrivable]: params(S.FailedPrecondition),
    [SchedulingErrorCode.BookingPolicyInvalid]: params(S.Internal),
    [SchedulingErrorCode.CancellationWindowInvalid]: params(S.Internal),
    [SchedulingErrorCode.ClientStatsPolicyInvalid]: params(S.Internal),
    [SchedulingErrorCode.FlexibleWhenFull]: params(S.FailedPrecondition),
    [SchedulingErrorCode.StaffScheduleRetroactiveAmendment]: params(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.WaitlistInvalidTransition]: params(
      S.FailedPrecondition,
    ),
  },
);

const ENGAGEMENT_WIRE = uniform(
  EngagementErrorCode,
  params(S.InvalidArgument),
  {
    [EngagementErrorCode.CouponGrantNotActive]: params(S.FailedPrecondition),
    [EngagementErrorCode.CouponGrantNotExpiring]: params(S.FailedPrecondition),
    [EngagementErrorCode.GiftVoucherNotRedeemable]: params(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.GiftVoucherInsufficientBalance]: params(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.GiftVoucherOverRestore]: params(S.FailedPrecondition),
    [EngagementErrorCode.GiftVoucherCurrencyMismatch]: params(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.PointsInsufficient]: params(S.FailedPrecondition),
    [EngagementErrorCode.InvitationSelfRedemption]: params(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.StreakScheduleVersionNotRising]: params(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.StreakScheduleNotAfterCurrent]: params(
      S.FailedPrecondition,
    ),
  },
);

const CATALOG_WIRE = uniform(CatalogErrorCode, params(S.InvalidArgument), {});
const MONEY_WIRE = uniform(MoneyErrorCode, params(S.InvalidArgument), {});
const PHONE_WIRE = uniform(PhoneErrorCode, params(S.InvalidArgument), {});
const TIME_WIRE = uniform(TimeErrorCode, params(S.InvalidArgument), {
  // Today's `invalid_time_zone` — a server zone, never the caller's.
  [TimeErrorCode.InvalidTimeZone]: params(S.Internal),
});
/** A refused primitive: what was sent is not one (no legacy code — it leaves as itself). */
const PRIMITIVE_WIRE = uniform(
  PrimitiveErrorCode,
  params(S.InvalidArgument),
  {},
);

const L = LegacyWireCode;
const LEGACY_WIRE: WireTable<LegacyWireCode> = {
  [L.CommitForbidden]: codeOnly(S.PermissionDenied),
  [L.CommitStoreFailed]: params(S.Internal),
  [L.CancelUnauthenticated]: codeOnly(S.Unauthenticated),
  [L.CancelInvalidInput]: codeOnly(S.InvalidArgument),
  // Not-yours answers exactly as not-found: an id's existence is no leak.
  [L.CancelNotFound]: codeOnly(S.NotFound),
  [L.WaitlistNotFound]: codeOnly(S.NotFound),
  [L.WaitlistNotCancellable]: codeOnly(S.FailedPrecondition),
  [L.TransitionUnauthenticated]: codeOnly(S.Unauthenticated),
  [L.TransitionForbidden]: codeOnly(S.PermissionDenied),
  [L.TransitionInvalidInput]: codeOnly(S.InvalidArgument),
  [L.TransitionNotFound]: codeOnly(S.NotFound),
  [L.TransitionNotAllowed]: params(
    S.FailedPrecondition,
    raw('from'),
    raw('to'),
  ),
  [L.TransitionReopenWindowClosed]: params(
    S.FailedPrecondition,
    raw('from'),
    raw('to'),
  ),
  [L.TransitionSlotTaken]: params(S.FailedPrecondition, raw('from'), raw('to')),
  [L.ArrivedUnauthenticated]: codeOnly(S.Unauthenticated),
  [L.ArrivedForbidden]: codeOnly(S.PermissionDenied),
  [L.ArrivedInvalidInput]: codeOnly(S.InvalidArgument),
  [L.ArrivedNotFound]: codeOnly(S.NotFound),
  [L.ArrivedNotAllowed]: params(S.FailedPrecondition, raw('from'), raw('to')),
  [L.TipUnauthenticated]: codeOnly(S.Unauthenticated),
  [L.TipForbidden]: codeOnly(S.PermissionDenied),
  [L.TipInvalidInput]: codeOnly(S.InvalidArgument),
  [L.TipNotFound]: codeOnly(S.NotFound),
  [L.BackfillUnauthenticated]: codeOnly(S.Unauthenticated),
  [L.BackfillForbidden]: codeOnly(S.PermissionDenied),
  [L.BackfillInvalidInput]: codeOnly(S.InvalidArgument),
  [L.StreakPublishUnauthenticated]: params(S.Unauthenticated),
  [L.StreakPublishInvalidInput]: params(S.InvalidArgument, raw('field')),
  [L.StreakPublishStoreFailed]: params(S.Internal),
  [L.StreakPublishNotAdmin]: ANSWERED,
  [L.InvalidInput]: params(S.InvalidArgument, raw('reason')),
  [L.RepositoryFailure]: params(S.Internal),
  [L.InvalidTimeZone]: params(S.Internal, raw('rawZone')),
  [L.OtpChannelMismatch]: params(
    S.FailedPrecondition,
    raw('requested'),
    raw('strategyKind'),
  ),
  [L.OtpRateLimited]: params(S.ResourceExhausted),
  [L.OtpSendFailure]: params(S.Internal),
  [L.OtpValidationFailed]: aggregate(S.InvalidArgument),
  [L.OtpNotFound]: params(S.NotFound),
  [L.OtpAlreadyConsumed]: params(S.FailedPrecondition),
  [L.OtpExpired]: params(S.DeadlineExceeded),
  [L.OtpLockedOut]: params(S.ResourceExhausted),
  [L.OtpIncorrectCode]: params(S.InvalidArgument),
  [L.OtpDestinationCorrupted]: params(S.Internal),
  [L.TokenMintingFailure]: params(S.Internal),
  [L.RegistrationUnauthenticated]: params(S.Unauthenticated),
  // NOT `permission-denied`: the OTP client reads that as the lockout.
  [L.RegistrationForbidden]: params(S.FailedPrecondition),
  [L.RegistrationFieldMissing]: params(S.InvalidArgument, raw('field')),
  [L.RegistrationBirthDateInvalid]: wrapped(S.InvalidArgument),
  [L.RegistrationUserNotFound]: params(S.FailedPrecondition),
  [L.UserValidationFailed]: aggregate(S.InvalidArgument),
  [L.ClaimsPromotionFailure]: params(S.Internal),
  [L.EmptyId]: params(S.InvalidArgument, raw('idType')),
  [L.InvalidDateTime]: params(
    S.InvalidArgument,
    raw('rawValue'),
    raw('reason'),
  ),
  [L.OtpDestinationEmpty]: params(S.InvalidArgument),
  [L.InvalidOtpMaxAttempts]: params(S.InvalidArgument, raw('rawValue')),
  [L.AccountsIdEmpty]: params(S.InvalidArgument, raw('idType')),
  [L.PhoneNumberInvalid]: params(
    S.InvalidArgument,
    raw('attempted'),
    raw('reason'),
  ),
  [L.AccountsBirthDateInvalid]: params(S.InvalidArgument, raw('attempted')),
  [L.AccountsBirthDateTooYoung]: params(
    S.InvalidArgument,
    raw('age'),
    raw('minAge'),
  ),
  [L.AccountsBirthDateTooOld]: params(
    S.InvalidArgument,
    raw('age'),
    raw('maxAge'),
  ),
};

/**
 * The legacy dotted code each flattened `errorCode` leaves as on the wire
 * (flatten-spec §4.2, §4.3, F-10) — one row for every SCREAMING value of
 * every ecs-core error dictionary, its old dotted code verbatim, so
 * `details.code` and the message stay byte-identical. A `PRIMITIVE_*` code
 * has no legacy code and leaves as itself; a {@link LegacyWireCode} IS its
 * own wire code. Phase 4 deletes the map with the client's switch to
 * SCREAMING codes.
 */
export const LEGACY_WIRE_CODE: { readonly [errorCode: string]: string } = {
  // time — the owner-locked DST code and the two TIME_ codes (flatten-spec §2.1)
  [TimeErrorCode.DstGap]: 'time.nonexistent_local_time',
  [TimeErrorCode.InvalidDateTime]: 'time.invalid_date_time',
  [TimeErrorCode.InvalidTimeZone]: 'time.invalid_time_zone',
  // BookingErrorCode
  [BookingErrorCode.Unauthenticated]: 'booking.commit.unauthenticated',
  [BookingErrorCode.InvalidInput]: 'booking.commit.invalid_input',
  [BookingErrorCode.UnknownService]: 'booking.commit.unknown_service',
  [BookingErrorCode.ServiceNotAtLocation]:
    'booking.commit.service_not_at_location',
  [BookingErrorCode.ConflictingServices]: 'booking.commit.conflicting_services',
  [BookingErrorCode.BarberNotRostered]: 'booking.commit.barber_not_rostered',
  [BookingErrorCode.SlotUnavailable]: 'booking.commit.slot_unavailable',
  [BookingErrorCode.TooSoon]: 'booking.commit.too_soon',
  [BookingErrorCode.BeyondHorizon]: 'booking.commit.beyond_horizon',
  [BookingErrorCode.PartyTooLarge]: 'booking.commit.party_too_large',
  [BookingErrorCode.InvariantViolated]: 'booking.commit.invariant_violated',
  // StaffEditErrorCode
  [StaffEditErrorCode.Unauthenticated]: 'booking.staffEdit.unauthenticated',
  [StaffEditErrorCode.Forbidden]: 'booking.staffEdit.forbidden',
  [StaffEditErrorCode.InvalidCommand]: 'booking.staffEdit.invalid_command',
  [StaffEditErrorCode.BeforeArrival]: 'booking.staffEdit.before_arrival',
  [StaffEditErrorCode.Overlaps]: 'booking.staffEdit.overlaps',
  [StaffEditErrorCode.Stale]: 'booking.staffEdit.stale',
  [StaffEditErrorCode.InvariantViolated]:
    'booking.staffEdit.invariant_violated',
  // MoveErrorCode
  [MoveErrorCode.CarriedSeatUnplaceable]:
    'booking.reschedule.carried_seat_unplaceable',
  // CancellationRefusalCode
  [CancellationRefusalCode.PolicyUnavailable]:
    'booking.cancel.policy_unavailable',
  [CancellationRefusalCode.NotCancellable]: 'booking.cancel.not_cancellable',
  [CancellationRefusalCode.WindowClosed]: 'booking.cancel.window_closed',
  // WaitlistErrorCode
  [WaitlistErrorCode.Unauthenticated]: 'booking.waitlist.unauthenticated',
  [WaitlistErrorCode.InvalidRequest]: 'booking.waitlist.invalid_request',
  [WaitlistErrorCode.TooManyDays]: 'booking.waitlist.too_many_days',
  [WaitlistErrorCode.AlreadyWatching]: 'booking.waitlist.already_watching',
  // BookingFlowErrorCode
  [BookingFlowErrorCode.InvalidTransition]: 'booking.flow.invalid_transition',
  [BookingFlowErrorCode.InvalidGuest]: 'booking.flow.invalid_guest',
  [BookingFlowErrorCode.GuestNotFound]: 'booking.flow.guest_not_found',
  [BookingFlowErrorCode.PartyFull]: 'booking.flow.party_full',
  [BookingFlowErrorCode.EmptyCart]: 'booking.flow.empty_cart',
  [BookingFlowErrorCode.SeatWithoutService]:
    'booking.flow.seat_without_service',
  [BookingFlowErrorCode.FlexibleDaysFull]: 'booking.flow.flexible_days_full',
  [BookingFlowErrorCode.NoFlexibleDays]: 'booking.flow.no_flexible_days',
  [BookingFlowErrorCode.InvalidCartOperation]:
    'booking.flow.invalid_cart_operation',
  // SchedulingErrorCode
  [SchedulingErrorCode.AppointmentEmptySeats]:
    'scheduling.appointment.empty_seats',
  [SchedulingErrorCode.AppointmentMultipleSelfSeats]:
    'scheduling.appointment.multiple_self_seats',
  [SchedulingErrorCode.AppointmentPastStartTime]:
    'scheduling.appointment.past_start_time',
  [SchedulingErrorCode.AppointmentBarberDoubleBooked]:
    'scheduling.appointment.barber_double_booked',
  [SchedulingErrorCode.AppointmentMixedCurrency]:
    'scheduling.appointment.mixed_currency',
  [SchedulingErrorCode.AppointmentInvalidTransition]:
    'scheduling.appointment.invalid_transition',
  [SchedulingErrorCode.AppointmentReopenWindowClosed]:
    'scheduling.appointment.reopen_window_closed',
  [SchedulingErrorCode.AppointmentEmptyCancellationReason]:
    'scheduling.appointment.empty_cancellation_reason',
  [SchedulingErrorCode.AppointmentUnknownSeat]:
    'scheduling.appointment.unknown_seat',
  [SchedulingErrorCode.AppointmentSeatAlreadyResolved]:
    'scheduling.appointment.seat_already_resolved',
  [SchedulingErrorCode.AppointmentNotArrivable]: 'appointment.not_arrivable',
  [SchedulingErrorCode.ContactEmptyName]:
    'scheduling.booking_contact.empty_name',
  [SchedulingErrorCode.ContactInvalidPhone]:
    'scheduling.booking_contact.invalid_phone',
  [SchedulingErrorCode.ContactInvalidEmail]:
    'scheduling.booking_contact.invalid_email',
  [SchedulingErrorCode.ContactNoteTooLong]:
    'scheduling.booking_contact.note_too_long',
  [SchedulingErrorCode.SeatLabelEmpty]: 'scheduling.seat_label.empty',
  [SchedulingErrorCode.SeatLabelTooLong]: 'scheduling.seat_label.too_long',
  [SchedulingErrorCode.CartLineNotFound]:
    'scheduling.booking_cart.line_not_found',
  [SchedulingErrorCode.CartDuplicateService]:
    'scheduling.booking_cart.duplicate_service',
  [SchedulingErrorCode.CartInvalidLineSequence]:
    'scheduling.booking_cart.invalid_line_sequence',
  [SchedulingErrorCode.PartyGuestNotFound]:
    'scheduling.booking_party.guest_not_found',
  [SchedulingErrorCode.PartyInvalidGuestSequence]:
    'scheduling.booking_party.invalid_guest_sequence',
  [SchedulingErrorCode.PartyUnclaimed]: 'scheduling.booking_party.unclaimed',
  [SchedulingErrorCode.PartyDuplicateLabel]:
    'scheduling.booking_party.duplicate_label',
  [SchedulingErrorCode.BookingPolicyInvalid]:
    'scheduling.booking_policy.invalid',
  [SchedulingErrorCode.CancellationWindowInvalid]:
    'scheduling.cancellation_window.invalid',
  [SchedulingErrorCode.ClientStatsPolicyInvalid]:
    'scheduling.client_stats_policy.invalid',
  [SchedulingErrorCode.CalendarDayInvalid]: 'scheduling.calendar_day.invalid',
  [SchedulingErrorCode.DateRangeInvalid]: 'scheduling.date_range.invalid',
  [SchedulingErrorCode.TimeRangeInvalid]: 'scheduling.time_range.invalid',
  [SchedulingErrorCode.IdEmpty]: 'scheduling.id.empty',
  [SchedulingErrorCode.FlexibleWhenFull]: 'scheduling.flexible_when.full',
  [SchedulingErrorCode.RecurrenceInvalidInterval]:
    'scheduling.recurrence.invalid_interval',
  [SchedulingErrorCode.RecurrenceNoWeekdays]:
    'scheduling.recurrence.no_weekdays',
  [SchedulingErrorCode.RecurrenceInvalidDay]:
    'scheduling.recurrence.invalid_day',
  [SchedulingErrorCode.RecurrenceInvalidCount]:
    'scheduling.recurrence.invalid_count',
  [SchedulingErrorCode.RecurrenceEndsBeforeStart]:
    'scheduling.recurrence.ends_before_start',
  [SchedulingErrorCode.RecurrenceNeverOccurs]:
    'scheduling.recurrence.never_occurs',
  [SchedulingErrorCode.RecurrenceTooLong]: 'scheduling.recurrence.too_long',
  [SchedulingErrorCode.ShiftSegmentInvalidLocation]:
    'scheduling.shift_segment.invalid_location',
  [SchedulingErrorCode.ShiftSegmentImpossibleTransfer]:
    'scheduling.shift_segment.impossible_transfer',
  [SchedulingErrorCode.StaffScheduleOverlappingVersions]:
    'scheduling.staff_schedule.overlapping_versions',
  [SchedulingErrorCode.StaffScheduleRetroactiveAmendment]:
    'scheduling.staff_schedule.retroactive_amendment',
  [SchedulingErrorCode.WaitlistInvalid]: 'scheduling.waitlist.invalid',
  [SchedulingErrorCode.WaitlistNoDays]: 'scheduling.waitlist.no_days',
  [SchedulingErrorCode.WaitlistEmptyCart]: 'scheduling.waitlist.empty_cart',
  [SchedulingErrorCode.WaitlistInvalidTransition]:
    'scheduling.waitlist.invalid_transition',
  [SchedulingErrorCode.ScheduleExceptionEmptyRanges]:
    'scheduling.schedule_exception.empty_ranges',
  // CatalogErrorCode
  [CatalogErrorCode.IdEmpty]: 'catalog.id.empty',
  [CatalogErrorCode.LocalizedTextFieldEmpty]:
    'catalog.localized_text.field_empty',
  [CatalogErrorCode.MediaRefEmptyPath]: 'catalog.media_ref.empty_path',
  [CatalogErrorCode.MediaRefInvalidDimension]:
    'catalog.media_ref.invalid_dimension',
  [CatalogErrorCode.MediaRefFocalPointOutOfRange]:
    'catalog.media_ref.focal_point_out_of_range',
  [CatalogErrorCode.VenuePhoneBlankDisplay]:
    'catalog.venue_phone.blank_display',
  [CatalogErrorCode.BarberEmptyHandle]: 'catalog.barber.empty_handle',
  [CatalogErrorCode.BarberInvalidYearsExperience]:
    'catalog.barber.invalid_years_experience',
  [CatalogErrorCode.BarberInvalidSortOrder]:
    'catalog.barber.invalid_sort_order',
  [CatalogErrorCode.ServiceCategoryInvalidSortOrder]:
    'catalog.service_category.invalid_sort_order',
  [CatalogErrorCode.ServiceInvalidDuration]: 'catalog.service.invalid_duration',
  [CatalogErrorCode.ServiceInvalidSortOrder]:
    'catalog.service.invalid_sort_order',
  [CatalogErrorCode.ServiceEmptyBundleIncludes]:
    'catalog.service.empty_bundle_includes',
  [CatalogErrorCode.ServiceUnknownVariantTerms]:
    'catalog.service.unknown_variant_terms',
  [CatalogErrorCode.ServiceDuplicateVariantTerms]:
    'catalog.service.duplicate_variant_terms',
  [CatalogErrorCode.ServiceDuplicateVariant]:
    'catalog.service.duplicate_variant',
  [CatalogErrorCode.ServiceDuplicateOffering]:
    'catalog.service.duplicate_offering',
  [CatalogErrorCode.ServiceMixedCurrencyTerms]:
    'catalog.service.mixed_currency_terms',
  [CatalogErrorCode.LocationInvalidGeoCoordinate]:
    'catalog.location.invalid_geo_coordinate',
  [CatalogErrorCode.LocationInvalidTimezone]:
    'catalog.location.invalid_timezone',
  [CatalogErrorCode.LocationInvalidSortOrder]:
    'catalog.location.invalid_sort_order',
  [CatalogErrorCode.LocationInvalidMapUrl]: 'catalog.location.invalid_map_url',
  [CatalogErrorCode.LocationInvalidHoursLength]:
    'catalog.location.invalid_hours_length',
  [CatalogErrorCode.LocationInvalidTimeOfDay]:
    'catalog.location.invalid_time_of_day',
  [CatalogErrorCode.LocationInvalidHoursRange]:
    'catalog.location.invalid_hours_range',
  // EngagementErrorCode
  [EngagementErrorCode.IdEmpty]: 'engagement.id.empty',
  [EngagementErrorCode.CouponNameEmpty]: 'engagement.coupon.empty_name',
  [EngagementErrorCode.CouponExpiryDaysInvalid]:
    'engagement.coupon.invalid_expiry_days',
  [EngagementErrorCode.CouponUsageLimitInvalid]:
    'engagement.coupon.invalid_usage_limit',
  [EngagementErrorCode.CouponOccasionUnknown]:
    'engagement.coupon.occasion_unknown',
  [EngagementErrorCode.CouponValuePercentageInvalid]:
    'engagement.coupon_value.invalid_percentage',
  [EngagementErrorCode.CouponValueAmountNotPositive]:
    'engagement.coupon_value.negative_amount',
  [EngagementErrorCode.CouponGrantCapacityInvalid]:
    'engagement.coupon_grant.invalid_capacity',
  [EngagementErrorCode.CouponGrantNotActive]:
    'engagement.coupon_grant.not_active',
  [EngagementErrorCode.CouponGrantNotExpiring]:
    'engagement.coupon_grant.not_expiring',
  [EngagementErrorCode.CouponGrantReasonEmpty]:
    'engagement.coupon_grant.empty_reason',
  [EngagementErrorCode.DiscountCapInvalid]:
    'engagement.discount_application.invalid_cap',
  [EngagementErrorCode.VoucherCodeInvalid]: 'engagement.voucher_code.invalid',
  [EngagementErrorCode.GiftVoucherValueInvalid]:
    'engagement.gift_voucher.invalid_value',
  [EngagementErrorCode.GiftVoucherNotRedeemable]:
    'engagement.gift_voucher.not_redeemable',
  [EngagementErrorCode.GiftVoucherInsufficientBalance]:
    'engagement.gift_voucher.insufficient_balance',
  [EngagementErrorCode.GiftVoucherOverRestore]:
    'engagement.gift_voucher.over_restore',
  [EngagementErrorCode.GiftVoucherCurrencyMismatch]:
    'engagement.gift_voucher.currency_mismatch',
  [EngagementErrorCode.PointsInvalid]: 'engagement.points.invalid',
  [EngagementErrorCode.PointsInsufficient]: 'engagement.points.insufficient',
  [EngagementErrorCode.InvitationInviterNameEmpty]:
    'engagement.invitation.empty_inviter_name',
  [EngagementErrorCode.InvitationRedemptionCountInvalid]:
    'engagement.invitation.invalid_redemption_count',
  [EngagementErrorCode.InvitationSelfRedemption]:
    'engagement.invitation.self_redemption',
  [EngagementErrorCode.BadgeCategoryOrderNegative]:
    'engagement.badge_category.order_negative',
  [EngagementErrorCode.BadgeSeriesNoLevels]:
    'engagement.badge_series.no_levels',
  [EngagementErrorCode.BadgeSeriesLevelGap]:
    'engagement.badge_series.level_gap',
  [EngagementErrorCode.BadgeSeriesTargetsNotRising]:
    'engagement.badge_series.targets_not_rising',
  [EngagementErrorCode.BadgeSeriesHomeless]: 'engagement.badge_series.homeless',
  [EngagementErrorCode.BadgeSeriesOneOffWithSeveralLevels]:
    'engagement.badge_series.one_off_with_several_levels',
  [EngagementErrorCode.BadgeSeriesRepeatableWithSeveralLevels]:
    'engagement.badge_series.repeatable_with_several_levels',
  [EngagementErrorCode.BadgeSeriesLevelWithoutRule]:
    'engagement.badge_series.level_without_rule',
  [EngagementErrorCode.BadgeSeriesAwardNotPositive]:
    'engagement.badge_series.award_not_positive',
  [EngagementErrorCode.SeasonWindowMalformed]:
    'engagement.season.window_malformed',
  [EngagementErrorCode.SeasonWindowInverted]:
    'engagement.season.window_inverted',
  [EngagementErrorCode.SeasonEventWithTrack]:
    'engagement.season.event_with_track',
  [EngagementErrorCode.SeasonWithoutTrack]: 'engagement.season.without_track',
  [EngagementErrorCode.SeasonAnnouncedLate]: 'engagement.season.announced_late',
  [EngagementErrorCode.LoyaltyCatalogDanglingCategory]:
    'engagement.loyalty_catalog.dangling_category',
  [EngagementErrorCode.LoyaltyCatalogDanglingSeason]:
    'engagement.loyalty_catalog.dangling_season',
  [EngagementErrorCode.LoyaltyCatalogDuplicateId]:
    'engagement.loyalty_catalog.duplicate_id',
  [EngagementErrorCode.LoyaltyCatalogTiersNotRising]:
    'engagement.loyalty_catalog.tiers_not_rising',
  [EngagementErrorCode.LoyaltyCatalogCostNotPositive]:
    'engagement.loyalty_catalog.cost_not_positive',
  [EngagementErrorCode.StreakIdEmpty]: 'engagement.streak_definition.id_empty',
  [EngagementErrorCode.StreakNameEmpty]:
    'engagement.streak_definition.name_empty',
  [EngagementErrorCode.StreakVersionNotPositive]:
    'engagement.streak_definition.version_not_positive',
  [EngagementErrorCode.StreakEffectiveDayInvalid]:
    'engagement.streak_definition.effective_day_invalid',
  [EngagementErrorCode.StreakUnknownOption]:
    'engagement.streak_definition.unknown_option',
  [EngagementErrorCode.StreakQualifierEmpty]:
    'engagement.streak_definition.qualifier_empty',
  [EngagementErrorCode.StreakMinGapOutOfRange]:
    'engagement.streak_definition.min_gap_out_of_range',
  [EngagementErrorCode.StreakBookingHoldOutOfRange]:
    'engagement.streak_definition.booking_hold_out_of_range',
  [EngagementErrorCode.StreakIntervalOutOfRange]:
    'engagement.streak_definition.interval_out_of_range',
  [EngagementErrorCode.StreakToleranceOutOfRange]:
    'engagement.streak_definition.tolerance_out_of_range',
  [EngagementErrorCode.StreakClampInverted]:
    'engagement.streak_definition.clamp_inverted',
  [EngagementErrorCode.StreakFallbackOutsideClamp]:
    'engagement.streak_definition.fallback_outside_clamp',
  [EngagementErrorCode.StreakGraceOutOfRange]:
    'engagement.streak_definition.grace_out_of_range',
  [EngagementErrorCode.StreakGraceNotShorterThanInterval]:
    'engagement.streak_definition.grace_not_shorter_than_interval',
  [EngagementErrorCode.StreakRiskLeadOutOfRange]:
    'engagement.streak_definition.risk_lead_out_of_range',
  [EngagementErrorCode.StreakProtectionsOutOfRange]:
    'engagement.streak_definition.protections_out_of_range',
  [EngagementErrorCode.StreakStartWithAboveCap]:
    'engagement.streak_definition.start_with_above_cap',
  [EngagementErrorCode.StreakUnknownExcuse]:
    'engagement.streak_definition.unknown_excuse',
  [EngagementErrorCode.StreakClientPauseOutOfRange]:
    'engagement.streak_definition.client_pause_out_of_range',
  [EngagementErrorCode.StreakRepairOutOfRange]:
    'engagement.streak_definition.repair_out_of_range',
  [EngagementErrorCode.StreakScheduleVersionNotRising]:
    'engagement.streak_schedule.version_not_rising',
  [EngagementErrorCode.StreakScheduleNotAfterCurrent]:
    'engagement.streak_schedule.scheduled_not_after_current',
  [EngagementErrorCode.NotificationReadBeforeSent]:
    'engagement.notification.read_before_sent',
  [EngagementErrorCode.PositionSortOrderInvalid]:
    'engagement.position.invalid_sort_order',
  [EngagementErrorCode.PositionApplyUrlInvalid]:
    'engagement.position.invalid_apply_url',
  [EngagementErrorCode.CourseSortOrderInvalid]:
    'engagement.course.invalid_sort_order',
  [EngagementErrorCode.CourseApplyUrlInvalid]:
    'engagement.course.invalid_apply_url',
  [EngagementErrorCode.ShopEventSortOrderInvalid]:
    'engagement.shop_event.invalid_sort_order',
  [EngagementErrorCode.ShopEventApplyUrlInvalid]:
    'engagement.shop_event.invalid_apply_url',
  // StreakPublishErrorCode
  [StreakPublishErrorCode.Stale]: 'loyalty.streak_publish.stale',
  [StreakPublishErrorCode.Invalid]: 'loyalty.streak_publish.invalid',
  [StreakPublishErrorCode.TooEarly]: 'loyalty.streak_publish.too_early',
  [StreakPublishErrorCode.RecomputeNeedsEngine]:
    'loyalty.streak_publish.recompute_needs_engine',
  [StreakPublishErrorCode.PreviewStale]: 'loyalty.streak_publish.preview_stale',
  // GovernanceErrorCode
  [GovernanceErrorCode.AuditEntryEmptyAction]:
    'governance.audit_entry.empty_action',
  [GovernanceErrorCode.FeatureFlagsUnknownKey]:
    'governance.feature_flags.unknown_key',
  [GovernanceErrorCode.FeatureFlagsInvalidValue]:
    'governance.feature_flags.invalid_value',
  [GovernanceErrorCode.ImpersonationScopeInvalid]:
    'governance.impersonation_scope.invalid',
  [GovernanceErrorCode.ImpersonationSelf]:
    'governance.impersonation_session.self_impersonation',
  [GovernanceErrorCode.ImpersonationReasonRequired]:
    'governance.impersonation_session.reason_required',
  [GovernanceErrorCode.ImpersonationInvalidExpiry]:
    'governance.impersonation_session.invalid_expiry',
  [GovernanceErrorCode.ImpersonationAdminNotStaff]:
    'governance.impersonation_session.admin_not_staff',
  [GovernanceErrorCode.ImpersonationAlreadyEnded]:
    'governance.impersonation_session.already_ended',
  [GovernanceErrorCode.EndImpersonationNotFound]:
    'governance.end_impersonation.not_found',
  [GovernanceErrorCode.SearchUsersQueryTooShort]:
    'governance.search_users.query_too_short',
  // IdentityErrorCode
  [IdentityErrorCode.OtpAlreadyConsumed]: 'identity.otp.already_consumed',
  [IdentityErrorCode.OtpExpired]: 'identity.otp.expired',
  [IdentityErrorCode.OtpLockedOut]: 'identity.otp.locked_out',
  [IdentityErrorCode.OtpWrongCode]: 'identity.otp.wrong_code',
  [IdentityErrorCode.IdentifierInvalid]: 'identity.identifier.invalid',
  [IdentityErrorCode.OtpCodeInvalid]: 'identity.otp_code.invalid',
  [IdentityErrorCode.BirthDateInvalid]: 'identity.birth_date.invalid',
  [IdentityErrorCode.BirthDateInFuture]: 'identity.birth_date.in_future',
  [IdentityErrorCode.BirthDateTooYoung]: 'identity.birth_date.too_young',
  [IdentityErrorCode.BirthDateTooOld]: 'identity.birth_date.too_old',
  [IdentityErrorCode.AuthClaimsEmptyRoles]: 'identity.auth_claims.empty_roles',
  [IdentityErrorCode.AuthStrategyUnknownKind]:
    'identity.auth_strategy.unknown_kind',
  [IdentityErrorCode.AuthStrategyUnknownField]:
    'identity.auth_strategy.unknown_field',
  [IdentityErrorCode.AuthStrategyRequiredEmpty]:
    'identity.auth_strategy.required_empty',
  [IdentityErrorCode.AuthStrategyPhoneMissing]:
    'identity.auth_strategy.phone_missing',
  [IdentityErrorCode.AuthStrategyInvalidPolicy]:
    'identity.auth_strategy.invalid_policy',
  [IdentityErrorCode.AuthFlowInvalidTransition]:
    'identity.auth_flow.invalid_transition',
  [IdentityErrorCode.OnboardingFlowInvalidTransition]:
    'identity.onboarding_flow.invalid_transition',
  // AccountsErrorCode
  [AccountsErrorCode.BlockReasonInvalid]: 'accounts.block_reason.invalid',
  [AccountsErrorCode.UserRoleInvalid]: 'accounts.user_role.invalid',
  [AccountsErrorCode.UserRolesEmpty]: 'accounts.user.roles_empty',
  [AccountsErrorCode.FirstNameTooShort]: 'accounts.first_name.too_short',
  [AccountsErrorCode.LastNameTooShort]: 'accounts.last_name.too_short',
  [AccountsErrorCode.EmailInvalid]: 'accounts.email.invalid',
  [AccountsErrorCode.UpdateProfileNotFound]:
    'accounts.update_profile.not_found',
  [AccountsErrorCode.UpdateProfileValidationFailed]:
    'accounts.update_profile.validation_failed',
  [AccountsErrorCode.UploadAvatarNotAnImage]:
    'accounts.upload_avatar.not_an_image',
  [AccountsErrorCode.UploadAvatarTooLarge]: 'accounts.upload_avatar.too_large',
  // MediaErrorCode
  [MediaErrorCode.NotFound]: 'media.not_found',
  [MediaErrorCode.Forbidden]: 'media.forbidden',
  [MediaErrorCode.Transient]: 'media.transient',
  // MoneyErrorCode
  [MoneyErrorCode.InvalidAmount]: 'money.invalid_amount',
  [MoneyErrorCode.CurrencyMismatch]: 'money.currency_mismatch',
  [MoneyErrorCode.UnknownCurrency]: 'money.unknown_currency',
  [MoneyErrorCode.InvalidRatio]: 'money.invalid_ratio',
  // PhoneErrorCode
  [PhoneErrorCode.Invalid]: 'phone.invalid',
  [PhoneErrorCode.CountryUnsupported]: 'phone.country_unsupported',
  // PipelineErrorCode
  [PipelineErrorCode.Unauthenticated]: 'pipeline.unauthenticated',
  [PipelineErrorCode.SlotUnavailable]: 'pipeline.slot_unavailable',
  [PipelineErrorCode.CatalogChanged]: 'pipeline.catalog_changed',
  [PipelineErrorCode.InvalidRequest]: 'pipeline.invalid_request',
  [PipelineErrorCode.Unavailable]: 'pipeline.unavailable',
  [PipelineErrorCode.Unknown]: 'pipeline.unknown',
  // RepositoryErrorCode
  [RepositoryErrorCode.ReadFailed]: 'repo.read_failed',
  [RepositoryErrorCode.WriteFailed]: 'repo.write_failed',
  [RepositoryErrorCode.AlreadyExists]: 'repo.already_exists',
  [RepositoryErrorCode.Malformed]: 'repo.malformed',
  [RepositoryErrorCode.Unavailable]: 'repository.unavailable',
};

/**
 * A struct field the flatten pass renamed, by the name today's wire gives
 * it where a `field` param names it (flatten-spec N2: `dayKey` →
 * `localDate`). Read by {@link ParamFormat.WireField}.
 */
export const WIRE_FIELD_NAME: { readonly [field: string]: string } = {
  localDate: 'dayKey',
};

const LEGACY_WIRE_CODE_BY_CODE = new Map<string, string>(
  Object.entries(LEGACY_WIRE_CODE),
);

/** Each rule stamped with the code it leaves as. */
function withWireCodes<C extends string>(
  table: WireTable<C>,
): { readonly [K in C]: WireRule } {
  const stamped = new Map<string, WireRule>();
  for (const [code, rule] of Object.entries<RuleBody>(table)) {
    stamped.set(code, {
      ...rule,
      wireCode: LEGACY_WIRE_CODE_BY_CODE.get(code) ?? code,
    });
  }
  return Object.fromEntries(stamped) as { readonly [K in C]: WireRule };
}

/** The whole table — total over {@link EdgeCode} by its type. */
export const EDGE_WIRE: { readonly [K in EdgeCode]: WireRule } =
  withWireCodes<EdgeCode>({
    ...ACCOUNTS_WIRE,
    ...PRIMITIVE_WIRE,
    ...BOOKING_WIRE,
    ...BOOKING_FLOW_WIRE,
    ...CANCELLATION_WIRE,
    ...CATALOG_WIRE,
    ...ENGAGEMENT_WIRE,
    ...GOVERNANCE_WIRE,
    ...IDENTITY_WIRE,
    ...MEDIA_WIRE,
    ...MONEY_WIRE,
    ...MOVE_WIRE,
    ...PHONE_WIRE,
    ...PIPELINE_WIRE,
    ...REPOSITORY_WIRE,
    ...SCHEDULING_WIRE,
    ...STAFF_EDIT_WIRE,
    ...STREAK_PUBLISH_WIRE,
    ...TIME_WIRE,
    ...WAITLIST_WIRE,
    ...LEGACY_WIRE,
  });

const WIRE_BY_CODE = new Map<string, WireRule>(Object.entries(EDGE_WIRE));

/** A code the table does not know (a struct typed loosely at runtime): `internal`, code and empty params. */
const UNMAPPED: ThrownWireRule = params(S.Internal);

/** The rule a code leaves by — an unknown code leaves `internal`, as itself. */
export function wireRuleOf(code: string): WireRule {
  return WIRE_BY_CODE.get(code) ?? { ...UNMAPPED, wireCode: code };
}

/** True when the callable answers this refusal instead of throwing it. */
export function isAnswered(code: string): boolean {
  return wireRuleOf(code).wireShape === WireShape.Answered;
}

// ── Result.err → HttpsError ────────────────────────────────────────────────

/**
 * The zone an `*Iso` param is spelled in: the shop's. This deployment is one
 * tenant whose every location keeps the tenant's clock — the same zone the
 * schedules in `main.ts` run on — so the shop zone today's handlers format
 * with (`snapshot.zone`, `shop.timezone`) is this one. It stays the legacy
 * tenant zone until every pipeline hands the edge its location's
 * `timeZone` (flatten-spec F-4, F-10).
 */
export const WIRE_ZONE: TimeZone = wireZone(TENANT_ZONE);

function wireZone(raw: string): TimeZone {
  const zone = ZonedTimeSystem.checkZone(raw);
  return zone.ok
    ? zone.value
    : defect(`the tenant zone ${raw} is not an IANA zone`);
}

/** Minutes in a shop day — an exclusive end of `1440` is the next day's start. */
const MINUTES_PER_DAY = 1440;

/**
 * A shop wall clock as the shop-clock ISO instant, or left out (not a day or
 * a minute, or a DST gap). The minute may be an exclusive end: `1440` is the
 * next day's first instant.
 */
function wallIsoParam(day: unknown, minute: unknown): string | undefined {
  if (typeof day !== 'string' || typeof minute !== 'number') return undefined;
  const localDate = LocalDate.parse(day);
  if (!localDate.ok) return undefined;
  if (minute === MINUTES_PER_DAY) {
    return ZonedTimeSystem.toIso(
      ZonedTimeSystem.startOfLocalDay(
        LocalDate.addDays(localDate.value, 1),
        WIRE_ZONE,
      ),
      WIRE_ZONE,
    );
  }
  const minuteOfDay = MinuteOfDay.of(minute);
  if (!minuteOfDay.ok) return undefined;
  const instant = ZonedTimeSystem.toUtc(
    localDate.value,
    minuteOfDay.value,
    WIRE_ZONE,
  );
  return instant.ok
    ? ZonedTimeSystem.toIso(instant.value, WIRE_ZONE)
    : undefined;
}

/** A `field` value as the wire has always spelt it ({@link ParamFormat.WireField}). */
function wireFieldParam(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return (
    WIRE_FIELD_NAME_BY_NAME.get(value) ??
    LEGACY_WIRE_CODE_BY_CODE.get(value) ??
    value
  );
}

const WIRE_FIELD_NAME_BY_NAME = new Map<string, string>(
  Object.entries(WIRE_FIELD_NAME),
);

function fieldOf(error: EdgeError, field: string): unknown {
  return new Map<string, unknown>(Object.entries(error)).get(field);
}

function paramValue(error: EdgeError, param: WireParam): unknown {
  const value = fieldOf(error, param.field);
  if (value === null || value === undefined) return undefined;
  switch (param.paramFormat) {
    case ParamFormat.Raw:
      return value;
    case ParamFormat.Text:
      return String(value);
    case ParamFormat.ZonedWallIso:
      return wallIsoParam(
        value,
        param.minuteField === null ? null : fieldOf(error, param.minuteField),
      );
    case ParamFormat.Csv:
      return Array.isArray(value) ? value.join(',') : String(value);
    case ParamFormat.WireField:
      return wireFieldParam(value);
  }
}

/**
 * The listed fields, formatted; an absent (`null`) field is left out, as
 * today's optional params are. (Legacy `before_arrival` could spell a
 * missing arrival as `arrivedAtIso: ''`; the ecs-core refusal always carries
 * the arrival's wall clock, so that branch never reaches the wire.)
 */
export function wireParamsOf(
  error: EdgeError,
  wireParams: readonly WireParam[],
): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const param of wireParams) {
    const value = paramValue(error, param);
    if (value !== undefined) entries.push([param.wireName, value]);
  }
  return Object.fromEntries(entries);
}

function isEdgeError(value: unknown): value is EdgeError {
  return (
    value !== null &&
    typeof value === 'object' &&
    (('errorCode' in value && typeof value.errorCode === 'string') ||
      ('code' in value && typeof value.code === 'string'))
  );
}

/** An aggregate's nested refusals, each `{ code, params }` by its own rule. */
function nestedOf(error: EdgeError): readonly {
  readonly code: string;
  readonly params: Record<string, unknown>;
}[] {
  const nested = fieldOf(error, 'errors');
  if (!Array.isArray(nested)) return [];
  return nested.filter(isEdgeError).map((inner) => {
    const rule = wireRuleOf(errorCodeOf(inner));
    return {
      code: rule.wireCode,
      params:
        rule.wireShape === WireShape.Answered
          ? {}
          : wireParamsOf(inner, rule.wireParams),
    };
  });
}

/** The `details` a refusal leaves with — exactly one of today's shapes. */
export function wireDetails(error: EdgeError): Record<string, unknown> {
  const rule = wireRuleOf(errorCodeOf(error));
  switch (rule.wireShape) {
    case WireShape.CodeOnly:
    case WireShape.Answered:
      return { code: rule.wireCode };
    case WireShape.CodeAndParams:
      return {
        code: rule.wireCode,
        params: wireParamsOf(error, rule.wireParams),
      };
    case WireShape.Errors:
      return { errors: nestedOf(error) };
    case WireShape.CodeAndErrors:
      return { code: rule.wireCode, errors: nestedOf(error) };
  }
}

/**
 * The one `Result.err` → `HttpsError` mapping. The message is the stable
 * code (no client reads it; the UI words `details`). An ANSWERED refusal
 * that reaches here was wired to a callable that does not answer it:
 * `internal`, never a status that would invite the client to act on it.
 */
export function toHttpsError(error: EdgeError): HttpsError {
  const rule = wireRuleOf(errorCodeOf(error));
  const status =
    rule.wireShape === WireShape.Answered ? S.Internal : rule.httpsStatus;
  return new HttpsError(status, rule.wireCode, wireDetails(error));
}

// ── Work budget ────────────────────────────────────────────────────────────

/** Cloud Functions gen 2's timeout when a definition sets none. */
export const PLATFORM_TIMEOUT_SECONDS = 60;

/**
 * One invocation's allowance of new work, started when the edge starts the
 * handler (`work-budget.ts`'s `timeBudget`, as data plus the one clock
 * question): a budgeted walk takes no new unit once `spent()`.
 */
export type WorkBudget = {
  readonly startedMs: number;
  readonly limitMs: number;
  readonly spent: () => boolean;
};

export const workBudget = (nowUtcMs: NowUtcMs, limitMs: number): WorkBudget => {
  const startedMs = nowUtcMs();
  return {
    startedMs,
    limitMs,
    spent: () => WorkBudgetSystem.isSpent(startedMs, nowUtcMs(), limitMs),
  };
};

// ── The wrappers ───────────────────────────────────────────────────────────

/** What the edge itself reads: telemetry and the clock (`NowUtcMs`, flatten-spec T4). */
export type EdgePorts = TelemetryPorts & { readonly nowUtcMs: NowUtcMs };

/** The platform's own answer to an uncaught throw: `internal`, `INTERNAL`, no details. */
const PLATFORM_INTERNAL_MESSAGE = 'INTERNAL';

/**
 * A throw the handler did not answer. An `HttpsError` passes through as
 * thrown (a legacy handler's own answer); anything else is tracked — ids
 * and the callable's name, never the payload — and answered with the
 * callable's coded failure, or with the platform's bare INTERNAL exactly as
 * an uncaught throw is answered today.
 */
function unexpected(
  callable: CallableName,
  failureCode: EdgeCode | null,
  ports: TelemetryPorts,
  thrown: unknown,
): HttpsError {
  if (thrown instanceof HttpsError) return thrown;
  ports.trackError(thrown, { callable });
  return failureCode === null
    ? new HttpsError(S.Internal, PLATFORM_INTERNAL_MESSAGE)
    : toHttpsError({ code: failureCode });
}

/** How one callable meets the wire. */
export type CallableSpec<Out> = {
  readonly callable: CallableName;
  /**
   * The code an infrastructure failure answers with — today's coded
   * `internal` (`booking.commit.store_failed`) — or `null` for the
   * platform's bare INTERNAL.
   */
  readonly failureCode: EdgeCode | null;
  /** The definition's `timeoutSeconds`, which the work budget is a share of; `null`: the platform's. */
  readonly timeoutSeconds: number | null;
  /** How an ANSWERED refusal becomes the callable's answer; `null` when it answers none. */
  readonly answer: ((refusal: EdgeError) => Out) | null;
};

/**
 * A pipeline as a callable handler: `Result.ok` is the answer, an ANSWERED
 * refusal is answered, any other `Result.err` is thrown as the table says,
 * and an infrastructure throw is tracked and answered as {@link unexpected}
 * says. The budget is a share of whichever gives up first — the platform's
 * timeout or the callable client's 70 s wait.
 */
export const callableEdge =
  <In, Out>(
    spec: CallableSpec<Out>,
    ports: EdgePorts,
    handle: (
      request: CallableRequest<In>,
      budget: WorkBudget,
    ) => Promise<Result<Out, EdgeError>>,
  ) =>
  async (request: CallableRequest<In>): Promise<Out> => {
    const budget = workBudget(
      ports.nowUtcMs,
      WorkBudgetSystem.callableBudgetMs(
        spec.timeoutSeconds ?? PLATFORM_TIMEOUT_SECONDS,
      ),
    );
    let result: Result<Out, EdgeError>;
    try {
      result = await handle(request, budget);
    } catch (thrown) {
      throw unexpected(spec.callable, spec.failureCode, ports, thrown);
    }
    if (result.ok) return result.value;
    if (spec.answer !== null && isAnswered(errorCodeOf(result.error))) {
      return spec.answer(result.error);
    }
    throw toHttpsError(result.error);
  };

/**
 * Phase 3a: a callable whose handler is still today's `lib/**` code. Its
 * own `HttpsError`s pass through untouched — same status, message and
 * details — and an unexpected throw is tracked through telemetry and
 * answered exactly as the platform answers it today. Deleted with the last
 * legacy row.
 */
export const legacyCallable =
  <In, Out>(
    callable: CallableName,
    ports: TelemetryPorts,
    run: (request: CallableRequest<In>) => Out | Promise<Out>,
  ) =>
  async (request: CallableRequest<In>): Promise<Out> => {
    try {
      return await run(request);
    } catch (thrown) {
      throw unexpected(callable, null, ports, thrown);
    }
  };

/** How one retrying trigger meets the platform. */
export type TriggerSpec = {
  /** The export's name — the `fn` of the attempt line. */
  readonly fn: string;
  /** The definition's `timeoutSeconds`; `null`: the platform's. */
  readonly timeoutSeconds: number | null;
};

/** What the attempt line reads off a delivery: its id and its own wire time. */
export type DeliveredEvent = { readonly id: string; readonly time: string };

/**
 * A `retry: true` trigger's tail (`trigger-attempts.ts`'s `reportAttempt`):
 * a failed attempt logs its ONE line — ids and codes, and how deep into
 * the retry window it is — then rethrows what a redelivery could fix and
 * returns on the rest, which would fail the same way for the whole window.
 */
export const retryingTrigger =
  <E extends DeliveredEvent>(
    spec: TriggerSpec,
    ports: EdgePorts,
    handle: (event: E, budget: WorkBudget) => Promise<void>,
  ) =>
  async (event: E): Promise<void> => {
    const budget = workBudget(
      ports.nowUtcMs,
      WorkBudgetSystem.budgetMsFor(
        spec.timeoutSeconds ?? PLATFORM_TIMEOUT_SECONDS,
      ),
    );
    try {
      await handle(event, budget);
    } catch (thrown) {
      const failure = TriggerAttemptSystem.attemptFailure(thrown);
      const eventAt = UtcEpochMs.of(Date.parse(event.time));
      const line = TriggerAttemptSystem.attemptLine(
        spec.fn,
        {
          id: TriggerEventId.of(event.id),
          eventAtUtcMs: eventAt.ok ? eventAt.value : null,
        },
        failure,
        ports.nowUtcMs(),
      );
      ports.log('error', 'trigger attempt failed', legacyAttemptLine(line));
      if (failure.attemptOutcome === AttemptOutcome.Transient) throw thrown;
    }
  };

/** The attempt outcome as today's log line spells it (`lib/trigger-attempts.ts`). */
const LEGACY_ATTEMPT_OUTCOME: { readonly [K in AttemptOutcome]: string } = {
  [AttemptOutcome.Transient]: 'transient',
  [AttemptOutcome.Permanent]: 'permanent',
};

/**
 * The ONE attempt line in today's keys and values — `{ fn, eventId,
 * outcome, code, ageMs }`, what the log queries read — until Phase 4 moves
 * the logs with the rest of the wire.
 */
function legacyAttemptLine(line: AttemptLine): Record<string, unknown> {
  return {
    fn: line.fn,
    eventId: line.eventId,
    outcome: LEGACY_ATTEMPT_OUTCOME[line.attemptOutcome],
    code: line.failureCode,
    ageMs: line.ageMs,
  };
}
