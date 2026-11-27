import type { ProgramImageId } from '@core/primitives';

/**
 * What a block of a body is — the field `richBlockKind`. (`blockKind` is the
 * schedule's: a `MinuteBlock` is busy or a break.)
 */
export const RichBlockKind = {
  Heading: 'HEADING',
  Paragraph: 'PARAGRAPH',
  List: 'LIST',
  Quote: 'QUOTE',
  Image: 'IMAGE',
} as const;
export type RichBlockKind = (typeof RichBlockKind)[keyof typeof RichBlockKind];

/** How a run of a body's text is set — the field `richSpanStyle`. */
export const RichSpanStyle = {
  Plain: 'PLAIN',
  Bold: 'BOLD',
  Italic: 'ITALIC',
  BoldItalic: 'BOLD_ITALIC',
} as const;
export type RichSpanStyle = (typeof RichSpanStyle)[keyof typeof RichSpanStyle];

/**
 * A body as a page draws it — the description staff write for a role, a
 * course or an event (and later a post), parsed: a FLAT list of blocks, top
 * to bottom, each a flat struct told apart by `richBlockKind`. Never stored
 * (the stored body is the Markdown string, one per language —
 * `ProgramBody`); `RichTextSystem.parse` derives it on demand, and
 * `ui-rich-text` draws it with ordinary elements.
 *
 * Decided in
 * `docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`.
 */
export type RichText = readonly RichText.Block[];

export const RichText = {
  /** The longest body one language may hold, in characters — held by the rules too. */
  BODY_MAX_CHARS: 20_000,
  /** The most pictures one body may name. */
  BODY_MAX_IMAGES: 12,

  /** A run of text in one style; `linkHref` makes it (part of) a link. */
  span(
    text: string,
    richSpanStyle: RichSpanStyle = RichSpanStyle.Plain,
    linkHref: string | null = null,
  ): RichText.Span {
    return { richSpanStyle, text, linkHref };
  },

  heading(
    headingLevel: RichText.HeadingLevel,
    spans: readonly RichText.Span[],
  ): RichText.Heading {
    return { richBlockKind: RichBlockKind.Heading, headingLevel, spans };
  },

  paragraph(spans: readonly RichText.Span[]): RichText.Paragraph {
    return { richBlockKind: RichBlockKind.Paragraph, spans };
  },

  list(
    listOrdered: boolean,
    listItems: readonly (readonly RichText.Span[])[],
  ): RichText.List {
    return { richBlockKind: RichBlockKind.List, listOrdered, listItems };
  },

  quote(spans: readonly RichText.Span[]): RichText.Quote {
    return { richBlockKind: RichBlockKind.Quote, spans };
  },

  image(imageId: ProgramImageId, imageAlt: string): RichText.Image {
    return { richBlockKind: RichBlockKind.Image, imageId, imageAlt };
  },
} as const;

export namespace RichText {
  /**
   * One run of text: its words, how they are set, and the address they
   * link to (`null` for none). One shape for every run, so a bold word
   * inside a link is a run that is both.
   */
  export type Span = {
    readonly richSpanStyle: RichSpanStyle;
    readonly text: string;
    /** `https:`/`http:`/`mailto:`/`tel:` or a site path — the parser admits nothing else. */
    readonly linkHref: string | null;
  };

  /** A body has two levels of heading under the page's own title. */
  export type HeadingLevel = 1 | 2;

  export type Heading = {
    readonly richBlockKind: typeof RichBlockKind.Heading;
    readonly headingLevel: HeadingLevel;
    readonly spans: readonly Span[];
  };

  /** A paragraph; a line break typed inside it is a `\n` in a run's text. */
  export type Paragraph = {
    readonly richBlockKind: typeof RichBlockKind.Paragraph;
    readonly spans: readonly Span[];
  };

  export type List = {
    readonly richBlockKind: typeof RichBlockKind.List;
    /** Numbered (`1.`) rather than bulleted (`-`). */
    readonly listOrdered: boolean;
    /** Each item's runs, in order — one level, never nested. */
    readonly listItems: readonly (readonly Span[])[];
  };

  export type Quote = {
    readonly richBlockKind: typeof RichBlockKind.Quote;
    readonly spans: readonly Span[];
  };

  /** A picture, named by its id — the page turns the id into an address. */
  export type Image = {
    readonly richBlockKind: typeof RichBlockKind.Image;
    readonly imageId: ProgramImageId;
    readonly imageAlt: string;
  };

  export type Block = Heading | Paragraph | List | Quote | Image;
}
