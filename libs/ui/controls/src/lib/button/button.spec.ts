import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: `<button
    uiButton
    [uiVariant]="'destructive'"
    [uiSize]="'compact'"
    [uiLoading]="loading"
  >
    Save
  </button>`,
})
class HostComponent {
  loading = false;
}

describe('UiButton', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes variant/size as data-* attributes, never as classes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.classList.contains('ui-button')).toBe(true);
    expect(el.getAttribute('data-variant')).toBe('destructive');
    expect(el.getAttribute('data-size')).toBe('compact');
  });

  it('marks aria-busy and data-state="loading" while loading', () => {
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('data-state')).toBe('loading');
  });

  it('omits data-state when not loading', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-state')).toBeNull();
  });
});
