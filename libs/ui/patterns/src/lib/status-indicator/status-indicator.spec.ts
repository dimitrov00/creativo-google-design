import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiStatusIndicator } from './status-indicator';

@Component({
  imports: [UiStatusIndicator],
  template: `<ui-status-indicator data-testid="status" [uiTone]="tone()">
    Open
    <span uiDetail>until 20:00</span>
  </ui-status-indicator>`,
})
class HostComponent {
  tone = signal<'success' | 'warning' | 'destructive'>('success');
}

describe('UiStatusIndicator', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes the tone as a data-* attribute and renders a decorative dot', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="status"]',
    );
    expect(el.classList.contains('ui-status-indicator')).toBe(true);
    expect(el.getAttribute('data-tone')).toBe('success');
    const dot = el.querySelector('.ui-status-indicator__dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('projects the label and the [uiDetail] slot, tracking tone changes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="status"]',
    );
    expect(el.textContent).toContain('Open');
    expect(el.querySelector('[uiDetail]')?.textContent).toBe('until 20:00');
    fixture.componentInstance.tone.set('destructive');
    fixture.detectChanges();
    expect(el.getAttribute('data-tone')).toBe('destructive');
  });
});
