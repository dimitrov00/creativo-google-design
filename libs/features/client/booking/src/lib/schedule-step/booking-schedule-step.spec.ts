import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Translation } from '@jsverse/transloco';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_PORTS,
  SCHEDULING_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts } from '@core/ports';
import type {
  Barber,
  CapacityMonth,
  Service,
  ShopLocation,
} from '@core/entities';
import { CapacityEntry, DayHours } from '@core/components';
import {
  BarberId,
  CapacityMonthId,
  LocalDate,
  LocationId,
  MinuteCount,
  RepositoryError,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  at,
  barberFixture,
  localDate,
  locationFixture,
  memoryCatalogReadPorts,
  memorySchedulingReadPorts,
  serviceFixture,
  termsFixture,
  unwrapOk,
  until,
} from '@core/testing';
import {
  bookingPortProviders,
  provideBookingTestI18n,
} from '../../testing/booking-shell.rig';
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

function service(id: string, locationIds: readonly string[] = []): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    name: { en: id, bg: id },
    description: { en: 'x', bg: 'x' },
    ...termsFixture(1500, 30),
    variants: [],
    offerings: [
      {
        barberId: BarberId.of('ivan'),
        overrides: [],
        ...termsFixture(1450, 35),
      },
    ],
    locationIds: locationIds.map((shopId) => LocationId.of(shopId)),
    sortOrder: 0,
  });
}

/** A barber on the ACTIVE list. */
function barber(id: string): Barber {
  return barberFixture({
    id: BarberId.of(id),
    name: { bg: id, en: id },
    handle: id,
    bio: { bg: '—', en: '—' },
    yearsExperience: null,
    locationIds: [],
    sortOrder: 1,
  });
}

/** An ACTIVE shop, open 09:00–20:00 Monday to Saturday. */
function shop(id: string, name: string): ShopLocation {
  const open = DayHours.open(at(9), until(20));
  return locationFixture({
    id: LocationId.of(id),
    name: { en: name, bg: name },
    address: { en: '—', bg: '—' },
    mapUrl: `https://maps.example.com/${id}`,
    openingHours: [open, open, open, open, open, open, DayHours.closed()],
  });
}

/**
 * Which chairs the capacity projection has room on — a barber at a shop,
 * with a full working day (480 free minutes) on every day of every month.
 */
type CapacityRoom = (barberId: string, locationId: string) => boolean;

/** Room on every chair, every day of the run, as far as the projection can tell. */
const roomEveryDay: CapacityRoom = () => true;

/** The months the run can reach from the pinned "today" (2026-08-03) — its horizon and then some. */
const RUN_MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];

/**
 * The `capacity/{YYYY-MM}` documents the projection would hold: per month,
 * an entry per day for every chair `room` has room on. None — never
 * rebuilt — without a `room`.
 */
function capacityMonths(
  room: CapacityRoom | undefined,
  barbers: readonly Barber[],
  shops: readonly ShopLocation[],
): readonly CapacityMonth[] {
  if (room === undefined) return [];
  return RUN_MONTHS.map((raw) =>
    capacityMonth(CapacityMonthId.of(raw), room, barbers, shops),
  );
}

/** One month of {@link capacityMonths}. */
function capacityMonth(
  month: CapacityMonthId,
  room: CapacityRoom,
  barbers: readonly Barber[],
  shops: readonly ShopLocation[],
): CapacityMonth {
  const first = unwrapOk(LocalDate.parse(`${month}-01`));
  const { year, month: monthOfYear } = LocalDate.parts(first);
  const entries: CapacityEntry[] = [];
  for (const day of LocalDate.range(
    first,
    LocalDate.addDays(first, LocalDate.daysInMonth(year, monthOfYear) - 1),
  )) {
    for (const each of barbers) {
      for (const at of shops) {
        if (!room(each.id, at.id)) continue;
        entries.push(
          CapacityEntry.of(day, each.id, at.id, unwrapOk(MinuteCount.of(480))),
        );
      }
    }
  }
  return {
    id: month,
    month,
    entries: [...entries].sort(CapacityEntry.compare),
  };
}

const CATALOG = [service('cut')];

/**
 * The shell, with every port this step touches doubled.
 *
 * Availability answers EMPTY rather than with geometry: none of these specs is
 * about which minutes are free — they are about the bar's own anatomy, which
 * is supposed to be identical whether or not the day has anything in it. A
 * fixture that built real roster windows would make these tests fail for
 * reasons that have nothing to do with what they assert. So no barber is
 * rostered on any day (no `barberSchedules` document), and the policy is the
 * default one.
 */
