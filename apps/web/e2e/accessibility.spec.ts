import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Page } from '@playwright/test';
import { AuthClaims, Role } from '@core/components';
import { LocalDate, TenantId } from '@core/primitives';
import {
  expectNoAxeViolations,
  type AxeContext,
} from '@creativo/shared/axe-scan';
import { DEV_CLASSIC_CUT } from './support/appointment-seed-document';
import { attemptKey } from './support/attempt-key';
import { mintCustomToken } from './support/mint-custom-token';
import {
  seedClosedPositions,
  seedUserProfile,
  seedWorkedAppointment,
  waitForAnalyticsDay,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { suiteDay } from './support/suite-clock';
import { THEMES, pinTheme } from './support/theme';

/**
 * EVERY PAGE IS SCANNED (2026-11-26). One axe scan (WCAG 2.2 A and AA) of
 * each route the app declares, as it first settles, once per theme. The
 * design-system elements are scanned on their own in the showcase
 * (`apps/showcase/e2e/accessibility.spec.ts`); this is the pages built from
 * them. States behind a tap (an open sheet, a menu, a later step of a flow)
 * are scanned by the specs that drive them, with `expectNoAxeViolations`.
 */

/** Who opens the page. */
const As = {
  Public: 'PUBLIC',
  /** Signed in and not registered yet: the session `/onboarding` is for. */
  Onboarding: 'ONBOARDING',
  Client: 'CLIENT',
  /** The owner who cuts hair and edits the programs: every staff page. */
  Owner: 'OWNER',
  Sysadmin: 'SYSADMIN',
} as const;
type As = (typeof As)[keyof typeof As];

type Waiver = NonNullable<AxeContext['disableRules']>[number];

/**
 * Not a fault. A control that holds a small chart draws the chart's own
 * marks as text — an axis' first and last date, a bar's count, a weekday
 * table — and is named by a sentence that begins with its title and says
 * the same figures in words. The marks are the picture; WCAG 2.5.3 is about
 * the label's words, which lead the name. (The scan already forgives what
 * axe gets wrong about separate blocks — `rejudgeNameMismatches` — so what
 * is left on these pages is only the charts.)
 */
const CHART_MARKS = (where: string): Waiver => ({
  rule: 'label-content-name-mismatch',
  reason: `not a fault: ${where}, and its name begins with its title and says those figures as a sentence. Decided 2026-11-26, docs/designs/accessibility-findings.md.`,
});

/**
 * Not a fault. The timeline's two edge handles draw as a 20px pill and are
 * pressed through a 44px area their `::before` lays over and inside the
 * bar (staff-timeline.band.css). axe measures the element's own box and
 * cannot see a pseudo-element, so it reads the pill as the whole target.
 */
const HANDLE_REACH: Waiver = {
  rule: 'target-size',
  reason:
    'not a fault: a timeline edge handle is a 20px pill pressed through a 44px ::before area, which axe cannot measure. Decided 2026-11-26, docs/designs/accessibility-findings.md.',
};

type Scan =
  /** Opened at `visit` by `as`; `lands` when the page under test is where that navigation ends. */
  | {
      readonly as: As;
      /** The address; a function when it names the signed-in account itself. */
      readonly visit: string | ((uid: string) => string);
      readonly lands?: RegExp;
      /** The barber record the account is linked to (the account's side only: no lock is taken, so no other spec's link is contended). */
      readonly linkedBarberId?: string;
      /** Data the page needs before it is opened, keyed by this attempt. */
      readonly prepare?: (run: string) => Promise<void>;
      /** What shows the page has drawn; a visible heading otherwise. */
      readonly ready?: string;
      /**
       * What the walk must have brought on screen before the scan reads the
       * page: the parts drawn late (a deferred section, a map's pins), named
       * so a run that never drew them fails instead of passing unscanned.
       */
      readonly drawn?: readonly string[];
      readonly known?: readonly Waiver[];
    }
  /** Never drawn: a redirect has nothing to scan. */
  | { readonly redirect: true }
  /** Not scanned yet, and why. May only be replaced by a scan. */
  | { readonly pending: string };

/**
 * EVERY path `app.routes.ts` declares. A route added without a row here
 * fails the first test, so a new page cannot ship unscanned.
 */
const ROUTES: Readonly<Record<string, Scan>> = {
  '': {
    as: As.Public,
    visit: '/',
    drawn: ['.team-card', '.location-card', '.locations-map__pin'],
  },
  auth: { as: As.Public, visit: '/auth' },
  onboarding: {
    as: As.Onboarding,
    visit: '/onboarding',
    ready: '[data-testid="onboarding-about"]',
  },
  book: { as: As.Public, visit: '/book' },
  careers: { as: As.Public, visit: '/careers' },
  courses: { as: As.Public, visit: '/courses' },
  events: { as: As.Public, visit: '/events' },
  account: { as: As.Client, visit: '/account' },
  'account/appointments': { as: As.Client, visit: '/account/appointments' },
  'account/notifications': { as: As.Client, visit: '/account/notifications' },
  'account/profile': { as: As.Client, visit: '/account/profile' },
  'staff/schedule': {
    as: As.Owner,
    visit: '/staff/schedule',
    known: [
      {
        rule: 'color-contrast',
        reason:
          'not a fault: today’s chosen number is near-black on the orange disc (6.16:1, held by accent-label.spec.ts), but the disc is a separate sliding marker, so axe measures the number against the bar behind it. Decided 2026-11-26, docs/designs/accessibility-findings.md.',
      },
    ],
  },
  'staff/analytics': {
    as: As.Owner,
    visit: '/staff/analytics',
    // The bento keeps its placeholder tiles until a report with a worked
    // day arrives: one visit on the 1st of the suite's month, and its
    // day's figures written by the trigger.
    prepare: async (run) => {
      const client = `e2e-axe-client-${run}`;
      const first = LocalDate.startOfMonth(suiteDay());
      await seedUserProfile(client, { firstName: 'Петър', lastName: 'Колев' });
      const seededAt = Date.now();
      await seedWorkedAppointment(
        `${run}-axe`,
        client,
        `${first}T15:00:00`,
        DEV_CLASSIC_CUT,
        'niko',
      );
      await waitForAnalyticsDay('niko', first, seededAt);
    },
    ready: 'main[data-load="READY"]',
    known: [
      CHART_MARKS(
        'a bento card with a chart draws the chart’s axis dates and day figures',
      ),
    ],
  },
  'staff/analytics/:card': {
    as: As.Owner,
    visit: '/staff/analytics/takings',
    known: [
      CHART_MARKS(
        'a bar of the services chart draws its service, its count and its sum as marks',
      ),
    ],
  },
  'staff/profile': {
    as: As.Owner,
    visit: '/staff/profile',
    linkedBarberId: 'ivan',
    // The record itself, not the «not linked» or the missing state.
    ready: '[data-testid="member-name"]',
  },
  staff: { redirect: true },
  admin: { redirect: true },
  'admin/programs': {
    as: As.Owner,
    visit: '/admin/programs',
    // An order to arrange needs two positions; the scan seeds its own.
    prepare: seedClosedPositions,
  },
  'admin/team': { as: As.Owner, visit: '/admin/team' },
  'admin/team/permissions': { as: As.Owner, visit: '/admin/team/permissions' },
  'admin/team/permissions/:level': {
    as: As.Owner,
    visit: '/admin/team/permissions/barber',
  },
  // The dev seed's own barber, and the owner's own account.
  'admin/team/member/:barberId': {
    as: As.Owner,
    visit: '/admin/team/member/ivan',
    ready: '[data-testid="member-name"]',
  },
  'admin/team/account/:userId': {
    as: As.Owner,
    visit: (uid) => `/admin/team/account/${uid}`,
    ready: '[data-testid="account-name"]',
  },
  'admin/loyalty': { redirect: true },
  'admin/loyalty/rhythm': { as: As.Owner, visit: '/admin/loyalty/rhythm' },
  support: { as: As.Sysadmin, visit: '/support' },
  forbidden: { as: As.Client, visit: '/staff/schedule', lands: /\/forbidden$/ },
  '**': { redirect: true },
};

const ROLES: Readonly<Record<As, readonly [Role, ...Role[]] | null>> = {
  [As.Public]: null,
  [As.Onboarding]: null,
  [As.Client]: [Role.Client],
  [As.Owner]: [Role.Admin, Role.Barber, Role.ContentManager],
  [As.Sysadmin]: [Role.Sysadmin],
};

/** The paths `app.routes.ts` declares, read off its source. */
function declaredPaths(): readonly string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own route table.
  const source = readFileSync(
    join(workspaceRoot, 'apps/web/src/app/app.routes.ts'),
    'utf8',
  );
  return [...source.matchAll(/^\s*(?:\{ )?path: '([^']*)',/gm)].map(
    (match) => match[1] ?? '',
  );
}

