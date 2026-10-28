// node --test tools/verify/ci/e2e-screenshot-tag.spec.mjs
//
// The CI screenshot switch (audit hardening Phase 3, WS-E — P3-RU-30,
// P3-DEP-25). The screenshot baselines are macOS renders, so CI's e2e job
// runs the suite without the `@screenshot`-tagged tests and the owner's
// macOS full gate runs them all. That is only honest while:
//
// - every screenshot comparison in apps/web/e2e sits inside a describe
//   tagged `@screenshot`, and a tagged describe holds nothing BUT
//   screenshot tests (so CI never drops a functional test with them);
// - the tag is spelled nowhere else (Playwright's grep reads titles too);
// - the config's switch is closed — exactly `skip` drops the tagged tests,
//   any other value, or none, runs everything — and the config keeps its
//   retries line, the preset's workers, and never updates or ignores a
//   snapshot (P3-RU-35).
//
// The spec files are read with the TypeScript compiler (already the
// preflight's and the layering check's parser), and the switch is proved
// on Playwright's own listing (`--list` loads the specs; it starts no
// server, no emulator and no browser).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const E2E = join(ROOT, 'apps', 'web', 'e2e');
const CONFIG_PATH = 'apps/web/playwright.config.mts';
const CSP_CONFIG_PATH = 'apps/web/playwright.csp.config.mts';
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const TAG = '@screenshot';
const SWITCH = 'CREATIVO_E2E_SCREENSHOTS';
/** The comparisons that need a baseline image. */
const COMPARISONS = new Set(['toHaveScreenshot', 'toMatchSnapshot']);

/** Every `.ts` file under `dir`, the `*-snapshots` image folders skipped. */
function tsFilesUnder(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith('-snapshots')) files.push(...tsFilesUnder(path));
    } else if (entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files.sort();
}

const calleeText = (call) => call.expression.getText();
const isDescribe = (node) =>
  ts.isCallExpression(node) &&
  /^test\.describe(\.(serial|parallel))?$/.test(calleeText(node));
const isTest = (node) =>
  ts.isCallExpression(node) && calleeText(node) === 'test';
const isComparison = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  COMPARISONS.has(node.expression.name.text);

/** The `tag` literal(s) of a describe's details object, or `[]`. */
function tagNodesOf(call) {
  if (call.arguments.length !== 3) return [];
  const details = call.arguments[1];
  if (!ts.isObjectLiteralExpression(details)) return [];
  const tag = details.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) && property.name.getText() === 'tag',
  );
  if (!tag) return [];
  const value = tag.initializer;
  if (ts.isStringLiteral(value)) return [value];
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.filter((element) => ts.isStringLiteral(element));
  }
  return [];
}

const isTaggedDescribe = (node) =>
  isDescribe(node) && tagNodesOf(node).some((tag) => tag.text === TAG);

/** The ancestors of `node`, innermost first. */
function ancestorsOf(node) {
  const chain = [];
  for (let at = node.parent; at; at = at.parent) chain.push(at);
  return chain;
}

