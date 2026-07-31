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
  BarberId,
  CATALOG_READER,
  MEDIA_READER,
  Service,
} from '@creativo/application/catalog';
import {
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BarberPref,
  SeatKey,
  ok,
} from '@creativo/application/booking';
import { SessionStorageDraftStore } from '@creativo/infrastructure/web-storage';
import { BookingFlowStore } from '../booking-flow.store';
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
  /**
   * Who performs it and on what terms. Defaults to ONE performer, so most
   * fixtures resolve to a single price; pass two with different rates to
   * exercise the span an unpinned barber leaves open.
   */
  performers?: readonly { id: string; minor: number; minutes: number }[];
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
    offerings: (
      props.performers ?? [{ id: 'ivan', minor: 1450, minutes: 35 }]
    ).map((performer) => ({
      barberId: performer.id,
      base: {
        priceMinorUnits: performer.minor,
        currencyCode: 'EUR',
        durationMinutes: performer.minutes,
      },
    })),
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
  // TWO performers on different terms — the only service in the fixture whose
  // price is a span while nobody is pinned.
  service({
    id: 'beard',
    performers: [
      { id: 'ivan', minor: 1450, minutes: 35 },
      { id: 'niko', minor: 1300, minutes: 30 },
    ],
  }),
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

/** The four steps between a card on the shelf and a line in the bag. */
async function addLine(
  fixture: ComponentFixture<ClientBooking>,
  cardTestId: string,
  variantTestId?: string,
): Promise<void> {
  click(fixture, cardTestId);
  await fixture.whenStable();
  fixture.detectChanges();
  answer(fixture, variantTestId);
  click(fixture, 'booking-add-to-bag');
  await fixture.whenStable();
  fixture.detectChanges();
}

/**
 * The bag's rows, as one whitespace-collapsed string each.
 *
 * Queried by PREFIX, never by `booking-bag-line-line-0`: a line id is minted
 * from a monotonic counter, not a position, so the first row after a removal
 * is not `line-0`.
 */
