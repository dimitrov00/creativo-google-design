import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { NEVER, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
} from '@creativo/application/identity';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import {
  Barber,
  CATALOG_READER,
  Location,
  LocationId,
  MEDIA_READER,
  Service,
} from '@creativo/application/catalog';
import {
  AVAILABILITY_READER,
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  BookingPolicy,
  WAITLIST_GATEWAY,
  APPOINTMENT_REPOSITORY,
  WAITLIST_READER,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/application/booking';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import { SessionStorageDraftStore } from '@creativo/infrastructure/web-storage';
import { BookingFlowStore } from '../booking-flow.store';
import { ClientBooking } from '../client-booking/client-booking';

/**
 * Stand-in copy for the sentences these specs read — the shop notice's, with
 * the shop names it is given. Everything else answers as its own key.
 */
const COPY: Translation = {
  booking: {
    schedule: {
      shopScope: {
        elsewhere: {
          title: 'NOT_HERE:{{shop}}',
          body: 'THERE:{{target}}',
          switch: 'SWITCH:{{target}}',
        },
      },
    },
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

function service(id: string, locationIds: readonly string[] = []): Service {
  const result = Service.create({
    id,
    name: { en: id, bg: id },
    description: { en: 'x', bg: 'x' },
    categoryId: 'cat-hair',
    priceMinorUnits: 1500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    variants: [],
    offerings: [
      {
        barberId: 'ivan',
        base: {
          priceMinorUnits: 1450,
          currencyCode: 'EUR',
          durationMinutes: 35,
        },
      },
    ],
    locationIds: [...locationIds],
    conflictsWith: [],
    composition: { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** A barber on the ACTIVE list. */
function barber(id: string): Barber {
  const result = Barber.create({
    id,
    name: { bg: id, en: id },
    handle: id,
    title: { bg: 'Бръснар', en: 'Barber' },
    bio: { bg: '—', en: '—' },
    locationIds: [],
    status: 'active',
    sortOrder: 1,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** An ACTIVE shop. */
function shop(id: string, name: string): Location {
  const open = { kind: 'open' as const, opens: '09:00', closes: '20:00' };
  const result = Location.create({
    id,
    name: { en: name, bg: name },
    address: { en: '—', bg: '—' },
    phone: { e164: '+359881234567', display: '+359 88 123 4567' },
    geo: { lat: 42.6977, lng: 23.3219 },
    mapUrl: `https://maps.example.com/${id}`,
    hours: [open, open, open, open, open, open, { kind: 'closed' }],
    timezone: 'Europe/Sofia',
    status: 'active',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** Room on every day of the run, as far as the projection can tell. */
function roomEveryDay(): ReadonlyMap<string, number> {
  const free = new Map<string, number>();
  for (let day = Date.UTC(2026, 7, 1); day <= Date.UTC(2026, 11, 31);) {
    free.set(new Date(day).toISOString().slice(0, 10), 480);
    day += 86_400_000;
  }
  return free;
}

const CATALOG = [service('cut')];

/**
 * The shell, with every port this step touches doubled.
 *
 * Availability answers EMPTY rather than with geometry: none of these specs is
 * about which minutes are free — they are about the bar's own anatomy, which
 * is supposed to be identical whether or not the day has anything in it. A
 * fixture that built real roster windows would make these tests fail for
 * reasons that have nothing to do with what they assert.
 */
async function renderShell(
  options: {
    readonly services?: readonly Service[];
    readonly barbers?: readonly Barber[];
    /** `'pending'` never answers, the way a cold listener waits; `'failed'` errs. */
    readonly locations?: readonly Location[] | 'pending' | 'failed';
    /** The projection. No free minutes anywhere by default. */
    readonly capacity?: (
      locationId: LocationId | null,
      barberIds: readonly string[],
    ) => ReadonlyMap<string, number>;
  } = {},
): Promise<ComponentFixture<ClientBooking>> {
  await TestBed.configureTestingModule({
    imports: [ClientBooking],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) =>
            ZonedDateTime.fromISO('2026-08-03T09:00:00.000+03:00', zone),
        },
      },
      {
        provide: AVAILABILITY_READER,
        useValue: {
          observeDay: () => of(ok([])),
          observeRangeCapacity: (
            locationId: LocationId | null,
            _range: unknown,
            barberIds: readonly { readonly value: string }[],
          ) =>
            of(
              ok(
                options.capacity?.(
                  locationId,
                  barberIds.map((id) => id.value),
                ) ?? new Map<string, number>(),
              ),
            ),
        },
      },
      {
        provide: BOOKING_POLICY_READER,
        useValue: { observe: () => of(BookingPolicy.default()) },
      },
      {
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: () => Promise.reject(new Error('not used in this spec')),
        },
      },
      {
        // `?repeat=` reads the visit it is repeating; the shell injects the
        // repository whether or not a spec exercises that path.
        provide: APPOINTMENT_REPOSITORY,
        useValue: {
          findById: async () => ok(null),
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
        provide: AUTH_GATEWAY,
        useValue: {
          observePrincipal: () => of(ANONYMOUS_PRINCIPAL),
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
        provide: CATALOG_READER,
        useValue: {
          listActiveServices: () => of(ok(options.services ?? CATALOG)),
          listActiveBarbers: () => of(ok(options.barbers ?? [])),
          listServiceCategories: () => of(ok([])),
          listActiveLocations: () => {
            const locations = options.locations;
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

  const fixture = TestBed.createComponent(ClientBooking);
  fixture.detectChanges();
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

async function settle(fixture: ComponentFixture<ClientBooking>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Walk the wizard to WHEN: any shop, party of one, one service in the bag. */
async function toSchedule(
  options: Parameters<typeof renderShell>[0] & {
    /** The shop picked on WHERE; "any shop" by default. */
    readonly shopId?: string;
    /** The barber the line asks for; "anyone" by default. */
    readonly barberId?: string;
  } = {},
): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await renderShell(options);

  if (options.shopId !== undefined) {
    host(fixture)
      .querySelector<HTMLButtonElement>(
        `[data-testid="booking-location-row"][data-location="${options.shopId}"]`,
      )
      ?.click();
    await settle(fixture);
  }
  click(fixture, 'booking-location-continue');
  await settle(fixture);

  click(fixture, 'booking-party-continue');
  await settle(fixture);

  click(fixture, 'service-card-cut');
  await settle(fixture);
  click(fixture, 'booking-barber-menu');
  click(
    fixture,
    options.barberId === undefined
      ? 'booking-barber-any'
      : `booking-barber-${options.barberId}`,
  );
  click(fixture, 'booking-add-to-bag');
  await settle(fixture);

  click(fixture, 'booking-services-continue');
  await settle(fixture);

  return fixture;
}

/** Every control on the step's action bar, in order, by testid. */
function barControls(fixture: ComponentFixture<ClientBooking>): string[] {
  return [
    ...host(fixture).querySelectorAll(
      '.booking-schedule__decision [data-testid]',
    ),
  ].map((element) => element.getAttribute('data-testid') ?? '');
}

describe('BookingScheduleStep', () => {
  let fixture: ComponentFixture<ClientBooking>;

  beforeEach(async () => {
    sessionStorage.clear();
    fixture = await toSchedule();
  });

  it('lands on the schedule step with the calendar mounted', () => {
    expect(host(fixture).getAttribute('data-state')).toBe('schedule');
    expect(
      host(fixture).querySelector('[data-testid="booking-calendar"]'),
    ).not.toBeNull();
  });

  // ── The heading scrolls ───────────────────────────────────────────────
  //
  // Rendered ABOVE the scroller, the large title could never pass under the
  // wizard's toolbar, so `BookingStepTitle`'s observer never fired and this
  // was the one step whose bar stayed empty. The structural fact — the title
  // is INSIDE the scroll region — is what makes the house collapse possible,
  // and jsdom cannot observe the collapse itself.
  it('projects its title into the scroller, so it can scroll under the bar', () => {
    const scroller = host(fixture).querySelector(
      '[data-testid="booking-calendar"]',
    );
    const title = host(fixture).querySelector('h1[libSteptitle], h1');

    expect(title).not.toBeNull();
    expect(scroller?.contains(title as Node)).toBe(true);
  });

  // ── One way to answer "when" ──────────────────────────────────────────
  //
  // The multi-date search toggle is gone (owner ruling 2026-08-01). It earned
  // a mode, a second sheet layout and a per-day window editor for a question
  // most people never ask, and every control it touched had to branch on it.
  it('offers no multi-date toggle', () => {
    expect(
      host(fixture).querySelector('[data-testid="booking-flexible-toggle"]'),
    ).toBeNull();
  });

  it('docks exactly the pick, jump-to-today and the forward move', () => {
    expect(barControls(fixture)).toEqual([
      'booking-time-pick',
      'booking-scroll-today',
      'booking-schedule-continue',
    ]);
  });

  // The waitlist survives as the bell INSIDE the sheet, watching the one
  // chosen day — never as a control on the page bar.
  it('keeps no waitlist control on the page bar', () => {
    expect(
      host(fixture).querySelector('[data-testid="booking-watch-days"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-time-watch"]'),
    ).toBeNull();
  });

  // The step's exit is a TIME: `select_schedule` takes one arrangement, and
  // the pick is the only way to choose one.
  it('blocks the forward move until a time is confirmed', () => {
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-schedule-continue"]',
      )?.disabled,
    ).toBe(true);
  });

  // Nothing to be about yet — no day is chosen on arrival.
  it('disables the time-pick until a day is chosen', () => {
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-time-pick"]',
      )?.disabled,
    ).toBe(true);
  });

  // There is exactly ONE sheet, and it only opens when asked for.
  it('opens no sheet on arrival', () => {
    expect(
      host(fixture).querySelector('[data-testid="booking-time-sheet"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-flexible-sheet"]'),
    ).toBeNull();
  });

  // The heading is ONE block — title, lede, weekday key — so it collapses on
  // one trigger. The key sits inside the heading at rest, and the bar
  // re-renders that same template beside the collapsed title once the block
  // has gone under. An earlier pass pinned the key separately: the title
  // landed at one scroll position and the key at another, each with its own
  // fade, which is one block behaving as two.
  it('closes its heading with the weekday key, inside the scroller', () => {
    const head = host(fixture).querySelector('.booking-schedule__head');
    expect(head).not.toBeNull();
    expect(head?.querySelector('.booking-schedule__weekdays')).not.toBeNull();
  });

  it('keeps BOTH rows out of the bar until the heading collapses', () => {
    // jsdom cannot scroll, so what is assertable is the uncollapsed end of the
    // contract: the bar carries neither the title nor the key while the
    // heading is still on screen carrying both. They move as one.
    expect(
      host(fixture).querySelector('[data-testid="booking-collapsed-title"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-chrome-accessory"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector(
        '.booking-schedule__head .booking-schedule__weekdays',
      ),
    ).not.toBeNull();
  });

  // Nothing on this screen rolls its own gradient — the wizard toolbar's scrim
  // is the only fade, exactly as on every other step.
  it('leaves the calendar free of any pinned header of its own', () => {
    expect(
      host(fixture).querySelector('.ui-calendar-scroller__key'),
    ).toBeNull();
  });
});

// ── A shop that cannot serve the visit ──────────────────────────────────
//
// The grid runs a shop only if it offers every service on the visit
// (`shopsServingParty`): the server refuses a seat at a shop that does not
// offer its service. The projection knows nothing of services, so without
// the step saying so, such a shop showed a calendar of live days whose every
// sheet said "this day is busy" — and offered a waitlist for a shop that will
// never have a time for this party.
describe('BookingScheduleStep — a shop that cannot serve the visit', () => {
  const CENTER_ONLY = [service('cut', ['loc-center'])];
  const SHOPS = [shop('loc-center', 'Center'), shop('loc-mladost', 'Mladost')];
  const BARBERS = [barber('ivan')];

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  function notice(
    fixture: ComponentFixture<ClientBooking>,
  ): HTMLElement | null {
    return host(fixture).querySelector('[data-testid="booking-shop-scope"]');
  }

  function days(fixture: ComponentFixture<ClientBooking>): HTMLButtonElement[] {
    return [
      ...host(fixture).querySelectorAll<HTMLButtonElement>(
        '[data-testid="booking-day"]',
      ),
    ];
  }

  function store(fixture: ComponentFixture<ClientBooking>): BookingFlowStore {
    return fixture.debugElement.injector.get(BookingFlowStore);
  }

  it('says the chosen shop does not offer it, greys every day, and names the shop that does', async () => {
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      capacity: roomEveryDay,
      shopId: 'loc-mladost',
    });

    expect(notice(fixture)?.getAttribute('data-reach')).toBe('elsewhere');
    expect(notice(fixture)?.textContent).toContain('NOT_HERE:Mladost');
    expect(notice(fixture)?.textContent).toContain('THERE:Center');
    // Not one tappable day at a shop the grid never runs for this visit —
    // even though the projection has room on every one of them.
    expect(days(fixture).length).toBeGreaterThan(0);
    expect(days(fixture).every((day) => day.disabled)).toBe(true);
  });

  it('opens no time sheet there — never "this day is busy" and a waitlist bell', async () => {
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      capacity: roomEveryDay,
      shopId: 'loc-mladost',
    });
    // A day already chosen (a draft, a deep link) opens nothing either.
    store(fixture).selectDay('2026-08-04', 'Europe/Sofia');
    fixture.detectChanges();

    const pick = host(fixture).querySelector<HTMLButtonElement>(
      '[data-testid="booking-time-pick"]',
    );
    expect(pick?.disabled).toBe(true);
    pick?.click();
    fixture.detectChanges();
    expect(
      host(fixture).querySelector('[data-testid="booking-time-sheet"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-no-times"]'),
    ).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-time-watch"]'),
    ).toBeNull();
  });

  it('takes the visit to the shop that serves it in one tap, and the days come back', async () => {
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      capacity: roomEveryDay,
      shopId: 'loc-mladost',
    });

    const button = host(fixture).querySelector<HTMLButtonElement>(
      '[data-testid="booking-shop-scope-switch"]',
    );
    expect(button?.textContent?.trim()).toBe('SWITCH:Center');
    button?.click();
    await settle(fixture);

    expect(store(fixture).locationId()?.value).toBe('loc-center');
    expect(notice(fixture)).toBeNull();
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-day"][data-day-key="2026-08-04"]',
      )?.disabled,
    ).toBe(false);
  });

  it('says nothing at a shop that serves the visit', async () => {
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      capacity: roomEveryDay,
      shopId: 'loc-center',
    });

    expect(notice(fixture)).toBeNull();
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-day"][data-day-key="2026-08-04"]',
      )?.disabled,
    ).toBe(false);
  });

  it('asks the projection about the ONE shop that can serve the visit under “any shop”', async () => {
    const asked: (string | null)[] = [];
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      capacity: (locationId) => {
        asked.push(locationId?.value ?? null);
        // Only Mladost has room: a day live for its chairs would open a
        // sheet that can only say "busy", since the grid never runs it.
        return locationId?.value === 'loc-center'
          ? new Map<string, number>()
          : roomEveryDay();
      },
    });

    expect(notice(fixture)).toBeNull();
    expect(asked.at(-1)).toBe('loc-center');
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-day"][data-day-key="2026-08-04"]',
      )?.disabled,
    ).toBe(true);
  });

  it('sends the visit back to its services when no active shop offers all of it', async () => {
    const fixture = await toSchedule({
      // Offered only at a shop that has since closed.
      services: [service('cut', ['loc-closed'])],
      barbers: BARBERS,
      locations: SHOPS,
      capacity: roomEveryDay,
    });

    expect(notice(fixture)?.getAttribute('data-reach')).toBe('nowhere');
    expect(days(fixture).every((day) => day.disabled)).toBe(true);

    click(fixture, 'booking-shop-scope-services');
    await settle(fixture);
    expect(host(fixture).getAttribute('data-state')).toBe('services');
  });

  it.each(['pending', 'failed'] as const)(
    'says nothing while the shop read is %s — a list that never arrived is not “no shop”',
    async (locations) => {
      const fixture = await toSchedule({
        services: [service('cut', ['loc-closed'])],
        barbers: BARBERS,
        locations,
        capacity: roomEveryDay,
      });

      expect(notice(fixture)).toBeNull();
    },
  );

  // No active shop at all is an outage, not something the visit's services
  // shut out: «Промени услугите» would send the client round a loop.
  it('says nothing when the shops have answered with none — no change to the services would open one', async () => {
    const fixture = await toSchedule({
      services: [service('cut', ['loc-closed'])],
      barbers: BARBERS,
      locations: [],
      capacity: roomEveryDay,
    });

    expect(notice(fixture)).toBeNull();
  });
});

