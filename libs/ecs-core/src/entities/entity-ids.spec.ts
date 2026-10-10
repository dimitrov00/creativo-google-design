import { describe, expect, it } from 'vitest';
import {
  BOOKING_POLICY_DOC,
  CLIENT_MONEY_DOC,
  POLICY_RECOMPUTE_DOC,
} from '../ports/collections';
import { BackfillJobKind } from './backfill-job.entity';
import { PolicyRecomputeJobKind } from './policy-recompute-job.entity';
import { AppointmentPhotoId } from './appointment-photo.entity';
import { AppointmentId } from './appointment.entity';
import { AuditEntryId } from './audit-entry.entity';
import { BackfillJobId } from './backfill-job.entity';
import { BadgeCategoryId } from './badge-category.entity';
import { SeriesId } from './badge-series.entity';
import { BarberBusyDayId } from './barber-busy-day.entity';
import { BarberLeadTimeSampleId } from './barber-lead-time-sample.entity';
import { BarberId } from './barber.entity';
import { BookingPolicySettingsId } from './booking-policy-settings.entity';
import { CapacityMonthId } from './capacity-month.entity';
import { ClientMoneyStatsId } from './client-money-stats.entity';
import { CouponGrantId } from './coupon-grant.entity';
import { CouponId } from './coupon.entity';
import { CourseId } from './course.entity';
import { EventId } from './event.entity';
import { GiftVoucherId } from './gift-voucher.entity';
import { ImpersonationSessionId } from './impersonation-session.entity';
import { InvitationId } from './invitation.entity';
import { JournalEntryId } from './journal-entry.entity';
import { LocationId } from './location.entity';
import { NotificationId } from './notification.entity';
import { OtpId } from './otp.entity';
import { PolicyRecomputeJobId } from './policy-recompute-job.entity';
import { PositionId } from './position.entity';
import { RewardId } from './reward-catalog-item.entity';
import { ScheduleExceptionId } from './schedule-exception.entity';
import { SeasonId } from './season.entity';
import { ServiceCategoryId } from './service-category.entity';
import { ServiceId } from './service.entity';
import { StreakDefinitionVersionId } from './streak-definition-version.entity';
import { StreakDefinitionId } from './streak-definition.entity';
import { TierId } from './tier-definition.entity';
import { UserId } from './user.entity';
import { WaitlistRequestId } from './waitlist-request.entity';

/**
 * The runtime half of the brand proof (`ids.type-spec.ts` is the compile
 * half): every entity id companion's `of` is the zero-cost identity cast —
 * the brand exists only in the type system — and the fixed document ids
 * agree with the collection registry.
 */
const ID_COMPANIONS: readonly (readonly [
  string,
  { readonly of: (raw: string) => string },
])[] = [
  ['AppointmentPhotoId', AppointmentPhotoId],
  ['AppointmentId', AppointmentId],
  ['AuditEntryId', AuditEntryId],
  ['BackfillJobId', BackfillJobId],
  ['BadgeCategoryId', BadgeCategoryId],
  ['SeriesId', SeriesId],
  ['BarberBusyDayId', BarberBusyDayId],
  ['BarberLeadTimeSampleId', BarberLeadTimeSampleId],
  ['BarberId', BarberId],
  ['BookingPolicySettingsId', BookingPolicySettingsId],
  ['CapacityMonthId', CapacityMonthId],
  ['ClientMoneyStatsId', ClientMoneyStatsId],
  ['CouponGrantId', CouponGrantId],
  ['CouponId', CouponId],
  ['CourseId', CourseId],
  ['EventId', EventId],
  ['GiftVoucherId', GiftVoucherId],
  ['ImpersonationSessionId', ImpersonationSessionId],
  ['InvitationId', InvitationId],
  ['JournalEntryId', JournalEntryId],
  ['LocationId', LocationId],
  ['NotificationId', NotificationId],
  ['OtpId', OtpId],
  ['PolicyRecomputeJobId', PolicyRecomputeJobId],
  ['PositionId', PositionId],
  ['RewardId', RewardId],
  ['ScheduleExceptionId', ScheduleExceptionId],
  ['SeasonId', SeasonId],
  ['ServiceCategoryId', ServiceCategoryId],
  ['ServiceId', ServiceId],
  ['StreakDefinitionVersionId', StreakDefinitionVersionId],
  ['StreakDefinitionId', StreakDefinitionId],
  ['TierId', TierId],
  ['UserId', UserId],
  ['WaitlistRequestId', WaitlistRequestId],
];

describe('entity id companions', () => {
  it.each(ID_COMPANIONS)(
    '%s.of is the identity on the raw string',
    (_name, companion) => {
      expect(companion.of('raw-id-1')).toBe('raw-id-1');
      expect(typeof companion.of('')).toBe('string');
    },
  );

  it('covers every entity id brand (35)', () => {
    expect(new Set(ID_COMPANIONS.map(([name]) => name)).size).toBe(35);
  });
});

describe('fixed document ids', () => {
  it('are the registry constants, each a single literal', () => {
    expect(BookingPolicySettingsId.FIXED).toBe('bookingPolicy');
    expect(BOOKING_POLICY_DOC).toBe(BookingPolicySettingsId.FIXED);
    expect(ClientMoneyStatsId.FIXED).toBe('money');
    expect(CLIENT_MONEY_DOC).toBe(ClientMoneyStatsId.FIXED);
    expect(PolicyRecomputeJobId.FIXED).toBe('clientStatsPolicy');
    expect(POLICY_RECOMPUTE_DOC).toBe(PolicyRecomputeJobId.FIXED);
  });

  it('the policy pass lives beside the backfill jobs under its own tag', () => {
    expect(PolicyRecomputeJobId.FIXED).toBe(
      PolicyRecomputeJobKind.ClientStatsPolicy,
    );
    expect(Object.values(BackfillJobKind)).not.toContain(
      PolicyRecomputeJobKind.ClientStatsPolicy,
    );
    expect(Object.values(BackfillJobKind)).toEqual([
      'subjectMirror',
      'clientStats',
    ]);
  });
});
