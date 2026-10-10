import {
  DestroyRef,
  EnvironmentInjector,
  EnvironmentProviders,
  ErrorHandler,
  InjectionToken,
  Provider,
  ProviderToken,
  Type,
  createEnvironmentInjector,
  inject,
  makeEnvironmentProviders,
  runInInjectionContext,
} from '@angular/core';
import { Observable } from 'rxjs';
import { retryDelayMs } from './retry-schedule';

/**
 * # Lazy ports
 *
 * A port bound with {@link provideLazyPort} is injectable at boot like any
 * other, but its adapter — and the SDK the adapter needs — is a dynamic
 * `import()` that runs on the port's FIRST CALL. That is how the Firestore
 * and Storage SDKs (565 kB with their dependencies) stay out of the initial
 * chunk while every feature keeps injecting the same ports it always did.
 *
 * ## One mechanism, typed per method
 * A proxy can only defer what is already asynchronous, so every binding
 * classifies every method of its port as `'observable'` or `'promise'`
 * ({@link LazyPortMethods}). The mapped type makes the list exhaustive and
 * checked: a missing or extra method, a method classified as the wrong kind,
 * or a SYNCHRONOUS method (which a lazy proxy could only answer by lying) is
 * a compile error — nothing silently breaks when a port grows a method.
 *
 * - `'observable'`: nothing loads until SUBSCRIBE; an unsubscribe before the
 *   load lands never reaches the adapter (the import itself runs on — it
 *   cannot be cancelled — and simply warms the next call).
 * - `'promise'`: the call awaits the load, then the adapter.
 *
 * ## Two forms of binding, moved one row at a time
 * A binding names what answers the port in the loaded module in exactly one
 * of two ways — the type refuses both, and neither:
 *
 * - `adapter: (m) => m.SomeAdapterClass` — the CLASS form: an `@Injectable`
 *   class implementing the port, created by Angular (`injector.get`) in its
 *   own small injector.
 * - `factory: (m) => (injector) => m.someReadPorts(injector.get(SDK))` — the
 *   FACTORY form ({@link FactoryPicker}): a plain port BUNDLE (an object of
 *   function members) built by an `(sdkHandle) => bundle` closure export.
 *   The returned `(injector) => bundle` is called directly — no class, no
 *   injector of its own — with the scope's injector, INSIDE that injector's
 *   injection context, so `inject()` works in it as in a provider factory
 *   (a plain call outside one would throw NG0203).
 *
 * Both forms share the scope, the `methods` classification and
 * `onLoadError`; a composition root moves its rows from `adapter` to
 * `factory` one token at a time, and the class form goes with the last.
 *
 * ## One load, one scope injector, one instance of everything
 * A {@link LazyAdapterScope} is imported once, however many ports and calls
 * race for it. Its providers (the SDK instances) live in ONE environment
 * injector under the root, created on that load together with the instances
 * it lists: each SDK instance is created once and shared. Each adapter class
 * is created once, on its first call, in its OWN small injector under the
 * scope's — so adapters share the SDK instances and still `inject()` root
 * services (Auth, Functions, the clock) exactly as before. Each bundle is
 * created once too, on its first call, keyed by its binding's `factory`
 * (two rows naming the same picker share one bundle, as two rows naming the
 * same class share one adapter).
 *
 * ## Load failures are the port's own failure
 * A failed import (offline at first use, a stale deploy) or a creation that
 * throws must not become an unhandled rejection, nor a thrown error the
 * caller's `Result` handling never sees. Each binding's `onLoadError` turns
 * the {@link LazyPortLoadError} into an answer the port already speaks —
 * `fail(new RepositoryError(...))` for a `Result` port, the defaults for a
 * port that answers with defaults — and the type forces that answer to be
 * valid for EVERY method of the port.
 *
 * - A promise method resolves to it: it fails fast, and its caller decides
 *   whether to try again.
 * - A stream emits it once — so the UI can show its error state — and then,
 *   for as long as it is subscribed, tries the load again on the data
 *   layer's backoff schedule ({@link retryDelayMs}), switching to the
 *   adapter's stream the moment a load succeeds. A root service that
 *   subscribes once (the catalogue, the menu's notifications) therefore
 *   heals after a transient chunk-fetch failure instead of staying empty
 *   until a reload. Unsubscribing ends the retries.
 *
 * Nothing that failed is kept: the next attempt imports and creates afresh.
 * The real cause is reported to Angular's `ErrorHandler` once per failure —
 * a failure that repeats before it heals (every retry of an offline stream,
 * every tap on a retry button) is not reported again.
 *
 * ## A creation that throws is a failed load, never NG0200
 * Angular's injector marks a provider "being created" before it runs the
 * factory and never unmarks it when the factory throws: every later `get`
 * reports a cyclic dependency (NG0200) instead of the cause, for the life of
 * that injector. So whatever threw is thrown away with its injector, and the
 * next call builds it from scratch:
 *
 * - An SDK instance that throws fails the LOAD (that is why a scope lists
 *   its `instances`: they are created as the scope loads, never later by the
 *   first adapter that injects one). The half-built scope injector is
 *   destroyed and forgotten, exactly like a failed import.
 * - An adapter constructor that throws takes down only that adapter's own
 *   injector. The scope's SDK instances stay: rebuilding them would re-run
 *   `initializeFirestore`, which throws `failed-precondition` once it has
 *   succeeded for the app — one broken adapter would take every data port
 *   down with it.
 * - A bundle factory that throws holds no injector record, so there is no
 *   NG0200 to avoid: nothing is cached, the scope stays, and the next call
 *   calls the factory afresh.
 */

