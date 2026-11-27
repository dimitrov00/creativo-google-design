import { describe, expect, it } from 'vitest';
import { WorkplaceMode } from './workplace-mode.data';

describe('WorkplaceMode', () => {
  it('declares where a role is worked SCREAMING (the field `workplaceMode`)', () => {
    expect(WorkplaceMode).toEqual({
      OnSite: 'ON_SITE',
      Hybrid: 'HYBRID',
      Remote: 'REMOTE',
    });
  });
});
