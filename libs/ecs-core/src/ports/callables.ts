import {
  AnalyticsCall,
  type AnalyticsReport,
  BackfillCall,
  BookingCall,
  CallAnswer,
  type ClientIssue,
  ClientPrivacyCall,
  DayExceptionsCall,
  GovernanceCall,
  IdentityCall,
  InvitationCall,
  RolesCall,
  RosterCall,
  SetAnalyticsGoalCall,
  StreakPublishCall,
  TeamCall,
  WaitlistCall,
} from '@core/components';
import { AppCheckTokenUse, Result } from '@core/primitives';
import type { PipelineError } from '@core/errors';

/**
 * The callable registry (blueprint §4.1, §4.2) — the ONE spelling of every
 * server export the web dials through `CallableClient`
 * (`scheduling.port.ts`). A values file on purpose, like
 * `entities/collections.ts`: not a `*.data.ts` (it names deployed functions,
 * not a component) and not a `*.port.ts` (ports are function types). Each
 * value is the export name in `apps/functions/src/main.ts` verbatim — the
 * name Firebase deploys and the browser SDK resolves.
 *
 * Phase 4a adds `startImpersonation`, `endImpersonation` and
 * `redeemInvitation` with their server pipelines (4A-3 (4), (5)); pass F
 * adds `reportClientIssues`, the web's first-party issue sink (OR-34);
 * audit-hardening Phase 3 adds `exportClientData`, the admin's data-subject
 * export (WS-C), and `previewClientErasure` / `eraseClient`, the admin's
 * erasure (WS-D); security hardening adds `setRoles`, the admin's roles
 * change (S-WS-E); the break pass adds `amendRosterBreaks`, the desk's one
 * door to a chair's roster, and `setRosterWeek`, the hours editor's
 * (2026-11-06); staff analytics adds `staffAnalytics`, the report a barber
 * or the admin reads (`docs/designs/staff-analytics.md`), and v2 PR 6
 * `setAnalyticsGoal`, a scope's month goal; team onboarding adds the barber
 * record's four — `addBarber`, `editBarber`, `activateBarber` and
 * `deleteDraftBarber` — `setBarberOfferings`, a barber's services and
 * prices, `setDayExceptions`, a barber's days off, blocks and one-day
 * breaks, and `listTeam`, the Team page's read
 * (`docs/designs/team-onboarding.md`, D5, D6, D8, D9, D10, O4).
 * Triggers and schedules are never dialled, so they are not here.
 */
export const Callables = {
  RequestOtpChallenge: 'requestOtpChallenge',
  VerifyOtpChallenge: 'verifyOtpChallenge',
  CompleteRegistration: 'completeRegistration',
  UpdateProfile: 'updateProfile',
  CommitBooking: 'commitBooking',
  CancelAppointment: 'cancelAppointment',
  RescheduleAppointment: 'rescheduleAppointment',
  TransitionAppointment: 'transitionAppointment',
  MarkArrived: 'markArrived',
  ClearArrival: 'clearArrival',
  RecordSeatTip: 'recordSeatTip',
  StaffEditAppointment: 'staffEditAppointment',
  RequestWaitlist: 'requestWaitlist',
  CancelWaitlist: 'cancelWaitlist',
  RunBackfill: 'runBackfill',
  PublishStreakDefinition: 'publishStreakDefinition',
  StartImpersonation: 'startImpersonation',
  EndImpersonation: 'endImpersonation',
  RedeemInvitation: 'redeemInvitation',
  ReportClientIssues: 'reportClientIssues',
  ExportClientData: 'exportClientData',
  PreviewClientErasure: 'previewClientErasure',
  EraseClient: 'eraseClient',
  SetRoles: 'setRoles',
  AmendRosterBreaks: 'amendRosterBreaks',
  SetRosterWeek: 'setRosterWeek',
  StaffAnalytics: 'staffAnalytics',
  SetAnalyticsGoal: 'setAnalyticsGoal',
  AddBarber: 'addBarber',
  EditBarber: 'editBarber',
  ActivateBarber: 'activateBarber',
  DeleteDraftBarber: 'deleteDraftBarber',
  SetBarberOfferings: 'setBarberOfferings',
  SetDayExceptions: 'setDayExceptions',
  ListTeam: 'listTeam',
} as const;
export type CallableName = (typeof Callables)[keyof typeof Callables];

