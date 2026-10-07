import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, NEVER, Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  type Principal,
  PrincipalId,
  activePrincipal,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  AVATAR_UPLOADER,
  PROFILE_PORT,
  UserId,
} from '@creativo/application/accounts';
import {
  AVAILABILITY_READER,
  Appointment,
  type AvailabilityReader,
  type BarberDayAvailability,
  Interval,
  TimeSlot,
  paddedBusy,
  fail,
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  ZonedDateTime,
  BookingPolicy,
  Money,
  Seat,
  SeatId,
  SeatSubject,
  WAITLIST_GATEWAY,
  APPOINTMENT_REPOSITORY,
  WAITLIST_READER,
  MAX_PARTY_SIZE,
  ObserveDayAvailabilityUseCase,
  type Result,
  ok,
} from '@creativo/application/booking';
import { InMemoryAvailabilityReader } from '@creativo/application/booking/testing';
import {
  Barber,
  BarberId,
  CATALOG_READER,
  Location,
  LocationId,
  MEDIA_READER,
  Service,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { SessionStorageDraftStore } from '@creativo/infrastructure/web-storage';
import { BookingFlowStore } from '../booking-flow.store';
import { ClientBooking } from './client-booking';

/**
 * Stand-in copy for the one sentence these specs read: the move-refused
 * panel's body, with the `{{reach}}` it sends the client to the shop with.
 * Everything else answers as its own key.
 */
const COPY: Translation = {
  booking: {
    moveRefused: {
      companions_only: { body: 'BODY:companions_only {{reach}}' },
      carried_out_of_reach: { body: 'BODY:out_of_reach {{reach}}' },
    },
    reach: { call: 'REACH:call', contact: 'REACH:contact' },
  },
};

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
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
    loader: TestTranslationLoader,
  });
}

/**
 * The real `sessionStorage`-backed store, not a fake — the draft round-trip
 * IS one of the behaviours under test, and a fake would prove only that the
 * store calls a method.
 */
