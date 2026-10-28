// node --test tools/verify/runbook-gates/runbook-gates.spec.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SKIP,
  PREAMBLE_ID,
  gateEnvOf,
  leakedPaths,
  reportLine,
  scriptFor,
  sectionsOf,
  selectionOf,
  tally,
  verdict,
} from './runbook-gates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'run-gates.mjs');
const RUNBOOK = resolve(
  HERE,
  '..',
  '..',
  '..',
  'docs',
  'architecture',
  'firestore-runbook.md',
);

const FENCE = '```';

/** A synthetic runbook from neutral words: sections `[id, heading, block | null]`. */
function runbookOf(sections, tail = '## 5. After\n\nprose\n') {
  const parts = ['# Book', '', '## 4. Gates', '', 'intro', ''];
  for (const [id, heading, block] of sections) {
    parts.push(`### ${id} ${heading}`, '', 'prose before the block', '');
    if (block !== null) parts.push(`${FENCE}bash`, block, FENCE, '');
    parts.push('prose after the block', '');
  }
  return `${parts.join('\n')}\n${tail}`;
}

/** The fixture preamble: the real one's `gate` helper over `git grep`. */
const PREAMBLE = [
  'cd "$(git rev-parse --show-toplevel)" || echo \'ERROR run this inside the repository\'',
  'FAILED=0',
  'gate() { local label=$1; shift',
  '  git grep --untracked -nI "$@"',
  '  case $? in 0) echo "FAIL  $label"; FAILED=1 ;; 1) echo "ok    $label" ;; *) echo "ERROR $label"; FAILED=1 ;; esac; }',
].join('\n');

/** A block in the runbook's shape: one gate on a word, then its closing echo. */
function wordBlock(label, word) {
  return [
    'FAILED=0',
    `gate '${label} · no ${word}' -wF ${word} -- .`,
    `[ "$FAILED" = 0 ] && echo '${label} gate: PASS' || echo '${label} gate: FAIL'`,
  ].join('\n');
}

describe('sectionsOf — the real runbook', () => {
  const sections = sectionsOf(readFileSync(RUNBOOK, 'utf8'));
  const byId = new Map(sections.map((section) => [section.id, section]));

  it('finds the sections 4.0 … 4.10 in order', () => {
    assert.deepEqual(
      sections.map((section) => section.id),
      [
        '4.0',
        '4.1',
        '4.2',
        '4.3',
        '4.4',
        '4.5',
        '4.6',
        '4.7',
        '4.8',
        '4.9',
        '4.10',
      ],
    );
  });

  it('§4.6, the allowlist, has no block', () => {
    assert.equal(byId.get('4.6').block, null);
  });

  it('§4.0 starts in the repository root and defines gate, review and index_gate', () => {
    const preamble = byId.get('4.0').block;
    assert.ok(preamble.startsWith('cd "$(git rev-parse --show-toplevel)"'));
    const lines = preamble.split('\n');
    for (const helper of ['gate', 'review', 'index_gate']) {
      assert.ok(
        lines.some((line) => line.startsWith(`${helper}() {`)),
        helper,
      );
    }
    assert.match(preamble, /^FAILED=0$/m);
  });

  it('every other block resets FAILED and ends in its gate echo', () => {
    const blocks = sections.filter(
      (section) => section.id !== PREAMBLE_ID && section.block !== null,
    );
    assert.equal(blocks.length, 9);
    for (const { id, block } of blocks) {
      const lines = block.split('\n');
      // 4.3 and 4.4 restate their own lists after a `cd`, then reset FAILED.
      assert.ok(
        lines[0] === 'FAILED=0' ||
          lines[0].startsWith('cd "$(git rev-parse --show-toplevel)"'),
        `§${id} starts with: ${lines[0]}`,
      );
      assert.ok(lines.includes('FAILED=0'), `§${id} resets FAILED`);
      assert.match(
        lines.at(-1),
        /^\[ "\$FAILED" = 0 \] && echo '[\w .-]+ gate: PASS' \|\| echo '[\w .-]+ gate: FAIL'$/,
        `§${id} ends with: ${lines.at(-1)}`,
      );
    }
  });

  it('the default run takes §4.2–§4.5 and §4.7–§4.10, skipping §4.1 with its reason', () => {
    const selection = selectionOf(sections, null);
    assert.deepEqual(selection.run, [
      '4.2',
      '4.3',
      '4.4',
      '4.5',
      '4.7',
      '4.8',
      '4.9',
      '4.10',
    ]);
    assert.deepEqual(selection.skipped, [
      { id: '4.1', reason: DEFAULT_SKIP['4.1'] },
    ]);
    assert.deepEqual(selection.refused, []);
  });
});

