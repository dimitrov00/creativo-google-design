import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';
import { UiCouponCard } from './coupon-card';
import { UiOccasionBand } from './occasion-band';

const css = readFileSync(resolve(__dirname, 'coupon-card.css'), 'utf8');

@Component({
  imports: [UiCouponCard, UiInteractiveDirective],
  template: `
    <button
      uiCouponCard
      uiInteractive
      uiTitle="Първо посещение"
      [uiValue]="value()"
      [uiCode]="code()"
      [uiDetail]="detail()"
      [uiUnavailable]="blocked()"
      data-testid="card"
      (click)="taps = taps + 1"
    >
      <span uiCouponGlyph data-testid="glyph">✦</span>
      @if (blocked()) {
        <span uiCouponBadge data-testid="badge">⊘</span>
      }
    </button>
  `,
})
class Host {
  readonly value = signal<string | null>('−2,80 €');
  readonly code = signal<string | null>('FIRST10');
  readonly detail = signal<string | null>('−10% · комбинира се');
  readonly blocked = signal(false);
  taps = 0;
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const card = host.querySelector<HTMLButtonElement>('[data-testid="card"]');
  if (!card) throw new Error('no card');
  const text = (sel: string) => card.querySelector(sel)?.textContent?.trim();
  return { fixture, card, text };
}

describe('UiCouponCard', () => {
  it('is one button: the name over the value with its code, the conditions in a chip, the glyph the host gave', async () => {
    const { fixture, card, text } = await render();
    expect(card.tagName).toBe('BUTTON');
    expect(card.classList.contains('ui-coupon-card')).toBe(true);
    // The one sanctioned hover/press grammar rides along.
    expect(card.hasAttribute('data-interactive')).toBe(true);
    expect(text('.ui-coupon-card__title')).toBe('Първо посещение');
    expect(text('.ui-coupon-card__value')).toBe('−2,80 €');
    expect(text('.ui-coupon-card__code')).toBe('FIRST10');
    expect(text('.ui-coupon-card__detail')).toBe('−10% · комбинира се');
    // The ticket writes no call of its own (revision 3 §3.4, W4): the
    // call is the pill a host projects into `[uiCouponAction]`.
    expect(card.querySelector('.ui-coupon-card__action')).toBeNull();
    expect(
      card.querySelector('.ui-coupon-card__glyph [data-testid="glyph"]'),
    ).not.toBeNull();
    // Decoration to a reader: the button's text is the offer.
    expect(
      card.querySelector('.ui-coupon-card__glyph')?.getAttribute('aria-hidden'),
    ).toBe('true');
    card.click();
    expect(fixture.componentInstance.taps).toBe(1);
  });

  it('drops the code and the conditions when there are none: the foot keeps its slot and holds no placeholder', async () => {
    const { fixture, card } = await render();
    fixture.componentInstance.code.set(null);
    fixture.componentInstance.detail.set(null);
    fixture.detectChanges();
    expect(card.querySelector('.ui-coupon-card__code')).toBeNull();
    // The foot stays in the DOM (it is where a host projects the call)
    // and holds NOTHING: an empty span would read as content to the sheet's
    // bare-ticket rule, which collapses the foot and the tear (2026-10-06;
    // the wallet's reward ticket ended in a tear over a blank band).
    const foot = card.querySelector('.ui-coupon-card__foot');
    expect(foot).not.toBeNull();
    expect(foot?.childElementCount).toBe(0);
    expect(card.querySelector('.ui-coupon-card__detail')).toBeNull();
    expect(card.querySelector('.ui-coupon-card__detail--none')).toBeNull();
    // The chip back: the foot has content again.
    fixture.componentInstance.detail.set('до 28.10');
    fixture.detectChanges();
    expect(foot?.childElementCount).toBe(1);
  });

  it('prints no figure when the name already says the rule: the name alone, the code kept when there is one', async () => {
    const { fixture, card, text } = await render();
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();
    expect(card.querySelector('.ui-coupon-card__value')).toBeNull();
    expect(text('.ui-coupon-card__code')).toBe('FIRST10');
    // Nothing on the line at all: the line goes, the name is the head.
    fixture.componentInstance.code.set(null);
    fixture.detectChanges();
    expect(card.querySelector('.ui-coupon-card__figures')).toBeNull();
    expect(text('.ui-coupon-card__title')).toBe('Първо посещение');
    // The foot stays where it was.
    expect(text('.ui-coupon-card__detail')).toBe('−10% · комбинира се');
  });

  it('is muted and inert when it cannot be used, the reason in the badge slot the check takes when applied', async () => {
    const { fixture, card } = await render();
    expect(card.hasAttribute('data-unavailable')).toBe(false);
    expect(card.disabled).toBe(false);
    fixture.componentInstance.blocked.set(true);
    fixture.detectChanges();
    // One slot, three states: the host's glyph lands where the check would.
    expect(card.hasAttribute('data-unavailable')).toBe(true);
    expect(card.disabled).toBe(true);
    expect(
      card.querySelector('.ui-coupon-card__badge [data-testid="badge"]'),
    ).not.toBeNull();
    card.click();
    expect(fixture.componentInstance.taps).toBe(0);
  });
});

