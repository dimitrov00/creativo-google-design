import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noHandBuiltLoadSlice } from './no-hand-built-load-slice.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

// The options the root config passes (ui-residue-cleanup §3.5).
const viewState = '/libs/shared/view-state/';
const options = [
  {
    include: [
      '/libs/features/',
      '/libs/ui/',
      '/libs/shared/',
      '/libs/infrastructure/',
      '/apps/web/src/',
      '/apps/showcase/src/',
    ],
    allowIn: [viewState],
  },
];

const repo = '/repo';
const store = `${repo}/libs/features/staff/client-card/src/lib/client-card.store.ts`;
const uiLib = `${repo}/libs/ui/controls/src/lib/date-field/date-field.ts`;
const web = `${repo}/apps/web/src/app/x.ts`;
const showcase = `${repo}/apps/showcase/src/app/x.ts`;

const flagged = (member, companion) => [
  { messageId: 'handBuiltLoadSlice', data: { member, companion } },
];

tester.run('creativo/no-hand-built-load-slice', noHandBuiltLoadSlice, {
  valid: [
    // The companion is the way.
    {
      code: 'const a = LoadSlice.ready(rail); const b = LoadSlice.loading; const c = LoadSlice.failed; const d = LoadSlice.empty;',
      filename: store,
      options,
    },
    // A paging state is a different slice: a spread or any other field.
    {
      code: 'const h = { ...LOADING_HISTORY, loadState: LoadState.Ready };',
      filename: store,
      options,
    },
    {
      code: 'const l = { filter: kind, loadState: LoadState.Ready, entries: [], next: null, pagingState: PagingState.More };',
      filename: store,
      options,
    },
    {
      code: 'const p = { loadState: LoadState.Ready, data: rows, paging: null };',
      filename: uiLib,
      options,
    },
    {
      code: 'const q = { loadState: LoadState.Loading, subline: LEDGER_SUBLINE };',
      filename: web,
      options,
    },
    // READY without data, data beside a non-READY member: not a LoadSlice shape.
    {
      code: 'const r = { loadState: LoadState.Ready };',
      filename: store,
      options,
    },
    {
      code: 'const s = { loadState: LoadState.Loading, data: null };',
      filename: store,
      options,
    },
    // A state read from a variable or a parameter, not a `LoadState` member.
    {
      code: 'const t = { loadState: input.loadState }; const u = { loadState: state, data };',
      filename: store,
      options,
    },
    // A computed key, a getter, another dictionary.
    {
      code: 'const v = { [key]: LoadState.Loading }; const w = { get loadState() { return LoadState.Failed; } }; const x = { loadState: PagingState.More };',
      filename: store,
      options,
    },
    // The companion's own home builds the variants.
    {
      code: 'export const LoadSlice = { loading: { loadState: LoadState.Loading }, ready(data) { return { loadState: LoadState.Ready, data }; } };',
      filename: `${repo}${viewState}lib/load-slice.data.ts`,
      options,
    },
    // Outside `include`: ecs-core and tooling are out.
    {
      code: 'const y = { loadState: LoadState.Failed };',
      filename: `${repo}/tools/verify/x.ts`,
      options,
    },
    {
      code: 'const z = { loadState: LoadState.Failed };',
      filename: `${repo}/apps/functions/src/edge.ts`,
      options,
    },
  ],
  invalid: [
    {
      code: 'overview.photos = { loadState: LoadState.Ready, data: rail };',
      filename: store,
      options,
      errors: flagged('Ready', 'LoadSlice.ready(…)'),
    },
    {
      // `data` shorthand, a string key.
      code: "const a = { 'loadState': LoadState.Ready, data };",
      filename: uiLib,
      options,
      errors: flagged('Ready', 'LoadSlice.ready(…)'),
    },
    {
      // Property order does not matter.
      code: 'const b = { data: [], loadState: LoadState.Ready };',
      filename: web,
      options,
      errors: flagged('Ready', 'LoadSlice.ready(…)'),
    },
    {
      code: 'this._photos.set({ loadState: LoadState.Loading });',
      filename: showcase,
      options,
      errors: flagged('Loading', 'LoadSlice.loading'),
    },
    {
      code: 'const c = { loadState: LoadState.Failed };',
      filename: store,
      options,
      errors: flagged('Failed', 'LoadSlice.failed'),
    },
    {
      code: 'const d = { loadState: LoadState.Empty };',
      filename: store,
      options,
      errors: flagged('Empty', 'LoadSlice.empty'),
    },
    {
      // A nested slice inside a page state is still a slice.
      code: 'const e = { reward: { loadState: LoadState.Ready, data: reward }, canRemove: true };',
      filename: store,
      options,
      errors: flagged('Ready', 'LoadSlice.ready(…)'),
    },
    {
      // The view-state fragment covers that lib only — not the rest of shared.
      code: 'const f = { loadState: LoadState.Loading };',
      filename: `${repo}/libs/shared/catalog/src/lib/x.ts`,
      options,
      errors: flagged('Loading', 'LoadSlice.loading'),
    },
    {
      // Without `include` the rule runs on every file it is given.
      code: 'const g = { loadState: LoadState.Failed };',
      filename: `${repo}/tools/verify/x.ts`,
      errors: flagged('Failed', 'LoadSlice.failed'),
    },
  ],
});
