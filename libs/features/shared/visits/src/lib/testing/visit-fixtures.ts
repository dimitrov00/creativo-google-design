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
import type {
  Appointment,
  AppointmentPhoto,
  WaitlistRequest,
} from '@core/entities';
import {
  type AppliedDiscount,
  BookingContact,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  type CartLine,
  Combinability,
  CouponValue,
  DayWindows,
  DiscountProvenance,
  MinuteRange,
  PhotoOrigin,
  Placement,
  Seat,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  SeatSubject,
  SubjectRelationship,
  VoucherCode,
  WaitlistLifecycle,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
  AppointmentPhotoId,
  AttendanceState,
  BarberId,
  BusyKey,
  CartLineId,
  type CustomerId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  SeatId,
  SeatKeyText,
  ServiceId,
  type TimeZone,
  UserId,
  type UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import type {
  AppointmentPhotoRecordPorts,
  ClientHistoryReadPorts,
} from '@core/ports';
import {
  appointmentFixture,
  customerOf,
  seatFixture,
  termsFixture,
  unwrapOk,
} from '@core/testing';
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
 * screen and the one after it. FLAT entities, exactly as their documents
 * store them (flip 1), built through the ecs-core fixtures and companions,
 * so every row the specs draw is a row the presenter really builds; served
 * through the `@core/testing` port doubles (`memoryAppointmentReadPorts`,
 * `memoryAppointmentPhotoPorts`) by the specs, exactly as the Firestore
 * adapters page them.
 */

export const VISITS_ZONE = 'Europe/Sofia';
/** The shops' zone, branded — every wall-clock fixture is read in it. */
export const VISITS_TIME_ZONE: TimeZone = unwrapOk(
  ZonedTimeSystem.checkZone(VISITS_ZONE),
);
/** Георги Петров — the loyalty fixtures' uid for him (`loyaltyAccountFixtures.georgi`, `@core/testing`). */
export const GEORGI_UID = 'dev-client-1';
/** Георги's client record (D29), derived the way the pipelines derive it. */
export const GEORGI_CUSTOMER_ID: CustomerId = customerOf(UserId.of(GEORGI_UID));
/** Иво, the companion on Георги's December party. */
export const IVO_UID = 'dev-client-10';
/** Иво's client record. */
export const IVO_CUSTOMER_ID: CustomerId = customerOf(UserId.of(IVO_UID));
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

/** A wall-clock reading in Sofia (`YYYY-MM-DDTHH:mm:ss`) as the instant it names. */
export function sofia(iso: string): UtcEpochMs {
  return unwrapOk(ZonedTimeSystem.parseIsoIn(iso, VISITS_TIME_ZONE));
}

/** A wall-clock reading in Sofia as the shop day and minute it is stored as (Law 7.3). */
export function sofiaWall(iso: string): {
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

/** The fixtures' day (`FIXTURE_TODAY`, `@core/testing`), 09:00 in Sofia — before the 10:00 visit. */
export function visitsNowMs(today: string): number {
  return sofia(`${today}T09:00:00`);
}

/** A seat that was worked at `iso` (Sofia). */
export function workedAt(iso: string): SeatOutcome {
  return SeatOutcome.worked(sofia(iso));
}

/** A seat nobody came to, judged at `iso` (Sofia). */
export function noShowAt(iso: string): SeatOutcome {
  return SeatOutcome.noShow(sofia(iso));
}

/** A seat called off at `iso` (Sofia) by the client or the shop, for a reason. */
export function cancelledAt(
  iso: string,
  by: 'client' | 'staff',
  reason: CancellationReason = CancellationReason.Unspecified,
): SeatOutcome {
  return SeatOutcome.cancelled(
    sofia(iso),
    by === 'client' ? CancelledBy.Client : CancelledBy.Staff,
    reason,
    null,
  );
}

export interface SeatSpec {
  readonly id?: string;
  /** An account's uid, or — with `guest` — a guest's name. */
  readonly who?: string;
  readonly guest?: boolean;
  readonly relationship?: 'self' | 'companion';
  readonly service?: string;
  readonly barber?: string;
  readonly priceMinor?: number;
  readonly minutes?: number;
  readonly outcome?: SeatOutcome;
}

/**
 * One seat starting at `startIso` (Sofia, the visit's shop day): an account
 * seat with its client record beside its uid (`customerOf`, D29), or a
 * guest by label.
 */
export function visitSeat(startIso: string, spec: SeatSpec = {}): Seat {
  const who = spec.who ?? GEORGI_UID;
  return seatFixture({
    seatId: SeatId.of(spec.id ?? 'seat-1'),
    serviceId: ServiceId.of(spec.service ?? 'svc-fade'),
    barberId: BarberId.of(spec.barber ?? 'barber-ivan'),
    startMinutes: sofiaWall(startIso).minute,
    terms: Seat.termsOf(
      termsFixture(spec.priceMinor ?? 2750, spec.minutes ?? 30),
      null,
    ),
    occupant: spec.guest
      ? SeatOccupant.anonymous(unwrapOk(SeatLabel.parse(who)))
      : SeatOccupant.account(
          UserId.of(who),
          customerOf(UserId.of(who)),
          spec.relationship === 'companion'
            ? SubjectRelationship.Companion
            : SubjectRelationship.Self,
        ),
    outcome: spec.outcome ?? SeatOutcome.scheduled(),
  });
}

/** The stored states a fixture visit can be in. */
export type VisitStatusSpec =
  'pending' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';

export interface VisitExtras {
  /** The client's own words (the booking's contact note). */
  readonly note?: string;
  /** A first-visit code applied at `discountAtIso`: «FIRST10», −10 %. */
  readonly discountAtIso?: string;
  /** Who booked: the uid of the `SELF` seat by default. */
  readonly ownerUid?: string | null;
}

/** «FIRST10», −10 %, applied by code at `iso` — the bill's one snapshot. */
export function firstTenDiscount(iso: string): AppliedDiscount {
  return {
    discountId: AppliedDiscountId.of('code:FIRST10'),
    label: 'FIRST10',
    appliedAtUtcMs: sofia(iso),
    combinability: Combinability.Stackable,
    ...DiscountProvenance.code(VoucherCode.of('FIRST10')),
    ...unwrapOk(CouponValue.percentOff(10)),
  };
}

/**
 * A flat visit at `locationId` holding `seats` (all on the first seat's
 * shop day, F-6), in `status`: its envelope, instant and query mirrors
 * derived from the seats as the write plans derive them; a cancellation's
 * reasons are its seats'.
 */
export function visitOf(
  id: string,
  locationId: string,
  seats: readonly Seat[],
  status: VisitStatusSpec,
  startIso: string,
  extras: VisitExtras = {},
): Appointment {
  const day = sofiaWall(startIso).localDate;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  const barbers: BarberId[] = [];
  const users: UserId[] = [];
  const customers: CustomerId[] = [];
  let owner: Seat | null = null;
  for (const seat of seats) {
    start = Math.min(start, seat.startMinutes);
    end = Math.max(end, Seat.endMinutes(seat));
    if (!barbers.includes(seat.barberId)) barbers.push(seat.barberId);
    if (seat.seatSubject === SeatSubject.Account) {
      if (!users.includes(seat.subjectUserId)) users.push(seat.subjectUserId);
      if (!customers.includes(seat.subjectCustomerId)) {
        customers.push(seat.subjectCustomerId);
      }
      if (
        owner === null &&
        seat.subjectRelationship === SubjectRelationship.Self
      ) {
        owner = seat;
      }
    }
  }
  const startMinutes = unwrapOk(MinuteOfDay.of(start));
  const instant = unwrapOk(
    ZonedTimeSystem.toUtc(day, startMinutes, VISITS_TIME_ZONE),
  );
  const ownerSeat = owner as Seat | null;
  const ownerUserId =
    extras.ownerUid === undefined
      ? ownerSeat !== null && ownerSeat.seatSubject === SeatSubject.Account
        ? ownerSeat.subjectUserId
        : null
      : extras.ownerUid === null
        ? null
        : UserId.of(extras.ownerUid);
  return appointmentFixture({
    id: AppointmentId.of(id),
    locationId: LocationId.of(locationId),
    seats,
    localDate: day,
    startMinutes,
    endMinutes: unwrapOk(EndMinute.of(end)),
    utcEpochMs: instant,
    barberIds: barbers,
    busyKeys: barbers.map((barber) => BusyKey.of(barber, day)),
    ownerUserId,
    ownerCustomerId: ownerUserId === null ? null : customerOf(ownerUserId),
    subjectUserIds: [...users].sort(),
    subjectCustomerIds: [...customers].sort(),
    placement: Placement.Self,
    ...(extras.note === undefined
      ? BookingContact.NONE
      : {
          contactName: 'Георги Петров',
          contactPhone: null,
          contactEmail: null,
          contactNote: extras.note,
        }),
    discounts:
      extras.discountAtIso === undefined
        ? []
        : [firstTenDiscount(extras.discountAtIso)],
    lifecycle: lifecycleOf(status, seats, instant),
  });
}

/** The visit's lifecycle variant, stamped at its own start (a fixture needs no other clock). */
function lifecycleOf(
  status: VisitStatusSpec,
  seats: readonly Seat[],
  at: UtcEpochMs,
): BookingLifecycle {
  switch (status) {
    case 'pending':
      return BookingLifecycle.pending(at);
    case 'confirmed':
      return BookingLifecycle.confirm(at);
    case 'completed':
      return BookingLifecycle.complete(at);
    case 'no_show':
      return BookingLifecycle.noShow(at);
    case 'cancelled':
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
}

/** Георги's book, newest first — what `pageClientHistory` pages through. */
export const GEORGI_VISITS: readonly Appointment[] = [
  // The one after this: requested online, not yet confirmed.
  visitOf(
    'appt-oct',
    'loc-center',
    [visitSeat('2026-10-02T10:00:00', { id: 'seat-oct' })],
    'pending',
    '2026-10-02T10:00:00',
  ),
  // The visit on screen.
  visitOf(
    CURRENT_APPOINTMENT_ID,
    'loc-center',
    [visitSeat('2026-09-28T10:00:00', { id: 'seat-today' })],
    'confirmed',
    '2026-09-28T10:00:00',
  ),
  // The last visit: his words, one photo.
  visitOf(
    'appt-sep',
    'loc-center',
    [
      visitSeat('2026-09-04T10:00:00', {
        id: 'seat-sep',
        outcome: workedAt('2026-09-04T10:35:00'),
      }),
    ],
    'completed',
    '2026-09-04T10:00:00',
    { note: 'Къса отстрани, по-дълго отгоре' },
  ),
  // A cut and a beard with a first-visit code: two photos.
  visitOf(
    'appt-aug',
    'loc-center',
    [
      visitSeat('2026-08-12T17:30:00', {
        id: 'seat-aug-cut',
        outcome: workedAt('2026-08-12T18:00:00'),
      }),
      visitSeat('2026-08-12T18:00:00', {
        id: 'seat-aug-beard',
        service: 'svc-beard',
        priceMinor: 1500,
        minutes: 15,
        outcome: workedAt('2026-08-12T18:15:00'),
      }),
    ],
    'completed',
    '2026-08-12T17:30:00',
    { discountAtIso: '2026-08-12T18:20:00' },
  ),
  // Called off by Георги the evening before.
  visitOf(
    'appt-jul-cancelled',
    'loc-center',
    [
      visitSeat('2026-07-16T10:00:00', {
        id: 'seat-jul-cancelled',
        priceMinor: 1750,
        outcome: cancelledAt(
          '2026-07-15T18:00:00',
          'client',
          CancellationReason.ClientChangedPlans,
        ),
      }),
    ],
    'cancelled',
    '2026-07-16T10:00:00',
  ),
  // Did not come.
  visitOf(
    'appt-jul-no-show',
    'loc-center',
    [
      visitSeat('2026-07-07T10:00:00', {
        id: 'seat-jul-no-show',
        outcome: noShowAt('2026-07-07T10:20:00'),
      }),
    ],
    'no_show',
    '2026-07-07T10:00:00',
  ),
  // Last December at the other shop, with Иво in the next chair.
  visitOf(
    'appt-dec-party',
    'loc-mladost',
    [
      visitSeat('2025-12-05T11:00:00', {
        id: 'seat-dec-georgi',
        barber: 'barber-petar',
        priceMinor: 2500,
        outcome: workedAt('2025-12-05T11:30:00'),
      }),
      visitSeat('2025-12-05T11:00:00', {
        id: 'seat-dec-ivo',
        who: IVO_UID,
        relationship: 'companion',
        priceMinor: 2500,
        outcome: workedAt('2025-12-05T11:30:00'),
      }),
    ],
    'completed',
    '2025-12-05T11:00:00',
  ),
];

function photo(
  photoId: string,
  appointmentId: string,
  takenAtIso: string,
  origin: 'shot' | 'library' = 'shot',
): AppointmentPhoto {
  return {
    id: AppointmentPhotoId.of(photoId),
    appointmentId: AppointmentId.of(appointmentId),
    barberId: BarberId.of('barber-ivan'),
    clientCustomerId: GEORGI_CUSTOMER_ID,
    clientLabel: 'Георги Петров',
    takenByUserId: UserId.of('dev-staff-ivan'),
    takenAtUtcMs: unwrapOk(ZonedTimeSystem.parseOffsetIso(takenAtIso)),
    path: `appointmentPhotos/${appointmentId}/${photoId}.jpg`,
    url: `https://example.test/photos/${photoId}.jpg`,
    width: 1100,
    height: 1400,
    photoOrigin: origin === 'library' ? PhotoOrigin.Library : PhotoOrigin.Shot,
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

/** One whole-day or windowed day a request watches (`HH:mm` windows). */
export interface WatchedDay {
  readonly dayKey: string;
  readonly windows?: readonly { readonly from: string; readonly to: string }[];
}

function minuteOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/**
 * A flat waitlist request: Георги's own (`ownerUserId`), watching `days`
 * for `serviceIds`, made at `createdAtIso` (an ISO with its offset).
 */
export function waitlistOf(
  id: string,
  days: readonly WatchedDay[],
  serviceIds: readonly string[] = ['svc-fade'],
  createdAtIso = '2026-09-27T21:10:00+03:00',
): WaitlistRequest {
  const flexibleDays = days.map((day) =>
    DayWindows.of(
      unwrapOk(LocalDate.parse(day.dayKey)),
      (day.windows ?? []).map((window) =>
        MinuteRange.of(
          unwrapOk(MinuteOfDay.of(minuteOf(window.from))),
          unwrapOk(EndMinute.of(minuteOf(window.to))),
        ),
      ),
    ),
  );
  const created = unwrapOk(ZonedTimeSystem.parseOffsetIso(createdAtIso));
  const seatKey = unwrapOk(SeatKeyText.parse('self'));
  const lines: CartLine[] = serviceIds.map((serviceId, index) => ({
    lineId: CartLineId.forSequence(index + 1),
    seatKey,
    serviceId: ServiceId.of(serviceId),
    variantId: null,
    barberId: null,
    locationId: null,
  }));
  const localDates = flexibleDays.map((day) => day.localDate);
  const first = localDates[0];
  return {
    id: WaitlistRequestId.of(id),
    ownerUserId: UserId.of(GEORGI_UID),
    locationId: null,
    localDates,
    utcEpochMs:
      first === undefined
        ? created
        : ZonedTimeSystem.startOfLocalDay(first, VISITS_TIME_ZONE),
    createdAtUtcMs: created,
    cartSeats: [{ seatKey, lines }],
    cartNextSequence: lines.length + 1,
    flexibleDays,
    ...WaitlistLifecycle.open(created),
  };
}

/**
 * The visits' OWN pictures — the shots, never a library picture pointed at
 * — what a row's photo mark counts (the photos adapter counts
 * `photoOrigin == SHOT` alone, as the legacy reader did).
 */
export const GEORGI_SHOTS: AppointmentPhoto[] = GEORGI_PHOTOS.filter(
  (entry) => entry.photoOrigin === PhotoOrigin.Shot,
);

/** Георги waiting for a free afternoon slot on two days next week. */
export function georgiWaitlistRequest(): WaitlistRequest {
  return waitlistOf('waitlist-georgi', [
    { dayKey: '2026-10-01', windows: [{ from: '14:00', to: '17:00' }] },
    { dayKey: '2026-10-02', windows: [{ from: '14:00', to: '17:00' }] },
  ]);
}

/**
 * Георги's first history page as the staff card builds it — the reader's
 * page, its photo counts, one row each through `visitRowOf` (§3.6 HF): the
 * composition the client card's store does, so the specs mount exactly
 * the rows a barber would read.
 */
export async function georgiStaffRows(
  readers: {
    readonly history: ClientHistoryReadPorts;
    readonly photos: AppointmentPhotoRecordPorts;
  },
  options: Pick<VisitRowOptions, 'words' | 'nowMs'> &
    Partial<Pick<VisitRowOptions, 'grain' | 'currentAppointmentId'>>,
): Promise<readonly VisitRowVm[]> {
  const page = await readers.history.pageClientHistory(
    GEORGI_CUSTOMER_ID,
    null,
    30,
  );
  if (!page.ok) throw new Error('the history page failed');
  const appointments = page.value.appointments;
  const ids = appointments.map((visit) => visit.id);
  const counts = await readers.photos.countPhotosByAppointment(ids);
  if (!counts.ok) throw new Error('the photo counts failed');
  return appointments.map((visit, index) =>
    visitRowOf(
      visit,
      {
        perspective: 'staff',
        grain: options.grain ?? 'year',
        subjectUserId: GEORGI_UID,
        subjectCustomerId: GEORGI_CUSTOMER_ID,
        currentAppointmentId:
          options.currentAppointmentId === undefined
            ? CURRENT_APPOINTMENT_ID
            : options.currentAppointmentId,
        nowMs: options.nowMs,
        locale: 'bg',
        photoCount: counts.value[index] ?? 0,
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
