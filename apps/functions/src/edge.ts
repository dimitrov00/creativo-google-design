import {
  type CallableRequest,
  type FunctionsErrorCode,
  HttpsError,
} from 'firebase-functions/v2/https';
import {
  PrimitiveErrorCode,
  type Result,
  TriggerEventId,
  UtcEpochMs,
} from '@core/primitives';
import {
  AccountsErrorCode,
  BookingErrorCode,
  BookingFlowErrorCode,
  CancellationRefusalCode,
  CancelWaitlistRefusalCode,
  CatalogErrorCode,
  ClientIssueErrorCode,
  CompleteRegistrationRefusalCode,
  EngagementErrorCode,
  GovernanceErrorCode,
  HttpsStatus,
  IdentityErrorCode,
  MediaErrorCode,
  MoneyErrorCode,
  MoveErrorCode,
  PhoneErrorCode,
  PipelineErrorCode,
  RepositoryErrorCode,
  RunBackfillRefusalCode,
  SchedulingErrorCode,
  StaffEditErrorCode,
  StreakPublishErrorCode,
  TimeErrorCode,
  WaitlistErrorCode,
  WIRE_PARAM_ALLOWLIST,
} from '@core/errors';
import { AttemptOutcome } from '@core/components';
import {
  type CallableName,
  type ClockPorts,
  type NowUtcMs,
  type TelemetryPorts,
} from '@core/ports';
import {
  type AttemptLine,
  TriggerAttemptSystem,
  WorkBudgetSystem,
} from '@core/systems';
import { eventInstantOf } from './wire/wire-read';

/**
 * THE EDGE (blueprint §4.3, D1(a)) — the one place a `Result.err` becomes an
 * `HttpsError`, and the only place, besides a pipeline's write half, that
 * telemetry is invoked. A handler in `main.ts` is `callableEdge(spec, ports,
 * pipeline(bundle))` (or `retryingTrigger` for an event); it holds no logic.
 * A callable any device may dial without a session — the client issue sink
 * (OR-34) — first passes a per-instance token bucket (`throttledCallable`).
 *
 * **The wire, flipped (Phase 4a 4A-4).** A refusal leaves as its ecs-core
 * struct: `HttpsError(status, errorCode, details)`, `details` the struct
 * PROJECTED to its code's allowlist — `errorCode`, then `refusal`/`field`
 * where its row names them, then the scalar context
 * `WIRE_PARAM_ALLOWLIST` (`@core/errors` — the ONE table the web reads
 * through too) lists for the code, under the struct's own field names, as
 * the struct holds them (a wall clock as `localDate` + minutes, a list as a
 * list). A struct field that is not listed NEVER leaves: a person key
 * (`detail`), a refusal's internal `reason`, a violation list, a
 * repository's `path` and cause, a deadline no row names. An aggregate
 * carries its nested refusals as `errors`, each projected by its own row.
 *
 * The table {@link EDGE_WIRE} is TOTAL over every code of every ecs-core
 * error dictionary ({@link EDGE_DICTIONARIES}); its statuses are the ones
 * the legacy wire answered, kept one for one — the web's retry,
 * unauthenticated and blocked paths read them.
 */

// ── The vocabulary ─────────────────────────────────────────────────────────

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
  CancelWaitlistRefusalCode,
  CatalogErrorCode,
  ClientIssueErrorCode,
  CompleteRegistrationRefusalCode,
  EngagementErrorCode,
  GovernanceErrorCode,
  IdentityErrorCode,
  MediaErrorCode,
  MoneyErrorCode,
  MoveErrorCode,
  PhoneErrorCode,
  PipelineErrorCode,
  RepositoryErrorCode,
  RunBackfillRefusalCode,
  SchedulingErrorCode,
  StaffEditErrorCode,
  StreakPublishErrorCode,
  TimeErrorCode,
  WaitlistErrorCode,
} as const;

/** Every code the edge can put on the wire. */
export type EdgeCode =
  | AccountsErrorCode
  | PrimitiveErrorCode
  | BookingErrorCode
  | BookingFlowErrorCode
  | CancellationRefusalCode
  | CancelWaitlistRefusalCode
  | CatalogErrorCode
  | ClientIssueErrorCode
  | CompleteRegistrationRefusalCode
  | EngagementErrorCode
  | GovernanceErrorCode
  | IdentityErrorCode
  | MediaErrorCode
  | MoneyErrorCode
  | MoveErrorCode
  | PhoneErrorCode
  | PipelineErrorCode
  | RepositoryErrorCode
  | RunBackfillRefusalCode
  | SchedulingErrorCode
  | StaffEditErrorCode
  | StreakPublishErrorCode
  | TimeErrorCode
  | WaitlistErrorCode;

/**
 * A refusal as a pipeline returns it: an ecs-core error struct — its code
 * named `errorCode` (Law 7.5) and its own flat fields; an aggregate carries
 * its nested refusals as `errors`.
 */
export type EdgeError = { readonly errorCode: EdgeCode } & {
  readonly [field: string]: unknown;
};

// ── The wire rules ─────────────────────────────────────────────────────────

/** Which `details` a refusal leaves with. */
export const WireShape = {
  /** The projected struct: `{ errorCode, …its listed fields }`. */
  Fields: 'FIELDS',
  /** `{ errors: [<projected struct>, …] }` — an aggregate, no top-level code. */
  Errors: 'ERRORS',
  /** `{ errorCode, errors: [<projected struct>, …] }` — a wrapper code and its cause. */
  CodeAndErrors: 'CODE_AND_ERRORS',
  /** Never thrown: the callable RETURNS it in its answer (the streak publish's refusals). */
  Answered: 'ANSWERED',
} as const;
export type WireShape = (typeof WireShape)[keyof typeof WireShape];

