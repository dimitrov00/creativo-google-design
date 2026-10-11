import { describe, expect, it } from 'vitest';
import { UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { utcMs } from '../testing';
import {
  EndReasonFields,
  ImpersonationEndReason,
  ImpersonationLifecycle,
  ImpersonationStatus,
} from './impersonation-status.data';

const adminId = UserId.of('admin-1');
const securityId = UserId.of('sec-1');
const AT = utcMs('2026-10-10T12:00:00Z');

describe('EndReasonFields', () => {
  it('builds the three stored reasons with their prefixed payloads', () => {
    expect(EndReasonFields.adminEnded(adminId)).toEqual({
      impersonationEndReason: 'ADMIN_ENDED',
      endedByUserId: 'admin-1',
    });
    expect(EndReasonFields.expired()).toEqual({
      impersonationEndReason: 'EXPIRED',
    });
    expect(EndReasonFields.expired()).toBe(EndReasonFields.expired());
    expect(
      EndReasonFields.revokedBySecurity(securityId, 'leaked token'),
    ).toEqual({
      impersonationEndReason: ImpersonationEndReason.RevokedBySecurity,
      revokedByUserId: 'sec-1',
      revocationNotes: 'leaked token',
    });
  });
});

describe('ImpersonationLifecycle', () => {
  it('active() is a shared struct with no end fields', () => {
    expect(ImpersonationLifecycle.active()).toEqual({
      impersonationStatus: 'ACTIVE',
    });
    expect(ImpersonationLifecycle.active()).toBe(
      ImpersonationLifecycle.active(),
    );
    expect(
      ImpersonationLifecycle.isActive(ImpersonationLifecycle.active()),
    ).toBe(true);
  });

  it('end() closes an active lifecycle, the instant and the reason flat at the root', () => {
    const ended = ImpersonationLifecycle.end(
      ImpersonationLifecycle.active(),
      AT,
      EndReasonFields.adminEnded(adminId),
    );
    expect(ended).toEqual({
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: AT,
      impersonationEndReason: 'ADMIN_ENDED',
      endedByUserId: 'admin-1',
    });
    expect(ended !== null && ImpersonationLifecycle.isActive(ended)).toBe(
      false,
    );
  });

  it('end() of an ended lifecycle is null — the first end wins', () => {
    const ended = ImpersonationLifecycle.end(
      ImpersonationLifecycle.active(),
      AT,
      EndReasonFields.expired(),
    );
    if (ended === null) throw new Error('unexpected failure in test fixture');
    expect(
      ImpersonationLifecycle.end(
        ended,
        UtcEpochMs.plusMs(AT, 1),
        EndReasonFields.adminEnded(adminId),
      ),
    ).toBeNull();
  });
});