@Component({
  imports: [UiCouponCard],
  template: `
    <article
      uiCouponCard
      [uiApplied]="true"
      uiTitle="Брада −5 €"
      uiValue="−5,00 €"
      uiCode="BEARD5"
      uiDetail="комбинира се"
      uiTestId="line"
      data-testid="ticket"
    >
      <span uiCouponGlyph>✦</span>
      <span uiCouponBadge data-testid="badge">✓</span>
      <button
        type="button"
        uiCouponAction
        data-testid="remove"
        (click)="removed = removed + 1"
      >
        Премахни
      </button>
    </article>
  `,
})
class AppliedHost {
  removed = 0;
}

describe('UiCouponCard on the bill', () => {
  it('is an article, not a button — no type, no press grammar — stamped and with a real action where the call stood', async () => {
    await TestBed.configureTestingModule({
      imports: [AppliedHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppliedHost);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const ticket = host.querySelector<HTMLElement>('[data-testid="ticket"]');
    if (!ticket) throw new Error('no ticket');
    expect(ticket.tagName).toBe('ARTICLE');
    expect(ticket.classList.contains('ui-coupon-card')).toBe(true);
    expect(ticket.hasAttribute('type')).toBe(false);
    expect(ticket.hasAttribute('data-interactive')).toBe(false);
    expect(ticket.hasAttribute('data-applied')).toBe(true);
    // The parts, stamped for a test.
    expect(host.querySelector('[data-testid="line-value"]')?.textContent).toBe(
      '−5,00 €',
    );
    expect(host.querySelector('[data-testid="line-code"]')?.textContent).toBe(
      'BEARD5',
    );
    expect(host.querySelector('[data-testid="line-detail"]')?.textContent).toBe(
      'комбинира се',
    );
    // The badge sits inside the glyph's box; the action inside the foot.
    expect(
      host
        .querySelector('[data-testid="badge"]')
        ?.closest('.ui-coupon-card__badge')
        ?.parentElement?.classList.contains('ui-coupon-card__glyph'),
    ).toBe(true);
    const remove = host.querySelector<HTMLButtonElement>(
      '[data-testid="remove"]',
    );
    expect(remove?.closest('.ui-coupon-card__foot')).not.toBeNull();
    remove?.click();
    expect(fixture.componentInstance.removed).toBe(1);
  });
});

describe('UiCouponCard, the paper and the figure', () => {
  it('lays the paper first, behind the content, as decoration', async () => {
    const { card } = await render();
    const paper = card.firstElementChild;
    expect(paper?.className).toBe('ui-coupon-card__paper');
    expect(paper?.getAttribute('aria-hidden')).toBe('true');
    expect(paper?.childElementCount).toBe(0);
    // The parts, in order: the paper, the head, the foot.
    expect([...card.children].map((child) => child.className)).toEqual([
      'ui-coupon-card__paper',
      'ui-coupon-card__head',
      'ui-coupon-card__foot',
    ]);
  });

  it('says whether it prints a figure, so the name can take the headline', async () => {
    const { fixture, card } = await render();
    expect(card.hasAttribute('data-valued')).toBe(true);
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();
    expect(card.hasAttribute('data-valued')).toBe(false);
    // An empty figure is no figure.
    fixture.componentInstance.value.set('');
    fixture.detectChanges();
    expect(card.hasAttribute('data-valued')).toBe(false);
    expect(card.querySelector('.ui-coupon-card__value')).toBeNull();
  });

  it('keeps the name first for a reader: the figure leads only on the eye', async () => {
    const { card } = await render();
    const lines = card.querySelector('.ui-coupon-card__lines');
    expect(
      [...(lines?.children ?? [])].map((child) => child.className),
    ).toEqual(['ui-coupon-card__title', 'ui-coupon-card__figures']);
    expect(card.hasAttribute('data-occasion')).toBe(false);
  });
});

@Component({
  imports: [UiCouponCard, UiInteractiveDirective, UiOccasionBand],
  template: `
    <button
      uiCouponCard
      uiInteractive
      uiTitle="Подарък от салона"
      [uiValue]="value()"
      uiDetail="до 28.10"
      data-testid="card"
      (click)="taps = taps + 1"
    >
      @if (birthday()) {
        <ui-occasion-band uiTitle="Рожден ден · 34 г." data-testid="band">
          <span uiOccasionGlyph>🎂</span>
        </ui-occasion-band>
      }
      <span uiCouponAction aria-hidden="true" data-testid="pill"
        >Използвай</span
      >
    </button>
  `,
})
class OccasionHost {
  readonly birthday = signal(true);
  readonly value = signal<string | null>('−20 %');
  taps = 0;
}

describe('UiCouponCard with an occasion', () => {
  function occasion() {
    TestBed.configureTestingModule({
      imports: [OccasionHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    });
    const fixture = TestBed.createComponent(OccasionHost);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLButtonElement>('[data-testid="card"]');
    if (!card) throw new Error('no card');
    return { fixture, card };
  }

  it('finds the band the host projected and says so on itself', () => {
    const { card } = occasion();
    expect(card.hasAttribute('data-occasion')).toBe(true);
    expect(card.getAttribute('data-occasion')).toBe('');
  });

  it('stands the band over the body: after the paper, before the head, a child of the ticket', () => {
    const { card } = occasion();
    const band = card.querySelector('[data-testid="band"]');
    expect(band?.parentElement).toBe(card);
    expect(band?.classList.contains('ui-occasion-band')).toBe(true);
    expect([...card.children].map((child) => child.classList[0])).toEqual([
      'ui-coupon-card__paper',
      'ui-occasion-band',
      'ui-coupon-card__head',
      'ui-coupon-card__foot',
    ]);
    expect(
      card.querySelector('.ui-occasion-band__title')?.textContent?.trim(),
    ).toBe('Рожден ден · 34 г.');
  });

  it('is still ONE control, with its figure, its name and the pill it wears', () => {
    const { fixture, card } = occasion();
    expect(card.tagName).toBe('BUTTON');
    expect(card.querySelector('.ui-coupon-card__value')?.textContent).toBe(
      '−20 %',
    );
    expect(
      card.querySelector('.ui-coupon-card__title')?.textContent?.trim(),
    ).toBe('Подарък от салона');
    const pill = card.querySelector('[data-testid="pill"]');
    expect(pill?.closest('.ui-coupon-card__foot')).not.toBeNull();
    // Dress, not a second control: nothing inside the ticket takes focus.
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
    card.click();
    expect(fixture.componentInstance.taps).toBe(1);
  });

  it('is an ordinary ticket again the moment the band goes', () => {
    const { fixture, card } = occasion();
    fixture.componentInstance.birthday.set(false);
    fixture.detectChanges();
    expect(card.hasAttribute('data-occasion')).toBe(false);
    expect(card.querySelector('.ui-occasion-band')).toBeNull();
    fixture.componentInstance.birthday.set(true);
    fixture.detectChanges();
    expect(card.hasAttribute('data-occasion')).toBe(true);
  });
});

describe('the ticket’s stylesheet', () => {
  interface Rule {
    readonly selector: string;
    readonly body: string;
  }

  /** Whitespace folded, and none inside a bracket: `f( a )` reads `f(a)`. */
  const fold = (text: string): string =>
    text
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim();

  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /** Every style rule, comments stripped: the innermost blocks of the sheet. */
  const rules: Rule[] = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({
      selector: fold(selector as string),
      body: fold(body as string),
    }),
  );

  /** The declarations of the rule with exactly this selector. */
  const rule = (selector: string): string => {
    const wanted = fold(selector);
    const match = rules.find((one) => one.selector === wanted);
    if (!match) throw new Error(`coupon-card.css has no "${wanted}" rule`);
    return match.body;
  };

  const LIFT =
    'drop-shadow(var(--ui-coupon-card-shadow, var(--sys-elevation-raised-drop)))';
  const PAPER =
    'var(--ui-coupon-card-surface, var(--sys-color-surface-elevated))';

  describe('the paper', () => {
    it('is a part of its own behind the content: the fill, the corner, the mask', () => {
      const paper = rule('.ui-coupon-card__paper');
      expect(paper).toContain('position: absolute');
      expect(paper).toContain('inset: 0');
      expect(paper).toContain('z-index: -1');
      expect(paper).toContain('border-radius: inherit');
      expect(paper).toContain(`background: ${PAPER}`);
      // Inside the ticket's own stacking context, never under the ground.
      expect(rule('.ui-coupon-card')).toContain('isolation: isolate');
    });

    it('is white by default: the elevated surface, and the badge’s ring follows the same hook', () => {
      expect(rule('.ui-coupon-card__badge')).toContain(
        `box-shadow: 0 0 0 2px ${PAPER}`,
      );
      // The grey row fill left the ticket.
      expect(source).not.toContain('--sys-color-surface-secondary');
    });

    it('leaves the host free of paint and of the mask, so its shadow survives', () => {
      const host = rule('.ui-coupon-card');
      expect(host).toContain('background: none');
      expect(host).not.toContain('mask');
      expect(host).not.toContain('box-shadow');
      expect(host).toContain(`filter: ${LIFT}`);
    });

    it('cuts ONE silhouette for three wearers: the paper, the focus ring, the press layer', () => {
      const masked = rule(
        '.ui-coupon-card__paper, .ui-coupon-card::before, .ui-coupon-card::after',
      );
      expect(masked).toContain(
        'radial-gradient(circle at 0 var(--ui-coupon-card-tear), transparent var(--ui-coupon-card-notch), #000 calc(var(--ui-coupon-card-notch) + 1px))',
      );
      expect(masked).toContain(
        'radial-gradient(circle at 100% var(--ui-coupon-card-tear), transparent var(--ui-coupon-card-notch), #000 calc(var(--ui-coupon-card-notch) + 1px))',
      );
      expect(masked).toContain('mask-composite: intersect');
      expect(masked).toContain('-webkit-mask-composite: source-in');
    });

    it('rings the focus inside the box, in the silhouette, and drops the shared outline', () => {
      expect(rule('.ui-coupon-card:where(button):focus-visible::before')).toBe(
        'box-shadow: inset 0 0 0 var(--sys-focus-ring-width) var(--sys-color-ring);',
      );
      // Heavier than `[data-interactive]:focus-visible`, whatever the order.
      expect(rule('.ui-coupon-card:is(button, article):focus-visible')).toBe(
        'outline: none;',
      );
      const ring = rule('.ui-coupon-card::before');
      expect(ring).toContain("content: ''");
      expect(ring).toContain('inset: 0');
      expect(ring).toContain('border-radius: inherit');
      expect(ring).toContain('pointer-events: none');
    });

    it('draws the ring for the button form only: an article that takes the focus is a landing, not a control (2026-10-06)', () => {
      // ‹ from the discount page lands on the stamped ticket it came from,
      // as it lands on a page's heading: the page's anchors draw no ring,
      // and neither does the ticket read. The outline reset still names
      // both forms, so the UA's own ring never shows on the article.
      const focused = rules
        .filter((one) => one.selector.includes(':focus-visible'))
        .map((one) => one.selector);
      expect(focused).toEqual([
        '.ui-coupon-card:is(button, article):focus-visible',
        '.ui-coupon-card:where(button):focus-visible::before',
      ]);
      // The same weight as before: `:where()` adds none, so the ring still
      // outranks the interactive grammar's outline on the button.
      expect(source).not.toContain('.ui-coupon-card:focus-visible::before');
    });

    it('hugs its content beside a taller neighbour: a grid never stretches the foot off the head (2026-10-06)', () => {
      // The wallet's holdings two to a row in the ≥ 761 dialog: a cell
      // stretched to the row pinned the foot to the paper's bottom and
      // left a blank band under the head.
      expect(rule('.ui-coupon-card')).toContain('align-self: start');
    });
  });

  describe('the lift', () => {
    it('is ONE shadow cast by what was painted', () => {
      const filters = rules
        .filter((one) => /(?<![\w-])filter:/.test(one.body))
        .map((one) => one.selector);
      expect(filters).toEqual([
        '.ui-coupon-card',
        '.ui-coupon-card[data-unavailable]',
      ]);
    });

    it('survives the muted ticket: the unavailable rule holds BOTH functions', () => {
      const muted = rule('.ui-coupon-card[data-unavailable]');
      expect(muted).toContain(`filter: ${LIFT} saturate(0.35);`);
      expect(muted).toContain('opacity: 0.55');
      // One declaration, not two: the second would replace the first.
      expect(muted.match(/(?<![\w-])filter:/g)).toHaveLength(1);
    });
  });

  describe('the one orange', () => {
    it('reads no darker cut of the accent', () => {
      expect(source).not.toContain('--sys-color-promo-label');
      expect(source).not.toContain('--sys-color-accent-label');
    });

    it('paints the accent as `color` on the glyph and on the figure, nowhere else', () => {
      const tinted = rules
        .filter((one) =>
          /(?<![\w-])color:\s*var\(--sys-color-(?:promo|accent)\)/.test(
            one.body,
          ),
        )
        .map((one) => one.selector);
      expect(tinted).toEqual([
        '.ui-coupon-card__glyph',
        '.ui-coupon-card__value',
      ]);
    });

    it('draws the glyph at 24 on a 44 disc in the accent’s wash', () => {
      const glyph = rule('.ui-coupon-card__glyph');
      expect(glyph).toContain('inline-size: var(--control-size-regular)');
      expect(glyph).toContain('block-size: var(--control-size-regular)');
      expect(glyph).toContain('border-radius: var(--control-radius-capsule)');
      expect(glyph).toContain(
        'background: color-mix(in srgb, var(--sys-color-promo) var(--sys-alpha-tint), transparent)',
      );
      expect(glyph).toContain('font-size: calc(var(--sys-space-unit) * 6)');
      expect(glyph).toContain('color: var(--sys-color-promo)');
    });

    it('sets the figure as a display figure, above the name', () => {
      const value = rule('.ui-coupon-card__value');
      expect(value).toContain('font: var(--sys-font-title2)');
      expect(value).toContain('font-variant-numeric: tabular-nums');
      expect(value).toContain('color: var(--sys-color-promo)');
      expect(value).toContain('order: -1');
      // The shorthand stands alone: no weight is patched onto it.
      expect(value).not.toContain('font-weight');
      // Its line leads the name only when it holds a figure: a code alone
      // stays under the name.
      expect(
        rule('.ui-coupon-card[data-valued] .ui-coupon-card__figures'),
      ).toBe('order: -1;');
      expect(rule('.ui-coupon-card__figures')).not.toContain('order');
    });

    it('sets the name in ink: a caption under a figure, the headline alone', () => {
      const title = rule('.ui-coupon-card__title');
      expect(title).toContain('font: var(--sys-font-callout)');
      expect(title).toContain('font-weight: 600');
      expect(title).not.toMatch(/(?<![\w-])color:/);
      const alone = rule(
        '.ui-coupon-card:not([data-valued]) .ui-coupon-card__title',
      );
      expect(alone).toContain('font: var(--sys-font-headline)');
      expect(alone).toContain('font-variant-numeric: tabular-nums');
    });

    it('mutes the disc and the figure together when the ticket cannot be used', () => {
      expect(
        rule(
          '.ui-coupon-card[data-unavailable] .ui-coupon-card__glyph, .ui-coupon-card[data-unavailable] .ui-coupon-card__value',
        ),
      ).toBe('color: var(--sys-color-secondary-label);');
      expect(
        rule('.ui-coupon-card[data-unavailable] .ui-coupon-card__glyph'),
      ).toBe('background: var(--sys-color-fill);');
    });
  });

  describe('the tear', () => {
    it('runs a foot’s height from the bottom, measured from the top', () => {
      const host = rule('.ui-coupon-card');
      expect(host).toContain(
        '--ui-coupon-card-tear: calc(100% - var(--ui-coupon-card-foot))',
      );
      const line = rule('.ui-coupon-card__paper::before');
      expect(line).toContain('inset-block-start: var(--ui-coupon-card-tear)');
      expect(line).toContain(
        'inset-inline: calc(var(--ui-coupon-card-notch) + var(--sys-space-tight))',
      );
      expect(line).toContain('dashed');
      // The foot keeps its height and draws no line of its own.
      expect(rule('.ui-coupon-card__foot')).toContain(
        'block-size: var(--ui-coupon-card-foot)',
      );
      expect(rules.map((one) => one.selector)).not.toContain(
        '.ui-coupon-card__foot::before',
      );
    });

    it('moves to the seam under the band, by the band’s own height', () => {
      // Read on the ticket with the band's default: a property set on the
      // band is invisible to its parent.
      expect(rule('.ui-coupon-card[data-occasion]')).toBe(
        '--ui-coupon-card-tear: var(--ui-occasion-band-height, 6rem);',
      );
      // The notches follow, since the mask reads the same property.
      expect(
        rule(
          '.ui-coupon-card__paper, .ui-coupon-card::before, .ui-coupon-card::after',
        ).match(/var\(--ui-coupon-card-tear\)/g),
      ).toHaveLength(2);
    });

    it('is a perforation on the seam, in the paper’s own colour, and the line under it goes', () => {
      expect(
        rule('.ui-coupon-card[data-occasion] .ui-coupon-card__paper::before'),
      ).toBe('content: none;');
      const seam = rule(
        '.ui-coupon-card[data-occasion] .ui-coupon-card__head::before',
      );
      expect(seam).toContain(`dashed ${PAPER}`);
      expect(seam).toContain(
        'inset-block-start: calc(var(--sys-stroke-emphasis) * -1)',
      );
      expect(seam).toContain(
        'inset-inline: calc(var(--ui-coupon-card-notch) + var(--sys-space-tight))',
      );
    });
  });

  describe('with an occasion', () => {
    it('squares the band’s foot, takes its lift and cuts the notches into it', () => {
      const band = rule('.ui-coupon-card > .ui-occasion-band');
      expect(band).toContain('border-end-start-radius: 0');
      expect(band).toContain('border-end-end-radius: 0');
      expect(band).toContain('box-shadow: none');
      expect(band).toContain(
        'radial-gradient(circle at 0 100%, transparent var(--ui-coupon-card-notch), #000 calc(var(--ui-coupon-card-notch) + 1px))',
      );
      expect(band).toContain(
        'radial-gradient(circle at 100% 100%, transparent var(--ui-coupon-card-notch), #000 calc(var(--ui-coupon-card-notch) + 1px))',
      );
      expect(band).toContain('mask-composite: intersect');
    });

    it('draws no disc in the body: the band’s disc carries the glyph', () => {
      const glyph = rule(
        '.ui-coupon-card[data-occasion] .ui-coupon-card__glyph',
      );
      expect(glyph).toContain('background: none');
      expect(glyph).toContain('inline-size: auto');
      expect(
        rule(
          '.ui-coupon-card[data-occasion] .ui-coupon-card__glyph > [uiCouponGlyph]',
        ),
      ).toBe('display: none;');
      // No badge either: the box goes.
      expect(
        rule(
          '.ui-coupon-card[data-occasion] .ui-coupon-card__glyph:has(> .ui-coupon-card__badge:empty)',
        ),
      ).toBe('display: none;');
    });

    it('stands the badge beside the figure, a stamp of its own', () => {
      const badge = rule(
        '.ui-coupon-card[data-occasion] .ui-coupon-card__badge',
      );
      expect(badge).toContain('position: static');
      expect(badge).toContain('box-shadow: none');
      const order = (selector: string): number =>
        Number(/(?<![\w-])order: (-?\d+)/.exec(rule(selector))?.[1]);
      const scoped = '.ui-coupon-card[data-occasion] .ui-coupon-card__';
      expect([
        order(`${scoped}value`),
        order(`${scoped}glyph`),
        order(`${scoped}code`),
        order(`${scoped}title`),
      ]).toEqual([1, 2, 3, 4]);
      // The name takes a line of its own under them.
      expect(rule(`${scoped}title`)).toContain('flex: 1 0 100%');
    });
  });

  describe('the call', () => {
    it('hangs a PLAIN button past the inset and stands a filled pill on it', () => {
      expect(rule('.ui-coupon-card__foot > [uiCouponAction]')).toBe(
        'flex: 0 0 auto; margin-inline-start: auto;',
      );
      expect(
        rule(
          ".ui-coupon-card__foot > [uiCouponAction][data-button-style='plain']",
        ),
      ).toBe('margin-inline-end: calc(var(--sys-space-compact) * -1);');
    });

    it('keeps a lone call at the trailing edge by its own margin, never a placeholder in the chip’s place', () => {
      expect(rule('.ui-coupon-card__foot > [uiCouponAction]')).toContain(
        'margin-inline-start: auto',
      );
      // The empty chip is gone from the sheet with the span it dressed…
      expect(source).not.toContain('__detail--none');
      // …and so is the written call (revision 3 §3.4, W4): the projected
      // pill is the one call, and the sheet dresses no other.
      expect(source).not.toContain('__action');
    });
  });

  describe('a ticket without conditions (2026-10-06)', () => {
    const BARE = '.ui-coupon-card:not(:has(> .ui-coupon-card__foot > *))';
    const BARE_PAPER =
      '.ui-coupon-card:not([data-occasion]):not(:has(> .ui-coupon-card__foot > *))';

    it('collapses the foot and squares the head’s inset when nothing is in the foot', () => {
      expect(rule(`${BARE} .ui-coupon-card__foot`)).toBe('display: none;');
      expect(rule(`${BARE} .ui-coupon-card__head`)).toBe(
        'padding-block-end: var(--sys-space-regular);',
      );
      // After the occasion's head rule, which it ties with: the later wins.
      const selectors = rules.map((one) => one.selector);
      expect(
        selectors.indexOf(`${BARE} .ui-coupon-card__head`),
      ).toBeGreaterThan(
        selectors.indexOf(
          '.ui-coupon-card[data-occasion] .ui-coupon-card__head',
        ),
      );
    });

    it('drops the notches from all three wearers and the dashed line — a plain lifted paper', () => {
      expect(
        rule(
          `${BARE_PAPER} .ui-coupon-card__paper, ${BARE_PAPER}::before, ${BARE_PAPER}::after`,
        ),
      ).toBe('mask-image: none;');
      expect(rule(`${BARE_PAPER} .ui-coupon-card__paper::before`)).toBe(
        'content: none;',
      );
    });

    it('keeps the seam under a band: the bare rules on the silhouette are for a ticket without an occasion', () => {
      const bare = rules
        .filter((one) =>
          one.selector.includes(':not(:has(> .ui-coupon-card__foot > *))'),
        )
        .map((one) => one.selector);
      expect(bare).toHaveLength(4);
      for (const selector of bare) {
        if (/mask|__paper/.test(selector) || selector.includes('::')) {
          expect(selector).toContain(':not([data-occasion])');
        }
      }
    });
  });
});
