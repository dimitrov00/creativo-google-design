import { describe, expect, it } from 'vitest';
import { AuthoredText } from './authored-text.data';

describe('AuthoredText.read — the edge guard of text an editor authored', () => {
  it('reads a Bulgarian text with an English one, or without', () => {
    expect(AuthoredText.read({ bg: 'Иван', en: 'Ivan' })).toEqual({
      bg: 'Иван',
      en: 'Ivan',
    });
    expect(AuthoredText.read({ bg: 'Иван', en: null })).toEqual({
      bg: 'Иван',
      en: null,
    });
    // An absent English reads as none.
    expect(AuthoredText.read({ bg: 'Иван' })).toEqual({ bg: 'Иван', en: null });
  });

  it('keeps the text as typed — blank and long are the system’s question', () => {
    expect(AuthoredText.read({ bg: '  ', en: '' })).toEqual({
      bg: '  ',
      en: '',
    });
  });

  it('drops every other key', () => {
    expect(
      Object.keys(AuthoredText.read({ bg: 'a', en: 'b', de: 'c' }) ?? {}),
    ).toEqual(['bg', 'en']);
  });

  it('refuses what is no authored text', () => {
    for (const raw of [
      null,
      undefined,
      'Иван',
      ['Иван'],
      {},
      { en: 'Ivan' },
      { bg: 7 },
      { bg: 'Иван', en: 7 },
      { bg: null, en: 'Ivan' },
    ]) {
      expect(AuthoredText.read(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
