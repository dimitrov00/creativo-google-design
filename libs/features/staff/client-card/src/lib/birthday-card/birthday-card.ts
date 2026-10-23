import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  UiBadge,
  UiButton,
  UiCouponCard,
  UiIcon,
  UiNotice,
  UiOccasionBand,
} from '@creativo/ui/controls';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';
import { ClientCardStore } from '../client-card.store';
import {
  BirthdayMoment,
  type BirthdayVm,
  birthdayMomentWords,
} from '../client-pages.vm';

/**
 * BD — THE BIRTHDAY CARD (client-card-revision-3 §2.1.2, §3.12; R2-D). A
 * moment is a banner, never a capsule in a row: directly under the head
 * and before the verbs, the page's ONE orange slab.
 *
 * Three states, one quiet variant, all from the view model:
 *
 * - (a) **today, the gift held**: one ticket (`button[uiCouponCard]`) whose
 *   head is the solid `ui-occasion-band` («Рожден ден · 34 г.», the cake on
 *   its white disc, the static flecks) and whose white body under the
 *   perforation is the gift — the figure «−20 %» in the accent, «Подарък
 *   от салона», the validity chip and the same pill every ticket wears,
 *   «Използвай». The whole card is the control; the pill is its dress.
 * - (a′) **the gift on this visit's bill**: the band stays, the body is the
 *   applied grammar (`article[uiCouponCard] uiApplied`: the check beside
 *   the figure, a real «Премахни» where the pill stood), focusable so ‹
 *   lands on it.
 * - (b) **today, nothing to use** (no gift, a party member, offline, a gone
 *   visit, a paused client): the band alone, fully rounded, a statement
 *   with `role="note"`.
 * - (d) **within the week**: one quiet `ui-notice` in the accent tone —
 *   «Рожден ден · петък, 2.10 · 34 г.» — a date, never a countdown.
 *
 * The two verbs' words («Използвай», «Премахни») are the card's own
 * (`ClientCardWords.reward`), read from the store as every piece of the
 * card reads them; everything else is already worded in the model. The
 * stylesheet only places the card. No motion: staff see a settled band.
 */
@Component({
  selector: 'lib-birthday-card',
  imports: [
    UiBadge,
    UiButton,
    UiCouponCard,
    UiIcon,
    UiInteractiveDirective,
    UiNotice,
    UiOccasionBand,
  ],
  templateUrl: './birthday-card.html',
  styleUrl: './birthday-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'client-birthday',
    '[attr.data-kind]': 'momentWord()',
    '[attr.data-gift]':
      "vm().gift ? (vm().gift?.applied ? 'applied' : 'ready') : null",
  },
})
export class BirthdayCard {
  /** The day, and the gift when one can be used on this visit. */
  readonly vm = input.required<BirthdayVm>();
  /** «Използвай»: the sheet puts the gift's grant on the bill and opens the discount page on it. */
  readonly useGift = output<string>();
  /** The applied gift's «Премахни»: the sheet takes its grant off the bill. */
  readonly removeGift = output<string>();

  protected readonly words = inject(ClientCardStore).words;

  /** Which birthday the card says, for the template's switch. */
  protected readonly BirthdayMoment = BirthdayMoment;
  /** The moment as the host's `data-kind` prints it: `today` · `upcoming`. */
  protected readonly momentWord = computed(
    () => birthdayMomentWords[this.vm().birthdayMoment],
  );
}
