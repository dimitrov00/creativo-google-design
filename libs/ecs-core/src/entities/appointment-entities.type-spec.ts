/**
 * Compile-only proofs over the appointment group's archetypes (Laws 2 and 6,
 * flatten-spec §7 notes): each entity is the intersection of FLAT slices that
 * share no field name, the intersection is never `never`, every variant is
 * flat (`NoNested`), and each domain discriminator narrows to exactly its
 * variant's fields. `tsc` failing — on a `false` constant or an unused
 * `@ts-expect-error` — IS the test; nothing here runs.
 */
import {
  type AppliedDiscount,
  type TimeCoordinate,
  type BookingContact,
  type BookingLifecycle,
  type CouponExpiryRule,
  CouponExpiry,
  type CouponValue,
  DiscountMethod,
  type DiscountProvenance,
  DiscountSource,
  GrantCapacity,
  type GrantLifecycle,
  type StoodSeatPairs,
  type AccountSeat,
  type Seat,
  SeatSubject,
  type VoucherRedemption,
  type VoucherLifecycle,
  VoucherStatus,
} from '@core/components';
import { BookingStatus, GrantStatus, AttendanceState } from '@core/primitives';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { AppointmentNote } from './appointment-note.entity';
import type { AppointmentPhoto } from './appointment-photo.entity';
import type {
  AccountAppointment,
  Appointment,
  AppointmentClientRefs,
  AppointmentMeta,
  AppointmentStamps,
} from './appointment.entity';
import type { CouponGrant, CouponGrantMeta } from './coupon-grant.entity';
import type { Coupon, CouponMeta } from './coupon.entity';
import type { GiftVoucher, GiftVoucherMeta } from './gift-voucher.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── Appointment = Meta & ClientRefs & Time & Lifecycle & Contact & Stamps & StoodPairs ── */

export const appointmentNotNever: IsNever<Appointment> = false;
export const appointmentFlat: EveryVariantFlat<Appointment> = true;
export const clientRefsDisjoint: [
  Disjoint<AppointmentClientRefs, AppointmentMeta>,
  Disjoint<AppointmentClientRefs, TimeCoordinate>,
  Disjoint<AppointmentClientRefs, BookingLifecycle>,
  Disjoint<AppointmentClientRefs, BookingContact>,
  Disjoint<AppointmentClientRefs, AppointmentStamps>,
  Disjoint<AppointmentClientRefs, StoodSeatPairs>,
] = [true, true, true, true, true, true];
export const appointmentDisjoint: [
  Disjoint<AppointmentMeta, TimeCoordinate>,
  Disjoint<AppointmentMeta, BookingLifecycle>,
  Disjoint<AppointmentMeta, BookingContact>,
  Disjoint<AppointmentMeta, AppointmentStamps>,
  Disjoint<AppointmentMeta, StoodSeatPairs>,
  Disjoint<TimeCoordinate, BookingLifecycle>,
  Disjoint<TimeCoordinate, BookingContact>,
  Disjoint<TimeCoordinate, AppointmentStamps>,
  Disjoint<TimeCoordinate, StoodSeatPairs>,
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
// D29 (F1-4): the client records sit BESIDE the account keys, never instead.
void apt.ownerUserId;
void apt.ownerCustomerId;
void apt.subjectUserIds;
void apt.subjectCustomerIds;
// @ts-expect-error — no time-zone field on a temporal entity (Law 7.2)
void apt.zone;
// @ts-expect-error — the nested lifecycle object is gone (Law 6)
void apt.bookingStatus.kind;

/* ── AccountAppointment — the account-rules view (D29) ─────────────────── */

export const accountAppointmentNotNever: IsNever<AccountAppointment> = false;
export const accountAppointmentFlat: EveryVariantFlat<AccountAppointment> = true;
/** A whole appointment IS an account-rules view: `true` when it is assignable. */
export const appointmentIsAccountView: Appointment extends AccountAppointment
  ? true
  : false = true;
declare const view: AccountAppointment;
if (view.bookingStatus === BookingStatus.Cancelled)
  void view.cancellationReason;
// @ts-expect-error — the view carries no client-record mirror
void view.subjectCustomerIds;
for (const viewSeat of view.seats) {
  if (viewSeat.seatSubject === SeatSubject.Account) {
    void viewSeat.subjectUserId;
    // @ts-expect-error — an account-rules seat carries no client record
    void viewSeat.subjectCustomerId;
  }
}

/* ── Seat = Core & Terms & CatalogTerms & Occupant & Outcome (array element) ── */

export const seatNotNever: IsNever<Seat> = false;
export const seatFlat: EveryVariantFlat<Seat> = true;
export const accountSeatNotNever: IsNever<AccountSeat> = false;
export const seatIsAccountSeat: Seat extends AccountSeat ? true : false = true;
declare const seat: Seat;
if (seat.seatSubject === SeatSubject.Account) {
  void seat.subjectUserId;
  void seat.subjectCustomerId;
}
if (seat.seatSubject === SeatSubject.Anonymous) {
  void seat.guestLabel;
  // @ts-expect-error — a guest has no account
  void seat.subjectUserId;
  // @ts-expect-error — nor a client record
  void seat.subjectCustomerId;
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
// D29: the record the grant rewards, and the account that may read it.
void grant.customerId;
void grant.holderUserId;
// @ts-expect-error — the uid key is renamed `holderUserId` (D29, flip 1)
void grant.userId;
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
void voucher.issuedToCustomerId;
void voucher.holderUserId;
// @ts-expect-error — the uid key is renamed `holderUserId` (D29, flip 1)
void voucher.issuedToUserId;
if (voucher.voucherStatus === VoucherStatus.Active) {
  // @ts-expect-error — an active voucher was not voided
  void voucher.voidedAtUtcMs;
}

/* ── The two plain archetypes ───────────────────────────────────────────── */

export const noteFlat: EveryVariantFlat<AppointmentNote> = true;
export const photoFlat: EveryVariantFlat<AppointmentPhoto> = true;
declare const photo: AppointmentPhoto;
void photo.clientCustomerId;
void photo.takenByUserId;
// @ts-expect-error — the photo's client is a record, not an account (D29)
void photo.clientUserId;
