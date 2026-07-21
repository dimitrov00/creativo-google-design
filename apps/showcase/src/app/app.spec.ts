import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the shell nav and mounts the cursor dot exactly once', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('nav a').length).toBe(2);
    expect(host.querySelectorAll('cr-cursor-dot').length).toBe(1);
    expect(
      host.querySelector('[data-testid="design-system-toggles"]'),
    ).not.toBeNull();
  });
});
