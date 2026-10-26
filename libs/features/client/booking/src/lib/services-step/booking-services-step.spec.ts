import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type Translation, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { MediaResolvePorts } from '@core/ports';
import type { Service } from '@core/entities';
import {
  BookingCart,
  BookingFlowStep,
  PartyRole,
  SeatKey,
  SeatLabel,
  SeatOccupant,
  ServiceComposition,
  SubjectRelationship,
} from '@core/components';
import {
  BarberId,
  CustomerId,
  MediaRefId,
  Result,
  SeatId,
  ServiceId,
  ServiceVariantId,
  UserId,
} from '@core/primitives';
import {
  appointmentFixture,
  memoryCatalogReadPorts,
  seatFixture,
  serviceFixture,
  termsFixture,
} from '@core/testing';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import {
  bookingPortProviders,
  provideBookingTestI18n,
} from '../../testing/booking-shell.rig';
import { BookingFlowStore } from '../booking-flow.store';
import { ClientBooking } from '../client-booking/client-booking';

/**
 * Stand-in copy for the few sentences these specs read; every other key
 * answers as itself, which is what most assertions here pin.
 */
const COPY: Translation = {
  booking: { party: { guest: 'Guest {{number}}' } },
  errors: { SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL: 'TAKEN:{{label}}' },
};

