import { RichBlockKind, RichSpanStyle, RichText } from '@core/components';
import { ProgramImageId } from '@core/primitives';

/**
 * RichTextSystem — the Markdown a body is stored as, parsed into the flat
 * block list a page draws (`RichText`). Decided in
 * `docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`:
 * a small fixed subset, a parser of our own, and anything outside the subset
 * printed as the text it is — nothing is dropped and nothing can run.
 *
 * THE SUBSET
 *
 * Blocks, one or more lines each, set apart by a blank line or by a line of
 * another kind (a line's own leading and trailing spaces never count):
 *
 * - `# Heading` and `## Heading` — the two levels;
 * - `- item` or `* item` — a bulleted list, one item per line;
 * - `1. item` — a numbered list (the page numbers it; the digits are not kept);
 * - `> words` — a quote, its lines one text;
 * - `![alt](imageId)` alone on a line — a picture, named by its id;
 * - anything else — a paragraph. A line break inside a paragraph or a quote
 *   stays a line break (`\n` in the run's text).
 *
 * Runs, inside any block's text:
 *
 * - `**bold**`, `*italic*`, `_italic_`, and one inside the other;
 * - `[label](address)` — a link, when the address is `https://…`,
 *   `http://…`, `mailto:…`, `tel:…` or a site path (`/careers`);
 * - `\` before a mark prints the mark.
 *
 * A mark with no partner, an address of another scheme, a third heading
 * level, a table, code, HTML — all are text, printed as typed.
 *
 * Linear in the text: a mark whose partner was not found is not looked for
 * again from further on.
 */

/** The character codes the scanner reads. */
const Code = {
  Newline: 10,
  Space: 32,
  Bang: 33,
  Hash: 35,
  ParenOpen: 40,
  ParenClose: 41,
  Star: 42,
  Dash: 45,
  Dot: 46,
  Slash: 47,
  Zero: 48,
  Nine: 57,
  Greater: 62,
  BracketOpen: 91,
  Backslash: 92,
  BracketClose: 93,
  Underscore: 95,
  NoBreakSpace: 160,
} as const;

/** What a line begins — the block it opens or continues. */
const LineKind = {
  Blank: 'BLANK',
  Heading1: 'HEADING_1',
  Heading2: 'HEADING_2',
  Bullet: 'BULLET',
  Ordered: 'ORDERED',
  Quote: 'QUOTE',
  Image: 'IMAGE',
  Text: 'TEXT',
} as const;
type LineKind = (typeof LineKind)[keyof typeof LineKind];

/** The longest address a link may carry. */
const HREF_MAX_CHARS = 2048;
/** The longest picture id a body may name. */
const IMAGE_ID_MAX_CHARS = 64;
/** The most digits a numbered item's number may have. */
const ORDINAL_MAX_DIGITS = 9;

/** The marks a `\` may stand before, and the line break it may end a line with. */
const ESCAPABLE = '\\*_[]()#>-!.`\n';

const WORD_CHAR = /[\p{L}\p{N}]/u;
const LINE_BREAKS = /\r\n?/g;

function isSpace(code: number): boolean {
  return code <= Code.Space || code === Code.NoBreakSpace;
}

function isDigit(code: number): boolean {
  return code >= Code.Zero && code <= Code.Nine;
}

/** A letter or a digit of any script at `at` — `false` past either end. */
function isWordAt(text: string, at: number, start: number, end: number) {
  return at >= start && at < end && WORD_CHAR.test(text.charAt(at));
}

/** How many `code`s stand in a row from `at`. */
function runLength(text: string, at: number, end: number, code: number) {
  let next = at;
  while (next < end && text.charCodeAt(next) === code) next++;
  return next - at;
}

// ── Lines ─────────────────────────────────────────────────────────────────

