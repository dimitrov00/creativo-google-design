import { describe, expect, it } from 'vitest';
import { at, deepFreeze, until } from '@core/testing';
import { BlockKind, MinuteBlock } from './minute-block.data';
import { MinuteRange } from './minute-range.data';

describe('MinuteBlock', () => {
  it('of() is a plain tagged minute range', () => {
    expect(MinuteBlock.of(at(10), until(10, 45), BlockKind.Busy)).toEqual({
      startMinutes: 600,
      endMinutes: 645,
      blockKind: 'BUSY',
    });
  });

  it('overlaps on the span alone, half-open, whatever the kinds', () => {
    const seat = MinuteBlock.of(at(10), until(10, 45), BlockKind.Busy);
    expect(
      MinuteBlock.overlaps(
        seat,
        MinuteBlock.of(at(10, 40), until(10, 50), BlockKind.Padding),
      ),
    ).toBe(true);
    expect(
      MinuteBlock.overlaps(
        seat,
        MinuteBlock.of(at(10, 45), until(10, 55), BlockKind.Padding),
      ),
    ).toBe(false);
  });

  it('is a MinuteRange, so range math reads it unchanged', () => {
    const lunch = MinuteBlock.of(at(12), until(13), BlockKind.Break);
    expect(MinuteRange.durationMinutes(lunch)).toBe(60);
    expect(MinuteRange.overlaps(lunch, MinuteRange.of(at(9), until(18)))).toBe(
      true,
    );
    // Merging spans is kind-blind: the merged coverage is a plain range.
    expect(
      MinuteRange.normalize([
        lunch,
        MinuteBlock.of(at(10), until(12), BlockKind.Exception),
      ]),
    ).toEqual([MinuteRange.of(at(10), until(13))]);
  });

  it('has exactly the four block kinds', () => {
    expect(Object.values(BlockKind)).toEqual([
      'BUSY',
      'PADDING',
      'BREAK',
      'EXCEPTION',
    ]);
  });
});

describe('MinuteBlock.fieldFault — the read-time check of a stored busy block (edge hardening D-1)', () => {
  const block = MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy);

  it('answers null for a well-formed block of every kind', () => {
    for (const blockKind of Object.values(BlockKind)) {
      expect(MinuteBlock.fieldFault({ ...block, blockKind })).toBeNull();
    }
  });

  it('names blockKind when it is no BlockKind member', () => {
    for (const blockKind of ['busy', 'BOOKED', '', null, 1]) {
      expect(MinuteBlock.fieldFault({ ...block, blockKind })).toBe('blockKind');
    }
  });

  it('reads the span through MinuteRange first — composed, never re-checked', () => {
    const inverted = { ...block, startMinutes: 700, endMinutes: 600 };
    expect(MinuteBlock.fieldFault(inverted)).toBe(
      MinuteRange.fieldFault(inverted),
    );
    expect(
      MinuteBlock.fieldFault({ ...block, startMinutes: -5, blockKind: 'X' }),
    ).toBe('startMinutes');
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({ ...block, blockKind: 'X' });
    expect(MinuteBlock.fieldFault(raw)).toBe(MinuteBlock.fieldFault(raw));
    expect(raw.blockKind).toBe('X');
  });
});
