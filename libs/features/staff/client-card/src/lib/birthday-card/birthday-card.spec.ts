import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ClientCardStore } from '../client-card.store';
import { cardRuntimeProviders } from '../../testing/achievements-pages.rig';
import type { BirthdayVm } from '../client-pages.vm';
import { BIRTHDAY } from '../../testing/client-pages.vm-fixtures';
import { catalogueOf, must } from '../../testing/client-card.fixtures';
import { BirthdayCard } from './birthday-card';

/*
 * THE DRAWING of `lib-birthday-card` (client-card-revision-3 §2.1.2,
 * §3.12): a hand-built model in, the band and the ticket out. The three
 * states and the quiet variant are the fixtures'; what each one is made of
 * is pinned here, and the law's one rule a page body cannot see from
 * outside — ONE orange slab — is counted on every state.
 */

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg'));
  }
}

@Component({
  imports: [BirthdayCard],
  template: `<lib-birthday-card
    [vm]="vm()"
    (useGift)="used.push($event)"
    (removeGift)="removed.push($event)"
  />`,
})
class Host {
  readonly vm = signal<BirthdayVm>(BIRTHDAY.gift);
  readonly used: string[] = [];
  readonly removed: string[] = [];
}

/** Lets the catalogue load and every render settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(vm: BirthdayVm) {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      ClientCardStore,
      ...cardRuntimeProviders(),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
    ],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const render = async () => {
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  };
  return { fixture, host, byId, text, render, out: fixture.componentInstance };
}

const CSS = readFileSync(resolve(__dirname, 'birthday-card.css'), 'utf8');

describe('lib-birthday-card — (a) today, the gift held', () => {
  it('is ONE ticket whose head is the solid band and whose body is the gift, named by one sentence', async () => {
    const { byId, text } = await mount(BIRTHDAY.gift);
    const card = must(byId('client-birthday'));
    expect(card.tagName).toBe('LIB-BIRTHDAY-CARD');
    expect(card.getAttribute('data-kind')).toBe('today');
    expect(card.getAttribute('data-gift')).toBe('ready');

    const ticket = must(byId<HTMLButtonElement>('client-birthday-gift'));
    expect(ticket.tagName).toBe('BUTTON');
    expect(ticket.type).toBe('button');
    expect(ticket.classList.contains('ui-coupon-card')).toBe(true);
    expect(ticket.hasAttribute('data-interactive')).toBe(true);
    // The ticket holds a band: the DS moves the tear to the seam.
    expect(ticket.hasAttribute('data-occasion')).toBe(true);
    expect(ticket.hasAttribute('data-valued')).toBe(true);
    expect(ticket.getAttribute('aria-label')).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
    );

    // The band is the ticket's FIRST child, the cake on its disc.
    const band = must(byId('client-birthday-band'));
    expect(band.tagName).toBe('UI-OCCASION-BAND');
    expect(band.parentElement).toBe(ticket);
    expect(text(band.querySelector('.ui-occasion-band__title'))).toBe(
      'Рожден ден · 34 г.',
    );
    expect(
      band.querySelector('.ui-occasion-band__glyph ui-icon'),
    ).not.toBeNull();
    // The band is inside the ticket, so it carries no role of its own.
    expect(band.hasAttribute('role')).toBe(false);

    // The body: the figure, the label, the chip.
    expect(text(ticket.querySelector('.ui-coupon-card__value'))).toBe('−20 %');
    expect(text(ticket.querySelector('.ui-coupon-card__title'))).toBe(
      'Подарък от салона',
    );
    expect(text(ticket.querySelector('.ui-coupon-card__detail'))).toBe(
      'до 28.10',
    );
    // With a band the body has no glyph disc of its own (D4-7).
    expect(ticket.querySelector('[uicouponglyph]')).toBeNull();
  });

  it('wears the decorative pill every ticket wears, never the written call', async () => {
    const { byId, text } = await mount(BIRTHDAY.gift);
    const ticket = must(byId('client-birthday-gift'));
    const pill = must(ticket.querySelector('[uicouponaction]'));
    expect(pill.tagName).toBe('SPAN');
    expect(pill.classList.contains('ui-button')).toBe(true);
    expect(pill.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(pill.getAttribute('data-control-size')).toBe('small');
    expect(pill.getAttribute('aria-hidden')).toBe('true');
    expect(text(pill)).toBe('Използвай');
    // `uiAction` (the written call) is deprecated: nothing projects it.
    expect(ticket.querySelector('.ui-coupon-card__action')).toBeNull();
  });

  it('a tap on the ticket uses the gift: the grant it carries', async () => {
    const { byId, out, render } = await mount(BIRTHDAY.gift);
    must(byId<HTMLButtonElement>('client-birthday-gift')).click();
    await render();
    expect(out.used).toEqual(['grant-birthday-2026']);
    expect(out.removed).toEqual([]);
    expect(byId('client-birthday-gift-remove')).toBeNull();
  });
});

describe('lib-birthday-card — (a′) the gift on this visit’s bill', () => {
  it('keeps the band and stamps the body: the check, a real «Премахни» where the pill stood', async () => {
    const { byId, text, out, render } = await mount(BIRTHDAY.giftApplied);
    expect(byId('client-birthday')?.getAttribute('data-gift')).toBe('applied');
    const ticket = must(byId('client-birthday-gift'));
    expect(ticket.tagName).toBe('ARTICLE');
    expect(ticket.hasAttribute('data-applied')).toBe(true);
    expect(ticket.getAttribute('tabindex')).toBe('-1');
    expect(ticket.classList.contains('birthday-card__origin')).toBe(true);
    expect(ticket.getAttribute('aria-label')).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, с това посещение',
    );
    expect(byId('client-birthday-band')?.parentElement).toBe(ticket);
    expect(ticket.querySelector('[uicouponbadge]')).not.toBeNull();
    expect(ticket.querySelector('span[uicouponaction]')).toBeNull();

    const remove = must(byId<HTMLButtonElement>('client-birthday-gift-remove'));
    expect(remove.tagName).toBe('BUTTON');
    expect(remove.type).toBe('button');
    expect(remove.hasAttribute('uicouponaction')).toBe(true);
    expect(remove.getAttribute('data-button-style')).toBe('plain');
    expect(remove.getAttribute('data-control-size')).toBe('small');
    expect(remove.getAttribute('aria-label')).toBe(
      'Премахни отстъпката: Рожден ден',
    );
    expect(text(remove)).toBe('Премахни');
    remove.click();
    await render();
    expect(out.removed).toEqual(['grant-birthday-2026']);
    expect(out.used).toEqual([]);
  });
});

describe('lib-birthday-card — (b) today, nothing to use', () => {
  it('is the band alone: a statement with role note, no ticket, no pill', async () => {
    const { byId, host, text } = await mount(BIRTHDAY.bandOnly);
    expect(byId('client-birthday')?.getAttribute('data-gift')).toBeNull();
    const band = must(byId('client-birthday-band'));
    expect(band.tagName).toBe('UI-OCCASION-BAND');
    expect(band.getAttribute('role')).toBe('note');
    expect(band.getAttribute('aria-label')).toBe(
      'Рожден ден днес, навършва 34 години',
    );
    expect(text(band.querySelector('.ui-occasion-band__title'))).toBe(
      'Рожден ден · 34 г.',
    );
    expect(
      band.querySelector('.ui-occasion-band__glyph ui-icon'),
    ).not.toBeNull();
    expect(host.querySelector('.ui-coupon-card')).toBeNull();
    expect(host.querySelector('.ui-button')).toBeNull();
    expect(byId('client-birthday-gift')).toBeNull();
  });

  it('without a year of birth the band says the day alone', async () => {
    const { byId, text } = await mount(BIRTHDAY.noAge);
    const band = must(byId('client-birthday-band'));
    expect(text(band.querySelector('.ui-occasion-band__title'))).toBe(
      'Рожден ден днес',
    );
    expect(band.getAttribute('aria-label')).toBe('Рожден ден днес');
  });
});

describe('lib-birthday-card — (d) within the week', () => {
  it('is one quiet notice in the accent tone with the cake: a date, never a countdown, no band', async () => {
    const { byId, host, text } = await mount(BIRTHDAY.upcoming);
    expect(byId('client-birthday')?.getAttribute('data-kind')).toBe('upcoming');
    const notice = must(byId('client-birthday-upcoming'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(notice.getAttribute('data-tone')).toBe('accent');
    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.getAttribute('aria-label')).toBe(
      'Рожден ден · петък, 2.10 · 34 г.',
    );
    expect(notice.querySelector('ui-icon.ui-notice__glyph')).not.toBeNull();
    expect(text(notice)).toBe('Рожден ден · петък, 2.10 · 34 г.');
    expect(host.querySelector('ui-occasion-band')).toBeNull();
    expect(host.querySelector('.ui-coupon-card')).toBeNull();
  });
});

describe('lib-birthday-card — the law', () => {
  it('draws at most ONE orange slab in every state, and never a pass', async () => {
    for (const vm of Object.values(BIRTHDAY)) {
      const { host } = await mount(vm);
      expect(
        host.querySelectorAll('.ui-occasion-band').length,
      ).toBeLessThanOrEqual(1);
      expect(host.querySelector('.ui-pass-card')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('declares no colour and no font of its own: the band and the ticket are the DS’s', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\bcolor\s*:/);
    expect(rules).not.toMatch(/\bbackground\s*:/);
    expect(rules).not.toMatch(/\bfont\s*:/);
    // The applied gift takes the focus back clear of the sheet's chrome.
    expect(rules).toMatch(
      /\.birthday-card__origin\s*\{[^}]*scroll-margin-block:\s*var\(--modal-sheet-origin-margin\)/,
    );
    // …and without the DS's inset ring: a landing is not a control (review
    // 3, round 2: the ring boxed the whole card after «Използвай» → ‹). The
    // button form keeps its ring: the suppression names the article.
    expect(rules).toMatch(
      /article\.birthday-card__origin:focus-visible\s*\{[^}]*outline:\s*none/,
    );
    expect(rules).toMatch(
      /article\.birthday-card__origin:focus-visible::before\s*\{[^}]*box-shadow:\s*none/,
    );
    expect(rules).not.toMatch(/button\.birthday-card__origin:focus-visible/);
    expect(rules).not.toMatch(/\n\.birthday-card__origin:focus-visible/);
  });
});
