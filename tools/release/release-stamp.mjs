#!/usr/bin/env node
// The release stamp (ADR 2026-11-18, R9): the one name a build carries —
// compiled into the web bundle (`CREATIVO_RELEASE`, an esbuild define) and
// written into the functions' `.env.<project>` (`CREATIVO_RELEASE`, the
// flags writer), so a client issue and a server line both say which build
// they came from.
//
//   node tools/release/release-stamp.mjs --ref refs/tags/v0.4.1 --sha <sha>   # → 0.4.1
//   node tools/release/release-stamp.mjs --ref refs/heads/main --sha <sha>    # → 0.4.1+abc1234
//
// A tag build is the release itself: the tag must be `v<package.json
// version>` (release-please writes both in one commit), or the stamp is
// refused — a tag and a manifest that disagree name no release. A branch
// build is the manifest's version at that commit, the short sha as semver
// build metadata: `0.4.1+abc1234` reads "0.4.1, plus whatever landed since,
// at abc1234".
//
// Prints the stamp alone on stdout. Exits 1 when it cannot name one, 2 on
// unreadable arguments. The pure part is exported for the spec.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A release version as release-please writes it: plain `X.Y.Z`. */
const VERSION = /^\d+\.\d+\.\d+$/;
/** A full or abbreviated commit sha. */
const SHA = /^[0-9a-f]{7,40}$/;
/** How much of the sha a branch stamp keeps — git's own short form. */
const SHORT_SHA = 7;
/** The prefix of a tag ref. */
const TAG_REF = 'refs/tags/';
/** The prefix of a branch ref. */
const BRANCH_REF = 'refs/heads/';

/**
 * The stamp of a build of `ref` at `sha`, the manifest at `version` — or
 * `{ error }`, a sentence, when no stamp can be named.
 */
export function releaseStamp({ version, ref, sha }) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return {
      error: `package.json's version ${JSON.stringify(version ?? null)} is not X.Y.Z`,
    };
  }
  if (typeof ref !== 'string' || ref === '') {
    return { error: 'no ref — pass --ref (the workflow’s github.ref)' };
  }
  if (ref.startsWith(TAG_REF)) {
    const tag = ref.slice(TAG_REF.length);
    return tag === `v${version}`
      ? { stamp: version }
      : {
          error: `the tag ${tag} is not the release package.json names (v${version}) — a release tag and its manifest are written in one commit`,
        };
  }
  if (!ref.startsWith(BRANCH_REF)) {
    return { error: `${ref} is neither a branch nor a tag` };
  }
  if (typeof sha !== 'string' || !SHA.test(sha)) {
    return {
      error: `a branch build needs its commit — ${JSON.stringify(sha ?? null)} is no sha`,
    };
  }
  return { stamp: `${version}+${sha.slice(0, SHORT_SHA)}` };
}

/** The command: the stamp on stdout, the exit code answered. */
export function main({ args, readVersion, print, warn }) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: { ref: { type: 'string' }, sha: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    warn(
      `release-stamp: ${error.message}\nusage: node tools/release/release-stamp.mjs --ref <ref> [--sha <sha>]`,
    );
    return 2;
  }
  const answer = releaseStamp({
    version: readVersion(),
    ref: values.ref,
    sha: values.sha,
  });
  if (answer.error !== undefined) {
    warn(`release-stamp: ${answer.error}`);
    return 1;
  }
  print(answer.stamp);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main({
    args: process.argv.slice(2),
    readVersion: () =>
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
