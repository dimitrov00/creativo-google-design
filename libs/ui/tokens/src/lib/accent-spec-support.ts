/**
 * THE READERS BEHIND THE ACCENT SPECS (`accent-rule.spec.ts`,
 * `accent-label.spec.ts`). Test support only: it reads the repository with
 * `node:fs`, so it is NOT exported from the library's index.
 *
 * Everything is read from where it is written: a token from the theme
 * files, a wash from the rule that paints it, a rule from its stylesheet
 * (or from a component's inline `styles`), a foreground style from its
 * template. Comments are stripped first, so a note that NAMES a token never
 * counts as a reader of it. A value in a form these readers do not know
 * throws: a token written a new way fails loudly instead of being skipped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { composite, parseHex, type Srgb } from './contrast';
import type { UiTheme } from './theme';

export const TOKENS_DIR = resolve(__dirname, '../../');
export const REPO_ROOT = resolve(TOKENS_DIR, '../../../');

/** The trees the accent law binds: the DS, the features, the two apps. */
export const LAW_ROOTS: readonly string[] = [
  'libs/ui',
  'libs/features',
  'apps/web/src',
  'apps/showcase/src',
];

/** The two theme files DECLARE the tokens; their declarations are not readers. */
export const THEME_FILES: readonly string[] = [
  'libs/ui/tokens/theme-light.css',
  'libs/ui/tokens/theme-dark.css',
];

export const THEMES: readonly UiTheme[] = ['light', 'dark'];

/** Comments out, every line kept: a position still maps to its line. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  );
}

export function readStylesheet(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own stylesheets, named by these specs.
  return stripCssComments(readFileSync(path, 'utf8'));
}

// ── Tokens ────────────────────────────────────────────────────────────

function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(name as string, (value as string).replace(/\s+/g, ' ').trim());
  }
  return found;
}

/** The cascade as the page applies it: dark overrides light overrides base. */
export function themeTokens(theme: UiTheme): Map<string, string> {
  const files = ['tokens.css', 'theme-light.css'];
  if (theme === 'dark') files.push('theme-dark.css');
  return new Map(
    files.flatMap((file) => [
      ...declarations(readStylesheet(resolve(TOKENS_DIR, file))),
    ]),
  );
}

export interface Paint {
  readonly rgb: Srgb;
  readonly alpha: number;
}

/** Splits `a, b(c, d), e` at its top-level commas. */
function splitArguments(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list.charAt(i);
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

export function lookup(name: string, tokens: Map<string, string>): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

/** `14%`, or a `var()` that resolves to one, as a 0–1 share. */
export function percentage(value: string, tokens: Map<string, string>): number {
  const alias = /^var\((--[\w-]+)\)$/.exec(value.trim());
  const literal = alias ? lookup(alias[1] as string, tokens) : value;
  const share = Number(/^([\d.]+)%$/.exec(literal.trim())?.[1]) / 100;
  if (!Number.isFinite(share)) throw new Error(`not a percentage: ${value}`);
  return share;
}

/** CSS Color 5 `color-mix()`: interpolated with premultiplied alpha. */
function mixPremultiplied(a: Paint, share: number, b: Paint): Paint {
  const alpha = a.alpha * share + b.alpha * (1 - share);
  if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 };
  const channel = (x: number, y: number): number =>
    (x * a.alpha * share + y * b.alpha * (1 - share)) / alpha;
  return {
    rgb: [
      channel(a.rgb[0], b.rgb[0]),
      channel(a.rgb[1], b.rgb[1]),
      channel(a.rgb[2], b.rgb[2]),
    ],
    alpha,
  };
}

/**
 * Resolves the colour grammar the theme files use — a hex, `transparent`,
 * a `var()` alias, or `color-mix(in srgb, <paint> <pct>, <paint>)` with the
 * percentage possibly itself a `var()` — to a straight-alpha paint.
 */