/** The two fields a row may name beside its code's allowlist. */
export const NamedField = {
  /** The payload field an invalid request names. */
  Field: 'field',
  /** The reason one level down a refusal names (a carried seat's). */
  Refusal: 'refusal',
} as const;
export type NamedField = (typeof NamedField)[keyof typeof NamedField];

export type ThrownWireRule = {
  readonly wireShape: Exclude<WireShape, typeof WireShape.Answered>;
  readonly httpsStatus: HttpsStatus;
  /**
   * The struct fields that leave beside `errorCode`, by the struct's own
   * names: the row's named fields, then the code's allowlist. Nothing else
   * ever leaves.
   */
  readonly wireFields: readonly string[];
};
export type AnsweredWireRule = {
  readonly wireShape: typeof WireShape.Answered;
};

/** A code's whole rule: how it leaves. */
export type WireRule = ThrownWireRule | AnsweredWireRule;

/** A row before its code's allowlist is joined on ({@link EDGE_WIRE}). */
type RuleBody =
  | {
      readonly wireShape: Exclude<WireShape, typeof WireShape.Answered>;
      readonly httpsStatus: HttpsStatus;
      readonly named: readonly NamedField[];
    }
  | AnsweredWireRule;

type WireTable<C extends string> = { readonly [K in C]: RuleBody };

/**
 * The statuses the edge answers with — `@core/errors`' {@link HttpsStatus},
 * the one dictionary of the callable protocol's status strings; the
 * `satisfies` keeps the compile-time link to the server SDK's own
 * `FunctionsErrorCode` (every status is one `HttpsError` takes).
 */
const S = HttpsStatus satisfies Readonly<Record<string, FunctionsErrorCode>>;

