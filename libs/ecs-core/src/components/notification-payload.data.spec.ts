import { describe, expect, it } from 'vitest';
import type { AppointmentId } from '../entities/appointment.entity';
import type { CouponGrantId } from '../entities/coupon-grant.entity';
import type { WaitlistRequestId } from '../entities/waitlist-request.entity';
import {
  NotificationKind,
  NotificationPayload,
} from './notification-payload.data';

const START = Date.UTC(2026, 9, 14, 11, 30); // 14:30 Europe/Sofia (EEST)

describe('NotificationPayload', () => {
  it('keeps the stored kinds', () => {
    expect(Object.values(NotificationKind)).toEqual([
      'appointment_reminder',
      'appointment_changed',
      'waitlist_match',
      'reward_granted',
      'announcement',
    ]);
  });

  it('carries the waitlist match as facts, never words', () => {
    expect(
      NotificationPayload.waitlistMatch(
        'wl_abc' as WaitlistRequestId,
        START,
        'Europe/Sofia',
      ),
    ).toEqual({
      kind: 'waitlist_match',
      requestId: 'wl_abc',
      startMs: START,
      zone: 'Europe/Sofia',
    });
  });

  it('carries the other kinds’ facts', () => {
    const appt = 'appt-1' as AppointmentId;
    expect(
      NotificationPayload.appointmentReminder(appt, START, 'Europe/Sofia'),
    ).toEqual({
      kind: 'appointment_reminder',
      appointmentId: 'appt-1',
      startMs: START,
      zone: 'Europe/Sofia',
    });
    expect(
      NotificationPayload.appointmentChanged(appt, START, 'Europe/Sofia').kind,
    ).toBe('appointment_changed');
    expect(
      NotificationPayload.rewardGranted({
        kind: 'couponGrant',
        id: 'grant-1' as CouponGrantId,
      }),
    ).toEqual({
      kind: 'reward_granted',
      reward: { kind: 'couponGrant', id: 'grant-1' },
    });
    expect(
      NotificationPayload.announcement(
        { bg: 'Нови часове', en: 'New hours' },
        null,
      ),
    ).toEqual({
      kind: 'announcement',
      title: { bg: 'Нови часове', en: 'New hours' },
      body: null,
    });
  });
});
