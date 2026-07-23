import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiRating } from './rating';

@Component({
  imports: [UiRating],
  template: `<ui-rating data-testid="rating" [uiValue]="value()"
    >(128)</ui-rating
  >`,
})
class HostComponent {
  value = signal(4.9);
}

describe('UiRating', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders the star glyph as hidden decoration and the value as text', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="rating"]',
    );
    expect(el.classList.contains('ui-rating')).toBe(true);
    const star = el.querySelector('.ui-rating__star');
    expect(star?.getAttribute('aria-hidden')).toBe('true');
    expect(star?.textContent).toBe('star');
    expect(el.querySelector('.ui-rating__value')?.textContent).toBe('4.9');
  });

  it('projects trailing label content after the value and tracks value changes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="rating"]',
    );
    expect(el.textContent).toContain('(128)');
    fixture.componentInstance.value.set(5);
    fixture.detectChanges();
    expect(el.querySelector('.ui-rating__value')?.textContent).toBe('5');
  });
});
