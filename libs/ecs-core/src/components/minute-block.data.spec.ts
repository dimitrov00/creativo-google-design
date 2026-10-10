import { describe, expect, it } from 'vitest';
import { BlockKind, MinuteBlock } from './minute-block.data';
import { MinuteRange } from './minute-range.data';

describe('MinuteBlock', () => {
  it('of() is a plain tagged minute range', () => {
    expect(MinuteBlock.of(600, 645, BlockKind.Busy)).toEqual({
      startMinutes: 600,
      endMinutes: 645,
      kind: 'busy',
    });
  });

  it('overlaps on the span alone, half-open, whatever the kinds', () => {
    const seat = MinuteBlock.of(600, 645, BlockKind.Busy);
    expect(
      MinuteBlock.overlaps(seat, MinuteBlock.of(640, 650, BlockKind.Padding)),
    ).toBe(true);
    expect(
      MinuteBlock.overlaps(seat, MinuteBlock.of(645, 655, BlockKind.Padding)),
    ).toBe(false);
  });

  it('is a MinuteRange, so range math reads it unchanged', () => {
    const lunch = MinuteBlock.of(720, 780, BlockKind.Break);
    expect(MinuteRange.durationMinutes(lunch)).toBe(60);
    expect(MinuteRange.overlaps(lunch, MinuteRange.of(540, 1080))).toBe(true);
    // Merging spans is kind-blind: the merged coverage is a plain range.
    expect(
      MinuteRange.normalize([
        lunch,
        MinuteBlock.of(600, 720, BlockKind.Exception),
      ]),
    ).toEqual([MinuteRange.of(600, 780)]);
  });

  it('has exactly the four block kinds', () => {
    expect(Object.values(BlockKind)).toEqual([
      'busy',
      'padding',
      'break',
      'exception',
    ]);
  });
});
