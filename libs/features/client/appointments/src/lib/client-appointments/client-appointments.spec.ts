import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { NEVER, Observable, of } from 'rxjs';
import { ZonedDateTime } from '@creativo/application/accounts';
import {
  PrincipalId,
  activePrincipal,
  roleFromPrimitive,
} from '@creativo/application/identity';
import { CLOCK } from '@creativo/application/shared';
import {
  BOOKING_GATEWAY,
  BookingGateway,
  BookingGatewayError,
  type Result as KernelResult,
  fail,
  ok,
} from '@creativo/application/booking';
import { MEDIA_READER } from '@creativo/application/catalog';
import {
  APPOINTMENT_READ_PORTS,
  CATALOG_PORTS,
  INBOX_PORTS,
  SCHEDULING_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { AppointmentReadPorts } from '@core/ports';
import type {
  Appointment,
  Barber,
  Service,
  ShopLocation,
} from '@core/entities';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  E164,
  Seat,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  CustomerId,
  LocationId,
  RepositoryError,
  Result,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  appointmentFixture,
  barberFixture,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  memoryInboxPorts,
  memorySchedulingReadPorts,
  seatFixture,
  serviceFixture,
  termsFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { AccountStateService } from '@creativo/features/client/account-state';
import { visitSectionLabel } from '@creativo/features/shared/visits';
import { ClientAppointments } from './client-appointments';

function unwrap<T, E>(result: KernelResult<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const PRINCIPAL_ID = unwrap(PrincipalId.create('user_1'));
const PRINCIPAL = unwrap(
  activePrincipal(PRINCIPAL_ID, [roleFromPrimitive('client')]),
);

/** An account seat's occupant: the uid and the client record beside it (D29). */
function accountSeat(
  uid: string,
  relationship: SubjectRelationship,
): SeatOccupant {
  return SeatOccupant.account(
    UserId.of(uid),
    CustomerId.of(`cus_${uid}`),
    relationship,
  );
}

/** The signed-in client's own seat — the default subject of every visit. */
const OWN_SEAT = accountSeat('user_1', SubjectRelationship.Self);

/** When a fixture's lifecycle was entered — any instant; nothing reads it. */
const STAMP = utcMs('2020-01-01T00:00:00.000+00:00');
const CONFIRMED = BookingLifecycle.confirm(STAMP);
const COMPLETED = BookingLifecycle.complete(STAMP);
const NO_SHOW = BookingLifecycle.noShow(STAMP);
function cancelled(
  reason: CancellationReason = CancellationReason.Unspecified,
): BookingLifecycle {
  return BookingLifecycle.cancel(STAMP, CancellationReasonSet.of([reason]));
}

/**
 * A one-seat visit of the fixture service with the fixture barber at the
 * shop's wall time `startIso` — `YYYY-MM-DDTHH:MM:SS` on the shop's clock,
 * or an instant with its offset — 30 minutes, 15,00 €.
 */
function appointment(
  id: string,
  startIso: string,
  lifecycle: BookingLifecycle = CONFIRMED,
  subject: SeatOccupant = OWN_SEAT,
): Appointment {
  const start = ZonedTimeSystem.toLocal(
    unwrapOk(ZonedTimeSystem.parseIsoIn(startIso, FIXTURE_TIME_ZONE)),
    FIXTURE_TIME_ZONE,
  );
  const seat = seatFixture({
    seatId: SeatId.of('seat_1'),
    serviceId: ServiceId.of('service_1'),
    barberId: BarberId.of('barber_1'),
    startMinutes: start.minute,
    terms: Seat.termsOf(termsFixture(1500, 30), termsFixture(1500, 30)),
    occupant: subject,
  });
  return appointmentFixture({
    id: AppointmentId.of(id),
    locationId: LocationId.of('location_1'),
    ownerUserId: UserId.of('user_1'),
    subjectUserIds:
      subject.seatSubject === SeatSubject.Account
        ? [subject.subjectUserId]
        : [],
    barberIds: [seat.barberId],
    busyKeys: [BusyKey.of(seat.barberId, start.localDate)],
    seats: [seat],
    localDate: start.localDate,
    startMinutes: seat.startMinutes,
    endMinutes: Seat.endMinutes(seat),
    utcEpochMs: unwrapOk(
      ZonedTimeSystem.toUtc(
        start.localDate,
        seat.startMinutes,
        FIXTURE_TIME_ZONE,
      ),
    ),
    lifecycle,
  });
}

/**
 * Stand-in copy for the sentences these specs read, one per key the page
 * can choose between, with the `{{reach}}` a sentence sends the client to
 * the shop with; every other key answers as itself.
 */
const COPY: Translation = {
  booking: { reach: { call: 'REACH:call', contact: 'REACH:contact' } },
  appointments: {
    cancel: { windowClosed: 'COPY:window-closed-page {{reach}}' },
    visit: { shopMoves: 'COPY:shop-moves {{reach}}' },
  },
  errors: {
    'booking.gateway.failed': 'COPY:gateway-failed',
    'booking.cancel.policy_unavailable': 'COPY:policy-unavailable',
    'booking.cancel.window_closed':
      'COPY:window-closed {{windowHours}} {{reach}}',
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
      defaultLang: 'en',
      fallbackLang: 'en',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

function accountStateStub(): AccountStateService {
  return {
    principal: signal(PRINCIPAL),
    claims: signal(PRINCIPAL.kind === 'active' ? PRINCIPAL.roles : null),
    account: signal(null),
    accountLoading: signal(false),
  } as unknown as AccountStateService;
}

/**
 * The account's visits as the double stores them — the open bookings and
 * the past ones in one book, each once: its upcoming read answers the live
 * ones, its history the newest of them all.
 */
function appointmentReads(
  upcoming: readonly Appointment[],
  history: readonly Appointment[] = [],
): AppointmentReadPorts {
  const book = [...upcoming];
  for (const visit of history) {
    if (!book.some((entry) => entry.id === visit.id)) book.push(visit);
  }
  return memoryAppointmentReadPorts(book);
}

/** A read that failed for good — a rule denial. */
const DENIED = Result.err(RepositoryError.readFailed('appointments', 'denied'));

/** The visits' shop, as the catalogue lists it — with a number to call. */
function centerShop(): ShopLocation {
  return locationFixture({
    id: LocationId.of('location_1'),
    name: { en: 'Creativo · Center', bg: 'Креативо · Център' },
    address: { en: '1 Vitosha Blvd', bg: 'бул. Витоша 1' },
    phoneE164: E164.of('+359881234567'),
    phoneDisplay: '+359 88 123 4567',
    mapUrl: 'https://maps.example.com/center',
  });
}

/** The service every fixture visit books, as the catalogue names it. */
function fadeService(): Service {
  return serviceFixture({
    id: ServiceId.of('service_1'),
    name: { en: 'Skin fade', bg: 'Фейд' },
    description: { en: 'A skin fade.', bg: 'Фейд до кожата.' },
    ...termsFixture(1500, 30),
    offerings: [],
    locationIds: [],
    popular: true,
    sortOrder: 1,
  });
}

/** The barber every fixture visit is cut by. */
function ivan(): Barber {
  return barberFixture({
    id: BarberId.of('barber_1'),
    bio: { en: 'Fades.', bg: 'Фейдове.' },
    yearsExperience: null,
    locationIds: [],
    sortOrder: 1,
  });
}

interface ConfigureExtras {
  /** The catalogue's services and barbers — none by default, see below. */
  readonly services?: readonly Service[];
  readonly barbers?: readonly Barber[];
  /** Replaces the upcoming read (a failure, a read that never answers). */
  readonly observeUpcoming?: AppointmentReadPorts['observeUpcoming'];
}

async function configure(
  upcoming: readonly Appointment[],
  cancelBehavior: BookingGateway['cancel'] = async () => ok(undefined),
  history: readonly Appointment[] = [],
  /** The shops the catalogue lists — none by default, see below. */
  locations: readonly ShopLocation[] = [],
  extras: ConfigureExtras = {},
): Promise<ComponentFixture<ClientAppointments>> {
  const reads = appointmentReads(upcoming, history);
  await TestBed.configureTestingModule({
    imports: [ClientAppointments],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: AccountStateService, useValue: accountStateStub() },
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: {
          ...reads,
          observeUpcoming: extras.observeUpcoming ?? reads.observeUpcoming,
        } satisfies AppointmentReadPorts,
      },
      {
        // A row names its service and shows its barber's face — both come
        // from the catalog. An EMPTY catalog is the honest stub here: the
        // row must still render (with its fallback title) when the service
        // it names has since been retired.
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({
          services: extras.services ?? [],
          barbers: extras.barbers ?? [],
          locations,
        }),
      },
      {
        provide: MEDIA_READER,
        useValue: { resolve: async () => ok([]) },
      },
      {
        // Cancellation is the CALLABLE's job; the web never writes an
        // appointment.
        provide: BOOKING_GATEWAY,
        useValue: {
          commit: async () => {
            throw new Error('not used in this spec');
          },
          cancel: cancelBehavior,
        },
      },
      {
        // The page reads the policy only (the default 24 h window).
        provide: SCHEDULING_READ_PORTS,
        useValue: memorySchedulingReadPorts(),
      },
      {
        provide: CLOCK,
        useValue: { now: (zone: string) => ZonedDateTime.now(zone) },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(ClientAppointments);
}

describe('ClientAppointments', () => {
  /** Settle the two live listeners and the first render. */
  async function render(fixture: ComponentFixture<ClientAppointments>) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function click(host: HTMLElement, testId: string): void {
    (
      host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
    )?.click();
  }

  /** Open a visit — the row is the only way in, and the sheet is where the
   *  cancel action and the window copy live. */
  async function openFirstVisit(
    fixture: ComponentFixture<ClientAppointments>,
    host: HTMLElement,
  ): Promise<void> {
    click(host, 'appointment-row');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the empty state when there is nothing to show', async () => {
    const fixture = await configure([]);
    const host = await render(fixture);

    expect(host.getAttribute('data-state')).toBe('ready');
    expect(
      host.querySelector('[data-testid="appointments-empty"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointments-empty-cta"]'),
    ).not.toBeNull();
    // Nothing to jump to, so no pills at all — an option that leads nowhere
    // is the one thing this row must not have.
    expect(
      host.querySelectorAll('[data-testid="appointments-pill"]').length,
    ).toBe(0);
  });

  it('renders a row per visit and a pill per section that holds one', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', COMPLETED),
        appointment('appt_past_2', '2020-06-02T10:00:00', COMPLETED),
      ],
    );
    const host = await render(fixture);

    const rows = host.querySelectorAll('[data-testid="appointment-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0]?.getAttribute('data-status')).toBe('CONFIRMED');

    // Upcoming, then one per month that actually holds a visit — July and
    // June, newest first.
    const pills = [
      ...host.querySelectorAll('[data-testid="appointments-pill"]'),
    ];
    expect(pills.length).toBe(3);
    expect(pills.map((pill) => pill.getAttribute('data-section'))).toEqual([
      'upcoming',
      '2020-07',
      '2020-06',
    ]);
  });

  it('names a barber the catalogue no longer lists as one barber, never as a party of one', async () => {
    // The stubbed catalogue is empty, as it is for a barber who has left
    // (it lists active barbers only) and for every row before it answers.
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    const host = await render(fixture);

    const row = host.querySelector('[data-testid="appointment-row"]');
    // The test catalogue is empty, so a key renders as itself.
    expect(row?.textContent).toContain('appointments.visit.barberRole');
    expect(row?.textContent).not.toContain('appointments.visit.severalBarbers');
  });

  it('counts every visit, upcoming and past', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [appointment('appt_past_1', '2020-07-04T10:00:00', COMPLETED)],
    );
    const host = await render(fixture);

    expect(
      host.querySelector('[data-testid="appointments-count"]'),
    ).not.toBeNull();
  });

  describe('the list: the shared visits browser, in the client’s perspective', () => {
    const FAR = '2030-06-01T10:00:00';

    function rowById(host: HTMLElement, id: string): HTMLElement | null {
      return host.querySelector<HTMLElement>(
        `[data-testid="appointment-row"][data-appointment-id="${id}"]`,
      );
    }

    const text = (element: Element | null | undefined) =>
      element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

    it('mounts the shared visits BROWSER (client-card revision 3 §3.11): the pills are its own now, under the same ids', async () => {
      const fixture = await configure([appointment('appt_1', FAR)], undefined, [
        appointment('appt_past', '2020-07-04T10:00:00', COMPLETED),
      ]);
      const host = await render(fixture);

      const browser = host.querySelector<HTMLElement>('lib-visits-browser');
      expect(browser?.getAttribute('data-perspective')).toBe('client');
      // On a page the rail bleeds to the viewport's edge, as the page's own
      // rail did. The clearance a jumped heading lands at is the page's
      // one hook on the browser (its length is the stylesheet's, measured
      // in the capture).
      expect(browser?.getAttribute('data-bleed')).toBe('viewport');
      expect(browser?.classList.contains('appointments__browser')).toBe(true);
      // The list and the rail are the browser's children.
      expect(browser?.querySelector('lib-visit-list')).not.toBeNull();
      expect(
        browser?.querySelector(
          'lib-visit-list [data-testid="appointments-list"]',
        ),
      ).not.toBeNull();
      const rail = browser?.querySelector('lib-visit-pills nav');
      expect(rail).not.toBeNull();
      expect(
        rail?.querySelector('[data-testid="appointments-pills"]'),
      ).not.toBeNull();
      const pills = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="appointments-pill"]',
        ),
      ];
      expect(pills.map((pill) => pill.getAttribute('data-section'))).toEqual([
        'upcoming',
        '2020-07',
      ]);
      // A pill is the SHARED one; nothing of the page's own pill is left.
      expect(host.querySelector('.appointments__pill')).toBeNull();
      expect(host.querySelector('.appointments__pills')).toBeNull();
      expect(
        pills.every((pill) => pill.classList.contains('visit-pills__pill')),
      ).toBe(true);
      // The first section is current until a scroll or a tap says otherwise:
      // a position, said with `aria-current`, never a pressed state.
      expect(pills[0]?.getAttribute('aria-current')).toBe('true');
      expect(pills[0]?.hasAttribute('data-selected')).toBe(true);
      expect(pills[1]?.hasAttribute('aria-current')).toBe(false);
      expect(pills[0]?.hasAttribute('aria-pressed')).toBe(false);
    });

    it('draws a visit as the shared row: the date tile, the service, «barber · time», the barber’s face', async () => {
      const fixture = await configure(
        [appointment('appt_1', FAR)],
        undefined,
        [],
        [],
        { services: [fadeService()], barbers: [ivan()] },
      );
      const host = await render(fixture);

      const row = rowById(host, 'appt_1');
      // Still the page's control — a button that opens the visit, named by
      // its one sentence — inside the shared row.
      expect(row?.tagName).toBe('BUTTON');
      expect(row?.closest('lib-visit-row')).not.toBeNull();
      expect(row?.getAttribute('aria-label')).toBeTruthy();

      // WHEN, as the DS's stamp: the weekday over the day (the section says
      // the month), in the accent while the visit is still ahead.
      const tile = row?.querySelector('ui-date-tile');
      expect(tile?.getAttribute('data-tone')).toBe('upcoming');
      expect(text(tile?.querySelector('.ui-date-tile__caption'))).toBe('сб');
      expect(text(tile?.querySelector('.ui-date-tile__day'))).toBe('1');
      // WHAT, then WITH WHOM and at what time — in the shop's zone.
      expect(text(row?.querySelector('.staff-event-head__title'))).toBe('Фейд');
      expect(text(row?.querySelector('.staff-event-head__line'))).toBe(
        'Иван · 10:00',
      );
      // The barber's face sits on the trailing edge.
      expect(
        row?.querySelector('ui-avatar[data-trailing="barber"]'),
      ).not.toBeNull();
    });

    it('heads each month with its year — two Julys are two headings — and the pills say what the headings say', async () => {
      const fixture = await configure([], undefined, [
        appointment('appt_jul_2021', '2021-07-03T10:00:00', COMPLETED),
        appointment('appt_jul_2020', '2020-07-04T10:00:00', COMPLETED),
      ]);
      const host = await render(fixture);

      const headings = [
        ...host.querySelectorAll<HTMLElement>(
          'lib-visit-list h3[data-section-key]',
        ),
      ];
      expect(headings.map((h) => h.getAttribute('data-section-key'))).toEqual([
        '2021-07',
        '2020-07',
      ]);
      // «Юли 2021 г.» — `Intl`'s own words, spaces read as spaces.
      expect(headings.map((h) => text(h))).toEqual(
        [
          visitSectionLabel('2021-07', 'bg'),
          visitSectionLabel('2020-07', 'bg'),
        ].map((label) => label.replace(/\s+/g, ' ')),
      );
      const pills = [
        ...host.querySelectorAll('[data-testid="appointments-pill"]'),
      ];
      expect(pills.map((pill) => text(pill))).toEqual(
        headings.map((h) => text(h)),
      );
      // Each month is one inset group, labelled by its heading.
      const groups = host.querySelectorAll('lib-visit-list ul[uilistgroup]');
      expect(groups.length).toBe(2);
      expect(groups[0]?.getAttribute('aria-labelledby')).toBe(headings[0]?.id);
    });

    it('strikes an hour that did not happen, in the full ink', async () => {
      const fixture = await configure([], undefined, [
        appointment('appt_missed', '2020-07-04T10:00:00', NO_SHOW),
        appointment(
          'appt_called_off',
          '2020-06-02T10:00:00',
          cancelled(CancellationReason.ClientChangedPlans),
        ),
      ]);
      const host = await render(fixture);

      const missed = rowById(host, 'appt_missed');
      expect(
        missed
          ?.querySelector('lib-staff-event-head')
          ?.hasAttribute('data-struck'),
      ).toBe(true);
      expect(missed?.hasAttribute('data-receded')).toBe(false);
      expect(
        missed?.querySelector('ui-date-tile')?.getAttribute('data-tone'),
      ).toBe('hollow');

      const calledOff = rowById(host, 'appt_called_off');
      expect(
        calledOff
          ?.querySelector('lib-staff-event-head')
          ?.hasAttribute('data-struck'),
      ).toBe(true);
      // One mark for one fact: struck, never struck AND faded.
      expect(calledOff?.hasAttribute('data-receded')).toBe(false);
    });

    it('files an open booking whose hour has passed once, under its own month', async () => {
      // Never closed out by the shop: still `confirmed`, so the upcoming
      // read holds it, and already begun, so the history does too.
      const lingering = appointment('appt_lingering', '2020-05-05T10:00:00');
      const fixture = await configure([lingering], undefined, [lingering]);
      const host = await render(fixture);

      expect(
        host.querySelectorAll('[data-testid="appointment-row"]').length,
      ).toBe(1);
      expect(
        rowById(host, 'appt_lingering')
          ?.querySelector('ui-date-tile')
          ?.getAttribute('data-tone'),
      ).toBe('past');
      expect(
        [...host.querySelectorAll('[data-testid="appointments-pill"]')].map(
          (pill) => pill.getAttribute('data-section'),
        ),
      ).toEqual(['2020-05']);
    });

    it('jumps to a month’s heading when its pill is tapped — the browser’s jump, through the page’s ids', async () => {
      const fixture = await configure([appointment('appt_1', FAR)], undefined, [
        appointment('appt_past', '2020-07-04T10:00:00', COMPLETED),
      ]);
      const host = await render(fixture);
      const scrolled: string[] = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this.getAttribute('data-section-key') ?? '');
      };
      try {
        (
          host.querySelector(
            '[data-testid="appointments-pill"][data-section="2020-07"]',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
      } finally {
        Element.prototype.scrollIntoView = original;
      }

      expect(scrolled).toEqual(['2020-07']);
      expect(
        host
          .querySelector(
            '[data-testid="appointments-pill"][data-section="2020-07"]',
          )
          ?.hasAttribute('data-selected'),
      ).toBe(true);
    });

    it('words the list’s empty itself: a booking when there is nothing, the filter back when the funnel hides it', async () => {
      const fixture = await configure([], undefined, [
        appointment('appt_done', '2020-07-04T10:00:00', COMPLETED),
      ]);
      const host = await render(fixture);
      const empty = () =>
        host.querySelector('lib-visit-list [data-testid="appointments-empty"]');

      click(host, 'appointments-filter');
      fixture.detectChanges();
      click(host, 'appointments-filter-no_show');
      fixture.detectChanges();

      // The page's words and its way out, inside the list's own empty.
      expect(empty()?.tagName).toBe('UI-EMPTY-STATE');
      expect(text(empty()?.querySelector('p'))).toBe(
        'appointments.empty.filtered',
      );
      const clear = empty()?.querySelector<HTMLButtonElement>(
        '[data-testid="appointments-clear-filter"]',
      );
      expect(clear?.parentElement).toBe(empty());
      expect(clear?.hasAttribute('uiactions')).toBe(true);

      clear?.click();
      fixture.detectChanges();
      expect(empty()).toBeNull();
      expect(rowById(host, 'appt_done')).not.toBeNull();
      expect(
        host
          .querySelector('[data-testid="appointments-filter"]')
          ?.hasAttribute('data-filtering'),
      ).toBe(false);
    });

    it('shows the list’s placeholders under the title while the first read is on its way', async () => {
      const fixture = await configure([], undefined, [], [], {
        observeUpcoming: () => NEVER,
      });
      const host = await render(fixture);

      expect(host.getAttribute('data-state')).toBe('loading');
      expect(host.querySelector('h1')).not.toBeNull();
      expect(
        host.querySelector(
          'lib-visit-list [data-testid="appointments-skeleton"]',
        ),
      ).not.toBeNull();
      expect(
        host.querySelectorAll('[data-testid="appointments-pill"]').length,
      ).toBe(0);
    });

    it('says the visits did not load, and «Опитай пак» reads them again', async () => {
      let reads = 0;
      const fixture = await configure(
        [appointment('appt_1', FAR)],
        undefined,
        [],
        [],
        {
          observeUpcoming: () => {
            reads += 1;
            return of(
              reads === 1 ? DENIED : Result.ok([appointment('appt_1', FAR)]),
            );
          },
        },
      );
      const host = await render(fixture);

      expect(host.getAttribute('data-state')).toBe('error');
      expect(
        host.querySelector('lib-visit-list [data-testid="appointments-error"]'),
      ).not.toBeNull();
      expect(
        host.querySelectorAll('[data-testid="appointment-row"]').length,
      ).toBe(0);

      click(host, 'appointments-retry');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(reads).toBe(2);
      expect(host.getAttribute('data-state')).toBe('ready');
      expect(
        host.querySelector('[data-testid="appointments-error"]'),
      ).toBeNull();
      expect(rowById(host, 'appt_1')).not.toBeNull();
    });

    it('offers the same retry in the calendar view', async () => {
      let reads = 0;
      const fixture = await configure([], undefined, [], [], {
        observeUpcoming: () => {
          reads += 1;
          return of(reads === 1 ? DENIED : Result.ok([]));
        },
      });
      const host = await render(fixture);
      click(host, 'appointments-view-calendar');
      fixture.detectChanges();

      expect(
        host.querySelector('ui-notice[data-testid="appointments-error"]'),
      ).not.toBeNull();
      click(host, 'appointments-retry');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(reads).toBe(2);
      expect(
        host.querySelector('[data-testid="appointments-calendar"]'),
      ).not.toBeNull();
    });
  });

  // The default policy's free-cancellation window is 24h. A visit inside it
  // must not OFFER a cancel the server would refuse — the button goes, and
  // the honest reason takes its place.
  it('opens the visit the route asks for (`?visit=<id>`, the `visit` input) — and only a visit it holds', async () => {
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    fixture.componentRef.setInput('visit', 'appt_1');
    const host = await render(fixture);

    // The sheet is open on arrival: how `/account`'s «Предстоящ час» card
    // lands here.
    const sheet = host.querySelector('[data-testid="appointment-visit-sheet"]');
    expect(sheet).not.toBeNull();
    expect(
      host
        .querySelector('[data-testid="appointment-cancel-trigger"]')
        ?.getAttribute('data-appointment-id'),
    ).toBe('appt_1');

    // Dismissed like any other: the sheet goes, the list stays.
    (
      host.querySelector(
        '[data-testid="appointment-visit-sheet"] [aria-label="appointments.visit.close"]',
      ) as HTMLButtonElement | null
    )?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="appointment-visit-sheet"]'),
    ).toBeNull();
    expect(
      host.querySelectorAll('[data-testid="appointment-row"]').length,
    ).toBe(1);
  });

  it('opens nothing for a visit the route names that the lists do not hold', async () => {
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    fixture.componentRef.setInput('visit', 'appt_gone');
    const host = await render(fixture);

    expect(
      host.querySelector('[data-testid="appointment-visit-sheet"]'),
    ).toBeNull();
    expect(host.getAttribute('data-state')).toBe('ready');
  });

  it('hides the cancel button inside the window and explains why', async () => {
    const nowResult = ZonedDateTime.now('Europe/Sofia');
    if (nowResult.isFailure()) throw new Error('unreachable');
    const inTwoHours = nowResult.value.plusMinutes(120).toISO();
    const fixture = await configure([appointment('appt_soon', inTwoHours)]);
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    expect(
      host.querySelector('[data-testid="appointment-cancel-trigger"]'),
    ).toBeNull();
    // No shop number in this empty catalogue: the copy promises no call.
    expect(
      host
        .querySelector('[data-testid="appointment-cancel-window-closed"]')
        ?.textContent?.trim(),
    ).toBe('COPY:window-closed-page REACH:contact');
  });

  it('says "call" about the closed window only beside the sheet’s own call verb', async () => {
    const nowResult = ZonedDateTime.now('Europe/Sofia');
    if (nowResult.isFailure()) throw new Error('unreachable');
    const fixture = await configure(
      [appointment('appt_soon', nowResult.value.plusMinutes(120).toISO())],
      undefined,
      [],
      [centerShop()],
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    expect(
      host.querySelector('[data-testid="appointment-call"]'),
    ).not.toBeNull();
    expect(
      host
        .querySelector('[data-testid="appointment-cancel-window-closed"]')
        ?.textContent?.trim(),
    ).toBe('COPY:window-closed-page REACH:call');
  });

  it('shows the free-cancellation deadline while cancelling is still open', async () => {
    const fixture = await configure([
      appointment('appt_far', '2030-06-01T10:00:00'),
    ]);
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    expect(
      host.querySelector('[data-testid="appointment-cancel-trigger"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointment-cancel-deadline"]'),
    ).not.toBeNull();
  });

  describe('the sheet’s verbs: the DS quick actions, one column per verb the visit has', () => {
    const FAR = '2030-06-01T10:00:00';

    function verbs(host: HTMLElement) {
      const run = host.querySelector<HTMLElement>(
        '[data-testid="appointment-actions"]',
      );
      return {
        run,
        columns: run?.style.getPropertyValue('--ui-quick-actions-columns'),
        tiles: [...(run?.querySelectorAll('.ui-quick-action') ?? [])].map(
          (tile) => tile.getAttribute('data-testid'),
        ),
      };
    }

    it('offers a visit ahead its calendar and its move — and the shop’s place and number when the catalogue knows them', async () => {
      const fixture = await configure(
        [appointment('appt_far', FAR)],
        undefined,
        [],
        [centerShop()],
      );
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      const { run, columns, tiles } = verbs(host);
      expect(run?.tagName).toBe('UI-QUICK-ACTIONS');
      expect(run?.getAttribute('role')).toBe('group');
      expect(run?.getAttribute('aria-label')).toBe(
        'appointments.visit.actions',
      );
      expect(tiles).toEqual([
        'appointment-add-to-calendar',
        'appointment-reschedule',
        'appointment-directions',
        'appointment-call',
      ]);
      expect(columns).toBe('4');
    });

    it('draws every verb as a glyph on its disc with its word under it, and promotes the one the sheet leads with — the calendar, for a visit ahead', async () => {
      const fixture = await configure(
        [appointment('appt_far', FAR)],
        undefined,
        [],
        [centerShop()],
      );
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      const actions = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="appointment-actions"] > .ui-quick-action',
        ),
      ];
      expect(actions.length).toBe(4);
      for (const action of actions) {
        // The DS's disc (revision 3 §3.1, D1): the glyph on its disc, the
        // word in its own span — no tile face, no state on the host.
        expect(
          action.querySelector(
            ':scope > .ui-quick-action__disc > ui-icon.ui-quick-action__glyph',
          ),
        ).not.toBeNull();
        expect(
          action
            .querySelector(':scope > .ui-quick-action__label')
            ?.textContent?.trim(),
        ).toBeTruthy();
        expect(action.hasAttribute('data-interactive')).toBe(false);
      }
      // ONE promoted verb per run (R2-B, G1-1): the first, which is what
      // the sheet leads with — «В календара» while the visit is ahead.
      expect(
        actions.map((action) => action.getAttribute('data-prominence')),
      ).toEqual(['accent', 'standard', 'standard', 'standard']);
      expect(actions[0]?.getAttribute('data-testid')).toBe(
        'appointment-add-to-calendar',
      );
    });

    it('promotes «Пак същото» on a visit that has happened — the one verb a good haircut earns', async () => {
      const fixture = await configure(
        [],
        undefined,
        [appointment('appt_done', '2020-07-04T10:00:00', COMPLETED)],
        [centerShop()],
      );
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      const actions = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="appointment-actions"] > .ui-quick-action',
        ),
      ];
      expect(
        actions.map((action) => action.getAttribute('data-testid')),
      ).toEqual([
        'appointment-book-again',
        'appointment-directions',
        'appointment-call',
      ]);
      expect(
        actions.map((action) => action.getAttribute('data-prominence')),
      ).toEqual(['accent', 'standard', 'standard']);
    });

    it('closes up around the verbs a past visit has not got', async () => {
      const fixture = await configure([], undefined, [
        appointment('appt_done', '2020-07-04T10:00:00', COMPLETED),
      ]);
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      // No shop in the empty catalogue, nothing to move: «Пак същото» alone,
      // one column wide — never a run with holes in it.
      const { columns, tiles } = verbs(host);
      expect(tiles).toEqual(['appointment-book-again']);
      expect(columns).toBe('1');
      expect(
        host
          .querySelector('[data-testid="appointment-book-again"]')
          ?.getAttribute('href'),
      ).toBe('/book?repeat=appt_done');
    });
  });

  describe('«Премести» — only for a visit the client can move', () => {
    const FAR = '2030-06-01T10:00:00';

    function query(host: HTMLElement, testId: string): Element | null {
      return host.querySelector(`[data-testid="${testId}"]`);
    }

    it('offers the move for a visit holding the client’s own seat', async () => {
      const fixture = await configure([appointment('appt_own', FAR)]);
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      expect(query(host, 'appointment-reschedule')).not.toBeNull();
      expect(query(host, 'appointment-shop-moves')).toBeNull();
    });

    it('offers no move for a visit only the shop can move — and says why instead of a dead end', async () => {
      // Staff removed the client's own seat; the son they added is all that
      // is left. A move link here could only ever be refused.
      const son = accountSeat('user_son', SubjectRelationship.Companion);
      const fixture = await configure([
        appointment('appt_son', FAR, CONFIRMED, son),
      ]);
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      expect(query(host, 'appointment-reschedule')).toBeNull();
      // No shop number in this empty catalogue, so the copy promises no call.
      expect(query(host, 'appointment-shop-moves')?.textContent?.trim()).toBe(
        'COPY:shop-moves REACH:contact',
      );
      // Cancelling is still the client's: the visit is still theirs.
      expect(query(host, 'appointment-cancel-trigger')).not.toBeNull();
    });

    it('points at the call verb when the catalogue knows the shop — «Обади се» stands where «Премести» would', async () => {
      const son = accountSeat('user_son', SubjectRelationship.Companion);
      const fixture = await configure(
        [appointment('appt_son', FAR, CONFIRMED, son)],
        undefined,
        [],
        [centerShop()],
      );
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      expect(query(host, 'appointment-reschedule')).toBeNull();
      expect(query(host, 'appointment-call')?.getAttribute('href')).toBe(
        'tel:+359881234567',
      );
      // One sentence, parametrized: the call it names is the verb above.
      expect(query(host, 'appointment-shop-moves')?.textContent?.trim()).toBe(
        'COPY:shop-moves REACH:call',
      );
    });

    it('treats a `self` seat bound to another account as the shop’s — the same rule the server moves by', async () => {
      const foreign = accountSeat('user_other', SubjectRelationship.Self);
      const fixture = await configure([
        appointment('appt_foreign', FAR, CONFIRMED, foreign),
      ]);
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      expect(query(host, 'appointment-reschedule')).toBeNull();
      expect(query(host, 'appointment-shop-moves')).not.toBeNull();
    });

    it('says nothing about who moves it once the window has closed — that has its own reason', async () => {
      const nowResult = ZonedDateTime.now('Europe/Sofia');
      if (nowResult.isFailure()) throw new Error('unreachable');
      const son = accountSeat('user_son', SubjectRelationship.Companion);
      const fixture = await configure([
        appointment(
          'appt_soon',
          nowResult.value.plusMinutes(120).toISO(),
          CONFIRMED,
          son,
        ),
      ]);
      const host = await render(fixture);
      await openFirstVisit(fixture, host);

      expect(query(host, 'appointment-reschedule')).toBeNull();
      expect(query(host, 'appointment-shop-moves')).toBeNull();
      expect(query(host, 'appointment-cancel-window-closed')).not.toBeNull();
    });
  });

  it('marks the filter button while it is narrowing, and names the option', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [
        appointment('appt_past_1', '2020-07-04T10:00:00', COMPLETED),
        appointment(
          'appt_past_2',
          '2020-06-02T10:00:00', // The variant carries its reason — a cancelled status without one is
          // not representable, which is the whole point of the union.
          cancelled(CancellationReason.ClientChangedPlans),
        ),
      ],
    );
    const host = await render(fixture);

    const filterButton = () =>
      host.querySelector('[data-testid="appointments-filter"]');
    expect(filterButton()?.hasAttribute('data-filtering')).toBe(false);

    click(host, 'appointments-filter');
    fixture.detectChanges();
    click(host, 'appointments-filter-cancelled');
    fixture.detectChanges();

    // The dot is CSS; what the DOM has to carry is the state it hangs on —
    // and the accessible name, because a coloured mark says nothing to a
    // screen reader.
    expect(filterButton()?.hasAttribute('data-filtering')).toBe(true);
    expect(filterButton()?.getAttribute('aria-label')).toContain(':');

    const rows = host.querySelectorAll('[data-testid="appointment-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-status')).toBe('CANCELLED');
    // The pills follow the narrowed list — June is all that is left.
    expect(
      [...host.querySelectorAll('[data-testid="appointments-pill"]')].map(
        (pill) => pill.getAttribute('data-section'),
      ),
    ).toEqual(['2020-06']);
  });

  it('offers the filter back when nothing matches it', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      undefined,
      [appointment('appt_past_1', '2020-07-04T10:00:00', COMPLETED)],
    );
    const host = await render(fixture);

    click(host, 'appointments-filter');
    fixture.detectChanges();
    click(host, 'appointments-filter-no_show');
    fixture.detectChanges();

    // Empty BECAUSE of the funnel: the way out is the filter, not a booking.
    expect(
      host.querySelector('[data-testid="appointments-clear-filter"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointments-empty-cta"]'),
    ).toBeNull();
  });

  it('switches to the calendar view and renders the months a visit falls in', async () => {
    const fixture = await configure([
      appointment('appt_1', '2030-06-01T10:00:00'),
    ]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointments-calendar"]'),
    ).not.toBeNull();
    // From today through the month the visit lands in — every month in
    // between, so scrolling never falls off the run.
    expect(
      host.querySelectorAll('[data-testid="appointments-month-label"]').length,
    ).toBeGreaterThan(0);
    expect(
      host.querySelector('[data-testid="appointments-calendar-day"]'),
    ).not.toBeNull();
  });

  it('renders months around TODAY, not merely the ones a visit falls in', async () => {
    // A calendar you cannot scroll past your own history feels broken. The
    // run opens half a year either side of now, whether or not anything
    // happened in those months.
    const fixture = await configure([]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    const months = [...host.querySelectorAll('[data-month-key]')].map((month) =>
      month.getAttribute('data-month-key'),
    );
    expect(months.length).toBe(13);

    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    expect(months).toContain(now.value.toISODate().slice(0, 7));
  });

  it('widens the run to reach a visit outside the default window', async () => {
    const now = ZonedDateTime.now('Europe/Sofia');
    if (now.isFailure()) throw new Error('unreachable');
    // Two years back — well outside the six months the calendar opens with,
    // and therefore unreachable unless the window stretches to hold it. At
    // noon, not now's time of day: a run after 23:30 put the 30-minute seat
    // past its shop day's midnight (F-6).
    const longAgo = `${now.value
      .plusMinutes(-60 * 24 * 730)
      .toISO()
      .slice(0, 10)}T12:00:00`;

    const fixture = await configure([], undefined, [
      appointment('appt_ancient', longAgo, COMPLETED),
    ]);
    const host = await render(fixture);

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    const months = [...host.querySelectorAll('[data-month-key]')].map((month) =>
      month.getAttribute('data-month-key'),
    );
    expect(months[0]).toBe(longAgo.slice(0, 7));
  });

  it('keeps the today anchor on screen in the calendar view, and only there', async () => {
    const fixture = await configure([]);
    const host = await render(fixture);

    // The list has its own way home — the pills — so the anchor belongs to
    // the calendar alone.
    expect(
      host.querySelector('[data-testid="appointments-scroll-today"]'),
    ).toBeNull();

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // ALWAYS, not "once today scrolls away": a control that comes and goes
    // cannot be reached for without looking, and the booking calendar's own
    // twin is always there.
    expect(
      host.querySelector('[data-testid="appointments-scroll-today"]'),
    ).not.toBeNull();
  });

  it('keeps the weekday key in the bar for as long as the calendar is open', async () => {
    const fixture = await configure([]);
    const host = await render(fixture);

    // A list has no columns to label.
    expect(
      host.querySelector('[data-testid="appointments-chrome-weekdays"]'),
    ).toBeNull();

    click(host, 'appointments-view-calendar');
    fixture.detectChanges();

    // In the BAR, not closing the heading: the run opens on today's month
    // and grows backwards whenever its top comes near, so a key in the
    // heading was never on screen and every month read as seven unlabelled
    // columns.
    const key = host.querySelector(
      'ui-toolbar [data-testid="appointments-chrome-weekdays"]',
    );
    expect(key).not.toBeNull();
    const labels = [...(key?.querySelectorAll('[uiweekday]') ?? [])].map(
      (label) => label.textContent?.trim() ?? '',
    );
    expect(labels).toHaveLength(7);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    // ONE key: the heading no longer carries a second copy of it.
    expect(host.querySelectorAll('[uicalendarlede] [uiweekday]').length).toBe(
      0,
    );

    click(host, 'appointments-view-list');
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="appointments-chrome-weekdays"]'),
    ).toBeNull();
  });

  it('cancels an own visit through the sheet', async () => {
    const cancelCalls: { appointmentId: string; reason: string }[] = [];
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async (request) => {
        cancelCalls.push(request);
        return ok(undefined);
      },
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="appointment-cancel-sheet"]'),
    ).not.toBeNull();

    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    // Nothing typed, nothing claimed: the server files it as `unspecified`.
    expect(cancelCalls).toEqual([{ appointmentId: 'appt_1', reason: '' }]);
  });

  it('sends the reason the client typed, and only that', async () => {
    const cancelCalls: { appointmentId: string; reason: string }[] = [];
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async (request) => {
        cancelCalls.push(request);
        return ok(undefined);
      },
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    const reason = host.querySelector(
      '[data-testid="appointment-cancel-reason"]',
    ) as HTMLTextAreaElement;
    // The field opens empty — the label already says it is optional.
    expect(reason.value).toBe('');
    reason.value = 'Болен съм';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(cancelCalls).toEqual([
      { appointmentId: 'appt_1', reason: 'Болен съм' },
    ]);
  });

  it('shows a translated error when cancellation fails', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () =>
        fail(new BookingGatewayError('unavailable', 'network sneezed')),
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host
        .querySelector('[data-testid="appointment-cancel-error"]')
        ?.textContent?.trim(),
    ).toBe('COPY:gateway-failed');
  });

  it('says to try again in a moment when the terms could not be read — and the same button does', async () => {
    const answers = [
      fail(
        new BookingGatewayError('unavailable', 'terms unread', {
          serverCode: 'booking.cancel.policy_unavailable',
        }),
      ),
      ok(undefined),
    ];
    let calls = 0;
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () => answers[calls++] ?? ok(undefined),
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    // The server's own words, not "something went wrong" — and the sheet
    // stays open on the button that retries.
    const error = () =>
      host.querySelector('[data-testid="appointment-cancel-error"]');
    expect(error()?.textContent?.trim()).toBe('COPY:policy-unavailable');
    expect(
      host.querySelector('[data-testid="appointment-cancel-confirm"]'),
    ).not.toBeNull();

    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toBe(2);
    expect(error()).toBeNull();
  });

  /** A cancel the server refuses because the free window closed meanwhile. */
  async function refusedAsClosed(
    locations: readonly ShopLocation[],
  ): Promise<HTMLElement> {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () =>
        fail(
          new BookingGatewayError('invalid_request', 'closed', {
            serverCode: 'booking.cancel.window_closed',
            windowHours: '24',
          }),
        ),
      [],
      locations,
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();
    return host;
  }

  it('names the closed window in the server’s words, with its hours — and no call it cannot place', async () => {
    const host = await refusedAsClosed([]);

    expect(
      host
        .querySelector('[data-testid="appointment-cancel-error"]')
        ?.textContent?.trim(),
    ).toBe('COPY:window-closed 24 REACH:contact');
    expect(
      host.querySelector('[data-testid="appointment-cancel-call"]'),
    ).toBeNull();
    // No number to lead with, and still nothing another press could change.
    expect(
      (
        host.querySelector(
          '[data-testid="appointment-cancel-confirm"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('puts the call beside the closed window when the catalogue knows the shop', async () => {
    const host = await refusedAsClosed([centerShop()]);

    expect(
      host
        .querySelector('[data-testid="appointment-cancel-error"]')
        ?.textContent?.trim(),
    ).toBe('COPY:window-closed 24 REACH:call');
    expect(
      host
        .querySelector('[data-testid="appointment-cancel-call"]')
        ?.getAttribute('href'),
    ).toBe('tel:+359881234567');
  });

  it('offers no call beside a failure a retry fixes', async () => {
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () =>
        fail(
          new BookingGatewayError('unavailable', 'terms unread', {
            serverCode: 'booking.cancel.policy_unavailable',
          }),
        ),
      [],
      [centerShop()],
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);

    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointment-cancel-error"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-testid="appointment-cancel-call"]'),
    ).toBeNull();
    // …and the confirm stays what it was: pressing it again IS the retry.
    const confirm = host.querySelector(
      '[data-testid="appointment-cancel-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute('data-button-style')).toBe('borderedProminent');
  });

  /** The server's refusal of a cancel whose free window closed meanwhile. */
  const closedWindow = () =>
    fail(
      new BookingGatewayError('invalid_request', 'closed', {
        serverCode: 'booking.cancel.window_closed',
        windowHours: '24',
      }),
    );

  it('leads with the call once the window has closed, and disables the confirm that could only be refused again', async () => {
    let calls = 0;
    const fixture = await configure(
      [appointment('appt_1', '2030-06-01T10:00:00')],
      async () => {
        calls += 1;
        return closedWindow();
      },
      [],
      [centerShop()],
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);
    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();

    const confirm = () =>
      host.querySelector(
        '[data-testid="appointment-cancel-confirm"]',
      ) as HTMLButtonElement;
    const call = () =>
      host.querySelector('[data-testid="appointment-cancel-call"]');
    // Before the refusal: the destructive confirm is the action.
    expect(confirm().disabled).toBe(false);
    expect(confirm().getAttribute('data-button-style')).toBe(
      'borderedProminent',
    );
    expect(call()).toBeNull();

    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();

    // After it: the call is the prominent action, and it comes first.
    expect(call()?.getAttribute('href')).toBe('tel:+359881234567');
    expect(call()?.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(
      (call()?.compareDocumentPosition(confirm()) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The confirm steps back, and pressing it asks the server nothing.
    expect(confirm().disabled).toBe(true);
    expect(confirm().getAttribute('data-button-style')).toBe('bordered');
    confirm().click();
    await fixture.whenStable();
    expect(calls).toBe(1);
  });

  it('asks afresh on the next cancel sheet — one visit’s closed window never disables another’s', async () => {
    const fixture = await configure(
      [
        appointment('appt_1', '2030-06-01T10:00:00'),
        appointment('appt_2', '2030-06-08T10:00:00'),
      ],
      async (request) =>
        request.appointmentId === 'appt_1' ? closedWindow() : ok(undefined),
      [],
      [centerShop()],
    );
    const host = await render(fixture);
    await openFirstVisit(fixture, host);
    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();
    click(host, 'appointment-cancel-confirm');
    await fixture.whenStable();
    fixture.detectChanges();
    click(host, 'appointment-cancel-dismiss');
    fixture.detectChanges();

    (
      host.querySelectorAll('[data-testid="appointment-row"]')[1] as
        HTMLElement | undefined
    )?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    click(host, 'appointment-cancel-trigger');
    fixture.detectChanges();

    expect(
      host.querySelector('[data-testid="appointment-cancel-error"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="appointment-cancel-call"]'),
    ).toBeNull();
    expect(
      (
        host.querySelector(
          '[data-testid="appointment-cancel-confirm"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
