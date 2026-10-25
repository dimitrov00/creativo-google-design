import { describe, expect, it } from 'vitest';
import { UtcEpochMs, BookingStatus } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { BookingLifecycle } from './booking-lifecycle.data';
import { CancellationReasonSet } from './cancellation-reason-set.data';

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

  it('reads the status alone — a bare `{ bookingStatus }` passes as the whole slice does (widened)', () => {
    for (const bookingStatus of Object.values(BookingStatus)) {
      const bare = { bookingStatus };
      const whole = [PENDING, CONFIRMED, COMPLETED, NO_SHOW, CANCELLED].find(
        (lifecycle) => lifecycle.bookingStatus === bookingStatus,
      ) as BookingLifecycle;
      expect(BookingLifecycle.isSettled(bare)).toBe(
        BookingLifecycle.isSettled(whole),
      );
      expect(BookingLifecycle.isLive(bare)).toBe(
        BookingLifecycle.isLive(whole),
      );
    }
  });
});

describe('BookingLifecycle.LIVE_STATUSES', () => {
  it('is PENDING then CONFIRMED — the live-occupancy filter, in index order', () => {
    expect(BookingLifecycle.LIVE_STATUSES).toEqual(['PENDING', 'CONFIRMED']);
  });

  it('holds exactly the statuses isLive answers true for', () => {
    for (const bookingStatus of Object.values(BookingStatus)) {
      expect(BookingLifecycle.LIVE_STATUSES.includes(bookingStatus)).toBe(
        BookingLifecycle.isLive({ bookingStatus }),
      );
    }
  });
});

describe('BookingLifecycle.didNotHappen', () => {
  // `staff-event-head.spec.ts`'s `hollowStatus` truth table, on the slice.
  it('is true for a cancellation and a no-show, false for the rest', () => {
    expect(
      BookingLifecycle.didNotHappen({ bookingStatus: BookingStatus.Cancelled }),
    ).toBe(true);
    expect(
      BookingLifecycle.didNotHappen({ bookingStatus: BookingStatus.NoShow }),
    ).toBe(true);
    expect(
      BookingLifecycle.didNotHappen({ bookingStatus: BookingStatus.Completed }),
    ).toBe(false);
    expect(
      BookingLifecycle.didNotHappen({ bookingStatus: BookingStatus.Confirmed }),
    ).toBe(false);
    expect(
      BookingLifecycle.didNotHappen({ bookingStatus: BookingStatus.Pending }),
    ).toBe(false);
  });

  it('a whole lifecycle passes straight in', () => {
    expect(BookingLifecycle.didNotHappen(CANCELLED)).toBe(true);
    expect(BookingLifecycle.didNotHappen(NO_SHOW)).toBe(true);
    expect(BookingLifecycle.didNotHappen(COMPLETED)).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const slice = deepFreeze({ ...NO_SHOW });
    const once = BookingLifecycle.didNotHappen(slice);
    const twice = BookingLifecycle.didNotHappen(slice);
    expect(twice).toBe(once);
    expect(slice).toEqual(NO_SHOW);
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

describe('BookingLifecycle.isTransitionTarget — the edge guard of a move’s target', () => {
  it('accepts every status some legal move lands on', () => {
    for (const to of [
      BookingStatus.Confirmed,
      BookingStatus.Cancelled,
      BookingStatus.Completed,
      BookingStatus.NoShow,
    ]) {
      expect(BookingLifecycle.isTransitionTarget(to)).toBe(true);
    }
  });

  it('refuses PENDING — a first state, never a destination', () => {
    expect(BookingLifecycle.isTransitionTarget(BookingStatus.Pending)).toBe(
      false,
    );
  });

  it('refuses foreign strings and non-strings', () => {
    expect(BookingLifecycle.isTransitionTarget('cancelled')).toBe(false);
    expect(BookingLifecycle.isTransitionTarget('')).toBe(false);
    expect(BookingLifecycle.isTransitionTarget(null)).toBe(false);
    expect(BookingLifecycle.isTransitionTarget(undefined)).toBe(false);
    expect(BookingLifecycle.isTransitionTarget(3)).toBe(false);
    expect(
      BookingLifecycle.isTransitionTarget({ bookingStatus: 'CONFIRMED' }),
    ).toBe(false);
  });

  it('is exactly the statuses canTransition can reach from some state', () => {
    const lifecycles = [PENDING, CONFIRMED, COMPLETED, NO_SHOW, CANCELLED];
    for (const to of Object.values(BookingStatus)) {
      const reachable = lifecycles.some((from) =>
        BookingLifecycle.canTransition(from, to),
      );
      expect(BookingLifecycle.isTransitionTarget(to)).toBe(reachable);
    }
  });

  it('is pure: same input → same output, input untouched', () => {
    const input = deepFreeze({ raw: BookingStatus.NoShow });
    const first = BookingLifecycle.isTransitionTarget(input.raw);
    expect(BookingLifecycle.isTransitionTarget(input.raw)).toBe(first);
    expect(input).toEqual({ raw: BookingStatus.NoShow });
  });
});
