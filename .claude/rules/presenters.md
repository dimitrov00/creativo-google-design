---
paths:
  - '**/*.presenter.ts'
  - '**/*.presenter.spec.ts'
  - '**/*.vm.ts'
  - '**/*.words.ts'
  - '**/*.format.ts'
---

# Presenters — pure wording, no decisions (Law 10 of `CLAUDE.md`)

A presenter turns ecs-core values into the finished words a screen prints.
It is pure, and it decides nothing: the decision is a system's, the wording
is the presenter's.

## The shape (`wallet.presenter.ts` + `client-pages.vm.ts`)

```ts
// client-pages.vm.ts — a display model: types and tag-to-word tables only.
export type PassVm = {
  readonly figure: string; // «371»
  readonly unit: string; // «точки»
  readonly state: string | null; // «дължи 40 точки»
  readonly frozen: boolean;
  readonly accessibleName: string;
};

// wallet.presenter.ts — ecs-core values + words in, the display struct out.
import type { LoyaltyAccount } from '@core/entities';
import { LoyaltyPassSystem } from '@core/systems'; // the DECISION
import { formatFigure } from './client-card.format';
import type { PassVm } from './client-pages.vm';

export function passVm(input: {
  readonly account: LoyaltyAccount;
  readonly words: WalletWords;
  readonly lang: SupportedLang;
}): PassVm {
  // The system decides the state (a SCREAMING tag); the presenter words it.
  const pass = LoyaltyPassSystem.passOf(input.account);
  return {
    figure: formatFigure(pass.points, input.lang),
    unit: input.words.unit(pass.points),
    state: input.words.state[pass.passState] ?? null,
    frozen: pass.passState === PassState.Frozen,
    accessibleName: input.words.accessibleName(pass),
  };
}
```

The store calls it inside a `computed()`; the template prints `pass().figure`.

## Rules

- **Decides nothing (Law 10.2).** A state, what is owed or earned, what
  qualifies, which items exist or are hidden, an ordering or grouping rule, a
  threshold — each is an ecs-core system's answer (Law 3) and arrives as an
  input value or tag. A presenter may call a system; it never re-derives one.
  If you find yourself comparing numbers, filtering a list by a domain rule,
  or choosing between states, move that into a system first.
- **Pure (Law 10.4).** No class, no Angular (`inject`, signals,
  `@angular/*`), no I/O or streams (`@core/ports`, `@core/pipelines`,
  `@creativo/infrastructure/*` but `i18n`, Firebase, `rxjs`), no `async`, no
  clock, no randomness — `now` arrives as an input (`ShopNow` / `UtcEpochMs`).
- **Formatting through the shared helpers** — `formatMoney`, the cached `Intl`
  formatters of `@creativo/infrastructure/i18n` and `@creativo/ui/wall-clock`
  (never a formatter built per row), the location's zone for any date or time.
- **A display model (`*.vm.ts`)** holds display-struct types (readonly
  records of strings, numbers, booleans, ids) and tag-to-word tables — no
  function values, no class. Its functions live in a `*.presenter.ts`.
- **Wording helpers** (`*.words.ts`, `*.format.ts`) are as pure as a
  presenter; reuse, never copy — one words table per tag family.
- **Spec contract.** Each presenter's spec pins its words, in `bg` and `en`
  where both exist, from fixed inputs (never the wall clock).

## Enforcement

`creativo/presenter-purity` (`tools/lint-rules/presenter-purity.mjs`, spec
beside it, run by `nx run lint-rules:test`) runs on every `.ts` from the root
config and scopes itself by the file's physical name: class, Angular, I/O,
`async`, clock and randomness in any of the four suffixes, and a top-level
function value in a `*.vm.ts`. "Decides nothing" is a review rule.
