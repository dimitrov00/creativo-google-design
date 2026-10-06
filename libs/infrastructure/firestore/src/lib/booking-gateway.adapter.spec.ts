import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  CommitBookingRequest,
  RescheduleBookingRequest,
  StaffEditAppointmentRequest,
} from '@creativo/application/booking';
import { FIREBASE_FUNCTIONS } from '@creativo/infrastructure/firebase-app';
import { CallableBookingGateway } from './booking-gateway.adapter';

const callableMock = vi.fn();

vi.mock('firebase/functions', async () => {
  const actual =
    await vi.importActual<typeof import('firebase/functions')>(
      'firebase/functions',
    );
  return {
    ...actual,
    httpsCallable: vi.fn(() => callableMock),
  };
});

function createGateway(): CallableBookingGateway {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FUNCTIONS, useValue: {} },
      CallableBookingGateway,
    ],
  });
  return TestBed.inject(CallableBookingGateway);
}

/** One seat for the booker — the shape `BookingFlowStore.commit` sends. */
const COLD: CommitBookingRequest = {
  locationId: 'loc-center',
  seats: [
    {
      lineId: 'line-1',
      serviceId: 'svc-fade',
      variantId: null,
      barberId: 'ivan',
      barberPref: 'specific',
      startIso: '2026-10-06T10:00:00.000+03:00',
      subject: { kind: 'self' },
    },
  ],
  attemptId: 'attempt-0123456789abcdef',
};

describe('CallableBookingGateway.commit', () => {
  beforeEach(() => {
    callableMock.mockReset();
    TestBed.resetTestingModule();
  });

  // Defect §2.3 #6: the server has always accepted the rebooking edge; what
  // must hold here is that nothing between the store and the callable drops it.
  it('forwards the rebooking edge to commitBooking', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });
    const { httpsCallable } = await import('firebase/functions');
    const request: CommitBookingRequest = {
      ...COLD,
      bookedFromAppointmentId: 'appt-source',
    };

    const result = await createGateway().commit(request);

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'commitBooking',
    );
    expect(callableMock).toHaveBeenCalledTimes(1);
    expect(callableMock.mock.calls[0]?.[0]).toMatchObject({
      bookedFromAppointmentId: 'appt-source',
    });
    expect(result.isSuccess() && result.value.appointmentId).toBe('appt-new');
  });

  it('carries the edge beside a staff placement', async () => {
    // The staff «Запиши пак» books on behalf of the client; the owner and the
    // source visit travel together.
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });

    await createGateway().commit({
      ...COLD,
      onBehalfOfUserId: 'client-1',
      bookedFromAppointmentId: 'appt-source',
    });

    expect(callableMock.mock.calls[0]?.[0]).toMatchObject({
      onBehalfOfUserId: 'client-1',
      bookedFromAppointmentId: 'appt-source',
    });
  });

  it('adds no edge to a cold booking', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-new' } });

    await createGateway().commit(COLD);

    const sent = callableMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('bookedFromAppointmentId' in sent).toBe(false);
  });

  it('reports a response without an id as unknown, never as a booking', async () => {
    callableMock.mockResolvedValueOnce({ data: {} });

    const result = await createGateway().commit(COLD);

    expect(result.isFailure() && result.error.failure).toBe('unknown');
  });

  it('reads a lost race as slot_unavailable, keeping the server code', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('taken'), {
        details: { code: 'booking.commit.slot_unavailable', params: {} },
      }),
    );

    const result = await createGateway().commit(COLD);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.isSlotTaken()).toBe(true);
      expect(result.error.params['serverCode']).toBe(
        'booking.commit.slot_unavailable',
      );
    }
  });
});

