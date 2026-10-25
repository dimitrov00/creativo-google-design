import {
  AppointmentId,
  type BarberId,
  BookingStatus,
  type ClientOperationId,
  type CouponGrantId,
  type DurationMinutes,
  type EndMinute,
  GuestKey,
  type LocalDate,
  type LocationId,
  type MinuteOfDay,
  type PriceCents,
  Result,
  SeatId,
  type ServiceId,
  type ServiceVariantId,
  type UserId,
  type CartLineId,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import type { BarberPreference } from './barber-pref.data';
import type { BookingContact } from './booking-contact.data';
import { CallAnswer } from './call-answer.data';
import type { DiscountMethod } from './coupon-value.data';
import type { DiscountSource } from './discount-provenance.data';
import { EditCommand as EditCommandTag, ResizeEdge } from './edit-command.data';
import type { Placement } from './placement-kind.data';
import type { SeatLabel } from './seat-label.data';
import type { VoucherCode } from './voucher-code.data';
import { CancellationReason } from './cancellation-reason.data';

/**
 * Who a requested seat is for — the ONLY source of these strings, named after
 * the field they type (`requestedSubjectRole`). Moved here from
 * `guest-label.system.ts` (Law 8: the call component types with it, Phase 4a
 * 4A-6); `MoveSubjectRole` and `CommitSubjectRole` (the same values) retired
 * into it.
 */
export const RequestedSubjectRole = {
  /** The booker, bound to the verified token — never to the payload. */
  Self: 'SELF',
  /** A person with an account of their own, carried by a staff edit or a move. */
  Companion: 'COMPANION',
  /** Somebody with no account: their label is their identity on the wire. */
  Guest: 'GUEST',
} as const;
export type RequestedSubjectRole =
  (typeof RequestedSubjectRole)[keyof typeof RequestedSubjectRole];

/**
 * THE BOOKING WIRE (Phase 4a 4A-4) — the request the booking callables take
 * and the answers they give, typed (branded) on the web side; the server
 * decodes `unknown` into the raw twins (`SeatInput`, `SubjectInput`) with the
 * primitives' smart constructors. Every placement is the shop's wall clock
 * (`localDate` + minutes, Law 7.3): the pipeline, having loaded the
 * location, computes the instant ONCE. Money is `*Cents`; every
 * discriminator SCREAMING; an optional key is present with `null`.
 *
 * The root type is the commit (`commitBooking`): the shop, the ONE shop day
 * every seat is on, the seats, the client's idempotency key (the new
 * appointment's id), the contact snapshot, the rebooking edge, who places it
 * (`placement` — the appointment's own `Placement` stamp: `SELF` from
 * `/book`, `STAFF` from the staff day; the frozen wire told them apart by
 * the presence of `onBehalfOfUserId`, which the flipped wire always sends)
 * and — for the shop's own placement — the client it books for.
 */
export type BookingCall = {
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly seats: readonly BookingCall.Seat[];
  readonly attemptId: ClientOperationId;
  readonly contact: BookingContact.Input | null;
  readonly bookedFromAppointmentId: AppointmentId | null;
  readonly placement: Placement;
  readonly onBehalfOfUserId: UserId | null;
};

export const BookingCall = {
  /* ── builders: the web stores call these instead of hand-building literals ── */

  /** The booker's own seat. */
  selfSubject(): BookingCall.Subject.Self {
    return { requestedSubjectRole: RequestedSubjectRole.Self };
  },

  /**
   * A guest by label. `guestKey` is the cart's seat key text: a key that is
   * not one (`GuestKey.parse`) drops to `null`, never refuses — the guest is
   * then read by label alone, as today.
   */
  guestSubject(
    label: string,
    guestKey: string | null,
  ): BookingCall.Subject.Guest {
    const key = guestKey === null ? null : GuestKey.parse(guestKey);
    return {
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label,
      guestKey: key !== null && key.ok ? key.value : null,
    };
  },

  /**
   * A client's cancel (code-only, D23): whatever the client typed files it
   * as `OTHER`; nothing typed, or only blanks, is `UNSPECIFIED` — the rule
   * the callable's decoder applied to the text until the wire carried the
   * code itself (Phase 4a 4A-4).
   */
  clientCancel(
    appointmentId: AppointmentId,
    typedReason: string,
  ): BookingCall.Cancel {
    return {
      appointmentId,
      reason:
        typedReason.trim().length > 0
          ? CancellationReason.Other
          : CancellationReason.Unspecified,
    };
  },

  /**
   * The code a STAFF cancel files (D23 — the call carries the code only):
   * the reason the barber picked, or nothing (`null`, which the server
   * files as `UNSPECIFIED`). «Друго…» (`OTHER`) counts only with words
   * beside it — `OTHER` with a blank note is a door opened and not walked
   * through, so it files no code. The words themselves are the visit's
   * note, never the call's.
   */
  staffCancelReason(
    picked: CancellationReason | null,
    note: string,
  ): CancellationReason | null {
    return picked === CancellationReason.Other && note.trim().length === 0
      ? null
      : picked;
  },

  /** A person with an account of their own (a staff edit's or a carried seat's). */
  companionSubject(companionUserId: UserId): BookingCall.Subject.Companion {
    return {
      requestedSubjectRole: RequestedSubjectRole.Companion,
      companionUserId,
    };
  },

  /** One seat: WHAT, from WHOM, from when on the request's day, for whom. */
  seat(
    lineId: CartLineId,
    serviceId: ServiceId,
    variantId: ServiceVariantId | null,
    barberId: BarberId,
    barberPreference: BarberPreference | null,
    startMinutes: MinuteOfDay,
    subject: BookingCall.Subject,
  ): BookingCall.Seat {
    return {
      lineId,
      serviceId,
      variantId,
      barberId,
      barberPreference,
      startMinutes,
      subject,
    };
  },

  /** `MOVE`: the party (`seatIds: null`) or the named seats to a new start. */
  editMove(
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
    seatIds: readonly SeatId[] | null,
  ): BookingCall.EditCommand.Move {
    return {
      editCommand: EditCommandTag.Move,
      localDate,
      startMinutes,
      seatIds,
    };
  },

  /** `RESIZE` by the START handle: the new start. */
  editResizeStart(
    localDate: LocalDate,
    atMinutes: MinuteOfDay,
    seatIds: readonly SeatId[] | null,
  ): BookingCall.EditCommand.ResizeStart {
    return {
      editCommand: EditCommandTag.Resize,
      resizeEdge: ResizeEdge.Start,
      localDate,
      atMinutes,
      seatIds,
    };
  },

  /** `RESIZE` by the END handle: the new exclusive end. */
  editResizeEnd(
    localDate: LocalDate,
    atMinutes: EndMinute,
    seatIds: readonly SeatId[] | null,
  ): BookingCall.EditCommand.ResizeEnd {
    return {
      editCommand: EditCommandTag.Resize,
      resizeEdge: ResizeEdge.End,
      localDate,
      atMinutes,
      seatIds,
    };
  },

  editReprice(
    seatId: SeatId,
    priceCents: PriceCents,
  ): BookingCall.EditCommand.Reprice {
    return { editCommand: EditCommandTag.Reprice, seatId, priceCents };
  },

  editRedurate(
    seatId: SeatId,
    durationMinutes: DurationMinutes,
  ): BookingCall.EditCommand.Redurate {
    return { editCommand: EditCommandTag.Redurate, seatId, durationMinutes };
  },

  editRestaff(
    seatId: SeatId,
    barberId: BarberId,
  ): BookingCall.EditCommand.Restaff {
    return { editCommand: EditCommandTag.Restaff, seatId, barberId };
  },

  editAddSeat(
    seatId: SeatId,
    serviceId: ServiceId,
    variantId: ServiceVariantId | null,
    barberId: BarberId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
    durationMinutes: DurationMinutes,
    addedSubject: BookingCall.AddedSubject,
  ): BookingCall.EditCommand.AddSeat {
    return {
      editCommand: EditCommandTag.AddSeat,
      seatId,
      serviceId,
      variantId,
      barberId,
      localDate,
      startMinutes,
      durationMinutes,
      addedSubject,
    };
  },

  editRemoveSeat(seatId: SeatId): BookingCall.EditCommand.RemoveSeat {
    return { editCommand: EditCommandTag.RemoveSeat, seatId };
  },

  editRelocate(locationId: LocationId): BookingCall.EditCommand.Relocate {
    return { editCommand: EditCommandTag.Relocate, locationId };
  },

  editDiscounts(
    discounts: readonly BookingCall.StaffDiscount[],
  ): BookingCall.EditCommand.Discounts {
    return { editCommand: EditCommandTag.Discounts, discounts };
  },

  editVouchers(
    codes: readonly VoucherCode[],
  ): BookingCall.EditCommand.Vouchers {
    return { editCommand: EditCommandTag.Vouchers, codes };
  },

  /* ── answer decoders: the only way an answer becomes branded data ── */

  /** `commitBooking`'s answer — an empty or missing id is a failure, never a success. */
  decodeCommitted(raw: unknown): Result<BookingCall.Committed, PipelineError> {
    const answer = CallAnswer.read(raw);
    const appointmentId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'appointmentId', AppointmentId.parse);
    return appointmentId === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId });
  },

  decodeRescheduled(
    raw: unknown,
  ): Result<BookingCall.Rescheduled, PipelineError> {
    return BookingCall.decodeCommitted(raw);
  },

  decodeCancelled(raw: unknown): Result<BookingCall.Cancelled, PipelineError> {
    return BookingCall.decodeCommitted(raw);
  },

  decodeTransitioned(
    raw: unknown,
  ): Result<BookingCall.Transitioned, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const appointmentId = CallAnswer.parsed(
      answer,
      'appointmentId',
      AppointmentId.parse,
    );
    const toBookingStatus = CallAnswer.tag(
      answer,
      'toBookingStatus',
      BookingStatus,
    );
    return appointmentId === null || toBookingStatus === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId, toBookingStatus });
  },

  decodeArrived(raw: unknown): Result<BookingCall.Arrived, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const appointmentId = CallAnswer.parsed(
      answer,
      'appointmentId',
      AppointmentId.parse,
    );
    const alreadyArrived = CallAnswer.flag(answer, 'alreadyArrived');
    return appointmentId === null || alreadyArrived === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId, alreadyArrived });
  },

  decodeCleared(raw: unknown): Result<BookingCall.Cleared, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const appointmentId = CallAnswer.parsed(
      answer,
      'appointmentId',
      AppointmentId.parse,
    );
    const alreadyClear = CallAnswer.flag(answer, 'alreadyClear');
    return appointmentId === null || alreadyClear === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId, alreadyClear });
  },

  decodeTipRecorded(
    raw: unknown,
  ): Result<BookingCall.TipRecorded, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const appointmentId = CallAnswer.parsed(
      answer,
      'appointmentId',
      AppointmentId.parse,
    );
    const seatId = CallAnswer.parsed(answer, 'seatId', SeatId.parse);
    const unchanged = CallAnswer.flag(answer, 'unchanged');
    return appointmentId === null || seatId === null || unchanged === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId, seatId, unchanged });
  },

  decodeStaffEdited(
    raw: unknown,
  ): Result<BookingCall.StaffEdited, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const appointmentId = CallAnswer.parsed(
      answer,
      'appointmentId',
      AppointmentId.parse,
    );
    const revision = CallAnswer.whole(answer, 'revision', 0);
    return appointmentId === null || revision === null
      ? CallAnswer.unusable()
      : Result.ok({ appointmentId, revision });
  },
} as const;

