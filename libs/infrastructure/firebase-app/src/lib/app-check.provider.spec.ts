import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FirebaseApp } from 'firebase/app';
import { ClientIssueKind } from '@core/components';
import { ClientIssueSystem } from '@core/systems';
import { recordingClientIssuePorts } from '@core/testing';
import { FIREBASE_APP } from './firebase-app.provider';
import { CLIENT_ISSUE_REPORTER } from './reporting-error-handler';

const { initializeAppCheckMock, APP_CHECK } = vi.hoisted(() => {
  const instance = { app: 'app-check-instance' };
  return {
    APP_CHECK: instance,
    initializeAppCheckMock: vi.fn<(app: unknown, options: unknown) => unknown>(
      () => instance,
    ),
  };
});

vi.mock('firebase/app-check', async () => ({
  ...(await vi.importActual<typeof import('firebase/app-check')>(
    'firebase/app-check',
  )),
  initializeAppCheck: initializeAppCheckMock,
}));

const { CustomProvider, ReCaptchaEnterpriseProvider } =
  await import('firebase/app-check');
const {
  APP_CHECK_SCRIPT_TIMEOUT_MS,
  AppCheckSource,
  FIREBASE_APP_CHECK,
  appCheckConfigOf,
  emulatorAppCheckToken,
  provideFirebaseAppCheck,
} = await import('./app-check.provider');

/** The app stand-in: only its options are read (the emulator token's `sub`). */
const APP = {
  name: '[DEFAULT]',
  options: { appId: '1:123:web:abc' },
} as unknown as FirebaseApp;

const SCRIPT_SRC =
  'https://www.google.com/recaptcha/enterprise.js?render=explicit';

/** One JWT segment decoded back to its JSON. */
function segment(part: string | undefined): unknown {
  const base64 = (part ?? '').replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

/** The App Check options `initializeAppCheck` was called with. */
function initOptions(): {
  readonly provider: unknown;
  readonly isTokenAutoRefreshEnabled: boolean;
} {
  return initializeAppCheckMock.mock.calls[0]?.[1] as never;
}

/** The root injector with App Check under `config`, the app and the reporter stood in. */
function boot(config: Parameters<typeof provideFirebaseAppCheck>[0]) {
  const sink = recordingClientIssuePorts();
  TestBed.configureTestingModule({
    providers: [
      provideFirebaseAppCheck(config),
      { provide: FIREBASE_APP, useValue: APP },
      {
        provide: CLIENT_ISSUE_REPORTER,
        useValue: { ...sink.ports, connect: () => undefined },
      },
    ],
  });
  // Creating the injector runs the environment initializer.
  const document = TestBed.inject(DOCUMENT);
  return { sink, document };
}

/** The loader script the RECAPTCHA_ENTERPRISE branch appended. */
function loaderScripts(document: Document): HTMLScriptElement[] {
  return [...document.head.querySelectorAll('script')].filter(
    (script) => script.src === SCRIPT_SRC,
  );
}

/**
 * What `enterprise.js` leaves on the page once reCAPTCHA is ready: a
 * `grecaptcha.enterprise` whose `ready` runs its callback at once.
 */
const READY_GRECAPTCHA = {
  enterprise: { ready: (onReady: () => void) => onReady() },
};

/**
 * What the loader alone leaves on the page (review round 2): a
 * `grecaptcha.enterprise.ready` stub that only queues its callbacks until
 * the library from `www.gstatic.com/recaptcha/` runs.
 */
function loaderOnlyGrecaptcha() {
  const queued: (() => void)[] = [];
  return {
    queued,
    grecaptcha: {
      enterprise: { ready: (onReady: () => void) => void queued.push(onReady) },
    },
  };
}

/** The one client issue of a page that runs without App Check. */
const unavailable = (errorName: string) =>
  ClientIssueSystem.compose({
    clientIssueKind: ClientIssueKind.ChunkLoadFailed,
    errorName,
    documentPath: null,
    fieldName: null,
    routePattern: null,
    topFrame: null,
    message: null,
    release: null,
  });

beforeEach(() => initializeAppCheckMock.mockClear());

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  for (const script of [...document.head.querySelectorAll('script')]) {
    script.remove();
  }
  Reflect.deleteProperty(document.defaultView ?? {}, 'grecaptcha');
});

