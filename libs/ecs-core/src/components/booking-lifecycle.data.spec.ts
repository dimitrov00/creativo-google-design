import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { unwrapOk } from '../testing';
import { BookingLifecycle, BookingStatus } from './booking-lifecycle.data';
import { CancellationReasonSet } from './seat-outcome.data';

// The cases of `booking-status.data.spec.ts`, on the flat lifecycle slice.

const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const PENDING = BookingLifecycle.pending(at(1));
const CONFIRMED = BookingLifecycle.confirm(at(2));
const COMPLETED = BookingLifecycle.complete(at(3));
const NO_SHOW = BookingLifecycle.noShow(at(4));
const CANCELLED = BookingLifecycle.cancel(
  at(5),
  CancellationReasonSet.of(['CLIENT_UNWELL']),
);

describe('BookingLifecycle factories', () => {
  it('stamp the instant each state was entered, under its own prefix', () => {
    expect(PENDING).toEqual({ bookingStatus: 'PENDING', pendingAtUtcMs: 1 });
    expect(CONFIRMED).toEqual({
      bookingStatus: 'CONFIRMED',
      confirmedAtUtcMs: 2,
    });
    expect(COMPLETED).toEqual({
      bookingStatus: 'COMPLETED',
      completedAtUtcMs: 3,
    });
    expect(NO_SHOW).toEqual({ bookingStatus: 'NO_SHOW', noShowAtUtcMs: 4 });
  });

  it('a cancellation structurally carries its reasons', () => {
    expect(CANCELLED).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: 5,
      cancellationReason: 'CLIENT_UNWELL',
    });
  });

  it('enteredAtUtcMs reads each variant’s entering stamp', () => {
    expect(
      [PENDING, CONFIRMED, COMPLETED, NO_SHOW, CANCELLED].map(
        BookingLifecycle.enteredAtUtcMs,
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('sliceOf copies exactly the variant’s fields out of a whole appointment', () => {
    for (const lifecycle of [
      PENDING,
      CONFIRMED,
      COMPLETED,
      NO_SHOW,
      CANCELLED,
    ]) {
      const appointment = { ...lifecycle, revision: 3, seats: [] };
      expect(BookingLifecycle.sliceOf(appointment)).toEqual(lifecycle);
    }
  });
});

describe('BookingLifecycle.isTerminal', () => {
  it('pending and confirmed are non-terminal', () => {
    expect(BookingLifecycle.isTerminal(PENDING)).toBe(false);
    expect(BookingLifecycle.isTerminal(CONFIRMED)).toBe(false);
  });

  it('completed and cancelled are terminal', () => {
    expect(BookingLifecycle.isTerminal(COMPLETED)).toBe(true);
    expect(BookingLifecycle.isTerminal(CANCELLED)).toBe(true);
  });

  it('no_show is NOT terminal — it carries the correction edge', () => {
    expect(BookingLifecycle.isTerminal(NO_SHOW)).toBe(false);
  });
});

describe('BookingLifecycle.isSettled / isLive', () => {
  it('separates "the visit is over" from "the graph has nowhere to go"', () => {
    expect(BookingLifecycle.isSettled(COMPLETED)).toBe(true);
    expect(BookingLifecycle.isSettled(CANCELLED)).toBe(true);
    expect(BookingLifecycle.isSettled(NO_SHOW)).toBe(true);
    expect(BookingLifecycle.isSettled(PENDING)).toBe(false);
    expect(BookingLifecycle.isSettled(CONFIRMED)).toBe(false);
  });

  it('a live status still holds its slot', () => {
    expect(BookingLifecycle.isLive(PENDING)).toBe(true);
    expect(BookingLifecycle.isLive(CONFIRMED)).toBe(true);
    expect(BookingLifecycle.isLive(NO_SHOW)).toBe(false);
  });
});

describe('BookingLifecycle.canTransition — the full lifecycle matrix', () => {
  it('pending can move to confirmed or cancelled only', () => {
    expect(
      BookingLifecycle.canTransition(PENDING, BookingStatus.Confirmed),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(PENDING, BookingStatus.Cancelled),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(PENDING, BookingStatus.Completed),
    ).toBe(false);
    expect(BookingLifecycle.canTransition(PENDING, BookingStatus.NoShow)).toBe(
      false,
    );
  });

  it('confirmed can move to completed, cancelled or no_show', () => {
    expect(
      BookingLifecycle.canTransition(CONFIRMED, BookingStatus.Completed),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(CONFIRMED, BookingStatus.Cancelled),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(CONFIRMED, BookingStatus.NoShow),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(CONFIRMED, BookingStatus.Confirmed),
    ).toBe(false);
  });

  it('terminal states have no legal outgoing transitions', () => {
    for (const lifecycle of [COMPLETED, CANCELLED]) {
      for (const to of Object.values(BookingStatus)) {
        expect(BookingLifecycle.canTransition(lifecycle, to)).toBe(false);
      }
    }
  });

  it('no_show can move back to confirmed, and nowhere else', () => {
    expect(
      BookingLifecycle.canTransition(NO_SHOW, BookingStatus.Confirmed),
    ).toBe(true);
    expect(
      BookingLifecycle.canTransition(NO_SHOW, BookingStatus.Completed),
    ).toBe(false);
    expect(
      BookingLifecycle.canTransition(NO_SHOW, BookingStatus.Cancelled),
    ).toBe(false);
    expect(BookingLifecycle.canTransition(NO_SHOW, BookingStatus.NoShow)).toBe(
      false,
    );
  });
});
