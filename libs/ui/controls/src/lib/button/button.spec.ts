import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: `<button
    uiButton
    [uiButtonStyle]="'borderedProminent'"
    [uiRole]="'destructive'"
    [uiControlSize]="'small'"
    [uiLoading]="loading"
    [uiMultiline]="multiline"
    [uiSpread]="spread"
  >
    Save
  </button>`,
})
class HostComponent {
  loading = false;
  multiline = false;
  spread = false;
}

@Component({
  imports: [UiButton],
  template: `<button
    uiButton
    [uiButtonStyle]="'bordered'"
    [uiIconOnly]="true"
    [uiSelected]="selected"
  >
    close
  </button>`,
})
class ToggleHostComponent {
  selected = false;
}

describe('UiButton', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes style/role/size as data-* attributes, never as classes', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.classList.contains('ui-button')).toBe(true);
    expect(el.getAttribute('data-button-style')).toBe('borderedProminent');
    expect(el.getAttribute('data-role')).toBe('destructive');
    expect(el.getAttribute('data-control-size')).toBe('small');
  });

  it('draws its own ring while loading, hidden from assistive tech, the label kept for its width', () => {
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    const progress = el.querySelector('.ui-button__progress');
    expect(progress?.getAttribute('aria-hidden')).toBe('true');
    expect(
      progress
        ?.querySelector('ui-progress-view')
        ?.getAttribute('data-control-size'),
    ).toBe('small');
    expect(el.textContent).toContain('Save');
  });

  it('draws no ring at rest', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.querySelector('.ui-button__progress')).toBeNull();
    expect(el.querySelector('ui-progress-view')).toBeNull();
  });

  it('marks aria-busy and data-state="loading" while loading', () => {
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('data-state')).toBe('loading');
  });

  it('omits data-state when not loading', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-state')).toBeNull();
  });

  it('never announces plain buttons as toggles: no aria-pressed unless uiSelected is bound', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.hasAttribute('aria-pressed')).toBe(false);
    expect(el.hasAttribute('data-selected')).toBe(false);
    expect(el.hasAttribute('data-icon-only')).toBe(false);
    expect(el.hasAttribute('data-multiline')).toBe(false);
    expect(el.hasAttribute('data-spread')).toBe(false);
  });

  it('stamps data-multiline for wrapping labels', () => {
    fixture.componentInstance.multiline = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-multiline')).toBe('');
  });

  it('stamps data-spread as a bare attribute (full-width sheet-CTA row)', () => {
    fixture.componentInstance.spread = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-spread')).toBe('');
  });
});

describe('UiButton toggles (uiIconOnly / uiSelected)', () => {
  let fixture: ComponentFixture<ToggleHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToggleHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ToggleHostComponent);
  });

  it('stamps data-icon-only as a bare attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-icon-only')).toBe('');
  });

  it('announces aria-pressed="false" while unselected once uiSelected is bound', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('aria-pressed')).toBe('false');
    expect(el.hasAttribute('data-selected')).toBe(false);
  });

  it('stamps data-selected + aria-pressed="true" when selected', () => {
    fixture.componentInstance.selected = true;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBe('');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});

/*
 * THE BORDERED STYLE UNDER THE ACCENT LAW (2026-09-29), read from the
 * stylesheet (jsdom resolves no `color-mix` and no layered cascade): the
 * wash is the colour, the label is ink, the glyph beside a label is the
 * orange, and a glyph that stands alone stays ink.
 */
describe('button.css · bordered', () => {
  const css = readFileSync(resolve(__dirname, 'button.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')')
    .replace(/\) (?=:not\()/g, ')');

  /** One rule's body, found by its exact (whitespace-folded) selector. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const match = new RegExp(
      `(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`,
    ).exec(css);
    if (!match) throw new Error(`no rule «${selector}» in button.css`);
    return (match[1] as string).trim();
  }

  const BORDERED = ".ui-button[data-button-style='bordered']";
  const GLYPH = `${BORDERED}:not([data-tint]):not([data-icon-only]):not([data-role]) .ui-icon`;

  it('labels the accent wash in the primary ink, the wash unchanged at 12%', () => {
    const rest = rule(BORDERED);
    expect(rest).toContain(
      'background: color-mix(in srgb, var(--sys-color-accent) 12%, transparent)',
    );
    expect(rest).toContain('color: var(--sys-color-foreground)');
    expect(css).not.toContain('--sys-color-accent-label');
  });

  it('deepens to 18% under the pointer, pressed and selected, ungated on press', () => {
    const deep =
      'background: color-mix(in srgb, var(--sys-color-accent) 18%, transparent)';
    expect(rule(`${BORDERED}:hover:not(:disabled)`)).toContain(deep);
    expect(rule(`${BORDERED}:active:not(:disabled)`)).toContain(deep);
    expect(rule(`${BORDERED}[data-selected]`)).toContain(deep);
    // The hover is pointer-only; the press mirror is outside the gate, so
    // a tap on a phone shows the wash too.
    const open = css.indexOf('@media (hover: hover) {');
    let close = css.indexOf('{', open) + 1;
    for (let depth = 1; depth > 0; close++) {
      const char = css.charAt(close);
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    const hover = css.indexOf(`${BORDERED}:hover:not(:disabled) {`);
    const press = css.indexOf(`${BORDERED}:active:not(:disabled) {`);
    expect(hover).toBeGreaterThan(open);
    expect(hover).toBeLessThan(close);
    expect(press).toBeGreaterThan(close);
  });

  it('tints the glyph beside a label with the main accent', () => {
    expect(rule(GLYPH)).toBe('color: var(--sys-color-accent);');
  });

  it('keeps a lone glyph, the neutral tint and the destructive role in their own ink', () => {
    const button = document.createElement('button');
    button.className = 'ui-button';
    button.dataset['buttonStyle'] = 'bordered';
    const glyph = button.appendChild(document.createElement('ui-icon'));
    glyph.className = 'ui-icon';
    expect(glyph.matches(GLYPH)).toBe(true);

    // Icon-only: nothing else names the control, so the glyph is ink
    // (the accent on its own wash is 2.67:1 in light).
    button.dataset['iconOnly'] = '';
    expect(glyph.matches(GLYPH)).toBe(false);
    delete button.dataset['iconOnly'];

    button.dataset['tint'] = 'neutral';
    expect(glyph.matches(GLYPH)).toBe(false);
    delete button.dataset['tint'];

    button.dataset['role'] = 'destructive';
    expect(glyph.matches(GLYPH)).toBe(false);
    delete button.dataset['role'];

    // Another style's glyph rides its label's ink.
    button.dataset['buttonStyle'] = 'plain';
    expect(glyph.matches(GLYPH)).toBe(false);
  });

  it('paints the accent as `color` on glyphs only: the bordered glyph and the selected glass toggle', () => {
    const painted = [
      ...css.matchAll(
        /([^{}]+)\{[^{}]*(?<![\w-])color: var\(--sys-color-accent\)[^{}]*\}/g,
      ),
    ].map(([, selector]) => (selector as string).trim());
    expect(painted).toEqual([
      GLYPH,
      ".ui-button[data-button-style='glass'][data-selected]",
    ]);
  });
});
