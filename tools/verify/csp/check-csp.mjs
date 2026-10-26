#!/usr/bin/env node
// Guard: the Content Security Policy firebase.json serves is the one the
// BUILT index.html needs (owner rulings OR-29, OR-31).
//
//   pnpm nx build web && node tools/verify/csp/check-csp.mjs
//   node tools/verify/csp/check-csp.mjs [--dist=dist/apps/web/browser] [--config=firebase.json]
//
// Over the web hosting entry of firebase.json and a build's output folder:
//
//   (a) headers — the `**` rule sets every security header (the policy, the
//       Trusted Types report-only policy, HSTS, nosniff, Referrer-Policy,
//       Permissions-Policy, COOP, X-Frame-Options);
//   (b) script-src — present, `'self'`, and none of `'unsafe-eval'`,
//       `'unsafe-inline'`, `'unsafe-hashes'`, a nonce, a wildcard or a bare
//       scheme;
//   (c) hashes — the sha256 of every inline script in the built index.html,
//       recomputed here, and script-src lists EXACTLY those hashes (a hash
//       nobody needs is a script the policy would still admit); an inline
//       event handler or a `javascript:` URL in the markup is refused (a
//       hash policy blocks both);
//   (d) functions host — connect-src names the default region's callables
//       host of `.firebaserc`'s default project, the only one;
//   (e) caching — every built js/css file falls under exactly the cache
//       rule its name calls for (a hashed `main|polyfills|chunk|styles-*`
//       is immutable; a service-worker script, index.html, ngsw.json, the
//       manifest and the i18n catalogues revalidate), and so do `/` and an
//       extensionless route.
//
// The hashes are never typed by hand: on a mismatch this prints the
// script-src the artifact needs. Exits 1 on any failure, 2 when the build
// or the config cannot be read. The pure parts are exported for
// `emulator-config.mjs`, which writes the smoke's superset of this policy.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The security headers the `**` rule must set (OR-29, OR-30). */
export const SECURITY_HEADERS = [
  'Content-Security-Policy',
  'Content-Security-Policy-Report-Only',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'X-Frame-Options',
];

export const CSP_HEADER = 'Content-Security-Policy';
const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** script-src keywords a hash policy never carries. */
const REFUSED_SCRIPT_KEYWORDS = new Set([
  "'unsafe-eval'",
  "'unsafe-inline'",
  "'unsafe-hashes'",
]);

/** A bare scheme source (`https:`, `data:`) — admits every script over it. */
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/i;

/** A hashed build file at the output's root, as the application builder names it. */
const HASHED_ASSET =
  /^(?:main|polyfills|chunk|styles)-[A-Za-z0-9_-]+\.(?:js|css)$/;

/** The built files (or routes) that must revalidate on every load. */
const REVALIDATED = [
  '/',
  '/staff/schedule',
  '/index.html',
  '/ngsw.json',
  '/manifest.webmanifest',
];

/** `default-src 'self'; script-src …` → `Map { 'default-src' => ["'self'"], … }`, in order. */
export function parsePolicy(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name !== undefined) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** The inverse of {@link parsePolicy}. */
export function serializePolicy(directives) {
  return [...directives]
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

/** The web site's hosting entry of a firebase.json — the one `target: 'web'` names. */
export function webHosting(config) {
  const hosting = Array.isArray(config.hosting)
    ? config.hosting
    : [config.hosting];
  return hosting.find((entry) => entry?.target === 'web') ?? null;
}

/** The value a header rule sets for `key` (case-insensitive), or `undefined`. */
export function headerOf(rule, key) {
  return rule?.headers?.find(
    (header) => header.key.toLowerCase() === key.toLowerCase(),
  )?.value;
}

/**
 * The headers a request for `path` gets: every rule whose glob matches, in
 * order, a later rule's value winning — as Hosting (superstatic) applies
 * them.
 */
export function headersFor(rules, path) {
  const headers = new Map();
  for (const rule of rules) {
    const glob = rule.source.startsWith('/') ? rule.source : `/${rule.source}`;
    if (!matchesGlob(path, glob)) continue;
    for (const header of rule.headers ?? []) {
      headers.set(header.key.toLowerCase(), header.value);
    }
  }
  return headers;
}

/** The `'sha256-…'` source of an inline script's exact text. */
export function scriptHash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** A `<script>` whose type a browser runs (none, a JavaScript MIME type, or `module`). */
function isExecuted(attributes) {
  const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1];
  return (
    type === undefined ||
    type === 'module' ||
    /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/i.test(type)
  );
}

/** The text of every inline script a browser runs in `html`, in order. */
export function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const [, attributes, text] = match;
    if (/\ssrc\s*=/i.test(attributes) || !isExecuted(attributes)) continue;
    scripts.push(text);
  }
  return scripts;
}

/** The inline handlers and `javascript:` URLs in the markup's tags — scripts' bodies left out. */
export function inlineHandlers(html) {
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '<script></script>')
    .replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  for (const [tag] of markup.matchAll(/<[a-z][^>]*>/gi)) {
    const handler = /\son[a-z]+\s*=/i.exec(tag);
    if (handler !== null) found.push(tag.slice(0, 120));
    else if (/=\s*["']?\s*javascript:/i.test(tag))
      found.push(tag.slice(0, 120));
  }
  return found;
}

/** The callables host of a project's default region (`us-central1`). */
export function functionsHost(projectId) {
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

/** Every file under `dir`, as a site path (`/chunk-AB12CD34.js`). */
function sitePaths(dir) {
  const paths = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else paths.push(`/${relative(dir, full).split('\\').join('/')}`);
    }
  };
  walk(dir);
  return paths;
}

