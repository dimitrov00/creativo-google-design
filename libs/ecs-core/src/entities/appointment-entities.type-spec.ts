/**
 * Compile-only proofs over the appointment group's archetypes (Laws 2 and 6,
 * flatten-spec §7 notes): each entity is the intersection of FLAT slices that
 * share no field name, the intersection is never `never`, every variant is
 * flat (`NoNested`), and each domain discriminator narrows to exactly its
 * variant's fields. `tsc` failing — on a `false` constant or an unused
 * `@ts-expect-error` — IS the test; nothing here runs.
 */
import type { AppliedDiscount } from '../components/applied-discount.data';
import type { AppointmentTime } from '../components/appointment-time.data';
import type { BookingContact } from '../components/booking-contact.data';
import {
  type BookingLifecycle,
  BookingStatus,
} from '../components/booking-lifecycle.data';
import type { CouponExpiryRule } from '../components/coupon-expiry.data';
import { CouponExpiry } from '../components/coupon-expiry.data';
import {
  type CouponValue,
  DiscountMethod,
} from '../components/coupon-value.data';
import {
  type DiscountProvenance,
  DiscountSource,
} from '../components/discount-provenance.data';
import {
  GrantCapacity,
  type GrantLifecycle,
  GrantStatus,
} from '../components/grant-status.data';
import type { StoodSeatPairs } from '../components/seat-id-pair.data';
import { AttendanceState } from '../components/seat-outcome.data';
import { type Seat, SeatSubject } from '../components/seat.data';
import type { VoucherRedemption } from '../components/voucher-redemption.data';
import {
  type VoucherLifecycle,
  VoucherStatus,
} from '../components/voucher-state.data';
import type { AllTrue, Disjoint, NoNested } from '../testing';
import type { AppointmentNote } from './appointment-note.entity';
import type { AppointmentPhoto } from './appointment-photo.entity';
import type {
  Appointment,
  AppointmentMeta,
  AppointmentStamps,
} from './appointment.entity';
import type { CouponGrant, CouponGrantMeta } from './coupon-grant.entity';
import type { Coupon, CouponMeta } from './coupon.entity';
import type { GiftVoucher, GiftVoucherMeta } from './gift-voucher.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── Appointment = Meta & Time & Lifecycle & Contact & Stamps & StoodPairs ── */

