import { RichBlockKind, RichSpanStyle, RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';

/*
 * THE EDITOR'S DOCUMENT, AS PLAIN DATA — the JSON a ProseMirror document
 * is read from and written to, and the two pure conversions between it and
 * the block list a description is (`RichText`). The editor is handed JSON
 * and asked for JSON, never an HTML string: the site's security header
 * forbids writing HTML into the page, and this is why nothing here needs
 * to. No editor code is imported, so the conversions are tested alone.
 */

/** A mark on a run of text. */
export type UiRichMark = {
  // eslint-disable-next-line creativo/no-generic-discriminator -- ProseMirror's own JSON: the key is the library's, not ours to name.
  readonly type: string;
  readonly attrs?: { readonly href?: string | null };
};

/** A node of the editor's document, as its JSON. */
export type UiRichNode = {
  // eslint-disable-next-line creativo/no-generic-discriminator -- ProseMirror's own JSON: the key is the library's, not ours to name.
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly UiRichNode[];
  readonly text?: string;
  readonly marks?: readonly UiRichMark[];
};

/** The node and mark names of the editor's schema — the only source of these strings. */
export const UiRichNodeName = {
  Doc: 'doc',
  Paragraph: 'paragraph',
  Heading: 'heading',
  BulletList: 'bulletList',
  OrderedList: 'orderedList',
  ListItem: 'listItem',
  Blockquote: 'blockquote',
  HardBreak: 'hardBreak',
  Image: 'richImage',
  Text: 'text',
} as const;

export const UiRichMarkName = {
  Bold: 'bold',
  Italic: 'italic',
  Link: 'link',
} as const;

function marksOf(span: RichText.Span): readonly UiRichMark[] {
  const marks: UiRichMark[] = [];
  const style = span.richSpanStyle;
  if (style === RichSpanStyle.Bold || style === RichSpanStyle.BoldItalic) {
    marks.push({ type: UiRichMarkName.Bold });
  }
  if (style === RichSpanStyle.Italic || style === RichSpanStyle.BoldItalic) {
    marks.push({ type: UiRichMarkName.Italic });
  }
  if (span.linkHref !== null) {
    marks.push({ type: UiRichMarkName.Link, attrs: { href: span.linkHref } });
  }
  return marks;
}

/** Runs as inline nodes: text with its marks, a line break as a hard break. */
function inlineOf(spans: readonly RichText.Span[]): UiRichNode[] {
  const out: UiRichNode[] = [];
  for (const span of spans) {
    const marks = marksOf(span);
    const lines = span.text.split('\n');
    for (let line = 0; line < lines.length; line++) {
      if (line > 0) out.push({ type: UiRichNodeName.HardBreak });
      const text = lines[line] as string;
      if (text.length === 0) continue;
      out.push(
        marks.length > 0
          ? { type: UiRichNodeName.Text, text, marks }
          : { type: UiRichNodeName.Text, text },
      );
    }
  }
  return out;
}

function paragraphOf(spans: readonly RichText.Span[]): UiRichNode {
  const content = inlineOf(spans);
  return content.length > 0
    ? { type: UiRichNodeName.Paragraph, content }
    : { type: UiRichNodeName.Paragraph };
}

/** The editor's document for `blocks` — never empty: no block is one empty paragraph. */
export function documentOf(blocks: RichText): UiRichNode {
  const content: UiRichNode[] = [];
  for (const block of blocks) {
    switch (block.richBlockKind) {
      case RichBlockKind.Heading:
        content.push({
          type: UiRichNodeName.Heading,
          attrs: { level: block.headingLevel },
          content: inlineOf(block.spans),
        });
        break;
      case RichBlockKind.Paragraph:
        content.push(paragraphOf(block.spans));
        break;
      case RichBlockKind.Quote:
        content.push({
          type: UiRichNodeName.Blockquote,
          content: [paragraphOf(block.spans)],
        });
        break;
      case RichBlockKind.List:
        content.push({
          type: block.listOrdered
            ? UiRichNodeName.OrderedList
            : UiRichNodeName.BulletList,
          content: block.listItems.map((item) => ({
            type: UiRichNodeName.ListItem,
            content: [paragraphOf(item)],
          })),
        });
        break;
      case RichBlockKind.Image:
        content.push({
          type: UiRichNodeName.Image,
          attrs: { imageId: block.imageId, imageAlt: block.imageAlt },
        });
        break;
    }
  }
  if (content.length === 0) content.push({ type: UiRichNodeName.Paragraph });
  return { type: UiRichNodeName.Doc, content };
}

function styleOf(marks: readonly UiRichMark[]): RichSpanStyle {
  let bold = false;
  let italic = false;
  for (const mark of marks) {
    if (mark.type === UiRichMarkName.Bold) bold = true;
    if (mark.type === UiRichMarkName.Italic) italic = true;
  }
  if (bold) return italic ? RichSpanStyle.BoldItalic : RichSpanStyle.Bold;
  return italic ? RichSpanStyle.Italic : RichSpanStyle.Plain;
}

function hrefOf(marks: readonly UiRichMark[]): string | null {
  for (const mark of marks) {
    if (mark.type === UiRichMarkName.Link) return mark.attrs?.href ?? null;
  }
  return null;
}

/** Adds a run to `out`, joined to the one before it when both are set alike. */
function pushRun(
  out: RichText.Span[],
  text: string,
  style: RichSpanStyle,
  href: string | null,
): void {
  const last = out[out.length - 1];
  if (
    last !== undefined &&
    last.richSpanStyle === style &&
    last.linkHref === href
  ) {
    out[out.length - 1] = RichText.span(last.text + text, style, href);
    return;
  }
  out.push(RichText.span(text, style, href));
}

/** A text block's inline nodes as runs; a hard break is a line break in the run before it. */
function spansInto(out: RichText.Span[], node: UiRichNode): void {
  for (const child of node.content ?? []) {
    if (child.type === UiRichNodeName.HardBreak) {
      const last = out[out.length - 1];
      pushRun(
        out,
        '\n',
        last?.richSpanStyle ?? RichSpanStyle.Plain,
        last?.linkHref ?? null,
      );
    } else if (child.type === UiRichNodeName.Text && child.text) {
      const marks = child.marks ?? [];
      pushRun(out, child.text, styleOf(marks), hrefOf(marks));
    }
  }
}

/** Every paragraph under `node` as one run list, a line break between two. */
function spansOfParagraphs(node: UiRichNode): RichText.Span[] {
  const out: RichText.Span[] = [];
  for (const child of node.content ?? []) {
    if (out.length > 0) pushRun(out, '\n', RichSpanStyle.Plain, null);
    spansInto(out, child);
  }
  return out;
}

/**
 * The blocks of the editor's document. A block with no words is left out,
 * so an editor nobody typed in is no block at all.
 */
export function blocksOf(doc: UiRichNode): RichText {
  const blocks: RichText.Block[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case UiRichNodeName.Heading: {
        const spans: RichText.Span[] = [];
        spansInto(spans, node);
        if (spans.length > 0) {
          blocks.push(
            RichText.heading(node.attrs?.['level'] === 1 ? 1 : 2, spans),
          );
        }
        break;
      }
      case UiRichNodeName.Paragraph: {
        const spans: RichText.Span[] = [];
        spansInto(spans, node);
        if (spans.length > 0) blocks.push(RichText.paragraph(spans));
        break;
      }
      case UiRichNodeName.Blockquote: {
        const spans = spansOfParagraphs(node);
        if (spans.length > 0) blocks.push(RichText.quote(spans));
        break;
      }
      case UiRichNodeName.BulletList:
      case UiRichNodeName.OrderedList: {
        const items: RichText.Span[][] = [];
        for (const item of node.content ?? []) {
          const spans = spansOfParagraphs(item);
          if (spans.length > 0) items.push(spans);
        }
        if (items.length > 0) {
          blocks.push(
            RichText.list(node.type === UiRichNodeName.OrderedList, items),
          );
        }
        break;
      }
      case UiRichNodeName.Image: {
        const imageId = node.attrs?.['imageId'];
        const imageAlt = node.attrs?.['imageAlt'];
        if (typeof imageId === 'string' && imageId.length > 0) {
          blocks.push(
            RichText.image(
              ProgramImageId.of(imageId),
              typeof imageAlt === 'string' ? imageAlt : '',
            ),
          );
        }
        break;
      }
    }
  }
  return blocks;
}
