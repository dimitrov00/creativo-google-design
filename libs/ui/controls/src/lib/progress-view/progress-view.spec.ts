import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiProgressView } from './progress-view';

@Component({
  imports: [UiProgressView],
  template: `<ui-progress-view [uiControlSize]="'small'" />`,
})
class HostComponent {}

describe('UiProgressView', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute and exposes a status role', () => {
    fixture.detectChanges();
    const el: HTMLElement =
      fixture.nativeElement.querySelector('ui-progress-view');
    expect(el.classList.contains('ui-progress-view')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('small');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toBe('Loading');
  });
});
