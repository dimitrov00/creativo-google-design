import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClientCardCompositionPage } from './client-card.page';

/**
 * THE CLIENT CARD, COMPOSED (revision 3 §7.1, D9). The page is the owner's
 * first look at the language, so the spec holds what the page PROMISES to
 * show (every composition of the package's row) and the laws a composition
 * must keep: one orange slab a sheet, the action inside the column on the
 * small rung, states told apart by form, every control named.
 */

async function render() {
  const fixture = TestBed.createComponent(ClientCardCompositionPage);
  fixture.detectChanges();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const piece = (id: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no piece «${id}»`);
    return found;
  };
  const all = (selector: string, within: ParentNode = root): HTMLElement[] =>
    Array.from(within.querySelectorAll<HTMLElement>(selector));
  return { fixture, root, piece, all };
}

describe('ClientCardCompositionPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientCardCompositionPage],
      // The page's shell holds the way back: a router link.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  // ── what the page shows ───────────────────────────────────────────────
  it('what the page shows: draws every composition of the package’s row, each on a stand-in sheet', async () => {
    const { piece, all } = await render();
    for (const id of [
      'composition-head-neutral',
      'composition-head-tinted',
      'composition-birthday-gift',
      'composition-birthday-band',
      'composition-wallet',
      'composition-modules',
      'composition-achievements',
      'composition-medals',
      'composition-medal-page',
      'composition-records-page',
    ]) {
      expect(piece(id).classList.contains('client-card__sheet')).toBe(true);
    }
    // The reference the rings are judged against stands beside them.
    expect(
      piece('composition-account-ring').querySelector('ui-progress-ring'),
    ).not.toBeNull();
    // Five plates, each named by its own heading.
    const plates = all('section.client-card__plate');
    expect(plates).toHaveLength(5);
    for (const plate of plates) {
      const id = plate.getAttribute('aria-labelledby') ?? '';
      expect(plate.querySelector(`h2#${id}`)?.textContent?.trim()).not.toBe('');
    }
  });

  it('what the page shows: is about real people: Георги Петров and Мартин Илиев', async () => {
    const { all } = await render();
    const names = all('[uisheetlargetitle]').map((title) =>
      title.textContent?.trim(),
    );
    expect(names).toContain('Георги Петров');
    expect(names).toContain('Мартин Илиев');
  });

  it('what the page shows: gives every large title an id of its own', async () => {
    const { all } = await render();
    const ids = all('[uisheetlargetitle]').map((title) => title.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── the head ──────────────────────────────────────────────────────────
  it('the head: is the hero: the face at 112 in a ring, the tier on its rim, the name at 28', async () => {
    const { piece } = await render();
    const head = piece('composition-head-neutral').querySelector(
      'ui-sheet-headline',
    );
    expect(head?.getAttribute('data-headline-style')).toBe('hero');
    expect(
      head
        ?.querySelector('ui-avatar[uiheadlinemedia]')
        ?.getAttribute('data-control-size'),
    ).toBe('extraLarge');
    expect(head?.querySelector('ui-gauge')).not.toBeNull();
    const plate = head?.querySelector('[uiheadlineplate]');
    expect(plate?.textContent?.trim()).toBe('Злато');
    expect(plate?.hasAttribute('data-on-media')).toBe(true);
    expect(
      head?.querySelector('[uisheetlargetitle]')?.getAttribute('data-font'),
    ).toBe('title');
  });

  it('the head: says the ring and the plate in words, after the quiet line', async () => {
    const { piece } = await render();
    const head = piece('composition-head-neutral').querySelector(
      'ui-sheet-headline',
    );
    expect(head?.textContent).toContain('Злато, още 7 посещения до Платина');
  });

  it('the head: sets the facts of the quiet line in the primary ink, each one word to the line breaker', async () => {
    const { piece, all } = await render();
    const facts = all('.client-card__fact', piece('composition-head-neutral'));
    expect(facts.map((fact) => fact.textContent)).toEqual([
      'март 2025 г.',
      '4 седмици',
    ]);
    for (const fact of facts) {
      expect(fact.getAttribute('data-foreground-style')).toBe('primary');
    }
  });

  // ── the discs, in both fills (Q2) ─────────────────────────────────────
  it('the discs, in both fills (Q2): draws the same four verbs under the same head', async () => {
    const { piece, all } = await render();
    const words = (id: string): string[] =>
      all('.ui-quick-action', piece(id)).map(
        (verb) => verb.textContent?.trim() ?? '',
      );
    expect(words('composition-head-neutral')).toEqual([
      'Обади се',
      'SMS',
      'Viber',
      'Повтори',
    ]);
    expect(words('composition-head-tinted')).toEqual(
      words('composition-head-neutral'),
    );
  });

  it('the discs, in both fills (Q2): promotes ONE verb of the neutral run, through the DS', async () => {
    const { piece, all } = await render();
    const sheet = piece('composition-head-neutral');
    const promoted = all('.ui-quick-action[data-prominence="accent"]', sheet);
    expect(promoted.map((verb) => verb.textContent?.trim())).toEqual([
      'Повтори',
    ]);
    expect(sheet.querySelector('.client-card__tinted')).toBeNull();
  });

  it('the discs, in both fills (Q2): draws the second fill through the run’s two properties, never a DS rule', async () => {
    const { piece, all } = await render();
    const sheet = piece('composition-head-tinted');
    expect(
      sheet
        .querySelector('ui-quick-actions')
        ?.classList.contains('client-card__tinted'),
    ).toBe(true);
    // The promoted verb stays `standard`: the accent rule would win.
    expect(
      all('.ui-quick-action[data-prominence="accent"]', sheet),
    ).toHaveLength(0);
    expect(
      all('.client-card__solid', sheet).map((verb) => verb.textContent?.trim()),
    ).toEqual(['Повтори']);
  });

  it('the discs, in both fills (Q2): names every verb with a sentence that begins with its word', async () => {
    const { all } = await render();
    const verbs = all('.ui-quick-action');
    expect(verbs.length).toBeGreaterThan(15);
    for (const verb of verbs) {
      const word = verb.textContent?.trim() ?? '';
      expect(verb.getAttribute('aria-label')?.startsWith(word)).toBe(true);
    }
  });

  // ── the birthday ──────────────────────────────────────────────────────
  it('the birthday: with the gift is ONE control: the band heads the ticket', async () => {
    const { piece } = await render();
    const card = piece('composition-birthday-card');
    expect(card.tagName).toBe('BUTTON');
    expect(card.hasAttribute('data-occasion')).toBe(true);
    expect(card.querySelector('ui-occasion-band')?.textContent).toContain(
      'Рожден ден · 34 г.',
    );
    expect(card.textContent).toContain('−20 %');
    expect(card.getAttribute('aria-label')).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
    );
    // The pill is the ticket's dress, not a second control.
    const pill = card.querySelector('[uicouponaction]');
    expect(pill?.tagName).toBe('SPAN');
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the birthday: without a gift is the band alone, a note', async () => {
    const { piece } = await render();
    const band = piece('composition-birthday-alone');
    expect(band.tagName).toBe('UI-OCCASION-BAND');
    expect(band.getAttribute('role')).toBe('note');
    expect(band.closest('.ui-coupon-card')).toBeNull();
    expect(band.textContent).toContain('Рожден ден днес');
  });

  it('the birthday: stands under the head and before the verbs', async () => {
    const { piece } = await render();
    for (const id of [
      'composition-birthday-gift',
      'composition-birthday-band',
    ]) {
      const page = piece(id).querySelector('.client-card__page');
      const order = Array.from(page?.children ?? []).map((child) =>
        child.tagName.toLowerCase(),
      );
      expect(order[0]).toBe('ui-sheet-headline');
      expect(order[order.length - 1]).toBe('ui-quick-actions');
      expect(order).toHaveLength(3);
    }
  });

  // ── one slab (the accent law, rule 5) ─────────────────────────────────
  it('one slab (the accent law, rule 5): no sheet holds more than one solid-orange surface', async () => {
    const { all } = await render();
    const sheets = all('.client-card__sheet');
    expect(sheets).toHaveLength(10);
    for (const sheet of sheets) {
      const slabs = all('ui-occasion-band, ui-pass-card', sheet);
      expect(slabs.length).toBeLessThanOrEqual(1);
    }
  });

  it('one slab (the accent law, rule 5): the wallet’s slab is the pass; a glance’s is the band', async () => {
    const { piece, all } = await render();
    const wallet = piece('composition-wallet');
    expect(all('ui-pass-card', wallet)).toHaveLength(1);
    expect(all('ui-occasion-band', wallet)).toHaveLength(0);
    for (const id of [
      'composition-head-neutral',
      'composition-head-tinted',
      'composition-birthday-gift',
      'composition-birthday-band',
      'composition-modules',
    ]) {
      expect(all('ui-pass-card', piece(id))).toHaveLength(0);
    }
  });

  // ── the wallet ────────────────────────────────────────────────────────
  it('the wallet: is the pass: one group with one name, the tier its one plate', async () => {
    const { piece } = await render();
    const pass = piece('composition-pass');
    expect(pass.getAttribute('role')).toBe('group');
    expect(pass.getAttribute('aria-label')).toContain('Георги Петров');
    expect(pass.getAttribute('aria-label')).toContain('371 точки');
    expect(pass.querySelectorAll('[uipassbadge]')).toHaveLength(1);
    expect(pass.querySelector('ui-logo[uipassmark]')).not.toBeNull();
  });

  it('the wallet: holds a voucher and a ticket to READ: the disc is the verb, said once', async () => {
    const { piece, all } = await render();
    const wallet = piece('composition-wallet');
    const voucher = piece('composition-voucher');
    expect(voucher.tagName).toBe('ARTICLE');
    expect(voucher.textContent).toContain('25,00 €');
    const ticket = piece('composition-wallet-ticket');
    expect(ticket.tagName).toBe('ARTICLE');
    // A name that says its rule prints no figure.
    expect(ticket.hasAttribute('data-valued')).toBe(false);
    expect(ticket.textContent).toContain('Безплатно подстригване');
    // Neither wears a call, and «Използвай» is the promoted disc alone.
    expect(all('[uicouponaction]', wallet)).toHaveLength(0);
    const said = all('.ui-quick-action, .ui-button', wallet).filter(
      (node) => node.textContent?.trim() === 'Използвай',
    );
    expect(said).toHaveLength(1);
    expect(said[0]?.getAttribute('data-prominence')).toBe('accent');
  });

  it('the wallet: on the glance the same ticket is ONE control in the pill every ticket wears', async () => {
    const { piece } = await render();
    const ticket = piece('composition-ticket');
    expect(
      ticket.closest('[data-testid="composition-modules"]'),
    ).not.toBeNull();
    expect(ticket.tagName).toBe('BUTTON');
    expect(ticket.getAttribute('aria-label')).toBe(
      'Награда: безплатно подстригване, важи до 28 октомври. Използвай',
    );
    const pill = ticket.querySelector('[uicouponaction]');
    expect(pill?.tagName).toBe('SPAN');
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
    expect(pill?.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(pill?.getAttribute('data-control-size')).toBe('small');
  });

  // ── a section heading with its action ─────────────────────────────────
  it('a section heading with its action: every module heading is `increased`, without a glyph of its own', async () => {
    const { all } = await render();
    const headings = all('ui-section-header');
    expect(headings.length).toBeGreaterThanOrEqual(6);
    for (const heading of headings) {
      expect(heading.getAttribute('data-header-prominence')).toBe('increased');
      expect(heading.querySelector(':scope > ui-icon')).toBeNull();
    }
  });

  it('a section heading with its action: every action is plain, on the small rung, and says where it goes', async () => {
    const { all } = await render();
    const actions = all('[uisectionaction]');
    expect(actions.map((action) => action.textContent?.trim())).toEqual([
      '23',
      'Всички',
      'Всички',
    ]);
    for (const action of actions) {
      expect(action.tagName).toBe('BUTTON');
      expect(action.getAttribute('data-button-style')).toBe('plain');
      expect(action.getAttribute('data-control-size')).toBe('small');
      expect(action.getAttribute('aria-label')?.length).toBeGreaterThan(10);
      expect(action.querySelector('ui-icon')).not.toBeNull();
    }
  });

  // ── surfaces ──────────────────────────────────────────────────────────
  it('surfaces: every card is elevated: no muted card, no plain one', async () => {
    const { all } = await render();
    const cards = all('.ui-card');
    expect(cards.length).toBeGreaterThanOrEqual(10);
    for (const card of cards) {
      expect(card.getAttribute('data-tone')).toBe('elevated');
    }
  });

  it('surfaces: a card that is pressed is a button with a name; a card to read is a group', async () => {
    const { all } = await render();
    for (const card of all('button.ui-card')) {
      expect(card.hasAttribute('data-interactive')).toBe(true);
      expect(card.getAttribute('aria-label')?.length).toBeGreaterThan(10);
    }
    for (const card of all('ui-card[role="group"]')) {
      expect(card.getAttribute('aria-label')?.length).toBeGreaterThan(5);
    }
  });

  // ── records ───────────────────────────────────────────────────────────
  it('records: are four cards, two by two, each one sentence', async () => {
    const { piece, all } = await render();
    const grid = piece('composition-records');
    expect(grid.style.getPropertyValue('--ui-grid-columns')).toBe('2');
    const cards = all('button.client-card__record', grid);
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Най-дълъг ритъм: 9 посещения, септември 2026 г., нов рекорд',
      'Най-много посещения за година: 13, 2026 г.',
      'Любима услуга: фейд, 23 пъти',
      'Първо посещение: 1 март 2025 г.',
    ]);
  });

  it('records: lead with the emblem, a mark of 52; a favourite’s is its picture', async () => {
    const { piece, all } = await render();
    const emblems = all('.client-card__emblem', piece('composition-records'));
    expect(emblems).toHaveLength(4);
    for (const emblem of emblems) {
      expect(emblem.tagName).toBe('UI-AVATAR');
      expect(emblem.getAttribute('data-control-size')).toBe('large');
    }
  });

  it('records: mark the new one with a wash capsule, in words', async () => {
    const { piece, all } = await render();
    const capsules = all('.ui-badge', piece('composition-records'));
    expect(capsules.map((capsule) => capsule.textContent?.trim())).toEqual([
      'Нов рекорд',
    ]);
    expect(capsules[0]?.getAttribute('data-tone')).toBe('accent');
    // The wash capsule, never the solid one.
    expect(capsules[0]?.getAttribute('data-prominence')).toBe('standard');
  });

  it('records: never part a year from its «г.»', async () => {
    const { piece } = await render();
    const text = piece('composition-records').textContent ?? '';
    expect(text).toContain('септември 2026 г.');
    expect(text).not.toMatch(/\d{4} г\./);
  });

  it('records: list the rest as rows on the «Рекорди» page, each glyph on a paper disc', async () => {
    const { piece, all } = await render();
    const rows = all('li.ui-list-row', piece('composition-record-rows'));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const disc = row.querySelector('ui-avatar');
      expect(disc?.classList.contains('client-card__emblem--paper')).toBe(true);
      expect(row.getAttribute('data-trailing-prominence')).toBe('primary');
    }
    // The featured figure is the page's one 36.
    const featured = piece('composition-record-featured');
    expect(featured.querySelectorAll('[data-font="largeTitle"]')).toHaveLength(
      1,
    );
  });

  // ── medals ────────────────────────────────────────────────────────────
  it('medals: stand three across, six in all, on an elevated card', async () => {
    const { piece, all } = await render();
    const grid = piece('composition-medal-grid');
    expect(grid.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(grid.closest('.ui-card')?.getAttribute('data-tone')).toBe(
      'elevated',
    );
    expect(all('button.ui-medal', grid)).toHaveLength(6);
  });

  it('medals: show all four states, told apart by form', async () => {
    const { piece, all } = await render();
    const medals = all('.ui-medal', piece('composition-medal-grid'));
    const states = medals.map((medal) => medal.getAttribute('data-state'));
    expect(new Set(states)).toEqual(
      new Set(['earned', 'complete', 'inProgress', 'notStarted']),
    );
    // Shelf order: what is won, what is under way, what is not started.
    expect(states).toEqual([
      'earned',
      'earned',
      'complete',
      'inProgress',
      'inProgress',
      'notStarted',
    ]);
    for (const medal of medals) {
      expect(medal.querySelector('ui-gauge')).not.toBeNull();
      expect(medal.getAttribute('aria-label')?.length).toBeGreaterThan(10);
    }
  });

  it('medals: wear no padlock, and one «Ново»', async () => {
    const { piece, all } = await render();
    const grid = piece('composition-medal-grid');
    expect(grid.querySelector('[data-name="loyalty.locked"]')).toBeNull();
    expect(
      all('[uimedalmarker]', grid).map((marker) => marker.textContent?.trim()),
    ).toEqual(['Ново']);
  });

  it('medals: a ring that stands alone holds ONE number', async () => {
    const { piece } = await render();
    const ring = piece('composition-collection').querySelector('ui-gauge');
    expect(ring?.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring?.getAttribute('role')).toBe('meter');
    expect(
      ring?.querySelector('[uicurrentvaluelabel]')?.textContent?.trim(),
    ).toBe('18');
  });

  it('medals: a medal’s page is the hero on its stage, and its figure the third rung', async () => {
    const { piece } = await render();
    const sheet = piece('composition-medal-page');
    const head = sheet.querySelector('ui-sheet-headline');
    expect(head?.getAttribute('data-headline-style')).toBe('hero');
    expect(head?.hasAttribute('data-media-stage')).toBe(true);
    expect(
      head?.querySelector('ui-medal')?.getAttribute('data-control-size'),
    ).toBe('extraLarge');
    expect(
      piece('composition-progress')
        .querySelector('ui-metric')
        ?.getAttribute('data-control-size'),
    ).toBe('extraLarge');
  });

  // ── a press ───────────────────────────────────────────────────────────
  it('a press: hands nothing off: it is said on the page', async () => {
    const { fixture, piece } = await render();
    const last = piece('composition-last');
    expect(last.getAttribute('role')).toBe('status');
    expect(last.textContent).toContain('nothing leaves the page');
    piece('composition-action-visits').click();
    fixture.detectChanges();
    expect(last.textContent?.trim()).toBe('Last press: Всички посещения');
  });

  // ── the accent law, on the page ───────────────────────────────────────
  // The stylesheet's half of the law (no accent and no white as an ink
  // outside a glyph or a display figure) is held by the tokens' own
  // guard, `accent-rule.spec.ts`, which reads this page's files too.
  it('the accent law, on the page: tints a word only where it is a display figure', async () => {
    const { all } = await render();
    const tinted = all(
      '[data-foreground-style="accent"], [data-foreground-style="promo"]',
    ).filter((node) => node.tagName !== 'UI-ICON');
    expect(tinted.map((node) => node.textContent?.trim())).toEqual(['371']);
    expect(tinted[0]?.getAttribute('data-font')).toBe('title2');
  });

  it('the accent law, on the page: draws no word on a solid orange but a display figure', async () => {
    const { all } = await render();
    // The band's title and the pass's figure: the DS's own parts.
    for (const band of all('ui-occasion-band')) {
      expect(band.querySelector('.ui-occasion-band__title')).not.toBeNull();
      expect(band.querySelector('.ui-badge')).toBeNull();
    }
    for (const pass of all('ui-pass-card')) {
      // The holder and the state stand on the foot, in ink.
      const foot = pass.querySelector('.ui-pass-card__foot');
      expect(foot?.textContent).toContain('Георги Петров');
      expect(foot?.textContent).toContain('40 т. изтичат на 31.12');
    }
  });
});
