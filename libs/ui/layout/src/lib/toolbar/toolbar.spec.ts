import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToolbar } from './toolbar';

@Component({
  imports: [UiToolbar],
  template: `<ui-toolbar [uiSticky]="sticky()" data-testid="toolbar"
    >content</ui-toolbar
  >`,
})
class HostComponent {
  sticky = signal(false);
}

describe('UiToolbar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes the ui-toolbar identity class and omits data-sticky by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="toolbar"]',
    );
    expect(el.classList.contains('ui-toolbar')).toBe(true);
    expect(el.getAttribute('data-sticky')).toBeNull();
  });

  it('writes data-sticky as an empty-string attribute when uiSticky is true', () => {
    fixture.componentInstance.sticky.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="toolbar"]',
    );
    expect(el.getAttribute('data-sticky')).toBe('');
  });
});
