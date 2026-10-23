import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Translation } from '@jsverse/transloco';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPOINTMENT_READ_PORTS,
  CATALOG_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { type AppointmentReadPorts, Callables } from '@core/ports';
import type { Appointment, ShopLocation } from '@core/entities';
import {
  type BookingCall,
  BookingFlowStep,
  DayHours,
  E164,
  ScheduleSelection,
  Seat,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BookingErrorCode,
  BusyKey,
  CustomerId,
  LocalDate,
  LocationId,
  MoveErrorCode,
  PipelineError,
  PipelineErrorCode,
  Result,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  at as minuteAt,
  endMinute,
  localDate,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  minute,
  scriptedGatewayPorts,
  seatFixture,
  termsFixture,
  unwrapOk,
  until,
} from '@core/testing';
import { UiMap, type UiMapPin } from '@creativo/ui/controls';
import {
  bookingPortProviders,
  provideBookingTestI18n,
  signedIn,
} from '../../testing/booking-shell.rig';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingChromeService } from '../chrome/booking-chrome.service';
import { BookingReviewStep } from './booking-review-step';

const CARRIED = MoveErrorCode.CarriedSeatUnplaceable;

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
    [BookingErrorCode.CallFailed]: 'COPY:gateway-failed',
    [BookingErrorCode.InvalidInput]: 'COPY:invalid-input',
    [`${BookingErrorCode.InvalidInput}.person_overlap`]: 'COPY:person-overlap',
    [CARRIED]: 'COPY:carried-generic {{reach}}',
    [`${CARRIED}.barber_unavailable`]: 'COPY:carried-barber-busy {{reach}}',
  },
};

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
    id: LocationId.of('loc-center'),
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
      barberId: BarberId.of('ivan'),
      startMinutes: minuteAt(10),
      terms,
      occupant: account('client-1', SubjectRelationship.Self),
    }),
    seatFixture({
      seatId: SeatId.of('seat-son'),
      serviceId: ServiceId.of('svc-fade'),
      barberId: BarberId.of(son.barberId),
      startMinutes: minuteAt(0, son.startMinutes),
      terms,
      occupant: account('client-son', SubjectRelationship.Companion),
    }),
  ];
  const barberIds = [...new Set(seats.map((seat) => seat.barberId))];
  return appointmentFixture({
    id: AppointmentId.of('appt-moving'),
    locationId: LocationId.of('loc-center'),
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
interface Visits {
  /** Replace the stored visit (staff changed it since the landing). */
  store(visit: Appointment): void;
  reads(): number;
  ports(): AppointmentReadPorts;
}

function visits(): Visits {
  /** What is stored — the double reads this array by reference. */
  const stored: Appointment[] = [fatherAndSon()];
  let reads = 0;
  return {
    store: (visit) => {
      stored.splice(0, stored.length, visit);
    },
    reads: () => reads,
    ports: () => {
      const base = memoryAppointmentReadPorts(stored);
      return {
        ...base,
        observeAppointment: (id) => {
          reads += 1;
          return base.observeAppointment(id);
        },
      };
    },
  };
}

/** What the server answers the move with — the spec's to choose. */
interface Server {
  answer: Result<BookingCall.Rescheduled, PipelineError>;
}

function server(): Server {
  return {
    answer: Result.ok({ appointmentId: AppointmentId.of('appt-moving') }),
  };
}

/** A carried seat refused for `refusal`, as the wire classifies it. */
function carried(refusal: string, status = 'failed-precondition') {
  return Result.err(
    PipelineError.fromWire(status, {
      errorCode: CARRIED,
      refusal,
      seatIds: ['seat-son'],
    }),
  );
}

async function render(
  gateway: Server,
  locations: readonly ShopLocation[] = [centerShop()],
  appointments: Visits = visits(),
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
      ...provideBookingTestI18n(COPY),
      ...bookingPortProviders({
        // Signed in: Confirm is a commit, not a sign-in round trip.
        principal: signedIn('client-1'),
        gateway: scriptedGatewayPorts({
          [Callables.RescheduleAppointment]: () => gateway.answer,
        }),
      }),
      // Both are the shell's, component-scoped there; the step alone needs
      // them from somewhere.
      BookingFlowStore,
      BookingChromeService,
      { provide: APPOINTMENT_READ_PORTS, useValue: appointments.ports() },
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ locations }),
      },
    ],
  }).compileComponents();

  // The flow the way a move reaches review: the visit landed, a new time
  // armed — Ivan at 14:00 for the booker's one line.
  const store = TestBed.inject(BookingFlowStore);
  store.claim(UserId.of('client-1'));
  store.rescheduleFrom(fatherAndSon(), (ordinal) => `Guest ${ordinal}`);
  const day = localDate('2026-08-20');
  const center = LocationId.of('loc-center');
  store.selectDay(day);
  store.selectStart(minute(14 * 60), center);
  const selection = ScheduleSelection.of(
    center,
    day,
    (store.cart()?.cartSeats ?? [])
      .flatMap((seat) => seat.lines)
      .map((line) => ({
        lineId: line.lineId,
        barberId: BarberId.of('ivan'),
        startMinutes: minute(14 * 60),
        endMinutes: endMinute(15 * 60),
      })),
  );
  if (selection === null) throw new Error('fixture setup failed');
  store.selectSchedule(selection);

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
  let gateway: Server;

  beforeEach(() => {
    TestBed.resetTestingModule();
    gateway = server();
  });

  it('shows who the server carries with the visit — the son, on his own barber, at his new minute', async () => {
    const { fixture, store } = await render(gateway);

    expect(store.step()).toBe(BookingFlowStep.Review);
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
    // Built by hand on purpose: on the wire a busy barber is a lost slot
    // (`PipelineError.fromWire`, below), so only a refusal that STAYS on
    // review can show how its own words read.
    gateway.answer = Result.err(
      PipelineError.of(
        PipelineErrorCode.InvalidRequest,
        CARRIED,
        'barber_unavailable',
        null,
      ),
    );
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    // Still on review: another time is the chrome's back chevron, and the
    // copy says so before it offers the call.
    expect(store.step()).toBe(BookingFlowStep.Review);
    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:carried-barber-busy REACH:call',
    );
    expect(query(fixture, 'booking-review-call')?.getAttribute('href')).toBe(
      'tel:+359881234567',
    );
  });

  it('sends a companion’s chair lost to a race back to a FRESH grid, like any lost slot', async () => {
    // The wire reads a carried seat's busy barber as a lost slot
    // (`PipelineError.fromWire`): the grid only offered chairs that were
    // free, so somebody took it since.
    gateway.answer = carried('barber_unavailable');
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    // Back one step with the day kept and the time dropped, exactly as for
    // the client's own slot; the schedule step says it with the lost-slot
    // copy (`store.slotTaken`).
    expect(store.step()).toBe(BookingFlowStep.Schedule);
    expect(store.slotTaken()).toBe(true);
    expect(store.selectedStartMinutes()).toBeNull();
    expect(store.selectedLocalDate()).toBe('2026-08-20');
    expect(store.isRescheduling()).toBe(true);
  });

  it('re-reads the visit before that fresh grid — facts gone stale would offer the refused time straight back', async () => {
    gateway.answer = carried('barber_unavailable');
    const appointments = visits();
    const { fixture, store } = await render(
      gateway,
      [centerShop()],
      appointments,
    );
    // Since the landing, staff re-seated the son: Niko, at 10:30.
    appointments.store(
      fatherAndSon({
        barberId: 'niko',
        startMinutes: 10 * 60 + 30,
      }),
    );

    await confirm(fixture);

    expect(appointments.reads()).toBe(1);
    expect(store.step()).toBe(BookingFlowStep.Schedule);
    // The grid it bounces to checks the son where he now sits, and no longer
    // hands back Petar's 10:00 chair, which is somebody else's now.
    expect(
      store.moveRiders().map((rider) => [rider.barberId, rider.offsetMinutes]),
    ).toEqual([['niko', 30]]);
    expect(store.moveRelease().map((chair) => chair.barberId)).toEqual([
      'ivan',
      'niko',
    ]);
  });

  it('never re-reads for a refusal that stays on review', async () => {
    gateway.answer = carried('service_unavailable');
    const appointments = visits();
    const { fixture, store } = await render(
      gateway,
      [centerShop()],
      appointments,
    );

    await confirm(fixture);

    expect(store.step()).toBe(BookingFlowStep.Review);
    expect(appointments.reads()).toBe(0);
  });

  it('falls back to the refusal’s general copy for a reason the catalogue does not know yet', async () => {
    gateway.answer = carried('a_reason_from_a_newer_server');
    const { fixture } = await render(gateway);

    await confirm(fixture);

    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:carried-generic REACH:call',
    );
    expect(query(fixture, 'booking-review-call')).not.toBeNull();
  });

  it('offers no call it cannot place — the catalogue does not know the shop', async () => {
    gateway.answer = Result.err(
      PipelineError.of(
        PipelineErrorCode.InvalidRequest,
        CARRIED,
        'barber_unavailable',
        null,
      ),
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
    gateway.answer = Result.err(
      PipelineError.fromWire('invalid-argument', {
        errorCode: BookingErrorCode.InvalidInput,
        field: 'person_overlap',
      }),
    );
    const { fixture, store } = await render(gateway);

    await confirm(fixture);

    expect(store.step()).toBe(BookingFlowStep.Review);
    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:person-overlap',
    );
    expect(query(fixture, 'booking-review-call')).toBeNull();
  });

  it('offers no call for an ordinary failure — only a carried seat is the shop’s to sort out', async () => {
    gateway.answer = Result.err(
      PipelineError.bare(PipelineErrorCode.InvalidRequest),
    );
    const { fixture } = await render(gateway);

    await confirm(fixture);

    expect(query(fixture, 'booking-review-error')?.textContent?.trim()).toBe(
      'COPY:gateway-failed',
    );
    expect(query(fixture, 'booking-review-call')).toBeNull();
  });
});

