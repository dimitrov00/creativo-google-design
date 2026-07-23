import { Component, Directive } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPaddingDirective } from './padding.directive';

// Composes UiPaddingDirective via hostDirectives without forwarding its
// input — the shape a control like UiButton uses internally. An unset
// input stamps NO attribute (≙ SwiftUI: no .padding() modifier applied);
// controls own their padding in their own base rule instead of fighting a
// stamped default.
@Directive({
  selector: '[uiTestDefaultPadding]',
  hostDirectives: [UiPaddingDirective],
})
class DefaultPaddingHost {}

@Component({
  imports: [DefaultPaddingHost, UiPaddingDirective],
  template: `<div uiTestDefaultPadding data-testid="default">content</div>
    <div uiPadding data-testid="bare">content</div>
    <div uiPadding [uiPadding]="'loose'" data-testid="bound">content</div>
    <div
      uiPaddingHorizontal="regular"
      uiPaddingVertical="spacious"
      data-testid="edges"
    >
      content
    </div>`,
})
class HostComponent {}

describe('UiPaddingDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('stamps no attribute when no value is bound (no .padding() modifier)', () => {
    fixture.detectChanges();
    const defaultEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="default"]',
    );
    expect(defaultEl.hasAttribute('data-padding')).toBe(false);
  });

  it('treats the bare attribute as .padding() — the "regular" scale', () => {
    fixture.detectChanges();
    const bareEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bare"]',
    );
    expect(bareEl.getAttribute('data-padding')).toBe('regular');
  });

  it('writes data-padding from the uiPadding input', () => {
    fixture.detectChanges();
    const boundEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bound"]',
    );
    expect(boundEl.getAttribute('data-padding')).toBe('loose');
  });

  it('writes edge attributes from .padding(.horizontal/.vertical) inputs', () => {
    fixture.detectChanges();
    const edgesEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="edges"]',
    );
    expect(edgesEl.getAttribute('data-padding-horizontal')).toBe('regular');
    expect(edgesEl.getAttribute('data-padding-vertical')).toBe('spacious');
    expect(edgesEl.hasAttribute('data-padding')).toBe(false);
  });
});
