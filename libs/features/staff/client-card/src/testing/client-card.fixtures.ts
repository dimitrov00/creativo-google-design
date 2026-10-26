/**
 * TEST SUPPORT for `staff-client-card` — never part of the lib's build
 * (`tsconfig.lib.json` excludes `src/testing/**`), imported by specs only.
 *
 * The dev shop's two loyalty holders, Георги Петров (`dev-client-1`) and
 * Мартин Илиев (`dev-client-2`), rebuilt from the loyalty fixtures of
 * `@core/testing` (`loyaltyAccountFixtures`, the flat stored bodies): every
 * worked visit their point journal records becomes the appointment that
 * earned it — the same day, seats, prices and barbers — so the history,
 * the stats, the loyalty and the achievements a spec renders all tell one
 * story. The card resolves each holder's client RECORD as
 * `customerOf(uid)` (the fixture hash, D29), so the loyalty documents are
 * keyed by that record here (`GEORGI_LOYALTY`, `MARTIN_LOYALTY`). The
 * catalogue is the dev seed's; the words are the app's own catalogue, so a
 * key a presenter names and the catalogue lacks fails in a spec.
 *
 * «Now» is Monday 28 September 2026, 12:40 in Sofia (`FIXTURE_TODAY`):
 * Георги's 10:00 fade is done (he is the settled card), Мартин is in the
 * chair for his 12:30 classic cut on his birthday (the open card).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isObservable, of } from 'rxjs';
import {
  AppointmentId,
  AppointmentPhotoId,
  AttendanceState,
  type BadgeSeriesId,
  BarberId,
  BusyKey,
  CartLineId,
  ClientMoneyStatsId,
  CouponGrantId,
  CouponId,
  Currency,
  type CustomerId,
  DraftPersonKey,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  Result as CoreResult,
  type SeasonId,
  SeatId,
  SeatKeyText,
  ServiceCategoryId,
  ServiceId,
  ServiceVariantId,
  type TimeZone,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
  WaitlistStatus,
} from '@core/primitives';
import { RepositoryError as CoreRepositoryError } from '@core/errors';
import {
  AccountLifecycle,
  BirthDate,
  BlockReason,
  BookingContact,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  type CartLine,
  ClientStatsPolicy,
  CouponValue,
  CustomerOrigin,
  DayWindows,
  E164,
  Email,
  MinuteRange,
  PhotoOrigin,
  Placement,
  PolicyPassStamp,
  PublicLabel,
  Role,
  type ScheduledStreakRule,
  type ShopNow,
  StreakRule,
  Seat,
  SeatOccupant,
  SeatOutcome,
  SeatSubject,
  SubjectRelationship,
  type VisitFact,
  WaitlistLifecycle,
} from '@core/components';
import type {
  Appointment,
  AppointmentPhoto,
  BadgeProgress,
  ClientMoneyRecord,
  ClientStatsRecord,
  Customer,
  GiftVoucher,
  GiftVoucherMeta,
  JournalEntry,
  LoyaltyCatalog,
  SeasonProgress,
  StreakDefinition,
  User,
  WaitlistRequest,
} from '@core/entities';
import type {
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AvatarPorts,
  ClientJournalPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  ProfilePorts,
  WaitlistReadPorts,
} from '@core/ports';
import {
  ClientStatsSystem,
  LoyaltyCatalogSystem,
  SearchFieldsSystem,
  StreakRuleSystem,
  type ValidLoyaltyCatalog,
  ZonedTimeSystem,
} from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  type LoyaltyClientFixture,
  appointmentFixture,
  cents,
  customerOf,
  duration,
  giftVoucherFixtures,
  loyaltyAccountFixtures,
  locationFixture,
  loyaltyCatalogFixture,
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  memoryAvatarPorts,
  memoryClientJournalPorts,
  memoryClientStatsReadPorts,
  memoryCouponVoucherPorts,
  memoryCustomerPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryLoyaltyAccountReadPorts,
  memoryLoyaltyCatalogReadPorts,
  memoryLoyaltyWorld,
  memoryProfilePorts,
  memoryProgramsWorld,
  memoryWaitlistReadPorts,
  provisionedUserFixture,
  registeredUserFixture,
  seatFixture,
  termsFixture,
  unwrapOk,
} from '@core/testing';
import type {
  ClientCardCatalog,
  ClientCardContext,
  ClientCardGrant,
  ClientCardStart,
  ClientCardSubject,
  ClientCardViewer,
} from '../lib/client-card.contracts';
import type { AchievementsContext } from '../lib/achievements.presenter';
import type { AchievementsData } from '../lib/client-pages.vm';
import {
  type ClientCardTranslate,
  type ClientCardWords,
  clientCardWordsOf,
} from '../lib/client-card.words';

export const GEORGI = 'dev-client-1';
export const MARTIN = 'dev-client-2';
export const TODAY: LocalDate = FIXTURE_TODAY;

/** A value a fixture guarantees; a spec that finds it missing has a broken fixture. */
export function must<T>(
  value: T | null | undefined,
  what = 'fixture value',
): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/**
 * The shops' zone — the fixture centre shop's `timeZone` (Europe/Sofia),
 * the default location's the card's store resolves; every booking fixture
 * is read in it.
 */
export const SHOP_TIME_ZONE: TimeZone = FIXTURE_TIME_ZONE;

/** A Sofia wall-clock reading (`YYYY-MM-DDTHH:mm:ss`) as the instant it names. */
export function sofia(iso: string): UtcEpochMs {
  return unwrapOk(ZonedTimeSystem.parseIsoIn(iso, SHOP_TIME_ZONE));
}

/**
 * A Sofia wall-clock reading as the visit's drafted start the card's
 * contract takes (`ClientCardContext.start`): its shop day and minute.
 */
export function startOf(iso: string): ClientCardStart {
  const wall = wallOf(iso);
  return { localDate: wall.localDate, startMinutes: wall.minute };
}

/** A Sofia wall-clock reading as the shop day and minute it is stored as (Law 7.3). */
export function wallOf(iso: string): {
  readonly localDate: LocalDate;
  readonly minute: MinuteOfDay;
} {
  return {
    localDate: unwrapOk(LocalDate.parse(iso.slice(0, 10))),
    minute: unwrapOk(
      MinuteOfDay.of(
        Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)),
      ),
    ),
  };
}

