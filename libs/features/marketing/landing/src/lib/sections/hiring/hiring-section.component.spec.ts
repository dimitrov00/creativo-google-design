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

    expect(host.querySelector('.cr-hiring__eyebrow')?.textContent).toContain(
      'Кариери',
    );

    // "Работи с нас." → three word spans, layout-spaced (v2 WordReveal).
    const words = Array.from(
      host.querySelectorAll<HTMLElement>('.cr-hiring__word'),
    );
    expect(words.map((word) => word.textContent)).toEqual([
      'Работи',
      'с',
      'нас.',
    ]);

    expect(host.querySelector('.cr-hiring__subtitle')?.textContent).toContain(
      'занаятът',
    );
    expect(host.querySelector('.cr-hiring__cta')?.textContent).toContain(
      'Виж отворените позиции',
    );

    const video = host.querySelector<HTMLVideoElement>('.cr-hiring__video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('autoplay')).toBe(true);
    expect(video?.getAttribute('poster')).toBe('/work/landing-poster.jpg');

    // The static treatment layers exist (shade, warmth, grain).
    expect(host.querySelector('.cr-hiring__shade')).not.toBeNull();
    expect(host.querySelector('.cr-hiring__warmth')).not.toBeNull();
    expect(host.querySelector('.cr-hiring__grain')).not.toBeNull();
  });
});
