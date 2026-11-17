import { E164, Email, ParsedIdentifier } from '@core/components';
import { DurationMinutes } from '@core/primitives';
import { IdentityErrorCode, PipelineErrorCode } from '@core/errors';
import type { Log, OtpDeliveryPorts } from '@core/ports';
import { unwrapOk } from '@core/testing';
import {
  postmarkOtpSender,
  type PostmarkOtpSenderConfig,
  SEND_TIMEOUT_MS,
} from './postmark-otp-sender.adapter';

type Line = {
  readonly level: Parameters<Log>[0];
  readonly msg: string;
  readonly fields: Parameters<Log>[2];
};

type Call = {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
};

const TOKEN = 'server-token-spec';
const FROM = 'Creativo <codes@auth.example.test>';
const TO = ParsedIdentifier.email(Email.of('ana@example.com'));
const CODE = '482913';

/** A Postmark that answers `status` with `body` (JSON), recording each call. */
function postmark(
  status: number,
  body: unknown = { ErrorCode: 0, Message: 'OK', MessageID: 'm-1' },
): { readonly post: typeof fetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const post = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { post, calls };
}

function rig(
  overrides: Partial<PostmarkOtpSenderConfig> = {},
  answer: ReturnType<typeof postmark> = postmark(200),
) {
  const lines: Line[] = [];
  const config: PostmarkOtpSenderConfig = {
    serverToken: () => TOKEN,
    fromAddress: () => FROM,
    ttlMinutes: unwrapOk(DurationMinutes.of(5)),
    post: answer.post,
    log: (level, msg, fields) => {
      lines.push({ level, msg, fields });
    },
    ...overrides,
  };
  return {
    lines,
    calls: answer.calls,
    send: postmarkOtpSender(config).sendOtp,
  };
}

