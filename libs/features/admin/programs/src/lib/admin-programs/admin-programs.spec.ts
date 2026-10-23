import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import type { ProgramsPorts } from '@core/ports';
import {
  CourseId,
  EventId,
  LocationId,
  PositionId,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type ProgramsWorld,
  type ProgramsWorldSeed,
  at,
  courseOf,
  localDate,
  locationFixture,
  memoryClockPorts,
  memoryDefaultLocationPorts,
  memoryIdPorts,
  memoryLocationLoadPorts,
  memoryProgramsPorts,
  memoryProgramsWorld,
  positionOf,
  shopEventOf,
  textFixture,
  utcMs,
} from '@core/testing';
import {
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  PROGRAMS_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AdminPrograms } from './admin-programs';

/*
 * The admin programs page over the in-memory programs world (flip 4, P2):
 * the lists, the forms and the documents a save leaves. Time is pinned —
 * the clock answers `FIXTURE_NOW_UTC_MS` (2026-09-28 09:00 in Sofia) and the
 * world's one shop, `loc-center`, is the default shop, in `Europe/Sofia`.
 * Fresh ids are `generated-1`, `generated-2`, … in call order.
 */

function fillInput(host: HTMLElement, testId: string, value: string): void {
  const el = host.querySelector(`[data-testid="${testId}"]`) as
    HTMLInputElement | HTMLTextAreaElement;
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function click(host: HTMLElement, testId: string): void {
  (
    host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
  ).click();
}

function rowsOf(host: HTMLElement, listTestId: string): HTMLButtonElement[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      `[data-testid="${listTestId}"] button[uilistrow]`,
    ),
  );
}

/** Every row's trailing text, in list order, joined by ` · `. */
function trailingTextOf(host: HTMLElement, listTestId: string): string {
  return rowsOf(host, listTestId)
    .map((row) => row.querySelector('[uiTrailing]')?.textContent?.trim())
    .join(' · ');
}

/** Every row's leading (title) text, in list order. */
function titlesOf(host: HTMLElement, listTestId: string): string[] {
  return rowsOf(host, listTestId).map(
    (row) => row.querySelector('span')?.textContent?.trim() ?? '',
  );
}

function rowTitled(
  host: HTMLElement,
  listTestId: string,
  title: string,
): HTMLButtonElement {
  const row = rowsOf(host, listTestId).find(
    (candidate) =>
      candidate.querySelector('span')?.textContent?.trim() === title,
  );
  if (!row) throw new Error(`no row titled ${title}`);
  return row;
}

