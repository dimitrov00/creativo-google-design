/**
 * Imports a TypeScript module (and its relative imports) from a Node script
 * without a bundler: each file is transpiled with the workspace's own
 * `typescript`, relative specifiers get an explicit `.mjs` extension, and
 * the result is loaded from a temp directory. Enough for the pure-data
 * modules under `libs/ui/icons/src/lib/manifest/`; not a general loader.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const RELATIVE_SPECIFIER = /(from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\2/g;

export async function importTs(entryPath) {
  const entry = resolve(entryPath);
  const rootDir = dirname(entry);
  const outDir = mkdtempSync(join(tmpdir(), 'creativo-ts-'));
  const seen = new Set();

  const emit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    });
    const rewritten = outputText.replace(
      RELATIVE_SPECIFIER,
      (_, lead, quote, specifier) => {
        emit(resolve(dirname(file), `${specifier}.ts`));
        return `${lead}${quote}${specifier}.mjs${quote}`;
      },
    );
    const out = join(
      outDir,
      `${relative(rootDir, file).replace(/\.ts$/, '')}.mjs`,
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, rewritten);
  };

  emit(entry);
  // A file this function just wrote to a private temp dir — not user input.
  // eslint-disable-next-line no-unsanitized/method
  return import(
    pathToFileURL(
      join(outDir, `${relative(rootDir, entry).replace(/\.ts$/, '')}.mjs`),
    ).href
  );
}
