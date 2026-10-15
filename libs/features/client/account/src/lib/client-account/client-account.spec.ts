import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { NEVER, Observable, of } from 'rxjs';
import {
  AVATAR_UPLOADER,
  AvatarUploader,
  User,
  ZonedDateTime,
} from '@creativo/application/accounts';
import {
  AUTH_GATEWAY,
  PrincipalId,
  Result,
  activePrincipal,
  ok,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  APPOINTMENT_READ_PORTS,
  INBOX_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { AppointmentReadPorts } from '@core/ports';
import type { Appointment } from '@core/entities';
import { Seat } from '@core/components';
import {
  AppointmentId,
  BusyKey,
  LocalDate,
  RepositoryError,
  Result as EcsResult,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  appointmentFixture,
  memoryAppointmentReadPorts,
  memoryInboxPorts,
  minute,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { AccountStateService } from '@creativo/features/client/account-state';
import { SessionIdentityService } from '@creativo/features/shared/shell';
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

function user(birthDate?: string): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
        ...(birthDate === undefined ? {} : { birthDate }),
      },
      TODAY,
    ),
  );
}

/**
 * The client's confirmed visit at 10:00 on 2030-01-01 on the shop's wall
 * clock, its instant placed in the shop's `zone` (the one field that zone
 * reaches: a temporal entity stores no zone of its own).
 */
function appointment(zone = 'Europe/Sofia'): Appointment {
  const day = unwrapOk(LocalDate.parse('2030-01-01'));
  const seat = seatFixture({ startMinutes: minute(600) });
  return appointmentFixture({
    id: AppointmentId.of('appt_1'),
    localDate: day,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(
        day,
        seat.startMinutes,
        unwrapOk(ZonedTimeSystem.checkZone(zone)),
      ),
    ),
    seats: [seat],
    busyKeys: [BusyKey.of(seat.barberId, day)],
  });
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    // The status word the dashboard borrows from the appointments screen,
    // the card's own heading, and the two sentences the shared card is
    // named by; every other key renders as itself.
    return of({
      account: { upcoming: { title: 'Предстоящ час' } },
      appointments: { status: { confirmed: 'Потвърден' } },
      visits: {
        card: { name: '{{label}}: {{sentence}}' },
        rowName:
          '{{title}}, {{when}}, {{barber}}{{outcome}}{{price}}{{marks}}{{quote}}',
      },
    });
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
    refresh: () => undefined,
  } as unknown as AccountStateService;
}

async function configure(
  accountState: AccountStateService,
  upcoming:
    | readonly Appointment[]
    | Observable<EcsResult<readonly Appointment[], RepositoryError>>,
  options: {
    readonly hasPhoto?: boolean;
    /** Stands in for Storage outright — for the specs that count or sequence its answers. */
    readonly find?: AvatarUploader['find'];
  } = {},
): Promise<ComponentFixture<ClientAccount>> {
  const upcoming$ = Array.isArray(upcoming)
    ? of(EcsResult.ok(upcoming))
    : (upcoming as Observable<
        EcsResult<readonly Appointment[], RepositoryError>
      >);
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
          // The shared site header (rendered by this page now) reads the
          // monogram identity off the gateway.
          currentDisplayName: () => 'Ада Тестова',
          currentIdentifier: () => null,
        },
      },
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        // The page and the shell menu read the account's live bookings —
        // the one member wrapped, so a spec can hold its answer back.
        provide: APPOINTMENT_READ_PORTS,
        useValue: {
          ...memoryAppointmentReadPorts([]),
          observeUpcoming: () => upcoming$,
        } satisfies AppointmentReadPorts,
      },
      {
        provide: AVATAR_UPLOADER,
        useValue: {
          upload: () =>
            Promise.resolve(ok({ url: 'http://avatar', path: 'avatars/x' })),
          // No photo unless a spec says so — keeps the completion card
          // visible for the others.
          find:
            options.find ??
            (() =>
              Promise.resolve(
                ok(
                  options.hasPhoto
                    ? { url: 'http://avatar', path: 'avatars/user_1/original' }
                    : null,
                ),
              )),
        },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(ClientAccount);
}

