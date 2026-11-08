import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AnalyticsFigure, AnalyticsSpan } from '@core/components';
import { PipelineErrorCode } from '@core/errors';
import {
  type BarberId,
  type LocalDate,
  type ServiceId,
  Tag,
} from '@core/primitives';
import {
  DEFAULT_LOCALE,
  loadedLanguage,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import {
  type UiAlertAction,
  UiAlert,
  UiButton,
  UiCard,
  UiGrid,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiMetric,
  UiNotice,
  UiPersonTile,
  UiSectionHeader,
  UiSegmentedControl,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import { UiBarChart, UiHeatmap, UiLineChart } from '@creativo/ui/charts';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { AnalyticsRowsPage } from '../analytics-rows-page/analytics-rows-page';
import { AnalyticsRangeSheet } from './analytics-range-sheet';
import {
  type AnalyticsNames,
  analyticsDrillVm,
  analyticsFreshnessInfoVm,
  analyticsInfoVm,
  analyticsVm,
} from '../analytics.presenter';
import {
  type AnalyticsDrill,
  type AnalyticsTopic,
  AnalyticsTopic as Topics,
} from '../analytics.vm';
import { analyticsWordsOf } from '../analytics.words';
import { StaffAnalyticsStore } from '../staff-analytics.store';
import { bindAnalyticsRouteInputs } from './route-inputs';

/** The ⓘ alert's one answer. */
const INFO_CLOSE = 'close';

/**
 * THE «АНАЛИЗИ» SCREEN (`/staff/analytics`, `docs/designs/staff-analytics-v2.md`
 * «The screen») — a routed page on the house column: the period switcher,
 * the admin's scope picker, then the seven questions drawn with the chart
 * kit — the hero and its takings line, the time's stacked day bars with
 * their legend, when the chair is busy (the heatmap), the open-hours card
 * with its seven bars, the services ranked, the clients' figures and, for
 * the shop, where bookings come from; every figure with its ⓘ, every figure
 * opening to its rows on a pushed page (`lib-analytics-rows-page`,
 * deferred). The store holds the state, the presenter words it; this wires
 * the two to the DS.
 */
@Component({
  selector: 'lib-staff-analytics',
  imports: [
    AnalyticsRangeSheet,
    AnalyticsRowsPage,
    NgTemplateOutlet,
    RouterLink,
    UiAlert,
    UiBarChart,
    UiButton,
    UiCard,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGrid,
    UiHeatmap,
    UiIcon,
    UiInteractiveDirective,
    UiLineChart,
    UiListGroup,
    UiListRow,
    UiMetric,
    UiNotice,
    UiPaddingDirective,
    UiPersonTile,
    UiSectionHeader,
    UiSegmentedControl,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  providers: [StaffAnalyticsStore],
  templateUrl: './staff-analytics.page.html',
  styleUrl: './staff-analytics.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffAnalyticsPage {
  protected readonly store = inject(StaffAnalyticsStore);
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CatalogContentService);
  private readonly wording = inject(CatalogWording);

  protected readonly Topics = Topics;
  protected readonly AnalyticsFigure = AnalyticsFigure;

  /**
   * `?span=`, `?from=`, `?to=` and `?barber=`, bound from the route
   * (`withComponentInputBinding`; staff-analytics-v2, State and URL): the
   * schedule arrives with the week of its day and, for an admin, its
   * chair. Absent is `undefined` — this month, the shop. Each is the URL's
   * text, parsed once by the store (`route-inputs.ts`).
   */
  readonly span = input<string | undefined>();
  readonly from = input<string | undefined>();
  readonly to = input<string | undefined>();
  readonly barber = input<string | undefined>();

  /** The language the catalogue has loaded, once it has — every word is read in it. */
  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  private readonly words = computed(() => {
    const lang = this.loadedLang();
    if (lang === null) return null;
    return analyticsWordsOf(
      (key, params) => this.transloco.translate(key, params, lang),
      lang,
    );
  });

  /** Services and barbers in the reader's language, read when asked. */
  private readonly names: AnalyticsNames = {
    serviceName: (id) => {
      const service = this.catalog.findService(id);
      return service === undefined ? null : this.wording.text(service.name);
    },
    barberName: (id) => {
      const barber = this.catalog.barbers().find((entry) => entry.id === id);
      return barber === undefined ? null : this.wording.text(barber.name);
    },
    barberAvatarSrc: (id) =>
      this.catalog.barberVms().find((vm) => vm.id === id)?.avatarSrc ?? null,
  };

  /** A refusal of the account, in the catalogue's words (`errors.<code>`). */
  private readonly refusal = computed(() => {
    const error = this.store.refusal();
    const lang = this.loadedLang() ?? DEFAULT_LOCALE;
    if (error === null) return null;
    return wordPipelineError(
      error,
      (code, params) => {
        const key = `errors.${code}`;
        const worded = this.transloco.translate(key, params, lang);
        return worded === key ? code : worded;
      },
      PipelineErrorCode.Unknown,
    );
  });

  /** The screen, worded; `null` until the words, the shop's clock and the period are known. */
  protected readonly vm = computed(() => {
    const words = this.words();
    const zone = this.store.zone();
    const today = this.store.today();
    const period = this.store.period();
    if (words === null || zone === null || today === null || period === null) {
      return null;
    }
    // Read here so a late catalogue re-words the names.
    this.catalog.barbers();
    this.catalog.services();
    return analyticsVm({
      words,
      zone,
      today,
      now: this.store.now(),
      period,
      analyticsLoad: this.store.analyticsLoad(),
      report: this.store.report(),
      refusal: this.refusal(),
      scopeChoices: this.store.scopeChoices(),
      scopeBarberId: this.store.scopeBarberId(),
      scopeGone: this.store.scopeGone(),
      scheduleBarberId: this.store.scheduleBarberId(),
      rangeCheck: this.store.rangeCheck(),
      names: this.names,
    });
  });

  // ── The custom range and a year's months ───────────────────────────────

  /** The «…» pill: the sheet, prefilled with the period on screen. */
  protected openRange(): void {
    this.store.openRange();
  }

  protected closeRange(): void {
    this.store.closeRange();
  }

  protected applyRange(): void {
    this.store.applyRange();
  }

  /** A month of a year's day rows opens that month, the drill-down closed. */
  protected openMonth(localDate: LocalDate): void {
    this.drill.set(null);
    this.store.pickMonth(localDate);
  }

  // ── The drill-down and the ⓘ ──────────────────────────────────────────

  protected readonly drill = signal<AnalyticsDrill | null>(null);

  protected readonly drillVm = computed(() => {
    const drill = this.drill();
    const words = this.words();
    const report = this.store.report();
    const today = this.store.today();
    if (drill === null || words === null || report === null || today === null) {
      return null;
    }
    this.catalog.services();
    return analyticsDrillVm({
      words,
      today,
      report,
      drill,
      seatRowsHeld: this.store.seatRowsHeld(),
      names: this.names,
    });
  });

  protected readonly info = signal<AnalyticsTopic | null>(null);
  /** The freshness line's ⓘ is open. */
  protected readonly freshnessInfo = signal(false);

  protected readonly infoVm = computed(() => {
    const topic = this.info();
    const words = this.words();
    if (words === null) return null;
    if (this.freshnessInfo()) return analyticsFreshnessInfoVm(words);
    return topic === null ? null : analyticsInfoVm(words, topic);
  });

  protected readonly infoActions = computed<readonly UiAlertAction[]>(() => [
    {
      id: INFO_CLOSE,
      label: this.infoVm()?.closeLabel ?? '',
      role: 'cancel',
      preferred: true,
      testId: 'analytics-info-close',
    },
  ]);

  constructor() {
    // English, like every other page's title in this app.
    inject(Title).setTitle('Analytics · Creativo');
    // The URL's four parameters, each read at its edge (`route-inputs.ts`).
    bindAnalyticsRouteInputs(this, this.store);
  }

  protected pickSpan(id: string): void {
    if (Tag.has(AnalyticsSpan, id)) this.store.pickSpan(id);
  }

  protected pickScope(scopeBarberId: BarberId | null): void {
    this.store.pickScope(scopeBarberId);
  }

  protected openDrill(
    analyticsFigure: AnalyticsFigure,
    serviceId: ServiceId | null = null,
  ): void {
    this.drill.set({ analyticsFigure, serviceId });
  }

  protected openDrillOf(drill: AnalyticsDrill | null): void {
    if (drill !== null) this.drill.set(drill);
  }

  protected closeDrill(): void {
    this.drill.set(null);
  }

  /** A barber's row of a shop drill-down: that barber's report. */
  protected openBarber(barberId: BarberId): void {
    this.pickScope(barberId);
  }

  protected openInfo(topic: AnalyticsTopic): void {
    this.info.set(topic);
  }

  protected openFreshnessInfo(): void {
    this.freshnessInfo.set(true);
  }

  protected closeInfo(): void {
    this.info.set(null);
    this.freshnessInfo.set(false);
  }
}