async function renderShell(
  options: {
    readonly services?: readonly Service[];
    readonly barbers?: readonly Barber[];
    /** `'pending'` never answers, the way a cold listener waits; `'failed'` errs. */
    readonly locations?: readonly ShopLocation[] | 'pending' | 'failed';
    /** The projection. No free minutes anywhere by default. */
    readonly capacity?: CapacityRoom;
    /** Collects every `capacity/{YYYY-MM}` month the step opens a listener on. */
    readonly capacityReads?: string[];
  } = {},
): Promise<ComponentFixture<ClientBooking>> {
  const unavailable = Result.err(RepositoryError.unavailable());
  const shops = Array.isArray(options.locations) ? options.locations : [];
  const scheduling = memorySchedulingReadPorts({
    capacityMonths: capacityMonths(
      options.capacity,
      options.barbers ?? [],
      shops,
    ),
  });
  await TestBed.configureTestingModule({
    imports: [ClientBooking],
    providers: [
      provideRouter([]),
      ...provideBookingTestI18n(COPY),
      ...bookingPortProviders(),
      {
        // No roster, the default policy, and the projection's months.
        provide: SCHEDULING_READ_PORTS,
        useValue: {
          ...scheduling,
          observeCapacityMonth: (month: CapacityMonthId) => {
            options.capacityReads?.push(month);
            return scheduling.observeCapacityMonth(month);
          },
        },
      },
      {
        // The double, with the shop read held or failed when a spec says so.
        provide: CATALOG_PORTS,
        useValue: {
          ...memoryCatalogReadPorts({
            services: options.services ?? CATALOG,
            barbers: options.barbers ?? [],
            locations: shops,
          }),
          ...(options.locations === 'pending'
            ? { observeLocations: () => NEVER }
            : options.locations === 'failed'
              ? { observeLocations: () => of(unavailable) }
              : {}),
        } satisfies CatalogReadPorts,
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
    store(fixture).selectDay(localDate('2026-08-04'));
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

    expect(store(fixture).locationId()).toBe('loc-center');
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
    const fixture = await toSchedule({
      services: CENTER_ONLY,
      barbers: BARBERS,
      locations: SHOPS,
      // Only Mladost has room: a day live for its chairs would open a sheet
      // that can only say "busy", since the grid never runs it. Asked about
      // every shop, Mladost's minutes would light the day; asked about the
      // Center alone — the one shop that can serve the visit — it stays grey.
      capacity: (_barberId, locationId) => locationId === 'loc-mladost',
    });

    expect(notice(fixture)).toBeNull();
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
  const roomForNikoOnly: CapacityRoom = (barberId) => barberId === 'niko';

  function day(fixture: ComponentFixture<ClientBooking>, key: string) {
    return host(fixture).querySelector<HTMLButtonElement>(
      `[data-testid="booking-day"][data-day-key="${key}"]`,
    );
  }

  // Niko's chair has room every day, Ivan's none: asked about Ivan alone the
  // day stays grey, asked about every barber Niko's minutes light it.
  it('asks the projection about that barber alone, and greys the days only other chairs have room on', async () => {
    const fixture = await toSchedule({
      barbers: BARBERS,
      locations: SHOPS,
      shopId: 'loc-center',
      barberId: 'ivan',
      capacity: roomForNikoOnly,
    });

    expect(day(fixture, '2026-08-04')?.disabled).toBe(true);
  });

  it('still asks about every barber when the line takes anyone', async () => {
    const capacityReads: string[] = [];
    const fixture = await toSchedule({
      barbers: BARBERS,
      locations: SHOPS,
      shopId: 'loc-center',
      capacity: roomForNikoOnly,
      capacityReads,
    });

    expect(day(fixture, '2026-08-04')?.disabled).toBe(false);
    expect(capacityReads).toContain('2026-08');
  });

  // A projection asked about no chair can only answer "no room", so the run
  // asks nothing: no `capacity/{YYYY-MM}` listener opens for a visit no
  // barber on the list can take, and no day is live.
  it('reads no capacity month for a visit no barber can take, and marks no day', async () => {
    const capacityReads: string[] = [];
    const fixture = await toSchedule({
      barbers: [],
      locations: SHOPS,
      shopId: 'loc-center',
      capacity: roomEveryDay,
      capacityReads,
    });

    expect(host(fixture).getAttribute('data-state')).toBe('schedule');
    expect(capacityReads).toEqual([]);
    const days = [
      ...host(fixture).querySelectorAll<HTMLButtonElement>(
        '[data-testid="booking-day"]',
      ),
    ];
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((each) => each.disabled)).toBe(true);
  });
});
