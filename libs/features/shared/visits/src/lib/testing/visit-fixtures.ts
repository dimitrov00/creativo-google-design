import {
  type EnvironmentProviders,
  Injectable,
  InjectionToken,
  type Provider,
  inject,
} from '@angular/core';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { UserId } from '@creativo/application/accounts';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { CouponValue } from '@creativo/application/engagement';
import {
  AppliedDiscount,
  Appointment,
  type AppointmentPhoto,
  type AppointmentStatus,
  BookingContact,
  type ClientHistoryReader,
  type ClientPhotosReader,
  type Result,
  SEAT_SCHEDULED,
  Seat,
  SeatId,
  type SeatOutcome,
  SeatSubject,
  WaitlistRequest,
  ZonedDateTime,
  seatCancelled,
  seatNoShow,
  seatWorked,
} from '@creativo/application/booking';
import {
  type VisitRowOptions,
  type VisitTranslate,
  visitRowOf,
} from '../visit-row.presenter';
import type { VisitLookup, VisitRowVm } from '../visit-row.vm';

/*
 * TEST SUPPORT for this library's component specs — never production API:
 * nothing here is exported from `src/index.ts`, and `tsconfig.lib.json`
 * keeps `src/lib/testing/**` out of the library build.
 *
 * Георги Петров's book as the dev seed tells it (`dev-client-1`, the
 * loyalty fixtures' Георги), on the fixtures' own calendar day — the last
 * visit with his words and a photo, a discounted cut with a beard, a
 * cancellation, a no-show, a party with Иво at the other shop, the visit on
 * screen and the one after it. Built through the domain's own factories,
 * so every row the specs draw is a row the presenter really builds; served
 * through `InMemoryClientHistoryReader` / `InMemoryClientPhotosReader` by
 * the specs, exactly as the Firestore adapters page it.
 */

export const VISITS_ZONE = 'Europe/Sofia';
/** Георги Петров — `InMemoryLoyaltyReader.seeded()`'s uid for him. */
export const GEORGI_UID = 'dev-client-1';
/** Иво, the companion on Георги's December party. */
export const IVO_UID = 'dev-client-10';
/** The appointment the staff sheet is open on: today, 10:00, with Иван. */
export const CURRENT_APPOINTMENT_ID = 'appt-today';

const SERVICES = new Map([
  ['svc-fade', 'Фейд'],
  ['svc-beard', 'Оформяне на брада'],
]);
const BARBERS = new Map([
  ['barber-ivan', 'Иван'],
  ['barber-petar', 'Петър'],
]);
const LOCATIONS = new Map([
  ['loc-center', 'Център'],
  ['loc-mladost', 'Младост'],
]);

/** The shop's catalogue as a row reads it: two shops, so a worked visit names its own. */
export const VISITS_LOOKUP: VisitLookup = {
  serviceName: (id) => SERVICES.get(id) ?? null,
  barberName: (id) => BARBERS.get(id) ?? null,
  barberAvatarSrc: (id) =>
    id === 'barber-ivan' ? 'https://example.test/barbers/ivan.jpg' : null,
  locationName: (id) => LOCATIONS.get(id) ?? null,
  locationCount: LOCATIONS.size,
};

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('bad visits fixture');
  return result.value;
}

/** A wall-clock instant on the shops' calendar. */
export function sofia(iso: string): ZonedDateTime {
  return unwrap(ZonedDateTime.fromISO(iso, VISITS_ZONE));
}

/** The loyalty fixtures' day (`loyaltyFixtures.today`), 09:00 in Sofia — before the 10:00 visit. */
export function visitsNowMs(today: string): number {
  return sofia(`${today}T09:00:00`).toMillis();
}

interface SeatSpec {
  readonly id: string;
  readonly who?: string;
  readonly relationship?: 'self' | 'companion';
  readonly service?: string;
  readonly barber?: string;
  readonly priceMinor?: number;
  readonly minutes?: number;
  readonly outcome?: SeatOutcome;
}

function seat(startIso: string, spec: SeatSpec): Seat {
  return Seat.of({
    id: unwrap(SeatId.create(spec.id)),
    subject: SeatSubject.account(
      unwrap(UserId.create(spec.who ?? GEORGI_UID)),
      spec.relationship ?? 'self',
    ),
    serviceId: unwrap(ServiceId.create(spec.service ?? 'svc-fade')),
    variantId: null,
    barberId: unwrap(BarberId.create(spec.barber ?? 'barber-ivan')),
    terms: unwrap(
      ServiceTerms.fromMinorUnits(
        spec.priceMinor ?? 2750,
        'EUR',
        spec.minutes ?? 30,
      ),
    ),
    startsAt: sofia(startIso),
    outcome: spec.outcome ?? SEAT_SCHEDULED,
  });
}