/** Monday 28 September 2026, 12:40 in Sofia. */
export const NOW_MS: UtcEpochMs = sofia('2026-09-28T12:40:00');

/** "Now" on the shop's wall clock at an instant, read once in its zone — as the store derives it (Law 7.3). */
export function shopNowAt(nowMs: number): ShopNow {
  return ZonedTimeSystem.shopNow(
    unwrapOk(UtcEpochMs.of(nowMs)),
    SHOP_TIME_ZONE,
  );
}

/** `NOW_MS` on the shop's wall clock: Monday 28 September 2026, minute 760. */
export const NOW: ShopNow = shopNowAt(NOW_MS);

/**
 * A stored fact's shop wall clock as the instant it names — what the
 * loyalty presenters (flip 3) still count in (`visitsMs`), the store's own
 * reading of a `VisitFact`.
 */
export function factMs(fact: VisitFact): UtcEpochMs {
  return unwrapOk(
    ZonedTimeSystem.toUtc(fact.localDate, fact.startMinutes, SHOP_TIME_ZONE),
  );
}

/** Георги's client record (D29), derived the way the pipelines derive it. */
export const GEORGI_CUSTOMER_ID: CustomerId = customerOf(UserId.of(GEORGI));
/** Мартин's client record. */
export const MARTIN_CUSTOMER_ID: CustomerId = customerOf(UserId.of(MARTIN));

// ── The app's own words ─────────────────────────────────────────────────

type Catalogue = Record<string, unknown>;

