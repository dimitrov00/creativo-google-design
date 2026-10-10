/**
 * Compile-time-only proof that every brand in ecs-core is nominal — no
 * runtime `expect()`/`it()`; `nx typecheck` runs it through
 * `tsconfig.spec.json` (`src/**\/*.type-spec.ts`), like the twelve legacy
 * type-specs. Covers all 52 brands — 17 component brands and 35 entity id
 * brands — checked against their declarations when this file was written.
 * A new brand is added to {@link Brands}; the matrix then covers it against
 * every other one.
 *
 * Three proofs:
 *
 * 1. **All pairs** — {@link CrossingPairs} walks every ordered pair (A, B),
 *    A ≠ B, of {@link Brands} (2652 pairs) and names each pair where an A is
 *    assignable to a B; `Expect<IsNever<…>>` fails to compile on any. Two
 *    probes show the checks are not vacuous.
 * 2. **Explicit cross-assignments** — a bare `string`/`number` is refused
 *    for every brand, and every brand is refused as the next brand of a ring
 *    (each brand once as source, once as target), each a `@ts-expect-error`.
 * 3. **The way in** — `X.of(raw)` makes one, and a brand still reads as its
 *    base type.
 */
import { BirthDate } from '../components/birth-date.data';
import { BusyKey } from '../components/busy-key.data';
import { CountryIso2 } from '../components/country-iso2.data';
import { CurrencyCode } from '../components/currency-code.data';
import { DayKey } from '../components/day-key.data';
import { Email } from '../components/email.data';
import { Identifier } from '../components/identifier.data';
import { MediaRefId } from '../components/media-ref.data';
import { OtpCode } from '../components/otp-code.data';
import { E164 } from '../components/phone-number.data';
import { Points } from '../components/points.data';
import { RedemptionCount } from '../components/redemption-count.data';
import { SeatLabel } from '../components/seat-label.data';
import { SeatId } from '../components/seat.data';
import { ServiceVariantId } from '../components/service-terms.data';
import { TenantId } from '../components/tenant-id.data';
import { VoucherCode } from '../components/voucher-code.data';
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

/** Every brand ecs-core declares, by name. */
type Brands = {
  readonly BirthDate: BirthDate;
  readonly BusyKey: BusyKey;
  readonly CountryIso2: CountryIso2;
  readonly CurrencyCode: CurrencyCode;
  readonly DayKey: DayKey;
  readonly E164: E164;
  readonly Email: Email;
  readonly Identifier: Identifier;
  readonly MediaRefId: MediaRefId;
  readonly OtpCode: OtpCode;
  readonly Points: Points;
  readonly RedemptionCount: RedemptionCount;
  readonly SeatId: SeatId;
  readonly SeatLabel: SeatLabel;
  readonly ServiceVariantId: ServiceVariantId;
  readonly TenantId: TenantId;
  readonly VoucherCode: VoucherCode;
  readonly AppointmentId: AppointmentId;
  readonly AppointmentPhotoId: AppointmentPhotoId;
  readonly AuditEntryId: AuditEntryId;
  readonly BackfillJobId: BackfillJobId;
  readonly BadgeCategoryId: BadgeCategoryId;
  readonly BarberBusyDayId: BarberBusyDayId;
  readonly BarberId: BarberId;
  readonly BarberLeadTimeSampleId: BarberLeadTimeSampleId;
  readonly BookingPolicySettingsId: BookingPolicySettingsId;
  readonly CapacityMonthId: CapacityMonthId;
  readonly ClientMoneyStatsId: ClientMoneyStatsId;
  readonly CouponGrantId: CouponGrantId;
  readonly CouponId: CouponId;
  readonly CourseId: CourseId;
  readonly EventId: EventId;
  readonly GiftVoucherId: GiftVoucherId;
  readonly ImpersonationSessionId: ImpersonationSessionId;
  readonly InvitationId: InvitationId;
  readonly JournalEntryId: JournalEntryId;
  readonly LocationId: LocationId;
  readonly NotificationId: NotificationId;
  readonly OtpId: OtpId;
  readonly PolicyRecomputeJobId: PolicyRecomputeJobId;
  readonly PositionId: PositionId;
  readonly RewardId: RewardId;
  readonly ScheduleExceptionId: ScheduleExceptionId;
  readonly SeasonId: SeasonId;
  readonly SeriesId: SeriesId;
  readonly ServiceCategoryId: ServiceCategoryId;
  readonly ServiceId: ServiceId;
  readonly StreakDefinitionId: StreakDefinitionId;
  readonly StreakDefinitionVersionId: StreakDefinitionVersionId;
  readonly TierId: TierId;
  readonly UserId: UserId;
  readonly WaitlistRequestId: WaitlistRequestId;
};

