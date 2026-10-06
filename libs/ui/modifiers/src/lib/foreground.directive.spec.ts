import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  UiForegroundStyleDirective,
  type UiForegroundStyle,
} from './foreground.directive';
import { UiTextDirective } from './text.directive';

@Component({
  imports: [UiForegroundStyleDirective, UiTextDirective],
  template: `
    <span data-testid="bound" [uiForegroundStyle]="foreground()">text</span>
    <span data-testid="bare" uiText uiFont="footnote">text</span>
    <p data-testid="line" uiText uiFont="callout" uiForegroundStyle="secondary">
      Клиент от
      <span data-testid="fact" uiForegroundStyle="primary">май 2025 г.</span>
    </p>
  `,
})
class HostComponent {
  readonly foreground = signal<UiForegroundStyle | undefined>(undefined);
}

describe('UiForegroundStyleDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const byId = (id: string): HTMLElement =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('omits data-foreground-style while the style is unset: the element inherits', () => {
    fixture.detectChanges();
    expect(byId('bound').getAttribute('data-foreground-style')).toBeNull();
    // `uiText` hosts the directive: a text run that names no style stamps
    // nothing either.
    expect(byId('bare').hasAttribute('data-foreground-style')).toBe(false);
  });

  it('stamps an explicit "primary": a fact inside a quiet line takes the ink back', () => {
    fixture.detectChanges();
    expect(byId('line').getAttribute('data-foreground-style')).toBe(
      'secondary',
    );
    expect(byId('fact').getAttribute('data-foreground-style')).toBe('primary');

    fixture.componentInstance.foreground.set('primary');
    fixture.detectChanges();
    expect(byId('bound').getAttribute('data-foreground-style')).toBe('primary');
  });

  it('drops the stamp when the style is unset again', () => {
    fixture.componentInstance.foreground.set('secondary');
    fixture.detectChanges();
    expect(byId('bound').getAttribute('data-foreground-style')).toBe(
      'secondary',
    );
    fixture.componentInstance.foreground.set(undefined);
    fixture.detectChanges();
    expect(byId('bound').hasAttribute('data-foreground-style')).toBe(false);
  });

  it('writes data-foreground-style for a non-primary style', () => {
    fixture.componentInstance.foreground.set('accent');
    fixture.detectChanges();
    expect(byId('bound').getAttribute('data-foreground-style')).toBe('accent');
  });

  it('writes the warning role for a state glyph', () => {
    fixture.componentInstance.foreground.set('warning');
    fixture.detectChanges();
    expect(byId('bound').getAttribute('data-foreground-style')).toBe('warning');
  });
});

/*
 * THE INKS, READ FROM THE STYLESHEET (jsdom computes no layered cascade).
 * The accent law: `accent` and `promo` are the main accent, never a darker
 * cut of it; `primary` has a rule of its own.
 */
describe('modifiers.css · foreground styles', () => {
  const css = readFileSync(resolve(__dirname, '../../modifiers.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  const ink = (style: UiForegroundStyle): string | undefined => {
    const selector = `[data-foreground-style='${style}'][data-foreground-style]`;
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`modifiers.css has no «${selector}» rule`);
    return /(?<![\w-])color:\s*([^;]+);/
      .exec(css.slice(start, css.indexOf('}', start)))?.[1]
      ?.trim();
  };

  it.each([
    ['primary', 'var(--sys-color-foreground)'],
    ['secondary', 'var(--sys-color-secondary-label)'],
    ['tertiary', 'var(--sys-color-tertiary-label)'],
    ['accent', 'var(--sys-color-accent)'],
    ['promo', 'var(--sys-color-promo)'],
    ['destructive', 'var(--sys-color-destructive-label)'],
    ['success', 'var(--sys-color-success)'],
    ['warning', 'var(--sys-color-warning)'],
  ] as const)('%s is %s', (style, value) => {
    expect(ink(style)).toBe(value);
  });

  it('names no label cut of the accent: there is one orange', () => {
    expect(css).not.toContain('--sys-color-accent-label');
    expect(css).not.toContain('--sys-color-promo-label');
  });

  it('doubles the attribute, so an explicit style out-ranks a component’s own ink', () => {
    const rules = [
      ...css.matchAll(/\[data-foreground-style='([\w-]+)'\]([^ {]*) \{/g),
    ];
    expect(rules.length).toBe(8);
    for (const [, , tail] of rules) {
      expect(tail).toBe('[data-foreground-style]');
    }
  });
});