/** How a lazy port method answers. */
export type LazyMethodKind = 'observable' | 'promise';

/** What a scope's loader resolves to. */
export interface LazyAdapterModule<M> {
  /**
   * The dynamically imported module(s) the adapter classes and the bundle
   * factories are picked from.
   */
  readonly module: M;
  /** Providers the adapters need that must load lazily too (SDK instances). */
  readonly providers: readonly (Provider | EnvironmentProviders)[];
  /**
   * EVERY token `providers` provides, created in this order as the scope
   * loads — so an instance that throws fails the load (retried from
   * scratch) rather than the first adapter that injects it, and the scope's
   * injector never holds a half-created instance. A token left out here is
   * created by the first adapter that injects it, and a throw there would
   * leave the scope's injector answering NG0200 until a reload.
   */
  readonly instances: readonly ProviderToken<unknown>[];
}

/** Why a lazy port could not reach its adapter; carries the original cause. */
export class LazyPortLoadError extends Error {
  override readonly name = 'LazyPortLoadError';

  constructor(
    readonly scope: string,
    override readonly cause: unknown,
  ) {
    super(`${scope}: the lazily loaded adapters could not be loaded`);
  }
}

/** The class form: picks an adapter class out of the loaded module. */
type Picker<M, P> = (module: M) => Type<P>;

/**
 * The factory form: picks out of the loaded module the function that builds
 * a port bundle from the scope's injector. Called once per scope injector,
 * in its injection context.
 */
export type FactoryPicker<M, P> = (
  module: M,
) => (injector: EnvironmentInjector) => P;

/** What answers a port: exactly one of an adapter class or a bundle factory. */
type AdapterSource<M, P> =
  | { readonly adapter: Picker<M, P>; readonly factory?: never }
  | { readonly factory: FactoryPicker<M, P>; readonly adapter?: never };

type Answer<F> = F extends (...args: never[]) => infer R ? R : never;

type Settled<R> = [R] extends [Observable<infer T>]
  ? T
  : [R] extends [PromiseLike<infer T>]
    ? T
    : never;

type KindOf<F> = F extends (...args: never[]) => infer R
  ? [R] extends [Observable<unknown>]
    ? 'observable'
    : [R] extends [PromiseLike<unknown>]
      ? 'promise'
      : 'NOT LAZY-SAFE: a lazy port method must return an Observable or a Promise'
  : 'NOT LAZY-SAFE: every member of a lazy port must be a method';

