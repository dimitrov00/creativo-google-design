import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/application/booking';
import { CompositionKind } from '@core/components';
import type { Service, ServiceCategory } from '@core/entities';
import { ServiceCategoryId, ServiceId } from '@core/primitives';
import { serviceFixture, termsFixture, textFixture } from '@core/testing';
import { STREAK_DEFINITION_REPOSITORY } from '@creativo/application/engagement';
import { InMemoryStreakDefinitionRepository } from '@creativo/application/engagement/testing';
import { CLOCK, provideFeatureFlags } from '@creativo/application/shared';
import { AdminRhythmStore } from '../admin-rhythm.store';
import type { RhythmServiceGroup } from '../admin-rhythm/rhythm-service-groups';
import {
  AdminRhythmSheet,
  type AdminRhythmSheetKind,
} from './admin-rhythm-sheet';

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

const NOW = '2026-09-28T12:40:00';
const TODAY = '2026-09-28';

/** A catalogue service as stored (`services/{id}`), the flat entity (Law 5). */
function service(
  id: string,
  bg: string,
  category: string,
  sortOrder: number,
): Service {
  return serviceFixture({
    id: ServiceId.of(id),
    name: textFixture(id, bg),
    description: textFixture(id, bg),
    categoryId: ServiceCategoryId.of(category),
    ...termsFixture(2800, 30),
    offerings: [],
    locationIds: [],
    compositionKind: CompositionKind.Single,
    popular: true,
    sortOrder,
  });
}

const HAIR: ServiceCategory = {
  id: ServiceCategoryId.of('hair'),
  name: textFixture('Hair', 'Коса'),
  sortOrder: 0,
};
const BEARD: ServiceCategory = {
  id: ServiceCategoryId.of('beard'),
  name: textFixture('Beard', 'Брада'),
  sortOrder: 1,
};

const GROUPS: readonly RhythmServiceGroup[] = [
  {
    category: HAIR,
    services: [
      service('fade', 'Фейд', 'hair', 0),
      service('classic', 'Класическо', 'hair', 1),
    ],
  },
  {
    category: BEARD,
    services: [service('beard', 'Оформяне на брада', 'beard', 0)],
  },
];

// ── The rig ──────────────────────────────────────────────────────────────

async function rig(kind: AdminRhythmSheetKind | null, services = GROUPS) {
  TestBed.configureTestingModule({
    imports: [AdminRhythmSheet],
    providers: [
      AdminRhythmStore,
      provideFeatureFlags({ 'loyalty.streaks': true }),
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
        provide: STREAK_DEFINITION_REPOSITORY,
        useValue: InMemoryStreakDefinitionRepository.seeded({ today: TODAY }),
      },
    ],
  });
  const store = TestBed.inject(AdminRhythmStore);
  store.load();
  const fixture = TestBed.createComponent(AdminRhythmSheet);
  fixture.componentRef.setInput('services', services);
  fixture.componentRef.setInput('kind', kind);
  const closed: number[] = [];
  fixture.componentInstance.closed.subscribe(() => closed.push(1));
  await settle(fixture);
  return { fixture, store, host: fixture.nativeElement as HTMLElement, closed };
}

async function settle(fixture: ComponentFixture<unknown>, rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    fixture.detectChanges();
  }
  await fixture.whenStable();
  fixture.detectChanges();
}

const byId = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function click(host: HTMLElement, id: string): void {
  const el = byId(host, id);
  if (el === null) throw new Error(`no element ${id}`);
  el.click();
}

const sheetOpen = (host: HTMLElement) =>
  host.querySelector('ui-modal-sheet')?.getAttribute('data-state');

/** The exit's end, as the engine would say it. */
function finishExit(host: HTMLElement): void {
  const surface = host.querySelector('ui-modal-sheet ui-sheet');
  if (surface === null) throw new Error('no sheet');
  const event = Object.assign(new Event('transitionend', { bubbles: false }), {
    propertyName: 'opacity',
  });
  surface.dispatchEvent(event);
}

