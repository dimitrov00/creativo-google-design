import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiSwitch } from './switch';

@Component({
  imports: [UiSwitch],
  template: `<button
    uiSwitch
    [(uiOn)]="on"
    [uiDisabled]="disabled()"
    aria-label="Save to my profile"
  ></button>`,
})
class Host {
  readonly on = signal(false);
  readonly disabled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    button: fixture.nativeElement.querySelector('button') as HTMLButtonElement,
  };
}

describe('UiSwitch', () => {
  it('announces itself as a switch, not a checkbox', () => {
    const { button } = render();
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('flips on press and writes back through the model', () => {
    const { fixture, host, button } = render();

    button.click();
    fixture.detectChanges();

    expect(host.on()).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.hasAttribute('data-on')).toBe(true);
  });

  it('refuses to flip while disabled', () => {
    const { fixture, host, button } = render();
    host.disabled.set(true);
    fixture.detectChanges();

    button.click();
    fixture.detectChanges();

    expect(host.on()).toBe(false);
  });
});
