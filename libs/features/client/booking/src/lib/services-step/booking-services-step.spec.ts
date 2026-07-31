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
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  ok,
} from '@creativo/application/booking';
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

/** Mirrors the seeded shape: a haircut family plus a bundle that holds one. */
function service(props: {
  id: string;
  conflictsWith?: readonly string[];
  includes?: readonly string[];
  variants?: readonly string[];
}): Service {
  const result = Service.create({
    id: props.id,
    name: { en: props.id, bg: props.id },
    description: { en: 'x', bg: 'x' },
    categoryId: 'cat-hair',
    priceMinorUnits: 1500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    variants: (props.variants ?? []).map((id) => ({
      id,
      name: { en: id, bg: id },
    })),
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
    conflictsWith: [...(props.conflictsWith ?? [])],
    composition: props.includes
      ? { kind: 'bundle', includes: [...props.includes] }
      : { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 0,
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

const CATALOG = [
  service({ id: 'cut', conflictsWith: ['fade'], variants: ['short', 'long'] }),
  service({ id: 'fade', conflictsWith: ['cut'] }),
  service({ id: 'beard' }),
  service({ id: 'full-care', includes: ['cut', 'beard'] }),
];

async function renderShell(): Promise<ComponentFixture<ClientBooking>> {
  await TestBed.configureTestingModule({
    imports: [ClientBooking],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: BOOKING_DRAFT_STORE, useClass: SessionStorageDraftStore },
      // The store holds the gateway because `commit()` is the only way an
      // appointment is created; these specs never reach the review step, so a
      // stub that would fail loudly if called is the honest double.
      {
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: () => Promise.reject(new Error('not used in this spec')),
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

/** The shell, walked past WHERE — step 1 is optional, so take "any shop". */
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
 * Choose a value the way a person does — open the pull-down, then pick.
 *
 * Clicking the item alone would pass even if the trigger were dead, since the
 * menu surface stays mounted while closed.
 */
function pick(
  fixture: ComponentFixture<ClientBooking>,
  menuTestId: string,
  itemTestId: string,
): void {
  click(fixture, menuTestId);
  click(fixture, itemTestId);
}

/**
 * Answer both selects the way a person does.
 *
 * The barber is a REQUIRED answer even though "anyone" is its widest one, so
 * every path to a committed line goes through it.
 */
function answer(
  fixture: ComponentFixture<ClientBooking>,
  variantTestId?: string,
): void {
  if (variantTestId) pick(fixture, 'booking-variant-menu', variantTestId);
  pick(fixture, 'booking-barber-menu', 'booking-barber-any');
}

/** Walk past the party step onto the catalog. */
async function toServices(): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await render();
  click(fixture, 'booking-party-continue');
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function blockedIds(fixture: ComponentFixture<ClientBooking>): string[] {
  return [...host(fixture).querySelectorAll('cr-service-card[data-blocked]')]
    .map(
      (card) =>
        card
          .querySelector('[data-testid^="service-card-"]')
          ?.getAttribute('data-testid')
          ?.replace('service-card-', '') ?? '',
    )
    .sort();
}

describe('BookingServicesStep', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('renders the catalog and hides the person scope for a party of one', async () => {
    const fixture = await toServices();
    expect(
      host(fixture).querySelector('[data-testid="booking-catalog"]'),
    ).not.toBeNull();
    // A scope control with one option asks a question with one answer.
    expect(
      host(fixture).querySelector('[data-testid="booking-seat-scope"]'),
    ).toBeNull();
  });

  it('shows the person scope once there IS a party', async () => {
    const fixture = await render();
    click(fixture, 'booking-add-guest');
    click(fixture, 'booking-party-continue');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host(fixture).querySelector('[data-testid="booking-seat-scope"]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="booking-seat-guest-0"]'),
    ).not.toBeNull();
  });

  it('gates the CTA until BOTH selects are answered', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();

    const cta = () =>
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-add-to-bag"]',
      );
    expect(cta()?.disabled).toBe(true);

    // A variant alone is not enough: "anyone" is a real answer, but it has
    // to be given rather than assumed.
    pick(fixture, 'booking-variant-menu', 'booking-variant-short');
    expect(cta()?.disabled).toBe(true);

    pick(fixture, 'booking-barber-menu', 'booking-barber-any');
    expect(cta()?.disabled).toBe(false);
  });

  it('opens with NOTHING pre-picked — both selects ASK', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host(fixture)
        .querySelector('[data-testid="booking-variant-menu"]')
        ?.hasAttribute('data-unset'),
    ).toBe(true);
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-barber-menu"]')
        ?.hasAttribute('data-unset'),
    ).toBe(true);
  });

  it('states each choice on its own select, and closes it on a pick', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger = () =>
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-variant-menu"]',
      );

    click(fixture, 'booking-variant-menu');
    expect(trigger()?.closest('.ui-menu')?.hasAttribute('data-open')).toBe(
      true,
    );

    click(fixture, 'booking-variant-long');
    expect(trigger()?.hasAttribute('data-unset')).toBe(false);
    expect(trigger()?.textContent).toContain('long');
    expect(trigger()?.closest('.ui-menu')?.hasAttribute('data-open')).toBe(
      false,
    );
  });

  it('skips the variant select entirely when the service declares none', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host(fixture).querySelector('[data-testid="booking-variant-menu"]'),
    ).toBeNull();
    // …and the barber alone opens the gate.
    pick(fixture, 'booking-barber-menu', 'booking-barber-any');
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-add-to-bag"]',
      )?.disabled,
    ).toBe(false);
  });

  it('offers a way OUT only once the service is actually held', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();
    // Nothing to remove yet.
    expect(
      host(fixture).querySelector('[data-testid="booking-remove-line"]'),
    ).toBeNull();

    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // Reopening the same card edits the held line — and can drop it.
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host(fixture).querySelector('[data-testid="booking-remove-line"]'),
    ).not.toBeNull();

    click(fixture, 'booking-remove-line');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host(fixture).querySelector('cr-service-card[data-selected]'),
    ).toBeNull();
  });

  it('adds a configured line to the active seat', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture, 'booking-variant-short');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host(fixture).querySelector('cr-service-card[data-selected]'),
    ).not.toBeNull();
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-services-continue"]',
      )?.disabled,
    ).toBe(false);
  });

  it('locks conflicting services — authored, and INHERITED through a bundle', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture, 'booking-variant-short');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // `fade` is the authored conflict; `full-care` CONTAINS the cut, so it
    // is blocked by composition. `beard` is complementary and stays open.
    expect(blockedIds(fixture)).toEqual(['fade', 'full-care']);
  });

  it('leaves a blocked card pressable, and explains itself inside the sheet', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture, 'booking-variant-short');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // Blocked is not disabled — the press IS how the explanation is reached.
    const fadeCard = host(fixture).querySelector<HTMLButtonElement>(
      '[data-testid="service-card-fade"]',
    );
    expect(fadeCard?.disabled).toBe(false);

    fadeCard?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The explanation is an ORNAMENT on the bar, beside the action that
    // resolves it. It is NOT dismissible: it is the reason that action says
    // "replace" rather than "add".
    expect(
      host(fixture).querySelector('[data-testid="booking-conflict-notice"]'),
    ).not.toBeNull();
    // The way OUT of the conflict is the CTA itself, renamed — it opens once
    // the two selects are answered, exactly like any other add.
    const cta = () =>
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-add-to-bag"]',
      );
    expect(cta()?.textContent).toContain('replace');
    answer(fixture);
    expect(cta()?.disabled).toBe(false);
  });

  it('swaps the blocker for the candidate in one press', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture, 'booking-variant-short');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    click(fixture, 'service-card-fade');
    await fixture.whenStable();
    fixture.detectChanges();
    // `fade` declares no variants, so the form has nothing to ask and the
    // confirm is live the moment it opens.
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // One line still — swapped, not stacked — and the lock has moved.
    const selected = [
      ...host(fixture).querySelectorAll('cr-service-card[data-selected]'),
    ].map((card) =>
      card
        .querySelector('[data-testid^="service-card-"]')
        ?.getAttribute('data-testid')
        ?.replace('service-card-', ''),
    );
    expect(selected).toEqual(['fade']);
    expect(blockedIds(fixture)).toContain('cut');
  });

  it('refuses to destroy the blocker until the replacement is fully chosen', async () => {
    // Replace used to remove the blocking lines and THEN call an add that
    // silently bailed on an unchosen variant — leaving the seat with neither.
    const fixture = await toServices();
    click(fixture, 'service-card-fade');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // `cut` is now blocked by `fade`, and it declares variants.
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-add-to-bag"]',
      )?.disabled,
    ).toBe(true);

    // Force the press anyway: nothing may be removed.
    host(fixture)
      .querySelector<HTMLButtonElement>('[data-testid="booking-add-to-bag"]')
      ?.removeAttribute('disabled');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    const selected = [
      ...host(fixture).querySelectorAll('cr-service-card[data-selected]'),
    ].map((card) =>
      card
        .querySelector('[data-testid^="service-card-"]')
        ?.getAttribute('data-testid')
        ?.replace('service-card-', ''),
    );
    expect(selected).toEqual(['fade']);
  });

  it('leaves the step even when the ACTIVE person is the empty one', async () => {
    // Regression: "next empty person" wrapped all the way round onto the seat
    // already selected, so the CTA handed over to the person you were on —
    // a `set` of the value the signal already held, which notifies nothing.
    // The button went permanently dead with no way off the step.
    const fixture = await toServices();
    click(fixture, 'booking-add-guest');
    await fixture.whenStable();
    fixture.detectChanges();

    // The guest is active after being added — give them the only service.
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // The CTA hands over to the booker, who has nothing…
    click(fixture, 'booking-services-continue');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host(fixture)
        .querySelector('[data-testid="booking-seat-self"]')
        ?.hasAttribute('data-selected'),
    ).toBe(true);

    // …and now the CTA is the FORWARD move, not another hand-over to the
    // person it is already on. (Asserted on the label rather than by pressing
    // through: the next step needs ports this harness does not provide, and
    // the regression is entirely in what "next empty person" returns.)
    expect(
      host(fixture).querySelector('[data-testid="booking-services-continue"]')
        ?.textContent,
    ).toContain('booking.continue');
  });

  it('scopes conflicts to ONE seat — the same service stays open for a guest', async () => {
    const fixture = await toServices();
    // The booker takes the cut, THEN a guest joins — the party is assembled
    // on this step now.
    click(fixture, 'service-card-cut');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture, 'booking-variant-short');
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(blockedIds(fixture)).toEqual(['fade', 'full-care']);

    // Adding a guest switches to them, and their chair is empty — so the
    // locks clear.
    click(fixture, 'booking-add-guest');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(blockedIds(fixture)).toEqual([]);
  });
});
