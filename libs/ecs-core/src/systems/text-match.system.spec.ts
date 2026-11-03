import { TextMatchSystem } from './text-match.system';

describe('TextMatchSystem.matches', () => {
  it('finds the run anywhere, in either case', () => {
    expect(TextMatchSystem.matches('Класическа подстрижка', 'ПОДСТР')).toBe(
      true,
    );
    expect(TextMatchSystem.matches('Класическа подстрижка', 'класи')).toBe(
      true,
    );
    expect(TextMatchSystem.matches('Класическа подстрижка', 'фейд')).toBe(
      false,
    );
  });

  it('trims the query and lets an empty one through', () => {
    expect(TextMatchSystem.matches('Фейд', '  фейд ')).toBe(true);
    expect(TextMatchSystem.matches('Фейд', '')).toBe(true);
    expect(TextMatchSystem.matches('Фейд', '   ')).toBe(true);
  });
});

describe('TextMatchSystem.segments', () => {
  it('marks the typed run in either case and keeps the written text', () => {
    expect(TextMatchSystem.segments('Класическа подстрижка', 'класи')).toEqual([
      { text: 'Класи', hit: true },
      { text: 'ческа подстрижка', hit: false },
    ]);
  });

  it('marks every occurrence, with the text between kept', () => {
    expect(TextMatchSystem.segments('Къса коса', 'СА')).toEqual([
      { text: 'Къ', hit: false },
      { text: 'са', hit: true },
      { text: ' ко', hit: false },
      { text: 'са', hit: true },
    ]);
    expect(TextMatchSystem.segments('коса и кока', 'ко')).toEqual([
      { text: 'ко', hit: true },
      { text: 'са и ', hit: false },
      { text: 'ко', hit: true },
      { text: 'ка', hit: false },
    ]);
  });

  it('marks a run at the very start, the very end, or the whole text', () => {
    expect(TextMatchSystem.segments('Фейд', 'фейд')).toEqual([
      { text: 'Фейд', hit: true },
    ]);
    expect(TextMatchSystem.segments('Дълга коса', 'коса')).toEqual([
      { text: 'Дълга ', hit: false },
      { text: 'коса', hit: true },
    ]);
  });

  it('answers the text unmarked for no query, no occurrence or no text', () => {
    expect(TextMatchSystem.segments('Фейд', '')).toEqual([
      { text: 'Фейд', hit: false },
    ]);
    expect(TextMatchSystem.segments('Фейд', '  ')).toEqual([
      { text: 'Фейд', hit: false },
    ]);
    expect(TextMatchSystem.segments('Фейд', 'брада')).toEqual([
      { text: 'Фейд', hit: false },
    ]);
    expect(TextMatchSystem.segments('', 'фейд')).toEqual([]);
  });

  it('never marks a run the filter would not keep', () => {
    for (const text of ['Класическа подстрижка', 'Фейд', 'Къса коса']) {
      for (const query of ['ка', 'ФЕЙ', 'брада', 'а п']) {
        const marked = TextMatchSystem.segments(text, query).some(
          (run) => run.hit,
        );
        expect(marked).toBe(TextMatchSystem.matches(text, query));
      }
    }
  });

  it('is pure: the same input gives the same answer and nothing is changed', () => {
    const text = 'Класическа подстрижка';
    const first = TextMatchSystem.segments(text, 'под');
    expect(TextMatchSystem.segments(text, 'под')).toEqual(first);
    expect(text).toBe('Класическа подстрижка');
  });
});
