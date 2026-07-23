import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';

/**
 * The page's booking chord — the capsule `/auth → /book` CTA the landing
 * opens (hero) and closes (closing CTA) on. Both consumers render this one
 * component at the prominent tier (52px) so the chord stays literally
 * matched; `onMedia` flips the white-pill treatment when the CTA sits over
 * video. Feature-local: the `/auth` routing keeps it out of libs/ui.
 */
@Component({
  selector: 'cr-booking-cta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoDirective, UiButton],
  host: { class: 'cr-booking-cta' },
  template: `
    <ng-container *transloco="let t">
      <a
        routerLink="/auth"
        [queryParams]="{ redirect: '/book' }"
        uiButton
        uiVariant="prominent"
        uiSize="prominent"
        uiShape="capsule"
        [uiOnMedia]="onMedia()"
        [attr.data-testid]="testId() ?? null"
      >
        {{ t(labelKey()) }}
      </a>
    </ng-container>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class BookingCtaComponent {
  /** Transloco key for the CTA label. */
  readonly labelKey = input.required<string>();
  /** White-pill (on-media) treatment when the CTA rides over video. */
  readonly onMedia = input(false);
  /** Test hook forwarded onto the anchor — the real interactive element. */
  readonly testId = input<string | undefined>(undefined);
}
