import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiScrollRow } from './scroll-row';

@Component({
  imports: [UiScrollRow],
  template: `<ui-scroll-row
    [uiSnap]="snap()"
    [uiGap]="'compact'"
    [uiFullBleed]="fullBleed()"
    data-testid="scroll-row"
    >content</ui-scroll-row
  >`,
})
class HostComponent {
  snap = signal<'none' | 'start' | 'center'>('start');
  fullBleed = signal(false);
}

describe('UiScrollRow', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes snap/gap as data-* attributes and omits data-full-bleed by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.classList.contains('ui-scroll-row')).toBe(true);
    expect(el.getAttribute('data-snap')).toBe('start');
    expect(el.getAttribute('data-gap')).toBe('compact');
    expect(el.getAttribute('data-full-bleed')).toBeNull();
  });

  it('updates data-snap when the snap signal changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.snap.set('center');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.getAttribute('data-snap')).toBe('center');
  });

  it('writes data-full-bleed as an empty-string attribute when uiFullBleed is true', () => {
    fixture.componentInstance.fullBleed.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="scroll-row"]',
    );
    expect(el.getAttribute('data-full-bleed')).toBe('');
  });
});
