import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../test-i18n.providers';
import { WorkGalleryComponent } from './work-gallery.component';

describe('WorkGalleryComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [WorkGalleryComponent],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(WorkGalleryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renders the six art-directed cards from the demo seed', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    const cards = host.querySelectorAll('button.cr-gallery__card');
    expect(cards.length).toBe(6);
    // Cards ride the shared interactive-surface grammar.
    expect(cards[0]?.hasAttribute('data-interactive')).toBe(true);
    expect(
      host.querySelectorAll('ui-async-image.cr-gallery__figure').length,
    ).toBe(6);
    // Art direction rides each card (aspect box per shot).
    expect((cards[0] as HTMLElement).style.aspectRatio).toBe('4/5');
    expect(
      host
        .querySelector('[data-testid="work-gallery-caption"]')
        ?.getAttribute('data-font'),
    ).toBe('title');
    expect(host.querySelector('.cr-gallery__progress')).not.toBeNull();
  });

  it('opens the ui-sheet lightbox when a card is clicked and closes from the close control', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    const lightbox = host.querySelector(
      '[data-testid="work-gallery-lightbox"]',
    );
    expect(lightbox).not.toBeNull();
    expect(lightbox?.hasAttribute('data-open')).toBe(false);

    (host.querySelector('.cr-gallery__card') as HTMLElement).click();
    fixture.detectChanges();
    expect(lightbox?.hasAttribute('data-open')).toBe(true);
    expect(
      lightbox?.querySelector('.cr-gallery__lightbox-image'),
    ).not.toBeNull();

    const close = lightbox?.querySelector<HTMLButtonElement>(
      '[data-testid="work-gallery-lightbox-close"]',
    );
    // The close control is a DS overlay icon button, not hand-rolled chrome.
    expect(close?.classList.contains('ui-button')).toBe(true);
    expect(close?.getAttribute('data-variant')).toBe('overlay');
    expect(close?.hasAttribute('data-icon-only')).toBe(true);
    close?.click();
    fixture.detectChanges();
    expect(lightbox?.hasAttribute('data-open')).toBe(false);
    expect(lightbox?.querySelector('.cr-gallery__lightbox-image')).toBeNull();
  });
});