export const appointmentNotNever: IsNever<Appointment> = false;
export const appointmentFlat: EveryVariantFlat<Appointment> = true;
export const appointmentDisjoint: [
  Disjoint<AppointmentMeta, AppointmentTime>,
  Disjoint<AppointmentMeta, BookingLifecycle>,
  Disjoint<AppointmentMeta, BookingContact>,
  Disjoint<AppointmentMeta, AppointmentStamps>,
  Disjoint<AppointmentMeta, StoodSeatPairs>,
  Disjoint<AppointmentTime, BookingLifecycle>,
  Disjoint<AppointmentTime, BookingContact>,
  Disjoint<AppointmentTime, AppointmentStamps>,
  Disjoint<AppointmentTime, StoodSeatPairs>,
  Disjoint<BookingLifecycle, BookingContact>,
  Disjoint<BookingLifecycle, AppointmentStamps>,
  Disjoint<BookingLifecycle, StoodSeatPairs>,
  Disjoint<BookingContact, AppointmentStamps>,
  Disjoint<BookingContact, StoodSeatPairs>,
  Disjoint<AppointmentStamps, StoodSeatPairs>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

declare const apt: Appointment;
if (apt.bookingStatus === BookingStatus.Cancelled) {
  void apt.cancellationReason;
  void apt.cancelledAtUtcMs;
}
if (apt.bookingStatus === BookingStatus.Confirmed) {
  void apt.confirmedAtUtcMs;
  // @ts-expect-error — a confirmed booking has no cancellationReason
  void apt.cancellationReason;
}
if (apt.bookingStatus === BookingStatus.NoShow) {
  // @ts-expect-error — a no-show has no completedAtUtcMs
  void apt.completedAtUtcMs;
}
// @ts-expect-error — no time-zone field on a temporal entity (Law 7.2)
void apt.zone;
// @ts-expect-error — the nested lifecycle object is gone (Law 6)
void apt.bookingStatus.kind;

/* ── Seat = Core & Terms & CatalogTerms & Occupant & Outcome (array element) ── */

export const seatNotNever: IsNever<Seat> = false;
export const seatFlat: EveryVariantFlat<Seat> = true;
declare const seat: Seat;
if (seat.seatSubject === SeatSubject.Account) void seat.subjectUserId;
if (seat.seatSubject === SeatSubject.Anonymous) {
  void seat.guestLabel;
  // @ts-expect-error — a guest has no account
  void seat.subjectUserId;
}
if (seat.attendanceState === AttendanceState.Cancelled) {
  void seat.cancellationReason;
  void seat.cancellationWindowHours;
}
if (seat.attendanceState === AttendanceState.Worked) {
  // @ts-expect-error — a worked seat was not cancelled
  void seat.cancelledBy;
}

export const discountFlat: EveryVariantFlat<AppliedDiscount> = true;
declare const discount: AppliedDiscount;
if (discount.discountMethod === DiscountMethod.FixedAmount) {
  void discount.discountAmountCents;
  void discount.discountCurrency;
}
export const discountNotNever: IsNever<AppliedDiscount> = false;
export const provenanceValueDisjoint: Disjoint<
  DiscountProvenance,
  CouponValue
> = true;
if (discount.discountSource === DiscountSource.Grant) {
  void discount.discountGrantId;
  // @ts-expect-error — a grant was not opened with a code
  void discount.discountCode;
}
if (discount.discountSource === DiscountSource.Code) {
  void discount.discountCode;
  // @ts-expect-error — a code honours no grant
  void discount.discountGrantId;
}
if (discount.discountSource === DiscountSource.Manual) {
  // @ts-expect-error — a manual figure honours no grant
  void discount.discountGrantId;
  // @ts-expect-error — a manual figure was opened with no code
  void discount.discountCode;
}
export const redemptionFlat: EveryVariantFlat<VoucherRedemption> = true;

/* ── Coupon = Meta & Value & ExpiryRule ─────────────────────────────────── */

export const couponNotNever: IsNever<Coupon> = false;
export const couponFlat: EveryVariantFlat<Coupon> = true;
export const couponDisjoint: [
  Disjoint<CouponMeta, CouponValue>,
  Disjoint<CouponMeta, CouponExpiryRule>,
  Disjoint<CouponValue, CouponExpiryRule>,
] = [true, true, true];
declare const coupon: Coupon;
if (coupon.couponExpiry === CouponExpiry.Days) void coupon.expiryDays;
if (coupon.couponExpiry === CouponExpiry.Never) {
  // @ts-expect-error — a never-expiring coupon has no fixed instant
  void coupon.expiresAtUtcMs;
}
if (coupon.discountMethod === DiscountMethod.PercentOff) {
  void coupon.discountPercent;
  // @ts-expect-error — a percentage carries no amount
  void coupon.discountAmountCents;
}

/* ── CouponGrant = Meta & Value & Lifecycle ─────────────────────────────── */

export const grantNotNever: IsNever<CouponGrant> = false;
export const grantFlat: EveryVariantFlat<CouponGrant> = true;
export const grantDisjoint: [
  Disjoint<CouponGrantMeta, CouponValue>,
  Disjoint<CouponGrantMeta, GrantLifecycle>,
  Disjoint<CouponValue, GrantLifecycle>,
] = [true, true, true];
declare const grant: CouponGrant;
if (grant.grantStatus === GrantStatus.Active) {
  if (grant.grantCapacity === GrantCapacity.MultiUse) void grant.usesRemaining;
}
if (grant.grantStatus === GrantStatus.Revoked) void grant.revokedByUserId;
if (grant.grantStatus === GrantStatus.Used) {
  // @ts-expect-error — a used grant holds no capacity
  void grant.grantCapacity;
}

/* ── GiftVoucher = Meta & Lifecycle ─────────────────────────────────────── */

export const voucherNotNever: IsNever<GiftVoucher> = false;
export const voucherFlat: EveryVariantFlat<GiftVoucher> = true;
export const voucherDisjoint: Disjoint<GiftVoucherMeta, VoucherLifecycle> =
  true;
declare const voucher: GiftVoucher;
if (voucher.voucherStatus === VoucherStatus.Void) void voucher.voidReason;
if (voucher.voucherStatus === VoucherStatus.Active) {
  // @ts-expect-error — an active voucher was not voided
  void voucher.voidedAtUtcMs;
}

/* ── The two plain archetypes ───────────────────────────────────────────── */

export const noteFlat: EveryVariantFlat<AppointmentNote> = true;
export const photoFlat: EveryVariantFlat<AppointmentPhoto> = true;
