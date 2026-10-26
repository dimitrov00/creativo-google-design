import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, firstValueFrom, of } from 'rxjs';
import {
  EnrollmentStatus,
  LocationStatus,
  PositionStatus,
} from '@core/components';
import type { ShopLocation } from '@core/entities';
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
  memoryCatalogReadPorts,
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
  CATALOG_PORTS,
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
 * world's first shop, `loc-center`, is the default shop, in `Europe/Sofia`.
 * The catalogue lists the world's ACTIVE shops; a hidden one is still a
 * stored document `loadLocation` reads. Fresh ids are `generated-1`,
 * `generated-2`, … in call order.
 */

/** «Център», the default shop — what a row names it (`shortName`). */
const CENTER = locationFixture({
  shortName: textFixture('Center', 'Център'),
  sortOrder: 1,
});
/** «Младост», the second shop — at a two-shop tenant the pickers draw. */
const MLADOST = locationFixture({
  id: LocationId.of('loc-mladost'),
  name: textFixture('Creativo · Mladost', 'Креативо · Младост'),
  shortName: textFixture('Mladost', 'Младост'),
  sortOrder: 2,
});
/** A shop taken off the catalogue — stored, never listed. */
const HIDDEN = locationFixture({
  id: LocationId.of('loc-old-town'),
  name: textFixture('Creativo · Old Town', 'Креативо · Стария град'),
  shortName: textFixture('Old Town', 'Стария град'),
  locationStatus: LocationStatus.Hidden,
  sortOrder: 3,
});
/** An id no shop answers — its document was deleted. */
const GONE = LocationId.of('loc-gone');

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

function textOf(host: HTMLElement, testId: string): string {
  return (
    host.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? ''
  );
}

/** The form's chip worded `label`. */
function chipWorded(host: HTMLElement, label: string): HTMLButtonElement {
  const chip = Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="admin-form"] button[uichip]',
    ),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!chip) throw new Error(`no chip worded ${label}`);
  return chip;
}

/** The role form's shop chips, each as `label` (selected marked `✓`), in order. */
function shopChipsOf(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="admin-position-shops-all"], [data-testid^="admin-position-shop-"]',
    ),
    (chip) =>
      `${chip.textContent?.trim()}${chip.hasAttribute('data-selected') ? ' ✓' : ''}`,
  );
}

/**
 * The app's own words for `lang` — the page's (`admin.programs`), the
 * status words its rows and chips print (`programs.status`, OR-53) and the
 * refusal copy (`errors`) — read, never re-typed, so each case pins the
 * catalogue's words. Every other key renders as itself.
 */
