import { describe, expect, it } from 'vitest';
import { PositionStatus } from './program-status.data';

describe('PositionStatus', () => {
  it('declares the position statuses SCREAMING (the field `positionStatus`, index #12)', () => {
    expect(PositionStatus).toEqual({ Open: 'OPEN', Closed: 'CLOSED' });
  });
});
