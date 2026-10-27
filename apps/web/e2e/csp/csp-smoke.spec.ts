import {
  type APIRequestContext,
  type Page,
  type TestInfo,
  expect,
  test,
} from '@playwright/test';
import { Role } from '@core/components';
import { LocalDate } from '@core/primitives';
import { MAPLIBRE_REPORT_ONLY_SINKS } from '@creativo/infrastructure/firebase-app/csp-baseline';
import { DEV_CHAIR } from '../support/appointment-seed-document';
import { attemptKey } from '../support/attempt-key';
import {
  seedAppointmentPhoto,
  seedUpcomingAppointment,
  seedUserProfile,
} from '../support/seed-firestore';
import { shopToday } from '../support/shop-clock';
import { signInAs } from '../support/sign-in';

/**
 * THE CSP SMOKE (owner rulings OR-29, OR-30, OR-31): the `csp-smoke` build
 * behind the Hosting emulator's real headers, walked as a guest, a client,
 * a barber and an admin — the landing and its map, `/book` through the map
 * to the services, the three programs pages, `/account`, the staff day with
 * a visit sheet and its photo, and `/admin/programs`. Every page fails on
 * ANY violation of either disposition (the enforced policy and the Trusted
 * Types report-only one) beyond the measured MapLibre baseline below, and
 * on any response from the site that lacks a security header; the cache
 * headers of `/`, `/staff`, a hashed chunk and `ngsw.json` are pinned.
 *
 * Run through `pnpm run verify:csp` (`playwright.csp.config.mts`) — never
 * under the e2e suite's config, whose dev server serves no policy: there it
 * skips itself.
 */
// eslint-disable-next-line playwright/no-skipped-test -- not a parked test: the e2e suite's `./e2e` holds this folder too, and only the smoke's own config runs it.
test.skip(
  process.env['CREATIVO_CSP_SMOKE'] !== '1',
  'the CSP smoke runs under playwright.csp.config.mts (pnpm run verify:csp)',
);

/** The security headers `firebase.json` sets on every response (`**`, OR-29). */
const SECURITY_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'x-frame-options',
] as const;

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/*
 * THE MEASURED REPORT-ONLY BASELINE — the three Trusted Types sinks MapLibre
 * GL trips (`MAPLIBRE_REPORT_ONLY_SINKS`, the one list the page's issue
 * reporter drops them by too). Tolerated ONLY in report-only, ONLY when the
 * script that tripped them is the MapLibre chunk; anything else — an
 * enforced violation of any kind, any other sink, any other script — fails.
 */

/** What MapLibre's own chunk always carries: its CSS class names, spelled in its JS. */
const MAPLIBRE_CHUNK = /maplibregl-/;

/** One `securitypolicyviolation` as the page saw it. */
type Violation = {
  readonly disposition: string;
  readonly effectiveDirective: string;
  readonly blockedURI: string;
  readonly sourceFile: string;
  readonly lineNumber: number;
  readonly sample: string;
  readonly documentURI: string;
};

declare global {
  interface Window {
    __cspViolation?: (violation: Violation) => void;
  }
}

/** What one page of the walk saw: every violation, and every site response that lacked a security header. */
type Watch = {
  readonly violations: Violation[];
  readonly missingHeaders: string[];
};

/**
 * Watches `page` from its first byte: a `securitypolicyviolation` listener
 * installed before any of the page's own scripts (the inline ones included)
 * reports through a binding that survives navigations, and every response
 * from the site — every one off the network, the browser cache off — is held
 * to the security headers.
 */
async function watch(page: Page): Promise<Watch> {
  const seen: Watch = { violations: [], missingHeaders: [] };
  // Every response off the network: Chromium's HTTP cache persists a
  // response without its `Strict-Transport-Security` (security state is
  // never cached), so a chunk the page fetched again would read as one
  // Hosting sent without it. Both projects run Chromium.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.exposeFunction('__cspViolation', (violation: Violation) => {
    seen.violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        window.__cspViolation?.({
          disposition: event.disposition,
          effectiveDirective: event.effectiveDirective,
          blockedURI: event.blockedURI,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
          sample: event.sample,
          documentURI: event.documentURI,
        });
      },
      true,
    );
  });
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;
  page.on('response', (response) => {
    const url = new URL(response.url());
    // A `blob:` URL carries its creator's origin, but the page minted it in
    // memory (a fetched portrait): Hosting never served it, so it has no
    // headers to hold.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== origin) return;
    const headers = response.headers();
    for (const name of SECURITY_HEADERS) {
      if (!Object.hasOwn(headers, name)) {
        seen.missingHeaders.push(`${name} on ${response.url()}`);
      }
    }
  });
  return seen;
}

/** Whether `violation` is one of the MapLibre baseline's — read off the script that tripped it. */
async function isMapLibreBaseline(
  request: APIRequestContext,
  violation: Violation,
): Promise<boolean> {
  if (violation.disposition !== 'report') return false;
  if (violation.effectiveDirective !== 'require-trusted-types-for') {
    return false;
  }
  if (!MAPLIBRE_REPORT_ONLY_SINKS.some((sink) => sink.test(violation.sample))) {
    return false;
  }
  if (violation.sourceFile === '') return false;
  const script = await request.get(violation.sourceFile);
  return MAPLIBRE_CHUNK.test(await script.text());
}

/**
 * No violation beyond the MapLibre baseline, and no site response without
 * its security headers — the tolerated baseline attached to the report so
 * it stays in sight.
 */
