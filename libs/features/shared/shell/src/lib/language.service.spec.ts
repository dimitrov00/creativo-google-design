import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { LanguageService } from './language.service';

function configure(): TranslocoService {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { bg: {}, en: {} },
        translocoConfig: { availableLangs: ['bg', 'en'], defaultLang: 'bg' },
      }),
    ],
  });
  return TestBed.inject(TranslocoService);
}

describe('LanguageService', () => {
  it('keeps the language bootstrap chose — constructing it changes nothing', () => {
    const transloco = configure();
    transloco.setActiveLang('en');
    const emitted: string[] = [];
    transloco.langChanges$.subscribe((lang) => emitted.push(lang));

    const language = TestBed.inject(LanguageService);

    expect(language.activeLang()).toBe('en');
    expect(transloco.getActiveLang()).toBe('en');
    // Only the subscription's own replay: the service emitted no change.
    expect(emitted).toEqual(['en']);
  });

  it('switches the active language and reads it back', () => {
    const transloco = configure();
    const language = TestBed.inject(LanguageService);

    language.set('en');

    expect(transloco.getActiveLang()).toBe('en');
    expect(language.activeLang()).toBe('en');
  });

  it('tracks a language set elsewhere', () => {
    const transloco = configure();
    const language = TestBed.inject(LanguageService);

    transloco.setActiveLang('en');
    expect(language.activeLang()).toBe('en');
    transloco.setActiveLang('bg');
    expect(language.activeLang()).toBe('bg');
  });
});
