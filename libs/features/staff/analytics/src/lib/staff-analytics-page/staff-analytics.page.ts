import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AnalyticsSpan } from '@core/components';
import { BarberId, LocationId, Tag } from '@core/primitives';
import { shareOrDownloadFile } from '@creativo/infrastructure/web-storage';
import { UiSparkBars } from '@creativo/ui/charts';
import {
  type UiAlertAction,
  UiAlert,
  UiAvatar,
  UiButton,
  UiChoiceMenu,
  type UiChoiceToggle,
  UiIcon,
  UiNotice,
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
import {
  UiCard,
  UiGauge,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
} from '@creativo/ui/patterns';
import { analyticsExportFile } from '../analytics-export.presenter';
import { analyticsHomeVm } from '../analytics-home.presenter';
import { AnalyticsScopeOption, AnalyticsTool } from '../analytics-home.vm';
import { analyticsFreshnessInfoVm } from '../analytics.presenter';
import { StaffAnalyticsStore } from '../staff-analytics.store';
import { AnalyticsCarousel } from './analytics-carousel';
import { AnalyticsGoalSheet } from './analytics-goal-sheet';
import { injectAnalyticsScreen } from './analytics-screen-context';
import { bindAnalyticsRouteInputs } from './route-inputs';

/** The ⓘ alert's one answer. */
const INFO_CLOSE = 'close';

/**
 * THE «АНАЛИЗИ» HOME (`/staff/analytics`,
 * `docs/designs/staff-analytics-v3-revolut.md`) — Revolut's analytics
 * layout: the title; one row of two menus, whose figures (the admin's) and
 * which period (the page on screen, the grain as its options); the
 * carousel of periods, each a bento of cards that open their own screens
 * (`AnalyticsCardPage`); then the month's goal, the days ahead and the
 * tools — «Задай цел» and «Експорт». The store holds the state, the
 * presenter words it; this wires the two to the DS.
 */
@Component({
  selector: 'lib-staff-analytics',
  imports: [
    AnalyticsCarousel,
    AnalyticsGoalSheet,
    RouterLink,
    UiAlert,
    UiAvatar,
    UiButton,
    UiCard,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiGauge,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiNotice,
    UiPaddingDirective,
    UiSkeleton,
    UiSparkBars,
    UiTextDirective,
    UiWeightDirective,
  ],
  providers: [StaffAnalyticsStore],
  templateUrl: './staff-analytics.page.html',
  styleUrl: './staff-analytics.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffAnalyticsPage {
  protected readonly store = inject(StaffAnalyticsStore);
  private readonly screen = injectAnalyticsScreen(this.store);

  /**
   * `?span=`, `?from=`, `?to=`, `?barber=` and `?location=`, bound from the route
   * (`withComponentInputBinding`; staff-analytics-v2, State and URL): the
   * schedule arrives with the week of its day and, for an admin, its
   * chair; a swipe of the carousel writes the page it settles on. Absent
   * is `undefined` — this month, the shop. Each is the URL's text, parsed
   * once by the store (`route-inputs.ts`).
   */
  readonly span = input<string | undefined>();
  readonly from = input<string | undefined>();
  readonly to = input<string | undefined>();
  readonly barber = input<string | undefined>();
  readonly location = input<string | undefined>();

  /** The home, worded; `null` until the words, the shop's clock and the period are known. */
  protected readonly vm = computed(() => {
    const screen = this.screen.input();
    if (screen === null) return null;
    return analyticsHomeVm({
      ...screen,
      pages: this.store.pages(),
      pageIndex: this.store.pageIndex(),
      pageReports: this.store.pageReports(),
    });
  });

  /** The two menus of the top row. */
  protected readonly scopeMenu = signal(false);
  protected readonly periodMenu = signal(false);

  constructor() {
    // English, like every other page's title in this app.
    inject(Title).setTitle('Analytics · Creativo');
    // The URL's five parameters, each read at its edge (`route-inputs.ts`).
    bindAnalyticsRouteInputs(this, this.store);
  }

  /** The period menu: the grain — the carousel opens on its current page. */
  protected pickSpan(id: string): void {
    if (Tag.has(AnalyticsSpan, id) && id !== AnalyticsSpan.Custom) {
      this.store.pickGrain(id);
    }
  }

  /** The scope menu's rows: «Всички салони» and «Целият екип», each picked whole. */
  protected pickScopeOption(id: string): void {
    if (id === AnalyticsScopeOption.Locations) this.store.pickAllLocations();
    if (id === AnalyticsScopeOption.Team) this.store.pickAllBarbers();
  }

  /** A box of the scope menu's submenus: a location, or a barber record. */
  protected toggleScope(toggle: UiChoiceToggle): void {
    if (toggle.row === AnalyticsScopeOption.Locations) {
      const locationId = LocationId.parse(toggle.id);
      if (locationId.ok) this.store.toggleLocation(locationId.value);
      return;
    }
    if (toggle.row === AnalyticsScopeOption.Team) {
      const barberId = BarberId.parse(toggle.id);
      if (barberId.ok) this.store.toggleBarber(barberId.value);
    }
  }

  protected readonly Tool = AnalyticsTool;

  /** A row of «Инструменти». */
  protected runTool(tool: AnalyticsTool): void {
    if (tool === AnalyticsTool.Goal) this.store.openGoal();
    else this.exportReport();
  }

  // ── «Експорт» ──────────────────────────────────────────────────────────

  /**
   * The report on screen as the CSV — spelt only when read (a `computed`
   * no template binds), so the file is built on the tap, never per frame.
   */
  private readonly exportFile = computed(() => {
    const words = this.screen.words();
    const report = this.store.report();
    if (words === null || report === null) return null;
    return analyticsExportFile({ words, report, names: this.screen.names });
  });

  /** The share sheet (or the download) is under way: a second tap waits. */
  protected readonly exporting = signal(false);

  /**
   * «Експорт»: the figures on screen as `creativo-analytics-<from>-<to>.csv`,
   * handed to the app's one file hand-off from the tap itself — before any
   * `await`, so a phone's share sheet still has the tap's user activation.
   */
  protected exportReport(): void {
    const file = this.exportFile();
    if (file === null || this.exporting()) return;
    this.exporting.set(true);
    const blob = new Blob([file.text], { type: 'text/csv;charset=utf-8' });
    void shareOrDownloadFile(file.fileName, blob).finally(() =>
      this.exporting.set(false),
    );
  }

  // ── The month's goal ───────────────────────────────────────────────────

  protected saveGoal(): void {
    this.store.saveGoal();
  }

  protected closeGoal(): void {
    this.store.closeGoal();
  }

  // ── The freshness line's ⓘ ─────────────────────────────────────────────

  /** The freshness line's ⓘ is open. */
  protected readonly freshnessInfo = signal(false);

  protected readonly infoVm = computed(() => {
    const words = this.screen.words();
    if (words === null || !this.freshnessInfo()) return null;
    return analyticsFreshnessInfoVm(words);
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

  protected openFreshnessInfo(): void {
    this.freshnessInfo.set(true);
  }

  protected closeInfo(): void {
    this.freshnessInfo.set(false);
  }
}
