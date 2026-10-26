import { describe, expect, it } from 'vitest';
import { LogEvent } from './log-event.data';

/* The log vocabulary (audit-hardening WS-1 / WS-4.6, RU-8, RU-9): the
 * existing message texts byte for byte — the metric filters, the runbook
 * recipes and the web's `endsWith('dropped')` classifier read them. */

describe('LogEvent', () => {
  it('keeps every existing message text byte for byte', () => {
    expect(LogEvent).toEqual({
      AuditActorMissing: 'audit row has no verified actor',
      AuditWriteFailed: 'audit write failed',
      BackfillAuditNotWritten: 'backfill audit row not written',
      BarberBusyRebuildFailed: 'barberBusy rebuild failed',
      BookingRejected: 'booking.rejected',
      CancelPolicyUnread: 'cancellation policy unread; cancel refused',
      CancelWindowUnread: 'cancellation window unread; stamped unknown',
      CapacitySpanTruncated: 'capacity span truncated at 500 days',
      CapacitySweepFailed: 'capacity sweep failed for barber',
      ClientIssueBatchRefused: 'client issue batch refused',
      DocumentDropped: 'malformed document dropped',
      DocumentRefused: 'malformed document refused',
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