/** Renders, lets the photo lookup's promise answer, and renders again. */
async function settle(fixture: ComponentFixture<ClientAccount>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
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
    expect(host.getAttribute('data-upcoming')).toBe('empty');
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).not.toBeNull();

    // The completion card waits for the avatar existence answer (a
    // microtask off the stubbed AVATAR_UPLOADER.find) before rendering.
    await Promise.resolve();
    fixture.detectChanges();

    const birthday = host.querySelector(
      '[data-testid="account-completion-birthday"]',
    );
    expect(birthday?.getAttribute('data-done')).toBe('false');
    // Photo joins the checklist as an open, deep-linking row.
    const photo = host.querySelector(
      '[data-testid="account-completion-photo"]',
    );
    expect(photo?.getAttribute('data-done')).toBe('false');
    expect(photo?.getAttribute('href')).toContain('step=avatar');
  });

  it('keeps the completion ring decorative — the progress line says it in words', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    // The card waits for the avatar existence answer (a microtask).
    await Promise.resolve();
    fixture.detectChanges();

    const ring = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="account-completion-ring"]',
    );
    expect(ring).not.toBeNull();
    // The DS default (no `uiLabel`): hidden, and never an unnamed role
    // (axe `role-img-alt` / `aria-progressbar-name`).
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(ring?.hasAttribute('role')).toBe(false);
    expect(ring?.hasAttribute('aria-label')).toBe(false);
    expect(ring?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('renders the upcoming appointment once one is live — the SHARED visit card, «Предстоящ час» as its heading, the status in words', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment()],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-upcoming')).toBe('populated');

    // The card the staff glance draws too (client-card revision 3 §3.10),
    // in `/account`'s form: the label is the heading, no services line, no
    // face, plain like every card on this page — and the WHOLE card is the
    // control, named by its one sentence.
    const card = host.querySelector<HTMLElement>('lib-visit-card');
    expect(card?.getAttribute('data-header-prominence')).toBe('increased');
    expect(card?.getAttribute('data-kind')).toBe('next');
    expect(card?.querySelector('.visit-card__services')).toBeNull();
    expect(card?.querySelector('.visit-card__face')).toBeNull();
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.tagName).toBe('BUTTON');
    expect(upcoming?.closest('lib-visit-card')).toBe(card);
    expect(upcoming?.classList.contains('ui-card')).toBe(true);
    expect(upcoming?.getAttribute('data-tone')).toBe('plain');
    expect(upcoming?.getAttribute('data-padding')).toBe('comfortable');
    expect(upcoming?.getAttribute('aria-label')).toMatch(
      /^Предстоящ час: .*10:00, Потвърден$/,
    );
    const label = upcoming?.querySelector('.visit-card__label');
    expect(label?.textContent?.trim()).toBe('Предстоящ час');
    expect(label?.getAttribute('data-font')).toBe('headline');
    expect(label?.hasAttribute('data-foreground-style')).toBe(false);
    // The day and the hour as one quiet line in the body's ink — the hour
    // is the fact.
    const line = upcoming?.querySelector('.visit-card__line');
    expect(line?.getAttribute('data-font')).toBe('body');
    expect(line?.textContent?.replace(/\s+/g, ' ')).toContain('10:00');
    expect(
      upcoming?.querySelector('.visit-card__run[data-fact]')?.textContent,
    ).toBe('10:00');

    // The status in words, never the raw enum a Bulgarian screen once
    // showed: a capsule that hugs its word, in the accent tone.
    const status = host.querySelector(
      '[data-testid="account-upcoming-status"]',
    );
    expect(status?.tagName).toBe('SPAN');
    expect(status?.classList.contains('ui-badge')).toBe(true);
    expect(status?.getAttribute('data-tone')).toBe('accent');
    expect(status?.textContent?.trim()).toBe('Потвърден');
    expect(upcoming?.textContent).not.toContain('confirmed');
    // The waiting card has left with its heading: one «Предстоящ час».
    expect(
      [...host.querySelectorAll('[data-testid="account-upcoming"]')].length,
    ).toBe(1);
    expect(
      host.querySelector('[data-testid="account-upcoming-skeleton"]'),
    ).toBeNull();
  });

  it('opens the visit on «Моите часове» when the card is tapped — its sheet asked for by the query', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment()],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="account-upcoming"]')
      ?.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/account/appointments'], {
      queryParams: { visit: 'appt_1' },
    });
  });

  it('tells the time in the shop’s zone, not the device’s', async () => {
    // A zone no test machine sits in: 10:00 there is 20:00 UTC the day
    // before, so a device-zone reading could never print 10:00.
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment('Pacific/Kiritimati')],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const upcoming = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="account-upcoming"]',
    );
    expect(upcoming?.textContent).toContain('10:00');
  });

  it('holds a placeholder, never the empty state, until the upcoming list answers', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      NEVER,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-upcoming')).toBe('loading');
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('loading');
    expect(host.querySelector('lib-visit-card')).toBeNull();
    expect(
      host.querySelector('[data-testid="account-upcoming-skeleton"]'),
    ).not.toBeNull();
    // Telling a client with a booking "no upcoming appointments" while the
    // query attaches is the one thing this card must never do.
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).toBeNull();
  });

  it('says on the host whether the profile is complete, with the card gone once it is', async () => {
    const fixture = await configure(
      accountStateStub({
        accountLoading: false,
        account: user('1990-05-05'),
      }),
      [],
      { hasPhoto: true },
    );
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    // Before the photo lookup answers, nothing is claimed either way.
    expect(host.getAttribute('data-completion')).toBe('checking');

    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    expect(host.getAttribute('data-completion')).toBe('complete');
    expect(host.querySelector('[data-testid="account-completion"]')).toBeNull();
  });

  it('makes an open checklist row a control to the hand as well as to the eye, and leaves a settled one inert', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [],
    );
    await settle(fixture);

    const host: HTMLElement = fixture.nativeElement;
    // Open: a link into onboarding, with the house hover and press
    // (client-card revision 3 §1.3 T0: the row used to be a bare anchor,
    // brown by the page's link rule and dead to the pointer).
    const open = host.querySelector(
      '[data-testid="account-completion-birthday"]',
    );
    expect(open?.tagName).toBe('A');
    expect(open?.getAttribute('data-done')).toBe('false');
    expect(open?.hasAttribute('data-interactive')).toBe(true);
    expect(open?.getAttribute('href')).toContain('step=birthday');
    // Settled: no promise on a dead surface.
    const done = host.querySelector('[data-testid="account-completion-name"]');
    expect(done?.tagName).toBe('UI-LIST-ROW');
    expect(done?.getAttribute('data-done')).toBe('true');
    expect(done?.hasAttribute('data-interactive')).toBe(false);
  });

  it('reports an open profile while an item is still missing', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [],
    );
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-completion')).toBe('open');
    expect(
      host
        .querySelector('[data-testid="account-completion"]')
        ?.getAttribute('data-state'),
    ).toBe('open');
  });
  it('asks Storage for the photo once — the page and the header share one lookup', async () => {
    const find = vi.fn<AvatarUploader['find']>(() => Promise.resolve(ok(null)));
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [],
      { find },
    );
    await settle(fixture);

    // The header's portrait is on this page too. Before round 6 the card
    // ran a second lookup (and a second checklist) of its own: two
    // requests per visit, and two answers that could disagree.
    expect(find).toHaveBeenCalledTimes(1);
    expect(
      (fixture.nativeElement as HTMLElement).getAttribute('data-completion'),
    ).toBe('open');
  });

  it('follows the shared lookup — a photo uploaded this session closes its item once the lookup re-runs', async () => {
    const find = vi
      .fn<AvatarUploader['find']>()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValue(
        ok({ url: 'http://avatar', path: 'avatars/user_1/original' }),
      );
    const fixture = await configure(
      accountStateStub({
        accountLoading: false,
        account: user('1990-05-05'),
      }),
      [],
      { find },
    );
    await settle(fixture);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-completion')).toBe('open');
    expect(
      host
        .querySelector('[data-testid="account-completion-photo"]')
        ?.getAttribute('data-done'),
    ).toBe('false');

    // What an upload does (the profile screen's store; onboarding's
    // avatar step): re-run the ONE lookup, and every reader follows.
    TestBed.inject(SessionIdentityService).refreshAvatar();
    await settle(fixture);

    expect(host.getAttribute('data-completion')).toBe('complete');
    expect(host.querySelector('[data-testid="account-completion"]')).toBeNull();
  });
});