function valueOf(host: HTMLElement, testId: string): string {
  return (host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement)
    .value;
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
 * The page over a world seeded with `seed` (plus the default shop). A case
 * that scripts a member of the suite overrides it over the full double,
 * which it receives.
 */
async function configure(
  seed: ProgramsWorldSeed = {},
  scripted: (double: ProgramsPorts) => Partial<ProgramsPorts> = () => ({}),
): Promise<{
  fixture: ComponentFixture<AdminPrograms>;
  host: HTMLElement;
  world: ProgramsWorld;
}> {
  const world = memoryProgramsWorld({
    locations: [locationFixture()],
    ...seed,
  });
  const programs = memoryProgramsPorts(world);
  await TestBed.configureTestingModule({
    imports: [AdminPrograms],
    providers: [
      ...provideTestI18n(),
      {
        provide: PROGRAMS_PORTS,
        useValue: { ...programs, ...scripted(programs) },
      },
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(world),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
      { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
      { provide: ID_PORTS, useValue: memoryIdPorts('generated') },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AdminPrograms);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement, world };
}

/** Lets a save's whole read-decide-write chain run, then renders. */
async function settle(fixture: ComponentFixture<AdminPrograms>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();
}

async function openNewEventForm(
  fixture: ComponentFixture<AdminPrograms>,
  host: HTMLElement,
  startsAt: string,
  locationId = '',
): Promise<void> {
  click(host, 'admin-tab-events');
  fixture.detectChanges();
  click(host, 'admin-new');
  fixture.detectChanges();
  fillInput(host, 'admin-event-title-en', 'Open Chair Day');
  fillInput(host, 'admin-event-title-bg', 'Ден на отворените столове');
  fillInput(host, 'admin-event-description-en', 'Walk-in trims');
  fillInput(host, 'admin-event-description-bg', 'Подстригвания');
  fillInput(host, 'admin-event-starts-at', startsAt);
  if (locationId) fillInput(host, 'admin-event-location-id', locationId);
  fixture.detectChanges();
}

describe('AdminPrograms', () => {
  it('lists positions on the default tab', async () => {
    const { host } = await configure({
      positions: [positionOf('pos_1'), positionOf('pos_2')],
    });

    expect(rowsOf(host, 'admin-positions-list').length).toBe(2);
  });

  it('opens a blank create form and saves a new position', async () => {
    const { fixture, host, world } = await configure();

    click(host, 'admin-new');
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();

    fillInput(host, 'admin-position-title-en', 'Barber');
    fillInput(host, 'admin-position-title-bg', 'Бръснар');
    fillInput(host, 'admin-position-summary-en', 'Full-time chair');
    fillInput(host, 'admin-position-summary-bg', 'Пълен работен ден');
    fixture.detectChanges();

    click(host, 'admin-save');
    await settle(fixture);

    expect([...world.positions.values()]).toEqual([
      {
        id: PositionId.of('generated-1'),
        title: { en: 'Barber', bg: 'Бръснар' },
        summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
        locationIds: [],
        positionStatus: PositionStatus.Open,
        applyUrl: null,
        sortOrder: 0,
      },
    ]);
    expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
  });

  it('shows an error and keeps the form open when the save fails validation', async () => {
    const { fixture, host, world } = await configure();

    click(host, 'admin-new');
    fixture.detectChanges();

    // Blank title — ProgramsSystem refuses it.
    click(host, 'admin-save');
    await settle(fixture);

    expect(world.positions.size).toBe(0);
    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="admin-save-error"]'),
    ).not.toBeNull();
  });

  it('opens an edit form pre-filled from the clicked row', async () => {
    const { fixture, host } = await configure({
      positions: [
        positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
      ],
    });

    rowsOf(host, 'admin-positions-list')[0]?.click();
    fixture.detectChanges();

    const closedChip = Array.from(
      host.querySelectorAll('[data-testid="admin-form"] button[uichip]'),
    ).find((el) => el.textContent?.trim() === 'Closed');
    expect(closedChip?.getAttribute('data-selected')).toBe('');
  });

  it('switches tabs and clears any open form', async () => {
    const { fixture, host } = await configure({
      positions: [positionOf('pos_1')],
    });

    click(host, 'admin-new');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();

    click(host, 'admin-tab-courses');
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="admin-courses-list"]'),
    ).not.toBeNull();
  });

  describe('positions (flip 4)', () => {
    it('prints each role status as its lowercase word, never the stored tag (F4-7)', async () => {
      const { host } = await configure({
        positions: [
          positionOf('pos_closed', {
            positionStatus: PositionStatus.Closed,
            sortOrder: 1,
          }),
          positionOf('pos_open', { sortOrder: 0 }),
        ],
      });

      expect(trailingTextOf(host, 'admin-positions-list')).toBe(
        'open · closed',
      );
    });

    it('wipes the stored location ids on an edit — the form has none (F4-8)', async () => {
      const { fixture, host, world } = await configure({
        positions: [
          positionOf('pos_1', {
            locationIds: [LocationId.of('loc-center')],
          }),
        ],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_1'))).toEqual(
        positionOf('pos_1', { locationIds: [] }),
      );
      expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    });
  });

  describe('courses (flip 4)', () => {
    it('prints each enrolment status as its lowercase word, never the stored tag (F4-7)', async () => {
      const { fixture, host } = await configure({
        courses: [
          courseOf('course_closed', {
            enrollmentStatus: EnrollmentStatus.Closed,
            sortOrder: 2,
          }),
          courseOf('course_open', { sortOrder: 0 }),
          courseOf('course_upcoming', {
            enrollmentStatus: EnrollmentStatus.Upcoming,
            sortOrder: 1,
          }),
        ],
      });

      click(host, 'admin-tab-courses');
      fixture.detectChanges();

      expect(trailingTextOf(host, 'admin-courses-list')).toBe(
        'open · upcoming · closed',
      );
    });

    it('saves an upcoming course with no starts label as the flat body', async () => {
      const { fixture, host, world } = await configure();

      click(host, 'admin-tab-courses');
      fixture.detectChanges();
      click(host, 'admin-new');
      fixture.detectChanges();
      fillInput(host, 'admin-course-title-en', ' Fading ');
      fillInput(host, 'admin-course-title-bg', 'Фейд');
      fillInput(host, 'admin-course-description-en', 'Six weeks');
      fillInput(host, 'admin-course-description-bg', 'Шест седмици');
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          '[data-testid="admin-form"] button[uichip]',
        ),
      )
        .find((chip) => chip.textContent?.trim() === 'Upcoming')
        ?.click();
      fixture.detectChanges();

      click(host, 'admin-save');
      await settle(fixture);

      expect([...world.courses.values()]).toEqual([
        {
          id: CourseId.of('generated-1'),
          title: { en: 'Fading', bg: 'Фейд' },
          description: { en: 'Six weeks', bg: 'Шест седмици' },
          enrollmentStatus: EnrollmentStatus.Upcoming,
          startsLabel: null,
          applyUrl: null,
          sortOrder: 0,
        },
      ]);
    });

    it('refuses a starts label given in one language only and saves nothing', async () => {
      const { fixture, host, world } = await configure();

      click(host, 'admin-tab-courses');
      fixture.detectChanges();
      click(host, 'admin-new');
      fixture.detectChanges();
      fillInput(host, 'admin-course-title-en', 'Fading');
      fillInput(host, 'admin-course-title-bg', 'Фейд');
      fillInput(host, 'admin-course-description-en', 'Six weeks');
      fillInput(host, 'admin-course-description-bg', 'Шест седмици');
      fillInput(host, 'admin-course-starts-label-en', 'Spring 2027');
      fixture.detectChanges();

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.courses.size).toBe(0);
      expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
      expect(
        host.querySelector('[data-testid="admin-save-error"]'),
      ).not.toBeNull();
    });
  });

  describe('events (flip 4)', () => {
    it('saves the wall clock typed as the local day, the minute and the Sofia instant', async () => {
      const { fixture, host, world } = await configure();

      await openNewEventForm(fixture, host, '2026-11-05T19:00');
      click(host, 'admin-save');
      await settle(fixture);

      expect([...world.events.values()]).toEqual([
        {
          id: EventId.of('generated-1'),
          title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
          description: { en: 'Walk-in trims', bg: 'Подстригвания' },
          localDate: localDate('2026-11-05'),
          startMinutes: 1140,
          // After the fall-back switch: Sofia is UTC+2.
          utcEpochMs: utcMs('2026-11-05T19:00:00.000+02:00'),
          locationId: null,
          applyUrl: null,
          sortOrder: 0,
        },
      ]);
      expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    });

    it('refuses a start inside the spring-forward gap and saves nothing (F4-1 (a))', async () => {
      const { fixture, host, world } = await configure();

      await openNewEventForm(fixture, host, '2027-03-28T03:30');
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.events.size).toBe(0);
      expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
      expect(
        host.querySelector('[data-testid="admin-save-error"]'),
      ).not.toBeNull();
    });

    it('saves a typed location that names no shop on the default shop zone (F4-1 (c))', async () => {
      const { fixture, host, world } = await configure();

      await openNewEventForm(fixture, host, '2026-11-05T19:00', 'loc-nowhere');
      click(host, 'admin-save');
      await settle(fixture);

      const saved = world.events.get(EventId.of('generated-1'));
      expect(saved?.locationId).toBe(LocationId.of('loc-nowhere'));
      expect(saved?.utcEpochMs).toBe(utcMs('2026-11-05T19:00:00.000+02:00'));
    });

    it('pre-fills the start as the input reads it, zero-padded (F4-11)', async () => {
      const { fixture, host } = await configure({
        events: [
          shopEventOf('ev_evening', {
            title: textFixture('Evening'),
            localDate: localDate('2026-11-05'),
            startMinutes: at(19),
            locationId: LocationId.of('loc-center'),
          }),
          shopEventOf('ev_morning', {
            title: textFixture('Morning'),
            localDate: localDate('2026-11-06'),
            startMinutes: at(9, 5),
          }),
        ],
      });
      click(host, 'admin-tab-events');
      fixture.detectChanges();

      rowTitled(host, 'admin-events-list', 'Evening').click();
      fixture.detectChanges();
      expect(valueOf(host, 'admin-event-starts-at')).toBe('2026-11-05T19:00');
      expect(valueOf(host, 'admin-event-location-id')).toBe('loc-center');

      click(host, 'admin-tab-events');
      fixture.detectChanges();
      rowTitled(host, 'admin-events-list', 'Morning').click();
      fixture.detectChanges();
      expect(valueOf(host, 'admin-event-starts-at')).toBe('2026-11-06T09:05');
      expect(valueOf(host, 'admin-event-location-id')).toBe('');
    });

    it('lists the upcoming events soonest first, then the past ones latest first, split at the pinned now', async () => {
      const { fixture, host } = await configure({
        events: [
          shopEventOf('ev_past_early', {
            title: textFixture('Past early'),
            localDate: localDate('2026-09-10'),
          }),
          shopEventOf('ev_later', {
            title: textFixture('Later'),
            localDate: localDate('2026-10-12'),
          }),
          // Today (2026-09-28) at 08:00 — an hour before the pinned now.
          shopEventOf('ev_this_morning', {
            title: textFixture('This morning'),
            localDate: localDate('2026-09-28'),
            startMinutes: at(8),
          }),
          shopEventOf('ev_past_late', {
            title: textFixture('Past late'),
            localDate: localDate('2026-09-20'),
          }),
          // Today at 10:00 — an hour after the pinned now.
          shopEventOf('ev_at_ten', {
            title: textFixture('Today at ten'),
            localDate: localDate('2026-09-28'),
            startMinutes: at(10),
          }),
        ],
      });

      click(host, 'admin-tab-events');
      fixture.detectChanges();

      expect(titlesOf(host, 'admin-events-list')).toEqual([
        'Today at ten',
        'Later',
        'This morning',
        'Past late',
        'Past early',
      ]);
    });

    it('lists no event at all when one side of now fails to read (F4-8)', async () => {
      const { fixture, host } = await configure(
        {
          events: [
            shopEventOf('ev_upcoming', { localDate: localDate('2026-10-12') }),
          ],
        },
        (double) => ({
          observeEvents: (query) =>
            query.upcoming
              ? double.observeEvents(query)
              : of(Result.err(RepositoryError.unavailable())),
        }),
      );

      click(host, 'admin-tab-events');
      fixture.detectChanges();

      expect(rowsOf(host, 'admin-events-list')).toHaveLength(0);
    });
  });
});
