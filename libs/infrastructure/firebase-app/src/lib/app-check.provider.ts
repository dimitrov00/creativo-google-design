import {
  DOCUMENT,
  type EnvironmentProviders,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import type { FirebaseApp } from 'firebase/app';
import {
  type AppCheck,
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';
import { ClientIssueKind } from '@core/components';
import type { ClientIssuePorts } from '@core/ports';
import { ClientIssueSystem } from '@core/systems';
import { FIREBASE_APP } from './firebase-app.provider';
import { CLIENT_ISSUE_REPORTER } from './reporting-error-handler';

/**
 * Where the page's App Check tokens come from (security hardening S-WS-A,
 * S-L-4, S-L-5) — the field `appCheckSource`.
 */
export const AppCheckSource = {
  /** A reCAPTCHA Enterprise site key is configured: Firebase's web provider, auto-refreshed. */
  RecaptchaEnterprise: 'RECAPTCHA_ENTERPRISE',
  /** The emulators are on: an unsigned emulator token the Functions emulator decodes without verifying (S-RU-18). */
  Emulator: 'EMULATOR',
  /** No site key and no emulators (production today): App Check never loads, every call goes out headerless. */
  None: 'NONE',
} as const;
export type AppCheckSource =
  (typeof AppCheckSource)[keyof typeof AppCheckSource];

/** The page's App Check configuration, as {@link appCheckConfigOf} reads it off the environment. */
export type AppCheckConfig =
  | {
      readonly appCheckSource: typeof AppCheckSource.RecaptchaEnterprise;
      /** The PUBLIC reCAPTCHA Enterprise site key (`environment.appCheck.siteKey`). */
      readonly siteKey: string;
    }
  | { readonly appCheckSource: typeof AppCheckSource.Emulator }
  | { readonly appCheckSource: typeof AppCheckSource.None };

/**
 * How long the RECAPTCHA_ENTERPRISE branch waits for reCAPTCHA to be READY
 * before the page runs without App Check (S-L-24, S-RU-31): ONE bound,
 * started before `enterprise.js` is appended, over the loader's `load` AND
 * reCAPTCHA's own `grecaptcha.enterprise.ready`. `enterprise.js` is only a
 * loader — its `ready` queues callbacks until the library it injects from
 * `www.gstatic.com/recaptcha/` runs — and the SDK's readiness settles only
 * inside that `ready`, with no `onerror` and no bound of its own: a loader
 * or a library a blocker, a firewall or a wrong CSP host keeps from running
 * would leave it unsettled, and every Functions, Firestore, Auth and
 * Storage call would wait on it for ever. Bounded here, such a page sends
 * headerless (`MISSING` — measurable under MONITOR, refused only under
 * ENFORCE) and never hangs.
 */
export const APP_CHECK_SCRIPT_TIMEOUT_MS = 10_000;

/**
 * The page's App Check instance — settles ONCE per page: the instance, or
 * `null` (NONE, or a reCAPTCHA that failed, or was not ready in time). Never
 * rejects. The callable client awaits it before each call (S-L-5), so no
 * callable leaves before App Check is decided, and none waits beyond
 * {@link APP_CHECK_SCRIPT_TIMEOUT_MS}.
 */
export const FIREBASE_APP_CHECK = new InjectionToken<Promise<AppCheck | null>>(
  'FIREBASE_APP_CHECK',
);

/** The reCAPTCHA Enterprise loader — `render=explicit`, the form the SDK itself loads (`@firebase/app-check` `loadReCAPTCHAEnterpriseScript`). */
const RECAPTCHA_ENTERPRISE_SCRIPT =
  'https://www.google.com/recaptcha/enterprise.js?render=explicit';

/**
 * The emulator token's expiry (9999-12-31T23:59:59Z): a constant, so the
 * token is never stale and no clock is read. The Functions emulator never
 * looks at it; the SDK only compares it with now.
 */
const EMULATOR_TOKEN_EXPIRES_UTC_MS = 253_402_300_799_000;

/**
 * Why the page runs without App Check — the `errorName` of the one client
 * issue it reports (a `CHUNK_LOAD_FAILED` condition: a script that did not
 * arrive, logged at `warn`).
 */
const AppCheckUnavailable = {
  /** `enterprise.js` fired `error` (blocked, offline, refused by the CSP). */
  ScriptFailed: 'AppCheckScriptFailed',
  /** `enterprise.js` fired nothing within {@link APP_CHECK_SCRIPT_TIMEOUT_MS}. */
  ScriptTimedOut: 'AppCheckScriptTimedOut',
  /**
   * `enterprise.js` loaded, but `grecaptcha.enterprise.ready` did not fire
   * within the same {@link APP_CHECK_SCRIPT_TIMEOUT_MS} — the library it
   * injects from `www.gstatic.com/recaptcha/` was blocked, failed or never
   * arrived (review round 2).
   */
  NotReady: 'AppCheckNotReady',
  /** It loaded without a callable `grecaptcha.enterprise.ready`, that `ready` threw, or `initializeAppCheck` threw. */
  NotInitialized: 'AppCheckNotInitialized',
} as const;
type AppCheckUnavailable =
  (typeof AppCheckUnavailable)[keyof typeof AppCheckUnavailable];

/**
 * The page's App Check configuration: the emulators on → EMULATOR (whatever
 * the site key says — a key is never sent to the emulators); else an empty
 * site key → NONE; else RECAPTCHA_ENTERPRISE over that key.
 */
export function appCheckConfigOf(environment: {
  readonly emulators: { readonly enabled: boolean };
  readonly appCheck: { readonly siteKey: string };
}): AppCheckConfig {
  if (environment.emulators.enabled) {
    return { appCheckSource: AppCheckSource.Emulator };
  }
  const siteKey = environment.appCheck.siteKey;
  return siteKey === ''
    ? { appCheckSource: AppCheckSource.None }
    : { appCheckSource: AppCheckSource.RecaptchaEnterprise, siteKey };
}

/**
 * App Check for the page (S-L-5): {@link FIREBASE_APP_CHECK} and an
 * environment initializer that starts it at boot.
 *
 * - **RECAPTCHA_ENTERPRISE** — appends `enterprise.js` itself (through
 *   `DOCUMENT`, `onload` / `onerror`), then hands a callback to the loaded
 *   `grecaptcha.enterprise.ready`, both within ONE
 *   {@link APP_CHECK_SCRIPT_TIMEOUT_MS} started before the script is
 *   appended; initialised only once `grecaptcha.enterprise.ready` has
 *   fired: `initializeAppCheck` with a `ReCaptchaEnterpriseProvider`,
 *   auto-refresh on — the SDK reuses the loaded `grecaptcha` and loads no
 *   second script. An error, a timeout (before `load`, or a `ready` that
 *   never fires), a missing or throwing `ready` or a failed initialisation
 *   leaves App Check uninitialised for the page (`null`, one client issue):
 *   every SDK then sends without a token (S-RU-31). A `ready` that fires
 *   after the bound changes nothing.
 * - **EMULATOR** — a `CustomProvider` presenting {@link emulatorAppCheckToken},
 *   auto-refresh off (S-RU-18: never the debug provider, which calls
 *   Google's real exchange endpoint).
 * - **NONE** — resolves `null`; `firebase/app-check`'s `initializeAppCheck`
 *   is never called, nothing loads, and the SDK never reads a debug token.
 *
 * The Functions SDK picks the instance up even though it was made after it
 * (`provideFirebaseFunctions` is unchanged).
 */
export function provideFirebaseAppCheck(
  config: AppCheckConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FIREBASE_APP_CHECK, useFactory: () => appCheckOf(config) },
    provideEnvironmentInitializer(() => {
      inject(FIREBASE_APP_CHECK);
    }),
  ]);
}

