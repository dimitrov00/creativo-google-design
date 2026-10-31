// The runbook grep gates, read where they live: the pure half of the runner.
//
//   pnpm nx run verify-tools:runbook-gates     (run-gates.mjs, the CLI)
//
// `docs/architecture/firestore-runbook.md` §4 holds the per-flip grep gates as
// fenced bash blocks — the §4.0 preamble (the arrays and the `gate`, `review`
// and `index_gate` helpers) and one block per flip or pass. The runbook stays
// their ONLY copy: these functions find the blocks at run time, wrap each in
// the preamble and an exit trailer, and read the verdict off the printed
// lines. Nothing here touches the disk, a process or the clock, so
// runbook-gates.spec.mjs pins every rule on plain strings.

/** A `### 4.N ` heading: the prefix plus its trailing space, so 4.1 is never 4.10. */
const SECTION_HEADING = /^### (4\.\d+) (.*)$/;

/** The opening fence of a gate block. */
const BASH_FENCE = /^```bash\s*$/;

/** Any fence line (an opening one with its language, or a closing one). */
const ANY_FENCE = /^```/;

/**
 * Sections the default run leaves out, each with the reason it prints. §4.1 is
 * flip 1's own gate, written for the flip-1 tree: its exclusions lapsed when
 * flip 2 landed, and §4.2's step 1 re-runs flip 1's gates with them dropped.
 */
export const DEFAULT_SKIP = {
  4.1: 'superseded — §4.2 step 1 re-runs flip 1 with its exclusions dropped',
};

/** The section every script starts with: the arrays and the helpers. */
export const PREAMBLE_ID = '4.0';

/**
 * The `### 4.N ` sections of the runbook, in document order. A section ends
 * at the next `### ` or `## ` heading outside a fence (a `#` comment inside a
 * bash block never ends one); its block is the lines between its FIRST
 * ```` ```bash ```` fence and the next fence, or `null` when it has none
 * (§4.6, the allowlist, is prose and a table).
 *
 * @param {string} markdown
 * @returns {{ id: string, heading: string, block: string | null }[]}
 */
export function sectionsOf(markdown) {
  const sections = [];
  let current = null;
  let inFence = false;
  let collecting = false;
  let lines = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (inFence) {
      if (ANY_FENCE.test(line)) {
        inFence = false;
        if (collecting) {
          current.block = lines.join('\n');
          collecting = false;
        }
      } else if (collecting) {
        lines.push(line);
      }
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('### ')) {
      const heading = SECTION_HEADING.exec(line);
      current = heading
        ? { id: heading[1], heading: heading[2].trim(), block: null }
        : null;
      if (current) sections.push(current);
      continue;
    }
    if (ANY_FENCE.test(line)) {
      inFence = true;
      if (current && current.block === null && BASH_FENCE.test(line)) {
        collecting = true;
        lines = [];
      }
    }
  }
  return sections;
}

/**
 * The script one section runs: the §4.0 preamble, the block, then
 * `[ "$FAILED" = 0 ]`. Every block ends in an echo
 * (`… && echo '… gate: PASS' || echo '… gate: FAIL'`) whose exit code is 0
 * either way; the trailer makes the script's exit code the gate's verdict.
 *
 * @param {string} preamble
 * @param {string} block
 * @returns {string}
 */
export function scriptFor(preamble, block) {
  return `${preamble}\n\n${block}\n\n[ "$FAILED" = 0 ]\n`;
}

/** A block's closing line: `<label> gate: PASS`. */
const PASS_LINE = /^[\w .-]+ gate: PASS$/;

/**
 * The lines a section printed, counted: `ok `, `FAIL `, `ERROR ` (the
 * helpers' verdict lines), `----  review:` (an informational list), and
 * whether the block's own `… gate: PASS` line printed.
 *
 * @param {string} log
 * @returns {{ ok: number, fail: number, error: number, review: number, passLine: boolean }}
 */
export function tally(log) {
  const counts = { ok: 0, fail: 0, error: 0, review: 0, passLine: false };
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith('ok ')) counts.ok += 1;
    else if (line.startsWith('FAIL ')) counts.fail += 1;
    else if (line.startsWith('ERROR ')) counts.error += 1;
    else if (line.startsWith('----  review:')) counts.review += 1;
    else if (PASS_LINE.test(line)) counts.passLine = true;
  }
  return counts;
}

/**
 * A section passes iff its script exited 0, it printed no `FAIL` and no
 * `ERROR`, at least one `ok` (a block that prints nothing proves nothing —
 * an empty extraction is a failure) and its `gate: PASS` line.
 *
 * @param {{ ok: number, fail: number, error: number, passLine: boolean }} tallied
 * @param {number | null} exitCode
 * @returns {boolean}
 */
export function verdict(tallied, exitCode) {
  return (
    exitCode === 0 &&
    tallied.fail === 0 &&
    tallied.error === 0 &&
    tallied.ok >= 1 &&
    tallied.passLine
  );
}

/**
 * Which sections a run takes. With no request: every section with a block
 * but the preamble, minus `skip` (each skipped id reported with its reason).
 * With a request: exactly those ids, in the order asked; an unknown id, the
 * preamble itself or a section without a block is refused.
 *
 * @param {{ id: string, block: string | null }[]} sections
 * @param {string[] | null} requested
 * @param {Record<string, string>} skip
 * @returns {{ run: string[], skipped: { id: string, reason: string }[], refused: string[] }}
 */
export function selectionOf(sections, requested, skip = DEFAULT_SKIP) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  if (requested) {
    const refused = requested.filter(
      (id) =>
        id === PREAMBLE_ID || !byId.has(id) || byId.get(id).block === null,
    );
    return { run: refused.length ? [] : [...requested], skipped: [], refused };
  }
  const run = [];
  const skipped = [];
  for (const { id, block } of sections) {
    if (id === PREAMBLE_ID || block === null) continue;
    if (Object.hasOwn(skip, id)) skipped.push({ id, reason: skip[id] });
    else run.push(id);
  }
  return { run, skipped, refused: [] };
}

/**
 * The untracked paths a run left behind: in `after`, not in `before` (a gate
 * that writes a canary and is interrupted before it deletes it).
 *
 * @param {string[]} before
 * @param {string[]} after
 * @returns {string[]}
 */
export function leakedPaths(before, after) {
  const known = new Set(before);
  return after.filter((path) => path !== '' && !known.has(path));
}

/**
 * One section's report line: `§4.2 ok=28 FAIL=0 ERROR=0 review=2 (3.1s)`.
 *
 * @param {string} id
 * @param {{ ok: number, fail: number, error: number, review: number }} tallied
 * @param {number} elapsedMs
 * @returns {string}
 */
export function reportLine(id, tallied, elapsedMs) {
  const seconds = (elapsedMs / 1000).toFixed(1);
  return `§${id} ok=${tallied.ok} FAIL=${tallied.fail} ERROR=${tallied.error} review=${tallied.review} (${seconds}s)`;
}

/**
 * The environment a gate's bash runs in: the caller's, with colour OFF.
 * Several gates parse a nested tool's printed figures (§4.9 counts the
 * canary in `nx lint`'s summary); run under `nx run`, Nx forces colour into
 * its tasks (`FORCE_COLOR`), the nested tool then prints ANSI codes around
 * the figures, and a gate misreads its own count. `NO_COLOR` wins in every
 * colour library the workspace uses; `FORCE_COLOR` is dropped.
 */
export function gateEnvOf(env) {
  const rest = { ...env };
  delete rest.FORCE_COLOR;
  return { ...rest, NO_COLOR: '1' };
}
