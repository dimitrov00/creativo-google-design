import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  PrincipalId,
  activePrincipal,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  AppointmentRepository,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  BookingPolicy,
  BookingGateway,
  BookingGatewayError,
  Result,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
  fail,
  ok,
} from '@creativo/application/booking';
import { NOTIFICATION_READER } from '@creativo/application/notifications';
import { CATALOG_READER, MEDIA_READER } from '@creativo/application/catalog';
import { AccountStateService } from '@creativo/features/client/account-state';
import { ClientAppointments } from './client-appointments';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const PRINCIPAL_ID = unwrap(PrincipalId.create('user_1'));
const PRINCIPAL = unwrap(
  activePrincipal(PRINCIPAL_ID, [roleFromPrimitive('client')]),
);

function appointment(
  id: string,
  startIso: string,
  status: Appointment['status'] = { kind: 'confirmed' },
): Appointment {
  const start = unwrap(ZonedDateTime.fromISO(startIso, 'Europe/Sofia'));
  const end = start.plusMinutes(30);
  const timeSlot = unwrap(
    TimeSlot.create({ startIso, endIso: end.toISO(), zone: 'Europe/Sofia' }),
  );
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat_1')),
    subject: SeatSubject.account(unwrap(UserId.create('user_1')), 'self'),
    serviceId: unwrap(ServiceId.create('service_1')),
    variantId: null,
    barberId: unwrap(BarberId.create('barber_1')),
    terms: unwrap(ServiceTerms.fromMinorUnits(1500, 'EUR', 30)),
    startsAt: timeSlot.start,
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      locationId: 'location_1',
      seats: [seat],
      status,
    }),
  );
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

function accountStateStub(): AccountStateService {
  return {
    principal: signal(PRINCIPAL),
    claims: signal(PRINCIPAL.kind === 'active' ? PRINCIPAL.roles : null),
    account: signal(null),
    accountLoading: signal(false),
  } as unknown as AccountStateService;
}

function repositoryStub(
  upcoming: readonly Appointment[],
  history: readonly Appointment[] = [],
): AppointmentRepository {
  return {
    findById: async () => ok(upcoming[0] ?? null),
    save: async () =>
      fail(new RepositoryError('appointments are written server-side')),
    observeUpcomingFor: () => of(ok(upcoming)),
    observeHistoryFor: () => of(ok(history)),
  };
}

async function configure(
  upcoming: readonly Appointment[],
  cancelBehavior: BookingGateway['cancel'] = async () => ok(undefined),
  history: readonly Appointment[] = [],
): Promise<ComponentFixture<ClientAppointments>> {
  await TestBed.configureTestingModule({
    imports: [ClientAppointments],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: AccountStateService, useValue: accountStateStub() },
      {
        // The shell menu's notifications row reads the inbox.
        provide: NOTIFICATION_READER,
        useValue: {
          list: () => of(ok([])),
          markRead: async () => ok(undefined),
          markAllRead: async () => ok(undefined),
        },
      },
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: repositoryStub(upcoming, history),
      },
      {
        // A row names its service and shows its barber's face — both come
        // from the catalog. An EMPTY catalog is the honest stub here: the
        // row must still render (with its fallback title) when the service
        // it names has since been retired.
        provide: CATALOG_READER,
        useValue: {
          listActiveServices: () => of(ok([])),
          listActiveBarbers: () => of(ok([])),
          listServiceCategories: () => of(ok([])),
          listActiveLocations: () => of(ok([])),
          findServiceById: async () => ok(null),
          findBarberById: async () => ok(null),
          findLocationById: async () => ok(null),
        },
      },
      {
        provide: MEDIA_READER,
        useValue: { resolve: async () => ok([]) },
      },
      {
        // Cancellation is the CALLABLE's job now; the repository refuses
        // writes on the client by design.
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: async () => {
            throw new Error('not used in this spec');
          },
          cancel: cancelBehavior,
        },
      },
      {
        provide: BOOKING_POLICY_READER,
        useValue: { observe: () => of(BookingPolicy.default()) },
      },
      {
        provide: CLOCK,
        useValue: { now: (zone: string) => ZonedDateTime.now(zone) },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(ClientAppointments);
}

