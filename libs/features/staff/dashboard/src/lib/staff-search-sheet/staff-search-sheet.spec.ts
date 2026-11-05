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

  it('opens idle and full screen: no cards, the field in the page’s own bar, the starters above it', async () => {
    await mount();
    expect(cards()).toHaveLength(0);
    // The page's bottom bar holds the field (its fade, its floor, the
    // keyboard) at the bar's rung; the field draws no band of its own.
    expect(
      el(
        'ui-page-action-bar[data-avoids-keyboard] > ui-search-field[data-control-size="large"]',
      ),
    ).not.toBeNull();
    expect(el('ui-search-field[data-pinned]')).toBeNull();
    expect(el('ui-sheet[data-full-screen]')).not.toBeNull();
    expect(el('[data-testid="staff-search-recents"]')).toBeNull();
    // Mail's «Suggestions» before anything is typed — tomorrow, the barbers —
    // under their keys.
    expect(
      all('[data-suggest-mode] .staff-search-sheet__heading').map((h) =>
        h.textContent?.trim(),
      ),
    ).toEqual(['staff.search.key.when', 'staff.search.key.barber']);
    expect(
      all('[data-suggest-mode] [data-testid="staff-search-suggestion"]').map(
        (row) => row.getAttribute('data-suggestion'),
      ),
    ).toEqual([
      `WHEN:${LocalDate.addDays(FIXTURE_TODAY, 1)}..${LocalDate.addDays(FIXTURE_TODAY, 1)}`,
      'BARBER:b-ivan',
      'BARBER:b-niko',
    ]);
    // The field's capsule shares the bar entry's view-transition name.
    expect(
      el<HTMLElement>('.ui-search-field__frame')?.style.viewTransitionName,
    ).toBe('staff-search-field');
  });

  it('adds a starter as a filter, and the starters leave', async () => {
    await mount();
    press('[data-suggestion="BARBER:b-niko"]');
    expect(chipIds()).toEqual(['BARBER']);
    expect(chip('BARBER')?.textContent).toContain('Нико');
    expect(cards()).toHaveLength(2);
    expect(el('[data-suggest-mode]')).toBeNull();
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
  /** A chosen filter's chip over the field (or a key being picked). */
  const chip = (id: string) =>
    el<HTMLButtonElement>(
      `[data-testid="staff-search-filter"][data-filter="${id}"]`,
    );
  const chipIds = () =>
    all('[data-testid="staff-search-filter"]').map((c) =>
      c.getAttribute('data-filter'),
    );

  it('opens on the caret, the ✕ beside the field and the keys in a card over it', async () => {
    await mount();
    expect(document.activeElement).toBe(field());
    expect(
      field()
        .closest('ui-search-field')
        ?.getAttribute('data-dropdown-placement'),
    ).toBe('above');
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

  /** «Приложи» in the bar: the set being picked is applied. */
  const applySet = () => press('[data-testid="staff-search-apply"]');

  it('picks a key, ticks a value, applies: the key stands as a chip until «Приложи» replaces its word', async () => {
    await mount();
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
    expect(chip('BARBER')?.getAttribute('aria-expanded')).toBe('true');
    expect(chip('BARBER')?.textContent).toContain('staff.search.key.barber');
    // The free keys leave while a key is open; the placeholder names it.
    expect(
      el('[data-testid="staff-search-keys"] [data-suggestion]'),
    ).toBeNull();
    expect(field().placeholder).toContain('staff.search.scopedPlaceholder');
    // A tick is not yet a filter: the values stay, «Приложи» counts the set
    // and stands where the ✕ was.
    press('[data-suggestion="BARBER:b-niko"]');
    expect(
      el('[data-suggestion="BARBER:b-niko"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(chip('BARBER')?.textContent).toContain('staff.search.key.barber');
    expect(el('[data-testid="staff-search-apply"]')?.textContent).toContain(
      'staff.search.applyCount',
    );
    expect(el('[data-testid="staff-search-input-dismiss"]')).toBeNull();
    applySet();
    expect(chip('BARBER')?.textContent).toContain('Нико');
    expect(chip('BARBER')?.getAttribute('aria-expanded')).toBe('false');
    expect(chip('BARBER')?.getAttribute('data-selected')).toBe('');
    expect(el('[data-testid="staff-search-apply"]')).toBeNull();
    expect(el('[data-testid="staff-search-input-dismiss"]')).not.toBeNull();
    expect(cards()).toHaveLength(2);
    // No token in the field any more: the filters float over it.
    expect(all('.ui-search-field__token')).toHaveLength(0);
  });

  it('lays «Услуга» out as cover cards, «Махни филтъра» after the last of them', async () => {
    await mount();
    press(
      '[data-testid="staff-search-keys"] [data-suggestion="FIELD:SERVICE"]',
    );
    press('cr-service-card[data-suggestion="SERVICE:svc-fade"] button');
    applySet();
    press('[data-testid="staff-search-filter"][data-filter="SERVICE"]');
    const grid = el('[data-testid="staff-search-service-grid"]') as HTMLElement;
    const remove = el('[data-suggestion="REMOVE:SERVICE"]') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(remove).not.toBeNull();
    // The removal comes LAST, after the cards, as on every other key.
    expect(
      grid.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lets a set that was not applied go on Escape', async () => {
    await mount();
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    );
    fixture.detectChanges();
    expect(chip('BARBER')).toBeNull();
    expect(el('[data-testid="staff-search-apply"]')).toBeNull();
  });

  it('parks the typed search while a pressed filter’s values are open, and brings it back', async () => {
    await mount();
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    type('иван');
    after(100);
    expect(cards()).toHaveLength(1);

    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    // The text now narrows the values, which are the page meanwhile.
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(0);
    expect(el('[data-suggestion="BARBER:b-niko"]')).not.toBeNull();

    press('[data-suggestion="BARBER:b-ivan"]');
    applySet();
    expect(field().value).toBe('иван');
    expect(cards()).toHaveLength(2);
  });

  it('keeps the chips in the order their filters were added', async () => {
    await mount();
    // Barber, then When — the reverse of the order the keys are listed in.
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    press('[data-suggestion="FIELD:WHEN"]');
    // «Кога» holds one span: a tap applies it.
    press('[data-suggestion^="WHEN:"]');
    expect(chipIds()).toEqual(['BARBER', 'WHEN']);
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
    expect(chip('BARBER')?.getAttribute('aria-expanded')).toBe('true');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(2);
  });

  it('opens a pressed filter on its held set: ticks to change it, «Приложи» to apply, «Махни филтъра» last', async () => {
    await mount();
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    expect(chip('BARBER')?.getAttribute('aria-expanded')).toBe('true');
    expect(
      el('[data-suggestion="BARBER:b-niko"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      el('[data-suggestion="BARBER:b-ivan"]')?.getAttribute('aria-pressed'),
    ).toBe('false');

    // A second tick joins the set; the values stay until it is applied, and
    // then the chip says both with a group of faces.
    press('[data-suggestion="BARBER:b-ivan"]');
    expect(el('[data-suggestion="REMOVE:BARBER"]')).not.toBeNull();
    expect(chip('BARBER')?.textContent).not.toContain('Иван');
    applySet();
    expect(chip('BARBER')?.textContent).toContain('Нико, Иван');
    expect(
      chip('BARBER')?.querySelectorAll('ui-avatar-group ui-avatar'),
    ).toHaveLength(2);

    // A tick taken off, applied: one barber again.
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    press('[data-suggestion="BARBER:b-ivan"]');
    applySet();
    expect(chip('BARBER')?.textContent).not.toContain('Иван');
    expect(chip('BARBER')?.querySelector('ui-avatar-group')).toBeNull();

    // Every tick off, applied: the filter goes.
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    expect(chip('BARBER')).toBeNull();

    press('[data-suggestion="FIELD:BARBER"]');
    press('[data-suggestion="BARBER:b-niko"]');
    applySet();
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    press('[data-suggestion="REMOVE:BARBER"]');
    expect(chip('BARBER')).toBeNull();
    expect(el('[data-suggestion="FIELD:BARBER"]')).not.toBeNull();
  });

  it('closes a pressed filter’s values on a second press', async () => {
    await mount();
    press('[data-suggestion="BARBER:b-niko"]');
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    expect(el('[data-suggestion="REMOVE:BARBER"]')).not.toBeNull();
    press('[data-testid="staff-search-filter"][data-filter="BARBER"]');
    expect(el('[data-suggestion="REMOVE:BARBER"]')).toBeNull();
    expect(cards()).toHaveLength(2);
  });

  it('adds a value the typed text names, taking the text with it', async () => {
    await mount();
    type('ни');
    after(100);
    press('[data-suggestion="BARBER:b-niko"]');
    expect(chip('BARBER')?.textContent).toContain('Нико');
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(2);
  });

  it('shows the card of keys only while the field has the focus', async () => {
    await mount();
    const card = () => el('.ui-search-field__dropdown');
    expect(card()).not.toBeNull();
    field().blur();
    fixture.detectChanges();
    expect(card()).toBeNull();
    field().focus();
    fixture.detectChanges();
    expect(card()).not.toBeNull();
  });

  it('keeps Escape while a key is open, closing the key, then the card, and lets it reach the sheet after', async () => {
    await mount();
    press('[data-testid="staff-search-keys"] [data-suggestion="FIELD:BARBER"]');
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
    expect(chip('BARBER')).toBeNull();
    expect(el('[data-testid="staff-search-keys"]')).not.toBeNull();
    expect(store.closeSearch).not.toHaveBeenCalled();
    // The card is the next thing Escape puts away…
    escape();
    expect(el('.ui-search-field__dropdown')).toBeNull();
    expect(store.closeSearch).not.toHaveBeenCalled();
    // …and with nothing open it is the sheet's, which ends the search.
    escape();
    expect(store.closeSearch).toHaveBeenCalled();
  });

  it('keeps the search as a recent when a card is opened, moves the schedule to its day and asks for its sheet, staying open', async () => {
    await mount();
    const picked: string[] = [];
    fixture.debugElement
      .query(By.directive(StaffSearchSheet))
      .componentInstance.visitPicked.subscribe((id: string) => picked.push(id));
    type('иван');
    after(100);
    (cards()[0]?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(store.goToDay).toHaveBeenCalledWith(
      LocalDate.addDays(FIXTURE_TODAY, 1),
    );
    expect(picked).toEqual(['a']);
    // The visit's sheet opens OVER the search; closing it comes back here.
    expect(store.closeSearch).not.toHaveBeenCalled();
    expect(loadRecents(localStorage).map((q) => q.searchText)).toEqual([
      'иван',
    ]);
  });

  it('takes the typed text as a chip on the ✓, and on Return, freeing the field', async () => {
    await mount();
    type('иван');
    after(100);
    expect(
      el('[data-testid="staff-search-commit-row"]')?.textContent,
    ).toContain('staff.search.commitText');
    press('button[data-testid="staff-search-commit"]');
    expect(
      all('[data-testid="staff-search-text"]').map((c) =>
        c.textContent?.trim(),
      ),
    ).toEqual(['иван']);
    expect(field().value).toBe('');
    expect(cards()).toHaveLength(2);

    // The next word narrows on top of the chip; Return takes it too.
    type('петров');
    after(100);
    expect(cards()).toHaveLength(1);
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(all('[data-testid="staff-search-text"]')).toHaveLength(2);
    expect(cards()).toHaveLength(1);
    expect(el('button[data-testid="staff-search-commit"]')).toBeNull();
  });

  it('puts a taken text back in the field when its chip is pressed', async () => {
    await mount();
    type('иван');
    after(100);
    press('button[data-testid="staff-search-commit"]');
    press('[data-testid="staff-search-text"]');
    expect(all('[data-testid="staff-search-text"]')).toHaveLength(0);
    expect(field().value).toBe('иван');
    expect(cards()).toHaveLength(2);
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
