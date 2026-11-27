import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Component,
  EnvironmentProviders,
  Injectable,
  input,
} from '@angular/core';
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
import { SiteHeaderComponent } from '@creativo/features/shared/shell';
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
import { By } from '@angular/platform-browser';
import { UiModalSheet } from '@creativo/ui/controls';
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

/** Redraws the mounted page; set by `configure`. */
let redraw: () => void = () => undefined;

/**
 * Types into a field. A translated field is named with its language
 * (`…-bg`, `…-en`) and is on screen only while that language is in view,
 * so a field that is not there is reached through the switcher first.
 */
function fillInput(host: HTMLElement, testId: string, value: string): void {
  const language = /-(bg|en)$/.exec(testId)?.[1];
  if (
    language !== undefined &&
    host.querySelector(`[data-testid="${testId}"]`) === null
  ) {
    click(host, `admin-language-${language}`);
    redraw();
  }
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

/** The form's status segment worded `label`. */
function segmentWorded(host: HTMLElement, label: string): HTMLButtonElement {
  const chip = Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="admin-form"] ui-segmented-control button[role="radio"]',
    ),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!chip) throw new Error(`no status segment worded ${label}`);
  return chip;
}

/** The role form's shop chips, each as `label` (selected marked `✓`), in order. */
function shopChipsOf(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="admin-position-shops-all"], [data-testid^="admin-position-shop-"]',
    ),
    // The head and each shop, by their words; «✓» when chosen, «–» when
    // only some of what the head stands for is.
    (control) => {
      const words = control
        .querySelector('.ui-check-list__label')
        ?.textContent?.trim();
      const state = control.getAttribute('aria-checked');
      return `${words}${state === 'true' ? ' ✓' : state === 'mixed' ? ' –' : ''}`;
    },
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

/** The shared site header, inert: the page's own suite does not sign anyone in. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- a test double answers to the shell selector it stands in for.
  selector: 'cr-site-header',
  template: '',
  host: { '[attr.data-over-hero]': 'uiOverHero()' },
})
class InertSiteHeader {
  readonly uiOverHero = input(true);
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
  // The page's header is the shared shell's, proven in its own specs; here
  // it stands in as an inert element, so the session it reads is not this
  // suite's concern.
  TestBed.overrideComponent(AdminPrograms, {
    remove: { imports: [SiteHeaderComponent] },
    add: { imports: [InertSiteHeader] },
  });
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
  redraw = () => fixture.detectChanges();
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

/**
 * Is the editor sheet up: drawn, and not on its way out. (jsdom runs no
 * animation, so a closing sheet stays in the page; the browser removes it
 * when its fade ends.)
 */