/**
 * The per-method classification of port `P`, checked against `F`, the
 * binding's load-failure answer. Each key is `'observable'` or `'promise'`
 * when that is what the method returns AND `F` is a valid answer of it;
 * otherwise the expected type is a sentence saying what is wrong, so the
 * compile error reads as the fix.
 */
export type LazyPortMethods<P, F> = {
  readonly [K in keyof P]-?: KindOf<P[K]> extends LazyMethodKind
    ? [F] extends [never]
      ? 'NOT LAZY-SAFE: onLoadError must answer, not throw — a throw is the rejection this mechanism exists to prevent'
      : [F] extends [Settled<Answer<P[K]>>]
        ? KindOf<P[K]>
        : "NOT LAZY-SAFE: onLoadError's answer is not a valid answer of this method (an inline `(e) => fail(…)` infers Result<unknown, E>: pass a typed const)"
    : KindOf<P[K]>;
};

/** What every binding says about the port's calls, whichever form answers. */
interface LazyPortCalls<P, F> {
  /** Every method of the port, classified. */
  readonly methods: LazyPortMethods<P, NoInfer<F>>;
  /** The port's own failure answer for a failed load. */
  readonly onLoadError: (error: LazyPortLoadError) => F;
}

/**
 * How one port is bound to a {@link LazyAdapterScope}: `methods`,
 * `onLoadError`, and EXACTLY ONE of
 *
 * - `adapter` — picks the adapter class, which must implement the port; or
 * - `factory` — picks the function building a bundle that implements the
 *   port ({@link FactoryPicker}).
 */
export type LazyPortBinding<P, M, F> = AdapterSource<M, P> &
  LazyPortCalls<P, F>;

type Outcome<P> =
  | { readonly loaded: true; readonly adapter: P }
  | { readonly loaded: false; readonly error: LazyPortLoadError };

/**
 * What a failure is reported under: the load, one adapter class, or one
 * bundle factory.
 */
type FailureKey = typeof LOAD | Type<unknown> | FactoryPicker<never, unknown>;

const LOAD = Symbol('load');

/**
 * A loaded scope: its module, its injector holding the SDK instances, one
 * injector per adapter class and one bundle per factory, each created on
 * its first call.
 */
class LoadedScope<M> {
  private readonly adapters = new Map<Type<unknown>, EnvironmentInjector>();
  private readonly bundles = new Map<FactoryPicker<M, unknown>, unknown>();

  constructor(
    readonly module: M,
    private readonly injector: EnvironmentInjector,
    private readonly name: string,
  ) {}

  /**
   * The adapter of class `type`, created once. A constructor that throws
   * leaves nothing behind: its injector is destroyed and forgotten, so the
   * next call creates it afresh instead of meeting NG0200.
   */
  adapter<P>(type: Type<P>): P {
    let injector = this.adapters.get(type);
    if (!injector) {
      injector = createEnvironmentInjector(
        [type],
        this.injector,
        `${this.name} ${type.name}`,
      );
      this.adapters.set(type, injector);
    }
    try {
      return injector.get(type);
    } catch (cause) {
      this.adapters.delete(type);
      injector.destroy();
      throw cause;
    }
  }

  /**
   * The bundle `factory` builds, created once: picked and called with the
   * scope's injector, inside its injection context. A factory that throws
   * leaves nothing cached, so the next call calls it afresh.
   */
  bundle<P>(factory: FactoryPicker<M, P>): P {
    if (this.bundles.has(factory)) return this.bundles.get(factory) as P;
    const bundle = runInInjectionContext(this.injector, () =>
      factory(this.module)(this.injector),
    );
    this.bundles.set(factory, bundle);
    return bundle;
  }

  destroy(): void {
    for (const injector of this.adapters.values()) injector.destroy();
    this.adapters.clear();
    this.bundles.clear();
    this.injector.destroy();
  }
}

/**
 * The per-application half of a scope: one load, one scope injector.
 * Created in the root injector on the first port INJECTION (which loads
 * nothing); the load itself waits for the first port CALL.
 */
