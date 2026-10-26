import type {
  BarberId,
  CouponGrantId,
  Currency,
  DraftPersonKey,
  DurationMinutes,
  GiftVoucherId,
  LocalDate,
  LocationId,
  PriceCents,
  SeatId,
  ServiceId,
  ServiceVariantId,
  TrackMinute,
} from '@core/primitives';
import type { CouponValue } from './coupon-value.data';
import type { DiscountProvenance } from './discount-provenance.data';
import type { VisitSides } from './visit-sides.data';
import type { VoucherCode } from './voucher-code.data';

/**
 * THE STAFF VISIT SHEET'S DRAFT, as its «Запази» publishes it — the
 * editor's commit (`VisitEditorCommit`), the input of
 * `StaffEditPlanSystem.commandsFor` (pass D, D-10.1). The sheet knows what a
 * barber typed; the plan works out the batch from the row it was opened on.
 * Field names are the editor's; every value is branded, and every property
 * is REQUIRED — absent is `null` (the three formerly optional fields:
 * `revision`, `drawn`, a leg's `typedPriceCents`).
 *
 * The start and end are TRACK minutes (`TrackMinute`): a drafted span may
 * cross the closing midnight (a late cut 23:25–00:15 is 1405–1455); the plan
 * reads them back onto the shop's wall clock and refuses what the day cannot
 * hold, as the server does.
 */
export type StaffEditDraft = {
  /**
   * The stored revision the draft was DRAWN from, or `null` for none — what
   * the save claims as its `expectedVersion`, so a colleague's save since is
   * refused as stale instead of overwritten (round 5).
   */
  readonly revision: number | null;
  /** The visit's one shop day, as drafted. */
  readonly dayKey: LocalDate;
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
  /** The shop the visit is at, as drafted — the «Салон» row's pick; `null` when the sheet had none to offer. */
  readonly locationId: LocationId | null;
  /** The services, in ladder order — each seated serially from the start. */
  readonly legs: readonly StaffEditDraft.Leg[];
  /** The team note as drafted — `null` when cleared. */
  readonly note: string | null;
  /** The bill's discounts as drafted — empty for full price. */
  readonly discounts: readonly StaffEditDraft.Discount[];
  /** The vouchers paying the bill, in cover order. */
  readonly vouchers: readonly StaffEditDraft.Voucher[];
  /** What the client left this chair, in cents — `null` when none, or cleared. */
  readonly tipCents: PriceCents | null;
  /**
   * The note and the tip as the draft last READ them from the server
   * (`VisitSidesSystem`, round 5); `null` — measured against what is stored
   * now.
   */
  readonly drawn: VisitSides | null;
  /** Who the visit is for — each person by the sheet's own draft key. */
  readonly clients: readonly StaffEditDraft.Client[];
};

export namespace StaffEditDraft {
  /** One drafted service — a seat the visit holds, or one the save adds (its id minted by the sheet). */
  export type Leg = {
    readonly seatId: SeatId;
    readonly serviceId: ServiceId;
    /** The variant chosen, or `null` for a service that declares none. */
    readonly variantId: ServiceVariantId | null;
    readonly minutes: DurationMinutes;
    /** The leg's price — the seat's stored one, or the catalogue's for an added leg; `null` when unknown. */
    readonly priceCents: PriceCents | null;
    readonly currency: Currency;
    /**
     * A price TYPED on the ladder (was the commit's optional `priceCents`) —
     * sent as a `REPRICE`; `null` when nobody touched the money.
     */
    readonly typedPriceCents: PriceCents | null;
    readonly barberId: BarberId;
    /** Whose seat — one of the draft's `clients[].id`, or the placeholder. */
    readonly clientId: DraftPersonKey;
  };

  /**
   * A discount ON the visit, saved or drafted — its provenance and value as
   * the domain stores them (the pass-C D-11 reshape of the sheet's discount
   * VM onto `DiscountProvenance & CouponValue`), with the coupon's name
   * (`label`), the grant it honours and the code it was opened with (as the
   * sheet carries them — `null` for none), and the coupon's own rule that it
   * must be alone on the bill (`exclusive`). A grant and a code travel as
   * references the server re-resolves; a manual figure as its value.
   */
  export type Discount = DiscountProvenance &
    CouponValue & {
      readonly label: string;
      readonly grantId: CouponGrantId | null;
      readonly code: VoucherCode | null;
      readonly exclusive: boolean;
    };

  /**
   * A gift voucher PAYING for the visit: what this visit may draw on it
   * (`availableCents` — was `availableMinorUnits`: the balance it had, plus
   * whatever this visit had already drawn).
   */
  export type Voucher = {
    readonly voucherId: GiftVoucherId;
    readonly code: VoucherCode;
    readonly availableCents: PriceCents;
  };

  /**
   * One person on the visit — the sheet's draft key, the name it shows, and
   * the number and the e-mail the desk has for them (`null` for none), as
   * typed: the plan parses both into the guest's contact (OR-26), so what
   * the barber typed reaches the server's walk-in record.
   */
  export type Client = {
    readonly id: DraftPersonKey;
    readonly label: string;
    readonly phone: string | null;
    readonly email: string | null;
  };
}
