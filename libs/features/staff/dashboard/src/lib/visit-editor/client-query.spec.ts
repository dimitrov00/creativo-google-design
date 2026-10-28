import { describe, expect, it } from 'vitest';
import { ClientQuerySystem } from '@core/systems';
import { rankClients } from './client-query';

// The reading, the lookup keys and the marked segments are
// `ClientQuerySystem`'s, proved in `client-query.system.spec.ts`; this file
// keeps what the feature adds: the ranking resolved onto the caller's own
// objects.

const MARTIN = {
  label: 'Мартин Илиев',
  phone: '+359 88 765 4321',
  email: 'martin@test.local',
};
const ANNA = {
  label: 'Анна Костова',
  phone: '+359 88 500 0000',
  email: 'anna.k@mail.bg',
};
const MARIA = { label: 'Мария Мартинова', phone: null, email: null };
const PEOPLE = [ANNA, MARIA, MARTIN];

describe('rankClients', () => {
  const labels = (query: string) =>
    rankClients(PEOPLE, ClientQuerySystem.parse(query)).map(
      (ranked) => ranked.client.label,
    );

  it("keeps the owner's order while nothing is typed", () => {
    expect(labels('')).toEqual([
      'Анна Костова',
      'Мария Мартинова',
      'Мартин Илиев',
    ]);
  });

  it("matches every typed word against the beginnings of a name's words, first-name matches first", () => {
    expect(labels('март')).toEqual(['Мартин Илиев', 'Мария Мартинова']);
    expect(labels('мартин ил')).toEqual(['Мартин Илиев']);
    expect(labels('ил март')).toEqual(['Мартин Илиев']);
    expect(labels('петър')).toEqual([]);
  });

  it('matches a number by its beginning in any form, and says when it is exactly theirs', () => {
    expect(labels('088 765')).toEqual(['Мартин Илиев']);
    expect(labels('885')).toEqual(['Анна Костова']);
    const exact = rankClients(PEOPLE, ClientQuerySystem.parse('0887654321'));
    expect(exact).toEqual([{ client: MARTIN, exact: true }]);
    expect(
      rankClients(PEOPLE, ClientQuerySystem.parse('088765'))[0]?.exact,
    ).toBe(false);
  });

  it("leads with the number and only ranks by the name beside it — a number that is somebody else's still shows", () => {
    expect(labels('Петър 0887654321')).toEqual(['Мартин Илиев']);
  });

  it('matches a mail by its beginning, its local part, or a fragment', () => {
    expect(labels('martin@')).toEqual(['Мартин Илиев']);
    expect(labels('anna.k@mail.bg')).toEqual(['Анна Костова']);
    expect(
      rankClients(PEOPLE, ClientQuerySystem.parse('anna.k@mail.bg'))[0]?.exact,
    ).toBe(true);
  });
});
