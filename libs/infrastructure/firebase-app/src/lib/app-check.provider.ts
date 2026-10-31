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
 * How long the RECAPTCHA_ENTERPRISE branch waits for `enterprise.js` before
 * the page runs without App Check (S-L-24, S-RU-31). The SDK's own loader
 * has no `onerror` and no bound: a script a blocker, a firewall or a wrong
 * CSP host keeps from loading would leave its readiness unsettled, and
 * every Functions, Firestore, Auth and Storage call would wait on it for
 * ever. Bounded here, such a page sends headerless (`MISSING` — measurable
 * under MONITOR, refused only under ENFORCE) and never hangs.
 */
export const APP_CHECK_SCRIPT_TIMEOUT_MS = 10_000;

/**
 * The page's App Check instance — settles ONCE per page: the instance, or
 * `null` (NONE, or a reCAPTCHA script that failed or timed out). Never
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
  /** It loaded, but no `grecaptcha.enterprise` came with it, or `initializeAppCheck` threw. */
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
 *   `DOCUMENT`, `onload` / `onerror`, raced against
 *   {@link APP_CHECK_SCRIPT_TIMEOUT_MS}); once `grecaptcha.enterprise`
 *   exists, `initializeAppCheck` with a `ReCaptchaEnterpriseProvider`,
 *   auto-refresh on — the SDK reuses the loaded `grecaptcha` and loads no
 *   second script. An error, a timeout or a failed initialisation leaves
 *   App Check uninitialised for the page (`null`, one client issue): every
 *   SDK then sends without a token (S-RU-31).
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
 * The RECAPTCHA_ENTERPRISE branch (S-L-24): the script first, bounded; App
 * Check only over a loaded `grecaptcha.enterprise`; `null` and one client
 * issue on any failure — never a rejection.
 */
async function recaptchaEnterpriseAppCheck(
  app: FirebaseApp,
  siteKey: string,
  document: Document,
  issues: ClientIssuePorts,
): Promise<AppCheck | null> {
  const failure = await loadEnterpriseScript(document);
  if (failure !== null) {
    reportUnavailable(issues, failure);
    return null;
  }
  if (!hasEnterprise(document.defaultView)) {
    reportUnavailable(issues, AppCheckUnavailable.NotInitialized);
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
 * Appends `enterprise.js` and settles on the first of `load` (`null`),
 * `error` or {@link APP_CHECK_SCRIPT_TIMEOUT_MS} (why it did not load).
 */
function loadEnterpriseScript(
  document: Document,
): Promise<AppCheckUnavailable | null> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    const settle = (failure: AppCheckUnavailable | null) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      resolve(failure);
    };
    const timer = setTimeout(
      () => settle(AppCheckUnavailable.ScriptTimedOut),
      APP_CHECK_SCRIPT_TIMEOUT_MS,
    );
    script.onload = () => settle(null);
    script.onerror = () => settle(AppCheckUnavailable.ScriptFailed);
    script.src = RECAPTCHA_ENTERPRISE_SCRIPT;
    document.head.appendChild(script);
  });
}

/** Whether the loaded script left `grecaptcha.enterprise` on the page — what the SDK reuses (`getRecaptcha(true)`). */
function hasEnterprise(view: Window | null): boolean {
  const grecaptcha: unknown =
    view === null ? undefined : Reflect.get(view, 'grecaptcha');
  return (
    typeof grecaptcha === 'object' &&
    grecaptcha !== null &&
    Reflect.get(grecaptcha, 'enterprise') !== undefined
  );
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
