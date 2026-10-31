import { expect, test, type Download, type Page } from '@playwright/test';
import { ErasureStatus, Role } from '@core/components';
import { Collections } from '@core/entities';
// Types only (erased): the bundle's shape, as the server's system builds it.
import type { ClientExportBundle } from '@core/systems';
import { attemptKey } from './support/attempt-key';
import {
  readStoredBody,
  seedUpcomingAppointment,
  seedUserProfile,
  seedWalkInRecord,
} from './support/seed-firestore';
import { EVENING_VISIT_START } from './support/shop-clock';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';

/**
 * A WALK-IN'S PERSONAL DATA, REACHED BY THE SHOP (security hardening
 * S-WS-F, S-DEP-8): a person the desk entered with no account has a client
 * RECORD and nothing else — before S-WS-F no card opened on it, so the
 * export and the erasure could not be reached for them (Phase 3 flag 11).
 * Now the shop's admin opens a visit, finds the walk-in by their number in
 * the add-client search, and their row's card opens keyed by the RECORD
 * (S-RU-15: the id rides beside the `guest-…` key, never parsed from it):
 * the head and «Лични данни» (S-L-19). «Изтегли данните» saves ONE file
 * naming the record; «Изтрий личните данни» asks once, «Изтрий» erases, and
 * the Admin SDK reads the record `ERASED` — no account and no Auth user in
 * play.
 *
 * Every attempt seeds its OWN walk-in (`seedWalkInRecord` — a run-unique
 * record id and phone): the erasure is irreversible. The visit is today's,
 * at 21:00, under a pinned page clock (`pinBrowserClock`), so it is one to
 * come whatever the real hour; the walk-in is only PICKED onto it, never
 * saved — the visit is unchanged. The admin's STORED roles are seeded: the
 * privacy callables judge the caller by `users/{uid}.roles` (P3-RU-13).
 * `client.privacy` is on in the development map the emulators read.
 */

/** The visit sheet's editor — its `data-depth` is the page stack's. */
function editorOf(page: Page) {
  return page.getByTestId('staff-visit-editor');
}

/** The saved file's text, read through Playwright's own stream (UTF-8). */
async function textOf(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('client card — a walk-in’s record (client.privacy on, S-WS-F)', () => {
  test('the admin finds a walk-in by their number, opens their card by the record, exports it and erases it', async ({
    page,
  }) => {
    await pinBrowserClock(page);
    test.setTimeout(180_000);
    const run = attemptKey(test.info());
    const ownerUid = `e2e-walkin-privacy-owner-${run}`;
    const adminUid = `e2e-walkin-privacy-admin-${run}`;
    const today = suiteDay();
    const visitId = `${ownerUid}-today`;

    await seedUserProfile(ownerUid, { firstName: 'Мартин', lastName: 'Илиев' });
    await seedUpcomingAppointment(
      visitId,
      ownerUid,
      `${today}T${EVENING_VISIT_START}`,
    );
    const walkIn = await seedWalkInRecord(`e2e-walkin-privacy-${run}`, {
      firstName: 'Иво',
      lastName: 'Стоянов',
    });
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Салонов',
      roles: [Role.Admin],
    });
    await signInAs(page, adminUid, [Role.Admin]);

    // ── The visit, then the add-client search: the number finds the record ──
    await page.goto(`/staff/schedule?day=${today}&view=agenda`);
    const visit = page.locator(`[data-row-id="${visitId}#ivan"]`);
    await expect(visit).toBeVisible({ timeout: 30_000 });
    await visit.click();
    const editor = editorOf(page);
    await expect(editor).toHaveAttribute('data-depth', '0');
    await page.getByTestId('staff-visit-add-client').click();
    await page.getByTestId('staff-visit-client-query').fill(walkIn.dialled);
    const found = page.locator(
      `[data-testid="staff-visit-client-results"] [data-testid="staff-visit-client-guest-${walkIn.customerId}"]`,
    );
    await expect(found).toHaveCount(1, { timeout: 20_000 });
    await expect(found).toContainText('Иво Стоянов');
    await expect(
      found.locator('[data-testid^="staff-visit-client-no-account-"]'),
    ).toHaveText(/Без профил|No account/);

    // Picked onto the visit (never saved), then their row's card.
    await found.click();
    await expect(
      page.getByTestId(`staff-visit-picked-guest-${walkIn.customerId}`),
    ).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('staff-visit-back').click();
    await expect(editor).toHaveAttribute('data-depth', '0');
    await page
      .getByTestId(`staff-visit-client-row-guest-${walkIn.customerId}`)
      .click();
    await expect(editor).toHaveAttribute('data-depth', '1');
    const card = page.getByTestId('client-card');
    await expect(card.getByTestId('client-head-title')).toHaveText(
      'Иво Стоянов',
      { timeout: 20_000 },
    );

    // ── «Лични данни», keyed by the record ──
    const block = card.getByTestId('client-privacy');
    await expect(block).toBeVisible({ timeout: 20_000 });
    const exportRow = block.getByTestId('client-export');
    await expect(exportRow).toHaveText(/Изтегли данните|Download the data/);
    // The roles block is an account's only (S-WS-E): a record has none.
    await expect(card.getByTestId('client-roles')).toHaveCount(0);

    const saved = page.waitForEvent('download', { timeout: 30_000 });
    await exportRow.click();
    const download = await saved;
    expect(download.suggestedFilename()).toBe(
      `creativo-client-${walkIn.customerId}.json`,
    );
    const bundle = JSON.parse(await textOf(download)) as ClientExportBundle;
    expect(bundle.clientExportVersion).toBe(1);
    expect(bundle.exportedCustomerId).toBe(walkIn.customerId);
    expect(bundle.customers.map(({ id }) => id)).toEqual([walkIn.customerId]);
    expect(bundle.users).toEqual([]);

    // ── The erasure: one alert, «Изтрий», the erased line ──
    const eraseRow = block.getByTestId('client-erase');
    await expect(eraseRow).toHaveText(
      /Изтрий личните данни|Erase personal data/,
      {
        timeout: 20_000,
      },
    );
    await eraseRow.click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toHaveCount(1, { timeout: 30_000 });
    await page.getByTestId('client-privacy-erase-confirm').click();
    await expect(alert).toHaveCount(0);
    await expect(block.getByTestId('client-erased')).toHaveText(
      /Изтрит клиент|Erased client/,
      { timeout: 60_000 },
    );

    // WHAT THE SERVER FILED: the record kept, ERASED and pseudonymized, still
    // with no account — and the visit's own client untouched.
    const record = await readStoredBody(
      Collections.Customers,
      walkIn.customerId,
    );
    expect(record?.['erasureStatus']).toBe(ErasureStatus.Erased);
    expect(record?.['userId']).toBeNull();
    expect(record?.['phone']).toBeNull();
    expect(record?.['displayName']).not.toContain('Иво');
    const owner = await readStoredBody(Collections.Users, ownerUid);
    expect(owner?.['firstName']).toBe('Мартин');
    expect(
      (await readStoredBody(Collections.Appointments, visitId))?.[
        'subjectCustomerIds'
      ],
    ).not.toContain(walkIn.customerId);
  });
});
