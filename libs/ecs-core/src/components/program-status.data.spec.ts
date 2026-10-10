import { describe, expect, it } from 'vitest';
import { PositionState } from './program-status.data';

describe('PositionState', () => {
  it('keeps the stored position status strings (index #12 filters on them)', () => {
    expect(PositionState).toEqual({ Open: 'open', Closed: 'closed' });
  });
});