describe('sectionsOf — a synthetic document', () => {
  const markdown = runbookOf([
    ['4.0', 'Preamble', 'echo zero'],
    ['4.1', 'One', 'echo one'],
    ['4.10', 'Ten', 'echo ten'],
    ['4.6', 'Prose only', null],
  ]);

  it('keeps 4.1 and 4.10 apart (the heading prefix carries its space)', () => {
    const sections = sectionsOf(markdown);
    assert.deepEqual(
      sections.map(({ id, heading, block }) => [id, heading, block]),
      [
        ['4.0', 'Preamble', 'echo zero'],
        ['4.1', 'One', 'echo one'],
        ['4.10', 'Ten', 'echo ten'],
        ['4.6', 'Prose only', null],
      ],
    );
  });

  it('takes the FIRST bash block only, and a heading-like comment inside a fence ends nothing', () => {
    const doc = [
      '### 4.2 Two',
      '',
      `${FENCE}text`,
      'not bash',
      FENCE,
      `${FENCE}bash`,
      'echo first',
      '## a comment, not a heading',
      '### neither is this',
      'echo still first',
      FENCE,
      `${FENCE}bash`,
      'echo second',
      FENCE,
      '### 4.3 Three',
      `${FENCE}bash`,
      'echo three',
      FENCE,
    ].join('\n');
    assert.deepEqual(sectionsOf(doc), [
      {
        id: '4.2',
        heading: 'Two',
        block:
          'echo first\n## a comment, not a heading\n### neither is this\necho still first',
      },
      { id: '4.3', heading: 'Three', block: 'echo three' },
    ]);
  });

  it('a `## ` heading ends the section, and a block after it belongs to none', () => {
    const doc = [
      '### 4.2 Two',
      'prose',
      '## 5. Next chapter',
      `${FENCE}bash`,
      'echo stray',
      FENCE,
      '### 5.1 Not a gate',
      `${FENCE}bash`,
      'echo other',
      FENCE,
    ].join('\n');
    assert.deepEqual(sectionsOf(doc), [
      { id: '4.2', heading: 'Two', block: null },
    ]);
  });

  it('is pure: the same text gives equal, independent answers', () => {
    const first = sectionsOf(markdown);
    const second = sectionsOf(markdown);
    assert.deepEqual(first, second);
    first[0].block = 'changed';
    assert.equal(sectionsOf(markdown)[0].block, 'echo zero');
    assert.notEqual(first, second);
  });
});

describe('scriptFor', () => {
  it('is the preamble, the block, then the exit trailer', () => {
    assert.equal(
      scriptFor('PRE', 'BLOCK'),
      'PRE\n\nBLOCK\n\n[ "$FAILED" = 0 ]\n',
    );
  });
});

describe('tally and verdict', () => {
  const passing = [
    'ok    alpha · one',
    'ok    alpha · two',
    '----  review: beta',
    'some/file.ts:3:beta',
    'alpha gate: PASS',
  ].join('\n');

  it('counts the helper lines and the PASS line', () => {
    assert.deepEqual(tally(passing), {
      ok: 2,
      fail: 0,
      error: 0,
      review: 1,
      passLine: true,
    });
    assert.deepEqual(
      tally('FAIL  alpha\nERROR beta\nok    gamma\nalpha gate: FAIL'),
      { ok: 1, fail: 1, error: 1, review: 0, passLine: false },
    );
  });

  it('a hit line or a path never counts as a verdict', () => {
    assert.deepEqual(tally('docs/ok notes.md:1:FAIL here\nx: gate: PASS'), {
      ok: 0,
      fail: 0,
      error: 0,
      review: 0,
      passLine: false,
    });
  });

  it('passes only on exit 0, no FAIL, no ERROR, an ok and the PASS line', () => {
    const good = tally(passing);
    assert.equal(verdict(good, 0), true);
    assert.equal(verdict(good, 1), false);
    assert.equal(verdict(good, null), false);
    assert.equal(verdict({ ...good, fail: 1 }, 0), false);
    assert.equal(verdict({ ...good, error: 1 }, 0), false);
    assert.equal(verdict({ ...good, ok: 0 }, 0), false);
    assert.equal(verdict({ ...good, passLine: false }, 0), false);
    assert.equal(verdict(tally(''), 0), false);
  });

  it('reports one line per section', () => {
    assert.equal(
      reportLine(
        '4.2',
        { ok: 28, fail: 0, error: 0, review: 2, passLine: true },
        3140,
      ),
      '§4.2 ok=28 FAIL=0 ERROR=0 review=2 (3.1s)',
    );
  });
});

