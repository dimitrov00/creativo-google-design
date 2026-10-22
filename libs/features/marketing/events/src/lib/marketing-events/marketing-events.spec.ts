import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  PROFILE_PORTS,
  SHOP_EVENT_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { ShopEvent } from '@core/entities';
import type { EventsQuery, ShopEventReadPorts } from '@core/ports';
import { LocalDate } from '@core/primitives';
import {
  at,
  FIXTURE_EVENT_DAY,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
  memoryShopEventReadPorts,
  shopEventOf,
} from '@core/testing';
import { LanguageService } from '@creativo/features/shared/shell';
import { MarketingEvents } from './marketing-events';

/*
 * Time is pinned: the page's clock is `CLOCK_PORTS` at `FIXTURE_NOW_UTC_MS`
 * (2026-09-28 09:00 in Sofia), and every event sits on a fixed shop day —
 * `FIXTURE_EVENT_DAY` (Monday 2026-10-05) and after for upcoming, a week
 * before `FIXTURE_TODAY` for past. Nothing reads the wall clock.
 */

/** An upcoming event on `FIXTURE_EVENT_DAY` (+ `dayOffset`) at `hh:mm` shop time. */
function event(id: string, dayOffset = 0, hours = 19, minutes = 0): ShopEvent {
  return shopEventOf(id, {
    localDate: LocalDate.addDays(FIXTURE_EVENT_DAY, dayOffset),
    startMinutes: at(hours, minutes),
  });
}

/** A past event — a week before `FIXTURE_TODAY`, 19:00 shop time. */
function pastEvent(id: string): ShopEvent {
  return shopEventOf(id, { localDate: LocalDate.addDays(FIXTURE_TODAY, -7) });
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

/**
 * The page's read over the memory double (which splits the seeded events on
 * the query's instant, as the adapter's `utcEpochMs` range does), every
 * query it makes recorded in `asked`.
 */
function recordedEventReads(
  events: readonly ShopEvent[],
  asked: EventsQuery[],
): ShopEventReadPorts {
  const reads = memoryShopEventReadPorts(memoryProgramsWorld({ events }));
  return {
    observeEvents: (query) => {
      asked.push(query);
      return reads.observeEvents(query);
    },
  };
}

async function configure(
  upcoming: readonly ShopEvent[],
  past: readonly ShopEvent[] = [],
  asked: EventsQuery[] = [],
): Promise<ComponentFixture<MarketingEvents>> {
  await TestBed.configureTestingModule({
    imports: [MarketingEvents],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: SHOP_EVENT_READ_PORTS,
        useValue: recordedEventReads([...upcoming, ...past], asked),
      },
      { provide: CLOCK_PORTS, useValue: memoryClockPorts(FIXTURE_NOW_UTC_MS) },
      // An anonymous visitor: the session double's default principal.
      { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
      // The shared session model behind that chrome reads the profile.
      { provide: PROFILE_PORTS, useValue: memoryProfilePorts(new Map()) },
      // …and its menu counts upcoming visits.
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: memoryAppointmentReadPorts([]),
      },
      // …and its schedule row names the default location's shop day.
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(
          memoryProgramsWorld({ locations: [locationFixture()] }),
        ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingEvents);
}

describe('MarketingEvents', () => {
  it('defaults to the Upcoming tab and shows its empty state with an Instagram fallback', async () => {
    const fixture = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="events-empty"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="events-empty"] a[href*="instagram"]'),
    ).not.toBeNull();
  });

  it('lists upcoming events on the default tab', async () => {
    const fixture = await configure([event('event_1')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="events-list"]');
    expect(list?.querySelectorAll('a[uilistrow]').length).toBe(1);
  });

  it('switches to the Past tab and re-queries, with no Instagram fallback in its empty state', async () => {
    const asked: EventsQuery[] = [];
    const fixture = await configure([], [], asked);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector('[data-testid="events-tab-past"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="events-empty"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="events-empty"] a[href*="instagram"]'),
    ).toBeNull();
    // The past tab re-queries the other side of the same pinned now.
    expect(asked).toEqual([
      { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: true },
      { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: false },
    ]);
  });

  it('lists past events on the Past tab, split on the pinned now', async () => {
    const fixture = await configure([event('event_1')], [pastEvent('event_0')]);
    const host = await render(fixture, 'en');
    expect(rowDates(host)).toEqual(['Mon, Oct 5, 07:00 PM']);
    (
      host.querySelector('[data-testid="events-tab-past"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowDates(host)).toEqual(['Mon, Sep 21, 07:00 PM']);
  });

  // Flip 4, F4-11: a row's date is the shop's wall clock as stored, in the
  // active language. The expected strings are the legacy formatter's own
  // output for the same events (its zoned `toLocaleString` with these
  // options, run once before the flip), so the pins prove fidelity.
  it("formats each row's date from the shop wall clock in en", async () => {
    const host = await render(
      await configure([event('event_1'), event('event_2', 1, 9, 5)]),
      'en',
    );

    expect(rowDates(host)).toEqual([
      'Mon, Oct 5, 07:00 PM',
      'Tue, Oct 6, 09:05 AM',
    ]);
  });

  it("formats each row's date from the shop wall clock in bg", async () => {
    const host = await render(
      await configure([event('event_1'), event('event_2', 1, 9, 5)]),
      'bg',
    );

    expect(rowDates(host)).toEqual(['пн, 5.10, 19:00', 'вт, 6.10, 09:05']);
  });
});

/**
 * Renders in `lang`. The shell's language service applies its own default
 * (`bg`) when the chrome first creates it — in the app, long before a row
 * arrives; here the memory read answers in the same pass — so it is booted
 * first and the visitor's language is applied after it.
 */
async function render(
  fixture: ComponentFixture<MarketingEvents>,
  lang: 'en' | 'bg',
): Promise<HTMLElement> {
  TestBed.inject(LanguageService);
  TestBed.inject(TranslocoService).setActiveLang(lang);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement;
}

/** Each listed row's formatted date, in order. */
function rowDates(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll(
      '[data-testid="events-list"] a[uilistrow] [uifont="footnote"]',
    ),
    (cell) => cell.textContent?.trim() ?? '',
  );
}