function catalogueWords(lang: string): Translation {
  const file = resolve(
    __dirname,
    `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly admin: { readonly programs: Translation };
    readonly programs: { readonly status: Translation };
    readonly errors: Translation;
  };
  return {
    admin: { programs: catalogue.admin.programs },
    programs: { status: catalogue.programs.status },
    errors: catalogue.errors,
  };
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueWords(lang));
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      // As the app runs (`provideI18n`): a switch re-renders the words.
      reRenderOnLangChange: true,
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/**
 * The page over a world seeded with `seed` (the default shop alone unless
 * `seed.locations` names the shops). A case that scripts a member of the
 * suite overrides it over the full double, which it receives.
 */
async function configure(
  seed: ProgramsWorldSeed = {},
  scripted: (double: ProgramsPorts) => Partial<ProgramsPorts> = () => ({}),
): Promise<{
  fixture: ComponentFixture<AdminPrograms>;
  host: HTMLElement;
  world: ProgramsWorld;
}> {
  const locations: readonly ShopLocation[] = seed.locations ?? [CENTER];
  const world = memoryProgramsWorld({ ...seed, locations });
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
        provide: CATALOG_PORTS,
        useValue: memoryCatalogReadPorts({ locations }),
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

/** Switches the page to bg once its words are loaded, then renders. */
async function inBulgarian(
  fixture: ComponentFixture<AdminPrograms>,
): Promise<void> {
  const transloco = TestBed.inject(TranslocoService);
  await firstValueFrom(transloco.load('bg'));
  transloco.setActiveLang('bg');
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Lets a save's whole read-decide-write chain (or a stored shop's read) run, then renders. */
async function settle(fixture: ComponentFixture<AdminPrograms>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();
}

async function openNewEventForm(
  fixture: ComponentFixture<AdminPrograms>,
  host: HTMLElement,
  startsAt: string,
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
  fixture.detectChanges();
}

/** Opens the event's «Салон» menu and picks the option `testId` names. */
function pickShop(
  fixture: ComponentFixture<AdminPrograms>,
  host: HTMLElement,
  testId: string,
): void {
  click(host, 'admin-event-shop-trigger');
  fixture.detectChanges();
  click(host, testId);
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

  it('shows the generic line and keeps the form open when the save fails validation', async () => {
    const { fixture, host, world } = await configure();

    click(host, 'admin-new');
    fixture.detectChanges();

    // Blank title and summary — ProgramsSystem refuses all four fields.
    click(host, 'admin-save');
    await settle(fixture);

    expect(world.positions.size).toBe(0);
    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
    expect(textOf(host, 'admin-save-error')).toBe(
      "Couldn't save. Check the required fields and try again.",
    );
  });

  it('opens an edit form pre-filled from the clicked row', async () => {
    const { fixture, host } = await configure({
      positions: [
        positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
      ],
    });

    rowsOf(host, 'admin-positions-list')[0]?.click();
    fixture.detectChanges();

    expect(chipWorded(host, 'Closed').getAttribute('data-selected')).toBe('');
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

  it('words the page from the catalogue in the active language (OR-37)', async () => {
    const { fixture, host } = await configure();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Programs');
    expect(textOf(host, 'admin-tab-events')).toBe('Events');
    expect(textOf(host, 'admin-new')).toBe('+ New');

    await inBulgarian(fixture);
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Програми');
    expect(textOf(host, 'admin-tab-positions')).toBe('Позиции');
    expect(textOf(host, 'admin-tab-courses')).toBe('Курсове');
    expect(textOf(host, 'admin-tab-events')).toBe('Събития');

    click(host, 'admin-tab-events');
    fixture.detectChanges();
    click(host, 'admin-new');
    fixture.detectChanges();
    const labels = Array.from(
      host.querySelectorAll('[data-testid="admin-form"] label'),
      (label) => label.childNodes[0]?.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Заглавие (EN)',
      'Заглавие (BG)',
      'Описание (EN)',
      'Описание (BG)',
      'Начало — по часа на салона',
      'Линк за записване (по избор — иначе Instagram)',
      'Подредба',
    ]);
    expect(textOf(host, 'admin-save')).toBe('Запази');
  });

  describe('positions (flip 4)', () => {
    it("prints each role status as the catalogue's word, never the stored tag (F4-7)", async () => {
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
        'Open · Closed',
      );
    });

    it('prints the bg words, agreeing with «позиция» (OR-53)', async () => {
      const { fixture, host } = await configure({
        positions: [
          positionOf('pos_closed', {
            positionStatus: PositionStatus.Closed,
            sortOrder: 1,
          }),
          positionOf('pos_open', { sortOrder: 0 }),
        ],
      });

      await inBulgarian(fixture);

      expect(trailingTextOf(host, 'admin-positions-list')).toBe(
        'Отворена · Затворена',
      );
    });

    it('keeps the stored scope on an edit (OR-42)', async () => {
      const stored = [MLADOST.id, CENTER.id];
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [positionOf('pos_1', { locationIds: stored })],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      // Prefilled from the stored scope — «Всеки салон» is not chosen.
      expect(shopChipsOf(host)).toEqual(['Any shop', 'Center ✓', 'Mladost ✓']);

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_1'))).toEqual(
        positionOf('pos_1', { locationIds: stored }),
      );
      expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    });

    it('keeps the stored scope at a one-shop tenant, where no chip is drawn', async () => {
      const { fixture, host, world } = await configure({
        positions: [positionOf('pos_1', { locationIds: [CENTER.id] })],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual([]);

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual([
        CENTER.id,
      ]);
    });

    it('edits the scope through the chips (OR-42)', async () => {
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [positionOf('pos_1')],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual(['Any shop ✓', 'Center', 'Mladost']);

      click(host, 'admin-position-shop-loc-mladost');
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual(['Any shop', 'Center', 'Mladost ✓']);
      click(host, 'admin-save');
      await settle(fixture);
      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual([
        MLADOST.id,
      ]);

      // «Всеки салон» clears the scope: every shop again, written `[]`.
      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      click(host, 'admin-position-shops-all');
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);
      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual(
        [],
      );
    });

    it('shows a stored shop the list does not hold as a hidden or deleted chip, kept on save', async () => {
      const stored = [HIDDEN.id, GONE, CENTER.id];
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST, HIDDEN],
        positions: [positionOf('pos_1', { locationIds: stored })],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      await settle(fixture);
      expect(shopChipsOf(host)).toEqual([
        'Any shop',
        'Center ✓',
        'Mladost',
        'Old Town (hidden) ✓',
        'Deleted shop ✓',
      ]);

      await inBulgarian(fixture);
      expect(shopChipsOf(host)).toEqual([
        'Всеки салон',
        'Център ✓',
        'Младост',
        'Стария град (скрит) ✓',
        'Изтрит салон ✓',
      ]);

      click(host, 'admin-save');
      await settle(fixture);
      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual(
        stored,
      );
    });
  });

  describe('courses (flip 4)', () => {
    it("prints each enrolment status as the catalogue's word, never the stored tag (F4-7)", async () => {
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
        'Open · Upcoming · Closed',
      );
    });

    it('prints the bg words, agreeing with «курс» (OR-53)', async () => {
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
      await inBulgarian(fixture);

      expect(trailingTextOf(host, 'admin-courses-list')).toBe(
        'Отворен · Предстоящ · Затворен',
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
      chipWorded(host, 'Upcoming').click();
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
      // One refusal the catalogue has no words for: the generic line.
      expect(textOf(host, 'admin-save-error')).toBe(
        "Couldn't save. Check the required fields and try again.",
      );
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

    it('refuses a start inside the spring-forward gap in its own words and saves nothing (F4-1 (a))', async () => {
      const { fixture, host, world } = await configure();

      await openNewEventForm(fixture, host, '2027-03-28T03:30');
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.events.size).toBe(0);
      expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
      expect(textOf(host, 'admin-save-error')).toBe(
        "2027-03-28T03:30 doesn't exist in Europe/Sofia — the clocks jump past it. Pick another time.",
      );
    });

    it('draws no shop menu at a one-shop tenant (OR-37)', async () => {
      const { fixture, host } = await configure();

      await openNewEventForm(fixture, host, '2026-11-05T19:00');

      expect(host.querySelector('[data-testid="admin-event-shop"]')).toBeNull();
    });

    it('picks a shop through the menu — no specific shop first — and saves it (OR-37)', async () => {
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
      });

      await openNewEventForm(fixture, host, '2026-11-05T19:00');
      expect(textOf(host, 'admin-event-shop-trigger')).toBe('No specific shop');
      click(host, 'admin-event-shop-trigger');
      fixture.detectChanges();
      const options = Array.from(
        host.querySelectorAll(
          '[data-testid="admin-event-shop"] [role="menuitemradio"]',
        ),
        (option) => option.textContent?.trim(),
      );
      expect(options).toEqual(['No specific shop', 'Center', 'Mladost']);
      click(host, 'admin-event-shop-loc-mladost');
      fixture.detectChanges();
      expect(textOf(host, 'admin-event-shop-trigger')).toBe('Mladost');

      click(host, 'admin-save');
      await settle(fixture);

      const saved = world.events.get(EventId.of('generated-1'));
      expect(saved?.locationId).toBe(MLADOST.id);
      expect(saved?.utcEpochMs).toBe(utcMs('2026-11-05T19:00:00.000+02:00'));
    });

    it('refuses an event whose stored shop was deleted, in its own words, until another is picked (OR-38)', async () => {
      const stored = shopEventOf('ev_gone', {
        title: textFixture('Gone'),
        locationId: GONE,
      });
      const { fixture, host, world } = await configure({ events: [stored] });
      click(host, 'admin-tab-events');
      fixture.detectChanges();

      rowTitled(host, 'admin-events-list', 'Gone').click();
      await settle(fixture);
      // One shop, yet the menu draws: the stored id is never dropped silently.
      expect(textOf(host, 'admin-event-shop-trigger')).toBe('Deleted shop');

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.events.get(stored.id)).toEqual(stored);
      expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
      expect(textOf(host, 'admin-save-error')).toBe(
        'That shop no longer exists. Pick another.',
      );

      await inBulgarian(fixture);
      expect(textOf(host, 'admin-save-error')).toBe(
        'Този салон вече не съществува. Избери друг.',
      );

      pickShop(fixture, host, 'admin-event-shop-none');
      click(host, 'admin-save');
      await settle(fixture);
      expect(world.events.get(stored.id)?.locationId).toBeNull();
      expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    });

    it('keeps a hidden shop under its own name, and saves it on its zone (OR-37)', async () => {
      const stored = shopEventOf('ev_old_town', {
        title: textFixture('Old Town night'),
        locationId: HIDDEN.id,
      });
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST, HIDDEN],
        events: [stored],
      });
      click(host, 'admin-tab-events');
      fixture.detectChanges();

      rowTitled(host, 'admin-events-list', 'Old Town night').click();
      await settle(fixture);
      expect(textOf(host, 'admin-event-shop-trigger')).toBe(
        'Old Town (hidden)',
      );

      click(host, 'admin-save');
      await settle(fixture);
      expect(world.events.get(stored.id)).toEqual(stored);
      expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    });

    it('pre-fills the start as the input reads it, zero-padded, and the shop the event is at (F4-11)', async () => {
      const { fixture, host } = await configure({
        locations: [CENTER, MLADOST],
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
      expect(textOf(host, 'admin-event-shop-trigger')).toBe('Center');

      click(host, 'admin-tab-events');
      fixture.detectChanges();
      rowTitled(host, 'admin-events-list', 'Morning').click();
      fixture.detectChanges();
      expect(valueOf(host, 'admin-event-starts-at')).toBe('2026-11-06T09:05');
      expect(textOf(host, 'admin-event-shop-trigger')).toBe('No specific shop');
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
