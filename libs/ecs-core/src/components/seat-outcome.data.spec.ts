import { describe, expect, it } from 'vitest';
import { UtcEpochMs, BookingStatus, AttendanceState } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { BookingLifecycle } from './booking-lifecycle.data';
import {
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
} from './seat-outcome.data';

const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const CONFIRMED = BookingLifecycle.confirm(at(1));

describe('SeatOutcome factories', () => {
  it('build the flat attendance variants — worked, not completed', () => {
    expect(SeatOutcome.scheduled()).toEqual({ attendanceState: 'SCHEDULED' });
    expect(SeatOutcome.worked(at(5))).toEqual({
      attendanceState: 'WORKED',
      workedAtUtcMs: 5,
    });
    expect(SeatOutcome.noShow(at(5))).toEqual({
      attendanceState: 'NO_SHOW',
      noShowAtUtcMs: 5,
    });
    expect(
      SeatOutcome.cancelled(
        at(5),
        CancelledBy.Client,
        CancellationReason.ClientUnwell,
        24,
      ),
    ).toEqual({
      attendanceState: 'CANCELLED',
      cancelledAtUtcMs: 5,
      cancelledBy: 'CLIENT',
      cancellationReason: 'CLIENT_UNWELL',
      cancellationWindowHours: 24,
    });
    expect(Object.values(AttendanceState)).toEqual([
      'SCHEDULED',
      'WORKED',
      'NO_SHOW',
      'CANCELLED',
    ]);
  });

  it('stamps a window the policy could not have set as unknown, never as a number', () => {
    for (const hours of [-1, 1.5, Number.NaN]) {
      const outcome = SeatOutcome.cancelled(
        at(5),
        CancelledBy.Staff,
        CancellationReason.Unspecified,
        hours,
      );
      expect(outcome.cancellationWindowHours).toBeNull();
    }
    expect(
      SeatOutcome.cancelled(
        at(5),
        CancelledBy.Staff,
        CancellationReason.Other,
        0,
      ).cancellationWindowHours,
    ).toBe(0);
  });

  it('only scheduled is unresolved', () => {
    expect(SeatOutcome.isResolved(SeatOutcome.scheduled())).toBe(false);
    expect(SeatOutcome.isResolved(SeatOutcome.worked(at(1)))).toBe(true);
    expect(SeatOutcome.isResolved(SeatOutcome.noShow(at(1)))).toBe(true);
  });
});

/*
 * THE REASON IS OPTIONAL (owner, 2026-09-11): what nobody explained is filed
 * `UNSPECIFIED`, a bucket of its own. Code-only since §9 D23.
 */
describe('SeatOutcome.reasonOf', () => {
  it('files no code as unspecified — declining to say is not an unknown code', () => {
    expect(SeatOutcome.reasonOf('')).toBe('UNSPECIFIED');
    expect(SeatOutcome.reasonOf('  ')).toBe('UNSPECIFIED');
    expect(SeatOutcome.reasonOf('UNSPECIFIED')).toBe('UNSPECIFIED');
  });

  it('still refuses an unknown code', () => {
    expect(SeatOutcome.reasonOf('bogus')).toBeNull();
    expect(SeatOutcome.reasonOf('Client_Unwell')).toBeNull();
  });

  it('keeps the closed vocabulary, `OTHER` included without a note', () => {
    expect(SeatOutcome.reasonOf(' CLIENT_UNWELL ')).toBe('CLIENT_UNWELL');
    expect(SeatOutcome.reasonOf('OTHER')).toBe('OTHER');
    expect(SeatOutcome.reasonOf('NO_SHOW_CONVERTED')).toBe('NO_SHOW_CONVERTED');
  });

  it('reads the legacy lower-case code as its SCREAMING value (wire, stored seats)', () => {
    expect(SeatOutcome.reasonOf(' client_unwell ')).toBe('CLIENT_UNWELL');
    expect(SeatOutcome.reasonOf('other')).toBe('OTHER');
    expect(SeatOutcome.reasonOf('unspecified')).toBe('UNSPECIFIED');
    expect(SeatOutcome.reasonOf('no_show_converted')).toBe('NO_SHOW_CONVERTED');
  });

  it('never offers unspecified or no_show_converted as a chip', () => {
    expect(SeatOutcome.OFFERED_REASONS).not.toContain('UNSPECIFIED');
    expect(SeatOutcome.OFFERED_REASONS).not.toContain('NO_SHOW_CONVERTED');
    expect(SeatOutcome.OFFERED_REASONS[0]).toBe('CLIENT_CHANGED_PLANS');
  });
});

