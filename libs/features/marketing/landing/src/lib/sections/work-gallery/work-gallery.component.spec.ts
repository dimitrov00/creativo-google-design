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

    const cards = host.querySelectorAll('.cr-gallery__card');
    expect(cards.length).toBe(6);
    expect(host.querySelectorAll('.cr-gallery__image').length).toBe(6);
    // Art direction rides each card (aspect box per shot).
    expect((cards[0] as HTMLElement).style.aspectRatio).toBe('4/5');
    expect(
      host.querySelector('[data-testid="work-gallery-caption"]'),
    ).not.toBeNull();
    expect(host.querySelector('.cr-gallery__progress')).not.toBeNull();
  });

  it('opens the lightbox when a card is clicked and closes on backdrop click', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    (host.querySelector('.cr-gallery__card') as HTMLElement).click();
    fixture.detectChanges();
    const lightbox = host.querySelector(
      '[data-testid="work-gallery-lightbox"]',
    );
    expect(lightbox).not.toBeNull();
    expect(
      lightbox?.querySelector('.cr-gallery__lightbox-image'),
    ).not.toBeNull();

    lightbox
      ?.querySelector<HTMLButtonElement>('.cr-gallery__lightbox-backdrop')
      ?.click();
    fixture.detectChanges();
    expect(
      host.querySelector('[data-testid="work-gallery-lightbox"]'),
    ).toBeNull();
  });
});