export namespace BookingCall {
  /**
   * ONE seat shape for every booking call (a commit, a move, the cart):
   * WHAT and from WHOM, never a price or a duration — the server resolves
   * both — its start on the request's shop day, and for whom. The line's
   * barber PREFERENCE rides along: «Ivan, by name» and «whoever is free» are
   * different bookings the morning Ivan calls in sick.
   */
  export type Seat = {
    readonly lineId: CartLineId;
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly barberId: BarberId;
    readonly barberPreference: BarberPreference | null;
    readonly startMinutes: MinuteOfDay;
    readonly subject: Subject;
  };

  /**
   * ONE subject shape: the booker, a guest by label (with the cart's
   * `guestKey`, so two guests sharing a label are told apart; `null` reads
   * one label as one person), or an account (a staff edit's or a carried
   * seat's — refused on a client cart, as today).
   */
  export type Subject = Subject.Self | Subject.Guest | Subject.Companion;
  export namespace Subject {
    export type Self = {
      readonly requestedSubjectRole: typeof RequestedSubjectRole.Self;
    };
    export type Guest = {
      readonly requestedSubjectRole: typeof RequestedSubjectRole.Guest;
      readonly label: string;
      readonly guestKey: GuestKey | null;
    };
    export type Companion = {
      readonly requestedSubjectRole: typeof RequestedSubjectRole.Companion;
      readonly companionUserId: UserId;
    };
  }