async function renderShell(
  /**
   * The query the shell is entered with. A draft resumes ONLY on a
   * continuation, and every continuation says so in the URL — so a spec that
   * means "mid-flow reload" has to arrive the way a reload does, carrying the
   * step the machine had written. Bare (the default) is a fresh "Book now".
   */
  entryParams: Record<string, string> = {},
  /**
   * Who is signed in, and what the owner-scoped visit read answers. The
   * defaults are the anonymous visitor and "no such visit" — every deep-link
   * landing waits on an ACTIVE principal, so a spec about one says so.
   */
  options: {
    readonly principal?: Principal;
    readonly visit?: Appointment | null;
    /**
     * The live catalogue. Empty by default; `'pending'` barbers never
     * answer, the way a cold listener waits, and `'failed'` ones answer
     * with an error. A stream is the live list, changing as the test says.
     */
    readonly catalog?: {
      readonly services?: readonly Service[];
      readonly barbers?:
        | readonly Barber[]
        | 'pending'
        | 'failed'
        | Observable<Result<readonly Barber[], RepositoryError>>;
      /** The same, for the shops: `'pending'` never answers, `'failed'` errs. */
      readonly locations?: readonly Location[] | 'pending' | 'failed';
    };
    /** One day's geometry. No barbers on any day by default. */
    readonly observeDay?: AvailabilityReader['observeDay'];
    /** The server's answer to a move. Never asked by default. */
    readonly reschedule?: () => Promise<
      Result<{ readonly appointmentId: string }, never>
    >;
  } = {},
): Promise<ComponentFixture<ClientBooking>> {
  const catalog = options.catalog ?? {};
  await TestBed.configureTestingModule({
    imports: [ClientBooking],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
      // The store reads the clock to prune a restored declaration's lapsed
      // days. Fixed so these specs do not change meaning at midnight.
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) =>
            ZonedDateTime.fromISO('2026-08-03T09:00:00.000+03:00', zone),
        },
      },
      // The store holds the gateway because `commit()` is the only way an
      // appointment is created; these specs never reach the review step, so a
      // stub that would fail loudly if called is the honest double.
      {
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: () => Promise.reject(new Error('not used in this spec')),
          reschedule:
            options.reschedule ??
            (() => Promise.reject(new Error('not used in this spec'))),
        },
      },
      // Same posture for the waitlist: these specs never reach the schedule
      // step's flexible fork, so a double that fails loudly if called is the
      // honest stand-in.
      {
        // `?repeat=` reads the visit it is repeating; the shell injects the
        // repository whether or not a spec exercises that path.
        provide: APPOINTMENT_REPOSITORY,
        useValue: {
          findById: async () => ok(options.visit ?? null),
          save: async () => ok(undefined),
          observeUpcomingFor: () => of(ok([])),
          observeHistoryFor: () => of(ok([])),
        },
      },
      {
        // The deep-link reader — never consulted without a ?waitlist param.
        provide: WAITLIST_READER,
        useValue: {
          observeMine: () => of(ok([])),
          findMine: async () => ok(null),
        },
      },
      {
        provide: WAITLIST_GATEWAY,
        useValue: {
          request: () => Promise.reject(new Error('not used in this spec')),
          cancel: () => Promise.reject(new Error('not used in this spec')),
        },
      },
      {
        provide: BOOKING_POLICY_READER,
        useValue: { observe: () => of(BookingPolicy.default()) },
      },
      {
        // A landed move opens on the schedule step, which reads the grid.
        // Empty is enough: these specs are about the shell, not the grid.
        provide: AVAILABILITY_READER,
        useValue: {
          observeDay: options.observeDay ?? (() => of(ok([]))),
          observeRangeCapacity: () => of(ok(new Map<string, number>())),
        },
      },
      {
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(options.principal ?? ANONYMOUS_PRINCIPAL),
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
          upload: () =>
            Promise.resolve(ok({ url: 'http://avatar', path: 'avatars/x' })),
          find: () => Promise.resolve(ok(null)),
          remove: () => Promise.resolve(ok(undefined)),
        },
      },
      {
        // The services step reads the live catalog. These specs are about
        // the shell and the party step, so an EMPTY catalog is the honest
        // stub — the services step's own behaviour has its own spec.
        provide: CATALOG_READER,
        useValue: {
          listActiveServices: () => of(ok(catalog.services ?? [])),
          listActiveBarbers: () => {
            const barbers = catalog.barbers;
            if (barbers === 'pending') return NEVER;
            if (barbers === 'failed') {
              return of(fail(new RepositoryError('unavailable')));
            }
            if (barbers instanceof Observable) return barbers;
            return of(ok(barbers ?? []));
          },
          listServiceCategories: () => of(ok([])),
          listActiveLocations: () => {
            const locations = catalog.locations;
            if (locations === 'pending') return NEVER;
            if (locations === 'failed') {
              return of(fail(new RepositoryError('unavailable')));
            }
            return of(ok(locations ?? []));
          },
          findServiceById: () => Promise.resolve(ok(null)),
          findBarberById: () => Promise.resolve(ok(null)),
          findLocationById: () => Promise.resolve(ok(null)),
        },
      },
      {
        provide: MEDIA_READER,
        useValue: { resolve: () => Promise.resolve(ok([])) },
      },
    ],
  }).compileComponents();

  // The URL is read in the shell's constructor, so it has to be in place
  // BEFORE the component exists — same as a real navigation.
  if (Object.keys(entryParams).length > 0) {
    await TestBed.inject(Router).navigate([], { queryParams: entryParams });
  }

  const fixture = TestBed.createComponent(ClientBooking);
  // The app binds the deep-link params to inputs (`withComponentInputBinding`);
  // the harness does it by hand, for the ones a spec actually sends.
  const params = new Map(Object.entries(entryParams));
  for (const name of ['repeat', 'reschedule'] as const) {
    const value = params.get(name);
    if (value !== undefined) fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/**
 * The shell, walked past WHERE.
 *
 * Step 1 is optional, so this takes the "any shop" default — every case below
 * is about what FOLLOWS the location step, and `renderShell` is what tests the
 * step itself.
 */
async function render(): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await renderShell();
  click(fixture, 'booking-location-continue');
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function host(fixture: ComponentFixture<ClientBooking>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function click(fixture: ComponentFixture<ClientBooking>, testId: string): void {
  host(fixture)
    .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
    ?.click();
  fixture.detectChanges();
}

/**
 * Open a person's options: SELECT them, then press again.
 *
 * The first press on someone you are not on is a scope change; only a press
 * on the person you are already on offers what else can be done with them.
 */
function openSeatMenu(
  fixture: ComponentFixture<ClientBooking>,
  key: string,
): void {
  click(fixture, `booking-seat-${key}`);
  click(fixture, `booking-seat-${key}`);
}

/** Guest ids, in DOM order — from the seat pills `booking-seat-<key>`. */
function guestIds(fixture: ComponentFixture<ClientBooking>): string[] {
  return [
    ...host(fixture).querySelectorAll('[data-testid^="booking-seat-guest-"]'),
  ]
    .map((element) => element.getAttribute('data-testid') ?? '')
    .filter((testId) => /^booking-seat-guest-\d+$/.test(testId))
    .map((testId) => testId.replace('booking-seat-', ''));
}

/** Signed in as `uid` — the state every deep-link landing waits for. */
function signedIn(uid: string): Principal {
  return unwrap(
    activePrincipal(unwrap(PrincipalId.create(uid)), [
      roleFromPrimitive('client'),
    ]),
  );
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** A past visit of `client-1`'s: one fade with Ivan. */
function pastVisit(id: string): Appointment {
  const at = (hour: number) =>
    unwrap(
      ZonedDateTime.fromParts(
        { year: 2026, month: 7, day: 20, hour, minute: 0 },
        'Europe/Sofia',
      ),
    );
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            unwrap(UserId.create('client-1')),
            'self',
          ),
          serviceId: unwrap(ServiceId.create('svc-fade')),
          variantId: null,
          barberId: unwrap(BarberId.create('ivan')),
          terms: unwrap(
            ServiceTerms.create(
              unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR')),
              45,
            ),
          ),
          startsAt: at(10),
        }),
      ],
      now: at(8),
    }),
  );
}

/**
 * An upcoming visit of `client-1`'s that holds only their son — staff
 * removed the father's own seat. Only the shop can move it.
 */
function sonOnlyVisit(id: string): Appointment {
  const at = (hour: number) =>
    unwrap(
      ZonedDateTime.fromParts(
        { year: 2026, month: 8, day: 20, hour, minute: 0 },
        'Europe/Sofia',
      ),
    );
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        Seat.of({
          id: SeatId.generate(),
          subject: SeatSubject.account(
            unwrap(UserId.create('client-son')),
            'companion',
          ),
          serviceId: unwrap(ServiceId.create('svc-fade')),
          variantId: null,
          barberId: unwrap(BarberId.create('petar')),
          terms: unwrap(
            ServiceTerms.create(
              unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR')),
              45,
            ),
          ),
          startsAt: at(10),
        }),
      ],
      now: at(8),
    }),
  );
}

