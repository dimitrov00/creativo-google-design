import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { UiAvatar, UiBadge, UiCard } from '@creativo/ui/controls';
import { type UiFontStyle, UiTextDirective } from '@creativo/ui/modifiers';
import { boundSuffix } from '../client-card.format';
import type { RecordCardVm } from '../client-pages.vm';
import { measuredWidthOf, recordFigureFontFor } from '../sheet-width';

/**
 * ONE PERSONAL RECORD AS A CARD (client-card-revision-3 §2.3.2 AE, §3.14) —
 * a white elevated card, the whole card one button to «Рекорди»: the
 * emblem on top (a 52 disc, SOLID accent with a white glyph: a mark, §1
 * rule 4 — or the subject's picture, a favourite service's cover, in its
 * place), the label under it, the FIGURE in the card's display rung, one
 * quiet detail. A record set in the last thirty days wears the capsule
 * «Нов рекорд» beside its figure (the one line of the card with room for
 * it: a 52 disc and the capsule do not share 137 pt, and a figure that
 * can be new is a number).
 *
 * A feature piece, not a DS pattern: it composes a control (the avatar,
 * the badge) with type, and it becomes a pattern only if a third consumer
 * appears. The emblem is the DS's avatar — a disc that holds a picture or
 * a glyph — tinted through its own hooks: the solid accent behind it and
 * the on-accent ink for the glyph, exactly the quick action's promoted
 * disc, so the two marks of the stack are one recipe.
 *
 * A WORD figure — a favourite's figure is the SERVICE — is not a number:
 * it stands on the headline rung (the ladder's object headline), wraps
 * only between its words («Класическа / подстрижка») and never inside one
 * (title2 at 24/700 cut it to «Класическ / а / подстрижк / а» in a 137 pt
 * card, review 3, F1). The card measures ITSELF for the rung the word
 * holds (`recordFigureFontFor`): a 330 phone's 140 pt card takes the body
 * rung at 600, a 390 phone's 170 and the dialog's 2-up 256 the headline —
 * the page's step says nothing about a card's width (the records lay four
 * across only from a 648 column, `recordColumnsFor`: four across the
 * dialog's 528 cramped every card to 120, review 3, round 2). A number
 * keeps the display rung.
 *
 * The host IS the list item of the records grid (`ui-grid role="list"`)
 * and a subgrid of four of its rows — emblem, label, figure, detail — so
 * every part of a row's cards stands on the row's line (§3.14: the figures
 * of a 2 × 2 one line of display figures) whatever a label wraps, and four
 * cards of unequal words stand one height. The test id is the host's
 * (`achievements-record-{kind}`), the consumer's to set.
 */
@Component({
  selector: 'lib-record-card',
  imports: [UiAvatar, UiBadge, UiCard, UiTextDirective],
  template: `
    @let record = vm();
    <button
      type="button"
      uiCard
      uiTone="elevated"
      uiPadding="regular"
      [uiInteractive]="true"
      class="record-card"
      [attr.aria-label]="record.accessibleName"
      [attr.data-kind]="record.kind"
      [attr.data-new]="record.isNew ? '' : null"
      (click)="open.emit(record.id)"
    >
      <ui-avatar
        class="record-card__emblem"
        uiControlSize="large"
        aria-hidden="true"
        [uiSrc]="record.src"
        [uiIcon]="record.src === null ? record.icon : null"
        [uiName]="record.value"
        [attr.data-picture]="record.src === null ? null : ''"
      />
      <span
        class="record-card__label"
        uiText
        uiFont="callout"
        uiWeight="semibold"
        aria-hidden="true"
        >{{ record.label }}</span
      >
      <span class="record-card__figure-row" aria-hidden="true">
        <span
          class="record-card__figure"
          uiText
          [uiFont]="figureFont(record)"
          [uiWeight]="wordFigure(record) ? 'semibold' : undefined"
          [attr.data-word]="wordFigure(record) ? '' : null"
          >{{ record.value }}</span
        >
        @if (record.isNew) {
          <span uiBadge uiTone="accent" class="record-card__new">{{
            newWord()
          }}</span>
        }
      </span>
      @if (record.detail; as detail) {
        <span
          class="record-card__detail"
          uiText
          uiFont="footnote"
          uiForegroundStyle="secondary"
          aria-hidden="true"
          >{{ bound(detail) }}</span
        >
      }
    </button>
  `,
  styleUrl: './record-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'record-card-host', role: 'listitem' },
})
export class RecordCard {
  readonly vm = input.required<RecordCardVm>();
  /** «Нов рекорд» — the capsule's word, in the card's language. */
  readonly newWord = input.required<string>();
  /** A tap: the record's id; the page opens «Рекорди». */
  readonly open = output<string>();

  /** The card's own width, followed as it resizes: what a word figure's rung is chosen by. */
  private readonly width = measuredWidthOf(
    inject<ElementRef<HTMLElement>>(ElementRef),
  );

  /**
   * The detail as drawn: «септември 2026 г.» with its year and «г.» bound,
   * so a narrow card (a 330 phone's, the dialog's 4-up) wraps it before the
   * year and never leaves «г.» alone on a line (review 3, F13). The
   * card's sentence (`accessibleName`) is the VM's, plain.
   */
  protected bound(detail: string): string {
    return boundSuffix(detail);
  }

  /** A favourite's figure is the service — a word, not a number. */
  protected wordFigure(record: RecordCardVm): boolean {
    return record.kind === 'favouriteService';
  }

  /** The figure's rung: the display rung for a number; for a word, the rung the card's width holds. */
  protected figureFont(record: RecordCardVm): UiFontStyle {
    if (!this.wordFigure(record)) return 'title2';
    const measured = this.width();
    return recordFigureFontFor(measured?.width ?? null, measured?.remPx ?? 16);
  }
}
