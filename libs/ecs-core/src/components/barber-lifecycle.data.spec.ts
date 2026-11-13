import { describe, expect, it } from 'vitest';
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
});
