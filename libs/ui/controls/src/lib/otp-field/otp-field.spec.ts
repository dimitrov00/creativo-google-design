import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiOtpField } from './otp-field';

@Component({
  imports: [UiOtpField],
  template: `<ui-otp-field
    [uiLength]="4"
    [(value)]="value"
    [uiInvalid]="invalid()"
    [uiDisabled]="disabled()"
  />`,
})
class HostComponent {
  value = '';
  readonly invalid = signal(false);
  readonly disabled = signal(false);
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  return event;
}

describe('UiOtpField', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  function slot(index: number): HTMLInputElement {
    return fixture.nativeElement.querySelector(
      `[aria-label="Digit ${index + 1}"]`,
    );
  }

  it('renders one input slot per uiLength', () => {
    fixture.detectChanges();
    const slots = fixture.nativeElement.querySelectorAll('.ui-otp-field__slot');
    expect(slots.length).toBe(4);
  });

  it('propagates data-invalid onto the host', async () => {
    fixture.detectChanges();
    fixture.componentInstance.invalid.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement =
      fixture.nativeElement.querySelector('ui-otp-field');
    expect(host.getAttribute('data-invalid')).toBe('');
  });

  it('slots carry one-time-code autofill semantics, never type=number', () => {
    fixture.detectChanges();
    const first = slot(0);
    expect(first.getAttribute('type')).toBe('text');
    expect(first.getAttribute('inputmode')).toBe('numeric');
    expect(first.getAttribute('autocomplete')).toBe('one-time-code');
    expect(first.getAttribute('pattern')).toBe('[0-9]*');
    // No maxlength — it would truncate a pasted code to one char before
    // the paste handler ever ran.
    expect(first.hasAttribute('maxlength')).toBe(false);
  });

  it('uiDisabled locks every slot and stamps data-disabled', async () => {
    fixture.detectChanges();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement =
      fixture.nativeElement.querySelector('ui-otp-field');
    expect(host.getAttribute('data-disabled')).toBe('');
    expect(slot(0).disabled).toBe(true);
    expect(slot(3).disabled).toBe(true);
  });

  it('typing a digit fills the slot and advances focus to the next slot', () => {
    fixture.detectChanges();
    const first = slot(0);
    first.value = '1';
    first.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('1');
    expect(document.activeElement).toBe(slot(1));
  });

  it('rejects a non-digit keystroke — the slot stays empty and the value untouched', () => {
    // inputmode/pattern shape the mobile keyboard but never block hardware
    // keys; the component itself is the digits-only gate.
    fixture.detectChanges();
    const first = slot(0);
    first.value = 'a';
    first.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('');
    expect(first.value).toBe('');
  });

  it('a full-length paste distributes across all slots from the start', () => {
    fixture.detectChanges();
    // Pasted into a MIDDLE slot — a complete code still fills from slot 0.
    slot(2).dispatchEvent(pasteEvent('4928'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('4928');
    expect(slot(0).value).toBe('4');
    expect(slot(3).value).toBe('8');
  });

  it('strips non-digits from a pasted code', () => {
    fixture.detectChanges();
    slot(0).dispatchEvent(pasteEvent('49-28'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('4928');
  });

  it('a partial paste fills forward from the receiving slot', () => {
    fixture.componentInstance.value = '12';
    fixture.detectChanges();
    slot(2).dispatchEvent(pasteEvent('34'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('1234');
  });

  it('a multi-character input (autofill) distributes like a paste', () => {
    fixture.detectChanges();
    const first = slot(0);
    first.value = '4928';
    first.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('4928');
    expect(slot(1).value).toBe('9');
  });

  it('backspace on an empty slot moves focus back to the previous slot', () => {
    fixture.detectChanges();
    const first = slot(0);
    const second = slot(1);
    second.focus();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();

    expect(document.activeElement).toBe(first);
  });
});
