import { describe, expect, it } from 'vitest';
import {
  type MenuBox,
  type MenuGeometryRequest,
  resolveMenuGeometry,
  windowClearOf,
} from './menu-geometry';

/** A phone: 390 × 664 of reachable window, no safe areas. */
const PHONE = { top: 0, left: 0, width: 390, height: 664 };

function request(
  overrides: Partial<MenuGeometryRequest> = {},
): MenuGeometryRequest {
  return {
    anchor: { top: 300, left: 18, width: 355, height: 52 },
    surface: { width: 355, height: 230 },
    window: PHONE,
    placement: 'automatic',
    alignment: 'leading',
    current: null,
    gap: 4,
    gutter: 12,
    minBlock: 160,
    maxFraction: 0.55,
    ...overrides,
  };
}

describe('resolveMenuGeometry', () => {
  it('hangs below the anchor, at its leading edge, when there is room', () => {
    const g = resolveMenuGeometry(request());
    expect(g.side).toBe('bottom');
    expect(g.top).toBe(300 + 52 + 4);
    expect(g.left).toBe(18);
    expect(g.height).toBe(230);
    // The cap is the room below, under the ceiling.
    expect(g.maxBlock).toBe(Math.round(Math.min(664 - 12 - 356, 664 * 0.55)));
  });

  it('flips above when it would not fit below, growing upward from the anchor', () => {
    const g = resolveMenuGeometry(
      request({ anchor: { top: 560, left: 18, width: 355, height: 52 } }),
    );
    expect(g.side).toBe('top');
    expect(g.top).toBe(560 - 4 - 230);
  });

  it('keeps the side it already shows while that side still serves', () => {
    // Room below has shrunk to 240 — the surface (230) still fits, so a
    // menu already below stays below even though above has more room.
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 360, left: 18, width: 355, height: 52 },
        current: 'bottom',
      }),
    );
    expect(g.side).toBe('bottom');
    // …and gives it up only once it cannot fit there at all.
    const moved = resolveMenuGeometry(
      request({
        anchor: { top: 560, left: 18, width: 355, height: 52 },
        current: 'bottom',
      }),
    );
    expect(moved.side).toBe('top');
  });

  it('caps and scrolls a long list on the roomier side rather than growing off the screen', () => {
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 300, left: 18, width: 355, height: 52 },
        surface: { width: 355, height: 900 },
      }),
    );
    // Neither side holds 900px; below has 296, above 284 — below wins, and
    // the cap is the ceiling (55% of the window) or the room, whichever is
    // smaller.
    expect(g.side).toBe('bottom');
    expect(g.maxBlock).toBe(Math.round(Math.min(664 - 12 - 356, 664 * 0.55)));
    expect(g.height).toBe(g.maxBlock);
    expect(g.top + g.height).toBeLessThanOrEqual(664 - 12);
  });

  it('slides into the window instead of shrinking below a readable height', () => {
    // An anchor mid-way down a short window: 64px below, 74px above, and a
    // 120px surface that fits neither. It keeps its height and slides in —
    // over its anchor if it must — rather than becoming a 74px scroller.
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 90, left: 18, width: 355, height: 30 },
        surface: { width: 355, height: 120 },
        window: { top: 0, left: 0, width: 390, height: 200 },
      }),
    );
    expect(g.height).toBe(120);
    expect(g.top).toBeGreaterThanOrEqual(12);
    expect(g.top + g.height).toBeLessThanOrEqual(200 - 12);
    // A window too small even for that pins the surface to the near edge:
    // the edge a thumb can reach, with the stylesheet's own cap for the rest.
    const tiny = resolveMenuGeometry(
      request({
        anchor: { top: 60, left: 18, width: 355, height: 30 },
        surface: { width: 355, height: 120 },
        window: { top: 0, left: 0, width: 390, height: 100 },
      }),
    );
    expect(tiny.top).toBe(12);
  });

  it('keeps a trailing-aligned surface inside a narrow window', () => {
    // A chip at the far right of a 320px phone, a 192px menu: right-aligned
    // it fits; a wider one is pulled back inside the gutter.
    const fits = resolveMenuGeometry(
      request({
        anchor: { top: 200, left: 240, width: 44, height: 36 },
        surface: { width: 192, height: 116 },
        window: { top: 0, left: 0, width: 320, height: 568 },
        alignment: 'trailing',
      }),
    );
    expect(fits.left).toBe(284 - 192);
    const wide = resolveMenuGeometry(
      request({
        anchor: { top: 200, left: 300, width: 16, height: 36 },
        surface: { width: 340, height: 116 },
        window: { top: 0, left: 0, width: 320, height: 568 },
        alignment: 'trailing',
      }),
    );
    expect(wide.width).toBe(320 - 24);
    expect(wide.left).toBe(12);
  });

  it('centres on the anchor and still respects the edges', () => {
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 200, left: 350, width: 30, height: 30 },
        surface: { width: 192, height: 100 },
        alignment: 'center',
      }),
    );
    expect(g.left + g.width).toBeLessThanOrEqual(390 - 12);
  });

  it('stays within a window that has moved and shrunk under a keyboard', () => {
    // iOS: the visual viewport pans 200px down and shrinks to 360px while the
    // anchor stays where the layout viewport left it, half under the keyboard.
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 500, left: 18, width: 355, height: 52 },
        surface: { width: 355, height: 230 },
        window: { top: 200, left: 0, width: 390, height: 360 },
        current: 'bottom',
      }),
    );
    expect(g.top).toBeGreaterThanOrEqual(200 + 12);
    expect(g.top + g.height).toBeLessThanOrEqual(200 + 360 - 12);
  });

  /*
   * ── THE DOCK (2026-10-06) ─────────────────────────────────────────────
   * The block sheet's day pill at 390 × 844: the pill's box 476–520, a
   * 320 × 299 month, the sheet's «Запази» bar from 776 down. The surface
   * fitted "below" by the window (308 of room) and landed under the bar —
   * its last week of days behind the button. With the floor raised to the
   * dock the room below is 240, the month flips above the pill and ends
   * well clear of the bar.
   */
  describe('with a docked bar', () => {
    const pill = { top: 476, left: 184, width: 131, height: 44 };
    const month = { width: 320, height: 299 };
    const bar: MenuBox = { top: 776, left: 0, width: 390, height: 68 };
    const phone = { top: 0, left: 0, width: 390, height: 844 };

    it('raises the window’s floor to the dock’s top', () => {
      expect(windowClearOf(phone, [bar], 160)).toEqual({
        ...phone,
        height: 776,
      });
    });

    it('flips the surface above the anchor once the room below is the room above the dock', () => {
      const under = resolveMenuGeometry(
        request({ anchor: pill, surface: month, window: phone }),
      );
      expect(under.side).toBe('bottom');
      expect(under.top + under.height).toBeGreaterThan(bar.top);

      const clear = resolveMenuGeometry(
        request({
          anchor: pill,
          surface: month,
          window: windowClearOf(phone, [bar], 160),
        }),
      );
      expect(clear.side).toBe('top');
      expect(clear.top).toBe(476 - 4 - 299);
      expect(clear.top + clear.height).toBeLessThanOrEqual(bar.top);
    });

    it('ignores a dock wholly outside the window, and one that would leave no room', () => {
      // Slid out by its own height — a dock yielding to a stacked sheet.
      expect(windowClearOf(phone, [{ ...bar, top: 844 }], 160).height).toBe(
        844,
      );
      // Above the window: a bar the viewport has panned past.
      expect(windowClearOf({ ...phone, top: 900 }, [bar], 160).height).toBe(
        844,
      );
      // A bar so high that less than a readable surface would be left.
      expect(windowClearOf(phone, [{ ...bar, top: 100 }], 160).height).toBe(
        844,
      );
      // A bar that is not drawn at all.
      expect(windowClearOf(phone, [{ ...bar, height: 0 }], 160).height).toBe(
        844,
      );
    });

    it('takes the highest of several bars that reach into the window', () => {
      const lower = { ...bar, top: 800 };
      expect(windowClearOf(phone, [lower, bar], 160).height).toBe(776);
    });
  });

  it('honours a fixed placement whatever the room', () => {
    const g = resolveMenuGeometry(
      request({
        anchor: { top: 620, left: 18, width: 355, height: 40 },
        placement: 'bottom',
      }),
    );
    expect(g.side).toBe('bottom');
    // …but is still shifted inside the window rather than falling off it.
    expect(g.top + g.height).toBeLessThanOrEqual(664 - 12);
  });
});
