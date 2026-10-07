/**
 * TEST SUPPORT for `staff-client-card` — never part of the lib's build
 * (`tsconfig.lib.json` excludes `src/testing/**`), imported by specs only.
 *
 * The dev shop's two loyalty holders, Георги Петров (`dev-client-1`) and
 * Мартин Илиев (`dev-client-2`), rebuilt from the A0 loyalty fixtures
 * (`@creativo/application/engagement/testing`): every worked visit their
 * point journal records becomes the appointment that earned it — the same
 * day, seats, prices and barbers — so the history, the stats, the loyalty
 * and the achievements a spec renders all tell one story. The catalogue is
 * the dev seed's; the words are the app's own catalogue, so a key a
 * presenter names and the catalogue lacks fails in a spec.
 *
 * «Now» is Monday 28 September 2026, 12:40 in Sofia (`loyaltyFixtures.today`):
 * Георги's 10:00 fade is done (he is the settled card), Мартин is in the
 * chair for his 12:30 classic cut on his birthday (the open card).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Observable, of } from 'rxjs';
import {
  AccountStatus,
  type AvatarRef,
  type AvatarUploader,
  type ProfilePort,
  User,
  UserId,
  ZonedDateTime,
} from '@creativo/application/accounts';
import {
  Appointment,
  type AppointmentPhoto,
  BookingContact,
  type ClientMoneyRecord,
  type ClientStatsReader,
  type ClientStatsRecord,
  type Result,
  SEAT_SCHEDULED,
  Seat,
  SeatId,
  SeatSubject,
  type WaitlistReader,
  WaitlistRequest,
  computeClientStats,
  fail,
  ok,
  seatCancelled,
  seatWorked,
} from '@creativo/application/booking';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/application/catalog';
import {
  type BadgeProgress,
  type SeasonProgress,
  badgeProgressFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  seasonProgressFromDocument,
} from '@creativo/application/engagement';
import {
  type LoyaltyAccountFixture,
  type LoyaltyCatalogFixture,
  loyaltyFixtures,
} from '@creativo/application/engagement/testing';
import { RepositoryError } from '@creativo/application/shared';
import type {
  ClientCardCatalog,
  ClientCardContext,
  ClientCardGrant,
  ClientCardSubject,
} from '../lib/client-card.contracts';
import type { AchievementsContext } from '../lib/achievements.presenter';
import type { AchievementsData } from '../lib/client-pages.vm';
import {
  type ClientCardTranslate,
  type ClientCardWords,
  clientCardWordsOf,
} from '../lib/client-card.words';

export const ZONE = 'Europe/Sofia';
export const GEORGI = 'dev-client-1';
export const MARTIN = 'dev-client-2';
export const TODAY = loyaltyFixtures.today;

/** A value a fixture guarantees; a spec that finds it missing has a broken fixture. */
export function must<T>(
  value: T | null | undefined,
  what = 'fixture value',
): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`bad fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** A Sofia wall-clock time as an instant. */
export function at(iso: string): ZonedDateTime {
  return unwrap(ZonedDateTime.fromISO(iso, ZONE));
}

/** Monday 28 September 2026, 12:40 in Sofia. */
export const NOW_MS = at('2026-09-28T12:40:00').toMillis();

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

/** `formatMoney`'s bg form keeps the sign on the figure's line: a no-break space. */
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
      : { id: category, name };
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
  readonly workedAtMs: number;
  readonly serviceId: string;
  readonly minutes: number;
  readonly priceMinor: number;
}

/** Every worked seat the journal paid points for, oldest first. */
function workedSeatsOf(fixture: LoyaltyAccountFixture): readonly WorkedSeat[] {
  return Object.values(fixture.clientJournal)
    .flatMap((entry): WorkedSeat[] => {
      const spend = new Map(Object.entries(entry.publicLabel.params)).get(
        'spendMinor',
      );
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
          workedAtMs: Date.parse(entry.at),
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

interface SeatSpec {
  readonly id: string;
  readonly who: string;
  readonly serviceId: string;
  readonly variantId?: string | null;
  readonly barberId: string;
  readonly minutes: number;
  readonly priceMinor: number;
  readonly startsAt: ZonedDateTime;
  readonly outcome?: Seat['outcome'];
}

function seatOf(spec: SeatSpec): Seat {
  return Seat.of({
    id: unwrap(SeatId.create(spec.id)),
    subject: SeatSubject.account(unwrap(UserId.create(spec.who)), 'self'),
    serviceId: unwrap(ServiceId.create(spec.serviceId)),
    variantId:
      spec.variantId == null
        ? null
        : unwrap(ServiceVariantId.create(spec.variantId)),
    barberId: unwrap(BarberId.create(spec.barberId)),
    terms: unwrap(
      ServiceTerms.fromMinorUnits(spec.priceMinor, 'EUR', spec.minutes),
    ),
    startsAt: spec.startsAt,
    outcome: spec.outcome ?? SEAT_SCHEDULED,
  });
}

function contactOf(name: string, phone: string, note: string | null) {
  return unwrap(BookingContact.create({ name, phone, email: null, note }));
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

/** The journal's worked visits as completed appointments at Център, each seat after the one before. */
function workedHistory(
  fixture: LoyaltyAccountFixture,
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
    const start = unwrap(
      ZonedDateTime.fromMillis(worked - total * 60_000, ZONE),
    );
    let cursor = start;
    const barberId = plan.barberOf(index);
    const built = seats.map((seat) => {
      const startsAt = cursor;
      cursor = cursor.plusMinutes(seat.minutes);
      return seatOf({
        id: seat.seatId,
        who: plan.uid,
        serviceId: seat.serviceId,
        barberId,
        minutes: seat.minutes,
        priceMinor: seat.priceMinor,
        startsAt,
        outcome: seatWorked(seat.workedAtMs),
      });
    });
    return unwrap(
      Appointment.reconstitute({
        id: appointmentId,
        locationId: 'loc-center',
        seats: built,
        status: { kind: 'completed' },
        contact: contactOf(
          plan.name,
          plan.phone,
          plan.notes?.get(appointmentId) ?? null,
        ),
        bookedAt: start.plusDays(-14),
      }),
    );
  });
}

/** Георги's last settled visit before today — his own words on it. */
export const GEORGI_NOTE = 'Къса отстрани, по-дълго отгоре';

/** Георги's next booking: Friday 2 October, 10:00, a fade with Иван, rebooked in the chair today. */
export const GEORGI_NEXT_ID = 'appt-dev-georgi-next';

/**
 * Георги Петров's book: 24 worked visits since 6.03.2025, every one a fade
 * with Иван at Център at 10:00 (six with a beard), today's included, and
 * one visit ahead.
 */
export function georgiHistory(): readonly Appointment[] {
  const worked = workedHistory(loyaltyFixtures.georgi, {
    uid: GEORGI,
    name: 'Георги Петров',
    phone: '+359881234567',
    barberOf: () => 'ivan',
    notes: new Map([['appt-hist-c1-23', GEORGI_NOTE]]),
  });
  const next = unwrap(
    Appointment.reconstitute({
      id: GEORGI_NEXT_ID,
      locationId: 'loc-center',
      seats: [
        seatOf({
          id: 'seat-next-1',
          who: GEORGI,
          serviceId: 'svc-fade',
          barberId: 'ivan',
          minutes: 45,
          priceMinor: 1750,
          startsAt: at('2026-10-02T10:00:00'),
        }),
      ],
      status: { kind: 'confirmed' },
      contact: contactOf('Георги Петров', '+359881234567', null),
      bookedAt: at('2026-09-28T10:45:00'),
    }),
  );
  return [...worked, next];
}

/** Мартин's cut in the chair today: 12:30, a short classic cut with Иван, in his own words. */
export const MARTIN_TODAY_ID = 'appt-dev-2';

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
  const worked = workedHistory(loyaltyFixtures.martin, {
    uid: MARTIN,
    name: 'Мартин Илиев',
    phone: '+359887654321',
    barberOf: (index) => chairs.at(index) ?? 'ivan',
  });
  const cancelledAt = at('2026-05-10T09:00:00').toMillis();
  const cancelled = unwrap(
    Appointment.reconstitute({
      id: 'appt-hist-c2-11',
      locationId: 'loc-center',
      seats: [
        seatOf({
          id: 'appt-hist-c2-11-s1',
          who: MARTIN,
          serviceId: 'svc-classic-cut',
          barberId: 'niko',
          minutes: 30,
          priceMinor: 1500,
          startsAt: at('2026-05-12T12:30:00'),
          outcome: seatCancelled(
            cancelledAt,
            'staff',
            { kind: 'staff_barber_absence' },
            null,
          ),
        }),
      ],
      status: { kind: 'cancelled', reason: 'Нико отсъства' },
      contact: contactOf('Мартин Илиев', '+359887654321', null),
      bookedAt: at('2026-04-22T13:00:00'),
    }),
  );
  const today = unwrap(
    Appointment.reconstitute({
      id: MARTIN_TODAY_ID,
      locationId: 'loc-center',
      seats: [
        seatOf({
          id: 'seat-2',
          who: MARTIN,
          serviceId: 'svc-classic-cut',
          variantId: 'short',
          barberId: 'ivan',
          minutes: 30,
          priceMinor: 1500,
          startsAt: at('2026-09-28T12:30:00'),
        }),
      ],
      status: { kind: 'confirmed' },
      contact: contactOf('Мартин Илиев', '+359887654321', 'Къса отстрани'),
      bookedAt: at('2026-09-21T12:00:00'),
      arrivedAt: at('2026-09-28T12:25:00'),
    }),
  );
  return [...worked, cancelled, today];
}

/** The projection the server keeps, computed from the same book at «now». */
export function statsOf(
  uid: string,
  appointments: readonly Appointment[],
  nowMs = NOW_MS,
): ClientStatsRecord {
  return {
    ...computeClientStats(unwrap(UserId.create(uid)), appointments, nowMs),
    version: 1,
    updatedAtMs: nowMs,
  };
}

/** Георги's lifetime spend — the ‹admin› figure. */
export const GEORGI_MONEY: ClientMoneyRecord = {
  userId: unwrap(UserId.create(GEORGI)),
  lifetimeSpendMinor: 46250,
  currencyCode: 'EUR',
  version: 1,
  updatedAtMs: NOW_MS,
};

/** The three past cuts on Георги's last three visits, newest first (the dev seed's). */
export function georgiPhotos(): readonly AppointmentPhoto[] {
  const shots: readonly [string, string][] = [
    ['appt-dev-1', '2026-09-28T10:44:00'],
    ['appt-hist-c1-23', '2026-09-03T10:44:00'],
    ['appt-hist-c1-22', '2026-08-06T10:44:00'],
  ];
  return shots.map(([appointmentId, taken], index) => ({
    photoId: `photo-dev-georgi-${index + 1}`,
    appointmentId,
    barberId: 'ivan',
    clientUserId: GEORGI,
    clientLabel: 'Георги Петров',
    takenByUid: 'dev-staff-ivan',
    takenAtIso: at(taken).toISO(),
    path: `appointmentPhotos/${appointmentId}/photo-dev-georgi-${index + 1}.jpg`,
    url: `https://example.test/photos/photo-dev-georgi-${index + 1}.jpg`,
    width: 1100,
    height: 1400,
    origin: 'shot',
    label: null,
  }));
}