describe('appCheckConfigOf — the page’s App Check source', () => {
  it('is EMULATOR whenever the emulators are on, a site key or not', () => {
    for (const siteKey of ['', 'site-key']) {
      expect(
        appCheckConfigOf({
          emulators: { enabled: true },
          appCheck: { siteKey },
        }),
      ).toEqual({ appCheckSource: AppCheckSource.Emulator });
    }
  });

  it('is NONE for an empty site key with the emulators off (production today)', () => {
    expect(
      appCheckConfigOf({
        emulators: { enabled: false },
        appCheck: { siteKey: '' },
      }),
    ).toEqual({ appCheckSource: AppCheckSource.None });
  });

  it('is RECAPTCHA_ENTERPRISE over the site key otherwise', () => {
    expect(
      appCheckConfigOf({
        emulators: { enabled: false },
        appCheck: { siteKey: 'site-key' },
      }),
    ).toEqual({
      appCheckSource: AppCheckSource.RecaptchaEnterprise,
      siteKey: 'site-key',
    });
  });
});

describe('emulatorAppCheckToken — the unsigned emulator token (S-L-4)', () => {
  it('is JWT-shaped as firebase-functions decodes it: alg none, sub = the app id, an empty signature', () => {
    const token = emulatorAppCheckToken('1:123:web:abc');
    const [header, payload, signature] = token.split('.');

    // firebase-functions' JWT_REGEX (common/providers/https.js): three
    // dot-separated base64url parts, the last one empty here.
    expect(token.split('.')).toHaveLength(3);
    expect(header).toMatch(/^[\w-]+$/);
    expect(payload).toMatch(/^[\w-]+$/);
    expect(segment(header)).toEqual({ alg: 'none' });
    expect(segment(payload)).toEqual({ sub: '1:123:web:abc' });
    expect(signature).toBe('');
  });

  it('is base64url, unpadded', () => {
    expect(emulatorAppCheckToken('a~~~?')).not.toMatch(/[+/=]/);
  });
});

describe('provideFirebaseAppCheck — NONE', () => {
  it('resolves null, never calls initializeAppCheck and loads nothing', async () => {
    const { document } = boot({ appCheckSource: AppCheckSource.None });

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(loaderScripts(document)).toEqual([]);
  });
});

describe('provideFirebaseAppCheck — EMULATOR', () => {
  it('starts at boot: a CustomProvider presenting the emulator token, auto-refresh off', async () => {
    boot({ appCheckSource: AppCheckSource.Emulator });

    // The environment initializer already ran it — before anyone asked.
    expect(initializeAppCheckMock).toHaveBeenCalledTimes(1);
    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBe(APP_CHECK);
    expect(initializeAppCheckMock.mock.calls[0]?.[0]).toBe(APP);
    const options = initOptions();
    expect(options.isTokenAutoRefreshEnabled).toBe(false);
    expect(options.provider).toBeInstanceOf(CustomProvider);

    // `getToken` is the provider's @internal seam the SDK calls.
    const minted = await (
      options.provider as {
        readonly getToken: () => Promise<{
          readonly token: string;
          readonly expireTimeMillis: number;
        }>;
      }
    ).getToken();
    expect(minted.token).toBe(emulatorAppCheckToken('1:123:web:abc'));
    expect(minted.expireTimeMillis).toBeGreaterThan(Date.UTC(9999, 0, 1));
  });
});

