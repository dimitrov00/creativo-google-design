import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiFrameDirective } from './frame.directive';

@Component({
  imports: [UiFrameDirective],
  template: `<div uiFrame [uiFrameWidth]="'120px'" [uiFrameHeight]="'40px'">
    content
  </div>`,
})
class HostComponent {}

@Component({
  imports: [UiFrameDirective],
  template: `<div uiFrame [uiFrameMaxWidth]="'var(--sys-container-content)'">
    content
  </div>`,
})
class MaxWidthHostComponent {}

@Component({
  imports: [UiFrameDirective],
  template: `<button uiFrame uiFrameMaxWidth="infinity">content</button>`,
})
class InfinityHostComponent {}

describe('UiFrameDirective', () => {
  it('writes inline-size/block-size from the width/height inputs', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<HostComponent> =
      TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.style.getPropertyValue('inline-size')).toBe('120px');
    expect(el.style.getPropertyValue('block-size')).toBe('40px');
    expect(el.style.getPropertyValue('max-inline-size')).toBe('');
    expect(el.style.getPropertyValue('margin-inline')).toBe('');
  });

  it('writes a centered max-width column from uiFrameMaxWidth', async () => {
    await TestBed.configureTestingModule({
      imports: [MaxWidthHostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<MaxWidthHostComponent> =
      TestBed.createComponent(MaxWidthHostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.style.getPropertyValue('max-inline-size')).toBe(
      'var(--sys-container-content)',
    );
    expect(el.style.getPropertyValue('inline-size')).toBe('100%');
    expect(el.style.getPropertyValue('margin-inline')).toBe('auto');
  });

  it('fills without a cap for uiFrameMaxWidth="infinity" (.frame(maxWidth: .infinity))', async () => {
    await TestBed.configureTestingModule({
      imports: [InfinityHostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<InfinityHostComponent> =
      TestBed.createComponent(InfinityHostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.style.getPropertyValue('inline-size')).toBe('100%');
    expect(el.style.getPropertyValue('max-inline-size')).toBe('');
    expect(el.style.getPropertyValue('margin-inline')).toBe('');
  });
});
