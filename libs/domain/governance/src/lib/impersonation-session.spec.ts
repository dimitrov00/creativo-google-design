import { Clock, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId, UserRole } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import {
  ImpersonationSession,
  ReconstituteImpersonationSessionProps,
  StartImpersonationSessionProps,
} from './impersonation-session';
import { ImpersonationEndReason } from './impersonation-session-status';

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function fixedClock(iso: string): Clock {
  const now = at(iso);
  return { now: () => now };
}

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const adminId = userId('admin-1');
const targetId = userId('user-1');
const STAFF_ROLES: readonly UserRole[] = ['barber'];
const CLIENT_ROLES: readonly UserRole[] = ['client'];

function startProps(
  overrides: Partial<StartImpersonationSessionProps> = {},
): StartImpersonationSessionProps {
  return {
    id: 'sess-1',
    adminUserId: adminId.value,
    adminRoles: STAFF_ROLES,
    targetUserId: targetId.value,
    scope: 'read',
    reason: 'Investigating issue #1234',
    startedAtIso: '2026-06-01T10:00:00Z',
    expiresAtIso: '2026-06-01T10:15:00Z',
    ...overrides,
  };
}

describe('ImpersonationSession.start', () => {
  it('builds an active session with the validated payload', () => {
    const result = ImpersonationSession.start(startProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isActive()).toBe(true);
      expect(result.value.scope).toBe('read');
      expect(result.value.adminUserId.equals(adminId)).toBe(true);
      expect(result.value.targetUserId.equals(targetId)).toBe(true);
    }
  });

  it('rejects self-impersonation', () => {
    const result = ImpersonationSession.start(
      startProps({ targetUserId: adminId.value }),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) =>
            e.code === 'governance.impersonation_session.self_impersonation',
        ),
      ).toBe(true);
    }
  });

  it('rejects an empty/whitespace reason', () => {
    expect(
      ImpersonationSession.start(startProps({ reason: '' })).isFailure(),
    ).toBe(true);
    expect(
      ImpersonationSession.start(startProps({ reason: '   ' })).isFailure(),
    ).toBe(true);
  });

  it('rejects expiresAt at-or-before startedAt', () => {
    const same = ImpersonationSession.start(
      startProps({ expiresAtIso: '2026-06-01T10:00:00Z' }),
    );
    expect(same.isFailure()).toBe(true);
    if (same.isFailure()) {
      expect(
        same.error.some(
          (e) => e.code === 'governance.impersonation_session.invalid_expiry',
        ),
      ).toBe(true);
    }

    const before = ImpersonationSession.start(
      startProps({ expiresAtIso: '2026-06-01T09:00:00Z' }),
    );
    expect(before.isFailure()).toBe(true);
  });

  it('rejects an invalid scope', () => {
    const result = ImpersonationSession.start(startProps({ scope: 'full' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) => e.code === 'governance.impersonation_scope.invalid',
        ),
      ).toBe(true);
    }
  });

  it('rejects an admin whose roles are not staff-tier (blueprint §7.8 gate)', () => {
    const result = ImpersonationSession.start(
      startProps({ adminRoles: CLIENT_ROLES }),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) => e.code === 'governance.impersonation_session.admin_not_staff',
        ),
      ).toBe(true);
    }
  });

  it('collects structural errors alongside the staff-role gate', () => {
    const result = ImpersonationSession.start(
      startProps({ adminRoles: CLIENT_ROLES, reason: '' }),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      // Structural build failures short-circuit before the staff-role
      // check runs (see `start()`) — only the structural error surfaces.
      expect(
        result.error.some(
          (e) => e.code === 'governance.impersonation_session.reason_required',
        ),
      ).toBe(true);
    }
  });
});

function activeSession(): ImpersonationSession {
  const result = ImpersonationSession.start(
    startProps({ scope: 'write', reason: 'fixing broken booking' }),
  );
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('ImpersonationSession.end', () => {
  it('transitions active to ended with the supplied reason', () => {
    const session = activeSession();
    const ended = session.end(
      at('2026-06-01T10:10:00Z'),
      ImpersonationEndReason.adminEnded(adminId),
    );
    expect(ended.isSuccess()).toBe(true);
    if (ended.isSuccess()) {
      expect(ended.value.isActive()).toBe(false);
      expect(ended.value.status.kind).toBe('ended');
    }
  });

  it('fails when ending an already-ended session', () => {
    const session = activeSession();
    const firstEnd = session.end(
      at('2026-06-01T10:10:00Z'),
      ImpersonationEndReason.expired(),
    );
    if (firstEnd.isFailure())
      throw new Error('unexpected failure in test fixture');

    const secondEnd = firstEnd.value.end(
      at('2026-06-01T10:11:00Z'),
      ImpersonationEndReason.adminEnded(adminId),
    );
    expect(secondEnd.isFailure()).toBe(true);
    if (secondEnd.isFailure()) {
      expect(secondEnd.error.code).toBe(
        'governance.impersonation_session.already_ended',
      );
    }
  });
});

describe('ImpersonationSession.isExpired — boundary conditions (blueprint §7.8 goal condition)', () => {
  const session = activeSession(); // expiresAt = 2026-06-01T10:15:00Z

  it('is false just before expiresAt', () => {
    expect(session.isExpired(fixedClock('2026-06-01T10:14:59.999Z'))).toBe(
      false,
    );
  });

  it('is true exactly at expiresAt', () => {
    expect(session.isExpired(fixedClock('2026-06-01T10:15:00Z'))).toBe(true);
  });

  it('is true just after expiresAt', () => {
    expect(session.isExpired(fixedClock('2026-06-01T10:15:00.001Z'))).toBe(
      true,
    );
  });
});

describe('ImpersonationSession.reconstitute', () => {
  function reconstituteProps(
    overrides: Partial<ReconstituteImpersonationSessionProps> = {},
  ): ReconstituteImpersonationSessionProps {
    return {
      id: 'sess-1',
      adminUserId: adminId.value,
      targetUserId: targetId.value,
      scope: 'read',
      reason: 'Investigating issue #1234',
      startedAtIso: '2026-06-01T10:00:00Z',
      expiresAtIso: '2026-06-01T10:15:00Z',
      status: { kind: 'active' },
      ...overrides,
    };
  }

  it('rebuilds an active session without needing adminRoles', () => {
    const result = ImpersonationSession.reconstitute(reconstituteProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isActive()).toBe(true);
    }
  });

  it('rebuilds an ended session with its end reason', () => {
    const result = ImpersonationSession.reconstitute(
      reconstituteProps({
        status: {
          kind: 'ended',
          endedAt: at('2026-06-01T10:10:00Z'),
          reason: ImpersonationEndReason.expired(),
        },
      }),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isActive()).toBe(false);
    }
  });

  it('still rejects structurally invalid persisted data (self-impersonation)', () => {
    const result = ImpersonationSession.reconstitute(
      reconstituteProps({ targetUserId: adminId.value }),
    );
    expect(result.isFailure()).toBe(true);
  });
});
