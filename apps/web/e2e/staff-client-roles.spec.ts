import { expect, test, type Page } from '@playwright/test';
import { AuditAction, Role } from '@core/components';
import { Collections } from '@core/entities';
import { attemptKey } from './support/attempt-key';
import { expectNoAxeViolations } from './support/axe';
import {
  readAuditActionsFor,
  readStoredBody,
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';
import { EVENING_VISIT_START } from './support/shop-clock';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';
import { THEMES, pinTheme } from './support/theme';

/**
 * AN AUDITED ROLE CHANGE (security hardening S-WS-E, S-RU-13, S-DEP-7):
 * the shop's admin opens a client's card from today's visit, and the
 * card's «Роли» block — five checkbox rows over the assignable roles and
 * «Запази ролите» — sends the whole new set through `setRoles`. The Admin
 * SDK then reads what the server FILED: `users/{uid}.roles` with the new
 * role, and ONE `PROFILE_ROLES_CHANGED` audit row about the account,
 * written in the same commit (the profile trigger skips a callable's own
 * write, S-RU-12). A barber's card of the same client has no such block.
 *
 * The admin's STORED roles are seeded before the journey: `signInAs` puts
 * the roles in the token's claims only, and `setRoles` re-reads the
 * caller's `users/{uid}.roles` (S-L-15) — without them the call answers
 * `GOVERNANCE_ROLES_FORBIDDEN`. Each attempt seeds its OWN client (a
 * run-unique uid), so the change never touches a catalogue person; the
 * client holds no Auth user, so the revoke after the commit answers
 * `auth/user-not-found`, which `setRoles` reads as done. The page's clock is
 * pinned to the suite's day at 10:00 (`pinBrowserClock`), so today's 21:00
 * visit is one to come whatever the real hour.
 */

/** The visit sheet's editor — its `data-depth` is the page stack's. */
function editorOf(page: Page) {
  return page.getByTestId('staff-visit-editor');
}

/** The client — a registered `client` profile — and today's visit. */
async function seedClient(uid: string, today: string): Promise<void> {
  await seedUserProfile(uid, {
    firstName: 'Елена',
    lastName: 'Тодорова',
    phone: '+359881112244',
  });
  await seedUpcomingAppointment(
    `${uid}-today`,
    uid,
    `${today}T${EVENING_VISIT_START}`,
  );
}

/**
 * Opens the day's agenda on `rowId`'s visit, then the person's page inside
 * it, and waits until the card has read the profile (the head names the
 * person) — the moment the roles block is decided.
 */
async function openCardOf(
  page: Page,
  today: string,
  rowId: string,
  clientUid: string,
) {
  await page.goto(`/staff/schedule?day=${today}&view=agenda`);
  const visit = page.locator(`[data-row-id="${rowId}"]`);
  await expect(visit).toBeVisible({ timeout: 30_000 });
  await visit.click();
  const editor = editorOf(page);
  await expect(editor).toHaveAttribute('data-depth', '0');
  await page.getByTestId(`staff-visit-client-row-${clientUid}`).click();
  await expect(editor).toHaveAttribute('data-depth', '1');
  const card = page.getByTestId('client-card');
  await expect(card.getByTestId('client-head-title')).toHaveText(
    'Елена Тодорова',
    { timeout: 20_000 },
  );
  return card;
}

/**
 * The sheet at rest: its scroll position the same on two reads 200 ms
 * apart (axe measures boxes; a row caught mid-scroll under the sticky bar
 * reads as too small — `staff-client-privacy.spec.ts`'s idiom).
 */
async function sheetAtRest(page: Page): Promise<void> {
  const scroller = page
    .locator('[data-testid="staff-visit-sheet"] .modal-sheet__scroll')
    .first();
  let last = '';
  await expect
    .poll(
      async () => {
        const now = String(await scroller.evaluate((el) => el.scrollTop));
        const rested = now === last;
        last = now;
        return rested;
      },
      { intervals: [200], timeout: 10_000 },
    )
    .toBe(true);
}

test.describe('client card — the roles (security hardening S-WS-E)', () => {
  // Once per theme, as `expectNoAxeViolations` asks: contrast differs.
  for (const theme of THEMES) {
    test(`the admin gives a client the barber's role: the stored roles and one audit row — ${theme}`, async ({
      page,
    }) => {
      await pinBrowserClock(page);
      test.setTimeout(120_000);
      const run = attemptKey(test.info());
      const uid = `e2e-roles-${run}`;
      const adminUid = `e2e-roles-admin-${run}`;
      const today = suiteDay();
      await seedClient(uid, today);
      // The admin's stored roles: `setRoles` judges the caller by these.
      await seedUserProfile(adminUid, {
        firstName: 'Админ',
        lastName: 'Салонов',
        roles: [Role.Admin],
      });
      await pinTheme(page, theme);
      await signInAs(page, adminUid, [Role.Admin]);

      const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);

      // «Роли»: five rows, the stored «Клиент» ticked, Save not offered yet.
      const block = card.getByTestId('client-roles');
      await expect(block).toBeVisible({ timeout: 20_000 });
      await expect(block.getByRole('checkbox')).toHaveCount(5);
      const client = block.getByTestId('client-roles-client');
      const barber = block.getByTestId('client-roles-barber');
      await expect(client).toHaveAttribute('aria-checked', 'true');
      await expect(barber).toHaveAttribute('aria-checked', 'false');
      await expect(barber).toHaveText(/Бръснар|Barber/);
      const save = block.getByTestId('client-roles-save');
      await expect(save).toBeDisabled();
      await expect(block.getByTestId('client-roles-status')).toHaveCount(0);

      // Tick «Бръснар», save: the line says when the roles apply.
      await barber.click();
      await expect(barber).toHaveAttribute('aria-checked', 'true');
      await expect(save).toBeEnabled();
      await save.click();
      await expect(block.getByTestId('client-roles-status')).toHaveText(
        /Ролите са запазени\. Важат от следващото влизане\.|Roles saved\. They apply from the next sign-in\./,
        { timeout: 30_000 },
      );
      await expect(save).toBeDisabled();

      // WHAT THE SERVER FILED: the stored set, in dictionary order ...
      const account = await readStoredBody(Collections.Users, uid);
      expect(account?.['roles']).toEqual([Role.Client, Role.Barber]);
      // ... and ONE roles row about the account, in the same commit.
      const actions = await readAuditActionsFor(uid);
      expect(
        actions.filter((action) => action === AuditAction.ProfileRolesChanged),
      ).toHaveLength(1);

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await sheetAtRest(page);
      await expectNoAxeViolations(page, {
        include: '[data-testid="staff-visit-sheet"]',
      });
    });
  }

  test("a barber's card of the same client has no roles block", async ({
    page,
  }) => {
    await pinBrowserClock(page);
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const uid = `e2e-roles-${run}`;
    const today = suiteDay();
    await seedClient(uid, today);
    await signInAs(page, `e2e-roles-barber-${run}`, [Role.Barber]);

    const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);
    await expect(card.getByTestId('client-visits')).toBeVisible({
      timeout: 20_000,
    });
    await expect(card.getByTestId('client-roles')).toHaveCount(0);
    await expect(card.getByTestId('client-roles-save')).toHaveCount(0);
  });
});
