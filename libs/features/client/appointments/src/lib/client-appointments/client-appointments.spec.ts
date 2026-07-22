import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { ServiceId } from '@creativo/application/catalog';
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
  Result,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
  fail,
  ok,
} from '@creativo/application/booking';
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
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      barberId: 'barber_1',
      locationId: 'location_1',
      timeSlot,
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
  cancelBehavior: AppointmentRepository['save'] = async () => ok(undefined),
): AppointmentRepository {
  return {
    findById: async () => ok(upcoming[0] ?? null),
    save: cancelBehavior,
    observeUpcomingFor: () => of(ok(upcoming)),
  };
}

async function configure(
  upcoming: readonly Appointment[],
  cancelBehavior?: AppointmentRepository['save'],
): Promise<ComponentFixture<ClientAppointments>> {
  await TestBed.configureTestingModule({
    imports: [ClientAppointments],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: AccountStateService, useValue: accountStateStub() },
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: repositoryStub(upcoming, cancelBehavior),
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
  it('shows the empty state when there are no upcoming appointments', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-state')).toBe('ready');
    const list = host.querySelector('[data-testid="appointments-list"]');
    expect(list?.getAttribute('data-state')).toBe('empty');
    expect(
      host.querySelector('[data-testid="appointments-empty-cta"]'),
    ).not.toBeNull();
  });

  it('renders one row per upcoming appointment, grouped by day', async () => {
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="appointments-list"]');
    expect(list?.getAttribute('data-state')).toBe('populated');
    const rows = host.querySelectorAll('[data-testid="appointment-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-status')).toBe('confirmed');
    expect(
      host.querySelector('[data-testid="appointment-cancel-trigger"]'),
    ).not.toBeNull();
  });

  it('switches to the calendar view and supports month navigation', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="appointments-view-calendar"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointments-calendar"]'),
    ).not.toBeNull();
    const monthLabelBefore = host.querySelector(
      '[data-testid="appointments-calendar-month-label"]',
    )?.textContent;

    (
      host.querySelector(
        '[data-testid="appointments-calendar-next"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const monthLabelAfter = host.querySelector(
      '[data-testid="appointments-calendar-month-label"]',
    )?.textContent;
    expect(monthLabelAfter).not.toBe(monthLabelBefore);
  });

  it('cancels an own appointment through the confirm sheet', async () => {
    const saveCalls: Appointment[] = [];
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async (a: Appointment) => {
        saveCalls.push(a);
        return ok(undefined);
      },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="appointment-cancel-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      host
        .querySelector('[data-testid="appointment-cancel-sheet"]')
        ?.getAttribute('data-open'),
    ).toBe('');

    (
      host.querySelector(
        '[data-testid="appointment-cancel-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.status.kind).toBe('cancelled');
  });

  it('shows a translated error when cancellation fails', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () => fail(new RepositoryError('boom', new Error('boom'))),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="appointment-cancel-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host.querySelector(
        '[data-testid="appointment-cancel-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointment-cancel-error"]'),
    ).not.toBeNull();
  });
});
