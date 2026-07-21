import { Component, Directive } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPaddingDirective } from './padding.directive';

// Composes UiPaddingDirective via hostDirectives without forwarding its
// input — the shape a control like UiButton uses internally, and the only
// way to observe the directive's own default ('regular') rather than an
// Angular static-attribute binding (a bare `uiPadding` attribute in a
// template binds the input to `""`, not "unset").
@Directive({
  selector: '[uiTestDefaultPadding]',
  hostDirectives: [UiPaddingDirective],
})
class DefaultPaddingHost {}

@Component({
  imports: [DefaultPaddingHost, UiPaddingDirective],
  template: `<div uiTestDefaultPadding data-testid="default">content</div>
    <div uiPadding [uiPadding]="'loose'" data-testid="bound">content</div>`,
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

  it('defaults to the "regular" scale when no value is bound', () => {
    fixture.detectChanges();
    const defaultEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="default"]',
    );
    expect(defaultEl.getAttribute('data-padding')).toBe('regular');
  });

  it('writes data-padding from the uiPadding input', () => {
    fixture.detectChanges();
    const boundEl: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bound"]',
    );
    expect(boundEl.getAttribute('data-padding')).toBe('loose');
  });
});