/** The projected struct: its code and its allowlisted context. */
const fields = (httpsStatus: HttpsStatus): RuleBody => ({
  wireShape: WireShape.Fields,
  httpsStatus,
  named: [],
});
/** …and the payload `field` it names. */
const withField = (httpsStatus: HttpsStatus): RuleBody => ({
  wireShape: WireShape.Fields,
  httpsStatus,
  named: [NamedField.Field],
});
/** …and the `refusal` one level down. */
const withRefusal = (httpsStatus: HttpsStatus): RuleBody => ({
  wireShape: WireShape.Fields,
  httpsStatus,
  named: [NamedField.Refusal],
});
const aggregate = (httpsStatus: HttpsStatus): RuleBody => ({
  wireShape: WireShape.Errors,
  httpsStatus,
  named: [],
});
const wrapped = (httpsStatus: HttpsStatus): RuleBody => ({
  wireShape: WireShape.CodeAndErrors,
  httpsStatus,
  named: [],
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

// Statuses for codes no callable returns yet follow the legacy precedents: a
// refusal of what was sent is `invalid-argument`, a state that forbids it
// `failed-precondition`, a stored or configured value the server cannot
// stand by `internal`, a lost race `aborted`.

const BOOKING_WIRE: WireTable<BookingErrorCode> = {
  [BookingErrorCode.Unauthenticated]: fields(S.Unauthenticated),
  // `detail` (a person key, a location) and `reason` stay OFF the wire:
  // only `field` names what was refused.
  [BookingErrorCode.InvalidInput]: withField(S.InvalidArgument),
  [BookingErrorCode.UnknownService]: fields(S.NotFound),
  [BookingErrorCode.ServiceNotAtLocation]: fields(S.FailedPrecondition),
  [BookingErrorCode.ConflictingServices]: fields(S.FailedPrecondition),
  [BookingErrorCode.BarberNotRostered]: fields(S.FailedPrecondition),
  // `aborted`: the honest status of a lost race, retryable as no other is.
  [BookingErrorCode.SlotUnavailable]: fields(S.Aborted),
  [BookingErrorCode.TooSoon]: fields(S.FailedPrecondition),
  [BookingErrorCode.BeyondHorizon]: fields(S.FailedPrecondition),
  [BookingErrorCode.PartyTooLarge]: fields(S.FailedPrecondition),
  // The violations stay on the server, as today.
  [BookingErrorCode.InvariantViolated]: fields(S.InvalidArgument),
  // The booking callables' own refusals (Phase 4a 4A-4) — the successors of
  // the legacy dotted codes, each on its legacy row's status. Their `field`
  // and `appointmentId` stay on the server, as the legacy `{ code }` did.
  [BookingErrorCode.CommitForbidden]: fields(S.PermissionDenied),
  [BookingErrorCode.CommitStoreFailed]: fields(S.Internal),
  [BookingErrorCode.TransitionUnauthenticated]: fields(S.Unauthenticated),
  [BookingErrorCode.TransitionForbidden]: fields(S.PermissionDenied),
  [BookingErrorCode.TransitionInvalidInput]: fields(S.InvalidArgument),
  [BookingErrorCode.TransitionNotFound]: fields(S.NotFound),
  [BookingErrorCode.TransitionNotAllowed]: fields(S.FailedPrecondition),
  [BookingErrorCode.TransitionReopenWindowClosed]: fields(S.FailedPrecondition),
  [BookingErrorCode.TransitionSlotTaken]: fields(S.FailedPrecondition),
  [BookingErrorCode.ArrivedUnauthenticated]: fields(S.Unauthenticated),
  [BookingErrorCode.ArrivedForbidden]: fields(S.PermissionDenied),
  [BookingErrorCode.ArrivedInvalidInput]: fields(S.InvalidArgument),
  [BookingErrorCode.ArrivedNotFound]: fields(S.NotFound),
  [BookingErrorCode.ArrivedNotAllowed]: fields(S.FailedPrecondition),
  [BookingErrorCode.TipUnauthenticated]: fields(S.Unauthenticated),
  [BookingErrorCode.TipForbidden]: fields(S.PermissionDenied),
  [BookingErrorCode.TipInvalidInput]: fields(S.InvalidArgument),
  [BookingErrorCode.TipNotFound]: fields(S.NotFound),
  // The booking surfaces' own words (Phase 4b, 4B-5): no pipeline raises
  // them; inert rows — the answer the edge gives a code it does not know.
  [BookingErrorCode.CallFailed]: fields(S.Internal),
  [BookingErrorCode.TransitionSeatResolved]: fields(S.Internal),
};

const MOVE_WIRE: WireTable<MoveErrorCode> = {
  // NOT `aborted`: only the shop can re-seat somebody else on the visit.
  [MoveErrorCode.CarriedSeatUnplaceable]: withRefusal(S.FailedPrecondition),
  // The client booking flow's own move refusals (pass D, X-4: the folded
  // `MoveRefusal`, `rescheduleFrom`'s answer in the browser): no callable
  // raises them — inert rows, each a state that forbids the move, as the
  // booking flow's own refusals are (`BOOKING_FLOW_WIRE`).
  [MoveErrorCode.CompanionsOnly]: fields(S.FailedPrecondition),
  [MoveErrorCode.Unavailable]: fields(S.FailedPrecondition),
  [MoveErrorCode.CarriedOutOfReach]: fields(S.FailedPrecondition),
};

const STAFF_EDIT_WIRE: WireTable<StaffEditErrorCode> = {
  [StaffEditErrorCode.Unauthenticated]: fields(S.Unauthenticated),
  [StaffEditErrorCode.Forbidden]: fields(S.PermissionDenied),
  [StaffEditErrorCode.InvalidCommand]: withField(S.InvalidArgument),
  // An offer, not a lost race: `failed-precondition`, never `aborted`.
  [StaffEditErrorCode.Overlaps]: fields(S.FailedPrecondition),
  // The visit's end and the arrival, each a shop wall clock — `localDate` +
  // `finishMinutes` (an end may be the closing midnight, `1440`) and
  // `arrivalLocalDate` + `arrivalMinutes`, as the struct holds them.
  [StaffEditErrorCode.BeforeArrival]: fields(S.FailedPrecondition),
  [StaffEditErrorCode.Stale]: fields(S.FailedPrecondition),
  // A server bug in the staff family's own words — never the caller's fault.
  [StaffEditErrorCode.InvariantViolated]: fields(S.Internal),
};

const CANCELLATION_WIRE: WireTable<CancellationRefusalCode> = {
  [CancellationRefusalCode.PolicyUnavailable]: fields(S.Unavailable),
  [CancellationRefusalCode.NotCancellable]: fields(S.FailedPrecondition),
  [CancellationRefusalCode.WindowClosed]: fields(S.FailedPrecondition),
  // The cancel callable's own refusals (Phase 4a 4A-4).
  [CancellationRefusalCode.Unauthenticated]: fields(S.Unauthenticated),
  [CancellationRefusalCode.InvalidInput]: fields(S.InvalidArgument),
  // Not-yours answers exactly as not-found: an id's existence is no leak.
  [CancellationRefusalCode.NotFound]: fields(S.NotFound),
};

const CANCEL_WAITLIST_WIRE: WireTable<CancelWaitlistRefusalCode> = {
  [CancelWaitlistRefusalCode.NotFound]: fields(S.NotFound),
  [CancelWaitlistRefusalCode.NotCancellable]: fields(S.FailedPrecondition),
};

const RUN_BACKFILL_WIRE: WireTable<RunBackfillRefusalCode> = {
  [RunBackfillRefusalCode.Unauthenticated]: fields(S.Unauthenticated),
  [RunBackfillRefusalCode.Forbidden]: fields(S.PermissionDenied),
  [RunBackfillRefusalCode.InvalidInput]: fields(S.InvalidArgument),
};

/**
 * The registration's refused profile is an AGGREGATE, as its legacy
 * `user_validation_failed` was: `{ errors: [...] }`, each nested refusal by
 * its own row, no top-level code — the web words the FIRST one.
 */
const COMPLETE_REGISTRATION_WIRE: WireTable<CompleteRegistrationRefusalCode> = {
  [CompleteRegistrationRefusalCode.ProfileInvalid]: aggregate(
    S.InvalidArgument,
  ),
};

/** Both waitlist callables' door refusals — `cancelWaitlist`'s no caller and no request id included. */
const WAITLIST_WIRE: WireTable<WaitlistErrorCode> = {
  [WaitlistErrorCode.Unauthenticated]: fields(S.Unauthenticated),
  [WaitlistErrorCode.InvalidRequest]: withField(S.InvalidArgument),
  [WaitlistErrorCode.TooManyDays]: fields(S.FailedPrecondition),
  [WaitlistErrorCode.AlreadyWatching]: fields(S.AlreadyExists),
};

/**
 * The client issue sink's door (OR-34): a payload that is no admitted batch
 * is a refusal of what was sent. Its code leaves alone — the reason, the
 * issue's index and the field at fault stay in the sink's own log line
 * (`client-issue.wire.ts`): the reporter never words a refusal, it drops it.
 */
const CLIENT_ISSUE_WIRE: WireTable<ClientIssueErrorCode> = {
  [ClientIssueErrorCode.BatchRefused]: fields(S.InvalidArgument),
};

/**
 * The streak publish's refusals are ANSWERED —
 * `{ streakPublishOutcome: 'REFUSED', errorCode, fields, earliest, … }`
 * (`StreakPublishCall.refused`) — never thrown, but for a caller without a
 * session, thrown `unauthenticated`, and the callable's own faults.
 */
const STREAK_PUBLISH_WIRE: WireTable<StreakPublishErrorCode> = {
  [StreakPublishErrorCode.CallerUnauthenticated]: fields(S.Unauthenticated),
  [StreakPublishErrorCode.CallerNotAdmin]: ANSWERED,
  [StreakPublishErrorCode.Stale]: ANSWERED,
  [StreakPublishErrorCode.Invalid]: ANSWERED,
  [StreakPublishErrorCode.TooEarly]: ANSWERED,
  [StreakPublishErrorCode.RecomputeNeedsEngine]: ANSWERED,
  [StreakPublishErrorCode.PreviewStale]: ANSWERED,
  // The callable's own faults — thrown, never answered.
  [StreakPublishErrorCode.InvalidInput]: withField(S.InvalidArgument),
  [StreakPublishErrorCode.StoreFailed]: fields(S.Internal),
};

const IDENTITY_WIRE: WireTable<IdentityErrorCode> = {
  [IdentityErrorCode.OtpAlreadyConsumed]: fields(S.FailedPrecondition),
  [IdentityErrorCode.OtpExpired]: fields(S.DeadlineExceeded),
  [IdentityErrorCode.OtpLockedOut]: fields(S.ResourceExhausted),
  [IdentityErrorCode.OtpWrongCode]: fields(S.InvalidArgument),
  [IdentityErrorCode.IdentifierInvalid]: fields(S.InvalidArgument),
  [IdentityErrorCode.OtpCodeInvalid]: fields(S.InvalidArgument),
  [IdentityErrorCode.BirthDateInvalid]: fields(S.InvalidArgument),
  [IdentityErrorCode.BirthDateInFuture]: fields(S.InvalidArgument),
  [IdentityErrorCode.BirthDateTooYoung]: fields(S.InvalidArgument),
  [IdentityErrorCode.BirthDateTooOld]: fields(S.InvalidArgument),
  [IdentityErrorCode.AuthClaimsEmptyRoles]: fields(S.Internal),
  [IdentityErrorCode.AuthStrategyUnknownKind]: fields(S.Internal),
  [IdentityErrorCode.AuthStrategyUnknownField]: fields(S.Internal),
  [IdentityErrorCode.AuthStrategyRequiredEmpty]: fields(S.Internal),
  [IdentityErrorCode.AuthStrategyPhoneMissing]: fields(S.Internal),
  [IdentityErrorCode.AuthStrategyInvalidPolicy]: fields(S.Internal),
  [IdentityErrorCode.AuthFlowInvalidTransition]: fields(S.FailedPrecondition),
  [IdentityErrorCode.OnboardingFlowInvalidTransition]: fields(
    S.FailedPrecondition,
  ),
  // The identity pipelines' refusals (F2-4). NOT `permission-denied` for a
  // forbidden registration: the web reads that status as the lockout.
  [IdentityErrorCode.OtpChannelMismatch]: fields(S.FailedPrecondition),
  [IdentityErrorCode.OtpRateLimited]: fields(S.ResourceExhausted),
  [IdentityErrorCode.OtpNotFound]: fields(S.NotFound),
  [IdentityErrorCode.OtpDestinationCorrupted]: fields(S.Internal),
  [IdentityErrorCode.OtpAccountConflict]: fields(S.Internal),
  [IdentityErrorCode.RegistrationUnauthenticated]: fields(S.Unauthenticated),
  [IdentityErrorCode.RegistrationForbidden]: fields(S.FailedPrecondition),
  [IdentityErrorCode.RegistrationUserNotFound]: fields(S.FailedPrecondition),
  [IdentityErrorCode.RegistrationFieldMissing]: withField(S.InvalidArgument),
  // The deployed sender refuses every delivery (WS-0) — a precondition of
  // the deployment, never `permission-denied` (the lockout) and never
  // `internal` (the web would offer a retry that cannot succeed).
  [IdentityErrorCode.OtpSendUnavailable]: fields(S.FailedPrecondition),
  // The identity callables' own faults and payload refusals (Phase 4a 4A-4);
  // `reason` leaves for the invalid input, as the legacy one did.
  [IdentityErrorCode.InvalidInput]: fields(S.InvalidArgument),
  [IdentityErrorCode.RepositoryFailure]: fields(S.Internal),
  [IdentityErrorCode.OtpSendFailure]: fields(S.Internal),
  [IdentityErrorCode.TokenMintingFailure]: fields(S.Internal),
  [IdentityErrorCode.ClaimsPromotionFailure]: fields(S.Internal),
  [IdentityErrorCode.RegistrationBirthDateInvalid]: wrapped(S.InvalidArgument),
  // The web's own failure words (Phase 4b, 4B-5): no pipeline raises them;
  // inert rows — the answer the edge gives a code it does not know.
  [IdentityErrorCode.IdentifierMissing]: fields(S.Internal),
  [IdentityErrorCode.CallFailed]: fields(S.Internal),
};

const ACCOUNTS_WIRE: WireTable<AccountsErrorCode> = {
  [AccountsErrorCode.BlockReasonInvalid]: fields(S.InvalidArgument),
  [AccountsErrorCode.UserRoleInvalid]: fields(S.InvalidArgument),
  [AccountsErrorCode.UserRolesEmpty]: fields(S.InvalidArgument),
  [AccountsErrorCode.FirstNameTooShort]: fields(S.InvalidArgument),
  [AccountsErrorCode.LastNameTooShort]: fields(S.InvalidArgument),
  [AccountsErrorCode.EmailInvalid]: fields(S.InvalidArgument),
  [AccountsErrorCode.UpdateProfileNotFound]: fields(S.NotFound),
  [AccountsErrorCode.UpdateProfileValidationFailed]: fields(S.InvalidArgument),
  [AccountsErrorCode.UpdateProfileUnauthenticated]: fields(S.Unauthenticated),
  [AccountsErrorCode.UploadAvatarNotAnImage]: fields(S.InvalidArgument),
  [AccountsErrorCode.UploadAvatarTooLarge]: fields(S.InvalidArgument),
  // The web's own failure words (Phase 4b, 4B-5): no pipeline raises them;
  // inert rows — the answer the edge gives a code it does not know.
  [AccountsErrorCode.UploadAvatarUploadFailed]: fields(S.Internal),
  [AccountsErrorCode.RemoveAvatarRemoveFailed]: fields(S.Internal),
  [AccountsErrorCode.UpdateProfileRepositoryFailure]: fields(S.Internal),
  [AccountsErrorCode.RepositoryFailure]: fields(S.Internal),
};

const GOVERNANCE_WIRE: WireTable<GovernanceErrorCode> = {
  [GovernanceErrorCode.AuditEntryEmptyAction]: fields(S.Internal),
  [GovernanceErrorCode.FeatureFlagsUnknownKey]: fields(S.InvalidArgument),
  [GovernanceErrorCode.FeatureFlagsInvalidValue]: fields(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationScopeInvalid]: fields(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationSelf]: fields(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationReasonRequired]: fields(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationInvalidExpiry]: fields(S.InvalidArgument),
  [GovernanceErrorCode.ImpersonationAdminNotStaff]: fields(S.PermissionDenied),
  [GovernanceErrorCode.ImpersonationAlreadyEnded]: fields(S.FailedPrecondition),
  [GovernanceErrorCode.EndImpersonationNotFound]: fields(S.NotFound),
  [GovernanceErrorCode.SearchUsersQueryTooShort]: fields(S.InvalidArgument),
  // The impersonation callables' caller gate (Phase 4a 4A-3 (4)).
  [GovernanceErrorCode.ImpersonationUnauthenticated]: fields(S.Unauthenticated),
  [GovernanceErrorCode.ImpersonationForbidden]: fields(S.PermissionDenied),
};

const PIPELINE_WIRE: WireTable<PipelineErrorCode> = {
  [PipelineErrorCode.Unauthenticated]: fields(S.Unauthenticated),
  [PipelineErrorCode.SlotUnavailable]: fields(S.Aborted),
  [PipelineErrorCode.CatalogChanged]: fields(S.FailedPrecondition),
  [PipelineErrorCode.InvalidRequest]: fields(S.InvalidArgument),
  [PipelineErrorCode.Unavailable]: fields(S.Unavailable),
  [PipelineErrorCode.Unknown]: fields(S.Internal),
};

const REPOSITORY_WIRE: WireTable<RepositoryErrorCode> = {
  // As the retired `repository_failure` did: `internal`, the cause in the
  // log only.
  [RepositoryErrorCode.ReadFailed]: fields(S.Internal),
  [RepositoryErrorCode.WriteFailed]: fields(S.Internal),
  // A `Create` that met its document — normally read by the pipeline as the
  // replay; one that reaches the edge answers in the store's own word.
  [RepositoryErrorCode.AlreadyExists]: fields(S.AlreadyExists),
  [RepositoryErrorCode.Malformed]: fields(S.Internal),
  [RepositoryErrorCode.Unavailable]: fields(S.Unavailable),
};

const MEDIA_WIRE: WireTable<MediaErrorCode> = {
  [MediaErrorCode.NotFound]: fields(S.NotFound),
  [MediaErrorCode.Forbidden]: fields(S.PermissionDenied),
  [MediaErrorCode.Transient]: fields(S.Unavailable),
  // The visit photo's upload guard (`attachVisitPhoto`, in the browser,
  // before any byte goes up): no callable raises them — inert rows, a
  // refusal of what was sent, as the avatar's own guard codes are.
  [MediaErrorCode.PhotoNotAnImage]: fields(S.InvalidArgument),
  [MediaErrorCode.PhotoTooLarge]: fields(S.InvalidArgument),
};

const BOOKING_FLOW_WIRE: WireTable<BookingFlowErrorCode> = {
  [BookingFlowErrorCode.InvalidTransition]: fields(S.FailedPrecondition),
  [BookingFlowErrorCode.InvalidGuest]: fields(S.InvalidArgument),
  [BookingFlowErrorCode.GuestNotFound]: fields(S.InvalidArgument),
  [BookingFlowErrorCode.PartyFull]: fields(S.FailedPrecondition),
  [BookingFlowErrorCode.EmptyCart]: fields(S.InvalidArgument),
  [BookingFlowErrorCode.SeatWithoutService]: fields(S.InvalidArgument),
  [BookingFlowErrorCode.FlexibleDaysFull]: fields(S.FailedPrecondition),
  [BookingFlowErrorCode.NoFlexibleDays]: fields(S.InvalidArgument),
  [BookingFlowErrorCode.InvalidCartOperation]: fields(S.InvalidArgument),
};

const SCHEDULING_WIRE = uniform(
  SchedulingErrorCode,
  fields(S.InvalidArgument),
  {
    [SchedulingErrorCode.AppointmentPastStartTime]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentBarberDoubleBooked]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentInvalidTransition]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentReopenWindowClosed]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentReopenSlotTaken]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentUnknownSeat]: fields(S.NotFound),
    [SchedulingErrorCode.AppointmentSeatAlreadyResolved]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.AppointmentNotArrivable]: fields(S.FailedPrecondition),
    [SchedulingErrorCode.BookingPolicyInvalid]: fields(S.Internal),
    [SchedulingErrorCode.ClientStatsPolicyInvalid]: fields(S.Internal),
    [SchedulingErrorCode.FlexibleWhenFull]: fields(S.FailedPrecondition),
    [SchedulingErrorCode.StaffScheduleRetroactiveAmendment]: fields(
      S.FailedPrecondition,
    ),
    [SchedulingErrorCode.WaitlistInvalidTransition]: fields(
      S.FailedPrecondition,
    ),
  },
);

