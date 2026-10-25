import {
  BookingCall,
  DiscountMethod,
  DiscountSource,
  Placement,
  RequestedSubjectRole,
  SeatLabel,
  type StaffEditDraft,
  VoucherCode,
} from '@core/components';
import {
  type AppointmentId,
  BookingStatus,
  CartLineId,
  DraftPersonKey,
  type BarberId,
  type DurationMinutes,
  type LocationId,
  MinuteOfDay,
  type PriceCents,
  Result,
  type SeatId,
  TrackMinute,
  type UserId,
} from '@core/primitives';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import { AppointmentLifecycleSystem } from './appointment-lifecycle.system';
import { DiscountSystem } from './discount.system';
import { VisitDraftSystem, type WalkInLabel } from './visit-draft.system';

/**
 * The facts of the ROW a staff visit sheet was opened on that the save plan
 * reads — exactly the row fields the dashboard's `commandsFor` and its tip
 * seat read (pass D, D-10.1), typed with ecs-core types only. The
 * dashboard's own row view model passes in AS IS (Law 3, zero inbound
 * mapping): its fields of these names are wider than these.
 */
export type StaffEditRowFacts = {
  /** The shop the visit is at — a relocate is sent only when the draft names another. */
  readonly locationId: LocationId;
  /** The label the chair is named after — a non-booker chair's subject when the draft names nobody. */
  readonly clientLabel: string;
  /** The chair's own person is the booker's `SELF` seat (`false`: a guest the chair is named after). */
  readonly selfSeat: boolean;
  /** The chair's own seats, in stored order — its share of the party, and the tip's seat. */
  readonly seatIds: readonly SeatId[];
  /** How many seats the whole party holds — a chair holding all of them IS the booking. */
  readonly partySize: number;
  /** The chair's people, as shown — a new stranger is numbered past their labels. */
  readonly people: readonly { readonly label: string }[];
  /** The chair's seats as the sheet shows them — what a draft leg is compared against. */
  readonly legs: readonly {
    readonly seatId: SeatId;
    readonly minutes: DurationMinutes;
    /** The seat's barber; `null` when the row named none. */
    readonly barberId: BarberId | null;
    /** The seat's stored price; `null` when unknown. */
    readonly priceCents: PriceCents | null;
  }[];
  /** The bill's discounts as stored. */
  readonly discounts: readonly StaffEditDraft.Discount[];
  /** The vouchers paying the bill as stored, in cover order. */
  readonly vouchers: readonly { readonly code: VoucherCode }[];
};

/**
 * The catalogue words a save names its unnamed people by — the plain
 * walk-in label (`staff.visit.walkIn`), and the numbered one for the
 * second stranger on a visit and after (`staff.visit.walkInNumbered`).
 * Words in, never formatted here.
 */
export type StaffEditWords = {
  readonly walkIn: string;
  readonly walkInNumbered: (number: number) => string;
};

/**
 * What the create sheet itself knows beside its draft: the chair's home
 * shop (where the sheet offered no «Салон» pick), the person it was opened
 * for, and the finished visit a «Запиши пак» came from.
 */
export type StaffCreateContext = {
  /** The chair's home location (`LocationScopeSystem.homeOf`); `null` when unknown. */
  readonly homeLocationId: LocationId | null;
  /** The person the create sheet opened with, by its draft key; `null` for a cold create. */
  readonly clientId: DraftPersonKey | null;
  /** The visit a «Запиши пак» came from — the rebooking edge; `null` for none. */
  readonly bookedFrom: AppointmentId | null;
};

/** A booking request a staff create sends — the commit call, before its attempt id is minted. */
export type StaffBookingRequest = Omit<BookingCall, 'attemptId'>;

/** A placement the call cannot carry, refused as the server refuses it (`field` named). */
function refusedAt(field: string): Result.Err<PipelineError> {
  return Result.err(
    PipelineError.of(
      PipelineErrorCode.InvalidRequest,
      StaffEditErrorCode.InvalidCommand,
      null,
      field,
    ),
  );
}

/**
 * A guest an added seat is for — by label, the guest's only identity: trimmed
 * and bounded as the server reads it, refused as it refuses a bad one.
 */