// ── A visit that asks for its barber ────────────────────────────────────
//
// The projection sums the free minutes of the barbers it is asked about.
// Asked about EVERY barber, a bag pinned to Ivan saw each day another chair
// had room on as live — every Friday at Center in the dev roster, where Ivan
// works Mladost — and each of those days opened a sheet that could only say
// "busy" (the rebooking e2e's day, 2026-09-26).
describe('BookingScheduleStep — a visit that asks for its barber', () => {
  const SHOPS = [shop('loc-center', 'Center')];
  const BARBERS = [barber('ivan'), barber('niko')];

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  /** Room for Niko on every day; none for Ivan. */
  function roomForNikoOnly(
    _locationId: LocationId | null,
    barberIds: readonly string[],
  ): ReadonlyMap<string, number> {
    return barberIds.includes('niko') ? roomEveryDay() : new Map();
  }

  function day(fixture: ComponentFixture<ClientBooking>, key: string) {
    return host(fixture).querySelector<HTMLButtonElement>(
      `[data-testid="booking-day"][data-day-key="${key}"]`,
    );
  }

  it('asks the projection about that barber alone, and greys the days only other chairs have room on', async () => {
    const asked: (readonly string[])[] = [];
    const fixture = await toSchedule({
      barbers: BARBERS,
      locations: SHOPS,
      shopId: 'loc-center',
      barberId: 'ivan',
      capacity: (locationId, barberIds) => {
        asked.push(barberIds);
        return roomForNikoOnly(locationId, barberIds);
      },
    });

    expect(asked.at(-1)).toEqual(['ivan']);
    expect(day(fixture, '2026-08-04')?.disabled).toBe(true);
  });

  it('still asks about every barber when the line takes anyone', async () => {
    const asked: (readonly string[])[] = [];
    const fixture = await toSchedule({
      barbers: BARBERS,
      locations: SHOPS,
      shopId: 'loc-center',
      capacity: (locationId, barberIds) => {
        asked.push(barberIds);
        return roomForNikoOnly(locationId, barberIds);
      },
    });

    expect(asked.at(-1)).toEqual(['ivan', 'niko']);
    expect(day(fixture, '2026-08-04')?.disabled).toBe(false);
  });
});
