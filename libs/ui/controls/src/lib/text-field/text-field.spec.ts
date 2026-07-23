import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTextField } from './text-field';

@Component({
  imports: [UiTextField],
  template: `<input
    uiTextField
    [uiControlSize]="'large'"
    [uiInvalid]="invalid"
  />`,
})
class HostComponent {
  invalid = false;
}

describe('UiTextField', () => {
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
    expect(el.classList.contains('ui-text-field')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('large');
  });

  it('marks aria-invalid and data-invalid when invalid', () => {
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('input');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('data-invalid')).toBe('');
  });
});
