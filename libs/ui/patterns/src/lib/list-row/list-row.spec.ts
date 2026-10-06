import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiListRow, type UiListRowRole } from './list-row';

@Component({
  imports: [UiListRow],
  template: `
    <ui-list-row
      data-testid="row"
      [uiSize]="size()"
      [uiVariant]="variant()"
      [uiInteractive]="interactive()"
    >
      <span uiLeading>glyph</span>
      Label text
      <span uiTrailing>detail</span>
    </ui-list-row>
    <a uiListRow data-testid="anchor-row" href="#somewhere">Anchor label</a>
  `,
})
class HostComponent {
  size = signal<'regular' | 'large'>('large');
  variant = signal<'plain' | 'neutral' | 'prominent'>('plain');
  interactive = signal(false);
}

describe('UiListRow', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('stamps the host class and defaults to the large size, non-interactive', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.classList.contains('ui-list-row')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('large');
    expect(el.getAttribute('data-variant')).toBe('plain');
    expect(el.getAttribute('data-interactive')).toBeNull();
  });

  it('stamps the prominent variant as data-variant (DS button vocabulary)', () => {
    fixture.componentInstance.variant.set('prominent');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.getAttribute('data-variant')).toBe('prominent');
    expect(el.classList.contains('ui-list-row')).toBe(true);
    // Styling hangs off the attribute alone — never a variant class.
    expect(Array.from(el.classList).some((c) => c.includes('prominent'))).toBe(
      false,
    );
  });

  /**
   * The middle rung, and the reason it exists: a stack that needs a second
   * standalone destination reaches for `neutral` instead of a second
   * `prominent`, which would be two competing primaries.
   *
   * It is deliberately NOT an accent wash — `[data-selected]` already owns
   * that fill, so a permanently-washed row would be indistinguishable from
   * a selected one.
   */
  it('stamps the neutral variant as data-variant', () => {
    fixture.componentInstance.variant.set('neutral');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.getAttribute('data-variant')).toBe('neutral');
    expect(Array.from(el.classList).some((c) => c.includes('neutral'))).toBe(
      false,
    );
  });

  it('writes size/interactive as data-* attributes, never as classes', () => {
    fixture.componentInstance.size.set('regular');
    fixture.componentInstance.interactive.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.getAttribute('data-size')).toBe('regular');
    expect(el.getAttribute('data-interactive')).toBe('');
  });

  it('projects leading/trailing slots as siblings of the label wrapper', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.querySelector('[uiLeading]')?.textContent).toBe('glyph');
    expect(el.querySelector('[uiTrailing]')?.textContent).toBe('detail');
    expect(el.querySelector('.ui-list-row__label')?.textContent?.trim()).toBe(
      'Label text',
    );
  });

  it('attaches to native anchors via the attribute selector form', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="anchor-row"]',
    );
    expect(el.tagName).toBe('A');
    expect(el.classList.contains('ui-list-row')).toBe(true);
    expect(el.getAttribute('data-size')).toBe('large');
    expect(el.querySelector('.ui-list-row__label')?.textContent?.trim()).toBe(
      'Anchor label',
    );
  });

  it('carries no role by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    expect(el.hasAttribute('data-role')).toBe(false);
  });
});

/**
 * THE EXITS (2026-09-28) — `uiRole="destructive"`, the name `uiButton`
 * already uses, promoted from the visit sheet's feature CSS so every sheet
 * reaches it; `data-armed` is the consumer's own stamp for the row that
 * has become its confirm.
 */
@Component({
  imports: [UiListRow],
  template: `
    <ul>
      <li>
        <button
          uiListRow
          type="button"
          data-testid="exit"
          [uiRole]="role()"
          [attr.data-armed]="armed() ? '' : null"
          [uiInteractive]="true"
        >
          <span uiLeading>glyph</span>
          Махни от посещението
        </button>
      </li>
    </ul>
  `,
})
class ExitHost {
  readonly role = signal<UiListRowRole | null>('destructive');
  readonly armed = signal(false);
}

describe('UiListRow · uiRole', () => {
  let fixture: ComponentFixture<ExitHost>;
  const exit = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="exit"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExitHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(ExitHost);
    fixture.detectChanges();
  });

  it('stamps data-role, and drops it with the role', () => {
    expect(exit().getAttribute('data-role')).toBe('destructive');
    fixture.componentInstance.role.set(null);
    fixture.detectChanges();
    expect(exit().hasAttribute('data-role')).toBe(false);
  });

  it("keeps the consumer's data-armed beside the role", () => {
    fixture.componentInstance.armed.set(true);
    fixture.detectChanges();
    expect(exit().getAttribute('data-role')).toBe('destructive');
    expect(exit().getAttribute('data-armed')).toBe('');
  });

  it('reads in the destructive label ink, weightier when armed (the stylesheet)', () => {
    const css = readFileSync(resolve(__dirname, 'list-row.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const body = (selector: string): string | undefined =>
      // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
      new RegExp(
        `(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`,
      ).exec(css)?.[1];

    expect(body(".ui-list-row[data-role='destructive']")).toContain(
      'color: var(--sys-color-destructive-label)',
    );
    expect(body(".ui-list-row[data-role='destructive'][data-armed]")).toContain(
      'font-weight: 600',
    );
    // A role outranks a variant's ink only by coming after it.
    expect(
      css.indexOf(".ui-list-row[data-role='destructive'] {"),
    ).toBeGreaterThan(css.indexOf(".ui-list-row[data-variant='prominent'] {"));
  });
});

