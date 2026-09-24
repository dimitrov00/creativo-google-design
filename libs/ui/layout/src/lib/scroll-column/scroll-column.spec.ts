import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiScrollColumn } from './scroll-column';

@Component({
  imports: [UiScrollColumn],
  template: `<ui-scroll-column
    [uiSnap]="snap()"
    [uiSpacing]="'compact'"
    data-testid="scroll-column"
    ><p>one</p>
    <p>two</p></ui-scroll-column
  >`,
})
class HostComponent {
  snap = signal<'none' | 'start' | 'center'>('none');
}

describe('UiScrollColumn', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const column = () =>
    fixture.nativeElement.querySelector(
      '[data-testid="scroll-column"]',
    ) as HTMLElement;

  it('writes snap and gap as data-* attributes, snapping to nothing by default', () => {
    fixture.detectChanges();
    expect(column().classList.contains('ui-scroll-column')).toBe(true);
    expect(column().getAttribute('data-snap')).toBe('none');
    expect(column().getAttribute('data-spacing')).toBe('compact');
    expect(column().children).toHaveLength(2);
  });

  it('updates data-snap when the snap signal changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.snap.set('start');
    fixture.detectChanges();
    expect(column().getAttribute('data-snap')).toBe('start');
  });
});
