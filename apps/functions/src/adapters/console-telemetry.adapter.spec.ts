import { logger } from 'firebase-functions';
import { BookingErrorCode } from '@core/errors';
import type { TelemetryPorts } from '@core/ports';
import { type LogSink, consoleTelemetry } from './console-telemetry.adapter';

type Call = {
  readonly level: 'info' | 'warn' | 'error';
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
