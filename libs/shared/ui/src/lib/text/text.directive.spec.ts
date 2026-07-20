import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it } from 'vitest';

import { TextDirective } from './text.directive';

@Component({
  imports: [TextDirective],
  template: `
    <h2 crText="title">Role only</h2>
    <p
      crText="body"
      weight="semibold"
      design="heading"
      width="expanded"
      tone="secondary"
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

describe('TextDirective', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return {
      fixture,
      heading: fixture.nativeElement.querySelector('h2') as HTMLElement,
      paragraph: fixture.nativeElement.querySelector('p') as HTMLElement,
    };
  }

  it('stamps the role as data-text and omits absent modifiers entirely', () => {
    const { heading } = render();
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
      'data-text-underline',
      'data-text-strike',
    ]) {
      expect(heading.hasAttribute(attr), attr).toBe(false);
    }
  });

  it('maps every modifier input onto its data-text-* attribute', () => {
    const { paragraph } = render();
    expect(paragraph.getAttribute('data-text')).toBe('body');
    expect(paragraph.getAttribute('data-text-weight')).toBe('semibold');
    expect(paragraph.getAttribute('data-text-design')).toBe('heading');
    expect(paragraph.getAttribute('data-text-width')).toBe('expanded');
    expect(paragraph.getAttribute('data-text-tone')).toBe('secondary');
    expect(paragraph.getAttribute('data-text-case')).toBe('uppercase');
    expect(paragraph.getAttribute('data-text-tracking')).toBe('wide');
    expect(paragraph.getAttribute('data-text-strike')).toBe('');
  });

  it('toggles boolean decorations as presence attributes', () => {
    const { fixture, paragraph } = render();
    expect(paragraph.hasAttribute('data-text-underline')).toBe(false);

    fixture.componentInstance.underline.set(true);
    fixture.detectChanges();
    expect(paragraph.getAttribute('data-text-underline')).toBe('');
  });
});
