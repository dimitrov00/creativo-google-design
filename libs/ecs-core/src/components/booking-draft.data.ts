import { AppointmentId, LocalDate, UserId } from '@core/primitives';
import { BookingContact } from './booking-contact.data';
import { BookingFlowState, BookingFlowStep } from './booking-flow.data';
import { ChairTime } from './chair-time.data';
import { MoveRider } from './move-rider.data';

/**
 * Where a booking draft came from — the field `bookingDraftOrigin`, the ONLY
 * source of these strings (Phase 4a 4A-9): a fresh booking, a rebooking of
 * a past visit (`BOOKED_FROM`, an analytics edge), or a client moving a
 * visit (`RESCHEDULE`, with the seats the server carries and the chairs it
 * hands back).
 */
export const BookingDraftOrigin = {
  Fresh: 'FRESH',
  BookedFrom: 'BOOKED_FROM',
  Reschedule: 'RESCHEDULE',
} as const;
export type BookingDraftOrigin =
  (typeof BookingDraftOrigin)[keyof typeof BookingDraftOrigin];

/**
 * THE BOOKING DRAFT — the `/book` flow as the session keeps it across a
 * reload (`BOOKING_DRAFT_PORTS`, `sessionStorage`), ONE flat component
 * (Law 6): the flow's own state, the contact slice at the root (its fields
 * already prefixed; no contact = `BookingContact.NONE`), the day the client
 * was looking at (`draftLocalDate`, `null` before one is picked), and where
 * the draft came from as flat variants on `bookingDraftOrigin` — never a
 * wrapper, never a null-presence tag. A `RESCHEDULE` keeps its riders and
 * the chairs it releases on `rescheduleLocalDate`'s wall clock (minutes,
 * never instants). No zone: the zone is the location's (Law 7.2).
 */
export type BookingDraft = BookingFlowState &
  BookingContact &
  BookingDraft.Origin & {
    readonly draftLocalDate: LocalDate | null;
  };

/** One own field of a stored value, `undefined` when it has none. */
function fieldOf(raw: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(raw, name)?.value;
}