  /**
   * The server's raw twin of {@link Seat} — foreign input after the edge's
   * `unknown`-decoding step, before the decision parses its ids (the L3
   * `…Input` escape): raw strings, a start that did not parse as `null`.
   */
  export type SeatInput = {
    readonly lineId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly barberId: string;
    readonly barberPreference: BarberPreference | null;
    readonly startMinutes: number | null;
    readonly subject: SubjectInput;
  };

  /** The raw twin of {@link Subject} — the account id before it is parsed. */
  export type SubjectInput =
    | { readonly requestedSubjectRole: typeof RequestedSubjectRole.Self }
    | {
        readonly requestedSubjectRole: typeof RequestedSubjectRole.Companion;
        readonly companionUserId: string;
      }
    | {
        readonly requestedSubjectRole: typeof RequestedSubjectRole.Guest;
        readonly label: string;
        readonly guestKey: string | null;
      };

  /** `rescheduleAppointment`: the visit, the shop and day it moves to, the cart that stands in for it. */
  export type Reschedule = {
    readonly appointmentId: AppointmentId;
    readonly locationId: LocationId;
    readonly localDate: LocalDate;
    readonly seats: readonly Seat[];
    readonly attemptId: ClientOperationId | null;
  };

  /** `cancelAppointment`: the visit and the code it is filed under. */
  export type Cancel = {
    readonly appointmentId: AppointmentId;
    readonly reason: CancellationReason;
  };

