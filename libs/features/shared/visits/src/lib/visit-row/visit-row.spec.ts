import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { VisitGrain, VisitPerspective } from '@core/components';
import {
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  FIXTURE_TODAY,
} from '@core/testing';
import {
  CURRENT_APPOINTMENT_ID,
  GEORGI_PHOTOS,
  GEORGI_UID,
  GEORGI_VISITS,
  VISITS_LOOKUP,
  VISITS_TIME_ZONE,
  catalogueTranslator,
  georgiStaffRows,
  georgiWaitlistRequest,
  visitsNow,
} from '../testing/visit-fixtures';
import { appCatalogue } from '../testing/app-catalogue';
import { cssRule } from '../testing/css-rule';
import {
  visitRowOf,
  visitWaitlistWordsOf,
  visitWordsOf,
  waitlistRowOf,
} from '../visit-row.presenter';
import type { VisitRowVm } from '../visit-row.vm';
import { VisitRow } from './visit-row';

const BG = catalogueTranslator(appCatalogue('bg'));
const STAFF_WORDS = visitWordsOf(BG, 'bg', VisitPerspective.Staff);
const CLIENT_WORDS = visitWordsOf(BG, 'bg', VisitPerspective.Client);
const NOW = visitsNow(FIXTURE_TODAY);

/** `formatCents`'s bg form keeps the sign on the figure's line: a no-break space. */
const EURO = (text: string) => text.replaceAll(' €', '\u00a0€');

@Component({
  imports: [VisitRow],
  template: `
    <ul role="list">
      <lib-visit-row
        [vm]="vm()"
        [perspective]="perspective()"
        [interactive]="interactive()"
        (open)="opened.push(vm().id)"
      />
    </ul>
  `,
})
class Host {
  readonly vm = signal<VisitRowVm>(null as unknown as VisitRowVm);
  readonly perspective = signal<VisitPerspective>(VisitPerspective.Staff);
  readonly interactive = signal<boolean | null>(null);
  readonly opened: string[] = [];
}

async function mount(
  vm: VisitRowVm,
  perspective: VisitPerspective = VisitPerspective.Staff,
  interactive: boolean | null = null,
) {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.componentInstance.perspective.set(perspective);
  fixture.componentInstance.interactive.set(interactive);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    host.querySelector<T>(selector);
  const text = (selector: string) =>
    q(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, q, text };
}

/**
 * Георги's first page, row by row, as the staff card builds it: by MONTH
 * since revision 3, the client's own grain.
 */
let staffRows: ReadonlyMap<string, VisitRowVm>;

beforeAll(async () => {
  const rows = await georgiStaffRows(
    {
      history: memoryAppointmentReadPorts(GEORGI_VISITS),
      photos: memoryAppointmentPhotoPorts([...GEORGI_PHOTOS]),
    },
    {
      words: STAFF_WORDS,
      now: NOW,
      timeZone: VISITS_TIME_ZONE,
      grain: VisitGrain.Month,
    },
  );
  staffRows = new Map(rows.map((row) => [row.id, row]));
});

