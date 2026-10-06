import {
  DestroyRef,
  ErrorHandler,
  Injectable,
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
  LazyAdapterModule,
  LazyAdapterScope,
  LazyPortLoadError,
  provideLazyPort,
} from './lazy-port';
import { DATA_RETRY_DELAYS_MS, retryDelayMs } from './retry-schedule';

// ── A port in the house shape (a Result-like answer), and a second one ──

type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

interface GreeterPort {
  greet(name: string): Promise<Answer<string>>;
  watch(name: string): Observable<Answer<string>>;
}

interface CounterPort {
  count(): Promise<Answer<number>>;
}

const GREETER = new InjectionToken<GreeterPort>('Greeter');
const COUNTER = new InjectionToken<CounterPort>('Counter');

/** Stands in for the Firestore instance: created by the scope, once. */
const SDK = new InjectionToken<{ readonly id: number }>('Sdk');
/** Stands in for the second SDK instance (Storage); it can be made to throw. */
const CACHE = new InjectionToken<{ readonly ready: true }>('Cache');
/** A root service the adapters also inject (Auth, the clock, …). */
const SALUTATION = new InjectionToken<string>('Salutation');

/** What `initializeFirestore` throwing looks like to the scope. */
const cacheError = new Error('the cache could not be initialised');
/** What an adapter constructor throwing looks like to the scope. */
const constructorError = new Error('adapter constructor failed');

let sdkCreated = 0;
let sdkDestroyed = 0;
let cacheFailuresLeft = 0;
let greeterCreated = 0;
let greeterDestroyed = 0;
let counterCreated = 0;
let watchSubscribed = 0;
let watchTornDown = 0;
let failGreeterCreation = false;
let watchSource: () => Observable<Answer<string>>;

@Injectable()
class FakeGreeterAdapter implements GreeterPort {
  private readonly sdk = inject(SDK);
  private readonly cache = inject(CACHE);
  private readonly salutation = inject(SALUTATION);

  constructor() {
    // Registered before the throw: a half-built adapter's injector must
    // still be torn down.
    inject(DestroyRef).onDestroy(() => (greeterDestroyed += 1));
    if (failGreeterCreation) throw constructorError;
    greeterCreated += 1;
  }

  // Reads `this`: the proxy must call it ON the adapter.
  greet(name: string): Promise<Answer<string>> {
    return Promise.resolve({
      ok: this.cache.ready,
      value: `${this.salutation}, ${name} (sdk ${this.sdk.id})`,
    });
  }

  watch(): Observable<Answer<string>> {
    return watchSource();
  }
}

@Injectable()
class FakeCounterAdapter implements CounterPort {
  private readonly sdk = inject(SDK);

  constructor() {
    counterCreated += 1;
  }

  count(): Promise<Answer<number>> {
    return Promise.resolve({ ok: true, value: this.sdk.id });
  }
}

/** A port with a synchronous method — which no lazy binding may accept. */
class SyncAdapter {
  now(): number {
    return 0;
  }
}

const fakeModule = { FakeGreeterAdapter, FakeCounterAdapter, SyncAdapter };
type FakeModule = typeof fakeModule;

