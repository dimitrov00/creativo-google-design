import { type WritableSignal, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsComparison,
  AnalyticsSpan,
  type Principal,
  Role,
  SetAnalyticsGoalCall,
} from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import type { AnalyticsCallPorts } from '@core/ports';
import {
  AnalyticsGoalKey,
  type BarberId,
  LocalDate,
  type PriceCents,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  analyticsReportFixture,
  memoryAnalyticsCachePorts,
  principalFixture,
  shopReportFixture,
} from '@core/testing';
import {
  ANALYTICS_CACHE_PORTS,
  ANALYTICS_CALL_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { CatalogContentService } from '@creativo/features/shared/catalog';
import { IVAN, NIKO } from '../testing/analytics.fixtures';
import {
  AnalyticsGoalRefusal,
  AnalyticsGoalSave,
  AnalyticsLoad,
} from './analytics.vm';
import { StaffAnalyticsStore } from './staff-analytics.store';

const BARBER_UID = UserId.of('dev-staff-ivan');
const ADMIN_UID = UserId.of('dev-admin');
const SEPTEMBER = AnalyticsPeriod.monthOf(FIXTURE_TODAY);

type Answer = Result<AnalyticsReport, PipelineError>;

type GoalAnswer = Result<SetAnalyticsGoalCall.Set, PipelineError>;

/** The callable, answered by hand: each request waits until the spec says. */
function heldCalls() {
  const calls: AnalyticsCall[] = [];
  const goals: SetAnalyticsGoalCall[] = [];
  const pending: ((answer: Answer) => void)[] = [];
  const pendingGoals: ((answer: GoalAnswer) => void)[] = [];
  const ports: AnalyticsCallPorts = {
    requestReport: (call) => {
      calls.push(call);
      return new Promise<Answer>((resolve) => pending.push(resolve));
    },
    setAnalyticsGoal: (call) => {
      goals.push(call);
      return new Promise<GoalAnswer>((resolve) => pendingGoals.push(resolve));
    },
  };
  return {
    ports,
    calls,
    goals,
    /** Answers the oldest goal write still waiting, then lets the store settle. */
    answerGoal: async (answer: GoalAnswer) => {
      pendingGoals.shift()?.(answer);
      await Promise.resolve();
      await Promise.resolve();
      TestBed.tick();
    },
    /** Answers the oldest request still waiting, then lets the store settle. */
    answer: async (answer: Answer) => {
      pending.shift()?.(answer);
      await Promise.resolve();
      await Promise.resolve();
      TestBed.tick();
    },
  };
}

function refusal(errorCode: string, status = 'permission-denied') {
  return Result.err(
    PipelineError.fromWire(`functions/${status}`, { errorCode }),
  );
}

/** The URL's four parameters as the page's binder hands them to the store; absent is `null`. */
type RouteText = {
  readonly span?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly barber?: string | null;
};

/** Lets the deferred URL write (`setTimeout(0)`) and the router run to rest. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  TestBed.tick();
}

function build(options: {
  readonly principal: Principal;
  readonly linkedBarberId?: BarberId | null;
  readonly cache?: ReturnType<typeof memoryAnalyticsCachePorts>;
  /** What the URL says on arrival — silent by default, as the page's binder speaks for every parameter. */
  readonly route?: RouteText;
  /** The clock the store reads; pinned at `FIXTURE_NOW_UTC_MS` by default. */
  readonly nowUtcMs?: () => UtcEpochMs;
}) {
  const principal = signal<Principal>(options.principal);
  const linked: WritableSignal<BarberId | null> = signal(
    options.linkedBarberId ?? null,
  );
  const calls = heldCalls();
  const cache = options.cache ?? memoryAnalyticsCachePorts();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      StaffAnalyticsStore,
      { provide: ANALYTICS_CALL_PORTS, useValue: calls.ports },
      { provide: ANALYTICS_CACHE_PORTS, useValue: cache },
      {
        provide: CLOCK_PORTS,
        useValue: { nowUtcMs: options.nowUtcMs ?? (() => FIXTURE_NOW_UTC_MS) },
      },
      {
        provide: ShopZoneService,
        useValue: { defaultZone: () => signal(FIXTURE_TIME_ZONE) },
      },
      {
        provide: SessionIdentityService,
        useValue: {
          principal,
          userId: computed(() => {
            const held = principal();
            return 'userId' in held ? held.userId : null;
          }),
          linkedBarberId: linked,
        },
      },
      {
        provide: CatalogContentService,
        useValue: {
          barbers: signal([{ id: IVAN }, { id: NIKO }]),
        },
      },
    ],
  });
  const store = TestBed.inject(StaffAnalyticsStore);
  TestBed.tick();
  // The page's binder, in its first activation: every parameter spoken once.
  const route = options.route ?? {};
  store.applyRouteSpan(route.span ?? null);
  store.applyRouteFrom(route.from ?? null);
  store.applyRouteTo(route.to ?? null);
  store.applyRouteBarber(route.barber ?? null);
  TestBed.tick();
  return { store, calls, cache, linked, router: TestBed.inject(Router) };
}

