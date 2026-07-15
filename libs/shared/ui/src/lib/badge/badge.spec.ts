import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Badge } from './badge';

describe('Badge', () => {
  let fixture: ComponentFixture<Badge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Badge],
    }).compileComponents();

    fixture = TestBed.createComponent(Badge);
    await fixture.whenStable();
  });

  it('has no live-region role by default (static tone chips should not be announced) and defaults to the neutral tone', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.hasAttribute('role')).toBe(false);
    expect(host.getAttribute('data-tone')).toBe('neutral');
  });

  it('exposes a status role for assistive tech only when opted into live updates', () => {
    fixture.componentRef.setInput('live', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('role')).toBe('status');
  });

  it('reflects a bound tone as a data-attribute', () => {
    fixture.componentRef.setInput('tone', 'danger');
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-tone')).toBe('danger');
  });
});