function formOpen(fixture: ComponentFixture<AdminPrograms>): boolean {
  const sheet = fixture.debugElement.query(By.directive(UiModalSheet));
  return sheet !== null && !(sheet.componentInstance as UiModalSheet).closing();
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
  it('carries the site header, its way to the menu, solid over no hero', async () => {
    const { host } = await configure();
    const header = host.querySelector('cr-site-header');
    expect(header).not.toBeNull();
    expect(header?.getAttribute('data-over-hero')).toBe('false');
  });

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

    expect(formOpen(fixture)).toBe(true);

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
        workplaceMode: 'ON_SITE',
        locationIds: [],
        positionStatus: PositionStatus.Open,
        applyUrl: null,
        sortOrder: 0,
      },
    ]);
    expect(formOpen(fixture)).toBe(false);
  });

  it('asks for the missing translations and sends nothing, the fields of the language in view marked', async () => {
    const { fixture, host, world } = await configure();

    click(host, 'admin-new');
    fixture.detectChanges();
    // Nothing is marked before a save is tried.
    expect(host.querySelector('.ui-segmented-control__attention')).toBeNull();

    click(host, 'admin-save');
    await settle(fixture);

    expect(world.positions.size).toBe(0);
    expect(formOpen(fixture)).toBe(true);
    expect(host.querySelector('[data-testid="admin-save-error"]')).toBeNull();
    expect(textOf(host, 'admin-translation-owed')).toBe(
      'A translation is missing: Bulgarian, English.',
    );
    // The shop's own language is owed, so the sheet stays on it.
    for (const field of [
      'admin-position-title-bg',
      'admin-position-summary-bg',
    ]) {
      expect(
        host
          .querySelector(`[data-testid="${field}"]`)
          ?.getAttribute('aria-invalid'),
      ).toBe('true');
    }
    for (const language of ['bg', 'en']) {
      expect(
        host.querySelector(
          `[data-testid="admin-language-${language}"] .ui-segmented-control__attention`,
        ),
      ).not.toBeNull();
    }
  });

  it('turns to the language that owes a translation, and offers the shop’s own words to start from', async () => {
    const { fixture, host, world } = await configure();

    click(host, 'admin-new');
    fixture.detectChanges();
    fillInput(host, 'admin-position-title-bg', 'Бръснар');
    fillInput(host, 'admin-position-summary-bg', 'Пълен работен ден');
    fixture.detectChanges();
    // In the shop's own language there is nothing to copy from.
    expect(
      host.querySelector('[data-testid="admin-language-copy"]'),
    ).toBeNull();

    click(host, 'admin-save');
    await settle(fixture);

    expect(world.positions.size).toBe(0);
    expect(textOf(host, 'admin-translation-owed')).toBe(
      'A translation is missing: English.',
    );
    expect(
      host
        .querySelector('[data-testid="admin-language-en"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      host.querySelector(
        '[data-testid="admin-language-bg"] .ui-segmented-control__attention',
      ),
    ).toBeNull();

    expect(textOf(host, 'admin-language-copy')).toBe('Copy from Bulgarian');
    click(host, 'admin-language-copy');
    fixture.detectChanges();
    expect(
      host.querySelector<HTMLInputElement>(
        '[data-testid="admin-position-title-en"]',
      )?.value,
    ).toBe('Бръснар');
    fillInput(host, 'admin-position-title-en', 'Barber');
    fixture.detectChanges();

    click(host, 'admin-save');
    await settle(fixture);

    const [saved] = [...world.positions.values()];
    expect(saved?.title).toEqual({ bg: 'Бръснар', en: 'Barber' });
    expect(saved?.summary).toEqual({
      bg: 'Пълен работен ден',
      en: 'Пълен работен ден',
    });
    expect(formOpen(fixture)).toBe(false);
  });

  it('opens an edit form pre-filled from the clicked row', async () => {
    const { fixture, host } = await configure({
      positions: [
        positionOf('pos_1', { positionStatus: PositionStatus.Closed }),
      ],
    });

    rowsOf(host, 'admin-positions-list')[0]?.click();
    fixture.detectChanges();

    expect(
      host
        .querySelector('[data-testid="admin-position-open"]')
        ?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('switches tabs and clears any open form', async () => {
    const { fixture, host } = await configure({
      positions: [positionOf('pos_1')],
    });

    click(host, 'admin-new');
    fixture.detectChanges();
    expect(formOpen(fixture)).toBe(true);

    click(host, 'admin-tab-courses');
    fixture.detectChanges();

    expect(formOpen(fixture)).toBe(false);
    expect(
      host.querySelector('[data-testid="admin-courses-list"]'),
    ).not.toBeNull();
  });

  it('words the page from the catalogue in the active language (OR-37)', async () => {
    const { fixture, host } = await configure();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Programs');
    expect(textOf(host, 'admin-tab-events')).toBe('Events');
    expect(
      host
        .querySelector('[data-testid="admin-new"]')
        ?.getAttribute('aria-label'),
    ).toBe('Add');

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
      (label) => label.querySelector('span')?.textContent?.trim(),
    );
    // One language at a time: each translated field is on the sheet once.
    expect(labels).toEqual([
      'Заглавие',
      'Описание',
      'Начало — по часа на салона',
      'Линк за записване',
    ]);
    expect(
      host.querySelector('#admin-programs-sheet-title')?.textContent?.trim(),
    ).toBe('Ново събитие');
    expect(textOf(host, 'admin-save')).toBe('Запази');
  });

  describe('the order of a list', () => {
    const three = () => [
      positionOf('pos_a', { title: textFixture('A', 'А'), sortOrder: 0 }),
      positionOf('pos_b', { title: textFixture('B', 'Б'), sortOrder: 1 }),
      positionOf('pos_c', { title: textFixture('C', 'В'), sortOrder: 2 }),
    ];
    const rowNames = (host: HTMLElement) =>
      Array.from(
        host.querySelectorAll('[data-testid^="admin-order-row-"]'),
        (row) =>
          row.querySelector('.ui-list-row__label > span')?.textContent?.trim(),
      );

    it('puts a new position after the last one, with no order field in the form', async () => {
      const { fixture, host, world } = await configure({ positions: three() });

      click(host, 'admin-new');
      fixture.detectChanges();
      expect(host.querySelector('input[type="number"]')).toBeNull();
      fillInput(host, 'admin-position-title-en', 'New');
      fillInput(host, 'admin-position-title-bg', 'Нова');
      fillInput(host, 'admin-position-summary-en', 'Summary');
      fillInput(host, 'admin-position-summary-bg', 'Описание');
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('generated-1'))?.sortOrder).toBe(
        3,
      );
    });

    it('keeps the place a position has when it is edited', async () => {
      const { fixture, host, world } = await configure({ positions: three() });

      (
        host.querySelectorAll<HTMLElement>(
          '[data-testid="admin-positions-list"] button',
        )[2] as HTMLElement
      ).click();
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_c'))?.sortOrder).toBe(2);
    });

    it('offers «Reorder» only where there is an order to arrange', async () => {
      const { fixture, host } = await configure({
        positions: three(),
        courses: [courseOf('course_only')],
      });

      expect(
        host.querySelector('[data-testid="admin-order-start"]'),
      ).not.toBeNull();
      click(host, 'admin-tab-courses');
      fixture.detectChanges();
      expect(
        host.querySelector('[data-testid="admin-order-start"]'),
      ).toBeNull();
      click(host, 'admin-tab-events');
      fixture.detectChanges();
      expect(
        host.querySelector('[data-testid="admin-order-start"]'),
      ).toBeNull();
    });

    it('gives each row a handle, moves one through its menu and saves only the places that changed', async () => {
      const { fixture, host, world } = await configure({ positions: three() });

      click(host, 'admin-order-start');
      fixture.detectChanges();
      expect(rowNames(host)).toEqual(['A', 'B', 'C']);
      // «Готово» stands where «Подреди» stood; the add keeps its place.
      expect(host.querySelector('[data-testid="admin-new"]')).not.toBeNull();
      expect(
        host
          .querySelector('[data-testid="admin-order-handle-pos_c"]')
          ?.getAttribute('aria-label'),
      ).toBe('Move “C”');

      // The handle only drags: the places open from the row's own mark.
      expect(
        host
          .querySelector('[data-testid="admin-order-place-pos_c"]')
          ?.getAttribute('aria-label'),
      ).toBe('Place of “C”');
      click(host, 'admin-order-place-pos_c');
      fixture.detectChanges();
      const top = host.querySelector<HTMLButtonElement>(
        '[data-testid="admin-order-row-pos_c"] [data-testid="admin-order-top"]',
      );
      top?.click();
      fixture.detectChanges();
      // The list shows the move at once, ahead of the save.
      expect(rowNames(host)).toEqual(['C', 'A', 'B']);
      await settle(fixture);

      expect(
        ['pos_a', 'pos_b', 'pos_c'].map(
          (id) => world.positions.get(PositionId.of(id))?.sortOrder,
        ),
      ).toEqual([1, 2, 0]);
      expect(
        host.querySelector('[aria-live="polite"]')?.textContent?.trim(),
      ).toBe('“C” — place 1 of 3');

      click(host, 'admin-order-done');
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="admin-order-done"]')).toBeNull();
      expect(
        host.querySelector('[data-testid="admin-order-start"]'),
      ).not.toBeNull();
    });

    it('turns a role’s status over from the action behind its row, without opening the editor', async () => {
      const { fixture, host, world } = await configure({ positions: three() });
      const before = world.positions.get(PositionId.of('pos_a'));

      const action = host.querySelector<HTMLButtonElement>(
        '[data-testid="admin-row-quick-pos_a"]',
      );
      expect(action?.textContent?.trim()).toBe(
        before?.positionStatus === PositionStatus.Open ? 'Close' : 'Open',
      );
      action?.click();
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_a'))).toEqual({
        ...before,
        positionStatus:
          before?.positionStatus === PositionStatus.Open
            ? PositionStatus.Closed
            : PositionStatus.Open,
      });
      expect(formOpen(fixture)).toBe(false);
      expect(
        host.querySelector('[data-testid="admin-quick-error"]'),
      ).toBeNull();
    });

    it.each([
      [EnrollmentStatus.Upcoming, 'Open', EnrollmentStatus.Open],
      [EnrollmentStatus.Closed, 'Open', EnrollmentStatus.Open],
      [EnrollmentStatus.Open, 'Close', EnrollmentStatus.Closed],
    ])(
      'turns a %s course’s enrolment over from the action behind its row («%s»)',
      async (stored, word, turned) => {
        const { fixture, host, world } = await configure({
          courses: [courseOf('course_a', { enrollmentStatus: stored })],
        });
        click(host, 'admin-tab-courses');
        fixture.detectChanges();

        const action = host.querySelector<HTMLButtonElement>(
          '[data-testid="admin-row-quick-course_a"]',
        );
        expect(action?.textContent?.trim()).toBe(word);
        action?.click();
        await settle(fixture);

        expect(
          world.courses.get(CourseId.of('course_a'))?.enrollmentStatus,
        ).toBe(turned);
        expect(formOpen(fixture)).toBe(false);
      },
    );

    it('starts a new event from a copy: the sheet opens filled, and saving it leaves the first as it was', async () => {
      const stored = shopEventOf('ev_first');
      const { fixture, host, world } = await configure({ events: [stored] });
      click(host, 'admin-tab-events');
      fixture.detectChanges();

      const action = host.querySelector<HTMLButtonElement>(
        '[data-testid="admin-row-quick-ev_first"]',
      );
      expect(action?.textContent?.trim()).toBe('Duplicate');
      action?.click();
      fixture.detectChanges();

      expect(formOpen(fixture)).toBe(true);
      expect(
        host.querySelector<HTMLInputElement>(
          '[data-testid="admin-event-title-bg"]',
        )?.value,
      ).toBe(stored.title.bg);
      // Nothing is written until the sheet's own save.
      expect(world.events.size).toBe(1);

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.events.size).toBe(2);
      expect(world.events.get(stored.id)).toEqual(stored);
      const copy = [...world.events.values()].find(
        (event) => event.id !== stored.id,
      );
      expect(copy).toEqual({
        ...stored,
        id: copy?.id,
        sortOrder: copy?.sortOrder,
      });
    });

    it('disables the places a row already holds', async () => {
      const { fixture, host } = await configure({ positions: three() });

      click(host, 'admin-order-start');
      fixture.detectChanges();
      const disabled = (row: string, place: string) =>
        host.querySelector<HTMLButtonElement>(
          `[data-testid="admin-order-row-${row}"] [data-testid="admin-order-${place}"]`,
        )?.disabled;
      expect([disabled('pos_a', 'top'), disabled('pos_a', 'up')]).toEqual([
        true,
        true,
      ]);
      expect([disabled('pos_a', 'down'), disabled('pos_c', 'bottom')]).toEqual([
        false,
        true,
      ]);
    });
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

    it('closes a role with the switch at the end of the sheet', async () => {
      const stored = positionOf('pos_1');
      const { fixture, host, world } = await configure({
        positions: [stored],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      const open = () =>
        host
          .querySelector('[data-testid="admin-position-open"]')
          ?.getAttribute('aria-checked');
      expect(open()).toBe('true');

      click(host, 'admin-position-open');
      fixture.detectChanges();
      expect(open()).toBe('false');
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(stored.id)?.positionStatus).toBe(
        PositionStatus.Closed,
      );
    });

    it('names each section of the sheet for what it asks', async () => {
      const { fixture, host } = await configure({
        positions: [positionOf('pos_1')],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();

      expect(
        [...host.querySelectorAll('.lib-admin-programs__section h3')].map(
          (heading) => heading.textContent?.trim(),
        ),
      ).toEqual(['About the role', 'Where', 'Applying', 'Visibility']);
    });

    it('keeps the stored scope on an edit (OR-42)', async () => {
      const stored = [MLADOST.id, CENTER.id];
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [positionOf('pos_1', { locationIds: stored })],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      // Prefilled from the stored scope: both named, so the head is whole.
      expect(shopChipsOf(host)).toEqual([
        'All shops ✓',
        'Center ✓',
        'Mladost ✓',
      ]);

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(PositionId.of('pos_1'))).toEqual(
        positionOf('pos_1', { locationIds: stored }),
      );
      expect(formOpen(fixture)).toBe(false);
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

    it('edits the scope through the check list (OR-42)', async () => {
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [positionOf('pos_1')],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      // Open at every shop: the head and every shop are checked.
      expect(shopChipsOf(host)).toEqual([
        'All shops ✓',
        'Center ✓',
        'Mladost ✓',
      ]);

      click(host, 'admin-position-shop-loc-center');
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual(['All shops –', 'Center', 'Mladost ✓']);
      expect(textOf(host, 'admin-position-shops-all')).toContain('1 of 2');

      // From «some», the head chooses every shop — "every shop", written `[]`.
      click(host, 'admin-position-shops-all');
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual([
        'All shops ✓',
        'Center ✓',
        'Mladost ✓',
      ]);
      click(host, 'admin-save');
      await settle(fixture);
      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual(
        [],
      );

      // One shop taken off names the rest.
      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      click(host, 'admin-position-shop-loc-center');
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);
      expect(world.positions.get(PositionId.of('pos_1'))?.locationIds).toEqual([
        MLADOST.id,
      ]);
    });

    it('makes a role remote: the shops list goes, and the role is saved tied to no shop', async () => {
      const stored = positionOf('pos_1', { locationIds: [MLADOST.id] });
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [stored],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      expect(host.querySelector('ui-check-list')).not.toBeNull();

      click(host, 'admin-position-workplace-REMOTE');
      fixture.detectChanges();
      expect(host.querySelector('ui-check-list')).toBeNull();

      // Turning back finds the shops as they were picked.
      click(host, 'admin-position-workplace-HYBRID');
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual(['All shops –', 'Center', 'Mladost ✓']);

      click(host, 'admin-position-workplace-REMOTE');
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(stored.id)).toEqual({
        ...stored,
        workplaceMode: 'REMOTE',
        locationIds: [],
      });
    });

    it('saves a remote role whose shops were all unchecked: no shop is owed', async () => {
      const stored = positionOf('pos_1', { locationIds: [MLADOST.id] });
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [stored],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      click(host, 'admin-position-shop-loc-mladost');
      fixture.detectChanges();
      click(host, 'admin-position-workplace-REMOTE');
      fixture.detectChanges();
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(stored.id)?.workplaceMode).toBe('REMOTE');
      expect(formOpen(fixture)).toBe(false);
    });

    it('refuses a role limited to no shop, and says so on the list', async () => {
      const stored = positionOf('pos_1', { locationIds: [MLADOST.id] });
      const { fixture, host, world } = await configure({
        locations: [CENTER, MLADOST],
        positions: [stored],
      });

      rowsOf(host, 'admin-positions-list')[0]?.click();
      fixture.detectChanges();
      click(host, 'admin-position-shop-loc-mladost');
      fixture.detectChanges();
      expect(shopChipsOf(host)).toEqual(['All shops', 'Center', 'Mladost']);
      expect(
        host.querySelector('[data-testid="admin-position-shops-hint"]'),
      ).toBeNull();

      click(host, 'admin-save');
      await settle(fixture);

      expect(world.positions.get(stored.id)).toEqual(stored);
      expect(formOpen(fixture)).toBe(true);
      expect(textOf(host, 'admin-position-shops-hint')).toBe(
        'Choose at least one shop.',
      );
      expect(
        host.querySelector('ui-check-list')?.hasAttribute('data-invalid'),
      ).toBe(true);

      // Choosing one takes the refusal away.
      click(host, 'admin-position-shop-loc-center');
      fixture.detectChanges();
      expect(
        host.querySelector('[data-testid="admin-position-shops-hint"]'),
      ).toBeNull();
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
        'All shops –',
        'Center ✓',
        'Mladost',
        'Old Town (hidden) ✓',
        'Deleted shop ✓',
      ]);

      await inBulgarian(fixture);
      expect(shopChipsOf(host)).toEqual([
        'Всички салони –',
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
      segmentWorded(host, 'Upcoming').click();
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
      expect(formOpen(fixture)).toBe(true);
      // An optional field is translated whole or left out whole: the sheet
      // turns to the language that lacks it and marks the field.
      expect(textOf(host, 'admin-translation-owed')).toBe(
        'A translation is missing: Bulgarian.',
      );
      expect(
        host
          .querySelector('[data-testid="admin-course-starts-label-bg"]')
          ?.getAttribute('aria-invalid'),
      ).toBe('true');
      expect(
        host
          .querySelector('[data-testid="admin-course-title-bg"]')
          ?.getAttribute('aria-invalid'),
      ).toBeNull();
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
      expect(formOpen(fixture)).toBe(false);
    });

    it('refuses a start inside the spring-forward gap in its own words and saves nothing (F4-1 (a))', async () => {
      const { fixture, host, world } = await configure();

      await openNewEventForm(fixture, host, '2027-03-28T03:30');
      click(host, 'admin-save');
      await settle(fixture);

      expect(world.events.size).toBe(0);
      expect(formOpen(fixture)).toBe(true);
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
      expect(formOpen(fixture)).toBe(true);
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
      expect(formOpen(fixture)).toBe(false);
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
      expect(formOpen(fixture)).toBe(false);
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