const barber = () => principalFixture.staff(BARBER_UID, [Role.Barber]);
const admin = () => principalFixture.staff(ADMIN_UID, [Role.Admin]);

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('StaffAnalyticsStore — a barber', () => {
  it('opens on this month, sends no scope, and paints the cached report at once', async () => {
    const cached = analyticsReportFixture({
      reportTakingsCents: 1000 as PriceCents,
      reportSeatRows: [],
    });
    const cache = memoryAnalyticsCachePorts([
      [
        {
          userId: BARBER_UID,
          scopeBarberId: IVAN,
          analyticsSpan: AnalyticsSpan.Month,
          toLocalDate: null,
          analyticsComparison: AnalyticsComparison.Previous,
          fromLocalDate: SEPTEMBER.fromLocalDate,
        },
        cached,
      ],
    ]);
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      cache,
    });

    expect(store.period()).toEqual(SEPTEMBER);
    expect(store.readsShop()).toBe(false);
    expect(store.scopeChoices()).toBeNull();
    // The first frame: the cached figures, the request out.
    expect(store.report()).toBe(cached);
    expect(store.seatRowsHeld()).toBe(false);
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Refreshing);
    expect(calls.calls).toEqual([
      {
        scopeBarberId: null,
        fromLocalDate: SEPTEMBER.fromLocalDate,
        analyticsSpan: AnalyticsSpan.Month,
        toLocalDate: null,
        analyticsComparison: AnalyticsComparison.Previous,
      },
    ]);
    expect(store.scheduleBarberId()).toBe(IVAN);

    const fresh = analyticsReportFixture();
    await calls.answer(Result.ok(fresh));

    expect(store.report()).toBe(fresh);
    expect(store.seatRowsHeld()).toBe(true);
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Ready);
    // Cached again under the report's own scope; the double drops seat rows as the adapter does.
    expect(cache.state.writes.at(-1)?.key).toEqual({
      userId: BARBER_UID,
      scopeBarberId: IVAN,
      analyticsSpan: AnalyticsSpan.Month,
      toLocalDate: null,
      analyticsComparison: AnalyticsComparison.Previous,
      fromLocalDate: SEPTEMBER.fromLocalDate,
    });
  });

  it('with nothing cached, shows the placeholder state until the answer', async () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    expect(store.report()).toBeNull();
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Loading);
    await calls.answer(Result.ok(analyticsReportFixture()));
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Ready);
  });

  it('a link that arrives late paints from the cache without asking again', () => {
    const cached = analyticsReportFixture({ reportSeatRows: [] });
    const cache = memoryAnalyticsCachePorts([
      [
        {
          userId: BARBER_UID,
          scopeBarberId: IVAN,
          analyticsSpan: AnalyticsSpan.Month,
          toLocalDate: null,
          analyticsComparison: AnalyticsComparison.Previous,
          fromLocalDate: SEPTEMBER.fromLocalDate,
        },
        cached,
      ],
    ]);
    const { store, calls, linked } = build({ principal: barber(), cache });
    expect(store.report()).toBeNull();
    linked.set(IVAN);
    TestBed.tick();
    expect(store.report()).toBe(cached);
    expect(calls.calls).toHaveLength(1);
  });

  it('a refusal (not linked) deletes the account’s cache and says why', async () => {
    const cache = memoryAnalyticsCachePorts([
      [
        {
          userId: BARBER_UID,
          scopeBarberId: IVAN,
          analyticsSpan: AnalyticsSpan.Month,
          toLocalDate: null,
          analyticsComparison: AnalyticsComparison.Previous,
          fromLocalDate: SEPTEMBER.fromLocalDate,
        },
        analyticsReportFixture(),
      ],
    ]);
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      cache,
    });
    await calls.answer(
      refusal('ANALYTICS_BARBER_NOT_LINKED', 'failed-precondition'),
    );
    expect(cache.state.clears).toBe(1);
    expect(cache.state.entries.size).toBe(0);
    expect(store.report()).toBeNull();
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Refused);
    expect(store.refusal()?.serverErrorCode).toBe(
      'ANALYTICS_BARBER_NOT_LINKED',
    );
  });

  it('ANALYTICS_FORBIDDEN is a refusal too', async () => {
    const { store, calls, cache } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    await calls.answer(refusal('ANALYTICS_FORBIDDEN'));
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Refused);
    expect(cache.state.clears).toBe(1);
  });

  it('a call that fails keeps the cached figures on screen, and retries', async () => {
    const cached = analyticsReportFixture({ reportSeatRows: [] });
    const cache = memoryAnalyticsCachePorts([
      [
        {
          userId: BARBER_UID,
          scopeBarberId: IVAN,
          analyticsSpan: AnalyticsSpan.Month,
          toLocalDate: null,
          analyticsComparison: AnalyticsComparison.Previous,
          fromLocalDate: SEPTEMBER.fromLocalDate,
        },
        cached,
      ],
    ]);
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      cache,
    });
    await calls.answer(
      Result.err(PipelineError.bare(PipelineErrorCode.Unknown)),
    );
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Failed);
    expect(store.report()).toBe(cached);
    expect(cache.state.clears).toBe(0);

    store.retry();
    expect(calls.calls).toHaveLength(2);
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Refreshing);
    await calls.answer(Result.ok(analyticsReportFixture()));
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Ready);
  });

  it('a signed-out answer sends the caller to sign in, and back here after', async () => {
    const { calls } = build({ principal: barber(), linkedBarberId: IVAN });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    await calls.answer(refusal('ANALYTICS_UNAUTHENTICATED', 'unauthenticated'));
    expect(navigate).toHaveBeenCalledWith(['/auth'], {
      queryParams: { redirect: '/staff/analytics' },
    });
  });

  it('steps back, never forward past today, and switches span on the same data', () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    store.step('next');
    expect(store.period()).toEqual(SEPTEMBER);
    store.step('previous');
    TestBed.tick();
    expect(store.period()?.fromLocalDate).toBe('2026-08-01');
    store.pickSpan(AnalyticsSpan.Week);
    TestBed.tick();
    // A past month switches to its last week.
    expect(store.period()?.fromLocalDate).toBe('2026-08-31');
    expect(store.period()?.analyticsSpan).toBe(AnalyticsSpan.Week);
    expect(calls.calls.map((call) => call.analyticsSpan)).toEqual([
      'MONTH',
      'MONTH',
      'WEEK',
    ]);
  });

  it('drops an answer to a request that was replaced', async () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    store.step('previous');
    TestBed.tick();
    // The September answer arrives after August was asked for.
    await calls.answer(Result.ok(analyticsReportFixture()));
    expect(store.report()).toBeNull();
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Loading);
  });

  it('a barber cannot pick another scope', () => {
    const { store } = build({ principal: barber(), linkedBarberId: IVAN });
    store.pickScope(NIKO);
    expect(store.scopeBarberId()).toBeNull();
  });
});

