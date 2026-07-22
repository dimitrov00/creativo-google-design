import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';

/** Mirrors the `landing` namespace of the real bg.json — the strings the
 *  landing components render in specs (kept in sync with v2's key tree). */
const bg: Translation = {
  landing: {
    nav: {
      login: 'Вход',
      menu: 'Меню',
      primary: 'Навигация',
      locale: 'Смени език',
      theme: 'Смени тема',
      close: 'Затвори',
    },
    menu: {
      account: 'Акаунт',
      bookings: 'Моите резервации',
      rewards: 'Моите награди',
      openPositions: 'Отворени позиции',
    },
    prefs: {
      language: 'Език',
      localeCode: 'БГ',
      switchToLight: 'Светла тема',
      switchToDark: 'Тъмна тема',
    },
    hero: {
      tagline: 'MALE IMAGE & GROOMING · СТАРА ЗАГОРА',
      heading: 'Твоят стол.',
      subtitle: 'Резервирай час за секунди.\nБез обаждане.',
      cta: 'Запази час',
    },
    gallery: {
      c0: 'Прецизна подрезка.',
      c1: 'Модерна текстура.',
      c2: 'Класически конус.',
      c3: 'Определящият фейд.',
      c4: 'Бръснене наблизо.',
      c5: 'Финалният щрих.',
    },
    barbers: {
      eyebrow: 'Екипът',
      title: 'Ръце, на които може да разчиташ.',
      subtitle: 'Всеки бръснар — своят занаят и свой стол.',
      years: 'год.',
      viewAll: 'Покажи още {{count}}',
    },
    services: {
      eyebrow: 'Услугите',
      title: 'Прецизна работа.',
      subtitle:
        'Всяка услуга е на цена по бръснар — избери занаята и кой го прави.',
      bundlesTitle: 'Пакети',
      bundle: 'Пакет',
      from: 'от',
      durationLabel: 'мин',
      book: 'Запази тази услуга',
      variantsLabel: 'Опции',
      includesLabel: 'Включва',
      whoLabel: 'Кой и цена',
      allBarbers: 'Всички бръснари',
      nBarbers: '{{count}} бръснари',
      goToPhoto: 'Снимка {{index}}',
    },
    location: {
      eyebrow: 'Намери ни',
      title: 'Един адрес.',
      titleMulti: 'Нашите локации.',
      open: 'Отворено',
      openUntil: 'Отворено до {{time}}',
      closed: 'Затворено',
      hoursLabel: 'Работно време',
      closedDay: 'Почивен',
      directions: 'Маршрут',
      call: 'Обади се',
    },
    closing: {
      heading: 'Винаги има стол, който те чака.',
      subtitle: 'Резервирай за секунди. Без опашка, без обаждане.',
      cta: 'Запази мястото си',
    },
    hiring: {
      eyebrow: 'Кариери',
      title: 'Работи с нас.',
      subtitle: 'Няколко места за хора, за които занаятът има значение.',
      cta: 'Виж отворените позиции',
    },
    footer: {
      rights: 'Всички права запазени.',
      cols: { explore: 'Разгледай', visit: 'Посети ни', connect: 'Свържи се' },
      nav: {
        work: 'Нашата работа',
        team: 'Екип',
        services: 'Услуги',
        careers: 'Кариери',
        visit: 'Посети ни',
      },
      links: {
        directions: 'Упътвания',
        call: 'Обади се',
        hours: 'Работно време',
        instagram: 'Instagram',
        book: 'Резервирай',
        login: 'Вход',
        account: 'Моят профил',
      },
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
