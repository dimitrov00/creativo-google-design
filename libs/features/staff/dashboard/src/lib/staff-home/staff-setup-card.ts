import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { RouteCapabilities } from '@core/components';
import { StaffSetupSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { UiButton } from '@creativo/ui/controls';
import { UiNotice } from '@creativo/ui/patterns';
import type { SetupCardVm } from './staff-home.vm';
import { setupCardVm } from './staff-setup-card.presenter';

/**
 * THE SETUP CARD (account first, A5 —
 * `docs/architecture/decisions/2026-11-16-account-first-team.md`): on a
 * barber's own schedule while their profile — the photo and the few words
 * clients see — is not done, like iOS «Finish setting up your iPhone».
 * «Продължи» opens their own page (`/staff/profile`), where those are set —
 * so the card shows only to someone that page opens for
 * (`RouteCapabilities.OwnProfile`). Derived from their record as the team
 * stream holds it (`StaffSetupSystem.profileLeftOf`); nothing is stored,
 * and it goes once every detail is there.
 */
@Component({
  selector: 'lib-staff-setup-card',
  imports: [UiButton, UiNotice],
  template: `
    @if (card(); as card) {
      <ui-notice
        uiTone="accent"
        uiIcon="account.profile"
        data-testid="staff-setup-card"
      >
        <h2 uiNoticeTitle>{{ card.title }}</h2>
        {{ card.body }}
        <button
          uiNoticeActions
          type="button"
          uiButton
          uiButtonStyle="bordered"
          uiTint="neutral"
          uiControlSize="regular"
          data-testid="staff-setup-card-open"
          (click)="open()"
        >
          {{ card.action }}
        </button>
      </ui-notice>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class StaffSetupCard {
  private readonly access = inject(StaffAccessService);
  private readonly team = inject(TeamCatalogService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());

  protected readonly card = computed<SetupCardVm | null>(() => {
    this.copyTable();
    const barberId = this.access.linkedBarberId();
    if (
      barberId === null ||
      !this.team.teamKnown() ||
      !this.access.opens(RouteCapabilities.OwnProfile)
    ) {
      return null;
    }
    const barber = this.team
      .teamBarbers()
      .find((record) => record.id === barberId);
    if (barber === undefined) return null;
    return setupCardVm(
      StaffSetupSystem.profileLeftOf(
        StaffSetupSystem.checklistOf(barber, [], null),
      ),
      {
        title: this.transloco.translate<string>('staff.setupCard.title'),
        body: (done, total) =>
          this.transloco.translate<string>('staff.setupCard.body', {
            done,
            total,
          }),
        action: this.transloco.translate<string>('staff.setupCard.action'),
      },
    );
  });

  /** «Продължи»: their own page, where the profile is set. */
  protected open(): void {
    void this.router.navigate(['/staff/profile']);
  }
}
