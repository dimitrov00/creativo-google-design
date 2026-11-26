/**
 * SwiftUI's spring presets as CSS: the spring equation sampled into a
 * `linear()` easing, and the time the spring takes to come to rest.
 *
 * SwiftUI names a spring by its PERCEIVED duration and a bounce
 * (`Spring(duration:bounce:)`): unit mass, stiffness `(2π / duration)²`,
 * damping ratio `1 − bounce`. The perceived duration is when the motion
 * reads as done; the spring itself settles later, and that later time is
 * the CSS duration, so the sampled curve keeps the spring's real speed.
 *
 * Tokens stay hand-written CSS. `spring.spec.ts` recomputes each token in
 * `tokens.css` from the parameters here and fails when they differ.
 */
export interface SpringPreset {
  /** SwiftUI's perceived duration, in seconds. */
  readonly durationSeconds: number;
  /** SwiftUI's bounce: 0 is critically damped, towards 1 bouncier. */
  readonly bounce: number;
}

/** The presets that have a token: `--sys-motion-spring-<name>`. */
export const SPRING_PRESETS = {
  /** ≙ `.smooth` — no overshoot. */
  smooth: { durationSeconds: 0.5, bounce: 0 },
  /** ≙ `.snappy` — a small overshoot. */
  snappy: { durationSeconds: 0.5, bounce: 0.15 },
} as const satisfies Record<string, SpringPreset>;

export type SpringPresetName = keyof typeof SPRING_PRESETS;

/** The spring counts as at rest once it stays this close to its target. */
const REST = 0.001;
/** One sample per this many milliseconds: finer than a 60 Hz frame. */
const SAMPLE_MS = 15;
const SETTLE_STEP_MS = 10;

/** Progress from 0 towards 1, `seconds` after release from rest. */
export function springProgress(preset: SpringPreset, seconds: number): number {
  const omega = (2 * Math.PI) / preset.durationSeconds;
  const zeta = 1 - preset.bounce;
  if (zeta >= 1) {
    return 1 - (1 + omega * seconds) * Math.exp(-omega * seconds);
  }
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * seconds);
  return (
    1 -
    decay *
      (Math.cos(damped * seconds) +
        ((zeta * omega) / damped) * Math.sin(damped * seconds))
  );
}

/** When the spring comes to rest, rounded up to 10 ms. */
export function springSettleMs(preset: SpringPreset): number {
  let lastAway = 0;
  for (let ms = 0; ms <= 5000; ms += 1) {
    if (Math.abs(1 - springProgress(preset, ms / 1000)) > REST) lastAway = ms;
  }
  return Math.ceil((lastAway + 1) / SETTLE_STEP_MS) * SETTLE_STEP_MS;
}

/** The `linear()` easing over the settle time, evenly sampled, ending on 1. */
export function springEasing(preset: SpringPreset): string {
  const settleMs = springSettleMs(preset);
  const steps = Math.ceil(settleMs / SAMPLE_MS);
  const stops: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const progress =
      step === steps
        ? 1
        : springProgress(preset, ((step / steps) * settleMs) / 1000);
    stops.push(String(Number(progress.toFixed(3))));
  }
  return `linear(${stops.join(', ')})`;
}
