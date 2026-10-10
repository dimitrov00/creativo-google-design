import type { SchedulingError } from './scheduling-errors.data';

/**
 * The booking commit's refusals — the `booking.commit.*` codes of
 * `commit-booking.errors.ts` and `decide-booking.errors.ts`, unchanged on the
 * wire, as plain structs. Admission (`PartyAdmissionSystem`) is the lowest
 * system that refuses with them; `BookingDecisionSystem` and `MoveSystem`
 * re-use them.
 *
 * Every non-`code` field is an i18n parameter: an i18n-safe scalar, except
 * `invariantViolated.violations`, which carries the aggregate's own
 * scheduling refusals in its order.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const BookingCommitErrorCode = {
  Unauthenticated: 'booking.commit.unauthenticated',
  InvalidInput: 'booking.commit.invalid_input',
  UnknownService: 'booking.commit.unknown_service',
  ServiceNotAtLocation: 'booking.commit.service_not_at_location',
  ConflictingServices: 'booking.commit.conflicting_services',
  BarberNotRostered: 'booking.commit.barber_not_rostered',
  SlotUnavailable: 'booking.commit.slot_unavailable',
  TooSoon: 'booking.commit.too_soon',
  BeyondHorizon: 'booking.commit.beyond_horizon',
  PartyTooLarge: 'booking.commit.party_too_large',
  InvariantViolated: 'booking.commit.invariant_violated',
} as const;
export type BookingCommitErrorCode =
  (typeof BookingCommitErrorCode)[keyof typeof BookingCommitErrorCode];

/**
 * The `field` an `invalid_input` names that carries a reason of its own —
 * the legacy subclasses of `CommitBookingInvalidInputError`, which ride the
 * wire as `{ field }` alone.
 */
export const BookingCommitField = {
  /** `CommitBookingShopUnavailableError` — `detail` is the location id, `reason` why. */
  LocationId: 'locationId',
  /** `CommitBookingPersonDoubleBookedError` — `detail` is the person key. */
  PersonOverlap: 'person_overlap',
  /** `CommitBookingDuplicateGuestLabelError` — `detail` is the label. */
  GuestLabel: 'guest_label',
} as const;
export type BookingCommitField =
  (typeof BookingCommitField)[keyof typeof BookingCommitField];

/** Why a shop named by a request cannot take it. */
export const ShopUnavailableReason = {
  NotFound: 'not_found',
  Unlisted: 'unlisted',
} as const;
export type ShopUnavailableReason =
  (typeof ShopUnavailableReason)[keyof typeof ShopUnavailableReason];

export type BookingCommitError =
  | BookingCommitError.InvalidInput
  | BookingCommitError.Unauthenticated
  | BookingCommitError.UnknownService
  | BookingCommitError.ServiceNotAtLocation
  | BookingCommitError.ConflictingServices
  | BookingCommitError.BarberNotRostered
  | BookingCommitError.SlotUnavailable
  | BookingCommitError.TooSoon
  | BookingCommitError.BeyondHorizon
  | BookingCommitError.PartyTooLarge
  | BookingCommitError.InvariantViolated;

const E = BookingCommitErrorCode;

