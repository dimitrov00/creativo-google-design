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
import { User, UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  AUTH_GATEWAY,
  PrincipalId,
  Result,
  activePrincipal,
  ok,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/application/booking';
import { AccountStateService } from '@creativo/features/client/account-state';
import { ClientAccount } from './client-account';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));
const PRINCIPAL_ID = unwrap(PrincipalId.create('user_1'));
const PRINCIPAL = unwrap(
  activePrincipal(PRINCIPAL_ID, [roleFromPrimitive('client')]),
);

function user(): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
      },
      TODAY,
    ),
  );
}

function appointment(): Appointment {
  const timeSlot = unwrap(
    TimeSlot.create({
      startIso: '2030-01-01T10:00:00',
      endIso: '2030-01-01T10:30:00',
      zone: 'Europe/Sofia',
    }),
  );
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat_1')),
    subject: SeatSubject.account(unwrap(UserId.create('user_1')), 'self'),
    serviceId: unwrap(ServiceId.create('service_1')),
  });
  return unwrap(
    Appointment.reconstitute({
      id: 'appt_1',
      barberId: 'barber_1',
      locationId: 'location_1',
      timeSlot,
      seats: [seat],
      status: { kind: 'confirmed' },
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
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

function accountStateStub(options: {
  accountLoading: boolean;
  account: User | null;
}): AccountStateService {
  return {
    principal: signal(PRINCIPAL),
    claims: signal(PRINCIPAL.kind === 'active' ? PRINCIPAL.roles : null),
    account: signal(options.account),
    accountLoading: signal(options.accountLoading),
  } as unknown as AccountStateService;
}

async function configure(
  accountState: AccountStateService,
  upcoming: readonly Appointment[],
): Promise<ComponentFixture<ClientAccount>> {
  await TestBed.configureTestingModule({
    imports: [ClientAccount],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: AccountStateService, useValue: accountState },
      {
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(PRINCIPAL),
          refreshToken: () => Promise.resolve(ok(undefined)),
          signOut: () => Promise.resolve(ok(undefined)),
        },
      },
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: {
          observeUpcomingFor: () => of(ok(upcoming)),
        },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(ClientAccount);
}

describe('ClientAccount', () => {
  it('shows skeletons while the account snapshot is loading', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: true, account: null }),
      [],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-state')).toBe('loading');
    expect(
      host.querySelector('[data-testid="account-skeleton"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="account-tiles"]')).toBeNull();
  });

  it('renders the honest empty state when there is no upcoming appointment', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-state')).toBe('ready');
    expect(
      host.querySelector('[data-testid="account-tile-book"]'),
    ).not.toBeNull();

    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('empty');
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).not.toBeNull();

    const birthday = host.querySelector(
      '[data-testid="account-completion-birthday"]',
    );
    expect(birthday?.getAttribute('data-done')).toBe('false');
  });

  it('renders the upcoming appointment once one is live', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment()],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('populated');
    expect(upcoming?.textContent).toContain('confirmed');
  });
});
