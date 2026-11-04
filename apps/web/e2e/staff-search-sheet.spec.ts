import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import {
  seedUpcomingAppointment,
  seedUserProfile,
  setVisitContact,
} from './support/seed-firestore';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/**
 * THE SPOTLIGHT SEARCH SHEET (docs/designs/staff-search-spotlight.md, part 2),
 * END TO END.
 *
 * CUJ 1 — a name and a number in one line narrow to one visit, the matched
 * runs washed. CUJ 2 — the sheet opens on what it remembers (the device's
 * recents) and what can still narrow it (the offered filters); a picked card
 * is kept as a recent. CUJ 3 — a barber filter becomes a chip in the field,
 * narrows the cards and comes off again. CUJ 4 — a typed e-mail finds the
 * visit and prints the e-mail line.
 *
 * Every visit is this attempt's own (`attemptKey`), with a name, a number and
 * an e-mail only this attempt knows, so a long-lived emulator never answers a
 * neighbour's. The cards are filtered by that key. The dev catalogue (Ivan,
 * Niko, Stefan) is `support/global-setup.ts`'s.
 */

/** A Bulgarian mobile number of this attempt's own: `88` and seven digits. */
function numberOf(run: string): {
  readonly national: string;
  readonly e164: string;
} {
  const digits = createHash('sha256').update(run).digest().readUInt32BE(0);
  const tail = String(digits % 10_000_000).padStart(7, '0');
  return { national: `088${tail}`, e164: `+35988${tail}` };
}

/** Opens the schedule's search sheet. */
async function openSearch(page: Page): Promise<void> {
  await page.goto('/staff/schedule');
  await reopenSearch(page);
}

/** Opens the search sheet from the schedule that is already showing. */
async function reopenSearch(page: Page): Promise<void> {
  await page.getByTestId('staff-search-open').click();
  await expect(page.getByTestId('staff-search-sheet')).toBeVisible({
    timeout: 30_000,
  });
}

/** The cards whose text holds this attempt's key. */
function cardsOf(page: Page, run: string) {
  return page
    .getByTestId('staff-search-list')
    .locator('[data-appointment-id]')
    .filter({ hasText: run });
}

/** Seeds a visit of this attempt's, with the contact a desk would have typed. */
async function seedVisit(
  id: string,
  day: LocalDate,
  contact: {
    readonly name: string;
    readonly phone: string;
    readonly email?: string;
  },
  barberId?: string,
): Promise<void> {
  const uid = `${id}-owner`;
  await seedUserProfile(uid, { firstName: 'Тест', lastName: 'Търсене' });
  await seedUpcomingAppointment(id, uid, `${day}T09:00:00`, barberId);
  await setVisitContact(id, contact);
}

