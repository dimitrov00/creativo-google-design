import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSheet } from './sheet';

@Component({
  imports: [UiSheet],
  template: `<ui-sheet
    [uiOpen]="open()"
    [uiPlacement]="'end'"
    data-testid="sheet"
    >content</ui-sheet
  >`,
})
class HostComponent {
  open = signal(false);
}

describe('UiSheet', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes placement as a data-* attribute and role="dialog", omitting data-open/aria-modal by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.classList.contains('ui-sheet')).toBe(true);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('data-placement')).toBe('end');
    expect(el.getAttribute('data-open')).toBeNull();
    expect(el.getAttribute('aria-modal')).toBeNull();
  });

  it('writes data-open and aria-modal="true" when uiOpen is true', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.getAttribute('data-open')).toBe('');
    expect(el.getAttribute('aria-modal')).toBe('true');
  });

  it('projects content inside a .ui-sheet__surface wrapper', () => {
    fixture.detectChanges();
    const surface: HTMLElement =
      fixture.nativeElement.querySelector('.ui-sheet__surface');
    expect(surface).toBeTruthy();
    expect(surface.textContent?.trim()).toBe('content');
  });
});
