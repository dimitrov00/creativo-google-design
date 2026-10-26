import { describe, expect, it } from 'vitest';
import {
  CALLABLE_ANSWER_DECODERS,
  Callables,
  OPERATION_ID_FIELD,
} from './callables';

/** The table's rows, as `[callable, field]` pairs in declaration order. */
const ROWS = Object.entries(OPERATION_ID_FIELD);

describe('OPERATION_ID_FIELD — where each callable carries its operation id (WS-4.1)', () => {
  it('is total over the registry: one row per callable, no other key', () => {
    const names = ROWS.map(([name]) => name).sort();
    expect(names).toEqual(Object.values(Callables).sort());
    expect(names).toEqual(Object.keys(CALLABLE_ANSWER_DECODERS).sort());
  });

  it('pins every row that is not `operationId`: three other fields and the sink’s none', () => {
    expect(ROWS.filter(([, field]) => field !== 'operationId')).toEqual([
      [Callables.CommitBooking, 'attemptId'],
      [Callables.RescheduleAppointment, 'attemptId'],
      [Callables.PublishStreakDefinition, 'requestId'],
      [Callables.ReportClientIssues, null],
    ]);
  });

  it('every mutating booking act rides `operationId` — the staff edit’s spelling (RU-20)', () => {
    expect(OPERATION_ID_FIELD).toMatchObject({
      [Callables.CancelAppointment]: 'operationId',
      [Callables.TransitionAppointment]: 'operationId',
      [Callables.MarkArrived]: 'operationId',
      [Callables.ClearArrival]: 'operationId',
      [Callables.RecordSeatTip]: 'operationId',
      [Callables.StaffEditAppointment]: 'operationId',
    });
  });

  it('the client issue sink alone carries none (OR-34)', () => {
    expect(ROWS.filter(([, field]) => field === null)).toEqual([
      [Callables.ReportClientIssues, null],
    ]);
  });
});
