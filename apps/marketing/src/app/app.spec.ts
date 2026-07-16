import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideTestI18n } from './test-i18n.providers';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), ...provideTestI18n()],
    }).compileComponents();
  });

  it('renders the shell nav and mounts the cursor dot exactly once', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('nav a').length).toBe(3);
    expect(host.querySelectorAll('cr-cursor-dot').length).toBe(1);
    expect(host.querySelector('.cr-shell__cta')?.textContent).toContain(
      'Запази час',
    );
  });
});