/** Мартин's waitlist request: Thursday and Friday next week, 14:00–17:00, a short classic cut; created last night. */
export function martinWaitlist(
  overrides: Partial<{
    readonly status: 'open' | 'matched' | 'booked';
    readonly createdAtIso: string;
    readonly id: string;
  }> = {},
): WaitlistRequest {
  return unwrap(
    WaitlistRequest.reconstitute({
      id: overrides.id ?? 'waitlist-dev-martin',
      ownerId: MARTIN,
      locationId: 'loc-center',
      when: {
        days: [
          { dayKey: '2026-10-08', windows: [{ from: '14:00', to: '17:00' }] },
          { dayKey: '2026-10-09', windows: [{ from: '14:00', to: '17:00' }] },
        ],
      },
      cart: {
        seats: [
          {
            seatKey: 'self',
            lines: [
              {
                id: 'line-1',
                serviceId: 'svc-classic-cut',
                variantId: 'short',
                barberId: null,
              },
            ],
          },
        ],
        nextSequence: 2,
      },
      status: overrides.status ?? 'open',
      createdAtIso: overrides.createdAtIso ?? '2026-09-27T21:10:00+03:00',
      zone: ZONE,
    }),
  );
}

// ── The people ─────────────────────────────────────────────────────────

const TODAY_AT = at('2026-09-28T12:40:00');

