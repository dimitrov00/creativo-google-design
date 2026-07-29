import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../../test-i18n.providers';
import { LocationsComponent } from './locations.component';

describe('LocationsComponent', () => {
  it('renders every location as an explorable card and opens its detail sheet', async () => {
    await TestBed.configureTestingModule({
      imports: [LocationsComponent],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(LocationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.location-card').length).toBe(2);
    expect(
      host.querySelectorAll(
        '.location-card[role="button"][aria-haspopup="dialog"]',
      ).length,
    ).toBe(2);
    // Maps place-card register: a trailing circular action cluster — the
    // quiet call button + the tinted directions button per card.
    expect(
      host.querySelectorAll(
        '.location-card a.ui-button[href^="tel:"][data-icon-only]',
      ).length,
    ).toBe(2);
    expect(host.querySelectorAll('.location-card__maps').length).toBe(2);
    // Open/closed lines ride the shared ui-status-indicator pattern.
    expect(
      host.querySelectorAll('.location-card ui-status-indicator').length,
    ).toBe(2);
    // Icons are named by INTENT (semantic registry keys), and the registry
    // resolves the directions intent to its Material Symbols glyph.
    expect(
      host.querySelector('.location-card__maps .ui-icon__glyph')?.textContent,
    ).toBe('near_me');
    expect(host.querySelector('[data-locations-map]')).not.toBeNull();
    expect(host.querySelector('.location-card__media')).toBeNull();

    const sheet = host.querySelector<HTMLElement>(
      '#location-detail-sheet.ui-sheet[role="dialog"]',
    );
    expect(sheet).not.toBeNull();
    expect(sheet?.hasAttribute('data-presented')).toBe(false);

    const firstCard = host.querySelector<HTMLElement>('.location-card');
    firstCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(sheet?.hasAttribute('data-presented')).toBe(true);
    expect(host.querySelector('[data-location-sheet-map]')).not.toBeNull();
    // Opening hours: the status is the segmented run's LABEL — chrome
    // above the group, neither a container around it nor an eighth day
    // segment. Today = uiSelected.
    const hours = host.querySelector('.location-sheet__hours');
    expect(hours?.tagName).toBe('UI-STACK');
    expect(
      hours?.querySelector(
        ':scope > ui-status-indicator.location-sheet__hours-label',
      ),
    ).not.toBeNull();
    const week = hours?.querySelector('ul.ui-list-group.location-sheet__week');
    expect(week?.querySelectorAll(':scope > li.ui-list-row').length).toBe(7);
    expect(
      host.querySelector('.location-sheet__week li.ui-list-row[data-selected]'),
    ).not.toBeNull();

    // The sheet's ONE action row is the bottom ui-sheet-action-bar —
    // visible for the sheet's whole open lifetime (no scroll-triggered
    // reveal), with no duplicate CTA cluster in the intro. Every bar
    // control shares the large 52px tier (no mixed sizes within one
    // group), and the book CTA carries the full venue context on its
    // aria-label while showing the short register.
    expect(host.querySelector('.location-sheet__hero-actions')).toBeNull();
    const toolbar = host.querySelector<HTMLElement>(
      'ui-sheet-action-bar.location-sheet__toolbar',
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar?.hasAttribute('data-visible')).toBe(true);
    const toolbarActions = toolbar?.querySelectorAll<HTMLElement>('.ui-button');
    expect(toolbarActions?.length).toBe(3);
    toolbarActions?.forEach((button) => {
      expect(button.getAttribute('data-control-size')).toBe('large');
      expect(button.getAttribute('tabindex')).toBeNull();
    });
    expect(
      toolbar
        ?.querySelector('.location-sheet__toolbar-book')
        ?.getAttribute('aria-label'),
    ).toBeTruthy();

    // No card surface and no hairline around the hours: the stack gap
    // separates the label from the run, and between days the seam IS the
    // separator. "Today" is conveyed to AT via SR-only text instead of a
    // redundant visual tag on the already-emphasized row.
    expect(hours?.querySelector('ui-card')).toBeNull();
    expect(hours?.querySelector('ui-divider')).toBeNull();
    expect(host.querySelector('.location-sheet__today-tag')).toBeNull();
    expect(
      host.querySelector(
        '.location-sheet__week li.ui-list-row[data-selected] [data-visually-hidden]',
      ),
    ).not.toBeNull();
  });
});
