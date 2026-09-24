#!/usr/bin/env node
/**
 * Icon usage inventory, verification and codemod — the repo-wide sweep that
 * backs the per-project lint rules.
 *
 *   node tools/icons/check-icon-usage.mjs            # verify: exit 1 on any bypass or unknown key
 *   node tools/icons/check-icon-usage.mjs --report   # + a usage table per semantic key (markdown)
 *   node tools/icons/check-icon-usage.mjs --propose  # write a glyph→key proposal JSON for raw usages
 *   node tools/icons/check-icon-usage.mjs --fix --map keys.json   # rewrite raw spans/mat-icons to <ui-icon>
 *
 * What counts as a bypass (outside libs/ui/icons):
 *   - a Material class, font family, ligature span or <mat-icon>;
 *   - an icon-font import;
 *   - an `as UiIconName` cast;
 *   - a static `uiName`/`uiIcon` or a literal in its binding that is not a
 *     key the vocabulary knows;
 *   - an <img> pointing at a logo file;
 *   - a hand-written <svg> outside INLINE_SVG_ALLOWED (the same three files
 *     the lint rule allows: a data ring, a countdown ring, a choreographed stroke).
 *
 * The codemod is deliberately narrow: it rewrites the shapes an icon-font
 * codebase actually has (`<span class="material-symbols-…">glyph</span>`,
 * `<i class="material-icons">glyph</i>`, `<mat-icon>glyph</mat-icon>`,
 * `<mat-icon fontIcon="glyph">`) into `<ui-icon uiName="KEY" />` using a
 * glyph→key map, and leaves anything it cannot map untouched and reported.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importTs } from './load-ts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = resolve(here, '..', '..');
const VOCABULARY = join(
  WORKSPACE_ROOT,
  'libs/ui/icons/src/lib/manifest/icon-vocabulary.ts',
);

export const REGISTRY_BOUNDARY = 'libs/ui/icons/';
const SCAN_DIRS = ['apps', 'libs'];
const EXTENSIONS = new Set(['.ts', '.html', '.css']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.nx',
  'coverage',
  '__fixtures__',
]);

export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$/;

const RAW_SPAN =
  /<(span|i)\b([^>]*\bclass="[^"]*\bmaterial-(?:symbols(?:-[a-z]+)?|icons(?:-[a-z]+)?)\b[^"]*"[^>]*)>\s*([a-z0-9_]+)\s*<\/\1>/g;
const MAT_ICON_TEXT = /<mat-icon\b([^>]*)>\s*([a-z0-9_]+)\s*<\/mat-icon>/g;
const MAT_ICON_FONT =
  /<mat-icon\b[^>]*\bfontIcon="([a-z0-9_]+)"[^>]*>\s*<\/mat-icon>/g;

const CHECKS = [
  {
    code: 'material-class',
    pattern: /\bmaterial-(symbols|icons)(-[a-z]+)?\b/g,
    files: ['.ts', '.html', '.css'],
  },
  {
    code: 'material-font',
    pattern: /Material (Symbols|Icons)\b/g,
    files: ['.ts', '.css'],
  },
  {
    code: 'mat-icon',
    pattern: /<mat-icon\b|\bMatIcon(Module|Registry)?\b/g,
    files: ['.ts', '.html'],
  },
  {
    code: 'icon-font-import',
    pattern:
      /(?:from|import)\s*\(?\s*['"](material-symbols|@material-symbols\/|@angular\/material)/g,
    files: ['.ts'],
  },
  { code: 'key-cast', pattern: /\bas\s+UiIconName\b/g, files: ['.ts'] },
  {
    code: 'raw-logo',
    pattern: /<img\b[^>]*\bsrc\]?="[^"]*logo[^"]*\.(svg|png|webp|jpe?g|avif)/g,
    files: ['.ts', '.html'],
  },
];

/** Hand-drawn <svg> that is a SHAPE, not a glyph — mirrors eslint.config.mjs. */
export const INLINE_SVG_ALLOWED = [
  'libs/ui/controls/src/lib/progress-ring/progress-ring.ts',
  'libs/ui/patterns/src/lib/toast/toast.ts',
  'libs/ui/patterns/src/lib/reward-moment/reward-moment.ts',
];
const INLINE_SVG = /<svg\b/g;