describe('StaffAnalyticsStore — the month’s goal (staff-analytics-v2 CUJ 6)', () => {
  it('opens the sheet on the stored goal, refuses an empty or an inverted range, admits one in cents', async () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    await calls.answer(
      Result.ok(
        analyticsReportFixture({
          reportGoalLowCents: 100_000 as PriceCents,
          reportGoalHighCents: 150_000 as PriceCents,
        }),
      ),
    );
    store.openGoal();
    expect(store.goalOpen()).toBe(true);
    expect(store.goalLow()).toBe(100_000);
    expect(store.goalHigh()).toBe(150_000);
    expect(store.goalCheck().goalRefusal).toBeNull();

    store.goalHigh.set(null);
    expect(store.goalCheck().goalRefusal).toBe(AnalyticsGoalRefusal.Incomplete);
    store.goalHigh.set(50_000);
    expect(store.goalCheck().goalRefusal).toBe(
      AnalyticsGoalRefusal.InvalidRange,
    );
    store.goalLow.set(0);
    store.goalHigh.set(50_000);
    expect(store.goalCheck().goalRefusal).toBe(
      AnalyticsGoalRefusal.InvalidRange,
    );
    store.goalLow.set(180_000);
    store.goalHigh.set(220_000);
    expect(store.goalCheck()).toEqual({
      goalRefusal: null,
      goalLowCents: 180_000,
      goalHighCents: 220_000,
    });
    store.closeGoal();
    expect(store.goalOpen()).toBe(false);
  });

  it('saves the range for the period’s month and the request’s scope, closes the sheet and asks for the report again', async () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    const first = analyticsReportFixture();
    await calls.answer(Result.ok(first));
    store.openGoal();
    expect(store.goalCheck().goalRefusal).toBe(AnalyticsGoalRefusal.Incomplete);
    // A refused range is not sent.
    store.saveGoal();
    expect(calls.goals).toEqual([]);

    store.goalLow.set(180_000);
    store.goalHigh.set(220_000);
    store.saveGoal();
    expect(store.goalSave()).toBe(AnalyticsGoalSave.Saving);
    // A second «Запази» while the first is out sends nothing.
    store.saveGoal();
    expect(calls.goals).toEqual([
      {
        scopeBarberId: null,
        goalMonth: '2026-09',
        goalLowCents: 180_000,
        goalHighCents: 220_000,
      },
    ]);
    await calls.answerGoal(
      Result.ok({
        goalKey: AnalyticsGoalKey.of(
          IVAN,
          LocalDate.monthKey(SEPTEMBER.fromLocalDate),
        ),
        goalSetAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    );
    expect(store.goalSave()).toBe(AnalyticsGoalSave.Idle);
    expect(store.goalOpen()).toBe(false);
    // The report is asked for again, kept on screen meanwhile.
    expect(calls.calls).toHaveLength(2);
    expect(store.report()).toBe(first);
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Refreshing);
    const second = analyticsReportFixture({
      reportGoalLowCents: 180_000 as PriceCents,
      reportGoalHighCents: 220_000 as PriceCents,
    });
    await calls.answer(Result.ok(second));
    expect(store.report()).toBe(second);
    expect(store.analyticsLoad()).toBe(AnalyticsLoad.Ready);
  });

  it('a refused or failed save keeps the sheet up and says so; the next attempt clears it', async () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    await calls.answer(Result.ok(analyticsReportFixture()));
    store.openGoal();
    store.goalLow.set(180_000);
    store.goalHigh.set(220_000);
    store.saveGoal();
    await calls.answerGoal(
      refusal('ANALYTICS_GOAL_INVALID_RANGE', 'invalid-argument'),
    );
    expect(store.goalSave()).toBe(AnalyticsGoalSave.Failed);
    expect(store.goalOpen()).toBe(true);
    expect(calls.calls).toHaveLength(1);
    store.saveGoal();
    expect(store.goalSave()).toBe(AnalyticsGoalSave.Saving);
    expect(calls.goals).toHaveLength(2);
  });

  it('the admin’s save names the scope on screen', async () => {
    const { store, calls } = build({ principal: admin() });
    await calls.answer(Result.ok(shopReportFixture()));
    store.pickScope(NIKO);
    await calls.answer(Result.ok(analyticsReportFixture()));
    store.openGoal();
    store.goalLow.set(100_000);
    store.goalHigh.set(100_000);
    store.saveGoal();
    expect(calls.goals.at(-1)?.scopeBarberId).toBe(NIKO);
  });
});

