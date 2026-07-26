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
