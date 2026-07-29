import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestI18n } from '../../test-i18n.providers';
import { provideTestCatalog } from '../../test-catalog.providers';
import { ServicesSectionComponent } from './services-section.component';
import { CatalogNavigationService } from '../../shared/catalog-navigation.service';

describe('ServicesSectionComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [ServicesSectionComponent],
      providers: [
        ...provideTestI18n(),
        ...provideTestCatalog(),
        provideRouter([]),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ServicesSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renders the header trio and one tile per marketing-shelf service', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    expect(
      host.querySelector('ui-section-header [uiEyebrow]')?.textContent,
    ).toContain('Услугите');
    expect(host.querySelector('ui-section-header [uiTitle]')).not.toBeNull();

    // v2 shelf: 4 singles + 2 bundles; upsell-only add-ons never appear.
    expect(host.querySelectorAll('.cr-services__tile').length).toBe(6);
    expect(
      host.querySelectorAll(
        '.cr-services__carousel--singles .cr-services__tile',
      ).length,
    ).toBe(4);
    expect(
      host.querySelectorAll(
        '.cr-services__carousel--bundles .cr-services__tile',
      ).length,
    ).toBe(2);
  });

  it('marks bundle tiles with the layers chip and covers the no-photo fallback', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    // Both bundles carry the corner chip.
    expect(
      host.querySelectorAll(
        '.cr-services__carousel--bundles .cr-services__bundle-chip',
      ).length,
    ).toBe(2);
    // "Beard grooming" seeds without a cover — scissors motif, not a broken img.
    const beardTile = host.querySelector('[data-testid="service-tile-beard"]');
    expect(beardTile?.querySelector('.cr-services__fallback')).not.toBeNull();
    expect(beardTile?.querySelector('img')).toBeNull();
  });

  it('opens the tapped service on the page-level detail sheet', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    const catalog = TestBed.inject(CatalogNavigationService);

    // The sheet is NOT this section's — one instance lives on the page and
    // the team section hands off to it too.
    expect(host.querySelector('cr-service-detail-sheet')).toBeNull();
    expect(catalog.current()).toBeNull();

    host
      .querySelector<HTMLButtonElement>('[data-testid="service-tile-haircut"]')
      ?.click();
    fixture.detectChanges();

    expect(catalog.current()?.id).toBe('haircut');
  });
});