describe('selectionOf and leakedPaths', () => {
  const sections = [
    { id: '4.0', block: 'pre' },
    { id: '4.1', block: 'one' },
    { id: '4.2', block: 'two' },
    { id: '4.6', block: null },
  ];

  it('runs a request as asked, and refuses the preamble, a blockless or an unknown id', () => {
    assert.deepEqual(selectionOf(sections, ['4.2', '4.1']), {
      run: ['4.2', '4.1'],
      skipped: [],
      refused: [],
    });
    assert.deepEqual(selectionOf(sections, ['4.0', '4.6', '4.9', '4.2']), {
      run: [],
      skipped: [],
      refused: ['4.0', '4.6', '4.9'],
    });
  });

  it('honours the skip table it is given', () => {
    assert.deepEqual(selectionOf(sections, null, {}).run, ['4.1', '4.2']);
  });

  it('lists only the paths that appeared', () => {
    assert.deepEqual(leakedPaths(['a', 'b'], ['a', 'b', 'c', '']), ['c']);
    assert.deepEqual(leakedPaths(['a'], []), []);
  });
});

describe('run-gates.mjs in a scratch repository', () => {
  /** Every scratch directory this suite made, removed when it ends. */
  const bases = [];
  after(() => {
    for (const base of bases) rmSync(base, { recursive: true, force: true });
  });

  /** A fresh git repository (no commit) and a runbook outside it. */
  function scratch(sections) {
    const base = mkdtempSync(join(tmpdir(), 'runbook-gates-spec-'));
    bases.push(base);
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const init = spawnSync('git', ['init', '-q'], { cwd: repo });
    assert.equal(init.error, undefined);
    const runbook = join(base, 'runbook.md');
    writeFileSync(runbook, runbookOf(sections));
    return { repo, runbook };
  }

  /** Runs the CLI in `repo`; its own work directory lands beside the repo. */
  function run(repo, args) {
    const env = { ...process.env, TMPDIR: dirname(repo) };
    delete env.CI;
    const result = spawnSync('node', [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env,
    });
    return {
      code: result.error ? null : result.status,
      out: `${result.stdout}${result.stderr}`,
    };
  }

  it('a gate whose word is absent passes (exit 0, ok)', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', wordBlock('alpha', 'alpha')],
    ]);
    const { code, out } = run(repo, [`--runbook=${runbook}`]);
    assert.equal(code, 0, out);
    assert.match(out, /^§4\.2 ok=1 FAIL=0 ERROR=0 review=0 \([\d.]+s\) PASS$/m);
    assert.match(out, /Runbook gates: PASS/);
  });

  it('a gate whose word is present fails (exit 1, FAIL)', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', wordBlock('alpha', 'alpha')],
      ['4.3', 'Three', wordBlock('beta', 'beta')],
    ]);
    writeFileSync(join(repo, 'notes.txt'), 'alpha\n');
    const { code, out } = run(repo, [`--runbook=${runbook}`, '--allow-dirty']);
    assert.equal(code, 1, out);
    assert.match(out, /^§4\.2 ok=0 FAIL=1 ERROR=0 review=0 .* FAIL$/m);
    assert.match(out, /^notes\.txt:1:alpha$/m);
    assert.match(out, /^§4\.3 ok=1 FAIL=0 .* PASS$/m);
    assert.match(out, /Runbook gates: FAIL — §4\.2$/m);
  });

  it('a block that prints nothing fails', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', 'true'],
    ]);
    const { code, out } = run(repo, [`--runbook=${runbook}`]);
    assert.equal(code, 1, out);
    assert.match(out, /^§4\.2 ok=0 FAIL=0 ERROR=0 review=0 .* FAIL$/m);
  });

  it('runs only the requested sections, and skips §4.1 by default', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.1', 'One', wordBlock('alpha', 'alpha')],
      ['4.2', 'Two', wordBlock('beta', 'beta')],
    ]);
    const byDefault = run(repo, [`--runbook=${runbook}`]);
    assert.equal(byDefault.code, 0, byDefault.out);
    assert.match(byDefault.out, /^§4\.1 skipped — superseded/m);
    assert.doesNotMatch(byDefault.out, /^§4\.1 ok=/m);
    const asked = run(repo, [`--runbook=${runbook}`, '--sections=4.1']);
    assert.equal(asked.code, 0, asked.out);
    assert.match(asked.out, /^§4\.1 ok=1 /m);
    assert.doesNotMatch(asked.out, /^§4\.2 ok=/m);
  });

  it('a file the gates leave behind is a FAIL, removed with --cleanup', () => {
    const leaking = [
      'FAILED=0',
      'printf gamma > left-behind.txt',
      "gate 'alpha · no alpha' -wF alpha -- .",
      `[ "$FAILED" = 0 ] && echo 'leak gate: PASS' || echo 'leak gate: FAIL'`,
    ].join('\n');
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', leaking],
    ]);
    const kept = run(repo, [`--runbook=${runbook}`]);
    assert.equal(kept.code, 1, kept.out);
    assert.match(kept.out, /^§4\.2 ok=1 FAIL=0 .* PASS$/m);
    assert.match(kept.out, /untracked path\(s\) left by the gates/);
    assert.match(kept.out, /^ {6}left-behind\.txt$/m);
    assert.ok(existsSync(join(repo, 'left-behind.txt')));

    const swept = run(repo, [
      `--runbook=${runbook}`,
      '--allow-dirty',
      '--cleanup',
    ]);
    // The file was there before this run, so it is not this run's leak.
    assert.equal(swept.code, 0, swept.out);

    const fresh = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', leaking],
    ]);
    const cleaned = run(fresh.repo, [
      `--runbook=${fresh.runbook}`,
      '--cleanup',
    ]);
    assert.equal(cleaned.code, 1, cleaned.out);
    assert.match(cleaned.out, /^ {6}left-behind\.txt \(removed\)$/m);
    assert.equal(existsSync(join(fresh.repo, 'left-behind.txt')), false);
  });

  it('refuses a dirty tree before the first section (exit 2)', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', wordBlock('alpha', 'alpha')],
    ]);
    writeFileSync(join(repo, 'draft.txt'), 'beta\n');
    const { code, out } = run(repo, [`--runbook=${runbook}`]);
    assert.equal(code, 2, out);
    assert.match(out, /working tree is not clean/);
    assert.doesNotMatch(out, /^§4\.2 ok=/m);
  });

  it('exits 2 on an unknown section, a missing preamble, an unreadable runbook or an unknown flag', () => {
    const { repo, runbook } = scratch([
      ['4.0', 'Preamble', PREAMBLE],
      ['4.2', 'Two', wordBlock('alpha', 'alpha')],
    ]);
    assert.equal(run(repo, [`--runbook=${runbook}`, '--sections=4.9']).code, 2);
    assert.equal(run(repo, [`--runbook=${runbook}`, '--sections=4.0']).code, 2);
    assert.equal(run(repo, [`--runbook=${runbook}.missing`]).code, 2);
    assert.equal(run(repo, [`--runbook=${runbook}`, '--fast']).code, 2);
    const bare = scratch([['4.2', 'Two', wordBlock('alpha', 'alpha')]]);
    const missing = run(bare.repo, [`--runbook=${bare.runbook}`]);
    assert.equal(missing.code, 2, missing.out);
    assert.match(missing.out, /no §4\.0 preamble/);
  });
});

describe('gateEnvOf — a gate runs with colour off', () => {
  it('drops FORCE_COLOR, sets NO_COLOR and keeps everything else', () => {
    const env = { PATH: '/usr/bin', FORCE_COLOR: 'true', CI: 'true' };
    assert.deepEqual(gateEnvOf(env), {
      PATH: '/usr/bin',
      CI: 'true',
      NO_COLOR: '1',
    });
    // The caller's environment is not touched.
    assert.equal(env.FORCE_COLOR, 'true');
  });
});