describe('CancellationReasonSet — a party’s reasons as one stored string', () => {
  it('joins distinct codes, sorted, with +', () => {
    expect(
      CancellationReasonSet.of([
        CancellationReason.Unspecified,
        CancellationReason.ClientUnwell,
        CancellationReason.ClientUnwell,
      ]),
    ).toBe('CLIENT_UNWELL+UNSPECIFIED');
    expect(
      CancellationReasonSet.of([CancellationReason.StaffShopClosure]),
    ).toBe('STAFF_SHOP_CLOSURE');
  });

  it('sorts as the lower-case stored codes sort — a legacy set keeps its bytes', () => {
    const all = Object.values(CancellationReason);
    expect(CancellationReasonSet.of(all).toLowerCase()).toBe(
      [...all]
        .map((code) => code.toLowerCase())
        .sort()
        .join('+'),
    );
  });

  it('splits back into its codes, skipping text that is no code', () => {
    expect(
      CancellationReasonSet.codes(
        CancellationReasonSet.of([
          CancellationReason.StaffShopClosure,
          CancellationReason.ClientUnwell,
        ]),
      ),
    ).toEqual(['CLIENT_UNWELL', 'STAFF_SHOP_CLOSURE']);
    expect(
      CancellationReasonSet.codes(
        CancellationReasonSet.fromStored('cancelled_by_client'),
      ),
    ).toEqual([]);
    expect(CancellationReasonSet.codes(CancellationReasonSet.of([]))).toEqual(
      [],
    );
  });
});

describe('SeatOutcome.outcomeForStatus — the window in force rides on a cancellation', () => {
  const reason = CancellationReason.ClientChangedPlans;

  it('stamps the window on the seats a party cancel closes, by staff', () => {
    expect(
      SeatOutcome.outcomeForStatus(BookingStatus.Cancelled, at(5), reason, 12),
    ).toEqual({
      attendanceState: 'CANCELLED',
      cancelledAtUtcMs: 5,
      cancelledBy: 'STAFF',
      cancellationReason: reason,
      cancellationWindowHours: 12,
    });
  });

  it('stamps unknown when the window in force is unknown', () => {
    expect(
      SeatOutcome.outcomeForStatus(
        BookingStatus.Cancelled,
        at(5),
        reason,
        null,
      ),
    ).toMatchObject({
      attendanceState: 'CANCELLED',
      cancellationWindowHours: null,
    });
  });

  it('puts it on nothing else — worked and no-show carry no window', () => {
    expect(
      SeatOutcome.outcomeForStatus(BookingStatus.Completed, at(5), reason, 12),
    ).toEqual({ attendanceState: 'WORKED', workedAtUtcMs: 5 });
    expect(
      SeatOutcome.outcomeForStatus(BookingStatus.NoShow, at(5), reason, 12),
    ).toEqual({ attendanceState: 'NO_SHOW', noShowAtUtcMs: 5 });
    expect(
      SeatOutcome.outcomeForStatus(BookingStatus.Confirmed, at(5), reason, 12),
    ).toBeNull();
    expect(
      SeatOutcome.outcomeForStatus(BookingStatus.Pending, at(5), reason, 12),
    ).toBeNull();
  });
});

describe('SeatOutcome.summarize — the root is a summary of its seats', () => {
  const cancelled = (reason: CancellationReason, by: CancelledBy) =>
    SeatOutcome.cancelled(at(2), by, reason, null);

  it('leaves the root alone while any seat is still scheduled', () => {
    expect(
      SeatOutcome.summarize(
        [SeatOutcome.worked(at(1)), SeatOutcome.scheduled()],
        CONFIRMED,
        at(9),
      ),
    ).toBe(CONFIRMED);
    expect(SeatOutcome.summarize([], CONFIRMED, at(9))).toBe(CONFIRMED);
  });

  it('folds a party cancelled seat by seat into one groupable reason set, unspecified included', () => {
    expect(
      SeatOutcome.summarize(
        [
          cancelled(CancellationReason.Unspecified, CancelledBy.Staff),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        at(9),
      ),
    ).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: 9,
      cancellationReason: 'CLIENT_UNWELL+UNSPECIFIED',
    });
  });

  it('keeps a root cancel’s own reason verbatim', () => {
    const root = BookingLifecycle.cancel(
      at(3),
      CancellationReasonSet.of([CancellationReason.StaffShopClosure]),
    );
    expect(
      SeatOutcome.summarize(
        [cancelled(CancellationReason.StaffShopClosure, CancelledBy.Staff)],
        root,
        at(9),
      ),
    ).toBe(root);
  });

  it('completes a party that generated revenue, whoever did not turn up', () => {
    expect(
      SeatOutcome.summarize(
        [
          SeatOutcome.worked(at(1)),
          SeatOutcome.noShow(at(1)),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        at(9),
      ),
    ).toEqual({ bookingStatus: 'COMPLETED', completedAtUtcMs: 9 });
  });

  it('calls a resolved party with no work and someone expected a no-show', () => {
    expect(
      SeatOutcome.summarize(
        [
          SeatOutcome.noShow(at(1)),
          cancelled(CancellationReason.ClientUnwell, CancelledBy.Client),
        ],
        CONFIRMED,
        at(9),
      ),
    ).toEqual({ bookingStatus: 'NO_SHOW', noShowAtUtcMs: 9 });
  });

  it('keeps the instant a root entered its state when the summary agrees', () => {
    const completed = BookingLifecycle.complete(at(4));
    expect(
      SeatOutcome.summarize([SeatOutcome.worked(at(1))], completed, at(9)),
    ).toBe(completed);
    const noShow = BookingLifecycle.noShow(at(4));
    expect(
      SeatOutcome.summarize([SeatOutcome.noShow(at(1))], noShow, at(9)),
    ).toBe(noShow);
  });
});
