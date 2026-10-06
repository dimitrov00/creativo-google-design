import { nearestScroller } from './nearest-scroller';

/**
 * One element per overflow asked for: a TUPLE as long as the arguments, so
 * a case that destructures it holds elements, never `| undefined` (the
 * workspace checks indexed access).
 */
type Nested<Overflows extends readonly unknown[]> = {
  readonly [Index in keyof Overflows]: HTMLElement;
};

/**
 * A plain DOM walk, so the cases build plain DOM: no component, no
 * TestBed. Every tree hangs off one root that the case's end removes.
 */
describe('nearestScroller', () => {
  let root: HTMLElement;

  /** `<div>`s nested outermost first; returns them in that order. */
  const nest = <const Overflows extends readonly (string | null)[]>(
    ...overflows: Overflows
  ): Nested<Overflows> => {
    const nodes: HTMLElement[] = [];
    let parent = root;
    for (const overflow of overflows) {
      const node = document.createElement('div');
      if (overflow !== null) node.style.overflowY = overflow;
      parent.append(node);
      nodes.push(node);
      parent = node;
    }
    return nodes as Nested<Overflows>;
  };

  beforeEach(() => {
    root = document.createElement('section');
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
  });

  it.each(['auto', 'scroll'])(
    'returns the parent whose overflow-y is %s',
    (overflow) => {
      const [scroller, child] = nest(overflow, null);
      expect(nearestScroller(child)).toBe(scroller);
    },
  );

  it('walks past ancestors that do not scroll', () => {
    const [scroller, , , leaf] = nest('auto', null, null, null);
    expect(nearestScroller(leaf)).toBe(scroller);
  });

  it('returns the NEAREST of two scrollers, never the outer one', () => {
    const [outer, inner, leaf] = nest('scroll', 'auto', null);
    expect(nearestScroller(leaf)).toBe(inner);
    expect(nearestScroller(leaf)).not.toBe(outer);
  });

  it.each(['hidden', 'clip', 'visible'])(
    'does not take overflow-y: %s for a scroller',
    (overflow) => {
      const [scroller, , leaf] = nest('auto', overflow, null);
      expect(nearestScroller(leaf)).toBe(scroller);
    },
  );

  it('never returns the element it was asked about', () => {
    const [outer, self] = nest('auto', 'auto');
    expect(nearestScroller(self)).toBe(outer);
  });

  it('answers null when nothing above scrolls: the page does', () => {
    const [, leaf] = nest(null, null);
    expect(nearestScroller(leaf)).toBeNull();
  });

  it('answers null for an element that is in no document', () => {
    expect(nearestScroller(document.createElement('div'))).toBeNull();
  });

  it('reads the COMPUTED value, so a stylesheet rule counts', () => {
    const sheet = document.createElement('style');
    sheet.textContent = '.k2-scrolls { overflow-y: auto; }';
    document.head.append(sheet);
    try {
      const [scroller, leaf] = nest(null, null);
      scroller.className = 'k2-scrolls';
      expect(nearestScroller(leaf)).toBe(scroller);
    } finally {
      sheet.remove();
    }
  });

  it('reads the block axis alone: overflow-x does not make a scroller', () => {
    const [rail, leaf] = nest(null, null);
    rail.style.overflowX = 'auto';
    // The platform computes `visible` beside a scrolling axis to `auto`;
    // a rail that says `overflow-y: hidden` (the house scroll row) stays out.
    rail.style.overflowY = 'hidden';
    expect(nearestScroller(leaf)).toBeNull();
  });

  it('takes an SVG element and returns the HTML scroller round it', () => {
    const [scroller, holder] = nest('auto', null);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const circle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle',
    );
    svg.append(circle);
    holder.append(svg);
    expect(nearestScroller(circle)).toBe(scroller);
  });
});
