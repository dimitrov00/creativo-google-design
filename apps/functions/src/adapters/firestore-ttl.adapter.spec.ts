import { Timestamp } from 'firebase-admin/firestore';
import { purgeAtFor, withPurgeAt } from './firestore-ttl.adapter';

const DAY = 86_400_000;

/** A civil date's UTC midnight in epoch ms — the spec's own arithmetic, no zone. */
const utcMidnight = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const millisOf = (stamp: Timestamp | null): number | null =>
  stamp === null ? null : stamp.toMillis();

describe('purgeAtFor — the one purgeAt stamp (F1-7)', () => {
  it('barberBusy: the busy day’s UTC midnight + 30 days (today’s busyPurgeAt)', () => {
    expect(
      millisOf(
        purgeAtFor(['barberBusy', 'b-ivan__2026-10-07'], {
          barberId: 'b-ivan',
          localDate: '2026-10-07',
          blocks: [],
        }),
      ),
    ).toBe(utcMidnight('2026-10-07') + 30 * DAY);
  });

  it('capacity: the month’s last day at UTC midnight + 40 days (today’s monthPurgeAt)', () => {
    expect(
      millisOf(
        purgeAtFor(['capacity', '2026-02'], { month: '2026-02', entries: [] }),
      ),
    ).toBe(utcMidnight('2026-02-28') + 40 * DAY);
    // A leap February ends on the 29th.
    expect(
      millisOf(
        purgeAtFor(['capacity', '2028-02'], { month: '2028-02', entries: [] }),
      ),
    ).toBe(utcMidnight('2028-02-29') + 40 * DAY);
  });

  it('waitlistRequests: the latest watched day at UTC midnight + 7 days, the epoch floor when none', () => {
    expect(
      millisOf(
        purgeAtFor(['waitlistRequests', 'wl_1'], {
          localDates: ['2026-10-09', '2026-10-12', '2026-10-10'],
        }),
      ),
    ).toBe(utcMidnight('2026-10-12') + 7 * DAY);
    expect(
      millisOf(purgeAtFor(['waitlistRequests', 'wl_2'], { localDates: [] })),
    ).toBe(7 * DAY);
  });

  it('notifications: sentAtUtcMs + 90 days, matched by the LAST collection segment of a nested path', () => {
    const sentAtUtcMs = utcMidnight('2026-10-01') + 3_600_000;
    expect(
      millisOf(
        purgeAtFor(['users', 'u1', 'notifications', 'n1'], { sentAtUtcMs }),
      ),
    ).toBe(sentAtUtcMs + 90 * DAY);
  });

  it('barberLeadTimeSamples: the sampled day’s UTC midnight + 400 days', () => {
    expect(
      millisOf(
        purgeAtFor(['barberLeadTimeSamples', 'b-ivan__2026-10-07'], {
          localDate: '2026-10-07',
        }),
      ),
    ).toBe(utcMidnight('2026-10-07') + 400 * DAY);
  });

  it('otps: expiresAtUtcMs + 24 hours (the pre-flip OTP repository’s formula, F2-11)', () => {
    const expiresAtUtcMs = Date.UTC(2026, 9, 7, 9, 5);
    expect(
      millisOf(
        purgeAtFor(['otps', 'otp-1'], {
          destination: 'client@example.com',
          expiresAtUtcMs,
          consumedAtUtcMs: null,
        }),
      ),
    ).toBe(expiresAtUtcMs + DAY);
    expect(
      purgeAtFor(['otps', 'otp-1'], { expiresAtUtcMs: 'soon' }),
    ).toBeNull();
  });

  it('answers null for any other group — an appointment, the users document above a notification, a customer', () => {
    expect(
      purgeAtFor(['appointments', 'a1'], { localDate: '2026-10-07' }),
    ).toBeNull();
    expect(purgeAtFor(['users', 'u1'], { sentAtUtcMs: 1 })).toBeNull();
    expect(
      purgeAtFor(['users', 'u1'], { expiresAtUtcMs: 1, sentAtUtcMs: 1 }),
    ).toBeNull();
    expect(purgeAtFor(['customers', 'cus_1'], {})).toBeNull();
    expect(purgeAtFor(['impersonationSessions', 'imp-1'], {})).toBeNull();
  });

  it('never invents a day: a TTL body missing the field its formula reads is not stamped', () => {
    expect(purgeAtFor(['barberBusy', 'k'], { blocks: [] })).toBeNull();
    expect(purgeAtFor(['capacity', '2026-10'], { entries: [] })).toBeNull();
    expect(
      purgeAtFor(['users', 'u1', 'notifications', 'n1'], {
        sentAtUtcMs: 'soon',
      }),
    ).toBeNull();
  });

  it('withPurgeAt adds the stamp beside the body, and hands a non-TTL body back untouched', () => {
    const body = { barberId: 'b-ivan', localDate: '2026-10-07', blocks: [] };
    const stamped = withPurgeAt(['barberBusy', 'b-ivan__2026-10-07'], body);
    expect(stamped).toEqual({
      ...body,
      purgeAt: Timestamp.fromMillis(utcMidnight('2026-10-07') + 30 * DAY),
    });
    const plain = { ownerUserId: 'u1' };
    expect(withPurgeAt(['appointments', 'a1'], plain)).toBe(plain);
  });
});
