import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { NEVER, type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_STATS_DIRECTORY,
  type ClientStatsRecord,
  ZonedDateTime,
  clientStatsFromDocument,
  ok,
} from '@creativo/application/booking';
import { InMemoryClientStatsDirectory } from '@creativo/application/booking/testing';
import {
  CATALOG_READER,
  Service,
  ServiceCategory,
} from '@creativo/application/catalog';
import {
  STREAK_DEFINITION_REPOSITORY,
  StreakDefinition,
  type StreakDefinitionRepository,
} from '@creativo/application/engagement';
import { InMemoryStreakDefinitionRepository } from '@creativo/application/engagement/testing';
import {
  CLOCK,
  ID_GENERATOR,
  provideFeatureFlags,
} from '@creativo/application/shared';
import { AdminRhythmStore } from '../admin-rhythm.store';
import { AdminRhythm } from './admin-rhythm';

// ── The app's own words ──────────────────────────────────────────────────

function catalogue(lang: 'bg' | 'en'): Translation {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Translation;
}

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogue(lang === 'en' ? 'en' : 'bg'));
  }
}

// ── The shop ─────────────────────────────────────────────────────────────

/** Monday 28 September 2026, 12:40 in Sofia. */
const NOW = '2026-09-28T12:40:00';
const TODAY = '2026-09-28';
const ZONE = 'Europe/Sofia';

function unwrap<T>(result: { isFailure(): boolean; value: T }): T {
  if (result.isFailure()) throw new Error('the fixture is no good');
  return result.value;
}

function daysAgo(days: number): string {
  const noon = unwrap(ZonedDateTime.fromISO(`${TODAY}T12:00:00`, ZONE));
  return new Date(noon.plusDays(-days).toMillis()).toISOString();
}

function statsOf(uid: string, visits: readonly string[]): ClientStatsRecord {
  const record = clientStatsFromDocument(uid, {
    userId: uid,
    lifetime: {
      visitsCompleted: visits.length,
      noShows: 0,
      lateCancels: 0,
      clientCancels: 0,
    },
    last365: {
      visitsCompleted: visits.map((at, index) => ({
        appointmentId: `appt-${uid}-${index}`,
        at,
      })),
      noShows: [],
      lateCancels: [],
    },
    firstVisitAt: visits[0] ?? null,
    lastVisit: null,
    nextVisit: null,
    avgCadenceDays: null,
    preferredBarberId: null,
    usualServiceIds: [],
    pauseSuggestion: null,
    version: 1,
    updatedAt: `${TODAY}T06:00:00.000Z`,
  });
  if (record === null) throw new Error(`the statistics of ${uid} do not parse`);
  return record;
}

function shop(): ClientStatsRecord[] {
  return [
    statsOf('steady', [daysAgo(94), daysAgo(66), daysAgo(38), daysAgo(10)]),
    statsOf('six-weeks', [daysAgo(82), daysAgo(40)]),
    statsOf('late', [daysAgo(120), daysAgo(60)]),
    statsOf('gone', [daysAgo(200)]),
  ];
}

const SERVICES = [
  unwrap(
    Service.create({
      id: 'fade',
      name: { bg: 'Фейд', en: 'Skin fade' },
      description: { bg: 'Фейд', en: 'Skin fade' },
      categoryId: 'hair',
      priceMinorUnits: 2800,
      currencyCode: 'EUR',
      durationMinutes: 30,
      locationIds: [],
      conflictsWith: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: true,
      status: 'active',
      sortOrder: 0,
    }),
  ),
];
const CATEGORIES = [
  unwrap(
    ServiceCategory.create({
      id: 'hair',
      name: { bg: 'Коса', en: 'Hair' },
      sortOrder: 0,
    }),
  ),
];

// ── The rig ──────────────────────────────────────────────────────────────

interface RigOptions {
  readonly rules?: StreakDefinitionRepository;
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly catalog?: boolean;
}

const seeded = () =>
  InMemoryStreakDefinitionRepository.seeded({ today: TODAY });