describe('StaffAnalyticsStore — the admin', () => {
  it('opens on the shop, its picker the shop, «Аз» and the barbers; a pick asks for that barber', async () => {
    const { store, calls, cache } = build({
      principal: admin(),
      linkedBarberId: NIKO,
    });
    expect(store.readsShop()).toBe(true);
    expect(store.scopeChoices()).toEqual([
      { scopeBarberId: null, scopeMine: false },
      { scopeBarberId: NIKO, scopeMine: true },
      { scopeBarberId: IVAN, scopeMine: false },
    ]);
    expect(calls.calls[0]?.scopeBarberId).toBeNull();
    await calls.answer(Result.ok(shopReportFixture()));
    expect(cache.state.writes[0]?.key.scopeBarberId).toBeNull();

    store.pickScope(IVAN);
    TestBed.tick();
    expect(calls.calls[1]?.scopeBarberId).toBe(IVAN);
    expect(store.scheduleBarberId()).toBe(IVAN);
  });

  it('a barber who no longer exists falls back to the shop and says so', async () => {
    const { store, calls } = build({ principal: admin() });
    await calls.answer(Result.ok(shopReportFixture()));
    store.pickScope(IVAN);
    TestBed.tick();
    await calls.answer(refusal('ANALYTICS_SCOPE_UNKNOWN', 'not-found'));
    TestBed.tick();
    expect(store.scopeBarberId()).toBeNull();
    expect(store.scopeGone()).toBe(true);
    expect(calls.calls.at(-1)?.scopeBarberId).toBeNull();
  });
});