/** Where a numbered item's words begin (`12. words`), or `-1`. */
function orderedContentStart(line: string): number {
  let at = 0;
  while (at < line.length && isDigit(line.charCodeAt(at))) at++;
  if (at === 0 || at > ORDINAL_MAX_DIGITS) return -1;
  if (line.charCodeAt(at) !== Code.Dot) return -1;
  if (line.charCodeAt(at + 1) !== Code.Space) return -1;
  return at + 2 < line.length ? at + 2 : -1;
}

/** Where a picture line's alt text ends (`![alt](id)` whole), or `-1`. */
function imageAltEnd(line: string): number {
  if (line.charCodeAt(0) !== Code.Bang) return -1;
  if (line.charCodeAt(1) !== Code.BracketOpen) return -1;
  if (line.charCodeAt(line.length - 1) !== Code.ParenClose) return -1;
  const altEnd = line.indexOf('](');
  if (altEnd < 0 || line.indexOf(']') !== altEnd) return -1;
  const idStart = altEnd + 2;
  const idEnd = line.length - 1;
  if (idEnd <= idStart || idEnd - idStart > IMAGE_ID_MAX_CHARS) return -1;
  for (let at = idStart; at < idEnd; at++) {
    const code = line.charCodeAt(at);
    const named =
      isDigit(code) ||
      code === Code.Dash ||
      code === Code.Underscore ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!named) return -1;
  }
  return altEnd;
}

/** The kind of a line already trimmed. */
function lineKindOf(line: string): LineKind {
  if (line.length === 0) return LineKind.Blank;
  const first = line.charCodeAt(0);
  const second = line.charCodeAt(1);
  if (first === Code.Hash) {
    if (second === Code.Space && line.length > 2) return LineKind.Heading1;
    if (
      second === Code.Hash &&
      line.charCodeAt(2) === Code.Space &&
      line.length > 3
    ) {
      return LineKind.Heading2;
    }
    return LineKind.Text;
  }
  if (
    (first === Code.Dash || first === Code.Star) &&
    second === Code.Space &&
    line.length > 2
  ) {
    return LineKind.Bullet;
  }
  if (first === Code.Greater && second === Code.Space && line.length > 2) {
    return LineKind.Quote;
  }
  if (first === Code.Bang && imageAltEnd(line) >= 0) return LineKind.Image;
  if (isDigit(first) && orderedContentStart(line) >= 0) return LineKind.Ordered;
  return LineKind.Text;
}

