import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { noAmbientClock } from './no-ambient-clock.mjs';

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

// The options the root config passes (ui-residue-cleanup §3.2).
const browserRuntime =
  '/libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts';
const authSession =
  '/libs/infrastructure/firebase-auth/src/lib/auth-session.adapter.ts';
const mediaCache =
  '/libs/features/shared/catalog/src/lib/content/media-url-cache.ts';
const confetti = '/libs/ui/patterns/src/lib/confetti/confetti.ts';
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
    allowIn: [browserRuntime, authSession],
    allowRandomIn: [mediaCache, confetti],
  },
];

const repo = '/repo';
const feature = `${repo}/libs/features/staff/dashboard/src/lib/staff-dashboard.ts`;
const uiLib = `${repo}/libs/ui/controls/src/lib/month-picker/month-picker.ts`;
const shared = `${repo}/libs/shared/cursor/src/lib/cursor.ts`;
const web = `${repo}/apps/web/src/app/app.config.ts`;
const showcase = `${repo}/apps/showcase/src/app/pages/controls/menu/menu.page.ts`;
const firestoreRead = `${repo}/libs/infrastructure/firestore/src/lib/read.ts`;

const one = (messageId) => [{ messageId }];

tester.run('creativo/no-ambient-clock', noAmbientClock, {
  valid: [
    // Pure arithmetic and a monotonic interval are not the clock.
    { code: 'const ms = Date.UTC(2026, 0, 1);', filename: feature, options },
    { code: 'const t0 = performance.now();', filename: uiLib, options },
    // The injected clock and id ports.
    {
      code: 'const now = inject(CLOCK_PORTS).nowUtcMs();',
      filename: feature,
      options,
    },
    { code: 'const id = ids.nextId();', filename: web, options },
    // A local binding named like the global is not the global.
    {
      code: 'const crypto = inject(ID_PORTS); crypto.randomUUID();',
      filename: feature,
      options,
    },
    {
      code: 'function f(Math: { random(): number }) { return Math.random(); }',
      filename: feature,
      options,
    },
    // A property merely called `now`/`random` on something else.
    { code: 'clock.now(); rng.random();', filename: shared, options },
    // `allowRandomIn` lifts Math.random — in each of its files.
    {
      code: 'const jitter = Math.random() * base;',
      filename: `${repo}${mediaCache}`,
      options,
    },
    {
      code: 'const spin = Math.random() * 360;',
      filename: `${repo}${confetti}`,
      options,
    },
    // `allowIn` skips the sanctioned adapters entirely — each of them.
    {
      code: 'export const browserClock = { nowUtcMs: () => Date.now(), nextId: () => crypto.randomUUID() };',
      filename: `${repo}${browserRuntime}`,
      options,
    },
    {
      code: 'const expired = Date.now() >= expiresAtMs;',
      filename: `${repo}${authSession}`,
      options,
    },
    // Outside `include`: tooling, the functions composition root, ecs-core.
    {
      code: 'const now = Date.now();',
      filename: `${repo}/tools/x.ts`,
      options,
    },
    {
      code: 'const nowUtcMs = () => Date.now();',
      filename: `${repo}/apps/functions/src/main.ts`,
      options,
    },
    {
      code: 'const d = new Date();',
      filename: `${repo}/libs/ecs-core/src/systems/x.system.ts`,
      options,
    },
  ],
  invalid: [
    {
      code: 'const d = new Date();',
      filename: feature,
      options,
      errors: one('newDate'),
    },
    {
      code: 'const d = new Date(`${day}T12:00:00Z`);',
      filename: uiLib,
      options,
      errors: one('newDate'),
    },
    {
      code: 'const s = Date();',
      filename: web,
      options,
      errors: one('dateCall'),
    },
    {
      code: 'const nonce = Date.now();',
      filename: showcase,
      options,
      errors: one('dateNow'),
    },
    {
      // Passed as a value, not called.
      code: 'const ports = { nowUtcMs: Date.now };',
      filename: feature,
      options,
      errors: one('dateNow'),
    },
    {
      code: "const n = Date['now']();",
      filename: feature,
      options,
      errors: one('dateNow'),
    },
    {
      code: 'const weeks = (Date.parse(week) - Date.parse(first)) / 7;',
      filename: feature,
      options,
      errors: [{ messageId: 'dateParse' }, { messageId: 'dateParse' }],
    },
    {
      code: 'function formatTitled(at: Date): string { return String(at); }',
      filename: feature,
      options,
      errors: one('dateType'),
    },
    {
      code: 'function noonOf(day: string): Date { return day as never; }',
      filename: uiLib,
      options,
      errors: one('dateType'),
    },
    {
      code: 'const days: readonly Date[] = [];',
      filename: shared,
      options,
      errors: one('dateType'),
    },
    {
      code: 'const r = Math.random();',
      filename: feature,
      options,
      errors: one('mathRandom'),
    },
    {
      code: 'const id = crypto.randomUUID();',
      filename: web,
      options,
      errors: [{ messageId: 'cryptoRandom', data: { name: 'randomUUID' } }],
    },
    {
      code: 'crypto.getRandomValues(bytes);',
      filename: uiLib,
      options,
      errors: [
        { messageId: 'cryptoRandom', data: { name: 'getRandomValues' } },
      ],
    },
    // Reached through the global object.
    {
      code: 'const id = globalThis.crypto.randomUUID();',
      filename: feature,
      options,
      errors: [{ messageId: 'cryptoRandom', data: { name: 'randomUUID' } }],
    },
    {
      code: 'const now = window.Date.now();',
      filename: feature,
      options,
      errors: one('dateNow'),
    },
    {
      code: 'const d = new globalThis.Date(0);',
      filename: feature,
      options,
      errors: one('newDate'),
    },
    // `allowRandomIn` lifts ONLY Math.random — the clock stays banned there.
    {
      code: 'const at = Date.now();',
      filename: `${repo}${mediaCache}`,
      options,
      errors: one('dateNow'),
    },
    {
      code: 'const at = new Date();',
      filename: `${repo}${confetti}`,
      options,
      errors: one('newDate'),
    },
    // Every other infrastructure file stays guarded.
    {
      code: 'const at = Date.now();',
      filename: firestoreRead,
      options,
      errors: one('dateNow'),
    },
    {
      // Without `include` the rule runs on every file it is given.
      code: 'const at = Date.now();',
      filename: `${repo}/tools/x.ts`,
      errors: one('dateNow'),
    },
  ],
});
