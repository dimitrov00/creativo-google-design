import { describe, expect, it } from 'vitest';
import { UserId, UtcEpochMs } from '@core/primitives';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { BarberLifecycle } from './barber-lifecycle.data';
import { BarberStatus } from './barber-status.data';

const at = FIXTURE_NOW_UTC_MS;
const draft: BarberLifecycle = {
  barberStatus: BarberStatus.Draft,
  barberStatusChangedAtUtcMs: at,
  barberDraftTargetStatus: BarberStatus.Public,
};
const staffOnly: BarberLifecycle = {
  barberStatus: BarberStatus.StaffOnly,
  barberStatusChangedAtUtcMs: at,
};
const listed: BarberLifecycle = {
  barberStatus: BarberStatus.Public,
  barberStatusChangedAtUtcMs: at,
};
const departed: BarberLifecycle = {
  barberStatus: BarberStatus.Departed,
  barberStatusChangedAtUtcMs: at,
  barberDepartedUserId: null,
  barberSessionsRevokedAtUtcMs: null,
  barberKeptAccessUserId: null,
  barberRehireStatus: BarberStatus.Public,
};

describe('BarberLifecycle', () => {
  it('lists the statuses a barber works in, staff-only first', () => {
    expect(BarberLifecycle.LIVE_STATUSES).toEqual([
      BarberStatus.StaffOnly,
      BarberStatus.Public,
    ]);
  });

  it('is live only while staff-only or public — never a draft, never departed', () => {
    expect(
      [draft, staffOnly, listed, departed].map(BarberLifecycle.isLive),
    ).toEqual([false, true, true, false]);
  });

  it('is public only while public', () => {
    expect(
      [draft, staffOnly, listed, departed].map(BarberLifecycle.isPublic),
    ).toEqual([false, false, true, false]);
  });

  it('builds a draft with where it goes live, and a live record with its stamp', () => {
    expect(BarberLifecycle.draft(at, BarberStatus.StaffOnly)).toEqual({
      barberStatus: 'DRAFT',
      barberStatusChangedAtUtcMs: at,
      barberDraftTargetStatus: 'STAFF_ONLY',
    });
    expect(BarberLifecycle.live(BarberStatus.Public, at)).toEqual({
      barberStatus: 'PUBLIC',
      barberStatusChangedAtUtcMs: at,
    });
  });

  it('departs a record: who lost access, sessions not revoked yet, and where a rehire returns', () => {
    const user = UserId.of('u-ivan');
    expect(BarberLifecycle.depart(at, user, BarberStatus.Public)).toEqual({
      barberStatus: 'DEPARTED',
      barberStatusChangedAtUtcMs: at,
      barberDepartedUserId: 'u-ivan',
      barberSessionsRevokedAtUtcMs: null,
      barberKeptAccessUserId: null,
      barberRehireStatus: 'PUBLIC',
    });
    expect(
      BarberLifecycle.depart(at, null, BarberStatus.StaffOnly)
        .barberDepartedUserId,
    ).toBeNull();
  });

  it('marks a departure’s sessions revoked without moving its own stamp', () => {
    const left = BarberLifecycle.depart(
      at,
      UserId.of('u-ivan'),
      BarberStatus.Public,
    );
    const later = UtcEpochMs.plusMs(at, 60_000);
    expect(BarberLifecycle.revoked(left, later)).toEqual({
      ...left,
      barberSessionsRevokedAtUtcMs: later,
    });
    // The input is untouched.
    expect(left.barberSessionsRevokedAtUtcMs).toBeNull();
  });

  it('awaits a revoke only as a departure that took access from an account and has not ended its sessions', () => {
    const left = BarberLifecycle.depart(
      at,
      UserId.of('u-ivan'),
      BarberStatus.Public,
    );
    expect(
      [
        draft,
        staffOnly,
        listed,
        departed,
        left,
        BarberLifecycle.revoked(left, at),
      ].map(BarberLifecycle.awaitsRevoke),
    ).toEqual([false, false, false, false, true, false]);
  });

  it('takes only the two live statuses from an untrusted value', () => {
    expect(
      ['STAFF_ONLY', 'PUBLIC', 'DRAFT', 'DEPARTED', 'public', null, 1].map(
        BarberLifecycle.isLiveStatus,
      ),
    ).toEqual([true, true, false, false, false, false, false]);
  });
});
