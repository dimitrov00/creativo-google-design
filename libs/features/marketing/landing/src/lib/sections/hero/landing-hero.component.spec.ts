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

    // The film card is the DS ambient-video primitive (poster/crossfade/
    // reduced-motion contract lives there, not in the hero).
    const media = host.querySelector('ui-ambient-video');
    expect(media).not.toBeNull();
    const poster = media?.querySelector<HTMLImageElement>(
      'img.ui-ambient-video__poster',
    );
    expect(poster?.getAttribute('src')).toBe('/work/landing-poster.jpg');
    const video = media?.querySelector<HTMLVideoElement>(
      'video.ui-ambient-video__video',
    );
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('muted')).toBe(true);
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.getAttribute('src')).toBe('/hero.mp4');

    // Copy trio rides the sanctioned section-header pattern on the white
    // on-media ramp; prefs chips render inside the card.
    const header = host.querySelector('ui-section-header');
    expect(header?.hasAttribute('data-on-media')).toBe(true);
    expect(header?.querySelector('h1[uiTitle]')).not.toBeNull();
    expect(host.querySelector('cr-locale-theme-toggle')).not.toBeNull();

    // The primary CTA (shared booking chord) routes into auth → /book.
    const cta = host.querySelector<HTMLAnchorElement>(
      '[data-testid="landing-hero-cta"]',
    );
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute('href')).toContain('/auth');
    // The anchor IS the button (a[uiButton]) — no pointer-events:none
    // wrapper, so hover/press/focus land on the real interactive element.
    expect(cta?.classList.contains('ui-button')).toBe(true);
    // Prominent tier (52px) — the matched opening/closing chord size.
    expect(cta?.getAttribute('data-size')).toBe('prominent');
    expect(cta?.hasAttribute('data-on-media')).toBe(true);
  });
});
