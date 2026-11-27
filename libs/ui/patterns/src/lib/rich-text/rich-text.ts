import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { RichBlockKind, RichSpanStyle, type RichText } from '@core/components';

/** Turns a picture's id into its address; `null` while it has none. */
export type UiRichImageSource = (imageId: string) => string | null;

/**
 * The runs of one block — a piece of `ui-rich-text`, never used alone.
 * Every run is an ELEMENT, so the template's own whitespace never becomes a
 * space in the printed text.
 *
 * @uiPartOf ui-rich-text
 * @uiPurpose Prints one block's runs: plain, bold, italic, and links.
 */
@Component({
  selector: 'ui-rich-text-runs',
  template: `
    @for (span of uiSpans(); track $index) {
      @if (span.linkHref; as href) {
        <a
          data-link
          class="ui-rich-text__run"
          [class.ui-rich-text__run--bold]="bold(span)"
          [class.ui-rich-text__run--italic]="italic(span)"
          [href]="href"
          [attr.target]="external(href) ? '_blank' : null"
          [attr.rel]="external(href) ? 'noopener noreferrer' : null"
          >{{ span.text }}</a
        >
      } @else {
        @switch (span.richSpanStyle) {
          @case (Style.Bold) {
            <strong>{{ span.text }}</strong>
          }
          @case (Style.Italic) {
            <em>{{ span.text }}</em>
          }
          @case (Style.BoldItalic) {
            <strong
              ><em>{{ span.text }}</em></strong
            >
          }
          @default {
            <span>{{ span.text }}</span>
          }
        }
      }
    }
  `,
  host: { class: 'ui-rich-text-runs' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class UiRichTextRuns {
  readonly uiSpans = input.required<readonly RichText.Span[]>();

  protected readonly Style = RichSpanStyle;

  protected bold(span: RichText.Span): boolean {
    return (
      span.richSpanStyle === RichSpanStyle.Bold ||
      span.richSpanStyle === RichSpanStyle.BoldItalic
    );
  }

  protected italic(span: RichText.Span): boolean {
    return (
      span.richSpanStyle === RichSpanStyle.Italic ||
      span.richSpanStyle === RichSpanStyle.BoldItalic
    );
  }

  /** A web address leaves the site, so it opens beside it; a site path, a mail or a call does not. */
  protected external(href: string): boolean {
    return /^https?:/i.test(href);
  }
}

/**
 * Rich text — a description written by staff, drawn: headings, paragraphs,
 * bulleted and numbered lists, quotes, links and pictures, in the system's
 * own type. It draws the flat block list a system parsed
 * (`RichTextSystem.parse` over the stored Markdown) with ordinary elements;
 * it reads no HTML and decides nothing.
 *
 * A body's two heading levels sit under the host's own title: `uiHeadingLevel`
 * is the level the body's first level takes (2 under a page's `h1`, 3 under
 * a sheet's `h2`).
 *
 * A picture is named by its id; `uiImageSource` turns the id into an
 * address. Without one — or while it answers `null` — the picture is not
 * drawn.
 *
 * Markup contract:
 * ```html
 * <ui-rich-text [uiBlocks]="blocks" [uiHeadingLevel]="3" />
 * ```
 *
 * @uiPurpose Draws a staff-written description (headings, paragraphs,
 *   lists, quotes, links, pictures) from its parsed block list.
 * @uiSwiftUI `Text` drawn from a Markdown `AttributedString`
 * @uiAliases rich text, markdown, prose, article, formatted text, wysiwyg,
 *   description, body copy
 * @uiNotThis A search match inside one line is `ui-marked-text`.
 */
@Component({
  selector: 'ui-rich-text',
  imports: [UiRichTextRuns],
  template: `
    @for (block of uiBlocks(); track $index) {
      @switch (block.richBlockKind) {
        @case (Kind.Heading) {
          <p
            class="ui-rich-text__heading"
            role="heading"
            [attr.aria-level]="uiHeadingLevel() + block.headingLevel - 1"
            [attr.data-level]="block.headingLevel"
          >
            <ui-rich-text-runs [uiSpans]="block.spans" />
          </p>
        }
        @case (Kind.Paragraph) {
          <p class="ui-rich-text__paragraph">
            <ui-rich-text-runs [uiSpans]="block.spans" />
          </p>
        }
        @case (Kind.List) {
          @if (block.listOrdered) {
            <ol class="ui-rich-text__list">
              @for (item of block.listItems; track $index) {
                <li><ui-rich-text-runs [uiSpans]="item" /></li>
              }
            </ol>
          } @else {
            <ul class="ui-rich-text__list">
              @for (item of block.listItems; track $index) {
                <li><ui-rich-text-runs [uiSpans]="item" /></li>
              }
            </ul>
          }
        }
        @case (Kind.Quote) {
          <blockquote class="ui-rich-text__quote">
            <ui-rich-text-runs [uiSpans]="block.spans" />
          </blockquote>
        }
        @case (Kind.Image) {
          @if (imageAddress(block.imageId); as address) {
            <img
              class="ui-rich-text__image"
              loading="lazy"
              decoding="async"
              [src]="address"
              [alt]="block.imageAlt"
            />
          }
        }
      }
    }
  `,
  styleUrl: './rich-text.css',
  host: { class: 'ui-rich-text' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*` selectors are the system's styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
})
export class UiRichText {
  /** The blocks to draw, top to bottom. */
  readonly uiBlocks = input.required<RichText>();
  /** The heading level the body's first level takes: 2 under an `h1`, 3 under an `h2`. */
  readonly uiHeadingLevel = input(2);
  /** Turns a picture's id into its address; `null` draws no picture. */
  readonly uiImageSource = input<UiRichImageSource | null>(null);

  protected readonly Kind = RichBlockKind;

  protected imageAddress(imageId: string): string | null {
    return this.uiImageSource()?.(imageId) ?? null;
  }
}
