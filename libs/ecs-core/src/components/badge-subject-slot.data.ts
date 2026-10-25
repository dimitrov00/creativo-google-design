import type { BarberId, LocationId, ServiceId } from '@core/primitives';

/** What a family is about — the family's field `badgeSubject` (`null` = about nothing). */
export const BadgeSubject = {
  Service: 'SERVICE',
  Barber: 'BARBER',
  Location: 'LOCATION',
} as const;
export type BadgeSubject = (typeof BadgeSubject)[keyof typeof BadgeSubject];

/**
 * The catalogue thing a family is about — a variant SLICE at the root of
 * the family (F-26), discriminated by `badgeSubject` (`null` = about
 * nothing). Each variant declares only its own id, so no system can read a
 * `subjectServiceId` off a BARBER family. Its art — the barber's face, the
 * service's or shop's cover — comes from it.
 */
export type BadgeSubjectSlot =
  | BadgeSubjectSlot.None
  | BadgeSubjectSlot.Service
  | BadgeSubjectSlot.Barber
  | BadgeSubjectSlot.Location;

export const BadgeSubjectSlot = {
  none(): BadgeSubjectSlot.None {
    return { badgeSubject: null };
  },
  service(subjectServiceId: ServiceId): BadgeSubjectSlot.Service {
    return { badgeSubject: BadgeSubject.Service, subjectServiceId };
  },
  barber(subjectBarberId: BarberId): BadgeSubjectSlot.Barber {
    return { badgeSubject: BadgeSubject.Barber, subjectBarberId };
  },
  location(subjectLocationId: LocationId): BadgeSubjectSlot.Location {
    return { badgeSubject: BadgeSubject.Location, subjectLocationId };
  },
} as const;

export namespace BadgeSubjectSlot {
  /** About nothing in particular (today's `subject: null`). */
  export type None = { readonly badgeSubject: null };
  export type Service = {
    readonly badgeSubject: typeof BadgeSubject.Service;
    readonly subjectServiceId: ServiceId;
  };
  export type Barber = {
    readonly badgeSubject: typeof BadgeSubject.Barber;
    readonly subjectBarberId: BarberId;
  };
  export type Location = {
    readonly badgeSubject: typeof BadgeSubject.Location;
    readonly subjectLocationId: LocationId;
  };
}
