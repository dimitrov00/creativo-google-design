import { type Page, expect, test } from '@playwright/test';
import { AuditAction, BarberStatus, Role } from '@core/components';
import { Collections } from '@core/entities';
import { BarberId, LocalDate } from '@core/primitives';
import { DEV_CHAIR } from './support/appointment-seed-document';
import { attemptKey } from './support/attempt-key';
import {
  lockBarberLink,
  readAuditActionsFor,
  readBarberBusyDay,
  readBarberLink,
  readStoredBody,
  removeAddedBarber,
  removeAppointment,
  removeUserProfile,
  seedUpcomingAppointment,
  seedUserProfile,
  seedWorkingBarber,
  storedObjectExists,
} from './support/seed-firestore';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/** A 1×1 PNG: the smallest picture a browser can measure. */
const PORTRAIT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/*
 * A team member's page and the add sheet (team onboarding stage 1a; staff
 * permissions P9) against the emulators.
 *
 * The owner's ＋ is a menu (a barber, or a role for a registered account):
 * every case here picks «Бръснар».
 *
 * The owner's case ADDS its own barber record and works on that one alone
 * — its link, its profile, its deletion — so it never moves a seeded barber
 * another spec reads, and two attempts never contend for one record.
 *
 * The cases run ONE AFTER ANOTHER, in this file's order: every one of them
 * adds a barber, and `addBarber` counts every barber record inside its
 * transaction (the new one sorts last). Started at the same instant, the
 * emulator makes each wait for the others — a call that takes a second
 * took ten, and a page waiting on it stalled. Nobody adds six barbers at
 * once in a shop; the suite should not either. A failed case does not stop
 * the ones after it.
 */
