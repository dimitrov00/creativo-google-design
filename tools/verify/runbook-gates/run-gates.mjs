#!/usr/bin/env node
// Runs the runbook grep gates — `docs/architecture/firestore-runbook.md` §4 —
// from the runbook itself: the gates' only copy stays there.
//
//   pnpm nx run verify-tools:runbook-gates      (or: pnpm run verify:runbook)
//   node tools/verify/runbook-gates/run-gates.mjs [--runbook=<path>]
//        [--sections=4.2,4.3,…] [--allow-dirty] [--cleanup]
//
// Every section `### 4.N ` with a bash block runs ALONE in a fresh bash, as
// one script: the §4.0 preamble, the block, then `[ "$FAILED" = 0 ]` (each
// block ends in an echo that would mask its exit code). The default run takes
// every such section but §4.0 (always prepended) and DEFAULT_SKIP (printed
// with its reason). The scripts and their logs go to a fresh directory under
// the OS temp dir — never inside the repository. A section passes on exit 0,
// no `FAIL`, no `ERROR`, at least one `ok` and its `gate: PASS` line.
//
// The gates write a transient canary (§4.9) and read untracked files
// (`git grep --untracked`), so the tree must be clean before the first
// section (`--allow-dirty` waives it, e.g. before a commit) and any NEW
// untracked path after the last is a leak: a FAIL, removed with `--cleanup`
// (on by default when CI is set).
//
// Exit 0 when every section passes; 1 on a FAIL, an ERROR, an empty or
// failing section, or a leak; 2 on a usage error, an unreadable runbook, a
// missing bash or git, a missing preamble, an unknown section or a dirty tree.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
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

/** The runbook, repo-relative. */
export const DEFAULT_RUNBOOK = 'docs/architecture/firestore-runbook.md';

/** Room for the review lists a section prints (spawnSync's default is 1 MiB). */
const MAX_BUFFER = 512 * 1024 * 1024;

/** `git status` in the machine form, every untracked file listed. */
const PORCELAIN_ARGS = 'status --porcelain=v1 --untracked-files=all'.split(' ');

/** Untracked, not ignored files, one per line. */
const UNTRACKED_ARGS = 'ls-files --others --exclude-standard'.split(' ');

const USAGE =
  'usage: run-gates.mjs [--runbook=<path>] [--sections=4.2,4.3,…] [--allow-dirty] [--cleanup]';

/** A spawned process's exit code; `null` when it never ran or was killed. */
function exitCodeOf(result) {
  return result.error ? null : result.status;
}

/** Parses the flags; `null` on an unknown one. */
function optionsOf(argv, env) {
  const options = {
    runbook: DEFAULT_RUNBOOK,
    sections: null,
    allowDirty: false,
    cleanup: Boolean(env.CI),
  };
  for (const argument of argv) {
    if (argument.startsWith('--runbook=')) {
      options.runbook = argument.slice('--runbook='.length);
    } else if (argument.startsWith('--sections=')) {
      options.sections = argument
        .slice('--sections='.length)
        .split(',')
        .map((id) => id.trim().replace(/^§/, ''))
        .filter((id) => id !== '');
    } else if (argument === '--allow-dirty') {
      options.allowDirty = true;
    } else if (argument === '--cleanup') {
      options.cleanup = true;
    } else {
      return null;
    }
  }
  return options;
}

/** Runs git in `cwd`; `{ code, out }`. */
function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  return { code: exitCodeOf(result), out: result.stdout ?? '' };
}

function untrackedOf(root) {
  return git(root, UNTRACKED_ARGS).out.split('\n').filter(Boolean);
}

function main(argv, env) {
  const options = optionsOf(argv, env);
  if (!options) {
    console.error(USAGE);
    return 2;
  }
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) {
    console.error('ERROR git is missing, or this is not inside a repository');
    return 2;
  }
  const root = top.out.trim();
  if (exitCodeOf(spawnSync('bash', ['-c', 'true'])) !== 0) {
    console.error('ERROR bash is missing');
    return 2;
  }

  const runbookPath = resolve(root, options.runbook);
  let markdown;
  try {
    markdown = readFileSync(runbookPath, 'utf8');
  } catch {
    console.error(`ERROR cannot read the runbook ${runbookPath}`);
    return 2;
  }
  const sections = sectionsOf(markdown);
  const preamble = sections.find((section) => section.id === PREAMBLE_ID);
  if (!preamble || preamble.block === null) {
    console.error(`ERROR no §${PREAMBLE_ID} preamble block in ${runbookPath}`);
    return 2;
  }
  const selection = selectionOf(sections, options.sections, DEFAULT_SKIP);
  if (selection.refused.length > 0) {
    console.error(
      `ERROR not a gate section with a bash block: ${selection.refused.map((id) => `§${id}`).join(', ')}`,
    );
    return 2;
  }
  if (selection.run.length === 0) {
    console.error(`ERROR no gate section found in ${runbookPath}`);
    return 2;
  }

  const dirty = git(root, PORCELAIN_ARGS);
  if (dirty.code !== 0) {
    console.error('ERROR git cannot read the working tree');
    return 2;
  }
  if (dirty.out.trim() !== '' && !options.allowDirty) {
    console.error(
      'ERROR the working tree is not clean (the gates read untracked files); commit or stash, or pass --allow-dirty',
    );
    console.error(dirty.out.trimEnd());
    return 2;
  }
  const untrackedBefore = untrackedOf(root);

  const workDir = mkdtempSync(join(tmpdir(), 'runbook-gates-'));
  console.log(
    `Runbook gates — ${runbookPath}; scripts and logs in ${workDir}.`,
  );
  for (const { id, reason } of selection.skipped) {
    console.log(`§${id} skipped — ${reason}`);
  }

  const byId = new Map(sections.map((section) => [section.id, section]));
  const failed = [];
  for (const id of selection.run) {
    const script = join(workDir, `gate-${id}.sh`);
    writeFileSync(script, scriptFor(preamble.block, byId.get(id).block));
    const started = performance.now();
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      env: gateEnvOf(env),
      maxBuffer: MAX_BUFFER,
    });
    const elapsed = performance.now() - started;
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    writeFileSync(join(workDir, `gate-${id}.log`), log);
    const tallied = tally(result.stdout ?? '');
    const passed = verdict(tallied, exitCodeOf(result));
    console.log(
      `${reportLine(id, tallied, elapsed)} ${passed ? 'PASS' : 'FAIL'}`,
    );
    if (!passed) {
      failed.push(`§${id}`);
      console.log(`---- §${id} output:`);
      console.log(log.trimEnd() || '(no output)');
      console.log(`---- end of §${id}`);
    }
  }

  const leaked = leakedPaths(untrackedBefore, untrackedOf(root));
  if (leaked.length > 0) {
    failed.push('leaked files');
    console.log(`FAIL  ${leaked.length} untracked path(s) left by the gates:`);
    for (const path of leaked) {
      if (options.cleanup) rmSync(join(root, path), { force: true });
      console.log(`      ${path}${options.cleanup ? ' (removed)' : ''}`);
    }
    if (!options.cleanup) console.log('      (pass --cleanup to remove them)');
  }

  if (failed.length > 0) {
    console.log(`\nRunbook gates: FAIL — ${failed.join(', ')}`);
    return 1;
  }
  console.log(
    `\nRunbook gates: PASS — ${selection.run.length} section(s), §${PREAMBLE_ID} prepended to each.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
