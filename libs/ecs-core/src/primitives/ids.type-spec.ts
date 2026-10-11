/**
 * Compile-time-only proof that every flatten-pass primitive is nominal (Law
 * 7.4, flatten-spec §1) — no runtime `expect()`/`it()`; the spec tsconfig
 * compiles it. The successor of the pre-flatten
 * `entities/{ids,catalog-ids,scheduling-ids,identity-ids}.type-spec.ts`
 * (flatten-spec §8.1): every brand of the core — the primitives, the whole
 * id family and the component brands (`BirthDate`, `E164`, `VoucherCode`, …)
 * — is in {@link Brands}.
 *
 * 1. **All pairs** — no brand of {@link Brands} is assignable to another
 *    (every id, the coordinate, money, zone and geo brands — each ordered
 *    pair), and the checks are probed so they are not vacuous.
 * 2. **No bare value** — no raw `string`/`number` stands in for any brand,
 *    and every brand still reads as its base type.
 * 3. **D29** — a `CustomerId` and a `UserId` never cross, in either direction.
 * 4. **The way in** — each companion's `of` makes its brand.
 */
import {
  type TenantId,
  type LocationId,
  type BarberId,
  type ServiceId,
  type ServiceCategoryId,
  type ServiceVariantId,
  type AppointmentId,
  type SeatId,
  type AppointmentPhotoId,
  type BarberBusyDayId,
  type BarberLeadTimeSampleId,
  type BookingPolicySettingsId,
  type CapacityMonthId,
  type ScheduleExceptionId,
  type WaitlistRequestId,
  type CartLineId,
  type GuestId,
  type AppliedDiscountId,
  type OperationId,
  type UserId,
  type CustomerId,
  type OtpId,
  type ImpersonationSessionId,
  type InvitationId,
  type NotificationId,
  type MediaRefId,
  type AuditEntryId,
  type BackfillJobId,
  type PolicyRecomputeJobId,
  type ClientMoneyStatsId,
  type PublishRequestId,
  type CorrelationId,
  type CouponId,
  type CouponGrantId,
  type GiftVoucherId,
  type CourseId,
  type EventId,
  type PositionId,
  type BadgeCategoryId,
  type BadgeSeriesId,
  type SeasonId,
  type TierId,
  type RewardId,
  type StreakDefinitionId,
  type StreakDefinitionVersionId,
  type JournalEntryId,
  type RedemptionId,
  type PauseId,
  type AdjustmentId,
  type AchievementRuleId,
  type JournalEventId,
  type MigrationBatchId,
  type TriggerEventId,
  type AuditResourceId,
  type SeatKeyText,
  AppointmentId as AppointmentIdOf,
  BadgeSeriesId as BadgeSeriesIdOf,
  BarberId as BarberIdOf,
  CustomerId as CustomerIdOf,
  LocationId as LocationIdOf,
  ServiceId as ServiceIdOf,
  TenantId as TenantIdOf,
  UserId as UserIdOf,
} from './ids.primitive';
import type { BusyKey } from './busy-key.primitive';
import type { Currency } from './currency.primitive';
import type { LocalDate } from './local-date.primitive';
import type { MinuteOfDay, EndMinute } from './minute-of-day.primitive';
import type {
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
} from './duration-minutes.primitive';
import type { UtcEpochMs } from './utc-epoch-ms.primitive';
import type { PriceCents } from './price-cents.primitive';
import type { TimeZone } from './time-zone.primitive';
import type { Latitude, Longitude } from './geo.primitive';
import type { EpochSeconds, SubsecondNanos } from './precise-instant.primitive';
import {
  BirthDate,
  CountryIso2,
  Email,
  Identifier,
  OtpCode,
  E164,
  Points,
  RedemptionCount,
  SeatLabel,
  VoucherCode,
} from '@core/components';

