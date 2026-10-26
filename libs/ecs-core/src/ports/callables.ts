import {
  BackfillCall,
  BookingCall,
  CallAnswer,
  type ClientIssue,
  GovernanceCall,
  IdentityCall,
  InvitationCall,
  StreakPublishCall,
  WaitlistCall,
} from '@core/components';
import { Result } from '@core/primitives';
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
 * adds `reportClientIssues`, the web's first-party issue sink (OR-34).
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
} as const;
export type CallableName = (typeof Callables)[keyof typeof Callables];

/**
 * THE WIRE, BY NAME (Phase 4a 4A-4) — what each callable takes and answers:
 * the flat call components of `@core/components`. The web's
 * `callableClient` is typed through it; the server's decoders and encoders
 * type against it too. Total over {@link CallableName}.
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
    readonly answer: BookingCall.Cancelled;
  };
  readonly [Callables.RescheduleAppointment]: {
    readonly input: BookingCall.Reschedule;
    readonly answer: BookingCall.Rescheduled;
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
    readonly answer: WaitlistCall.Cancelled;
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
  [Callables.CancelAppointment]: BookingCall.decodeCancelled,
  [Callables.RescheduleAppointment]: BookingCall.decodeRescheduled,
  [Callables.TransitionAppointment]: BookingCall.decodeTransitioned,
  [Callables.MarkArrived]: BookingCall.decodeArrived,
  [Callables.ClearArrival]: BookingCall.decodeCleared,
  [Callables.RecordSeatTip]: BookingCall.decodeTipRecorded,
  [Callables.StaffEditAppointment]: BookingCall.decodeStaffEdited,
  [Callables.RequestWaitlist]: WaitlistCall.decodeRequested,
  [Callables.CancelWaitlist]: WaitlistCall.decodeCancelled,
  [Callables.RunBackfill]: BackfillCall.decodePage,
  [Callables.PublishStreakDefinition]: StreakPublishCall.decodeAnswer,
  [Callables.StartImpersonation]: GovernanceCall.decodeStarted,
  [Callables.EndImpersonation]: GovernanceCall.decodeEnded,
  [Callables.RedeemInvitation]: InvitationCall.decodeRedeemed,
  [Callables.ReportClientIssues]: decodeIssuesLogged,
};
