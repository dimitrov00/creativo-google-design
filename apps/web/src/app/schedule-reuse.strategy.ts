import { type ComponentRef, Injectable, inject } from '@angular/core';
import {
  type ActivatedRouteSnapshot,
  BaseRouteReuseStrategy,
  type DetachedRouteHandle,
} from '@angular/router';
import { type Subscription, distinctUntilChanged, map, skip } from 'rxjs';
import type { Principal } from '@core/components';
import type { UserId } from '@core/primitives';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';

/**
 * The one route the strategy keeps: the schedule's (`app.routes.ts`), by its
 * route path — a query-param sync is the same config, and the strategy's
 * default `shouldReuseRoute` already keeps those in place.
 */
export const SCHEDULE_ROUTE_PATH = 'staff/schedule';

/**
 * THE SCHEDULE SURVIVES A VISIT TO «Анализи» (staff-analytics-v2, PR 1,
 * «`RouteReuseStrategy` for the schedule?»).
 *
 * Measured on the optimised build at 4× CPU throttle: Back from the analytics
 * page re-mounted the schedule in one 52–64 ms main-thread task — three or
 * four frames on a mid-range phone — and re-issued five to eight Firestore
 * requests for the day it had just shown. The design's rule for that
 * measurement is a detach/attach strategy for that one route, so leaving the
 * schedule parks its component tree (DOM, signals, scroll position, the live
 * day's listeners) and coming back re-attaches it in place of building it
 * again. Every other route keeps the router's default behaviour.
 *
 * One parked handle, and it belongs to the account that parked it: the first
 * time a schedule is stored the strategy starts watching the session, and
 * the moment the signed-in account changes — a sign-out, a different staff
 * member signing in on the same phone — the parked tree is destroyed rather
 * than handed to the next principal.
 */
@Injectable()
export class ScheduleReuseStrategy extends BaseRouteReuseStrategy {
  private readonly session = inject(AUTH_SESSION_PORTS);
  private handle: DetachedRouteHandle | null = null;
  private account: Subscription | null = null;

  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return isSchedule(route);
  }

  /** The router stores the detached tree on leaving, and `null` after re-attaching it. */
  override store(
    route: ActivatedRouteSnapshot,
    handle: DetachedRouteHandle | null,
  ): void {
    if (!isSchedule(route)) return;
    if (handle !== null && this.handle !== null && this.handle !== handle) {
      destroyHandle(this.handle);
    }
    this.handle = handle;
    if (handle !== null) this.followAccount();
  }

  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return isSchedule(route) && this.handle !== null;
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    return isSchedule(route) ? this.handle : null;
  }

  /** Destroy the parked schedule, if any; the next visit builds a fresh one. */
  drop(): void {
    if (this.handle === null) return;
    destroyHandle(this.handle);
    this.handle = null;
  }

  private followAccount(): void {
    this.account ??= this.session
      .observePrincipal()
      .pipe(
        map(accountOf),
        distinctUntilChanged(),
        // The stream opens with the account that parked the tree.
        skip(1),
      )
      .subscribe(() => this.drop());
  }
}

function isSchedule(route: ActivatedRouteSnapshot): boolean {
  return route.routeConfig?.path === SCHEDULE_ROUTE_PATH;
}

/** The signed-in account behind a principal — `null` when nobody is. */
export function accountOf(principal: Principal): UserId | null {
  return 'userId' in principal ? principal.userId : null;
}

/**
 * A detached handle is opaque to the router's public types; the component
 * reference it carries is what must be destroyed so its effects, listeners
 * and DOM go with it.
 */
function destroyHandle(handle: DetachedRouteHandle): void {
  const { componentRef } = handle as { componentRef?: ComponentRef<unknown> };
  componentRef?.destroy();
}
