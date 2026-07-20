import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';

const bg: Translation = {
  marketing: {
    app: {
      homeAria: 'Начало на Creativo',
      primaryNav: 'Основна навигация',
      work: 'Визии',
      services: 'Услуги',
      barbers: 'Барбъри',
      locations: 'Локации',
      book: 'Запази час',
      login: 'Вход',
      toggleMenu: 'Отвори или затвори менюто',
      language: 'Език',
    },
    hero: {
      eyebrow: 'Независимо барбър студио',
      titleA: 'Визия,',
      titleB: 'която остава.',
      intro: 'Прецизна форма и премерен детайл.',
      videoAria: 'Видео от Creativo',
      play: 'Пусни',
      pause: 'Пауза',
      playVideo: 'Пусни видеото',
      pauseVideo: 'Спри видеото',
      book: 'Запази своя стол',
    },
    servicesPage: {
      eyebrow: 'Creativo · пълното меню',
      titleA: 'Избери',
      titleB: 'посоката.',
      intro: 'Избираме заедно формата и детайла.',
      indexEyebrow: 'Шест начина да започнем',
      indexTitle: 'Твоят образ, разгледан отблизо.',
      labels: {
        shape: 'Форма и баланс',
        gradient: 'Преход и геометрия',
        contour: 'Линия и грижа',
        complete: 'Цялостна визия',
        movement: 'Текстура и движение',
        finish: 'Подготовка и финал',
      },
      finalEyebrow: 'Знаеш накъде',
      finalTitle: 'Остави останалото на нас.',
      finalCta: 'Запази своя стол',
    },
  },
};

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

export function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}
