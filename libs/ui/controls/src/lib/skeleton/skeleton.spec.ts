import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSkeleton } from './skeleton';

@Component({
  imports: [UiSkeleton],
  template: `<ui-skeleton
    [uiAnimation]="animation()"
    [uiRadius]="'capsule'"
  />`,
})
class HostComponent {
  readonly animation = signal<'shimmer' | 'pulse' | 'none'>('shimmer');
}

describe('UiSkeleton', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes animation as a data-* attribute and is aria-hidden', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-skeleton');
    expect(el.classList.contains('ui-skeleton')).toBe(true);
    expect(el.getAttribute('data-animation')).toBe('shimmer');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards uiRadius to UiRadiusDirective as data-radius', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-skeleton');
    expect(el.getAttribute('data-radius')).toBe('capsule');
  });

  it('updates data-animation when the input changes', async () => {
    fixture.detectChanges();
    fixture.componentInstance.animation.set('none');
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-skeleton');
    expect(el.getAttribute('data-animation')).toBe('none');
  });
});
