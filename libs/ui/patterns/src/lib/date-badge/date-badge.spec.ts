import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiDateBadge } from './date-badge';

@Component({
  imports: [UiDateBadge],
  template: `<ui-date-badge
    data-testid="badge"
    [uiDay]="day()"
    [uiState]="state()"
    [uiMarker]="marker()"
  />`,
})
class HostComponent {
  day = signal(5);
  state = signal<'plain' | 'today' | 'selected' | 'outside'>('plain');
  marker = signal(false);
}

describe('UiDateBadge', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders the day number and defaults to a plain state with no marker', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="badge"]',
    );
    expect(el.classList.contains('ui-date-badge')).toBe(true);
    expect(el.getAttribute('data-state')).toBe('plain');
    expect(el.textContent?.trim()).toBe('5');
    expect(el.querySelector('.ui-date-badge__marker')).toBeNull();
  });

  it('reflects uiState as a data-* attribute and renders the marker when set', () => {
    fixture.componentInstance.state.set('today');
    fixture.componentInstance.marker.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="badge"]',
    );
    expect(el.getAttribute('data-state')).toBe('today');
    expect(el.querySelector('.ui-date-badge__marker')).not.toBeNull();
  });
});
