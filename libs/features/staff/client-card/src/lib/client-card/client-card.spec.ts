import { CouponOccasion, type VisitLeg } from '@core/components';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletAnchor } from '../client-card.contracts';
import { RECORD_KIND_WORDS } from '../client-card.words';
import {
  GEORGI,
  GEORGI_GRANT,
  GEORGI_NOTE,
  GUEST,
  MARTIN,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  heldProfilePortsOf,
  historyPortsOf,
  loyaltyPortsOf,
  martinContext,
  martinHistory,
  martinUser,
  must,
  pausedUntilOctober,
  photoPortsOf,
  profilePortsOf,
  subjectOf,
} from '../../testing/client-card.fixtures';
import {
  type MountOptions,
  PAGE_TITLE_ID,
  mountAchievementsPage,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import { ClientCard } from './client-card';
import { LoadState } from '@creativo/shared/view-state';

/*
 * THE GLANCE PAGE (client-card-revision-3 §2.1), mounted as the visit editor
 * mounts it: the REAL store opened on the person, every port in memory over
 * the dev seed's books, the app's own words. What a case reads is what the
 * store and the presenters make of Георги's and Мартин's books (LR7: no
 * seed figure is hard-coded here; where one matters it is read from the
 * store's own model), and what the body makes of that.
 */

/** Everything the page emits, in order. */
interface Emitted {
  readonly loyalty: (WalletAnchor | null)[];
  achievements: number;
  readonly medals: string[];
  records: number;
  history: number;
  readonly photos: string[];
  readonly rewards: string[];
  readonly removedRewards: string[];
  readonly repeats: (readonly VisitLeg[])[];
  removes: number;
}

async function mount(options: Partial<MountOptions> = {}) {
  const mounted = await mountAchievementsPage(ClientCard, {
    subject: subjectOf(GEORGI),
    context: georgiOpenContext(),
    ...options,
  });
  const card = mounted.fixture.componentInstance;
  const emitted: Emitted = {
    loyalty: [],
    achievements: 0,
    medals: [],
    records: 0,
    history: 0,
    photos: [],
    rewards: [],
    removedRewards: [],
    repeats: [],
    removes: 0,
  };
  card.openLoyalty.subscribe((anchor) => emitted.loyalty.push(anchor));
  card.openAchievements.subscribe(() => (emitted.achievements += 1));
  card.openMedal.subscribe((id) => emitted.medals.push(id));
  card.openRecords.subscribe(() => (emitted.records += 1));
  card.openHistory.subscribe(() => (emitted.history += 1));
  card.openPhoto.subscribe((id) => emitted.photos.push(id));
  card.openReward.subscribe((id) => emitted.rewards.push(id));
  card.removeReward.subscribe((id) => emitted.removedRewards.push(id));
  card.repeatLast.subscribe((legs) => emitted.repeats.push(legs));
  card.removeClient.subscribe(() => (emitted.removes += 1));
  const click = async (testId: string) => {
    must(mounted.byId(testId), testId).click();
    await mounted.render();
  };
  /** The module headings, in page order. */
  const headings = () =>
    mounted.all('ui-section-header h3').map((heading) => mounted.text(heading));
  /** The ready `overview`, for the figures the seed decides. */
  const overview = () => mounted.store.overview();
  /** `a` stands before `b` in the DOM. */
  const before = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { ...mounted, emitted, click, headings, overview, before };
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

/** Мартин's card with the salon's birthday gift held: a −20 % coupon made for the day. */
function martinWithGift(overrides: Parameters<typeof martinContext>[0] = {}) {
  return martinContext({
    grants: [
      {
        ...GEORGI_GRANT,
        grantId: 'grant-birthday',
        title: 'Рожден ден',
        valueLabel: '−20 %',
        couponOccasion: CouponOccasion.Birthday,
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('lib-client-card — Георги, every flag on, his next visit open', () => {
  it('heads the page with a centred hero: the face at 112 in its ring, the tier on the rim, the one h2 at `title`', async () => {
    const { byId, host, text, store } = await mount();
    expect(host.getAttribute('data-testid')).toBe('client-card');
    const head = must(byId('client-head'));
    expect(head.tagName).toBe('UI-SHEET-HEADLINE');
    expect(head.getAttribute('data-headline-style')).toBe('hero');
    expect(head.hasAttribute('data-media')).toBe(true);
    expect(head.hasAttribute('data-plate')).toBe(true);
    expect(head.hasAttribute('data-media-tone')).toBe(false);

    const title = must(byId('client-head-title'));
    expect(title.tagName).toBe('H2');
    expect(title.id).toBe(PAGE_TITLE_ID);
    expect(title.hasAttribute('uisheetlargetitle')).toBe(true);
    // The name is the page's ONE 28: `title`, never `title2` beside a disc.
    expect(title.getAttribute('data-font')).toBe('title');
    expect(text(title)).toBe('Георги Петров');
    expect(host.querySelectorAll('h2')).toHaveLength(1);
    expect(host.querySelectorAll('[data-font="title"]')).toHaveLength(1);

    // The face in the media, hidden: the name says it; `extraLarge`.
    const media = must(head.querySelector('.ui-sheet-headline__media'));
    expect(media.getAttribute('aria-hidden')).toBe('true');
    const avatar = must(media.querySelector('ui-avatar'));
    expect(avatar.getAttribute('data-testid')).toBe('client-head-avatar');
    expect(avatar.getAttribute('data-control-size')).toBe('extraLarge');
    expect(avatar.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/avatars/georgi.jpg',
    );

    // The ring: the headline's own circular gauge, progress to the next tier.
    const ring = must(
      media.querySelector(':scope > ui-gauge.ui-sheet-headline__ring'),
    );
    expect(ring.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring.getAttribute('data-control-size')).toBe('extraLarge');
    expect(ring.hasAttribute('data-tone')).toBe(false);
    const tier = must(store.hero().tier, 'the tier');
    expect(tier.progress).toBeGreaterThan(0);
    expect(tier.progress).toBeLessThan(1);

    // The plate: INSIDE the media, the on-media badge with the tier's glyph.
    const plate = must(byId('client-head-tier'));
    expect(plate.closest('.ui-sheet-headline__media')).toBe(media);
    expect(plate.hasAttribute('uiheadlineplate')).toBe(true);
    expect(plate.classList.contains('ui-badge')).toBe(true);
    expect(plate.hasAttribute('data-on-media')).toBe(true);
    expect(plate.querySelector('ui-icon')).not.toBeNull();
    expect(text(plate)).toBe(tier.name);
    // No tier capsule any more: the plate says it.
    expect(byId('client-capsule-tier')).toBeNull();
    expect(byId('client-capsules')).toBeNull();
  });

  it('says tenure and cadence in ONE quiet line under the name, its facts in primary ink, and the ring in words after it', async () => {
    const { byId, text, store } = await mount();
    const line = must(byId('client-head-subline'));
    expect(line.tagName).toBe('P');
    expect(line.getAttribute('data-font')).toBe('callout');
    expect(line.getAttribute('data-foreground-style')).toBe('secondary');
    // A reader hears the sentence, its joint and all.
    const sentence = must(line.querySelector('[uivisuallyhidden]'));
    expect(text(sentence)).toBe('Клиент от март 2025 г. · идва през 4 седмици');
    // The eye gets its FACTS as the items of a CENTRED line of facts
    // (fact-line.css): the «·» is the stylesheet's, drawn only between two
    // facts on one line, so at 330 the two clauses stand one over the
    // other with no dot hanging at the break (review 3, round 4).
    const drawn = must(line.querySelector('.fact-line'));
    expect(drawn.getAttribute('aria-hidden')).toBe('true');
    expect(drawn.getAttribute('data-align')).toBe('center');
    const items = [...drawn.querySelectorAll('.fact-line__fact')];
    expect(items.map((item) => text(item))).toEqual([
      'Клиент от март 2025 г.',
      'идва през 4 седмици',
    ]);
    expect(drawn.textContent).not.toContain('·');
    const facts = [...line.querySelectorAll('.client-card__fact')];
    expect(facts.map((fact) => text(fact))).toEqual([
      'март 2025 г.',
      '4 седмици',
    ]);
    for (const fact of facts) {
      expect(fact.getAttribute('data-foreground-style')).toBe('primary');
      expect(fact.getAttribute('data-weight')).toBe('medium');
      // A fact is one word to the line breaker: the presenter's no-break spaces.
      expect(fact.textContent).not.toContain(' ');
    }

    // A3′ — the plate and the ring, heard after the line.
    const words = must(byId('client-head-tier-words'));
    expect(words.hasAttribute('data-visually-hidden')).toBe(true);
    expect(text(words)).toBe(must(store.hero().tier).accessibleName);
    expect(words.closest('.ui-sheet-headline__text')).not.toBeNull();
    expect(
      line.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('never cuts the quiet line, centres its facts as a line of facts, and lifts the head 37 into the bar’s row', () => {
    // jsdom lays nothing out: the stylesheet is the contract.
    const line = cssRule(
      'client-card/client-card.css',
      '.client-card__state-line',
    );
    expect(line.get('text-wrap')).toBe('balance');
    expect(line.get('overflow-wrap')).toBe('break-word');
    for (const cut of ['white-space', 'text-overflow', 'overflow']) {
      expect(line.has(cut)).toBe(false);
    }
    // The centred line of facts: the row shrink-wraps and each fact may
    // grow, so a fact alone on a wrapped line starts at the edge (its dot
    // clipped there) with its words centred inside it.
    const centred = cssRule('fact-line.css', ".fact-line[data-align='center']");
    expect(centred.get('inline-size')).toBe('fit-content');
    expect(centred.get('max-inline-size')).toBe('100%');
    expect(centred.get('margin-inline')).toBe('auto');
    const item = cssRule(
      'fact-line.css',
      ".fact-line[data-align='center'] > .fact-line__fact",
    );
    expect(item.get('flex')).toBe('1 1 auto');
    expect(item.get('text-align')).toBe('center');
    expect(cssRule('fact-line.css', '.fact-line').get('overflow-x')).toBe(
      'clip',
    );
    expect(
      cssRule('client-card/client-card.css', '.client-card__head').get(
        '--ui-sheet-headline-rise',
      ),
    ).toBe(
      'calc( var(--modal-sheet-chrome-height) - var(--sys-space-comfortable) )',
    );
    // The modules stand `loose` (32) apart, the head's own block `regular`.
    expect(cssRule('client-card/client-card.css', ':host').get('gap')).toBe(
      'var(--sys-space-loose)',
    );
    expect(
      cssRule('client-card/client-card.css', '.client-card__identity').get(
        'gap',
      ),
    ).toBe('var(--sys-space-regular)');
  });

  it('lands the focus on an origin clear of the chrome, and on the stamped reward without a ring: a landing is not a control', () => {
    // Everything that pushes a page takes the focus back on ‹ (§2.3).
    expect(
      cssRule('client-card/client-card.css', '.client-card__origin').get(
        'scroll-margin-block',
      ),
    ).toBe('var(--modal-sheet-origin-margin)');
    // The reward used stands stamped where it stood, an article the editor
    // focuses by its test id; the DS's inset ring (drawn for `button,
    // article` alike) boxed the birthday card that way (review 3, round
    // 2). The suppression names the article: the button form keeps it.
    expect(
      cssRule(
        'client-card/client-card.css',
        'article.client-card__origin:focus-visible',
      ).get('outline'),
    ).toBe('none');
    expect(
      cssRule(
        'client-card/client-card.css',
        'article.client-card__origin:focus-visible::before',
      ).get('box-shadow'),
    ).toBe('none');
    expect(() =>
      cssRule(
        'client-card/client-card.css',
        '.client-card__origin:focus-visible',
      ),
    ).toThrow();
    expect(() =>
      cssRule(
        'client-card/client-card.css',
        'button.client-card__origin:focus-visible',
      ),
    ).toThrow();
  });

  it('lays the modules in the barber’s order, each under a heading without a glyph whose action is the small rung', async () => {
    const { byId, headings, all, before } = await mount();
    const order = [
      'client-head',
      'client-quick-actions',
      'client-reward-ready',
      'client-visits',
      'client-loyalty',
      'client-achievements',
      'client-photos',
      'client-exits',
    ].map((id) => must(byId(id), id));
    for (const [index, element] of order.entries()) {
      const next = order[index + 1];
      if (next !== undefined) expect(before(element, next)).toBe(true);
    }
    expect(headings()).toEqual([
      'Посещения',
      'Лоялност',
      'Постижения',
      'Снимки',
    ]);
    for (const header of all('ui-section-header')) {
      expect(header.getAttribute('data-header-prominence')).toBe('increased');
      // The cards carry the glyphs, on discs: the heading none.
      expect(
        header.querySelector(':scope > ui-icon.ui-section-header__glyph'),
      ).toBeNull();
    }
    for (const action of all('[uisectionaction].ui-button')) {
      expect(action.getAttribute('data-control-size')).toBe('small');
      expect(action.getAttribute('data-button-style')).toBe('plain');
    }
    // The one list group on the page is the exits.
    expect(all('[uilistgroup], ui-list-group')).toHaveLength(1);
  });

  it('keeps the law: no muted card, no pass, and no orange slab on a day that is not a birthday', async () => {
    const { all, host } = await mount();
    expect(all('.ui-card[data-tone="muted"]')).toHaveLength(0);
    expect(host.querySelector('.ui-pass-card')).toBeNull();
    expect(host.querySelectorAll('.ui-occasion-band')).toHaveLength(0);
    expect(
      host.querySelector(
        '[uiforegroundstyle="promo"], [data-foreground-style="promo"]',
      ),
    ).toBeNull();
    // Every elevated card the page draws is the DS's.
    expect(all('.ui-card[data-tone="elevated"]').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('reaches the person through round discs with the word under each, the run centred on its three verbs', async () => {
    const { byId, text } = await mount();
    const group = must(byId('client-quick-actions'));
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Връзка');
    expect(group.style.getPropertyValue('--ui-quick-actions-columns')).toBe(
      '3',
    );
    const disc = (id: string) => must(byId(`client-quick-${id}`), id);
    expect(disc('call').getAttribute('href')).toBe('tel:+359881234567');
    expect(disc('call').getAttribute('aria-label')).toBe(
      'Обади се на Георги Петров, +359 88 123 4567',
    );
    expect(text(disc('call'))).toBe('Обади се');
    expect(disc('sms').getAttribute('href')).toBe('sms:+359881234567');
    expect(disc('viber').getAttribute('href')).toBe(
      'viber://chat?number=%2B359881234567',
    );
    for (const id of ['call', 'sms', 'viber']) {
      // The disc, its glyph, the standard fill: the DS's.
      expect(
        disc(id).querySelector(
          '.ui-quick-action__disc > ui-icon.ui-quick-action__glyph',
        ),
      ).not.toBeNull();
      expect(disc(id).getAttribute('data-prominence')).toBe('standard');
    }
    // The visit on screen already holds his usual fade: no «Повтори».
    expect(byId('client-quick-same')).toBeNull();
  });

  it('offers the owner’s reward as a white ticket wearing the decorative pill, the ticket itself the control', async () => {
    const { byId, text, click, emitted } = await mount();
    const ticket = must(byId<HTMLButtonElement>('client-reward-ready'));
    expect(ticket.tagName).toBe('BUTTON');
    expect(ticket.type).toBe('button');
    expect(ticket.classList.contains('ui-coupon-card')).toBe(true);
    expect(ticket.hasAttribute('data-interactive')).toBe(true);
    expect(ticket.getAttribute('aria-label')).toBe(
      'Безплатно подстригване, Безплатна услуга, използвай',
    );
    expect(text(ticket.querySelector('.ui-coupon-card__title'))).toBe(
      'Безплатно подстригване',
    );
    expect(text(ticket.querySelector('.ui-coupon-card__value'))).toBe(
      'Безплатна услуга',
    );
    expect(text(ticket.querySelector('.ui-coupon-card__detail'))).toBe(
      'до 28.10',
    );
    expect(ticket.querySelector('[uicouponglyph]')).not.toBeNull();
    // The pill: the house form for button chrome inside a larger surface.
    const pill = must(ticket.querySelector('[uicouponaction]'));
    expect(pill.tagName).toBe('SPAN');
    expect(pill.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(pill.getAttribute('data-control-size')).toBe('small');
    expect(pill.getAttribute('aria-hidden')).toBe('true');
    expect(text(pill)).toBe('Използвай');
    // The written call is deprecated: nothing projects it.
    expect(ticket.querySelector('.ui-coupon-card__action')).toBeNull();
    await click('client-reward-ready');
    expect(emitted.rewards).toEqual(['grant-dev-georgi-punch']);
  });

  it('features the last visit as the `/account` card, white and lifted, its thumb opening the photo page', async () => {
    const { byId, text, click, emitted, host } = await mount();
    const all = must(byId('client-visits-all'));
    expect(text(all)).toBe('24');
    expect(all.getAttribute('aria-label')).toBe('Всички посещения, 24');
    expect(all.hasAttribute('uisectionaction')).toBe(true);
    expect(all.querySelector('ui-icon')).not.toBeNull();
    await click('client-visits-all');
    expect(emitted.history).toBe(1);

    const last = must(byId('client-visit-last'));
    expect(last.classList.contains('ui-card')).toBe(true);
    expect(last.getAttribute('data-tone')).toBe('elevated');
    expect(last.getAttribute('data-padding')).toBe('comfortable');
    const card = must(last.closest('lib-visit-card'));
    expect(card.getAttribute('data-kind')).toBe('last');
    expect(card.getAttribute('data-header-prominence')).toBe('standard');
    expect(card.parentElement?.classList.contains('client-card__cards')).toBe(
      true,
    );
    // The old row's card is gone from the glance.
    expect(host.querySelector('lib-visit-row')).toBeNull();
    expect(text(last.querySelector('.visit-card__label'))).toBe(
      'Последно посещение',
    );
    expect(text(last.querySelector('.visit-card__services'))).toBe('Фейд');
    // Today's 10:00 fade was the last one worked: its thumb.
    await click('client-visit-photo-photo-dev-georgi-1');
    expect(emitted.photos).toEqual(['photo-dev-georgi-1']);
    // The visit on screen is the only one ahead: no «next» card.
    expect(byId('client-visit-next')).toBeNull();
    expect(byId('client-visit-waitlist')).toBeNull();
  });

  it('draws the loyalty as ONE white card, ONE button to the wallet; «Всички» does the same', async () => {
    const { byId, text, click, emitted, overview, host } = await mount();
    const all = must(byId('client-loyalty-all'));
    expect(text(all)).toBe('Всички');
    expect(all.getAttribute('aria-label')).toBe('Лоялност: всички подробности');

    const loyalty = overview().loyalty;
    if (loyalty?.loadState !== LoadState.Ready)
      throw new Error('the loyalty card is not ready');
    const card = must(byId<HTMLButtonElement>('client-loyalty-points'));
    expect(card.closest('lib-loyalty-glance')).not.toBeNull();
    expect(card.tagName).toBe('BUTTON');
    expect(card.getAttribute('data-tone')).toBe('elevated');
    expect(card.getAttribute('aria-label')).toBe(loyalty.data.accessibleName);
    const figure = must(byId('client-loyalty-points-figure'));
    expect(text(figure)).toBe(loyalty.data.figure);
    expect(figure.getAttribute('data-font')).toBe('title2');
    expect(figure.getAttribute('data-foreground-style')).toBe('accent');
    expect(text(byId('client-loyalty-points-sentence'))).toBe(
      loyalty.data.sentence,
    );
    // The holdings the seed gives (no voucher reader is bound in this rig).
    for (const holding of loyalty.data.holdings) {
      expect(text(byId(`client-loyalty-${holding.id}`))).toBe(holding.value);
    }
    expect(byId('client-loyalty-stamps')).not.toBeNull();
    expect(byId('client-loyalty-rhythm')).not.toBeNull();
    // Nothing of the retired bento remains.
    expect(byId('client-loyalty-stamps-figure')).toBeNull();
    expect(byId('client-loyalty-rhythm-line')).toBeNull();
    expect(host.querySelector('lib-client-loyalty-tiles')).toBeNull();

    await click('client-loyalty-points');
    await click('client-loyalty-all');
    expect(emitted.loyalty).toEqual([null, null]);
  });

  it('draws three named medals in a grid under the earned levels, the cue, and the records line that pushes «Рекорди»', async () => {
    const { byId, text, click, emitted, overview, all, host } = await mount();
    const medals = overview().medals;
    if (medals?.loadState !== LoadState.Ready)
      throw new Error('the medals card is not ready');
    expect(medals.data.levelCount).toBeGreaterThan(0);
    const allButton = must(byId('client-achievements-all'));
    expect(text(allButton)).toBe(String(medals.data.levelCount));
    expect(allButton.getAttribute('aria-label')).toBe(
      `Всички постижения, ${medals.data.levelCount} нива`,
    );
    await click('client-achievements-all');
    expect(emitted.achievements).toBe(1);

    const strip = must(byId('client-achievements-strip'));
    expect(strip.tagName).toBe('UI-CARD');
    expect(strip.getAttribute('data-tone')).toBe('elevated');
    expect(strip.closest('lib-medals-glance')).not.toBeNull();
    expect(host.querySelector('lib-client-medal-strip')).toBeNull();
    const tiles = all('lib-achievement-tile');
    expect(tiles).toHaveLength(medals.data.tiles.length);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(3);
    for (const tile of medals.data.tiles) {
      const medal = must(byId(`client-medal-${tile.key}`), tile.key);
      expect(medal.getAttribute('data-control-size')).toBe('large');
      expect(text(medal.querySelector('.ui-medal__title'))).toBe(
        tile.medal.title,
      );
      expect(medal.querySelector('.ui-medal__caption')).toBeNull();
    }
    // The cue binds «ниво» to its numeral with a no-break space; folded here.
    expect(text(byId('client-achievements-cue'))).toBe(
      medals.data.cue?.replace(/\s+/g, ' ') ?? null,
    );
    const first = must(medals.data.tiles[0]);
    await click(`client-medal-${first.key}`);
    expect(emitted.medals).toEqual([first.medal.seriesId]);

    const line = must(byId('client-records-line'));
    expect(line.getAttribute('aria-label')).toBe(medals.data.recordsName);
    for (const record of medals.data.records) {
      expect(
        text(
          byId(`client-record-${RECORD_KIND_WORDS[record.personalRecordKind]}`),
        ),
      ).toBe(record.value);
    }
    await click('client-records-line');
    expect(emitted.records).toBe(1);
  });

  it('grids the past cuts the card does not show, three to a row on a phone, the date a label on the picture', async () => {
    const { byId, all, text, click, emitted, host } = await mount();
    const grid = must(byId('client-photos-grid'));
    expect(grid.tagName).toBe('UI-GRID');
    expect(grid.getAttribute('role')).toBe('group');
    expect(grid.getAttribute('aria-label')).toBe(
      'Снимки от предишни посещения',
    );
    expect(grid.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(grid.getAttribute('data-spacing')).toBe('compact');
    expect(byId('client-photos-rail')).toBeNull();
    expect(host.querySelector('ui-scroll-row')).toBeNull();
    // Today's cut rides the featured card; the grid holds the two before it.
    const tiles = all<HTMLButtonElement>('[data-testid^="client-photo-"]');
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual([
      'client-photo-photo-dev-georgi-2',
      'client-photo-photo-dev-georgi-3',
    ]);
    const first = must(tiles[0]);
    expect(first.type).toBe('button');
    expect(first.hasAttribute('data-interactive')).toBe(true);
    expect(first.getAttribute('aria-label')).toBe('Снимка от 3 септември');
    const media = must(first.querySelector('ui-media-card'));
    expect(media.getAttribute('data-radius')).toBe('regular');
    const date = must(media.querySelector('span.ui-badge'));
    expect(date.hasAttribute('data-on-media')).toBe(true);
    expect(date.getAttribute('aria-hidden')).toBe('true');
    expect(text(date)).toBe('3.09');
    await click('client-photo-photo-dev-georgi-2');
    expect(emitted.photos).toEqual(['photo-dev-georgi-2']);
  });

  it('in the ≥ 761 dialog lays two cards to a row at `regular` padding and five photos to a row', async () => {
    stubDialogWidth(true);
    const { byId, host, all } = await mount();
    expect(host.getAttribute('data-sheet-width')).toBe('regular');
    expect(
      byId('client-photos-grid')?.style.getPropertyValue('--ui-grid-columns'),
    ).toBe('5');
    for (const card of all('lib-visit-card .ui-card')) {
      expect(card.getAttribute('data-padding')).toBe('regular');
    }
    const cards = cssRule(
      'client-card/client-card.css',
      ":host([data-sheet-width='regular']) .client-card__cards",
    );
    expect(cards.get('grid-template-columns')).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
    // «Лоялност» and «Постижения» stay one under the other in the dialog
    // too (review 3, F5): at 256 each, the loyalty card ended mid-row and
    // the medals card cut its names and overflowed its records line.
    const pair = cssRule('client-card/client-card.css', '.client-card__pair');
    expect(pair.get('grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(pair.get('gap')).toBe('var(--sys-space-loose)');
    expect(() =>
      cssRule(
        'client-card/client-card.css',
        ":host([data-sheet-width='regular']) .client-card__pair",
      ),
    ).toThrow(/found 0/);
  });

  it('on a phone the host says so and the cards pad `comfortable`', async () => {
    const { host, all } = await mount();
    expect(host.getAttribute('data-sheet-width')).toBe('compact');
    for (const card of all('lib-visit-card .ui-card')) {
      expect(card.getAttribute('data-padding')).toBe('comfortable');
    }
  });

  it('takes the person off the visit from the one list group, its row the destructive role', async () => {
    const { byId, text, click, emitted } = await mount();
    const exits = must(byId('client-exits'));
    expect(exits.tagName).toBe('UL');
    expect(exits.getAttribute('aria-label')).toBe('Действия с клиента');
    const remove = must(byId<HTMLButtonElement>('client-remove'));
    expect(remove.parentElement?.tagName).toBe('LI');
    expect(remove.type).toBe('button');
    expect(remove.getAttribute('data-role')).toBe('destructive');
    expect(remove.getAttribute('data-size')).toBe('large');
    expect(remove.querySelector('[uileading] ui-icon')).not.toBeNull();
    expect(text(remove)).toBe('Махни от посещението');
    await click('client-remove');
    expect(emitted.removes).toBe(1);
  });
});

describe('lib-client-card — Георги, today’s fade settled', () => {
  it('features his previous visit with his own words, and his next one as the same card', async () => {
    const { byId, all, text } = await mount({ context: georgiContext() });
    expect(text(byId('client-visit-last-quote'))).toBe(`„${GEORGI_NOTE}“`);
    expect(byId('client-visit-photo-photo-dev-georgi-2')).not.toBeNull();

    const next = must(byId('client-visit-next'));
    expect(next.classList.contains('ui-card')).toBe(true);
    expect(next.getAttribute('data-tone')).toBe('elevated');
    const card = must(next.closest('lib-visit-card'));
    expect(card.getAttribute('data-kind')).toBe('next');
    expect(text(next.querySelector('.visit-card__label'))).toBe('Следващ час');
    // Both cards share one column, in one order.
    expect(card.previousElementSibling?.tagName).toBe('LIB-VISIT-CARD');
    // Neither of the two cuts on the card or on today's visit is shown twice.
    expect(
      all('[data-testid^="client-photo-"]').map((tile) =>
        tile.getAttribute('data-testid'),
      ),
    ).toEqual(['client-photo-photo-dev-georgi-3']);
  });

  it('keeps the owner’s ticket and the exits on a finished visit: it stays correctable', async () => {
    const { byId } = await mount({ context: georgiContext() });
    expect(byId('client-reward-ready')).not.toBeNull();
    expect(byId('client-exits')).not.toBeNull();
    expect(byId('client-quick-call')).not.toBeNull();
  });

  it('offers nothing that writes to a gone visit (cancelled, a no-show): no ticket, no exits', async () => {
    const { byId } = await mount({ context: georgiContext({ gone: true }) });
    expect(byId('client-reward-ready')).toBeNull();
    expect(byId('client-exits')).toBeNull();
    expect(byId('client-quick-call')).not.toBeNull();
  });
});

describe('lib-client-card — Мартин, in the chair on his birthday', () => {
  it('says the birthday as a solid band under the head and before the verbs — the page’s one slab — and prints no capsule for it', async () => {
    const { byId, host, text, before } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    expect(byId('client-capsule-tier')).toBeNull();
    expect(byId('client-capsule-birthday')).toBeNull();
    expect(byId('client-capsules')).toBeNull();
    const birthday = must(byId('client-birthday'));
    expect(birthday.getAttribute('data-kind')).toBe('today');
    // Nothing held: the band alone, a statement.
    expect(birthday.getAttribute('data-gift')).toBeNull();
    const band = must(byId('client-birthday-band'));
    expect(band.getAttribute('role')).toBe('note');
    expect(text(band.querySelector('.ui-occasion-band__title'))).toBe(
      'Рожден ден · 34 г.',
    );
    expect(byId('client-birthday-gift')).toBeNull();
    expect(before(must(byId('client-head')), birthday)).toBe(true);
    expect(before(birthday, must(byId('client-quick-actions')))).toBe(true);
    expect(host.querySelectorAll('.ui-occasion-band')).toHaveLength(1);
    expect(host.querySelector('.ui-pass-card')).toBeNull();
    // The tier is on the face.
    expect(text(byId('client-head-tier'))).toBe('Сребро');
  });

  it('with the salon’s gift held, the band heads its ticket and the reward ticket does not repeat it', async () => {
    const { byId, text, click, emitted, host } = await mount({
      subject: subjectOf(MARTIN),
      context: martinWithGift(),
    });
    expect(byId('client-birthday')?.getAttribute('data-gift')).toBe('ready');
    const ticket = must(byId<HTMLButtonElement>('client-birthday-gift'));
    expect(ticket.tagName).toBe('BUTTON');
    expect(ticket.hasAttribute('data-occasion')).toBe(true);
    expect(ticket.getAttribute('aria-label')).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
    );
    expect(byId('client-birthday-band')?.parentElement).toBe(ticket);
    expect(text(ticket.querySelector('.ui-coupon-card__value'))).toBe('−20 %');
    expect(text(ticket.querySelector('.ui-coupon-card__title'))).toBe(
      'Подарък от салона',
    );
    expect(text(ticket.querySelector('[uicouponaction]'))).toBe('Използвай');
    // E does not repeat the gift: the birthday grant was his only one.
    expect(byId('client-reward-ready')).toBeNull();
    expect(host.querySelectorAll('.ui-occasion-band')).toHaveLength(1);
    await click('client-birthday-gift');
    expect(emitted.rewards).toEqual(['grant-birthday']);
  });

  it('with the gift on the bill, the band stays and «Премахни» takes it off', async () => {
    const { byId, click, emitted } = await mount({
      subject: subjectOf(MARTIN),
      context: martinWithGift({
        grants: [],
        grantsOnBill: [
          {
            ...GEORGI_GRANT,
            grantId: 'grant-birthday',
            title: 'Рожден ден',
            valueLabel: '−20 %',
            couponOccasion: CouponOccasion.Birthday,
          },
        ],
      }),
    });
    expect(byId('client-birthday')?.getAttribute('data-gift')).toBe('applied');
    expect(byId('client-birthday-gift')?.tagName).toBe('ARTICLE');
    expect(byId('client-birthday-band')).not.toBeNull();
    await click('client-birthday-gift-remove');
    expect(emitted.removedRewards).toEqual(['grant-birthday']);
  });

  it('promotes «Повтори» as the one accent disc of the row, one word under it, the name starting with it', async () => {
    const { byId, text, click, emitted } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    const same = must(byId<HTMLButtonElement>('client-quick-same'));
    expect(same.tagName).toBe('BUTTON');
    expect(same.type).toBe('button');
    expect(same.getAttribute('data-prominence')).toBe('accent');
    expect(text(same)).toBe('Повтори');
    expect(same.getAttribute('aria-label')).toBe(
      'Повтори посещението от 19 август: Класическа подстрижка',
    );
    const run = must(byId('client-quick-actions'));
    const verbs = [...run.querySelectorAll('[uiquickaction]')];
    expect(verbs).toHaveLength(4);
    expect(
      verbs.filter((verb) => verb.getAttribute('data-prominence') === 'accent'),
    ).toHaveLength(1);
    // Label in name (WCAG 2.5.3): every disc's name begins with its word.
    for (const verb of verbs) {
      expect(
        verb.getAttribute('aria-label')?.startsWith(text(verb) ?? '∅'),
      ).toBe(true);
    }
    expect(run.style.getPropertyValue('--ui-quick-actions-columns')).toBe('4');
    await click('client-quick-same');
    expect(emitted.repeats).toHaveLength(1);
    expect(must(emitted.repeats[0]).map((leg) => leg.serviceId)).toEqual([
      'svc-classic-cut',
    ]);
  });

  it('draws his waiting request as the third card of one shape, and no ticket and no photos he has nothing for', async () => {
    const { byId, text } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    const waiting = must(byId('client-visit-waitlist'));
    expect(waiting.classList.contains('ui-card')).toBe(true);
    expect(waiting.getAttribute('data-tone')).toBe('elevated');
    expect(waiting.closest('lib-visit-card')?.getAttribute('data-kind')).toBe(
      'waitlist',
    );
    expect(text(waiting.querySelector('.visit-card__label'))).toBe(
      'Чака свободен час',
    );
    expect(waiting.closest('.client-card__cards')).toBe(
      must(byId('client-visit-last')).closest('.client-card__cards'),
    );
    expect(byId('client-reward-ready')).toBeNull();
    expect(byId('client-reward-skeleton')).toBeNull();
    expect(byId('client-photos')).toBeNull();
  });
});

describe('lib-client-card — its states', () => {
  it('S1 · renders the head from the seat at once — no ring, no plate yet — and a placeholder shaped like each module until the profile answers', async () => {
    const profiles = heldProfilePortsOf();
    const { byId, text, all, render } = await mount({
      rig: { profiles },
      settle: false,
    });
    await render();
    expect(text(byId('client-head-title'))).toBe('Георги П.');
    expect(byId('client-head-subline')).toBeNull();
    expect(byId('client-head-tier')).toBeNull();
    expect(
      byId('client-head')?.querySelector('ui-gauge.ui-sheet-headline__ring'),
    ).toBeNull();
    expect(byId('client-head-avatar')).not.toBeNull();
    // A birthday is never promised by a skeleton; nor is the capsule row
    // (§2.1.5 lists no placeholder for it).
    expect(byId('client-birthday')).toBeNull();
    expect(byId('client-capsules-skeleton')).toBeNull();
    expect(byId('client-capsules')).toBeNull();
    // The verbs need no read: the seat's phone is enough.
    expect(byId('client-quick-call')?.getAttribute('href')).toBe(
      'tel:+359881234567',
    );
    for (const id of [
      'client-reward-skeleton',
      'client-visits-skeleton',
      'client-loyalty-skeleton',
      'client-achievements-skeleton',
      'client-photos-skeleton',
    ]) {
      expect(byId(id)?.getAttribute('aria-busy'), id).toBe('true');
    }
    // The headings keep their action's rung while its figure is unknown.
    expect(
      all('ui-section-header > ui-skeleton[uisectionaction]'),
    ).toHaveLength(3);
    expect(byId('client-visits-all')).toBeNull();
    // Each block stands in at the height its card lands at, so nothing moves:
    // the ticket 124, the visit card 117, the loyalty card 128, the medals 214.
    const heights = (id: string) =>
      [...(byId(id)?.querySelectorAll<HTMLElement>('ui-skeleton') ?? [])].map(
        (block) => block.style.blockSize,
      );
    expect(heights('client-reward-skeleton')).toEqual([
      'calc(var(--sys-space-unit) * 31)',
    ]);
    expect(heights('client-visits-skeleton')).toEqual([
      'calc(var(--sys-space-unit) * 29.25)',
    ]);
    expect(heights('client-loyalty-skeleton')).toEqual([
      'calc(var(--sys-space-unit) * 32)',
    ]);
    expect(heights('client-achievements-skeleton')).toEqual([
      'calc(var(--sys-space-unit) * 53.5)',
    ]);
    // Three photo tiles, the grid's own 4 / 5 frame.
    const photos = must(byId('client-photos-skeleton'));
    expect(photos.tagName).toBe('UI-GRID');
    expect(photos.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(
      photos.querySelectorAll('ui-skeleton.client-card__photo-placeholder'),
    ).toHaveLength(3);
    expect(
      cssRule(
        'client-card/client-card.css',
        '.client-card__photo-placeholder',
      ).get('aspect-ratio'),
    ).toBe('4 / 5');

    profiles.answer();
    await render();
    expect(text(byId('client-head-title'))).toBe('Георги Петров');
    expect(byId('client-head-tier')).not.toBeNull();
    expect(byId('client-visits-skeleton')).toBeNull();
    expect(byId('client-visit-last')).not.toBeNull();
    expect(byId('client-photos-grid')).not.toBeNull();
    expect(all('ui-skeleton')).toHaveLength(0);
  });

  it('keeps a failed module’s heading over its one retry, and reads it again', async () => {
    const photos = photoPortsOf(georgiPhotos()).failWith();
    const { byId, text, headings, click } = await mount({ rig: { photos } });
    expect(headings()).toContain('Снимки');
    const notice = must(byId('client-failed-photos'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(notice.getAttribute('aria-label')).toBe('Снимките не се заредиха.');
    expect(text(byId('client-retry-photos'))).toBe('Опитай пак');
    expect(byId('client-failed-slices')).toBeNull();
    // The other modules stand.
    expect(byId('client-visit-last')).not.toBeNull();

    photos.recover();
    await click('client-retry-photos');
    expect(byId('client-failed-photos')).toBeNull();
    expect(byId('client-photos-grid')).not.toBeNull();
  });

  it('folds two failed modules into one notice under the head, their headings alone', async () => {
    const history = historyPortsOf([
      ...georgiHistory(),
      ...martinHistory(),
    ]).failWith();
    const photos = photoPortsOf(georgiPhotos()).failWith();
    const { byId, text, headings, click, before } = await mount({
      rig: { history, photos },
    });
    const notice = must(byId('client-failed-slices'));
    expect(notice.getAttribute('aria-label')).toBe(
      'Част от данните не се заредиха.',
    );
    // Under the head, before the verbs.
    expect(before(must(byId('client-head')), notice)).toBe(true);
    expect(before(notice, must(byId('client-quick-actions')))).toBe(true);
    expect(headings()).toEqual([
      'Посещения',
      'Лоялност',
      'Постижения',
      'Снимки',
    ]);
    expect(byId('client-failed-visits')).toBeNull();
    expect(byId('client-failed-photos')).toBeNull();
    expect(byId('client-visits-all')).toBeNull();
    expect(text(byId('client-retry-slices'))).toBe('Опитай пак');

    history.recover();
    photos.recover();
    await click('client-retry-slices');
    expect(byId('client-failed-slices')).toBeNull();
    expect(byId('client-visit-last')).not.toBeNull();
    expect(byId('client-photos-grid')).not.toBeNull();
  });

  it('S7 · a profile that did not load leaves the head, one notice, the verbs and the exits', async () => {
    const profiles = profilePortsOf([georgiUser()]).failWith();
    const { byId, headings, click } = await mount({ rig: { profiles } });
    expect(must(byId('client-failed-profile')).getAttribute('aria-label')).toBe(
      'Данните за клиента не се заредиха.',
    );
    expect(byId('client-quick-actions')).not.toBeNull();
    expect(byId('client-exits')).not.toBeNull();
    expect(headings()).toEqual([]);
    expect(byId('client-capsules')).toBeNull();
    expect(byId('client-reward-ready')).toBeNull();
    expect(byId('client-birthday')).toBeNull();

    profiles.recover();
    await click('client-retry-profile');
    expect(byId('client-failed-profile')).toBeNull();
    expect(headings()).toEqual([
      'Посещения',
      'Лоялност',
      'Постижения',
      'Снимки',
    ]);
  });

  it('offline · says so under the head and keeps only what does not write; the birthday falls to the band alone', async () => {
    const { byId, render, before } = await mount({
      subject: subjectOf(MARTIN),
      context: martinWithGift(),
    });
    expect(byId('client-quick-same')).not.toBeNull();
    expect(byId('client-birthday-gift')).not.toBeNull();
    window.dispatchEvent(new Event('offline'));
    await render();
    const notice = must(byId('client-offline-notice'));
    expect(notice.getAttribute('aria-label')).toBe(
      'Без връзка · запазени данни',
    );
    expect(before(must(byId('client-head')), notice)).toBe(true);
    expect(before(notice, must(byId('client-birthday')))).toBe(true);
    expect(byId('client-quick-call')).not.toBeNull();
    expect(byId('client-quick-sms')).not.toBeNull();
    expect(byId('client-quick-viber')).not.toBeNull();
    expect(byId('client-quick-same')).toBeNull();
    expect(byId('client-exits')).toBeNull();
    expect(byId('client-reward-ready')).toBeNull();
    // The band stays; the gift cannot be used.
    expect(byId('client-birthday-band')).not.toBeNull();
    expect(byId('client-birthday-gift')).toBeNull();
    // The saved values stay.
    expect(byId('client-visit-last')).not.toBeNull();
  });

  it('paused · the warning ring takes the tier ring’s place, the plate stays, the line says it; no ticket, no rhythm fact', async () => {
    const profiles = profilePortsOf([georgiUser(pausedUntilOctober())]);
    const { byId, text } = await mount({ rig: { profiles } });
    const head = must(byId('client-head'));
    expect(head.getAttribute('data-media-tone')).toBe('warning');
    const ring = must(head.querySelector('ui-gauge.ui-sheet-headline__ring'));
    expect(ring.getAttribute('data-tone')).toBe('warning');
    expect(ring.hasAttribute('data-complete')).toBe(true);
    expect(byId('client-head-tier')).not.toBeNull();
    const line = must(byId('client-head-subline'));
    expect(text(line.querySelector('[uivisuallyhidden]'))).toBe(
      'Онлайн записването е спряно до 12.10',
    );
    expect(line.querySelectorAll('.fact-line__fact')).toHaveLength(1);
    expect(text(line.querySelector('.client-card__fact'))).toBe('12.10');
    expect(byId('client-reward-ready')).toBeNull();
    expect(byId('client-quick-call')).not.toBeNull();
    expect(byId('client-visit-last')).not.toBeNull();
    expect(byId('client-loyalty-rhythm')).toBeNull();
  });

  it('paused · Мартин’s waiting card goes with the pause, his visits stay, the band stands alone', async () => {
    const profiles = profilePortsOf([martinUser(pausedUntilOctober())]);
    const { byId } = await mount({
      subject: subjectOf(MARTIN),
      context: martinWithGift(),
      rig: { profiles },
    });
    expect(byId('client-head')?.getAttribute('data-media-tone')).toBe(
      'warning',
    );
    expect(byId('client-visit-waitlist')).toBeNull();
    expect(byId('client-visit-last')).not.toBeNull();
    expect(byId('client-birthday-band')).not.toBeNull();
    expect(byId('client-birthday-gift')).toBeNull();
  });

  it('guest · reads nothing: the seat’s name and phone, «Гост · без профил», no ring, no plate, the exits', async () => {
    const { byId, text, headings } = await mount({
      subject: GUEST,
      context: georgiOpenContext(),
    });
    expect(text(byId('client-head-title'))).toBe('Иво');
    const line = must(byId('client-head-subline'));
    expect(text(line.querySelector('[uivisuallyhidden]'))).toBe(
      'Гост · без профил',
    );
    expect(
      [...line.querySelectorAll('.fact-line__fact')].map((fact) => text(fact)),
    ).toEqual(['Гост', 'без профил']);
    expect(line.querySelector('.client-card__fact')).toBeNull();
    expect(byId('client-head-tier')).toBeNull();
    expect(
      byId('client-head')?.querySelector('ui-gauge.ui-sheet-headline__ring'),
    ).toBeNull();
    expect(byId('client-head-avatar')?.getAttribute('data-control-size')).toBe(
      'extraLarge',
    );
    expect(byId('client-quick-call')?.getAttribute('href')).toBe(
      'tel:+359890001111',
    );
    expect(byId('client-exits')).not.toBeNull();
    expect(headings()).toEqual([]);
    expect(byId('client-capsules')).toBeNull();
    expect(byId('client-capsules-skeleton')).toBeNull();
    expect(byId('client-birthday')).toBeNull();
  });

  it('production flags · no ring, no plate, no loyalty and no achievements; visits, photos and the ticket stay', async () => {
    const { byId, headings } = await mount({
      rig: { flags: { 'client.profile': true } },
    });
    expect(headings()).toEqual(['Посещения', 'Снимки']);
    expect(byId('client-head-tier')).toBeNull();
    expect(
      byId('client-head')?.querySelector('ui-gauge.ui-sheet-headline__ring'),
    ).toBeNull();
    expect(byId('client-capsules')).toBeNull();
    expect(byId('client-reward-ready')).not.toBeNull();
    expect(byId('client-loyalty')).toBeNull();
    expect(byId('client-achievements')).toBeNull();
  });

  it('no loyalty account · the loyalty and achievements modules are absent, never zeros; no plate', async () => {
    const { byId, headings } = await mount({
      rig: { loyalty: loyaltyPortsOf([]) },
    });
    expect(headings()).toEqual(['Посещения', 'Снимки']);
    expect(byId('client-head-tier')).toBeNull();
    expect(byId('client-loyalty-skeleton')).toBeNull();
    expect(byId('client-achievements-skeleton')).toBeNull();
  });
});