/** Signs the page in as the scan asks, and answers the account's id. */
async function open(
  page: Page,
  scan: Extract<Scan, { visit: unknown }>,
): Promise<string> {
  const uid = `e2e-axe-${attemptKey(test.info())}`;
  if (scan.as === As.Onboarding) {
    // A session with no roles yet — the claims the functions mint for an
    // account that has verified its address and not registered.
    const claims = AuthClaims.onboarding(TenantId.of('creativo'));
    const token = await mintCustomToken(uid, { ...AuthClaims.toToken(claims) });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
    await page.evaluate((custom) => window.__e2eSignIn?.(custom), token);
    return uid;
  }
  const roles = ROLES[scan.as];
  if (roles === null) return uid;
  await seedUserProfile(uid, {
    roles,
    linkedBarberId: scan.linkedBarberId ?? null,
  });
  await signInAs(page, uid, roles);
  return uid;
}

/**
 * Scrolls to the end of the page a screen at a time, then back to the top —
 * again and again until a pass no longer makes the page taller, because a
 * section drawn by one pass pushes the next one further down.
 */
async function walkThePage(page: Page): Promise<void> {
  let height = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    const walked = await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      window.scrollTo(0, 0);
      return document.documentElement.scrollHeight;
    });
    if (walked === height) return;
    height = walked;
  }
}