/**
 * The emulator's App Check token (S-L-4): unsigned and JWT-shaped —
 * `{"alg":"none"}` . `{"sub": appId}` . an empty signature, each part
 * base64url — the shape firebase-functions decodes without verifying under
 * the emulator (`unsafeDecodeAppCheckToken`: `app_id` = `sub`). Built at
 * run time, never a literal (gitleaks' JWT rule binds the pre-commit hook);
 * every real verifier refuses it, so it is fail-safe if it ever shipped.
 */
export function emulatorAppCheckToken(appId: string): string {
  return `${base64Url({ alg: 'none' })}.${base64Url({ sub: appId })}.`;
}

/** `value` as JSON in base64url, unpadded — one JWT segment. */
function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The instance {@link FIREBASE_APP_CHECK} settles with — run in the token's injection context. */
function appCheckOf(config: AppCheckConfig): Promise<AppCheck | null> {
  switch (config.appCheckSource) {
    case AppCheckSource.None:
      return Promise.resolve(null);
    case AppCheckSource.Emulator: {
      const app = inject(FIREBASE_APP);
      return Promise.resolve(
        initializeAppCheck(app, {
          provider: emulatorProvider(app),
          isTokenAutoRefreshEnabled: false,
        }),
      );
    }
    case AppCheckSource.RecaptchaEnterprise:
      return recaptchaEnterpriseAppCheck(
        inject(FIREBASE_APP),
        config.siteKey,
        inject(DOCUMENT),
        inject(CLIENT_ISSUE_REPORTER),
      );
  }
}