/**
 * THE WIRE, BY NAME (Phase 4a 4A-4) — what each callable takes and answers:
 * the flat call components of `@core/components`. The web's
 * `callableClient` is typed through it; the server's decoders type against
 * it, and its wiring proves each pipeline's answer IS the wire answer (or a
 * named projection onto it). Total over {@link CallableName}.
 */
export type CallableWire = {
  readonly [Callables.RequestOtpChallenge]: {
    readonly input: IdentityCall;
    readonly answer: IdentityCall.RequestOtpAnswer;
  };
  readonly [Callables.VerifyOtpChallenge]: {
    readonly input: IdentityCall.VerifyOtp;
    readonly answer: IdentityCall.VerifyOtpAnswer;
  };
  readonly [Callables.CompleteRegistration]: {
    readonly input: IdentityCall.CompleteRegistration;
    readonly answer: IdentityCall.CompleteRegistrationAnswer;
  };
  readonly [Callables.UpdateProfile]: {
    readonly input: IdentityCall.UpdateProfile;
    readonly answer: IdentityCall.UpdateProfileAnswer;
  };
  readonly [Callables.CommitBooking]: {
    readonly input: BookingCall;
    readonly answer: BookingCall.Committed;
  };
  readonly [Callables.CancelAppointment]: {
    readonly input: BookingCall.Cancel;
    readonly answer: BookingCall.Committed;
  };
  readonly [Callables.RescheduleAppointment]: {
    readonly input: BookingCall.Reschedule;
    readonly answer: BookingCall.Committed;
  };
  readonly [Callables.TransitionAppointment]: {
    readonly input: BookingCall.Transition;
    readonly answer: BookingCall.Transitioned;
  };
  readonly [Callables.MarkArrived]: {
    readonly input: BookingCall.Arrival;
    readonly answer: BookingCall.Arrived;
  };
  readonly [Callables.ClearArrival]: {
    readonly input: BookingCall.Arrival;
    readonly answer: BookingCall.Cleared;
  };
  readonly [Callables.RecordSeatTip]: {
    readonly input: BookingCall.Tip;
    readonly answer: BookingCall.TipRecorded;
  };
  readonly [Callables.StaffEditAppointment]: {
    readonly input: BookingCall.StaffEdit;
    readonly answer: BookingCall.StaffEdited;
  };
  readonly [Callables.RequestWaitlist]: {
    readonly input: WaitlistCall;
    readonly answer: WaitlistCall.Requested;
  };
  readonly [Callables.CancelWaitlist]: {
    readonly input: WaitlistCall.Cancel;
    readonly answer: WaitlistCall.Requested;
  };
  readonly [Callables.RunBackfill]: {
    readonly input: BackfillCall;
    readonly answer: BackfillCall.Page;
  };
  readonly [Callables.PublishStreakDefinition]: {
    readonly input: StreakPublishCall | StreakPublishCall.Withdraw;
    readonly answer: StreakPublishCall.Answer;
  };
  readonly [Callables.StartImpersonation]: {
    readonly input: GovernanceCall;
    readonly answer: GovernanceCall.Started;
  };
  readonly [Callables.EndImpersonation]: {
    readonly input: GovernanceCall.End;
    readonly answer: GovernanceCall.Ended;
  };
  readonly [Callables.RedeemInvitation]: {
    readonly input: InvitationCall;
    readonly answer: InvitationCall.Redeemed;
  };
  /**
   * A batch of client issues — the array `ClientIssueSystem.admitBatch`
   * holds a payload to (at most 10 issues and 4 KB, refused whole) — and
   * how many log lines the sink wrote, one per issue (OR-34).
   */
  readonly [Callables.ReportClientIssues]: {
    readonly input: readonly ClientIssue[];
    readonly answer: { readonly loggedCount: number };
  };
  /**
   * An admin's data-subject export (audit-hardening Phase 3 WS-C): the
   * record and the act's own id in; the person's ONE bundle out, as the
   * server's canonical JSON text beside its counts (P3-RU-16) — the web
   * decodes no entity of it and saves the text verbatim.
   */
  readonly [Callables.ExportClientData]: {
    readonly input: ClientPrivacyCall;
    readonly answer: ClientPrivacyCall.Exported;
  };
  /**
   * An admin's erasure preview (audit-hardening Phase 3 WS-D, P3-L-17) —
   * read-only: the record and the act's own id in; the record's erasure tag,
   * the census and the sibling walk-in records out.
   */
  readonly [Callables.PreviewClientErasure]: {
    readonly input: ClientPrivacyCall;
    readonly answer: ClientPrivacyCall.ErasurePreview;
  };
  /**
   * One resumable call of an admin's erasure — the SAME `ClientPrivacyCall`
   * (one act, one operation id) until the answer says it is done.
   */
  readonly [Callables.EraseClient]: {
    readonly input: ClientPrivacyCall;
    readonly answer: ClientPrivacyCall.Erasure;
  };
  /**
   * An admin's roles change (security hardening S-WS-E): the account and
   * the whole new set in — the act's transport operation id rides the
   * payload ({@link OPERATION_ID_FIELD}), the impersonation calls' shape;
   * the stored set and whether anything was written out.
   */
  readonly [Callables.SetRoles]: {
    readonly input: RolesCall;
    readonly answer: RolesCall.Changed;
  };
  /**
   * A chair's standing breaks changed from a day on — one roster write;
   * the act's operation id rides the payload ({@link OPERATION_ID_FIELD}).
   */
  readonly [Callables.AmendRosterBreaks]: {
    readonly input: RosterCall;
    readonly answer: RosterCall.Amended;
  };
  /** A chair's whole week from a day on — the hours editor's one roster write. */
  readonly [Callables.SetRosterWeek]: {
    readonly input: RosterCall.Week;
    readonly answer: RosterCall.Amended;
  };
  /**
   * A staff analytics report — read-only: the scope and the period in, the
   * report out (every figure decided, the rows of a single-barber scope).
   */
  readonly [Callables.StaffAnalytics]: {
    readonly input: AnalyticsCall;
    readonly answer: AnalyticsReport;
  };
  /**
   * A scope's takings goal for a month (staff analytics v2 PR 6): the scope,
   * month and range in — the act's operation id rides the payload
   * ({@link OPERATION_ID_FIELD}); the stored key and the set's stamp out.
   */
  readonly [Callables.SetAnalyticsGoal]: {
    readonly input: SetAnalyticsGoalCall;
    readonly answer: SetAnalyticsGoalCall.Set;
  };
  /**
   * «Добави» — a new barber record as a `DRAFT` (team onboarding D5). The
   * act's operation id is REQUIRED and IS the new record's id, so a
   * retried call answers the record its first run wrote.
   */
  readonly [Callables.AddBarber]: {
    readonly input: TeamCall;
    readonly answer: TeamCall.Saved;
  };
  /** One part of a barber record replaced whole — `barberEdit` says which. */
  readonly [Callables.EditBarber]: {
    readonly input: TeamCall.Edit;
    readonly answer: TeamCall.Saved;
  };
  /**
   * The idempotent go-live step (team onboarding D9): a `DRAFT` with every
   * needed item done goes live; the answer says what the step came to.
   */
  readonly [Callables.ActivateBarber]: {
    readonly input: TeamCall.Named;
    readonly answer: TeamCall.Activation;
  };
  /** «Изтрий» — a record that never went live, removed with what names it. */
  readonly [Callables.DeleteDraftBarber]: {
    readonly input: TeamCall.Named;
    readonly answer: TeamCall.Saved;
  };
  /**
   * A barber's services and prices, as one act: the editor's complete list,
   * or a colleague's terms copied (team onboarding D5, D6).
   */
  readonly [Callables.SetBarberOfferings]: {
    readonly input: TeamCall.Offerings;
    readonly answer: TeamCall.Saved;
  };
  /**
   * A barber's days off, blocks and one-day breaks, changed as one act —
   * the staff schedule's four pens (`dayExceptionsEdit`). The one door to
   * `scheduleExceptions`, which has no client writer (team onboarding O4).
   */
  readonly [Callables.SetDayExceptions]: {
    readonly input: DayExceptionsCall;
    readonly answer: DayExceptionsCall.Saved;
  };
  /**
   * The Team page's one read (team onboarding D8) — read-only: nothing in,
   * every barber record and every staff account out as the page's rows.
   */
  readonly [Callables.ListTeam]: {
    readonly input: TeamCall.ListRequest;
    readonly answer: TeamCall.Listed;
  };
};

