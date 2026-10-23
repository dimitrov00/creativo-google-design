/**
 * Compile-time-only checks of the booking-core group's `as const` tag
 * dictionaries (flatten-spec §7, §8.1: the group's own split of
 * `dictionaries.type-spec.ts`) — no runtime `expect()`/`it()`; `nx
 * typecheck` runs it through `tsconfig.spec.json`.
 *
 * 1. **`satisfies`** — each dictionary's values are of its type.
 * 2. **Holds** — the type is EXACTLY the dictionary's values, and no two
 *    keys share a value.
 * 3. **SCREAMING** — every value is upper-snake (N7/N8), except the external
 *    contracts of §0.4 the group owns: `Locale` (locale codes),
 *    `BookingErrorField` (wire field names the clients key their copy by)
 *    and `ShopUnavailableReason` (a wire `reason` param).
 * 4. **N15 pair lines** (L8, read by `tools/lint-rules/dictionary-fields
 *    .spec.mjs`) — each discriminator and plain tag field is named
 *    `camelCase(Dictionary)`, and its type is exactly the dictionary.
 */
import type { Barber, Service, ShopLocation } from '@core/entities';
import { Selectability, type ServiceSelectability } from '@core/systems';
import { type BookingCall, RequestedSubjectRole } from './booking-call.data';
import { type BarberPref, BarberPreference } from './barber-pref.data';
import { Locale } from '@core/primitives';
import {
  BookingErrorCode,
  BookingErrorField,
  ShopUnavailableReason,
  type CatalogError,
  CatalogErrorCode,
  GeoAxis,
  MediaDimension,
} from '@core/errors';
import {
  BarberStatus,
  LocationStatus,
  ServiceStatus,
} from './catalog-status.data';
import { BlockKind, type MinuteBlock } from './minute-block.data';
import {
  type ClockDayHours,
  type DayHours,
  OpeningState,
} from './opening-hours.data';
import { Placement } from './placement-kind.data';
import {
  CompositionKind,
  type ServiceComposition,
} from './service-composition.data';

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
type Screaming<V extends string> = [V] extends [Uppercase<V>] ? true : false;

/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(BarberPreference satisfies Dictionary<BarberPreference>);
dictionary(BookingErrorCode satisfies Dictionary<BookingErrorCode>);
dictionary(BookingErrorField satisfies Dictionary<BookingErrorField>);
dictionary(ShopUnavailableReason satisfies Dictionary<ShopUnavailableReason>);
dictionary(CatalogErrorCode satisfies Dictionary<CatalogErrorCode>);
dictionary(MediaDimension satisfies Dictionary<MediaDimension>);
dictionary(GeoAxis satisfies Dictionary<GeoAxis>);
dictionary(ServiceStatus satisfies Dictionary<ServiceStatus>);
dictionary(BarberStatus satisfies Dictionary<BarberStatus>);
dictionary(LocationStatus satisfies Dictionary<LocationStatus>);
dictionary(Locale satisfies Dictionary<Locale>);
dictionary(BlockKind satisfies Dictionary<BlockKind>);
dictionary(OpeningState satisfies Dictionary<OpeningState>);
dictionary(Placement satisfies Readonly<Record<'Self' | 'Staff', Placement>>);
dictionary(CompositionKind satisfies Dictionary<CompositionKind>);
dictionary(RequestedSubjectRole satisfies Dictionary<RequestedSubjectRole>);
dictionary(Selectability satisfies Dictionary<Selectability>);

