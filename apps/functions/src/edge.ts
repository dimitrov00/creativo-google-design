import {
  type CallableRequest,
  type FunctionsErrorCode,
  HttpsError,
} from 'firebase-functions/v2/https';
import {
  AccountsErrorCode,
  AttemptOutcome,
  BookingCommitErrorCode,
  BookingFlowErrorCode,
  type CallableName,
  CancellationRefusalCode,
  CatalogErrorCode,
  EngagementErrorCode,
  GovernanceErrorCode,
  IdentityErrorCode,
  MediaErrorCode,
  MoneyErrorCode,
  MoveErrorCode,
  type NowMs,
  PhoneErrorCode,
  PipelineErrorCode,
  RepositoryErrorCode,
  type Result,
  SchedulingErrorCode,
  StaffEditErrorCode,
  StreakPublishErrorCode,
  type TelemetryPorts,
  TenantConfig,
  TimeErrorCode,
  TriggerAttemptSystem,
  WaitlistErrorCode,
  WorkBudgetSystem,
  ZonedTimeSystem,
} from '@creativo/ecs-core';

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
  BookingCommitErrorCode,
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
  | BookingCommitErrorCode
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
 * A refusal as a pipeline returns it: the dotted `code` and the struct's
 * own fields (i18n parameters, ids, figures). Every ecs-core error struct
 * is one; an aggregate carries its nested refusals as `errors`.
 */
export type EdgeError = { readonly code: EdgeCode } & {
  readonly [field: string]: unknown;
};

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
   * An epoch-ms field as an ISO-8601 instant on the SHOP's clock with its
   * offset (`2026-10-10T14:00:00.000+03:00`) — today's `*Iso` params, which
   * the handlers spell with `ZonedDateTime.toISO()` in the shop zone (or echo
   * the caller's own shop-offset `startIso`). See {@link WIRE_ZONE}.
   */
  IsoInstant: 'ISO_INSTANT',
  /** An array joined by commas — today's `seatIds: 'a,b'`. */
  Csv: 'CSV',
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
export type WireRule = ThrownWireRule | AnsweredWireRule;

type WireTable<C extends string> = { readonly [K in C]: WireRule };

const S = HttpsStatus;

const raw = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Raw,
});
const text = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Text,
});
const iso = (wireName: string, msField: string): WireParam => ({
  wireName,
  field: msField,
  paramFormat: ParamFormat.IsoInstant,
});
const csv = (field: string): WireParam => ({
  wireName: field,
  field,
  paramFormat: ParamFormat.Csv,
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
  rule: WireRule,
  exceptions: Partial<Record<C, WireRule>>,
): WireTable<C> {
  const overrides = new Map<string, WireRule>(Object.entries(exceptions));
  const table = new Map<string, WireRule>();
  for (const code of Object.values(dictionary)) {
    table.set(code, overrides.get(code) ?? rule);
  }
  return Object.fromEntries(table) as WireTable<C>;
}

// Statuses for codes no callable returns yet follow today's precedents: a
// refusal of what was sent is `invalid-argument`, a state that forbids it
// `failed-precondition`, a stored or configured value the server cannot
// stand by `internal` (today's `repository_failure`), a lost race `aborted`.

const BOOKING_COMMIT_WIRE: WireTable<BookingCommitErrorCode> = {
  [BookingCommitErrorCode.Unauthenticated]: params(S.Unauthenticated),
  // `detail` (a person key, a location) and `reason` stay OFF the wire.
  [BookingCommitErrorCode.InvalidInput]: params(
    S.InvalidArgument,
    raw('field'),
  ),
  [BookingCommitErrorCode.UnknownService]: params(S.NotFound, raw('serviceId')),
  [BookingCommitErrorCode.ServiceNotAtLocation]: params(
    S.FailedPrecondition,
    raw('serviceId'),
    raw('locationId'),
  ),
  [BookingCommitErrorCode.ConflictingServices]: params(
    S.FailedPrecondition,
    raw('first'),
    raw('second'),
  ),
  [BookingCommitErrorCode.BarberNotRostered]: params(
    S.FailedPrecondition,
    raw('barberId'),
    raw('dayKey'),
  ),
  // `aborted`: the honest status of a lost race, retryable as no other is.
  [BookingCommitErrorCode.SlotUnavailable]: params(
    S.Aborted,
    raw('barberId'),
    iso('startIso', 'startMs'),
  ),
  [BookingCommitErrorCode.TooSoon]: params(
    S.FailedPrecondition,
    text('minLeadMinutes'),
  ),
  [BookingCommitErrorCode.BeyondHorizon]: params(
    S.FailedPrecondition,
    text('horizonMonths'),
  ),
  [BookingCommitErrorCode.PartyTooLarge]: params(
    S.FailedPrecondition,
    text('maxPartySize'),
  ),
  // The violations stay on the server, as today.
  [BookingCommitErrorCode.InvariantViolated]: params(S.InvalidArgument),
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
    iso('startIso', 'startMs'),
    raw('edge'),
  ),
  [StaffEditErrorCode.BeforeArrival]: params(
    S.FailedPrecondition,
    iso('endIso', 'finishMs'),
    iso('arrivedAtIso', 'arrivedAtMs'),
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
  [WaitlistErrorCode.InvalidRequest]: params(S.InvalidArgument, raw('field')),
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

/** The whole table — total over {@link EdgeCode} by its type. */
export const EDGE_WIRE: WireTable<EdgeCode> = {
  ...ACCOUNTS_WIRE,
  ...BOOKING_COMMIT_WIRE,
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
};

const WIRE_BY_CODE = new Map<string, WireRule>(Object.entries(EDGE_WIRE));

/** A code the table does not know (a struct typed loosely at runtime): `internal`, code and empty params. */
const UNMAPPED: ThrownWireRule = params(S.Internal);

/** The rule a code leaves by. */
export function wireRuleOf(code: string): WireRule {
  return WIRE_BY_CODE.get(code) ?? UNMAPPED;
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
 * with (`snapshot.zone`, `shop.timezone`) is this one.
 */
export const WIRE_ZONE = TenantConfig.DEFAULT.zone;

/** An epoch-ms figure as the shop-clock ISO instant, or left out when it is not one. */
function isoParam(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const iso = ZonedTimeSystem.isoOf(value, WIRE_ZONE);
  return iso.ok ? iso.value : undefined;
}

function fieldOf(error: EdgeError, field: string): unknown {
  return new Map<string, unknown>(Object.entries(error)).get(field);
}

function paramValue(value: unknown, format: ParamFormat): unknown {
  if (value === null || value === undefined) return undefined;
  switch (format) {
    case ParamFormat.Raw:
      return value;
    case ParamFormat.Text:
      return String(value);
    case ParamFormat.IsoInstant:
      return isoParam(value);
    case ParamFormat.Csv:
      return Array.isArray(value) ? value.join(',') : String(value);
  }
}

/**
 * The listed fields, formatted; an absent (`null`) field is left out, as
 * today's optional params are. (Legacy `before_arrival` could spell a
 * missing arrival as `arrivedAtIso: ''`; the ecs-core refusal always carries
 * `arrivedAtMs`, so that branch never reaches the wire.)
 */
function wireParamsOf(
  error: EdgeError,
  wireParams: readonly WireParam[],
): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const param of wireParams) {
    const value = paramValue(fieldOf(error, param.field), param.paramFormat);
    if (value !== undefined) entries.push([param.wireName, value]);
  }
  return Object.fromEntries(entries);
}

function isEdgeError(value: unknown): value is EdgeError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    typeof value.code === 'string'
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
    const rule = wireRuleOf(inner.code);
    return {
      code: inner.code,
      params:
        rule.wireShape === WireShape.Answered
          ? {}
          : wireParamsOf(inner, rule.wireParams),
    };
  });
}