export function paint(value: string, tokens: Map<string, string>): Paint {
  const v = value.trim();
  if (v === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (v.startsWith('#')) return { rgb: parseHex(v), alpha: 1 };
  const alias = /^var\((--[\w-]+)\)$/.exec(v);
  if (alias) return paint(lookup(alias[1] as string, tokens), tokens);
  const mix = /^color-mix\(\s*in srgb\s*,\s*([\s\S]*)\)$/.exec(v);
  if (mix) {
    const [first, second] = splitArguments(mix[1] as string);
    const lead = /^([\s\S]*\S)\s+(\S+)$/.exec(first ?? '');
    if (!lead || second === undefined) throw new Error(`cannot read ${v}`);
    return mixPremultiplied(
      paint(lead[1] as string, tokens),
      percentage(lead[2] as string, tokens),
      paint(second, tokens),
    );
  }
  throw new Error(`unsupported colour value: ${v}`);
}

export function over(top: Paint, under: Srgb): Srgb {
  return composite(top.rgb, top.alpha, under);
}

export function opaque(name: string, tokens: Map<string, string>): Srgb {
  const resolved = paint(lookup(name, tokens), tokens);
  if (resolved.alpha !== 1) throw new Error(`${name} is not opaque`);
  return resolved.rgb;
}

/** The opaque grounds a mark, a wash or a word is placed on. */
export interface Grounds {
  readonly page: Srgb;
  readonly surface: Srgb;
  /** The muted card and the list group's segment: one token. */
  readonly segment: Srgb;
  readonly elevated: Srgb;
}

export function groundsOf(theme: UiTheme): Grounds {
  const tokens = themeTokens(theme);
  return {
    page: opaque('--sys-color-background', tokens),
    surface: opaque('--sys-color-surface', tokens),
    segment: opaque('--sys-color-surface-secondary', tokens),
    elevated: opaque('--sys-color-surface-elevated', tokens),
  };
}

/** The type size of a `--sys-font-*` role and its weight, in px (rem = 16). */
export interface TypeRole {
  readonly px: number;
  readonly weight: number;
}

/**
 * Reads a `font` shorthand (`weight size/line family`). A `clamp()` size
 * counts at its MINIMUM: the smallest it is ever drawn.
 */
export function typeRole(shorthand: string): TypeRole | null {
  const folded = shorthand.replace(/\s+/g, ' ').trim();
  const slash = folded.indexOf('/');
  const weight = /^(\d{3}) /.exec(folded)?.[1];
  if (slash < 0 || weight === undefined) return null;
  const px = lengthPx(
    folded
      .slice(weight.length + 1, slash)
      .replace(/^clamp\(/, '')
      .split(',')[0] ?? '',
  );
  return px === null ? null : { weight: Number(weight), px };
}

/** `1.5rem` or `24px`, in px (a rem taken as the root's 16px); else `null`. */
export function lengthPx(length: string): number | null {
  const value = length.trim();
  const unit = value.endsWith('rem') ? 'rem' : value.endsWith('px') ? 'px' : '';
  const figure = Number(value.slice(0, value.length - unit.length));
  if (unit === '' || value.length === unit.length || !Number.isFinite(figure)) {
    return null;
  }
  return figure * (unit === 'rem' ? 16 : 1);
}

/** WCAG's large text: 24px, or 14pt (18.66px) at weight 700 and over. */
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = (14 * 96) / 72;

export function isDisplayType(role: TypeRole): boolean {
  return (
    role.px >= LARGE_TEXT_PX ||
    (role.px >= LARGE_BOLD_TEXT_PX && role.weight >= 700)
  );
}

// ── Rules ─────────────────────────────────────────────────────────────

export interface CssRule {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  /** Whitespace folded; a selector list is kept whole. */
  readonly selector: string;
  /** The rule's own declarations (nested blocks removed). */
  readonly body: string;
  readonly line: number;
}

const CONTAINER_AT_RULES =
  /^@(?:media|layer|supports|container|scope|starting-style)\b/;

/** Selectors fold to one line, and `:not( [x] )` to `:not([x])`. */
export function foldSelector(selector: string): string {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\)\s+(?=:)/g, ')')
    .trim();
}