type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Assignability, undistributed. */
type Assignable<A, B> = [A] extends [B] ? true : false;
/** The primitive a brand is built on. */
type BaseOf<T> = T extends number ? number : string;

/** Every ordered pair `[A, B]` (A ≠ B) of `T` where an A is assignable to a B. */
type CrossingPairs<T> = {
  [A in keyof T]: {
    [B in Exclude<keyof T, A>]: Assignable<T[A], T[B]> extends true
      ? readonly [A, B]
      : never;
  }[Exclude<keyof T, A>];
}[keyof T];

/** Every brand a bare value of its base type is assignable to. */
type OpenBrands<T> = {
  [K in keyof T]: Assignable<BaseOf<T[K]>, T[K]> extends true ? K : never;
}[keyof T];

/** Every brand that does NOT read as its base type. */
type OpaqueBrands<T> = {
  [K in keyof T]: Assignable<T[K], BaseOf<T[K]>> extends true ? never : K;
}[keyof T];

// (1) No brand crosses another over all 2652 ordered pairs …
export type NoBrandCrossesAnother = Expect<IsNever<CrossingPairs<Brands>>>;
// … no bare string/number stands in for any brand …
export type NoBrandIsOpen = Expect<IsNever<OpenBrands<Brands>>>;
// … and every brand still reads as its base type.
export type EveryBrandReadsAsItsBase = Expect<IsNever<OpaqueBrands<Brands>>>;

// The checks are not vacuous: a plain alias beside a brand IS caught.
export type ProbeCrossing = Expect<
  // @ts-expect-error — a UserId is assignable to a plain string, so this pair crosses.
  IsNever<CrossingPairs<{ a: UserId; b: string }>>
>;
export type ProbeOpen = Expect<
  // @ts-expect-error — a plain string is open, so the open-brand check fires.
  IsNever<OpenBrands<{ a: string }>>
>;

/** Accepts exactly a `B`; the explicit type argument is the assertion. */
declare function expectBrand<B>(value: B): void;

