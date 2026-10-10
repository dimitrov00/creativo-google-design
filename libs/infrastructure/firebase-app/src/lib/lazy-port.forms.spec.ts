import {
  DestroyRef,
  EnvironmentInjector,
  ErrorHandler,
  Injectable,
  InjectionToken,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, take } from 'rxjs';
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
  FactoryPicker,
  LazyAdapterModule,
  LazyAdapterScope,
  LazyPortLoadError,
  provideLazyPort,
} from './lazy-port';
import { retryDelayMs } from './retry-schedule';

/**
 * The two-form seam (blueprint §5.3, Phase 3 flip 0): one scope answering a
 * port through an adapter CLASS (`adapter`, today's 31 rows) and a port
 * BUNDLE through a plain-closure factory (`factory`, the rows the flips move
 * over one token at a time). `lazy-port.spec.ts` covers the class form in
 * depth; this spec covers the factory form, and both side by side.
 */

// ── The ports: a bundle of plain function members, and a class-form port ──

type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

/** A port bundle in the shape the flips bind: plain function members. */
interface DayReadPorts {
  readonly loadDay: (dayKey: string) => Promise<Answer<string>>;
  readonly observeDay: (dayKey: string) => Observable<Answer<string>>;
}

interface GreeterPort {
  greet(name: string): Promise<Answer<string>>;
}

const DAY_READ_PORTS = new InjectionToken<DayReadPorts>('DayReadPorts');
/** A second row naming the same factory: it shares the one bundle. */
const TWIN_DAY_READ_PORTS = new InjectionToken<DayReadPorts>(
  'TwinDayReadPorts',
);
const GREETER = new InjectionToken<GreeterPort>('Greeter');

interface Sdk {
  readonly id: number;
}

/** Stands in for the Firestore instance: created by the scope, once. */
const SDK = new InjectionToken<Sdk>('Sdk');
/** A root service a factory also reaches, through `inject()`. */
const SALUTATION = new InjectionToken<string>('Salutation');

/** What a bundle factory throwing looks like to the scope. */
const bundleError = new Error('bundle factory failed');
/** What an adapter constructor throwing looks like to the scope. */
const constructorError = new Error('adapter constructor failed');

let sdkCreated = 0;
let sdkDestroyed = 0;
let bundleCalls = 0;
let bundlesBuilt = 0;
let bundlesDestroyed = 0;
let greeterCreated = 0;
let dayStreamsSubscribed = 0;
let dayStreamsTornDown = 0;
let failBundleCreation = false;
let failGreeterCreation = false;
let factoryContexts: {
  readonly given: EnvironmentInjector;
  readonly current: EnvironmentInjector;
}[] = [];
let dayStream: (dayKey: string) => Observable<Answer<string>>;

/**
 * The closure export a flip lands beside its adapters: `(sdk handle) =>
 * bundle`, no class, no `this`, no injection.
 */
function dayReadPorts(sdk: Sdk, salutation: string): DayReadPorts {
  bundleCalls += 1;
  if (failBundleCreation) throw bundleError;
  bundlesBuilt += 1;
  return {
    loadDay: (dayKey) =>
      Promise.resolve({
        ok: true,
        value: `${salutation}, ${dayKey} (sdk ${sdk.id})`,
      }),
    observeDay: (dayKey) => dayStream(dayKey),
  };
}

@Injectable()
class FakeGreeterAdapter implements GreeterPort {
  private readonly sdk = inject(SDK);
  private readonly salutation = inject(SALUTATION);

  constructor() {
    if (failGreeterCreation) throw constructorError;
    greeterCreated += 1;
  }

  // Reads `this`: the proxy must call it ON the adapter.
  greet(name: string): Promise<Answer<string>> {
    return Promise.resolve({
      ok: true,
      value: `${this.salutation}, ${name} (sdk ${this.sdk.id})`,
    });
  }
}

const fakeModule = { FakeGreeterAdapter, dayReadPorts };
type FakeModule = typeof fakeModule;