function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/** The raw catalogue for a language — what a spec hands Transloco's loader. */
export function catalogueOf(lang: 'bg' | 'en'): Catalogue {
  return catalogue(lang);
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in; a missing key throws. */
export function translatorOf(lang: 'bg' | 'en'): ClientCardTranslate {
  const tree = catalogue(lang);
  return (key, params = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );
    if (typeof value !== 'string') throw new Error(`missing word ${key}`);
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}

/** The card's words from the real catalogue. */
export function wordsOf(lang: 'bg' | 'en' = 'bg'): ClientCardWords {
  return clientCardWordsOf(translatorOf(lang), lang);
}

/** `formatCents`'s bg form keeps the sign on the figure's line: a no-break space. */
export const NBSP_EURO = (text: string): string => text.replaceAll(' €', ' €');

// ── The shop ────────────────────────────────────────────────────────────

const SERVICES = new Map<
  string,
  {
    readonly name: string;
    readonly category: 'hair' | 'beard' | 'care';
    readonly cover: string | null;
  }
>([
  [
    'svc-classic-cut',
    { name: 'Класическа подстрижка', category: 'hair', cover: null },
  ],
  [
    'svc-fade',
    {
      name: 'Фейд',
      category: 'hair',
      cover: 'https://example.test/covers/fade.jpg',
    },
  ],
  [
    'svc-beard',
    {
      name: 'Оформяне на брада',
      category: 'beard',
      cover: 'https://example.test/covers/beard.jpg',
    },
  ],
  [
    'svc-scissor-trim',
    { name: 'Подстрижка с ножица', category: 'hair', cover: null },
  ],
  ['svc-modern-cut', { name: 'Модерна визия', category: 'hair', cover: null }],
  ['svc-finish', { name: 'Освежаване', category: 'beard', cover: null }],
  ['svc-full-care', { name: 'Пълна грижа', category: 'care', cover: null }],
  ['svc-father-son', { name: 'Баща и син', category: 'hair', cover: null }],
]);

const SERVICE_CATEGORIES = new Map([
  ['hair', 'Коса'],
  ['beard', 'Брада'],
  ['care', 'Грижа'],
]);

const BARBERS = new Map([
  ['ivan', { name: 'Иван', avatar: 'https://example.test/barbers/ivan.jpg' }],
  ['niko', { name: 'Нико', avatar: 'https://example.test/barbers/niko.jpg' }],
  ['stefan', { name: 'Стефан', avatar: null }],
]);

const LOCATIONS = new Map([
  [
    'loc-center',
    { name: 'Център', cover: 'https://example.test/shops/center.jpg' },
  ],
  ['loc-mladost', { name: 'Младост', cover: null }],
]);

/** The dev shop's catalogue as the dashboard hands it to the card: two shops, three barbers. */
export const SHOP_CATALOG: ClientCardCatalog = {
  serviceName: (id) => SERVICES.get(id)?.name ?? null,
  serviceCoverSrc: (id) => SERVICES.get(id)?.cover ?? null,
  serviceCategory: (id) => {
    const category = SERVICES.get(id)?.category;
    const name =
      category === undefined ? undefined : SERVICE_CATEGORIES.get(category);
    return category === undefined || name === undefined
      ? null
      : { id: ServiceCategoryId.of(category), name };
  },
  barberName: (id) => BARBERS.get(id)?.name ?? null,
  barberAvatarSrc: (id) => BARBERS.get(id)?.avatar ?? null,
  locationName: (id) => LOCATIONS.get(id)?.name ?? null,
  locationCoverSrc: (id) => LOCATIONS.get(id)?.cover ?? null,
  locationCount: 2,
};

// ── The history, from the point journal ────────────────────────────────

/** What a seat's spend says it was (the dev catalogue's prices). */
const SEAT_BY_SPEND = new Map([
  [1750, { serviceId: 'svc-fade', minutes: 45 }],
  [1000, { serviceId: 'svc-beard', minutes: 20 }],
  [1500, { serviceId: 'svc-classic-cut', minutes: 30 }],
]);

interface WorkedSeat {
  readonly appointmentId: string;
  readonly seatId: string;
  readonly workedAtMs: UtcEpochMs;
  readonly serviceId: string;
  readonly minutes: number;
  readonly priceMinor: number;
}

/** Every worked seat the journal paid points for, oldest first. */
function workedSeatsOf(fixture: LoyaltyClientFixture): readonly WorkedSeat[] {
  return fixture.clientJournal
    .flatMap((entry): WorkedSeat[] => {
      const spend = PublicLabel.param(entry, 'spendMinor');
      // The seat the points paid for, as the engine's correlation id names it.
      const [, appointmentId, , seatId] = entry.correlationId.split(':');
      const seat =
        typeof spend === 'number' ? SEAT_BY_SPEND.get(spend) : undefined;
      if (
        seat === undefined ||
        appointmentId === undefined ||
        seatId === undefined
      ) {
        return [];
      }
      return [
        {
          appointmentId,
          seatId,
          workedAtMs: entry.utcEpochMs,
          serviceId: seat.serviceId,
          minutes: seat.minutes,
          priceMinor: typeof spend === 'number' ? spend : 0,
        },
      ];
    })
    .sort(
      (a, b) => a.workedAtMs - b.workedAtMs || a.seatId.localeCompare(b.seatId),
    );
}

export interface SeatSpec {
  readonly id: string;
  readonly who: string;
  readonly serviceId: string;
  readonly variantId?: string | null;
  readonly barberId: string;
  readonly minutes: number;
  readonly priceMinor: number;
  /** Where the seat starts on the shop's wall clock. */
  readonly startMinutes: number;
  readonly outcome?: SeatOutcome;
  /** A companion's seat on someone else's booking; the person's own by default. */
  readonly companion?: boolean;
}

/** One account seat — the person's own unless a companion's — their client record beside their uid (D29). */
export function seatOf(spec: SeatSpec): Seat {
  const userId = UserId.of(spec.who);
  return seatFixture({
    seatId: SeatId.of(spec.id),
    serviceId: ServiceId.of(spec.serviceId),
    variantId:
      spec.variantId == null ? null : ServiceVariantId.of(spec.variantId),
    barberId: BarberId.of(spec.barberId),
    startMinutes: unwrapOk(MinuteOfDay.of(spec.startMinutes)),
    terms: Seat.termsOf(termsFixture(spec.priceMinor, spec.minutes), null),
    occupant: SeatOccupant.account(
      userId,
      customerOf(userId),
      spec.companion === true
        ? SubjectRelationship.Companion
        : SubjectRelationship.Self,
    ),
    outcome: spec.outcome ?? SeatOutcome.scheduled(),
  });
}

/** A booking's contact block, as the guest form fills it. */
export function contactOf(
  name: string,
  phone: string,
  note: string | null,
): BookingContact {
  return {
    contactName: name,
    contactPhone: E164.of(phone),
    contactEmail: null,
    contactNote: note,
  };
}

export interface VisitSpec {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly seats: readonly Seat[];
  readonly lifecycle: BookingLifecycle;
  readonly contact: BookingContact;
  readonly bookedAtUtcMs: UtcEpochMs;
  readonly arrivedAtUtcMs?: UtcEpochMs | null;
}

/**
 * A flat visit at Център holding `seats` on one shop day: its envelope,
 * instant and query mirrors derived from the seats as the write plans
 * derive them (the owner is the first `SELF` seat).
 */
export function visitOf(spec: VisitSpec): Appointment {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  const barbers: BarberId[] = [];
  const users: UserId[] = [];
  const customers: CustomerId[] = [];
  let owner: UserId | null = null;
  for (const seat of spec.seats) {
    start = Math.min(start, seat.startMinutes);
    end = Math.max(end, Seat.endMinutes(seat));
    if (!barbers.includes(seat.barberId)) barbers.push(seat.barberId);
    if (seat.seatSubject !== SeatSubject.Account) continue;
    if (!users.includes(seat.subjectUserId)) users.push(seat.subjectUserId);
    if (!customers.includes(seat.subjectCustomerId)) {
      customers.push(seat.subjectCustomerId);
    }
    if (
      owner === null &&
      seat.subjectRelationship === SubjectRelationship.Self
    ) {
      owner = seat.subjectUserId;
    }
  }
  const startMinutes = unwrapOk(MinuteOfDay.of(start));
  return appointmentFixture({
    id: AppointmentId.of(spec.id),
    locationId: LocationId.of('loc-center'),
    seats: spec.seats,
    localDate: spec.localDate,
    startMinutes,
    endMinutes: unwrapOk(EndMinute.of(end)),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(spec.localDate, startMinutes, SHOP_TIME_ZONE),
    ),
    barberIds: barbers,
    busyKeys: barbers.map((barber) => BusyKey.of(barber, spec.localDate)),
    ownerUserId: owner,
    ownerCustomerId: owner === null ? null : customerOf(owner),
    subjectUserIds: [...users].sort(),
    subjectCustomerIds: [...customers].sort(),
    placement: Placement.Self,
    ...spec.contact,
    bookedAtUtcMs: spec.bookedAtUtcMs,
    arrivedAtUtcMs: spec.arrivedAtUtcMs ?? null,
    lifecycle: spec.lifecycle,
  });
}

/** A cancelled visit's lifecycle: the reasons its cancelled seats carry. */
function cancelledLifecycle(
  at: UtcEpochMs,
  seats: readonly Seat[],
): BookingLifecycle {
  return BookingLifecycle.cancel(
    at,
    CancellationReasonSet.of(
      seats.flatMap((seat) =>
        seat.attendanceState === AttendanceState.Cancelled
          ? [seat.cancellationReason]
          : [],
      ),
    ),
  );
}

interface HistoryPlan {
  readonly uid: string;
  readonly name: string;
  readonly phone: string;
  /** Which chair the n-th visit (0-based) was in. */
  readonly barberOf: (index: number) => string;
  /** The client's own words, by appointment id. */
  readonly notes?: ReadonlyMap<string, string>;
}

const DAY_MS = 86_400_000;

