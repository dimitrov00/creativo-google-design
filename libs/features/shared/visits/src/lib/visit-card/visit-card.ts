import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import {
  UiAvatar,
  UiBadge,
  UiCard,
  type UiCardPadding,
  type UiCardTone,
  UiMediaCard,
  type UiSectionHeaderProminence,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  type VisitCardVm,
  type VisitLinePart,
  visitCardSlotWords,
} from './visit-card.vm';

// The card's pure builders (`visitCardOf`, `waitlistCardOf`) ride this
// file's line in the lib's barrel (contract delta K3-3).
export * from './visit-card.presenter';

/**
 * How loudly the card's label speaks, ≙ SwiftUI `.headerProminence(_:)` —
 * the DS's own two steps, the section header's. `standard` under a module
 * heading (the staff glance); `increased` where no heading stands above
 * the card (`/account`), so the label is the heading.
 */
export type VisitCardHeaderProminence = UiSectionHeaderProminence;

/** The static card's sentence needs an id to be named by; one per card on the page. */
let nextCard = 0;

/**
 * A joint hangs from the word BEFORE it: «Фейд ·» may end a line, «· Фейд»
 * never starts one. The words arrive joined by « · » with plain spaces
 * (the row's joint); drawn, the space before the dot does not break.
 */
function hung(text: string): string {
  return text.replaceAll(' · ', '\u00a0· ');
}

/**
 * ONE VISIT, ONE CARD (client-card revision 3 §3.10, R2-I) — the card
 * `/account` draws as «Предстоящ час», shared with the staff glance's
 * «Посещения».
 *
 * Every part is a DS part: the surface is `ui-card` (white and lifted in
 * light, a step over the sheet in dark), the words are `uiText` roles,
 * the status is `span[uiBadge]`, the barber is `ui-avatar`, a thumb is
 * `ui-media-card` in a button. This component chooses which element
 * carries them and lays them out; it restyles none of them and declares
 * no colour.
 *
 * Anatomy: the label · THE SERVICES · the facts, with the figure at their
 * trailing edge · the client's quote · the thumbs · the capsule; the
 * barber's face (`ui-avatar regular`, 44) in the top-trailing corner. ONE
 * order for every kind: a last visit and a next visit read the same way.
 *
 * - `standard` (the glance, under a module heading): the label
 *   `subheadline` 13 secondary, the services `headline` 18/600, the facts
 *   `callout` 14 secondary with ONE fact in primary/500 (the date of a
 *   last visit, the time of a next one), the figure `callout` 14/600.
 * - `increased` (`/account`, no heading above): the label `headline`
 *   18/600, the facts `body` 15 primary, and with `showServices` false no
 *   services line — exactly today's «Предстоящ час» card. With the
 *   services shown under such a heading (owner question Q7) they are the
 *   row's title, `body` 15/500, and the facts step back to the quiet line
 *   under them: no two lines that touch share both size and tone.
 *
 * States are the host's: the card draws a VM or nothing; loading, empty
 * and error stay with `/account` and with the glance's module.
 *
 * A11y: static, a `role="group"` named by `vm.accessibleName` — the
 * sentence is real text in the reading order and the drawn words are
 * hidden from the reader, so nothing is heard twice. `interactive`, the
 * whole card is a `button[uiCard]` and the name is the button's. The
 * thumbs are buttons of their own, named by their day, and sit OUTSIDE an
 * interactive card's button: they lie over a room the button keeps at its
 * foot, so the eye sees them in the card either way.
 *
 * Test ids are the host's, through `vm.testId`: the card wears it, its
 * capsule `{testId}-status`, the quote `{testId}-quote`; a thumb is
 * `client-visit-photo-{id}`.
 */
@Component({
  selector: 'lib-visit-card',
  imports: [
    NgTemplateOutlet,
    UiAvatar,
    UiBadge,
    UiCard,
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiMediaCard,
    UiRadiusDirective,
    UiTextDirective,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './visit-card.html',
  styleUrl: './visit-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-kind]': 'slotWord()',
    '[attr.data-header-prominence]': 'headerProminence()',
  },
})
export class VisitCard {
  readonly vm = input.required<VisitCardVm>();
  /** ≙ `.headerProminence`: the label as a quiet caption, or as the card's heading. */
  readonly headerProminence = input<VisitCardHeaderProminence>('standard');
  /** The card's surface; the client stack's cards are all `elevated` (R2-E). */
  readonly tone = input<UiCardTone>('elevated');
  readonly padding = input<UiCardPadding>('comfortable');
  /** The whole card is one `button[uiCard]` that emits `open`. */
  readonly interactive = input(false, { transform: booleanAttribute });
  /** False leaves the services line out (`/account`, until owner question Q7 says otherwise). */
  readonly showServices = input(true, { transform: booleanAttribute });
  /** The card was tapped (`interactive` only): the host opens the visit. */
  readonly open = output<void>();
  /** A thumb was tapped: the photo's id. */
  readonly openPhoto = output<string>();

  /** The slot as the host prints it — `last` · `next` · `waitlist` (`visitCardSlotWords`). */
  protected readonly slotWord = computed(
    () => visitCardSlotWords[this.vm().visitCardSlot],
  );

  /** What names the static card: its sentence, by id. */
  protected readonly nameId = `visit-card-name-${nextCard++}`;

  /** The lines that wrap, as they are drawn: their joints hung (`hung`). */
  protected readonly drawn = computed<{
    readonly services: string;
    readonly facts: readonly VisitLinePart[];
  }>(() => ({
    services: hung(this.vm().services),
    facts: this.vm().facts.map((part) => ({
      text: hung(part.text),
      fact: part.fact,
    })),
  }));

  /** The label is the card's heading: no module heading stands above it. */
  protected readonly heading = computed(
    () => this.headerProminence() === 'increased',
  );

  /**
   * The facts are the QUIET line — secondary, one fact in the primary ink —
   * wherever a line of the primary ink leads them: the services. Under a
   * heading with no services between, the facts are what the card says,
   * in the body's own ink.
   */
  protected readonly quiet = computed(
    () => !this.heading() || this.showServices(),
  );
}