// (3) The way in: `of` makes each brand.
const birthDate = BirthDate.of('birth-date-1');
const busyKey = BusyKey.of(BarberId.of('b-ivan'), DayKey.of('2026-09-28'));
const countryIso2 = CountryIso2.of('country-iso2-1');
const currencyCode = CurrencyCode.of('currency-code-1');
const dayKey = DayKey.of('day-key-1');
const e164 = E164.of('e164-1');
const email = Email.of('email-1');
const identifier = Identifier.of('identifier-1');
const mediaRefId = MediaRefId.of('media-ref-1');
const otpCode = OtpCode.of('otp-code-1');
const points = Points.of(3);
const redemptionCount = RedemptionCount.of(3);
const seatId = SeatId.of('seat-1');
const seatLabel = SeatLabel.of('seat-label-1');
const serviceVariantId = ServiceVariantId.of('service-variant-1');
const tenantId = TenantId.of('tenant-1');
const voucherCode = VoucherCode.of('voucher-code-1');
const appointmentId = AppointmentId.of('appointment-1');
const appointmentPhotoId = AppointmentPhotoId.of('appointment-photo-1');
const auditEntryId = AuditEntryId.of('audit-entry-1');
const backfillJobId = BackfillJobId.of('backfill-job-1');
const badgeCategoryId = BadgeCategoryId.of('badge-category-1');
const barberBusyDayId = BarberBusyDayId.of('barber-busy-day-1');
const barberId = BarberId.of('barber-1');
const barberLeadTimeSampleId = BarberLeadTimeSampleId.of(
  'barber-lead-time-sample-1',
);
const bookingPolicySettingsId = BookingPolicySettingsId.of(
  'booking-policy-settings-1',
);
const capacityMonthId = CapacityMonthId.of('capacity-month-1');
const clientMoneyStatsId = ClientMoneyStatsId.of('client-money-stats-1');
const couponGrantId = CouponGrantId.of('coupon-grant-1');
const couponId = CouponId.of('coupon-1');
const courseId = CourseId.of('course-1');
const eventId = EventId.of('event-1');
const giftVoucherId = GiftVoucherId.of('gift-voucher-1');
const impersonationSessionId = ImpersonationSessionId.of(
  'impersonation-session-1',
);
const invitationId = InvitationId.of('invitation-1');
const journalEntryId = JournalEntryId.of('journal-entry-1');
const locationId = LocationId.of('location-1');
const notificationId = NotificationId.of('notification-1');
const otpId = OtpId.of('otp-1');
const policyRecomputeJobId = PolicyRecomputeJobId.of('policy-recompute-job-1');
const positionId = PositionId.of('position-1');
const rewardId = RewardId.of('reward-1');
const scheduleExceptionId = ScheduleExceptionId.of('schedule-exception-1');
const seasonId = SeasonId.of('season-1');
const seriesId = SeriesId.of('series-1');
const serviceCategoryId = ServiceCategoryId.of('service-category-1');
const serviceId = ServiceId.of('service-1');
const streakDefinitionId = StreakDefinitionId.of('streak-definition-1');
const streakDefinitionVersionId = StreakDefinitionVersionId.of(
  'streak-definition-version-1',
);
const tierId = TierId.of('tier-1');
const userId = UserId.of('user-1');
const waitlistRequestId = WaitlistRequestId.of('waitlist-request-1');

expectBrand<BirthDate>(birthDate);
expectBrand<BusyKey>(busyKey);
expectBrand<CountryIso2>(countryIso2);
expectBrand<CurrencyCode>(currencyCode);
expectBrand<DayKey>(dayKey);
expectBrand<E164>(e164);
expectBrand<Email>(email);
expectBrand<Identifier>(identifier);
expectBrand<MediaRefId>(mediaRefId);
expectBrand<OtpCode>(otpCode);
expectBrand<Points>(points);
expectBrand<RedemptionCount>(redemptionCount);
expectBrand<SeatId>(seatId);
expectBrand<SeatLabel>(seatLabel);
expectBrand<ServiceVariantId>(serviceVariantId);
expectBrand<TenantId>(tenantId);
expectBrand<VoucherCode>(voucherCode);
expectBrand<AppointmentId>(appointmentId);
expectBrand<AppointmentPhotoId>(appointmentPhotoId);
expectBrand<AuditEntryId>(auditEntryId);
expectBrand<BackfillJobId>(backfillJobId);
expectBrand<BadgeCategoryId>(badgeCategoryId);
expectBrand<BarberBusyDayId>(barberBusyDayId);
expectBrand<BarberId>(barberId);
expectBrand<BarberLeadTimeSampleId>(barberLeadTimeSampleId);
expectBrand<BookingPolicySettingsId>(bookingPolicySettingsId);
expectBrand<CapacityMonthId>(capacityMonthId);
expectBrand<ClientMoneyStatsId>(clientMoneyStatsId);
expectBrand<CouponGrantId>(couponGrantId);
expectBrand<CouponId>(couponId);
expectBrand<CourseId>(courseId);
expectBrand<EventId>(eventId);
expectBrand<GiftVoucherId>(giftVoucherId);
expectBrand<ImpersonationSessionId>(impersonationSessionId);
expectBrand<InvitationId>(invitationId);
expectBrand<JournalEntryId>(journalEntryId);
expectBrand<LocationId>(locationId);
expectBrand<NotificationId>(notificationId);
expectBrand<OtpId>(otpId);
expectBrand<PolicyRecomputeJobId>(policyRecomputeJobId);
expectBrand<PositionId>(positionId);
expectBrand<RewardId>(rewardId);
expectBrand<ScheduleExceptionId>(scheduleExceptionId);
expectBrand<SeasonId>(seasonId);
expectBrand<SeriesId>(seriesId);
expectBrand<ServiceCategoryId>(serviceCategoryId);
expectBrand<ServiceId>(serviceId);
expectBrand<StreakDefinitionId>(streakDefinitionId);
expectBrand<StreakDefinitionVersionId>(streakDefinitionVersionId);
expectBrand<TierId>(tierId);
expectBrand<UserId>(userId);
expectBrand<WaitlistRequestId>(waitlistRequestId);

