import {
  Component,
  EnvironmentProviders,
  Injectable,
  input,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_GATEWAY,
  PrincipalId,
  activePrincipal,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import {
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BookingGatewayError,
  type Result,
  TimeSlot,
  WAITLIST_GATEWAY,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/application/booking';
import {
  BarberId,
  LocationId,
  MEDIA_READER,
} from '@creativo/application/catalog';
import { CLOCK } from '@creativo/application/shared';
import {
  APPOINTMENT_READ_PORTS,
  CATALOG_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { AppointmentReadPorts } from '@core/ports';
import type { Appointment, ShopLocation } from '@core/entities';
import {
  DayHours,
  E164,
  Seat,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import {
  AppointmentId,
  BarberId as BarberKey,
  BusyKey,
  CustomerId,
  LocalDate,
  LocationId as LocationKey,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  at as minuteAt,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  seatFixture,
  termsFixture,
  unwrapOk,
  until,
} from '@core/testing';
import { UiMap, type UiMapPin } from '@creativo/ui/controls';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingChromeService } from '../chrome/booking-chrome.service';
import { BookingReviewStep } from './booking-review-step';

const ZONE = 'Europe/Sofia';
const CARRIED = 'booking.reschedule.carried_seat_unplaceable';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const at = (hour: number) =>
  unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 20, hour, minute: 0 },
      ZONE,
    ),
  );

/**
 * Stand-in copy, one sentence per key the review step can choose between —
 * so a spec can tell WHICH key it chose. The shipped wording is pinned by
 * `booking-error-message.spec.ts`, against the real catalogues.
 */
const COPY: Translation = {
  booking: {
    review: { withBarber: 'with {{name}}' },
    reach: { call: 'REACH:call', contact: 'REACH:contact' },
  },
  errors: {
    'booking.gateway.failed': 'COPY:gateway-failed',
    'booking.commit.invalid_input': 'COPY:invalid-input',
    'booking.commit.invalid_input.person_overlap': 'COPY:person-overlap',
    [CARRIED]: 'COPY:carried-generic {{reach}}',
    [`${CARRIED}.barber_unavailable`]: 'COPY:carried-barber-busy {{reach}}',
  },
};

@Injectable()
class InlineTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(COPY);
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
    loader: InlineTranslationLoader,
  });
}

/**
 * The place card's map, inert. jsdom has no WebGL, so the real one only logs
 * its failure to start — and nothing this spec asks is about the map.
 */
// eslint-disable-next-line @angular-eslint/component-selector -- a test double answers to the DS selector it stands in for.
@Component({ selector: 'ui-map', template: '' })
class InertMap {
  readonly uiPins = input<readonly UiMapPin[]>([]);
  readonly uiSelectedPinId = input<string | null>(null);
  readonly uiColorScheme = input<string>('light');
  readonly uiSelectedZoom = input(14);
}

/** The visit's shop, as the catalogue lists it — with a number to dial. */
function centerShop(): ShopLocation {
  const open = DayHours.open(minuteAt(9), until(20));
  return locationFixture({
    id: LocationKey.of('loc-center'),
    name: { en: 'Creativo · Center', bg: 'Креативо · Център' },
    address: { en: '1 Vitosha Blvd', bg: 'бул. Витоша 1' },
    phoneE164: E164.of('+359881234567'),
    phoneDisplay: '+359 88 123 4567',
    mapUrl: 'https://maps.example.com/center',
    openingHours: [open, open, open, open, open, open, DayHours.closed()],
  });
}

/** An account seat's occupant — the uid and the client record beside it (D29). */
function account(uid: string, relationship: SubjectRelationship): SeatOccupant {
  return SeatOccupant.account(
    UserId.of(uid),
    CustomerId.of(`cus_${uid}`),
    relationship,
  );
}

/**
 * The booker at 10:00 with Ivan, and the son the shop seated with Petar —
 * or wherever staff have re-seated him since (`son`, minutes from the shop's
 * midnight) — on 2026-08-20, as stored.
 */