async function rig(options: RigOptions = {}) {
  let issued = 0;
  TestBed.configureTestingModule({
    imports: [AdminRhythm],
    providers: [
      provideRouter([]),
      provideFeatureFlags(options.flags ?? { 'loyalty.streaks': true }),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      {
        provide: CLOCK,
        useValue: { now: (zone: string) => ZonedDateTime.fromISO(NOW, zone) },
      },
      {
        provide: ID_GENERATOR,
        useValue: {
          next: () => `request-${String((issued += 1)).padStart(6, '0')}`,
        },
      },
      {
        provide: STREAK_DEFINITION_REPOSITORY,
        useValue: options.rules ?? seeded(),
      },
      {
        provide: CLIENT_STATS_DIRECTORY,
        useValue: new InMemoryClientStatsDirectory(shop()),
      },
      ...(options.catalog === false
        ? []
        : [
            {
              provide: CATALOG_READER,
              useValue: {
                listActiveServices: () => of(ok(SERVICES)),
                listServiceCategories: () => of(ok(CATEGORIES)),
                listActiveBarbers: () => of(ok([])),
                listActiveLocations: () => of(ok([])),
                findServiceById: async () => ok(null),
                findBarberById: async () => ok(null),
                findLocationById: async () => ok(null),
              },
            },
          ]),
    ],
  });
  const fixture = TestBed.createComponent(AdminRhythm);
  await settle(fixture);
  const store = fixture.debugElement.injector.get(AdminRhythmStore);
  return { fixture, store, host: fixture.nativeElement as HTMLElement };
}

/** Lets every pending read answer and the view follow (real timers). */
async function settle(fixture: ComponentFixture<unknown>, rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    fixture.detectChanges();
  }
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Waits for the preview's pause (600 ms) and whatever follows it. */
async function wait(fixture: ComponentFixture<unknown>, ms: number) {
  await new Promise((done) => setTimeout(done, ms));
  await settle(fixture, 3);
}

