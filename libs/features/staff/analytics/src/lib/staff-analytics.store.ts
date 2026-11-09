import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  type AnalyticsCall,
  AnalyticsGoal,
  AnalyticsPeriod,
  AnalyticsRangePreset,
  type AnalyticsReport,
  AnalyticsComparison,
  AnalyticsSpan,
  Principal,
  Roles,
  type SetAnalyticsGoalCall,
} from '@core/components';
import {
  AnalyticsErrorCode,
  type PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type { AnalyticsCacheKey } from '@core/ports';
import {
  BarberId,
  LocalDate,
  LocationId,
  type UserId,
  Tag,
} from '@core/primitives';
import type { UiDateFieldParts } from '@creativo/ui/controls';
import {
  type AnalyticsCarouselSpan,
  AnalyticsCarouselSystem,
  type AnalyticsScopeChoice,
  StaffAnalyticsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  ANALYTICS_CACHE_PORTS,
  ANALYTICS_CALL_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import { partsToLocalDate } from './analytics.presenter';
import {
  type AnalyticsGoalCheck,
  AnalyticsGoalRefusal,
  AnalyticsGoalSave,
  AnalyticsLoad,
  type AnalyticsRangeCheck,
  AnalyticsRangeRefusal,
} from './analytics.vm';

/** The request the screen stands on: who asks, what is sent, and where its report is cached. */
type AnalyticsRequest = {
  readonly userId: UserId;
  readonly call: AnalyticsCall;
  /** `null` while a barber's own record is not known yet: nothing to paint from. */
  readonly cacheKey: AnalyticsCacheKey | null;
};

function sameCall(a: AnalyticsRequest, b: AnalyticsRequest): boolean {
  return (
    a.userId === b.userId &&
    a.call.scopeBarberId === b.call.scopeBarberId &&
    a.call.scopeLocationId === b.call.scopeLocationId &&
    a.call.analyticsSpan === b.call.analyticsSpan &&
    a.call.fromLocalDate === b.call.fromLocalDate &&
    a.call.toLocalDate === b.call.toLocalDate &&
    a.call.analyticsComparison === b.call.analyticsComparison
  );
}

/** Where a sign-in sends a signed-out caller back to. */
const SELF_URL = '/staff/analytics';

/** How often "now" is re-read while the screen is attached — the freshness line's tick. */
const NOW_TICK_MS = 60_000;

/**
 * What the URL asked for — `?span=` and `?from=`, each parsed ONCE at the
 * store's edge: a span this PR accepts, and the day whose week or month the
 * period is. `null` is silence (absent, empty, or a value that names
 * nothing); UNDEFINED is "not read yet" — the page's binder speaks for
 * both in its first activation, and no request stands before it does, so
 * the first call asks for the period the link names, not for this month
 * and then the link's.
 */
type RouteRequest = {
  readonly span: AnalyticsSpan | null | undefined;
  readonly from: LocalDate | null | undefined;
  /** `?to=` — read on `CUSTOM` only; absent on every other span. */
  readonly to: LocalDate | null | undefined;
};

/**
 * The period of `span` (this month's when none) that holds `from` (today
 * when none); a `CUSTOM` is `from`–`to` as the component admits it. A
 * period the switcher could never reach — past the reach, ahead of today,
 * a custom range the component refuses — lands on this month, as
 * `periodInSpan` does.
 */
function routedPeriodOf(
  span: AnalyticsSpan | null,
  from: LocalDate | null,
  to: LocalDate | null,
  today: LocalDate,
): AnalyticsPeriod {
  const fallback = AnalyticsPeriod.monthOf(today);
  if (span === AnalyticsSpan.Custom) {
    if (from === null || to === null) return fallback;
    const custom = AnalyticsPeriod.of(AnalyticsSpan.Custom, from, to);
    return custom.ok && AnalyticsPeriod.isWithinRange(custom.value, today)
      ? custom.value
      : fallback;
  }
  const landed = AnalyticsPeriod.holding(
    span ?? AnalyticsSpan.Month,
    from ?? today,
  );
  return AnalyticsPeriod.isWithinRange(landed, today) ? landed : fallback;
}

/** `?to=` — the custom range's last day; absent on every other span. */
function toParamOf(period: AnalyticsPeriod): LocalDate | null {
  return period.analyticsSpan === AnalyticsSpan.Custom
    ? period.toLocalDate
    : null;
}

/** The sheet's two days in order — a `from` typed after `to` is the same range, the other way round. */
function orderedRange(
  a: LocalDate,
  b: LocalDate,
): { readonly from: LocalDate; readonly to: LocalDate } {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/**
 * THE «АНАЛИЗИ» SCREEN'S STORE (`docs/designs/staff-analytics.md`, The
 * screen): the scope, the period, the report and where its request stands.
 *
 * - **Scope.** A barber's is their own record — the call sends `null`, the
 *   callable reads the link off the stored user; the session's
 *   `linkedBarberId` names the record for the cache key and the schedule
 *   link. An admin opens on the shop and picks a barber in the picker.
 * - **Cache first, then the answer.** Every request paints the report the
 *   device cached for (account, scope, period) at once, then asks the
 *   callable (every open asks: comparing stored instants to skip a call is
 *   no rule of Law 7's) and replaces it; the answer is cached again, its
 *   seat rows dropped by the adapter.
 * - **Refusals.** `ANALYTICS_FORBIDDEN` / `…_BARBER_NOT_LINKED` delete the
 *   account's cached reports and show the refusal; `…_SCOPE_UNKNOWN` falls
 *   back to the shop and says so; `…_UNAUTHENTICATED` (and the platform's
 *   own) is the sign-in; `…_PERIOD_OUT_OF_RANGE` goes back to the current
 *   period (the switcher never offers one). Anything else keeps a cached
 *   report on screen with «Опитай пак».
 *
 * - **The URL** (`docs/designs/staff-analytics-v2.md`, State and URL) is
 *   an input and this store's output: `?span&from&to&barber` are read once
 *   at the edge (`applyRoute*`, the page's `route-inputs.ts`), and each
 *   pick replaces the URL (`replaceUrl`) so Back returns to the schedule,
 *   not through the picks. `published()` is what was last written, so the
 *   echo of a write is not read as a request (the schedule store's guard).
 *
 * Every decision the screen shows is a system's (`StaffAnalyticsSystem`);
 * this holds state and calls ports.
 */
@Injectable()
export class StaffAnalyticsStore {
  private readonly calls = inject(ANALYTICS_CALL_PORTS);
  private readonly cache = inject(ANALYTICS_CACHE_PORTS);
  private readonly identity = inject(SessionIdentityService);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(CatalogContentService);

  /** The default shop's zone — "today", and the report's time, are read on it (as the callable does). */
  readonly zone = inject(ShopZoneService).defaultZone();

  /** The instant the screen opened (or was last retried) — "today" is read once from it. */
  private readonly openedAtUtcMs = signal(this.clock.nowUtcMs());

  /**
   * The clock the freshness line is read against — re-read every minute
   * while the screen is attached, so «Обновено преди 5 мин» ticks. "Today"
   * does NOT follow it (`openedAtUtcMs`): moving the period under someone
   * at midnight is its own trust failure.
   */
  private readonly _nowUtcMs = signal(this.clock.nowUtcMs());
  readonly now = this._nowUtcMs.asReadonly();

  /** The shop's today; `null` until its zone is known. */
  readonly today = computed(() => {
    const zone = this.zone();
    return zone === null
      ? null
      : ZonedTimeSystem.shopNow(this.openedAtUtcMs(), zone).localDate;
  });

  /** The shop's reader (`Roles.ANALYTICS_SHOP`, the token's claims): the scope picker, the shop scope. */
  readonly readsShop = computed(() =>
    Principal.hasAnyRole(this.identity.principal(), Roles.ANALYTICS_SHOP),
  );

  /** The account's linked barber record (the session's user document). */
  readonly linkedBarberId = this.identity.linkedBarberId;

  private readonly pickedPeriod = signal<AnalyticsPeriod | null>(null);

  /** The URL's say on the period — until a pick, which outranks it. */
  private readonly routed = signal<RouteRequest>({
    span: undefined,
    from: undefined,
    to: undefined,
  });

  /**
   * The period on screen — the URL's, or this month, until the switcher
   * moves it; `null` until the shop's zone and the URL have spoken
   * (`applyRouteSpan` + `applyRouteFrom`, the page's `route-inputs.ts`).
   */
  readonly period = computed<AnalyticsPeriod | null>(() => {
    const picked = this.pickedPeriod();
    if (picked !== null) return picked;
    const today = this.today();
    const { span, from, to } = this.routed();
    if (
      today === null ||
      span === undefined ||
      from === undefined ||
      to === undefined
    ) {
      return null;
    }
    return routedPeriodOf(span, from, to, today);
  });

  /**
   * What this store last wrote to the URL — the echo guard. UNDEFINED is
   * "never written": the page's first look at a silent URL still reaches
   * the store (`route-inputs.ts`). Nothing is written until the first
   * request stands (`stateRequest`), and then only what a pick changes.
   */
  private readonly _published = signal<{
    readonly span: AnalyticsSpan | null | undefined;
    readonly from: LocalDate | null | undefined;
    readonly to: LocalDate | null | undefined;
    readonly barber: BarberId | null | undefined;
    readonly location: LocationId | null | undefined;
  }>({
    span: undefined,
    from: undefined,
    to: undefined,
    barber: undefined,
    location: undefined,
  });
  readonly published = this._published.asReadonly();

  /** The admin's pick; `null` is the shop. A barber's is always their own. */
  private readonly pickedScope = signal<BarberId | null>(null);
  readonly scopeBarberId = this.pickedScope.asReadonly();
  /**
   * The admin's location (ADR 2026-11-09); `null` is every location. Never
   * beside a barber: picking one clears the other.
   */
  private readonly pickedLocation = signal<LocationId | null>(null);
  readonly scopeLocationId = this.pickedLocation.asReadonly();

  /** The admin's scope picker, in its order; `null` for a barber. */
  readonly scopeChoices = computed<readonly AnalyticsScopeChoice[] | null>(
    () =>
      this.readsShop()
        ? StaffAnalyticsSystem.scopeChoicesOf(
            this.catalog.barbers().map((barber) => barber.id),
            this.linkedBarberId(),
            this.catalog.locations().map((location) => location.id),
          )
        : null,
  );

  /** The barber the open-hours card opens the schedule on: the scope, or the barber's own record. */
  readonly scheduleBarberId = computed<BarberId | null>(() =>
    this.readsShop() ? this.pickedScope() : this.linkedBarberId(),
  );

  private readonly _report = signal<AnalyticsReport | null>(null);
  readonly report = this._report.asReadonly();
  /** The report on screen is the callable's own answer — its seat rows held (a cached one keeps none). */
  private readonly _seatRowsHeld = signal(false);
  readonly seatRowsHeld = this._seatRowsHeld.asReadonly();
  private readonly _load = signal<AnalyticsLoad>(AnalyticsLoad.Loading);
  readonly analyticsLoad = this._load.asReadonly();
  /** The refusal the screen words (`errors.<code>`); `null` without one. */
  private readonly _refusal = signal<PipelineError | null>(null);
  readonly refusal = this._refusal.asReadonly();
  /** The barber asked for no longer exists; the shop is shown instead. */
  private readonly _scopeGone = signal(false);
  readonly scopeGone = this._scopeGone.asReadonly();

  /** What the screen asks for now — `null` until the account and the period are known. */
  private readonly request = computed<AnalyticsRequest | null>(() => {
    const period = this.period();
    return period === null ? null : this.requestFor(period);
  });

  /** The request for `period` on this account and scope — `null` before the account is known. */
  private requestFor(period: AnalyticsPeriod): AnalyticsRequest | null {
    const userId = this.identity.userId();
    if (userId === null) return null;
    const shop = this.readsShop();
    const call: AnalyticsCall = {
      // A barber sends none: the callable reads their record off the stored user.
      scopeBarberId: shop ? this.pickedScope() : null,
      scopeLocationId: shop ? this.pickedLocation() : null,
      fromLocalDate: period.fromLocalDate,
      // Named on `CUSTOM` alone (the callable's rule).
      toLocalDate:
        period.analyticsSpan === AnalyticsSpan.Custom
          ? period.toLocalDate
          : null,
      analyticsSpan: period.analyticsSpan,
      // The constant until a second value is enabled (v2, State and URL).
      analyticsComparison: AnalyticsComparison.Previous,
    };
    const cacheScope = shop ? this.pickedScope() : this.linkedBarberId();
    return {
      userId,
      call,
      cacheKey:
        !shop && cacheScope === null
          ? null
          : { ...call, scopeBarberId: cacheScope, userId },
    };
  }

  // ── The home carousel (staff-analytics-v3) ─────────────────────────────

  /** Bumped when an answer is cached, so a neighbour page re-reads the device. */
  private readonly cacheVersion = signal(0);

  /**
   * The carousel's pages: every period of the grain within reach, oldest
   * first (`AnalyticsCarouselSystem.pagesOf`); a `CUSTOM` range is a page
   * of its own.
   */
  readonly pages = computed<readonly AnalyticsPeriod[]>(() => {
    const period = this.period();
    const today = this.today();
    if (period === null || today === null) return [];
    return period.analyticsSpan === AnalyticsSpan.Custom
      ? [period]
      : AnalyticsCarouselSystem.pagesOf(period.analyticsSpan, today);
  });

  /** The page on screen — the period's. */
  readonly pageIndex = computed(() => {
    const period = this.period();
    if (period === null) return 0;
    return Math.max(
      0,
      AnalyticsCarouselSystem.pageIndexOf(this.pages(), period),
    );
  });

  /**
   * Each page's report: the one on screen is the store's; its two
   * neighbours are what the device cached for them (a swipe shows figures
   * at once when it can); every other page is `null` and draws nothing.
   */
  readonly pageReports = computed<readonly (AnalyticsReport | null)[]>(() => {
    const pages = this.pages();
    const index = this.pageIndex();
    const current = this._report();
    this.cacheVersion();
    return pages.map((page, i) => {
      if (i === index) return current;
      return Math.abs(i - index) === 1
        ? untracked(() => this.cachedReportOf(page))
        : null;
    });
  });

  private cachedReportOf(period: AnalyticsPeriod): AnalyticsReport | null {
    const request = this.requestFor(period);
    if (request === null || request.cacheKey === null) return null;
    const cached = this.cache.readCachedReport(request.cacheKey);
    return cached.ok ? cached.value : null;
  }

  /**
   * The home's grain menu: the carousel of `span`, opened on its current
   * page — «Тази седмица», «Този месец» — whatever page was on screen.
   */
  pickGrain(span: AnalyticsCarouselSpan): void {
    const today = untracked(this.today);
    if (today === null) return;
    this.pickPeriod(AnalyticsPeriod.holding(span, today));
  }

  /** A card screen's range chip: its period on today (`AnalyticsCarouselSystem.rangeOf`). */
  pickRangePreset(preset: AnalyticsRangePreset): void {
    const today = untracked(this.today);
    if (today === null) return;
    this.pickPeriod(AnalyticsCarouselSystem.rangeOf(preset, today));
  }

  /** A swipe settled on page `index`: it becomes the period (the URL replaced). */
  pickPage(index: number): void {
    const page = untracked(this.pages).at(index);
    const period = untracked(this.period);
    if (page === undefined || period === null) return;
    if (
      page.analyticsSpan === period.analyticsSpan &&
      page.fromLocalDate === period.fromLocalDate
    ) {
      return;
    }
    this.pickPeriod(page);
  }

  /** The request last sent; a change of the cache key alone does not send it again. */
  private sent: AnalyticsRequest | null = null;
  /** Bumped by every send: an answer to an older one is dropped. */
  private ticket = 0;
  private destroyed = false;
  /** The pending address-bar write, if one is scheduled. */
  private urlWrite: ReturnType<typeof setTimeout> | null = null;
  /** The first request has been stated in the URL (the one write-back that is not a pick). */
  private stated = false;

  constructor() {
    const tick = setInterval(() => {
      this._nowUtcMs.set(this.clock.nowUtcMs());
    }, NOW_TICK_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      // A URL write scheduled by a store that is leaving would navigate a
      // page that is no longer showing.
      if (this.urlWrite !== null) clearTimeout(this.urlWrite);
      this.destroyed = true;
    });
    effect(() => {
      const request = this.request();
      untracked(() => {
        this.open(request);
        if (request !== null && !this.stated) this.stateRequest();
      });
    });
  }

  // ── Acts ──────────────────────────────────────────────────────────────

  /** Week | Month — the same data in another span (`StaffAnalyticsSystem.periodInSpan`). */
  pickSpan(span: AnalyticsSpan): void {
    const period = this.period();
    const today = this.today();
    if (period === null || today === null) return;
    this.pickPeriod(StaffAnalyticsSystem.periodInSpan(period, span, today));
  }

  /** ‹ › — the period before or after, only where the switcher offers one. */
  step(direction: 'previous' | 'next'): void {
    const period = this.period();
    const today = this.today();
    if (period === null || today === null) return;
    const steps = StaffAnalyticsSystem.stepsOf(period, today);
    const target = direction === 'previous' ? steps.previous : steps.next;
    if (target !== null) this.pickPeriod(target);
  }

  private pickPeriod(period: AnalyticsPeriod): void {
    this.pickedPeriod.set(period);
    this.publishQuery({
      span: period.analyticsSpan,
      from: period.fromLocalDate,
      to: toParamOf(period),
    });
  }

  // ── The custom range («…», the sheet) ──────────────────────────────────

  private readonly _rangeOpen = signal(false);
  /** The custom-range sheet is up. */
  readonly rangeOpen = this._rangeOpen.asReadonly();
  /** The sheet's two fields, as typed; `null` while empty or half-typed. */
  readonly rangeFrom = signal<UiDateFieldParts | null>(null);
  readonly rangeTo = signal<UiDateFieldParts | null>(null);

  /**
   * The component's verdict on the two fields, read by the sheet: the
   * range the switcher would ask for, or why not — a field half-typed,
   * a start before the reach, an end after today, more than
   * `CUSTOM_MAX_DAYS`. A `from` typed after `to` is the same range the
   * other way round (`orderedRange`). Nothing here decides: `of` and
   * `isWithinRange` are `AnalyticsPeriod`'s.
   */
  readonly rangeCheck = computed<AnalyticsRangeCheck>(() => {
    const today = this.today();
    const from = partsToLocalDate(this.rangeFrom());
    const to = partsToLocalDate(this.rangeTo());
    if (today === null || from === null || to === null) {
      return {
        rangeRefusal: AnalyticsRangeRefusal.Incomplete,
        fromLocalDate: from,
        toLocalDate: to,
      };
    }
    const ordered = orderedRange(from, to);
    const refused = (rangeRefusal: Exclude<AnalyticsRangeRefusal, null>) => ({
      rangeRefusal,
      fromLocalDate: ordered.from,
      toLocalDate: ordered.to,
    });
    if (ordered.to > today) return refused(AnalyticsRangeRefusal.AfterToday);
    const period = AnalyticsPeriod.of(
      AnalyticsSpan.Custom,
      ordered.from,
      ordered.to,
    );
    if (!period.ok) return refused(AnalyticsRangeRefusal.TooLong);
    if (!AnalyticsPeriod.isWithinRange(period.value, today)) {
      return refused(AnalyticsRangeRefusal.BeforeReach);
    }
    return {
      rangeRefusal: null,
      fromLocalDate: ordered.from,
      toLocalDate: ordered.to,
    };
  });

  /** The «…» pill: the sheet opens on the period on screen. */
  openRange(): void {
    const period = untracked(this.period);
    if (period !== null) {
      this.rangeFrom.set(LocalDate.parts(period.fromLocalDate));
      this.rangeTo.set(LocalDate.parts(period.toLocalDate));
    }
    this._rangeOpen.set(true);
  }

  closeRange(): void {
    this._rangeOpen.set(false);
  }

  /** «Приложи»: the range the check admits becomes the period; a refused one is ignored. */
  applyRange(): void {
    const check = untracked(this.rangeCheck);
    if (check.rangeRefusal !== null) return;
    const period = AnalyticsPeriod.of(
      AnalyticsSpan.Custom,
      check.fromLocalDate,
      check.toLocalDate,
    );
    if (!period.ok) return;
    // The sheet closes itself (its exit animates), then `closeRange`.
    this.pickPeriod(period.value);
  }

  // ── The month's goal («Задай цел», the sheet) ───────────────────────────

  private readonly _goalOpen = signal(false);
  /** The goal sheet is up. */
  readonly goalOpen = this._goalOpen.asReadonly();
  /** The sheet's two sums, in cents, as typed; `null` while empty. */
  readonly goalLow = signal<number | null>(null);
  readonly goalHigh = signal<number | null>(null);
  private readonly _goalSave = signal<AnalyticsGoalSave>(
    AnalyticsGoalSave.Idle,
  );
  /** Where the goal's write stands. */
  readonly goalSave = this._goalSave.asReadonly();

  /**
   * The sheet's two sums as the range the callable would store, or why
   * not — a sum empty, or the range `AnalyticsGoal.rangeOf` refuses (the
   * pipeline's own rule: both above zero, the low end up to the high).
   * Nothing here decides.
   */
  readonly goalCheck = computed<AnalyticsGoalCheck>(() => {
    const low = this.goalLow();
    const high = this.goalHigh();
    const refused = (goalRefusal: Exclude<AnalyticsGoalRefusal, null>) => ({
      goalRefusal,
      goalLowCents: null,
      goalHighCents: null,
    });
    if (low === null || high === null) {
      return refused(AnalyticsGoalRefusal.Incomplete);
    }
    const range = AnalyticsGoal.rangeOf(low, high);
    return range.ok
      ? { goalRefusal: null, ...range.value }
      : refused(AnalyticsGoalRefusal.InvalidRange);
  });

  /** «Задай цел» / «Промени целта»: the sheet opens on the stored goal, if any. */
  openGoal(): void {
    const report = untracked(this._report);
    this.goalLow.set(report?.reportGoalLowCents ?? null);
    this.goalHigh.set(report?.reportGoalHighCents ?? null);
    this._goalSave.set(AnalyticsGoalSave.Idle);
    this._goalOpen.set(true);
  }

  closeGoal(): void {
    this._goalOpen.set(false);
  }

  /**
   * «Запази»: the range the check admits goes to `setAnalyticsGoal` for the
   * period's month and the request's scope; on its answer the sheet
   * closes and the report is asked for again, so the ring shows the goal.
   * A refusal or a failure keeps the sheet up and says so.
   */
  saveGoal(): void {
    const check = untracked(this.goalCheck);
    const period = untracked(this.period);
    const request = untracked(this.request);
    if (
      check.goalRefusal !== null ||
      period === null ||
      request === null ||
      untracked(this._goalSave) === AnalyticsGoalSave.Saving
    ) {
      return;
    }
    this._goalSave.set(AnalyticsGoalSave.Saving);
    const call: SetAnalyticsGoalCall = {
      scopeBarberId: request.call.scopeBarberId,
      goalMonth: LocalDate.monthKey(period.fromLocalDate),
      goalLowCents: check.goalLowCents,
      goalHighCents: check.goalHighCents,
    };
    void this.calls.setAnalyticsGoal(call).then((answer) => {
      if (this.destroyed) return;
      if (!answer.ok) {
        this._goalSave.set(AnalyticsGoalSave.Failed);
        return;
      }
      this._goalSave.set(AnalyticsGoalSave.Idle);
      this._goalOpen.set(false);
      this.refresh();
    });
  }

  /**
   * «Премахни целта» — the month's goal removed (a call with no range);
   * like a save, the sheet closes and the report is asked for again, so
   * the goal card goes back to its prompt. A failure keeps the sheet up.
   */
  removeGoal(): void {
    const period = untracked(this.period);
    const request = untracked(this.request);
    if (
      period === null ||
      request === null ||
      untracked(this._goalSave) === AnalyticsGoalSave.Saving
    ) {
      return;
    }
    this._goalSave.set(AnalyticsGoalSave.Saving);
    const call: SetAnalyticsGoalCall = {
      scopeBarberId: request.call.scopeBarberId,
      goalMonth: LocalDate.monthKey(period.fromLocalDate),
      goalLowCents: null,
      goalHighCents: null,
    };
    void this.calls.setAnalyticsGoal(call).then((answer) => {
      if (this.destroyed) return;
      if (!answer.ok) {
        this._goalSave.set(AnalyticsGoalSave.Failed);
        return;
      }
      this._goalSave.set(AnalyticsGoalSave.Idle);
      this._goalOpen.set(false);
      this.refresh();
    });
  }

  /** The same request again, the report kept on screen while it is out. */
  private refresh(): void {
    const request = untracked(this.request);
    if (request === null) return;
    this.sent = request;
    this.send(request);
  }

  /** A month of a year's day rows opens that month (v2, «The callable v2 contract»). */
  pickMonth(localDate: LocalDate): void {
    this.pickPeriod(AnalyticsPeriod.monthOf(localDate));
  }

  /** The admin's scope picker: the shop (`null`) or a barber record. */
  pickScope(scopeBarberId: BarberId | null): void {
    if (!untracked(this.readsShop)) return;
    this._scopeGone.set(false);
    this.pickedLocation.set(null);
    this.pickedScope.set(scopeBarberId);
    this.publishQuery({ barber: scopeBarberId, location: null });
  }

  /** The admin's scope picker: one location of the shop (ADR 2026-11-09). */
  pickLocation(scopeLocationId: LocationId): void {
    if (!untracked(this.readsShop)) return;
    this._scopeGone.set(false);
    this.pickedScope.set(null);
    this.pickedLocation.set(scopeLocationId);
    this.publishQuery({ barber: null, location: scopeLocationId });
  }

  // ── The URL ───────────────────────────────────────────────────────────

  /**
   * `?span=` read ONCE at its edge (`Tag.has`): `DAY`, `WEEK` or `MONTH`
   * applies; anything else — absent, empty, a span a later PR brings
   * (`YEAR`, `CUSTOM`), a typo — reads as the current month (v2, State and
   * URL). A route change outranks an earlier pick: the URL is the newer ask.
   */
  applyRouteSpan(raw: string | null): void {
    const span = Tag.has(AnalyticsSpan, raw) ? raw : null;
    this.routed.update((request) => ({ ...request, span }));
    this.pickedPeriod.set(null);
  }

  /**
   * `?from=` read ONCE at its edge (`LocalDate.parse`, Law 7.4): any
   * calendar day applies — the period is the week or month that holds it
   * (the schedule sends the day it was on). Absence, or anything that
   * names no day, is today's.
   */
  applyRouteFrom(raw: string | null): void {
    const parsed = raw ? LocalDate.parse(raw) : null;
    const from = parsed !== null && parsed.ok ? parsed.value : null;
    this.routed.update((request) => ({ ...request, from }));
    this.pickedPeriod.set(null);
  }

  /**
   * `?to=` read ONCE at its edge (`LocalDate.parse`): the custom range's
   * last day; on any other span it is ignored by `routedPeriodOf`.
   * Absence, or anything that names no day, is `null`.
   */
  applyRouteTo(raw: string | null): void {
    const parsed = raw ? LocalDate.parse(raw) : null;
    const to = parsed !== null && parsed.ok ? parsed.value : null;
    this.routed.update((request) => ({ ...request, to }));
    this.pickedPeriod.set(null);
  }

  /**
   * `?barber=` read ONCE at its edge (`BarberId.parse`): the admin's scope
   * — a record, or the shop when absent or naming no id. A barber's own
   * `?barber=` is IGNORED: only the shop's reader picks a scope. A record
   * the shop no longer has is answered by the callable (`SCOPE_UNKNOWN`).
   */
  applyRouteBarber(raw: string | null): void {
    if (!untracked(this.readsShop)) return;
    const parsed = raw ? BarberId.parse(raw) : null;
    const barber = parsed !== null && parsed.ok ? parsed.value : null;
    this._scopeGone.set(false);
    this.pickedScope.set(barber);
  }

  /**
   * `?location=` read ONCE at its edge (`LocationId.parse`), as `?barber=`:
   * the admin's location, ignored for a barber and beside a barber; a
   * location the shop no longer has is answered by the callable
   * (`LOCATION_UNKNOWN`).
   */
  applyRouteLocation(raw: string | null): void {
    if (!untracked(this.readsShop)) return;
    const parsed = raw ? LocationId.parse(raw) : null;
    const location = parsed !== null && parsed.ok ? parsed.value : null;
    this._scopeGone.set(false);
    this.pickedLocation.set(
      untracked(this.pickedScope) === null ? location : null,
    );
  }

  /**
   * THE FIRST WRITE-BACK: the one write that is not a pick. The schedule
   * sends `from=<its day>`; the address bar then says the period's first
   * day and the span and scope the store stands on, so a reload or a
   * pasted link opens the same reading. Deferred like every write.
   */
  private stateRequest(): void {
    const period = this.period();
    if (period === null) return;
    this.stated = true;
    this.publishQuery({
      span: period.analyticsSpan,
      from: period.fromLocalDate,
      to: toParamOf(period),
      barber: this.readsShop() ? this.pickedScope() : null,
      location: this.readsShop() ? this.pickedLocation() : null,
    });
  }

  /**
   * The span, the period's first day and the admin's scope live in the URL
   * so a reading can be pasted and reopened. `replaceUrl`: Back leaves the
   * screen for the schedule, it does not walk back through the morning's
   * picks. `to` is written on `CUSTOM` and cleared on every other span.
   */
  private publishQuery(
    patch: Partial<{
      readonly span: AnalyticsSpan | null;
      readonly from: LocalDate | null;
      readonly to: LocalDate | null;
      readonly barber: BarberId | null;
      readonly location: LocationId | null;
    }>,
  ): void {
    // Read UNTRACKED: a caller inside an effect must not come to depend on
    // the record this writes, or it re-runs on its own write.
    const current = untracked(this._published);
    const next = { ...current, ...patch };
    this._published.set(next);
    // NOTHING TO SAY, NO NAVIGATION: a write that leaves every parameter as
    // it was is recorded and not sent.
    if (
      next.span === current.span &&
      next.from === current.from &&
      next.to === current.to &&
      next.barber === current.barber &&
      next.location === current.location
    ) {
      return;
    }
    // AFTER THE CURRENT TASK, and coalesced: the page's route-input effects
    // reach this from inside the ACTIVATION of the page's own first
    // navigation, and a navigation started there re-enters the router
    // before that one has settled — the schedule hung a tab that way
    // (2026-09-23). Written on the next task, three parameters stated in
    // one tick are one navigation with the final record.
    if (this.urlWrite !== null) return;
    this.urlWrite = setTimeout(() => {
      this.urlWrite = null;
      if (this.destroyed) return;
      const stated = this._published();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          span: stated.span ?? null,
          from: stated.from ?? null,
          to: stated.to ?? null,
          barber: stated.barber ?? null,
          location: stated.location ?? null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 0);
  }

  /** «Опитай пак» — the same request again. */
  retry(): void {
    this.sent = null;
    this.open(untracked(this.request));
  }

  // ── The request ───────────────────────────────────────────────────────

  private open(request: AnalyticsRequest | null): void {
    if (request === null) return;
    const sent = this.sent;
    if (sent !== null && sameCall(sent, request)) {
      // The same call — only the cache key may have arrived (a barber's
      // link): paint from it if nothing is on screen yet.
      if (this._report() === null) this.paint(request);
      this.sent = request;
      return;
    }
    this.sent = request;
    this._report.set(null);
    this._seatRowsHeld.set(false);
    this._refusal.set(null);
    this.paint(request);
    this.send(request);
  }

  /** The cached report for the request, at once — a failed read or none paints nothing. */
  private paint(request: AnalyticsRequest): void {
    if (request.cacheKey === null) return;
    const cached = this.cache.readCachedReport(request.cacheKey);
    if (!cached.ok || cached.value === null) return;
    this._report.set(cached.value);
    this._seatRowsHeld.set(false);
    if (this._load() === AnalyticsLoad.Loading) {
      this._load.set(AnalyticsLoad.Refreshing);
    }
  }

  private send(request: AnalyticsRequest): void {
    const ticket = ++this.ticket;
    this._load.set(
      this._report() === null
        ? AnalyticsLoad.Loading
        : AnalyticsLoad.Refreshing,
    );
    void this.calls.requestReport(request.call).then((answer) => {
      if (this.destroyed || ticket !== this.ticket) return;
      if (answer.ok) {
        this.answered(request, answer.value);
      } else {
        this.refused(answer.error);
      }
    });
  }

  private answered(request: AnalyticsRequest, report: AnalyticsReport): void {
    this._report.set(report);
    this._seatRowsHeld.set(true);
    this._load.set(AnalyticsLoad.Ready);
    // The report's own scope keys it: a barber's names their record even
    // before the session's link has loaded. A full storage is ignored.
    this.cache.writeCachedReport(
      {
        ...request.call,
        scopeBarberId: report.reportScopeBarberId,
        scopeLocationId: report.reportScopeLocationId,
        userId: request.userId,
      },
      report,
    );
    this.cacheVersion.update((version) => version + 1);
  }

  private refused(error: PipelineError): void {
    const code = error.serverErrorCode;
    if (
      error.errorCode === PipelineErrorCode.Unauthenticated ||
      code === AnalyticsErrorCode.Unauthenticated
    ) {
      void this.router.navigate(['/auth'], {
        queryParams: { redirect: SELF_URL },
      });
      return;
    }
    if (!Tag.has(AnalyticsErrorCode, code)) {
      this._load.set(AnalyticsLoad.Failed);
      return;
    }
    switch (code) {
      case AnalyticsErrorCode.Forbidden:
      case AnalyticsErrorCode.BarberNotLinked:
        // This account may not see these figures: none of its cached
        // reports stays on the device.
        this.cache.clearCachedReports();
        this._report.set(null);
        this._seatRowsHeld.set(false);
        this._refusal.set(error);
        this._load.set(AnalyticsLoad.Refused);
        return;
      case AnalyticsErrorCode.ScopeUnknown:
        if (untracked(this.pickedScope) === null) break;
        // Back to the shop, which the effect then asks for.
        this._scopeGone.set(true);
        this.pickedScope.set(null);
        return;
      case AnalyticsErrorCode.LocationUnknown:
        if (untracked(this.pickedLocation) === null) break;
        // Back to every location, as a barber gone is.
        this._scopeGone.set(true);
        this.pickedLocation.set(null);
        return;
      case AnalyticsErrorCode.PeriodOutOfRange: {
        const routed = untracked(this.routed);
        if (
          untracked(this.pickedPeriod) === null &&
          (routed.span ?? null) === null &&
          (routed.from ?? null) === null
        ) {
          break;
        }
        // The day turned while the screen was open: back to this month —
        // the URL's ask included, or the same period would be asked again.
        this.routed.set({ span: null, from: null, to: null });
        this.pickedPeriod.set(null);
        return;
      }
      case AnalyticsErrorCode.Unauthenticated:
      case AnalyticsErrorCode.InvalidInput:
        break;
    }
    this._load.set(AnalyticsLoad.Failed);
  }
}