const ENGAGEMENT_WIRE = uniform(
  EngagementErrorCode,
  fields(S.InvalidArgument),
  {
    [EngagementErrorCode.CouponGrantNotActive]: fields(S.FailedPrecondition),
    [EngagementErrorCode.GiftVoucherNotRedeemable]: fields(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.GiftVoucherInsufficientBalance]: fields(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.GiftVoucherOverRestore]: fields(S.FailedPrecondition),
    [EngagementErrorCode.GiftVoucherCurrencyMismatch]: fields(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.PointsInsufficient]: fields(S.FailedPrecondition),
    [EngagementErrorCode.InvitationSelfRedemption]: fields(
      S.FailedPrecondition,
    ),
    // `redeemInvitation` (Phase 4a 4A-3 (5)): a missing invitation reads as
    // every other missing document, a second redemption as the store's own
    // word for a document that is there.
    [EngagementErrorCode.InvitationNotFound]: fields(S.NotFound),
    [EngagementErrorCode.InvitationAlreadyRedeemed]: fields(S.AlreadyExists),
    [EngagementErrorCode.InvitationUnauthenticated]: fields(S.Unauthenticated),
    [EngagementErrorCode.StreakScheduleVersionNotRising]: fields(
      S.FailedPrecondition,
    ),
    [EngagementErrorCode.StreakScheduleNotAfterCurrent]: fields(
      S.FailedPrecondition,
    ),
    // The programs refusals (flip 4, F4-6): no callable returns them today
    // (D9(b) — the admin write is a rules-guarded browser pipeline), but a
    // missing program reads as every other missing document does, and an
    // event whose shop has no zone as a precondition the deployment owes.
    [EngagementErrorCode.PositionNotFound]: fields(S.NotFound),
    [EngagementErrorCode.CourseNotFound]: fields(S.NotFound),
    [EngagementErrorCode.ShopEventNotFound]: fields(S.NotFound),
    [EngagementErrorCode.ShopEventZoneUnknown]: fields(S.FailedPrecondition),
    // An event naming a shop that is not stored (OR-38, DEP-F28): refused,
    // never placed on another shop's clock — a precondition of the save, as
    // the missing zone is. Its `locationId` stays on the server.
    [EngagementErrorCode.ShopEventLocationUnknown]: fields(
      S.FailedPrecondition,
    ),
    // The admin rhythm page's own failure word (Phase 4b, 4B-5): no pipeline
    // raises it; an inert row — the answer the edge gives a code it does not
    // know, not the dictionary's `invalid-argument` default.
    [EngagementErrorCode.RepositoryFailure]: fields(S.Internal),
    // A voucher code repeated in one request (pass D, X-4, DEP-18:
    // `VoucherCode.distinct`): the booking wire reads it as no codes at all
    // (`voucherCodesOf` → `null`), so no callable raises it — an inert row,
    // a refusal of what was sent (the dictionary's default, spelled out).
    [EngagementErrorCode.VoucherCodeDuplicate]: fields(S.InvalidArgument),
  },
);