/** A non-empty id the brand's smart constructor accepts. */
function idOf<T>(
  raw: unknown,
  parse: (
    raw: string,
  ) => { readonly ok: true; readonly value: T } | { readonly ok: false },
): T | null {
  if (typeof raw !== 'string') return null;
  const parsed = parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** A contact slice read back: every key present, a text or `null`. */
function contactOk(fields: object): boolean {
  for (const key of [
    'contactName',
    'contactPhone',
    'contactEmail',
    'contactNote',
  ]) {
    const value = fieldOf(fields, key);
    if (value !== null && typeof value !== 'string') return false;
  }
  return true;
}

/**
 * The origin a stored draft holds, checked — the booking store's
 * `heldSource` / `heldMove` rules, lifted: a `BOOKED_FROM` that does not
 * parse reads as `FRESH` (the rebooking edge is dropped, the draft kept); a
 * `RESCHEDULE` is all or nothing — a rider or a chair that does not parse
 * makes the whole draft unreadable (`null`), because kept without the move
 * the bag would commit as a second booking beside the visit, and kept with
 * half of it the grid would decide on a visit that does not exist. The move
 * link lands it again from the live visit.
 */
function originOf(fields: object): BookingDraft.Origin | null {
  switch (fieldOf(fields, 'bookingDraftOrigin')) {
    case BookingDraftOrigin.BookedFrom: {
      const appointmentId = idOf(
        fieldOf(fields, 'bookedFromAppointmentId'),
        AppointmentId.parse,
      );
      const ownerUserId = idOf(
        fieldOf(fields, 'bookedFromOwnerUserId'),
        UserId.parse,
      );
      return appointmentId !== null && ownerUserId !== null
        ? BookingDraft.bookedFromOrigin(appointmentId, ownerUserId)
        : FRESH;
    }
    case BookingDraftOrigin.Reschedule: {
      const appointmentId = idOf(
        fieldOf(fields, 'rescheduleAppointmentId'),
        AppointmentId.parse,
      );
      const ownerUserId = idOf(
        fieldOf(fields, 'rescheduleOwnerUserId'),
        UserId.parse,
      );
      const localDate = idOf(
        fieldOf(fields, 'rescheduleLocalDate'),
        LocalDate.parse,
      );
      const riders: unknown = fieldOf(fields, 'rescheduleRiders');
      const release: unknown = fieldOf(fields, 'rescheduleRelease');
      if (
        appointmentId === null ||
        ownerUserId === null ||
        localDate === null ||
        !Array.isArray(riders) ||
        !riders.every((rider: unknown) => MoveRider.is(rider)) ||
        !Array.isArray(release) ||
        !release.every((chair: unknown) => ChairTime.is(chair))
      ) {
        return null;
      }
      return BookingDraft.rescheduleOrigin(
        appointmentId,
        ownerUserId,
        localDate,
        riders as readonly MoveRider[],
        release as readonly ChairTime[],
      );
    }
    default:
      return FRESH;
  }
}

const FRESH: BookingDraft.Fresh = {
  bookingDraftOrigin: BookingDraftOrigin.Fresh,
};

export const BookingDraft = {
  bookedFromOrigin(
    bookedFromAppointmentId: AppointmentId,
    bookedFromOwnerUserId: UserId,
  ): BookingDraft.BookedFrom {
    return {
      bookingDraftOrigin: BookingDraftOrigin.BookedFrom,
      bookedFromAppointmentId,
      bookedFromOwnerUserId,
    };
  },

  rescheduleOrigin(
    rescheduleAppointmentId: AppointmentId,
    rescheduleOwnerUserId: UserId,
    rescheduleLocalDate: LocalDate,
    rescheduleRiders: readonly MoveRider[],
    rescheduleRelease: readonly ChairTime[],
  ): BookingDraft.Reschedule {
    return {
      bookingDraftOrigin: BookingDraftOrigin.Reschedule,
      rescheduleAppointmentId,
      rescheduleOwnerUserId,
      rescheduleLocalDate,
      rescheduleRiders,
      rescheduleRelease,
    };
  },

  /** A fresh draft: the flow, its contact, the day looked at. */
  fresh(
    state: BookingFlowState,
    contact: BookingContact,
    draftLocalDate: LocalDate | null,
  ): BookingDraft {
    return { ...state, ...contact, ...FRESH, draftLocalDate };
  },

  /** A draft that rebooks a past visit. */
  bookedFrom(
    state: BookingFlowState,
    contact: BookingContact,
    draftLocalDate: LocalDate | null,
    origin: BookingDraft.BookedFrom,
  ): BookingDraft {
    return { ...state, ...contact, ...origin, draftLocalDate };
  },

  /** A draft that moves a visit. */
  reschedule(
    state: BookingFlowState,
    contact: BookingContact,
    draftLocalDate: LocalDate | null,
    origin: BookingDraft.Reschedule,
  ): BookingDraft {
    return { ...state, ...contact, ...origin, draftLocalDate };
  },

  /**
   * THE RESTORE READ — a stored value as the draft it restores to, or
   * `null` when it is none. A draft needs a flow state that passes
   * `BookingFlowState.is`, its contact slice (each key a text or `null`)
   * and a day that is a `LocalDate` or `null`. The origin is read the way
   * the store read its held source and move: a rebooking edge that does not
   * parse is dropped to `FRESH`; a move that does not parse whole leaves no
   * draft at all (`null` — the adapter clears it). Draft adapters read
   * through this, never a cast.
   */
  read(raw: unknown): BookingDraft | null {
    if (!BookingFlowState.is(raw)) return null;
    const fields: object = raw;
    if (!contactOk(fields)) return null;
    const day = fieldOf(fields, 'draftLocalDate');
    const draftLocalDate = day === null ? null : idOf(day, LocalDate.parse);
    if (day !== null && draftLocalDate === null) return null;
    const contact: BookingContact = {
      contactName: textOf(fieldOf(fields, 'contactName')),
      contactPhone: textOf(
        fieldOf(fields, 'contactPhone'),
      ) as BookingContact['contactPhone'],
      contactEmail: textOf(
        fieldOf(fields, 'contactEmail'),
      ) as BookingContact['contactEmail'],
      contactNote: textOf(fieldOf(fields, 'contactNote')),
    };
    const origin = originOf(fields);
    if (origin === null) return null;
    return { ...stateOnly(raw), ...contact, ...origin, draftLocalDate };
  },

  /**
   * The strict guard: the value IS a draft as stored, its origin included
   * (a malformed rebooking edge is no draft here — {@link BookingDraft.read}
   * restores it as `FRESH`).
   */
  is(raw: unknown): raw is BookingDraft {
    const read = BookingDraft.read(raw);
    return (
      read !== null &&
      read.bookingDraftOrigin === fieldOf(raw as object, 'bookingDraftOrigin')
    );
  },
} as const;

/** A stored text, or `null`. */
function textOf(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

/** The flow state's own fields of a value that carries more (a stored draft). */
function stateOnly(value: BookingFlowState): BookingFlowState {
  switch (value.bookingFlowStep) {
    case BookingFlowStep.Location:
      return {
        bookingFlowStep: value.bookingFlowStep,
        party: value.party,
        cart: value.cart,
        locationId: value.locationId,
      };
    case BookingFlowStep.Services:
      return {
        bookingFlowStep: value.bookingFlowStep,
        party: value.party,
        cart: value.cart,
        locationId: value.locationId,
      };
    case BookingFlowStep.Schedule:
      return {
        bookingFlowStep: value.bookingFlowStep,
        party: value.party,
        cart: value.cart,
        locationId: value.locationId,
        when: value.when,
      };
    case BookingFlowStep.Review:
      return {
        bookingFlowStep: value.bookingFlowStep,
        party: value.party,
        cart: value.cart,
        selection: value.selection,
      };
    case BookingFlowStep.Confirmed:
      return {
        bookingFlowStep: value.bookingFlowStep,
        confirmation: value.confirmation,
      };
    case BookingFlowStep.Waitlisted:
      return { bookingFlowStep: value.bookingFlowStep, summary: value.summary };
  }
}

export namespace BookingDraft {
  /** Where the draft came from — one of three flat variants. */
  export type Origin = Fresh | BookedFrom | Reschedule;
  export type Fresh = {
    readonly bookingDraftOrigin: typeof BookingDraftOrigin.Fresh;
  };
  export type BookedFrom = {
    readonly bookingDraftOrigin: typeof BookingDraftOrigin.BookedFrom;
    /** The visit rebooked — an analytics edge, no authority. */
    readonly bookedFromAppointmentId: AppointmentId;
    /** Whose visit it was — the draft is that account's alone. */
    readonly bookedFromOwnerUserId: UserId;
  };
  export type Reschedule = {
    readonly bookingDraftOrigin: typeof BookingDraftOrigin.Reschedule;
    readonly rescheduleAppointmentId: AppointmentId;
    readonly rescheduleOwnerUserId: UserId;
    /** The shop day the visit stands on now — the chairs' day. */
    readonly rescheduleLocalDate: LocalDate;
    /** The seats the server carries along (1-to-N). */
    readonly rescheduleRiders: readonly MoveRider[];
    /** The chairs the visit holds, handed back before it is placed again (1-to-N). */
    readonly rescheduleRelease: readonly ChairTime[];
  };
}
