import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AnalyticsFigure, AnalyticsRangePreset } from '@core/components';
import { type BarberId, type LocalDate, Tag } from '@core/primitives';
import {
  UiBarChart,
  UiHeatmap,
  UiLineChart,
  UiRadar,
  UiRingChart,
} from '@creativo/ui/charts';
import {
  type UiAlertAction,
  UiAlert,
  UiButton,
  UiIcon,
  UiNotice,
  UiSegmentedControl,
  UiSkeleton,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { UiCard, UiListGroup, UiListRow } from '@creativo/ui/patterns';
import { AnalyticsRowsPage } from '../analytics-rows-page/analytics-rows-page';
import { analyticsCardVm, cardTopicOf } from '../analytics-card.presenter';
import { AnalyticsChartView } from '../analytics-card.vm';
import { AnalyticsCard } from '../analytics-home.vm';
import {
  analyticsDrillVm,
  analyticsInfoVm,
  partsToLocalDate,
  rangeDateText,
  rangeOf,
} from '../analytics.presenter';
import type { AnalyticsDrill } from '../analytics.vm';
import { StaffAnalyticsStore } from '../staff-analytics.store';
import { AnalyticsRangeSheet } from './analytics-range-sheet';
import { injectAnalyticsScreen } from './analytics-screen-context';
import { bindAnalyticsRouteInputs } from './route-inputs';

/** The ⓘ alert's one answer. */
const INFO_CLOSE = 'close';

/**
 * A CARD'S OWN SCREEN (`/staff/analytics/:card`,
 * `docs/designs/staff-analytics-v3-revolut.md`) — Revolut's «Spent» screen
 * for one of the home's cards: the figure; one chart that the switch draws
 * as a smooth line, bars or a ring of the figure's breakdown; the range row
 * (1С 1М 6М 1Г МАКС and «…» for the custom period sheet); and the v2
 * sections that break the figure down, each opening its rows. Its own
 * store on its own URL (`?span&from&to&barber&location`), opened on the home page's
 * period and scope.
 */
@Component({
  selector: 'lib-analytics-card-page',
  imports: [
    AnalyticsRangeSheet,
    AnalyticsRowsPage,
    RouterLink,
    UiAlert,
    UiBarChart,
    UiButton,
    UiCard,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiHeatmap,
    UiIcon,
    UiInteractiveDirective,
    UiLineChart,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiPaddingDirective,
    UiRadar,
    UiRingChart,
    UiSegmentedControl,
    UiSkeleton,
    UiTextDirective,
    UiWeightDirective,
  ],
  providers: [StaffAnalyticsStore],
  templateUrl: './analytics-card.page.html',
  styleUrl: './analytics-card.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsCardPage {
  protected readonly store = inject(StaffAnalyticsStore);
  private readonly screen = injectAnalyticsScreen(this.store);
  private readonly browserLocation = inject(Location);
  private readonly router = inject(Router);

  /** `:card` — which card's screen; an unknown one reads as «Оборот». */
  readonly card = input<string | undefined>();
  /** `?span&from&to&barber&location`, as the home binds them (`route-inputs.ts`). */
  readonly span = input<string | undefined>();
  readonly from = input<string | undefined>();
  readonly to = input<string | undefined>();
  readonly barber = input<string | undefined>();
  readonly location = input<string | undefined>();

  private readonly cardTag = computed<AnalyticsCard>(() => {
    const raw = this.card();
    return raw !== undefined && Tag.has(AnalyticsCard, raw)
      ? raw
      : AnalyticsCard.Takings;
  });

  protected readonly ChartView = AnalyticsChartView;

  /** The switch's pick; `null` is the card's first view. */
  private readonly view = signal<AnalyticsChartView | null>(null);

  protected readonly vm = computed(() => {
    const screen = this.screen.input();
    if (screen === null) return null;
    return analyticsCardVm({
      ...screen,
      card: this.cardTag(),
      view: this.view(),
    });
  });

  /** The custom period sheet's words and verdict. */
  protected readonly rangeVm = computed(() => {
    const screen = this.screen.input();
    return screen === null ? null : rangeOf(screen);
  });

  /** The sheet's two rows' dates in words. */
  protected readonly rangeTexts = computed(() => {
    const screen = this.screen.input();
    if (screen === null) return { from: null, to: null };
    return {
      from: rangeDateText(partsToLocalDate(this.store.rangeFrom()), screen),
      to: rangeDateText(partsToLocalDate(this.store.rangeTo()), screen),
    };
  });

  constructor() {
    inject(Title).setTitle('Analytics · Creativo');
    bindAnalyticsRouteInputs(this, this.store);
  }

  /** Back to the home — the way it came when it came from the home. */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.browserLocation.back();
      return;
    }
    void this.router.navigate(['/staff/analytics']);
  }

  protected pickView(id: string): void {
    if (Tag.has(AnalyticsChartView, id)) this.view.set(id);
  }

  protected pickRange(id: string): void {
    if (Tag.has(AnalyticsRangePreset, id)) this.store.pickRangePreset(id);
  }

  // ── The drill-down and the ⓘ ──────────────────────────────────────────

  protected readonly drill = signal<AnalyticsDrill | null>(null);

  protected readonly drillVm = computed(() => {
    const drill = this.drill();
    const words = this.screen.words();
    const report = this.store.report();
    const today = this.store.today();
    if (drill === null || words === null || report === null || today === null) {
      return null;
    }
    return analyticsDrillVm({
      words,
      today,
      report,
      drill,
      seatRowsHeld: this.store.seatRowsHeld(),
      names: this.screen.names,
    });
  });

  /** «По дни»: the working time's days. */
  protected openDays(): void {
    this.drill.set({ analyticsFigure: AnalyticsFigure.Time, serviceId: null });
  }

  protected openDrillOf(drill: AnalyticsDrill | null): void {
    if (drill !== null) this.drill.set(drill);
  }

  protected closeDrill(): void {
    this.drill.set(null);
  }

  /** A barber's row of a shop drill-down: that barber's figures. */
  protected openBarber(barberId: BarberId): void {
    this.drill.set(null);
    this.store.pickScope(barberId);
  }

  /** A month of a year's day rows opens that month. */
  protected openMonth(localDate: LocalDate): void {
    this.drill.set(null);
    this.store.pickMonth(localDate);
  }

  private readonly info = signal(false);

  protected readonly infoVm = computed(() => {
    const words = this.screen.words();
    if (words === null || !this.info()) return null;
    return analyticsInfoVm(words, cardTopicOf(this.cardTag()));
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

  protected openInfo(): void {
    this.info.set(true);
  }

  protected closeInfo(): void {
    this.info.set(false);
  }
}
