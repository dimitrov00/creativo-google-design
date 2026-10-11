// The initial web chunk, read from the esbuild metafile the Angular builder
// writes with `--stats-json` (dist/apps/web/browser-stats.json under Angular 22).
//
// "Initial" is what the browser must fetch before the app can boot: the
// `main` entry, the global styles (and `polyfills` when there is one), plus
// every chunk those reach through a STATIC import. A chunk only reached
// through `import()` is lazy and does not count — the same line the
// builder's own `initial` budget draws.
//
// Pure functions over the parsed metafile, so the guard and its spec share
// one reading (`node --test tools/verify/bundle/initial-bundle.spec.mjs`).

/** Output files the builder names as initial entries. */
const INITIAL_ENTRY = /^(main|polyfills|styles)-[^/]*\.(js|css)$/;

/**
 * Packages and sources that must never ship in the initial chunk: the
 * Firestore and Storage SDKs (with the pieces only they pull in) and the
 * adapter code over them. They load on the first data-port call, through
 * the lazy port bindings in apps/web/src/app/app.config.ts.
 */
export const FORBIDDEN_IN_INITIAL = [
  {
    label: 'firebase/firestore',
    pattern: /node_modules\/@firebase\/firestore\//,
  },
  { label: 'firebase/storage', pattern: /node_modules\/@firebase\/storage\// },
  {
    label: '@firebase/webchannel-wrapper (Firestore transport)',
    pattern: /node_modules\/@firebase\/webchannel-wrapper\//,
  },
  { label: 're2js (Firestore dependency)', pattern: /node_modules\/re2js\// },
  {
    label:
      'Firestore adapters (libs/infrastructure/firestore/src/lib/firestore.adapters.ts)',
    pattern:
      /libs\/infrastructure\/firestore\/src\/lib\/firestore\.adapters\.ts$/,
  },
  {
    label:
      'Storage adapters (libs/infrastructure/storage/src/lib/storage.adapters.ts)',
    pattern: /libs\/infrastructure\/storage\/src\/lib\/storage\.adapters\.ts$/,
  },
];

/** The initial output files: entries plus their static-import closure. */
export function initialOutputs(metafile) {
  const outputs = metafile.outputs ?? {};
  const pending = Object.keys(outputs).filter((path) =>
    INITIAL_ENTRY.test(path),
  );
  const seen = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path) || !outputs[path]) continue;
    seen.add(path);
    for (const edge of outputs[path].imports ?? []) {
      if (edge.kind === 'import-statement' && !edge.external) {
        pending.push(edge.path);
      }
    }
  }
  return [...seen].sort();
}

/**
 * The package or workspace project an input path belongs to:
 * `node_modules/.pnpm/x@1/node_modules/@scope/name/...` -> `@scope/name`,
 * `libs/infrastructure/firestore/src/...` -> `libs/infrastructure/firestore`.
 */
export function ownerOf(input) {
  const modules = input.lastIndexOf('node_modules/');
  if (modules >= 0) {
    const rest = input.slice(modules + 'node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const libs = input.match(/^libs\/(?:[^/]+\/)*?[^/]+(?=\/src\/)/);
  if (libs) return libs[0];
  const apps = input.match(/^apps\/[^/]+/);
  if (apps) return apps[0];
  return input.split(':')[0] || input;
}

/** Bytes, per-owner contributors and forbidden hits of the initial chunk. */
export function analyseInitial(metafile) {
  const files = initialOutputs(metafile);
  const owners = new Map();
  const forbidden = new Map();
  let bytes = 0;
  for (const file of files) {
    const output = metafile.outputs[file];
    bytes += output.bytes;
    for (const [input, { bytesInOutput }] of Object.entries(
      output.inputs ?? {},
    )) {
      const owner = ownerOf(input);
      owners.set(owner, (owners.get(owner) ?? 0) + bytesInOutput);
      for (const rule of FORBIDDEN_IN_INITIAL) {
        if (rule.pattern.test(input)) {
          const hit = forbidden.get(rule.label) ?? { bytes: 0, file };
          hit.bytes += bytesInOutput;
          forbidden.set(rule.label, hit);
        }
      }
    }
  }
  const contributors = [...owners.entries()]
    .map(([owner, size]) => ({ owner, bytes: size }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    files: files.map((file) => ({ file, bytes: metafile.outputs[file].bytes })),
    bytes,
    contributors,
    forbidden: [...forbidden.entries()].map(([label, hit]) => ({
      label,
      ...hit,
    })),
  };
}

/**
 * `954573` -> `954.57 kB`, in the builder's own units: its budgets and its
 * size table count 1 kB = 1000 B (`"1mb"` in project.json is 1,000,000 B).
 */
export function formatBytes(bytes) {
  if (bytes >= 1000 * 1000) return `${(bytes / 1000 / 1000).toFixed(2)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(2)} kB`;
  return `${bytes} B`;
}
