import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTestI18n } from '../../test-i18n.providers';
import { LandingHeroComponent } from './landing-hero.component';

describe('LandingHeroComponent', () => {
  beforeEach(() => {
    // jsdom's HTMLMediaElement has no real playback engine.
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  });

  it('renders the inset video hero with the booking CTA', async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHeroComponent],
      providers: [...provideTestI18n(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(LandingHeroComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-testid')).toBe('landing-hero');

    // The film card: autoplaying, muted, looping (poster path is the v2 one).
    const video = host.querySelector<HTMLVideoElement>('video.cr-hero__video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('autoplay')).toBe(true);
    expect(video?.hasAttribute('muted')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.getAttribute('poster')).toBe('/work/landing-poster.jpg');

    // Overlay copy + prefs chips render inside the card.
    expect(host.querySelector('.cr-hero__heading')).not.toBeNull();
    expect(host.querySelector('cr-locale-theme-toggle')).not.toBeNull();

    // The primary CTA under the card routes into auth → /book.
    const cta = host.querySelector<HTMLAnchorElement>(
      '[data-testid="landing-hero-cta"]',
    );
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute('href')).toContain('/auth');
    expect(cta?.querySelector('button[uiButton]')).not.toBeNull();
  });
});
