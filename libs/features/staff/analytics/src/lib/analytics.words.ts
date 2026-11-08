import {
  AnalyticsBarPart,
  AnalyticsSpan,
  BookingOrigin,
} from '@core/components';
import { pluralForm } from '@creativo/infrastructure/i18n';
import {
  type SpanWords,
  type VisitTranslate,
  spanCopyOf,
} from '@creativo/features/shared/visits';
import { AnalyticsTopic } from './analytics.vm';

/*
 * THE «АНАЛИЗИ» SCREEN'S WORDS — every key the presenters read, looked up
 * ONCE per language and handed to them as an argument (the client card's
 * `clientCardWordsOf` precedent): a presenter never injects Transloco, and
 * a key the catalogue lacks fails in a spec, never on a screen. A count is a
 * number: its words choose the plural form (`pluralForm`).
 */

type Params = Readonly<Record<string, string | number>>;

/** The screen's words in one language. */
export interface AnalyticsWords {
  readonly lang: string;
  readonly title: string;
  /** A service the catalogue no longer lists. */
  readonly unknownService: string;
  readonly back: string;
  readonly spanLabel: string;
  readonly span: Readonly<Record<AnalyticsSpan, string>>;
  readonly previous: string;
  readonly next: string;
  readonly range: (from: string, to: string) => string;
  /** The «…» pill and the custom-range sheet (staff-analytics-v2 «Sections in order» 3). */
  readonly customRange: {
    readonly pill: string;
    readonly title: string;
    readonly from: string;
    readonly to: string;
    readonly day: string;
    readonly month: string;
    readonly year: string;
    readonly dayPlaceholder: string;
    readonly monthPlaceholder: string;
    readonly yearPlaceholder: string;
    readonly apply: string;
    readonly close: string;
    /** «Въведете двете дати» — a field is empty or partial. */
    readonly incomplete: string;
    /** «Най-рано 1.11.2025» — the range starts before the reach. */
    readonly beforeReach: (earliest: string) => string;
    readonly afterToday: string;
    /** «Най-много 366 дни». */
    readonly tooLong: (days: number) => string;
  };
  /** The comparison chip under the period (staff-analytics-v2 «Sections in order» 3). */
  readonly comparison: {
    /** «спрямо предходния период». */
    readonly previous: string;
    /** «няма данни за сравнение» — the comparison period starts before the reach. */
    readonly none: string;
  };
  readonly scope: {
    readonly label: string;
    readonly shop: string;
    readonly me: string;
    readonly barber: string;
  };
  /** The freshness line (staff-analytics-v2 «Freshness»): how old the figures are, and the ⓘ. */
  readonly freshness: {
    /** «току-що» — under a minute old, or computed on a clock ahead of this one. */
    readonly justNow: string;
    /** «Обновено преди 5 мин» — `age` is `relativeTime(…, 'short')`'s phrase. */
    readonly updatedAgo: (age: string) => string;
    /** «Обновено в 09:12» — an hour or more old, on the same shop day. */
    readonly updatedAt: (time: string) => string;
    /** «Обновено на 27.09, 18:40» — an earlier shop day. */
    readonly updatedOn: (time: string) => string;
    /** The ⓘ: «Цифрите се изчисляват при отваряне от записаните дни». */
    readonly info: string;
    readonly refreshing: string;
    readonly failed: (time: string) => string;
    readonly failedNoCache: string;
    readonly retry: string;
    readonly scopeGone: string;
  };
  readonly empty: {
    readonly title: string;
    readonly rostered: (span: string) => string;
    readonly noRoster: string;
  };
  readonly smallSample: string;
  readonly hero: {
    readonly caption: string;
    readonly versus: string;
    readonly noComparison: string;
    readonly flat: string;
    readonly fromNothing: string;
    readonly tips: string;
    readonly excluded: (count: number) => string;
  };
  readonly time: {
    readonly title: string;
    readonly barName: string;
    readonly part: Readonly<Record<AnalyticsBarPart, string>>;
    readonly ahead: (booked: string, open: string) => string;
    /** «По дни» — the bar's way to its days. */
    readonly byDay: string;
  };
  readonly open: {
    readonly title: string;
    readonly caption: string;
    readonly emptiest: (day: string) => string;
    readonly none: string;
    readonly action: (day: string) => string;
  };
  readonly services: {
    readonly title: string;
    readonly line: (count: string, perHour: string) => string;
    readonly count: (count: number) => string;
    /** «Подстригване · 42,00 € на час» — a ranked bar's word. */
    readonly barLabel: (name: string, perHour: string) => string;
    /** «28,00 € · 1 път» — a ranked bar's figure. */
    readonly barValue: (value: string, count: string) => string;
    readonly none: string;
  };
  readonly clients: {
    readonly title: string;
    readonly ofBase: (count: string, base: string) => string;
  };
  /** The charts' accessible names and legend words (staff-analytics-v2 «Chart kit»). */
  readonly charts: {
    /** «Оборот по дни» — the takings line. */
    readonly line: string;
    /** «средно 14,00 €» — the dashed rule. */
    readonly average: (value: string) => string;
    /** «предходен период» — the grey line. */
    readonly comparison: string;
    /** «Работното време по дни» — the stacked bars. */
    readonly timeBars: string;
    /** «Свободни часове по дни» — the open-hours card's bars. */
    readonly ahead: string;
    /** «Услуги по оборот» — the ranked bars. */
    readonly services: string;
    /** «Записвания по произход» — the origins bar. */
    readonly origins: string;
  };
  /** When the chair is busy — the heatmap and its sentence. */
  readonly busy: {
    readonly title: string;
    /** «Заетост по ден и час» — the heatmap's accessible name. */
    readonly label: string;
    /** «вт в 10:00». */
    readonly at: (day: string, hour: string) => string;
    /** «Най-натоварено: вт в 10:00 · най-спокойно: пн в 17:00». */
    readonly sentence: (busiest: string, emptiest: string) => string;
    /** Under seven rostered days there is no verdict yet. */
    readonly pending: string;
  };
  readonly origins: {
    readonly title: string;
    readonly origin: Readonly<Record<BookingOrigin, string>>;
    readonly visits: (count: number) => string;
  };
  readonly figure: Readonly<Record<AnalyticsTopic, string>>;
  readonly info: {
    readonly label: (figure: string) => string;
    readonly close: string;
    readonly definition: Readonly<Record<AnalyticsTopic, string>>;
  };
  readonly drill: {
    readonly total: string;
    readonly count: (count: number) => string;
    readonly rebookedTotal: (count: string, base: string) => string;
    readonly empty: string;
    readonly seatsLater: string;
    readonly rebookedYes: string;
    readonly rebookedNo: string;
    readonly noShow: string;
    readonly late: string;
    readonly dayLine: (rostered: string, unsold: string) => string;
    readonly barberLine: (worked: string, rostered: string) => string;
    readonly openBarber: (name: string) => string;
  };
  /** «45 мин» · «1 ч» · «6 ч 30 мин» — the schedule's own forms. */
  readonly spanWords: SpanWords;
}