const STATIC_KEY = /\b(uiName|uiIcon)="([^"]*)"/g;
const BOUND_KEY = /\[(uiName|uiIcon)\]="([^"]*)"/g;
const LITERAL = /'([^']*)'/g;
const UI_ICON_ELEMENT = /<ui-icon\b[^>]*>/g;

function stripComments(source, extension) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  if (extension === '.html')
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  if (extension === '.ts')
    out = out.replace(
      /(^|[^:'"`])\/\/[^\n]*/g,
      (m, lead) => lead + ' '.repeat(m.length - lead.length),
    );
  return out;
}

export function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(extname(full))) files.push(full);
  }
  return files;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Scans one file. `knownKeys` is the vocabulary; a file inside the registry
 * boundary is inventoried but exempt from the bypass checks.
 */
export function scanFile(path, source, knownKeys, root = WORKSPACE_ROOT) {
  const rel = relative(root, path).split('\\').join('/');
  const extension = extname(path);
  const text = stripComments(source, extension);
  const violations = [];
  const usages = [];
  const inBoundary =
    rel.startsWith(REGISTRY_BOUNDARY) || rel.startsWith('tools/');

  if (!inBoundary) {
    if (
      (extension === '.ts' || extension === '.html') &&
      !INLINE_SVG_ALLOWED.some((part) => rel.includes(part))
    ) {
      for (const match of text.matchAll(INLINE_SVG)) {
        violations.push({
          code: 'inline-svg',
          file: rel,
          line: lineOf(text, match.index),
          value: '<svg',
        });
      }
    }
    for (const check of CHECKS) {
      if (!check.files.includes(extension)) continue;
      for (const match of text.matchAll(check.pattern)) {
        violations.push({
          code: check.code,
          file: rel,
          line: lineOf(text, match.index),
          value: match[0],
        });
      }
    }
  }

  if (extension === '.ts' || extension === '.html') {
    const uiIconElements = [...text.matchAll(UI_ICON_ELEMENT)];
    const checkLiteral = (attribute, value, index, elementSource) => {
      // `uiName` is a key only on ui-icon (ui-avatar's uiName is a person).
      if (
        attribute === 'uiName' &&
        !uiIconElements.some(
          (m) => index >= m.index && index < m.index + m[0].length,
        )
      )
        return;
      usages.push({ key: value, file: rel, line: lineOf(text, index) });
      if (!inBoundary && !knownKeys.has(value)) {
        violations.push({
          code: 'unknown-key',
          file: rel,
          line: lineOf(text, index),
          value,
        });
      }
      void elementSource;
    };
    for (const match of text.matchAll(STATIC_KEY))
      checkLiteral(match[1], match[2], match.index);
    for (const match of text.matchAll(BOUND_KEY)) {
      const expression = match[2];
      for (const literal of expression.matchAll(LITERAL)) {
        // A comparison operand ("edge === 'before' ? …") is not a candidate key.
        const before = expression.slice(0, literal.index).trimEnd();
        const after = expression
          .slice(literal.index + literal[0].length)
          .trimStart();
        if (/(===|!==|==|!=)$/.test(before) || /^(===|!==|==|!=)/.test(after))
          continue;
        checkLiteral(match[1], literal[1], match.index);
      }
    }
  }
  return { violations, usages };
}

export async function loadVocabulary() {
  const { UI_ICON_NAMES } = await importTs(VOCABULARY);
  return UI_ICON_NAMES;
}

export function scan(root, knownKeys, dirs = SCAN_DIRS) {
  const violations = [];
  const usages = [];
  for (const dir of dirs) {
    const base = join(root, dir);
    let files = [];
    try {
      files = walk(base);
    } catch {
      continue;
    }
    for (const file of files) {
      const result = scanFile(
        file,
        readFileSync(file, 'utf8'),
        knownKeys,
        root,
      );
      violations.push(...result.violations);
      usages.push(...result.usages);
    }
  }
  return { violations, usages };
}

/* ── Codemod ────────────────────────────────────────────────────────── */

/** A key proposal for a raw glyph, from where it is used: `<slice>.<glyph>`. */
export function proposeKey(glyph, file) {
  const parts = file.split('/');
  const slice = parts.includes('features')
    ? (parts[parts.indexOf('features') + 2] ??
      parts[parts.indexOf('features') + 1])
    : (parts[1] ?? 'app');
  const camel = glyph.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  return `${slice.replace(/[^a-z0-9]/gi, '')}.${camel}`;
}

