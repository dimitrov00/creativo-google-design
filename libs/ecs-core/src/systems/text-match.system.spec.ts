import { MatchMode } from '@core/components';
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

describe('TextMatchSystem.fold', () => {
  it('folds case in the shop locale and keeps every character', () => {
    expect(TextMatchSystem.fold('Иван ПЕТРОВ')).toBe('иван петров');
    expect(TextMatchSystem.fold(' Фейд ')).toBe(' фейд ');
  });
});

describe('TextMatchSystem.segmentsAny', () => {
  it('marks every typed word, anywhere, in either case', () => {
    expect(
      TextMatchSystem.segmentsAny(
        'Иван Петров',
        ['ВАН', 'тро'],
        MatchMode.Anywhere,
      ),
    ).toEqual([
      { text: 'И', hit: false },
      { text: 'ван', hit: true },
      { text: ' Пе', hit: false },
      { text: 'тро', hit: true },
      { text: 'в', hit: false },
    ]);
  });

  it('merges hits that overlap into one run, and keeps hits that only touch apart', () => {
    expect(
      TextMatchSystem.segmentsAny('abcd', ['abc', 'bcd'], MatchMode.Anywhere),
    ).toEqual([{ text: 'abcd', hit: true }]);
    expect(
      TextMatchSystem.segmentsAny('abcd', ['ab', 'cd'], MatchMode.Anywhere),
    ).toEqual([
      { text: 'ab', hit: true },
      { text: 'cd', hit: true },
    ]);
  });

  it('answers what segments answers for a single term', () => {
    for (const text of ['Къса коса', 'коса и кока', 'Фейд', '']) {
      for (const query of ['са', 'ко', 'фейд', 'брада', '']) {
        expect(
          TextMatchSystem.segmentsAny(text, [query], MatchMode.Anywhere),
        ).toEqual(TextMatchSystem.segments(text, query));
      }
    }
  });

  it('marks only the beginning of a word in word-start mode, the longest typed beginning winning', () => {
    expect(
      TextMatchSystem.segmentsAny(
        'Мартин Илиев',
        ['ил', 'март'],
        MatchMode.WordStart,
      ),
    ).toEqual([
      { text: 'Март', hit: true },
      { text: 'ин ', hit: false },
      { text: 'Ил', hit: true },
      { text: 'иев', hit: false },
    ]);
    expect(
      TextMatchSystem.segmentsAny('Мартин', ['ар', 'ма'], MatchMode.WordStart),
    ).toEqual([
      { text: 'Ма', hit: true },
      { text: 'ртин', hit: false },
    ]);
    expect(
      TextMatchSystem.segmentsAny('Мартин', ['ар'], MatchMode.WordStart),
    ).toEqual([{ text: 'Мартин', hit: false }]);
  });

  it('answers the text unmarked for no term, an empty term or no occurrence', () => {
    expect(TextMatchSystem.segmentsAny('Фейд', [], MatchMode.Anywhere)).toEqual(
      [{ text: 'Фейд', hit: false }],
    );
    expect(
      TextMatchSystem.segmentsAny('Фейд', ['', '  '], MatchMode.Anywhere),
    ).toEqual([{ text: 'Фейд', hit: false }]);
    expect(
      TextMatchSystem.segmentsAny('', ['фейд'], MatchMode.Anywhere),
    ).toEqual([]);
  });

  it('never marks a run the filter would not keep, for any term (property over fixed cases)', () => {
    for (const text of ['Класическа подстрижка', 'Фейд', 'Къса коса']) {
      for (const terms of [['ка', 'фей'], ['брада'], ['а п', 'къс']]) {
        const marked = TextMatchSystem.segmentsAny(
          text,
          terms,
          MatchMode.Anywhere,
        ).some((run) => run.hit);
        expect(marked).toBe(
          terms.some((term) => TextMatchSystem.matches(text, term)),
        );
      }
    }
  });

  it('is pure: the same input gives the same answer and nothing is changed', () => {
    const text = 'Иван Петров';
    const terms = Object.freeze(['ван', 'тро']);
    const first = TextMatchSystem.segmentsAny(text, terms, MatchMode.Anywhere);
    expect(
      TextMatchSystem.segmentsAny(text, terms, MatchMode.Anywhere),
    ).toEqual(first);
    expect(text).toBe('Иван Петров');
    expect(terms).toEqual(['ван', 'тро']);
  });
});

describe('TextMatchSystem.phoneSegments', () => {
  it('marks a run of digits through the formatter spacing', () => {
    expect(
      TextMatchSystem.phoneSegments('+359 88 777 8899', '887778899'),
    ).toEqual([
      { text: '+359 ', hit: false },
      { text: '88 777 8899', hit: true },
    ]);
  });

  it('marks a run from the middle of a number, spaces included', () => {
    expect(TextMatchSystem.phoneSegments('+359 88 765 4321', '7654')).toEqual([
      { text: '+359 88 ', hit: false },
      { text: '765 4', hit: true },
      { text: '321', hit: false },
    ]);
  });

  it('marks a calling code through its leading plus-free digits, the plus left unmarked', () => {
    expect(
      TextMatchSystem.phoneSegments('+359 88 765 4321', '35988765'),
    ).toEqual([
      { text: '+', hit: false },
      { text: '359 88 765', hit: true },
      { text: ' 4321', hit: false },
    ]);
  });

  it('answers the number unmarked for no digits or no occurrence, and nothing for no text', () => {
    expect(TextMatchSystem.phoneSegments('+359 88 765 4321', '')).toEqual([
      { text: '+359 88 765 4321', hit: false },
    ]);
    expect(TextMatchSystem.phoneSegments('+359 88 765 4321', '999')).toEqual([
      { text: '+359 88 765 4321', hit: false },
    ]);
    expect(TextMatchSystem.phoneSegments('', '123')).toEqual([]);
  });
});
