import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTextDirective } from './text.directive';

@Component({
  imports: [UiTextDirective],
  template: `<h2
    uiText
    [uiFont]="'title'"
    [uiWeight]="'bold'"
    [uiForeground]="'accent'"
  >
    Upcoming
  </h2>`,
})
class HostComponent {}

describe('UiTextDirective', () => {
  it('composes UiFont/UiWeight/UiForeground via hostDirectives', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    const fixture: ComponentFixture<HostComponent> =
      TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('h2');
    expect(el.getAttribute('data-font')).toBe('title');
    expect(el.getAttribute('data-weight')).toBe('bold');
    expect(el.getAttribute('data-foreground')).toBe('accent');
  });
});
