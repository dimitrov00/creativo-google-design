import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { LoyaltyAccountFixture } from '@creativo/application/engagement/testing';
import { ClientStats, type VisitFact } from '@core/components';
import {
  AppointmentId,
  BarberId,
  DurationMinutes,
  LocalDate,
  MinuteOfDay,
  SeatId,
  ServiceId,
} from '@core/primitives';
import { SHOP_ZONE } from './support/appointment-seed-document';
import { attemptKey } from './support/attempt-key';
import { expectNoAxeViolations } from './support/axe';
import {
  type ClientStatsSeed,
  seedAppointmentPhoto,
  seedBirthdayGift,
  seedClientStats,
  seedHeldReward,
  seedLoyalty,
  seedUpcomingAppointment,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { THEMES, pinTheme } from './support/theme';

/**
 * THE STAFF CLIENT CARD, END TO END (client-card-revision-3 §7.5, E2E): a
 * barber opens today's visit, taps the person, and reads their card with
 * every development flag on — the hero head (the face in its tier ring,
 * the plate on the rim, the name as the page's one 28 pt title), the
 * discs, the visits before the loyalty (DV1), the history under its month
 * heads, the wallet with its pass and its ledger «Движение», «Рекорди», a
 * medal three pages deep with the dock's verb, and ✓ straight back to the
 * visit with the focus on the person's row. A second client, Мартин, has
 * his birthday today and holds the salon's gift: the card's one orange
 * slab and the ticket under it. The card's modules read a real account:
 * Георги's A0 loyalty fixture, his stats, worked visits over two years, a
 * past cut and today's booking — every one seeded under this attempt's
 * own uid. The loyalty CATALOGUE is the dev seed's, written once by
 * `support/global-setup.ts`. Axe runs on every page of the stack, once
 * per theme.
 */

/** Today in the shop's zone — the day the schedule opens on. */
function shopToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_ZONE }).format(
    new Date(),
  );
}

/**
 * Георги's A0 fixture, read as JSON: the testing entry itself cannot be
 * loaded here (Playwright's transform rejects the domain libs it imports).
 */
function georgiLoyalty(): LoyaltyAccountFixture {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the engagement lib's own fixture.
  const json = readFileSync(
    join(
      workspaceRoot,
      'libs/application/engagement/src/testing/fixtures/loyalty/account-georgi.json',
    ),
    'utf8',
  );
  return JSON.parse(json) as LoyaltyAccountFixture;
}

/** One visit on the stats: the appointment at 10:00 on the shop's clock that day. */
function tenAm(appointmentId: string, day: string): VisitFact {
  const localDate = LocalDate.parse(day);
  const startMinutes = MinuteOfDay.of(10 * 60);
  if (!localDate.ok || !startMinutes.ok) throw new Error(`no day ${day}`);
  return {
    appointmentId: AppointmentId.of(appointmentId),
    localDate: localDate.value,
    startMinutes: startMinutes.value,
  };
}

/**
 * The stats the two worked visits make — the flat `ClientStats` slice of
 * the `ClientStatsRecord` the projection writes (`seedClientStats` adds the
 * record's key and stamps): both at 10:00 on the shop's clock, the last one
 * a beard with Иван — what «Повтори» would repeat.
 */
function statsFor(uid: string): ClientStatsSeed {
  const older = tenAm(`${uid}-y25`, '2025-11-12');
  const last = tenAm(`${uid}-y26`, '2026-03-10');
  const beard = ServiceId.of('svc-beard');
  const ivan = BarberId.of('ivan');
  const minutes = DurationMinutes.of(30);
  if (!minutes.ok) throw new Error('no thirty minutes');
  return {
    ...ClientStats.empty(),
    lifetimeVisitsCompleted: 2,
    last365VisitsCompleted: [older, last],
    firstVisitLocalDate: older.localDate,
    firstVisitStartMinutes: older.startMinutes,
    lastVisitAppointmentId: last.appointmentId,
    lastVisitLocalDate: last.localDate,
    lastVisitStartMinutes: last.startMinutes,
    lastVisitServiceIds: [beard],
    lastVisitBarberIds: [ivan],
    lastVisitLegs: [
      {
        seatId: SeatId.of(`${uid}-y26-seat`),
        serviceId: beard,
        variantId: null,
        barberId: ivan,
        durationMinutes: minutes.value,
      },
    ],
    preferredBarberId: ivan,
  };
}

