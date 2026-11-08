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
  /**
   * One past barber-day's figures written (`writeAnalyticsDay`, staff
   * analytics v2): `barberId`, `localDate`, `source` (the command — an
   * appointment, a departure, the recompute), `visitCount`, `durationMs`
   * — never money.
   */
  AnalyticsDayWritten: 'analytics.day_written',
  /** A day document could not be written and a redelivery cannot help: the busy `key` and the canonical failure `code` — what an oncall answers "which day is stale and why" from. */
  AnalyticsDayWriteFailed: 'analytics.day_write_failed',
  /** The recompute's pass ran off the end of its extent: `barbers`, `checked`, `written`, `failed`, `steps`. */
  AnalyticsRecomputeDone: 'analytics.recompute_done',
  /** A step of the recompute could not record its stall on the job (best effort): the job and the canonical `code`. */
  AnalyticsRecomputeStallNotRecorded: 'analytics.recompute_stall_not_recorded',
  /** One step of the recompute advanced: the `cursor`, keys `checked`, `eligible`, `written`, `skipped` (not past), `kept` (a newer document), `failed`, and the pass's `steps`. */
  AnalyticsRecomputeStep: 'analytics.recompute_step',
  /** The 04:30 sweep wrote the job: its `outcome` (started or nudged), the window (`fullReach`, `fromLocalDate`, `toLocalDate`), `barbers`, the `cursor` kept and the stall's `lastFailureCode`. */
  AnalyticsRecomputeSwept: 'analytics.recompute_swept',
  /** A staff analytics report answered (`staffAnalytics`): the caller, scope, period, counts and minutes per part — never money (logs are read by the vendor). */
  AnalyticsReported: 'analytics.reported',
  /** The App Check switch held a non-empty value that is no mode — read as OFF, logged once per instance (security hardening S-RU-19). */
  AppCheckModeUnreadable: 'edge.app_check_mode_unreadable',
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
  /** An admin changed an account's roles (security hardening S-WS-E): ids and a count only. */
  RolesChanged: 'roles.changed',
  /** `setRoles` refused: the code alone. */
  RolesChangeRefused: 'roles.change_refused',
  /** The roles are committed but the target's sessions were not revoked (S-RU-10) — alerted on any occurrence. */
  RolesSessionsNotRevoked: 'roles.sessions_not_revoked',
  /** The target's sessions were revoked — every successful revoke, the unchanged call too (S-L-26): ids and a boolean. */
  RolesSessionsRevoked: 'roles.sessions_revoked',
  TriggerAttemptFailed: 'trigger attempt failed',
  TriggerFailureNotRecorded: 'trigger.failure_not_recorded',
  WaitlistBarberSkipped: 'waitlist barber skipped',
  WaitlistMatchFailed: 'waitlist match failed',
} as const;

/** One message of the log vocabulary — a value of {@link LogEvent}. */
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
