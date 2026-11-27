import fc from 'fast-check';
import { RichBlockKind, RichSpanStyle, RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { RichTextSystem } from './rich-text.system';

const { Plain, Bold, Italic, BoldItalic } = RichSpanStyle;
const plain = (text: string) => RichText.span(text);
const paragraph = (...spans: RichText.Span[]) => RichText.paragraph(spans);

/** Every word a body prints, block by block — the marks gone, the text kept. */
function printed(blocks: RichText): string[] {
  const join = (spans: readonly RichText.Span[]) =>
    spans.map((span) => span.text).join('');
  return blocks.map((block) => {
    switch (block.richBlockKind) {
      case RichBlockKind.List:
        return block.listItems.map(join).join(' | ');
      case RichBlockKind.Image:
        return block.imageAlt;
      default:
        return join(block.spans);
    }
  });
}

describe('RichTextSystem.parse — blocks', () => {
  it('answers no block for an empty or blank body', () => {
    expect(RichTextSystem.parse('')).toEqual([]);
    expect(RichTextSystem.parse('  \n\n \r\n')).toEqual([]);
  });

  it('reads the two heading levels', () => {
    expect(RichTextSystem.parse('# What you do\n## Day to day')).toEqual([
      RichText.heading(1, [plain('What you do')]),
      RichText.heading(2, [plain('Day to day')]),
    ]);
  });

  it('reads a paragraph, and keeps a line break typed inside it', () => {
    expect(
      RichTextSystem.parse('Five days a week.\nIn the Center shop.'),
    ).toEqual([paragraph(plain('Five days a week.\nIn the Center shop.'))]);
  });

  it('sets paragraphs apart at a blank line', () => {
    expect(RichTextSystem.parse('One.\n\n\nTwo.')).toEqual([
      paragraph(plain('One.')),
      paragraph(plain('Two.')),
    ]);
  });

  it('reads a bulleted list, by dash or by star, one item per line', () => {
    expect(RichTextSystem.parse('- Fades\n- Beards\n* Shaves')).toEqual([
      RichText.list(false, [
        [plain('Fades')],
        [plain('Beards')],
        [plain('Shaves')],
      ]),
    ]);
  });

  it('reads a numbered list and does not keep the digits', () => {
    expect(
      RichTextSystem.parse('1. Write to us\n2. Come by\n10. Start'),
    ).toEqual([
      RichText.list(true, [
        [plain('Write to us')],
        [plain('Come by')],
        [plain('Start')],
      ]),
    ]);
  });

  it('ends a list where the other kind of list begins', () => {
    const blocks = RichTextSystem.parse('- a\n1. b\n- c');
    expect(blocks.map((block) => block.richBlockKind)).toEqual([
      RichBlockKind.List,
      RichBlockKind.List,
      RichBlockKind.List,
    ]);
  });

  it('reads a quote, its lines one text', () => {
    expect(
      RichTextSystem.parse(
        '> Show us your work.\n> The rest we build together.',
      ),
    ).toEqual([
      RichText.quote([
        plain('Show us your work.\nThe rest we build together.'),
      ]),
    ]);
  });

  it('reads a picture alone on its line, named by its id', () => {
    expect(
      RichTextSystem.parse('![The chair by the window](img_01-a)'),
    ).toEqual([
      RichText.image(ProgramImageId.of('img_01-a'), 'The chair by the window'),
    ]);
    expect(RichTextSystem.parse('![](x)')).toEqual([
      RichText.image(ProgramImageId.of('x'), ''),
    ]);
  });

  it('sets blocks of different kinds apart without a blank line', () => {
    const blocks = RichTextSystem.parse(
      '# Role\nWords.\n- one\n> said\n![alt](pic)\nMore words.',
    );
    expect(blocks.map((block) => block.richBlockKind)).toEqual([
      RichBlockKind.Heading,
      RichBlockKind.Paragraph,
      RichBlockKind.List,
      RichBlockKind.Quote,
      RichBlockKind.Image,
      RichBlockKind.Paragraph,
    ]);
  });

  it('reads Windows line ends and ignores the spaces around a line', () => {
    expect(
      RichTextSystem.parse('  # Role  \r\n\r\n   - one  \r\n\t- two'),
    ).toEqual([
      RichText.heading(1, [plain('Role')]),
      RichText.list(false, [[plain('one')], [plain('two')]]),
    ]);
  });
});

describe('RichTextSystem.parse — runs', () => {
  it('reads bold and italic, by star or by underscore', () => {
    expect(
      RichTextSystem.parse('A **bold** and *slanted* and _slanted_ word.'),
    ).toEqual([
      paragraph(
        plain('A '),
        RichText.span('bold', Bold),
        plain(' and '),
        RichText.span('slanted', Italic),
        plain(' and '),
        RichText.span('slanted', Italic),
        plain(' word.'),
      ),
    ]);
  });

  it('reads one inside the other, either way round', () => {
    expect(RichTextSystem.parse('***both***')).toEqual([
      paragraph(RichText.span('both', BoldItalic)),
    ]);
    expect(RichTextSystem.parse('**bold _and both_ bold**')).toEqual([
      paragraph(
        RichText.span('bold ', Bold),
        RichText.span('and both', BoldItalic),
        RichText.span(' bold', Bold),
      ),
    ]);
    expect(RichTextSystem.parse('*slanted **and both** slanted*')).toEqual([
      paragraph(
        RichText.span('slanted ', Italic),
        RichText.span('and both', BoldItalic),
        RichText.span(' slanted', Italic),
      ),
    ]);
  });

  it.each([
    'https://creativo.example/work',
    'http://creativo.example',
    'mailto:jobs@creativo.example',
    'tel:+359888123456',
    '/courses',
    'HTTPS://CREATIVO.EXAMPLE',
  ])('reads a link to %s', (address) => {
    expect(RichTextSystem.parse(`See [our work](${address}).`)).toEqual([
      paragraph(
        plain('See '),
        RichText.span('our work', Plain, address),
        plain('.'),
      ),
    ]);
  });

  it('keeps the style of a link’s words, inside and around it', () => {
    expect(RichTextSystem.parse('**[bold](/a)** [a *slanted* b](/b)')).toEqual([
      paragraph(
        RichText.span('bold', Bold, '/a'),
        plain(' '),
        RichText.span('a ', Plain, '/b'),
        RichText.span('slanted', Italic, '/b'),
        RichText.span(' b', Plain, '/b'),
      ),
    ]);
  });

  it('reads runs in a heading, a list item and a quote alike', () => {
    const blocks = RichTextSystem.parse('# A **b**\n- A **b**\n> A **b**');
    const runs = [plain('A '), RichText.span('b', Bold)];
    expect(blocks).toEqual([
      RichText.heading(1, runs),
      RichText.list(false, [runs]),
      RichText.quote(runs),
    ]);
  });

  it('prints a mark a backslash stands before', () => {
    expect(
      RichTextSystem.parse('\\*not slanted\\* \\[x\\](/y) 5\\_000'),
    ).toEqual([paragraph(plain('*not slanted* [x](/y) 5_000'))]);
    expect(RichTextSystem.parse('\\# Not a heading')).toEqual([
      paragraph(plain('# Not a heading')),
    ]);
    expect(RichTextSystem.parse('1\\. Not a list')).toEqual([
      paragraph(plain('1. Not a list')),
    ]);
  });
});

describe('RichTextSystem.parse — text outside the subset is printed as itself', () => {
  it.each([
    ['a third heading level', '### Too deep'],
    ['a heading with no words', '#'],
    ['a hash with no space', '#hashtag'],
    ['a rule', '---'],
    ['a table', '| a | b |\n| - | - |'],
    ['code', 'Run `npm install` now'],
    ['HTML', '<b onclick="x()">bold</b> <script>alert(1)</script>'],
    ['a bold with no end', 'A **bold with no end'],
    ['an italic with no end', 'A *slant and _another'],
    ['empty marks', '**** and ** ** and __'],
    ['a star between spaces', '2 * 3 * 4'],
    ['an underscore inside a word', 'snake_case_word and име_на_файл'],
    ['a double underscore', '__init__'],
    ['a label with no address', '[just brackets] and [a](b'],
    ['a task box', '[ ] to do'],
    ['a bare address', 'https://creativo.example'],
    ['a picture inside a line', 'See ![alt](pic) here'],
    ['a picture whose id is an address', '![alt](https://x.example/a.png)'],
    ['a picture whose id has a slash', '![alt](a/b)'],
    ['a lone quote mark', '>'],
    ['a lone backslash', 'a \\ b \\'],
  ])('%s', (_what, markdown) => {
    const blocks = RichTextSystem.parse(markdown);
    expect(blocks.map((block) => block.richBlockKind)).toEqual([
      RichBlockKind.Paragraph,
    ]);
    expect(printed(blocks)).toEqual([markdown]);
    const [block] = blocks as [RichText.Paragraph];
    expect(block.spans).toEqual([plain(markdown)]);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    '//evil.example',
    'ftp://x.example',
    'https://',
    'mailto:',
    'relative/path',
    '',
  ])('a link to «%s» is text, never a link', (address) => {
    const markdown = `[tap me](${address})`;
    expect(RichTextSystem.parse(markdown)).toEqual([
      paragraph(plain(markdown)),
    ]);
  });

  it('an address with a space in it is text', () => {
    const markdown = '[a](https://x.example/a b)';
    expect(printed(RichTextSystem.parse(markdown))).toEqual([markdown]);
    expect(
      RichTextSystem.parse(markdown).every(
        (block) =>
          block.richBlockKind !== RichBlockKind.Paragraph ||
          block.spans.every((span) => span.linkHref === null),
      ),
    ).toBe(true);
  });

  it('drops no word of a long mixed body', () => {
    const markdown = [
      '# Barber — full time',
      'Five days a week at **Center**. See [the shop](/locations).',
      '',
      '## What you bring',
      '- Two years behind a chair',
      '- A *steady* hand',
      '',
      '1. Write to us',
      '',
      '> We build the rest together.',
      '### kept as typed',
    ].join('\n');
    expect(printed(RichTextSystem.parse(markdown))).toEqual([
      'Barber — full time',
      'Five days a week at Center. See the shop.',
      'What you bring',
      'Two years behind a chair | A steady hand',
      'Write to us',
      'We build the rest together.',
      '### kept as typed',
    ]);
  });
});

describe('RichTextSystem.parse — purity and cost', () => {
  it('is pure: same input → same output, and the answer shares nothing', () => {
    const markdown = '# A\n\nB **c** [d](/e)\n- f\n> g\n![h](i)';
    const once = deepFreeze(RichTextSystem.parse(markdown));
    const twice = RichTextSystem.parse(markdown);
    expect(twice).toEqual(once);
    expect(twice).not.toBe(once);
  });

  it('reads a body of nothing but unpaired marks at the size limit', () => {
    for (const mark of ['*a ', '**a ', '_a ', '[a ', '[a] ', '*', '_', '\\a']) {
      const markdown = mark
        .repeat(Math.ceil(RichText.BODY_MAX_CHARS / mark.length))
        .slice(0, RichText.BODY_MAX_CHARS)
        .trim();
      const blocks = RichTextSystem.parse(markdown);
      expect(printed(blocks).join(''), mark).toHaveLength(markdown.length);
    }
  });
});

describe('RichTextSystem.write', () => {
  const round = (blocks: RichText) =>
    RichTextSystem.parse(RichTextSystem.write(blocks));

  it('writes nothing for no blocks, and for blocks with no words', () => {
    expect(RichTextSystem.write([])).toBe('');
    expect(
      RichTextSystem.write([
        paragraph(plain('  ')),
        RichText.heading(1, []),
        RichText.list(false, [[], [plain(' ')]]),
        RichText.quote([plain('\n')]),
      ]),
    ).toBe('');
  });

  it('writes every block of the subset as the Markdown the parser reads', () => {
    const blocks: RichText = [
      RichText.heading(1, [plain('What you do')]),
      paragraph(
        plain('A chair at '),
        RichText.span('Center', Bold),
        plain(', see '),
        RichText.span('the shop', Plain, '/locations'),
        plain('.\nFive days.'),
      ),
      RichText.heading(2, [plain('What you bring')]),
      RichText.list(false, [
        [plain('A '), RichText.span('steady', Italic), plain(' hand')],
        [RichText.span('Both', BoldItalic)],
      ]),
      RichText.list(true, [[plain('Write')], [plain('Come by')]]),
      RichText.quote([plain('Show us.\nWe build the rest.')]),
      RichText.image(ProgramImageId.of('pic-1'), 'The chair'),
    ];

    expect(RichTextSystem.write(blocks)).toBe(
      [
        '# What you do',
        'A chair at **Center**, see [the shop](/locations).\nFive days.',
        '## What you bring',
        '- A *steady* hand\n- ***Both***',
        '1. Write\n2. Come by',
        '> Show us.\n> We build the rest.',
        '![The chair](pic-1)',
      ].join('\n\n'),
    );
    expect(round(blocks)).toEqual(blocks);
  });

  it('writes a mark typed as text so that it stays text', () => {
    const typed = [
      '# not a heading',
      '- not a list',
      '> not a quote',
      '1. not a list',
      '![not](a-picture)',
      '**not bold** *nor slanted* _nor this_ [nor a](/link) back\\slash `tick`',
    ];
    const blocks = typed.map((text) => paragraph(plain(text)));
    expect(round(blocks)).toEqual(blocks);
    expect(
      round([
        RichText.list(
          false,
          typed.map((text) => [plain(text)]),
        ),
      ]),
    ).toEqual([
      RichText.list(
        false,
        typed.map((text) => [plain(text)]),
      ),
    ]);
  });

  it('keeps runs set differently apart when they touch', () => {
    const styles = [Plain, Bold, Italic, BoldItalic] as const;
    for (const a of styles) {
      for (const b of styles) {
        for (const c of styles) {
          if (a === b || b === c) continue;
          const blocks = [
            paragraph(
              RichText.span('a', a),
              RichText.span('b', b),
              RichText.span('c', c),
            ),
          ];
          expect(round(blocks), `${a} ${b} ${c}`).toEqual(blocks);
        }
      }
    }
  });

  it('leaves the spaces at a run’s edges outside its marks', () => {
    expect(
      RichTextSystem.write([
        paragraph(plain('a'), RichText.span(' bold ', Bold), plain('b')),
      ]),
    ).toBe('a **bold** b');
  });

  it('writes a heading and a list item on one line, and one address in one link', () => {
    expect(
      RichTextSystem.write([
        RichText.heading(2, [plain('Two\nlines')]),
        RichText.list(false, [[plain('Two\nlines')]]),
        paragraph(
          RichText.span('a ', Plain, 'https://x.example/(1)'),
          RichText.span('b', Bold, 'https://x.example/(1)'),
        ),
      ]),
    ).toBe(
      '## Two lines\n\n- Two lines\n\n[a **b**](https://x.example/%281%29)',
    );
  });

  it('writes a link whose address the parser would refuse as its words alone', () => {
    expect(
      RichTextSystem.write([
        paragraph(RichText.span('tap', Plain, 'javascript:alert(1)')),
      ]),
    ).toBe('tap');
  });

  it('reads back what it wrote, whatever was typed (property)', () => {
    const word = fc
      .array(fc.constantFrom(...'abяж09*_[]()#>-!.\\`'.split('')), {
        minLength: 1,
        maxLength: 6,
      })
      .map((chars) => chars.join(''));
    const text = (breaks: boolean) =>
      fc
        .array(fc.tuple(word, fc.constantFrom(' ', breaks ? '\n' : ' ')), {
          minLength: 1,
          maxLength: 4,
        })
        .map((parts) =>
          parts
            .map(([w, joiner], index) =>
              index === parts.length - 1 ? w : w + joiner,
            )
            .join(''),
        );
    const spans = (breaks: boolean) =>
      fc
        .array(
          fc.record({
            text: text(breaks),
            richSpanStyle: fc.constantFrom(Plain, Bold, Italic, BoldItalic),
            linkHref: fc.constantFrom(null, '/a', 'https://x.example/b'),
          }),
          { minLength: 1, maxLength: 5 },
        )
        .filter((list) =>
          list.every(
            (span, index) =>
              index === 0 ||
              span.richSpanStyle !== list[index - 1]?.richSpanStyle ||
              span.linkHref !== list[index - 1]?.linkHref,
          ),
        );
    const block = fc.oneof(
      spans(true).map((s) => RichText.paragraph(s)),
      spans(true).map((s) => RichText.quote(s)),
      fc
        .tuple(fc.constantFrom<1 | 2>(1, 2), spans(false))
        .map(([level, s]) => RichText.heading(level, s)),
      fc
        .tuple(
          fc.boolean(),
          fc.array(spans(false), { minLength: 1, maxLength: 3 }),
        )
        .map(([ordered, items]) => RichText.list(ordered, items)),
    );

    fc.assert(
      fc.property(fc.array(block, { maxLength: 5 }), (blocks) => {
        // Two paragraphs, or two quotes, in a row are told apart by the
        // blank line the writer puts between blocks.
        expect(round(blocks)).toEqual(blocks);
      }),
      { numRuns: 500 },
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const blocks = deepFreeze(
      RichTextSystem.parse('# A\n\nB **c** [d](/e)\n- f\n> g\n![h](i)'),
    );
    expect(RichTextSystem.write(blocks)).toBe(RichTextSystem.write(blocks));
  });
});

describe('RichTextSystem.linkHref', () => {
  it.each([
    ['https://creativo.example/work', 'https://creativo.example/work'],
    ['  /courses ', '/courses'],
    ['mailto:jobs@creativo.example', 'mailto:jobs@creativo.example'],
    ['tel:+359888123456', 'tel:+359888123456'],
    ['creativo.example', 'https://creativo.example'],
    ['www.creativo.example/a?b=1', 'https://www.creativo.example/a?b=1'],
    ['jobs@creativo.example', 'mailto:jobs@creativo.example'],
    ['+359 888 123 456', 'tel:+359888123456'],
    ['(02) 987-65-43', 'tel:029876543'],
  ])('reads «%s» as %s', (typed, href) => {
    expect(RichTextSystem.linkHref(typed)).toBe(href);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://x.example',
    '//evil.example',
    'just words',
    'two words.example',
    'word',
    '@nobody',
    '12345',
  ])('refuses «%s»', (typed) => {
    expect(RichTextSystem.linkHref(typed)).toBeNull();
  });
});
