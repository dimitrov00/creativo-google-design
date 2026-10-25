import { describe, expect, it } from 'vitest';
import type { ErrorHandler } from '@angular/core';
import {
  DATA_LOG_ERROR,
  errorHandlerLogPorts,
} from './error-handler-log.adapter';

/** An `ErrorHandler` that records what it was handed. */
function recordingHandler() {
  const handled: unknown[] = [];
  const handler = {
    handleError: (error: unknown) => {
      handled.push(error);
    },
  } as ErrorHandler;
  return { handler, handled };
}

describe('errorHandlerLogPorts — the web data layer’s log over Angular’s ErrorHandler', () => {
  it('reports ONE plain Error per log line, named DataLog, the message and the fields as its cause', () => {
    const { handler, handled } = recordingHandler();
    const ports = errorHandlerLogPorts(handler);

    ports.log('error', 'malformed document dropped', {
      path: 'appointments/a1',
      field: 'seats[0].startMinutes',
    });

    expect(handled).toHaveLength(1);
    const [error] = handled as Error[];
    expect(error).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect(error?.name).toBe(DATA_LOG_ERROR);
    expect(DATA_LOG_ERROR).toBe('DataLog');
    expect(error?.message).toBe('malformed document dropped');
    expect(error?.cause).toEqual({
      path: 'appointments/a1',
      field: 'seats[0].startMinutes',
    });
  });

  it('copies the fields — a later change to the caller’s record does not reach the report', () => {
    const { handler, handled } = recordingHandler();
    const fields: Record<string, unknown> = { path: 'barberBusy/k' };
    errorHandlerLogPorts(handler).log(
      'error',
      'malformed document refused',
      fields,
    );
    fields['path'] = 'changed';
    expect((handled[0] as Error).cause).toEqual({ path: 'barberBusy/k' });
  });

  it('reports a line without fields with an empty cause, and every call separately', () => {
    const { handler, handled } = recordingHandler();
    const ports = errorHandlerLogPorts(handler);
    ports.log('warn', 'one');
    ports.log('info', 'two');
    expect((handled as Error[]).map((error) => error.message)).toEqual([
      'one',
      'two',
    ]);
    expect((handled[0] as Error).cause).toEqual({});
  });

  it('never throws — not even when the handler does', () => {
    const throwing = {
      handleError: () => {
        throw new Error('handler down');
      },
    } as unknown as ErrorHandler;
    expect(() =>
      errorHandlerLogPorts(throwing).log(
        'error',
        'malformed document refused',
        {
          path: 'customers/c1',
          field: 'userId',
        },
      ),
    ).not.toThrow();
  });
});