/**
 * The row's factory as a composition root writes it: the scope's SDK by
 * `injector.get`, a root service by `inject()` — which throws NG0203 unless
 * the seam calls it inside an injection context.
 */
const dayReadFactory: FactoryPicker<FakeModule, DayReadPorts> =
  (m) => (injector) => {
    const ports = m.dayReadPorts(injector.get(SDK), inject(SALUTATION));
    factoryContexts.push({
      given: injector,
      current: inject(EnvironmentInjector),
    });
    inject(DestroyRef).onDestroy(() => (bundlesDestroyed += 1));
    return ports;
  };

const unavailable = (error: LazyPortLoadError): Answer<never> => ({
  ok: false,
  error,
});

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
    ],
    instances: [SDK],
  };
}

type Loader = () => Promise<LazyAdapterModule<FakeModule>>;

interface Gate {
  readonly load: Mock<Loader>;
  resolve(): void;
}

/** A loader the test opens by hand, standing in for `import()`. */
function gatedLoader(): Gate {
  let open!: () => void;
  const pending = new Promise<LazyAdapterModule<FakeModule>>((resolve) => {
    open = () => resolve(loadedModule());
  });
  return { load: vi.fn<Loader>(() => pending), resolve: () => open() };
}

const loadsAtOnce = () => vi.fn<Loader>(() => Promise.resolve(loadedModule()));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let errorHandler: { handleError: Mock<(error: unknown) => void> };

/** Every error reported to the `ErrorHandler`, in order. */
const reported = () =>
  errorHandler.handleError.mock.calls.map(([e]) => e as LazyPortLoadError);

/** The original cause inside a failure answer (undefined for a success). */
const causeOf = (answer: Answer<unknown>): unknown =>
  answer.ok ? undefined : (answer.error as LazyPortLoadError).cause;

const DAY_METHODS = { loadDay: 'promise', observeDay: 'observable' } as const;

function setUp(load: Loader) {
  const scope = new LazyAdapterScope<FakeModule>('test-data', load);
  errorHandler = { handleError: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: SALUTATION, useValue: 'Здравей' },
      { provide: ErrorHandler, useValue: errorHandler },
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        methods: { greet: 'promise' },
        onLoadError: unavailable,
      }),
      provideLazyPort(DAY_READ_PORTS, scope, {
        factory: dayReadFactory,
        methods: DAY_METHODS,
        onLoadError: unavailable,
      }),
      provideLazyPort(TWIN_DAY_READ_PORTS, scope, {
        factory: dayReadFactory,
        methods: DAY_METHODS,
        onLoadError: unavailable,
      }),
    ],
  });
  return {
    scope,
    greeter: TestBed.inject(GREETER),
    days: TestBed.inject(DAY_READ_PORTS),
    twinDays: TestBed.inject(TWIN_DAY_READ_PORTS),
  };
}

