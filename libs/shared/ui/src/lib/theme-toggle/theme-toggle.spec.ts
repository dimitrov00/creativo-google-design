import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  let fixture: ComponentFixture<ThemeToggle>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ThemeToggle],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeToggle);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders a single accessible toggle button', () => {
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Toggle color theme');
  });

  it('flips aria-pressed and document.documentElement[data-theme] on click', () => {
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');
    const before = document.documentElement.dataset['theme'];

    button.click();
    fixture.detectChanges();

    const after = document.documentElement.dataset['theme'];
    expect(after).not.toBe(before);
    expect(button.getAttribute('aria-pressed')).toBe(String(after === 'dark'));
  });
});
