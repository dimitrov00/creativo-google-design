import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCalendarGrid } from './calendar-grid';

@Component({
  imports: [UiCalendarGrid],
  template: `<ui-calendar-grid data-testid="grid"
    ><span>a</span><span>b</span></ui-calendar-grid
  >`,
})
class HostComponent {}

describe('UiCalendarGrid', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders projected content inside the grid host class', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="grid"]',
    );
    expect(el.classList.contains('ui-calendar-grid')).toBe(true);
    expect(el.textContent).toContain('a');
    expect(el.textContent).toContain('b');
  });
});

@Component({
  imports: [UiCalendarGrid],
  template: `<ui-calendar-grid data-testid="sized" [uiSize]="size()">
    <span uiWeekday>Mo</span>
    <button uiDay type="button">1</button>
  </ui-calendar-grid>`,
})
class SizedHostComponent {
  size = signal<'regular' | 'large'>('regular');
}

describe('UiCalendarGrid — size', () => {
  let fixture: ComponentFixture<SizedHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SizedHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SizedHostComponent);
  });

  const grid = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="sized"]');

  it('defaults to the standing control size', () => {
    fixture.detectChanges();
    expect(grid().getAttribute('data-size')).toBe('regular');
  });

  // The badge scale is published by the GRID, so a consumer sizes a month
  // once instead of threading an input through forty-two cells.
  it('stamps the size the stylesheet keys the badge scale off', () => {
    fixture.componentInstance.size.set('large');
    fixture.detectChanges();
    expect(grid().getAttribute('data-size')).toBe('large');
  });
});