// (2) Holds — each type is exactly its dictionary's values, one key each.
export type BookingCoreDictionariesHold = [
  Expect<Holds<typeof BarberPreference, BarberPreference>>, // components/barber-pref.data.ts
  Expect<Holds<typeof BookingErrorCode, BookingErrorCode>>, // errors/booking.error.ts
  Expect<Holds<typeof BookingErrorField, BookingErrorField>>, // errors/booking.error.ts
  Expect<Holds<typeof ShopUnavailableReason, ShopUnavailableReason>>, // errors/booking.error.ts
  Expect<Holds<typeof CatalogErrorCode, CatalogErrorCode>>, // errors/catalog.error.ts
  Expect<Holds<typeof MediaDimension, MediaDimension>>, // errors/catalog.error.ts
  Expect<Holds<typeof GeoAxis, GeoAxis>>, // errors/catalog.error.ts
  Expect<Holds<typeof ServiceStatus, ServiceStatus>>, // components/catalog-status.data.ts
  Expect<Holds<typeof BarberStatus, BarberStatus>>, // components/catalog-status.data.ts
  Expect<Holds<typeof LocationStatus, LocationStatus>>, // components/catalog-status.data.ts
  Expect<Holds<typeof Locale, Locale>>, // primitives/locale.data.ts
  Expect<Holds<typeof BlockKind, BlockKind>>, // components/minute-block.data.ts
  Expect<Holds<typeof OpeningState, OpeningState>>, // components/opening-hours.data.ts
  Expect<Holds<Pick<typeof Placement, 'Self' | 'Staff'>, Placement>>, // components/placement-kind.data.ts
  Expect<Holds<typeof CompositionKind, CompositionKind>>, // components/service-composition.data.ts
  Expect<Holds<typeof RequestedSubjectRole, RequestedSubjectRole>>, // components/booking-call.data.ts
  Expect<Holds<typeof Selectability, Selectability>>, // systems/service-conflict.system.ts
];

// (3) SCREAMING values (`Locale`, `BookingErrorField` and
// `ShopUnavailableReason` are external contracts, §0.4).
export type BookingCoreScreamingChecks = [
  Expect<Screaming<BarberPreference>>,
  Expect<Screaming<BookingErrorCode>>,
  Expect<Screaming<CatalogErrorCode>>,
  Expect<Screaming<MediaDimension>>,
  Expect<Screaming<GeoAxis>>,
  Expect<Screaming<ServiceStatus>>,
  Expect<Screaming<BarberStatus>>,
  Expect<Screaming<LocationStatus>>,
  Expect<Screaming<BlockKind>>,
  Expect<Screaming<OpeningState>>,
  Expect<Screaming<Placement>>,
  Expect<Screaming<CompositionKind>>,
  Expect<Screaming<RequestedSubjectRole>>,
  Expect<Screaming<Selectability>>,
];

// Every code of a group's error union carries the group's prefix (N8).
export type BookingCorePrefixes = [
  Expect<
    Equals<BookingErrorCode extends `BOOKING_${string}` ? true : false, true>
  >,
  Expect<
    Equals<CatalogErrorCode extends `CATALOG_${string}` ? true : false, true>
  >,
];

// (4) N15 — a dictionary's field is camelCase(Dictionary), typed exactly by it.
export type BookingCoreDictionaryFields = [
  Expect<Equals<BarberPref['barberPreference'], BarberPreference>>, // components/barber-pref.data.ts
  Expect<Equals<Barber['barberStatus'], BarberStatus>>, // entities/barber.entity.ts
  Expect<Equals<Service['serviceStatus'], ServiceStatus>>, // entities/service.entity.ts
  Expect<Equals<ShopLocation['locationStatus'], LocationStatus>>, // entities/shop-location.entity.ts
  Expect<Equals<MinuteBlock['blockKind'], BlockKind>>, // components/minute-block.data.ts
  Expect<Equals<DayHours['openingState'], OpeningState>>, // components/opening-hours.data.ts
  Expect<Equals<ClockDayHours['openingState'], OpeningState>>, // components/opening-hours.data.ts
  Expect<Equals<ServiceComposition['compositionKind'], CompositionKind>>, // components/service-composition.data.ts
  Expect<Equals<Service['compositionKind'], CompositionKind>>, // entities/service.entity.ts
  Expect<
    Equals<
      BookingCall.SubjectInput['requestedSubjectRole'],
      RequestedSubjectRole
    >
  >, // systems/guest-label.system.ts
  Expect<Equals<ServiceSelectability['selectability'], Selectability>>, // systems/service-conflict.system.ts
  Expect<Equals<CatalogError.LocationInvalidGeoCoordinate['geoAxis'], GeoAxis>>, // errors/catalog.error.ts
  Expect<
    Equals<
      CatalogError.MediaRefInvalidDimension['mediaDimension'],
      MediaDimension
    >
  >, // errors/catalog.error.ts
];

// The checks are not vacuous.
export type ProbeNotScreaming = Expect<
  // @ts-expect-error — a lower-case value fails the SCREAMING check.
  Screaming<'booking.commit.slot_unavailable'>
>;
