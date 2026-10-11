import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  CouponGrantId,
  WaitlistRequestId,
} from '../primitives/ids.primitive';
import { FIXTURE_TIME_ZONE, localDate, minute, utcMs } from '../testing';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import { RewardRefFields } from './journal-effect.data';
import {
  NotificationPayload,
  NotificationTopic,
} from './notification-payload.data';

/** 14:30 on the shop's wall clock (Europe/Sofia, EEST) — no zone rides on the payload. */
const DAY = localDate('2026-10-14');
const START = minute(14 * 60 + 30);

describe('NotificationPayload', () => {
  it('declares the topics SCREAMING (the discriminator `notificationTopic`)', () => {
    expect(Object.values(NotificationTopic)).toEqual([
      'APPOINTMENT_REMINDER',
      'APPOINTMENT_CHANGED',
      'WAITLIST_MATCH',
      'REWARD_GRANTED',
      'ANNOUNCEMENT',
    ]);
  });

  it('carries the waitlist match as facts, never words — the shop wall clock, no zone', () => {
    // The instant today's payload carried is the same wall clock in the shop's zone.
    expect(
      ZonedTimeSystem.toLocal(
        utcMs('2026-10-14T11:30:00.000Z'),
        FIXTURE_TIME_ZONE,
      ),
    ).toEqual({ localDate: DAY, minute: START });
    expect(
      NotificationPayload.waitlistMatch(
        WaitlistRequestId.of('wl_abc'),
        DAY,
        START,
      ),
    ).toEqual({
      notificationTopic: 'WAITLIST_MATCH',
      waitlistRequestId: 'wl_abc',
      localDate: '2026-10-14',
      startMinutes: 870,
    });
  });

  it('carries the other topics’ facts', () => {
    const appt = AppointmentId.of('appt-1');
    expect(NotificationPayload.appointmentReminder(appt, DAY, START)).toEqual({
      notificationTopic: 'APPOINTMENT_REMINDER',
      appointmentId: 'appt-1',
      localDate: '2026-10-14',
      startMinutes: 870,
    });
    expect(
      NotificationPayload.appointmentChanged(appt, DAY, START)
        .notificationTopic,
    ).toBe('APPOINTMENT_CHANGED');
    expect(
      NotificationPayload.rewardGranted(
        RewardRefFields.couponGrant(CouponGrantId.of('grant-1')),
      ),
    ).toEqual({
      notificationTopic: 'REWARD_GRANTED',
      rewardRef: 'COUPON_GRANT',
      rewardCouponGrantId: 'grant-1',
    });
    expect(
      NotificationPayload.announcement(
        { bg: 'Нови часове', en: 'New hours' },
        null,
      ),
    ).toEqual({
      notificationTopic: 'ANNOUNCEMENT',
      announcementTitle: { bg: 'Нови часове', en: 'New hours' },
      announcementBody: null,
    });
  });
});
