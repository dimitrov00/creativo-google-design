import { TestBed } from '@angular/core/testing';
import { BookingsPage } from './bookings.page';

describe('BookingsPage', () => {
  it('renders a heading', async () => {
    await TestBed.configureTestingModule({
      imports: [BookingsPage],
    }).compileComponents();
    const fixture = TestBed.createComponent(BookingsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')).not.toBeNull();
  });
});
