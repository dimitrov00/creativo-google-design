import { describe, expect, it } from 'vitest';
import { StreakDefinitionVersionId } from './streak-definition-version.entity';

describe('StreakDefinitionVersionId', () => {
  it('is the version padded to six digits, so the history sorts by id', () => {
    expect(StreakDefinitionVersionId.forVersion(1)).toBe('000001');
    expect(StreakDefinitionVersionId.forVersion(42)).toBe('000042');
    expect(StreakDefinitionVersionId.of('000003')).toBe('000003');
  });
});
