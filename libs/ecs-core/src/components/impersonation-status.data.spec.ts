import { describe, expect, it } from 'vitest';
import { UserId } from '../entities/user.entity';
import {
  ImpersonationEndReason,
  ImpersonationEndReasonKind,
  ImpersonationState,
  ImpersonationStatus,
} from './impersonation-status.data';

const adminId = UserId.of('admin-1');
const securityId = UserId.of('sec-1');
const AT = Date.UTC(2026, 9, 10, 12, 0, 0);

describe('ImpersonationEndReason', () => {
  it('builds the three stored reasons with their payloads', () => {
    expect(ImpersonationEndReason.adminEnded(adminId)).toEqual({
      kind: 'admin_ended',
      endedBy: 'admin-1',
    });
    expect(ImpersonationEndReason.expired()).toEqual({ kind: 'expired' });
    expect(ImpersonationEndReason.expired()).toBe(
      ImpersonationEndReason.expired(),
    );
    expect(
      ImpersonationEndReason.revokedBySecurity(securityId, 'leaked token'),
    ).toEqual({
      kind: ImpersonationEndReasonKind.RevokedBySecurity,
      revokedBy: 'sec-1',
      notes: 'leaked token',
    });
  });
});

describe('ImpersonationStatus', () => {
  it('active() is a shared struct with no end fields', () => {
    expect(ImpersonationStatus.active()).toEqual({ kind: 'active' });
    expect(ImpersonationStatus.active()).toBe(ImpersonationStatus.active());
    expect(ImpersonationStatus.isActive(ImpersonationStatus.active())).toBe(
      true,
    );
  });

  it('end() closes an active status, carrying the instant and the reason', () => {
    const ended = ImpersonationStatus.end(
      ImpersonationStatus.active(),
      AT,
      ImpersonationEndReason.adminEnded(adminId),
    );
    expect(ended).toEqual({
      kind: ImpersonationState.Ended,
      endedAtMs: AT,
      reason: { kind: 'admin_ended', endedBy: 'admin-1' },
    });
    expect(ended !== null && ImpersonationStatus.isActive(ended)).toBe(false);
  });

  it('end() of an ended status is null — the first end wins', () => {
    const ended = ImpersonationStatus.end(
      ImpersonationStatus.active(),
      AT,
      ImpersonationEndReason.expired(),
    );
    if (ended === null) throw new Error('unexpected failure in test fixture');
    expect(
      ImpersonationStatus.end(
        ended,
        AT + 1,
        ImpersonationEndReason.adminEnded(adminId),
      ),
    ).toBeNull();
  });
});
