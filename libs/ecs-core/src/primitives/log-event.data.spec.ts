import { describe, expect, it } from 'vitest';
import { LogEvent } from './log-event.data';

/* The log vocabulary (audit-hardening WS-1 / WS-4.2 / WS-4.6, RU-8, RU-9): the
 * existing message texts byte for byte — the metric filters, the runbook
 * recipes and the web's `endsWith('dropped')` classifier read them. */

describe('LogEvent', () => {
  it('keeps every existing message text byte for byte, beside the new dotted values', () => {
    expect(LogEvent).toEqual({
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
      ProfileUpdateRefused: 'profile.update.refused',
      RegistrationDisplayNameFailed: 'registration.display_name_failed',
      RhythmRuleWriteFailed: 'rhythm rule write failed',
      TriggerAttemptFailed: 'trigger attempt failed',
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
