import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { seedUserProfile } from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { emulateInstalledApp } from './support/standalone';

/**
 * NO PAGE IS A DEAD END (2026-11-24). The installed app has no browser
 * back, so every page must carry its own way out: a ROOT page (one a person
 * lands on) carries the account menu — the site header's, or the account
 * face on a page whose own toolbar fills the top (the schedule) — and a
 * CHILD page carries an icon-only back to a fixed parent, never browser
 * history. Each page here is opened COLD, as an installed app opens it:
 * a fresh navigation, nothing behind it to go back to.
 *
 * Before this spec: the schedule had no menu, `/admin/programs` had nothing,
 * the rhythm page's back went to `/admin`, which redirects to the rhythm page,
 * and `/forbidden` was a sentence.
 */

/** How a page lets a person leave it. */
const Exit = {
  /** The site header's menu, or the account face that opens the same menu. */
  Menu: 'MENU',
  /** An icon-only back to a fixed parent. */
  Back: 'BACK',
  /** A flow with its own back and its own end (sign-in, onboarding, booking). */
  Flow: 'FLOW',
  /** A redirect: never drawn, so it has no chrome of its own. */
  Redirect: 'REDIRECT',
  /** `/forbidden`: one link home. */
  Home: 'HOME',
} as const;
type Exit = (typeof Exit)[keyof typeof Exit];

/**
 * EVERY path `app.routes.ts` declares, and how it is left. A route added
 * without a row here fails the first test, so a new page cannot ship
 * without its way out being decided. `visit` is the concrete URL this spec
 * opens; `null` where the page needs a seeded record (a team member, an
 * account, the person's own barber record) — those three take the same
 * fixed back link as the team list, proven in their own specs — and on
 * `/support`, which only the sysadmin opens: its own test below.
 */
