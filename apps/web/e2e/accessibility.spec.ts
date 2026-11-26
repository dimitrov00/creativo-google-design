import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Page } from '@playwright/test';
import { Role } from '@core/components';
import {
  expectNoAxeViolations,
  type AxeContext,
} from '@creativo/shared/axe-scan';
import { seedUserProfile } from './support/seed-firestore';
import { signInAs } from './support/sign-in';
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
  Client: 'CLIENT',
  /** The owner who cuts hair and edits the programs: every staff page. */
  Owner: 'OWNER',
  Sysadmin: 'SYSADMIN',
} as const;
type As = (typeof As)[keyof typeof As];

type Waiver = NonNullable<AxeContext['disableRules']>[number];

/**
 * A violation the first full scan found (2026-11-26) and this change did
 * not fix: ONE rule switched off on ONE page, with what is wrong. A row may
 * only be removed — fix the page, delete the row. The list the owner reads
 * is docs/designs/accessibility-findings.md.
 */
const owed = (rule: string, what: string): Waiver => ({
  rule,
  reason: `${what}. Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.`,
});

type Scan =
  /** Opened at `visit` by `as`; `lands` when the page under test is where that navigation ends. */
  | {
      readonly as: As;
      readonly visit: string;
      readonly lands?: RegExp;
      /** What shows the page has drawn; a visible heading otherwise. */
      readonly ready?: string;
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
  '': { as: As.Public, visit: '/' },
  auth: { as: As.Public, visit: '/auth' },
  onboarding: {
    pending:
      'needs a session in the onboarding stage; its first step is driven by auth-onboarding.spec.ts, which does not scan it yet',
  },
  book: {
    as: As.Public,
    visit: '/book',
    known: [
      owed(
        'color-contrast',
        'dark: a footnote line on the first booking step is under 4.5:1 — a colour decision for the owner',
      ),
    ],
  },
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
      owed(
        'label-content-name-mismatch',
        'the week strip’s day buttons are named by an ISO date («2026-11-23») while they draw the weekday and the number',
      ),
      owed(
        'list',
        'a list on the schedule holds children that are not list items',
      ),
      owed(
        'color-contrast',
        'dark: today’s number on the week strip is under 4.5:1 — a colour decision for the owner',
      ),
    ],
  },
  'staff/analytics': {
    pending:
      'the bento keeps its placeholder tiles for an owner seeded with no worked days; staff-analytics.spec.ts seeds them and does not scan the page yet',
  },
  'staff/analytics/:card': {
    as: As.Owner,
    visit: '/staff/analytics/takings',
    known: [
      owed(
        'aria-command-name',
        'a bar of ui-bar-chart is a command with no accessible name (the showcase scan records the same)',
      ),
      owed(
        'nested-interactive',
        'ui-bar-chart puts focusable bars inside an interactive drawing (the showcase scan records the same)',
      ),
      owed(
        'label-content-name-mismatch',
        'a barber row is named «Виж …» while it draws the name and the sum without that word',
      ),
    ],
  },
  'staff/profile': {
    pending:
      'needs an account linked to a barber record; team-member.spec.ts seeds one and does not scan it yet',
  },
  staff: { redirect: true },
  admin: { redirect: true },
  'admin/programs': { as: As.Owner, visit: '/admin/programs' },
  'admin/team': { as: As.Owner, visit: '/admin/team' },
  'admin/team/permissions': { as: As.Owner, visit: '/admin/team/permissions' },
  'admin/team/permissions/:level': {
    as: As.Owner,
    visit: '/admin/team/permissions/barber',
  },
  'admin/team/member/:barberId': {
    pending:
      'needs a seeded barber record; team-member.spec.ts adds one and does not scan it yet',
  },
  'admin/team/account/:userId': {
    pending:
      'needs a seeded account; team-account.spec.ts seeds one and does not scan it yet',
  },
  'admin/loyalty': { redirect: true },
  'admin/loyalty/rhythm': { as: As.Owner, visit: '/admin/loyalty/rhythm' },
  support: { as: As.Sysadmin, visit: '/support' },
  forbidden: { as: As.Client, visit: '/staff/schedule', lands: /\/forbidden$/ },
  '**': { redirect: true },
};

const ROLES: Readonly<Record<As, readonly [Role, ...Role[]] | null>> = {
  [As.Public]: null,
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

async function open(page: Page, as: As): Promise<void> {
  const roles = ROLES[as];
  if (roles === null) return;
  const uid = `e2e-axe-${test.info().testId}`;
  await seedUserProfile(uid, { roles });
  await signInAs(page, uid, roles);
}

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
        await pinTheme(page, theme);
        // A scan mid-fade reads a blended colour as a contrast failure.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page, scan.as);
        await page.goto(scan.visit);
        await expect(page).toHaveURL(
          scan.lands ?? ((url) => url.pathname === scan.visit),
        );
        // The page has drawn (a scan of the empty shell passes anything),
        // and reads as a person reads it: its placeholders gone.
        await expect(
          page.locator(scan.ready ?? 'h1:visible, h2:visible').first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('ui-skeleton')).toHaveCount(0, {
          timeout: 15_000,
        });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await expectNoAxeViolations(page, { disableRules: scan.known ?? [] });
      });
    }
  }
});