function fatherAndSon(
  son: { readonly barberId: string; readonly startMinutes: number } = {
    barberId: 'petar',
    startMinutes: 10 * 60,
  },
): Appointment {
  const day = unwrapOk(LocalDate.parse('2026-08-20'));
  const terms = Seat.termsOf(termsFixture(2800, 45), termsFixture(2800, 45));
  const seats = [
    seatFixture({
      seatId: SeatId.of('seat-father'),
      serviceId: ServiceId.of('svc-fade'),
      barberId: BarberKey.of('ivan'),
      startMinutes: minuteAt(10),
      terms,
      occupant: account('client-1', SubjectRelationship.Self),
    }),
    seatFixture({
      seatId: SeatId.of('seat-son'),
      serviceId: ServiceId.of('svc-fade'),
      barberId: BarberKey.of(son.barberId),
      startMinutes: minuteAt(0, son.startMinutes),
      terms,
      occupant: account('client-son', SubjectRelationship.Companion),
    }),
  ];
  const barberIds = [...new Set(seats.map((seat) => seat.barberId))];
  return appointmentFixture({
    id: AppointmentId.of('appt-moving'),
    locationId: LocationKey.of('loc-center'),
    ownerUserId: UserId.of('client-1'),
    subjectUserIds: [UserId.of('client-1'), UserId.of('client-son')],
    barberIds,
    busyKeys: barberIds.map((barberId) => BusyKey.of(barberId, day)),
    seats,
    localDate: day,
    startMinutes: minuteAt(10),
    endMinutes: until(
      0,
      Math.max(...seats.map((seat) => Seat.endMinutes(seat))),
    ),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(day, minuteAt(10), FIXTURE_TIME_ZONE),
    ),
  });
}

/** The owner-scoped visit read a move is re-read through. */
class StubAppointments {
  /** What is stored — the double reads this array by reference. */
  private readonly visits: Appointment[] = [fatherAndSon()];
  reads = 0;

  /** Replace the stored visit (staff changed it since the landing). */
  set stored(visit: Appointment) {
    this.visits.splice(0, this.visits.length, visit);
  }

  /** `APPOINTMENT_READ_PORTS` over the stored visit, its reads counted. */
  ports(): AppointmentReadPorts {
    const base = memoryAppointmentReadPorts(this.visits);
    return {
      ...base,
      observeAppointment: (id) => {
        this.reads += 1;
        return base.observeAppointment(id);
      },
    };
  }
}

/** What the server answers the move with — the spec's to choose. */
class StubGateway {
  answer: Result<{ appointmentId: string }, BookingGatewayError> = ok({
    appointmentId: 'appt-moving',
  });
  async reschedule(): Promise<
    Result<{ appointmentId: string }, BookingGatewayError>
  > {
    return this.answer;
  }
}

