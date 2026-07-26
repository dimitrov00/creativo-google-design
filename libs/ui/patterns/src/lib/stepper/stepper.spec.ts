import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiStepper } from './stepper';

@Component({
  imports: [UiStepper],
  template: `<ui-stepper
    data-testid="stepper"
    [uiSteps]="steps()"
    [uiCurrent]="current()"
    [uiLabel]="label()"
    [uiLabelsHidden]="labelsHidden()"
  />`,
})
class HostComponent {
  steps = signal(3);
  current = signal(2);
  label = signal<string | null>('Step 2 of 3');
  labelsHidden = signal(false);
}

describe('UiStepper', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="stepper"]');
  }

  it('is a progressbar over the step ordinals, named by the label', () => {
    const el = host();
    expect(el.classList.contains('ui-stepper')).toBe(true);
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-valuemin')).toBe('1');
    expect(el.getAttribute('aria-valuemax')).toBe('3');
    expect(el.getAttribute('aria-valuenow')).toBe('2');
    expect(el.getAttribute('aria-label')).toBe('Step 2 of 3');
  });

  it('renders one segment per step with done/current/upcoming states', () => {
    const states = Array.from(
      host().querySelectorAll('.ui-stepper__segment'),
    ).map((segment) => segment.getAttribute('data-state'));
    expect(states).toEqual(['done', 'current', 'upcoming']);
  });

  it('renders the caption presentationally — the progressbar carries the name', () => {
    const label = host().querySelector('.ui-stepper__label');
    expect(label?.textContent).toBe('Step 2 of 3');
    expect(label?.getAttribute('aria-hidden')).toBe('true');
    expect(
      host().querySelector('.ui-stepper__track')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('hides the caption under uiLabelsHidden while the label still names the progressbar', () => {
    fixture.componentInstance.labelsHidden.set(true);
    fixture.detectChanges();
    // ≙ .labelsHidden(): segments only, no residual caption gap — but the
    // accessible name stays the translated label (quiet-chrome flows).
    expect(host().querySelector('.ui-stepper__label')).toBeNull();
    expect(host().getAttribute('aria-label')).toBe('Step 2 of 3');
  });

  it('omits the caption and falls back to a neutral accessible name without a label', () => {
    fixture.componentInstance.label.set(null);
    fixture.detectChanges();
    expect(host().querySelector('.ui-stepper__label')).toBeNull();
    expect(host().getAttribute('aria-label')).toBe('2 / 3');
  });

  it('clamps an out-of-range current step into the journey', () => {
    fixture.componentInstance.current.set(7);
    fixture.detectChanges();
    expect(host().getAttribute('aria-valuenow')).toBe('3');
    const states = Array.from(
      host().querySelectorAll('.ui-stepper__segment'),
    ).map((segment) => segment.getAttribute('data-state'));
    expect(states).toEqual(['done', 'done', 'current']);
  });
});