describe('StaffAnalyticsStore — the URL (staff-analytics-v2, State and URL)', () => {
  it('?span=WEEK&from=<day> opens on the week that holds the day, with ONE call', () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      route: { span: 'WEEK', from: '2026-09-30' },
    });
    expect(store.period()).toEqual(AnalyticsPeriod.weekOf(FIXTURE_TODAY));
    expect(store.period()?.fromLocalDate).toBe('2026-09-28');
    // Not this month first and the week after: nothing stands before the URL has spoken.
    expect(calls.calls).toEqual([
      {
        scopeBarberId: null,
        fromLocalDate: '2026-09-28',
        analyticsSpan: AnalyticsSpan.Week,
        toLocalDate: null,
        analyticsComparison: AnalyticsComparison.Previous,
      },
    ]);
  });

  it('?span=MONTH&from=<day> is the month that holds the day', () => {
    const { store } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      route: { span: 'MONTH', from: '2026-08-14' },
    });
    expect(store.period()?.fromLocalDate).toBe('2026-08-01');
    expect(store.period()?.analyticsSpan).toBe(AnalyticsSpan.Month);
  });

  it.each(['QUARTER', 'CUSTOM', 'week', ''])(
    'an unknown span (%s) reads as a month; absent from is this one',
    (span) => {
      const { store } = build({
        principal: barber(),
        linkedBarberId: IVAN,
        route: { span },
      });
      expect(store.period()).toEqual(SEPTEMBER);
    },
  );

  it.each(['2026-02-30', 'yesterday', '2027-01-05', '2020-01-01'])(
    'a from that names no reachable day (%s) is this month',
    (from) => {
      const { store } = build({
        principal: barber(),
        linkedBarberId: IVAN,
        route: { from },
      });
      expect(store.period()).toEqual(SEPTEMBER);
    },
  );

  it('?to= is accepted and ignored in this PR', () => {
    const { store } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      route: { to: '2026-09-15' },
    });
    expect(store.period()).toEqual(SEPTEMBER);
  });

  it('a barber’s ?barber= is ignored: their own figures, no scope sent', () => {
    const { store, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      route: { barber: 'niko' },
    });
    expect(store.scopeBarberId()).toBeNull();
    expect(calls.calls).toHaveLength(1);
    expect(calls.calls[0]?.scopeBarberId).toBeNull();
  });

  it('an admin’s ?barber= is the scope, asked for ONCE; one that names no id is the shop', () => {
    const { store, calls } = build({
      principal: admin(),
      linkedBarberId: NIKO,
      route: { barber: 'ivan' },
    });
    expect(store.scopeBarberId()).toBe(IVAN);
    expect(calls.calls).toEqual([
      {
        scopeBarberId: IVAN,
        fromLocalDate: SEPTEMBER.fromLocalDate,
        analyticsSpan: AnalyticsSpan.Month,
        toLocalDate: null,
        analyticsComparison: AnalyticsComparison.Previous,
      },
    ]);
    TestBed.resetTestingModule();
    const blank = build({ principal: admin(), route: { barber: ' ' } });
    expect(blank.store.scopeBarberId()).toBeNull();
  });

  it('the first write-back states the period’s first day, the span and, for an admin, the scope', async () => {
    const { store, router } = build({
      principal: admin(),
      linkedBarberId: NIKO,
      route: { span: 'WEEK', from: '2026-09-30', barber: 'ivan' },
    });
    // Recorded at once, so the echo of the write compares equal…
    expect(store.published()).toEqual({
      span: AnalyticsSpan.Week,
      from: '2026-09-28',
      to: null,
      barber: IVAN,
    });
    // …and written on the next task, never inside the activation.
    expect(router.url).toBe('/');
    await settle();
    expect(router.url).toBe('/?span=WEEK&from=2026-09-28&barber=ivan');
  });

  it('a barber’s write-back names no barber', async () => {
    const { store, router } = build({
      principal: barber(),
      linkedBarberId: IVAN,
      route: { barber: 'niko' },
    });
    expect(store.published()).toEqual({
      span: AnalyticsSpan.Month,
      from: '2026-09-01',
      to: null,
      barber: null,
    });
    await settle();
    expect(router.url).toBe('/?span=MONTH&from=2026-09-01');
  });

  it('nothing is written before a request stands', async () => {
    // No account yet: the request is null, the URL stays as it was.
    const { store, router } = build({
      principal: principalFixture.anonymous(),
      route: { span: 'WEEK' },
    });
    expect(store.published()).toEqual({
      span: undefined,
      from: undefined,
      to: undefined,
      barber: undefined,
    });
    await settle();
    expect(router.url).toBe('/');
  });

  it('each pick replaces the URL (replaceUrl, merge) with the period’s first day', async () => {
    const { store, router } = build({
      principal: admin(),
      linkedBarberId: NIKO,
    });
    await settle();
    const navigate = vi.spyOn(router, 'navigate');
    store.step('previous');
    expect(store.published().from).toBe('2026-08-01');
    store.pickSpan(AnalyticsSpan.Week);
    await settle();
    // Two picks in one task: one navigation with the final record.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: {
          span: 'WEEK',
          from: '2026-08-31',
          to: null,
          barber: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
    expect(router.url).toBe('/?span=WEEK&from=2026-08-31');

    store.pickScope(IVAN);
    await settle();
    expect(router.url).toBe('/?span=WEEK&from=2026-08-31&barber=ivan');
    store.pickScope(null);
    await settle();
    expect(router.url).toBe('/?span=WEEK&from=2026-08-31');
  });

  it('the echo guard: what the URL says after a write is what the store published', async () => {
    const { store, router, calls } = build({
      principal: barber(),
      linkedBarberId: IVAN,
    });
    store.step('previous');
    await settle();
    const params = router.parseUrl(router.url).queryParams;
    expect(params).toEqual({ span: 'MONTH', from: '2026-08-01' });
    // The page's binder compares the URL's text against the record and
    // hands nothing on; a route request would have cleared the pick.
    expect(params['span']).toBe(store.published().span);
    expect(params['from']).toBe(store.published().from);
    expect(store.period()?.fromLocalDate).toBe('2026-08-01');
    expect(calls.calls).toHaveLength(2);
  });

  it('a new route request outranks the pick', () => {
    const { store } = build({ principal: barber(), linkedBarberId: IVAN });
    store.step('previous');
    TestBed.tick();
    expect(store.period()?.fromLocalDate).toBe('2026-08-01');
    store.applyRouteFrom('2026-09-15');
    store.applyRouteSpan('WEEK');
    TestBed.tick();
    expect(store.period()?.fromLocalDate).toBe('2026-09-14');
  });

  it('re-reads now every 60 s while attached, and stops on destroy', () => {
    vi.useFakeTimers();
    try {
      let now = FIXTURE_NOW_UTC_MS;
      const { store } = build({
        principal: barber(),
        linkedBarberId: IVAN,
        nowUtcMs: () => now,
      });
      expect(store.now()).toBe(FIXTURE_NOW_UTC_MS);
      now = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000);
      vi.advanceTimersByTime(59_000);
      expect(store.now()).toBe(FIXTURE_NOW_UTC_MS);
      vi.advanceTimersByTime(1_000);
      expect(store.now()).toBe(now);
      // "Today" is read once, at the open.
      expect(store.today()).toBe(FIXTURE_TODAY);

      TestBed.resetTestingModule();
      now = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 10 * 60_000);
      vi.advanceTimersByTime(60_000);
      expect(store.now()).not.toBe(now);
    } finally {
      vi.useRealTimers();
    }
  });
});
