import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { carriedOffsetMinutes, carriedStartMs } from './move-shift';

const MINUTE = 60_000;

/** An instant on a whole minute, anywhere in a few years around 2026. */
const minuteInstant = fc
  .integer({ min: 29_000_000, max: 30_500_000 })
  .map((minutes) => minutes * MINUTE);

describe('the move shift — where a carried seat lands', () => {
  it('moves a carried seat by exactly as far as the cart’s earliest seat moved (property)', () => {
    // The server's old statement of the rule, `seat + (cartEarliest - anchor)`,
    // and the web's, `cartEarliest + offset`, are one answer.
    fc.assert(
      fc.property(
        minuteInstant,
        minuteInstant,
        minuteInstant,
        (anchorMs, seatStartMs, cartEarliestMs) => {
          const offset = carriedOffsetMinutes(seatStartMs, anchorMs);
          expect(carriedStartMs(cartEarliestMs, offset)).toBe(
            seatStartMs + (cartEarliestMs - anchorMs),
          );
        },
      ),
    );
  });

  it('keeps every carried seat’s distance from every other — the party moves rigidly (property)', () => {
    fc.assert(
      fc.property(
        minuteInstant,
        fc.array(fc.integer({ min: -600, max: 600 }), {
          minLength: 2,
          maxLength: 5,
        }),
        minuteInstant,
        (anchorMs, offsets, cartEarliestMs) => {
          const before = offsets.map((minutes) => anchorMs + minutes * MINUTE);
          const after = before.map((startMs) =>
            carriedStartMs(
              cartEarliestMs,
              carriedOffsetMinutes(startMs, anchorMs),
            ),
          );
          for (const [index, startMs] of after.entries()) {
            expect(startMs - (after[0] as number)).toBe(
              (before[index] as number) - (before[0] as number),
            );
          }
        },
      ),
    );
  });

  it('changes nothing when the cart lands where it already was (property)', () => {
    fc.assert(
      fc.property(minuteInstant, minuteInstant, (anchorMs, seatStartMs) => {
        expect(
          carriedStartMs(anchorMs, carriedOffsetMinutes(seatStartMs, anchorMs)),
        ).toBe(seatStartMs);
      }),
    );
  });

  it('keeps the offset in whole minutes, negative when the carried seat goes first', () => {
    const anchorMs = 1_780_000_000_000 - (1_780_000_000_000 % MINUTE);
    expect(carriedOffsetMinutes(anchorMs + 45 * MINUTE, anchorMs)).toBe(45);
    expect(carriedOffsetMinutes(anchorMs - 30 * MINUTE, anchorMs)).toBe(-30);
    // A stray second never becomes a fractional offset the draft or the
    // engine would have to carry.
    expect(
      Number.isInteger(
        carriedOffsetMinutes(anchorMs + 45 * MINUTE + 1_000, anchorMs),
      ),
    ).toBe(true);
  });
});