describe('CallableBookingGateway.reschedule', () => {
  beforeEach(() => {
    callableMock.mockReset();
    TestBed.resetTestingModule();
  });

  const MOVE: RescheduleBookingRequest = {
    appointmentId: 'appt-1',
    locationId: 'loc-center',
    seats: COLD.seats,
    attemptId: 'attempt-0123456789abcdef',
  };

  it('sends the move under its attempt id, so a retry can fill its audit rows', async () => {
    callableMock.mockResolvedValueOnce({ data: { appointmentId: 'appt-1' } });
    const { httpsCallable } = await import('firebase/functions');

    const result = await createGateway().reschedule(MOVE);

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'rescheduleAppointment',
    );
    expect(callableMock.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: 'appt-1',
      attemptId: 'attempt-0123456789abcdef',
    });
    expect(result.isSuccess() && result.value.appointmentId).toBe('appt-1');
  });

  /** The server's refusal of a move whose carried seat cannot come along. */
  function carriedRefusal(refusal: string): Error {
    return Object.assign(new Error('carried'), {
      details: {
        code: 'booking.reschedule.carried_seat_unplaceable',
        params: { refusal, seatIds: 'seat-2' },
      },
    });
  }

  it('reads a carried seat whose barber got taken as a LOST SLOT — back to a fresh grid', async () => {
    // The grid only offers starts where the companion's chair is free, so a
    // busy chair at confirm means somebody took it in between: the same race
    // as the client's own slot going, answered the same way.
    callableMock.mockRejectedValueOnce(carriedRefusal('barber_unavailable'));

    const result = await createGateway().reschedule(MOVE);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.failure).toBe('slot_unavailable');
      expect(result.error.isSlotTaken()).toBe(true);
      expect(result.error.params).toEqual({
        refusal: 'barber_unavailable',
        seatIds: 'seat-2',
        serverCode: 'booking.reschedule.carried_seat_unplaceable',
      });
    }
  });

  it('keeps every OTHER carried-seat refusal a request refusal on review — a fresh grid cannot fix it', async () => {
    for (const refusal of [
      'service_unavailable',
      'outside_booking_window',
      'party_conflict',
      'shop_only',
    ]) {
      callableMock.mockRejectedValueOnce(carriedRefusal(refusal));

      const result = await createGateway().reschedule(MOVE);
      TestBed.resetTestingModule();

      expect(result.isFailure()).toBe(true);
      if (result.isFailure()) {
        expect(result.error.failure).toBe('invalid_request');
        expect(result.error.isSlotTaken()).toBe(false);
        expect(result.error.params['refusal']).toBe(refusal);
      }
    }
  });

  it('does not read a `refusal` riding on some other code as a lost slot', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('other'), {
        details: {
          code: 'booking.commit.invalid_input',
          params: { refusal: 'barber_unavailable' },
        },
      }),
    );

    const result = await createGateway().reschedule(MOVE);

    expect(result.isFailure() && result.error.failure).toBe('invalid_request');
  });
});

describe('CallableBookingGateway.cancel', () => {
  beforeEach(() => {
    callableMock.mockReset();
    TestBed.resetTestingModule();
  });

  it('reads unreadable cancellation terms as UNAVAILABLE — the same tap a moment later is the fix', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('unavailable'), {
        code: 'functions/unavailable',
        details: { code: 'booking.cancel.policy_unavailable' },
      }),
    );

    const result = await createGateway().cancel({
      appointmentId: 'appt-1',
      reason: '',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.failure).toBe('unavailable');
      // …keeping the server's code, which the page words it by.
      expect(result.error.params['serverCode']).toBe(
        'booking.cancel.policy_unavailable',
      );
    }
  });

  it('keeps a closed window a request refusal — waiting does not reopen it', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('closed'), {
        details: {
          code: 'booking.cancel.window_closed',
          params: { windowHours: '24' },
        },
      }),
    );

    const result = await createGateway().cancel({
      appointmentId: 'appt-1',
      reason: '',
    });

    expect(result.isFailure() && result.error.failure).toBe('invalid_request');
  });
});

describe('CallableBookingGateway.staffEdit', () => {
  beforeEach(() => {
    callableMock.mockReset();
    TestBed.resetTestingModule();
  });

  it('sends the intent under its operation id and hands back the revision', async () => {
    callableMock.mockResolvedValueOnce({
      data: { appointmentId: 'appt-1', revision: 5 },
    });
    const request: StaffEditAppointmentRequest = {
      appointmentId: 'appt-1',
      command: { kind: 'move', startIso: '2026-10-06T11:00:00.000+03:00' },
      operationId: 'operation-0123456789abcdef',
    };

    const result = await createGateway().staffEdit(request);

    expect(callableMock.mock.calls[0]?.[0]).toMatchObject({
      operationId: 'operation-0123456789abcdef',
    });
    expect(result.isSuccess() && result.value).toEqual({
      appointmentId: 'appt-1',
      revision: 5,
    });
  });

  // Round 5: the sheet claims the revision its draft was drawn from; the
  // stale refusal must come back telling the sheet what to reload to.
  it('sends the claim on the wire and hands back a stale refusal the sheet can act on', async () => {
    callableMock.mockRejectedValueOnce(
      Object.assign(new Error('moved on'), {
        details: {
          code: 'booking.staffEdit.stale',
          params: { expected: '3', actual: '4' },
        },
      }),
    );

    const result = await createGateway().staffEdit({
      appointmentId: 'appt-1',
      command: { kind: 'move', startIso: '2026-10-06T11:00:00.000+03:00' },
      expectedVersion: 3,
      operationId: 'operation-0123456789abcdef',
    });

    expect(callableMock.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 3,
    });
    expect(result.isFailure() && result.error.failure).toBe('invalid_request');
    expect(result.isFailure() && result.error.params).toEqual({
      expected: '3',
      actual: '4',
      serverCode: 'booking.staffEdit.stale',
    });
  });
});