afterEach(() => {
  TestBed.resetTestingModule();
});

// ── Open and closed ──────────────────────────────────────────────────────

describe('lib-admin-rhythm-sheet', () => {
  it('is closed without a kind', async () => {
    const { host } = await rig(null);
    expect(sheetOpen(host)).toBe('closed');
    expect(host.querySelector('.admin-rhythm-sheet__body')).toBeNull();
  });

  it('opens on a kind, names itself, and closes through «Готово»: the exit, then `closed`', async () => {
    const { host, fixture, closed } = await rig('protections');
    expect(sheetOpen(host)).toBe('open');
    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Защити');
    // The shell hands the name to the dialog surface it wraps.
    expect(
      host.querySelector('[aria-labelledby]')?.getAttribute('aria-labelledby'),
    ).toBe(host.querySelector('h2')?.id);
    click(host, 'admin-rhythm-sheet-done');
    await settle(fixture, 2);
    expect(sheetOpen(host)).toBe('closing');
    expect(closed).toHaveLength(0);
    finishExit(host);
    await settle(fixture, 2);
    expect(closed).toHaveLength(1);
    // The kind on screen is kept through the exit; the owner clears it.
    fixture.componentRef.setInput('kind', null);
    await settle(fixture, 2);
    expect(sheetOpen(host)).toBe('closed');
  });

  it('closes the same way on a dismiss (✕, the scrim, Escape)', async () => {
    const { host, fixture, closed } = await rig('afterMiss');
    (
      host.querySelector(
        'ui-modal-sheet .ui-sheet-header button[uibutton]',
      ) as HTMLElement
    ).click();
    await settle(fixture, 2);
    expect(sheetOpen(host)).toBe('closing');
    finishExit(host);
    await settle(fixture, 2);
    expect(closed).toHaveLength(1);
  });
});

// ── Protections ──────────────────────────────────────────────────────────

