import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { must } from '../../testing/client-card.fixtures';
import {
  STAMP_CARD,
  VOUCHER,
  WALLET_HOLDINGS,
} from '../../testing/client-pages.vm-fixtures';
import { cssRule } from '../../testing/css-rule';
import { WalletHolding, type WalletHoldingVm } from '../client-pages.vm';
import {
  WalletHoldings,
  type WalletHoldingsColumns,
  type WalletHoldingsWords,
} from './wallet-holdings';

const WORDS: WalletHoldingsWords = {
  stampCard: 'Карта с печати',
  remove: 'Премахни',
};

@Component({
  imports: [WalletHoldings],
  template: `<lib-wallet-holdings
    [holdings]="holdings()"
    [words]="words"
    [columns]="columns()"
    (removeReward)="removed.push($event)"
  />`,
})
class Host {
  readonly holdings = signal<readonly WalletHoldingVm[]>(
    WALLET_HOLDINGS.georgi,
  );
  readonly words = WORDS;
  readonly columns = signal<WalletHoldingsColumns>(1);
  readonly removed: string[] = [];
}

function mount(
  holdings: readonly WalletHoldingVm[] = WALLET_HOLDINGS.georgi,
  columns: WalletHoldingsColumns = 1,
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.holdings.set(holdings);
  fixture.componentInstance.columns.set(columns);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const list = must(host.querySelector<HTMLElement>('lib-wallet-holdings'));
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, list, byId, text };
}

