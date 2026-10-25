import {
  DestroyRef,
  EnvironmentInjector,
  EnvironmentProviders,
  ErrorHandler,
  InjectionToken,
  Provider,
  ProviderToken,
  createEnvironmentInjector,
  inject,
  makeEnvironmentProviders,
  runInInjectionContext,
} from '@angular/core';
import { Observable } from 'rxjs';
import { Result, type Tag } from '@core/primitives';
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
 * classifies every method of its port as `LazyMethod.Observable` or
 * `LazyMethod.Promise` ({@link LazyPortMethods}). The mapped type makes the
 * list exhaustive and checked: a missing or extra method, a method
 * classified as the wrong kind, or a SYNCHRONOUS method (which a lazy proxy
 * could only answer by lying) is a compile error — nothing silently breaks
 * when a port grows a method.
 *
 * - `LazyMethod.Observable`: nothing loads until SUBSCRIBE; an unsubscribe
 *   before the load lands never reaches the adapter (the import itself runs
 *   on — it cannot be cancelled — and simply warms the next call).
 * - `LazyMethod.Promise`: the call awaits the load, then the adapter.
 *
 * ## One form of binding: a bundle factory
 * A binding names what answers the port in the loaded module with
 * `factory: (m) => (injector) => m.someReadPorts(injector.get(SDK))`
 * ({@link FactoryPicker}): a plain port BUNDLE (an object of function
 * members) built by an `(sdkHandle) => bundle` closure export (Law 9: the
 * bundle is the port's own record). The returned `(injector) => bundle` is
 * called directly — no class, no injector of its own — with the scope's
 * injector, INSIDE that injector's injection context, so `inject()` works
 * in it as in a provider factory (a plain call outside one would throw
 * NG0203). The class form (an `@Injectable` adapter class per port) was
 * retired with its last row (Phase 4a 4A-14).
 *
 * ## One load, one scope injector, one instance of everything
 * A {@link LazyAdapterScope} is imported once, however many ports and calls
 * race for it. Its providers (the SDK instances) live in ONE environment
 * injector under the root, created on that load together with the instances
 * it lists: each SDK instance is created once and shared. Each bundle is
 * created once too, on its first call, keyed by its binding's `factory`
 * (two rows naming the same picker share one bundle).
 *
 * ## Load failures are the port's own failure
 * A failed import (offline at first use, a stale deploy) or a creation that
 * throws must not become an unhandled rejection, nor a thrown error the
 * caller's `Result` handling never sees. Each binding's `onLoadError`
 * receives the scope's name and the real cause — scalars, no error class —
 * and answers in words the port already speaks
 * (`Result.err(RepositoryError.unavailable())` for a `Result` port, the
 * defaults for a port that answers with defaults); the type forces that
 * answer to be valid for EVERY method of the port.
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
 * The real cause is reported to Angular's `ErrorHandler` once per failure
 * (an unrecoverable load failure is a defect to see in the console, not a
 * value: {@link lazyPortLoadError}) — a failure that repeats before it heals
 * (every retry of an offline stream, every tap on a retry button) is not
 * reported again.
 *
 * ## A creation that throws is a failed load, never NG0200
 * Angular's injector marks a provider "being created" before it runs the
 * factory and never unmarks it when the factory throws: every later `get`
 * reports a cyclic dependency (NG0200) instead of the cause, for the life of
 * that injector. So whatever threw is thrown away, and the next call builds
 * it from scratch:
 *
 * - An SDK instance that throws fails the LOAD (that is why a scope lists
 *   its `instances`: they are created as the scope loads, never later by the
 *   first bundle that reaches one). The half-built scope injector is
 *   destroyed and forgotten, exactly like a failed import.
 * - A bundle factory that throws holds no injector record, so there is no
 *   NG0200 to avoid: nothing is cached, the scope stays (rebuilding its SDK
 *   instances would re-run `initializeFirestore`, which throws
 *   `failed-precondition` once it has succeeded for the app), and the next
 *   call calls the factory afresh.
 */

/**
 * How a lazy port method answers — the value each binding's `methods` row
 * gives every member of its port. Internal values: they reach no DOM, URL,
 * storage or wire, only the proxy built here.
 */
export const LazyMethod = {
  /** The method returns an `Observable`: nothing loads until SUBSCRIBE. */
  Observable: 'OBSERVABLE',
  /** The method returns a `Promise`: the call awaits the load, then the adapter. */
  Promise: 'PROMISE',
} as const;
export type LazyMethod = Tag<typeof LazyMethod>;

/** What a scope's loader resolves to. */
export type LazyAdapterModule<M> = {
  /** The dynamically imported module(s) the bundle factories are picked from. */
  readonly module: M;
  /** Providers the bundles need that must load lazily too (SDK instances). */
  readonly providers: readonly (Provider | EnvironmentProviders)[];
  /**
   * EVERY token `providers` provides, created in this order as the scope
   * loads — so an instance that throws fails the load (retried from
   * scratch) rather than the first bundle that reaches it, and the scope's
   * injector never holds a half-created instance. A token left out here is
   * created by the first bundle that reaches it, and a throw there would
   * leave the scope's injector answering NG0200 until a reload.
   */
  readonly instances: readonly ProviderToken<unknown>[];
};

/** The `name` of the error a failed load is reported under — the console line's word. */
export const LAZY_PORT_LOAD_ERROR = 'LazyPortLoadError';

/**
 * The ErrorHandler's report of a load that failed: a plain `Error` (never a
 * subclass, Law 7.5) named {@link LAZY_PORT_LOAD_ERROR}, saying which scope,
 * carrying the real cause — the console line it always printed.
 */
export function lazyPortLoadError(scopeName: string, cause: unknown): Error {
  const error = new Error(
    `${scopeName}: the lazily loaded adapters could not be loaded`,
    { cause },
  );
  error.name = LAZY_PORT_LOAD_ERROR;
  return error;
}

/**
 * Picks out of the loaded module the function that builds a port bundle
 * from the scope's injector. Called once per scope injector, in its
 * injection context.
 */
export type FactoryPicker<M, P> = (
  module: M,
) => (injector: EnvironmentInjector) => P;

type Answer<F> = F extends (...args: never[]) => infer R ? R : never;

type Settled<R> = [R] extends [Observable<infer T>]
  ? T
  : [R] extends [PromiseLike<infer T>]
    ? T
    : never;

type KindOf<F> = F extends (...args: never[]) => infer R
  ? [R] extends [Observable<unknown>]
    ? typeof LazyMethod.Observable
    : [R] extends [PromiseLike<unknown>]
      ? typeof LazyMethod.Promise
      : 'NOT LAZY-SAFE: a lazy port method must return an Observable or a Promise'
  : 'NOT LAZY-SAFE: every member of a lazy port must be a method';

/**
 * The per-method classification of port `P`, checked against `F`, the
 * binding's load-failure answer. Each key is `LazyMethod.Observable` or
 * `LazyMethod.Promise` when that is what the method returns AND `F` is a
 * valid answer of it; otherwise the expected type is a sentence saying what
 * is wrong, so the compile error reads as the fix.
 */
export type LazyPortMethods<P, F> = {
  readonly [K in keyof P]-?: KindOf<P[K]> extends LazyMethod
    ? [F] extends [never]
      ? 'NOT LAZY-SAFE: onLoadError must answer, not throw — a throw is the rejection this mechanism exists to prevent'
      : [F] extends [Settled<Answer<P[K]>>]
        ? KindOf<P[K]>
        : "NOT LAZY-SAFE: onLoadError's answer is not a valid answer of this method"
    : KindOf<P[K]>;
};

/**
 * How one port is bound to a {@link LazyAdapterScope}: the `factory` that
 * builds the bundle answering it, every method of the port classified, and
 * the port's own answer for a load that failed — handed the scope's name
 * and the real cause.
 */
export type LazyPortBinding<P, M, F> = {
  readonly factory: FactoryPicker<M, P>;
  readonly methods: LazyPortMethods<P, NoInfer<F>>;
  readonly onLoadError: (scopeName: string, cause: unknown) => F;
};

/**
 * The per-application half of a scope: one load, one scope injector.
 * Created in the root injector on the first port INJECTION (which loads
 * nothing); the load itself waits for the first port CALL.
 */
type LazyScopeHost<M> = {
  /** The application is gone: nothing loads, and nothing should retry. */
  readonly closed: () => boolean;
  /**
   * The bundle `factory` builds, created once in the loaded scope — or why
   * there is none, the real cause; never a rejection.
   */
  readonly bundle: <P>(
    factory: FactoryPicker<M, P>,
  ) => Promise<Result<P, unknown>>;
};

/**
 * A group of adapters that load together: one dynamic import (or several in
 * parallel), one set of providers, one scope injector. Declare it once at
 * the composition root with {@link lazyAdapterScope} and bind each port to
 * it with {@link provideLazyPort}.
 */
export type LazyAdapterScope<M> = {
  readonly name: string;
  /** Called on the first port call, and again after a failed load. Read at call time. */
  readonly load: () => Promise<LazyAdapterModule<M>>;
  /**
   * Every port token bound to this scope (multi): what a wiring test injects
   * to prove that binding them loads nothing.
   */
  readonly ports: InjectionToken<readonly InjectionToken<unknown>[]>;
  /** @internal The scope's per-application host. */
  readonly host: InjectionToken<LazyScopeHost<M>>;
};

/** A loaded scope: its module, its injector holding the SDK instances, one bundle per factory. */
type LoadedScope<M> = {
  readonly module: M;
  readonly injector: EnvironmentInjector;
  readonly bundles: Map<FactoryPicker<M, unknown>, unknown>;
};

/** What a failure is reported under: the load, or one bundle factory. */
const LOAD = Symbol('load');

function lazyScopeHost<M>(
  scope: LazyAdapterScope<M>,
  parent: EnvironmentInjector,
  errorHandler: ErrorHandler,
  destroyRef: DestroyRef,
): LazyScopeHost<M> {
  let loading: Promise<LoadedScope<M>> | null = null;
  let current: LoadedScope<M> | null = null;
  let destroyed = false;
  /** What is failing right now and has been reported: reported once per failure. */
  const failing = new Set<typeof LOAD | FactoryPicker<M, unknown>>();

  const destroyedError = (): Error =>
    new Error(`${scope.name} was destroyed with its application`);

  const report = (
    key: typeof LOAD | FactoryPicker<M, unknown>,
    cause: unknown,
  ): void => {
    if (failing.has(key)) return;
    failing.add(key);
    errorHandler.handleError(lazyPortLoadError(scope.name, cause));
  };

  /** Imports the scope and creates its injector with every instance it lists. */
  const build = async (): Promise<LoadedScope<M>> => {
    if (destroyed) throw destroyedError();
    // Read off the scope at call time (a synchronous throw is a rejection
    // like any other here, inside an async function).
    const { module, providers, instances } = await scope.load();
    if (destroyed) throw destroyedError();
    const injector = createEnvironmentInjector(
      [...providers],
      parent,
      scope.name,
    );
    try {
      for (const token of instances) injector.get(token);
    } catch (cause) {
      // The half-built scope goes, with whatever it did create.
      injector.destroy();
      throw cause;
    }
    current = { module, injector, bundles: new Map() };
    return current;
  };

  const loaded = (): Promise<LoadedScope<M>> => {
    if (loading) return loading;
    const attempt = build();
    loading = attempt;
    // Handled here, so a failed load is never an unhandled rejection even
    // when every caller has already unsubscribed; forgotten, so the next
    // call imports again.
    attempt.then(
      () => failing.delete(LOAD),
      (cause: unknown) => {
        if (loading === attempt) loading = null;
        if (!destroyed) report(LOAD, cause);
      },
    );
    return attempt;
  };

  /**
   * The bundle `factory` builds, created once: picked and called with the
   * scope's injector, inside its injection context. A factory that throws
   * leaves nothing cached, so the next call calls it afresh.
   */
  const bundleOf = <P>(
    scoped: LoadedScope<M>,
    factory: FactoryPicker<M, P>,
  ): P => {
    if (scoped.bundles.has(factory)) return scoped.bundles.get(factory) as P;
    const bundle = runInInjectionContext(scoped.injector, () =>
      factory(scoped.module)(scoped.injector),
    );
    scoped.bundles.set(factory, bundle);
    return bundle;
  };

  destroyRef.onDestroy(() => {
    destroyed = true;
    loading = null;
    if (current !== null) {
      current.bundles.clear();
      current.injector.destroy();
    }
    current = null;
  });

  return {
    closed: () => destroyed,
    bundle: async <P>(
      factory: FactoryPicker<M, P>,
    ): Promise<Result<P, unknown>> => {
      let scoped: LoadedScope<M>;
      try {
        scoped = await loaded();
      } catch (cause) {
        // Already reported (once) by `loaded()`.
        return Result.err(cause);
      }
      if (destroyed) return Result.err(destroyedError());
      try {
        const bundle = bundleOf(scoped, factory);
        failing.delete(factory);
        return Result.ok(bundle);
      } catch (cause) {
        report(factory, cause);
        return Result.err(cause);
      }
    },
  };
}

/**
 * A scope — a plain record — named `name`, loading with `load`. The record
 * is what `provideLazyPort` binds to and what a wiring test reads `ports`
 * off; `load` is read at call time, so a spec may watch it.
 */
export function lazyAdapterScope<M>(
  name: string,
  load: () => Promise<LazyAdapterModule<M>>,
): LazyAdapterScope<M> {
  const scope: LazyAdapterScope<M> = {
    name,
    load,
    ports: new InjectionToken<readonly InjectionToken<unknown>[]>(
      `${name} ports`,
    ),
    host: new InjectionToken<LazyScopeHost<M>>(`${name} host`, {
      providedIn: 'root',
      factory: () =>
        lazyScopeHost(
          scope,
          inject(EnvironmentInjector),
          inject(ErrorHandler),
          inject(DestroyRef),
        ),
    }),
  };
  return scope;
}

/**
 * Binds `token` to a proxy that loads `scope` on its first call and forwards
 * every call to the bundle `binding.factory` builds. Environment-level
 * only: the scope's injector hangs off the root.
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
      useFactory: () =>
        lazyPort<P, M, F>(inject(scope.host), scope.name, binding),
    },
  ]);
}

type Method = (...args: unknown[]) => unknown;

/** Every proxy {@link provideLazyPort} built — what {@link isLazyPort} reads. */
const LAZY_PORTS = new WeakSet<object>();

/**
 * Whether `value` is a proxy {@link provideLazyPort} bound — a wiring test's
 * check that no eager binding put an adapter back in its place. The proxy
 * is a plain record (Law 1: no freeze marks it), so its identity
 * is kept here instead.
 */
export function isLazyPort(value: unknown): boolean {
  return typeof value === 'object' && value !== null && LAZY_PORTS.has(value);
}

function lazyPort<P, M, F>(
  host: LazyScopeHost<M>,
  scopeName: string,
  binding: LazyPortBinding<P, M, F>,
): P {
  const { factory, methods, onLoadError } = binding;
  // Called ON the bundle; a bundle's closures ignore `this`.
  const call = (bundle: P, name: string, args: unknown[]): unknown => {
    const method: unknown = Reflect.get(bundle as object, name);
    if (typeof method !== 'function') {
      throw new TypeError(`The lazily loaded bundle has no method "${name}"`);
    }
    return Reflect.apply(method, bundle, args);
  };

  const observe = (name: string, args: unknown[]): Observable<unknown> =>
    new Observable<unknown>((subscriber) => {
      let failures = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      subscriber.add(() => clearTimeout(retry));

      const attempt = (): void => {
        void host.bundle(factory).then((outcome) => {
          if (subscriber.closed) return;
          try {
            if (outcome.ok) {
              // Added to the subscriber, so a consumer that leaves on the
              // bundle's first, synchronous value still tears it down.
              subscriber.add(
                (
                  call(outcome.value, name, args) as Observable<unknown>
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
            if (failures === 0) {
              subscriber.next(onLoadError(scopeName, outcome.error));
            }
          } catch (error) {
            subscriber.error(error);
            return;
          }
          // The consumer may have left on the failure answer itself.
          if (subscriber.closed) return;
          if (host.closed()) {
            subscriber.complete();
            return;
          }
          retry = setTimeout(attempt, retryDelayMs(failures));
          failures += 1;
        });
      };
      attempt();
    });

  const forward = (name: string, method: LazyMethod): Method =>
    method === LazyMethod.Observable
      ? (...args) => observe(name, args)
      : async (...args) => {
          const outcome = await host.bundle(factory);
          return outcome.ok
            ? call(outcome.value, name, args)
            : onLoadError(scopeName, outcome.error);
        };
  const entries = Object.entries(methods) as [string, LazyMethod][];
  // A plain record (Law 1: no freeze) — the port's readonly type is the guard.
  const port = Object.fromEntries(
    entries.map(([name, method]) => [name, forward(name, method)]),
  );
  LAZY_PORTS.add(port);
  return port as P;
}
