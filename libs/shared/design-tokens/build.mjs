#!/usr/bin/env node
/**
 * Style Dictionary build for the design-token pipeline.
 *
 * Produces:
 *  - generated/css/tokens.css   (:root)              — theme-independent primitives
 *  - generated/css/light.css    (:root, [data-theme="light"])
 *  - generated/css/dark.css     ([data-theme="dark"])
 *  - generated/scss/_tokens.scss                      — documentation/reference only
 *  - generated/ts/core.ts, generated/ts/color.ts       — typed `var(--...)` reference exports
 *
 * Deliberately does NOT emit the raw color ramps (color.brand.*,
 * color.neutral.*, color.analogousRamp*.*) as public CSS custom properties —
 * only the semantic aliases (color.background, color.accent, ...) are part
 * of the public token API, so rebranding only ever means editing
 * tokens/semantic/*.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import StyleDictionary from 'style-dictionary';
import { formats, transformGroups, transforms } from 'style-dictionary/enums';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...segments) => resolve(__dirname, ...segments);

/**
 * Wraps a generated CSS file's rule block(s) in `@layer <layerName>`, in
 * place, after Style Dictionary has written it — so the file's `:root` /
 * `[data-theme]` selectors and values are untouched, only the layer
 * membership changes. Declaring the full layer order once
 * (`apps/showcase/src/styles.css`) means this repo's cascade — tokens < reset
 * < base < components < utilities — stays predictable regardless of source
 * order.
 */
// Maps 1:1 to the --cr-alpha-1..5 core tokens (tokens/core/surface-alpha.json).
const ELEVATION_STEPS = [1, 2, 3, 4, 5];

/**
 * Appends --cr-color-surface-1..5 right before a theme file's closing
 * brace — computed, not hand-authored. The two themes now derive these
 * DIFFERENTLY, per docs/design-research/elevation-surface-case-study.md:
 *
 * - Dark theme (tinted: true): color-mix() expressions, same as before —
 *   each tier mixes from the flat --cr-color-surface-plain base (not from
 *   the previous tier), so nothing compounds the way live alpha-overlay
 *   elevation does; the browser resolves these to fully opaque colors once
 *   --cr-color-surface-tint/--cr-color-surface-plain/--cr-alpha-* are known.
 *   Validated by research: Material 2/Atlassian's dark-mode rationale
 *   (shadows barely register against a dark base, so lighten the surface
 *   instead) plus this repo's own color-mix bake sidesteps the exact
 *   live-overlay-compounding problem Material 3 cited when it dropped this
 *   technique. surface-plain equals surface (not background) in dark
 *   theme, so this is numerically identical to mixing from surface, as
 *   before.
 * - Light theme (tinted: false): flat aliases to --cr-color-surface-plain,
 *   which equals `background` in light theme — a card/material at rest is
 *   flush with the page, not a separate grey tone (see semantic/light.json's
 *   surface-plain description; this was the actual bug behind cards reading
 *   as "grey against a white page" even after mixing was removed, because
 *   they were still aliasing the tinted --cr-color-surface, not the plain
 *   background). Elevation is communicated by --cr-shadow-N alone (see
 *   card.css), matching Material 2's own spec (shadow is the documented
 *   default; background-tint-only is flagged "Caution"). An earlier version
 *   of this file tried flat-but-still-grey surfaces and reverted it because
 *   cards read as "a static grey box sinking into the white page" — that
 *   regression was real, but it conflated "flat" with "still tinted grey";
 *   tokens/core/elevation.json's tiers 1-2 were also strengthened to carry
 *   elevation alone. Re-test visually if this ever regresses again.
 */
function appendDerivedSurfaceTokens(relativePath, tinted) {
  const filePath = src(relativePath);
  const content = readFileSync(filePath, 'utf8');
  const closingBrace = content.lastIndexOf('}');
  const derivedLines = ELEVATION_STEPS.map((n) =>
    tinted
      ? `  --cr-color-surface-${n}: color-mix(in srgb, var(--cr-color-surface-tint) var(--cr-alpha-${n}), var(--cr-color-surface-plain));`
      : `  --cr-color-surface-${n}: var(--cr-color-surface-plain);`,
  ).join('\n');
  writeFileSync(
    filePath,
    `${content.slice(0, closingBrace)}${derivedLines}\n}${content.slice(closingBrace + 1)}`,
  );
}

function wrapInLayer(relativePath, layerName) {
  const filePath = src(relativePath);
  const content = readFileSync(filePath, 'utf8');
  const headerEnd = content.indexOf('*/') + 2;
  const header = content.slice(0, headerEnd);
  const body = content.slice(headerEnd).trim().replace(/^/gm, '  ');
  writeFileSync(filePath, `${header}\n\n@layer ${layerName} {\n${body}\n}\n`);
}

const PREFIX = 'cr';
const STATIC_CORE_SOURCES = [
  src('tokens/core/spacing.json'),
  src('tokens/core/typography.json'),
  src('tokens/core/radius.json'),
  src('tokens/core/elevation.json'),
  src('tokens/core/motion.json'),
  src('tokens/core/border.json'),
  src('tokens/core/surface-alpha.json'),
  src('tokens/core/material.json'),
];

