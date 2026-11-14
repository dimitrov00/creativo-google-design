import { describe, expect, it } from 'vitest';
import { LogEvent } from './log-event.data';

/* The log vocabulary (audit-hardening WS-1 / WS-4.2 / WS-4.6, RU-8, RU-9): the
 * existing message texts byte for byte — the metric filters, the runbook
 * recipes and the web's `endsWith('dropped')` classifier read them. */

describe('LogEvent', () => {
  it('keeps every existing message text byte for byte, beside the new dotted values', () => {
    expect(LogEvent).toEqual({
      AnalyticsDayWritten: 'analytics.day_written',
      AnalyticsDayWriteFailed: 'analytics.day_write_failed',
      AnalyticsRecomputeDone: 'analytics.recompute_done',
      AnalyticsRecomputeStallNotRecorded:
        'analytics.recompute_stall_not_recorded',
      AnalyticsRecomputeStep: 'analytics.recompute_step',
      AnalyticsRecomputeSwept: 'analytics.recompute_swept',
      AnalyticsReported: 'analytics.reported',
      AnalyticsGoalSet: 'analytics.goal_set',
      AnalyticsGoalCleared: 'analytics.goal_cleared',
      AnalyticsGoalRefused: 'analytics.goal_refused',
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
      PermissionsChanged: 'permissions.changed',
      PermissionsChangeRefused: 'permissions.change_refused',
      PolicyRecomputeNudged: 'policy recompute nudged',
      PolicyRecomputeStallNotRecorded: 'policy recompute stall not recorded',
      PolicyRecomputeSweepStarted:
        'policy recompute started by the sweep: a dropped start',
      PrivacyClientErased: 'privacy.client_erased',
      PrivacyClientExported: 'privacy.client_exported',
      PrivacyErasureStep: 'privacy.erasure_step',
      ProfileUpdateRefused: 'profile.update.refused',
      RegistrationDisplayNameFailed: 'registration.display_name_failed',
      RhythmRuleWriteFailed: 'rhythm rule write failed',
      RolesChanged: 'roles.changed',
      RolesChangeRefused: 'roles.change_refused',
      RolesSessionsNotRevoked: 'roles.sessions_not_revoked',
      RolesSessionsRevoked: 'roles.sessions_revoked',
      TriggerAttemptFailed: 'trigger attempt failed',
      TriggerFailureNotRecorded: 'trigger.failure_not_recorded',
      WaitlistBarberSkipped: 'waitlist barber skipped',
      WaitlistMatchFailed: 'waitlist match failed',
    });
  });

  it('spells every WS-4.2 value dotted and domain-prefixed', () => {
    const added = [
      LogEvent.CallableCompleted,
      LogEvent.CallableRefused,
      LogEvent.CallableFailed,
      LogEvent.BookingMoveRejected,
      LogEvent.BookingStaffEditRejected,
      LogEvent.DocumentVersionsRead,
    ];
    for (const text of added) expect(text).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(
      [
        LogEvent.CallableCompleted,
        LogEvent.CallableRefused,
        LogEvent.CallableFailed,
      ].every((text) => text.startsWith('callable.')),
    ).toBe(true);
  });

  it('spells the WS-6 dead-letter value dotted and domain-prefixed, beside the attempt line it follows', () => {
    expect(LogEvent.TriggerFailureNotRecorded).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(LogEvent.TriggerFailureNotRecorded.startsWith('trigger.')).toBe(
      true,
    );
    expect(LogEvent.TriggerFailureNotRecorded).not.toBe(
      LogEvent.TriggerAttemptFailed,
    );
  });

  it('spells the Phase 3 privacy value dotted and domain-prefixed (WS-C)', () => {
    expect(LogEvent.PrivacyClientExported).toBe('privacy.client_exported');
    expect(LogEvent.PrivacyClientExported).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(LogEvent.PrivacyClientExported.startsWith('privacy.')).toBe(true);
  });

  it('spells the Phase 3 erasure values dotted and domain-prefixed (WS-D)', () => {
    expect(LogEvent.PrivacyErasureStep).toBe('privacy.erasure_step');
    expect(LogEvent.PrivacyClientErased).toBe('privacy.client_erased');
    for (const text of [
      LogEvent.PrivacyErasureStep,
      LogEvent.PrivacyClientErased,
    ]) {
      expect(text).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(text.startsWith('privacy.')).toBe(true);
    }
    expect(LogEvent.PrivacyErasureStep).not.toBe(LogEvent.PrivacyClientErased);
  });

  it('spells the roles-change values dotted and domain-prefixed (security hardening S-WS-E)', () => {
    for (const text of [
      LogEvent.RolesChanged,
      LogEvent.RolesChangeRefused,
      LogEvent.RolesSessionsNotRevoked,
      LogEvent.RolesSessionsRevoked,
    ]) {
      expect(text).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(text.startsWith('roles.')).toBe(true);
    }
    // The alert filters on the failed revoke's value alone (S-RU-10).
    expect(LogEvent.RolesSessionsNotRevoked).not.toBe(
      LogEvent.RolesSessionsRevoked,
    );
  });

  it('spells the staff analytics values dotted and domain-prefixed', () => {
    expect(LogEvent.AnalyticsReported).toBe('analytics.reported');
    for (const text of [
      LogEvent.AnalyticsReported,
      LogEvent.AnalyticsDayWritten,
      LogEvent.AnalyticsDayWriteFailed,
      LogEvent.AnalyticsRecomputeDone,
      LogEvent.AnalyticsRecomputeStallNotRecorded,
      LogEvent.AnalyticsRecomputeStep,
      LogEvent.AnalyticsRecomputeSwept,
      LogEvent.AnalyticsGoalSet,
      LogEvent.AnalyticsGoalCleared,
      LogEvent.AnalyticsGoalRefused,
    ]) {
      expect(text).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(text.startsWith('analytics.')).toBe(true);
    }
    // An oncall filters the stale-day question on the failed write's value alone.
    expect(LogEvent.AnalyticsDayWriteFailed).not.toBe(
      LogEvent.AnalyticsDayWritten,
    );
  });

  it('spells the App Check switch value dotted and edge-prefixed (security hardening S-RU-19)', () => {
    expect(LogEvent.AppCheckModeUnreadable).toBe(
      'edge.app_check_mode_unreadable',
    );
    expect(LogEvent.AppCheckModeUnreadable).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(LogEvent.AppCheckModeUnreadable.startsWith('edge.')).toBe(true);
  });

  it('names every message once: no two events share a text', () => {
    const texts = Object.values(LogEvent);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text.trim()).toBe(text);
  });

  it('keeps the two "dropped" / "refused" pair apart for the web classifier', () => {
    expect(LogEvent.DocumentDropped.endsWith('dropped')).toBe(true);
    expect(LogEvent.DocumentRefused.endsWith('dropped')).toBe(false);
  });
});