/**
 * An upcoming visit of `client-1`'s with the son the shop seated beside him
 * — somebody a move carries rather than rebuilds.
 */
function fatherAndSonVisit(
  id: string,
  /** Where the son sits: Petar at 10:00, unless staff re-seated him. */
  son: { readonly barberId: string; readonly minute: number } = {
    barberId: 'petar',
    minute: 0,
  },
  /** Further companions the shop seated beside them, each on their own service. */
  others: readonly {
    readonly userId: string;
    readonly serviceId: string;
    readonly barberId: string;
  }[] = [],
): Appointment {
  const at = (hour: number, minute = 0) =>
    unwrap(
      ZonedDateTime.fromParts(
        { year: 2026, month: 8, day: 20, hour, minute },
        'Europe/Sofia',
      ),
    );
  const seat = (
    subject: SeatSubject,
    barberId: string,
    startsAt: ZonedDateTime = at(10),
    serviceId = 'svc-fade',
  ) =>
    Seat.of({
      id: SeatId.generate(),
      subject,
      serviceId: unwrap(ServiceId.create(serviceId)),
      variantId: null,
      barberId: unwrap(BarberId.create(barberId)),
      terms: unwrap(
        ServiceTerms.create(
          unwrap(Money.fromMinorUnitsAndCode(2800, 'EUR')),
          45,
        ),
      ),
      startsAt,
    });
  return unwrap(
    Appointment.create({
      id,
      locationId: 'loc-center',
      seats: [
        seat(
          SeatSubject.account(unwrap(UserId.create('client-1')), 'self'),
          'ivan',
        ),
        seat(
          SeatSubject.account(unwrap(UserId.create('client-son')), 'companion'),
          son.barberId,
          at(10, son.minute),
        ),
        ...others.map((other) =>
          seat(
            SeatSubject.account(
              unwrap(UserId.create(other.userId)),
              'companion',
            ),
            other.barberId,
            at(10),
            other.serviceId,
          ),
        ),
      ],
      now: at(8),
    }),
  );
}

/**
 * A live catalogue service — the fade everybody on these visits is sold, at
 * `locationIds` (every shop by default).
 */
