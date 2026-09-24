import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: `<button
    uiButton
    [uiButtonStyle]="'borderedProminent'"
    [uiRole]="'destructive'"
    [uiControlSize]="'small'"
    [uiLoading]="loading"
    [uiMultiline]="multiline"
    [uiSpread]="spread"
  >
    Save
  </button>`,
})
class HostComponent {
  loading = false;
  multiline = false;
  spread = false;
}

@Component({
  imports: [UiButton],
  template: `<button
    uiButton
    [uiButtonStyle]="'bordered'"
    [uiIconOnly]="true"
    [uiSelected]="selected"
  >
    close
  </button>`,
})
class ToggleHostComponent {
  selected = false;
}

describe('UiButton', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes style/role/size as data-* attributes, never as classes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.classList.contains('ui-button')).toBe(true);
    expect(el.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(el.getAttribute('data-role')).toBe('destructive');
    expect(el.getAttribute('data-control-size')).toBe('small');
  });

  it('draws its own ring while loading, hidden from assistive tech, the label kept for its width', () => {
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    const progress = el.querySelector('.ui-button__progress');
    expect(progress?.getAttribute('aria-hidden')).toBe('true');
    expect(
      progress
        ?.querySelector('ui-progress-view')
        ?.getAttribute('data-control-size'),
    ).toBe('small');
    expect(el.textContent).toContain('Save');
  });

  it('draws no ring at rest', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.querySelector('.ui-button__progress')).toBeNull();
    expect(el.querySelector('ui-progress-view')).toBeNull();
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

  it('never announces plain buttons as toggles: no aria-pressed unless uiSelected is bound', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.hasAttribute('aria-pressed')).toBe(false);
    expect(el.hasAttribute('data-selected')).toBe(false);
    expect(el.hasAttribute('data-icon-only')).toBe(false);
    expect(el.hasAttribute('data-multiline')).toBe(false);
    expect(el.hasAttribute('data-spread')).toBe(false);
  });

  it('stamps data-multiline for wrapping labels', () => {
    fixture.componentInstance.multiline = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-multiline')).toBe('');
  });

  it('stamps data-spread as a bare attribute (full-width sheet-CTA row)', () => {
    fixture.componentInstance.spread = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-spread')).toBe('');
  });
});

describe('UiButton toggles (uiIconOnly / uiSelected)', () => {
  let fixture: ComponentFixture<ToggleHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToggleHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ToggleHostComponent);
  });

  it('stamps data-icon-only as a bare attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-icon-only')).toBe('');
  });

  it('announces aria-pressed="false" while unselected once uiSelected is bound', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('aria-pressed')).toBe('false');
    expect(el.hasAttribute('data-selected')).toBe(false);
  });

  it('stamps data-selected + aria-pressed="true" when selected', () => {
    fixture.componentInstance.selected = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBe('');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});