/** The journal's worked visits as completed appointments at Център, each seat after the one before. */
function workedHistory(
  fixture: LoyaltyClientFixture,
  plan: HistoryPlan,
): readonly Appointment[] {
  const byVisit = new Map<string, WorkedSeat[]>();
  for (const seat of workedSeatsOf(fixture)) {
    byVisit.set(seat.appointmentId, [
      ...(byVisit.get(seat.appointmentId) ?? []),
      seat,
    ]);
  }
  return [...byVisit.entries()].map(([appointmentId, seats], index) => {
    const worked = Math.max(...seats.map((s) => s.workedAtMs));
    const total = seats.reduce((sum, s) => sum + s.minutes, 0);
    const startMs = unwrapOk(UtcEpochMs.of(worked - total * 60_000));
    const wall = ZonedTimeSystem.toLocal(startMs, SHOP_TIME_ZONE);
    let cursor: number = wall.minute;
    const barberId = plan.barberOf(index);
    const built = seats.map((seat) => {
      const startMinutes = cursor;
      cursor += seat.minutes;
      return seatOf({
        id: seat.seatId,
        who: plan.uid,
        serviceId: seat.serviceId,
        barberId,
        minutes: seat.minutes,
        priceMinor: seat.priceMinor,
        startMinutes,
        outcome: SeatOutcome.worked(seat.workedAtMs),
      });
    });
    return visitOf({
      id: appointmentId,
      localDate: wall.localDate,
      seats: built,
      lifecycle: BookingLifecycle.complete(unwrapOk(UtcEpochMs.of(worked))),
      contact: contactOf(
        plan.name,
        plan.phone,
        plan.notes?.get(appointmentId) ?? null,
      ),
      bookedAtUtcMs: unwrapOk(UtcEpochMs.of(startMs - 14 * DAY_MS)),
    });
  });
}

/** Георги's last settled visit before today — his own words on it. */
export const GEORGI_NOTE = 'Къса отстрани, по-дълго отгоре';

/** Георги's next booking: Friday 2 October, 10:00, a fade with Иван, rebooked in the chair today. */
export const GEORGI_NEXT_ID: AppointmentId = AppointmentId.of(
  'appt-dev-georgi-next',
);

/**
 * Георги Петров's book: 24 worked visits since 6.03.2025, every one a fade
 * with Иван at Център at 10:00 (six with a beard), today's included, and
 * one visit ahead.
 */
export function georgiHistory(): readonly Appointment[] {
  const worked = workedHistory(loyaltyAccountFixtures.georgi, {
    uid: GEORGI,
    name: 'Георги Петров',
    phone: '+359881234567',
    barberOf: () => 'ivan',
    notes: new Map([['appt-hist-c1-23', GEORGI_NOTE]]),
  });
  const booked = sofia('2026-09-28T10:45:00');
  const next = visitOf({
    id: GEORGI_NEXT_ID,
    localDate: wallOf('2026-10-02T10:00:00').localDate,
    seats: [
      seatOf({
        id: 'seat-next-1',
        who: GEORGI,
        serviceId: 'svc-fade',
        barberId: 'ivan',
        minutes: 45,
        priceMinor: 1750,
        startMinutes: wallOf('2026-10-02T10:00:00').minute,
      }),
    ],
    lifecycle: BookingLifecycle.confirm(booked),
    contact: contactOf('Георги Петров', '+359881234567', null),
    bookedAtUtcMs: booked,
  });
  return [...worked, next];
}

/** Мартин's cut in the chair today: 12:30, a short classic cut with Иван, in his own words. */
export const MARTIN_TODAY_ID: AppointmentId = AppointmentId.of('appt-dev-2');

/**
 * Мартин Илиев's book: 13 classic cuts since 8.05.2025 with Иван or Нико,
 * the shop's one cancellation (Нико away, excused), and today's cut, in
 * the chair.
 */
export function martinHistory(): readonly Appointment[] {
  // Seven with Иван, six with Нико, in the order the С Иван / С Нико
  // levels were earned (I, I, I, I, N, I, N, I, N, I, N, N, N).
  const chairs = [
    'ivan',
    'ivan',
    'ivan',
    'ivan',
    'niko',
    'ivan',
    'niko',
    'ivan',
    'niko',
    'ivan',
    'niko',
    'niko',
    'niko',
  ];
  const worked = workedHistory(loyaltyAccountFixtures.martin, {
    uid: MARTIN,
    name: 'Мартин Илиев',
    phone: '+359887654321',
    barberOf: (index) => chairs.at(index) ?? 'ivan',
  });
  const cancelledAt = sofia('2026-05-10T09:00:00');
  const cancelledSeats = [
    seatOf({
      id: 'appt-hist-c2-11-s1',
      who: MARTIN,
      serviceId: 'svc-classic-cut',
      barberId: 'niko',
      minutes: 30,
      priceMinor: 1500,
      startMinutes: wallOf('2026-05-12T12:30:00').minute,
      outcome: SeatOutcome.cancelled(
        cancelledAt,
        CancelledBy.Staff,
        CancellationReason.StaffBarberAbsence,
        null,
      ),
    }),
  ];
  const cancelled = visitOf({
    id: 'appt-hist-c2-11',
    localDate: wallOf('2026-05-12T12:30:00').localDate,
    seats: cancelledSeats,
    lifecycle: cancelledLifecycle(cancelledAt, cancelledSeats),
    contact: contactOf('Мартин Илиев', '+359887654321', null),
    bookedAtUtcMs: sofia('2026-04-22T13:00:00'),
  });
  const booked = sofia('2026-09-21T12:00:00');
  const today = visitOf({
    id: MARTIN_TODAY_ID,
    localDate: wallOf('2026-09-28T12:30:00').localDate,
    seats: [
      seatOf({
        id: 'seat-2',
        who: MARTIN,
        serviceId: 'svc-classic-cut',
        variantId: 'short',
        barberId: 'ivan',
        minutes: 30,
        priceMinor: 1500,
        startMinutes: wallOf('2026-09-28T12:30:00').minute,
      }),
    ],
    lifecycle: BookingLifecycle.confirm(booked),
    contact: contactOf('Мартин Илиев', '+359887654321', 'Къса отстрани'),
    bookedAtUtcMs: booked,
    arrivedAtUtcMs: sofia('2026-09-28T12:25:00'),
  });
  return [...worked, cancelled, today];
}

/** The projection the server keeps (`clientStats/{customerId}`), computed from the same book at «now». */
export function statsOf(
  uid: string,
  appointments: readonly Appointment[],
  nowMs: number = NOW_MS,
): ClientStatsRecord {
  const customerId = customerOf(UserId.of(uid));
  const now = unwrapOk(UtcEpochMs.of(nowMs));
  return {
    ...ClientStatsSystem.stats(
      customerId,
      appointments,
      ClientStatsPolicy.DEFAULT,
      ZonedTimeSystem.shopNow(now, SHOP_TIME_ZONE),
    ),
    id: customerId,
    customerId,
    version: 1,
    updatedAtUtcMs: now,
    ...PolicyPassStamp.NONE,
  };
}