describe('ClientAppointments', () => {
  /** Settle the two live listeners and the first render. */
  async function render(fixture: ComponentFixture<ClientAppointments>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function click(host: HTMLElement, testId: string): void {
    (
      host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
    )?.click();
  }

  /** Open a visit — the row is the only way in, and the sheet is where the
   *  cancel action and the window copy live. */
  async function openFirstVisit(
    fixture: ComponentFixture<ClientAppointments>,
    host: HTMLElement,
  ): Promise<void> {
    click(host, 'appointment-row');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the empty state when there is nothing to show', async () => {
    const fixture = await configure([]);
    const host = await render(fixture);

    expect(host.getAttribute('data-state')).toBe('ready');
    expect(
      host.querySelector('[data-testid="appointments-empty"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointments-empty-cta"]'),
    ).not.toBeNull();
    // Nothing to jump to, so no pills at all — an option that leads nowhere
    // is the one thing this row must not have.
    expect(
      host.querySelectorAll('[data-testid="appointments-pill"]').length,
    ).toBe(0);
  });

  it('renders a row per visit and a pill per section that holds one', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', {
          kind: 'completed',
        }),
        appointment('appt_past_2', '2020-06-02T10:00:00', {
          kind: 'completed',
        }),
      ],
    );
    const host = await render(fixture);

    const rows = host.querySelectorAll('[data-testid="appointment-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0]?.getAttribute('data-status')).toBe('confirmed');

    // Upcoming, then one per month that actually holds a visit — July and
    // June, newest first.
    const pills = [
      ...host.querySelectorAll('[data-testid="appointments-pill"]'),
    ];
    expect(pills.length).toBe(3);
    expect(pills.map((pill) => pill.getAttribute('data-section'))).toEqual([
      'upcoming',
      '2020-07',
      '2020-06',
    ]);
  });

  it('counts every visit, upcoming and past', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', {
          kind: 'completed',
        }),
      ],
    );
    const host = await render(fixture);

    expect(
      host.querySelector('[data-testid="appointments-count"]'),
    ).not.toBeNull();
  });

  // The default policy's free-cancellation window is 24h. A visit inside it
  // must not OFFER a cancel the server would refuse — the button goes, and
  // the honest reason takes its place.
  it('hides the cancel button inside the window and explains why', async () => {
    const nowResult = ZonedDateTime.now('Europe/Sofia');
    if (nowResult.isFailure()) throw new Error('unreachable');
    const inTwoHours = nowResult.value.plusMinutes(120).toISO();
    const fixture = await configure([appointment('appt_soon', inTwoHours)]);
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    expect(
      host.querySelector('[data-testid="appointment-cancel-trigger"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="appointment-cancel-window-closed"]'),
    ).not.toBeNull();
  });

  it('shows the free-cancellation deadline while cancelling is still open', async () => {
    const fixture = await configure([
      appointment('appt_far', '2030-06-01T10:00:00'),
    ]);
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    expect(
      host.querySelector('[data-testid="appointment-cancel-trigger"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointment-cancel-deadline"]'),
    ).not.toBeNull();
  });

  it('marks the filter button while it is narrowing, and names the option', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', {
          kind: 'completed',
        }),
        appointment('appt_past_2', '2020-06-02T10:00:00', {
          kind: 'cancelled',
        }),
      ],
    );
    const host = await render(fixture);

    const filterButton = () =>
      host.querySelector('[data-testid="appointments-filter"]');
    expect(filterButton()?.hasAttribute('data-filtering')).toBe(false);

    click(host, 'appointments-filter');
    fixture.detectChanges();
    click(host, 'appointments-filter-cancelled');
    fixture.detectChanges();

    // The dot is CSS; what the DOM has to carry is the state it hangs on —
    // and the accessible name, because a coloured mark says nothing to a
    // screen reader.
    expect(filterButton()?.hasAttribute('data-filtering')).toBe(true);
    expect(filterButton()?.getAttribute('aria-label')).toContain(':');

    const rows = host.querySelectorAll('[data-testid="appointment-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-status')).toBe('cancelled');
    // The pills follow the narrowed list — June is all that is left.
    expect(
      [...host.querySelectorAll('[data-testid="appointments-pill"]')].map(
        (pill) => pill.getAttribute('data-section'),
      ),
    ).toEqual(['2020-06']);
  });

  it('offers the filter back when nothing matches it', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', {
          kind: 'completed',
        }),
      ],
    );
    const host = await render(fixture);

    click(host, 'appointments-filter');
    fixture.detectChanges();
    click(host, 'appointments-filter-no_show');
    fixture.detectChanges();

    // Empty BECAUSE of the funnel: the way out is the filter, not a booking.
    expect(
      host.querySelector('[data-testid="appointments-clear-filter"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointments-empty-cta"]'),
    ).toBeNull();
  });

  it('switches to the calendar view and renders the months a visit falls in', async () => {
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointments-calendar"]'),
    ).not.toBeNull();
    // From today through the month the visit lands in — every month in
    // between, so scrolling never falls off the run.
    expect(
      host.querySelectorAll('[data-testid="appointments-month-label"]').length,
    ).toBeGreaterThan(0);
    expect(
      host.querySelector('[data-testid="appointments-calendar-day"]'),
    ).not.toBeNull();
  });

  it('renders months around TODAY, not merely the ones a visit falls in', async () => {
    // A calendar you cannot scroll past your own history feels broken. The
    // run opens half a year either side of now, whether or not anything
    // happened in those months.
    const fixture = await configure([]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    const months = [...host.querySelectorAll('[data-month-key]')].map((month) =>
      month.getAttribute('data-month-key'),
    );
    expect(months.length).toBe(13);

    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    expect(months).toContain(now.value.toISODate().slice(0, 7));
  });

  it('widens the run to reach a visit outside the default window', async () => {
    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    // Two years back — well outside the six months the calendar opens with,
    // and therefore unreachable unless the window stretches to hold it.
    const longAgo = now.value.plusMinutes(-60 * 24 * 730).toISO();

    const fixture = await configure([], undefined, [
      appointment('appt_ancient', longAgo, { kind: 'completed' }),
    ]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    const months = [...host.querySelectorAll('[data-month-key]')].map((month) =>
      month.getAttribute('data-month-key'),
    );
    expect(months[0]).toBe(longAgo.slice(0, 7));
  });

  it('keeps the today anchor on screen in the calendar view, and only there', async () => {
    const fixture = await configure([]);
    const host = await render(fixture);

    // The list has its own way home — the pills — so the anchor belongs to
    // the calendar alone.
    expect(
      host.querySelector('[data-testid="appointments-scroll-today"]'),
    ).toBeNull();

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // ALWAYS, not "once today scrolls away": a control that comes and goes
    // cannot be reached for without looking, and the booking calendar's own
    // twin is always there.
    expect(
      host.querySelector('[data-testid="appointments-scroll-today"]'),
    ).not.toBeNull();
  });

  it('cancels an own visit through the sheet', async () => {
    const cancelCalls: { appointmentId: string; reason: string }[] = [];
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async (request) => {
        cancelCalls.push(request);
        return ok(undefined);
      },
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="appointment-cancel-sheet"]'),
    ).not.toBeNull();

    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(cancelCalls).toEqual([
      { appointmentId: 'appt_1', reason: 'Cancelled by client.' },
    ]);
  });

  it('shows a translated error when cancellation fails', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () =>
        fail(new BookingGatewayError('unavailable', 'network sneezed')),
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointment-cancel-error"]'),
    ).not.toBeNull();
  });
});
