/**
 * TS mirror of the `--cr-motion-*` tokens in ../../css/tokens.css, for the
 * few call sites that animate via the Web Animations API and therefore
 * can't read CSS custom properties (`element.animate()` options take
 * numbers/strings, not `var()`). Hand-maintained next to the CSS —
 * 1:1 parity is enforced by tokens.spec.ts, so an edit to either file
 * without the other fails the suite.
 *
 * CSS call sites must keep using `var(--cr-motion-*)` — this mirror is
 * for TypeScript only.
 */
export const motion = {
  /** Durations in milliseconds (CSS tokens carry the `ms` unit). */
  duration: {
    fast: 120,
    base: 200,
    slow: 320,
    slower: 480,
    slowest: 650,
    cinematic: 900,
  },
  easing: {
    standard: 'cubic-bezier(0.32, 0, 0.16, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.18, 1)',
    accelerate: 'cubic-bezier(0.44, 0, 1, 1)',
    emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;
