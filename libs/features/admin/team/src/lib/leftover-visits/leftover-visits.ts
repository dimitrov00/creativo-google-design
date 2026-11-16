import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Appointment } from '@core/entities';
import type { AppointmentId, BarberId } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import { StaffEventHead } from '@creativo/features/shared/visits';
import {
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { loadedLanguage } from '@creativo/infrastructure/i18n';
import { UiAvatar } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import { UiListGroup, UiListRow, UiSectionHeader } from '@creativo/ui/patterns';
import {
  type LeftoverSectionVm,
  leftoverSectionsVm,
} from '../leftover-visits.presenter';

/**
 * THE VISITS A LAST DAY LEAVES BEHIND, listed under their days (team
 * onboarding D10) — on the period sheet, under the warning that counts
 * them, and on the page of a barber who has left.
 *
 * Each row is the schedule's own visit, in the DS's parts: the client's
 * face (`ui-avatar`), then the schedule's event head (`lib-staff-event-
 * head`: the name, what was booked, the clock). No barber's face: every
 * row is the same barber's. A row is a control — it opens the schedule on
 * that visit's day, on this barber's column, where the visit is given to
 * another barber, moved or cancelled.
 *
 * The list is handed in (`EmploymentSystem.leftoverVisitsOf`'s answer):
 * this component reads no visit and decides nothing about them. Loaded on
 * demand by its hosts — most periods leave nothing behind.
 */
@Component({
  selector: 'lib-leftover-visits',
  imports: [
    StaffEventHead,
    UiAvatar,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiStack,
  ],
  template: `
    @if (sections(); as groups) {
      <ui-stack uiSpacing="comfortable">
        @for (section of groups; track section.key) {
          <ui-stack uiSpacing="compact" [attr.data-testid]="section.testId">
            <ui-section-header uiHeaderProminence="standard">
              <h3 uiTitle>{{ section.label }}</h3>
            </ui-section-header>
            <ul uiListGroup>
              @for (row of section.rows; track row.id) {
                <li>
                  <button
                    type="button"
                    uiListRow
                    uiSize="large"
                    [uiInteractive]="true"
                    [attr.data-testid]="row.testId"
                    [attr.data-appointment-id]="row.id"
                    [attr.aria-label]="row.accessibleName"
                    (click)="open(row.id)"
                  >
                    <ui-avatar
                      uiLeading
                      uiControlSize="regular"
                      aria-hidden="true"
                      [uiName]="row.clientName ?? ''"
                      [uiIcon]="
                        row.clientName === null ? 'contact.person' : null
                      "
                    />
                    <lib-staff-event-head
                      aria-hidden="true"
                      size="regular"
                      [title]="row.title"
                      [lines]="row.lines"
                      [start]="row.start"
                      [end]="row.end"
                      [timesDecorative]="true"
                      [truncate]="true"
                      [truncateLines]="true"
                    />
                  </button>
                </li>
              }
            </ul>
          </ui-stack>
        }
      </ui-stack>
    }
  `,
  styles: `
    /* The head fills the row beside the face, so the clock sits at the
       row's trailing edge — where the schedule's card puts it. */
    lib-staff-event-head {
      flex: 1 1 auto;
      min-inline-size: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-testid]': '"leftover-visits"' },
})
export class LeftoverVisits {
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogContentService);
  private readonly content = inject(CatalogWording);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly zone = inject(ShopZoneService).defaultZone();
  /** The instant the list was mounted: "today" is read once from it. */
  private readonly openedAtUtcMs = this.clock.nowUtcMs();

  /** The visits left, oldest first. */
  readonly uiVisits = input.required<readonly Appointment[]>();
  /** Whose visits they are: the column the schedule opens on. */
  readonly uiBarberId = input.required<BarberId>();

  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** The visits under their days; `null` until the words and the shop's zone are in. */
  protected readonly sections = computed<readonly LeftoverSectionVm[] | null>(
    () => {
      const lang = this.loadedLang();
      const zone = this.zone();
      if (lang === null || zone === null) return null;
      return leftoverSectionsVm({
        visits: this.uiVisits(),
        today: ZonedTimeSystem.shopNow(this.openedAtUtcMs, zone).localDate,
        locale: lang,
        earlier: this.transloco.translate<string>(
          'staff.search.earlier',
          {},
          lang,
        ),
        unknownService: this.transloco.translate<string>(
          'appointments.visit.unknownService',
          {},
          lang,
        ),
        serviceName: (id) => {
          const service = this.catalog.findAnyService(id);
          return service === undefined ? null : this.content.text(service.name);
        },
      });
    },
  );

  /** A row was tapped: the schedule opens on that visit's day, on this barber's column. */
  protected open(id: AppointmentId): void {
    const visit = this.uiVisits().find((entry) => entry.id === id);
    if (visit === undefined) return;
    void this.router.navigate(['/staff/schedule'], {
      queryParams: { day: visit.localDate, barber: this.uiBarberId() },
    });
  }
}
