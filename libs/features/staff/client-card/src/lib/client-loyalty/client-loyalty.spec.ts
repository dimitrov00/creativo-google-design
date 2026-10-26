import { CouponGrantId, CouponId } from '@core/primitives';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CouponVoucherPorts } from '@core/ports';
import {
  GEORGI,
  GEORGI_GRANT,
  GUEST,
  MARTIN,
  catalogPortsOf,
  georgiContext,
  georgiOpenContext,
  georgiUser,
  heldProfilePortsOf,
  journalPortsOf,
  loyaltyPortsOf,
  martinContext,
  must,
  pausedUntilOctober,
  profilePortsOf,
  subjectOf,
  voucherPortsOf,
} from '../../testing/client-card.fixtures';
import {
  ALL_LOYALTY_FLAGS,
  type AchievementsRig,
  heldCatalogPorts,
  PAGE_TITLE_ID,
  mountAchievementsPage,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import type {
  ClientCardContext,
  ClientCardSubject,
  WalletAnchor,
} from '../client-card.contracts';
import {
  WalletHolding,
  type WalletHoldingVm,
  type WalletVm,
} from '../client-pages.vm';
import { LoadState } from '@creativo/shared/view-state';
import { ClientLoyaltyPage } from './client-loyalty';

/*
 * THE WALLET (client-card-revision-3 §2.2), mounted as the visit editor
 * mounts it: the REAL store opened on the person, every port in memory
 * over the dev seed's books, the app's own words. What a case reads is
 * what the store and the presenters make of Георги's and Мартин's books
 * (LR7: no seed figure is hard-coded here; where one matters it is read
 * from the store's own model), and what the body makes of that.
 */

interface WalletMountOptions {
  readonly subject?: ClientCardSubject;
  readonly context?: ClientCardContext;
  readonly anchor?: WalletAnchor | null;
  readonly rig?: AchievementsRig;
}

/** The seeded vouchers, answering only when the spec says so: the holdings on their way. */
function heldVouchers(): CouponVoucherPorts & { answer(): void } {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = voucherPortsOf();
  return {
    ...inner,
    listGiftVouchersForHolder: async (customerId) => {
      await gate;
      return inner.listGiftVouchersForHolder(customerId);
    },
    answer: () => release?.(),
  };
}

/** Everything the page emits, in order. */
interface Emitted {
  readonly rewards: string[];
  readonly removed: string[];
  code: number;
  ledger: number;
}

/** The holding's test id, by kind. */
function holdingId(holding: WalletHoldingVm): string {
  switch (holding.walletHolding) {
    case WalletHolding.Voucher:
      return `rewards-voucher-${holding.voucher.voucherId}`;
    case WalletHolding.Ticket:
      return `rewards-ready-${holding.ticket.grantId}`;
    case WalletHolding.Stamps:
      return `rewards-stamp-${holding.card.ruleId}`;
  }
}

async function mount(options: WalletMountOptions = {}) {
  const {
    vouchers = voucherPortsOf(),
    activity = journalPortsOf(),
    ...rig
  } = options.rig ?? {};
  // A case may mount twice (two states side by side): a fresh module each
  // time. The shared rig binds every port the glance pages read, and the
  // wallet's two readers when they are handed to it (B2-6): seeded here
  // unless a case brings its own.
  TestBed.resetTestingModule();
  const mounted = await mountAchievementsPage(ClientLoyaltyPage, {
    subject: options.subject ?? subjectOf(GEORGI),
    context: options.context ?? georgiOpenContext(),
    inputs:
      options.anchor === undefined ? undefined : { anchor: options.anchor },
    rig: { ...rig, vouchers, activity },
  });
  const page = mounted.fixture.componentInstance;
  const emitted: Emitted = { rewards: [], removed: [], code: 0, ledger: 0 };
  page.openReward.subscribe((id) => emitted.rewards.push(id));
  page.removeReward.subscribe((id) => emitted.removed.push(id));
  page.openCode.subscribe(() => (emitted.code += 1));
  page.openLedger.subscribe(() => (emitted.ledger += 1));
  const click = async (testId: string) => {
    must(mounted.byId(testId), testId).click();
    await mounted.render();
  };
  /** The page as the store worded it — what every region must bind. */
  const wallet = (): WalletVm => {
    const slice = mounted.store.wallet();
    if (slice?.loadState !== LoadState.Ready)
      throw new Error('the wallet is not ready');
    return slice.data;
  };
  /** The module headings, in page order. */
  const headings = () =>
    mounted
      .all('ui-section-header[data-header-prominence="increased"] h3')
      .map((heading) => mounted.text(heading));
  return { ...mounted, emitted, click, wallet, headings, vouchers, activity };
}

/** A `matchMedia` answering the sheet's dialog query with `wide`. */
function stubDialogWidth(wide: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: wide && query === '(min-width: 761px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

/** jsdom scrolls nothing: the landing is observed on the prototype. */
function stubScrollIntoView(): ReturnType<typeof vi.fn> {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scroll,
  });
  return scroll;
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
});

