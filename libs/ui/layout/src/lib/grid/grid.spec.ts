import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiGrid } from './grid';
import type { UiSpacing } from '../stack/stack';

@Component({
  imports: [UiGrid],
  template: `<ui-grid
    [uiColumns]="columns()"
    [uiSpacing]="'compact'"
    [uiRowSpacing]="rowGap()"
    data-testid="grid"
    >content</ui-grid
  >`,
})
class HostComponent {
  columns = signal(2);
  rowGap = signal<UiSpacing | undefined>(undefined);
}

describe('UiGrid', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('publishes the column count as the --ui-grid-columns custom property', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="grid"]',
    );
    expect(el.classList.contains('ui-grid')).toBe(true);
    expect(el.style.getPropertyValue('--ui-grid-columns')).toBe('2');
  });

  it('updates --ui-grid-columns when the columns signal changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.columns.set(7);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="grid"]',
    );
    expect(el.style.getPropertyValue('--ui-grid-columns')).toBe('7');
  });

  it('writes gap as a data-* attribute and omits data-row-spacing when unset', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="grid"]',
    );
    expect(el.getAttribute('data-spacing')).toBe('compact');
    expect(el.getAttribute('data-row-spacing')).toBeNull();
  });

  it('writes data-row-spacing when a row-gap override is set', () => {
    fixture.componentInstance.rowGap.set('spacious');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="grid"]',
    );
    expect(el.getAttribute('data-row-spacing')).toBe('spacious');
  });
});
