import {
  DestroyRef,
  ErrorHandler,
  InjectionToken,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, firstValueFrom, take, throwError } from 'rxjs';
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type FactoryPicker,
  LAZY_PORT_LOAD_ERROR,
  type LazyAdapterModule,
  LazyMethod,
  isLazyPort,
  lazyAdapterScope,
  provideLazyPort,
} from './lazy-port';
import { DATA_RETRY_DELAYS_MS, retryDelayMs } from './retry-schedule';

// ── A port in the house shape (a Result-like answer), and a second one ──

/** What `onLoadError` was handed: the scope's name and the real cause. */
type LoadFailure = { readonly scopeName: string; readonly cause: unknown };

type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LoadFailure };

type Greeter = {
  readonly greet: (name: string) => Promise<Answer<string>>;
  readonly watch: (name: string) => Observable<Answer<string>>;
};

type Counter = {
  readonly count: () => Promise<Answer<number>>;
};

const GREETER = new InjectionToken<Greeter>('Greeter');
const COUNTER = new InjectionToken<Counter>('Counter');

/** Stands in for the Firestore instance: created by the scope, once. */
const SDK = new InjectionToken<{ readonly id: number }>('Sdk');
/** Stands in for the second SDK instance (Storage); it can be made to throw. */
const CACHE = new InjectionToken<{ readonly ready: true }>('Cache');
/** A root service the bundles also reach (Auth, the clock, …). */
const SALUTATION = new InjectionToken<string>('Salutation');

/** What `initializeFirestore` throwing looks like to the scope. */
const cacheError = new Error('the cache could not be initialised');

let sdkCreated = 0;
let sdkDestroyed = 0;
let cacheFailuresLeft = 0;
let greeterBuilt = 0;
let greeterDestroyed = 0;
let counterBuilt = 0;
let watchSubscribed = 0;
let watchTornDown = 0;
let watchSource: () => Observable<Answer<string>>;

/** The greeter's `(sdk handles) => bundle` closure export — no class, no `this`. */
function greeterPorts(
  sdk: { readonly id: number },
  cache: { readonly ready: true },
  salutation: string,
): Greeter {
  greeterBuilt += 1;
  return {
    greet: (name) =>
      Promise.resolve({
        ok: cache.ready,
        value: `${salutation}, ${name} (sdk ${sdk.id})`,
      }),
    watch: () => watchSource(),
  };
}

function counterPorts(sdk: { readonly id: number }): Counter {
  counterBuilt += 1;
  return { count: () => Promise.resolve({ ok: true, value: sdk.id }) };
}

/** A port with a synchronous member — which no lazy binding may accept. */
function syncPorts(): { readonly now: () => number } {
  return { now: () => 0 };
}

const fakeModule = { greeterPorts, counterPorts, syncPorts };
type FakeModule = typeof fakeModule;

/** The rows as a composition root writes them: the SDK by `injector.get`, a root service by `inject()`. */
const greeterFactory: FactoryPicker<FakeModule, Greeter> =
  (m) => (injector) => {
    // Registered on the scope's DestroyRef: torn down with the application.
    inject(DestroyRef).onDestroy(() => (greeterDestroyed += 1));
    return m.greeterPorts(
      injector.get(SDK),
      injector.get(CACHE),
      inject(SALUTATION),
    );
  };
const counterFactory: FactoryPicker<FakeModule, Counter> = (m) => (injector) =>
  m.counterPorts(injector.get(SDK));

const unavailable = (scopeName: string, cause: unknown): Answer<never> => ({
  ok: false,
  error: { scopeName, cause },
});

/** What a scope's loader resolves to: the module, the SDK providers, both instances. */
function loadedModule(): LazyAdapterModule<FakeModule> {
  return {
    module: fakeModule,
    providers: [
      {
        provide: SDK,
        useFactory: () => {
          sdkCreated += 1;
          inject(DestroyRef).onDestroy(() => (sdkDestroyed += 1));
          return { id: sdkCreated };
        },
      },
      {
        provide: CACHE,
        useFactory: () => {
          if (cacheFailuresLeft > 0) {
            cacheFailuresLeft -= 1;
            throw cacheError;
          }
          return { ready: true as const };
        },
      },
    ],
    instances: [SDK, CACHE],
  };
}

type Loader = () => Promise<LazyAdapterModule<FakeModule>>;

