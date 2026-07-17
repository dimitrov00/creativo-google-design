import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../test-i18n.providers';
import { ServicesPage } from './services.page';

describe('ServicesPage', () => {
  it('renders the complete service index', async () => {
    await TestBed.configureTestingModule({
      imports: [ServicesPage],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ServicesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.service-tile').length).toBe(6);
    expect(
      host.querySelectorAll('.service-tile[role="button"][tabindex="0"]')
        .length,
    ).toBe(6);
    expect(host.querySelectorAll('.service-tile__explore-label').length).toBe(
      6,
    );
    expect(host.querySelectorAll('.service-tile__explore-icon').length).toBe(6);
    expect(
      host.querySelectorAll(
        '.service-tile__explore-label[data-cr-cursor-style="fill"]',
      ).length,
    ).toBe(6);
    expect(
      host.querySelectorAll(
        '.service-tile__explore-icon[data-cr-cursor-style="fill"]',
      ).length,
    ).toBe(6);
    expect(host.querySelector('.service-tile__provenance')).toBeNull();
    expect(host.querySelectorAll('.showcase-gallery figure').length).toBe(6);
    expect(host.querySelectorAll('.showcase-gallery figcaption').length).toBe(
      0,
    );
    expect(host.querySelectorAll('.service-performer').length).toBe(2);
    expect(host.querySelectorAll('button.service-performer').length).toBe(0);
    expect(host.querySelector('.service-performer--any')).toBeNull();
    expect(host.querySelectorAll('.service-sheet__variants li').length).toBe(4);
    expect(
      host.querySelectorAll('.service-sheet__variants button').length,
    ).toBe(0);
    expect(host.querySelector('.service-addons')).toBeNull();
    expect(
      host.querySelector('button.showcase-gallery__layout-toggle'),
    ).not.toBeNull();
    expect(host.querySelector('.showcase-gallery__progress')).toBeNull();
    expect(
      host.querySelector('#service-detail-sheet.modal-sheet[role="dialog"]'),
    ).not.toBeNull();
    expect(host.querySelector('.service-sheet__grabber')).toBeNull();
    expect(host.querySelector('.service-sheet__compact-title')).not.toBeNull();
    expect(
      host.querySelector('.modal-sheet__toolbar')?.parentElement?.classList,
    ).toContain('modal-sheet__scroll');
    expect(host.querySelector('.service-sheet__summary a')).not.toBeNull();
    expect(host.querySelector('.service-sheet__booking-bar')).not.toBeNull();
    expect(
      host.querySelector('.service-sheet__booking-bar[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});