/** The `details` a refusal leaves with — exactly one of today's shapes. */
export function wireDetails(error: EdgeError): Record<string, unknown> {
  const rule = wireRuleOf(error.code);
  switch (rule.wireShape) {
    case WireShape.CodeOnly:
    case WireShape.Answered:
      return { code: error.code };
    case WireShape.CodeAndParams:
      return { code: error.code, params: wireParamsOf(error, rule.wireParams) };
    case WireShape.Errors:
      return { errors: nestedOf(error) };
    case WireShape.CodeAndErrors:
      return { code: error.code, errors: nestedOf(error) };
  }
}

/**
 * The one `Result.err` → `HttpsError` mapping. The message is the stable
 * code (no client reads it; the UI words `details`). An ANSWERED refusal
 * that reaches here was wired to a callable that does not answer it:
 * `internal`, never a status that would invite the client to act on it.
 */
export function toHttpsError(error: EdgeError): HttpsError {
  const rule = wireRuleOf(error.code);
  const status =
    rule.wireShape === WireShape.Answered ? S.Internal : rule.httpsStatus;
  return new HttpsError(status, error.code, wireDetails(error));
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

export const workBudget = (nowMs: NowMs, limitMs: number): WorkBudget => {
  const startedMs = nowMs();
  return {
    startedMs,
    limitMs,
    spent: () => WorkBudgetSystem.isSpent(startedMs, nowMs(), limitMs),
  };
};

// ── The wrappers ───────────────────────────────────────────────────────────

/** What the edge itself reads: telemetry and the clock. */
export type EdgePorts = TelemetryPorts & { readonly nowMs: NowMs };

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
      ports.nowMs,
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
    if (spec.answer !== null && isAnswered(result.error.code)) {
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
      ports.nowMs,
      WorkBudgetSystem.budgetMsFor(
        spec.timeoutSeconds ?? PLATFORM_TIMEOUT_SECONDS,
      ),
    );
    try {
      await handle(event, budget);
    } catch (thrown) {
      const failure = TriggerAttemptSystem.attemptFailure(thrown);
      const atMs = Date.parse(event.time);
      ports.log('error', 'trigger attempt failed', {
        ...TriggerAttemptSystem.attemptLine(
          spec.fn,
          { id: event.id, atMs: Number.isNaN(atMs) ? null : atMs },
          failure,
          ports.nowMs(),
        ),
      });
      if (failure.outcome === AttemptOutcome.Transient) throw thrown;
    }
  };