interface Gate {
  readonly load: Mock<Loader>;
  resolve(): void;
  reject(error: unknown): void;
}

/** A loader the test opens by hand, standing in for `import()`. */
function gatedLoader(): Gate {
  let open!: () => void;
  let refuse!: (error: unknown) => void;
  const pending = new Promise<LazyAdapterModule<FakeModule>>(
    (resolve, reject) => {
      open = () => resolve(loadedModule());
      refuse = reject;
    },
  );
  return {
    load: vi.fn<Loader>(() => pending),
    resolve: () => open(),
    reject: (error) => refuse(error),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let errorHandler: { handleError: Mock<(error: unknown) => void> };

/** Every error reported to the `ErrorHandler`, in order. */
const reported = () =>
  errorHandler.handleError.mock.calls.map(([e]) => e as Error);

/** The original cause inside a failure answer (undefined for a success). */
const causeOf = (answer: Answer<unknown>): unknown =>
  answer.ok ? undefined : answer.error.cause;

function setUp(load: Loader) {
  const scope = lazyAdapterScope<FakeModule>('test-data', load);
  errorHandler = { handleError: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SALUTATION, useValue: 'Здравей' },
      { provide: ErrorHandler, useValue: errorHandler },
      provideLazyPort(GREETER, scope, {
        factory: greeterFactory,
        methods: { greet: LazyMethod.Promise, watch: LazyMethod.Observable },
        onLoadError: unavailable,
      }),
      provideLazyPort(COUNTER, scope, {
        factory: counterFactory,
        methods: { count: LazyMethod.Promise },
        onLoadError: unavailable,
      }),
    ],
  });
  return {
    scope,
    greeter: TestBed.inject(GREETER),
    counter: TestBed.inject(COUNTER),
  };
}