function catalogService(
  id = 'svc-fade',
  variants: readonly {
    readonly id: string;
    readonly name: { readonly bg: string; readonly en: string };
  }[] = [],
  locationIds: readonly string[] = [],
): Service {
  return unwrap(
    Service.create({
      id,
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2800,
      currencyCode: 'EUR',
      durationMinutes: 45,
      locationIds: [...locationIds],
      conflictsWith: [],
      variants: [...variants],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/** A barber on the ACTIVE list. */
function activeBarber(id: string): Barber {
  return unwrap(
    Barber.create({
      id,
      name: { bg: id, en: id },
      handle: id,
      title: { bg: 'Бръснар', en: 'Barber' },
      bio: { bg: '—', en: '—' },
      locationIds: [],
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/** The visit's shop, with a number to dial. */
function centerShop(): Location {
  return activeShop('loc-center', {
    en: 'Creativo · Center',
    bg: 'Креативо · Център',
  });
}

/** The other active shop. */
function mladostShop(): Location {
  return activeShop('loc-mladost', {
    en: 'Creativo · Mladost',
    bg: 'Креативо · Младост',
  });
}

function activeShop(
  id: string,
  name: { readonly en: string; readonly bg: string },
): Location {
  const open = { kind: 'open' as const, opens: '09:00', closes: '20:00' };
  return unwrap(
    Location.create({
      id,
      name,
      address: { en: '1 Vitosha Blvd', bg: 'бул. Витоша 1' },
      phone: { e164: '+359881234567', display: '+359 88 123 4567' },
      geo: { lat: 42.6977, lng: 23.3219 },
      mapUrl: `https://maps.example.com/${id}`,
      hours: [open, open, open, open, open, open, { kind: 'closed' }],
      timezone: 'Europe/Sofia',
      status: 'active',
      sortOrder: 0,
    }),
  );
}

/** Let an async landing (an owner-scoped read, then the store) finish. */
async function settle(fixture: ComponentFixture<ClientBooking>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

describe('ClientBooking', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('binds the v2 E2E selector contract (blueprint §5.3)', async () => {
    const fixture = await render();
    // `booking-machine`, not `booking-page` — the blueprint pins this name.
    expect(host(fixture).getAttribute('data-testid')).toBe('booking-machine');
    expect(host(fixture).getAttribute('data-state')).toBe('services');
  });

  it('lands on the catalog straight after WHERE — nobody else to declare', async () => {
    // A screen whose only question is "anyone else?" is one most bookings
    // walk past, so it is gone: the party is assembled on the catalog itself.
    const fixture = await render();
    expect(guestIds(fixture)).toHaveLength(0);
    expect(
      host(fixture).querySelector('[data-testid="booking-catalog"]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-back"]'),
    ).not.toBeNull();
  });

  it('opens on WHERE — a map, a list, and no way back from step one', async () => {
    // `render()` walks past this step because everything else is about what
    // follows it; this case is the step itself.
    const fixture = await renderShell();

    expect(host(fixture).getAttribute('data-state')).toBe('location');
    expect(
      host(fixture).querySelector('[data-testid="booking-location-map"]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-location-sheet"]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-back"]'),
    ).toBeNull();
  });

  it('offers "any shop" as a first-class row, selected until told otherwise', async () => {
    // Optional means answerable, not skippable: the row names what happens
    // ("wherever is soonest") instead of naming what you are avoiding.
    const fixture = await renderShell();

    const rows = [
      ...host(fixture).querySelectorAll('[data-testid="booking-location-row"]'),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.getAttribute('data-location')).toBe('any');
    expect(rows[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the person scope until there IS a party, then shows everyone', async () => {
    // A scope control with one option asks a question that has one answer.
    const fixture = await render();
    expect(
      host(fixture).querySelector('[data-testid="booking-seat-scope"]'),
    ).toBeNull();

    click(fixture, 'booking-add-guest');
    expect(
      host(fixture).querySelector('[data-testid="booking-seat-scope"]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-seat-self"]'),
    ).not.toBeNull();
    expect(guestIds(fixture)).toEqual(['guest-0']);
  });

  it('adds a guest and hands the catalog straight to them', async () => {
    // Adding someone and then having to find them is a second step wearing
    // the first one's clothes.
    const fixture = await render();
    click(fixture, 'booking-add-guest');

    expect(
      host(fixture)
        .querySelector('[data-testid="booking-seat-guest-0"]')
        ?.hasAttribute('data-selected'),
    ).toBe(true);
  });

  it('never resurrects a guest id after add → remove → add (§7.7)', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    expect(guestIds(fixture)).toEqual(['guest-0']);

    openSeatMenu(fixture, 'guest-0');
    click(fixture, 'booking-seat-remove-guest-0');
    expect(guestIds(fixture)).toHaveLength(0);

    click(fixture, 'booking-add-guest');
    // guest-1, NOT guest-0 — the roster length went 1 → 0 → 1 exactly as in
    // v2's bug, and the id must still move forward.
    expect(guestIds(fixture)).toEqual(['guest-1']);
  });

  it('stops at the party cap and says why instead of leaving a dead control', async () => {
    const fixture = await render();
    // The booker holds one seat, so MAX - 1 taps fill the party.
    for (let i = 0; i < MAX_PARTY_SIZE - 1; i++) {
      click(fixture, 'booking-add-guest');
    }
    expect(guestIds(fixture)).toHaveLength(MAX_PARTY_SIZE - 1);

    // No disabled control left hanging — the button is simply gone.
    expect(
      host(fixture).querySelector('[data-testid="booking-add-guest"]'),
    ).toBeNull();
  });

  it('advances to services and reveals the back affordance', async () => {
    const fixture = await render();

    expect(host(fixture).getAttribute('data-state')).toBe('services');
    expect(
      host(fixture).querySelector('[data-testid="booking-back"]'),
    ).not.toBeNull();

    // Back from the catalog is WHERE now — the party step it used to land on
    // is gone.
    click(fixture, 'booking-back');
    expect(host(fixture).getAttribute('data-state')).toBe('location');
  });

  // Regression: the URL→state effect used to read the store's own signals
  // WITHOUT `untracked`, so it re-ran on every state change. At the instant
  // `next()` advanced, the `?step=` input still held the previous step, and
  // the effect read that lag as a browser-Back and rewound the advance it
  // had just seen — the wizard could not leave step 1. Caught in the
  // browser, not here, because the input never changes in a bare TestBed.
  it('does not rewind an advance while the ?step= param is still catching up', async () => {
    const fixture = await renderShell();
    // The URL is where it was before the tap…
    fixture.componentRef.setInput('step', 'location');
    fixture.detectChanges();

    // …and the tap advances the machine ahead of it.
    click(fixture, 'booking-location-continue');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host(fixture).getAttribute('data-state')).toBe('services');
  });

  it('rewinds exactly one step when ?step= moves backward (browser Back)', async () => {
    const fixture = await render();
    // The URL catches up with the advance first — otherwise this is the
    // lagging-param case above, not a Back.
    fixture.componentRef.setInput('step', 'services');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host(fixture).getAttribute('data-state')).toBe('services');

    fixture.componentRef.setInput('step', 'location');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host(fixture).getAttribute('data-state')).toBe('location');
  });

  it('ignores a ?step= that runs AHEAD — a URL cannot skip the wizard', async () => {
    const fixture = await render();

    // Hand-typed, or a browser Forward after a Back. Every forward
    // transition has a precondition the machine checks; an address bar
    // cannot satisfy one.
    fixture.componentRef.setInput('step', 'review');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host(fixture).getAttribute('data-state')).toBe('services');
  });

  it('persists the party AND the monotonic counter across a remount', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    click(fixture, 'booking-add-guest');
    openSeatMenu(fixture, 'guest-0');
    click(fixture, 'booking-seat-remove-guest-0');
    expect(guestIds(fixture)).toEqual(['guest-1']);

    // Remount against the same sessionStorage — what a mid-flow reload does,
    // landing on the URL the machine had written.
    TestBed.resetTestingModule();
    const restored = await renderShell({ step: 'services' });
    expect(guestIds(restored)).toEqual(['guest-1']);

    // The counter survived too: without it the next guest would be handed
    // `guest-0`, the id that was already removed.
    click(restored, 'booking-add-guest');
    expect(guestIds(restored)).toEqual(['guest-1', 'guest-2']);
  });

  it('starts a FRESH booking when /book is entered with no step in the URL', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    expect(guestIds(fixture)).toEqual(['guest-0']);

    // Tapping "Book now" — a bare `/book`, the same tab, a draft still in
    // storage. Landing three steps into someone else's half-finished booking
    // is the wizard answering a question nobody asked.
    TestBed.resetTestingModule();
    const entered = await renderShell();

    expect(host(entered).getAttribute('data-state')).toBe('location');
    expect(guestIds(entered)).toEqual([]);
  });

  it('drops the stale draft on a fresh entry, so the next reload cannot resurrect it', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    expect(guestIds(fixture)).toEqual(['guest-0']);

    TestBed.resetTestingModule();
    await renderShell();

    // A reload right after the fresh entry: the URL says continuation, but
    // there is nothing left to continue — the party is empty, not the one
    // abandoned two mounts ago.
    TestBed.resetTestingModule();
    const reloaded = await renderShell({ step: 'services' });
    expect(guestIds(reloaded)).toEqual([]);
  });
});

describe('ClientBooking — the sign-in round trip keeps the booking source', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('restores the draft on a continuation that still carries ?repeat — it used to throw it away', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    expect(guestIds(fixture)).toEqual(['guest-0']);

    // Back from /auth: `?step=` says continuation, `?repeat=` rides along.
    TestBed.resetTestingModule();
    const back = await renderShell({ step: 'services', repeat: 'appt-source' });

    expect(host(back).getAttribute('data-state')).toBe('services');
    expect(guestIds(back)).toEqual(['guest-0']);
  });

  it('still starts fresh on a ?repeat arrival with no step — a new prefilled flow', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');

    TestBed.resetTestingModule();
    const entered = await renderShell({ repeat: 'appt-source' });

    expect(guestIds(entered)).toEqual([]);
  });

  it('attaches the repeated visit once signed in, without replacing the bag the person built', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');

    TestBed.resetTestingModule();
    const back = await renderShell(
      { step: 'services', repeat: 'appt-source' },
      { principal: signedIn('client-1'), visit: pastVisit('appt-source') },
    );
    await settle(back);

    const store = back.debugElement.injector.get(BookingFlowStore);
    expect(store.bookedFrom()).toBe('appt-source');
    // Their party, not the old visit's: nobody's bag was overwritten.
    expect(guestIds(back)).toEqual(['guest-0']);
    expect(host(back).getAttribute('data-state')).toBe('services');
  });
});

