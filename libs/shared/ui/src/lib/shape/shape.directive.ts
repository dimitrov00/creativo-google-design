import { Directive, computed, input } from '@angular/core';

/**
 * SwiftUI-`Shape`-inspired vocabulary (Rectangle/RoundedRectangle/Circle/
 * Capsule), plus `square` (forces a 1:1 aspect ratio at zero radius —
 * SwiftUI has no direct equivalent since it composes `.aspectRatio(1,
 * contentMode: .fit)` separately, but a dedicated tier reads clearer here
 * than asking every consumer to remember two directives for "a square").
 * Every tier resolves to a plain `border-radius` value, deliberately NOT
 * `clip-path` — border-radius already animates natively and smoothly
 * between any two tiers here (0% <-> 50%, or any length <-> 9999px) with a
 * single `transition: border-radius`, no shape-specific interpolation
 * logic required. It's also exactly what CursorDotComponent's 'fill'/
 * 'trace' styles already read via `getComputedStyle(target).borderRadius`
 * to morph the cursor ring onto — so a `crShape`'d element's cursor morph
 * conforms automatically, with zero extra wiring.
 */
export type ShapeKind =
  'rectangle' | 'roundedRectangle' | 'circle' | 'capsule' | 'square';

const FIXED_RADIUS: Partial<Record<ShapeKind, string>> = {
  rectangle: 'var(--cr-radius-none)',
  square: 'var(--cr-radius-none)',
  circle: '50%',
  capsule: 'var(--cr-radius-full)',
};

const SQUARE_ASPECT_SHAPES: ReadonlySet<ShapeKind> = new Set([
  'circle',
  'square',
]);

/**
 * Radius token vocabulary for `crShapeRadius` — token names get IDE
 * autocomplete and map to their `--cr-radius-*` var; the `(string & {})`
 * branch keeps raw CSS lengths / var() expressions as the escape hatch
 * without collapsing the union's literal suggestions.
 */
export type ShapeRadius =
  | 'none'
  | 'small'
  | 'regular'
  | 'large'
  | 'extraLarge'
  | 'full'
  | (string & {});

const RADIUS_TOKENS: Record<string, string> = {
  none: 'var(--cr-radius-none)',
  small: 'var(--cr-radius-small)',
  regular: 'var(--cr-radius-regular)',
  large: 'var(--cr-radius-large)',
  extraLarge: 'var(--cr-radius-extra-large)',
  full: 'var(--cr-radius-full)',
};

/**
 * Clips an element into a basic shape, with an optional distinct shape to
 * morph into on hover — e.g. `crShape="square" crShapeHover="circle"` for
 * an image that becomes circular under the pointer. Deliberately NOT paired
 * with the custom cursor system (see `@creativo/shared/cursor`) — the
 * cursor stays its normal size/shape regardless of what's underneath it;
 * only the element itself animates. A plain CSS `:hover`-driven morph (see
 * shape.css) — no JS hover-tracking of its own, so it works with zero
 * script cost even where the cursor system is disabled (touch devices,
 * prefers-reduced-motion).
 *
 * Override hook: consumers needing a shape outside this vocabulary (a
 * star, a blob, an arbitrary polygon) can set `--cr-shape-radius` /
 * `--cr-shape-hover-radius` directly via their own CSS, or bypass
 * border-radius entirely with a `clip-path` override — this directive
 * only ever sets `border-radius` + `overflow: hidden`, never `clip-path`,
 * leaving that property free for exactly this kind of consumer override.
 */
@Directive({
  selector: '[crShape]',
  host: {
    class: 'cr-shape',
    '[style.--cr-shape-radius]': 'restRadius()',
    '[style.--cr-shape-hover-radius]': 'hoverRadius()',
    '[style.aspect-ratio]': 'forcesSquareAspect() ? "1" : null',
    '[attr.data-cr-shape-morphs]': 'hover() ? "" : null',
  },
})
export class ShapeDirective {
  readonly shape = input<ShapeKind>('rectangle', { alias: 'crShape' });
  readonly hover = input<ShapeKind | undefined>(undefined, {
    alias: 'crShapeHover',
  });
  /** Corner radius for the 'roundedRectangle' shape only — a radius token
   * name ('regular', 'extraLarge', …) or any raw CSS length / var(). */
  readonly radius = input<ShapeRadius>('regular', {
    alias: 'crShapeRadius',
  });

  protected readonly restRadius = computed(() => this.radiusFor(this.shape()));
  protected readonly hoverRadius = computed(() => {
    const hover = this.hover();
    return hover ? this.radiusFor(hover) : null;
  });

  private resolvedRadius(): string {
    const radius = this.radius();
    return RADIUS_TOKENS[radius] ?? radius;
  }
  protected readonly forcesSquareAspect = computed(() =>
    [this.shape(), this.hover()].some(
      (shape) => shape && SQUARE_ASPECT_SHAPES.has(shape),
    ),
  );

  private radiusFor(shape: ShapeKind): string {
    return FIXED_RADIUS[shape] ?? this.resolvedRadius();
  }
}