/** The cache rule a built path must fall under, or `null` when the site default is fine. */
function expectedCacheOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (REVALIDATED.includes(path)) return NO_CACHE;
  if (/^\/assets\/i18n\/[^/]+\.json$/.test(path)) return NO_CACHE;
  if (path.lastIndexOf('/') === 0 && HASHED_ASSET.test(name)) return IMMUTABLE;
  // Any other script or stylesheet (the service worker's own) revalidates.
  if (/\.(?:js|css)$/.test(name)) return NO_CACHE;
  return null;
}

/**
 * Every check over a parsed firebase.json, the built index.html, the
 * build's site paths and the `.firebaserc` default project — the list of
 * failures, empty when the artifact and the policy agree.
 */
export function checkArtifact({ config, html, paths, projectId }) {
  const failures = [];
  const hosting = webHosting(config);
  if (hosting === null) return ['no hosting entry with `target: "web"`'];
  const rules = hosting.headers ?? [];
  const all = rules.find((rule) => rule.source === '**');
  if (all === undefined) return ['no `**` header rule'];

  // (a) headers
  for (const key of SECURITY_HEADERS) {
    if (!headerOf(all, key)?.trim()) failures.push(`(a) missing header ${key}`);
  }
  const csp = headerOf(all, CSP_HEADER);
  if (!csp) return failures;
  const policy = parsePolicy(csp);

  // (b) script-src
  const scriptSrc = policy.get('script-src');
  if (scriptSrc === undefined) {
    failures.push('(b) no script-src directive');
    return failures;
  }
  if (!scriptSrc.includes("'self'"))
    failures.push("(b) script-src lacks 'self'");
  for (const source of scriptSrc) {
    if (REFUSED_SCRIPT_KEYWORDS.has(source)) {
      failures.push(`(b) script-src carries ${source}`);
    } else if (/^'nonce-/i.test(source)) {
      failures.push(`(b) script-src carries a nonce (${source})`);
    } else if (source.includes('*')) {
      failures.push(`(b) script-src carries a wildcard (${source})`);
    } else if (SCHEME_SOURCE.test(source)) {
      failures.push(`(b) script-src admits a whole scheme (${source})`);
    }
  }

  // (c) hashes
  const needed = [...new Set(inlineScripts(html).map(scriptHash))];
  const listed = scriptSrc.filter((source) =>
    /^'sha(?:256|384|512)-/.test(source),
  );
  const missing = needed.filter((hash) => !listed.includes(hash));
  const extra = listed.filter((hash) => !needed.includes(hash));
  for (const hash of missing) {
    failures.push(`(c) script-src does not list the inline script ${hash}`);
  }
  for (const hash of extra) {
    failures.push(`(c) script-src lists ${hash}, which no inline script has`);
  }
  if (missing.length > 0 || extra.length > 0) {
    const others = scriptSrc.filter((source) => !listed.includes(source));
    failures.push(
      `(c) the artifact needs: script-src ${[...others, ...needed].join(' ')}`,
    );
  }
  for (const tag of inlineHandlers(html)) {
    failures.push(
      `(c) an inline handler or javascript: URL a hash policy blocks: ${tag}`,
    );
  }

  // (d) the functions host
  const host = functionsHost(projectId);
  const callables = (policy.get('connect-src') ?? []).filter((source) =>
    source.includes('cloudfunctions.net'),
  );
  if (callables.length !== 1 || callables[0] !== host) {
    failures.push(
      `(d) connect-src must name exactly ${host} (.firebaserc default), found ${callables.join(' ') || 'none'}`,
    );
  }

  // (e) caching
  for (const path of [...new Set([...REVALIDATED.slice(0, 2), ...paths])]) {
    const expected = expectedCacheOf(path);
    if (expected === null) continue;
    const served = headersFor(rules, path).get('cache-control');
    if (served !== expected) {
      failures.push(
        `(e) ${path} is served Cache-Control ${served ?? '(Hosting default)'}, needs ${expected}`,
      );
    }
  }
  return failures;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main(args) {
  const option = (name, fallback) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ??
    fallback;
  const dist = resolve(option('dist', 'dist/apps/web/browser'));
  const configPath = resolve(option('config', 'firebase.json'));
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(
      `Cannot read ${indexPath}. Build it first: pnpm nx build web`,
    );
    return 2;
  }
  let config;
  let projectId;
  try {
    config = readJson(configPath);
    projectId = readJson(resolve('.firebaserc')).projects.default;
  } catch (error) {
    console.error(
      `Cannot read firebase.json or .firebaserc (${error.message}).`,
    );
    return 2;
  }
  const html = readFileSync(indexPath, 'utf8');
  const failures = checkArtifact({
    config,
    html,
    paths: sitePaths(dist),
    projectId,
  });
  const hashes = [...new Set(inlineScripts(html).map(scriptHash))];
  console.log(
    `CSP gate over ${relative(process.cwd(), indexPath)} and ${relative(process.cwd(), configPath)}:`,
  );
  console.log(`  inline scripts: ${hashes.length} (${hashes.join(' ')})`);
  if (failures.length === 0) {
    console.log(
      '  pass — headers, script-src, hashes, functions host, caching',
    );
    return 0;
  }
  console.error('\nFAIL');
  for (const failure of failures) console.error(`  ${failure}`);
  return 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