/**
 * Every style rule of a stylesheet, flat: the rules inside `@layer`,
 * `@media` and the other conditional blocks included, keyframes not.
 */
export function rulesOf(css: string, file: string): CssRule[] {
  const source = stripCssComments(css);
  const found: CssRule[] = [];

  const parse = (from: number, to: number): void => {
    let position = from;
    while (position < to) {
      const open = source.indexOf('{', position);
      if (open < 0 || open >= to) return;
      let depth = 1;
      let close = open + 1;
      while (close < to && depth > 0) {
        const char = source.charAt(close);
        if (char === '{') depth++;
        else if (char === '}') depth--;
        close++;
      }
      const prelude = source.slice(position, open);
      const selector = foldSelector(
        prelude.slice(prelude.lastIndexOf(';') + 1),
      );
      const inner = source.slice(open + 1, close - 1);
      if (selector.startsWith('@')) {
        if (CONTAINER_AT_RULES.test(selector)) parse(open + 1, close - 1);
      } else {
        if (inner.includes('{')) parse(open + 1, close - 1);
        found.push({
          file,
          selector,
          body: inner.replace(/[^{};]*\{[^{}]*\}/g, ''),
          line: source.slice(0, open).split('\n').length,
        });
      }
      position = close;
    }
  };

  parse(0, source.length);
  return found;
}

