import { TestBed } from '@angular/core/testing';
import { SchedulePage } from './schedule.page';

describe('SchedulePage', () => {
  it('renders a heading', async () => {
    await TestBed.configureTestingModule({
      imports: [SchedulePage],
    }).compileComponents();
    const fixture = TestBed.createComponent(SchedulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')?.textContent).toContain('Schedule');
  });
});