/** The booker's own cart seat key. */
const SELF = SeatKey.text(SeatKey.self());

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
  /** A cover at this Storage path. None by default. */
  cover?: string;
}): Service {
  return serviceFixture({
    ...(props.cover === undefined
      ? {}
      : {
          coverMediaId: MediaRefId.of(`media-${props.id}`),
          coverMediaPath: props.cover,
          coverMediaWidth: 1200,
          coverMediaHeight: 1500,
        }),
    id: ServiceId.of(props.id),
    name: { en: props.id, bg: props.id },
    description: { en: 'x', bg: 'x' },
    ...termsFixture(1500, 30),
    variants: (props.variants ?? []).map((id) => ({
      variantId: ServiceVariantId.of(id),
      name: { en: id, bg: id },
    })),
    offerings: (
      props.performers ?? [{ id: 'ivan', minor: 1450, minutes: 35 }]
    ).map((performer) => ({
      barberId: BarberId.of(performer.id),
      overrides: [],
      ...termsFixture(performer.minor, performer.minutes),
    })),
    locationIds: [],
    conflictsWith: (props.conflictsWith ?? []).map((id) => ServiceId.of(id)),
    ...(props.includes
      ? ServiceComposition.bundle(props.includes.map((id) => ServiceId.of(id)))
      : ServiceComposition.single()),
    sortOrder: 0,
  });
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

/** What a spec changes about the shell's world. */
interface ShellOptions {
  /** The live catalogue; `CATALOG` by default. */
  readonly catalog?: readonly Service[];
  /** How a cover resolves; to nothing by default. */
  readonly media?: MediaResolvePorts;
}

async function renderShell(
  options: ShellOptions = {},
): Promise<ComponentFixture<ClientBooking>> {
  await TestBed.configureTestingModule({
    imports: [ClientBooking],
    providers: [
      provideRouter([]),
      ...provideBookingTestI18n(COPY),
      // These specs never reach the review step: every callable answers
      // PIPELINE_UNKNOWN, the honest double for a commit nobody makes.
      ...bookingPortProviders(),
      {
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({
          services: options.catalog ?? CATALOG,
        }),
      },
      {
        provide: MEDIA_RESOLVE_PORTS,
        useValue: options.media ?? {
          resolveMedia: async () => Result.ok([]),
        },
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
async function render(
  options: ShellOptions = {},
): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await renderShell(options);
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
async function toServices(
  options: ShellOptions = {},
): Promise<ComponentFixture<ClientBooking>> {
  const fixture = await render(options);
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

  describe('the grid, per card', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Each card's cover is already on its view model (`coverSrc`, from the
    // session's one URL cache). Asking the catalogue for it by id searched
    // the whole list once per card, on every pass of the grid.
    it('reads each card’s cover off its view model, never searching the catalogue per card', async () => {
      const byId = vi.spyOn(CatalogContentService.prototype, 'coverUrl');
      const fixture = await toServices({
        catalog: [
          service({ id: 'cut', cover: 'services/cut.jpg' }),
          service({ id: 'fade' }),
        ],
        media: {
          resolveMedia: async (ref) =>
            Result.ok([
              {
                width: ref.mediaWidth,
                url: `https://cdn.test/${ref.mediaPath}`,
              },
            ]),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();

      const coverOf = (id: string) =>
        host(fixture)
          .querySelector(`[data-testid="service-card-${id}"] img`)
          ?.getAttribute('src') ?? null;
      expect(coverOf('cut')).toBe('https://cdn.test/services/cut.jpg');
      expect(coverOf('fade')).toBeNull();
      expect(byId).not.toHaveBeenCalled();
    });

    // Which cards are locked is derived once per change of the bag or the
    // catalogue. Asked per card on every pass, it searched the catalogue for
    // the card and built its blockers' view models each time.
    it('locks the cards without searching the catalogue for each one on a pass', async () => {
      const fixture = await toServices();
      await addLine(fixture, 'service-card-cut', 'booking-variant-short');
      const search = vi.spyOn(CatalogContentService.prototype, 'findService');

      // A pass of the grid that changes neither the bag nor the catalogue:
      // the held cut's sheet opens over it.
      click(fixture, 'service-card-cut');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(blockedIds(fixture)).toEqual(['fade', 'full-care']);
      // Only the service in hand is looked up by id, never every card.
      const asked = search.mock.calls.map(([serviceId]) => serviceId);
      expect(asked).not.toContain('beard');
      expect(asked).not.toContain('full-care');
    });
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

  it('keeps the rename field open on what was typed, and says why, when the name is another guest’s', async () => {
    const fixture = await toServices();
    const store = fixture.debugElement.injector.get(BookingFlowStore);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    click(fixture, 'booking-add-guest');
    await settle();
    click(fixture, 'booking-add-guest');
    await settle();
    expect(store.guests().map((guest) => guest.guestLabel)).toEqual([
      'Guest 1',
      'Guest 2',
    ]);

    // The guest just added is the active one: a second press is their menu.
    click(fixture, 'booking-seat-guest-1');
    await settle();
    click(fixture, 'booking-seat-rename-open-guest-1');
    await settle();
    const field = () =>
      host(fixture).querySelector<HTMLInputElement>(
        '[data-testid="booking-seat-rename-guest-1"]',
      );
    const refusal = () =>
      host(fixture).querySelector('[data-testid="booking-seat-rename-error"]');
    const type = (value: string) => {
      const input = field();
      if (!input) throw new Error('the rename field is not open');
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const leave = () => {
      field()?.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
    };

    type('Guest 1');
    leave();

    // Refused: the name stays, the field stays open on what was typed, and
    // the reason is said beside it.
    expect(store.guests().map((guest) => guest.guestLabel)).toEqual([
      'Guest 1',
      'Guest 2',
    ]);
    expect(field()?.value).toBe('Guest 1');
    expect(field()?.getAttribute('aria-invalid')).toBe('true');
    expect(refusal()?.textContent?.trim()).toBe('TAKEN:Guest 1');

    // The next keystroke clears it; a name nobody holds is taken.
    type('Maria');
    expect(refusal()).toBeNull();
    leave();
    expect(field()).toBeNull();
    expect(store.guests().map((guest) => guest.guestLabel)).toEqual([
      'Guest 1',
      'Maria',
    ]);
  });

  // pass D, DEP-23: the refusal is held as its struct and worded where it
  // shows, so a language switch while it is on screen re-words it (it was
  // worded once, when it was set, and stayed in the language it was raised
  // in until the next one). In that language the line is unchanged.
  it('re-words a rename refusal on screen in the language switched to', async () => {
    const fixture = await toServices();
    const transloco = TestBed.inject(TranslocoService);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    click(fixture, 'booking-add-guest');
    await settle();
    click(fixture, 'booking-add-guest');
    await settle();
    click(fixture, 'booking-seat-guest-1');
    await settle();
    click(fixture, 'booking-seat-rename-open-guest-1');
    await settle();
    const field = () =>
      host(fixture).querySelector<HTMLInputElement>(
        '[data-testid="booking-seat-rename-guest-1"]',
      );
    const refusal = () =>
      host(fixture).querySelector('[data-testid="booking-seat-rename-error"]');
    const input = field();
    if (!input) throw new Error('the rename field is not open');
    input.value = 'Guest 1';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    // Raised in bg: the bg line, with the struct's own `label`.
    expect(refusal()?.textContent?.trim()).toBe('TAKEN:Guest 1');

    // The en catalogue loaded, with its own line; then the switch.
    await firstValueFrom(transloco.load('en'));
    transloco.setTranslationKey(
      'errors.SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
      'EN-TAKEN:{{label}}',
      { lang: 'en' },
    );
    transloco.setActiveLang('en');
    await settle();

    expect(refusal()?.textContent?.trim()).toBe('EN-TAKEN:Guest 1');
    expect(field()?.getAttribute('aria-invalid')).toBe('true');
  });

  it('holds Continue and names the label when a restored draft brings two guests back under one name', async () => {
    const fixture = await toServices();
    const store = fixture.debugElement.injector.get(BookingFlowStore);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    click(fixture, 'booking-add-guest');
    await settle();
    click(fixture, 'booking-add-guest');
    await settle();
    // Everybody holds something, so only the names can hold the step.
    const fade = {
      serviceId: ServiceId.of('fade'),
      variantId: null,
      barberId: null,
      locationId: null,
    };
    store.addLine(SELF, fade);
    for (const guest of store.guests()) {
      store.addLine(SeatKey.text(SeatKey.guest(guest.guestId)), fade);
    }
    await settle();
    const proceed = () =>
      host(fixture).querySelector<HTMLButtonElement>(
        '[data-testid="booking-services-continue"]',
      );
    const notice = () =>
      host(fixture).querySelector('[data-testid="booking-seat-shared-label"]');
    expect(proceed()?.disabled).toBe(false);
    expect(notice()).toBeNull();

    // The same tab with a draft saved before the rule: both guests answer
    // to «Guest 1».
    const KEY = 'creativo.booking-draft/v2';
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as {
      party: {
        members: { partyRole: string; guestLabel?: string }[];
      };
    };
    stored.party.members = stored.party.members.map((member) =>
      member.partyRole === PartyRole.Guest
        ? { ...member, guestLabel: 'Guest 1' }
        : member,
    );
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    expect(store.restore()).toBe(true);
    await settle();

    expect(store.step()).toBe(BookingFlowStep.Services);
    expect(notice()?.textContent?.trim()).toBe('TAKEN:Guest 1');
    expect(proceed()?.disabled).toBe(true);

    // One rename, and the step lets the party go.
    const second = store.guests()[1];
    if (!second) throw new Error('bad fixture');
    expect(store.renameGuest(second.guestId, 'Maria')).toBe(true);
    await settle();
    expect(notice()).toBeNull();
    expect(proceed()?.disabled).toBe(false);
  });

  // OR-6: a new guest's placeholder is the LOWEST number nobody on screen
  // answers to, from 1 — the rule the visit prefill and the staff walk-ins
  // already number by. Past the highest guest id, it drifted from the labels
  // shown (Guest 1, Guest 2, Guest 4).
  describe('a new guest’s placeholder — the lowest free number', () => {
    async function settle(
      fixture: ComponentFixture<ClientBooking>,
    ): Promise<void> {
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function labels(fixture: ComponentFixture<ClientBooking>): string[] {
      return fixture.debugElement.injector
        .get(BookingFlowStore)
        .guests()
        .map((guest) => guest.guestLabel);
    }

    async function addGuest(
      fixture: ComponentFixture<ClientBooking>,
    ): Promise<void> {
      click(fixture, 'booking-add-guest');
      await settle(fixture);
    }

    /** Through the person's menu: a press on the ACTIVE guest opens it. */
    async function removeGuest(
      fixture: ComponentFixture<ClientBooking>,
      seatKey: string,
    ): Promise<void> {
      const removeRow = () =>
        host(fixture).querySelector(
          `[data-testid="booking-seat-remove-${seatKey}"]`,
        );
      // Another person's pill makes them the active one first.
      click(fixture, `booking-seat-${seatKey}`);
      if (removeRow() === null) click(fixture, `booking-seat-${seatKey}`);
      click(fixture, `booking-seat-remove-${seatKey}`);
      await settle(fixture);
    }

    it('hands the first guest’s number to the next one added once they are removed (DEP-F5)', async () => {
      const fixture = await toServices();
      await addGuest(fixture);
      await addGuest(fixture);
      await removeGuest(fixture, 'guest-0');
      expect(labels(fixture)).toEqual(['Guest 2']);

      await addGuest(fixture);

      expect(labels(fixture)).toEqual(['Guest 2', 'Guest 1']);
    });

    it('numbers on from the labels on screen after the last guest goes — never past a removed id', async () => {
      const fixture = await toServices();
      await addGuest(fixture);
      await addGuest(fixture);
      await removeGuest(fixture, 'guest-1');
      expect(labels(fixture)).toEqual(['Guest 1']);

      await addGuest(fixture);
      await addGuest(fixture);

      expect(labels(fixture)).toEqual(['Guest 1', 'Guest 2', 'Guest 3']);
    });

    it('starts from 1 beside a prefilled guest the visit stored as «Guest 3»', async () => {
      const fixture = await toServices();
      const store = fixture.debugElement.injector.get(BookingFlowStore);
      // "The same again" from a visit the booker made with a guest the shop
      // knew as «Guest 3» — back under that name, as the server counts them.
      const visit = appointmentFixture({
        seats: [
          seatFixture({
            seatId: SeatId.of('appt-source-seat-1'),
            serviceId: ServiceId.of('fade'),
            barberId: BarberId.of('ivan'),
            occupant: SeatOccupant.account(
              UserId.of('client-1'),
              CustomerId.of('cus_client-1'),
              SubjectRelationship.Self,
            ),
          }),
          seatFixture({
            seatId: SeatId.of('appt-source-seat-2'),
            serviceId: ServiceId.of('fade'),
            barberId: BarberId.of('ivan'),
            occupant: SeatOccupant.anonymous(SeatLabel.of('Guest 3')),
          }),
        ],
      });
      expect(store.repeat(visit, (number) => `Guest ${number}`)).toBe(true);
      store.rewindTo(BookingFlowStep.Services);
      await settle(fixture);
      expect(labels(fixture)).toEqual(['Guest 3']);

      await addGuest(fixture);

      expect(labels(fixture)).toEqual(['Guest 3', 'Guest 1']);
    });
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

  // Pass C, DEP-9: "anyone" on the add sheet quotes every performer's terms,
  // exactly as the bag quotes the same line — an offering of a barber off
  // the active list included (the fixture publishes no barber VMs, so both
  // of `beard`'s performers are off it). Before, the CTA took its span from
  // the ACTIVE performers only and fell back to the cheapest single price.
  it('quotes "anyone" across every performer on the CTA, as the bag does — even one off the active list', async () => {
    const fixture = await toServices();
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);

    const price = host(fixture)
      .querySelector('[data-testid="booking-add-price"]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
    expect(price).toContain('13,00');
    expect(price).toContain('14,50');
    expect(price).toContain('–');
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

  it('holds the step when the ACTIVE person is the empty one', async () => {
    // Two bugs meet here and the fix has to clear both.
    //
    // 1. "Next empty person" once wrapped onto the seat already selected, so
    //    the CTA "handed over" to the person you were on — a `set` of the
    //    value the signal held, which notifies nothing. The button went dead.
    // 2. The fix for (1) stopped the sweep one short of the active seat, so
    //    the person on screen could be the empty one while the CTA read
    //    "Continue" — and it continued, leaving them booking nothing.
    //
    // The sweep now sees them, and the button changes its SENTENCE rather
    // than its destination: it names whose turn it is, and goes quiet.
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

    // …and there it asks for THEM rather than offering a way past them.
    const cta = host(fixture).querySelector(
      '[data-testid="booking-services-continue"]',
    );
    expect(cta?.textContent).toContain('booking.services.pickFor');
    expect(cta?.hasAttribute('disabled')).toBe(true);
  });

  it('opens the forward move once the last empty person is served', async () => {
    const fixture = await toServices();
    click(fixture, 'booking-add-guest');
    await fixture.whenStable();
    fixture.detectChanges();

    // The guest (active) takes one…
    click(fixture, 'service-card-beard');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // …the CTA hands over to the booker, who takes one of their own.
    click(fixture, 'booking-services-continue');
    await fixture.whenStable();
    fixture.detectChanges();
    click(fixture, 'service-card-fade');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();

    // Nobody is empty, so the button is finally the forward move.
    const cta = host(fixture).querySelector(
      '[data-testid="booking-services-continue"]',
    );
    expect(cta?.textContent).toContain('booking.continue');
    expect(cta?.hasAttribute('disabled')).toBe(false);
  });

  it('goes quiet again the moment a fresh guest joins', async () => {
    // The order that made the old CTA lie: everyone is served, THEN someone
    // is added. `addGuest` scopes to the new person, and the sweep that
    // skipped the active seat found nobody empty — so a party that had just
    // grown was offered "Continue".
    const fixture = await toServices();
    click(fixture, 'service-card-fade');
    await fixture.whenStable();
    fixture.detectChanges();
    answer(fixture);
    click(fixture, 'booking-add-to-bag');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host(fixture).querySelector('[data-testid="booking-services-continue"]')
        ?.textContent,
    ).toContain('booking.continue');

    click(fixture, 'booking-add-guest');
    await fixture.whenStable();
    fixture.detectChanges();

    const cta = host(fixture).querySelector(
      '[data-testid="booking-services-continue"]',
    );
    expect(cta?.textContent).toContain('booking.services.pickFor');
    expect(cta?.hasAttribute('disabled')).toBe(true);
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
      const line =
        cart === null ? undefined : BookingCart.linesFor(cart, SELF)[0];
      if (!line) throw new Error('bad fixture');
      store.setLineBarber(SELF, line.lineId, BarberId.of('niko'));
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
