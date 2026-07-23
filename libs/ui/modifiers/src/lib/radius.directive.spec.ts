import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiRadiusDirective } from './radius.directive';

@Component({
  imports: [UiRadiusDirective],
  template: `<div uiRadius [uiRadius]="radius">content</div>`,
})
class HostComponent {
  radius: 'hero' | 'capsule' = 'capsule';
}

describe('UiRadiusDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes data-radius from the uiRadius input', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-radius')).toBe('capsule');
  });

  it('accepts the marketing set-piece "hero" tier', () => {
    fixture.componentInstance.radius = 'hero';
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('div');
    expect(el.getAttribute('data-radius')).toBe('hero');
  });
});
