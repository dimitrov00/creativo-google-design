import { describe, expect, it } from 'vitest';
import { BookingState, BookingStatus } from './booking-status.data';

const PENDING = BookingStatus.pending(1);
const CONFIRMED = BookingStatus.confirm(2);
const COMPLETED = BookingStatus.complete(3);
const NO_SHOW = BookingStatus.noShow(4);
const CANCELLED = BookingStatus.cancel(5, 'client_unwell');

describe('BookingStatus factories', () => {
  it('stamp the instant each state was entered', () => {
    expect(PENDING).toEqual({ kind: 'pending', atMs: 1 });
    expect(CONFIRMED).toEqual({ kind: 'confirmed', atMs: 2 });
    expect(COMPLETED).toEqual({ kind: 'completed', atMs: 3 });
    expect(NO_SHOW).toEqual({ kind: 'no_show', atMs: 4 });
  });

  it('a cancellation structurally carries its reason', () => {
    expect(CANCELLED).toEqual({
      kind: 'cancelled',
      atMs: 5,
      reason: 'client_unwell',
    });
  });
});

describe('BookingStatus.isTerminal', () => {
  it('pending and confirmed are non-terminal', () => {
    expect(BookingStatus.isTerminal(PENDING)).toBe(false);
    expect(BookingStatus.isTerminal(CONFIRMED)).toBe(false);
  });

  it('completed and cancelled are terminal', () => {
    expect(BookingStatus.isTerminal(COMPLETED)).toBe(true);
    expect(BookingStatus.isTerminal(CANCELLED)).toBe(true);
  });

  it('no_show is NOT terminal — it carries the correction edge', () => {
    expect(BookingStatus.isTerminal(NO_SHOW)).toBe(false);
  });
});

describe('BookingStatus.isSettled / isLive', () => {
  it('separates "the visit is over" from "the graph has nowhere to go"', () => {
    expect(BookingStatus.isSettled(COMPLETED)).toBe(true);
    expect(BookingStatus.isSettled(CANCELLED)).toBe(true);
    expect(BookingStatus.isSettled(NO_SHOW)).toBe(true);
    expect(BookingStatus.isSettled(PENDING)).toBe(false);
    expect(BookingStatus.isSettled(CONFIRMED)).toBe(false);
  });

  it('a live status still holds its slot', () => {
    expect(BookingStatus.isLive(PENDING)).toBe(true);
    expect(BookingStatus.isLive(CONFIRMED)).toBe(true);
    expect(BookingStatus.isLive(NO_SHOW)).toBe(false);
  });
});

describe('BookingStatus.canTransition — the full lifecycle matrix', () => {
  it('pending can move to confirmed or cancelled only', () => {
    expect(BookingStatus.canTransition(PENDING, BookingState.Confirmed)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(PENDING, BookingState.Cancelled)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(PENDING, BookingState.Completed)).toBe(
      false,
    );
    expect(BookingStatus.canTransition(PENDING, BookingState.NoShow)).toBe(
      false,
    );
  });

  it('confirmed can move to completed, cancelled or no_show', () => {
    expect(BookingStatus.canTransition(CONFIRMED, BookingState.Completed)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(CONFIRMED, BookingState.Cancelled)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(CONFIRMED, BookingState.NoShow)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(CONFIRMED, BookingState.Confirmed)).toBe(
      false,
    );
  });

  it('terminal states have no legal outgoing transitions', () => {
    for (const status of [COMPLETED, CANCELLED]) {
      for (const to of Object.values(BookingState)) {
        expect(BookingStatus.canTransition(status, to)).toBe(false);
      }
    }
  });

  it('no_show can move back to confirmed, and nowhere else', () => {
    expect(BookingStatus.canTransition(NO_SHOW, BookingState.Confirmed)).toBe(
      true,
    );
    expect(BookingStatus.canTransition(NO_SHOW, BookingState.Completed)).toBe(
      false,
    );
    expect(BookingStatus.canTransition(NO_SHOW, BookingState.Cancelled)).toBe(
      false,
    );
    expect(BookingStatus.canTransition(NO_SHOW, BookingState.NoShow)).toBe(
      false,
    );
  });
});
