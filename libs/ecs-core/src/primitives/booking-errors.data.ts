import type { MinuteCount } from './duration-minutes.primitive';
import { BarberId, LocationId, ServiceId } from './ids.primitive';
import type { LocalDate } from './local-date.primitive';
import type { MinuteOfDay } from './minute-of-day.primitive';
import type { SchedulingError } from './scheduling-errors.data';

/**
 * The booking commit's refusals — the codes of `commit-booking.errors.ts` and
 * `decide-booking.errors.ts` as flat structs discriminated by `errorCode`
 * (Law 7.5). The values are SCREAMING_SNAKE with the `BOOKING_` prefix
 * (flatten-spec §4.2, owner-locked: the commit dictionary drops `COMMIT`, so
 * `booking.commit.slot_unavailable` is `BOOKING_SLOT_UNAVAILABLE`); the
 * callable edge still sends the legacy dotted code on the wire until Phase 4
 * (§4.3). Admission (`PartyAdmissionSystem`) is the lowest system that
 * refuses with them; `BookingDecisionSystem` and `MoveSystem` re-use them.
 *
 * Every field beside `errorCode` is an i18n parameter: an i18n-safe scalar
 * (ids and coordinates under their brands), except
 * `invariantViolated.violations`, which carries the aggregate's own
 * scheduling refusals in its order. The UI resolves `errors.<errorCode>`.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const BookingErrorCode = {
  Unauthenticated: 'BOOKING_UNAUTHENTICATED',
  InvalidInput: 'BOOKING_INVALID_INPUT',
  UnknownService: 'BOOKING_UNKNOWN_SERVICE',
  ServiceNotAtLocation: 'BOOKING_SERVICE_NOT_AT_LOCATION',
  ConflictingServices: 'BOOKING_CONFLICTING_SERVICES',
  BarberNotRostered: 'BOOKING_BARBER_NOT_ROSTERED',
  SlotUnavailable: 'BOOKING_SLOT_UNAVAILABLE',
  TooSoon: 'BOOKING_TOO_SOON',
  BeyondHorizon: 'BOOKING_BEYOND_HORIZON',
  PartyTooLarge: 'BOOKING_PARTY_TOO_LARGE',
  InvariantViolated: 'BOOKING_INVARIANT_VIOLATED',
} as const;
export type BookingErrorCode =
  (typeof BookingErrorCode)[keyof typeof BookingErrorCode];

/**
 * The `field` an `invalid_input` names that carries a reason of its own —
 * the legacy subclasses of `CommitBookingInvalidInputError`, which ride the
 * wire as `{ field }` alone. The values are i18n key SEGMENTS and wire params
 * (`errors.BOOKING_INVALID_INPUT.person_overlap`), so they keep their
 * spelling (flatten-spec §4.1).
 */
export const BookingErrorField = {
  /** `CommitBookingShopUnavailableError` — `detail` is the location id, `reason` why. */
  LocationId: 'locationId',
  /** `CommitBookingPersonDoubleBookedError` — `detail` is the person key. */
  PersonOverlap: 'person_overlap',
  /** `CommitBookingDuplicateGuestLabelError` — `detail` is the label. */
  GuestLabel: 'guest_label',
} as const;
export type BookingErrorField =
  (typeof BookingErrorField)[keyof typeof BookingErrorField];

/** Why a shop named by a request cannot take it — a wire refinement, spelled as today (§4.1). */
export const ShopUnavailableReason = {
  NotFound: 'not_found',
  Unlisted: 'unlisted',
} as const;
export type ShopUnavailableReason =
  (typeof ShopUnavailableReason)[keyof typeof ShopUnavailableReason];

export type BookingError =
  | BookingError.InvalidInput
  | BookingError.Unauthenticated
  | BookingError.UnknownService
  | BookingError.ServiceNotAtLocation
  | BookingError.ConflictingServices
  | BookingError.BarberNotRostered
  | BookingError.SlotUnavailable
  | BookingError.TooSoon
  | BookingError.BeyondHorizon
  | BookingError.PartyTooLarge
  | BookingError.InvariantViolated;

const E = BookingErrorCode;

/**
 * The factories — one per refusal, so no call site spells a code. An id a
 * refusal echoes may be the raw request text (an unknown service is not a
 * catalogue row): it is carried under its brand as given.
 */
