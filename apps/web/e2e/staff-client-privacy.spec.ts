import { expect, test, type Download, type Page } from '@playwright/test';
import { Role } from '@core/components';
// Types only (erased): the bundle's shape, as the server's system builds it.
import type { ClientExportBundle } from '@core/systems';
import { attemptKey } from './support/attempt-key';
import { expectNoAxeViolations } from './support/axe';
import {
  customerIdFor,
  seedUpcomingAppointment,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { EVENING_VISIT_START } from './support/shop-clock';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';
import { THEMES, pinTheme } from './support/theme';

/**
 * THE CLIENT'S DATA, ASKED FOR BY THE SHOP (audit-hardening Phase 3, WS-C —
 * the GDPR export, Art. 15 / 20): the shop's admin opens a client's card
 * from today's visit, and the card's last group, «Лични данни», saves ONE
 * JSON file of every document holding the person's data — the bundle
 * `exportClientData` answers (format version 1), byte for byte. A barber's
 * card has no such group. `client.privacy` is on in the development map
 * (`config/feature-flags.json`) the emulators and the dev build read.
 *
 * The admin's STORED roles are seeded before the journey: `signInAs` puts
 * the roles in the token's claims only, and the export re-reads the
 * caller's `users/{uid}.roles` (P3-RU-13) — without them every call answers
 * `PRIVACY_FORBIDDEN`. A second client is seeded beside the first, with
 * SENTINEL words, so the file is proved to hold the asked person only.
 *
 * Read-only: the export changes no document but its own audit row, so the
 * dev catalogue the workers share is safe. The page's clock is pinned to
 * the suite's day at 10:00 (`pinBrowserClock`), so today's 21:00 visit is
 * one to come whatever the real hour; nothing here authors a note, a photo
 * or a read stamp.
 */

/** The second client's words: never in the first client's file. */
const SENTINEL_FIRST_NAME = 'Sentinel';
const SENTINEL_LAST_NAME = 'Firstname';
const SENTINEL_PHONE = '+359880000777';

/** The visit sheet's editor — its `data-depth` is the page stack's. */
function editorOf(page: Page) {
  return page.getByTestId('staff-visit-editor');
}

/** The asked client — a profile, its record and today's visit — and a second client beside them. */
async function seedClients(
  uid: string,
  otherUid: string,
  today: string,
): Promise<void> {
  await seedUserProfile(uid, {
    firstName: 'Елена',
    lastName: 'Тодорова',
    phone: '+359881112233',
  });
  await seedUpcomingAppointment(
    `${uid}-today`,
    uid,
    `${today}T${EVENING_VISIT_START}`,
  );
  await seedUserProfile(otherUid, {
    firstName: SENTINEL_FIRST_NAME,
    lastName: SENTINEL_LAST_NAME,
    phone: SENTINEL_PHONE,
  });
  await seedWorkedAppointment(
    `${otherUid}-past`,
    otherUid,
    '2026-03-10T10:00:00',
  );
}

/**
 * Opens the day's agenda on `rowId`'s visit, then the person's page inside
 * it, and waits until the card has resolved the client RECORD — the visits
 * module past its skeleton (its rows are keyed by the record) — the moment
 * the privacy group is decided.
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
  );
  await expect(card.getByTestId('client-visits')).toBeVisible({
    timeout: 20_000,
  });
  await expect(card.getByTestId('client-visits-skeleton')).toHaveCount(0, {
    timeout: 20_000,
  });
  return card;
}

/** The saved file's text, read through Playwright's own stream (UTF-8). */
async function textOf(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('client card — the personal data (client.privacy on)', () => {
  // Once per theme, as `expectNoAxeViolations` asks: contrast differs.
  for (const theme of THEMES) {
    test(`the admin downloads the client's data: one file, version 1, the asked person only — ${theme}`, async ({
      page,
    }) => {
      await pinBrowserClock(page);
      test.setTimeout(120_000);
      const run = attemptKey(test.info());
      const uid = `e2e-privacy-${run}`;
      const otherUid = `e2e-privacy-other-${run}`;
      const adminUid = `e2e-privacy-admin-${run}`;
      const today = suiteDay();
      await seedClients(uid, otherUid, today);
      // The admin's stored roles: the export judges the caller by these.
      await seedUserProfile(adminUid, {
        firstName: 'Админ',
        lastName: 'Салонов',
        roles: [Role.Admin],
      });
      await pinTheme(page, theme);
      await signInAs(page, adminUid, [Role.Admin]);

      const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);

      // L · «Лични данни»: the admin's group after the exits, one row.
      const block = card.getByTestId('client-privacy');
      await expect(block).toBeVisible();
      const exportRow = block.getByTestId('client-export');
      await expect(exportRow).toHaveText(/Изтегли данните|Download the data/);
      await expect(block.getByTestId('client-export-status')).toHaveCount(0);

      const saved = page.waitForEvent('download', { timeout: 30_000 });
      await exportRow.click();
      const download = await saved;
      const customerId = customerIdFor(uid);
      expect(download.suggestedFilename()).toBe(
        `creativo-client-${customerId}.json`,
      );
      // The line under the row says the file is saved — a status, announced.
      await expect(block.getByTestId('client-export-status')).toHaveText(
        /Файлът е изтеглен\.|The file is downloaded\./,
      );

      // THE FILE: the bundle as the server built it — the format version,
      // the asked record and its account, today's visit.
      const text = await textOf(download);
      const bundle = JSON.parse(text) as ClientExportBundle;
      expect(bundle.clientExportVersion).toBe(1);
      expect(bundle.exportedCustomerId).toBe(customerId);
      expect(bundle.exportedUserId).toBe(uid);
      expect(bundle.customers.map(({ id }) => id)).toEqual([customerId]);
      expect(bundle.users.map(({ id }) => id)).toEqual([uid]);
      expect(bundle.appointments.map(({ id }) => id)).toContain(`${uid}-today`);
      // ...and nothing of the client beside them: not their ids, not their words.
      expect(text).not.toContain(otherUid);
      expect(text).not.toContain(customerIdFor(otherUid));
      expect(text).not.toContain(SENTINEL_FIRST_NAME);
      expect(text).not.toContain(SENTINEL_LAST_NAME);
      expect(text).not.toContain(SENTINEL_PHONE);

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, {
        include: '[data-testid="staff-visit-sheet"]',
      });
    });
  }

  test("a barber's card of the same client has no personal-data group", async ({
    page,
  }) => {
    await pinBrowserClock(page);
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const uid = `e2e-privacy-${run}`;
    const today = suiteDay();
    await seedClients(uid, `e2e-privacy-other-${run}`, today);
    await signInAs(page, `e2e-privacy-barber-${run}`, [Role.Barber]);

    const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);
    await expect(card.getByTestId('client-privacy')).toHaveCount(0);
    await expect(card.getByTestId('client-export')).toHaveCount(0);
  });
});
