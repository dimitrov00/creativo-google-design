import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSheetActionBar } from './sheet-action-bar';

@Component({
  imports: [UiSheetActionBar],
  template: `<ui-sheet-action-bar data-testid="bar" [uiVisible]="visible()">
    <button type="button" data-testid="secondary">Call</button>
    <button type="button" data-testid="primary" data-spread>Book now</button>
  </ui-sheet-action-bar>`,
})
class HostComponent {
  visible = signal(false);
}

describe('UiSheetActionBar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('is hidden from assistive tech and unstamped while not visible', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bar"]',
    );
    expect(el.classList.contains('ui-sheet-action-bar')).toBe(true);
    expect(el.getAttribute('data-visible')).toBeNull();
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('is chromeless — no material stamp; projected controls carry surfaces', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bar"]',
    );
    expect(el.getAttribute('data-material')).toBeNull();
  });

  it('stamps data-visible and drops aria-hidden when revealed, projecting controls', () => {
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bar"]',
    );
    expect(el.getAttribute('data-visible')).toBe('');
    expect(el.getAttribute('aria-hidden')).toBeNull();
    expect(el.querySelector('button')?.textContent).toBe('Call');
  });

  it('projects controls in order — CSS docks the [data-spread] primary trailing', () => {
    // Leading/trailing composition is a CSS contract (margin-inline-start:
    // auto on the primary selector); the DOM keeps projection order so the
    // spec pins the contract's INPUT: order + the primary marker attribute.
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="bar"]',
    );
    const buttons = el.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('data-testid')).toBe('secondary');
    expect(buttons[1]?.hasAttribute('data-spread')).toBe(true);
  });
});
