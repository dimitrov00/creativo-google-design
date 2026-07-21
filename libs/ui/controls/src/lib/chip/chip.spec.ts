import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiChip } from './chip';

@Component({
  imports: [UiChip],
  template: `<button uiChip [uiSelected]="selected()" [uiSize]="'compact'">
    Filter
  </button>`,
})
class HostComponent {
  readonly selected = signal(false);
}

describe('UiChip', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.classList.contains('ui-chip')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('compact');
  });

  it('omits data-selected and reports aria-pressed=false when not selected', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBeNull();
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes data-selected and aria-pressed=true when selected', async () => {
    fixture.detectChanges();
    fixture.componentInstance.selected.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBe('');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});