beforeEach(() => {
  sdkCreated = 0;
  sdkDestroyed = 0;
  cacheFailuresLeft = 0;
  greeterBuilt = 0;
  greeterDestroyed = 0;
  counterBuilt = 0;
  watchSubscribed = 0;
  watchTornDown = 0;
  watchSource = () =>
    new Observable<Answer<string>>((subscriber) => {
      watchSubscribed += 1;
      subscriber.next({ ok: true, value: 'first' });
      return () => (watchTornDown += 1);
    });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('provideLazyPort', () => {
  it('loads nothing when the port is injected, or when a stream is only created', async () => {
    const gate = gatedLoader();
    const { greeter } = setUp(gate.load);

    const stream = greeter.watch('Ана');
    await flush();

    expect(stream).toBeInstanceOf(Observable);
    expect(gate.load).not.toHaveBeenCalled();
    expect(sdkCreated).toBe(0);
    expect(greeterBuilt).toBe(0);
  });

  it('lists every port bound to its scope', () => {
    const { scope } = setUp(gatedLoader().load);

    expect(TestBed.inject(scope.ports)).toEqual([GREETER, COUNTER]);
  });

  it('binds a plain, unfrozen record it can tell from an adapter’s bundle', () => {
    const { greeter, counter } = setUp(gatedLoader().load);

    expect(Object.getPrototypeOf(greeter)).toBe(Object.prototype);
    expect(Object.isFrozen(greeter)).toBe(false);
    expect([isLazyPort(greeter), isLazyPort(counter)]).toEqual([true, true]);
    expect(isLazyPort(counterPorts({ id: 0 }))).toBe(false);
    expect([isLazyPort(null), isLazyPort('greeter')]).toEqual([false, false]);
  });

  it('is a plain record, its loader read at call time — a spec may watch it', async () => {
    const { scope, greeter } = setUp(() => Promise.resolve(loadedModule()));
    const watched = vi.spyOn(scope, 'load');

    await greeter.greet('Ана');

    expect(Object.getPrototypeOf(scope)).toBe(Object.prototype);
    expect(scope.name).toBe('test-data');
    expect(watched).toHaveBeenCalledTimes(1);
  });

  it('imports once and creates the SDK and each bundle once, however many calls and ports race', async () => {
    const gate = gatedLoader();
    const { greeter, counter } = setUp(gate.load);

    const greetings = Promise.all([
      greeter.greet('Ана'),
      greeter.greet('Боб'),
      greeter.greet('Вера'),
    ]);
    const counted = counter.count();
    const seen: Answer<string>[] = [];
    const subscription = greeter.watch('Ана').subscribe((v) => seen.push(v));
    expect(gate.load).toHaveBeenCalledTimes(1);

    gate.resolve();

    expect(await greetings).toEqual([
      { ok: true, value: 'Здравей, Ана (sdk 1)' },
      { ok: true, value: 'Здравей, Боб (sdk 1)' },
      { ok: true, value: 'Здравей, Вера (sdk 1)' },
    ]);
    // The same SDK instance behind a different port.
    expect(await counted).toEqual({ ok: true, value: 1 });
    await flush();
    expect(seen).toEqual([{ ok: true, value: 'first' }]);

    // And after the load, still nothing new is created or imported.
    await greeter.greet('Гоша');
    await counter.count();
    expect(gate.load).toHaveBeenCalledTimes(1);
    expect(sdkCreated).toBe(1);
    expect(greeterBuilt).toBe(1);
    expect(counterBuilt).toBe(1);
    subscription.unsubscribe();
  });

  it('creates the scope’s instances as it loads, before any bundle reaches one', async () => {
    const { counter } = setUp(() => Promise.resolve(loadedModule()));
    cacheFailuresLeft = 1;

    // The counter never reaches CACHE, yet its failure is the scope's.
    const answer = await counter.count();

    expect(answer.ok).toBe(false);
    expect(counterBuilt).toBe(0);
  });

  it('answers a promise method with the bundle’s answer, the arguments forwarded', async () => {
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));

    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 1)',
    });
  });

  it('forwards a stream after the load, and its teardown', async () => {
    const source = new Subject<Answer<string>>();
    watchSource = () => {
      watchSubscribed += 1;
      return new Observable<Answer<string>>((subscriber) => {
        const inner = source.subscribe(subscriber);
        return () => {
          watchTornDown += 1;
          inner.unsubscribe();
        };
      });
    };
    const gate = gatedLoader();
    const { greeter } = setUp(gate.load);
    const seen: Answer<string>[] = [];

    const subscription = greeter.watch('Ана').subscribe((v) => seen.push(v));
    gate.resolve();
    await flush();
    source.next({ ok: true, value: 'live' });

    expect(watchSubscribed).toBe(1);
    expect(seen).toEqual([{ ok: true, value: 'live' }]);
    subscription.unsubscribe();
    expect(watchTornDown).toBe(1);
  });

  it('tears the bundle’s stream down when the consumer leaves on its first, synchronous value', async () => {
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));
    const seen: Answer<string>[] = [];

    greeter
      .watch('Ана')
      .pipe(take(1))
      .subscribe((v) => seen.push(v));
    await flush();

    expect(seen).toEqual([{ ok: true, value: 'first' }]);
    expect(watchSubscribed).toBe(1);
    expect(watchTornDown).toBe(1);
  });

  it('never reaches the bundle for a stream unsubscribed before the load lands', async () => {
    const gate = gatedLoader();
    const { greeter } = setUp(gate.load);
    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();

    greeter.watch('Ана').subscribe({ next, error, complete }).unsubscribe();
    expect(gate.load).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flush();

    expect(watchSubscribed).toBe(0);
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('stays silent when a load an unsubscribed stream started fails later', async () => {
    const gate = gatedLoader();
    const { greeter } = setUp(gate.load);
    const next = vi.fn();

    greeter.watch('Ана').subscribe({ next }).unsubscribe();
    gate.reject(new Error('chunk failed'));
    await flush();

    expect(next).not.toHaveBeenCalled();
    // Reported, not thrown: no unhandled rejection reaches the test runner.
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);
  });

  it('answers a failed load in the port’s own failure shape — resolved, never rejected — and imports again next call', async () => {
    const chunkError = new Error('Failed to fetch dynamically imported module');
    const load = vi
      .fn<Loader>()
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValue(loadedModule());
    const { greeter } = setUp(load);

    const failed = await greeter.greet('Ана');

    // `onLoadError` is handed scalars: the scope's name and the real cause.
    expect(failed).toEqual({
      ok: false,
      error: { scopeName: 'test-data', cause: chunkError },
    });
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);

    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 1)',
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports a plain Error named LazyPortLoadError, today’s message, the real cause beside it', async () => {
    const chunkError = new Error('Failed to fetch dynamically imported module');
    const { greeter } = setUp(() => Promise.reject(chunkError));

    await greeter.greet('Ана');

    const [report] = reported();
    expect(report).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(report)).toBe(Error.prototype);
    expect(report?.name).toBe(LAZY_PORT_LOAD_ERROR);
    expect(report?.name).toBe('LazyPortLoadError');
    expect(report?.message).toBe(
      'test-data: the lazily loaded adapters could not be loaded',
    );
    expect(report?.cause).toBe(chunkError);
    expect(String(report)).toBe(
      'LazyPortLoadError: test-data: the lazily loaded adapters could not be loaded',
    );
  });

  it('answers a loader that throws synchronously like any failed load', async () => {
    const refused = new Error('import() refused');
    const { greeter } = setUp(() => {
      throw refused;
    });

    const answer = await greeter.greet('Ана');

    expect(answer).toEqual({
      ok: false,
      error: { scopeName: 'test-data', cause: refused },
    });
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);
  });

  it('reports a failure once, however many calls meet it before it heals', async () => {
    const offline = new Error('offline');
    const load = vi
      .fn<Loader>()
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline)
      .mockResolvedValue(loadedModule());
    const { greeter } = setUp(load);

    for (let i = 0; i < 3; i += 1) {
      expect((await greeter.greet('Ана')).ok).toBe(false);
    }

    expect(load).toHaveBeenCalledTimes(3);
    expect(reported()).toHaveLength(1);
    expect(reported()[0]?.name).toBe(LAZY_PORT_LOAD_ERROR);
    expect((await greeter.greet('Ана')).ok).toBe(true);
  });

  it('passes the bundle’s own stream errors through untouched', async () => {
    const boom = new Error('listener crashed');
    watchSource = () => throwError(() => boom);
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));
    const next = vi.fn();
    const error = vi.fn();

    greeter.watch('Ана').subscribe({ next, error });
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(boom);
  });

  it('destroys the scope’s injector, and what a bundle registered on it, with the application', async () => {
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));
    await greeter.greet('Ана');
    expect(sdkDestroyed).toBe(0);
    expect(greeterDestroyed).toBe(0);

    TestBed.resetTestingModule();

    expect(sdkDestroyed).toBe(1);
    expect(greeterDestroyed).toBe(1);
  });

  it('refuses unsafe bindings at compile time', () => {
    // Never executed: `nx typecheck` proves each line is a compile error
    // (an unused `@ts-expect-error` fails the typecheck).
    const scope = lazyAdapterScope<FakeModule>('types', () =>
      Promise.resolve({ module: fakeModule, providers: [], instances: [] }),
    );
    const bind = () => {
      provideLazyPort(GREETER, scope, {
        factory: greeterFactory,
        // @ts-expect-error — a method left unclassified
        methods: { greet: LazyMethod.Promise },
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        factory: greeterFactory,
        // @ts-expect-error — a stream classified as a promise
        methods: { greet: LazyMethod.Promise, watch: LazyMethod.Promise },
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        factory: greeterFactory,
        // @ts-expect-error — a failure answer the port cannot give
        methods: { greet: LazyMethod.Promise, watch: LazyMethod.Observable },
        onLoadError: () => 'offline',
      });
      provideLazyPort(GREETER, scope, {
        factory: greeterFactory,
        // @ts-expect-error — a handler that throws is the rejection again
        methods: { greet: LazyMethod.Promise, watch: LazyMethod.Observable },
        onLoadError: () => {
          throw new Error('offline');
        },
      });
      provideLazyPort(GREETER, scope, {
        // @ts-expect-error — the bundle does not implement the port
        factory: counterFactory,
        methods: { greet: LazyMethod.Promise, watch: LazyMethod.Observable },
        onLoadError: unavailable,
      });
      const SYNC = new InjectionToken<{ readonly now: () => number }>('Sync');
      provideLazyPort(SYNC, scope, {
        factory: (m) => () => m.syncPorts(),
        // @ts-expect-error — a synchronous method cannot be deferred
        methods: { now: LazyMethod.Promise },
        onLoadError: unavailable,
      });
    };
    expect(bind).toBeTypeOf('function');
  });
});

