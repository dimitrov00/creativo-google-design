import { defer, of } from 'rxjs';
import {
  BlockKind,
  MinuteBlock,
  DayHours,
  type DocBody,
  ShiftSegment,
  type ScheduleVersion,
  ServiceTerms,
  E164,
  type LocalizedText,
  BarberStatus,
  LocationStatus,
  ServiceStatus,
  CompositionKind,
} from '@core/components';
import {
  Result,
  Weekday,
  Currency,
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
  Latitude,
  Longitude,
  BarberBusyDayId,
  BarberId,
  LocationId,
  ServiceCategoryId,
  ServiceId,
  BusyKey,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  PriceCents,
  type TimeZone,
} from '@core/primitives';
import {
  type BarberBusyDay,
  type BarberSchedule,
  type Barber,
  type ShopLocation,
  type Service,
  Collections,
} from '@core/entities';
import type { LoadBusyDay, ObserveBusyDay } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';

/**
 * The booking-core fixtures (flatten-spec §8.1/§8.2) — the catalogue and
 * scheduling entities in their flat, branded shapes, every field present,
 * overridable field by field, and the branded-literal helpers the
 * booking-core specs name their figures with. Test support only, reached
 * through `@core/testing`.
 *
 * Self-contained on purpose: `testing.ts` re-exports this file, so it never
 * imports `testing.ts` back (a cycle would hand a spec half-initialised
 * constants). The few pins it shares with `testing.ts` — the fixture ids,
 * `FIXTURE_TODAY`, the shop's zone — are restated here and held equal by
 * `booking-core.fixtures.spec.ts`.
 */

/* ── Branded literals (a bad literal is a broken fixture: it throws) ─────── */

function sure<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) {
    throw new Error(
      `${what}: ${JSON.stringify(result.error)} — a broken fixture`,
    );
  }
  return result.value;
}

/** A `PriceCents` literal — `cents(2800)` is 28,00. */
export function cents(raw: number): PriceCents {
  return sure(PriceCents.of(raw), 'cents');
}

/** A `DurationMinutes` literal — positive. */
export function duration(raw: number): DurationMinutes {
  return sure(DurationMinutes.of(raw), 'duration');
}

/** A `MinuteCount` literal — non-negative (a pad, a turnaround, free time). */
export function minuteCount(raw: number): MinuteCount {
  return sure(MinuteCount.of(raw), 'minuteCount');
}

/** A `MinuteDelta` literal — signed. */
export function minuteDelta(raw: number): MinuteDelta {
  return sure(MinuteDelta.of(raw), 'minuteDelta');
}

/** `hh:mm` on the wall clock → a `MinuteOfDay` — `at(10, 30)` is 630. */
export function at(hour: number, minutes = 0): MinuteOfDay {
  return sure(MinuteOfDay.of(hour * 60 + minutes), 'at');
}

/** `hh:mm` as an exclusive end → an `EndMinute` — `until(24)` is the closing midnight. */
export function until(hour: number, minutes = 0): EndMinute {
  return sure(EndMinute.of(hour * 60 + minutes), 'until');
}

/** The `EUR` brand — every new amount's currency. */
export const EUR: Currency = Currency.EUR;

/**
 * Terms from plain figures — `termsFixture(2800, 30)` is 28,00 € for 30
 * minutes, no pads.
 */
export function termsFixture(
  priceCents: number,
  durationMinutes: number,
  setupMinutes = 0,
  cleanupMinutes = 0,
  currency: Currency = EUR,
): ServiceTerms {
  return ServiceTerms.of(
    cents(priceCents),
    currency,
    duration(durationMinutes),
    minuteCount(setupMinutes),
    minuteCount(cleanupMinutes),
  );
}

/* ── The shared pins (held equal to testing.ts by the spec) ─────────────── */

/** The fixture shop's zone — `FIXTURE_TIME_ZONE`. */
const SHOP_ZONE: TimeZone = sure(
  ZonedTimeSystem.checkZone('Europe/Sofia'),
  'zone',
);

/** `FIXTURE_TODAY` — 2026-09-28, a Monday. */
const TODAY: LocalDate = sure(LocalDate.parse('2026-09-28'), 'today');

/** The ids every builder defaults to — `FIXTURE_IDS`' catalogue members. */
const IDS = {
  barber: BarberId.of('b-ivan'),
  location: LocationId.of('loc-center'),
  service: ServiceId.of('svc-classic-cut'),
  category: ServiceCategoryId.of('cat-cuts'),
} as const;

function text(en: string, bg: string): LocalizedText {
  return { bg, en };
}

/** The classic cut: 28,00 €, 30 minutes, no pads. */
export const FIXTURE_TERMS: ServiceTerms = termsFixture(2800, 30);

/* ── Entity builders ─────────────────────────────────────────────────────── */

/** Ivan, active, working at the centre shop, no avatar. */
export function barberFixture(overrides: Partial<Barber> = {}): Barber {
  return {
    id: IDS.barber,
    name: text('Ivan', 'Иван'),
    handle: 'ivan',
    title: text('Barber', 'Бръснар'),
    bio: text('Classic cuts.', 'Класически подстрижки.'),
    yearsExperience: 8,
    locationIds: [IDS.location],
    instagramHandle: null,
    barberStatus: BarberStatus.Active,
    sortOrder: 0,
    avatarMediaId: null,
    avatarMediaPath: null,
    avatarMediaWidth: null,
    avatarMediaHeight: null,
    avatarMediaBlurhash: null,
    avatarMediaFocalX: null,
    avatarMediaFocalY: null,
    ...overrides,
  };
}

