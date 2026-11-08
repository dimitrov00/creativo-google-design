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
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsComparison,
  AnalyticsSpan,
  Principal,
  Roles,
} from '@core/components';
import {
  AnalyticsErrorCode,
  type PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type { AnalyticsCacheKey } from '@core/ports';
import { BarberId, LocalDate, type UserId, Tag } from '@core/primitives';
import {
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
import { AnalyticsLoad } from './analytics.vm';

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
    a.call.analyticsSpan === b.call.analyticsSpan &&
    a.call.fromLocalDate === b.call.fromLocalDate &&
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
};

/** The period of `span` (this month's when none) that holds `from` (today when none). */
function routedPeriodOf(
  span: AnalyticsSpan | null,
  from: LocalDate | null,
  today: LocalDate,
): AnalyticsPeriod {
  const anchor = from ?? today;
  const ofSpan = (day: LocalDate): AnalyticsPeriod =>
    span === AnalyticsSpan.Day
      ? AnalyticsPeriod.dayOf(day)
      : span === AnalyticsSpan.Week
        ? AnalyticsPeriod.weekOf(day)
        : AnalyticsPeriod.monthOf(day);
  const landed = ofSpan(anchor);
  // A day the switcher could never reach — past the reach, or ahead of
  // today — lands on the span's current period, as `periodInSpan` does.
  return AnalyticsPeriod.isWithinRange(landed, today) ? landed : ofSpan(today);
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
    const { span, from } = this.routed();
    if (today === null || span === undefined || from === undefined) {
      return null;
    }
    return routedPeriodOf(span, from, today);
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
    readonly barber: BarberId | null | undefined;
  }>({ span: undefined, from: undefined, barber: undefined });
  readonly published = this._published.asReadonly();

  /** The admin's pick; `null` is the shop. A barber's is always their own. */
  private readonly pickedScope = signal<BarberId | null>(null);
  readonly scopeBarberId = this.pickedScope.asReadonly();

  /** The admin's scope picker, in its order; `null` for a barber. */
  readonly scopeChoices = computed<readonly AnalyticsScopeChoice[] | null>(
    () =>
      this.readsShop()
        ? StaffAnalyticsSystem.scopeChoicesOf(
            this.catalog.barbers().map((barber) => barber.id),
            this.linkedBarberId(),
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
    const userId = this.identity.userId();
    const period = this.period();
    if (userId === null || period === null) return null;
    const shop = this.readsShop();
    const call: AnalyticsCall = {
      // A barber sends none: the callable reads their record off the stored user.
      scopeBarberId: shop ? this.pickedScope() : null,
      fromLocalDate: period.fromLocalDate,
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
  });

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
    });
  }

  /** The admin's scope picker: the shop (`null`) or a barber record. */
  pickScope(scopeBarberId: BarberId | null): void {
    if (!untracked(this.readsShop)) return;
    this._scopeGone.set(false);
    this.pickedScope.set(scopeBarberId);
    this.publishQuery({ barber: scopeBarberId });
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

  /** `?to=` — accepted and IGNORED until the `CUSTOM` span (PR 4b) gives it a meaning. */
  applyRouteTo(raw: string | null): void {
    void raw;
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
      barber: this.readsShop() ? this.pickedScope() : null,
    });
  }

  /**
   * The span, the period's first day and the admin's scope live in the URL
   * so a reading can be pasted and reopened. `replaceUrl`: Back leaves the
   * screen for the schedule, it does not walk back through the morning's
   * picks. `to` is left as it is (`merge`) until a later PR writes it.
   */
  private publishQuery(
    patch: Partial<{
      readonly span: AnalyticsSpan | null;
      readonly from: LocalDate | null;
      readonly barber: BarberId | null;
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
      next.barber === current.barber
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
          barber: stated.barber ?? null,
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
        userId: request.userId,
      },
      report,
    );
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
        this.routed.set({ span: null, from: null });
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