/**
 * The payload field a callable's operation id rides in (WS-4.1): the staff
 * edit's spelling (`operationId`) for every act, the two booking calls'
 * `attemptId` (the id is the new appointment's / the move's ledger name)
 * and the streak publish's `requestId`.
 */
export type OperationIdField = 'operationId' | 'attemptId' | 'requestId';

/**
 * Where each callable's operation id rides on the wire (WS-4.1) — the ONE
 * table the web's callable client looks it up in (it adds a transport
 * `operationId` where the input names none); the functions decoders read
 * the same field (`operationIdOf`). `null`: the client issue sink
 * carries none (OR-34 — privacy by shape, no line of ours). Total over
 * {@link CallableName} by its mapped type.
 */
export const OPERATION_ID_FIELD: {
  readonly [N in CallableName]: OperationIdField | null;
} = {
  [Callables.RequestOtpChallenge]: 'operationId',
  [Callables.VerifyOtpChallenge]: 'operationId',
  [Callables.CompleteRegistration]: 'operationId',
  [Callables.UpdateProfile]: 'operationId',
  [Callables.CommitBooking]: 'attemptId',
  [Callables.CancelAppointment]: 'operationId',
  [Callables.RescheduleAppointment]: 'attemptId',
  [Callables.TransitionAppointment]: 'operationId',
  [Callables.MarkArrived]: 'operationId',
  [Callables.ClearArrival]: 'operationId',
  [Callables.RecordSeatTip]: 'operationId',
  [Callables.StaffEditAppointment]: 'operationId',
  [Callables.RequestWaitlist]: 'operationId',
  [Callables.CancelWaitlist]: 'operationId',
  [Callables.RunBackfill]: 'operationId',
  [Callables.PublishStreakDefinition]: 'requestId',
  [Callables.StartImpersonation]: 'operationId',
  [Callables.EndImpersonation]: 'operationId',
  [Callables.RedeemInvitation]: 'operationId',
  [Callables.ReportClientIssues]: null,
  [Callables.ExportClientData]: 'operationId',
  [Callables.PreviewClientErasure]: 'operationId',
  [Callables.EraseClient]: 'operationId',
  [Callables.SetRoles]: 'operationId',
  [Callables.AmendRosterBreaks]: 'operationId',
  [Callables.SetRosterWeek]: 'operationId',
  // A read, like the erasure preview: it changes nothing, so the id is the
  // transport's only — the web's client adds one and the outcome line
  // correlates by it; the decoder never requires it.
  [Callables.StaffAnalytics]: 'operationId',
  [Callables.SetAnalyticsGoal]: 'operationId',
  // The team acts name themselves: the input carries the id, REQUIRED.
  [Callables.AddBarber]: 'operationId',
  [Callables.EditBarber]: 'operationId',
  [Callables.ActivateBarber]: 'operationId',
  [Callables.DeleteDraftBarber]: 'operationId',
  [Callables.SetBarberOfferings]: 'operationId',
  [Callables.SetDayExceptions]: 'operationId',
  // A read, like the analytics report: the id is the transport's only.
  [Callables.ListTeam]: 'operationId',
};

