import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, Observable, ReplaySubject, map, of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import { Router, provideRouter } from '@angular/router';
import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  DEFAULT_LOCATION_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  MEDIA_RESOLVE_PORTS,
  PROFILE_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
  USER_SEARCH_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  AppliedOperation,
  BookingCall,
  BookingContact,
  BookingLifecycle,
  CancellationReason,
  CancelledBy,
  Combinability,
  CompositionKind,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  DayHours,
  DiscountMethod,
  DiscountSource,
  E164,
  EditCommand,
  Email,
  ExceptionEffectRule,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  MinuteRange,
  Placement,
  type Principal,
  RequestedSubjectRole,
  ResizeEdge,
  Role,
  Seat,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  ShiftSegment,
  SubjectRelationship,
} from '@core/components';
import type {
  Appointment,
  AppointmentNote,
  BarberBusyDay,
  BarberSchedule,
  Barber,
  Coupon,
  CouponGrant,
  ScheduleException,
  Service,
  ShopLocation,
  User,
} from '@core/entities';
import {
  AppointmentId,
  BarberBusyDayId,
  BarberId,
  BookingStatus,
  BusyKey,
  ClientOperationId,
  CouponGrantId,
  CouponId,
  Currency,
  CustomerId,
  type EndMinute,
  ExceptionEffect,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  Result as PortResult,
  ScheduleExceptionId,
  SeatId,
  ServiceCategoryId,
  ServiceId,
  ServiceVariantId,
  UserId as AccountId,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
  StaffEditErrorCode,
} from '@core/errors';
import {
  type AppointmentNotePorts,
  type AppointmentReadPorts,
  type CallableName,
  type CallableWire,
  Callables,
  type CouponVoucherPorts,
  type LocationLoadPorts,
  type MediaResolvePorts,
  type SchedulingReadPorts,
} from '@core/ports';
import {
  AppointmentIndexSystem,
  type StaffEditRowFacts,
  ZonedTimeSystem,
} from '@core/systems';
import { CatalogWording } from '@creativo/features/shared/catalog';
import { relativeTime } from '@creativo/infrastructure/i18n';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  at as wallAt,
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  customerOf,
  locationFixture,
  type GatewayCall,
  memoryAppointmentPhotoPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryCatalogReadPorts,
  memoryClockPorts,
  memoryCouponVoucherPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
  memoryScheduleExceptionPorts,
  memorySchedulingReadPorts,
  memoryUserSearchPorts,
  principalFixture,
  provisionedUserFixture,
  scriptedGatewayPorts,
  registeredUserFixture,
  seatFixture,
  serviceFixture,
  termsFixture,
  textFixture,
  unwrapOk,
  until,
  utcMs,
  cents,
  draftPersonKey,
  duration,
  trackMinute,
} from '@core/testing';
import {
  AgendaRow,
  CreateIntent,
  DayPicker,
  type DayRowVm,
  DiscardTarget,
  StaffDashboard,
  reversibleSave,
} from './staff-dashboard';
import {
  StaffVisitEditor,
  snapshotCommitOf,
  type VisitEditorCommit,
  type VisitEditorLeg,
  type VisitEditorVm,
} from '../visit-editor/staff-visit-editor';
import { StaffView } from '../staff-day.store';

/** The shop the fixture's chairs work at — the one the catalogue lists. */
const SHOP = LocationId.of('loc-center');

/**
 * A Sofia wall-clock reading (`2026-08-05T10:00:00`, no offset) as the shop
 * day, the minute and the instant it names — the minutes are what a visit
 * stores (Law 7.3), the instant is read once, here, in the shop's zone.
 */
function wall(iso: string): {
  readonly localDate: LocalDate;
  readonly minute: MinuteOfDay;
  readonly utcEpochMs: UtcEpochMs;
} {
  const localDate = unwrapOk(LocalDate.parse(iso.slice(0, 10)));
  const minute = unwrapOk(
    MinuteOfDay.of(Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))),
  );
  return {
    localDate,
    minute,
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(localDate, minute, FIXTURE_TIME_ZONE),
    ),
  };
}

/** Fresh ids for the fixture's people and seats — the old `generate()`s, counted. */
let fresh = 0;
function freshId(prefix: string): string {
  fresh += 1;
  return `${prefix}-${String(fresh).padStart(4, '0')}`;
}

/** A person with an account, as a seat names them: the uid and the client record (D29). */
function accountOf(
  uid: string,
  relationship: SubjectRelationship,
): SeatOccupant {
  const account = AccountId.of(uid);
  return SeatOccupant.account(account, customerOf(account), relationship);
}

function barber(id: string, name: string): Barber {
  return barberFixture({
    id: BarberId.of(id),
    name: textFixture(name),
    handle: id,
    title: { en: 'Barber', bg: 'Бръснар' },
    bio: textFixture('Bio', 'Био'),
    // A real location: blocking time writes against the chair's own shop,
    // and a barber with none would make the write silently no-op.
    locationIds: [SHOP],
    sortOrder: 0,
  });
}

/** One catalogue service, timed for `ivan` — the length the tag measures against. */
function service(id: string, minutes: number): Service {
  const terms = termsFixture(2800, minutes);
  return serviceFixture({
    id: ServiceId.of(id),
    name: textFixture(id),
    description: textFixture('x'),
    categoryId: ServiceCategoryId.of('cat-hair'),
    ...terms,
    offerings: [{ barberId: BarberId.of('ivan'), overrides: [], ...terms }],
    locationIds: [],
    compositionKind: CompositionKind.Single,
  });
}

/** The shop, open 09:00–19:00 every day — the hours every window is clamped to. */
const SHOP_LOCATION = locationFixture({
  id: SHOP,
  openingHours: Array.from({ length: 7 }, () =>
    DayHours.open(wallAt(9), until(19)),
  ),
});

/**
 * Ivan's roster: 09:00–18:00 at the shop, EVERY day — the window the old
 * stub answered for any day asked. Niko has none: not rostered at all,
 * which is what separates "off today" from "free day".
 */
function rosterOf(barberId: string): BarberSchedule | null {
  if (barberId !== 'ivan') return null;
  const days: readonly Weekday[] = [
    Weekday.Mon,
    Weekday.Tue,
    Weekday.Wed,
    Weekday.Thu,
    Weekday.Fri,
    Weekday.Sat,
    Weekday.Sun,
  ];
  return barberScheduleFixture({
    id: BarberId.of('ivan'),
    turnaroundMinutes: MinuteCount.ZERO,
    versions: [
      {
        seq: 1,
        effectiveFromLocalDate: unwrapOk(LocalDate.parse('2026-01-01')),
        effectiveToLocalDate: null,
        segments: days.map((day) =>
          ShiftSegment.of(day, SHOP, wallAt(9), until(18)),
        ),
      },
    ],
  });
}

/** Ivan's 10:00–10:30 taken, on whichever day is asked — the old stub's busy span. */
function busyOf(key: BusyKey): BarberBusyDay | null {
  const { barberId, localDate } = BusyKey.split(key);
  if (barberId !== 'ivan') return null;
  return barberBusyDayFixture({
    id: BarberBusyDayId.of(key),
    barberId,
    localDate,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(localDate, FIXTURE_TIME_ZONE),
  });
}

/** The visit's index fields, recomputed from its seats — what a write plan stores. */
function indexed(visit: Appointment): Appointment {
  return AppointmentIndexSystem.withQueryKeys(visit);
}

/**
 * A visit with these seats, on the first seat's shop day: the envelope, the
 * instant, the barbers, the busy keys and both owners derived from the
 * seats (`AppointmentIndexSystem`); booked at 08:00 that morning and still
 * PENDING, as a fresh booking is; at the shop.
 */
function visitOf(
  id: string,
  seats: readonly Seat[],
  extra: {
    readonly contact?: BookingContact;
    readonly lifecycle?: BookingLifecycle;
    readonly bookedIso?: string;
  } = {},
): Appointment {
  const first = seats[0];
  if (first === undefined) throw new Error('a visit with no seats');
  const day = seatDays.get(first.seatId);
  if (day === undefined) throw new Error('a seat built outside seatAt');
  const booked = wall(extra.bookedIso ?? `${day}T08:00:00`).utcEpochMs;
  const start = Math.min(...seats.map((seat) => seat.startMinutes));
  return indexed(
    appointmentFixture({
      id: AppointmentId.of(id),
      locationId: SHOP,
      seats,
      localDate: day,
      utcEpochMs: wall(
        `${day}T${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00`,
      ).utcEpochMs,
      bookedAtUtcMs: booked,
      revision: 0,
      ...(extra.contact ?? BookingContact.NONE),
      lifecycle: extra.lifecycle ?? BookingLifecycle.pending(booked),
    }),
  );
}

/** Which shop day each fixture seat was built on — a seat stores only its minute. */
const seatDays = new Map<SeatId, LocalDate>();

/** One seat of a fixture visit: who sits, in whose chair, for what, from when (Sofia wall clock). */
function seatAt(options: {
  readonly chair: string;
  readonly startsAt: string;
  readonly occupant: SeatOccupant;
  readonly serviceId?: string;
  readonly minutes?: number;
  readonly outcome?: SeatOutcome;
  readonly seatId?: string;
}): Seat {
  const start = wall(options.startsAt);
  const seat = seatFixture({
    seatId: SeatId.of(options.seatId ?? freshId('seat')),
    serviceId: ServiceId.of(options.serviceId ?? freshId('svc-unknown')),
    variantId: null,
    barberId: BarberId.of(options.chair),
    startMinutes: start.minute,
    terms: Seat.termsOf(termsFixture(2800, options.minutes ?? 30), null),
    occupant: options.occupant,
    outcome: options.outcome ?? SeatOutcome.scheduled(),
  });
  seatDays.set(seat.seatId, start.localDate);
  return seat;
}

/** A booking contact as the commit stores it: a name, an E.164 phone, the note. */
function contactOf(
  name: string,
  phone: string,
  note: string | null = null,
): BookingContact {
  return {
    contactName: name,
    contactPhone: E164.of(phone.replace(/\s+/g, '')),
    contactEmail: null,
    contactNote: note,
  };
}

/**
 * One booked visit in `ivan`'s chair, starting at `startsAt`.
 *
 * `withParty` adds a SECOND seat in another chair — the split party, which
 * is the case the party mark exists for: `seatsHere` is 1 on both rows, so
 * the avatar's `+N` shows nothing and only `1 / 2` says the two cards are
 * one booking. The extra seat is in a chair whose lane returns nothing, so
 * this adds a MARK to the existing card rather than a second card.
 */
function appointment(
  id: string,
  startsAt: string,
  contact?: { name: string; phone: string },
  barberId = 'ivan',
  withParty = false,
  /** A catalogue service by id — the default is one the catalogue never knew. */
  serviceId?: string,
): Appointment {
  // Only ONE seat may be `self` — and that is the real shape anyway: a
  // father books himself and his son.
  const makeSeat = (chair: string, relationship: SubjectRelationship) =>
    seatAt({
      chair,
      startsAt,
      occupant: accountOf(freshId('user'), relationship),
      ...(serviceId === undefined ? {} : { serviceId }),
    });
  const seat = makeSeat(barberId, SubjectRelationship.Self);
  return visitOf(
    id,
    withParty
      ? [seat, makeSeat('niko', SubjectRelationship.Companion)]
      : [seat],
    {
      // A real note, so the glyph row has something in it: the specs that
      // read that row passed vacuously against a card with nothing to show.
      ...(contact
        ? {
            contact: contactOf(contact.name, contact.phone, 'Скъсява отстрани'),
          }
        : {}),
    },
  );
}

/**
 * The same visit as a reader that SAYS which stored revision it read — the
 * document's own counter (Law 5: the body IS the entity).
 */
function readAt(appointment: Appointment, revision: number): Appointment {
  return { ...appointment, revision };
}

/**
 * The same visit as the PRODUCTION reader hands it to the lanes: the
 * stored document, its counter beside it — `0` for a row written before
 * staff editing (`null` here), the counter the server reads it at. There is
 * no mapper any more (Law 5): the document is the entity.
 */
function storedAt(
  appointment: Appointment,
  revision: number | null,
): Appointment {
  return { ...appointment, revision: revision ?? 0 };
}

/**
 * The next build's table, when a test wants the words to land LATE — the
 * way `bg.json` does on a phone, after the first change detection. `null`
 * is the empty table at once, which every other test runs on.
 */
let lateTable: ReplaySubject<Translation> | null = null;

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return lateTable ?? of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** A held grant and the coupon it was issued from — what the «Отстъпка» menu reads. */
interface HeldGrant {
  readonly grant: CouponGrant;
  readonly coupon: Coupon;
}

/**
 * What the typed callable client answers, per callable — a MUTABLE table:
 * a case scripts one callable by assigning it (the double reads the table
 * at call time), and `build()` resets it to the defaults.
 */
type GatewayHandlers = {
  -readonly [N in CallableName]?: (
    input: CallableWire[N]['input'],
  ) =>
    | PortResult<CallableWire[N]['answer'], PipelineError>
    | Promise<PortResult<CallableWire[N]['answer'], PipelineError>>;
};

/** The app's own catalogue, as shipped — read for the sentences a case pins byte for byte. */
type CatalogueCopy = {
  readonly errors: { readonly BOOKING_TRANSITION_NOT_ALLOWED: string };
  readonly staff: { readonly day: { readonly cancelNoteFailed: string } };
  readonly appointments: {
    readonly status: {
      readonly completed: string;
      readonly confirmed: string;
    };
  };
};

