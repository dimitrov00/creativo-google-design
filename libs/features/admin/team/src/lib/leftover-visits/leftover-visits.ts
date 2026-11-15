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
import { VisitPerspective } from '@core/components';
import type { Appointment } from '@core/entities';
import type {
  AppointmentId,
  BarberId,
  LocationId,
  ServiceId,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  CatalogContentService,
  CatalogWording,
  TeamCatalogService,
} from '@creativo/features/shared/catalog';
import {
  type VisitLookup,
  type VisitSectionVm,
  VisitList,
  VisitListStyle,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { loadedLanguage } from '@creativo/infrastructure/i18n';
import { leftoverSectionsVm } from '../leftover-visits.presenter';

/**
 * THE VISITS A LAST DAY LEAVES BEHIND, listed under their days (team
 * onboarding D10) — on the period sheet, under the warning that counts
 * them, and on the page of a barber who has left.
 *
 * It is the app's own visit list (`lib-visit-list`, the staff search's
 * rows): the date stamp, what and when, and who the shop would call. A row
 * is a control (`uiLinked`): it opens the schedule on that visit's day, on
 * this barber's column, where the visit is moved or cancelled — a barber
 * who has left keeps a column there on the days they are still booked.
 *
 * The list is handed in (`EmploymentSystem.leftoverVisitsOf`'s answer):
 * this component reads no visit and decides nothing about them. Loaded on
 * demand by its hosts — most periods leave nothing behind.
 */
@Component({
  selector: 'lib-leftover-visits',
  imports: [VisitList],
  template: `
    @if (sections(); as groups) {
      <lib-visit-list
        [sections]="groups"
        [perspective]="VisitPerspective.Staff"
        [listStyle]="VisitListStyle.InsetGrouped"
        [interactive]="uiLinked()"
        testIdPrefix="leftover"
        (openRow)="open($event)"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-testid]': '"leftover-visits"' },
})
export class LeftoverVisits {
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogContentService);
  private readonly team = inject(TeamCatalogService);
  private readonly content = inject(CatalogWording);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly zone = inject(ShopZoneService).defaultZone();
  /** The instant the list was mounted: "today" is read once from it. */
  private readonly openedAtUtcMs = this.clock.nowUtcMs();

  /** The visits left, oldest first. */
  readonly uiVisits = input.required<readonly Appointment[]>();
  /** Whose visits they are: the column the schedule opens on. */
  readonly uiBarberId = input.required<BarberId>();
  /** A row opens its day on the schedule; off, the rows are text. */
  readonly uiLinked = input(false);

  protected readonly VisitPerspective = VisitPerspective;
  protected readonly VisitListStyle = VisitListStyle;

  private readonly loadedLang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** Who and what a row names, from the staff's whole catalogue. */
  private readonly lookup = computed<VisitLookup>(() => {
    const locations = this.catalog.locations();
    return {
      serviceName: (id: ServiceId) => {
        const service = this.catalog.findAnyService(id);
        return service === undefined ? null : this.content.text(service.name);
      },
      barberName: (id: BarberId) => {
        const barber = this.team.findTeamBarber(id);
        return barber === undefined ? null : this.content.text(barber.name);
      },
      barberAvatarSrc: (id: BarberId) =>
        this.team.findTeamBarberVm(id)?.avatarSrc ?? null,
      locationName: (id: LocationId) => {
        const location = locations.find((entry) => entry.id === id);
        return location === undefined
          ? null
          : this.content.text(location.shortName ?? location.name);
      },
      locationCount: locations.length,
      locationTimeZone: (id: LocationId) =>
        locations.find((entry) => entry.id === id)?.timeZone ?? null,
    };
  });

  /** The visits under their days; `null` until the words and the shop's zone are in. */
  protected readonly sections = computed<readonly VisitSectionVm[] | null>(
    () => {
      const lang = this.loadedLang();
      const zone = this.zone();
      if (lang === null || zone === null) return null;
      const translate = (
        key: string,
        params?: Readonly<Record<string, string | number>>,
      ) => this.transloco.translate<string>(key, { ...params }, lang);
      return leftoverSectionsVm({
        visits: this.uiVisits(),
        now: ZonedTimeSystem.shopNow(this.openedAtUtcMs, zone),
        timeZone: zone,
        locale: lang,
        rowWords: visitWordsOf(translate, lang, VisitPerspective.Staff),
        earlier: translate('staff.search.earlier'),
        lookup: this.lookup(),
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