test.describe('the schedule search sheet — part 2', () => {
  test('CUJ 1: a name and a number together narrow to one visit', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const name = `Иван ${run}`;
    const first = numberOf(`first-${run}`);
    const second = numberOf(`second-${run}`);
    const today = shopToday();
    await seedVisit(`e2e-sheet-mix-a-${run}`, LocalDate.addDays(today, 2), {
      name,
      phone: first.e164,
    });
    await seedVisit(`e2e-sheet-mix-b-${run}`, LocalDate.addDays(today, 3), {
      name,
      phone: second.e164,
    });
    await signInAs(page, `e2e-sheet-mix-staff-${run}`, ['barber']);
    await openSearch(page);
    const input = page.getByTestId('staff-search-input');

    // The name alone is two visits.
    await input.fill(run);
    await expect(cardsOf(page, run)).toHaveCount(2, { timeout: 30_000 });

    // The name and the first digits of one number are one — read as both.
    await input.fill(`${run} ${first.national.slice(0, 7)}`);
    await expect(cardsOf(page, run)).toHaveCount(1, { timeout: 30_000 });
    const card = cardsOf(page, run);
    await expect(card.getByTestId('staff-search-line-phone')).toBeVisible();
    await expect(page.getByTestId('staff-search-phone-row')).toBeVisible();

    // The matched runs are painted, not just present.
    const wash = card.locator('mark').first();
    await expect(wash).toBeVisible();
    const background = await wash.evaluate(
      (mark) => getComputedStyle(mark).backgroundColor,
    );
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('CUJ 2: the sheet opens on recents and offers; a picked card is remembered', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    await seedVisit(
      `e2e-sheet-recent-${run}`,
      LocalDate.addDays(shopToday(), 2),
      { name: `Памет ${run}`, phone: numberOf(`recent-${run}`).e164 },
    );
    await signInAs(page, `e2e-sheet-recent-staff-${run}`, ['barber']);
    await openSearch(page);

    // A new device remembers nothing; the sheet opens on the caret with the
    // keys a filter is made of under it.
    await expect(page.getByTestId('staff-search-recents')).toHaveCount(0);
    await expect(page.locator('[data-suggestion="FIELD:WHEN"]')).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId('staff-search-input').fill(run);
    await expect(cardsOf(page, run)).toHaveCount(1, { timeout: 30_000 });
    await cardsOf(page, run).click();
    await expect(page.getByTestId('staff-search-sheet')).toBeHidden();

    // The picked search is kept on this device, one press away.
    await reopenSearch(page);
    const recent = page.getByTestId('staff-search-recent');
    await expect(recent).toHaveCount(1);
    await recent.click();
    await expect(page.getByTestId('staff-search-input')).toHaveValue(run);
    await expect(cardsOf(page, run)).toHaveCount(1, { timeout: 30_000 });

    // Forgetting is one press, and sticks across a reopening.
    await page.getByTestId('staff-search-input').fill('');
    await page.getByTestId('staff-search-clear-recents').click();
    await expect(page.getByTestId('staff-search-recents')).toHaveCount(0);
  });

  test('CUJ 3: a barber becomes a key │ value token, narrows the cards, comes off', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const today = shopToday();
    await seedVisit(
      `e2e-sheet-chip-ivan-${run}`,
      LocalDate.addDays(today, 2),
      { name: `Двама ${run}`, phone: numberOf(`ivan-${run}`).e164 },
      'ivan',
    );
    await seedVisit(
      `e2e-sheet-chip-niko-${run}`,
      LocalDate.addDays(today, 3),
      { name: `Двама ${run}`, phone: numberOf(`niko-${run}`).e164 },
      'niko',
    );
    await signInAs(page, `e2e-sheet-chip-staff-${run}`, ['barber']);
    await openSearch(page);
    const input = page.getByTestId('staff-search-input');

    // The key first, from the list on the empty field; then the text.
    await page.locator('[data-suggestion="FIELD:BARBER"]').click();
    const token = page.getByTestId('staff-search-input-token-BARBER');
    await expect(token).toBeVisible();
    const niko = page.locator('[data-suggestion="BARBER:niko"]');
    await niko.click();
    await expect(token).toContainText('Нико');
    await input.fill(run);
    await expect(cardsOf(page, run)).toHaveCount(1, { timeout: 30_000 });

    // The token opens on its values, the typed search parked meanwhile;
    // removing lives there, not on a ✕, and the search comes back.
    await token.click();
    await expect(input).toHaveValue('');
    await expect(niko).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-suggestion="REMOVE:BARBER"]').click();
    await expect(token).toHaveCount(0);
    await expect(input).toHaveValue(run);
    await expect(cardsOf(page, run)).toHaveCount(2);

    await input.fill('');

    // Backspace on an empty field takes the last token off too.
    await page.locator('[data-suggestion="FIELD:BARBER"]').click();
    await niko.click();
    await expect(token).toContainText('Нико');
    await input.fill('');
    await input.press('Backspace');
    await expect(token).toHaveCount(0);
  });

  test('CUJ 4: a typed e-mail finds the visit and prints the e-mail line', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const email = `${run}@example.com`;
    await seedVisit(
      `e2e-sheet-mail-${run}`,
      LocalDate.addDays(shopToday(), 2),
      {
        name: 'Пощенски',
        phone: numberOf(`mail-${run}`).e164,
        email,
      },
    );
    await signInAs(page, `e2e-sheet-mail-staff-${run}`, ['barber']);
    await openSearch(page);

    await page.getByTestId('staff-search-input').fill(`${run}@exam`);

    await expect(cardsOf(page, run)).toHaveCount(1, { timeout: 30_000 });
    const line = cardsOf(page, run).getByTestId('staff-search-line-email');
    await expect(line).toHaveText(email);
    await expect(line.locator('mark').first()).toBeVisible();
  });
});
