// PR 1's two timings (staff-analytics-v2, plan item 14; the figures and the
// decisions they led to are in ./pr1-entry.md). On the optimised build
// served at BASE against the emulators, CPU throttled 4×:
//   forward — tap on the schedule's chart button → the analytics title's
//             first frame; the longest main-thread tasks meanwhile;
//   back    — Back → the schedule's day label visible and the toolbar back,
//             with the Firestore requests Back issued.
//
//   pnpm nx build web --configuration=csp-smoke
//   node tools/verify/csp/emulator-config.mjs
//   pnpm exec firebase emulators:exec --config dist/firebase.csp-smoke.json \
//     --only firestore,auth,functions,storage,hosting --project demo-creativo-test \
//     "pnpm run seed:dev --silent && node docs/design-research/staff-analytics/perf/pr1-entry.mjs http://127.0.0.1:5050 cold \
//      && node docs/design-research/staff-analytics/perf/pr1-entry.mjs http://127.0.0.1:5050 warm"
//
// `cold` taps straight from the schedule (the analytics chunk prefetched on
// idle); `warm` has opened the analytics page once before, so its cache and
// its chunk are both in place.
import { chromium } from '@playwright/test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const BASE = process.argv[2];
const RUN = process.argv[3] ?? 'cold';
const token = await getAuth(
  initializeApp({ projectId: 'demo-creativo-test' }),
).createCustomToken('dev-staff-ivan', {
  tenantId: 'creativo',
  stage: 'active',
  roles: ['barber', 'admin'],
});
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto(BASE + '/', { waitUntil: 'commit' });
await page.waitForFunction(
  () => typeof window.__e2eSignIn === 'function',
  null,
  { timeout: 120000 },
);
await page.evaluate((t) => window.__e2eSignIn(t), token);
const today = new Date().toISOString().slice(0, 10);
if (RUN === 'warm') {
  await page.goto(BASE + `/staff/analytics?span=WEEK&from=${today}`, {
    waitUntil: 'commit',
  });
  await page.waitForSelector('[data-testid=analytics-title]', {
    timeout: 120000,
  });
  await page.waitForTimeout(3000);
}
await page.goto(BASE + `/staff/schedule?day=${today}&view=agenda&barber=ivan`, {
  waitUntil: 'commit',
});
await page.waitForSelector('[data-testid=staff-analytics-open]', {
  timeout: 120000,
});
await page.waitForSelector('[data-testid=staff-day-label]', {
  timeout: 120000,
});
await page.waitForTimeout(6000); // idle: the analytics chunk prefetches
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.waitForTimeout(1000);

function trace() {
  const events = [];
  const handler = (e) => events.push(...e.value);
  cdp.on('Tracing.dataCollected', handler);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  return {
    start: () =>
      cdp.send('Tracing.start', {
        categories:
          'devtools.timeline,disabled-by-default-devtools.timeline,benchmark',
        transferMode: 'ReportEvents',
      }),
    stop: async () => {
      await cdp.send('Tracing.end');
      await done;
      cdp.off('Tracing.dataCollected', handler);
      return events;
    },
  };
}
function report(label, events, from, to) {
  const tasks = events
    .filter((e) => e.ph === 'X' && e.name === 'RunTask' && e.dur)
    .map((e) => e.dur / 1000)
    .sort((a, b) => b - a);
  const frames = events.filter(
    (e) => e.name === 'PipelineReporter' && e.ph === 'b',
  );
  const framesOver = frames.filter((f) => (f.dur ?? 0) / 1000 > 16.7).length;
  console.log(
    `${RUN} | ${label}: ${(to - from).toFixed(0)} ms | longest tasks (ms): ${tasks
      .slice(0, 5)
      .map((d) => d.toFixed(0))
      .join(
        ', ',
      )} | tasks > 50 ms: ${tasks.filter((d) => d > 50).length} | frames: ${frames.length}, over 16.7 ms: ${framesOver}`,
  );
}

// Forward.
const fwd = trace();
await fwd.start();
const t0 = await page.evaluate(() => performance.now());
await page.evaluate(() =>
  document.querySelector('[data-testid=staff-analytics-open]').click(),
);
await page.waitForSelector('[data-testid=analytics-title]', { timeout: 30000 });
const titleAt = await page.evaluate(() => performance.now());
await page.waitForTimeout(800);
report('tap → analytics title', await fwd.stop(), t0, titleAt);
await page.waitForSelector('[data-testid=staff-analytics][data-load=READY]', {
  timeout: 60000,
});

// Back.
let reads = 0;
const onRequest = (req) => {
  if (/:8080\//.test(req.url())) reads += 1;
};
page.on('request', onRequest);
const back = trace();
await back.start();
const b0 = Date.now();
await page.goBack({ waitUntil: 'commit' });
await page.waitForSelector('[data-testid=staff-day-label]', { timeout: 30000 });
await page.waitForFunction(
  () => document.querySelector('[data-testid=staff-analytics-open]') !== null,
  null,
  { timeout: 30000 },
);
const b1 = Date.now();
await page.waitForTimeout(1500);
page.off('request', onRequest);
report('Back → schedule interactive', await back.stop(), b0, b1);
console.log(
  `${RUN} | Firestore requests issued on Back: ${reads} | URL after Back: ${page.url()}`,
);
await browser.close();