// (2a) A bare base value is refused for every brand.
// @ts-expect-error — a bare string is not a BirthDate.
expectBrand<BirthDate>('raw-1');
// @ts-expect-error — a bare string is not a BusyKey.
expectBrand<BusyKey>('raw-1');
// @ts-expect-error — a bare string is not a CountryIso2.
expectBrand<CountryIso2>('raw-1');
// @ts-expect-error — a bare string is not a CurrencyCode.
expectBrand<CurrencyCode>('raw-1');
// @ts-expect-error — a bare string is not a DayKey.
expectBrand<DayKey>('raw-1');
// @ts-expect-error — a bare string is not an E164.
expectBrand<E164>('raw-1');
// @ts-expect-error — a bare string is not an Email.
expectBrand<Email>('raw-1');
// @ts-expect-error — a bare string is not an Identifier.
expectBrand<Identifier>('raw-1');
// @ts-expect-error — a bare string is not a MediaRefId.
expectBrand<MediaRefId>('raw-1');
// @ts-expect-error — a bare string is not an OtpCode.
expectBrand<OtpCode>('raw-1');
// @ts-expect-error — a bare number is not a Points.
expectBrand<Points>(3);
// @ts-expect-error — a bare number is not a RedemptionCount.
expectBrand<RedemptionCount>(3);
// @ts-expect-error — a bare string is not a SeatId.
expectBrand<SeatId>('raw-1');
// @ts-expect-error — a bare string is not a SeatLabel.
expectBrand<SeatLabel>('raw-1');
// @ts-expect-error — a bare string is not a ServiceVariantId.
expectBrand<ServiceVariantId>('raw-1');
// @ts-expect-error — a bare string is not a TenantId.
expectBrand<TenantId>('raw-1');
// @ts-expect-error — a bare string is not a VoucherCode.
expectBrand<VoucherCode>('raw-1');
// @ts-expect-error — a bare string is not an AppointmentId.
expectBrand<AppointmentId>('raw-1');
// @ts-expect-error — a bare string is not an AppointmentPhotoId.
expectBrand<AppointmentPhotoId>('raw-1');
// @ts-expect-error — a bare string is not an AuditEntryId.
expectBrand<AuditEntryId>('raw-1');
// @ts-expect-error — a bare string is not a BackfillJobId.
expectBrand<BackfillJobId>('raw-1');
// @ts-expect-error — a bare string is not a BadgeCategoryId.
expectBrand<BadgeCategoryId>('raw-1');
// @ts-expect-error — a bare string is not a BarberBusyDayId.
expectBrand<BarberBusyDayId>('raw-1');
// @ts-expect-error — a bare string is not a BarberId.
expectBrand<BarberId>('raw-1');
// @ts-expect-error — a bare string is not a BarberLeadTimeSampleId.
expectBrand<BarberLeadTimeSampleId>('raw-1');
// @ts-expect-error — a bare string is not a BookingPolicySettingsId.
expectBrand<BookingPolicySettingsId>('raw-1');
// @ts-expect-error — a bare string is not a CapacityMonthId.
expectBrand<CapacityMonthId>('raw-1');
// @ts-expect-error — a bare string is not a ClientMoneyStatsId.
expectBrand<ClientMoneyStatsId>('raw-1');
// @ts-expect-error — a bare string is not a CouponGrantId.
expectBrand<CouponGrantId>('raw-1');
// @ts-expect-error — a bare string is not a CouponId.
expectBrand<CouponId>('raw-1');
// @ts-expect-error — a bare string is not a CourseId.
expectBrand<CourseId>('raw-1');
// @ts-expect-error — a bare string is not an EventId.
expectBrand<EventId>('raw-1');
// @ts-expect-error — a bare string is not a GiftVoucherId.
expectBrand<GiftVoucherId>('raw-1');
// @ts-expect-error — a bare string is not an ImpersonationSessionId.
expectBrand<ImpersonationSessionId>('raw-1');
// @ts-expect-error — a bare string is not an InvitationId.
expectBrand<InvitationId>('raw-1');
// @ts-expect-error — a bare string is not a JournalEntryId.
expectBrand<JournalEntryId>('raw-1');
// @ts-expect-error — a bare string is not a LocationId.
expectBrand<LocationId>('raw-1');
// @ts-expect-error — a bare string is not a NotificationId.
expectBrand<NotificationId>('raw-1');
// @ts-expect-error — a bare string is not an OtpId.
expectBrand<OtpId>('raw-1');
// @ts-expect-error — a bare string is not a PolicyRecomputeJobId.
expectBrand<PolicyRecomputeJobId>('raw-1');
// @ts-expect-error — a bare string is not a PositionId.
expectBrand<PositionId>('raw-1');
// @ts-expect-error — a bare string is not a RewardId.
expectBrand<RewardId>('raw-1');
// @ts-expect-error — a bare string is not a ScheduleExceptionId.
expectBrand<ScheduleExceptionId>('raw-1');
// @ts-expect-error — a bare string is not a SeasonId.
expectBrand<SeasonId>('raw-1');
// @ts-expect-error — a bare string is not a SeriesId.
expectBrand<SeriesId>('raw-1');
// @ts-expect-error — a bare string is not a ServiceCategoryId.
expectBrand<ServiceCategoryId>('raw-1');
// @ts-expect-error — a bare string is not a ServiceId.
expectBrand<ServiceId>('raw-1');
// @ts-expect-error — a bare string is not a StreakDefinitionId.
expectBrand<StreakDefinitionId>('raw-1');
// @ts-expect-error — a bare string is not a StreakDefinitionVersionId.
expectBrand<StreakDefinitionVersionId>('raw-1');
// @ts-expect-error — a bare string is not a TierId.
expectBrand<TierId>('raw-1');
// @ts-expect-error — a bare string is not an UserId.
expectBrand<UserId>('raw-1');
// @ts-expect-error — a bare string is not a WaitlistRequestId.
expectBrand<WaitlistRequestId>('raw-1');

