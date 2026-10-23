import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noGenericDiscriminator } from './no-generic-discriminator.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

// The options the root config passes (ui-residue-cleanup §3.3).
const manifest = '/libs/ui/icons/src/lib/manifest/';
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
    allowIn: [manifest],
  },
];

const repo = '/repo';
const feature = `${repo}/libs/features/marketing/careers/src/lib/marketing-careers.ts`;
const uiLib = `${repo}/libs/ui/controls/src/lib/date-field/date-field.ts`;
const web = `${repo}/apps/web/src/app/x.ts`;
const showcase = `${repo}/apps/showcase/src/app/x.ts`;

const named = (name) => [{ messageId: 'genericDiscriminator', data: { name } }];

tester.run('creativo/no-generic-discriminator', noGenericDiscriminator, {
  valid: [
    // A domain-prefixed discriminator.
    {
      code: 'export interface Row { readonly bookingStatus: BookingStatus }',
      filename: feature,
      options,
    },
    {
      code: 'export type Slice = { readonly loadState: LoadState; readonly data: string };',
      filename: uiLib,
      options,
    },
    // Object-literal properties are not signatures: Intl options, CSS keys.
    {
      code: "const list = new Intl.ListFormat('bg', { style: 'long', type: 'conjunction' });",
      filename: feature,
      options,
    },
    {
      code: 'const PLACEHOLDER_HEIGHTS = { status: 88, wallet: 120 };',
      filename: feature,
      options,
    },
    // An Angular input named `kind` is a class field, not a signature.
    {
      code: "@Component({ selector: 'x', template: '' }) class X { readonly kind = input<string>('new'); }",
      filename: feature,
      options,
    },
    // A method signature and a computed key bound to a variable.
    {
      code: 'interface Probe { status(): string; [type]: number }',
      filename: web,
      options,
    },
    // The icon manifest's wire format is allow-listed by path (UR-13 a).
    {
      code: "export interface VectorEntry { readonly kind: 'vector'; readonly path: string }",
      filename: `${repo}${manifest}icon-manifest.ts`,
      options,
    },
    // Outside `include`: ecs-core has its own guards, tooling is out.
    {
      code: 'type T = { kind: string };',
      filename: `${repo}/tools/verify/x.ts`,
      options,
    },
    {
      code: 'type T = { status: string };',
      filename: `${repo}/apps/functions/src/edge.ts`,
      options,
    },
  ],
  invalid: [
    {
      code: "export interface Paging { readonly kind: 'more' | 'end' }",
      filename: feature,
      options,
      errors: named('kind'),
    },
    {
      code: "export type State = { type: 'loading' } | { type: 'ready'; data: string };",
      filename: uiLib,
      options,
      errors: [...named('type'), ...named('type')],
    },
    {
      code: 'export interface DayRowVm { readonly status: BookingStatus }',
      filename: web,
      options,
      errors: named('status'),
    },
    {
      code: "export interface Q { readonly 'kind': string }",
      filename: showcase,
      options,
      errors: named('kind'),
    },
    {
      code: "type R = { ['status']: string };",
      filename: feature,
      options,
      errors: named('status'),
    },
    {
      // An inline type literal — a computed's state.
      code: "const state = computed<{ kind: 'loading' } | { kind: 'ready' }>(() => ({ kind: 'loading' }));",
      filename: feature,
      options,
      errors: [...named('kind'), ...named('kind')],
    },
    {
      code: 'function render(row: { readonly status: string | null }) { return row; }',
      filename: feature,
      options,
      errors: named('status'),
    },
    {
      // The manifest fragment covers the manifest only — not the rest of icons.
      code: "export interface Reporter { readonly kind: 'missing' }",
      filename: `${repo}/libs/ui/icons/src/lib/registry/icon-registry.service.ts`,
      options,
      errors: named('kind'),
    },
    {
      // Without `include` the rule runs on every file it is given.
      code: 'type T = { kind: string };',
      filename: `${repo}/tools/verify/x.ts`,
      errors: named('kind'),
    },
  ],
});
