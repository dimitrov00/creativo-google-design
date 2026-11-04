import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTransloco } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { BookingContact, SearchQuery } from '@core/components';
import type { Appointment } from '@core/entities';
import { BarberId, LocalDate, ServiceId } from '@core/primitives';
import {
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  appointmentFixture,
  minute,
  seatFixture,
} from '@core/testing';
import type { VisitLookup } from '@creativo/features/shared/visits';
import { UiModalSheet } from '@creativo/ui/controls';
import { StaffDayStore } from '../staff-day.store';
import { SEARCH_RECENTS_KEY, loadRecents } from '../staff-search-recents';
import { StaffSearchSheet } from './staff-search-sheet';

const IVAN = BarberId.of('b-ivan');
const NIKO = BarberId.of('b-niko');
const FADE = ServiceId.of('svc-fade');
const CUT = ServiceId.of('svc-classic-cut');

const LOOKUP: VisitLookup = {
  serviceName: (id) =>
    id === FADE ? 'Фейд' : id === CUT ? 'Класическо' : null,
  barberName: (id) => (id === IVAN ? 'Иван' : id === NIKO ? 'Нико' : null),
  barberAvatarSrc: () => null,
  locationName: () => null,
  locationCount: 1,
};

function visit(
  id: string,
  name: string,
  barber = IVAN,
  service = CUT,
): Appointment {
  return appointmentFixture({
    ...BookingContact.NONE,
    id: id as Appointment['id'],
    localDate: LocalDate.addDays(FIXTURE_TODAY, 1),
    startMinutes: minute(600),
    barberIds: [barber],
    seats: [seatFixture({ barberId: barber, serviceId: service })],
    contactName: name,
  });
}

const POOL = [
  visit('a', 'Иван Петров'),
  visit('b', 'Иван Георгиев', NIKO, FADE),
  visit('c', 'Мартин Илиев', NIKO, FADE),
];

/** Just what the sheet reads of the store — signals and two calls. */
function fakeStore() {
  return {
    pool: signal<readonly Appointment[]>(POOL),
    searchCapped: signal(false),
    searchStale: signal(false),
    searchLoading: signal(false),
    shopNow: signal(FIXTURE_NOW),
    zone: signal(FIXTURE_TIME_ZONE),
    nowUtcMs: signal(FIXTURE_NOW_UTC_MS),
    shopNowAt: signal(() => FIXTURE_NOW),
    goToDay: vi.fn(),
    closeSearch: vi.fn(),
  };
}

@Component({
  imports: [StaffSearchSheet],
  template: `<lib-staff-search-sheet
    [catalog]="catalog"
    [unnamedClient]="'Клиент без име'"
    [callingCode]="'359'"
    [locale]="'bg-BG'"
  />`,
})
class Host {
  readonly catalog = LOOKUP;
}