describe('«Защити»', () => {
  it('holds the switch, the reserve, the earning and the first protection; the quieter three leave with the switch', async () => {
    const { host, fixture, store } = await rig('protections');
    expect(
      byId(host, 'admin-rhythm-protections-max')?.getAttribute('data-count'),
    ).toBe('2');
    expect(
      byId(host, 'admin-rhythm-protections-every')?.textContent?.trim(),
    ).toBe('на всеки 5 посещения');
    expect(
      byId(host, 'admin-rhythm-protections-start')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    click(host, 'admin-rhythm-protections');
    await settle(fixture, 2);
    expect(store.draft().protections.enabled).toBe(false);
    expect(byId(host, 'admin-rhythm-protections-max')).toBeNull();
    expect(byId(host, 'admin-rhythm-protections-every')).toBeNull();
  });

  it('steps the reserve and picks the earning through the store', async () => {
    const { host, fixture, store } = await rig('protections');
    (
      host.querySelector(
        '[data-testid="admin-rhythm-protections-max"] .ui-count-stepper__step:last-child',
      ) as HTMLElement
    ).click();
    await settle(fixture, 2);
    expect(store.draft().protections.maxBanked).toBe(3);
    click(host, 'admin-rhythm-protections-every');
    await settle(fixture, 2);
    click(host, 'admin-rhythm-option-protections-every-8');
    await settle(fixture, 2);
    expect(store.draft().protections.earnEvery).toBe(8);
    click(host, 'admin-rhythm-protections-start');
    await settle(fixture, 2);
    expect(store.draft().protections.startWith).toBe(1);
  });
});

// ── Excuses ──────────────────────────────────────────────────────────────

describe('«Извинени пропуски»', () => {
  it('lists the four excuses, and warns once a shop excuse is off', async () => {
    const { host, fixture, store } = await rig('excuses');
    expect(
      host.querySelectorAll('[data-testid^="admin-rhythm-excuse-"]'),
    ).toHaveLength(4);
    expect(byId(host, 'admin-rhythm-excuses-warning')).toBeNull();
    click(host, 'admin-rhythm-excuse-staffCancelled');
    await settle(fixture, 2);
    expect(store.draft().excuses).not.toContain('staffCancelled');
    expect(
      byId(host, 'admin-rhythm-excuses-warning')?.textContent?.trim(),
    ).toBe('Клиентът ще губи ритъм по вина на салона.');
    click(host, 'admin-rhythm-excuse-staffCancelled');
    await settle(fixture, 2);
    expect(byId(host, 'admin-rhythm-excuses-warning')).toBeNull();
    // The fourth excuse is not the shop's: no warning for it.
    click(host, 'admin-rhythm-excuse-closedDays');
    await settle(fixture, 2);
    expect(store.draft().excuses).toContain('closedDays');
    expect(byId(host, 'admin-rhythm-excuses-warning')).toBeNull();
  });

  it('offers the client’s pause and its yearly limit', async () => {
    const { host, fixture, store } = await rig('excuses');
    expect(byId(host, 'admin-rhythm-pause-days')).toBeNull();
    click(host, 'admin-rhythm-pause');
    await settle(fixture, 2);
    expect(store.draft().clientPause.enabled).toBe(true);
    expect(byId(host, 'admin-rhythm-pause-days')?.textContent?.trim()).toBe(
      '90 дни',
    );
    click(host, 'admin-rhythm-pause-days');
    await settle(fixture, 2);
    click(host, 'admin-rhythm-option-pause-days-30');
    await settle(fixture, 2);
    expect(store.draft().clientPause.maxDaysPerYear).toBe(30);
  });
});

// ── After a miss ─────────────────────────────────────────────────────────

describe('«След пропуск»', () => {
  it('picks what the rhythm does, and the way back with its window and its count', async () => {
    const { host, fixture, store } = await rig('afterMiss');
    expect(byId(host, 'admin-rhythm-on-break')?.textContent?.trim()).toBe(
      'Започва отначало',
    );
    click(host, 'admin-rhythm-on-break');
    await settle(fixture, 2);
    click(host, 'admin-rhythm-option-on-break-hold');
    await settle(fixture, 2);
    expect(store.draft().onBreak).toBe('hold');
    expect(byId(host, 'admin-rhythm-repair-window')?.textContent?.trim()).toBe(
      '14 дни',
    );
    click(host, 'admin-rhythm-repair-per-year');
    await settle(fixture, 2);
    click(host, 'admin-rhythm-option-repair-per-year-3');
    await settle(fixture, 2);
    expect(store.draft().repair.perYear).toBe(3);
    click(host, 'admin-rhythm-repair');
    await settle(fixture, 2);
    expect(store.draft().repair.enabled).toBe(false);
    expect(byId(host, 'admin-rhythm-repair-window')).toBeNull();
  });
});

// ── Services ─────────────────────────────────────────────────────────────

describe('«Услуги»', () => {
  it('lists the catalogue by category, marks the chosen, and keeps the last one chosen', async () => {
    const { host, fixture, store } = await rig('services');
    expect(byId(host, 'admin-rhythm-services-query')).not.toBeNull();
    expect(
      host.querySelectorAll('.admin-rhythm-sheet__group-title'),
    ).toHaveLength(2);
    expect(
      host.querySelectorAll('[data-testid^="admin-rhythm-service-"]'),
    ).toHaveLength(3);
    click(host, 'admin-rhythm-service-fade');
    await settle(fixture, 2);
    expect(store.draft().qualifier).toEqual({
      kind: 'services',
      serviceIds: ['fade'],
    });
    expect(
      byId(host, 'admin-rhythm-service-fade')?.getAttribute('aria-pressed'),
    ).toBe('true');
    click(host, 'admin-rhythm-service-beard');
    await settle(fixture, 2);
    expect(store.draft().qualifier).toEqual({
      kind: 'services',
      serviceIds: ['fade', 'beard'],
    });
    click(host, 'admin-rhythm-service-fade');
    await settle(fixture, 2);
    expect(store.draft().qualifier).toEqual({
      kind: 'services',
      serviceIds: ['beard'],
    });
    // The last one chosen stays.
    click(host, 'admin-rhythm-service-beard');
    await settle(fixture, 2);
    expect(store.draft().qualifier).toEqual({
      kind: 'services',
      serviceIds: ['beard'],
    });
  });

  it('filters by the search', async () => {
    const { host, fixture } = await rig('services');
    const query = host.querySelector(
      '[data-testid="admin-rhythm-services-query"]',
    ) as HTMLInputElement;
    query.value = 'брад';
    query.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture, 2);
    expect(
      host.querySelectorAll('[data-testid^="admin-rhythm-service-"]'),
    ).toHaveLength(1);
    expect(
      host.querySelectorAll('.admin-rhythm-sheet__group-title'),
    ).toHaveLength(1);
  });

  it('says when the catalogue is not there', async () => {
    const { host } = await rig(
      'services',
      null as unknown as readonly RhythmServiceGroup[],
    );
    expect(byId(host, 'admin-rhythm-services-unavailable')).not.toBeNull();
  });
});

