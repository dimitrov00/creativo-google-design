import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiDateBadge, type UiDateBadgeState } from './date-badge';

@Component({
  imports: [UiDateBadge],
  template: `<ui-date-badge
    data-testid="badge"
    [uiDay]="day()"
    [uiState]="state()"
    [uiToday]="today()"
    [uiMarker]="marker()"
  />`,
})
class HostComponent {
  day = signal(5);
  state = signal<UiDateBadgeState>('plain');
  today = signal(false);
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

  const badge = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="badge"]');

  it('renders the day number and defaults to plain, not today, no dot', () => {
    fixture.detectChanges();
    expect(badge().classList.contains('ui-date-badge')).toBe(true);
    expect(badge().getAttribute('data-state')).toBe('plain');
    expect(badge().getAttribute('data-today')).toBeNull();
    expect(badge().textContent?.trim()).toBe('5');
    expect(badge().querySelector('.ui-date-badge__marker')).toBeNull();
  });

  it('reflects uiState as a data-* attribute', () => {
    for (const state of [
      'selected',
      'outside',
      'unavailable',
    ] as const satisfies readonly UiDateBadgeState[]) {
      fixture.componentInstance.state.set(state);
      fixture.detectChanges();
      expect(badge().getAttribute('data-state')).toBe(state);
    }
  });

  /*
   * ⚠ TODAY DRAWS NO DOT. iOS renders today as the accent-coloured NUMBER
   * and keeps the dot for "there are events that day". Marking today with
   * the event indicator left the system unable to say the other thing.
   */
  it('marks today without spending the dot on it', () => {
    fixture.componentInstance.today.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('data-today')).toBe('');
    expect(badge().querySelector('.ui-date-badge__marker')).toBeNull();
  });

  it('renders the dot for a consumer marker', () => {
    fixture.componentInstance.marker.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('data-today')).toBeNull();
    expect(badge().querySelector('.ui-date-badge__marker')).not.toBeNull();
  });

  // The whole reason `today` stopped being a state: the two facts are
  // orthogonal, and a selected today has to keep saying it is today.
  it('keeps today-ness when the day is also selected', () => {
    fixture.componentInstance.state.set('selected');
    fixture.componentInstance.today.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('data-state')).toBe('selected');
    expect(badge().getAttribute('data-today')).toBe('');
  });

  /*
   * The pair that used to be indistinguishable. Today is ink and the dot is
   * the booking, so a booked today now says BOTH — which is the whole reason
   * the dot stopped marking today.
   */
  it('says today AND booked at once, in two different channels', () => {
    fixture.componentInstance.today.set(true);
    fixture.componentInstance.marker.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('data-today')).toBe('');
    expect(badge().querySelectorAll('.ui-date-badge__marker')).toHaveLength(1);
  });
});
