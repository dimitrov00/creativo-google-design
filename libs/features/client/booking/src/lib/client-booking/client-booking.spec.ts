import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BOOKING_POLICY_READER,
  ZonedDateTime,
  BookingPolicy,
  WAITLIST_GATEWAY,
  APPOINTMENT_REPOSITORY,
  WAITLIST_READER,
  MAX_PARTY_SIZE,
  ok,
} from '@creativo/application/booking';
import { CATALOG_READER, MEDIA_READER } from '@creativo/application/catalog';
import { CLOCK } from '@creativo/application/shared';
import { SessionStorageDraftStore } from '@creativo/infrastructure/web-storage';
import { ClientBooking } from './client-booking';

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
): Promise<ComponentFixture<ClientBooking>> {
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
        provide: BOOKING_POLICY_READER,
        useValue: { observe: () => of(BookingPolicy.default()) },
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
          listActiveServices: () => of(ok([])),
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

  // The URL is read in the shell's constructor, so it has to be in place
  // BEFORE the component exists — same as a real navigation.
  if (Object.keys(entryParams).length > 0) {
    await TestBed.inject(Router).navigate([], { queryParams: entryParams });
  }

  const fixture = TestBed.createComponent(ClientBooking);
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
