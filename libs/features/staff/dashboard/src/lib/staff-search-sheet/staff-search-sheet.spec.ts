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
    // The frame the sheet focuses its surface in, and the field's after it.
    vi.advanceTimersByTime(40);
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

  it('opens idle: no cards, the field pinned and named', async () => {
    await mount();
    expect(cards()).toHaveLength(0);
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

  const press = (selector: string) => {
    (el<HTMLButtonElement>(selector) as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const field = () =>
    el<HTMLInputElement>(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
  const token = (id: string) =>
    el<HTMLButtonElement>(`[data-testid="staff-search-input-token-${id}"]`);

  it('opens on the caret, the field on the floor with the ✕ beside it and the keys over it', async () => {
    await mount();
    expect(document.activeElement).toBe(field());
    expect(
      field().closest('ui-search-field')?.getAttribute('data-pin-edge'),
    ).toBe('bottom');
    expect(el('[data-testid="staff-search-input-dismiss"]')).not.toBeNull();
    expect(
      all(
        '[data-testid="staff-search-keys"] [data-testid="staff-search-suggestion"]',
      ).map((row) => row.getAttribute('data-suggestion')),
    ).toEqual(['FIELD:WHEN', 'FIELD:BARBER', 'FIELD:SERVICE', 'FIELD:STATUS']);
  });

  it('ends the search on the ✕ beside the field', async () => {
    await mount();
    press('[data-testid="staff-search-input-dismiss"]');
    expect(store.closeSearch).toHaveBeenCalled();
  });

  it('builds a key │ value token from the suggestions', async () => {
    await mount();
    press('[data-suggestion="FIELD:BARBER"]');
    expect(token('BARBER')?.hasAttribute('data-building')).toBe(true);
    press('[data-suggestion="BARBER:b-niko"]');
    expect(token('BARBER')?.textContent).toContain('Нико');
    expect(token('BARBER')?.hasAttribute('data-building')).toBe(false);
    expect(cards()).toHaveLength(2);
  });

  it('parks the typed search while a pressed token’s values are open, and brings it back', async () => {
    await mount();
    press('[data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    type('иван');
    after(100);
    expect(cards()).toHaveLength(1);

    press('[data-testid="staff-search-input-token-BARBER"]');
    // The text now narrows the values, which are the page meanwhile.
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(0);
    expect(el('[data-suggestion="BARBER:b-niko"]')).not.toBeNull();

    press('[data-suggestion="BARBER:b-ivan"]');
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    );
    fixture.detectChanges();
    expect(field().value).toBe('иван');
    expect(cards()).toHaveLength(2);
  });

  it('draws a token being built as both segments, its value saying «избери…»', async () => {
    await mount();
    press('[data-suggestion="FIELD:SERVICE"]');
    expect(
      token('SERVICE')?.querySelector('.ui-search-field__token-value')
        ?.textContent,
    ).toContain('staff.search.tokenPlaceholder');
    expect(field().placeholder).toBe('');
  });

  it('keeps the tokens in the order they were added', async () => {
    await mount();
    // Barber, then When — the reverse of the order the keys are listed in.
    press('[data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    press('[data-suggestion="FIELD:WHEN"]');
    press('[data-suggestion^="WHEN:"]');
    expect(
      all('.ui-search-field__token').map((t) => t.getAttribute('data-testid')),
    ).toEqual([
      'staff-search-input-token-BARBER',
      'staff-search-input-token-WHEN',
    ]);
  });

  it('lets the keys the typed text does not name leave the list, and opens a named key without the text', async () => {
    await mount();
    type('ни');
    after(100);
    expect(el('[data-suggestion^="FIELD:"]')).toBeNull();
    // Untranslated here, a key reads as its catalogue path.
    type('staff.search.key.barber');
    after(100);
    expect(
      all('[data-testid="staff-search-suggestion"]').map((row) =>
        row.getAttribute('data-suggestion'),
      ),
    ).toEqual(['FIELD:BARBER']);
    press('[data-suggestion="FIELD:BARBER"]');
    expect(token('BARBER')?.hasAttribute('data-building')).toBe(true);
    press('[data-suggestion="BARBER:b-niko"]');
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(2);
  });

  it('opens a pressed token on its values: ✓ on the held one, a toggle, and «Махни филтъра» last', async () => {
    await mount();
    press('[data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    press('[data-testid="staff-search-input-token-BARBER"]');
    expect(token('BARBER')?.hasAttribute('data-active')).toBe(true);
    expect(
      el('[data-suggestion="BARBER:b-niko"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      el('[data-suggestion="BARBER:b-ivan"]')?.getAttribute('aria-pressed'),
    ).toBe('false');

    // A toggle keeps the values open.
    press('[data-suggestion="BARBER:b-ivan"]');
    expect(token('BARBER')?.textContent).toContain('Нико, Иван');
    expect(el('[data-suggestion="REMOVE:BARBER"]')).not.toBeNull();

    press('[data-suggestion="REMOVE:BARBER"]');
    expect(token('BARBER')).toBeNull();
    expect(el('[data-suggestion="FIELD:BARBER"]')).not.toBeNull();
  });

  it('adds a value the typed text names, taking the text with it', async () => {
    await mount();
    type('ни');
    after(100);
    press('[data-suggestion="BARBER:b-niko"]');
    expect(token('BARBER')?.textContent).toContain('Нико');
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(2);
  });

  it('takes the token being built, then the last token, off on Backspace in an empty field', async () => {
    await mount();
    press('[data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    press('[data-suggestion="FIELD:SERVICE"]');
    expect(all('.ui-search-field__token')).toHaveLength(2);
    const backspace = () => {
      field().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
      );
      fixture.detectChanges();
    };
    backspace();
    expect(all('.ui-search-field__token')).toHaveLength(1);
    expect(token('BARBER')).not.toBeNull();
    backspace();
    expect(all('.ui-search-field__token')).toHaveLength(0);
  });

  it('keeps Escape while a key is open, closing the key, and lets it reach the sheet after', async () => {
    await mount();
    press('[data-suggestion="FIELD:BARBER"]');
    const escape = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      field().dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    escape();
    expect(token('BARBER')).toBeNull();
    expect(el('[data-testid="staff-search-keys"]')).not.toBeNull();
    expect(store.closeSearch).not.toHaveBeenCalled();
    // Nothing open: Escape is the sheet's, which ends the search.
    escape();
    expect(store.closeSearch).toHaveBeenCalled();
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
