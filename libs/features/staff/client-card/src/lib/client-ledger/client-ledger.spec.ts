import { Component, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_PORT, ZonedDateTime } from '@creativo/application/accounts';
import { CLIENT_STATS_READER } from '@creativo/application/booking';
import {
  CLIENT_VOUCHERS_READER,
  LOYALTY_ACTIVITY_READER,
  LOYALTY_CATALOG_READER,
  LOYALTY_READER,
  type LoyaltyActivityReader,
} from '@creativo/application/engagement';
import {
  InMemoryClientVouchersReader,
  InMemoryLoyaltyActivityReader,
  InMemoryLoyaltyCatalogReader,
  InMemoryLoyaltyReader,
} from '@creativo/application/engagement/testing';
import { CLOCK, provideFeatureFlags } from '@creativo/application/shared';
import {
  GEORGI,
  InMemoryProfilePort,
  InMemoryStatsReader,
  MARTIN,
  NOW_MS,
  catalogueOf,
  georgiHistory,
  georgiOpenContext,
  georgiUser,
  martinHistory,
  martinUser,
  must,
  statsOf,
  subjectOf,
} from '../../testing/client-card.fixtures';
import { cssRule } from '../../testing/css-rule';
import { ClientCardStore } from '../client-card.store';
import { ClientLedgerPage } from './client-ledger';

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg'));
  }
}

const TITLE_ID = 'staff-visit-page-title';

const ALL_FLAGS = {
  'client.profile': true,
  'loyalty.points': true,
  'loyalty.streaks': true,
  'loyalty.achievements': true,
  'loyalty.tiers': true,
};

@Component({
  imports: [ClientLedgerPage],
  template: `<lib-client-ledger titleId="staff-visit-page-title" />`,
})
class Host {}

interface MountOptions {
  readonly activity?: LoyaltyActivityReader;
  readonly flags?: Readonly<Record<string, boolean>>;
}

