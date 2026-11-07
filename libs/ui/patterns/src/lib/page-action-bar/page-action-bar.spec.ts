import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPageActionBar } from './page-action-bar';

@Component({
  imports: [UiPageActionBar],
  template: `<ui-page-action-bar data-testid="bar">
    <button type="button" data-testid="secondary">Skip</button>
    <button
      type="button"
      data-testid="primary"
      data-button-style="borderedProminent"
    >
      Continue
    </button>
  </ui-page-action-bar>`,
})
class HostComponent {}

describe('UiPageActionBar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function bar(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="bar"]');
  }

  it('writes the identity class and projects controls', () => {
    expect(bar().classList.contains('ui-page-action-bar')).toBe(true);
    expect(
      bar().querySelector('[data-testid="primary"]')?.textContent,
    ).toContain('Continue');
  });

  it('keeps projection order — CSS docks the prominent primary trailing', () => {
    // Leading/trailing composition is a CSS contract (margin-inline-start:
    // auto on the primary selector, shared with ui-sheet-action-bar); the
    // spec pins the contract's INPUT: order + the primary marker.
    const buttons = bar().querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('data-testid')).toBe('secondary');
    expect(buttons[1]?.getAttribute('data-button-style')).toBe(
      'borderedProminent',
    );
  });

  it('stays fully visible to assistive tech — pages never hide their bar', () => {
    expect(bar().getAttribute('aria-hidden')).toBeNull();
  });
});

@Component({
  imports: [UiPageActionBar],
  template: `<ui-page-action-bar data-testid="bar" [uiAvoidsKeyboard]="true">
    <input data-testid="field" />
  </ui-page-action-bar>`,
})
class KeyboardHostComponent {}

describe('UiPageActionBar · riding the keyboard', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  afterEach(() => {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
  });

  it('publishes what the visual viewport lost as the keyboard inset, and says it rides it', async () => {
    const listeners: Record<string, () => void> = {};
    const viewport = {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    await TestBed.configureTestingModule({
      imports: [KeyboardHostComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeyboardHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const bar: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bar"]',
    );
    expect(bar.hasAttribute('data-avoids-keyboard')).toBe(true);
    expect(bar.style.getPropertyValue('--ui-keyboard-inset')).toBe('0px');
    viewport.height = window.innerHeight - 300;
    listeners['resize']?.();
    expect(bar.style.getPropertyValue('--ui-keyboard-inset')).toBe('300px');
  });
});