  /**
   * `transitionAppointment`: one seat (`seatId`) or the whole party (`null`).
   * A cancel carries its CODE only (D23): words a barber types beside
   * `OTHER` are the visit's note (`appointmentNotes/{appointmentId}`),
   * written by the staff day once the cancel has landed — never this call's.
   */
  export type Transition = {
    readonly appointmentId: AppointmentId;
    readonly toBookingStatus: BookingStatus;
    readonly cancellationReason: CancellationReason | null;
    readonly seatId: SeatId | null;
  };

  /** `markArrived` / `clearArrival`. */
  export type Arrival = {
    readonly appointmentId: AppointmentId;
  };

  /** `recordSeatTip`: `null` clears ("not recorded" — never zero). */
  export type Tip = {
    readonly appointmentId: AppointmentId;
    readonly seatId: SeatId;
    readonly amountCents: PriceCents | null;
  };

  /** `staffEditAppointment`: one named intent — always an array of commands. */
  export type StaffEdit = {
    readonly appointmentId: AppointmentId;
    readonly commands: readonly EditCommand[];
    /** «Запази въпреки застъпването» — the ONLY thing that turns the collision check off. */
    readonly acknowledgedOverlap: boolean;
    /** The revision the intent was drawn on; `null` makes no claim. */
    readonly expectedVersion: number | null;
    /** The client's name for this ONE intent. */
    readonly operationId: ClientOperationId | null;
  };

  /** Who an added seat is for: the visit's owner, or a guest by label. */
  export type AddedSubject =
    | { readonly requestedSubjectRole: typeof RequestedSubjectRole.Self }
    | {
        readonly requestedSubjectRole: typeof RequestedSubjectRole.Guest;
        readonly label: SeatLabel;
      };

  /** A discount the shop applies in a `DISCOUNTS` command. */
  export type StaffDiscount =
    | {
        readonly discountSource: typeof DiscountSource.Grant;
        readonly grantId: CouponGrantId;
      }
    | {
        readonly discountSource: typeof DiscountSource.Code;
        /** Normalised (trimmed, upper-case). */
        readonly code: VoucherCode;
      }
    | {
        readonly discountSource: typeof DiscountSource.Manual;
        readonly discountMethod: typeof DiscountMethod.PercentOff;
        readonly discountPercent: number;
      }
    | {
        readonly discountSource: typeof DiscountSource.Manual;
        readonly discountMethod: typeof DiscountMethod.FixedAmount;
        readonly discountAmountCents: PriceCents;
      };