/** Opens the page as the scan asks and waits until it reads as a person reads it. */
async function draw(
  page: Page,
  scan: Extract<Scan, { visit: unknown }>,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await pinTheme(page, theme);
  // A scan mid-fade reads a blended colour as a contrast failure.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scan.prepare?.(attemptKey(test.info()));
  const uid = await open(page, scan);
  const visit = typeof scan.visit === 'string' ? scan.visit : scan.visit(uid);
  await page.goto(visit);
  await expect(page).toHaveURL(scan.lands ?? ((url) => url.pathname === visit));
  // The page has drawn (a scan of the empty shell passes anything),
  // and reads as a person reads it: its placeholders gone.
  await expect(
    page.locator(scan.ready ?? 'h1:visible, h2:visible').first(),
  ).toBeVisible({ timeout: 15_000 });
  // A section below the fold is drawn only once it nears the viewport
  // (`@defer (on viewport)`): walk the page to its end and back, so
  // the scan reads all of it on every run, not what a fast or a slow
  // machine happened to have drawn (the landing's shops were scanned
  // on CI and not locally, 2026-11-26).
  await walkThePage(page);
  for (const part of scan.drawn ?? []) {
    await expect(page.locator(part).first(), part).toBeAttached({
      timeout: 15_000,
    });
  }
  // A placeholder inside a part hidden from readers is not one the
  // page is waiting on: the analytics carousel keeps its neighbouring
  // periods as hidden placeholder pages for as long as it is open.
  await expect(
    page.locator(
      'ui-skeleton:not([aria-hidden="true"] ui-skeleton, [inert] ui-skeleton)',
    ),
  ).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** A step or a mark: a test id, or a selector when it starts like one. */
const at = (page: Page, mark: string) =>
  /^[.#[]|[ >:]/.test(mark) ? page.locator(mark) : page.getByTestId(mark);

test.use({ viewport: { width: 375, height: 812 } });

test.describe('page accessibility', () => {
  test('every route the app declares is scanned, a redirect, or owed with a reason', () => {
    expect([...declaredPaths()].sort()).toEqual(Object.keys(ROUTES).sort());
    for (const [path, scan] of Object.entries(ROUTES)) {
      if ('pending' in scan) expect(scan.pending.trim(), path).not.toBe('');
    }
  });

  for (const [path, scan] of Object.entries(ROUTES)) {
    if (!('visit' in scan)) continue;
    for (const theme of THEMES) {
      test(`/${path} has no axe violations — ${theme}`, async ({ page }) => {
        await draw(page, scan, theme);
        await expectNoAxeViolations(page, { disableRules: scan.known ?? [] });
      });
    }
  }
});

/**
 * WHAT A TAP OPENS (2026-11-26). A sheet, a menu, an alert or a calendar is
 * not on the page until it is asked for, so the page scan above never read
 * one. Each row opens one from its page with the taps a person makes and
 * scans the page with it open, in both themes. Overlays that need a flow
 * of their own (a booking in progress, a seeded visit) are scanned by the
 * spec that drives that flow.
 */
interface Overlay {
  /** What is opened, in a person's words — the test's name. */
  readonly name: string;
  /** The page it opens from: a key of `ROUTES`, whose sign-in and data it takes. */
  readonly on: string;
  /** The taps, in order. */
  readonly taps: readonly string[];
  /** What is on screen once it is open. */
  readonly opened: string;
  readonly known?: readonly Waiver[];
}

const OVERLAYS: readonly Overlay[] = [
  {
    name: 'the landing site menu',
    on: '',
    taps: ['nav-menu-trigger'],
    opened: 'site-menu',
  },
  {
    name: 'the landing barber sheet',
    on: '',
    taps: ['.team-card'],
    opened: '#barber-detail-sheet',
  },
  {
    name: 'the landing shop sheet',
    on: '',
    taps: ['.location-card__open'],
    opened: 'landing-location-sheet',
  },
  {
    name: 'the landing service sheet',
    on: '',
    taps: ['[data-testid^="service-tile-"]:visible'],
    opened: '#catalog-sheet',
  },
  {
    name: 'the onboarding country picker',
    on: 'onboarding',
    taps: ['phone-field-trigger'],
    opened: 'ui-phone-field ui-modal-sheet[data-open]',
  },
  {
    name: 'the profile edit sheet',
    on: 'account/profile',
    taps: ['profile-row-name'],
    opened: '#profile-edit-sheet',
  },
  {
    name: 'the schedule day calendar',
    on: 'staff/schedule',
    taps: ['staff-day-label'],
    opened: 'staff-day-label-calendar',
  },
  {
    name: 'the schedule view menu',
    on: 'staff/schedule',
    taps: ['staff-view-trigger'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'the schedule search sheet',
    on: 'staff/schedule',
    taps: ['staff-search-entry'],
    opened: 'staff-search-sheet',
  },
  {
    name: 'the schedule status filter',
    on: 'staff/schedule',
    taps: ['staff-status-filter-open'],
    opened: 'staff-status-filter-sheet',
  },
  {
    name: 'the schedule add menu',
    on: 'staff/schedule',
    taps: ['staff-add-trigger'],
    opened: 'staff-add-booking',
  },
  {
    name: 'the new visit sheet',
    on: 'staff/schedule',
    taps: ['staff-add-trigger', 'staff-add-booking'],
    opened: 'staff-create-sheet',
    known: [HANDLE_REACH],
  },
  {
    name: 'the blocked time sheet',
    on: 'staff/schedule',
    taps: ['staff-add-trigger', 'staff-add-block'],
    opened: 'staff-block-sheet',
    known: [HANDLE_REACH],
  },
  {
    name: 'the working hours sheet',
    on: 'staff/schedule',
    taps: ['staff-add-trigger', 'staff-add-hours'],
    opened: 'staff-hours-sheet',
  },
  {
    name: 'the analytics period menu',
    on: 'staff/analytics',
    taps: ['analytics-period-menu'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'the analytics status note',
    on: 'staff/analytics',
    taps: ['analytics-status-info'],
    opened: '[data-testid="analytics-info"] dialog[open]',
  },
  {
    name: 'the analytics card note',
    on: 'staff/analytics/:card',
    taps: ['analytics-card-info'],
    opened: '[data-testid="analytics-info"] dialog[open]',
  },
  {
    name: 'the analytics custom range sheet',
    on: 'staff/analytics/:card',
    taps: ['analytics-custom-range'],
    opened: 'analytics-range-sheet',
  },
  {
    name: 'the programs editor sheet',
    on: 'admin/programs',
    taps: ['admin-new'],
    opened: 'admin-form',
  },
  {
    name: 'a program row’s place menu, while the list is arranged',
    on: 'admin/programs',
    taps: ['admin-order-start', '[data-testid^="admin-order-handle-"]'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'the team add menu',
    on: 'admin/team',
    taps: ['admin-team-add'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'a member’s profile sheet',
    on: 'admin/team/member/:barberId',
    taps: ['member-row-profile'],
    opened: 'member-profile-sheet',
  },
  {
    name: 'a member’s working period sheet',
    on: 'admin/team/member/:barberId',
    taps: ['member-row-period'],
    opened: 'member-period-sheet',
  },
  {
    name: 'a member’s hours sheet',
    on: 'admin/team/member/:barberId',
    taps: ['member-row-hours'],
    opened: 'staff-hours-sheet',
  },
  {
    name: 'a member’s services sheet',
    on: 'admin/team/member/:barberId',
    taps: ['member-row-services'],
    opened: 'member-offerings-sheet',
  },
  {
    name: 'a permission’s value menu',
    on: 'admin/team/permissions/:level',
    taps: ['[data-testid^="permission-value-"]'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'the rhythm qualifier menu',
    on: 'admin/loyalty/rhythm',
    taps: ['admin-rhythm-qualifier'],
    opened: '.ui-menu__surface:popover-open',
  },
  {
    name: 'the rhythm protections sheet',
    on: 'admin/loyalty/rhythm',
    taps: ['admin-rhythm-row-protections'],
    opened: '#admin-rhythm-sheet',
  },
  {
    name: 'the support account lookup',
    on: 'support',
    taps: ['support-find'],
    opened: 'support-lookup-sheet',
  },
];

test.describe('what a tap opens', () => {
  test('every overlay opens from a page the scan draws', () => {
    for (const overlay of OVERLAYS) {
      const scan = ROUTES[overlay.on];
      expect(scan !== undefined && 'visit' in scan, overlay.name).toBe(true);
    }
  });

  for (const overlay of OVERLAYS) {
    const scan = ROUTES[overlay.on];
    if (scan === undefined || !('visit' in scan)) continue;
    for (const theme of THEMES) {
      test(`${overlay.name} has no axe violations — ${theme}`, async ({
        page,
      }) => {
        await draw(page, scan, theme);
        for (const tap of overlay.taps) {
          const target = at(page, tap).first();
          await target.scrollIntoViewIfNeeded();
          await target.click();
        }
        // A sheet's host chunk may load on the first tap: wait for the
        // overlay itself, never for a fixed time.
        await expect(at(page, overlay.opened).first()).toBeVisible({
          timeout: 15_000,
        });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await expectNoAxeViolations(page, {
          disableRules: [...(scan.known ?? []), ...(overlay.known ?? [])],
        });
      });
    }
  }
});