describe('lib-client-loyalty — Георги, every flag on, his next visit open', () => {
  it('names the page for a reader alone and asks the sheet for the tight fade: the bar titles it from rest, no large title under it', async () => {
    const { host, byId, text } = await mount();
    expect(host.getAttribute('data-testid')).toBe('rewards-page');
    expect(host.getAttribute('data-sheet-fade')).toBe('tight');
    expect(host.hasAttribute('data-wide')).toBe(false);
    const title = must(byId('rewards-title'));
    expect(title.tagName).toBe('H2');
    expect(title.id).toBe(PAGE_TITLE_ID);
    expect(title.hasAttribute('uivisuallyhidden')).toBe(true);
    expect(text(title)).toBe('Лоялност');
    expect(host.querySelector('ui-sheet-headline')).toBeNull();
    expect(host.querySelector('[data-font="largeTitle"]')).toBeNull();
    expect(host.querySelector('[uisheetlargetitle]')).toBeNull();
    expect(byId('rewards-subline')).toBeNull();
    expect(host.children[0]).toBe(title);
  });

  it('leads with the pass: the balance as its white display figure, the tier its one plate, the holder on the white foot — the page’s one orange slab', async () => {
    const { host, byId, text, wallet } = await mount();
    const model = wallet().pass;
    const head = must(host.children[1]);
    expect(head.classList).toContain('client-loyalty__head');
    const pass = must(byId('rewards-pass'));
    expect(pass.tagName).toBe('UI-PASS-CARD');
    expect(pass).toBe(head.firstElementChild);
    expect(pass.getAttribute('role')).toBe('group');
    expect(pass.getAttribute('aria-label')).toBe(model.accessibleName);
    expect(pass.hasAttribute('data-frozen')).toBe(false);
    expect(text(byId('rewards-pass-figure'))).toBe(model.figure);
    expect(text(pass.querySelector('.ui-pass-card__unit'))).toBe(model.unit);
    expect(text(byId('rewards-pass-holder'))).toBe(model.holder);
    expect(text(byId('rewards-pass-detail'))).toBe(model.since);
    expect(model.state).toBeNull();
    expect(byId('rewards-pass-state')).toBeNull();
    // The mark and the ONE plate, in the card's two slots.
    const mark = must(pass.querySelector('ui-logo'));
    expect(mark.hasAttribute('uipassmark')).toBe(true);
    const plate = must(byId('rewards-pass-tier'));
    expect(plate.hasAttribute('uipassbadge')).toBe(true);
    expect(plate.classList).toContain('ui-badge');
    expect(plate.hasAttribute('data-on-media')).toBe(true);
    expect(plate.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'loyalty.tier',
    );
    expect(text(plate)).toBe(must(model.tier));
    // ONE slab (§1 rule 5): the pass, and nothing else solid.
    expect(host.querySelectorAll('ui-pass-card')).toHaveLength(1);
    expect(host.querySelector('ui-occasion-band')).toBeNull();
    expect(host.querySelector('.ui-card[data-tone="accent"]')).toBeNull();
    expect(host.querySelector('.ui-card[data-tone="muted"]')).toBeNull();
  });

  it('reaches what works today through four discs under the pass, «Използвай» the one promoted, and each disc does its verb', async () => {
    const scroll = stubScrollIntoView();
    const { byId, all, text, wallet, emitted, click } = await mount();
    const actions = wallet().actions;
    const run = must(byId('rewards-actions'));
    expect(run.tagName).toBe('UI-QUICK-ACTIONS');
    expect(run.getAttribute('aria-label')).toBe('Действия');
    expect(run.style.getPropertyValue('--ui-quick-actions-columns')).toBe('4');
    const discs = all<HTMLButtonElement>('button[uiquickaction]');
    expect(discs.map((disc) => disc.getAttribute('data-testid'))).toEqual([
      'rewards-action-use',
      'rewards-action-code',
      'rewards-action-catalog',
      'rewards-action-history',
    ]);
    expect(discs.map((disc) => text(disc))).toEqual([
      'Използвай',
      'Код',
      'Награди',
      'История',
    ]);
    expect(discs.map((disc) => disc.getAttribute('data-prominence'))).toEqual([
      'accent',
      'standard',
      'standard',
      'standard',
    ]);
    discs.forEach((disc, index) => {
      const action = must(actions.at(index));
      expect(disc.getAttribute('aria-label')).toBe(action.accessibleName);
      expect(
        disc
          .querySelector('.ui-quick-action__disc > ui-icon')
          ?.getAttribute('data-name'),
      ).toBe(action.icon);
    });
    // One ready ticket: no count on the disc, and the verb carries the grant.
    expect(byId('rewards-action-use-count')).toBeNull();
    await click('rewards-action-use');
    expect(emitted.rewards).toEqual([must(actions[0]).grantId]);
    await click('rewards-action-code');
    expect(emitted.code).toBe(1);
    await click('rewards-action-history');
    expect(emitted.ledger).toBe(1);
    // «Награди» lands on the catalogue's heading, under the bar.
    await click('rewards-action-catalog');
    const heading = must(byId('rewards-catalog-module')?.querySelector('h3'));
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(scroll.mock.contexts.at(-1)).toBe(heading);
    expect(document.activeElement).toBe(heading);
  });

  it('with several rewards ready, «Използвай» wears their count on the disc and opens the discount page', async () => {
    const { byId, wallet, emitted, click } = await mount({
      context: georgiContext({
        grants: [
          GEORGI_GRANT,
          {
            ...GEORGI_GRANT,
            grantId: CouponGrantId.of('grant-dev-georgi-beard'),
            // Another coupon — a reward is one ticket per coupon (OR-15).
            couponId: CouponId.of('coupon-free-beard'),
            title: 'Безплатно оформяне на брада',
          },
        ],
      }),
    });
    const use = must(wallet().actions.find((action) => action.id === 'use'));
    expect(use.grantId).toBeNull();
    expect(use.count).toBe(2);
    const badge = must(byId('rewards-action-use-count'));
    expect(badge.hasAttribute('uiquickactionbadge')).toBe(true);
    expect(badge.classList).toContain('ui-badge');
    expect(badge.getAttribute('data-prominence')).toBe('increased');
    expect(badge.textContent?.trim()).toBe('2');
    expect(badge.closest('button')?.getAttribute('aria-label')).toBe(
      use.accessibleName,
    );
    await click('rewards-action-use');
    expect(emitted.rewards).toEqual([]);
    expect(emitted.code).toBe(1);
  });

  it('«В портфейла» stacks what he holds as white tickets — the voucher, the reward, the stamp card — no bare count in the heading, the holdings named', async () => {
    const { byId, text, wallet } = await mount();
    const held = wallet().holdings;
    if (held.loadState !== LoadState.Ready)
      throw new Error('the holdings are not ready');
    const section = must(byId('rewards-wallet'));
    const heading = must(section.querySelector('h3'));
    expect(heading.id).toBe(`${PAGE_TITLE_ID}-wallet`);
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(text(heading)).toBe('В портфейла');
    // One voucher: no detail beside the heading (the tickets are right
    // under it); several would put their sum there.
    expect(wallet().holdingsDetail).toBeNull();
    expect(byId('rewards-wallet-count')).toBeNull();
    const holdings = must(byId('rewards-holdings'));
    expect(holdings.tagName).toBe('LIB-WALLET-HOLDINGS');
    expect(holdings.getAttribute('role')).toBe('group');
    expect(holdings.getAttribute('aria-label')).toBe(
      `В портфейла, ${held.data.length}`,
    );
    expect(holdings.getAttribute('data-columns')).toBe('1');
    const ids = [...holdings.children].map((child) =>
      child.getAttribute('data-testid'),
    );
    expect(ids).toEqual(held.data.map(holdingId));
    expect(held.data.map((holding) => holding.walletHolding)).toEqual([
      WalletHolding.Voucher,
      WalletHolding.Ticket,
      WalletHolding.Stamps,
    ]);
    // The voucher's figure is its balance; the reward is static here (the
    // disc is the verb); the stamps count themselves.
    const [voucher, ticket, stamps] = held.data;
    if (
      voucher?.walletHolding !== WalletHolding.Voucher ||
      ticket?.walletHolding !== WalletHolding.Ticket
    ) {
      throw new Error('the holdings moved');
    }
    expect(
      text(byId(holdingId(voucher))?.querySelector('.ui-coupon-card__value')),
    ).toBe(voucher.voucher.balance.replace(/\s+/g, ' '));
    const reward = must(byId(holdingId(ticket)));
    expect(reward.getAttribute('aria-label')).toBe(
      ticket.ticket.accessibleName,
    );
    expect(reward.querySelector('[uicouponaction]')).toBeNull();
    expect(reward.querySelector('button')).toBeNull();
    expect(byId(`${holdingId(ticket)}-remove`)).toBeNull();
    expect(byId(holdingId(must(stamps)))?.tagName).toBe('UI-CARD');
    expect(byId('rewards-wallet-empty')).toBeNull();
  });

  it('«Ритъм»: the card prints the store’s run and its rule, and a tap unfolds the whole rule in place', async () => {
    const { byId, text, wallet, click } = await mount();
    const rhythm = must(wallet().rhythm);
    const card = must(byId('rewards-rhythm'));
    expect(card.tagName).toBe('LIB-RHYTHM-CARD');
    const section = must(card.closest('section'));
    const heading = must(section.querySelector('h3'));
    expect(heading.id).toBe(`${PAGE_TITLE_ID}-rhythm`);
    expect(text(heading)).toBe('Ритъм');
    expect(text(byId('rewards-rhythm-figure'))).toBe(rhythm.figure);
    expect(
      byId('rewards-rhythm-track')?.querySelectorAll('.ui-streak-track__period')
        .length,
    ).toBeLessThanOrEqual(8);
    expect(text(byId('rewards-rhythm-state'))).toBe(rhythm.stateLine);
    const rule = must(byId('rewards-rhythm-rule'));
    expect(text(rule)).toBe(rhythm.ruleLine);
    expect(rule.getAttribute('aria-label')).toBe(
      `${rhythm.ruleLine} · Цялото правило`,
    );
    await click('rewards-rhythm-rule');
    expect(
      byId('rewards-rhythm-rule-full')?.querySelectorAll('li'),
    ).toHaveLength(rhythm.ruleFull.length);
  });

  it('«Статус»: a ring holding what remains beside two lines, the four tiers as steps under them, on one white card', async () => {
    const { byId, text, wallet } = await mount();
    const tier = wallet().tier;
    if (tier?.loadState !== LoadState.Ready)
      throw new Error('the status is not ready');
    const status = tier.data;
    const section = must(byId('rewards-status'));
    expect(text(section.querySelector('h3'))).toBe('Статус');
    const card = must(byId('rewards-tier'));
    expect(card.tagName).toBe('UI-CARD');
    expect(card.getAttribute('data-tone')).toBe('elevated');
    expect(card.getAttribute('data-padding')).toBe('comfortable');
    const ring = must(byId('rewards-tier-ring'));
    expect(ring.tagName).toBe('UI-GAUGE');
    expect(ring.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring.getAttribute('data-control-size')).toBe('large');
    expect(ring.getAttribute('aria-hidden')).toBe('true');
    expect(ring.classList).toContain('client-loyalty__ring');
    expect(text(ring.querySelector('.ui-gauge__current'))).toBe(
      must(status.remaining),
    );
    expect(ring.querySelector('.ui-gauge__current ui-icon')).toBeNull();
    const line1 = must(byId('rewards-tier-line'));
    expect(text(line1)).toBe(status.line1);
    expect(line1.getAttribute('data-font')).toBe('callout');
    expect(line1.getAttribute('data-weight')).toBe('semibold');
    const line2 = must(line1.nextElementSibling);
    expect(text(line2)).toBe(status.line2);
    expect(line2.getAttribute('data-font')).toBe('subheadline');
    expect(line2.getAttribute('data-foreground-style')).toBe('secondary');
    const steps = must(byId('rewards-tier-track'));
    expect(steps.getAttribute('data-gauge-style')).toBe('steps');
    expect(steps.getAttribute('aria-valuetext')).toBe(status.accessibleName);
    expect(
      [...steps.querySelectorAll('.ui-gauge__step-label')].map((label) =>
        text(label),
      ),
    ).toEqual(status.steps.marks.map((mark) => mark.label));
    // No capsule on the card: «Злато» is on the pass and under its node.
    expect(card.querySelector('.ui-badge')).toBeNull();
  });

  it('«Награди за точки»: a 2-up grid of static white tiles, within reach first, the one out of reach greyed with its gap in the capsule and its progress as a bar', async () => {
    const { byId, text, wallet } = await mount();
    const catalog = wallet().catalog;
    if (catalog?.loadState !== LoadState.Ready)
      throw new Error('the catalogue is not ready');
    const section = must(byId('rewards-catalog-module'));
    const heading = must(section.querySelector('h3'));
    expect(heading.id).toBe(`${PAGE_TITLE_ID}-catalog`);
    expect(text(heading)).toBe('Награди за точки');
    const grid = must(byId('rewards-catalog'));
    expect(grid.tagName).toBe('UI-GRID');
    expect(grid.getAttribute('role')).toBe('list');
    expect(grid.getAttribute('aria-label')).toBe(catalog.data.name);
    expect(grid.style.getPropertyValue('--ui-grid-columns')).toBe('2');
    expect(grid.getAttribute('data-spacing')).toBe('regular');
    const tiles = catalog.data.tiles;
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.map((tile) => tile.affordable)).toEqual(
      [...tiles.map((tile) => tile.affordable)].sort((a, b) =>
        a === b ? 0 : a ? -1 : 1,
      ),
    );
    for (const tile of tiles) {
      const card = must(byId(`rewards-catalog-${tile.rewardId}`));
      expect(card.tagName).toBe('UI-CARD');
      expect(card.getAttribute('data-tone')).toBe('elevated');
      expect(card.getAttribute('data-padding')).toBe('regular');
      expect(card.getAttribute('role')).toBe('listitem');
      expect(card.getAttribute('aria-label')).toBe(tile.accessibleName);
      expect(card.hasAttribute('data-affordable')).toBe(tile.affordable);
      expect(card.hasAttribute('data-interactive')).toBe(false);
      expect(text(card.querySelector('.ui-badge'))).toBe(
        tile.missing ?? tile.cost,
      );
      const face = must(card.querySelector('ui-avatar'));
      expect(face.getAttribute('data-control-size')).toBe('regular');
      if (tile.src === null) {
        expect(face.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
          'loyalty.reward',
        );
      }
      expect(text(card.querySelector('.client-loyalty__reward-title'))).toBe(
        tile.title,
      );
      const progress = byId(`rewards-catalog-${tile.rewardId}-progress`);
      expect(progress !== null).toBe(tile.progress !== null);
      if (progress !== null) {
        expect(progress.getAttribute('data-gauge-style')).toBe(
          'linearCapacity',
        );
        expect(progress.getAttribute('data-control-size')).toBe('small');
        expect(progress.getAttribute('aria-hidden')).toBe('true');
      }
    }
    // Information, not a control (ES-2): nothing to press, no chevron.
    expect(grid.querySelector('button, a')).toBeNull();
    expect(
      grid.querySelector('ui-icon[data-name="nav.disclosure"]'),
    ).toBeNull();
    expect(
      grid.querySelector('ui-icon[data-name="loyalty.locked"]'),
    ).toBeNull();
  });

  it('«Движение»: the newest events by month, «Всички ›» the small plain action inside the column, and the ledger page behind it', async () => {
    const { byId, text, wallet, emitted, click } = await mount();
    const activity = wallet().activity;
    if (activity?.loadState !== LoadState.Ready)
      throw new Error('the feed is not ready');
    const groups = activity.data;
    const section = must(byId('rewards-ledger'));
    const heading = must(section.querySelector('h3'));
    expect(heading.id).toBe(`${PAGE_TITLE_ID}-ledger`);
    expect(text(heading)).toBe('Движение');
    const all = must(byId<HTMLButtonElement>('rewards-ledger-all'));
    expect(all.hasAttribute('uisectionaction')).toBe(true);
    expect(all.getAttribute('data-button-style')).toBe('plain');
    expect(all.getAttribute('data-control-size')).toBe('small');
    expect(all.getAttribute('aria-label')).toBe('Движение: всички записи');
    expect(text(all)).toBe('Всички');
    expect(all.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'nav.disclosure',
    );
    const list = must(section.querySelector('lib-activity-list'));
    expect(list.querySelectorAll('h4')).toHaveLength(groups.length);
    expect(list.querySelector('h3')).toBeNull();
    expect(list.querySelectorAll('li')).toHaveLength(
      groups.reduce((sum, group) => sum + group.rows.length, 0),
    );
    expect(list.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(byId(`rewards-ledger-month-${must(groups[0]).key}`)).not.toBeNull();
    await click('rewards-ledger-all');
    expect(emitted.ledger).toBe(1);
  });

  it('lays the modules in the wallet’s order under headings without a glyph, each heading’s one action the small rung', async () => {
    const { all, headings } = await mount();
    expect(headings()).toEqual([
      'В портфейла',
      'Ритъм',
      'Статус',
      'Награди за точки',
      'Движение',
    ]);
    expect(
      all('section.client-loyalty__module').map((section) =>
        section.getAttribute('aria-labelledby'),
      ),
    ).toEqual(
      ['wallet', 'rhythm', 'status', 'catalog', 'ledger'].map(
        (section) => `${PAGE_TITLE_ID}-${section}`,
      ),
    );
    for (const header of all(
      'ui-section-header[data-header-prominence="increased"]',
    )) {
      expect(header.querySelector(':scope > ui-icon')).toBeNull();
      expect(header.querySelector(':scope > [uieyebrow]')).toBeNull();
    }
    const actions = all('[uisectionaction]');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.getAttribute('data-control-size')).toBe('small');
  });

  it('keeps the law — white elevated cards, no muted card, one slab — and spaces the page by its stylesheet', async () => {
    const { host } = await mount();
    expect(host.querySelectorAll('.ui-card[data-tone="muted"]')).toHaveLength(
      0,
    );
    expect(
      host.querySelectorAll('.ui-card[data-tone="elevated"]').length,
    ).toBeGreaterThanOrEqual(4);
    expect(host.querySelectorAll('.ui-card[data-tone="plain"]')).toHaveLength(
      0,
    );
    expect(cssRule('client-loyalty/client-loyalty.css', ':host')).toEqual(
      new Map([
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', 'var(--sys-space-loose)'],
      ]),
    );
    expect(
      cssRule('client-loyalty/client-loyalty.css', '.client-loyalty__head').get(
        'gap',
      ),
    ).toBe('var(--sys-space-comfortable)');
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__module',
      ).get('gap'),
    ).toBe('var(--sys-space-compact)');
    expect(
      cssRule('client-loyalty/client-loyalty.css', '.client-loyalty__anchor'),
    ).toEqual(
      new Map([['scroll-margin-block-start', 'var(--modal-sheet-clear-top)']]),
    );
    // A landing is not a control: no ring boxes the heading the focus
    // moves to (review 3; the editor's page container does the same).
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__anchor:focus-visible',
      ).get('outline'),
    ).toBe('none');
    // A reward tile: the title keeps two lines, balanced; the bar of a
    // reward out of reach stands right under it, never on the foot (review 3).
    const rewardTitle = cssRule(
      'client-loyalty/client-loyalty.css',
      '.client-loyalty__reward-title',
    );
    expect(rewardTitle.get('min-block-size')).toBe('2lh');
    expect(rewardTitle.get('text-wrap')).toBe('balance');
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward-progress',
      ).get('margin-block-start'),
    ).toBe('0');
    // A ring that stands alone round a figure takes the heavier stroke (§3.7).
    expect(
      cssRule('client-loyalty/client-loyalty.css', '.client-loyalty__ring').get(
        '--ui-gauge-stroke',
      ),
    ).toBe('calc(var(--sys-space-unit) * 1.25)');
    // The head wraps the capsule under the face where the two do not share
    // the line (a 330 phone), and the capsule is never shrunk into two
    // lines («още» over «29 т.», review 3, round 2).
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward-head',
      ).get('flex-wrap'),
    ).toBe('wrap');
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward-mark',
      ).get('flex'),
    ).toBe('none');
    // A narrow tile (a 330 phone) stacks every head alike — the capsule
    // under the face — so the titles of a row start on one line.
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward',
      ).get('container'),
    ).toBe('reward-tile / inline-size');
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward > .client-loyalty__reward-head',
      ),
    ).toEqual(
      new Map([
        ['flex-direction', 'column'],
        ['justify-content', 'flex-start'],
      ]),
    );
    expect(
      host
        .querySelector('.client-loyalty__reward .ui-badge')
        ?.classList.contains('client-loyalty__reward-mark'),
    ).toBe(true);
    // The reward face tints through the avatar's INK hook; its diameter hook is never touched.
    const face = cssRule(
      'client-loyalty/client-loyalty.css',
      '.client-loyalty__reward-face',
    );
    expect(face.get('--ui-avatar-ink')).toBe('var(--sys-color-accent)');
    expect(face.has('--ui-avatar-disc')).toBe(false);
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        '.client-loyalty__reward:not([data-affordable]) .client-loyalty__reward-face',
      ),
    ).toEqual(
      new Map([
        ['filter', 'grayscale(1)'],
        ['opacity', '0.45'],
      ]),
    );
  });

  it('in the ≥ 761 dialog lays the discs 2 × 2 beside the pass, the holdings 2-up and the rewards three across', async () => {
    stubDialogWidth(true);
    const { host, byId } = await mount();
    expect(host.hasAttribute('data-wide')).toBe(true);
    expect(
      byId('rewards-actions')?.style.getPropertyValue(
        '--ui-quick-actions-columns',
      ),
    ).toBe('2');
    expect(byId('rewards-holdings')?.getAttribute('data-columns')).toBe('2');
    expect(
      byId('rewards-catalog')?.style.getPropertyValue('--ui-grid-columns'),
    ).toBe('3');
    expect(
      cssRule(
        'client-loyalty/client-loyalty.css',
        ':host([data-wide]) .client-loyalty__head',
      ).get('grid-template-columns'),
    ).toBe('22.1875rem minmax(0, 1fr)');
  });
});