describe('lib-wallet-holdings — every thing held, a ticket on white paper', () => {
  it('stacks the holdings in the wallet’s order: the voucher, the ticket, the stamp card', () => {
    const { list } = mount();
    expect(
      [...list.children].map((child) => child.getAttribute('data-testid')),
    ).toEqual([
      'rewards-voucher-voucher-1',
      'rewards-ready-grant-haircut',
      `rewards-stamp-${STAMP_CARD.ruleId}`,
    ]);
    expect(list.getAttribute('data-columns')).toBe('1');
  });

  it('draws a gift voucher as a static ticket: the balance as its accent figure, one chip for what it was issued for and how long it is good', () => {
    const { byId, text } = mount();
    const voucher = must(byId('rewards-voucher-voucher-1'));
    expect(voucher.tagName).toBe('ARTICLE');
    expect(voucher.classList).toContain('ui-coupon-card');
    expect(voucher.hasAttribute('data-valued')).toBe(true);
    expect(text(voucher.querySelector('.ui-coupon-card__value'))).toBe(
      '25,00 €',
    );
    expect(text(voucher.querySelector('.ui-coupon-card__title'))).toBe(
      'Ваучер за подарък',
    );
    expect(text(voucher.querySelector('.ui-coupon-card__detail'))).toBe(
      'от 50,00 € · до 31.12',
    );
    expect(
      voucher.querySelector('[uicouponglyph]')?.getAttribute('data-name'),
    ).toBe('promo.voucher');
    expect(voucher.getAttribute('aria-label')).toBe(
      VOUCHER.partial.accessibleName,
    );
    // Nothing to press: no call, no action, no button.
    expect(voucher.querySelector('.ui-coupon-card__action')).toBeNull();
    expect(voucher.querySelector('[uicouponaction]')).toBeNull();
    expect(voucher.querySelector('button')).toBeNull();
  });

  it('draws a held reward as a static ticket with its validity in the chip and no call: the disc under the pass is the verb', () => {
    const { byId, text } = mount();
    const ticket = must(byId('rewards-ready-grant-haircut'));
    expect(ticket.tagName).toBe('ARTICLE');
    expect(ticket.hasAttribute('data-applied')).toBe(false);
    // Static: no landing on it (no tabindex, not an origin).
    expect(ticket.hasAttribute('tabindex')).toBe(false);
    expect(ticket.classList.contains('wallet-holdings__origin')).toBe(false);
    expect(text(ticket.querySelector('.ui-coupon-card__title'))).toBe(
      WALLET_HOLDINGS.georgi[1]?.walletHolding === WalletHolding.Ticket
        ? WALLET_HOLDINGS.georgi[1].ticket.title
        : '',
    );
    expect(
      ticket.querySelector('[uicouponglyph]')?.getAttribute('data-name'),
    ).toBe('promo.coupon');
    expect(ticket.querySelector('.ui-coupon-card__action')).toBeNull();
    expect(ticket.querySelector('[uicouponaction]')).toBeNull();
    expect(ticket.querySelector('button')).toBeNull();
    // The name is the view model's, bound as it came (the presenter words
    // «Награда: …, важи до …»; the body never re-words a ticket).
    expect(ticket.getAttribute('aria-label')).toBe(
      WALLET_HOLDINGS.georgi[1]?.walletHolding === WalletHolding.Ticket
        ? WALLET_HOLDINGS.georgi[1].ticket.accessibleName
        : '',
    );
  });

  it('keeps an applied ticket as the discount page’s own card, with its real «Премахни»', () => {
    const { fixture, byId, text } = mount(WALLET_HOLDINGS.vouchers);
    const applied = WALLET_HOLDINGS.vouchers[2];
    if (applied?.walletHolding !== WalletHolding.Ticket)
      throw new Error('the fixture moved');
    const ticket = must(byId(`rewards-ready-${applied.ticket.grantId}`));
    expect(ticket.hasAttribute('data-applied')).toBe(true);
    expect(ticket.getAttribute('tabindex')).toBe('-1');
    // ‹ from the discount page lands on the stamped ticket: clear of the
    // chrome, and without the DS's inset ring — a landing is not a control
    // (review 3, round 2: the ring boxed the glance's birthday card). The
    // held ticket is static: no landing, no class.
    expect(ticket.classList.contains('wallet-holdings__origin')).toBe(true);
    expect(
      cssRule(
        'wallet-holdings/wallet-holdings.css',
        '.wallet-holdings__origin',
      ).get('scroll-margin-block'),
    ).toBe('var(--modal-sheet-origin-margin)');
    expect(
      cssRule(
        'wallet-holdings/wallet-holdings.css',
        'article.wallet-holdings__origin:focus-visible',
      ).get('outline'),
    ).toBe('none');
    expect(
      cssRule(
        'wallet-holdings/wallet-holdings.css',
        'article.wallet-holdings__origin:focus-visible::before',
      ).get('box-shadow'),
    ).toBe('none');
    expect(
      ticket.querySelector('[uicouponbadge]')?.getAttribute('data-name'),
    ).toBe('checklist.done');
    const remove = must(
      byId<HTMLButtonElement>(`rewards-ready-${applied.ticket.grantId}-remove`),
    );
    expect(remove.hasAttribute('uicouponaction')).toBe(true);
    expect(remove.getAttribute('data-button-style')).toBe('plain');
    expect(remove.getAttribute('data-control-size')).toBe('small');
    expect(text(remove)).toBe('Премахни');
    expect(remove.getAttribute('aria-label')).toBe(applied.ticket.removeName);
    remove.click();
    expect(fixture.componentInstance.removed).toEqual([applied.ticket.grantId]);
    // Two vouchers: the one that never expires keeps its issue value alone.
    expect(
      text(
        byId('rewards-voucher-voucher-2')?.querySelector(
          '.ui-coupon-card__detail',
        ),
      ),
    ).toBe('от 30,00 €');
  });

  it('draws a stamp card as a white card whose stamps are the count: no ring, no «3 от 10», no «още 7»', () => {
    const { byId, text } = mount();
    const card = must(byId(`rewards-stamp-${STAMP_CARD.ruleId}`));
    expect(card.tagName).toBe('UI-CARD');
    expect(card.getAttribute('data-tone')).toBe('elevated');
    const [title, line] = card.querySelectorAll('p');
    expect(text(title)).toBe('Карта с печати');
    expect(title?.getAttribute('data-font')).toBe('callout');
    expect(title?.getAttribute('data-weight')).toBe('semibold');
    expect(text(line)).toBe('10 печата за безплатно подстригване');
    expect(line?.getAttribute('data-font')).toBe('subheadline');
    expect(line?.getAttribute('data-foreground-style')).toBe('secondary');
    const gauge = must(card.querySelector('ui-gauge'));
    expect(gauge.getAttribute('data-gauge-style')).toBe('discreteCapacity');
    // WC3: the DS's `large` rung (FD-4) — stamps at 44 edge to edge, a
    // stamp printing the check, an empty slot its ordinal, the tenth the
    // reward's glyph. `regular` is the glance's half tile, 24 pt dots
    // (review 3, round 2: the live wallet still drew them).
    expect(gauge.getAttribute('data-control-size')).toBe('large');
    expect(gauge.querySelectorAll('.ui-gauge__slot')).toHaveLength(10);
    expect(gauge.querySelectorAll('.ui-gauge__slot[data-filled]')).toHaveLength(
      3,
    );
    expect(gauge.querySelectorAll('.ui-gauge__check')).toHaveLength(3);
    expect(
      [...gauge.querySelectorAll('.ui-gauge__numeral')].map((n) => text(n)),
    ).toEqual(['4', '5', '6', '7', '8', '9']);
    const reward = must(gauge.querySelector('.ui-gauge__slot[data-reward]'));
    expect(reward.querySelector('.ui-gauge__numeral')).toBeNull();
    expect(reward.querySelector('.ui-gauge__check')).toBeNull();
    expect(
      reward.querySelector('.ui-gauge__reward')?.getAttribute('data-name'),
    ).toBe('loyalty.reward');
    expect(gauge.getAttribute('aria-valuetext')).toBe(
      STAMP_CARD.gauge.valueText,
    );
    // One fact, once: the stamps count themselves.
    expect(text(card)).not.toContain('3 от 10');
    expect(text(card)).not.toContain('Още');
    expect(card.querySelector('.ui-gauge__ring')).toBeNull();
  });

  it('draws nothing for nothing held (the host words the empty wallet)', () => {
    const { list } = mount(WALLET_HOLDINGS.empty);
    expect(list.children).toHaveLength(0);
  });

  it('lays two holdings side by side in the wide dialog — each its own height, never stretched to its neighbour’s — one under the other on a phone', () => {
    const { list } = mount(WALLET_HOLDINGS.georgi, 2);
    expect(list.getAttribute('data-columns')).toBe('2');
    expect(
      cssRule('wallet-holdings/wallet-holdings.css', ':host').get(
        'grid-template-columns',
      ),
    ).toBe('minmax(0, 1fr)');
    // A ticket without conditions beside a voucher with its foot kept its
    // own height only once the row stopped stretching (review 3, round 2).
    expect(
      cssRule(
        'wallet-holdings/wallet-holdings.css',
        ":host([data-columns='2'])",
      ),
    ).toEqual(
      new Map([
        ['grid-template-columns', 'repeat(2, minmax(0, 1fr))'],
        ['align-items', 'start'],
      ]),
    );
    expect(
      cssRule('wallet-holdings/wallet-holdings.css', ':host').get('gap'),
    ).toBe('var(--sys-space-regular)');
  });
});
