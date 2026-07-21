import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiOtpField } from './otp-field';

@Component({
  imports: [UiOtpField],
  template: `<ui-otp-field
    [uiLength]="4"
    [(value)]="value"
    [uiInvalid]="invalid()"
  />`,
})
class HostComponent {
  value = '';
  readonly invalid = signal(false);
}

describe('UiOtpField', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

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

  it('typing a digit fills the slot and advances focus to the next slot', () => {
    fixture.detectChanges();
    const first: HTMLInputElement = fixture.nativeElement.querySelector(
      '[aria-label="Digit 1"]',
    );
    first.value = '1';
    first.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value).toBe('1');
    const second: HTMLInputElement = fixture.nativeElement.querySelector(
      '[aria-label="Digit 2"]',
    );
    expect(document.activeElement).toBe(second);
  });

  it('backspace on an empty slot moves focus back to the previous slot', () => {
    fixture.detectChanges();
    const first: HTMLInputElement = fixture.nativeElement.querySelector(
      '[aria-label="Digit 1"]',
    );
    const second: HTMLInputElement = fixture.nativeElement.querySelector(
      '[aria-label="Digit 2"]',
    );
    second.focus();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();

    expect(document.activeElement).toBe(first);
  });
});
