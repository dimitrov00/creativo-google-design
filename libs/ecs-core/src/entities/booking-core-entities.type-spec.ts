/**
 * Compile-only proofs over the booking-core group's archetypes (Laws 2 and
 * 6, flatten-spec §7 notes): each entity is the intersection of FLAT slices
 * that share no field name, the intersection is never `never`, every field
 * of every variant is a primitive, a brand, a `LocalizedText` or a 1-to-N
 * array (`NoNested`), and each discriminator narrows. `tsc` failing — on a
 * `false` constant or an unused `@ts-expect-error` — IS the test; nothing
 * here runs.
 */
import {
  type BookingPolicy,
  BarberStatus,
  LocationStatus,
  ServiceStatus,
  type GeoPoint,
  CompositionKind,
  type ServiceComposition,
  type ServiceTerms,
  type VenuePhone,
} from '@core/components';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { BarberBusyDay } from './barber-busy-day.entity';
import type { BarberLeadTimeSample } from './barber-lead-time-sample.entity';
import type { BarberSchedule } from './barber-schedule.entity';
import type { Barber, BarberAvatar, BarberMeta } from './barber.entity';
import type { BookingPolicySettings } from './booking-policy-settings.entity';
import type { CapacityMonth } from './capacity-month.entity';
import type { ServiceCategory } from './service-category.entity';
import type { Service, ServiceCover, ServiceMeta } from './service.entity';
import type {
  ShopCover,
  ShopLocation,
  ShopLocationMeta,
} from './shop-location.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── Barber = BarberMeta & BarberAvatar ──────────────────────────────── */

export const barberNotNever: IsNever<Barber> = false;
export const barberFlat: EveryVariantFlat<Barber> = true;
export const barberDisjoint: Disjoint<BarberMeta, BarberAvatar> = true;

declare const barber: Barber;
// The avatar is prefixed at the root (N9), never a nested `MediaRef`.
export const barberRoot: readonly unknown[] = [
  barber.avatarMediaId,
  barber.avatarMediaPath,
  barber.avatarMediaFocalX,
  barber.barberStatus === BarberStatus.Active,
];
// @ts-expect-error — the avatar is flattened, never nested under `avatar`
export const noAvatar: unknown = barber.avatar;
// @ts-expect-error — the status is `barberStatus` (N15), never `status`
export const noBarberStatusField: unknown = barber.status;

/* ── ShopLocation = Meta & GeoPoint & VenuePhone & ShopCover ─────────── */

export const shopLocationNotNever: IsNever<ShopLocation> = false;
export const shopLocationFlat: EveryVariantFlat<ShopLocation> = true;
export const shopLocationDisjoint: [
  Disjoint<ShopLocationMeta, GeoPoint>,
  Disjoint<ShopLocationMeta, VenuePhone>,
  Disjoint<ShopLocationMeta, ShopCover>,
  Disjoint<GeoPoint, VenuePhone>,
  Disjoint<GeoPoint, ShopCover>,
  Disjoint<VenuePhone, ShopCover>,
] = [true, true, true, true, true, true];

declare const shop: ShopLocation;
// Every 1-to-1 component is a root field (Law 6.1).
export const shopRoot: readonly unknown[] = [
  shop.latitude,
  shop.longitude,
  shop.phoneE164,
  shop.phoneDisplay,
  shop.coverMediaId,
  shop.timeZone,
  shop.locationStatus === LocationStatus.Active,
];
// @ts-expect-error — the coordinates are flat, never nested under `geo`
export const noGeo: unknown = shop.geo;
// @ts-expect-error — the phone is flat, never nested under `phone`
export const noPhone: unknown = shop.phone;
// @ts-expect-error — the zone is `timeZone: TimeZone` (Law 7), never `zone`
export const noShopZone: unknown = shop.zone;

/* ── Service = Meta & ServiceTerms & ServiceComposition & ServiceCover ── */

export const serviceNotNever: IsNever<Service> = false;
export const serviceFlat: EveryVariantFlat<Service> = true;
export const serviceDisjoint: [
  Disjoint<ServiceMeta, ServiceTerms>,
  Disjoint<ServiceMeta, ServiceComposition>,
  Disjoint<ServiceMeta, ServiceCover>,
  Disjoint<ServiceTerms, ServiceComposition>,
  Disjoint<ServiceTerms, ServiceCover>,
  Disjoint<ServiceComposition, ServiceCover>,
] = [true, true, true, true, true, true];

declare const service: Service;
// The terms sit at the root — no `baseTerms` wrapper is left (Law 6.1).
export const serviceRoot: readonly unknown[] = [
  service.priceCents,
  service.currency,
  service.durationMinutes,
  service.setupMinutes,
  service.cleanupMinutes,
  service.serviceStatus === ServiceStatus.Active,
];
// The composition narrows on its own discriminator.
export const bundleParts: unknown =
  service.compositionKind === CompositionKind.Bundle
    ? service.bundleServiceIds
    : null;
export const singleHasNoParts: unknown =
  service.compositionKind === CompositionKind.Single
    ? // @ts-expect-error — a single service names no parts
      service.bundleServiceIds
    : null;
// @ts-expect-error — the terms are flat, never nested under `baseTerms`
export const noBaseTerms: unknown = service.baseTerms;
// @ts-expect-error — the composition is flat, never nested under `composition`
export const noComposition: unknown = service.composition;

/* ── The single-slice entities ───────────────────────────────────────── */

export const singleSliceNotNever: [
  IsNever<BarberBusyDay>,
  IsNever<BarberLeadTimeSample>,
  IsNever<BarberSchedule>,
  IsNever<BookingPolicySettings>,
  IsNever<CapacityMonth>,
  IsNever<ServiceCategory>,
] = [false, false, false, false, false, false];
export const singleSliceFlat: [
  EveryVariantFlat<BarberBusyDay>,
  EveryVariantFlat<BarberLeadTimeSample>,
  EveryVariantFlat<BarberSchedule>,
  EveryVariantFlat<BookingPolicySettings>,
  EveryVariantFlat<CapacityMonth>,
  EveryVariantFlat<ServiceCategory>,
] = [true, true, true, true, true, true];
// The settings document IS the policy beside its id.
export const settingsDisjoint: Disjoint<
  Pick<BookingPolicySettings, 'id'>,
  BookingPolicy
> = true;

declare const busyDay: BarberBusyDay;
// A busy day is a shop day (Law 7.2): `localDate` + its first instant, no zone.
export const busyDayRoot: readonly unknown[] = [
  busyDay.localDate,
  busyDay.utcEpochMs,
  busyDay.blocks,
];
// @ts-expect-error — no zone on a temporal entity (Law 7.2)
export const noBusyZone: unknown = busyDay.zone;
// @ts-expect-error — the shop day is `localDate`, never `dayKey`
export const noBusyDayKey: unknown = busyDay.dayKey;