beforeEach(() => {
  sdkCreated = 0;
  sdkDestroyed = 0;
  bundleCalls = 0;
  bundlesBuilt = 0;
  bundlesDestroyed = 0;
  greeterCreated = 0;
  dayStreamsSubscribed = 0;
  dayStreamsTornDown = 0;
  failBundleCreation = false;
  failGreeterCreation = false;
  factoryContexts = [];
  dayStream = (dayKey) =>
    new Observable<Answer<string>>((subscriber) => {
      dayStreamsSubscribed += 1;
      subscriber.next({ ok: true, value: `${dayKey}: first` });
      return () => (dayStreamsTornDown += 1);
    });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('provideLazyPort — the factory form beside the class form', () => {
  it('loads nothing and builds no bundle when a factory port is injected, or when its stream is only created', async () => {
    const gate = gatedLoader();
    const { days } = setUp(gate.load);

    const stream = days.observeDay('2026-10-10');
    await flush();

    expect(stream).toBeInstanceOf(Observable);
    expect(gate.load).not.toHaveBeenCalled();
    expect(sdkCreated).toBe(0);
    expect(bundleCalls).toBe(0);
  });

  it('lists every port bound to the scope, whichever form binds it', () => {
    const { scope } = setUp(gatedLoader().load);

    expect(TestBed.inject(scope.ports)).toEqual([
      GREETER,
      DAY_READ_PORTS,
      TWIN_DAY_READ_PORTS,
    ]);
  });

  it('proxies exactly the classified members of a bundle', () => {
    const { days } = setUp(gatedLoader().load);

    expect(Object.keys(days).sort()).toEqual(['loadDay', 'observeDay']);
    expect(Object.isFrozen(days)).toBe(true);
  });

  it('imports once and creates the SDK, the class adapter and the bundle once each, however many calls race across both forms', async () => {
    const gate = gatedLoader();
    const { greeter, days } = setUp(gate.load);

    const loads = Promise.all([
      days.loadDay('2026-10-10'),
      days.loadDay('2026-10-11'),
      days.loadDay('2026-10-12'),
    ]);
    const greeted = greeter.greet('Ана');
    const seen: Answer<string>[] = [];
    const subscription = days
      .observeDay('2026-10-10')
      .subscribe((v) => seen.push(v));
    expect(gate.load).toHaveBeenCalledTimes(1);

    gate.resolve();

    expect(await loads).toEqual([
      { ok: true, value: 'Здравей, 2026-10-10 (sdk 1)' },
      { ok: true, value: 'Здравей, 2026-10-11 (sdk 1)' },
      { ok: true, value: 'Здравей, 2026-10-12 (sdk 1)' },
    ]);
    // The same SDK instance behind the class-form port.
    expect(await greeted).toEqual({ ok: true, value: 'Здравей, Ана (sdk 1)' });
    await flush();
    expect(seen).toEqual([{ ok: true, value: '2026-10-10: first' }]);

    // And after the load, still nothing new is created or imported.
    await days.loadDay('2026-10-13');
    await greeter.greet('Боб');
    expect(gate.load).toHaveBeenCalledTimes(1);
    expect(sdkCreated).toBe(1);
    expect(greeterCreated).toBe(1);
    expect(bundleCalls).toBe(1);
    subscription.unsubscribe();
  });

  it('shares one bundle between two rows naming the same factory', async () => {
    const { days, twinDays } = setUp(loadsAtOnce());

    await expect(days.loadDay('2026-10-10')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-10-10 (sdk 1)',
    });
    await expect(twinDays.loadDay('2026-10-11')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-10-11 (sdk 1)',
    });
    expect(bundlesBuilt).toBe(1);
  });

  it('builds one bundle per application: a second application builds its own, on its own SDK', async () => {
    const first = setUp(loadsAtOnce());
    await first.days.loadDay('2026-10-10');
    expect(bundlesBuilt).toBe(1);

    TestBed.resetTestingModule();
    const second = setUp(loadsAtOnce());

    await expect(second.days.loadDay('2026-10-10')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-10-10 (sdk 2)',
    });
    await second.days.loadDay('2026-10-11');
    expect(bundlesBuilt).toBe(2);
    expect(bundlesDestroyed).toBe(1);
  });

  it('calls the factory with the scope’s injector, inside its injection context — inject() works there, never NG0203', async () => {
    const { days } = setUp(loadsAtOnce());

    const answer = await days.loadDay('2026-10-10');

    expect(answer).toEqual({ ok: true, value: 'Здравей, 2026-10-10 (sdk 1)' });
    expect(errorHandler.handleError).not.toHaveBeenCalled();
    expect(factoryContexts).toHaveLength(1);
    const context = factoryContexts[0];
    // The injector it is handed IS the context it runs in …
    expect(context?.given).toBe(context?.current);
    // … and it is the scope's, holding the SDK — not the root.
    expect(context?.given).not.toBe(TestBed.inject(EnvironmentInjector));
    expect(context?.given.get(SDK)).toEqual({ id: 1 });
  });

  it('answers a bundle’s promise member with its closure’s answer, the arguments forwarded', async () => {
    const { days } = setUp(loadsAtOnce());

    await expect(days.loadDay('2026-12-24')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-12-24 (sdk 1)',
    });
  });

  it('forwards a bundle’s stream after the load, and its teardown', async () => {
    const source = new Subject<Answer<string>>();
    dayStream = () => {
      dayStreamsSubscribed += 1;
      return new Observable<Answer<string>>((subscriber) => {
        const inner = source.subscribe(subscriber);
        return () => {
          dayStreamsTornDown += 1;
          inner.unsubscribe();
        };
      });
    };
    const gate = gatedLoader();
    const { days } = setUp(gate.load);
    const seen: Answer<string>[] = [];

    const subscription = days
      .observeDay('2026-10-10')
      .subscribe((v) => seen.push(v));
    gate.resolve();
    await flush();
    source.next({ ok: true, value: 'live' });

    expect(dayStreamsSubscribed).toBe(1);
    expect(seen).toEqual([{ ok: true, value: 'live' }]);
    subscription.unsubscribe();
    expect(dayStreamsTornDown).toBe(1);
  });

  it('tears the bundle’s stream down when the consumer leaves on its first, synchronous value', async () => {
    const { days } = setUp(loadsAtOnce());
    const seen: Answer<string>[] = [];

    days
      .observeDay('2026-10-10')
      .pipe(take(1))
      .subscribe((v) => seen.push(v));
    await flush();

    expect(seen).toEqual([{ ok: true, value: '2026-10-10: first' }]);
    expect(dayStreamsSubscribed).toBe(1);
    expect(dayStreamsTornDown).toBe(1);
  });

  it('passes the bundle stream’s completion and errors through untouched', async () => {
    const boom = new Error('listener crashed');
    dayStream = (dayKey) =>
      dayKey === 'broken'
        ? new Observable<Answer<string>>((subscriber) => subscriber.error(boom))
        : new Observable<Answer<string>>((subscriber) => subscriber.complete());
    const { days } = setUp(loadsAtOnce());
    const complete = vi.fn();
    const error = vi.fn();

    days.observeDay('2026-10-10').subscribe({ complete, error });
    days.observeDay('broken').subscribe({ complete, error });
    await flush();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(boom);
  });

  it('errors the stream when a bundle’s stream member throws as it is called', async () => {
    const thrown = new Error('bad query');
    dayStream = () => {
      throw thrown;
    };
    const { days } = setUp(loadsAtOnce());
    const next = vi.fn();
    const error = vi.fn();

    days.observeDay('2026-10-10').subscribe({ next, error });
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(thrown);
    // The bundle's own failure, not a load failure: nothing reported.
    expect(errorHandler.handleError).not.toHaveBeenCalled();
  });

  it('never reaches the bundle’s stream for a subscription that left before the load landed', async () => {
    const gate = gatedLoader();
    const { days } = setUp(gate.load);
    const next = vi.fn();

    days.observeDay('2026-10-10').subscribe({ next }).unsubscribe();
    gate.resolve();
    await flush();

    expect(dayStreamsSubscribed).toBe(0);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers a failed load in the factory port’s own failure shape — resolved, never rejected — and imports again next call', async () => {
    const chunkError = new Error('Failed to fetch dynamically imported module');
    const load = vi
      .fn<Loader>()
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValue(loadedModule());
    const { days } = setUp(load);

    const failed = await days.loadDay('2026-10-10');

    expect(failed).toEqual({
      ok: false,
      error: expect.any(LazyPortLoadError),
    });
    expect(causeOf(failed)).toBe(chunkError);
    expect(bundleCalls).toBe(0);
    expect(reported()).toHaveLength(1);

    await expect(days.loadDay('2026-10-10')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-10-10 (sdk 1)',
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(bundlesBuilt).toBe(1);
  });

  it('destroys with the application: the SDK, and what the factory registered on the scope’s DestroyRef', async () => {
    const { days } = setUp(loadsAtOnce());
    await days.loadDay('2026-10-10');
    expect(sdkDestroyed).toBe(0);
    expect(bundlesDestroyed).toBe(0);

    TestBed.resetTestingModule();

    expect(sdkDestroyed).toBe(1);
    expect(bundlesDestroyed).toBe(1);
  });
});