class LazyAdapterHost<M> {
  private loading: Promise<LoadedScope<M>> | null = null;
  private current: LoadedScope<M> | null = null;
  private destroyed = false;
  /** What is failing right now and has been reported: reported once per failure. */
  private readonly failing = new Set<FailureKey>();

  constructor(
    private readonly scope: LazyAdapterScope<M>,
    private readonly parent: EnvironmentInjector,
    private readonly errorHandler: ErrorHandler,
    destroyRef: DestroyRef,
  ) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.loading = null;
      this.current?.destroy();
      this.current = null;
    });
  }

  /** The application is gone: nothing loads, and nothing should retry. */
  get closed(): boolean {
    return this.destroyed;
  }

  /**
   * What `source` names — the adapter its class form picks, or the bundle
   * its factory form builds — created once in the loaded scope; never a
   * rejection.
   */
  async adapter<P>(source: AdapterSource<M, P>): Promise<Outcome<P>> {
    let loaded: LoadedScope<M>;
    try {
      loaded = await this.loaded();
    } catch (cause) {
      // Already reported (once) by `loaded()`.
      return this.failure(cause);
    }
    if (this.destroyed) return this.failure(this.destroyedError());
    // A class picker that throws is reported as the load's failure, as before.
    let key: FailureKey = LOAD;
    try {
      let adapter: P;
      if (source.factory) {
        key = source.factory;
        adapter = loaded.bundle(source.factory);
      } else {
        const type = source.adapter(loaded.module);
        key = type;
        adapter = loaded.adapter(type);
      }
      this.failing.delete(key);
      return { loaded: true, adapter };
    } catch (cause) {
      const outcome = this.failure(cause);
      this.report(key, outcome.error);
      return outcome;
    }
  }

  private loaded(): Promise<LoadedScope<M>> {
    if (this.loading) return this.loading;
    const loading = this.build();
    this.loading = loading;
    // Handled here, so a failed load is never an unhandled rejection even
    // when every caller has already unsubscribed; forgotten, so the next
    // call imports again.
    loading.then(
      () => this.failing.delete(LOAD),
      (cause: unknown) => {
        if (this.loading === loading) this.loading = null;
        if (!this.destroyed) {
          this.report(LOAD, new LazyPortLoadError(this.scope.name, cause));
        }
      },
    );
    return loading;
  }

  /** Imports the scope and creates its injector with every instance it lists. */
  private async build(): Promise<LoadedScope<M>> {
    if (this.destroyed) throw this.destroyedError();
    // Read off the scope at call time (a synchronous throw is a rejection
    // like any other here, inside an async function).
    const { module, providers, instances } = await this.scope.load();
    if (this.destroyed) throw this.destroyedError();
    const injector = createEnvironmentInjector(
      [...providers],
      this.parent,
      this.scope.name,
    );
    try {
      for (const token of instances) injector.get(token);
    } catch (cause) {
      // The half-built scope goes, with whatever it did create.
      injector.destroy();
      throw cause;
    }
    this.current = new LoadedScope(module, injector, this.scope.name);
    return this.current;
  }

  private failure(cause: unknown): {
    readonly loaded: false;
    readonly error: LazyPortLoadError;
  } {
    return {
      loaded: false,
      error: new LazyPortLoadError(this.scope.name, cause),
    };
  }

  private report(key: FailureKey, error: LazyPortLoadError): void {
    if (this.failing.has(key)) return;
    this.failing.add(key);
    this.errorHandler.handleError(error);
  }

  private destroyedError(): Error {
    return new Error(`${this.scope.name} was destroyed with its application`);
  }
}

/**
 * A group of adapters that load together: one dynamic import (or several in
 * parallel), one set of providers, one scope injector. Declare it once at
 * the composition root and bind each port to it with {@link provideLazyPort}.
 */
export class LazyAdapterScope<M> {
  /**
   * Every port token bound to this scope (multi): what a wiring test injects
   * to prove that binding them loads nothing.
   */
  readonly ports: InjectionToken<readonly InjectionToken<unknown>[]>;
  /** @internal The scope's per-application host. */
  readonly host: InjectionToken<LazyAdapterHost<M>>;

