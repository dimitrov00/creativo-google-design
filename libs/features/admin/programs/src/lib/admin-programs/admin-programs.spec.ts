import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  COURSE_REPOSITORY,
  CourseRepository,
  POSITION_REPOSITORY,
  Position,
  PositionRepository,
  Result,
  SHOP_EVENT_REPOSITORY,
  ShopEventRepository,
  ok,
} from '@creativo/application/programs';
import { ID_GENERATOR } from '@creativo/application/shared';
import { AdminPrograms } from './admin-programs';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in fixture');
  return result.value;
}

function fillInput(host: HTMLElement, testId: string, value: string): void {
  const el = host.querySelector(`[data-testid="${testId}"]`) as
    HTMLInputElement | HTMLTextAreaElement;
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function position(id: string, status: 'open' | 'closed' = 'open'): Position {
  return unwrap(
    Position.create({
      id,
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: { en: 'Full-time chair', bg: 'Пълен работен ден' },
      locationIds: [],
      status,
      sortOrder: 0,
    }),
  );
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

function positionRepositoryStub(
  seed: readonly Position[],
): PositionRepository & { saved: Position[] } {
  const saved: Position[] = [];
  return {
    saved,
    findById: async () => ok(seed[0] ?? null),
    save: async (p) => {
      saved.push(p);
      return ok(undefined);
    },
    observeOpen: () => of(ok(seed.filter((p) => p.status === 'open'))),
    observeAll: () => of(ok(seed)),
  };
}

function emptyCourseRepository(): CourseRepository {
  return {
    findById: async () => ok(null),
    save: async () => ok(undefined),
    observeOpenAndUpcoming: () => of(ok([])),
    observeAll: () => of(ok([])),
  };
}

function emptyEventRepository(): ShopEventRepository {
  return {
    findById: async () => ok(null),
    save: async () => ok(undefined),
    observeUpcoming: () => of(ok([])),
    observePast: () => of(ok([])),
  };
}

async function configure(seed: readonly Position[] = []): Promise<{
  fixture: ComponentFixture<AdminPrograms>;
  positionRepo: PositionRepository & { saved: Position[] };
}> {
  const positionRepo = positionRepositoryStub(seed);
  await TestBed.configureTestingModule({
    imports: [AdminPrograms],
    providers: [
      ...provideTestI18n(),
      { provide: POSITION_REPOSITORY, useValue: positionRepo },
      { provide: COURSE_REPOSITORY, useValue: emptyCourseRepository() },
      { provide: SHOP_EVENT_REPOSITORY, useValue: emptyEventRepository() },
      { provide: ID_GENERATOR, useValue: { next: () => 'generated-id' } },
    ],
  }).compileComponents();

  return { fixture: TestBed.createComponent(AdminPrograms), positionRepo };
}

describe('AdminPrograms', () => {
  it('lists positions on the default tab', async () => {
    const { fixture } = await configure([position('pos_1'), position('pos_2')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="admin-positions-list"]');
    expect(list?.querySelectorAll('button[uilistrow]').length).toBe(2);
  });

  it('opens a blank create form and saves a new position', async () => {
    const { fixture, positionRepo } = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector('[data-testid="admin-new"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();

    fillInput(host, 'admin-position-title-en', 'Barber');
    fillInput(host, 'admin-position-title-bg', 'Бръснар');
    fillInput(host, 'admin-position-summary-en', 'Full-time chair');
    fillInput(host, 'admin-position-summary-bg', 'Пълен работен ден');
    fixture.detectChanges();

    (
      host.querySelector('[data-testid="admin-save"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(positionRepo.saved).toHaveLength(1);
    expect(positionRepo.saved[0]?.title.en).toBe('Barber');
    expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
  });

  it('shows an error and keeps the form open when the save fails validation', async () => {
    const { fixture, positionRepo } = await configure([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector('[data-testid="admin-new"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // Blank title — Position.create rejects it.
    (
      host.querySelector('[data-testid="admin-save"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(positionRepo.saved).toHaveLength(0);
    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="admin-save-error"]'),
    ).not.toBeNull();
  });

  it('opens an edit form pre-filled from the clicked row', async () => {
    const { fixture } = await configure([position('pos_1', 'closed')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="admin-positions-list"] button[uilistrow]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const closedChip = Array.from(
      host.querySelectorAll('[data-testid="admin-form"] button[uichip]'),
    ).find((el) => el.textContent?.trim() === 'Closed');
    expect(closedChip?.getAttribute('data-selected')).toBe('');
  });

  it('switches tabs and clears any open form', async () => {
    const { fixture } = await configure([position('pos_1')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector('[data-testid="admin-new"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="admin-form"]')).not.toBeNull();

    (
      host.querySelector(
        '[data-testid="admin-tab-courses"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="admin-form"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="admin-courses-list"]'),
    ).not.toBeNull();
  });
});