function bagLines(fixture: ComponentFixture<ClientBooking>): string[] {
  return [
    ...host(fixture).querySelectorAll('[data-testid^="booking-bag-line-"]'),
  ].map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/**
 * The rows' prices and durations, each read from its OWN element.
 *
 * Never off the row's full `textContent`: the pull-down surfaces stay mounted
 * while closed, so every performer's terms are in there too — an assertion
 * that a line does NOT say 14,50 € would trip over the option offering it.
 */
function bagPrices(fixture: ComponentFixture<ClientBooking>): string[] {
  return bagText(fixture, 'booking-bag-price-');
}

function bagDurations(fixture: ComponentFixture<ClientBooking>): string[] {
  return bagText(fixture, 'booking-bag-duration-');
}

function bagText(
  fixture: ComponentFixture<ClientBooking>,
  prefix: string,
): string[] {
  return [...host(fixture).querySelectorAll(`[data-testid^="${prefix}"]`)].map(
    (node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
}

function bagRemoves(
  fixture: ComponentFixture<ClientBooking>,
): HTMLButtonElement[] {
  return [
    ...host(fixture).querySelectorAll<HTMLButtonElement>(
      '[data-testid^="booking-bag-remove-"]',
    ),
  ];
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

  // ── The bag ───────────────────────────────────────────────────────────
  //
  // The bag went untested through its whole first life, which is how it kept
  // a sheet body with no inline gutter (its own title ran off the leading
  // edge) and a row that named a service without saying what it cost. These
  // pin the four things the redesign actually promises: the money, the
  // grouping, the closing, and the way back into a line.
  describe('the bag', () => {
    it('states each line with its price and duration, and sums them on the bar', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-cut', 'booking-variant-short');
      await addLine(fixture, 'service-card-beard');
      click(fixture, 'booking-bag-trigger');

      expect(bagLines(fixture)).toHaveLength(2);
      const prices = bagPrices(fixture);
      // `cut` has one performer, so "anyone" still resolves to a point — and
      // it is IVAN's 14,50 € for 35 minutes, not the catalog's 15,00 € base.
      // Nobody charges the base; quoting it would be quoting a price this
      // booking cannot cost.
      expect(prices[0]).toContain('14,50');
      expect(prices[0]).not.toContain('–');
      expect(bagDurations(fixture)[0]).toContain('35');
      // `beard` has two, on different terms — so it spans, both ends shown.
      expect(prices[1]).toContain('13,00');
      expect(prices[1]).toContain('14,50');
      expect(bagDurations(fixture)[1]).toContain('30');

      // Floors add to the floor and ceilings to the ceiling: 14,50 + [13,00 …
      // 14,50] is 27,50 – 29,00 €, not a single number at either end.
      const total = host(fixture).querySelector(
        '[data-testid="booking-bag-total"]',
      )?.textContent;
      expect(total).toContain('27,50');
      expect(total).toContain('29,00');
    });

    it('collapses the span the moment a performer is pinned', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-beard');
      click(fixture, 'booking-bag-trigger');

      // Open while nobody is pinned…
      expect(bagPrices(fixture)[0]).toContain('13,00');
      expect(bagPrices(fixture)[0]).toContain('14,50');

      // …and one number once somebody is. (Driven through the store rather
      // than the menu: the fixture publishes no barber VMs, so the pull-down
      // renders "anyone" alone — the span logic is what is under test.)
      // Component-scoped, not root — one store per `/book` visit, so it comes
      // from the shell's own injector rather than the TestBed's.
      const store = fixture.debugElement.injector.get(BookingFlowStore);
      const cart = store.cart();
      const line = cart?.linesFor(SeatKey.self())[0];
      const barberId = BarberId.create('niko');
      if (!line || barberId.isFailure()) throw new Error('bad fixture');
      store.setLineBarber(
        SeatKey.self(),
        line.id,
        BarberPref.specific(barberId.value),
      );
      fixture.detectChanges();

      expect(bagPrices(fixture)[0]).toContain('13,00');
      expect(bagPrices(fixture)[0]).not.toContain('14,50');
      expect(bagDurations(fixture)[0]).toContain('30');
      expect(
        host(fixture).querySelector('[data-testid="booking-bag-total"]')
          ?.textContent,
      ).not.toContain('–');
    });

    it('gives every person their own shelf and their own subtotal', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-cut', 'booking-variant-short');
      // A guest joins and takes something of their own — adding one switches
      // the scope to them, so this lands on the guest.
      click(fixture, 'booking-add-guest');
      await fixture.whenStable();
      fixture.detectChanges();
      await addLine(fixture, 'service-card-beard');
      click(fixture, 'booking-bag-trigger');

      expect(
        [
          ...host(fixture).querySelectorAll(
            '[data-testid^="booking-bag-group-"]',
          ),
        ].map((group) => group.getAttribute('data-testid')),
      ).toEqual(['booking-bag-group-self', 'booking-bag-group-guest-0']);

      const subtotals = [
        ...host(fixture).querySelectorAll(
          '[data-testid^="booking-bag-subtotal-"]',
        ),
      ].map((sum) => sum.textContent?.trim());
      expect(subtotals).toHaveLength(2);
      // The booker's pinned-by-arithmetic `cut`, then the guest's spanning
      // `beard` — each person's own bottom line, not a share of one total.
      expect(subtotals[0]).toContain('14,50');
      expect(subtotals[1]).toContain('13,00');
      expect(subtotals[1]).toContain('14,50');
    });

    it('re-sums when a line goes, and stays open while anything is left', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-cut', 'booking-variant-short');
      await addLine(fixture, 'service-card-beard');
      click(fixture, 'booking-bag-trigger');

      bagRemoves(fixture)[0]?.click();
      fixture.detectChanges();

      expect(bagLines(fixture)).toHaveLength(1);
      expect(
        host(fixture).querySelector('[data-testid="booking-bag-sheet"]'),
      ).not.toBeNull();
      expect(
        host(fixture).querySelector('[data-testid="booking-bag-total"]')
          ?.textContent,
      ).toContain('13,00');
    });

    it('closes itself when the last line is removed — an empty bag is not a screen', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-cut', 'booking-variant-short');
      click(fixture, 'booking-bag-trigger');
      expect(
        host(fixture).querySelector('[data-testid="booking-bag-sheet"]'),
      ).not.toBeNull();

      bagRemoves(fixture)[0]?.click();
      fixture.detectChanges();

      expect(
        host(fixture).querySelector('[data-testid="booking-bag-sheet"]'),
      ).toBeNull();
      // …and there is no way back in to be stranded behind.
      expect(
        host(fixture).querySelector<HTMLButtonElement>(
          '[data-testid="booking-bag-trigger"]',
        )?.disabled,
      ).toBe(true);
    });

    it('reopens a line in the full sheet, scoped to the person who holds it', async () => {
      const fixture = await toServices();
      click(fixture, 'booking-add-guest');
      await fixture.whenStable();
      fixture.detectChanges();
      await addLine(fixture, 'service-card-beard');
      click(fixture, 'booking-bag-trigger');

      host(fixture)
        .querySelector<HTMLButtonElement>('[data-testid^="booking-bag-edit-"]')
        ?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // The bag gets out of the way, the line's own sheet opens, and the
      // scope points at the guest — committing through the booker's scope
      // would move the line between people.
      expect(
        host(fixture).querySelector('[data-testid="booking-bag-sheet"]'),
      ).toBeNull();
      expect(
        host(fixture).querySelector('[data-testid="booking-remove-line"]'),
      ).not.toBeNull();
      expect(
        host(fixture)
          .querySelector('[data-testid="booking-seat-guest-0"]')
          ?.hasAttribute('data-selected'),
      ).toBe(true);
    });
  });
});
