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
    expect(host.querySelectorAll('.location-card__explore-label').length).toBe(
      2,
    );
    expect(host.querySelectorAll('.location-card__maps').length).toBe(2);
    // Open/closed lines ride the shared ui-status-indicator pattern.
    expect(
      host.querySelectorAll('.location-card ui-status-indicator').length,
    ).toBe(2);
    // Both shops carry a venue phone (synced to the v2 demo-seed content).
    expect(host.querySelectorAll('.location-card__phone').length).toBe(2);
    // Icons are named by INTENT (semantic registry keys), and the registry
    // resolves the place intent to its Material Symbols glyph.
    expect(
      host.querySelector('.location-card__icon .ui-icon__glyph')?.textContent,
    ).toBe('location_on');
    expect(host.querySelector('[data-locations-map]')).not.toBeNull();
    expect(host.querySelector('.location-card__media')).toBeNull();

    const sheet = host.querySelector<HTMLElement>(
      '#location-detail-sheet.ui-sheet[role="dialog"]',
    );
    expect(sheet).not.toBeNull();
    expect(sheet?.hasAttribute('data-open')).toBe(false);

    const firstCard = host.querySelector<HTMLElement>('.location-card');
    firstCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(sheet?.hasAttribute('data-open')).toBe(true);
    expect(host.querySelector('[data-location-sheet-map]')).not.toBeNull();
    expect(host.querySelectorAll('.location-sheet__day').length).toBe(7);
    expect(
      host.querySelector('.location-sheet__day[data-today]'),
    ).not.toBeNull();
    expect(
      host.querySelector('.location-sheet__status-card ui-status-indicator'),
    ).not.toBeNull();

    // The sheet's ONE action row is the bottom ui-sheet-action-bar —
    // visible for the sheet's whole open lifetime (no scroll-triggered
    // reveal), with no duplicate CTA cluster in the intro. Every bar
    // control shares the prominent 52px tier (no mixed sizes within one
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
      expect(button.getAttribute('data-size')).toBe('prominent');
      expect(button.getAttribute('tabindex')).toBeNull();
    });
    expect(
      toolbar
        ?.querySelector('.location-sheet__toolbar-book')
        ?.getAttribute('aria-label'),
    ).toBeTruthy();

    // The status card rides the DS elevated tone at the stepped-down
    // regular padding, separates the status row from the week list with
    // the sanctioned ui-divider (no local border hairline), and "today" is
    // conveyed to AT via SR-only text instead of a redundant visual tag on
    // the already-emphasized row.
    const statusCard = host.querySelector('.location-sheet__status-card');
    expect(statusCard?.getAttribute('data-tone')).toBe('elevated');
    expect(statusCard?.getAttribute('data-padding')).toBe('regular');
    expect(
      statusCard?.querySelector('ui-divider.ui-divider[role="separator"]'),
    ).not.toBeNull();
    expect(host.querySelector('.location-sheet__today-tag')).toBeNull();
    expect(
      host.querySelector(
        '.location-sheet__day[data-today] .location-sheet__day-name [data-visually-hidden]',
      ),
    ).not.toBeNull();
  });
});