const CATALOG_WIRE = uniform(CatalogErrorCode, fields(S.InvalidArgument), {
  // A boundary with no zone to read (`resolveShopZone`): a precondition the
  // deployment owes, as an event with no zone is. The server pipelines fold
  // it into their store failure before it reaches here (4A-2 (e)).
  [CatalogErrorCode.LocationZoneUnknown]: fields(S.FailedPrecondition),
});
const MONEY_WIRE = uniform(MoneyErrorCode, fields(S.InvalidArgument), {});
const PHONE_WIRE = uniform(PhoneErrorCode, fields(S.InvalidArgument), {});
const TIME_WIRE = uniform(TimeErrorCode, fields(S.InvalidArgument), {
  // As the retired `invalid_time_zone` did — a server zone, never the caller's.
  [TimeErrorCode.InvalidTimeZone]: fields(S.Internal),
});
/** A refused primitive: what was sent is not one. */
const PRIMITIVE_WIRE = uniform(
  PrimitiveErrorCode,
  fields(S.InvalidArgument),
  {},
);

/** The shared allowlist, read by code — no dynamic index. */
const ALLOWLIST = new Map<string, readonly string[]>(
  Object.entries(WIRE_PARAM_ALLOWLIST),
);

/** Each row joined with its code's allowlist — the ONE list of what may leave. */
function withAllowlists<C extends string>(
  table: WireTable<C>,
): { readonly [K in C]: WireRule } {
  const joined = new Map<string, WireRule>();
  for (const [code, rule] of Object.entries<RuleBody>(table)) {
    joined.set(
      code,
      rule.wireShape === WireShape.Answered
        ? rule
        : {
            wireShape: rule.wireShape,
            httpsStatus: rule.httpsStatus,
            wireFields: [...rule.named, ...(ALLOWLIST.get(code) ?? [])],
          },
    );
  }
  return Object.fromEntries(joined) as { readonly [K in C]: WireRule };
}

