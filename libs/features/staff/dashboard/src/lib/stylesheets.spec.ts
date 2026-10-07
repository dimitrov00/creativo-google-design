import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE SPLIT STYLESHEETS' CASCADE, HELD BY CI.
 *
 * Every stylesheet split in this feature (the component-style budget's, most
 * on 2026-09-26) is "in the file, not in the cascade": one sheet cut at
 * chapter boundaries into several, each listed directly after the one it
 * continues, so every rule lands in the document in exactly the order the
 * one file gave it. Nothing but the ORDER of a `styleUrls` array keeps that
 * true — reorder two entries and rules that share an element and a property
 * silently swap winners.
 *
 * The visit editor adds a second dependency: the block sheet loads the same
 * three shared sheets, and Angular adds a component's sheets together, in list
 * order, keeping one copy of a sheet two components share. The shared run
 * lands in one order whichever sheet opens first ONLY while the block sheet's
 * list is a prefix of the visit editor's.
 *
 * Read from disk rather than from compiled metadata: `styleUrls` is gone by the
 * time a component is compiled, and the order written in the source is the
 * order the builder keeps.
 */

const LIB = __dirname;

/** A file of this feature, by its path under `src/lib` — the spec reads nothing else. */
function read(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths come from listing this lib's own directory.
  return readFileSync(resolve(LIB, path), 'utf8');
}

/** Every file of this feature, as paths under `src/lib`. */
function files(): string[] {
  return readdirSync(LIB, { recursive: true }).map(String);
}

/** Every component in the feature that declares stylesheets → its `styleUrls`. */
function components(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const path of files()) {
    if (!path.endsWith('.ts') || path.endsWith('.spec.ts')) continue;
    const source = read(path);
    if (/\bstyleUrls?\s*:/.test(source)) {
      found.set(path, styleUrlsOf(path, source));
    }
  }
  return found;
}

