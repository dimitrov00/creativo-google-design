import { describe, expect, it } from 'vitest';
import { endMinute, localDate, minute } from '@core/testing';
import { BarberId } from '@core/primitives';
import { StaffEditError, StaffEditErrorCode } from './staff-edit.error';

/*
 * The staff edit's dictionary, moved from `appointment-edit.system.ts`
 * (with `StaffEditOverlaps` from `edit-appointment.pipeline.ts`; Law 7.5,
 * Phase 4a 4A-6): values unchanged, every context field a scalar or a brand
 * — `beforeArrival` takes the arrival's day and minute, `overlaps` the
 * resize handle as its plain string.
 */
describe('StaffEditError', () => {
  it('keeps the seven codes verbatim', () => {
    expect(Object.values(StaffEditErrorCode).sort()).toEqual([
      'BOOKING_STAFF_EDIT_BEFORE_ARRIVAL',
      'BOOKING_STAFF_EDIT_FORBIDDEN',
      'BOOKING_STAFF_EDIT_INVALID_COMMAND',
      'BOOKING_STAFF_EDIT_INVARIANT_VIOLATED',
      'BOOKING_STAFF_EDIT_OVERLAPS',
      'BOOKING_STAFF_EDIT_STALE',
      'BOOKING_STAFF_EDIT_UNAUTHENTICATED',
    ]);
  });

  it('builds flat structs of scalars', () => {
    expect(StaffEditError.invalidCommand('startMinutes')).toEqual({
      errorCode: 'BOOKING_STAFF_EDIT_INVALID_COMMAND',
      field: 'startMinutes',
    });
    expect(StaffEditError.forbidden()).toEqual({
      errorCode: 'BOOKING_STAFF_EDIT_FORBIDDEN',
    });
    expect(StaffEditError.stale(3, 4)).toEqual({
      errorCode: 'BOOKING_STAFF_EDIT_STALE',
      expected: 3,
      actual: 4,
    });
    expect(
      StaffEditError.beforeArrival(
        localDate('2026-10-07'),
        endMinute(720),
        localDate('2026-10-07'),
        minute(780),
      ),
    ).toEqual({
      errorCode: 'BOOKING_STAFF_EDIT_BEFORE_ARRIVAL',
      localDate: '2026-10-07',
      finishMinutes: 720,
      arrivalLocalDate: '2026-10-07',
      arrivalMinutes: 780,
    });
    expect(
      StaffEditError.overlaps(
        BarberId.of('b-ivan'),
        localDate('2026-10-07'),
        minute(600),
        'END',
      ),
    ).toEqual({
      errorCode: 'BOOKING_STAFF_EDIT_OVERLAPS',
      barberId: 'b-ivan',
      localDate: '2026-10-07',
      startMinutes: 600,
      resizeEdge: 'END',
    });
  });
});