const ROUTES: Readonly<Record<string, { exit: Exit; visit: string | null }>> = {
  '': { exit: Exit.Menu, visit: null },
  auth: { exit: Exit.Flow, visit: null },
  onboarding: { exit: Exit.Flow, visit: null },
  book: { exit: Exit.Flow, visit: null },
  careers: { exit: Exit.Menu, visit: null },
  courses: { exit: Exit.Menu, visit: null },
  events: { exit: Exit.Menu, visit: null },
  account: { exit: Exit.Menu, visit: '/account' },
  'account/appointments': { exit: Exit.Back, visit: '/account/appointments' },
  'account/notifications': {
    exit: Exit.Back,
    visit: '/account/notifications',
  },
  'account/profile': { exit: Exit.Menu, visit: '/account/profile' },
  'staff/schedule': { exit: Exit.Menu, visit: '/staff/schedule' },
  'staff/analytics': { exit: Exit.Back, visit: '/staff/analytics' },
  'staff/analytics/:card': {
    exit: Exit.Back,
    visit: '/staff/analytics/takings',
  },
  'staff/profile': { exit: Exit.Back, visit: null },
  staff: { exit: Exit.Redirect, visit: null },
  admin: { exit: Exit.Redirect, visit: null },
  'admin/programs': { exit: Exit.Menu, visit: '/admin/programs' },
  'admin/team': { exit: Exit.Back, visit: '/admin/team' },
  'admin/team/permissions': {
    exit: Exit.Back,
    visit: '/admin/team/permissions',
  },
  'admin/team/permissions/:level': {
    exit: Exit.Back,
    visit: '/admin/team/permissions/barber',
  },
  'admin/team/member/:barberId': { exit: Exit.Back, visit: null },
  'admin/team/account/:userId': { exit: Exit.Back, visit: null },
  'admin/loyalty': { exit: Exit.Redirect, visit: null },
  'admin/loyalty/rhythm': { exit: Exit.Back, visit: '/admin/loyalty/rhythm' },
  support: { exit: Exit.Menu, visit: null },
  forbidden: { exit: Exit.Home, visit: null },
  '**': { exit: Exit.Redirect, visit: null },
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

/** The concrete URLs this spec opens for the pages left by `exit`. */
function visitsOf(exit: Exit): readonly string[] {
  return Object.values(ROUTES).flatMap((route) =>
    route.exit === exit && route.visit !== null ? [route.visit] : [],
  );
}

const MENU_TRIGGER =
  '[data-testid="nav-menu-trigger"]:visible, [data-testid="account-menu-trigger"]:visible';
const BACK =
  'a:visible:has(ui-icon[data-name="nav.back"]), button:visible:has(ui-icon[data-name="nav.back"])';

/** Signs in a person who may open every staff page: the owner who cuts hair and edits the programs. */
async function signInAsOwner(page: Page): Promise<void> {
  const uid = `e2e-no-dead-ends-${test.info().testId}`;
  const roles = [Role.Admin, Role.Barber, Role.ContentManager] as const;
  await seedUserProfile(uid, { roles });
  await emulateInstalledApp(page);
  await signInAs(page, uid, roles);
}

test.use({ viewport: { width: 375, height: 812 } });

test.describe('no page is a dead end', () => {
  test('every route the app declares has a decided way out', () => {
    expect([...declaredPaths()].sort()).toEqual(Object.keys(ROUTES).sort());
  });

  test('a root page opens the account menu, which can sign out', async ({
    page,
  }) => {
    await signInAsOwner(page);
    for (const visit of visitsOf(Exit.Menu)) {
      await page.goto(visit);
      const trigger = page.locator(MENU_TRIGGER).first();
      await expect(trigger, visit).toBeVisible();
      await trigger.click();
      await expect(page.getByTestId('menu-sign-out'), visit).toBeVisible();
    }
  });

  test('a child page has a back that leaves it, opened cold', async ({
    page,
  }) => {
    await signInAsOwner(page);
    for (const start of visitsOf(Exit.Back)) {
      await page.goto(start);
      const back = page.locator(BACK).first();
      await expect(back, start).toBeVisible();
      await back.click();
      await expect(page, start).not.toHaveURL(
        (url) => url.pathname === new URL(start, url).pathname,
      );
      await expect(page, start).not.toHaveURL(/\/forbidden$/);
    }
  });

  test('the schedule menu closes with its own ✕ and draws over the thumb bar', async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto('/staff/schedule');
    await page.getByTestId('account-menu-trigger').click();
    const menu = page.getByTestId('site-menu');
    await expect(menu).toBeVisible();
    // In the top layer, so the schedule's own bars never paint over it.
    expect(await menu.evaluate((el) => el.matches(':popover-open'))).toBe(true);
    await expect(page.getByTestId('menu-admin-programs')).toBeVisible();
    await page.getByTestId('menu-close').click();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(/\/staff\/schedule/);
  });

  test('a content manager is offered «Програми», never the schedule it cannot read', async ({
    page,
  }) => {
    const uid = `e2e-content-${test.info().testId}`;
    await seedUserProfile(uid, { roles: [Role.ContentManager] });
    await emulateInstalledApp(page);
    await signInAs(page, uid, [Role.ContentManager]);

    await page.goto('/account');
    await page.getByTestId('nav-menu-trigger').click();
    await expect(page.getByTestId('menu-sign-out')).toBeVisible();
    await expect(page.getByTestId('menu-staff-day')).toHaveCount(0);
    await page.getByTestId('menu-admin-programs').click();
    await expect(page).toHaveURL(/\/admin\/programs$/);

    // The schedule's guard is the rules' `worksTheBook()`: not this person.
    await page.goto('/staff/schedule');
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test('/support, the sysadmin’s own root page, opens the account menu', async ({
    page,
  }) => {
    const uid = `e2e-no-dead-ends-support-${test.info().testId}`;
    await seedUserProfile(uid, { roles: [Role.Sysadmin] });
    await emulateInstalledApp(page);
    await signInAs(page, uid, [Role.Sysadmin]);

    await page.goto('/support');
    const trigger = page.locator(MENU_TRIGGER).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId('menu-sign-out')).toBeVisible();
    await expect(page.getByTestId('menu-support')).toBeVisible();
  });

  test('/forbidden ends in one link home, which the installed app follows to the account', async ({
    page,
  }) => {
    const uid = `e2e-forbidden-${test.info().testId}`;
    await seedUserProfile(uid);
    await emulateInstalledApp(page);
    await signInAs(page, uid, [Role.Client]);

    await page.goto('/staff/schedule');
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.getByTestId('forbidden-home').click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
