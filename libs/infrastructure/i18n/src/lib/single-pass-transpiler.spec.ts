import { TestBed } from '@angular/core/testing';
import {
  DefaultTranspiler,
  TRANSLOCO_TRANSPILER,
  TranslocoService,
} from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import { provideI18n } from './provide-i18n';
import { SinglePassTranspiler } from './single-pass-transpiler';

function setup(): SinglePassTranspiler {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideI18n()] });
  return TestBed.inject(TRANSLOCO_TRANSPILER) as SinglePassTranspiler;
}

describe('SinglePassTranspiler', () => {
  const fill = (
    value: unknown,
    params: Record<string, unknown> | undefined,
    translation: Record<string, unknown> = {},
  ): unknown => setup().transpile({ value, params, translation, key: 'k' });

  it('is what the app is provided', () => {
    expect(setup()).toBeInstanceOf(SinglePassTranspiler);
  });

  it('prints a value holding its own placeholder, and stops', () => {
    expect(fill('Клиент: {{client}}', { client: '{{client}}' })).toBe(
      'Клиент: {{client}}',
    );
  });

  it('never reads a value as template text', () => {
    expect(
      fill('{{client}} · {{phone}}', {
        client: '{{phone}}',
        phone: '+359',
      }),
    ).toBe('{{phone}} · +359');
    // A spaced or unknown placeholder in a value is plain text too.
    expect(fill('{{a}}', { a: '{{ b }} {{nobody}}', b: 'x' })).toBe(
      '{{ b }} {{nobody}}',
    );
  });

  it('prints replacement patterns as they are', () => {
    expect(fill('{{a}}', { a: "$& $1 $' $`" })).toBe("$& $1 $' $`");
  });

  it('fills every placeholder of the catalogue string', () => {
    expect(fill('{{ a }} и {{b}} и {{a}}', { a: 1, b: 'две' })).toBe(
      '1 и две и 1',
    );
    expect(fill('{{n}}', { n: 0 })).toBe('0');
    expect(fill('{{n}}', { n: false })).toBe('false');
  });

  it('prints nothing for a missing or empty param', () => {
    expect(fill('[{{a}}]', {})).toBe('[]');
    expect(fill('[{{a}}]', undefined)).toBe('[]');
    expect(fill('[{{a}}]', { a: null })).toBe('[]');
  });

  it('reads a dotted param, its own name first', () => {
    expect(fill('{{a.b}}', { a: { b: 'дълбоко' } })).toBe('дълбоко');
    expect(fill('{{a.b}}', { 'a.b': 'плоско', a: { b: 'x' } })).toBe('плоско');
    expect(fill('[{{a.b}}]', { a: 'низ' })).toBe('[]');
  });

  it('prints a catalogue key a placeholder names, filling it from the params', () => {
    expect(fill('{{other}}!', { x: 'Х' }, { other: 'здравей {{x}}' })).toBe(
      'здравей Х!',
    );
  });

  it('walks objects and arrays', () => {
    expect(fill(['{{a}}', 'b'], { a: '{{a}}' })).toEqual(['{{a}}', 'b']);
    expect(fill({ c: 'x {{v}}' }, { c: { v: '{{v}}' } })).toEqual({
      c: 'x {{v}}',
    });
  });

  it('leaves non-strings alone', () => {
    expect(fill(7, {})).toBe(7);
    expect(fill(null, {})).toBe(null);
  });

  it('answers as the default does for every string in both catalogues', () => {
    const transpiler = setup();
    const standard = TestBed.runInInjectionContext(
      () => new DefaultTranspiler(),
    );
    const strings = (node: unknown): string[] =>
      typeof node === 'string'
        ? [node]
        : Object.values(node as Record<string, unknown>).flatMap(strings);
    for (const catalogue of [bg, en]) {
      for (const value of strings(catalogue)) {
        const params = Object.fromEntries(
          [...value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => [
            match[1] as string,
            'X',
          ]),
        );
        const input = { value, params, translation: {}, key: 'k' };
        expect(transpiler.transpile(input)).toBe(standard.transpile(input));
        const empty = { value, params: {}, translation: {}, key: 'k' };
        expect(transpiler.transpile(empty)).toBe(standard.transpile(empty));
      }
    }
  });

  it('holds through the service a screen calls', () => {
    setup();
    const service = TestBed.inject(TranslocoService);
    service.setTranslation({ row: 'Меню: {{client}}' }, 'bg');
    service.setActiveLang('bg');
    expect(service.translate('row', { client: '{{client}}' })).toBe(
      'Меню: {{client}}',
    );
  });
});
