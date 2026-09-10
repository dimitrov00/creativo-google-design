import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiTimeField } from './time-field';

@Component({
  imports: [UiTimeField],
  template: `
    <label for="start">Start</label>
    <ui-time-field
      uiId="start"
      [uiValue]="value()"
      uiMin="08:00"
      uiMax="19:00"
      uiTestId="start-field"
      (uiValueChange)="value.set($event)"
    />
  `,
})
class Host {
  readonly value = signal('10:00');
}

describe('UiTimeField', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the value on its own face, with the platform picker beneath it', async () => {
    const { host } = await render();
    const face = host.querySelector('.ui-time-field__face');
    expect(face?.textContent?.replace(/\s+/g, ' ')).toContain('10:00');
    expect(face?.getAttribute('aria-hidden')).toBe('true');
    const native = host.querySelector<HTMLInputElement>(
      '[data-testid="start-field"]',
    );
    expect(native?.type).toBe('time');
    expect(native?.id).toBe('start');
    expect(native?.getAttribute('min')).toBe('08:00');
    expect(native?.getAttribute('max')).toBe('19:00');
    expect(native?.value).toBe('10:00');
  });

  it('reports what the picker produced, and draws it', async () => {
    const { fixture, host } = await render();
    const native = host.querySelector<HTMLInputElement>(
      '[data-testid="start-field"]',
    ) as HTMLInputElement;
    native.value = '12:35';
    native.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('12:35');
    expect(host.querySelector('.ui-time-field__value')?.textContent).toBe(
      '12:35',
    );
  });

  it('draws a placeholder for no value', async () => {
    const { fixture, host } = await render();
    fixture.componentInstance.value.set('');
    fixture.detectChanges();
    expect(host.querySelector('.ui-time-field__value')?.textContent).toBe(
      '––:––',
    );
  });
});
