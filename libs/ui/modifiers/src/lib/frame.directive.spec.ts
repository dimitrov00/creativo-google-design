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
  });
});