const unavailable = (error: LazyPortLoadError): Answer<never> => ({
  ok: false,
  error,
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
const reported = () => errorHandler.handleError.mock.calls.map(([e]) => e);

/** The original cause inside a failure answer (undefined for a success). */
const causeOf = (answer: Answer<unknown>): unknown =>
  answer.ok ? undefined : (answer.error as LazyPortLoadError).cause;

function setUp(load: Loader) {
  const scope = new LazyAdapterScope<FakeModule>('test-data', load);
  errorHandler = { handleError: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SALUTATION, useValue: 'Здравей' },
      { provide: ErrorHandler, useValue: errorHandler },
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        methods: { greet: 'promise', watch: 'observable' },
        onLoadError: unavailable,
      }),
      provideLazyPort(COUNTER, scope, {
        adapter: (m) => m.FakeCounterAdapter,
        methods: { count: 'promise' },
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
  greeterCreated = 0;
  greeterDestroyed = 0;
  counterCreated = 0;
  watchSubscribed = 0;
  watchTornDown = 0;
  failGreeterCreation = false;
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
    expect(greeterCreated).toBe(0);
  });

  it('lists every port bound to its scope', () => {
    const { scope } = setUp(gatedLoader().load);

    expect(TestBed.inject(scope.ports)).toEqual([GREETER, COUNTER]);
  });

  it('imports once and creates the SDK and each adapter once, however many calls and ports race', async () => {
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
    expect(greeterCreated).toBe(1);
    expect(counterCreated).toBe(1);
    subscription.unsubscribe();
  });

  it('creates the scope’s instances as it loads, before any adapter asks for one', async () => {
    const { counter } = setUp(() => Promise.resolve(loadedModule()));
    cacheFailuresLeft = 1;

    // The counter never injects CACHE, yet its failure is the scope's.
    const answer = await counter.count();

    expect(answer.ok).toBe(false);
    expect(counterCreated).toBe(0);
  });

  it('answers a promise method with the adapter’s answer, called on the adapter', async () => {
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

  it('tears the adapter stream down when the consumer leaves on its first, synchronous value', async () => {
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

  it('never reaches the adapter for a stream unsubscribed before the load lands', async () => {
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

    expect(failed.ok).toBe(false);
    const error = failed.ok ? null : failed.error;
    expect(error).toBeInstanceOf(LazyPortLoadError);
    expect((error as LazyPortLoadError).cause).toBe(chunkError);
    expect((error as LazyPortLoadError).scope).toBe('test-data');
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);

    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 1)',
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('answers a loader that throws synchronously like any failed load', async () => {
    const { greeter } = setUp(() => {
      throw new Error('import() refused');
    });

    const answer = await greeter.greet('Ана');

    expect(answer).toEqual({ ok: false, error: expect.any(LazyPortLoadError) });
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
    expect(reported()).toEqual([expect.any(LazyPortLoadError)]);
    expect((await greeter.greet('Ана')).ok).toBe(true);
  });

  it('passes the adapter’s own stream errors through untouched', async () => {
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

  it('destroys the scope’s injectors, the adapters’ included, with the application', async () => {
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
    const scope = new LazyAdapterScope<FakeModule>('types', () =>
      Promise.resolve({ module: fakeModule, providers: [], instances: [] }),
    );
    const bind = () => {
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        // @ts-expect-error — a method left unclassified
        methods: { greet: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        // @ts-expect-error — a stream classified as a promise
        methods: { greet: 'promise', watch: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        // @ts-expect-error — a failure answer the port cannot give
        methods: { greet: 'promise', watch: 'observable' },
        onLoadError: () => 'offline',
      });
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        // @ts-expect-error — a handler that throws is the rejection again
        methods: { greet: 'promise', watch: 'observable' },
        onLoadError: () => {
          throw new Error('offline');
        },
      });
      provideLazyPort(GREETER, scope, {
        // @ts-expect-error — the adapter does not implement the port
        adapter: (m) => m.FakeCounterAdapter,
        methods: { greet: 'promise', watch: 'observable' },
        onLoadError: unavailable,
      });
      const SYNC = new InjectionToken<{ now(): number }>('Sync');
      provideLazyPort(SYNC, scope, {
        adapter: (m) => m.SyncAdapter,
        // @ts-expect-error — a synchronous method cannot be deferred
        methods: { now: 'promise' },
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
    expect(reported()).toEqual([expect.any(LazyPortLoadError)]);
    expect((reported()[0] as LazyPortLoadError).cause).toBe(cacheError);
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

  it('an adapter constructor that throws: reports the real cause once, keeps the scope, creates the adapter afresh next call', async () => {
    failGreeterCreation = true;
    const load = vi.fn<Loader>(() => Promise.resolve(loadedModule()));
    const { greeter, counter } = setUp(load);

    const failed = await greeter.greet('Ана');

    expect(failed.ok).toBe(false);
    expect(reported()).toEqual([expect.any(LazyPortLoadError)]);
    expect((reported()[0] as LazyPortLoadError).cause).toBe(constructorError);
    // Its half-built injector is gone …
    expect(greeterDestroyed).toBe(1);
    // … but the scope loaded fine: the other port answers on the same SDK.
    await expect(counter.count()).resolves.toEqual({ ok: true, value: 1 });

    failGreeterCreation = false;
    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 1)',
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdkCreated).toBe(1);
    expect(sdkDestroyed).toBe(0);
    expect(reported()).toHaveLength(1);
  });

  it('answers a creation that keeps throwing with its real cause every time — never NG0200', async () => {
    failGreeterCreation = true;
    const { greeter } = setUp(() => Promise.resolve(loadedModule()));

    const answers = [
      await greeter.greet('Ана'),
      await greeter.greet('Боб'),
      await greeter.greet('Вера'),
    ];

    for (const answer of answers) {
      expect(answer.ok).toBe(false);
      expect(causeOf(answer)).toBe(constructorError);
    }
    expect(reported()).toHaveLength(1);
    expect(String((reported()[0] as LazyPortLoadError).cause)).not.toMatch(
      /NG0200/,
    );
  });
});

describe('provideLazyPort — a stream whose load failed', () => {
  const firstDelay = retryDelayMs(0);
  const secondDelay = retryDelayMs(1);
  const lastDelay = retryDelayMs(Number.MAX_SAFE_INTEGER);

  beforeEach(() => vi.useFakeTimers());

  /** Lets every settled promise run, without moving the clock. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('emits the failure answer, retries on the backoff schedule, then forwards the adapter stream', async () => {
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
      error: expect.any(LazyPortLoadError),
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
    const load = vi.fn<Loader>().mockRejectedValue(new Error('offline'));
    const { greeter } = setUp(load);

    const answer = firstValueFrom(greeter.watch('Ана'));
    await settle();
    await expect(answer).resolves.toEqual({
      ok: false,
      error: expect.any(LazyPortLoadError),
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

  it('retries an adapter creation that threw too, without importing again', async () => {
    failGreeterCreation = true;
    const load = vi.fn<Loader>(() => Promise.resolve(loadedModule()));
    const { greeter } = setUp(load);
    const next = vi.fn();

    const subscription = greeter.watch('Ана').subscribe({ next });
    await settle();
    expect(next).toHaveBeenCalledTimes(1);
    expect((reported()[0] as LazyPortLoadError).cause).toBe(constructorError);

    failGreeterCreation = false;
    await vi.advanceTimersByTimeAsync(firstDelay);

    expect(next).toHaveBeenLastCalledWith({ ok: true, value: 'first' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(reported()).toHaveLength(1);
    subscription.unsubscribe();
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