describe('StaffSearchSheet', () => {
  let fixture: ComponentFixture<Host>;
  let store: ReturnType<typeof fakeStore>;
  const el = <T extends Element>(selector: string) =>
    fixture.nativeElement.querySelector(selector) as T | null;
  const all = (selector: string) =>
    Array.from(
      fixture.nativeElement.querySelectorAll(selector),
    ) as HTMLElement[];

  async function mount(): Promise<void> {
    store = fakeStore();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideTransloco({
          config: {
            availableLangs: ['bg'],
            defaultLang: 'bg',
            missingHandler: { logMissingKey: false },
          },
          loader: class {
            getTranslation() {
              return of({});
            }
          },
        }),
        { provide: StaffDayStore, useValue: store },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const type = (text: string) => {
    const input = el<HTMLInputElement>(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const after = (ms: number) => {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  };
  const cards = () => all('lib-staff-search-sheet lib-visit-row');

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('opens idle: the filters on offer, no cards, the field pinned and named', async () => {
    await mount();
    expect(cards()).toHaveLength(0);
    expect(
      all('[data-testid="staff-search-suggestion"]').length,
    ).toBeGreaterThan(0);
    expect(el('ui-search-field[data-pinned]')).not.toBeNull();
    expect(el('[data-testid="staff-search-recents"]')).toBeNull();
  });

  it('scans the window only after the 80 ms typing pause', async () => {
    await mount();
    type('иван');
    after(79);
    expect(cards()).toHaveLength(0);
    after(2);
    expect(cards()).toHaveLength(2);
  });

  it('adds a chip when a suggestion is pressed, narrows the cards, and takes it off when the chip is pressed', async () => {
    await mount();
    type('иван');
    after(100);
    const niko = el<HTMLButtonElement>(
      '[data-suggestion="BARBER:b-niko"]',
    ) as HTMLButtonElement;
    niko.click();
    fixture.detectChanges();
    expect(cards()).toHaveLength(1);
    const chip = el<HTMLButtonElement>(
      '.ui-search-field__token',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain('Нико');
    // A chosen value is no longer on offer.
    expect(el('[data-suggestion="BARBER:b-niko"]')).toBeNull();
    chip.click();
    fixture.detectChanges();
    expect(cards()).toHaveLength(2);
    expect(el('.ui-search-field__token')).toBeNull();
  });

  it('takes the last chip off on Backspace in an empty field', async () => {
    await mount();
    el<HTMLButtonElement>('[data-suggestion="BARBER:b-niko"]')?.click();
    fixture.detectChanges();
    expect(all('.ui-search-field__token')).toHaveLength(1);
    const input = el<HTMLInputElement>(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
    );
    fixture.detectChanges();
    expect(all('.ui-search-field__token')).toHaveLength(0);
  });

  it('keeps the search as a recent when a card is opened, jumps to its day and closes', async () => {
    await mount();
    type('иван');
    after(100);
    (cards()[0]?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(store.goToDay).toHaveBeenCalledWith(
      LocalDate.addDays(FIXTURE_TODAY, 1),
    );
    expect(store.closeSearch).toHaveBeenCalled();
    expect(loadRecents(localStorage).map((q) => q.searchText)).toEqual([
      'иван',
    ]);
  });

  it('keeps the search as a recent on Return, once however often it is pressed', async () => {
    await mount();
    type('мартин');
    after(100);
    const input = el<HTMLInputElement>(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(loadRecents(localStorage)).toHaveLength(1);
  });

  it('shows the device’s recents when idle, runs one again, and clears them', async () => {
    localStorage.setItem(
      SEARCH_RECENTS_KEY,
      JSON.stringify([SearchQuery.withText(SearchQuery.empty(), 'мартин')]),
    );
    await mount();
    const recent = el<HTMLButtonElement>(
      '[data-testid="staff-search-recent"]',
    ) as HTMLButtonElement;
    expect(recent.textContent).toContain('мартин');
    recent.click();
    fixture.detectChanges();
    expect(cards()).toHaveLength(1);
    expect(
      el<HTMLInputElement>('[data-testid="staff-search-input"]')?.value,
    ).toBe('мартин');
  });

  it('forgets the recents when cleared', async () => {
    localStorage.setItem(
      SEARCH_RECENTS_KEY,
      JSON.stringify([SearchQuery.withText(SearchQuery.empty(), 'мартин')]),
    );
    await mount();
    el<HTMLButtonElement>(
      '[data-testid="staff-search-clear-recents"]',
    )?.click();
    fixture.detectChanges();
    expect(el('[data-testid="staff-search-recents"]')).toBeNull();
    expect(loadRecents(localStorage)).toEqual([]);
  });

  it('rebuilds the cards when the window is replaced, and says when it is capped', async () => {
    await mount();
    type('иван');
    after(100);
    expect(cards()).toHaveLength(2);
    store.pool.set([visit('d', 'Иван Нов')]);
    store.searchCapped.set(true);
    fixture.detectChanges();
    expect(cards()).toHaveLength(1);
    expect(el('[data-testid="staff-search-footnote"]')?.textContent).toContain(
      'staff.day.searchTruncated',
    );
  });

  it('closes the search when the sheet is dismissed', async () => {
    await mount();
    expect(store.closeSearch).not.toHaveBeenCalled();
    fixture.debugElement
      .query(By.directive(UiModalSheet))
      .triggerEventHandler('dismissed');
    expect(store.closeSearch).toHaveBeenCalledTimes(1);
  });
});
