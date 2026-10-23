import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { presenterPurity } from './presenter-purity.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

const PRESENTER =
  '/repo/libs/features/staff/client-card/src/lib/wallet.presenter.ts';
const VM = '/repo/libs/features/staff/client-card/src/lib/client-pages.vm.ts';
const WORDS =
  '/repo/libs/features/staff/client-card/src/lib/client-card.words.ts';
const FORMAT =
  '/repo/libs/features/staff/client-card/src/lib/client-card.format.ts';

tester.run('creativo/presenter-purity', presenterPurity, {
  valid: [
    // The template: ecs-core values and words in, a display struct out.
    {
      code: [
        "import type { LoyaltyAccount } from '@core/entities';",
        "import { LoyaltyStandingSystem } from '@core/systems';",
        "import { formatMoney } from '@creativo/infrastructure/i18n';",
        "import type { UiBadgeTone } from '@creativo/ui/controls';",
        "import type { PassVm } from './client-pages.vm';",
        'export function passVm(account: LoyaltyAccount, words: { unit: string }): PassVm {',
        '  const standing = LoyaltyStandingSystem.standingOf(account);',
        "  return { figure: String(standing.points), unit: words.unit, tone: 'accent' as UiBadgeTone };",
        '}',
      ].join('\n'),
      filename: PRESENTER,
    },
    // A display model: types and a tag-to-word table, function TYPES allowed.
    {
      code: [
        'export type PassVm = { readonly figure: string; readonly name: (label: string) => string };',
        "export const passStateWords = { OWES: 'дължи', FROZEN: 'замразено' } as const;",
      ].join('\n'),
      filename: VM,
    },
    // Wording helpers may hold functions.
    {
      code: 'export const words = { since: (month: string) => `Клиент от ${month}` };\nexport function figure(n: number) { return String(n); }',
      filename: WORDS,
    },
    {
      code: 'export const pad = (n: number) => String(n).padStart(2, "0");',
      filename: FORMAT,
    },
    // Any other file is out of scope: a store may inject, await and read the clock.
    {
      code: "import { inject } from '@angular/core';\nexport class Store { readonly x = inject(Object); async load() { await Promise.resolve(Date.now()); } }",
      filename:
        '/repo/libs/features/staff/client-card/src/lib/client-card.store.ts',
    },
    // A spec of a presenter is not the presenter.
    {
      code: 'const now = Date.now();',
      filename:
        '/repo/libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts',
    },
  ],
  invalid: [
    {
      code: 'export class Pass {}',
      filename: PRESENTER,
      errors: [{ messageId: 'noClass' }],
    },
    {
      code: 'export const P = class {};',
      filename: WORDS,
      errors: [{ messageId: 'noClass' }],
    },
    {
      code: "import { computed } from '@angular/core';",
      filename: PRESENTER,
      errors: [{ messageId: 'noAngular' }],
    },
    {
      code: 'export const x = () => inject(Object);',
      filename: PRESENTER,
      errors: [{ messageId: 'noAngular' }],
    },
    {
      code: 'export const s = signal(1);',
      filename: FORMAT,
      errors: [{ messageId: 'noAngular' }],
    },
    {
      code: "import type { LoadPolicy } from '@core/ports';",
      filename: PRESENTER,
      errors: [{ messageId: 'noIo' }],
    },
    {
      code: "import { bookAppointment } from '@core/pipelines';",
      filename: PRESENTER,
      errors: [{ messageId: 'noIo' }],
    },
    {
      code: "import { CLIENT_STATS_READ_PORTS } from '@creativo/infrastructure/firebase-app';",
      filename: PRESENTER,
      errors: [{ messageId: 'noIo' }],
    },
    {
      code: "import { map } from 'rxjs';",
      filename: VM,
      errors: [{ messageId: 'noIo' }],
    },
    {
      code: "import { getFirestore } from 'firebase/firestore';",
      filename: WORDS,
      errors: [{ messageId: 'noIo' }],
    },
    {
      code: 'export async function load() { return 1; }',
      filename: PRESENTER,
      errors: [{ messageId: 'noAsync' }],
    },
    {
      code: 'export const f = async () => { await Promise.resolve(1); };',
      filename: PRESENTER,
      errors: [{ messageId: 'noAsync' }, { messageId: 'noAsync' }],
    },
    {
      code: 'export const t = () => Date.now();',
      filename: PRESENTER,
      errors: [{ messageId: 'noClock' }],
    },
    {
      code: 'export const t = () => new Date();',
      filename: FORMAT,
      errors: [{ messageId: 'noClock' }],
    },
    {
      code: 'export const r = () => Math.random();',
      filename: WORDS,
      errors: [{ messageId: 'noClock' }],
    },
    {
      code: 'export function passVm() { return null; }',
      filename: VM,
      errors: [{ messageId: 'noFunctionInVm' }],
    },
    {
      code: 'export const passVm = () => null;\nconst helper = function () { return 1; };',
      filename: VM,
      errors: [
        { messageId: 'noFunctionInVm' },
        { messageId: 'noFunctionInVm' },
      ],
    },
    {
      // Windows separators are normalised.
      code: 'export class Pass {}',
      filename: 'C:\\repo\\libs\\features\\x\\pass.presenter.ts',
      errors: [{ messageId: 'noClass' }],
    },
  ],
});
