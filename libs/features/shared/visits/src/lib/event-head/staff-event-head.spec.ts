import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { cssRule } from '../testing/css-rule';
import { StaffEventHead, hollowStatus } from './staff-event-head';
import type { StaffEventLine } from './staff-event-line';

@Component({
  imports: [StaffEventHead],
  template: `
    <lib-staff-event-head
      [size]="size()"
      title="Георги Петров"
      [lines]="lines()"
      [inline]="inline()"
      [start]="start()"
      [end]="end()"
      [gloss]="gloss()"
      [glossState]="glossState()"
      [timesDecorative]="decorative()"
      [struck]="struck()"
      [receded]="receded()"
      [quote]="quote()"
      [truncateLines]="truncateLines()"
      timesTestId="times"
      quoteTestId="quote"
    />
  `,
})
class Host {
  readonly size = signal<'compact' | 'regular'>('regular');
  readonly lines = signal<readonly StaffEventLine[]>([
    { text: 'georgi@test.local', icon: 'contact.email', testId: 'email' },
    { text: 'Фейд' },
  ]);
  readonly inline = signal(false);
  readonly start = signal<string | null>('10:00');
  readonly end = signal<string | null>('10:45');
  readonly gloss = signal<string | null>('след 2 ч');
  readonly glossState = signal(false);
  readonly decorative = signal(false);
  readonly struck = signal(false);
  readonly receded = signal(false);
  readonly quote = signal<string | null>(null);
  readonly truncateLines = signal(false);
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const text = (sel: string) =>
    q(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  return { fixture, host, q, text };
}

describe('StaffEventHead', () => {
  it('sets the words on the left and the clock on the right, stamped with its density', async () => {
    const { q, text } = await render();
    expect(q('.staff-event-head')?.getAttribute('data-size')).toBe('regular');
    expect(text('.staff-event-head__title')).toBe('Георги Петров');
    const lines = [
      ...(q('.staff-event-head__lines')?.querySelectorAll(
        '.staff-event-head__line',
      ) ?? []),
    ];
    expect(
      lines.map((line) =>
        line.querySelector('.staff-event-head__text')?.textContent?.trim(),
      ),
    ).toEqual(['georgi@test.local', 'Фейд']);
    // The glyph leads only the line that asked for one, and never speaks.
    expect(
      lines[0]?.querySelector('ui-icon')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(lines[1]?.querySelector('ui-icon')).toBeNull();
    expect(lines[0]?.getAttribute('data-testid')).toBe('email');
    const times = q('.staff-event-head__times');
    expect(times?.getAttribute('data-testid')).toBe('times');
    expect(times?.getAttribute('aria-hidden')).toBeNull();
    expect(text('.staff-event-head__start')).toBe('10:00');
    expect(text('.staff-event-head__end')).toBe('10:45');
    expect(text('.staff-event-head__gloss')).toBe('след 2 ч');
  });

  it('rides the first line on the title for a block too short for two, and withholds a clock it was not given', async () => {
    const { fixture, q, text } = await render();
    fixture.componentInstance.size.set('compact');
    fixture.componentInstance.inline.set(true);
    fixture.componentInstance.end.set(null);
    fixture.componentInstance.gloss.set(null);
    fixture.componentInstance.decorative.set(true);
    fixture.detectChanges();
    expect(q('.staff-event-head')?.getAttribute('data-size')).toBe('compact');
    expect(text('.staff-event-head__title')).toBe(
      'Георги Петров · georgi@test.local',
    );
    expect(q('.staff-event-head__sep')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(text('.staff-event-head__inline')).toBe('georgi@test.local');
    // The line that moved up is not also stacked; the next one still is.
    expect(
      [
        ...(q('.staff-event-head__lines')?.querySelectorAll(
          '.staff-event-head__line',
        ) ?? []),
      ].length,
    ).toBe(1);
    expect(text('.staff-event-head__line')).toBe('Фейд');
    // A decorative clock is hidden from a reader — the host's name has the times.
    expect(q('.staff-event-head__times')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(text('.staff-event-head__start')).toBe('10:00');
    expect(q('.staff-event-head__end')).toBeNull();
    expect(q('.staff-event-head__gloss')).toBeNull();
    // No clock at all when there is nothing to say on the right.
    fixture.componentInstance.start.set(null);
    fixture.detectChanges();
    expect(q('.staff-event-head__times')).toBeNull();
  });

  /*
   * The states are the head's own, from INPUTS — never a host's rule
   * reaching in: the agenda's stylesheet is view-scoped, and its rule for
   * a struck title could not match a title in this view, so the no-show
   * silently lost its strike (2026-09-17).
   */
  it('stamps the states its hosts pass — struck for an hour that did not happen, receded for a past one', async () => {
    const { fixture, q } = await render();
    const head = q('.staff-event-head');
    if (!head) throw new Error('the event head did not render');
    expect(head.hasAttribute('data-struck')).toBe(false);
    expect(head.hasAttribute('data-receded')).toBe(false);
    fixture.componentInstance.struck.set(true);
    fixture.componentInstance.receded.set(true);
    fixture.detectChanges();
    expect(head.hasAttribute('data-struck')).toBe(true);
    expect(head.hasAttribute('data-receded')).toBe(true);
    // The predicate the hosts share: both hollow outcomes, nothing else.
    expect(hollowStatus(BookingStatus.Cancelled)).toBe(true);
    expect(hollowStatus(BookingStatus.NoShow)).toBe(true);
    expect(hollowStatus(BookingStatus.Completed)).toBe(false);
    expect(hollowStatus(BookingStatus.Confirmed)).toBe(false);
    expect(hollowStatus(BookingStatus.Pending)).toBe(false);
    expect(hollowStatus(null)).toBe(false);
  });
  /*
   * STRUCK, NEVER GREYED (review r5, a11y). An hour that did not happen is
   * struck on the name and moves no ink: the name keeps the foreground,
   * the facts and the clock the secondary — the roles that clear the
   * 4.5:1 floor at full strength in both themes (staff-event-head.css,
   * "and no ink moves") — and nothing under `[data-struck]` sets a colour
   * or an opacity. A struck head that still fails the floor is being faded
   * by its host, which is the host's to answer for with `receded`: that
   * lift reaches the clock's end and the gloss too, the same ink at the
   * same size as the facts. jsdom resolves no custom property, so the
   * stylesheet is the contract.
   */
  it('strikes the name and moves no ink: the facts stay secondary, and only a receded head lifts them', async () => {
    const { fixture, q } = await render();
    fixture.componentInstance.struck.set(true);
    fixture.detectChanges();
    const head = q('.staff-event-head');
    expect(head?.hasAttribute('data-struck')).toBe(true);
    expect(head?.hasAttribute('data-receded')).toBe(false);

    const css = readFileSync(
      resolve(__dirname, 'staff-event-head.css'),
      'utf8',
    );
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      ([, selector, body]) => ({
        selector: (selector ?? '').replace(/\s+/g, ' ').trim(),
        body: body ?? '',
      }),
    );
    // The strike, in the name's own ink…
    const strike = cssRule(
      css,
      '.staff-event-head[data-struck] .staff-event-head__title',
    );
    expect(strike.get('text-decoration')).toBe('line-through');
    expect(strike.get('text-decoration-color')).toBe('currentcolor');
    // …and no rule of the struck state inks or fades anything.
    const struck = rules.filter((rule) =>
      rule.selector.includes('[data-struck]'),
    );
    expect(struck.length).toBeGreaterThan(0);
    for (const rule of struck) {
      expect(rule.body).not.toMatch(/(^|[\s;])(color|opacity)\s*:/);
    }
    // The roles a struck head keeps: the title inherits the row's
    // foreground (no rule inks it), the facts and the clock's end are the
    // secondary ink — never the tertiary, which only the glyph takes, and
    // nothing here is ever "disabled".
    expect(cssRule(css, '.staff-event-head__title').has('color')).toBe(false);
    expect(cssRule(css, '.staff-event-head__line').get('color')).toBe(
      'var(--sys-color-secondary-label)',
    );
    expect(cssRule(css, '.staff-event-head__end').get('color')).toBe(
      'var(--sys-color-secondary-label)',
    );
    expect(
      rules
        .filter((rule) => /tertiary-label/.test(rule.body))
        .map((rule) => rule.selector),
    ).toEqual([
      '.staff-event-head__line ui-icon, .staff-event-head__quote ui-icon',
    ]);
    expect(bare).not.toMatch(/disabled/);
    // A host that fades a head passes `receded`, and the lift reaches every
    // secondary run on it — the facts, the quote, the clock's end and the
    // gloss (a state in the gloss keeps its foreground).
    const lifted = cssRule(
      css,
      [
        '.staff-event-head[data-receded] .staff-event-head__line',
        '.staff-event-head[data-receded] .staff-event-head__quote',
        '.staff-event-head[data-receded] .staff-event-head__end',
        '.staff-event-head[data-receded]:not([data-gloss-state]) .staff-event-head__gloss',
      ].join(', '),
    );
    expect(lifted.get('color')?.replace(/\s+/g, '')).toBe(
      'color-mix(insrgb,var(--sys-color-foreground)50%,var(--sys-color-secondary-label))',
    );
    expect(
      cssRule(
        css,
        '.staff-event-head[data-gloss-state] .staff-event-head__gloss',
      ).get('color'),
    ).toBe('var(--sys-color-foreground)');
  });

  // An hour that did not happen says so where the countdown stood
  // (owner, 2026-09-24): the gloss names a state and outranks the clock.
  it('marks a gloss that names a state, so it can outrank the clock', async () => {
    const { fixture, q } = await render();
    const host = q('lib-staff-event-head') as HTMLElement;
    expect(host.hasAttribute('data-gloss-state')).toBe(false);
    expect(host.querySelector('[data-testid="staff-event-state"]')).toBeNull();
    fixture.componentInstance.gloss.set('Отказан');
    fixture.componentInstance.glossState.set(true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-gloss-state')).toBe(true);
    expect(
      host.querySelector('[data-testid="staff-event-state"]')?.textContent,
    ).toBe('Отказан');
  });

  /*
   * The client's own words ride under the facts on a history row
   * (client-card redesign §5.3.4). Every head that never quotes — the
   * frame's block, the agenda's card, the pickers — passes nothing and
   * draws exactly what it drew before.
   */
  it('quotes the client under the facts only when given words, and never strikes them', async () => {
    const { fixture, q, text } = await render();
    expect(q('.staff-event-head__quote')).toBeNull();
    expect(q('[data-testid="quote"]')).toBeNull();

    fixture.componentInstance.quote.set('„Къса отстрани, по-дълго отгоре“');
    fixture.componentInstance.struck.set(true);
    fixture.detectChanges();

    const quote = q('.staff-event-head__quote');
    expect(quote?.getAttribute('data-testid')).toBe('quote');
    // Words, not a fact: after every fact line, inside the words' column.
    expect(quote?.parentElement?.classList).toContain(
      'staff-event-head__lines',
    );
    expect(quote?.previousElementSibling?.classList).toContain(
      'staff-event-head__line',
    );
    expect(text('.staff-event-head__quote-text')).toBe(
      '„Къса отстрани, по-дълго отгоре“',
    );
    // The glyph leads and never speaks; the host's name carries the words.
    const glyph = quote?.querySelector('ui-icon');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.getAttribute('data-name')).toBe('visit.note');
    // The strike is the title's alone — the words are evidence, kept whole.
    expect(quote?.closest('.staff-event-head__title')).toBeNull();
    // It is not a fact line either: the facts are still exactly two.
    expect(
      q('.staff-event-head__lines')?.querySelectorAll('.staff-event-head__line')
        .length,
    ).toBe(2);

    fixture.componentInstance.quote.set(null);
    fixture.detectChanges();
    expect(q('.staff-event-head__quote')).toBeNull();
  });

  /*
   * The glance's featured visit (client-card redesign, wave D): a regular
   * head whose fact lines keep to one line with an ellipsis while the
   * title still wraps whole — never a second fact line ending in a lone «·».
   */
  it('keeps only the fact lines to one line when asked, and the title wraps', async () => {
    const { fixture, q } = await render();
    const head = q('lib-staff-event-head') as HTMLElement;
    expect(head.hasAttribute('data-truncate-lines')).toBe(false);
    fixture.componentInstance.truncateLines.set(true);
    fixture.detectChanges();
    expect(head.hasAttribute('data-truncate-lines')).toBe(true);
    expect(head.hasAttribute('data-truncate')).toBe(false);

    const css = readFileSync(
      resolve(__dirname, 'staff-event-head.css'),
      'utf8',
    );
    const truncating = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /text-overflow:\s*ellipsis/.test(body ?? ''))
      .flatMap(([, selectors]) =>
        (selectors ?? '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((selector) => selector.replace(/\s+/g, ' ').trim()),
      );
    expect(truncating).toContain(
      '.staff-event-head[data-truncate-lines] .staff-event-head__line',
    );
    expect(truncating).toContain(
      '.staff-event-head[data-truncate-lines] .staff-event-head__text',
    );
    expect(truncating).not.toContain(
      '.staff-event-head[data-truncate-lines] .staff-event-head__title',
    );
  });

  /*
   * A fact that is ONE whole run — an address, a single word — has no
   * honest place to part, so it keeps to one line with an ellipsis in
   * every density; a fact with spaces still wraps at them (revision 3 final
   * polish: an agenda's long e-mail parted into three lines, the last two
   * «v-» and the domain). And the glyph that leads a fact rides its FIRST
   * line: the items align to the start, and the glyph is seated on the
   * line by half of what the leading leaves over its em box — what
   * `center` gave it while the line was one line. jsdom lays nothing out,
   * so the stylesheet is the contract for both.
   */
  it('keeps a whole run to one line, and seats the glyph on a wrapping line’s first line', async () => {
    const { fixture, q, host } = await render();
    const texts = () =>
      [...host.querySelectorAll<HTMLElement>('.staff-event-head__text')].map(
        (text) => [text.textContent?.trim(), text.hasAttribute('data-whole')],
      );
    // An address is whole; a word is whole; a service with a space is not.
    expect(texts()).toEqual([
      ['georgi@test.local', true],
      ['Фейд', true],
    ]);
    fixture.componentInstance.lines.set([
      { text: 'konstantin.pophristodulov-karageorgiev@test.local' },
      { text: '+359 88 611 2233' },
      { text: 'Класическа подстрижка' },
      { text: 'Креативо · Младост · Иван', hold: ' · Иван' },
    ]);
    fixture.detectChanges();
    expect(texts()).toEqual([
      ['konstantin.pophristodulov-karageorgiev@test.local', true],
      ['+359 88 611 2233', false],
      ['Класическа подстрижка', false],
      ['Креативо · Младост · Иван', false],
    ]);
    // Whole in every density: the regular head's wrap does not reach it.
    expect(q('.staff-event-head')?.getAttribute('data-size')).toBe('regular');
    expect(q('.staff-event-head[data-truncate]')).toBeNull();

    const css = readFileSync(
      resolve(__dirname, 'staff-event-head.css'),
      'utf8',
    );
    const whole = cssRule(css, '.staff-event-head__text[data-whole]');
    expect(whole.get('white-space')).toBe('nowrap');
    expect(whole.get('overflow')).toBe('hidden');
    expect(whole.get('text-overflow')).toBe('ellipsis');
    // The wrapping rule still names the text, for a fact with spaces.
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);

    const line = cssRule(css, '.staff-event-head__line');
    expect(line.get('align-items')).toBe('flex-start');
    const glyph = cssRule(css, '.staff-event-head__line ui-icon');
    expect(glyph.get('margin-block-start')?.replace(/\s+/g, '')).toBe(
      'calc((var(--staff-event-line-size)*var(--staff-event-leading)-var(--staff-event-icon-size))/2)',
    );
    // The leading the seat is computed from is the head's one leading.
    const head = cssRule(css, '.staff-event-head');
    expect(head.get('--staff-event-leading')).toBe('1.3');
    expect(head.get('line-height')).toBe('var(--staff-event-leading)');
  });

  /*
   * A wrapping title never leaves a word alone on its last line (wave D
   * r4: «Фейд · Оформяне на / брада» beside the glance's price). jsdom
   * breaks no lines, so the stylesheet is the contract: the wrap STYLE
   * longhand, never the shorthand that would reset a one-line title's
   * wrap mode.
   */
  it('wraps its title without an orphan, and leaves the wrap mode alone', () => {
    const css = readFileSync(
      resolve(__dirname, 'staff-event-head.css'),
      'utf8',
    );
    const title = cssRule(css, '.staff-event-head__title');
    expect(title.get('text-wrap-style')).toBe('pretty');
    expect(title.has('text-wrap')).toBe(false);
    expect(title.has('text-wrap-mode')).toBe(false);
  });

  /*
   * A history row's facts close on the barber (client-card redesign,
   * wave D r2). Where the lines keep to one line, that closing run is held
   * and the ellipsis takes the runs before it, so a long shop name never
   * pushes out who did the cut. A wrapping line has no ellipsis to steer.
   */
  it('holds a line’s closing run against the ellipsis, only where its lines keep to one line', async () => {
    const { fixture, q, text } = await render();
    fixture.componentInstance.lines.set([
      { text: 'Креативо · Младост · Иван', hold: ' · Иван' },
    ]);
    fixture.detectChanges();
    // A wrapping head draws the line whole, as it always did.
    expect(q('.staff-event-head__text')?.hasAttribute('data-held')).toBe(false);
    expect(q('.staff-event-head__hold')).toBeNull();
    expect(text('.staff-event-head__text')).toBe('Креативо · Младост · Иван');

    fixture.componentInstance.truncateLines.set(true);
    fixture.detectChanges();
    const run = q('.staff-event-head__text');
    expect(run?.hasAttribute('data-held')).toBe(true);
    expect(q('.staff-event-head__lead')?.textContent).toBe(
      'Креативо · Младост',
    );
    // The joint travels with the held run, so the line still reads whole.
    expect(q('.staff-event-head__hold')?.textContent).toBe(' · Иван');
    expect(run?.textContent).toBe('Креативо · Младост · Иван');

    // A hold that is not the line's own end is not a run of it.
    fixture.componentInstance.lines.set([
      { text: 'Център · Иван', hold: ' · Нико' },
    ]);
    fixture.detectChanges();
    expect(q('.staff-event-head__hold')).toBeNull();
    expect(text('.staff-event-head__text')).toBe('Център · Иван');

    // jsdom lays nothing out, so the stylesheet is the contract: the lead
    // gives way with an ellipsis, and the held run keeps its width and its
    // leading joint.
    const css = readFileSync(
      resolve(__dirname, 'staff-event-head.css'),
      'utf8',
    );
    const declarations = (selector: string) => cssRule(css, selector);
    const held = declarations('.staff-event-head__text[data-held]');
    expect(held.get('display')).toBe('flex');
    const lead = declarations('.staff-event-head__lead');
    expect(lead.get('min-inline-size')).toBe('0');
    expect(lead.get('text-overflow')).toBe('ellipsis');
    const hold = declarations('.staff-event-head__hold');
    expect(hold.get('flex')).toBe('none');
    expect(hold.get('white-space')).toBe('pre');
  });

  /*
   * The title's trailing slot (wave D r2): the glance's featured visit ends
   * the title's line with its money, and the facts keep the whole width.
   */
  it('sets a projected `[uiTrailing]` right after the title, and draws nothing there without one', async () => {
    @Component({
      imports: [StaffEventHead],
      template: `
        <lib-staff-event-head
          title="Фейд"
          [lines]="[{ text: 'Център · Иван' }]"
          quote="„Същото“"
        >
          @if (figure()) {
            <span uiTrailing data-testid="figure">27,50 €</span>
          }
        </lib-staff-event-head>
      `,
    })
    class SlotHost {
      readonly figure = signal(true);
    }
    await TestBed.configureTestingModule({
      imports: [SlotHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(SlotHost);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const lines = host.querySelector('.staff-event-head__lines');
    const order = () =>
      [...(lines?.children ?? [])].map(
        (child) => child.getAttribute('data-testid') ?? child.className,
      );
    expect(order()).toEqual([
      'staff-event-head__title',
      'figure',
      'staff-event-head__line',
      'staff-event-head__quote',
    ]);

    fixture.componentInstance.figure.set(false);
    fixture.detectChanges();
    expect(order()).toEqual([
      'staff-event-head__title',
      'staff-event-head__line',
      'staff-event-head__quote',
    ]);
  });
});
