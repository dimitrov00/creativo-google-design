import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiChip } from './chip';

@Component({
  imports: [UiChip],
  template: `<button uiChip [uiSelected]="selected()" [uiControlSize]="'small'">
    Filter
  </button>`,
})
class HostComponent {
  readonly selected = signal(false);
}

describe('UiChip', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.classList.contains('ui-chip')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('small');
  });

  it('omits data-selected and reports aria-pressed=false when not selected', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBeNull();
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes data-selected and aria-pressed=true when selected', async () => {
    fixture.detectChanges();
    fixture.componentInstance.selected.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(el.getAttribute('data-selected')).toBe('');
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});

/*
 * THE FACES, READ FROM THE STYLESHEET (jsdom resolves no `color-mix`).
 * The accent law (2026-09-29): a tinted selection is the accent's WASH
 * under the primary ink, never a solid accent under a small white label.
 */
describe('chip.css', () => {
  const css = readFileSync(resolve(__dirname, 'chip.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')');

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`no rule «${selector}» in chip.css`);
    return css
      .slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
      .trim();
  }

  const TINTED = ".ui-chip[data-tint='accent'][data-selected]";

  it('selects a tinted chip with the accent’s wash and the primary ink', () => {
    const selected = rule(TINTED);
    expect(selected).toContain(
      'background: color-mix(in srgb, var(--sys-color-accent) var(--sys-alpha-segment-selected), transparent);',
    );
    expect(selected).toContain('color: var(--sys-color-foreground);');
    // No small words on the solid accent: the white ink left the sheet.
    expect(css).not.toContain('--sys-color-on-accent');
    expect(css).not.toMatch(/background: var\(--sys-color-accent\)/);
  });

  it('draws the tinted chip’s leading glyph in the main accent', () => {
    expect(rule(`${TINTED} > .ui-icon:first-child`)).toBe(
      'color: var(--sys-color-accent);',
    );
    const chip = document.createElement('button');
    chip.className = 'ui-chip';
    chip.dataset['tint'] = 'accent';
    chip.dataset['selected'] = '';
    const lead = chip.appendChild(document.createElement('ui-icon'));
    lead.className = 'ui-icon';
    chip.append('Фейд');
    const remove = chip.appendChild(document.createElement('ui-icon'));
    remove.className = 'ui-icon';
    expect(lead.matches(`${TINTED} > .ui-icon:first-child`)).toBe(true);
    // A trailing ✕ rides the label's ink.
    expect(remove.matches(`${TINTED} > .ui-icon:first-child`)).toBe(false);
    // At rest the glyph is ink: the tint is the selection's.
    delete chip.dataset['selected'];
    expect(lead.matches(`${TINTED} > .ui-icon:first-child`)).toBe(false);
  });

  it('leaves the untinted selection on the primary fill', () => {
    const selected = rule('.ui-chip[data-selected]');
    expect(selected).toContain('background: var(--sys-color-primary);');
    expect(selected).toContain('color: var(--sys-color-on-primary);');
    // The tinted rule comes after it and wins on specificity.
    expect(css.indexOf(`${TINTED} {`)).toBeGreaterThan(
      css.indexOf('.ui-chip[data-selected] {'),
    );
  });
});