/** Георги's lifetime spend — the ‹admin› figure. */
export const GEORGI_MONEY: ClientMoneyRecord = {
  id: ClientMoneyStatsId.FIXED,
  customerId: GEORGI_CUSTOMER_ID,
  lifetimeSpendCents: cents(46250),
  currency: Currency.EUR,
  version: 1,
  updatedAtUtcMs: NOW_MS,
};

/** The three past cuts on Георги's last three visits, newest first (the dev seed's). */
export function georgiPhotos(): AppointmentPhoto[] {
  const shots: readonly [string, string][] = [
    ['appt-dev-1', '2026-09-28T10:44:00'],
    ['appt-hist-c1-23', '2026-09-03T10:44:00'],
    ['appt-hist-c1-22', '2026-08-06T10:44:00'],
  ];
  return shots.map(([appointmentId, taken], index) => ({
    id: AppointmentPhotoId.of(`photo-dev-georgi-${index + 1}`),
    appointmentId: AppointmentId.of(appointmentId),
    barberId: BarberId.of('ivan'),
    clientCustomerId: GEORGI_CUSTOMER_ID,
    clientLabel: 'Георги Петров',
    takenByUserId: UserId.of('dev-staff-ivan'),
    takenAtUtcMs: sofia(taken),
    path: `appointmentPhotos/${appointmentId}/photo-dev-georgi-${index + 1}.jpg`,
    url: `https://example.test/photos/photo-dev-georgi-${index + 1}.jpg`,
    width: 1100,
    height: 1400,
    photoOrigin: PhotoOrigin.Shot,
    label: null,
  }));
}

const WAITLIST_STATUS = {
  open: WaitlistStatus.Open,
  matched: WaitlistStatus.Matched,
  booked: WaitlistStatus.Booked,
} as const;

/** Мартин's waitlist request: Thursday and Friday next week, 14:00–17:00, a short classic cut; created last night. */
export function martinWaitlist(
  overrides: Partial<{
    readonly status: 'open' | 'matched' | 'booked';
    readonly createdAtIso: string;
    readonly id: string;
  }> = {},
): WaitlistRequest {
  const window = MinuteRange.of(
    unwrapOk(MinuteOfDay.of(14 * 60)),
    unwrapOk(EndMinute.of(17 * 60)),
  );
  const flexibleDays = ['2026-10-08', '2026-10-09'].map((day) =>
    DayWindows.of(unwrapOk(LocalDate.parse(day)), [window]),
  );
  const created = unwrapOk(
    ZonedTimeSystem.parseOffsetIso(
      overrides.createdAtIso ?? '2026-09-27T21:10:00+03:00',
    ),
  );
  const seatKey = unwrapOk(SeatKeyText.parse('self'));
  const line: CartLine = {
    lineId: CartLineId.forSequence(1),
    seatKey,
    serviceId: ServiceId.of('svc-classic-cut'),
    variantId: ServiceVariantId.of('short'),
    barberId: null,
    locationId: null,
  };
  const localDates = flexibleDays.map((day) => day.localDate);
  const first = localDates[0];
  return {
    id: WaitlistRequestId.of(overrides.id ?? 'waitlist-dev-martin'),
    ownerUserId: UserId.of(MARTIN),
    locationId: LocationId.of('loc-center'),
    localDates,
    utcEpochMs:
      first === undefined
        ? created
        : ZonedTimeSystem.startOfLocalDay(first, SHOP_TIME_ZONE),
    createdAtUtcMs: created,
    cartSeats: [{ seatKey, lines: [line] }],
    cartNextSequence: 2,
    flexibleDays,
    ...WaitlistLifecycle.open(created),
    waitlistStatus: WAITLIST_STATUS[overrides.status ?? 'open'],
  };
}

/**
 * The fixture's five gift vouchers — `@core/testing`'s
 * `giftVoucherFixtures()`, the flat `giftVouchers/{id}` bodies, in
 * Firestore's id order — keyed by the client record the CARD resolves for
 * each holder: `customerOf(uid)`, the fixture hash (the file's own key is
 * the production sha256's). Every other field is the stored one. Three of
 * Георги's, Мартин's one, one on paper.
 */
export function fixtureVouchers(): readonly GiftVoucher[] {
  return giftVoucherFixtures().map((voucher) => ({
    ...voucher,
    issuedToCustomerId:
      voucher.holderUserId === null ? null : customerOf(voucher.holderUserId),
  }));
}

/**
 * One of the fixture's vouchers by id, its identity fields edited
 * (`{ balanceCents: cents(0) }`, `{ ...voucherExpiry(null) }`) — the state
 * it was stored in kept.
 */
export function fixtureVoucher(
  id: string,
  edit: Partial<GiftVoucherMeta> = {},
): GiftVoucher {
  const voucher = must(
    fixtureVouchers().find((each) => each.id === id),
    `the voucher ${id}`,
  );
  return { ...voucher, ...edit };
}

/**
 * A voucher's lapse at an ISO instant WITH its offset: the instant and the
 * shop day it falls on, written together from one reading (T5); `null` =
 * it never lapses.
 */
export function voucherExpiry(
  isoWithOffset: string | null,
): Pick<GiftVoucherMeta, 'expiresAtUtcMs' | 'expiresLocalDate'> {
  if (isoWithOffset === null) {
    return { expiresAtUtcMs: null, expiresLocalDate: null };
  }
  const expires = unwrapOk(ZonedTimeSystem.parseOffsetIso(isoWithOffset));
  return {
    expiresAtUtcMs: expires,
    expiresLocalDate: ZonedTimeSystem.toLocal(expires, SHOP_TIME_ZONE)
      .localDate,
  };
}

/** The client records the card resolves its people by (`CUSTOMER_PORTS`). */
export function fixtureCustomers(): readonly Customer[] {
  const recordOf = (
    uid: string,
    displayName: string,
    phone: string,
    email: string,
  ): Customer => ({
    id: customerOf(UserId.of(uid)),
    userId: UserId.of(uid),
    displayName,
    phone: E164.of(phone),
    email: Email.of(email),
    searchName: displayName.toLowerCase(),
    searchPrefixes: [],
    createdAtUtcMs: sofia('2025-03-01T10:00:00'),
    customerOrigin: CustomerOrigin.Registration,
  });
  return [
    recordOf(GEORGI, 'Георги Петров', '+359881234567', 'georgi@example.test'),
    recordOf(MARTIN, 'Мартин Илиев', '+359887654321', 'martin@example.test'),
  ];
}

