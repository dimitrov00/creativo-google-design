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
import {
  AccessScope,
  type BarberId,
  Locale,
  StaffCapability,
  Tag,
} from '@core/primitives';
import { EmploymentSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { UiButton } from '@creativo/ui/controls';
import { UiNotice } from '@creativo/ui/patterns';
import { StaffDayStore } from '../staff-day.store';
import { scheduleRemindersVm } from './schedule-reminders.presenter';
import type { ScheduleReminderVm } from './schedule-reminders.vm';

/**
 * THE LAST DAYS TO DECIDE ON, ON THE STAFF HOME (team onboarding D10, the
 * reminder cards): the Team page's reminders, said where whoever manages
 * the team lands every day — above the schedule, one compact notice each,
 * «Удължи» opening the record's working period
 * (`/admin/team/member/…?edit=period`).
 *
 * Derived from the records the staff's team stream already holds and the
 * shop's today (`EmploymentSystem.remindersOf`): no read of its own,
 * nothing stored, nothing sent. Nobody else sees them — «Удължи» is
 * theirs alone. Its own component, so the schedule page, whose file only
 * shrinks, mounts it with one tag.
 */
@Component({
  selector: 'lib-schedule-reminders',
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
          data-testid="schedule-reminder-extend"
          (click)="extend(row.barberId)"
        >
          {{ row.action }}
        </button>
      </ui-notice>
    }
  `,
  styleUrl: './schedule-reminders.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `schedule-reminders`-prefixed.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'schedule-reminders',
    '[attr.data-testid]': '"schedule-reminders"',
  },
})
export class ScheduleReminders {
  private readonly store = inject(StaffDayStore);
  private readonly team = inject(TeamCatalogService);
  private readonly access = inject(StaffAccessService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());

  protected readonly rows = computed<readonly ScheduleReminderVm[]>(() => {
    this.copyTable();
    const today = this.store.todayKey();
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
    return scheduleRemindersVm({
      barbers: EmploymentSystem.remindersOf(this.team.teamBarbers(), today),
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