export function rawGlyphs(source) {
  const found = [];
  for (const pattern of [RAW_SPAN, MAT_ICON_TEXT, MAT_ICON_FONT]) {
    for (const match of source.matchAll(pattern)) {
      const glyph =
        pattern === RAW_SPAN
          ? match[3]
          : pattern === MAT_ICON_TEXT
            ? match[2]
            : match[1];
      found.push({ glyph, index: match.index, match: match[0] });
    }
  }
  return found;
}

/** Rewrites every mappable raw usage; returns the new source and what was left. */
export function rewriteRawIcons(source, glyphToKey) {
  const unmapped = [];
  const replace = (whole, glyph) => {
    const key = glyphToKey[glyph];
    if (!key || !KEY_PATTERN.test(key)) {
      unmapped.push(glyph);
      return whole;
    }
    return `<ui-icon uiName="${key}" />`;
  };
  let out = source.replace(RAW_SPAN, (whole, _tag, _attrs, glyph) =>
    replace(whole, glyph),
  );
  out = out.replace(MAT_ICON_TEXT, (whole, _attrs, glyph) =>
    replace(whole, glyph),
  );
  out = out.replace(MAT_ICON_FONT, (whole, glyph) => replace(whole, glyph));
  return { source: out, unmapped };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

function usageTable(usages, knownKeys) {
  const counts = new Map();
  for (const usage of usages)
    counts.set(usage.key, (counts.get(usage.key) ?? 0) + 1);
  const rows = [...knownKeys]
    .sort()
    .map((key) => `| \`${key}\` | ${counts.get(key) ?? 0} |`);
  const unused = [...knownKeys].filter((key) => !counts.has(key));
  return [
    '| key | static usages |',
    '| --- | ---: |',
    ...rows,
    '',
    `Keys with no static usage (dynamic-only or reserved): ${unused.length ? unused.map((k) => `\`${k}\``).join(', ') : 'none'}`,
  ].join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const knownKeys = await loadVocabulary();
  const mapIndex = process.argv.indexOf('--map');
  const glyphToKey =
    mapIndex > 0
      ? JSON.parse(readFileSync(resolve(process.argv[mapIndex + 1]), 'utf8'))
      : {};

  if (args.has('--fix') || args.has('--propose')) {
    const proposals = {};
    let rewritten = 0;
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(WORKSPACE_ROOT, dir))) {
        if (!['.html', '.ts'].includes(extname(file))) continue;
        const rel = relative(WORKSPACE_ROOT, file);
        const source = readFileSync(file, 'utf8');
        const raw = rawGlyphs(source);
        if (raw.length === 0) continue;
        if (args.has('--propose')) {
          for (const { glyph } of raw)
            proposals[glyph] ??= proposeKey(glyph, rel);
          continue;
        }
        const result = rewriteRawIcons(source, glyphToKey);
        if (result.source !== source) {
          writeFileSync(file, result.source);
          rewritten += 1;
        }
        for (const glyph of result.unmapped)
          console.warn(`${rel}: no key for raw glyph "${glyph}"`);
      }
    }
    if (args.has('--propose')) {
      const out = join(WORKSPACE_ROOT, 'tmp', 'icon-key-proposals.json');
      writeFileSync(out, JSON.stringify(proposals, null, 2) + '\n');
      console.log(
        `${Object.keys(proposals).length} raw glyphs → proposals written to ${relative(WORKSPACE_ROOT, out)}`,
      );
      return;
    }
    console.log(`rewrote ${rewritten} file(s); re-run without --fix to verify`);
    return;
  }

  const { violations, usages } = scan(WORKSPACE_ROOT, knownKeys);
  if (args.has('--report')) {
    console.log(usageTable(usages, knownKeys));
    console.log('');
  }
  if (violations.length > 0) {
    for (const v of violations)
      console.error(`${v.file}:${v.line}  ${v.code}  ${v.value}`);
    console.error(
      `\n${violations.length} icon bypass(es) — every icon goes through libs/ui/icons.`,
    );
    process.exit(1);
  }
  console.log(
    `ok — ${usages.length} static icon usages, all through the registry`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
