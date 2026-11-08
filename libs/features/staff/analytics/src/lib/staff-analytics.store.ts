import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  type AnalyticsCall,
  AnalyticsPeriod,
  type AnalyticsReport,
  type AnalyticsSpan,
  Principal,
  Roles,
} from '@core/components';
import {
  AnalyticsErrorCode,
  type PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type { AnalyticsCacheKey } from '@core/ports';
import { type BarberId, type UserId, Tag } from '@core/primitives';
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
    a.call.fromLocalDate === b.call.fromLocalDate
  );
}

/** Where a sign-in sends a signed-out caller back to. */
const SELF_URL = '/staff/analytics';

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
  private readonly catalog = inject(CatalogContentService);

  /** The default shop's zone — "today", and the report's time, are read on it (as the callable does). */
  readonly zone = inject(ShopZoneService).defaultZone();

  /** The instant the screen opened (or was last retried) — "today" is read once from it. */
  private readonly openedAtUtcMs = signal(this.clock.nowUtcMs());

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

  /** The period on screen — this month until the switcher moves it. */
  readonly period = computed<AnalyticsPeriod | null>(() => {
    const picked = this.pickedPeriod();
    if (picked !== null) return picked;
    const today = this.today();
    return today === null ? null : AnalyticsPeriod.monthOf(today);
  });

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

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    effect(() => {
      const request = this.request();
      untracked(() => this.open(request));
    });
  }

  // ── Acts ──────────────────────────────────────────────────────────────

  /** Week | Month — the same data in another span (`StaffAnalyticsSystem.periodInSpan`). */
  pickSpan(span: AnalyticsSpan): void {
    const period = this.period();
    const today = this.today();
    if (period === null || today === null) return;
    this.pickedPeriod.set(
      StaffAnalyticsSystem.periodInSpan(period, span, today),
    );
  }

  /** ‹ › — the period before or after, only where the switcher offers one. */
  step(direction: 'previous' | 'next'): void {
    const period = this.period();
    const today = this.today();
    if (period === null || today === null) return;
    const steps = StaffAnalyticsSystem.stepsOf(period, today);
    const target = direction === 'previous' ? steps.previous : steps.next;
    if (target !== null) this.pickedPeriod.set(target);
  }

  /** The admin's scope picker: the shop (`null`) or a barber record. */
  pickScope(scopeBarberId: BarberId | null): void {
    if (!untracked(this.readsShop)) return;
    this._scopeGone.set(false);
    this.pickedScope.set(scopeBarberId);
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
      case AnalyticsErrorCode.PeriodOutOfRange:
        if (untracked(this.pickedPeriod) === null) break;
        // The day turned while the screen was open: back to this month.
        this.pickedPeriod.set(null);
        return;
      case AnalyticsErrorCode.Unauthenticated:
      case AnalyticsErrorCode.InvalidInput:
        break;
    }
    this._load.set(AnalyticsLoad.Failed);
  }
}