function appointment(
  id: string,
  locationId: string,
  seats: readonly Seat[],
  status: AppointmentStatus,
  extras: { readonly note?: string; readonly discountAtIso?: string } = {},
): Appointment {
  const built = unwrap(
    Appointment.reconstitute({
      id,
      locationId,
      seats: [...seats],
      status,
      contact:
        extras.note === undefined
          ? null
          : unwrap(
              BookingContact.create({
                name: 'Георги Петров',
                phone: '+359881234567',
                email: null,
                note: extras.note,
              }),
            ),
    }),
  );
  if (extras.discountAtIso === undefined) return built;
  return built.withDiscounts([
    AppliedDiscount.of({
      id: 'code:FIRST10',
      source: 'code',
      label: 'FIRST10',
      value: unwrap(CouponValue.percentOff(10)),
      code: 'FIRST10',
      appliedAt: sofia(extras.discountAtIso),
    }),
  ]);
}

const worked = (iso: string) => seatWorked(sofia(iso).toMillis());

/** Георги's book, newest first — what `pageForSubject` pages through. */
export const GEORGI_VISITS: readonly Appointment[] = [
  // The one after this: requested online, not yet confirmed.
  appointment(
    'appt-oct',
    'loc-center',
    [seat('2026-10-02T10:00:00', { id: 'seat-oct' })],
    { kind: 'pending' },
  ),
  // The visit on screen.
  appointment(
    CURRENT_APPOINTMENT_ID,
    'loc-center',
    [seat('2026-09-28T10:00:00', { id: 'seat-today' })],
    { kind: 'confirmed' },
  ),
  // The last visit: his words, one photo.
  appointment(
    'appt-sep',
    'loc-center',
    [
      seat('2026-09-04T10:00:00', {
        id: 'seat-sep',
        outcome: worked('2026-09-04T10:35:00'),
      }),
    ],
    { kind: 'completed' },
    { note: 'Къса отстрани, по-дълго отгоре' },
  ),
  // A cut and a beard with a first-visit code: two photos.
  appointment(
    'appt-aug',
    'loc-center',
    [
      seat('2026-08-12T17:30:00', {
        id: 'seat-aug-cut',
        outcome: worked('2026-08-12T18:00:00'),
      }),
      seat('2026-08-12T18:00:00', {
        id: 'seat-aug-beard',
        service: 'svc-beard',
        priceMinor: 1500,
        minutes: 15,
        outcome: worked('2026-08-12T18:15:00'),
      }),
    ],
    { kind: 'completed' },
    { discountAtIso: '2026-08-12T18:20:00' },
  ),
  // Called off by Георги the evening before.
  appointment(
    'appt-jul-cancelled',
    'loc-center',
    [
      seat('2026-07-16T10:00:00', {
        id: 'seat-jul-cancelled',
        priceMinor: 1750,
        outcome: seatCancelled(
          sofia('2026-07-15T18:00:00').toMillis(),
          'client',
          { kind: 'client_changed_plans' },
          null,
        ),
      }),
    ],
    { kind: 'cancelled', reason: 'client_changed_plans' },
  ),
  // Did not come.
  appointment(
    'appt-jul-no-show',
    'loc-center',
    [
      seat('2026-07-07T10:00:00', {
        id: 'seat-jul-no-show',
        outcome: seatNoShow(sofia('2026-07-07T10:20:00').toMillis()),
      }),
    ],
    { kind: 'no_show' },
  ),
  // Last December at the other shop, with Иво in the next chair.
  appointment(
    'appt-dec-party',
    'loc-mladost',
    [
      seat('2025-12-05T11:00:00', {
        id: 'seat-dec-georgi',
        barber: 'barber-petar',
        priceMinor: 2500,
        outcome: worked('2025-12-05T11:30:00'),
      }),
      seat('2025-12-05T11:00:00', {
        id: 'seat-dec-ivo',
        who: IVO_UID,
        relationship: 'companion',
        priceMinor: 2500,
        outcome: worked('2025-12-05T11:30:00'),
      }),
    ],
    { kind: 'completed' },
  ),
];

function photo(
  photoId: string,
  appointmentId: string,
  takenAtIso: string,
  origin: 'shot' | 'library' = 'shot',
): AppointmentPhoto {
  return {
    photoId,
    appointmentId,
    barberId: 'barber-ivan',
    clientUserId: GEORGI_UID,
    clientLabel: 'Георги Петров',
    takenByUid: 'dev-staff-ivan',
    takenAtIso,
    path: `appointmentPhotos/${appointmentId}/${photoId}.jpg`,
    url: `https://example.test/photos/${photoId}.jpg`,
    width: 1100,
    height: 1400,
    origin,
    label: origin === 'library' ? 'Фейд · витрина' : null,
  };
}

