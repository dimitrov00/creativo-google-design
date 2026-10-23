import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, NEVER, Observable, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import type {
  AppointmentReadPorts,
  FindAvatar,
  LoadLocation,
} from '@core/ports';
import type { Appointment, User } from '@core/entities';
import { BirthDate, type Principal, Seat } from '@core/components';
import {
  AppointmentId,
  BusyKey,
  LocalDate,
  RepositoryError,
  Result as EcsResult,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  appointmentFixture,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  minute,
  principalFixture,
  registeredUserFixture,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { AccountStateService } from '@creativo/features/client/account-state';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { ClientAccount } from './client-account';

const PRINCIPAL = principalFixture.client(UserId.of('user_1'));

/** Jane Doe, registered — her `users/{uid}` body as stored. */
function user(birthDate?: string): User {
  return registeredUserFixture({
    id: UserId.of('user_1'),
    firstName: 'Jane',
    lastName: 'Doe',
    birthDate: birthDate === undefined ? null : BirthDate.of(birthDate),
  });
}

/**
 * The client's confirmed visit at 10:00 on 2030-01-01 on the shop's wall
 * clock, its instant placed in the shop's `zone` (the one field that zone
 * reaches: a temporal entity stores no zone of its own).
 */
function appointment(
  zone = 'Europe/Sofia',
  at: { readonly id: string; readonly startMinute: number } = {
    id: 'appt_1',
    startMinute: 600,
  },
): Appointment {
  const day = unwrapOk(LocalDate.parse('2030-01-01'));
  const seat = seatFixture({ startMinutes: minute(at.startMinute) });
  return appointmentFixture({
    id: AppointmentId.of(at.id),
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

/** The app's own bg catalogue — its `errors` words are what a failed read shows. */
function bgCatalogue(): Translation {
  return JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../../../../../infrastructure/i18n/src/assets/i18n/bg.json',
      ),
      'utf8',
    ),
  ) as Translation;
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    // The status word the dashboard borrows from the appointments screen,
    // the card's own heading, the two sentences the shared card is named
    // by, and the app's own error words; every other key renders as itself.
    return of({
      errors: bgCatalogue()['errors'],
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
    roles: signal(PRINCIPAL.roles),
    userId: signal(PRINCIPAL.userId),
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
    readonly find?: FindAvatar;
    /** Stands in for the shops' read — the zone the card's "now" is read in. */
    readonly loadLocation?: LoadLocation;
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
        provide: AUTH_SESSION_PORTS,
        useValue: memoryAuthSessionPorts({
          principals$: new BehaviorSubject<Principal>(PRINCIPAL),
          // The shared site header (rendered by this page now) reads the
          // monogram identity off the session.
          displayName: 'Ада Тестова',
        }),
      },
      // The shell menu's schedule row names the default location's day, and
      // the card reads "now" in its visit's own shop's zone (Europe/Sofia).
      {
        provide: LOCATION_LOAD_PORTS,
        useValue:
          options.loadLocation === undefined
            ? memoryLocationLoadPorts(
                memoryProgramsWorld({ locations: [locationFixture()] }),
              )
            : { loadLocation: options.loadLocation },
      },
      // "Now" is pinned in 2026: the fixture visit (2030-01-01) keeps its
      // year and is never «днес».
      { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
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
        provide: AVATAR_PORTS,
        useValue: {
          ...memoryAvatarPorts(),
          // No photo unless a spec says so — keeps the completion card
          // visible for the others.
          findAvatar:
            options.find ??
            (() =>
              Promise.resolve(
                EcsResult.ok(
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
    // microtask off the stubbed AVATAR_PORTS.findAvatar) before rendering.
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

  it('says a failed read in the app’s own words, never the empty state', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      of(
        EcsResult.err(
          RepositoryError.readFailed('appointments', 'permission-denied'),
        ),
      ),
    );
    await settle(fixture);

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-upcoming')).toBe('error');
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('error');
    expect(upcoming?.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Възникна проблем от наша страна — моля, опитайте отново.',
    );
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).toBeNull();
  });

  it('a pending zone read keeps data-upcoming="loading"', async () => {
    // The visit has answered; its shop's zone — what the card reads "now"
    // in — has not. The card waits in the pending state, never the empty.
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment()],
      { loadLocation: () => new Promise(() => undefined) },
    );
    // No `whenStable`: the zone read never answers, so the page never is.
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-upcoming')).toBe('loading');
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('loading');
    expect(host.querySelector('lib-visit-card')).toBeNull();
    expect(
      host.querySelector('[data-testid="account-upcoming-skeleton"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).toBeNull();
  });

  it('a failed zone read shows data-upcoming="error", never loading forever', async () => {
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      [appointment()],
      {
        loadLocation: () =>
          Promise.resolve(
            EcsResult.err(
              RepositoryError.readFailed('locations', 'permission-denied'),
            ),
          ),
      },
    );
    await settle(fixture);

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-upcoming')).toBe('error');
    const upcoming = host.querySelector('[data-testid="account-upcoming"]');
    expect(upcoming?.getAttribute('data-state')).toBe('error');
    // The card's one alert line, whichever read failed.
    expect(upcoming?.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Възникна проблем от наша страна — моля, опитайте отново.',
    );
    expect(host.querySelector('lib-visit-card')).toBeNull();
    expect(
      host.querySelector('[data-testid="account-upcoming-skeleton"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="account-upcoming-book-cta"]'),
    ).toBeNull();
  });

  it('replaces a drawn card straight with a sooner visit at the same shop — no skeleton between, the shop’s zone read once', async () => {
    const upcoming$ = new BehaviorSubject<
      EcsResult<readonly Appointment[], RepositoryError>
    >(EcsResult.ok([appointment()]));
    const fixture = await configure(
      accountStateStub({ accountLoading: false, account: user() }),
      upcoming$,
    );
    const zoneOf = vi.spyOn(TestBed.inject(ShopZoneService), 'zoneOf');
    await settle(fixture);

    const host: HTMLElement = fixture.nativeElement;
    const card = () =>
      host.querySelector<HTMLElement>('[data-testid="account-upcoming"]');
    expect(host.getAttribute('data-upcoming')).toBe('populated');
    expect(card()?.getAttribute('aria-label')).toMatch(/10:00, Потвърден$/);

    // A sooner booking at the same shop becomes the soonest.
    upcoming$.next(
      EcsResult.ok([
        appointment(),
        appointment('Europe/Sofia', { id: 'appt_2', startMinute: 540 }),
      ]),
    );
    // The very next render already draws the new visit — no async hop.
    fixture.detectChanges();
    expect(host.getAttribute('data-upcoming')).toBe('populated');
    expect(
      host.querySelector('[data-testid="account-upcoming-skeleton"]'),
    ).toBeNull();
    expect(card()?.getAttribute('aria-label')).toMatch(/09:00, Потвърден$/);

    await settle(fixture);
    expect(host.getAttribute('data-upcoming')).toBe('populated');
    expect(card()?.getAttribute('aria-label')).toMatch(/09:00, Потвърден$/);
    expect(zoneOf).toHaveBeenCalledTimes(1);
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
    const find = vi.fn<FindAvatar>(() => Promise.resolve(EcsResult.ok(null)));
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
      .fn<FindAvatar>()
      .mockResolvedValueOnce(EcsResult.ok(null))
      .mockResolvedValue(
        EcsResult.ok({ url: 'http://avatar', path: 'avatars/user_1/original' }),
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
