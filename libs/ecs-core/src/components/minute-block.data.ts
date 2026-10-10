import { MinuteRange } from './minute-range.data';

/** Why a stretch of a barber's day is occupied — the ONLY source of these tags. */
export const BlockKind = {
  /** A booked seat. */
  Busy: 'busy',
  /** The turnaround buffer around a booked seat. */
  Padding: 'padding',
  /** A break inside the shift. */
  Break: 'break',
  /** A schedule exception's blocked hours. */
  Exception: 'exception',
} as const;
export type BlockKind = (typeof BlockKind)[keyof typeof BlockKind];

/**
 * One occupied span of the busy projection, in wall-clock minutes of its day
 * — the `blocks` array of a `barberBusy` day document. A `MinuteRange` with a
 * tag, so every range operation applies to it unchanged.
 */
export type MinuteBlock = MinuteRange & { readonly kind: BlockKind };

export const MinuteBlock = {
  of(startMinutes: number, endMinutes: number, kind: BlockKind): MinuteBlock {
    return { startMinutes, endMinutes, kind };
  },

  /** Half-open overlap of the spans; the kinds do not matter. */
  overlaps(a: MinuteBlock, b: MinuteBlock): boolean {
    return MinuteRange.overlaps(a, b);
  },
} as const;