function guestSubject(
  label: string,
): Result<BookingCall.AddedSubject, PipelineError> {
  const parsed = SeatLabel.parse(label);
  return parsed.ok
    ? Result.ok({
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: parsed.value,
      })
    : refusedAt('addedSubject');
}

/**
 * The labels the draft's UNNAMED people ride under: every leg whose person
 * is not a drafted client — and is not `except`, the chair's own person,
 * who keeps the chair's subject — named by the plain word, then numbered,
 * past the drafted clients' labels and `taken`, the ones the stored visit
 * already holds (`VisitDraftSystem.walkInLabels`: one entry per person, in
 * first-seen order).
 */
function walkInNames(
  draft: StaffEditDraft,
  taken: readonly string[],
  except: DraftPersonKey | null,
  words: StaffEditWords,
): readonly WalkInLabel[] {
  const named = new Set(draft.clients.map((client) => client.id));
  return VisitDraftSystem.walkInLabels(
    draft.legs
      .map((leg) => leg.clientId)
      .filter((id) => !named.has(id) && id !== except),
    [...draft.clients.map((client) => client.label), ...taken],
    (number): string =>
      number === null ? words.walkIn : words.walkInNumbered(number),
  );
}

/**
 * A drafted discount → what the server is asked for. A grant and a code
 * are sent as REFERENCES — the server resolves and snapshots them — and only
 * a manual figure carries its value. `null` asks for nothing (a reference
 * with nothing to name, a free service the counter cannot type).
 */
function toDiscountRequest(
  discount: StaffEditDraft.Discount,
): Result<BookingCall.StaffDiscount | null, PipelineError> {
  switch (discount.discountSource) {
    case DiscountSource.Grant:
      return Result.ok(
        discount.grantId === null
          ? null
          : {
              discountSource: DiscountSource.Grant,
              grantId: discount.grantId,
            },
      );
    case DiscountSource.Code:
      return Result.ok(
        discount.code === null
          ? null
          : {
              discountSource: DiscountSource.Code,
              code: VoucherCode.of(VoucherCode.normalize(discount.code)),
            },
      );
    case DiscountSource.Manual: {
      // A manual discount is a percent or an amount; `FREE_SERVICE` is a
      // coupon's word, not the counter's, and cannot be typed here.
      if (discount.discountMethod === DiscountMethod.PercentOff) {
        return Result.ok({
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: discount.discountPercent,
        });
      }
      if (discount.discountMethod === DiscountMethod.FixedAmount) {
        return Result.ok({
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.FixedAmount,
          discountAmountCents: discount.discountAmountCents,
        });
      }
      return Result.ok(null);
    }
  }
}

/**
 * StaffEditPlanSystem — THE STAFF SAVE'S WRITE PLAN (pass D, D-10.1; moved
 * line for line from the staff dashboard's `commandsFor`, its tip seat and
 * `createFromEditor`'s request): what the server is asked for to make the
 * stored visit say what the sheet's draft says. The save's arithmetic and
 * its undo's, since both are "make the stored visit say this" — so the
 * command ORDER and every object's KEY order are load-bearing (the undo
 * compares two plans as `JSON.stringify` text). Decisions only: the awaits,
 * the pending maps and the receipt stay the dashboard's.
 */
