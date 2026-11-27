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
