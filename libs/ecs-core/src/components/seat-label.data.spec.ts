import { describe, expect, it } from 'vitest';
import { SeatLabel } from './seat-label.data';

describe('SeatLabel.parse', () => {
  it('accepts a short label, trimmed', () => {
    const result = SeatLabel.parse('  Walk-in 14:30  ');
    expect(result).toEqual({ ok: true, value: 'Walk-in 14:30' });
  });

  it('rejects an empty label', () => {
    const result = SeatLabel.parse('   ');
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.errorCode).toBe('SCHEDULING_SEAT_LABEL_EMPTY');
  });

  it('rejects a label longer than the max length — and takes one exactly at it', () => {
    const result = SeatLabel.parse('a'.repeat(SeatLabel.MAX_LENGTH + 1));
    expect(result).toEqual({
      ok: false,
      error: { errorCode: 'SCHEDULING_SEAT_LABEL_TOO_LONG', max: 60 },
    });
    expect(SeatLabel.parse('a'.repeat(SeatLabel.MAX_LENGTH)).ok).toBe(true);
  });

  it('compares the trimmed value, case kept', () => {
    const a = SeatLabel.parse('Friend 1');
    const b = SeatLabel.parse(' Friend 1 ');
    if (!a.ok || !b.ok) throw new Error('bad fixture');
    expect(SeatLabel.equals(a.value, b.value)).toBe(true);
    expect(SeatLabel.equals(a.value, SeatLabel.of('friend 1'))).toBe(false);
  });
});
