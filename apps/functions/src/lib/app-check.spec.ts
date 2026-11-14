import { afterEach, describe, expect, it, vi } from 'vitest';
import { Expression } from 'firebase-functions/params';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { AppCheckMode, AppCheckTokenUse } from '@core/primitives';
import { CALLABLE_APP_CHECK_TOKEN, Callables } from '@core/ports';
import {
  APP_CHECK_MODE,
  appCheckFactsOf,
  replayProtectedOptions,
} from './app-check';

/** A callable request as the platform hands it — the raw request's headers and `app`, nothing else. */
const requestOf = (fields: object): CallableRequest<unknown> =>
  ({
    data: {},
    acceptsStreaming: false,
    ...fields,
  }) as CallableRequest<unknown>;

/** Headers carrying an App Check header whose value is an opaque placeholder — never a token. */
const WITH_HEADER = {
  headers: { 'x-firebase-appcheck': 'opaque-placeholder' },
};

describe('APP_CHECK_MODE — the one switch (S-RU-19)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the string param APP_CHECK_MODE, defaulting to OFF, its input the three modes', () => {
    expect(APP_CHECK_MODE.name).toBe('APP_CHECK_MODE');
    expect(APP_CHECK_MODE.options.default).toBe(AppCheckMode.Off);
    expect(APP_CHECK_MODE.options.input).toEqual({
      select: {
        options: Object.values(AppCheckMode).map((value) => ({ value })),
      },
    });
  });

  it('reads an UNSET variable as the empty string, not its default — the reason every reader treats "" as OFF', () => {
    vi.stubEnv('APP_CHECK_MODE', '');
    expect(APP_CHECK_MODE.value()).toBe('');
  });
});

describe('appCheckFactsOf — what the edge reads off a request (S-RU-17)', () => {
  it('reads no header and no app as nothing sent, nothing verified (MISSING facts)', () => {
    for (const rawRequest of [{}, { headers: {} }, undefined, null, 'text']) {
      expect(
        appCheckFactsOf(requestOf({ rawRequest })),
        String(rawRequest),
      ).toEqual({
        appCheckTokenSent: false,
        appCheckTokenVerified: false,
        appCheckTokenReplayed: false,
      });
    }
    expect(appCheckFactsOf(requestOf({}))).toEqual({
      appCheckTokenSent: false,
      appCheckTokenVerified: false,
      appCheckTokenReplayed: false,
    });
  });

  it("reads the header through Node's prototype accessor — `headers` is no own property of a real request", () => {
    // `http.IncomingMessage` defines `headers` as a getter on its prototype
    // (Node 22): an own-field read of it would read every call as MISSING.
    const nodeLike = Object.create({
      get headers() {
        return { 'x-firebase-appcheck': 'header.payload.' };
      },
    });
    expect(Object.hasOwn(nodeLike, 'headers')).toBe(false);
    expect(
      appCheckFactsOf(requestOf({ rawRequest: nodeLike })).appCheckTokenSent,
    ).toBe(true);
  });

  it('reads an EMPTY header as no header, as the platform does (MISSING)', () => {
    expect(
      appCheckFactsOf(
        requestOf({ rawRequest: { headers: { 'x-firebase-appcheck': '' } } }),
      ).appCheckTokenSent,
    ).toBe(false);
  });

  it('reads a header the platform did not verify — no `app` — as sent, unverified (INVALID facts)', () => {
    expect(appCheckFactsOf(requestOf({ rawRequest: WITH_HEADER }))).toEqual({
      appCheckTokenSent: true,
      appCheckTokenVerified: false,
      appCheckTokenReplayed: false,
    });
    // An `app` that is no record is no verification.
    for (const app of [null, 'app', 1, ['app']]) {
      expect(
        appCheckFactsOf(requestOf({ rawRequest: WITH_HEADER, app }))
          .appCheckTokenVerified,
        String(app),
      ).toBe(false);
    }
  });

  it('reads `request.app` as verified, and `app.alreadyConsumed === true` alone as replayed', () => {
    const app = { appId: 'app-1', token: {} };
    expect(
      appCheckFactsOf(requestOf({ rawRequest: WITH_HEADER, app })),
    ).toEqual({
      appCheckTokenSent: true,
      appCheckTokenVerified: true,
      appCheckTokenReplayed: false,
    });
    for (const alreadyConsumed of [false, 'true', 1, null]) {
      expect(
        appCheckFactsOf(
          requestOf({
            rawRequest: WITH_HEADER,
            app: { ...app, alreadyConsumed },
          }),
        ).appCheckTokenReplayed,
        String(alreadyConsumed),
      ).toBe(false);
    }
    expect(
      appCheckFactsOf(
        requestOf({
          rawRequest: WITH_HEADER,
          app: { ...app, alreadyConsumed: true },
        }),
      ),
    ).toEqual({
      appCheckTokenSent: true,
      appCheckTokenVerified: true,
      appCheckTokenReplayed: true,
    });
  });

  it('never reads the header’s VALUE: a header behind a throwing getter still reads as sent', () => {
    const headers = Object.defineProperty({}, 'x-firebase-appcheck', {
      enumerable: true,
      get: () => {
        throw new Error('the token was read');
      },
    });
    expect(appCheckFactsOf(requestOf({ rawRequest: { headers } }))).toEqual({
      appCheckTokenSent: true,
      appCheckTokenVerified: false,
      appCheckTokenReplayed: false,
    });
  });

  it('reads only its own facts: the result holds three booleans and nothing of the request', () => {
    const facts = appCheckFactsOf(
      requestOf({
        rawRequest: WITH_HEADER,
        app: { appId: 'app-1', token: { sub: 'app-1' } },
      }),
    );
    expect(Object.values(facts).every((v) => typeof v === 'boolean')).toBe(
      true,
    );
    expect(JSON.stringify(facts)).not.toContain('opaque-placeholder');
  });
});

describe('replayProtectedOptions — the limited-use callables consume their token (S-RU-21, S-DEP-11)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.values(Callables))(
    '%s carries consumeAppCheckToken exactly when the one table names it LIMITED_USE',
    (name) => {
      const options = replayProtectedOptions(name);
      // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal.
      if (CALLABLE_APP_CHECK_TOKEN[name] === AppCheckTokenUse.LimitedUse) {
        expect(Object.keys(options)).toEqual(['consumeAppCheckToken']);
        expect(options.consumeAppCheckToken).toBeInstanceOf(Expression);
      } else {
        expect(options).toEqual({});
      }
    },
  );

  it('names exactly the six sensitive callables', () => {
    expect(
      Object.values(Callables)
        .filter(
          (name) => 'consumeAppCheckToken' in replayProtectedOptions(name),
        )
        .sort(),
    ).toEqual(
      [
        Callables.EraseClient,
        Callables.ExportClientData,
        Callables.PreviewClientErasure,
        Callables.SetRoles,
        Callables.SetStaffPermissions,
        Callables.StartImpersonation,
      ].sort(),
    );
  });

  it.each([
    ['', false],
    [AppCheckMode.Off, false],
    ['monitor', false],
    ['ENFORCED', false],
    [AppCheckMode.Monitor, true],
    [AppCheckMode.Enforce, true],
  ] as const)(
    'consumes while the switch reads %j: %s — never on an unset "" (no notEquals(OFF))',
    (raw, consumes) => {
      vi.stubEnv('APP_CHECK_MODE', raw);
      const expression = replayProtectedOptions(
        Callables.EraseClient,
      ).consumeAppCheckToken;
      expect(expression?.value()).toBe(consumes);
    },
  );
});