/*
 * THE TIME, ON THE SHOP'S WALL CLOCK. The review step formats the selection
 * as it stands — the shop day and its minutes — and never reads a zone or
 * the device's calendar to do it; "this year" is the shop's, from the
 * pinned clock. The characters are today's (R7).
 */
describe('BookingReviewStep — the day and the window, on the shop’s wall clock', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function text(
    fixture: ComponentFixture<BookingReviewStep>,
    testId: string,
  ): string {
    return (query(fixture, testId)?.textContent ?? '').replace(/\s+/g, ' ');
  }

  it('says the day and the window the party comes for', async () => {
    const { fixture } = await render(server());

    expect(text(fixture, 'booking-review-time')).toContain(
      'четвъртък, 20 август',
    );
    expect(text(fixture, 'booking-review-time')).toContain('14:00 – 15:00');
  });

  it('names the month alone this year, and with its year in another', async () => {
    const { fixture, store } = await render(server());
    expect(text(fixture, 'booking-review-when')).toContain('Август');
    expect(text(fixture, 'booking-review-when')).not.toContain('2026');

    // Back to the grid, and a day next January instead.
    store.back();
    const day = localDate('2027-01-05');
    const center = LocationId.of('loc-center');
    store.selectDay(day);
    store.selectStart(minute(14 * 60), center);
    const selection = ScheduleSelection.of(
      center,
      day,
      (store.cart()?.cartSeats ?? [])
        .flatMap((seat) => seat.lines)
        .map((line) => ({
          lineId: line.lineId,
          barberId: BarberId.of('ivan'),
          startMinutes: minute(14 * 60),
          endMinutes: endMinute(15 * 60),
        })),
    );
    if (selection === null) throw new Error('fixture setup failed');
    store.selectSchedule(selection);
    fixture.detectChanges();

    expect(text(fixture, 'booking-review-when')).toContain('Януари 2027 г.');
  });
});
