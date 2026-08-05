import { EnvironmentProviders, Injectable } from '@angular/core';
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
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
} from '@creativo/application/identity';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import {
  CATALOG_READER,
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
  ok,
} from '@creativo/application/booking';
import { CLOCK } from '@creativo/application/shared';
import { SessionStorageDraftStore } from '@creativo/infrastructure/web-storage';
import { ClientBooking } from '../client-booking/client-booking';

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

function service(id: string): Service {
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
    locationIds: [],
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
async function renderShell(): Promise<ComponentFixture<ClientBooking>> {
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
          observeRangeCapacity: () => of(ok(new Map<string, number>())),
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
        useValue: { getProfile: () => Promise.resolve(ok(null)) },
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
          listActiveServices: () => of(ok(CATALOG)),
          listActiveBarbers: () => of(ok([])),
          listServiceCategories: () => of(ok([])),
          listActiveLocations: () => of(ok([])),
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
async function toSchedule(): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await renderShell();

  click(fixture, 'booking-location-continue');
  await settle(fixture);

  click(fixture, 'booking-party-continue');
  await settle(fixture);

  click(fixture, 'service-card-cut');
  await settle(fixture);
  click(fixture, 'booking-barber-menu');
  click(fixture, 'booking-barber-any');
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

function text(
  fixture: ComponentFixture<ClientBooking>,
  testId: string,
): string {
  return (
    host(fixture)
      .querySelector(`[data-testid="${testId}"]`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? ''
  );
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
