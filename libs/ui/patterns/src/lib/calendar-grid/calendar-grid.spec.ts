import { Component } from '@angular/core';
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