export function georgiUser(
  status: AccountStatus = AccountStatus.active(),
): User {
  return unwrap(
    User.reconstitute(
      {
        id: GEORGI,
        phone: '+359881234567',
        firstName: 'Георги',
        lastName: 'Петров',
        roles: ['client'],
        status,
        email: 'georgi@example.test',
        birthDate: '1990-04-14',
      },
      TODAY_AT,
    ),
  );
}

/** Мартин — his birthday is today. */
export function martinUser(
  status: AccountStatus = AccountStatus.active(),
): User {
  return unwrap(
    User.reconstitute(
      {
        id: MARTIN,
        phone: '+359887654321',
        firstName: 'Мартин',
        lastName: 'Илиев',
        roles: ['client'],
        status,
        email: 'martin@example.test',
        birthDate: '1992-09-28',
      },
      TODAY_AT,
    ),
  );
}

/** Online booking paused until 12 October. */
export function pausedUntilOctober(): AccountStatus {
  return AccountStatus.blocked({
    reason: 'manual',
    until: at('2026-10-12T23:59:00'),
  });
}

export function subjectOf(
  uid: string,
  overrides: Partial<ClientCardSubject> = {},
): ClientCardSubject {
  const georgi = uid === GEORGI;
  return {
    id: uid,
    userId: uid,
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
  id: 'guest-1',
  userId: null,
  label: 'Иво',
  phone: '+359 89 000 1111',
  phoneHref: '+359890001111',
  email: null,
  avatarSrc: null,
};

/** Георги's held punch-card reward (his twentieth stamp). */
export const GEORGI_GRANT: ClientCardGrant = {
  grantId: 'grant-dev-georgi-punch',
  title: 'Безплатно подстригване',
  valueLabel: 'Безплатна услуга',
  expiresOn: '2026-10-28',
};

export const BARBER_VIEWER = {
  uid: 'dev-staff-ivan',
  roles: ['barber'],
} as const;

/** Георги's card, opened from today's settled 10:00 fade (he owns it). */
export function georgiContext(
  overrides: Partial<ClientCardContext> = {},
): ClientCardContext {
  return {
    appointmentId: 'appt-dev-1',
    viewer: BARBER_VIEWER,
    isOwner: true,
    settled: true,
    gone: false,
    partyOfOne: true,
    legs: [
      {
        serviceId: 'svc-fade',
        variantId: null,
        minutes: 45,
        barberId: 'ivan',
        startsAtIso: at('2026-09-28T10:00:00').toISO(),
      },
    ],
    locationId: 'loc-center',
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
    legs: [
      {
        serviceId: 'svc-fade',
        variantId: null,
        minutes: 45,
        barberId: 'ivan',
        startsAtIso: at('2026-10-02T10:00:00').toISO(),
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
    legs: [
      {
        serviceId: 'svc-classic-cut',
        variantId: 'short',
        minutes: 30,
        barberId: 'ivan',
        startsAtIso: at('2026-09-28T12:30:00').toISO(),
      },
    ],
    locationId: 'loc-center',
    grants: [],
    grantsOnBill: [],
    catalog: SHOP_CATALOG,
    ...overrides,
  };
}

// ── Loyalty, parsed ────────────────────────────────────────────────────

/** The published catalogue, parsed as production parses it. */
export function loyaltyCatalog() {
  return unwrap(loyaltyCatalogFromDocuments(loyaltyFixtures.catalog));
}

/** The published catalogue with one edit to its documents, parsed as production parses it. */
export function loyaltyCatalogWith(
  edit: (documents: LoyaltyCatalogFixture) => LoyaltyCatalogFixture,
) {
  const copy = JSON.parse(
    JSON.stringify(loyaltyFixtures.catalog),
  ) as LoyaltyCatalogFixture;
  return unwrap(loyaltyCatalogFromDocuments(edit(copy)));
}

function progressOf(
  fixture: LoyaltyAccountFixture,
): ReadonlyMap<string, BadgeProgress> {
  return new Map(
    Object.entries(fixture.badgeProgress).map(([id, doc]) => [
      id,
      unwrap(badgeProgressFromDocument(id, doc)),
    ]),
  );
}

function seasonsOf(
  fixture: LoyaltyAccountFixture,
): ReadonlyMap<string, SeasonProgress> {
  return new Map(
    Object.entries(fixture.seasonProgress).map(([id, doc]) => [
      id,
      unwrap(seasonProgressFromDocument(id, doc)),
    ]),
  );
}

/** One holder's `AchievementsData`, as the store assembles it. */
export function achievementsDataOf(
  who: 'georgi' | 'martin',
  previousVisitAtMs: number | null,
): AchievementsData {
  const fixture =
    who === 'georgi' ? loyaltyFixtures.georgi : loyaltyFixtures.martin;
  return {
    catalog: loyaltyCatalog(),
    account: unwrap(
      loyaltyAccountFromDocument(fixture.account.userId, fixture.account),
    ),
    progress: progressOf(fixture),
    seasonProgress: seasonsOf(fixture),
    today: TODAY,
    previousVisitAtMs,
  };
}

/** Георги's previous worked visit before today's: Thursday 3 September, 10:00. */
export const GEORGI_PREVIOUS_MS = at('2026-09-03T10:00:00').toMillis();

/** Мартин's previous worked visit: Wednesday 19 August, 12:30. */
export const MARTIN_PREVIOUS_MS = at('2026-08-19T12:30:00').toMillis();

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
      ? { legs: context.legs, locationId: context.locationId, birthdayToday }
      : null,
  };
}

// ── Ports, in memory ───────────────────────────────────────────────────

/** `PROFILE_PORT` over a map of users; `failWith` makes every read fail. */
export class InMemoryProfilePort implements ProfilePort {
  readonly calls: string[] = [];
  private failure: RepositoryError | null = null;
  constructor(private readonly users: ReadonlyMap<string, User | null>) {}
  failWith(error = new RepositoryError('users/{uid} unavailable')): this {
    this.failure = error;
    return this;
  }
  recover(): this {
    this.failure = null;
    return this;
  }
  async getProfile(
    userId: UserId,
  ): Promise<Result<User | null, RepositoryError>> {
    this.calls.push(userId.value);
    if (this.failure !== null) return fail(this.failure);
    return ok(this.users.get(userId.value) ?? null);
  }
  observeProfile(
    userId: UserId,
  ): Observable<Result<User | null, RepositoryError>> {
    return of(ok(this.users.get(userId.value) ?? null));
  }
  async saveProfile(): Promise<Result<void, RepositoryError>> {
    return fail(new RepositoryError('the card never writes a profile'));
  }
}

/** `CLIENT_STATS_READER` over a map of records. */
export class InMemoryStatsReader implements ClientStatsReader {
  readonly moneyCalls: string[] = [];
  private failure: RepositoryError | null = null;
  constructor(
    private readonly stats: ReadonlyMap<string, ClientStatsRecord>,
    private readonly money: ReadonlyMap<string, ClientMoneyRecord> = new Map(),
  ) {}
  failWith(error = new RepositoryError('clientStats unavailable')): this {
    this.failure = error;
    return this;
  }
  recover(): this {
    this.failure = null;
    return this;
  }
  async get(
    userId: string,
  ): Promise<Result<ClientStatsRecord | null, RepositoryError>> {
    if (this.failure !== null) return fail(this.failure);
    return ok(this.stats.get(userId) ?? null);
  }
  async getMoney(
    userId: string,
  ): Promise<Result<ClientMoneyRecord | null, RepositoryError>> {
    this.moneyCalls.push(userId);
    return ok(this.money.get(userId) ?? null);
  }
}

/** `AVATAR_UPLOADER` that knows one picture per person. */
export class InMemoryAvatars implements AvatarUploader {
  constructor(
    private readonly avatars: ReadonlyMap<string, string> = new Map(),
  ) {}
  async upload(): Promise<Result<AvatarRef, never>> {
    throw new Error('the card never uploads');
  }
  async find(userId: UserId): Promise<Result<AvatarRef | null, never>> {
    const url = this.avatars.get(userId.value);
    return ok(
      url === undefined ? null : { url, path: `avatars/${userId.value}` },
    );
  }
  async remove(): Promise<Result<void, never>> {
    throw new Error('the card never removes an avatar');
  }
}

/** `WAITLIST_READER` answering one list per owner, or failing. */
export class InMemoryWaitlistReader implements WaitlistReader {
  private failure: RepositoryError | null = null;
  constructor(private readonly requests: readonly WaitlistRequest[] = []) {}
  failWith(error = new RepositoryError('waitlist unavailable')): this {
    this.failure = error;
    return this;
  }
  observeMine(
    userId: UserId,
  ): Observable<Result<readonly WaitlistRequest[], RepositoryError>> {
    if (this.failure !== null) return of(fail(this.failure));
    return of(ok(this.requests.filter((r) => r.ownerId.equals(userId))));
  }
  async findMine(
    requestId: string,
  ): Promise<Result<WaitlistRequest | null, RepositoryError>> {
    return ok(this.requests.find((r) => r.id.value === requestId) ?? null);
  }
}
