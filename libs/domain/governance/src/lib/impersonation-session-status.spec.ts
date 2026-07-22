import { UserId } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_IMPERSONATION_STATUS,
  ImpersonationEndReason,
  ImpersonationSessionStatus,
} from './impersonation-session-status';

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('ImpersonationSessionStatus', () => {
  it('active() is the shared active singleton', () => {
    expect(ImpersonationSessionStatus.active()).toBe(
      ACTIVE_IMPERSONATION_STATUS,
    );
  });

  it('ended() carries endedAt + reason', () => {
    const endedAt = at('2026-06-01T10:10:00Z');
    const reason = ImpersonationEndReason.expired();
    const status = ImpersonationSessionStatus.ended({ endedAt, reason });
    expect(status).toEqual({ kind: 'ended', endedAt, reason });
  });
});

describe('ImpersonationEndReason', () => {
  it('adminEnded() carries the ending admin', () => {
    const endedBy = userId('admin-1');
    expect(ImpersonationEndReason.adminEnded(endedBy)).toEqual({
      kind: 'admin_ended',
      endedBy,
    });
  });

  it('expired() has no extra payload', () => {
    expect(ImpersonationEndReason.expired()).toEqual({ kind: 'expired' });
  });

  it('revokedBySecurity() carries the revoking actor + notes', () => {
    const revokedBy = userId('security-1');
    expect(
      ImpersonationEndReason.revokedBySecurity({
        revokedBy,
        notes: 'Suspicious activity',
      }),
    ).toEqual({
      kind: 'revoked_by_security',
      revokedBy,
      notes: 'Suspicious activity',
    });
  });
});
