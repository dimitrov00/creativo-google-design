import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDGE_SCROLL_MARGIN_PX,
  EDGE_SCROLL_MAX_PX_PER_FRAME,
  EdgeScroller,
  edgeScrollVelocity,
} from './grid-gesture';

describe('edge auto-scroll', () => {
  it('rests inside the box, hurries towards an edge, and keeps going past it', () => {
    // A 200px box from 0 to 200.
    expect(edgeScrollVelocity(100, 0, 200)).toBe(0);
    // Inside the margin the pace grows with the overlap…
    expect(edgeScrollVelocity(200 - EDGE_SCROLL_MARGIN_PX / 2, 0, 200)).toBe(
      EDGE_SCROLL_MAX_PX_PER_FRAME / 2,
    );
    // …to the cap at the very edge, signed towards it.
    expect(edgeScrollVelocity(200, 0, 200)).toBe(EDGE_SCROLL_MAX_PX_PER_FRAME);
    expect(edgeScrollVelocity(0, 0, 200)).toBe(-EDGE_SCROLL_MAX_PX_PER_FRAME);
    // Past the box: the full pace in that direction, for as long as the
    // pointer stays out there (owner, 2026-09-10 — reversing 2026-09-04).
    expect(edgeScrollVelocity(250, 0, 200)).toBe(EDGE_SCROLL_MAX_PX_PER_FRAME);
    expect(edgeScrollVelocity(-40, 0, 200)).toBe(-EDGE_SCROLL_MAX_PX_PER_FRAME);
  });

  describe('the loop', () => {
    const frames: FrameRequestCallback[] = [];
    afterEach(() => {
      vi.unstubAllGlobals();
      frames.length = 0;
    });

    function frame() {
      const box = {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 1000,
        clientHeight: 200,
        scrollWidth: 0,
        clientWidth: 0,
        getBoundingClientRect: () => ({
          top: 0,
          bottom: 200,
          left: 0,
          right: 0,
        }),
      };
      return box as unknown as HTMLElement;
    }

    function tick(): void {
      const next = frames.shift();
      next?.(0);
    }

    it('keeps scrolling while the pointer rests at the edge, and tells the surface each time', () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const box = frame();
      const told: number[] = [];
      const edge = new EdgeScroller(
        'y',
        () => box,
        () => told.push(box.scrollTop),
      );
      // The finger rests 4px above the bottom edge: nearly the full pace.
      edge.update(196);
      tick();
      tick();
      tick();
      expect(box.scrollTop).toBeGreaterThan(0);
      expect(told.length).toBeGreaterThan(0);
      const after = box.scrollTop;
      // Back to the middle: the loop rests, and nothing more scrolls.
      edge.update(100);
      tick();
      tick();
      expect(box.scrollTop).toBe(after);
      expect(frames).toHaveLength(0);
      // Past the box entirely: the full pace, frame after frame.
      edge.update(400);
      tick();
      tick();
      expect(box.scrollTop).toBe(after + 2 * EDGE_SCROLL_MAX_PX_PER_FRAME);
    });

    it('stops at the end of the day rather than asking for more', () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const box = frame();
      box.scrollTop = 800;
      const edge = new EdgeScroller(
        'y',
        () => box,
        () => undefined,
      );
      edge.update(200);
      for (let i = 0; i < 6; i += 1) tick();
      expect(box.scrollTop).toBe(800);
      expect(frames).toHaveLength(0);
    });
  });
});
