import { logger } from 'firebase-functions';
import { BookingErrorCode } from '@core/errors';
import type { LogContextPorts, TelemetryPorts } from '@core/ports';
import { ClientIssueSystem } from '@core/systems';
import {
  type LogSink,
  consoleLogContext,
  consoleTelemetry,
} from './console-telemetry.adapter';

type Call = {
  readonly level: 'info' | 'warn' | 'error' | 'write';
  readonly args: unknown[];
};

function recordingSink(): { readonly sink: LogSink; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    sink: {
      info: (...args) => calls.push({ level: 'info', args }),
      warn: (...args) => calls.push({ level: 'warn', args }),
      error: (...args) => calls.push({ level: 'error', args }),
      write: (entry) => calls.push({ level: 'write', args: [entry] }),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('console-telemetry adapter', () => {
  it('is the telemetry bundle', () => {
    const ports: TelemetryPorts = consoleTelemetry(recordingSink().sink);
    expect(Object.keys(ports).sort()).toEqual(['log', 'trackError']);
  });

  describe('log', () => {
    it('writes each level to its own severity', () => {
      const { sink, calls } = recordingSink();
      const { log } = consoleTelemetry(sink);
      log('info', 'booking.committed');
      log('warn', 'booking.rejected');
      log('error', 'booking.failed');
      expect(calls).toEqual([
        { level: 'info', args: ['booking.committed'] },
        { level: 'warn', args: ['booking.rejected'] },
        { level: 'error', args: ['booking.failed'] },
      ]);
    });

    it('rides the fields as the structured payload — a plain copy, never the caller object', () => {
      const { sink, calls } = recordingSink();
      const fields = Object.freeze({
        errorCode: BookingErrorCode.SlotUnavailable,
      });
      consoleTelemetry(sink).log('warn', 'booking.rejected', fields);
      const [msg, payload] = calls[0]?.args ?? [];
      expect(msg).toBe('booking.rejected');
      expect(payload).toEqual({ errorCode: BookingErrorCode.SlotUnavailable });
      expect(payload).not.toBe(fields);
      expect((payload as object).constructor).toBe(Object);
    });
  });

  describe('a web client’s error line (OR-34)', () => {
    it('is written as a whole ERROR entry, its message the client’s own frame — never the server’s stack', () => {
      const { sink, calls } = recordingSink();
      const fields = {
        '@type': ClientIssueSystem.REPORTED_ERROR_EVENT,
        clientIssueKind: 'UNCAUGHT_ERROR',
        serviceContext: { service: 'web', version: 'unknown' },
      };
      consoleTelemetry(sink).log(
        'error',
        'TypeError: x is undefined\n    at main.js:1:2',
        fields,
      );
      expect(calls).toEqual([
        {
          level: 'write',
          args: [
            {
              ...fields,
              severity: 'ERROR',
              message: 'TypeError: x is undefined\n    at main.js:1:2',
            },
          ],
        },
      ]);
    });

    it('leaves every other error line to the logger’s own error writer', () => {
      const { sink, calls } = recordingSink();
      consoleTelemetry(sink).log('error', 'booking.failed', { callable: 'x' });
      expect(calls).toEqual([
        { level: 'error', args: ['booking.failed', { callable: 'x' }] },
      ]);
    });
  });

  describe('trackError', () => {
    it('logs an Error as itself at error severity, the context as payload', () => {
      const { sink, calls } = recordingSink();
      const error = new Error('store unreachable');
      consoleTelemetry(sink).trackError(error, { callable: 'commitBooking' });
      expect(calls).toEqual([
        { level: 'error', args: [error, { callable: 'commitBooking' }] },
      ]);
    });

    it('describes a thrown non-Error and keeps the payload structured', () => {
      const { sink, calls } = recordingSink();
      const { trackError } = consoleTelemetry(sink);
      trackError({ code: 14 });
      trackError('plain string', { fn: 'rebuildBusy' });
      expect(calls).toEqual([
        {
          level: 'error',
          args: ['non-error thrown', { thrown: '{"code":14}' }],
        },
        {
          level: 'error',
          args: [
            'non-error thrown',
            { fn: 'rebuildBusy', thrown: 'plain string' },
          ],
        },
      ]);
    });

    it('survives a value JSON cannot render', () => {
      const { sink, calls } = recordingSink();
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      consoleTelemetry(sink).trackError(circular);
      expect(calls[0]?.args).toEqual([
        'non-error thrown',
        { thrown: '[object Object]' },
      ]);
    });
  });

  describe('the invocation’s scope (WS-4.2, RU-26)', () => {
    const SCOPE = {
      callable: 'cancelAppointment',
      operationId: 'op-00000000000001',
      uid: 'u-staff',
      roles: ['barber'],
    } as const;

    it('is the log-context bundle', () => {
      const ports: LogContextPorts = consoleLogContext();
      expect(Object.keys(ports).sort()).toEqual([
        'addLogContext',
        'bindLogContext',
      ]);
    });

    it('rides under every line written inside it — the call’s own fields win a name both hold', async () => {
      const { sink, calls } = recordingSink();
      const { log } = consoleTelemetry(sink);
      const answer = await consoleLogContext().bindLogContext(
        SCOPE,
        async () => {
          log('warn', 'booking.rejected', {
            errorCode: BookingErrorCode.SlotUnavailable,
            callable: 'own',
          });
          log('info', 'bare line');
          return 'answered';
        },
      );
      expect(answer).toBe('answered');
      expect(calls).toEqual([
        {
          level: 'warn',
          args: [
            'booking.rejected',
            {
              ...SCOPE,
              errorCode: BookingErrorCode.SlotUnavailable,
              callable: 'own',
            },
          ],
        },
        { level: 'info', args: ['bare line', { ...SCOPE }] },
      ]);
    });

    it('adds a field learned later to the current scope only — and nothing outside one', async () => {
      const { sink, calls } = recordingSink();
      const { log } = consoleTelemetry(sink);
      const context = consoleLogContext();
      context.addLogContext({ inputDigest: 'outside' });
      log('info', 'before');
      await context.bindLogContext(SCOPE, async () => {
        context.addLogContext({ inputDigest: '0123456789abcdef' });
        log('info', 'inside');
      });
      log('info', 'after');
      expect(calls).toEqual([
        { level: 'info', args: ['before'] },
        {
          level: 'info',
          args: ['inside', { ...SCOPE, inputDigest: '0123456789abcdef' }],
        },
        { level: 'info', args: ['after'] },
      ]);
    });

    it('never bleeds between two interleaved invocations', async () => {
      const { sink, calls } = recordingSink();
      const { log } = consoleTelemetry(sink);
      const context = consoleLogContext();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = context.bindLogContext({ uid: 'u-1' }, async () => {
        await gate;
        log('info', 'first');
      });
      const second = context.bindLogContext({ uid: 'u-2' }, async () => {
        context.addLogContext({ inputDigest: 'second-only' });
        log('info', 'second');
        release();
      });
      await Promise.all([first, second]);
      expect(calls).toEqual([
        {
          level: 'info',
          args: ['second', { uid: 'u-2', inputDigest: 'second-only' }],
        },
        { level: 'info', args: ['first', { uid: 'u-1' }] },
      ]);
    });

    it('rides under trackError’s context too', async () => {
      const { sink, calls } = recordingSink();
      const { trackError } = consoleTelemetry(sink);
      const boom = new Error('store unreachable');
      await consoleLogContext().bindLogContext(SCOPE, async () => {
        trackError(boom, { callable: 'commitBooking' });
      });
      expect(calls).toEqual([
        {
          level: 'error',
          args: [boom, { ...SCOPE, callable: 'commitBooking' }],
        },
      ]);
    });

    it('never reaches a web client’s error line — the sink is untraced (RU-24)', async () => {
      const { sink, calls } = recordingSink();
      const fields = {
        '@type': ClientIssueSystem.REPORTED_ERROR_EVENT,
        clientIssueKind: 'UNCAUGHT_ERROR',
      };
      await consoleLogContext().bindLogContext(SCOPE, async () => {
        consoleTelemetry(sink).log('error', 'TypeError: x', fields);
      });
      expect(calls).toEqual([
        {
          level: 'write',
          args: [{ ...fields, severity: 'ERROR', message: 'TypeError: x' }],
        },
      ]);
    });
  });

  describe('an Error in the fields (WS-4.6, RU-38)', () => {
    const PHONE = '+359888123456';
    const EMAIL = 'a@b.bg';

    it('is written as { name, code, message, stack } — never `{}`', () => {
      const { sink, calls } = recordingSink();
      const cause = Object.assign(new Error('deadline'), { code: 4 });
      consoleTelemetry(sink).log('error', 'audit write failed', {
        error: cause,
        path: 'auditLog/r-1',
      });
      const payload = calls[0]?.args[1] as {
        readonly error: Record<string, unknown>;
        readonly path: string;
      };
      expect(payload.path).toBe('auditLog/r-1');
      expect(payload.error).toMatchObject({
        name: 'Error',
        code: 4,
        message: 'deadline',
      });
      const stack = String(payload.error['stack']).split('\n');
      expect(stack[0]).toBe('Error: deadline');
      expect(stack.length).toBeGreaterThan(1);
      for (const line of stack.slice(1)) expect(line).toMatch(/^ {4}at \S/);
    });

    it('scrubs a provider’s message and its stack head — neither a phone nor an e-mail reaches any sink argument', async () => {
      const { sink, calls } = recordingSink();
      const leaky = Object.assign(
        new Error(`no route to ${PHONE} for ${EMAIL} (retry later)`),
        { code: `bad-${EMAIL}` },
      );
      const telemetry = consoleTelemetry(sink);
      await consoleLogContext().bindLogContext({ uid: 'u-1' }, async () => {
        telemetry.log('error', 'otp.send_failed', { error: leaky });
        telemetry.trackError('non-error', { cause: leaky });
      });
      telemetry.log('warn', 'otp.send_failed', { error: leaky });
      expect(calls).toHaveLength(3);
      const written = JSON.stringify(calls.map((call) => call.args));
      expect(written).not.toContain(PHONE);
      expect(written).not.toContain(PHONE.slice(1));
      expect(written).not.toContain(EMAIL);
      const payload = calls[0]?.args[1] as {
        readonly error: { readonly message: string; readonly stack: string };
      };
      expect(payload.error.message).toBe(
        ClientIssueSystem.scrub(leaky.message),
      );
      expect(payload.error.stack.split('\n')[0]).toBe(
        `Error: ${ClientIssueSystem.scrub(leaky.message)}`,
      );
    });

    it('leaves a non-Error value as it is', () => {
      const { sink, calls } = recordingSink();
      consoleTelemetry(sink).log('info', 'x', { error: 'text', n: 1 });
      expect(calls[0]?.args[1]).toEqual({ error: 'text', n: 1 });
    });
  });

  it('writes through firebase-functions/logger by default', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const telemetry = consoleTelemetry();
    telemetry.log('info', 'root.ready', { exports: 29 });
    telemetry.trackError(new Error('boom'));
    expect(info).toHaveBeenCalledWith('root.ready', { exports: 29 });
    expect(error).toHaveBeenCalledWith(expect.any(Error), {});
  });
});
