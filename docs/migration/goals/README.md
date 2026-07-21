# Migration goals — execution package for Claude Code `/goal`

Companion to [../migration-blueprint.md](../migration-blueprint.md). The blueprint is the _knowledge base_; these files are the _execution units_. Each file is one phase, packaged for the `/goal` feature (Claude Code v2.1.139+): a **kickoff prompt** (the work order) plus a **goal condition** (the completion check the evaluator model verifies after every turn).

## Why split instead of one mega-goal

- `/goal` accepts a single plain-language condition (≤ 4,000 chars) and holds **one active goal per session** — a 10-phase migration cannot be one condition without becoming unverifiable mush.
- Each phase here has a _mechanically checkable_ exit gate (command exit codes, file existence, grep results), which is exactly what the goal evaluator is good at.
- Token economy: a fresh session per phase loads only its goal file + the blueprint sections it cites — not the entire migration history. The blueprint is written once and referenced, never re-pasted.

## How to run a phase

1. Open a **fresh session** in `creativo-google-design/` (pick your model, e.g. Sonnet 5 — the goal evaluator itself runs on a small fast model regardless).
2. Paste the file's **Kickoff prompt** as the first message.
3. When Claude starts working, set the goal: `/goal <the file's goal condition>`.
4. Optionally enable auto mode so goal turns run unattended; check progress anytime with `/goal`.
5. When the goal reports met: review the diff, run the exit-gate commands yourself, commit, move to the next file.

Every condition ends with a turn bound (`or stop after N turns`) so a stuck run halts instead of burning tokens. If a run hits the bound, `--resume` the session and re-issue the same `/goal`.

## Order & parallelism

```
00 ─▶ 01 ─▶─┐
  └─▶ 02 ─▶ 03 ─▶ 04 ─▶ 05 ─▶ 06 (nine sequential sub-goals) ─▶ 08 ─▶ 09
                    └────────────▶ 07 (functions, parallel with 05/06)
```

- `01` (design system) and `02` (domain) are independent — run in parallel sessions/worktrees if you like.
- `07` (functions) can start once `04` lands.
- `06` sub-goals are strictly sequential (each screen builds on the previous slice's stores/components).

| File                                                   | Phase                                                    | Depends on |
| ------------------------------------------------------ | -------------------------------------------------------- | ---------- |
| [00-workspace-alignment.md](00-workspace-alignment.md) | Restructure libs/apps to the blueprint layout            | —          |
| [01-design-system.md](01-design-system.md)             | `--sys-*` tokens, `ui*` modifiers/controls, showcase     | 00         |
| [02-domain-port.md](02-domain-port.md)                 | Bounded contexts, VOs/entities, bug-class tests          | 00         |
| [03-application-layer.md](03-application-layer.md)     | Ports + InjectionTokens, use-cases, pure flows           | 02         |
| [04-infrastructure.md](04-infrastructure.md)           | Fresh Firestore schema, adapters, rules, emulator suites | 03         |
| [05-app-shell.md](05-app-shell.md)                     | `apps/web` composition root, routes, guards, PWA, i18n   | 01 + 04    |
| [06-feature-slices.md](06-feature-slices.md)           | Nine screen slices, landing → admin                      | 05         |
| [07-functions.md](07-functions.md)                     | Cloud Functions use-cases on the new domain              | 04         |
| [08-hardening.md](08-hardening.md)                     | Screenshot parity, PWA/a11y/bundle audits                | 06 + 07    |
| [09-launch.md](09-launch.md)                           | Deploy + preview soak + go live                          | 08         |

Ground rules baked into every kickoff prompt: greenfield (v2 read-only reference, never patched, schema freedom), black-and-white brand only, no Tailwind/Zod/Valibot/Reactive-Forms validators, `Result`-returning factories, `[data-*]` styling, wiring only in `app.config.ts`.
