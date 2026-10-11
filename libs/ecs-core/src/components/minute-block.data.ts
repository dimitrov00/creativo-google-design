import type {
  EndMinute,
  MinuteOfDay,
} from '../primitives/minute-of-day.primitive';
import { MinuteRange } from './minute-range.data';

/**
 * Why a stretch of a barber's day is occupied — the ONLY source of these
 * tags, named after the field they type (`blockKind`, the field name of
 * `firestore-layout.md`).
 */
export const BlockKind = {
  /** A booked seat. */
  Busy: 'BUSY',
  /** The turnaround buffer around a booked seat. */
  Padding: 'PADDING',
  /** A break inside the shift. */
  Break: 'BREAK',
  /** A schedule exception's blocked hours. */
  Exception: 'EXCEPTION',
} as const;
export type BlockKind = (typeof BlockKind)[keyof typeof BlockKind];

/**
 * One occupied span of the busy projection, in wall-clock minutes of its
 * shop day — an element of a `barberBusy` day's `blocks` array (Law 6: an
 * array element is a flat struct with a domain-prefixed tag). A `MinuteRange`
 * with a tag, so every range operation applies to it unchanged.
 */
export type MinuteBlock = MinuteRange & { readonly blockKind: BlockKind };

export const MinuteBlock = {
  of(
    startMinutes: MinuteOfDay,
    endMinutes: EndMinute,
    blockKind: BlockKind,
  ): MinuteBlock {
    return { startMinutes, endMinutes, blockKind };
  },

  /** Half-open overlap of the spans; the kinds do not matter. */
  overlaps(a: MinuteBlock, b: MinuteBlock): boolean {
    return MinuteRange.overlaps(a, b);
  },
} as const;
