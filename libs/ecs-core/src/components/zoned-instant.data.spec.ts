import { describe, expect, it } from 'vitest';
import { ZonedInstant } from './zoned-instant.data';

const SOFIA = 'Europe/Sofia';
const NINE = 1_785_304_800_000; // 2026-07-29T06:00Z = 09:00 Sofia
const HALF_PAST = 1_785_306_600_000; // 2026-07-29T06:30Z
const FIRST_0330 = 1_792_888_200_000; // 2026-10-25T00:30Z = 03:30+03:00
const SECOND_0330 = 1_792_891_800_000; // 2026-10-25T01:30Z = 03:30+02:00

describe('ZonedInstant', () => {
  it('of() is a plain { epochMs, zone } struct', () => {
    expect(ZonedInstant.of(NINE, SOFIA)).toEqual({
      epochMs: NINE,
      zone: SOFIA,
    });
  });

  it('equals compares the INSTANT, whatever zone reads it', () => {
    expect(
      ZonedInstant.equals(
        ZonedInstant.of(NINE, SOFIA),
        ZonedInstant.of(NINE, SOFIA),
      ),
    ).toBe(true);
    expect(
      ZonedInstant.equals(
        ZonedInstant.of(NINE, SOFIA),
        ZonedInstant.of(NINE, 'UTC'),
      ),
    ).toBe(true);
    expect(
      ZonedInstant.equals(
        ZonedInstant.of(NINE, SOFIA),
        ZonedInstant.of(HALF_PAST, SOFIA),
      ),
    ).toBe(false);
  });

  it('before is strict and by instant', () => {
    const nine = ZonedInstant.of(NINE, SOFIA);
    const halfPast = ZonedInstant.of(HALF_PAST, SOFIA);
    expect(ZonedInstant.before(nine, halfPast)).toBe(true);
    expect(ZonedInstant.before(halfPast, nine)).toBe(false);
    expect(ZonedInstant.before(nine, nine)).toBe(false);
  });

  it('orders the fall-back hour by instant, not by its +03:00 / +02:00 rendering', () => {
    expect(
      ZonedInstant.before(
        ZonedInstant.of(FIRST_0330, SOFIA),
        ZonedInstant.of(SECOND_0330, SOFIA),
      ),
    ).toBe(true);
  });
});
