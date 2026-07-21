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
    expect(host.querySelectorAll('.location-card__status').length).toBe(2);
    // Only the Center location has a phone number configured.
    expect(host.querySelectorAll('.location-card__phone').length).toBe(1);
    expect(host.querySelector('[data-locations-map]')).not.toBeNull();
    expect(host.querySelector('.location-card__media')).toBeNull();

    const firstCard = host.querySelector<HTMLElement>('.location-card');
    firstCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      host.querySelector('#location-detail-sheet.modal-sheet[role="dialog"]'),
    ).not.toBeNull();
    expect(host.querySelector('.location-sheet__book')).not.toBeNull();
    expect(host.querySelector('[data-location-sheet-map]')).not.toBeNull();
    expect(host.querySelectorAll('.location-sheet__day').length).toBe(7);
    expect(
      host.querySelector('.location-sheet__day[data-today]'),
    ).not.toBeNull();
    expect(host.querySelector('.location-sheet__status-dot')).not.toBeNull();
  });
});