export const StaffEditPlanSystem = {
  /**
   * THE BATCH from a row to a target — every command decided by the server
   * in one fold. In this order:
   *
   * 1. the start and end read back onto the shop's wall clock — a track
   *    minute the day cannot hold is refused (`startMinutes` / `atMinutes`),
   *    as the server refuses it;
   * 2. `RELOCATE` first, when the draft names another shop than the row's;
   * 3. `REMOVE_SEAT` for each row leg the draft dropped, then `ADD_SEAT`
   *    (and a typed price's `REPRICE`) for each draft leg the row lacks,
   *    placed serially where the ladder draws it, for the person it names
   *    (the chair's own person keeps the chair's subject; anyone else rides
   *    as a guest by label, a stranger numbered past every label the VISIT
   *    holds — `visitGuestLabels`, the other chairs' too);
   * 4. with more than one leg, each kept leg PINNED to its ladder slot
   *    (`MOVE` of that seat alone), so the chair-wide move cannot swap
   *    them;
   * 5. the chair-wide `MOVE` and the end's `RESIZE`, scoped to the seats
   *    the batch LEAVES on a chair that is a share of the party (`null`
   *    for a chair holding the whole party);
   * 6. per kept leg, only what changed: `REDURATE`, `RESTAFF`, and a typed
   *    price's `REPRICE` when the leg's price differs from the stored one
   *    (DEP-20: gated on cents, no longer on labels);
   * 7. `DISCOUNTS` when the drafted set promises otherwise than the stored
   *    one (`DiscountSystem.samePromise`, order-blind), then `VOUCHERS`
   *    when the cover differs (`VoucherCode.sameCover`).
   *
   * `row` is `null` for a sheet with no row (nothing to compare: every leg
   * is added, nothing is relocated). A new array; the inputs are untouched.
   */
  commandsFor(
    draft: StaffEditDraft,
    row: StaffEditRowFacts | null,
    visitGuestLabels: readonly string[],
    words: StaffEditWords,
  ): Result<readonly BookingCall.EditCommand[], PipelineError> {
    // The visit's ONE shop day, as the sheet drafted it (Law 7.3: the call
    // carries the wall clock; the server reads it in the shop's zone once).
    const localDate = draft.dayKey;
    const start = TrackMinute.toStart(draft.startMinute);
    if (!start.ok) return refusedAt('startMinutes');
    const end = TrackMinute.toEnd(draft.endMinute);
    if (!end.ok) return refusedAt('atMinutes');

    /*
     * THE SCOPE NAMES THE TARGET'S SEATS. A chair's share of a party is
     * scoped to its own seats — but to the seats the batch LEAVES on the
     * chair, as the target lists them: a seat the batch removes must not be
     * named (the server refuses a stale id rather than widening), and one it
     * adds exists by the time the chair-wide commands run. Whether the chair
     * IS a share is the per-seat acts' own rule — a chair holding the whole
     * party addresses the root (`transitionSeats`, read for a verb with a
     * per-seat meaning).
     */
    const seatIds =
      row === null ||
      AppointmentLifecycleSystem.transitionSeats(
        BookingStatus.Completed,
        row.seatIds,
        row.partySize,
      ).length === 0
        ? []
        : draft.legs.map((leg) => leg.seatId);
    const scope = seatIds.length > 0 ? seatIds : null;

    /*
     * ORDER IS THE POINT. The move puts the block on the right day at the
     * right start; the resize then measures the END from where the move left
     * it.
     */
    const commands: BookingCall.EditCommand[] = [];

    // THE SHOP, before everything — only when it differs from the row's.
    if (
      typeof draft.locationId === 'string' &&
      row !== null &&
      draft.locationId !== row.locationId
    ) {
      commands.push(BookingCall.editRelocate(draft.locationId));
    }

    // SERVICES REMOVED — a leg the row had and the draft no longer has.
    const before = row?.legs ?? [];
    for (const leg of before) {
      if (!draft.legs.some((entry) => entry.seatId === leg.seatId)) {
        commands.push(BookingCall.editRemoveSeat(leg.seatId));
      }
    }
    /*
     * WHOSE SEAT. The chair's own person — the booker, or the guest the chair
     * is named after — keeps the chair's subject; a second person added on
     * this visit rides as a guest under their own name (the party grammar).
     */
    const chairPerson =
      draft.clients[0]?.id ?? VisitDraftSystem.PLACEHOLDER_CLIENT_ID;
    const strangers = walkInNames(
      draft,
      row === null
        ? []
        : [...row.people.map((person) => person.label), ...visitGuestLabels],
      chairPerson,
      words,
    );
    const subjectFor = (
      clientId: DraftPersonKey,
    ): Result<BookingCall.AddedSubject, PipelineError> => {
      if (clientId === chairPerson) {
        return row?.selfSeat === false
          ? guestSubject(draft.clients[0]?.label ?? row.clientLabel)
          : Result.ok({ requestedSubjectRole: RequestedSubjectRole.Self });
      }
      const label: string =
        draft.clients.find((client) => client.id === clientId)?.label ??
        strangers.find((stranger) => stranger.personId === clientId)?.label ??
        words.walkIn;
      return guestSubject(label);
    };
    // SERVICES ADDED — placed serially where the ladder draws them.
    let offset = 0;
    for (const leg of draft.legs) {
      if (!before.some((entry) => entry.seatId === leg.seatId)) {
        const at = MinuteOfDay.of(draft.startMinute + offset);
        if (!at.ok) return refusedAt('startMinutes');
        const subject = subjectFor(leg.clientId);
        if (!subject.ok) return subject;
        commands.push(
          BookingCall.editAddSeat(
            leg.seatId,
            leg.serviceId,
            leg.variantId,
            leg.barberId,
            localDate,
            at.value,
            leg.minutes,
            subject.value,
          ),
        );
        // A price typed on a seat that does not exist yet: the id was minted
        // by the sheet, so the reprice can name it in the same batch.
        if (leg.typedPriceCents !== null) {
          commands.push(
            BookingCall.editReprice(leg.seatId, leg.typedPriceCents),
          );
        }
      }
      offset += leg.minutes;
    }

    /*
     * THE LADDER, PINNED. The chair-wide move below shifts every seat by ONE
     * delta measured from the earliest, and the resize stretches whichever
     * ends last — so each leg the row already holds is moved on its own
     * first, and the chair-wide commands that follow land as no-ops. A lone
     * leg needs no pin: the chair-wide move lands it exactly.
     */
    if (draft.legs.length > 1) {
      let slot = 0;
      for (const leg of draft.legs) {
        if (before.some((entry) => entry.seatId === leg.seatId)) {
          const at = MinuteOfDay.of(draft.startMinute + slot);
          if (!at.ok) return refusedAt('startMinutes');
          commands.push(
            BookingCall.editMove(localDate, at.value, [leg.seatId]),
          );
        }
        slot += leg.minutes;
      }
    }

    commands.push(
      BookingCall.editMove(localDate, start.value, scope),
      BookingCall.editResizeEnd(localDate, end.value, scope),
    );

    // A leg only earns a command when it actually differs.
    for (const leg of draft.legs) {
      const stored = row?.legs.find((entry) => entry.seatId === leg.seatId);
      if (stored === undefined) continue;
      if (leg.minutes !== stored.minutes) {
        commands.push(BookingCall.editRedurate(leg.seatId, leg.minutes));
      }
      if (leg.barberId !== stored.barberId) {
        commands.push(BookingCall.editRestaff(leg.seatId, leg.barberId));
      }
      // A REPRICED SEAT: typed money, sent when the leg's price is no
      // longer the stored one (DEP-20 — cents, never labels).
      if (
        leg.typedPriceCents !== null &&
        leg.priceCents !== stored.priceCents
      ) {
        commands.push(BookingCall.editReprice(leg.seatId, leg.typedPriceCents));
      }
    }

    /*
     * THE DISCOUNT — the bill's, not a seat's — travels only when it changed,
     * as a REFERENCE the server resolves (a grant, a code) or a figure the
     * server checks the caller may author. Cleared with an empty set. Last in
     * the batch by convention.
     */
    const draftedDiscounts = draft.discounts;
    const storedDiscounts = row?.discounts ?? [];
    // The same set of promises, whatever the order.
    const sameBill =
      draftedDiscounts.length === storedDiscounts.length &&
      draftedDiscounts.every((drafted) =>
        storedDiscounts.some((stored) =>
          DiscountSystem.samePromise(drafted, stored),
        ),
      );
    if (!sameBill) {
      const discounts: BookingCall.StaffDiscount[] = [];
      for (const discount of draftedDiscounts) {
        const request = toDiscountRequest(discount);
        if (!request.ok) return request;
        if (request.value !== null) discounts.push(request.value);
      }
      commands.push(BookingCall.editDiscounts(discounts));
    }
    // THE VOUCHERS paying the bill, by code, in cover order.
    const draftedVouchers = draft.vouchers;
    if (
      !VoucherCode.sameCover(
        draftedVouchers.map((voucher) => voucher.code),
        (row?.vouchers ?? []).map((voucher) => voucher.code),
      )
    ) {
      commands.push(
        BookingCall.editVouchers(
          draftedVouchers.map((voucher) =>
            VoucherCode.of(VoucherCode.normalize(voucher.code)),
          ),
        ),
      );
    }

    return Result.ok(commands);
  },

  /**
   * THE SEAT A TIP IS STAMPED ON — the row's first seat that the draft KEPT
   * (the batch has already run when the tip is written, and a seat it
   * removed takes a stamp with it), else the row's first seat; `null` with
   * no row or no seat. Every seat in a row is one barber's, so which carries
   * the number changes nothing about whose tip it is.
   */
  tipSeat(row: StaffEditRowFacts | null, draft: StaffEditDraft): SeatId | null {
    return (
      row?.seatIds.find((seatId) =>
        draft.legs.some((leg) => leg.seatId === seatId),
      ) ??
      row?.seatIds[0] ??
      null
    );
  },

  /**
   * THE CREATE SHEET'S BOOKING REQUEST — a visit placed by staff, in the
   * party grammar: every leg names its person; the appointment's owner is
   * the FIRST client with an account (`DraftPersonKey.accountOf`, seated
   * `SELF`); everyone else rides as a guest under their name (a stranger
   * numbered apart). Legs run serially from the drafted start, in ladder
   * order, whatever chair each sits on.
   *
   * `null` asks for nothing: a draft with no leg, or no shop (neither the
   * draft's pick nor the chair's home). A seat past the shop's midnight is
   * refused as the server refuses such a start (`BOOKING_INVALID_INPUT`,
   * `startMinutes`). The contact is the owner's — or the first named
   * person's — when it carries a number; the rebooking edge is sent only
   * while the owner is still the person the «Запиши пак» was for.
   */
  bookingRequest(
    draft: StaffEditDraft,
    create: StaffCreateContext,
    words: StaffEditWords,
  ): Result<StaffBookingRequest, PipelineError> | null {
    if (draft.legs.length === 0) return null;
    const locationId = draft.locationId ?? create.homeLocationId;
    if (!locationId) return null;
    // The placeholder and a `guest-…` key are nobody's account.
    let owner: StaffEditDraft.Client | null = null;
    let ownerUserId: UserId | null = null;
    for (const client of draft.clients) {
      const account = DraftPersonKey.accountOf(client.id);
      if (account === null) continue;
      owner = client;
      ownerUserId = account;
      break;
    }
    // Two strangers on one visit are two people: the second is numbered.
    const strangers = walkInNames(draft, [], null, words);
    const labelOf = (clientId: DraftPersonKey): string =>
      draft.clients.find((client) => client.id === clientId)?.label ??
      strangers.find((stranger) => stranger.personId === clientId)?.label ??
      words.walkIn;

    // ONE shop day for the whole visit (F-6): each seat's start a minute of it.
    const seats: BookingCall.Seat[] = [];
    let offset = 0;
    for (const leg of draft.legs) {
      const start = MinuteOfDay.of(draft.startMinute + offset);
      if (!start.ok) {
        return Result.err(
          PipelineError.of(
            PipelineErrorCode.InvalidRequest,
            BookingErrorCode.InvalidInput,
            null,
            'startMinutes',
          ),
        );
      }
      seats.push(
        BookingCall.seat(
          // A new seat's line id IS the id the sheet minted for it.
          CartLineId.of(leg.seatId),
          leg.serviceId,
          leg.variantId,
          leg.barberId,
          null,
          start.value,
          owner !== null && leg.clientId === owner.id
            ? BookingCall.selfSubject()
            : BookingCall.guestSubject(labelOf(leg.clientId), null),
        ),
      );
      offset += leg.minutes;
    }

    const contactPerson = owner ?? draft.clients[0] ?? null;
    // THE REBOOKING EDGE: a «Запиши пак» names the visit it came from,
    // unless the desk swapped the person on the way.
    const bookedFrom =
      create.bookedFrom !== null && (owner?.id ?? null) === create.clientId
        ? create.bookedFrom
        : null;
    return Result.ok({
      locationId,
      localDate: draft.dayKey,
      seats,
      contact: contactPerson?.phone
        ? {
            name: contactPerson.label,
            phone: contactPerson.phone,
            email: null,
            note: null,
          }
        : null,
      placement: Placement.Staff,
      onBehalfOfUserId: ownerUserId,
      // An empty id is no edge (the sheet's truthiness rule, kept).
      bookedFromAppointmentId:
        bookedFrom === null || bookedFrom.length === 0 ? null : bookedFrom,
    });
  },
} as const;
