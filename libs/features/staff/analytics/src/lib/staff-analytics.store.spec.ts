import { type WritableSignal, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnalyticsCall,
  AnalyticsPeriod,
  type AnalyticsReport,
  AnalyticsSpan,
  type Principal,
  Role,
} from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import type { AnalyticsCallPorts } from '@core/ports';
import {
  type BarberId,
  type PriceCents,
  Result,
  UserId,
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
import { AnalyticsLoad } from './analytics.vm';
import { StaffAnalyticsStore } from './staff-analytics.store';

const BARBER_UID = UserId.of('dev-staff-ivan');
const ADMIN_UID = UserId.of('dev-admin');
const SEPTEMBER = AnalyticsPeriod.monthOf(FIXTURE_TODAY);

type Answer = Result<AnalyticsReport, PipelineError>;

/** The callable, answered by hand: each request waits until the spec says. */
function heldCalls() {
  const calls: AnalyticsCall[] = [];
  const pending: ((answer: Answer) => void)[] = [];
  const ports: AnalyticsCallPorts = {
    requestReport: (call) => {
      calls.push(call);
      return new Promise<Answer>((resolve) => pending.push(resolve));
    },
  };
  return {
    ports,
    calls,
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

function build(options: {
  readonly principal: Principal;
  readonly linkedBarberId?: BarberId | null;
  readonly cache?: ReturnType<typeof memoryAnalyticsCachePorts>;
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
        useValue: { nowUtcMs: () => FIXTURE_NOW_UTC_MS },
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
  return { store, calls, cache, linked };
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