/** One declaration's value in a rule's body, or `undefined`. */
export function declared(body: string, property: string): string | undefined {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a property name these specs spell, over the repository's own stylesheets.
  return new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;}]+)`)
    .exec(body)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim();
}

/**
 * The declarations of one rule of one stylesheet, found by its exact
 * selector. A missing rule throws, so a renamed selector fails here instead
 * of silently measuring nothing.
 */
export function ruleBody(path: string, selector: string): string {
  const wanted = foldSelector(selector);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own stylesheets, named by these specs.
  const rule = rulesOf(readFileSync(path, 'utf8'), path).find(
    (candidate) => candidate.selector === wanted,
  );
  if (!rule) throw new Error(`${basename(path)} has no "${wanted}" rule`);
  return rule.body;
}

/**
 * The accent wash one rule paints, as a 0–1 share in one theme: the first
 * `var(--sys-color-accent) <share>` of the rule, the share a literal or a
 * token. A rule that paints no accent wash throws.
 */
export function accentRung(
  path: string,
  selector: string,
  theme: UiTheme,
): number {
  const share = /var\(--sys-color-accent\)\s+(var\(--[\w-]+\)|[\d.]+%)/.exec(
    ruleBody(path, selector),
  )?.[1];
  if (share === undefined) {
    throw new Error(`"${selector}" paints no accent wash`);
  }
  return percentage(share, themeTokens(theme));
}

// ── The tree ──────────────────────────────────────────────────────────

function* walk(directory: string): Generator<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own source trees.
  for (const name of readdirSync(directory).sort()) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(directory, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own source trees.
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const repoRelative = (path: string): string =>
  relative(REPO_ROOT, path).split('\\').join('/');

export interface SourceFile {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  readonly text: string;
}

let sources: readonly SourceFile[] | undefined;

/** Every `.css`, `.html` and non-spec `.ts` file under the law's roots, read once. */
export function lawSources(): readonly SourceFile[] {
  sources ??= LAW_ROOTS.flatMap((root) => [...walk(resolve(REPO_ROOT, root))])
    .filter(
      (path) =>
        path.endsWith('.css') ||
        path.endsWith('.html') ||
        (path.endsWith('.ts') && !path.endsWith('.spec.ts')),
    )
    .map((path) => ({
      file: repoRelative(path),
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the repository's own source trees.
      text: readFileSync(path, 'utf8'),
    }));
  return sources;
}

/** A component's inline `styles`, as one stylesheet; `null` without any. */
function inlineStyles(typescript: string): string | null {
  const blocks = [
    ...typescript.matchAll(/\bstyles\s*:\s*\[?\s*`([\s\S]*?)`/g),
  ].map(([whole, block]) => {
    // Keep the block on its own lines, so a rule's line is the file's.
    const before = typescript.slice(0, typescript.indexOf(whole));
    return '\n'.repeat(before.split('\n').length - 1) + (block as string);
  });
  return blocks.length > 0 ? blocks.join('\n') : null;
}

export interface Stylesheet {
  readonly file: string;
  /** Comments stripped. */
  readonly css: string;
}

/** Every stylesheet the law binds: the `.css` files and the inline styles. */
export function lawStylesheets(): readonly Stylesheet[] {
  return lawSources().flatMap(({ file, text }) => {
    if (file.endsWith('.css')) return [{ file, css: stripCssComments(text) }];
    if (!file.endsWith('.ts')) return [];
    const inline = inlineStyles(text);
    return inline === null ? [] : [{ file, css: stripCssComments(inline) }];
  });
}

/** Every style rule the law binds, the theme files' own left out. */
export function lawRules(): readonly CssRule[] {
  return lawStylesheets()
    .filter(({ file }) => !THEME_FILES.includes(file))
    .flatMap(({ file, css }) => rulesOf(css, file));
}

// ── Templates ─────────────────────────────────────────────────────────

export interface TemplateTag {
  readonly file: string;
  readonly line: number;
  /** Lower-cased element name. */
  readonly name: string;
  /** Attribute name as written (`uiFont`, `[uiFont]`) → its raw value. */
  readonly attributes: ReadonlyMap<string, string | null>;
}

/**
 * The opening tags of a template, with their attributes as written. Quoted
 * values may hold `>`; HTML comments are skipped. Reads an `.html` file or
 * a component's TypeScript alike: only tags that carry attributes matter
 * to the callers, and a generic's `<T>` carries none.
 */
export function openingTags(text: string, file: string): TemplateTag[] {
  const source = text.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  );
  const tags: TemplateTag[] = [];
  const opener = /<([a-zA-Z][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    const attributes = new Map<string, string | null>();
    let at = match.index + match[0].length;
    let closed = false;
    while (at < source.length) {
      while (/\s/.test(source.charAt(at))) at++;
      const char = source.charAt(at);
      if (char === '>') {
        closed = true;
        at++;
        break;
      }
      if (char === '/' && source.charAt(at + 1) === '>') {
        closed = true;
        at += 2;
        break;
      }
      if (char === '' || char === '<') break;
      let end = at;
      while (
        end < source.length &&
        !/[\s=>]/.test(source.charAt(end)) &&
        !(source.charAt(end) === '/' && source.charAt(end + 1) === '>')
      ) {
        end++;
      }
      if (end === at) break;
      const name = source.slice(at, end);
      at = end;
      let value: string | null = null;
      if (source.charAt(at) === '=') {
        at++;
        const quote = source.charAt(at);
        if (quote === '"' || quote === "'") {
          const last = source.indexOf(quote, at + 1);
          if (last < 0) break;
          value = source.slice(at + 1, last);
          at = last + 1;
        } else {
          let last = at;
          while (last < source.length && !/[\s>]/.test(source.charAt(last))) {
            last++;
          }
          value = source.slice(at, last);
          at = last;
        }
      }
      attributes.set(name, value);
    }
    if (closed) {
      tags.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        name: (match[1] as string).toLowerCase(),
        attributes,
      });
    }
    opener.lastIndex = Math.max(opener.lastIndex, at);
  }
  return tags;
}

/**
 * The values one input may take on a tag: the attribute's own value, or
 * every quoted literal of its bound expression
 * (`[uiForegroundStyle]="applied ? 'promo' : 'secondary'"` → promo,
 * secondary). Empty when the tag does not name the input.
 */
export function literalsOf(tag: TemplateTag, input: string): string[] {
  const written = tag.attributes.get(input);
  if (written !== undefined) return written === null ? [] : [written];
  const bound = tag.attributes.get(`[${input}]`);
  if (bound === undefined || bound === null) return [];
  return [...bound.matchAll(/'([^']*)'/g)].map(
    ([, literal]) => literal as string,
  );
}