/**
 * A factory holds no injector record of its own, so a throw cannot leave
 * NG0200 behind — but it must still behave like a failed load: reported
 * once, nothing cached, the scope kept, the next call calling it afresh.
 */
describe('provideLazyPort — a bundle factory that throws', () => {
  it('reports the real cause once, caches nothing, keeps the scope, and calls the factory afresh next call', async () => {
    failBundleCreation = true;
    const load = loadsAtOnce();
    const { days, greeter } = setUp(load);

    const failed = await days.loadDay('2026-10-10');

    expect(failed.ok).toBe(false);
    expect(causeOf(failed)).toBe(bundleError);
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toBeInstanceOf(LazyPortLoadError);
    expect(reported()[0]?.cause).toBe(bundleError);
    // The scope loaded fine: the class-form port answers on the same SDK.
    await expect(greeter.greet('Ана')).resolves.toEqual({
      ok: true,
      value: 'Здравей, Ана (sdk 1)',
    });

    failBundleCreation = false;
    await expect(days.loadDay('2026-10-10')).resolves.toEqual({
      ok: true,
      value: 'Здравей, 2026-10-10 (sdk 1)',
    });
    expect(bundleCalls).toBe(2);
    expect(bundlesBuilt).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdkCreated).toBe(1);
    expect(sdkDestroyed).toBe(0);
    expect(reported()).toHaveLength(1);
  });

  it('answers a factory that keeps throwing with its real cause every time', async () => {
    failBundleCreation = true;
    const { days } = setUp(loadsAtOnce());

    const answers = [
      await days.loadDay('2026-10-10'),
      await days.loadDay('2026-10-11'),
      await days.loadDay('2026-10-12'),
    ];

    for (const answer of answers) {
      expect(answer.ok).toBe(false);
      expect(causeOf(answer)).toBe(bundleError);
    }
    expect(bundleCalls).toBe(3);
    expect(reported()).toHaveLength(1);
  });

  it('reports a failing factory and a failing adapter class apart, each once', async () => {
    failBundleCreation = true;
    failGreeterCreation = true;
    const { days, greeter } = setUp(loadsAtOnce());

    for (let i = 0; i < 2; i += 1) {
      expect((await days.loadDay('2026-10-10')).ok).toBe(false);
      expect((await greeter.greet('Ана')).ok).toBe(false);
    }

    expect(reported().map((e) => e.cause)).toEqual([
      bundleError,
      constructorError,
    ]);
  });
});

