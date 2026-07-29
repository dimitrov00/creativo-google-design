import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../../test-i18n.providers';
import { TeamShowcaseComponent } from './team-showcase.component';

describe('TeamShowcaseComponent', () => {
  it('renders a scalable team catalog and its barber detail sheet', async () => {
    await TestBed.configureTestingModule({
      imports: [TeamShowcaseComponent],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamShowcaseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.team-card').length).toBe(3);
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

    expect(host.querySelectorAll('.showcase-gallery figure').length).toBe(4);
    expect(host.querySelector('.barber-sheet__about')).not.toBeNull();
    expect(host.querySelector('ui-rating.barber-sheet__rating')).not.toBeNull();
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
});
