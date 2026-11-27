import { RichSpanStyle, RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';
import { RichTextSystem } from '@core/systems';
import { blocksOf, documentOf, type UiRichNode } from './rich-text-document';

const plain = (text: string) => RichText.span(text);

const BODY: RichText = [
  RichText.heading(1, [plain('What you do')]),
  RichText.paragraph([
    plain('A chair at '),
    RichText.span('Center', RichSpanStyle.Bold),
    plain(', see '),
    RichText.span('the shop', RichSpanStyle.Italic, '/locations'),
    plain('.\nFive days.'),
  ]),
  RichText.heading(2, [plain('What you bring')]),
  RichText.list(false, [
    [plain('A '), RichText.span('steady', RichSpanStyle.BoldItalic)],
    [plain('Two years')],
  ]),
  RichText.list(true, [[plain('Write')], [plain('Come by')]]),
  RichText.quote([plain('Show us.\nWe build the rest.')]),
  RichText.image(ProgramImageId.of('pic-1'), 'The chair'),
];

describe('documentOf / blocksOf', () => {
  it('gives the editor one empty paragraph for no blocks, which reads back as no block', () => {
    expect(documentOf([])).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(blocksOf(documentOf([]))).toEqual([]);
  });

  it('writes every block as the editor’s nodes', () => {
    expect(documentOf(BODY)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'What you do' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A chair at ' },
            { type: 'text', text: 'Center', marks: [{ type: 'bold' }] },
            { type: 'text', text: ', see ' },
            {
              type: 'text',
              text: 'the shop',
              marks: [
                { type: 'italic' },
                { type: 'link', attrs: { href: '/locations' } },
              ],
            },
            { type: 'text', text: '.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Five days.' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'What you bring' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'A ' },
                    {
                      type: 'text',
                      text: 'steady',
                      marks: [{ type: 'bold' }, { type: 'italic' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Two years' }],
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Write' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Come by' }],
                },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Show us.' },
                { type: 'hardBreak' },
                { type: 'text', text: 'We build the rest.' },
              ],
            },
          ],
        },
        {
          type: 'richImage',
          attrs: { imageId: 'pic-1', imageAlt: 'The chair' },
        },
      ],
    });
  });

  it('reads the editor’s nodes back as the same blocks', () => {
    expect(blocksOf(documentOf(BODY))).toEqual(BODY);
  });

  it('keeps a stored description whole through the editor and back to Markdown', () => {
    const markdown = [
      '# What you do',
      'A chair at **Center**, see [*the shop*](/locations).\nFive days.',
      '- A ***steady*** hand\n- Two years',
      '1. Write\n2. Come by',
      '> Show us.\n> We build the rest.',
      '![The chair](pic-1)',
    ].join('\n\n');

    expect(
      RichTextSystem.write(
        blocksOf(documentOf(RichTextSystem.parse(markdown))),
      ),
    ).toBe(markdown);
  });

  it('leaves out a block nobody typed in', () => {
    const doc: UiRichNode = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 } },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] },
      ],
    };
    expect(blocksOf(doc)).toEqual([RichText.paragraph([plain('Words.')])]);
  });

  it('reads the paragraphs of a quote as one text, a line break between them', () => {
    const doc: UiRichNode = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One.' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Two.' }] },
          ],
        },
      ],
    };
    expect(blocksOf(doc)).toEqual([RichText.quote([plain('One.\nTwo.')])]);
  });

  it('reads a heading of any other level as the second', () => {
    const doc: UiRichNode = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Deep' }],
        },
      ],
    };
    expect(blocksOf(doc)).toEqual([RichText.heading(2, [plain('Deep')])]);
  });
});
