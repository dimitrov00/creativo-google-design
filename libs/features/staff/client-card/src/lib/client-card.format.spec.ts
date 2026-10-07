import { describe, expect, it } from 'vitest';
import {
  LINE_JOINT,
  NO_BREAK,
  factRun,
  heldFacts,
  hungJoints,
  joined,
  partedAtJoints,
  quietRun,
  runsOf,
  unbroken,
} from './client-card.format';

/*
 * THE CARD'S QUIET LINES — the one grammar every presenter cuts a sentence
 * with (revision 3, P5-5 / S1-6; review 3, round 4). The dates and figures
 * of this file are pinned where they are read (the presenters' specs).
 */

const NB = NO_BREAK;

describe('runsOf', () => {
  it('cuts a sentence around its facts, in primary ink, the rest quiet: the runs joined are the sentence', () => {
    const runs = runsOf('Клиент от март 2025 г. · идва през 4 седмици', [
      'март 2025 г.',
      '4 седмици',
    ]);
    expect(runs).toEqual([
      quietRun('Клиент от '),
      factRun('март 2025 г.'),
      quietRun(' · идва през '),
      factRun('4 седмици'),
    ]);
    expect(runs.map((run) => run.text).join('')).toBe(
      'Клиент от март 2025 г. · идва през 4 седмици',
    );
  });

  it('finds a fact inside its SLOT, where the words put it: «4» is never the end of «24»', () => {
    expect(
      runsOf('24 посещения · през 4 седмици', [
        { slot: '24 посещения', fact: '24' },
        { slot: '4 седмици', fact: '4' },
      ]),
    ).toEqual([
      factRun('24'),
      quietRun(' посещения · през '),
      factRun('4'),
      quietRun(' седмици'),
    ]);
  });

  it('cuts in the language’s order, leaves a fact the sentence does not hold unmarked, and an empty one too', () => {
    expect(
      runsOf('comes every 4 weeks · client since March 2025', [
        'March 2025',
        '4 weeks',
        'never there',
        '',
      ]),
    ).toEqual([
      quietRun('comes every '),
      factRun('4 weeks'),
      quietRun(' · client since '),
      factRun('March 2025'),
    ]);
    expect(runsOf('Първо посещение', [])).toEqual([
      quietRun('Първо посещение'),
    ]);
  });

  it('lets the first of two marks over one stretch stand', () => {
    expect(runsOf('371 т.', ['371 т.', '371'])).toEqual([factRun('371 т.')]);
  });
});

describe('joined', () => {
  it('folds neighbours of one ink into one run and drops an empty one', () => {
    expect(
      joined([
        quietRun(''),
        quietRun('Без '),
        quietRun('неявявания'),
        factRun('492,50 €'),
        factRun(''),
        quietRun(' общо'),
      ]),
    ).toEqual([
      quietRun('Без неявявания'),
      factRun('492,50 €'),
      quietRun(' общо'),
    ]);
  });
});

describe('the no-break grammar', () => {
  it('`unbroken` holds every word of a line but the one after a middot, a hyphen too', () => {
    expect(
      unbroken([
        factRun('24'),
        quietRun(` посещения${LINE_JOINT}през `),
        factRun('4'),
        quietRun(' седмици · 1 no-show'),
      ]),
    ).toEqual([
      factRun('24'),
      quietRun(`${NB}посещения${NB}· през${NB}`),
      factRun('4'),
      quietRun(`${NB}седмици${NB}· 1${NB}no-⁠show`),
    ]);
  });

  it('`heldFacts` holds the facts alone and leaves the quiet words to wrap', () => {
    expect(
      heldFacts([
        quietRun('Клиент от '),
        factRun('март 2025 г.'),
        quietRun(' · идва през '),
        factRun('4 седмици'),
      ]),
    ).toEqual([
      quietRun('Клиент от '),
      factRun(`март${NB}2025${NB}г.`),
      quietRun(' · идва през '),
      factRun(`4${NB}седмици`),
    ]);
  });

  it('`hungJoints` hangs the catalogue’s joints on the no-break space, in the quiet runs only', () => {
    expect(
      hungJoints([
        quietRun('Гост · без профил'),
        factRun('Фейд · Оформяне на брада'),
      ]),
    ).toEqual([
      quietRun(`Гост${LINE_JOINT}без профил`),
      factRun('Фейд · Оформяне на брада'),
    ]);
    expect(LINE_JOINT).toBe(`${NB}· `);
  });
});

describe('partedAtJoints', () => {
  it('parts the runs at the line’s joints into facts, the joints left out, a run that spans a joint cut at it', () => {
    const facts = partedAtJoints([
      quietRun('Клиент от '),
      factRun(`март${NB}2025${NB}г.`),
      quietRun(`${LINE_JOINT}идва през `),
      factRun(`4${NB}седмици`),
    ]);
    expect(facts).toEqual([
      [quietRun('Клиент от '), factRun(`март${NB}2025${NB}г.`)],
      [quietRun('идва през '), factRun(`4${NB}седмици`)],
    ]);
  });

  it('keeps a run’s other fields on every piece, and makes no empty fact', () => {
    const runs = [
      { text: `24${LINE_JOINT}`, fact: true, testId: 'a' },
      { text: `${LINE_JOINT}`, fact: false, testId: null },
      { text: 'през 4', fact: false, testId: 'b' },
    ] as const;
    expect(partedAtJoints(runs)).toEqual([
      [{ text: '24', fact: true, testId: 'a' }],
      [{ text: 'през 4', fact: false, testId: 'b' }],
    ]);
    expect(partedAtJoints([])).toEqual([]);
    expect(partedAtJoints([quietRun('Първо посещение')])).toEqual([
      [quietRun('Първо посещение')],
    ]);
  });
});