// (2b) The ring: each brand is refused as the next one, the last as the first.
// @ts-expect-error — a BirthDate is not a BusyKey.
expectBrand<BusyKey>(birthDate);
// @ts-expect-error — a BusyKey is not a CountryIso2.
expectBrand<CountryIso2>(busyKey);
// @ts-expect-error — a CountryIso2 is not a CurrencyCode.
expectBrand<CurrencyCode>(countryIso2);
// @ts-expect-error — a CurrencyCode is not a DayKey.
expectBrand<DayKey>(currencyCode);
// @ts-expect-error — a DayKey is not an E164.
expectBrand<E164>(dayKey);
// @ts-expect-error — an E164 is not an Email.
expectBrand<Email>(e164);
// @ts-expect-error — an Email is not an Identifier.
expectBrand<Identifier>(email);
// @ts-expect-error — an Identifier is not a MediaRefId.
expectBrand<MediaRefId>(identifier);
// @ts-expect-error — a MediaRefId is not an OtpCode.
expectBrand<OtpCode>(mediaRefId);
// @ts-expect-error — an OtpCode is not a Points.
expectBrand<Points>(otpCode);
// @ts-expect-error — a Points is not a RedemptionCount.
expectBrand<RedemptionCount>(points);
// @ts-expect-error — a RedemptionCount is not a SeatId.
expectBrand<SeatId>(redemptionCount);
// @ts-expect-error — a SeatId is not a SeatLabel.
expectBrand<SeatLabel>(seatId);
// @ts-expect-error — a SeatLabel is not a ServiceVariantId.
expectBrand<ServiceVariantId>(seatLabel);
// @ts-expect-error — a ServiceVariantId is not a TenantId.
expectBrand<TenantId>(serviceVariantId);
// @ts-expect-error — a TenantId is not a VoucherCode.
expectBrand<VoucherCode>(tenantId);
// @ts-expect-error — a VoucherCode is not an AppointmentId.
expectBrand<AppointmentId>(voucherCode);
// @ts-expect-error — an AppointmentId is not an AppointmentPhotoId.
expectBrand<AppointmentPhotoId>(appointmentId);
// @ts-expect-error — an AppointmentPhotoId is not an AuditEntryId.
expectBrand<AuditEntryId>(appointmentPhotoId);
// @ts-expect-error — an AuditEntryId is not a BackfillJobId.
expectBrand<BackfillJobId>(auditEntryId);
// @ts-expect-error — a BackfillJobId is not a BadgeCategoryId.
expectBrand<BadgeCategoryId>(backfillJobId);
// @ts-expect-error — a BadgeCategoryId is not a BarberBusyDayId.
expectBrand<BarberBusyDayId>(badgeCategoryId);
// @ts-expect-error — a BarberBusyDayId is not a BarberId.
expectBrand<BarberId>(barberBusyDayId);
// @ts-expect-error — a BarberId is not a BarberLeadTimeSampleId.
expectBrand<BarberLeadTimeSampleId>(barberId);
// @ts-expect-error — a BarberLeadTimeSampleId is not a BookingPolicySettingsId.
expectBrand<BookingPolicySettingsId>(barberLeadTimeSampleId);
// @ts-expect-error — a BookingPolicySettingsId is not a CapacityMonthId.
expectBrand<CapacityMonthId>(bookingPolicySettingsId);
// @ts-expect-error — a CapacityMonthId is not a ClientMoneyStatsId.
expectBrand<ClientMoneyStatsId>(capacityMonthId);
// @ts-expect-error — a ClientMoneyStatsId is not a CouponGrantId.
expectBrand<CouponGrantId>(clientMoneyStatsId);
// @ts-expect-error — a CouponGrantId is not a CouponId.
expectBrand<CouponId>(couponGrantId);
// @ts-expect-error — a CouponId is not a CourseId.
expectBrand<CourseId>(couponId);
// @ts-expect-error — a CourseId is not an EventId.
expectBrand<EventId>(courseId);
// @ts-expect-error — an EventId is not a GiftVoucherId.
expectBrand<GiftVoucherId>(eventId);
// @ts-expect-error — a GiftVoucherId is not an ImpersonationSessionId.
expectBrand<ImpersonationSessionId>(giftVoucherId);
// @ts-expect-error — an ImpersonationSessionId is not an InvitationId.
expectBrand<InvitationId>(impersonationSessionId);
// @ts-expect-error — an InvitationId is not a JournalEntryId.
expectBrand<JournalEntryId>(invitationId);
// @ts-expect-error — a JournalEntryId is not a LocationId.
expectBrand<LocationId>(journalEntryId);
// @ts-expect-error — a LocationId is not a NotificationId.
expectBrand<NotificationId>(locationId);
// @ts-expect-error — a NotificationId is not an OtpId.
expectBrand<OtpId>(notificationId);
// @ts-expect-error — an OtpId is not a PolicyRecomputeJobId.
expectBrand<PolicyRecomputeJobId>(otpId);
// @ts-expect-error — a PolicyRecomputeJobId is not a PositionId.
expectBrand<PositionId>(policyRecomputeJobId);
// @ts-expect-error — a PositionId is not a RewardId.
expectBrand<RewardId>(positionId);
// @ts-expect-error — a RewardId is not a ScheduleExceptionId.
expectBrand<ScheduleExceptionId>(rewardId);
// @ts-expect-error — a ScheduleExceptionId is not a SeasonId.
expectBrand<SeasonId>(scheduleExceptionId);
// @ts-expect-error — a SeasonId is not a SeriesId.
expectBrand<SeriesId>(seasonId);
// @ts-expect-error — a SeriesId is not a ServiceCategoryId.
expectBrand<ServiceCategoryId>(seriesId);
// @ts-expect-error — a ServiceCategoryId is not a ServiceId.
expectBrand<ServiceId>(serviceCategoryId);
// @ts-expect-error — a ServiceId is not a StreakDefinitionId.
expectBrand<StreakDefinitionId>(serviceId);
// @ts-expect-error — a StreakDefinitionId is not a StreakDefinitionVersionId.
expectBrand<StreakDefinitionVersionId>(streakDefinitionId);
// @ts-expect-error — a StreakDefinitionVersionId is not a TierId.
expectBrand<TierId>(streakDefinitionVersionId);
// @ts-expect-error — a TierId is not an UserId.
expectBrand<UserId>(tierId);
// @ts-expect-error — an UserId is not a WaitlistRequestId.
expectBrand<WaitlistRequestId>(userId);
// @ts-expect-error — a WaitlistRequestId is not a BirthDate.
expectBrand<BirthDate>(waitlistRequestId);

