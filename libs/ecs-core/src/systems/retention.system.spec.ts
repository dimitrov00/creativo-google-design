import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RetentionAnchor } from '@core/components';
import { LocalDate, UtcEpochMs } from '@core/primitives';
import { deepFreeze, localDate, unwrapOk, utcMs } from '@core/testing';
import { RetentionSystem } from './retention.system';

/*
 * The seven formulas of `apps/functions/src/adapters/firestore-ttl.adapter.spec.ts`
 * (`purgeAtFor`, :16-:144), restated as typed anchors → instants (pass C,
 * P-34): the adapter keeps the path's group, the field reads and the
 * parsing (a missing or unreadable field is no anchor — its cases stay in
 * the adapter's spec); this system holds the arithmetic.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A civil date's UTC midnight — the spec's own arithmetic, no zone. */
const utcMidnight = (iso: string): number => utcMs(`${iso}T00:00:00.000Z`);
/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));
const { purgeAtUtcMs } = RetentionSystem;

describe('RetentionSystem.purgeAtUtcMs — the one purgeAt instant (F1-7)', () => {
  it('BARBER_BUSY: the busy day’s UTC midnight + 30 days (today’s busyPurgeAt)', () => {
    expect(
      purgeAtUtcMs(RetentionAnchor.barberBusy(localDate('2026-10-07'))),
    ).toBe(utcMidnight('2026-10-07') + 30 * DAY);
  });

  it('CAPACITY: the month’s last day at UTC midnight + 40 days (today’s monthPurgeAt)', () => {
    expect(
      purgeAtUtcMs(RetentionAnchor.capacity(localDate('2026-02-01'))),
    ).toBe(utcMidnight('2026-02-28') + 40 * DAY);
    // A leap February ends on the 29th; December ends the year.
    expect(
      purgeAtUtcMs(RetentionAnchor.capacity(localDate('2028-02-01'))),
    ).toBe(utcMidnight('2028-02-29') + 40 * DAY);
    expect(
      purgeAtUtcMs(RetentionAnchor.capacity(localDate('2026-12-01'))),
    ).toBe(utcMidnight('2026-12-31') + 40 * DAY);
  });

  it('WAITLIST_REQUESTS: the latest watched day at UTC midnight + 7 days, the epoch floor when none', () => {
    expect(
      purgeAtUtcMs(
        RetentionAnchor.waitlistRequests([
          localDate('2026-10-09'),
          localDate('2026-10-12'),
          localDate('2026-10-10'),
        ]),
      ),
    ).toBe(utcMidnight('2026-10-12') + 7 * DAY);
    expect(purgeAtUtcMs(RetentionAnchor.waitlistRequests([]))).toBe(7 * DAY);
    // A day before the floor never pulls the anchor below it.
    expect(
      purgeAtUtcMs(RetentionAnchor.waitlistRequests([localDate('1969-12-31')])),
    ).toBe(7 * DAY);
    expect(RetentionSystem.EPOCH_FLOOR_DAY).toBe('1970-01-01');
  });

  it('NOTIFICATIONS: sentAtUtcMs + 90 days', () => {
    const sentAtUtcMs = at(utcMidnight('2026-10-01') + HOUR);
    expect(purgeAtUtcMs(RetentionAnchor.notifications(sentAtUtcMs))).toBe(
      sentAtUtcMs + 90 * DAY,
    );
  });

  it('LEAD_TIME_SAMPLES: the sampled day’s UTC midnight + 400 days', () => {
    expect(
      purgeAtUtcMs(RetentionAnchor.leadTimeSamples(localDate('2026-10-07'))),
    ).toBe(utcMidnight('2026-10-07') + 400 * DAY);
  });

  it('OTPS: expiresAtUtcMs + 24 hours (the pre-flip OTP repository’s formula, F2-11)', () => {
    const expiresAtUtcMs = utcMs('2026-10-07T09:05:00.000Z');
    expect(purgeAtUtcMs(RetentionAnchor.otps(expiresAtUtcMs))).toBe(
      expiresAtUtcMs + DAY,
    );
  });

  it('IMPERSONATION_SESSIONS: the end (or, while open, the expiry) + 30 days — an ENDED body re-stamps (Phase 4a 4A-3 (4))', () => {
    const startedAtUtcMs = utcMidnight('2026-10-01') + 9 * HOUR;
    const expiresAtUtcMs = at(startedAtUtcMs + HOUR);
    const endedAtUtcMs = at(startedAtUtcMs + 600_000);
    expect(
      purgeAtUtcMs(RetentionAnchor.impersonationSessions(null, expiresAtUtcMs)),
    ).toBe(expiresAtUtcMs + 30 * DAY);
    // The end wins, though it is earlier than the expiry it replaces.
    expect(
      purgeAtUtcMs(
        RetentionAnchor.impersonationSessions(endedAtUtcMs, expiresAtUtcMs),
      ),
    ).toBe(endedAtUtcMs + 30 * DAY);
    expect(
      purgeAtUtcMs(RetentionAnchor.impersonationSessions(endedAtUtcMs, null)),
    ).toBe(endedAtUtcMs + 30 * DAY);
  });

  it('never invents an anchor: a session stamped with neither an end nor an expiry is not stamped', () => {
    expect(
      purgeAtUtcMs(RetentionAnchor.impersonationSessions(null, null)),
    ).toBeNull();
  });

  it('keeps the seven retention figures (runbook §2.1)', () => {
    expect([
      RetentionSystem.BARBER_BUSY_KEEP_DAYS,
      RetentionSystem.CAPACITY_KEEP_DAYS,
      RetentionSystem.WAITLIST_KEEP_DAYS,
      RetentionSystem.NOTIFICATION_KEEP_DAYS,
      RetentionSystem.LEAD_TIME_KEEP_DAYS,
      RetentionSystem.OTP_KEEP_HOURS,
      RetentionSystem.IMPERSONATION_KEEP_DAYS,
    ]).toEqual([30, 40, 7, 90, 400, 24, 30]);
  });
});