/** The shop's pictures of Георги's cuts; the library picture is never his visit's own. */
export const GEORGI_PHOTOS: readonly AppointmentPhoto[] = [
  photo('photo-sep-1', 'appt-sep', '2026-09-04T07:40:00.000Z'),
  photo('photo-aug-1', 'appt-aug', '2026-08-12T15:25:00.000Z'),
  photo('photo-aug-2', 'appt-aug', '2026-08-12T15:26:00.000Z'),
  photo('photo-aug-cover', 'appt-aug', '2026-08-12T15:27:00.000Z', 'library'),
];

/** Георги waiting for a free afternoon slot on two days next week. */
export function georgiWaitlistRequest(): WaitlistRequest {
  return unwrap(
    WaitlistRequest.reconstitute({
      id: 'waitlist-georgi',
      ownerId: GEORGI_UID,
      locationId: null,
      when: {
        days: [
          {
            dayKey: '2026-10-01',
            windows: [{ from: '14:00', to: '17:00' }],
          },
          {
            dayKey: '2026-10-02',
            windows: [{ from: '14:00', to: '17:00' }],
          },
        ],
      },
      cart: {
        seats: [
          {
            seatKey: 'self',
            lines: [
              {
                id: 'line-1',
                serviceId: 'svc-fade',
                variantId: null,
                barberId: null,
              },
            ],
          },
        ],
        nextSequence: 2,
      },
      status: 'open',
      createdAtIso: '2026-09-27T21:10:00+03:00',
      zone: VISITS_ZONE,
    }),
  );
}

/**
 * Георги's first history page as the staff card builds it — the reader's
 * page, its photo counts, one row each through `visitRowOf` (§3.6 HF): the
 * composition the client card's store does, so the specs mount exactly
 * the rows a barber would read.
 */
export async function georgiStaffRows(
  readers: {
    readonly history: ClientHistoryReader;
    readonly photos: ClientPhotosReader;
  },
  options: Pick<VisitRowOptions, 'words' | 'nowMs'> &
    Partial<Pick<VisitRowOptions, 'grain' | 'currentAppointmentId'>>,
): Promise<readonly VisitRowVm[]> {
  const page = await readers.history.pageForSubject(GEORGI_UID, {
    beforeIso: null,
    limit: 30,
  });
  if (page.isFailure()) throw page.error;
  const appointments = page.value.appointments;
  const counts = await readers.photos.countByAppointment(
    appointments.map((visit) => visit.id.value),
  );
  if (counts.isFailure()) throw counts.error;
  return appointments.map((visit) =>
    visitRowOf(
      visit,
      {
        perspective: 'staff',
        grain: options.grain ?? 'year',
        subjectUserId: GEORGI_UID,
        currentAppointmentId:
          options.currentAppointmentId === undefined
            ? CURRENT_APPOINTMENT_ID
            : options.currentAppointmentId,
        nowMs: options.nowMs,
        locale: 'bg',
        photoCount: counts.value.get(visit.id.value) ?? 0,
        words: options.words,
      },
      VISITS_LOOKUP,
    ),
  );
}

// ── The app's own words ──────────────────────────────────────────────────

/** A catalogue as the app ships it: `{bg, en}.json`, nested. */
export type VisitsCatalogue = Record<string, unknown>;

/**
 * Transloco's reading in miniature, for the pure builders: a dotted key,
 * `{{param}}` filled in. A key the catalogue lacks throws — a missing word
 * fails a spec, never a screen.
 */
export function catalogueTranslator(tree: VisitsCatalogue): VisitTranslate {
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

const TEST_CATALOGUES = new InjectionToken<
  Readonly<Record<string, Translation>>
>('VisitsTestCatalogues');

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  private readonly catalogues = inject(TEST_CATALOGUES);

  getTranslation(lang: string): Observable<Translation> {
    return of(new Map(Object.entries(this.catalogues)).get(lang) ?? {});
  }
}

/** Transloco over the app's real catalogues, `bg` active — the components read their own words. */
export function provideVisitsCatalogues(catalogues: {
  readonly bg: VisitsCatalogue;
  readonly en: VisitsCatalogue;
}): (Provider | EnvironmentProviders)[] {
  return [
    { provide: TEST_CATALOGUES, useValue: catalogues },
    provideTransloco({
      config: {
        availableLangs: ['bg', 'en'],
        defaultLang: 'bg',
        fallbackLang: 'bg',
        missingHandler: { logMissingKey: false },
      },
      loader: CatalogueLoader,
    }),
  ];
}