/**
 * The five --cr-material-* tint tiers (SwiftUI/UIKit's Materials scale:
 * none/ultra-thin/thin/regular/thick/ultra-thick) are appended directly
 * rather than authored as Style Dictionary $values because each is a
 * `hsl(from var(--cr-color-surface-tint) h s l / alpha%)` FORMULA, not a
 * fixed color — it must keep referencing --cr-color-surface-tint as a
 * live var() so it resolves against whichever [data-theme] is active,
 * exactly like the --cr-color-surface-N formulas in
 * appendDerivedSurfaceTokens. Defined once in the theme-independent
 * tokens.css (unlike surface-N, which is per-theme) because the formula
 * text itself never differs between themes — only its resolved value does,
 * at render time. See docs/design-research/design-system-proposal.md §5.5.
 */
function appendMaterialTintTokens(relativePath) {
  const filePath = src(relativePath);
  const content = readFileSync(filePath, 'utf8');
  const closingBrace = content.lastIndexOf('}');
  const tints = [
    ['none', 'none'],
    ['ultra-thin', '20%'],
    ['thin', '40%'],
    ['regular', '60%'],
    ['thick', '80%'],
    ['ultra-thick', '92%'],
  ];
  const derivedLines = tints
    .map(([name, alpha]) =>
      name === 'none'
        ? `  --cr-material-${name}: none;`
        : `  --cr-material-${name}: hsl(from var(--cr-color-surface-tint) h s l / ${alpha});`,
    )
    .join('\n');
  writeFileSync(
    filePath,
    `${content.slice(0, closingBrace)}${derivedLines}\n}${content.slice(closingBrace + 1)}`,
  );
}

function toPascalSegment(segment) {
  return segment
    .replace(/[-_]+(\w)/g, (_, char) => char.toUpperCase())
    .replace(/^\w/, (char) => char.toUpperCase());
}

function toCamelIdentifier(path) {
  const pascal = path.map(toPascalSegment).join('');
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toCamelSegment(segment) {
  return segment.replace(/[-_]+(\w)/g, (_, char) => char.toUpperCase());
}

/**
 * Collapses numbered sibling keys (e.g. analogous0/analogous1/analogous2)
 * into a single array-valued key (analogous: [...]) when their numeric
 * suffixes form a contiguous 0..N-1 run — mirrors how
 * tokens/semantic/*.json's color.analogous-0..2 reads as one family, not
 * three unrelated tokens. Generic by design so any future similarly-shaped
 * token family (not just analogous) collapses the same way. Mutates `node`
 * in place, recursively.
 */
function collapseNumberedSiblings(node) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return;
  }
  const groups = new Map();
  for (const key of Object.keys(node)) {
    const match = /^([a-zA-Z]+)(\d+)$/.exec(key);
    if (!match) continue;
    const [, prefix, num] = match;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push({ key, num: Number(num) });
  }
  for (const [prefix, entries] of groups) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.num - b.num);
    const isContiguousFromZero = entries.every((entry, i) => entry.num === i);
    if (!isContiguousFromZero) continue;
    node[prefix] = entries.map((entry) => node[entry.key]);
    for (const entry of entries) delete node[entry.key];
  }
  for (const value of Object.values(node)) {
    collapseNumberedSiblings(value);
  }
}

function isBareObjectKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || /^(0|[1-9]\d*)$/.test(key);
}

