import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../test-i18n.providers';
import { HomePage } from './home.page';

describe('HomePage', () => {
  it('renders the conversion hero and media story', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [...provideTestI18n()],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')?.textContent).toContain('Визия');
    expect(host.querySelectorAll('.work-card').length).toBe(6);
    expect(host.querySelectorAll('.work-card > a + div').length).toBe(6);
    expect(host.querySelector('[data-gallery-scene]')).not.toBeNull();
    expect(host.querySelector('.edition-line')).toBeNull();
    expect(host.querySelector('.gallery-meter')).toBeNull();
    expect(host.querySelector('.film-control')).not.toBeNull();
    expect(host.querySelectorAll('.team-card').length).toBe(3);
    expect(
      host.querySelector('#barber-detail-sheet.modal-sheet[role="dialog"]'),
    ).not.toBeNull();
  });
});
