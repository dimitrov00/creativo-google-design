import { TestBed } from '@angular/core/testing';
import { CATALOG_ART, NO_CATALOG_ART } from '@creativo/features/shared/catalog';
import {
  provideTestCatalog,
  provideTestI18n,
} from '@creativo/features/marketing/landing/testing';
import { TeamShowcaseComponent } from './team-showcase.component';

describe('TeamShowcaseComponent', () => {
  it('renders the stored team — each public barber’s avatar, title and name — and its barber detail sheet', async () => {
    await TestBed.configureTestingModule({
      imports: [TeamShowcaseComponent],
      providers: [...provideTestI18n(), ...provideTestCatalog()],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamShowcaseComponent);
    // Two passes: the avatars resolve through the media cache's promise.
    for (let pass = 0; pass < 2; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    const host: HTMLElement = fixture.nativeElement;

    // The catalogue's public barbers, in their `sortOrder`.
    const cards = host.querySelectorAll<HTMLElement>('.team-card');
    expect(cards.length).toBe(3);
    expect(cards[0]?.querySelector('h3')?.textContent?.trim()).toBe(
      'Иван Колев',
    );
    expect(
      cards[0]?.querySelector('.team-card__role')?.textContent?.trim(),
    ).toBe('Главен бръснар');
    expect(cards[0]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/barbers/ivan.jpg',
    );
    // No rating, anywhere: the catalogue has no reviews.
    expect(host.querySelector('ui-rating')).toBeNull();
    // Native buttons now — Enter/Space and focus semantics come free.
    expect(
      host.querySelectorAll('button.team-card[aria-haspopup="dialog"]').length,
    ).toBe(3);
    // The explore affordance is DS button chrome (decorative span form):
    // stroked capsule label + icon-only chip per card.
    expect(
      host.querySelectorAll(
        '.team-card__action span.ui-button[data-button-style="strokedBorder"]',
      ).length,
    ).toBe(6);
    expect(
      host.querySelectorAll('.team-card__action span.ui-button[data-icon-only]')
        .length,
    ).toBe(3);

    // The sheet has no subject until a card opens one — WHICH barber it
    // shows is shared state now (a performer in the service sheet opens
    // this same sheet), so at rest there is nothing to render.
    expect(host.querySelector('.barber-sheet__profile')).toBeNull();

    host.querySelector<HTMLButtonElement>('.team-card')?.click();
    fixture.detectChanges();

    // The demo art direction's gallery (`CATALOG_ART`, test support) and the
    // barber's own stored bio.
    expect(host.querySelectorAll('.showcase-gallery figure').length).toBe(4);
    expect(host.querySelector('.barber-sheet__about')?.textContent).toContain(
      'Дванадесет години на пода.',
    );
    expect(host.querySelector('ui-rating')).toBeNull();
    expect(
      host.querySelector('#barber-detail-sheet.modal-sheet[role="dialog"]'),
    ).not.toBeNull();
    // Book CTA lives in the docked sheet action bar — not in the profile
    // stack.
    expect(host.querySelector('.barber-sheet__profile a[uibutton]')).toBeNull();
    expect(
      host.querySelector('ui-sheet-action-bar a[uibutton][href="/client"]'),
    ).not.toBeNull();

    // The price list sits UNDER the gallery, derived from the catalog by
    // inverting `offerings` — Ivan performs six shelf services, and the
    // upsell-only add-ons stay out of it.
    const prices = host.querySelector('.barber-sheet__prices');
    expect(prices).not.toBeNull();
    expect(prices?.querySelector('h3')?.textContent).toContain('Ценоразпис');
    const rows = prices?.querySelectorAll('cr-service-row');
    expect(rows?.length).toBe(6);
    expect(rows?.[0]?.textContent).toContain('Класическо подстригване');
    expect(prices?.textContent).not.toContain('Масаж');
    // Every row is a REFERENCE to that service's own sheet.
    expect(
      prices?.querySelectorAll('button.ui-list-row[data-interactive]').length,
    ).toBe(6);
  });

  it('draws no specialty and no gallery for a barber without art direction', async () => {
    await TestBed.configureTestingModule({
      imports: [TeamShowcaseComponent],
      providers: [
        ...provideTestI18n(),
        ...provideTestCatalog(),
        // Production's art: none.
        { provide: CATALOG_ART, useValue: NO_CATALOG_ART },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamShowcaseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.team-card').length).toBe(3);
    expect(host.querySelector('.team-card__facts')).toBeNull();

    host.querySelector<HTMLButtonElement>('.team-card')?.click();
    fixture.detectChanges();

    expect(host.querySelector('.barber-sheet__profile')).not.toBeNull();
    expect(host.querySelector('.barber-sheet__specialty')).toBeNull();
    expect(host.querySelector('.showcase-gallery')).toBeNull();
    // The price list still follows the stored offerings.
    expect(
      host.querySelectorAll('.barber-sheet__prices cr-service-row').length,
    ).toBe(6);
  });
});