function staffRow(id: string): VisitRowVm {
  const row = staffRows.get(id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
}

describe('VisitRow · the staff history', () => {
  it('is a read row: a list item holding a static DS row, named by its whole sentence', async () => {
    const vm = staffRow('appt-sep');
    const { host, q } = await mount(vm);

    const item = q('lib-visit-row');
    expect(item?.getAttribute('role')).toBe('listitem');
    const row = q('[data-testid="history-row-appt-sep"]');
    expect(row?.tagName).toBe('UI-LIST-ROW');
    expect(row?.getAttribute('data-size')).toBe('regular');
    expect(row?.getAttribute('data-alignment')).toBe('leading');
    // Nothing to open, so nothing to press.
    expect(row?.hasAttribute('data-interactive')).toBe(false);
    expect(host.querySelector('button')).toBeNull();
    // No `›` on any row.
    expect(host.querySelector('[data-name="nav.disclosure"]')).toBeNull();

    // The sentence is the row's one reading — every fact, the price, the
    // marks and the whole quote — and every drawn part is hidden from it.
    expect(q('[data-visually-hidden]')?.textContent?.trim()).toBe(
      EURO(
        'Фейд, 4 септември в 10:00, Иван, Център, 27,50 €, 1 снимка, от клиента: „Къса отстрани, по-дълго отгоре“',
      ),
    );
    for (const part of [
      '.visit-row__lead',
      'lib-visit-row-words',
      '.visit-row__face',
    ]) {
      expect(q(part)?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('stamps the weekday over the day, then the service, who and where, and the client’s own words', async () => {
    const { q, text } = await mount(staffRow('appt-sep'));

    const tile = q('ui-date-tile');
    expect(tile?.closest('[uileading]')).not.toBeNull();
    // By month, as on the client's own list: the section says the month,
    // the stamp the weekday.
    expect(text('.ui-date-tile__caption')).toBe('пт');
    expect(text('.ui-date-tile__day')).toBe('4');
    expect(tile?.getAttribute('data-tone')).toBe('past');
    expect(tile?.getAttribute('data-control-size')).toBe('regular');

    const head = q('lib-staff-event-head');
    expect(head?.getAttribute('data-size')).toBe('regular');
    expect(text('.staff-event-head__title')).toBe('Фейд');
    expect(text('.staff-event-head__line')).toBe('Център · Иван');
    expect(text('[data-testid="history-row-appt-sep-quote"]')).toBe(
      '„Къса отстрани, по-дълго отгоре“',
    );
  });

  it('never cuts what was done: the title wraps, the fact line keeps to one line with its barber held', async () => {
    const { q } = await mount(staffRow('appt-sep'));

    // The list row lets its label wrap (`nowrap` would clip the title)…
    expect(
      q('[data-testid="history-row-appt-sep"]')?.hasAttribute(
        'data-label-wraps',
      ),
    ).toBe(true);
    // …the head wraps its title and keeps each fact line to one line…
    const head = q('lib-staff-event-head');
    expect(head?.hasAttribute('data-truncate')).toBe(false);
    expect(head?.hasAttribute('data-truncate-lines')).toBe(true);
    // …and the barber is the run the ellipsis never takes.
    expect(q('.staff-event-head__text')?.hasAttribute('data-held')).toBe(true);
    expect(q('.staff-event-head__hold')?.textContent).toBe(' · Иван');
  });

  it('ends the second line with what was charged: primary, semibold, the photos counted before it', async () => {
    const { q, text } = await mount(staffRow('appt-sep'));

    const figure = q('[data-fact="amount"]');
    expect(figure?.textContent?.trim()).toBe(EURO('27,50 €'));
    // The fact belongs to the WORDS, not to the trailing edge: that is the
    // face's.
    const end = q('lib-visit-row-words > .visit-row-words__end');
    expect(figure?.parentElement).toBe(end);
    expect(figure?.closest('[uitrailing]')).toBeNull();
    // `callout` at 600 in the primary ink, as the spec sets a paid amount.
    expect(figure?.getAttribute('data-font')).toBe('callout');
    expect(figure?.getAttribute('data-weight')).toBe('semibold');
    expect(figure?.getAttribute('data-foreground-style')).toBe('primary');
    expect(figure?.querySelector('s')).toBeNull();
    // The list row's own trailing ink is never asked for: a face is detail.
    expect(
      q('[data-testid="history-row-appt-sep"]')?.hasAttribute(
        'data-trailing-prominence',
      ),
    ).toBe(false);

    // The marks are detail BEFORE the figure: they ask for the secondary.
    const marks = q('.visit-row-words__marks');
    expect(marks?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(end?.firstElementChild).toBe(marks);
    expect(end?.lastElementChild).toBe(figure);
    const mark = q('[data-mark="client.photos"]');
    expect(mark?.querySelector('ui-icon')?.getAttribute('aria-label')).toBe(
      '1 снимка',
    );
    expect(mark?.querySelector('ui-icon')?.getAttribute('data-scale')).toBe(
      'small',
    );
    expect(text('[data-mark="client.photos"]')).toBe('1');
  });

  it('marks the discount of a bill that was discounted, beside its photos', async () => {
    const { q } = await mount(staffRow('appt-aug'));
    expect(q('[data-mark="client.photos"]')?.textContent?.trim()).toBe('2');
    const discount = q('[data-mark="promo.coupon"]');
    expect(discount?.querySelector('ui-icon')?.getAttribute('aria-label')).toBe(
      'с отстъпка',
    );
    // A mark that counts nothing prints no figure.
    expect(discount?.textContent?.trim()).toBe('');
  });

  it('marks a visit a voucher paid for, last before the figure', async () => {
    const vm: VisitRowVm = {
      ...staffRow('appt-aug'),
      marks: [
        ...staffRow('appt-aug').marks,
        { icon: 'promo.voucher', label: STAFF_WORDS.voucher, count: null },
      ],
    };
    const { host, q } = await mount(vm);
    expect(
      [...host.querySelectorAll('.visit-row-words__mark')].map((mark) =>
        mark.getAttribute('data-mark'),
      ),
    ).toEqual(['client.photos', 'promo.coupon', 'promo.voucher']);
    expect(
      q('[data-mark="promo.voucher"] ui-icon')?.getAttribute('aria-label'),
    ).toBe('платено с ваучер');
  });

  it('strikes a cancellation in the full ink: hollow stamp, its status word, booked amount struck', async () => {
    const { host, q, text } = await mount(staffRow('appt-jul-cancelled'));

    const row = q('[data-testid="history-row-appt-jul-cancelled"]');
    // One mark for one fact: struck, never struck AND faded (the fade took
    // the stamp's caption and the struck amount under 4.5:1).
    expect(row?.hasAttribute('data-receded')).toBe(false);
    expect(q('ui-date-tile')?.getAttribute('data-tone')).toBe('hollow');
    const head = q('lib-staff-event-head');
    expect(head?.hasAttribute('data-struck')).toBe(true);
    expect(head?.hasAttribute('data-receded')).toBe(false);
    // The word keeps its words (review r5): a line of its own, first, so
    // the struck amount ends it as every row's fact ends its first line,
    // and the barber runs the whole width under both — the full-width
    // line the stylesheet gives whatever follows the first.
    expect(
      [...host.querySelectorAll('.staff-event-head__line')].map((line) =>
        line.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Отказан от клиента', 'Иван']);
    expect(text('.staff-event-head__title + .staff-event-head__line')).toBe(
      'Отказан от клиента',
    );
    expect(
      q(
        '.staff-event-head__title + .staff-event-head__line',
      )?.nextElementSibling?.classList.contains('staff-event-head__line'),
    ).toBe(true);
    // The word is the line's whole basis, so the amount drops to its own
    // line before the word loses a letter (jsdom lays nothing out: the
    // stamp and the stylesheet are the contract).
    expect(q('lib-visit-row-words')?.hasAttribute('data-lead-whole')).toBe(
      true,
    );
    expect(
      cssRule(
        readFileSync(resolve(__dirname, 'visit-row-words.css'), 'utf8'),
        '.visit-row-words[data-lead-whole] .staff-event-head__title + .staff-event-head__line',
      ).get('flex-basis'),
    ).toBe('auto');

    const figure = q('[data-fact="amount"]');
    expect(figure?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(figure?.querySelector('s')?.textContent?.trim()).toBe(
      EURO('17,50 €'),
    );
  });

  it('strikes a no-show in the full ink, the warning on the glyph and the word beside it', async () => {
    const { q } = await mount(staffRow('appt-jul-no-show'));
    // Its word is the row's fact, so its first line is the barber's, from
    // the floor like every other row's.
    expect(q('lib-visit-row-words')?.hasAttribute('data-lead-whole')).toBe(
      false,
    );

    expect(
      q('[data-testid="history-row-appt-jul-no-show"]')?.hasAttribute(
        'data-receded',
      ),
    ).toBe(false);
    expect(q('lib-staff-event-head')?.hasAttribute('data-struck')).toBe(true);
    expect(q('ui-date-tile')?.getAttribute('data-tone')).toBe('hollow');

    const status = q('[data-fact="status"]');
    expect(status?.closest('.visit-row-words__end')).not.toBeNull();
    expect(status?.getAttribute('data-tone')).toBe('warning');
    const glyph = status?.querySelector('ui-icon');
    expect(glyph?.getAttribute('data-name')).toBe('visit.noShow');
    // The warning is the DS's foreground role on the GLYPH; the word is
    // ink, said out loud so no quiet run around it can grey it.
    expect(glyph?.getAttribute('data-foreground-style')).toBe('warning');
    const word = q('[data-fact="status"] .visit-row-words__figure');
    expect(word?.textContent?.trim()).toBe('Не дойде');
    expect(word?.getAttribute('data-foreground-style')).toBe('primary');
  });

  it('wears «Този час» on the visit the sheet is open on, its hour alone in the facts', async () => {
    const { q, text } = await mount(staffRow(CURRENT_APPOINTMENT_ID));

    expect(q('ui-date-tile')?.getAttribute('data-tone')).toBe('upcoming');
    const badge = q('[data-fact="badge"]');
    expect(badge?.classList.contains('ui-badge')).toBe(true);
    expect(badge?.getAttribute('data-tone')).toBe('accent');
    expect(badge?.textContent?.trim()).toBe('Този час');
    expect(
      badge?.parentElement?.classList.contains('visit-row-words__end'),
    ).toBe(true);
    // The day is the tile's and the capsule's: the line leads with the time
    // alone, so a settled visit's marks and the capsule still end the SECOND
    // line at 390 (review 2, fix-visits-r1: «днес, 10:00 · Иван» beside
    // «▣ 1 · Този час» wrapped to a third line, 140 + 103 in a 215 column).
    expect(text('.staff-event-head__line')).toMatch(/^10:00 · Иван$/);
    // Nothing is paid yet, and nothing is marked.
    expect(q('[data-fact="amount"]')).toBeNull();
    expect(q('.visit-row-words__marks')).toBeNull();
  });

  it('says a request is only requested: «Заявен» beside its glyph, in the neutral tone', async () => {
    const { q, text } = await mount(staffRow('appt-oct'));

    expect(q('ui-date-tile')?.getAttribute('data-tone')).toBe('upcoming');
    const status = q('[data-fact="status"]');
    expect(status?.getAttribute('data-tone')).toBe('neutral');
    const glyph = status?.querySelector('ui-icon');
    expect(glyph?.getAttribute('data-name')).toBe('visit.pending');
    // A neutral state's glyph is detail beside the word.
    expect(glyph?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(text('[data-fact="status"] .visit-row-words__figure')).toBe(
      'Заявен',
    );
    expect(text('.staff-event-head__line')).toMatch(/^пт, 10:00 · Иван$/);
  });

  it('tells a party by the subject’s own seat, the other shop, and who else came', async () => {
    const { q, text } = await mount(staffRow('appt-dec-party'));
    expect(text('.ui-date-tile__caption')).toBe('пт');
    expect(text('.staff-event-head__line')).toBe('Младост · с още 1 · Петър');
    // His own seat's price: the party's other chair is not his.
    expect(text('[data-fact="amount"]')).toBe('25,00 €');
    // …and the face of who cut HIS seat.
    expect(q('[data-trailing="barber"]')?.textContent?.trim()).toBe('П');
  });

  it('draws no end for an hour with nothing to state, and still holds the face', async () => {
    const quiet: VisitRowVm = {
      ...staffRow('appt-oct'),
      trailingFact: null,
      marks: [],
    };
    const { q } = await mount(quiet);
    expect(q('.visit-row-words__end')).toBeNull();
    expect(q('[uitrailing] [data-trailing="barber"]')).not.toBeNull();
  });
});

describe('VisitRow · the staff row’s face', () => {
  it('ends the row in the barber’s face, as the client’s own row does', async () => {
    const vm = staffRow('appt-sep');
    const { q } = await mount(vm);

    const face = q('[data-trailing="barber"]');
    expect(face?.tagName).toBe('UI-AVATAR');
    expect(face?.getAttribute('data-control-size')).toBe('small');
    // A picture, named by who it is: the catalogue's own.
    expect(face?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/barbers/ivan.jpg',
    );
    // In the list row's trailing slot, the row's own child.
    const column = face?.parentElement;
    expect(column?.classList.contains('visit-row__face')).toBe(true);
    expect(column?.hasAttribute('uitrailing')).toBe(true);
    expect(column?.parentElement).toBe(
      q('[data-testid="history-row-appt-sep"]'),
    );
  });

  it('shows a barber without a picture by their initials', async () => {
    const { q } = await mount(staffRow('appt-dec-party'));
    const face = q('[data-trailing="barber"]');
    expect(face?.querySelector('img')).toBeNull();
    expect(
      face?.querySelector('.ui-avatar__fallback')?.textContent?.trim(),
    ).toBe('П');
  });

  it('draws no face for a visit cut by several, and RESERVES its column all the same', async () => {
    const vm: VisitRowVm = {
      ...staffRow('appt-aug'),
      trailing: {
        avatarSrc: null,
        name: STAFF_WORDS.severalBarbers(2),
        several: true,
      },
    };
    const { q } = await mount(vm);
    // No "anyone" disc here: a barber reads who cut in the fact line.
    expect(q('ui-avatar')).toBeNull();
    expect(q('[data-name="booking.anyBarber"]')).toBeNull();
    const column = q('.visit-row__face');
    expect(column).not.toBeNull();
    expect(column?.childElementCount).toBe(0);
    // The fact still ends the words, left of the column.
    expect(q('.visit-row-words__end [data-fact="amount"]')).not.toBeNull();
  });

  it('holds the column on every visit, so the facts of a list end on one line', () => {
    // jsdom lays nothing out, so the stylesheets are the contract; the
    // harness was measured at 390 and 330 in both themes (every fact ends
    // 64 from the row's trailing edge: 16 of padding, the face's 36, 12 of
    // air).
    const rowCss = readFileSync(resolve(__dirname, 'visit-row.css'), 'utf8');
    const face = cssRule(rowCss, '.visit-row__face');
    expect(face.get('inline-size')).toBe('var(--control-size-small)');
    expect(face.get('min-block-size')).toBe('var(--control-size-small)');
    // 48 from the text to the row's padding: the DS row's 16 gap less a
    // tight step.
    expect(face.get('margin-inline-start')).toBe(
      'calc(-1 * var(--sys-space-tight))',
    );
  });

  it('gives a waiting request no column: it states no fact and keeps its width for its words', async () => {
    const vm = waitlistRowOf(
      georgiWaitlistRequest(),
      {
        words: visitWaitlistWordsOf(BG),
        today: FIXTURE_TODAY,
        locale: 'bg',
      },
      VISITS_LOOKUP,
    );
    const { q } = await mount(vm);
    expect(q('[uitrailing]')).toBeNull();
    expect(q('.visit-row-words__end')).toBeNull();
  });
});

describe('VisitRow · the staff row’s words, laid out', () => {
  const css = () =>
    readFileSync(resolve(__dirname, 'visit-row-words.css'), 'utf8');

  it('mounts the event head, never a copy of it, beside the end of its second line', async () => {
    const { q } = await mount(staffRow('appt-sep'));
    const words = q('lib-visit-row-words');
    expect(words?.classList.contains('visit-row-words')).toBe(true);
    expect(
      words?.querySelector(':scope > lib-staff-event-head'),
    ).not.toBeNull();
    expect(
      words?.querySelector(':scope > .visit-row-words__end'),
    ).not.toBeNull();
    // Never in the head's own slot: that one ends the TITLE's line.
    expect(q('lib-staff-event-head [uitrailing]')).toBeNull();
  });

  it('runs the head’s lines and the fact as one wrapping run, centred on the stamp', () => {
    const run = cssRule(css(), '.visit-row-words');
    expect(run.get('display')).toBe('flex');
    expect(run.get('flex-wrap')).toBe('wrap');
    expect(run.get('align-content')).toBe('center');
    // The stamp's own 44: a staff row is a client row's height.
    expect(run.get('min-block-size')).toBe('var(--control-size-regular)');
    // The head and its run of lines step out of the layout.
    expect(
      cssRule(
        css(),
        '.visit-row-words > .staff-event-head, .visit-row-words > .staff-event-head > .staff-event-head__lines',
      ).get('display'),
    ).toBe('contents');
  });

  it('gives the title the whole column and the fact the trailing edge of the line under it', () => {
    const title = cssRule(css(), '.visit-row-words .staff-event-head__title');
    expect([title.get('order'), title.get('flex')]).toEqual(['1', '0 0 100%']);
    // The fact line gives way; the fact never shrinks and keeps the
    // trailing edge. The line's BASIS is the floor, not its own width: a
    // wrapping run breaks on the basis before it shrinks anything, and on
    // its own width the fact dropped to a third line wherever the two did
    // not fit (review 2: the open visit's «днес, 10:00 · Иван» beside
    // «▣ 1 · Този час» at 390 — 140 + 103 in a 215 column — and every
    // amount row at 330, 101 + 55 in 155). From the floor (23 units, 92:
    // the held barber's 55 and a time's five glyphs — a cut shop name is
    // the line's grammar, a cut figure is a wrong one — and what a plain
    // amount leaves the line at 330) the line grows into what the fact
    // leaves and truncates its lead, so the row keeps to 68 at 390 on
    // every fact, and at 330 on a plain amount; the fact drops only where
    // even the floor would not fit beside it.
    const line = cssRule(css(), '.visit-row-words .staff-event-head__line');
    expect([
      line.get('order'),
      line.get('flex'),
      line.get('min-inline-size'),
    ]).toEqual(['2', '1 1 var(--visit-row-words-line-floor)', '0']);
    expect(
      cssRule(css(), '.visit-row-words').get('--visit-row-words-line-floor'),
    ).toBe('calc(var(--sys-space-unit) * 23)');
    const end = cssRule(css(), '.visit-row-words > .visit-row-words__end');
    expect([
      end.get('order'),
      end.get('flex'),
      end.get('margin-inline-start'),
    ]).toEqual(['3', 'none', 'auto']);
    expect(cssRule(css(), '.visit-row-words__end').get('white-space')).toBe(
      'nowrap',
    );
    // What follows runs the whole width again.
    for (const selector of [
      '.visit-row-words .staff-event-head__line ~ .staff-event-head__line',
      '.visit-row-words .staff-event-head__quote',
    ]) {
      expect(cssRule(css(), selector).get('flex')).toBe('0 0 100%');
    }
  });

  it('sets every title at one height: the line that carries the fact is as tall as the tallest fact', () => {
    expect(
      cssRule(
        css(),
        '.visit-row-words .staff-event-head__title + .staff-event-head__line',
      ).get('min-block-size'),
    ).toBe('calc(var(--sys-space-unit) * 5.5)');
  });

  it('sets the amounts as a column: tabular figures, said again after the role', () => {
    const figure = cssRule(css(), '.visit-row-words__figure');
    expect(figure.get('font-variant-numeric')).toBe('tabular-nums');
    expect(figure.get('line-height')).toBe('1');
  });

  it('fades nothing and paints nothing: no ink, no opacity, no font of the head’s is set here', () => {
    const sheet = css().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sheet).not.toMatch(/\bopacity\s*:/);
    expect(sheet).not.toMatch(/(^|[\s;{])color\s*:/);
    expect(sheet).not.toMatch(/\bfont(-size|-family|-weight)?\s*:/);
  });
});

describe('VisitRow · the element is the host’s to say', () => {
  it('makes a staff row the control when its host asks: a DS row button, named by its sentence', async () => {
    const vm = staffRow('appt-sep');
    const { fixture, q } = await mount(vm, VisitPerspective.Staff, true);

    const row = q<HTMLButtonElement>('[data-testid="history-row-appt-sep"]');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.type).toBe('button');
    expect(row?.classList.contains('ui-list-row')).toBe(true);
    expect(row?.hasAttribute('data-interactive')).toBe(true);
    expect(row?.getAttribute('aria-label')).toBe(vm.accessibleName);
    // The button's name says it all: no second reading inside it.
    expect(q('[data-visually-hidden]')).toBeNull();
    // Still a staff row: the fact on its second line, the face trailing.
    expect(q('.visit-row-words__end [data-fact="amount"]')).not.toBeNull();
    expect(q('.visit-row__face [data-trailing="barber"]')).not.toBeNull();

    row?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual(['appt-sep']);
  });

  it('makes a client’s row a read row when its host asks, the sentence in its hidden line', async () => {
    const vm = visitRowOf(
      GEORGI_VISITS.find((each) => each.id === 'appt-oct') ??
        (GEORGI_VISITS[0] as (typeof GEORGI_VISITS)[number]),
      {
        perspective: VisitPerspective.Client,
        grain: VisitGrain.Month,
        subjectUserId: GEORGI_UID,
        currentAppointmentId: null,
        now: NOW,
        timeZone: VISITS_TIME_ZONE,
        locale: 'bg',
        words: CLIENT_WORDS,
      },
      VISITS_LOOKUP,
    );
    const { host, q } = await mount(vm, VisitPerspective.Client, false);
    expect(host.querySelector('button')).toBeNull();
    const row = q('[data-testid="appointment-row"]');
    expect(row?.tagName).toBe('UI-LIST-ROW');
    expect(q('[data-visually-hidden]')?.textContent?.trim()).toBe(
      vm.accessibleName,
    );
    // The client's words and face, as its own list draws them.
    expect(q('lib-visit-row-words')).toBeNull();
    expect(q('[data-trailing="barber"]')).not.toBeNull();
  });
});

describe('VisitRow · a waiting request', () => {
  it('leads a waiting request with its glyph in the stamp’s square', async () => {
    const vm = waitlistRowOf(
      georgiWaitlistRequest(),
      {
        words: visitWaitlistWordsOf(BG),
        today: FIXTURE_TODAY,
        locale: 'bg',
      },
      VISITS_LOOKUP,
    );
    const { host, q, text } = await mount(vm);

    expect(q('ui-date-tile')).toBeNull();
    const lead = q('.visit-row__lead');
    expect(lead?.hasAttribute('data-glyph')).toBe(true);
    expect(lead?.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'calendar.watching',
    );
    expect(q('[data-testid="client-visit-waitlist"]')).not.toBeNull();
    expect(text('.staff-event-head__title')).toBe('Фейд');
    // The state on a fact line of its own, the days under it: no ellipsis
    // can take the words that say this row is a request (wave D r3).
    expect(
      [...host.querySelectorAll('.staff-event-head__line')].map((line) =>
        line.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Чака свободен час', 'чт – пт, следобед']);
    // A plain row with no neighbour to keep level: its words wrap and are
    // never cut, where a visit's fact line keeps to one line.
    const head = q('lib-staff-event-head');
    expect(head?.hasAttribute('data-truncate')).toBe(false);
    expect(head?.hasAttribute('data-truncate-lines')).toBe(false);
    // …and the list row's label lets them (its `nowrap` would clip them).
    expect(
      q('[data-testid="client-visit-waitlist"]')?.hasAttribute(
        'data-label-wraps',
      ),
    ).toBe(true);
    // The glyph holds the list stamp's square (jsdom lays nothing out, so
    // the stylesheet is the contract): the tile's 44, and no other rung —
    // a row is a row, and every row's stamp is `regular` (W4).
    expect(lead?.hasAttribute('data-stamp')).toBe(false);
    const css = readFileSync(resolve(__dirname, 'visit-row.css'), 'utf8');
    const square = cssRule(css, '.visit-row__lead[data-glyph]');
    expect([square.get('inline-size'), square.get('block-size')]).toEqual([
      'var(--control-size-regular)',
      'var(--control-size-regular)',
    ]);
    expect(css).not.toMatch(/data-stamp/);
    expect(q('[data-visually-hidden]')?.textContent?.trim()).toBe(
      vm.accessibleName,
    );
  });
});

describe('VisitRow · the trailing edge', () => {
  it('keeps a row’s trailing edge in the list row’s slot, never in the head', async () => {
    const { q } = await mount(staffRow('appt-sep'));
    expect(q('lib-staff-event-head [uitrailing]')).toBeNull();
    expect(q('.visit-row__trailing')?.parentElement?.tagName).toBe(
      'UI-LIST-ROW',
    );
  });
});

describe('VisitRow · «Моите часове»', () => {
  function clientRow(id: string): VisitRowVm {
    const visit = GEORGI_VISITS.find((each) => each.id === id);
    if (visit === undefined) throw new Error(`no visit ${id}`);
    return visitRowOf(
      visit,
      {
        perspective: VisitPerspective.Client,
        grain: VisitGrain.Month,
        subjectUserId: GEORGI_UID,
        currentAppointmentId: null,
        now: NOW,
        timeZone: VISITS_TIME_ZONE,
        locale: 'bg',
        words: CLIENT_WORDS,
      },
      VISITS_LOOKUP,
    );
  }

  it('is the control: a DS row button with the ids the page and its e2e rely on', async () => {
    const vm = clientRow('appt-oct');
    const { fixture, q } = await mount(vm, VisitPerspective.Client);

    const row = q<HTMLButtonElement>('[data-testid="appointment-row"]');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.type).toBe('button');
    expect(row?.classList.contains('ui-list-row')).toBe(true);
    expect(row?.hasAttribute('data-interactive')).toBe(true);
    expect(row?.getAttribute('data-appointment-id')).toBe('appt-oct');
    expect(row?.getAttribute('data-status')).toBe('PENDING');
    expect(row?.getAttribute('aria-label')).toBe(vm.accessibleName);
    expect(q('lib-visit-row')?.getAttribute('role')).toBe('listitem');

    row?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual(['appt-oct']);
  });

  it('stamps the month over the day of an hour still to come, the weekday with the time as the facts, the barber’s face trailing (OR-56 b)', async () => {
    const { q, text } = await mount(
      clientRow('appt-oct'),
      VisitPerspective.Client,
    );

    expect(text('.ui-date-tile__caption')).toBe('окт.');
    expect(text('.ui-date-tile__day')).toBe('2');
    expect(q('ui-date-tile')?.getAttribute('data-tone')).toBe('upcoming');
    expect(text('.staff-event-head__line')).toBe('Иван · пт, 10:00');
    const face = q('[data-trailing="barber"]');
    expect(face?.tagName).toBe('UI-AVATAR');
    expect(face?.getAttribute('data-control-size')).toBe('small');
    // A face is detail, not the row's figure: the slot keeps its secondary.
    expect(
      q('[data-testid="appointment-row"]')?.hasAttribute(
        'data-trailing-prominence',
      ),
    ).toBe(false);
    expect(q('[data-visually-hidden]')).toBeNull();
  });

  it('gives a party cut by several the “anyone” glyph on the same disc', async () => {
    const vm: VisitRowVm = {
      ...clientRow('appt-oct'),
      trailing: {
        avatarSrc: null,
        name: CLIENT_WORDS.severalBarbers(2),
        several: true,
      },
    };
    const { q } = await mount(vm, VisitPerspective.Client);
    expect(
      q('[data-trailing="barber"] [data-name="booking.anyBarber"]'),
    ).not.toBeNull();
  });

  it('strikes a cancelled visit on the client’s own list too, in the full ink', async () => {
    const { q } = await mount(
      clientRow('appt-jul-cancelled'),
      VisitPerspective.Client,
    );
    const row = q('[data-testid="appointment-row"]');
    expect(row?.getAttribute('data-status')).toBe('CANCELLED');
    expect(row?.hasAttribute('data-receded')).toBe(false);
    expect(q('lib-staff-event-head')?.hasAttribute('data-struck')).toBe(true);
  });

  it('fades nothing: no drawn part of a row carries an opacity of its own', () => {
    const css = readFileSync(resolve(__dirname, 'visit-row.css'), 'utf8');
    expect(css).not.toMatch(/\bopacity\s*:/);
    expect(css).not.toMatch(/data-receded/);
  });
});