// (3) A brand reads as its base type wherever one is expected.
expectBrand<string>(birthDate);
expectBrand<string>(busyKey);
expectBrand<string>(countryIso2);
expectBrand<string>(currencyCode);
expectBrand<string>(dayKey);
expectBrand<string>(e164);
expectBrand<string>(email);
expectBrand<string>(identifier);
expectBrand<string>(mediaRefId);
expectBrand<string>(otpCode);
expectBrand<number>(points);
expectBrand<number>(redemptionCount);
expectBrand<string>(seatId);
expectBrand<string>(seatLabel);
expectBrand<string>(serviceVariantId);
expectBrand<string>(tenantId);
expectBrand<string>(voucherCode);
expectBrand<string>(appointmentId);
expectBrand<string>(appointmentPhotoId);
expectBrand<string>(auditEntryId);
expectBrand<string>(backfillJobId);
expectBrand<string>(badgeCategoryId);
expectBrand<string>(barberBusyDayId);
expectBrand<string>(barberId);
expectBrand<string>(barberLeadTimeSampleId);
expectBrand<string>(bookingPolicySettingsId);
expectBrand<string>(capacityMonthId);
expectBrand<string>(clientMoneyStatsId);
expectBrand<string>(couponGrantId);
expectBrand<string>(couponId);
expectBrand<string>(courseId);
expectBrand<string>(eventId);
expectBrand<string>(giftVoucherId);
expectBrand<string>(impersonationSessionId);
expectBrand<string>(invitationId);
expectBrand<string>(journalEntryId);
expectBrand<string>(locationId);
expectBrand<string>(notificationId);
expectBrand<string>(otpId);
expectBrand<string>(policyRecomputeJobId);
expectBrand<string>(positionId);
expectBrand<string>(rewardId);
expectBrand<string>(scheduleExceptionId);
expectBrand<string>(seasonId);
expectBrand<string>(seriesId);
expectBrand<string>(serviceCategoryId);
expectBrand<string>(serviceId);
expectBrand<string>(streakDefinitionId);
expectBrand<string>(streakDefinitionVersionId);
expectBrand<string>(tierId);
expectBrand<string>(userId);
expectBrand<string>(waitlistRequestId);