/** A line's words, past the mark its kind begins with. */
function contentOf(line: string, kind: LineKind): string {
  switch (kind) {
    case LineKind.Heading1:
    case LineKind.Bullet:
    case LineKind.Quote:
      return line.slice(2).trim();
    case LineKind.Heading2:
      return line.slice(3).trim();
    case LineKind.Ordered:
      return line.slice(orderedContentStart(line)).trim();
    default:
      return line;
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────

function styleOf(bold: boolean, italic: boolean): RichSpanStyle {
  if (bold) return italic ? RichSpanStyle.BoldItalic : RichSpanStyle.Bold;
  return italic ? RichSpanStyle.Italic : RichSpanStyle.Plain;
}

/** Adds `text` to `out`, joined to the run before it when both are set alike. */
function push(
  out: RichText.Span[],
  text: string,
  style: RichSpanStyle,
  href: string | null,
): void {
  if (text.length === 0) return;
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

/**
 * The `**` that ends a bold begun before `from`, or `-1`. An italic opened
 * inside the bold and still open is closed by the first star of a longer
 * run (`***both***`); with none open, the first two of the run close the
 * bold and the rest begins what follows (`**a***b*`).
 */
function boldCloser(text: string, from: number, end: number): number {
  let italicOpen = false;
  let at = from;
  while (at < end) {
    const code = text.charCodeAt(at);
    if (code === Code.Backslash) {
      at += 2;
    } else if (code === Code.Star) {
      const run = runLength(text, at, end, Code.Star);
      if (run === 1) {
        const closes = italicOpen && !isSpace(text.charCodeAt(at - 1));
        const opens =
          !italicOpen && at + 1 < end && !isSpace(text.charCodeAt(at + 1));
        if (closes || opens) italicOpen = !italicOpen;
      } else {
        const close = italicOpen && run >= 3 ? at + 1 : at;
        if (close > from && !isSpace(text.charCodeAt(close - 1))) return close;
      }
      at += run;
    } else {
      at++;
    }
  }
  return -1;
}

/**
 * The single `*` that ends an italic begun before `from`, or `-1`. Two
 * stars are a bold's mark and are passed over; of a longer run, the star
 * after a bold still open inside (`*a **b***`), else the first
 * (`*a***b**`).
 */
function starCloser(text: string, from: number, end: number): number {
  let boldOpen = false;
  let at = from;
  while (at < end) {
    const code = text.charCodeAt(at);
    if (code === Code.Backslash) {
      at += 2;
    } else if (code === Code.Star) {
      const run = runLength(text, at, end, Code.Star);
      if (run === 2) {
        const closes = boldOpen && !isSpace(text.charCodeAt(at - 1));
        const opens =
          !boldOpen && at + 2 < end && !isSpace(text.charCodeAt(at + 2));
        if (closes || opens) boldOpen = !boldOpen;
      } else {
        const close = boldOpen && run >= 3 ? at + 2 : at;
        if (close > from && !isSpace(text.charCodeAt(close - 1))) return close;
      }
      at += run;
    } else {
      at++;
    }
  }
  return -1;
}

/** The single `_` that ends an italic begun before `from`, or `-1`. */
function underscoreCloser(text: string, from: number, end: number): number {
  let at = from;
  while (at < end) {
    const code = text.charCodeAt(at);
    if (code === Code.Backslash) {
      at += 2;
    } else if (code === Code.Underscore) {
      const run = runLength(text, at, end, Code.Underscore);
      if (
        run === 1 &&
        at > from &&
        !isSpace(text.charCodeAt(at - 1)) &&
        !isWordAt(text, at + 1, from, end)
      ) {
        return at;
      }
      at += run;
    } else {
      at++;
    }
  }
  return -1;
}

/**
 * The `]` that ends a label begun before `from`: `-1` when none is ahead at
 * all, `-2` when another `[` opens first (this `[` is text; a later one may
 * still be a label).
 */
function labelCloser(text: string, from: number, end: number): number {
  let at = from;
  while (at < end) {
    const code = text.charCodeAt(at);
    if (code === Code.Backslash) {
      at += 2;
    } else if (code === Code.BracketOpen) {
      return -2;
    } else if (code === Code.BracketClose) {
      return at;
    } else {
      at++;
    }
  }
  return -1;
}

/** An address a link may carry: a web, mail or phone address, or a site path. */
function isLinkHref(href: string): boolean {
  if (href.length === 0 || href.length > HREF_MAX_CHARS) return false;
  for (let at = 0; at < href.length; at++) {
    if (isSpace(href.charCodeAt(at))) return false;
  }
  if (href.charCodeAt(0) === Code.Slash) {
    return href.charCodeAt(1) !== Code.Slash;
  }
  const lower = href.slice(0, 8).toLowerCase();
  if (lower.startsWith('https://')) return href.length > 8;
  if (lower.startsWith('http://')) return href.length > 7;
  if (lower.startsWith('mailto:')) return href.length > 7;
  if (lower.startsWith('tel:')) return href.length > 4;
  return false;
}

/** A phone number as typed: digits with spaces, brackets and dashes, a `+` in front. */
const PHONE_TYPED = /^\+?[\d\s()-]+$/;
const NOT_DIALLED = /[^\d+]/g;
const PHONE_MIN_DIGITS = 6;

/**
 * Reads `text[start, end)` into `out` as runs set in the style it is handed.
 * A mark that opens a style already on, or whose partner is not ahead, is
 * text.
 */
function scan(
  text: string,
  start: number,
  end: number,
  bold: boolean,
  italic: boolean,
  href: string | null,
  out: RichText.Span[],
): void {
  const style = styleOf(bold, italic);
  // No partner ahead (or the style is on already): stop looking.
  let noBold = bold;
  let noStar = italic;
  let noUnderscore = italic;
  let noLabel = href !== null;
  let pending = '';
  // Where the last `\\`-escaped character stands: it is text, never a mark.
  let escapedAt = -1;
  let from = start;
  let at = start;

  while (at < end) {
    const code = text.charCodeAt(at);

    if (code === Code.Backslash) {
      if (at + 1 < end && ESCAPABLE.includes(text.charAt(at + 1))) {
        pending += text.slice(from, at);
        from = at + 1;
        escapedAt = at + 1;
        at += 2;
      } else {
        at++;
      }
      continue;
    }

    if (code === Code.Star) {
      const run = runLength(text, at, end, Code.Star);
      const opens = at + run < end && !isSpace(text.charCodeAt(at + run));
      if (opens && run >= 2 && !noBold) {
        const close = boldCloser(text, at + 2, end);
        if (close >= 0) {
          push(out, pending + text.slice(from, at), style, href);
          pending = '';
          scan(text, at + 2, close, true, italic, href, out);
          at = from = close + 2;
          continue;
        }
        noBold = true;
      }
      if (opens && run === 1 && !noStar) {
        const close = starCloser(text, at + 1, end);
        if (close >= 0) {
          push(out, pending + text.slice(from, at), style, href);
          pending = '';
          scan(text, at + 1, close, bold, true, href, out);
          at = from = close + 1;
          continue;
        }
        noStar = true;
      }
      at += run;
      continue;
    }

    if (code === Code.Underscore) {
      const run = runLength(text, at, end, Code.Underscore);
      const opens =
        run === 1 &&
        at + 1 < end &&
        !isSpace(text.charCodeAt(at + 1)) &&
        !isWordAt(text, at - 1, start, end);
      if (opens && !noUnderscore) {
        const close = underscoreCloser(text, at + 1, end);
        if (close >= 0) {
          push(out, pending + text.slice(from, at), style, href);
          pending = '';
          scan(text, at + 1, close, bold, true, href, out);
          at = from = close + 1;
          continue;
        }
        noUnderscore = true;
      }
      at += run;
      continue;
    }

    // `![alt](…)` inside a line is a picture out of place, never a link.
    const afterBang =
      at > start &&
      escapedAt !== at - 1 &&
      text.charCodeAt(at - 1) === Code.Bang;
    if (code === Code.BracketOpen && !noLabel && !afterBang) {
      const labelEnd = labelCloser(text, at + 1, end);
      if (labelEnd === -1) noLabel = true;
      if (
        labelEnd > at + 1 &&
        text.charCodeAt(labelEnd + 1) === Code.ParenOpen
      ) {
        const hrefEnd = text.indexOf(')', labelEnd + 2);
        if (hrefEnd >= 0 && hrefEnd < end) {
          const address = text.slice(labelEnd + 2, hrefEnd);
          if (isLinkHref(address)) {
            push(out, pending + text.slice(from, at), style, href);
            pending = '';
            scan(text, at + 1, labelEnd, bold, italic, address, out);
            at = from = hrefEnd + 1;
            continue;
          }
        }
      }
    }

    at++;
  }

  push(out, pending + text.slice(from, end), style, href);
}

/** A block's text as its runs. */
function spansOf(text: string): readonly RichText.Span[] {
  const out: RichText.Span[] = [];
  scan(text, 0, text.length, false, false, null, out);
  return out;
}

// ── Writing ───────────────────────────────────────────────────────────────

/** The marks a run's text is written with a `\` before, so they stay text. */
const INLINE_MARKS = /[\\*_[\]`]/g;
/** A line break, with the spaces around it. */
const BREAKS = /[^\S\n]*\n[\s]*/g;
const LEADING_SPACE = /^\s+/;
const TRAILING_SPACE = /\s+$/;

/** A line's first mark written so it does not begin a block. */
function escapeLineStart(line: string): string {
  const first = line.charCodeAt(0);
  if (first === Code.Hash || first === Code.Greater || first === Code.Dash) {
    return '\\' + line;
  }
  if (isDigit(first)) {
    let at = 0;
    while (at < line.length && isDigit(line.charCodeAt(at))) at++;
    if (line.charCodeAt(at) === Code.Dot) {
      return line.slice(0, at) + '\\' + line.slice(at);
    }
  }
  return line;
}

/** The marks a style is written between. */
function marksOf(style: RichSpanStyle): string {
  switch (style) {
    case RichSpanStyle.Bold:
      return '**';
    case RichSpanStyle.Italic:
      return '*';
    case RichSpanStyle.BoldItalic:
      return '***';
    default:
      return '';
  }
}

/** One run's words between its marks, the spaces at its edges left outside them. */
function writeRun(span: RichText.Span, singleLine: boolean): string {
  const text = span.text.replace(BREAKS, singleLine ? ' ' : '\n');
  const marks = marksOf(span.richSpanStyle);
  if (marks === '') return text.replace(INLINE_MARKS, '\\$&');
  const lead = LEADING_SPACE.exec(text)?.[0] ?? '';
  if (lead.length === text.length) return text;
  const trail = TRAILING_SPACE.exec(text)?.[0] ?? '';
  const words = text.slice(lead.length, text.length - trail.length);
  return lead + marks + words.replace(INLINE_MARKS, '\\$&') + marks + trail;
}

/**
 * A block's runs as one text: each between its marks, the runs of one
 * address inside one `[label](address)`.
 */
function writeSpans(
  spans: readonly RichText.Span[],
  singleLine: boolean,
): string {
  let out = '';
  let at = 0;
  while (at < spans.length) {
    const href = (spans[at] as RichText.Span).linkHref;
    let label = '';
    while (
      at < spans.length &&
      (spans[at] as RichText.Span).linkHref === href
    ) {
      label += writeRun(spans[at] as RichText.Span, singleLine);
      at++;
    }
    if (href === null || !isLinkHref(href) || label.trim().length === 0) {
      out += label;
    } else {
      // A `!` right before a link would read as a picture out of place.
      if (out.endsWith('!')) out = out.slice(0, -1) + '\\!';
      out += `[${label}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
    }
  }
  const lines = out.trim().split('\n');
  for (let line = 0; line < lines.length; line++) {
    lines[line] = escapeLineStart((lines[line] as string).trim());
  }
  return lines.join('\n');
}

export const RichTextSystem = {
  /**
   * The body's blocks, top to bottom. Every character of `markdown` is in
   * the answer but the marks that were understood and the spaces around a
   * line; an empty or blank body is no block.
   */
  parse(markdown: string): RichText {
    const lines = markdown.replace(LINE_BREAKS, '\n').split('\n');
    const kinds: LineKind[] = [];
    for (let at = 0; at < lines.length; at++) {
      const line = (lines[at] as string).trim();
      lines[at] = line;
      kinds.push(lineKindOf(line));
    }

    const blocks: RichText.Block[] = [];
    let at = 0;
    while (at < lines.length) {
      const line = lines[at] as string;
      const kind = kinds[at] as LineKind;
      // The lines this block takes: itself and the same kind after it.
      let next = at + 1;
      switch (kind) {
        case LineKind.Blank:
          break;
        case LineKind.Heading1:
        case LineKind.Heading2:
          blocks.push(
            RichText.heading(
              kind === LineKind.Heading1 ? 1 : 2,
              spansOf(contentOf(line, kind)),
            ),
          );
          break;
        case LineKind.Image: {
          const altEnd = imageAltEnd(line);
          blocks.push(
            RichText.image(
              ProgramImageId.of(line.slice(altEnd + 2, line.length - 1)),
              line.slice(2, altEnd).trim(),
            ),
          );
          break;
        }
        case LineKind.Bullet:
        case LineKind.Ordered: {
          const items: (readonly RichText.Span[])[] = [];
          items.push(spansOf(contentOf(line, kind)));
          while (next < lines.length && kinds[next] === kind) {
            items.push(spansOf(contentOf(lines[next] as string, kind)));
            next++;
          }
          blocks.push(RichText.list(kind === LineKind.Ordered, items));
          break;
        }
        case LineKind.Quote:
        case LineKind.Text: {
          let text = contentOf(line, kind);
          while (next < lines.length && kinds[next] === kind) {
            text += '\n' + contentOf(lines[next] as string, kind);
            next++;
          }
          const spans = spansOf(text);
          blocks.push(
            kind === LineKind.Quote
              ? RichText.quote(spans)
              : RichText.paragraph(spans),
          );
          break;
        }
      }
      at = next;
    }
    return blocks;
  },

  /**
   * An address as somebody typed it into a link field, made one a link
   * may carry — or `null` when it cannot be: a web, mail or phone address
   * or a site path is kept as typed; `creativo.example` gains `https://`,
   * `jobs@creativo.example` gains `mailto:`, `+359 888 123 456` becomes
   * `tel:+359888123456`.
   */
  linkHref(typed: string): string | null {
    const raw = typed.trim();
    if (isLinkHref(raw)) return raw;
    if (raw.length === 0 || raw.includes(':') || raw.startsWith('/')) {
      return null;
    }
    for (let at = 0; at < raw.length; at++) {
      const code = raw.charCodeAt(at);
      if (isSpace(code) && !PHONE_TYPED.test(raw)) return null;
    }
    if (PHONE_TYPED.test(raw)) {
      const digits = raw.replace(NOT_DIALLED, '');
      return digits.length >= PHONE_MIN_DIGITS ? `tel:${digits}` : null;
    }
    if (raw.includes('@')) {
      const mail = `mailto:${raw}`;
      return raw.indexOf('@') > 0 && isLinkHref(mail) ? mail : null;
    }
    const web = `https://${raw}`;
    return raw.includes('.') && isLinkHref(web) ? web : null;
  },

  /**
   * The Markdown `parse` reads back as `blocks` — what an editor saves. A
   * mark typed as text is written with a `\` before it, so nothing typed
   * turns into formatting. A heading and a list item are one line each; a
   * block with no words is not written; an empty list is `''`.
   */
  write(blocks: RichText): string {
    const out: string[] = [];
    for (const block of blocks) {
      switch (block.richBlockKind) {
        case RichBlockKind.Heading: {
          const text = writeSpans(block.spans, true);
          if (text.length > 0) {
            out.push((block.headingLevel === 1 ? '# ' : '## ') + text);
          }
          break;
        }
        case RichBlockKind.Paragraph: {
          const text = writeSpans(block.spans, false);
          if (text.length > 0) out.push(text);
          break;
        }
        case RichBlockKind.Quote: {
          const text = writeSpans(block.spans, false);
          if (text.length > 0) out.push('> ' + text.split('\n').join('\n> '));
          break;
        }
        case RichBlockKind.List: {
          const lines: string[] = [];
          for (const item of block.listItems) {
            const text = writeSpans(item, true);
            if (text.length === 0) continue;
            lines.push(
              (block.listOrdered ? `${lines.length + 1}. ` : '- ') + text,
            );
          }
          if (lines.length > 0) out.push(lines.join('\n'));
          break;
        }
        case RichBlockKind.Image:
          out.push(
            `![${block.imageAlt.replace(/[[\]\n]/g, ' ').trim()}](${block.imageId})`,
          );
          break;
      }
    }
    return out.join('\n\n');
  },
} as const;
