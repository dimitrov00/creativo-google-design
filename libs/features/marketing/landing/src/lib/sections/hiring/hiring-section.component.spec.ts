import { EnvironmentProviders, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { HiringSectionComponent } from './hiring-section.component';

const bg: Translation = {
  landing: {
    hiring: {
      eyebrow: 'Кариери',
      title: 'Работи с нас.',
      subtitle: 'Няколко места за хора, за които занаятът има значение.',
      cta: 'Виж отворените позиции',
    },
  },
};

@Injectable()
class HiringTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

function provideHiringI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: HiringTranslationLoader,
  });
}

describe('HiringSectionComponent', () => {
  beforeEach(() => {
    // Ambient card video — jsdom has no media pipeline.
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    });
  });

  it('renders the careers card: eyebrow, word-split headline, subtitle, CTA, video', async () => {
    await TestBed.configureTestingModule({
      imports: [HiringSectionComponent],
      providers: [...provideHiringI18n()],
    }).compileComponents();

    const fixture = TestBed.createComponent(HiringSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;

    // Eyebrow/lede ride the ui-section-header slots now.
    expect(host.querySelector('[uieyebrow]')?.textContent).toContain('Кариери');

    // "Работи с нас." → three word spans, layout-spaced (v2 WordReveal).
    const words = Array.from(
      host.querySelectorAll<HTMLElement>('.cr-hiring__word'),
    );
    expect(words.map((word) => word.textContent)).toEqual([
      'Работи',
      'с',
      'нас.',
    ]);

    expect(host.querySelector('[uilede]')?.textContent).toContain('занаятът');
    expect(host.querySelector('.cr-hiring__cta')?.textContent).toContain(
      'Виж отворените позиции',
    );

    // Ambient media is ui-ambient-video now: poster img + internally
    // driven (play() is imperative — no autoplay content attribute).
    const ambient = host.querySelector('ui-ambient-video.cr-hiring__video');
    expect(ambient).not.toBeNull();
    expect(
      ambient?.querySelector('.ui-ambient-video__poster')?.getAttribute('src'),
    ).toBe('/work/landing-poster.jpg');
    expect(
      ambient?.querySelector<HTMLVideoElement>('video')?.getAttribute('src'),
    ).toBe('/welcome.mp4');

    // The static treatment layers exist (scrim overlay, warmth, grain).
    expect(host.querySelector('[data-overlay="scrim-media"]')).not.toBeNull();
    expect(host.querySelector('.cr-hiring__warmth')).not.toBeNull();
    expect(host.querySelector('.cr-hiring__grain')).not.toBeNull();
  });
});
