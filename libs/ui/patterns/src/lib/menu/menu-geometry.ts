/**
 * WHERE A MENU LANDS — pure arithmetic, no DOM.
 *
 * Every box here is in the LAYOUT viewport's coordinate space: the space
 * `getBoundingClientRect()` reports in and the one `position: fixed` is laid
 * out in, so what is measured can be written back without conversion. The
 * `window` is the part of that space a finger can actually reach — the
 * visual viewport (which shrinks under a keyboard and pans under a zoom)
 * less the safe areas — and the surface is kept inside it whatever the
 * anchor does.
 *
 * Kept free of the component so it can be reasoned about and tested as
 * numbers: a menu that flips, sticks, shifts and caps is a set of rules,
 * and rules belong somewhere they can be read in one sitting.
 */

export interface MenuBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type MenuSide = 'bottom' | 'top';
export type MenuAlignmentKind = 'leading' | 'trailing' | 'center';

export interface MenuGeometryRequest {
  /** The trigger's box. */
  readonly anchor: MenuBox;
  /** The surface's NATURAL size — uncapped, as it would be with room to spare. */
  readonly surface: { readonly width: number; readonly height: number };
  /** The reachable part of the viewport: visual viewport less safe areas. */
  readonly window: MenuBox;
  readonly placement: 'automatic' | MenuSide;
  readonly alignment: MenuAlignmentKind;
  /**
   * The side chosen earlier in THIS presentation, or `null` on open.
   *
   * A menu keeps its side while it still serves: re-deciding on every scroll
   * or resize is what made a menu jump from under its trigger to over it as
   * a toolbar collapsed or a keyboard rose. It gives the side up only when
   * the surface can no longer fit there at all.
   */
  readonly current: MenuSide | null;
  /** Breathing room between anchor and surface. */
  readonly gap: number;
  /** Breathing room between surface and the window's edge. */
  readonly gutter: number;
  /**
   * Below this the surface is not capped but SHIFTED: a two-row menu
   * squeezed into forty pixels is not more usable for being scrollable, it
   * is unreadable, so it keeps this much height and slides into the window
   * instead — over its anchor if it must.
   */
  readonly minBlock: number;
  /**
   * The most of the window's height a menu may take. Past this it stops
   * reading as a popover over the page and starts reading as a sheet that
   * replaced it.
   */
  readonly maxFraction: number;
}

export interface MenuGeometry {
  readonly side: MenuSide;
  /** Fixed coordinates, layout-viewport space, whole pixels. */
  readonly top: number;
  readonly left: number;
  /** What the stylesheet applies as `max-block-size`. */
  readonly maxBlock: number;
  /** The height and width the surface takes under that cap. */
  readonly height: number;
  readonly width: number;
}

export function resolveMenuGeometry(
  request: MenuGeometryRequest,
): MenuGeometry {
  const { anchor, surface, window, gap, gutter, minBlock } = request;
  const windowBottom = window.top + window.height;
  const windowRight = window.left + window.width;
  const anchorBottom = anchor.top + anchor.height;
  const anchorRight = anchor.left + anchor.width;

  const roomBelow = windowBottom - gutter - (anchorBottom + gap);
  const roomAbove = anchor.top - gap - (window.top + gutter);
  // A share of the window, never the whole of it — and never so little
  // that the floor below has nothing to stand on.
  const ceiling = Math.max(
    minBlock,
    Math.min(window.height * request.maxFraction, window.height - 2 * gutter),
  );
  const roomOn = (side: MenuSide): number =>
    side === 'bottom' ? roomBelow : roomAbove;
  const fitsOn = (side: MenuSide): boolean =>
    surface.height <= Math.min(roomOn(side), ceiling);

  const side = chooseSide(request, fitsOn, roomOn);
  const maxBlock = Math.min(Math.max(roomOn(side), minBlock), ceiling);
  const height = Math.min(surface.height, maxBlock);
  const width = Math.min(surface.width, Math.max(0, window.width - 2 * gutter));

  const top = shift(
    side === 'bottom' ? anchorBottom + gap : anchor.top - gap - height,
    height,
    window.top + gutter,
    windowBottom - gutter,
  );
  const left = shift(
    request.alignment === 'trailing'
      ? anchorRight - width
      : request.alignment === 'center'
        ? anchor.left + anchor.width / 2 - width / 2
        : anchor.left,
    width,
    window.left + gutter,
    windowRight - gutter,
  );

  return {
    side,
    top: Math.round(top),
    left: Math.round(left),
    maxBlock: Math.round(maxBlock),
    height: Math.round(height),
    width: Math.round(width),
  };
}

/**
 * Which side: the one asked for; else the one already shown while the
 * surface still fits there; else the first side it fits on, below before
 * above; else — nothing fits without scrolling — the side already shown if
 * it holds a readable menu, else whichever side has more room.
 */
function chooseSide(
  request: MenuGeometryRequest,
  fitsOn: (side: MenuSide) => boolean,
  roomOn: (side: MenuSide) => number,
): MenuSide {
  if (request.placement !== 'automatic') return request.placement;
  const { current } = request;
  if (current !== null && fitsOn(current)) return current;
  if (fitsOn('bottom')) return 'bottom';
  if (fitsOn('top')) return 'top';
  if (current !== null && roomOn(current) >= request.minBlock) return current;
  return roomOn('top') > roomOn('bottom') ? 'top' : 'bottom';
}

/**
 * Keep `[start, start + size]` inside `[min, max]` by sliding it, never by
 * cutting it. A box too big for the span pins to `min`: the near edge is
 * the one a thumb can reach and the stylesheet's own cap handles the rest.
 */
function shift(start: number, size: number, min: number, max: number): number {
  const last = max - size;
  if (last < min) return min;
  return Math.min(Math.max(start, min), last);
}