describe('postmark-otp-sender adapter (the deployed login-OTP sender)', () => {
  it('is the OtpDeliveryPorts bundle', () => {
    const ports: OtpDeliveryPorts = postmarkOtpSender({
      serverToken: () => TOKEN,
      fromAddress: () => FROM,
      ttlMinutes: unwrapOk(DurationMinutes.of(5)),
      post: postmark(200).post,
      log: () => undefined,
    });
    expect(Object.keys(ports)).toEqual(['sendOtp']);
  });

  it('sends ONE message from the OTP identity to the parsed address, on the transactional stream, untracked', async () => {
    const { send, calls, lines } = rig();
    expect(await send(TO, CODE)).toEqual({ ok: true, value: undefined });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.postmarkapp.com/email');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': TOKEN,
    });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.body).toMatchObject({
      From: FROM,
      To: 'ana@example.com',
      Subject: `Кодът ти за вход: ${CODE}`,
      Tag: 'sign-in-code',
      MessageStream: 'outbound',
      TrackOpens: false,
      TrackLinks: 'None',
    });
    expect(call?.body['TextBody']).toContain(CODE);
    expect(call?.body['HtmlBody']).toContain(CODE);
    expect(lines).toEqual([]);
  });

  it('reads the token and the address at each send — a secret is a runtime value', async () => {
    let token = 'first';
    const { send, calls } = rig({ serverToken: () => token });
    await send(TO, CODE);
    token = 'second';
    await send(TO, CODE);
    expect(
      calls.map(
        (call) =>
          (call.init.headers as Record<string, string>)[
            'X-Postmark-Server-Token'
          ],
      ),
    ).toEqual(['first', 'second']);
  });

  it('refuses an SMS destination as unavailable and calls nobody — it carries e-mail only', async () => {
    const { send, calls, lines } = rig();
    expect(
      await send(ParsedIdentifier.phone(E164.of('+359888123456')), CODE),
    ).toEqual({
      ok: false,
      error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
    });
    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('refuses as unavailable when the token or the address is not configured — one error line, no call', async () => {
    for (const overrides of [
      { serverToken: () => '' },
      { fromAddress: () => '  ' },
    ]) {
      const { send, calls, lines } = rig(overrides);
      expect(await send(TO, CODE)).toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
      });
      expect(calls).toEqual([]);
      expect(lines).toEqual([
        {
          level: 'error',
          msg: 'otp.provider_refused',
          fields: {
            reason: 'NOT_CONFIGURED',
            httpStatus: null,
            providerErrorCode: null,
          },
        },
      ]);
    }
  });

  it.each([
    ['a refused token', 401, 10],
    ['a refused From', 422, 403],
    ['an account pending approval', 422, 412],
    ['an account not approved', 422, 413],
    ['a missing stream', 422, 1235],
  ])(
    'answers %s as unavailable — only an operator fixes it, logged at error',
    async (_name, status, errorCode) => {
      const { send, lines } = rig(
        {},
        postmark(status, { ErrorCode: errorCode, Message: 'refused' }),
      );
      expect(await send(TO, CODE)).toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
      });
      expect(lines).toEqual([
        {
          level: 'error',
          msg: 'otp.provider_refused',
          fields: {
            reason: 'PROVIDER',
            httpStatus: status,
            providerErrorCode: errorCode,
          },
        },
      ]);
    },
  );

  it.each([
    ['an invalid address', 300],
    ['an inactive recipient (bounce or complaint)', 406],
  ])(
    'answers %s as an invalid request — another address is the fix, logged at warn',
    async (_name, errorCode) => {
      const { send, lines } = rig(
        {},
        postmark(422, { ErrorCode: errorCode, Message: 'refused' }),
      );
      const answer = await send(TO, CODE);
      expect(!answer.ok && answer.error.errorCode).toBe(
        PipelineErrorCode.InvalidRequest,
      );
      expect(lines.map((line) => [line.level, line.fields])).toEqual([
        [
          'warn',
          { reason: 'PROVIDER', httpStatus: 422, providerErrorCode: errorCode },
        ],
      ]);
    },
  );

  it('takes a 2xx whose body cannot be read as sent — Postmark accepted it, and a refusal would send the person for a second code', async () => {
    for (const body of ['not json', {}]) {
      const { send, lines } = rig({}, postmark(200, body));
      expect(await send(TO, CODE)).toEqual({ ok: true, value: undefined });
      expect(lines).toEqual([]);
    }
  });

  it('answers a rate limit, a Postmark fault or an unreadable answer as unavailable for now', async () => {
    for (const [status, body] of [
      [429, { ErrorCode: 429, Message: 'slow down' }],
      [500, { ErrorCode: 0, Message: 'oops' }],
      [503, 'maintenance'],
    ] as const) {
      const { send, lines } = rig({}, postmark(status, body));
      const answer = await send(TO, CODE);
      expect(!answer.ok && answer.error.errorCode, String(status)).toBe(
        PipelineErrorCode.Unavailable,
      );
      expect(lines[0]?.level).toBe('warn');
    }
  });

  it('answers no network, or no answer within the timeout, as unavailable — a transport line', async () => {
    const { send, lines } = rig({
      post: (async () => {
        throw new DOMException('timed out', 'TimeoutError');
      }) as typeof fetch,
    });
    const answer = await send(TO, CODE);
    expect(!answer.ok && answer.error.errorCode).toBe(
      PipelineErrorCode.Unavailable,
    );
    expect(lines).toEqual([
      {
        level: 'warn',
        msg: 'otp.provider_refused',
        fields: {
          reason: 'TRANSPORT',
          httpStatus: null,
          providerErrorCode: null,
        },
      },
    ]);
    expect(SEND_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('never writes the address, the code or the token into a line', async () => {
    const lines: Line[] = [];
    for (const answer of [
      postmark(422, { ErrorCode: 406, Message: 'inactive ana@example.com' }),
      postmark(401, { ErrorCode: 10, Message: 'bad token' }),
      postmark(500, {}),
    ]) {
      const run = rig({}, answer);
      await run.send(TO, CODE);
      lines.push(...run.lines);
    }
    const written = JSON.stringify(lines);
    for (const secret of ['ana@example.com', CODE, TOKEN]) {
      expect(written, secret).not.toContain(secret);
    }
  });
});