/** Lets every pending read answer and the page render it. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(options: MountOptions = {}) {
  const activity = options.activity ?? InMemoryLoyaltyActivityReader.seeded();
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      ClientCardStore,
      provideFeatureFlags(options.flags ?? ALL_FLAGS),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) => ZonedDateTime.fromMillis(NOW_MS, zone),
        },
      },
      {
        provide: PROFILE_PORT,
        useValue: new InMemoryProfilePort(
          new Map([
            [GEORGI, georgiUser()],
            [MARTIN, martinUser()],
          ]),
        ),
      },
      {
        provide: CLIENT_STATS_READER,
        useValue: new InMemoryStatsReader(
          new Map([
            [GEORGI, statsOf(GEORGI, georgiHistory())],
            [MARTIN, statsOf(MARTIN, martinHistory())],
          ]),
        ),
      },
      { provide: LOYALTY_READER, useValue: InMemoryLoyaltyReader.seeded() },
      {
        provide: LOYALTY_CATALOG_READER,
        useValue: new InMemoryLoyaltyCatalogReader(),
      },
      {
        provide: CLIENT_VOUCHERS_READER,
        useValue: InMemoryClientVouchersReader.seeded(),
      },
      { provide: LOYALTY_ACTIVITY_READER, useValue: activity },
    ],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const store = TestBed.inject(ClientCardStore);
  store.open(subjectOf(GEORGI), georgiOpenContext());
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const rerender = async () => {
    await settle();
    fixture.detectChanges();
  };
  return { fixture, host, store, activity, byId, text, rerender };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lib-client-ledger — «Движение», Георги’s journal', () => {
  it('heads the page with its name at the sheet’s large title and the person with his balance under it', async () => {
    const { byId, text, store } = await mount();
    const title = must(byId('ledger-title'));
    expect(title.tagName).toBe('H2');
    expect(title.id).toBe(TITLE_ID);
    expect(title.hasAttribute('uisheetlargetitle')).toBe(true);
    expect(title.getAttribute('data-font')).toBe('largeTitle');
    expect(text(title)).toBe('Движение');
    expect(title.closest('ui-sheet-headline')).not.toBeNull();
    const line = must(byId('ledger-subline'));
    expect(line.getAttribute('data-font')).toBe('callout');
    expect(line.getAttribute('data-foreground-style')).toBe('secondary');
    const parts = store.ledger().subline;
    expect(text(line)).toBe(
      parts
        .map((part) => part.text)
        .join('')
        .trim(),
    );
    const fact = must(line.querySelector('span'));
    expect(text(fact)).toBe(parts.find((part) => part.fact)?.text);
    expect(fact.getAttribute('data-foreground-style')).toBe('primary');
    expect(fact.getAttribute('data-weight')).toBe('medium');
    expect(text(fact)).toMatch(/^\d[\d\s]* т\.$/u);
  });

  it('offers the four kinds as small chips in a toolbar, the chosen one filled, and reads the first page of a kind on a tap', async () => {
    const { byId, text, store, activity, rerender } = await mount();
    const toolbar = must(byId('ledger-filter'));
    expect(toolbar.tagName).toBe('UI-FLOW');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Вид');
    const chips = [...toolbar.querySelectorAll('button')];
    expect(chips.map((chip) => text(chip))).toEqual([
      'Всички',
      'Точки',
      'Награди',
      'Статус',
    ]);
    for (const chip of chips) {
      expect(chip.classList).toContain('ui-chip');
      expect(chip.getAttribute('data-control-size')).toBe('small');
      expect(chip.getAttribute('type')).toBe('button');
    }
    const all = must(byId('ledger-filter-all'));
    expect(all.hasAttribute('data-selected')).toBe(true);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(byId('ledger-filter-status')?.getAttribute('aria-pressed')).toBe(
      'false',
    );

    must(byId<HTMLButtonElement>('ledger-filter-status')).click();
    await rerender();
    expect(store.ledger().filter).toBe('status');
    expect(byId('ledger-filter-status')?.hasAttribute('data-selected')).toBe(
      true,
    );
    expect(all.hasAttribute('data-selected')).toBe(false);
    const calls = (activity as InMemoryLoyaltyActivityReader).calls;
    expect(calls.some((call) => call.kind === 'status')).toBe(true);
  });

  it('lists the journal by month under h3 headings through the shared statement, and reads more until «Това е всичко.»', async () => {
    const { host, byId, text, activity, rerender } = await mount();
    const months = host.querySelectorAll('[data-testid^="ledger-month-"]');
    expect(months.length).toBeGreaterThan(0);
    const heading = must(host.querySelector('lib-activity-list h3'));
    expect(heading.hasAttribute('uititle')).toBe(true);
    expect(text(heading)).toMatch(/\d{4} г\.$/u);
    expect(
      host.querySelectorAll(
        '[data-testid^="ledger-entry-"]:not([data-testid$="-icon"])',
      ).length,
    ).toBeGreaterThan(0);
    const more = must(byId<HTMLButtonElement>('ledger-more'));
    expect(text(more)).toBe('Покажи още');
    expect(more.getAttribute('data-button-style')).toBe('bordered');
    expect(more.getAttribute('data-control-size')).toBe('regular');
    expect(byId('ledger-end')).toBeNull();
    const before = host.querySelectorAll('li').length;

    more.click();
    await rerender();
    const calls = (activity as InMemoryLoyaltyActivityReader).calls;
    expect(calls.some((call) => call.after !== null)).toBe(true);
    expect(host.querySelectorAll('li').length).toBeGreaterThanOrEqual(before);

    for (let i = 0; i < 6 && byId('ledger-more') !== null; i += 1) {
      must(byId<HTMLButtonElement>('ledger-more')).click();
      await rerender();
    }
    const end = must(byId('ledger-end'));
    expect(text(end)).toBe('Това е всичко.');
    expect(end.getAttribute('data-font')).toBe('footnote');
    expect(end.getAttribute('data-foreground-style')).toBe('secondary');
    expect(end.closest('.client-ledger__foot')).not.toBeNull();
  });

  it('says «Още няма движение.» for a journal with no entry, and «Няма записи от този вид.» with the way back under a kind', async () => {
    const { byId, text, store, rerender } = await mount({
      activity: new InMemoryLoyaltyActivityReader({}),
    });
    const empty = must(byId('ledger-empty'));
    expect(empty.tagName).toBe('UI-EMPTY-STATE');
    expect(text(empty)).toBe('Още няма движение.');
    expect(byId('ledger-more')).toBeNull();
    expect(byId('ledger-end')).toBeNull();

    must(byId<HTMLButtonElement>('ledger-filter-status')).click();
    await rerender();
    expect(byId('ledger-empty')).toBeNull();
    const filtered = must(byId('ledger-empty-filtered'));
    expect(text(filtered)).toContain('Няма записи от този вид.');
    const clear = must(byId<HTMLButtonElement>('ledger-filter-clear'));
    expect(text(clear)).toBe('Покажи всички');
    clear.click();
    await rerender();
    expect(store.ledger().filter).toBe('all');
    expect(byId('ledger-empty')).not.toBeNull();
  });

  it('says once when the first page did not come, and reads it again on «Опитай пак»', async () => {
    const activity = InMemoryLoyaltyActivityReader.seeded().failWith();
    const { host, byId, text, rerender } = await mount({ activity });
    const notice = must(byId('ledger-error'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(notice.getAttribute('aria-label')).toBe('Движението не се зареди.');
    expect(host.querySelector('lib-activity-list')).toBeNull();
    expect(byId('ledger-more')).toBeNull();
    const retry = must(byId<HTMLButtonElement>('ledger-retry'));
    expect(text(retry)).toBe('Опитай пак');
    activity.recover();
    retry.click();
    await rerender();
    expect(byId('ledger-error')).toBeNull();
    expect(host.querySelector('lib-activity-list')).not.toBeNull();
  });

  it('stands three months of two rows in while the first page reads, the head and the chips already there', async () => {
    const activity = InMemoryLoyaltyActivityReader.seeded();
    vi.spyOn(activity, 'page').mockReturnValue(new Promise(() => undefined));
    const { byId, text } = await mount({ activity });
    const skeleton = must(byId('ledger-skeleton'));
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.querySelectorAll('ui-list-row')).toHaveLength(6);
    expect(text(byId('ledger-title'))).toBe('Движение');
    expect(byId('ledger-filter')?.querySelectorAll('button')).toHaveLength(4);
    expect(byId('ledger-more')).toBeNull();
  });

  it('keeps the saved rows offline, says so, and takes the foot away while a cursor is left', async () => {
    const { host, byId, text, rerender } = await mount();
    expect(byId('ledger-more')).not.toBeNull();
    window.dispatchEvent(new Event('offline'));
    await rerender();
    expect(text(byId('ledger-offline'))).toBe('Без връзка · запазени данни');
    expect(host.querySelector('lib-activity-list')).not.toBeNull();
    expect(byId('ledger-more')).toBeNull();
    window.dispatchEvent(new Event('online'));
    await rerender();
    expect(byId('ledger-offline')).toBeNull();
    expect(byId('ledger-more')).not.toBeNull();
  });

  it('reads its stylesheet as a contract: the page’s blocks at 24, the foot centred', () => {
    expect(cssRule('client-ledger/client-ledger.css', ':host')).toEqual(
      new Map([
        ['display', 'flex'],
        ['flex-direction', 'column'],
        ['gap', 'var(--sys-space-comfortable)'],
      ]),
    );
    expect(
      cssRule('client-ledger/client-ledger.css', '.client-ledger__foot'),
    ).toEqual(
      new Map([
        ['display', 'flex'],
        ['justify-content', 'center'],
        ['text-align', 'center'],
      ]),
    );
  });
});