function catalogueOf(lang: 'bg' | 'en'): CatalogueCopy {
  const file = resolve(
    __dirname,
    `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
  return JSON.parse(readFileSync(file, 'utf8')) as CatalogueCopy;
}

const bgCatalogue = catalogueOf('bg');
const enCatalogue = catalogueOf('en');

/** What a staff edit carried — the batch, as the store was handed it. */
type SentEdit = { readonly commands: readonly BookingCall.EditCommand[] };

/** The first command of one kind in a batch, narrowed to its own shape. */
function commandOf<C extends BookingCall.EditCommand['editCommand']>(
  commands: readonly BookingCall.EditCommand[],
  editCommand: C,
): Extract<BookingCall.EditCommand, { readonly editCommand: C }> | undefined {
  return commands.find(
    (
      entry,
    ): entry is Extract<BookingCall.EditCommand, { readonly editCommand: C }> =>
      entry.editCommand === editCommand,
  );
}

/** A refusal as the wire carries it — the server's code, its reason and its scalars. */
function refusal(
  errorCode: (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode],
  serverErrorCode: string,
  params: Readonly<Record<string, string | number>> = {},
  reason: { readonly refusal?: string; readonly field?: string } = {},
): PipelineError {
  return {
    ...PipelineError.of(
      errorCode,
      serverErrorCode,
      reason.refusal ?? null,
      reason.field ?? null,
    ),
    serverParams: params,
  };
}

describe('StaffDashboard', () => {
  let fixture: ComponentFixture<StaffDashboard>;
  /** How many staff intents `ID_PORTS` has named — see the fixture. */
  let minted = 0;

  /**
   * Ivan holds one 10:00 visit; Niko's chair is empty. The port's busy key
   * is handed in SPLIT — the chair and the shop day — so `mock.calls[n][1]`,
   * the day subscribed, is a string to the type system.
   */
  const observeBarberDay = vi.fn<
    (
      barberId: string,
      dayKey: string,
    ) => Observable<PortResult<readonly Appointment[], RepositoryError>>
  >((barberId) =>
    of(
      PortResult.ok(
        barberId === 'ivan'
          ? [
              // WITH a contact: the phone path is half this surface's point,
              // and without one "does not print the phone in the run" passed
              // vacuously against a row that had no phone to print.
              appointment(
                'appointment-1',
                '2026-08-05T10:00:00',
                { name: 'Мартин Илиев', phone: '+359881234567' },
                'ivan',
                // A SPLIT PARTY, so the `1 / 2` mark is under test rather
                // than asserted vacuously against a card with no party.
                true,
              ),
            ]
          : [],
      ),
    ),
  );

  /**
   * Ivan is rostered 09:00–18:00 every day; Niko is NOT rostered at all,
   * which is what separates "off today" from "free day". The raw roster —
   * the store derives the windows (F1-10).
   */
  const observeSchedule = vi.fn((barberId: BarberId) =>
    of(PortResult.ok(rosterOf(barberId))),
  );

  /** Ivan's 10:00–10:30 is taken on every day asked; Niko holds nothing. */
  const observeBusyDay = vi.fn((key: BusyKey) =>
    of(PortResult.ok(busyOf(key))),
  );

  /** The changed days, as stored: the exception command writes them here, the stream reads them back. */
  const exceptions: ScheduleException[] = [];
  /** The days a case has stored changes on before the page comes up — `build()` lays them in. */
  let seededExceptions: readonly ScheduleException[] = [];
  const writeScheduleException = vi.fn(
    memoryScheduleExceptionPorts(exceptions).writeScheduleException,
  );

  /** The accounts `PROFILE_PORTS` answers with, AS STORED, by uid (a companion's name). */
  const profiles = new Map<AccountId, User>();

  /**
   * The coupons `COUPON_VOUCHER_PORTS` answers with, for whichever client
   * record asks (the fixture's booker has a fresh one); who asked is kept.
   */
  let heldGrants: readonly HeldGrant[] = [];
  const grantsAskedFor: string[] = [];

  /** Who is at the book. `next()` a plain barber to shut the money gate. */
  const principal$ = new BehaviorSubject<Principal>(
    principalFixture.staff(AccountId.of('dev-staff-ivan'), [
      Role.Barber,
      Role.Admin,
    ]),
  );

  // Hoisted so the guards below can assert that a destructive write did NOT
  // happen on the tap that asked for it.
  const transition = vi.fn(
    async (
      input: BookingCall.Transition,
    ): Promise<PortResult<BookingCall.Transitioned, PipelineError>> =>
      PortResult.ok({
        appointmentId: input.appointmentId,
        toBookingStatus: input.toBookingStatus,
      }),
  );

  /** The callable client's answers — `build()` resets them; a case scripts one. */
  let gateway: GatewayHandlers = {};
  /** Every callable dialled, in order (name and input). */
  let gatewayCalls: GatewayCall[] = [];

  /**
   * THE SHOP'S ZONE, HELD BACK — a case that wants the page to come up
   * before either source names the zone sets these: the catalogue's shops
   * as a stream it answers later, and the default location's read as a
   * promise it settles later. `null` answers at once, as the app usually
   * finds them.
   */
  let catalogShops: Observable<
    PortResult<readonly ShopLocation[], RepositoryError>
  > | null = null;
  let defaultShop: Promise<
    PortResult<ShopLocation | null, RepositoryError>
  > | null = null;
  /** The catalogue's services, when a case prices its own; `null` is the one timed fade. */
  let catalogServices: readonly Service[] | null = null;
  /**
   * The search window's visits (what the day search and «Скорошни» read),
   * when a case pools its own; `null` is the one Георги visit.
   */
  let searchPool: readonly Appointment[] | null = null;

  /**
   * The whole fixture, with the CLOCK as the one dial worth turning.
   *
   * 09:00 — the first rostered minute — is the right default: it puts the
   * entire day ahead of the reader and keeps every other test's arithmetic
   * simple. It is also the one moment at which "nothing has elapsed yet" is
   * true, so any rule about elapsed time has to move it, or pass vacuously.
   */
  async function build(
    nowIso = '2026-08-05T09:00:00.000+03:00',
  ): Promise<void> {
    // `AgendaFields` persists to localStorage, which jsdom shares across
    // every test in the file — one `toggle` leaked into all of them and
    // "ships with free time off" quietly stopped being testable.
    localStorage.clear();
    observeBarberDay.mockClear();
    observeSchedule.mockClear();
    observeBusyDay.mockClear();
    writeScheduleException.mockClear();
    exceptions.length = 0;
    exceptions.push(...seededExceptions);
    transition.mockClear();
    gateway = { [Callables.TransitionAppointment]: transition };
    gatewayCalls = [];
    await TestBed.configureTestingModule({
      imports: [StaffDashboard],
      providers: [
        ...provideTestI18n(),
        // The store publishes the shown day into `?day=` so it can be pasted
        // into a staff chat; without a router that write throws on first read.
        provideRouter([]),
        { provide: CLOCK_PORTS, useValue: memoryClockPorts(utcMs(nowIso)) },
        {
          // Names each staff intent; counted, so a spec can tell a reused
          // name from a fresh one without comparing random strings.
          provide: ID_PORTS,
          useValue: {
            nextId: () => `operation-${String(++minted).padStart(12, '0')}`,
          },
        },
        {
          // The shop's zone, when the catalogue has not named one yet: the
          // deployment's default location — the fixture's own shop.
          provide: LOCATION_LOAD_PORTS,
          useValue: {
            loadLocation: (id: LocationId) =>
              defaultShop ??
              memoryLocationLoadPorts(
                memoryProgramsWorld({ locations: [SHOP_LOCATION] }),
              ).loadLocation(id),
          } satisfies LocationLoadPorts,
        },
        {
          provide: DEFAULT_LOCATION_PORTS,
          useValue: memoryDefaultLocationPorts(SHOP),
        },
        {
          provide: APPOINTMENT_READ_PORTS,
          useValue: {
            observeAppointment: () => of(PortResult.ok(null)),
            // `busyKeys array-contains`: the chair's day, handed in split.
            observeBarberDay: (key) => {
              const { barberId, localDate } = BusyKey.split(key);
              return observeBarberDay(barberId, localDate);
            },
            observeUpcoming: () => of(PortResult.ok([])),
            observeHistory: () => of(PortResult.ok([])),
            pageClientHistory: async () =>
              PortResult.ok({ appointments: [], nextBeforeUtcMs: null }),
            searchAppointmentWindow: async () =>
              PortResult.ok(
                searchPool ?? [
                  appointment('appointment-1', '2026-08-05T10:00:00', {
                    name: 'Георги Петров',
                    phone: '+359 88 123 4567',
                  }),
                ],
              ),
          } satisfies AppointmentReadPorts,
        },
        {
          // The typed callable client over the mutable table above: a
          // callable nobody scripted answers `PIPELINE_UNKNOWN`.
          provide: GATEWAY_PORTS,
          useValue: scriptedGatewayPorts(gateway, gatewayCalls),
        },
        {
          // A REAL roster. The stub used to return no barbers, which meant
          // not one lane, row, gap or verb on this surface was under test.
          // One timed service, so the tag has a catalogue to measure
          // against (the fixture's own seats use ids it never knew), and
          // the shop the chairs work at — a window is kept only at a shop
          // the day OFFERS.
          provide: CATALOG_PORTS,
          useValue: ((ports) =>
            catalogShops === null
              ? ports
              : { ...ports, observeLocations: () => catalogShops ?? of() })(
            memoryCatalogReadPorts({
              services: catalogServices ?? [service('fade', 45)],
              barbers: [barber('ivan', 'Иван'), barber('niko', 'Нико')],
              categories: [],
              locations: [SHOP_LOCATION],
            }),
          ),
        },
        {
          // The raw availability streams; the store folds them (F1-10).
          provide: SCHEDULING_READ_PORTS,
          useValue: {
            ...memorySchedulingReadPorts({
              exceptions,
              locations: [SHOP_LOCATION],
            }),
            observeSchedule,
            observeBusyDay,
          } satisfies SchedulingReadPorts,
        },
        {
          provide: SCHEDULE_EXCEPTION_PORTS,
          useValue: { writeScheduleException },
        },
        {
          // The signed-in principal — a barber who also holds the keys, so
          // the money gate opens; a plain barber's case is asserted below.
          provide: AUTH_SESSION_PORTS,
          useValue: memoryAuthSessionPorts({ principals$: principal$ }),
        },
        {
          provide: USER_SEARCH_PORTS,
          useValue: memoryUserSearchPorts([]),
        },
        {
          provide: APPOINTMENT_NOTE_PORTS,
          useValue: {
            observeAppointmentNote: () => of(PortResult.ok(null)),
            saveAppointmentNote: async () => PortResult.ok(undefined),
          } satisfies AppointmentNotePorts,
        },
        {
          // Nobody has a portrait here; the lookup answers "none" at once.
          provide: AVATAR_PORTS,
          useValue: memoryAvatarPorts(),
        },
        {
          // The shop's photos of a visit: none, and every shutter lands.
          provide: APPOINTMENT_PHOTO_PORTS,
          useValue: memoryAppointmentPhotoPorts([]),
        },
        // The discount row's reads (2026-09-10): nobody holds a coupon
        // unless a case puts one in `heldGrants`, and no code opens one, so
        // the menu offers «Без» and the typed arms.
        {
          provide: COUPON_VOUCHER_PORTS,
          useValue: {
            ...memoryCouponVoucherPorts(),
            listUsableCouponGrants: async (customerId: CustomerId) => {
              grantsAskedFor.push(customerId);
              // The held grants, re-addressed to whoever asks: the
              // fixture's booker has a fresh record on every read.
              return memoryCouponVoucherPorts({
                grants: heldGrants.map((entry) => ({
                  ...entry.grant,
                  customerId,
                })),
              }).listUsableCouponGrants(customerId);
            },
            // Whatever the coupon's status: a held grant keeps its name.
            loadCoupons: async (ids: readonly CouponId[]) =>
              memoryCouponVoucherPorts({
                coupons: heldGrants.map((entry) => entry.coupon),
              }).loadCoupons(ids),
          } satisfies CouponVoucherPorts,
        },
        {
          // No catalogue image resolves to anything here.
          provide: MEDIA_RESOLVE_PORTS,
          useValue: {
            resolveMedia: async () => PortResult.ok([]),
          } satisfies MediaResolvePorts,
        },
        {
          // `users/{uid}` — only a companion's name is ever asked of it
          // here; nobody has a profile unless a case puts one in.
          provide: PROFILE_PORTS,
          useValue: memoryProfilePorts(profiles),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StaffDashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => build());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Free time is a switch, and it ships OFF — see `agenda-fields`. */
  function showFreeTime(): void {
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    if (!component.fields.isOn('freeTime')) component.fields.toggle('freeTime');
    fixture.detectChanges();
  }

  /**
   * Where the device's clock is set. The grid's corner names the zone only
   * while that is not the shop's (review r4, 2026-10-06) — and the machine
   * running this file may well be in Sofia, so a test that wants the
   * label says where the device is rather than assuming.
   */
  function deviceZone(zone: string): void {
    (
      fixture.componentInstance as unknown as {
        deviceZone: { set: (zone: string) => void };
      }
    ).deviceZone.set(zone);
    fixture.detectChanges();
  }

  it('opens on TODAY, named in the header', () => {
    const label = host().querySelector('[data-testid="staff-day-label"]');
    // 2026-08-05 is a Wednesday; bg locale spells it out.
    expect(label?.textContent).toContain('5');
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
  });

  /*
   * THE ZONE IS THE SHOP'S, AND IT IS READ (Phase 4a 4A-11, R13): there is
   * no tenant-zone constant to fall back on, so on a cold load the page
   * waits for the first shop the catalogue names — or the deployment's
   * default location — before it names a day. Until then it is in its
   * loading state: nothing on it says a date, no lane is read.
   */
  it('names no day until the shop’s zone is known, then opens on today', async () => {
    const shops = new ReplaySubject<
      PortResult<readonly ShopLocation[], RepositoryError>
    >(1);
    let settleDefault: (
      answer: PortResult<ShopLocation | null, RepositoryError>,
    ) => void = () => undefined;
    catalogShops = shops;
    defaultShop = new Promise((resolve) => (settleDefault = resolve));
    try {
      TestBed.resetTestingModule();
      observeBarberDay.mockClear();
      await build();
      expect(
        host().querySelector('[data-testid="staff-day-label"]'),
      ).toBeNull();
      expect(observeBarberDay).not.toHaveBeenCalled();
      // The chrome is drawn — the page, its toolbar, its pickers — and the
      // lanes sit in their loading state: no new visible state, and no
      // "nobody is on shift" said of a day that has not been read.
      expect(host().querySelector('main.staff-day')).not.toBeNull();
      expect(host().querySelector('.staff-toolbar')).not.toBeNull();
      expect(
        host().querySelector('[data-testid="staff-view-segments"]'),
      ).not.toBeNull();
      expect(host().textContent).not.toContain('staff.day.noRoster');

      // The default location answers first: the day is today, on its clock.
      settleDefault(PortResult.ok(SHOP_LOCATION));
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-day-label"]')?.textContent,
      ).toContain('5.08');
      expect(observeBarberDay.mock.calls.map((call) => call[1])).toContain(
        '2026-08-05',
      );
    } finally {
      shops.next(PortResult.ok([SHOP_LOCATION]));
      catalogShops = null;
      defaultShop = null;
    }
  });

  /*
   * NO DAYS, NO PERIOD — and no throw. Before the zone is read the store
   * shows no days, and the canvas binds its region label (the period) off
   * them before `store.ready()`: the label formatted `visibleDays()[0]`
   * while the list was empty and threw on every staff-page load.
   */
  it('names an empty period while no day is shown, and the shown one once it is', async () => {
    let settleDefault: (
      answer: PortResult<ShopLocation | null, RepositoryError>,
    ) => void = () => undefined;
    catalogShops = new ReplaySubject<
      PortResult<readonly ShopLocation[], RepositoryError>
    >(1);
    defaultShop = new Promise((resolve) => (settleDefault = resolve));
    try {
      TestBed.resetTestingModule();
      await build();
      const page = fixture.componentInstance as unknown as {
        store: { visibleDays: () => readonly string[] };
        periodLabel: () => string;
        regionLabel: () => string;
      };
      expect(page.store.visibleDays()).toEqual([]);
      expect(page.periodLabel()).toBe('');
      expect(() => page.regionLabel()).not.toThrow();

      settleDefault(PortResult.ok(SHOP_LOCATION));
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(page.periodLabel()).toContain('5.08');
    } finally {
      catalogShops = null;
      defaultShop = null;
    }
  });

  /*
   * A ZONE THAT CANNOT BE READ (4A-11, R13): the catalogue names no shop and
   * the default location's read fails. The page keeps its chrome and says
   * nothing false about the day — a failed read leaves the lanes empty and
   * silent, as a failed lane read does — and the moments that already
   * re-read "now" (here the tab's return) read the default location again.
   */
  it('reads the default location again when its zone could not be read', async () => {
    catalogShops = of(PortResult.ok([]));
    defaultShop = Promise.resolve(
      PortResult.err(RepositoryError.readFailed('locations/loc-center', null)),
    );
    try {
      TestBed.resetTestingModule();
      observeBarberDay.mockClear();
      await build();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(host().querySelector('.staff-toolbar')).not.toBeNull();
      expect(
        host().querySelector('[data-testid="staff-day-label"]'),
      ).toBeNull();
      expect(host().textContent).not.toContain('staff.day.noRoster');
      expect(observeBarberDay).not.toHaveBeenCalled();

      // The store answers again; the tab comes back and asks it.
      defaultShop = null;
      document.dispatchEvent(new Event('visibilitychange'));
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-day-label"]')?.textContent,
      ).toContain('5.08');
      expect(observeBarberDay.mock.calls.map((call) => call[1])).toContain(
        '2026-08-05',
      );
    } finally {
      catalogShops = null;
      defaultShop = null;
    }
  });

  it("names the day the way the visit sheet does — the locale's compact date", () => {
    // REVERSED (owner, 2026-09-09): the toolbar's label and the frame's pill
    // are ONE component now, and one grammar — the compact date exactly as
    // `Intl` renders it, `ср, 5.08`. The title-cased heading is gone with
    // the headline segment it lived in.
    const label = host()
      .querySelector('[data-testid="staff-day-label"]')
      ?.textContent?.trim();
    expect(label).toContain('5.08');
    expect(label).not.toMatch(/август/i);
  });

  it('reaches another day through the date pull-down', async () => {
    // The ± chevrons are gone (owner ruling 2026-08-07, matching the
    // reference): the period label IS the control, and it opens a month.
    expect(host().querySelector('[data-testid="staff-day-prev"]')).toBeNull();

    (
      host().querySelector(
        '[data-testid="staff-day-label"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (
      host().querySelector(
        '[data-testid="ui-month-day-2026-08-06"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host().querySelector('[data-testid="staff-day-label"]')?.textContent,
    ).toContain('6');
    // Off today, the anchor back appears.
    expect(
      host().querySelector('[data-testid="staff-day-today"]'),
    ).not.toBeNull();
  });

  it('draws ONE clock-ordered run, not a column per chair', () => {
    // The list used to be a list per barber, stacked — three schedules on
    // one page, the same hour written three times. The agenda groups by
    // start time instead, and a barber who is off contributes nothing.
    expect(host().querySelectorAll('[data-testid="staff-lane"]').length).toBe(
      0,
    );
    const groups = host().querySelectorAll(
      '[data-testid="staff-agenda-group"]',
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  it('banners the barber who is off as an ALL-DAY event, above the run', () => {
    // The old surface rendered "free day" under a barber on holiday, which is
    // the same invented fact as a fabricated number. Then it was a line of
    // grey footnote type UNDER the whole agenda — read last, when it is the
    // first thing a shop needs. Then a small inline capsule, which still read
    // as chrome. It is an all-day EVENT, so it is built from the event's own
    // parts and banners above the timed run the way Apple Calendar does.
    const off = host().querySelector('[data-testid="staff-off-today"]');
    expect(off).not.toBeNull();

    // THE SAME GROUND as the cards below it — `.agenda-card` is what supplies
    // the 14% chair tint and the padding. If this ever stops being an agenda
    // card it stops being recognisable as an event.
    expect(off?.classList.contains('agenda-card')).toBe(true);
    expect(off?.getAttribute('data-barber-tone')).not.toBeNull();

    // NO RAIL. The rail is a straight bar down a leading edge and this row is
    // a capsule; the chair's colour moved into a disc instead — the same
    // shape and slot the client's avatar occupies on every card below.
    expect(off?.querySelector('.agenda-card__rail')).toBeNull();
    expect(off?.querySelector('.agenda-allday__disc')).not.toBeNull();

    // PRESSABLE, and a real button rather than a div with a handler — it
    // opens the block sheet, which is where days off are actually edited.
    expect(off?.tagName.toLowerCase()).toBe('button');
    expect(off?.hasAttribute('data-interactive')).toBe(true);

    // The barber's name is plain foreground, exactly as every client's name
    // on the cards is. It was tinted for a while, which made the same kind of
    // thing read as two different kinds.
    const name = off?.querySelector('.agenda-allday__name');
    expect(name?.getAttribute('data-foreground-style')).toBeNull();
    expect(name?.getAttribute('data-font')).toBe('callout');

    // ABOVE the run. `compareDocumentPosition` rather than reading the
    // markup, so a refactor that moves either one is caught.
    const agenda = host().querySelector('.agenda');
    expect(agenda).not.toBeNull();
    const isBefore = !!(
      off!.compareDocumentPosition(agenda!) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(isBefore).toBe(true);

    // No "all day" caption: a full-width tinted row above the run carrying no
    // clock time, when every card below carries one, says it by construction.
    expect(host().querySelector('.staff-allday__label')).toBeNull();

    const component = fixture.componentInstance as unknown as {
      resting: () => { id: string; name: string; tone: number }[];
    };
    expect(component.resting().map((b) => b.name)).toEqual(['Нико']);
  });

  it('opens the rest day for editing, already knowing it is all day', () => {
    // A card-shaped thing at a full touch target that does nothing when
    // pressed is a worse lie than the footnote it replaced. It reuses the
    // block sheet rather than growing a second editor — with the all-day
    // switch already true, because the barber IS off all day and the sheet
    // should open showing that rather than asking from scratch.
    const component = fixture.componentInstance as unknown as {
      openRestDay: (id: string) => void;
      blockLaneId: () => string | null;
      blockEdit: () => { allDay: boolean; blockId: string | null } | null;
    };
    component.openRestDay('nikо-test-id');
    expect(component.blockLaneId()).toBe('nikо-test-id');
    expect(component.blockEdit()?.allDay).toBe(true);
    // Editing something that exists — so the sheet offers the lift.
    expect(component.blockEdit()?.blockId).not.toBeNull();
  });

  it('never says "off today" and "nobody in the catalog" at once', () => {
    // Both branches used to fire on an empty day, so the screen named three
    // resting barbers and then announced there were none — one of the two
    // sentences necessarily false.
    const offToday = host().querySelector('[data-testid="staff-off-today"]');
    expect(offToday).not.toBeNull();
    // The fixture has one rostered chair AND one resting one; the no-roster
    // line must stay away while either of those is true.
    expect(
      host().querySelectorAll('[data-testid="staff-agenda-group"]').length,
    ).toBeGreaterThan(0);
    expect(host().textContent).not.toContain('staff.day.noRoster');
  });

  it('gives every time group a real heading that names its own run', () => {
    // Headings are what make the rotor usable; they moved from the barber
    // (three of them) to the hour (as many as the day has starts).
    const heading = host().querySelector('h2.agenda-group__time');
    expect(heading).not.toBeNull();
    const run = host().querySelector('ul[aria-labelledby]');
    expect(run?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('identifies the barber with a face and a rail, never a word', () => {
    // Three answers to one question was two too many. The card carries the
    // barber's own photograph in the trailing cluster and their chair's
    // colour down the rail; spelling the name out underneath repeated it a
    // third time, in the one column whose premise is that each line is a
    // fact you do not already have. The `barber` field is retired.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.getAttribute('data-barber-tone')).not.toBeNull();
    expect(card?.querySelector('.agenda-card__rail')).not.toBeNull();
    expect(card?.querySelector('.agenda-card__barber-face')).not.toBeNull();
    // No name row, and no switch that could bring one back.
    expect(host().querySelector('.agenda-card__fact--chair')).toBeNull();
    const component = fixture.componentInstance as unknown as {
      agendaFieldIds: readonly string[];
    };
    expect(component.agendaFieldIds).not.toContain('barber');
    // The face still ANNOUNCES the name, for anyone not reading colour.
    expect(
      card
        ?.querySelector('.agenda-card__barber-face')
        ?.getAttribute('aria-label'),
    ).toBeTruthy();
  });

  it('names the act after the client it acts on, in the sheet', async () => {
    // Twelve buttons a day all called "Дойде" is unusable in a rotor. The
    // acts moved to the sheet; their names moved with them.
    const card = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    card.click();
    await fixture.whenStable();
    fixture.detectChanges();
    // The sheet's acts are its EXITS, at the foot (owner, 2026-09-09).
    expect(
      host().querySelector('[data-testid="staff-visit-cancel"]'),
    ).not.toBeNull();
    // And the card can still take focus when its state changes underneath.
    expect(card.getAttribute('tabindex')).toBe('-1');
  });

  it('carries a note as a MARK in the trailing cluster, not as a row', () => {
    // Its text was a clamped line in the fact column — the one fact there
    // that could not be read in full, sitting in a column whose whole
    // premise is that everything gets its place. A mark says "there is one"
    // honestly; the sheet says what it is.
    expect(host().querySelector('[data-testid="staff-visit-note"]')).toBeNull();
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const foot = card?.querySelector('.agenda-card__foot');
    expect(foot?.querySelector('.agenda-card__mark')).not.toBeNull();

    // And it is the NOTE field that governs the mark, now that the row is
    // gone — otherwise the switch would control nothing at all.
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
      rowIcons: (e: {
        rebooked: boolean;
        hasNote: boolean;
      }) => readonly string[];
    };
    expect(component.rowIcons({ rebooked: false, hasNote: true })).toContain(
      'visit.note',
    );
    if (component.fields.isOn('note')) component.fields.toggle('note');
    expect(
      component.rowIcons({ rebooked: false, hasNote: true }),
    ).not.toContain('visit.note');
  });

  it('accounts for every rostered minute — the run carries gaps, not just visits', () => {
    showFreeTime();
    const gaps = host().querySelectorAll('[data-testid="staff-gap-row"]');
    // 09:00–18:00 minus a 10:00–10:30 visit = two sellable holes.
    expect(gaps.length).toBe(2);
    // The START is the group's heading now, not something each card repeats
    // — that redundancy is exactly what the agenda exists to remove.
    const starts = [...host().querySelectorAll('.agenda-group__time')].map(
      (heading) => heading.textContent?.trim(),
    );
    expect(starts).toContain('09:00');
    expect(starts).toContain('10:30');
    // A gap says WHOSE chair is free — unattributed free time is meaningless
    // in a run that mixes every barber. It says it in the rail's tone now
    // rather than in a name, which is what took the widest chip off the card.
    expect(gaps[0]?.getAttribute('data-barber-tone')).not.toBeNull();
  });

  it('orders the run by the clock, interleaving gaps with visits', () => {
    showFreeTime();
    const rows = [
      ...host().querySelectorAll(
        '[data-testid="staff-gap-row"], [data-testid="staff-visit-row"]',
      ),
    ];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'staff-gap-row',
      'staff-visit-row',
      'staff-gap-row',
    ]);
  });

  it('carries NO act on the card — the card opens the act instead', () => {
    // HIG's own reading of a list like this (owner ruling): the row is the
    // interactive thing and the verbs live in what it opens. An inline button
    // restates on every card a small set of acts the reader learns once, and
    // it competes with the one thing the card must land: who.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.querySelector('[data-testid^="staff-act-"]')).toBeNull();
    expect(card?.querySelector('[data-testid="staff-row-menu"]')).toBeNull();
    expect(card?.querySelector('ui-menu')).toBeNull();
  });

  it('prints status only when it is an EXCEPTION', () => {
    // The badge printed on every card — "Потвърден" nine times in ten, the
    // widest pill on the row, saying what a booking is by default. Ordinary
    // states are carried by the rail's form; the word fires only when
    // something went other than to plan.
    const component = fixture.componentInstance as unknown as {
      statusWord: (status: BookingStatus) => string | null;
    };
    expect(component.statusWord(BookingStatus.Confirmed)).toBeNull();
    expect(component.statusWord(BookingStatus.Completed)).toBeNull();
    expect(component.statusWord(BookingStatus.NoShow)).not.toBeNull();
    expect(component.statusWord(BookingStatus.Cancelled)).not.toBeNull();
  });

  it('puts the client at the head of the body row and the barber at its end', () => {
    // The barber was an 18px badge on the client's corner. Measured across
    // the roster, a photo at that size had a mean pairwise RGB distance of
    // 23 between chairs against the rail's 102 — it identified nobody. It is
    // a full disc at the far end of the row now, filled with the chair's
    // tone and carrying the barber's initials. The client's face LEADS the
    // row: tried between the facts and the times (2026-09-16) and put back
    // the same day — "it doesn't work".
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const body = card?.querySelector('.agenda-card__body');
    const foot = card?.querySelector('.agenda-card__foot');
    expect(body).not.toBeNull();
    expect(foot).not.toBeNull();
    const face = body?.querySelector('.agenda-card__face');
    expect(face).not.toBeNull();
    // The face, then the shared head (the name, the lines, the clock).
    const kids = [...(body?.children ?? [])];
    expect(kids.length).toBe(2);
    expect(kids[0]?.classList.contains('agenda-card__face')).toBe(true);
    expect(kids[1]?.classList.contains('staff-event-head')).toBe(true);
    // The barber is no longer INSIDE the client's face...
    expect(face?.querySelector('.agenda-card__barber-face')).toBeNull();
    // ...it shares the FOOT row with the marks, after them...
    const barber = foot?.querySelector('.agenda-card__barber-face');
    expect(barber).not.toBeNull();
    const mark = foot?.querySelector('.agenda-card__mark');
    if (mark && barber) {
      expect(
        mark.compareDocumentPosition(barber) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // ...and that row is its own band across the card, after the body — not
    // crammed into the narrow column the times need.
    expect(
      body &&
        foot &&
        body.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('reserves the face column on the RUN, so names start at one x', () => {
    // Per card, a client with no disc would shift their own name left and
    // the run would stop being scannable down its leading edge.
    const component = fixture.componentInstance as unknown as {
      faceWidth: () => string;
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    expect(component.faceWidth()).not.toBe('0px');
    if (component.fields.isOn('avatar')) component.fields.toggle('avatar');
    if (component.fields.isOn('barberAvatar')) {
      component.fields.toggle('barberAvatar');
    }
    expect(component.faceWidth()).toBe('0px');
  });

  it('says a STATE with a dot and a COUNT with a numeral, both labelled', () => {
    // Status is a dot — the reference's rule taken literally, and what every
    // messaging app means by a dot on an avatar: this person is here. A count
    // is a numeral, because the glyph beside it said "people" and only the
    // number was information. Neither is ever a word or a capsule in the run.
    expect(
      host().querySelector('[data-testid="staff-visit-note-glyph"]'),
    ).toBeNull();
    expect(host().querySelector('.agenda-card__glyphs')).toBeNull();

    // Whatever marks DO render, each is announced — an unlabelled mark on a
    // card whose whole body opens a sheet cannot say what it means.
    for (const dot of host().querySelectorAll('.agenda-card__dot')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.nextElementSibling?.hasAttribute('data-visually-hidden')).toBe(
        true,
      );
    }
    for (const party of host().querySelectorAll('.agenda-card__party')) {
      expect(party.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('reserves NO trailing column — the meta cluster collapses instead', () => {
    // `trailWidth()` held a column open from FIELD STATE, so a switch being
    // on cost width whether or not a single card on screen had anything to
    // put there: 68px of a 298px phone card, taken from the one line that
    // must never truncate, to align a column of nothing with a column of
    // nothing. There is no reserved column now — the cluster is a flex item
    // that is simply absent when empty.
    const component = fixture.componentInstance as unknown as {
      trailWidth?: unknown;
      hasMeta: (entry: {
        partySize: number;
        priceLabel: string | null;
      }) => boolean;
    };
    expect(component.trailWidth).toBeUndefined();
    expect(host().querySelector('.agenda-card__trail')).toBeNull();
    // The run no longer publishes the custom property either.
    const run = host().querySelector('.agenda') as HTMLElement | null;
    expect(run?.style.getPropertyValue('--agenda-trail')).toBeFalsy();
  });

  it('ships free time OFF, and states the quiet in words instead', () => {
    // Every unsold minute is a card, and on the quiet Tuesday that is most
    // of a shop's week the run becomes mostly holes. The screen's job is the
    // bookings; the holes are a second question, asked by whoever is trying
    // to fill one. Turning the inventory off must never hide the FACT of it.
    expect(
      host().querySelectorAll('[data-testid="staff-gap-row"]').length,
    ).toBe(0);
    // The day still SAYS it was quiet, in the summary — but only at one
    // chair, where unsold minutes are clock hours rather than chair-hours.
    // The suite runs at whole-shop scope, so the line is absent here.
    expect(
      host().querySelector('[data-testid="staff-day-summary"]'),
    ).toBeNull();
    showFreeTime();
    expect(
      host().querySelectorAll('[data-testid="staff-gap-row"]').length,
    ).toBeGreaterThan(0);
  });

  it('strikes a CANCELLED booking through, and a no-show never', () => {
    // The platform's own mark for something that is on the calendar and is
    // not happening. A no-show HAPPENED — the chair was held and nobody came
    // — and a line through it would say the booking was withdrawn, which is
    // a different fact and the one thing that row exists to record.
    // jsdom does not resolve component styles, so the rendered line cannot
    // be asserted here — it is verified in the browser. What this locks is
    // the HOOK the rule hangs on: every card publishes its exact status, and
    // the two statuses stay distinguishable to a selector.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.getAttribute('data-status')).toBe('pending');
    const component = fixture.componentInstance as unknown as {
      statusWord: (status: BookingStatus) => string | null;
    };
    expect(component.statusWord(BookingStatus.Cancelled)).not.toBe(
      component.statusWord(BookingStatus.NoShow),
    );
  });

  it('says the state to a screen reader even though the card only shows it', () => {
    // The state is carried by the card's FORM now — hollow for a cancelled
    // booking or a no-show, dashed for pending, plus a strike through the
    // name. A screen reader perceives NONE of that: `text-decoration` is not
    // announced and a missing background certainly is not. Without this the
    // change would have made a cancelled row indistinguishable from a live
    // one for anyone not looking at it.
    const component = fixture.componentInstance as unknown as {
      rowLabel: (e: {
        clientLabel: string;
        startLabel: string;
        bookingStatus: BookingStatus;
        arrived: boolean;
        terminal: boolean;
      }) => string;
    };
    const label = (status: BookingStatus) =>
      component.rowLabel({
        clientLabel: 'Николай',
        startLabel: '10:00',
        bookingStatus: status,
        arrived: false,
        terminal: false,
      });

    // The states the FORM speaks are all appended to the name — under the
    // catalogue's lowercase word for each.
    for (const [status, word] of [
      [BookingStatus.Cancelled, 'cancelled'],
      [BookingStatus.NoShow, 'no_show'],
      [BookingStatus.Pending, 'pending'],
    ] as const) {
      expect(label(status)).toContain('staff.day.exception.' + word);
    }
    // ...and the two ordinary outcomes stay silent, exactly as they are
    // silent visually. A row that says "confirmed" on nine cards in ten is
    // the texture problem this card has now removed three times.
    for (const status of [BookingStatus.Confirmed, BookingStatus.Completed]) {
      expect(label(status)).not.toContain('staff.day.exception');
    }

    // The state is NOT a line in the fact column any more.
    const facts = host().querySelector('.staff-event-head__lines');
    expect(facts?.querySelector('.agenda-card__fact--state')).toBeNull();
  });

  it('releases the now-anchor when TODAY is tapped, so it can re-anchor', () => {
    // `anchorToNow` claims each day once, which is right for a day CHANGE —
    // a barber who has scrolled somewhere on purpose should be left there.
    // But it made the second tap on today inert, and the second tap is
    // exactly the one a barber makes because they have scrolled off and want
    // to come back. Tapping today has to mean "take me to now" every time.
    const component = fixture.componentInstance as unknown as {
      pickDay: (key: string) => void;
      anchoredDay: { set: (v: string | null) => void; (): string | null };
      store: { todayKey: () => string };
    };
    const today = component.store.todayKey();

    component.anchoredDay.set(today);
    component.pickDay(today);
    expect(component.anchoredDay()).toBeNull();

    // Any OTHER day keeps its claim — there is no "now" on screen to scroll
    // to, and re-anchoring would yank a barber off the row they went to read.
    component.anchoredDay.set(today);
    component.pickDay('2099-01-01');
    expect(component.anchoredDay()).toBe(today);
  });

  it('renders no foot row at all when there is nothing to put in it', () => {
    // With price, marks and the barber's face all switched off, the foot
    // still rendered: an empty flex box of zero height, which sounds free and
    // is not. The card's `row-gap` sat on BOTH sides of it, so every row on
    // the screen carried 8px of dead height for a row with nothing in it.
    //
    // Note this could never have been fixed by hiding the element — the gap
    // belongs to the grid TRACK, which exists whether or not anything
    // occupies it. `display: none` on the foot moved the card's height by
    // exactly zero. The card spaces its rows with margins now instead.
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    for (const id of ['price', 'barberAvatar', 'note']) {
      if (component.fields.isOn(id)) component.fields.toggle(id);
    }
    fixture.detectChanges();

    // Any foot still standing has to be one with real content in it (a
    // cancelled or no-show row keeps its state mark).
    for (const foot of host().querySelectorAll('.agenda-card__foot')) {
      expect(foot.children.length).toBeGreaterThan(0);
    }

    // Turning ONE of them back on brings the row back, so the assertion above
    // is not passing merely because no card renders.
    component.fields.toggle('barberAvatar');
    fixture.detectChanges();
    expect(
      host().querySelectorAll('.agenda-card__foot').length,
    ).toBeGreaterThan(0);
  });

  it('marks the party in the foot, not as a line of its own', () => {
    // `1 / 2` is a MARK about the row — a glyph and a count — not a detail
    // of the client like an email or a phone, and as a fact line it cost a
    // whole line of card height to say four characters. The foot adds no
    // height: the barber's disc already needs that row.
    const share = host().querySelector(
      '[data-testid="staff-visit-party-share"]',
    );
    expect(share).not.toBeNull();
    expect(share?.closest('.agenda-card__foot')).not.toBeNull();
    expect(share?.closest('.staff-event-head')).toBeNull();

    // Figures adjacent, plain glyphs after them, the barber's disc last.
    const foot = share?.closest('.agenda-card__foot');
    const kids = [...(foot?.children ?? [])];
    const shareAt = kids.indexOf(share as Element);
    const markAt = kids.findIndex((el) =>
      el.classList.contains('agenda-card__mark'),
    );
    const faceAt = kids.findIndex((el) =>
      el.classList.contains('agenda-card__barber-face'),
    );
    if (markAt !== -1) expect(shareAt).toBeLessThan(markAt);
    if (faceAt !== -1) expect(shareAt).toBeLessThan(faceAt);
  });

  it('keeps hasFoot in step with what the foot actually renders', () => {
    // `hasFoot` duplicates the template's three conditions, and duplicated
    // conditions drift. This ties them together: for every card on screen,
    // the predicate and the DOM must agree.
    const component = fixture.componentInstance as unknown as {
      hasFoot: (e: unknown) => boolean;
      agenda: () => { items: unknown[] }[];
    };
    const cards = [...host().querySelectorAll('.agenda-card--visit')];
    expect(cards.length).toBeGreaterThan(0);
    const entries = component
      .agenda()
      .flatMap((group) => group.items)
      .filter(
        (item) =>
          (item as { agendaRow?: string }).agendaRow === AgendaRow.Visit,
      );

    let checked = 0;
    for (const entry of entries) {
      const id = (entry as { id?: string }).id;
      if (id === undefined) continue;
      const card = host().querySelector(`[data-row-id="${id}"]`);
      if (card === null) continue;
      checked++;
      expect(card.querySelector('.agenda-card__foot') !== null).toBe(
        component.hasFoot(entry),
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives every fact its own LINE, and none of them is clamped', () => {
    // A fact that has to win an argument with another fact in order to be
    // shown is a fact the card is not really carrying. Each one is a row
    // that is either rendered in full or not rendered at all — which is why
    // the note, the only one that could not be, left the column entirely.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    // The shared head's column: the title, then one line per fact.
    const facts = card?.querySelector('.staff-event-head__lines');
    expect(facts).not.toBeNull();
    expect((facts?.children.length ?? 0) > 1).toBe(true);
    for (const fact of facts?.children ?? []) {
      expect(fact.tagName).toBe('SPAN');
      // Nothing in this column truncates.
      expect(fact.className).not.toContain('--note');
    }
  });

  it("gives a failed write its OWN row, not the context line's cell", () => {
    // The error <p> wore `class="agenda-card__ctx"` and therefore
    // `grid-area: ctx` — the same cell the booking's own detail occupies — so
    // the two paragraphs stacked and the message drew on top of the detail.
    // Invisible until a transition actually failed, which is the worst
    // possible moment to find out.
    const ctxCells = host().querySelectorAll('.agenda-card__ctx');
    for (const cell of ctxCells) {
      expect(cell.getAttribute('data-testid')).not.toBe('staff-row-error');
    }
    // And the error, when it renders, is its own class.
    const component = fixture.componentInstance as unknown as {
      rowError: (id: AppointmentId) => string | null;
    };
    expect(typeof component.rowError).toBe('function');
  });

  it("files a refusal in the row of the visit that earned it, never in another visit's", () => {
    // The store files a refusal by APPOINTMENT; the row is asked by its
    // aggregate, not by its own `appointment#chair` key (owner ruling
    // 2026-09-03) — which matched nothing, so no row ever printed one.
    const store = (
      fixture.componentInstance as unknown as {
        store: { refuse: (id: AppointmentId, error: PipelineError) => void };
      }
    ).store;
    const resolved = refusal(
      PipelineErrorCode.InvalidRequest,
      BookingErrorCode.TransitionNotAllowed,
      {
        fromBookingStatus: 'RESOLVED',
        toBookingStatus: BookingStatus.Cancelled,
      },
    );
    const messages = (): (string | null)[] =>
      [...host().querySelectorAll('[data-testid="staff-visit-row"]')].map(
        (row) =>
          row
            .querySelector('[data-testid="staff-row-error"]')
            ?.textContent?.trim() ?? null,
      );
    const rows = host().querySelectorAll('[data-testid="staff-visit-row"]');
    expect(rows.length).toBeGreaterThan(0);
    // Another visit's refusal prints in none of these rows…
    store.refuse(AppointmentId.of('appointment-elsewhere'), resolved);
    fixture.detectChanges();
    expect(messages().every((message) => message === null)).toBe(true);
    // …and this visit's prints in its own. The loader returns no
    // translations, so the KEY reached for is the assertion.
    // The row key is `appointment#chair`; the aggregate is what precedes the last `#`.
    const rowId = rows[0]?.getAttribute('data-row-id') ?? '';
    const own = rowId.slice(0, rowId.lastIndexOf('#'));
    store.refuse(AppointmentId.of(own), resolved);
    fixture.detectChanges();
    expect(messages()[0]).toBe('errors.BOOKING_TRANSITION_SEAT_RESOLVED');
  });

  it('leads the card with a LEDE row, never a capsule or a third row', () => {
    // It was a capsule on a row that existed only when the clock said so, so
    // the run's stride broke at precisely the card the eye is hunting for.
    // Then it was an eyebrow inside the joined line. Now it is the card's
    // own first row, and the joined line is gone.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card).not.toBeNull();
    expect(host().querySelector('.agenda-card__state')).toBeNull();
    expect(host().querySelector('.agenda-chip')).toBeNull();
    expect(host().querySelector('.agenda-card__eyebrow')).toBeNull();

    // Where a lede renders it is a child of the CARD, ahead of the name.
    for (const lede of host().querySelectorAll('.agenda-card__lede')) {
      expect(lede.parentElement?.classList.contains('agenda-card')).toBe(true);
      expect(['exception', 'clock']).toContain(lede.getAttribute('data-kind'));
      const title = lede.parentElement?.querySelector('.agenda-card__title');
      expect(
        title &&
          lede.compareDocumentPosition(title) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('says WHEN on every card, counting a running cut down to its end', () => {
    // Relative time was a field, then a lede that only two rows ever got.
    // The header has a slot of its own now, so every card can say where it
    // sits relative to the clock without costing another fact its place. A
    // live cut counts down to its END — the barber is standing in it and
    // wants the time left, not the time since.
    const component = fixture.componentInstance as unknown as {
      whenLabel: (entry: {
        live: boolean;
        startUtcMs: UtcEpochMs;
        endUtcMs: UtcEpochMs;
      }) => string;
    };
    const now = wall('2026-08-05T09:00:00').utcEpochMs;
    // A running cut reaches for the REMAINING-time phrase. (The suite's
    // loader returns no translations, so this asserts the key it reaches
    // for, not the rendered words.)
    expect(
      component.whenLabel({
        live: true,
        startUtcMs: UtcEpochMs.plusMs(now, -10 * 60_000),
        endUtcMs: UtcEpochMs.plusMs(now, 12 * 60_000),
      }),
    ).toBe('staff.day.agendaRemaining');
    // Anything else counts to its START, through `Intl` rather than
    // transloco — so that one IS real text, in the active language.
    expect(
      component.whenLabel({
        live: false,
        startUtcMs: UtcEpochMs.plusMs(now, 3_600_000),
        endUtcMs: UtcEpochMs.EPOCH,
      }),
    ).toMatch(/\d/);
    for (const row of host().querySelectorAll(
      '[data-testid="staff-visit-row"]',
    )) {
      expect(
        row.querySelector('.staff-event-head__gloss')?.textContent?.trim(),
      ).toBeTruthy();
    }
  });

  it('joins nothing to anything — no middot survives in the run', () => {
    // The owner's central complaint: the card foreach-ed its fields into one
    // line and punctuated them with middots. The pattern is gone at the root
    // — no variant, no other separator, no smarter ordering.
    expect(host().querySelector('.agenda-card__ctx')).toBeNull();
    for (const row of host().querySelectorAll(
      '[data-testid="staff-visit-row"], [data-testid="staff-gap-row"], [data-testid="staff-idle-row"]',
    )) {
      expect(row.textContent).not.toContain('·');
    }
  });

  it('states only what the list cannot be counted for', () => {
    // The summary used to lead with a visit count, and the count DISAGREED
    // with the list beside it: it counts appointments while the run renders
    // one row per appointment PER LANE, so a party across two chairs is one
    // visit and two cards — "4 визити" printed above six rows. A number that
    // contradicts the list is worse than no number.
    //
    // What is left is the one fact nobody can derive by looking: the unsold
    // minutes. And only at ONE chair — summed across five, free time is
    // chair-hours, which read as clock hours.
    const component = fixture.componentInstance as unknown as {
      daySummary: () => string | null;
      store: { setScope: (id: string | null) => void };
    };
    expect(component.store).toBeTruthy();
    // Whole-shop scope: nothing.
    expect(component.daySummary()).toBeNull();
    // One chair: the free-time figure, and no count in it.
    component.store.setScope('ivan');
    fixture.detectChanges();
    const line = component.daySummary();
    if (line !== null) {
      expect(line).not.toMatch(/визит|visit/i);
    }
  });

  it('gives an elapsed hole a LINE and a sellable one a CARD', () => {
    // Same word, different objects. One is time to fill and competes with
    // the bookings beside it; the other already happened and, on a quiet
    // morning, outnumbers them. Form carries it — never a second word.
    showFreeTime();
    const idle = host().querySelector('[data-testid="staff-idle-row"]');
    const sellable = host().querySelector('[data-testid="staff-gap-row"]');
    expect(sellable?.classList.contains('agenda-card--idle')).toBe(false);
    if (idle) expect(idle.classList.contains('agenda-card--idle')).toBe(true);
    // And ONE word for both — "Незаето" is gone.
    for (const gap of host().querySelectorAll(
      '[data-testid="staff-gap-row"], [data-testid="staff-idle-row"]',
    )) {
      expect(gap.textContent).toContain('Free');
    }
  });

  it('drops elapsed holes entirely when every chair is in scope', async () => {
    // Five lanes times every twenty-minute hole is a screenful of things
    // that already happened and that nobody can act on, filed between the
    // bookings the screen is open for. The STORE still computes them —
    // lane-gaps.spec.ts rules that it must — and the summary reads its
    // total off them. What is settled here is only whether each earns a row.
    //
    // The suite's clock stands at 09:00, the first rostered minute, so
    // NOTHING has elapsed and asserting zero rows there would pass against
    // an empty day. The clock is moved to mid-afternoon first, which is when
    // this rule has anything to decide at all.
    TestBed.resetTestingModule();
    await build('2026-08-05T14:20:00.000+03:00');
    showFreeTime();

    const component = fixture.componentInstance as unknown as {
      store: { scope: (() => string | null) & { set?: unknown } };
      setScope?: unknown;
    };
    expect(component.store.scope()).toBeNull();

    // The day HAS elapsed holes — otherwise this proves nothing.
    const store = component.store as unknown as {
      workingLanes: () => readonly { gaps: readonly { sellable: boolean }[] }[];
      setScope: (id: string | null) => void;
    };
    const elapsed = store
      .workingLanes()
      .flatMap((lane) => lane.gaps)
      .filter((gap) => !gap.sellable);
    expect(elapsed.length).toBeGreaterThan(0);

    // ...and none of them is a row while the whole shop is in scope.
    expect(
      host().querySelectorAll('[data-testid="staff-idle-row"]').length,
    ).toBe(0);

    // Narrowed to one chair, they come back — as lines, not cards.
    store.setScope('ivan');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = host().querySelectorAll('[data-testid="staff-idle-row"]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.classList.contains('agenda-card--idle')).toBe(true);
    }
  });

  it('puts WHEN beside the body, and says STATUS only when there is some', () => {
    // The header row is gone — two facts that need no width of their own
    // were costing a whole block of height across the top of every card,
    // before the client's name appeared. They live in the body's trailing
    // column now: the interval at the top, what became of the booking at
    // the bottom, and the card's own height between them.
    expect(host().querySelector('.agenda-card__header')).toBeNull();

    // The clock is ONE thing: the interval, in the shared head's own
    // column. The foot cluster used to sit underneath it, five marks deep
    // in a gutter sized for four characters.
    const times = host().querySelector('.staff-event-head__times');
    expect(times).not.toBeNull();
    expect(times?.querySelector('.agenda-card__foot')).toBeNull();

    const foot = host().querySelector('.agenda-card__foot');
    expect(foot).not.toBeNull();
    expect(
      times &&
        foot &&
        times.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The interval reads DOWNWARD — start, then end, then the gloss. The
    // relative time follows the value it qualifies rather than leading it.
    const order = [...(times?.children ?? [])].map((el) => el.className);
    expect(order[0]).toContain('__start');
    expect(order[1]).toContain('__end');
    expect(order[2]).toContain('__gloss');

    // STATE IS THE CARD'S FORM, NOT A LINE OF TEXT. It was a glyph on every
    // card (texture, not signal), then a word in the fact column — where it
    // read as one more field between the phone and the service. It is now
    // carried by the fill: hollow for a cancellation or a no-show, dashed
    // for pending. What survives in the DOM is announcement only, because
    // neither a shape nor a strikethrough reaches a screen reader.
    expect(
      foot?.querySelector('[data-testid="staff-visit-status"]'),
    ).toBeNull();
    const state = host().querySelector('[data-testid="staff-visit-status"]');
    if (state) {
      expect(state.hasAttribute('data-visually-hidden')).toBe(true);
      expect(state.classList.contains('staff-event-head__line')).toBe(false);
    }

    // It reuses the app's EXISTING status vocabulary rather than a second
    // parallel map of the same five words. (The suite's loader returns no
    // translations, so this asserts the key it reaches for, not the word.)
    const component = fixture.componentInstance as unknown as {
      statusNote: (e: {
        bookingStatus: BookingStatus;
        arrived: boolean;
        terminal: boolean;
      }) => string | null;
    };
    const of = (status: BookingStatus, arrived = false) =>
      component.statusNote({ bookingStatus: status, arrived, terminal: false });

    // Arrival is NOT announced here — it is visible text in the trailing
    // gloss now (`whenLabel`), and saying it twice is a screen-reader bug.
    expect(of(BookingStatus.Confirmed, true)).toBeNull();
    // Silent on the two ordinary outcomes — that is the whole point.
    expect(of(BookingStatus.Confirmed)).toBeNull();
    expect(of(BookingStatus.Completed)).toBeNull();
    // ...and distinct for each state worth interrupting a glance for.
    const kinds = [
      BookingStatus.Pending,
      BookingStatus.Cancelled,
      BookingStatus.NoShow,
    ];
    expect(kinds.every((k) => of(k))).toBe(true);
    expect(new Set(kinds.map((k) => of(k))).size).toBe(3);

    // ARRIVAL IS A WORD, not a dot — and only displaces `confirmed`, because
    // a pending visit that has arrived is still waiting on someone.
    expect(of(BookingStatus.Pending, true)).toBe('staff.day.exception.pending');
  });

  it('opens the visit itself, which the row could never do before', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const sheet = host().querySelector('[data-testid="staff-visit-sheet"]');
    expect(sheet).not.toBeNull();
    // The number was already on the row model and thrown away; this is the
    // first surface in the product that shows it to staff.
    //
    // ONE, in the DOCK, and NAMED (owner, 2026-09-09: "the most common
    // action you do when you open the appointment"; reverses the row
    // placement of 2026-09-08). The client row keeps the number to read.
    const call = sheet?.querySelector('[data-testid="staff-visit-call"]');
    expect(call?.closest('ui-sheet-action-bar')).not.toBeNull();
    expect(call?.getAttribute('href')).toMatch(/^tel:/);
    expect(call?.getAttribute('aria-label')).toContain('staff.day.visitCall');
    expect(
      sheet?.querySelector('[data-testid^="staff-visit-call-"]'),
    ).toBeNull();
  });

  it('names the sheet from the bar, which never collapses away', async () => {
    /*
     * The editor used to carry an `h2 uiSheetLargeTitle` that collapsed into
     * the bar on scroll. On a ladder eight groups long that block bought
     * nothing — the name is the same on every visit — so the bar shows it
     * from the first frame and the id `aria-labelledby` resolves through
     * moved with it. `aria-labelledby` still works although the bar title is
     * `aria-hidden`: a referenced element contributes its text either way.
     */
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const sheet = host().querySelector('[data-testid="staff-visit-sheet"]');
    expect(sheet?.querySelector('[uiSheetLargeTitle]')).toBeNull();

    const label = sheet?.querySelector('#staff-visit-title');
    expect(label).not.toBeNull();
    expect(label?.hasAttribute('sheet-title')).toBe(true);
  });

  it('keeps the drafted day live, and releases it on close', async () => {
    /*
     * The frame in the sheet draws the chair's day around the block, and the
     * pill can step that block onto a date the agenda underneath is not
     * showing. Only `visibleDays()` was subscribed — one day, in day view —
     * so the frame kept drawing the ORIGINAL day's neighbours under a pill
     * that said a different date. The store now keeps the drafted day live
     * as a PROBE; this is what proves the subscription actually moves.
     */
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const daysFor = () => observeBarberDay.mock.calls.map((call) => call[1]);
    expect(daysFor()).toContain('2026-08-05');
    observeBarberDay.mockClear();

    const next = host().querySelector(
      '[data-testid="staff-visit-day-next"]',
    ) as HTMLElement;
    next.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The next day is now subscribed — the frame can only draw what is live.
    expect(daysFor()).toContain('2026-08-06');
    observeBarberDay.mockClear();

    // …and a closed sheet must not keep a listener open on a day nothing is
    // looking at.
    // The REAL close path — the shell's own ✕. A `dismissed` CustomEvent on
    // the host does not reach an Angular `output()`, so dispatching one
    // proved nothing about what closing actually does.
    const close = host().querySelector<HTMLElement>(
      '[data-testid="staff-visit-sheet"] .ui-sheet-header button[uitrailing]',
    );
    expect(close).not.toBeNull();
    close?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The day was stepped, so the draft is dirty and the ✕ asks first
    // (2026-09-18, the discard guard); «Отхвърли» is the close.
    expect(
      host().querySelector('[data-testid="staff-visit-sheet"]'),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-discard-confirm"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-visit-sheet"]'),
    ).toBeNull();

    /*
     * ⚠ RELEASE IS PROVED BY THE NEXT SUBSCRIPTION, not by the absence of
     * one. Closing shrinks the subscribed set, and nothing re-queries until
     * something else moves it — so `not.toContain` straight after the close
     * passed against an EMPTY list, which is true for the wrong reason.
     * Moving the agenda forces a fresh subscription, and the probe's day is
     * absent from it only if the probe was actually let go.
     */
    const component = fixture.componentInstance as unknown as {
      store: { goToDay: (day: string) => void };
    };
    component.store.goToDay('2026-08-04');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(daysFor()).toContain('2026-08-04');
    expect(daysFor()).not.toContain('2026-08-06');
  });

  it('keeps every legal transition reachable — in the sheet, not a popover', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The graph is never narrowed, only relocated: cancelling is still
    // reachable, at full size and named in words.
    expect(
      host().querySelector('[data-testid="staff-visit-cancel"]'),
    ).not.toBeNull();
  });

  /*
   * ── A CHAIR RESOLVED INSIDE A LIVE PARTY (found live, 2026-09-11) ────
   * A guest cancelled out of a two-chair party kept reading as a live visit
   * on his chair, because the row took the ROOT's status — still confirmed
   * while the other seat is scheduled. The sheet then offered «Откажи часа»
   * again and the server refused it as already resolved.
   */
  it("reads a chair by its own seats' outcomes once all of them are resolved", async () => {
    const visits = observeBarberDay.getMockImplementation();
    const seat = (
      chair: string,
      relationship: SubjectRelationship,
      cancelled: boolean,
    ) =>
      seatAt({
        chair,
        startsAt: '2026-08-05T10:00:00',
        occupant: accountOf(freshId('user'), relationship),
        ...(cancelled
          ? {
              // The window the cancel was judged under is not this spec's
              // concern, so none was recorded.
              outcome: SeatOutcome.cancelled(
                wall('2026-08-05T10:00:00').utcEpochMs,
                CancelledBy.Staff,
                CancellationReason.ClientUnwell,
                null,
              ),
            }
          : {}),
      });
    const party = visitOf('appointment-party', [
      seat('ivan', SubjectRelationship.Self, false),
      seat('niko', SubjectRelationship.Companion, true),
    ]);
    observeBarberDay.mockImplementation((barberId: string) =>
      of(
        PortResult.ok(
          barberId === 'ivan' || barberId === 'niko' ? [party] : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const ivan = host().querySelector(
        '[data-row-id="appointment-party#ivan"]',
      );
      const niko = host().querySelector(
        '[data-row-id="appointment-party#niko"]',
      );
      // The root is still live, so Ivan's chair reads as it did…
      expect(ivan?.getAttribute('data-status')).toBe('pending');
      // …and Niko's reads by its own outcome.
      expect(niko?.getAttribute('data-status')).toBe('cancelled');

      // SAID IN A WORD where the countdown stood (owner, 2026-09-24: "so
      // it's instantly recognised"), and a live chair keeps its countdown.
      expect(
        niko?.querySelector('[data-testid="staff-event-state"]')?.textContent,
      ).toContain('appointments.status.cancelled');
      expect(
        niko
          ?.querySelector('.staff-event-head')
          ?.hasAttribute('data-gloss-state'),
      ).toBe(true);
      expect(
        ivan?.querySelector('[data-testid="staff-event-state"]'),
      ).toBeNull();

      // …its glyph on the client's FACE, where a glance starts — moved, not
      // copied: the foot no longer carries it (owner, 2026-09-24).
      expect(
        niko
          ?.querySelector(
            '.agenda-card__face [data-testid="staff-visit-state-badge"] ui-icon',
          )
          ?.getAttribute('data-name'),
      ).toBe('visit.cancelled');
      expect(
        niko?.querySelector(
          '.agenda-card__foot ui-icon[data-name="visit.cancelled"]',
        ),
      ).toBeNull();
      expect(
        ivan?.querySelector('[data-testid="staff-visit-state-badge"]'),
      ).toBeNull();

      // With faces switched off, the foot carries the glyph again.
      const cards = fixture.componentInstance as unknown as {
        fields: { isOn: (id: string) => boolean };
        rowIcons: (entry: unknown) => readonly string[];
      };
      const isOn = cards.fields.isOn.bind(cards.fields);
      cards.fields.isOn = (id: string) => (id === 'avatar' ? false : isOn(id));
      expect(
        cards.rowIcons({
          bookingStatus: BookingStatus.Cancelled,
          rebooked: false,
          hasNote: false,
        }),
      ).toContain('visit.cancelled');
      cards.fields.isOn = isOn;
      expect(
        cards.rowIcons({
          bookingStatus: BookingStatus.Cancelled,
          rebooked: false,
          hasNote: false,
        }),
      ).not.toContain('visit.cancelled');

      // The grid's block says the same on the line under the name.
      const component = fixture.componentInstance as unknown as {
        store: { setView: (view: string) => void };
        gridColumns: () => readonly {
          events: readonly { id: string; detail: string | null }[];
        }[];
      };
      component.store.setView('day');
      fixture.detectChanges();
      const blocks = component.gridColumns().flatMap((column) => column.events);
      expect(
        blocks.find((block) => block.id === 'appointment-party#niko')?.detail,
      ).toBe('appointments.status.cancelled');
      expect(
        (
          blocks.find((block) => block.id === 'appointment-party#niko') as
            { statusIcon?: string | null } | undefined
        )?.statusIcon,
      ).toBe('visit.cancelled');
      expect(
        blocks.find((block) => block.id === 'appointment-party#ivan')?.detail,
      ).not.toBe('appointments.status.cancelled');
      component.store.setView('agenda');
      fixture.detectChanges();

      // Opened, the cancelled chair offers no cancel and no no-show — only
      // the next visit. (The agenda was drawn again: read the row anew.)
      (
        host().querySelector(
          '[data-row-id="appointment-party#niko"]',
        ) as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-visit-cancel"]'),
      ).toBeNull();
      expect(
        host().querySelector('[data-testid="staff-visit-no-show"]'),
      ).toBeNull();
      expect(
        host().querySelector('[data-testid="staff-visit-rebook"]'),
      ).not.toBeNull();

      // …and it opens on what settled it: whose act, when, and why (owner,
      // 2026-09-11). The stamp landed at 10:00 shop time on the visit's own
      // day, so the clock stands alone; the reason is the catalogue's line.
      const head = host().querySelector(
        '[data-testid="staff-visit-resolution"]',
      );
      expect(head?.getAttribute('data-tone')).toBe('destructive');
      const line =
        head?.querySelector('[data-testid="staff-visit-resolution-line"]')
          ?.textContent ?? '';
      expect(line).toContain('staff.visit.resolution.cancelledByClient');
      expect(line).toContain('10:00');
      expect(
        head
          ?.querySelector('[data-testid="staff-visit-resolution-detail"]')
          ?.textContent?.trim(),
      ).toBe('staff.day.cancelReasonCode.client_unwell');
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it("says why a cancellation was refused, in the shop's words rather than the gateway's", async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-cancel"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-cancel-reason-client_changed_plans"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    // The server's refusal rides in the call's error (`serverErrorCode` and
    // its scalars); the sheet must reach for ITS line, not the generic
    // "something went wrong". A seat already resolved moves from no status.
    transition.mockResolvedValueOnce(
      PortResult.err(
        refusal(
          PipelineErrorCode.InvalidRequest,
          BookingErrorCode.TransitionNotAllowed,
          {
            fromBookingStatus: 'RESOLVED',
            toBookingStatus: BookingStatus.Cancelled,
          },
        ),
      ),
    );
    (
      host().querySelector(
        '[data-testid="staff-cancel-confirm"]',
      ) as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = host().querySelector(
      '[data-testid="staff-cancel-sheet"] [role="alert"]',
    );
    // The loader returns no translations, so the KEY reached for is the assertion.
    expect(alert?.textContent?.trim()).toBe(
      'errors.BOOKING_TRANSITION_SEAT_RESOLVED',
    );
    expect(alert?.textContent).not.toContain('BOOKING_CALL_FAILED');
  });

  /*
   * ── THE REASON IS OPTIONAL (owner, 2026-09-11) ──────────────────────
   * "Barbers may not have time to enter such issue." One tap cancels; a
   * reason is a second tap for the barber who has one, and a chip tapped
   * again lets go of it. «Друго…» opens the note, and the note carries an
   * example rather than a second label.
   */
  it('cancels on one tap — a reason is offered, never demanded', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-cancel"]') as HTMLElement
    ).click();
    fixture.detectChanges();

    // The red button is live with nothing picked.
    const confirm = host().querySelector(
      '[data-testid="staff-cancel-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    // A reason picked and picked again is no reason.
    const chip = host().querySelector(
      '[data-testid="staff-cancel-reason-client_unwell"]',
    ) as HTMLElement;
    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    // «Друго…» opens a note with an EXAMPLE in it, and left empty it is a
    // door opened and not walked through — the cancel still goes, unfiled.
    (
      host().querySelector(
        '[data-testid="staff-cancel-reason-other"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    const note = host().querySelector(
      '[data-testid="staff-cancel-note"]',
    ) as HTMLTextAreaElement;
    expect(note.placeholder).toBe('staff.day.cancelNotePlaceholder');
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(transition).toHaveBeenCalledTimes(1);
    const request = transition.mock.calls[0]?.[0];
    expect(request?.toBookingStatus).toBe(BookingStatus.Cancelled);
    // No reason picked and no note: the call says none (the server files
    // the cancellation as unspecified) — and it is a code-only call (D23).
    expect(request?.cancellationReason).toBeNull();
    expect(request).not.toHaveProperty('note');
    // The sheet closed on success.
    expect(
      host().querySelector('[data-testid="staff-cancel-sheet"]'),
    ).toBeNull();
  });

  /*
   * THE SHEET QUOTES WHAT THE SERVER CHARGES. Every chair is offered the
   * whole catalogue — a service he does not perform included — and the
   * server prices an added seat with `OfferingPriceSystem.termsFor`: the
   * chair's own offering, or the SERVICE's own terms for a chair with none.
   * The menu read `offerings.find(chair) ?? offerings[0]` and quoted the
   * first barber's price and minutes to a chair the server would charge
   * the service's terms.
   */
  it('quotes each chair the terms the server will charge — the service’s own for a chair without an offering', async () => {
    const shaveTerms = termsFixture(2000, 30);
    const ivanTerms = termsFixture(3500, 50);
    const longTerms = termsFixture(4200, 60);
    const long = ServiceVariantId.of('long');
    catalogServices = [
      serviceFixture({
        id: ServiceId.of('shave'),
        name: textFixture('shave'),
        description: textFixture('x'),
        categoryId: ServiceCategoryId.of('cat-hair'),
        ...shaveTerms,
        variants: [],
        // Only Ivan performs it, on terms of his own.
        offerings: [
          { barberId: BarberId.of('ivan'), overrides: [], ...ivanTerms },
        ],
        locationIds: [],
        compositionKind: CompositionKind.Single,
      }),
      serviceFixture({
        id: ServiceId.of('cut'),
        name: textFixture('cut'),
        description: textFixture('x'),
        categoryId: ServiceCategoryId.of('cat-hair'),
        ...shaveTerms,
        variants: [{ variantId: long, name: textFixture('long') }],
        offerings: [
          {
            barberId: BarberId.of('ivan'),
            overrides: [{ variantId: long, ...longTerms }],
            ...ivanTerms,
          },
        ],
        locationIds: [],
        compositionKind: CompositionKind.Single,
      }),
    ];
    try {
      TestBed.resetTestingModule();
      await build();
      const page = fixture.componentInstance as unknown as {
        onVisitChairChanged: (barberId: string) => void;
        visitServiceOptions: () => readonly {
          readonly id: string;
          readonly minutes: number;
          readonly priceLabel: string;
        }[];
        chairMinutesOf: (seat: Seat, barberId: string) => number | null;
      };
      const price = (major: number) =>
        TestBed.inject(CatalogWording).price({
          amountCents: cents(major * 100),
          currency: Currency.EUR,
        });
      const quoted = (id: string) =>
        page.visitServiceOptions().find((option) => option.id === id);

      // Niko performs neither: the service's own terms, never Ivan's.
      page.onVisitChairChanged('niko');
      expect(quoted('shave')).toMatchObject({
        minutes: 30,
        priceLabel: price(20),
      });
      expect(quoted('cut:long')).toMatchObject({
        minutes: 30,
        priceLabel: price(20),
      });
      // Ivan: his own offering, and his own price for the long cut.
      page.onVisitChairChanged('ivan');
      expect(quoted('shave')).toMatchObject({
        minutes: 50,
        priceLabel: price(35),
      });
      expect(quoted('cut:long')).toMatchObject({
        minutes: 60,
        priceLabel: price(42),
      });

      // The row's tag measures against the same terms.
      const seat = (barberId: string): Seat =>
        seatFixture({
          serviceId: ServiceId.of('shave'),
          barberId: BarberId.of(barberId),
        });
      expect(page.chairMinutesOf(seat('niko'), 'niko')).toBe(30);
      expect(page.chairMinutesOf(seat('ivan'), 'ivan')).toBe(50);
    } finally {
      catalogServices = null;
    }
  });

  /*
   * ── «ДРУГО…» FILES ITS WORDS AS THE VISIT'S NOTE (D23) ──────────────
   * The cancellation is code-only: the call says `OTHER` and nothing more.
   * What the barber wrote is "an appointment note" — saved, once the
   * cancel has landed, BELOW whatever note the visit already has, through
   * the same note write the visit sheet uses.
   */
  describe('«Друго…» files its words as the visit’s note (D23)', () => {
    /** The visit's stored note, as the notes collection would answer it. */
    let storedText: string | null;
    let saveAnswer: PortResult<void, RepositoryError>;
    /** Every note write, in order, beside every call — one timeline. */
    let timeline: string[];
    let saved: (AppointmentNote | null)[];
    /** The lanes' own visits, put back after a case that rebuilt with its own. */
    let visits: ReturnType<typeof observeBarberDay.getMockImplementation>;

    beforeEach(() => {
      storedText = null;
      saveAnswer = PortResult.ok(undefined);
      timeline = [];
      saved = [];
      visits = observeBarberDay.getMockImplementation();
      wireNotes();
    });

    /**
     * The notes and the call, both onto the one timeline — on the module
     * `build()` made, so a case that rebuilds with a visit of its own wires
     * them again.
     */
    function wireNotes(): void {
      const notes = TestBed.inject(APPOINTMENT_NOTE_PORTS) as {
        observeAppointmentNote: AppointmentNotePorts['observeAppointmentNote'];
        saveAppointmentNote: AppointmentNotePorts['saveAppointmentNote'];
      };
      notes.observeAppointmentNote = (appointmentId) =>
        of(
          PortResult.ok<AppointmentNote | null>(
            storedText === null
              ? null
              : {
                  id: appointmentId,
                  text: storedText,
                  authorUserId: null,
                  writtenAtUtcMs: wall('2026-08-05T08:00:00').utcEpochMs,
                },
          ),
        );
      notes.saveAppointmentNote = async (_appointmentId, note) => {
        timeline.push('note');
        saved.push(note);
        return saveAnswer;
      };
      transition.mockImplementation(async (input) => {
        timeline.push('transition');
        return PortResult.ok({
          appointmentId: input.appointmentId,
          toBookingStatus: input.toBookingStatus,
        });
      });
    }

    /** The page again, on Ivan's lane holding `visit` alone, its notes wired. */
    async function rebuildWith(visit: Appointment): Promise<void> {
      observeBarberDay.mockImplementation((barberId: string) =>
        of(PortResult.ok(barberId === 'ivan' ? [visit] : [])),
      );
      TestBed.resetTestingModule();
      await build();
      wireNotes();
    }

    /** The seat each call addressed, in order — `null` is the whole booking. */
    function sentSeats(): (string | null)[] {
      return transition.mock.calls.map((call) => call[0].seatId);
    }

    afterEach(() => {
      if (visits) observeBarberDay.mockImplementation(visits);
      transition.mockReset();
      transition.mockImplementation(async (input) =>
        PortResult.ok({
          appointmentId: input.appointmentId,
          toBookingStatus: input.toBookingStatus,
        }),
      );
    });

    /** The visit's sheet, its cancel, a reason picked and words written. */
    async function cancelWith(
      reasonWord: string,
      written: string,
    ): Promise<void> {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
      (
        host().querySelector(
          '[data-testid="staff-visit-cancel"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      (
        host().querySelector(
          `[data-testid="staff-cancel-reason-${reasonWord}"]`,
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      const note = host().querySelector(
        '[data-testid="staff-cancel-note"]',
      ) as HTMLTextAreaElement | null;
      if (note !== null) {
        note.value = written;
        note.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      }
      (
        host().querySelector(
          '[data-testid="staff-cancel-confirm"]',
        ) as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function notice(): string | null {
      return (
        fixture.componentInstance as unknown as { notice: () => string | null }
      ).notice();
    }

    it('sends OTHER as a code alone, then saves the words as the visit’s note', async () => {
      await cancelWith('other', '  наводнение в салона ');

      const request = transition.mock.calls[0]?.[0];
      expect(request?.cancellationReason).toBe(CancellationReason.Other);
      expect(request).not.toHaveProperty('note');
      // After the cancel landed, never before it.
      expect(timeline).toEqual(['transition', 'note']);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        id: 'appointment-1',
        text: 'наводнение в салона',
        authorUserId: 'dev-staff-ivan',
      });
      expect(notice()).toBeNull();
    });

    it('appends below a note the visit already has, never over it', async () => {
      storedText = 'алергия към ментол';
      await cancelWith('other', 'наводнение');

      expect(saved.map((note) => note?.text)).toEqual([
        'алергия към ментол\nнаводнение',
      ]);
    });

    it('saves nothing when nothing was written — no code, and no note', async () => {
      await cancelWith('other', '   ');

      expect(timeline).toEqual(['transition']);
      expect(transition.mock.calls[0]?.[0].cancellationReason).toBeNull();
      expect(saved).toEqual([]);
    });

    it('saves nothing beside a code of its own — it carries no words to file', async () => {
      await cancelWith('client_unwell', '');

      expect(timeline).toEqual(['transition']);
      expect(transition.mock.calls[0]?.[0].cancellationReason).toBe(
        CancellationReason.ClientUnwell,
      );
      expect(saved).toEqual([]);
    });

    it('files nothing when the cancel was refused', async () => {
      transition.mockImplementation(async () => {
        timeline.push('transition');
        return PortResult.err(
          refusal(
            PipelineErrorCode.InvalidRequest,
            BookingErrorCode.TransitionNotAllowed,
            {
              fromBookingStatus: 'RESOLVED',
              toBookingStatus: BookingStatus.Cancelled,
            },
          ),
        );
      });
      await cancelWith('other', 'наводнение');

      expect(timeline).toEqual(['transition']);
      expect(saved).toEqual([]);
    });

    it('says so in the page’s toast when the note did not save — the cancel stands', async () => {
      saveAnswer = PortResult.err(
        RepositoryError.writeFailed('appointmentNotes/appointment-1', null),
      );
      await cancelWith('other', 'наводнение');

      expect(timeline).toEqual(['transition', 'note']);
      // The loader returns no translations, so the KEY is the assertion.
      expect(notice()).toBe('staff.day.cancelNoteFailed');
      // The cancel sheet closed on the cancel's success all the same.
      expect(
        host().querySelector('[data-testid="staff-cancel-sheet"]'),
      ).toBeNull();
    });

    /*
     * ONE SENTENCE FOR EITHER SCOPE. The toast is raised after a seat called
     * off out of a party as well as after a whole booking, so it says only
     * that the cancel stands — never «Часът е отказан», which told the
     * barber the rest of the party had lost its booking too. The fixture's
     * own row is Ivan's share of a split party: the SEAT case.
     */
    const noteLost = [
      ['bg', 'Отказано е, но бележката не се запази.'],
      ['en', "Cancelled, but the note didn't save."],
    ] as const;

    /** The shipped catalogue's toast, live in `lang`, for the length of `run`. */
    async function inCatalogue(
      lang: 'bg' | 'en',
      run: () => Promise<void>,
    ): Promise<void> {
      const transloco = TestBed.inject(TranslocoService);
      const catalogue = lang === 'bg' ? bgCatalogue : enCatalogue;
      transloco.setTranslation(
        {
          'staff.day.cancelNoteFailed': catalogue.staff.day.cancelNoteFailed,
        },
        lang,
        { merge: true },
      );
      transloco.setActiveLang(lang);
      try {
        await run();
      } finally {
        transloco.setActiveLang('bg');
      }
    }

    it.each(noteLost)(
      'says the cancel stands and only the note was lost, for a seat called off out of a party — exact %s',
      async (lang, sentence) => {
        await inCatalogue(lang, async () => {
          saveAnswer = PortResult.err(
            RepositoryError.writeFailed('appointmentNotes/appointment-1', null),
          );
          await cancelWith('other', 'наводнение');

          // One call, for Ivan's seat alone — the party keeps the rest.
          expect(sentSeats()).toEqual([expect.any(String)]);
          expect(timeline).toEqual(['transition', 'note']);
          expect(notice()).toBe(sentence);
        });
      },
    );

    it.each(noteLost)(
      'says the same for a whole booking called off — exact %s',
      async (lang, sentence) => {
        await rebuildWith(appointment('appointment-1', '2026-08-05T10:00:00'));
        await inCatalogue(lang, async () => {
          saveAnswer = PortResult.err(
            RepositoryError.writeFailed('appointmentNotes/appointment-1', null),
          );
          await cancelWith('other', 'наводнение');

          expect(sentSeats()).toEqual([null]);
          expect(timeline).toEqual(['transition', 'note']);
          expect(notice()).toBe(sentence);
        });
      },
    );

    /**
     * A father and son in Ivan's chair, one after the other, and a friend in
     * Niko's — so Ivan's row is a share of the party, two seats wide.
     */
    function fatherAndSon(): Appointment {
      const seatOf = (
        seatId: string,
        chair: string,
        startsAt: string,
        relationship: SubjectRelationship,
      ) =>
        seatAt({
          seatId,
          chair,
          startsAt,
          occupant: accountOf(freshId('user'), relationship),
        });
      return visitOf('appointment-pair', [
        seatOf(
          'seat-father',
          'ivan',
          '2026-08-05T10:00:00',
          SubjectRelationship.Self,
        ),
        seatOf(
          'seat-son',
          'ivan',
          '2026-08-05T10:30:00',
          SubjectRelationship.Companion,
        ),
        seatOf(
          'seat-friend',
          'niko',
          '2026-08-05T10:00:00',
          SubjectRelationship.Companion,
        ),
      ]);
    }

    /*
     * A CHAIR HOLDING TWO SEATS, THE SECOND REFUSED. The first seat now
     * carries OTHER, so its words are filed at once — and once: the sheet
     * stays open on the seat still to go, the retry sends that seat alone
     * (the first would be refused as already resolved, for ever), and the
     * words are not appended a second time when it lands.
     */
    it('files the words once when a chair’s second seat is refused, and retries only that seat', async () => {
      await rebuildWith(fatherAndSon());
      let sonRefused = true;
      transition.mockImplementation(async (input) => {
        timeline.push('transition');
        return sonRefused && input.seatId === 'seat-son'
          ? PortResult.err(PipelineError.bare(PipelineErrorCode.Unavailable))
          : PortResult.ok({
              appointmentId: input.appointmentId,
              toBookingStatus: input.toBookingStatus,
            });
      });
      const page = fixture.componentInstance as unknown as {
        cancelId: () => string | null;
        cancelSeatIds: () => readonly string[];
      };

      await cancelWith('other', 'наводнение');

      expect(sentSeats()).toEqual(['seat-father', 'seat-son']);
      expect(timeline).toEqual(['transition', 'transition', 'note']);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        id: 'appointment-pair',
        text: 'наводнение',
      });
      expect(notice()).toBeNull();
      // Still open, on the seat still to go.
      expect(page.cancelId()).toBe('appointment-pair');
      expect(page.cancelSeatIds()).toEqual(['seat-son']);
      expect(
        host().querySelector('[data-testid="staff-cancel-sheet"]'),
      ).not.toBeNull();

      // The retry lands the son: his seat alone, and no second note.
      sonRefused = false;
      transition.mockClear();
      (
        host().querySelector(
          '[data-testid="staff-cancel-confirm"]',
        ) as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(sentSeats()).toEqual(['seat-son']);
      expect(transition.mock.calls[0]?.[0].cancellationReason).toBe(
        CancellationReason.Other,
      );
      expect(timeline).toEqual([
        'transition',
        'transition',
        'note',
        'transition',
      ]);
      expect(saved).toHaveLength(1);
      expect(page.cancelId()).toBeNull();
      expect(
        host().querySelector('[data-testid="staff-cancel-sheet"]'),
      ).toBeNull();
    });

    it('files nothing when every seat of the chair was refused, and keeps both to retry', async () => {
      await rebuildWith(fatherAndSon());
      transition.mockImplementation(async () => {
        timeline.push('transition');
        return PortResult.err(
          PipelineError.bare(PipelineErrorCode.Unavailable),
        );
      });
      const page = fixture.componentInstance as unknown as {
        cancelSeatIds: () => readonly string[];
      };

      await cancelWith('other', 'наводнение');

      expect(timeline).toEqual(['transition', 'transition']);
      expect(saved).toEqual([]);
      expect(page.cancelSeatIds()).toEqual(['seat-father', 'seat-son']);
    });

    it('writes over nothing it could not read: a failed read saves nothing and says so', async () => {
      storedText = 'алергия към ментол';
      const notes = TestBed.inject(APPOINTMENT_NOTE_PORTS) as {
        observeAppointmentNote: AppointmentNotePorts['observeAppointmentNote'];
      };
      notes.observeAppointmentNote = () =>
        of(
          PortResult.err(
            RepositoryError.readFailed(
              'appointmentNotes/appointment-1',
              'unavailable',
            ),
          ),
        );
      await cancelWith('other', 'наводнение');

      expect(saved).toEqual([]);
      expect(notice()).toBe('staff.day.cancelNoteFailed');
    });
  });

  it('slides the week strip a WHOLE week, in CSS, with nothing to press', () => {
    // The gesture is the browser's: `ui-scroll-row` supplies
    // `scroll-snap-type: x mandatory` and `scroll-snap-align: start` on each
    // child, and every child is exactly one scrollport wide — which is the
    // only reason a flick advances by a week rather than a day. No scroll
    // listener, no drag maths, no chevrons.
    const strip = host().querySelector('[data-testid="staff-week-strip"]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('data-snap')).toBe('start');

    const weeks = [...(strip?.querySelectorAll('.staff-weeks__week') ?? [])];
    // A bounded window anchored to TODAY, not to the selection: anchoring to
    // the selection would re-key every week on every tap and rebuild the
    // strip under the user's thumb.
    expect(weeks.length).toBe(13);
    // Seven days each, and every one is a real button.
    for (const week of weeks) {
      expect(week.querySelectorAll('.staff-weeks__day').length).toBe(7);
    }
    for (const day of strip?.querySelectorAll('.staff-weeks__day') ?? []) {
      expect(day.tagName).toBe('BUTTON');
      expect(day.getAttribute('aria-label')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Exactly one day is current, and it says so to a screen reader.
    const current = strip?.querySelectorAll('[aria-current="date"]') ?? [];
    expect(current.length).toBe(1);

    // ONE marker per week, and it is the only thing that draws the disc —
    // the numeral paints no background of its own. A background on whichever
    // day was selected TELEPORTED, and the jump is what made a day change
    // read as slow: measured, the disc updates in 8-23ms and the agenda in
    // 49-63ms warm, so the lag was never in the work.
    for (const week of weeks) {
      expect(week.querySelectorAll('.staff-weeks__marker').length).toBe(1);
    }
    // The selected week publishes the column the marker parks in; the others
    // publish -1 and hide it.
    const withSelection = weeks.filter((w) =>
      w.hasAttribute('data-has-selection'),
    );
    expect(withSelection.length).toBe(1);
    expect(
      Number(
        (withSelection[0] as HTMLElement).style.getPropertyValue(
          '--staff-week-col',
        ),
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("does not rebuild the strip's labels when the shown day changes", () => {
    // The cells' text is a function of the DATE and the LOCALE. It used to be
    // computed inside the same memo that reads `dayKey()`, so every tap
    // rebuilt ninety-one cells and constructed a hundred and eighty-two
    // `Intl.DateTimeFormat`s to re-derive labels that had not moved —
    // measured at 14ms of work per tap, for nothing.
    //
    // Node identity would NOT catch a regression here: `@for` tracks by
    // `day.key`, so Angular reuses the same elements whether or not the
    // objects behind them were rebuilt. What actually distinguishes the two
    // is the FORMATTER CONSTRUCTION, so that is what this counts. The
    // weekday initial is the strip's alone — nothing else in the dashboard
    // asks for `weekday: 'narrow'` — which makes it an exact probe.
    const real = Intl.DateTimeFormat;
    let narrow = 0;
    const spy = function (
      locale?: unknown,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.weekday === 'narrow') narrow++;
      return new (
        real as unknown as new (
          l?: unknown,
          o?: Intl.DateTimeFormatOptions,
        ) => Intl.DateTimeFormat
      )(locale, options);
    };
    Object.setPrototypeOf(spy, real);

    const days = Array.from(
      host().querySelectorAll<HTMLButtonElement>('.staff-weeks__day'),
    );
    const shown = days.findIndex((d) => d.hasAttribute('data-selected'));
    expect(shown).toBeGreaterThanOrEqual(0);
    const next = days[shown + 1] ?? days[shown - 1];
    expect(next).toBeDefined();
    if (!next) return;

    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = spy;
    try {
      next.click();
      fixture.detectChanges();
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = real;
    }

    // Not one. Changing the day may not touch the strip's labels at all.
    expect(narrow).toBe(0);

    // And the selection DID move, so the count above is not vacuous.
    expect(next.hasAttribute('data-selected')).toBe(true);
    expect(
      host().querySelectorAll('.staff-weeks__day[data-selected]').length,
    ).toBe(1);
  });

  it('presses through the DS grammar, not a local hover treatment', () => {
    // The card had its own hover/press/focus rules and they were wrong twice:
    // they replaced `background-color`, which threw away the chair's tint, and
    // the fix for THAT was an inset shadow with a 100vmax spread — a repaint
    // the size of the viewport on every frame of the transition.
    //
    // `uiInteractive` is the sanctioned grammar and its own docs say surfaces
    // must not invent their own. It layers a `::after` over the tint instead
    // of replacing it, and brings the press scale, the disabled guards, the
    // focus ring and the reduced-motion opt-out with it.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.hasAttribute('data-interactive')).toBe(true);
    // No JS hover anywhere on the row — the state is entirely CSS.
    for (const attr of ['mouseenter', 'mouseover', 'mouseleave']) {
      expect(host().innerHTML).not.toContain(attr);
    }
  });

  it('carries no interactive control inside the card at all', () => {
    // The card IS the target. It briefly grew a phone link, which put an
    // unlabelled receiver on a surface whose whole body opens a sheet — and
    // printed a client's number on a screen that faces the room.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.querySelector('a, button')).toBeNull();
  });

  it('arms the day-wide lift before it deletes anything', async () => {
    // `clearBlock` removes the chair's WHOLE exception document for the date
    // — every block plus the all-day absence — so it must not happen on the
    // tap that asked for it.
    const component = fixture.componentInstance as unknown as {
      openRestDay: (barberId: string) => void;
      liftFromEditor: () => Promise<void>;
      blockLiftArmed: () => boolean;
    };
    component.openRestDay('ivan');

    await component.liftFromEditor();
    expect(component.blockLiftArmed()).toBe(true);
    expect(writeScheduleException).not.toHaveBeenCalled();

    await component.liftFromEditor();
    expect(writeScheduleException).toHaveBeenCalledTimes(1);
    expect(component.blockLiftArmed()).toBe(false);
  });

  it('lets the block sheet be re-aimed at another chair', () => {
    // The shop-wide action pre-aims at the first lane; without a picker that
    // meant one barber could stand a colleague's chair down in two taps.
    const component = fixture.componentInstance as unknown as {
      openBlockSheet: (barberId: string) => void;
      blockLaneId: () => string | null;
      barberOptions: () => readonly { id: string }[];
    };
    component.openBlockSheet('ivan');
    fixture.detectChanges();
    expect(component.blockLaneId()).toBe('ivan');
    // The chair it opened on is a row; the others wait behind «Добави
    // бръснар» (owner, 2026-09-09: several barbers, discretely).
    expect(component.barberOptions().map((o) => o.id)).toContain('ivan');
    expect(
      host().querySelector('[data-testid="staff-block-barber-ivan"]'),
    ).not.toBeNull();
    expect(
      host().querySelector('[data-testid="staff-block-add-barber"]'),
    ).not.toBeNull();
  });

  it('names the visits a block would strand rather than sitting on them', () => {
    const component = fixture.componentInstance as unknown as {
      openRestDay: (barberId: string) => void;
    };
    component.openRestDay('ivan');
    fixture.detectChanges();
    // The fixture books one live visit in Ivan's chair; a whole-day block
    // lands squarely on top of it, and the frame names it in red — under
    // the picture, the way the visit sheet names a collision. (The suite's
    // loader carries no copy, so the sentence is its key.)
    const note = host().querySelector('[data-testid="staff-block-frame-note"]');
    expect(note?.getAttribute('data-verdict')).toBe('conflict');
    expect(note?.textContent).toContain('staff.visit.conflict');
  });

  it('keeps only ONE transient surface open at a time', () => {
    const component = fixture.componentInstance as unknown as {
      togglePicker: (which: DayPicker) => void;
      toggleDatePicker: () => void;
      openPicker: () => string | null;
      datePickerOpen: () => boolean;
    };
    component.togglePicker(DayPicker.Scope);
    expect(component.openPicker()).toBe(DayPicker.Scope);
    // Each opener used to own its own flag and know nothing about the others,
    // so surfaces stacked — the date popover over a still-open picker, over a
    // scrim that was swallowing outside taps for all of them.
    component.toggleDatePicker();
    expect(component.datePickerOpen()).toBe(true);
    expect(component.openPicker()).toBeNull();
  });

  /** Blocking time is an act, so its door is the ＋ menu's «Блок». */
  function openBlockDoor(): void {
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-add-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
  }

  it('blocks a range through the exception writer, sanitized', async () => {
    openBlockDoor();

    (
      host().querySelector(
        '[data-testid="staff-block-save"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    // The default is a RANGE, not the whole day — standing a chair down for
    // a full day is the rarer act and must be chosen deliberately. And a
    // range ACCUMULATES: the command reads the chair's day and merges the
    // range into it, never replacing what the day already held.
    expect(writeScheduleException).toHaveBeenCalledTimes(1);
    const [keys] = writeScheduleException.mock.calls[0] ?? [];
    expect(keys).toEqual(['ivan__2026-08-05']);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      barberId: 'ivan',
      localDate: '2026-08-05',
      locationId: 'loc-center',
      // Sanitized: the public EFFECT, and no reason rides in it.
      ...unwrapOk(
        ExceptionEffectRule.blocked([MinuteRange.of(wallAt(12), until(13))]),
      ),
    });
    expect(exceptions[0]).not.toHaveProperty('reason');
  });

  it('merges a range into the blocks the day already holds — never replacing them', async () => {
    // The lunch hour is already blocked; a second range joins it.
    const lunch = unwrapOk(
      ExceptionEffectRule.blocked([MinuteRange.of(wallAt(15), until(16))]),
    );
    exceptions.push({
      id: ScheduleExceptionId.of(
        BusyKey.of(
          BarberId.of('ivan'),
          unwrapOk(LocalDate.parse('2026-08-05')),
        ),
      ),
      barberId: BarberId.of('ivan'),
      localDate: unwrapOk(LocalDate.parse('2026-08-05')),
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(
        unwrapOk(LocalDate.parse('2026-08-05')),
        FIXTURE_TIME_ZONE,
      ),
      locationId: SHOP,
      ...lunch,
    });
    openBlockDoor();
    (
      host().querySelector(
        '[data-testid="staff-block-save"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      exceptionEffect: ExceptionEffect.Blocked,
      exceptionRanges: [
        MinuteRange.of(wallAt(12), until(13)),
        MinuteRange.of(wallAt(15), until(16)),
      ],
    });
  });

  it('stands the whole day down when the switch is on', async () => {
    openBlockDoor();
    (
      host().querySelector(
        '[data-testid="staff-block-all-day"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-block-save"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(writeScheduleException).toHaveBeenCalledTimes(1);
    const [written] = exceptions;
    if (!written) throw new Error('the writer was never called');
    // A whole day off, whatever the reason: the reason-free `CLOSED`.
    expect(written.exceptionEffect).toBe(ExceptionEffect.Closed);
    expect(written).not.toHaveProperty('exceptionRanges');
  });

  /** The view options live in a pull-down now, so the trigger opens first. */
  function chooseView(view: string): void {
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        `[data-testid="staff-view-${view}"]`,
      ) as HTMLButtonElement
    ).click();
  }

  it('switches to the day view and columns by CHAIR — including the chair that is off', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // BOTH barbers get a column: Ivan rostered, Niko off. A dropped column is
    // not a quiet answer, it is no answer — "off today", "out of scope" and
    // "the roster failed to load" all render as the same nothing, and the
    // column count would change with the data so the same chair moved around
    // the screen day to day (owner ruling 2026-08-10).
    expect(
      host().querySelectorAll('[data-testid="staff-grid-column-head"]').length,
    ).toBe(2);

    // Niko's column is shut for the WHOLE day: one closed run, top to bottom.
    const columns = host().querySelectorAll(
      '[data-testid="staff-grid-column"]',
    );
    const niko = [...columns].find(
      (column) => column.getAttribute('data-column') === 'niko',
    );
    const shut = niko?.querySelectorAll('[data-testid="staff-grid-closed"]');
    expect(shut?.length).toBe(1);
    expect((shut?.[0] as HTMLElement).style.gridRow).toBe('1 / 97');

    // …and SAYS so. Shading alone is one channel, and the one a screen reader
    // cannot read; the all-day row is the band built for a fact with no hour.
    expect(host().textContent).toContain('staff.day.offBadge');

    // The zone is the head's other job and survives either way — NAMED only
    // while the device's clock is not the shop's (review r4, 2026-10-06).
    deviceZone('UTC');
    expect(
      host().querySelector('[data-testid="staff-grid-zone"]')?.textContent,
    ).toContain('EE');
  });

  it('leaves the corner blank, and drops the bare head, while the device is in the shop’s zone (review r4)', async () => {
    // «EEST» in every grid's corner read as a debug label: a barber's phone
    // is in the shop's zone and nothing else in the app names one. The
    // corner keeps its track (the axis hairline hangs on it) and says
    // nothing; it names the clock again — and opens the sentence — only
    // for a device abroad.
    chooseView('three-day');
    deviceZone(FIXTURE_TIME_ZONE);
    await fixture.whenStable();
    fixture.detectChanges();
    const corner = host().querySelector('[data-testid="staff-grid-zone"]');
    expect(corner?.tagName).toBe('SPAN');
    expect(corner?.hasAttribute('data-blank')).toBe(true);
    expect(corner?.textContent?.trim()).toBe('');
    expect(host().querySelector('.staff-grid__head')).not.toBeNull();

    deviceZone('UTC');
    const named = host().querySelector('[data-testid="staff-grid-zone"]');
    expect(named?.tagName).toBe('BUTTON');
    expect(named?.textContent).toContain('EE');

    // One chair in scope and nothing to name: no head band at all — a
    // blank corner alone would be a band of nothing above the hours.
    chooseView('day');
    deviceZone(FIXTURE_TIME_ZONE);
    await fixture.whenStable();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('.staff-grid__head')).toBeNull();
    expect(host().querySelector('[data-testid="staff-grid-zone"]')).toBeNull();
  });

  it('drops the column head only when ONE chair is in scope', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Scoped to one barber the head is suppressed: the toolbar already names
    // whose day this is, and repeating it under the bar is a row of chrome
    // for nothing. The bare band stays for the zone — while there is one
    // to name, the device off the shop's clock (review r4, 2026-10-06).
    deviceZone('UTC');
    expect(
      host().querySelectorAll('[data-testid="staff-grid-column-head"]').length,
    ).toBe(0);
    expect(host().querySelector('.staff-grid__head--bare')).not.toBeNull();
  });

  it("carries a block's state in words, not only in its fill", async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const block = host().querySelector('[data-testid="staff-grid-event"]');
    // HIG *Color*: never rely on colour alone. The fill is one channel; this
    // is the one a screen reader — and a greyscale print — actually has.
    const name = block?.getAttribute('aria-label') ?? '';
    expect(name).toContain('appointments.status.');
    // The block's own text is abbreviated as it shrinks, so the accessible
    // name must state the span itself rather than inherit it.
    expect(name).toMatch(/\d{1,2}:\d{2}/);
  });

  it('draws the now-line only when TODAY is one of the columns', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The clock stub sits on the anchor day, so the line belongs here.
    expect(
      host().querySelectorAll('[data-testid="staff-grid-now"]').length,
    ).toBeGreaterThan(0);

    // Browse away. A rule saying "now" across a day three weeks out marks an
    // hour that has not happened — it would be pointing at nothing.
    (
      host().querySelector(
        '[data-testid="staff-day-label"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="ui-month-day-2026-08-26"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host().querySelectorAll('[data-testid="staff-grid-now"]').length,
    ).toBe(0);
    expect(
      host().querySelector('[data-testid="staff-grid-now-label"]'),
    ).toBeNull();
  });

  it('hatches every PAST block, whatever became of it', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The clock stub is 09:00; the fixture's visit is 10:00–10:30, so it is
    // still ahead and must NOT be hatched.
    const block = host().querySelector('[data-testid="staff-grid-event"]');
    expect(block?.hasAttribute('data-past')).toBe(false);

    // The flag is temporal, not a status: it is set off the END INSTANT, so
    // a completed cut, a no-show and a cancellation at the same hour all
    // carry it together — and so does a booking still sitting `confirmed`,
    // which is the row a shop most needs to notice.
    expect(block?.getAttribute('data-status')).toBe('pending');
  });

  it('draws no "free" blocks on the calendar — empty space IS the gap', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The list view carries gap ROWS because a list has no empty space to
    // read. A proportional grid is nothing but empty space, so the same
    // information drawn as a block is chrome over a fact the eye already has.
    expect(
      host().querySelectorAll('[data-testid="staff-grid-gap"]').length,
    ).toBe(0);
  });

  it('columns the week by DATE, Monday first, and scopes to one chair', async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heads = [
      ...host().querySelectorAll('[data-testid="staff-grid-column-head"]'),
    ];
    expect(heads.length).toBe(7);
    // 2026-08-05 is a Wednesday, so its week opens on Monday the 3rd, and the
    // day number rides its own capsule beside the weekday.
    expect(
      heads[0]?.querySelector('.staff-grid__column-day')?.textContent?.trim(),
    ).toBe('3');
    // The chair picker only exists where a column is a date.
    expect(
      host().querySelector('[data-testid="staff-scope-trigger"]'),
    ).not.toBeNull();
  });

  it('marks TODAY in the column head, by capsule not by colour alone', async () => {
    chooseView('three-day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heads = [
      ...host().querySelectorAll('[data-testid="staff-grid-column-head"]'),
    ];
    // The clock stub says 2026-08-05, the anchor day — so the first column.
    expect(heads[0]?.hasAttribute('data-today')).toBe(true);
    expect(heads[1]?.hasAttribute('data-today')).toBe(false);
  });

  it('lays overlapping seats side by side rather than stacking them', async () => {
    chooseView('three-day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const events = [
      ...host().querySelectorAll('[data-testid="staff-grid-event"]'),
    ] as HTMLElement[];
    // Every block states which lane of how many it occupies, and a lane
    // offset that a later `margin-inline` shorthand once silently reset.
    for (const event of events) {
      const lanes = Number(event.style.getPropertyValue('--staff-event-lanes'));
      const lane = Number(event.style.getPropertyValue('--staff-event-lane'));
      expect(lanes).toBeGreaterThanOrEqual(1);
      expect(lane).toBeLessThan(lanes);
    }
    // The MULTI-lane case needs two chairs busy at one hour, which this
    // fixture's single rostered barber cannot produce; it is verified in the
    // browser against the seeded mixed party (two seats at 16:00 laying out
    // at half width, side by side). What this pins is the invariant that
    // held even while the layout was broken: the lane index is always
    // in range, so a regression shows up as a bad offset, not bad data.
    expect(events.length).toBeGreaterThan(0);
  });

  it('names the view by GLYPH, and keeps the label where it teaches', () => {
    const trigger = host().querySelector(
      '[data-testid="staff-view-trigger"]',
    ) as HTMLButtonElement;
    // The trigger is a glyph, so its accessible name carries what the eye
    // reads off the icon — otherwise the control is unnameable.
    // The stub loader returns raw keys, so assert the SHAPE: the label names
    // the current view rather than being a bare "View".
    expect(trigger.getAttribute('aria-label')).toContain(
      'staff.day.view.agenda',
    );
    expect(trigger.querySelector('ui-icon')).not.toBeNull();

    trigger.click();
    fixture.detectChanges();
    // Inside the menu the label stays: a list of four bare glyphs would be
    // the only place that teaches which glyph means what.
    const item = host().querySelector('[data-testid="staff-view-week"]');
    expect(item?.textContent).toContain('staff.day.view.week');
    expect(item?.querySelector('ui-icon')).not.toBeNull();
  });

  it("picks the barber by PORTRAIT, with the booking flow's any-glyph", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger = host().querySelector(
      '[data-testid="staff-scope-trigger"]',
    ) as HTMLButtonElement;
    // The trigger is the SAME DS button as its neighbours, and "everyone"
    // rides the SAME control a barber does — `ui-avatar` with a glyph in
    // place of the monogram, which is the booking flow's "Anyone" exactly.
    expect(trigger.classList.contains('ui-button')).toBe(true);
    expect(trigger.querySelector('ui-avatar')).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toContain('staff.day.scopeAll');

    trigger.click();
    fixture.detectChanges();
    expect(
      host().querySelector(
        '[data-testid="staff-scope-all"] [uiLeading] ui-avatar',
      ),
    ).not.toBeNull();

    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Scoped to one barber, the trigger becomes their portrait.
    expect(trigger.querySelector('ui-avatar')).not.toBeNull();
  });

  it('searches name, phone digits and service across past and upcoming', async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    input.value = 'георги';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const hits = host().querySelectorAll('[data-testid="staff-search-hit"]');
    expect(hits.length).toBe(1);
    // The matching run is MARKED, and the original casing survives it.
    const mark = hits[0]?.querySelector('.staff-search__mark');
    expect(mark?.textContent).toBe('Георги');
  });

  it("finds a phone by bare digits, across the formatter's spaces", async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    // Nobody types a number with the formatter's spaces in it.
    input.value = '359881234567';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(
      host().querySelectorAll('[data-testid="staff-search-hit"]').length,
    ).toBe(1);
  });

  it('advertises no write it cannot actually perform', () => {
    // The FAB shipped with three arms and two opened a sheet saying the
    // feature was not built. A receptionist who taps the primary action
    // twice and is told "not yet" both times has learned the app does not
    // do what its buttons say — a lesson the third, working arm does not
    // undo. It returns with the walk-in write (plan item C4).
    expect(host().querySelector('[data-testid="staff-fab"]')).toBeNull();
    expect(
      host().querySelector('[data-testid="staff-fab-trigger"]'),
    ).toBeNull();
    // The bar itself stays — "back to today" still lives in it, and so does
    // the ONE create door the page can honour today: the block editor.
    expect(host().querySelector('ui-page-action-bar')).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // The ＋ is the kind picker: what you are making, as a menu.
    (
      host().querySelector(
        '[data-testid="staff-add-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-block-sheet"]'),
    ).not.toBeNull();
  });

  // The owner, 2026-09-24: "do the same for no-show visits" — one
  // treatment for both hours that did not happen.
  it('treats a no-show like a cancellation: the word, the face badge, no tag, and a glyph on the block', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const base = appointment(
      'appointment-missed',
      '2026-08-05T09:00:00',
      undefined,
      'ivan',
      false,
      'fade',
    );
    const seat = base.seats[0];
    if (seat === undefined) throw new Error('the fixture has no seat');
    const missed: Appointment = {
      ...base,
      seats: [
        Seat.withOutcome(
          seat,
          SeatOutcome.noShow(wall('2026-08-05T10:00:00').utcEpochMs),
        ),
      ],
    };
    observeBarberDay.mockImplementation((barberId: string) =>
      of(PortResult.ok(barberId === 'ivan' ? [missed] : [])),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const card = host().querySelector(
        '[data-row-id="appointment-missed#ivan"]',
      );
      expect(card?.getAttribute('data-status')).toBe('no_show');
      expect(
        card?.querySelector('[data-testid="staff-event-state"]')?.textContent,
      ).toContain('staff.visit.resolution.noShow');
      expect(
        card
          ?.querySelector('[data-testid="staff-visit-state-badge"] ui-icon')
          ?.getAttribute('data-name'),
      ).toBe('visit.noShow');
      expect(
        card?.querySelector(
          '.agenda-card__foot ui-icon[data-name="visit.noShow"]',
        ),
      ).toBeNull();
      expect(card?.querySelector('[data-testid="staff-visit-tag"]')).toBeNull();
      expect(
        card?.querySelector('.staff-event-head')?.hasAttribute('data-struck'),
      ).toBe(true);

      const component = fixture.componentInstance as unknown as {
        store: { setView: (view: string) => void };
        gridColumns: () => readonly {
          events: readonly {
            id: string;
            detail: string | null;
            statusIcon: string | null;
          }[];
        }[];
      };
      component.store.setView('day');
      fixture.detectChanges();
      const block = component
        .gridColumns()
        .flatMap((column) => column.events)
        .find((event) => event.id === 'appointment-missed#ivan');
      expect(block?.detail).toBe('staff.visit.resolution.noShow');
      expect(block?.statusIcon).toBe('visit.noShow');
      component.store.setView('agenda');
      fixture.detectChanges();
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  // The other hour that did not happen: the case above pins the strike for
  // a no-show only, and the card reads the STORED tag straight into the
  // head's strike and the tag's gate — no lowercase word between them, so a
  // cancellation must strike exactly as a no-show does (UI residue cleanup,
  // §1.2 row 28).
  it('strikes a cancelled agenda card and draws no tag on it, like a no-show', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const base = appointment(
      'appointment-called-off',
      '2026-08-05T14:00:00',
      undefined,
      'ivan',
      false,
      'fade',
    );
    const seat = base.seats[0];
    if (seat === undefined) throw new Error('the fixture has no seat');
    const calledOff: Appointment = {
      ...base,
      seats: [
        Seat.withOutcome(
          seat,
          SeatOutcome.cancelled(
            wall('2026-08-05T10:00:00').utcEpochMs,
            CancelledBy.Client,
            CancellationReason.ClientUnwell,
            null,
          ),
        ),
      ],
    };
    observeBarberDay.mockImplementation((barberId: string) =>
      of(PortResult.ok(barberId === 'ivan' ? [calledOff] : [])),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const card = host().querySelector(
        '[data-row-id="appointment-called-off#ivan"]',
      );
      expect(card?.getAttribute('data-status')).toBe('cancelled');
      expect(
        card?.querySelector('.staff-event-head')?.hasAttribute('data-struck'),
      ).toBe(true);
      expect(card?.querySelector('[data-testid="staff-visit-tag"]')).toBeNull();
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  // An hour that did not happen drops the marks that only matter to a
  // live visit (owner, 2026-09-24): the catalogue tag first.
  it('draws no duration tag on a cancelled visit', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const cancelled = appointment(
      'appointment-fade-off',
      '2026-08-05T14:00:00',
      undefined,
      'ivan',
      false,
      'fade',
    );
    const seat = cancelled.seats[0];
    if (seat === undefined) throw new Error('the fixture has no seat');
    const resolved: Appointment = {
      ...cancelled,
      seats: [
        Seat.withOutcome(
          seat,
          SeatOutcome.cancelled(
            wall('2026-08-05T10:00:00').utcEpochMs,
            CancelledBy.Client,
            CancellationReason.ClientUnwell,
            null,
          ),
        ),
      ],
    };
    observeBarberDay.mockImplementation((barberId: string) =>
      of(PortResult.ok(barberId === 'ivan' ? [resolved] : [])),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const card = host().querySelector(
        '[data-row-id="appointment-fade-off#ivan"]',
      );
      expect(card?.getAttribute('data-status')).toBe('cancelled');
      expect(card?.querySelector('[data-testid="staff-visit-tag"]')).toBeNull();
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  /** Ivan's 14:00 fade: sold for 30 minutes, 45 in the chair's catalogue. */
  function stretchedFade(): void {
    observeBarberDay.mockImplementation((barberId: string) =>
      of(
        PortResult.ok(
          barberId === 'ivan'
            ? [
                appointment(
                  'appointment-fade',
                  '2026-08-05T14:00:00',
                  undefined,
                  'ivan',
                  false,
                  'fade',
                ),
              ]
            : [],
        ),
      ),
    );
  }

  it("tags a visit that runs off the catalogue's length, the way the frame does", async () => {
    // Owner, 2026-09-10: "the events here should look a lot like the ones
    // in the frame … the ±x min if extended or subtracted". The seat was
    // sold for 30 minutes; the chair's catalogue says 45 for the fade, so
    // the card says «−15 мин» in its foot, beside the marks — the frame's
    // own tag, one recipe.
    const visits = observeBarberDay.getMockImplementation();
    stretchedFade();
    try {
      TestBed.resetTestingModule();
      await build();
      // The loader hands over no words, so the tag is WITHHELD — never the
      // key with a minus in front of it (review r4, 2026-10-06).
      expect(
        host().querySelector('[data-testid="staff-visit-tag"]'),
      ).toBeNull();

      TestBed.inject(TranslocoService).setTranslation(
        { 'staff.visit.minutes': '{{minutes}} мин' },
        'bg',
        { merge: true },
      );
      fixture.detectChanges();
      const tag = host().querySelector('[data-testid="staff-visit-tag"]');
      expect(tag?.textContent?.trim()).toBe('−15 мин');
      expect(tag?.closest('.agenda-card__foot')).not.toBeNull();
      expect(tag?.classList.contains('staff-event-tag')).toBe(true);
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it('words the tag the moment the table lands, on rows built before it (review r4)', async () => {
    // The live defect (2026-10-06): `bg.json` landed after the first change
    // detection, the rows had been computed with the key — an effect reads
    // them before the words — and the capsule read «−staff.visit.minutes»
    // until the clock ticked. The loader answers LATE here, the rows are
    // read before it does, and once it has the tag is worded; a dotted key
    // never reaches the DOM.
    const visits = observeBarberDay.getMockImplementation();
    stretchedFade();
    lateTable = new ReplaySubject<Translation>(1);
    try {
      TestBed.resetTestingModule();
      await build();
      const component = fixture.componentInstance as unknown as {
        agenda: () => readonly {
          items: readonly { tag?: string | null }[];
        }[];
      };
      const before = component.agenda().flatMap((group) => group.items);
      expect(before.length).toBeGreaterThan(0);
      expect(before.every((item) => !item.tag)).toBe(true);
      expect(
        host().querySelector('[data-testid="staff-visit-tag"]'),
      ).toBeNull();

      lateTable.next({ 'staff.visit.minutes': '{{minutes}} мин' });
      lateTable.complete();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const tags = [
        ...host().querySelectorAll('[data-testid="staff-visit-tag"]'),
      ].map((tag) => tag.textContent?.trim() ?? '');
      expect(tags).toEqual(['−15 мин']);
    } finally {
      lateTable = null;
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it('opens the block sheet on a day nobody works — the ＋ never resolves to nobody', async () => {
    // Owner, 2026-09-09: "adding a blocker when all are blocked for the
    // selected date is not working — it should always open". A day everyone
    // is off has no working lane, and the create chair used to be read off
    // the lanes alone.
    // No roster AND no bookings: a chair with a visit still works the day.
    const roster = observeSchedule.getMockImplementation();
    const visits = observeBarberDay.getMockImplementation();
    observeSchedule.mockImplementation(() => of(PortResult.ok(null)));
    observeBarberDay.mockImplementation(() => of(PortResult.ok([])));
    try {
      TestBed.resetTestingModule();
      await build();
      const component = fixture.componentInstance as unknown as {
        openCreate: (createIntent: CreateIntent) => void;
        lanes: () => readonly unknown[];
        blockLaneId: () => string | null;
      };
      expect(component.lanes()).toHaveLength(0);
      component.openCreate(CreateIntent.Block);
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-block-sheet"]'),
      ).not.toBeNull();
      expect(component.blockLaneId()).toBe('ivan');
      // And the picture tells the truth: a chair with no roster is shut all
      // day — one closed run over the whole column, not a free day.
      expect(
        host().querySelectorAll('[data-testid="staff-grid-closed"]'),
      ).toHaveLength(1);
    } finally {
      if (roster) observeSchedule.mockImplementation(roster);
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  describe('every staff intent goes out named (2026-09-25)', () => {
    const DAY = unwrapOk(LocalDate.parse('2026-08-05'));
    /** A `MOVE` of the whole party to `minuteOfDay` on the fixture's day. */
    const moveTo = (minuteOfDay: number): BookingCall.EditCommand =>
      BookingCall.editMove(DAY, unwrapOk(MinuteOfDay.of(minuteOfDay)), null);
    const MOVE = moveTo(11 * 60);

    /** One staff intent on `appointment-1` — a claim of nothing unless said. */
    function intent(
      command: BookingCall.EditCommand,
      extra: Partial<BookingCall.StaffEdit> = {},
    ): BookingCall.StaffEdit {
      return {
        appointmentId: AppointmentId.of('appointment-1'),
        commands: [command],
        acknowledgedOverlap: false,
        expectedVersion: null,
        operationId: null,
        ...extra,
      };
    }

    /** The callable's `staffEditAppointment`, answering from `answers` in order. */
    function sends(
      answers: readonly ('ok' | 'lost')[],
    ): BookingCall.StaffEdit[] {
      const sent: BookingCall.StaffEdit[] = [];
      gateway[Callables.StaffEditAppointment] = async (request) => {
        const answer = answers[sent.length] ?? 'ok';
        sent.push(request);
        return answer === 'ok'
          ? PortResult.ok({
              appointmentId: request.appointmentId,
              revision: sent.length,
            })
          : PortResult.err(PipelineError.bare(PipelineErrorCode.Unknown));
      };
      return sent;
    }

    function store(): {
      staffEdit: (request: BookingCall.StaffEdit) => Promise<boolean>;
      errorFor: (id: string) => PipelineError | null;
    } {
      return (
        fixture.componentInstance as unknown as {
          store: {
            staffEdit: (request: BookingCall.StaffEdit) => Promise<boolean>;
            errorFor: (id: string) => PipelineError | null;
          };
        }
      ).store;
    }

    it('re-sends a failed intent under its own name, and names the next one afresh', async () => {
      const sent = sends(['lost', 'ok', 'ok']);

      // The answer is lost; the barber taps «Запази» again on the same draft.
      expect(await store().staffEdit(intent(MOVE))).toBe(false);
      expect(await store().staffEdit(intent(MOVE))).toBe(true);
      // Landed — so the same batch again is the barber doing it AGAIN.
      await store().staffEdit(intent(MOVE));

      const names = sent.map((request) => request.operationId);
      expect(names[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(names[1]).toBe(names[0]);
      expect(names[2]).not.toBe(names[0]);
    });

    it('names a changed draft afresh even after a failure', async () => {
      const sent = sends(['lost', 'ok']);

      await store().staffEdit(intent(MOVE));
      await store().staffEdit(intent(moveTo(12 * 60)));

      expect(sent[1]?.operationId).not.toBe(sent[0]?.operationId);
    });

    it('treats an acknowledged overlap as a new decision, not a re-send', async () => {
      const sent = sends(['lost', 'ok']);

      await store().staffEdit(intent(MOVE));
      await store().staffEdit(intent(MOVE, { acknowledgedOverlap: true }));

      expect(sent[1]?.operationId).not.toBe(sent[0]?.operationId);
    });

    it('keeps a name the caller chose', async () => {
      const sent = sends(['ok']);

      await store().staffEdit(
        intent(MOVE, {
          operationId: unwrapOk(
            ClientOperationId.parse('operation-chosen-by-caller'),
          ),
        }),
      );

      expect(sent[0]?.operationId).toBe('operation-chosen-by-caller');
    });

    it('refuses an intent whose freshly minted name the call cannot carry — nothing goes out', async () => {
      const sent = sends(['ok']);
      // A name off the wire's charset or length — the server would refuse it.
      minted = -1;
      const ids = TestBed.inject(ID_PORTS) as { nextId: () => string };
      const mint = ids.nextId;
      ids.nextId = () => 'short';
      try {
        expect(await store().staffEdit(intent(MOVE))).toBe(false);
      } finally {
        ids.nextId = mint;
      }
      expect(sent).toHaveLength(0);
      expect(store().errorFor('appointment-1')).toMatchObject({
        serverErrorCode: StaffEditErrorCode.InvalidCommand,
        field: 'operationId',
      });
    });

    it('names each queued drop as its own intent when it goes', async () => {
      const sent: BookingCall.StaffEdit[] = [];
      let release: () => void = () => undefined;
      gateway[Callables.StaffEditAppointment] = async (request) => {
        sent.push(request);
        if (sent.length === 1) {
          await new Promise<void>((resolve) => (release = resolve));
        }
        return PortResult.ok({
          appointmentId: request.appointmentId,
          revision: 1,
        });
      };

      const first = store().staffEdit(intent(MOVE));
      // A newer drop while the first is in flight: queued, not sent.
      await store().staffEdit(intent(moveTo(12 * 60)));
      expect(sent).toHaveLength(1);
      release();
      await first;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent).toHaveLength(2);
      expect(sent[1]?.operationId).toMatch(/^operation-/);
      expect(sent[1]?.operationId).not.toBe(sent[0]?.operationId);
    });

    // Round 3 (2026-09-25): the name was kept per VISIT and cleared by any
    // success, so a lost-but-committed intent superseded by a queued drop
    // that landed went out afresh the next time — and applied twice.
    it('keeps a failed intent’s name across a queued drop that landed — the same intent sent again is still one change', async () => {
      const sent: BookingCall.StaffEdit[] = [];
      let release: (answer: 'ok' | 'lost') => void = () => undefined;
      gateway[Callables.StaffEditAppointment] = async (request) => {
        sent.push(request);
        const answer =
          sent.length === 1
            ? await new Promise<'ok' | 'lost'>((resolve) => (release = resolve))
            : 'ok';
        return answer === 'ok'
          ? PortResult.ok({
              appointmentId: request.appointmentId,
              revision: sent.length,
            })
          : PortResult.err(PipelineError.bare(PipelineErrorCode.Unknown));
      };

      const first = store().staffEdit(intent(MOVE));
      // A newer drop while the first is in flight: queued.
      await store().staffEdit(intent(moveTo(12 * 60)));
      // The first answer is lost; the queued drop goes, and lands.
      release('lost');
      expect(await first).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sent).toHaveLength(2);

      // The first intent, sent again: under its own name, whatever landed.
      await store().staffEdit(intent(MOVE));
      expect(sent).toHaveLength(3);
      expect(sent[1]?.operationId).not.toBe(sent[0]?.operationId);
      expect(sent[2]?.operationId).toBe(sent[0]?.operationId);
    });

    /*
     * ── THE STALE-SCREEN GUARD (round 5) ─────────────────────────────────
     * Every intent claims the revision it was made on; the store carries
     * that claim forward across THIS device's own landed intents only.
     */
    /** A callable that stamps the next revision after the one claimed. */
    function stamps(
      refuse: (request: BookingCall.StaffEdit) => boolean = () => false,
    ): BookingCall.StaffEdit[] {
      const sent: BookingCall.StaffEdit[] = [];
      gateway[Callables.StaffEditAppointment] = async (request) => {
        sent.push(request);
        return refuse(request)
          ? PortResult.err(
              refusal(
                PipelineErrorCode.InvalidRequest,
                StaffEditErrorCode.Stale,
                {
                  expected: request.expectedVersion ?? 0,
                  actual: 9,
                },
              ),
            )
          : PortResult.ok({
              appointmentId: request.appointmentId,
              revision: (request.expectedVersion ?? 0) + 1,
            });
      };
      return sent;
    }

    it('sends the revision the intent was made on, and a claim of nothing as nothing', async () => {
      const sent = stamps();
      await store().staffEdit(intent(MOVE, { expectedVersion: 3 }));
      await store().staffEdit(
        intent(MOVE, {
          appointmentId: AppointmentId.of('appointment-2'),
          expectedVersion: null,
        }),
      );

      expect(sent.map((request) => request.expectedVersion)).toEqual([3, null]);
    });

    it('carries the claim across its OWN landed intents — a save’s undo is never stale against the save', async () => {
      const sent = stamps();
      // The save, drawn at 3, lands at 4; its undo was drawn at 3 too.
      await store().staffEdit(intent(MOVE, { expectedVersion: 3 }));
      await store().staffEdit(intent(moveTo(10 * 60), { expectedVersion: 3 }));
      // …and a third save from the same sheet, still drawn at 3.
      await store().staffEdit(intent(moveTo(12 * 60), { expectedVersion: 3 }));

      expect(sent.map((request) => request.expectedVersion)).toEqual([3, 4, 5]);
    });

    it('sends a drop queued behind its own in-flight save on the revision that save stamped', async () => {
      const sent: BookingCall.StaffEdit[] = [];
      let release: () => void = () => undefined;
      gateway[Callables.StaffEditAppointment] = async (request) => {
        sent.push(request);
        if (sent.length === 1) {
          await new Promise<void>((resolve) => (release = resolve));
        }
        return PortResult.ok({
          appointmentId: request.appointmentId,
          revision: (request.expectedVersion ?? 0) + 1,
        });
      };

      const first = store().staffEdit(intent(MOVE, { expectedVersion: 3 }));
      await store().staffEdit(intent(moveTo(12 * 60), { expectedVersion: 3 }));
      release();
      await first;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent.map((request) => request.expectedVersion)).toEqual([3, 4]);
    });

    it('never carries a claim across somebody else’s save — the stale refusal stands, and is the row’s', async () => {
      const sent = stamps((request) => request.expectedVersion === 3);
      const refused = await store().staffEdit(
        intent(MOVE, { expectedVersion: 3 }),
      );

      expect(refused).toBe(false);
      const error = store().errorFor('appointment-1');
      expect(error?.serverErrorCode).toBe(StaffEditErrorCode.Stale);
      // A refused intent stamped nothing: the next one drawn at 3 claims 3.
      await store().staffEdit(intent(moveTo(12 * 60), { expectedVersion: 3 }));
      expect(sent[1]?.expectedVersion).toBe(3);
    });

    it('re-sends a lost intent under its name AND its claim, so the server answers it from the ledger', async () => {
      const sent = sends(['lost', 'ok']);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await store().staffEdit(intent(MOVE, { expectedVersion: 3 }));
      }
      expect(sent[1]?.operationId).toBe(sent[0]?.operationId);
      expect(sent[1]?.expectedVersion).toBe(3);
    });

    // What the store guarantees is a bound on ITS map: at most CAP failed
    // names per visit. It cannot promise to keep a name no longer than the
    // server's ledger remembers it (that ledger counts every device's
    // applied intents); the batch's own shape is the backstop, pinned in
    // the edit pipeline's spec (round 4, 2026-09-25).
    it('holds at most CAP failed names per visit, dropping the oldest', async () => {
      const cap = AppliedOperation.CAP;
      const sent = sends(Array.from({ length: cap + 2 }, () => 'lost'));
      const at = (minute: number) => moveTo(11 * 60 + minute);

      // CAP + 1 different intents fail: the oldest name falls off.
      for (let minute = 0; minute <= cap; minute += 1) {
        await store().staffEdit(intent(at(minute)));
      }
      await store().staffEdit(intent(at(0)));
      expect(sent[cap + 1]?.operationId).not.toBe(sent[0]?.operationId);
      // The newest is still remembered.
      await store().staffEdit(intent(at(cap)));
      expect(sent[cap + 2]?.operationId).toBe(sent[cap]?.operationId);
    });

    it("sends the sheet's «Запази» named", async () => {
      const sent = sends(['ok']);
      const component = fixture.componentInstance as unknown as {
        commitFromEditor: (id: string, commit: unknown) => Promise<void>;
        visitSheetRow: () => { appointmentId: string } | null;
      };
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      const row = component.visitSheetRow();
      if (row === null) throw new Error('the sheet did not open');

      await component.commitFromEditor(row.appointmentId, {
        revision: null,
        dayKey: '2026-08-05',
        startMinute: 600,
        endMinute: 630,
        locationId: null,
        note: null,
        discounts: [],
        vouchers: [],
        tipCents: null,
        drawn: null,
        clients: [],
        legs: [],
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.operationId).toMatch(/^operation-\d{12}$/);
    });
  });

  it("raises a refused save as the page's toast, in the shop's words, and keeps the sheet", async () => {
    // Owner, 2026-09-17: "save doesn't work all the time … if there is an
    // error message it should appear as a toast". The row's own error line
    // lives on the agenda behind the sheet; the toast is what the eye gets.
    gateway[Callables.StaffEditAppointment] = async () =>
      PortResult.err(
        refusal(
          PipelineErrorCode.InvalidRequest,
          BookingErrorCode.ConflictingServices,
        ),
      );
    const component = fixture.componentInstance as unknown as {
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => unknown;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const toast = () => host().querySelector('[data-testid="staff-toast"]');
    expect(toast()?.hasAttribute('data-presented')).toBe(false);

    // Every seat dropped: a batch with something in it, refused.
    await component.commitFromEditor(row.appointmentId, {
      revision: null,
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      locationId: null,
      note: null,
      discounts: [],
      vouchers: [],
      tipCents: null,
      drawn: null,
      clients: [],
      legs: [],
    });
    fixture.detectChanges();
    expect(toast()?.hasAttribute('data-presented')).toBe(true);
    // The toast carries the refusal as `describeError` words it. The loader
    // returns no translations here, so the server code's own line cannot
    // be told from its key and the description falls back to the surface's
    // own — the shop's sentence («Тези услуги не се комбинират.») is what
    // the running app shows, verified live. No undo on offer, only the
    // dismiss.
    expect(toast()?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'BOOKING_CALL_FAILED',
    );
    expect(toast()?.querySelectorAll('button').length).toBe(1);
    expect(component.undo()).toBeNull();
    expect(component.visitSheetRow()?.appointmentId).toBe(row.appointmentId);
  });

  // Round 4 (2026-09-25): a refusal that names WHY (`field`) is worded one
  // level deeper, the client's rule (`wordPipelineError`). A save that would
  // seat one person in two chairs said only "invalid input".
  it('words a refused save by the field it names, then by its code, then as the surface', async () => {
    TestBed.inject(TranslocoService).setTranslation(
      {
        'errors.BOOKING_INVALID_INPUT': 'Невалидни данни.',
        'errors.BOOKING_INVALID_INPUT.person_overlap':
          'Един човек не може да е на два стола.',
      },
      'bg',
      { merge: true },
    );
    const invalid = (field: string | null) =>
      refusal(
        PipelineErrorCode.InvalidRequest,
        BookingErrorCode.InvalidInput,
        {},
        field === null ? {} : { field },
      );
    gateway[Callables.StaffEditAppointment] = async () =>
      PortResult.err(invalid('person_overlap'));
    const component = fixture.componentInstance as unknown as {
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      visitSheetRow: () => { appointmentId: string } | null;
      describeError: (error: PipelineError) => string;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');

    await component.commitFromEditor(row.appointmentId, {
      revision: null,
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      locationId: null,
      note: null,
      discounts: [],
      vouchers: [],
      tipCents: null,
      drawn: null,
      clients: [],
      legs: [],
    });
    fixture.detectChanges();
    expect(
      host()
        .querySelector('[data-testid="staff-toast"] [role="status"]')
        ?.textContent?.trim(),
    ).toBe('Един човек не може да е на два стола.');

    // A field with no copy of its own falls back to the code's; no server
    // code at all, to the surface's own.
    expect(component.describeError(invalid('seats'))).toBe('Невалидни данни.');
    expect(component.describeError(invalid(null))).toBe('Невалидни данни.');
    expect(
      component.describeError(PipelineError.bare(PipelineErrorCode.Unknown)),
    ).toBe('BOOKING_CALL_FAILED');
  });

  /*
   * THE TRANSITION REFUSAL, WORDED (Phase 4a, P6): the wire carries the two
   * stored tags (`fromBookingStatus`, `toBookingStatus`); the sentence says
   * them in the shop's words — the shared words table's segment, then the
   * catalogue's label for it — exactly as the legacy wire's lowercase words
   * were said. Pinned byte for byte in bg and en, on the real catalogues.
   */
  it('words a refused transition with its two statuses in the shop’s words — exact bg and en', () => {
    const component = fixture.componentInstance as unknown as {
      describeError: (error: PipelineError) => string;
    };
    const transloco = TestBed.inject(TranslocoService);
    const refused = refusal(
      PipelineErrorCode.InvalidRequest,
      BookingErrorCode.TransitionNotAllowed,
      {
        fromBookingStatus: BookingStatus.Completed,
        toBookingStatus: BookingStatus.Confirmed,
      },
    );
    for (const [lang, catalogue] of [
      ['bg', bgCatalogue],
      ['en', enCatalogue],
    ] as const) {
      transloco.setTranslation(
        {
          'errors.BOOKING_TRANSITION_NOT_ALLOWED':
            catalogue.errors.BOOKING_TRANSITION_NOT_ALLOWED,
          'appointments.status.completed':
            catalogue.appointments.status.completed,
          'appointments.status.confirmed':
            catalogue.appointments.status.confirmed,
        },
        lang,
        { merge: true },
      );
      transloco.setActiveLang(lang);
    }
    transloco.setActiveLang('bg');
    expect(component.describeError(refused)).toBe(
      'Часът не може да мине от „Минал“ към „Потвърден“.',
    );
    transloco.setActiveLang('en');
    expect(component.describeError(refused)).toBe(
      'The appointment cannot move from "Past" to "Confirmed".',
    );
    transloco.setActiveLang('bg');
  });

  it("sends the editor's shutter up with the visit's facts, and a refusal as the page's toast", async () => {
    // Owner, 2026-09-17: photos on a visit carry who — the chair the sheet
    // is on, the client it is for, the visit.
    const requests: {
      appointmentId: string;
      barberId: string;
      clientLabel: string;
      file: Blob;
    }[] = [];
    let answer = true;
    const component = fixture.componentInstance as unknown as {
      store: {
        attachPhoto: (request: (typeof requests)[number]) => Promise<boolean>;
      };
      visitEditorVm: () => {
        appointmentId: string;
        chairId: string;
        clientLabel: string;
      } | null;
      attachPhotoFromEditor: (vm: unknown, file: File) => Promise<void>;
      notice: () => string | null;
    };
    component.store.attachPhoto = async (request) => {
      requests.push(request);
      return answer;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const vm = component.visitEditorVm();
    if (vm === null) throw new Error('the sheet did not open');
    const file = new File(['bytes'], 'cut.jpg', { type: 'image/jpeg' });

    await component.attachPhotoFromEditor(vm, file);
    expect(requests.length).toBe(1);
    expect(requests[0]?.appointmentId).toBe(vm.appointmentId);
    expect(requests[0]?.barberId).toBe(vm.chairId);
    expect(requests[0]?.clientLabel).toBe(vm.clientLabel);
    expect(requests[0]?.file).toBe(file);
    expect(component.notice()).toBeNull();

    answer = false;
    await component.attachPhotoFromEditor(vm, file);
    fixture.detectChanges();
    // The loader returns no translations: the key reached for is the assertion.
    expect(component.notice()).toBe('staff.visit.photoFailed');
    expect(
      host()
        .querySelector('[data-testid="staff-toast"]')
        ?.hasAttribute('data-presented'),
    ).toBe(true);
  });

  it('asks the index by every form of a typed number, once per pause, and never lets a late answer win', async () => {
    const component = fixture.componentInstance as unknown as {
      searchClients: (query: string) => void;
      visitClientOptions: () => readonly {
        id: string;
        label: string;
        phone: string | null;
        email?: string | null;
      }[];
      visitClientSearching: () => boolean;
      userSearch: {
        searchUsers: (prefix: string, limit: number) => Promise<unknown>;
      };
    };
    const asked: (readonly [string, number])[] = [];
    const martin = registeredUserFixture({
      id: AccountId.of('u-martin'),
      firstName: 'Мартин',
      lastName: 'Илиев',
      phone: E164.of('+359887654321'),
    });
    component.userSearch.searchUsers = async (prefix, limit) => {
      asked.push([prefix, limit]);
      // Only the national form finds him; the other two forms find nobody.
      return PortResult.ok(prefix === '0887654321' ? [martin] : []);
    };
    vi.useFakeTimers();
    try {
      component.searchClients('88');
      component.searchClients('887654');
      component.searchClients('887654321');
      expect(component.visitClientSearching()).toBe(true);
      expect(asked).toEqual([]);
      await vi.advanceTimersByTimeAsync(250);
    } finally {
      vi.useRealTimers();
    }
    // One pause, one question — asked in all three forms the index holds,
    // twenty accounts at most each.
    expect(asked).toEqual([
      ['887654321', 20],
      ['0887654321', 20],
      ['359887654321', 20],
    ]);
    expect(component.visitClientSearching()).toBe(false);
    expect(component.visitClientOptions()).toEqual([
      expect.objectContaining({
        id: 'u-martin',
        label: 'Мартин Илиев',
        phone: '+359 88 765 4321',
      }),
    ]);
    // Cleared: nothing to ask, nothing listed, no ring.
    component.searchClients('');
    expect(component.visitClientOptions()).toEqual([]);
    expect(component.visitClientSearching()).toBe(false);
  });

  it('asks the index nothing for a blank query — not even after the pause (F2-15)', async () => {
    const component = fixture.componentInstance as unknown as {
      searchClients: (query: string) => void;
      visitClientOptions: () => readonly unknown[];
      visitClientSearching: () => boolean;
      userSearch: {
        searchUsers: (prefix: string, limit: number) => Promise<unknown>;
      };
    };
    const asked: string[] = [];
    component.userSearch.searchUsers = async (prefix) => {
      asked.push(prefix);
      return PortResult.ok([]);
    };
    vi.useFakeTimers();
    try {
      component.searchClients('');
      component.searchClients('   ');
      expect(component.visitClientSearching()).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
    } finally {
      vi.useRealTimers();
    }
    expect(asked).toEqual([]);
    expect(component.visitClientOptions()).toEqual([]);
    expect(component.visitClientSearching()).toBe(false);
  });

  it('labels a found account by its name as written, else by its search key, and reads its contact off the account', async () => {
    const component = fixture.componentInstance as unknown as {
      searchClients: (query: string) => void;
      visitClientOptions: () => readonly {
        id: string;
        label: string;
        phone: string | null;
        phoneHref: string | null;
        meta: string | null;
        email?: string | null;
      }[];
      userSearch: {
        searchUsers: (prefix: string, limit: number) => Promise<unknown>;
      };
    };
    const written = registeredUserFixture({
      id: AccountId.of('u-martin'),
      firstName: 'Мартин',
      lastName: 'Илиев',
      phone: E164.of('+359887654321'),
      email: Email.of('martin@example.test'),
      searchName: 'мартин илиев',
    });
    // No name written — only the index's lower-cased key to go by.
    const keyed = registeredUserFixture({
      id: AccountId.of('u-keyed'),
      firstName: null,
      lastName: null,
      phone: null,
      searchName: 'мартин петров',
    });
    const asked: string[] = [];
    component.userSearch.searchUsers = async (prefix) => {
      asked.push(prefix);
      return PortResult.ok([written, keyed]);
    };
    vi.useFakeTimers();
    try {
      component.searchClients('  Мартин ');
      await vi.advanceTimersByTimeAsync(250);
    } finally {
      vi.useRealTimers();
    }
    // The index's own form: trimmed and lower-cased.
    expect(asked).toEqual(['мартин']);
    expect(component.visitClientOptions()).toEqual([
      expect.objectContaining({
        id: 'u-martin',
        label: 'Мартин Илиев',
        phone: '+359 88 765 4321',
        phoneHref: '+359887654321',
        meta: 'martin@example.test',
        email: 'martin@example.test',
      }),
      expect.objectContaining({
        id: 'u-keyed',
        label: 'мартин петров',
        phone: null,
        phoneHref: null,
        meta: null,
        email: null,
      }),
    ]);
  });

  it("builds the add-client page's one section — recent visitors from the window, never today's book", async () => {
    // The clock at noon, after the window's 10:00 visit (the page's clock
    // port — never the device's).
    TestBed.resetTestingModule();
    await build('2026-08-05T12:00:00.000+03:00');
    const component = fixture.componentInstance as unknown as {
      browseClients: () => Promise<void>;
      visitClientSections: () => readonly {
        id: string;
        clients: readonly { label: string; meta: string | null }[];
      }[];
    };
    await component.browseClients();
    const sections = component.visitClientSections();
    // «Днес» is gone (owner, 2026-09-22): a person already in today's book
    // is not one a barbershop adds to another visit.
    expect(sections.map((section) => section.id)).toEqual(['recent']);
    // The window's visit — 10:00 on 2026-08-05, behind the pinned noon — is
    // the one recent visitor.
    expect(sections[0]?.clients.map((client) => client.label)).toEqual([
      'Георги Петров',
    ]);
    expect(sections[0]?.clients[0]?.meta).toMatch(
      /^посл\. |^staff\.visit\.lastVisit/,
    );
  });

  it('lands the compact title in the bar while the add-client search is engaged', () => {
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-visit-add-client"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    const header = () =>
      host().querySelector(
        '[data-testid="staff-visit-sheet"] .ui-sheet-header',
      );
    expect(header()?.hasAttribute('data-collapsed')).toBe(false);
    const query = host().querySelector(
      '[data-testid="staff-visit-client-query"]',
    ) as HTMLInputElement;
    query.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    // The editor's word reaches the sheet's own header: the folded title
    // never scrolls under the bar, so nothing else could have said so.
    expect(header()?.hasAttribute('data-collapsed')).toBe(true);
    query.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(header()?.hasAttribute('data-collapsed')).toBe(false);
  });

  // The photo page arrived with a blank bar (wave D r3): it has no large
  // title, so nothing ever scrolled under the bar to bring the compact
  // one in, and its date (§3.7) sat at opacity 0.
  it("shows the bar's title from rest on a page with no large title of its own", () => {
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const toolbar = () =>
      host().querySelector(
        '[data-testid="staff-visit-sheet"] .modal-sheet__toolbar',
      );
    // The ladder: the bar is the only title.
    expect(toolbar()?.hasAttribute('data-title-always')).toBe(true);
    // A page with a large title: the bar waits for it to scroll under.
    (
      host().querySelector(
        '[data-testid="staff-visit-add-service"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(toolbar()?.hasAttribute('data-title-always')).toBe(false);
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as StaffVisitEditor;
    editor.pop();
    fixture.detectChanges();
    // The photo viewer: the picture is the page, the bar names it at once.
    (editor as unknown as { openPhoto(photoId: string): void }).openPhoto('p');
    fixture.detectChanges();
    expect(editor.depth()).toBe(1);
    expect(editor.pageHasNoLargeTitle()).toBe(true);
    expect(toolbar()?.hasAttribute('data-title-always')).toBe(true);
  });

  // The «Нов час» sheet never forwarded the fold (found 2026-09-24): its
  // client search folded the large title and the bar never landed the
  // compact one, so the page lost its name.
  it('lands the compact title on the new-visit sheet too, while its searches are engaged', () => {
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-add-booking"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const header = () =>
      host().querySelector(
        '[data-testid="staff-create-sheet"] .ui-sheet-header',
      );
    for (const door of ['staff-visit-add-client', 'staff-visit-add-service']) {
      (
        host().querySelector(
          `[data-testid="staff-create-sheet"] [data-testid="${door}"]`,
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      const field = host().querySelector(
        '[data-testid="staff-create-sheet"] ui-search-field input',
      ) as HTMLInputElement;
      expect(header()?.hasAttribute('data-collapsed')).toBe(false);
      field.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      expect(header()?.hasAttribute('data-collapsed')).toBe(true);
      field.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(header()?.hasAttribute('data-collapsed')).toBe(false);
      (
        host().querySelector(
          '[data-testid="staff-create-sheet"] [data-testid="staff-visit-back"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
    }
  });

  it("gives the day search the sheets' one search grammar: the head folds, the DS field is pinned, ↓ reaches the hits", async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const head = () =>
      host().querySelector('[data-testid="staff-search-headline"]');
    const header = () =>
      host().querySelector(
        '[data-testid="staff-search-sheet"] .ui-sheet-header',
      );
    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    expect(input.closest('ui-search-field[data-pinned]')).not.toBeNull();
    expect(head()?.hasAttribute('data-folded')).toBe(false);

    input.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(head()?.hasAttribute('data-folded')).toBe(true);
    expect(header()?.hasAttribute('data-collapsed')).toBe(true);

    input.value = 'георги';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    // A query standing keeps it folded, keyboard or not.
    expect(head()?.hasAttribute('data-folded')).toBe(true);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'staff-search-hit',
    );
  });

  it('hands the omnibox the book — everyone in the loaded days, as their last booking wrote them', async () => {
    const component = fixture.componentInstance as unknown as {
      browseClients: () => Promise<void>;
      visitClientBook: () => readonly {
        id: string;
        label: string;
        phone: string | null;
        meta: string | null;
      }[];
    };
    expect(component.visitClientBook()).toEqual([]);
    await component.browseClients();
    // The window's one visitor, by the contact the booking was made with —
    // searched on the keystroke, so no «last visit» line: it is never listed.
    expect(component.visitClientBook()).toEqual([
      expect.objectContaining({
        label: 'Георги Петров',
        phone: '+359 88 123 4567',
        meta: null,
      }),
    ]);
  });

  it('keeps a drag in the frame in the draft — nothing written, no toast — and «Запази» carries it', async () => {
    // The owner, 2026-09-23: the gesture's immediate write (the order
    // review's one exception) and its toast's undo moved the server while
    // the sheet's draft stayed put — the frame kept showing the dragged
    // time after «Отмени». A drag is a draft edit now, like «Начало».
    const component = fixture.componentInstance as unknown as {
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => { message: string } | null;
      notice: () => string | null;
    };
    const edits: SentEdit[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as SentEdit);
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    if (component.visitSheetRow() === null) {
      throw new Error('the sheet did not open');
    }
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: {
        id: string;
        editCommand: typeof EditCommand.Move;
        startMinute: number;
        endMinute: number;
      }) => void;
      dirty: () => boolean;
    };
    editor.onFrameCommit({
      id: 'appt-1',
      editCommand: EditCommand.Move,
      startMinute: 660,
      endMinute: 705,
    });
    fixture.detectChanges();
    expect(edits).toHaveLength(0);
    // The toast's host is always mounted; what it shows is these two.
    expect(component.undo()).toBeNull();
    expect(component.notice()).toBeNull();
    expect(editor.dirty()).toBe(true);

    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(edits).toHaveLength(1);
    // The wall clock, as the call carries it: the shop's day and 11:00.
    const move = commandOf(edits[0]?.commands ?? [], EditCommand.Move);
    expect(move?.localDate).toBe('2026-08-05');
    expect(move?.startMinutes).toBe(11 * 60);
    // The save's own receipt is the one toast a save raises.
    expect(component.undo()?.message).toBe('staff.day.undo.saved');
  });

  // The owner, 2026-09-23: "build the save receipt with whole-save undo".
  it('offers the receipt after a save, and its undo maps the visit back in one batch, then re-seeds the sheet', async () => {
    const component = fixture.componentInstance as unknown as {
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => { message: string } | null;
      runUndo: () => Promise<void>;
      visitReseedMark: () => { appointmentId: string; n: number };
      rowWaitMs: number;
    };
    // The store under test never delivers a write, so the waits on the
    // listener run to their ceiling — lowered to a tick here.
    component.rowWaitMs = 0;
    const edits: SentEdit[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as SentEdit);
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    if (component.visitSheetRow() === null) {
      throw new Error('the sheet did not open');
    }
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: {
        id: string;
        editCommand: typeof EditCommand.Move;
        startMinute: number;
        endMinute: number;
      }) => void;
      dirty: () => boolean;
    };
    editor.onFrameCommit({
      id: 'appointment-1',
      editCommand: EditCommand.Move,
      startMinute: 660,
      endMinute: 690,
    });
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(edits).toHaveLength(1);
    expect(component.undo()?.message).toBe('staff.day.undo.saved');

    await component.runUndo();
    expect(edits).toHaveLength(2);
    const back = edits[1]?.commands ?? [];
    const move = commandOf(back, EditCommand.Move);
    expect(move?.localDate).toBe('2026-08-05');
    expect(move?.startMinutes).toBe(10 * 60);
    const resize = commandOf(back, EditCommand.Resize);
    expect(resize?.resizeEdge).toBe(ResizeEdge.End);
    expect(resize?.localDate).toBe('2026-08-05');
    expect(resize?.atMinutes).toBe(10 * 60 + 30);
    expect(
      back.some(
        (entry) =>
          entry.editCommand === EditCommand.AddSeat ||
          entry.editCommand === EditCommand.RemoveSeat,
      ),
    ).toBe(false);
    expect(component.undo()).toBeNull();

    // The store under test never moved the row, so it already agrees with
    // the snapshot: the sheet on THIS visit is asked to re-seed, and the
    // drag the save carried is gone from the draft.
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 5));
    fixture.detectChanges();
    expect(component.visitReseedMark()).toEqual({
      appointmentId: 'appointment-1',
      n: 1,
    });
    expect(editor.dirty()).toBe(false);
  });

  /*
   * ── THE STALE-SCREEN GUARD, ON THE SHEET (round 5) ────────────────────
   * The sheet claims the revision its draft was drawn from; a colleague's
   * save since is refused, and the sheet reloads the visit and says so.
   */
  describe('the sheet claims the revision it was drawn from', () => {
    let visits: ReturnType<typeof observeBarberDay.getMockImplementation>;

    beforeEach(async () => {
      visits = observeBarberDay.getMockImplementation();
      const original = visits;
      if (original === undefined) throw new Error('no lanes to wrap');
      // Every visit stored at revision 3 — the claim is the counter the
      // document carries (the document IS the entity, Law 5).
      observeBarberDay.mockImplementation((barberId, dayKey) =>
        original(barberId, dayKey).pipe(
          map((result) =>
            result.ok
              ? PortResult.ok(result.value.map((visit) => storedAt(visit, 3)))
              : result,
          ),
        ),
      );
      TestBed.resetTestingModule();
      await build();
    });

    afterEach(() => {
      if (visits) observeBarberDay.mockImplementation(visits);
    });

    function openAndDrag(): {
      dirty: () => boolean;
    } {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
        .componentInstance as unknown as {
        onFrameCommit: (commit: unknown) => void;
        dirty: () => boolean;
      };
      editor.onFrameCommit({
        id: 'appointment-1',
        editCommand: EditCommand.Move,
        startMinute: 660,
        endMinute: 690,
      });
      fixture.detectChanges();
      return editor;
    }

    async function save(): Promise<void> {
      (
        host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('sends «Запази» and its undo claiming the drawn revision', async () => {
      const component = fixture.componentInstance as unknown as {
        store: { staffEdit: (request: unknown) => Promise<boolean> };
        runUndo: () => Promise<void>;
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      const claims: unknown[] = [];
      component.store.staffEdit = async (request) => {
        claims.push((request as { expectedVersion?: unknown }).expectedVersion);
        return true;
      };
      openAndDrag();
      await save();
      await component.runUndo();

      // The undo claims the snapshot's revision too; the store carries it
      // across the save it is undoing (pinned in the store's own specs).
      expect(claims).toEqual([3, 3]);
    });

    it('reloads the visit and says so in one line when somebody else saved it first', async () => {
      TestBed.inject(TranslocoService).setTranslation(
        {
          'errors.BOOKING_STAFF_EDIT_STALE':
            'Някой друг току-що промени посещението — ето го, както е сега.',
        },
        'bg',
        { merge: true },
      );
      const component = fixture.componentInstance as unknown as {
        store: {
          staffEdit: (request: unknown) => Promise<boolean>;
          errorFor: (id: string) => PipelineError | null;
        };
        notice: () => string | null;
        undo: () => unknown;
        visitReseedMark: () => { appointmentId: string; n: number };
        visitSheetRow: () => { appointmentId: string } | null;
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      let sent = 0;
      component.store.staffEdit = async () => {
        sent += 1;
        return false;
      };
      component.store.errorFor = () =>
        refusal(PipelineErrorCode.InvalidRequest, StaffEditErrorCode.Stale, {
          expected: 3,
          actual: 4,
        });
      const editor = openAndDrag();
      expect(editor.dirty()).toBe(true);

      await save();
      await new Promise((resolve) => setTimeout(resolve, 5));
      fixture.detectChanges();

      // Sent once and never again: nothing is written over the colleague.
      expect(sent).toBe(1);
      expect(component.notice()).toBe(
        'Някой друг току-що промени посещението — ето го, както е сега.',
      );
      expect(component.undo()).toBeNull();
      // The sheet stays on the visit and takes the live row as its draft.
      expect(component.visitSheetRow()?.appointmentId).toBe('appointment-1');
      expect(component.visitReseedMark()).toEqual({
        appointmentId: 'appointment-1',
        n: 1,
      });
      expect(editor.dirty()).toBe(false);
    });

    /**
     * The REAL store's wire: every staff intent the sheet sends reaches the
     * gateway here, claim and all, and is answered by `answer` — the
     * server's stamp of the next revision, unless it refuses.
     */
    function wire(
      answer: (
        request: BookingCall.StaffEdit,
      ) => PortResult<BookingCall.StaffEdited, PipelineError> = (request) =>
        PortResult.ok({
          appointmentId: request.appointmentId,
          revision: (request.expectedVersion ?? 0) + 1,
        }),
    ): BookingCall.StaffEdit[] {
      const sent: BookingCall.StaffEdit[] = [];
      gateway[Callables.StaffEditAppointment] = async (request) => {
        sent.push(request);
        return answer(request);
      };
      (
        fixture.componentInstance as unknown as { rowWaitMs: number }
      ).rowWaitMs = 0;
      return sent;
    }

    it('puts the revision the document carries on the wire (round 6)', async () => {
      const sent = wire();
      openAndDrag();
      await save();

      // Stored at 3, read as the document body, claimed as 3 — through the
      // real store, as the callable receives it.
      expect(sent.map((request) => request.expectedVersion)).toEqual([3]);
    });

    it('claims 0 for a row written before staff editing — the counter the server reads it at', async () => {
      observeBarberDay.mockImplementation((barberId, dayKey) => {
        if (visits === undefined) throw new Error('no lanes to wrap');
        return visits(barberId, dayKey).pipe(
          map((result) =>
            result.ok
              ? PortResult.ok(
                  result.value.map((visit) => storedAt(visit, null)),
                )
              : result,
          ),
        );
      });
      TestBed.resetTestingModule();
      await build();
      const sent = wire();
      openAndDrag();
      await save();

      // Not `null` — a claim of nothing, which the server never refuses.
      expect(sent.map((request) => request.expectedVersion)).toEqual([0]);
    });

    it('is refused by the server when a colleague saved since, and reloads the visit', async () => {
      TestBed.inject(TranslocoService).setTranslation(
        {
          'errors.BOOKING_STAFF_EDIT_STALE':
            'Някой друг току-що промени посещението — ето го, както е сега.',
        },
        'bg',
        { merge: true },
      );
      // The server's own answer to a claim of 3 on a visit now at 4.
      const sent = wire((request) =>
        request.expectedVersion === 3
          ? PortResult.err(
              refusal(
                PipelineErrorCode.InvalidRequest,
                StaffEditErrorCode.Stale,
                { expected: 3, actual: 4 },
              ),
            )
          : PortResult.ok({
              appointmentId: request.appointmentId,
              revision: 99,
            }),
      );
      const component = fixture.componentInstance as unknown as {
        notice: () => string | null;
        undo: () => unknown;
        visitReseedMark: () => { appointmentId: string; n: number };
      };
      const editor = openAndDrag();
      await save();
      await new Promise((resolve) => setTimeout(resolve, 5));
      fixture.detectChanges();

      // Claimed 3, refused, sent once: the older sheet wrote nothing.
      expect(sent.map((request) => request.expectedVersion)).toEqual([3]);
      expect(component.notice()).toBe(
        'Някой друг току-що промени посещението — ето го, както е сега.',
      );
      expect(component.undo()).toBeNull();
      expect(component.visitReseedMark()).toEqual({
        appointmentId: 'appointment-1',
        n: 1,
      });
      expect(editor.dirty()).toBe(false);
    });

    it('does not reload on any other refusal — the draft is the barber’s to fix', async () => {
      const component = fixture.componentInstance as unknown as {
        store: {
          staffEdit: (request: unknown) => Promise<boolean>;
          errorFor: (id: string) => PipelineError | null;
        };
        visitReseedMark: () => { appointmentId: string; n: number };
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      component.store.staffEdit = async () => false;
      component.store.errorFor = () =>
        refusal(PipelineErrorCode.SlotUnavailable, StaffEditErrorCode.Overlaps);
      const editor = openAndDrag();
      await save();
      await new Promise((resolve) => setTimeout(resolve, 5));
      fixture.detectChanges();

      expect(component.visitReseedMark().n).toBe(0);
      expect(editor.dirty()).toBe(true);
    });
  });

  /*
   * ── THE NOTE AND THE TIP BESIDE THE BATCH (round 5, found in review) ──
   * Each is written in a document of its own and neither moves the visit's
   * revision, so the batch's claim cannot guard them. The batch goes first
   * and alone decides; a field the barber did not touch is never written;
   * and one a colleague changed under a field the barber did touch refuses
   * the save before anything goes out.
   */
  describe('the note and the tip beside the batch', () => {
    const lane$ = new BehaviorSubject<readonly Appointment[]>([]);
    const note$ = new BehaviorSubject<string | null>(null);
    let visits: ReturnType<typeof observeBarberDay.getMockImplementation>;
    let stored: Appointment;

    /** The visit with Ivan's seat tipped `minor` — a stamp, same revision. */
    function tipped(visit: Appointment, minor: number | null): Appointment {
      const tip = minor === null ? null : unwrapOk(PriceCents.of(minor));
      return {
        ...visit,
        seats: visit.seats.map((seat) =>
          seat.barberId === 'ivan' ? Seat.withTip(seat, tip) : seat,
        ),
      };
    }

    beforeEach(async () => {
      visits = observeBarberDay.getMockImplementation();
      stored = readAt(
        appointment(
          'appointment-1',
          '2026-08-05T10:00:00',
          { name: 'Мартин Илиев', phone: '+359881234567' },
          'ivan',
          true,
        ),
        3,
      );
      lane$.next([stored]);
      note$.next(null);
      observeBarberDay.mockImplementation((barberId) =>
        barberId === 'ivan'
          ? lane$.pipe(map((list) => PortResult.ok(list)))
          : of(PortResult.ok([])),
      );
      TestBed.resetTestingModule();
      await build();
      // The team note, live, as the notes collection would deliver it.
      const notes = TestBed.inject(APPOINTMENT_NOTE_PORTS) as {
        observeAppointmentNote: AppointmentNotePorts['observeAppointmentNote'];
      };
      notes.observeAppointmentNote = (appointmentId) =>
        note$.pipe(
          map((text) =>
            PortResult.ok<AppointmentNote | null>(
              text === null
                ? null
                : {
                    id: appointmentId,
                    text,
                    authorUserId: null,
                    writtenAtUtcMs: wall('2026-08-05T08:00:00').utcEpochMs,
                  },
            ),
          ),
        );
      TestBed.inject(TranslocoService).setTranslation(
        {
          'errors.BOOKING_STAFF_EDIT_STALE':
            'Някой друг току-що промени посещението — ето го, както е сега.',
        },
        'bg',
        { merge: true },
      );
    });

    afterEach(() => {
      if (visits) observeBarberDay.mockImplementation(visits);
    });

    interface EditorHandle {
      onFrameCommit: (commit: unknown) => void;
      setTip: (minor: number | null) => void;
      commitNote: (value: string) => void;
      removeLeg: (seatId: string) => void;
      dirty: () => boolean;
    }

    /** Every write the sheet makes, in the order it makes them. */
    function harness() {
      const component = fixture.componentInstance as unknown as {
        store: {
          staffEdit: (request: unknown) => Promise<boolean>;
          saveTeamNote: (id: string, text: string | null) => Promise<boolean>;
          recordTip: (request: {
            seatId: string;
            amountCents: number | null;
          }) => Promise<boolean>;
          errorFor: (id: string) => PipelineError | null;
        };
        notice: () => string | null;
        undo: () => unknown;
        runUndo: () => Promise<void>;
        visitReseedMark: () => { appointmentId: string; n: number };
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      const sent: string[] = [];
      const tips: { seatId: string; amountCents: number | null }[] = [];
      const notes: (string | null)[] = [];
      component.store.staffEdit = async () => {
        sent.push('batch');
        return true;
      };
      component.store.saveTeamNote = async (_id, text) => {
        sent.push('note');
        notes.push(text);
        return true;
      };
      component.store.recordTip = async (request) => {
        sent.push('tip');
        tips.push(request);
        return true;
      };
      return { component, sent, tips, notes };
    }

    function open(): EditorHandle {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      return fixture.debugElement.query(By.directive(StaffVisitEditor))
        .componentInstance as unknown as EditorHandle;
    }

    function drag(editor: EditorHandle): void {
      editor.onFrameCommit({
        id: 'appointment-1',
        editCommand: EditCommand.Move,
        startMinute: 660,
        endMinute: 690,
      });
      fixture.detectChanges();
    }

    async function save(): Promise<void> {
      (
        host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    async function settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      fixture.detectChanges();
    }

    it('sends the batch first, and the note and the tip only once it landed', async () => {
      const { sent, notes, tips } = harness();
      const editor = open();
      editor.setTip(200);
      editor.commitNote('дължи 5 €');
      drag(editor);
      await save();

      expect(sent).toEqual(['batch', 'note', 'tip']);
      expect(notes).toEqual(['дължи 5 €']);
      expect(tips.map((tip) => tip.amountCents)).toEqual([200]);
    });

    it('writes neither the note nor the tip when the batch is refused as stale', async () => {
      const { component, sent } = harness();
      component.store.staffEdit = async () => {
        sent.push('batch');
        return false;
      };
      component.store.errorFor = () =>
        refusal(PipelineErrorCode.InvalidRequest, StaffEditErrorCode.Stale, {
          expected: 3,
          actual: 4,
        });
      const editor = open();
      editor.setTip(200);
      editor.commitNote('дължи 5 €');
      drag(editor);
      await save();
      await settle();

      // The old screen's note and tip never land over the colleague's.
      expect(sent).toEqual(['batch']);
      expect(component.visitReseedMark()).toEqual({
        appointmentId: 'appointment-1',
        n: 1,
      });
    });

    it('keeps a colleague’s tip recorded after the sheet opened when the barber saves a drag', async () => {
      const { sent, tips } = harness();
      const editor = open();
      // A colleague settles up under the open sheet: 3,00 €, no revision.
      lane$.next([tipped(stored, 300)]);
      fixture.detectChanges();
      expect(editor.dirty()).toBe(false);

      drag(editor);
      await save();

      expect(sent).toEqual(['batch']);
      expect(tips).toEqual([]);
    });

    it('refuses a tip typed over one a colleague recorded since — nothing sent, and the sheet shows theirs', async () => {
      const { component, sent } = harness();
      const editor = open();
      editor.setTip(200);
      fixture.detectChanges();
      lane$.next([tipped(stored, 300)]);
      fixture.detectChanges();
      drag(editor);
      await save();
      await settle();

      expect(sent).toEqual([]);
      expect(component.notice()).toBe(
        'Някой друг току-що промени посещението — ето го, както е сега.',
      );
      expect(component.undo()).toBeNull();
      expect(component.visitReseedMark()).toEqual({
        appointmentId: 'appointment-1',
        n: 1,
      });
      expect(editor.dirty()).toBe(false);
      expect(
        host()
          .querySelector('[data-testid="staff-visit-tip-value"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      ).toBe('3,00 €');
    });

    it('refuses a note typed over one a colleague wrote since', async () => {
      const { component, sent } = harness();
      const editor = open();
      editor.commitNote('дължи 5 €');
      fixture.detectChanges();
      note$.next('не обича да говори');
      fixture.detectChanges();
      await save();
      await settle();

      expect(sent).toEqual([]);
      expect(component.visitReseedMark().n).toBe(1);
      expect(editor.dirty()).toBe(false);
    });

    it('does not undo a tip over one a colleague recorded after the save', async () => {
      const { component, sent, tips } = harness();
      const editor = open();
      editor.setTip(200);
      fixture.detectChanges();
      await save();
      // The chair-wide move and resize always ride along (no-ops here).
      expect(sent).toEqual(['batch', 'tip']);

      // The save lands, and a colleague records 3,00 € over it.
      lane$.next([tipped(stored, 300)]);
      fixture.detectChanges();
      await component.runUndo();
      await settle();

      // The way back is refused before anything goes out.
      expect(sent).toEqual(['batch', 'tip']);
      expect(tips.map((tip) => tip.amountCents)).toEqual([200]);
      expect(component.undo()).toBeNull();
      expect(component.visitReseedMark().n).toBe(1);
    });

    it('stamps the tip on a seat the batch KEPT, never on one it removed', async () => {
      const booker = freshId('user');
      const seatOf = (startsAt: string) =>
        seatAt({
          chair: 'ivan',
          startsAt,
          occupant: accountOf(booker, SubjectRelationship.Self),
        });
      const first = seatOf('2026-08-05T10:00:00');
      const second = seatOf('2026-08-05T10:30:00');
      lane$.next([readAt(visitOf('appointment-1', [first, second]), 3)]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const { sent, tips } = harness();
      const editor = open();
      editor.removeLeg(first.seatId);
      editor.setTip(200);
      fixture.detectChanges();
      await save();

      expect(sent).toEqual(['batch', 'tip']);
      expect(tips).toEqual([
        expect.objectContaining({
          seatId: second.seatId,
          amountCents: 200,
        }),
      ]);
    });
  });

  // A REFUSAL WITH NOTHING ON FILE: the toast falls to `refuse()`'s own
  // default key — the one surface that translates a KEY directly rather
  // than an `errorCode`, so the key itself (the loader is empty) is the
  // assertion.
  it('toasts the surface’s own words when a save is refused with no refusal on file', async () => {
    const component = fixture.componentInstance as unknown as {
      store: {
        staffEdit: (request: unknown) => Promise<boolean>;
        errorFor: (id: string) => PipelineError | null;
      };
      undo: () => unknown;
      notice: () => string | null;
      rowWaitMs: number;
    };
    component.rowWaitMs = 0;
    let sent = 0;
    component.store.staffEdit = async () => {
      sent += 1;
      return false;
    };
    component.store.errorFor = () => null;
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: unknown) => void;
    };
    editor.onFrameCommit({
      id: 'appointment-1',
      editCommand: EditCommand.Move,
      startMinute: 660,
      endMinute: 690,
    });
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sent).toBe(1);
    expect(component.undo()).toBeNull();
    expect(component.notice()).toBe('errors.BOOKING_CALL_FAILED');
  });

  it('says a refused undo left the save standing, and offers nothing to try again', async () => {
    const component = fixture.componentInstance as unknown as {
      store: {
        staffEdit: (request: unknown) => Promise<boolean>;
        errorFor: (id: string) => unknown;
      };
      undo: () => { message: string } | null;
      notice: () => string | null;
      runUndo: () => Promise<void>;
      rowWaitMs: number;
    };
    component.rowWaitMs = 0;
    let sent = 0;
    component.store.staffEdit = async () => {
      sent += 1;
      return sent < 2;
    };
    component.store.errorFor = () => null;
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: unknown) => void;
    };
    editor.onFrameCommit({
      id: 'appointment-1',
      editCommand: EditCommand.Move,
      startMinute: 660,
      endMinute: 690,
    });
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.undo()?.message).toBe('staff.day.undo.saved');

    await component.runUndo();
    expect(sent).toBe(2);
    expect(component.undo()).toBeNull();
    expect(component.notice()).toBe('staff.day.undo.refused');
  });

  it('hands the save plan its row AS IS — a row is the plan’s row facts (pass D D-10.1, type-level)', () => {
    // Zero inbound mapping (Law 3): `StaffEditPlanSystem.commandsFor` and
    // `tipSeat` take the row the sheet was opened on, unmapped.
    expectTypeOf<DayRowVm>().toExtend<StaffEditRowFacts>();
  });

  it('pins every surviving leg to its ladder slot before the chair-wide move, and restaffs a moved chair back', () => {
    const component = fixture.componentInstance as unknown as {
      visitSheetRow: () =>
        | (Record<string, unknown> & {
            id: string;
            startMinute: number;
            endMinute: number;
            legs: readonly VisitEditorLeg[];
          })
        | null;
      visitEditorVm: () => VisitEditorVm | null;
      commandsFor: (
        target: VisitEditorCommit,
        row: unknown,
      ) => PortResult<readonly BookingCall.EditCommand[], PipelineError>;
      rowFor: (
        rowId: string,
        seatIds?: readonly string[],
      ) => { id: string } | null;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    const vm = component.visitEditorVm();
    if (row === null || vm === null) throw new Error('the sheet did not open');
    const before = snapshotCommitOf(vm);
    const cut = before.legs[0];
    if (cut === undefined) throw new Error('the fixture row has no leg');

    // The snapshot held two legs; the save dropped the second and dragged
    // the block an hour on. The way back re-adds the beard at its slot and
    // PINS the cut to the ladder's start before the chair-wide move, so one
    // delta cannot swap them.
    const twoLegs: VisitEditorCommit = {
      ...before,
      endMinute: trackMinute(before.startMinute + cut.minutes + 20),
      legs: [
        ...before.legs,
        {
          seatId: SeatId.of('seat-beard'),
          serviceId: ServiceId.of('beard'),
          variantId: null,
          minutes: duration(20),
          priceCents: cents(1000),
          currency: Currency.EUR,
          typedPriceCents: null,
          barberId: cut.barberId,
          clientId: cut.clientId,
        },
      ],
    };
    const hour = 60;
    const later = {
      ...row,
      startMinute: row.startMinute + hour,
      endMinute: row.endMinute + hour,
    };
    const back = unwrapOk(component.commandsFor(twoLegs, later));
    const moves = back.filter(
      (entry): entry is BookingCall.EditCommand.Move =>
        entry.editCommand === EditCommand.Move,
    );
    const pin = moves.find((entry) => entry.seatIds?.length === 1);
    // On the shop's wall clock: the visit's day, 10:00.
    expect(pin).toEqual({
      editCommand: EditCommand.Move,
      localDate: '2026-08-05',
      startMinutes: 10 * 60,
      seatIds: [cut.seatId],
    });
    const wide = moves.find((entry) => entry !== pin);
    expect(back.indexOf(pin as (typeof back)[number])).toBeLessThan(
      back.indexOf(wide as (typeof back)[number]),
    );
    const readd = commandOf(back, EditCommand.AddSeat);
    expect(readd?.localDate).toBe('2026-08-05');
    expect(readd?.startMinutes).toBe(10 * 60 + 30);
    // A chair's share names the seats the batch LEAVES — never a removed one.
    expect(wide?.seatIds).toEqual([cut.seatId, 'seat-beard']);

    // The save restaffed the chair: the row now lives on another lane under
    // another name, and is found by its seat. The way back restaffs it.
    const onStefan: VisitEditorCommit = {
      ...before,
      legs: before.legs.map((leg) => ({
        ...leg,
        barberId: BarberId.of('stefan'),
      })),
    };
    expect(component.rowFor('appointment-1#stefan')).toBeNull();
    expect(component.rowFor('appointment-1#stefan', [cut.seatId])?.id).toBe(
      'appointment-1#ivan',
    );
    expect(unwrapOk(component.commandsFor(onStefan, row))).toContainEqual({
      editCommand: EditCommand.Restaff,
      seatId: cut.seatId,
      barberId: 'stefan',
    });
  });

  it('withholds the way back only from a save that added a seat to a finished visit', () => {
    const added = [
      { editCommand: EditCommand.AddSeat },
    ] as unknown as Parameters<typeof reversibleSave>[1];
    const moved = [{ editCommand: EditCommand.Move }] as unknown as Parameters<
      typeof reversibleSave
    >[1];
    expect(
      reversibleSave({ bookingStatus: BookingStatus.Completed }, added),
    ).toBe(false);
    expect(
      reversibleSave({ bookingStatus: BookingStatus.Completed }, moved),
    ).toBe(true);
    expect(
      reversibleSave({ bookingStatus: BookingStatus.Confirmed }, added),
    ).toBe(true);
    expect(reversibleSave(null, added)).toBe(true);
    // A save that removed a seat keeps its «Отмени» — one half of a pair
    // the visit already held included: the server remembers the pairs a
    // save broke and lets its undo put them back (round 6, the BA call:
    // «Отмени» restores exactly what the save changed; pinned in
    // staff-edit-appointment.undo.spec.ts).
    const removed = [
      BookingCall.editRemoveSeat(SeatId.of('seat-2')),
    ] as Parameters<typeof reversibleSave>[1];
    expect(
      reversibleSave({ bookingStatus: BookingStatus.Confirmed }, removed),
    ).toBe(true);
  });

  it("undoes a save by the save's own arithmetic: the added seat goes, the removed one returns with its terms, the block and the bill go back", () => {
    const component = fixture.componentInstance as unknown as {
      visitSheetRow: () => (DayRowShape & Record<string, unknown>) | null;
      visitEditorVm: () => VisitEditorVm | null;
      commandsFor: (
        target: VisitEditorCommit,
        row: unknown,
      ) => PortResult<readonly BookingCall.EditCommand[], PipelineError>;
    };
    type DayRowShape = {
      startMinute: number;
      endMinute: number;
      legs: readonly VisitEditorLeg[];
      discounts: readonly unknown[];
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    const vm = component.visitEditorVm();
    if (row === null || vm === null) throw new Error('the sheet did not open');
    const before = snapshotCommitOf(vm);
    const cut = row.legs[0];
    if (cut === undefined) throw new Error('the fixture row has no leg');

    // The visit as a save left it: an hour later, the cut gone, a beard in
    // its place, a code on the bill.
    const hour = 60;
    const after = {
      ...row,
      startMinute: row.startMinute + hour,
      endMinute: row.endMinute + hour,
      legs: [
        {
          seatId: 'seat-beard',
          serviceId: 'beard',
          variantId: null,
          serviceLabel: 'Брада',
          minutes: 20,
          priceLabel: '10,00 €',
          barberId: cut.barberId,
          barberName: cut.barberName,
          barberTone: cut.barberTone,
          overridden: false,
        },
      ],
      discounts: [
        {
          discountSource: DiscountSource.Code,
          label: 'FIRST10',
          value: { discountMethod: DiscountMethod.PercentOff, percent: 10 },
          grantId: null,
          code: 'FIRST10',
          exclusive: false,
        },
      ],
    };

    const back = unwrapOk(component.commandsFor(before, after));
    const kinds = back.map((entry) => entry.editCommand);
    expect(kinds).toContain(EditCommand.RemoveSeat);
    expect(commandOf(back, EditCommand.RemoveSeat)).toEqual({
      editCommand: EditCommand.RemoveSeat,
      seatId: 'seat-beard',
    });
    const readd = commandOf(back, EditCommand.AddSeat);
    expect(readd).toEqual(
      expect.objectContaining({
        seatId: cut.seatId,
        serviceId: cut.serviceId,
        barberId: cut.barberId,
        durationMinutes: cut.minutes,
        addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
      }),
    );
    // On the shop's wall clock: the visit's day, 10:00.
    expect(readd?.localDate).toBe('2026-08-05');
    expect(readd?.startMinutes).toBe(10 * 60);
    // Its stored price rides along, for a server that honours it.
    expect(back).toContainEqual({
      editCommand: EditCommand.Reprice,
      seatId: cut.seatId,
      priceCents: 2800,
    });
    const move = commandOf(back, EditCommand.Move);
    expect(move?.startMinutes).toBe(10 * 60);
    // The bill's arm is sent EXPLICITLY, empty: omitting it would keep the
    // code the save applied.
    expect(back).toContainEqual({
      editCommand: EditCommand.Discounts,
      discounts: [],
    });
    // In the server's order: seats before the move, the bill last.
    expect(kinds.indexOf(EditCommand.RemoveSeat)).toBeLessThan(
      kinds.indexOf(EditCommand.Move),
    );
    expect(kinds.indexOf(EditCommand.AddSeat)).toBeLessThan(
      kinds.indexOf(EditCommand.Move),
    );
    expect(kinds.at(-1)).toBe(EditCommand.Discounts);
  });

  it('asks before a ✕ drops unsaved edits, and closes at once when the draft is clean', () => {
    const component = fixture.componentInstance as unknown as {
      dismissVisitSheet: () => void;
      confirmDiscard: () => void;
      discardPending: () => string | null;
      visitSheetRow: () => unknown;
    };
    const openRow = () => {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
    };
    openRow();
    expect(component.visitSheetRow()).not.toBeNull();
    component.dismissVisitSheet();
    fixture.detectChanges();
    expect(component.visitSheetRow()).toBeNull();
    expect(component.discardPending()).toBeNull();

    openRow();
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      stepDay: (offset: number) => void;
      dirty: () => boolean;
    };
    editor.stepDay(1);
    fixture.detectChanges();
    expect(editor.dirty()).toBe(true);
    component.dismissVisitSheet();
    fixture.detectChanges();
    expect(component.discardPending()).toBe(DiscardTarget.Visit);
    expect(component.visitSheetRow()).not.toBeNull();
    const sheet = host().querySelector('[data-testid="staff-discard-sheet"]');
    expect(sheet).not.toBeNull();
    (
      sheet?.querySelector('[data-testid="staff-discard-keep"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(component.discardPending()).toBeNull();
    expect(component.visitSheetRow()).not.toBeNull();
    component.dismissVisitSheet();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-discard-confirm"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(component.discardPending()).toBeNull();
    expect(component.visitSheetRow()).toBeNull();
  });

  it("«Запиши пак» keeps the finished visit's own hour and span", () => {
    const component = fixture.componentInstance as unknown as {
      rebookFromEditor: (vm: unknown) => void;
      visitEditorVm: () => Record<string, unknown> | null;
      createVisit: () => { startMinute: number; minutes?: number } | null;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const vm = component.visitEditorVm();
    if (vm === null) throw new Error('the sheet did not open');
    component.rebookFromEditor({ ...vm, startMinute: 615, endMinute: 660 });
    fixture.detectChanges();
    expect(component.createVisit()?.startMinute).toBe(615);
    expect(component.createVisit()?.minutes).toBe(45);
  });

  describe('«Запиши пак» and the rebooking edge (defect §2.3 #6)', () => {
    type RebookHarness = {
      openCreate: (createIntent: CreateIntent) => void;
      rebookFromEditor: (vm: unknown) => void;
      createFromEditor: (commit: unknown) => Promise<void>;
      visitEditorVm: () => {
        clientUserId: string | null;
        clientLabel: string;
      } | null;
    };

    /** One cut for `clientId`, saved from the create sheet. */
    const saveFor = (clientId: string, label: string) => ({
      dayKey: '2026-09-02',
      startMinute: 600,
      endMinute: 630,
      note: null,
      clients: [{ id: clientId, label, phone: '+359881234567' }],
      legs: [
        {
          seatId: 'draft-cut',
          serviceId: 'cut',
          variantId: null,
          minutes: 30,
          priceLabel: null,
          barberId: 'ivan',
          clientId,
        },
      ],
    });

    function capture(): BookingCall[] {
      const requests: BookingCall[] = [];
      gateway[Callables.CommitBooking] = async (request) => {
        requests.push(request);
        return PortResult.ok({
          appointmentId: AppointmentId.of('apt-rebooked'),
        });
      };
      return requests;
    }

    function rebookTheFinishedVisit(component: RebookHarness): {
      clientUserId: string;
      clientLabel: string;
    } {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      const vm = component.visitEditorVm();
      if (vm?.clientUserId == null) throw new Error('no client on the visit');
      component.rebookFromEditor(vm);
      fixture.detectChanges();
      return { clientUserId: vm.clientUserId, clientLabel: vm.clientLabel };
    }

    it('books the new visit FROM the finished one, for the same client', async () => {
      const requests = capture();
      const component = fixture.componentInstance as unknown as RebookHarness;
      const { clientUserId, clientLabel } = rebookTheFinishedVisit(component);

      await component.createFromEditor(saveFor(clientUserId, clientLabel));

      expect(requests).toHaveLength(1);
      expect(requests[0]?.onBehalfOfUserId).toBe(clientUserId);
      expect(requests[0]?.placement).toBe(Placement.Staff);
      expect(requests[0]?.bookedFromAppointmentId).toBe('appointment-1');
    });

    it('sends no edge once the desk swaps the person, nor from a cold create', async () => {
      const requests = capture();
      const component = fixture.componentInstance as unknown as RebookHarness;
      rebookTheFinishedVisit(component);

      // Somebody else in the chair: their first booking, not a return.
      await component.createFromEditor(saveFor('user-someone-else', 'Петър'));

      component.openCreate(CreateIntent.Booking);
      fixture.detectChanges();
      await component.createFromEditor(saveFor('user-martin', 'Мартин'));

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.bookedFromAppointmentId).toBeNull();
      }
    });
  });

  it('sends the other shop as a relocate that LEADS the batch, and nothing when the shop is the same', async () => {
    const component = fixture.componentInstance as unknown as {
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => {
        appointmentId: string;
        locationId: string;
        legs: readonly {
          seatId: string;
          minutes: number;
          barberId: string;
          priceCents: number | null;
          currency: string;
        }[];
      } | null;
    };
    const edits: SentEdit[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as SentEdit);
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const [leg] = row.legs;
    if (leg === undefined) throw new Error('no seat on the row');
    // The row knows its shop — the appointment's own.
    expect(row.locationId.length).toBeGreaterThan(0);
    const save = (locationId: string) => ({
      revision: null,
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      locationId,
      note: null,
      discounts: [],
      vouchers: [],
      tipCents: null,
      drawn: null,
      clients: [],
      legs: [
        {
          seatId: leg.seatId,
          serviceId: 'cut',
          variantId: null,
          minutes: leg.minutes,
          priceCents: leg.priceCents,
          currency: leg.currency,
          typedPriceCents: null,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
      ],
    });
    await component.commitFromEditor(row.appointmentId, save('loc-mladost'));
    expect(edits).toHaveLength(1);
    expect(edits[0]?.commands[0]).toEqual({
      editCommand: EditCommand.Relocate,
      locationId: 'loc-mladost',
    });
    // The same shop: no relocate at all.
    await component.commitFromEditor(row.appointmentId, save(row.locationId));
    expect(edits).toHaveLength(2);
    expect(
      edits[1]?.commands.some(
        (command) => command.editCommand === EditCommand.Relocate,
      ),
    ).toBe(false);
  });

  it('lets the front desk and the owners reprice a seat, and sends it as a reprice on save', async () => {
    // Owner, 2026-09-10: the price is edited on the ladder for whoever may;
    // the save carries it as the seat's new terms. A plain barber gets no
    // pill: he may stretch his own time, not discount the shop's money.
    const component = fixture.componentInstance as unknown as {
      mayReprice: () => boolean;
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => {
        appointmentId: string;
        legs: readonly {
          seatId: string;
          minutes: number;
          barberId: string;
          priceLabel: string | null;
        }[];
      } | null;
    };
    expect(component.mayReprice()).toBe(true);

    const edits: SentEdit[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as SentEdit);
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const [leg] = row.legs;
    if (leg === undefined) throw new Error('no seat on the row');
    await component.commitFromEditor(row.appointmentId, {
      revision: null,
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      locationId: null,
      note: null,
      discounts: [],
      vouchers: [],
      tipCents: null,
      drawn: null,
      clients: [],
      legs: [
        {
          seatId: leg.seatId,
          serviceId: 'cut',
          variantId: null,
          minutes: leg.minutes,
          priceCents: 1800,
          currency: Currency.EUR,
          typedPriceCents: 1800,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
        // A seat minted in the draft, priced by hand: its reprice follows
        // its addSeat in the same batch (owner, 2026-09-10).
        {
          seatId: 'draft-wash-1',
          serviceId: 'wash',
          variantId: null,
          minutes: 10,
          priceCents: 900,
          currency: Currency.EUR,
          typedPriceCents: 900,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
      ],
    });
    const commands = edits.flatMap((edit) => edit.commands);
    expect(commands).toContainEqual({
      editCommand: EditCommand.Reprice,
      seatId: leg.seatId,
      priceCents: 1800,
    });
    const seatOf = (command: BookingCall.EditCommand) =>
      (command as { seatId?: string }).seatId;
    const added = commands.findIndex(
      (command) =>
        command.editCommand === EditCommand.AddSeat &&
        seatOf(command) === 'draft-wash-1',
    );
    const repriced = commands.findIndex(
      (command) =>
        command.editCommand === EditCommand.Reprice &&
        seatOf(command) === 'draft-wash-1',
    );
    expect(added).toBeGreaterThanOrEqual(0);
    expect(repriced).toBeGreaterThan(added);
    expect(commands[repriced]).toMatchObject({ priceCents: 900 });

    // A plain barber: the gate shuts.
    principal$.next(
      principalFixture.staff(AccountId.of('dev-staff-ivan'), [Role.Barber]),
    );
    expect(component.mayReprice()).toBe(false);
    principal$.next(
      principalFixture.staff(AccountId.of('dev-staff-ivan'), [
        Role.Barber,
        Role.Admin,
      ]),
    );
  });

  it('opens ONE kind of new visit from the ＋, starting at the next tick', () => {
    // «Бърз час» is gone (owner, 2026-09-09): a walk-in is a kind of client,
    // chosen in the sheet, and someone at the counter may want tomorrow.
    const component = fixture.componentInstance as unknown as {
      openCreate: (createIntent: CreateIntent) => void;
      createVm: () => { clientLabel: string; startMinute: number } | null;
    };
    expect(
      host().querySelector('[data-testid="staff-add-walk-in"]'),
    ).toBeNull();
    component.openCreate(CreateIntent.Booking);
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-create-sheet"]'),
    ).not.toBeNull();
    expect(component.createVm()?.clientLabel).toBe('');
    expect((component.createVm()?.startMinute ?? 0) % 5).toBe(0);
  });

  it('opens a new visit late in the evening without throwing — its frame starts at 24:00 until it is moved', async () => {
    // At 23:57 the next tick is the closing midnight (24:00 on the track):
    // the seed measured its span on the shop's clock and threw on it, so the
    // ＋ crashed the page from 23:31 on (the default half hour ran past 24:00).
    TestBed.resetTestingModule();
    await build('2026-08-05T23:57:00.000+03:00');
    const component = fixture.componentInstance as unknown as {
      openCreate: (createIntent: CreateIntent) => void;
      createVm: () => { startMinute: number; endMinute: number } | null;
    };
    expect(() => {
      component.openCreate(CreateIntent.Booking);
      fixture.detectChanges();
    }).not.toThrow();
    expect(
      host().querySelector('[data-testid="staff-create-sheet"]'),
    ).not.toBeNull();
    expect(component.createVm()?.startMinute).toBe(1440);
    expect(component.createVm()?.endMinute).toBe(1470);
  });

  it('places a party as one booking: the account holder owns it, the rest ride as guests', async () => {
    // THE PARTY GRAMMAR. Every leg names its person. The first client WITH
    // an account is the appointment's owner (`self` seats, `onBehalfOfUserId`);
    // a walk-in placeholder or a minted guest rides as a `guest` seat under
    // their own name — the domain's one-owner shape, not a shortcut here.
    const requests: BookingCall[] = [];
    gateway[Callables.CommitBooking] = async (request) => {
      requests.push(request);
      return PortResult.ok({ appointmentId: AppointmentId.of('apt-party') });
    };
    const component = fixture.componentInstance as unknown as {
      openCreate: (createIntent: CreateIntent) => void;
      createFromEditor: (commit: unknown) => Promise<void>;
      createVisit: () => unknown;
    };
    component.openCreate(CreateIntent.Booking);
    fixture.detectChanges();
    await component.createFromEditor({
      dayKey: '2026-09-03',
      startMinute: 600,
      endMinute: 645,
      note: null,
      clients: [
        { id: 'primary', label: 'Без запазен час', phone: null },
        { id: 'user-martin', label: 'Мартин Илиев', phone: '+359881234567' },
      ],
      legs: [
        {
          seatId: 'draft-cut',
          serviceId: 'cut',
          variantId: null,
          minutes: 30,
          priceLabel: null,
          barberId: 'ivan',
          clientId: 'primary',
        },
        {
          seatId: 'draft-beard',
          serviceId: 'beard',
          variantId: null,
          minutes: 15,
          priceLabel: null,
          barberId: 'ivan',
          clientId: 'user-martin',
        },
      ],
    });
    const request = requests[0];
    expect(request?.onBehalfOfUserId).toBe('user-martin');
    expect(request?.seats.map((seat) => seat.subject)).toEqual([
      {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Без запазен час',
        guestKey: null,
      },
      { requestedSubjectRole: RequestedSubjectRole.Self },
    ]);
    // The contact is the owner's, not the walk-in's.
    expect(request?.contact?.name).toBe('Мартин Илиев');
    // ONE shop day, and serial from the chosen minute, in ladder order.
    expect(request?.localDate).toBe('2026-09-03');
    const at = request?.seats.map((seat) => seat.startMinutes) ?? [];
    // `NaN` if either seat is missing — which fails the assertion, as it should.
    expect((at[1] ?? NaN) - (at[0] ?? NaN)).toBe(30);
    expect(component.createVisit()).toBeNull();
  });

  // Round 3 (2026-09-25): every unnamed person fell back to the one
  // «Случаен клиент», so two strangers on one visit shared a label — and the
  // client prefill and the server's party check read them as one person.
  it('names each stranger on one visit apart — the second is numbered, one person once', async () => {
    const requests: BookingCall[] = [];
    gateway[Callables.CommitBooking] = async (request) => {
      requests.push(request);
      return PortResult.ok({
        appointmentId: AppointmentId.of('apt-strangers'),
      });
    };
    const component = fixture.componentInstance as unknown as {
      openCreate: (createIntent: CreateIntent) => void;
      createFromEditor: (commit: unknown) => Promise<void>;
    };
    component.openCreate(CreateIntent.Booking);
    fixture.detectChanges();
    const leg = (seatId: string, clientId: string) => ({
      seatId,
      serviceId: 'cut',
      variantId: null,
      minutes: 30,
      priceLabel: null,
      barberId: 'ivan',
      clientId,
    });
    await component.createFromEditor({
      dayKey: '2026-09-03',
      startMinute: 600,
      endMinute: 690,
      note: null,
      clients: [],
      legs: [
        leg('draft-a', 'primary'),
        leg('draft-b', 'guest-second'),
        leg('draft-c', 'primary'),
      ],
    });
    // The test catalogue answers with keys: the first stranger keeps the
    // plain word, the second is the numbered one, and the first's two
    // services stay one person's.
    const guest = (label: string) => ({
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label,
      guestKey: null,
    });
    expect(requests[0]?.seats.map((seat) => seat.subject)).toEqual([
      guest('staff.visit.walkIn'),
      guest('staff.visit.walkInNumbered'),
      guest('staff.visit.walkIn'),
    ]);
  });

  // Round 4 (2026-09-25): the server tells guests apart per APPOINTMENT
  // (`personKey`), across chairs, while the edit path numbered a new
  // stranger past THIS chair's people only. On a party split across two
  // chairs, the stranger took the label the other chair's walk-in already
  // held, and the server read the two as one person.
  it("numbers a stranger added on one chair of a split party past the other chair's walk-in", async () => {
    const visits = observeBarberDay.getMockImplementation();
    const WALK_IN = 'Случаен клиент';
    const seatFor = (chair: string, occupant: SeatOccupant) =>
      seatAt({
        chair,
        startsAt: '2026-08-05T10:00:00',
        occupant,
        serviceId: 'fade',
      });
    const split = visitOf(
      'appointment-split',
      [
        seatFor('ivan', accountOf(freshId('user'), SubjectRelationship.Self)),
        seatFor('niko', SeatOccupant.anonymous(SeatLabel.of(WALK_IN))),
      ],
      { contact: contactOf('Мартин Илиев', '+359881234567') },
    );
    observeBarberDay.mockImplementation((barberId: string) =>
      of(
        PortResult.ok(
          barberId === 'ivan' || barberId === 'niko' ? [split] : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      TestBed.inject(TranslocoService).setTranslation(
        {
          'staff.visit.walkIn': WALK_IN,
          'staff.visit.walkInNumbered': `${WALK_IN} {{number}}`,
        },
        'bg',
        { merge: true },
      );
      const sent: BookingCall.StaffEdit[] = [];
      const component = fixture.componentInstance as unknown as {
        store: {
          staffEdit: (request: BookingCall.StaffEdit) => Promise<boolean>;
        };
        commitFromEditor: (
          id: string,
          commit: VisitEditorCommit,
        ) => Promise<void>;
        visitEditorVm: () => VisitEditorVm | null;
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      component.store.staffEdit = async (request) => {
        sent.push(request);
        return true;
      };
      (
        host().querySelector(
          '[data-row-id="appointment-split#ivan"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      const vm = component.visitEditorVm();
      if (vm === null) throw new Error('the sheet did not open');
      const before = snapshotCommitOf(vm);
      const cut = before.legs[0];
      if (cut === undefined) throw new Error('the chair has no leg');

      // A service for somebody the desk never named, on Ivan's chair: the
      // walk-in placeholder beside the chair's own client.
      const withStranger: VisitEditorCommit = {
        ...before,
        endMinute: trackMinute(before.endMinute + cut.minutes),
        legs: [
          ...before.legs,
          {
            ...cut,
            seatId: SeatId.of('draft-stranger'),
            clientId: draftPersonKey('primary'),
          },
        ],
      };
      await component.commitFromEditor('appointment-split', withStranger);

      expect(
        commandOf(sent[0]?.commands ?? [], EditCommand.AddSeat)?.addedSubject,
      ).toEqual({
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: `${WALK_IN} 2`,
      });
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it('keeps the view menu to views, and blocking time under ＋', () => {
    // «Блокирай време» used to ride under the four readings (owner,
    // 2026-09-23): a picker that chooses how the day is DRAWN must not also
    // DO something to it. The act has one door, with the other acts.
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="staff-lane-block"]')).toBeNull();
    expect(
      host().querySelector('[data-testid="staff-view-week"]'),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-add-block"]'),
    ).not.toBeNull();
  });
  it('prints the contact details the owner asked for, behind their fields', () => {
    // REVERSED, deliberately. An earlier ruling kept digits out of the run
    // because this screen lies face-up on a counter and gets turned toward
    // whoever is standing at it. The owner has since asked for the email and
    // the number on the card, and that is their call about their own shop.
    //
    // They stay FIELDS rather than becoming fixtures, so a shop that shares
    // its counter with clients can put them back behind the sheet with one
    // tap — which is what this asserts.
    const row = host().querySelector('[data-testid="staff-visit-row"]');
    expect(
      row?.querySelector('[data-testid="staff-visit-phone"]'),
    ).not.toBeNull();
    expect(row?.textContent ?? '').toMatch(/\+\d/);

    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    if (component.fields.isOn('phone')) component.fields.toggle('phone');
    if (component.fields.isOn('email')) component.fields.toggle('email');
    fixture.detectChanges();

    const after = host().querySelector('[data-testid="staff-visit-row"]');
    expect(
      after?.querySelector('[data-testid="staff-visit-phone"]'),
    ).toBeNull();
    expect(
      after?.querySelector('[data-testid="staff-visit-email"]'),
    ).toBeNull();
    expect(after?.textContent ?? '').not.toMatch(/\+\d/);
  });

  // ── The grid views' design record (2026-09-23) ─────────────────────────

  it("names a period in the pill's own numeric grammar", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // 2026-08-05 is a Wednesday; its week runs Monday the 3rd to Sunday the
    // 9th, and the shared month is said once, the way the day pill says a
    // day («ср, 5.08») — never the long month that pushed the cluster off a
    // phone's bar.
    const label = host()
      .querySelector('[data-testid="staff-day-label"]')
      ?.textContent?.replace(/\s/g, ' ')
      .trim();
    expect(label).toContain('3 – 9.08');
    expect(label).not.toMatch(/август/i);
  });

  it('mounts the calendar in its own canvas, and the agenda in its stack', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The calendar is the screen: no padded stack around it, no 52rem cap.
    expect(
      host().querySelector(
        '[data-testid="staff-canvas"] [data-testid="staff-grid"]',
      ),
    ).not.toBeNull();
    expect(host().querySelector('.staff-lanes')).toBeNull();
    expect(
      host().querySelector('.staff-day')?.getAttribute('data-view-kind'),
    ).toBe('grid');

    chooseView('agenda');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('.staff-lanes')).not.toBeNull();
    expect(host().querySelector('[data-testid="staff-canvas"]')).toBeNull();
    expect(
      host().querySelector('.staff-day')?.getAttribute('data-view-kind'),
    ).toBe('agenda');
  });

  it("carries the view switch twice — the cluster's menu and the bar's segments", () => {
    // Both are in the DOM; the bar's own width shows one (a container query
    // the test runner cannot evaluate). The menu's items keep their ids, so
    // every `staff-view-{id}` query still resolves to the menu.
    expect(
      host().querySelector(
        '[data-testid="staff-view-segments"] [data-testid="staff-view-segment-week"]',
      ),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host()
        .querySelector('[data-testid="staff-view-week"]')
        ?.closest('.staff-view-menu'),
    ).not.toBeNull();
  });

  it("opens a date column's day in the day view from its head", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const heads = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-head-day"]',
    );
    expect(heads.length).toBe(7);
    // Thursday the 6th — Apple's own week-head tap.
    heads[3]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      store: { view(): string; dayKey(): string };
    };
    expect(component.store.view()).toBe('day');
    expect(component.store.dayKey()).toBe('2026-08-06');
    expect(
      host().querySelector('[data-testid="staff-day-label"]')?.textContent,
    ).toContain('6.08');
  });

  it('offers the way back to now on today once the present has left the frame', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // On today, with the present in the box, there is nothing to come back to.
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
    // Driven through the grid's own report, as the template wires it.
    const component = fixture.componentInstance as unknown as {
      grid(): { nowInView: { emit(inView: boolean): void } } | undefined;
    };
    component.grid()?.nowInView.emit(false);
    fixture.detectChanges();
    const button = host().querySelector('[data-testid="staff-day-today"]');
    expect(button).not.toBeNull();
    // A button that scrolls must not say it jumps.
    expect(button?.getAttribute('aria-label')).toBe('staff.day.backToNow');
    component.grid()?.nowInView.emit(true);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
  });

  it('reads the view and the chair from the route, and remembers the view', async () => {
    fixture.componentRef.setInput('view', 'week');
    fixture.componentRef.setInput('barber', 'ivan');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      store: { view(): string; scope(): string | null };
    };
    expect(component.store.view()).toBe('week');
    expect(component.store.scope()).toBe('ivan');
    // The view is kept on the device; the chair never is.
    expect(localStorage.getItem('staff.schedule.view')).toBe('week');
    // A name nobody has resolves to the list, not to a view that does not exist.
    fixture.componentRef.setInput('view', 'month');
    fixture.detectChanges();
    expect(component.store.view()).toBe('agenda');
  });

  it('writes the view and the chair to the address bar, after the tick', async () => {
    chooseView('week');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    expect(router.url).toContain('view=week');
    (
      host().querySelector(
        '[data-testid="staff-scope-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(router.url).toContain('barber=ivan');
    expect(router.url).toContain('view=week');
  });

  it("opens the block sheet all day from a date's all-day band, and from a chair's", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cells = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-add"]',
    );
    expect(cells.length).toBe(7);
    // Thursday the 6th's band: the sheet opens ON that date, all day on,
    // for the create chair.
    cells[3]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      blockEditorVm(): {
        allDay: boolean;
        dayKey: string;
        barberIds: readonly string[];
      } | null;
      closeBlockSheet(): void;
    };
    expect(
      host().querySelector('[data-testid="staff-block-sheet"]'),
    ).not.toBeNull();
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-06');
    component.closeBlockSheet();
    fixture.detectChanges();

    // The day view's band names a CHAIR: the sheet opens for it on the shown day.
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const chairs = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-add"]',
    );
    chairs[1]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-05');
    expect(component.blockEditorVm()?.barberIds).toEqual(['niko']);
  });

  it("opens a chair's day off from its chip in the band, on that date", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // Niko is off every day of the fixture's week; the chip in WEDNESDAY's
    // cell (the 5th, the third column) opens his rest day on that date,
    // ready to lift — not the shown day, not the first cell's.
    const cells = host().querySelectorAll<HTMLElement>(
      '[data-testid="staff-grid-allday-cell"]',
    );
    const chip = cells[2]?.querySelector<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-chip"]',
    );
    expect(chip?.tagName).toBe('BUTTON');
    chip?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      blockEditorVm(): {
        blockId: string | null;
        allDay: boolean;
        dayKey: string;
        barberIds: readonly string[];
        dayIsOff: boolean;
      } | null;
    };
    expect(component.blockEditorVm()?.blockId).toBe('day:niko');
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-05');
    expect(component.blockEditorVm()?.barberIds).toEqual(['niko']);
    expect(component.blockEditorVm()?.dayIsOff).toBe(true);
  });

  /*
   * THE CLIENT CARD'S THREE INPUTS (client-card-redesign §7.5): who booked
   * the visit (the only person its held rewards are for), who is looking
   * (the card's ‹role› gates), and the catalogue as the card names things
   * — one object for the page's life, reading the catalogue live.
   */
  it("binds the client card's inputs on the visit sheet: the booker, the viewer, the catalogue", () => {
    const original = principal$.value;
    principal$.next(
      principalFixture.staff(AccountId.of('dev-staff-ivan'), [
        Role.Barber,
        Role.Admin,
      ]),
    );
    try {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        visitSheetRow: () => { ownerUserId: string | null } | null;
      };
      const owner = component.visitSheetRow()?.ownerUserId ?? null;
      expect(owner).not.toBeNull();
      const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
        .componentInstance as StaffVisitEditor;
      expect(editor.uiOwnerUserId()).toBe(owner);
      expect(editor.uiViewer()).toEqual({
        userId: 'dev-staff-ivan',
        roles: ['barber', 'admin'],
      });

      const catalog = editor.uiClientCardCatalog();
      expect(catalog).not.toBeNull();
      expect(catalog?.barberName(BarberId.of('ivan'))).toBe('Иван');
      expect(catalog?.barberName(BarberId.of('nobody'))).toBeNull();
      expect(catalog?.serviceName(ServiceId.of('fade'))).toBe('fade');
      expect(catalog?.serviceName(ServiceId.of('retired'))).toBeNull();
      // No category is listed in this fixture; ONE shop is — the one the
      // chairs work at, which the day's windows are kept at (F1-10) — and
      // the card names it, and nothing it does not list.
      expect(catalog?.serviceCategory(ServiceId.of('fade'))).toBeNull();
      expect(catalog?.locationName(LocationId.of('loc-center'))).toBe('Център');
      expect(catalog?.locationName(LocationId.of('loc-gone'))).toBeNull();
      expect(catalog?.locationCount).toBe(1);
      // One object: a new one each pass would re-open an open card.
      fixture.detectChanges();
      expect(editor.uiClientCardCatalog()).toBe(catalog);
    } finally {
      principal$.next(original);
    }
  });

  /*
   * THE BOOKER'S COUPONS reach the sheet WITH THEIR OCCASION (revision 3
   * §4.6): the client card heads a birthday gift with its band only when
   * the coupon says `birthday`, and keeps it out of the generic ticket —
   * an option that arrives without one is a plain ticket, the band alone
   * above it (review 2, fix-editor r1: the store dropped the field).
   */
  it("offers the booker's coupons with their occasion: a birthday grant reaches the sheet as `couponOccasion: BIRTHDAY`, a plain one as `null`", async () => {
    const coupon = (
      id: string,
      name: string,
      percent: number,
      occasion: CouponOccasion | null,
    ): Coupon => ({
      id: CouponId.of(id),
      name,
      code: null,
      combinability:
        occasion === null ? Combinability.Stackable : Combinability.Exclusive,
      usageLimit: null,
      couponStatus: CouponStatus.Enabled,
      couponOccasion: occasion,
      ...unwrapOk(CouponValue.percentOff(percent)),
      ...CouponExpiryRule.never(),
    });
    // The record's grant of that coupon: its value and WHEN it lapses are
    // what the store reads, and it is ACTIVE, so usable. The birthday gift
    // lapses at 22:30 UTC on 28 October — 00:30 on the 29th in Sofia
    // (UTC+2 once summer time has ended), the day the card must print.
    const held = (
      grantId: string,
      of: Coupon,
      expiresAtUtcMs: UtcEpochMs | null = null,
    ): HeldGrant => ({
      grant: {
        id: CouponGrantId.of(grantId),
        // Re-addressed to whoever asks by the port double in `build`.
        customerId: CustomerId.of('customer-unknown'),
        holderUserId: null,
        couponId: of.id,
        grantedAtUtcMs: wall('2026-08-01T09:00:00').utcEpochMs,
        ...CouponValue.of(of),
        ...GrantLifecycle.active(
          GrantCapacityTerms.singleUse(),
          expiresAtUtcMs === null
            ? GrantExpiryTerms.none()
            : GrantExpiryTerms.at(expiresAtUtcMs),
        ),
      },
      coupon: of,
    });
    heldGrants = [
      held(
        'grant-birthday',
        coupon('coupon-birthday', 'Рожден ден', 20, CouponOccasion.Birthday),
        utcMs('2026-10-28T22:30:00+00:00'),
      ),
      held('grant-loyal', coupon('coupon-loyal', 'Постоянен клиент', 5, null)),
    ];
    // Earlier cases opened sheets of their own; only this opening counts.
    grantsAskedFor.length = 0;
    try {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
      // The read lands a few ticks on: the probe's signal becomes its
      // observable, the port answers, the answer becomes the signal.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await fixture.whenStable();
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        visitSheetRow: () => { ownerCustomerId: string | null } | null;
      };
      // Asked by the booker's client RECORD (D29), never by the uid.
      const owner = component.visitSheetRow()?.ownerCustomerId ?? null;
      expect(owner).not.toBeNull();
      expect(grantsAskedFor).toEqual([owner]);
      const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
        .componentInstance as StaffVisitEditor;
      expect(editor.uiGrants()).toEqual([
        {
          grantId: 'grant-birthday',
          couponId: 'coupon-birthday',
          label: 'Рожден ден',
          value: {
            discountMethod: DiscountMethod.PercentOff,
            discountPercent: 20,
          },
          exclusive: true,
          couponOccasion: CouponOccasion.Birthday,
          // The shop's day, not the UTC instant's (review 2, POLISH-editor).
          expiresOn: '2026-10-29',
        },
        {
          grantId: 'grant-loyal',
          couponId: 'coupon-loyal',
          label: 'Постоянен клиент',
          value: {
            discountMethod: DiscountMethod.PercentOff,
            discountPercent: 5,
          },
          exclusive: false,
          couponOccasion: null,
          expiresOn: null,
        },
      ]);
    } finally {
      heldGrants = [];
      grantsAskedFor.length = 0;
    }
  });

  it("names a companion by his own profile — never with the booker's name or number", async () => {
    const visits = observeBarberDay.getMockImplementation();
    const seat = (
      chair: string,
      uid: string,
      relationship: SubjectRelationship,
    ) =>
      seatAt({
        chair,
        startsAt: '2026-08-05T10:00:00',
        occupant: accountOf(uid, relationship),
      });
    // A father books himself with Ivan and his son — an account of his
    // own — with Niko: the contact is the father's.
    const family = visitOf(
      'appointment-family',
      [
        seat('ivan', 'user-father', SubjectRelationship.Self),
        seat('niko', 'user-son', SubjectRelationship.Companion),
      ],
      { contact: contactOf('Стоян Колев', '+359 88 765 4321') },
    );
    profiles.set(
      AccountId.of('user-son'),
      registeredUserFixture({
        id: AccountId.of('user-son'),
        phone: E164.of('+359887000111'),
        firstName: 'Иво',
        lastName: 'Колев',
      }),
    );
    observeBarberDay.mockImplementation((barberId: string) =>
      of(
        PortResult.ok(
          barberId === 'ivan' || barberId === 'niko' ? [family] : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      // The son's profile is asked for as the book loads.
      await fixture.whenStable();
      fixture.detectChanges();
      const open = (rowId: string) => {
        (
          host().querySelector(`[data-row-id="${rowId}"]`) as HTMLElement
        ).click();
        fixture.detectChanges();
        return fixture.debugElement.query(By.directive(StaffVisitEditor))
          .componentInstance as StaffVisitEditor;
      };
      const son = open('appointment-family#niko').vm().people?.[0];
      expect(son).toEqual({
        id: 'user-son',
        label: 'Иво Колев',
        phone: null,
        phoneHref: null,
        meta: null,
        email: null,
      });

      // The father's chair keeps the booking's contact: it is his.
      const component = fixture.componentInstance as unknown as {
        closeVisitSheet: () => void;
      };
      component.closeVisitSheet();
      fixture.detectChanges();
      const father = open('appointment-family#ivan').vm().people?.[0];
      expect(father?.id).toBe('user-father');
      expect(father?.label).toBe('Стоян Колев');
      expect(father?.phoneHref).toBe('+359887654321');
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
      profiles.clear();
    }
  });

  it('names no companion by a provisioned stub: a sign-in that never registered is no profile', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const seat = (
      chair: string,
      uid: string,
      relationship: SubjectRelationship,
    ) =>
      seatAt({
        chair,
        startsAt: '2026-08-05T10:00:00',
        occupant: accountOf(uid, relationship),
      });
    const family = visitOf(
      'appointment-family',
      [
        seat('ivan', 'user-father', SubjectRelationship.Self),
        seat('niko', 'user-son', SubjectRelationship.Companion),
      ],
      { contact: contactOf('Стоян Колев', '+359 88 765 4321') },
    );
    // The son signed in once and stopped there: `PROFILE_PORTS` answers
    // his stub as stored. Whatever names a stub might hold, it is no
    // profile — the registration state decides, never the names.
    profiles.set(
      AccountId.of('user-son'),
      provisionedUserFixture({
        id: AccountId.of('user-son'),
        phone: E164.of('+359887000111'),
        firstName: 'Иво',
        lastName: 'Колев',
      }),
    );
    observeBarberDay.mockImplementation((barberId: string) =>
      of(
        PortResult.ok(
          barberId === 'ivan' || barberId === 'niko' ? [family] : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      await fixture.whenStable();
      fixture.detectChanges();
      (
        host().querySelector(
          '[data-row-id="appointment-family#niko"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
        .componentInstance as StaffVisitEditor;
      // Unnamed, as before the read — never the stub's empty name, never
      // the booker's.
      expect(editor.vm().people?.[0]).toEqual({
        id: 'user-son',
        label: 'staff.day.unnamedClient',
        phone: null,
        phoneHref: null,
        meta: null,
        email: null,
      });
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
      profiles.clear();
    }
  });

  /*
   * ── THE TOOLBAR BOX, OFF THE RENDER HOOK (2026-10-06) ─────────────────
   * `watchToolbar` keeps asking for the bar frame by frame, which puts it
   * outside Angular's error handler and past the view's own lifetime. Gate 5
   * caught it constructing a `ResizeObserver` jsdom does not have — an
   * uncaught exception that failed the whole run while every test passed.
   */
  describe('the toolbar box, measured off the render hook', () => {
    const frames: FrameRequestCallback[] = [];

    beforeEach(async () => {
      frames.length = 0;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      TestBed.resetTestingModule();
      await build();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      frames.length = 0;
    });

    /** The method as a frame callback runs it: with nothing around it. */
    function fromAFrame(): { watchToolbar: (framesLeft: number) => void } {
      return fixture.componentInstance as unknown as {
        watchToolbar: (framesLeft: number) => void;
      };
    }

    it('measures the bar once where nothing observes resizes (jsdom), instead of throwing from the frame', () => {
      expect(typeof ResizeObserver).toBe('undefined');
      const page = host().querySelector<HTMLElement>('.staff-day');
      page?.style.removeProperty('--staff-toolbar-real');
      const asked = frames.length;

      expect(() => fromAFrame().watchToolbar(2)).not.toThrow();

      expect(page?.style.getPropertyValue('--staff-toolbar-real')).toMatch(
        /^\d+px$/,
      );
      // The bar was there: measured, not asked for again.
      expect(frames).toHaveLength(asked);
    });

    it('stops asking once the page is gone — no observer, no `onDestroy` on a destroyed view', () => {
      const observed: Element[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe(target: Element): void {
            observed.push(target);
          }
          disconnect(): void {
            // nothing to let go of
          }
        },
      );
      fixture.destroy();
      frames.length = 0;

      expect(() => fromAFrame().watchToolbar(3)).not.toThrow();

      expect(observed).toHaveLength(0);
      expect(frames).toHaveLength(0);
    });
  });

  /*
   * ── PASS C: ONE RULE PER DECISION (the departures, DEP-1…DEP-5) ────────
   * Where the sheet and the server (or another surface) answered the same
   * question two ways, one rule survives — the system's. Each case pins the
   * surviving answer on a fixture where the two used to differ.
   */
  describe('the departures — one rule per decision (pass C)', () => {
    let visits: ReturnType<typeof observeBarberDay.getMockImplementation>;

    beforeEach(() => {
      visits = observeBarberDay.getMockImplementation();
    });

    afterEach(() => {
      if (visits) observeBarberDay.mockImplementation(visits);
    });

    /** The page again, its chairs answering with these visits on whatever day is asked. */
    async function buildWith(
      byChair: ReadonlyMap<string, readonly Appointment[]>,
      nowIso?: string,
    ): Promise<void> {
      observeBarberDay.mockImplementation((barberId: string) =>
        of(PortResult.ok(byChair.get(barberId) ?? [])),
      );
      TestBed.resetTestingModule();
      await build(nowIso);
    }

    async function openRow(rowId: string): Promise<void> {
      (host().querySelector(`[data-row-id="${rowId}"]`) as HTMLElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('reads a chair two actors called off by the seat called off LAST, in both orders (DEP-1)', async () => {
      // A father and son in one chair, both called off with no reason given
      // — so each seat's side is its actor's — at 08:00 and at 08:30.
      const calledOff = (iso: string, by: CancelledBy) =>
        SeatOutcome.cancelled(
          wall(iso).utcEpochMs,
          by,
          CancellationReason.Unspecified,
          null,
        );
      const chair = (id: string, first: CancelledBy, last: CancelledBy) =>
        visitOf(id, [
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:00:00',
            occupant: accountOf(freshId('user'), SubjectRelationship.Self),
            outcome: calledOff('2026-08-05T08:00:00', first),
          }),
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:30:00',
            occupant: accountOf(freshId('user'), SubjectRelationship.Companion),
            outcome: calledOff('2026-08-05T08:30:00', last),
          }),
        ]);
      for (const [first, last, side] of [
        // The client first, then the shop: the shop's act ended it.
        [CancelledBy.Client, CancelledBy.Staff, 'cancelledByStaff'],
        // The shop first, then the client: the client's act ended it — the
        // card's rows and the statistics read it so, and so does the sheet.
        [CancelledBy.Staff, CancelledBy.Client, 'cancelledByClient'],
      ] as const) {
        await buildWith(
          new Map([['ivan', [chair('appointment-mixed', first, last)]]]),
        );
        await openRow('appointment-mixed#ivan');
        const line =
          host().querySelector('[data-testid="staff-visit-resolution-line"]')
            ?.textContent ?? '';
        expect(line).toContain(`staff.visit.resolution.${side}`);
      }
    });

    it('draws no settled visit around the block, and warns of no overlap with one (DEP-2)', async () => {
      const self = () => accountOf(freshId('user'), SubjectRelationship.Self);
      const opened = visitOf(
        'appointment-open',
        [
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:00:00',
            occupant: self(),
          }),
        ],
        { contact: contactOf('Отворен Час', '+359881111111') },
      );
      // Finished at 10:45, over the opened visit's last quarter hour.
      const done = visitOf(
        'appointment-done',
        [
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:15:00',
            occupant: self(),
            outcome: SeatOutcome.worked(wall('2026-08-05T10:45:00').utcEpochMs),
          }),
        ],
        {
          contact: contactOf('Свършен Час', '+359882222222'),
          lifecycle: BookingLifecycle.complete(
            wall('2026-08-05T10:45:00').utcEpochMs,
          ),
        },
      );
      // A live visit later on — still drawn, so the absence is not vacuous.
      const later = visitOf(
        'appointment-later',
        [
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T12:00:00',
            occupant: self(),
          }),
        ],
        { contact: contactOf('Жив Съсед', '+359884444444') },
      );
      await buildWith(new Map([['ivan', [opened, done, later]]]));
      await openRow('appointment-open#ivan');
      const component = fixture.componentInstance as unknown as {
        visitEditorVm: () => VisitEditorVm | null;
      };
      const names = (component.visitEditorVm()?.neighbours ?? []).map(
        (neighbour) => neighbour.name,
      );
      expect(names).toContain('Жив Съсед');
      // What occupies the chair is what the server's overlap refusal reads:
      // a finished visit is a record, not a collision.
      expect(names).not.toContain('Свършен Час');
      expect(
        host().querySelector('[data-testid="staff-visit-frame-note"]'),
      ).toBeNull();
    });

    it("reads a split party's chair by the ROOT's status on the shown day, a stepped one, the create frame and the block frame alike (DEP-2)", async () => {
      const opened = visitOf('appointment-open', [
        seatAt({
          chair: 'ivan',
          startsAt: '2026-08-05T10:00:00',
          occupant: accountOf(freshId('user'), SubjectRelationship.Self),
        }),
      ]);
      // Ivan's guest of the party called off; Niko's still booked — the
      // root stays live.
      const splitOn = (id: string, day: string) =>
        visitOf(
          id,
          [
            seatAt({
              chair: 'ivan',
              startsAt: `${day}T10:00:00`,
              occupant: accountOf(freshId('user'), SubjectRelationship.Self),
              outcome: SeatOutcome.cancelled(
                wall(`${day}T08:00:00`).utcEpochMs,
                CancelledBy.Client,
                CancellationReason.ClientUnwell,
                null,
              ),
            }),
            seatAt({
              chair: 'niko',
              startsAt: `${day}T10:00:00`,
              occupant: accountOf(
                freshId('user'),
                SubjectRelationship.Companion,
              ),
            }),
          ],
          { contact: contactOf('Разделена Група', '+359883333333') },
        );
      const today = splitOn('appointment-split-today', '2026-08-05');
      const tomorrow = splitOn('appointment-split-tomorrow', '2026-08-06');
      observeBarberDay.mockImplementation((barberId: string, dayKey: string) =>
        of(
          PortResult.ok(
            dayKey === '2026-08-05'
              ? barberId === 'ivan'
                ? [opened, today]
                : barberId === 'niko'
                  ? [today]
                  : []
              : dayKey === '2026-08-06' &&
                  (barberId === 'ivan' || barberId === 'niko')
                ? [tomorrow]
                : [],
          ),
        ),
      );
      TestBed.resetTestingModule();
      await build();
      // The party's chair is drawn, and drawn cancelled…
      expect(
        host()
          .querySelector('[data-row-id="appointment-split-today#ivan"]')
          ?.getAttribute('data-status'),
      ).toBe('cancelled');
      await openRow('appointment-open#ivan');
      const component = fixture.componentInstance as unknown as {
        visitEditorVm: () => VisitEditorVm | null;
        visitFrameDay: () => {
          readonly neighbours: readonly { readonly name: string }[];
        } | null;
        createVisit: { set: (create: unknown) => void };
        createVm: () => VisitEditorVm | null;
        blockLaneFor: (
          barberId: string,
          frameDay: string,
          shownDay: string,
        ) => { readonly neighbours: readonly { readonly name: string }[] };
      };
      // …but what occupies the chair is the server's rule — the ROOT's
      // status (`BusySystem.chairOccupants`): the party is live, so its seat
      // in this chair is drawn on the shown day too.
      expect(
        (component.visitEditorVm()?.neighbours ?? []).map((n) => n.name),
      ).toContain('Разделена Група');
      // The create and block frames on the shown day read the same rule.
      expect(
        component
          .blockLaneFor('ivan', '2026-08-05', '2026-08-05')
          .neighbours.map((n) => n.name),
      ).toContain('Разделена Група');
      component.createVisit.set({
        barberId: 'ivan',
        startMinute: 600,
        nonce: 9001,
      });
      expect(
        (component.createVm()?.neighbours ?? []).map((n) => n.name),
      ).toContain('Разделена Група');
      component.createVisit.set(null);

      // A stepped day reads the documents, by the ROOT's status: the party
      // is live, so its seat in this chair is drawn.
      (
        host().querySelector(
          '[data-testid="staff-visit-day-next"]',
        ) as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        (component.visitFrameDay()?.neighbours ?? []).map((n) => n.name),
      ).toContain('Разделена Група');
    });

    it('keeps the way back on a save that adds a seat to a chair worked inside a live party (DEP-3)', async () => {
      const split = visitOf('appointment-split', [
        seatAt({
          chair: 'ivan',
          startsAt: '2026-08-05T10:00:00',
          occupant: accountOf(freshId('user'), SubjectRelationship.Self),
        }),
        seatAt({
          chair: 'niko',
          startsAt: '2026-08-05T10:00:00',
          occupant: accountOf(freshId('user'), SubjectRelationship.Companion),
          outcome: SeatOutcome.worked(wall('2026-08-05T10:30:00').utcEpochMs),
        }),
      ]);
      await buildWith(
        new Map([
          ['ivan', [split]],
          ['niko', [split]],
        ]),
      );
      const component = fixture.componentInstance as unknown as {
        store: { staffEdit: (request: unknown) => Promise<boolean> };
        visitSheetRow: () => {
          readonly bookingStatus: BookingStatus;
          readonly rootBookingStatus: BookingStatus;
        } | null;
        visitEditorVm: () => VisitEditorVm | null;
        saveFromEditor: (
          appointmentId: string,
          commit: VisitEditorCommit,
          row: unknown,
        ) => Promise<void>;
        undo: () => { message: string } | null;
        notice: () => string | null;
        rowWaitMs: number;
      };
      component.rowWaitMs = 0;
      const edits: SentEdit[] = [];
      component.store.staffEdit = async (request) => {
        edits.push(request as SentEdit);
        return true;
      };
      await openRow('appointment-split#niko');
      const row = component.visitSheetRow();
      const vm = component.visitEditorVm();
      if (row === null || vm === null)
        throw new Error('the sheet did not open');
      // Niko's chair is worked; the party is not.
      expect(row.bookingStatus).toBe(BookingStatus.Completed);
      expect(row.rootBookingStatus).toBe(BookingStatus.Pending);

      const before = snapshotCommitOf(vm);
      const leg = before.legs[0];
      if (leg === undefined) throw new Error('the chair has no leg');
      await component.saveFromEditor(
        'appointment-split',
        {
          ...before,
          legs: [...before.legs, { ...leg, seatId: SeatId.of('draft-extra') }],
        },
        row,
      );
      expect(edits).toHaveLength(1);
      expect(
        commandOf(edits[0]?.commands ?? [], EditCommand.AddSeat),
      ).toBeDefined();
      // The server marks an added seat worked only on a COMPLETED root, so
      // this one can still be removed: the receipt carries its «Отмени».
      expect(component.undo()?.message).toBe('staff.day.undo.saved');
      expect(component.notice()).toBeNull();
    });

    it('lifts the WHOLE day of a chair rostered nowhere that still holds bookings, and says so on the row (DEP-4)', async () => {
      // Niko is rostered nowhere (the fixture) yet holds the party's seat.
      const party = appointment(
        'appointment-1',
        '2026-08-05T10:00:00',
        undefined,
        'ivan',
        true,
      );
      await buildWith(
        new Map([
          ['ivan', [party]],
          ['niko', [party]],
        ]),
      );
      const component = fixture.componentInstance as unknown as {
        blockEdit: { set: (edit: unknown) => void };
        liftFromEditor: () => Promise<void>;
        blockLiftArmed: () => boolean;
      };
      // A saved range opened on that chair's shown day.
      component.blockEdit.set({
        blockId: 'block:niko:0',
        barberIds: ['niko'],
        allDay: false,
        startMinute: 12 * 60,
        endMinute: 13 * 60,
      });
      fixture.detectChanges();
      const lift = host().querySelector('[data-testid="staff-block-lift"]');
      expect(lift?.textContent).toContain('staff.block.liftDay');
      expect(lift?.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
        'staff.off',
      );

      // The day's lift — armed first, as every day-wide lift is…
      await component.liftFromEditor();
      expect(component.blockLiftArmed()).toBe(true);
      expect(writeScheduleException).not.toHaveBeenCalled();
      // …then the whole day, never a range the closed day would refuse.
      await component.liftFromEditor();
      expect(writeScheduleException).toHaveBeenCalledTimes(1);
      expect(component.blockLiftArmed()).toBe(false);
    });

    it('files a party booked companion-first under its BOOKER in «Скорошни» and in the book (DEP-5)', async () => {
      TestBed.resetTestingModule();
      await build('2026-08-05T12:00:00.000+03:00');
      const son = freshId('user');
      const father = freshId('user');
      // The son's seat first; the booking — and its contact — the father's.
      const family = visitOf(
        'appointment-family',
        [
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:00:00',
            occupant: accountOf(son, SubjectRelationship.Companion),
          }),
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T10:30:00',
            occupant: accountOf(father, SubjectRelationship.Self),
          }),
        ],
        { contact: contactOf('Стоян Колев', '+359887000111') },
      );
      const component = fixture.componentInstance as unknown as {
        store: {
          ensureWindow: () => Promise<void>;
          window: () => readonly Appointment[];
        };
        browseClients: () => Promise<void>;
        visitClientSections: () => readonly {
          readonly clients: readonly { id: string; label: string }[];
        }[];
        visitClientBook: () => readonly { id: string; label: string }[];
      };
      component.store.ensureWindow = async () => undefined;
      component.store.window = () => [family];
      await component.browseClients();
      // The father's name and number are filed under the father's account —
      // never the son's, which would book the son as the father.
      expect(
        component
          .visitClientSections()[0]
          ?.clients.map((client) => [client.id, client.label]),
      ).toEqual([[father, 'Стоян Колев']]);
      expect(
        component.visitClientBook().map((client) => [client.id, client.label]),
      ).toEqual([[father, 'Стоян Колев']]);
    });

    /*
     * ── PASS D: THE STAFF DAY ON THE WALL CLOCK (OQ-14) ─────────────────
     *
     * Every visit-vs-now answer of the day — live, next, past, the agenda's
     * headings, the pooled search and «Скорошни» — reads the shop's wall
     * clock (`localDate` + minutes against `ShopNow`), and changes only
     * inside Sofia's fall-back repeat hour (2026-10-25, 04:00 EEST → 03:00
     * EET: a stored visit holds the EARLIER offset), its spring-forward gap
     * (2026-03-29, 03:00–03:59 does not exist), across zones, or at a
     * minute's millisecond 0. Each case says what the instant reading
     * answered before. Clocks are pinned; nothing reads the wall clock.
     */
    describe('the staff day on the wall clock (pass D, OQ-14)', () => {
      const FALL_BACK = '2026-10-25';
      const SPRING_FORWARD = '2026-03-29';
      const LONDON = LocationId.of('loc-london');
      const londonZone = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));
      const LONDON_LOCATION = locationFixture({
        id: LONDON,
        timeZone: londonZone,
      });

      afterEach(() => {
        catalogShops = null;
        defaultShop = null;
        searchPool = null;
        seededExceptions = [];
      });

      /** One self-booked visit in Ivan's chair at `startsAt` (a wall-clock reading) for `minutes`. */
      function ivanVisit(
        id: string,
        startsAt: string,
        minutes = 30,
        contactName: string | null = null,
      ): Appointment {
        return visitOf(
          id,
          [
            seatAt({
              chair: 'ivan',
              startsAt,
              minutes,
              occupant: accountOf(freshId('user'), SubjectRelationship.Self),
            }),
          ],
          contactName === null
            ? {}
            : { contact: contactOf(contactName, '+359880000000') },
        );
      }

      /** The same visit at the London shop — its instant read in London's zone, as ingestion stores it. */
      function inLondon(visit: Appointment): Appointment {
        return {
          ...visit,
          locationId: LONDON,
          utcEpochMs: unwrapOk(
            ZonedTimeSystem.toUtc(
              visit.localDate,
              visit.startMinutes,
              londonZone,
            ),
          ),
        };
      }

      function row(appointmentId: string): Element | null {
        return host().querySelector(`[data-row-id="${appointmentId}#ivan"]`);
      }

      /** A stored block on Ivan's day, laid in before the page comes up. */
      function blockOn(day: string, from: MinuteOfDay, to: EndMinute): void {
        const localDate = unwrapOk(LocalDate.parse(day));
        seededExceptions = [
          ...seededExceptions,
          {
            id: ScheduleExceptionId.of(
              BusyKey.of(BarberId.of('ivan'), localDate),
            ),
            barberId: BarberId.of('ivan'),
            localDate,
            utcEpochMs: ZonedTimeSystem.startOfLocalDay(
              localDate,
              FIXTURE_TIME_ZONE,
            ),
            locationId: SHOP,
            ...unwrapOk(
              ExceptionEffectRule.blocked([MinuteRange.of(from, to)]),
            ),
          },
        ];
      }

      /**
       * The shop open round the clock and Ivan rostered from `from` to the
       * closing midnight every day — so a chair can work through 03:00 —
       * for the length of `run`.
       */
      async function roundTheClock(
        from: MinuteOfDay,
        run: () => Promise<void>,
      ): Promise<void> {
        const roster = observeSchedule.getMockImplementation();
        catalogShops = of(
          PortResult.ok([
            locationFixture({
              id: SHOP,
              openingHours: Array.from({ length: 7 }, () =>
                DayHours.open(wallAt(0), until(24)),
              ),
            }),
          ]),
        );
        const days: readonly Weekday[] = [
          Weekday.Mon,
          Weekday.Tue,
          Weekday.Wed,
          Weekday.Thu,
          Weekday.Fri,
          Weekday.Sat,
          Weekday.Sun,
        ];
        observeSchedule.mockImplementation((barberId: BarberId) =>
          of(
            PortResult.ok(
              barberId === 'ivan'
                ? barberScheduleFixture({
                    id: BarberId.of('ivan'),
                    turnaroundMinutes: MinuteCount.ZERO,
                    versions: [
                      {
                        seq: 1,
                        effectiveFromLocalDate: unwrapOk(
                          LocalDate.parse('2026-01-01'),
                        ),
                        effectiveToLocalDate: null,
                        segments: days.map((day) =>
                          ShiftSegment.of(day, SHOP, from, until(24)),
                        ),
                      },
                    ],
                  })
                : null,
            ),
          ),
        );
        try {
          await run();
        } finally {
          if (roster) observeSchedule.mockImplementation(roster);
        }
      }

      type WallClockPage = {
        store: {
          openSearch: () => Promise<void>;
          setTerm: (term: string) => void;
          setView: (view: StaffView) => void;
        };
        searchResults: () => readonly {
          readonly id: string;
          readonly past: boolean;
          readonly whenLabel: string;
        }[];
        browseClients: () => Promise<void>;
        visitClientSections: () => readonly {
          readonly clients: readonly {
            readonly label: string;
            readonly meta: string | null;
          }[];
        }[];
        lanes: () => readonly {
          readonly entries: readonly (Record<string, unknown> & {
            readonly id: string;
          })[];
        }[];
        gridColumns: () => readonly {
          readonly id: string;
          readonly open: readonly { readonly startMinute: number }[];
          readonly events: readonly {
            readonly id: string;
            readonly past: boolean;
          }[];
        }[];
        rosterExtent: () => { readonly start: number | null };
        openBlock: (blockId: string) => void;
        blockEdit: () => {
          readonly startMinute: number;
          readonly endMinute: number;
        } | null;
        whenLabel: (entry: unknown) => string;
      };

      const page = () => fixture.componentInstance as unknown as WallClockPage;

      it('keeps a visit LIVE in the second pass of the fall-back hour (DEP-1)', async () => {
        const visit = ivanVisit('appointment-repeat', `${FALL_BACK}T03:00:00`);
        // The FIRST 03:10 (EEST): in the chair — before and after.
        await buildWith(
          new Map([['ivan', [visit]]]),
          `${FALL_BACK}T03:10:00.000+03:00`,
        );
        expect(row('appointment-repeat')?.hasAttribute('data-live')).toBe(true);
        // The SECOND 03:10 (EET): the stored end (03:30 EEST) has passed as
        // an instant, but the shop's wall clock reads 03:10 — still in the
        // chair (was: not live).
        await buildWith(
          new Map([['ivan', [visit]]]),
          `${FALL_BACK}T03:10:00.000+02:00`,
        );
        expect(row('appointment-repeat')?.hasAttribute('data-live')).toBe(true);
      });

      it('names the next visit by the wall clock in the second pass (DEP-2)', async () => {
        const visit = ivanVisit('appointment-later', `${FALL_BACK}T03:45:00`);
        await buildWith(
          new Map([['ivan', [visit]]]),
          `${FALL_BACK}T03:10:00.000+02:00`,
        );
        // 03:45 has not come round again on the wall clock (its first pass
        // did, as an instant): the chair's next (was: started, not next).
        expect(row('appointment-later')?.hasAttribute('data-next')).toBe(true);
      });

      it("keeps the lane's own order for the next visit on an ordinary day: a sequential second leg before a later party (DEP-2)", async () => {
        // Party A's envelope starts at 10:00 with Niko; Ivan's leg follows
        // at 11:00. Party B is Ivan's 10:30. The lane delivers them in
        // envelope order — A, then B — and the next is the FIRST of them
        // not begun at 10:15: A, before and after (never re-sorted by the
        // chair's seat start).
        const a = visitOf('appointment-a', [
          seatAt({
            chair: 'niko',
            startsAt: '2026-08-05T10:00:00',
            minutes: 60,
            occupant: accountOf(freshId('user'), SubjectRelationship.Self),
          }),
          seatAt({
            chair: 'ivan',
            startsAt: '2026-08-05T11:00:00',
            occupant: accountOf(freshId('user'), SubjectRelationship.Companion),
          }),
        ]);
        const b = ivanVisit('appointment-b', '2026-08-05T10:30:00');
        await buildWith(
          new Map([['ivan', [a, b]]]),
          '2026-08-05T10:15:00.000+03:00',
        );
        expect(row('appointment-a')?.hasAttribute('data-next')).toBe(true);
        expect(row('appointment-b')?.hasAttribute('data-next')).toBe(false);
      });

      it('reads a visit past by the wall clock — it un-ends in the second pass, and ends again at 03:40 (DEP-3)', async () => {
        const visit = ivanVisit('appointment-early', `${FALL_BACK}T03:00:00`);
        // The second 03:10: ended in the first pass, not on the wall clock
        // (was: past).
        await buildWith(
          new Map([['ivan', [visit]]]),
          `${FALL_BACK}T03:10:00.000+02:00`,
        );
        expect(row('appointment-early')?.hasAttribute('data-past')).toBe(false);
        // The second 03:40: its end (03:30) is behind the wall clock.
        await buildWith(
          new Map([['ivan', [visit]]]),
          `${FALL_BACK}T03:40:00.000+02:00`,
        );
        expect(row('appointment-early')?.hasAttribute('data-past')).toBe(true);
      });

      it('reads a block past by the wall clock the same way, in the day view (DEP-3)', async () => {
        await roundTheClock(wallAt(0), async () => {
          blockOn(FALL_BACK, wallAt(3), until(3, 30));
          const blockOf = () =>
            page()
              .gridColumns()
              .flatMap((column) => column.events)
              .find((event) => event.id === `block:ivan:${FALL_BACK}:180`);
          await buildWith(new Map(), `${FALL_BACK}T03:10:00.000+02:00`);
          page().store.setView(StaffView.Day);
          fixture.detectChanges();
          expect(blockOf()?.past).toBe(false);
          await buildWith(new Map(), `${FALL_BACK}T03:40:00.000+02:00`);
          page().store.setView(StaffView.Day);
          fixture.detectChanges();
          expect(blockOf()?.past).toBe(true);
        });
      });

      it("reads the agenda heading at the clock's own minute as begun, and opens the run after it (DEP-4)", async () => {
        const group = (minute: number) =>
          host()
            .querySelector(`#agenda-time-${minute}`)
            ?.closest('[data-testid="staff-agenda-group"]') ?? null;
        // Exactly 09:00:00.000 — the fixture's free hour heads the run at
        // 09:00, Ivan's visit at 10:00. The 09:00 heading has begun (was:
        // not past at millisecond 0), and the run opens on the next one.
        TestBed.resetTestingModule();
        await build('2026-08-05T09:00:00.000+03:00');
        showFreeTime();
        expect(group(540)?.hasAttribute('data-past')).toBe(true);
        expect(group(540)?.hasAttribute('data-now-anchor')).toBe(false);
        expect(group(600)?.hasAttribute('data-now-anchor')).toBe(true);
        // Half a minute on — what production's minute tick reads: the same
        // answer before and after.
        TestBed.resetTestingModule();
        await build('2026-08-05T09:00:30.000+03:00');
        showFreeTime();
        expect(group(540)?.hasAttribute('data-past')).toBe(true);
        expect(group(600)?.hasAttribute('data-now-anchor')).toBe(true);
      });

      it('names each agenda heading by its minute of the day (DEP-5)', () => {
        // The fixture's 10:00 visit: `agenda-time-600` (was the instant's
        // milliseconds), and the run below it is labelled by it.
        expect(host().querySelector('#agenda-time-600')?.tagName).toBe('H2');
        expect(
          host().querySelector('ul[aria-labelledby="agenda-time-600"]'),
        ).not.toBeNull();
      });

      it("judges, orders and words a pooled hit on its own shop's clock (DEP-6)", async () => {
        // Sofia 09:00 is London 07:00. A London cut at 08:30 on ITS clock
        // has not begun there: not past, and the soonest future hit — ahead
        // of Sofia's 10:00, printed 08:30 (was: past by the Sofia reading of
        // its end, ordered after Sofia's by instant, printed 10:30).
        const sofia = ivanVisit(
          'appointment-sofia',
          '2026-08-05T10:00:00',
          30,
          'Мира Софийска',
        );
        const london = inLondon(
          ivanVisit(
            'appointment-london',
            '2026-08-05T08:30:00',
            30,
            'Мира Лондонска',
          ),
        );
        catalogShops = of(PortResult.ok([SHOP_LOCATION, LONDON_LOCATION]));
        searchPool = [sofia, london];
        TestBed.resetTestingModule();
        await build('2026-08-05T09:00:00.000+03:00');
        await page().store.openSearch();
        page().store.setTerm('мира');
        const hits = page().searchResults();
        expect(hits.map((hit) => hit.id)).toEqual([
          'appointment-london',
          'appointment-sofia',
        ]);
        expect(hits.map((hit) => hit.past)).toEqual([false, false]);
        expect(hits[0]?.whenLabel).toContain('08:30');
        expect(hits[1]?.whenLabel).toContain('10:00');
      });

      it('calls no hit past and words none before any zone is known (DEP-6, pre-zone pin)', async () => {
        catalogShops = new ReplaySubject<
          PortResult<readonly ShopLocation[], RepositoryError>
        >(1);
        defaultShop = new Promise(() => undefined);
        // Ended at 08:30 — past, once a zone says so; nothing is, before.
        searchPool = [
          ivanVisit('appointment-gone', '2026-08-05T08:00:00', 30, 'Мира'),
        ];
        TestBed.resetTestingModule();
        await build('2026-08-05T09:00:00.000+03:00');
        await page().store.openSearch();
        page().store.setTerm('мира');
        expect(page().searchResults()).toEqual([
          expect.objectContaining({
            id: 'appointment-gone',
            past: false,
            whenLabel: '',
          }),
        ]);
      });

      describe('«Скорошни» (DEP-7)', () => {
        /** The section's people, by name, with the date their line carries. */
        async function recent(): Promise<
          readonly (readonly [string, string | null])[]
        > {
          TestBed.inject(TranslocoService).setTranslation(
            { 'staff.visit.lastVisit': '{{date}}' },
            'bg',
            { merge: true },
          );
          await page().browseClients();
          return (page().visitClientSections()[0]?.clients ?? []).map(
            (client) => [client.label, client.meta] as const,
          );
        }

        it('leaves out a visit that has not begun on the wall clock in the second pass', async () => {
          searchPool = [
            ivanVisit(
              'appointment-begun',
              `${FALL_BACK}T03:00:00`,
              30,
              'Ранен',
            ),
            ivanVisit(
              'appointment-ahead',
              `${FALL_BACK}T03:40:00`,
              30,
              'Късен',
            ),
          ];
          TestBed.resetTestingModule();
          await build(`${FALL_BACK}T03:10:00.000+02:00`);
          // 03:40 has come round once as an instant, not yet on the wall
          // clock (was: listed).
          expect((await recent()).map(([name]) => name)).toEqual(['Ранен']);
        });

        it('orders and dates a London visit by its own wall clock', async () => {
          // London's 23:30 on the 4th is Sofia's 01:30 on the 5th; Sofia's
          // own visit is at 23:45 on the 4th. Newest first on each shop's
          // clock — Sofia's, then London's, both on the 4th (was: London
          // first by instant, dated the 5th).
          searchPool = [
            ivanVisit(
              'appointment-sofia',
              '2026-08-04T23:45:00',
              15,
              'Софийски',
            ),
            inLondon(
              ivanVisit(
                'appointment-london',
                '2026-08-04T23:30:00',
                15,
                'Лондонски',
              ),
            ),
          ];
          catalogShops = of(PortResult.ok([SHOP_LOCATION, LONDON_LOCATION]));
          TestBed.resetTestingModule();
          await build('2026-08-05T09:00:00.000+03:00');
          const people = await recent();
          expect(people.map(([name]) => name)).toEqual([
            'Софийски',
            'Лондонски',
          ]);
          expect(people[0]?.[1]).toBe(people[1]?.[1]);
          expect(people[1]?.[1]).toContain('4');
        });

        it("lists a visit that begins at the tick's very millisecond", async () => {
          searchPool = [
            ivanVisit('appointment-now', '2026-08-05T09:00:00', 30, 'Точен'),
          ];
          TestBed.resetTestingModule();
          await build('2026-08-05T09:00:00.000+03:00');
          // Begun: its start IS the shop's minute (was: left out, its
          // instant not before the fresh clock's).
          expect((await recent()).map(([name]) => name)).toEqual(['Точен']);
        });

        it("reads the store's tick, not a fresh clock", async () => {
          searchPool = [
            ivanVisit('appointment-ten', '2026-08-05T10:00:00', 30, 'Десет'),
          ];
          TestBed.resetTestingModule();
          await build('2026-08-05T09:59:30.000+03:00');
          // The clock moves on to 10:00:10 before the page opens; the tick
          // has not: the 10:00 visit waits for the next tick (was: listed
          // by the fresh read).
          const clock = TestBed.inject(CLOCK_PORTS) as unknown as {
            nowUtcMs: () => UtcEpochMs;
          };
          clock.nowUtcMs = () => utcMs('2026-08-05T10:00:10.000+03:00');
          expect(await recent()).toEqual([]);
        });

        it('keeps the stamp rule and prints no date while no zone is known (pre-zone pin)', async () => {
          catalogShops = new ReplaySubject<
            PortResult<readonly ShopLocation[], RepositoryError>
          >(1);
          defaultShop = new Promise(() => undefined);
          searchPool = [
            ivanVisit(
              'appointment-morning',
              '2026-08-05T08:00:00',
              30,
              'Сутрин',
            ),
            ivanVisit('appointment-noon', '2026-08-05T12:00:00', 30, 'Обед'),
          ];
          TestBed.resetTestingModule();
          await build('2026-08-05T09:00:00.000+03:00');
          // Its stored instant is before now: listed, as today; the date
          // waits for the zone.
          expect(await recent()).toEqual([['Сутрин', '']]);
        });
      });

      it('measures the catalogue tag on the wall clock across both changeovers (DEP-8)', async () => {
        const tagOf = (id: string) =>
          row(id)?.querySelector('[data-testid="staff-visit-tag"]') ?? null;
        const words = () => {
          TestBed.inject(TranslocoService).setTranslation(
            { 'staff.visit.minutes': '{{minutes}} мин' },
            'bg',
            { merge: true },
          );
          fixture.detectChanges();
        };
        // A fade sold for 30 against the catalogue's 45 — the tag shows
        // where it is due, so its absence below is a verdict.
        const fadeOn = (day: string) =>
          visitOf(`appointment-fade-${day}`, [
            seatAt({
              chair: 'ivan',
              startsAt: `${day}T14:00:00`,
              serviceId: 'fade',
              occupant: accountOf(freshId('user'), SubjectRelationship.Self),
            }),
          ]);
        // Spring forward: 02:30–04:30 booked for 120 runs 120 on the wall
        // clock — no tag (was «−60 мин»: 60 elapsed minutes).
        const spring = ivanVisit(
          'appointment-spring',
          `${SPRING_FORWARD}T02:30:00`,
          120,
        );
        await buildWith(
          new Map([['ivan', [spring, fadeOn(SPRING_FORWARD)]]]),
          `${SPRING_FORWARD}T12:00:00.000+03:00`,
        );
        words();
        expect(row('appointment-spring')).not.toBeNull();
        expect(tagOf('appointment-spring')).toBeNull();
        expect(
          tagOf(`appointment-fade-${SPRING_FORWARD}`)?.textContent?.trim(),
        ).toBe('−15 мин');
        // Fall back: 03:30–04:30 booked for 60 — no tag (was «+60 мин»).
        const fall = ivanVisit('appointment-fall', `${FALL_BACK}T03:30:00`, 60);
        await buildWith(
          new Map([['ivan', [fall, fadeOn(FALL_BACK)]]]),
          `${FALL_BACK}T12:00:00.000+02:00`,
        );
        words();
        expect(row('appointment-fall')).not.toBeNull();
        expect(tagOf('appointment-fall')).toBeNull();
        expect(
          tagOf(`appointment-fade-${FALL_BACK}`)?.textContent?.trim(),
        ).toBe('−15 мин');
      });

      it("seeds the block sheet with the block's own end across both changeovers (DEP-9)", async () => {
        await roundTheClock(wallAt(0), async () => {
          for (const day of [FALL_BACK, SPRING_FORWARD]) {
            seededExceptions = [];
            blockOn(day, wallAt(2), until(5));
            await buildWith(new Map(), `${day}T12:00:00.000+03:00`);
            page().openBlock(`block:ivan:${day}:120`);
            // 02:00–05:00, as stored (was 06:00 on the 25th of October and
            // 04:00 on the 29th of March — the start plus elapsed time).
            expect(page().blockEdit()).toEqual(
              expect.objectContaining({ startMinute: 120, endMinute: 300 }),
            );
          }
        });
      });

      it('draws and labels a roster window from inside the spring-forward gap at its own minute (DEP-10)', async () => {
        await roundTheClock(wallAt(3, 30), async () => {
          await buildWith(new Map(), `${SPRING_FORWARD}T12:00:00.000+03:00`);
          page().store.setView(StaffView.Day);
          fixture.detectChanges();
          // 03:30, as rostered (was 04:00 — the gap's end the instant walk
          // landed on).
          expect(page().gridColumns()[0]?.open[0]?.startMinute).toBe(210);
          expect(page().rosterExtent().start).toBe(210);
          const hole = page()
            .lanes()
            .flatMap((lane) => lane.entries)
            .find((entry) => entry['startMinutes'] === 210);
          expect(hole?.['startLabel']).toBe('03:30');
        });
      });

      it("keys a block by its chair, day and minute, and opens only the shown day's (DEP-11)", async () => {
        blockOn('2026-08-05', wallAt(12), until(13));
        blockOn('2026-08-06', wallAt(12), until(13));
        await buildWith(new Map(), '2026-08-05T09:00:00.000+03:00');
        page().store.setView(StaffView.Week);
        fixture.detectChanges();
        const ids = page()
          .gridColumns()
          .flatMap((column) => column.events.map((event) => event.id));
        expect(ids).toContain('block:ivan:2026-08-05:720');
        expect(ids).toContain('block:ivan:2026-08-06:720');
        // A block of ANOTHER day of the week, at the same chair and minute
        // as one on the shown day, opens nothing — as before.
        page().openBlock('block:ivan:2026-08-06:720');
        expect(page().blockEdit()).toBeNull();
        // The shown day's opens, found by its minutes.
        page().openBlock('block:ivan:2026-08-05:720');
        expect(page().blockEdit()).toEqual(
          expect.objectContaining({ startMinute: 720, endMinute: 780 }),
        );
      });

      it('counts down to a chair at a shop of another zone from its STORED instant (DEP-12)', async () => {
        const now = utcMs('2026-08-05T09:00:00.000+03:00');
        // London's 10:00 is 09:00 UTC — three hours out (was one: the
        // Sofia reading of 10:00).
        const london = inLondon(
          ivanVisit('appointment-london', '2026-08-05T10:00:00'),
        );
        catalogShops = of(PortResult.ok([SHOP_LOCATION, LONDON_LOCATION]));
        await buildWith(
          new Map([['ivan', [london]]]),
          '2026-08-05T09:00:00.000+03:00',
        );
        const entry = page()
          .lanes()
          .flatMap((lane) => lane.entries)
          .find((candidate) => candidate.id === 'appointment-london#ivan');
        expect(entry?.['startUtcMs']).toBe(london.utcEpochMs);
        expect(page().whenLabel(entry)).toBe(
          relativeTime(london.utcEpochMs, now, 'bg', 'short'),
        );
        expect(page().whenLabel(entry)).not.toBe(
          relativeTime(
            wall('2026-08-05T10:00:00').utcEpochMs,
            now,
            'bg',
            'short',
          ),
        );
      });
    });
  });
});
