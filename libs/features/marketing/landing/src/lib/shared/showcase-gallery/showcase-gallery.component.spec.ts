import { TestBed } from '@angular/core/testing';
import { ShowcaseGalleryComponent } from './showcase-gallery.component';

describe('ShowcaseGalleryComponent', () => {
  it('renders a responsive gallery and owns its layout state', async () => {
    await TestBed.configureTestingModule({
      imports: [ShowcaseGalleryComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ShowcaseGalleryComponent);
    fixture.componentRef.setInput('images', [
      '/one.jpg',
      '/two.jpg',
      '/three.jpg',
    ]);
    fixture.componentRef.setInput('imageAlt', 'Example result');
    fixture.componentRef.setInput('ariaLabel', 'Results gallery');
    fixture.componentRef.setInput('gridViewLabel', 'Grid view');
    fixture.componentRef.setInput('carouselViewLabel', 'Carousel view');
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    // Strip mode rides the DS snap carousel.
    expect(
      host.querySelector('ui-scroll-row.showcase-gallery__track'),
    ).not.toBeNull();
    expect(host.querySelectorAll('figure').length).toBe(3);
    expect(host.querySelectorAll('ui-async-image').length).toBe(3);
    expect(host.querySelectorAll('img[alt="Example result"]').length).toBe(3);

    // The layout toggle is a DS PLAIN icon button (HIG: presentation-only
    // controls stay borderless — owner ruling 2026-07-27), never
    // hand-rolled chrome.
    const toggle = host.querySelector<HTMLButtonElement>('button');
    expect(toggle?.classList.contains('ui-button')).toBe(true);
    expect(toggle?.getAttribute('data-button-style')).toBe('plain');
    expect(toggle?.hasAttribute('data-icon-only')).toBe(true);

    toggle?.click();
    fixture.detectChanges();

    expect(host.hasAttribute('data-expanded')).toBe(true);
    // The toggle stays a MOMENTARY plain button (no pressed/selected state
    // — the glyph names the view it switches to; owner ruling 2026-07-27),
    // so no aria-pressed; its accessible name flips with the state instead.
    expect(host.querySelector('button')?.hasAttribute('aria-pressed')).toBe(
      false,
    );
    // Expanded mode swaps the strip for the DS 3-up grid.
    expect(
      host.querySelector('ui-grid.showcase-gallery__track'),
    ).not.toBeNull();
    expect(host.querySelector('ui-scroll-row')).toBeNull();
    expect(host.querySelectorAll('figure').length).toBe(3);
  });
});