async function render(
  gateway: StubGateway,
  locations: readonly ShopLocation[] = [centerShop()],
  appointments: StubAppointments = new StubAppointments(),
): Promise<{
  fixture: ComponentFixture<BookingReviewStep>;
  store: BookingFlowStore;
}> {
  TestBed.overrideComponent(BookingReviewStep, {
    remove: { imports: [UiMap] },
    add: { imports: [InertMap] },
  });
  await TestBed.configureTestingModule({
    imports: [BookingReviewStep],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      // Both are the shell's, component-scoped there; the step alone needs
      // them from somewhere.
      BookingFlowStore,
      BookingChromeService,
      {
        provide: BOOKING_DRAFT_STORE,
        useValue: {
          load: () => ok(null),
          save: () => ok(undefined),
          clear: () => ok(undefined),
        },
      },
      { provide: BOOKING_GATEWAY, useValue: gateway },
      { provide: APPOINTMENT_READ_PORTS, useValue: appointments.ports() },
      {
        provide: WAITLIST_GATEWAY,
        useValue: {
          request: () => Promise.reject(new Error('not used in this spec')),
          cancel: () => Promise.reject(new Error('not used in this spec')),
        },
      },
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) =>
            ZonedDateTime.fromISO('2026-08-03T09:00:00.000+03:00', zone),
        },
      },
      {
        // Signed in: Confirm is a commit, not a sign-in round trip.
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () =>
            of(
              unwrap(
                activePrincipal(unwrap(PrincipalId.create('client-1')), [
                  roleFromPrimitive('client'),
                ]),
              ),
            ),
          refreshToken: () => Promise.resolve(ok(undefined)),
          signOut: () => Promise.resolve(ok(undefined)),
          currentDisplayName: () => null,
          currentIdentifier: () => null,
        },
      },
      {
        provide: PROFILE_PORT,
        useValue: {
          getProfile: () => Promise.resolve(ok(null)),
          observeProfile: () => of(ok(null)),
        },
      },
      {
        provide: AVATAR_UPLOADER,
        useValue: {
          upload: () => Promise.resolve(ok({ url: 'x', path: 'x' })),
          find: () => Promise.resolve(ok(null)),
          remove: () => Promise.resolve(ok(undefined)),
        },
      },
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ locations }),
      },
      {
        provide: MEDIA_READER,
        useValue: { resolve: () => Promise.resolve(ok([])) },
      },
    ],
  }).compileComponents();

  // The flow the way a move reaches review: the visit landed, a new time
  // armed — Ivan at 14:00 for the booker's one line.
  const store = TestBed.inject(BookingFlowStore);
  store.claim('client-1');
  store.rescheduleFrom(fatherAndSon(), (ordinal) => `Guest ${ordinal}`);
  const slot = unwrap(TimeSlot.of(at(14), at(15)));
  store.selectDay('2026-08-20', ZONE);
  store.selectStart(at(14).toMillis(), 'loc-center');
  store.selectSchedule({
    locationId: unwrap(LocationId.create('loc-center')),
    timeSlot: slot,
    assignments: (store.cart()?.entries() ?? [])
      .flatMap(([, lines]) => lines)
      .map((line) => ({
        lineId: line.id,
        barberId: unwrap(BarberId.create('ivan')),
        slot,
      })),
  });

  const fixture = TestBed.createComponent(BookingReviewStep);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, store };
}

function query(
  fixture: ComponentFixture<BookingReviewStep>,
  testId: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    `[data-testid="${testId}"]`,
  );
}

