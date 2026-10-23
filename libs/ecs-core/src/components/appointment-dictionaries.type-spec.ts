/**
 * Compile-time-only checks of the appointment group's `as const` tag
 * dictionaries (flatten-spec §7 L8, §8.1: this group's split of
 * `dictionaries.type-spec.ts`) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, no two keys
 *    sharing one value.
 * 3. **SCREAMING** — every value is its own upper-case (§0.4; the wire
 *    refinement `CarriedSeatRefusal` is exempt, §4.1).
 * 4. **Field pairs (L8, N15)** — each discriminator and plain tag field is
 *    `camelCase(Dictionary)`; `tools/lint-rules/dictionary-fields.spec.mjs`
 *    reads the pair lines below.
 */
import type { AppliedDiscount } from './applied-discount.data';
import {
  BookingStatus,
  GrantStatus,
  AttendanceState,
  VoucherRefusal,
} from '@core/primitives';
import type { BookingLifecycle } from './booking-lifecycle.data';
import { Combinability } from './coupon-combinability.data';
import { CouponExpiry, type CouponExpiryRule } from './coupon-expiry.data';
import { CouponOccasion, CouponStatus } from './coupon-occasion.data';
import { DiscountSource } from './discount-provenance.data';
import { DiscountMethod, type CouponValue } from './coupon-value.data';
import {
  GrantCapacity,
  type GrantCapacityTerms,
  GrantExpiry,
  type GrantExpiryTerms,
  type GrantLifecycle,
} from './grant-lifecycle.data';
import { PhotoOrigin } from './photo-origin.data';
import {
  CancellationReason,
  CancelledBy,
  type SeatOutcome,
} from './seat-outcome.data';
import {
  type SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from './seat.data';
import { type VoucherLifecycle, VoucherStatus } from './voucher-state.data';
import type {
  Appointment,
  AppointmentPhoto,
  Coupon,
  CouponMeta,
  CouponGrant,
  GiftVoucher,
} from '@core/entities';
import {
  type EditCommandRequest,
  LedgerVerdict,
  type LedgerVerdictResult,
  ProfileAuthType,
  BillPending,
  type PendingDiscounts,
  TipPreset,
  type TipPresetOption,
} from '@core/systems';
import {
  CancellationRefusalCode,
  CarriedSeatRefusal,
  MoveErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import { EditCommand, ResizeEdge } from './edit-command.data';

/** A tag dictionary whose every value is a `T`. */
type Dictionary<T> = { readonly [key: string]: T };
type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
/** The keys of `D` whose value another key also has. */
type SharedValueKeys<D> = {
  [K in keyof D]: D[K] extends D[Exclude<keyof D, K>] ? K : never;
}[keyof D];
/** `D`'s values are exactly `T`, each value under one key only. */
type Holds<D, T> =
  Equals<D[keyof D], T> extends true ? IsNever<SharedValueKeys<D>> : false;
/** Every value of `T` is its own upper-case — SCREAMING_SNAKE (§0.4). */
type Screaming<T extends string> = [T] extends [Uppercase<T>] ? true : false;
/** A struct whose nullable fields read as their present type. */
type Present<T> = { readonly [K in keyof T]-?: NonNullable<T[K]> };

declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(BookingStatus satisfies Dictionary<BookingStatus>);
dictionary(AttendanceState satisfies Dictionary<AttendanceState>);
dictionary(CancellationReason satisfies Dictionary<CancellationReason>);
dictionary(CancelledBy satisfies Dictionary<CancelledBy>);
dictionary(SeatSubject satisfies Dictionary<SeatSubject>);
dictionary(SubjectRelationship satisfies Dictionary<SubjectRelationship>);
dictionary(DiscountSource satisfies Dictionary<DiscountSource>);
dictionary(
  Combinability satisfies Readonly<
    Record<'Exclusive' | 'Stackable', Combinability>
  >,
);
dictionary(CouponExpiry satisfies Dictionary<CouponExpiry>);
dictionary(CouponOccasion satisfies Dictionary<CouponOccasion>);
dictionary(CouponStatus satisfies Dictionary<CouponStatus>);
dictionary(DiscountMethod satisfies Dictionary<DiscountMethod>);
dictionary(GrantStatus satisfies Dictionary<GrantStatus>);
dictionary(GrantCapacity satisfies Dictionary<GrantCapacity>);
dictionary(GrantExpiry satisfies Dictionary<GrantExpiry>);
dictionary(
  PhotoOrigin satisfies Readonly<Record<'Shot' | 'Library', PhotoOrigin>>,
);
dictionary(VoucherStatus satisfies Dictionary<VoucherStatus>);
dictionary(VoucherRefusal satisfies Dictionary<VoucherRefusal>);
dictionary(StaffEditErrorCode satisfies Dictionary<StaffEditErrorCode>);
dictionary(EditCommand satisfies Dictionary<EditCommand>);
dictionary(ResizeEdge satisfies Dictionary<ResizeEdge>);
dictionary(LedgerVerdict satisfies Dictionary<LedgerVerdict>);
dictionary(ProfileAuthType satisfies Dictionary<ProfileAuthType>);
dictionary(BillPending satisfies Dictionary<BillPending>);
dictionary(TipPreset satisfies Dictionary<TipPreset>);
dictionary(
  CancellationRefusalCode satisfies Dictionary<CancellationRefusalCode>,
);
dictionary(CarriedSeatRefusal satisfies Dictionary<CarriedSeatRefusal>);
dictionary(MoveErrorCode satisfies Dictionary<MoveErrorCode>);

// (2) Holds — exact values, one key per value.
export type AppointmentDictionariesHold = [
  Expect<Holds<typeof BookingStatus, BookingStatus>>, // primitives/booking-status.data.ts
  Expect<Holds<typeof AttendanceState, AttendanceState>>, // primitives/attendance-state.data.ts
  Expect<Holds<typeof CancellationReason, CancellationReason>>, // components/seat-outcome.data.ts
  Expect<Holds<typeof CancelledBy, CancelledBy>>, // components/seat-outcome.data.ts
  Expect<Holds<typeof SeatSubject, SeatSubject>>, // components/seat.data.ts
  Expect<Holds<typeof SubjectRelationship, SubjectRelationship>>, // components/seat.data.ts
  Expect<Holds<typeof DiscountSource, DiscountSource>>, // components/discount-provenance.data.ts
  Expect<
    Holds<Pick<typeof Combinability, 'Exclusive' | 'Stackable'>, Combinability>
  >, // components/coupon-combinability.data.ts (COMBINABILITY)
  Expect<Holds<typeof CouponExpiry, CouponExpiry>>, // components/coupon-expiry.data.ts
  Expect<Holds<typeof CouponOccasion, CouponOccasion>>, // components/coupon-occasion.data.ts
  Expect<Holds<typeof CouponStatus, CouponStatus>>, // components/coupon-occasion.data.ts
  Expect<Holds<typeof DiscountMethod, DiscountMethod>>, // components/coupon-value.data.ts
  Expect<Holds<typeof GrantStatus, GrantStatus>>, // primitives/grant-status.data.ts
  Expect<Holds<typeof GrantCapacity, GrantCapacity>>, // primitives/grant-status.data.ts
  Expect<Holds<typeof GrantExpiry, GrantExpiry>>, // primitives/grant-status.data.ts
  Expect<Holds<Pick<typeof PhotoOrigin, 'Shot' | 'Library'>, PhotoOrigin>>, // components/photo-origin.data.ts (PHOTO_ORIGIN)
  Expect<Holds<typeof VoucherStatus, VoucherStatus>>, // components/voucher-state.data.ts
  Expect<Holds<typeof VoucherRefusal, VoucherRefusal>>, // primitives/voucher-refusal.data.ts
  Expect<Holds<typeof StaffEditErrorCode, StaffEditErrorCode>>, // errors/staff-edit.error.ts
  Expect<Holds<typeof EditCommand, EditCommand>>, // components/edit-command.data.ts
  Expect<Holds<typeof ResizeEdge, ResizeEdge>>, // components/edit-command.data.ts
  Expect<Holds<typeof LedgerVerdict, LedgerVerdict>>, // systems/appointment-edit.system.ts
  Expect<Holds<typeof ProfileAuthType, ProfileAuthType>>, // systems/audit.system.ts
  Expect<Holds<typeof BillPending, BillPending>>, // systems/billing.system.ts
  Expect<Holds<typeof TipPreset, TipPreset>>, // systems/billing.system.ts
  Expect<Holds<typeof CancellationRefusalCode, CancellationRefusalCode>>, // errors/cancellation.error.ts
  Expect<Holds<typeof CarriedSeatRefusal, CarriedSeatRefusal>>, // errors/move.error.ts
  Expect<Holds<typeof MoveErrorCode, MoveErrorCode>>, // errors/move.error.ts
];

// (3) SCREAMING — every non-exempt value is upper-case (§0.4).
export type AppointmentDictionariesScream = [
  Expect<Screaming<BookingStatus>>,
  Expect<Screaming<AttendanceState>>,
  Expect<Screaming<CancellationReason>>,
  Expect<Screaming<CancelledBy>>,
  Expect<Screaming<SeatSubject>>,
  Expect<Screaming<SubjectRelationship>>,
  Expect<Screaming<DiscountSource>>,
  Expect<Screaming<Combinability>>,
  Expect<Screaming<CouponExpiry>>,
  Expect<Screaming<CouponOccasion>>,
  Expect<Screaming<CouponStatus>>,
  Expect<Screaming<DiscountMethod>>,
  Expect<Screaming<GrantStatus>>,
  Expect<Screaming<GrantCapacity>>,
  Expect<Screaming<GrantExpiry>>,
  Expect<Screaming<PhotoOrigin>>,
  Expect<Screaming<VoucherStatus>>,
  Expect<Screaming<VoucherRefusal>>,
  Expect<Screaming<StaffEditErrorCode>>,
  Expect<Screaming<EditCommand>>,
  Expect<Screaming<ResizeEdge>>,
  Expect<Screaming<LedgerVerdict>>,
  Expect<Screaming<ProfileAuthType>>,
  Expect<Screaming<BillPending>>,
  Expect<Screaming<TipPreset>>,
  Expect<Screaming<CancellationRefusalCode>>,
  Expect<Screaming<MoveErrorCode>>,
];

type ActiveGrant = Extract<GrantLifecycle, { readonly grantStatus: 'ACTIVE' }>;
type CancelledSeat = Extract<
  SeatOutcome,
  { readonly attendanceState: 'CANCELLED' }
>;
type AccountOccupant = Extract<
  SeatOccupant,
  { readonly seatSubject: 'ACCOUNT' }
>;
type PendingSet = Extract<PendingDiscounts, { readonly billPending: 'SET' }>;
type ResizeRequest = Extract<
  EditCommandRequest,
  { readonly editCommand: 'RESIZE' }
>;

// (4) L8 — each field is camelCase(Dictionary) (N15).
export type AppointmentDictionaryFields = [
  Expect<Equals<Appointment['bookingStatus'], BookingStatus>>, // entities/appointment.entity.ts
  Expect<Equals<BookingLifecycle['bookingStatus'], BookingStatus>>, // components/booking-lifecycle.data.ts
  Expect<Equals<SeatOutcome['attendanceState'], AttendanceState>>, // components/seat-outcome.data.ts
  Expect<Equals<CancelledSeat['cancellationReason'], CancellationReason>>, // seat-level; the root's is a CancellationReasonSet
  Expect<Equals<CancelledSeat['cancelledBy'], CancelledBy>>, // components/seat-outcome.data.ts
  Expect<Equals<SeatOccupant['seatSubject'], SeatSubject>>, // components/seat.data.ts
  Expect<Equals<AccountOccupant['subjectRelationship'], SubjectRelationship>>, // components/seat.data.ts
  Expect<Equals<AppliedDiscount['discountSource'], DiscountSource>>, // components/applied-discount.data.ts
  Expect<Equals<AppliedDiscount['combinability'], Combinability>>, // components/applied-discount.data.ts
  Expect<Equals<CouponExpiryRule['couponExpiry'], CouponExpiry>>, // components/coupon-expiry.data.ts
  Expect<Equals<Present<CouponMeta>['couponOccasion'], CouponOccasion>>, // entities/coupon.entity.ts (nullable)
  Expect<Equals<Coupon['couponStatus'], CouponStatus>>, // entities/coupon.entity.ts
  Expect<Equals<CouponValue['discountMethod'], DiscountMethod>>, // components/coupon-value.data.ts
  Expect<Equals<CouponGrant['grantStatus'], GrantStatus>>, // entities/coupon-grant.entity.ts
  Expect<Equals<GrantCapacityTerms['grantCapacity'], GrantCapacity>>, // primitives/grant-status.data.ts
  Expect<Equals<GrantExpiryTerms['grantExpiry'], GrantExpiry>>, // primitives/grant-status.data.ts
  Expect<Equals<ActiveGrant['grantCapacity'], GrantCapacity>>, // N15-exempt: the same field read through the active variant
  Expect<Equals<AppointmentPhoto['photoOrigin'], PhotoOrigin>>, // entities/appointment-photo.entity.ts
  Expect<Equals<GiftVoucher['voucherStatus'], VoucherStatus>>, // entities/gift-voucher.entity.ts
  Expect<Equals<VoucherLifecycle['voucherStatus'], VoucherStatus>>, // components/voucher-state.data.ts
  Expect<Equals<EditCommandRequest['editCommand'], EditCommand>>, // systems/appointment-edit.system.ts
  Expect<Equals<ResizeRequest['resizeEdge'], ResizeEdge>>, // systems/appointment-edit.system.ts
  Expect<Equals<LedgerVerdictResult['ledgerVerdict'], LedgerVerdict>>, // systems/appointment-edit.system.ts
  Expect<Equals<PendingDiscounts['billPending'], BillPending>>, // systems/billing.system.ts
  Expect<Equals<PendingSet['items'][number]['discountSource'], DiscountSource>>, // N15-exempt: a pending item's source, read through the set
  Expect<Equals<TipPresetOption['tipPreset'], TipPreset>>, // systems/billing.system.ts
];
