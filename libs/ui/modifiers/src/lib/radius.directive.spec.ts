import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiRadiusDirective } from './radius.directive';

@Component({
  imports: [UiRadiusDirective],
  template: `<div uiRadius [uiRadius]="'capsule'">content</div>`,
})
class HostComponent {}

describe('UiRadiusDirective', () => {
  it('writes data-radius from the uiRadius input', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<HostComponent> =
      TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-radius')).toBe('capsule');
  });
});