/** Everything the card reads about the attempt's client, and today's visit to open. */
async function seedGeorgi(uid: string, today: string): Promise<void> {
  const since = Date.now();
  await seedUserProfile(uid, {
    firstName: 'Георги',
    lastName: 'Петров',
    phone: '+359881234567',
  });
  await seedWorkedAppointment(`${uid}-y25`, uid, '2025-11-12T10:00:00');
  await seedWorkedAppointment(`${uid}-y26`, uid, '2026-03-10T10:00:00');
  // A year with a cut a month, January to October 2025: twelve month heads
  // in the history, so its pills have somewhere to jump.
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      return seedWorkedAppointment(
        `${uid}-y25-${month}`,
        uid,
        `2025-${month}-12T10:00:00`,
      );
    }),
  );
  // Late in the day, so the visit is still ahead whenever the suite runs —
  // and OPEN (not settled), which is what lets the medal page's verb add
  // a service to it.
  await seedUpcomingAppointment(`${uid}-today`, uid, `${today}T21:00:00`);
  await seedAppointmentPhoto(`${uid}-y26`, uid, {
    clientLabel: 'Георги Петров',
    takenAt: '2026-03-10T08:40:00.000Z',
  });
  await seedLoyalty(uid, georgiLoyalty());
  // His punch-card reward, held: the glance's ready ticket (E).
  await seedHeldReward(uid);
  // Last: after the appointments' triggers have gone quiet.
  await seedClientStats(uid, statsFor(uid), since);
}

/** The year Мартин was born in: his age today is the band's figure. */
const MARTIN_BORN = 1992;

/**
 * Мартин Илиев, whose birthday is TODAY (§2.1.2 a): the profile with the
 * date, today's visit to open, and the salon's gift — the −20 % coupon
 * with `occasion: 'birthday'` and one active grant of it.
 */
async function seedMartin(uid: string, today: string): Promise<void> {
  await seedUserProfile(uid, {
    firstName: 'Мартин',
    lastName: 'Илиев',
    phone: '+359887654321',
    birthDate: `${MARTIN_BORN}-${today.slice(5)}`,
  });
  await seedUpcomingAppointment(`${uid}-today`, uid, `${today}T21:00:00`);
  await seedBirthdayGift(uid);
}

/** The visit sheet's editor — its `data-depth` is the page stack's. */
function editorOf(page: Page) {
  return page.getByTestId('staff-visit-editor');
}

/** The sheet's bar title, which collapses the page's large title. */
function barTitleOf(page: Page): Locator {
  return page.locator(
    '[data-testid="staff-visit-sheet"] .modal-sheet__toolbar > [uititle]',
  );
}

/**
 * A PAGE WITH NO LARGE TITLE IS NAMED BY THE BAR FROM REST (§3.7, §5.3):
 * at the page's top, with nothing scrolled, the bar's title is painted —
 * present AND at opacity 1 (wave D r3 read «7.08» at opacity 0).
 */
async function expectTitledFromRest(barTitle: Locator): Promise<void> {
  await expect
    .poll(() =>
      barTitle.evaluate((element) => {
        const scroller = element.closest('.modal-sheet__scroll');
        return `${scroller?.scrollTop ?? 'none'}|${getComputedStyle(element).opacity}`;
      }),
    )
    .toBe('0|1');
}

/**
 * Opens the day's agenda on `rowId`'s visit, then the person's page inside
 * it: the card is the stack's first page, its h2 the page's title.
 */
async function openCardOf(
  page: Page,
  today: string,
  rowId: string,
  clientUid: string,
): Promise<Locator> {
  await page.goto(`/staff/schedule?day=${today}&view=agenda`);
  const visit = page.locator(`[data-row-id="${rowId}"]`);
  await expect(visit).toBeVisible({ timeout: 30_000 });
  await visit.click();
  const editor = editorOf(page);
  await expect(editor).toHaveAttribute('data-depth', '0');
  await page.getByTestId(`staff-visit-client-row-${clientUid}`).click();
  await expect(editor).toHaveAttribute('data-depth', '1');
  return page.getByTestId('client-card');
}

