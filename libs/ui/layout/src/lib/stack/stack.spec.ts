import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiStack } from './stack';

@Component({
  imports: [UiStack],
  template: `<ui-stack
    [uiAxis]="axis()"
    [uiGap]="'loose'"
    [uiAlign]="'center'"
    data-testid="stack"
    >content</ui-stack
  >`,
})
class HostComponent {
  axis = signal<'horizontal' | 'vertical' | 'z'>('horizontal');
}

describe('UiStack', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes axis/gap/align as data-* attributes, never as classes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="stack"]',
    );
    expect(el.classList.contains('ui-stack')).toBe(true);
    expect(el.getAttribute('data-axis')).toBe('horizontal');
    expect(el.getAttribute('data-gap')).toBe('loose');
    expect(el.getAttribute('data-align')).toBe('center');
  });

  it('defaults to the "vertical" axis', () => {
    fixture.componentInstance.axis.set('vertical');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="stack"]',
    );
    expect(el.getAttribute('data-axis')).toBe('vertical');
  });

  it('updates data-axis when the axis signal changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.axis.set('z');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="stack"]',
    );
    expect(el.getAttribute('data-axis')).toBe('z');
  });
});