  /**
   * One staff command, its placement on the shop's wall clock — a `MOVE`
   * names its day and start, a `RESIZE` its day and the minute its handle
   * lands on (a start for `START`, an exclusive end for `END`), an
   * `ADD_SEAT` its day, start and duration; every other command as today.
   */
  export type EditCommand =
    | EditCommand.Move
    | EditCommand.ResizeStart
    | EditCommand.ResizeEnd
    | EditCommand.Reprice
    | EditCommand.Redurate
    | EditCommand.Restaff
    | EditCommand.AddSeat
    | EditCommand.RemoveSeat
    | EditCommand.Relocate
    | EditCommand.Discounts
    | EditCommand.Vouchers;
  export namespace EditCommand {
    export type Move = {
      readonly editCommand: typeof EditCommandTag.Move;
      readonly localDate: LocalDate;
      readonly startMinutes: MinuteOfDay;
      readonly seatIds: readonly SeatId[] | null;
    };
    export type ResizeStart = {
      readonly editCommand: typeof EditCommandTag.Resize;
      readonly resizeEdge: typeof ResizeEdge.Start;
      readonly localDate: LocalDate;
      readonly atMinutes: MinuteOfDay;
      readonly seatIds: readonly SeatId[] | null;
    };
    export type ResizeEnd = {
      readonly editCommand: typeof EditCommandTag.Resize;
      readonly resizeEdge: typeof ResizeEdge.End;
      readonly localDate: LocalDate;
      readonly atMinutes: EndMinute;
      readonly seatIds: readonly SeatId[] | null;
    };
    export type Reprice = {
      readonly editCommand: typeof EditCommandTag.Reprice;
      readonly seatId: SeatId;
      readonly priceCents: PriceCents;
    };
    export type Redurate = {
      readonly editCommand: typeof EditCommandTag.Redurate;
      readonly seatId: SeatId;
      readonly durationMinutes: DurationMinutes;
    };
    export type Restaff = {
      readonly editCommand: typeof EditCommandTag.Restaff;
      readonly seatId: SeatId;
      readonly barberId: BarberId;
    };
    export type AddSeat = {
      readonly editCommand: typeof EditCommandTag.AddSeat;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly barberId: BarberId;
      readonly localDate: LocalDate;
      readonly startMinutes: MinuteOfDay;
      readonly durationMinutes: DurationMinutes;
      readonly addedSubject: AddedSubject;
    };
    export type RemoveSeat = {
      readonly editCommand: typeof EditCommandTag.RemoveSeat;
      readonly seatId: SeatId;
    };
    export type Relocate = {
      readonly editCommand: typeof EditCommandTag.Relocate;
      readonly locationId: LocationId;
    };
    export type Discounts = {
      readonly editCommand: typeof EditCommandTag.Discounts;
      readonly discounts: readonly StaffDiscount[];
    };
    export type Vouchers = {
      readonly editCommand: typeof EditCommandTag.Vouchers;
      /** Normalised, distinct. */
      readonly codes: readonly VoucherCode[];
    };
  }

  /* ── answers ── */
  export type Committed = { readonly appointmentId: AppointmentId };
  export type Rescheduled = { readonly appointmentId: AppointmentId };
  export type Cancelled = { readonly appointmentId: AppointmentId };
  export type Transitioned = {
    readonly appointmentId: AppointmentId;
    readonly toBookingStatus: BookingStatus;
  };
  export type Arrived = {
    readonly appointmentId: AppointmentId;
    /** A second tap: the visit had already arrived — nothing written. */
    readonly alreadyArrived: boolean;
  };
  export type Cleared = {
    readonly appointmentId: AppointmentId;
    /** The visit had no arrival to clear — nothing written. */
    readonly alreadyClear: boolean;
  };
  export type TipRecorded = {
    readonly appointmentId: AppointmentId;
    readonly seatId: SeatId;
    /** The stored figure already was this one — nothing written. */
    readonly unchanged: boolean;
  };
  export type StaffEdited = {
    readonly appointmentId: AppointmentId;
    /** What the sheet sends as `expectedVersion` next. */
    readonly revision: number;
  };
}