/**
 * Which App Check token each callable takes (security hardening S-WS-A,
 * S-RU-21, S-L-3) — the ONE table both sides read, so they cannot drift:
 * the web's callable client asks `limitedUseAppCheckTokens` for a
 * `LIMITED_USE` callable, and the functions consume its token
 * (`consumeAppCheckToken`, replay protection) while the switch is MONITOR
 * or ENFORCE; the edge refuses a replay of it under ENFORCE. The
 * destructive and sensitive acts take limited-use tokens — the erasure,
 * its preview, the data-subject export, an impersonation start and a roles
 * change; every other callable a standard one. Total over
 * {@link CallableName} by its mapped type.
 */
export const CALLABLE_APP_CHECK_TOKEN: {
  readonly [N in CallableName]: AppCheckTokenUse;
} = {
  [Callables.RequestOtpChallenge]: AppCheckTokenUse.Standard,
  [Callables.VerifyOtpChallenge]: AppCheckTokenUse.Standard,
  [Callables.CompleteRegistration]: AppCheckTokenUse.Standard,
  [Callables.UpdateProfile]: AppCheckTokenUse.Standard,
  [Callables.CommitBooking]: AppCheckTokenUse.Standard,
  [Callables.CancelAppointment]: AppCheckTokenUse.Standard,
  [Callables.RescheduleAppointment]: AppCheckTokenUse.Standard,
  [Callables.TransitionAppointment]: AppCheckTokenUse.Standard,
  [Callables.MarkArrived]: AppCheckTokenUse.Standard,
  [Callables.ClearArrival]: AppCheckTokenUse.Standard,
  [Callables.RecordSeatTip]: AppCheckTokenUse.Standard,
  [Callables.StaffEditAppointment]: AppCheckTokenUse.Standard,
  [Callables.RequestWaitlist]: AppCheckTokenUse.Standard,
  [Callables.CancelWaitlist]: AppCheckTokenUse.Standard,
  [Callables.RunBackfill]: AppCheckTokenUse.Standard,
  [Callables.PublishStreakDefinition]: AppCheckTokenUse.Standard,
  [Callables.StartImpersonation]: AppCheckTokenUse.LimitedUse,
  [Callables.EndImpersonation]: AppCheckTokenUse.Standard,
  [Callables.RedeemInvitation]: AppCheckTokenUse.Standard,
  [Callables.ReportClientIssues]: AppCheckTokenUse.Standard,
  [Callables.ExportClientData]: AppCheckTokenUse.LimitedUse,
  [Callables.PreviewClientErasure]: AppCheckTokenUse.LimitedUse,
  [Callables.EraseClient]: AppCheckTokenUse.LimitedUse,
  [Callables.SetRoles]: AppCheckTokenUse.LimitedUse,
  [Callables.AmendRosterBreaks]: AppCheckTokenUse.Standard,
  [Callables.SetRosterWeek]: AppCheckTokenUse.Standard,
  [Callables.StaffAnalytics]: AppCheckTokenUse.Standard,
  [Callables.SetAnalyticsGoal]: AppCheckTokenUse.Standard,
  [Callables.AddBarber]: AppCheckTokenUse.Standard,
  [Callables.EditBarber]: AppCheckTokenUse.Standard,
  [Callables.ActivateBarber]: AppCheckTokenUse.Standard,
  [Callables.DeleteDraftBarber]: AppCheckTokenUse.Standard,
  [Callables.SetBarberOfferings]: AppCheckTokenUse.Standard,
  [Callables.SetDayExceptions]: AppCheckTokenUse.Standard,
  [Callables.ListTeam]: AppCheckTokenUse.Standard,
};

