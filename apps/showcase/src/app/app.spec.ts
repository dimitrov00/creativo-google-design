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

  it('renders the DS toolbar shell: nav links and preference toggles', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('ui-toolbar')).not.toBeNull();
    expect(host.querySelectorAll('nav a').length).toBe(2);
    expect(
      host.querySelector('[data-testid="design-system-toggles"]'),
    ).not.toBeNull();
  });
});
