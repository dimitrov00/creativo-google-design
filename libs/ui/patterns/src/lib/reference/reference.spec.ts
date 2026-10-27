import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiReference } from './reference';

const ID = 'op_7f3c2a9b41d84e0c';
const OTHER_ID = 'op_0a1b2c3d4e5f6a7b';

@Component({
  imports: [UiReference],
  template: `
    <ui-reference
      [uiLabel]="'Код за справка: ' + value()"
      [uiValue]="value()"
      uiCopiedText="Кодът е копиран."
    />
  `,
})
class Host {
  readonly value = signal(ID);
}

/** The platform clipboard, stubbed per case (jsdom has none). */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

describe('UiReference', () => {
  let fixture: ComponentFixture<Host>;
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  const host = () =>
    fixture.nativeElement.querySelector('ui-reference') as HTMLElement;
  const line = () =>
    host().querySelector('.ui-reference__line') as HTMLButtonElement;
  const region = () =>
    host().querySelector('[role="status"]') as HTMLElement | null;

  /** One tap, then the clipboard's answer and the render after it. */
  async function tap(): Promise<void> {
    line().click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('prints the whole line as one button, and a silent polite region beside it', () => {
    expect(line().tagName).toBe('BUTTON');
    expect(line().getAttribute('type')).toBe('button');
    expect(line().textContent?.trim()).toBe(`Код за справка: ${ID}`);
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    expect(region()?.textContent).toBe('');
  });

  it('copies the id alone on a tap, and confirms once it landed', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);

    await tap();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ID);
    expect(region()?.textContent).toBe('Кодът е копиран.');
  });

  it('says nothing when the clipboard refuses, and the line stays to be read', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')));

    await tap();

    expect(region()?.textContent).toBe('');
    expect(line().textContent?.trim()).toBe(`Код за справка: ${ID}`);
  });

  it('says nothing where there is no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    await tap();

    expect(region()?.textContent).toBe('');
  });

  it('starts a new id unconfirmed', async () => {
    stubClipboard(() => Promise.resolve());
    await tap();
    expect(region()?.textContent).toBe('Кодът е копиран.');

    fixture.componentInstance.value.set(OTHER_ID);
    fixture.detectChanges();

    expect(line().textContent?.trim()).toBe(`Код за справка: ${OTHER_ID}`);
    expect(region()?.textContent).toBe('');
  });
});

/*
 * THE LINE'S INK AND CUT, READ FROM THE STYLESHEET: secondary ink in the
 * mono cut (words are ink — no accent), printed whole and allowed to wrap.
 */
describe('reference.css', () => {
  const css = readFileSync(resolve(__dirname, 'reference.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`reference.css has no «${selector}» rule`);
    return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };

  it('prints the id in the mono cut, quiet ink, wrapping rather than cut off', () => {
    const lineRule = rule('.ui-reference__line');
    expect(lineRule).toContain('font-family: var(--sys-font-family-mono);');
    expect(lineRule).toContain('color: var(--sys-color-secondary-label);');
    expect(lineRule).toContain('overflow-wrap: anywhere;');
    expect(lineRule).not.toContain('text-overflow');
  });

  it('never hides the confirmation region from assistive tech', () => {
    expect(css).not.toContain('display: none');
    expect(css).not.toContain('--sys-color-accent');
  });
});