async function confirm(
  fixture: ComponentFixture<BookingReviewStep>,
): Promise<void> {
  query(fixture, 'booking-review-confirm')?.click();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

describe('BookingReviewStep — a move somebody on the visit cannot follow', () => {
  let gateway: StubGateway;

  beforeEach(() => {
    TestBed.resetTestingModule();
    gateway = new StubGateway();
  });

  it('shows who the server carries with the visit — the son, on his own barber, at his new minute', async () => {
    const { fixture, store } = await render(gateway);

    expect(store.step()).toBe('review');
    const riders = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="booking-review-rider"]',
    );
    expect(riders).toHaveLength(1);
    // Side by side with the booker, so he moves to the booker's 14:00.
    // The catalogue does not list Petar, so the id stands in for his name.
    expect(riders[0]?.textContent).toContain('with petar');
    expect(riders[0]?.textContent).toContain('14:00');
  });

  it('says why in the refusal’s OWN words and puts the shop one tap away', async () => {
    gateway.answer = fail(
      new BookingGatewayError('unknown', 'refused', {
        serverCode: CARRIED,
        refusal: 'barber_unavailable',
      }),
    );
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    // Still on review: another time is the chrome's back chevron, and the
    // copy says so before it offers the call.
    expect(store.step()).toBe('review');
    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:carried-barber-busy REACH:call',
    );
    expect(query(fixture, 'booking-review-call')?.getAttribute('href')).toBe(
      'tel:+359881234567',
    );
  });

  it('sends a companion’s chair lost to a race back to a FRESH grid, like any lost slot', async () => {
    // The gateway reads a carried seat's busy barber as `slot_unavailable`:
    // the grid only offered chairs that were free, so somebody took it since.
    gateway.answer = fail(
      new BookingGatewayError('slot_unavailable', 'taken', {
        serverCode: CARRIED,
        refusal: 'barber_unavailable',
      }),
    );
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    // Back one step with the day kept and the time dropped, exactly as for
    // the client's own slot; the schedule step says it with the lost-slot
    // copy (`store.slotTaken`).
    expect(store.step()).toBe('schedule');
    expect(store.slotTaken()).toBe(true);
    expect(store.selectedStartMs()).toBeNull();
    expect(store.selectedDayKey()).toBe('2026-08-20');
    expect(store.isRescheduling()).toBe(true);
  });

  it('re-reads the visit before that fresh grid — facts gone stale would offer the refused time straight back', async () => {
    gateway.answer = fail(
      new BookingGatewayError('slot_unavailable', 'taken', {
        serverCode: CARRIED,
        refusal: 'barber_unavailable',
      }),
    );
    const appointments = new StubAppointments();
    const { fixture, store } = await render(
      gateway,
      [centerShop()],
      appointments,
    );
    // Since the landing, staff re-seated the son: Niko, at 10:30.
    appointments.stored = fatherAndSon({
      barberId: 'niko',
      startMinutes: 10 * 60 + 30,
    });

    await confirm(fixture);

    expect(appointments.reads).toBe(1);
    expect(store.step()).toBe('schedule');
    // The grid it bounces to checks the son where he now sits, and no longer
    // hands back Petar's 10:00 chair, which is somebody else's now.
    expect(
      store.riders().map((rider) => [rider.barberId, rider.offsetMinutes]),
    ).toEqual([['niko', 30]]);
    expect(store.moveRelease().map((chair) => chair.barberId)).toEqual([
      'ivan',
      'niko',
    ]);
  });

  it('never re-reads for a refusal that stays on review', async () => {
    gateway.answer = fail(
      new BookingGatewayError('unknown', 'refused', {
        serverCode: CARRIED,
        refusal: 'service_unavailable',
      }),
    );
    const appointments = new StubAppointments();
    const { fixture, store } = await render(
      gateway,
      [centerShop()],
      appointments,
    );

    await confirm(fixture);

    expect(store.step()).toBe('review');
    expect(appointments.reads).toBe(0);
  });

  it('falls back to the refusal’s general copy for a reason the catalogue does not know yet', async () => {
    gateway.answer = fail(
      new BookingGatewayError('unknown', 'refused', {
        serverCode: CARRIED,
        refusal: 'a_reason_from_a_newer_server',
      }),
    );
    const { fixture } = await render(gateway);

    await confirm(fixture);

    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:carried-generic REACH:call',
    );
    expect(query(fixture, 'booking-review-call')).not.toBeNull();
  });

  it('offers no call it cannot place — the catalogue does not know the shop', async () => {
    gateway.answer = fail(
      new BookingGatewayError('unknown', 'refused', {
        serverCode: CARRIED,
        refusal: 'barber_unavailable',
      }),
    );
    const { fixture } = await render(gateway, []);

    await confirm(fixture);

    // …and SAYS none: the copy sends the client to the shop without
    // promising a button the page does not have.
    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:carried-barber-busy REACH:contact',
    );
    expect(query(fixture, 'booking-review-call')).toBeNull();
  });

  it('names one person in two chairs in its own words — the reason the server’s field carries', async () => {
    gateway.answer = fail(
      new BookingGatewayError('invalid_request', 'refused', {
        serverCode: 'booking.commit.invalid_input',
        field: 'person_overlap',
      }),
    );
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    expect(store.step()).toBe('review');
    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:person-overlap',
    );
    expect(query(fixture, 'booking-review-call')).toBeNull();
  });

  it('offers no call for an ordinary failure — only a carried seat is the shop’s to sort out', async () => {
    gateway.answer = fail(
      new BookingGatewayError('invalid_request', 'The bag changed'),
    );
    const { fixture } = await render(gateway);

    await confirm(fixture);

    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:gateway-failed',
    );
    expect(query(fixture, 'booking-review-call')).toBeNull();
  });
});