describe('ClientBooking — a move link that cannot move', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  function refusal(fixture: ComponentFixture<ClientBooking>): Element | null {
    return host(fixture).querySelector('[data-testid="booking-move-refused"]');
  }

  it('says the shop moves a visit that holds only a companion — instead of opening a flow that would book a second one', async () => {
    const fixture = await renderShell(
      { reschedule: 'appt-son' },
      { principal: signedIn('client-1'), visit: sonOnlyVisit('appt-son') },
    );
    await settle(fixture);

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'companions_only',
    );
    // No wizard under it: nothing to continue, nothing to confirm.
    expect(
      host(fixture).querySelector('[data-testid="booking-location-continue"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-back"]'),
    ).toBeNull();
    // The way out that always exists; the call needs the shop's number,
    // which this empty catalogue does not have.
    expect(
      host(fixture).querySelector(
        '[data-testid="booking-move-refused-appointments"]',
      ),
    ).not.toBeNull();
    const store = fixture.debugElement.injector.get(BookingFlowStore);
    expect(store.isRescheduling()).toBe(false);
    expect(store.lineCount()).toBe(0);
  });

  it('says to GET IN TOUCH, not to call, when the page has no number to dial', async () => {
    // The shop is missing from this (empty) catalogue, so no call button —
    // and the copy must not promise one.
    const fixture = await renderShell(
      { reschedule: 'appt-son' },
      { principal: signedIn('client-1'), visit: sonOnlyVisit('appt-son') },
    );
    await settle(fixture);

    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-body"]')
        ?.textContent?.trim(),
    ).toBe('BODY:companions_only REACH:contact');
    expect(
      host(fixture).querySelector('[data-testid="booking-move-refused-call"]'),
    ).toBeNull();
  });

  it('says to CALL — beside the call button — once the catalogue knows the shop', async () => {
    const fixture = await renderShell(
      { reschedule: 'appt-son' },
      {
        principal: signedIn('client-1'),
        visit: sonOnlyVisit('appt-son'),
        catalog: { locations: [centerShop()] },
      },
    );
    await settle(fixture);

    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-body"]')
        ?.textContent?.trim(),
    ).toBe('BODY:companions_only REACH:call');
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-call"]')
        ?.getAttribute('href'),
    ).toBe('tel:+359881234567');
  });

  it('refuses a move link whose visit cannot be read, rather than falling through to a blank bookable flow', async () => {
    const fixture = await renderShell(
      { reschedule: 'appt-gone' },
      { principal: signedIn('client-1'), visit: null },
    );
    await settle(fixture);

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe('unavailable');
    expect(
      host(fixture).querySelector('[data-testid="booking-location-continue"]'),
    ).toBeNull();
  });

  it('never reuses a restored move another account read — it is re-read, and refused for this one', async () => {
    // client-1 lands the move; the tab then comes back signed in as client-2.
    const first = await renderShell(
      { reschedule: 'appt-moving' },
      { principal: signedIn('client-1'), visit: pastVisit('appt-moving') },
    );
    await settle(first);
    expect(
      first.debugElement.injector.get(BookingFlowStore).rescheduleOf(),
    ).toBe('appt-moving');

    TestBed.resetTestingModule();
    const fixture = await renderShell(
      { step: 'schedule', reschedule: 'appt-moving' },
      // The owner-scoped read answers nothing for somebody else's visit.
      { principal: signedIn('client-2'), visit: null },
    );
    await settle(fixture);

    const store = fixture.debugElement.injector.get(BookingFlowStore);
    expect(store.isRescheduling()).toBe(false);
    expect(refusal(fixture)?.getAttribute('data-reason')).toBe('unavailable');
  });

  it('re-reads a restored move’s facts from the stored visit on a reload, and keeps the bag', async () => {
    const catalog = {
      services: [catalogService()],
      barbers: [
        activeBarber('ivan'),
        activeBarber('petar'),
        activeBarber('niko'),
      ],
    };
    const first = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving'),
        catalog,
      },
    );
    await settle(first);
    expect(
      first.debugElement.injector
        .get(BookingFlowStore)
        .riders()
        .map((rider) => rider.barberId),
    ).toEqual(['petar']);

    // The tab reloads after staff re-seated the son: Niko, at 10:30.
    TestBed.resetTestingModule();
    const rebuilt = vi.spyOn(BookingFlowStore.prototype, 'rescheduleFrom');
    const fixture = await renderShell(
      { step: 'schedule', reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving', {
          barberId: 'niko',
          minute: 30,
        }),
        catalog,
      },
    );
    await settle(fixture);

    const store = fixture.debugElement.injector.get(BookingFlowStore);
    expect(store.rescheduleOf()).toBe('appt-moving');
    expect(
      store.riders().map((rider) => [rider.barberId, rider.offsetMinutes]),
    ).toEqual([['niko', 30]]);
    // The restored bag stands: the move's facts were re-read, not the bag
    // rebuilt over what the client had.
    expect(rebuilt).not.toHaveBeenCalled();
    rebuilt.mockRestore();
  });

  it('moves a visit the cart CAN name exactly as before — no refusal', async () => {
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      { principal: signedIn('client-1'), visit: pastVisit('appt-moving') },
    );
    await settle(fixture);

    expect(refusal(fixture)).toBeNull();
    const store = fixture.debugElement.injector.get(BookingFlowStore);
    expect(store.rescheduleOf()).toBe('appt-moving');
    expect(host(fixture).getAttribute('data-state')).toBe('schedule');
  });
});

