import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Actor } from './actor';
import { AuditEntry, AuditEntryProps } from './audit-entry';

function userId(raw: string): UserId {
  const result = UserId.create(raw);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const adminId = userId('admin-1');

function validProps(overrides: Partial<AuditEntryProps> = {}): AuditEntryProps {
  return {
    id: 'audit-1',
    actor: Actor.admin(adminId),
    action: 'start_impersonation',
    atIso: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

describe('AuditEntry.create', () => {
  it('builds a valid entry with optional fields defaulted to null', () => {
    const result = AuditEntry.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.action).toBe('start_impersonation');
      expect(result.value.targetUserId).toBeNull();
      expect(result.value.resourceId).toBeNull();
      expect(result.value.context).toBeNull();
    }
  });

  it('carries targetUserId/resourceId/context when provided', () => {
    const targetId = userId('user-1');
    const result = AuditEntry.create(
      validProps({
        targetUserId: targetId.value,
        resourceId: 'sess-1',
        context: { scope: 'read' },
      }),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.targetUserId?.equals(targetId)).toBe(true);
      expect(result.value.resourceId).toBe('sess-1');
      expect(result.value.context).toEqual({ scope: 'read' });
    }
  });

  it('rejects an empty id', () => {
    const result = AuditEntry.create(validProps({ id: '' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.some((e) => e.code === 'governance.id.empty')).toBe(
        true,
      );
    }
  });

  it('rejects an empty/whitespace-only action', () => {
    const result = AuditEntry.create(validProps({ action: '   ' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) => e.code === 'governance.audit_entry.empty_action',
        ),
      ).toBe(true);
    }
  });

  it('rejects a malformed instant', () => {
    const result = AuditEntry.create(validProps({ atIso: 'not-a-date' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.some((e) => e.code === 'invalid_date_time')).toBe(
        true,
      );
    }
  });

  it('rejects an invalid targetUserId', () => {
    const result = AuditEntry.create(validProps({ targetUserId: '' }));
    expect(result.isFailure()).toBe(true);
  });
});

describe('AuditEntry.reconstitute', () => {
  it('validates identically to create', () => {
    const result = AuditEntry.reconstitute(validProps());
    expect(result.isSuccess()).toBe(true);
  });
});
