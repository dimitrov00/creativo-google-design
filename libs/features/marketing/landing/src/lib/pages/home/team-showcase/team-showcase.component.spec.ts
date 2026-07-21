import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../../../test-i18n.providers';
import { TeamShowcaseComponent } from './team-showcase.component';

describe('TeamShowcaseComponent', () => {
  it('renders a scalable team catalog and optional detail metadata', async () => {
    await TestBed.configureTestingModule({
      imports: [TeamShowcaseComponent],
      providers: [...provideTestI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamShowcaseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.team-card').length).toBe(3);
    expect(
      host.querySelectorAll('.team-card[role="button"][aria-haspopup="dialog"]')
        .length,
    ).toBe(3);
    expect(host.querySelectorAll('.team-card__explore-label').length).toBe(3);
    expect(host.querySelectorAll('.team-card__explore-icon').length).toBe(3);
    expect(host.querySelectorAll('.showcase-gallery figure').length).toBe(4);
    expect(host.querySelector('.barber-sheet__about')).not.toBeNull();
    expect(host.querySelector('.barber-sheet__rating')).not.toBeNull();
    expect(
      host.querySelector('#barber-detail-sheet.modal-sheet[role="dialog"]'),
    ).not.toBeNull();
  });
});