// The FEATURE half of the rider filter: the schedule step hands the carried
// seats to the day query, pinned and measured. Whether the grid then drops a
// time is the engine's (`availability.spec.ts`, riders) and the use case's to
// forward — pinned there, not here.
describe('ClientBooking — a move asks the grid to keep room for who it carries', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the son the server carries with every day query of the move', async () => {
    const execute = vi.spyOn(
      ObserveDayAvailabilityUseCase.prototype,
      'execute',
    );
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving'),
        // Everybody still served here, so the move opens on its grid.
        catalog: {
          services: [catalogService()],
          barbers: [activeBarber('ivan'), activeBarber('petar')],
          locations: [centerShop()],
        },
      },
    );
    await settle(fixture);

    expect(host(fixture).getAttribute('data-state')).toBe('schedule');
    expect(
      host(fixture).querySelector('[data-testid="booking-move-refused"]'),
    ).toBeNull();
    const asked = execute.mock.calls.map(
      ([input]) => (input as { readonly riders?: unknown }).riders,
    );
    expect(asked.length).toBeGreaterThan(0);
    const [riders] = asked.slice(-1) as {
      readonly barberId: { readonly value: string };
      readonly offsetMinutes: number;
      readonly terms: { readonly durationMinutes: number };
    }[][];
    expect(
      riders?.map((rider) => ({
        barberId: rider.barberId.value,
        offsetMinutes: rider.offsetMinutes,
        durationMinutes: rider.terms.durationMinutes,
      })),
    ).toEqual([{ barberId: 'petar', offsetMinutes: 0, durationMinutes: 45 }]);
  });

  it('hands the visit’s own chairs back on every day query, so they never block its move', async () => {
    const execute = vi.spyOn(
      ObserveDayAvailabilityUseCase.prototype,
      'execute',
    );
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving'),
        catalog: {
          services: [catalogService()],
          barbers: [activeBarber('ivan'), activeBarber('petar')],
          locations: [centerShop()],
        },
      },
    );
    await settle(fixture);

    const released = execute.mock.calls.map(
      ([input]) =>
        (
          input as {
            readonly release?: readonly {
              readonly barberId: { readonly value: string };
              readonly occupied: { readonly startMs: number };
            }[];
          }
        ).release,
    );
    expect(released.length).toBeGreaterThan(0);
    const tenOClock = unwrap(
      ZonedDateTime.fromParts(
        { year: 2026, month: 8, day: 20, hour: 10, minute: 0 },
        'Europe/Sofia',
      ),
    ).toMillis();
    // Both chairs — the father's the cart rebuilds AND the son's it carries:
    // the server subtracts the whole visit before it re-places it.
    expect(
      released
        .at(-1)
        ?.map((chair) => [chair.barberId.value, chair.occupied.startMs]),
    ).toEqual([
      ['ivan', tenOClock],
      ['petar', tenOClock],
    ]);
  });
});