const byId = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const text = (host: HTMLElement, id: string) =>
  byId(host, id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

function click(host: HTMLElement, id: string): void {
  const el = byId(host, id);
  if (el === null) throw new Error(`no element ${id}`);
  el.click();
}

/** Moves a ruler: the native range under the drawn one. */
function slide(host: HTMLElement, id: string, value: number): void {
  const input = byId(host, id) as HTMLInputElement | null;
  if (input === null) throw new Error(`no ruler ${id}`);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Types a figure into a unit field and leaves it. */
function type(host: HTMLElement, id: string, value: string): void {
  const input = byId(host, id) as HTMLInputElement | null;
  if (input === null) throw new Error(`no field ${id}`);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const alertActions = () =>
  [...document.querySelectorAll<HTMLElement>('.ui-alert__action')].map((a) =>
    a.textContent?.trim(),
  );

const alertOpen = () =>
  document.querySelector('.ui-alert__dialog[open]') !== null;

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── The page at rest ─────────────────────────────────────────────────────

describe('«Ритъм», at rest', () => {
  it('names itself once, and prints the rule in force as the client card does', async () => {
    const { host } = await rig();
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(text(host, 'admin-rhythm-title')).toBe('Ритъм');
    expect(text(host, 'admin-rhythm-lede')).toBe(
      'Кога едно посещение пази ритъма на клиента.',
    );
    expect(text(host, 'admin-rhythm-sentence')).toBe(
      'Посещение на всеки 6 седмици пази ритъма.',
    );
    // The digest, not the rule's clauses: grace · protections · excuses.
    expect(text(host, 'admin-rhythm-digest')).toBe(
      'гратис 7 дни · защити до 2 в запас · извинения 3 от 4',
    );
    expect(byId(host, 'admin-rhythm-details')).toBeNull();
    expect(text(host, 'admin-rhythm-in-force')).toMatch(/^В сила от /);
    expect(byId(host, 'admin-rhythm-sample')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-empty')).toBeNull();
    expect(byId(host, 'admin-rhythm-flag-off')).toBeNull();
  });

  it('draws the sample run as an illustration: a captioned figure, the track’s sentence, no count of its own', async () => {
    const { host } = await rig();
    const figure = byId(host, 'admin-rhythm-sample')?.closest('figure');
    expect(figure).not.toBeNull();
    expect(figure?.firstElementChild?.tagName).toBe('FIGCAPTION');
    expect(text(host, 'admin-rhythm-sample-caption')).toBe('Пример');
    expect(
      byId(host, 'admin-rhythm-sample')
        ?.querySelector('[role="img"]')
        ?.getAttribute('aria-label'),
    ).toMatch(/^\d+ посещения в ритъм$/);
    // The page's one live count is the preview's: nothing else on the
    // page prints «в ритъм» as a figure's caption.
    expect(
      [...host.querySelectorAll('.ui-metric__caption')].filter(
        (caption) =>
          caption.closest('[data-testid="admin-rhythm-sample"]') === null,
      ),
    ).toHaveLength(0);
  });

  it('draws the DS pieces the spec names: elevated cards, grouped rows, rulers, title3 headings', async () => {
    const { host } = await rig();
    expect(byId(host, 'admin-rhythm-rule')?.getAttribute('data-tone')).toBe(
      'elevated',
    );
    expect(byId(host, 'admin-rhythm-rule')?.getAttribute('data-padding')).toBe(
      'comfortable',
    );
    expect(
      host.querySelectorAll('ul.ui-list-group, ui-list-group').length,
    ).toBeGreaterThan(3);
    expect(
      byId(host, 'admin-rhythm-interval-weeks')?.getAttribute('type'),
    ).toBe('range');
    expect(byId(host, 'admin-rhythm-grace')?.getAttribute('max')).toBe('21');
    for (const heading of host.querySelectorAll('.ui-section-header')) {
      expect(heading.getAttribute('data-header-prominence')).toBe('increased');
      expect(heading.querySelector('h2[uititle]')).not.toBeNull();
    }
  });

  it('has no dock and no «Влизане в сила» without a draft', async () => {
    const { host } = await rig();
    expect(byId(host, 'admin-rhythm-save')).toBeNull();
    expect(byId(host, 'admin-rhythm-effective')).toBeNull();
    expect(byId(host, 'admin-rhythm-preview')).toBeNull();
  });

  it('names every switch and labels every module as a region', async () => {
    const { host } = await rig();
    for (const toggle of host.querySelectorAll('button[uiswitch]')) {
      expect(toggle.getAttribute('aria-label')).toBeTruthy();
    }
    for (const section of host.querySelectorAll('section')) {
      const id = section.getAttribute('aria-labelledby') ?? '';
      expect(id).toBeTruthy();
      expect(host.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });

  it('lets the switch row’s label wrap beside its switch, as the typed rows do', async () => {
    const { host } = await rig();
    for (const id of [
      'admin-rhythm-hold',
      'admin-rhythm-hold-days',
      'admin-rhythm-min-gap',
    ]) {
      const row = byId(host, id)?.closest('.ui-list-row');
      expect(row?.hasAttribute('data-label-wraps'), id).toBe(true);
    }
  });

  it('lists the history, newest first, the seed as the first rule by the system', async () => {
    const { host } = await rig();
    const rows = [
      ...host.querySelectorAll('[data-testid^="admin-rhythm-version-"]'),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.textContent).toContain('първо правило');
    expect(rows[0]?.textContent).toContain('системата');
    expect(byId(host, 'admin-rhythm-withdraw')).toBeNull();
  });

  it('shows the value rows’ readings', async () => {
    const { host } = await rig();
    expect(text(host, 'admin-rhythm-row-protections-value')).toBe(
      'До 2 в запас',
    );
    expect(text(host, 'admin-rhythm-row-excuses-value')).toBe('3 от 4');
    expect(text(host, 'admin-rhythm-row-afterMiss-value')).toBe(
      'Започва отначало',
    );
    expect(text(host, 'admin-rhythm-risk-lead')).toBe('7 дни');
    expect(byId(host, 'admin-rhythm-services')).toBeNull();
  });
});

// ── The states ───────────────────────────────────────────────────────────

describe('«Ритъм», its states', () => {
  it('shows the skeleton while the rule has not answered', async () => {
    const { host } = await rig({
      rules: {
        observe: () => NEVER,
        listVersions: () => new Promise(() => undefined),
        publish: () => new Promise(() => undefined),
        withdraw: () => new Promise(() => undefined),
      },
    });
    expect(
      host
        .querySelector('lib-admin-rhythm, [data-testid="admin-rhythm"]')
        ?.getAttribute('data-state'),
    ).toBe('loading');
    expect(byId(host, 'admin-rhythm-skeleton')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-rule')).toBeNull();
  });

  it('says the rule did not load, and asks again on «Опитай пак»', async () => {
    const rules = seeded().failWith();
    const { host, fixture } = await rig({ rules });
    expect(text(host, 'admin-rhythm-failed')).toContain(
      'Правилото не се зареди.',
    );
    const observed = rules.calls.filter((c) => c.method === 'observe').length;
    rules.recover();
    click(host, 'admin-rhythm-retry');
    await settle(fixture);
    expect(
      rules.calls.filter((c) => c.method === 'observe').length,
    ).toBeGreaterThan(observed);
    expect(byId(host, 'admin-rhythm-rule')).not.toBeNull();
  });

  it('opens on the recommended rule where none is published, and offers «Запази»', async () => {
    const { host } = await rig({
      rules: new InMemoryStreakDefinitionRepository({}, { today: TODAY }),
    });
    expect(text(host, 'admin-rhythm-empty')).toBe(
      'Още няма правило. Това са препоръчаните стойности.',
    );
    expect(byId(host, 'admin-rhythm-in-force')).toBeNull();
    expect(byId(host, 'admin-rhythm-save')).not.toBeNull();
  });

  it('works with the flag off and says so', async () => {
    const { host } = await rig({ flags: { 'loyalty.streaks': false } });
    expect(text(host, 'admin-rhythm-flag-off')).toBe(
      'Ритъмът още не е включен за приложението.',
    );
    expect(byId(host, 'admin-rhythm-interval-weeks')).not.toBeNull();
  });

  it('takes the dock away offline and says why', async () => {
    const { host, fixture } = await rig();
    slide(host, 'admin-rhythm-interval-weeks', 8);
    await settle(fixture);
    expect(byId(host, 'admin-rhythm-save')).not.toBeNull();
    window.dispatchEvent(new Event('offline'));
    await settle(fixture);
    expect(byId(host, 'admin-rhythm-save')).toBeNull();
    expect(text(host, 'admin-rhythm-offline')).toContain('Без връзка');
    window.dispatchEvent(new Event('online'));
    await settle(fixture);
    expect(byId(host, 'admin-rhythm-save')).not.toBeNull();
  });

  it('shows the waiting version: its capsule, its line and the row that calls it off', async () => {
    const rules = seeded();
    const next = unwrap(
      StreakDefinition.default().revise(
        { interval: { kind: 'fixed', days: 35 } },
        '2026-10-10',
      ),
    );
    unwrap(
      await rules.publish({
        requestId: 'elsewhere',
        baseVersion: 1,
        definition: next,
        transition: 'grandfather',
        previewHash: null,
      }),
    );
    const { host, fixture, store } = await rig({ rules });
    expect(text(host, 'admin-rhythm-in-force')).toBe('От 10.10');
    expect(text(host, 'admin-rhythm-upcoming')).toBe(
      'От 10.10: На всеки 5 седмици · 7 дни гратис',
    );
    expect(byId(host, 'admin-rhythm-withdraw')).not.toBeNull();
    // Arm, then confirm.
    click(host, 'admin-rhythm-withdraw');
    await settle(fixture);
    expect(
      byId(host, 'admin-rhythm-withdraw')?.hasAttribute('data-armed'),
    ).toBe(true);
    expect(store.upcoming()).not.toBeNull();
    click(host, 'admin-rhythm-withdraw');
    await settle(fixture);
    expect(store.upcoming()).toBeNull();
    expect(byId(host, 'admin-rhythm-withdraw')).toBeNull();
  });
});

// ── The draft ────────────────────────────────────────────────────────────

describe('«Ритъм», the draft', () => {
  it('follows the ruler: the readout, the sentence, the dock, «Влизане в сила» and the preview', async () => {
    const { host, fixture, store } = await rig();
    slide(host, 'admin-rhythm-interval-weeks', 8);
    await settle(fixture);
    expect(store.draft().interval).toEqual({ kind: 'fixed', days: 56 });
    expect(text(host, 'admin-rhythm-interval-readout')).toBe('8 седмици');
    expect(text(host, 'admin-rhythm-sentence')).toBe(
      'Посещение на всеки 8 седмици пази ритъма.',
    );
    expect(byId(host, 'admin-rhythm-save')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-effective')).not.toBeNull();
    expect(text(host, 'admin-rhythm-effective-from-value')).toBe('От утре');
    expect(byId(host, 'admin-rhythm-preview')).not.toBeNull();
    await wait(fixture, 900);
    expect(text(host, 'admin-rhythm-preview-clients')).toMatch(/клиент/);
    expect(text(host, 'admin-rhythm-preview-summary')).toMatch(/ритъм/);
    expect(byId(host, 'admin-rhythm-preview-inRhythm')).not.toBeNull();
  });

  it('clamps a typed figure and shows what was kept', async () => {
    const { host, fixture, store } = await rig();
    type(host, 'admin-rhythm-min-gap', '40');
    await settle(fixture);
    expect(store.draft().minGapDays).toBe(14);
    expect((byId(host, 'admin-rhythm-min-gap') as HTMLInputElement).value).toBe(
      '14',
    );
    type(host, 'admin-rhythm-hold-days', 'abc');
    await settle(fixture);
    expect(store.draft().bookingHold.maxDaysPastDue).toBe(14);
  });

  it('collapses what counts, the interval, the grace and the more rules when the rule is off', async () => {
    const { host, fixture, store } = await rig();
    click(host, 'admin-rhythm-enabled');
    await settle(fixture);
    expect(store.draft().enabled).toBe(false);
    expect(text(host, 'admin-rhythm-sentence')).toMatch(/^Изключено\./);
    expect(byId(host, 'admin-rhythm-interval-weeks')).toBeNull();
    expect(byId(host, 'admin-rhythm-row-protections')).toBeNull();
    expect(byId(host, 'admin-rhythm-sample')).toBeNull();
    expect(byId(host, 'admin-rhythm-rule')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-effective')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-history')).not.toBeNull();
  });

  it('switches to the personal interval: the tolerance ruler and the clamp in weeks', async () => {
    const { host, fixture, store } = await rig();
    click(host, 'admin-rhythm-interval-kind');
    await settle(fixture);
    click(host, 'admin-rhythm-option-interval-personal');
    await settle(fixture);
    expect(store.draft().interval.kind).toBe('personal');
    expect(text(host, 'admin-rhythm-tolerance-readout')).toBe('+50 %');
    expect(
      (byId(host, 'admin-rhythm-clamp-min') as HTMLInputElement).value,
    ).toBe('3');
    expect(
      (byId(host, 'admin-rhythm-clamp-max') as HTMLInputElement).value,
    ).toBe('10');
    expect(
      (byId(host, 'admin-rhythm-fallback') as HTMLInputElement).value,
    ).toBe('6');
    type(host, 'admin-rhythm-fallback', '12');
    await settle(fixture);
    const interval = store.draft().interval;
    expect(interval.kind === 'personal' && interval.fallbackDays).toBe(70);
  });

  it('opens the services sheet when «избрани услуги» is picked, and lists the row', async () => {
    const { host, fixture, store } = await rig();
    click(host, 'admin-rhythm-qualifier');
    await settle(fixture);
    click(host, 'admin-rhythm-option-qualifier-services');
    await settle(fixture);
    expect(
      host.querySelector('lib-admin-rhythm-sheet')?.getAttribute('data-kind'),
    ).toBe('services');
    expect(byId(host, 'admin-rhythm-services')).not.toBeNull();
    expect(byId(host, 'admin-rhythm-service-fade')).not.toBeNull();
    // With nothing chosen the draft is no rule: no dock.
    expect(byId(host, 'admin-rhythm-save')).toBeNull();
    click(host, 'admin-rhythm-service-fade');
    await settle(fixture);
    expect(text(host, 'admin-rhythm-services-value')).toBe('1 услуга');
    expect(byId(host, 'admin-rhythm-save')).not.toBeNull();
    // The counted service is named by the STORE's rule (the sheets and the
    // client card print it); the card's digest stays the three facts.
    expect(store.rule()?.details.at(-1)).toBe('Броят се посещения с: Фейд.');
    expect(text(host, 'admin-rhythm-digest')).toBe(
      'гратис 7 дни · защити до 2 в запас · извинения 3 от 4',
    );
  });

  it('opens a sheet from each value row', async () => {
    const { host, fixture } = await rig();
    for (const kind of ['protections', 'excuses', 'afterMiss'] as const) {
      click(host, `admin-rhythm-row-${kind}`);
      await settle(fixture);
      expect(
        host.querySelector('lib-admin-rhythm-sheet')?.getAttribute('data-kind'),
      ).toBe(kind);
      expect(byId(host, `admin-rhythm-sheet-${kind}`)).not.toBeNull();
      click(host, 'admin-rhythm-sheet-done');
      await settle(fixture);
    }
  });

  it('offers tomorrow, the first of the month and a day of the admin’s own', async () => {
    const { host, fixture, store } = await rig();
    slide(host, 'admin-rhythm-grace', 10);
    await settle(fixture);
    click(host, 'admin-rhythm-effective-from');
    await settle(fixture);
    click(host, 'admin-rhythm-option-effective-first-of-month');
    await settle(fixture);
    expect(store.effectiveFrom()).toBe('2026-10-01');
    expect(text(host, 'admin-rhythm-effective-from-value')).toBe(
      'От 1-во число',
    );
    click(host, 'admin-rhythm-effective-from');
    await settle(fixture);
    click(host, 'admin-rhythm-option-effective-pick');
    await settle(fixture);
    expect(
      host.querySelector('lib-admin-rhythm-sheet')?.getAttribute('data-kind'),
    ).toBe('day');
    expect(byId(host, 'admin-rhythm-day-picker')).not.toBeNull();
  });
});

// ── «Запази» ─────────────────────────────────────────────────────────────

describe('«Запази»', () => {
  it('saves a looser change at once and raises the receipt with «Отмени»', async () => {
    const rules = seeded();
    const { host, fixture, store } = await rig({ rules });
    slide(host, 'admin-rhythm-interval-weeks', 8);
    await settle(fixture);
    click(host, 'admin-rhythm-save');
    await settle(fixture);
    expect(alertOpen()).toBe(false);
    expect(rules.calls.some((c) => c.method === 'publish')).toBe(true);
    expect(text(host, 'admin-rhythm-toast')).toMatch(
      /^Правилото е запазено · от 29\.09/,
    );
    expect(text(host, 'admin-rhythm-toast')).toContain('Отмени');
    expect(store.upcoming()).not.toBeNull();
    expect(byId(host, 'admin-rhythm-save')).toBeNull();
    // «Отмени» calls the waiting version off.
    (
      host.querySelector(
        '[data-testid="admin-rhythm-toast"] .ui-toast__action',
      ) as HTMLElement
    ).click();
    await settle(fixture);
    expect(store.upcoming()).toBeNull();
  });

  it('asks first for a stricter rule, with the preview’s counts, and saves on «Запази»', async () => {
    const rules = seeded();
    const { host, fixture } = await rig({ rules });
    slide(host, 'admin-rhythm-interval-weeks', 4);
    await settle(fixture);
    await wait(fixture, 900);
    click(host, 'admin-rhythm-save');
    await settle(fixture);
    expect(alertOpen()).toBe(true);
    expect(
      document.querySelector('.ui-alert__title')?.textContent?.trim(),
    ).toBe('Запази по-строго правило?');
    expect(document.querySelector('.ui-alert__message')?.textContent).toMatch(
      /клиент/,
    );
    expect(alertActions()).toEqual(['Запази', 'Продължи редакцията']);
    expect(rules.calls.some((c) => c.method === 'publish')).toBe(false);
    (
      document.querySelector(
        '[data-testid="admin-rhythm-confirm-save"]',
      ) as HTMLElement
    ).click();
    await settle(fixture);
    expect(rules.calls.some((c) => c.method === 'publish')).toBe(true);
    // The receipt, without undo.
    expect(text(host, 'admin-rhythm-toast')).toMatch(/^Правилото е запазено/);
    expect(
      host.querySelector(
        '[data-testid="admin-rhythm-toast"] .ui-toast__action',
      ),
    ).toBeNull();
  });

  it('asks before switching the rhythm off, and keeps the draft on «Продължи редакцията»', async () => {
    const rules = seeded();
    const { host, fixture, store } = await rig({ rules });
    click(host, 'admin-rhythm-enabled');
    await settle(fixture);
    click(host, 'admin-rhythm-save');
    await settle(fixture);
    expect(
      document.querySelector('.ui-alert__title')?.textContent?.trim(),
    ).toBe('Изключи ритъма?');
    expect(
      document.querySelector('.ui-alert__message')?.textContent?.trim(),
    ).toBe('Картата на клиента спира да го показва. Натрупаното се пази.');
    (
      document.querySelector(
        '[data-testid="admin-rhythm-confirm-keep"]',
      ) as HTMLElement
    ).click();
    await settle(fixture);
    expect(alertOpen()).toBe(false);
    expect(rules.calls.some((c) => c.method === 'publish')).toBe(false);
    expect(store.draft().enabled).toBe(false);
  });

  it('says the rule moved under the draft when the server refuses it as stale', async () => {
    const rules = seeded();
    const { host, fixture } = await rig({ rules });
    slide(host, 'admin-rhythm-interval-weeks', 8);
    await settle(fixture);
    rules.refuseWith('stale');
    click(host, 'admin-rhythm-save');
    await settle(fixture);
    expect(text(host, 'admin-rhythm-refusal')).toBe(
      'Правилото беше променено от друг. Виж новото.',
    );
  });
});

// ── The guard ────────────────────────────────────────────────────────────

describe('confirmLeave', () => {
  it('lets the admin go at once without a draft', async () => {
    const { fixture } = await rig();
    await expect(fixture.componentInstance.confirmLeave()).resolves.toBe(true);
    expect(alertOpen()).toBe(false);
  });

  it('asks with a draft: «Отхвърли» discards and lets go, the safe answer keeps the draft', async () => {
    const { host, fixture, store } = await rig();
    slide(host, 'admin-rhythm-grace', 10);
    await settle(fixture);
    const asked = fixture.componentInstance.confirmLeave();
    await settle(fixture);
    expect(
      document.querySelector('.ui-alert__title')?.textContent?.trim(),
    ).toBe('Отхвърли промените?');
    expect(alertActions()).toEqual(['Отхвърли', 'Продължи редакцията']);
    (
      document.querySelector(
        '[data-testid="admin-rhythm-confirm-keep"]',
      ) as HTMLElement
    ).click();
    await settle(fixture);
    await expect(asked).resolves.toBe(false);
    expect(store.dirty()).toBe(true);

    const askedAgain = fixture.componentInstance.confirmLeave();
    await settle(fixture);
    (
      document.querySelector(
        '[data-testid="admin-rhythm-confirm-discard"]',
      ) as HTMLElement
    ).click();
    await settle(fixture);
    await expect(askedAgain).resolves.toBe(true);
    expect(store.dirty()).toBe(false);
    expect(store.draft().graceDays).toBe(7);
  });
});