/** The EMULATOR branch's provider: the app's own emulator token, never stale. */
function emulatorProvider(app: FirebaseApp): CustomProvider {
  return new CustomProvider({
    getToken: async () => ({
      token: emulatorAppCheckToken(app.options.appId ?? ''),
      expireTimeMillis: EMULATOR_TOKEN_EXPIRES_UTC_MS,
    }),
  });
}

/**
 * The RECAPTCHA_ENTERPRISE branch (S-L-24): the script and reCAPTCHA's
 * readiness first, under one bound; App Check only once
 * `grecaptcha.enterprise.ready` has fired; `null` and one client issue on
 * any failure — never a rejection.
 */
async function recaptchaEnterpriseAppCheck(
  app: FirebaseApp,
  siteKey: string,
  document: Document,
  issues: ClientIssuePorts,
): Promise<AppCheck | null> {
  const failure = await enterpriseReady(document);
  if (failure !== null) {
    reportUnavailable(issues, failure);
    return null;
  }
  try {
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    reportUnavailable(issues, AppCheckUnavailable.NotInitialized);
    return null;
  }
}

/**
 * Appends `enterprise.js` and settles ONCE, on the first of: reCAPTCHA's own
 * `grecaptcha.enterprise.ready` firing after `load` (`null` — ready);
 * `error`; a `load` that left no callable `ready`, or a `ready` that threw;
 * or {@link APP_CHECK_SCRIPT_TIMEOUT_MS} — ONE timer, started before the
 * script is appended, over both stages (`ScriptTimedOut` before `load`,
 * `NotReady` after it). A `ready` that fires after the bound is a no-op:
 * the promise has already settled.
 */
function enterpriseReady(
  document: Document,
): Promise<AppCheckUnavailable | null> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    let loaded = false;
    const settle = (failure: AppCheckUnavailable | null) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      resolve(failure);
    };
    const timer = setTimeout(
      () =>
        settle(
          loaded
            ? AppCheckUnavailable.NotReady
            : AppCheckUnavailable.ScriptTimedOut,
        ),
      APP_CHECK_SCRIPT_TIMEOUT_MS,
    );
    script.onload = () => {
      loaded = true;
      if (!queuedOnReady(document.defaultView, () => settle(null))) {
        settle(AppCheckUnavailable.NotInitialized);
      }
    };
    script.onerror = () => settle(AppCheckUnavailable.ScriptFailed);
    script.src = RECAPTCHA_ENTERPRISE_SCRIPT;
    document.head.appendChild(script);
  });
}

/**
 * Hands `onReady` to the loaded `grecaptcha.enterprise.ready` — the queue
 * the SDK's own readiness waits on (`getRecaptcha(true)`,
 * `queueWidgetRender`); `false` when the load left no callable `ready` on
 * the page or it threw. Never a throw.
 */
function queuedOnReady(view: Window | null, onReady: () => void): boolean {
  try {
    const enterprise = propertyOf(propertyOf(view, 'grecaptcha'), 'enterprise');
    const ready = propertyOf(enterprise, 'ready');
    if (typeof ready !== 'function') return false;
    Reflect.apply(ready, enterprise, [onReady]);
    return true;
  } catch {
    return false;
  }
}

/** `holder[key]` when `holder` is an object or a function, else `undefined`. */
function propertyOf(holder: unknown, key: string): unknown {
  return (typeof holder === 'object' && holder !== null) ||
    typeof holder === 'function'
    ? Reflect.get(holder, key)
    : undefined;
}

/** The one client issue of a page that runs without App Check — a condition, never a rejection. */
function reportUnavailable(
  issues: ClientIssuePorts,
  failure: AppCheckUnavailable,
): void {
  try {
    issues.reportClientIssues([
      ClientIssueSystem.compose({
        clientIssueKind: ClientIssueKind.ChunkLoadFailed,
        errorName: failure,
        documentPath: null,
        fieldName: null,
        routePattern: null,
        topFrame: null,
        message: null,
        release: null,
      }),
    ]);
  } catch {
    // A report never changes the decision: a sink that throws is dropped here.
  }
}