describe('provideLazyPort — a factory stream that could not start', () => {
  const firstDelay = retryDelayMs(0);
  const secondDelay = retryDelayMs(1);

  beforeEach(() => vi.useFakeTimers());

  /** Lets every settled promise run, without moving the clock. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('emits the failure answer once, retries the import on the backoff schedule, then forwards the bundle’s stream', async () => {
    const offline = new Error('offline');
    const load = vi
      .fn<Loader>()
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline)
      .mockResolvedValue(loadedModule());
    const { days } = setUp(load);
    const next = vi.fn();
    const error = vi.fn();

    const subscription = days
      .observeDay('2026-10-10')
      .subscribe({ next, error });
    await settle();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenLastCalledWith({
      ok: false,
      error: expect.any(LazyPortLoadError),
    });

    await vi.advanceTimersByTimeAsync(firstDelay);
    expect(load).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(secondDelay);
    expect(load).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenLastCalledWith({
      ok: true,
      value: '2026-10-10: first',
    });
    expect(error).not.toHaveBeenCalled();
    expect(reported()).toHaveLength(1);
    subscription.unsubscribe();
    expect(dayStreamsTornDown).toBe(1);
  });

  it('retries a factory that threw, without importing again', async () => {
    failBundleCreation = true;
    const load = loadsAtOnce();
    const { days } = setUp(load);
    const next = vi.fn();

    const subscription = days.observeDay('2026-10-10').subscribe({ next });
    await settle();
    expect(next).toHaveBeenCalledTimes(1);
    expect(reported()[0]?.cause).toBe(bundleError);

    failBundleCreation = false;
    await vi.advanceTimersByTimeAsync(firstDelay);

    expect(next).toHaveBeenLastCalledWith({
      ok: true,
      value: '2026-10-10: first',
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(bundleCalls).toBe(2);
    expect(reported()).toHaveLength(1);
    subscription.unsubscribe();
  });
});

describe('provideLazyPort — the binding’s form, at compile time', () => {
  it('takes a factory written inline, as a composition root writes it', async () => {
    const scope = new LazyAdapterScope<FakeModule>('inline', () =>
      Promise.resolve(loadedModule()),
    );
    errorHandler = { handleError: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: SALUTATION, useValue: 'Здравей' },
        { provide: ErrorHandler, useValue: errorHandler },
        provideLazyPort(DAY_READ_PORTS, scope, {
          factory: (m) => (injector) =>
            m.dayReadPorts(injector.get(SDK), inject(SALUTATION)),
          methods: { loadDay: 'promise', observeDay: 'observable' },
          onLoadError: unavailable,
        }),
      ],
    });

    await expect(
      TestBed.inject(DAY_READ_PORTS).loadDay('2026-10-10'),
    ).resolves.toEqual({ ok: true, value: 'Здравей, 2026-10-10 (sdk 1)' });
  });

  it('refuses a binding naming neither form, both, or the wrong one', () => {
    // Never executed: `nx typecheck` proves each line is a compile error
    // (an unused `@ts-expect-error` fails the typecheck).
    const scope = new LazyAdapterScope<FakeModule>('types', () =>
      Promise.resolve({ module: fakeModule, providers: [], instances: [] }),
    );
    const bind = () => {
      // @ts-expect-error — neither an adapter class nor a factory
      provideLazyPort(DAY_READ_PORTS, scope, {
        methods: DAY_METHODS,
        onLoadError: unavailable,
      });
      // @ts-expect-error — both forms at once
      provideLazyPort(GREETER, scope, {
        adapter: (m) => m.FakeGreeterAdapter,
        factory: () => () => ({
          greet: () => Promise.resolve({ ok: true, value: '' }),
        }),
        methods: { greet: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(DAY_READ_PORTS, scope, {
        // @ts-expect-error — a class through `factory`: a constructor is not `(injector) => bundle`
        factory: (m) => m.FakeGreeterAdapter,
        methods: DAY_METHODS,
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        // @ts-expect-error — a closure through `adapter`: it is not a class
        adapter: (m) => () => m.dayReadPorts({ id: 0 }, ''),
        methods: { greet: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(GREETER, scope, {
        // @ts-expect-error — the bundle does not implement the port
        factory: (m) => () => m.dayReadPorts({ id: 0 }, ''),
        methods: { greet: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(DAY_READ_PORTS, scope, {
        factory: dayReadFactory,
        // @ts-expect-error — a member left unclassified, in the factory form too
        methods: { loadDay: 'promise' },
        onLoadError: unavailable,
      });
      provideLazyPort(DAY_READ_PORTS, scope, {
        factory: dayReadFactory,
        // @ts-expect-error — a stream classified as a promise, in the factory form too
        methods: { loadDay: 'promise', observeDay: 'promise' },
        onLoadError: unavailable,
      });
    };
    expect(bind).toBeTypeOf('function');
  });
});
