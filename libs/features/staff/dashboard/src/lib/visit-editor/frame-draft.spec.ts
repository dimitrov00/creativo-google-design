import { describe, expect, it } from 'vitest';
import { DurationMinutes } from '@core/primitives';
import { trackMinute, unwrapOk } from '@core/testing';
import { withFrame } from './frame-draft';

const minutes = (n: number) => unwrapOk(DurationMinutes.of(n));
const draft = {
  startMinute: trackMinute(660),
  durationOverride: null,
  legs: [{ durationMinutes: minutes(35) }],
};

describe('withFrame — a frame’s interval on a draft', () => {
  it('moves the start and leaves the services’ span alone', () => {
    const moved = withFrame(draft, {
      startMinute: trackMinute(720),
      endMinute: trackMinute(755),
    });
    expect(moved).toEqual({ ...draft, startMinute: 720 });
  });

  it('pins a resized span as the duration override', () => {
    const resized = withFrame(draft, {
      startMinute: trackMinute(660),
      endMinute: trackMinute(720),
    });
    expect(resized.durationOverride).toBe(60);
  });

  it('hands the same draft back when nothing moved', () => {
    expect(
      withFrame(draft, {
        startMinute: trackMinute(660),
        endMinute: trackMinute(695),
      }),
    ).toBe(draft);
  });
});
