import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it } from 'vitest';

import { CrText } from './text.directive';

@Component({
  imports: [CrText],
  template: `
    <h2 text font="title">Role only</h2>
    <span text bold>Marker only, bold sugar</span>
    <em text font="footnote" italic monospacedDigit underline>
      Bare booleans
    </em>
    <strong text font="body" fontWeight="medium" bold>
      Explicit beats sugar
    </strong>
    <p
      text
      font="body"
      fontWeight="semibold"
      fontDesign="heading"
      fontWidth="expanded"
      foregroundStyle="secondary"
      textCase="uppercase"
      tracking="wide"
      [underline]="underline()"
      [strikethrough]="true"
    >
      Fully modified
    </p>
  `,
})
class HostComponent {
  readonly underline = signal(false);
}

describe('CrText', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const query = (selector: string) =>
      fixture.nativeElement.querySelector(selector) as HTMLElement;
    return { fixture, query };
  }

  it('stamps .font() as data-text and omits absent modifiers entirely', () => {
    const { query } = render();
    const heading = query('h2');
    expect(heading.getAttribute('data-text')).toBe('title');
    // Absent modifiers must not render as empty attributes — an empty
    // data-text-weight would still match CSS [data-text-weight] guards.
    for (const attr of [
      'data-text-weight',
      'data-text-design',
      'data-text-width',
      'data-text-tone',
      'data-text-case',
      'data-text-tracking',
      'data-text-italic',
      'data-text-underline',
      'data-text-strike',
      'data-text-monospaced-digit',
    ]) {
      expect(heading.hasAttribute(attr), attr).toBe(false);
    }
  });

  it('bare text is the Text() marker: no data-text, modifiers still apply', () => {
    const { query } = render();
    const marker = query('span');
    expect(marker.hasAttribute('data-text')).toBe(false);
    expect(marker.getAttribute('data-text-weight')).toBe('bold');
  });

  it('bare boolean attributes toggle their presence data-attrs', () => {
    // `italic` / `underline` etc. as bare static attributes pass '' — the
    // booleanAttribute transform must read that as true.
    const { query } = render();
    const em = query('em');
    expect(em.getAttribute('data-text-italic')).toBe('');
    expect(em.getAttribute('data-text-monospaced-digit')).toBe('');
    expect(em.getAttribute('data-text-underline')).toBe('');
  });

  it('explicit fontWeight beats the bold() sugar', () => {
    const { query } = render();
    expect(query('strong').getAttribute('data-text-weight')).toBe('medium');
  });

  it('maps every SwiftUI-named input onto its data-text-* attribute', () => {
    const { query } = render();
    const paragraph = query('p');
    expect(paragraph.getAttribute('data-text')).toBe('body');
    expect(paragraph.getAttribute('data-text-weight')).toBe('semibold');
    expect(paragraph.getAttribute('data-text-design')).toBe('heading');
    expect(paragraph.getAttribute('data-text-width')).toBe('expanded');
    expect(paragraph.getAttribute('data-text-tone')).toBe('secondary');
    expect(paragraph.getAttribute('data-text-case')).toBe('uppercase');
    expect(paragraph.getAttribute('data-text-tracking')).toBe('wide');
    expect(paragraph.getAttribute('data-text-strike')).toBe('');
  });

  it('toggles bound boolean decorations reactively', () => {
    const { fixture, query } = render();
    const paragraph = query('p');
    expect(paragraph.hasAttribute('data-text-underline')).toBe(false);

    fixture.componentInstance.underline.set(true);
    fixture.detectChanges();
    expect(paragraph.getAttribute('data-text-underline')).toBe('');
  });
});
