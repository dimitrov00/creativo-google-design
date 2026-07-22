import { describe, expect, it } from 'vitest';
import { SEAT_LABEL_MAX_LENGTH, SeatLabel } from './seat-label';
import {
  SeatLabelEmptyError,
  SeatLabelTooLongError,
} from './seat-label.errors';

describe('SeatLabel.create', () => {
  it('accepts a short label, trimmed', () => {
    const result = SeatLabel.create('  Walk-in 14:30  ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('Walk-in 14:30');
    }
  });

  it('rejects an empty label', () => {
    const result = SeatLabel.create('   ');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(SeatLabelEmptyError);
    }
  });

  it('rejects a label longer than the max length', () => {
    const result = SeatLabel.create('a'.repeat(SEAT_LABEL_MAX_LENGTH + 1));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(SeatLabelTooLongError);
    }
  });

  it('equals/toString reflect the trimmed value', () => {
    const a = SeatLabel.create('Friend 1');
    const b = SeatLabel.create('Friend 1');
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    expect(a.value.equals(b.value)).toBe(true);
    expect(a.value.toString()).toBe('Friend 1');
  });
});
