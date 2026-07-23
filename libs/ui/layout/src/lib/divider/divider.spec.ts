import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiDivider } from './divider';

@Component({
  imports: [UiDivider],
  template: `<ui-divider
    [uiOrientation]="orientation()"
    [uiInset]="inset()"
    data-testid="divider"
  />`,
})
class HostComponent {
  orientation = signal<'horizontal' | 'vertical'>('horizontal');
  inset = signal(false);
}

describe('UiDivider', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes the identity class, separator role and horizontal defaults, omitting data-inset', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="divider"]',
    );
    expect(el.classList.contains('ui-divider')).toBe(true);
    expect(el.getAttribute('role')).toBe('separator');
    expect(el.getAttribute('aria-orientation')).toBe('horizontal');
    expect(el.getAttribute('data-orientation')).toBe('horizontal');
    expect(el.getAttribute('data-inset')).toBeNull();
  });

  it('writes data-orientation and aria-orientation when vertical', () => {
    fixture.componentInstance.orientation.set('vertical');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="divider"]',
    );
    expect(el.getAttribute('data-orientation')).toBe('vertical');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('writes data-inset as an empty-string attribute when uiInset is true', () => {
    fixture.componentInstance.inset.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="divider"]',
    );
    expect(el.getAttribute('data-inset')).toBe('');
  });
});