/** A component's stylesheets, in declaration order, as paths under `src/lib`. */
function styleUrlsOf(componentPath: string, source: string): string[] {
  const lists = [...source.matchAll(/\bstyleUrls\s*:\s*\[([^\]]*)\]/g)];
  const single = [...source.matchAll(/\bstyleUrl\s*:\s*'([^']+)'/g)];
  expect(
    lists.length + single.length,
    `${componentPath} declares its stylesheets exactly once`,
  ).toBe(1);
  const urls =
    lists.length === 1
      ? [...(lists[0]?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
      : [single[0]?.[1] ?? ''];
  return urls.map((url) =>
    relative(LIB, resolve(LIB, dirname(componentPath), url)),
  );
}

function styleUrls(componentPath: string): string[] {
  return styleUrlsOf(componentPath, read(componentPath));
}

const VISIT_EDITOR = 'visit-editor/staff-visit-editor.ts';
const BLOCK_EDITOR = 'block-editor/staff-block-editor.ts';

const MAIN = 'visit-editor/staff-visit-editor.css';
const SECTIONS = 'visit-editor/staff-visit-editor.sections.css';
const ROWS = 'visit-editor/staff-visit-editor.rows.css';
const VISIT_ONLY = 'visit-editor/staff-visit-editor.visit.css';

describe('the visit editor split (shared with the block sheet)', () => {
  it("keeps the block sheet's styleUrls a prefix of the visit editor's", () => {
    const block = styleUrls(BLOCK_EDITOR);
    const visit = styleUrls(VISIT_EDITOR);

    expect(block.length).toBeGreaterThan(0);
    expect(visit.length).toBeGreaterThan(block.length);
    expect(visit.slice(0, block.length)).toEqual(block);
  });

  it('lists the shared sheets main, sections, rows — in that order, in both', () => {
    expect(styleUrls(BLOCK_EDITOR)).toEqual([MAIN, SECTIONS, ROWS]);
    expect(styleUrls(VISIT_EDITOR).slice(0, 3)).toEqual([MAIN, SECTIONS, ROWS]);
  });

  it("loads the visit's own sheet last, right after the shared run", () => {
    expect(styleUrls(VISIT_EDITOR)).toEqual([MAIN, SECTIONS, ROWS, VISIT_ONLY]);
  });
});

/**
 * Each split family, in the one file's order. Every component that loads a
 * family must list it contiguously and in this order.
 */
const FAMILIES: readonly (readonly string[])[] = [
  [MAIN, SECTIONS, ROWS, VISIT_ONLY],
  [
    'time-grid/staff-time-grid.css',
    'time-grid/staff-time-grid.block.css',
    'time-grid/staff-time-grid.state.css',
    'time-grid/staff-time-grid.page.css',
  ],
  ['timeline/staff-timeline.css', 'timeline/staff-timeline.band.css'],
  [
    'staff-dashboard/staff-dashboard.css',
    'staff-dashboard/staff-dashboard.chrome.css',
  ],
];

describe('every split family keeps the one file’s order', () => {
  it('finds the components that load the split families', () => {
    const loaders = [...components()]
      .filter(([, urls]) =>
        FAMILIES.some((family) => urls.some((url) => family.includes(url))),
      )
      .map(([path]) => path);
    expect(loaders.sort()).toEqual(
      [
        BLOCK_EDITOR,
        VISIT_EDITOR,
        'staff-dashboard/staff-dashboard.ts',
        'time-grid/staff-time-grid.ts',
        'timeline/staff-timeline.ts',
      ].sort(),
    );
  });

  for (const family of FAMILIES) {
    it(`${basename(family[0] ?? '')} and its continuations stay contiguous and in order`, () => {
      for (const [path, urls] of components()) {
        const loaded = urls.filter((url) => family.includes(url));
        if (loaded.length === 0) continue;

        // What a component loads of a family is a leading run of it: a
        // continuation never loads without the sheets it continues.
        expect(loaded, path).toEqual(family.slice(0, loaded.length));
        // …and the run is unbroken: no other sheet lands in the middle.
        const start = urls.indexOf(loaded[0] ?? '');
        expect(urls.slice(start, start + loaded.length), path).toEqual(loaded);
      }
    });
  }
});

describe("the split headers' own claims", () => {
  /**
   * Each continuation's header says which sheet it is "listed directly after".
   * The claim is only as good as the arrays — so the arrays are held to it.
   */
  function claims(): Map<string, string> {
    const found = new Map<string, string>();
    for (const path of files()) {
      if (!path.endsWith('.css')) continue;
      const css = read(path);
      const claim = /listed directly after\s+`([^`]+)`/.exec(css);
      if (claim?.[1]) found.set(path, claim[1]);
    }
    return found;
  }

  it('finds every continuation that states its predecessor', () => {
    expect([...claims().keys()].sort()).toEqual(
      [
        SECTIONS,
        ROWS,
        'time-grid/staff-time-grid.block.css',
        'time-grid/staff-time-grid.state.css',
        'timeline/staff-timeline.band.css',
        'staff-dashboard/staff-dashboard.chrome.css',
      ].sort(),
    );
  });

  it('holds wherever the sheet is loaded', () => {
    const all = components();
    for (const [sheet, predecessor] of claims()) {
      let loaders = 0;
      for (const [path, urls] of all) {
        const at = urls.indexOf(sheet);
        if (at === -1) continue;
        loaders += 1;
        expect(
          basename(urls[at - 1] ?? '(nothing)'),
          `${path}: ${basename(sheet)} directly after ${predecessor}`,
        ).toBe(predecessor);
      }
      expect(loaders, `${sheet} is loaded somewhere`).toBeGreaterThan(0);
    }
  });
});

describe('rule order a sheet states about itself', () => {
  const STATE = 'time-grid/staff-time-grid.state.css';
  const TIME_GRID = 'time-grid/staff-time-grid.ts';

  /** Every "DECLARED AFTER `x`" a sheet of this feature states. */
  function declaredAfter(): string[] {
    return files()
      .filter((path) => path.endsWith('.css'))
      .flatMap((path) =>
        [...read(path).matchAll(/DECLARED AFTER\s+`([^`]+)`/g)].map(
          (claim) => `${path} → ${claim[1] ?? ''}`,
        ),
      );
  }

  /** Where each top-level rule for exactly `selector` starts in `css`. */
  function topLevelRules(css: string, selector: string): number[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- escaped selector literals from this spec.
    const rule = new RegExp(`^${escaped}\\s*\\{`, 'gm');
    return [...css.matchAll(rule)].map((match) => match.index ?? -1);
  }

  it('finds every such claim — each one is checked below', () => {
    // The chapter's own comment, and the split header repeating it.
    expect(declaredAfter()).toEqual([
      `${STATE} → :active`,
      `${STATE} → :active`,
    ]);
  });

  it('declares the lift after every press-down it must beat, as the document gets them', () => {
    // Same selector weight, both matching while a finger is down: only source
    // order makes the lift's scale win over the press's. Read in the order
    // the time grid lists its sheets, so a move to a later sheet counts too.
    const css = styleUrls(TIME_GRID).map(read).join('\n');
    const press = topLevelRules(css, '.staff-grid__event:active');
    const lift = topLevelRules(css, '.staff-grid__event[data-moving]');

    expect(press.length).toBeGreaterThan(0);
    expect(lift.length).toBeGreaterThan(0);
    expect(Math.max(...press)).toBeLessThan(Math.min(...lift));
    // …and it lives in the sheet whose header makes the claim.
    expect(
      topLevelRules(read(STATE), '.staff-grid__event[data-moving]'),
    ).toHaveLength(lift.length);
  });
});