/** What one e2e file holds: its comparisons, tests, tagged describes and stray tag spellings. */
function scan(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found = {
    file: relative(E2E, path),
    comparisons: [],
    tests: [],
    tagged: [],
    tagLiterals: new Set(),
    strays: [],
  };
  const visit = (node) => {
    if (isComparison(node)) found.comparisons.push(node);
    if (isTest(node)) found.tests.push(node);
    if (isTaggedDescribe(node)) {
      found.tagged.push(node);
      for (const tag of tagNodesOf(node)) found.tagLiterals.add(tag);
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(TAG)
    ) {
      found.strays.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  found.strays = found.strays.filter((node) => !found.tagLiterals.has(node));
  return found;
}

const SCANS = tsFilesUnder(E2E).map(scan);

/** The Playwright CLI the workspace pins (`@playwright/test`). */
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve(
  '@playwright/test/cli',
);

/**
 * Playwright's own listing of the e2e suite with the switch at `value`
 * (`null`: unset) — `projectName|testId` keys, and which carry the tag. The
 * environment is cleaned of anything that would steer the run: CI, the
 * switch itself and Playwright's own variables (a JSON output file name
 * would take the listing off stdout).
 */
function listing(value) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'CI' || key === SWITCH || /^(PLAYWRIGHT|PW)_/.test(key)) {
      delete env[key];
    }
  }
  if (value !== null) env[SWITCH] = value;
  const run = spawnSync(
    process.execPath,
    [
      PLAYWRIGHT_CLI,
      'test',
      '--list',
      '--reporter=json',
      '--config',
      CONFIG_PATH,
    ],
    {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  // A spec that fails to load exits 1 with its error in the JSON, not on stderr.
  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    report = null;
  }
  const loadErrors = (report?.errors ?? []).map((error) => error.message);
  assert.equal(
    run.status,
    0,
    `playwright --list exited ${run.status}\n${run.stderr}\n${loadErrors.join('\n')}`,
  );
  assert.ok(report, 'playwright --list printed its JSON report');
  assert.deepEqual(loadErrors, [], 'the specs load');
  const all = new Set();
  const tagged = new Set();
  const taggedFiles = new Set();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const key = `${test.projectName}|${spec.id}`;
        all.add(key);
        if (spec.tags.includes(TAG.slice(1))) {
          tagged.add(key);
          taggedFiles.add(spec.file);
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return { all, tagged, taggedFiles };
}

describe('the e2e screenshot tag', () => {
  it('puts every screenshot comparison inside a describe tagged @screenshot, inside a test', () => {
    const comparisons = SCANS.flatMap((found) =>
      found.comparisons.map((node) => ({ file: found.file, node })),
    );
    assert.ok(comparisons.length > 0, 'the suite takes screenshots');
    for (const { file, node } of comparisons) {
      const chain = ancestorsOf(node);
      const where = `${file}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      assert.ok(chain.some(isTest), `${where} is inside a test`);
      assert.ok(chain.some(isTaggedDescribe), `${where} is tagged ${TAG}`);
    }
  });

  it('tags only screenshot tests: every test of a tagged describe compares a screenshot, counted', () => {
    let screenshotTests = 0;
    let taggedTests = 0;
    for (const found of SCANS) {
      const comparing = new Set(
        found.comparisons.map((node) => ancestorsOf(node).find(isTest)),
      );
      screenshotTests += comparing.size;
      for (const test of found.tests) {
        if (!ancestorsOf(test).some(isTaggedDescribe)) continue;
        taggedTests += 1;
        assert.ok(
          comparing.has(test),
          `${found.file}: the tagged test "${test.arguments[0].getText()}" compares a screenshot`,
        );
      }
    }
    assert.ok(screenshotTests > 0);
    assert.equal(
      taggedTests,
      screenshotTests,
      'the tagged tests are the screenshot tests',
    );
  });

  it('spells the tag nowhere but a describe’s tag option', () => {
    for (const found of SCANS) {
      assert.deepEqual(
        found.strays.map((node) => node.getText()),
        [],
        `${found.file} spells ${TAG} outside a tag option`,
      );
    }
    const files = (predicate) =>
      SCANS.filter(predicate)
        .map((found) => found.file)
        .sort();
    assert.deepEqual(
      files((found) => found.tagged.length > 0),
      files((found) => found.comparisons.length > 0),
      'a file is tagged exactly when it takes screenshots',
    );
  });

  it('keeps the switch closed in the config: exactly `skip` drops the tag', () => {
    const text = read(CONFIG_PATH);
    const source = ts.createSourceFile(
      CONFIG_PATH,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const exported = source.statements.find(ts.isExportAssignment);
    assert.ok(exported, 'the config has a default export');
    const call = exported.expression;
    assert.ok(ts.isCallExpression(call) && calleeText(call) === 'defineConfig');
    const config = call.arguments[0];
    assert.ok(ts.isObjectLiteralExpression(config));
    const valueOf = (name) => {
      const property = config.properties.find(
        (entry) =>
          ts.isPropertyAssignment(entry) && entry.name.getText() === name,
      );
      assert.ok(property, `the config sets ${name}`);
      return property.initializer.getText().replace(/\s+/g, '');
    };
    assert.equal(
      valueOf('grepInvert'),
      `process.env['${SWITCH}']==='skip'?/${TAG}/:undefined`,
    );
    // P3-RU-35: the config's own CI policy stands — this pass never edits it.
    assert.equal(valueOf('retries'), "process.env['CI']?2:0");
    assert.equal(text.split(SWITCH).length - 1, 1, 'the switch is read once');
    const names = [];
    const collect = (node) => {
      if (
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)
      ) {
        names.push(node.name.getText());
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    for (const banned of [
      'workers',
      'grep',
      'updateSnapshots',
      'ignoreSnapshots',
    ]) {
      assert.ok(!names.includes(banned), `the config sets no ${banned}`);
    }
  });

  it('never updates or ignores a snapshot, in the configs or the scripts that run them', () => {
    const texts = [
      CONFIG_PATH,
      CSP_CONFIG_PATH,
      'apps/web/project.json',
      'package.json',
    ].map((path) => [path, read(path)]);
    for (const [path, text] of texts) {
      for (const needle of [
        '--update-snapshots',
        '--ignore-snapshots',
        'updateSnapshots',
        'ignoreSnapshots',
      ]) {
        assert.ok(!text.includes(needle), `${path} holds no ${needle}`);
      }
    }
    // The CSP smoke has its own config and never filters its tests.
    assert.ok(!read(CSP_CONFIG_PATH).includes('grepInvert'));
    assert.ok(!read(CSP_CONFIG_PATH).includes(SWITCH));
  });

  it('drops exactly the tagged tests under `skip`, and nothing under any other value', () => {
    const everything = listing(null);
    assert.ok(everything.tagged.size > 0, 'the listing holds tagged tests');
    assert.deepEqual(
      [...everything.taggedFiles].sort(),
      SCANS.filter((found) => found.tagged.length > 0)
        .map((found) => found.file.split('\\').join('/'))
        .sort(),
      'Playwright reads the tags the source declares',
    );

    const skipped = listing('skip');
    const expected = [...everything.all]
      .filter((key) => !everything.tagged.has(key))
      .sort();
    assert.deepEqual([...skipped.all].sort(), expected);
    assert.equal(skipped.tagged.size, 0);

    for (const value of ['SKIP', '1', 'true']) {
      assert.deepEqual(
        [...listing(value).all].sort(),
        [...everything.all].sort(),
        `${SWITCH}=${value} runs every test`,
      );
    }
  });
});
