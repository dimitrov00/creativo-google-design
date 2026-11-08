import { TestBed } from '@angular/core/testing';
import type {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
} from '@angular/router';
import { Subject } from 'rxjs';
import type { Principal } from '@core/components';
import { UserId } from '@core/primitives';
import { principalFixture, unwrapOk } from '@core/testing';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  SCHEDULE_ROUTE_PATH,
  ScheduleReuseStrategy,
  accountOf,
} from './schedule-reuse.strategy';

/**
 * The schedule is parked while «Анализи» is open and re-attached on Back
 * (staff-analytics-v2 PR 1); every other route keeps the router's default;
 * a parked tree never outlives the account that parked it.
 *
 * `test` rather than `it`: apps/web lints with eslint-plugin-playwright,
 * whose `no-standalone-expect` only recognises `test()`.
 */
describe('ScheduleReuseStrategy — the parked schedule', () => {
  const IVAN = unwrapOk(UserId.parse('user-ivan'));
  const NIKO = unwrapOk(UserId.parse('user-niko'));
  let principal$: Subject<Principal>;
  let strategy: ScheduleReuseStrategy;

  const routeOf = (path: string): ActivatedRouteSnapshot =>
    ({ routeConfig: { path } }) as unknown as ActivatedRouteSnapshot;
  const handleOf = (
    destroy = vi.fn(),
  ): DetachedRouteHandle & { destroy: () => void } =>
    ({
      componentRef: { destroy },
      destroy,
    }) as unknown as DetachedRouteHandle & {
      destroy: () => void;
    };

  beforeEach(() => {
    principal$ = new Subject<Principal>();
    TestBed.configureTestingModule({
      providers: [
        ScheduleReuseStrategy,
        {
          provide: AUTH_SESSION_PORTS,
          useValue: { observePrincipal: () => principal$.asObservable() },
        },
      ],
    });
    strategy = TestBed.inject(ScheduleReuseStrategy);
  });

  test('detaches only the schedule, and hands the parked tree back to it alone', () => {
    const schedule = routeOf(SCHEDULE_ROUTE_PATH);
    const analytics = routeOf('staff/analytics');
    expect(strategy.shouldDetach(schedule)).toBe(true);
    expect(strategy.shouldDetach(analytics)).toBe(false);
    expect(strategy.shouldAttach(schedule)).toBe(false);

    const parked = handleOf();
    strategy.store(schedule, parked);
    expect(strategy.shouldAttach(schedule)).toBe(true);
    expect(strategy.shouldAttach(analytics)).toBe(false);
    expect(strategy.retrieve(schedule)).toBe(parked);
    expect(strategy.retrieve(analytics)).toBeNull();

    // The router clears the slot after re-attaching: the tree is live, not destroyed.
    strategy.store(schedule, null);
    expect(strategy.shouldAttach(schedule)).toBe(false);
    expect(parked.destroy).not.toHaveBeenCalled();
  });

  test('ignores a store for another route', () => {
    strategy.store(routeOf('staff/analytics'), handleOf());
    expect(strategy.shouldAttach(routeOf(SCHEDULE_ROUTE_PATH))).toBe(false);
  });

  test('destroys the parked tree when the account changes, not before', () => {
    const schedule = routeOf(SCHEDULE_ROUTE_PATH);
    const parked = handleOf();
    strategy.store(schedule, parked);

    principal$.next(principalFixture.staff(IVAN)); // the account that parked it
    principal$.next(principalFixture.staff(IVAN)); // a token refresh, same account
    expect(parked.destroy).not.toHaveBeenCalled();
    expect(strategy.shouldAttach(schedule)).toBe(true);

    principal$.next(principalFixture.anonymous()); // signed out
    expect(parked.destroy).toHaveBeenCalledTimes(1);
    expect(strategy.shouldAttach(schedule)).toBe(false);

    // The next account parks its own tree, which the strategy follows anew.
    principal$.next(principalFixture.staff(NIKO));
    const next = handleOf();
    strategy.store(schedule, next);
    expect(strategy.retrieve(schedule)).toBe(next);
    expect(next.destroy).not.toHaveBeenCalled();
  });

  test('drop() destroys the parked tree once and empties the slot', () => {
    const schedule = routeOf(SCHEDULE_ROUTE_PATH);
    const parked = handleOf();
    strategy.store(schedule, parked);
    strategy.drop();
    strategy.drop();
    expect(parked.destroy).toHaveBeenCalledTimes(1);
    expect(strategy.retrieve(schedule)).toBeNull();
  });

  test('accountOf reads the signed-in account, null for nobody', () => {
    expect(accountOf(principalFixture.staff(IVAN))).toBe(IVAN);
    expect(accountOf(principalFixture.client(NIKO))).toBe(NIKO);
    expect(accountOf(principalFixture.anonymous())).toBeNull();
  });
});