describe('provideFirebaseAppCheck — RECAPTCHA_ENTERPRISE (S-L-24)', () => {
  const CONFIG = {
    appCheckSource: AppCheckSource.RecaptchaEnterprise,
    siteKey: 'site-key',
  } as const;

  it('appends enterprise.js at boot and initialises once grecaptcha.enterprise.ready has fired', async () => {
    const { document, sink } = boot(CONFIG);
    const scripts = loaderScripts(document);
    expect(scripts).toHaveLength(1);
    expect(initializeAppCheckMock).not.toHaveBeenCalled();

    Reflect.set(document.defaultView ?? {}, 'grecaptcha', READY_GRECAPTCHA);
    scripts[0]?.dispatchEvent(new Event('load'));

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBe(APP_CHECK);
    expect(initializeAppCheckMock).toHaveBeenCalledTimes(1);
    const options = initOptions();
    expect(options.provider).toBeInstanceOf(ReCaptchaEnterpriseProvider);
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
    expect(sink.reported).toEqual([]);
  });

  it('a script error resolves null, never initialises, and reports one issue', async () => {
    const { document, sink } = boot(CONFIG);

    loaderScripts(document)[0]?.dispatchEvent(new Event('error'));

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toEqual([unavailable('AppCheckScriptFailed')]);
  });

  it('no load within APP_CHECK_SCRIPT_TIMEOUT_MS resolves null, never initialises, and reports one issue', async () => {
    vi.useFakeTimers();
    const { document, sink } = boot(CONFIG);
    let settled = false;
    void TestBed.inject(FIREBASE_APP_CHECK).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(APP_CHECK_SCRIPT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toEqual([unavailable('AppCheckScriptTimedOut')]);

    // A load after the bound changes nothing.
    loaderScripts(document)[0]?.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toHaveLength(1);
  });

  it('a script that loads without grecaptcha.enterprise resolves null and reports one issue', async () => {
    const { document, sink } = boot(CONFIG);

    loaderScripts(document)[0]?.dispatchEvent(new Event('load'));

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toEqual([unavailable('AppCheckNotInitialized')]);
  });

  it('an initializeAppCheck that throws resolves null — never a rejection', async () => {
    initializeAppCheckMock.mockImplementationOnce(() => {
      throw new Error('already initialised differently');
    });
    const { document, sink } = boot(CONFIG);

    Reflect.set(document.defaultView ?? {}, 'grecaptcha', READY_GRECAPTCHA);
    loaderScripts(document)[0]?.dispatchEvent(new Event('load'));

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(sink.reported).toEqual([unavailable('AppCheckNotInitialized')]);
  });

  // Review round 2, finding 1: `enterprise.js` is only a loader. Its
  // `grecaptcha.enterprise.ready` queues callbacks until the library it
  // injects from www.gstatic.com/recaptcha/ runs, and the SDK's token waits
  // on that `ready` with no bound — so App Check starts only once it fired,
  // and the ONE bound covers the loader and the readiness together.
  it('a loader whose ready never fires resolves null within APP_CHECK_SCRIPT_TIMEOUT_MS, never initialises, and reports one issue', async () => {
    vi.useFakeTimers();
    const { document, sink } = boot(CONFIG);
    const { queued, grecaptcha } = loaderOnlyGrecaptcha();
    let settled = false;
    void TestBed.inject(FIREBASE_APP_CHECK).then(() => {
      settled = true;
    });

    // The loader arrives half-way through the bound; its `ready` only queues.
    await vi.advanceTimersByTimeAsync(APP_CHECK_SCRIPT_TIMEOUT_MS / 2);
    Reflect.set(document.defaultView ?? {}, 'grecaptcha', grecaptcha);
    loaderScripts(document)[0]?.dispatchEvent(new Event('load'));
    expect(queued).toHaveLength(1);

    // One bound from boot, not a second one from `load`.
    await vi.advanceTimersByTimeAsync(APP_CHECK_SCRIPT_TIMEOUT_MS / 2 - 1);
    expect(settled).toBe(false);
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toEqual([unavailable('AppCheckNotReady')]);

    // A `ready` that fires after the bound changes nothing.
    for (const onReady of queued) onReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(sink.reported).toHaveLength(1);
  });

  it('a ready that fires late but within the bound initialises, reporting nothing', async () => {
    vi.useFakeTimers();
    const { document, sink } = boot(CONFIG);
    const { queued, grecaptcha } = loaderOnlyGrecaptcha();
    Reflect.set(document.defaultView ?? {}, 'grecaptcha', grecaptcha);
    loaderScripts(document)[0]?.dispatchEvent(new Event('load'));

    await vi.advanceTimersByTimeAsync(APP_CHECK_SCRIPT_TIMEOUT_MS - 1);
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    for (const onReady of queued) onReady();

    await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBe(APP_CHECK);
    expect(initializeAppCheckMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(APP_CHECK_SCRIPT_TIMEOUT_MS);
    expect(sink.reported).toEqual([]);
  });

  it.each([
    ['a grecaptcha.enterprise with no ready', { enterprise: {} }],
    ['a ready that is no function', { enterprise: { ready: 'ready' } }],
    [
      'a ready that throws',
      {
        enterprise: {
          ready: () => {
            throw new Error('reCAPTCHA broke');
          },
        },
      },
    ],
  ])(
    '%s resolves null, never initialises, and reports one issue',
    async (_, grecaptcha) => {
      const { document, sink } = boot(CONFIG);

      Reflect.set(document.defaultView ?? {}, 'grecaptcha', grecaptcha);
      loaderScripts(document)[0]?.dispatchEvent(new Event('load'));

      await expect(TestBed.inject(FIREBASE_APP_CHECK)).resolves.toBeNull();
      expect(initializeAppCheckMock).not.toHaveBeenCalled();
      expect(sink.reported).toEqual([unavailable('AppCheckNotInitialized')]);
    },
  );
});
