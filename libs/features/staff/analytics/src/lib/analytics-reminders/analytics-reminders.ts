import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import {
  AccessScope,
  type BarberId,
  type LocalDate,
  Locale,
  StaffCapability,
  Tag,
} from '@core/primitives';
import { EmploymentReminderSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { UiButton } from '@creativo/ui/controls';
import { UiNotice } from '@creativo/ui/patterns';
import { analyticsRemindersVm } from './analytics-reminders.presenter';
import type { AnalyticsReminderVm } from './analytics-reminders.vm';

/**
 * THE DECISIONS ON TOP OF «АНАЛИЗИ» (owner ruling 2026-11-25, Q2 of the
 * role-aware homes brief: the shop's view is the chart button, labelled,
 * with the pending decisions on top of the page it opens). Today they are
 * the Team page's reminders (team onboarding D10): one compact notice per
 * last day, «Удължи» opening the record's working period
 * (`/admin/team/member/…?edit=period`).
 *
 * They stood above the schedule until then, and pushed the day down when
 * the team stream answered after the first frame. The schedule now says
 * only how many, as a badge on the chart button (`AnalyticsEntry.pending`,
 * the same system's answer, the same gate), and nothing moves the day.
 *
 * Derived from the records the staff's team stream already holds and the
 * shop's today (`EmploymentReminderSystem.remindersOf`): no read of its own,
 * nothing stored, nothing sent. Nobody else sees them — «Удължи» is
 * theirs alone.
 */
@Component({
  selector: 'lib-analytics-reminders',
  imports: [UiButton, UiNotice],
  template: `
    @for (row of rows(); track row.barberId) {
      <ui-notice
        uiTone="accent"
        uiIcon="notice.reminder"
        [attr.data-testid]="row.testId"
      >
        {{ row.line }}
        <button
          uiNoticeActions
          type="button"
          uiButton
          uiButtonStyle="bordered"
          uiTint="neutral"
          uiControlSize="regular"
          data-testid="analytics-reminder-extend"
          (click)="extend(row.barberId)"
        >
          {{ row.action }}
        </button>
      </ui-notice>
    }
  `,
  styleUrl: './analytics-reminders.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `analytics-reminders`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'analytics-reminders',
    '[attr.data-testid]': '"analytics-reminders"',
  },
})
export class AnalyticsReminders {
  /** The shop's today (`StaffAnalyticsStore.today`); `null` until its zone is known. */
  readonly today = input<LocalDate | null>(null);

  private readonly team = inject(TeamCatalogService);
  private readonly access = inject(StaffAccessService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());

  protected readonly rows = computed<readonly AnalyticsReminderVm[]>(() => {
    this.copyTable();
    const today = this.today();
    if (
      today === null ||
      !this.team.teamKnown() ||
      this.access.scopeOf(StaffCapability.TeamManage) === AccessScope.None
    ) {
      return [];
    }
    const active = this.transloco.getActiveLang();
    const locale = Tag.has(Locale, active) ? active : Locale.Bg;
    const translate = (
      key: string,
      params?: Readonly<Record<string, string>>,
    ): string => this.transloco.translate<string>(key, params);
    return analyticsRemindersVm({
      barbers: EmploymentReminderSystem.remindersOf(
        this.team.teamBarbers(),
        today,
      ),
      today,
      locale,
      words: {
        title: (name, date) =>
          translate('admin.team.reminder.title', { name, date }),
        today: (name) => translate('admin.team.reminder.today', { name }),
        extend: translate('admin.team.reminder.extend'),
      },
    });
  });

  /** «Удължи»: the record's page, its working period open. */
  protected extend(barberId: BarberId): void {
    void this.router.navigate(['/admin/team/member', barberId], {
      queryParams: { edit: 'period' },
    });
  }
}
