import { TestBed } from '@angular/core/testing';
import { ShowcaseGalleryComponent } from './showcase-gallery.component';

describe('ShowcaseGalleryComponent', () => {
  it('picks when asked to — every tile a button, the picture said by its URL — and shows plain figures otherwise', async () => {
    await TestBed.configureTestingModule({
      imports: [ShowcaseGalleryComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShowcaseGalleryComponent);
    fixture.componentRef.setInput('images', ['/one.jpg', '/two.jpg']);
    fixture.componentRef.setInput('imageAlt', 'Example result');
    fixture.componentRef.setInput('ariaLabel', 'Results gallery');
    fixture.componentRef.setInput('gridViewLabel', 'Grid view');
    fixture.componentRef.setInput('carouselViewLabel', 'Carousel view');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    // Showing: no buttons among the tiles.
    expect(host.querySelectorAll('figure button').length).toBe(0);

    fixture.componentRef.setInput('selectable', true);
    fixture.detectChanges();
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((url) => picked.push(url));
    const picks = host.querySelectorAll<HTMLButtonElement>(
      'figure > button.showcase-gallery__pick',
    );
    expect(picks.length).toBe(2);
    expect(picks[1]?.getAttribute('aria-label')).toBe('Example result');
    expect(picks[1]?.querySelector('ui-async-image')).not.toBeNull();
    // The tiles say nothing: the picture is the whole control.
    expect(
      [...host.querySelectorAll('figure')].every(
        (figure) => figure.textContent?.trim() === '',
      ),
    ).toBe(true);
    picks[1]?.click();
    expect(picked).toEqual(['/two.jpg']);
    // A selection, said by the host, reads as a check on the tile.
    expect(
      [...picks].every((pick) => pick.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    fixture.componentRef.setInput('selected', ['/two.jpg']);
    fixture.detectChanges();
    expect(picks[0]?.getAttribute('aria-checked')).toBe('false');
    expect(picks[1]?.getAttribute('aria-checked')).toBe('true');
    expect(
      picks[1]?.querySelector(
        '.showcase-gallery__check ui-icon[data-name="checklist.done"]',
      ),
    ).not.toBeNull();
    expect(picks[0]?.querySelector('.showcase-gallery__check')).toBeNull();
  });

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
