import type {
  BarberId,
  LocalDate,
  LocationId,
  ServiceId,
} from '@core/primitives';

/**
 * The team callables' refusals (team onboarding D5 and D11,
 * `docs/designs/team-onboarding.md`) — adding a barber, editing their
 * profile, shops, services and prices, working period, booking access and
 * «Който и да е» flag, and deleting a draft. Flat structs discriminated by
 * `errorCode` (Law 7.5), SCREAMING_SNAKE with the `TEAM_` prefix; the
 * screen words each as `errors.<errorCode>`.
 *
 * Who may act is judged on the caller's STORED roles, account status and
 * barber link against the owner's permissions, inside the callable's
 * transaction — and refused as an `AccessError` (staff permissions P6),
 * not here.
 */
export const TeamErrorCode = {
  /** A team callable was reached without a signed-in session. */
  Unauthenticated: 'TEAM_UNAUTHENTICATED',
  /** A malformed request — `field` names the first offending one. */
  InvalidInput: 'TEAM_INVALID_INPUT',
  /** The call named an id with no barber record. */
  BarberNotFound: 'TEAM_BARBER_NOT_FOUND',
  /** The record has left the shop: only «Върни в екипа» changes it. */
  BarberDeparted: 'TEAM_BARBER_DEPARTED',
  /** A last working day before the start day. */
  PeriodInvalid: 'TEAM_PERIOD_INVALID',
  /** «Върни в екипа» named a record that has not left: there is nobody to bring back. */
  BarberNotDeparted: 'TEAM_BARBER_NOT_DEPARTED',
  /** A return that starts on or before the last day the barber worked. */
  ReturnTooEarly: 'TEAM_RETURN_TOO_EARLY',
  /** The shops name an id that is no listed location. */
  ShopUnknown: 'TEAM_SHOP_UNKNOWN',
  /** A shop cannot be removed while the barber's hours still name it. */
  ShopHasHours: 'TEAM_SHOP_HAS_HOURS',
  /** The offerings name an id that is no service. */
  ServiceUnknown: 'TEAM_SERVICE_UNKNOWN',
  /** Only a record that never went live (a `DRAFT`) can be deleted. */
  NotDraft: 'TEAM_NOT_DRAFT',
  /** The photo the call names was never uploaded by this account, or is gone. */
  PhotoMissing: 'TEAM_PHOTO_MISSING',
  /** The uploaded photo is no image the shop shows, or is too large. */
  PhotoInvalid: 'TEAM_PHOTO_INVALID',
} as const;
export type TeamErrorCode = (typeof TeamErrorCode)[keyof typeof TeamErrorCode];

export type TeamError =
  | TeamError.Unauthenticated
  | TeamError.InvalidInput
  | TeamError.BarberNotFound
  | TeamError.BarberDeparted
  | TeamError.PeriodInvalid
  | TeamError.BarberNotDeparted
  | TeamError.ReturnTooEarly
  | TeamError.ShopUnknown
  | TeamError.ShopHasHours
  | TeamError.ServiceUnknown
  | TeamError.NotDraft
  | TeamError.PhotoMissing
  | TeamError.PhotoInvalid;

export const TeamError = {
  unauthenticated(): TeamError.Unauthenticated {
    return { errorCode: TeamErrorCode.Unauthenticated };
  },
  invalidInput(field: string): TeamError.InvalidInput {
    return { errorCode: TeamErrorCode.InvalidInput, field };
  },
  barberNotFound(barberId: BarberId): TeamError.BarberNotFound {
    return { errorCode: TeamErrorCode.BarberNotFound, barberId };
  },
  barberDeparted(barberId: BarberId): TeamError.BarberDeparted {
    return { errorCode: TeamErrorCode.BarberDeparted, barberId };
  },
  periodInvalid(): TeamError.PeriodInvalid {
    return { errorCode: TeamErrorCode.PeriodInvalid };
  },
  barberNotDeparted(barberId: BarberId): TeamError.BarberNotDeparted {
    return { errorCode: TeamErrorCode.BarberNotDeparted, barberId };
  },
  returnTooEarly(lastLocalDate: LocalDate): TeamError.ReturnTooEarly {
    return { errorCode: TeamErrorCode.ReturnTooEarly, lastLocalDate };
  },
  shopUnknown(locationId: LocationId): TeamError.ShopUnknown {
    return { errorCode: TeamErrorCode.ShopUnknown, locationId };
  },
  shopHasHours(locationId: LocationId): TeamError.ShopHasHours {
    return { errorCode: TeamErrorCode.ShopHasHours, locationId };
  },
  serviceUnknown(serviceId: ServiceId): TeamError.ServiceUnknown {
    return { errorCode: TeamErrorCode.ServiceUnknown, serviceId };
  },
  notDraft(barberId: BarberId): TeamError.NotDraft {
    return { errorCode: TeamErrorCode.NotDraft, barberId };
  },
  photoMissing(): TeamError.PhotoMissing {
    return { errorCode: TeamErrorCode.PhotoMissing };
  },
  photoInvalid(): TeamError.PhotoInvalid {
    return { errorCode: TeamErrorCode.PhotoInvalid };
  },
} as const;

export namespace TeamError {
  export type Unauthenticated = {
    readonly errorCode: typeof TeamErrorCode.Unauthenticated;
  };
  export type InvalidInput = {
    readonly errorCode: typeof TeamErrorCode.InvalidInput;
    /** The request field at fault (`name`, `locationIds`, `offerings`, …). */
    readonly field: string;
  };
  export type BarberNotFound = {
    readonly errorCode: typeof TeamErrorCode.BarberNotFound;
    readonly barberId: BarberId;
  };
  export type BarberDeparted = {
    readonly errorCode: typeof TeamErrorCode.BarberDeparted;
    readonly barberId: BarberId;
  };
  export type PeriodInvalid = {
    readonly errorCode: typeof TeamErrorCode.PeriodInvalid;
  };
  export type BarberNotDeparted = {
    readonly errorCode: typeof TeamErrorCode.BarberNotDeparted;
    readonly barberId: BarberId;
  };
  export type ReturnTooEarly = {
    readonly errorCode: typeof TeamErrorCode.ReturnTooEarly;
    /** The last day the barber worked: the new start has to be after it. */
    readonly lastLocalDate: LocalDate;
  };
  export type ShopUnknown = {
    readonly errorCode: typeof TeamErrorCode.ShopUnknown;
    /** The id that named no listed location. */
    readonly locationId: LocationId;
  };
  export type ShopHasHours = {
    readonly errorCode: typeof TeamErrorCode.ShopHasHours;
    /** The shop the barber's current or coming hours still name. */
    readonly locationId: LocationId;
  };
  export type ServiceUnknown = {
    readonly errorCode: typeof TeamErrorCode.ServiceUnknown;
    /** The id that named no service. */
    readonly serviceId: ServiceId;
  };
  export type NotDraft = {
    readonly errorCode: typeof TeamErrorCode.NotDraft;
    readonly barberId: BarberId;
  };
  export type PhotoMissing = {
    readonly errorCode: typeof TeamErrorCode.PhotoMissing;
  };
  export type PhotoInvalid = {
    readonly errorCode: typeof TeamErrorCode.PhotoInvalid;
  };
}