/**
 * Angular's injector marks a record "being created" before it runs the
 * factory and never unmarks it when the factory throws: every later `get`
 * of that record reports a cyclic dependency (NG0200) instead of the cause.
 * A creation that throws must instead behave like a failed import.
 */
describe('provideLazyPort — a creation that throws', () => {
  it('a scope instance that throws: reports the real cause once, destroys the half-built scope, builds it afresh next call', async () => {
    cacheFailuresLeft = 1;
    const load = vi.fn<Loader>(() => Promise.resolve(loadedModule()));
    const { greeter } = setUp(load);

    const failed = await greeter.greet('Ана');

    expect(failed.ok).toBe(false);
    expect(causeOf(failed)).toBe(cacheError);
    expect(reported()).toHaveLength(1);
    expect(reported()[0]?.name).toBe(LAZY_PORT_LOAD_ERROR);
    expect(reported()[0]?.cause).toBe(cacheError);
    // The instance created before the throw went with its injector.
    expect(sdkCreated).toBe(1);
    expect(sdkDestroyed).toBe(1);

    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 2)',
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(reported()).toHaveLength(1);
  });

  it('a scope instance that keeps throwing: answered with its real cause every time — never NG0200', async () => {
    cacheFailuresLeft = 3;
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));

    const answers = [
      await greeter.greet('Ана'),
      await greeter.greet('Боб'),
      await greeter.greet('Вера'),
    ];

    for (const answer of answers) {
      expect(answer.ok).toBe(false);
      expect(causeOf(answer)).toBe(cacheError);
    }
    expect(reported()).toHaveLength(1);
    expect(String(reported()[0]?.cause)).not.toMatch(/NG0200/);
  });
});