/** Every flatten-pass brand, by name. */
type Brands = {
  readonly TenantId: TenantId;
  readonly LocationId: LocationId;
  readonly BarberId: BarberId;
  readonly ServiceId: ServiceId;
  readonly ServiceCategoryId: ServiceCategoryId;
  readonly ServiceVariantId: ServiceVariantId;
  readonly AppointmentId: AppointmentId;
  readonly SeatId: SeatId;
  readonly AppointmentPhotoId: AppointmentPhotoId;
  readonly BarberBusyDayId: BarberBusyDayId;
  readonly BarberLeadTimeSampleId: BarberLeadTimeSampleId;
  readonly BookingPolicySettingsId: BookingPolicySettingsId;
  readonly CapacityMonthId: CapacityMonthId;
  readonly ScheduleExceptionId: ScheduleExceptionId;
  readonly WaitlistRequestId: WaitlistRequestId;
  readonly CartLineId: CartLineId;
  readonly GuestId: GuestId;
  readonly AppliedDiscountId: AppliedDiscountId;
  readonly OperationId: OperationId;
  readonly UserId: UserId;
  readonly CustomerId: CustomerId;
  readonly OtpId: OtpId;
  readonly ImpersonationSessionId: ImpersonationSessionId;
  readonly InvitationId: InvitationId;
  readonly NotificationId: NotificationId;
  readonly MediaRefId: MediaRefId;
  readonly AuditEntryId: AuditEntryId;
  readonly BackfillJobId: BackfillJobId;
  readonly PolicyRecomputeJobId: PolicyRecomputeJobId;
  readonly ClientMoneyStatsId: ClientMoneyStatsId;
  readonly PublishRequestId: PublishRequestId;
  readonly CorrelationId: CorrelationId;
  readonly CouponId: CouponId;
  readonly CouponGrantId: CouponGrantId;
  readonly GiftVoucherId: GiftVoucherId;
  readonly CourseId: CourseId;
  readonly EventId: EventId;
  readonly PositionId: PositionId;
  readonly BadgeCategoryId: BadgeCategoryId;
  readonly BadgeSeriesId: BadgeSeriesId;
  readonly SeasonId: SeasonId;
  readonly TierId: TierId;
  readonly RewardId: RewardId;
  readonly StreakDefinitionId: StreakDefinitionId;
  readonly StreakDefinitionVersionId: StreakDefinitionVersionId;
  readonly JournalEntryId: JournalEntryId;
  readonly RedemptionId: RedemptionId;
  readonly PauseId: PauseId;
  readonly AdjustmentId: AdjustmentId;
  readonly AchievementRuleId: AchievementRuleId;
  readonly JournalEventId: JournalEventId;
  readonly MigrationBatchId: MigrationBatchId;
  readonly TriggerEventId: TriggerEventId;
  readonly AuditResourceId: AuditResourceId;
  readonly SeatKeyText: SeatKeyText;
  readonly BusyKey: BusyKey;
  readonly Currency: Currency;
  readonly LocalDate: LocalDate;
  readonly MinuteOfDay: MinuteOfDay;
  readonly EndMinute: EndMinute;
  readonly DurationMinutes: DurationMinutes;
  readonly MinuteCount: MinuteCount;
  readonly MinuteDelta: MinuteDelta;
  readonly UtcEpochMs: UtcEpochMs;
  readonly PriceCents: PriceCents;
  readonly TimeZone: TimeZone;
  readonly Latitude: Latitude;
  readonly Longitude: Longitude;
  readonly EpochSeconds: EpochSeconds;
  readonly SubsecondNanos: SubsecondNanos;
  readonly BirthDate: BirthDate;
  readonly CountryIso2: CountryIso2;
  readonly E164: E164;
  readonly Email: Email;
  readonly Identifier: Identifier;
  readonly OtpCode: OtpCode;
  readonly Points: Points;
  readonly RedemptionCount: RedemptionCount;
  readonly SeatLabel: SeatLabel;
  readonly VoucherCode: VoucherCode;
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

// (1) No brand crosses another over every ordered pair …
export type NoBrandCrossesAnother = Expect<IsNever<CrossingPairs<Brands>>>;
// (2) … no bare string/number stands in for any brand …
export type NoBrandIsOpen = Expect<IsNever<OpenBrands<Brands>>>;
// … and every brand still reads as its base type.
export type EveryBrandReadsAsItsBase = Expect<IsNever<OpaqueBrands<Brands>>>;

// (3) D29: the record and the account never cross.
export type CustomerIsNotUser = Expect<
  IsNever<CrossingPairs<{ customer: CustomerId; user: UserId }>>
>;

// The checks are not vacuous.
export type ProbeCrossing = Expect<
  // @ts-expect-error — a UserId is assignable to a plain string, so this pair crosses.
  IsNever<CrossingPairs<{ a: UserId; b: string }>>
>;
export type ProbeOpen = Expect<
  // @ts-expect-error — a plain string is open, so the open-brand check fires.
  IsNever<OpenBrands<{ a: string }>>
>;

declare const customer: CustomerId;
declare const user: UserId;
declare const minute: MinuteOfDay;
declare const end: EndMinute;
// @ts-expect-error — a CustomerId is never a UserId (D29).
export const crossedUser: UserId = customer;
// @ts-expect-error — a UserId is never a CustomerId (D29).
export const crossedCustomer: CustomerId = user;
// @ts-expect-error — a bare literal is never a LocalDate.
export const rawDay: LocalDate = '2026-10-07';
// @ts-expect-error — an exclusive end is not a point (F-1).
export const endAsStart: MinuteOfDay = end;
// A brand reads as its base type.
export const asNumber: number = minute;

// (4) The way in: each companion's `of` makes its brand.
/** Accepts exactly a `B`; the explicit type argument is the assertion. */
declare function expectBrand<B>(value: B): void;
expectBrand<AppointmentId>(AppointmentIdOf.of('appointment-1'));
expectBrand<BadgeSeriesId>(BadgeSeriesIdOf.of('series-1'));
expectBrand<BarberId>(BarberIdOf.of('b-ivan'));
expectBrand<LocationId>(LocationIdOf.of('loc-center'));
expectBrand<ServiceId>(ServiceIdOf.of('svc-classic-cut'));
expectBrand<TenantId>(TenantIdOf.of('creativo'));
expectBrand<UserId>(UserIdOf.of('u-client'));
expectBrand<CustomerId>(
  CustomerIdOf.forUser(UserIdOf.of('u-client'), (s) => s),
);
expectBrand<BirthDate>(BirthDate.of('1990-04-01'));
expectBrand<CountryIso2>(CountryIso2.of('BG'));
expectBrand<E164>(E164.of('+359888123456'));
expectBrand<Email>(Email.of('maria@example.com'));
expectBrand<Identifier>(Identifier.of('+359888123456'));
expectBrand<OtpCode>(OtpCode.of('123456'));
expectBrand<Points>(Points.of(3));
expectBrand<RedemptionCount>(RedemptionCount.of(3));
expectBrand<SeatLabel>(SeatLabel.of('seat-label-1'));
expectBrand<VoucherCode>(VoucherCode.of('WELCOME10'));
// @ts-expect-error — a SeatLabel is not a VoucherCode, though both are strings.
expectBrand<VoucherCode>(SeatLabel.of('seat-label-1'));
