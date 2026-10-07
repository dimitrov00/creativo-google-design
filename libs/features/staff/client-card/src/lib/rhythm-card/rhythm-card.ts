import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  UiStreakTrack,
} from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { WalletRhythmVm } from '../client-pages.vm';
import { sheetColumnOf } from '../sheet-width';
import {
  WALLET_RHYTHM_PERIODS,
  WALLET_RHYTHM_PERIODS_NARROW,
} from '../wallet.presenter';

/**
 * Under this column the track keeps six marks, not eight (§2.2.4, 330 pt:
 * the 295 column; a 390 phone's 355 draws eight). Between the two
 * columns the round makes, with air on either side.
 */
const NARROW_COLUMN_PX = 320;

/**
 * «РИТЪМ» — the wallet's rhythm card (client-card-revision-3 §2.2.2 WD,
 * §3.13): how many visits in a row the person has kept to the shop's
 * rhythm, drawn as the figure, then the track, then where they stand and
 * the rule they are held to.
 *
 * ONE FACT, ONE ENCODING. The run is the FIGURE («9 посещения в ритъм»,
 * 24/700 with its unit beside it) and the TRACK (the kept marks, the open
 * one last); while the phase is healthy nothing else is said about it.
 * Only when it is NOT healthy does a capsule stand beside the figure («До
 * 10.11», «Гратис до 17.11», «Записан за 29.10», «Защитен», «Прекъснат»),
 * in the tone the presenter chose. The state line under the track coaches
 * («Следващото посещение до 10.11 пази ритъма.»); the best run and the
 * protections banked are the quiet facts after it; the RULE closes the
 * card as one footnote line («На всеки 6 седмици · 7 дни гратис») that a
 * tap unfolds into the whole rule, sentence by sentence, with a scheduled
 * change under it when one is coming.
 *
 * The track's own figure is NOT drawn: `ui-streak-track` prints its count
 * as a `regular` metric over the periods, and this card prints the same
 * count at the card's rung (`title2`) with the phase capsule beside it,
 * which the track has no seat for. The track still receives the count
 * and the words (its one spoken sentence, `trackName`, is on it), so a
 * reader hears the run once, from the track. Recorded for the DS: a
 * `uiCountHidden` on the track would make the one rule below it needless.
 *
 * UNSCOPED, like `lib-staff-event-head` and every DS pattern: its
 * `rhythm-card__*` classes are its styling contract, and the one rule
 * that quiets the track's own metric must reach inside the track, which
 * an emulated sheet cannot.
 *
 * A paused client's card draws frozen (`data-frozen`): the track greys,
 * the values stay. The marks come from `StreakState.periods` through the
 * presenter and are never re-derived here; the card only decides HOW
 * MANY of the newest it shows for the column it stands in (eight; six
 * under 320 px, measured on its own host).
 */
@Component({
  selector: 'lib-rhythm-card',
  imports: [UiBadge, UiButton, UiCard, UiIcon, UiStreakTrack, UiTextDirective],
  templateUrl: './rhythm-card.html',
  styleUrl: './rhythm-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'rhythm-card',
    '[attr.data-frozen]': "vm().frozen ? '' : null",
    '[attr.data-testid]': 'testIdPrefix()',
  },
})
export class RhythmCard {
  readonly vm = input.required<WalletRhythmVm>();
  /** «Цялото правило» — the rule line's spoken verb (the words are the host's). */
  readonly ruleMoreLabel = input.required<string>();
  /** `{prefix}`, `{prefix}-phase`, `-state`, `-best`, `-protections`, `-rule`, `-rule-more`, `-rule-full`. */
  readonly testIdPrefix = input('rewards-rhythm');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly column = sheetColumnOf(this.host);

  /** The whole rule, unfolded in place. */
  protected readonly expanded = signal(false);

  /** The newest marks the column holds: eight, six on a 330 pt phone. */
  protected readonly periods = computed(() => {
    const max =
      this.column().width < NARROW_COLUMN_PX
        ? WALLET_RHYTHM_PERIODS_NARROW
        : WALLET_RHYTHM_PERIODS;
    return this.vm().periods.slice(-max);
  });

  /** The track's count, as a number: the figure is the same count, printed. */
  protected readonly count = computed(() => {
    const parsed = Number.parseInt(this.vm().figure.replace(/\s/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  /** The rule button's one name: the line it shows, then what a tap does. */
  protected readonly ruleName = computed(
    () => `${this.vm().ruleLine} · ${this.ruleMoreLabel()}`,
  );

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected testId(part: string): string {
    return `${this.testIdPrefix()}-${part}`;
  }
}