describe('provideLazyPort — a stream whose load failed', () => {
  const firstDelay = retryDelayMs(0);
  const secondDelay = retryDelayMs(1);
  const lastDelay = retryDelayMs(Number.MAX_SAFE_INTEGER);

  beforeEach(() => vi.useFakeTimers());

  /** Lets every settled promise run, without moving the clock. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('emits the failure answer, retries on the backoff schedule, then forwards the bundle’s stream', async () => {
    const chunkError = new Error('Failed to fetch dynamically imported module');
    const load = vi
      .fn<Loader>()
      .mockRejectedValueOnce(chunkError)
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValue(loadedModule());
    const { greeter } = setUp(load);
    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();

    const subscription = greeter
      .watch('Ана')
      .subscribe({ next, error, complete });
    await settle();

    // The failure answer, once: the UI shows its error state.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenLastCalledWith({
      ok: false,
      error: { scopeName: 'test-data', cause: chunkError },
    });
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(firstDelay - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    // Failed again: silent, the error state already stands.
    expect(load).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(secondDelay);
    expect(load).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenLastCalledWith({ ok: true, value: 'first' });
    expect(error).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    // One failure streak, one report.
    expect(reported()).toHaveLength(1);

    subscription.unsubscribe();
    expect(watchTornDown).toBe(1);
  });

  it('keeps retrying while subscribed, every wait on the schedule and then at its ceiling', async () => {
    const load = vi.fn<Loader>().mockRejectedValue(new Error('offline'));
    const { greeter } = setUp(load);

    const subscription = greeter.watch('Ана').subscribe();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    const waits = [...DATA_RETRY_DELAYS_MS, lastDelay, lastDelay];
    for (const [index, wait] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(load).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(index + 2);
    }
    subscription.unsubscribe();
  });

  it('stops retrying when unsubscribed', async () => {
    const load = vi.fn<Loader>().mockRejectedValue(new Error('offline'));
    const { greeter } = setUp(load);

    const subscription = greeter.watch('Ана').subscribe();
    await settle();
    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops retrying when the consumer leaves on the failure answer itself', async () => {
    const offline = new Error('offline');
    const load = vi.fn<Loader>().mockRejectedValue(offline);
    const { greeter } = setUp(load);

    const answer = firstValueFrom(greeter.watch('Ана'));
    await settle();
    await expect(answer).resolves.toEqual({
      ok: false,
      error: { scopeName: 'test-data', cause: offline },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops retrying, and completes, once the application is destroyed', async () => {
    const load = vi.fn<Loader>().mockRejectedValue(new Error('offline'));
    const { greeter } = setUp(load);
    const complete = vi.fn();

    greeter.watch('Ана').subscribe({ complete });
    await settle();
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(load).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(reported()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a promise method failing fast: the caller retries, not the port', async () => {
    const load = vi.fn<Loader>().mockRejectedValue(new Error('offline'));
    const { greeter } = setUp(load);

    const answer = await greeter.greet('Ана');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(answer.ok).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