// ── The rows ─────────────────────────────────────────────────────────────

describe('the sheets’ rows', () => {
  it('lets every label beside a fixed control (a switch, a stepper) wrap instead of truncating', async () => {
    const cases = [
      ['protections', 3],
      ['excuses', 5],
      ['afterMiss', 1],
    ] as const;
    for (const [kind, count] of cases) {
      const { host, fixture } = await rig(kind);
      if (kind === 'excuses') {
        click(host, 'admin-rhythm-pause');
        await settle(fixture, 2);
      }
      const controls = host.querySelectorAll(
        'button[uiswitch], .ui-count-stepper',
      );
      expect(controls, kind).toHaveLength(count);
      for (const control of controls) {
        const row = control.closest('.ui-list-row');
        expect(row?.hasAttribute('data-label-wraps'), kind).toBe(true);
        expect(
          row?.querySelector('.ui-list-row__label')?.textContent?.trim(),
          kind,
        ).toBeTruthy();
      }
      TestBed.resetTestingModule();
    }
  });

  it('prints the whole of «Първа защита с първото посещение»', async () => {
    const { host } = await rig('protections');
    const row = byId(host, 'admin-rhythm-protections-start')?.closest(
      '.ui-list-row',
    );
    expect(row?.querySelector('.ui-list-row__label')?.textContent?.trim()).toBe(
      'Първа защита с първото посещение',
    );
    expect(row?.hasAttribute('data-label-wraps')).toBe(true);
  });
});

// ── The day ──────────────────────────────────────────────────────────────

describe('«Влизане в сила»', () => {
  it('shows the month picker from the earliest day, no dock; a tap chooses and closes', async () => {
    const { host, fixture, store } = await rig('day');
    expect(byId(host, 'admin-rhythm-sheet-done')).toBeNull();
    expect(byId(host, 'admin-rhythm-day-picker')).not.toBeNull();
    // A change starts tomorrow at the earliest: today cannot be picked.
    store.patch({ graceDays: 10 });
    await settle(fixture, 2);
    expect(
      (byId(host, 'ui-month-day-2026-09-28') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (byId(host, 'ui-month-day-2026-09-29') as HTMLButtonElement).disabled,
    ).toBe(false);
    click(host, 'ui-month-day-2026-09-30');
    await settle(fixture, 2);
    expect(store.effectiveFrom()).toBe('2026-09-30');
    expect(sheetOpen(host)).toBe('closing');
  });
});
