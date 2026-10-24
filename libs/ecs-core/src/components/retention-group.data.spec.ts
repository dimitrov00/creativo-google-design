import { describe, expect, it } from 'vitest';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import { RetentionAnchor, RetentionGroup } from './retention-group.data';

/*
 * The TTL groups and their anchors (pass C, P-34): one SCREAMING value per
 * group, and a factory per anchor that stamps its own group — what the TTL
 * adapter builds from a parsed body before `RetentionSystem.purgeAtUtcMs`.
 */

describe('RetentionGroup', () => {
  it('names every TTL group once, in the runbook’s order (§2.1)', () => {
    expect(Object.values(RetentionGroup)).toEqual([
      'BARBER_BUSY',
      'CAPACITY',
      'WAITLIST_REQUESTS',
      'NOTIFICATIONS',
      'LEAD_TIME_SAMPLES',
      'OTPS',
      'IMPERSONATION_SESSIONS',
    ]);
  });
});

describe('RetentionAnchor — one plain anchor per group', () => {
  it('stamps each anchor with its own group, beside the fields its formula reads', () => {
    const day = localDate('2026-10-07');
    const instant = utcMs('2026-10-07T09:05:00.000Z');
    expect(RetentionAnchor.barberBusy(day)).toEqual({
      retentionGroup: 'BARBER_BUSY',
      localDate: day,
    });
    expect(RetentionAnchor.capacity(localDate('2026-02-01'))).toEqual({
      retentionGroup: 'CAPACITY',
      monthFirstDay: '2026-02-01',
    });
    expect(RetentionAnchor.waitlistRequests([day])).toEqual({
      retentionGroup: 'WAITLIST_REQUESTS',
      localDates: [day],
    });
    expect(RetentionAnchor.notifications(instant)).toEqual({
      retentionGroup: 'NOTIFICATIONS',
      sentAtUtcMs: instant,
    });
    expect(RetentionAnchor.leadTimeSamples(day)).toEqual({
      retentionGroup: 'LEAD_TIME_SAMPLES',
      localDate: day,
    });
    expect(RetentionAnchor.otps(instant)).toEqual({
      retentionGroup: 'OTPS',
      expiresAtUtcMs: instant,
    });
    expect(RetentionAnchor.impersonationSessions(null, instant)).toEqual({
      retentionGroup: 'IMPERSONATION_SESSIONS',
      endedAtUtcMs: null,
      expiresAtUtcMs: instant,
    });
  });

  it('copies a request’s days, so a caller’s later mutation cannot move the anchor', () => {
    const days = [localDate('2026-10-09')];
    const anchor = RetentionAnchor.waitlistRequests(days);
    days.push(localDate('2026-12-31'));
    expect(anchor.localDates).toEqual(['2026-10-09']);
    const frozen = deepFreeze([localDate('2026-10-09')]);
    expect(RetentionAnchor.waitlistRequests(frozen)).toEqual(
      RetentionAnchor.waitlistRequests(frozen),
    );
  });
});
