import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Button,
  ButtonShape,
  ButtonSize,
  ButtonTone,
  ButtonVariant,
} from './button';

@Component({
  imports: [Button],
  template: `<button
    crButton
    [variant]="variant()"
    [size]="size()"
    [shape]="shape()"
    [tone]="tone()"
    [loading]="loading()"
  >
    Book now
  </button>`,
})
class ButtonHost {
  readonly variant = signal<ButtonVariant>('primary');
  readonly size = signal<ButtonSize>('regular');
  readonly shape = signal<ButtonShape>('rounded');
  readonly tone = signal<ButtonTone>('neutral');
  readonly loading = signal(false);
}

describe('Button', () => {
  let fixture: ComponentFixture<ButtonHost>;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonHost],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonHost);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button');
  });

  it('attaches to the real native <button> the caller wrote, rather than creating a wrapper element', () => {
    expect(button.tagName).toBe('BUTTON');
  });

  it('defaults to the primary variant, regular size, and rounded shape', () => {
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(button.getAttribute('data-size')).toBe('regular');
    expect(button.getAttribute('data-shape')).toBe('rounded');
  });

  it('reflects a bound variant/size/shape input as a data-attribute', () => {
    fixture.componentInstance.variant.set('destructive');
    fixture.componentInstance.size.set('extraLarge');
    fixture.componentInstance.shape.set('pill');
    fixture.detectChanges();
    expect(button.getAttribute('data-variant')).toBe('destructive');
    expect(button.getAttribute('data-size')).toBe('extraLarge');
    expect(button.getAttribute('data-shape')).toBe('pill');
  });

  it('supports the accent variant, distinct from primary', () => {
    fixture.componentInstance.variant.set('accent');
    fixture.detectChanges();
    expect(button.getAttribute('data-variant')).toBe('accent');
  });

  it('supports the outline variant (transparent background, visible border)', () => {
    fixture.componentInstance.variant.set('outline');
    fixture.detectChanges();
    expect(button.getAttribute('data-variant')).toBe('outline');
  });

  it('defaults to the neutral tone, and reflects a bound danger tone as a data-attribute', () => {
    expect(button.getAttribute('data-tone')).toBe('neutral');

    fixture.componentInstance.tone.set('danger');
    fixture.detectChanges();
    expect(button.getAttribute('data-tone')).toBe('danger');
  });

  it('exposes a state-layer element for the alpha hover/press overlay, sitting above the label', () => {
    const stateLayer = button.querySelector('.cr-button__state-layer');
    expect(stateLayer).not.toBeNull();
    expect(stateLayer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks itself aria-busy and aria-disabled while loading, and clears both otherwise', () => {
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);

    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('blocks click activation while loading, guarding against a double-submit', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('allows click activation once loading clears', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the native disabled attribute fully under the caller's control", () => {
    button.disabled = true;
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
  });
});