test.describe('a team member’s page', () => {
  test.describe.configure({ mode: 'default' });

  /** The record the running case added; removed if the case stopped before deleting it. */
  let added: string | null = null;
  /** The account the running case linked to its record; removed if the case stopped while it was staff. */
  let linkedUid: string | null = null;
  /** The visit the running case booked for its record; removed with it. */
  let bookedVisit: string | null = null;

  test.afterEach(async () => {
    if (bookedVisit !== null) await removeAppointment(bookedVisit);
    if (added !== null) await removeAddedBarber(added);
    if (linkedUid !== null) await removeUserProfile(linkedUid);
    added = null;
    linkedUid = null;
    bookedVisit = null;
  });

  /** The member page's id, from its address. */
  const memberIdOf = (page: Page): string =>
    decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');

  test('an owner adds a barber with a colleague’s prices, fills the profile, takes the record as their own, gives it back and deletes it', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-owner-${key}`;
    const name = `Нов Колега ${key}`.slice(0, 40);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Стол',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // THE ADD SHEET: a name, today, and Ivan's prices.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await expect(page.getByTestId('team-add-save')).toBeDisabled();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-copy').click();
    await page
      .locator('[role^="menuitem"]', { hasText: 'Иван Колев' })
      .first()
      .click();
    await expect(page.getByTestId('team-add-copy')).toContainText('Иван Колев');
    await page.getByTestId('team-add-save').click();

    // THE NEW RECORD'S PAGE: in preparation, the prices there, the hours not.
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-name')).toHaveText(name, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-standing')).toContainText('4 от 5', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-setup-SERVICES')).toHaveAttribute(
      'data-done',
      '',
    );
    await expect(page.getByTestId('member-setup-HOURS')).toContainText('Няма');
    const stored = await readStoredBody(Collections.Barbers, added);
    expect(stored?.['barberStatus']).toBe(BarberStatus.Draft);
    expect(stored?.['barberJoinsAnyPool']).toBe(true);

    // THE PROFILE: a title, saved from the sheet, shows on its row.
    await page.getByTestId('member-row-profile').click();
    await expect(page.getByTestId('member-profile-name')).toHaveValue(name);
    await page.getByTestId('member-profile-position').fill('Младши бръснар');
    await page.getByTestId('member-profile-save').click();
    await expect(page.getByTestId('member-row-profile')).toContainText(
      'Младши бръснар',
      { timeout: 30_000 },
    );
    await expect
      .poll(
        async () =>
          (await readStoredBody(Collections.Barbers, added ?? ''))?.['title'],
        { timeout: 20_000 },
      )
      .toEqual({ bg: 'Младши бръснар', en: 'Младши бръснар' });

    // THE PERIOD: a last day that is not set yet opens on a month with
    // days in it; «Без последен ден» is an answer of the same month, not a
    // row of its own; choosing it keeps the keyboard inside the sheet, so
    // Escape still closes it — and nothing was saved.
    await page.getByTestId('member-row-period').click();
    await page.getByTestId('member-period-last').click();
    await page
      .getByTestId('member-period-last-calendar')
      .locator('[data-testid^="ui-month-day-"]')
      .last()
      .click();
    await expect(page.getByTestId('member-period-save')).toBeEnabled();
    await expect(page.getByTestId('member-period-last-clear')).toHaveCount(0);
    await page.getByTestId('member-period-last').click();
    await page.getByTestId('member-period-last-clear').click();
    await expect(page.getByTestId('member-period-last-value')).toHaveText(
      'Няма',
    );
    await expect(page.getByTestId('member-period-save')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('member-period-sheet')).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(
      (await readStoredBody(Collections.Barbers, added))?.[
        'barberLastWorkingLocalDate'
      ],
    ).toBeNull();

    // THE POOL: one switch, one part of the record.
    await page.getByTestId('member-pool').click();
    await expect
      .poll(
        async () =>
          (await readStoredBody(Collections.Barbers, added ?? ''))?.[
            'barberJoinsAnyPool'
          ],
        { timeout: 20_000 },
      )
      .toBe(false);

    // «ТОВА СЪМ АЗ»: the owner's own account takes the record — and nobody
    // is signed out.
    await page.getByTestId('member-is-me').click();
    await expect(page.getByTestId('member-not-me')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-account-linked')).toContainText(
      'Собственик Стол',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-account-linked')).toContainText(
      'Твоят профил',
    );
    expect(await readBarberLink(added)).toBe(uid);
    const account = await readStoredBody(Collections.Users, uid);
    expect(account?.['linkedBarberId']).toBe(added);
    expect(account?.['roles']).toEqual(
      expect.arrayContaining(['admin', 'barber']),
    );
    // The level the account now holds leads to «Права».
    await expect(page.getByTestId('member-level-barber')).toHaveAttribute(
      'href',
      '/admin/team/permissions/barber',
    );

    // «НЕ СЪМ АЗ»: the exact way back.
    await page.getByTestId('member-not-me').click();
    await expect(page.getByTestId('member-is-me')).toBeVisible({
      timeout: 30_000,
    });
    expect(await readBarberLink(added)).toBeNull();
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      'admin',
    ]);

    // «ИЗТРИЙ»: asks first, then the record is gone from the list.
    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    await expect(page.getByTestId(`team-member-${added}`)).toHaveCount(0, {
      timeout: 30_000,
    });
    expect(await readStoredBody(Collections.Barbers, added)).toBeNull();
    added = null;
  });

  test('an owner sets a new barber’s weekly hours from their page: the roster is stored and the page marks the hours done', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-hours-${key}`;
    const name = `Нов График ${key}`.slice(0, 40);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'График',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // A new record with NO prices copied: it stays in preparation whatever
    // its hours, so no other spec ever meets a fourth chair at work.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-standing')).toContainText('3 от 5', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-setup-HOURS')).toContainText('Няма');

    // THE HOURS: the schedule's own sheet, raised on this record alone.
    await page.getByTestId('member-setup-HOURS').click();
    await expect(page.getByTestId('staff-hours-sheet')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('staff-hours-chair')).toHaveCount(0);
    await page.getByTestId('staff-hours-day-1').click();
    await page.getByTestId('staff-hours-working').click();
    await page.getByTestId('staff-hours-done').click();
    await page.getByTestId('staff-hours-save').click();

    // Saved: the sheet leaves, the page says so, and the checklist — read
    // off the live roster — marks the hours done.
    await expect(page.getByTestId('staff-hours-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-hours-toast')).toContainText(
      'Работното време е запазено',
    );
    await expect(page.getByTestId('member-setup-HOURS')).toHaveAttribute(
      'data-done',
      '',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-setup-HOURS')).toContainText(
      'Зададено',
    );
    await expect(page.getByTestId('member-standing')).toContainText('4 от 5');
    const roster = await readStoredBody(Collections.BarberSchedules, added);
    const versions = (roster?.['versions'] ?? []) as readonly {
      segments: readonly { weekday: number }[];
    }[];
    expect(versions.at(-1)?.segments.map((segment) => segment.weekday)).toEqual(
      [1],
    );
    // Still in preparation: it has no services yet.
    expect(
      (await readStoredBody(Collections.Barbers, added))?.['barberStatus'],
    ).toBe(BarberStatus.Draft);

    // «Изтрий» takes the roster with the record.
    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    expect(await readStoredBody(Collections.Barbers, added)).toBeNull();
    expect(await readStoredBody(Collections.BarberSchedules, added)).toBeNull();
    added = null;
  });

  test('an owner sets what a new barber performs: a service switched on and repriced is stored on that service, and the page counts it', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-prices-${key}`;
    const name = `Нов Ценоразпис ${key}`.slice(0, 40);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Цени',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // A new record with nothing copied: in preparation throughout.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-setup-SERVICES')).toContainText(
      'Няма',
      { timeout: 30_000 },
    );

    // «УСЛУГИ И ЦЕНИ»: the catalogue's services, none performed yet.
    await page.getByTestId('member-setup-SERVICES').click();
    const service = page.getByTestId(`offering-${DEV_CHAIR.serviceId}`);
    await expect(service).toContainText('Не извършва', { timeout: 30_000 });
    await expect(page.getByTestId('member-offerings-save')).toBeDisabled();

    // The service's own page: on at the catalogue's terms, then repriced.
    await service.click();
    await page.getByTestId('member-offering-performs').click();
    const price = page.getByTestId('member-offering-price-base');
    await expect(price).toBeVisible();
    await price.fill('12,50');
    await price.press('Tab');
    await expect(price).toHaveValue('12,50');
    await page.getByTestId('member-offerings-done').click();
    await expect(service).toContainText('12,50');
    await page.getByTestId('member-offerings-save').click();

    // Saved: the sheet leaves and the checklist counts the service.
    await expect(page.getByTestId('member-offerings-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-setup-SERVICES')).toContainText(
      '1 услуга',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-standing')).toContainText('4 от 5');
    const offeringOf = async (): Promise<Record<string, unknown> | null> => {
      const stored = await readStoredBody(
        Collections.Services,
        DEV_CHAIR.serviceId,
      );
      const offerings = (stored?.['offerings'] ?? []) as readonly Record<
        string,
        unknown
      >[];
      return (
        offerings.find((offering) => offering['barberId'] === added) ?? null
      );
    };
    expect(await offeringOf()).toMatchObject({
      barberId: added,
      priceCents: 1250,
      currency: DEV_CHAIR.currency,
      overrides: [],
    });

    // «Изтрий» takes the offering with the record.
    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    await expect.poll(offeringOf, { timeout: 20_000 }).toBeNull();
    added = null;
  });

  test('an owner moves a new barber to one shop, links a registered account to the record from a lookup, and releases it', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-link-${key}`;
    const clientUid = `e2e-member-linked-${key}`;
    const name = `Нов Салон ${key}`.slice(0, 40);
    // A family name nobody else holds: the lookup finds this account alone.
    const family = `Свързан${key}`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Връзка',
      roles: [Role.Admin],
    });
    await seedUserProfile(clientUid, {
      firstName: 'Георги',
      lastName: family,
      phone: '+359881112255',
    });
    await signInAs(page, uid, ['admin']);

    // A new record with nothing copied: in preparation throughout.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);

    // «САЛОНИ»: a new record works everywhere. «Всички салони» off, one
    // tick taken away, and the record is the centre shop's alone.
    const shops = page.getByTestId('member-setup-SHOPS');
    await expect(shops).toContainText('Всички', { timeout: 30_000 });
    await shops.click();
    await expect(page.getByTestId('member-shops-save')).toBeDisabled();
    await page.getByTestId('member-shops-every').click();
    const mladost = page.getByTestId('member-shop-loc-mladost');
    await expect(mladost).toHaveAttribute('aria-checked', 'true');
    await mladost.click();
    await expect(mladost).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('member-shops-save').click();
    await expect(page.getByTestId('member-shops-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(shops).toContainText('Център', { timeout: 30_000 });
    await expect(shops).not.toContainText('Всички');
    expect(
      (await readStoredBody(Collections.Barbers, added))?.['locationIds'],
    ).toEqual([DEV_CHAIR.locationId]);

    // «СВЪРЖИ ПРОФИЛ»: the lookup finds the registered client by family
    // name; the row asks first, and says the person signs in again.
    await page.getByTestId('member-link').click();
    await page.getByTestId('member-link-query').fill(family);
    const found = page.getByTestId(`member-link-${clientUid}`);
    await expect(found).toContainText(`Георги ${family}`, { timeout: 30_000 });
    await found.click();
    await expect(page.getByTestId('member-link-question')).toContainText(
      'ще трябва да влезе отново',
    );
    linkedUid = clientUid;
    await page.getByTestId('member-link-confirm').click();

    // Linked: the sheet leaves, the account stands beside the record, and
    // the stored account is a barber with the link, its lock taken.
    await expect(page.getByTestId('member-link-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-account-linked')).toContainText(
      `Георги ${family}`,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-link')).toHaveCount(0);
    const account = await readStoredBody(Collections.Users, clientUid);
    expect(account?.['roles']).toEqual([Role.Client, Role.Barber]);
    expect(account?.['linkedBarberId']).toBe(added);
    expect(await readBarberLink(added)).toBe(clientUid);
    // The owner's own account did not move.
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      Role.Admin,
    ]);

    // «РАЗКАЧИ ПРОФИЛА»: asked first; the account is a client again, the
    // link and its lock gone, and the record offers a link once more.
    await page.getByTestId('member-release').click();
    await expect(page.getByTestId('member-release-question')).toContainText(
      `Георги ${family}`,
    );
    await page.getByTestId('member-release-confirm').click();
    await expect(page.getByTestId('member-link')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-account-linked')).toHaveCount(0);
    const released = await readStoredBody(Collections.Users, clientUid);
    expect(released?.['roles']).toEqual([Role.Client]);
    expect(released?.['linkedBarberId']).toBeNull();
    expect(await readBarberLink(added)).toBeNull();
    linkedUid = null;

    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    expect(await readStoredBody(Collections.Barbers, added)).toBeNull();
    added = null;
  });

  test('an owner sets a new barber’s photo: the record holds it, the picture is in the shop’s media, and the linked account’s avatar is the same picture', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-photo-${key}`;
    const linkedAccount = `e2e-member-photo-linked-${key}`;
    const name = `Нов Портрет ${key}`.slice(0, 40);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Снимка',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // A new record with nothing copied: in preparation throughout.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-photo-pick')).toHaveText(
      'Добави снимка',
      { timeout: 30_000 },
    );
    // An account linked to the record before it has a photo: its avatar
    // is the server's to write.
    await seedUserProfile(linkedAccount, {
      firstName: 'Георги',
      lastName: 'Портрет',
      roles: [Role.Client, Role.Barber],
      linkedBarberId: added,
    });
    linkedUid = linkedAccount;
    await lockBarberLink(added, linkedAccount);
    expect(await storedObjectExists(`avatars/${linkedAccount}/original`)).toBe(
      false,
    );

    // THE PHOTO: picked in the browser, which sizes it, stages it under the
    // owner's account and names it to the call.
    await page.getByTestId('member-photo-input').setInputFiles({
      name: 'portrait.png',
      mimeType: 'image/png',
      buffer: PORTRAIT_PNG,
    });

    // Landed: the live record offers to change it, and holds a picture of
    // its own under the shop's media, named after no one.
    await expect(page.getByTestId('member-photo-pick')).toHaveText(
      'Смени снимката',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-refusal')).toHaveCount(0);
    const stored = await readStoredBody(Collections.Barbers, added);
    const path = String(stored?.['avatarMediaPath']);
    expect(path.startsWith(`media/barbers/${added}/`)).toBe(true);
    expect(stored?.['avatarMediaWidth']).toBe(1);
    expect(stored?.['avatarMediaHeight']).toBe(1);
    expect(stored?.['barberStatus']).toBe(BarberStatus.Draft);
    expect(await storedObjectExists(path)).toBe(true);
    // The linked account's avatar is the same picture now: one photo.
    expect(await storedObjectExists(`avatars/${linkedAccount}/original`)).toBe(
      true,
    );
    // The page draws it from the shop's media.
    await expect(
      page.getByTestId('admin-team-member').locator('.ui-avatar img').first(),
    ).toHaveAttribute('src', /media%2Fbarbers/, { timeout: 30_000 });

    await page.getByTestId('member-delete').click();
    await page.getByTestId('member-delete-confirm').click();
    await expect(page).toHaveURL(/\/admin\/team$/, { timeout: 30_000 });
    added = null;
  });

  test('a client with a photo of their own is linked to a new record: the record takes it, and from then on their account page changes the shop’s one photo', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-adopt-${key}`;
    const clientUid = `e2e-member-adopted-${key}`;
    const name = `Нов Профил ${key}`.slice(0, 40);
    // A family name nobody else holds: the lookup finds this account alone.
    const family = `Осиновен${key}`;
    const avatar = `avatars/${clientUid}/original`;
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Профил',
      roles: [Role.Admin],
    });
    await seedUserProfile(clientUid, {
      firstName: 'Елена',
      lastName: family,
      phone: '+359881112266',
    });

    // THE CLIENT'S OWN PHOTO, picked on their account page while they are
    // nobody's barber: theirs to add, with a menu to change or remove it.
    await signInAs(page, clientUid, ['client']);
    await page.goto('/account/profile', { waitUntil: 'commit' });
    await expect(page.getByTestId('profile-photo-pick')).toHaveText(
      'Добави снимка',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('profile-photo-barber-note')).toHaveCount(0);
    await page.getByTestId('profile-photo-input').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PORTRAIT_PNG,
    });
    await expect(page.getByTestId('profile-photo-replace')).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('profile-photo-error')).toHaveCount(0);
    expect(await storedObjectExists(avatar)).toBe(true);

    // THE OWNER adds a record with no photo and links the client to it.
    await signInAs(page, uid, ['admin']);
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-photo-pick')).toHaveText(
      'Добави снимка',
      { timeout: 30_000 },
    );
    await page.getByTestId('member-link').click();
    await page.getByTestId('member-link-query').fill(family);
    const found = page.getByTestId(`member-link-${clientUid}`);
    await expect(found).toContainText(`Елена ${family}`, { timeout: 30_000 });
    await found.click();
    linkedUid = clientUid;
    await page.getByTestId('member-link-confirm').click();
    await expect(page.getByTestId('member-account-linked')).toContainText(
      `Елена ${family}`,
      { timeout: 30_000 },
    );

    // The record took the account's photo: a copy of its own under the
    // shop's media, the size the browser measured, and the page draws it.
    await expect(page.getByTestId('member-photo-pick')).toHaveText(
      'Смени снимката',
      { timeout: 30_000 },
    );
    const taken = await readStoredBody(Collections.Barbers, added);
    const takenPath = String(taken?.['avatarMediaPath']);
    expect(takenPath.startsWith(`media/barbers/${added}/`)).toBe(true);
    expect(taken?.['avatarMediaWidth']).toBe(1);
    expect(taken?.['avatarMediaHeight']).toBe(1);
    expect(taken?.['barberStatus']).toBe(BarberStatus.Draft);
    expect(await storedObjectExists(takenPath)).toBe(true);
    expect(await storedObjectExists(avatar)).toBe(true);

    // THE BARBER'S OWN ACCOUNT PAGE: the photo is the shop's — one picker,
    // nothing to remove, and a line saying who sees it.
    await signInAs(page, clientUid, ['client', 'barber']);
    await page.goto('/account/profile', { waitUntil: 'commit' });
    await expect(page.getByTestId('profile-photo-barber-note')).toContainText(
      'снимката ти в салона',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('profile-photo-pick')).toHaveText(
      'Промени снимката',
    );
    await expect(page.getByTestId('profile-photo-replace')).toHaveCount(0);
    await expect(page.getByTestId('profile-photo-remove')).toHaveCount(0);

    // A pick there sets the RECORD'S photo: a new object under the shop's
    // media, the one it replaced deleted, the account's avatar still there.
    await page.getByTestId('profile-photo-input').setInputFiles({
      name: 'new.png',
      mimeType: 'image/png',
      buffer: PORTRAIT_PNG,
    });
    await expect
      .poll(
        async () =>
          String(
            (await readStoredBody(Collections.Barbers, added ?? ''))?.[
              'avatarMediaPath'
            ],
          ),
        { timeout: 30_000 },
      )
      .not.toBe(takenPath);
    await expect(page.getByTestId('profile-photo-error')).toHaveCount(0);
    const changed = await readStoredBody(Collections.Barbers, added);
    const changedPath = String(changed?.['avatarMediaPath']);
    expect(changedPath.startsWith(`media/barbers/${added}/`)).toBe(true);
    expect(await storedObjectExists(changedPath)).toBe(true);
    await expect
      .poll(() => storedObjectExists(takenPath), { timeout: 30_000 })
      .toBe(false);
    expect(await storedObjectExists(avatar)).toBe(true);
    // The record and the account's link are the `afterEach`'s to remove.
  });

  test('a barber leaves and comes back: a last working day already passed is asked about and closes at once, the booking left behind is said, the leaver is turned away, and «Върни в екипа» brings the same record back', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const key = attemptKey(test.info());
    const uid = `e2e-member-leave-${key}`;
    const leaverUid = `e2e-member-leaver-${key}`;
    const name = `Нов Напуска ${key}`.slice(0, 40);
    // Yesterday on the shop's clock: the last day the barber worked.
    const yesterday = LocalDate.addDays(shopToday(), -1);
    await seedUserProfile(uid, {
      firstName: 'Собственик',
      lastName: 'Напускане',
      roles: [Role.Admin],
    });
    await signInAs(page, uid, ['admin']);

    // A new record, made a working one whose period began yesterday (only
    // a record that works has a period to end, and a last day can never be
    // before the start), with an account linked to it.
    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    await page.getByTestId('admin-team-add').click();
    await page.getByTestId('admin-team-add-barber').click();
    await page.getByTestId('team-add-name').fill(name);
    await page.getByTestId('team-add-save').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/[^/]+$/, {
      timeout: 30_000,
    });
    added = memberIdOf(page);
    await expect(page.getByTestId('member-name')).toHaveText(name, {
      timeout: 30_000,
    });
    await seedUserProfile(leaverUid, {
      firstName: 'Георги',
      lastName: 'Напуска',
      roles: [Role.Client, Role.Barber],
      linkedBarberId: added,
    });
    linkedUid = leaverUid;
    await lockBarberLink(added, leaverUid);
    await seedWorkingBarber(added, yesterday);
    await expect(page.getByTestId('member-standing')).toContainText(
      'Само за екипа',
      { timeout: 30_000 },
    );
    // Someone is booked with them the day after tomorrow (the owner's own
    // account: a booking needs a profile to open its client record from):
    // leaving cancels nothing. The busy projection follows the booking by
    // its trigger.
    const bookedDay = LocalDate.addDays(shopToday(), 2);
    const bookedBarber = BarberId.of(added);
    bookedVisit = `e2e-member-left-${key}`;
    await seedUpcomingAppointment(
      bookedVisit,
      uid,
      `${bookedDay}T10:00:00`,
      added,
    );
    await expect
      .poll(() => readBarberBusyDay(bookedBarber, bookedDay), {
        timeout: 60_000,
      })
      .not.toBeNull();

    // «РАБОТЕН ПЕРИОД»: yesterday as the last day. The sheet says the
    // person leaves on saving, and «Запази» asks first.
    await page.getByTestId('member-row-period').click();
    await expect(page.getByTestId('member-period-sheet')).toBeVisible({
      timeout: 30_000,
    });
    // The last day's capsule pops its month, on today's month, with the
    // booked day dotted and the dots explained; yesterday may be a month
    // back.
    await page.getByTestId('member-period-last').click();
    const lastMonth = page.getByTestId('member-period-last-calendar');
    if (bookedDay.slice(0, 7) === shopToday().slice(0, 7)) {
      await expect(
        lastMonth.getByTestId(`ui-month-day-${bookedDay}`),
      ).toHaveAttribute('data-marked', '', { timeout: 30_000 });
      await expect(page.getByTestId('member-period-last-legend')).toHaveText(
        'Дни със записи',
      );
    }
    if (yesterday.slice(0, 7) !== shopToday().slice(0, 7)) {
      await lastMonth.getByTestId('ui-month-prev').click();
    }
    await lastMonth.getByTestId(`ui-month-day-${yesterday}`).click();
    // ONE notice says what the day does: with a booking after it, a
    // warning that counts it and says the person leaves on saving — and
    // the visit itself listed under it.
    const leftover = page.getByTestId('member-period-leftover');
    await expect(leftover).toContainText('1 запис след последния ден', {
      timeout: 30_000,
    });
    await expect(leftover).toContainText('напуска екипа веднага');
    await expect(leftover).toContainText(
      'Дай го на друг бръснар, премести го или го откажи.',
    );
    await expect(page.getByTestId('member-period-note')).toHaveCount(0);
    await expect(
      page
        .getByTestId('member-period-sheet')
        .locator(`[data-appointment-id="${bookedVisit}"]`),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('member-period-save').click();
    await expect(
      page.getByTestId('member-period-leave-question'),
    ).toContainText('напуска екипа сега?');
    // Nothing is written while the question is up.
    expect(
      (await readStoredBody(Collections.Barbers, added))?.['barberStatus'],
    ).toBe(BarberStatus.StaffOnly);
    await page.getByTestId('member-period-leave-confirm').click();

    // LEFT: the sheet leaves, the page reads the record as gone, and the
    // stored record says whose access it took and that their sessions ended.
    await expect(page.getByTestId('member-period-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-standing')).toContainText('Напусна', {
      timeout: 30_000,
    });
    const record = await readStoredBody(Collections.Barbers, added);
    expect(record?.['barberStatus']).toBe(BarberStatus.Departed);
    expect(record?.['barberLastWorkingLocalDate']).toBe(yesterday);
    expect(record?.['barberDepartedUserId']).toBe(leaverUid);
    expect(record?.['barberSessionsRevokedAtUtcMs']).not.toBeNull();
    // The account is a client again, linked to nothing; the lock is gone.
    const account = await readStoredBody(Collections.Users, leaverUid);
    expect(account?.['roles']).toEqual([Role.Client]);
    expect(account?.['linkedBarberId']).toBeNull();
    expect(await readBarberLink(added)).toBeNull();
    expect(await readAuditActionsFor(leaverUid)).toContain(
      AuditAction.ProfileRolesChanged,
    );
    // The owner's own account did not move.
    expect((await readStoredBody(Collections.Users, uid))?.['roles']).toEqual([
      Role.Admin,
    ]);

    // THE LEAVER, on a token that still says «barber»: a staff page the
    // stored account decides is refused.
    await signInAs(page, leaverUid, ['client', 'barber']);
    await page.goto('/staff/analytics', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 30_000 });

    // «ВЪРНИ В ЕКИПА»: the owner brings the same record back. The sheet
    // opens on the earliest day a return may start — today, the day after
    // the last day worked — and says the account does not come back.
    await signInAs(page, uid, ['admin']);
    await page.goto(`/admin/team/member/${added}`, { waitUntil: 'commit' });
    await expect(page.getByTestId('member-standing')).toContainText('Напусна', {
      timeout: 30_000,
    });
    // The leaver's page still says the booking they hold, and lists it.
    // The row opens its day on the schedule, where the leaver keeps a
    // column while they are booked: the visit is there to move or cancel.
    await expect(page.getByTestId('member-leftover')).toContainText(
      'още има 1 запис',
      { timeout: 30_000 },
    );
    await page.locator(`[data-appointment-id="${bookedVisit}"]`).click();
    await expect
      .poll(
        () => {
          const url = new URL(page.url());
          return `${url.pathname} ${url.searchParams.get('day')}`;
        },
        { timeout: 30_000 },
      )
      .toBe(`/staff/schedule ${bookedDay}`);
    await expect(
      page.locator(`[data-row-id^="${bookedVisit}"]`).first(),
    ).toBeVisible({ timeout: 30_000 });
    await page.goto(`/admin/team/member/${added}`, { waitUntil: 'commit' });
    await expect(page.getByTestId('member-standing')).toContainText('Напусна', {
      timeout: 30_000,
    });
    await page.getByTestId('member-return').click();
    await expect(page.getByTestId('member-return-sheet')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-return-note')).toContainText(
      'не се връща сам',
    );
    await page.getByTestId('member-return-save').click();

    // BACK: the sheet leaves and the page reads a working record again —
    // the same one, where it was, on a new period with no last day. The
    // account is not brought back: the page offers to link one.
    await expect(page.getByTestId('member-return-sheet')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('member-standing')).toContainText(
      'Само за екипа',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-return')).toHaveCount(0);
    await expect(page.getByTestId('member-link')).toBeVisible();
    const back = await readStoredBody(Collections.Barbers, added);
    expect(back?.['barberStatus']).toBe(BarberStatus.StaffOnly);
    expect(back?.['barberStartsLocalDate']).toBe(shopToday());
    expect(back?.['barberLastWorkingLocalDate']).toBeNull();
    expect(back).not.toHaveProperty('barberRehireStatus');
    expect(await readBarberLink(added)).toBeNull();
    expect(
      (await readStoredBody(Collections.Users, leaverUid))?.['roles'],
    ).toEqual([Role.Client]);
    // The record and the account are the `afterEach`'s to remove.
  });

  test('a content editor reaches a barber’s profile from the Team list, and sees no account, no period editor and no delete', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const uid = `e2e-member-editor-${attemptKey(test.info())}`;
    await seedUserProfile(uid, {
      firstName: 'Редактор',
      lastName: 'Профили',
      roles: [Role.ContentManager],
    });
    await signInAs(page, uid, ['content_manager']);

    await page.goto('/admin/team', { waitUntil: 'commit' });
    await expect(page.getByTestId('admin-team')).toHaveAttribute(
      'data-load',
      'READY',
      { timeout: 30_000 },
    );
    // Adding someone is the manager's.
    await expect(page.getByTestId('admin-team-add')).toHaveCount(0);

    await page.getByTestId('team-member-ivan').click();
    await expect(page).toHaveURL(/\/admin\/team\/member\/ivan$/);
    await expect(page.getByTestId('member-standing')).toHaveText(
      'Приема записи',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('member-account')).toHaveCount(0);
    await expect(page.getByTestId('member-is-me')).toHaveCount(0);
    await expect(page.getByTestId('member-delete')).toHaveCount(0);
    await expect(page.getByTestId('member-pool')).toBeDisabled();
    // The hours are the schedule's permission and the prices the owner's:
    // both rows are read.
    await expect(
      page.locator('button[data-testid="member-row-hours"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('button[data-testid="member-row-services"]'),
    ).toHaveCount(0);

    // The profile is theirs to edit: the sheet opens on the record.
    await page.getByTestId('member-row-profile').click();
    await expect(page.getByTestId('member-profile-name')).toHaveValue(/Иван/);
    await expect(page.getByTestId('member-profile-save')).toBeDisabled();
  });
});