describe('ClientBooking — the moved visit’s own day on the calendar', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  function day(
    fixture: ComponentFixture<ClientBooking>,
    key: string,
  ): HTMLButtonElement | null {
    return host(fixture).querySelector<HTMLButtonElement>(
      `[data-testid="booking-day"][data-day-key="${key}"]`,
    );
  }

  /**
   * The visit's day as the barberBusy projection stores it: Ivan and Petar
   * rostered 10:00–10:45 at Center and nothing else, both taken by the
   * visit's own chairs. `honours` picks the port's reference reader, which
   * hands the `release` back as the contract says (`paddedBusy`), or a
   * reader that BREAKS the contract by ignoring it — the calendar must stay
   * honest with either.
   */
  function visitDayReader(honours: boolean): AvailabilityReader['observeDay'] {
    const center = unwrap(LocationId.create('loc-center'));
    const at = (minute: number) =>
      unwrap(
        ZonedDateTime.fromParts(
          { year: 2026, month: 8, day: 20, hour: 10, minute },
          'Europe/Sofia',
        ),
      ).toMillis();
    const chair = Interval.of(at(0), at(45));
    const stored = new InMemoryAvailabilityReader((day) =>
      day.key() !== '2026-08-20'
        ? []
        : ['ivan', 'petar'].map((id) => ({
            barberId: unwrap(BarberId.create(id)),
            windows: [{ interval: chair, locationId: center }],
            spans: [chair],
            turnaroundMinutes: 0,
          })),
    );
    if (honours) {
      return (locationId, day, barberIds, release) =>
        stored.observeDay(locationId, day, barberIds, release);
    }
    return (_locationId, day) => {
      if (day.key() !== '2026-08-20') return of(ok([]));
      return of(
        ok(
          ['ivan', 'petar'].map((id): BarberDayAvailability => {
            const barberId = unwrap(BarberId.create(id));
            return {
              barberId,
              windows: [{ interval: chair, locationId: center }],
              // The release dropped: what the contract spec now refuses in
              // every real reader (`availabilityReaderBusyCases`).
              busy: paddedBusy({
                barberId,
                spans: [chair],
                turnaroundMinutes: 0,
              }),
            };
          }),
        ),
      );
    };
  }

  async function landMove(
    honours: boolean,
  ): Promise<ComponentFixture<ClientBooking>> {
    // The capacity stub reports no free minutes anywhere: every day the
    // projection answers is "full", the visit's own chairs included.
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving'),
        catalog: {
          services: [catalogService()],
          barbers: [activeBarber('ivan'), activeBarber('petar')],
          locations: [centerShop()],
        },
        observeDay: visitDayReader(honours),
      },
    );
    await settle(fixture);
    return fixture;
  }

  it('keeps the day the visit sits on tappable when its own chairs are all that fill it', async () => {
    const fixture = await landMove(true);

    // Only the exact query can see it: the visit's chairs handed back, the
    // father and the son fit where they sit now.
    expect(day(fixture, '2026-08-20')?.disabled).toBe(false);
    // Any other day is still the projection's to answer.
    expect(day(fixture, '2026-08-21')?.disabled).toBe(true);
  });

  it('greys that day when the reader does not hand the chairs back — never a tappable day with an empty sheet', async () => {
    // A reader that ignores `release`: the day answers what its sheet
    // would show — nothing — rather than a tappable day with an empty sheet.
    const fixture = await landMove(false);

    expect(day(fixture, '2026-08-20')?.disabled).toBe(true);
  });
});

