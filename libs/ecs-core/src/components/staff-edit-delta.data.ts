import type {
  AppliedDiscountId,
  BarberId,
  Currency,
  DurationMinutes,
  LocalDate,
  LocationId,
  MinuteOfDay,
  PriceCents,
} from '@core/primitives';

/**
 * What a staff save changed — the before and after of a `BOOKING_STAFF_*`
 * edit row (audit-hardening WS-2), intersected into
 * {@link AuditContext.StaffEdit}. One pair per dimension, and every pair is
 * `null` when the save left that dimension untouched (a multi-command save
 * is decided once, so its deltas are the stored visit against the saved one
 * — L3). Money, time and ids only — no voucher code, no discount label, no
 * contact (R36).
 *
 * - **Reprice** — the bill's SUBTOTAL (the seats' prices) before and after;
 *   `null` when it did not move, or when either side has no single-currency
 *   subtotal.
 * - **Currency** — `editCurrency` is set exactly when a money field is
 *   (`editRepriceFromCents` / `ToCents`, `editVoucherDebitCents`).
 * - **Discounts** — the applied discount ids before (`editDiscountFromIds`)
 *   and AFTER (`editDiscountIds`, the brief's name for the after set); `[]`
 *   is "none applied", `null` is "the set did not change".
 * - **Vouchers** — `editVoucherDebitCents`: what the LIVE voucher lines paid
 *   after the save less what they paid before, signed (`> 0` more was
 *   debited, `< 0` some was given back, `0` lines changed but the sum did
 *   not); `null` when the live lines did not change.
 * - **Duration** — the seats' sold minutes summed, before and after.
 * - **Relocate** — the shop, before and after.
 * - **Move** — the visit's day AND start, both pairs set together whenever
 *   either changed (a start means nothing without its day).
 * - **Restaff** — the barbers in seat order, duplicates kept (positional,
 *   never id-aligned).
 */
export type StaffEditDelta = {
  readonly editRepriceFromCents: PriceCents | null;
  readonly editRepriceToCents: PriceCents | null;
  readonly editCurrency: Currency | null;
  readonly editDiscountFromIds: readonly AppliedDiscountId[] | null;
  readonly editDiscountIds: readonly AppliedDiscountId[] | null;
  readonly editVoucherDebitCents: PriceCents | null;
  readonly editDurationFromMinutes: DurationMinutes | null;
  readonly editDurationToMinutes: DurationMinutes | null;
  readonly editRelocateFromLocationId: LocationId | null;
  readonly editRelocateToLocationId: LocationId | null;
  readonly editMoveFromLocalDate: LocalDate | null;
  readonly editMoveToLocalDate: LocalDate | null;
  readonly editMoveFromStartMinutes: MinuteOfDay | null;
  readonly editMoveToStartMinutes: MinuteOfDay | null;
  readonly editRestaffFromBarberIds: readonly BarberId[] | null;
  readonly editRestaffToBarberIds: readonly BarberId[] | null;
};

/** Nothing differs — every pair `null`. */
const NONE: StaffEditDelta = {
  editRepriceFromCents: null,
  editRepriceToCents: null,
  editCurrency: null,
  editDiscountFromIds: null,
  editDiscountIds: null,
  editVoucherDebitCents: null,
  editDurationFromMinutes: null,
  editDurationToMinutes: null,
  editRelocateFromLocationId: null,
  editRelocateToLocationId: null,
  editMoveFromLocalDate: null,
  editMoveToLocalDate: null,
  editMoveFromStartMinutes: null,
  editMoveToStartMinutes: null,
  editRestaffFromBarberIds: null,
  editRestaffToBarberIds: null,
};

export const StaffEditDelta = {
  /** The delta of a save that changed none of the audited dimensions. */
  NONE,
} as const;
