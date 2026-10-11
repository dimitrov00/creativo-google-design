import { describe, expect, it } from 'vitest';
import { UtcEpochMs, SchedulingErrorCode } from '@core/primitives';
import { unwrapOk, utcMs } from '@core/testing';
import { BookingPolicy } from './booking-policy.data';
import { ClientStatsPolicy } from './client-stats-policy.data';

const HOUR = 3_600_000;
/** A visit at 2026-10-12T10:00:00Z, as a literal instant. */
const START = utcMs('2026-10-12T10:00:00.000Z');
/** `START` moved by `ms` — an instant (the late line is elapsed time, T2). */
const off = (ms: number): UtcEpochMs => UtcEpochMs.plusMs(START, ms);
/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

describe('ClientStatsPolicy defaults', () => {
  it('DEFAULT is R47 over the default booking policy', () => {
    expect(ClientStatsPolicy.DEFAULT).toEqual({
      booking: BookingPolicy.DEFAULT,
      suggestPauseNoShows: 3,
      suggestPauseWindowDays: 60,
    });
    expect(ClientStatsPolicy.BOUNDED_DAYS).toBe(365);
  });

  it('forBooking keeps the tenant’s booking policy', () => {
    const booking = { ...BookingPolicy.DEFAULT, cancellationWindowHours: 48 };
    expect(ClientStatsPolicy.forBooking(booking).booking).toBe(booking);
  });
});

describe('ClientStatsPolicy.create', () => {
  it('accepts the defaults', () => {
    expect(ClientStatsPolicy.create(ClientStatsPolicy.DEFAULT)).toEqual({
      ok: true,
      value: ClientStatsPolicy.DEFAULT,
    });
  });

  it('accepts a window of exactly the bounded days', () => {
    expect(
      ClientStatsPolicy.create({
        ...ClientStatsPolicy.DEFAULT,
        suggestPauseWindowDays: 365,
      }).ok,
    ).toBe(true);
  });

  it('refuses every invalid field at once', () => {
    expect(
      ClientStatsPolicy.create({
        booking: BookingPolicy.DEFAULT,
        suggestPauseNoShows: 0,
        suggestPauseWindowDays: 366,
      }),
    ).toEqual({
      ok: false,
      error: [
        {
          errorCode: SchedulingErrorCode.ClientStatsPolicyInvalid,
          field: 'suggestPauseNoShows',
          rawValue: 0,
        },
        {
          errorCode: SchedulingErrorCode.ClientStatsPolicyInvalid,
          field: 'suggestPauseWindowDays',
          rawValue: 366,
        },
      ],
    });
    expect(
      ClientStatsPolicy.create({
        ...ClientStatsPolicy.DEFAULT,
        suggestPauseNoShows: 2.5,
        suggestPauseWindowDays: 0,
      }).ok,
    ).toBe(false);
  });
});

describe('ClientStatsPolicy.isLateCancellation', () => {
  const policy = ClientStatsPolicy.DEFAULT; // 24 h window

  it('judges an unstamped cancellation by the current window, the deadline itself free', () => {
    expect(
      ClientStatsPolicy.isLateCancellation(
        policy,
        START,
        off(-24 * HOUR),
        null,
      ),
    ).toBe(false);
    expect(
      ClientStatsPolicy.isLateCancellation(
        policy,
        START,
        off(-24 * HOUR + 1),
        null,
      ),
    ).toBe(true);
  });

  it('judges a stamped cancellation by its own window, never the current one', () => {
    // 30 h before the start: free under 24 h, late under a stamped 48 h.
    const cancelled = off(-30 * HOUR);
    expect(
      ClientStatsPolicy.isLateCancellation(policy, START, cancelled, null),
    ).toBe(false);
    expect(
      ClientStatsPolicy.isLateCancellation(policy, START, cancelled, 48),
    ).toBe(true);
  });

  it('a stamped zero-hour window is a shop with no free cancellation window', () => {
    expect(ClientStatsPolicy.isLateCancellation(policy, START, START, 0)).toBe(
      false,
    );
    expect(
      ClientStatsPolicy.isLateCancellation(policy, START, at(START + 1), 0),
    ).toBe(true);
  });

  it('draws the line with the booking policy’s own formula', () => {
    for (const offset of [-48, -24, -1, 0, 1].map((h) => h * HOUR)) {
      expect(
        ClientStatsPolicy.isLateCancellation(policy, START, off(offset), null),
      ).toBe(!BookingPolicy.mayCancelAt(policy.booking, START, off(offset)));
    }
  });
});