describe('ClientBooking — a companion the shop can no longer serve here', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  function refusal(fixture: ComponentFixture<ClientBooking>): Element | null {
    return host(fixture).querySelector('[data-testid="booking-move-refused"]');
  }

  async function landMove(
    catalog: {
      readonly services?: readonly Service[];
      readonly barbers?: readonly Barber[] | 'pending' | 'failed';
      /** The Center alone by default. */
      readonly locations?: readonly Location[] | 'pending' | 'failed';
    },
    visit: Appointment = fatherAndSonVisit('appt-moving'),
  ): Promise<ComponentFixture<ClientBooking>> {
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit,
        catalog: { locations: [centerShop()], ...catalog },
      },
    );
    await settle(fixture);
    return fixture;
  }

  /**
   * The father, the son on a fade with Petar, and the daughter the shop
   * seated beside them on braids with Niko.
   */
  function familyVisit(): Appointment {
    return fatherAndSonVisit('appt-moving', undefined, [
      { userId: 'client-daughter', serviceId: 'svc-braids', barberId: 'niko' },
    ]);
  }

  const FAMILY_BARBERS = [
    activeBarber('ivan'),
    activeBarber('petar'),
    activeBarber('niko'),
  ];

  it('ends in the call panel when the son’s barber is off the active list — not in an empty grid', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      // Petar left: no day would ever read his chair.
      barbers: [activeBarber('ivan')],
    });

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
    // The call leads — only the shop can re-seat him — and nothing of the
    // wizard is left to confirm a move the server would refuse.
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-call"]')
        ?.getAttribute('href'),
    ).toBe('tel:+359881234567');
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-body"]')
        ?.textContent?.trim(),
    ).toBe('BODY:out_of_reach REACH:call');
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-back"]'),
    ).toBeNull();
  });

  it('ends in the call panel when the son’s service is retired', async () => {
    const fixture = await landMove({
      services: [catalogService('svc-other')],
      barbers: [activeBarber('ivan'), activeBarber('petar')],
    });

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
  });

  // The grid runs only shops that offer every service on the visit
  // (`shopsServingParty`). A fade offered only at a shop that has since
  // closed is served at no shop at all: every sheet would be empty, and the
  // server refuses the son wherever the move goes. That is the call panel,
  // not a calendar of empty days.
  it('ends in the call panel when no ACTIVE shop offers the son’s service any more', async () => {
    const fixture = await landMove({
      services: [catalogService('svc-fade', [], ['loc-closed'])],
      barbers: [activeBarber('ivan'), activeBarber('petar')],
    });

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).toBeNull();
  });

  // The carried seats move together, to ONE shop. The son's fade is offered
  // only at the Center and the daughter's braids only in Mladost: each is
  // served somewhere, never together. The grid runs no shop for the party,
  // and the schedule step's «Промени услугите» cannot change a companion's
  // service, so the move ends at the shop, not at that notice.
  it('ends in the call panel when no ONE active shop serves every companion it carries', async () => {
    const fixture = await landMove(
      {
        services: [
          catalogService('svc-fade', [], ['loc-center']),
          catalogService('svc-braids', [], ['loc-mladost']),
        ],
        barbers: FAMILY_BARBERS,
        locations: [centerShop(), mladostShop()],
      },
      familyVisit(),
    );

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-shop-scope"]'),
    ).toBeNull();
  });

  it('opens the grid when one active shop serves every companion it carries', async () => {
    const fixture = await landMove(
      {
        services: [
          catalogService('svc-fade', [], ['loc-center', 'loc-mladost']),
          catalogService('svc-braids', [], ['loc-mladost']),
        ],
        barbers: FAMILY_BARBERS,
        locations: [centerShop(), mladostShop()],
      },
      familyVisit(),
    );

    expect(refusal(fixture)).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).not.toBeNull();
  });

  it.each(['pending', 'failed'] as const)(
    'asks no shop question while the shop read is %s — a list that never arrived is not “no shop”',
    async (locations) => {
      // The son's fade is offered only at a shop that has since closed: once
      // the shops answer, that is the call panel (above). Before, it is not.
      const fixture = await landMove({
        services: [catalogService('svc-fade', [], ['loc-closed'])],
        barbers: [activeBarber('ivan'), activeBarber('petar')],
        locations,
      });

      expect(refusal(fixture)).toBeNull();
      expect(
        host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
      ).not.toBeNull();
    },
  );

  it('still asks after the barbers while the shops are pending', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      barbers: [activeBarber('ivan')],
      locations: 'pending',
    });

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
  });

  it('ends in the call panel when the shops have answered with no active shop — nowhere to seat the son', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      barbers: [activeBarber('ivan'), activeBarber('petar')],
      locations: [],
    });

    expect(refusal(fixture)?.getAttribute('data-reason')).toBe(
      'carried_out_of_reach',
    );
    // No shop, so no number to dial: the copy says to get in touch.
    expect(
      host(fixture).querySelector('[data-testid="booking-move-refused-call"]'),
    ).toBeNull();
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-move-refused-body"]')
        ?.textContent?.trim(),
    ).toBe('BODY:out_of_reach REACH:contact');
  });

  it('opens the grid when one active shop still offers the son’s service', async () => {
    const fixture = await landMove({
      services: [catalogService('svc-fade', [], ['loc-center'])],
      barbers: [activeBarber('ivan'), activeBarber('petar')],
    });

    expect(refusal(fixture)).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).not.toBeNull();
  });

  it('says nothing until the barbers have ANSWERED — an unanswered read is not “nobody”', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      barbers: 'pending',
    });

    expect(refusal(fixture)).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).not.toBeNull();
  });

  it('says nothing when a catalogue read FAILS — a list that never arrived is not “nobody”', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      barbers: 'failed',
    });

    expect(refusal(fixture)).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).not.toBeNull();
  });

  it('never replaces a confirmed move with the call panel when the catalogue changes afterwards', async () => {
    const barbers = new BehaviorSubject<
      Result<readonly Barber[], RepositoryError>
    >(ok([activeBarber('ivan'), activeBarber('petar')]));
    const fixture = await renderShell(
      { reschedule: 'appt-moving' },
      {
        principal: signedIn('client-1'),
        visit: fatherAndSonVisit('appt-moving'),
        catalog: {
          services: [catalogService()],
          barbers,
          locations: [centerShop()],
        },
        reschedule: async () => ok({ appointmentId: 'appt-moving' }),
      },
    );
    await settle(fixture);

    // The move goes through: Ivan at 14:00 for the father.
    const store = fixture.debugElement.injector.get(BookingFlowStore);
    const at = (hour: number) =>
      unwrap(
        ZonedDateTime.fromParts(
          { year: 2026, month: 8, day: 21, hour, minute: 0 },
          'Europe/Sofia',
        ),
      );
    const slot = unwrap(TimeSlot.of(at(14), at(15)));
    store.selectDay('2026-08-21', 'Europe/Sofia');
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
    await store.commit();
    await settle(fixture);
    expect(host(fixture).getAttribute('data-state')).toBe('confirmed');

    // …and THEN Petar leaves the active list.
    barbers.next(ok([activeBarber('ivan')]));
    await settle(fixture);

    expect(refusal(fixture)).toBeNull();
    expect(host(fixture).getAttribute('data-state')).toBe('confirmed');
  });

  it('opens the grid as before when everybody it carries is still served', async () => {
    const fixture = await landMove({
      services: [catalogService()],
      barbers: [activeBarber('ivan'), activeBarber('petar')],
    });

    expect(refusal(fixture)).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-schedule-step"]'),
    ).not.toBeNull();
  });
});
