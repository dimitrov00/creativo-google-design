import { Component, Directive } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiWeightDirective } from './weight.directive';

// Composes UiWeightDirective via hostDirectives without forwarding its
// input — the only way to observe "genuinely unbound" rather than an
// Angular static-attribute binding (a bare `uiWeight` attribute in a
// template binds the input to `""`, not "unset" — see padding.directive.spec.ts).
@Directive({
  selector: '[uiTestUnsetWeight]',
  hostDirectives: [UiWeightDirective],
})
class UnsetWeightHost {}

@Component({
  imports: [UnsetWeightHost, UiWeightDirective],
  template: `<span uiWeight [uiWeight]="'bold'" data-testid="bound">text</span>
    <span uiTestUnsetWeight data-testid="unset">text</span>`,
})
class HostComponent {}

describe('UiWeightDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes data-weight from the uiWeight input', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bound"]',
    );
    expect(el.getAttribute('data-weight')).toBe('bold');
  });

  it("omits data-weight when unset, leaving the font role's own baked-in weight", () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="unset"]',
    );
    expect(el.getAttribute('data-weight')).toBeNull();
  });
});