/** Serializes a plain object/array/string tree (built by the nested TS format below) into TS object-literal source. */
function serializeVars(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => `${pad}  ${serializeVars(item, indent + 2)}`)
      .join(',\n');
    return `[\n${items},\n${pad}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .map(([key, val]) => {
        const propertyKey = isBareObjectKey(key) ? key : `'${key}'`;
        return `${pad}  ${propertyKey}: ${serializeVars(val, indent + 2)}`;
      })
      .join(',\n');
    return `{\n${entries},\n${pad}}`;
  }
  return `'${value}'`;
}

StyleDictionary.registerTransformGroup({
  name: 'ts-var-refs',
  transforms: [transforms.attributeCti, transforms.nameKebab],
});

StyleDictionary.registerFormat({
  name: 'typescript/css-var-refs',
  format: ({ dictionary }) => {
    const lines = dictionary.allTokens
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (token) =>
          `export const ${toCamelIdentifier(token.path)} = 'var(--${token.name})';`,
      );
    return [
      '// AUTO-GENERATED by libs/shared/design-tokens/build.mjs — do not edit by hand.',
      '',
      ...lines,
      '',
    ].join('\n');
  },
});

/**
 * Companion to `typescript/css-var-refs` above: same var()-reference
 * values, but grouped into a nested object via each token's own `path`
 * (rather than flattened into one camelCase identifier per token), giving
 * `vars.color.background` / `vars.space[4]` ergonomics. See generated/ts/
 * vars-core.ts, vars-color.ts, and the vars.ts barrel that merges them —
 * docs/design-research/design-system-proposal.md §4.1.
 */
StyleDictionary.registerFormat({
  name: 'typescript/css-var-refs-nested',
  format: ({ dictionary, options }) => {
    const tree = {};
    for (const token of dictionary.allTokens) {
      const segments = token.path.map(toCamelSegment);
      let node = tree;
      for (let i = 0; i < segments.length - 1; i++) {
        node[segments[i]] = node[segments[i]] ?? {};
        node = node[segments[i]];
      }
      node[segments[segments.length - 1]] = `var(--${token.name})`;
    }
    collapseNumberedSiblings(tree);
    return [
      '// AUTO-GENERATED by libs/shared/design-tokens/build.mjs — do not edit by hand.',
      '',
      `export const ${options.exportName} = ${serializeVars(tree, 0)} as const;`,
      '',
    ].join('\n');
  },
});

async function buildStaticTokens() {
  const sd = new StyleDictionary({
    source: STATIC_CORE_SOURCES,
    platforms: {
      css: {
        transformGroup: transformGroups.css,
        prefix: PREFIX,
        buildPath: 'generated/css/',
        files: [
          {
            destination: 'tokens.css',
            format: formats.cssVariables,
            options: { selector: ':root' },
          },
        ],
      },
      ts: {
        transformGroup: 'ts-var-refs',
        prefix: PREFIX,
        buildPath: 'generated/ts/',
        files: [
          { destination: 'core.ts', format: 'typescript/css-var-refs' },
          {
            destination: 'vars-core.ts',
            format: 'typescript/css-var-refs-nested',
            options: { exportName: 'varsCore' },
          },
        ],
      },
    },
  });
  await sd.buildAllPlatforms();
}

async function buildThemeCss(theme) {
  const isLight = theme === 'light';
  const sd = new StyleDictionary({
    source: [
      src('tokens/core/color.json'),
      src(`tokens/semantic/${theme}.json`),
    ],
    platforms: {
      css: {
        transformGroup: transformGroups.css,
        prefix: PREFIX,
        buildPath: 'generated/css/',
        files: [
          {
            destination: `${theme}.css`,
            format: formats.cssVariables,
            filter: (token) =>
              token.filePath.endsWith(`semantic/${theme}.json`),
            options: {
              selector: isLight
                ? ':root, [data-theme="light"]'
                : '[data-theme="dark"]',
            },
          },
        ],
      },
      ...(isLight
        ? {
            ts: {
              transformGroup: 'ts-var-refs',
              prefix: PREFIX,
              buildPath: 'generated/ts/',
              files: [
                {
                  destination: 'color.ts',
                  format: 'typescript/css-var-refs',
                  filter: (token) =>
                    token.filePath.endsWith('semantic/light.json'),
                },
                {
                  destination: 'vars-color.ts',
                  format: 'typescript/css-var-refs-nested',
                  filter: (token) =>
                    token.filePath.endsWith('semantic/light.json'),
                  options: { exportName: 'varsColor' },
                },
              ],
            },
          }
        : {}),
    },
  });
  await sd.buildAllPlatforms();
}

async function buildScssReference() {
  const sd = new StyleDictionary({
    source: [
      ...STATIC_CORE_SOURCES,
      src('tokens/core/color.json'),
      src('tokens/semantic/light.json'),
    ],
    platforms: {
      scss: {
        transformGroup: transformGroups.scss,
        prefix: PREFIX,
        buildPath: 'generated/scss/',
        files: [
          {
            destination: '_tokens.scss',
            format: formats.scssVariables,
            filter: (token) => !token.filePath.endsWith('core/color.json'),
          },
        ],
      },
    },
  });
  await sd.buildAllPlatforms();
}

/**
 * `vars-core.ts`/`vars-color.ts` are each a partial nested object (static
 * tokens vs. light-theme color aliases respectively — see the two `ts`
 * platforms above). This barrel merges them with a plain shallow spread
 * (safe: their top-level keys never collide — color vs. space/font/radius/
 * etc.) rather than re-merging inside build.mjs itself, per
 * docs/design-research/design-system-proposal.md §4.1's lower-risk
 * "hand-written barrel" option.
 */
function writeVarsBarrel() {
  writeFileSync(
    src('generated/ts/vars.ts'),
    [
      '// AUTO-GENERATED by libs/shared/design-tokens/build.mjs — do not edit by hand.',
      '',
      "import { varsCore } from './vars-core';",
      "import { varsColor } from './vars-color';",
      '',
      'export const vars = { ...varsCore, ...varsColor } as const;',
      '',
    ].join('\n'),
  );
}

console.log('Building design tokens...');
await buildStaticTokens();
await buildThemeCss('light');
await buildThemeCss('dark');
await buildScssReference();
writeVarsBarrel();
appendDerivedSurfaceTokens('generated/css/light.css', false);
appendDerivedSurfaceTokens('generated/css/dark.css', true);
appendMaterialTintTokens('generated/css/tokens.css');
wrapInLayer('generated/css/tokens.css', 'cr-tokens');
wrapInLayer('generated/css/light.css', 'cr-tokens');
wrapInLayer('generated/css/dark.css', 'cr-tokens');
console.log('Design tokens built into libs/shared/design-tokens/generated/.');
