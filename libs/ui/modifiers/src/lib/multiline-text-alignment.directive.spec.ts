import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  UiMultilineTextAlignmentDirective,
  type UiTextAlignment,
} from './multiline-text-alignment.directive';

@Component({
  imports: [UiMultilineTextAlignmentDirective],
  template: `<p data-testid="bound" [uiMultilineTextAlignment]="alignment()">
      wrapped copy
    </p>
    <p data-testid="static" uiMultilineTextAlignment="center">wrapped copy</p>
    <p data-testid="default" uiMultilineTextAlignment>wrapped copy</p>`,
})
class HostComponent {
  alignment = signal<UiTextAlignment>('trailing');
}

describe('UiMultilineTextAlignmentDirective', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('writes the alignment as data-text-alignment, never as a class', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bound"]',
    );
    expect(el.getAttribute('data-text-alignment')).toBe('trailing');
    expect(el.className).toBe('');
  });

  it('tracks the bound value', async () => {
    const fixture = await render();
    fixture.componentInstance.alignment.set('center');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="bound"]')
        .getAttribute('data-text-alignment'),
    ).toBe('center');
  });

  it('accepts the static attribute form and defaults to leading', async () => {
    const fixture = await render();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="static"]')
        .getAttribute('data-text-alignment'),
    ).toBe('center');
    // Bare attribute (no value) leaves the SwiftUI default.
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="default"]')
        .getAttribute('data-text-alignment'),
    ).toBe('leading');
  });
});
