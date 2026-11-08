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
  readonly scope: {
    readonly label: string;
    readonly shop: string;
    readonly me: string;
    readonly barber: string;
  };
  readonly freshness: {
    readonly asOf: (time: string) => string;
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
    readonly none: string;
  };
  readonly clients: {
    readonly title: string;
    readonly ofBase: (count: string, base: string) => string;
  };
  readonly fill: {
    readonly title: string;
    readonly line: (filled: string, capacity: string) => string;
    readonly none: string;
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
      [AnalyticsSpan.Week]: t('span.WEEK'),
      [AnalyticsSpan.Month]: t('span.MONTH'),
    },
    previous: t('previous'),
    next: t('next'),
    range: (from, to) => t('range', { from, to }),
    scope: {
      label: t('scope.label'),
      shop: t('scope.shop'),
      me: t('scope.me'),
      barber: t('scope.barber'),
    },
    freshness: {
      asOf: (time) => t('status.asOf', { time }),
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
      none: t('services.none'),
    },
    clients: {
      title: t('clients.title'),
      ofBase: (count, base) => t('clients.ofBase', { count, base }),
    },
    fill: {
      title: t('fill.title'),
      line: (filled, capacity) => t('fill.line', { filled, capacity }),
      none: t('fill.none'),
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