  constructor(
    readonly name: string,
    /** Called on the first port call, and again after a failed load. */
    readonly load: () => Promise<LazyAdapterModule<M>>,
  ) {
    this.ports = new InjectionToken<readonly InjectionToken<unknown>[]>(
      `${name} ports`,
    );
    this.host = new InjectionToken<LazyAdapterHost<M>>(`${name} host`, {
      providedIn: 'root',
      factory: () =>
        new LazyAdapterHost(
          this,
          inject(EnvironmentInjector),
          inject(ErrorHandler),
          inject(DestroyRef),
        ),
    });
  }
}

/**
 * Binds `token` to a proxy that loads `scope` on its first call and forwards
 * every call to what the binding names: the adapter class `binding.adapter`
 * picks, or the bundle `binding.factory` builds. Environment-level only: the
 * scope's injector hangs off the root.
 */
export function provideLazyPort<P, M, F>(
  token: InjectionToken<P>,
  scope: LazyAdapterScope<M>,
  binding: LazyPortBinding<NoInfer<P>, NoInfer<M>, F>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: scope.ports, multi: true, useValue: token },
    {
      provide: token,
      useFactory: () => lazyPort<P, M, F>(inject(scope.host), binding),
    },
  ]);
}

type Method = (...args: unknown[]) => unknown;

function lazyPort<P, M, F>(
  host: LazyAdapterHost<M>,
  binding: LazyPortBinding<P, M, F>,
): P {
  const { methods, onLoadError } = binding;
  // The binding is its own source: `host.adapter` reads only its `adapter`
  // or `factory`, whichever the row uses.
  const source: AdapterSource<M, P> = binding;
  // Called ON the adapter: a class adapter's methods read `this` (the SDK
  // handle); a bundle's closures ignore it.
  const call = (adapter: P, name: string, args: unknown[]): unknown => {
    const method: unknown = Reflect.get(adapter as object, name);
    if (typeof method !== 'function') {
      throw new TypeError(`The lazily loaded adapter has no method "${name}"`);
    }
    return Reflect.apply(method, adapter, args);
  };

  const observe = (name: string, args: unknown[]): Observable<unknown> =>
    new Observable<unknown>((subscriber) => {
      let failures = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      subscriber.add(() => clearTimeout(retry));

      const attempt = (): void => {
        void host.adapter(source).then((outcome) => {
          if (subscriber.closed) return;
          try {
            if (outcome.loaded) {
              // Added to the subscriber, so a consumer that leaves on the
              // adapter's first, synchronous value still tears it down.
              subscriber.add(
                (
                  call(outcome.adapter, name, args) as Observable<unknown>
                ).subscribe({
                  next: (value) => subscriber.next(value),
                  error: (error: unknown) => subscriber.error(error),
                  complete: () => subscriber.complete(),
                }),
              );
              return;
            }
            // Once: later failures of the same streak change nothing the
            // UI shows.
            if (failures === 0) subscriber.next(onLoadError(outcome.error));
          } catch (error) {
            subscriber.error(error);
            return;
          }
          // The consumer may have left on the failure answer itself.
          if (subscriber.closed) return;
          if (host.closed) {
            subscriber.complete();
            return;
          }
          retry = setTimeout(attempt, retryDelayMs(failures));
          failures += 1;
        });
      };
      attempt();
    });

  const forward = (name: string, kind: LazyMethodKind): Method =>
    kind === 'observable'
      ? (...args) => observe(name, args)
      : async (...args) => {
          const outcome = await host.adapter(source);
          return outcome.loaded
            ? call(outcome.adapter, name, args)
            : onLoadError(outcome.error);
        };
  const entries = Object.entries(methods) as [string, LazyMethodKind][];
  return Object.freeze(
    Object.fromEntries(
      entries.map(([name, kind]) => [name, forward(name, kind)]),
    ),
  ) as P;
}
