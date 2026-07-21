import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSpinner } from './spinner';

@Component({
  imports: [UiSpinner],
  template: `<ui-spinner [uiSize]="'compact'" />`,
})
class HostComponent {}

describe('UiSpinner', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute and exposes a status role', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-spinner');
    expect(el.classList.contains('ui-spinner')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('compact');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toBe('Loading');
  });
});
