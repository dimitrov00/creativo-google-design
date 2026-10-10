import { describe, expect, it } from 'vitest';
import { BookingState, BookingStatus } from './booking-status.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
} from './seat-outcome.data';

const CONFIRMED = BookingStatus.confirm(1);

describe('SeatOutcome factories', () => {
  it('build the stored tags — worked, not completed', () => {
    expect(SeatOutcome.scheduled()).toEqual({ kind: 'scheduled' });
    expect(SeatOutcome.worked(5)).toEqual({ kind: 'worked', atMs: 5 });
    expect(SeatOutcome.noShow(5)).toEqual({ kind: 'no_show', atMs: 5 });
    expect(
      SeatOutcome.cancelled(
        5,
        CancelledBy.Client,
        CancellationReason.ClientUnwell,
        24,
      ),
    ).toEqual({
      kind: 'cancelled',
      atMs: 5,
      by: 'client',
      reason: { kind: 'client_unwell' },
      windowHours: 24,
    });
  });

  it('stamps a window the policy could not have set as unknown, never as a number', () => {
    for (const hours of [-1, 1.5, Number.NaN]) {
      const outcome = SeatOutcome.cancelled(
        5,
        CancelledBy.Staff,
        CancellationReason.Unspecified,
        hours,
      );
      expect(outcome.windowHours).toBeNull();
    }
    expect(
      SeatOutcome.cancelled(5, CancelledBy.Staff, CancellationReason.Other, 0)
        .windowHours,
    ).toBe(0);
  });

  it('only scheduled is unresolved', () => {
    expect(SeatOutcome.isResolved(SeatOutcome.scheduled())).toBe(false);
    expect(SeatOutcome.isResolved(SeatOutcome.worked(1))).toBe(true);
    expect(SeatOutcome.isResolved(SeatOutcome.noShow(1))).toBe(true);
  });
});

/*
 * THE REASON IS OPTIONAL (owner, 2026-09-11): what nobody explained is filed
 * `unspecified`, a bucket of its own. Code-only since §9 D23.
 */
describe('SeatOutcome.reasonOf', () => {
  it('files no code as unspecified — declining to say is not an unknown code', () => {
    expect(SeatOutcome.reasonOf('')).toBe('unspecified');
    expect(SeatOutcome.reasonOf('  ')).toBe('unspecified');
    expect(SeatOutcome.reasonOf('unspecified')).toBe('unspecified');
  });

  it('still refuses an unknown code', () => {
    expect(SeatOutcome.reasonOf('bogus')).toBeNull();
  });

  it('keeps the closed vocabulary, `other` included without a note', () => {
    expect(SeatOutcome.reasonOf(' client_unwell ')).toBe('client_unwell');
    expect(SeatOutcome.reasonOf('other')).toBe('other');
    expect(SeatOutcome.reasonOf('no_show_converted')).toBe('no_show_converted');
  });

  it('never offers unspecified or no_show_converted as a chip', () => {
    expect(SeatOutcome.OFFERED_REASONS).not.toContain('unspecified');
    expect(SeatOutcome.OFFERED_REASONS).not.toContain('no_show_converted');
    expect(SeatOutcome.OFFERED_REASONS[0]).toBe('client_changed_plans');
  });
});

describe('SeatOutcome.outcomeForStatus — the window in force rides on a cancellation', () => {
  const reason = CancellationReason.ClientChangedPlans;

  it('stamps the window on the seats a party cancel closes, by staff', () => {
    expect(
      SeatOutcome.outcomeForStatus(BookingState.Cancelled, 5, reason, 12),
    ).toEqual({
      kind: 'cancelled',
      atMs: 5,
      by: 'staff',
      reason: { kind: reason },
      windowHours: 12,
    });
  });

  it('stamps unknown when the window in force is unknown', () => {
    expect(
      SeatOutcome.outcomeForStatus(BookingState.Cancelled, 5, reason, null),
    ).toMatchObject({ kind: 'cancelled', windowHours: null });
  });

  it('puts it on nothing else — worked and no-show carry no window', () => {
    expect(
      SeatOutcome.outcomeForStatus(BookingState.Completed, 5, reason, 12),
    ).toEqual({ kind: 'worked', atMs: 5 });
    expect(
      SeatOutcome.outcomeForStatus(BookingState.NoShow, 5, reason, 12),
    ).toEqual({ kind: 'no_show', atMs: 5 });
    expect(
      SeatOutcome.outcomeForStatus(BookingState.Confirmed, 5, reason, 12),
    ).toBeNull();
    expect(
      SeatOutcome.outcomeForStatus(BookingState.Pending, 5, reason, 12),
    ).toBeNull();
  });
});

describe('SeatOutcome.summarize — the root is a summary of its seats', () => {
  const cancelled = (reason: CancellationReason, by: CancelledBy) =>
    SeatOutcome.cancelled(2, by, reason, null);

  it('leaves the root alone while any seat is still scheduled', () => {
    expect(
      SeatOutcome.summarize(
        [SeatOutcome.worked(1), SeatOutcome.scheduled()],
        CONFIRMED,
        9,
      ),
    ).toBe(CONFIRMED);
    expect(SeatOutcome.summarize([], CONFIRMED, 9)).toBe(CONFIRMED);
  });

  it('folds a party cancelled seat by seat into one groupable root string, unspecified included', () => {
    expect(
      SeatOutcome.summarize(
        [
          cancelled(CancellationReason.Unspecified, CancelledBy.Staff),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        9,
      ),
    ).toEqual({
      kind: 'cancelled',
      atMs: 9,
      reason: 'client_unwell+unspecified',
    });
  });

  it('keeps a root cancel’s own reason verbatim', () => {
    const root = BookingStatus.cancel(3, 'staff_shop_closure');
    expect(
      SeatOutcome.summarize(
        [cancelled(CancellationReason.StaffShopClosure, CancelledBy.Staff)],
        root,
        9,
      ),
    ).toBe(root);
  });

  it('completes a party that generated revenue, whoever did not turn up', () => {
    expect(
      SeatOutcome.summarize(
        [
          SeatOutcome.worked(1),
          SeatOutcome.noShow(1),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        9,
      ),
    ).toEqual({ kind: 'completed', atMs: 9 });
  });

  it('calls a resolved party with no work and someone expected a no-show', () => {
    expect(
      SeatOutcome.summarize(
        [
          SeatOutcome.noShow(1),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        9,
      ),
    ).toEqual({ kind: 'no_show', atMs: 9 });
  });

  it('keeps the instant a root entered its state when the summary agrees', () => {
    const completed = BookingStatus.complete(4);
    expect(SeatOutcome.summarize([SeatOutcome.worked(1)], completed, 9)).toBe(
      completed,
    );
    const noShow = BookingStatus.noShow(4);
    expect(SeatOutcome.summarize([SeatOutcome.noShow(1)], noShow, 9)).toBe(
      noShow,
    );
  });
});
