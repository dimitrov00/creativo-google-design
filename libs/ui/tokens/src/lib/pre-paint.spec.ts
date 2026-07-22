import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DENSITY_STORAGE_KEY,
  LANG_STORAGE_KEY,
  META_THEME_COLOR,
  THEME_STORAGE_KEY,
} from './pre-paint';

const tokensDir = resolve(__dirname, '../../');
const indexHtml = readFileSync(
  resolve(tokensDir, '../../../apps/web/src/index.html'),
  'utf8',
);

function backgroundValue(cssFileName: string): string {
  const css = readFileSync(resolve(tokensDir, cssFileName), 'utf8');
  const match = css.match(/--sys-color-background:\s*(#[0-9a-f]{6});/i);
  if (!match) {
    throw new Error(`--sys-color-background not found in ${cssFileName}`);
  }
  return match[1] as string;
}

describe('META_THEME_COLOR', () => {
  it('matches --sys-color-background in theme-light.css', () => {
    expect(META_THEME_COLOR.light).toBe(backgroundValue('theme-light.css'));
  });

  it('matches --sys-color-background in theme-dark.css', () => {
    expect(META_THEME_COLOR.dark).toBe(backgroundValue('theme-dark.css'));
  });
});

describe('apps/web/src/index.html pre-paint script', () => {
  it('uses the same storage keys as this module', () => {
    expect(indexHtml).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(indexHtml).toContain(`'${DENSITY_STORAGE_KEY}'`);
    expect(indexHtml).toContain(`'${LANG_STORAGE_KEY}'`);
  });

  it('embeds the same meta theme-color values as this module', () => {
    expect(indexHtml).toContain(
      `{ light: '${META_THEME_COLOR.light}', dark: '${META_THEME_COLOR.dark}' }`,
    );
  });
});
