import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiInput } from './input';

@Component({
  imports: [UiInput],
  template: `<input uiInput [uiSize]="'prominent'" [uiInvalid]="invalid" />`,
})
class HostComponent {
  invalid = false;
}

describe('UiInput', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('input');
    expect(el.classList.contains('ui-input')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('prominent');
  });

  it('marks aria-invalid and data-invalid when invalid', () => {
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('input');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('data-invalid')).toBe('');
  });
});
