# cursor

This library was generated with [Nx](https://nx.dev).

## The `useCursorTarget` composable

`useCursorTarget` (`src/lib/cursor-target.behavior.ts`) is a signal composable, not a directive — call it from an injection context (a component/directive constructor), the same way you'd call `inject()`. It's the shared hover-tracking logic behind:

- `CursorTargetDirective` (`[crCursorTarget]`) — for arbitrary elements (nav links, custom content) that aren't already part of the design system.
- Any design-system component that wants the cursor-target behavior intrinsically, without every call site needing to remember a separate attribute — see `Button` and `Input` in `libs/shared/ui`.

It's deliberately a plain composable rather than an Angular `hostDirectives` composition: `Button` needs to feed it an internally-`computed()` cursor style/label derived from its own inputs (e.g. `variant`), and `hostDirectives`' inputs are only settable by the _consuming_ template or a static default — they can't be driven by the host component's own class logic. See `docs/design-research/decisions.md` for the full rationale, and `libs/shared/ui/src/lib/material/material.directive.ts`'s `MaterialDirective` for a case where a plain `hostDirectives`-friendly directive (consumer-supplied input, no internal computation) is the better fit instead.

## Running unit tests

Run `nx test cursor` to execute the unit tests.
