import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { UiCard } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import type { LoyaltyGlanceVm } from '../client-pages.vm';

/**
 * F1 — «ЛОЯЛНОСТ» ON THE GLANCE (client-card-revision-3 §2.1.3 F1, §3.12;
 * replaces the bento of `lib-loyalty-tiles`). ONE white elevated card and
 * ONE button: the whole card pushes the wallet at its top.
 *
 * What it says, top to bottom: the figure — the points balance as a
 * display figure in the ONE orange (`title2` 24/700, legal on white by
 * the law's rule 3) with its unit beside it in secondary ink; the
 * sentence, what the points buy («Стигат за безплатно оформяне на
 * брада», «Още 42 до …»), in primary ink; and the holdings line, every
 * other thing held as one FACT of one quiet line («Ваучер **25,00 €** ·
 * Печати **3 от 10** · Ритъм **9**»), the facts in primary ink at weight
 * 500. A fact whose data is absent is absent; with none the line is
 * absent. With `loyalty.points` off the first holding's value leads as
 * the figure and there is no unit.
 *
 * The motif: two `aria-hidden` discs of the accent wash in the trailing
 * corner — the pass's discs, so the card and the wallet it opens read as
 * one family. They are boxes inside the card with the circle cut into
 * them (the pass's own recipe), so nothing paints outside the card and
 * no word of the card lies over a wash.
 *
 * The button's one sentence (`vm.accessibleName`) names it all; the drawn
 * words are hidden from a reader, so nothing is heard twice. The three
 * facts keep their test ids on the spans that print them (§0.4).
 */
@Component({
  selector: 'lib-loyalty-glance',
  imports: [
    UiCard,
    UiForegroundStyleDirective,
    UiTextDirective,
    UiWeightDirective,
  ],
  templateUrl: './loyalty-glance.html',
  styleUrls: ['../fact-line.css', './loyalty-glance.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyGlance {
  /** The card's words, already final (`ClientOverviewVm.loyalty`, ready). */
  readonly vm = input.required<LoyaltyGlanceVm>();
  /** The card was tapped: push the wallet at its top. */
  readonly open = output<void>();
}