// ── The people ─────────────────────────────────────────────────────────

/**
 * A registered client of the dev shop as `users/{uid}` stores him — the
 * flat ACCOUNT (D29), his search keys the ones registration computes, his
 * lifecycle slice at the root (`ACTIVE` unless a case pauses him).
 */
function clientAccount(
  uid: string,
  names: { readonly firstName: string; readonly lastName: string },
  contact: { readonly phone: string; readonly email: string },
  birthDate: string,
  lifecycle: AccountLifecycle,
): User {
  const phone = E164.of(contact.phone);
  return registeredUserFixture({
    id: UserId.of(uid),
    ...names,
    phone,
    email: Email.of(contact.email),
    birthDate: BirthDate.of(birthDate),
    ...SearchFieldsSystem.searchFields(
      names.firstName,
      names.lastName,
      phone,
      contact.email,
    ),
    ...lifecycle,
  });
}

export function georgiUser(
  lifecycle: AccountLifecycle = AccountLifecycle.active(),
): User {
  return clientAccount(
    GEORGI,
    { firstName: 'Георги', lastName: 'Петров' },
    { phone: '+359881234567', email: 'georgi@example.test' },
    '1990-04-14',
    lifecycle,
  );
}

/** Мартин — his birthday is today. */
export function martinUser(
  lifecycle: AccountLifecycle = AccountLifecycle.active(),
): User {
  return clientAccount(
    MARTIN,
    { firstName: 'Мартин', lastName: 'Илиев' },
    { phone: '+359887654321', email: 'martin@example.test' },
    '1992-09-28',
    lifecycle,
  );
}

/** Online booking paused until 12 October (23:59 in Sofia). */
export function pausedUntilOctober(): AccountLifecycle {
  return AccountLifecycle.block(
    BlockReason.Manual,
    sofia('2026-10-12T23:59:00'),
  );
}

/**
 * The account `verifyOtp` leaves for a holder's phone before he registers
 * — a `PROVISIONED` stub: no names, no roles, no date of birth, the login
 * phone alone (`RegistrationSystem.provision`). `PROFILE_PORTS` answers it
 * as stored; the card must read it as no profile at all.
 */
export function stubOf(
  uid: string,
  lifecycle: AccountLifecycle = AccountLifecycle.active(),
): User {
  return provisionedUserFixture({
    id: UserId.of(uid),
    phone: E164.of(uid === GEORGI ? '+359881234567' : '+359887654321'),
    ...lifecycle,
  });
}

export function subjectOf(
  uid: string,
  overrides: Partial<ClientCardSubject> = {},
): ClientCardSubject {
  const georgi = uid === GEORGI;
  return {
    id: DraftPersonKey.of(uid),
    userId: UserId.of(uid),
    label: georgi ? 'Георги П.' : 'Мартин И.',
    phone: georgi ? '+359 88 123 4567' : '+359 88 765 4321',
    phoneHref: georgi ? '+359881234567' : '+359887654321',
    email: null,
    avatarSrc: null,
    ...overrides,
  };
}

/** A walk-in without a profile: the card reads nothing. */
export const GUEST: ClientCardSubject = {
  id: DraftPersonKey.of('guest-1'),
  userId: null,
  label: 'Иво',
  phone: '+359 89 000 1111',
  phoneHref: '+359890001111',
  email: null,
  avatarSrc: null,
};

/**
 * Георги's held punch-card reward (his twentieth stamp): a grant of the
 * punch card's coupon — the one the catalogue's «Безплатно подстригване»
 * reward mints (`reward-cut`'s `grantCouponId`), so the points never name
 * it while he holds it (OR-15).
 */
export const GEORGI_GRANT: ClientCardGrant = {
  grantId: CouponGrantId.of('grant-dev-georgi-punch'),
  couponId: CouponId.of('coupon-punch-free-cut'),
  value: CouponValue.freeService(),
  title: 'Безплатно подстригване',
  valueLabel: 'Безплатна услуга',
  expiresOn: unwrapOk(LocalDate.parse('2026-10-28')),
  couponOccasion: null,
};

export const BARBER_VIEWER: ClientCardViewer = {
  userId: UserId.of('dev-staff-ivan'),
  roles: [Role.Barber],
};

/** Георги's card, opened from today's settled 10:00 fade (he owns it). */
export function georgiContext(
  overrides: Partial<ClientCardContext> = {},
): ClientCardContext {
  return {
    appointmentId: AppointmentId.of('appt-dev-1'),
    viewer: BARBER_VIEWER,
    isOwner: true,
    settled: true,
    gone: false,
    partyOfOne: true,
    start: startOf('2026-09-28T10:00:00'),
    legs: [
      {
        serviceId: ServiceId.of('svc-fade'),
        variantId: null,
        minutes: duration(45),
        barberId: BarberId.of('ivan'),
      },
    ],
    locationId: LocationId.of('loc-center'),
    grants: [GEORGI_GRANT],
    grantsOnBill: [],
    catalog: SHOP_CATALOG,
    ...overrides,
  };
}

/** A visit of Георги's still to be worked (his next fade, opened early): what «с това посещение» measures. */
export function georgiOpenContext(): ClientCardContext {
  return georgiContext({
    appointmentId: GEORGI_NEXT_ID,
    settled: false,
    start: startOf('2026-10-02T10:00:00'),
    legs: [
      {
        serviceId: ServiceId.of('svc-fade'),
        variantId: null,
        minutes: duration(45),
        barberId: BarberId.of('ivan'),
      },
    ],
  });
}

