#!/usr/bin/env node
// Points a deploy's checkout at its project (ADR 2026-11-18, E10). Run by
// the deploy workflows in the CI runner's throwaway checkout, never in a
// working tree anyone edits.
//
//   node tools/release/deploy-target.mjs --project <id> --environment staging|production
//
// One `firebase.json` serves both projects, but its CSP names ONE callables
// host — the CSP gate (tools/verify/csp/check-csp.mjs, check (d)) and the
// preflight's P5 refuse a second. The committed file names the placeholder
// project's host; this swaps it for the target project's, and nothing else:
// the placeholder host must occur exactly once in the file's text, and the
// rest of the text is kept byte for byte. `.firebaserc` gets the project as
// its default and the project's `web` hosting target (its default site, the
// project id), so the CLI, the CSP gate and the preflight's fallback all
// read the same project. Its `staging` / `production` alias, once the owner
// replaces the placeholder, must name the same project.
//
// Refuses (exit 1) a legacy project, the placeholder, a demo project, a
// malformed id, an alias that names another project, or a firebase.json
// that names the placeholder host other than once; 2 on bad arguments.
// Idempotent: a checkout already pointed at the project is left as it is.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { functionsHost } from '../verify/csp/check-csp.mjs';
import { isLegacyProject, legacyRefusal } from './legacy-projects.mjs';

/** The environments a deploy targets — the GitHub Environments of the same names. */
export const DEPLOY_ENVIRONMENTS = ['staging', 'production'];

/** A Google Cloud project id. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
/** The committed placeholder's spelling (`.firebaserc`, the web config). */
const PLACEHOLDER = /REPLACE_ME|replace-me/;

/** Why `projectId` is no deploy target, or `null` when it is one. */
export function targetProblem(projectId) {
  if (typeof projectId !== 'string' || projectId === '') {
    return 'no project — the environment has no FIREBASE_PROJECT_ID variable';
  }
  if (isLegacyProject(projectId)) return legacyRefusal(projectId);
  if (PLACEHOLDER.test(projectId)) return `${projectId} is the placeholder`;
  if (projectId.startsWith('demo-')) {
    return `${projectId} is a demo project — the emulators' only`;
  }
  if (!PROJECT_ID.test(projectId)) {
    return `${projectId} is not a Google Cloud project id`;
  }
  return null;
}

/** How many times `needle` occurs in `text`. */
const occurrences = (text, needle) => text.split(needle).length - 1;

/**
 * `firebase.json`'s text with the callables host of `fromProject` swapped
 * for `toProject`'s — `{ text }`, or `{ error }` unless the old host occurs
 * exactly once (or the new one already does, alone: pointed before).
 */
export function pointFirebaseJson(text, fromProject, toProject) {
  const from = functionsHost(fromProject);
  const to = functionsHost(toProject);
  const olds = occurrences(text, from);
  const news = occurrences(text, to);
  if (olds === 0 && news === 1) return { text };
  if (from === to && olds === 1) return { text };
  if (olds !== 1 || news !== 0) {
    return {
      error: `firebase.json names ${from} ${olds} time(s) and ${to} ${news} time(s) — it must name the placeholder's callables host once`,
    };
  }
  return { text: text.replace(from, to) };
}

/**
 * `.firebaserc` pointed at `projectId` for `environment`: the default
 * project, and the project's `web` target on its default site — or
 * `{ error }` when the environment's alias names another real project.
 */
export function pointFirebaserc(rc, projectId, environment) {
  const alias = rc.projects?.[environment];
  if (
    typeof alias === 'string' &&
    !PLACEHOLDER.test(alias) &&
    alias !== projectId
  ) {
    return {
      error: `.firebaserc's ${environment} alias names ${alias}, but the ${environment} environment deploys ${projectId} — make them one`,
    };
  }
  return {
    rc: {
      ...rc,
      projects: { ...rc.projects, default: projectId },
      targets: {
        ...rc.targets,
        [projectId]: { hosting: { web: [projectId] } },
      },
    },
  };
}

/** The command. Answers the exit code. */
export function main({ args, readText, writeText, print, warn }) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        project: { type: 'string' },
        environment: { type: 'string' },
      },
      strict: true,
    }));
    if (!DEPLOY_ENVIRONMENTS.includes(values.environment)) {
      throw new Error(
        `--environment must be ${DEPLOY_ENVIRONMENTS.join(' or ')}`,
      );
    }
  } catch (error) {
    warn(
      `deploy-target: ${error.message}\nusage: node tools/release/deploy-target.mjs --project <id> --environment staging|production`,
    );
    return 2;
  }
  const { project, environment } = values;
  const problem = targetProblem(project);
  if (problem !== null) {
    warn(`deploy-target: refused — ${problem}`);
    return 1;
  }
  const rc = JSON.parse(readText('.firebaserc'));
  const committed = rc.projects?.default;
  const pointedRc = pointFirebaserc(rc, project, environment);
  const pointedJson = pointFirebaseJson(
    readText('firebase.json'),
    committed,
    project,
  );
  for (const answer of [pointedRc, pointedJson]) {
    if (answer.error !== undefined) {
      warn(`deploy-target: refused — ${answer.error}`);
      return 1;
    }
  }
  writeText('firebase.json', pointedJson.text);
  writeText('.firebaserc', `${JSON.stringify(pointedRc.rc, null, 2)}\n`);
  print(
    `deploy-target: ${environment} → ${project} (CSP callables host ${functionsHost(project)}, hosting target web → ${project})`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main({
    args: process.argv.slice(2),
    readText: (path) => readFileSync(resolve(path), 'utf8'),
    writeText: (path, text) => writeFileSync(resolve(path), text),
    print: (text) => console.log(text),
    warn: (text) => console.error(text),
  });
}