/** One callable's answer decoder — the only way its answer becomes branded data. */
export type AnswerDecoder<N extends CallableName> = (
  raw: unknown,
) => Result<CallableWire[N]['answer'], PipelineError>;

/**
 * `reportClientIssues`' answer (OR-34) — the count of lines written, read
 * through `CallAnswer` like every answer, so a reply with nothing usable in
 * it is `PIPELINE_UNKNOWN` all the same. Kept here, not on a call
 * component: the sink's wire is one array of `ClientIssue` structs (the
 * issue's own component) and one count, and the reporter never reads the
 * count — a sink answers nothing the device acts on.
 */
const decodeIssuesLogged: AnswerDecoder<typeof Callables.ReportClientIssues> = (
  raw,
) => {
  const answer = CallAnswer.read(raw);
  const loggedCount =
    answer === null ? null : CallAnswer.whole(answer, 'loggedCount', 0);
  return loggedCount === null
    ? CallAnswer.unusable()
    : Result.ok({ loggedCount });
};

/**
 * The runtime twin of {@link CallableWire}: each callable's answer decoder,
 * the call component's own (§3.2) — the sink's count excepted, read above.
 * The web's `callableClient` adapter looks the decoder up here — a table
 * lookup, no rule of its own; a failing decode is `PIPELINE_UNKNOWN`,
 * today's "a 200 with nothing usable in it".
 */
