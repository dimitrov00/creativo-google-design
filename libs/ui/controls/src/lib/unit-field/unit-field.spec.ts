import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiUnitField } from './unit-field';

@Component({
  imports: [UiUnitField],
  template: `
    <label for="tip">Tip</label>
    <ui-unit-field
      uiId="tip"
      [uiValue]="value()"
      uiUnit="€"
      uiPlaceholder="0,00"
      uiTestId="tip-field"
      (uiInput)="typed.set($event)"
      (uiValueChange)="accept($event)"
    />
  `,
})
class Host {
  readonly value = signal('');
  readonly typed = signal('');
  /** Accepts two decimals only, formatted; refuses the rest. */
  accept(raw: string): void {
    const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw.trim());
    if (!match) return;
    this.value.set(`${match[1]},${(match[2] ?? '').padEnd(2, '0')}`);
  }
}

describe('UiUnitField', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const native = fixture.nativeElement.querySelector(
      '[data-testid="tip-field"]',
    ) as HTMLInputElement;
    return { fixture, host: fixture.nativeElement as HTMLElement, native };
  }

  it('says the unit beside the figure, and a placeholder rather than a blank', async () => {
    const { host, native } = await render();
    expect(native.value).toBe('');
    expect(native.getAttribute('placeholder')).toBe('0,00');
    const unit = host.querySelector('.ui-unit-field__unit');
    expect(unit?.textContent?.trim()).toBe('€');
    expect(unit?.getAttribute('aria-hidden')).toBe('true');
    expect(native.getAttribute('aria-describedby')).toBe(unit?.id);
    // The sizer holds what the field shows — the placeholder, for now.
    expect(
      host.querySelector('.ui-unit-field__sizer')?.textContent?.trim(),
    ).toBe('0,00');
  });

  it('reports what was typed, then shows what the owner accepted', async () => {
    const { fixture, native } = await render();
    native.value = '12,5';
    native.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.typed()).toBe('12,5');
    native.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(native.value).toBe('12,50');

    // Refused: the field springs back rather than sitting there looking saved.
    native.value = 'free';
    native.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(native.value).toBe('12,50');
  });
});