/** The whole table — total over {@link EdgeCode} by its type. */
export const EDGE_WIRE: { readonly [K in EdgeCode]: WireRule } =
  withAllowlists<EdgeCode>({
    ...ACCOUNTS_WIRE,
    ...PRIMITIVE_WIRE,
    ...BOOKING_WIRE,
    ...BOOKING_FLOW_WIRE,
    ...CANCELLATION_WIRE,
    ...CANCEL_WAITLIST_WIRE,
    ...CATALOG_WIRE,
    ...CLIENT_ISSUE_WIRE,
    ...COMPLETE_REGISTRATION_WIRE,
    ...ENGAGEMENT_WIRE,
    ...GOVERNANCE_WIRE,
    ...IDENTITY_WIRE,
    ...MEDIA_WIRE,
    ...MONEY_WIRE,
    ...MOVE_WIRE,
    ...PHONE_WIRE,
    ...PIPELINE_WIRE,
    ...REPOSITORY_WIRE,
    ...RUN_BACKFILL_WIRE,
    ...SCHEDULING_WIRE,
    ...STAFF_EDIT_WIRE,
    ...STREAK_PUBLISH_WIRE,
    ...TIME_WIRE,
    ...WAITLIST_WIRE,
  });

const WIRE_BY_CODE = new Map<string, WireRule>(Object.entries(EDGE_WIRE));

