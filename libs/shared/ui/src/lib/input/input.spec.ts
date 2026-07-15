import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Input } from './input';

@Component({
  imports: [Input],
  template: `<input crInput [invalid]="invalid()" [errorId]="errorId()" />`,
})
class InputHost {
  readonly invalid = signal(false);
  readonly errorId = signal<string | undefined>(undefined);
}

describe('Input', () => {
  let fixture: ComponentFixture<InputHost>;
  let input: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputHost],
    }).compileComponents();

    fixture = TestBed.createComponent(InputHost);
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input');
  });

  it('attaches to the real native <input> the caller wrote', () => {
    expect(input.tagName).toBe('INPUT');
  });

  it('exposes an invalid state via both a data-attribute and aria-invalid', () => {
    fixture.componentInstance.invalid.set(true);
    fixture.detectChanges();
    expect(input.hasAttribute('data-invalid')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('has no aria-describedby by default, and reflects a bound errorId once set', () => {
    fixture.detectChanges();
    expect(input.hasAttribute('aria-describedby')).toBe(false);

    fixture.componentInstance.errorId.set('promo-code-error');
    fixture.detectChanges();
    expect(input.getAttribute('aria-describedby')).toBe('promo-code-error');
  });

  it('leaves native input behaviors (type, value, placeholder) fully under caller control', () => {
    input.type = 'email';
    input.placeholder = 'you@example.com';
    fixture.detectChanges();
    expect(input.type).toBe('email');
    expect(input.placeholder).toBe('you@example.com');
  });
});
