import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../../test-i18n.providers';
import { WorkGalleryComponent } from './work-gallery.component';

describe('WorkGalleryComponent', () => {
  it('renders the scroll-driven work gallery with all looks and a closing cta', async () => {
    await TestBed.configureTestingModule({
      imports: [WorkGalleryComponent],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(WorkGalleryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(
      host.querySelector('[data-work-gallery-section]#work'),
    ).not.toBeNull();
    expect(host.querySelectorAll('.work-card').length).toBe(6);
    expect(host.querySelectorAll('.work-card__frame img').length).toBe(6);
    expect(host.querySelector('.work-gallery__end')).not.toBeNull();
    expect(
      host.querySelector('.work-gallery__meter-count')?.textContent,
    ).toContain('01');
  });
});
