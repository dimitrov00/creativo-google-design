import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { UiCard, UiGrid } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { AchievementTile } from '../client-achievements/achievement-tile';
import { ClientCardStore } from '../client-card.store';
import type { MedalsGlanceVm } from '../client-pages.vm';
import { RECORD_KIND_WORDS } from '../client-card.words';
import { glanceCardPaddingFor, sheetColumnOf } from '../sheet-width';

/**
 * G1 — «ПОСТИЖЕНИЯ» ON THE GLANCE (client-card-revision-3 §2.1.3 G1,
 * §3.12; replaces `lib-medal-strip`). ONE white elevated card: three
 * NAMED medals, the cue, the records line.
 *
 * The medals are the shared tile (`lib-achievement-tile`, the DS's
 * `button[uiMedal]` at `large`: ring 64 round a disc of 52, the rim
 * numeral, the title under it) in a grid of three — never a rail, nothing
 * hidden past an edge — and none is captioned here: the name is what a
 * glance needs, the figures are the detail page's. Each medal opens its
 * family's detail. The cue under them is the strip's one callout («С това
 * посещение: …» › «Ново: …» › «Близо: …»), in primary ink; the records line
 * is the first two records of the account as FACTS of one quiet line
 * («Любима услуга **Фейд** · Най-много за година **13**»), and the line
 * is ONE button that pushes «Рекорди»; its facts are the items of a line
 * of facts (`fact-line.css`), so at 390, where the two do not share a
 * line, they stand one over the other with no «·» hanging at the break
 * (review 3, round 4). The rhythm's record is never here: it is the
 * wallet's and the records page's.
 *
 * The one word the card draws that the model does not carry is the
 * tiles' quiet «Ново» marker (`ClientCardWords.achievements.isNew`), read
 * from the store as every piece of the card reads its words. The
 * stylesheet only places the three blocks. Rings and medals draw settled.
 *
 * The card pads `comfortable`, and `regular` on a column whose three
 * tiles could not hold «Рожден ден» whole (a 330 phone: 82 cut it to
 * «Рожден / ден в…», review 3, F3) — a DS input chosen from the measured
 * column (`sheet-width.ts`), as the medal grids choose their step.
 */
@Component({
  selector: 'lib-medals-glance',
  imports: [
    AchievementTile,
    UiCard,
    UiForegroundStyleDirective,
    UiGrid,
    UiInteractiveDirective,
    UiRadiusDirective,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './medals-glance.html',
  styleUrls: ['../fact-line.css', './medals-glance.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MedalsGlance {
  /** The three medals, the cue and the records, already worded (`ClientOverviewVm.medals`, ready). */
  readonly vm = input.required<MedalsGlanceVm>();
  /** A medal was tapped: push its family's detail (the series id). */
  readonly openMedal = output<string>();
  /** The records line was tapped: push «Рекорди». */
  readonly openRecords = output<void>();

  protected readonly words = inject(ClientCardStore).words;
  /** Each record kind's word: a record's `client-record-{word}` test id. */
  protected readonly recordKindWords = RECORD_KIND_WORDS;

  private readonly column = sheetColumnOf(
    inject<ElementRef<HTMLElement>>(ElementRef),
  );

  /** `comfortable`, or `regular` where three tiles of the column would cut a name. */
  protected readonly padding = computed(() => {
    const { width, remPx } = this.column();
    return glanceCardPaddingFor(width, remPx);
  });
}