describe('lib-client-loyalty — anchors', () => {
  it('lands the pushing card’s section under the bar and focuses its heading, once', async () => {
    const scroll = stubScrollIntoView();
    const { byId, render } = await mount({ anchor: 'stamps' });
    const heading = must(byId('rewards-wallet')?.querySelector('h3'));
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(heading);
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(heading.classList).toContain('client-loyalty__anchor');
    // A later render never takes the focus back.
    const disc = must(byId<HTMLButtonElement>('rewards-action-code'));
    disc.focus();
    await render();
    expect(document.activeElement).toBe(disc);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('waits for the holdings above before landing on the status, and for the status before the catalogue', async () => {
    stubScrollIntoView();
    const vouchers = heldVouchers();
    const held = await mount({ anchor: 'status', rig: { vouchers } });
    const status = must(held.byId('rewards-status')?.querySelector('h3'));
    expect(held.byId('rewards-wallet-skeleton')).not.toBeNull();
    expect(document.activeElement).not.toBe(status);
    vouchers.answer();
    await held.render();
    expect(held.byId('rewards-wallet-skeleton')).toBeNull();
    expect(document.activeElement).toBe(status);

    const catalog = heldCatalogPorts();
    const waiting = await mount({ anchor: 'catalog', rig: { catalog } });
    const heading = must(
      waiting.byId('rewards-catalog-module')?.querySelector('h3'),
    );
    expect(waiting.byId('rewards-catalog-skeleton')).not.toBeNull();
    expect(document.activeElement).not.toBe(heading);
    catalog.answer();
    await waiting.render();
    expect(waiting.byId('rewards-catalog-skeleton')).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it('leaves the focus where the sheet put it when the anchored section is absent', async () => {
    stubScrollIntoView();
    const { byId } = await mount({
      anchor: 'rhythm',
      rig: { flags: { ...ALL_LOYALTY_FLAGS, 'loyalty.streaks': false } },
    });
    expect(byId('rewards-rhythm')).toBeNull();
    expect(document.activeElement?.tagName).not.toBe('H3');
  });
});

describe('lib-client-loyalty — its states', () => {
  it('loading · stands the pass as one block of its shape, four discs, two tickets and a block under each later heading until the account answers', async () => {
    const profiles = heldProfilePortsOf();
    const { byId, text, render } = await mount({ rig: { profiles } });
    const skeleton = must(byId('rewards-skeleton'));
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(
      skeleton.querySelectorAll('.client-loyalty__pass-skeleton'),
    ).toHaveLength(1);
    expect(
      skeleton.querySelectorAll('.client-loyalty__disc-skeleton'),
    ).toHaveLength(4);
    expect(
      skeleton.querySelectorAll('.client-loyalty__tickets-skeleton > *'),
    ).toHaveLength(2);
    expect(skeleton.querySelectorAll('ui-list-row')).toHaveLength(3);
    expect(skeleton.querySelectorAll('ui-skeleton').length).toBeGreaterThan(10);
    expect(text(byId('rewards-title'))).toBe('Лоялност');
    expect(byId('rewards-pass')).toBeNull();
    expect(byId('rewards-actions')).toBeNull();
    profiles.answer();
    await render();
    expect(byId('rewards-skeleton')).toBeNull();
    expect(byId('rewards-pass')).not.toBeNull();
  });

  it('failed · says once when the account did not load, and reads it again on «Опитай пак»', async () => {
    const loyalty = loyaltyPortsOf().failWith();
    const { byId, text, render } = await mount({ rig: { loyalty } });
    const notice = must(byId('rewards-failed'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(notice.getAttribute('aria-label')).toBe('Лоялността не се зареди.');
    expect(byId('rewards-pass')).toBeNull();
    expect(byId('rewards-skeleton')).toBeNull();
    const retry = must(byId<HTMLButtonElement>('rewards-retry'));
    expect(text(retry)).toBe('Опитай пак');
    loyalty.recover();
    retry.click();
    await render();
    expect(byId('rewards-failed')).toBeNull();
    expect(byId('rewards-pass')).not.toBeNull();
  });

  it('failed vouchers · keeps «В портфейла» over one retry and the rest of the page whole, and reads them again', async () => {
    const vouchers = voucherPortsOf().failWith();
    const { byId, text, render, wallet } = await mount({ rig: { vouchers } });
    expect(text(byId('rewards-wallet')?.querySelector('h3'))).toBe(
      'В портфейла',
    );
    const notice = must(byId('rewards-failed-wallet'));
    expect(notice.getAttribute('aria-label')).toBe('Ваучерите не се заредиха.');
    expect(byId('rewards-holdings')).toBeNull();
    expect(byId('rewards-wallet-count')).toBeNull();
    for (const id of [
      'rewards-pass',
      'rewards-rhythm',
      'rewards-tier',
      'rewards-catalog',
      'rewards-ledger',
    ]) {
      expect(byId(id), id).not.toBeNull();
    }
    vouchers.recover();
    must(byId<HTMLButtonElement>('rewards-retry-wallet')).click();
    await render();
    expect(byId('rewards-failed-wallet')).toBeNull();
    const held = wallet().holdings;
    expect(held.loadState).toBe(LoadState.Ready);
    expect(byId('rewards-holdings')?.children).toHaveLength(
      held.loadState === LoadState.Ready ? held.data.length : -1,
    );
    expect(
      byId('rewards-holdings')?.querySelector(
        '[data-testid^="rewards-voucher-"]',
      ),
    ).not.toBeNull();
  });

  it('failed catalogue · keeps «Статус» and «Награди за точки» over their retries, the «Награди» disc with somewhere to land', async () => {
    const catalog = catalogPortsOf().failWith();
    const { byId, text, render, wallet } = await mount({ rig: { catalog } });
    expect(byId('rewards-failed-tier')).not.toBeNull();
    expect(byId('rewards-failed-catalog')).not.toBeNull();
    expect(byId('rewards-retry-catalog')).not.toBeNull();
    expect(text(byId('rewards-status')?.querySelector('h3'))).toBe('Статус');
    expect(byId('rewards-action-catalog')).not.toBeNull();
    expect(byId('rewards-tier')).toBeNull();
    expect(byId('rewards-catalog')).toBeNull();
    // The plate rides the catalogue: it says what the model says.
    expect(byId('rewards-pass-tier') !== null).toBe(
      wallet().pass.tier !== null,
    );
    catalog.recover();
    must(byId<HTMLButtonElement>('rewards-retry-catalog')).click();
    await render();
    expect(byId('rewards-failed-catalog')).toBeNull();
    expect(byId('rewards-failed-tier')).toBeNull();
    expect(byId('rewards-tier')).not.toBeNull();
    expect(byId('rewards-catalog')).not.toBeNull();
    expect(text(byId('rewards-pass-tier'))).toBe(must(wallet().pass.tier));
  });

  it('failed activity · keeps «Движение» and its «Всички» over one retry, and reads the feed again', async () => {
    const activity = journalPortsOf().failWith();
    const { byId, text, render } = await mount({ rig: { activity } });
    const section = must(byId('rewards-ledger'));
    expect(text(section.querySelector('h3'))).toBe('Движение');
    expect(byId('rewards-ledger-all')).not.toBeNull();
    expect(byId('rewards-failed-ledger')?.getAttribute('aria-label')).toBe(
      'Движението не се зареди.',
    );
    expect(section.querySelector('lib-activity-list')).toBeNull();
    activity.recover();
    must(byId<HTMLButtonElement>('rewards-retry-ledger')).click();
    await render();
    expect(byId('rewards-failed-ledger')).toBeNull();
    expect(section.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('a feed on its way · three placeholder rows under «Движение», the rest of the page drawn', async () => {
    const activity = journalPortsOf();
    vi.spyOn(activity, 'pageClientJournal').mockReturnValue(
      new Promise(() => undefined),
    );
    const { byId } = await mount({ rig: { activity } });
    const skeleton = must(byId('rewards-ledger-skeleton'));
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.querySelectorAll('ui-list-row')).toHaveLength(3);
    expect(byId('rewards-pass')).not.toBeNull();
    expect(byId('rewards-holdings')).not.toBeNull();
  });

  it('paused · freezes the pass and says why, keeps the voucher and the stamps, drops the ticket and the two verbs that write; nothing is zeroed', async () => {
    const profiles = profilePortsOf([georgiUser(pausedUntilOctober())]);
    const { byId, text, wallet } = await mount({ rig: { profiles } });
    const model = wallet();
    expect(model.frozen).toBe(true);
    const notice = must(byId('rewards-frozen'));
    expect(text(notice)).toBe('Замразено, докато записването е спряно');
    expect(notice.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'loyalty.freeze',
    );
    expect(byId('rewards-pass')?.hasAttribute('data-frozen')).toBe(true);
    expect(text(byId('rewards-pass-state'))).toBe('Замразено');
    expect(text(byId('rewards-pass-figure'))).toContain(model.pass.figure);
    expect(byId('rewards-action-use')).toBeNull();
    expect(byId('rewards-action-code')).toBeNull();
    expect(byId('rewards-action-catalog')).not.toBeNull();
    const holdings = must(byId('rewards-holdings'));
    expect(
      holdings.querySelector('[data-testid^="rewards-ready-"]'),
    ).toBeNull();
    expect(
      holdings.querySelector('[data-testid^="rewards-voucher-"]'),
    ).not.toBeNull();
    expect(
      holdings.querySelector('[data-testid^="rewards-stamp-"]'),
    ).not.toBeNull();
    expect(byId('rewards-rhythm')?.hasAttribute('data-frozen')).toBe(true);
    expect(byId('rewards-rhythm-track')?.hasAttribute('data-frozen')).toBe(
      true,
    );
  });

  it('offline · says so under the bar, keeps the saved values, and takes away «Използвай», «Код» and the ticket (nothing that writes)', async () => {
    const { byId, text, render } = await mount();
    expect(byId('rewards-action-use')).not.toBeNull();
    window.dispatchEvent(new Event('offline'));
    await render();
    expect(text(byId('rewards-offline'))).toBe('Без връзка · запазени данни');
    expect(byId('rewards-skeleton')).toBeNull();
    expect(byId('rewards-pass')).not.toBeNull();
    expect(byId('rewards-action-use')).toBeNull();
    expect(byId('rewards-action-code')).toBeNull();
    expect(byId('rewards-action-catalog')).not.toBeNull();
    expect(byId('rewards-action-history')).not.toBeNull();
    // The store hands the presenter no grant offline (the built rule: a
    // ticket could not be written), so none is drawn; the voucher and the
    // stamps stay.
    const holdings = must(byId('rewards-holdings'));
    expect(
      holdings.querySelector('[data-testid^="rewards-ready-"]'),
    ).toBeNull();
    expect(
      holdings.querySelector('[data-testid^="rewards-voucher-"]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event('online'));
    await render();
    expect(byId('rewards-offline')).toBeNull();
    expect(byId('rewards-action-use')).not.toBeNull();
    expect(
      byId('rewards-holdings')?.querySelector(
        '[data-testid^="rewards-ready-"]',
      ),
    ).not.toBeNull();
  });

  it('a gone visit · offers nothing that writes, the ticket included (using one could not be written); a finished visit stays correctable', async () => {
    const gone = await mount({ context: georgiContext({ gone: true }) });
    expect(gone.byId('rewards-action-use')).toBeNull();
    expect(gone.byId('rewards-action-code')).toBeNull();
    expect(
      gone
        .byId('rewards-holdings')
        ?.querySelector('[data-testid^="rewards-ready-"]'),
    ).toBeNull();
    expect(
      gone
        .byId('rewards-holdings')
        ?.querySelector('[data-testid^="rewards-voucher-"]'),
    ).not.toBeNull();

    const finished = await mount({ context: georgiContext() });
    expect(finished.byId('rewards-action-use')).not.toBeNull();
    expect(finished.byId('rewards-action-code')).not.toBeNull();
    expect(
      finished
        .byId('rewards-holdings')
        ?.querySelector('[data-testid^="rewards-ready-"]'),
    ).not.toBeNull();
  });

  it('a party member · his own pass, vouchers, rhythm, status, rewards and feed; no ticket and no verb that spends on this visit', async () => {
    const { byId } = await mount({
      context: georgiContext({ isOwner: false }),
    });
    expect(byId('rewards-pass')).not.toBeNull();
    expect(byId('rewards-action-use')).toBeNull();
    expect(byId('rewards-action-code')).toBeNull();
    expect(byId('rewards-action-catalog')).not.toBeNull();
    expect(byId('rewards-action-history')).not.toBeNull();
    const holdings = must(byId('rewards-holdings'));
    expect(
      holdings.querySelector('[data-testid^="rewards-ready-"]'),
    ).toBeNull();
    expect(
      holdings.querySelector('[data-testid^="rewards-voucher-"]'),
    ).not.toBeNull();
    for (const id of [
      'rewards-rhythm',
      'rewards-tier',
      'rewards-catalog',
      'rewards-ledger',
    ]) {
      expect(byId(id), id).not.toBeNull();
    }
  });

  it('flags · points off: the pass counts visits, no «Награди», no «История», no catalogue, no feed; tiers off: no plate, no «Статус»; achievements off: no stamps; streaks off: no «Ритъм»', async () => {
    const pointsOff = await mount({
      rig: { flags: { ...ALL_LOYALTY_FLAGS, 'loyalty.points': false } },
    });
    const pass = pointsOff.wallet().pass;
    expect(pointsOff.text(pointsOff.byId('rewards-pass-figure'))).toBe(
      pass.figure,
    );
    expect(
      pointsOff.text(pointsOff.host.querySelector('.ui-pass-card__unit')),
    ).toBe(pass.unit);
    expect(pass.unit).not.toBe('точки');
    expect(pointsOff.byId('rewards-action-catalog')).toBeNull();
    expect(pointsOff.byId('rewards-action-history')).toBeNull();
    expect(pointsOff.byId('rewards-catalog-module')).toBeNull();
    expect(pointsOff.byId('rewards-ledger')).toBeNull();
    expect(pointsOff.headings()).toEqual(['В портфейла', 'Ритъм', 'Статус']);

    const tiersOff = await mount({
      rig: { flags: { ...ALL_LOYALTY_FLAGS, 'loyalty.tiers': false } },
    });
    expect(tiersOff.byId('rewards-pass-tier')).toBeNull();
    expect(tiersOff.byId('rewards-status')).toBeNull();

    const achievementsOff = await mount({
      rig: { flags: { ...ALL_LOYALTY_FLAGS, 'loyalty.achievements': false } },
    });
    expect(
      achievementsOff
        .byId('rewards-holdings')
        ?.querySelector('[data-testid^="rewards-stamp-"]'),
    ).toBeNull();

    const streaksOff = await mount({
      rig: { flags: { ...ALL_LOYALTY_FLAGS, 'loyalty.streaks': false } },
    });
    expect(streaksOff.byId('rewards-rhythm')).toBeNull();
    expect(streaksOff.headings()).not.toContain('Ритъм');
  });

  it('never reached · with every loyalty flag off, or for a guest, the page draws nothing under its hidden name', async () => {
    const production = await mount({
      rig: { flags: { 'client.profile': true } },
    });
    expect(production.store.wallet()).toBeNull();
    expect(production.host.children).toHaveLength(1);
    expect(production.byId('rewards-title')).not.toBeNull();

    const guest = await mount({
      subject: GUEST,
      context: georgiContext({ grants: [] }),
    });
    expect(guest.store.wallet()).toBeNull();
    expect(guest.host.querySelector('ui-pass-card')).toBeNull();
  });

  it('Мартин, in the chair · his own pass and discs, no ticket (he holds none), his rhythm’s coaching', async () => {
    const { byId, text, wallet } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    const model = wallet();
    expect(text(byId('rewards-pass-holder'))).toBe('Мартин Илиев');
    expect(text(byId('rewards-pass-figure'))).toContain(model.pass.figure);
    expect(byId('rewards-action-use')).toBeNull();
    expect(byId('rewards-action-code')).not.toBeNull();
    expect(
      byId('rewards-holdings')?.querySelector(
        '[data-testid^="rewards-ready-"]',
      ),
    ).toBeNull();
    expect(text(byId('rewards-rhythm-state'))).toBe(
      must(model.rhythm).stateLine,
    );
  });
});
