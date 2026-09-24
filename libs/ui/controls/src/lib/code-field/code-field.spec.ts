import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCodeField } from './code-field';

@Component({
  imports: [UiCodeField],
  template: `<ui-code-field
    uiId="code"
    uiTestId="code"
    uiPlaceholder="e.g. GIFT2025"
    uiLabel="Voucher code"
    [uiAppearance]="appearance()"
    [uiControlSize]="'large'"
    [uiValue]="value()"
    [uiInvalid]="invalid()"
    (uiInput)="typed.push($event)"
    (uiValueChange)="left.push($event)"
    (uiSubmit)="submits = submits + 1"
  >
    @if (withScan()) {
      <button type="button" uiCodeFieldAction data-testid="scan">scan</button>
    }
  </ui-code-field>`,
})
class HostComponent {
  appearance = signal<'bordered' | 'plain'>('bordered');
  value = signal('');
  invalid = signal(false);
  withScan = signal(true);
  typed: string[] = [];
  left: string[] = [];
  submits = 0;
}

describe('UiCodeField', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const host = () =>
    fixture.nativeElement.querySelector('ui-code-field') as HTMLElement;
  const native = () =>
    fixture.nativeElement.querySelector(
      '[data-testid="code"]',
    ) as HTMLInputElement;
  const sizer = () =>
    host().querySelector('.ui-code-field__sizer') as HTMLElement;

  it('wears the form dress by default at the tier it is given, and names, labels and places the native input', () => {
    expect(host().getAttribute('data-appearance')).toBe('bordered');
    expect(host().getAttribute('data-control-size')).toBe('large');
    expect(native().closest('.ui-code-field__frame')).not.toBeNull();
    expect(native().id).toBe('code');
    expect(native().getAttribute('aria-label')).toBe('Voucher code');
    expect(native().getAttribute('placeholder')).toBe('e.g. GIFT2025');
    expect(native().getAttribute('autocapitalize')).toBe('characters');
    expect(native().getAttribute('autocomplete')).toBe('off');
    expect(native().getAttribute('enterkeyhint')).toBe('done');
    expect(native().getAttribute('aria-invalid')).toBeNull();
    expect(host().hasAttribute('data-empty')).toBe(true);
    expect(sizer().textContent).toBe('e.g. GIFT2025');
  });

  it('can go plain, for an owner that is the surface', () => {
    fixture.componentInstance.appearance.set('plain');
    fixture.detectChanges();
    expect(host().getAttribute('data-appearance')).toBe('plain');
  });

  it('reports every keystroke raw, and Return as a submit', () => {
    native().value = 'gift2025';
    native().dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.typed).toEqual(['gift2025']);
    native().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('measures the code the owner holds, and springs back to it when the field is left', () => {
    fixture.componentInstance.value.set('GIFT2025');
    fixture.detectChanges();
    expect(host().hasAttribute('data-empty')).toBe(false);
    expect(sizer().textContent).toBe('GIFT2025');
    native().value = 'GIFT2025X';
    native().dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.left).toEqual(['GIFT2025X']);
    expect(native().value).toBe('GIFT2025');
  });

  it('marks a refused code on the native input and the host', () => {
    fixture.componentInstance.invalid.set(true);
    fixture.detectChanges();
    expect(native().getAttribute('aria-invalid')).toBe('true');
    expect(host().hasAttribute('data-invalid')).toBe(true);
  });

  it('projects the accessory inside the frame, after the input, and leaves an empty slot behind when there is none', () => {
    const scan = host().querySelector('[data-testid="scan"]');
    const slot = scan?.closest('.ui-code-field__accessory');
    expect(slot?.closest('.ui-code-field__frame')).not.toBeNull();
    expect(slot?.previousElementSibling).toBe(native());
    fixture.componentInstance.withScan.set(false);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="scan"]')).toBeNull();
    expect(
      host().querySelector('.ui-code-field__accessory')?.childElementCount,
    ).toBe(0);
  });
});
