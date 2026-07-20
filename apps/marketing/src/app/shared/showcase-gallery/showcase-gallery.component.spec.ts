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
    fixture.componentRef.setInput('scrollProgress', 0.5);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('figure').length).toBe(3);
    expect(host.querySelectorAll('img[alt="Example result"]').length).toBe(3);
    expect(
      host.querySelector('figure[data-active] img')?.getAttribute('src'),
    ).toBe('/two.jpg');

    host.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(host.hasAttribute('data-expanded')).toBe(true);
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