const TOPICS: readonly AnalyticsTopic[] = Object.values(AnalyticsTopic);

/** Every word of the screen from a host's `translate`, read once for `lang`. */
export function analyticsWordsOf(
  translate: VisitTranslate,
  lang: string,
): AnalyticsWords {
  const t = (key: string, params?: Params): string =>
    translate(`staffAnalytics.${key}`, params);
  /** A count's sentence, its plural form chosen by the count. */
  const counted =
    (key: string) =>
    (count: number): string =>
      t(`${key}.${pluralForm(count, lang) === 'one' ? 'one' : 'other'}`, {
        count,
      });
  const byTopic = (prefix: string): Record<AnalyticsTopic, string> => {
    const out = {} as Record<AnalyticsTopic, string>;
    for (const topic of TOPICS) {
      // eslint-disable-next-line security/detect-object-injection -- `topic` is a closed `AnalyticsTopic` literal.
      out[topic] = t(`${prefix}.${topic}`);
    }
    return out;
  };
  return {
    lang,
    title: t('title'),
    unknownService: t('unknownService'),
    back: t('back'),
    spanLabel: t('span.label'),
    span: {
      [AnalyticsSpan.Day]: t('span.DAY'),
      [AnalyticsSpan.Week]: t('span.WEEK'),
      [AnalyticsSpan.Month]: t('span.MONTH'),
      [AnalyticsSpan.Year]: t('span.YEAR'),
      [AnalyticsSpan.Custom]: t('span.CUSTOM'),
    },
    customRange: {
      pill: t('customRange.pill'),
      title: t('customRange.title'),
      from: t('customRange.from'),
      to: t('customRange.to'),
      day: t('customRange.day'),
      month: t('customRange.month'),
      year: t('customRange.year'),
      dayPlaceholder: t('customRange.dayPlaceholder'),
      monthPlaceholder: t('customRange.monthPlaceholder'),
      yearPlaceholder: t('customRange.yearPlaceholder'),
      apply: t('customRange.apply'),
      close: t('customRange.close'),
      incomplete: t('customRange.incomplete'),
      beforeReach: (earliest) => t('customRange.beforeReach', { earliest }),
      afterToday: t('customRange.afterToday'),
      tooLong: (days) => t('customRange.tooLong', { days }),
    },
    previous: t('previous'),
    next: t('next'),
    range: (from, to) => t('range', { from, to }),
    comparison: {
      previous: t('comparison.previous'),
      none: t('comparison.none'),
    },
    scope: {
      label: t('scope.label'),
      shop: t('scope.shop'),
      me: t('scope.me'),
      barber: t('scope.barber'),
    },
    freshness: {
      justNow: t('status.justNow'),
      updatedAgo: (age) => t('status.updatedAgo', { age }),
      updatedAt: (time) => t('status.updatedAt', { time }),
      updatedOn: (time) => t('status.updatedOn', { time }),
      info: t('status.info'),
      refreshing: t('status.refreshing'),
      failed: (time) => t('status.failed', { time }),
      failedNoCache: t('status.failedNoCache'),
      retry: t('status.retry'),
      scopeGone: t('status.scopeGone'),
    },
    empty: {
      title: t('empty.title'),
      rostered: (span) => t('empty.rostered', { span }),
      noRoster: t('empty.noRoster'),
    },
    smallSample: t('smallSample'),
    hero: {
      caption: t('hero.caption'),
      versus: t('hero.versus'),
      noComparison: t('hero.noComparison'),
      flat: t('hero.flat'),
      fromNothing: t('hero.fromNothing'),
      tips: t('hero.tips'),
      excluded: counted('hero.excluded'),
    },
    time: {
      title: t('time.title'),
      barName: t('time.barName'),
      part: {
        [AnalyticsBarPart.Worked]: t('time.part.WORKED'),
        [AnalyticsBarPart.NoShow]: t('time.part.NO_SHOW'),
        [AnalyticsBarPart.Unmarked]: t('time.part.UNMARKED'),
        [AnalyticsBarPart.Blocked]: t('time.part.BLOCKED'),
        [AnalyticsBarPart.Unsold]: t('time.part.UNSOLD'),
        [AnalyticsBarPart.Other]: t('time.part.OTHER'),
      },
      ahead: (booked, open) => t('time.ahead', { booked, open }),
      byDay: t('time.byDay'),
    },
    open: {
      title: t('open.title'),
      caption: t('open.caption'),
      emptiest: (day) => t('open.emptiest', { day }),
      none: t('open.none'),
      action: (day) => t('open.action', { day }),
    },
    services: {
      title: t('services.title'),
      line: (count, perHour) => t('services.line', { count, perHour }),
      count: counted('services.count'),
      barLabel: (name, perHour) => t('services.barLabel', { name, perHour }),
      barValue: (value, count) => t('services.barValue', { value, count }),
      none: t('services.none'),
    },
    clients: {
      title: t('clients.title'),
      ofBase: (count, base) => t('clients.ofBase', { count, base }),
    },
    charts: {
      line: t('charts.line'),
      average: (value) => t('charts.average', { value }),
      comparison: t('charts.comparison'),
      timeBars: t('charts.timeBars'),
      ahead: t('charts.ahead'),
      services: t('charts.services'),
      origins: t('charts.origins'),
    },
    busy: {
      title: t('busy.title'),
      label: t('busy.label'),
      at: (day, hour) => t('busy.at', { day, hour }),
      sentence: (busiest, emptiest) =>
        t('busy.sentence', { busiest, emptiest }),
      pending: t('busy.pending'),
    },
    origins: {
      title: t('origins.title'),
      origin: {
        [BookingOrigin.Online]: t('origins.ONLINE'),
        [BookingOrigin.Staff]: t('origins.STAFF'),
        [BookingOrigin.Unknown]: t('origins.UNKNOWN'),
      },
      visits: counted('origins.visits'),
    },
    figure: byTopic('figure'),
    info: {
      label: (figure) => t('info.label', { figure }),
      close: t('info.close'),
      definition: byTopic('info'),
    },
    drill: {
      total: t('drill.total'),
      count: counted('drill.count'),
      rebookedTotal: (count, base) => t('drill.rebookedTotal', { count, base }),
      empty: t('drill.empty'),
      seatsLater: t('drill.seatsLater'),
      rebookedYes: t('drill.rebookedYes'),
      rebookedNo: t('drill.rebookedNo'),
      noShow: t('drill.noShow'),
      late: t('drill.late'),
      dayLine: (rostered, unsold) => t('drill.dayLine', { rostered, unsold }),
      barberLine: (worked, rostered) =>
        t('drill.barberLine', { worked, rostered }),
      openBarber: (name) => t('drill.openBarber', { name }),
    },
    spanWords: spanCopyOf(translate),
  };
}