/** A code the table does not know (a struct typed loosely at runtime): `internal`, its code alone. */
const UNMAPPED: ThrownWireRule = {
  wireShape: WireShape.Fields,
  httpsStatus: S.Internal,
  wireFields: [],
};

/** The rule a code leaves by — an unknown code leaves `internal`, as itself. */
export function wireRuleOf(code: string): WireRule {
  return WIRE_BY_CODE.get(code) ?? UNMAPPED;
}

/** True when the callable answers this refusal instead of throwing it. */
export function isAnswered(code: string): boolean {
  return wireRuleOf(code).wireShape === WireShape.Answered;
}

// ── Result.err → HttpsError ────────────────────────────────────────────────

/** One own field of a struct, read without a dynamic index; `undefined` when absent. */
function fieldOf(error: object, field: string): unknown {
  return Object.getOwnPropertyDescriptor(error, field)?.value;
}

function isEdgeError(value: unknown): value is EdgeError {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof fieldOf(value, 'errorCode') === 'string'
  );
}

/**
 * A struct projected to a field list: `errorCode`, then each listed field
 * the struct holds, as it holds it (`null` included — absent is `null` in a
 * flat struct). An `undefined` field is left out.
 */
export function projected(
  error: EdgeError,
  wireFields: readonly string[],
): Record<string, unknown> {
  const entries: [string, unknown][] = [['errorCode', error.errorCode]];
  for (const name of wireFields) {
    const value = fieldOf(error, name);
    if (value !== undefined) entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

/** One struct as its own row projects it — an answered code (never nested today) as its code alone. */
function projectedByRule(error: EdgeError): Record<string, unknown> {
  const rule = wireRuleOf(error.errorCode);
  return projected(
    error,
    rule.wireShape === WireShape.Answered ? [] : rule.wireFields,
  );
}

/** An aggregate's nested refusals, each projected by its own row. */
function nestedOf(error: EdgeError): readonly Record<string, unknown>[] {
  const nested = fieldOf(error, 'errors');
  if (!Array.isArray(nested)) return [];
  return nested.filter(isEdgeError).map(projectedByRule);
}

/** The `details` a refusal leaves with — exactly its rule's shape. */
export function wireDetails(error: EdgeError): Record<string, unknown> {
  const rule = wireRuleOf(error.errorCode);
  switch (rule.wireShape) {
    case WireShape.Answered:
      return { errorCode: error.errorCode };
    case WireShape.Fields:
      return projected(error, rule.wireFields);
    case WireShape.Errors:
      return { errors: nestedOf(error) };
    case WireShape.CodeAndErrors:
      return { errorCode: error.errorCode, errors: nestedOf(error) };
  }
}

/**
 * The one `Result.err` → `HttpsError` mapping. The message is the
 * `errorCode` (no client reads it; the UI words `details`). An ANSWERED
 * refusal that reaches here was wired to a callable that does not answer
 * it: `internal`, never a status that would invite the client to act on it.
 */
export function toHttpsError(error: EdgeError): HttpsError {
  const rule = wireRuleOf(error.errorCode);
  const status =
    rule.wireShape === WireShape.Answered ? S.Internal : rule.httpsStatus;
  return new HttpsError(status, error.errorCode, wireDetails(error));
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
  /** The instant the edge started the handler — a stamp, read once off the clock port. */
  readonly startedAtUtcMs: UtcEpochMs;
  /** The allowance, in milliseconds of elapsed time (a span, not an instant). */
  readonly limitMs: number;
  readonly spent: () => boolean;
};

export const workBudget = (nowUtcMs: NowUtcMs, limitMs: number): WorkBudget => {
  const startedAtUtcMs = nowUtcMs();
  return {
    startedAtUtcMs,
    limitMs,
    spent: () => WorkBudgetSystem.isSpent(startedAtUtcMs, nowUtcMs(), limitMs),
  };
};

// ── Throttle ───────────────────────────────────────────────────────────────

/**
 * A callable's admission rate on ONE instance: a bucket that holds
 * `capacity` calls (the burst it absorbs) and refills at `callsPerSecond`.
 * Per instance, never global — the definition's `maxInstances` bounds the
 * whole.
 */
export type ThrottleRate = {
  readonly capacity: number;
  readonly callsPerSecond: number;
};

/**
 * One instance's bucket, in thousandths of a call — so a refill over whole
 * milliseconds is a whole number (`callsPerSecond` thousandths per
 * millisecond) and no fraction drifts — as of the instant it was last
 * filled.
 */
export type TokenBucket = {
  readonly milliTokens: number;
  readonly filledAtUtcMs: UtcEpochMs;
};

/** One call's turn at the bucket: admitted or not, and the bucket it leaves behind. */
export type BucketTurn = {
  readonly admitted: boolean;
  readonly bucket: TokenBucket;
};

/** What one call costs, in the bucket's thousandths. */
const MILLI_TOKENS_PER_CALL = 1000;

/** A full bucket — how an instance starts. */
export function fullBucket(
  rate: ThrottleRate,
  nowUtcMs: UtcEpochMs,
): TokenBucket {
  return {
    milliTokens: rate.capacity * MILLI_TOKENS_PER_CALL,
    filledAtUtcMs: nowUtcMs,
  };
}

/**
 * One call's turn — pure: the bucket refilled for the time since it was
 * last filled, never past its capacity, then one call taken when a whole
 * one is there. A clock that stepped back refills nothing and re-anchors
 * the bucket on now (an elapsed-time rule on stamps, Law 7.3 T2: a
 * cooldown).
 */
export function takeToken(
  rate: ThrottleRate,
  bucket: TokenBucket,
  nowUtcMs: UtcEpochMs,
): BucketTurn {
  const elapsedMs = Math.max(
    0,
    UtcEpochMs.elapsedMs(bucket.filledAtUtcMs, nowUtcMs),
  );
  const milliTokens = Math.min(
    rate.capacity * MILLI_TOKENS_PER_CALL,
    bucket.milliTokens + elapsedMs * rate.callsPerSecond,
  );
  const admitted = milliTokens >= MILLI_TOKENS_PER_CALL;
  return {
    admitted,
    bucket: {
      milliTokens: admitted ? milliTokens - MILLI_TOKENS_PER_CALL : milliTokens,
      filledAtUtcMs: nowUtcMs,
    },
  };
}

/**
 * A per-instance token bucket over the clock port: the bucket lives in this
 * closure — module state of the composition root, so each instance (each
 * cold start) has its own — full at its first call, one {@link takeToken}
 * per call after. What it answers is the admission question a throttled
 * callable asks before anything else (an edge closure, no port).
 */
export const tokenBucket = (
  rate: ThrottleRate,
  nowUtcMs: NowUtcMs,
): (() => boolean) => {
  let bucket: TokenBucket | null = null;
  return () => {
    const now = nowUtcMs();
    const turn = takeToken(rate, bucket ?? fullBucket(rate, now), now);
    bucket = turn.bucket;
    return turn.admitted;
  };
};

// ── The wrappers ───────────────────────────────────────────────────────────

/** What the edge itself reads: telemetry and the clock (`ClockPorts`, flatten-spec T4). */
export type EdgePorts = TelemetryPorts & ClockPorts;

/** The platform's own answer to an uncaught throw: `internal`, `INTERNAL`, no details. */
const PLATFORM_INTERNAL_MESSAGE = 'INTERNAL';

/**
 * A throw the handler did not answer. An `HttpsError` passes through as
 * thrown; anything else is tracked — ids and the callable's name, never the
 * payload — and answered with the callable's coded failure, or with the
 * platform's bare INTERNAL exactly as an uncaught throw is answered.
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
    : toHttpsError({ errorCode: failureCode });
}

/** How one callable meets the wire. */
export type CallableSpec<Out> = {
  readonly callable: CallableName;
  /**
   * The code an infrastructure failure answers with — the callable's coded
   * `internal` (`BOOKING_COMMIT_STORE_FAILED`) — or `null` for the
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
    if (spec.answer !== null && isAnswered(result.error.errorCode)) {
      return spec.answer(result.error);
    }
    throw toHttpsError(result.error);
  };

/** The answer a throttled call gets: the status's own name, as the platform's bare INTERNAL is named. */
const THROTTLED_MESSAGE = 'RESOURCE_EXHAUSTED';

/**
 * A callable behind its instance's token bucket ({@link tokenBucket}): a
 * call the bucket admits runs the handler as it is; one it refuses is
 * answered `resource-exhausted` before anything is read — no details, no
 * line of ours (the platform's request log counts it, HTTP 429), so a flood
 * costs neither a decode nor a log line.
 */
export const throttledCallable =
  <In, Out>(
    admit: () => boolean,
    handle: (request: CallableRequest<In>) => Promise<Out>,
  ) =>
  async (request: CallableRequest<In>): Promise<Out> => {
    if (!admit()) throw new HttpsError(S.ResourceExhausted, THROTTLED_MESSAGE);
    return handle(request);
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
      const line = TriggerAttemptSystem.attemptLine(
        spec.fn,
        {
          id: TriggerEventId.of(event.id),
          eventAtUtcMs: eventInstantOf(event.time),
        },
        failure,
        ports.nowUtcMs(),
      );
      ports.log('error', 'trigger attempt failed', attemptLineFields(line));
      if (failure.attemptOutcome === AttemptOutcome.Transient) throw thrown;
    }
  };

/**
 * THE ONE attempt line, in the flipped vocabulary (Phase 4a 4A-2 (c)) —
 * `{ fn, eventId, outcome, errorCode, ageMs }`: `outcome` the SCREAMING
 * `AttemptOutcome`, `errorCode` the failure's code as `TriggerAttemptSystem`
 * judged it. Operator telemetry, never a user surface; every retrying
 * trigger and every survived failure (`triggers.wire.ts`) logs through it.
 */
export function attemptLineFields(line: AttemptLine): Record<string, unknown> {
  return {
    fn: line.fn,
    eventId: line.eventId,
    outcome: line.attemptOutcome,
    errorCode: line.failureCode,
    ageMs: line.ageMs,
  };
}