export const CALLABLE_ANSWER_DECODERS: {
  readonly [N in CallableName]: AnswerDecoder<N>;
} = {
  [Callables.RequestOtpChallenge]: IdentityCall.decodeRequestOtpAnswer,
  [Callables.VerifyOtpChallenge]: IdentityCall.decodeVerifyOtpAnswer,
  [Callables.CompleteRegistration]:
    IdentityCall.decodeCompleteRegistrationAnswer,
  [Callables.UpdateProfile]: IdentityCall.decodeUpdateProfileAnswer,
  [Callables.CommitBooking]: BookingCall.decodeCommitted,
  [Callables.CancelAppointment]: BookingCall.decodeCommitted,
  [Callables.RescheduleAppointment]: BookingCall.decodeCommitted,
  [Callables.TransitionAppointment]: BookingCall.decodeTransitioned,
  [Callables.MarkArrived]: BookingCall.decodeArrived,
  [Callables.ClearArrival]: BookingCall.decodeCleared,
  [Callables.RecordSeatTip]: BookingCall.decodeTipRecorded,
  [Callables.StaffEditAppointment]: BookingCall.decodeStaffEdited,
  [Callables.RequestWaitlist]: WaitlistCall.decodeRequested,
  [Callables.CancelWaitlist]: WaitlistCall.decodeRequested,
  [Callables.RunBackfill]: BackfillCall.decodePage,
  [Callables.PublishStreakDefinition]: StreakPublishCall.decodeAnswer,
  [Callables.StartImpersonation]: GovernanceCall.decodeStarted,
  [Callables.EndImpersonation]: GovernanceCall.decodeEnded,
  [Callables.RedeemInvitation]: InvitationCall.decodeRedeemed,
  [Callables.ReportClientIssues]: decodeIssuesLogged,
  [Callables.ExportClientData]: ClientPrivacyCall.decodeExported,
  [Callables.PreviewClientErasure]: ClientPrivacyCall.decodeErasurePreview,
  [Callables.EraseClient]: ClientPrivacyCall.decodeErasure,
  [Callables.SetRoles]: RolesCall.decodeChanged,
  [Callables.AmendRosterBreaks]: RosterCall.decodeAmended,
  [Callables.SetRosterWeek]: RosterCall.decodeAmended,
  [Callables.StaffAnalytics]: AnalyticsCall.decodeReport,
  [Callables.SetAnalyticsGoal]: SetAnalyticsGoalCall.decodeSet,
  [Callables.AddBarber]: TeamCall.decodeSaved,
  [Callables.EditBarber]: TeamCall.decodeSaved,
  [Callables.ActivateBarber]: TeamCall.decodeActivation,
  [Callables.DeleteDraftBarber]: TeamCall.decodeSaved,
  [Callables.SetBarberOfferings]: TeamCall.decodeSaved,
  [Callables.SetDayExceptions]: DayExceptionsCall.decodeSaved,
  [Callables.ListTeam]: TeamCall.decodeListed,
};