/** Мартин's card, opened from his cut in the chair (he owns it, holds nothing). */
export function martinContext(
  overrides: Partial<ClientCardContext> = {},
): ClientCardContext {
  return {
    appointmentId: MARTIN_TODAY_ID,
    viewer: BARBER_VIEWER,
    isOwner: true,
    settled: false,
    gone: false,
    partyOfOne: true,
    start: startOf('2026-09-28T12:30:00'),
    legs: [
      {
        serviceId: ServiceId.of('svc-classic-cut'),
        variantId: ServiceVariantId.of('short'),
        minutes: duration(30),
        barberId: BarberId.of('ivan'),
      },
    ],
    locationId: LocationId.of('loc-center'),
    grants: [],
    grantsOnBill: [],
    catalog: SHOP_CATALOG,
    ...overrides,
  };
}

// ── Loyalty, as stored ─────────────────────────────────────────────────

/**
 * A holder's loyalty (`loyaltyAccountFixtures`) keyed by the client record
 * the CARD resolves for him: `customerOf(uid)`, the fixture hash (the
 * fixtures' own key is the production sha256's). Only the record id moves
 * — every figure, day, label and journal id is the stored one.
 */
function keyedByCardRecord(holder: LoyaltyClientFixture): LoyaltyClientFixture {
  const customerId = customerOf(holder.uid);
  return {
    ...holder,
    customerId,
    account: { ...holder.account, id: customerId, customerId },
    clientJournal: holder.clientJournal.map((entry): JournalEntry => ({
      ...entry,
      customerId,
    })),
  };
}

/** Георги's loyalty, keyed by his card record ({@link GEORGI_CUSTOMER_ID}). */
export const GEORGI_LOYALTY: LoyaltyClientFixture = keyedByCardRecord(
  loyaltyAccountFixtures.georgi,
);

/** Мартин's loyalty, keyed by his card record ({@link MARTIN_CUSTOMER_ID}). */
export const MARTIN_LOYALTY: LoyaltyClientFixture = keyedByCardRecord(
  loyaltyAccountFixtures.martin,
);

/** One holder's loyalty, by first name. */
export function loyaltyOf(who: 'georgi' | 'martin'): LoyaltyClientFixture {
  return who === 'georgi' ? GEORGI_LOYALTY : MARTIN_LOYALTY;
}

/** The published catalogue as the port answers it, judged as the store judges it (`LoyaltyCatalogSystem.validate`). */
export function loyaltyCatalog(): ValidLoyaltyCatalog {
  return unwrapOk(LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()));
}

/** The published catalogue with one edit to its documents, judged as the store judges it. */
export function loyaltyCatalogWith(
  edit: (catalog: LoyaltyCatalog) => LoyaltyCatalog,
): ValidLoyaltyCatalog {
  return unwrapOk(LoyaltyCatalogSystem.validate(edit(loyaltyCatalogFixture())));
}

/** The rhythm's head as the published catalogue holds it (`cadence`): one rule in force since 1.03.2025. */
export function rhythmHead(): StreakDefinition {
  return must(
    loyaltyCatalog().streaks.find(
      (head) => head.id === StreakRule.DEFAULT_DEFINITION_ID,
    ),
    'the rhythm’s head',
  );
}

/**
 * The rhythm's head with its rule in force edited — a field or a variant
 * (`{ ...rule, enabled: false }`) — and, when given, a rule that waits for
 * its day beside it (`StreakRuleSystem.schedule` judges the pair, as the
 * publish does).
 */
export function rhythmHeadWith(
  edit: (rule: StreakRule) => StreakRule = (rule) => rule,
  scheduled: ScheduledStreakRule | null = null,
): StreakDefinition {
  const head = rhythmHead();
  const { rules } = unwrapOk(
    StreakRuleSystem.schedule(edit(StreakRuleSystem.current(head)), scheduled),
  );
  return { ...head, rules };
}

/** One holder's `AchievementsData`, as the store assembles it. */
export function achievementsDataOf(
  who: 'georgi' | 'martin',
  previousVisitUtcMs: UtcEpochMs | null,
): AchievementsData {
  const holder = loyaltyOf(who);
  return {
    catalog: loyaltyCatalog(),
    account: holder.account,
    progress: new Map<BadgeSeriesId, BadgeProgress>(
      holder.badgeProgress.map((progress) => [progress.id, progress]),
    ),
    seasonProgress: new Map<SeasonId, SeasonProgress>(
      holder.seasonProgress.map((progress) => [progress.id, progress]),
    ),
    today: TODAY,
    previousVisitUtcMs,
  };
}

/** Георги's previous worked visit before today's: Thursday 3 September, 10:00. */
export const GEORGI_PREVIOUS_MS: UtcEpochMs = sofia('2026-09-03T10:00:00');

/** Мартин's previous worked visit: Wednesday 19 August, 12:30. */
export const MARTIN_PREVIOUS_MS: UtcEpochMs = sofia('2026-08-19T12:30:00');

export function achievementsContextOf(
  context: ClientCardContext,
  subjectName: string,
  birthdayToday = false,
  words: ClientCardWords = wordsOf('bg'),
): AchievementsContext {
  const open = context.appointmentId !== null && !context.settled;
  return {
    words,
    catalog: context.catalog,
    subjectName,
    visit: open
      ? {
          legs: context.legs,
          start: context.start,
          locationId: context.locationId,
          birthdayToday,
        }
      : null,
    zone: SHOP_TIME_ZONE,
  };
}

// ── Ports, in memory ───────────────────────────────────────────────────

/**
 * The deployment's default location — the fixture centre shop, on
 * {@link SHOP_TIME_ZONE} — as the card's `ShopZoneService` reads the shop's
 * zone (`LOCATION_LOAD_PORTS` & `DEFAULT_LOCATION_PORTS`, Phase 4a 4A-11).
 */
export function shopZonePortsOf(): LocationLoadPorts & DefaultLocationPorts {
  const shop = locationFixture({ timeZone: SHOP_TIME_ZONE });
  return {
    ...memoryLocationLoadPorts(memoryProgramsWorld({ locations: [shop] })),
    ...memoryDefaultLocationPorts(shop.id),
  };
}

/**
 * `AVATAR_PORTS` that knows one picture per person — `@core/testing`'s
 * `memoryAvatarPorts` over the given urls, by uid (`avatars/{uid}`).
 */
export function avatarPortsOf(
  urls: ReadonlyMap<string, string> = new Map(),
): AvatarPorts {
  return memoryAvatarPorts(
    new Map(
      [...urls].map(([uid, url]) => [
        UserId.of(uid),
        { path: `avatars/${uid}`, url },
      ]),
    ),
  );
}