/** The centre shop, open 09:00–19:00 Monday to Saturday, closed Sunday. */
export function locationFixture(
  overrides: Partial<ShopLocation> = {},
): ShopLocation {
  const weekday = DayHours.open(at(9), until(19));
  return {
    id: IDS.location,
    name: text('Centre', 'Център'),
    shortName: null,
    address: text('1 Vitosha Blvd, Sofia', 'бул. Витоша 1, София'),
    latitude: sure(Latitude.of(42.6977), 'latitude'),
    longitude: sure(Longitude.of(23.3219), 'longitude'),
    phoneE164: E164.of('+35921234567'),
    phoneDisplay: '02 123 4567',
    mapUrl: null,
    coverMediaId: null,
    coverMediaPath: null,
    coverMediaWidth: null,
    coverMediaHeight: null,
    coverMediaBlurhash: null,
    coverMediaFocalX: null,
    coverMediaFocalY: null,
    photos: [],
    openingHours: [
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      DayHours.closed(),
    ],
    timeZone: SHOP_ZONE,
    locationStatus: LocationStatus.Active,
    sortOrder: 0,
    ...overrides,
  };
}

/** The classic cut, offered by Ivan at the catalogue terms, a single service. */
export function serviceFixture(overrides: Partial<Service> = {}): Service {
  return {
    id: IDS.service,
    name: text('Classic cut', 'Класическо подстригване'),
    description: text('Scissors and clippers.', 'Ножица и машинка.'),
    categoryId: IDS.category,
    ...FIXTURE_TERMS,
    variants: [],
    offerings: [{ barberId: IDS.barber, overrides: [], ...FIXTURE_TERMS }],
    locationIds: [IDS.location],
    conflictsWith: [],
    compositionKind: CompositionKind.Unspecified,
    upsellOnly: false,
    popular: false,
    serviceStatus: ServiceStatus.Active,
    sortOrder: 0,
    coverMediaId: null,
    coverMediaPath: null,
    coverMediaWidth: null,
    coverMediaHeight: null,
    coverMediaBlurhash: null,
    coverMediaFocalX: null,
    coverMediaFocalY: null,
    ...overrides,
  } as Service;
}

/**
 * Ivan's schedule: one open-ended version from 2026-01-01, 09:00–18:00 at the
 * centre shop Monday to Friday.
 */
export function barberScheduleFixture(
  overrides: Partial<BarberSchedule> = {},
): BarberSchedule {
  const workdays: readonly Weekday[] = [
    Weekday.Mon,
    Weekday.Tue,
    Weekday.Wed,
    Weekday.Thu,
    Weekday.Fri,
  ];
  const version: ScheduleVersion = {
    seq: 1,
    effectiveFromLocalDate: sure(LocalDate.parse('2026-01-01'), 'from'),
    effectiveToLocalDate: null,
    segments: workdays.map((day) =>
      ShiftSegment.of(day, IDS.location, at(9), until(18)),
    ),
  };
  return {
    id: IDS.barber,
    turnaroundMinutes: MinuteCount.ZERO,
    versions: [version],
    ...overrides,
  };
}

/**
 * Ivan's busy day today: the fixture seat's 10:00–10:30 block; `utcEpochMs`
 * is the day's first instant in the shop's zone (§2.5).
 */
export function barberBusyDayFixture(
  overrides: Partial<BarberBusyDay> = {},
): BarberBusyDay {
  return {
    id: BarberBusyDayId.of(BusyKey.of(IDS.barber, TODAY)),
    barberId: IDS.barber,
    localDate: TODAY,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(TODAY, SHOP_ZONE),
    blocks: [MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy)],
    ...overrides,
  };
}

/* ── The scheduling busy streams over a store ────────────────────────────── */

/**
 * The read half the two busy doubles need — `testing.ts`'s `MemoryStore`
 * (`path.join('/')` → the document body, Law 5) satisfies it.
 */
export type BusyDayStore = ReadonlyMap<string, DocBody>;

/** A stored document as its entity — `{ id, ...body }` (Law 5: the body IS the entity minus `id`). */
function entityAt<E>(store: BusyDayStore, path: string, id: string): E | null {
  const body = store.get(path);
  return body === undefined ? null : ({ id, ...body } as E);
}

/** `barberBusy/{key}` as the entity, or `null`. */
function busyDayAt(store: BusyDayStore, key: BusyKey): BarberBusyDay | null {
  return entityAt<BarberBusyDay>(
    store,
    `${Collections.BarberBusy}/${key}`,
    key,
  );
}

/**
 * `loadBusyDay` — the server's busy read (`scheduling.port.ts`) — over a
 * store: `barberBusy/{key}` as the entity, `null` when the day holds
 * nothing. Exactly the stored document: no padding, no merging, no
 * release — availability is derived by the caller, never behind the port
 * (blueprint §4.2). The in-memory runner of `schedulingPortsContract`.
 */
export function memoryLoadBusyDay(store: BusyDayStore): LoadBusyDay {
  return async (key) => Result.ok(busyDayAt(store, key));
}

/**
 * `observeBusyDay` — the browser's busy stream — over a store: ONE emission
 * of the day as stored when subscribed, then complete. A later write to the
 * store is not re-emitted; a spec that needs the second emission subscribes
 * again.
 */
export function memoryObserveBusyDay(store: BusyDayStore): ObserveBusyDay {
  return (key) => defer(() => of(Result.ok(busyDayAt(store, key))));
}