export const BookingError = {
  invalidInput(field: string): BookingError.InvalidInput {
    return { errorCode: E.InvalidInput, field, detail: null, reason: null };
  },
  shopUnavailable(
    locationId: string,
    reason: ShopUnavailableReason,
  ): BookingError.InvalidInput {
    return {
      errorCode: E.InvalidInput,
      field: BookingErrorField.LocationId,
      detail: locationId,
      reason,
    };
  },
  personDoubleBooked(personKey: string): BookingError.InvalidInput {
    return {
      errorCode: E.InvalidInput,
      field: BookingErrorField.PersonOverlap,
      detail: personKey,
      reason: null,
    };
  },
  duplicateGuestLabel(label: string): BookingError.InvalidInput {
    return {
      errorCode: E.InvalidInput,
      field: BookingErrorField.GuestLabel,
      detail: label,
      reason: null,
    };
  },
  unauthenticated(): BookingError.Unauthenticated {
    return { errorCode: E.Unauthenticated };
  },
  unknownService(serviceId: string): BookingError.UnknownService {
    return { errorCode: E.UnknownService, serviceId: ServiceId.of(serviceId) };
  },
  serviceNotAtLocation(
    serviceId: string,
    locationId: string,
  ): BookingError.ServiceNotAtLocation {
    return {
      errorCode: E.ServiceNotAtLocation,
      serviceId: ServiceId.of(serviceId),
      locationId: LocationId.of(locationId),
    };
  },
  conflictingServices(
    first: ServiceId,
    second: ServiceId,
  ): BookingError.ConflictingServices {
    return { errorCode: E.ConflictingServices, first, second };
  },
  barberNotRostered(
    barberId: BarberId,
    localDate: LocalDate,
  ): BookingError.BarberNotRostered {
    return { errorCode: E.BarberNotRostered, barberId, localDate };
  },
  slotUnavailable(
    barberId: BarberId,
    localDate: LocalDate,
    startMinutes: MinuteOfDay,
    seatIndex: number,
  ): BookingError.SlotUnavailable {
    return {
      errorCode: E.SlotUnavailable,
      barberId,
      localDate,
      startMinutes,
      seatIndex,
    };
  },
  tooSoon(minLeadMinutes: MinuteCount): BookingError.TooSoon {
    return { errorCode: E.TooSoon, minLeadMinutes };
  },
  beyondHorizon(horizonMonths: number): BookingError.BeyondHorizon {
    return { errorCode: E.BeyondHorizon, horizonMonths };
  },
  partyTooLarge(maxPartySize: number): BookingError.PartyTooLarge {
    return { errorCode: E.PartyTooLarge, maxPartySize };
  },
  invariantViolated(
    violations: readonly SchedulingError[],
  ): BookingError.InvariantViolated {
    return { errorCode: E.InvariantViolated, violations };
  },
} as const;

export namespace BookingError {
  /**
   * `BOOKING_INVALID_INPUT`: the request as sent can never succeed. `field`
   * names the input; `detail` and `reason` are `null` except for the three
   * refusals of {@link BookingErrorField} (one shape for every
   * `invalid_input`, so every value shares one hidden class).
   */
  export type InvalidInput = {
    readonly errorCode: typeof BookingErrorCode.InvalidInput;
    readonly field: string;
    readonly detail: string | null;
    readonly reason: string | null;
  };
  export type Unauthenticated = {
    readonly errorCode: typeof BookingErrorCode.Unauthenticated;
  };
  export type UnknownService = {
    readonly errorCode: typeof BookingErrorCode.UnknownService;
    readonly serviceId: ServiceId;
  };
  export type ServiceNotAtLocation = {
    readonly errorCode: typeof BookingErrorCode.ServiceNotAtLocation;
    readonly serviceId: ServiceId;
    readonly locationId: LocationId;
  };
  export type ConflictingServices = {
    readonly errorCode: typeof BookingErrorCode.ConflictingServices;
    readonly first: ServiceId;
    readonly second: ServiceId;
  };
  /** The shop day the barber has no roster on (was the instant's `dayKey`). */
  export type BarberNotRostered = {
    readonly errorCode: typeof BookingErrorCode.BarberNotRostered;
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
  };
  /**
   * `seatIndex` is the request seat the refusal is about; `localDate` +
   * `startMinutes` its requested start on the shop's wall clock (the edge
   * renders the legacy `startIso` param from them with the location's zone).
   */
  export type SlotUnavailable = {
    readonly errorCode: typeof BookingErrorCode.SlotUnavailable;
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
    readonly startMinutes: MinuteOfDay;
    readonly seatIndex: number;
  };
  export type TooSoon = {
    readonly errorCode: typeof BookingErrorCode.TooSoon;
    readonly minLeadMinutes: MinuteCount;
  };
  export type BeyondHorizon = {
    readonly errorCode: typeof BookingErrorCode.BeyondHorizon;
    readonly horizonMonths: number;
  };
  export type PartyTooLarge = {
    readonly errorCode: typeof BookingErrorCode.PartyTooLarge;
    readonly maxPartySize: number;
  };
  /** The appointment refused its own invariants — every violation, in the aggregate's order. */
  export type InvariantViolated = {
    readonly errorCode: typeof BookingErrorCode.InvariantViolated;
    readonly violations: readonly SchedulingError[];
  };
}