// ── The booking ports: the `@core/testing` doubles, failing on demand ───

/** One read a double answered: the port method and its arguments. */
export interface PortCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A `@core/testing` port double that records every read and fails on
 * demand: from `failWith()` until `recover()` each method answers the
 * error — a stream port in one emission, as its adapter would.
 */
export type PortDouble<P> = P & {
  readonly calls: PortCall[];
  /** The arguments of every call to `method`, in order. */
  callsTo(method: keyof P & string): readonly (readonly unknown[])[];
  failWith(error?: CoreRepositoryError): PortDouble<P>;
  recover(): PortDouble<P>;
};

export function portDouble<P extends object>(ports: P): PortDouble<P> {
  const calls: PortCall[] = [];
  let failure: CoreRepositoryError | null = null;
  const members: Record<string, unknown> = {};
  for (const [method, member] of Object.entries(ports)) {
    if (typeof member !== 'function') {
      members[method] = member;
      continue;
    }
    const read = member as (...args: unknown[]) => unknown;
    members[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      const answer = read(...args);
      if (failure === null) return answer;
      const refused = CoreResult.err(failure);
      return isObservable(answer) ? of(refused) : Promise.resolve(refused);
    };
  }
  const double = Object.assign(members, {
    calls,
    callsTo: (method: string) =>
      calls.filter((call) => call.method === method).map((call) => call.args),
    failWith: (
      error: CoreRepositoryError = CoreRepositoryError.unavailable(),
    ) => {
      failure = error;
      return double;
    },
    recover: () => {
      failure = null;
      return double;
    },
  }) as unknown as PortDouble<P>;
  return double;
}

/** `CLIENT_STATS_READ_PORTS` over the stats pairs. */
export function statsPortsOf(
  stats: readonly ClientStatsRecord[],
  money: readonly ClientMoneyRecord[] = [],
): PortDouble<ClientStatsReadPorts> {
  return portDouble(memoryClientStatsReadPorts({ stats, money }));
}

/** `APPOINTMENT_READ_PORTS` over a book — the history pages. */
export function historyPortsOf(
  appointments: readonly Appointment[],
): PortDouble<AppointmentReadPorts> {
  return portDouble(memoryAppointmentReadPorts(appointments));
}

/** `APPOINTMENT_PHOTO_PORTS` over the photos — the rail and the rows' counts. */
export function photoPortsOf(
  photos: readonly AppointmentPhoto[],
): PortDouble<AppointmentPhotoPorts> {
  return portDouble(memoryAppointmentPhotoPorts([...photos]));
}

/** `WAITLIST_READ_PORTS` over the requests. */
export function waitlistPortsOf(
  requests: readonly WaitlistRequest[] = [],
): PortDouble<WaitlistReadPorts> {
  return portDouble(memoryWaitlistReadPorts(requests));
}

/** `COUPON_VOUCHER_PORTS` over the vouchers — the fixture's five unless said. */
export function voucherPortsOf(
  vouchers: readonly GiftVoucher[] = fixtureVouchers(),
): PortDouble<CouponVoucherPorts> {
  return portDouble(memoryCouponVoucherPorts({ vouchers }));
}

/**
 * `PROFILE_PORTS` over the accounts — Георги's and Мартин's unless said —
 * answered AS STORED (a `PROVISIONED` stub included; the card judges).
 */
export function profilePortsOf(
  users: readonly User[] = [georgiUser(), martinUser()],
): PortDouble<ProfilePorts> {
  return portDouble(
    memoryProfilePorts(new Map(users.map((user) => [user.id, user]))),
  );
}

/** {@link profilePortsOf} with its `loadProfile` held until {@link HeldProfileReads.answer}. */
export type HeldProfileReads = PortDouble<ProfilePorts> & {
  /** Lets every held read answer (and every later one at once): the D-9 gate opens. */
  readonly answer: () => void;
};

/**
 * `users/{uid}` answering only when the spec says so: the D-9 gate held
 * shut, the whole card in its first state (S1).
 */
export function heldProfilePortsOf(
  users: readonly User[] = [georgiUser(), martinUser()],
): HeldProfileReads {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const memory = memoryProfilePorts(
    new Map(users.map((user) => [user.id, user])),
  );
  const held: ProfilePorts = {
    ...memory,
    loadProfile: async (userId) => {
      await gate;
      return memory.loadProfile(userId);
    },
  };
  return Object.assign(portDouble(held), { answer: () => release() });
}

/** `CUSTOMER_PORTS` over the client records — Георги's and Мартин's unless said. */
export function customerPortsOf(
  customers: readonly Customer[] = fixtureCustomers(),
): PortDouble<CustomerPorts> {
  return portDouble(memoryCustomerPorts(customers));
}

/**
 * `LOYALTY_ACCOUNT_READ_PORTS` over the two holders' loyalty, keyed by the
 * card's records (`GEORGI_LOYALTY`, `MARTIN_LOYALTY`) unless said — the
 * `@core/testing` double, recording every read and failing on demand.
 */
export function loyaltyPortsOf(
  holders: readonly LoyaltyClientFixture[] = [GEORGI_LOYALTY, MARTIN_LOYALTY],
): PortDouble<LoyaltyAccountReadPorts> {
  return portDouble(memoryLoyaltyAccountReadPorts(memoryLoyaltyWorld(holders)));
}

/** `LOYALTY_CATALOG_READ_PORTS` answering the published catalogue (or the one given), as the port answers it. */
export function catalogPortsOf(
  catalog: LoyaltyCatalog = loyaltyCatalogFixture(),
): PortDouble<LoyaltyCatalogReadPorts> {
  return portDouble(memoryLoyaltyCatalogReadPorts(catalog));
}

/** `CLIENT_JOURNAL_PORTS` over the two holders' journals (or the rows given). */
export function journalPortsOf(
  entries: readonly JournalEntry[] = [
    ...GEORGI_LOYALTY.clientJournal,
    ...MARTIN_LOYALTY.clientJournal,
  ],
): PortDouble<ClientJournalPorts> {
  return portDouble(memoryClientJournalPorts(entries));
}
