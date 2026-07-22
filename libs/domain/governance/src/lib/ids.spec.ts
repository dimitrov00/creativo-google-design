import { describe, expect, it } from 'vitest';
import { AuditEntryId, ImpersonationSessionId } from './ids';

describe('AuditEntryId.create', () => {
  it('accepts a non-empty raw id', () => {
    const result = AuditEntryId.create('audit_1');
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = AuditEntryId.create('   ');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('governance.id.empty');
      expect(result.error.idType).toBe('AuditEntryId');
    }
  });
});

describe('AuditEntryId.generate', () => {
  it('produces distinct ids', () => {
    expect(AuditEntryId.generate().value).not.toBe(
      AuditEntryId.generate().value,
    );
  });
});

describe('ImpersonationSessionId.create', () => {
  it('accepts a non-empty raw id', () => {
    const result = ImpersonationSessionId.create('sess_1');
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = ImpersonationSessionId.create('');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('governance.id.empty');
      expect(result.error.idType).toBe('ImpersonationSessionId');
    }
  });
});

describe('ImpersonationSessionId.generate', () => {
  it('produces distinct ids', () => {
    expect(ImpersonationSessionId.generate().value).not.toBe(
      ImpersonationSessionId.generate().value,
    );
  });
});
