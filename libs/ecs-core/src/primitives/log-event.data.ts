/**
 * The operator vocabulary of the structured log (audit-hardening WS-1 /
 * WS-4.6, RU-8, RU-9): every message a `Log` call writes, declared once.
 * A pipeline, an edge or an adapter passes `LogEvent.X` as the `msg` of the
 * `Log` port — whose signature stays the law's verbatim (`msg: string`) —
 * so a log-based metric, a runbook recipe or `production-deploy.md` filters
 * on a value that has ONE home.
 *
 * The values are the existing message texts, byte for byte (the metric
 * filters and the web's `endsWith('dropped')` classifier read them); a NEW
 * value is dotted and domain-prefixed (`callable.completed`). Lower-case on
 * purpose: this is an operator vocabulary like `HttpsStatus`, not a
 * discriminator dictionary (Law 1's SCREAMING rule binds those). Home:
 * primitives — the one tier every caller (ports, pipelines, the apps) may
 * import (Law 8).
 */
export const LogEvent = {
  AuditActorMissing: 'audit row has no verified actor',
  AuditWriteFailed: 'audit write failed',
  BackfillAuditNotWritten: 'backfill audit row not written',
  BarberBusyRebuildFailed: 'barberBusy rebuild failed',
  BookingMoveRejected: 'booking.move_rejected',
  BookingRejected: 'booking.rejected',
  BookingStaffEditRejected: 'booking.staff_edit_rejected',
  CallableCompleted: 'callable.completed',
  CallableFailed: 'callable.failed',
  CallableRefused: 'callable.refused',
  CancelPolicyUnread: 'cancellation policy unread; cancel refused',
  CancelWindowUnread: 'cancellation window unread; stamped unknown',
  CapacitySpanTruncated: 'capacity span truncated at 500 days',
  CapacitySweepFailed: 'capacity sweep failed for barber',
  ClientIssueBatchRefused: 'client issue batch refused',
  DocumentDropped: 'malformed document dropped',
  DocumentRefused: 'malformed document refused',
  DocumentVersionsRead: 'document.versions_read',
  ImpersonationEnded: 'impersonation.ended',
  ImpersonationEndRefused: 'impersonation.end.refused',
  ImpersonationStarted: 'impersonation.started',
  ImpersonationStartRefused: 'impersonation.start.refused',
  InvitationRedeemRefused: 'invitation.redeem.refused',
  LeadTimeSampleFailed: 'lead-time sample failed for barber',
  OtpSendFailed: 'otp.send_failed',
  OtpVerifyAdoptionRefused: 'otp.verify.adoption_refused',
  PolicyRecomputeNudged: 'policy recompute nudged',
  PolicyRecomputeStallNotRecorded: 'policy recompute stall not recorded',
  PolicyRecomputeSweepStarted:
    'policy recompute started by the sweep: a dropped start',
  /** An admin's data-subject erasure completed — its record certified `ERASED` (audit-hardening Phase 3 WS-D): ids and counts only. */
  PrivacyClientErased: 'privacy.client_erased',
  /** An admin's data-subject export answered (audit-hardening Phase 3 WS-C): counts and ids only, never the bundle. */
  PrivacyClientExported: 'privacy.client_exported',
  /** One call of an admin's erasure answered (audit-hardening Phase 3 WS-D): the record's tag, done or not, the residue counts — never a value. */
  PrivacyErasureStep: 'privacy.erasure_step',
  ProfileUpdateRefused: 'profile.update.refused',
  RegistrationDisplayNameFailed: 'registration.display_name_failed',
  RhythmRuleWriteFailed: 'rhythm rule write failed',
  TriggerAttemptFailed: 'trigger attempt failed',
  TriggerFailureNotRecorded: 'trigger.failure_not_recorded',
  WaitlistBarberSkipped: 'waitlist barber skipped',
  WaitlistMatchFailed: 'waitlist match failed',
} as const;

/** One message of the log vocabulary — a value of {@link LogEvent}. */
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