/** The factories — one per refusal, so no call site spells a code. */
export const BookingCommitError = {
  invalidInput(field: string): BookingCommitError.InvalidInput {
    return { code: E.InvalidInput, field, detail: null, reason: null };
  },
  shopUnavailable(
    locationId: string,
    reason: ShopUnavailableReason,
  ): BookingCommitError.InvalidInput {
    return {
      code: E.InvalidInput,
      field: BookingCommitField.LocationId,
      detail: locationId,
      reason,
    };
  },
  personDoubleBooked(personKey: string): BookingCommitError.InvalidInput {
    return {
      code: E.InvalidInput,
      field: BookingCommitField.PersonOverlap,
      detail: personKey,
      reason: null,
    };
  },
  duplicateGuestLabel(label: string): BookingCommitError.InvalidInput {
    return {
      code: E.InvalidInput,
      field: BookingCommitField.GuestLabel,
      detail: label,
      reason: null,
    };
  },
  unauthenticated(): BookingCommitError.Unauthenticated {
    return { code: E.Unauthenticated };
  },
  unknownService(serviceId: string): BookingCommitError.UnknownService {
    return { code: E.UnknownService, serviceId };
  },
  serviceNotAtLocation(
    serviceId: string,
    locationId: string,
  ): BookingCommitError.ServiceNotAtLocation {
    return { code: E.ServiceNotAtLocation, serviceId, locationId };
  },
  conflictingServices(
    first: string,
    second: string,
  ): BookingCommitError.ConflictingServices {
    return { code: E.ConflictingServices, first, second };
  },
  barberNotRostered(
    barberId: string,
    dayKey: string,
  ): BookingCommitError.BarberNotRostered {
    return { code: E.BarberNotRostered, barberId, dayKey };
  },
  slotUnavailable(
    barberId: string,
    startMs: number,
    seatIndex: number,
  ): BookingCommitError.SlotUnavailable {
    return { code: E.SlotUnavailable, barberId, startMs, seatIndex };
  },
  tooSoon(minLeadMinutes: number): BookingCommitError.TooSoon {
    return { code: E.TooSoon, minLeadMinutes };
  },
  beyondHorizon(horizonMonths: number): BookingCommitError.BeyondHorizon {
    return { code: E.BeyondHorizon, horizonMonths };
  },
  partyTooLarge(maxPartySize: number): BookingCommitError.PartyTooLarge {
    return { code: E.PartyTooLarge, maxPartySize };
  },
  invariantViolated(
    violations: readonly SchedulingError[],
  ): BookingCommitError.InvariantViolated {
    return { code: E.InvariantViolated, violations };
  },
} as const;

export namespace BookingCommitError {
  /**
   * `invalid_input`: the request as sent can never succeed. `field` names the
   * input; `detail` and `reason` are `null` except for the three refusals of
   * {@link BookingCommitField} (one shape for every `invalid_input`, so every
   * value shares one hidden class).
   */
  export type InvalidInput = {
    readonly code: typeof BookingCommitErrorCode.InvalidInput;
    readonly field: string;
    readonly detail: string | null;
    readonly reason: string | null;
  };
  export type Unauthenticated = {
    readonly code: typeof BookingCommitErrorCode.Unauthenticated;
  };
  export type UnknownService = {
    readonly code: typeof BookingCommitErrorCode.UnknownService;
    readonly serviceId: string;
  };
  export type ServiceNotAtLocation = {
    readonly code: typeof BookingCommitErrorCode.ServiceNotAtLocation;
    readonly serviceId: string;
    readonly locationId: string;
  };
  export type ConflictingServices = {
    readonly code: typeof BookingCommitErrorCode.ConflictingServices;
    readonly first: string;
    readonly second: string;
  };
  export type BarberNotRostered = {
    readonly code: typeof BookingCommitErrorCode.BarberNotRostered;
    readonly barberId: string;
    readonly dayKey: string;
  };
  /** `seatIndex` is the request seat the refusal is about (the wire's `startIso` is that seat's). */
  export type SlotUnavailable = {
    readonly code: typeof BookingCommitErrorCode.SlotUnavailable;
    readonly barberId: string;
    readonly startMs: number;
    readonly seatIndex: number;
  };
  export type TooSoon = {
    readonly code: typeof BookingCommitErrorCode.TooSoon;
    readonly minLeadMinutes: number;
  };
  export type BeyondHorizon = {
    readonly code: typeof BookingCommitErrorCode.BeyondHorizon;
    readonly horizonMonths: number;
  };
  export type PartyTooLarge = {
    readonly code: typeof BookingCommitErrorCode.PartyTooLarge;
    readonly maxPartySize: number;
  };
  /** The appointment refused its own invariants — every violation, in the aggregate's order. */
  export type InvariantViolated = {
    readonly code: typeof BookingCommitErrorCode.InvariantViolated;
    readonly violations: readonly SchedulingError[];
  };
}
