# Contributing

How a change reaches `main`, how it becomes a release, and how a release
reaches the people using the app. The reasons are in
[the releases ADR](docs/architecture/decisions/2026-11-18-releases-and-environments.md);
the code's own laws are in [`CLAUDE.md`](CLAUDE.md).

## Branches

`main` is always releasable. Every change starts on a short-lived branch
named for what it is (`feat/staff-search`, `fix/otp-resend`, `chore/deps`,
or an agent's own `claude/…`) and lands through one pull request. There is
no `develop` branch and no branch per environment: **staging is `main`,
production is the release tags.** A `release/vX.Y` branch exists only for a
rare hotfix (below).

## Pull request titles

Merging is **squash only**, so a PR becomes one commit on `main`: the title
is its subject, the description its body. The title is a
[Conventional Commit](https://www.conventionalcommits.org/), and the
required `pr-title` check holds it to [`commitlint.config.mjs`](commitlint.config.mjs):

```text
type(scope)!: subject
```

| Type       | For                                                    | In the changelog | Next version (before 1.0) |
| ---------- | ------------------------------------------------------ | ---------------- | ------------------------- |
| `feat`     | something a person using the app can now do            | Features         | minor                     |
| `fix`      | something that was wrong for them and now is not       | Bug Fixes        | patch                     |
| `perf`     | the same thing, faster or cheaper                      | Performance      | patch                     |
| `revert`   | undoing an earlier commit                              | Reverts          | patch                     |
| `refactor` | the code changes shape, the behaviour does not         | hidden           | none                      |
| `docs`     | documentation only                                     | hidden           | none                      |
| `test`     | tests only                                             | hidden           | none                      |
| `build`    | dependencies, the build, the bundle                    | hidden           | none                      |
| `ci`       | the workflows and their tooling                        | hidden           | none                      |
| `chore`    | anything else that ships nothing (and the release PRs) | hidden           | none                      |

- The **scope** is optional and lower-case: the area, as the history uses
  it (`team`, `identity`, `booking`, `ui`, `deps`).
- The **subject** says what changed for the reader, in the house voice.
  Up to 160 characters for the whole title.
- A **breaking change** is marked by `!` after the type or scope
  (`feat(booking)!: a seat holds one service`), or by a footer in the
  description:

  ```text
  BREAKING CHANGE: the wire answers flat errors; an old web must reload.
  ```

  The description is the commit's body, so release-please reads it: never
  write `BREAKING CHANGE:` there unless it is meant. Before 1.0 a breaking
  change bumps the minor version.

Local commits are checked too, by the husky `commit-msg` hook (it switches
to the Node of `.nvmrc` when another is first on PATH). The squash rewrites
them, so only the title binds.

## Releases

[release-please](https://github.com/googleapis/release-please) keeps one
release PR open, titled `chore: release X.Y.Z`, with the next version, the
changelog and `package.json`. **Merging it is the release**: release-please
tags `vX.Y.Z` and writes the GitHub Release, and the tag starts the
production deploy, which waits for the owner's approval. The whole product
(web, functions, rules) has one version. Launch is a commit whose
description ends with the footer `Release-As: 1.0.0`.

Agents never merge a release PR, never approve a production deployment and
never deploy: only CI deploys.

## Environments

| Environment | What it runs                                | Deployed                               |
| ----------- | ------------------------------------------- | -------------------------------------- |
| development | the emulators, project `demo-creativo-test` | on your machine (`pnpm run dev`)       |
| staging     | `main`                                      | after CI passes on every merge         |
| production  | the latest release tag                      | from the tag, after the owner approves |

Unreleased features ride along dark: each environment has its own flag map
in [`config/feature-flags.json`](config/feature-flags.json).

## Hotfixes

**Default:** a `fix:` PR to `main` like any other. Staging deploys it,
release-please's PR now proposes the patch, merging it tags, and the owner
approves production.

**Rare:** when `main` holds work that must not ship and cannot be kept
dark, fix it on a release branch:

1. Land the fix on `main` first.
2. Cut the branch from the live tag: `git push origin vX.Y.Z:refs/heads/release/vX.Y`.
3. Cherry-pick the fix into a PR against `release/vX.Y`.
4. release-please opens `chore(release/vX.Y): release X.Y.Z+1` on that
   branch; merging it tags the patch, which deploys like any release.