describe('RetentionSystem — properties', () => {
  it('stamps a day’s anchor at a whole UTC day, the same for every shop zone (integer civil math)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_932_896 }), (epochDay) => {
        const day = LocalDate.fromEpochDay(epochDay);
        expect(purgeAtUtcMs(RetentionAnchor.barberBusy(day))).toBe(
          (epochDay + 30) * DAY,
        );
        expect(purgeAtUtcMs(RetentionAnchor.leadTimeSamples(day))).toBe(
          (epochDay + 400) * DAY,
        );
      }),
    );
  });

  it('anchors a request on its latest day, whatever the order it names them in', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 40_000 }), { maxLength: 8 }),
        (epochDays) => {
          const days = epochDays.map((d) => LocalDate.fromEpochDay(d));
          const latest = epochDays.reduce((a, b) => Math.max(a, b), 0);
          expect(purgeAtUtcMs(RetentionAnchor.waitlistRequests(days))).toBe(
            (latest + 7) * DAY,
          );
          expect(
            purgeAtUtcMs(RetentionAnchor.waitlistRequests([...days].reverse())),
          ).toBe((latest + 7) * DAY);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const anchors = deepFreeze([
      RetentionAnchor.capacity(localDate('2028-02-01')),
      RetentionAnchor.waitlistRequests([
        localDate('2026-10-12'),
        localDate('2026-10-09'),
      ]),
      RetentionAnchor.impersonationSessions(
        null,
        utcMs('2026-10-07T09:05:00.000Z'),
      ),
    ]);
    const once = anchors.map((anchor) => purgeAtUtcMs(anchor));
    expect(anchors.map((anchor) => purgeAtUtcMs(anchor))).toEqual(once);
    expect(anchors[1]).toEqual(
      RetentionAnchor.waitlistRequests([
        localDate('2026-10-12'),
        localDate('2026-10-09'),
      ]),
    );
  });
});
