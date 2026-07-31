import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import { UiButton, UiIcon, UiMediaCard } from '@creativo/ui/controls';
import {
  UiInteractiveDirective,
  UiMaterialDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';

/**
 * One selectable cover-art service card — the shared surface BOTH the
 * onboarding services grid and the booking services step read in (one
 * service card, one register). Promoted out of onboarding when booking
 * needed the same anatomy; a second copy is exactly the drift the DS rules
 * forbid.
 *
 * The cover IS the card: `ui-media-card` owns the art, the scrim and the
 * inset name/meta caption. What this adds are the corner accessories and
 * the two states a catalog selection actually has.
 *
 * ### Selection is a COUNT, not a boolean
 * A booking seat may hold two lines of the same service (a genuine double
 * appointment), so the chip shows a number once past one. At exactly one it
 * stays a plain check — a "1" badge on a single selection is noise.
 *
 * ### Blocked ≠ disabled
 * A card that conflicts with something already chosen is dimmed and badged,
 * but stays FULLY INTERACTIVE. Disabling it would kill pointer events and
 * make the explanation unreachable, and a control that refuses input
 * without ever saying why is the defect this design exists to avoid — the
 * press opens the sheet, which names the blockers and offers to replace
 * them. `uiCapBlocked` is the other, stricter state (onboarding's cap),
 * where there genuinely is nothing to explain beyond the counter already
 * on screen.
 *
 * ### The info pill
 * Present only when the card's own press does something ELSE (onboarding:
 * press toggles, so details need their own affordance). Booking's press
 * opens the sheet directly, so it passes `uiShowDetails=false` and the
 * pill disappears rather than duplicating the card's job.
 */
@Component({
  selector: 'cr-service-card',
  imports: [
    UiButton,
    UiIcon,
    UiInteractiveDirective,
    UiMaterialDirective,
    UiMediaCard,
    UiRadiusDirective,
    UiTextDirective,
  ],
  templateUrl: './service-card.component.html',
  styleUrl: './service-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.cr-service-card` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and the
  // host rule (`position: relative`) anchors the floating pills.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'cr-service-card',
    '[attr.data-selected]': 'uiSelectedCount() > 0 ? "" : null',
    '[attr.data-blocked]': 'uiBlocked() ? "" : null',
    '[attr.data-cap-blocked]': 'uiCapBlocked() ? "" : null',
  },
})
export class ServiceCardComponent {
  readonly uiServiceId = input.required<string>();
  readonly uiName = input.required<string>();
  /** Pre-formatted "45 мин · 15,00 €" line — locale work stays with the parent. */
  readonly uiMeta = input.required<string>();
  readonly uiCoverUrl = input<string | null>(null);

  /** How many lines of this service the active seat holds. 0 ⇒ unselected. */
  readonly uiSelectedCount = input(0);

  /** Conflicts with something already chosen — dimmed and badged, still tappable. */
  readonly uiBlocked = input(false);
  /** Short badge copy for the blocked state ("Conflicts"). */
  readonly uiBlockedLabel = input('');

  /** Onboarding's cap: dimmed AND inert, because the counter already explains it. */
  readonly uiCapBlocked = input(false);

  /** Render the quiet info pill. Off when the card's own press opens details. */
  readonly uiShowDetails = input(true);
  readonly uiDetailsLabel = input('');

  /** The card surface was pressed — toggle, or open details; the host decides. */
  readonly uiPressed = output<void>();
  /** The info pill was pressed. Only reachable while `uiShowDetails`. */
  readonly uiDetailsPressed = output<void>();

  /** A "1" badge on a single selection is noise; two is information. */
  protected readonly showCount = computed(() => this.uiSelectedCount() > 1);
}
