import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiVisuallyHiddenDirective } from './visually-hidden.directive';

@Component({
  imports: [UiVisuallyHiddenDirective],
  template: `<h2 uiVisuallyHidden>Section heading</h2>`,
})
class HostComponent {}

describe('UiVisuallyHiddenDirective', () => {
  it('stamps the static data-visually-hidden attribute', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<HostComponent> =
      TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('h2');
    expect(el.hasAttribute('data-visually-hidden')).toBe(true);
    expect(el.textContent).toContain('Section heading');
  });
});