/**
 * ONE ORANGE SLAB PER PAGE (§1.5 rule 8): the elements taller than 52 pt
 * whose computed background is the accent — the glance's birthday band or
 * the wallet's pass field, never both, never two.
 */
async function accentSlabs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="staff-visit-sheet"]');
    if (!sheet) return -1;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--sys-color-accent')
      .trim();
    const probe = document.createElement('span');
    probe.style.color = accent;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    let slabs = 0;
    for (const element of sheet.querySelectorAll<HTMLElement>('*')) {
      if (element.getBoundingClientRect().height <= 52) continue;
      if (getComputedStyle(element).backgroundColor === resolved) slabs += 1;
    }
    return slabs;
  });
}

/**
 * AN ANCHORED HEADING READS UNDER THE FADE (§2.3). The heading a disc
 * lands on is what the focus takes, so it must arrive below the chrome's
 * fade, not inside it: flush at the bar's edge, the fade's 3rem overhang
 * washed «Каталог» out to 1.69:1 (wave D r2). Waits for the page to rest
 * (the scroll, the heading's box, the fade's opacity), photographs the
 * heading's own box as painted — whatever the fade lays over it included
 * — and returns the WCAG contrast of its strongest ink against the sheet,
 * the box's commonest pixel.
 */
async function paintedInkContrast(
  page: Page,
  heading: Locator,
): Promise<number> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await heading.evaluate((element) => {
          const scroller = element.closest('.modal-sheet__scroll');
          const chrome = scroller?.querySelector('.modal-sheet__chrome');
          const box = element.getBoundingClientRect();
          return [
            scroller?.scrollTop ?? 'none',
            box.top,
            box.left,
            chrome ? getComputedStyle(chrome, '::before').opacity : 'none',
          ].join('|');
        });
        const rested = now === last;
        last = now;
        return rested;
      },
      { intervals: [200], timeout: 10_000 },
    )
    .toBe(true);
  const box = await heading.boundingBox();
  if (!box) {
    throw new Error('the anchored heading has no box');
  }
  const shot = await page.screenshot({ clip: box });
  return page.evaluate(async (png) => {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: 'image/png' }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts = new Map<string, number>();
    for (let index = 0; index < pixels.data.length; index += 4) {
      const key = Array.from(pixels.data.subarray(index, index + 3)).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const linear = (value: number) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (key: string) => {
      const [red = 0, green = 0, blue = 0] = key.split(',').map(Number);
      return (
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
      );
    };
    const [sheet] = [...counts].reduce((most, entry) =>
      entry[1] > most[1] ? entry : most,
    );
    const ground = luminance(sheet);
    let strongest = 1;
    for (const key of counts.keys()) {
      const ink = luminance(key);
      strongest = Math.max(
        strongest,
        (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05),
      );
    }
    return strongest;
  }, shot.toString('base64'));
}

