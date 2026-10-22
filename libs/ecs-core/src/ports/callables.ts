/**
 * The callable registry (blueprint §4.1, §4.2) — the ONE spelling of every
 * server export the web dials through {@link CallableClient}
 * (`scheduling.port.ts`). A values file on purpose, like
 * `entities/collections.ts`: not a `*.data.ts` (it names deployed functions, not
 * a component) and not a `*.port.ts` (ports are function types). Each value
 * is the export name in `apps/functions/src/main.ts` verbatim — the name
 * Firebase deploys and the browser SDK resolves — so the Phase 3b flips
 * delete the string literals of today's gateway adapters
 * (`booking-gateway.adapter.ts`, `otp-client.adapter.ts`,
 * `waitlist-gateway.adapter.ts`, `streak-publish-gateway.adapter.ts`).
 *
 * Only callables the server exports TODAY are listed: a name here that no
 * function exports would type-check a call that can only fail at run time
 * (the `contact-change.adapter.ts` defect, §1.4). The Phase 3 pipelines that
 * add a callable add its name in the same change as its export —
 * `updateProfile` with the identity flip (2); `startImpersonation`,
 * `endImpersonation` and `redeemInvitation` with theirs.
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
} as const;
export type CallableName = (typeof Callables)[keyof typeof Callables];
