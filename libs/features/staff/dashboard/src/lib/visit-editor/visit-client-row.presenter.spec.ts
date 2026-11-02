import { describe, expect, it } from 'vitest';
import { ClientQueryShape, Email } from '@core/components';
import { DraftPersonKey } from '@core/primitives';
import { ClientQuerySystem } from '@core/systems';
import { catalogueWords } from '../testing/visit-editor-words';
import {
  clientRowVm,
  createLinesOf,
  createPartsOf,
  createRowNameOf,
  searchGlyphOf,
} from './visit-client-row.presenter';

/*
 * THE ADD-CLIENT PAGE'S WORDS, in both languages. How a typed query reads and
 * what it marks are `ClientQuerySystem`'s, pinned there; these pin how a row
 * and the create row say the answers.
 */

const BG = catalogueWords('bg');
const EN = catalogueWords('en');
const CODE = '359';
const nothing = ClientQuerySystem.parse('');
const MARTIN = DraftPersonKey.of('guest-martin');
const mail = Email.parse('martin@mail.bg');

const martin = {
  id: MARTIN,
  label: 'Мартин Илиев',
  phone: '+359 88 123 4567',
  phoneHref: 'tel:+359881234567',
  meta: 'посл. 22.09',
  email: mail,
};

const row = (
  query = '',
  client: Parameters<typeof clientRowVm>[0] = martin,
  words = BG,
) =>
  clientRowVm(client, {
    parsed: query === '' ? nothing : ClientQuerySystem.parse(query),
    chosen: new Set([MARTIN]),
    exact: query !== '',
    callingCode: CODE,
    words,
  });

describe('a person row', () => {
  it('reads the mail, the number and the last visit, each on its own glyph-led line', () => {
    const vm = row();
    expect(vm.lines.map((line) => [line.icon, line.text])).toEqual([
      ['contact.email', 'martin@mail.bg'],
      ['contact.phone', '+359 88 123 4567'],
      ['visit.last', 'посл. 22.09'],
    ]);
    expect(vm.selected).toBe(true);
    expect(vm.exact).toBe(false);
    expect(vm.titleParts).toBeNull();
    expect(vm.lines[0]?.parts).toBeUndefined();
  });

  it('marks the typed run in the name, while some run is the typed one', () => {
    const vm = row('Мартин');
    expect(vm.exact).toBe(true);
    expect(vm.titleParts?.some((run) => 'hit' in run && run.hit)).toBe(true);
  });

  it('drops a meta that only repeats the mail', () => {
    const vm = row('', { ...martin, meta: 'martin@mail.bg' });
    expect(vm.lines.map((line) => line.icon)).toEqual([
      'contact.email',
      'contact.phone',
    ]);
  });

  it('says a walk-in’s record has no profile, last, under its own test id', () => {
    const bare = { ...martin, email: null, phone: null, meta: null };
    expect(row('', { ...bare, noAccount: true }).lines).toEqual([
      {
        text: 'Без профил',
        icon: 'account.anonymous',
        testId: 'staff-visit-client-no-account-guest-martin',
      },
    ]);
    expect(row('', { ...bare, noAccount: true }, EN).lines[0]?.text).toBe(
      'No account',
    );
    expect(row('', bare).lines).toEqual([]);
  });
});

describe('the search field’s glyph', () => {
  it('says what it took the typing for', () => {
    expect(searchGlyphOf(ClientQueryShape.Phone)).toBe('contact.phone');
    expect(searchGlyphOf(ClientQueryShape.Email)).toBe('contact.email');
    expect(searchGlyphOf(ClientQueryShape.Name)).toBe('action.search');
    expect(searchGlyphOf(ClientQueryShape.Empty)).toBe('action.search');
  });
});

describe('the create row', () => {
  it('reads every part with its glyph, the number by the shop’s dial code', () => {
    const parts = createPartsOf(
      ClientQuerySystem.parse('Мария 088 76 maria@mail.bg'),
      CODE,
    );
    expect(parts.map((part) => part.clientQueryShape)).toEqual([
      ClientQueryShape.Name,
      ClientQueryShape.Phone,
      ClientQueryShape.Email,
    ]);
    expect(parts[0]?.value).toBe('Мария');
    expect(parts[1]?.value).toMatch(/^\+359/);
    expect(parts[2]?.value).toBe('maria@mail.bg');
    expect(createLinesOf(parts).map((line) => line.testId)).toEqual([
      'staff-visit-new-client-name',
      'staff-visit-new-client-phone',
      'staff-visit-new-client-email',
    ]);
    expect(createLinesOf(parts).map((line) => line.icon)).toEqual([
      'contact.person',
      'contact.phone',
      'contact.email',
    ]);
  });

  it('is spoken with what it will assign, and bare with nothing typed', () => {
    expect(createPartsOf(nothing, CODE)).toEqual([]);
    expect(createRowNameOf([], BG)).toBe('Нов клиент');
    expect(createRowNameOf([], EN)).toBe('New client');
    const parts = createPartsOf(ClientQuerySystem.parse('Мария'), CODE);
    expect(createRowNameOf(parts, BG)).toBe('Нов клиент: Мария');
    expect(createRowNameOf(parts, EN)).toBe('New client: Мария');
  });
});