test.describe('client card — the glance (client.profile on)', () => {
  // Once per theme, as `expectNoAxeViolations` asks: contrast differs.
  for (const theme of THEMES) {
    test(`a barber reads the card: the hero, the months, the wallet and its ledger, the records, a medal three deep with the dock's verb, ✓ back — ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const run = attemptKey(test.info());
      const uid = `e2e-card-${run}`;
      const today = shopToday();
      await seedGeorgi(uid, today);
      await pinTheme(page, theme);
      await signInAs(page, `e2e-card-staff-${run}`, ['barber']);

      const editor = editorOf(page);
      const sheet = '[data-testid="staff-visit-sheet"]';
      const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);

      // THE HERO (§2.1 A): a centred head, the name the page's one `title`
      // h2, the face in its ring with the tier as a plate on the rim —
      // the ring and the plate land when the account and the catalogue
      // are known (S1-5) — and the quiet line under the name.
      const head = card.getByTestId('client-head');
      await expect(head).toHaveAttribute('data-headline-style', 'hero');
      await expect(card.getByTestId('client-head-title')).toHaveText(
        'Георги Петров',
      );
      await expect(card.getByTestId('client-head-avatar')).toBeVisible();
      await expect(head).toHaveAttribute('data-plate', '', {
        timeout: 20_000,
      });
      await expect(card.getByTestId('client-head-tier')).toHaveText(
        /Злато|Gold/,
      );
      await expect(head.locator('.ui-sheet-headline__ring')).toBeVisible();
      await expect(card.getByTestId('client-head-tier-words')).toBeAttached();
      await expect(card.getByTestId('client-head-subline')).toBeVisible();
      // The head's birthday capsule is gone (F3): no capsule names it.
      await expect(card.getByTestId('client-capsule-birthday')).toHaveCount(0);

      // THE DISCS (§2.1 D, G1-1): round verbs with their word under them;
      // «Повтори» is the one promoted (solid) disc, the phone's own apps
      // hand off to the OS.
      await expect(card.getByTestId('client-quick-actions')).toBeVisible();
      await expect(card.getByTestId('client-quick-same')).toHaveAttribute(
        'data-prominence',
        'accent',
      );
      await expect(card.getByTestId('client-quick-call')).toHaveAttribute(
        'href',
        /^tel:/,
      );

      // THE MODULES: the last visit as a card, the loyalty summarised in
      // ONE white card whose figure is the balance, three medals and the
      // records line. H before F: what was done, then the loyalty (DV1).
      await expect(card.getByTestId('client-visit-last')).toBeVisible({
        timeout: 20_000,
      });
      await expect(card.getByTestId('client-loyalty-all')).toBeVisible();
      const loyaltyCard = card.getByTestId('client-loyalty-points');
      await expect(loyaltyCard).toHaveJSProperty('tagName', 'BUTTON');
      await expect(card.getByTestId('client-loyalty-points-figure')).toHaveText(
        /^\d+$/,
      );
      await expect(card.getByTestId('client-loyalty-stamps')).toHaveText(
        /\d+ от \d+/,
      );
      await expect(card.getByTestId('client-achievements-all')).toBeVisible();
      await expect(card.getByTestId('client-achievements-strip')).toBeVisible();
      await expect(
        card.locator('[data-testid^="client-medal-"]').first(),
      ).toBeVisible();
      await expect(card.getByTestId('client-records-line')).toBeVisible();
      const visitsFirst = await page.evaluate(() => {
        const visits = document.querySelector('[data-testid="client-visits"]');
        const loyalty = document.querySelector(
          '[data-testid="client-loyalty"]',
        );
        return (
          visits !== null &&
          loyalty !== null &&
          (visits.compareDocumentPosition(loyalty) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0
        );
      });
      expect(visitsFirst).toBe(true);
      // Not a birthday: no band, and the glance never draws the pass.
      await expect(card.getByTestId('client-birthday')).toHaveCount(0);
      expect(await accentSlabs(page)).toBe(0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, { include: sheet });

      // THE HISTORY: its visits under MONTH heads (B5), today's under
      // «Предстоящи», the pills over them.
      await card.getByTestId('client-visits-all').click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      const history = page.getByTestId('history-page');
      await expect(history.getByTestId('history-month-2026-03')).toBeVisible({
        timeout: 20_000,
      });
      await expect(history.getByTestId('history-month-2025-11')).toBeVisible();
      await expect(history.getByTestId('history-upcoming')).toBeVisible();
      await expect(
        history.locator(
          '[data-testid="history-pill"][data-section="upcoming"]',
        ),
      ).toHaveCount(1);
      await expect(
        history.locator('[data-testid="history-pill"][data-section="2026-03"]'),
      ).toHaveCount(1);
      await expect(history.getByTestId('history-facts')).toBeVisible();
      await expectNoAxeViolations(page, { include: sheet });
      // ‹ walks one step, back onto the module that pushed.
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(card.getByTestId('client-visits-all')).toBeFocused();

      // A PAST CUT IS NAMED BY THE BAR FROM REST (§3.7): the photo has no
      // large title to scroll under the bar, so its date shows at once.
      const cut = card.getByTestId(`client-photo-photo-${uid}-y26`);
      await expect(cut).toBeVisible({ timeout: 20_000 });
      await cut.click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'photo',
      );
      const barTitle = barTitleOf(page);
      await expect(barTitle).toHaveText(/^\d{1,2}\.\d{2}/);
      await expectTitledFromRest(barTitle);
      // …and the picture under it is not veiled at rest (wave D r5): the
      // chrome's fade reaches 3rem below the bar and the hero starts inside
      // that overhang, so at rest the fade is off — the title shows, the
      // fade waits for a scroll — or the hero sits clear of it.
      await expect
        .poll(() =>
          barTitle.evaluate((element) => {
            const scroller = element.closest('.modal-sheet__scroll');
            const chrome = scroller?.querySelector('.modal-sheet__chrome');
            const hero = scroller?.querySelector('.staff-visit__photo-hero');
            if (!scroller || !chrome || !hero) return 'missing';
            const fade = getComputedStyle(chrome, '::before');
            const fadeBottom =
              chrome.getBoundingClientRect().top + parseFloat(fade.height);
            const heroTop = hero.getBoundingClientRect().top;
            const veiled =
              Number(fade.opacity) > 0 && heroTop < fadeBottom - 0.5;
            return `${scroller.scrollTop}|${veiled ? 'veiled' : 'clear'}`;
          }),
        )
        .toBe('0|clear');
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(cut).toBeFocused();

      // THE WALLET (§2.2): «Всички ›» pushes «Лоялност» at its top — the
      // pass (the page's one orange slab) with the tier on its plate and
      // the balance as its figure, under a bar that names the page FROM
      // REST (§5.3: the wallet has no large title). The glance's card
      // pushes the same page with the same (null) anchor, so the ‹ pin
      // below holds for either origin.
      await card.getByTestId('client-loyalty-all').click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'clientLoyalty',
      );
      const pass = page.getByTestId('rewards-pass');
      await expect(pass).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('rewards-pass-tier')).toHaveText(
        /Злато|Gold/,
      );
      await expect(page.getByTestId('rewards-pass-figure')).toHaveText(/^\d+/);
      await expect(page.getByTestId('rewards-pass-holder')).toHaveText(
        'Георги Петров',
      );
      await expect(barTitle).toHaveText(/Лоялност|Loyalty/);
      await expectTitledFromRest(barTitle);
      await expect(page.locator(`${sheet} .ui-pass-card`)).toHaveCount(1);
      await expect(page.locator(`${sheet} .ui-occasion-band`)).toHaveCount(0);
      expect(await accentSlabs(page)).toBe(1);
      await expect(page.getByTestId('rewards-wallet')).toBeVisible();
      await expect(
        page.getByTestId('rewards-stamp-rule-every-10th-visit'),
      ).toBeVisible();
      await expectNoAxeViolations(page, { include: sheet });

      // A DISC LANDS ON ITS SECTION (§2.2.3, B2-1): «Награди» scrolls to
      // the catalogue in place and focuses its heading, never taken back
      // by the container…
      await page.getByTestId('rewards-action-catalog').click();
      const anchored = page.locator('#staff-visit-page-title-catalog');
      await expect(anchored).toBeFocused({ timeout: 20_000 });
      // …below the chrome's fade, never in it: the name that answers the
      // tap reads at text contrast against the sheet, in this theme.
      expect(await paintedInkContrast(page, anchored)).toBeGreaterThanOrEqual(
        4.5,
      );

      // THE LEDGER (§2.2.6): «История» pushes «Движение», three deep — the
      // pills, the months, an entry — then ‹ twice walks back to the glance,
      // onto the verb that pushed the wallet.
      await page.getByTestId('rewards-action-history').click();
      await expect(editor).toHaveAttribute('data-depth', '3');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'clientLedger',
      );
      const ledger = page.getByTestId('ledger-page');
      await expect(ledger.getByTestId('ledger-title')).toHaveText(
        /Движение|Activity/,
      );
      await expect(ledger.getByTestId('ledger-filter')).toBeVisible();
      await expect(
        ledger.locator('[data-testid^="ledger-month-"]').first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        ledger.locator('[data-testid^="ledger-entry-"]').first(),
      ).toBeVisible();
      await expectNoAxeViolations(page, { include: sheet });
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('rewards-action-history')).toBeFocused();
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(card.getByTestId('client-loyalty-all')).toBeFocused();

      // THE RECORDS (§2.3.4): the glance's records line pushes «Рекорди»
      // two deep — the featured record, the groups, the count by year.
      await card.getByTestId('client-records-line').click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'clientRecords',
      );
      await expect(page.getByTestId('records-title')).toHaveText(
        /Рекорди|Records/,
      );
      await expect(page.getByTestId('records-featured')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId('records-groups')).toBeVisible();
      await expect(page.getByTestId('records-years')).toBeVisible();
      await expectNoAxeViolations(page, { include: sheet });
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(card.getByTestId('client-records-line')).toBeFocused();

      // THE READY TICKET DOES WHAT IT SAYS, AND STAYS (WP7 review r5–r6):
      // «Използвай» puts the reward on the bill and opens the discount page
      // with it applied; ‹ finds the SAME ticket where it stood, stamped,
      // «Премахни» where «Използвай» stood, and the focus on it. Its name
      // says the rule, so no value line repeats it.
      const ticket = card.getByTestId('client-reward-ready');
      await expect(ticket).toBeVisible({ timeout: 20_000 });
      await expect(ticket).toHaveAttribute(
        'aria-label',
        'Безплатно подстригване, използвай',
      );
      await ticket.click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'discount',
      );
      await expect(
        page.getByTestId('staff-visit-discount-lines-value'),
      ).toContainText('Безплатно подстригване');
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(ticket).toHaveJSProperty('tagName', 'ARTICLE');
      await expect(card.getByTestId('client-reward-ready-remove')).toHaveText(
        'Премахни',
      );
      await expect(ticket).toBeFocused();
      // «Премахни» takes it off the bill where it stands: offered again,
      // the focus kept on it.
      await card.getByTestId('client-reward-ready-remove').click();
      await expect(ticket).toHaveJSProperty('tagName', 'BUTTON');
      await expect(ticket).toContainText('Използвай');
      await expect(ticket).toBeFocused();

      // A MEDAL THREE DEEP: the collection, a category's chip (the chips
      // sit IN FLOW over the grids, B3), then «Фейд» from the embedded
      // scope — a family whose service this visit lacks.
      await card.getByTestId('client-achievements-all').click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'clientAchievements',
      );
      // Records first, then the chips (§2.3.1).
      await expect(page.getByTestId('achievements-records')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId('achievements-chips')).toBeVisible();
      // The collection is scanned where its rings and rim chips draw.
      await expectNoAxeViolations(page, { include: sheet });
      await page.getByTestId('achievements-chip-cat-mastery').click();
      await expect(page.getByTestId('achievements-body')).toHaveAttribute(
        'data-chip',
        'cat-mastery',
      );
      const medal = page.getByTestId('achievements-scope-series-svc-fade');
      await expect(medal).toBeVisible({ timeout: 20_000 });
      await medal.click();
      await expect(editor).toHaveAttribute('data-depth', '3');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'achievementDetail',
      );
      await expect(page.getByTestId('achievements-detail-title')).toHaveText(
        /Фейд|Skin fade/,
      );

      // THE DOCK'S VERB (§5.2, DV-C): the medal page carries no verb of its
      // own; the dock offers «Добави фейд» beside ✓ while the open visit
      // lacks the service. The press adds the leg, stays on the page, the
      // polite region says so, the progress card gains its «Това посещение
      // се брои…» line, and the button gives way — the ✓ stays.
      const verb = page.getByTestId('staff-visit-detail-add');
      await expect(verb).toBeVisible({ timeout: 20_000 });
      await expect(verb).toHaveText(/Добави фейд/);
      await expectNoAxeViolations(page, { include: sheet });
      await verb.click();
      await expect(verb).toHaveCount(0);
      await expect(editor).toHaveAttribute('data-depth', '3');
      await expect(
        page.getByTestId('achievements-detail-this-visit'),
      ).toBeVisible();
      await expect(page.getByTestId('staff-visit-announce')).toHaveText(
        /Добавихме фейд към посещението\./i,
      );
      await expect(page.getByTestId('staff-visit-page-done')).toBeVisible();

      // ✓ LEAVES THE PERSON: straight back to the visit, on their row.
      await page.getByTestId('staff-visit-page-done').click();
      await expect(editor).toHaveAttribute('data-depth', '0');
      await expect(page.getByTestId('staff-visit-root')).toBeVisible();
      await expect(
        page.getByTestId(`staff-visit-client-row-${uid}`),
      ).toBeFocused();
    });

    test(`a birthday client: the band under the head, the gift to use, applied and taken back — ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const run = attemptKey(test.info());
      const uid = `e2e-card-bday-${run}`;
      const today = shopToday();
      const age = Number(today.slice(0, 4)) - MARTIN_BORN;
      await seedMartin(uid, today);
      await pinTheme(page, theme);
      await signInAs(page, `e2e-card-bday-staff-${run}`, ['barber']);

      const editor = editorOf(page);
      const sheet = '[data-testid="staff-visit-sheet"]';
      const card = await openCardOf(page, today, `${uid}-today#ivan`, uid);
      await expect(card.getByTestId('client-head-title')).toHaveText(
        'Мартин Илиев',
      );

      // THE BIRTHDAY CARD (§2.1.2 a): once the profile has answered, the
      // solid band — the page's ONE orange slab — names the day and the
      // age, and the gift's ticket hangs under its perforation: the one
      // control, the figure in the accent, the decorative pill. E does not
      // repeat the grant, and the head wears no birthday capsule.
      const birthday = card.getByTestId('client-birthday');
      await expect(birthday).toHaveAttribute('data-kind', 'today', {
        timeout: 20_000,
      });
      await expect(birthday).toHaveAttribute('data-gift', 'ready');
      await expect(card.getByTestId('client-birthday-band')).toContainText(
        `Рожден ден · ${age} г.`,
      );
      const gift = card.getByTestId('client-birthday-gift');
      await expect(gift).toHaveJSProperty('tagName', 'BUTTON');
      // The button's one sentence: the day, the age, the gift, the verb.
      await expect(gift).toHaveAttribute(
        'aria-label',
        /^Рожден ден днес, навършва \d+ години\. Подарък: .*20.*%, използвай$/,
      );
      expect(await gift.getAttribute('aria-label')).toContain(
        `навършва ${age} години`,
      );
      await expect(gift).toContainText('Подарък от салона');
      await expect(gift).toContainText('Използвай');
      await expect(card.getByTestId('client-reward-ready')).toHaveCount(0);
      await expect(card.getByTestId('client-capsule-birthday')).toHaveCount(0);
      await expect(page.locator(`${sheet} .ui-occasion-band`)).toHaveCount(1);
      await expect(page.locator(`${sheet} .ui-pass-card`)).toHaveCount(0);
      expect(await accentSlabs(page)).toBe(1);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page, { include: sheet });

      // «Използвай» puts the gift on the bill and opens the discount page
      // with it applied; ‹ finds the band where it stood over the APPLIED
      // ticket — the check on its figure, «Премахни» where the pill stood
      // — and the focus on it.
      await gift.click();
      await expect(editor).toHaveAttribute('data-depth', '2');
      await expect(page.getByTestId('staff-visit-page')).toHaveAttribute(
        'data-page',
        'discount',
      );
      await expect(
        page.getByTestId('staff-visit-discount-lines-value'),
      ).toContainText('Рожден ден');
      await page.getByTestId('staff-visit-back').click();
      await expect(editor).toHaveAttribute('data-depth', '1');
      await expect(birthday).toHaveAttribute('data-gift', 'applied');
      await expect(gift).toHaveJSProperty('tagName', 'ARTICLE');
      await expect(card.getByTestId('client-birthday-band')).toBeVisible();
      await expect(card.getByTestId('client-birthday-gift-remove')).toHaveText(
        'Премахни',
      );
      await expect(gift).toBeFocused();
      await expectNoAxeViolations(page, { include: sheet });
      // «Премахни» takes it off the bill where it stands: offered again.
      await card.getByTestId('client-birthday-gift-remove').click();
      await expect(birthday).toHaveAttribute('data-gift', 'ready');
      await expect(gift).toHaveJSProperty('tagName', 'BUTTON');
      await expect(gift).toBeFocused();

      // ✓ LEAVES THE PERSON: straight back to the visit, on their row.
      await page.getByTestId('staff-visit-page-done').click();
      await expect(editor).toHaveAttribute('data-depth', '0');
      await expect(
        page.getByTestId(`staff-visit-client-row-${uid}`),
      ).toBeFocused();
    });
  }
});