async function expectClean(
  request: APIRequestContext,
  seen: Watch,
  info: TestInfo,
): Promise<void> {
  const unexpected: Violation[] = [];
  const baseline: Violation[] = [];
  for (const violation of seen.violations) {
    if (await isMapLibreBaseline(request, violation)) baseline.push(violation);
    else unexpected.push(violation);
  }
  if (baseline.length > 0) {
    await info.attach('maplibre-report-only-baseline.json', {
      body: JSON.stringify(baseline, null, 2),
      contentType: 'application/json',
    });
  }
  expect(unexpected, 'CSP violations (either disposition)').toEqual([]);
  expect(seen.missingHeaders, 'responses without a security header').toEqual(
    [],
  );
}

/** Scrolls the whole page, so every `@defer (on viewport)` section hydrates. */
async function scrollThroughPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight, 600);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

/** A programs page has landed: its list, or its empty state — never its error. */
async function expectProgramsPage(page: Page, name: string): Promise<void> {
  await expect(
    page.getByTestId(`${name}-list`).or(page.getByTestId(`${name}-empty`)),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`${name}-error`)).toHaveCount(0);
}

test.describe('the CSP smoke — the real artifact behind the real headers', () => {
  test('a guest: the landing and its map, /book through the map to the services, the programs pages', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const seen = await watch(page);

    await page.goto('/');
    await expect(page.getByTestId('landing-hero')).toBeVisible();
    await scrollThroughPage(page);
    await expect(page.getByTestId('landing-locations')).toBeVisible();
    await expect(page.locator('[data-locations-map]')).toBeVisible();
    await expect(page.locator('[data-locations-map] canvas')).toBeVisible({
      timeout: 20_000,
    });

    // /book: the location step IS the map view; then on to the services.
    await page.goto('/book');
    const machine = page.getByTestId('booking-machine');
    await expect(machine).toHaveAttribute('data-state', 'location', {
      timeout: 20_000,
    });
    await expect(
      page.getByTestId('booking-location-map').locator('canvas'),
    ).toBeVisible({ timeout: 20_000 });
    await page
      .locator(
        `[data-testid="booking-location-row"][data-location="${DEV_CHAIR.locationId}"]`,
      )
      .click();
    await page.getByTestId('booking-location-continue').click();
    await expect(machine).toHaveAttribute('data-state', 'services');
    await expect(
      page.getByTestId(`service-card-${DEV_CHAIR.serviceId}`),
    ).toBeVisible();

    await page.goto('/careers');
    await expectProgramsPage(page, 'careers');
    await page.goto('/courses');
    await expectProgramsPage(page, 'courses');
    await page.goto('/events');
    await expectProgramsPage(page, 'events');

    await expectClean(request, seen, test.info());
  });

  test('a client: /account', async ({ page, request }) => {
    const uid = `csp-client-${attemptKey(test.info())}`;
    await seedUserProfile(uid);
    const seen = await watch(page);
    await signInAs(page, uid, [Role.Client]);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );

    await expectClean(request, seen, test.info());
  });

  test('a barber: the staff day, a visit sheet and its photo', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const clientUid = `csp-visit-${run}`;
    const visitId = `${clientUid}-visit`;
    // Tomorrow, so the visit is ahead whatever the hour the suite runs at.
    const day = LocalDate.addDays(shopToday(), 1);
    await seedUserProfile(clientUid);
    await seedUpcomingAppointment(visitId, clientUid, `${day}T10:00:00`);
    const photoId = await seedAppointmentPhoto(visitId, clientUid);
    const seen = await watch(page);
    await signInAs(page, `csp-barber-${run}`, [Role.Barber]);

    await page.goto(`/staff/schedule?day=${day}&view=agenda`);
    const visit = page.locator(
      `[data-row-id="${visitId}#${DEV_CHAIR.barberId}"]`,
    );
    await expect(visit).toBeVisible({ timeout: 30_000 });
    await visit.click();
    await expect(page.getByTestId('staff-visit-editor')).toHaveAttribute(
      'data-depth',
      '0',
    );
    // The photo: its thumbnail from Storage, then its page.
    const thumb = page.getByTestId(`staff-visit-photo-${photoId}`);
    await expect(thumb).toBeVisible({ timeout: 20_000 });
    await thumb.click();
    const photo = page.getByTestId('staff-visit-photo-page').locator('img');
    await expect(photo).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    await expectClean(request, seen, test.info());
  });

  test('an admin: /admin/programs', async ({ page, request }) => {
    const seen = await watch(page);
    await signInAs(page, `csp-admin-${attemptKey(test.info())}`, [Role.Admin]);

    await page.goto('/admin/programs');
    await expect(page.getByTestId('admin-programs-page')).toBeVisible({
      timeout: 20_000,
    });

    await expectClean(request, seen, test.info());
  });

  test('the cache headers: the app shell and the service-worker channel revalidate, a hashed chunk is immutable', async ({
    request,
  }) => {
    const shell = await request.get('/');
    expect(shell.ok()).toBe(true);
    const html = await shell.text();
    const chunk = /<script[^>]+src="\/?(main-[A-Za-z0-9_-]+\.js)"/.exec(
      html,
    )?.[1];
    expect(chunk, 'the hashed main chunk index.html loads').toBeDefined();

    const expected: readonly (readonly [string, string])[] = [
      ['/', NO_CACHE],
      ['/staff', NO_CACHE],
      [`/${chunk}`, IMMUTABLE],
      ['/ngsw.json', NO_CACHE],
    ];
    for (const [path, cacheControl] of expected) {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers['cache-control'], `Cache-Control of ${path}`).toBe(
        cacheControl,
      );
      expect(
        SECURITY_HEADERS.filter((name) => !Object.hasOwn(headers, name)),
        `security headers missing on ${path}`,
      ).toEqual([]);
    }
  });
});
