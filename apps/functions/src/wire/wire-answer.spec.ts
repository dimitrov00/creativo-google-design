import { describe, expect, it } from 'vitest';
import { AppointmentId, BookingStatus, SeatId } from '@core/primitives';
import type { BookingCall } from '@core/components';
import { type CallableName, Callables } from '@core/ports';
import type { BookAppointmentAnswer } from '@core/pipelines';
import { arrivedOf, committedOf } from './booking.wire';
import type { AnswerIsTheWire, SameShape, WireAnswer } from './wire-answer';

/*
 * `AnswerIsTheWire` is a compile-time rule: `wiredCallable` (main.ts) takes
 * it into its spec's type, so a handler whose answer is not exactly its
 * callable's wire answer does not compile. The probe below has
 * the same shape; each `@ts-expect-error` is a case the compiler must
 * refuse (the spec's typecheck fails if it ever accepts one).
 */

/** The `wiredCallable` signature's answer half, alone. */
const wired = <N extends CallableName, A extends WireAnswer<N>>(
  spec: { readonly callable: N } & AnswerIsTheWire<A, N>,
  answer: A,
): readonly unknown[] => [spec.callable, answer];
const spec = <N extends CallableName>(callable: N) => ({ callable });

const A1 = AppointmentId.of('a1');

// Typed as the pipelines and call components declare them — as a handler's
// answer reaches `wiredCallable`.
const cancelled: BookingCall.Cancelled = { appointmentId: A1 };
const transitioned: BookingCall.Transitioned = {
  appointmentId: A1,
  toBookingStatus: BookingStatus.Completed,
};
const tipRecorded: BookingCall.TipRecorded = {
  appointmentId: A1,
  seatId: SeatId.of('s1'),
  unchanged: false,
};
const booked: BookAppointmentAnswer = { appointmentId: A1, replayed: true };
const arrived: BookingCall.Arrived = arrivedOf({
  appointmentId: A1,
  unchanged: false,
});

describe('AnswerIsTheWire — a pipeline answers its callable’s wire answer as it is', () => {
  it('accepts an answer of exactly the wire’s shape, and a named projection onto it', () => {
    expect(wired(spec(Callables.CancelAppointment), cancelled)).toHaveLength(2);
    expect(
      wired(spec(Callables.TransitionAppointment), transitioned),
    ).toHaveLength(2);
    expect(wired(spec(Callables.RecordSeatTip), tipRecorded)).toHaveLength(2);
    expect(
      wired(spec(Callables.CommitBooking), committedOf(booked)),
    ).toHaveLength(2);
    expect(wired(spec(Callables.MarkArrived), arrived)).toHaveLength(2);
  });

  it('refuses a leaking answer, another callable’s answer and a missing field', () => {
    // Never run: each line is a call the compiler must refuse.
    const refused = (): readonly unknown[] => [
      // @ts-expect-error — `replayed` stays on the server: no field of `BookingCall.Committed`
      wired(spec(Callables.CommitBooking), booked),
      // @ts-expect-error — the arrival's answer is not the transition's
      wired(spec(Callables.TransitionAppointment), arrived),
      // @ts-expect-error — `seatId` and `unchanged` are missing
      wired(spec(Callables.RecordSeatTip), cancelled),
    ];
    expect(typeof refused).toBe('function');
  });

  it('is mutual assignability — no field more, none less', () => {
    const same: SameShape<{ a: 1 }, { readonly a: 1 }> = true;
    const wider: SameShape<{ a: 1; b: 2 }, { a: 1 }> = false;
    const narrower: SameShape<{ a: 1 }, { a: 1; b: 2 }> = false;
    expect([same, wider, narrower]).toEqual([true, false, false]);
  });
});