/*
 * 2026-09-28 — the forms the client card's rows reached for by hand: a
 * trailing FIGURE in the label's ink, a label that wraps, and a bare
 * leading glyph on the ladder's 20.
 */
describe('UiListRow · figure, wrapping label, leading glyph', () => {
  @Component({
    imports: [UiListRow],
    template: `
      <ui-list-row
        data-testid="figure-row"
        [uiTrailingProminence]="prominence()"
        [uiLabelWraps]="wraps()"
      >
        Безплатно подстригване
        <span uiTrailing>250 т.</span>
      </ui-list-row>
    `,
  })
  class FigureHost {
    prominence = signal<'secondary' | 'primary'>('primary');
    wraps = signal(true);
  }

  const css = readFileSync(resolve(__dirname, 'list-row.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const body = (selector: string): string | undefined =>
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    new RegExp(
      `(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`,
    ).exec(css)?.[1];

  it('stamps the trailing prominence and the wrap only when asked', async () => {
    await TestBed.configureTestingModule({
      imports: [FigureHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(FigureHost);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector(
      '[data-testid="figure-row"]',
    ) as HTMLElement;
    expect(row.getAttribute('data-trailing-prominence')).toBe('primary');
    expect(row.hasAttribute('data-label-wraps')).toBe(true);
    fixture.componentInstance.prominence.set('secondary');
    fixture.componentInstance.wraps.set(false);
    fixture.detectChanges();
    expect(row.hasAttribute('data-trailing-prominence')).toBe(false);
    expect(row.hasAttribute('data-label-wraps')).toBe(false);
  });

  it('keeps a primary figure in the label’s ink — never over an element’s own style or a control', () => {
    expect(
      body(
        ".ui-list-row[data-trailing-prominence='primary'] > [uitrailing]:not(.ui-button):not([data-foreground-style])",
      ),
    ).toContain('color: inherit');
  });

  it('lets a wrapping label break onto more lines', () => {
    const wraps = body('.ui-list-row[data-label-wraps] > .ui-list-row__label');
    expect(wraps).toContain('white-space: normal');
    expect(wraps).toContain('overflow-wrap: break-word');
  });

  it('lets a value row’s trailing run give way: shrinks to a cap, wraps two lines at the trailing edge, never shrinks its glyph', async () => {
    @Component({
      imports: [UiListRow],
      template: `
        <button
          uiListRow
          type="button"
          data-testid="value-row"
          [uiTrailingWraps]="wraps()"
        >
          Приложени
          <span uiTrailing
            ><span>Безплатно подстригване (17,50 €)</span><i class="ui-icon"></i
          ></span>
        </button>
      `,
    })
    class ValueHost {
      wraps = signal(true);
    }
    await TestBed.configureTestingModule({
      imports: [ValueHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    const fixture = TestBed.createComponent(ValueHost);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector(
      '[data-testid="value-row"]',
    ) as HTMLElement;
    expect(row.hasAttribute('data-trailing-wraps')).toBe(true);
    fixture.componentInstance.wraps.set(false);
    fixture.detectChanges();
    expect(row.hasAttribute('data-trailing-wraps')).toBe(false);

    const run = body('.ui-list-row[data-trailing-wraps] > [uitrailing]');
    expect(run).toContain('flex-shrink: 1');
    expect(run).toContain('min-inline-size: 0');
    expect(run).toContain('max-inline-size: 60%');
    expect(run).toContain('text-align: end');
    const words = body(
      '.ui-list-row[data-trailing-wraps] > [uitrailing] > :not(.ui-icon), .ui-list-row[data-trailing-wraps] > [uitrailing]:not(:has(> *))',
    );
    expect(words).toContain('line-clamp: 2');
    expect(words).toContain('white-space: normal');
    expect(words).toContain('text-wrap: balance');
    expect(
      body('.ui-list-row[data-trailing-wraps] > [uitrailing] > .ui-icon'),
    ).toContain('flex-shrink: 0');
    // It outranks the default «never shrink» by coming after it.
    expect(
      css.indexOf('.ui-list-row[data-trailing-wraps] > [uitrailing] {'),
    ).toBeGreaterThan(css.indexOf('.ui-list-row > [uitrailing] {'));
  });

  it('sets a bare leading glyph on the ladder’s 20, bare or in its wrapper', () => {
    expect(
      body(
        '.ui-list-row > .ui-icon[uileading], .ui-list-row > [uileading] > .ui-icon:only-child',
      ),
    ).toContain('font-size: var(--ui-icon-medium)');
  });
});
